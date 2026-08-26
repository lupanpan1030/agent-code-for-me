import { randomUUID } from "node:crypto"
import type {
  AgentGuardEvent,
  AgentScopeContract,
  AgentScopeExpansion,
  AgentScopePath,
} from "../../../shared/agent-scope-contracts"
import { captureGuardedGitStatus, type GuardedGitStatusSnapshot } from "./audit"
import {
  formatScopeValidationError,
  type ValidateAgentScopeContractOptions,
  type ValidatedAgentScopeContract,
  validateAgentScopeContract,
} from "./contract"

const activeGuardedContractsBySubChatId = new Map<
  string,
  ValidatedAgentScopeContract
>()

const DEFAULT_SCOPE_EXPANSION_TTL_MS = 15 * 60 * 1000

type PendingActiveGuardedScopeExpansion = {
  requestId: string
  contract: ValidatedAgentScopeContract
  toolUseId: string
  paths: readonly string[]
  reason: string
  expiresAtMs: number
}

const pendingActiveGuardedScopeExpansions = new Map<
  string,
  PendingActiveGuardedScopeExpansion
>()
const activeGuardedContractRevisions = new WeakMap<
  ValidatedAgentScopeContract,
  number
>()

function clearPendingScopeExpansionsForContract(
  contract: ValidatedAgentScopeContract,
): number {
  let cleared = 0
  for (const [requestId, pending] of pendingActiveGuardedScopeExpansions) {
    if (pending.contract !== contract) continue
    if (pendingActiveGuardedScopeExpansions.get(requestId) !== pending) continue
    pendingActiveGuardedScopeExpansions.delete(requestId)
    cleared++
  }
  return cleared
}

export function isActiveGuardedContract(
  contract: ValidatedAgentScopeContract,
): boolean {
  return activeGuardedContractsBySubChatId.get(contract.subChatId) === contract
}

/**
 * Publish the complete guard state for a winning Run. An unguarded winner must
 * revoke the prior guarded Run just as a guarded winner replaces it.
 */
export function replaceActiveGuardedContractForSubChat(
  subChatId: string,
  contract: ValidatedAgentScopeContract | null,
): void {
  if (contract && contract.subChatId !== subChatId) {
    throw new Error(
      "Guarded contract sub-chat does not match its active owner.",
    )
  }
  // Runtime ownership is one-per-sub-chat. Contract IDs are renderer metadata
  // and may legitimately collide across two different chats, so they must
  // never be used as the registry key or cleanup authority.
  const current = activeGuardedContractsBySubChatId.get(subChatId)
  if (current && current !== contract) {
    clearPendingScopeExpansionsForContract(current)
  }
  if (contract) {
    activeGuardedContractsBySubChatId.set(subChatId, contract)
    if (!activeGuardedContractRevisions.has(contract)) {
      activeGuardedContractRevisions.set(contract, 0)
    }
  } else {
    activeGuardedContractsBySubChatId.delete(subChatId)
  }
}

/**
 * Delete a runtime-owned contract only while that exact object still owns its
 * sub-chat. A later Run may reuse the renderer contract ID, and a different
 * chat may use the same ID concurrently, so neither can authorize cleanup.
 */
export function deleteActiveGuardedContractIfMatch(
  contract: ValidatedAgentScopeContract,
): boolean {
  if (!isActiveGuardedContract(contract)) return false
  clearPendingScopeExpansionsForContract(contract)
  return activeGuardedContractsBySubChatId.delete(contract.subChatId)
}

export function clearActiveGuardedContractsForTest(): void {
  activeGuardedContractsBySubChatId.clear()
  pendingActiveGuardedScopeExpansions.clear()
}

/**
 * Capture a main-created scope-expansion event as one-shot authority. The
 * renderer may display the event fields, but it can only return the opaque
 * event ID and a decision; paths and reasons are retained here as canonical
 * main-process data bound to this exact contract object.
 */
export function registerActiveGuardedScopeExpansionRequest(input: {
  contract: ValidatedAgentScopeContract
  event: AgentGuardEvent
  nowMs?: number
  ttlMs?: number
}): boolean {
  if (input.event.type !== "scope-expansion-request") return false
  if (!isActiveGuardedContract(input.contract)) return false

  const toolUseId = input.event.toolUseId?.trim()
  const paths = [
    ...(input.event.paths ?? []),
    ...(input.event.path ? [input.event.path] : []),
  ].filter((item, index, all): item is string =>
    Boolean(item && all.indexOf(item) === index),
  )
  if (!toolUseId || paths.length === 0) return false

  const nowMs = input.nowMs ?? Date.now()
  const ttlMs = Math.max(1, input.ttlMs ?? DEFAULT_SCOPE_EXPANSION_TTL_MS)
  pendingActiveGuardedScopeExpansions.set(input.event.id, {
    requestId: input.event.id,
    contract: input.contract,
    toolUseId,
    paths: Object.freeze([...paths]),
    reason: input.event.reason,
    expiresAtMs: nowMs + ttlMs,
  })
  return true
}

export function hasPendingActiveGuardedScopeExpansionForTest(
  requestId: string,
): boolean {
  return pendingActiveGuardedScopeExpansions.has(requestId)
}

export type PrepareGuardedRunContractInput = {
  scopeContract?: AgentScopeContract
  cwd: string
  projectPath?: string
  chatId: string
  subChatId: string
  runId?: string
  fallbackRunId: string
  validateOptions?: Partial<ValidateAgentScopeContractOptions>
  captureStatus?: typeof captureGuardedGitStatus
}

export type PrepareGuardedRunContractResult =
  | {
      ok: true
      contract: ValidatedAgentScopeContract | null
      preRunStatus: GuardedGitStatusSnapshot | null
    }
  | {
      ok: false
      error: string
    }

/**
 * Validate a guarded-run contract and capture its pre-run status without
 * publishing it as active. Runtime admission may still reject this candidate,
 * so activation belongs after the runtime has claimed ownership.
 */
export async function prepareGuardedRunContract({
  scopeContract,
  cwd,
  projectPath,
  chatId,
  subChatId,
  runId,
  fallbackRunId,
  validateOptions,
  captureStatus = captureGuardedGitStatus,
}: PrepareGuardedRunContractInput): Promise<PrepareGuardedRunContractResult> {
  if (!scopeContract) {
    return {
      ok: true,
      contract: null,
      preRunStatus: null,
    }
  }

  try {
    const validated = await validateAgentScopeContract(scopeContract, {
      cwd,
      projectPath,
      chatId,
      subChatId,
      runId,
      ...validateOptions,
    })
    const contract = {
      ...validated,
      runId: validated.runId ?? runId ?? fallbackRunId,
    }
    return {
      ok: true,
      contract,
      preRunStatus: await captureStatus(cwd),
    }
  } catch (error) {
    return {
      ok: false,
      error: formatScopeValidationError(error),
    }
  }
}

export type ApplyActiveGuardedScopeExpansionResult =
  | { ok: true; contract: ValidatedAgentScopeContract }
  | { ok: false; error: string }

async function applyExactActiveGuardedScopeExpansion(input: {
  contract: ValidatedAgentScopeContract
  toolUseId: string
  approved: boolean
  paths: readonly string[]
  reason: string
  nowMs?: number
  validateOptions?: Partial<ValidateAgentScopeContractOptions>
  validateContract?: typeof validateAgentScopeContract
}): Promise<ApplyActiveGuardedScopeExpansionResult> {
  const current = input.contract
  if (!isActiveGuardedContract(current)) {
    return { ok: false, error: "Guarded run is no longer active." }
  }

  const revision = activeGuardedContractRevisions.get(current) ?? 0
  const now = new Date(input.nowMs ?? Date.now()).toISOString()
  const expansionPaths: AgentScopePath[] = input.paths.map((scopePath) => ({
    path: scopePath,
    kind: "file",
    source: "user",
    reason: input.reason,
  }))
  const expansion: AgentScopeExpansion = {
    id: randomUUID(),
    requestedAt: now,
    requestedByToolUseId: input.toolUseId,
    paths: expansionPaths,
    reason: input.reason,
    ...(input.approved ? { approvedAt: now } : { rejectedAt: now }),
  }

  try {
    const updated = await (
      input.validateContract ?? validateAgentScopeContract
    )(
      {
        ...current,
        status: input.approved ? "expanded" : current.status,
        editableScope: input.approved
          ? [...current.editableScope, ...expansionPaths]
          : current.editableScope,
        expansions: [...current.expansions, expansion],
      },
      {
        cwd: current.cwd,
        projectPath: current.projectPath,
        chatId: current.chatId,
        subChatId: current.subChatId,
        runId: current.runId,
        ...input.validateOptions,
      },
    )
    // Validation may touch the filesystem. A successor Run can replace this
    // contract while it is in flight, or another expansion can win first.
    // Recheck both exact owner identity and revision immediately before the
    // only authoritative mutation.
    if (
      !isActiveGuardedContract(current) ||
      (activeGuardedContractRevisions.get(current) ?? 0) !== revision
    ) {
      return { ok: false, error: "Guarded run is no longer active." }
    }
    Object.assign(current, updated)
    activeGuardedContractRevisions.set(current, revision + 1)
    return { ok: true, contract: current }
  } catch (error) {
    return {
      ok: false,
      error: formatScopeValidationError(error),
    }
  }
}

/**
 * Consume a main-minted request exactly once and apply only the canonical
 * paths captured when the guard event was emitted.
 */
export async function respondActiveGuardedScopeExpansion(input: {
  requestId: string
  approved: boolean
  nowMs?: number
  validateOptions?: Partial<ValidateAgentScopeContractOptions>
  validateContract?: typeof validateAgentScopeContract
}): Promise<ApplyActiveGuardedScopeExpansionResult> {
  const pending = pendingActiveGuardedScopeExpansions.get(input.requestId)
  if (!pending) {
    return { ok: false, error: "Scope expansion request is no longer pending." }
  }
  // Take before any check or await. Approve, reject, expiry, and validation
  // failure all consume the opaque authority token and replays fail closed.
  if (pendingActiveGuardedScopeExpansions.get(input.requestId) === pending) {
    pendingActiveGuardedScopeExpansions.delete(input.requestId)
  }

  if ((input.nowMs ?? Date.now()) > pending.expiresAtMs) {
    return { ok: false, error: "Scope expansion request has expired." }
  }

  return applyExactActiveGuardedScopeExpansion({
    contract: pending.contract,
    toolUseId: pending.toolUseId,
    approved: input.approved,
    paths: pending.paths,
    reason: pending.reason,
    nowMs: input.nowMs,
    validateOptions: input.validateOptions,
    validateContract: input.validateContract,
  })
}
