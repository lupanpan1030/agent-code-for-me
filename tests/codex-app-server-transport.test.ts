import { describe, expect, test } from "bun:test"
import type { spawn } from "node:child_process"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { createCodexAppServerStdioTransport } from "../src/main/lib/codex/app-server-transport"
import { EXACT_SECRET_REDACTION_MARKER } from "../src/shared/secret-redaction-policy"

class FakeChildProcess extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  killed = false
  pid = 1234
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  killSignals: NodeJS.Signals[] = []
  exitOnSignal: NodeJS.Signals | null = "SIGTERM"

  kill(signal: NodeJS.Signals = "SIGTERM") {
    this.killed = true
    this.killSignals.push(signal)
    if (signal === this.exitOnSignal) this.emitExit(null, signal)
    return true
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null) {
    this.exitCode = code
    this.signalCode = signal
    this.emit("exit", code, signal)
    this.emit("close", code, signal)
  }
}

function delay(ms: number): Promise<"pending"> {
  return new Promise((resolve) => setTimeout(() => resolve("pending"), ms))
}

function fakeSpawn(child: FakeChildProcess): typeof spawn {
  return (() => child) as unknown as typeof spawn
}

function deferred(): {
  promise: Promise<void>
  resolve: () => void
} {
  let resolve!: () => void
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function nextWrittenProtocolMessage(
  child: FakeChildProcess,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    child.stdin.once("data", (chunk) => {
      try {
        resolve(JSON.parse(String(chunk).trim()) as Record<string, unknown>)
      } catch (error) {
        reject(error)
      }
    })
  })
}

describe("Codex app-server stdio transport", () => {
  test.each([
    {
      label: "same external runId command replacement",
      method: "item/commandExecution/requestApproval",
      result: { decision: "accept" },
      failClosedResult: { decision: "decline" },
      ownerBRunId: "run-shared",
    },
    {
      label: "different external runId file replacement",
      method: "item/fileChange/requestApproval",
      result: { decision: "accept" },
      failClosedResult: { decision: "decline" },
      ownerBRunId: "run-b",
    },
  ])("rechecks exact owner after an approval barrier before the native $label response", async ({
    method,
    result,
    failClosedResult,
    ownerBRunId,
  }) => {
    const child = new FakeChildProcess()
    const transport = createCodexAppServerStdioTransport({
      executable: "/bin/codex",
      spawnProcess: fakeSpawn(child),
    })
    const ownerA = { runId: "run-shared", token: Symbol("owner-a") }
    const ownerB = { runId: ownerBRunId, token: Symbol("owner-b") }
    let activeOwner = ownerA
    const approvalResolved = deferred()
    const releaseResponse = deferred()
    transport.onServerRequest(async () => {
      approvalResolved.resolve()
      await releaseResponse.promise
      return {
        result,
        failClosedResult,
        isResponseStillAuthorized: () => activeOwner === ownerA,
      }
    })

    const written = nextWrittenProtocolMessage(child)
    child.stdout.write(
      `${JSON.stringify({ id: "approval-1", method, params: {} })}\n`,
    )
    await approvalResolved.promise
    activeOwner = ownerB
    releaseResponse.resolve()

    await expect(written).resolves.toEqual({
      id: "approval-1",
      result: failClosedResult,
    })
    expect(result).toEqual({ decision: "accept" })
    await transport.close()
  })

  test("rechecks abort from subscription cancellation before writing a native permissions grant", async () => {
    const child = new FakeChildProcess()
    const transport = createCodexAppServerStdioTransport({
      executable: "/bin/codex",
      spawnProcess: fakeSpawn(child),
    })
    const controller = new AbortController()
    const approvalResolved = deferred()
    const releaseResponse = deferred()
    const permissions = {
      network: null,
      fileSystem: { read: null, write: ["/repo/src/new.ts"] },
    }
    transport.onServerRequest(async () => {
      approvalResolved.resolve()
      await releaseResponse.promise
      return {
        result: { permissions, scope: "turn", strictAutoReview: true },
        failClosedResult: {
          permissions: {},
          scope: "turn",
          strictAutoReview: true,
        },
        isResponseStillAuthorized: () => !controller.signal.aborted,
      }
    })

    const written = nextWrittenProtocolMessage(child)
    child.stdout.write(
      `${JSON.stringify({
        id: "permissions-1",
        method: "item/permissions/requestApproval",
        params: {},
      })}\n`,
    )
    await approvalResolved.promise
    controller.abort(new Error("exact subscription canceled"))
    releaseResponse.resolve()

    await expect(written).resolves.toEqual({
      id: "permissions-1",
      result: {
        permissions: {},
        scope: "turn",
        strictAutoReview: true,
      },
    })
    await transport.close()
  })

  test("treats a throwing final response predicate as a native denial", async () => {
    const child = new FakeChildProcess()
    const transport = createCodexAppServerStdioTransport({
      executable: "/bin/codex",
      spawnProcess: fakeSpawn(child),
    })
    transport.onServerRequest(() => ({
      result: { decision: "accept" },
      failClosedResult: { decision: "decline" },
      isResponseStillAuthorized: () => {
        throw new Error("owner lookup failed")
      },
    }))

    const written = nextWrittenProtocolMessage(child)
    child.stdout.write(
      `${JSON.stringify({
        id: "command-1",
        method: "item/commandExecution/requestApproval",
        params: {},
      })}\n`,
    )

    await expect(written).resolves.toEqual({
      id: "command-1",
      result: { decision: "decline" },
    })
    await transport.close()
  })

  test("redacts stderr before rejecting pending app-server requests", async () => {
    const child = new FakeChildProcess()
    const transport = createCodexAppServerStdioTransport({
      executable: "/bin/codex",
      spawnProcess: fakeSpawn(child),
    })

    const request = transport.request("initialize", {
      clientInfo: { name: "test" },
      capabilities: {},
    })

    child.stderr.write(
      "failed Authorization: Bearer app-server-secret-token access_token=oauth-secret-token",
    )
    child.emitExit(1, null)

    let message = ""
    try {
      await request
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain("Authorization: <redacted>")
    expect(message).toContain("access_token=<redacted>")
    expect(message).not.toContain("app-server-secret-token")
    expect(message).not.toContain("oauth-secret-token")
    await transport.close()
  })

  test("redacts an exact stderr credential before applying the diagnostic bound", async () => {
    const child = new FakeChildProcess()
    const secret = "ZQTX-boundary-exact-secret"
    const transport = createCodexAppServerStdioTransport({
      executable: "/bin/codex",
      spawnProcess: fakeSpawn(child),
      secretHints: [secret],
    })
    const request = transport.request("initialize", {
      clientInfo: { name: "test" },
      capabilities: {},
    })

    child.stderr.write(`${"x".repeat(996)}${secret}`)
    child.emitExit(1, null)

    let message = ""
    try {
      await request
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).not.toContain(secret)
    expect(message).not.toContain(secret.slice(0, 4))
    expect(message.endsWith("...")).toBe(true)
    await transport.close()
  })

  test("redacts exact hints from app-server protocol errors inside the transport", async () => {
    const child = new FakeChildProcess()
    const secret = "protocol-response-exact-secret"
    const transport = createCodexAppServerStdioTransport({
      executable: "/bin/codex",
      spawnProcess: fakeSpawn(child),
      secretHints: [secret],
    })
    const request = transport.request("initialize", {
      clientInfo: { name: "test" },
      capabilities: {},
    })
    expect(String(child.stdin.read())).not.toContain(secret)

    child.stdout.write(
      `${JSON.stringify({ id: 1, error: { message: `failed with ${secret}` } })}\n`,
    )

    await expect(request).rejects.toThrow(
      `failed with ${EXACT_SECRET_REDACTION_MARKER}`,
    )
    await transport.close()
  })

  test("rejects requests made after the app-server has already exited", async () => {
    const child = new FakeChildProcess()
    const transport = createCodexAppServerStdioTransport({
      executable: "/bin/codex",
      spawnProcess: fakeSpawn(child),
    })
    child.emitExit(0, null)

    await expect(
      transport.request("initialize", {
        clientInfo: { name: "test" },
        capabilities: {},
      }),
    ).rejects.toThrow("exited before completing requests")
    await transport.close()
  })

  test("close waits for the child to actually exit", async () => {
    const child = new FakeChildProcess()
    child.exitOnSignal = null
    const transport = createCodexAppServerStdioTransport({
      executable: "/bin/codex",
      spawnProcess: fakeSpawn(child),
      closeGraceMs: 500,
    })

    const closing = transport.close()
    expect(
      await Promise.race([closing.then(() => "closed" as const), delay(10)]),
    ).toBe("pending")
    expect(child.killSignals).toEqual(["SIGTERM"])

    child.emitExit(null, "SIGTERM")
    await closing
  })

  test("close escalates to SIGKILL when SIGTERM is ignored", async () => {
    const child = new FakeChildProcess()
    child.exitOnSignal = "SIGKILL"
    const transport = createCodexAppServerStdioTransport({
      executable: "/bin/codex",
      spawnProcess: fakeSpawn(child),
      closeGraceMs: 10,
    })

    await transport.close()

    expect(child.killSignals).toEqual(["SIGTERM", "SIGKILL"])
    expect(child.signalCode).toBe("SIGKILL")
  })

  test("close rejects within a bounded interval when neither signal ends the child", async () => {
    const child = new FakeChildProcess()
    child.exitOnSignal = null
    const transport = createCodexAppServerStdioTransport({
      executable: "/bin/codex",
      spawnProcess: fakeSpawn(child),
      closeGraceMs: 10,
    })

    await expect(transport.close()).rejects.toThrow(
      "did not exit after SIGTERM and SIGKILL",
    )
    expect(child.killSignals).toEqual(["SIGTERM", "SIGKILL"])
  })

  test("handles stdin EPIPE without leaving requests pending", async () => {
    const child = new FakeChildProcess()
    const transport = createCodexAppServerStdioTransport({
      executable: "/bin/codex",
      spawnProcess: fakeSpawn(child),
    })
    const request = transport.request("initialize", {
      clientInfo: { name: "test" },
      capabilities: {},
    })

    child.stdin.emit("error", new Error("write EPIPE"))

    await expect(request).rejects.toThrow("write EPIPE")
    await transport.close()
  })

  test("contains notification handler failures and settles lifecycle once", async () => {
    const child = new FakeChildProcess()
    const secret = "notification-handler-secret"
    const transport = createCodexAppServerStdioTransport({
      executable: "/bin/codex",
      spawnProcess: fakeSpawn(child),
      secretHints: [secret],
    })
    const request = transport.request("initialize", {
      clientInfo: { name: "test" },
      capabilities: {},
    })
    const exitCalls: string[] = []
    let settledExitMessage = ""

    transport.onNotification(() => {
      throw new Error(`notification failed with ${secret}`)
    })
    transport.onExit(() => {
      exitCalls.push("throwing-observer")
      throw new Error("observer failure must be contained")
    })
    transport.onExit((exit) => {
      exitCalls.push("settling-observer")
      settledExitMessage = exit.error.message
    })

    expect(() => {
      child.stdout.write(
        `${JSON.stringify({ method: "turn/started", params: {} })}\n`,
      )
    }).not.toThrow()

    await expect(request).rejects.toThrow(
      `notification handler failed: notification failed with ${EXACT_SECRET_REDACTION_MARKER}`,
    )
    expect(settledExitMessage).not.toContain(secret)
    expect(exitCalls).toEqual(["throwing-observer", "settling-observer"])
    expect(child.killSignals).toEqual(["SIGTERM"])

    expect(() => {
      transport.onExit(() => {
        throw new Error("late observer failure must be contained")
      })
    }).not.toThrow()
    await transport.close()
    expect(exitCalls).toEqual(["throwing-observer", "settling-observer"])
  })

  test("fails closed on malformed notifications without duplicate lifecycle settlement", async () => {
    const child = new FakeChildProcess()
    const transport = createCodexAppServerStdioTransport({
      executable: "/bin/codex",
      spawnProcess: fakeSpawn(child),
    })
    const request = transport.request("initialize", {
      clientInfo: { name: "test" },
      capabilities: {},
    })
    let exitCount = 0
    transport.onExit(() => {
      exitCount += 1
    })

    expect(() => {
      child.stdout.write(`${JSON.stringify({ method: 42, params: {} })}\n`)
    }).not.toThrow()

    await expect(request).rejects.toThrow("malformed protocol message")
    await transport.close()
    expect(child.killSignals).toEqual(["SIGTERM"])
    expect(exitCount).toBe(1)
  })
})
