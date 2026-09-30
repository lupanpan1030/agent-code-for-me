import type { AgentJobMode } from "../../../shared/agent-jobs"
import type { DesktopRunRequest } from "../agent-runtime/desktop-run-request"
import type { DesktopPermissionPolicy } from "../agent-runtime/permission-policy"
import type { RuntimeExecutionProvenance } from "../agent-runtime/run-event-ledger"
import {
  bindRunExecutionProvenance,
  type CanonicalDesktopRunLedger,
  getOrCreateRunEventLedger,
} from "../agent-runtime/run-event-ledger-host"
import { captureRunExecutionProvenance } from "../agent-runtime/run-provenance"
import {
  completeDesktopChatAgentJobSafely,
  createAndRegisterDesktopChatAgentJob,
  type DesktopAgentJobHandle,
  requestCancelDesktopChatAgentJobSafely,
} from "../desktop-agent-jobs"
import type { AgentJobDatabase } from "../headless/job-store"
import {
  type CreateClaudeDesktopRunRequestFromRuntimeStartupInput,
  createClaudeDesktopRunRequestFromRuntimeStartup,
} from "./desktop-run-request"
import {
  getBundledClaudeBinaryPath,
  readBundledClaudeBinaryVersion,
} from "./env"

/**
 * The Claude Agent SDK message protocol this adapter decodes (system/init,
 * assistant, user, stream_event and result messages): the compiled-in schema
 * identity run-provenance.ts fingerprints for the Run.
 */
const CLAUDE_AGENT_SDK_SCHEMA_DOCUMENTS = [
  {
    path: "claude-agent-sdk/stream-json-messages.json",
    content: JSON.stringify({
      protocol: "claude-agent-sdk-stream-json",
      messageTypes: ["assistant", "result", "stream_event", "system", "user"],
      correlatedInit: { type: "system", subtype: "init" },
    }),
  },
]

/**
 * Launch caller of the bundled Claude executable (tasks 6.1): captures the
 * executable the SDK query will spawn (getBundledClaudeBinaryPath) without
 * changing its selection.
 */
export async function captureClaudeAgentSdkExecutionProvenance(): Promise<RuntimeExecutionProvenance> {
  const executablePath = getBundledClaudeBinaryPath()
  return captureRunExecutionProvenance({
    runtimeId: "claude-code",
    adapterSource: "claude-agent-sdk",
    version: readBundledClaudeBinaryVersion(executablePath),
    protocolName: "claude-agent-sdk-stream-json",
    protocolVersion: "1",
    executablePath,
    schemaDocuments: CLAUDE_AGENT_SDK_SCHEMA_DOCUMENTS,
  })
}

export type CreateClaudeAgentSdkDesktopJobDependencies = {
  createAndRegisterDesktopChatAgentJob: typeof createAndRegisterDesktopChatAgentJob
  completeDesktopChatAgentJobSafely: typeof completeDesktopChatAgentJobSafely
  requestCancelDesktopChatAgentJobSafely: typeof requestCancelDesktopChatAgentJobSafely
  getRunEventLedger: typeof getOrCreateRunEventLedger
  captureExecutionProvenance: typeof captureClaudeAgentSdkExecutionProvenance
}

export type CreateClaudeAgentSdkDesktopJobInput = {
  db: AgentJobDatabase
  mode: AgentJobMode
  chatId: string
  subChatId: string
  cwd: string
  prompt: string
  runId: string
  cancel: () => void
  permissionPolicy?: DesktopPermissionPolicy | null
  secretHints?: readonly string[]
  dependencies?: Partial<CreateClaudeAgentSdkDesktopJobDependencies>
}

export type ClaudeAgentSdkDesktopJobSetup = {
  handle: DesktopAgentJobHandle
  jobId: string
  ledger: CanonicalDesktopRunLedger
  /**
   * The execution tuple bound to the ledger; the SDK adapter re-checks it
   * immediately before the SDK spawns the executable (tasks 6.1).
   */
  executionProvenance?: RuntimeExecutionProvenance
}

export type CreateClaudeAgentSdkDesktopRunStartupInput =
  CreateClaudeAgentSdkDesktopJobInput &
    Omit<
      CreateClaudeDesktopRunRequestFromRuntimeStartupInput,
      "jobId" | "runId" | "mode" | "prompt" | "ledger" | "executionProvenance"
    > & {
      createDesktopRunRequest?: typeof createClaudeDesktopRunRequestFromRuntimeStartup
    }

export type ClaudeAgentSdkDesktopRunStartup = {
  desktopJob: ClaudeAgentSdkDesktopJobSetup
  desktopRunRequest: DesktopRunRequest
  resumeSessionId?: string | null
}

export type CompleteClaudeAgentSdkDesktopJobAfterRunInput = {
  db: AgentJobDatabase
  jobId: string | null
  chatId: string
  subChatId: string
  abortSignal: AbortSignal
  reachedNaturalFinish: boolean
  sawError: boolean
  dependencies?: Partial<CreateClaudeAgentSdkDesktopJobDependencies>
}

export type RequestCancelClaudeAgentSdkDesktopJobInput = {
  db: AgentJobDatabase
  jobId: string | null
  reachedNaturalFinish: boolean
  sawError: boolean
  dependencies?: Partial<CreateClaudeAgentSdkDesktopJobDependencies>
}

const defaultDependencies: CreateClaudeAgentSdkDesktopJobDependencies = {
  captureExecutionProvenance: captureClaudeAgentSdkExecutionProvenance,
  completeDesktopChatAgentJobSafely,
  createAndRegisterDesktopChatAgentJob,
  getRunEventLedger: getOrCreateRunEventLedger,
  requestCancelDesktopChatAgentJobSafely,
}

function withDefaultDependencies(
  dependencies: Partial<CreateClaudeAgentSdkDesktopJobDependencies> | undefined,
): CreateClaudeAgentSdkDesktopJobDependencies {
  return { ...defaultDependencies, ...dependencies }
}

/**
 * Creates the desktop job, composes its host ledger and binds the execution
 * tuple of the executable the SDK query will launch, before any runtime
 * record.
 */
export async function createClaudeAgentSdkDesktopJob(
  input: CreateClaudeAgentSdkDesktopJobInput,
): Promise<ClaudeAgentSdkDesktopJobSetup> {
  const dependencies = withDefaultDependencies(input.dependencies)
  const jobInput: Parameters<typeof createAndRegisterDesktopChatAgentJob>[1] = {
    runtime: "claude-code",
    mode: input.mode,
    chatId: input.chatId,
    subChatId: input.subChatId,
    cwd: input.cwd,
    prompt: input.prompt,
    runId: input.runId,
    cancel: input.cancel,
  }
  if (input.permissionPolicy) {
    jobInput.permissionPolicy = input.permissionPolicy
  }
  const handle = await dependencies.createAndRegisterDesktopChatAgentJob(
    input.db,
    jobInput,
  )
  const jobId = handle.job.id
  const ledger = await dependencies.getRunEventLedger(input.db, handle.job, {
    secretHints: input.secretHints ?? [],
  })
  const executionProvenance = await dependencies.captureExecutionProvenance()
  await bindRunExecutionProvenance(ledger, executionProvenance)

  return {
    handle,
    jobId,
    ledger,
    executionProvenance,
  }
}

export async function completeClaudeAgentSdkDesktopJobAfterRun(
  input: CompleteClaudeAgentSdkDesktopJobAfterRunInput,
): Promise<void> {
  if (!input.jobId) return

  const dependencies = withDefaultDependencies(input.dependencies)
  await dependencies.completeDesktopChatAgentJobSafely(input.db, {
    jobId: input.jobId,
    runtime: "claude-code",
    aborted: input.abortSignal.aborted,
    reachedNaturalFinish: input.reachedNaturalFinish,
    sawError: input.sawError,
    result: {
      runtime: "claude-code",
      subChatId: input.subChatId,
      chatId: input.chatId,
    },
  })
}

export function requestCancelClaudeAgentSdkDesktopJob(
  input: RequestCancelClaudeAgentSdkDesktopJobInput,
): void {
  const dependencies = withDefaultDependencies(input.dependencies)
  void dependencies.requestCancelDesktopChatAgentJobSafely(input.db, {
    jobId: input.jobId,
    sawError: input.sawError,
    reachedNaturalFinish: input.reachedNaturalFinish,
    requestedBy: "desktop-chat",
  })
}

export async function createClaudeAgentSdkDesktopRunStartup({
  createDesktopRunRequest = createClaudeDesktopRunRequestFromRuntimeStartup,
  ...input
}: CreateClaudeAgentSdkDesktopRunStartupInput): Promise<ClaudeAgentSdkDesktopRunStartup> {
  const desktopJob = await createClaudeAgentSdkDesktopJob(input)
  const desktopRunRequest = createDesktopRunRequest({
    runId: input.runId,
    streamId: input.streamId,
    jobId: desktopJob.jobId,
    mode: input.mode,
    preflight: input.preflight,
    prompt: input.prompt,
    permissionPolicy: input.permissionPolicy,
    customConfig: input.customConfig,
    requestedModel: input.requestedModel,
    modelSource: input.modelSource,
    selectedProviderProfileId: input.selectedProviderProfileId,
    images: input.images,
    longTextAttachments: input.longTextAttachments,
    signal: input.signal,
    existingSessionId: input.existingSessionId,
    ledger: desktopJob.ledger,
    executionProvenance: desktopJob.executionProvenance ?? null,
  })

  return {
    desktopJob,
    desktopRunRequest,
    resumeSessionId: desktopRunRequest.session.resumeSessionId,
  }
}
