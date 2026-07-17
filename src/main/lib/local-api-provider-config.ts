import { eq } from "drizzle-orm"
import { z } from "zod"
import { getDatabase, localApiProviderConfigs } from "./db"
import {
  decryptProviderToken,
  normalizeProviderBaseUrl,
  normalizeProviderToken,
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
  createdAt: string | null
  updatedAt: string | null
}

export function getLocalApiProviderTokenRequirement(input: {
  baseUrl: string
  token?: string | null
  existingEncryptedToken?: string | null
  existingBaseUrl?: string | null
}): "none" | "missing" | "destination_changed" {
  if (input.token?.trim()) return "none"

  const baseUrl = normalizeProviderBaseUrl(input.baseUrl)
  const destinationChanged = Boolean(
    input.existingEncryptedToken && input.existingBaseUrl !== baseUrl,
  )

  if (destinationChanged) return "destination_changed"
  if (!input.existingEncryptedToken) return "missing"
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
  return {
    purpose: localApiProviderPurposeSchema.parse(row.id),
    model: row.model,
    baseUrl: row.baseUrl,
    hasToken: Boolean(row.encryptedToken),
    createdAt: row.createdAt?.toISOString() ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  }
}

export function getActiveLocalApiProviderConfig(
  purpose: LocalApiProviderPurpose,
): LocalApiProviderRuntimeConfig | undefined {
  const row = getStoredProviderRow(purpose)
  if (!row?.encryptedToken || !row.model || !row.baseUrl) {
    return undefined
  }

  const token = decryptProviderToken(row.encryptedToken)
  if (!token) return undefined

  return {
    purpose,
    model: row.model,
    baseUrl: row.baseUrl,
    token: normalizeProviderToken(token),
  }
}
