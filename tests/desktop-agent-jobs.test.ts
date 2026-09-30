import { describe, expect, test } from "bun:test"
import type { DesktopRunRequest } from "../src/main/lib/agent-runtime/desktop-run-request"
import { resolveDesktopPermissionPolicy } from "../src/main/lib/agent-runtime/permission-policy"
import { getOrCreateRunEventLedger } from "../src/main/lib/agent-runtime/run-event-ledger-host"
import { createCodexAppServerAdapter } from "../src/main/lib/codex/app-server-adapter"
import { chats, projects, subChats } from "../src/main/lib/db/schema"
import {
  completeDesktopAgentJobSafely,
  completeDesktopChatAgentJobSafely,
  createAndRegisterDesktopChatAgentJob,
  createAndStartDesktopAgentJob,
  registerActiveDesktopAgentJob,
  requestCancelDesktopAgentJob,
  requestCancelDesktopChatAgentJobSafely,
  resolveDesktopChatJobCompletion,
  unregisterActiveDesktopAgentJob,
} from "../src/main/lib/desktop-agent-jobs"
import {
  getAgentJob,
  listAgentJobEvents,
} from "../src/main/lib/headless/job-store"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"
import { ScriptedCodexAppServerTransport } from "./helpers/codex-app-server-scripted-transport"

const DESKTOP_CODEX_PROVENANCE = {
  kind: "runtime",
  installationId: "inst-codex-0.139.0-desktop-test",
  runtimeId: "codex",
  adapterSource: "codex-app-server",
  version: "0.139.0",
  executableRef: "exe-desktop-test",
  binarySha256: "a".repeat(64),
  protocolName: "codex-app-server-jsonrpc",
  protocolVersion: "v2",
  schemaFiles: [
    { path: "codex-app-server/v2/dispositions.json", sha256: "b".repeat(64) },
  ],
} as const

function seedChat(db: ReturnType<typeof createAgentJobTestDb>) {
  db.insert(projects)
    .values({
      id: "project-1",
      name: "Project",
      path: "/tmp/project",
    })
    .run()
  db.insert(chats)
    .values({
      id: "chat-1",
      projectId: "project-1",
      worktreePath: "/tmp/project-worktree",
    })
    .run()
  db.insert(subChats)
    .values({
      id: "sub-chat-1",
      chatId: "chat-1",
    })
    .run()
}

/**
 * A succeeded desktop Run needs committed output evidence (R1 DIRECT_NEW_
 * STANDARD): record one assistant output through the job's host ledger.
 */
async function recordDesktopOutput(
  db: ReturnType<typeof createAgentJobTestDb>,
  jobId: string,
) {
  const ledger = await getOrCreateRunEventLedger(db, { id: jobId })
  await ledger.ingestRuntimeObservation({
    observationKey: `desktop-output:${jobId}`,
    type: "assistant_delta",
    payload: { text: "done" },
  })
}

describe("desktop agent jobs", () => {
  test("creates a linked running desktop job without duplicating the full prompt", async () => {
    const db = createAgentJobTestDb()
    seedChat(db)

    const prompt = "Please inspect the repo and do not edit files."
    const permissionPolicy = resolveDesktopPermissionPolicy({
      runtimeId: "codex",
      mode: "plan",
    })
    const { job, workerId, cwd } = await createAndStartDesktopAgentJob(db, {
      runtime: "codex",
      mode: "plan",
      chatId: "chat-1",
      subChatId: "sub-chat-1",
      cwd: "/tmp/project-worktree",
      prompt,
      runId: "run-1",
      permissionPolicy,
    })

    const persisted = getAgentJob(db, job.id)
    expect(persisted?.source).toBe("desktop")
    expect(persisted?.status).toBe("running")
    expect(persisted?.runtime).toBe("codex")
    expect(persisted?.projectId).toBe("project-1")
    expect(persisted?.chatId).toBe("chat-1")
    expect(persisted?.subChatId).toBe("sub-chat-1")
    expect(persisted?.cwd).toBe("/tmp/project-worktree")
    expect(cwd).toBe("/tmp/project-worktree")
    expect(workerId).toBe("desktop:codex:run-1")
    expect(persisted?.inputJson).not.toContain(prompt)
    expect(JSON.parse(persisted?.inputJson || "{}")).toMatchObject({
      kind: "desktop-chat",
      chatId: "chat-1",
      subChatId: "sub-chat-1",
      projectId: "project-1",
      runId: "run-1",
      promptLength: prompt.length,
      permissionPolicy: {
        runtimeId: "codex",
        mode: "plan",
        guarded: false,
        enforcement: "codex-app-server-plan-approval-gate",
        planWorkspaceSideEffects: "deny",
        blockedSideEffects: [
          "workspace-file-write",
          "side-effecting-shell",
          "mcp-configuration",
          "runtime-configuration",
          "provider-configuration",
        ],
        requiresPreExecutionEnforcement: true,
        runtimeMapping: {
          runtime: "codex",
          adapterSource: "codex-app-server",
          appServerApprovalPolicy: "on-request",
          requiresApprovalGate: true,
          approvalGateFailure: "fail-closed",
        },
        diagnostics: [
          "Plan mode denies project/workspace side effects; Codex app-server must install its approval gate before provider or tool work starts.",
        ],
      },
    })

    const events = listAgentJobEvents(db, job.id)
    expect(events.map((event) => event.type)).toEqual([
      "job_created",
      "job_started",
      "status",
    ])
  })

  test("rejects renderer-supplied cwd and sub-chat mismatches", async () => {
    const db = createAgentJobTestDb()
    seedChat(db)
    db.insert(chats)
      .values({
        id: "other-chat",
        projectId: "project-1",
        worktreePath: "/tmp/project-worktree",
      })
      .run()

    await expect(
      createAndStartDesktopAgentJob(db, {
        runtime: "claude-code",
        mode: "agent",
        chatId: "chat-1",
        subChatId: "sub-chat-1",
        cwd: "/tmp/other",
        prompt: "Run elsewhere",
      }),
    ).rejects.toThrow("Desktop job cwd mismatch")

    await expect(
      createAndStartDesktopAgentJob(db, {
        runtime: "claude-code",
        mode: "agent",
        chatId: "other-chat",
        subChatId: "sub-chat-1",
        cwd: "/tmp/project-worktree",
        prompt: "Wrong chat",
      }),
    ).rejects.toThrow("does not belong to chat")
  })

  test("routes cancellation through the active desktop job registration", async () => {
    const db = createAgentJobTestDb()
    seedChat(db)
    const { job } = await createAndStartDesktopAgentJob(db, {
      runtime: "claude-code",
      mode: "agent",
      chatId: "chat-1",
      subChatId: "sub-chat-1",
      cwd: "/tmp/project-worktree",
      prompt: "Run",
      runId: "stream-1",
    })
    let cancelCount = 0
    registerActiveDesktopAgentJob({
      jobId: job.id,
      runtime: "claude-code",
      subChatId: "sub-chat-1",
      runId: "stream-1",
      db,
      workerId: "desktop:claude-code:stream-1",
      cancel: () => {
        cancelCount += 1
      },
    })

    const result = await requestCancelDesktopAgentJob(db, job.id, "desktop")
    expect(result.activeCancelDelivered).toBe(true)
    expect(result.job.cancelRequestedBy).toBe("desktop")
    expect(cancelCount).toBe(1)
    // Host cancel evidence for a running job is a committed cancel_requested
    // status (refactor-canonical-run-event-ledger queued_cancel semantics).
    expect(
      listAgentJobEvents(db, job.id)
        .map((event) => ({
          type: event.type,
          payload: JSON.parse(event.payloadJson || "{}"),
        }))
        .find(
          (event) =>
            event.type === "status" &&
            event.payload.status === "cancel_requested",
        ),
    ).toMatchObject({
      type: "status",
      payload: { status: "cancel_requested", requestedBy: "desktop" },
    })

    unregisterActiveDesktopAgentJob(job.id)
  })

  test("creates and registers a desktop chat job in one owner call", async () => {
    const db = createAgentJobTestDb()
    seedChat(db)
    let cancelCount = 0

    const { job, workerId } = await createAndRegisterDesktopChatAgentJob(db, {
      runtime: "claude-code",
      mode: "agent",
      chatId: "chat-1",
      subChatId: "sub-chat-1",
      cwd: "/tmp/project-worktree",
      prompt: "Run",
      runId: "stream-registered",
      cancel: () => {
        cancelCount += 1
      },
    })

    expect(workerId).toBe("desktop:claude-code:stream-registered")
    const canceled = await requestCancelDesktopAgentJob(db, job.id, "desktop")
    expect(canceled.activeCancelDelivered).toBe(true)
    expect(cancelCount).toBe(1)
    unregisterActiveDesktopAgentJob(job.id)
  })

  test("refreshes heartbeat while a desktop job is active", async () => {
    const db = createAgentJobTestDb()
    seedChat(db)
    const { job, workerId } = await createAndStartDesktopAgentJob(db, {
      runtime: "codex",
      mode: "plan",
      chatId: "chat-1",
      subChatId: "sub-chat-1",
      cwd: "/tmp/project-worktree",
      prompt: "Long running inspect",
      runId: "run-heartbeat",
    })
    const initialHeartbeat =
      getAgentJob(db, job.id)?.heartbeatAt?.getTime() ?? 0

    registerActiveDesktopAgentJob({
      jobId: job.id,
      runtime: "codex",
      subChatId: "sub-chat-1",
      runId: "run-heartbeat",
      db,
      workerId,
      heartbeatIntervalMs: 5,
      cancel: () => {},
    })

    await new Promise((resolve) => setTimeout(resolve, 30))
    const refreshedHeartbeat =
      getAgentJob(db, job.id)?.heartbeatAt?.getTime() ?? 0
    unregisterActiveDesktopAgentJob(job.id)

    expect(refreshedHeartbeat).toBeGreaterThanOrEqual(initialHeartbeat)
  })

  test("completes running desktop jobs safely and ignores terminal jobs", async () => {
    const db = createAgentJobTestDb()
    seedChat(db)
    const { job } = await createAndStartDesktopAgentJob(db, {
      runtime: "codex",
      mode: "plan",
      chatId: "chat-1",
      subChatId: "sub-chat-1",
      cwd: "/tmp/project-worktree",
      prompt: "Inspect",
      runId: "run-1",
    })

    await recordDesktopOutput(db, job.id)
    const completed = await completeDesktopAgentJobSafely(db, {
      jobId: job.id,
      status: "succeeded",
      exitCode: 0,
    })
    expect(completed?.status).toBe("succeeded")
    expect(listAgentJobEvents(db, job.id).at(-1)).toMatchObject({
      type: "completed",
    })

    const ignored = await completeDesktopAgentJobSafely(db, {
      jobId: job.id,
      status: "failed",
      exitCode: 1,
    })
    expect(ignored?.status).toBe("succeeded")
  })

  test("completes desktop chat jobs with shared runtime completion semantics", async () => {
    const db = createAgentJobTestDb()
    seedChat(db)
    const { job } = await createAndStartDesktopAgentJob(db, {
      runtime: "claude-code",
      mode: "agent",
      chatId: "chat-1",
      subChatId: "sub-chat-1",
      cwd: "/tmp/project-worktree",
      prompt: "Implement",
      runId: "run-complete",
    })

    await recordDesktopOutput(db, job.id)
    const completed = await completeDesktopChatAgentJobSafely(db, {
      jobId: job.id,
      runtime: "claude-code",
      aborted: false,
      reachedNaturalFinish: true,
      sawError: false,
      result: {
        runtime: "claude-code",
        chatId: "chat-1",
        subChatId: "sub-chat-1",
      },
    })

    expect(completed).toMatchObject({
      status: "succeeded",
      exitCode: 0,
      errorCode: null,
    })
    expect(JSON.parse(completed?.resultJson ?? "{}")).toEqual({
      runtime: "claude-code",
      chatId: "chat-1",
      subChatId: "sub-chat-1",
    })
  })

  test("a Codex initialize error with the child alive finalizes failed, not a transport-exit interrupt (T2-2 / S-01)", async () => {
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
      runId: "run-init-error",
      permissionPolicy,
    })
    const ledger = await getOrCreateRunEventLedger(db, job)
    // Like the stdio transport, close() ends the child and fires every
    // still-attached exit handler.
    const transport = new ScriptedCodexAppServerTransport({
      initializeError: { code: -32600, message: "initialize rejected" },
      exitOnClose: true,
    })
    const adapter = createCodexAppServerAdapter({
      enabled: true,
      createTransport: () => transport,
      captureExecutionProvenance: async () => DESKTOP_CODEX_PROVENANCE,
    })
    const request: DesktopRunRequest = {
      identity: { runId: "run-init-error", jobId: job.id },
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
      signal: new AbortController().signal,
      session: {},
    }
    const adapterResult = await adapter.run(request)
    expect(adapterResult.status).toBe("failed")
    expect(transport.closed).toBe(true)

    const completed = await completeDesktopChatAgentJobSafely(db, {
      jobId: job.id,
      runtime: "codex",
      aborted: false,
      reachedNaturalFinish: true,
      sawError: true,
    })
    expect(completed).toMatchObject({
      status: "failed",
      exitCode: 1,
      errorCode: "desktop_chat_failed",
    })
    const events = listAgentJobEvents(db, job.id)
    const terminal = events.filter((event) => event.type === "completed")
    expect(terminal).toHaveLength(1)
    const payload = JSON.parse(terminal[0].payloadJson)
    expect(payload.status).toBe("failed")
    expect(payload.synthetic).toBeUndefined()
    expect(events.map((event) => event.payloadJson).join("\n")).not.toContain(
      "transport_exit",
    )
  })

  test("counts a completed-only assistant item as desktop output evidence (T2-6 / S-13)", async () => {
    const run = async (text: string) => {
      const db = createAgentJobTestDb()
      seedChat(db)
      const { job } = await createAndStartDesktopAgentJob(db, {
        runtime: "codex",
        mode: "agent",
        chatId: "chat-1",
        subChatId: "sub-chat-1",
        cwd: "/tmp/project-worktree",
        prompt: "Implement",
        runId: `run-completed-only-${text.length}`,
      })
      const ledger = await getOrCreateRunEventLedger(db, job)
      await ledger.bindExecutionProvenance(DESKTOP_CODEX_PROVENANCE)
      const notify = (
        observationKey: string,
        method: string,
        params: unknown,
      ) =>
        ledger.ingestNotification({
          observationKey,
          transportId: "t1",
          receivedAt: "2026-09-04T00:00:00.000Z",
          message: { method, params },
        })
      await notify("n-started", "turn/started", {
        threadId: "th",
        turn: { id: "tu", status: "inProgress", error: null },
      })
      if (text) {
        await notify("n-item", "item/completed", {
          threadId: "th",
          turnId: "tu",
          item: { type: "agentMessage", id: "msg-1", text },
        })
      }
      const completed = await completeDesktopChatAgentJobSafely(db, {
        jobId: job.id,
        runtime: "codex",
        aborted: false,
        reachedNaturalFinish: true,
        sawError: false,
      })
      const events = listAgentJobEvents(db, job.id)
      const terminal = events.find((event) => event.type === "completed")
      return {
        completed,
        events,
        payload: JSON.parse(terminal?.payloadJson ?? "{}"),
      }
    }

    const withItem = await run("final answer without deltas")
    const reconciliation = withItem.events.find(
      (event) =>
        event.type === "status" &&
        JSON.parse(event.payloadJson).subtype === "item_reconciliation",
    )
    expect(reconciliation).toBeDefined()
    expect(withItem.completed?.status).toBe("succeeded")
    expect(withItem.payload.evidenceKeys).toContain(
      `record:${reconciliation?.sequence}`,
    )

    const withoutOutput = await run("")
    expect(withoutOutput.completed?.status).toBe("failed")
    expect(withoutOutput.payload.reasons).toContain("output_empty")
  })

  test("safely requests cancel only for unfinished desktop chat jobs", async () => {
    const db = createAgentJobTestDb()
    seedChat(db)
    const { job } = await createAndStartDesktopAgentJob(db, {
      runtime: "codex",
      mode: "plan",
      chatId: "chat-1",
      subChatId: "sub-chat-1",
      cwd: "/tmp/project-worktree",
      prompt: "Inspect",
      runId: "run-cancel",
    })
    let cancelCount = 0
    registerActiveDesktopAgentJob({
      jobId: job.id,
      runtime: "codex",
      subChatId: "sub-chat-1",
      runId: "run-cancel",
      db,
      workerId: "desktop:codex:run-cancel",
      cancel: () => {
        cancelCount += 1
      },
    })

    const canceled = await requestCancelDesktopChatAgentJobSafely(db, {
      jobId: job.id,
      sawError: false,
      reachedNaturalFinish: false,
      requestedBy: "desktop-chat",
    })

    expect(canceled?.activeCancelDelivered).toBe(true)
    expect(cancelCount).toBe(1)
    expect(
      await requestCancelDesktopChatAgentJobSafely(db, {
        jobId: job.id,
        sawError: true,
        reachedNaturalFinish: false,
        requestedBy: "desktop-chat",
      }),
    ).toBeNull()
    unregisterActiveDesktopAgentJob(job.id)
  })

  test("resolves desktop chat completion status consistently across runtimes", async () => {
    for (const [runtime, label] of [
      ["claude-code", "Claude"],
      ["codex", "Codex"],
    ] as const) {
      expect(
        resolveDesktopChatJobCompletion({
          runtime,
          aborted: false,
          reachedNaturalFinish: true,
          sawError: false,
        }),
      ).toEqual({
        status: "succeeded",
        exitCode: 0,
        errorCode: null,
        errorMessage: null,
      })

      expect(
        resolveDesktopChatJobCompletion({
          runtime,
          aborted: false,
          reachedNaturalFinish: false,
          sawError: true,
        }),
      ).toEqual({
        status: "failed",
        exitCode: 1,
        errorCode: "desktop_chat_failed",
        errorMessage: `Desktop ${label} chat stream failed.`,
      })

      expect(
        resolveDesktopChatJobCompletion({
          runtime,
          aborted: true,
          reachedNaturalFinish: false,
          sawError: true,
        }),
      ).toEqual({
        status: "canceled",
        exitCode: 5,
        errorCode: "desktop_chat_canceled",
        errorMessage: `Desktop ${label} chat stream was canceled.`,
      })
    }
  })
})
