import {
  type ClaudeAgentSdkStreamIterationState,
  recordClaudeAgentSdkStreamMessage,
} from "./agent-sdk-stream-lifecycle"
import { logRawClaudeMessage } from "./raw-logger"

export type RecordClaudeAgentSdkIncomingMessageInput = {
  chatId: string
  message: any
  state: ClaudeAgentSdkStreamIterationState
  isUsingOllama: boolean
  secretHints?: readonly string[]
  logRawMessage?: (
    chatId: string,
    message: unknown,
    secretHints?: readonly string[],
  ) => unknown
  now?: () => number
  warn?: (...args: any[]) => void
}

export function recordClaudeAgentSdkIncomingMessage({
  chatId,
  message,
  state,
  isUsingOllama,
  secretHints,
  logRawMessage = logRawClaudeMessage,
  now,
  warn,
}: RecordClaudeAgentSdkIncomingMessageInput): {
  messageCount: number
  timeToFirstMessageMs?: number
} {
  const result = recordClaudeAgentSdkStreamMessage({
    state,
    message,
    isUsingOllama,
    now,
    warn,
  })
  void logRawMessage(chatId, message, secretHints)
  return result
}
