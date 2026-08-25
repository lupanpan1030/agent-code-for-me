/**
 * Exact-secret hints shorter than this are intentionally ignored so ordinary
 * output is not corrupted by short, common strings. Every credential accepted
 * by Locus must therefore meet this same floor.
 */
export const MIN_EXACT_SECRET_HINT_LENGTH = 8

/**
 * Credentials are copied into request headers and retained as runtime secret
 * hints. Keep one bounded, header-safe acceptance policy for every provider so
 * oversized or unredactable values never reach either boundary.
 */
export const MAX_HEADER_SAFE_CREDENTIAL_LENGTH = 16 * 1024

const ZERO_WIDTH_CREDENTIAL_CHARACTERS = /[\u200B-\u200D\uFEFF]/g
const HEADER_SAFE_CREDENTIAL = /^[\x21-\x7E]+$/

export function containsAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index)
    if (codePoint <= 31 || codePoint === 127) return true
  }
  return false
}

/**
 * Normalize a credential for use in an HTTP header and as an exact-redaction
 * hint. Invalid input returns null so parsers and readiness checks can fail
 * closed without including credential content in an error.
 */
export function normalizeHeaderSafeCredential(value: unknown): string | null {
  if (typeof value !== "string" || containsAsciiControlCharacter(value)) {
    return null
  }

  const normalized = value.trim().replace(ZERO_WIDTH_CREDENTIAL_CHARACTERS, "")
  if (
    normalized.length < MIN_EXACT_SECRET_HINT_LENGTH ||
    normalized.length > MAX_HEADER_SAFE_CREDENTIAL_LENGTH ||
    !HEADER_SAFE_CREDENTIAL.test(normalized)
  ) {
    return null
  }

  return normalized
}

/**
 * Shorter than every accepted exact-secret hint, so the replacement can never
 * contain a protected credential (including as a substring). Keeping this
 * invariant here prevents a successful replacement from re-emitting a hint.
 */
export const EXACT_SECRET_REDACTION_MARKER = "<mask>"

/**
 * Canonicalizes exact-secret hints longest-first. The ordering is security
 * relevant: replacing a shorter prefix first can expose the unmatched suffix
 * of a longer credential.
 */
export function normalizeExactSecretHints(
  secretHints: readonly (string | null | undefined)[] | undefined,
  minimumLength = MIN_EXACT_SECRET_HINT_LENGTH,
): string[] {
  return [
    ...new Set(
      (secretHints ?? [])
        .map((hint) => hint?.trim() ?? "")
        .filter((hint) => hint.length >= minimumLength),
    ),
  ].sort((left, right) => right.length - left.length)
}

/** Shared literal replacement owner for stateless exact-secret redaction. */
export function redactExactSecretValues(
  value: string,
  secretHints: readonly (string | null | undefined)[] | undefined,
  options: { minimumLength?: number; marker?: string } = {},
): { value: string; applied: boolean; redactionCount: number } {
  const minimumLength = options.minimumLength ?? MIN_EXACT_SECRET_HINT_LENGTH
  const marker = options.marker ?? EXACT_SECRET_REDACTION_MARKER
  if (!Number.isInteger(minimumLength) || minimumLength < 1) {
    throw new Error("Exact-secret minimum length must be a positive integer")
  }
  if (marker.length >= minimumLength) {
    throw new Error(
      "Exact-secret replacement marker must be shorter than protected hints",
    )
  }
  let redacted = value
  let redactionCount = 0
  const hints = normalizeExactSecretHints(secretHints, minimumLength)
  let replacedInPass = false
  do {
    replacedInPass = false
    for (const hint of hints) {
      if (!redacted.includes(hint)) continue
      const fragments = redacted.split(hint)
      redactionCount += fragments.length - 1
      redacted = fragments.join(marker)
      replacedInPass = true
    }
    // Replacing a hint strictly shortens the string because marker.length is
    // below minimumLength. Repeating to a fixed point is therefore bounded and
    // removes a different hint that a marker plus surrounding text may create.
  } while (replacedInPass)
  return {
    value: redacted,
    applied: redactionCount > 0,
    redactionCount,
  }
}
