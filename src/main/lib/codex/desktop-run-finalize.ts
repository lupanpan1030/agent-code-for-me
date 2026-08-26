import type { AgentJobMode } from "../../../shared/agent-jobs"
import {
  deleteActiveGuardedContractIfMatch,
  type ValidatedAgentScopeContract,
} from "../agent-guard"
import type { DesktopPermissionPolicy } from "../agent-runtime/permission-policy"
import {
  completeDesktopChatAgentJobSafely,
  createAndRegisterDesktopChatAgentJob,
  type DesktopAgentJobHandle,
  requestCancelDesktopChatAgentJobSafely,
} from "../desktop-agent-jobs"
import type { AgentJobDatabase } from "../headless/job-store"
import {
  type ActiveCodexStream,
  deleteActiveCodexStreamIfOwner,
  getActiveCodexStream,
} from "./active-streams"
import { clearPendingCodexApprovals } from "./tool-approvals"

export type CodexDesktopRunState = {
  setDb(db: AgentJobDatabase): void
  getDb(): AgentJobDatabase | null
  setJobId(jobId: string): void
  getJobId(): string | null
  markSawError(): void
  sawError(): boolean
  setAdapterFailed(adapterFailed: boolean): void
  adapterFailed(): boolean
  setReachedNaturalFinish(reachedNaturalFinish: boolean): void
  reachedNaturalFinish(): boolean
}

export type CodexDesktopRunFinalizeDependencies = {
  clearPendingApprovals: typeof clearPendingCodexApprovals
  completeDesktopJob: typeof completeDesktopChatAgentJobSafely
  createAndRegisterDesktopJob: typeof createAndRegisterDesktopChatAgentJob
  deleteGuardedContractIfMatch: typeof deleteActiveGuardedContractIfMatch
  deleteActiveStreamIfOwner: typeof deleteActiveCodexStreamIfOwner
  getActiveStream: typeof getActiveCodexStream
  requestCancelDesktopJob: typeof requestCancelDesktopChatAgentJobSafely
}

const defaultDependencies: CodexDesktopRunFinalizeDependencies = {
  clearPendingApprovals: clearPendingCodexApprovals,
  completeDesktopJob: completeDesktopChatAgentJobSafely,
  createAndRegisterDesktopJob: createAndRegisterDesktopChatAgentJob,
  deleteGuardedContractIfMatch: deleteActiveGuardedContractIfMatch,
  deleteActiveStreamIfOwner: deleteActiveCodexStreamIfOwner,
  getActiveStream: getActiveCodexStream,
  requestCancelDesktopJob: requestCancelDesktopChatAgentJobSafely,
}

function withDefaultDependencies(
  dependencies: Partial<CodexDesktopRunFinalizeDependencies> | undefined,
): CodexDesktopRunFinalizeDependencies {
  return { ...defaultDependencies, ...dependencies }
}

export function createCodexDesktopRunState(): CodexDesktopRunState {
  let db: AgentJobDatabase | null = null
  let jobId: string | null = null
  let sawError = false
  let adapterFailed = false
  let reachedNaturalFinish = false

  return {
    setDb(nextDb) {
      db = nextDb
    },
    getDb() {
      return db
    },
    setJobId(nextJobId) {
      jobId = nextJobId
    },
    getJobId() {
      return jobId
    },
    markSawError() {
      sawError = true
    },
    sawError() {
      return sawError
    },
    setAdapterFailed(nextAdapterFailed) {
      adapterFailed = nextAdapterFailed
    },
    adapterFailed() {
      return adapterFailed
    },
    setReachedNaturalFinish(nextReachedNaturalFinish) {
      reachedNaturalFinish = nextReachedNaturalFinish
    },
    reachedNaturalFinish() {
      return reachedNaturalFinish
    },
  }
}

export function createAndRegisterCodexDesktopRunJob(input: {
  db: AgentJobDatabase
  state: CodexDesktopRunState
  mode: AgentJobMode
  chatId: string
  subChatId: string
  cwd: string
  prompt: string
  runId: string
  activeStreamOwner: ActiveCodexStream
  permissionPolicy: DesktopPermissionPolicy
  dependencies?: Partial<CodexDesktopRunFinalizeDependencies>
}): DesktopAgentJobHandle {
  const dependencies = withDefaultDependencies(input.dependencies)
  const handle = dependencies.createAndRegisterDesktopJob(input.db, {
    runtime: "codex",
    mode: input.mode,
    chatId: input.chatId,
    subChatId: input.subChatId,
    cwd: input.cwd,
    prompt: input.prompt,
    runId: input.runId,
    permissionPolicy: input.permissionPolicy,
    cancel: () => {
      const activeStream = dependencies.getActiveStream(input.subChatId)
      if (activeStream !== input.activeStreamOwner) return
      input.activeStreamOwner.cancelRequested = true
      input.activeStreamOwner.controller.abort()
      dependencies.clearPendingApprovals("Session cancelled.", input.subChatId)
    },
  })
  input.state.setJobId(handle.job.id)
  return handle
}

export function finalizeCodexDesktopRunAfterLifecycle(input: {
  state: CodexDesktopRunState
  activeStreamOwner: ActiveCodexStream
  guardedContract: ValidatedAgentScopeContract | null
  chatId: string
  subChatId: string
  runId: string
  getFallbackDb: () => AgentJobDatabase
  revokeProviderBinding: () => void
  clearProviderSecrets: () => void
  dependencies?: Partial<CodexDesktopRunFinalizeDependencies>
}): void {
  const dependencies = withDefaultDependencies(input.dependencies)

  input.revokeProviderBinding()
  const jobId = input.state.getJobId()
  if (jobId) {
    dependencies.completeDesktopJob(
      input.state.getDb() ?? input.getFallbackDb(),
      {
        jobId,
        runtime: "codex",
        aborted:
          input.activeStreamOwner.controller.signal.aborted &&
          !input.state.adapterFailed(),
        reachedNaturalFinish: input.state.reachedNaturalFinish(),
        sawError: input.state.sawError() || input.state.adapterFailed(),
        result: {
          runtime: "codex",
          subChatId: input.subChatId,
          chatId: input.chatId,
          runId: input.runId,
        },
      },
    )
  }

  const activeStream = dependencies.getActiveStream(input.subChatId)
  if (activeStream === input.activeStreamOwner) {
    dependencies.clearPendingApprovals("Session cancelled.", input.subChatId)
    dependencies.deleteActiveStreamIfOwner(
      input.subChatId,
      input.activeStreamOwner,
    )
  }
  if (input.guardedContract) {
    dependencies.deleteGuardedContractIfMatch(input.guardedContract)
  }
  input.clearProviderSecrets()
}

export function cleanupCodexDesktopRunSubscription(input: {
  state: CodexDesktopRunState
  activeStreamOwner: ActiveCodexStream
  guardedContract: ValidatedAgentScopeContract | null
  subChatId: string
  markInactive: () => void
  getFallbackDb: () => AgentJobDatabase
  revokeProviderBinding: () => void
  dependencies?: Partial<CodexDesktopRunFinalizeDependencies>
}): void {
  const dependencies = withDefaultDependencies(input.dependencies)

  input.markInactive()
  dependencies.requestCancelDesktopJob(
    input.state.getDb() ?? input.getFallbackDb(),
    {
      jobId: input.state.getJobId(),
      sawError: input.state.sawError(),
      reachedNaturalFinish: input.state.reachedNaturalFinish(),
      requestedBy: "desktop-chat",
    },
  )
  input.activeStreamOwner.controller.abort()
  input.revokeProviderBinding()

  if (input.guardedContract) {
    dependencies.deleteGuardedContractIfMatch(input.guardedContract)
  }

  const activeStream = dependencies.getActiveStream(input.subChatId)
  if (activeStream === input.activeStreamOwner) {
    input.activeStreamOwner.cancelRequested = true
  }
}
