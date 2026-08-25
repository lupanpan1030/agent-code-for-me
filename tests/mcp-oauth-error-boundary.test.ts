import { afterEach, describe, expect, mock, test } from "bun:test"

mock.module("electron", () => ({
  shell: { openExternal: async () => {} },
}))

const { CraftOAuth } = await import("../src/main/lib/oauth")

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function oauthWithStatuses(statuses: string[]) {
  return new CraftOAuth(
    {
      mcpBaseUrl: "https://mcp.example.com",
      redirectUri: "http://localhost:8914/callback",
    },
    {
      onStatus: (message) => statuses.push(message),
      onError: (message) => statuses.push(message),
    },
  )
}

describe("MCP OAuth error boundary", () => {
  test("does not propagate dynamic registration response bodies", async () => {
    const responseSecret = "registration-response-secret"
    const statuses: string[] = []
    globalThis.fetch = (async () =>
      new Response(`upstream echoed ${responseSecret}`, {
        status: 400,
      })) as typeof fetch

    let message = ""
    try {
      await oauthWithStatuses(statuses).startAuthFlow({
        authorization_endpoint: "https://auth.example.com/authorize",
        token_endpoint: "https://auth.example.com/token",
        registration_endpoint: "https://auth.example.com/register",
      })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain("Failed to register OAuth client (400)")
    expect(message).not.toContain(responseSecret)
    expect(statuses.join("\n")).not.toContain(responseSecret)
  })

  test("does not propagate token-exchange response bodies or request secrets", async () => {
    const authorizationCode = "authorization-code-secret"
    const codeVerifier = "code-verifier-secret"
    const clientSecret = "client-secret-value"
    globalThis.fetch = (async () =>
      new Response(
        `echo ${authorizationCode} ${codeVerifier} ${clientSecret}`,
        { status: 401 },
      )) as typeof fetch

    let message = ""
    try {
      await oauthWithStatuses([]).completeAuthFlow(
        authorizationCode,
        codeVerifier,
        "https://auth.example.com/token",
        "public-client-id",
        clientSecret,
      )
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toBe("Failed to exchange code for tokens (401)")
    expect(message).not.toContain(authorizationCode)
    expect(message).not.toContain(codeVerifier)
    expect(message).not.toContain(clientSecret)
  })
})
