import { afterEach, describe, expect, test } from "bun:test"
import {
  clearActiveGuardedContractsForTest,
  isActiveGuardedContract,
  replaceActiveGuardedContractForSubChat,
  type ValidatedAgentScopeContract,
} from "../src/main/lib/agent-guard"
import {
  acquireChatMaintenanceFence,
  clearChatMaintenanceFencesForTest,
  releaseChatMaintenanceFence,
} from "../src/main/lib/agent-runtime/chat-maintenance-fence"
import {
  clearClaudeActiveSessionsForTest,
  getActiveClaudeSession,
  setActiveClaudeSession,
} from "../src/main/lib/claude/active-sessions"
import {
  abortClaudeAgentSdkDesktopRunRequest,
  cleanupClaudeAgentSdkDesktopRunSubscription,
  finalizeClaudeAgentSdkDesktopRunAfterLifecycle,
} from "../src/main/lib/claude/agent-sdk-desktop-run-cleanup"
import { createClaudeAgentSdkDesktopRunState } from "../src/main/lib/claude/agent-sdk-desktop-run-state"
import type { ClaudeAskUserQuestionPending } from "../src/main/lib/claude/agent-sdk-tool-permission"
import {
  clearClaudePendingToolApprovalsForTest,
  getClaudePendingToolApprovalStore,
} from "../src/main/lib/claude/tool-approvals"

function createDbRecorder() {
  const updates: any[] = []
  const db = {
    update(table: unknown) {
      const update: any = { table }
      updates.push(update)
      return {
        set(value: unknown) {
          update.set = value
          return {
            where(condition: unknown) {
              update.where = condition
              return {
                run() {
                  update.ran = true
                },
              }
            },
          }
        },
      }
    },
  }

  return { db: db as any, updates }
}

function createGuardedContract(runId: string): ValidatedAgentScopeContract {
  return {
    id: "shared-contract",
    version: 1,
    status: "approved",
    createdAt: "2026-08-26T00:00:00.000Z",
    approvedAt: "2026-08-26T00:00:00.000Z",
    source: "manual",
    chatId: "chat-1",
    subChatId: "sub-1",
    runId,
    cwd: "/repo",
    projectPath: "/repo",
    editableScope: [{ path: "src", kind: "directory" }],
    readOnlyEvidence: [],
    successChecks: [],
    blockedPaths: [],
    expansions: [],
  }
}

describe("Claude Agent SDK desktop run cleanup", () => {
  afterEach(() => {
    clearActiveGuardedContractsForTest()
    clearChatMaintenanceFencesForTest()
    clearClaudeActiveSessionsForTest()
    clearClaudePendingToolApprovalsForTest()
  })

  test("cleans owned active sessions, guard contracts, pending approvals, jobs, and stream id", () => {
    const { db, updates } = createDbRecorder()
    const controller = new AbortController()
    const desktopRunState = createClaudeAgentSdkDesktopRunState()
    desktopRunState.setDesktopJob({
      jobId: "job-1",
      streamEventMapper: { map: () => [] },
    })
    desktopRunState.markFailed()
    const deletedSessions: any[] = []
    const deletedContracts: string[] = []
    const clearedApprovals: any[] = []
    const canceledJobs: any[] = []
    const logs: any[] = []
    let runtimeSecretCleanupCalls = 0

    const result = cleanupClaudeAgentSdkDesktopRunSubscription({
      subId: "sub-tail",
      subChatId: "sub-1",
      sessionId: "session-1",
      abortController: controller,
      guardedContract: { id: "contract-1" } as any,
      getDb: () => db,
      desktopRunState,
      cleanupRuntimeSecrets: () => {
        runtimeSecretCleanupCalls += 1
      },
      dependencies: {
        getActiveClaudeSession: () => ({
          controller,
          runId: "run-1",
        }),
        deleteActiveClaudeSessionIfController: (subChatId, abortController) => {
          deletedSessions.push({ subChatId, abortController })
          return true
        },
        deleteGuardedContractIfMatch: (contract) => {
          deletedContracts.push(contract.id)
          return true
        },
        clearClaudePendingToolApprovals: (message, subChatId) => {
          clearedApprovals.push({ message, subChatId })
        },
        requestCancelClaudeAgentSdkDesktopJob: (input) => {
          canceledJobs.push(input)
        },
        log: (...args) => {
          logs.push(args)
        },
      },
    })

    expect(result).toEqual({ ownsActiveSession: true })
    expect(desktopRunState.isObservableActive()).toBe(false)
    expect(controller.signal.aborted).toBe(true)
    expect(runtimeSecretCleanupCalls).toBe(1)
    expect(logs).toEqual([["[SD] M:CLEANUP sub=sub-tail sessionId=session-1"]])
    expect(deletedSessions).toEqual([])
    expect(deletedContracts).toEqual(["contract-1"])
    expect(clearedApprovals).toEqual([
      { message: "Session ended.", subChatId: "sub-1" },
    ])
    expect(canceledJobs).toEqual([
      {
        db,
        jobId: "job-1",
        sawError: true,
        reachedNaturalFinish: false,
      },
    ])
    expect(updates).toEqual([
      expect.objectContaining({
        set: { streamId: null },
        ran: true,
      }),
    ])
  })

  test("keeps pending approvals and stream id when cleanup does not own the active session", () => {
    const { db, updates } = createDbRecorder()
    const controller = new AbortController()
    const desktopRunState = createClaudeAgentSdkDesktopRunState()
    desktopRunState.setReachedNaturalFinish(true)
    const clearedApprovals: any[] = []
    const canceledJobs: any[] = []

    const result = cleanupClaudeAgentSdkDesktopRunSubscription({
      subId: "sub-tail",
      subChatId: "sub-1",
      abortController: controller,
      guardedContract: null,
      getDb: () => db,
      desktopRunState,
      dependencies: {
        getActiveClaudeSession: () => undefined,
        clearClaudePendingToolApprovals: (message, subChatId) => {
          clearedApprovals.push({ message, subChatId })
        },
        requestCancelClaudeAgentSdkDesktopJob: (input) => {
          canceledJobs.push(input)
        },
        log: () => {},
      },
    })

    expect(result).toEqual({ ownsActiveSession: false })
    expect(controller.signal.aborted).toBe(true)
    expect(clearedApprovals).toEqual([])
    expect(updates).toEqual([])
    expect(canceledJobs).toEqual([
      {
        db,
        jobId: null,
        sawError: false,
        reachedNaturalFinish: true,
      },
    ])
  })

  test("late unsubscribe cleanup preserves a newer same-ID guard winner", () => {
    const { db } = createDbRecorder()
    const oldController = new AbortController()
    const winnerController = new AbortController()
    const oldContract = createGuardedContract("run-old")
    const winnerContract = createGuardedContract("run-winner")
    setActiveClaudeSession("sub-1", {
      runId: "run-winner",
      controller: winnerController,
    })
    replaceActiveGuardedContractForSubChat(
      winnerContract.subChatId,
      winnerContract,
    )
    const desktopRunState = createClaudeAgentSdkDesktopRunState()

    const result = cleanupClaudeAgentSdkDesktopRunSubscription({
      subId: "sub-tail",
      subChatId: "sub-1",
      abortController: oldController,
      guardedContract: oldContract,
      getDb: () => db,
      desktopRunState,
      dependencies: {
        requestCancelClaudeAgentSdkDesktopJob: () => {},
        log: () => {},
      },
    })

    expect(result).toEqual({ ownsActiveSession: false })
    expect(oldController.signal.aborted).toBe(true)
    expect(winnerController.signal.aborted).toBe(false)
    expect(getActiveClaudeSession("sub-1")?.controller).toBe(winnerController)
    expect(isActiveGuardedContract(winnerContract)).toBe(true)
  })

  test("retains a draining owner until exact lifecycle finalization, including same run IDs", () => {
    const { db } = createDbRecorder()
    const controllerA = new AbortController()
    const controllerB = new AbortController()
    const desktopRunStateA = createClaudeAgentSdkDesktopRunState()
    const desktopRunStateB = createClaudeAgentSdkDesktopRunState()
    setActiveClaudeSession("sub-1", {
      controller: controllerA,
      runId: "run-shared",
    })

    expect(
      cleanupClaudeAgentSdkDesktopRunSubscription({
        subId: "sub-tail-a",
        subChatId: "sub-1",
        abortController: controllerA,
        guardedContract: null,
        getDb: () => db,
        desktopRunState: desktopRunStateA,
        dependencies: {
          requestCancelClaudeAgentSdkDesktopJob: () => {},
          log: () => {},
        },
      }),
    ).toEqual({ ownsActiveSession: true })
    expect(controllerA.signal.aborted).toBe(true)
    expect(getActiveClaudeSession("sub-1")?.controller).toBe(controllerA)
    expect(acquireChatMaintenanceFence("sub-1")).toEqual({
      ok: false,
      error: {
        code: "SESSION_BINDING_BUSY",
        subChatId: "sub-1",
        operation: "rollback",
        activeRunId: "run-shared",
        reason: "active-run",
      },
    })

    setActiveClaudeSession("sub-1", {
      controller: controllerB,
      runId: "run-shared",
    })
    finalizeClaudeAgentSdkDesktopRunAfterLifecycle({
      chatId: "chat-1",
      subChatId: "sub-1",
      abortController: controllerA,
      guardedContract: null,
      getDb: () => db,
      desktopRunState: desktopRunStateA,
    })
    expect(getActiveClaudeSession("sub-1")?.controller).toBe(controllerB)
    expect(acquireChatMaintenanceFence("sub-1")).toMatchObject({
      ok: false,
      error: { activeRunId: "run-shared", reason: "active-run" },
    })

    finalizeClaudeAgentSdkDesktopRunAfterLifecycle({
      chatId: "chat-1",
      subChatId: "sub-1",
      abortController: controllerB,
      guardedContract: null,
      getDb: () => db,
      desktopRunState: desktopRunStateB,
    })
    expect(getActiveClaudeSession("sub-1")).toBeUndefined()
    const maintenance = acquireChatMaintenanceFence("sub-1")
    expect(maintenance.ok).toBe(true)
    if (maintenance.ok) {
      expect(releaseChatMaintenanceFence(maintenance.fence)).toBe(true)
    }
  })

  test("finalizes lifecycle cleanup with the existing job db and guard teardown", () => {
    const { db } = createDbRecorder()
    const controller = new AbortController()
    const desktopRunState = createClaudeAgentSdkDesktopRunState()
    desktopRunState.setDb(db)
    desktopRunState.setDesktopJob({
      jobId: "job-1",
      streamEventMapper: { map: () => [] },
    })
    desktopRunState.markFailed()
    const completedJobs: any[] = []
    const deletedSessions: any[] = []
    const deletedContracts: string[] = []

    finalizeClaudeAgentSdkDesktopRunAfterLifecycle({
      chatId: "chat-1",
      subChatId: "sub-1",
      abortController: controller,
      guardedContract: { id: "contract-1" } as any,
      getDb: () => {
        throw new Error("fallback db should not be used")
      },
      desktopRunState,
      dependencies: {
        completeClaudeAgentSdkDesktopJobAfterRun: (input) => {
          completedJobs.push(input)
        },
        deleteActiveClaudeSessionIfController: (subChatId, abortController) => {
          deletedSessions.push({ subChatId, abortController })
          return true
        },
        deleteGuardedContractIfMatch: (contract) => {
          deletedContracts.push(contract.id)
          return true
        },
      },
    })

    expect(completedJobs).toEqual([
      {
        db,
        jobId: "job-1",
        chatId: "chat-1",
        subChatId: "sub-1",
        abortSignal: controller.signal,
        reachedNaturalFinish: false,
        sawError: true,
      },
    ])
    expect(deletedSessions).toEqual([
      { subChatId: "sub-1", abortController: controller },
    ])
    expect(deletedContracts).toEqual(["contract-1"])
  })

  test("finalizes lifecycle cleanup without loading a db when no job exists", () => {
    const controller = new AbortController()
    const desktopRunState = createClaudeAgentSdkDesktopRunState()
    desktopRunState.setReachedNaturalFinish(true)
    const completedJobs: any[] = []
    const deletedSessions: any[] = []
    let loadedFallbackDb = false

    finalizeClaudeAgentSdkDesktopRunAfterLifecycle({
      chatId: "chat-1",
      subChatId: "sub-1",
      abortController: controller,
      guardedContract: null,
      getDb: () => {
        loadedFallbackDb = true
        return createDbRecorder().db
      },
      desktopRunState,
      dependencies: {
        completeClaudeAgentSdkDesktopJobAfterRun: (input) => {
          completedJobs.push(input)
        },
        deleteActiveClaudeSessionIfController: (subChatId, abortController) => {
          deletedSessions.push({ subChatId, abortController })
          return false
        },
      },
    })

    expect(completedJobs).toEqual([])
    expect(loadedFallbackDb).toBe(false)
    expect(deletedSessions).toEqual([
      { subChatId: "sub-1", abortController: controller },
    ])
  })

  test("late lifecycle finalization preserves a newer same-ID guard winner", () => {
    const oldController = new AbortController()
    const winnerController = new AbortController()
    const oldContract = createGuardedContract("run-old")
    const winnerContract = createGuardedContract("run-winner")
    setActiveClaudeSession("sub-1", {
      runId: "run-winner",
      controller: winnerController,
    })
    replaceActiveGuardedContractForSubChat(
      winnerContract.subChatId,
      winnerContract,
    )
    const desktopRunState = createClaudeAgentSdkDesktopRunState()

    finalizeClaudeAgentSdkDesktopRunAfterLifecycle({
      chatId: "chat-1",
      subChatId: "sub-1",
      abortController: oldController,
      guardedContract: oldContract,
      getDb: () => {
        throw new Error("fallback db should not be used")
      },
      desktopRunState,
    })

    expect(winnerController.signal.aborted).toBe(false)
    expect(getActiveClaudeSession("sub-1")?.controller).toBe(winnerController)
    expect(isActiveGuardedContract(winnerContract)).toBe(true)
  })

  test("aborts a desktop run request and clears pending approvals", () => {
    const controller = new AbortController()
    const clearedApprovals: any[] = []
    setActiveClaudeSession("sub-1", { controller, runId: "run-1" })

    abortClaudeAgentSdkDesktopRunRequest({
      subChatId: "sub-1",
      abortController: controller,
      dependencies: {
        clearClaudePendingToolApprovals: (message, subChatId) => {
          clearedApprovals.push({ message, subChatId })
        },
      },
    })

    expect(controller.signal.aborted).toBe(true)
    expect(clearedApprovals).toEqual([
      { message: "Session cancelled.", subChatId: "sub-1" },
    ])
  })

  test("stale same-run-id job cancellation aborts only A and preserves B approvals", () => {
    const controllerA = new AbortController()
    const controllerB = new AbortController()
    setActiveClaudeSession("sub-1", {
      controller: controllerB,
      runId: "run-shared",
    })
    let approvalResolution: unknown = null
    const pendingApproval: ClaudeAskUserQuestionPending = {
      approvalId: "approval-b",
      toolUseId: "tool-b",
      subChatId: "sub-1",
      toolName: "AskUserQuestion",
      toolInput: { questions: ["Continue?"] },
      isCurrentRunOwner: () =>
        getActiveClaudeSession("sub-1")?.controller === controllerB,
      resolve: (decision) => {
        approvalResolution = decision
      },
    }
    getClaudePendingToolApprovalStore().set("approval-b", pendingApproval)

    abortClaudeAgentSdkDesktopRunRequest({
      subChatId: "sub-1",
      abortController: controllerA,
    })

    expect(controllerA.signal.aborted).toBe(true)
    expect(controllerB.signal.aborted).toBe(false)
    expect(getActiveClaudeSession("sub-1")?.controller).toBe(controllerB)
    expect(getClaudePendingToolApprovalStore().has("approval-b")).toBe(true)
    expect(approvalResolution).toBeNull()
  })

  test("late A unsubscribe job cancellation preserves B pending approval", () => {
    const { db } = createDbRecorder()
    const controllerA = new AbortController()
    const controllerB = new AbortController()
    setActiveClaudeSession("sub-1", {
      controller: controllerB,
      runId: "run-shared",
    })
    let approvalResolution: unknown = null
    const pendingApproval: ClaudeAskUserQuestionPending = {
      approvalId: "approval-b",
      toolUseId: "tool-b",
      subChatId: "sub-1",
      toolName: "AskUserQuestion",
      toolInput: { questions: ["Continue?"] },
      isCurrentRunOwner: () =>
        getActiveClaudeSession("sub-1")?.controller === controllerB,
      resolve: (decision) => {
        approvalResolution = decision
      },
    }
    getClaudePendingToolApprovalStore().set("approval-b", pendingApproval)
    const desktopRunState = createClaudeAgentSdkDesktopRunState()
    desktopRunState.setDesktopJob({
      jobId: "job-a",
      streamEventMapper: { map: () => [] },
    })

    const result = cleanupClaudeAgentSdkDesktopRunSubscription({
      subId: "sub-tail",
      subChatId: "sub-1",
      abortController: controllerA,
      guardedContract: null,
      getDb: () => db,
      desktopRunState,
      dependencies: {
        requestCancelClaudeAgentSdkDesktopJob: () => {
          abortClaudeAgentSdkDesktopRunRequest({
            subChatId: "sub-1",
            abortController: controllerA,
          })
        },
        log: () => {},
      },
    })

    expect(result).toEqual({ ownsActiveSession: false })
    expect(controllerA.signal.aborted).toBe(true)
    expect(controllerB.signal.aborted).toBe(false)
    expect(getActiveClaudeSession("sub-1")?.controller).toBe(controllerB)
    expect(getClaudePendingToolApprovalStore().has("approval-b")).toBe(true)
    expect(approvalResolution).toBeNull()
  })
})
