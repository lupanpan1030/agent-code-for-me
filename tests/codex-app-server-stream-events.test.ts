import { describe, expect, test } from "bun:test"
import type { DesktopRunRequest } from "../src/main/lib/agent-runtime/desktop-run-request"
import { resolveDesktopPermissionPolicy } from "../src/main/lib/agent-runtime/permission-policy"
import {
  type CanonicalRunEventLedger,
  createCanonicalRunEventLedger,
  type RuntimeExecutionProvenance,
} from "../src/main/lib/agent-runtime/run-event-ledger"
import { projectRunEventToRendererChunks } from "../src/main/lib/agent-runtime/stream-event-mapper"
import { createCodexAppServerAdapter } from "../src/main/lib/codex/app-server-adapter"
import { decodeCodexNativeBoundary } from "../src/main/lib/codex/app-server-stream-events"
import type {
  CodexAppServerTransport,
  CodexAppServerTransportNotification,
} from "../src/main/lib/codex/app-server-transport"
import { getWorkbenchTraceRow } from "../src/renderer/features/agents/workbench/workbench-trace-presenter"

// refactor-canonical-run-event-ledger: the stateful
// createCodexAppServerRuntimeEventMapper (thread/session/turn/tokenUsage
// state, chunk mapping, buildInterruptRequest) and the chunk -> RunEvent
// mapper are deleted. Native notifications are decoded statelessly by
// decodeCodexNativeBoundary, committed by the Run ledger's ingestNotification
// and reach the renderer as projectRunEventToRendererChunks of the committed
// record; the adapter owns the terminal wait and the renderer-only finish.

type Row = Record<string, unknown>

const RUNTIME_TUPLE: RuntimeExecutionProvenance = {
  kind: "runtime",
  installationId: "inst-codex-app-server-stream-events-test",
  runtimeId: "codex",
  adapterSource: "codex-app-server",
  version: "0.139.0",
  executableRef: "exe-app-server-stream-events-test",
  binarySha256: "c".repeat(64),
  protocolName: "codex-app-server-jsonrpc",
  protocolVersion: "v2",
  schemaFiles: [{ path: "ServerNotification.ts", sha256: "d".repeat(64) }],
}

function memoryStore() {
  const rows: Row[] = []
  return {
    rows,
    appendExact(input: { records: Row[] }) {
      rows.push(...input.records)
      return input.records
    },
    read(_runId: string, after = 0) {
      return rows.filter((row) => Number(row.sequence) > after)
    },
  }
}

function createLedger(provenance: unknown = RUNTIME_TUPLE) {
  const store = memoryStore()
  const ledger = createCanonicalRunEventLedger({
    runId: "run-app-server",
    runtimeId: "codex",
    provenance,
    durableStore: store,
  })
  return { ledger, rows: store.rows }
}

async function ingestNotifications(
  ledger: CanonicalRunEventLedger,
  notifications: CodexAppServerTransportNotification[],
): Promise<Row[]> {
  const records: Row[] = []
  for (const [index, message] of notifications.entries()) {
    records.push(
      ...((await ledger.ingestNotification({
        observationKey: `notification-${index + 1}`,
        message,
      })) as Row[]),
    )
  }
  return records
}

const threadStarted: CodexAppServerTransportNotification = {
  method: "thread/started",
  params: {
    thread: {
      id: "thread-1",
      sessionId: "session-1",
      modelProvider: "locus_profile",
    },
  },
}

const usageNotification: CodexAppServerTransportNotification = {
  method: "thread/tokenUsage/updated",
  params: {
    threadId: "thread-1",
    turnId: "turn-1",
    tokenUsage: {
      last: {
        inputTokens: 10,
        cachedInputTokens: 2,
        outputTokens: 5,
        reasoningOutputTokens: 1,
        totalTokens: 15,
      },
      total: {
        inputTokens: 30,
        cachedInputTokens: 4,
        outputTokens: 12,
        reasoningOutputTokens: 3,
        totalTokens: 42,
      },
      modelContextWindow: 128000,
    },
  },
}

function turnCompleted(
  turn: Record<string, unknown>,
): CodexAppServerTransportNotification {
  return {
    method: "turn/completed",
    params: { threadId: "thread-1", turn },
  }
}

/**
 * Minimal app-server transport: every turn notification, including
 * turn/completed, is delivered synchronously before the turn/start response,
 * so the adapter must read ledger state only after the submitted
 * observations committed.
 */
function createTransport(
  completedTurn: Record<string, unknown>,
): CodexAppServerTransport {
  let onNotification:
    | ((notification: CodexAppServerTransportNotification) => void)
    | null = null
  const notify = (notification: CodexAppServerTransportNotification) => {
    onNotification?.(notification)
  }
  return {
    async request(method) {
      if (method === "initialize") return { userAgent: "codex-test" }
      if (method === "thread/start") {
        onNotification?.(threadStarted)
        return { thread: { id: "thread-1", sessionId: "session-1" } }
      }
      if (method === "mcpServerStatus/list") {
        return { data: [], nextCursor: null }
      }
      if (method === "turn/start") {
        notify({
          method: "turn/started",
          params: {
            threadId: "thread-1",
            turn: { id: "turn-1", status: "inProgress", error: null },
          },
        })
        notify({
          method: "item/agentMessage/delta",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "item-text",
            delta: "hello",
          },
        })
        notify(usageNotification)
        notify(turnCompleted(completedTurn))
        return { turn: { id: "turn-1" } }
      }
      throw new Error(`unexpected method ${method}`)
    },
    notify() {},
    onNotification(handler) {
      onNotification = handler
      return () => {
        onNotification = null
      }
    },
    onServerRequest() {
      return () => {}
    },
    onExit() {
      return () => {}
    },
    close() {
      return Promise.resolve()
    },
  }
}

function createRequest(
  ledger: CanonicalRunEventLedger | null,
): DesktopRunRequest {
  return {
    identity: { runId: "run-app-server", jobId: "run-app-server" },
    context: {
      runtimeId: "codex",
      mode: "plan",
      projectId: "project-1",
      chatId: "chat-1",
      subChatId: "sub-1",
      cwd: "/repo",
    },
    prompt: "hello",
    permissionPolicy: resolveDesktopPermissionPolicy({
      runtimeId: "codex",
      mode: "plan",
      codexAdapterSource: "codex-app-server",
    }),
    providerBinding: { authMode: "runtime-managed" },
    mcp: { status: "skipped", serverNames: [], blockers: [] },
    attachments: [],
    signal: new AbortController().signal,
    session: {},
    ledger,
  }
}

async function runAdapter(input: {
  completedTurn: Record<string, unknown>
  ledger: CanonicalRunEventLedger | null
}) {
  const chunks: Record<string, unknown>[] = []
  const result = await createCodexAppServerAdapter({
    enabled: true,
    createTransport: () => createTransport(input.completedTurn),
    captureExecutionProvenance: async () => RUNTIME_TUPLE,
    emit: (chunk) => chunks.push(chunk),
  }).run(createRequest(input.ledger))
  return { result, chunks }
}

describe("Codex app-server stream event mapper", () => {
  test("maps app-server text/reasoning deltas through normalized RunEvents", async () => {
    const notifications: CodexAppServerTransportNotification[] = [
      threadStarted,
      {
        method: "turn/started",
        params: {
          threadId: "thread-1",
          turn: {
            id: "turn-1",
            status: "inProgress",
            error: null,
          },
        },
      },
      {
        method: "item/agentMessage/delta",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-text",
          delta: "hello",
        },
      },
      {
        method: "item/reasoning/textDelta",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-reasoning",
          delta: "thinking",
        },
      },
    ]
    expect(
      notifications.map(
        (message) => decodeCodexNativeBoundary({ message })[0].kind,
      ),
    ).toEqual([
      "thread_lifecycle",
      "turn_lifecycle",
      "assistant_delta",
      "reasoning_delta",
    ])

    const { ledger } = createLedger()
    const events = await ingestNotifications(ledger, notifications)

    expect(events.map((event) => event.type)).toEqual([
      "status",
      "status",
      "assistant_delta",
      "reasoning_delta",
    ])
    expect(events[2].payload).toMatchObject({
      text: "hello",
      item: { threadId: "thread-1", turnId: "turn-1", itemId: "item-text" },
    })
    expect(events[3].payload).toMatchObject({
      text: "thinking",
      item: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-reasoning",
      },
    })
    expect(events.flatMap(projectRunEventToRendererChunks)).toEqual([
      {
        type: "session-init",
        threadId: "thread-1",
        sessionId: "session-1",
        provider: "codex",
        adapterSource: "codex-app-server",
      },
      {
        type: "start-step",
        id: "turn-1",
        threadId: "thread-1",
        adapterSource: "codex-app-server",
      },
      { type: "text-delta", id: "item-text", delta: "hello" },
      { type: "reasoning-delta", id: "item-reasoning", delta: "thinking" },
    ])
  })

  test("preserves usage vectors and native thread/turn identities in the committed record and renderer metadata", async () => {
    const { ledger } = createLedger()
    const events = await ingestNotifications(ledger, [
      threadStarted,
      usageNotification,
    ])

    expect(events.map((event) => event.type)).toEqual([
      "status",
      "usage_update",
    ])
    expect(events[1].payload).toMatchObject({
      kind: "snapshot",
      last: {
        inputTokens: 10,
        cachedInputTokens: 2,
        outputTokens: 5,
        totalTokens: 15,
      },
      total: { totalTokens: 42 },
      modelContextWindow: 128000,
    })
    expect(projectRunEventToRendererChunks(events[1])).toEqual([
      {
        type: "message-metadata",
        messageMetadata: expect.objectContaining({
          provider: "codex",
          adapterSource: "codex-app-server",
          threadId: "thread-1",
          turnId: "turn-1",
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          cacheReadInputTokens: 2,
          cachedInputTokens: 2,
          cumulativeTotalTokens: 42,
          modelContextWindow: 128000,
        }),
      },
    ])
  })

  // The Workbench trace reads the persisted usage_update payload directly.
  test("the Workbench trace reads token usage from a committed native usage record", async () => {
    const { ledger } = createLedger()
    const [usage] = await ingestNotifications(ledger, [usageNotification])

    expect(
      getWorkbenchTraceRow({
        id: "usage-1",
        jobId: "run-app-server",
        sequence: Number(usage.sequence),
        type: String(usage.type),
        payload: usage.payload,
        createdAt: String(usage.createdAt),
      }).usage,
    ).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cacheReadInputTokens: 2,
      totalInputContextTokens: 10,
      cacheHitRatio: 0.2,
    })
  })

  test("the adapter's finish keeps the session id and cumulative usage of the Run ledger", async () => {
    const { ledger, rows } = createLedger({
      kind: "pending",
      runtimeId: "codex",
    })
    const { result, chunks } = await runAdapter({
      completedTurn: {
        id: "turn-1",
        status: "completed",
        error: null,
        durationMs: 2000,
      },
      ledger,
    })
    await ledger.whenIdle()

    expect(result).toMatchObject({
      status: "succeeded",
      sessionId: "session-1",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    })
    expect(chunks.filter((chunk) => chunk.type === "message-metadata")).toEqual(
      [
        {
          type: "message-metadata",
          messageMetadata: expect.objectContaining({
            threadId: "thread-1",
            turnId: "turn-1",
            inputTokens: 10,
            cumulativeTotalTokens: 42,
          }),
        },
      ],
    )
    expect(chunks.at(-1)).toMatchObject({
      type: "finish",
      status: "succeeded",
      messageMetadata: {
        threadId: "thread-1",
        turnId: "turn-1",
        sessionId: "session-1",
        totalTokens: 15,
        cumulativeTotalTokens: 42,
      },
    })
    // The native terminal is committed only as a candidate: the adapter
    // never mints the Run's completed.
    expect(
      rows.filter(
        (row) => (row.payload as Row | undefined)?.terminalCandidate === true,
      ),
    ).toEqual([
      expect.objectContaining({
        type: "status",
        payload: expect.objectContaining({ turnStatus: "completed" }),
      }),
    ])
    expect(rows.map((row) => row.type)).not.toContain("completed")
  })

  test("preserves interrupted and failed terminal statuses", async () => {
    const interruptedTurn = {
      id: "turn-interrupted",
      status: "interrupted",
      error: null,
    }
    const failedTurn = {
      id: "turn-failed",
      status: "failed",
      error: { message: "model failed" },
    }
    // The stateless decoder keeps the native status as terminal evidence.
    expect(
      decodeCodexNativeBoundary({ message: turnCompleted(failedTurn) }),
    ).toEqual([
      expect.objectContaining({
        kind: "terminal_candidate",
        fields: { turnStatus: "failed", errorMessage: "model failed" },
      }),
    ])

    // Terminal status mapping is the adapter's own and independent of the
    // ledger (a request without a durable job carries ledger: null).
    const interrupted = await runAdapter({
      completedTurn: interruptedTurn,
      ledger: null,
    })
    const failed = await runAdapter({ completedTurn: failedTurn, ledger: null })

    expect(interrupted.result).toEqual({
      status: "interrupted",
      sessionId: "session-1",
    })
    expect(interrupted.chunks.at(-1)).toMatchObject({
      type: "finish",
      status: "interrupted",
    })
    expect(interrupted.chunks.at(-1)).not.toHaveProperty("message")
    expect(failed.result).toMatchObject({
      status: "failed",
      error: { message: "model failed" },
    })
    expect(failed.chunks.at(-1)).toMatchObject({
      type: "finish",
      status: "failed",
      message: "model failed",
    })
  })

  test("fails closed when turn/completed carries a non-terminal or unknown status", async () => {
    const inProgress = await runAdapter({
      completedTurn: {
        id: "turn-in-progress",
        status: "inProgress",
        error: null,
      },
      ledger: null,
    })
    const unknown = await runAdapter({
      completedTurn: {
        id: "turn-unknown",
        status: "future-status",
        error: null,
      },
      ledger: null,
    })

    expect(inProgress.result).toMatchObject({
      status: "failed",
      error: {
        message: expect.stringContaining("non-terminal status inProgress"),
      },
    })
    expect(inProgress.chunks.at(-1)).toMatchObject({
      type: "finish",
      status: "failed",
      message: expect.stringContaining("non-terminal status inProgress"),
    })
    expect(unknown.result).toMatchObject({
      status: "failed",
      error: {
        message: expect.stringContaining(
          "unknown terminal status future-status",
        ),
      },
    })
    expect(unknown.chunks.at(-1)).toMatchObject({
      type: "finish",
      status: "failed",
      message: expect.stringContaining("unknown terminal status future-status"),
    })
  })

  test("maps file-change patch notifications through the pinned native disposition table", async () => {
    const diffText = "diff --git a/canary.txt b/canary.txt"
    const { ledger } = createLedger()
    const events = await ingestNotifications(ledger, [
      {
        method: "item/fileChange/patchUpdated",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "patch-1",
          changes: [{ path: "canary.txt", unifiedDiff: "@@" }],
        },
      },
      {
        method: "turn/diff/updated",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          diff: diffText,
        },
      },
      {
        method: "item/fileChange/outputDelta",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "patch-1",
          delta: "applying patch",
        },
      },
    ])

    expect(events.map((event) => event.type)).toEqual([
      "tool_delta",
      "status",
      "tool_delta",
    ])
    expect(events[0].payload).toMatchObject({
      toolCallId: "patch-1",
      changeCount: 1,
      item: { itemId: "patch-1", channel: "tool" },
    })
    expect(events[1].payload).toMatchObject({
      subtype: "diff_observation",
      method: "turn/diff/updated",
      diffLength: diffText.length,
      contentOmitted: true,
    })
    expect(JSON.stringify(events[1])).not.toContain(diffText)
    expect(events[2].payload).toMatchObject({
      toolCallId: "patch-1",
      output: "applying patch",
      item: { itemId: "patch-1", channel: "tool" },
    })
  })

  test("maps app-server error notifications without creating terminal success", async () => {
    const { ledger, rows } = createLedger()
    const events = await ingestNotifications(ledger, [
      {
        method: "error",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          error: { message: "provider unavailable", code: "provider_error" },
          willRetry: false,
        },
      },
    ])

    expect(events).toEqual([
      expect.objectContaining({
        type: "error",
        payload: expect.objectContaining({
          message: "provider unavailable",
          code: "provider_error",
          willRetry: false,
        }),
      }),
    ])
    expect(projectRunEventToRendererChunks(events[0])).toEqual([
      expect.objectContaining({
        type: "error",
        errorText: "provider unavailable",
        willRetry: false,
      }),
    ])
    expect(rows.map((row) => row.type)).not.toContain("completed")
    expect(await ledger.readOutcome()).toBeNull()
  })
})
