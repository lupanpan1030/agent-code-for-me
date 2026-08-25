import { normalizeHeaderSafeCredential } from "./secret-redaction-policy"

export const LEGACY_CODEX_API_KEY_STORAGE_KEY = "onboarding:codex-api-key"

export function normalizeCodexApiKey(apiKey: string): string | null {
  const normalized = normalizeHeaderSafeCredential(apiKey)
  return normalized?.startsWith("sk-") ? normalized : null
}
