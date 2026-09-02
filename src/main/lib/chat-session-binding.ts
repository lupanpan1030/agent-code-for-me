import { eq, inArray } from "drizzle-orm"
import type { drizzle } from "drizzle-orm/better-sqlite3"
import { inferChatEngineIdFromMessages } from "../../shared/chat-engine-id"
import {
  type ChatSessionBinding,
  type ChatSessionBindingWriteInput,
  normalizeChatSessionBindingWrite,
} from "../../shared/chat-session-binding"
import { parseProviderProfileSource } from "../../shared/provider-profile-types"
import { getActiveClaudeSession } from "./claude/active-sessions"
import { getActiveCodexStream } from "./codex/active-streams"
import type * as schema from "./db/schema"
import { type SubChatBinding, subChatBindings, subChats } from "./db/schema"

export type ChatSessionBindingDatabase = ReturnType<
  typeof drizzle<typeof schema>
>

type ChatSessionBindingExecutor = Pick<
  ChatSessionBindingDatabase,
  "select" | "insert" | "update"
>

export type UpdateChatSessionBindingPatch =
  Partial<ChatSessionBindingWriteInput>

export type ChatSessionBindingProviderProfileMetadata = {
  id: string
  targetRuntimes: readonly string[]
  defaultModel: string
}

export type ChatSessionBindingWriteDependencies = {
  getProviderProfileMetadata: (
    db: ChatSessionBindingExecutor,
    profileId: string,
  ) => ChatSessionBindingProviderProfileMetadata | null
}

export type CodexChatSessionBindingRunRequest = {
  providerProfileId?: string | null
  codexAuthMethod?: "chatgpt" | "api_key" | null
  model?: string | null
}

export type ClaudeChatSessionBindingRunRequest = {
  modelSource?: string | null
  requestedModel?: string | null
}

export type ClaudeChatSessionBindingRunAdmissionDependencies = {
  getProviderProfileRuntimeMetadata: (
    db: ChatSessionBindingExecutor,
    profileId: string,
  ) => {
    id: string
    targetRuntimes: readonly string[]
  } | null
}

type ChatSessionBindingRunAdmissionFailure = {
  ok: false
  message: string
  hint: string
}

export type CodexChatSessionBindingRunAdmission =
  | ChatSessionBindingRunAdmissionFailure
  | {
      ok: true
      binding: ChatSessionBinding
      providerProfileId: string | null
      codexAuthMethod: "chatgpt" | "api_key" | null
      requestedModel: string | null
    }

export type ClaudeChatSessionBindingRunAdmission =
  | ChatSessionBindingRunAdmissionFailure
  | {
      ok: true
      binding: ChatSessionBinding
      modelSource: string
      requestedModel: string | null
      runScopedProfileDivert: boolean
    }

type SubChatIdentity = {
  id: string
}

// Keep list hydration below SQLite's conservative host-parameter ceiling.
// This is a query-shape bound, not a second binding read path.
const CHAT_SESSION_BINDING_LOOKUP_BATCH_SIZE = 500

function missingBinding(subChatId: string): ChatSessionBinding {
  return {
    id: null,
    subChatId,
    runtime: "claude-code",
    providerProfileId: null,
    modelId: null,
    modelSource: null,
    thinkingLevel: null,
    createdAt: null,
    updatedAt: null,
  }
}

function toChatSessionBinding(row: SubChatBinding): ChatSessionBinding {
  const normalized = normalizeChatSessionBindingWrite({
    runtime: row.runtime,
    providerProfileId: row.providerProfileId,
    modelId: row.modelId,
    modelSource: row.modelSource,
    thinkingLevel: row.thinkingLevel,
  })

  return {
    id: row.id,
    subChatId: row.subChatId,
    ...normalized,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function assertNewProviderProfileBindingUsable(input: {
  db: ChatSessionBindingExecutor
  binding: ReturnType<typeof normalizeChatSessionBindingWrite>
  dependencies: ChatSessionBindingWriteDependencies
}): void {
  const profileId = input.binding.providerProfileId
  if (!profileId) return
  if (!input.binding.modelId) {
    throw new Error(
      `Provider profile ${profileId} requires a snapshotted modelId.`,
    )
  }

  const profile = input.dependencies.getProviderProfileMetadata(
    input.db,
    profileId,
  )
  if (!profile) {
    throw new Error(`Provider profile ${profileId} was not found.`)
  }
  const requiredTarget = input.binding.runtime === "codex" ? "codex" : "claude"
  if (!profile.targetRuntimes.includes(requiredTarget)) {
    throw new Error(
      `Provider profile ${profileId} does not support ${requiredTarget}.`,
    )
  }
  if (input.binding.modelId !== profile.defaultModel) {
    throw new Error(
      `Provider profile ${profileId} requires its current default model snapshot (${profile.defaultModel}).`,
    )
  }
}

function insertNormalizedSubChatBinding(
  db: ChatSessionBindingExecutor,
  subChatId: string,
  normalized: ReturnType<typeof normalizeChatSessionBindingWrite>,
): ChatSessionBinding {
  const now = new Date()
  db.insert(subChatBindings)
    .values({
      subChatId,
      ...normalized,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: subChatBindings.subChatId })
    .run()

  const binding = getSubChatBinding(db, subChatId)
  if (binding.id === null) {
    throw new Error(`Failed to seed chat session binding for ${subChatId}`)
  }
  return binding
}

function parsePersistedMessages(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function isPersistedMessageListEmpty(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) && parsed.length === 0
  } catch {
    return false
  }
}

function rejectStaleRunPayload(
  runtimeLabel: "Claude" | "Codex",
): ChatSessionBindingRunAdmissionFailure {
  return {
    ok: false,
    message: `${runtimeLabel} run input no longer matches the durable chat session binding.`,
    hint: "Refresh this chat and retry with its current runtime, source, and model selection.",
  }
}

function expectedCodexTransportModel(
  binding: ChatSessionBinding,
): string | null {
  if (!binding.modelId) return null
  if (binding.providerProfileId) {
    return `${binding.modelId}/none`
  }
  return `${binding.modelId}/${binding.thinkingLevel ?? "high"}`
}

/**
 * Admits a renderer Codex payload only when it exactly represents the current
 * DB-owned binding, then returns the canonical values the main route must use.
 */
export function admitCodexChatSessionBindingRun(
  db: ChatSessionBindingExecutor,
  subChatId: string,
  request: CodexChatSessionBindingRunRequest,
): CodexChatSessionBindingRunAdmission {
  const binding = getSubChatBinding(db, subChatId)
  if (binding.id === null || binding.runtime !== "codex") {
    return rejectStaleRunPayload("Codex")
  }

  const providerProfileId = binding.providerProfileId
  const codexAuthMethod = providerProfileId
    ? null
    : binding.modelSource === "openai-api-key"
      ? "api_key"
      : "chatgpt"
  const requestedModel = expectedCodexTransportModel(binding)

  if (
    (request.providerProfileId ?? null) !== providerProfileId ||
    (request.codexAuthMethod ?? null) !== codexAuthMethod ||
    (request.model ?? null) !== requestedModel
  ) {
    return rejectStaleRunPayload("Codex")
  }

  return {
    ok: true,
    binding,
    providerProfileId,
    codexAuthMethod,
    requestedModel,
  }
}

function normalizeClaudeOAuthRunSource(
  source: string | null | undefined,
): "claude-oauth" | null {
  if (source === undefined || source === null) return "claude-oauth"
  if (source === "auto" || source === "claude-oauth") return "claude-oauth"
  return null
}

/**
 * Admits an exact Claude binding payload, plus the one design-approved
 * run-scoped OAuth/legacy-custom-provider -> Provider Profile divert.
 */
export function admitClaudeChatSessionBindingRun(
  db: ChatSessionBindingExecutor,
  subChatId: string,
  request: ClaudeChatSessionBindingRunRequest,
  dependencies: ClaudeChatSessionBindingRunAdmissionDependencies,
): ClaudeChatSessionBindingRunAdmission {
  const binding = getSubChatBinding(db, subChatId)
  if (binding.id === null || binding.runtime !== "claude-code") {
    return rejectStaleRunPayload("Claude")
  }

  const requestedOAuthSource = normalizeClaudeOAuthRunSource(
    request.modelSource,
  )
  const requestedSource = requestedOAuthSource ?? request.modelSource ?? ""
  const bindingSource = binding.modelSource ?? "claude-oauth"
  const requestedModel = request.requestedModel ?? null
  const exactBindingMatch =
    requestedSource === bindingSource && requestedModel === binding.modelId

  if (exactBindingMatch) {
    return {
      ok: true,
      binding,
      modelSource: bindingSource,
      requestedModel: binding.modelId,
      runScopedProfileDivert: false,
    }
  }

  const divertedProfileId = parseProviderProfileSource(requestedSource)
  if (
    !divertedProfileId ||
    (bindingSource !== "claude-oauth" && bindingSource !== "custom-provider") ||
    requestedModel !== null
  ) {
    return rejectStaleRunPayload("Claude")
  }

  try {
    const divertedProfile = dependencies.getProviderProfileRuntimeMetadata(
      db,
      divertedProfileId,
    )
    if (
      !divertedProfile ||
      divertedProfile.id !== divertedProfileId ||
      !divertedProfile.targetRuntimes.includes("claude")
    ) {
      return rejectStaleRunPayload("Claude")
    }
  } catch {
    // Persisted Profile metadata is canonical and strictly parsed by the
    // storage owner. Malformed metadata must fail closed at admission.
    return rejectStaleRunPayload("Claude")
  }

  return {
    ok: true,
    binding,
    modelSource: requestedSource,
    requestedModel: null,
    runScopedProfileDivert: true,
  }
}

export function getSubChatBinding(
  db: ChatSessionBindingExecutor,
  subChatId: string,
): ChatSessionBinding {
  const row = db
    .select()
    .from(subChatBindings)
    .where(eq(subChatBindings.subChatId, subChatId))
    .get()

  return row ? toChatSessionBinding(row) : missingBinding(subChatId)
}

export function attachBindingsToSubChats<T extends SubChatIdentity>(
  db: ChatSessionBindingExecutor,
  rows: readonly T[],
): Array<T & { binding: ChatSessionBinding }> {
  if (rows.length === 0) return []

  const bindingRows: SubChatBinding[] = []
  const uniqueSubChatIds = [...new Set(rows.map((row) => row.id))]
  for (
    let offset = 0;
    offset < uniqueSubChatIds.length;
    offset += CHAT_SESSION_BINDING_LOOKUP_BATCH_SIZE
  ) {
    const subChatIdBatch = uniqueSubChatIds.slice(
      offset,
      offset + CHAT_SESSION_BINDING_LOOKUP_BATCH_SIZE,
    )
    bindingRows.push(
      ...db
        .select()
        .from(subChatBindings)
        .where(inArray(subChatBindings.subChatId, subChatIdBatch))
        .all(),
    )
  }
  const bindingsBySubChatId = new Map(
    bindingRows.map((row) => [row.subChatId, toChatSessionBinding(row)]),
  )

  return rows.map((row) => ({
    ...row,
    binding: bindingsBySubChatId.get(row.id) ?? missingBinding(row.id),
  }))
}

export function seedSubChatBinding(
  db: ChatSessionBindingExecutor,
  subChatId: string,
  input: ChatSessionBindingWriteInput,
  dependencies: ChatSessionBindingWriteDependencies,
): ChatSessionBinding {
  const normalized = normalizeChatSessionBindingWrite(input)
  assertNewProviderProfileBindingUsable({
    db,
    binding: normalized,
    dependencies,
  })
  return insertNormalizedSubChatBinding(db, subChatId, normalized)
}

export function updateSubChatBinding(
  db: ChatSessionBindingExecutor,
  subChatId: string,
  patch: UpdateChatSessionBindingPatch,
  dependencies: ChatSessionBindingWriteDependencies,
): ChatSessionBinding {
  const activeRuntime = getActiveCodexStream(subChatId)
    ? "Codex"
    : getActiveClaudeSession(subChatId)
      ? "Claude"
      : null
  if (activeRuntime) {
    throw new Error(
      `Cannot update chat session binding while a ${activeRuntime} Run is active.`,
    )
  }

  const current = getSubChatBinding(db, subChatId)
  if (current.id === null) {
    throw new Error(`Unknown chat session binding: ${subChatId}`)
  }

  const requestedRuntime =
    patch.runtime === undefined ? current.runtime : patch.runtime
  const runtimeChanged = requestedRuntime !== current.runtime
  if (runtimeChanged) {
    const subChat = db
      .select({ messages: subChats.messages })
      .from(subChats)
      .where(eq(subChats.id, subChatId))
      .get()
    if (!subChat) {
      throw new Error(`Unknown sub-chat: ${subChatId}`)
    }
    // Runtime switching is safe only when the durable message payload is
    // positively known to be an empty list. Corrupt/unknown shapes fail closed.
    if (!isPersistedMessageListEmpty(subChat.messages)) {
      throw new Error("A chat runtime can only change before its first message")
    }
  }
  const normalized = normalizeChatSessionBindingWrite({
    runtime: requestedRuntime,
    providerProfileId:
      patch.providerProfileId === undefined
        ? runtimeChanged
          ? null
          : current.providerProfileId
        : patch.providerProfileId,
    modelId:
      patch.modelId === undefined
        ? runtimeChanged
          ? null
          : current.modelId
        : patch.modelId,
    modelSource:
      patch.modelSource === undefined
        ? runtimeChanged
          ? null
          : current.modelSource
        : patch.modelSource,
    thinkingLevel:
      patch.thinkingLevel === undefined
        ? runtimeChanged
          ? null
          : current.thinkingLevel
        : patch.thinkingLevel,
  })

  const enteringOrChangingProfile = Boolean(
    normalized.providerProfileId &&
      (runtimeChanged ||
        normalized.providerProfileId !== current.providerProfileId),
  )
  const writesProfileModelSnapshot = Boolean(
    normalized.providerProfileId &&
      (enteringOrChangingProfile || patch.modelId !== undefined),
  )
  const leavingProfileForFirstParty = Boolean(
    !runtimeChanged &&
      current.providerProfileId &&
      !normalized.providerProfileId,
  )
  if (
    leavingProfileForFirstParty &&
    (!patch.modelSource?.trim() || !normalized.modelSource)
  ) {
    throw new Error(
      "Leaving a Provider Profile requires an explicit first-party modelSource.",
    )
  }
  if (leavingProfileForFirstParty && !patch.modelId?.trim()) {
    throw new Error(
      "Leaving a Provider Profile for a first-party source requires an explicit modelId.",
    )
  }
  if (
    leavingProfileForFirstParty &&
    normalized.runtime === "codex" &&
    !patch.thinkingLevel?.trim()
  ) {
    throw new Error(
      "Leaving a Codex Provider Profile for a first-party source requires an explicit thinkingLevel.",
    )
  }
  if (enteringOrChangingProfile && !patch.modelId?.trim()) {
    throw new Error(
      `Provider profile ${normalized.providerProfileId} requires an explicit snapshotted modelId.`,
    )
  }
  if (
    normalized.providerProfileId &&
    (enteringOrChangingProfile || patch.modelId !== undefined) &&
    !normalized.modelId
  ) {
    throw new Error(
      `Provider profile ${normalized.providerProfileId} requires a snapshotted modelId.`,
    )
  }
  if (writesProfileModelSnapshot) {
    assertNewProviderProfileBindingUsable({
      db,
      binding: normalized,
      dependencies,
    })
  }

  db.update(subChatBindings)
    .set({
      ...normalized,
      updatedAt: new Date(),
    })
    .where(eq(subChatBindings.subChatId, subChatId))
    .run()

  return getSubChatBinding(db, subChatId)
}

export function copySubChatBinding(
  db: ChatSessionBindingExecutor,
  sourceSubChatId: string,
  targetSubChatId: string,
): ChatSessionBinding {
  const source = getSubChatBinding(db, sourceSubChatId)
  const normalized = normalizeChatSessionBindingWrite({
    runtime: source.runtime,
    providerProfileId: source.providerProfileId,
    modelId: source.modelId,
    modelSource: source.modelSource,
    thinkingLevel: source.thinkingLevel,
  })
  return insertNormalizedSubChatBinding(db, targetSubChatId, normalized)
}

export function backfillSubChatBindings(
  db: ChatSessionBindingExecutor,
): number {
  const chatRows = db
    .select({ id: subChats.id, messages: subChats.messages })
    .from(subChats)
    .all()
  if (chatRows.length === 0) return 0

  const existingRows = db
    .select({ subChatId: subChatBindings.subChatId })
    .from(subChatBindings)
    .all()
  const existingSubChatIds = new Set(existingRows.map((row) => row.subChatId))
  let inserted = 0

  for (const row of chatRows) {
    if (existingSubChatIds.has(row.id)) continue

    const runtime = inferChatEngineIdFromMessages(
      parsePersistedMessages(row.messages),
    )
    const now = new Date()
    const result = db
      .insert(subChatBindings)
      .values({
        subChatId: row.id,
        runtime,
        providerProfileId: null,
        modelId: null,
        modelSource: null,
        thinkingLevel: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: subChatBindings.subChatId })
      .run()
    inserted += result.changes
  }

  return inserted
}
