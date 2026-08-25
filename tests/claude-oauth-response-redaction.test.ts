import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  exchangeClaudeCodeAuthCode,
  redactAndTruncateClaudeCredentialErrorDetail,
  refreshClaudeToken,
} from "../src/main/lib/claude-token"
import { EXACT_SECRET_REDACTION_MARKER } from "../src/shared/secret-redaction-policy"

const originalFetch = globalThis.fetch

async function capturedErrorMessage(action: () => Promise<unknown>) {
  try {
    await action()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error("Expected action to fail")
}

describe("Claude OAuth response redaction", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("redacts exact credential hints before applying the policy detail limit", () => {
    const authorizationCode = "authorization-code-secret-value"
    const state = "oauth-state-secret-value"
    const codeVerifier = "pkce-code-verifier-secret-value"
    const leading = `state=${state}; verifier=${codeVerifier};`
    const padding = "x".repeat(490 - leading.length)
    const authCodePrefixAtBoundary = authorizationCode.slice(0, 12)
    const detail = redactAndTruncateClaudeCredentialErrorDetail(
      `${leading}${padding}${authorizationCode}-after-boundary`,
      [authorizationCode, state, codeVerifier],
    )

    expect(detail).toContain(EXACT_SECRET_REDACTION_MARKER)
    expect(detail).not.toContain(authorizationCode)
    expect(detail).not.toContain(authCodePrefixAtBoundary)
    expect(detail).not.toContain(state)
    expect(detail).not.toContain(codeVerifier)
    expect(detail.length).toBeLessThanOrEqual(500)
  })

  test("does not read or propagate authorization exchange failure bodies", async () => {
    const upstreamSecret = "upstream-authorization-error-secret"
    let bodyRead = false
    globalThis.fetch = mock(
      async () =>
        ({
          ok: false,
          status: 503,
          statusText: `Unavailable ${upstreamSecret}`,
          text: async () => {
            bodyRead = true
            return upstreamSecret
          },
        }) as Response,
    ) as typeof fetch

    const message = await capturedErrorMessage(() =>
      exchangeClaudeCodeAuthCode({
        authorizationCode: "authorization-code-secret-value",
        state: "oauth-state-secret-value",
        codeVerifier: "pkce-code-verifier-secret-value",
        redirectUri: "https://platform.claude.com/oauth/code/callback",
      }),
    )

    expect(message).toBe("Claude Code token exchange failed (HTTP 503).")
    expect(message).not.toContain(upstreamSecret)
    expect(bodyRead).toBe(false)
  })

  test("does not read or propagate refresh failure bodies", async () => {
    const refreshToken = "refresh-token-secret-value"
    const upstreamSecret = "upstream-refresh-error-secret"
    let bodyRead = false
    globalThis.fetch = mock(
      async () =>
        ({
          ok: false,
          status: 429,
          statusText: `Rate limited ${upstreamSecret}`,
          text: async () => {
            bodyRead = true
            return `${refreshToken}:${upstreamSecret}`
          },
        }) as Response,
    ) as typeof fetch

    const message = await capturedErrorMessage(() =>
      refreshClaudeToken(refreshToken),
    )

    expect(message).toBe("Failed to refresh Claude token (HTTP 429).")
    expect(message).not.toContain(refreshToken)
    expect(message).not.toContain(upstreamSecret)
    expect(bodyRead).toBe(false)
  })

  test("rejects a policy-invalid credential returned by authorization exchange", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ access_token: "short" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as typeof fetch

    await expect(
      exchangeClaudeCodeAuthCode({
        authorizationCode: "authorization-code-secret-value",
        state: "oauth-state-secret-value",
        codeVerifier: "pkce-code-verifier-secret-value",
        redirectUri: "https://platform.claude.com/oauth/code/callback",
      }),
    ).rejects.toThrow("returned an invalid credential")
  })

  test("fails closed without exposing transport diagnostics", async () => {
    const refreshToken = "refresh-token-transport-secret"
    globalThis.fetch = mock(async () => {
      throw new Error(`transport echoed ${refreshToken}`)
    }) as typeof fetch

    const message = await capturedErrorMessage(() =>
      refreshClaudeToken(refreshToken),
    )

    expect(message).toBe("Failed to refresh Claude token.")
    expect(message).not.toContain(refreshToken)

    globalThis.fetch = mock(async () => {
      throw new Error("authorization transport diagnostics")
    }) as typeof fetch
    await expect(
      exchangeClaudeCodeAuthCode({
        authorizationCode: "authorization-code-secret-value",
        state: "oauth-state-secret-value",
        codeVerifier: "pkce-code-verifier-secret-value",
        redirectUri: "https://platform.claude.com/oauth/code/callback",
      }),
    ).rejects.toThrow("Claude Code token exchange failed.")
  })

  test("rejects policy-invalid credentials returned by refresh", async () => {
    const refreshToken = "refresh-token-secret-value"
    const invalidResponses = [
      { access_token: "short" },
      { access_token: "valid-access-token\nsecond-line" },
      { access_token: "x".repeat(16 * 1024 + 1) },
      {
        access_token: "valid-access-token",
        refresh_token: "short",
      },
    ]

    for (const body of invalidResponses) {
      globalThis.fetch = mock(
        async () =>
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ) as typeof fetch

      const message = await capturedErrorMessage(() =>
        refreshClaudeToken(refreshToken),
      )

      expect(message).toBe(
        "Failed to refresh Claude token: invalid credential response.",
      )
      expect(message).not.toContain(body.access_token)
      if (body.refresh_token) expect(message).not.toContain(body.refresh_token)
    }
  })

  test("rejects invalid refresh input before any request", async () => {
    let called = false
    globalThis.fetch = mock(async () => {
      called = true
      return new Response("{}", { status: 200 })
    }) as typeof fetch

    await expect(refreshClaudeToken("short")).rejects.toThrow(
      "invalid refresh credential",
    )
    expect(called).toBe(false)
  })
})
