import { redactRuntimePayload } from "../agent-runtime/redaction"
import type { JsonValue } from "../agent-runtime/runtime-events"

type ClaudeSdkDiagnosticInnerMessage = {
  id?: unknown
  [key: string]: unknown
}

type ClaudeSdkDiagnosticMessage = {
  type?: unknown
  session_id?: unknown
  message?: ClaudeSdkDiagnosticInnerMessage | null
  [key: string]: unknown
}

function diagnosticSessionId(
  message: ClaudeSdkDiagnosticMessage,
): string | null {
  return typeof message.session_id === "string" ? message.session_id : null
}

export function logClaudeAgentSdkEmbeddedError(input: {
  sdkError: unknown
  message: ClaudeSdkDiagnosticMessage
  subChatId: string
  chatId: string
  cwd: string
  mode: string
  hasCustomConfig: boolean
  isUsingOllama: boolean
  model?: string | null
  hasOAuthToken: boolean
  mcpServerNames?: string[]
  secretHints?: readonly string[]
}): void {
  const redacted = redactRuntimePayload(
    {
      sdkError: String(input.sdkError),
      message: input.message,
    } as JsonValue,
    {
      runtimeId: "claude-code",
      runId: diagnosticSessionId(input.message) ?? input.subChatId,
      source: "runtime-diagnostic",
      secretHints: input.secretHints,
    },
  ).payload as {
    sdkError: string
    message: ClaudeSdkDiagnosticMessage
  }
  console.error("[CLAUDE SDK ERROR] ========================================")
  console.error(`[CLAUDE SDK ERROR] Raw error: ${redacted.sdkError}`)
  console.error(`[CLAUDE SDK ERROR] Message type: ${redacted.message.type}`)
  console.error(`[CLAUDE SDK ERROR] SubChat ID: ${input.subChatId}`)
  console.error(`[CLAUDE SDK ERROR] Chat ID: ${input.chatId}`)
  console.error(`[CLAUDE SDK ERROR] CWD: ${input.cwd}`)
  console.error(`[CLAUDE SDK ERROR] Mode: ${input.mode}`)
  console.error(
    `[CLAUDE SDK ERROR] Session ID: ${redacted.message.session_id || "none"}`,
  )
  console.error(
    `[CLAUDE SDK ERROR] Has custom config: ${input.hasCustomConfig}`,
  )
  console.error(`[CLAUDE SDK ERROR] Is using Ollama: ${input.isUsingOllama}`)
  console.error(`[CLAUDE SDK ERROR] Model: ${input.model || "default"}`)
  console.error(`[CLAUDE SDK ERROR] Has OAuth token: ${input.hasOAuthToken}`)
  console.error(
    `[CLAUDE SDK ERROR] MCP servers: ${
      input.mcpServerNames && input.mcpServerNames.length > 0
        ? input.mcpServerNames.join(", ")
        : "none"
    }`,
  )
  console.error(
    "[CLAUDE SDK ERROR] Full message:",
    JSON.stringify(redacted.message, null, 2),
  )
  console.error("[CLAUDE SDK ERROR] ========================================")
}

export function logClaudeAgentSdkErrorDetails(input: {
  errorCategory: string
  errorContext: string
  rawErrorCode: string
  message: ClaudeSdkDiagnosticMessage
  secretHints?: readonly string[]
}): void {
  const redacted = redactRuntimePayload(
    {
      errorContext: input.errorContext,
      rawErrorCode: input.rawErrorCode,
      message: input.message,
    } as JsonValue,
    {
      runtimeId: "claude-code",
      runId: diagnosticSessionId(input.message) ?? "claude-sdk-error",
      source: "runtime-diagnostic",
      secretHints: input.secretHints,
    },
  ).payload as {
    errorContext: string
    rawErrorCode: string
    message: ClaudeSdkDiagnosticMessage
  }
  console.error("[SD] SDK Error details:", {
    errorCategory: input.errorCategory,
    errorContext: redacted.errorContext.slice(0, 200),
    rawErrorCode: redacted.rawErrorCode,
    sessionId: redacted.message.session_id,
    messageId: redacted.message.message?.id,
    fullMessage: JSON.stringify(redacted.message, null, 2),
  })
}
