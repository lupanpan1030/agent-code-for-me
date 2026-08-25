import { afterEach, describe, expect, mock, test } from "bun:test"
import { randomBytes } from "node:crypto"
import {
  logClaudeAgentSdkEmbeddedError,
  logClaudeAgentSdkErrorDetails,
} from "../src/main/lib/claude/agent-sdk-error-logging"
import { EXACT_SECRET_REDACTION_MARKER } from "../src/shared/secret-redaction-policy"

const originalConsoleError = console.error

function flattenedCalls(fn: unknown): string[] {
  return ((fn as { mock: { calls: unknown[][] } }).mock.calls ?? [])
    .flat()
    .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
}

describe("Claude Agent SDK error logging", () => {
  afterEach(() => {
    console.error = originalConsoleError
  })

  test("logs embedded SDK error runtime context", () => {
    console.error = mock(() => {}) as typeof console.error

    logClaudeAgentSdkEmbeddedError({
      sdkError: "invalid_request",
      message: {
        type: "error",
        session_id: "session-1",
        message: { id: "message-1" },
      },
      subChatId: "sub-1",
      chatId: "chat-1",
      cwd: "/repo",
      mode: "agent",
      hasCustomConfig: true,
      isUsingOllama: false,
      model: "claude-sonnet",
      hasOAuthToken: true,
      mcpServerNames: ["github", "filesystem"],
    })

    const calls = flattenedCalls(console.error)
    expect(calls).toContain("[CLAUDE SDK ERROR] Raw error: invalid_request")
    expect(calls).toContain("[CLAUDE SDK ERROR] SubChat ID: sub-1")
    expect(calls).toContain(
      "[CLAUDE SDK ERROR] MCP servers: github, filesystem",
    )
    expect(calls).toContain("[CLAUDE SDK ERROR] Full message:")
  })

  test("logs classified SDK error details with truncated context", () => {
    console.error = mock(() => {}) as typeof console.error

    logClaudeAgentSdkErrorDetails({
      errorCategory: "USAGE_POLICY_VIOLATION",
      errorContext: "x".repeat(250),
      rawErrorCode: "invalid_request",
      message: {
        session_id: "session-1",
        message: { id: "message-1" },
      },
    })

    const calls = (console.error as unknown as { mock: { calls: unknown[][] } })
      .mock.calls
    expect(calls[0][0]).toBe("[SD] SDK Error details:")
    expect(calls[0][1]).toMatchObject({
      errorCategory: "USAGE_POLICY_VIOLATION",
      rawErrorCode: "invalid_request",
      sessionId: "session-1",
      messageId: "message-1",
    })
    expect((calls[0][1] as { errorContext: string }).errorContext).toHaveLength(
      200,
    )
  })

  test("redacts exact run secrets from raw SDK error diagnostics", () => {
    console.error = mock(() => {}) as typeof console.error
    const gatewayToken = randomBytes(32).toString("hex")

    logClaudeAgentSdkEmbeddedError({
      sdkError: `malicious error ${gatewayToken}`,
      message: {
        type: "error",
        session_id: "session-secret",
        message: { content: [{ text: gatewayToken }] },
      },
      subChatId: "sub-1",
      chatId: "chat-1",
      cwd: "/repo",
      mode: "agent",
      hasCustomConfig: true,
      isUsingOllama: false,
      model: "claude-sonnet",
      hasOAuthToken: false,
      secretHints: [gatewayToken],
    })

    const serializedCalls = JSON.stringify(flattenedCalls(console.error))
    expect(serializedCalls).not.toContain(gatewayToken)
    expect(serializedCalls).toContain(EXACT_SECRET_REDACTION_MARKER)
  })
})
