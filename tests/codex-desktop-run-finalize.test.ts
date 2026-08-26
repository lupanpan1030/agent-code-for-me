import { afterEach, describe, expect, test } from "bun:test"
import {
  clearActiveGuardedContractsForTest,
  isActiveGuardedContract,
  replaceActiveGuardedContractForSubChat,
  type ValidatedAgentScopeContract,
} from "../src/main/lib/agent-guard"
import type { DesktopPermissionPolicy } from "../src/main/lib/agent-runtime/permission-policy"
import {
  clearActiveCodexStreamsForTest,
  getActiveCodexStream,
  setActiveCodexStream,
} from "../src/main/lib/codex/active-streams"
import {
  cleanupCodexDesktopRunSubscription,
  createAndRegisterCodexDesktopRunJob,
  createCodexDesktopRunState,
  finalizeCodexDesktopRunAfterLifecycle,
} from "../src/main/lib/codex/desktop-run-finalize"
import {
  clearCodexPendingToolApprovalsForTest,
  resolveCodexPendingToolApproval,
  setCodexPendingToolApproval,
} from "../src/main/lib/codex/tool-approvals"
import type { DesktopAgentJobHandle } from "../src/main/lib/desktop-agent-jobs"
import type { AgentJobDatabase } from "../src/main/lib/headless/job-store"

const fakeDb = {} as AgentJobDatabase
const permissionPolicy = {} as DesktopPermissionPolicy

function guardedContract(input: {
  id: string
  runId: string
}): ValidatedAgentScopeContract {
  return {
    id: input.id,
    version: 1,
    status: "approved",
    createdAt: "2026-08-26T00:00:00.000Z",
    approvedAt: "2026-08-26T00:00:00.000Z",
    source: "manual",
    chatId: "chat-1",
    subChatId: "sub-1",
    runId: input.runId,
    cwd: "/repo",
    projectPath: "/repo",
    editableScope: [{ path: "src", kind: "directory" }],
    readOnlyEvidence: [],
    successChecks: [],
    blockedPaths: [],
    expansions: [],
  }
}

describe("Codex desktop run finalization owner", () => {
  afterEach(() => {
    clearActiveGuardedContractsForTest()
    clearActiveCodexStreamsForTest()
    clearCodexPendingToolApprovalsForTest()
  })

  test("keeps job flags and database state together", () => {
    const state = createCodexDesktopRunState()
    expect(state.getDb()).toBeNull()
    expect(state.getJobId()).toBeNull()
    expect(state.sawError()).toBe(false)
    expect(state.adapterFailed()).toBe(false)
    expect(state.reachedNaturalFinish()).toBe(false)

    state.setDb(fakeDb)
    state.setJobId("job-1")
    state.markSawError()
    state.setAdapterFailed(true)
    state.setReachedNaturalFinish(true)

    expect(state.getDb()).toBe(fakeDb)
    expect(state.getJobId()).toBe("job-1")
    expect(state.sawError()).toBe(true)
    expect(state.adapterFailed()).toBe(true)
    expect(state.reachedNaturalFinish()).toBe(true)
  })

  test("registers an exact-stream-owner-fenced cancel callback", () => {
    const state = createCodexDesktopRunState()
    const candidateController = new AbortController()
    const replacementController = new AbortController()
    const candidateOwner = {
      runId: "run-1",
      controller: candidateController,
      cancelRequested: false,
    }
    const replacementOwner = {
      runId: "run-1",
      controller: replacementController,
      cancelRequested: false,
    }
    const clearCalls: unknown[] = []
    let registeredCancel: (() => void) | undefined
    let activeStream = replacementOwner

    createAndRegisterCodexDesktopRunJob({
      db: fakeDb,
      state,
      mode: "agent",
      chatId: "chat-1",
      subChatId: "sub-1",
      cwd: "/repo",
      prompt: "hello",
      runId: "run-1",
      activeStreamOwner: candidateOwner,
      permissionPolicy,
      dependencies: {
        createAndRegisterDesktopJob: (_db, input) => {
          expect(_db).toBe(fakeDb)
          expect(input).toMatchObject({
            runtime: "codex",
            mode: "agent",
            chatId: "chat-1",
            subChatId: "sub-1",
            cwd: "/repo",
            prompt: "hello",
            runId: "run-1",
          })
          expect(input.permissionPolicy).toBe(permissionPolicy)
          registeredCancel = input.cancel
          return {
            job: { id: "job-1" },
            workerId: "worker",
            cwd: "/repo",
          } as unknown as DesktopAgentJobHandle
        },
        getActiveStream: () => activeStream,
        clearPendingApprovals: (...args) => clearCalls.push(args),
      },
    })

    expect(state.getJobId()).toBe("job-1")
    registeredCancel?.()
    expect(replacementController.signal.aborted).toBe(false)
    expect(replacementOwner.cancelRequested).toBe(false)
    expect(clearCalls).toEqual([])

    activeStream = candidateOwner
    registeredCancel?.()
    expect(candidateOwner.cancelRequested).toBe(true)
    expect(candidateController.signal.aborted).toBe(true)
    expect(clearCalls).toEqual([["Session cancelled.", "sub-1"]])
  })

  test("finalizes in revoke, job, approval, stream, secret order", () => {
    const calls: string[] = []
    const state = createCodexDesktopRunState()
    const abortController = new AbortController()
    abortController.abort()
    state.setDb(fakeDb)
    state.setJobId("job-1")
    state.markSawError()
    state.setAdapterFailed(true)
    const activeStreamOwner = {
      runId: "run-1",
      controller: abortController,
      cancelRequested: false,
    }

    finalizeCodexDesktopRunAfterLifecycle({
      state,
      activeStreamOwner,
      guardedContract: null,
      chatId: "chat-1",
      subChatId: "sub-1",
      runId: "run-1",
      getFallbackDb: () => {
        throw new Error("state DB should win")
      },
      revokeProviderBinding: () => calls.push("revoke"),
      clearProviderSecrets: () => calls.push("clear-secrets"),
      dependencies: {
        completeDesktopJob: (_db, input) => {
          calls.push("complete-job")
          expect(input).toEqual({
            jobId: "job-1",
            runtime: "codex",
            aborted: false,
            reachedNaturalFinish: false,
            sawError: true,
            result: {
              runtime: "codex",
              subChatId: "sub-1",
              chatId: "chat-1",
              runId: "run-1",
            },
          })
          return null
        },
        getActiveStream: () => activeStreamOwner,
        clearPendingApprovals: () => calls.push("clear-approvals"),
        deleteActiveStreamIfOwner: (subChatId, owner) => {
          expect(subChatId).toBe("sub-1")
          expect(owner).toBe(activeStreamOwner)
          calls.push("delete-stream")
          return true
        },
      },
    })

    expect(calls).toEqual([
      "revoke",
      "complete-job",
      "clear-approvals",
      "delete-stream",
      "clear-secrets",
    ])
  })

  test("preserves successful-natural-finish flags and aborted cancellation", () => {
    const state = createCodexDesktopRunState()
    const abortController = new AbortController()
    abortController.abort()
    state.setDb(fakeDb)
    state.setJobId("job-1")
    state.setReachedNaturalFinish(true)
    const activeStreamOwner = {
      runId: "run-1",
      controller: abortController,
      cancelRequested: false,
    }

    finalizeCodexDesktopRunAfterLifecycle({
      state,
      activeStreamOwner,
      guardedContract: null,
      chatId: "chat-1",
      subChatId: "sub-1",
      runId: "run-1",
      getFallbackDb: () => {
        throw new Error("state DB should win")
      },
      revokeProviderBinding: () => {},
      clearProviderSecrets: () => {},
      dependencies: {
        completeDesktopJob: (_db, input) => {
          expect(input).toMatchObject({
            jobId: "job-1",
            aborted: true,
            reachedNaturalFinish: true,
            sawError: false,
          })
          return null
        },
        getActiveStream: () => null,
      },
    })
  })

  test("does not clear approvals or delete a stale or missing stream", () => {
    const staleOwner = {
      runId: "run-shared",
      controller: new AbortController(),
      cancelRequested: false,
    }
    const replacementOwner = {
      runId: "run-shared",
      controller: new AbortController(),
      cancelRequested: false,
    }
    for (const activeStream of [replacementOwner, null]) {
      const calls: string[] = []
      finalizeCodexDesktopRunAfterLifecycle({
        state: createCodexDesktopRunState(),
        activeStreamOwner: staleOwner,
        guardedContract: null,
        chatId: "chat-1",
        subChatId: "sub-1",
        runId: "run-shared",
        getFallbackDb: () => {
          throw new Error("no job must not resolve a fallback DB")
        },
        revokeProviderBinding: () => calls.push("revoke"),
        clearProviderSecrets: () => calls.push("clear-secrets"),
        dependencies: {
          getActiveStream: () => activeStream,
          clearPendingApprovals: () => calls.push("clear-approvals"),
          deleteActiveStreamIfOwner: () => {
            calls.push("delete-stream")
            return true
          },
        },
      })

      expect(calls).toEqual(["revoke", "clear-secrets"])
      expect(replacementOwner.controller.signal.aborted).toBe(false)
      expect(replacementOwner.cancelRequested).toBe(false)
    }
  })

  test("stale finalization preserves the installed same-run-id owner and its approval", () => {
    const staleOwner = {
      runId: "run-shared",
      controller: new AbortController(),
      cancelRequested: false,
    }
    const replacementOwner = {
      runId: "run-shared",
      controller: new AbortController(),
      cancelRequested: false,
    }
    const decisions: unknown[] = []
    setActiveCodexStream("sub-1", replacementOwner)
    setCodexPendingToolApproval("approval-replacement", {
      approvalId: "approval-replacement",
      toolUseId: "tool-replacement",
      subChatId: "sub-1",
      isCurrentRunOwner: () =>
        getActiveCodexStream("sub-1") === replacementOwner,
      resolve: (decision) => decisions.push(decision),
    })

    finalizeCodexDesktopRunAfterLifecycle({
      state: createCodexDesktopRunState(),
      activeStreamOwner: staleOwner,
      guardedContract: null,
      chatId: "chat-1",
      subChatId: "sub-1",
      runId: "run-shared",
      getFallbackDb: () => {
        throw new Error("no job must not resolve a fallback DB")
      },
      revokeProviderBinding: () => {},
      clearProviderSecrets: () => {},
    })

    expect(getActiveCodexStream("sub-1")).toBe(replacementOwner)
    expect(replacementOwner.controller.signal.aborted).toBe(false)
    expect(replacementOwner.cancelRequested).toBe(false)
    expect(decisions).toEqual([])
    expect(
      resolveCodexPendingToolApproval({
        approvalId: "approval-replacement",
        decision: { approved: true },
      }),
    ).toBe(true)
    expect(decisions).toEqual([{ approved: true }])
  })

  for (const replacementId of ["contract-shared", "contract-replacement"]) {
    const idCase =
      replacementId === "contract-shared" ? "same ID" : "different ID"

    test(`stale finalize and unsubscribe preserve a newer ${idCase} guarded owner`, () => {
      const staleOwner = {
        runId: "run-shared",
        controller: new AbortController(),
        cancelRequested: false,
      }
      const replacementOwner = {
        runId: "run-shared",
        controller: new AbortController(),
        cancelRequested: false,
      }
      const staleContract = guardedContract({
        id: "contract-shared",
        runId: "run-shared",
      })
      const replacementContract = guardedContract({
        id: replacementId,
        runId: "run-shared",
      })
      replaceActiveGuardedContractForSubChat(
        staleContract.subChatId,
        staleContract,
      )
      replaceActiveGuardedContractForSubChat(
        replacementContract.subChatId,
        replacementContract,
      )

      finalizeCodexDesktopRunAfterLifecycle({
        state: createCodexDesktopRunState(),
        activeStreamOwner: staleOwner,
        guardedContract: staleContract,
        chatId: "chat-1",
        subChatId: "sub-1",
        runId: "run-shared",
        getFallbackDb: () => {
          throw new Error("no job must not resolve a fallback DB")
        },
        revokeProviderBinding: () => {},
        clearProviderSecrets: () => {},
        dependencies: {
          getActiveStream: () => replacementOwner,
        },
      })
      cleanupCodexDesktopRunSubscription({
        state: createCodexDesktopRunState(),
        activeStreamOwner: staleOwner,
        guardedContract: staleContract,
        subChatId: "sub-1",
        markInactive: () => {},
        getFallbackDb: () => fakeDb,
        revokeProviderBinding: () => {},
        dependencies: {
          getActiveStream: () => replacementOwner,
          requestCancelDesktopJob: () => null,
        },
      })

      expect(isActiveGuardedContract(replacementContract)).toBe(true)
      expect(replacementOwner.controller.signal.aborted).toBe(false)
    })
  }

  test("subscription cleanup requests cancellation before abort and revoke", () => {
    const calls: string[] = []
    const state = createCodexDesktopRunState()
    const abortController = new AbortController()
    abortController.signal.addEventListener("abort", () => calls.push("abort"))
    const activeStream = {
      runId: "run-1",
      controller: abortController,
      cancelRequested: false,
    }

    cleanupCodexDesktopRunSubscription({
      state,
      activeStreamOwner: activeStream,
      guardedContract: null,
      subChatId: "sub-1",
      markInactive: () => calls.push("inactive"),
      getFallbackDb: () => {
        calls.push("fallback-db")
        return fakeDb
      },
      revokeProviderBinding: () => calls.push("revoke"),
      dependencies: {
        requestCancelDesktopJob: (_db, input) => {
          calls.push("request-cancel")
          expect(_db).toBe(fakeDb)
          expect(input).toEqual({
            jobId: null,
            sawError: false,
            reachedNaturalFinish: false,
            requestedBy: "desktop-chat",
          })
          return null
        },
        getActiveStream: () => {
          calls.push("get-active")
          return activeStream
        },
      },
    })

    expect(calls).toEqual([
      "inactive",
      "fallback-db",
      "request-cancel",
      "abort",
      "revoke",
      "get-active",
    ])
    expect(activeStream.cancelRequested).toBe(true)
  })

  test("stale subscription cleanup cannot mark or abort a replacement with the same run id", () => {
    const staleOwner = {
      runId: "run-shared",
      controller: new AbortController(),
      cancelRequested: false,
    }
    const replacementOwner = {
      runId: "run-shared",
      controller: new AbortController(),
      cancelRequested: false,
    }
    let cancelRequests = 0

    cleanupCodexDesktopRunSubscription({
      state: createCodexDesktopRunState(),
      activeStreamOwner: staleOwner,
      guardedContract: null,
      subChatId: "sub-1",
      markInactive: () => {},
      getFallbackDb: () => fakeDb,
      revokeProviderBinding: () => {},
      dependencies: {
        requestCancelDesktopJob: () => {
          cancelRequests += 1
          return null
        },
        getActiveStream: () => replacementOwner,
      },
    })

    expect(cancelRequests).toBe(1)
    expect(staleOwner.controller.signal.aborted).toBe(true)
    expect(staleOwner.cancelRequested).toBe(false)
    expect(replacementOwner.controller.signal.aborted).toBe(false)
    expect(replacementOwner.cancelRequested).toBe(false)
  })

  test("subscription cleanup prefers state DB and forwards job flags", () => {
    const state = createCodexDesktopRunState()
    const activeStreamOwner = {
      runId: "run-1",
      controller: new AbortController(),
      cancelRequested: false,
    }
    state.setDb(fakeDb)
    state.setJobId("job-1")
    state.markSawError()
    state.setReachedNaturalFinish(true)

    cleanupCodexDesktopRunSubscription({
      state,
      activeStreamOwner,
      guardedContract: null,
      subChatId: "sub-1",
      markInactive: () => {},
      getFallbackDb: () => {
        throw new Error("state DB should win")
      },
      revokeProviderBinding: () => {},
      dependencies: {
        requestCancelDesktopJob: (_db, input) => {
          expect(_db).toBe(fakeDb)
          expect(input).toEqual({
            jobId: "job-1",
            sawError: true,
            reachedNaturalFinish: true,
            requestedBy: "desktop-chat",
          })
          return null
        },
        getActiveStream: () => null,
      },
    })
  })
})
