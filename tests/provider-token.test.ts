import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  MAX_PROVIDER_TOKEN_LENGTH,
  MIN_PROVIDER_TOKEN_LENGTH,
  normalizeProviderBaseUrl,
  normalizeProviderToken,
  requireReusableEncryptedProviderToken,
} from "../src/main/lib/provider-token"
import { setElectronSafeStorageForTest } from "../src/main/lib/secure-storage"
import { EXACT_SECRET_REDACTION_MARKER } from "../src/shared/secret-redaction-policy"

function storedEncryptedToken(token: string): string {
  return Buffer.from(`encrypted:${token}`, "utf-8").toString("base64")
}

describe("provider input normalization", () => {
  beforeEach(() => {
    setElectronSafeStorageForTest({
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf-8"),
      decryptString(value) {
        const raw = value.toString("utf-8")
        return raw.startsWith("encrypted:")
          ? raw.slice("encrypted:".length)
          : ""
      },
    })
  })

  afterEach(() => {
    setElectronSafeStorageForTest(null)
  })

  test("rejects literal and percent-encoded URL credentials", () => {
    for (const baseUrl of [
      "https://user@example.com/v1",
      "https://user:password@example.com/v1",
      "https://us%65r:p%40ssword@example.com/v1",
      "https://%75ser@example.com/v1",
      "https://@example.com/v1",
      "https://:@example.com/v1",
    ]) {
      expect(() => normalizeProviderBaseUrl(baseUrl)).toThrow(
        "must not include a username or password",
      )
    }

    expect(normalizeProviderBaseUrl("https://example.com/path@version")).toBe(
      "https://example.com/path@version",
    )
  })

  test("rejects query parameters and fragments in provider base URLs", () => {
    expect(() =>
      normalizeProviderBaseUrl("https://api.example.com/v1?api_key=credential"),
    ).toThrow("must not include query parameters")
    expect(() =>
      normalizeProviderBaseUrl("https://api.example.com/v1#credential"),
    ).toThrow("must not include a fragment")
    expect(() =>
      normalizeProviderBaseUrl("https://api.example.com/v1?"),
    ).toThrow("must not include query parameters")
    expect(() =>
      normalizeProviderBaseUrl("https://api.example.com/v1#"),
    ).toThrow("must not include a fragment")
  })

  test("rejects URL control characters and returns the parsed canonical URL", () => {
    for (const control of ["\n", "\r", "\t", "\u007F"]) {
      expect(() =>
        normalizeProviderBaseUrl(`https://api.example.com/v1${control}suffix`),
      ).toThrow("must not contain control characters")
    }

    expect(normalizeProviderBaseUrl("HTTPS://API.EXAMPLE.COM/a b///")).toBe(
      "https://api.example.com/a%20b",
    )
  })

  test("accepts the exact-redaction token floor and rejects shorter tokens", () => {
    const shortestProtectedToken = "t".repeat(MIN_PROVIDER_TOKEN_LENGTH)

    expect(normalizeProviderToken(` \u200B${shortestProtectedToken} `)).toBe(
      shortestProtectedToken,
    )
    expect(() =>
      normalizeProviderToken("t".repeat(MIN_PROVIDER_TOKEN_LENGTH - 1)),
    ).toThrow(`${MIN_PROVIDER_TOKEN_LENGTH}-${MAX_PROVIDER_TOKEN_LENGTH}`)
    expect(EXACT_SECRET_REDACTION_MARKER.length).toBeLessThan(
      MIN_PROVIDER_TOKEN_LENGTH,
    )
    expect(() => normalizeProviderToken(EXACT_SECRET_REDACTION_MARKER)).toThrow(
      `${MIN_PROVIDER_TOKEN_LENGTH}-${MAX_PROVIDER_TOKEN_LENGTH}`,
    )
    expect(() =>
      normalizeProviderToken("t".repeat(MAX_PROVIDER_TOKEN_LENGTH + 1)),
    ).toThrow(`${MIN_PROVIDER_TOKEN_LENGTH}-${MAX_PROVIDER_TOKEN_LENGTH}`)
  })

  test("reuses only decryptable stored credentials that still satisfy token policy", () => {
    const valid = storedEncryptedToken("token123")

    expect(requireReusableEncryptedProviderToken(valid)).toBe(valid)
    expect(() =>
      requireReusableEncryptedProviderToken(storedEncryptedToken("1234567")),
    ).toThrow("Re-enter the token before saving")
    expect(() =>
      requireReusableEncryptedProviderToken(
        Buffer.from("not-encrypted", "utf-8").toString("base64"),
      ),
    ).toThrow("Re-enter the token before saving")
  })
})
