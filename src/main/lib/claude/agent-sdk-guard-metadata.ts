import type {
  AgentGuardEvent,
  AgentScopeContract,
  AgentScopePath,
  AgentSuccessCheck,
  GuardedRunAudit,
} from "../../../shared/agent-scope-contracts"
import {
  buildGuardedRunAudit,
  captureGuardedGitStatus,
  type GuardedGitStatusSnapshot,
} from "../agent-guard/audit"

export type ClaudeAgentSdkGuardedContract = AgentScopeContract & {
  editableScope: AgentScopePath[]
  readOnlyEvidence: AgentScopePath[]
  successChecks: AgentSuccessCheck[]
  blockedPaths: AgentScopePath[]
}

export function createClaudeAgentSdkInitialGuardMetadata(
  guardedContract: ClaudeAgentSdkGuardedContract | null,
): Record<string, any> {
  if (!guardedContract) {
    return {}
  }

  return {
    guardedRun: {
      contractId: guardedContract.id,
      runId: guardedContract.runId ?? guardedContract.id,
      runtime: "claude",
      enforcementMode: "hard",
    },
  }
}

export type FinalizeClaudeAgentSdkGuardMetadataOptions = {
  failed?: boolean
  stopped?: boolean
}

export type FinalizeClaudeAgentSdkGuardMetadataInput = {
  currentMetadata: any
  guardedContract: ClaudeAgentSdkGuardedContract | null
  guardedPreRunStatus: GuardedGitStatusSnapshot | null
  runtimeCwd: string
  guardEvents: AgentGuardEvent[]
  startedAt: string
  options?: FinalizeClaudeAgentSdkGuardMetadataOptions
  emit: (chunk: { type: "guard-audit"; audit: GuardedRunAudit }) => void
  captureGitStatus?: typeof captureGuardedGitStatus
  deleteContract?: (contract: ClaudeAgentSdkGuardedContract) => unknown
}

export async function finalizeClaudeAgentSdkGuardMetadata({
  currentMetadata,
  guardedContract,
  guardedPreRunStatus,
  runtimeCwd,
  guardEvents,
  startedAt,
  options = {},
  emit,
  captureGitStatus = captureGuardedGitStatus,
  deleteContract,
}: FinalizeClaudeAgentSdkGuardMetadataInput): Promise<any> {
  if (!guardedContract || !guardedPreRunStatus) {
    return currentMetadata
  }

  if (!deleteContract) {
    throw new Error("Guarded contract lifecycle dependencies are required")
  }

  const postRunStatus = await captureGitStatus(runtimeCwd)
  const audit = buildGuardedRunAudit({
    contract: guardedContract,
    runtime: "claude",
    enforcementMode: "hard",
    preRunStatus: guardedPreRunStatus,
    postRunStatus,
    guardEvents,
    startedAt,
    failed: options.failed,
    stopped: options.stopped,
  })
  deleteContract(guardedContract)
  emit({ type: "guard-audit", audit })

  return {
    ...currentMetadata,
    guardedRun: {
      ...(currentMetadata?.guardedRun ?? {}),
      audit,
    },
  }
}
