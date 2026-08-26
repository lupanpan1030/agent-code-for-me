import { eq } from "drizzle-orm"
import {
  deleteActiveGuardedContractIfMatch,
  type ValidatedAgentScopeContract,
} from "../agent-guard"
import { subChats } from "../db"
import type { AgentJobDatabase } from "../headless/job-store"
import {
  deleteActiveClaudeSessionIfController,
  getActiveClaudeSession,
} from "./active-sessions"
import {
  completeClaudeAgentSdkDesktopJobAfterRun,
  requestCancelClaudeAgentSdkDesktopJob,
} from "./agent-sdk-desktop-job"
import type { ClaudeAgentSdkDesktopRunState } from "./agent-sdk-desktop-run-state"
import { clearClaudePendingToolApprovals } from "./tool-approvals"

export type CleanupClaudeAgentSdkDesktopRunSubscriptionDependencies = {
  deleteActiveClaudeSessionIfController: typeof deleteActiveClaudeSessionIfController
  getActiveClaudeSession: typeof getActiveClaudeSession
  clearClaudePendingToolApprovals: typeof clearClaudePendingToolApprovals
  completeClaudeAgentSdkDesktopJobAfterRun: typeof completeClaudeAgentSdkDesktopJobAfterRun
  requestCancelClaudeAgentSdkDesktopJob: typeof requestCancelClaudeAgentSdkDesktopJob
  deleteGuardedContractIfMatch: (
    contract: ValidatedAgentScopeContract,
  ) => boolean
  log: (...args: any[]) => void
}

export type CleanupClaudeAgentSdkDesktopRunSubscriptionInput = {
  subId: string
  subChatId: string
  sessionId?: string | null
  abortController: AbortController
  guardedContract: ValidatedAgentScopeContract | null
  getDb: () => AgentJobDatabase
  desktopRunState: Pick<
    ClaudeAgentSdkDesktopRunState,
    "getJobId" | "markInactive" | "reachedNaturalFinish" | "sawError"
  >
  cleanupRuntimeSecrets?: () => void
  dependencies?: Partial<CleanupClaudeAgentSdkDesktopRunSubscriptionDependencies>
}

export type CleanupClaudeAgentSdkDesktopRunSubscriptionResult = {
  ownsActiveSession: boolean
}

export type FinalizeClaudeAgentSdkDesktopRunAfterLifecycleInput = {
  chatId: string
  subChatId: string
  abortController: AbortController
  guardedContract: ValidatedAgentScopeContract | null
  getDb: () => AgentJobDatabase
  desktopRunState: Pick<
    ClaudeAgentSdkDesktopRunState,
    "getDb" | "getJobId" | "reachedNaturalFinish" | "sawError"
  >
  dependencies?: Partial<CleanupClaudeAgentSdkDesktopRunSubscriptionDependencies>
}

export type AbortClaudeAgentSdkDesktopRunRequestInput = {
  subChatId: string
  abortController: AbortController
  message?: string
  dependencies?: Partial<CleanupClaudeAgentSdkDesktopRunSubscriptionDependencies>
}

const defaultDependencies: CleanupClaudeAgentSdkDesktopRunSubscriptionDependencies =
  {
    clearClaudePendingToolApprovals,
    completeClaudeAgentSdkDesktopJobAfterRun,
    deleteActiveClaudeSessionIfController,
    deleteGuardedContractIfMatch: deleteActiveGuardedContractIfMatch,
    getActiveClaudeSession,
    log: console.log,
    requestCancelClaudeAgentSdkDesktopJob,
  }

function withDefaultDependencies(
  dependencies:
    | Partial<CleanupClaudeAgentSdkDesktopRunSubscriptionDependencies>
    | undefined,
): CleanupClaudeAgentSdkDesktopRunSubscriptionDependencies {
  return { ...defaultDependencies, ...dependencies }
}

export function cleanupClaudeAgentSdkDesktopRunSubscription(
  input: CleanupClaudeAgentSdkDesktopRunSubscriptionInput,
): CleanupClaudeAgentSdkDesktopRunSubscriptionResult {
  const dependencies = withDefaultDependencies(input.dependencies)

  dependencies.log(
    `[SD] M:CLEANUP sub=${input.subId} sessionId=${input.sessionId || "none"}`,
  )
  input.desktopRunState.markInactive()
  input.abortController.abort()
  input.cleanupRuntimeSecrets?.()

  // Keep the exact aborted owner registered until the supervised runtime
  // lifecycle settles. Rollback must continue to observe an active/draining
  // Run, while signal-aware runtime and persistence checks fail closed.
  const ownsActiveSession =
    dependencies.getActiveClaudeSession(input.subChatId)?.controller ===
    input.abortController

  if (input.guardedContract) {
    dependencies.deleteGuardedContractIfMatch(input.guardedContract)
  }

  if (ownsActiveSession) {
    dependencies.clearClaudePendingToolApprovals(
      "Session ended.",
      input.subChatId,
    )
  }

  const db = input.getDb()
  dependencies.requestCancelClaudeAgentSdkDesktopJob({
    db,
    jobId: input.desktopRunState.getJobId(),
    sawError: input.desktopRunState.sawError(),
    reachedNaturalFinish: input.desktopRunState.reachedNaturalFinish(),
  })

  if (ownsActiveSession) {
    db.update(subChats)
      .set({ streamId: null })
      .where(eq(subChats.id, input.subChatId))
      .run()
  }

  return { ownsActiveSession }
}

export function finalizeClaudeAgentSdkDesktopRunAfterLifecycle(
  input: FinalizeClaudeAgentSdkDesktopRunAfterLifecycleInput,
): void {
  const dependencies = withDefaultDependencies(input.dependencies)
  const desktopJobId = input.desktopRunState.getJobId()

  if (desktopJobId) {
    dependencies.completeClaudeAgentSdkDesktopJobAfterRun({
      db: input.desktopRunState.getDb() ?? input.getDb(),
      jobId: desktopJobId,
      chatId: input.chatId,
      subChatId: input.subChatId,
      abortSignal: input.abortController.signal,
      reachedNaturalFinish: input.desktopRunState.reachedNaturalFinish(),
      sawError: input.desktopRunState.sawError(),
    })
  }

  dependencies.deleteActiveClaudeSessionIfController(
    input.subChatId,
    input.abortController,
  )

  if (input.guardedContract) {
    dependencies.deleteGuardedContractIfMatch(input.guardedContract)
  }
}

export function abortClaudeAgentSdkDesktopRunRequest(
  input: AbortClaudeAgentSdkDesktopRunRequestInput,
): void {
  const dependencies = withDefaultDependencies(input.dependencies)
  const ownsActiveSession =
    dependencies.getActiveClaudeSession(input.subChatId)?.controller ===
    input.abortController

  input.abortController.abort()
  if (ownsActiveSession) {
    dependencies.clearClaudePendingToolApprovals(
      input.message ?? "Session cancelled.",
      input.subChatId,
    )
  }
}
