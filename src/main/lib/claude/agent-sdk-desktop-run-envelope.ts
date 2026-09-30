import type { DesktopRunPreflightBlocker } from "../agent-runtime/preflight"
import { createDesktopRendererChannel } from "../agent-runtime/run-event-ledger-host"
import { startActiveClaudeSessionForDesktopRun } from "./active-sessions"
import {
  type ClaudeAgentSdkDesktopRunState,
  createClaudeAgentSdkDesktopRunState,
} from "./agent-sdk-desktop-run-state"
import { createClaudeAgentSdkRuntimeErrorHandlers } from "./agent-sdk-runtime-errors"
import { createClaudeAgentSdkRuntimeStreamState } from "./agent-sdk-runtime-state"
import type { ClaudeAgentSdkStreamConsumerMutableState } from "./agent-sdk-stream-consumer"
import type { UIMessageChunk } from "./types"

function isRendererFailureChunk(chunk: unknown): boolean {
  if (!chunk || typeof chunk !== "object" || Array.isArray(chunk)) return false
  const value = chunk as Record<string, unknown>
  return (
    value.type === "error" ||
    value.type === "auth-error" ||
    value.type === "capability-error" ||
    (value.type === "runtime-status" && value.ok === false)
  )
}

export type ClaudeAgentSdkDesktopRunEnvelope = {
  abortController: AbortController
  streamId: string
  activeRunId: string
  subId: string
  streamStart: number
  streamState: ClaudeAgentSdkStreamConsumerMutableState
  desktopRunState: ClaudeAgentSdkDesktopRunState
  emit: (chunk: UIMessageChunk) => boolean
  complete: () => void
  emitError: (error: unknown, context: string) => void
  emitPreflightBlocker: (blocker: DesktopRunPreflightBlocker) => void
}

export function createClaudeAgentSdkDesktopRunEnvelope(input: {
  subChatId: string
  requestedRunId?: string | null
  cwd: string
  mode: "plan" | "agent"
  emitNext: (chunk: UIMessageChunk) => void
  emitComplete: () => void
  getSecretHints?: () => readonly string[]
  createId?: () => string
  nowMs?: () => number
  log?: (...args: any[]) => void
}): ClaudeAgentSdkDesktopRunEnvelope {
  const activeSessionStartup = startActiveClaudeSessionForDesktopRun({
    subChatId: input.subChatId,
    requestedRunId: input.requestedRunId,
    createId: input.createId,
  })
  const streamState = createClaudeAgentSdkRuntimeStreamState()
  const desktopRunState = createClaudeAgentSdkDesktopRunState()
  const subId = input.subChatId.slice(-8)
  const streamStart = input.nowMs?.() ?? Date.now()
  const log = input.log ?? console.log
  log(
    `[SD] M:START sub=${subId} stream=${activeSessionStartup.streamId.slice(-8)} mode=${input.mode}`,
  )

  // Durable stream chunks reach the renderer only as the projection of the
  // records the desktop job's ledger committed; framing/interaction chunks
  // are redacted with the Run's exact hints (host renderer channel).
  const rendererChannel = createDesktopRendererChannel({
    runtimeId: "claude-code",
    runId: activeSessionStartup.runId,
    observationPrefix: `claude-desktop:${activeSessionStartup.runId}:stream`,
    getLedger: desktopRunState.getLedger,
    getSecretHints: input.getSecretHints,
    emit: (chunk) => {
      if (!desktopRunState.isObservableActive()) return
      try {
        input.emitNext(chunk as UIMessageChunk)
      } catch {
        desktopRunState.markInactive()
      }
    },
  })
  const emitRuntimeChunk = (chunk: unknown): boolean => {
    if (isRendererFailureChunk(chunk)) desktopRunState.markFailed()
    if (chunk && typeof chunk === "object" && !Array.isArray(chunk)) {
      rendererChannel.submit(chunk as Record<string, unknown>)
    }
    return desktopRunState.isObservableActive()
  }

  const complete = () => {
    // Completion follows every chunk already submitted to the channel.
    void rendererChannel.drain().then(() => {
      try {
        input.emitComplete()
      } catch {
        // Already completed or closed.
      }
    })
  }

  const { emitError, emitPreflightBlocker } =
    createClaudeAgentSdkRuntimeErrorHandlers({
      cwd: input.cwd,
      mode: input.mode,
      runId: activeSessionStartup.runId,
      getSecretHints: input.getSecretHints,
      isActive: desktopRunState.isObservableActive,
      emit: (chunk) => emitRuntimeChunk(chunk),
      complete,
    })

  return {
    abortController: activeSessionStartup.controller,
    streamId: activeSessionStartup.streamId,
    activeRunId: activeSessionStartup.runId,
    subId,
    streamStart,
    streamState,
    desktopRunState,
    emit: (chunk) => emitRuntimeChunk(chunk),
    complete,
    emitError,
    emitPreflightBlocker,
  }
}
