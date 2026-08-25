import {
  type DesktopRunPreflightBlocker,
  DesktopRunPreflightError,
} from "../agent-runtime/preflight"
import { redactRuntimePayload } from "../agent-runtime/redaction"
import type { JsonValue } from "../agent-runtime/runtime-events"
import type { UIMessageChunk } from "./types"

export type ClaudeAgentSdkRuntimeErrorEmitter = (
  error: unknown,
  context: string,
) => void

export type ClaudeAgentSdkPreflightBlockerEmitter = (
  blocker: DesktopRunPreflightBlocker,
) => void

export type CreateClaudeAgentSdkRuntimeErrorHandlersInput = {
  cwd: string
  mode: string
  runId?: string
  getSecretHints?: () => readonly string[]
  isActive?: () => boolean
  emit: (chunk: UIMessageChunk) => unknown
  complete: () => void
  env?: {
    NODE_ENV?: string
    PATH?: string
  }
  error?: (...args: any[]) => void
}

export type ClaudeAgentSdkRuntimeErrorHandlers = {
  emitError: ClaudeAgentSdkRuntimeErrorEmitter
  emitPreflightBlocker: ClaudeAgentSdkPreflightBlockerEmitter
}

export function createClaudeAgentSdkRuntimeErrorHandlers({
  cwd,
  mode,
  runId,
  getSecretHints,
  isActive = () => true,
  emit,
  complete,
  env = {
    NODE_ENV: process.env.NODE_ENV,
    PATH: process.env.PATH,
  },
  error: logError = console.error,
}: CreateClaudeAgentSdkRuntimeErrorHandlersInput): ClaudeAgentSdkRuntimeErrorHandlers {
  const emitError: ClaudeAgentSdkRuntimeErrorEmitter = (error, context) => {
    const redactedError = redactRuntimePayload(
      {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? (error.stack ?? null) : null,
      } as JsonValue,
      {
        runtimeId: "claude-code",
        runId: runId ?? "claude-runtime-error",
        source: "runtime-diagnostic",
        secretHints: getSecretHints?.(),
      },
    ).payload as { message: string; stack: string | null }
    const errorMessage = redactedError.message
    const errorStack = redactedError.stack ?? undefined

    if (isActive()) {
      logError(`[claude] ${context}:`, errorMessage)
      if (errorStack) logError("[claude] Stack:", errorStack)
    }

    emit({
      type: "error",
      errorText: `${context}: ${errorMessage}`,
      ...(env.NODE_ENV !== "production" && {
        debugInfo: {
          context,
          cwd,
          mode,
          PATH: env.PATH?.slice(0, 200),
        },
      }),
    } as UIMessageChunk)
  }

  return {
    emitError,
    emitPreflightBlocker(blocker) {
      emitError(
        new DesktopRunPreflightError(blocker),
        "Desktop run preflight blocked",
      )
      emit({ type: "finish" } as UIMessageChunk)
      complete()
    },
  }
}
