import { redactRuntimePayload } from "../agent-runtime/redaction"
import type { JsonValue } from "../agent-runtime/runtime-events"
import type { MessageMetadata } from "./types"

export type ClaudeAgentSdkMessageMetadataState = {
  metadata: MessageMetadata
  currentSessionId: string | null
  lastAssistantUuid: string | null
}

export function trackClaudeAgentSdkMessageMetadata(input: {
  message: any
  state: ClaudeAgentSdkMessageMetadataState
  historyEnabled: boolean
  aborted: boolean
  secretHints?: readonly string[]
}): ClaudeAgentSdkMessageMetadataState {
  const msgAny = input.message as any
  let metadata = input.state.metadata
  let currentSessionId = input.state.currentSessionId
  let lastAssistantUuid = input.state.lastAssistantUuid

  if (msgAny.session_id) {
    metadata = {
      ...metadata,
      sessionId: msgAny.session_id,
    }
    currentSessionId = msgAny.session_id
  }

  if (msgAny.type === "assistant" && msgAny.uuid) {
    lastAssistantUuid = msgAny.uuid
  }

  if (
    msgAny.type === "result" &&
    input.historyEnabled &&
    lastAssistantUuid &&
    !input.aborted
  ) {
    metadata = {
      ...metadata,
      sdkMessageUuid: lastAssistantUuid,
    }
  }

  if (msgAny.type === "system") {
    const diagnostic = redactRuntimePayload(
      {
        subtype: String(msgAny.subtype ?? ""),
        details: {
          cwd: msgAny.cwd,
          mcp_servers: msgAny.mcp_servers,
          tools: msgAny.tools,
          plugins: msgAny.plugins,
          permissionMode: msgAny.permissionMode,
        },
      } as JsonValue,
      {
        runtimeId: "claude-code",
        runId: msgAny.session_id ?? "claude-system-message",
        source: "runtime-diagnostic",
        secretHints: input.secretHints,
      },
    ).payload as { subtype: string; details: JsonValue }
    console.log(
      `[SD] SYSTEM message: subtype=${diagnostic.subtype}`,
      JSON.stringify(diagnostic.details, null, 2),
    )
  }

  return {
    metadata,
    currentSessionId,
    lastAssistantUuid,
  }
}
