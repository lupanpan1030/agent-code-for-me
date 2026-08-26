import { afterEach, describe, expect, mock, test } from "bun:test"
import type { DesktopRunRequest } from "../src/main/lib/agent-runtime/desktop-run-request"
import { resolveDesktopPermissionPolicy } from "../src/main/lib/agent-runtime/permission-policy"
import type { RunEvent } from "../src/main/lib/agent-runtime/runtime-events"
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

function createRequest(emittedEvents: RunEvent[] = []): DesktopRunRequest {
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
    trace: { emit: (event) => emittedEvents.push(event) },
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
    const emittedEvents: RunEvent[] = []
    const request = createRequest(emittedEvents)
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
    expect(emittedEvents).toHaveLength(1)
    expect(emittedEvents[0]).toMatchObject({
      runId: "run-1",
      jobId: "job-1",
      runtimeId: "claude-code",
      sequence: 0,
      type: "status",
      payload: {
        status: "desktop_runtime_adapter_started",
        adapterSource: "claude-agent-sdk",
        adapterLabel: "Claude Agent SDK",
        attempt: 1,
        temporaryFallback: false,
        fallbackReason: null,
      },
      redaction: {
        status: "not-required",
        appliedRules: [],
      },
    })
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
