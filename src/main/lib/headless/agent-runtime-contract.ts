import type {
  AgentJobEventType,
  AgentJobMode,
  AgentJobSource,
  AgentJobStatus,
} from "../../../shared/agent-jobs"
import {
  type AgentRuntimeContractId,
  getAgentRunRequiredCapabilityIds,
} from "../../../shared/agent-runtime-capabilities"
import {
  type NonDesktopInteractiveRequirement,
  type NonDesktopPolicyGrant,
  resolveNonDesktopPermissionPolicy,
} from "../agent-runtime/permission-policy"
import type {
  AgentRuntimeExecutionProfile,
  AgentRuntimePermissionPolicySummary,
  AgentRuntimePersistedObserver,
  AgentRuntimeProviderReference,
  AgentRuntimeRunContextBase,
  AgentRuntimeRunIdentityBase,
  AgentRuntimeRunRequestBase,
  AgentRuntimeRunResultBase,
} from "../agent-runtime/run-contract"
import type { RuntimeExecutionProvenance } from "../agent-runtime/run-event-ledger"
import type { CanonicalDesktopRunLedger } from "../agent-runtime/run-event-ledger-host"
import type { AgentJob } from "../db/schema"

/**
 * Thin coarse ingress of one headless Run: `appendEvent` submits a coarse
 * observation to the Run's host ledger (it returns nothing; the ledger owns
 * sequence, redaction and the committed record).
 */
export type AgentRuntimeObserver = AgentRuntimePersistedObserver<
  AgentJobEventType,
  void,
  AgentJob
> & {
  /** Registers main-process-only exact secrets for this run's persistence boundary. */
  registerSecretHints(hints: readonly string[]): void
  /**
   * The launch caller hands the execution tuple it captured through
   * run-provenance.ts at executable resolution; the host binds it to the Run
   * before runtime execution. Observers without a host ledger omit it.
   */
  recordExecutionProvenance?(
    provenance: RuntimeExecutionProvenance,
  ): Promise<void>
  /**
   * The Run's host-composed ledger, for adapters that ingest native
   * boundaries themselves (the Codex app-server wrapper).
   */
  runLedger?: CanonicalDesktopRunLedger
}

export const AGENT_RUNTIME_SECURITY_CLEANUP_ERROR_CODE =
  "runtime_security_cleanup_failed" as const

export type AgentRuntimeRunIdentity = AgentRuntimeRunIdentityBase & {
  jobId: string
  attempt?: number | null
}

export type AgentRuntimeRunContext = AgentRuntimeRunContextBase & {
  runtimeId: AgentRuntimeContractId
  mode: AgentJobMode
  source: AgentJobSource
  executionProfile: AgentRuntimeExecutionProfile
  hasScopeContract?: boolean
  projectId?: string | null
  chatId?: string | null
  subChatId?: string | null
  apiConsumerId?: string | null
  apiConsumerRunId?: string | null
  artifactBaseDir?: string | null
  artifactManifestPath?: string | null
}

export type HeadlessAgentRuntimeProviderReference =
  AgentRuntimeProviderReference & {
    providerProfileName?: string | null
    gatewayToken?: string | null
  }

export type AgentRuntimeRunRequest = AgentRuntimeRunRequestBase<
  AgentRuntimeRunIdentity,
  AgentRuntimeRunContext,
  AgentRuntimePermissionPolicySummary,
  HeadlessAgentRuntimeProviderReference | null
>

type AgentRuntimeTerminalStatus = Exclude<AgentJobStatus, "queued" | "running">

export type AgentRuntimeRunResult = Omit<
  AgentRuntimeRunResultBase<AgentRuntimeTerminalStatus>,
  "status"
> & {
  status: AgentRuntimeTerminalStatus
  exitCode?: number | null
  errorCode?: string | null
  errorMessage?: string | null
  result?: unknown
}

export type CreateAgentRuntimeRunRequestInput = {
  jobId: string
  runtime: AgentRuntimeContractId
  cwd: string
  mode: AgentJobMode
  source: AgentJobSource
  executionProfile?: AgentRuntimeExecutionProfile
  prompt: string
  signal: AbortSignal
  attempt?: number | null
  hasScopeContract?: boolean
  projectId?: string | null
  chatId?: string | null
  subChatId?: string | null
  apiConsumerId?: string | null
  apiConsumerRunId?: string | null
  artifactBaseDir?: string | null
  artifactManifestPath?: string | null
  hasVisibleUserInteractionChannel?: boolean
  interactiveRequirements?: NonDesktopInteractiveRequirement[]
  policyGrant?: NonDesktopPolicyGrant | null
  providerBinding?: HeadlessAgentRuntimeProviderReference | null
}

export function createHeadlessBatchPermissionSummary(input: {
  source: AgentJobSource
  mode?: AgentJobMode
}): AgentRuntimePermissionPolicySummary {
  return resolveNonDesktopPermissionPolicy({
    source: input.source,
    mode: input.mode ?? "agent",
  })
}

function optionalContext(
  input: CreateAgentRuntimeRunRequestInput,
): Partial<AgentRuntimeRunContext> {
  return {
    ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    ...(input.chatId !== undefined ? { chatId: input.chatId } : {}),
    ...(input.subChatId !== undefined ? { subChatId: input.subChatId } : {}),
    ...(input.apiConsumerId !== undefined
      ? { apiConsumerId: input.apiConsumerId }
      : {}),
    ...(input.apiConsumerRunId !== undefined
      ? { apiConsumerRunId: input.apiConsumerRunId }
      : {}),
    ...(input.artifactBaseDir !== undefined
      ? { artifactBaseDir: input.artifactBaseDir }
      : {}),
    ...(input.artifactManifestPath !== undefined
      ? { artifactManifestPath: input.artifactManifestPath }
      : {}),
    ...(input.hasScopeContract !== undefined
      ? { hasScopeContract: input.hasScopeContract }
      : {}),
  }
}

export function createAgentRuntimeRunRequest(
  input: CreateAgentRuntimeRunRequestInput,
): AgentRuntimeRunRequest {
  const executionProfile = input.executionProfile ?? "batch"
  return {
    identity: {
      jobId: input.jobId,
      attempt: input.attempt,
    },
    context: {
      runtimeId: input.runtime,
      mode: input.mode,
      cwd: input.cwd,
      source: input.source,
      executionProfile,
      ...optionalContext(input),
    },
    prompt: input.prompt,
    signal: input.signal,
    requestedCapabilities: getAgentRunRequiredCapabilityIds({
      mode: input.mode,
      hasScopeContract: input.hasScopeContract ?? false,
    }),
    permissionPolicy: resolveNonDesktopPermissionPolicy({
      source: input.source,
      mode: input.mode,
      executionProfile,
      hasVisibleUserInteractionChannel: input.hasVisibleUserInteractionChannel,
      interactiveRequirements: input.interactiveRequirements,
      policyGrant: input.policyGrant,
    }),
    providerBinding: input.providerBinding ?? null,
  }
}

export type AgentTaskRunner = (
  request: AgentRuntimeRunRequest,
  observer: AgentRuntimeObserver,
) => Promise<AgentRuntimeRunResult>
