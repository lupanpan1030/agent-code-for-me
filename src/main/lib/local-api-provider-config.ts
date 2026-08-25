import { eq } from "drizzle-orm"
import { z } from "zod"
import { getDatabase, localApiProviderConfigs } from "./db"
import {
  decryptProviderToken,
  normalizeProviderBaseUrl,
  normalizeProviderToken,
  requireReusableEncryptedProviderToken,
} from "./provider-token"

export const localApiProviderPurposeSchema = z.enum([
  "sub_chat_title",
  "commit_message",
  "voice_transcription",
])
export type LocalApiProviderPurpose = z.infer<
  typeof localApiProviderPurposeSchema
>

export type LocalApiProviderRuntimeConfig = {
  purpose: LocalApiProviderPurpose
  model: string
  baseUrl: string
  token: string
}

type LocalApiProviderMetadata = {
  purpose: LocalApiProviderPurpose
  model: string
  baseUrl: string
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

export function getLocalApiProviderTokenRequirement(input: {
  baseUrl: string
  token?: string | null
  existingEncryptedToken?: string | null
  existingBaseUrl?: string | null
}): "none" | "missing" | "destination_changed" {
  if (input.token?.trim()) {
    normalizeProviderToken(input.token)
    return "none"
  }

  const baseUrl = normalizeProviderBaseUrl(input.baseUrl)
  const destinationChanged = Boolean(
    input.existingEncryptedToken && input.existingBaseUrl !== baseUrl,
  )

  if (destinationChanged) return "destination_changed"
  if (!input.existingEncryptedToken) return "missing"
  requireReusableEncryptedProviderToken(input.existingEncryptedToken)
  return "none"
}

export function getStoredProviderRow(purpose: LocalApiProviderPurpose) {
  const db = getDatabase()
  return db
    .select()
    .from(localApiProviderConfigs)
    .where(eq(localApiProviderConfigs.id, purpose))
    .get()
}

export function rowToMetadata(
  row: typeof localApiProviderConfigs.$inferSelect,
): LocalApiProviderMetadata {
  const model = row.model.trim()
  return {
    purpose: localApiProviderPurposeSchema.parse(row.id),
    model,
    baseUrl: normalizeProviderBaseUrl(row.baseUrl),
    hasToken: Boolean(row.encryptedToken),
    credentialUsable:
      Boolean(model) && isStoredCredentialUsable(row.encryptedToken),
    createdAt: row.createdAt?.toISOString() ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  }
}

export function getActiveLocalApiProviderConfig(
  purpose: LocalApiProviderPurpose,
): LocalApiProviderRuntimeConfig | undefined {
  const row = getStoredProviderRow(purpose)
  if (!row) return undefined
  const model = row.model.trim()
  if (!model || !row.encryptedToken || !row.baseUrl) {
    return undefined
  }

  const token = decryptProviderToken(row.encryptedToken)
  if (!token) return undefined

  return {
    purpose,
    model,
    baseUrl: normalizeProviderBaseUrl(row.baseUrl),
    token: normalizeProviderToken(token),
  }
}
