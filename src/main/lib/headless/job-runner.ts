import type {
  AgentJobContractRuntime,
  AgentJobMode,
  AgentJobSource,
  AgentJobStatus,
} from "../../../shared/agent-jobs"
import type { LocalJobApiResolvedProvider } from "../../../shared/local-job-api"
import type { AgentJob, AgentJobEvent } from "../db/schema"
import type {
  AgentRuntimeObserver,
  AgentRuntimeRunRequest,
  AgentRuntimeRunResult,
  AgentTaskRunner,
} from "./agent-runtime-contract"
import { createAgentRuntimeRunRequest } from "./agent-runtime-contract"
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
  if (input.errorCode === "local_only_guard_blocked") {
    return HEADLESS_EXIT_CODES.localOnlyBlocked
  }
  if (input.errorCode === "invalid_cwd") return HEADLESS_EXIT_CODES.invalidCwd
  if (
    input.errorCode === "spawn_failed" ||
    input.errorCode === "heartbeat_failed" ||
    input.errorCode === "internal_error"
  ) {
    return HEADLESS_EXIT_CODES.internalFailure
  }
  return HEADLESS_EXIT_CODES.runtimeFailed
}

function createObserver(
  db: AgentJobDatabase,
  jobId: string,
  workerId: string,
  abortController: AbortController,
): AgentRuntimeObserver {
  return {
    appendEvent(type, payload) {
      const current = getAgentJob(db, jobId)
      if (current?.cancelRequestedAt) abortController.abort()
      return appendAgentJobEvent(db, { jobId, type, payload })
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
  }
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

function waitForAbort(signal: AbortSignal): Promise<AgentRuntimeRunResult> {
  if (signal.aborted) return Promise.resolve(canceledRunResult())
  return new Promise((resolve) => {
    signal.addEventListener(
      "abort",
      () => {
        resolve(canceledRunResult())
      },
      { once: true },
    )
  })
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
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
  const observer = createObserver(options.db, job.id, workerId, abortController)
  const runtimeOptions = localJobApiRuntimeOptions(job)
  let providerResolution: HeadlessProviderBindingResolution | null = null

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
    })
    const result = abortController.signal.aborted
      ? canceledRunResult()
      : await (() => {
          const runnerPromise = runner(
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
          void runnerPromise.catch(() => {})
          return Promise.race([
            runnerPromise,
            waitForAbort(abortController.signal),
          ])
        })()
    const canceled =
      observer.isCancelRequested() || abortController.signal.aborted
    const status = canceled ? "canceled" : (result.status ?? "succeeded")
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
    })
    return {
      job: completed,
      events: listAgentJobEvents(options.db, job.id),
      exitCode,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = abortController.signal.aborted ? "canceled" : "failed"
    const errorCode = abortController.signal.aborted
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
      errorMessage: abortController.signal.aborted
        ? "Job was canceled."
        : message,
      result: resultWithResolvedProvider(
        null,
        resolvedProviderForError(error, job, providerResolution),
      ),
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
    options.signal?.removeEventListener("abort", abortFromExternalSignal)
  }
}
