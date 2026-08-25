import { describe, expect, test } from "bun:test"
import {
  type ClaudeCodeCredentialEnvelope,
  createClaudeCodeCredentialEnvelope,
  parseClaudeCodeCredentialPayload,
} from "../src/shared/claude-code-credential-envelope"
import { MAX_HEADER_SAFE_CREDENTIAL_LENGTH } from "../src/shared/secret-redaction-policy"

describe("Claude Code credential envelope", () => {
  test("parses versioned refreshable envelopes", () => {
    const payload: ClaudeCodeCredentialEnvelope = {
      version: 1,
      kind: "claude_code_oauth",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: 1779081790895,
      scopes: ["user:inference"],
      source: "macos_keychain",
      importedAt: "2026-05-18T05:23:10.895Z",
      updatedAt: "2026-05-18T05:23:10.895Z",
    }

    const parsed = parseClaudeCodeCredentialPayload(JSON.stringify(payload))

    expect(parsed?.storageFormat).toBe("envelope")
    expect(parsed?.envelope.refreshToken).toBe("refresh-token")
    expect(parsed?.envelope.source).toBe("macos_keychain")
  })

  test("parses legacy encrypted rows as non-refreshable access tokens", () => {
    const parsed = parseClaudeCodeCredentialPayload(" legacy-access-token ")

    expect(parsed?.storageFormat).toBe("legacy_plain_token")
    expect(parsed?.envelope.accessToken).toBe("legacy-access-token")
    expect(parsed?.envelope.source).toBe("legacy_db")
    expect(parsed?.envelope.refreshToken).toBeUndefined()
    expect(parsed?.envelope.importedAt).toBe("1970-01-01T00:00:00.000Z")
  })

  test("rejects empty credential payloads", () => {
    expect(parseClaudeCodeCredentialPayload("   ")).toBeNull()
  })

  test("fails closed for credentials outside the shared header-safe policy", () => {
    const timestamp = "2026-05-18T05:23:10.895Z"
    const envelope = (accessToken: string, refreshToken?: string) =>
      JSON.stringify({
        version: 1,
        kind: "claude_code_oauth",
        accessToken,
        ...(refreshToken !== undefined && { refreshToken }),
        source: "manual",
        importedAt: timestamp,
        updatedAt: timestamp,
      })

    expect(parseClaudeCodeCredentialPayload("short")).toBeNull()
    expect(
      parseClaudeCodeCredentialPayload(
        "x".repeat(MAX_HEADER_SAFE_CREDENTIAL_LENGTH + 1),
      ),
    ).toBeNull()
    expect(parseClaudeCodeCredentialPayload("token-with\ncontrol")).toBeNull()
    expect(parseClaudeCodeCredentialPayload("\nvalid-access-token")).toBeNull()
    expect(parseClaudeCodeCredentialPayload(envelope("short"))).toBeNull()
    expect(
      parseClaudeCodeCredentialPayload(
        envelope("valid-access-token", "bad\nrefresh"),
      ),
    ).toBeNull()
    expect(
      parseClaudeCodeCredentialPayload(
        JSON.stringify({ accessToken: "valid-access-token" }),
      ),
    ).toBeNull()

    expect(() =>
      createClaudeCodeCredentialEnvelope({ accessToken: "short" }),
    ).toThrow("access credential is invalid")
    expect(() =>
      createClaudeCodeCredentialEnvelope({
        accessToken: "valid-access-token",
        refreshToken: "bad\nrefresh",
      }),
    ).toThrow("refresh credential is invalid")
  })

  test("creates envelopes with default source and preserves original import time", () => {
    const previous: ClaudeCodeCredentialEnvelope = {
      version: 1,
      kind: "claude_code_oauth",
      accessToken: "old-access-token",
      source: "credentials_file",
      importedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }

    const created = createClaudeCodeCredentialEnvelope(
      {
        accessToken: "new-access-token",
        refreshToken: "refresh-token",
        expiresAt: 1779081790895,
      },
      undefined,
      previous,
    )

    expect(created.source).toBe("manual")
    expect(created.importedAt).toBe(previous.importedAt)
    expect(created.updatedAt).not.toBe(previous.updatedAt)
    expect(Number.isNaN(Date.parse(created.updatedAt))).toBe(false)
  })
})
