/**
 * Test-only helpers for the follow-up red slice A of
 * `openspec/changes/refactor-canonical-run-event-ledger` (vocabulary,
 * normalized output, CLI/protocol serializers, Codex decoder).
 *
 * Nothing here implements ledger behavior. It only composes the immutable
 * Domain A harness (`run-event-ledger-test-harness.ts`: in-memory durableStore
 * port, deterministic clock, lazy ledger loader) with an injectable
 * `artifactOwner`, converts committed records into the persisted
 * `agent_job_events` row shape the existing serializers read, and captures
 * CLI/protocol writers. Product modules the design introduces are loaded lazily
 * by the callers so a missing owner fails only the test that needs it.
 */
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createDeterministicClock,
  createInMemoryDurableStore,
  createNoopArtifactOwner,
  type Ledger,
  type LedgerRecord,
  loadLedgerModule,
} from "./run-event-ledger-test-harness"

/** Per-test temp directories, removed by `cleanupTempDirs` in afterEach. */
const tempDirs: string[] = []

export function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  tempDirs.push(dir)
  return dir
}

export function cleanupTempDirs(): void {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * createCanonicalRunEventLedger with the design's option bag over the Domain A
 * in-memory durableStore port. `artifactOwner` defaults to the harness no-op
 * owner; the vocabulary test passes the run-artifacts module namespace, the
 * same owner the Domain B kit injects.
 */
export async function createSliceALedger(options: {
  runId: string
  runtimeId: string
  source: string
  provenance: Record<string, unknown>
  secretHints?: string[]
  artifactOwner?: unknown
}): Promise<{
  ledger: Ledger
  inspect: ReturnType<typeof createInMemoryDurableStore>["inspect"]
}> {
  const { store, inspect } = createInMemoryDurableStore({
    runId: options.runId,
    runtimeId: options.runtimeId,
  })
  const module = await loadLedgerModule()
  const ledger = await module.createCanonicalRunEventLedger({
    runId: options.runId,
    runtimeId: options.runtimeId,
    source: options.source,
    provenance: options.provenance,
    clock: createDeterministicClock(),
    redactionContext: { secretHints: [...(options.secretHints ?? [])] },
    durableStore: store,
    projections: [],
    artifactOwner: options.artifactOwner ?? createNoopArtifactOwner(),
  })
  return { ledger, inspect }
}

/**
 * The persisted `agent_job_events` row a committed record becomes (bare
 * payload JSON at the committed sequence), i.e. what `listAgentJobEvents`
 * hands to `serializeAgentJobEvent`.
 */
export function toJobEventRow(record: LedgerRecord) {
  return {
    id: `row-${record.sequence}`,
    jobId: String(record.runId),
    sequence: record.sequence,
    type: record.type,
    payloadJson: JSON.stringify(record.payload ?? {}),
    createdAt: new Date(String(record.createdAt)),
  }
}

export function captureWriter() {
  let value = ""
  return {
    writer: {
      write(chunk: string) {
        value += chunk
        return true
      },
    },
    value: () => value,
  }
}

export function parseJsonLines(text: string): unknown[] {
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown)
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

/** `sequence:key` for every object payload that carries a forbidden key. */
export function forbiddenPayloadKeyHits(
  envelopes: Array<{ sequence?: unknown; payload?: unknown }>,
  keys: string[],
): string[] {
  return envelopes.flatMap((envelope) =>
    isPlainObject(envelope.payload)
      ? keys
          .filter((key) => Object.hasOwn(envelope.payload as object, key))
          .map((key) => `${String(envelope.sequence)}:${key}`)
      : [],
  )
}

/** Decoder output as a descriptor list (the design does not fix array vs single). */
export function descriptorsOf(output: unknown): Record<string, unknown>[] {
  const list = Array.isArray(output) ? output : [output]
  return list.filter(isPlainObject)
}

export function replaceToken<T>(
  value: T,
  token: string,
  replacement: string,
): T {
  return JSON.parse(JSON.stringify(value).split(token).join(replacement)) as T
}
