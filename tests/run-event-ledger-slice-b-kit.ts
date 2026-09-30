/** biome-ignore-all lint/suspicious/noExplicitAny: the ledger contract under test does not exist yet; records are asserted structurally. */
/**
 * Test-only helpers for the follow-up red slice B of
 * `openspec/changes/refactor-canonical-run-event-ledger` (S11, S12, S16, S17,
 * S32). Nothing here re-implements ledger behavior: sequence allocation,
 * delivery, acknowledgement, redaction and boundary recording stay with the
 * owner under test (NEW `src/main/lib/agent-runtime/run-event-ledger.ts`).
 *
 * - `createSliceLedger` builds the ledger through the design's
 *   `createCanonicalRunEventLedger` with caller-supplied `durableStore` and
 *   `projections` ports (the shared harnesses hard-wire `projections: []`).
 * - `processStoreFacade` / `upsertProjection` model one host process over the
 *   shared `MemoryDurableStore` of the Domain B kit: a `Lifeline` marks the
 *   process dead at an injected crash point (afterCommit / afterDeliver), after
 *   which every call from that process throws, exactly like a dead process
 *   whose later writes never happen. The projector's persisted target is an
 *   upsert map keyed by (runId, sequence), per the design's projector rule.
 * - `textLeaves` / `channelText` / `captureHostOutput` read what a consumer
 *   would see, for the split-secret redaction assertions.
 */
import { spyOn } from "bun:test"
import {
  createTestClock,
  factKeyMentions,
  factKeyOf,
  loadLedgerModule,
  type MemoryDurableStore,
  type TestClock,
} from "./run-event-ledger-domain-b-kit"
import { createNoopArtifactOwner } from "./run-event-ledger-test-harness"

// ---------------------------------------------------------------------------
// Ledger construction with explicit ports
// ---------------------------------------------------------------------------

export type SliceLedgerInput = {
  runId: string
  runtimeId?: string
  source?: string
  provenance: unknown
  durableStore: unknown
  projections?: unknown[]
  secretHints?: string[]
  clock?: TestClock
}

export async function createSliceLedger(input: SliceLedgerInput): Promise<any> {
  const { createCanonicalRunEventLedger } = await loadLedgerModule()
  return await createCanonicalRunEventLedger({
    runId: input.runId,
    runtimeId: input.runtimeId ?? "codex",
    source: input.source ?? "api",
    provenance: input.provenance,
    clock: input.clock ?? createTestClock(),
    redactionContext: { secretHints: [...(input.secretHints ?? [])] },
    durableStore: input.durableStore,
    projections: input.projections ?? [],
    artifactOwner: createNoopArtifactOwner(),
  })
}

/** Lazily import the renderer projector the design keeps in stream-event-mapper.ts. */
export async function loadRendererProjector(): Promise<
  (record: unknown) => unknown
> {
  const module: any = await import(
    "../src/main/lib/agent-runtime/stream-event-mapper"
  )
  return module.projectRunEventToRendererChunks
}

// ---------------------------------------------------------------------------
// Host-process model: lifeline, store facade, upsert projection
// ---------------------------------------------------------------------------

export class SimulatedCrash extends Error {
  constructor(point: string) {
    super(`simulated host process crash (${point})`)
    this.name = "SimulatedCrash"
  }
}

export type Lifeline = { name: string; dead: boolean; crashedAt: string | null }

export function createLifeline(name: string): Lifeline {
  return { name, dead: false, crashedAt: null }
}

function die(lifeline: Lifeline, point: string): never {
  lifeline.dead = true
  lifeline.crashedAt = point
  throw new SimulatedCrash(point)
}

function assertAlive(lifeline: Lifeline): void {
  if (lifeline.dead) throw new SimulatedCrash(`after ${lifeline.crashedAt}`)
}

export type ProjectionEvent = {
  process: string
  kind: "commit" | "deliver" | "ack"
  sequence: number
  sequences?: number[]
  factKey?: string
}

export type CrashFault = {
  key: string
  failAt: "afterCommit" | "afterDeliver"
} | null

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value))
}

function batchMentions(records: any[], key: string): boolean {
  return records.some((record) => factKeyMentions(factKeyOf(record), key))
}

/**
 * One host process's handle on the shared durable store (design durableStore
 * port). `fault.failAt === "afterCommit"` kills the process right after the
 * shared store committed a batch carrying `fault.key`.
 */
export function processStoreFacade(
  shared: MemoryDurableStore,
  lifeline: Lifeline,
  options: { log: ProjectionEvent[]; fault?: CrashFault },
) {
  const fault = options.fault ?? null
  return {
    appendExact(batch: any) {
      assertAlive(lifeline)
      const committed = shared.appendExact(batch)
      options.log.push({
        process: lifeline.name,
        kind: "commit",
        sequence: Math.max(0, ...committed.map((r: any) => Number(r.sequence))),
        sequences: committed.map((r: any) => Number(r.sequence)),
      })
      if (
        fault?.failAt === "afterCommit" &&
        batchMentions(batch.records ?? [], fault.key)
      ) {
        die(lifeline, "afterCommit")
      }
      return committed
    },
    lookupFact(observationKey: string) {
      assertAlive(lifeline)
      return shared.lookupFact(observationKey)
    },
    read(runId: string, afterSequence = 0) {
      assertAlive(lifeline)
      return shared.read(runId, afterSequence)
    },
    readHeader(runId: string) {
      assertAlive(lifeline)
      return shared.readHeader(runId)
    },
    cursor(runId: string, projectionName: string) {
      assertAlive(lifeline)
      return shared.cursor(runId, projectionName)
    },
    ack(runId: string, projectionName: string, sequence: number) {
      assertAlive(lifeline)
      options.log.push({ process: lifeline.name, kind: "ack", sequence })
      shared.ack(runId, projectionName, sequence)
    },
  }
}

/**
 * Projector port `{ name, deliver(record), cursor(), ack(sequence) }` whose
 * persisted target is an upsert map keyed by (runId, sequence); cursor/ack
 * delegate to the same store (design). `fault.failAt === "afterDeliver"`
 * kills the process after the upsert of a record carrying `fault.key`.
 */
export function upsertProjection(input: {
  name: string
  runId: string
  lifeline: Lifeline
  store: ReturnType<typeof processStoreFacade>
  output: Map<string, any>
  log: ProjectionEvent[]
  fault?: CrashFault
}) {
  const fault = input.fault ?? null
  return {
    name: input.name,
    deliver(record: any) {
      assertAlive(input.lifeline)
      input.output.set(`${input.runId}:${record.sequence}`, clone(record))
      const factKey = factKeyOf(record)
      input.log.push({
        process: input.lifeline.name,
        kind: "deliver",
        sequence: Number(record.sequence),
        factKey,
      })
      if (
        fault?.failAt === "afterDeliver" &&
        factKeyMentions(factKey, fault.key)
      ) {
        die(input.lifeline, "afterDeliver")
      }
    },
    cursor() {
      return input.store.cursor(input.runId, input.name)
    },
    ack(sequence: number) {
      input.store.ack(input.runId, input.name, sequence)
    },
  }
}

/** Simple recording projection over a store port (no crash model). */
export function recordingProjection(
  name: string,
  runId: string,
  store: MemoryDurableStore,
) {
  const delivered: any[] = []
  return {
    delivered,
    projection: {
      name,
      deliver(record: any) {
        delivered.push(clone(record))
      },
      cursor() {
        return store.cursor(runId, name)
      },
      ack(sequence: number) {
        store.ack(runId, name, sequence)
      },
    },
  }
}

export function eventsOf(
  log: ProjectionEvent[],
  process: string,
  kind: ProjectionEvent["kind"],
): ProjectionEvent[] {
  return log.filter((event) => event.process === process && event.kind === kind)
}

/**
 * Acknowledgement findings for one process: an ack must never move backwards,
 * must start at or above `floor`, and may only cover a contiguous prefix of
 * sequences delivered before it (by this process, above `floor`).
 */
export function ackFindings(
  log: ProjectionEvent[],
  process: string,
  floor: number,
): unknown[] {
  const findings: unknown[] = []
  const delivered = new Set<number>()
  let previous = floor
  for (const event of log.filter((entry) => entry.process === process)) {
    if (event.kind === "deliver") delivered.add(event.sequence)
    if (event.kind !== "ack") continue
    if (event.sequence < previous) {
      findings.push({ nonMonotoneAck: event.sequence, previous })
    }
    for (let sequence = floor + 1; sequence <= event.sequence; sequence += 1) {
      if (!delivered.has(sequence)) {
        findings.push({
          ackBeyondDeliveredPrefix: event.sequence,
          missing: sequence,
        })
        break
      }
    }
    previous = Math.max(previous, event.sequence)
  }
  return findings
}

/** Let queued microtasks and timers run a few turns (no wall-clock dependency). */
export async function macrotaskTurns(turns = 3): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

// ---------------------------------------------------------------------------
// Consumer-visible text
// ---------------------------------------------------------------------------

export const TEXT_KEYS = ["delta", "text", "message", "output", "progress"]

/** Every string under a text-bearing key, in document order. */
export function textLeaves(value: unknown, keys = TEXT_KEYS): string[] {
  const found: string[] = []
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (!node || typeof node !== "object") return
    for (const [name, child] of Object.entries(
      node as Record<string, unknown>,
    )) {
      if (keys.includes(name) && typeof child === "string") found.push(child)
      else visit(child)
    }
  }
  visit(value)
  return found
}

/**
 * The text contribution of one committed delta record: its top-level
 * payload text field (existing `delta`/`text` fields stay in place; tool
 * progress may normalize to `message`/`output`).
 */
export function channelText(record: any): string {
  const payload = record?.payload ?? {}
  for (const key of ["delta", "text", "message", "output"]) {
    if (typeof payload[key] === "string") return payload[key]
  }
  return ""
}

/** Host output a Run could leak diagnostics into (console + stderr). */
export function captureHostOutput() {
  const spies = [
    spyOn(console, "error"),
    spyOn(console, "warn"),
    spyOn(console, "log"),
    spyOn(console, "info"),
    spyOn(console, "debug"),
    spyOn(process.stderr, "write"),
  ]
  return {
    text(): string {
      return spies
        .flatMap((spy) => spy.mock.calls)
        .map((call) =>
          call
            .map((argument: unknown) =>
              typeof argument === "string"
                ? argument
                : argument instanceof Uint8Array
                  ? new TextDecoder().decode(argument)
                  : JSON.stringify(argument, (_key, value) =>
                      value instanceof Error
                        ? { name: value.name, message: value.message }
                        : value,
                    ),
            )
            .join(" "),
        )
        .join("\n")
    },
    restore(): void {
      for (const spy of spies) spy.mockRestore()
    },
  }
}
