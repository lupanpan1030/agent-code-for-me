import { fstatSync, readFileSync } from "node:fs"
import type { Readable } from "node:stream"
import {
  type AgentJobStatus,
  isTerminalAgentJobStatus,
} from "../../../shared/agent-jobs"
import {
  assertLocalJobApiIdempotencyKey,
  isLocalJobApiRequestError,
  LOCAL_JOB_API_PROJECT_NOT_REGISTERED,
  LOCAL_JOB_API_VERSION,
  LOCAL_JOB_API_WAIT_EXIT_CODE,
  LocalJobApiRequestError,
  type NormalizedLocalJobApiCreateRequest,
  toLocalJobApiErrorEnvelope,
} from "../../../shared/local-job-api"
import type { AgentJob, AgentJobEvent, Project } from "../db/schema"
import {
  getProjectRegistrationForCwd,
  isProjectRegistrationError,
  type ProjectRegistrationError,
  registerProjectForPath,
  unregisterProjectForPath,
} from "../projects/registry"
import type { AgentTaskRunner } from "./agent-runtime-contract"
import {
  type HeadlessCliCommand,
  type HeadlessOutputFormat,
  parseHeadlessCliArgv,
} from "./cli-args"
import {
  formatEventsText,
  formatJobListText,
  formatJobText,
  formatScheduleListText,
  formatScheduleText,
  serializeAgentJob,
  serializeAgentJobEvent,
  serializeAgentSchedule,
} from "./cli-output"
import type { RunPersistedCompletionJobOptions } from "./completion-runner"
import {
  type PumpQueuedRunResult,
  pumpQueuedRuns,
  runLocalAgentDaemon,
  settledWithin,
} from "./daemon"
import { recoverStaleAgentJobs } from "./job-recovery"
import { HEADLESS_EXIT_CODES, runPersistedAgentJob } from "./job-runner"
import {
  type AgentJobDatabase,
  cancelAgentJob,
  createAgentJob,
  getAgentJob,
  getAgentJobPrompt,
  listAgentJobEvents,
  listAgentJobs,
  retryAgentJob,
} from "./job-store"
import { runJobsStdioServer } from "./jobs-stdio"
import {
  getLocalJobApiEvents,
  getLocalJobApiJobOrThrow,
  type LocalJobApiRuntimeManifestEnvelopeOptions,
  openQueuedCancelLocalJobApiTerminal,
  parseLocalJobApiRetryRequestJson,
  parseLocalJobApiSubmitRequestJson,
  toLocalJobApiJobEnvelope,
  toLocalJobApiResultEnvelope,
  toLocalJobApiRuntimeManifestEnvelope,
} from "./local-job-api"
import {
  assertHeadlessProviderSelectionUsableAtCreate,
  type HeadlessProviderBindingDependencies,
  HeadlessProviderBindingError,
  isInvalidHeadlessProviderBindingRequestCode,
  isLocalOnlyHeadlessProviderBindingCode,
  isUnavailableHeadlessProviderBindingCode,
} from "./provider-binding"
import {
  DEFAULT_MONOTONIC_CLOCK,
  type MonotonicClock,
  type OwnDispatch,
  observeRunExecution,
  type SubmitRunResult,
  submitRun,
  waitForAdmittedRun,
  waitForRun,
} from "./run-submission"
import {
  createAgentSchedule,
  deleteAgentSchedule,
  findRegisteredProjectForCwd,
  listAgentSchedules,
  pauseAgentSchedule,
  resumeAgentSchedule,
  runAgentScheduleNow,
} from "./schedules"

type Writer = {
  write(chunk: string): unknown
}

export type RunHeadlessCliCommandOptions = {
  argv?: string[]
  db: AgentJobDatabase
  appVersion?: string | null
  env?: NodeJS.ProcessEnv
  stdin?: Readable
  stdout?: Writer
  stderr?: Writer
  runner?: AgentTaskRunner | null
  now?: Date
  daemonLockPath?: string | null
  runtimeReadinessDependencies?: LocalJobApiRuntimeManifestEnvelopeOptions["readinessDependencies"]
  completionFetch?: RunPersistedCompletionJobOptions["fetchImpl"]
  providerBindingDependencies?: HeadlessProviderBindingDependencies
  /**
   * Monotonic clock of `runs wait` and the create/retry wrapper's internal
   * wait (deadlines, 30000 ms observer windows); defaults to real time.
   */
  monotonicClock?: MonotonicClock
  /**
   * Called after the wrapper's own admission and before its scoped pump
   * claims it; if the Run is no longer queued afterwards the wrapper only
   * waits (claim-latch seam).
   */
  beforeOwnPumpClaim?: (jobId: string) => Promise<void>
}

export const HEADLESS_STDIN_MAX_BYTES = 1024 * 1024

function write(writer: Writer | undefined, chunk: string): void {
  writer?.write(chunk)
}

function writeLine(writer: Writer | undefined, line: string): void {
  write(writer, `${line}\n`)
}

function writeJson(writer: Writer | undefined, value: unknown): void {
  writeLine(writer, JSON.stringify(value))
}

function commandError(
  stderr: Writer | undefined,
  message: string,
  code = 1,
): number {
  writeLine(stderr, message)
  return code
}

async function readStdin(stream: Readable | undefined): Promise<string> {
  if (!stream) return ""
  const chunks: Buffer[] = []
  let byteLength = 0
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    byteLength += buffer.length
    if (byteLength > HEADLESS_STDIN_MAX_BYTES) {
      throw new Error(`stdin exceeds ${HEADLESS_STDIN_MAX_BYTES} byte limit`)
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString("utf-8")
}

function readRequestFile(path: string): string {
  if (path === "-") {
    throw new Error("stdin request must be read asynchronously")
  }
  const buffer = readFileSync(path)
  if (buffer.byteLength > HEADLESS_STDIN_MAX_BYTES) {
    throw new Error(
      `request file exceeds ${HEADLESS_STDIN_MAX_BYTES} byte limit`,
    )
  }
  return buffer.toString("utf-8")
}

function shouldUseJson(output: HeadlessOutputFormat): boolean {
  return output === "json" || output === "stream-json"
}

function outputJob(
  stdout: Writer | undefined,
  output: HeadlessOutputFormat,
  job: AgentJob,
): void {
  if (shouldUseJson(output)) {
    writeJson(stdout, { job: serializeAgentJob(job) })
    return
  }
  write(stdout, formatJobText(job))
}

function outputEvents(
  stdout: Writer | undefined,
  output: HeadlessOutputFormat,
  events: AgentJobEvent[],
): void {
  if (output === "stream-json") {
    for (const event of events) {
      writeJson(stdout, { event: serializeAgentJobEvent(event) })
    }
    return
  }
  if (output === "json") {
    writeJson(stdout, {
      events: events.map(serializeAgentJobEvent),
    })
    return
  }
  write(stdout, formatEventsText(events))
}

function outputSchedule(
  stdout: Writer | undefined,
  output: HeadlessOutputFormat,
  schedule: Parameters<typeof serializeAgentSchedule>[0],
): void {
  if (shouldUseJson(output)) {
    writeJson(stdout, { schedule: serializeAgentSchedule(schedule) })
    return
  }
  write(stdout, formatScheduleText(schedule))
}

function outputRunResult(
  stdout: Writer | undefined,
  output: HeadlessOutputFormat,
  job: AgentJob,
  events: AgentJobEvent[],
): void {
  if (output === "stream-json") {
    writeJson(stdout, { job: serializeAgentJob(job) })
    for (const event of events) {
      writeJson(stdout, { event: serializeAgentJobEvent(event) })
    }
    return
  }
  if (output === "json") {
    writeJson(stdout, {
      job: serializeAgentJob(job),
      events: events.map(serializeAgentJobEvent),
    })
    return
  }

  const finalMessage =
    job.resultJson && typeof job.resultJson === "string"
      ? JSON.parse(job.resultJson).finalMessage
      : null
  if (typeof finalMessage === "string" && finalMessage.trim()) {
    writeLine(stdout, finalMessage)
    return
  }
  write(stdout, formatJobText(job))
}

async function runCommand(
  command: Extract<HeadlessCliCommand, { kind: "run" }>,
  options: RunHeadlessCliCommandOptions,
): Promise<number> {
  let stdinPrompt = ""
  try {
    stdinPrompt = command.stdin ? await readStdin(options.stdin) : ""
  } catch (error) {
    return commandError(
      options.stderr,
      error instanceof Error ? error.message : String(error),
      HEADLESS_EXIT_CODES.invalidArguments,
    )
  }
  const prompt = [command.prompt, stdinPrompt]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n")
  if (!prompt) {
    return commandError(
      options.stderr,
      "locus run requires --prompt or --stdin",
      HEADLESS_EXIT_CODES.invalidArguments,
    )
  }

  let project: ReturnType<typeof findRegisteredProjectForCwd>
  try {
    project = findRegisteredProjectForCwd(
      options.db,
      command.cwd,
      null,
      "Run cwd",
    )
  } catch (error) {
    return commandError(
      options.stderr,
      error instanceof Error ? error.message : String(error),
      HEADLESS_EXIT_CODES.invalidCwd,
    )
  }

  let job: AgentJob
  try {
    assertHeadlessProviderSelectionUsableAtCreate({
      db: options.db,
      runtime: command.runtime,
      providerProfileId: command.providerProfileId,
    })
    job = await createAgentJob(options.db, {
      source: command.daemon ? "daemon" : "cli",
      runtime: command.runtime,
      mode: command.mode,
      cwd: command.cwd,
      prompt,
      projectId: project.id,
      providerProfileId: command.providerProfileId,
      modelOverride: command.model,
      createdByVersion: options.appVersion ?? null,
    })
  } catch (error) {
    return commandError(
      options.stderr,
      error instanceof Error ? error.message : String(error),
      HEADLESS_EXIT_CODES.invalidArguments,
    )
  }

  if (command.daemon) {
    if (command.follow) {
      outputJob(options.stdout, command.output, job)
      return logsCommand(
        {
          kind: "jobs-logs",
          jobId: job.id,
          follow: true,
          output: command.output,
        },
        options,
      )
    }
    outputJob(options.stdout, command.output, job)
    return HEADLESS_EXIT_CODES.success
  }

  const result = await runPersistedAgentJob({
    db: options.db,
    jobId: job.id,
    runner: options.runner,
    env: options.env,
    providerBindingDependencies: options.providerBindingDependencies,
  })
  outputRunResult(options.stdout, command.output, result.job, result.events)
  return result.exitCode
}

function listCommand(
  command: Extract<HeadlessCliCommand, { kind: "jobs-list" }>,
  options: RunHeadlessCliCommandOptions,
): number {
  const jobs = listAgentJobs(options.db, {
    source: command.source === "all" ? undefined : command.source,
    limit: 100,
  })
  if (command.output === "json" || command.output === "stream-json") {
    writeJson(options.stdout, { jobs: jobs.map(serializeAgentJob) })
  } else {
    write(options.stdout, formatJobListText(jobs))
  }
  return 0
}

function showCommand(
  command: Extract<HeadlessCliCommand, { kind: "jobs-show" }>,
  options: RunHeadlessCliCommandOptions,
): number {
  const job = getAgentJob(options.db, command.jobId)
  if (!job)
    return commandError(options.stderr, `Unknown job: ${command.jobId}`, 3)
  outputJob(options.stdout, command.output, job)
  return 0
}

async function logsCommand(
  command: Extract<HeadlessCliCommand, { kind: "jobs-logs" }>,
  options: RunHeadlessCliCommandOptions,
): Promise<number> {
  const job = getAgentJob(options.db, command.jobId)
  if (!job)
    return commandError(options.stderr, `Unknown job: ${command.jobId}`, 3)

  let afterSequence = 0
  let currentJob: AgentJob | null = job
  do {
    const events = listAgentJobEvents(options.db, command.jobId, afterSequence)
    if (events.length > 0) {
      const lastEvent = events.at(-1)
      if (lastEvent) afterSequence = lastEvent.sequence
      outputEvents(options.stdout, command.output, events)
    } else if (!command.follow) {
      outputEvents(options.stdout, command.output, [])
    }
    if (!command.follow) break
    currentJob = getAgentJob(options.db, command.jobId)
    if (
      currentJob &&
      isTerminalAgentJobStatus(currentJob.status as AgentJobStatus)
    ) {
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  } while (command.follow)
  return 0
}

const PRE_START_CANCEL_FIELDS = {
  exitCode: HEADLESS_EXIT_CODES.canceled,
  errorCode: "job_canceled",
  errorMessage: "Job was canceled before it started.",
}

/**
 * A queued cancel of an admitted API Run registers the same terminal
 * preparer a worker would (design D5); other Runs register none.
 */
function queuedCancelTerminalProjection(db: AgentJobDatabase) {
  return (job: AgentJob) => openQueuedCancelLocalJobApiTerminal(db, job)
}

async function cancelCommand(
  command: Extract<HeadlessCliCommand, { kind: "jobs-cancel" }>,
  options: RunHeadlessCliCommandOptions,
): Promise<number> {
  const job = getAgentJob(options.db, command.jobId)
  if (!job)
    return commandError(options.stderr, `Unknown job: ${command.jobId}`, 3)
  const updated = await cancelAgentJob(options.db, command.jobId, {
    requestedBy: "cli",
    queuedCancelFields: PRE_START_CANCEL_FIELDS,
    queuedTerminalProjection: queuedCancelTerminalProjection(options.db),
  })
  outputJob(options.stdout, command.output, updated)
  return 0
}

async function retryCommand(
  command: Extract<HeadlessCliCommand, { kind: "jobs-retry" }>,
  options: RunHeadlessCliCommandOptions,
): Promise<number> {
  const job = getAgentJob(options.db, command.jobId)
  if (!job)
    return commandError(options.stderr, `Unknown job: ${command.jobId}`, 3)
  if (job.source === "desktop") {
    return commandError(
      options.stderr,
      "Desktop chat jobs must be retried from their linked chat.",
      3,
    )
  }
  if (job.source === "api") {
    return commandError(
      options.stderr,
      "API jobs must be retried through locus api runs retry.",
      3,
    )
  }
  getAgentJobPrompt(options.db, command.jobId)
  const retry = await retryAgentJob(options.db, command.jobId)
  outputJob(options.stdout, command.output, retry)
  return 0
}

async function readApiRequestContent(
  requestPath: string,
  options: RunHeadlessCliCommandOptions,
): Promise<string> {
  if (requestPath === "-") return readStdin(options.stdin)
  return readRequestFile(requestPath)
}

/**
 * Admission envelope of submit / retry --async: a fixed queued snapshot;
 * only a keyed replay of a retained Run carries idempotentReplay.
 */
function admissionEnvelope(admitted: SubmitRunResult, keyed: boolean) {
  return admitted.replay && keyed
    ? {
        apiVersion: LOCAL_JOB_API_VERSION,
        idempotentReplay: true,
        job: toLocalJobApiJobEnvelope(admitted.job).job,
      }
    : toLocalJobApiJobEnvelope(admitted.job)
}

type ApiCommandErrorMapper = (
  error: unknown,
  options: RunHeadlessCliCommandOptions,
) => number

function apiRequestError(
  error: LocalJobApiRequestError,
  options: RunHeadlessCliCommandOptions,
): number {
  writeJson(options.stdout, toLocalJobApiErrorEnvelope(error))
  return error.code === "submission_pending"
    ? HEADLESS_EXIT_CODES.internalFailure
    : HEADLESS_EXIT_CODES.invalidArguments
}

/**
 * Errors of submit/create (2c59664f create baseline): the new async-submit
 * request errors and the existing project/provider errors are stdout v1
 * envelopes; everything else keeps its plain-text stderr diagnostic and the
 * create exit (2, or 3 for unsupported).
 */
function apiCreateError(
  error: unknown,
  options: RunHeadlessCliCommandOptions,
): number {
  if (isLocalJobApiRequestError(error)) return apiRequestError(error, options)
  if (isLocalJobApiProjectNotRegisteredError(error)) {
    writeJson(options.stdout, toLocalJobApiProjectErrorEnvelope(error))
    return HEADLESS_EXIT_CODES.invalidCwd
  }
  if (error instanceof HeadlessProviderBindingError) {
    writeJson(options.stdout, toLocalJobApiProviderErrorEnvelope(error))
    return localJobApiCreateErrorCode(error)
  }
  const message = error instanceof Error ? error.message : String(error)
  return commandError(
    options.stderr,
    message,
    localJobApiCreateErrorCode(error),
  )
}

/**
 * Errors of retry (2c59664f retry baseline): only provider-binding errors
 * are stdout envelopes; every other existing error (including an
 * unregistered project) keeps its stderr text and exit 3. The new
 * async-submit request errors are stdout v1 envelopes.
 */
function apiRetryError(
  error: unknown,
  options: RunHeadlessCliCommandOptions,
): number {
  if (isLocalJobApiRequestError(error)) return apiRequestError(error, options)
  if (error instanceof HeadlessProviderBindingError) {
    writeJson(options.stdout, toLocalJobApiProviderErrorEnvelope(error))
    return localJobApiCreateErrorCode(error)
  }
  return commandError(
    options.stderr,
    error instanceof Error ? error.message : String(error),
    HEADLESS_EXIT_CODES.unsupportedRuntimeOrMode,
  )
}

function waitEnvelope(
  job: AgentJob,
  wait:
    | { state: "timeout"; timeoutMs: number; reason: string }
    | { state: "error"; reason: string },
) {
  return {
    apiVersion: LOCAL_JOB_API_VERSION,
    job: toLocalJobApiJobEnvelope(job).job,
    wait,
  }
}

const RELAY_CANCEL_ACK_MS = 5_000

/** True when `stream` is this process's stdin and it is an open pipe/socket. */
function isOpenStdinPipe(stream: Readable | undefined): boolean {
  if (!stream || stream !== process.stdin) return false
  if (stream.readableEnded || stream.destroyed) return false
  try {
    const stat = fstatSync(0)
    return stat.isFIFO() || stat.isSocket()
  } catch {
    return false
  }
}

/**
 * Yields until the event loop completed at least one poll phase after the
 * call: two check-phase turns (the first may run in the current iteration,
 * after its poll already ran). Signals libuv caught and stdin reads become
 * ready are dispatched in a poll phase, so their handlers have run when this
 * resolves.
 */
async function yieldPastPollPhase(): Promise<void> {
  for (let turn = 0; turn < 2; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

/** An armed stdin EOF watch of the R4 relay. */
type StdinEofWatch = {
  /** Calls `listener` once on EOF (at once when EOF was already seen). */
  onEnd(listener: () => void): void
  /** Stops reading stdin and removes the watch's listeners. */
  stop(): void
}

/** Bound on the win32 stdin probe (libuv reads Windows pipes on a thread). */
const WIN32_STDIN_PROBE_MS = 50

/**
 * Starts the R4 stdin EOF watch at arming. EOF is an abort signal only for a
 * stdin that is still an open pipe or socket when the command arms and ends
 * later. A pipe whose write end was already closed when the command started
 * (`execFileSync`/`spawnSync` without `input`, `child.stdin.end()` right
 * after spawn) is still a FIFO/socket and reports its pending EOF on the
 * first read, so the watch starts reading and yields to the event loop until
 * stdin was polled at least once: two check-phase turns on POSIX, so at least
 * one full poll phase follows the read start; on win32, where libuv reads a
 * pipe on a worker thread, additionally a 50 ms timer (unverified on a
 * Windows host). An EOF seen inside that probe means the stdin was already
 * closed: it does not arm, and the watch returns null. Data on this stdin is
 * drained and ignored (the request came from a file).
 */
async function watchStdinEof(
  stream: Readable | undefined,
): Promise<StdinEofWatch | null> {
  if (!stream || !isOpenStdinPipe(stream)) return null
  let ended = false
  let listener: (() => void) | null = null
  const drain = () => {}
  const onEnd = () => {
    if (ended) return
    ended = true
    listener?.()
  }
  stream.on("data", drain)
  stream.once("end", onEnd)
  stream.once("close", onEnd)
  stream.resume()
  const stop = () => {
    listener = null
    stream.removeListener("data", drain)
    stream.removeListener("end", onEnd)
    stream.removeListener("close", onEnd)
    stream.pause()
  }
  if (!ended) await yieldPastPollPhase()
  if (!ended && process.platform === "win32") {
    await new Promise((resolve) => setTimeout(resolve, WIN32_STDIN_PROBE_MS))
  }
  if (ended) {
    stop()
    return null
  }
  return {
    onEnd(next) {
      listener = next
      if (ended) next()
    },
    stop,
  }
}

/** A relayed catchable abort of a create/default-retry wrapper. */
type RelayedAbort = {
  /** The re-raised signal, or null for an armed stdin EOF (exit 8). */
  signal: NodeJS.Signals | null
  /** Settles after the own cancel was persisted and acknowledged (≤5 s). */
  relayed: Promise<void>
}

/**
 * The R4 relay of a create/default-retry wrapper. Its listeners are installed
 * once, before admission, and removed only by `dispose()` when the command
 * ends; every later change of disposition is a mode switch, so a signal the
 * runtime already caught is always dispatched to a live handler.
 */
type WrapperAbortRelay = {
  /** Resolves as soon as a relayed catchable signal or armed EOF arrives. */
  aborted: Promise<RelayedAbort>
  /** The relayed abort once one arrived, else null. */
  received(): RelayedAbort | null
  /** Admission returned the own Run: an abort held during admission relays now. */
  admitted(jobId: string): void
  /**
   * The wrapper does not own a Run to cancel (admission failed, or a keyed
   * replay waiter observes a retained Run another request admitted): a held
   * signal is re-raised at once and later signals take the default
   * disposition; EOF is ignored.
   */
  observeOnly(): void
  /** The worker identity the own pump attempts its claim with. */
  ownWorker(workerId: string): void
  /** The own pump claimed: the baseline default disposition, EOF ignored. */
  ownClaimed(): void
  /** Removes every listener (the command's `finally`). */
  dispose(): void
}

/**
 * Catchable aborts a create/default-retry wrapper relays (R4), per platform.
 *
 * - POSIX: SIGINT, SIGTERM and SIGHUP (terminal hangup).
 * - Windows (Node/libuv console control handler): SIGINT (Ctrl+C),
 *   SIGBREAK (Ctrl+Break, the event a parent can send to a child started in
 *   a new process group) and SIGHUP (console window closed; Windows ends
 *   the process a few seconds later whatever the handler does). SIGTERM is
 *   listened to but never generated by Windows.
 *
 * Not catchable, so never relayed: SIGKILL, Windows `TerminateProcess` /
 * `child.kill()`, and the Windows logoff/shutdown console events, which
 * libuv does not deliver as signals.
 */
export function daemonFirstRelaySignals(
  platform: NodeJS.Platform,
): readonly NodeJS.Signals[] {
  return platform === "win32"
    ? ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]
    : ["SIGINT", "SIGTERM", "SIGHUP"]
}

/**
 * R4 relay of a create/default-retry wrapper, armed before admission — so no
 * catchable abort is lost — and moved through these modes:
 *
 * - pending (admission in progress, no ID yet): a catchable signal of
 *   daemonFirstRelaySignals or an armed stdin EOF is held. When admission
 *   returns the own ID the held abort takes the owner path below; when
 *   admission throws a held signal is re-raised with the default
 *   disposition (a held EOF is dropped: there is no Run).
 * - owner (until the own pump claims the Run: it is still queued, or another
 *   executor claimed it first — daemon-first): the abort stops the wrapper's
 *   own pump attempt and wait (no envelope is written after the abort),
 *   forwards one cancel for the wrapper's own admitted Run through the
 *   existing cancel owner (a queued Run settles canceled; a Run another
 *   executor claimed gets its cancel request) and waits at most 5000 ms for
 *   its terminal. The wrapper then re-raises the signal (or ends with exit
 *   8 on EOF).
 * - own-claimed (the own pump claimed the Run: local execution) and
 *   observe-only (a keyed replay waiter, or a failed admission): the
 *   handlers stay installed and re-raise the signal with the default
 *   disposition, which is the 2c59664f behaviour of a local execution; stdin
 *   EOF is ignored. A signal caught between the own claim commit and the
 *   switch is recognised by the committed own worker identity.
 *
 * Uncatchable terminations relay nothing; the Run stays queryable by ID.
 */
async function armWrapperAbortRelay(
  options: RunHeadlessCliCommandOptions,
  stdinArmable: boolean,
): Promise<WrapperAbortRelay> {
  type Mode = "pending" | "owner" | "passthrough" | "relayed" | "disposed"
  let mode: Mode = "pending"
  let jobId: string | null = null
  let ownWorkerId: string | null = null
  let held: { signal: NodeJS.Signals | null } | null = null
  let receivedAbort: RelayedAbort | null = null
  // Persists the own cancel request, then waits for the claimant (or the
  // queued cancel itself) to settle a terminal; at most 5000 ms in total,
  // and a hard kill may truncate it (the persisted request stays).
  const relayCancel = async (id: string) => {
    const deadline = Date.now() + RELAY_CANCEL_ACK_MS
    let persisted = false
    await settledWithin(
      cancelAgentJob(options.db, id, {
        requestedBy: "api",
        queuedCancelFields: PRE_START_CANCEL_FIELDS,
        queuedTerminalProjection: queuedCancelTerminalProjection(options.db),
      }).then(() => {
        persisted = true
      }),
      RELAY_CANCEL_ACK_MS,
    )
    if (!persisted) return
    while (Date.now() < deadline) {
      const current = getAgentJob(options.db, id)
      if (
        !current ||
        isTerminalAgentJobStatus(current.status as AgentJobStatus)
      ) {
        return
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(100, deadline - Date.now())),
      )
    }
  }
  let resolveAborted!: (abort: RelayedAbort) => void
  const aborted = new Promise<RelayedAbort>((resolve) => {
    resolveAborted = resolve
  })
  /** True when the own pump already holds the claim (local execution). */
  const ownClaimCommitted = () => {
    if (jobId === null || ownWorkerId === null) return false
    try {
      return getAgentJob(options.db, jobId)?.workerId === ownWorkerId
    } catch {
      return false
    }
  }
  let stdin: StdinEofWatch | null = null
  const signalHandlers = daemonFirstRelaySignals(process.platform).map(
    (signal) => [signal, () => onAbort(signal)] as const,
  )
  const removeSignalListeners = () => {
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler)
    }
  }
  /** Default disposition: no listener of this relay, then the signal again. */
  const passThrough = (signal: NodeJS.Signals) => {
    removeSignalListeners()
    stdin?.stop()
    reraiseWithDefaultDisposition(signal)
  }
  const relayOwn = (signal: NodeJS.Signals | null) => {
    if (ownClaimCommitted()) {
      // Local execution: the baseline default disposition, EOF ignored.
      mode = "passthrough"
      stdin?.stop()
      if (signal) passThrough(signal)
      return
    }
    mode = "relayed"
    removeSignalListeners()
    stdin?.stop()
    receivedAbort = {
      signal,
      relayed: relayCancel(String(jobId)).catch(() => undefined),
    }
    resolveAborted(receivedAbort)
  }
  function onAbort(signal: NodeJS.Signals | null) {
    switch (mode) {
      case "pending":
        // A signal outranks a held EOF; the first of each kind is kept.
        if (!held || (held.signal === null && signal !== null)) {
          held = { signal }
        }
        return
      case "owner":
        relayOwn(signal)
        return
      case "passthrough":
        if (signal) passThrough(signal)
        return
      default:
        return
    }
  }
  // Signals first, so none is missed while the stdin probe yields.
  for (const [signal, handler] of signalHandlers) process.on(signal, handler)
  if (stdinArmable) {
    try {
      stdin = await watchStdinEof(options.stdin)
    } catch (error) {
      removeSignalListeners()
      throw error
    }
    stdin?.onEnd(() => onAbort(null))
  }
  const toPassthrough = () => {
    if (mode !== "pending" && mode !== "owner") return
    mode = "passthrough"
    stdin?.stop()
    const signal = held?.signal ?? null
    held = null
    if (signal) passThrough(signal)
  }
  return {
    aborted,
    received: () => receivedAbort,
    admitted(id) {
      if (mode !== "pending") return
      jobId = id
      mode = "owner"
      const pendingAbort = held
      held = null
      if (pendingAbort) relayOwn(pendingAbort.signal)
    },
    observeOnly: toPassthrough,
    ownWorker(workerId) {
      ownWorkerId = workerId
    },
    ownClaimed: toPassthrough,
    dispose() {
      if (mode === "disposed") return
      mode = "disposed"
      removeSignalListeners()
      stdin?.stop()
    },
  }
}

/**
 * Re-raises `signal` after this wrapper's listeners were removed, so the
 * runtime's default disposition ends the process as if none had been armed.
 * A signal the runtime cannot raise (Windows SIGBREAK/SIGHUP) ends the
 * process with exit 8 instead.
 */
function reraiseWithDefaultDisposition(signal: NodeJS.Signals): void {
  try {
    process.kill(process.pid, signal)
  } catch {
    process.exit(HEADLESS_EXIT_CODES.internalFailure)
  }
}

/** Bound on waiting for a re-raised signal to end this process. */
const RELAY_RERAISE_GRACE_MS = 1_000

/**
 * Ends a relayed abort: waits for the relayed cancel (≤5 s) and for the own
 * pump attempt that the abort stopped (within the same window), then
 * re-raises the original signal (so a POSIX parent observes it) or returns
 * exit 8 for an armed EOF. Nothing is written to stdout. Windows has no
 * signal exit status: Node raises SIGINT/SIGTERM there as a termination
 * with exit 1 and cannot raise SIGBREAK/SIGHUP at all, so those fall back
 * to exit 8.
 */
async function finishRelayedAbort(
  abort: RelayedAbort,
  ownDispatch: OwnDispatch | null,
): Promise<number> {
  await abort.relayed
  if (ownDispatch) {
    await settledWithin(ownDispatch.promise, RELAY_CANCEL_ACK_MS)
  }
  if (abort.signal) {
    try {
      process.kill(process.pid, abort.signal)
    } catch {
      return HEADLESS_EXIT_CODES.internalFailure
    }
    // The default disposition ends the process; only a foreign handler
    // that keeps it alive lets this bounded fallback return.
    await new Promise((resolve) => setTimeout(resolve, RELAY_RERAISE_GRACE_MS))
  }
  return HEADLESS_EXIT_CODES.internalFailure
}

/**
 * Admits the Run of a synchronous create/default retry under the R4 relay
 * and runs its wrapper. The relay is armed before `admit` runs (an abort
 * during admission is held) and its listeners are removed only when the
 * command ends. A keyed replay (`replay: true`) does not own the retained
 * Run, so its waiter only observes: no relayed cancel, default disposition.
 */
async function admitUnderWrapperRelay(
  options: RunHeadlessCliCommandOptions,
  stdinArmable: boolean,
  admit: () => Promise<SubmitRunResult>,
  onError: ApiCommandErrorMapper,
): Promise<number> {
  const relay = await armWrapperAbortRelay(options, stdinArmable)
  try {
    let admitted: SubmitRunResult
    try {
      admitted = await admit()
    } catch (error) {
      // A signal caught during admission is dispatched (held) first.
      await yieldPastPollPhase()
      relay.observeOnly()
      return onError(error, options)
    }
    // Admission may finish without an event-loop turn: dispatch (and hold)
    // any abort caught during it before the own pump can claim the Run.
    await yieldPastPollPhase()
    if (admitted.replay) relay.observeOnly()
    else relay.admitted(admitted.job.id)
    return await runLocalJobApiWrapper(admitted.job.id, relay, options, onError)
  } finally {
    relay.dispose()
  }
}

/**
 * Q2(a) synchronous wrapper of create/default retry: its own admitted Run is
 * claimed through the canonical scoped pump (unless another claimant won it
 * first, then it only waits) and its committed, published terminal is
 * printed with the 2c59664f bytes and outcome exit. `relay` was armed before
 * admission (admitUnderWrapperRelay) and switches to the default disposition
 * when the own pump claims the Run.
 */
async function runLocalJobApiWrapper(
  jobId: string,
  relay: WrapperAbortRelay,
  options: RunHeadlessCliCommandOptions,
  onError: ApiCommandErrorMapper,
): Promise<number> {
  const ownAbort = new AbortController()
  const abort = relay.aborted.then(() => {
    // Stops an own pump attempt that has not claimed (or races the cancel).
    ownAbort.abort()
  })
  let ownDispatch: OwnDispatch | null = null
  const own: { result: PumpQueuedRunResult | null } = { result: null }
  if (!relay.received()) {
    try {
      await options.beforeOwnPumpClaim?.(jobId)
    } catch (error) {
      if (!relay.received()) throw error
    }
  }
  if (
    !relay.received() &&
    getAgentJob(options.db, jobId)?.status === "queued"
  ) {
    let state: ReturnType<OwnDispatch["state"]> = "pending"
    const promise = pumpQueuedRuns({
      db: options.db,
      env: options.env,
      runner: options.runner,
      completionFetch: options.completionFetch,
      providerBindingDependencies: options.providerBindingDependencies,
      appVersion: options.appVersion,
      admittedIds: [jobId],
      concurrency: 1,
      signal: ownAbort.signal,
      claimObserver: {
        attempting: (_job, workerId) => relay.ownWorker(workerId),
        // Local execution keeps the baseline abort/EOF disposition.
        claimed: () => relay.ownClaimed(),
      },
    }).then(
      (result) => {
        own.result = result.runs.find((run) => run.jobId === jobId) ?? null
        state = own.result?.error
          ? "failed"
          : own.result?.claimed
            ? "claimed"
            : "lost"
      },
      (error) => {
        own.result = { jobId, claimed: false, exitCode: null, error }
        state = "failed"
      },
    )
    ownDispatch = {
      promise,
      state: () => state,
      stop: async () => {
        ownAbort.abort()
        await promise
      },
    }
  }
  const result = relay.received()
    ? null
    : await waitForAdmittedRun(options.db, jobId, {
        clock: options.monotonicClock ?? DEFAULT_MONOTONIC_CLOCK,
        lockPath: options.daemonLockPath,
        ownDispatch,
        abort,
      })
  // A relayed abort wins over anything observed after it: no stale
  // terminal or observer envelope is written once the abort arrived.
  const relayed = relay.received()
  if (relayed) return await finishRelayedAbort(relayed, ownDispatch)
  switch (result?.kind) {
    case "ready":
    case "unpublished":
      writeJson(options.stdout, result.envelope)
      return result.exitCode
    case "error":
      writeJson(
        options.stdout,
        waitEnvelope(result.job, { state: "error", reason: result.reason }),
      )
      return HEADLESS_EXIT_CODES.internalFailure
    case "aborted":
      return HEADLESS_EXIT_CODES.internalFailure
    case "own_dispatch_failed": {
      // A non-outcome failure of the own pump: no terminal is fabricated.
      await cancelOwnQueuedRun(jobId, options)
      const late = relay.received()
      if (late) return await finishRelayedAbort(late, ownDispatch)
      return onError(own.result?.error, options)
    }
    case "own_observation_failed": {
      // The own execution tree was stopped; the baseline error is kept.
      await cancelOwnQueuedRun(jobId, options)
      const late = relay.received()
      if (late) return await finishRelayedAbort(late, ownDispatch)
      return onError(result.error, options)
    }
  }
  return HEADLESS_EXIT_CODES.internalFailure
}

/**
 * Closes the wrapper's own admitted Run that never started through the
 * existing queued cancel, waiting at most the 5000 ms ack window so the
 * baseline error is always reported; a store that still fails leaves the
 * Run to recovery.
 */
async function cancelOwnQueuedRun(
  jobId: string,
  options: RunHeadlessCliCommandOptions,
): Promise<void> {
  const cancel = (async () => {
    if (getAgentJob(options.db, jobId)?.status !== "queued") return
    await cancelAgentJob(options.db, jobId, {
      requestedBy: "api",
      queuedCancelFields: PRE_START_CANCEL_FIELDS,
      queuedTerminalProjection: queuedCancelTerminalProjection(options.db),
    })
  })()
  // Nothing more to do on failure or expiry; recovery owns the Run.
  await settledWithin(cancel, RELAY_CANCEL_ACK_MS)
}

async function apiRunsSubmitCommand(
  command: Extract<HeadlessCliCommand, { kind: "api-runs-submit" }>,
  options: RunHeadlessCliCommandOptions,
): Promise<number> {
  try {
    const parsed = parseLocalJobApiSubmitRequestJson(
      await readApiRequestContent(command.requestPath, options),
    )
    const idempotencyKey = parsed.hasKey
      ? assertLocalJobApiIdempotencyKey(parsed.idempotencyKey)
      : null
    const admitted = await submitRun(
      options.db,
      { kind: "api-submit", request: parsed.request, idempotencyKey },
      { appVersion: options.appVersion },
    )
    writeJson(
      options.stdout,
      admissionEnvelope(admitted, idempotencyKey !== null),
    )
    return HEADLESS_EXIT_CODES.success
  } catch (error) {
    return apiCreateError(error, options)
  }
}

async function apiRunsCreateCommand(
  command: Extract<HeadlessCliCommand, { kind: "api-runs-create" }>,
  options: RunHeadlessCliCommandOptions,
): Promise<number> {
  let request: NormalizedLocalJobApiCreateRequest
  try {
    const parsed = parseLocalJobApiSubmitRequestJson(
      await readApiRequestContent(command.requestPath, options),
      "create",
    )
    if (parsed.hasKey) {
      throw new LocalJobApiRequestError(
        "idempotency_key_not_supported",
        "idempotencyKey is not accepted by runs create; use runs submit.",
      )
    }
    request = parsed.request
  } catch (error) {
    return apiCreateError(error, options)
  }
  return admitUnderWrapperRelay(
    options,
    command.requestPath !== "-",
    () =>
      submitRun(
        options.db,
        { kind: "api-submit", request, idempotencyKey: null },
        { appVersion: options.appVersion },
      ),
    apiCreateError,
  )
}

async function apiRunsWaitCommand(
  command: Extract<HeadlessCliCommand, { kind: "api-runs-wait" }>,
  options: RunHeadlessCliCommandOptions,
): Promise<number> {
  let job: AgentJob | null
  try {
    job = getAgentJob(options.db, command.jobId)
  } catch {
    return commandError(
      options.stderr,
      `Failed to observe job: ${command.jobId}`,
      HEADLESS_EXIT_CODES.internalFailure,
    )
  }
  if (job?.source !== "api") {
    return commandError(options.stderr, `Unknown job: ${command.jobId}`, 3)
  }
  const result = await waitForRun(options.db, command.jobId, {
    timeoutMs: command.timeoutMs,
    clock: options.monotonicClock ?? DEFAULT_MONOTONIC_CLOCK,
    lockPath: options.daemonLockPath,
  })
  switch (result.kind) {
    case "ready":
      writeJson(options.stdout, result.envelope)
      return result.exitCode
    case "timeout":
      writeJson(
        options.stdout,
        waitEnvelope(result.job, {
          state: "timeout",
          timeoutMs: result.timeoutMs,
          reason: result.reason,
        }),
      )
      return LOCAL_JOB_API_WAIT_EXIT_CODE
    case "error":
      writeJson(
        options.stdout,
        waitEnvelope(result.job, { state: "error", reason: result.reason }),
      )
      return HEADLESS_EXIT_CODES.internalFailure
    case "not_found":
      return commandError(options.stderr, `Unknown job: ${command.jobId}`, 3)
    case "observation_failed_before_snapshot":
      return commandError(
        options.stderr,
        `Failed to observe job: ${command.jobId}`,
        HEADLESS_EXIT_CODES.internalFailure,
      )
  }
}

async function apiRuntimesListCommand(
  command: Extract<HeadlessCliCommand, { kind: "api-runtimes-list" }>,
  options: RunHeadlessCliCommandOptions,
): Promise<number> {
  writeJson(
    options.stdout,
    await toLocalJobApiRuntimeManifestEnvelope({
      db: options.db,
      onDiagnostic: (message) => writeLine(options.stderr, message),
      probe: !command.noProbe,
      providerBindingDependencies: options.providerBindingDependencies,
      readinessDependencies: options.runtimeReadinessDependencies,
    }),
  )
  return HEADLESS_EXIT_CODES.success
}

function isoDate(
  value: Date | string | number | null | undefined,
): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function serializeLocalJobApiProject(project: Project) {
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    lifecycleState: project.removedAt ? "removed" : "active",
    createdAt: isoDate(project.createdAt),
    updatedAt: isoDate(project.updatedAt),
    removedAt: isoDate(project.removedAt),
  }
}

function serializeLocalJobApiActiveJob(
  job: ReturnType<typeof unregisterProjectForPath>["activeJobs"][number],
) {
  return {
    id: job.id,
    source: job.source,
    runtime: job.runtime,
    status: job.status,
    createdAt: isoDate(job.createdAt),
  }
}

function apiProjectCommandErrorCode(error: unknown): number {
  if (isProjectRegistrationError(error)) return HEADLESS_EXIT_CODES.invalidCwd
  return HEADLESS_EXIT_CODES.invalidArguments
}

async function apiProjectsRegisterCommand(
  command: Extract<HeadlessCliCommand, { kind: "api-projects-register" }>,
  options: RunHeadlessCliCommandOptions,
): Promise<number> {
  try {
    const registration = await registerProjectForPath({
      db: options.db,
      path: command.cwd,
      name: command.name,
    })
    writeJson(options.stdout, {
      apiVersion: LOCAL_JOB_API_VERSION,
      registered: true,
      created: registration.created,
      restored: registration.restored,
      cwd: registration.canonicalPath,
      project: serializeLocalJobApiProject(registration.project),
    })
    return HEADLESS_EXIT_CODES.success
  } catch (error) {
    return commandError(
      options.stderr,
      error instanceof Error ? error.message : String(error),
      apiProjectCommandErrorCode(error),
    )
  }
}

function apiProjectsStatusCommand(
  command: Extract<HeadlessCliCommand, { kind: "api-projects-status" }>,
  options: RunHeadlessCliCommandOptions,
): number {
  try {
    const registration = getProjectRegistrationForCwd({
      db: options.db,
      cwd: command.cwd,
      label: "Project cwd",
      includeRemoved: true,
    })
    if (registration.registered) {
      writeJson(options.stdout, {
        apiVersion: LOCAL_JOB_API_VERSION,
        registered: true,
        cwd: registration.cwd,
        project: serializeLocalJobApiProject(registration.project),
      })
      return HEADLESS_EXIT_CODES.success
    }

    writeJson(options.stdout, {
      apiVersion: LOCAL_JOB_API_VERSION,
      registered: false,
      cwd: registration.cwd,
      error: {
        code: LOCAL_JOB_API_PROJECT_NOT_REGISTERED,
        message: "Project cwd must be inside a registered project",
      },
    })
    return HEADLESS_EXIT_CODES.success
  } catch (error) {
    return commandError(
      options.stderr,
      error instanceof Error ? error.message : String(error),
      apiProjectCommandErrorCode(error),
    )
  }
}

function apiProjectsUnregisterCommand(
  command: Extract<HeadlessCliCommand, { kind: "api-projects-unregister" }>,
  options: RunHeadlessCliCommandOptions,
): number {
  try {
    const result = unregisterProjectForPath({
      db: options.db,
      path: command.cwd,
      force: command.force,
    })
    if (result.removed) {
      writeJson(options.stdout, {
        apiVersion: LOCAL_JOB_API_VERSION,
        removed: true,
        cwd: result.canonicalPath,
        project: serializeLocalJobApiProject(result.project),
        activeJobs: result.activeJobs.map(serializeLocalJobApiActiveJob),
      })
      return HEADLESS_EXIT_CODES.success
    }

    if (result.reason === "active_jobs") {
      writeJson(options.stdout, {
        apiVersion: LOCAL_JOB_API_VERSION,
        removed: false,
        cwd: result.canonicalPath,
        project: result.project
          ? serializeLocalJobApiProject(result.project)
          : null,
        activeJobs: result.activeJobs.map(serializeLocalJobApiActiveJob),
        error: {
          code: "project_has_active_jobs",
          message: "Project has active jobs; rerun with --force to unregister.",
        },
      })
      return HEADLESS_EXIT_CODES.invalidArguments
    }

    writeJson(options.stdout, {
      apiVersion: LOCAL_JOB_API_VERSION,
      removed: false,
      cwd: result.canonicalPath,
      project: null,
      activeJobs: [],
      error: {
        code: LOCAL_JOB_API_PROJECT_NOT_REGISTERED,
        message: "Project path is not registered",
      },
    })
    return HEADLESS_EXIT_CODES.invalidCwd
  } catch (error) {
    return commandError(
      options.stderr,
      error instanceof Error ? error.message : String(error),
      apiProjectCommandErrorCode(error),
    )
  }
}

function isLocalJobApiProjectNotRegisteredError(
  error: unknown,
): error is ProjectRegistrationError {
  return (
    isProjectRegistrationError(error) &&
    error.code === LOCAL_JOB_API_PROJECT_NOT_REGISTERED
  )
}

function toLocalJobApiProjectErrorEnvelope(error: ProjectRegistrationError) {
  return {
    apiVersion: LOCAL_JOB_API_VERSION,
    error: {
      code: error.code,
      message: error.message,
      cwd: error.cwd,
      projectId: error.projectId,
    },
  }
}

function toLocalJobApiProviderErrorEnvelope(
  error: HeadlessProviderBindingError,
) {
  return {
    apiVersion: LOCAL_JOB_API_VERSION,
    error: {
      code: error.code,
      message: error.message,
      source: error.source,
      profileId: error.profileId,
    },
  }
}

function localJobApiCreateErrorCode(error: unknown): number {
  if (isProjectRegistrationError(error)) return HEADLESS_EXIT_CODES.invalidCwd
  if (error instanceof HeadlessProviderBindingError) {
    if (isLocalOnlyHeadlessProviderBindingCode(error.code)) {
      return HEADLESS_EXIT_CODES.localOnlyBlocked
    }
    if (isInvalidHeadlessProviderBindingRequestCode(error.code)) {
      return HEADLESS_EXIT_CODES.invalidArguments
    }
    if (isUnavailableHeadlessProviderBindingCode(error.code)) {
      return HEADLESS_EXIT_CODES.missingCredentials
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  if (/unsupported/i.test(message)) {
    return HEADLESS_EXIT_CODES.unsupportedRuntimeOrMode
  }
  return HEADLESS_EXIT_CODES.invalidArguments
}

function apiRunsStatusCommand(
  command: Extract<HeadlessCliCommand, { kind: "api-runs-status" }>,
  options: RunHeadlessCliCommandOptions,
): number {
  try {
    const job = getLocalJobApiJobOrThrow(options.db, command.jobId)
    const execution = observeRunExecution(options.db, job, {
      lockPath: options.daemonLockPath,
    })
    writeJson(
      options.stdout,
      execution
        ? { ...toLocalJobApiJobEnvelope(job), execution }
        : toLocalJobApiJobEnvelope(job),
    )
    return HEADLESS_EXIT_CODES.success
  } catch (error) {
    return commandError(
      options.stderr,
      error instanceof Error ? error.message : String(error),
      HEADLESS_EXIT_CODES.unsupportedRuntimeOrMode,
    )
  }
}

function apiRunsResultCommand(
  command: Extract<HeadlessCliCommand, { kind: "api-runs-result" }>,
  options: RunHeadlessCliCommandOptions,
): number {
  try {
    const job = getLocalJobApiJobOrThrow(options.db, command.jobId)
    writeJson(
      options.stdout,
      toLocalJobApiResultEnvelope(
        job,
        undefined,
        listAgentJobEvents(options.db, job.id),
      ),
    )
    return HEADLESS_EXIT_CODES.success
  } catch (error) {
    return commandError(
      options.stderr,
      error instanceof Error ? error.message : String(error),
      HEADLESS_EXIT_CODES.unsupportedRuntimeOrMode,
    )
  }
}

async function apiRunsEventsCommand(
  command: Extract<HeadlessCliCommand, { kind: "api-runs-events" }>,
  options: RunHeadlessCliCommandOptions,
): Promise<number> {
  try {
    let afterSequence = command.afterSequence
    do {
      const events = getLocalJobApiEvents(
        options.db,
        command.jobId,
        afterSequence,
      )
      for (const event of events) {
        afterSequence = event.sequence
        writeJson(options.stdout, event)
      }
      if (!command.follow) break
      const job = getLocalJobApiJobOrThrow(options.db, command.jobId)
      if (isTerminalAgentJobStatus(job.status as AgentJobStatus)) break
      await new Promise((resolve) => setTimeout(resolve, 1000))
    } while (command.follow)
    return HEADLESS_EXIT_CODES.success
  } catch (error) {
    return commandError(
      options.stderr,
      error instanceof Error ? error.message : String(error),
      HEADLESS_EXIT_CODES.unsupportedRuntimeOrMode,
    )
  }
}

async function apiRunsCancelCommand(
  command: Extract<HeadlessCliCommand, { kind: "api-runs-cancel" }>,
  options: RunHeadlessCliCommandOptions,
): Promise<number> {
  try {
    const job = getLocalJobApiJobOrThrow(options.db, command.jobId)
    const updated = await cancelAgentJob(options.db, job.id, {
      requestedBy: "api",
      queuedCancelFields: PRE_START_CANCEL_FIELDS,
      queuedTerminalProjection: queuedCancelTerminalProjection(options.db),
    })
    writeJson(options.stdout, toLocalJobApiJobEnvelope(updated))
    return HEADLESS_EXIT_CODES.success
  } catch (error) {
    return commandError(
      options.stderr,
      error instanceof Error ? error.message : String(error),
      HEADLESS_EXIT_CODES.unsupportedRuntimeOrMode,
    )
  }
}

async function apiRunsRetryCommand(
  command: Extract<HeadlessCliCommand, { kind: "api-runs-retry" }>,
  options: RunHeadlessCliCommandOptions,
): Promise<number> {
  let source: AgentJob
  let idempotencyKey: string | null = null
  try {
    source = getLocalJobApiJobOrThrow(options.db, command.jobId)
    if (command.requestPath !== null) {
      let retryRequest: ReturnType<typeof parseLocalJobApiRetryRequestJson>
      try {
        retryRequest = parseLocalJobApiRetryRequestJson(
          await readApiRequestContent(command.requestPath, options),
        )
      } catch (error) {
        if (isLocalJobApiRequestError(error)) throw error
        return commandError(
          options.stderr,
          error instanceof Error ? error.message : String(error),
          HEADLESS_EXIT_CODES.invalidArguments,
        )
      }
      if (retryRequest.consumer.id !== source.apiConsumerId) {
        throw new LocalJobApiRequestError(
          "consumer_mismatch",
          "consumer.id does not match the source job consumer.",
        )
      }
      idempotencyKey = retryRequest.idempotencyKey
    }
  } catch (error) {
    return apiRetryError(error, options)
  }
  const admit = () =>
    submitRun(
      options.db,
      { kind: "api-retry", source, idempotencyKey },
      { appVersion: options.appVersion },
    )
  if (!command.async) {
    return admitUnderWrapperRelay(
      options,
      command.requestPath !== "-",
      admit,
      apiRetryError,
    )
  }
  let admitted: SubmitRunResult
  try {
    admitted = await admit()
  } catch (error) {
    return apiRetryError(error, options)
  }
  writeJson(
    options.stdout,
    admissionEnvelope(admitted, idempotencyKey !== null),
  )
  return HEADLESS_EXIT_CODES.success
}

function scheduleErrorCode(message: string): number {
  if (/cwd|project path|registered project/i.test(message)) {
    return HEADLESS_EXIT_CODES.invalidCwd
  }
  if (/Unsupported/.test(message))
    return HEADLESS_EXIT_CODES.unsupportedRuntimeOrMode
  return HEADLESS_EXIT_CODES.invalidArguments
}

function schedulesListCommand(
  command: Extract<HeadlessCliCommand, { kind: "schedules-list" }>,
  options: RunHeadlessCliCommandOptions,
): number {
  const schedules = listAgentSchedules(options.db, {
    includeDisabled: command.includeDisabled,
    status: command.status ?? undefined,
    limit: 100,
  })
  if (shouldUseJson(command.output)) {
    writeJson(options.stdout, {
      schedules: schedules.map(serializeAgentSchedule),
    })
    return HEADLESS_EXIT_CODES.success
  }
  write(options.stdout, formatScheduleListText(schedules))
  return HEADLESS_EXIT_CODES.success
}

function schedulesCreateCommand(
  command: Extract<HeadlessCliCommand, { kind: "schedules-create" }>,
  options: RunHeadlessCliCommandOptions,
): number {
  try {
    const schedule = createAgentSchedule(options.db, {
      name: command.name,
      cwd: command.cwd,
      runtime: command.runtime,
      mode: command.mode,
      prompt: command.prompt,
      intervalSeconds: command.intervalSeconds,
      providerProfileId: command.providerProfileId,
      modelOverride: command.model,
      now: options.now,
    })
    outputSchedule(options.stdout, command.output, schedule)
    return HEADLESS_EXIT_CODES.success
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return commandError(options.stderr, message, scheduleErrorCode(message))
  }
}

async function schedulesMutationCommand(
  command: Extract<
    HeadlessCliCommand,
    {
      kind:
        | "schedules-pause"
        | "schedules-resume"
        | "schedules-delete"
        | "schedules-run"
    }
  >,
  options: RunHeadlessCliCommandOptions,
): Promise<number> {
  try {
    if (command.kind === "schedules-run") {
      const fired = await runAgentScheduleNow(
        options.db,
        command.scheduleId,
        options.now,
      )
      if (shouldUseJson(command.output)) {
        writeJson(options.stdout, {
          schedule: serializeAgentSchedule(fired.schedule),
          job: serializeAgentJob(fired.job),
        })
      } else {
        write(options.stdout, formatScheduleText(fired.schedule))
        write(options.stdout, formatJobText(fired.job))
      }
      return HEADLESS_EXIT_CODES.success
    }

    const schedule =
      command.kind === "schedules-pause"
        ? pauseAgentSchedule(options.db, command.scheduleId, options.now)
        : command.kind === "schedules-resume"
          ? resumeAgentSchedule(options.db, command.scheduleId, options.now)
          : deleteAgentSchedule(options.db, command.scheduleId, options.now)
    outputSchedule(options.stdout, command.output, schedule)
    return HEADLESS_EXIT_CODES.success
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return commandError(options.stderr, message, scheduleErrorCode(message))
  }
}

async function daemonRunCommand(
  command: Extract<HeadlessCliCommand, { kind: "daemon-run" }>,
  options: RunHeadlessCliCommandOptions,
): Promise<number> {
  const abortController = new AbortController()
  const abort = () => abortController.abort()
  if (!command.once) {
    process.once("SIGINT", abort)
    process.once("SIGTERM", abort)
  }

  try {
    const result = await runLocalAgentDaemon({
      db: options.db,
      env: options.env,
      runner: options.runner,
      stderr: options.stderr,
      concurrency: command.concurrency,
      pollIntervalMs: command.pollIntervalMs,
      once: command.once,
      lockPath: options.daemonLockPath,
      signal: abortController.signal,
      now: options.now,
      completionFetch: options.completionFetch,
      providerBindingDependencies: options.providerBindingDependencies,
      appVersion: options.appVersion,
    })
    if (shouldUseJson(command.output)) {
      writeJson(options.stdout, { daemon: result })
    } else {
      writeLine(
        options.stdout,
        `daemon stopped (${result.stoppedBy}); scheduled=${result.scheduledJobs} started=${result.startedJobs} completed=${result.completedJobs} failed=${result.failedJobs} interrupted=${result.interruptedJobs}`,
      )
    }
    return HEADLESS_EXIT_CODES.success
  } catch (error) {
    return commandError(
      options.stderr,
      error instanceof Error ? error.message : String(error),
      HEADLESS_EXIT_CODES.internalFailure,
    )
  } finally {
    process.removeListener("SIGINT", abort)
    process.removeListener("SIGTERM", abort)
  }
}

async function jobsStdioCommand(
  options: RunHeadlessCliCommandOptions,
): Promise<number> {
  return runJobsStdioServer({
    db: options.db,
    stdin: options.stdin,
    stdout: options.stdout,
    stderr: options.stderr,
    env: options.env,
    runner: options.runner,
  })
}

function versionCommand(options: RunHeadlessCliCommandOptions): number {
  writeLine(options.stdout, options.appVersion?.trim() || "unknown")
  return HEADLESS_EXIT_CODES.success
}

function helpCommand(options: RunHeadlessCliCommandOptions): number {
  write(
    options.stdout,
    [
      "Usage:",
      "  locus run --runtime claude-code|codex --prompt <text> [--cwd <path>] [--mode plan|agent] [--provider-profile <id>] [--model <model>] [--output text|json|stream-json]",
      "  locus run --stdin [--prompt <prefix>]",
      "  locus run --daemon [--follow] --prompt <text>",
      "  locus daemon run [--concurrency <n>] [--poll-interval-ms <ms>]",
      "  locus schedules list [--status enabled|paused|disabled] [--include-disabled]",
      "  locus schedules create --name <name> --prompt <text> --interval-seconds <n> [--cwd <path>] [--runtime claude-code|codex] [--mode plan|agent] [--provider-profile <id>] [--model <model>]",
      "  locus schedules pause|resume|delete|run <id>",
      "  locus api runtimes list --json [--no-probe]",
      "  locus api projects register --cwd <path> [--name <name>] --json",
      "  locus api projects status --cwd <path> --json",
      "  locus api projects unregister --cwd <path> [--force] --json",
      "  locus api runs submit --request <path|-> --json",
      "  locus api runs create --request <path|-> --json",
      "  locus api runs wait <id> [--timeout <milliseconds>] --json",
      "  locus api runs retry <id> [--request <path|->] [--async] --json",
      "  locus api runs status|result|cancel <id> --json",
      "  locus api runs events <id> [--after <sequence>] [--follow] --jsonl",
      "  locus jobs-stdio",
      "  locus --version",
      `  stdin limit: ${HEADLESS_STDIN_MAX_BYTES} bytes`,
      "  locus jobs list",
      "  locus jobs show <id>",
      "  locus jobs logs <id> [--follow]",
      "  locus jobs cancel <id>",
      "  locus jobs retry <id>",
      "",
    ].join("\n"),
  )
  return 0
}

export async function runHeadlessCliCommand(
  options: RunHeadlessCliCommandOptions,
): Promise<number> {
  const parsed = parseHeadlessCliArgv(options.argv)
  if (!parsed.ok) {
    return commandError(options.stderr, parsed.message, parsed.code)
  }

  if (
    parsed.command.kind !== "daemon-run" &&
    parsed.command.kind !== "version"
  ) {
    await recoverStaleAgentJobs(options.db, options.now, {
      onDiagnostic: (diagnostic) =>
        writeLine(options.stderr, diagnostic.message),
    })
  }

  switch (parsed.command.kind) {
    case "run":
      return runCommand(parsed.command, options)
    case "jobs-list":
      return listCommand(parsed.command, options)
    case "jobs-show":
      return showCommand(parsed.command, options)
    case "jobs-logs":
      return logsCommand(parsed.command, options)
    case "jobs-cancel":
      return cancelCommand(parsed.command, options)
    case "jobs-retry":
      return retryCommand(parsed.command, options)
    case "api-runtimes-list":
      return apiRuntimesListCommand(parsed.command, options)
    case "api-projects-register":
      return apiProjectsRegisterCommand(parsed.command, options)
    case "api-projects-status":
      return apiProjectsStatusCommand(parsed.command, options)
    case "api-projects-unregister":
      return apiProjectsUnregisterCommand(parsed.command, options)
    case "api-runs-submit":
      return apiRunsSubmitCommand(parsed.command, options)
    case "api-runs-create":
      return apiRunsCreateCommand(parsed.command, options)
    case "api-runs-wait":
      return apiRunsWaitCommand(parsed.command, options)
    case "api-runs-status":
      return apiRunsStatusCommand(parsed.command, options)
    case "api-runs-events":
      return apiRunsEventsCommand(parsed.command, options)
    case "api-runs-result":
      return apiRunsResultCommand(parsed.command, options)
    case "api-runs-cancel":
      return apiRunsCancelCommand(parsed.command, options)
    case "api-runs-retry":
      return apiRunsRetryCommand(parsed.command, options)
    case "schedules-list":
      return schedulesListCommand(parsed.command, options)
    case "schedules-create":
      return schedulesCreateCommand(parsed.command, options)
    case "schedules-pause":
    case "schedules-resume":
    case "schedules-delete":
    case "schedules-run":
      return schedulesMutationCommand(parsed.command, options)
    case "jobs-stdio":
      return jobsStdioCommand(options)
    case "version":
      return versionCommand(options)
    case "daemon-run":
      return daemonRunCommand(parsed.command, options)
    case "help":
      return helpCommand(options)
  }
}
