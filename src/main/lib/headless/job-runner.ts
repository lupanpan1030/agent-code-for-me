import type {
  AgentJobContractRuntime,
  AgentJobEventType,
  AgentJobMode,
  AgentJobSource,
  AgentJobStatus,
} from "../../../shared/agent-jobs"
import { isTerminalAgentJobStatus } from "../../../shared/agent-jobs"
import type { LocalJobApiResolvedProvider } from "../../../shared/local-job-api"
import {
  createExactSecretStreamChannelRedactor,
  type ExactSecretStreamFragment,
} from "../agent-runtime/redaction"
import type { AgentJob, AgentJobEvent } from "../db/schema"
import type {
  AgentRuntimeObserver,
  AgentRuntimeRunRequest,
  AgentRuntimeRunResult,
  AgentTaskRunner,
} from "./agent-runtime-contract"
import {
  AGENT_RUNTIME_SECURITY_CLEANUP_ERROR_CODE,
  createAgentRuntimeRunRequest,
} from "./agent-runtime-contract"
import {
  type AgentJobDatabase,
  appendAgentJobEvent,
  completeAgentJob,
  getAgentJob,
  getAgentJobPrompt,
  heartbeatAgentJob,
  listAgentJobEvents,
  startAgentJob,
} from "./job-store"
import { getLocalJobApiStoredRequest } from "./local-job-api"
import {
  type HeadlessProviderBindingDependencies,
  HeadlessProviderBindingError,
  type HeadlessProviderBindingResolution,
  isInvalidHeadlessProviderBindingRequestCode,
  isLocalOnlyHeadlessProviderBindingCode,
  isUnavailableHeadlessProviderBindingCode,
  resolveHeadlessProviderBinding,
} from "./provider-binding"

export const HEADLESS_EXIT_CODES = {
  success: 0,
  runtimeFailed: 1,
  invalidArguments: 2,
  unsupportedRuntimeOrMode: 3,
  missingCredentials: 4,
  canceled: 5,
  localOnlyBlocked: 6,
  invalidCwd: 7,
  internalFailure: 8,
} as const

export type RunPersistedAgentJobOptions = {
  db: AgentJobDatabase
  jobId: string
  runner?: AgentTaskRunner | null
  env?: NodeJS.ProcessEnv
  workerId?: string
  workerPid?: number | null
  signal?: AbortSignal
  providerBindingDependencies?: HeadlessProviderBindingDependencies
}

export type RunPersistedAgentJobResult = {
  job: AgentJob
  events: AgentJobEvent[]
  exitCode: number
}

export function isFakeRunnerEnabled(
  env: NodeJS.ProcessEnv | undefined,
): boolean {
  return env?.LOCUS_HEADLESS_FAKE_RUNNER === "1"
}

export function fakeAgentTaskRunner(
  request: AgentRuntimeRunRequest,
  observer: AgentRuntimeObserver,
): Promise<AgentRuntimeRunResult> {
  observer.appendEvent("status", {
    fake: true,
    status: "running",
    runtime: request.context.runtimeId,
  })
  observer.appendEvent("assistant_delta", {
    fake: true,
    text: `Fake ${request.context.runtimeId} response for: ${request.prompt.slice(0, 120)}`,
  })
  observer.heartbeat()
  return Promise.resolve({
    status: "succeeded",
    exitCode: 0,
    result: {
      fake: true,
      finalMessage: `Fake ${request.context.runtimeId} job completed.`,
    },
  })
}

export function normalizeHeadlessExitCode(input: {
  status?: AgentJobStatus | null
  errorCode?: string | null
}): number {
  if (input.status === "succeeded") return HEADLESS_EXIT_CODES.success
  if (input.status === "canceled") return HEADLESS_EXIT_CODES.canceled
  if (input.errorCode === "unsupported_capability") {
    return HEADLESS_EXIT_CODES.unsupportedRuntimeOrMode
  }
  if (input.errorCode === "runtime_auth_required") {
    return HEADLESS_EXIT_CODES.missingCredentials
  }
  if (isInvalidHeadlessProviderBindingRequestCode(input.errorCode)) {
    return HEADLESS_EXIT_CODES.invalidArguments
  }
  if (isUnavailableHeadlessProviderBindingCode(input.errorCode)) {
    return HEADLESS_EXIT_CODES.missingCredentials
  }
  if (isLocalOnlyHeadlessProviderBindingCode(input.errorCode)) {
    return HEADLESS_EXIT_CODES.localOnlyBlocked
  }
  if (input.errorCode === "invalid_cwd") return HEADLESS_EXIT_CODES.invalidCwd
  if (
    input.errorCode === "spawn_failed" ||
    input.errorCode === "heartbeat_failed" ||
    input.errorCode === "internal_error" ||
    input.errorCode === "runtime_result_invalid"
  ) {
    return HEADLESS_EXIT_CODES.internalFailure
  }
  return HEADLESS_EXIT_CODES.runtimeFailed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

type HeadlessStreamEvent = {
  eventType: AgentJobEventType
  payload: unknown
}

type HeadlessStreamTextDescriptor =
  ExactSecretStreamFragment<HeadlessStreamEvent>

function headlessStreamTextDescriptor(
  type: AgentJobEventType,
  payload: unknown,
): HeadlessStreamTextDescriptor | null {
  if (!isRecord(payload)) return null
  const id =
    type === "tool_delta"
      ? typeof payload.toolCallId === "string"
        ? payload.toolCallId
        : typeof payload.id === "string"
          ? payload.id
          : "default"
      : typeof payload.id === "string"
        ? payload.id
        : "default"
  if (
    type === "assistant_delta" ||
    type === "reasoning_delta" ||
    type === "tool_delta"
  ) {
    const field =
      typeof payload.delta === "string"
        ? "delta"
        : typeof payload.text === "string"
          ? "text"
          : null
    if (!field) return null
    const family =
      type === "assistant_delta"
        ? "assistant"
        : type === "reasoning_delta"
          ? "reasoning"
          : "tool"
    return {
      channel: `${family}:${id}`,
      value: payload[field] as string,
      withValue: (value) => ({
        eventType: type,
        payload: { ...payload, [field]: value },
      }),
    }
  }
  if (type === "command_output" && typeof payload.text === "string") {
    const stream =
      typeof payload.stream === "string" ? payload.stream : "default"
    return {
      channel: `command-output:${stream}`,
      value: payload.text,
      withValue: (value) => ({
        eventType: type,
        payload: { ...payload, text: value },
      }),
    }
  }
  if (
    type === "status" &&
    payload.chunkType === "file-change-delta" &&
    isRecord(payload.data) &&
    typeof payload.data.delta === "string"
  ) {
    const dataDelta = payload.data.delta
    const data = payload.data
    const fileChangeId = typeof data.id === "string" ? data.id : "default"
    return {
      channel: `file-change:${fileChangeId}`,
      value: dataDelta,
      withValue: (value) => ({
        eventType: type,
        payload: {
          ...payload,
          data: { ...data, delta: value },
        },
      }),
    }
  }
  return null
}

function headlessStreamBoundary(
  type: AgentJobEventType,
  payload: unknown,
): "all" | string[] | null {
  if (type === "completed" || type === "command_finished") return "all"
  if (type !== "tool_finished") return null

  const toolCallId =
    isRecord(payload) && typeof payload.toolCallId === "string"
      ? payload.toolCallId
      : isRecord(payload) && typeof payload.id === "string"
        ? payload.id
        : "default"
  return [`tool:${toolCallId}`]
}

type HeadlessObserverController = {
  observer: AgentRuntimeObserver
  flush: () => void
}

function createObserver(
  db: AgentJobDatabase,
  jobId: string,
  workerId: string,
  abortController: AbortController,
  getSecretHints: () => readonly string[],
  registerSecretHints: (hints: readonly string[]) => void,
): HeadlessObserverController {
  const streamSecretRedactor =
    createExactSecretStreamChannelRedactor<HeadlessStreamEvent>()

  const appendDirect = (type: AgentJobEventType, payload: unknown) =>
    appendAgentJobEvent(db, {
      jobId,
      type,
      payload,
      secretHints: getSecretHints(),
    })

  const flush = () => {
    const secretHints = getSecretHints()
    for (const redacted of streamSecretRedactor.flush(secretHints)) {
      appendDirect(redacted.value.eventType, redacted.value.payload)
    }
  }

  const flushChannels = (channels: readonly string[]) => {
    const secretHints = getSecretHints()
    for (const redacted of streamSecretRedactor.flushChannels(
      channels,
      secretHints,
    )) {
      appendDirect(redacted.value.eventType, redacted.value.payload)
    }
  }

  const observer: AgentRuntimeObserver = {
    appendEvent(type, payload) {
      const current = getAgentJob(db, jobId)
      if (current?.cancelRequestedAt) abortController.abort()
      const boundary = headlessStreamBoundary(type, payload)
      if (boundary === "all") flush()
      else if (boundary) flushChannels(boundary)

      const descriptor = headlessStreamTextDescriptor(type, payload)
      if (!descriptor) return appendDirect(type, payload)

      const redacted = streamSecretRedactor.push(descriptor, getSecretHints())
      return appendDirect(redacted.value.eventType, redacted.value.payload)
    },
    heartbeat() {
      const job = heartbeatAgentJob(db, jobId, workerId)
      if (job.cancelRequestedAt) abortController.abort()
      return job
    },
    isCancelRequested() {
      const job = getAgentJob(db, jobId)
      const requested = !!job?.cancelRequestedAt
      if (requested) abortController.abort()
      return requested
    },
    registerSecretHints(hints) {
      registerSecretHints(hints)
    },
  }
  return { observer, flush }
}

class InvalidAgentRuntimeRunResultError extends Error {
  constructor() {
    super("Agent runtime returned no valid terminal status.")
    this.name = "InvalidAgentRuntimeRunResultError"
  }
}

function assertAgentRuntimeRunResult(
  result: unknown,
): asserts result is AgentRuntimeRunResult {
  if (
    !isRecord(result) ||
    typeof result.status !== "string" ||
    !isTerminalAgentJobStatus(result.status as AgentJobStatus)
  ) {
    throw new InvalidAgentRuntimeRunResultError()
  }
}

function isRuntimeSecurityCleanupFailure(value: unknown): boolean {
  return (
    (isRecord(value) &&
      value.errorCode === AGENT_RUNTIME_SECURITY_CLEANUP_ERROR_CODE) ||
    (value instanceof Error &&
      value.name === "CodexAppServerShellSnapshotScrubError")
  )
}

function providerSecretHints(
  resolution: HeadlessProviderBindingResolution | null,
): readonly string[] {
  return resolution?.getSecretHints() ?? []
}

async function resolveRunner(
  runner: AgentTaskRunner | null | undefined,
  env: NodeJS.ProcessEnv | undefined,
): Promise<AgentTaskRunner> {
  if (runner) return runner
  if (isFakeRunnerEnabled(env)) return fakeAgentTaskRunner
  return (await import("./agent-runtime")).runAgentTask
}

function canceledRunResult(): AgentRuntimeRunResult {
  return {
    status: "canceled",
    exitCode: HEADLESS_EXIT_CODES.canceled,
    errorCode: "job_canceled",
    errorMessage: "Job was canceled.",
  }
}

function localJobApiRuntimeOptions(
  job: AgentJob,
): Pick<
  Parameters<typeof createAgentRuntimeRunRequest>[0],
  "executionProfile" | "policyGrant"
> {
  if (job.source !== "api") return {}
  try {
    const request = getLocalJobApiStoredRequest(job)
    if (request.kind !== "agent") return {}
    return {
      executionProfile: request.runtime.executionProfile,
      policyGrant: request.runtime.policyGrant,
    }
  } catch {
    return {}
  }
}

function resultWithResolvedProvider(
  result: unknown,
  resolvedProvider: LocalJobApiResolvedProvider,
): Record<string, unknown> {
  if (isRecord(result)) {
    return {
      ...result,
      resolvedProvider,
    }
  }
  return {
    value: result ?? null,
    resolvedProvider,
  }
}

function resolvedProviderForError(
  error: unknown,
  job: AgentJob,
  providerResolution: HeadlessProviderBindingResolution | null,
): LocalJobApiResolvedProvider {
  if (providerResolution) return providerResolution.resolvedProvider
  if (error instanceof HeadlessProviderBindingError) {
    return {
      source: error.source,
      profileId: error.profileId,
      model: job.modelOverride,
    }
  }
  return {
    source: job.providerProfileId ? "request-profile" : "native",
    profileId: job.providerProfileId ?? null,
    model: job.modelOverride,
  }
}

function appendResolvedProviderEvent(input: {
  db: AgentJobDatabase
  jobId: string
  resolvedProvider: LocalJobApiResolvedProvider
  secretHints?: readonly string[]
}): void {
  if (input.resolvedProvider.source !== "default-profile") return
  appendAgentJobEvent(input.db, {
    jobId: input.jobId,
    type: "status",
    payload: {
      providerBinding: {
        resolvedProvider: input.resolvedProvider,
      },
    },
    secretHints: input.secretHints,
  })
}

export async function runPersistedAgentJob(
  options: RunPersistedAgentJobOptions,
): Promise<RunPersistedAgentJobResult> {
  const initial = getAgentJob(options.db, options.jobId)
  if (!initial) throw new Error(`Unknown job: ${options.jobId}`)
  const workerId =
    options.workerId ?? `headless:${process.pid}:${Date.now()}:${initial.id}`
  const workerPid =
    options.workerPid === undefined ? process.pid : options.workerPid
  const job = startAgentJob(options.db, {
    jobId: initial.id,
    workerId,
    workerPid,
  })
  const prompt = getAgentJobPrompt(options.db, job.id)
  const runner = await resolveRunner(options.runner, options.env)
  const abortController = new AbortController()
  const abortFromExternalSignal = () => abortController.abort()
  if (options.signal?.aborted) {
    abortController.abort()
  } else {
    options.signal?.addEventListener("abort", abortFromExternalSignal, {
      once: true,
    })
  }
  let providerResolution: HeadlessProviderBindingResolution | null = null
  const dynamicSecretHints = new Set<string>()
  const runSecretHints = () => [
    ...new Set([
      ...providerSecretHints(providerResolution),
      ...dynamicSecretHints,
    ]),
  ]
  const observerController = createObserver(
    options.db,
    job.id,
    workerId,
    abortController,
    runSecretHints,
    (hints) => {
      for (const hint of hints) {
        if (hint) dynamicSecretHints.add(hint)
      }
    },
  )
  const observer = observerController.observer
  const runtimeOptions = localJobApiRuntimeOptions(job)

  try {
    providerResolution = await resolveHeadlessProviderBinding({
      db: options.db,
      runtime: job.runtime as AgentJobContractRuntime,
      providerProfileId: job.providerProfileId,
      modelOverride: job.modelOverride,
      dependencies: options.providerBindingDependencies,
    })
    appendResolvedProviderEvent({
      db: options.db,
      jobId: job.id,
      resolvedProvider: providerResolution.resolvedProvider,
      secretHints: providerSecretHints(providerResolution),
    })
    const result = abortController.signal.aborted
      ? canceledRunResult()
      : await runner(
          createAgentRuntimeRunRequest({
            jobId: job.id,
            runtime: job.runtime as AgentJobContractRuntime,
            cwd: job.cwd,
            mode: job.mode as AgentJobMode,
            source: job.source as AgentJobSource,
            prompt,
            signal: abortController.signal,
            attempt: job.attempt,
            ...runtimeOptions,
            projectId: job.projectId,
            chatId: job.chatId,
            subChatId: job.subChatId,
            apiConsumerId: job.apiConsumerId,
            apiConsumerRunId: job.apiConsumerRunId,
            artifactBaseDir: job.artifactBaseDir,
            artifactManifestPath: job.artifactManifestPath,
            providerBinding: providerResolution.providerBinding,
          }),
          observer,
        )
    assertAgentRuntimeRunResult(result)
    observerController.flush()
    const securityCleanupFailed = isRuntimeSecurityCleanupFailure(result)
    const canceled =
      !securityCleanupFailed &&
      (observer.isCancelRequested() || abortController.signal.aborted)
    const status = canceled ? "canceled" : result.status
    const errorCode = canceled ? "job_canceled" : (result.errorCode ?? null)
    const exitCode = normalizeHeadlessExitCode({ status, errorCode })
    const completed = completeAgentJob(options.db, {
      jobId: job.id,
      status,
      exitCode,
      errorCode,
      errorMessage: canceled
        ? "Job was canceled."
        : (result.errorMessage ?? null),
      result: resultWithResolvedProvider(
        result.result,
        providerResolution.resolvedProvider,
      ),
      secretHints: runSecretHints(),
    })
    return {
      job: completed,
      events: listAgentJobEvents(options.db, job.id),
      exitCode,
    }
  } catch (error) {
    observerController.flush()
    const message = error instanceof Error ? error.message : String(error)
    const forcedFailure =
      error instanceof InvalidAgentRuntimeRunResultError ||
      isRuntimeSecurityCleanupFailure(error)
    const status =
      abortController.signal.aborted && !forcedFailure ? "canceled" : "failed"
    const errorCode =
      error instanceof InvalidAgentRuntimeRunResultError
        ? "runtime_result_invalid"
        : isRuntimeSecurityCleanupFailure(error)
          ? AGENT_RUNTIME_SECURITY_CLEANUP_ERROR_CODE
          : abortController.signal.aborted
            ? "job_canceled"
            : error instanceof HeadlessProviderBindingError
              ? error.code
              : "runtime_error"
    const exitCode = normalizeHeadlessExitCode({ status, errorCode })
    const completed = completeAgentJob(options.db, {
      jobId: job.id,
      status,
      exitCode,
      errorCode,
      errorMessage:
        abortController.signal.aborted && !forcedFailure
          ? "Job was canceled."
          : message,
      result: resultWithResolvedProvider(
        null,
        resolvedProviderForError(error, job, providerResolution),
      ),
      secretHints: runSecretHints(),
    })
    return {
      job: completed,
      events: listAgentJobEvents(options.db, job.id),
      exitCode,
    }
  } finally {
    try {
      providerResolution?.cleanup()
    } catch {
      // Terminal job state has already been recorded; cleanup must not mask it.
    }
    dynamicSecretHints.clear()
    options.signal?.removeEventListener("abort", abortFromExternalSignal)
  }
}
