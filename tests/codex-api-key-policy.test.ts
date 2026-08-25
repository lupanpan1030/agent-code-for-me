import { describe, expect, test } from "bun:test"
import { normalizeCodexApiKey } from "../src/shared/codex-api-key"
import {
  MAX_HEADER_SAFE_CREDENTIAL_LENGTH,
  MIN_EXACT_SECRET_HINT_LENGTH,
} from "../src/shared/secret-redaction-policy"

describe("Codex API key policy", () => {
  test("uses the canonical exact-redaction length floor", () => {
    expect(normalizeCodexApiKey("sk-a")).toBeNull()

    const shortestProtectedKey = `sk-${"a".repeat(
      MIN_EXACT_SECRET_HINT_LENGTH - 3,
    )}`
    expect(shortestProtectedKey).toHaveLength(MIN_EXACT_SECRET_HINT_LENGTH)
    expect(normalizeCodexApiKey(shortestProtectedKey)).toBe(
      shortestProtectedKey,
    )
  })

  test("rejects oversized API keys through the shared header-safe policy", () => {
    expect(
      normalizeCodexApiKey(
        `sk-${"a".repeat(MAX_HEADER_SAFE_CREDENTIAL_LENGTH)}`,
      ),
    ).toBeNull()
  })
})
