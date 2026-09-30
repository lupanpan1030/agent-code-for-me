import { createDesktopRendererChannel } from "../agent-runtime/run-event-ledger-host"

export type CodexAppServerFinishGateChunk = Record<string, unknown>

export type CodexAppServerFinishGate = {
  emit: (chunk: CodexAppServerFinishGateChunk) => void
  runWithDeferredFinish: <T>(
    run: () => Promise<T>,
    afterRun: (result: T) => void | Promise<void>,
  ) => Promise<T>
}

export function createCodexAppServerFinishGate(input: {
  enabled: () => boolean
  emit: (chunk: CodexAppServerFinishGateChunk) => void
}): CodexAppServerFinishGate {
  let deferring = false
  let deferredFinishChunk: CodexAppServerFinishGateChunk | null = null
  let finishReleased = false

  const releaseFinish = (chunk: CodexAppServerFinishGateChunk) => {
    if (finishReleased) return
    finishReleased = true
    input.emit(chunk)
  }

  const emit = (chunk: CodexAppServerFinishGateChunk) => {
    if (!input.enabled()) {
      input.emit(chunk)
      return
    }

    // App-server finish can arrive before route-owned message persistence.
    // Stream deltas still pass through immediately.
    if (chunk?.type === "finish") {
      if (deferring) {
        deferredFinishChunk = chunk
        return
      }
      releaseFinish(chunk)
      return
    }

    input.emit(chunk)
  }

  const finishDeferral = (releaseDeferred: boolean) => {
    deferring = false
    const chunk = deferredFinishChunk
    deferredFinishChunk = null
    if (releaseDeferred && chunk) {
      releaseFinish(chunk)
    }
  }

  const runWithDeferredFinish = async <T>(
    run: () => Promise<T>,
    afterRun: (result: T) => void | Promise<void>,
  ) => {
    if (!input.enabled()) {
      const result = await run()
      await afterRun(result)
      return result
    }

    deferring = true
    let releaseDeferred = false
    try {
      const result = await run()
      await afterRun(result)
      releaseDeferred = true
      return result
    } finally {
      finishDeferral(releaseDeferred)
    }
  }

  return {
    emit,
    runWithDeferredFinish,
  }
}

/**
 * Renderer sink of one Codex desktop chat route: chunks the adapter already
 * projected/redacted (committed records and renderer framing) pass through
 * the finish gate; the route's own framing chunks are redacted with the
 * Run's exact hints first (renderer-only, no durable fact).
 */
export function createCodexDesktopRouteRenderer(input: {
  runId: string
  getSecretHints: () => readonly string[]
  markSawError: () => void
  emit: (chunk: CodexAppServerFinishGateChunk) => void
}) {
  const finishGate = createCodexAppServerFinishGate({
    enabled: () => true,
    emit: input.emit,
  })
  let emittedError = false
  let emittedFinish = false
  const deliver = (chunk: CodexAppServerFinishGateChunk) => {
    if (chunk.type === "error") emittedError = true
    if (chunk.type === "finish") emittedFinish = true
    if (
      chunk.type === "error" ||
      chunk.type === "auth-error" ||
      chunk.type === "capability-error" ||
      (chunk.type === "runtime-status" && chunk.ok === false)
    ) {
      input.markSawError()
    }
    finishGate.emit(chunk)
  }
  const routeChannel = createDesktopRendererChannel({
    runtimeId: "codex",
    runId: input.runId,
    observationPrefix: `codex-route:${input.runId}`,
    getLedger: () => null,
    getSecretHints: input.getSecretHints,
    emit: deliver,
  })
  return {
    finishGate,
    deliver,
    submit: (chunk: CodexAppServerFinishGateChunk) => {
      routeChannel.submit(chunk)
    },
    emittedError: () => emittedError,
    emittedFinish: () => emittedFinish,
  }
}
