/**
 * Shared provider-token helpers.
 *
 * Normalization and encryption of provider credentials used to be duplicated
 * verbatim across the Claude provider store, the local-API provider config, and
 * the runtime-neutral provider profiles. They are consolidated here so the
 * token-validation rules (zero-width stripping, header-safety) and the encryption
 * wrappers have a single source of truth.
 */

import {
  containsAsciiControlCharacter,
  MAX_HEADER_SAFE_CREDENTIAL_LENGTH,
  MIN_EXACT_SECRET_HINT_LENGTH,
  normalizeHeaderSafeCredential,
} from "../../shared/secret-redaction-policy"
import {
  decryptStringFromStorage,
  encryptStringForStorage,
} from "./secure-storage"
// Runtime exact-secret redaction deliberately ignores shorter hints to avoid
// corrupting ordinary output. Provider credentials must meet the same floor.
export const MIN_PROVIDER_TOKEN_LENGTH = MIN_EXACT_SECRET_HINT_LENGTH
export const MAX_PROVIDER_TOKEN_LENGTH = MAX_HEADER_SAFE_CREDENTIAL_LENGTH
export const STORED_PROVIDER_TOKEN_REENTRY_MESSAGE =
  "Stored provider credential is unavailable or invalid. Re-enter the token before saving."

/** Trim and drop trailing slashes from a provider base URL. */
export function normalizeProviderBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "")
  if (!normalized) return ""
  if (normalized.includes("\0")) {
    throw new Error("Provider base URL must not contain null bytes")
  }
  if (containsAsciiControlCharacter(normalized)) {
    throw new Error("Provider base URL must not contain control characters")
  }

  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error("Provider base URL must be a valid URL")
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Provider base URL must use http or https")
  }
  if (
    parsed.username ||
    parsed.password ||
    /^https?:\/\/[^/?#]*@/i.test(normalized)
  ) {
    throw new Error("Provider base URL must not include a username or password")
  }
  if (parsed.search || normalized.includes("?")) {
    throw new Error("Provider base URL must not include query parameters")
  }
  if (parsed.hash || normalized.includes("#")) {
    throw new Error("Provider base URL must not include a fragment")
  }

  // Return the URL parser's canonical form rather than the raw validated
  // string. WHATWG parsing may otherwise silently discard tabs/newlines or
  // normalize spaces while callers continue using the unsafe original text.
  return parsed.toString().replace(/\/+$/, "")
}

/**
 * Trim, strip zero-width characters, and validate that a provider token is
 * long enough for exact-secret redaction and header-safe. Throws if the token
 * is empty, too short, or contains unsupported characters.
 */
export function normalizeProviderToken(token: string): string {
  if (!token.trim()) {
    throw new Error("Token is required")
  }
  const normalized = normalizeHeaderSafeCredential(token)
  if (!normalized)
    throw new Error(
      `Token must be ${MIN_PROVIDER_TOKEN_LENGTH}-${MAX_PROVIDER_TOKEN_LENGTH} printable ASCII characters without spaces`,
    )
  return normalized
}

/** Encrypt a provider token for at-rest storage. */
export function encryptProviderToken(token: string): string {
  return encryptStringForStorage(token)
}

/** Decrypt a stored provider token, or null when secure storage is unavailable. */
export function decryptProviderToken(encrypted: string): string | null {
  return decryptStringFromStorage(encrypted)
}

/**
 * Return an existing encrypted credential only after proving that secure
 * storage can decrypt it and the plaintext still satisfies current token
 * policy. This intentionally does not expose the plaintext to callers that
 * only need to retain the existing ciphertext during an update.
 */
export function requireReusableEncryptedProviderToken(
  encrypted: string | null | undefined,
): string {
  try {
    if (encrypted) {
      const decrypted = decryptProviderToken(encrypted)
      if (decrypted) {
        normalizeProviderToken(decrypted)
        return encrypted
      }
    }
  } catch {
    // Always replace decrypt/validation details with the static re-entry error.
  }

  throw new Error(STORED_PROVIDER_TOKEN_REENTRY_MESSAGE)
}
