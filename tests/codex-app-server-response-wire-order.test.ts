/**
 * T4-P2 (refactor-canonical-run-event-ledger, negotiation round 1): the
 * Codex stdio transport hands a client request's response to its caller at
 * the parse boundary, so the adapter's response fact enters the Run's serial
 * ingress in wire order with the notifications parsed around it, and a
 * response parsed after a cancel but before the transport closes is still
 * recorded. Driven over the real stdio transport (fake child process), the
 * real adapter and the real ledger over the in-memory SQLite store.
 */
import { describe, expect, test } from "bun:test"
import type { spawn } from "node:child_process"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import type { DesktopRunRequest } from "../src/main/lib/agent-runtime/desktop-run-request"
import { resolveDesktopPermissionPolicy } from "../src/main/lib/agent-runtime/permission-policy"
import { getOrCreateRunEventLedger } from "../src/main/lib/agent-runtime/run-event-ledger-host"
import { createCodexAppServerAdapter } from "../src/main/lib/codex/app-server-adapter"
import {
  type CodexAppServerResponseOutcome,
  type CodexAppServerTransport,
  createCodexAppServerStdioTransport,
} from "../src/main/lib/codex/app-server-transport"
import { chats, projects, subChats } from "../src/main/lib/db/schema"
import { createAndStartDesktopAgentJob } from "../src/main/lib/desktop-agent-jobs"
import { listAgentJobEvents } from "../src/main/lib/headless/job-store"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

type Json = Record<string, unknown>

const PROVENANCE = {
  kind: "runtime",
  installationId: "inst-codex-0.139.0-wire-order",
  runtimeId: "codex",
  adapterSource: "codex-app-server",
  version: "0.139.0",
  executableRef: "exe-wire-order",
  binarySha256: "a".repeat(64),
  protocolName: "codex-app-server-jsonrpc",
  protocolVersion: "v2",
  schemaFiles: [
    { path: "codex-app-server/v2/dispositions.json", sha256: "b".repeat(64) },
  ],
} as const

class FakeChildProcess extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  killed = false
  pid = 4321
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null

  kill(signal: NodeJS.Signals = "SIGTERM") {
    this.killed = true
    this.exitCode = null
    this.signalCode = signal
    this.emit("exit", null, signal)
    this.emit("close", null, signal)
    return true
  }
}

function fakeSpawn(child: FakeChildProcess): typeof spawn {
  return (() => child) as unknown as typeof spawn
}

const line = (message: Json) => `${JSON.stringify(message)}\n`

/**
 * Answers each client request the child reads on stdin. A handler writes
 * its reply (one or several protocol lines, as one stdout chunk); an
 * unhandled method gets an empty result.
 */
function respond(
  child: FakeChildProcess,
  handlers: Record<string, (id: number, params: Json) => void>,
): Array<{ id: number; method: string }> {
  const seen: Array<{ id: number; method: string }> = []
  let buffer = ""
  child.stdin.on("data", (chunk) => {
    buffer += String(chunk)
    let newline = buffer.indexOf("\n")
    while (newline >= 0) {
      const raw = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf("\n")
      if (!raw.trim()) continue
      const message = JSON.parse(raw) as Json
      if (typeof message.method !== "string" || !("id" in message)) continue
      const id = message.id as number
      seen.push({ id, method: message.method })
      const handler = handlers[message.method]
      if (handler) handler(id, (message.params ?? {}) as Json)
      else child.stdout.write(line({ id, result: {} }))
    }
  })
  return seen
}

function seedChat(db: ReturnType<typeof createAgentJobTestDb>) {
  db.insert(projects)
    .values({ id: "project-1", name: "Project", path: "/tmp/project" })
    .run()
  db.insert(chats)
    .values({
      id: "chat-1",
      projectId: "project-1",
      worktreePath: "/tmp/project-worktree",
    })
    .run()
  db.insert(subChats).values({ id: "sub-chat-1", chatId: "chat-1" }).run()
}

async function desktopRun(input: {
  runId: string
  transport: CodexAppServerTransport
  signal: AbortSignal
}) {
  const db = createAgentJobTestDb()
  seedChat(db)
  const permissionPolicy = resolveDesktopPermissionPolicy({
    runtimeId: "codex",
    mode: "agent",
  })
  const { job } = await createAndStartDesktopAgentJob(db, {
    runtime: "codex",
    mode: "agent",
    chatId: "chat-1",
    subChatId: "sub-chat-1",
    cwd: "/tmp/project-worktree",
    prompt: "Implement",
    runId: input.runId,
    permissionPolicy,
  })
  const ledger = await getOrCreateRunEventLedger(db, job)
  const request: DesktopRunRequest = {
    identity: { runId: input.runId, jobId: job.id },
    context: {
      runtimeId: "codex",
      mode: "agent",
      projectId: "project-1",
      chatId: "chat-1",
      subChatId: "sub-chat-1",
      cwd: "/tmp/project-worktree",
    },
    prompt: "Implement",
    permissionPolicy,
    providerBinding: { authMode: "runtime-managed" },
    mcp: { status: "skipped", serverNames: [], blockers: [] },
    attachments: [],
    ledger,
    signal: input.signal,
    session: {},
  }
  const result = await createCodexAppServerAdapter({
    enabled: true,
    createTransport: () => input.transport,
    captureExecutionProvenance: async () => PROVENANCE,
  }).run(request)
  await ledger.whenIdle()
  const records = listAgentJobEvents(db, job.id).map((event) => ({
    sequence: event.sequence,
    type: event.type,
    payload: JSON.parse(event.payloadJson) as Json,
  }))
  return { result, records }
}

const THREAD_STARTED = {
  method: "thread/started",
  params: { thread: { id: "th", sessionId: "session-1" } },
}

describe("T4-P2: Codex responses are ingested in wire order and after cancel", () => {
  test("the stdio transport observes a response before the notifications parsed after it", async () => {
    const child = new FakeChildProcess()
    const transport = createCodexAppServerStdioTransport({
      executable: "/bin/codex",
      spawnProcess: fakeSpawn(child),
    })
    const order: string[] = []
    transport.onNotification((notification) => {
      order.push(`notification:${notification.method}`)
    })
    const seen = respond(child, {
      "turn/start": (id) =>
        child.stdout.write(
          line({ id, result: { turn: { id: "tu" } } }) +
            line({ method: "item/completed", params: {} }) +
            line({ method: "turn/completed", params: {} }),
        ),
    })
    const response = await transport.request(
      "turn/start",
      {},
      {
        onResponse: (outcome: CodexAppServerResponseOutcome) => {
          order.push(`response:${"result" in outcome ? "result" : "error"}`)
        },
      },
    )
    expect(seen.map((entry) => entry.method)).toEqual(["turn/start"])
    expect(response).toEqual({ turn: { id: "tu" } })
    expect(order).toEqual([
      "response:result",
      "notification:item/completed",
      "notification:turn/completed",
    ])
    await transport.close()
  })

  test("one stdout batch response -> item/completed -> turn/completed commits in wire order", async () => {
    const child = new FakeChildProcess()
    const transport = createCodexAppServerStdioTransport({
      executable: "/bin/codex",
      spawnProcess: fakeSpawn(child),
    })
    respond(child, {
      initialize: (id) =>
        child.stdout.write(line({ id, result: { userAgent: "codex-fake" } })),
      "thread/start": (id) =>
        child.stdout.write(
          line(THREAD_STARTED) +
            line({ id, result: { thread: { id: "th", sessionId: "s-1" } } }),
        ),
      "mcpServerStatus/list": (id) =>
        child.stdout.write(
          line({ id, result: { data: [], nextCursor: null } }),
        ),
      "turn/start": (id) => {
        child.stdout.write(
          line({
            method: "turn/started",
            params: {
              threadId: "th",
              turn: { id: "tu", status: "inProgress", error: null },
            },
          }),
        )
        child.stdout.write(
          line({ id, result: { turn: { id: "tu" } } }) +
            line({
              method: "item/completed",
              params: {
                threadId: "th",
                turnId: "tu",
                item: { type: "agentMessage", id: "msg-1", text: "done" },
              },
            }) +
            line({
              method: "turn/completed",
              params: {
                threadId: "th",
                turn: { id: "tu", status: "completed", error: null },
              },
            }),
        )
      },
    })

    const { result, records } = await desktopRun({
      runId: "run-wire-order",
      transport,
      signal: new AbortController().signal,
    })
    expect(result.status).toBe("succeeded")

    const sequenceOf = (
      predicate: (payload: Json, type: string) => boolean,
    ) => {
      const found = records.filter((record) =>
        predicate(record.payload, record.type),
      )
      expect(found).toHaveLength(1)
      return found[0].sequence
    }
    const response = sequenceOf(
      (payload) =>
        payload.subtype === "protocol_response" &&
        payload.method === "turn/start",
    )
    const item = sequenceOf(
      (payload) =>
        payload.subtype === "item_reconciliation" &&
        (payload.item as Json | undefined)?.text === "done",
    )
    const terminal = sequenceOf(
      (payload) =>
        payload.subtype === "turn_lifecycle" &&
        payload.terminalCandidate === true,
    )
    expect(response).toBeLessThan(item)
    expect(item).toBeLessThan(terminal)
  })

  test("a thread/start response parsed after cancel but before close is recorded", async () => {
    const child = new FakeChildProcess()
    const inner = createCodexAppServerStdioTransport({
      executable: "/bin/codex",
      spawnProcess: fakeSpawn(child),
    })
    const controller = new AbortController()
    let releaseResponse: () => void = () => {}
    const responseWritten = new Promise<void>((resolve) => {
      releaseResponse = resolve
    })
    respond(child, {
      initialize: (id) =>
        child.stdout.write(line({ id, result: { userAgent: "codex-fake" } })),
      "thread/start": (id) => {
        // Cancel while thread/start is outstanding; the response arrives
        // after the cancel and before the adapter closes the transport.
        controller.abort()
        setTimeout(() => {
          child.stdout.write(
            line({ id, result: { thread: { id: "th", sessionId: "s-1" } } }),
          )
          setTimeout(releaseResponse, 5)
        }, 0)
      },
    })
    let closedAfterResponse = false
    const transport: CodexAppServerTransport = {
      request: (method, params, options) =>
        inner.request(method, params, options),
      notify: (method, params) => inner.notify(method, params),
      onNotification: (handler) => inner.onNotification(handler),
      onServerRequest: (handler) => inner.onServerRequest(handler),
      onExit: (handler) => inner.onExit(handler),
      close: async () => {
        await responseWritten
        closedAfterResponse = true
        return inner.close()
      },
    }

    const { result, records } = await desktopRun({
      runId: "run-cancel-response",
      transport,
      signal: controller.signal,
    })
    expect(result.status).toBe("canceled")
    expect(closedAfterResponse).toBe(true)
    const responses = records.filter(
      (record) =>
        record.payload.subtype === "protocol_response" &&
        record.payload.method === "thread/start",
    )
    expect(responses).toHaveLength(1)
    expect(responses[0].payload).toMatchObject({ correlated: true })
  })
})
