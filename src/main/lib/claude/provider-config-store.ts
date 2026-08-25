import { eq } from "drizzle-orm"
import { z } from "zod"
import { claudeProviderConfig, getDatabase } from "../db"
import {
  decryptProviderToken,
  encryptProviderToken,
  normalizeProviderBaseUrl,
  normalizeProviderToken,
  requireReusableEncryptedProviderToken,
} from "../provider-token"
import { isSecureStorageAvailable } from "../secure-storage"
import type {
  ClaudeProviderAuthMode,
  ClaudeProviderRuntimeConfig,
} from "./provider-runtime-config"

const CONFIG_ID = "default"

export const claudeProviderAuthModeSchema = z.enum(["api_key", "auth_token"])
export type { ClaudeProviderAuthMode, ClaudeProviderRuntimeConfig }

export type ClaudeProviderMetadata = {
  id: string
  model: string
  baseUrl: string
  authMode: ClaudeProviderAuthMode
  hasToken: boolean
  credentialUsable: boolean
  createdAt: string | null
  updatedAt: string | null
}

function isStoredCredentialUsable(encryptedToken: string): boolean {
  try {
    const token = decryptProviderToken(encryptedToken)
    return Boolean(token && normalizeProviderToken(token))
  } catch {
    return false
  }
}

export type ClaudeProviderConfigResponse = {
  config: ClaudeProviderMetadata | null
  encryptionAvailable: boolean
}

export type SaveClaudeProviderConfigInput = {
  model: string
  baseUrl: string
  authMode: ClaudeProviderAuthMode
  token?: string
}

export type ImportLegacyClaudeProviderConfigResult = {
  migrated: boolean
  reason: "secure_config_exists" | null
  encryptionAvailable: boolean
}

function rowToMetadata(
  row: typeof claudeProviderConfig.$inferSelect,
): ClaudeProviderMetadata {
  const model = row.model.trim()
  return {
    id: row.id,
    model,
    baseUrl: normalizeProviderBaseUrl(row.baseUrl),
    authMode: claudeProviderAuthModeSchema.parse(row.authMode),
    hasToken: Boolean(row.encryptedToken),
    credentialUsable:
      Boolean(model) && isStoredCredentialUsable(row.encryptedToken),
    createdAt: row.createdAt?.toISOString() ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  }
}

function getStoredProviderRow() {
  const db = getDatabase()
  return db
    .select()
    .from(claudeProviderConfig)
    .where(eq(claudeProviderConfig.id, CONFIG_ID))
    .get()
}

export function getClaudeProviderConfigMetadata(): ClaudeProviderConfigResponse {
  const row = getStoredProviderRow()
  return {
    config: row ? rowToMetadata(row) : null,
    encryptionAvailable:
      Boolean(row?.encryptedToken) && isSecureStorageAvailable(),
  }
}

export function getActiveClaudeProviderConfig():
  | ClaudeProviderRuntimeConfig
  | undefined {
  const row = getStoredProviderRow()
  if (!row) return undefined
  const model = row.model.trim()
  if (!model || !row.encryptedToken || !row.baseUrl) {
    return undefined
  }

  const token = decryptProviderToken(row.encryptedToken)
  if (!token) return undefined

  return {
    model,
    baseUrl: normalizeProviderBaseUrl(row.baseUrl),
    authMode: claudeProviderAuthModeSchema.parse(row.authMode),
    token: normalizeProviderToken(token),
  }
}

export function saveClaudeProviderConfig(
  input: SaveClaudeProviderConfigInput,
): ClaudeProviderConfigResponse {
  const model = input.model.trim()
  const baseUrl = normalizeProviderBaseUrl(input.baseUrl)
  const authMode = claudeProviderAuthModeSchema.parse(input.authMode)
  const token = input.token ? normalizeProviderToken(input.token) : undefined
  const existing = getStoredProviderRow()

  if (!model || !baseUrl) {
    throw new Error("Model and base URL are required")
  }

  if (!token && !existing?.encryptedToken) {
    throw new Error("Token is required for a new provider config")
  }

  if (!token && existing?.encryptedToken) {
    const existingBaseUrl = normalizeProviderBaseUrl(existing.baseUrl)
    const existingAuthMode = claudeProviderAuthModeSchema.safeParse(
      existing.authMode,
    )
    if (
      existingBaseUrl !== baseUrl ||
      !existingAuthMode.success ||
      existingAuthMode.data !== authMode
    ) {
      throw new Error(
        "Token is required when changing provider endpoint or auth mode",
      )
    }
  }

  const encryptedToken = token
    ? encryptProviderToken(token)
    : requireReusableEncryptedProviderToken(existing?.encryptedToken)

  const db = getDatabase()
  db.insert(claudeProviderConfig)
    .values({
      id: CONFIG_ID,
      model,
      baseUrl,
      authMode,
      encryptedToken,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: claudeProviderConfig.id,
      set: {
        model,
        baseUrl,
        authMode,
        encryptedToken,
        updatedAt: new Date(),
      },
    })
    .run()

  const row = getStoredProviderRow()
  return {
    config: row ? rowToMetadata(row) : null,
    encryptionAvailable: isSecureStorageAvailable(),
  }
}

export function clearClaudeProviderConfig(): { success: true } {
  const db = getDatabase()
  db.delete(claudeProviderConfig)
    .where(eq(claudeProviderConfig.id, CONFIG_ID))
    .run()

  return { success: true }
}

export function importLegacyClaudeProviderConfig(
  input: SaveClaudeProviderConfigInput & { token: string },
): ImportLegacyClaudeProviderConfigResult {
  const existing = getStoredProviderRow()
  if (!existing) {
    const model = input.model.trim()
    if (!model) {
      throw new Error("Model and base URL are required")
    }
    const authMode = claudeProviderAuthModeSchema.parse(input.authMode)
    const db = getDatabase()
    db.insert(claudeProviderConfig)
      .values({
        id: CONFIG_ID,
        model,
        baseUrl: normalizeProviderBaseUrl(input.baseUrl),
        authMode,
        encryptedToken: encryptProviderToken(
          normalizeProviderToken(input.token),
        ),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run()
  }

  return {
    migrated: !existing,
    reason: existing ? "secure_config_exists" : null,
    encryptionAvailable: isSecureStorageAvailable(),
  }
}
