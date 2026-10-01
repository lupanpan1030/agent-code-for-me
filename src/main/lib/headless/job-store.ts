import { and, asc, desc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm"
import type { drizzle } from "drizzle-orm/better-sqlite3"
import {
  AGENT_JOB_EVENT_TYPES,
  AGENT_JOB_KINDS,
  AGENT_JOB_MODES,
  AGENT_JOB_SOURCES,
  AGENT_JOB_STATUSES,
  type AgentJobEventType,
  type AgentJobKind,
  type AgentJobMode,
  type AgentJobRuntime,
  type AgentJobSource,
  type AgentJobStatus,
  isTerminalAgentJobStatus,
} from "../../../shared/agent-jobs"
import {
  AGENT_RUNTIME_IDS,
  CONTRACT_RUNTIME_IDS,
} from "../../../shared/agent-runtime-capabilities"
import { redactExactSecretHints } from "../agent-runtime/redaction"
import type {
  SettleOptions,
  TerminalJobFields,
} from "../agent-runtime/run-event-ledger"
import {
  getOrCreateRunEventLedger,
  recordVerifiedRunRetention,
  releaseRunEventLedger,
} from "../agent-runtime/run-event-ledger-host"
import type {
  CommittedRunEvent,
  JsonValue,
  RunEvent,
} from "../agent-runtime/runtime-events"
import type * as schema from "../db/schema"
import {
  type AgentJob,
  type AgentJobEvent,
  type AgentJobIdempotencyReservation,
  agentJobEvents,
  agentJobIdempotency,
  agentJobProjectionCursors,
  agentJobs,
} from "../db/schema"
import { createId } from "../db/utils"

export type AgentJobDatabase = ReturnType<typeof drizzle<typeof schema>>

export type CreateAgentJobInput = {
  id?: string
  kind?: AgentJobKind
  source: AgentJobSource
  runtime: AgentJobRuntime
  mode: AgentJobMode
  cwd: string
  prompt: string
  input?: unknown
  projectId?: string | null
  chatId?: string | null
  subChatId?: string | null
  apiConsumerId?: string | null
  apiConsumerRunId?: string | null
  artifactBaseDir?: string | null
  artifactManifestPath?: string | null
  providerProfileId?: string | null
  modelOverride?: string | null
  createdByVersion?: string | null
}

/**
 * Idempotency reservation inserted in the same SQLite transaction as the job
 * row (add-local-job-api-async-submit D4). Only the domain-separated key hash
 * is stored; the raw key never reaches this store.
 */
export type AgentJobIdempotencyReservationInput = {
  consumerId: string
  keyHash: string
  requestHash: string
  normalizationVersion: number
}

export type AgentJobInsertOptions = {
  reservation?: AgentJobIdempotencyReservationInput | null
}

/**
 * The (consumer, key hash) reservation already exists: a concurrent or prior
 * submission won the unique constraint. Nothing of this attempt committed.
 */
export class AgentJobIdempotencyReservationExistsError extends Error {
  readonly code = "IDEMPOTENCY_RESERVATION_EXISTS"

  constructor() {
    super("IDEMPOTENCY_RESERVATION_EXISTS: the idempotency key is reserved")
    this.name = "AgentJobIdempotencyReservationExistsError"
  }
}

export type StartAgentJobInput = {
  jobId: string
  workerId: string
  workerPid?: number | null
  now?: Date
}

export type CancelAgentJobInput = {
  requestedBy: string
  /**
   * Job-row result fields for a queued job the ledger settles canceled before
   * it started (the caller's existing exit metadata).
   */
  queuedCancelFields?: TerminalJobFields
  /**
   * Composes the terminal projection of a queued Run whose initial
   * admission is complete (design D5 trigger table): the same terminal
   * preparer the worker registers, from the Run's persistent input and its
   * reopened run directory. `null` registers no terminal refs.
   */
  queuedTerminalProjection?: (
    job: AgentJob,
  ) => QueuedCancelTerminalProjection | null
}

/** A queued cancel's registered terminal preparer and its run-dir handle. */
export type QueuedCancelTerminalProjection = {
  terminalArtifacts: NonNullable<SettleOptions["terminalArtifacts"]>
  close: () => void
}

export type ListAgentJobsInput = {
  limit?: number
  status?: AgentJobStatus
  source?: AgentJobSource
  projectOnly?: boolean
}

export type RetryAgentJobOptions =
  | Date
  | {
      now?: Date
      id?: string
      /** Replacement stored input of the new attempt (default: the source's). */
      input?: unknown
      artifactBaseDir?: string | null
      artifactManifestPath?: string | null
      reservation?: AgentJobIdempotencyReservationInput | null
    }

const MAX_PROMPT_PREVIEW_LENGTH = 240

export type AgentJobStoreExecutor = Pick<
  AgentJobDatabase,
  "select" | "insert" | "update"
>
type AgentJobTransaction = Parameters<
  Parameters<AgentJobDatabase["transaction"]>[0]
>[0]

function assertOneOf<T extends readonly string[]>(
  values: T,
  value: string,
  label: string,
): asserts value is T[number] {
  if (!(values as readonly string[]).includes(value)) {
    throw new Error(`Unsupported ${label}: ${value}`)
  }
}

function assertCreateAgentJobRuntime(input: CreateAgentJobInput): void {
  const values =
    input.source === "desktop" ? AGENT_RUNTIME_IDS : CONTRACT_RUNTIME_IDS
  assertOneOf(values, input.runtime, "job runtime")
}

function redactSecretText(
  value: string,
  secretHints?: readonly string[],
): string {
  return redactExactSecretHints(value, secretHints)
    .value.replace(
      /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g,
      "[redacted-pem]",
    )
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "[redacted]")
    .replace(/gh[pousr]_[A-Za-z0-9_]{20,}/g, "[redacted]")
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, "[redacted]")
    .replace(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      "[redacted-jwt]",
    )
    .replace(
      /(authorization\s*:\s*basic\s+)[A-Za-z0-9+/=_-]+/gi,
      "$1[redacted]",
    )
    .replace(/bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(
      /((?:access_token|refresh_token|id_token|anthropic_auth_token|openai_api_key|codex_api_key|github_token|npm_token|aws_secret_access_key|aws_session_token|api[-_]?key|secret|password)["'=:\s]+)["']?[^\s"',;]+/gi,
      "$1[redacted]",
    )
    .replace(
      /([?&](?:code|access_token|refresh_token|id_token|token)=)[^&#\s]+/gi,
      "$1[redacted]",
    )
}

const SAFE_TOKEN_COUNT_KEYS = new Set([
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "cacheReadInputTokens",
  "cacheCreationInputTokens",
])

function isSensitiveStorageKey(key: string, value: unknown): boolean {
  if (SAFE_TOKEN_COUNT_KEYS.has(key) && typeof value === "number") {
    return false
  }
  return /token|authorization|api[-_]?key|secret|password/i.test(key)
}

function sanitizeForStorage(
  value: unknown,
  secretHints?: readonly string[],
): unknown {
  if (typeof value === "string") return redactSecretText(value, secretHints)
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForStorage(item, secretHints))
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (
          isSensitiveStorageKey(key, item) &&
          item !== null &&
          item !== undefined
        ) {
          return [key, "[redacted]"]
        }
        return [key, sanitizeForStorage(item, secretHints)]
      }),
    )
  }
  return value
}

function toJson(value: unknown, secretHints?: readonly string[]): string {
  return JSON.stringify(
    sanitizeForStorage(value === undefined ? {} : value, secretHints),
  )
}

function fromJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function promptPreview(prompt: string): string {
  const redacted = redactSecretText(prompt)
  const compact = redacted.replace(/\s+/g, " ").trim()
  return compact.length > MAX_PROMPT_PREVIEW_LENGTH
    ? `${compact.slice(0, MAX_PROMPT_PREVIEW_LENGTH - 1)}...`
    : compact
}

function getJobFromExecutor(
  executor: AgentJobStoreExecutor,
  jobId: string,
): AgentJob | null {
  return (
    (executor as AgentJobDatabase)
      .select()
      .from(agentJobs)
      .where(eq(agentJobs.id, jobId))
      .get() ?? null
  )
}

function isReservationUniqueViolation(error: unknown): boolean {
  const text = String(
    error instanceof Error
      ? `${error.message} ${String(error.cause ?? "")}`
      : error,
  )
  return /UNIQUE constraint failed: agent_job_idempotency/i.test(text)
}

/**
 * Row construction of a new queued job from a creation input (the one place
 * that turns create input into `agent_jobs` values).
 */
function queuedAgentJobValues(
  input: CreateAgentJobInput,
  id: string,
  now: Date,
): typeof agentJobs.$inferInsert & { id: string } {
  assertOneOf(AGENT_JOB_SOURCES, input.source, "job source")
  assertOneOf(AGENT_JOB_KINDS, input.kind ?? "agent", "job kind")
  assertCreateAgentJobRuntime(input)
  assertOneOf(AGENT_JOB_MODES, input.mode, "job mode")
  return {
    id,
    kind: input.kind ?? "agent",
    source: input.source,
    runtime: input.runtime,
    status: "queued",
    mode: input.mode,
    cwd: input.cwd,
    promptPreview: promptPreview(input.prompt),
    inputJson:
      input.input === undefined
        ? toJson({ prompt: input.prompt })
        : toJson(input.input),
    projectId: input.projectId ?? null,
    chatId: input.chatId ?? null,
    subChatId: input.subChatId ?? null,
    apiConsumerId: input.apiConsumerId
      ? redactSecretText(input.apiConsumerId)
      : null,
    apiConsumerRunId: input.apiConsumerRunId
      ? redactSecretText(input.apiConsumerRunId)
      : null,
    artifactBaseDir: input.artifactBaseDir
      ? redactSecretText(input.artifactBaseDir)
      : null,
    artifactManifestPath: input.artifactManifestPath
      ? redactSecretText(input.artifactManifestPath)
      : null,
    providerProfileId: input.providerProfileId
      ? redactSecretText(input.providerProfileId)
      : null,
    modelOverride: input.modelOverride
      ? redactSecretText(input.modelOverride)
      : null,
    createdByVersion: input.createdByVersion ?? null,
    createdAt: now,
  }
}

/** The only `agent_jobs` row insert (add-local-job-api-async-submit D1). */
function insertAgentJobRow(
  executor: AgentJobStoreExecutor,
  values: typeof agentJobs.$inferInsert & { id: string },
): void {
  ;(executor as AgentJobDatabase).insert(agentJobs).values(values).run()
}

/**
 * Shared insertion primitive for a caller that owns its own transaction
 * (schedule fire/audit/nextRunAt): inserts the queued job row inside the
 * caller's executor and returns it. The caller records `job_created`
 * through `recordAgentJobCreated` after its transaction commits.
 */
export function insertQueuedAgentJobRecord(
  executor: AgentJobStoreExecutor,
  input: CreateAgentJobInput & { createdAt?: Date },
): AgentJob {
  const id = input.id ?? createId()
  insertAgentJobRow(
    executor,
    queuedAgentJobValues(input, id, input.createdAt ?? new Date()),
  )
  const job = getJobFromExecutor(executor, id)
  if (!job) throw new Error(`Failed to create job ${id}`)
  return job
}

/**
 * Private insertion primitive of every queued job row: the row and its
 * optional idempotency reservation commit in one SQLite transaction, so a
 * reservation never names an uncommitted job and a lost unique race leaves
 * nothing behind.
 */
function insertQueuedAgentJobRow(
  db: AgentJobDatabase,
  values: typeof agentJobs.$inferInsert & { id: string },
  reservation: AgentJobIdempotencyReservationInput | null | undefined,
  now: Date,
): void {
  try {
    db.transaction((tx: AgentJobTransaction) => {
      insertAgentJobRow(tx, values)
      if (reservation) {
        tx.insert(agentJobIdempotency)
          .values({
            id: createId(),
            consumerId: reservation.consumerId,
            keyHash: reservation.keyHash,
            jobId: values.id,
            requestHash: reservation.requestHash,
            normalizationVersion: reservation.normalizationVersion,
            createdAt: now,
            expiresAt: null,
          })
          .run()
      }
    })
  } catch (error) {
    if (reservation && isReservationUniqueViolation(error)) {
      throw new AgentJobIdempotencyReservationExistsError()
    }
    throw error
  }
}

/**
 * Lifecycle service: inserts the queued job row (and its optional
 * idempotency reservation, in the same transaction), then records
 * `job_created` through the job's host ledger (pending provenance,
 * fact-keyed v1 record).
 */
export async function createAgentJob(
  db: AgentJobDatabase,
  input: CreateAgentJobInput,
  options: AgentJobInsertOptions = {},
): Promise<AgentJob> {
  const id = input.id ?? createId()
  const kind = input.kind ?? "agent"
  const now = new Date()
  insertQueuedAgentJobRow(
    db,
    queuedAgentJobValues(input, id, now),
    options.reservation,
    now,
  )

  const job = getAgentJob(db, id)
  if (!job) throw new Error(`Failed to create job ${id}`)
  await recordAgentJobCreatedOrDiscard(db, job, {
    kind,
    source: input.source,
    runtime: input.runtime,
    mode: input.mode,
    cwd: input.cwd,
  })
  return getAgentJob(db, id) ?? job
}

/** True when the job store would alter this text before persisting it. */
export function isAgentJobStoreRedactionAltering(value: string): boolean {
  return redactSecretText(value) !== value
}

function jobCreatedObservationKey(jobId: string): string {
  return `lifecycle:job-created:${jobId}`
}

/**
 * The job row insert and its `job_created` fact are two commits (the ledger
 * ports are asynchronous over a synchronous SQLite transaction). When the
 * creation fact cannot be recorded, the just-inserted row is removed again
 * (only while it is still queued with no committed record), so a failed
 * create leaves no queued job; fact-key idempotency covers a retried create.
 */
async function recordAgentJobCreatedOrDiscard(
  db: AgentJobDatabase,
  job: AgentJob,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await recordAgentJobCreated(db, job, payload)
  } catch (error) {
    try {
      db.transaction((tx: AgentJobTransaction) => {
        const recorded = tx
          .select({ id: agentJobEvents.id })
          .from(agentJobEvents)
          .where(eq(agentJobEvents.jobId, job.id))
          .limit(1)
          .all()
        if (recorded.length > 0) return
        // The same compensation releases the idempotency reservation (the
        // FK cascade covers it too); nothing else deletes reservations of a
        // job that never committed its creation fact.
        tx.delete(agentJobIdempotency)
          .where(eq(agentJobIdempotency.jobId, job.id))
          .run()
        tx.delete(agentJobs)
          .where(and(eq(agentJobs.id, job.id), eq(agentJobs.status, "queued")))
          .run()
      })
    } catch {
      // The row stays an orphan; startAgentJob never runs it.
    }
    throw error
  }
}

/** Exact fact key of a job's one committed creation fact (design D3). */
function jobCreatedFactKey(jobId: string): string {
  return `${jobCreatedObservationKey(jobId)}:0`
}

/**
 * Fact key of the first `artifact_created` of the one initial run-dir
 * admission batch (run-artifacts admits it under
 * `lifecycle:initial-artifacts:<jobId>`; design D3).
 */
function initialArtifactsFactKey(jobId: string): string {
  return `lifecycle:initial-artifacts:${jobId}:0`
}

/**
 * The D3 creation predicate shared by queue listing and claim: the exact
 * committed `job_created` fact and, for a job with an artifact manifest
 * path, the exact committed initial `artifact_created` admission.
 */
function admittedForClaimSql() {
  return sql`exists (select 1 from ${agentJobEvents} where ${agentJobEvents.jobId} = ${agentJobs.id} and ${agentJobEvents.type} = 'job_created' and ${agentJobEvents.factKey} = 'lifecycle:job-created:' || ${agentJobs.id} || ':0') and (${agentJobs.artifactManifestPath} is null or exists (select 1 from ${agentJobEvents} where ${agentJobEvents.jobId} = ${agentJobs.id} and ${agentJobEvents.type} = 'artifact_created' and ${agentJobEvents.factKey} = 'lifecycle:initial-artifacts:' || ${agentJobs.id} || ':0'))`
}

function hasCommittedFact(
  db: AgentJobDatabase,
  jobId: string,
  type: AgentJobEventType,
  factKey: string,
): boolean {
  return (
    db
      .select({ id: agentJobEvents.id })
      .from(agentJobEvents)
      .where(
        and(
          eq(agentJobEvents.jobId, jobId),
          eq(agentJobEvents.type, type),
          eq(agentJobEvents.factKey, factKey),
        ),
      )
      .limit(1)
      .all().length > 0
  )
}

/** True once the job's exact `job_created` fact is committed. */
function hasCommittedJobCreated(db: AgentJobDatabase, jobId: string): boolean {
  return hasCommittedFact(db, jobId, "job_created", jobCreatedFactKey(jobId))
}

/**
 * Admission state of a ledger job (design D3): `creation_missing` (the row
 * committed without its creation fact: an orphan that is never claimed),
 * `admission_missing` (an artifact-bearing job whose initial admission did
 * not commit) or `admitted`.
 */
export type AgentJobAdmissionState =
  | "creation_missing"
  | "admission_missing"
  | "admitted"

export function readAgentJobAdmissionState(
  db: AgentJobDatabase,
  job: Pick<AgentJob, "id" | "artifactManifestPath">,
): AgentJobAdmissionState {
  if (!hasCommittedJobCreated(db, job.id)) return "creation_missing"
  if (
    job.artifactManifestPath !== null &&
    !hasCommittedFact(
      db,
      job.id,
      "artifact_created",
      initialArtifactsFactKey(job.id),
    )
  ) {
    return "admission_missing"
  }
  return "admitted"
}

/**
 * Records `job_created` of an existing queued job row through its host
 * ledger (lifecycle services that mint the row in their own transaction,
 * e.g. schedules, call this after that transaction commits).
 */
export async function recordAgentJobCreated(
  db: AgentJobDatabase,
  job: AgentJob,
  payload: Record<string, unknown>,
): Promise<void> {
  const ledger = await getOrCreateRunEventLedger(db, job)
  try {
    await ledger.appendSystemEvent({
      observationKey: jobCreatedObservationKey(job.id),
      type: "job_created",
      payload,
      occurredAt: job.createdAt ?? undefined,
    })
  } finally {
    // A queued job is not hosted here until a worker claims it; the host
    // recomposes its ledger from committed records when it does.
    releaseRunEventLedger(db, job.id)
  }
}

export function getAgentJob(
  db: AgentJobDatabase,
  jobId: string,
): AgentJob | null {
  return (
    db.select().from(agentJobs).where(eq(agentJobs.id, jobId)).get() ?? null
  )
}

export function listAgentJobs(
  db: AgentJobDatabase,
  input: ListAgentJobsInput = {},
): AgentJob[] {
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200))
  const whereClauses = [
    input.status ? eq(agentJobs.status, input.status) : undefined,
    input.source ? eq(agentJobs.source, input.source) : undefined,
    input.projectOnly ? isNotNull(agentJobs.projectId) : undefined,
  ].filter(Boolean)
  const whereClause =
    whereClauses.length === 0
      ? undefined
      : whereClauses.length === 1
        ? whereClauses[0]
        : and(...whereClauses)

  if (whereClause) {
    return db
      .select()
      .from(agentJobs)
      .where(whereClause)
      .orderBy(desc(agentJobs.createdAt))
      .limit(limit)
      .all()
  }
  return db
    .select()
    .from(agentJobs)
    .orderBy(desc(agentJobs.createdAt))
    .limit(limit)
    .all()
}

export function listQueuedAgentJobsForSource(
  db: AgentJobDatabase,
  source: AgentJobSource,
  limit: number,
): AgentJob[] {
  const boundedLimit = Math.max(1, Math.min(limit, 200))
  // Pre-ledger (ledger_version=0) rows drain with the old build; the ledger
  // never starts or extends them. A queued row whose exact creation fact (or
  // required initial admission) never committed is not work either:
  // startAgentJob applies the same predicate.
  return db
    .select()
    .from(agentJobs)
    .where(
      and(
        eq(agentJobs.source, source),
        eq(agentJobs.status, "queued"),
        eq(agentJobs.ledgerVersion, 1),
        admittedForClaimSql(),
      ),
    )
    .orderBy(asc(agentJobs.createdAt))
    .limit(boundedLimit)
    .all()
}

/**
 * Claimable queued jobs among the given IDs (a scoped pump's own admitted
 * Runs), with the same D3 predicate as listQueuedAgentJobsForSource.
 */
export function listQueuedAgentJobsForIds(
  db: AgentJobDatabase,
  ids: readonly string[],
  limit: number,
): AgentJob[] {
  if (ids.length === 0) return []
  const boundedLimit = Math.max(1, Math.min(limit, 200))
  return db
    .select()
    .from(agentJobs)
    .where(
      and(
        inArray(agentJobs.id, [...ids]),
        eq(agentJobs.status, "queued"),
        eq(agentJobs.ledgerVersion, 1),
        admittedForClaimSql(),
      ),
    )
    .orderBy(asc(agentJobs.createdAt))
    .limit(boundedLimit)
    .all()
}

export function getAgentJobPrompt(db: AgentJobDatabase, jobId: string): string {
  const job = getAgentJob(db, jobId)
  if (!job) throw new Error(`Unknown job: ${jobId}`)
  const input = fromJson<{ prompt?: unknown }>(job.inputJson, {})
  return typeof input.prompt === "string" ? input.prompt : ""
}

/**
 * A claim that lost to another claimant or a settlement (the job is no
 * longer queued): the caller never owned the Run.
 */
export const AGENT_JOB_CLAIM_LOST = "CLAIM_LOST"

function claimLost(error: Error): Error {
  return Object.assign(error, { code: AGENT_JOB_CLAIM_LOST })
}

export function isAgentJobClaimLostError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === AGENT_JOB_CLAIM_LOST
  )
}

/**
 * Worker claim: records `job_started` through the job's host ledger, which
 * commits the running job-row fields in the same transaction and rejects a
 * claim that is no longer queued (e.g. canceled first by another process).
 */
export async function startAgentJob(
  db: AgentJobDatabase,
  input: StartAgentJobInput,
): Promise<AgentJob> {
  const job = getAgentJob(db, input.jobId)
  if (!job) throw new Error(`Unknown job: ${input.jobId}`)
  if (isTerminalAgentJobStatus(job.status as AgentJobStatus)) {
    throw claimLost(
      new Error(`Job ${job.id} is already terminal: ${job.status}`),
    )
  }
  if (job.status !== "queued") {
    throw claimLost(
      new Error(`Job ${job.id} cannot start from status ${job.status}`),
    )
  }
  if (job.ledgerVersion === 1) {
    const admission = readAgentJobAdmissionState(db, job)
    if (admission === "creation_missing") {
      // An orphan row whose creation fact never committed is never executed:
      // job_started would otherwise open its Run at sequence 1.
      throw Object.assign(
        new Error(
          `MISSING_JOB_CREATED: job ${job.id} has no committed job_created fact and cannot start`,
        ),
        { code: "MISSING_JOB_CREATED" },
      )
    }
    if (admission === "admission_missing") {
      throw Object.assign(
        new Error(
          `MISSING_INITIAL_ADMISSION: job ${job.id} has no committed initial artifact admission and cannot start`,
        ),
        { code: "MISSING_INITIAL_ADMISSION" },
      )
    }
  }
  const ledger = await getOrCreateRunEventLedger(db, job)
  try {
    await ledger.appendSystemEvent({
      observationKey: `lifecycle:job-started:${input.workerId}`,
      type: "job_started",
      payload: {
        workerId: input.workerId,
        workerPid: input.workerPid ?? null,
      },
      occurredAt: input.now ?? new Date(),
    })
  } catch (error) {
    const current = getAgentJob(db, input.jobId)
    if (current && current.status !== "queued") {
      if (isTerminalAgentJobStatus(current.status as AgentJobStatus)) {
        throw claimLost(
          new Error(`Job ${current.id} is already terminal: ${current.status}`),
        )
      }
      throw claimLost(
        new Error(
          `Job ${current.id} cannot start from status ${current.status}`,
        ),
      )
    }
    throw error
  }
  return getAgentJob(db, input.jobId) ?? job
}

export function listAgentJobEvents(
  db: AgentJobDatabase,
  jobId: string,
  afterSequence = 0,
): AgentJobEvent[] {
  return db
    .select()
    .from(agentJobEvents)
    .where(
      and(
        eq(agentJobEvents.jobId, jobId),
        gtSequence(agentJobEvents.sequence, afterSequence),
      ),
    )
    .orderBy(agentJobEvents.sequence)
    .all()
}

function gtSequence(column: typeof agentJobEvents.sequence, value: number) {
  return sql`${column} > ${value}`
}

export function heartbeatAgentJob(
  db: AgentJobDatabase,
  jobId: string,
  workerId: string,
  now = new Date(),
): AgentJob {
  const job = getAgentJob(db, jobId)
  if (!job) throw new Error(`Unknown job: ${jobId}`)
  if (job.status !== "running") {
    throw new Error(`Job ${job.id} cannot heartbeat from status ${job.status}`)
  }
  if (job.workerId !== workerId) {
    throw new Error(`Job ${job.id} is owned by another worker`)
  }

  db.update(agentJobs)
    .set({ heartbeatAt: now })
    .where(eq(agentJobs.id, jobId))
    .run()
  return getAgentJob(db, jobId) ?? job
}

const CANCEL_EVIDENCE = {
  policy: { denied: false, evidenceKeys: [] },
  output: { valid: false, empty: true, allowEmpty: false, evidenceKeys: [] },
  postRun: { credentialsSafe: true, evidenceKeys: [] },
}

/**
 * Host cancel evidence for an existing job: the ledger settles a queued job
 * `canceled` before it starts, or forwards the cancel request of a running
 * job (cancel_requested + cancelRequestedAt) for its worker to observe.
 * Terminal jobs are returned unchanged.
 */
export async function cancelAgentJob(
  db: AgentJobDatabase,
  jobId: string,
  input: CancelAgentJobInput,
): Promise<AgentJob> {
  const job = getAgentJob(db, jobId)
  if (!job) throw new Error(`Unknown job: ${jobId}`)
  if (isTerminalAgentJobStatus(job.status as AgentJobStatus)) return job
  // An admitted queued Run's cancel registers the worker's terminal preparer
  // (design D5); a claim/cancel loser discards only its own staging.
  const projection =
    job.status === "queued"
      ? (input.queuedTerminalProjection?.(job) ?? null)
      : null
  try {
    const ledger = await getOrCreateRunEventLedger(db, job)
    await ledger.settle(
      {
        trigger: {
          kind: "cancel",
          reason: "queued_cancel",
          observationKey: `cancel:${createId()}`,
          requestedBy: input.requestedBy,
        },
        ...CANCEL_EVIDENCE,
      },
      {
        jobFields: () => input.queuedCancelFields ?? {},
        ...(projection
          ? { terminalArtifacts: projection.terminalArtifacts }
          : {}),
      },
    )
  } finally {
    projection?.close()
  }
  const updated = getAgentJob(db, jobId) ?? job
  if (isTerminalAgentJobStatus(updated.status as AgentJobStatus)) {
    releaseRunEventLedger(db, jobId)
    // Retention starts once the registered terminal refs are verified
    // published (an empty set at the settlement) (design D4).
    recordVerifiedRunRetention(db, jobId)
  }
  return updated
}

const ADMISSION_FAILURE_EVIDENCE = {
  policy: { denied: false, evidenceKeys: [] },
  output: { valid: false, empty: true, allowEmpty: false, evidenceKeys: [] },
  postRun: { credentialsSafe: true, evidenceKeys: [] },
}

/**
 * Host settlement of a queued job whose creation fact committed but whose
 * admission could not complete (e.g. its run directory): the ledger settles
 * it `failed` without terminal refs; the attempt, its facts and its
 * reservation are kept.
 */
export async function settleQueuedAgentJobFailed(
  db: AgentJobDatabase,
  jobId: string,
  fields: { errorCode: string; errorMessage: string },
): Promise<AgentJob> {
  const job = getAgentJob(db, jobId)
  if (!job) throw new Error(`Unknown job: ${jobId}`)
  if (isTerminalAgentJobStatus(job.status as AgentJobStatus)) return job
  const ledger = await getOrCreateRunEventLedger(db, job)
  try {
    await ledger.settle(
      {
        trigger: {
          kind: "host_result",
          status: "failed",
          observationKey: `admission-failed:${jobId}`,
        },
        ...ADMISSION_FAILURE_EVIDENCE,
      },
      {
        jobFields: () => ({
          exitCode: 1,
          errorCode: fields.errorCode,
          errorMessage: fields.errorMessage,
        }),
      },
    )
  } finally {
    releaseRunEventLedger(db, jobId)
  }
  recordVerifiedRunRetention(db, jobId)
  return getAgentJob(db, jobId) ?? job
}

export async function retryAgentJob(
  db: AgentJobDatabase,
  jobId: string,
  optionsOrNow: RetryAgentJobOptions = new Date(),
): Promise<AgentJob> {
  const options =
    optionsOrNow instanceof Date ? { now: optionsOrNow } : optionsOrNow
  const now = options.now ?? new Date()
  const job = getAgentJob(db, jobId)
  if (!job) throw new Error(`Unknown job: ${jobId}`)
  if (
    job.status !== "failed" &&
    job.status !== "canceled" &&
    job.status !== "interrupted"
  ) {
    throw new Error(`Job ${job.id} cannot be retried from status ${job.status}`)
  }

  const retryId = options.id ?? createId()
  insertQueuedAgentJobRow(
    db,
    {
      id: retryId,
      retryOfJobId: job.id,
      attempt: job.attempt + 1,
      kind: job.kind,
      source: job.source,
      runtime: job.runtime,
      status: "queued",
      mode: job.mode,
      cwd: job.cwd,
      projectId: job.projectId,
      chatId: job.chatId,
      subChatId: job.subChatId,
      promptPreview: job.promptPreview,
      inputJson:
        options.input === undefined ? job.inputJson : toJson(options.input),
      apiConsumerId: job.apiConsumerId,
      apiConsumerRunId: job.apiConsumerRunId,
      artifactBaseDir:
        options.artifactBaseDir !== undefined
          ? options.artifactBaseDir
          : job.artifactBaseDir,
      artifactManifestPath: options.artifactManifestPath ?? null,
      providerProfileId: job.providerProfileId,
      modelOverride: job.modelOverride,
      createdAt: now,
      createdByVersion: job.createdByVersion,
    },
    options.reservation,
    now,
  )
  const created = getAgentJob(db, retryId)
  if (!created) throw new Error(`Failed to create retry job ${retryId}`)
  await recordAgentJobCreatedOrDiscard(db, created, {
    kind: job.kind,
    retryOfJobId: job.id,
    attempt: job.attempt + 1,
  })
  const retry = getAgentJob(db, retryId)
  if (!retry) throw new Error(`Failed to create retry job ${retryId}`)
  return retry
}

// ---------------------------------------------------------------------------
// Idempotency reservations (add-local-job-api-async-submit D4). The job row
// and its reservation are inserted together by insertQueuedAgentJobRow; the
// creation compensation deletes both. This store also owns the one-time
// retention setter and the only cleanup of expired reservations.
// ---------------------------------------------------------------------------

/** Minimum retention of a reservation after verified terminal publication. */
export const AGENT_JOB_IDEMPOTENCY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export function findAgentJobIdempotencyReservation(
  db: AgentJobDatabase,
  input: { consumerId: string; keyHash: string },
): AgentJobIdempotencyReservation | null {
  return (
    db
      .select()
      .from(agentJobIdempotency)
      .where(
        and(
          eq(agentJobIdempotency.consumerId, input.consumerId),
          eq(agentJobIdempotency.keyHash, input.keyHash),
        ),
      )
      .get() ?? null
  )
}

/** True while the job has a reservation whose expiry is not set yet. */
export function hasUnsetAgentJobIdempotencyExpiry(
  db: AgentJobDatabase,
  jobId: string,
): boolean {
  return (
    db
      .select({ id: agentJobIdempotency.id })
      .from(agentJobIdempotency)
      .where(
        and(
          eq(agentJobIdempotency.jobId, jobId),
          sql`${agentJobIdempotency.expiresAt} is null`,
        ),
      )
      .limit(1)
      .all().length > 0
  )
}

/**
 * Sets a terminal job's reservation expiry once (never extends it): called
 * by the lifecycle host after verified terminal publication, or at an
 * empty-ref settlement. A job without a reservation is a no-op.
 */
export function setAgentJobIdempotencyExpiry(
  db: AgentJobDatabase,
  jobId: string,
  expiresAt: Date,
): void {
  if (!hasUnsetAgentJobIdempotencyExpiry(db, jobId)) return
  db.update(agentJobIdempotency)
    .set({ expiresAt })
    .where(
      and(
        eq(agentJobIdempotency.jobId, jobId),
        sql`${agentJobIdempotency.expiresAt} is null`,
      ),
    )
    .run()
}

/**
 * Named cleanup of expired reservations: deletes only reservations whose
 * expiry is set and reached and whose job is terminal. Jobs, events and
 * run-dir files stay; NULL-expiry (nonterminal, unpublished, orphan)
 * reservations never expire automatically.
 */
export function cleanupExpiredAgentJobIdempotency(
  db: AgentJobDatabase,
  input: { now: Date; consumerId?: string | null },
): number {
  const terminal = sql`exists (select 1 from ${agentJobs} where ${agentJobs.id} = ${agentJobIdempotency.jobId} and ${agentJobs.status} in ('succeeded', 'failed', 'canceled', 'interrupted'))`
  const result = db
    .delete(agentJobIdempotency)
    .where(
      and(
        isNotNull(agentJobIdempotency.expiresAt),
        lte(agentJobIdempotency.expiresAt, input.now),
        terminal,
        input.consumerId
          ? eq(agentJobIdempotency.consumerId, input.consumerId)
          : undefined,
      ),
    )
    .run() as { changes?: number }
  return result.changes ?? 0
}

// ---------------------------------------------------------------------------
// Canonical run event ledger store (refactor-canonical-run-event-ledger).
//
// The ledger allocates dense sequences and fact keys; this store validates and
// commits an exact batch atomically, never re-sequences and never redacts or
// constructs events. Its only importer is agent-runtime/run-event-ledger-host.
// ---------------------------------------------------------------------------

/** `factKey` is stored verbatim (never hashed); metadata stays off payload. */
export type ExactRunEventRecord = CommittedRunEvent

type ExactRunEventTimestamp = Date | string | number | null

/** Job-row fields a ledger batch may change together with its records. */
export type ExactRunEventJobMutation = {
  status?: AgentJobStatus
  workerId?: string | null
  workerPid?: number | null
  workerStartedAt?: ExactRunEventTimestamp
  startedAt?: ExactRunEventTimestamp
  finishedAt?: ExactRunEventTimestamp
  heartbeatAt?: ExactRunEventTimestamp
  exitCode?: number | null
  errorCode?: string | null
  errorMessage?: string | null
  resultJson?: string | null
  cancelRequestedAt?: ExactRunEventTimestamp
  cancelRequestedBy?: string | null
  ledgerProvenanceJson?: string | null
}

/** Job-row facts a ledger batch may require to be unchanged at commit. */
export type ExactRunEventJobPrecondition = {
  status?: string
  workerId?: string | null
  workerPid?: number | null
  workerStartedAt?: string | null
  heartbeatAt?: string | null
}

export type AppendExactRunEventBatchInput = {
  jobId: string
  records: readonly ExactRunEventRecord[]
  expectedHighWater: number
  jobMutation?: ExactRunEventJobMutation | null
  /**
   * Job-row facts revalidated inside the transaction (a recovery settles only
   * the worker identity/start/heartbeat it probed). Timestamps compare as ISO
   * strings; null means the column must be null.
   */
  jobPrecondition?: ExactRunEventJobPrecondition | null
  /** Final admitted artifact refs registered with the terminal commit. */
  artifactRefs?: readonly JsonValue[] | null
}

export type RunEventStoreErrorCode =
  | "EXPECTED_HIGH_WATER_CONFLICT"
  | "LEDGER_V0_APPEND_REJECTED"
  | "PARTIAL_FACT_KEY_OVERLAP"
  | "NON_DENSE_SEQUENCE"
  | "SEALED_RUN_APPEND_REJECTED"
  | "UNKNOWN_JOB"
  | "INVALID_RECORD"
  | "JOB_PRECONDITION_FAILED"

export class RunEventStoreError extends Error {
  readonly code: RunEventStoreErrorCode

  constructor(code: RunEventStoreErrorCode, message: string) {
    super(`${code}: ${message}`)
    this.name = "RunEventStoreError"
    this.code = code
  }
}

/**
 * Internal read metadata of a job's persisted event history
 * (refactor-canonical-run-event-ledger, design "Migration Plan"): pre-ledger
 * (`ledger_version=0`) rows are `legacy_unverified`; ledger (v1) rows are
 * `ledger`. It is exposed only to the store header and the Workbench reader,
 * never in a public job, result or event envelope.
 */
export type RunEventHistoryQuality = "legacy_unverified" | "ledger"

export function runEventHistoryQuality(
  job: Pick<AgentJob, "ledgerVersion">,
): RunEventHistoryQuality {
  return job.ledgerVersion === 0 ? "legacy_unverified" : "ledger"
}

export type RunEventLedgerHeader = {
  runId: string
  jobId: string
  runtimeId: string
  source: string
  kind: string
  status: string
  ledgerVersion: number
  historyQuality: RunEventHistoryQuality
  ledgerProvenanceJson: string | null
  ledgerSealedSequence: number | null
  cancelRequestedAt: string | null
  workerId: string | null
  workerPid: number | null
  workerStartedAt: string | null
  heartbeatAt: string | null
  highWater: number
}

const EXACT_JOB_MUTATION_TIMESTAMP_KEYS = new Set([
  "workerStartedAt",
  "startedAt",
  "finishedAt",
  "heartbeatAt",
  "cancelRequestedAt",
])

const EXACT_JOB_MUTATION_KEYS = new Set([
  "status",
  "workerId",
  "workerPid",
  "workerStartedAt",
  "startedAt",
  "finishedAt",
  "heartbeatAt",
  "exitCode",
  "errorCode",
  "errorMessage",
  "resultJson",
  "cancelRequestedAt",
  "cancelRequestedBy",
  "ledgerProvenanceJson",
])

function toExactTimestamp(value: ExactRunEventTimestamp): Date | null {
  if (value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new RunEventStoreError("INVALID_RECORD", "invalid job timestamp")
  }
  return date
}

function exactJobMutationValues(
  mutation: ExactRunEventJobMutation | null | undefined,
): Partial<typeof agentJobs.$inferInsert> {
  const values: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(mutation ?? {})) {
    if (value === undefined) continue
    if (!EXACT_JOB_MUTATION_KEYS.has(key)) {
      throw new RunEventStoreError(
        "INVALID_RECORD",
        `job mutation field ${key} is not ledger-owned`,
      )
    }
    if (key === "status") {
      assertOneOf(AGENT_JOB_STATUSES, String(value), "job status")
    }
    values[key] = EXACT_JOB_MUTATION_TIMESTAMP_KEYS.has(key)
      ? toExactTimestamp(value as ExactRunEventTimestamp)
      : value
  }
  return values as Partial<typeof agentJobs.$inferInsert>
}

function isoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function assertJobPrecondition(
  job: AgentJob,
  precondition: ExactRunEventJobPrecondition | null | undefined,
): void {
  if (!precondition) return
  const current: Record<string, unknown> = {
    status: job.status,
    workerId: job.workerId,
    workerPid: job.workerPid,
    workerStartedAt: isoOrNull(job.workerStartedAt),
    heartbeatAt: isoOrNull(job.heartbeatAt),
  }
  for (const [key, expected] of Object.entries(precondition)) {
    if (expected === undefined) continue
    if (!(key in current)) {
      throw new RunEventStoreError(
        "INVALID_RECORD",
        `job precondition field ${key} is not supported`,
      )
    }
    if (current[key] !== expected) {
      throw new RunEventStoreError(
        "JOB_PRECONDITION_FAILED",
        `job ${job.id} changed its ${key} before the commit`,
      )
    }
  }
}

function parseStoredJson(value: string | null): JsonValue | undefined {
  if (value === null) return undefined
  try {
    return JSON.parse(value) as JsonValue
  } catch {
    return undefined
  }
}

function eventRowToRunEvent(
  row: AgentJobEvent,
  runtimeId: string,
): RunEvent & { factKey: string | null; metadata: JsonValue | null } {
  const metadata = parseStoredJson(row.recordMetadataJson) ?? null
  const redaction =
    metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    metadata.redaction &&
    typeof metadata.redaction === "object" &&
    !Array.isArray(metadata.redaction)
      ? (metadata.redaction as RunEvent["redaction"])
      : { status: "not-required" as const, appliedRules: [] }
  const payload = parseStoredJson(row.payloadJson)
  return {
    runId: row.jobId,
    jobId: row.jobId,
    runtimeId: runtimeId as RunEvent["runtimeId"],
    sequence: row.sequence,
    type: row.type as AgentJobEventType,
    createdAt: isoOrNull(row.createdAt) ?? new Date(0).toISOString(),
    ...(payload === undefined ? {} : { payload }),
    redaction: {
      status: redaction.status,
      appliedRules: [...(redaction.appliedRules ?? [])],
    },
    factKey: row.factKey,
    metadata,
  }
}

/** Committed high-water of one job (the ledger allocates every sequence). */
function eventHighWater(
  executor: AgentJobStoreExecutor,
  jobId: string,
): number {
  const latest = (executor as AgentJobDatabase)
    .select({
      maxSequence: sql<number>`coalesce(max(${agentJobEvents.sequence}), 0)`,
    })
    .from(agentJobEvents)
    .where(eq(agentJobEvents.jobId, jobId))
    .get()
  return latest?.maxSequence ?? 0
}

function listEventRowsFromExecutor(
  executor: AgentJobStoreExecutor,
  jobId: string,
  afterSequence: number,
): AgentJobEvent[] {
  return (executor as AgentJobDatabase)
    .select()
    .from(agentJobEvents)
    .where(
      and(
        eq(agentJobEvents.jobId, jobId),
        gtSequence(agentJobEvents.sequence, afterSequence),
      ),
    )
    .orderBy(agentJobEvents.sequence)
    .all()
}

function factKeyRowsFromExecutor(
  executor: AgentJobStoreExecutor,
  jobId: string,
  factKeys: readonly string[],
): AgentJobEvent[] {
  if (factKeys.length === 0) return []
  return (executor as AgentJobDatabase)
    .select()
    .from(agentJobEvents)
    .where(
      and(
        eq(agentJobEvents.jobId, jobId),
        inArray(agentJobEvents.factKey, [...factKeys]),
      ),
    )
    .orderBy(agentJobEvents.sequence)
    .all()
}

function assertExactRecord(
  record: ExactRunEventRecord,
  jobId: string,
): asserts record is ExactRunEventRecord {
  if (typeof record.factKey !== "string" || record.factKey.length === 0) {
    throw new RunEventStoreError("INVALID_RECORD", "v1 record lacks fact key")
  }
  if (!record.metadata || typeof record.metadata !== "object") {
    throw new RunEventStoreError("INVALID_RECORD", "v1 record lacks metadata")
  }
  if ((record.jobId ?? record.runId) !== jobId || record.runId !== jobId) {
    throw new RunEventStoreError(
      "INVALID_RECORD",
      "record belongs to another job",
    )
  }
  assertOneOf(AGENT_JOB_EVENT_TYPES, record.type, "job event type")
  if (!Number.isInteger(record.sequence) || record.sequence < 1) {
    throw new RunEventStoreError("INVALID_RECORD", "invalid record sequence")
  }
}

function isLateEventRecord(record: ExactRunEventRecord): boolean {
  const payload = record.payload
  return (
    record.type === "status" &&
    !!payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    payload.subtype === "late_event"
  )
}

/** Private exact insert: the only writer of ledger v1 event rows. */
function insertExactRunEventRecord(
  executor: AgentJobStoreExecutor,
  jobId: string,
  record: ExactRunEventRecord,
): void {
  const createdAt = new Date(record.createdAt)
  ;(executor as AgentJobDatabase)
    .insert(agentJobEvents)
    .values({
      id: createId(),
      jobId,
      sequence: record.sequence,
      type: record.type,
      payloadJson: JSON.stringify(record.payload ?? {}),
      createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
      factKey: record.factKey,
      recordMetadataJson: JSON.stringify(record.metadata),
    })
    .run()
}

function mergeArtifactRefsIntoResult(
  resultJson: string | null,
  artifactRefs: readonly JsonValue[],
): string {
  const parsed = parseStoredJson(resultJson)
  const base =
    parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  return JSON.stringify({ ...base, artifactRefs: [...artifactRefs] })
}

/**
 * Commits one exact ledger batch in a single SQLite transaction: v1 marking,
 * expected high-water, dense supplied sequences, fact-key idempotency, one v1
 * completed and post-seal late_event-only rules, the optional job mutation and
 * terminal artifact refs. A complete duplicate fact-key batch returns the
 * previously committed records; any failure rolls everything back.
 */
export function appendExactRunEventBatch(
  db: AgentJobDatabase,
  input: AppendExactRunEventBatchInput,
): Array<ReturnType<typeof eventRowToRunEvent>> {
  const records = [...input.records]
  for (const record of records) assertExactRecord(record, input.jobId)
  return db.transaction((tx: AgentJobTransaction) => {
    const job = getJobFromExecutor(tx, input.jobId)
    if (!job) {
      throw new RunEventStoreError("UNKNOWN_JOB", `unknown job ${input.jobId}`)
    }
    if (job.ledgerVersion !== 1) {
      throw new RunEventStoreError(
        "LEDGER_V0_APPEND_REJECTED",
        `job ${job.id} is pre-ledger history`,
      )
    }
    const factKeys = records.map((record) => record.factKey)
    if (new Set(factKeys).size !== factKeys.length) {
      throw new RunEventStoreError(
        "PARTIAL_FACT_KEY_OVERLAP",
        "batch repeats a fact key",
      )
    }
    const existing = factKeyRowsFromExecutor(tx, job.id, factKeys)
    if (records.length > 0 && existing.length === records.length) {
      return existing.map((row) => eventRowToRunEvent(row, job.runtime))
    }
    if (existing.length > 0) {
      throw new RunEventStoreError(
        "PARTIAL_FACT_KEY_OVERLAP",
        "batch partially overlaps committed fact keys",
      )
    }
    const highWater = eventHighWater(tx, job.id)
    assertJobPrecondition(job, input.jobPrecondition)
    if (input.expectedHighWater !== highWater) {
      throw new RunEventStoreError(
        "EXPECTED_HIGH_WATER_CONFLICT",
        `expected ${input.expectedHighWater}, committed ${highWater}`,
      )
    }
    records.forEach((record, index) => {
      if (record.sequence !== highWater + index + 1) {
        throw new RunEventStoreError(
          "NON_DENSE_SEQUENCE",
          `sequence ${record.sequence} at batch offset ${index}`,
        )
      }
    })
    const completed = records.filter((record) => record.type === "completed")
    const sealed = job.ledgerSealedSequence !== null
    if (completed.length > 1 || (completed.length === 1 && sealed)) {
      throw new RunEventStoreError(
        "SEALED_RUN_APPEND_REJECTED",
        "a v1 job commits exactly one completed",
      )
    }
    if (sealed && records.some((record) => !isLateEventRecord(record))) {
      throw new RunEventStoreError(
        "SEALED_RUN_APPEND_REJECTED",
        "a sealed job accepts late_event diagnostics only",
      )
    }
    const mutation = exactJobMutationValues(input.jobMutation)
    if (completed.length === 1) {
      mutation.ledgerSealedSequence = completed[0].sequence
    }
    if (input.artifactRefs && input.artifactRefs.length > 0) {
      mutation.resultJson = mergeArtifactRefsIntoResult(
        (mutation.resultJson as string | null | undefined) ?? job.resultJson,
        input.artifactRefs,
      )
    }
    if (Object.keys(mutation).length > 0) {
      tx.update(agentJobs).set(mutation).where(eq(agentJobs.id, job.id)).run()
    }
    for (const record of records) {
      insertExactRunEventRecord(tx, job.id, record)
    }
    return listEventRowsFromExecutor(tx, job.id, highWater).map((row) =>
      eventRowToRunEvent(row, job.runtime),
    )
  })
}

/** Committed ledger records after `afterSequence`, in sequence order. */
export function readCommittedRunEvents(
  db: AgentJobDatabase,
  jobId: string,
  afterSequence = 0,
): Array<ReturnType<typeof eventRowToRunEvent>> {
  const job = getAgentJob(db, jobId)
  if (!job) return []
  return listEventRowsFromExecutor(db, jobId, afterSequence).map((row) =>
    eventRowToRunEvent(row, job.runtime),
  )
}

/** Committed records of one observation (fact keys `<observationKey>:<n>`). */
export function lookupCommittedRunEventFact(
  db: AgentJobDatabase,
  jobId: string,
  observationKey: string,
): Array<ReturnType<typeof eventRowToRunEvent>> {
  const job = getAgentJob(db, jobId)
  if (!job) return []
  const prefix = `${observationKey}:`
  return db
    .select()
    .from(agentJobEvents)
    .where(
      and(
        eq(agentJobEvents.jobId, jobId),
        sql`substr(${agentJobEvents.factKey}, 1, ${prefix.length}) = ${prefix}`,
      ),
    )
    .orderBy(agentJobEvents.sequence)
    .all()
    .filter((row) => /^\d+$/.test(String(row.factKey).slice(prefix.length)))
    .map((row) => eventRowToRunEvent(row, job.runtime))
}

/** Ledger header: job row facts the ledger rebuilds its state from. */
export function readRunEventLedgerHeader(
  db: AgentJobDatabase,
  jobId: string,
): RunEventLedgerHeader | null {
  const job = getAgentJob(db, jobId)
  if (!job) return null
  return {
    runId: job.id,
    jobId: job.id,
    runtimeId: job.runtime,
    source: job.source,
    kind: job.kind,
    status: job.status,
    ledgerVersion: job.ledgerVersion,
    historyQuality: runEventHistoryQuality(job),
    ledgerProvenanceJson: job.ledgerProvenanceJson,
    ledgerSealedSequence: job.ledgerSealedSequence,
    cancelRequestedAt: isoOrNull(job.cancelRequestedAt),
    workerId: job.workerId,
    workerPid: job.workerPid,
    workerStartedAt: isoOrNull(job.workerStartedAt),
    heartbeatAt: isoOrNull(job.heartbeatAt),
    highWater: eventHighWater(db, job.id),
  }
}

/** Acknowledged contiguous prefix of one projection (0 when none). */
export function readRunEventProjectionCursor(
  db: AgentJobDatabase,
  jobId: string,
  projectionName: string,
): number {
  const row = db
    .select()
    .from(agentJobProjectionCursors)
    .where(
      and(
        eq(agentJobProjectionCursors.jobId, jobId),
        eq(agentJobProjectionCursors.projectionName, projectionName),
      ),
    )
    .get()
  return row?.acknowledgedSequence ?? 0
}

/** Monotone acknowledgement bounded by the committed high-water. */
export function acknowledgeRunEventProjection(
  db: AgentJobDatabase,
  jobId: string,
  projectionName: string,
  sequence: number,
): void {
  db.transaction((tx: AgentJobTransaction) => {
    if (!Number.isInteger(sequence) || sequence < 0) {
      throw new RunEventStoreError("INVALID_RECORD", "invalid ack sequence")
    }
    const current = tx
      .select()
      .from(agentJobProjectionCursors)
      .where(
        and(
          eq(agentJobProjectionCursors.jobId, jobId),
          eq(agentJobProjectionCursors.projectionName, projectionName),
        ),
      )
      .get()
    const acknowledged = current?.acknowledgedSequence ?? 0
    if (sequence < acknowledged) {
      throw new RunEventStoreError("INVALID_RECORD", "ack must be monotone")
    }
    if (sequence > eventHighWater(tx, jobId)) {
      throw new RunEventStoreError(
        "INVALID_RECORD",
        "ack beyond committed high-water",
      )
    }
    if (current) {
      tx.update(agentJobProjectionCursors)
        .set({ acknowledgedSequence: sequence })
        .where(
          and(
            eq(agentJobProjectionCursors.jobId, jobId),
            eq(agentJobProjectionCursors.projectionName, projectionName),
          ),
        )
        .run()
    } else {
      tx.insert(agentJobProjectionCursors)
        .values({ jobId, projectionName, acknowledgedSequence: sequence })
        .run()
    }
  })
}
