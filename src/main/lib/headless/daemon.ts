import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname } from "node:path"
import { recordVerifiedRunRetention } from "../agent-runtime/run-event-ledger-host"
import type { RuntimeRouteCatalogState } from "../agent-runtime/runtime-route-catalog"
import type { AgentJob } from "../db/schema"
import { createId } from "../db/utils"
import type { AgentTaskRunner } from "./agent-runtime-contract"
import {
  type RunPersistedCompletionJobOptions,
  runPersistedCompletionJob,
} from "./completion-runner"
import { recoverStaleAgentJobs } from "./job-recovery"
import { runPersistedAgentJob } from "./job-runner"
import {
  type AgentJobDatabase,
  cleanupExpiredAgentJobIdempotency,
  getAgentJob,
  isAgentJobClaimLostError,
  listQueuedAgentJobsForIds,
  listQueuedAgentJobsForSource,
} from "./job-store"
import {
  openClaimedLocalJobApiExecution,
  settleOverAgeQueuedLocalJobApiRuns,
} from "./local-job-api"
import type { HeadlessProviderBindingDependencies } from "./provider-binding"
import { evaluateDueAgentSchedules } from "./schedules"

type Writer = {
  write(chunk: string): unknown
}

export type RunLocalAgentDaemonOptions = {
  db: AgentJobDatabase
  env?: NodeJS.ProcessEnv
  runner?: AgentTaskRunner | null
  stderr?: Writer
  concurrency?: number
  pollIntervalMs?: number
  once?: boolean
  lockPath?: string | null
  signal?: AbortSignal
  now?: Date
  /** Upstream fetch of claimed API completion Runs (test-injectable). */
  completionFetch?: RunPersistedCompletionJobOptions["fetchImpl"]
  providerBindingDependencies?: HeadlessProviderBindingDependencies
  /** Locus build executing claimed completion Runs. */
  appVersion?: string | null
  /**
   * Internal claim-time bound of a queued API Run's age (test-injectable;
   * not a user setting). Defaults to MAX_QUEUED_API_AGE_MS.
   */
  maxQueuedApiAgeMs?: number
  /** Test-only runtime route catalog state, forwarded to every pump pass. */
  runtimeRouteCatalog?: RuntimeRouteCatalogState
}

/** Default maximum queued age of an API Run at claim (24 h; equal rejects). */
export const MAX_QUEUED_API_AGE_MS = 86_400_000

export type RunLocalAgentDaemonResult = {
  scheduledJobs: number
  startedJobs: number
  completedJobs: number
  failedJobs: number
  interruptedJobs: number
  stoppedBy: "once" | "signal"
}

function writeLine(writer: Writer | undefined, line: string): void {
  writer?.write(`${line}\n`)
}

// ---------------------------------------------------------------------------
// Daemon lock (lock v2) and executor observation
// (add-local-job-api-async-submit D5)
// ---------------------------------------------------------------------------

/** Lock format of an API-capable daemon. */
export const DAEMON_LOCK_FORMAT = 2
/** A lock heartbeat is fresh while 0 <= age <= 5000 ms. */
export const DAEMON_LOCK_FRESH_MS = 5_000
/** The writer refreshes its heartbeat at most this far apart. */
export const DAEMON_LOCK_HEARTBEAT_INTERVAL_MS = 500
/** Existing recovery stale window of a claimed Run's worker heartbeat. */
export const RUN_WORKER_HEARTBEAT_WINDOW_MS = 120_000

type DaemonLockBody = {
  pid: number
  nonce: string
  startedAt: string
  lockFormat: typeof DAEMON_LOCK_FORMAT
  apiCapable: true
  heartbeatAt: string
}

type DaemonLock = {
  /** Atomically rewrites heartbeatAt while the file still carries our nonce. */
  heartbeat(): void
  release(): void
}

type ProcessProbe = "alive" | "absent" | "denied" | "unknown"

function probeProcess(pid: unknown): ProcessProbe {
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) {
    return "unknown"
  }
  try {
    process.kill(pid, 0)
    return "alive"
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : null
    if (code === "ESRCH") return "absent"
    if (code === "EPERM") return "denied"
    return "unknown"
  }
}

function isPidAlive(pid: number): boolean {
  const probe = probeProcess(pid)
  return probe !== "absent" && probe !== "unknown"
}

function readLockPid(lockPath: string): number | null {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf-8")) as {
      pid?: unknown
    }
    return typeof parsed.pid === "number" ? parsed.pid : null
  } catch {
    return null
  }
}

function readLockNonce(lockPath: string): unknown {
  try {
    return (JSON.parse(readFileSync(lockPath, "utf-8")) as { nonce?: unknown })
      .nonce
  } catch {
    return undefined
  }
}

export function acquireDaemonLock(lockPath: string): DaemonLock {
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 })
  const nonce = `${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2)}`

  if (existsSync(lockPath)) {
    const stat = lstatSync(lockPath)
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing daemon lock symlink: ${lockPath}`)
    }
    const ownerPid = readLockPid(lockPath)
    if (ownerPid && isPidAlive(ownerPid)) {
      throw new Error(`Locus daemon is already running with pid ${ownerPid}`)
    }
    unlinkSync(lockPath)
  }

  const startedAt = new Date().toISOString()
  const body = (): DaemonLockBody => ({
    pid: process.pid,
    nonce,
    startedAt,
    lockFormat: DAEMON_LOCK_FORMAT,
    apiCapable: true,
    heartbeatAt: new Date().toISOString(),
  })
  const fd = openSync(lockPath, "wx", 0o600)
  try {
    writeFileSync(fd, JSON.stringify(body()))
  } finally {
    closeSync(fd)
  }

  // Once the file carries another nonce (a successor), this writer never
  // refreshes or unlinks it again.
  let swapped = false
  return {
    heartbeat() {
      if (swapped) return
      if (readLockNonce(lockPath) !== nonce) {
        swapped = true
        return
      }
      const temp = `${lockPath}.${process.pid}.tmp`
      try {
        writeFileSync(temp, JSON.stringify(body()), { mode: 0o600 })
        if (readLockNonce(lockPath) !== nonce) {
          swapped = true
          unlinkSync(temp)
          return
        }
        renameSync(temp, lockPath)
      } catch {
        try {
          unlinkSync(temp)
        } catch {}
      }
    },
    release() {
      if (swapped) return
      try {
        if (readLockNonce(lockPath) === nonce) unlinkSync(lockPath)
      } catch {}
    },
  }
}

export type ExecutorAvailabilityState = "available" | "unavailable" | "unknown"

export type ExecutorAvailability = {
  state: ExecutorAvailabilityState
  reason: "executor_observed" | "no_executor" | "probe_unavailable"
}

const EXECUTOR_AVAILABLE: ExecutorAvailability = {
  state: "available",
  reason: "executor_observed",
}
const EXECUTOR_UNAVAILABLE: ExecutorAvailability = {
  state: "unavailable",
  reason: "no_executor",
}
const EXECUTOR_UNKNOWN: ExecutorAvailability = {
  state: "unknown",
  reason: "probe_unavailable",
}

type LockRead =
  | { kind: "absent" }
  | { kind: "unreadable" }
  | { kind: "read"; body: Record<string, unknown> }

function readLockForObservation(lockPath: string): LockRead {
  let text: string
  try {
    text = readFileSync(lockPath, "utf-8")
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "ENOENT"
      ? { kind: "absent" }
      : { kind: "unreadable" }
  }
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { kind: "read", body: parsed as Record<string, unknown> }
      : { kind: "unreadable" }
  } catch {
    return { kind: "unreadable" }
  }
}

/**
 * Read-only same-profile executor observation from the daemon lock: no lock
 * or ESRCH is unavailable; an alive, v2, API-capable lock with a fresh
 * heartbeat and a stable nonce across two reads is available; everything
 * else (stale/legacy/EPERM/no lockPath/bad format/future heartbeat/swapped
 * nonce) is unknown. It never writes, acquires or launches anything.
 */
export function observeDaemonExecutor(
  lockPath: string | null | undefined,
  nowMs = Date.now(),
): ExecutorAvailability {
  if (!lockPath) return EXECUTOR_UNKNOWN
  const first = readLockForObservation(lockPath)
  if (first.kind === "absent") return EXECUTOR_UNAVAILABLE
  if (first.kind === "unreadable") return EXECUTOR_UNKNOWN
  const probe = probeProcess(first.body.pid)
  if (probe === "absent") return EXECUTOR_UNAVAILABLE
  if (probe !== "alive") return EXECUTOR_UNKNOWN
  if (
    first.body.lockFormat !== DAEMON_LOCK_FORMAT ||
    first.body.apiCapable !== true ||
    typeof first.body.heartbeatAt !== "string"
  ) {
    return EXECUTOR_UNKNOWN
  }
  const heartbeat = Date.parse(first.body.heartbeatAt)
  const age = nowMs - heartbeat
  if (Number.isNaN(heartbeat) || age < 0 || age > DAEMON_LOCK_FRESH_MS) {
    return EXECUTOR_UNKNOWN
  }
  const second = readLockForObservation(lockPath)
  if (second.kind !== "read" || second.body.nonce !== first.body.nonce) {
    return EXECUTOR_UNKNOWN
  }
  return EXECUTOR_AVAILABLE
}

/**
 * Worker evidence of a claimed Run (no daemon lock required): its committed
 * worker identity with a heartbeat inside the existing 120 s recovery window
 * and a confirmed-alive PID is available; ESRCH is unavailable; a stale
 * heartbeat, EPERM or an uncertain identity is unknown.
 */
export function observeRunWorker(
  job: Pick<AgentJob, "workerId" | "workerPid" | "heartbeatAt">,
  nowMs = Date.now(),
): ExecutorAvailability {
  if (!job.workerId || job.workerPid === null) return EXECUTOR_UNKNOWN
  const probe = probeProcess(job.workerPid)
  if (probe === "absent") return EXECUTOR_UNAVAILABLE
  if (probe !== "alive") return EXECUTOR_UNKNOWN
  const heartbeat = job.heartbeatAt
    ? new Date(job.heartbeatAt).getTime()
    : Number.NaN
  if (
    Number.isNaN(heartbeat) ||
    nowMs - heartbeat > RUN_WORKER_HEARTBEAT_WINDOW_MS
  ) {
    return EXECUTOR_UNKNOWN
  }
  return EXECUTOR_AVAILABLE
}

// ---------------------------------------------------------------------------
// Canonical pump (add-local-job-api-async-submit D1/D5): the one dispatch
// implementation of queued Runs. The daemon pumps daemon → schedule → api;
// scoped callers (the create/retry wrapper, a protocol session) pass their
// own admitted IDs. Claims go through job-store startAgentJob inside the
// existing runners; no worker, queue table or state machine is added.
// ---------------------------------------------------------------------------

/**
 * Sources the ordinary daemon claims, in slot order. Only an API-capable
 * daemon (one holding a lock v2) claims `api`; desktop, default cli and
 * protocol Runs are never claimed by a plain daemon.
 */
const DAEMON_PUMP_SOURCES = ["daemon", "schedule"] as const
const API_CAPABLE_DAEMON_PUMP_SOURCES = ["daemon", "schedule", "api"] as const

export type PumpQueuedRunsOptions = {
  db: AgentJobDatabase
  env?: NodeJS.ProcessEnv
  runner?: AgentTaskRunner | null
  stderr?: Writer
  completionFetch?: RunPersistedCompletionJobOptions["fetchImpl"]
  providerBindingDependencies?: HeadlessProviderBindingDependencies
  appVersion?: string | null
  /** Maximum Runs this pass dispatches (default 1). */
  concurrency?: number
  /** Scope of a scoped caller: only these admitted Run IDs are claimed. */
  admittedIds?: readonly string[]
  /** Runs this pass must not dispatch again (e.g. failed reopen). */
  excludeIds?: ReadonlySet<string>
  /** `daemon` names claims `daemon:<pid>:…`; scoped pumps keep runner IDs. */
  workerKind?: "daemon"
  /** Unscoped passes claim `api` only when the pump is API-capable. */
  apiCapable?: boolean
  /** Clock of the claim-time age check (default: the current time). */
  now?: Date
  /** Claim-time bound of a queued API Run's age (default 24 h). */
  maxQueuedApiAgeMs?: number
  signal?: AbortSignal
  /** Called synchronously for every dispatched Run (daemon slot tracking). */
  onDispatch?: (job: AgentJob, dispatch: Promise<PumpQueuedRunResult>) => void
  /**
   * Claim observer of a scoped caller (the create/default-retry wrapper's R4
   * relay): `attempting` receives the worker identity minted for the
   * conditional claim before it is attempted; `claimed` runs synchronously
   * right after a successful claim, before the claim-time gate, any provider
   * call or spawn.
   */
  claimObserver?: {
    attempting(job: AgentJob, workerId: string): void
    claimed(job: AgentJob): void
  }
  /**
   * Test-only runtime route catalog state, forwarded unchanged to the agent
   * runner (never resolved here: the catalog is consulted only inside the
   * agent runner after its claim and provider binding).
   */
  runtimeRouteCatalog?: RuntimeRouteCatalogState
}

export type PumpQueuedRunResult = {
  jobId: string
  /** False when another claimant or a settlement won the claim. */
  claimed: boolean
  exitCode: number | null
  /** A non-outcome failure (the Run outcome itself is committed state). */
  error: unknown
}

export type PumpQueuedRunsResult = {
  runs: PumpQueuedRunResult[]
}

function listPumpWork(options: PumpQueuedRunsOptions): AgentJob[] {
  const limit = Math.max(1, Math.min(options.concurrency ?? 1, 16))
  const excluded = options.excludeIds
  const keep = (job: AgentJob) => !excluded?.has(job.id)
  const extra = excluded?.size ?? 0
  if (options.admittedIds) {
    return listQueuedAgentJobsForIds(
      options.db,
      options.admittedIds,
      limit + extra,
    )
      .filter(keep)
      .slice(0, limit)
  }
  const jobs: AgentJob[] = []
  const sources =
    options.apiCapable === false
      ? DAEMON_PUMP_SOURCES
      : API_CAPABLE_DAEMON_PUMP_SOURCES
  for (const source of sources) {
    const remaining = limit - jobs.length
    if (remaining <= 0) break
    jobs.push(
      ...listQueuedAgentJobsForSource(options.db, source, remaining + extra)
        .filter(keep)
        .slice(0, remaining),
    )
  }
  return jobs
}

async function dispatchQueuedRun(
  job: AgentJob,
  options: PumpQueuedRunsOptions,
): Promise<PumpQueuedRunResult> {
  // Every claim names a unique worker identity (its `job_started` fact key):
  // two pumps of one process must never share a claim observation.
  const prefix =
    options.workerKind === "daemon"
      ? "daemon"
      : job.kind === "completion"
        ? "completion"
        : job.source === "protocol"
          ? "protocol"
          : "headless"
  const worker = {
    workerId: `${prefix}:${process.pid}:${Date.now()}:${createId()}:${job.id}`,
    workerPid: process.pid,
  }
  options.claimObserver?.attempting(job, worker.workerId)
  // Claim-time host gate (design D5): runs inside the runner after the
  // conditional claim and before any provider call or spawn, so only the
  // claimant reopens the admitted run directory.
  const claimGate = (claimed: AgentJob) => {
    options.claimObserver?.claimed(claimed)
    return openClaimedLocalJobApiExecution(options.db, claimed, {
      now: options.now,
      maxQueuedApiAgeMs: options.maxQueuedApiAgeMs ?? MAX_QUEUED_API_AGE_MS,
      providerBindingDependencies: options.providerBindingDependencies,
      onHostDiagnostic: (message) => writeLine(options.stderr, message),
    })
  }
  try {
    const result =
      job.kind === "completion"
        ? await runPersistedCompletionJob({
            db: options.db,
            jobId: job.id,
            fetchImpl: options.completionFetch,
            providerBindingDependencies: options.providerBindingDependencies,
            locusBuild: options.appVersion ?? null,
            signal: options.signal,
            claimGate,
            ...worker,
          })
        : await runPersistedAgentJob({
            db: options.db,
            jobId: job.id,
            runner: options.runner,
            env: options.env,
            providerBindingDependencies: options.providerBindingDependencies,
            signal: options.signal,
            claimGate,
            runtimeRouteCatalog: options.runtimeRouteCatalog,
            ...worker,
          })
    // Lifecycle host: retention starts once the terminal refs are verified
    // published (a failed publication keeps a NULL expiry).
    recordVerifiedRunRetention(options.db, job.id)
    return {
      jobId: job.id,
      claimed: true,
      exitCode: result.exitCode,
      error: null,
    }
  } catch (error) {
    if (isAgentJobClaimLostError(error)) {
      return { jobId: job.id, claimed: false, exitCode: null, error: null }
    }
    return { jobId: job.id, claimed: true, exitCode: null, error }
  }
}

/**
 * One pump pass: lists claimable queued Runs (the D3 predicate) within the
 * caller's scope and slots, dispatches each to its existing runner and
 * resolves when they settle.
 */
export function pumpQueuedRuns(
  options: PumpQueuedRunsOptions,
): Promise<PumpQueuedRunsResult> {
  return runPumpPass(options)
}

/** The pass shared by the exported pump and this file's daemon loop. */
function runPumpPass(
  options: PumpQueuedRunsOptions,
): Promise<PumpQueuedRunsResult> {
  const dispatches = listPumpWork(options).map((job) => {
    const dispatch = dispatchQueuedRun(job, options)
    options.onDispatch?.(job, dispatch)
    return dispatch
  })
  return Promise.all(dispatches).then((runs) => ({ runs }))
}

/**
 * Waits for `work` at most `ms` (the timer never outlives the wait).
 * Resolves true when `work` settled in time, false otherwise; `work` itself
 * keeps running and its rejection is absorbed here.
 */
export function settledWithin(
  work: Promise<unknown>,
  ms: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const settled = work.then(
    () => true,
    () => true,
  )
  const expired = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), Math.max(0, ms))
  })
  return Promise.race([settled, expired]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

/**
 * Bound on one daemon tick's wait for its over-age settlement pass. A pass
 * still pending after it keeps running in the background and no second pass
 * starts until it settles, so the loop (heartbeat, cleanup, dispatch)
 * never stalls behind one settlement.
 */
export const OVER_AGE_TICK_WAIT_MS = 5_000

/** First retry delay of a Run whose dispatch failed (doubles per failure). */
export const DAEMON_DISPATCH_RETRY_BASE_MS = 1_000
/** Upper bound of that retry delay. */
export const DAEMON_DISPATCH_RETRY_MAX_MS = 60_000

/**
 * Backoff of Runs whose dispatch failed with a non-outcome error (for
 * example a claim append the store rejected): a Run that is still queued is
 * retried after DAEMON_DISPATCH_RETRY_BASE_MS, doubling per failure up to
 * DAEMON_DISPATCH_RETRY_MAX_MS, instead of being excluded for the daemon's
 * lifetime while status keeps reporting the executor available.
 */
class DispatchBackoff {
  private readonly entries = new Map<
    string,
    { failures: number; retryAt: number }
  >()

  failed(jobId: string, now: number): void {
    const failures = (this.entries.get(jobId)?.failures ?? 0) + 1
    const wait = Math.min(
      DAEMON_DISPATCH_RETRY_MAX_MS,
      DAEMON_DISPATCH_RETRY_BASE_MS * 2 ** Math.min(failures - 1, 16),
    )
    this.entries.set(jobId, { failures, retryAt: now + wait })
  }

  settled(jobId: string): void {
    this.entries.delete(jobId)
  }

  /** Every Run with a failed dispatch (a `once` pass does not wait for it). */
  all(): Set<string> {
    return new Set(this.entries.keys())
  }

  /**
   * Runs still waiting out their backoff. Entries whose Run left the queue
   * (claimed elsewhere, canceled, settled) are dropped once due.
   */
  waiting(now: number, isQueued: (jobId: string) => boolean): Set<string> {
    const waiting = new Set<string>()
    for (const [jobId, entry] of this.entries) {
      if (entry.retryAt > now) waiting.add(jobId)
      else if (!isQueued(jobId)) this.entries.delete(jobId)
    }
    return waiting
  }
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

export async function runLocalAgentDaemon(
  options: RunLocalAgentDaemonOptions,
): Promise<RunLocalAgentDaemonResult> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 1, 16))
  const pollIntervalMs = Math.max(
    100,
    Math.min(options.pollIntervalMs ?? 1000, 60_000),
  )
  const lock = options.lockPath ? acquireDaemonLock(options.lockPath) : null
  const heartbeatTimer = lock
    ? setInterval(() => lock.heartbeat(), DAEMON_LOCK_HEARTBEAT_INTERVAL_MS)
    : null
  const active = new Set<Promise<unknown>>()
  // Runs this daemon could not dispatch (non-outcome failure) are retried
  // with backoff while they stay queued.
  const backoff = new DispatchBackoff()
  // Over-age Runs this daemon could not settle (non-race error) are not
  // retried by later ticks, so they cannot starve younger over-age Runs.
  const overAgeFailedIds = new Set<string>()
  let overAgePass: Promise<unknown> | null = null
  const result: RunLocalAgentDaemonResult = {
    scheduledJobs: 0,
    startedJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
    interruptedJobs: 0,
    stoppedBy: "once",
  }

  try {
    const interrupted = await recoverStaleAgentJobs(options.db, options.now, {
      onDiagnostic: (diagnostic) =>
        writeLine(options.stderr, `[Daemon] ${diagnostic.message}`),
    })
    result.interruptedJobs = interrupted.length
    writeLine(
      options.stderr,
      `[Daemon] Started local agent daemon pid=${process.pid} concurrency=${concurrency}`,
    )
    if (interrupted.length > 0) {
      writeLine(
        options.stderr,
        `[Daemon] Marked ${interrupted.length} stale running job(s) interrupted`,
      )
    }

    while (!options.signal?.aborted) {
      lock?.heartbeat()
      cleanupExpiredAgentJobIdempotency(options.db, {
        now: options.now ?? new Date(),
      })
      // Over-age admitted queued API Runs settle on the tick (bounded per
      // tick) without waiting for a claim (design D5). The tick waits for
      // the pass at most OVER_AGE_TICK_WAIT_MS and never starts a second
      // pass while one is still pending.
      if (!overAgePass) {
        const pass: Promise<unknown> = settleOverAgeQueuedLocalJobApiRuns(
          options.db,
          {
            now: options.now,
            maxQueuedApiAgeMs:
              options.maxQueuedApiAgeMs ?? MAX_QUEUED_API_AGE_MS,
            excludeIds: overAgeFailedIds,
            onSettlementError: (jobId, code) => {
              overAgeFailedIds.add(jobId)
              writeLine(
                options.stderr,
                `[Daemon] Over-age job ${jobId} was not settled (${code}); not retried by this daemon.`,
              )
            },
          },
        )
          .catch(() => {
            writeLine(
              options.stderr,
              "[Daemon] Over-age settlement pass failed; retried on a later tick.",
            )
          })
          .finally(() => {
            if (overAgePass === pass) overAgePass = null
          })
        overAgePass = pass
      }
      await settledWithin(overAgePass, OVER_AGE_TICK_WAIT_MS)
      const available = concurrency - active.size
      if (available > 0) {
        const scheduled = await evaluateDueAgentSchedules(options.db, {
          now: options.now,
          limit: available,
        })
        result.scheduledJobs += scheduled.length
        void runPumpPass({
          db: options.db,
          env: options.env,
          runner: options.runner,
          stderr: options.stderr,
          completionFetch: options.completionFetch,
          providerBindingDependencies: options.providerBindingDependencies,
          appVersion: options.appVersion,
          runtimeRouteCatalog: options.runtimeRouteCatalog,
          concurrency: available,
          excludeIds: backoff.waiting(performance.now(), (jobId) => {
            try {
              return getAgentJob(options.db, jobId)?.status === "queued"
            } catch {
              return true
            }
          }),
          workerKind: "daemon",
          apiCapable: lock !== null,
          now: options.now,
          maxQueuedApiAgeMs: options.maxQueuedApiAgeMs,
          onDispatch: (job, dispatch) => {
            result.startedJobs += 1
            const tracked = dispatch
              .then((run) => {
                if (run.error) {
                  backoff.failed(job.id, performance.now())
                  result.failedJobs += 1
                  writeLine(
                    options.stderr,
                    `[Daemon] Failed job ${job.id}: ${
                      run.error instanceof Error
                        ? run.error.message
                        : String(run.error)
                    }`,
                  )
                } else {
                  backoff.settled(job.id)
                  if (run.claimed) result.completedJobs += 1
                }
              })
              .finally(() => {
                active.delete(tracked)
              })
            active.add(tracked)
          },
        })
      }

      if (options.once && active.size === 0) {
        const queued = listPumpWork({
          db: options.db,
          concurrency: 1,
          excludeIds: backoff.all(),
          apiCapable: lock !== null,
        })
        if (queued.length === 0) break
      }

      await delay(pollIntervalMs, options.signal)
    }

    if (options.signal?.aborted) result.stoppedBy = "signal"
    await Promise.allSettled(active)
    return result
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    lock?.release()
    writeLine(options.stderr, "[Daemon] Stopped local agent daemon")
  }
}
