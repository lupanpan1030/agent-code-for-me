import type {
  AgentJobContractRuntime,
  AgentJobEventType,
  AgentJobMode,
  AgentJobSource,
  AgentJobStatus,
} from "../../../shared/agent-jobs"
import { isTerminalAgentJobStatus } from "../../../shared/agent-jobs"
import type { LocalJobApiResolvedProvider } from "../../../shared/local-job-api"
import type { RunArtifactRunDir } from "../agent-runtime/run-artifacts"
import {
  type CanonicalRunEventLedger,
  type CreateCanonicalRunEventLedgerOptions,
  isReconciledAssistantOutput,
  type LedgerOutcome,
  type LedgerRecord,
  type OutcomeEvidence,
  RunEventLedgerError,
} from "../agent-runtime/run-event-ledger"
import {
  bindRunExecutionProvenance,
  createRunArtifactCandidateSink,
  getOrCreateRunEventLedger,
  type RunArtifactCandidateSink,
  releaseRunEventLedger,
} from "../agent-runtime/run-event-ledger-host"
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
  /** Terminal run-dir preparation registered with the one completed. */
  terminalArtifacts?: CreateCanonicalRunEventLedgerOptions["terminalArtifacts"]
  /**
   * The Run's admitted run directory (API create/retry). Only with it does
   * the host compose a native artifact candidate sink for the runner.
   */
  artifactRunDir?: RunArtifactRunDir | null
  /** Sanitized host diagnostics (never persisted as Run events). */
  onHostDiagnostic?: (message: string) => void
}

export type RunPersistedAgentJobResult = {
  job: AgentJob
  events: AgentJobEvent[]
  exitCode: number
  /**
   * The Run's committed outcome from the ledger's `readOutcome()`: the final
   * status and the sequence of its one `completed` (records after it are
   * diagnostic-only).
   */
  outcome: LedgerOutcome | null
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

type HeadlessObserverController = {
  observer: AgentRuntimeObserver
  /** Resolves after every submitted coarse observation was processed. */
  drain: () => Promise<void>
}

const LEDGER_RESUBMIT_LIMIT = 3

/**
 * Thin coarse ingress (design "Headless Runtime Event Convergence"): each
 * runner observation is submitted once to the Run's host ledger under its
 * own observation key. The ledger owns decoding, the Run-scoped exact-secret
 * redaction, sequence allocation and the committed record.
 */
function createObserver(input: {
  db: AgentJobDatabase
  jobId: string
  workerId: string
  ledger: CanonicalRunEventLedger
  abortController: AbortController
  registerSecretHints: (hints: readonly string[]) => void
  artifactCandidates?: RunArtifactCandidateSink | null
  onHostDiagnostic?: (message: string) => void
}): HeadlessObserverController {
  let observationCounter = 0
  const submissions = new Set<Promise<void>>()

  const submit = (
    observationKey: string,
    type: AgentJobEventType,
    payload: unknown,
  ) => {
    const run = async () => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          await input.ledger.ingestRuntimeObservation({
            observationKey,
            type,
            payload: payload ?? {},
          })
          return
        } catch (error) {
          const code =
            error instanceof RunEventLedgerError ? error.code : "UNKNOWN"
          if (
            code === "LEDGER_APPEND_FAILED" &&
            attempt < LEDGER_RESUBMIT_LIMIT
          ) {
            continue
          }
          input.onHostDiagnostic?.(
            `[headless] ${type} observation was not recorded (${code}).`,
          )
          return
        }
      }
    }
    const promise = run()
    submissions.add(promise)
    void promise.finally(() => submissions.delete(promise))
  }

  const observer: AgentRuntimeObserver = {
    appendEvent(type, payload) {
      const current = getAgentJob(input.db, input.jobId)
      if (current?.cancelRequestedAt) input.abortController.abort()
      observationCounter += 1
      submit(`observer:${input.jobId}:${observationCounter}`, type, payload)
    },
    heartbeat() {
      const job = heartbeatAgentJob(input.db, input.jobId, input.workerId)
      if (job.cancelRequestedAt) input.abortController.abort()
      return job
    },
    isCancelRequested() {
      const job = getAgentJob(input.db, input.jobId)
      const requested = !!job?.cancelRequestedAt
      if (requested) input.abortController.abort()
      return requested
    },
    registerSecretHints(hints) {
      input.registerSecretHints(hints)
    },
    async recordExecutionProvenance(provenance) {
      await bindRunExecutionProvenance(input.ledger, provenance)
    },
    runLedger: input.ledger,
    ...(input.artifactCandidates
      ? { artifactCandidates: input.artifactCandidates }
      : {}),
  }
  return {
    observer,
    async drain() {
      await Promise.allSettled([...submissions])
      await input.artifactCandidates?.drain()
      await input.ledger.whenIdle()
    },
  }
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

async function recordResolvedProvider(input: {
  ledger: CanonicalRunEventLedger
  jobId: string
  resolvedProvider: LocalJobApiResolvedProvider
}): Promise<void> {
  if (input.resolvedProvider.source !== "default-profile") return
  await input.ledger.appendSystemEvent({
    observationKey: `host:provider-binding:${input.jobId}`,
    type: "status",
    payload: {
      providerBinding: {
        resolvedProvider: input.resolvedProvider,
      },
    },
  })
}

function textOf(payload: unknown): string {
  if (!isRecord(payload)) return ""
  for (const key of ["text", "delta"]) {
    const value = payload[key]
    if (typeof value === "string" && value.trim().length > 0) return value
  }
  return ""
}

function isRecordedDenial(record: LedgerRecord): boolean {
  if (
    record.type !== "permission_requested" &&
    record.type !== "guard_decision"
  )
    return false
  const payload = isRecord(record.payload) ? record.payload : {}
  const event = isRecord(payload.event) ? payload.event : {}
  return payload.decision === "deny" || event.decision === "deny"
}

/**
 * OutcomeEvidence of one headless Run from its committed records and the
 * runner's host result (design "Error, Completion and Late-Event Policy").
 * The ledger decides the outcome; a runner's default success needs output
 * evidence and no recorded denial (R1 DIRECT_NEW_STANDARD).
 */
function headlessOutcomeEvidence(input: {
  jobId: string
  records: readonly LedgerRecord[]
  result: AgentRuntimeRunResult | null
  canceled: boolean
  credentialsSafe: boolean
  failed: boolean
}): OutcomeEvidence {
  const observationKey = `runner-result:${input.jobId}`
  const denials = input.records.filter(isRecordedDenial)
  const outputKeys = input.records
    .filter(
      (record) =>
        (record.type === "assistant_delta" &&
          (textOf(record.payload).length > 0 ||
            (isRecord(record.payload) &&
              record.payload.structured !== undefined))) ||
        // A completed-only assistant item (no delta) is output too.
        isReconciledAssistantOutput(record),
    )
    .map((record) => `record:${record.sequence}`)
  const finalMessage = isRecord(input.result?.result)
    ? input.result.result.finalMessage
    : undefined
  if (typeof finalMessage === "string" && finalMessage.trim().length > 0) {
    outputKeys.push("runner-result:finalMessage")
  }
  const status = input.result?.status
  const trigger: OutcomeEvidence["trigger"] = input.canceled
    ? { kind: "cancel", reason: "cancel_requested", observationKey }
    : status === "canceled"
      ? { kind: "cancel", reason: "runtime_canceled", observationKey }
      : status === "interrupted"
        ? {
            kind: "interrupt",
            reason: input.result?.errorCode ?? "runtime_interrupted",
            observationKey,
          }
        : {
            kind: "host_result",
            status:
              !input.failed && status === "succeeded" ? "succeeded" : "failed",
            observationKey,
          }
  return {
    trigger,
    policy: {
      denied: denials.length > 0,
      evidenceKeys:
        denials.length > 0
          ? denials.map((record) => `record:${record.sequence}`)
          : ["policy:no-recorded-denial"],
    },
    output: {
      valid: !input.failed,
      empty: outputKeys.length === 0,
      allowEmpty: false,
      evidenceKeys: outputKeys,
    },
    postRun: {
      credentialsSafe: input.credentialsSafe,
      evidenceKeys: [
        input.credentialsSafe
          ? "postrun:security-cleanup-ok"
          : "postrun:security-cleanup-failed",
      ],
    },
  }
}

function outcomeErrorCode(
  outcome: { status: string; reasons: string[] },
  runnerErrorCode: string | null | undefined,
): string | null {
  if (outcome.status === "succeeded") return null
  if (outcome.status === "canceled") return "job_canceled"
  return runnerErrorCode ?? outcome.reasons[0] ?? "runtime_error"
}

function outcomeErrorMessage(
  outcome: { status: string; reasons: string[] },
  runnerErrorMessage: string | null | undefined,
): string | null {
  if (outcome.status === "succeeded") return null
  if (outcome.status === "canceled") return "Job was canceled."
  return (
    runnerErrorMessage ??
    `Run outcome ${outcome.status}: ${outcome.reasons.join(", ") || "no success evidence"}.`
  )
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
  const job = await startAgentJob(options.db, {
    jobId: initial.id,
    workerId,
    workerPid,
  })
  let providerResolution: HeadlessProviderBindingResolution | null = null
  // The executing host registers the Run's terminal projection once, so a
  // settlement minted by another port (a transport exit ingested by the
  // adapter) still writes the job-row diagnostics, result and final run-dir
  // files. The runner's own settle keeps passing its own evidence.
  const ledger = await getOrCreateRunEventLedger(options.db, job, {
    ...(options.terminalArtifacts
      ? { terminalArtifacts: options.terminalArtifacts }
      : {}),
    terminalJobFields: (outcome) => {
      const errorCode = outcomeErrorCode(outcome, null)
      return {
        exitCode: normalizeHeadlessExitCode({
          status: outcome.status as AgentJobStatus,
          errorCode,
        }),
        errorCode,
        errorMessage: outcomeErrorMessage(outcome, null),
        result: resultWithResolvedProvider(
          {},
          resolvedProviderForError(null, job, providerResolution),
        ),
      }
    },
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
  const observerController = createObserver({
    db: options.db,
    jobId: job.id,
    workerId,
    ledger,
    abortController,
    registerSecretHints: (hints) => {
      ledger.addSecretHints(hints.filter((hint) => Boolean(hint)))
    },
    artifactCandidates: options.artifactRunDir
      ? createRunArtifactCandidateSink({
          ledger,
          runId: job.id,
          runDir: options.artifactRunDir,
          cwd: job.cwd,
          ...(options.onHostDiagnostic
            ? { onHostDiagnostic: options.onHostDiagnostic }
            : {}),
        })
      : null,
    onHostDiagnostic: options.onHostDiagnostic,
  })
  const observer = observerController.observer
  const runtimeOptions = localJobApiRuntimeOptions(job)

  const settleRun = async (input: {
    result: AgentRuntimeRunResult | null
    canceled: boolean
    credentialsSafe: boolean
    failed: boolean
    errorCode: string | null | undefined
    errorMessage: string | null | undefined
    resultValue: Record<string, unknown>
  }): Promise<RunPersistedAgentJobResult> => {
    await observerController.drain()
    const records = (await ledger.read(0)) as LedgerRecord[]
    await ledger.settle(
      headlessOutcomeEvidence({
        jobId: job.id,
        records,
        result: input.result,
        canceled: input.canceled,
        credentialsSafe: input.credentialsSafe,
        failed: input.failed,
      }),
      {
        jobFields: (outcome) => {
          const errorCode = outcomeErrorCode(outcome, input.errorCode)
          return {
            exitCode: normalizeHeadlessExitCode({
              status: outcome.status as AgentJobStatus,
              errorCode,
            }),
            errorCode,
            errorMessage: outcomeErrorMessage(outcome, input.errorMessage),
            result: input.resultValue,
          }
        },
        ...(options.terminalArtifacts
          ? { terminalArtifacts: options.terminalArtifacts }
          : {}),
      },
    )
    const outcome = await ledger.readOutcome()
    const completed = getAgentJob(options.db, job.id) ?? job
    return {
      job: completed,
      events: listAgentJobEvents(options.db, job.id),
      exitCode: normalizeHeadlessExitCode({
        status: completed.status as AgentJobStatus,
        errorCode: completed.errorCode,
      }),
      outcome,
    }
  }

  try {
    providerResolution = await resolveHeadlessProviderBinding({
      db: options.db,
      runtime: job.runtime as AgentJobContractRuntime,
      providerProfileId: job.providerProfileId,
      modelOverride: job.modelOverride,
      dependencies: options.providerBindingDependencies,
    })
    ledger.addSecretHints(providerSecretHints(providerResolution))
    await recordResolvedProvider({
      ledger,
      jobId: job.id,
      resolvedProvider: providerResolution.resolvedProvider,
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
    const securityCleanupFailed = isRuntimeSecurityCleanupFailure(result)
    const canceled =
      !securityCleanupFailed &&
      (observer.isCancelRequested() || abortController.signal.aborted)
    return await settleRun({
      result,
      canceled,
      credentialsSafe: !securityCleanupFailed,
      failed: securityCleanupFailed,
      errorCode: result.errorCode ?? null,
      errorMessage: result.errorMessage ?? null,
      resultValue: resultWithResolvedProvider(
        result.result,
        providerResolution.resolvedProvider,
      ),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const securityCleanupFailed = isRuntimeSecurityCleanupFailure(error)
    const forcedFailure =
      error instanceof InvalidAgentRuntimeRunResultError ||
      securityCleanupFailed
    const canceled = abortController.signal.aborted && !forcedFailure
    const errorCode =
      error instanceof InvalidAgentRuntimeRunResultError
        ? "runtime_result_invalid"
        : securityCleanupFailed
          ? AGENT_RUNTIME_SECURITY_CLEANUP_ERROR_CODE
          : canceled
            ? "job_canceled"
            : error instanceof HeadlessProviderBindingError
              ? error.code
              : "runtime_error"
    return await settleRun({
      result: null,
      canceled,
      credentialsSafe: !securityCleanupFailed,
      failed: true,
      errorCode,
      errorMessage: canceled ? "Job was canceled." : message,
      resultValue: resultWithResolvedProvider(
        null,
        resolvedProviderForError(error, job, providerResolution),
      ),
    })
  } finally {
    try {
      providerResolution?.cleanup()
    } catch {
      // Terminal job state has already been recorded; cleanup must not mask it.
    }
    releaseRunEventLedger(options.db, job.id)
    options.signal?.removeEventListener("abort", abortFromExternalSignal)
  }
}
