/**
 * Shared, test-only harness for the refactor-canonical-run-event-ledger
 * red suite (Domain A: ledger core and reconciliation).
 *
 * Everything here is a *port fake* or a fixture reader. Nothing here
 * re-implements ledger behavior: sequence allocation, item reconciliation,
 * usage accounting, terminal settlement and redaction all stay with the
 * owner under test, `src/main/lib/agent-runtime/run-event-ledger.ts`
 * (design.md "Test-facing Contract", tasks 2.1).
 *
 * - `createInMemoryDurableStore` implements the design's durableStore port
 *   (appendExact / lookupFact / read / readHeader / cursor / ack) exactly as
 *   documented: it validates expectedHighWater and dense sequences, never
 *   re-sequences, and returns the prior committed batch for a complete
 *   duplicate fact-key batch. The design explicitly allows "either an
 *   in-memory store or temporary SQLite store" for ledger tests.
 * - `createDeterministicClock` is the injected clock (1 ms per reading).
 * - `createNoopArtifactOwner` admits nothing; Domain A never tests artifacts.
 *
 * The ledger module is imported lazily per test so that, before the
 * implementation exists, every test fails individually with
 * "Cannot find module" (contract-test pattern) instead of the whole file
 * failing to load.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

export const FIXTURE_DIR = join(import.meta.dir, "fixtures", "run-event-ledger")

export type FixtureHeader = {
  fixtureVersion: 1
  evidenceClass: "synthetic" | "trace-excerpt" | "captured"
  sourceRefs: string[]
  provenance: Record<string, unknown>
}

export type FixtureLine = {
  caseId: string
  port: string
  observationKey: string
  transportId?: string
  receivedAt: string
  input: Record<string, unknown>
  expected: Record<string, unknown>
}

function assertHeader(
  value: unknown,
  name: string,
): asserts value is FixtureHeader {
  const header = value as Partial<FixtureHeader> | null
  if (
    header?.fixtureVersion !== 1 ||
    !["synthetic", "trace-excerpt", "captured"].includes(
      String(header.evidenceClass),
    ) ||
    !Array.isArray(header.sourceRefs) ||
    header.sourceRefs.length === 0 ||
    typeof header.provenance !== "object"
  ) {
    throw new Error(`fixture ${name} violates the tasks §7 header shape`)
  }
}

export function loadJsonFixture<T extends Record<string, unknown>>(
  name: string,
): FixtureHeader & T {
  const parsed: unknown = JSON.parse(
    readFileSync(join(FIXTURE_DIR, name), "utf8"),
  )
  assertHeader(parsed, name)
  return parsed as FixtureHeader & T
}

export function loadJsonlFixture(name: string): {
  header: FixtureHeader
  lines: FixtureLine[]
} {
  const rows = readFileSync(join(FIXTURE_DIR, name), "utf8")
    .split("\n")
    .filter((row) => row.trim().length > 0)
    .map((row) => JSON.parse(row) as unknown)
  const [header, ...lines] = rows
  assertHeader(header, name)
  for (const line of lines as FixtureLine[]) {
    if (
      typeof line.caseId !== "string" ||
      typeof line.port !== "string" ||
      typeof line.observationKey !== "string" ||
      typeof line.receivedAt !== "string" ||
      typeof line.input !== "object" ||
      typeof line.expected !== "object"
    ) {
      throw new Error(
        `fixture ${name} has a line outside the tasks §7 JSONL shape`,
      )
    }
  }
  return { header, lines: lines as FixtureLine[] }
}

export function linesForCase(
  lines: FixtureLine[],
  caseId: string,
): FixtureLine[] {
  const selected = lines.filter((line) => line.caseId === caseId)
  if (selected.length === 0) throw new Error(`fixture case ${caseId} not found`)
  return selected
}

export function expectedForCase(
  lines: FixtureLine[],
  caseId: string,
): Record<string, unknown> {
  const withExpectation = linesForCase(lines, caseId).filter(
    (line) => Object.keys(line.expected).length > 0,
  )
  if (withExpectation.length !== 1) {
    throw new Error(
      `fixture case ${caseId} must carry exactly one expectation line`,
    )
  }
  return withExpectation[0].expected
}

// ---------------------------------------------------------------------------
// Ledger module (design: NEW agent-runtime/run-event-ledger.ts)
// ---------------------------------------------------------------------------

export type LedgerRecord = Record<string, unknown> & {
  sequence: number
  type: string
  payload?: Record<string, unknown>
}

// Intentionally loose: the shapes are the design's Test-facing Contract.
// biome-ignore lint/suspicious/noExplicitAny: contract under test does not exist yet
export type Ledger = Record<string, any>

export async function loadLedgerModule(): Promise<{
  createCanonicalRunEventLedger: (
    options: Record<string, unknown>,
  ) => Ledger | Promise<Ledger>
}> {
  const modulePath = "../src/main/lib/agent-runtime/run-event-ledger"
  return (await import(modulePath)) as {
    createCanonicalRunEventLedger: (
      options: Record<string, unknown>,
    ) => Ledger | Promise<Ledger>
  }
}

// ---------------------------------------------------------------------------
// Fact-key helpers. design: fact keys are (runId, observationKey, ordinal);
// the encoding is not fixed, so these helpers accept an object, a tuple or a
// delimited string, and locate the observationKey as a whole token.
// ---------------------------------------------------------------------------

export function factKeyOf(record: Record<string, unknown>): unknown {
  const metadata = (record.metadata ?? record.recordMetadata) as
    | Record<string, unknown>
    | undefined
  return record.factKey ?? metadata?.factKey ?? null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function factKeyMentions(
  record: Record<string, unknown>,
  observationKey: string,
): boolean {
  const factKey = factKeyOf(record)
  if (factKey === null || factKey === undefined) return false
  const encoded =
    typeof factKey === "string" ? factKey : JSON.stringify(factKey)
  return new RegExp(
    `(^|[^A-Za-z0-9_-])${escapeRegExp(observationKey)}([^A-Za-z0-9_-]|$)`,
  ).test(encoded)
}

export function factKeyOrdinal(record: Record<string, unknown>): number | null {
  const factKey = factKeyOf(record)
  if (Array.isArray(factKey)) return Number(factKey[factKey.length - 1])
  if (factKey && typeof factKey === "object") {
    const ordinal = (factKey as Record<string, unknown>).ordinal
    return typeof ordinal === "number" ? ordinal : null
  }
  if (typeof factKey === "string") {
    const match = factKey.match(/(\d+)$/)
    return match ? Number(match[1]) : null
  }
  return null
}

// ---------------------------------------------------------------------------
// In-memory durableStore port (design "Durable Schema and Store Invariants")
// ---------------------------------------------------------------------------

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export class InMemoryStoreConflictError extends Error {
  code = "EXPECTED_HIGH_WATER_CONFLICT"
}

export function createInMemoryDurableStore(init: {
  runId: string
  runtimeId: string
}) {
  const committed: LedgerRecord[] = []
  const factIndex = new Map<string, LedgerRecord>()
  const cursors = new Map<string, number>()
  const jobState: Record<string, unknown> = {
    runId: init.runId,
    jobId: init.runId,
    runtimeId: init.runtimeId,
    // Mirrors the agent_jobs row the real adapter reads (drizzle camelCase
    // plus the SQL column name), with no business meaning added here.
    ledgerVersion: 1,
    ledger_version: 1,
    status: "running",
    ledgerProvenanceJson: null,
    ledgerSealedSequence: null,
  }
  const appendCalls: Array<{ expectedHighWater: unknown; count: number }> = []
  const highWater = () =>
    committed.length === 0 ? 0 : committed[committed.length - 1].sequence

  const store = {
    appendExact(input: {
      records: LedgerRecord[]
      expectedHighWater?: number
      jobMutation?: Record<string, unknown>
      artifactRefs?: unknown[]
    }) {
      appendCalls.push({
        expectedHighWater: input.expectedHighWater,
        count: input.records.length,
      })
      const records = input.records.map(clone)
      const keys = records.map((record) => {
        const factKey = factKeyOf(record)
        return factKey === null || factKey === undefined
          ? null
          : JSON.stringify(factKey)
      })
      if (
        records.length > 0 &&
        keys.every((key) => key !== null && factIndex.has(key))
      ) {
        return keys.map((key) =>
          clone(factIndex.get(key as string) as LedgerRecord),
        )
      }
      if (
        input.expectedHighWater !== undefined &&
        input.expectedHighWater !== highWater()
      ) {
        throw new InMemoryStoreConflictError(
          `expectedHighWater ${String(input.expectedHighWater)} != ${highWater()}`,
        )
      }
      records.forEach((record, index) => {
        if (record.sequence !== highWater() + 1 + index) {
          throw new Error(
            `non-dense sequence ${record.sequence} at batch index ${index}`,
          )
        }
        if (keys[index] !== null && factIndex.has(keys[index] as string)) {
          throw new Error(`partial duplicate fact key ${keys[index]}`)
        }
      })
      for (const [index, record] of records.entries()) {
        committed.push(record)
        if (keys[index] !== null) factIndex.set(keys[index] as string, record)
        if (record.type === "completed")
          jobState.ledgerSealedSequence = record.sequence
      }
      if (input.jobMutation && typeof input.jobMutation === "object") {
        Object.assign(jobState, clone(input.jobMutation))
      }
      return records.map(clone)
    },
    lookupFact(observationKey: string) {
      return committed
        .filter((record) => factKeyMentions(record, observationKey))
        .map(clone)
    },
    read(_runId: string, afterSequence = 0) {
      return committed
        .filter((record) => record.sequence > afterSequence)
        .map(clone)
    },
    readHeader(_runId: string) {
      return clone({ ...jobState, highWater: highWater() })
    },
    cursor(_runId: string, projectionName: string) {
      return cursors.get(projectionName) ?? 0
    },
    ack(_runId: string, projectionName: string, sequence: number) {
      const current = cursors.get(projectionName) ?? 0
      if (sequence < current || sequence > highWater()) {
        throw new Error(
          `invalid ack ${sequence} (cursor ${current}, high-water ${highWater()})`,
        )
      }
      cursors.set(projectionName, sequence)
    },
  }

  return {
    store,
    inspect: {
      rows: () => committed.map(clone),
      appendCalls: () => appendCalls.slice(),
      jobState: () => clone(jobState),
    },
  }
}

// ---------------------------------------------------------------------------
// Injected seams
// ---------------------------------------------------------------------------

export function createDeterministicClock(
  startIso = "2026-09-04T00:00:00.000Z",
) {
  let current = Date.parse(startIso)
  const next = () => new Date(current++)
  return Object.assign(() => next(), { now: () => next() })
}

export function createNoopArtifactOwner(): Record<string, unknown> {
  const rejection = {
    result: "rejected",
    reason: "out_of_scope",
    admitted: [],
    refs: [],
  }
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then" || typeof property === "symbol")
          return undefined
        return async () => clone(rejection)
      },
    },
  )
}

export const RUN_ID = "run-ledger-domain-a"

export async function createTestLedger(options: {
  provenance: Record<string, unknown>
  runtimeId?: string
  secretHints?: string[]
  runId?: string
  source?: string
}) {
  const runId = options.runId ?? RUN_ID
  const runtimeId =
    options.runtimeId ?? String(options.provenance.runtimeId ?? "codex")
  const { store, inspect } = createInMemoryDurableStore({ runId, runtimeId })
  const module = await loadLedgerModule()
  const ledger = await module.createCanonicalRunEventLedger({
    runId,
    runtimeId,
    source: options.source ?? "cli",
    provenance: options.provenance,
    clock: createDeterministicClock(),
    redactionContext: { secretHints: options.secretHints ?? [] },
    durableStore: store,
    projections: [],
    artifactOwner: createNoopArtifactOwner(),
  })
  return { ledger, store, inspect, runId }
}

/**
 * Submits one fixture step through the named ledger port. Native ports get the
 * design `Boundary` (observationKey, transportId, receivedAt, message,
 * request?) plus requestId/result for send/resolved; host ports get
 * { observationKey, receivedAt, ...normalized input }; settle gets the
 * OutcomeEvidence object as-is.
 */
export async function drive(
  ledger: Ledger,
  line: {
    port: string
    observationKey: string
    transportId?: string
    receivedAt?: string
    input: Record<string, unknown>
  },
): Promise<unknown> {
  const port = ledger[line.port]
  if (typeof port !== "function") {
    throw new Error(`ledger port ${line.port} is not a function`)
  }
  const receivedAt = line.receivedAt ?? "2026-09-04T00:00:00.000Z"
  if (line.port === "settle") return await port.call(ledger, line.input)
  if (
    line.port === "ingestRuntimeObservation" ||
    line.port === "appendSystemEvent" ||
    line.port === "repairFromSnapshot"
  ) {
    return await port.call(ledger, {
      observationKey: line.observationKey,
      receivedAt,
      ...line.input,
    })
  }
  return await port.call(ledger, {
    observationKey: line.observationKey,
    transportId: line.transportId ?? "t1",
    receivedAt,
    ...line.input,
  })
}

export async function readAll(ledger: Ledger): Promise<LedgerRecord[]> {
  return (await ledger.read(0)) as LedgerRecord[]
}

export function subtypeOf(record: LedgerRecord): unknown {
  return record.payload?.subtype
}

export function typeLabel(record: LedgerRecord): string {
  const subtype = subtypeOf(record)
  return subtype === undefined
    ? record.type
    : `${record.type}/${String(subtype)}`
}

export function codexExtensionOf(
  record: LedgerRecord,
): Record<string, unknown> | undefined {
  const extensions = record.payload?.extensions as
    | Record<string, unknown>
    | undefined
  return extensions?.["runtime.codex.v1"] as Record<string, unknown> | undefined
}

/** payload.item carries the redacted item key (design Item Reconciliation). */
export function itemKeyOf(
  record: LedgerRecord,
): Record<string, unknown> | undefined {
  const item = record.payload?.item as Record<string, unknown> | undefined
  if (!item) return undefined
  return (item.key as Record<string, unknown> | undefined) ?? item
}

export function recordsFor(
  records: LedgerRecord[],
  observationKey: string,
): LedgerRecord[] {
  return records.filter((record) => factKeyMentions(record, observationKey))
}

export function valuesByKey(value: unknown, key: string): unknown[] {
  const found: unknown[] = []
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (node && typeof node === "object") {
      for (const [name, child] of Object.entries(
        node as Record<string, unknown>,
      )) {
        if (name === key) found.push(child)
        visit(child)
      }
    }
  }
  visit(value)
  return found
}

export function isSubset(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object")
    return Object.is(actual, expected)
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((entry, index) => isSubset(actual[index], entry))
    )
  }
  if (!actual || typeof actual !== "object") return false
  return Object.entries(expected as Record<string, unknown>).every(
    ([name, entry]) =>
      isSubset((actual as Record<string, unknown>)[name], entry),
  )
}

export function range(from: number, to: number): number[] {
  return Array.from(
    { length: Math.max(0, to - from + 1) },
    (_, index) => from + index,
  )
}
