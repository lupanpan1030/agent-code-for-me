import { describe, expect, test } from "bun:test"
import type { spawn } from "node:child_process"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import type {
  AgentRuntimeObserver,
  AgentRuntimeRunRequest,
} from "../src/main/lib/headless/agent-runtime-contract"
import { createAgentRuntimeRunRequest } from "../src/main/lib/headless/agent-runtime-contract"
import { runProcessAgentTask } from "../src/main/lib/headless/process-runner"
import type { AgentJobEventType } from "../src/shared/agent-jobs"

function createObserver(
  options: {
    cancelAfterHeartbeat?: boolean
    onEvent?: (type: AgentJobEventType, payload: unknown) => void
  } = {},
) {
  const events: Array<{ type: AgentJobEventType; payload: unknown }> = []
  let heartbeatCount = 0
  const observer: AgentRuntimeObserver = {
    appendEvent(type, payload) {
      events.push({ type, payload })
      options.onEvent?.(type, payload)
      return {
        id: `event_${events.length}`,
        jobId: "job_123",
        sequence: events.length,
        type,
        payloadJson: JSON.stringify(payload ?? {}),
        createdAt: new Date(),
      }
    },
    heartbeat() {
      heartbeatCount += 1
      return {
        id: "job_123",
        retryOfJobId: null,
        attempt: 1,
        source: "cli",
        runtime: "codex",
        status: "running",
        mode: "agent",
        cwd: process.cwd(),
        projectId: null,
        chatId: null,
        subChatId: null,
        promptPreview: null,
        inputJson: null,
        createdAt: new Date(),
        startedAt: new Date(),
        finishedAt: null,
        exitCode: null,
        errorCode: null,
        errorMessage: null,
        resultJson: null,
        createdByVersion: null,
        workerId: "worker",
        workerPid: process.pid,
        workerStartedAt: new Date(),
        heartbeatAt: new Date(),
        cancelRequestedAt: options.cancelAfterHeartbeat ? new Date() : null,
        cancelRequestedBy: options.cancelAfterHeartbeat ? "test" : null,
      }
    },
    isCancelRequested() {
      return options.cancelAfterHeartbeat && heartbeatCount > 0
    },
    registerSecretHints() {},
  }
  return { observer, events }
}

class AbortDuringSpawnChild extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  killed = false
  killSignals: NodeJS.Signals[] = []

  kill(signal: NodeJS.Signals = "SIGTERM") {
    this.killed = true
    this.killSignals.push(signal)
    queueMicrotask(() => {
      this.signalCode = signal
      this.emit("close", null, signal)
    })
    return true
  }
}

class FakeWritableStdin extends EventEmitter {
  constructor(private readonly behavior: "ok" | "throw" | "error" = "ok") {
    super()
  }

  end(_input?: string) {
    if (this.behavior === "throw") throw new Error("synthetic stdin throw")
    if (this.behavior === "error") {
      queueMicrotask(() => this.emit("error", new Error("synthetic EPIPE")))
    }
  }
}

class FakeProcessChild extends EventEmitter {
  stdin: FakeWritableStdin
  stdout = new PassThrough()
  stderr = new PassThrough()
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  killed = false
  killSignals: NodeJS.Signals[] = []

  constructor(
    stdinBehavior: "ok" | "throw" | "error" = "ok",
    private readonly ignoreSigterm = false,
  ) {
    super()
    this.stdin = new FakeWritableStdin(stdinBehavior)
  }

  kill(signal: NodeJS.Signals = "SIGTERM") {
    this.killed = true
    this.killSignals.push(signal)
    if (signal === "SIGTERM" && this.ignoreSigterm) return true
    queueMicrotask(() => {
      this.signalCode = signal
      this.emit("close", null, signal)
    })
    return true
  }

  closeSuccessfully() {
    this.exitCode = 0
    this.emit("close", 0, null)
  }
}

function spawnFakeChild(child: FakeProcessChild): typeof spawn {
  return (() => child) as unknown as typeof spawn
}

function abortDuringSpawn(
  child: AbortDuringSpawnChild,
  controller: AbortController,
): typeof spawn {
  return (() => {
    controller.abort()
    return child
  }) as unknown as typeof spawn
}

function request(signal: AbortSignal): AgentRuntimeRunRequest {
  return createAgentRuntimeRunRequest({
    jobId: "job_123",
    runtime: "codex",
    cwd: process.cwd(),
    mode: "agent",
    source: "cli",
    prompt: "test",
    signal,
  })
}

describe("headless process runner", () => {
  test("captures stdout and stderr as normalized events", async () => {
    const controller = new AbortController()
    const { observer, events } = createObserver()
    const result = await runProcessAgentTask({
      request: request(controller.signal),
      observer,
      executable: process.execPath,
      args: [
        "-e",
        "console.log('hello from stdout'); console.error('warn from stderr')",
      ],
      label: "node",
    })

    expect(result.status).toBe("succeeded")
    expect(result.result).toMatchObject({
      finalMessage: "hello from stdout",
      stdout: "hello from stdout",
      stderr: "warn from stderr",
    })
    expect(events.map((event) => event.type)).toContain("command_started")
    expect(events.map((event) => event.type)).toContain("assistant_delta")
    expect(events.map((event) => event.type)).toContain("command_output")
    expect(events.map((event) => event.type)).toContain("command_finished")
  })

  test("can filter known stderr noise before events and final results", async () => {
    const controller = new AbortController()
    const { observer, events } = createObserver()
    const result = await runProcessAgentTask({
      request: request(controller.signal),
      observer,
      executable: process.execPath,
      args: ["-e", "console.error('drop me'); console.error('keep me')"],
      stderrFilter: (text) => text.replace("drop me\n", ""),
      label: "node",
    })

    expect(result.status).toBe("succeeded")
    expect(result.result).toMatchObject({
      stderr: "keep me",
    })
    expect(
      events
        .filter((event) => event.type === "command_output")
        .map((event) => event.payload),
    ).toEqual([{ stream: "stderr", text: "keep me\n" }])
  })

  test("cancels a running child process when the signal aborts", async () => {
    const controller = new AbortController()
    const { observer } = createObserver()
    const promise = runProcessAgentTask({
      request: request(controller.signal),
      observer,
      executable: process.execPath,
      args: ["-e", "setTimeout(() => {}, 10_000)"],
      label: "node",
    })
    setTimeout(() => controller.abort(), 50)

    const result = await promise
    expect(result.status).toBe("canceled")
    expect(result.errorCode).toBe("job_canceled")
  })

  test("force-kills a child that ignores SIGTERM after the bounded grace period", async () => {
    const controller = new AbortController()
    let markReady: (() => void) | null = null
    const ready = new Promise<void>((resolve) => {
      markReady = resolve
    })
    const { observer } = createObserver({
      onEvent(type, payload) {
        if (
          type === "assistant_delta" &&
          typeof (payload as { text?: unknown })?.text === "string" &&
          (payload as { text: string }).text.includes("ready")
        ) {
          markReady?.()
        }
      },
    })
    const promise = runProcessAgentTask({
      request: request(controller.signal),
      observer,
      executable: process.execPath,
      args: [
        "-e",
        "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)",
      ],
      label: "non-cooperative node",
      terminationGraceMs: 25,
    })

    await ready
    controller.abort()
    const result = await promise

    expect(result.status).toBe("canceled")
    expect(result.result).toMatchObject({ signal: "SIGKILL" })
  })

  test("closes the abort race when the signal fires inside spawn", async () => {
    const controller = new AbortController()
    const child = new AbortDuringSpawnChild()
    const { observer } = createObserver()

    const result = await runProcessAgentTask({
      request: request(controller.signal),
      observer,
      executable: "/tmp/fake-node",
      args: [],
      label: "spawn-race",
      terminationGraceMs: 25,
      spawnProcess: abortDuringSpawn(child, controller),
    })

    expect(result.status).toBe("canceled")
    expect(child.killSignals).toEqual(["SIGTERM"])
  })

  test("does not spawn a process when the signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    const { observer, events } = createObserver()
    const result = await runProcessAgentTask({
      request: request(controller.signal),
      observer,
      executable: "/definitely/missing/locus-headless-test-binary",
      args: [],
      label: "missing",
    })

    expect(result.status).toBe("canceled")
    expect(result.errorCode).toBe("job_canceled")
    expect(events.map((event) => event.type)).toEqual([
      "command_started",
      "command_finished",
    ])
    expect(events.at(-1)?.payload).toMatchObject({
      status: "canceled",
    })
  })

  test("classifies login failures as runtime auth requirements", async () => {
    const controller = new AbortController()
    const { observer } = createObserver()
    const result = await runProcessAgentTask({
      request: request(controller.signal),
      observer,
      executable: process.execPath,
      args: [
        "-e",
        "console.log('Not logged in · Please run /login'); process.exit(1)",
      ],
      label: "Claude Code",
    })

    expect(result.status).toBe("failed")
    expect(result.errorCode).toBe("runtime_auth_required")
    expect(result.errorMessage).toBe(
      "Claude Code authentication is required. Sign in through Locus desktop or log in with the claude CLI.",
    )
  })

  test("keeps generic auth guidance for non-Claude processes", async () => {
    const controller = new AbortController()
    const { observer } = createObserver()
    const result = await runProcessAgentTask({
      request: request(controller.signal),
      observer,
      executable: process.execPath,
      args: ["-e", "console.error('authentication failed'); process.exit(1)"],
      label: "Codex",
    })

    expect(result.status).toBe("failed")
    expect(result.errorCode).toBe("runtime_auth_required")
    expect(result.errorMessage).toBe("Codex authentication is required.")
  })

  test("does not include child environment secrets in process events", async () => {
    const controller = new AbortController()
    const { observer, events } = createObserver()
    const secret = "claude-oauth-token-that-must-stay-in-child-env-only"
    const result = await runProcessAgentTask({
      request: request(controller.signal),
      observer,
      executable: process.execPath,
      args: ["-e", "console.log('done')"],
      env: {
        ...process.env,
        CLAUDE_CODE_OAUTH_TOKEN: secret,
      },
      label: "Claude Code",
    })

    expect(result.status).toBe("succeeded")
    expect(JSON.stringify(events)).not.toContain(secret)
  })

  test.each([
    "throw",
    "error",
  ] as const)("fails once, terminates, and waits for close when stdin %s occurs", async (stdinBehavior) => {
    const controller = new AbortController()
    const child = new FakeProcessChild(stdinBehavior)
    const { observer, events } = createObserver()

    const result = await runProcessAgentTask({
      request: request(controller.signal),
      observer,
      executable: "/tmp/fake-node",
      args: [],
      stdin: "prompt",
      label: "stdin-child",
      terminationGraceMs: 25,
      spawnProcess: spawnFakeChild(child),
    })

    expect(result).toMatchObject({
      status: "failed",
      errorCode: "internal_error",
      errorMessage: "stdin-child failed while writing process input.",
      result: { signal: "SIGTERM" },
    })
    expect(child.killSignals).toEqual(["SIGTERM"])
    expect(
      events.filter((event) => event.type === "command_finished"),
    ).toHaveLength(1)
  })

  test("contains observer throws from stdout callbacks as one failed terminal", async () => {
    const controller = new AbortController()
    const child = new FakeProcessChild("ok", true)
    const { observer, events } = createObserver({
      onEvent(type) {
        if (type === "assistant_delta") {
          throw new Error("synthetic observer failure")
        }
      },
    })

    const promise = runProcessAgentTask({
      request: request(controller.signal),
      observer,
      executable: "/tmp/fake-node",
      args: [],
      label: "observer-child",
      terminationGraceMs: 25,
      spawnProcess: spawnFakeChild(child),
    })
    child.stdout.write("partial output")

    const result = await promise
    expect(result).toMatchObject({
      status: "failed",
      errorCode: "internal_error",
      errorMessage: "observer-child failed while recording process output.",
      result: { signal: "SIGKILL" },
    })
    expect(child.killSignals).toEqual(["SIGTERM", "SIGKILL"])
    expect(
      events.filter((event) => event.type === "command_finished"),
    ).toHaveLength(1)
  })

  test("contains stderr filter throws as one failed terminal", async () => {
    const controller = new AbortController()
    const child = new FakeProcessChild()
    const { observer, events } = createObserver()

    const promise = runProcessAgentTask({
      request: request(controller.signal),
      observer,
      executable: "/tmp/fake-node",
      args: [],
      stderrFilter() {
        throw new Error("synthetic filter failure")
      },
      label: "filter-child",
      terminationGraceMs: 25,
      spawnProcess: spawnFakeChild(child),
    })
    child.stderr.write("diagnostic")

    const result = await promise
    expect(result).toMatchObject({
      status: "failed",
      errorCode: "internal_error",
      errorMessage: "filter-child failed while recording process diagnostics.",
      result: { signal: "SIGTERM" },
    })
    expect(child.killSignals).toEqual(["SIGTERM"])
    expect(
      events.filter((event) => event.type === "command_finished"),
    ).toHaveLength(1)
  })

  test("contains output stream errors as one failed terminal", async () => {
    const controller = new AbortController()
    const child = new FakeProcessChild()
    const { observer, events } = createObserver()

    const promise = runProcessAgentTask({
      request: request(controller.signal),
      observer,
      executable: "/tmp/fake-node",
      args: [],
      label: "stream-child",
      terminationGraceMs: 25,
      spawnProcess: spawnFakeChild(child),
    })
    child.stdout.emit("error", new Error("synthetic stdout error"))

    const result = await promise
    expect(result).toMatchObject({
      status: "failed",
      errorCode: "internal_error",
      errorMessage: "stream-child failed while reading process output.",
      result: { signal: "SIGTERM" },
    })
    expect(child.killSignals).toEqual(["SIGTERM"])
    expect(
      events.filter((event) => event.type === "command_finished"),
    ).toHaveLength(1)
  })

  test("contains cancellation observer throws from close callbacks", async () => {
    const controller = new AbortController()
    const child = new FakeProcessChild()
    const { observer: baseObserver, events } = createObserver()
    const observer: AgentRuntimeObserver = {
      ...baseObserver,
      isCancelRequested() {
        throw new Error("synthetic cancellation read failure")
      },
    }

    const promise = runProcessAgentTask({
      request: request(controller.signal),
      observer,
      executable: "/tmp/fake-node",
      args: [],
      label: "close-child",
      spawnProcess: spawnFakeChild(child),
    })
    child.closeSuccessfully()

    const result = await promise
    expect(result).toMatchObject({
      status: "failed",
      errorCode: "internal_error",
      errorMessage:
        "close-child failed while reading process cancellation state.",
    })
    expect(child.killSignals).toEqual([])
    expect(
      events.filter((event) => event.type === "command_finished"),
    ).toHaveLength(1)
  })

  test("contains completion observer throws without retrying the terminal event", async () => {
    const controller = new AbortController()
    const child = new FakeProcessChild()
    const { observer, events } = createObserver({
      onEvent(type) {
        if (type === "command_finished") {
          throw new Error("synthetic completion persistence failure")
        }
      },
    })

    const promise = runProcessAgentTask({
      request: request(controller.signal),
      observer,
      executable: "/tmp/fake-node",
      args: [],
      label: "completion-child",
      spawnProcess: spawnFakeChild(child),
    })
    child.closeSuccessfully()

    const result = await promise
    expect(result).toMatchObject({
      status: "failed",
      errorCode: "internal_error",
      errorMessage:
        "completion-child failed while recording process completion.",
    })
    expect(
      events.filter((event) => event.type === "command_finished"),
    ).toHaveLength(1)
  })
})
