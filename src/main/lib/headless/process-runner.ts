import { type ChildProcess, spawn } from "node:child_process"
import { basename } from "node:path"
import type {
  AgentRuntimeObserver,
  AgentRuntimeRunRequest,
  AgentRuntimeRunResult,
} from "./agent-runtime-contract"

export type ProcessAgentTaskInput = {
  request: AgentRuntimeRunRequest
  observer: AgentRuntimeObserver
  executable: string
  args: string[]
  stdin?: string | null
  env?: NodeJS.ProcessEnv
  stderrFilter?: (text: string) => string
  label: string
  /** Bounded grace period before a non-exiting child is force-killed. */
  terminationGraceMs?: number
  spawnProcess?: typeof spawn
}

function sanitizeArgs(args: string[]): string[] {
  return args.map((arg) => {
    if (/sk-[A-Za-z0-9_-]{20,}/.test(arg)) return "[redacted]"
    if (/bearer\s+[A-Za-z0-9._-]+/i.test(arg)) return "Bearer [redacted]"
    return arg.length > 240 ? `${arg.slice(0, 237)}...` : arg
  })
}

function hasChildExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

function createChildTerminator(
  child: ChildProcess,
  graceMs: number,
): { terminate: () => void; dispose: () => void } {
  let terminationStarted = false
  let forceKillTimer: ReturnType<typeof setTimeout> | null = null

  const dispose = () => {
    if (!forceKillTimer) return
    clearTimeout(forceKillTimer)
    forceKillTimer = null
  }

  const terminate = () => {
    if (terminationStarted || hasChildExited(child)) return
    terminationStarted = true
    try {
      child.kill("SIGTERM")
    } catch {}
    if (hasChildExited(child)) return

    forceKillTimer = setTimeout(() => {
      forceKillTimer = null
      // ChildProcess.killed only means a signal was sent. The exit and signal
      // codes are the authoritative process-lifecycle state.
      if (hasChildExited(child)) return
      try {
        child.kill("SIGKILL")
      } catch {}
    }, graceMs)
    forceKillTimer.unref()
  }

  return { terminate, dispose }
}

function buildAuthRequiredMessage(label: string): string {
  if (/claude/i.test(label)) {
    return `${label} authentication is required. Sign in through Locus desktop or log in with the claude CLI.`
  }
  return `${label} authentication is required.`
}

function buildInternalFailure(input: {
  label: string
  errorCode?: string
  operation: string
  stdout?: string
  stderr?: string
}): AgentRuntimeRunResult {
  return {
    status: "failed",
    exitCode: 1,
    errorCode: input.errorCode ?? "internal_error",
    errorMessage: `${input.label} failed while ${input.operation}.`,
    result: {
      stdout: input.stdout?.trim() ?? "",
      stderr: input.stderr?.trim() ?? "",
    },
  }
}

function classifyProcessFailure(input: {
  label: string
  stdout: string
  stderr: string
  exitCode: number | null
  signal: NodeJS.Signals | null
}): Pick<AgentRuntimeRunResult, "errorCode" | "errorMessage"> {
  const combined = `${input.stdout}\n${input.stderr}`
  if (
    /not logged in|please run\s+\/login|authentication failed|invalid api key/i.test(
      combined,
    )
  ) {
    return {
      errorCode: "runtime_auth_required",
      errorMessage: buildAuthRequiredMessage(input.label),
    }
  }

  return {
    errorCode: "runtime_process_failed",
    errorMessage: `${input.label} exited with code ${input.exitCode ?? "null"}${
      input.signal ? ` and signal ${input.signal}` : ""
    }.`,
  }
}

export async function runProcessAgentTask(
  input: ProcessAgentTaskInput,
): Promise<AgentRuntimeRunResult> {
  const { request, observer } = input
  try {
    observer.appendEvent("command_started", {
      label: input.label,
      executable: basename(input.executable),
      args: sanitizeArgs(input.args),
      cwd: request.context.cwd,
    })
  } catch {
    return buildInternalFailure({
      label: input.label,
      operation: "recording process startup",
    })
  }
  if (request.signal.aborted) {
    const canceledResult: AgentRuntimeRunResult = {
      status: "canceled",
      exitCode: 130,
      errorCode: "job_canceled",
      errorMessage: "Job was canceled.",
    }
    try {
      observer.appendEvent("command_finished", {
        label: input.label,
        exitCode: canceledResult.exitCode,
        status: canceledResult.status,
      })
      return canceledResult
    } catch {
      return buildInternalFailure({
        label: input.label,
        operation: "recording process completion",
      })
    }
  }

  return await new Promise<AgentRuntimeRunResult>((resolve) => {
    let child: ChildProcess | null = null
    let childTerminator: ReturnType<typeof createChildTerminator> | null = null
    let stdout = ""
    let stderr = ""
    let settled = false
    let internalFailure: AgentRuntimeRunResult | null = null
    const abortHandler = () => childTerminator?.terminate()

    const finish = (result: AgentRuntimeRunResult) => {
      if (settled) return
      settled = true
      clearInterval(heartbeatInterval)
      childTerminator?.dispose()
      request.signal.removeEventListener("abort", abortHandler)
      let terminalResult = result
      try {
        observer.appendEvent("command_finished", {
          label: input.label,
          exitCode: result.exitCode ?? null,
          status: result.status,
        })
      } catch {
        terminalResult = buildInternalFailure({
          label: input.label,
          operation: "recording process completion",
          stdout,
          stderr,
        })
      }
      resolve(terminalResult)
    }

    const recordInternalFailure = (failure: AgentRuntimeRunResult) => {
      if (settled || internalFailure) return
      internalFailure = failure
      childTerminator?.terminate()
    }

    const heartbeatInterval = setInterval(() => {
      if (internalFailure) return
      try {
        observer.heartbeat()
        if (observer.isCancelRequested()) {
          childTerminator?.terminate()
        }
      } catch {
        recordInternalFailure(
          buildInternalFailure({
            label: input.label,
            errorCode: "heartbeat_failed",
            operation: "updating the job heartbeat",
            stdout,
            stderr,
          }),
        )
      }
    }, 1000)
    heartbeatInterval.unref()

    try {
      const hasStdin = input.stdin !== undefined && input.stdin !== null
      child = (input.spawnProcess ?? spawn)(input.executable, input.args, {
        cwd: request.context.cwd,
        env: input.env ?? process.env,
        stdio: [hasStdin ? "pipe" : "ignore", "pipe", "pipe"],
        windowsHide: true,
      })
    } catch (error) {
      finish({
        status: "failed",
        exitCode: 1,
        errorCode: "spawn_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return
    }
    if (!child) return
    childTerminator = createChildTerminator(
      child,
      input.terminationGraceMs ?? 5000,
    )

    child.stdout?.on("data", (chunk: Buffer) => {
      if (internalFailure) return
      try {
        const text = chunk.toString("utf-8")
        stdout += text
        observer.appendEvent("assistant_delta", { text })
      } catch {
        recordInternalFailure(
          buildInternalFailure({
            label: input.label,
            operation: "recording process output",
            stdout,
            stderr,
          }),
        )
      }
    })
    child.stdout?.on("error", () => {
      recordInternalFailure(
        buildInternalFailure({
          label: input.label,
          operation: "reading process output",
          stdout,
          stderr,
        }),
      )
    })

    child.stderr?.on("data", (chunk: Buffer) => {
      if (internalFailure) return
      try {
        const rawText = chunk.toString("utf-8")
        const text = input.stderrFilter ? input.stderrFilter(rawText) : rawText
        if (!text) return
        stderr += text
        observer.appendEvent("command_output", { stream: "stderr", text })
      } catch {
        recordInternalFailure(
          buildInternalFailure({
            label: input.label,
            operation: "recording process diagnostics",
            stdout,
            stderr,
          }),
        )
      }
    })
    child.stderr?.on("error", () => {
      recordInternalFailure(
        buildInternalFailure({
          label: input.label,
          operation: "reading process diagnostics",
          stdout,
          stderr,
        }),
      )
    })

    child.on("error", (error) => {
      try {
        recordInternalFailure(
          request.signal.aborted
            ? {
                status: "canceled",
                exitCode: 130,
                errorCode: "job_canceled",
                errorMessage: "Job was canceled.",
                result: { stdout: stdout.trim(), stderr: stderr.trim() },
              }
            : {
                status: "failed",
                exitCode: 1,
                errorCode: "process_error",
                errorMessage: error.message,
                result: { stdout: stdout.trim(), stderr: stderr.trim() },
              },
        )
      } catch {
        recordInternalFailure(
          buildInternalFailure({
            label: input.label,
            operation: "handling a process error",
            stdout,
            stderr,
          }),
        )
      }
    })

    const handleChildClose = (
      exitCode: number | null,
      signal: NodeJS.Signals | null,
    ) => {
      if (internalFailure) {
        finish({
          ...internalFailure,
          result: {
            ...(typeof internalFailure.result === "object" &&
            internalFailure.result !== null
              ? internalFailure.result
              : {}),
            signal,
          },
        })
        return
      }

      let cancelRequested = request.signal.aborted
      if (!cancelRequested) {
        try {
          cancelRequested = observer.isCancelRequested()
        } catch {
          finish(
            buildInternalFailure({
              label: input.label,
              operation: "reading process cancellation state",
              stdout,
              stderr,
            }),
          )
          return
        }
      }

      if (cancelRequested) {
        finish({
          status: "canceled",
          exitCode: exitCode ?? 130,
          errorCode: "job_canceled",
          errorMessage: "Job was canceled.",
          result: { stdout: stdout.trim(), stderr: stderr.trim(), signal },
        })
        return
      }

      const success = exitCode === 0
      const failure = success
        ? { errorCode: null, errorMessage: null }
        : classifyProcessFailure({
            label: input.label,
            stdout,
            stderr,
            exitCode,
            signal,
          })
      finish({
        status: success ? "succeeded" : "failed",
        exitCode: exitCode ?? 1,
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
        result: {
          finalMessage: stdout.trim(),
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          signal,
        },
      })
    }

    child.once("close", (exitCode, signal) => {
      try {
        handleChildClose(exitCode, signal)
      } catch {
        finish(
          buildInternalFailure({
            label: input.label,
            operation: "finalizing the process result",
            stdout,
            stderr,
          }),
        )
      }
    })

    if (input.stdin !== undefined && input.stdin !== null) {
      child.stdin?.on("error", () => {
        recordInternalFailure(
          buildInternalFailure({
            label: input.label,
            operation: "writing process input",
            stdout,
            stderr,
          }),
        )
      })
    }

    request.signal.addEventListener("abort", abortHandler, { once: true })
    // The signal can abort synchronously inside an injected spawn function or
    // between spawn returning and listener registration.
    if (request.signal.aborted) abortHandler()

    if (input.stdin !== undefined && input.stdin !== null && !settled) {
      try {
        child.stdin?.end(input.stdin)
      } catch {
        recordInternalFailure(
          buildInternalFailure({
            label: input.label,
            operation: "writing process input",
            stdout,
            stderr,
          }),
        )
      }
    }
  })
}
