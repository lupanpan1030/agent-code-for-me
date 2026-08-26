import { afterEach, describe, expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  clearActiveGuardedContractsForTest,
  replaceActiveGuardedContractForSubChat,
  type ValidatedAgentScopeContract,
} from "../src/main/lib/agent-guard"
import type { DesktopRunRequest } from "../src/main/lib/agent-runtime/desktop-run-request"
import {
  type DesktopPermissionPolicy,
  resolveDesktopPermissionPolicy,
} from "../src/main/lib/agent-runtime/permission-policy"
import type { RunEvent } from "../src/main/lib/agent-runtime/runtime-events"
import { appendRunEventsToAgentJob } from "../src/main/lib/agent-runtime/stream-event-mapper"
import { createCodexAppServerAdapter } from "../src/main/lib/codex/app-server-adapter"
import { CODEX_CONTROLLED_EDIT_DIFF_CHAR_LIMIT } from "../src/main/lib/codex/app-server-controlled-edit"
import type {
  CodexAppServerClientNotificationMethod,
  CodexAppServerClientRequestMethod,
  CodexAppServerTransport,
  CodexAppServerTransportExit,
  CodexAppServerTransportNotification,
  CodexAppServerTransportServerRequest,
  CodexAppServerTransportServerRequestResponse,
} from "../src/main/lib/codex/app-server-transport"
import { selectCodexAppServerServerRequestResult } from "../src/main/lib/codex/app-server-transport"
import {
  createAgentJob,
  listAgentJobEvents,
} from "../src/main/lib/headless/job-store"
import { EXACT_SECRET_REDACTION_MARKER } from "../src/shared/secret-redaction-policy"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

function createRequest(
  permissionPolicy = resolveDesktopPermissionPolicy({
    runtimeId: "codex",
    mode: "plan",
  }),
  overrides: Partial<DesktopRunRequest> = {},
): DesktopRunRequest {
  return {
    identity: { runId: "run-app-server", jobId: "job-app-server" },
    context: {
      runtimeId: "codex",
      mode: "plan",
      projectId: "project-1",
      chatId: "chat-1",
      subChatId: "sub-1",
      cwd: "/repo",
    },
    prompt: "hello",
    permissionPolicy,
    providerBinding: overrides.providerBinding ?? {
      authMode: "runtime-managed",
    },
    mcp: {
      status: "skipped",
      serverNames: [],
      blockers: [],
    },
    attachments: [],
    trace: overrides.trace ?? { emit: () => {} },
    signal: overrides.signal ?? new AbortController().signal,
    session: {},
    ...overrides,
  }
}

class FakeCodexAppServerTransport implements CodexAppServerTransport {
  requests: Array<{ method: string; params: unknown }> = []
  notifications: Array<{ method: string; params?: unknown }> = []
  closed = false
  notificationHandler:
    | ((notification: CodexAppServerTransportNotification) => void)
    | null = null
  serverRequestHandler:
    | ((
        request: CodexAppServerTransportServerRequest,
      ) => unknown | Promise<unknown>)
    | null = null
  beforeServerResponseWrite?: (input: {
    request: CodexAppServerTransportServerRequest
    response: CodexAppServerTransportServerRequestResponse
  }) => void | Promise<void>
  writtenServerResponses: Array<{
    request: CodexAppServerTransportServerRequest
    result: unknown
  }> = []
  exitHandler: ((exit: CodexAppServerTransportExit) => void) | null = null
  onTurnStart?: () => void | Promise<void>
  assistantDelta = "hello from app-server"
  assistantDeltas: string[] | null = null
  currentThreadId = "thread-1"
  currentSessionId = "session-1"
  blockedRequestMethod: CodexAppServerClientRequestMethod | null = null
  completedTurnStatus: "completed" | "interrupted" | "failed" | "inProgress" =
    "completed"

  async request(
    method: CodexAppServerClientRequestMethod,
    params: unknown,
  ): Promise<unknown> {
    this.requests.push({ method, params })
    if (method === this.blockedRequestMethod) {
      return new Promise(() => {})
    }
    if (method === "initialize") {
      return {
        userAgent: "codex-test",
        codexHome: "/tmp/codex-home",
        platformFamily: "unix",
        platformOs: "macos",
      }
    }
    if (method === "thread/start") {
      this.currentThreadId = "thread-1"
      this.currentSessionId = "session-1"
      this.emitNotification({
        method: "thread/started",
        params: {
          thread: {
            id: this.currentThreadId,
            sessionId: this.currentSessionId,
            modelProvider: "locus_profile",
          },
        },
      })
      return {
        thread: { id: this.currentThreadId, sessionId: this.currentSessionId },
      }
    }
    if (method === "thread/resume") {
      this.currentThreadId = (params as any).threadId
      this.currentSessionId = this.currentThreadId
      return {
        thread: { id: this.currentThreadId, sessionId: this.currentSessionId },
      }
    }
    if (method === "mcpServerStatus/list") {
      return {
        data: [
          {
            name: "smoke-mcp",
            authStatus: "unsupported",
            resourceTemplates: [],
            resources: [],
            tools: {
              smoke_echo: {
                name: "smoke_echo",
                description: "Smoke echo tool",
                inputSchema: { type: "object" },
              },
            },
          },
        ],
        nextCursor: null,
      }
    }
    if (method === "turn/start") {
      this.emitNotification({
        method: "turn/started",
        params: {
          threadId: this.currentThreadId,
          turn: { id: "turn-1", status: "inProgress", error: null },
        },
      })
      await this.onTurnStart?.()
      for (const delta of this.assistantDeltas ?? [this.assistantDelta]) {
        this.emitNotification({
          method: "item/agentMessage/delta",
          params: {
            threadId: this.currentThreadId,
            turnId: "turn-1",
            itemId: "item-1",
            delta,
          },
        })
      }
      this.emitNotification({
        method: "thread/tokenUsage/updated",
        params: {
          threadId: this.currentThreadId,
          turnId: "turn-1",
          tokenUsage: {
            last: {
              inputTokens: 3,
              cachedInputTokens: 0,
              outputTokens: 4,
              reasoningOutputTokens: 0,
              totalTokens: 7,
            },
            total: {
              inputTokens: 3,
              cachedInputTokens: 0,
              outputTokens: 4,
              reasoningOutputTokens: 0,
              totalTokens: 7,
            },
            modelContextWindow: 128000,
          },
        },
      })
      this.emitNotification({
        method: "turn/completed",
        params: {
          threadId: this.currentThreadId,
          turn: {
            id: "turn-1",
            status: this.completedTurnStatus,
            error: null,
          },
        },
      })
      return { turn: { id: "turn-1" } }
    }
    if (method === "turn/interrupt") {
      return {}
    }
    throw new Error(`unexpected method ${method}`)
  }

  notify(
    method: CodexAppServerClientNotificationMethod,
    params?: unknown,
  ): void {
    this.notifications.push({ method, params })
  }

  onNotification(
    handler: (notification: CodexAppServerTransportNotification) => void,
  ): () => void {
    this.notificationHandler = handler
    return () => {
      this.notificationHandler = null
    }
  }

  onServerRequest(
    handler: (
      request: CodexAppServerTransportServerRequest,
    ) =>
      | CodexAppServerTransportServerRequestResponse
      | Promise<CodexAppServerTransportServerRequestResponse>,
  ): () => void {
    this.serverRequestHandler = async (request) => {
      const response = await handler(request)
      await this.beforeServerResponseWrite?.({ request, response })
      const result = selectCodexAppServerServerRequestResult(response)
      this.writtenServerResponses.push({ request, result })
      return result
    }
    return () => {
      this.serverRequestHandler = null
    }
  }

  onExit(handler: (exit: CodexAppServerTransportExit) => void): () => void {
    this.exitHandler = handler
    return () => {
      this.exitHandler = null
    }
  }

  emitExit(error = new Error("Codex app-server exited unexpectedly")) {
    this.exitHandler?.({ code: 1, signal: null, error })
  }

  emitNotification(notification: CodexAppServerTransportNotification) {
    this.notificationHandler?.(notification)
  }

  close(): Promise<void> {
    this.closed = true
    return Promise.resolve()
  }
}

function appServerPolicy(
  mode: "plan" | "agent" = "plan",
  hasScopeContract = false,
) {
  return resolveDesktopPermissionPolicy({
    runtimeId: "codex",
    mode,
    hasScopeContract,
    codexAdapterSource: "codex-app-server",
  })
}

function nonAppServerPolicy(): DesktopPermissionPolicy {
  const policy = appServerPolicy()
  return {
    ...policy,
    runtimeMapping: {
      ...policy.runtimeMapping,
      adapterSource: "legacy-desktop",
    },
  } as unknown as DesktopPermissionPolicy
}

function agentContext() {
  return {
    runtimeId: "codex" as const,
    mode: "agent" as const,
    projectId: "project-1",
    chatId: "chat-1",
    subChatId: "sub-1",
    cwd: "/repo",
  }
}

function guardedContract(cwd = "/repo"): ValidatedAgentScopeContract {
  return {
    id: "contract-1",
    version: 1,
    status: "approved",
    createdAt: "2026-06-12T00:00:00.000Z",
    approvedAt: "2026-06-12T00:00:01.000Z",
    source: "manual",
    chatId: "chat-1",
    subChatId: "sub-1",
    runId: "run-app-server",
    cwd,
    editableScope: [{ path: "src", kind: "directory" }],
    readOnlyEvidence: [],
    successChecks: [{ command: "bun test" }],
    blockedPaths: [],
    expansions: [],
  }
}

function activeGuardedContract(cwd = "/repo"): ValidatedAgentScopeContract {
  const contract = guardedContract(cwd)
  replaceActiveGuardedContractForSubChat(contract.subChatId, contract)
  return contract
}

function createPendingHarness() {
  const chunks: Record<string, any>[] = []
  const pending = new Map<string, { resolve: (approval: any) => void }>()
  return {
    chunks,
    pending,
    adapterInput: {
      emit: (chunk: Record<string, unknown>) => chunks.push(chunk),
      registerPendingQuestion: (
        toolUseId: string,
        question: { resolve: (approval: any) => void },
      ) => {
        pending.set(toolUseId, question)
      },
      unregisterPendingQuestion: (toolUseId: string) => {
        pending.delete(toolUseId)
      },
    },
    approveLatest() {
      const askChunk = chunks.findLast(
        (chunk) => chunk.type === "ask-user-question",
      )
      expect(askChunk).toBeTruthy()
      if (!askChunk || typeof askChunk.approvalId !== "string") {
        throw new Error("Expected an approval request")
      }
      pending.get(askChunk.approvalId)?.resolve({
        approved: true,
        updatedInput: { answers: { Approve: "Approve" } },
      })
      return askChunk
    },
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("Codex app-server adapter", () => {
  afterEach(() => {
    clearActiveGuardedContractsForTest()
  })

  test("declares app-server metadata without marking it as temporary fallback", () => {
    expect(createCodexAppServerAdapter().metadata).toMatchObject({
      runtimeId: "codex",
      source: "codex-app-server",
      label: "Codex app-server adapter",
      temporaryFallback: false,
      fallbackReason: null,
    })
  })

  test("is disabled by default behind an explicit gate", async () => {
    await expect(
      createCodexAppServerAdapter().run(createRequest()),
    ).rejects.toThrow(
      "Codex app-server adapter is behind an explicit gate and is not enabled.",
    )
  })

  test("fails closed when permission policy is not app-server mapping", async () => {
    await expect(
      createCodexAppServerAdapter({ enabled: true }).run(
        createRequest(nonAppServerPolicy()),
      ),
    ).rejects.toThrow(
      "Codex app-server permission policy mapping is not available; refusing app-server startup.",
    )
  })

  test("accepts only the shared app-server permission mapping before transport startup", async () => {
    const transport = new FakeCodexAppServerTransport()
    const events: RunEvent[] = []

    const result = await createCodexAppServerAdapter({
      enabled: true,
      createTransport: () => transport,
    }).run(
      createRequest(appServerPolicy(), {
        trace: { emit: (event) => events.push(event) },
      }),
    )

    expect(result).toMatchObject({
      status: "succeeded",
      sessionId: "session-1",
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
    })
    expect(transport.requests.map((request) => request.method)).toEqual([
      "initialize",
      "thread/start",
      "mcpServerStatus/list",
      "turn/start",
    ])
    expect(transport.notifications).toEqual([{ method: "initialized" }])
    expect(transport.closed).toBe(true)
    expect(events.map((event) => event.type)).toContain("assistant_delta")
    expect(events.map((event) => event.type)).toContain("usage_update")
    expect(events.map((event) => event.type)).toContain("completed")
  })

  test("returns canceled and closes transport when already aborted before listener registration", async () => {
    const controller = new AbortController()
    controller.abort()
    const transport = new FakeCodexAppServerTransport()
    const chunks: Record<string, unknown>[] = []

    const result = await createCodexAppServerAdapter({
      enabled: true,
      createTransport: () => transport,
      emit: (chunk) => chunks.push(chunk),
    }).run(
      createRequest(appServerPolicy(), {
        signal: controller.signal,
      }),
    )

    expect(result.status).toBe("canceled")
    expect(transport.requests).toEqual([])
    expect(transport.closed).toBe(true)
    expect(chunks.filter((chunk) => chunk.type === "finish")).toEqual([
      expect.objectContaining({ type: "finish", status: "canceled" }),
    ])
  })

  test("does not dispatch after prompt preparation loses exact Run ownership", async () => {
    const transport = new FakeCodexAppServerTransport()
    let currentOwner = true
    let resolvePrompt!: (value: {
      prompt: string
      attachmentRefs: never[]
    }) => void
    let markPromptStarted!: () => void
    const promptStarted = new Promise<void>((resolve) => {
      markPromptStarted = resolve
    })
    const resultPromise = createCodexAppServerAdapter({
      enabled: true,
      createTransport: () => transport,
      isCurrentRunOwner: () => currentOwner,
      prepareRuntimePrompt: () => {
        markPromptStarted()
        return new Promise((resolve) => {
          resolvePrompt = resolve
        })
      },
    }).run(createRequest(appServerPolicy()))

    await promptStarted
    currentOwner = false
    resolvePrompt({ prompt: "hello", attachmentRefs: [] })

    await expect(resultPromise).resolves.toMatchObject({ status: "canceled" })
    expect(transport.requests).toEqual([])
    expect(transport.closed).toBe(true)
  })

  test("cancellation escapes a non-cooperative transport request and closes it", async () => {
    const controller = new AbortController()
    const transport = new FakeCodexAppServerTransport()
    transport.blockedRequestMethod = "initialize"

    const run = createCodexAppServerAdapter({
      enabled: true,
      createTransport: () => transport,
    }).run(
      createRequest(appServerPolicy(), {
        signal: controller.signal,
      }),
    )
    await sleep(10)
    controller.abort()

    const result = await Promise.race([
      run,
      sleep(500).then(() => {
        throw new Error("adapter cancellation timed out")
      }),
    ])
    expect(result.status).toBe("canceled")
    expect(transport.requests.map((request) => request.method)).toEqual([
      "initialize",
    ])
    expect(transport.closed).toBe(true)
  })

  test("transport exit escapes a non-cooperative request and fails closed", async () => {
    const transport = new FakeCodexAppServerTransport()
    transport.blockedRequestMethod = "initialize"

    const run = createCodexAppServerAdapter({
      enabled: true,
      createTransport: () => transport,
    }).run(createRequest(appServerPolicy()))
    await sleep(10)
    transport.emitExit(new Error("app-server exited during initialize"))

    const result = await Promise.race([
      run,
      sleep(500).then(() => {
        throw new Error("adapter transport-exit settlement timed out")
      }),
    ])
    expect(result).toMatchObject({
      status: "failed",
      error: { message: "app-server exited during initialize" },
    })
    expect(transport.closed).toBe(true)
  })

  test("fails closed when turn/completed reports a non-terminal status", async () => {
    const transport = new FakeCodexAppServerTransport()
    transport.completedTurnStatus = "inProgress"
    const chunks: Record<string, unknown>[] = []
    const events: RunEvent[] = []

    const result = await createCodexAppServerAdapter({
      enabled: true,
      createTransport: () => transport,
      emit: (chunk) => chunks.push(chunk),
    }).run(
      createRequest(appServerPolicy(), {
        trace: { emit: (event) => events.push(event) },
      }),
    )

    expect(result).toMatchObject({
      status: "failed",
      error: {
        message: expect.stringContaining("non-terminal status inProgress"),
      },
    })
    expect(chunks.filter((chunk) => chunk.type === "finish")).toEqual([
      expect.objectContaining({ type: "finish", status: "failed" }),
    ])
    expect(events.filter((event) => event.type === "completed")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ status: "failed" }),
      }),
    ])
  })

  test("settles failed when app-server exits after turn start", async () => {
    const transport = new FakeCodexAppServerTransport()
    transport.onTurnStart = () => {
      transport.emitExit(new Error("app-server exited during turn"))
    }

    const result = await createCodexAppServerAdapter({
      enabled: true,
      createTransport: () => transport,
    }).run(createRequest(appServerPolicy()))

    expect(result).toMatchObject({
      status: "failed",
      error: { message: "app-server exited during turn" },
    })
    expect(transport.closed).toBe(true)
  })

  test("redacts upstream and gateway echoes from successful response, tool output, and trace persistence", async () => {
    const upstreamToken = randomBytes(32).toString("hex")
    const gatewayToken = randomBytes(32).toString("hex")
    const transport = new FakeCodexAppServerTransport()
    const upstreamSplit = 17
    const gatewaySplit = 19
    transport.assistantDeltas = [
      `successful child echoed ${upstreamToken.slice(0, upstreamSplit)}`,
      `${upstreamToken.slice(upstreamSplit)} and ${gatewayToken.slice(0, gatewaySplit)}`,
      gatewayToken.slice(gatewaySplit),
    ]
    transport.onTurnStart = () => {
      for (const delta of [
        `tool output echoed ${upstreamToken.slice(0, upstreamSplit)}`,
        upstreamToken.slice(upstreamSplit),
      ]) {
        transport.emitNotification({
          method: "item/fileChange/outputDelta",
          params: {
            threadId: transport.currentThreadId,
            turnId: "turn-1",
            itemId: "tool-canary",
            delta,
          },
        })
      }
    }
    const chunks: Record<string, unknown>[] = []
    const events: RunEvent[] = []
    const db = createAgentJobTestDb()
    const job = createAgentJob(db, {
      source: "desktop",
      runtime: "codex",
      mode: "plan",
      cwd: "/repo",
      prompt: "echo canary",
    })

    const result = await createCodexAppServerAdapter({
      enabled: true,
      providerGatewayToken: gatewayToken,
      secretHints: [upstreamToken],
      createTransport: () => transport,
      emit: (chunk) => chunks.push(chunk),
    }).run(
      createRequest(appServerPolicy(), {
        identity: {
          runId: "run-app-server-upstream-canary",
          jobId: job.id,
        },
        providerBinding: {
          authMode: "provider-profile",
          providerProfileId: "profile-1",
          gatewayEndpoint:
            "http://127.0.0.1:4321/profile/profile-1/responses/v1",
          model: "gpt-test",
        },
        trace: {
          emit: (event) => {
            events.push(event)
            appendRunEventsToAgentJob(db, [event])
          },
        },
      }),
    )

    const adapterOutput = JSON.stringify({
      result,
      chunks,
      events,
      persistedEvents: listAgentJobEvents(db, job.id),
    })
    const assistantChunks = chunks.filter(
      (chunk) => chunk.type === "text-delta",
    )
    const assistantEvents = events.filter(
      (event) => event.type === "assistant_delta",
    )
    const toolChunks = chunks.filter(
      (chunk) => chunk.type === "file-change-delta",
    )

    expect(result.status).toBe("succeeded")
    expect(assistantChunks.map((chunk) => chunk.delta).join("")).toBe(
      `successful child echoed ${EXACT_SECRET_REDACTION_MARKER} and ${EXACT_SECRET_REDACTION_MARKER}`,
    )
    expect(toolChunks.map((chunk) => chunk.delta).join("")).toBe(
      `tool output echoed ${EXACT_SECRET_REDACTION_MARKER}`,
    )
    expect(
      assistantEvents.some(
        (event) =>
          event.redaction.status === "redacted" &&
          event.redaction.appliedRules.includes("secret-hint"),
      ),
    ).toBe(true)
    expect(adapterOutput).not.toContain(upstreamToken)
    expect(adapterOutput).not.toContain(gatewayToken)
  })

  test("sends prepared Locus Agent prompt context to turn/start", async () => {
    const transport = new FakeCodexAppServerTransport()

    const result = await createCodexAppServerAdapter({
      enabled: true,
      createTransport: () => transport,
      prepareRuntimePrompt: async ({ prompt }) => ({
        prompt: `prepared:${prompt}`,
        appAgentMentions: ["reviewer"],
        resolvedAppAgents: [],
        missingAppAgents: [],
      }),
    }).run(
      createRequest(appServerPolicy(), {
        prompt: "@[agent:reviewer] hello",
      }),
    )

    const turnStart = transport.requests.find(
      (request) => request.method === "turn/start",
    )
    const input = (
      turnStart?.params as
        | { input: Array<{ type: string; text: string; text_elements: [] }> }
        | undefined
    )?.input

    expect(result.status).toBe("succeeded")
    expect(input?.[0]).toMatchObject({
      type: "text",
      text: "prepared:@[agent:reviewer] hello",
      text_elements: [],
    })
  })

  test("resumes an existing app-server thread through thread/resume", async () => {
    const transport = new FakeCodexAppServerTransport()
    const chunks: Record<string, unknown>[] = []

    const result = await createCodexAppServerAdapter({
      enabled: true,
      createTransport: () => transport,
      emit: (chunk) => chunks.push(chunk),
    }).run(
      createRequest(appServerPolicy(), {
        session: {
          resumeSessionId: "thread-resume-1",
          parentSessionId: "thread-resume-1",
        },
      }),
    )

    expect(result).toMatchObject({
      status: "succeeded",
      sessionId: "thread-resume-1",
    })
    expect(transport.requests.map((request) => request.method)).toEqual([
      "initialize",
      "thread/resume",
      "mcpServerStatus/list",
      "turn/start",
    ])
    expect(
      transport.requests.find((request) => request.method === "thread/resume")
        ?.params,
    ).toMatchObject({
      threadId: "thread-resume-1",
      cwd: "/repo",
      approvalPolicy: "on-request",
    })
    expect(
      transport.requests.find((request) => request.method === "turn/start")
        ?.params,
    ).toMatchObject({
      threadId: "thread-resume-1",
    })
    expect(chunks.find((chunk) => chunk.type === "session-init")).toMatchObject(
      {
        threadId: "thread-resume-1",
        sessionId: "thread-resume-1",
        adapterSource: "codex-app-server",
      },
    )
  })

  test("queries app-server MCP status and emits non-empty readiness summary", async () => {
    const transport = new FakeCodexAppServerTransport()
    const chunks: Record<string, unknown>[] = []

    await createCodexAppServerAdapter({
      enabled: true,
      createTransport: () => transport,
      emit: (chunk) => chunks.push(chunk),
    }).run(
      createRequest(appServerPolicy(), {
        mcp: {
          status: "ready",
          serverNames: ["smoke-mcp"],
          blockers: [],
        },
      }),
    )

    expect(transport.requests.map((request) => request.method)).toContain(
      "mcpServerStatus/list",
    )
    expect(
      transport.requests.find(
        (request) => request.method === "mcpServerStatus/list",
      )?.params,
    ).toEqual({ detail: "toolsAndAuthOnly" })
    expect(
      chunks.find((chunk) => chunk.type === "runtime-status"),
    ).toMatchObject({
      ok: true,
      blocker: {
        component: "mcp",
        status: "ready",
      },
      mcp: {
        serverCount: 1,
        readyServerCount: 1,
        serverNames: ["smoke-mcp"],
        authStatuses: ["unsupported"],
        toolNamesByServer: {
          "smoke-mcp": ["smoke_echo"],
        },
      },
    })
  })

  test("maps guarded app-server runs to untrusted native approval policy", async () => {
    const transport = new FakeCodexAppServerTransport()

    await createCodexAppServerAdapter({
      enabled: true,
      createTransport: () => transport,
    }).run(
      createRequest(appServerPolicy("agent", true), {
        context: agentContext(),
      }),
    )

    const threadStart = transport.requests.find(
      (request) => request.method === "thread/start",
    )
    const turnStart = transport.requests.find(
      (request) => request.method === "turn/start",
    )

    expect((threadStart?.params as any).approvalPolicy).toBe("untrusted")
    expect((turnStart?.params as any).approvalPolicy).toBe("untrusted")
    expect((threadStart?.params as any).sandbox).toBe("workspace-write")
    expect((turnStart?.params as any).sandboxPolicy).toMatchObject({
      type: "workspaceWrite",
      writableRoots: ["/repo"],
    })
  })

  test("exposes controlled edit dynamic tool only for gated direct guarded runs", async () => {
    const transport = new FakeCodexAppServerTransport()

    await createCodexAppServerAdapter({
      enabled: true,
      experimentalApi: true,
      controlledEditEnabled: true,
      guardedContract: activeGuardedContract(),
      createTransport: () => transport,
    }).run(
      createRequest(appServerPolicy("agent", true), {
        context: agentContext(),
      }),
    )

    const threadStart = transport.requests.find(
      (request) => request.method === "thread/start",
    )
    expect((threadStart?.params as any).dynamicTools).toEqual([
      expect.objectContaining({
        namespace: "locus_edit",
        name: "propose_file_edit",
      }),
    ])
    expect((threadStart?.params as any).developerInstructions).toContain(
      "structured file-editing tools",
    )
  })

  test("does not expose controlled edit dynamic tool without experimental app-server capability", async () => {
    const transport = new FakeCodexAppServerTransport()

    await createCodexAppServerAdapter({
      enabled: true,
      controlledEditEnabled: true,
      guardedContract: activeGuardedContract(),
      createTransport: () => transport,
    }).run(
      createRequest(appServerPolicy("agent", true), {
        context: agentContext(),
      }),
    )

    const initialize = transport.requests.find(
      (request) => request.method === "initialize",
    )
    const threadStart = transport.requests.find(
      (request) => request.method === "thread/start",
    )

    expect((initialize?.params as any).capabilities.experimentalApi).toBe(false)
    expect((threadStart?.params as any).dynamicTools).toBeUndefined()
  })

  test("exposes controlled edit dynamic tool on provider-profile gateway runs", async () => {
    const transport = new FakeCodexAppServerTransport()

    await createCodexAppServerAdapter({
      enabled: true,
      experimentalApi: true,
      controlledEditEnabled: true,
      providerGatewayToken: "gateway-token-selected",
      guardedContract: activeGuardedContract(),
      createTransport: () => transport,
    }).run(
      createRequest(appServerPolicy("agent", true), {
        context: agentContext(),
        providerBinding: {
          authMode: "provider-profile",
          providerProfileId: "profile-1",
          gatewayEndpoint:
            "http://127.0.0.1:4321/profile/profile-1/responses/v1",
          model: "deepseek-chat",
        },
      }),
    )

    const threadStart = transport.requests.find(
      (request) => request.method === "thread/start",
    )
    expect((threadStart?.params as any).dynamicTools).toEqual([
      expect.objectContaining({
        namespace: "locus_edit",
        name: "propose_file_edit",
      }),
    ])
    expect((threadStart?.params as any).developerInstructions).toContain(
      "structured file-editing tools",
    )
  })

  test("keeps non-guarded app-server agent runs on on-request native approval policy", async () => {
    const transport = new FakeCodexAppServerTransport()

    await createCodexAppServerAdapter({
      enabled: true,
      createTransport: () => transport,
    }).run(
      createRequest(appServerPolicy("agent"), {
        context: agentContext(),
      }),
    )

    const threadStart = transport.requests.find(
      (request) => request.method === "thread/start",
    )
    const turnStart = transport.requests.find(
      (request) => request.method === "turn/start",
    )

    expect((threadStart?.params as any).approvalPolicy).toBe("on-request")
    expect((turnStart?.params as any).approvalPolicy).toBe("on-request")
  })

  test("rejects raw renderer secrets before app-server transport startup", async () => {
    const request = createRequest(appServerPolicy()) as DesktopRunRequest & {
      customEnv?: Record<string, string>
    }
    request.customEnv = { OPENAI_API_KEY: "sk-raw-renderer-key" }

    await expect(
      createCodexAppServerAdapter({ enabled: true }).run(request),
    ).rejects.toThrow(
      "Secret-bearing Codex app-server renderer input is not allowed: request.customEnv.",
    )
  })

  test("passes provider-profile config through app-server client config without exposing gateway token", async () => {
    const transport = new FakeCodexAppServerTransport()

    await createCodexAppServerAdapter({
      enabled: true,
      providerGatewayToken: "gateway-token-selected",
      createTransport: ({ providerBinding }) => {
        expect(providerBinding.runtimeEnv).toMatchObject({
          LOCUS_CODEX_PROVIDER_GATEWAY_TOKEN: "gateway-token-selected",
        })
        expect(JSON.stringify(providerBinding.client)).not.toContain(
          "gateway-token-selected",
        )
        return transport
      },
    }).run(
      createRequest(appServerPolicy(), {
        providerBinding: {
          authMode: "provider-profile",
          providerProfileId: "profile-1",
          gatewayEndpoint:
            "http://127.0.0.1:4321/profile/profile-1/responses/v1",
          model: "deepseek-chat",
        },
      }),
    )

    const threadStart = transport.requests.find(
      (request) => request.method === "thread/start",
    )
    expect(threadStart?.params).toMatchObject({
      model: "deepseek-chat",
      modelProvider: "locus_profile",
      config: {
        "model_providers.locus_profile.env_key":
          "LOCUS_CODEX_PROVIDER_GATEWAY_TOKEN",
      },
    })
    expect(JSON.stringify(threadStart?.params)).not.toContain(
      "gateway-token-selected",
    )
  })

  test("scrubs app-server selected secret env from Codex shell snapshots before and after run", async () => {
    const codexHome = mkdtempSync(
      join(tmpdir(), "locus-app-server-codex-home-"),
    )
    try {
      const snapshotDir = join(codexHome, "shell_snapshots")
      mkdirSync(snapshotDir, { recursive: true })
      const staleSnapshot = join(snapshotDir, "stale.sh")
      const runtimeSnapshot = join(snapshotDir, "runtime.sh")
      writeFileSync(
        staleSnapshot,
        "export LOCUS_CODEX_PROVIDER_GATEWAY_TOKEN=gateway-token-selected\n",
      )
      const transport = new FakeCodexAppServerTransport()
      transport.onTurnStart = () => {
        writeFileSync(
          runtimeSnapshot,
          [
            "export LOCUS_CODEX_PROVIDER_GATEWAY_TOKEN=gateway-token-selected",
            "printf gateway-token-selected",
          ].join("\n"),
        )
      }

      await createCodexAppServerAdapter({
        enabled: true,
        providerGatewayToken: "gateway-token-selected",
        processEnv: {
          CODEX_HOME: codexHome,
          HOME: "/Users/example",
          PATH: "/usr/bin",
        },
        createTransport: ({ providerBinding }) => {
          expect(providerBinding.runtimeEnv).toMatchObject({
            CODEX_HOME: codexHome,
            LOCUS_CODEX_PROVIDER_GATEWAY_TOKEN: "gateway-token-selected",
          })
          expect(readFileSync(staleSnapshot, "utf8")).not.toContain(
            "gateway-token-selected",
          )
          return transport
        },
      }).run(
        createRequest(appServerPolicy(), {
          providerBinding: {
            authMode: "provider-profile",
            providerProfileId: "profile-1",
            gatewayEndpoint:
              "http://127.0.0.1:4321/profile/profile-1/responses/v1",
            model: "deepseek-chat",
          },
        }),
      )

      const stale = readFileSync(staleSnapshot, "utf8")
      const runtime = readFileSync(runtimeSnapshot, "utf8")
      expect(stale).not.toContain("LOCUS_CODEX_PROVIDER_GATEWAY_TOKEN")
      expect(stale).not.toContain("gateway-token-selected")
      expect(runtime).not.toContain("LOCUS_CODEX_PROVIDER_GATEWAY_TOKEN")
      expect(runtime).not.toContain("gateway-token-selected")
    } finally {
      rmSync(codexHome, { recursive: true, force: true })
    }
  })

  test("scrubs app-managed Codex API key snapshots before and after run", async () => {
    const codexHome = mkdtempSync(
      join(tmpdir(), "locus-app-server-codex-home-"),
    )
    try {
      const snapshotDir = join(codexHome, "shell_snapshots")
      mkdirSync(snapshotDir, { recursive: true })
      const staleSnapshot = join(snapshotDir, "stale-api-key.sh")
      const runtimeSnapshot = join(snapshotDir, "runtime-api-key.sh")
      writeFileSync(
        staleSnapshot,
        "export CODEX_API_KEY=sk-app-managed-selected\n",
      )
      const transport = new FakeCodexAppServerTransport()
      transport.onTurnStart = () => {
        writeFileSync(
          runtimeSnapshot,
          [
            "export CODEX_API_KEY=sk-app-managed-selected",
            "printf sk-app-managed-selected",
          ].join("\n"),
        )
      }

      await createCodexAppServerAdapter({
        enabled: true,
        appManagedApiKey: "sk-app-managed-selected",
        processEnv: {
          CODEX_HOME: codexHome,
          HOME: "/Users/example",
          PATH: "/usr/bin",
        },
        createTransport: ({ providerBinding }) => {
          expect(providerBinding.runtimeEnv).toMatchObject({
            CODEX_HOME: codexHome,
            CODEX_API_KEY: "sk-app-managed-selected",
          })
          expect(readFileSync(staleSnapshot, "utf8")).not.toContain(
            "sk-app-managed-selected",
          )
          return transport
        },
      }).run(
        createRequest(appServerPolicy(), {
          providerBinding: {
            authMode: "app-managed",
            model: "gpt-5-codex",
          },
        }),
      )

      const stale = readFileSync(staleSnapshot, "utf8")
      const runtime = readFileSync(runtimeSnapshot, "utf8")
      expect(stale).not.toContain("CODEX_API_KEY")
      expect(stale).not.toContain("sk-app-managed-selected")
      expect(runtime).not.toContain("CODEX_API_KEY")
      expect(runtime).not.toContain("sk-app-managed-selected")
    } finally {
      rmSync(codexHome, { recursive: true, force: true })
    }
  })

  test("publishes one failed terminal only after post-run snapshot verification fails", async () => {
    const codexHome = mkdtempSync(
      join(tmpdir(), "locus-app-server-terminal-gate-"),
    )
    try {
      const snapshotDir = join(codexHome, "shell_snapshots")
      mkdirSync(snapshotDir, { recursive: true })
      const outsideSnapshot = join(codexHome, "outside.sh")
      writeFileSync(outsideSnapshot, "export SAFE=value\n")
      const transport = new FakeCodexAppServerTransport()
      transport.onTurnStart = () => {
        symlinkSync(outsideSnapshot, join(snapshotDir, "unverified.sh"))
      }
      const chunks: Record<string, unknown>[] = []
      const events: RunEvent[] = []

      const result = await createCodexAppServerAdapter({
        enabled: true,
        appManagedApiKey: "sk-app-managed-selected",
        processEnv: {
          CODEX_HOME: codexHome,
          HOME: "/Users/example",
          PATH: "/usr/bin",
        },
        createTransport: () => transport,
        emit: (chunk) => chunks.push(chunk),
      }).run(
        createRequest(appServerPolicy(), {
          trace: { emit: (event) => events.push(event) },
          providerBinding: {
            authMode: "app-managed",
            model: "gpt-5-codex",
          },
        }),
      )

      expect(result.status).toBe("failed")
      expect(chunks.at(-1)).toMatchObject({
        type: "finish",
        status: "failed",
      })
      expect(chunks.filter((chunk) => chunk.type === "finish")).toHaveLength(1)
      expect(
        chunks.some(
          (chunk) =>
            chunk.type === "runtime-status" &&
            chunk.ok === false &&
            (chunk.blocker as { component?: unknown } | undefined)
              ?.component === "security",
        ),
      ).toBe(true)
      const completedEvents = events.filter(
        (event) => event.type === "completed",
      )
      expect(completedEvents).toHaveLength(1)
      expect(completedEvents[0]?.payload).toMatchObject({ status: "failed" })
      expect(events.at(-1)?.type).toBe("completed")
    } finally {
      rmSync(codexHome, { recursive: true, force: true })
    }
  })

  test("applies app-server experimental API and config overrides only when explicitly enabled", async () => {
    const transport = new FakeCodexAppServerTransport()

    await createCodexAppServerAdapter({
      enabled: true,
      experimentalApi: true,
      configOverrides: {
        "features.apply_patch_freeform": true,
        "tools.apply_patch.enabled": true,
      },
      createTransport: () => transport,
    }).run(createRequest(appServerPolicy()))

    const initialize = transport.requests.find(
      (request) => request.method === "initialize",
    )
    const threadStart = transport.requests.find(
      (request) => request.method === "thread/start",
    )

    expect(initialize?.params).toMatchObject({
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
    })
    expect(threadStart?.params).toMatchObject({
      config: {
        "features.apply_patch_freeform": true,
        "tools.apply_patch.enabled": true,
      },
    })
  })

  test("applies Codex plugin config overrides after ordinary app-server config", async () => {
    const transport = new FakeCodexAppServerTransport()

    await createCodexAppServerAdapter({
      enabled: true,
      configOverrides: {
        "features.apply_patch_freeform": true,
        "plugins.figma@openai-curated.enabled": true,
      },
      pluginConfigOverrides: {
        "plugins.figma@openai-curated.enabled": false,
        "plugins.github@openai-curated.enabled": true,
      },
      createTransport: () => transport,
    }).run(createRequest(appServerPolicy()))

    const threadStart = transport.requests.find(
      (request) => request.method === "thread/start",
    )

    expect(threadStart?.params).toMatchObject({
      config: {
        "features.apply_patch_freeform": true,
        "plugins.figma@openai-curated.enabled": false,
        "plugins.github@openai-curated.enabled": true,
      },
    })
  })

  test("uses isolated plugin home env and staged plugin config for app-server startup", async () => {
    const transport = new FakeCodexAppServerTransport()
    const prepareCalls: unknown[] = []

    await createCodexAppServerAdapter({
      enabled: true,
      configOverrides: {
        "features.apply_patch_freeform": true,
      },
      pluginConfig: {
        config: {
          "plugins.figma@openai-curated.enabled": true,
        },
        entries: [
          {
            pluginId: "figma@openai-curated",
            pluginSource: "openai-curated:figma@7118aaa3",
            enabled: true,
            pluginPath:
              "/global/.codex/plugins/cache/openai-curated/figma/7118aaa3",
            cacheCoordinates: {
              marketplace: "openai-curated",
              name: "figma",
              version: "7118aaa3",
            },
            nativeActivationPolicy: {
              status: "allowed",
              canActivateNative: true,
              identityStatus: "reviewed",
              reasons: [],
            },
          },
        ],
      },
      preparePluginHome: async (input) => {
        prepareCalls.push(input)
        return {
          codexHome: "/isolated/codex-home/sub-1",
          runtimeEnv: {
            ...input.runtimeEnv,
            CODEX_HOME: "/isolated/codex-home/sub-1",
          },
          pluginConfigOverrides: {
            "plugins.figma@openai-curated.enabled": true,
            "plugins.github@openai-curated.enabled": false,
          },
          stagedEntries: [
            {
              pluginId: "figma@openai-curated",
              pluginSource: "openai-curated:figma@7118aaa3",
              sourcePath:
                "/global/.codex/plugins/cache/openai-curated/figma/7118aaa3",
              stagedPath:
                "/isolated/codex-home/sub-1/plugins/cache/openai-curated/figma/7118aaa3",
            },
          ],
          blockedEntries: [],
        }
      },
      createTransport: ({ providerBinding }) => {
        expect(providerBinding.runtimeEnv.CODEX_HOME).toBe(
          "/isolated/codex-home/sub-1",
        )
        return transport
      },
    }).run(
      createRequest(appServerPolicy(), {
        mcpSessionServers: [
          {
            name: "locus_edit",
            type: "stdio",
            command: "/usr/bin/node",
            args: ["server.js"],
            env: [{ name: "TOKEN", value: "secret" }],
          },
        ],
      }),
    )

    expect(prepareCalls).toHaveLength(1)
    expect(prepareCalls[0]).toMatchObject({
      pluginConfig: {
        config: {
          "plugins.figma@openai-curated.enabled": true,
        },
      },
      mcpServers: [
        {
          name: "locus_edit",
          type: "stdio",
          command: "/usr/bin/node",
          args: ["server.js"],
          env: [{ name: "TOKEN", value: "secret" }],
        },
      ],
    })
    const threadStart = transport.requests.find(
      (request) => request.method === "thread/start",
    )
    expect(threadStart?.params).toMatchObject({
      config: {
        "features.apply_patch_freeform": true,
        "plugins.figma@openai-curated.enabled": true,
        "plugins.github@openai-curated.enabled": false,
      },
    })
  })

  test("passes allowlisted CODEX_HOME to app-server without inheriting host secrets", async () => {
    const transport = new FakeCodexAppServerTransport()

    await createCodexAppServerAdapter({
      enabled: true,
      processEnv: {
        PATH: "/usr/bin",
        CODEX_HOME: "/tmp/locus-codex-home",
        OPENAI_API_KEY: "stale-openai-key",
        GITHUB_TOKEN: "stale-github-token",
      },
      createTransport: ({ providerBinding }) => {
        expect(providerBinding.runtimeEnv).toMatchObject({
          PATH: "/usr/bin",
          CODEX_HOME: "/tmp/locus-codex-home",
        })
        expect(providerBinding.runtimeEnv).not.toHaveProperty("OPENAI_API_KEY")
        expect(providerBinding.runtimeEnv).not.toHaveProperty("GITHUB_TOKEN")
        return transport
      },
    }).run(createRequest(appServerPolicy()))
  })

  test("sends turn interrupt when the desktop run is canceled after turn start", async () => {
    const transport = new FakeCodexAppServerTransport()
    const controller = new AbortController()
    transport.onTurnStart = () => controller.abort()

    await createCodexAppServerAdapter({
      enabled: true,
      createTransport: () => transport,
    }).run(
      createRequest(appServerPolicy(), {
        signal: controller.signal,
      }),
    )

    expect(
      transport.requests.some(
        (request) =>
          request.method === "turn/interrupt" &&
          (request.params as any).threadId === "thread-1" &&
          (request.params as any).turnId === "turn-1",
      ),
    ).toBe(true)
  })

  test("denies app-server side-effect server requests by default", async () => {
    const transport = new FakeCodexAppServerTransport()
    transport.onTurnStart = async () => {
      const response = await transport.serverRequestHandler?.({
        id: "approval-1",
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-approval",
          startedAtMs: Date.now(),
          command: "rm -rf .",
        },
      })
      expect(response).toEqual({ decision: "decline" })
    }

    await createCodexAppServerAdapter({
      enabled: true,
      createTransport: () => transport,
    }).run(createRequest(appServerPolicy()))
  })

  test("binds an approved command response to the exact Run owner across a same-run-id replacement", async () => {
    const transport = new FakeCodexAppServerTransport()
    const harness = createPendingHarness()
    const ownerA = { runId: "run-app-server", token: Symbol("owner-a") }
    const ownerB = { runId: "run-app-server", token: Symbol("owner-b") }
    let activeOwner = ownerA

    transport.beforeServerResponseWrite = ({ response }) => {
      // This hook is the deterministic native-write barrier: user approval
      // has resolved, but the transport has not performed its final predicate
      // check or serialized the response yet.
      expect(response.result).toEqual({ decision: "accept" })
      activeOwner = ownerB
    }
    transport.onTurnStart = async () => {
      const responsePromise = transport.serverRequestHandler?.({
        id: "same-id-command",
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-command",
          startedAtMs: Date.now(),
          command: "bun test",
        },
      })
      harness.approveLatest()
      await expect(responsePromise).resolves.toEqual({ decision: "decline" })
    }

    await createCodexAppServerAdapter({
      enabled: true,
      createTransport: () => transport,
      isCurrentRunOwner: () => activeOwner === ownerA,
      ...harness.adapterInput,
    }).run(
      createRequest(appServerPolicy("agent"), {
        context: agentContext(),
      }),
    )

    expect(transport.writtenServerResponses).toEqual([
      {
        request: expect.objectContaining({ id: "same-id-command" }),
        result: { decision: "decline" },
      },
    ])
  })

  for (const invalidation of ["replacement", "clear"] as const) {
    test(`fails closed at the native write barrier after guarded contract ${invalidation}`, async () => {
      const transport = new FakeCodexAppServerTransport()
      const harness = createPendingHarness()
      const contractA = guardedContract()
      replaceActiveGuardedContractForSubChat(contractA.subChatId, contractA)
      let exactRunOwnerCurrent = true

      transport.beforeServerResponseWrite = ({ response }) => {
        // Approval has resolved and the exact Run still owns execution, but a
        // later admission can replace or clear the captured guard contract
        // before the transport's synchronous final authorization check.
        expect(response.result).toEqual({ decision: "accept" })
        expect(exactRunOwnerCurrent).toBe(true)
        replaceActiveGuardedContractForSubChat(
          contractA.subChatId,
          invalidation === "replacement" ? guardedContract() : null,
        )
      }
      transport.onTurnStart = async () => {
        const responsePromise = transport.serverRequestHandler?.({
          id: `guard-contract-${invalidation}`,
          method: "item/fileChange/requestApproval",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "item-file",
            startedAtMs: Date.now(),
            grantRoot: "src/app.ts",
          },
        })
        harness.approveLatest()
        await expect(responsePromise).resolves.toEqual({ decision: "decline" })
      }

      await createCodexAppServerAdapter({
        enabled: true,
        createTransport: () => transport,
        guardedContract: contractA,
        isCurrentRunOwner: () => exactRunOwnerCurrent,
        ...harness.adapterInput,
      }).run(
        createRequest(appServerPolicy("agent", true), {
          context: agentContext(),
        }),
      )

      expect(transport.writtenServerResponses).toEqual([
        {
          request: expect.objectContaining({
            id: `guard-contract-${invalidation}`,
          }),
          result: { decision: "decline" },
        },
      ])
      exactRunOwnerCurrent = false
    })
  }

  test("bridges app-server user-input requests through shared pending question owner", async () => {
    const transport = new FakeCodexAppServerTransport()
    const { chunks, pending, adapterInput } = createPendingHarness()

    transport.onTurnStart = async () => {
      const responsePromise = transport.serverRequestHandler?.({
        id: "question-1",
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-question",
          questions: [
            {
              id: "q-confirm",
              header: "Confirm",
              question: "Proceed?",
              isOther: false,
              isSecret: false,
              options: [{ label: "Yes", description: "" }],
            },
          ],
        },
      })

      const askChunk = chunks.find(
        (chunk) => chunk.type === "ask-user-question",
      )
      expect(askChunk).toMatchObject({
        type: "ask-user-question",
        toolUseId: "codex-app-server-user-input-question-1",
        questions: [{ question: "Proceed?" }],
      })
      if (!askChunk || typeof askChunk.approvalId !== "string") {
        throw new Error("Expected a user-input approval request")
      }
      pending.get(askChunk.approvalId)?.resolve({
        approved: true,
        updatedInput: { answers: { "Proceed?": "Yes" } },
      })

      await expect(responsePromise).resolves.toEqual({
        answers: { "q-confirm": { answers: ["Yes"] } },
      })
    }

    await createCodexAppServerAdapter({
      enabled: true,
      createTransport: () => transport,
      ...adapterInput,
    }).run(createRequest(appServerPolicy()))

    expect(pending.size).toBe(0)
    expect(chunks.map((chunk) => chunk.type)).toContain(
      "ask-user-question-result",
    )
  })

  test("bridges guarded file approval grant through shared pending question owner", async () => {
    const transport = new FakeCodexAppServerTransport()
    const harness = createPendingHarness()

    transport.onTurnStart = async () => {
      const responsePromise = transport.serverRequestHandler?.({
        id: "file-1",
        method: "item/fileChange/requestApproval",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-file",
          startedAtMs: Date.now(),
          grantRoot: "src/app.ts",
        },
      })
      const askChunk = harness.approveLatest()
      expect(askChunk.toolUseId).toContain("file-approval")
      await expect(responsePromise).resolves.toEqual({ decision: "accept" })
    }

    await createCodexAppServerAdapter({
      enabled: true,
      createTransport: () => transport,
      guardedContract: activeGuardedContract(),
      ...harness.adapterInput,
    }).run(
      createRequest(appServerPolicy("agent", true), {
        context: agentContext(),
      }),
    )

    expect(harness.pending.size).toBe(0)
    expect(harness.chunks.map((chunk) => chunk.type)).toContain("guard-event")
    expect(harness.chunks.map((chunk) => chunk.type)).toContain(
      "ask-user-question-result",
    )
  })

  test("applies approved controlled edit dynamic tool calls from the main process", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "locus-controlled-edit-"))
    const transport = new FakeCodexAppServerTransport()
    const harness = createPendingHarness()

    try {
      transport.onTurnStart = async () => {
        const responsePromise = transport.serverRequestHandler?.({
          id: "dynamic-tool-1",
          method: "item/tool/call",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            callId: "controlled-edit-1",
            namespace: "locus_edit",
            tool: "propose_file_edit",
            arguments: {
              operation: "create",
              path: "src/generated.txt",
              content: "created by controlled edit\n",
            },
          },
        })
        const diffChunk = harness.chunks.find(
          (chunk) => chunk.type === "file-change-diff",
        )
        expect(diffChunk).toMatchObject({
          path: "src/generated.txt",
          operation: "create",
        })
        const askChunk = harness.approveLatest()
        expect(askChunk.toolUseId).toContain("controlled-edit-approval")
        await expect(responsePromise).resolves.toMatchObject({
          success: true,
        })
      }

      await createCodexAppServerAdapter({
        enabled: true,
        experimentalApi: true,
        controlledEditEnabled: true,
        createTransport: () => transport,
        guardedContract: activeGuardedContract(cwd),
        ...harness.adapterInput,
      }).run(
        createRequest(appServerPolicy("agent", true), {
          context: { ...agentContext(), cwd },
        }),
      )

      expect(readFileSync(join(cwd, "src/generated.txt"), "utf8")).toBe(
        "created by controlled edit\n",
      )
      expect(harness.chunks.map((chunk) => chunk.type)).toContain(
        "file-change-delta",
      )
      expect(harness.chunks.map((chunk) => chunk.type)).toContain("guard-event")
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test("redacts an exact controlled-edit credential before bounding renderer diff text", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "locus-controlled-edit-boundary-"))
    const transport = new FakeCodexAppServerTransport()
    const harness = createPendingHarness()
    const secret = "ZQTX-controlled-edit-boundary-secret"
    const relativePath = "src/generated.txt"
    const diffPrefix = `--- /dev/null\n+++ ${relativePath}\n@@\n+`
    const secretStart =
      CODEX_CONTROLLED_EDIT_DIFF_CHAR_LIMIT -
      EXACT_SECRET_REDACTION_MARKER.length
    const content = `${"x".repeat(secretStart - diffPrefix.length)}${secret}`

    try {
      transport.onTurnStart = async () => {
        const responsePromise = transport.serverRequestHandler?.({
          id: "dynamic-tool-boundary",
          method: "item/tool/call",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            callId: "controlled-edit-boundary",
            namespace: "locus_edit",
            tool: "propose_file_edit",
            arguments: {
              operation: "create",
              path: relativePath,
              content,
            },
          },
        })
        const diffChunk = harness.chunks.find(
          (chunk) => chunk.type === "file-change-diff",
        )
        const askChunk = harness.approveLatest()
        const rendererText = JSON.stringify({ diffChunk, askChunk })
        expect(rendererText).toContain(EXACT_SECRET_REDACTION_MARKER)
        expect(rendererText).not.toContain(secret)
        expect(rendererText).not.toContain(secret.slice(0, 6))
        await expect(responsePromise).resolves.toMatchObject({ success: true })
      }

      await createCodexAppServerAdapter({
        enabled: true,
        experimentalApi: true,
        controlledEditEnabled: true,
        createTransport: () => transport,
        guardedContract: activeGuardedContract(cwd),
        secretHints: [secret],
        ...harness.adapterInput,
      }).run(
        createRequest(appServerPolicy("agent", true), {
          context: { ...agentContext(), cwd },
        }),
      )

      expect(readFileSync(join(cwd, relativePath), "utf8")).toBe(content)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test("fails closed for controlled edit dynamic tool calls outside guarded scope", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "locus-controlled-edit-"))
    const transport = new FakeCodexAppServerTransport()
    const harness = createPendingHarness()
    const contract = guardedContract(cwd)
    replaceActiveGuardedContractForSubChat(contract.subChatId, contract)

    try {
      transport.onTurnStart = async () => {
        const response = await transport.serverRequestHandler?.({
          id: "dynamic-tool-out-of-scope",
          method: "item/tool/call",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            callId: "controlled-edit-out-of-scope",
            namespace: "locus_edit",
            tool: "propose_file_edit",
            arguments: {
              operation: "create",
              path: "docs/out-of-scope.txt",
              content: "should not write\n",
            },
          },
        })
        expect(response).toMatchObject({
          success: false,
        })
      }

      await createCodexAppServerAdapter({
        enabled: true,
        experimentalApi: true,
        controlledEditEnabled: true,
        createTransport: () => transport,
        guardedContract: contract,
        ...harness.adapterInput,
      }).run(
        createRequest(appServerPolicy("agent", true), {
          context: { ...agentContext(), cwd },
        }),
      )

      expect(existsSync(join(cwd, "docs/out-of-scope.txt"))).toBe(false)
      expect(harness.chunks.map((chunk) => chunk.type)).toContain("guard-event")
      expect(harness.chunks.map((chunk) => chunk.type)).not.toContain(
        "ask-user-question",
      )
    } finally {
      clearActiveGuardedContractsForTest()
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test("does not write controlled edits when the user denies approval", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "locus-controlled-edit-"))
    const transport = new FakeCodexAppServerTransport()
    const harness = createPendingHarness()

    try {
      transport.onTurnStart = async () => {
        const responsePromise = transport.serverRequestHandler?.({
          id: "dynamic-tool-deny",
          method: "item/tool/call",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            callId: "controlled-edit-deny",
            namespace: "locus_edit",
            tool: "propose_file_edit",
            arguments: {
              operation: "create",
              path: "src/denied.txt",
              content: "should not write\n",
            },
          },
        })
        const askChunk = harness.chunks.find(
          (chunk) => chunk.type === "ask-user-question",
        )
        expect(askChunk).toBeTruthy()
        if (!askChunk || typeof askChunk.approvalId !== "string") {
          throw new Error("Expected a controlled-edit approval request")
        }
        harness.pending.get(askChunk.approvalId)?.resolve({
          approved: true,
          updatedInput: { answers: { "Apply edit": "Deny" } },
        })
        await expect(responsePromise).resolves.toMatchObject({
          success: false,
        })
      }

      await createCodexAppServerAdapter({
        enabled: true,
        experimentalApi: true,
        controlledEditEnabled: true,
        createTransport: () => transport,
        guardedContract: activeGuardedContract(cwd),
        ...harness.adapterInput,
      }).run(
        createRequest(appServerPolicy("agent", true), {
          context: { ...agentContext(), cwd },
        }),
      )

      expect(existsSync(join(cwd, "src/denied.txt"))).toBe(false)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test("fails closed for malformed controlled edit tool calls before approval", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "locus-controlled-edit-"))
    const transport = new FakeCodexAppServerTransport()
    const harness = createPendingHarness()

    try {
      transport.onTurnStart = async () => {
        const response = await transport.serverRequestHandler?.({
          id: "dynamic-tool-malformed",
          method: "item/tool/call",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            callId: "controlled-edit-malformed",
            namespace: "locus_edit",
            tool: "propose_file_edit",
            arguments: {
              operation: "create",
              path: "src/malformed.txt",
            },
          },
        })
        expect(response).toMatchObject({ success: false })
      }

      await createCodexAppServerAdapter({
        enabled: true,
        experimentalApi: true,
        controlledEditEnabled: true,
        createTransport: () => transport,
        guardedContract: activeGuardedContract(cwd),
        ...harness.adapterInput,
      }).run(
        createRequest(appServerPolicy("agent", true), {
          context: { ...agentContext(), cwd },
        }),
      )

      expect(harness.chunks.map((chunk) => chunk.type)).not.toContain(
        "ask-user-question",
      )
      expect(existsSync(join(cwd, "src/malformed.txt"))).toBe(false)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test("fails closed for stale controlled edit replacements before approval", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "locus-controlled-edit-"))
    mkdirSync(join(cwd, "src"), { recursive: true })
    writeFileSync(join(cwd, "src/stale.txt"), "current\n", "utf8")
    const transport = new FakeCodexAppServerTransport()
    const harness = createPendingHarness()

    try {
      transport.onTurnStart = async () => {
        const response = await transport.serverRequestHandler?.({
          id: "dynamic-tool-stale",
          method: "item/tool/call",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            callId: "controlled-edit-stale",
            namespace: "locus_edit",
            tool: "propose_file_edit",
            arguments: {
              operation: "replace",
              path: "src/stale.txt",
              expected_previous_content: "old\n",
              content: "new\n",
            },
          },
        })
        expect(response).toMatchObject({ success: false })
      }

      await createCodexAppServerAdapter({
        enabled: true,
        experimentalApi: true,
        controlledEditEnabled: true,
        createTransport: () => transport,
        guardedContract: activeGuardedContract(cwd),
        ...harness.adapterInput,
      }).run(
        createRequest(appServerPolicy("agent", true), {
          context: { ...agentContext(), cwd },
        }),
      )

      expect(readFileSync(join(cwd, "src/stale.txt"), "utf8")).toBe("current\n")
      expect(harness.chunks.map((chunk) => chunk.type)).not.toContain(
        "ask-user-question",
      )
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test("fails closed if a controlled edit target changes during approval", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "locus-controlled-edit-"))
    mkdirSync(join(cwd, "src"), { recursive: true })
    writeFileSync(join(cwd, "src/race.txt"), "original\n", "utf8")
    const transport = new FakeCodexAppServerTransport()
    const harness = createPendingHarness()

    try {
      transport.onTurnStart = async () => {
        const responsePromise = transport.serverRequestHandler?.({
          id: "dynamic-tool-stale-apply",
          method: "item/tool/call",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            callId: "controlled-edit-stale-apply",
            namespace: "locus_edit",
            tool: "propose_file_edit",
            arguments: {
              operation: "replace",
              path: "src/race.txt",
              expected_previous_content: "original\n",
              content: "new\n",
            },
          },
        })
        const askChunk = harness.chunks.find(
          (chunk) => chunk.type === "ask-user-question",
        )
        expect(askChunk).toBeTruthy()
        writeFileSync(join(cwd, "src/race.txt"), "changed elsewhere\n", "utf8")
        harness.approveLatest()
        await expect(responsePromise).resolves.toMatchObject({
          success: false,
          contentItems: [
            {
              text: expect.stringContaining("changed before approval"),
            },
          ],
        })
      }

      await createCodexAppServerAdapter({
        enabled: true,
        experimentalApi: true,
        controlledEditEnabled: true,
        createTransport: () => transport,
        guardedContract: activeGuardedContract(cwd),
        ...harness.adapterInput,
      }).run(
        createRequest(appServerPolicy("agent", true), {
          context: { ...agentContext(), cwd },
        }),
      )

      expect(readFileSync(join(cwd, "src/race.txt"), "utf8")).toBe(
        "changed elsewhere\n",
      )
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test("times out controlled edit approvals without writing", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "locus-controlled-edit-"))
    const transport = new FakeCodexAppServerTransport()
    const harness = createPendingHarness()

    try {
      transport.onTurnStart = async () => {
        const responsePromise = transport.serverRequestHandler?.({
          id: "dynamic-tool-timeout",
          method: "item/tool/call",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            callId: "controlled-edit-timeout",
            namespace: "locus_edit",
            tool: "propose_file_edit",
            arguments: {
              operation: "create",
              path: "src/timeout.txt",
              content: "should not write\n",
            },
          },
        })
        await sleep(20)
        await expect(responsePromise).resolves.toMatchObject({
          success: false,
        })
      }

      await createCodexAppServerAdapter({
        enabled: true,
        experimentalApi: true,
        controlledEditEnabled: true,
        createTransport: () => transport,
        guardedContract: activeGuardedContract(cwd),
        userInputTimeoutMs: 5,
        ...harness.adapterInput,
      }).run(
        createRequest(appServerPolicy("agent", true), {
          context: { ...agentContext(), cwd },
        }),
      )

      expect(existsSync(join(cwd, "src/timeout.txt"))).toBe(false)
      expect(harness.chunks.map((chunk) => chunk.type)).toContain(
        "ask-user-question-timeout",
      )
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test("bridges guarded permission approval grant through app-server permission profile response", async () => {
    const transport = new FakeCodexAppServerTransport()
    const harness = createPendingHarness()
    const permissions = {
      network: null,
      fileSystem: {
        read: null,
        write: ["/repo/src/new.ts"],
      },
    }

    transport.onTurnStart = async () => {
      const responsePromise = transport.serverRequestHandler?.({
        id: "permissions-1",
        method: "item/permissions/requestApproval",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-permissions",
          startedAtMs: Date.now(),
          cwd: "/repo",
          reason: "Allow write under src",
          permissions,
        },
      })
      const askChunk = harness.approveLatest()
      expect(askChunk.toolUseId).toContain("permissions-approval")
      await expect(responsePromise).resolves.toEqual({
        permissions,
        scope: "turn",
        strictAutoReview: true,
      })
    }

    await createCodexAppServerAdapter({
      enabled: true,
      createTransport: () => transport,
      guardedContract: activeGuardedContract(),
      ...harness.adapterInput,
    }).run(
      createRequest(appServerPolicy("agent", true), {
        context: agentContext(),
      }),
    )
  })

  test("fails closed for app-server network permission expansions", async () => {
    const transport = new FakeCodexAppServerTransport()
    transport.onTurnStart = async () => {
      const response = await transport.serverRequestHandler?.({
        id: "network-permissions-1",
        method: "item/permissions/requestApproval",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-network",
          startedAtMs: Date.now(),
          cwd: "/repo",
          reason: "Need network",
          permissions: {
            network: { enabled: true },
            fileSystem: null,
          },
        },
      })
      expect(response).toEqual({
        permissions: {},
        scope: "turn",
        strictAutoReview: true,
      })
    }

    await createCodexAppServerAdapter({
      enabled: true,
      createTransport: () => transport,
    }).run(
      createRequest(appServerPolicy("agent"), {
        context: agentContext(),
      }),
    )
  })

  test("redacts app-server approval prompt text before renderer emission", async () => {
    const transport = new FakeCodexAppServerTransport()
    const harness = createPendingHarness()

    transport.onTurnStart = async () => {
      const responsePromise = transport.serverRequestHandler?.({
        id: "redacted-command-1",
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-redacted-command",
          startedAtMs: Date.now(),
          command:
            "printf 'Authorization: Bearer app-server-secret-token access_token=oauth-secret-token'",
        },
      })
      const askChunk = harness.approveLatest()
      const prompt = JSON.stringify(askChunk.questions)
      expect(prompt).toContain("Authorization: <redacted>")
      expect(prompt).toContain("access_token=<redacted>")
      expect(prompt).not.toContain("app-server-secret-token")
      expect(prompt).not.toContain("oauth-secret-token")
      await expect(responsePromise).resolves.toEqual({ decision: "accept" })
    }

    await createCodexAppServerAdapter({
      enabled: true,
      createTransport: () => transport,
      ...harness.adapterInput,
    }).run(
      createRequest(appServerPolicy("agent"), {
        context: agentContext(),
      }),
    )
  })

  test("bridges legacy exec approval grant through legacy app-server response shape", async () => {
    const transport = new FakeCodexAppServerTransport()
    const harness = createPendingHarness()

    transport.onTurnStart = async () => {
      const responsePromise = transport.serverRequestHandler?.({
        id: "legacy-exec-1",
        method: "execCommandApproval",
        params: {
          conversationId: "thread-1",
          callId: "legacy-call-1",
          approvalId: "legacy-approval-1",
          command: ["bun", "test"],
          cwd: "/repo",
          reason: null,
          parsedCmd: [],
        },
      })
      const askChunk = harness.approveLatest()
      expect(askChunk.toolUseId).toContain("legacy-command-approval")
      await expect(responsePromise).resolves.toEqual({ decision: "approved" })
    }

    await createCodexAppServerAdapter({
      enabled: true,
      createTransport: () => transport,
      guardedContract: activeGuardedContract(),
      ...harness.adapterInput,
    }).run(
      createRequest(appServerPolicy("agent", true), {
        context: agentContext(),
      }),
    )
  })
})
