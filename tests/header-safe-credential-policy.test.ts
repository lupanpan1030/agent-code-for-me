import { describe, expect, test } from "bun:test"
import {
  MAX_HEADER_SAFE_CREDENTIAL_LENGTH,
  MIN_EXACT_SECRET_HINT_LENGTH,
  normalizeHeaderSafeCredential,
} from "../src/shared/secret-redaction-policy"

describe("header-safe credential policy", () => {
  test("normalizes credentials at the exact-redaction floor", () => {
    expect(
      normalizeHeaderSafeCredential(
        `  abc\u200Bdef${"g".repeat(MIN_EXACT_SECRET_HINT_LENGTH - 6)}  `,
      ),
    ).toBe("abcdefgg")
    expect(
      normalizeHeaderSafeCredential(
        "x".repeat(MAX_HEADER_SAFE_CREDENTIAL_LENGTH),
      ),
    ).toHaveLength(MAX_HEADER_SAFE_CREDENTIAL_LENGTH)
  })

  test("rejects short, oversized, control-bearing, spaced, and non-ASCII values", () => {
    expect(
      normalizeHeaderSafeCredential(
        "x".repeat(MIN_EXACT_SECRET_HINT_LENGTH - 1),
      ),
    ).toBeNull()
    expect(
      normalizeHeaderSafeCredential(
        "x".repeat(MAX_HEADER_SAFE_CREDENTIAL_LENGTH + 1),
      ),
    ).toBeNull()
    expect(normalizeHeaderSafeCredential("token\nvalue")).toBeNull()
    expect(normalizeHeaderSafeCredential("token value")).toBeNull()
    expect(normalizeHeaderSafeCredential("token-välue")).toBeNull()
    expect(normalizeHeaderSafeCredential(null)).toBeNull()
  })
})
