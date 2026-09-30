import { createHash } from "node:crypto"
import {
  AGENT_JOB_EVENT_TYPES,
  type AgentJobEventType,
} from "../../../shared/agent-jobs"
import {
  CODEX_THREAD_ITEM_DISPOSITIONS,
  type CodexNativeDescriptor,
  type CodexNativeIds,
  decodeCodexNativeBoundary,
} from "../codex/app-server-stream-events"
import {
  type DecodedCoarseObservation,
  decodeCoarseRuntimeObservation,
} from "./ledger-ingress"
import {
  createExactSecretStreamChannelRedactor,
  redactRuntimePayload,
} from "./redaction"
import type { CommittedRunEvent, JsonValue, RunEvent } from "./runtime-events"

/**
 * Canonical Run event ledger (refactor-canonical-run-event-ledger).
 *
 * One ledger per Run in its host process owns the committed order: it
 * ingests native responses, notifications, server requests, response-send /
 * resolved boundaries, coarse runtime observations, host lifecycle facts,
 * transport exits, snapshot repairs and outcome evidence; allocates dense
 * sequences and `<observationKey>:<ordinal>` fact keys; redacts every payload
 * with one Run-scoped redactor (memory-only exact hints); reconciles items and
 * usage; settles exactly one `completed`; and publishes committed records to
 * projections only after the durable store acknowledged the commit.
 *
 * State (items, usage, outcome, seal, boundaries) is a reduction of the
 * committed records plus the job header, so a ledger reopened over the same
 * store rebuilds it; host-only memory (secret hints, withheld stream suffixes,
 * the raw interrupt target) is never persisted.
 */

// ---------------------------------------------------------------------------
// Public contract types (design "Test-facing Contract")
// ---------------------------------------------------------------------------

export type JsonObject = { [key: string]: JsonValue }

export type RuntimeExecutionProvenance = {
  kind: "runtime"
  installationId: string
  runtimeId: string
  adapterSource: string
  version: string
  executableRef: string
  binarySha256: string
  protocolName: string
  protocolVersion: string
  schemaFiles: { path: string; sha256: string }[]
}

export type LocusCompletionProvenance = {
  kind: "locus-completion"
  runtimeId: string
  locusBuild: string
  adapterSource: "completion"
  protocolName: string
  schemaSha256: string
}

export type PendingProvenance = { kind: "pending"; runtimeId: string }

export type ExecutionProvenance =
  | PendingProvenance
  | RuntimeExecutionProvenance
  | LocusCompletionProvenance

export type LedgerBoundary = {
  observationKey: string
  transportId?: string
  receivedAt?: string
  message?: {
    id?: string | number
    method?: string
    params?: unknown
    result?: unknown
    error?: { code: string | number; message: string }
  }
  request?: {
    id: string | number
    method: string
    params?: unknown
    intent?: "start" | "resume" | "fork" | "attach"
    expectedSessionId?: string
  }
}

export type OutcomeEvidence = {
  trigger:
    | {
        kind: "native_terminal"
        status: "succeeded" | "failed"
        observationKey: string
        origin: "live"
        code?: string | number
      }
    | {
        kind: "cancel" | "interrupt" | "transport_exit" | "recovery"
        observationKey: string
        reason: string
        [key: string]: unknown
      }
    | {
        kind: "host_result"
        status: "succeeded" | "failed"
        observationKey: string
      }
  policy: { denied: boolean; evidenceKeys: string[] }
  output: {
    valid: boolean
    empty: boolean
    allowEmpty: boolean
    evidenceKeys: string[]
  }
  postRun: { credentialsSafe: boolean; evidenceKeys: string[] }
}

export type ItemKey = (
  | { threadId: string; turnId: string; itemId: string }
  | { correlationKey: string }
) & { channel: string; partIndex: number }

export type LedgerRecord = CommittedRunEvent

export type ItemReadModel = {
  state: "started" | "streaming" | "completed"
  text?: string
  fields?: JsonObject
  indexSource?: "native" | "inferred"
  reconciliation: {
    result?: string
    lossPossible: boolean
    missingStart: boolean
    suppressedDuplicateCount: number
  }
}

export type LedgerOutcome = {
  status: string
  reasons: string[]
  evidenceKeys: string[]
  completedSequence: number
}

export type UsageVector = Record<string, number>

export type LedgerUsage = {
  total: UsageVector | null
  last: UsageVector | null
  baseline: UsageVector | null
  delta: UsageVector | null
  discontinuity: boolean
  sealedAtSequence: number | null
}

export type DurableStorePort = {
  appendExact(input: {
    records: LedgerRecord[]
    expectedHighWater: number
    jobMutation?: JsonObject
    artifactRefs?: JsonValue[]
  }): unknown
  lookupFact?(observationKey: string): unknown
  read(runId: string, afterSequence?: number): unknown
  readHeader?(runId: string): unknown
  cursor?(runId: string, projectionName: string): unknown
  ack?(runId: string, projectionName: string, sequence: number): unknown
}

export type LedgerProjection = {
  name: string
  deliver(record: LedgerRecord): unknown
  cursor(): unknown
  ack(sequence: number): unknown
}

export type LedgerClock = (() => Date) | { now(): Date }

export type CreateCanonicalRunEventLedgerOptions = {
  runId: string
  runtimeId: string
  source?: string
  provenance: unknown
  clock?: LedgerClock
  redactionContext?: { secretHints?: readonly string[] }
  durableStore: DurableStorePort
  projections?: readonly LedgerProjection[]
  artifactOwner?: unknown
  /**
   * Terminal run-dir preparation, supplied by the host only when the Run has
   * an admitted run directory (it composes run-artifacts.ts with the v1
   * serializers). It receives the frozen public prefix including the
   * candidate completed and returns the refs registered with that completed
   * in the same durable commit; a throw settles failed at the same slot.
   */
  terminalArtifacts?: {
    prepare(input: {
      records: LedgerRecord[]
      completed: LedgerRecord
    }): JsonValue[] | Promise<JsonValue[]>
  }
  /** Sanitized host infrastructure diagnostics (never persisted). */
  onHostDiagnostic?: (diagnostic: { code: string; message: string }) => void
}

/** Sanitized ledger failure; carries no payload or secret material. */
export class RunEventLedgerError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(`${code}: ${message}`)
    this.name = "RunEventLedgerError"
    this.code = code
  }
}

/**
 * Owner-gated artifact port. Only agent-runtime/run-artifacts.ts reaches it:
 * generic ingress ports can never mint `artifact_created`.
 */
export const RUN_ARTIFACT_LEDGER_PORT: unique symbol = Symbol(
  "run-event-ledger.artifact-port",
)

export type RunArtifactLedgerPort = {
  runId: string
  isSealed(): boolean
  containsSecretMaterial(text: string): boolean
  admit(input: {
    observationKey: string
    artifact: JsonObject
    ref: JsonObject
    runDir: string
  }): Promise<LedgerRecord[]>
  reject(input: {
    observationKey: string
    reason: string
  }): Promise<LedgerRecord[]>
}

const MAX_TRANSACTION_ATTEMPTS = 3
const CODEX_EXTENSION = "runtime.codex.v1"
const REQUIRED_RUNTIME_FIELDS = [
  "installationId",
  "runtimeId",
  "adapterSource",
  "version",
  "executableRef",
  "binarySha256",
  "protocolName",
  "protocolVersion",
] as const
const REQUIRED_COMPLETION_FIELDS = [
  "runtimeId",
  "locusBuild",
  "protocolName",
  "schemaSha256",
] as const
const TERMINAL_JOB_STATUSES = new Set([
  "succeeded",
  "failed",
  "canceled",
  "interrupted",
])

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function toJson(value: unknown): JsonValue {
  if (value === undefined) return null
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function toJsonObject(value: unknown): JsonObject {
  const json = toJson(value)
  return isObject(json) ? (json as JsonObject) : {}
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value ?? null)
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function isUuid(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
}

function numericVector(value: unknown): UsageVector | null {
  if (!isObject(value)) return null
  const vector: UsageVector = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "number" && Number.isFinite(entry)) vector[key] = entry
  }
  return Object.keys(vector).length > 0 ? vector : null
}

function addVectors(left: UsageVector | null, right: UsageVector): UsageVector {
  const sum: UsageVector = { ...(left ?? {}) }
  for (const [key, value] of Object.entries(right)) {
    sum[key] = (sum[key] ?? 0) + value
  }
  return sum
}

function subtractVectors(
  total: UsageVector,
  baseline: UsageVector | null,
): UsageVector {
  const delta: UsageVector = {}
  for (const [key, value] of Object.entries(total)) {
    delta[key] = Math.max(0, value - (baseline?.[key] ?? 0))
  }
  return delta
}

function zeroVector(like: UsageVector): UsageVector {
  return Object.fromEntries(Object.keys(like).map((key) => [key, 0]))
}

function awaitable<T>(value: T | Promise<T>): Promise<T> {
  return Promise.resolve(value)
}

function observationKeyOfFactKey(factKey: unknown): string | null {
  if (typeof factKey !== "string") return null
  const separator = factKey.lastIndexOf(":")
  if (separator <= 0) return null
  return /^\d+$/.test(factKey.slice(separator + 1))
    ? factKey.slice(0, separator)
    : null
}

function recordFactKey(record: Record<string, unknown>): unknown {
  const metadata = isObject(record.metadata) ? record.metadata : undefined
  return record.factKey ?? record.fact_key ?? metadata?.factKey ?? null
}

// ---------------------------------------------------------------------------
// Provenance validation
// ---------------------------------------------------------------------------

function validateProvenance(value: unknown): ExecutionProvenance {
  if (!isObject(value)) {
    throw new RunEventLedgerError(
      "PROVENANCE_INVALID",
      "execution provenance is required",
    )
  }
  if (value.kind === "pending") {
    if (!nonEmptyString(value.runtimeId)) {
      throw new RunEventLedgerError(
        "PROVENANCE_INVALID",
        "pending provenance requires runtimeId",
      )
    }
    return { kind: "pending", runtimeId: value.runtimeId }
  }
  if (value.kind === "runtime") {
    const missing = REQUIRED_RUNTIME_FIELDS.filter(
      (field) => !nonEmptyString(value[field]),
    )
    const schemaFiles = value.schemaFiles
    const schemaValid =
      Array.isArray(schemaFiles) &&
      schemaFiles.length > 0 &&
      schemaFiles.every(
        (entry) =>
          isObject(entry) &&
          nonEmptyString(entry.path) &&
          nonEmptyString(entry.sha256),
      )
    if (missing.length > 0 || !schemaValid) {
      throw new RunEventLedgerError(
        "PROVENANCE_INVALID",
        `runtime provenance lacks ${[...missing, ...(schemaValid ? [] : ["schemaFiles"])].join(", ")}`,
      )
    }
    return clone(value) as RuntimeExecutionProvenance
  }
  if (value.kind === "locus-completion") {
    const missing = REQUIRED_COMPLETION_FIELDS.filter(
      (field) => !nonEmptyString(value[field]),
    )
    if (missing.length > 0 || value.adapterSource !== "completion") {
      throw new RunEventLedgerError(
        "PROVENANCE_INVALID",
        "locus-completion provenance is incomplete",
      )
    }
    return clone(value) as LocusCompletionProvenance
  }
  throw new RunEventLedgerError(
    "PROVENANCE_INVALID",
    "unknown execution provenance kind",
  )
}

function provenanceRef(provenance: ExecutionProvenance): JsonObject {
  if (provenance.kind === "runtime") {
    return { kind: "runtime", installationId: provenance.installationId }
  }
  if (provenance.kind === "locus-completion") {
    return { kind: "locus-completion", locusBuild: provenance.locusBuild }
  }
  return { kind: "pending", runtimeId: provenance.runtimeId }
}

function parseStoredProvenance(value: unknown): ExecutionProvenance | null {
  if (value === null || value === undefined || value === "") return null
  let parsed: unknown = value
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!isObject(parsed) || parsed.kind === "pending") return null
  return validateProvenance(parsed)
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

type ItemPart = {
  key: JsonObject
  itemType?: string
  state: "started" | "streaming" | "completed"
  text: string
  hasLocal: boolean
  missingStart: boolean
  indexSource?: "native" | "inferred"
  fields?: JsonObject
  result?: string
  lossPossible: boolean
  suppressedDuplicateCount: number
}

type LedgerState = {
  highWater: number
  records: LedgerRecord[]
  byObservation: Map<string, LedgerRecord[]>
  completed: LedgerRecord | null
  terminalCandidateSequence: number | null
  jobStatus: string | null
  provenance: ExecutionProvenance
  sealedProvenance: boolean
  items: Map<string, ItemPart>
  itemsStarted: Map<string, string>
  lastSummaryPart: Map<string, number>
  usage: LedgerUsage & { appliedDedupeKeys: Set<string> }
  requests: Map<string, string>
  observedTurnStart: boolean
  claudeQueries: Map<string, "validated" | "rejected">
  lastErrorMessage: string | null
  artifactRefs: JsonObject[]
  admittedRunDir: string | null
}

type Draft = {
  type: AgentJobEventType
  payload: JsonObject
  appliedRules?: string[]
  metadata?: JsonObject
}

type LateSummary = {
  originalType: string
  nativeMethod?: string
  observation: JsonObject
  extra?: JsonObject
}

type PlanResult =
  | {
      kind: "commit"
      drafts: Draft[]
      jobMutation?: JsonObject
      artifactRefs?: JsonValue[]
    }
  | { kind: "reject"; error: RunEventLedgerError }
  | { kind: "value"; value: unknown }

type PlanContext = {
  state: LedgerState
  nextSequence: number
  nowIso: string
}

type Task = {
  observationKey: string
  /** Native/runtime observations become late diagnostics after the seal. */
  late: "native" | "host" | "settle" | "none"
  /** Native/runtime observations are rejected while provenance is pending. */
  requiresBinding?: boolean
  lateSummary?: () => LateSummary
  plan: (context: PlanContext) => PlanResult
  onCommitted?: (committed: LedgerRecord[]) => void
  afterCommit?: (committed: LedgerRecord[]) => Promise<void>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

function emptyUsage(): LedgerState["usage"] {
  return {
    total: null,
    last: null,
    baseline: null,
    delta: null,
    discontinuity: false,
    sealedAtSequence: null,
    appliedDedupeKeys: new Set(),
  }
}

function itemMapKey(key: Record<string, unknown>): string {
  if (nonEmptyString(key.correlationKey)) {
    return JSON.stringify([
      "correlation",
      key.correlationKey,
      key.channel ?? null,
      key.partIndex ?? 0,
    ])
  }
  return JSON.stringify([
    key.threadId ?? null,
    key.turnId ?? null,
    key.itemId ?? null,
    key.channel ?? null,
    key.partIndex ?? 0,
  ])
}

function itemBaseKey(key: Record<string, unknown>): string {
  return JSON.stringify([
    key.threadId ?? null,
    key.turnId ?? null,
    key.itemId ?? null,
  ])
}

function reconcileText(
  local: ItemPart | undefined,
  finalText: string,
): { result: string; lossPossible: boolean } {
  if (!local?.hasLocal) {
    return { result: "missing_local", lossPossible: true }
  }
  if (local.text === finalText) {
    return { result: "matched", lossPossible: false }
  }
  if (local.text.length > 0 && finalText.startsWith(local.text)) {
    return { result: "suffix_repaired", lossPossible: true }
  }
  return { result: "mismatch", lossPossible: true }
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

class RunEventLedgerImpl {
  private readonly runId: string
  private readonly runtimeId: string
  private readonly source: string
  private readonly clock: LedgerClock | undefined
  private readonly secretHints: readonly string[]
  private readonly store: DurableStorePort
  private readonly projections: readonly LedgerProjection[]
  private readonly onHostDiagnostic: CreateCanonicalRunEventLedgerOptions["onHostDiagnostic"]
  private readonly terminalArtifacts: CreateCanonicalRunEventLedgerOptions["terminalArtifacts"]
  private readonly redactor = createExactSecretStreamChannelRedactor<string>()
  private readonly pendingStreamKeys = new Map<string, string[]>()
  private readonly delivered = new Map<string, number>()
  private state: LedgerState
  private chain: Promise<void> = Promise.resolve()
  private halted: string | null = null
  private parked: Task[] = []
  private readonly pendingLate: Array<{
    observationKey: string
    summary: LateSummary
  }> = []
  private nativeContext: { threadId?: string; turnId?: string } = {}
  private withheldDropped = 0
  private openError: unknown = null
  private readonly preparedCache = new Map<string, unknown>()
  private ready: Promise<void> = Promise.resolve()

  constructor(
    options: CreateCanonicalRunEventLedgerOptions,
    provenance: ExecutionProvenance,
  ) {
    this.runId = options.runId
    this.runtimeId = options.runtimeId
    this.source = options.source ?? "api"
    this.clock = options.clock
    this.secretHints = [...(options.redactionContext?.secretHints ?? [])]
    this.store = options.durableStore
    this.projections = options.projections ?? []
    this.onHostDiagnostic = options.onHostDiagnostic
    this.terminalArtifacts = options.terminalArtifacts
    this.state = this.initialState(provenance)
  }

  // ---- construction / reload -------------------------------------------

  private initialState(provenance: ExecutionProvenance): LedgerState {
    return {
      highWater: 0,
      records: [],
      byObservation: new Map(),
      completed: null,
      terminalCandidateSequence: null,
      jobStatus: null,
      provenance,
      sealedProvenance: false,
      items: new Map(),
      itemsStarted: new Map(),
      lastSummaryPart: new Map(),
      usage: emptyUsage(),
      requests: new Map(),
      observedTurnStart: false,
      claudeQueries: new Map(),
      lastErrorMessage: null,
      artifactRefs: [],
      admittedRunDir: null,
    }
  }

  /**
   * Starts reopening committed state as the first serial task; ports queue
   * behind it, so construction can return synchronously.
   */
  start(requested: ExecutionProvenance): void {
    this.ready = this.chain.then(async () => {
      try {
        await this.open(requested)
      } catch (error) {
        this.openError = error
      }
    })
    this.chain = this.ready
  }

  private async open(requested: ExecutionProvenance): Promise<void> {
    const header = await this.readHeader()
    if (header && Number(header.ledgerVersion ?? header.ledger_version) === 0) {
      throw new RunEventLedgerError(
        "LEDGER_V0_APPEND_REJECTED",
        "pre-ledger history is never extended by the ledger",
      )
    }
    const stored = parseStoredProvenance(
      header?.ledgerProvenanceJson ?? header?.ledger_provenance_json,
    )
    if (stored) {
      if (
        requested.kind !== "pending" &&
        stableStringify(requested) !== stableStringify(stored)
      ) {
        throw new RunEventLedgerError(
          "PROVENANCE_REBIND_REJECTED",
          "the Run is sealed to a different execution tuple",
        )
      }
      this.state.provenance = stored
      this.state.sealedProvenance = true
    }
    this.applyHeader(header)
    const committed = await this.readCommitted(0)
    for (const record of committed) this.reduce(record)
    for (const projection of this.projections) {
      let cursor = 0
      try {
        cursor = Number(await awaitable(projection.cursor())) || 0
      } catch {
        cursor = 0
      }
      this.delivered.set(projection.name, cursor)
    }
    await this.deliverProjections()
    if (!stored && requested.kind !== "pending") {
      let failure: unknown = null
      await this.run({
        ...this.bindTask(requested),
        resolve: () => {},
        reject: (error) => {
          failure = error
        },
      })
      if (failure) throw failure
    }
  }

  private applyHeader(header: Record<string, unknown> | null): void {
    if (!header) return
    if (typeof header.status === "string") this.state.jobStatus = header.status
  }

  private async readHeader(): Promise<Record<string, unknown> | null> {
    if (typeof this.store.readHeader !== "function") return null
    const header = await awaitable(this.store.readHeader(this.runId))
    return isObject(header) ? header : null
  }

  private async readCommitted(afterSequence: number): Promise<LedgerRecord[]> {
    const rows = await awaitable(this.store.read(this.runId, afterSequence))
    if (!Array.isArray(rows)) return []
    return (rows as LedgerRecord[])
      .filter((row) => isObject(row) && Number(row.sequence) > afterSequence)
      .sort((left, right) => Number(left.sequence) - Number(right.sequence))
  }

  // ---- reducer: committed records -> state -------------------------------

  private reduce(record: LedgerRecord): void {
    const state = this.state
    const sequence = Number(record.sequence)
    if (!Number.isFinite(sequence) || sequence <= state.highWater) {
      return
    }
    state.highWater = sequence
    state.records.push(record)
    const observationKey = observationKeyOfFactKey(recordFactKey(record))
    if (observationKey) {
      const list = state.byObservation.get(observationKey) ?? []
      list.push(record)
      state.byObservation.set(observationKey, list)
    }
    const payload = isObject(record.payload)
      ? (record.payload as JsonObject)
      : {}
    switch (record.type) {
      case "completed":
        state.completed = record
        if (state.usage.sealedAtSequence === null) {
          state.usage.sealedAtSequence = sequence - 1
        }
        if (typeof payload.status === "string") {
          state.jobStatus = payload.status
        }
        return
      case "job_started":
        if (!state.jobStatus || state.jobStatus === "queued") {
          state.jobStatus = "running"
        }
        return
      case "usage_update":
        this.reduceUsage(payload)
        return
      case "artifact_created":
        for (const artifact of Array.isArray(payload.artifacts)
          ? payload.artifacts
          : []) {
          if (isObject(artifact)) {
            state.artifactRefs.push({
              ...(artifact as JsonObject),
              sequence,
            })
          }
        }
        return
      case "error":
        if (typeof payload.message === "string") {
          state.lastErrorMessage = payload.message
        }
        break
      default:
        break
    }
    if (record.type === "status") this.reduceStatus(payload, sequence)
    if (isObject(payload.item)) this.reduceItem(record.type, payload)
  }

  private reduceStatus(payload: JsonObject, sequence: number): void {
    const state = this.state
    if (payload.terminalCandidate === true && !state.completed) {
      state.terminalCandidateSequence ??= sequence
      state.usage.sealedAtSequence ??= sequence
    }
    switch (payload.subtype) {
      case "reasoning_part": {
        const item = isObject(payload.item) ? payload.item : {}
        if (typeof item.partIndex === "number") {
          state.lastSummaryPart.set(itemBaseKey(item), item.partIndex)
        }
        break
      }
      case "interaction_boundary":
        if (
          payload.boundary === "request" &&
          (typeof payload.requestId === "string" ||
            typeof payload.requestId === "number") &&
          typeof payload.method === "string"
        ) {
          state.requests.set(JSON.stringify(payload.requestId), payload.method)
        }
        break
      case "protocol_response":
        if (payload.method === "turn/start" && payload.correlated === true) {
          state.observedTurnStart = true
        }
        break
      case "repair": {
        const baseline = numericVector(payload.usageBaseline)
        if (baseline) {
          state.usage.baseline = baseline
          state.usage.delta = state.usage.total
            ? subtractVectors(state.usage.total, baseline)
            : null
        }
        break
      }
      case "native_resume_validated":
      case "native_resume_rejected":
        if (typeof payload.queryId === "string") {
          state.claudeQueries.set(
            payload.queryId,
            payload.subtype === "native_resume_validated"
              ? "validated"
              : "rejected",
          )
        }
        break
      default:
        break
    }
  }

  private reduceUsage(payload: JsonObject): void {
    const usage = this.state.usage
    const dedupeKey =
      typeof payload.dedupeKey === "string" ? payload.dedupeKey : null
    if (dedupeKey && usage.appliedDedupeKeys.has(dedupeKey)) return
    if (dedupeKey) usage.appliedDedupeKeys.add(dedupeKey)
    const total = numericVector(payload.total)
    const last = numericVector(payload.last)
    if (total) usage.total = total
    if (last) usage.last = last
    const baseline = numericVector(payload.baseline)
    if (baseline) usage.baseline = baseline
    const delta = numericVector(payload.delta)
    if (delta) usage.delta = delta
    if (payload.discontinuity === true) usage.discontinuity = true
  }

  private reduceItem(type: string, payload: JsonObject): void {
    const state = this.state
    const item = payload.item as JsonObject
    if (type === "status" && payload.subtype === "item_lifecycle") {
      state.itemsStarted.set(itemBaseKey(item), String(item.itemType ?? ""))
      for (const part of state.items.values()) {
        if (itemBaseKey(part.key) === itemBaseKey(item)) {
          part.missingStart = false
        }
      }
      return
    }
    if (type === "tool_started") {
      state.itemsStarted.set(itemBaseKey(item), String(item.itemType ?? "tool"))
      const key = itemMapKey(item)
      const part = state.items.get(key) ?? this.newPart(item, false)
      part.state = part.state === "completed" ? part.state : "started"
      part.missingStart = false
      if (isObject(payload.fields)) part.fields = payload.fields as JsonObject
      state.items.set(key, part)
      return
    }
    if (
      type === "assistant_delta" ||
      type === "reasoning_delta" ||
      type === "tool_delta"
    ) {
      const key = itemMapKey(item)
      const started = state.itemsStarted.has(itemBaseKey(item))
      const part = state.items.get(key) ?? this.newPart(item, !started)
      if (part.state === "completed") return
      part.state = "streaming"
      part.hasLocal = true
      const text =
        type === "tool_delta"
          ? ""
          : typeof payload.text === "string"
            ? payload.text
            : typeof payload.delta === "string"
              ? payload.delta
              : ""
      part.text += text
      if (item.indexSource === "inferred" || item.indexSource === "native") {
        part.indexSource = item.indexSource
      }
      if (part.indexSource === "inferred" || part.missingStart) {
        part.lossPossible = true
      }
      state.items.set(key, part)
      return
    }
    if (type === "status" && payload.subtype === "item_reconciliation") {
      if (item.channel === undefined) return
      const key = itemMapKey(item)
      const part = state.items.get(key) ?? this.newPart(item, false)
      const reconciliation = isObject(payload.reconciliation)
        ? payload.reconciliation
        : {}
      part.state =
        item.state === "started" || item.state === "streaming"
          ? item.state
          : "completed"
      if (typeof item.text === "string") part.text = item.text
      if (isObject(item.fields)) part.fields = item.fields as JsonObject
      if (typeof item.itemType === "string") part.itemType = item.itemType
      if (item.indexSource === "inferred" || item.indexSource === "native") {
        part.indexSource = item.indexSource
      }
      part.hasLocal = part.hasLocal || typeof item.text === "string"
      if (typeof reconciliation.result === "string") {
        part.result = reconciliation.result
      }
      part.lossPossible = reconciliation.lossPossible === true
      part.missingStart = reconciliation.missingStart === true
      part.suppressedDuplicateCount =
        typeof reconciliation.suppressedDuplicateCount === "number"
          ? reconciliation.suppressedDuplicateCount
          : part.suppressedDuplicateCount
      state.items.set(key, part)
    }
  }

  private newPart(item: JsonObject, missingStart: boolean): ItemPart {
    const key: JsonObject = {}
    for (const name of [
      "threadId",
      "turnId",
      "itemId",
      "correlationKey",
      "channel",
      "partIndex",
    ]) {
      if (item[name] !== undefined) key[name] = item[name]
    }
    return {
      key,
      ...(typeof item.itemType === "string" ? { itemType: item.itemType } : {}),
      state: "started",
      text: "",
      hasLocal: false,
      missingStart,
      lossPossible: missingStart,
      suppressedDuplicateCount: 0,
    }
  }

  // ---- redaction ----------------------------------------------------------

  /** Stateless Run-scoped redaction of one payload (exact hints + rules). */
  private sanitize(value: JsonValue): { value: JsonValue; rules: string[] } {
    const result = redactRuntimePayload(value, {
      runtimeId: this.runtimeId as RunEvent["runtimeId"],
      runId: this.runId,
      source: "runtime-diagnostic",
      secretHints: this.secretHints,
    })
    return { value: result.payload, rules: result.appliedRules }
  }

  private sanitizeString(value: string): string {
    const result = this.sanitize(value)
    return typeof result.value === "string" ? result.value : ""
  }

  private redactedIds(ids: Record<string, unknown>): JsonObject {
    const output: JsonObject = {}
    for (const [key, value] of Object.entries(ids)) {
      if (value === undefined) continue
      output[key] =
        typeof value === "string"
          ? this.sanitizeString(value)
          : (toJson(value) as JsonValue)
    }
    return output
  }

  /** Stateful per-channel stream redaction; computed once per observation. */
  private streamRedact(
    channel: string,
    text: string,
    observationKey: string,
  ): {
    text: string
    pending: boolean
    applied: boolean
    releasedFrom: string[]
  } {
    const pushed = this.redactor.push(
      { channel, value: text, withValue: (value) => value },
      this.secretHints,
    )
    const releasedFrom = this.pendingStreamKeys.get(channel) ?? []
    if (pushed.pending) {
      this.pendingStreamKeys.set(channel, [...releasedFrom, observationKey])
    } else {
      this.pendingStreamKeys.delete(channel)
    }
    return {
      text: pushed.value,
      pending: pushed.pending === true,
      applied: pushed.applied,
      releasedFrom: pushed.pending ? [] : releasedFrom,
    }
  }

  /** Terminal flush: withheld potential-secret prefixes are dropped. */
  private sealStreams(): void {
    // flush() never releases a withheld potential-secret prefix; the ingress
    // records already carry redactionPending, and the seal records the loss.
    this.redactor.flush(this.secretHints)
    this.withheldDropped += this.pendingStreamKeys.size
    this.pendingStreamKeys.clear()
  }

  // ---- record construction -----------------------------------------------

  private nowIso(): string {
    const clock = this.clock
    const date =
      typeof clock === "function"
        ? clock()
        : clock && typeof clock.now === "function"
          ? clock.now()
          : new Date()
    return (date instanceof Date ? date : new Date(date)).toISOString()
  }

  private codexExtension(ids: CodexNativeIds | JsonObject): JsonObject | null {
    if (this.runtimeId !== "codex") return null
    if (this.state.provenance.kind !== "runtime") return null
    const present = Object.fromEntries(
      Object.entries(ids).filter(([, value]) => value !== undefined),
    )
    if (Object.keys(present).length === 0) return null
    return {
      [CODEX_EXTENSION]: {
        schemaVersion: 1,
        maturity: "experimental",
        ...present,
      } as JsonValue,
    }
  }

  private buildRecords(
    observationKey: string,
    drafts: Draft[],
    firstSequence: number,
  ): LedgerRecord[] {
    const provenance = provenanceRef(this.state.provenance)
    return drafts.map((draft, ordinal) => {
      const sanitized = this.sanitize(draft.payload)
      const payload = isObject(sanitized.value)
        ? (sanitized.value as JsonObject)
        : {}
      const rules = [
        ...new Set([...(draft.appliedRules ?? []), ...sanitized.rules]),
      ].sort()
      const factKey = `${observationKey}:${ordinal}`
      const redaction = {
        status:
          rules.length > 0 ? ("redacted" as const) : ("not-required" as const),
        appliedRules: rules,
      }
      return {
        runId: this.runId,
        jobId: this.runId,
        runtimeId: this.runtimeId as RunEvent["runtimeId"],
        sequence: firstSequence + ordinal,
        type: draft.type,
        createdAt: this.nowIso(),
        payload,
        redaction,
        factKey,
        metadata: {
          factKey,
          observationKey,
          ordinal,
          source: this.source,
          provenance,
          redaction: {
            ...redaction,
            ...(draft.metadata?.redaction as JsonObject | undefined),
          },
          ...Object.fromEntries(
            Object.entries(draft.metadata ?? {}).filter(
              ([key]) => key !== "redaction",
            ),
          ),
        },
      }
    })
  }

  // ---- serial ingestion ---------------------------------------------------

  private enqueue(task: Omit<Task, "resolve" | "reject">): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const full: Task = { ...task, resolve, reject }
      this.chain = this.chain.then(() => this.run(full))
    })
  }

  private async run(task: Task): Promise<void> {
    if (this.openError) {
      task.reject(this.openError)
      return
    }
    const prior = this.state.byObservation.get(task.observationKey)
    if (prior) {
      task.resolve(clone(prior))
      return
    }
    if (
      this.pendingLate.some(
        (entry) => entry.observationKey === task.observationKey,
      )
    ) {
      task.resolve([])
      return
    }
    if (this.halted !== null && this.halted !== task.observationKey) {
      this.parked.push(task)
      return
    }
    if (task.requiresBinding && this.state.provenance.kind === "pending") {
      task.reject(
        new RunEventLedgerError(
          "PROVENANCE_PENDING",
          "runtime observations require bound execution provenance",
        ),
      )
      return
    }
    try {
      await this.execute(task)
    } catch (error) {
      task.reject(error)
    }
  }

  private lateDraft(summary: LateSummary, terminalSequence: number): Draft {
    return {
      type: "status",
      payload: {
        subtype: "late_event",
        diagnosticOnly: true,
        terminalSequence,
        originalType: summary.originalType,
        ...(summary.nativeMethod ? { nativeMethod: summary.nativeMethod } : {}),
        observation: summary.observation,
        ...(summary.extra ?? {}),
      },
    }
  }

  private async execute(task: Task): Promise<void> {
    let lastConflict = false
    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      const prior = this.state.byObservation.get(task.observationKey)
      if (prior) {
        this.unhalt(task.observationKey)
        task.resolve(clone(prior))
        return
      }
      const state = this.state
      let plan: PlanResult
      if (task.late !== "none" && task.lateSummary && state.completed) {
        plan = {
          kind: "commit",
          drafts: [
            this.lateDraft(
              task.lateSummary(),
              Number(state.completed.sequence),
            ),
          ],
        }
      } else if (
        (task.late === "native" || task.late === "host") &&
        task.lateSummary &&
        state.terminalCandidateSequence !== null
      ) {
        this.pendingLate.push({
          observationKey: task.observationKey,
          summary: task.lateSummary(),
        })
        task.resolve([])
        return
      } else {
        plan = task.plan({
          state,
          nextSequence: state.highWater + 1,
          nowIso: this.nowIso(),
        })
      }
      if (plan.kind === "reject") {
        task.reject(plan.error)
        return
      }
      if (plan.kind === "value") {
        task.resolve(plan.value)
        return
      }
      const expectedHighWater = state.highWater
      const records = this.buildRecords(
        task.observationKey,
        plan.drafts,
        expectedHighWater + 1,
      )
      const artifactRefs = await this.prepareTerminalArtifacts(records, plan)
      try {
        const result = await awaitable(
          this.store.appendExact({
            records: clone(records),
            expectedHighWater,
            ...(plan.jobMutation
              ? { jobMutation: clone(plan.jobMutation) }
              : {}),
            ...(artifactRefs.length > 0
              ? { artifactRefs: clone(artifactRefs) }
              : {}),
          }),
        )
        const committed = (
          Array.isArray(result) && result.length === records.length
            ? (result as LedgerRecord[])
            : records
        ).map((record) => clone(record))
        if (plan.jobMutation && typeof plan.jobMutation.status === "string") {
          this.state.jobStatus = plan.jobMutation.status
        }
        for (const record of committed) this.reduce(record)
        this.preparedCache.delete(task.observationKey)
        task.onCommitted?.(committed)
        await this.deliverProjections()
        this.unhalt(task.observationKey)
        if (task.afterCommit) await task.afterCommit(committed)
        task.resolve(clone(committed))
        return
      } catch (error) {
        const reloaded = await this.reloadAfterFailure()
        if (reloaded === null) {
          lastConflict = false
          this.hostDiagnostic(
            "LEDGER_STORE_UNAVAILABLE",
            "durable store rejected the batch and could not be re-read",
          )
          continue
        }
        lastConflict = reloaded
        if (!reloaded) {
          this.hostDiagnostic(
            "LEDGER_APPEND_ROLLBACK",
            `durable append rolled back (${error instanceof Error ? error.name : "error"})`,
          )
        }
      }
    }
    if (lastConflict) {
      task.reject(
        new RunEventLedgerError(
          "LEDGER_APPEND_CONFLICT",
          "competing commits exhausted the reconciliation attempts",
        ),
      )
      return
    }
    this.halted = task.observationKey
    task.reject(
      new RunEventLedgerError(
        "LEDGER_APPEND_FAILED",
        "durable append failed; ingestion is halted until the observation is resubmitted",
      ),
    )
  }

  /**
   * Design "Artifacts and Terminal Commit Order": terminal files are prepared
   * from the frozen prefix plus the candidate completed (regenerated on every
   * rebased attempt) and their refs join the same commit. A preparation
   * failure keeps the terminal slot but settles failed (canceled/interrupted
   * keep their precedence) with the diagnostic in the completed reasons.
   */
  private async prepareTerminalArtifacts(
    records: LedgerRecord[],
    plan: Extract<PlanResult, { kind: "commit" }>,
  ): Promise<JsonValue[]> {
    const refs = [...(plan.artifactRefs ?? [])]
    const completed = records.find((record) => record.type === "completed")
    if (!completed || !this.terminalArtifacts) return refs
    try {
      const prepared = await awaitable(
        this.terminalArtifacts.prepare({
          records: clone([
            ...this.state.records,
            ...records.filter(
              (record) => Number(record.sequence) <= Number(completed.sequence),
            ),
          ]),
          completed: clone(completed),
        }),
      )
      return [...refs, ...(Array.isArray(prepared) ? prepared : [])]
    } catch {
      const payload = isObject(completed.payload)
        ? (completed.payload as JsonObject)
        : {}
      const precedence =
        payload.status === "canceled" || payload.status === "interrupted"
      const reasons = Array.isArray(payload.reasons) ? payload.reasons : []
      completed.payload = {
        ...payload,
        status: precedence ? payload.status : "failed",
        reasons: [...reasons, "terminal_artifact_preparation_failed"],
      }
      if (plan.jobMutation && !precedence) plan.jobMutation.status = "failed"
      this.hostDiagnostic(
        "LEDGER_TERMINAL_ARTIFACTS_FAILED",
        "terminal run-dir preparation failed; the Run settles without unverified refs",
      )
      return refs
    }
  }

  /**
   * After a failed append: true = competing commits were found and reduced
   * (conflict reconciliation), false = definite rollback with no competing
   * commit, null = the store could not be re-read.
   */
  private async reloadAfterFailure(): Promise<boolean | null> {
    let newer: LedgerRecord[]
    let header: Record<string, unknown> | null
    try {
      newer = await this.readCommitted(this.state.highWater)
      header = await this.readHeader()
    } catch {
      return null
    }
    this.applyHeader(header)
    if (newer.length === 0) return false
    for (const record of newer) this.reduce(record)
    await this.deliverProjections()
    return true
  }

  private unhalt(observationKey: string): void {
    if (this.halted !== observationKey) return
    this.halted = null
    const parked = this.parked
    this.parked = []
    for (const task of parked) {
      this.chain = this.chain.then(() => this.run(task))
    }
  }

  private hostDiagnostic(code: string, message: string): void {
    try {
      this.onHostDiagnostic?.({ code, message })
    } catch {
      // Host diagnostics are best effort and never block ingestion.
    }
  }

  private async deliverProjections(): Promise<void> {
    for (const projection of this.projections) {
      let deliveredUpTo = this.delivered.get(projection.name) ?? 0
      const pending = this.state.records.filter(
        (record) => Number(record.sequence) > deliveredUpTo,
      )
      if (pending.length === 0) continue
      let ok = true
      for (const record of pending) {
        try {
          await awaitable(projection.deliver(clone(record)))
          deliveredUpTo = Number(record.sequence)
        } catch {
          ok = false
          break
        }
      }
      this.delivered.set(projection.name, deliveredUpTo)
      if (!ok && deliveredUpTo === 0) continue
      try {
        await awaitable(projection.ack(deliveredUpTo))
      } catch {
        // An acknowledgement failure only delays the cursor; delivery is at
        // least once and the projector upserts by (runId, sequence).
      }
    }
  }

  private async flushLate(): Promise<void> {
    const completed = this.state.completed
    if (!completed) return
    while (this.pendingLate.length > 0) {
      const entry = this.pendingLate.shift()
      if (!entry) break
      const draft = this.lateDraft(entry.summary, Number(completed.sequence))
      const records = this.buildRecords(
        entry.observationKey,
        [draft],
        this.state.highWater + 1,
      )
      try {
        const result = await awaitable(
          this.store.appendExact({
            records: clone(records),
            expectedHighWater: this.state.highWater,
          }),
        )
        const committed =
          Array.isArray(result) && result.length === 1
            ? (result as LedgerRecord[])
            : records
        for (const record of committed) this.reduce(clone(record))
      } catch {
        this.hostDiagnostic(
          "LEDGER_LATE_DIAGNOSTIC_LOST",
          "a buffered late diagnostic could not be committed",
        )
      }
    }
    await this.deliverProjections()
  }

  // ---- ports: host lifecycle ----------------------------------------------

  bindExecutionProvenance(value: unknown): Promise<unknown> {
    let tuple: ExecutionProvenance
    try {
      tuple = validateProvenance(value)
    } catch (error) {
      return Promise.reject(error)
    }
    return this.enqueue(this.bindTask(tuple))
  }

  private bindTask(
    tuple: ExecutionProvenance,
  ): Omit<Task, "resolve" | "reject"> {
    return {
      observationKey: `provenance:${digest(stableStringify(tuple)).slice(0, 16)}`,
      late: "none",
      plan: ({ state }) => {
        if (tuple.kind === "pending") {
          return {
            kind: "reject",
            error: new RunEventLedgerError(
              "PROVENANCE_INVALID",
              "binding requires an execution tuple",
            ),
          }
        }
        if (
          state.completed ||
          TERMINAL_JOB_STATUSES.has(state.jobStatus ?? "")
        ) {
          return {
            kind: "reject",
            error: new RunEventLedgerError(
              "PROVENANCE_BIND_AFTER_SEAL",
              "a settled Run keeps its pending provenance",
            ),
          }
        }
        if (state.sealedProvenance) {
          return stableStringify(state.provenance) === stableStringify(tuple)
            ? { kind: "value", value: [] }
            : {
                kind: "reject",
                error: new RunEventLedgerError(
                  "PROVENANCE_REBIND_REJECTED",
                  "execution provenance is bound once per Run",
                ),
              }
        }
        if (tuple.runtimeId !== this.runtimeId) {
          return {
            kind: "reject",
            error: new RunEventLedgerError(
              "PROVENANCE_INVALID",
              "execution tuple belongs to another runtime",
            ),
          }
        }
        return {
          kind: "commit",
          drafts: [],
          jobMutation: { ledgerProvenanceJson: JSON.stringify(tuple) },
        }
      },
      onCommitted: () => {
        this.state.provenance = tuple
        this.state.sealedProvenance = true
      },
    }
  }

  appendSystemEvent(input: {
    observationKey: string
    type: string
    payload?: unknown
  }): Promise<unknown> {
    const type = input?.type
    if (!(AGENT_JOB_EVENT_TYPES as readonly string[]).includes(String(type))) {
      return Promise.reject(
        new RunEventLedgerError("UNKNOWN_EVENT_TYPE", "unknown event type"),
      )
    }
    if (type === "completed" || type === "artifact_created") {
      return Promise.reject(
        new RunEventLedgerError(
          "OWNER_GATED_EVENT_TYPE",
          `${type} is minted only by its owner port`,
        ),
      )
    }
    const eventType = type as AgentJobEventType
    const payload = toJsonObject(input.payload ?? {})
    if (eventType === "status" && payload.subtype === undefined) {
      payload.subtype = "system_lifecycle"
    }
    const lifecycle = eventType === "job_created" || eventType === "job_started"
    return this.enqueue({
      observationKey: input.observationKey,
      late: lifecycle ? "none" : "host",
      lateSummary: lifecycle
        ? undefined
        : () => ({ originalType: eventType, observation: payload }),
      plan: ({ state, nowIso }) => {
        if (
          lifecycle &&
          (state.completed || TERMINAL_JOB_STATUSES.has(state.jobStatus ?? ""))
        ) {
          return {
            kind: "reject",
            error: new RunEventLedgerError(
              "RUN_ALREADY_TERMINAL",
              `${eventType} cannot be recorded on a terminal Run`,
            ),
          }
        }
        const jobMutation: JsonObject | undefined =
          eventType === "job_started"
            ? {
                status: "running",
                workerId: (payload.workerId as JsonValue) ?? null,
                workerPid: (payload.workerPid as JsonValue) ?? null,
                startedAt: nowIso,
                workerStartedAt: nowIso,
                heartbeatAt: nowIso,
              }
            : undefined
        return {
          kind: "commit",
          drafts: [{ type: eventType, payload }],
          ...(jobMutation ? { jobMutation } : {}),
        }
      },
    })
  }

  // ---- ports: coarse runtime observations ----------------------------------

  ingestRuntimeObservation(input: {
    observationKey: string
    type: string
    payload?: unknown
  }): Promise<unknown> {
    const decoded = decodeCoarseRuntimeObservation({
      type: input?.type,
      payload: input?.payload,
    })
    if (decoded.kind === "rejected") {
      return Promise.reject(
        new RunEventLedgerError(
          decoded.reason === "owner_gated_type"
            ? "OWNER_GATED_EVENT_TYPE"
            : decoded.reason === "host_lifecycle_type"
              ? "HOST_LIFECYCLE_EVENT_TYPE"
              : "UNKNOWN_EVENT_TYPE",
          `${decoded.type || "unknown"} is not a runtime observation type`,
        ),
      )
    }
    const observationKey = input.observationKey
    const prepared = () =>
      this.prepareOnce(observationKey, () =>
        this.prepareCoarse(decoded, observationKey),
      )
    return this.enqueue({
      observationKey,
      late: "native",
      requiresBinding: true,
      lateSummary: () => ({
        originalType: decoded.type,
        observation: prepared().draft.payload,
      }),
      plan: (context) => this.planCoarse(context, decoded, prepared().draft),
    })
  }

  private prepareCoarse(
    decoded: Extract<DecodedCoarseObservation, { kind: "event" }>,
    observationKey: string,
  ): { draft: Draft } {
    const payload = clone(decoded.payload)
    const rules: string[] = []
    const metadata: JsonObject = {}
    if (decoded.stream) {
      const raw = payload[decoded.stream.field]
      if (typeof raw === "string") {
        const streamed = this.streamRedact(
          decoded.stream.streamChannel,
          raw,
          observationKey,
        )
        payload[decoded.stream.field] = streamed.text
        if (streamed.pending) payload.redactionPending = true
        if (streamed.applied) rules.push("secret-hint")
        if (streamed.releasedFrom.length > 0) {
          metadata.redaction = { releasedFrom: streamed.releasedFrom }
        }
      }
    }
    if (
      (decoded.type === "assistant_delta" ||
        decoded.type === "reasoning_delta") &&
      decoded.stream
    ) {
      payload.item = {
        correlationKey: `corr-${digest(`${this.runId}\u0000${observationKey}`).slice(0, 20)}`,
        channel: decoded.stream.itemChannel,
        partIndex: 0,
      }
    }
    return {
      draft: {
        type: decoded.type,
        payload,
        appliedRules: rules,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      },
    }
  }

  private planCoarse(
    context: PlanContext,
    decoded: Extract<DecodedCoarseObservation, { kind: "event" }>,
    draft: Draft,
  ): PlanResult {
    if (decoded.type === "usage_update" && decoded.usage) {
      const usage = context.state.usage
      const dedupeKey = decoded.usage.callId
        ? `call:${decoded.usage.callId}:${decoded.usage.revision ?? 0}`
        : `observation:${digest(stableStringify(decoded.payload)).slice(0, 24)}`
      const sanitizedDedupe = this.sanitizeString(dedupeKey)
      const duplicate = usage.appliedDedupeKeys.has(sanitizedDedupe)
      const vector = decoded.usage.vector
      const total = duplicate ? usage.total : addVectors(usage.total, vector)
      const payload: JsonObject = {
        ...draft.payload,
        kind: "snapshot",
        total: (total ?? vector) as JsonValue,
        last: (duplicate ? (usage.last ?? vector) : vector) as JsonValue,
        ...(usage.baseline ? { baseline: usage.baseline as JsonValue } : {}),
        delta: subtractVectors(total ?? vector, usage.baseline) as JsonValue,
        dedupeKey: sanitizedDedupe,
        asOfSequence: context.nextSequence,
      }
      return { kind: "commit", drafts: [{ ...draft, payload }] }
    }
    if (decoded.type === "error") {
      const payload = draft.payload
      const classification =
        typeof payload.classification === "string"
          ? payload.classification
          : payload.willRetry === true
            ? "retryable"
            : "diagnostic"
      return {
        kind: "commit",
        drafts: [{ ...draft, payload: { ...payload, classification } }],
      }
    }
    if (decoded.type === "status" && draft.payload.subtype === undefined) {
      return {
        kind: "commit",
        drafts: [
          {
            ...draft,
            payload: { ...draft.payload, subtype: "system_lifecycle" },
          },
        ],
      }
    }
    return { kind: "commit", drafts: [draft] }
  }

  /** Decode/redact one observation once, even across a halted resubmit. */
  private prepareOnce<T>(observationKey: string, prepare: () => T): T {
    if (this.preparedCache.has(observationKey)) {
      return this.preparedCache.get(observationKey) as T
    }
    const prepared = prepare()
    this.preparedCache.set(observationKey, prepared)
    return prepared
  }

  // ---- ports: Codex native boundaries --------------------------------------

  ingestNotification(boundary: LedgerBoundary): Promise<unknown> {
    return this.ingestNativeBoundary(boundary, "notification")
  }

  ingestServerRequest(boundary: LedgerBoundary): Promise<unknown> {
    return this.ingestNativeBoundary(boundary, "request")
  }

  recordServerResponseSend(
    boundary: LedgerBoundary & {
      requestId: string | number
      result: "sent" | "failed"
    },
  ): Promise<unknown> {
    return this.ingestNativeBoundary(boundary, "send")
  }

  recordServerRequestResolved(
    boundary: LedgerBoundary & { requestId: string | number },
  ): Promise<unknown> {
    return this.ingestNativeBoundary(boundary, "resolved")
  }

  private ingestNativeBoundary(
    boundary: LedgerBoundary & Record<string, unknown>,
    port: "notification" | "request" | "send" | "resolved",
  ): Promise<unknown> {
    if (!boundary || !nonEmptyString(boundary.observationKey)) {
      return Promise.reject(
        new RunEventLedgerError(
          "OBSERVATION_KEY_REQUIRED",
          "boundary needs an observationKey",
        ),
      )
    }
    let decoded: CodexNativeDescriptor
    if (port === "send") {
      decoded = {
        kind: "interaction_boundary",
        boundary: "response_send",
        requestId: boundary.requestId as string | number,
        sendResult: boundary.result === "failed" ? "failed" : "sent",
        native: { requestId: boundary.requestId as string | number },
      }
    } else if (port === "resolved") {
      const requestId = boundary.requestId as string | number
      decoded = {
        kind: "interaction_boundary",
        method: "serverRequest/resolved",
        boundary: "resolved",
        requestId,
        native: { requestId },
      }
    } else {
      const descriptors = decodeCodexNativeBoundary({
        message: boundary.message,
        ...(boundary.requestId !== undefined
          ? { requestId: boundary.requestId }
          : {}),
      })
      decoded = descriptors[0] ?? {
        kind: "invalid_native_shape",
        native: {},
      }
    }
    const observationKey = boundary.observationKey
    const prepared = () =>
      this.prepareOnce(observationKey, () =>
        this.prepareNative(decoded, observationKey),
      )
    const terminal = decoded.kind === "terminal_candidate"
    return this.enqueue({
      observationKey,
      late: "native",
      requiresBinding: true,
      lateSummary: () => prepared().late,
      plan: (context) =>
        terminal
          ? this.planTerminalCandidate(prepared())
          : this.planNative(context, decoded, prepared()),
      onCommitted: () => this.applyNativeContext(decoded),
    })
  }

  /** Host-only raw interrupt target from committed native identities. */
  private applyNativeContext(decoded: CodexNativeDescriptor): void {
    const ids = decoded.native
    if (ids.threadId && ids.turnId) {
      this.nativeContext = { threadId: ids.threadId, turnId: ids.turnId }
    } else if (ids.threadId && this.nativeContext.threadId !== ids.threadId) {
      this.nativeContext = { threadId: ids.threadId }
    }
  }

  private prepareNative(
    decoded: CodexNativeDescriptor,
    observationKey: string,
  ): {
    text?: string
    pending: boolean
    applied: boolean
    releasedFrom: string[]
    late: LateSummary
  } {
    let text = decoded.text
    let pending = false
    let applied = false
    let releasedFrom: string[] = []
    const streamed =
      decoded.kind === "assistant_delta" ||
      decoded.kind === "reasoning_delta" ||
      (decoded.kind === "tool_delta" && typeof decoded.text === "string")
    if (streamed && typeof decoded.text === "string") {
      const ids = decoded.native
      const channel = `native:${decoded.kind}:${ids.threadId ?? ""}:${ids.turnId ?? ""}:${ids.itemId ?? ""}:${decoded.channel ?? ""}:${decoded.partIndex ?? ""}`
      const result = this.streamRedact(channel, decoded.text, observationKey)
      text = result.text
      pending = result.pending
      applied = result.applied
      releasedFrom = result.releasedFrom
    }
    return {
      ...(text === undefined ? {} : { text }),
      pending,
      applied,
      releasedFrom,
      late: this.nativeLateSummary(decoded, text),
    }
  }

  private nativeLateSummary(
    decoded: CodexNativeDescriptor,
    text: string | undefined,
  ): LateSummary {
    const originalType =
      decoded.kind === "assistant_delta" ||
      decoded.kind === "reasoning_delta" ||
      decoded.kind === "tool_delta" ||
      decoded.kind === "usage_update" ||
      decoded.kind === "error"
        ? decoded.kind
        : decoded.kind === "terminal_candidate"
          ? "completed"
          : "status"
    const observation: JsonObject = {}
    if (decoded.total) observation.total = decoded.total
    if (decoded.last) observation.last = decoded.last
    if (text !== undefined) observation.text = text
    if (decoded.code !== undefined) observation.code = decoded.code
    if (decoded.willRetry !== undefined)
      observation.willRetry = decoded.willRetry
    if (decoded.kind !== originalType) observation.kind = decoded.kind
    if (decoded.requestId !== undefined)
      observation.requestId = decoded.requestId
    if (decoded.boundary) observation.boundary = decoded.boundary
    if (isObject(decoded.fields)) {
      for (const [key, value] of Object.entries(decoded.fields)) {
        if (key === "item") continue
        if (
          value === null ||
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        ) {
          observation[key] = value
        }
      }
    }
    return {
      originalType,
      ...(decoded.method ? { nativeMethod: decoded.method } : {}),
      observation,
    }
  }

  private planTerminalCandidate(
    prepared: ReturnType<RunEventLedgerImpl["prepareNative"]>,
  ): PlanResult {
    return {
      kind: "commit",
      drafts: [
        {
          type: "status",
          payload: {
            subtype: "turn_lifecycle",
            method: "turn/completed",
            phase: "completed",
            terminalCandidate: true,
            ...prepared.late.observation,
          },
        },
      ],
    }
  }

  private itemDisplayKey(
    ids: CodexNativeIds,
    channel: string,
    partIndex: number,
  ): JsonObject {
    return {
      ...this.redactedIds({
        threadId: ids.threadId,
        turnId: ids.turnId,
        itemId: ids.itemId,
      }),
      channel,
      partIndex,
    }
  }

  private planNative(
    context: PlanContext,
    decoded: CodexNativeDescriptor,
    prepared: ReturnType<RunEventLedgerImpl["prepareNative"]>,
  ): PlanResult {
    const state = context.state
    const extension = this.codexExtension(decoded.native)
    const withExtension = (payload: JsonObject): JsonObject =>
      extension ? { ...payload, extensions: extension } : payload
    const streamRules = prepared.applied ? ["secret-hint"] : []
    const streamMetadata: JsonObject | undefined =
      prepared.releasedFrom.length > 0
        ? { redaction: { releasedFrom: prepared.releasedFrom } }
        : undefined
    const pendingFlag: JsonObject = prepared.pending
      ? { redactionPending: true }
      : {}

    switch (decoded.kind) {
      case "assistant_delta":
      case "reasoning_delta":
      case "tool_delta": {
        const channel =
          decoded.kind === "assistant_delta"
            ? "assistant"
            : decoded.kind === "reasoning_delta"
              ? (decoded.channel ?? "text")
              : "tool"
        let partIndex = 0
        let indexSource: "native" | "inferred" | undefined
        if (decoded.kind === "reasoning_delta") {
          if (typeof decoded.partIndex === "number") {
            partIndex = decoded.partIndex
            indexSource = "native"
          } else {
            partIndex =
              channel === "summary"
                ? (state.lastSummaryPart.get(
                    itemBaseKey(
                      this.itemDisplayKey(decoded.native, channel, 0),
                    ),
                  ) ?? 0)
                : 0
            indexSource = "inferred"
          }
        }
        const itemKey = {
          ...this.itemDisplayKey(decoded.native, channel, partIndex),
          ...(indexSource ? { indexSource } : {}),
        }
        const existing = state.items.get(itemMapKey(itemKey))
        if (existing?.state === "completed") {
          return {
            kind: "commit",
            drafts: [
              {
                type: "status",
                payload: withExtension({
                  subtype: "item_reconciliation",
                  method: decoded.method ?? null,
                  ignoredDelta: true,
                  item: {
                    ...existing.key,
                    ...(existing.itemType
                      ? { itemType: existing.itemType }
                      : {}),
                    ...(existing.indexSource
                      ? { indexSource: existing.indexSource }
                      : {}),
                    state: existing.state,
                    text: existing.text,
                  },
                  reconciliation: {
                    ...(existing.result ? { result: existing.result } : {}),
                    lossPossible: existing.lossPossible,
                    missingStart: existing.missingStart,
                    suppressedDuplicateCount:
                      existing.suppressedDuplicateCount + 1,
                  },
                }),
              },
            ],
          }
        }
        const textField =
          decoded.kind === "tool_delta"
            ? String(decoded.fields?.textField ?? "output")
            : "text"
        const payload: JsonObject = {
          ...(decoded.kind === "tool_delta"
            ? {
                toolCallId: decoded.native.itemId ?? null,
                status: "running",
              }
            : {}),
          ...(prepared.text !== undefined
            ? { [textField]: prepared.text }
            : {}),
          ...(decoded.kind === "tool_delta" && isObject(decoded.fields)
            ? Object.fromEntries(
                Object.entries(decoded.fields).filter(
                  ([key]) => key !== "textField",
                ),
              )
            : {}),
          ...pendingFlag,
          item: itemKey,
        }
        return {
          kind: "commit",
          drafts: [
            {
              type: decoded.kind,
              payload: withExtension(payload),
              appliedRules: streamRules,
              ...(streamMetadata ? { metadata: streamMetadata } : {}),
            },
          ],
        }
      }
      case "reasoning_part":
        return {
          kind: "commit",
          drafts: [
            {
              type: "status",
              payload: withExtension({
                subtype: "reasoning_part",
                method: decoded.method ?? null,
                item: this.itemDisplayKey(
                  decoded.native,
                  "summary",
                  decoded.partIndex ?? 0,
                ),
              }),
            },
          ],
        }
      case "usage_update":
        return this.planSnapshotUsage(context, decoded, withExtension)
      case "error": {
        const willRetry = decoded.willRetry === true
        return {
          kind: "commit",
          drafts: [
            {
              type: "error",
              payload: withExtension({
                message: decoded.text ?? "Codex app-server error",
                ...(decoded.code !== undefined ? { code: decoded.code } : {}),
                ...(decoded.willRetry !== undefined
                  ? { willRetry: decoded.willRetry }
                  : {}),
                classification: willRetry ? "retryable" : "fatal_candidate",
              }),
            },
          ],
        }
      }
      case "item_started":
      case "item_completed":
        return this.planItem(context, decoded, withExtension)
      case "interaction_boundary":
        return this.planBoundary(decoded, withExtension)
      case "unknown_native_method":
        return {
          kind: "commit",
          drafts: [
            {
              type: "status",
              payload: {
                subtype: "unknown_native_method",
                method: decoded.method ?? "unknown",
                lossPossible: true,
                ...(decoded.boundary ? { boundary: decoded.boundary } : {}),
                ...(decoded.requestId !== undefined
                  ? { requestId: decoded.requestId }
                  : {}),
              },
            },
          ],
        }
      case "invalid_native_shape":
        return {
          kind: "commit",
          drafts: [
            {
              type: "status",
              payload: {
                subtype: "warning",
                reason: "invalid_native_shape",
                method: decoded.method ?? "unknown",
                lossPossible: true,
              },
            },
          ],
        }
      default: {
        const fields = isObject(decoded.fields) ? decoded.fields : {}
        return {
          kind: "commit",
          drafts: [
            {
              type: "status",
              payload: withExtension({
                subtype: decoded.kind,
                ...(decoded.method ? { method: decoded.method } : {}),
                ...(toJsonObject(fields) as JsonObject),
              }),
            },
          ],
        }
      }
    }
  }

  private planSnapshotUsage(
    context: PlanContext,
    decoded: CodexNativeDescriptor,
    withExtension: (payload: JsonObject) => JsonObject,
  ): PlanResult {
    const usage = context.state.usage
    const total = numericVector(decoded.total) ?? {}
    const last = numericVector(decoded.last)
    const ids = this.redactedIds({
      threadId: decoded.native.threadId,
      turnId: decoded.native.turnId,
    })
    const dedupeKey = `codex-snapshot:${digest(
      stableStringify({ ids, total, last }),
    ).slice(0, 32)}`
    let baseline = usage.baseline
    let discontinuity = false
    const reference = baseline ?? usage.total
    if (
      reference &&
      typeof total.totalTokens === "number" &&
      typeof reference.totalTokens === "number" &&
      total.totalTokens < reference.totalTokens
    ) {
      discontinuity = true
      baseline = zeroVector(total)
    }
    const delta = subtractVectors(total, baseline)
    return {
      kind: "commit",
      drafts: [
        {
          type: "usage_update",
          payload: withExtension({
            kind: "snapshot",
            total,
            ...(last ? { last } : {}),
            ...(baseline ? { baseline } : {}),
            delta,
            dedupeKey,
            asOfSequence: context.nextSequence,
            ...(discontinuity
              ? {
                  discontinuity: true,
                  discontinuityBasis: "counter_decrease_inference",
                }
              : {}),
            ...(isObject(decoded.fields) ? toJsonObject(decoded.fields) : {}),
          }),
        },
      ],
    }
  }

  private planBoundary(
    decoded: CodexNativeDescriptor,
    withExtension: (payload: JsonObject) => JsonObject,
  ): PlanResult {
    const requestId = decoded.requestId ?? null
    const method =
      decoded.method && decoded.boundary !== "resolved"
        ? decoded.method
        : decoded.boundary === "response_send" && requestId !== null
          ? this.state.requests.get(JSON.stringify(requestId))
          : undefined
    return {
      kind: "commit",
      drafts: [
        {
          type: "status",
          payload: withExtension({
            subtype: "interaction_boundary",
            boundary: decoded.boundary ?? "request",
            requestId,
            ...(method ? { method } : {}),
            ...(decoded.boundary === "response_send"
              ? { sendResult: decoded.sendResult ?? "sent" }
              : {}),
          }),
        },
      ],
    }
  }

  private planItem(
    context: PlanContext,
    decoded: CodexNativeDescriptor,
    withExtension: (payload: JsonObject) => JsonObject,
  ): PlanResult {
    const fields = isObject(decoded.fields) ? decoded.fields : {}
    const itemType = String(fields.itemType ?? "")
    const nativeItem = isObject(fields.item) ? fields.item : {}
    const disposition = CODEX_THREAD_ITEM_DISPOSITIONS[itemType]
    const started = decoded.kind === "item_started"
    const baseKey = this.redactedIds({
      threadId: decoded.native.threadId,
      turnId: decoded.native.turnId,
      itemId: decoded.native.itemId,
    })
    if (!disposition) {
      return {
        kind: "commit",
        drafts: [
          {
            type: "status",
            payload: withExtension({
              subtype: "item_lifecycle",
              phase: started ? "started" : "completed",
              item: { ...baseKey, itemType },
              unknownItemVariant: true,
              lossPossible: true,
            }),
          },
        ],
      }
    }
    if (disposition === "tool") {
      return this.planToolItem(
        context,
        decoded,
        itemType,
        nativeItem,
        withExtension,
      )
    }
    if (disposition === "assistant" || disposition === "reasoning") {
      if (started) {
        return {
          kind: "commit",
          drafts: [
            {
              type: "status",
              payload: withExtension({
                subtype: "item_lifecycle",
                phase: "started",
                item: { ...baseKey, itemType },
              }),
            },
          ],
        }
      }
      const drafts =
        disposition === "assistant"
          ? this.assistantReconciliation(
              context,
              baseKey,
              itemType,
              typeof nativeItem.text === "string"
                ? this.sanitizeString(nativeItem.text)
                : "",
              { lossPossible: false },
            )
          : this.reasoningReconciliation(context, baseKey, nativeItem, {
              lossPossible: false,
            })
      return {
        kind: "commit",
        drafts: drafts.map((draft) => ({
          ...draft,
          payload: withExtension(draft.payload),
        })),
      }
    }
    const summaryFields = this.nonToolItemFields(itemType, nativeItem)
    return {
      kind: "commit",
      drafts: [
        {
          type: "status",
          payload: withExtension({
            subtype: disposition,
            phase: started ? "started" : "completed",
            item: { ...baseKey, itemType },
            ...summaryFields,
          }),
        },
      ],
    }
  }

  private nonToolItemFields(
    itemType: string,
    item: Record<string, unknown>,
  ): JsonObject {
    switch (itemType) {
      case "plan":
        return typeof item.text === "string" ? { text: item.text } : {}
      case "enteredReviewMode":
      case "exitedReviewMode":
        return typeof item.review === "string" ? { review: item.review } : {}
      case "hookPrompt":
        return {
          fragmentCount: Array.isArray(item.fragments)
            ? item.fragments.length
            : 0,
        }
      case "userMessage":
        return {
          contentCount: Array.isArray(item.content) ? item.content.length : 0,
        }
      default:
        return {}
    }
  }

  private reconciliationDraft(input: {
    key: JsonObject
    itemType: string
    state: "started" | "streaming" | "completed"
    text?: string
    fields?: JsonObject
    indexSource?: "native" | "inferred"
    result: string
    lossPossible: boolean
    missingStart: boolean
    suppressedDuplicateCount: number
    extra?: JsonObject
  }): Draft {
    return {
      type: "status",
      payload: {
        subtype: "item_reconciliation",
        item: {
          ...input.key,
          itemType: input.itemType,
          state: input.state,
          ...(input.text !== undefined ? { text: input.text } : {}),
          ...(input.fields ? { fields: input.fields } : {}),
          ...(input.indexSource ? { indexSource: input.indexSource } : {}),
        },
        reconciliation: {
          result: input.result,
          lossPossible: input.lossPossible,
          missingStart: input.missingStart,
          suppressedDuplicateCount: input.suppressedDuplicateCount,
        },
        ...(input.extra ?? {}),
      },
    }
  }

  private finalPartDraft(
    context: PlanContext,
    key: JsonObject,
    itemType: string,
    finalText: string,
    options: { lossPossible: boolean; extra?: JsonObject },
  ): Draft {
    const local = context.state.items.get(itemMapKey(key))
    if (local?.state === "completed") {
      const equal = local.text === finalText
      return this.reconciliationDraft({
        key: local.key,
        itemType,
        state: "completed",
        text: equal ? local.text : finalText,
        indexSource: local.indexSource,
        result: equal ? (local.result ?? "matched") : "mismatch",
        lossPossible: equal ? local.lossPossible : true,
        missingStart: local.missingStart,
        suppressedDuplicateCount:
          local.suppressedDuplicateCount + (equal ? 1 : 0),
        extra: options.extra,
      })
    }
    const { result, lossPossible } = reconcileText(local, finalText)
    const missingStart = local?.missingStart ?? false
    const indexSource = local?.indexSource
    return this.reconciliationDraft({
      key,
      itemType,
      state: "completed",
      text: finalText,
      indexSource,
      result,
      lossPossible:
        lossPossible ||
        missingStart ||
        indexSource === "inferred" ||
        options.lossPossible,
      missingStart,
      suppressedDuplicateCount: local?.suppressedDuplicateCount ?? 0,
      extra: options.extra,
    })
  }

  private assistantReconciliation(
    context: PlanContext,
    baseKey: JsonObject,
    itemType: string,
    finalText: string,
    options: { lossPossible: boolean; extra?: JsonObject },
  ): Draft[] {
    return [
      this.finalPartDraft(
        context,
        { ...baseKey, channel: "assistant", partIndex: 0 },
        itemType,
        finalText,
        options,
      ),
    ]
  }

  private reasoningReconciliation(
    context: PlanContext,
    baseKey: JsonObject,
    nativeItem: Record<string, unknown>,
    options: { lossPossible: boolean; extra?: JsonObject },
  ): Draft[] {
    const drafts: Draft[] = []
    const seen = new Set<string>()
    for (const [channel, field] of [
      ["text", "content"],
      ["summary", "summary"],
    ] as const) {
      const parts = Array.isArray(nativeItem[field]) ? nativeItem[field] : []
      parts.forEach((part, partIndex) => {
        const text =
          typeof part === "string"
            ? part
            : isObject(part) && typeof part.text === "string"
              ? part.text
              : ""
        const key = { ...baseKey, channel, partIndex }
        seen.add(itemMapKey(key))
        drafts.push(
          this.finalPartDraft(
            context,
            key,
            "reasoning",
            this.sanitizeString(text),
            options,
          ),
        )
      })
    }
    for (const part of context.state.items.values()) {
      if (
        itemBaseKey(part.key) !== itemBaseKey(baseKey) ||
        seen.has(itemMapKey(part.key)) ||
        part.state === "completed"
      ) {
        continue
      }
      drafts.push(
        this.reconciliationDraft({
          key: part.key,
          itemType: "reasoning",
          state: "completed",
          text: part.text,
          indexSource: part.indexSource,
          result: "mismatch",
          lossPossible: true,
          missingStart: part.missingStart,
          suppressedDuplicateCount: part.suppressedDuplicateCount,
          extra: options.extra,
        }),
      )
    }
    if (drafts.length === 0) {
      drafts.push({
        type: "status",
        payload: {
          subtype: "item_reconciliation",
          item: { ...baseKey, itemType: "reasoning", state: "completed" },
          reconciliation: {
            result: "matched",
            lossPossible: false,
            missingStart: !context.state.itemsStarted.has(itemBaseKey(baseKey)),
            suppressedDuplicateCount: 0,
          },
          ...(options.extra ?? {}),
        },
      })
    }
    return drafts
  }

  private planToolItem(
    context: PlanContext,
    decoded: CodexNativeDescriptor,
    itemType: string,
    nativeItem: Record<string, unknown>,
    withExtension: (payload: JsonObject) => JsonObject,
  ): PlanResult {
    const key = {
      ...this.itemDisplayKey(decoded.native, "tool", 0),
    }
    const toolName =
      typeof nativeItem.tool === "string" ? nativeItem.tool : itemType
    const fields = toJsonObject(nativeItem)
    const nativeStatus =
      typeof nativeItem.status === "string" ? nativeItem.status : null
    if (decoded.kind === "item_started") {
      const existing = context.state.items.get(itemMapKey(key))
      if (existing && existing.state !== "started") {
        return {
          kind: "commit",
          drafts: [
            {
              type: "status",
              payload: withExtension({
                subtype: "item_lifecycle",
                phase: "started",
                lateStart: true,
                item: { ...key, itemType },
              }),
            },
          ],
        }
      }
      return {
        kind: "commit",
        drafts: [
          {
            type: "tool_started",
            payload: withExtension({
              toolName,
              toolCallId: decoded.native.itemId ?? null,
              status: "started",
              item: { ...key, itemType },
              fields,
            }),
          },
        ],
      }
    }
    const local = context.state.items.get(itemMapKey(key))
    if (local?.state === "completed") {
      const equal =
        stableStringify(local.fields ?? {}) === stableStringify(fields)
      const repeated = this.reconciliationDraft({
        key: local.key,
        itemType,
        state: "completed",
        fields: equal ? (local.fields ?? fields) : fields,
        result: equal ? (local.result ?? "matched") : "mismatch",
        lossPossible: equal ? local.lossPossible : true,
        missingStart: local.missingStart,
        suppressedDuplicateCount:
          local.suppressedDuplicateCount + (equal ? 1 : 0),
      })
      return {
        kind: "commit",
        drafts: [{ ...repeated, payload: withExtension(repeated.payload) }],
      }
    }
    const missingStart = local ? local.missingStart : true
    const finished: Draft = {
      type: "tool_finished",
      payload: withExtension({
        toolName,
        toolCallId: decoded.native.itemId ?? null,
        status: nativeStatus === "failed" ? "failed" : "completed",
        item: { ...key, itemType },
      }),
    }
    const reconciliation = this.reconciliationDraft({
      key,
      itemType,
      state: "completed",
      fields,
      result: local ? "matched" : "missing_local",
      lossPossible: missingStart || !local,
      missingStart,
      suppressedDuplicateCount: 0,
    })
    return {
      kind: "commit",
      drafts: [
        finished,
        { ...reconciliation, payload: withExtension(reconciliation.payload) },
      ],
    }
  }

  // ---- ports: responses and resume validation -----------------------------

  ingestResponse(boundary: LedgerBoundary): Promise<unknown> {
    if (!boundary || !nonEmptyString(boundary.observationKey)) {
      return Promise.reject(
        new RunEventLedgerError(
          "OBSERVATION_KEY_REQUIRED",
          "boundary needs an observationKey",
        ),
      )
    }
    const message = isObject(boundary.message) ? boundary.message : {}
    const request = isObject(boundary.request) ? boundary.request : null
    const summary: LateSummary = {
      originalType: "status",
      nativeMethod:
        request && typeof request.method === "string"
          ? request.method
          : undefined,
      observation: {
        kind: "protocol_response",
        jsonRpcId: (message.id as JsonValue) ?? null,
      },
    }
    return this.enqueue({
      observationKey: boundary.observationKey,
      late: "native",
      requiresBinding: true,
      lateSummary: () => summary,
      plan: (context) => this.planResponse(context, message, request),
      onCommitted: () => {
        const result = isObject(message.result) ? message.result : {}
        const thread = isObject(result.thread) ? result.thread : null
        const turn = isObject(result.turn) ? result.turn : null
        if (thread && typeof thread.id === "string") {
          this.nativeContext = { threadId: thread.id }
        }
        if (
          turn &&
          typeof turn.id === "string" &&
          request &&
          isObject(request.params) &&
          typeof request.params.threadId === "string"
        ) {
          this.nativeContext = {
            threadId: request.params.threadId,
            turnId: turn.id,
          }
        }
      },
    })
  }

  private planResponse(
    context: PlanContext,
    message: Record<string, unknown>,
    request: Record<string, unknown> | null,
  ): PlanResult {
    const jsonRpcId = message.id as JsonValue
    const correlated =
      request !== null &&
      (typeof message.id === "string" || typeof message.id === "number") &&
      JSON.stringify(request.id) === JSON.stringify(message.id)
    const result = isObject(message.result) ? message.result : null
    const error = isObject(message.error) ? message.error : null
    const thread = result && isObject(result.thread) ? result.thread : null
    const method =
      request && typeof request.method === "string" ? request.method : null
    const intent =
      request && typeof request.intent === "string" ? request.intent : undefined
    const ids: CodexNativeIds = {}
    if (thread && typeof thread.id === "string") ids.threadId = thread.id
    if (thread && nonEmptyString(thread.sessionId))
      ids.sessionId = thread.sessionId
    const extension = this.codexExtension(ids)
    const withExtension = (payload: JsonObject): JsonObject =>
      extension ? { ...payload, extensions: extension } : payload

    if (!correlated) {
      return {
        kind: "commit",
        drafts: [
          {
            type: "status",
            payload: withExtension({
              subtype: "protocol_response",
              correlated: false,
              jsonRpcId: jsonRpcId ?? null,
            }),
          },
        ],
      }
    }
    if (method !== "thread/resume") {
      return {
        kind: "commit",
        drafts: [
          {
            type: "status",
            payload: withExtension({
              subtype: "protocol_response",
              correlated: true,
              jsonRpcId,
              method,
              ...(intent ? { intent } : {}),
              ...(error
                ? {
                    code: (error.code as JsonValue) ?? null,
                    ...(typeof error.message === "string"
                      ? { errorMessage: error.message }
                      : {}),
                  }
                : {}),
            }),
          },
        ],
      }
    }
    const params = request && isObject(request.params) ? request.params : {}
    const requestedThreadId =
      typeof params.threadId === "string" ? params.threadId : null
    const expectedSessionId =
      request && typeof request.expectedSessionId === "string"
        ? request.expectedSessionId
        : null
    const base: JsonObject = {
      jsonRpcId,
      ...(requestedThreadId ? { requestedThreadId } : {}),
      ...(intent ? { intent } : {}),
    }
    if (error) {
      const code = error.code as JsonValue
      const errorMessage =
        typeof error.message === "string" ? error.message : undefined
      const race =
        code === -32600 &&
        /no rollout/i.test(errorMessage ?? "") &&
        context.state.observedTurnStart
      return {
        kind: "commit",
        drafts: [
          {
            type: "status",
            payload: withExtension({
              subtype: "native_resume_rejected",
              ...base,
              reason: "native_error",
              code: code ?? null,
              ...(errorMessage ? { errorMessage } : {}),
              ...(race ? { raceContext: "start_resume_no_rollout" } : {}),
            }),
          },
        ],
      }
    }
    const returnedThreadId =
      thread && typeof thread.id === "string" ? thread.id : null
    const sessionId =
      thread && nonEmptyString(thread.sessionId) ? thread.sessionId : null
    const observed: JsonObject = {
      ...(returnedThreadId ? { returnedThreadId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(thread && thread.status !== undefined
        ? { observedThreadStatus: toJson(thread.status) }
        : {}),
    }
    let reason: string | null = null
    if (!returnedThreadId || returnedThreadId !== requestedThreadId) {
      reason = "thread_mismatch"
    } else if (!sessionId) {
      reason = "session_missing"
    } else if (expectedSessionId !== null && sessionId !== expectedSessionId) {
      reason = "session_mismatch"
    }
    if (reason) {
      return {
        kind: "commit",
        drafts: [
          {
            type: "status",
            payload: withExtension({
              subtype: "native_resume_rejected",
              ...base,
              ...observed,
              reason,
            }),
          },
        ],
      }
    }
    const ephemeral = thread?.ephemeral
    const path = thread && nonEmptyString(thread.path) ? thread.path : null
    const cliVersion =
      thread && nonEmptyString(thread.cliVersion) ? thread.cliVersion : null
    const durableEvidence = ephemeral === false && !!path && !!cliVersion
    return {
      kind: "commit",
      drafts: [
        {
          type: "status",
          payload: withExtension({
            subtype: "native_resume_validated",
            ...base,
            ...observed,
            ...(typeof ephemeral === "boolean" ? { ephemeral } : {}),
            ...(path ? { path } : {}),
            ...(cliVersion ? { cliVersion } : {}),
            durableEvidence,
            lossPossible: !durableEvidence,
          }),
        },
      ],
    }
  }

  // ---- ports: Claude SDK messages ------------------------------------------

  ingestClaudeMessage(input: {
    observationKey: string
    queryId?: string
    message?: unknown
    resumeIntent?: unknown
  }): Promise<unknown> {
    const message = isObject(input?.message) ? input.message : {}
    const intent = isObject(input?.resumeIntent) ? input.resumeIntent : null
    const queryId = typeof input?.queryId === "string" ? input.queryId : null
    const messageType =
      typeof message.type === "string" ? message.type : "unknown"
    const messageSubtype =
      typeof message.subtype === "string" ? message.subtype : null
    return this.enqueue({
      observationKey: input.observationKey,
      late: "native",
      requiresBinding: true,
      lateSummary: () => ({
        originalType: "status",
        observation: {
          messageType,
          ...(messageSubtype ? { messageSubtype } : {}),
        },
      }),
      plan: ({ state }) => {
        const correlated =
          !!intent &&
          nonEmptyString(intent.resume) &&
          queryId !== null &&
          intent.queryId === queryId
        const base: JsonObject = {
          queryId: queryId ?? null,
          messageType,
          ...(messageSubtype ? { messageSubtype } : {}),
        }
        if (messageType === "system" && messageSubtype === "init") {
          const sessionId =
            typeof message.session_id === "string" ? message.session_id : null
          if (!correlated || !intent) {
            return {
              kind: "commit",
              drafts: [
                {
                  type: "status",
                  payload: {
                    subtype: "session_lifecycle",
                    ...base,
                    correlated: false,
                  },
                },
              ],
            }
          }
          const source = String(intent.resume)
          const fork = intent.forkSession === true
          const valid = fork
            ? isUuid(sessionId) && sessionId !== source
            : sessionId === source
          return {
            kind: "commit",
            drafts: [
              {
                type: "status",
                payload: {
                  subtype: valid
                    ? "native_resume_validated"
                    : "native_resume_rejected",
                  ...base,
                  intent: fork ? "fork" : "resume",
                  requestedSessionId: source,
                  ...(sessionId ? { sessionId } : {}),
                  ...(nonEmptyString(intent.resumeSessionAt)
                    ? { resumeSessionAt: intent.resumeSessionAt }
                    : {}),
                  ...(valid
                    ? {}
                    : {
                        reason: fork
                          ? "fork_session_not_distinct"
                          : "session_mismatch",
                      }),
                },
              },
            ],
          }
        }
        if (
          messageType === "result" &&
          correlated &&
          queryId !== null &&
          !state.claudeQueries.has(queryId)
        ) {
          const errors = Array.isArray(message.errors)
            ? message.errors.filter((entry) => typeof entry === "string")
            : []
          return {
            kind: "commit",
            drafts: [
              {
                type: "status",
                payload: {
                  subtype: "native_resume_rejected",
                  ...base,
                  intent: intent?.forkSession === true ? "fork" : "resume",
                  reason: "result_before_init",
                  ...(errors.length > 0
                    ? { diagnostic: errors.join("; ") }
                    : {}),
                  ...(message.is_error === true ? { isError: true } : {}),
                },
              },
            ],
          }
        }
        return {
          kind: "commit",
          drafts: [
            {
              type: "status",
              payload: {
                subtype:
                  messageType === "result"
                    ? "runtime_result"
                    : "runtime_message",
                ...base,
                ...(message.is_error === true ? { isError: true } : {}),
              },
            },
          ],
        }
      },
    })
  }

  // ---- ports: transport exit, repair, settle -------------------------------

  ingestTransportExit(input: {
    observationKey: string
    transportId?: string
    exitCode?: number | null
    signal?: string | null
  }): Promise<unknown> {
    const synthetic: JsonObject = {
      source: "transport_exit",
      transportId: input?.transportId ?? null,
      exitCode: input?.exitCode ?? null,
      signal: input?.signal ?? null,
    }
    return this.enqueue({
      observationKey: input.observationKey,
      late: "native",
      requiresBinding: true,
      lateSummary: () => ({
        originalType: "completed",
        observation: { kind: "transport_exit", ...synthetic },
      }),
      plan: (context) =>
        this.planCompleted(context, {
          status: "interrupted",
          reasons: ["transport_exit"],
          evidenceKeys: [],
          synthetic,
        }),
      afterCommit: () => this.flushLate(),
    })
  }

  repairFromSnapshot(input: {
    observationKey: string
    snapshot?: unknown
    sourceProvenance?: unknown
    schemaDisposition?: "recognized" | "incompatible"
    targetTurnId?: string
  }): Promise<unknown> {
    const snapshot = isObject(input?.snapshot) ? input.snapshot : {}
    const thread = isObject(snapshot.thread) ? snapshot.thread : snapshot
    const recognized = input?.schemaDisposition !== "incompatible"
    // Built at plan time so the target is the Run's bound tuple.
    const repairMetadata = (): JsonObject => ({
      source: "snapshot",
      result: recognized ? "reconciled" : "mismatch",
      schemaDisposition: recognized ? "recognized" : "incompatible",
      // Policy/inference labels: a snapshot is not lossless event replay and
      // an incompatible schema is a defensive policy, not a measured failure.
      evidenceLimits: recognized
        ? ["snapshot_not_event_replay"]
        : ["snapshot_not_event_replay", "incompatible_schema_policy"],
      ...(nonEmptyString(thread.cliVersion)
        ? { creatorVersion: thread.cliVersion }
        : {}),
      ...(nonEmptyString(input?.targetTurnId)
        ? { targetTurnId: input.targetTurnId }
        : {}),
      sourceProvenance: this.schemaEvidence(input?.sourceProvenance),
      targetProvenance: this.schemaEvidence(this.state.provenance),
    })
    const tokenUsage = isObject(snapshot.tokenUsage)
      ? snapshot.tokenUsage
      : null
    const usageBaseline = numericVector(tokenUsage?.total)
    return this.enqueue({
      observationKey: input.observationKey,
      late: "native",
      requiresBinding: true,
      lateSummary: () => ({
        originalType: "status",
        observation: { kind: "repair" },
        extra: { repair: repairMetadata(), lossPossible: true },
      }),
      plan: (context) => {
        const repair = repairMetadata()
        const drafts: Draft[] = [
          {
            type: "status",
            payload: {
              subtype: "repair",
              repair,
              lossPossible: true,
              ...(usageBaseline ? { usageBaseline } : {}),
            },
          },
        ]
        if (recognized) {
          drafts.push(
            ...this.snapshotItemDrafts(context, thread, input?.targetTurnId),
          )
        }
        return { kind: "commit", drafts }
      },
    })
  }

  private schemaEvidence(value: unknown): JsonObject {
    if (!isObject(value)) return {}
    const evidence: JsonObject = {}
    for (const key of [
      "kind",
      "installationId",
      "runtimeId",
      "version",
      "locusBuild",
    ]) {
      if (typeof value[key] === "string") evidence[key] = value[key] as string
    }
    if (Array.isArray(value.schemaFiles)) {
      evidence.schemaFiles = value.schemaFiles
        .filter(isObject)
        .map((entry) => ({
          path: String(entry.path ?? ""),
          sha256: String(entry.sha256 ?? ""),
        }))
    }
    if (typeof value.schemaSha256 === "string") {
      evidence.schemaSha256 = value.schemaSha256
    }
    return evidence
  }

  private snapshotItemDrafts(
    context: PlanContext,
    thread: Record<string, unknown>,
    targetTurnId: string | undefined,
  ): Draft[] {
    const drafts: Draft[] = []
    const threadId = typeof thread.id === "string" ? thread.id : undefined
    const turns = Array.isArray(thread.turns)
      ? thread.turns.filter(isObject)
      : []
    const turn = turns.find((entry) => entry.id === targetTurnId)
    if (!turn || !threadId || !targetTurnId) return drafts
    const extra: JsonObject = { repair: { source: "snapshot" } }
    const seenItems = new Set<string>()
    for (const item of Array.isArray(turn.items)
      ? turn.items.filter(isObject)
      : []) {
      const itemType = typeof item.type === "string" ? item.type : ""
      const itemId = typeof item.id === "string" ? item.id : null
      if (!itemId) continue
      const baseKey = this.redactedIds({
        threadId,
        turnId: targetTurnId,
        itemId,
      })
      seenItems.add(itemBaseKey(baseKey))
      const disposition = CODEX_THREAD_ITEM_DISPOSITIONS[itemType]
      if (disposition === "assistant") {
        drafts.push(
          ...this.assistantReconciliation(
            context,
            baseKey,
            itemType,
            typeof item.text === "string" ? this.sanitizeString(item.text) : "",
            { lossPossible: true, extra },
          ),
        )
      } else if (disposition === "reasoning") {
        drafts.push(
          ...this.reasoningReconciliation(context, baseKey, item, {
            lossPossible: true,
            extra,
          }),
        )
      }
    }
    const targetKey = this.sanitizeString(targetTurnId)
    const threadKey = this.sanitizeString(threadId)
    for (const part of context.state.items.values()) {
      if (
        part.key.turnId !== targetKey ||
        part.key.threadId !== threadKey ||
        seenItems.has(itemBaseKey(part.key)) ||
        part.state === "completed"
      ) {
        continue
      }
      drafts.push(
        this.reconciliationDraft({
          key: part.key,
          itemType: part.itemType ?? "agentMessage",
          state: part.state,
          text: part.text,
          indexSource: part.indexSource,
          result: "missing_native",
          lossPossible: true,
          missingStart: part.missingStart,
          suppressedDuplicateCount: part.suppressedDuplicateCount,
          extra,
        }),
      )
    }
    return drafts
  }

  settle(evidence: OutcomeEvidence): Promise<unknown> {
    const trigger = isObject(evidence?.trigger)
      ? (evidence.trigger as Record<string, unknown>)
      : null
    if (!trigger || !nonEmptyString(trigger.observationKey)) {
      return Promise.reject(
        new RunEventLedgerError(
          "OUTCOME_EVIDENCE_INVALID",
          "settle requires a trigger with an observationKey",
        ),
      )
    }
    const triggerKind = String(trigger.kind)
    return this.enqueue({
      observationKey: `settle:${trigger.observationKey}`,
      late: "settle",
      lateSummary: () => ({
        originalType: "completed",
        observation: {
          kind: "competing_terminal",
          triggerKind,
          ...(typeof trigger.status === "string"
            ? { status: trigger.status }
            : {}),
        },
      }),
      plan: (context) => {
        if (
          triggerKind === "cancel" &&
          trigger.reason === "queued_cancel" &&
          context.state.jobStatus !== null &&
          context.state.jobStatus !== "queued"
        ) {
          return {
            kind: "commit",
            drafts: [
              {
                type: "status",
                payload: {
                  subtype: "system_lifecycle",
                  status: "cancel_requested",
                  reason: "queued_cancel",
                },
              },
            ],
            jobMutation: { cancelRequestedAt: context.nowIso },
          }
        }
        if (
          triggerKind === "recovery" &&
          trigger.confidence !== undefined &&
          trigger.confidence !== "confirmed"
        ) {
          return {
            kind: "reject",
            error: new RunEventLedgerError(
              "RECOVERY_NOT_CONFIRMED",
              "only confirmed-stopped recovery may settle a Run",
            ),
          }
        }
        return this.planCompleted(
          context,
          this.resolveOutcome(evidence, context.nowIso),
        )
      },
      afterCommit: () => this.flushLate(),
    })
  }

  private resolveOutcome(
    evidence: OutcomeEvidence,
    nowIso: string,
  ): {
    status: string
    reasons: string[]
    evidenceKeys: string[]
    synthetic?: JsonObject
    recovery?: JsonObject
    code?: JsonValue
    message?: string
  } {
    const trigger = evidence.trigger as Record<string, unknown>
    const evidenceKeys = [
      ...new Set(
        [
          ...(evidence.policy?.evidenceKeys ?? []),
          ...(evidence.output?.evidenceKeys ?? []),
          ...(evidence.postRun?.evidenceKeys ?? []),
        ].filter((key): key is string => typeof key === "string"),
      ),
    ]
    const reason = typeof trigger.reason === "string" ? trigger.reason : null
    switch (trigger.kind) {
      case "cancel":
        return {
          status: "canceled",
          reasons: reason ? [reason] : ["canceled"],
          evidenceKeys,
          synthetic: { source: "cancel" },
        }
      case "interrupt":
        return {
          status: "interrupted",
          reasons: reason ? [reason] : ["interrupted"],
          evidenceKeys,
          synthetic: { source: "interrupt" },
        }
      case "transport_exit":
        return {
          status: "interrupted",
          reasons: ["transport_exit"],
          evidenceKeys,
          synthetic: {
            source: "transport_exit",
            transportId: (trigger.transportId as JsonValue) ?? null,
            exitCode: (trigger.exitCode as JsonValue) ?? null,
            signal: (trigger.signal as JsonValue) ?? null,
          },
        }
      case "recovery":
        return {
          status: "interrupted",
          reasons: reason ? [reason] : ["recovery"],
          evidenceKeys,
          synthetic: { source: "recovery" },
          recovery: {
            confidence: "confirmed",
            basis:
              typeof trigger.basis === "string" && trigger.basis.length > 0
                ? trigger.basis
                : (reason ?? "confirmed_stopped"),
            observedAt:
              typeof trigger.observedAt === "string"
                ? trigger.observedAt
                : nowIso,
          },
        }
      default:
        break
    }
    const failures: string[] = []
    if (evidence.policy?.denied) failures.push("policy_denied")
    if (!evidence.output?.valid) failures.push("output_invalid")
    if (evidence.output?.empty && !evidence.output?.allowEmpty) {
      failures.push("output_empty")
    }
    if (!evidence.postRun?.credentialsSafe) {
      failures.push("credential_postcheck_failed")
    }
    const successTrigger =
      (trigger.kind === "native_terminal" &&
        trigger.status === "succeeded" &&
        trigger.origin === "live") ||
      (trigger.kind === "host_result" && trigger.status === "succeeded")
    if (trigger.kind === "native_terminal" && trigger.status === "failed") {
      failures.push("native_failed")
    } else if (trigger.kind === "host_result" && trigger.status === "failed") {
      failures.push("host_failed")
    } else if (!successTrigger) {
      failures.push("success_evidence_missing")
    }
    if (successTrigger && (evidence.output?.evidenceKeys ?? []).length === 0) {
      failures.push("output_evidence_missing")
    }
    const failed = failures.length > 0
    const code = trigger.code
    return {
      status: failed ? "failed" : "succeeded",
      reasons: [...new Set(failures)],
      evidenceKeys,
      ...(typeof code === "string" || typeof code === "number" ? { code } : {}),
      ...(failed && this.state.lastErrorMessage
        ? { message: this.state.lastErrorMessage }
        : {}),
    }
  }

  private planCompleted(
    context: PlanContext,
    outcome: ReturnType<RunEventLedgerImpl["resolveOutcome"]>,
  ): PlanResult {
    this.sealStreams()
    const payload: JsonObject = {
      status: outcome.status,
      ...(outcome.reasons.length > 0 ? { reasons: outcome.reasons } : {}),
      evidenceKeys: outcome.evidenceKeys,
      ...(outcome.synthetic ? { synthetic: outcome.synthetic } : {}),
      ...(outcome.recovery ? { recovery: outcome.recovery } : {}),
      ...(outcome.code !== undefined ? { code: outcome.code } : {}),
      ...(outcome.message ? { message: outcome.message } : {}),
      ...(this.withheldDropped > 0 ? { lossPossible: true } : {}),
    }
    const refs = context.state.artifactRefs.map((ref) => ref as JsonValue)
    return {
      kind: "commit",
      drafts: [
        {
          type: "completed",
          payload,
          ...(this.withheldDropped > 0
            ? {
                metadata: {
                  redaction: { withheldDropped: this.withheldDropped },
                },
              }
            : {}),
        },
      ],
      jobMutation: {
        status: outcome.status,
        finishedAt: context.nowIso,
        heartbeatAt: context.nowIso,
      },
      ...(refs.length > 0 ? { artifactRefs: refs } : {}),
    }
  }

  // ---- owner-gated artifact port -------------------------------------------

  get [RUN_ARTIFACT_LEDGER_PORT](): RunArtifactLedgerPort {
    return {
      runId: this.runId,
      isSealed: () => this.state.completed !== null,
      containsSecretMaterial: (text: string) =>
        this.sanitize(text).rules.length > 0,
      admit: (input) =>
        this.enqueue({
          observationKey: input.observationKey,
          late: "none",
          plan: ({ state }) =>
            state.completed
              ? {
                  kind: "reject",
                  error: new RunEventLedgerError(
                    "RUN_ALREADY_TERMINAL",
                    "artifacts cannot be admitted after the seal",
                  ),
                }
              : {
                  kind: "commit",
                  drafts: [
                    {
                      type: "artifact_created",
                      payload: { artifacts: [input.artifact] },
                    },
                  ],
                },
          onCommitted: () => {
            this.state.admittedRunDir = input.runDir
          },
        }) as Promise<LedgerRecord[]>,
      reject: (input) =>
        this.enqueue({
          observationKey: input.observationKey,
          late: "host",
          lateSummary: () => ({
            originalType: "status",
            observation: {
              kind: "artifact_admission",
              result: "rejected",
              reason: input.reason,
            },
          }),
          plan: () => ({
            kind: "commit",
            drafts: [
              {
                type: "status",
                payload: {
                  subtype: "artifact_admission",
                  result: "rejected",
                  reason: input.reason,
                },
              },
            ],
          }),
        }) as Promise<LedgerRecord[]>,
    }
  }

  // ---- readers --------------------------------------------------------------

  async read(afterSequence = 0): Promise<LedgerRecord[]> {
    await this.ready
    return (await this.readCommitted(Number(afterSequence) || 0)).map(
      (record) => clone(record),
    )
  }

  async readItem(
    input: ItemKey | Record<string, unknown>,
  ): Promise<ItemReadModel | null> {
    await this.ready
    if (!isObject(input)) return null
    const key = input as Record<string, unknown>
    const lookup: Record<string, unknown> = {
      channel: key.channel,
      partIndex: key.partIndex ?? 0,
    }
    if (nonEmptyString(key.correlationKey)) {
      lookup.correlationKey = key.correlationKey
    } else {
      Object.assign(
        lookup,
        this.redactedIds({
          threadId: key.threadId,
          turnId: key.turnId,
          itemId: key.itemId,
        }),
      )
    }
    const part = this.state.items.get(itemMapKey(lookup))
    if (!part) return null
    return {
      state: part.state,
      ...(part.hasLocal || part.state === "completed"
        ? { text: part.text }
        : {}),
      ...(part.fields ? { fields: clone(part.fields) } : {}),
      ...(part.indexSource ? { indexSource: part.indexSource } : {}),
      reconciliation: {
        ...(part.result ? { result: part.result } : {}),
        lossPossible: part.lossPossible,
        missingStart: part.missingStart,
        suppressedDuplicateCount: part.suppressedDuplicateCount,
      },
    }
  }

  async readUsage(): Promise<LedgerUsage> {
    await this.ready
    const usage = this.state.usage
    return clone({
      total: usage.total,
      last: usage.last,
      baseline: usage.baseline,
      delta: usage.delta,
      discontinuity: usage.discontinuity,
      sealedAtSequence: usage.sealedAtSequence,
    })
  }

  async readOutcome(): Promise<LedgerOutcome | null> {
    await this.ready
    const completed = this.state.completed
    if (!completed) return null
    const payload = isObject(completed.payload)
      ? (completed.payload as JsonObject)
      : {}
    return {
      status: String(payload.status ?? "failed"),
      reasons: Array.isArray(payload.reasons)
        ? payload.reasons.map(String)
        : [],
      evidenceKeys: Array.isArray(payload.evidenceKeys)
        ? payload.evidenceKeys.map(String)
        : [],
      completedSequence: Number(completed.sequence),
    }
  }

  /** Host-only raw interrupt target; never serialized into a record. */
  async readNativeContext(): Promise<{
    threadId: string
    turnId: string
  } | null> {
    await this.ready
    const { threadId, turnId } = this.nativeContext
    return threadId && turnId ? { threadId, turnId } : null
  }
}

export type CanonicalRunEventLedger = RunEventLedgerImpl

/**
 * Creates the one ledger for an existing Run (durable job ID). Construction
 * validates provenance before any publication, reopens committed state from
 * the store, redelivers unacknowledged records to projections and, for a
 * runtime or locus-completion tuple, binds it once.
 */
export function createCanonicalRunEventLedger(
  options: CreateCanonicalRunEventLedgerOptions,
): CanonicalRunEventLedger {
  if (!options || !nonEmptyString(options.runId)) {
    throw new RunEventLedgerError("RUN_ID_REQUIRED", "runId is required")
  }
  if (!nonEmptyString(options.runtimeId)) {
    throw new RunEventLedgerError(
      "RUNTIME_ID_REQUIRED",
      "runtimeId is required",
    )
  }
  if (
    !options.durableStore ||
    typeof options.durableStore.appendExact !== "function"
  ) {
    throw new RunEventLedgerError("STORE_REQUIRED", "durableStore is required")
  }
  const provenance = validateProvenance(options.provenance)
  const initial: ExecutionProvenance =
    provenance.kind === "pending"
      ? provenance
      : { kind: "pending", runtimeId: provenance.runtimeId }
  const ledger = new RunEventLedgerImpl(options, initial)
  ledger.start(provenance)
  return ledger
}
