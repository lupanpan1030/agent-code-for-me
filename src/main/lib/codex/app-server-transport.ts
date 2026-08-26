import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { redactRuntimePayload } from "../agent-runtime/redaction"
import { resolveBundledCodexCliPath } from "./cli-path"

export type CodexAppServerMessageId = string | number

export type CodexAppServerClientRequestMethod =
  | "initialize"
  | "mcpServerStatus/list"
  | "thread/resume"
  | "thread/start"
  | "turn/start"
  | "turn/interrupt"

export type CodexAppServerClientNotificationMethod = "initialized"

export type CodexAppServerProtocolRequest = {
  id: CodexAppServerMessageId
  method: string
  params?: unknown
}

export type CodexAppServerProtocolNotification = {
  method: string
  params?: unknown
}

export type CodexAppServerProtocolResponse = {
  id: CodexAppServerMessageId
  result?: unknown
  error?: {
    code?: number
    message?: string
    data?: unknown
  }
}

export type CodexAppServerTransportNotification = {
  method: string
  params?: unknown
}

export type CodexAppServerTransportServerRequest = {
  id: CodexAppServerMessageId
  method: string
  params?: unknown
}

/**
 * A native app-server response stays conditional until the stdio transport is
 * about to serialize it. The adapter captures the exact Run owner in
 * `isResponseStillAuthorized`; the transport is the only owner that selects
 * between the candidate result and the protocol-valid fail-closed result.
 */
export type CodexAppServerTransportServerRequestResponse = {
  result: unknown
  failClosedResult: unknown
  isResponseStillAuthorized: () => boolean
}

export type CodexAppServerTransportExit = {
  code: number | null
  signal: NodeJS.Signals | null
  error: Error
}

export type CodexAppServerTransport = {
  request(
    method: CodexAppServerClientRequestMethod,
    params: unknown,
  ): Promise<unknown>
  notify(method: CodexAppServerClientNotificationMethod, params?: unknown): void
  onNotification(
    handler: (notification: CodexAppServerTransportNotification) => void,
  ): () => void
  onServerRequest(
    handler: (
      request: CodexAppServerTransportServerRequest,
    ) =>
      | CodexAppServerTransportServerRequestResponse
      | Promise<CodexAppServerTransportServerRequestResponse>,
  ): () => void
  onExit(handler: (exit: CodexAppServerTransportExit) => void): () => void
  close(): Promise<void>
}

export type CreateCodexAppServerStdioTransportInput = {
  executable?: string
  env?: NodeJS.ProcessEnv
  cwd?: string
  spawnProcess?: typeof spawn
  closeGraceMs?: number
  /** Main-process-only exact values used to scrub transport diagnostics. */
  secretHints?: readonly string[]
}

export function selectCodexAppServerServerRequestResult(
  response: CodexAppServerTransportServerRequestResponse,
): unknown {
  if (
    !isRecord(response) ||
    !("failClosedResult" in response) ||
    typeof response.isResponseStillAuthorized !== "function"
  ) {
    throw new Error(
      "Codex app-server handler returned a malformed response envelope.",
    )
  }
  try {
    if (response.isResponseStillAuthorized() === true) {
      return response.result
    }
  } catch {
    // Exact owner/abort predicates are security gates. A throwing predicate is
    // indistinguishable from a stale Run and selects the fail-closed result.
  }
  return response.failClosedResult
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function writeJsonLine(
  child: ChildProcessWithoutNullStreams,
  message:
    | CodexAppServerProtocolRequest
    | CodexAppServerProtocolNotification
    | CodexAppServerProtocolResponse,
  onError: (error: Error) => void,
): void {
  try {
    child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
      if (error) onError(error)
    })
  } catch (error) {
    onError(error instanceof Error ? error : new Error(String(error)))
  }
}

function redactedTransportText(
  value: string,
  fallback: string,
  secretHints: readonly string[],
): string {
  const rawMessage = value.trim() || fallback
  const redacted = redactRuntimePayload(rawMessage, {
    runtimeId: "codex",
    runId: "codex-app-server-transport",
    source: "runtime-diagnostic",
    secretHints,
  }).payload
  return typeof redacted === "string" ? redacted : fallback
}

function redactedProcessErrorMessage(
  stderr: string,
  fallback: string,
  secretHints: readonly string[],
): string {
  const message = redactedTransportText(stderr, fallback, secretHints)
  return message.length > 1000 ? `${message.slice(0, 1000)}...` : message
}

export function createCodexAppServerStdioTransport({
  executable = resolveBundledCodexCliPath(),
  env,
  cwd,
  spawnProcess = spawn,
  closeGraceMs = 5000,
  secretHints = [],
}: CreateCodexAppServerStdioTransportInput = {}): CodexAppServerTransport {
  const child = spawnProcess(
    executable,
    ["app-server", "--listen", "stdio://"],
    {
      cwd,
      env,
      stdio: "pipe",
    },
  ) as ChildProcessWithoutNullStreams
  let nextId = 1
  let stderr = ""
  const pending = new Map<CodexAppServerMessageId, PendingRequest>()
  const notificationHandlers = new Set<
    (notification: CodexAppServerTransportNotification) => void
  >()
  const serverRequestHandlers = new Set<
    (
      request: CodexAppServerTransportServerRequest,
    ) =>
      | CodexAppServerTransportServerRequestResponse
      | Promise<CodexAppServerTransportServerRequestResponse>
  >()
  const exitHandlers = new Set<(exit: CodexAppServerTransportExit) => void>()
  let lifecycleExit: CodexAppServerTransportExit | null = null
  let processEnded = false
  let resolveProcessEnded: (() => void) | null = null
  let closePromise: Promise<void> | null = null
  const processEndedPromise = new Promise<void>((resolve) => {
    resolveProcessEnded = resolve
  })

  const rejectPending = (error: Error) => {
    for (const waiter of pending.values()) waiter.reject(error)
    pending.clear()
  }

  const invokeExitHandler = (
    handler: (exit: CodexAppServerTransportExit) => void,
    exit: CodexAppServerTransportExit,
  ): void => {
    try {
      handler(exit)
    } catch {
      // Lifecycle observers are isolated from transport settlement. One
      // observer must not prevent pending rejection or the remaining observers.
    }
  }

  const markUnavailable = (exit: CodexAppServerTransportExit): boolean => {
    if (lifecycleExit) return false
    lifecycleExit = exit
    rejectPending(exit.error)
    for (const handler of [...exitHandlers]) invokeExitHandler(handler, exit)
    return true
  }

  const failTransport = (error: Error): void => {
    const becameUnavailable = markUnavailable({
      code: child.exitCode,
      signal: child.signalCode,
      error,
    })
    if (becameUnavailable) void closeTransport().catch(() => {})
  }

  const markProcessEnded = (input: {
    code: number | null
    signal: NodeJS.Signals | null
    fallback: string
  }) => {
    if (!processEnded) {
      processEnded = true
      resolveProcessEnded?.()
      resolveProcessEnded = null
    }
    markUnavailable({
      code: input.code,
      signal: input.signal,
      error: new Error(
        redactedProcessErrorMessage(stderr, input.fallback, secretHints),
      ),
    })
  }

  const handleWriteError = (error: Error) => {
    failTransport(
      new Error(
        redactedProcessErrorMessage(
          stderr,
          `Codex app-server stdin failed: ${error.message}`,
          secretHints,
        ),
      ),
    )
  }

  child.stderr.on("data", (chunk) => {
    stderr += String(chunk)
  })

  const rl = createInterface({ input: child.stdout })
  rl.on("line", (line) => {
    if (lifecycleExit) return
    if (!line.trim()) return
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      failTransport(
        new Error("Codex app-server emitted malformed JSON over stdio."),
      )
      return
    }
    if (!isRecord(parsed)) {
      failTransport(
        new Error("Codex app-server emitted a malformed protocol message."),
      )
      return
    }

    if ("id" in parsed && ("result" in parsed || "error" in parsed)) {
      const id = parsed.id as CodexAppServerMessageId
      const waiter = pending.get(id)
      if (!waiter) return
      pending.delete(id)
      const response = parsed as CodexAppServerProtocolResponse
      if (response.error) {
        waiter.reject(
          new Error(
            redactedTransportText(
              response.error.message || "Codex app-server request failed.",
              "Codex app-server request failed.",
              secretHints,
            ),
          ),
        )
      } else {
        waiter.resolve(response.result)
      }
      return
    }

    if (typeof parsed.method !== "string") {
      failTransport(
        new Error("Codex app-server emitted a malformed protocol message."),
      )
      return
    }
    if ("id" in parsed) {
      const request = {
        id: parsed.id as CodexAppServerMessageId,
        method: parsed.method,
        params: parsed.params,
      }
      void Promise.resolve()
        .then(async () => {
          const [handler] = [...serverRequestHandlers]
          if (!handler) {
            throw new Error(
              `No Codex app-server handler installed for ${request.method}.`,
            )
          }
          return handler(request)
        })
        .then((response) => {
          const result = selectCodexAppServerServerRequestResult(response)
          // Do not insert an await, callback, or notification between this
          // final exact-owner check and serialization. This synchronous pair
          // is the native side-effect authorization boundary.
          writeJsonLine(
            child,
            {
              id: request.id,
              result,
            },
            handleWriteError,
          )
        })
        .catch((error) => {
          writeJsonLine(
            child,
            {
              id: request.id,
              error: {
                code: -32000,
                message: redactedTransportText(
                  error instanceof Error ? error.message : String(error),
                  "Codex app-server request handler failed.",
                  secretHints,
                ),
              },
            },
            handleWriteError,
          )
        })
      return
    }

    for (const handler of [...notificationHandlers]) {
      try {
        handler({ method: parsed.method, params: parsed.params })
      } catch (error) {
        failTransport(
          new Error(
            redactedProcessErrorMessage(
              "",
              `Codex app-server notification handler failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
              secretHints,
            ),
          ),
        )
        return
      }
    }
  })

  child.stdin.on("error", (error) => {
    handleWriteError(error instanceof Error ? error : new Error(String(error)))
  })

  child.once("error", (error) => {
    const nextError = error instanceof Error ? error : new Error(String(error))
    // A failed spawn has no live process and therefore no later exit to await.
    if (child.pid === undefined) {
      processEnded = true
      resolveProcessEnded?.()
      resolveProcessEnded = null
    }
    failTransport(
      new Error(
        redactedProcessErrorMessage(stderr, nextError.message, secretHints),
      ),
    )
  })

  child.once("exit", (code, signal) => {
    markProcessEnded({
      code,
      signal,
      fallback: `Codex app-server exited before completing requests (code=${code}, signal=${signal}).`,
    })
  })

  child.once("close", (code, signal) => {
    markProcessEnded({
      code,
      signal,
      fallback: `Codex app-server closed before completing requests (code=${code}, signal=${signal}).`,
    })
  })

  const waitForProcessEnd = async (timeoutMs: number): Promise<boolean> => {
    if (processEnded) return true
    let timer: ReturnType<typeof setTimeout> | null = null
    const timedOut = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), Math.max(1, timeoutMs))
    })
    const ended = await Promise.race([
      processEndedPromise.then(() => true as const),
      timedOut,
    ])
    if (timer) clearTimeout(timer)
    return ended
  }

  function closeTransport(): Promise<void> {
    if (closePromise) return closePromise
    let resolveClose!: () => void
    let rejectClose!: (error: unknown) => void
    closePromise = new Promise<void>((resolve, reject) => {
      resolveClose = resolve
      rejectClose = reject
    })
    void (async () => {
      try {
        rl.close()
        if (!processEnded) {
          try {
            child.kill("SIGTERM")
          } catch {}
          if (!(await waitForProcessEnd(closeGraceMs))) {
            try {
              child.kill("SIGKILL")
            } catch {}
            if (!(await waitForProcessEnd(closeGraceMs))) {
              throw new Error(
                "Codex app-server did not exit after SIGTERM and SIGKILL.",
              )
            }
          }
        }
        await processEndedPromise
        resolveClose()
      } catch (error) {
        rejectClose(error)
      }
    })()
    return closePromise
  }

  return {
    request(method, params) {
      if (lifecycleExit) return Promise.reject(lifecycleExit.error)
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        writeJsonLine(
          child,
          {
            id,
            method,
            params,
          },
          handleWriteError,
        )
      })
    },

    notify(method, params) {
      if (lifecycleExit) return
      writeJsonLine(
        child,
        {
          method,
          ...(params === undefined ? {} : { params }),
        },
        handleWriteError,
      )
    },

    onNotification(handler) {
      notificationHandlers.add(handler)
      return () => notificationHandlers.delete(handler)
    },

    onServerRequest(handler) {
      serverRequestHandlers.add(handler)
      return () => serverRequestHandlers.delete(handler)
    },

    onExit(handler) {
      exitHandlers.add(handler)
      if (lifecycleExit) invokeExitHandler(handler, lifecycleExit)
      return () => exitHandlers.delete(handler)
    },

    close() {
      return closeTransport()
    },
  }
}
