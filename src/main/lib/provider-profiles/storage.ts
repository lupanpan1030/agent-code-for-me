import { eq } from "drizzle-orm"
import { z } from "zod"
import {
  type ProviderProfileAuthMode,
  type ProviderProfileCapabilities,
  type ProviderProfileDefaultPurpose,
  type ProviderProfileMetadata,
  type ProviderProfileProtocol,
  type ProviderProfileTarget,
  type ProviderProfileTestStatus,
  providerDiagnosticCategories,
  providerDiagnosticCheckIds,
  providerDiagnosticStatuses,
  providerProfileAuthModes,
  providerProfileDefaultPurposes,
  providerProfileProtocols,
  providerProfileSupportsDefaultPurpose,
  providerProfileTargets,
} from "../../../shared/provider-profile-types"
import { getActiveClaudeProviderConfig } from "../claude/provider-config-store"
import {
  agentProviderDefaults,
  agentProviderProfiles,
  getDatabase,
} from "../db"
import { createId } from "../db/utils"
import { getActiveLocalApiProviderConfig } from "../local-api-provider-config"
import {
  decryptProviderToken,
  encryptProviderToken,
  normalizeProviderBaseUrl,
  normalizeProviderToken,
  requireReusableEncryptedProviderToken,
} from "../provider-token"

// Re-exported for existing consumers (e.g. provider-profiles/gateway.ts).
export { normalizeProviderBaseUrl, normalizeProviderToken }

const LEGACY_CLAUDE_PROFILE_ID = "legacy-claude-provider"
const SAFE_METADATA_HEADER_NAMES = new Set([
  "anthropic-beta",
  "anthropic-version",
  "http-referer",
  "openai-organization",
  "openai-project",
  "referer",
  "user-agent",
  "x-title",
])
const SECRET_HEADER_NAME_REGEX =
  /(^|[-_])(authorization|api[-_]?key|auth|bearer|credential|key|password|secret|token)([-_]|$)/i
const SECRET_HEADER_VALUE_REGEX =
  /(sk-[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._~+/=-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|token)=\S+)/i

export const providerProfileProtocolSchema = z.enum(providerProfileProtocols)
export const providerProfileAuthModeSchema = z.enum(providerProfileAuthModes)
export const providerProfileTargetSchema = z.enum(providerProfileTargets)
export const providerProfileDefaultPurposeSchema = z.enum(
  providerProfileDefaultPurposes,
)

export const providerProfileCapabilitiesSchema = z.object({
  claude: z.boolean().optional(),
  codex: z.boolean().optional(),
  helpers: z.boolean().optional(),
  local: z.boolean().optional(),
  streaming: z.boolean().optional(),
  tools: z.boolean().optional(),
  vision: z.boolean().optional(),
})

const providerDiagnosticCheckSchema = z.object({
  id: z.enum(providerDiagnosticCheckIds),
  status: z.enum(providerDiagnosticStatuses),
  message: z.string(),
  category: z.enum(providerDiagnosticCategories).optional(),
})

export const providerProfileTestStatusSchema = z.object({
  ok: z.boolean(),
  checkedAt: z.string(),
  message: z.string(),
  capabilities: providerProfileCapabilitiesSchema.optional(),
  diagnosticVersion: z.literal(1).optional(),
  category: z.enum(providerDiagnosticCategories).optional(),
  checks: z.array(providerDiagnosticCheckSchema).optional(),
})

export type ProviderProfileRuntimeConfig = {
  id: string
  name: string
  presetId: string | null
  protocol: ProviderProfileProtocol
  baseUrl: string
  defaultModel: string
  authMode: ProviderProfileAuthMode
  token: string | null
  headers: Record<string, string>
  targetRuntimes: ProviderProfileTarget[]
  capabilities: ProviderProfileCapabilities
}

export type ProviderDefaultRuntimeConfig = ProviderProfileRuntimeConfig & {
  modelOverride: string | null
}

export type ProviderProfileStorageDatabase = Pick<
  ReturnType<typeof getDatabase>,
  "select"
>

export class ProviderProfileStorageReadError extends Error {
  readonly reason: "default-profile-not-found" | "invalid-profile"
  readonly profileId: string

  constructor(input: {
    reason: "default-profile-not-found" | "invalid-profile"
    profileId: string
    message: string
  }) {
    super(input.message)
    this.name = "ProviderProfileStorageReadError"
    this.reason = input.reason
    this.profileId = input.profileId
  }
}

export type ProviderProfileRuntimeMetadata = {
  id: string
  targetRuntimes: ProviderProfileTarget[]
}

export type ProviderProfileChatBindingMetadata =
  ProviderProfileRuntimeMetadata & {
    defaultModel: string
  }

const storedProviderHeadersSchema = z.record(z.string(), z.string())
const storedProviderTargetsSchema = z.array(providerProfileTargetSchema).min(1)
const storedProviderCapabilitiesSchema =
  providerProfileCapabilitiesSchema.strict()
const storedProviderRequiredTextSchema = z.string().trim().min(1)

function normalizeStoredProviderRequiredText(value: string): string | null {
  const result = storedProviderRequiredTextSchema.safeParse(value)
  return result.success ? result.data : null
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function parseStoredProfileJson<T>(input: {
  profileId: string
  field: string
  value: string | null | undefined
  schema: z.ZodType<T>
}): T {
  let parsed: unknown
  try {
    parsed = JSON.parse(input.value ?? "")
  } catch {
    throw new ProviderProfileStorageReadError({
      reason: "invalid-profile",
      profileId: input.profileId,
      message: `Provider profile ${input.profileId} has invalid ${input.field}.`,
    })
  }
  const result = input.schema.safeParse(parsed)
  if (!result.success) {
    throw new ProviderProfileStorageReadError({
      reason: "invalid-profile",
      profileId: input.profileId,
      message: `Provider profile ${input.profileId} has invalid ${input.field}.`,
    })
  }
  return result.data
}

function parseStoredProfileScalar<T>(input: {
  profileId: string
  field: string
  value: unknown
  schema: z.ZodType<T>
}): T {
  const result = input.schema.safeParse(input.value)
  if (!result.success) {
    throw new ProviderProfileStorageReadError({
      reason: "invalid-profile",
      profileId: input.profileId,
      message: `Provider profile ${input.profileId} has invalid ${input.field}.`,
    })
  }
  return result.data
}

function sanitizeHeaders(
  headers: Record<string, string>,
  options: { strict: boolean },
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(headers || {})) {
    const key = rawKey.trim()
    const value = String(rawValue).trim()
    if (!key || !value) continue

    const normalizedKey = key.toLowerCase()
    const allowed = SAFE_METADATA_HEADER_NAMES.has(normalizedKey)
    const unsafe =
      !allowed ||
      SECRET_HEADER_NAME_REGEX.test(key) ||
      SECRET_HEADER_VALUE_REGEX.test(value)

    if (unsafe) {
      if (options.strict) {
        throw new Error(
          `Provider profile header "${key}" is not allowed. Store credentials in the profile auth mode instead.`,
        )
      }
      continue
    }

    result[key] = value
  }
  return result
}

export function headersForRenderer(
  headers: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.keys(headers || {}).map((key) => [key, "<redacted>"]),
  )
}

export function providerHeadersJsonForSave(
  headers: Record<string, string> | undefined,
  existingHeadersJson?: string | null,
): string {
  if (headers === undefined) {
    return JSON.stringify(
      sanitizeHeaders(parseJson(existingHeadersJson, {}), {
        strict: false,
      }),
    )
  }
  return JSON.stringify(sanitizeHeaders(headers, { strict: true }))
}

function parseTestStatus(
  value: string | null | undefined,
): ProviderProfileTestStatus | null {
  if (!value) return null
  const parsed = providerProfileTestStatusSchema.safeParse(
    parseJson(value, null),
  )
  return parsed.success ? parsed.data : null
}

function isProviderProfileCredentialUsable(
  row: typeof agentProviderProfiles.$inferSelect,
): boolean {
  const authMode = providerProfileAuthModeSchema.parse(row.authMode)
  if (authMode === "none") return true
  if (!row.encryptedToken) return false
  try {
    const token = decryptProviderToken(row.encryptedToken)
    return Boolean(token && normalizeProviderToken(token))
  } catch {
    return false
  }
}

function rowToMetadata(
  row: typeof agentProviderProfiles.$inferSelect,
): ProviderProfileMetadata {
  const name = normalizeStoredProviderRequiredText(row.name)
  const defaultModel = normalizeStoredProviderRequiredText(row.defaultModel)
  return {
    id: row.id,
    name: name ?? row.name.trim(),
    presetId: row.presetId,
    protocol: providerProfileProtocolSchema.parse(row.protocol),
    baseUrl: normalizeProviderBaseUrl(row.baseUrl),
    defaultModel: defaultModel ?? row.defaultModel.trim(),
    authMode: providerProfileAuthModeSchema.parse(row.authMode),
    hasToken: Boolean(row.encryptedToken),
    credentialUsable:
      Boolean(name && defaultModel) && isProviderProfileCredentialUsable(row),
    headers: headersForRenderer(parseJson(row.headersJson, {})),
    targetRuntimes: parseJson(row.targetRuntimesJson, []).filter(
      (target) => providerProfileTargetSchema.safeParse(target).success,
    ),
    capabilities: providerProfileCapabilitiesSchema
      .catch({})
      .parse(parseJson(row.capabilitiesJson, {})),
    lastTestStatus: parseTestStatus(row.lastTestStatusJson),
    createdAt: row.createdAt?.toISOString() ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  }
}

export function listProviderProfiles(): ProviderProfileMetadata[] {
  ensureLegacyProviderProfilesMigrated()
  const db = getDatabase()
  return db.select().from(agentProviderProfiles).all().map(rowToMetadata)
}

export function getProviderProfileMetadata(
  id: string,
): ProviderProfileMetadata | null {
  ensureLegacyProviderProfilesMigrated()
  const db = getDatabase()
  const row = db
    .select()
    .from(agentProviderProfiles)
    .where(eq(agentProviderProfiles.id, id))
    .get()
  return row ? rowToMetadata(row) : null
}

export function getProviderProfileRuntimeMetadataFromDatabase(
  db: ProviderProfileStorageDatabase,
  id: string,
): ProviderProfileRuntimeMetadata | null {
  const row = db
    .select({
      id: agentProviderProfiles.id,
      targetRuntimesJson: agentProviderProfiles.targetRuntimesJson,
    })
    .from(agentProviderProfiles)
    .where(eq(agentProviderProfiles.id, id))
    .get()
  if (!row) return null
  return {
    id: row.id,
    targetRuntimes: parseStoredProfileJson({
      profileId: row.id,
      field: "target runtimes",
      value: row.targetRuntimesJson,
      schema: storedProviderTargetsSchema,
    }),
  }
}

export function getProviderProfileChatBindingMetadataFromDatabase(
  db: ProviderProfileStorageDatabase,
  id: string,
): ProviderProfileChatBindingMetadata | null {
  const row = db
    .select({
      id: agentProviderProfiles.id,
      targetRuntimesJson: agentProviderProfiles.targetRuntimesJson,
      defaultModel: agentProviderProfiles.defaultModel,
    })
    .from(agentProviderProfiles)
    .where(eq(agentProviderProfiles.id, id))
    .get()
  if (!row) return null

  const defaultModel = normalizeStoredProviderRequiredText(row.defaultModel)
  if (!defaultModel) {
    throw new ProviderProfileStorageReadError({
      reason: "invalid-profile",
      profileId: row.id,
      message: `Provider profile ${row.id} has invalid default model.`,
    })
  }
  return {
    id: row.id,
    targetRuntimes: parseStoredProfileJson({
      profileId: row.id,
      field: "target runtimes",
      value: row.targetRuntimesJson,
      schema: storedProviderTargetsSchema,
    }),
    defaultModel,
  }
}

export function getProviderProfileRuntimeConfigFromDatabase(
  db: ProviderProfileStorageDatabase,
  id: string,
): ProviderProfileRuntimeConfig | null {
  const row = db
    .select()
    .from(agentProviderProfiles)
    .where(eq(agentProviderProfiles.id, id))
    .get()
  if (!row) return null

  const authMode = parseStoredProfileScalar({
    profileId: row.id,
    field: "auth mode",
    value: row.authMode,
    schema: providerProfileAuthModeSchema,
  })
  const protocol = parseStoredProfileScalar({
    profileId: row.id,
    field: "protocol",
    value: row.protocol,
    schema: providerProfileProtocolSchema,
  })
  const name = normalizeStoredProviderRequiredText(row.name)
  if (!name) {
    throw new ProviderProfileStorageReadError({
      reason: "invalid-profile",
      profileId: row.id,
      message: `Provider profile ${row.id} has invalid name.`,
    })
  }
  const defaultModel = normalizeStoredProviderRequiredText(row.defaultModel)
  if (!defaultModel) {
    throw new ProviderProfileStorageReadError({
      reason: "invalid-profile",
      profileId: row.id,
      message: `Provider profile ${row.id} has invalid default model.`,
    })
  }

  let baseUrl: string
  try {
    baseUrl = normalizeProviderBaseUrl(row.baseUrl)
  } catch {
    throw new ProviderProfileStorageReadError({
      reason: "invalid-profile",
      profileId: row.id,
      message: `Provider profile ${row.id} has an invalid base URL.`,
    })
  }

  let token: string | null = null
  try {
    const decryptedToken = row.encryptedToken
      ? decryptProviderToken(row.encryptedToken)
      : null
    token = decryptedToken ? normalizeProviderToken(decryptedToken) : null
  } catch {
    throw new ProviderProfileStorageReadError({
      reason: "invalid-profile",
      profileId: row.id,
      message: `Provider profile ${row.id} credential is unavailable.`,
    })
  }
  if (authMode !== "none" && !token) {
    throw new ProviderProfileStorageReadError({
      reason: "invalid-profile",
      profileId: row.id,
      message: `Provider profile ${row.id} token is missing.`,
    })
  }

  let headers: Record<string, string>
  try {
    headers = sanitizeHeaders(
      parseStoredProfileJson({
        profileId: row.id,
        field: "headers",
        value: row.headersJson,
        schema: storedProviderHeadersSchema,
      }),
      { strict: true },
    )
  } catch (error) {
    if (error instanceof ProviderProfileStorageReadError) throw error
    throw new ProviderProfileStorageReadError({
      reason: "invalid-profile",
      profileId: row.id,
      message: `Provider profile ${row.id} has invalid headers.`,
    })
  }
  const targetRuntimes = parseStoredProfileJson({
    profileId: row.id,
    field: "target runtimes",
    value: row.targetRuntimesJson,
    schema: storedProviderTargetsSchema,
  })
  const capabilities = parseStoredProfileJson({
    profileId: row.id,
    field: "capabilities",
    value: row.capabilitiesJson,
    schema: storedProviderCapabilitiesSchema,
  })

  return {
    id: row.id,
    name,
    presetId: row.presetId,
    protocol,
    baseUrl,
    defaultModel,
    authMode,
    token,
    headers,
    targetRuntimes,
    capabilities,
  }
}

export function getProviderDefaultRuntimeConfigFromDatabase(
  db: ProviderProfileStorageDatabase,
  purpose: ProviderProfileDefaultPurpose,
): ProviderDefaultRuntimeConfig | null {
  const row = db
    .select()
    .from(agentProviderDefaults)
    .where(eq(agentProviderDefaults.purpose, purpose))
    .get()
  if (!row?.profileId) return null

  const profileId = row.profileId.trim()
  if (!profileId) return null
  const profile = getProviderProfileRuntimeConfigFromDatabase(db, profileId)
  if (!profile) {
    throw new ProviderProfileStorageReadError({
      reason: "default-profile-not-found",
      profileId,
      message: `Default provider profile ${profileId} was not found.`,
    })
  }
  return {
    ...profile,
    modelOverride: row.modelOverride?.trim() || null,
  }
}

export function getProviderProfileRuntimeConfig(
  id: string,
): ProviderProfileRuntimeConfig | null {
  ensureLegacyProviderProfilesMigrated()
  return getProviderProfileRuntimeConfigFromDatabase(getDatabase(), id)
}

export function getLegacyClaudeProviderProfileId(): string | null {
  ensureLegacyProviderProfilesMigrated()
  return getProviderProfileMetadata(LEGACY_CLAUDE_PROFILE_ID)?.id ?? null
}

export function getProviderProfileTokenRequirement(input: {
  authMode: ProviderProfileAuthMode
  protocol: ProviderProfileProtocol
  baseUrl: string
  token?: string | null
  existingEncryptedToken?: string | null
  existingBaseUrl?: string | null
  existingProtocol?: string | null
  existingAuthMode?: string | null
}): "none" | "missing" | "destination_changed" {
  const authMode = providerProfileAuthModeSchema.parse(input.authMode)
  if (authMode === "none") return "none"
  if (input.token?.trim()) {
    normalizeProviderToken(input.token)
    return "none"
  }

  const protocol = providerProfileProtocolSchema.parse(input.protocol)
  const baseUrl = normalizeProviderBaseUrl(input.baseUrl)
  const destinationChanged = Boolean(
    input.existingEncryptedToken &&
      (input.existingBaseUrl !== baseUrl ||
        input.existingProtocol !== protocol ||
        input.existingAuthMode !== authMode),
  )

  if (destinationChanged) return "destination_changed"
  if (!input.existingEncryptedToken) return "missing"
  requireReusableEncryptedProviderToken(input.existingEncryptedToken)
  return "none"
}

export function saveProviderProfile(input: {
  id?: string
  name: string
  presetId?: string | null
  protocol: ProviderProfileProtocol
  baseUrl: string
  defaultModel: string
  authMode: ProviderProfileAuthMode
  token?: string
  headers?: Record<string, string>
  targetRuntimes: ProviderProfileTarget[]
  capabilities?: ProviderProfileCapabilities
  lastTestStatus?: ProviderProfileTestStatus | null
}): ProviderProfileMetadata {
  const db = getDatabase()
  const id = input.id?.trim() || createId()
  const name = input.name.trim()
  const defaultModel = input.defaultModel.trim()
  if (!name) throw new Error("Provider profile name is required")
  if (!defaultModel) throw new Error("Provider default model is required")
  const existing = id
    ? db
        .select()
        .from(agentProviderProfiles)
        .where(eq(agentProviderProfiles.id, id))
        .get()
    : undefined
  const authMode = providerProfileAuthModeSchema.parse(input.authMode)
  const protocol = providerProfileProtocolSchema.parse(input.protocol)
  const baseUrl = normalizeProviderBaseUrl(input.baseUrl)
  const token = input.token?.trim()
    ? normalizeProviderToken(input.token)
    : undefined
  const tokenRequirement = getProviderProfileTokenRequirement({
    authMode,
    protocol,
    baseUrl,
    token,
    existingEncryptedToken: existing?.encryptedToken,
    existingBaseUrl: existing?.baseUrl,
    existingProtocol: existing?.protocol,
    existingAuthMode: existing?.authMode,
  })

  if (tokenRequirement !== "none") {
    throw new Error(
      tokenRequirement === "destination_changed"
        ? "Token is required when changing provider endpoint, protocol, or auth mode"
        : "Token is required for this provider",
    )
  }

  const encryptedToken = token
    ? encryptProviderToken(token)
    : authMode === "none"
      ? null
      : existing?.encryptedToken
  const targetRuntimes = input.targetRuntimes.filter(
    (target) => providerProfileTargetSchema.safeParse(target).success,
  )
  if (targetRuntimes.length === 0) {
    throw new Error("Select at least one provider target.")
  }

  const values = {
    id,
    name,
    presetId: input.presetId || null,
    protocol,
    baseUrl,
    defaultModel,
    authMode,
    encryptedToken,
    headersJson: providerHeadersJsonForSave(
      input.headers,
      existing?.headersJson,
    ),
    targetRuntimesJson: JSON.stringify(targetRuntimes),
    capabilitiesJson: JSON.stringify(input.capabilities || {}),
    lastTestStatusJson:
      input.lastTestStatus === undefined
        ? (existing?.lastTestStatusJson ?? null)
        : input.lastTestStatus
          ? JSON.stringify(input.lastTestStatus)
          : null,
    createdAt: existing?.createdAt ?? new Date(),
    updatedAt: new Date(),
  }

  db.transaction((tx) => {
    if (existing) {
      tx.update(agentProviderProfiles)
        .set(values)
        .where(eq(agentProviderProfiles.id, id))
        .run()
    } else {
      tx.insert(agentProviderProfiles).values(values).run()
    }

    for (const purpose of providerProfileDefaultPurposes) {
      if (providerProfileSupportsDefaultPurpose(targetRuntimes, purpose)) {
        continue
      }
      const defaultRow = tx
        .select()
        .from(agentProviderDefaults)
        .where(eq(agentProviderDefaults.purpose, purpose))
        .get()
      if (defaultRow?.profileId !== id) continue
      tx.update(agentProviderDefaults)
        .set({ profileId: null, modelOverride: null, updatedAt: new Date() })
        .where(eq(agentProviderDefaults.purpose, purpose))
        .run()
    }
  })

  const saved = getProviderProfileMetadata(id)
  if (!saved) throw new Error("Failed to read saved provider profile")
  return saved
}

export function deleteProviderProfile(id: string): void {
  const db = getDatabase()
  db.update(agentProviderDefaults)
    .set({
      profileId: null,
      modelOverride: null,
      updatedAt: new Date(),
    })
    .where(eq(agentProviderDefaults.profileId, id))
    .run()
  db.delete(agentProviderProfiles).where(eq(agentProviderProfiles.id, id)).run()
}

export function setProviderDefault(input: {
  purpose: ProviderProfileDefaultPurpose
  profileId: string | null
  modelOverride?: string | null
}): void {
  const db = getDatabase()
  const purpose = providerProfileDefaultPurposeSchema.parse(input.purpose)
  const profileId = input.profileId?.trim() || null

  db.transaction((tx) => {
    if (profileId) {
      const profile = getProviderProfileRuntimeMetadataFromDatabase(
        tx,
        profileId,
      )
      if (!profile) {
        throw new Error(`Provider profile ${profileId} was not found.`)
      }
      if (
        !providerProfileSupportsDefaultPurpose(profile.targetRuntimes, purpose)
      ) {
        throw new Error(
          `Provider profile ${profileId} does not support ${purpose}.`,
        )
      }
    }

    const existing = tx
      .select()
      .from(agentProviderDefaults)
      .where(eq(agentProviderDefaults.purpose, purpose))
      .get()
    const values = {
      purpose,
      profileId,
      modelOverride: profileId ? input.modelOverride?.trim() || null : null,
      updatedAt: new Date(),
    }

    if (existing) {
      tx.update(agentProviderDefaults)
        .set(values)
        .where(eq(agentProviderDefaults.purpose, purpose))
        .run()
    } else {
      tx.insert(agentProviderDefaults).values(values).run()
    }
  })
}

export function getProviderDefaults(): Record<
  ProviderProfileDefaultPurpose,
  { profileId: string | null; modelOverride: string | null }
> {
  const db = getDatabase()
  const rows = db.select().from(agentProviderDefaults).all()
  const defaults = Object.fromEntries(
    providerProfileDefaultPurposes.map((purpose) => [
      purpose,
      { profileId: null, modelOverride: null },
    ]),
  ) as Record<
    ProviderProfileDefaultPurpose,
    { profileId: string | null; modelOverride: string | null }
  >

  for (const row of rows) {
    const parsed = providerProfileDefaultPurposeSchema.safeParse(row.purpose)
    if (!parsed.success) continue
    defaults[parsed.data] = {
      profileId: row.profileId,
      modelOverride: row.modelOverride,
    }
  }
  return defaults
}

export function getProviderDefaultRuntimeConfig(
  purpose: ProviderProfileDefaultPurpose,
): ProviderDefaultRuntimeConfig | null {
  ensureLegacyProviderProfilesMigrated()
  return getProviderDefaultRuntimeConfigFromDatabase(getDatabase(), purpose)
}

function insertLegacyProfile(input: {
  id: string
  name: string
  presetId: string
  protocol: ProviderProfileProtocol
  baseUrl: string
  model: string
  authMode: ProviderProfileAuthMode
  token: string
  targets: ProviderProfileTarget[]
}): void {
  const db = getDatabase()
  const existing = db
    .select()
    .from(agentProviderProfiles)
    .where(eq(agentProviderProfiles.id, input.id))
    .get()
  if (existing) return

  db.insert(agentProviderProfiles)
    .values({
      id: input.id,
      name: input.name,
      presetId: input.presetId,
      protocol: input.protocol,
      baseUrl: normalizeProviderBaseUrl(input.baseUrl),
      defaultModel: input.model,
      authMode: input.authMode,
      encryptedToken: encryptProviderToken(normalizeProviderToken(input.token)),
      headersJson: "{}",
      targetRuntimesJson: JSON.stringify(input.targets),
      capabilitiesJson: JSON.stringify({
        claude: input.targets.includes("claude"),
        helpers: input.targets.includes("helpers"),
        streaming: true,
      }),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run()
}

let legacyMigrationAttempted = false

export function ensureLegacyProviderProfilesMigrated(): void {
  if (legacyMigrationAttempted) return
  legacyMigrationAttempted = true

  try {
    const claude = getActiveClaudeProviderConfig()
    if (claude) {
      insertLegacyProfile({
        id: LEGACY_CLAUDE_PROFILE_ID,
        name: "Legacy Claude-compatible Provider",
        presetId: "legacy-claude-provider",
        protocol: "anthropic",
        baseUrl: claude.baseUrl,
        model: claude.model,
        authMode: claude.authMode === "api_key" ? "x-api-key" : "bearer",
        token: claude.token,
        targets: ["claude"],
      })
    }

    for (const purpose of ["sub_chat_title", "commit_message"] as const) {
      const helper = getActiveLocalApiProviderConfig(purpose)
      if (!helper) continue
      insertLegacyProfile({
        id: `legacy-${purpose}`,
        name:
          purpose === "sub_chat_title"
            ? "Legacy Sub-chat Title Provider"
            : "Legacy Commit Message Provider",
        presetId: "legacy-helper-provider",
        protocol: "openai-chat",
        baseUrl: helper.baseUrl,
        model: helper.model,
        authMode: "bearer",
        token: helper.token,
        targets: ["helpers"],
      })
      setProviderDefault({
        purpose,
        profileId: `legacy-${purpose}`,
      })
    }
  } catch (error) {
    console.warn("[ProviderProfiles] Legacy migration skipped:", error)
  }
}
