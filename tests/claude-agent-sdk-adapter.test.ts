import { afterEach, describe, expect, mock, test } from "bun:test"
import type { DesktopRunRequest } from "../src/main/lib/agent-runtime/desktop-run-request"
import { resolveDesktopPermissionPolicy } from "../src/main/lib/agent-runtime/permission-policy"
import {
  clearClaudeActiveSessionsForTest,
  getActiveClaudeSession,
  setActiveClaudeSession,
} from "../src/main/lib/claude/active-sessions"
import {
  ClaudeAgentSdkLoadError,
  ClaudeAgentSdkQueryStartError,
  createClaudeAgentSdkAdapter,
} from "../src/main/lib/claude/agent-sdk-adapter"
import type { ClaudeAgentSdkQuery } from "../src/main/lib/claude/agent-sdk-query-loader"
import type { ClaudeAgentSdkQueryParams } from "../src/main/lib/claude/agent-sdk-query-options"

type LedgerCall = { port: string; input: Record<string, unknown> }

/** Spy for the Run's host ledger ports the adapter submits to. */
function createLedgerSpy(calls: LedgerCall[] = []) {
  return {
    appendSystemEvent: async (input: Record<string, unknown>) => {
      calls.push({ port: "appendSystemEvent", input })
      return []
    },
    ingestClaudeMessage: async (input: Record<string, unknown>) => {
      calls.push({ port: "ingestClaudeMessage", input })
      return []
    },
  }
}

function createRequest(ledgerCalls: LedgerCall[] = []): DesktopRunRequest {
  const controller = new AbortController()
  setActiveClaudeSession("sub-1", { controller, runId: "run-1" })
  return {
    identity: { runId: "run-1", jobId: "job-1" },
    context: {
      runtimeId: "claude-code",
      mode: "agent",
      projectId: "project-1",
      chatId: "chat-1",
      subChatId: "sub-1",
      cwd: "/repo",
    },
    prompt: "hello",
    permissionPolicy: resolveDesktopPermissionPolicy({
      runtimeId: "claude-code",
      mode: "agent",
    }),
    providerBinding: {},
    mcp: { status: "skipped", serverNames: [], blockers: [] },
    attachments: [],
    ledger: createLedgerSpy(ledgerCalls) as never,
    signal: controller.signal,
    session: {},
  }
}

async function* createStream() {
  yield { type: "message", text: "hello" }
}

describe("Claude Agent SDK adapter", () => {
  afterEach(() => {
    clearClaudeActiveSessionsForTest()
  })

  test("starts the SDK query inside DesktopRuntimeAdapter.run and hands off the stream", async () => {
    const ledgerCalls: LedgerCall[] = []
    const request = createRequest(ledgerCalls)
    const queryOptions = { prompt: "hello", options: {} } as any
    const queryCalls: any[] = []
    const consumedMessages: any[] = []
    const adapter = createClaudeAgentSdkAdapter({
      query: ((params: any) => {
        queryCalls.push(params)
        return createStream()
      }) as any,
      queryOptions,
      consumeStream: async ({ request: consumedRequest, stream }) => {
        expect(consumedRequest).toBe(request)
        for await (const message of stream) {
          consumedMessages.push(message)
        }
        return { status: "succeeded", sessionId: "session-1" }
      },
    })

    expect(adapter.metadata).toMatchObject({
      runtimeId: "claude-code",
      source: "claude-agent-sdk",
      temporaryFallback: false,
    })
    await expect(adapter.run(request)).resolves.toEqual({
      status: "succeeded",
      sessionId: "session-1",
    })
    expect(queryCalls).toEqual([queryOptions])
    expect(consumedMessages).toEqual([{ type: "message", text: "hello" }])
    // refactor-canonical-run-event-ledger (APPROVED design): the adapter-started
    // host fact goes through the Run ledger's appendSystemEvent instead of a
    // sequence=0 RunEvent; the ledger assigns sequence and redaction.
    expect(ledgerCalls).toHaveLength(1)
    expect(ledgerCalls[0]).toMatchObject({
      port: "appendSystemEvent",
      input: {
        type: "status",
        payload: {
          status: "desktop_runtime_adapter_started",
          adapterSource: "claude-agent-sdk",
          adapterLabel: "Claude Agent SDK",
          attempt: 1,
          temporaryFallback: false,
          fallbackReason: null,
        },
      },
    })
  })

  test("forwards the query's correlated system/init and result messages with the resume intent to the Run ledger", async () => {
    const ledgerCalls: LedgerCall[] = []
    const request = createRequest(ledgerCalls)
    const adapter = createClaudeAgentSdkAdapter({
      query: (() =>
        (async function* () {
          yield {
            type: "system",
            subtype: "init",
            session_id: "session-1",
            tools: ["Read"],
          }
          yield { type: "assistant", message: { content: [] } }
          yield {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "done",
          }
        })()) as unknown as ClaudeAgentSdkQuery,
      queryOptions: {
        prompt: "hello",
        options: { resume: "session-1", forkSession: false },
      } as unknown as ClaudeAgentSdkQueryParams,
      consumeStream: async ({ stream }) => {
        for await (const _message of stream) {
          // consume
        }
        return { status: "succeeded", sessionId: "session-1" }
      },
    })

    await adapter.run(request)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const forwarded = ledgerCalls.filter(
      (call) => call.port === "ingestClaudeMessage",
    )
    expect(forwarded.map((call) => call.input.message)).toEqual([
      { type: "system", subtype: "init", session_id: "session-1" },
      { type: "result", subtype: "success" },
    ])
    for (const call of forwarded) {
      expect(call.input.queryId).toBe("claude-query:run-1")
      expect(call.input.resumeIntent).toEqual({
        queryId: "claude-query:run-1",
        resume: "session-1",
        forkSession: false,
      })
    }
  })

  test("loads the SDK query inside the adapter when a query is not injected", async () => {
    const queryOptions = { prompt: "hello", options: {} } as any
    const loadCalls: string[] = []
    const queryCalls: any[] = []
    const adapter = createClaudeAgentSdkAdapter({
      loadQuery: async () => {
        loadCalls.push("load")
        return ((params: any) => {
          queryCalls.push(params)
          return createStream()
        }) as any
      },
      queryOptions,
      consumeStream: async ({ stream }) => {
        for await (const _message of stream) {
          // Consume the stream.
        }
        return { status: "succeeded" }
      },
    })

    await expect(adapter.run(createRequest())).resolves.toEqual({
      status: "succeeded",
    })
    expect(loadCalls).toEqual(["load"])
    expect(queryCalls).toEqual([queryOptions])
  })

  test("does not invoke a loaded SDK query after same-run-id owner replacement during import", async () => {
    let resolveQuery!: (query: ClaudeAgentSdkQuery) => void
    const queryLoaded = new Promise<ClaudeAgentSdkQuery>((resolve) => {
      resolveQuery = resolve
    })
    const query = mock(() => createStream())
    const adapter = createClaudeAgentSdkAdapter({
      loadQuery: () => queryLoaded,
      queryOptions: {
        prompt: "hello",
        options: {},
      } as unknown as ClaudeAgentSdkQueryParams,
      consumeStream: async () => ({ status: "succeeded" }),
    })
    const request = createRequest()
    const ownerA = getActiveClaudeSession("sub-1")
    const run = adapter.run(request)
    await Promise.resolve()

    const controllerB = new AbortController()
    setActiveClaudeSession("sub-1", {
      controller: controllerB,
      runId: "run-1",
    })
    ownerA?.controller.abort()
    resolveQuery(query as unknown as ClaudeAgentSdkQuery)

    await expect(run).resolves.toEqual({ status: "canceled" })
    expect(query).not.toHaveBeenCalled()
    expect(getActiveClaudeSession("sub-1")?.controller).toBe(controllerB)
    expect(controllerB.signal.aborted).toBe(false)
  })

  test("propagates SDK query startup failures to the route boundary", async () => {
    const adapter = createClaudeAgentSdkAdapter({
      query: (() => {
        throw new Error("query failed")
      }) as any,
      queryOptions: { prompt: "hello", options: {} } as any,
      consumeStream: async () => ({ status: "succeeded" }),
    })

    await expect(adapter.run(createRequest())).rejects.toThrow(
      ClaudeAgentSdkQueryStartError,
    )
    await expect(adapter.run(createRequest())).rejects.toMatchObject({
      originalError: expect.objectContaining({ message: "query failed" }),
    })
  })

  test("wraps SDK loader failures for route-level load diagnostics", async () => {
    const adapter = createClaudeAgentSdkAdapter({
      loadQuery: async () => {
        throw new Error("load failed")
      },
      queryOptions: { prompt: "hello", options: {} } as any,
      consumeStream: async () => ({ status: "succeeded" }),
    })

    await expect(adapter.run(createRequest())).rejects.toThrow(
      ClaudeAgentSdkLoadError,
    )
    await expect(adapter.run(createRequest())).rejects.toMatchObject({
      originalError: expect.objectContaining({ message: "load failed" }),
    })
  })
})
