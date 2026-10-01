import { createHash } from "node:crypto"
import {
  type AgentJobContractRuntime,
  type AgentJobMode,
  type AgentJobStatus,
  isTerminalAgentJobStatus,
} from "../../../shared/agent-jobs"
import {
  type LocalJobApiExecutionObservation,
  LocalJobApiRequestError,
  type LocalJobApiWaitReason,
  type NormalizedLocalJobApiCreateRequest,
} from "../../../shared/local-job-api"
import { readRunPublicationReadiness } from "../agent-runtime/run-event-ledger-host"
import type { AgentJob } from "../db/schema"
import {
  type ExecutorAvailabilityState,
  observeDaemonExecutor,
  observeRunWorker,
} from "./daemon"
import { normalizeHeadlessExitCode } from "./job-runner"
import {
  type AgentJobDatabase,
  AgentJobIdempotencyReservationExistsError,
  type AgentJobIdempotencyReservationInput,
  cleanupExpiredAgentJobIdempotency,
  createAgentJob,
  findAgentJobIdempotencyReservation,
  getAgentJob,
  isAgentJobStoreRedactionAltering,
  readAgentJobAdmissionState,
  readRunEventLedgerHeader,
} from "./job-store"
import {
  admitLocalJobApiInitialArtifacts,
  closeLocalJobApiArtifactRunDir,
  createLocalJobApiJob,
  type LocalJobApiCreatePrepared,
  localJobApiRetryFingerprint,
  localJobApiSubmissionFingerprint,
  localJobApiTerminalEvents,
  retryLocalJobApiJob,
  settleLocalJobApiAdmissionFailure,
  toLocalJobApiTerminalEnvelope,
} from "./local-job-api"
import { findRegisteredProjectForCwdWithCanonicalPath } from "./schedules"

/**
 * Submission orchestration owner (add-local-job-api-async-submit D1).
 *
 * `submitRun` is the one submission core of API create/submit/retry:
 * validate → (idempotency lookup) → persist the queued Run with its
 * reservation and committed creation fact → winner-only run directory and
 * initial admission → return immediately. It never executes a Run: the
 * canonical pump (daemon.ts `pumpQueuedRuns`) claims and dispatches.
 * `waitForRun` is the same owner's read-only, bounded observation of the
 * committed terminal and its publication. Neither owns the Run state
 * machine (job-store/ledger do).
 */

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

export const IDEMPOTENCY_NORMALIZATION_VERSION = 1

const IDEMPOTENCY_KEY_HASH_DOMAIN = "locus.local-job.idempotency-key.v1"
const IDEMPOTENCY_REQUEST_HASH_DOMAIN = "locus.local-job.idempotency-request.v1"

export type SubmitRunIntent =
  | {
      kind: "api-submit"
      request: NormalizedLocalJobApiCreateRequest
      idempotencyKey: string | null
    }
  | {
      kind: "api-retry"
      source: AgentJob
      idempotencyKey: string | null
    }
  | {
      /** jobs-stdio `job.run` (locus-jobs-stdio.v1): no key, no artifacts. */
      kind: "protocol-run"
      runtime: AgentJobContractRuntime
      mode: AgentJobMode
      cwd: string
      prompt: string
      protocol: string
    }

export type SubmitRunDependencies = {
  appVersion?: string | null
  now?: Date
}

export type SubmitRunResult = {
  /** The admitted (fresh) or retained (replayed) Run's job snapshot. */
  job: AgentJob
  replay: boolean
}

/** Canonical JSON: object keys sorted, array order kept. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value ?? null)
}

function lengthPrefixed(value: string): string {
  return `${Buffer.byteLength(value, "utf8")}:${value}`
}

/**
 * Domain-separated key hash over the normalized consumer and the raw key
 * (length-prefixed). The hash is a namespace identity, not a secret.
 */
export function idempotencyKeyHash(consumerId: string, key: string): string {
  return createHash("sha256")
    .update(`${IDEMPOTENCY_KEY_HASH_DOMAIN}\u0000`)
    .update(lengthPrefixed(consumerId))
    .update(lengthPrefixed(key))
    .digest("hex")
}

function requestHash(fingerprint: Record<string, unknown>): string {
  return createHash("sha256")
    .update(`${IDEMPOTENCY_REQUEST_HASH_DOMAIN}\u0000`)
    .update(
      canonicalJson({
        normalizationVersion: IDEMPOTENCY_NORMALIZATION_VERSION,
        fingerprint,
      }),
    )
    .digest("hex")
}

type ApiSubmitRunIntent = Exclude<SubmitRunIntent, { kind: "protocol-run" }>

function intentConsumerId(intent: ApiSubmitRunIntent): string | null {
  return intent.kind === "api-submit"
    ? intent.request.consumer.id
    : intent.source.apiConsumerId
}

function intentFingerprint(
  intent: ApiSubmitRunIntent,
): Record<string, unknown> {
  return intent.kind === "api-submit"
    ? localJobApiSubmissionFingerprint(intent.request)
    : localJobApiRetryFingerprint(intent.source)
}

function submissionPending(): LocalJobApiRequestError {
  return new LocalJobApiRequestError(
    "submission_pending",
    "Submission is not yet admitted; retry the same key.",
    { retryable: true },
  )
}

function idempotencyConflict(): LocalJobApiRequestError {
  return new LocalJobApiRequestError(
    "idempotency_conflict",
    "The idempotency key is already bound to a different request.",
  )
}

/**
 * A committed reservation decides the outcome without new provider work or
 * directories: a different request conflicts; a Run whose creation fact or
 * required initial admission did not commit (and is not terminal) is
 * pending; otherwise the retained Run replays in its current state.
 */
function resolveReservation(
  db: AgentJobDatabase,
  reservation: { jobId: string; requestHash: string },
  expectedRequestHash: string,
): SubmitRunResult {
  if (reservation.requestHash !== expectedRequestHash) {
    throw idempotencyConflict()
  }
  const job = getAgentJob(db, reservation.jobId)
  if (!job) throw submissionPending()
  if (
    !isTerminalAgentJobStatus(job.status as AgentJobStatus) &&
    readAgentJobAdmissionState(db, job) !== "admitted"
  ) {
    throw submissionPending()
  }
  return { job, replay: true }
}

async function createAdmission(
  db: AgentJobDatabase,
  intent: ApiSubmitRunIntent,
  reservation: AgentJobIdempotencyReservationInput | null,
  dependencies: SubmitRunDependencies,
): Promise<LocalJobApiCreatePrepared> {
  return intent.kind === "api-submit"
    ? createLocalJobApiJob(db, intent.request, dependencies.appVersion, {
        reservation,
      })
    : retryLocalJobApiJob(db, intent.source, { reservation })
}

/**
 * The single submission core. Fresh submissions ack only after the committed
 * creation fact and the required initial artifact admission; every resource
 * handle is closed before returning.
 */
export async function submitRun(
  db: AgentJobDatabase,
  intent: SubmitRunIntent,
  dependencies: SubmitRunDependencies = {},
): Promise<SubmitRunResult> {
  if (intent.kind === "protocol-run") return submitProtocolRun(db, intent)
  // A retry keeps the 2c59664f gate order: stored request, provider,
  // capability and project gates first, then the source status check inside
  // job-store retryAgentJob (before any row or reservation is inserted).
  const consumerId = intentConsumerId(intent)
  const key = intent.idempotencyKey
  if (
    key !== null &&
    (!consumerId || isAgentJobStoreRedactionAltering(consumerId))
  ) {
    // The namespace, the stored apiConsumerId and the retry match use one
    // validated ID; an ID the store would rewrite is refused, not redacted.
    throw new LocalJobApiRequestError(
      "secret_in_request",
      "consumer.id contains secret-like text",
    )
  }
  if (consumerId) {
    cleanupExpiredAgentJobIdempotency(db, {
      now: dependencies.now ?? new Date(),
      consumerId,
    })
  }

  let reservation: AgentJobIdempotencyReservationInput | null = null
  if (key !== null && consumerId) {
    reservation = {
      consumerId,
      keyHash: idempotencyKeyHash(consumerId, key),
      requestHash: requestHash(intentFingerprint(intent)),
      normalizationVersion: IDEMPOTENCY_NORMALIZATION_VERSION,
    }
    const existing = findAgentJobIdempotencyReservation(db, reservation)
    if (existing) {
      return resolveReservation(db, existing, reservation.requestHash)
    }
  }

  let prepared: LocalJobApiCreatePrepared
  try {
    prepared = await createAdmission(db, intent, reservation, dependencies)
  } catch (error) {
    if (
      reservation &&
      error instanceof AgentJobIdempotencyReservationExistsError
    ) {
      // A concurrent submission won the unique constraint: read its
      // committed reservation instead of query-then-insert.
      const winner = findAgentJobIdempotencyReservation(db, reservation)
      if (!winner) throw submissionPending()
      return resolveReservation(db, winner, reservation.requestHash)
    }
    throw error
  }

  try {
    await admitLocalJobApiInitialArtifacts({ db, prepared })
  } catch (error) {
    // The creation fact committed: the attempt and its reservation stay and
    // the host settles it failed (no committed fact is deleted).
    await settleLocalJobApiAdmissionFailure(db, prepared.job.id, error)
    throw error
  } finally {
    closeLocalJobApiArtifactRunDir(prepared.runDir)
  }
  // Design D2: the fresh ack is the fixed queued snapshot of the completed
  // admission: the row the creation transaction committed (the creation
  // fact and the initial admission commit events only and change no job
  // column). It is never re-read here: another process may claim the Run
  // before this ack reaches stdout. Only a replay (resolveReservation)
  // reads the retained Run's current state.
  return { job: prepared.job, replay: false }
}

/**
 * Protocol admission (jobs-stdio `job.run`): the registered-project gate,
 * then the queued Run and its committed creation fact. The session's scoped
 * canonical pump executes it.
 */
async function submitProtocolRun(
  db: AgentJobDatabase,
  intent: Extract<SubmitRunIntent, { kind: "protocol-run" }>,
): Promise<SubmitRunResult> {
  const { project, cwd } = findRegisteredProjectForCwdWithCanonicalPath(
    db,
    intent.cwd,
    null,
    "Protocol job cwd",
  )
  const job = await createAgentJob(db, {
    source: "protocol",
    runtime: intent.runtime,
    mode: intent.mode,
    cwd,
    prompt: intent.prompt,
    input: {
      prompt: intent.prompt,
      protocol: intent.protocol,
    },
    projectId: project.id,
  })
  return { job, replay: false }
}

// ---------------------------------------------------------------------------
// Bounded wait
// ---------------------------------------------------------------------------

/** Injected monotonic clock (frozen test seam `monotonicClock`). */
export type MonotonicClock = {
  now(): number
  sleep(ms: number): Promise<void>
}

export const DEFAULT_MONOTONIC_CLOCK: MonotonicClock = {
  now: () => performance.now(),
  sleep: (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))),
}

/** Maximum interval between two observations of one waiter. */
export const WAIT_POLL_INTERVAL_MS = 100
/** Wrapper observer window without progress of a non-own claimant. */
export const WRAPPER_NO_PROGRESS_WINDOW_MS = 30_000
/** Wrapper bound on a committed terminal whose files are not published. */
export const WRAPPER_PUBLICATION_BOUND_MS = 30_000

type TerminalEnvelope = ReturnType<typeof toLocalJobApiTerminalEnvelope>

type RunObservation = {
  job: AgentJob
  ready: boolean
  envelope: TerminalEnvelope | null
  exitCode: number | null
  reason: LocalJobApiWaitReason | null
  executor: ExecutorAvailabilityState | null
  highWater: number
}

function executorWaitReason(
  state: ExecutorAvailabilityState,
): LocalJobApiWaitReason {
  if (state === "available") return "run_pending"
  if (state === "unavailable") return "executor_unavailable"
  return "executor_unknown"
}

/**
 * One read-only observation of an API Run (design D5 decision table): a
 * terminal is ready only when its registered terminal refs are verified
 * published; otherwise the reason follows admission, executor and status.
 */
export function observeRun(
  db: AgentJobDatabase,
  jobId: string,
  options: { lockPath?: string | null } = {},
): RunObservation | null {
  const job = getAgentJob(db, jobId)
  if (!job) return null
  const highWater = readRunEventLedgerHeader(db, jobId)?.highWater ?? 0
  if (isTerminalAgentJobStatus(job.status as AgentJobStatus)) {
    const readiness = readRunPublicationReadiness(db, jobId)
    const terminal = readiness.job ?? job
    if (!readiness.ready) {
      return {
        job: terminal,
        ready: false,
        envelope: null,
        exitCode: null,
        reason: "terminal_artifacts_pending",
        executor: null,
        highWater,
      }
    }
    return {
      job: terminal,
      ready: true,
      envelope: toLocalJobApiTerminalEnvelope(
        terminal,
        readiness.preparedTail,
        localJobApiTerminalEvents(db, terminal),
      ),
      exitCode: normalizeHeadlessExitCode({
        status: terminal.status as AgentJobStatus,
        errorCode: terminal.errorCode,
      }),
      reason: null,
      executor: null,
      highWater,
    }
  }
  if (job.status === "queued") {
    if (readAgentJobAdmissionState(db, job) !== "admitted") {
      return {
        job,
        ready: false,
        envelope: null,
        exitCode: null,
        reason: "admission_incomplete",
        executor: null,
        highWater,
      }
    }
    const executor = observeDaemonExecutor(options.lockPath).state
    return {
      job,
      ready: false,
      envelope: null,
      exitCode: null,
      reason: executorWaitReason(executor),
      executor,
      highWater,
    }
  }
  return {
    job,
    ready: false,
    envelope: null,
    exitCode: null,
    reason: "run_pending",
    executor: observeRunWorker(job).state,
    highWater,
  }
}

export type WaitForRunResult =
  | {
      kind: "ready"
      job: AgentJob
      envelope: TerminalEnvelope
      exitCode: number
    }
  | {
      kind: "timeout"
      job: AgentJob
      timeoutMs: number
      reason: LocalJobApiWaitReason
    }
  | { kind: "error"; job: AgentJob; reason: LocalJobApiWaitReason }
  | { kind: "not_found" }
  | { kind: "observation_failed_before_snapshot" }

export type WaitForRunOptions = {
  timeoutMs: number
  clock?: MonotonicClock
  lockPath?: string | null
}

/**
 * `runs wait`: read → sleep (≤100 ms) → re-read until ready or the
 * monotonic deadline; a ready final read at the deadline wins. Observation
 * never settles, cancels or changes a Run or its retention.
 */
export async function waitForRun(
  db: AgentJobDatabase,
  jobId: string,
  options: WaitForRunOptions,
): Promise<WaitForRunResult> {
  const clock = options.clock ?? DEFAULT_MONOTONIC_CLOCK
  const deadline = clock.now() + options.timeoutMs
  let observation: RunObservation | null
  try {
    observation = observeRun(db, jobId, options)
  } catch {
    return { kind: "observation_failed_before_snapshot" }
  }
  if (!observation) return { kind: "not_found" }
  while (true) {
    if (observation.ready && observation.envelope) {
      return {
        kind: "ready",
        job: observation.job,
        envelope: observation.envelope,
        exitCode: observation.exitCode ?? 0,
      }
    }
    const remaining = deadline - clock.now()
    if (remaining <= 0) {
      return {
        kind: "timeout",
        job: observation.job,
        timeoutMs: options.timeoutMs,
        reason: observation.reason ?? "run_pending",
      }
    }
    await clock.sleep(Math.min(WAIT_POLL_INTERVAL_MS, remaining))
    const snapshot: AgentJob = observation.job
    try {
      const next = observeRun(db, jobId, options)
      if (!next)
        return { kind: "error", job: snapshot, reason: "observation_failed" }
      observation = next
    } catch {
      return { kind: "error", job: snapshot, reason: "observation_failed" }
    }
  }
}

// ---------------------------------------------------------------------------
// Synchronous wrapper wait (Q2(a)): create/default retry = submit + own
// scoped pump + wait. The own pump's pending dispatch is liveness evidence;
// a Run another process claimed is observed through its committed worker
// evidence; bounded observer errors never declare a Run outcome.
// ---------------------------------------------------------------------------

/** The wrapper's own scoped pump dispatch of its admitted Run. */
export type OwnDispatch = {
  promise: Promise<unknown>
  /** pending → claimed (own pump executed it) | lost (another claimant) | failed. */
  state: () => "pending" | "claimed" | "lost" | "failed"
  /** Stops the own execution tree; resolves once the own pump settled. */
  stop: () => Promise<void>
}

export type WrapperWaitResult =
  | {
      kind: "ready"
      job: AgentJob
      envelope: TerminalEnvelope
      exitCode: number
    }
  | {
      /** Own pump completed but its terminal files were not published. */
      kind: "unpublished"
      job: AgentJob
      envelope: TerminalEnvelope
      exitCode: number
    }
  | { kind: "error"; job: AgentJob; reason: LocalJobApiWaitReason }
  | { kind: "aborted" }
  /** The own pump hit a non-outcome failure before a terminal was ready. */
  | { kind: "own_dispatch_failed" }
  /**
   * A non-outcome store read failed while the Run was the wrapper's own
   * (pump pending or completed): the own execution tree was stopped; the
   * caller keeps the baseline stderr text and exit of `error`.
   */
  | { kind: "own_observation_failed"; error: unknown }

export type WrapperWaitOptions = {
  clock?: MonotonicClock
  lockPath?: string | null
  ownDispatch: OwnDispatch | null
  /** Resolves when the wrapper must stop waiting (relayed abort). */
  abort?: Promise<void>
}

function unpublishedEnvelope(
  db: AgentJobDatabase,
  job: AgentJob,
): { envelope: TerminalEnvelope; exitCode: number } {
  return {
    envelope: toLocalJobApiTerminalEnvelope(
      job,
      [],
      localJobApiTerminalEvents(db, job),
    ),
    exitCode: normalizeHeadlessExitCode({
      status: job.status as AgentJobStatus,
      errorCode: job.errorCode,
    }),
  }
}

export async function waitForAdmittedRun(
  db: AgentJobDatabase,
  jobId: string,
  options: WrapperWaitOptions,
): Promise<WrapperWaitResult> {
  const clock = options.clock ?? DEFAULT_MONOTONIC_CLOCK
  let aborted = false
  void options.abort?.then(() => {
    aborted = true
  })
  let lastProgressAt = clock.now()
  let terminalSince: number | null = null
  let lastHighWater: number | null = null
  let lastHeartbeat: number | null = null
  let snapshot: AgentJob | null = null
  while (true) {
    if (aborted) return { kind: "aborted" }
    const ownState = options.ownDispatch?.state() ?? "lost"
    const ownPending = ownState === "pending"
    let observation: RunObservation | null
    try {
      observation = observeRun(db, jobId, options)
    } catch (error) {
      if (ownState === "failed") return { kind: "own_dispatch_failed" }
      if (options.ownDispatch && (ownPending || ownState === "claimed")) {
        // An owned child: stop that execution tree and keep the baseline
        // error (spec: non-outcome read failure with an owned child); only
        // a remote claimant gets the identified observation_failed/8.
        await options.ownDispatch.stop()
        return { kind: "own_observation_failed", error }
      }
      observation = null
    }
    if (!observation) {
      if (snapshot) {
        return { kind: "error", job: snapshot, reason: "observation_failed" }
      }
      throw new Error(`Failed to observe job: ${jobId}`)
    }
    snapshot = observation.job
    if (observation.ready && observation.envelope) {
      return {
        kind: "ready",
        job: observation.job,
        envelope: observation.envelope,
        exitCode: observation.exitCode ?? 0,
      }
    }
    if (ownState === "failed") return { kind: "own_dispatch_failed" }
    const now = clock.now()
    const terminal = isTerminalAgentJobStatus(
      observation.job.status as AgentJobStatus,
    )
    if (terminal) {
      if (ownState === "claimed") {
        // Q2(a) failure parity: the own pump committed the outcome but its
        // terminal files were not published (2c59664f `artifacts: []`).
        const parity = unpublishedEnvelope(db, observation.job)
        return { kind: "unpublished", job: observation.job, ...parity }
      }
      terminalSince ??= now
      if (!ownPending && now - terminalSince >= WRAPPER_PUBLICATION_BOUND_MS) {
        return {
          kind: "error",
          job: observation.job,
          reason: "terminal_artifacts_pending",
        }
      }
    } else if (!ownPending) {
      const heartbeat = observation.job.heartbeatAt
        ? new Date(observation.job.heartbeatAt).getTime()
        : null
      if (
        lastHighWater === null ||
        observation.highWater !== lastHighWater ||
        heartbeat !== lastHeartbeat ||
        (observation.job.status === "running" &&
          observation.executor === "available")
      ) {
        lastProgressAt = now
      }
      lastHighWater = observation.highWater
      lastHeartbeat = heartbeat
      if (now - lastProgressAt >= WRAPPER_NO_PROGRESS_WINDOW_MS) {
        return {
          kind: "error",
          job: observation.job,
          reason:
            observation.executor === "unavailable"
              ? "executor_unavailable"
              : "executor_unknown",
        }
      }
    } else {
      lastProgressAt = now
    }
    if (aborted) return { kind: "aborted" }
    const pauses: Promise<unknown>[] = [clock.sleep(WAIT_POLL_INTERVAL_MS)]
    if (ownPending && options.ownDispatch) {
      pauses.push(options.ownDispatch.promise.catch(() => undefined))
    }
    if (options.abort) pauses.push(options.abort)
    await Promise.race(pauses)
  }
}

/**
 * Advisory executor observation of `runs status` (design D5): present only
 * for queued/running API jobs. A queued job without its committed admission
 * is unknown/admission_incomplete; a queued admitted job follows the daemon
 * lock; a running job follows its own committed worker evidence.
 */
export function observeRunExecution(
  db: AgentJobDatabase,
  job: AgentJob,
  options: { lockPath?: string | null } = {},
): LocalJobApiExecutionObservation | null {
  const observedAt = new Date().toISOString()
  if (job.status === "queued") {
    if (readAgentJobAdmissionState(db, job) !== "admitted") {
      return { state: "unknown", reason: "admission_incomplete", observedAt }
    }
    return executionObservation(
      observeDaemonExecutor(options.lockPath),
      observedAt,
    )
  }
  if (job.status === "running") {
    return executionObservation(observeRunWorker(job), observedAt)
  }
  return null
}

function executionObservation(
  availability: ReturnType<typeof observeDaemonExecutor>,
  observedAt: string,
): LocalJobApiExecutionObservation {
  return {
    state: availability.state,
    reason: availability.reason,
    observedAt,
    ...(availability.state === "unavailable"
      ? { hint: "locus daemon run" as const }
      : {}),
  }
}
