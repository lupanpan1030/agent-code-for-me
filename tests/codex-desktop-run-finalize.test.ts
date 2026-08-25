import { describe, expect, test } from "bun:test"
import type { DesktopPermissionPolicy } from "../src/main/lib/agent-runtime/permission-policy"
import {
  cleanupCodexDesktopRunSubscription,
  createAndRegisterCodexDesktopRunJob,
  createCodexDesktopRunState,
  finalizeCodexDesktopRunAfterLifecycle,
} from "../src/main/lib/codex/desktop-run-finalize"
import type { DesktopAgentJobHandle } from "../src/main/lib/desktop-agent-jobs"
import type { AgentJobDatabase } from "../src/main/lib/headless/job-store"

const fakeDb = {} as AgentJobDatabase
const permissionPolicy = {} as DesktopPermissionPolicy

describe("Codex desktop run finalization owner", () => {
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

  test("registers a run-id-fenced cancel callback", () => {
    const state = createCodexDesktopRunState()
    const currentController = new AbortController()
    const staleController = new AbortController()
    const currentStream = {
      runId: "run-1",
      controller: currentController,
      cancelRequested: false,
    }
    const staleStream = {
      runId: "run-new",
      controller: staleController,
      cancelRequested: false,
    }
    const clearCalls: unknown[] = []
    let registeredCancel: (() => void) | undefined
    let activeRunId = "run-new"

    createAndRegisterCodexDesktopRunJob({
      db: fakeDb,
      state,
      mode: "agent",
      chatId: "chat-1",
      subChatId: "sub-1",
      cwd: "/repo",
      prompt: "hello",
      runId: "run-1",
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
        getActiveStream: () =>
          activeRunId === "run-1" ? currentStream : staleStream,
        clearPendingApprovals: (...args) => clearCalls.push(args),
      },
    })

    expect(state.getJobId()).toBe("job-1")
    registeredCancel?.()
    expect(staleController.signal.aborted).toBe(false)
    expect(clearCalls).toEqual([])

    activeRunId = "run-1"
    registeredCancel?.()
    expect(currentStream.cancelRequested).toBe(true)
    expect(currentController.signal.aborted).toBe(true)
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

    finalizeCodexDesktopRunAfterLifecycle({
      state,
      abortController,
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
        getActiveStream: () => ({
          runId: "run-1",
          controller: abortController,
          cancelRequested: false,
        }),
        clearPendingApprovals: () => calls.push("clear-approvals"),
        deleteActiveStreamIfRun: () => {
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

    finalizeCodexDesktopRunAfterLifecycle({
      state,
      abortController,
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
    for (const activeRunId of ["run-new", null]) {
      const calls: string[] = []
      finalizeCodexDesktopRunAfterLifecycle({
        state: createCodexDesktopRunState(),
        abortController: new AbortController(),
        chatId: "chat-1",
        subChatId: "sub-1",
        runId: "run-1",
        getFallbackDb: () => {
          throw new Error("no job must not resolve a fallback DB")
        },
        revokeProviderBinding: () => calls.push("revoke"),
        clearProviderSecrets: () => calls.push("clear-secrets"),
        dependencies: {
          getActiveStream: () =>
            activeRunId
              ? {
                  runId: activeRunId,
                  controller: new AbortController(),
                  cancelRequested: false,
                }
              : null,
          clearPendingApprovals: () => calls.push("clear-approvals"),
          deleteActiveStreamIfRun: () => {
            calls.push("delete-stream")
            return true
          },
        },
      })

      expect(calls).toEqual(["revoke", "clear-secrets"])
    }
  })

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
      abortController,
      subChatId: "sub-1",
      runId: "run-1",
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

  test("subscription cleanup prefers state DB and forwards job flags", () => {
    const state = createCodexDesktopRunState()
    state.setDb(fakeDb)
    state.setJobId("job-1")
    state.markSawError()
    state.setReachedNaturalFinish(true)

    cleanupCodexDesktopRunSubscription({
      state,
      abortController: new AbortController(),
      subChatId: "sub-1",
      runId: "run-1",
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
