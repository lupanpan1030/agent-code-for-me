/** biome-ignore-all lint/suspicious/noExplicitAny: the ledger contract under test does not exist yet; records are asserted structurally. */
/**
 * Shared harness for the Domain B red suite of
 * `openspec/changes/refactor-canonical-run-event-ledger` (terminal truth,
 * errors, provenance, artifacts, resume and recovery).
 *
 * Everything here is test infrastructure, not product code:
 *
 * - Product modules that the design mandates but that do not exist yet
 *   (`agent-runtime/run-event-ledger.ts`, `run-artifacts.ts`,
 *   `run-provenance.ts`) are loaded lazily inside each test, so each test is
 *   individually RED with "Cannot find module" on the baseline instead of the
 *   whole file failing at import time.
 * - `MemoryDurableStore` implements exactly the design's named
 *   `durableStore` port (`appendExact`, `lookupFact`, `read`, `readHeader`,
 *   `cursor`, `ack`) with the design's store invariants (exact dense
 *   sequences, expectedHighWater conflict, fact-key idempotency, one v1
 *   completed, post-seal late_event-only). It never allocates or re-sequences;
 *   the ledger under test does. It records every commit so atomicity
 *   (job mutation + completed in the same `appendExact`) is observable.
 * - `createMigratedLedgerDb` applies the repository's real Drizzle migrations
 *   to a temporary file-backed SQLite database (optionally seeding pre-ledger
 *   rows at the 0000-0023 baseline first), so DB-level assertions exercise the
 *   implementing change's own migration.
 *
 * No test in this suite shares process-wide state: every store, clock and
 * database is created per test and disposed in `afterEach`.
 */
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import * as schema from "../src/main/lib/db/schema"

export const FIXTURE_DIR = join(import.meta.dir, "fixtures", "run-event-ledger")
export const DRIZZLE_DIR = join(import.meta.dir, "..", "drizzle")
/** Highest migration index present on the pre-ledger baseline (0000-0023). */
export const PRE_LEDGER_MIGRATION_MAX_IDX = 23

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

export type FixtureHeader = {
  fixtureVersion: number
  evidenceClass: "synthetic" | "trace-excerpt" | "captured"
  sourceRefs: string[]
  provenance: Record<string, unknown>
}

export function loadJsonFixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as T
}

export type JsonlLine = {
  caseId: string
  port: string
  observationKey: string
  transportId?: string
  receivedAt?: string
  input: any
  expected: any
  [key: string]: unknown
}

export function loadJsonlFixture(name: string): {
  header: FixtureHeader
  lines: JsonlLine[]
} {
  const rows = readFileSync(join(FIXTURE_DIR, name), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line))
  const [header, ...lines] = rows
  return { header, lines }
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

// ---------------------------------------------------------------------------
// Lazy product-module loaders (exact design/tasks paths and names)
// ---------------------------------------------------------------------------

export async function loadLedgerModule(): Promise<any> {
  return await import("../src/main/lib/agent-runtime/run-event-ledger")
}

export async function loadRunArtifactsModule(): Promise<any> {
  return await import("../src/main/lib/agent-runtime/run-artifacts")
}

export async function loadRunProvenanceModule(): Promise<any> {
  return await import("../src/main/lib/agent-runtime/run-provenance")
}

// ---------------------------------------------------------------------------
// Deterministic clock
// ---------------------------------------------------------------------------

export type TestClock = (() => Date) & {
  now: () => Date
  advance: (ms: number) => void
}

/**
 * Deterministic injected clock. Callable (`clock()`) and object-style
 * (`clock.now()`) both return the same fixed instant until `advance`.
 */
export function createTestClock(
  startIso = "2026-09-04T00:00:00.000Z",
): TestClock {
  let current = Date.parse(startIso)
  const clock = (() => new Date(current)) as TestClock
  clock.now = () => new Date(current)
  clock.advance = (ms: number) => {
    current += ms
  }
  return clock
}

// ---------------------------------------------------------------------------
// In-memory durable store implementing the design's durableStore port
// ---------------------------------------------------------------------------

export type StoreCommit = {
  records: any[]
  expectedHighWater: number
  jobMutation?: unknown
  artifactRefs?: unknown
}

function deepClone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value))
}

function findNamedProperty(
  value: unknown,
  names: string[],
  depth = 0,
): unknown {
  if (!value || typeof value !== "object" || depth > 4) return undefined
  for (const name of names) {
    if (Object.hasOwn(value as object, name)) {
      return (value as Record<string, unknown>)[name]
    }
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = findNamedProperty(child, names, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

/** The committed fact key of a record (design: v1 inserts require it). */
export function factKeyOf(record: unknown): string {
  const key = findNamedProperty(record, ["factKey", "fact_key"])
  if (key === undefined || key === null) {
    throw new Error("MemoryDurableStore: v1 record lacks a fact key")
  }
  return typeof key === "string" ? key : JSON.stringify(key)
}

export function factKeyMentions(
  factKey: string,
  observationKey: string,
): boolean {
  return factKey.split(/[^A-Za-z0-9_.-]+/).includes(observationKey)
}

/** Committed records whose fact key carries the given observationKey. */
export function recordsForKey(records: any[], observationKey: string): any[] {
  return records.filter((record) =>
    factKeyMentions(factKeyOf(record), observationKey),
  )
}

/** Resolve a possibly-sync, possibly-async call to a settled result. */
export async function settledResult(
  run: () => unknown,
): Promise<{ fulfilled: boolean; value?: unknown; reason?: string }> {
  return await Promise.resolve()
    .then(run)
    .then(
      (value) => ({ fulfilled: true, value }),
      (error: unknown) => ({
        fulfilled: false,
        reason: `${error instanceof Error ? error.message : String(error)} ${JSON.stringify(error)}`,
      }),
    )
}

export type MemoryDurableStoreOptions = {
  runId: string
  header?: Record<string, unknown>
}

export class MemoryDurableStore {
  readonly runId: string
  records: any[] = []
  header: Record<string, unknown>
  commits: StoreCommit[] = []
  artifactRefs: unknown[] = []
  appendAttempts = 0
  cursors = new Map<string, number>()
  /**
   * Fault/interleave hook, invoked at the start of every appendExact attempt
   * (before validation). It may throw (definite rollback) or commit a
   * competing batch through `commitForeign` (another host process).
   */
  beforeAppend: ((batch: StoreCommit, attempt: number) => void) | null = null

  constructor(options: MemoryDurableStoreOptions) {
    this.runId = options.runId
    this.header = {
      id: options.runId,
      status: "running",
      ledgerVersion: 1,
      ledgerProvenanceJson: null,
      ledgerSealedSequence: null,
      cancelRequestedAt: null,
      ...(options.header ?? {}),
    }
  }

  highWater(): number {
    return this.records.reduce(
      (max, record) => Math.max(max, Number(record.sequence)),
      0,
    )
  }

  private hasCompleted(): boolean {
    return this.records.some((record) => record.type === "completed")
  }

  appendExact(batch: StoreCommit): any[] {
    this.appendAttempts += 1
    this.beforeAppend?.(batch, this.appendAttempts)
    const incoming = [...(batch.records ?? [])]
    const keys = incoming.map(factKeyOf)
    const existing = keys.map((key) =>
      this.records.find((record) => factKeyOf(record) === key),
    )
    if (incoming.length > 0 && existing.every(Boolean)) {
      return deepClone(existing)
    }
    if (existing.some(Boolean)) {
      throw new Error("MemoryDurableStore: partial fact-key overlap")
    }
    const highWater = this.highWater()
    if (batch.expectedHighWater !== highWater) {
      throw new Error(
        `MemoryDurableStore: expectedHighWater conflict (expected ${batch.expectedHighWater}, committed ${highWater})`,
      )
    }
    incoming.forEach((record, index) => {
      if (Number(record.sequence) !== highWater + index + 1) {
        throw new Error(
          `MemoryDurableStore: non-dense sequence ${record.sequence} at offset ${index}`,
        )
      }
    })
    const completedCount = incoming.filter(
      (record) => record.type === "completed",
    ).length
    if (completedCount > 1 || (completedCount === 1 && this.hasCompleted())) {
      throw new Error("MemoryDurableStore: second completed rejected")
    }
    if (this.hasCompleted()) {
      const illegal = incoming.find(
        (record) =>
          !(
            record.type === "status" && record.payload?.subtype === "late_event"
          ),
      )
      if (illegal) {
        throw new Error(
          `MemoryDurableStore: post-terminal ${illegal.type} rejected (late_event only)`,
        )
      }
    }
    const committed = deepClone(incoming)
    this.records.push(...committed)
    this.commits.push(deepClone(batch))
    if (batch.jobMutation && typeof batch.jobMutation === "object") {
      Object.assign(this.header, deepClone(batch.jobMutation))
    }
    if (batch.artifactRefs !== undefined && batch.artifactRefs !== null) {
      const refs = Array.isArray(batch.artifactRefs)
        ? batch.artifactRefs
        : [batch.artifactRefs]
      this.artifactRefs.push(...deepClone(refs))
    }
    return deepClone(committed)
  }

  /** Commit a batch as another host process would (used by interleave hooks). */
  commitForeign(records: any[], jobMutation?: Record<string, unknown>): void {
    const highWater = this.highWater()
    const renumbered = records.map((record, index) => ({
      ...record,
      sequence: highWater + index + 1,
    }))
    this.records.push(...deepClone(renumbered))
    this.commits.push({
      records: deepClone(renumbered),
      expectedHighWater: highWater,
      jobMutation,
    })
    if (jobMutation) Object.assign(this.header, jobMutation)
  }

  lookupFact(observationKey: string): any[] {
    return deepClone(
      this.records.filter((record) =>
        factKeyMentions(factKeyOf(record), observationKey),
      ),
    )
  }

  read(_runId: string, afterSequence = 0): any[] {
    return deepClone(
      this.records
        .filter((record) => Number(record.sequence) > afterSequence)
        .sort((a, b) => a.sequence - b.sequence),
    )
  }

  readHeader(_runId: string): Record<string, unknown> {
    return {
      ...deepClone(this.header),
      runId: this.runId,
      highWater: this.highWater(),
    }
  }

  cursor(_runId: string, projectionName: string): number {
    return this.cursors.get(projectionName) ?? 0
  }

  ack(_runId: string, projectionName: string, sequence: number): void {
    const current = this.cursors.get(projectionName) ?? 0
    if (sequence < current) {
      throw new Error("MemoryDurableStore: ack must be monotone")
    }
    if (sequence > this.highWater()) {
      throw new Error("MemoryDurableStore: ack beyond committed high-water")
    }
    this.cursors.set(projectionName, sequence)
  }
}

// ---------------------------------------------------------------------------
// Ledger construction through the design's createCanonicalRunEventLedger
// ---------------------------------------------------------------------------

export type LedgerHarnessInput = {
  runId: string
  runtimeId: string
  source?: string
  provenance: unknown
  store: MemoryDurableStore
  clock?: TestClock
  secretHints?: string[]
}

export async function createLedger(input: LedgerHarnessInput): Promise<any> {
  const { createCanonicalRunEventLedger } = await loadLedgerModule()
  const artifactOwner = await loadRunArtifactsModule()
  return await createCanonicalRunEventLedger({
    runId: input.runId,
    runtimeId: input.runtimeId,
    source: input.source ?? "api",
    provenance: input.provenance,
    clock: input.clock ?? createTestClock(),
    redactionContext: { secretHints: input.secretHints ?? [] },
    durableStore: input.store,
    projections: [],
    artifactOwner,
  })
}

/** Build a design `Boundary` from a fixture line. */
export function boundaryOf(line: {
  observationKey: string
  transportId?: string
  receivedAt?: string
  input: any
}): any {
  return {
    observationKey: line.observationKey,
    transportId: line.transportId ?? "t1",
    receivedAt: line.receivedAt ?? "2026-09-04T00:00:00.000Z",
    ...line.input,
  }
}

/** Dispatch one fixture step to the named ledger port. */
export async function applyStep(
  ledger: any,
  step: JsonlLine | any,
): Promise<unknown> {
  switch (step.port) {
    case "ingestResponse":
    case "ingestNotification":
    case "ingestServerRequest":
      return await ledger[step.port](boundaryOf(step))
    case "ingestTransportExit":
      return await ledger.ingestTransportExit({
        observationKey: step.observationKey,
        transportId: step.transportId ?? "t1",
        ...step.input,
      })
    case "ingestClaudeMessage":
      return await ledger.ingestClaudeMessage({
        observationKey: step.observationKey,
        ...step.input,
      })
    case "ingestRuntimeObservation":
    case "appendSystemEvent":
      return await ledger[step.port]({
        observationKey: step.observationKey,
        ...step.input,
      })
    case "repairFromSnapshot":
      return await ledger.repairFromSnapshot({
        observationKey: step.observationKey,
        ...step.input,
      })
    case "settle":
      return await ledger.settle(step.input)
    default:
      throw new Error(`unknown fixture port ${step.port}`)
  }
}

// ---------------------------------------------------------------------------
// Record helpers
// ---------------------------------------------------------------------------

export function completedRecords(records: any[]): any[] {
  return records.filter((record) => record.type === "completed")
}

export function statusRecords(records: any[], subtype: string): any[] {
  return records.filter(
    (record) => record.type === "status" && record.payload?.subtype === subtype,
  )
}

export function sequencesOf(records: any[]): number[] {
  return records.map((record) => Number(record.sequence))
}

export function denseRange(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1)
}

// ---------------------------------------------------------------------------
// Migrated temporary SQLite (real Drizzle migrations)
// ---------------------------------------------------------------------------

export type MigratedLedgerDb = {
  dir: string
  file: string
  sqlite: Database
  db: any
  openSecondConnection: () => { sqlite: Database; db: any }
  close: () => void
}

function applyPragmas(sqlite: Database): void {
  sqlite.exec("PRAGMA journal_mode = WAL")
  sqlite.exec("PRAGMA busy_timeout = 5000")
  sqlite.exec("PRAGMA foreign_keys = ON")
}

function preLedgerMigrationsFolder(root: string): string {
  const folder = join(root, "drizzle-pre-ledger")
  mkdirSync(join(folder, "meta"), { recursive: true })
  const journal = JSON.parse(
    readFileSync(join(DRIZZLE_DIR, "meta", "_journal.json"), "utf8"),
  )
  const entries = journal.entries.filter(
    (entry: { idx: number }) => entry.idx <= PRE_LEDGER_MIGRATION_MAX_IDX,
  )
  for (const entry of entries) {
    copyFileSync(
      join(DRIZZLE_DIR, `${entry.tag}.sql`),
      join(folder, `${entry.tag}.sql`),
    )
  }
  writeFileSync(
    join(folder, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries }, null, 2),
  )
  return folder
}

/**
 * Temporary file-backed SQLite with every repository migration applied.
 * `seedPreLedger` (optional) runs against the pre-ledger 0000-0023 schema
 * before the remaining (implementing-change) migrations are applied, which
 * is how pre-cutover historical rows are produced.
 */
export function createMigratedLedgerDb(
  options: { seedPreLedger?: (sqlite: Database) => void } = {},
): MigratedLedgerDb {
  const dir = mkdtempSync(join(tmpdir(), "run-event-ledger-b-"))
  const file = join(dir, "locus.db")
  const sqlite = new Database(file)
  applyPragmas(sqlite)
  if (options.seedPreLedger) {
    migrate(drizzle(sqlite), {
      migrationsFolder: preLedgerMigrationsFolder(dir),
    })
    options.seedPreLedger(sqlite)
  }
  migrate(drizzle(sqlite), { migrationsFolder: DRIZZLE_DIR })
  const db = drizzle(sqlite, { schema })
  const extra: Database[] = []
  return {
    dir,
    file,
    sqlite,
    db,
    openSecondConnection() {
      const second = new Database(file)
      applyPragmas(second)
      extra.push(second)
      return { sqlite: second, db: drizzle(second, { schema }) }
    },
    close() {
      for (const connection of extra) connection.close()
      sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

export function jobEventRows(sqlite: Database, jobId: string): any[] {
  return sqlite
    .query(
      "SELECT * FROM agent_job_events WHERE job_id = ? ORDER BY sequence ASC",
    )
    .all(jobId) as any[]
}

export function jobRow(sqlite: Database, jobId: string): any {
  return sqlite.query("SELECT * FROM agent_jobs WHERE id = ?").get(jobId)
}

export function parsePayload(row: { payload_json: string }): any {
  return JSON.parse(row.payload_json)
}

/** A PID that has certainly exited on this host (spawned and reaped). */
export function exitedPid(): number {
  const child = Bun.spawnSync(["true"])
  return child.pid
}
