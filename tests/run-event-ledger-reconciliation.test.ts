/**
 * Red acceptance tests — refactor-canonical-run-event-ledger, Domain A part 2:
 * item lifecycle reconciliation (assistant, reasoning text/summary parts, tools),
 * usage snapshot accounting (snapshot vs delta, total/last, dedupe, resume
 * baseline) and post-seal usage as diagnostic-only late observations.
 *
 * Written test-first by an independent author from
 * openspec/changes/refactor-canonical-run-event-ledger/{design,tasks}.md and
 * specs/agent-runtime-core/spec.md. Fixtures: tests/fixtures/run-event-ledger/.
 *
 * Observable carriers (design "Item Reconciliation and Redaction", "Usage
 * Semantics", "Error, Completion and Late-Event Policy"):
 *   readItem(key) -> { state, text?, fields?, indexSource?, reconciliation:
 *     { result, lossPossible, missingStart, suppressedDuplicateCount } }
 *   status/item_reconciliation -> payload.item + payload.reconciliation
 *   usage_update.payload -> kind/total/last/baseline/delta/dedupeKey/asOfSequence/discontinuity
 *   readUsage() -> { total, last, baseline, delta, discontinuity, sealedAtSequence }
 *   status/late_event -> terminalSequence/originalType/nativeMethod/observation/diagnosticOnly
 *
 * Before implementation every test fails with "Cannot find module" for
 * src/main/lib/agent-runtime/run-event-ledger.ts.
 */
import { describe, expect, mock, test } from "bun:test"
import {
  createTestLedger,
  drive,
  expectedForCase,
  isSubset,
  itemKeyOf,
  type Ledger,
  type LedgerRecord,
  linesForCase,
  loadJsonFixture,
  loadJsonlFixture,
  readAll,
  recordsFor,
  subtypeOf,
  valuesByKey,
} from "./run-event-ledger-test-harness"

mock.module("electron", () => ({
  app: { getPath: () => "/tmp", isPackaged: false, getAppPath: () => "/tmp" },
  BrowserWindow: class BrowserWindow {},
}))

const identity = loadJsonFixture<{
  provenanceVariants: Record<string, Record<string, unknown>>
}>("identity-provenance.json")
const RUNTIME_PROVENANCE = identity.provenanceVariants.runtime
const COMPLETION_PROVENANCE = identity.provenanceVariants.locusCompletion

type ItemRead = {
  state: string
  text?: string
  fields?: Record<string, unknown>
  indexSource?: string
  reconciliation: {
    result?: string
    lossPossible: boolean
    missingStart: boolean
    suppressedDuplicateCount: number
  }
}

async function runCase(
  fixture: ReturnType<typeof loadJsonlFixture>,
  caseId: string,
) {
  const { ledger } = await createTestLedger({ provenance: RUNTIME_PROVENANCE })
  for (const line of linesForCase(fixture.lines, caseId))
    await drive(ledger, line)
  return { ledger, records: await readAll(ledger) }
}

function reconciliationRecords(
  records: LedgerRecord[],
  itemId: string,
): LedgerRecord[] {
  return records.filter(
    (record) =>
      record.type === "status" &&
      subtypeOf(record) === "item_reconciliation" &&
      itemKeyOf(record)?.itemId === itemId,
  )
}

function pick(
  source: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  return Object.fromEntries(
    keys.filter((key) => key in source).map((key) => [key, source[key]]),
  )
}

const RECONCILIATION_KEYS = [
  "result",
  "missingStart",
  "lossPossible",
  "suppressedDuplicateCount",
]

// ---------------------------------------------------------------------------
// agent-runtime-core / Item Lifecycle Reconciliation
// ---------------------------------------------------------------------------
describe("agent-runtime-core / Item Lifecycle Reconciliation", () => {
  const assistant = loadJsonlFixture("items-assistant.jsonl")
  const reasoning = loadJsonlFixture("items-reasoning.jsonl")
  const tools = loadJsonlFixture("items-tools.jsonl")
  const assistantKey = {
    threadId: "th",
    turnId: "tu",
    itemId: "msg",
    channel: "assistant",
    partIndex: 0,
  }

  for (const caseId of [
    "exact",
    "prefix",
    "mismatch",
    "missing-start",
    "gap",
    "duplicate-key",
    "out-of-order-start",
  ]) {
    test(`S18 Assistant deltas reconcile with final snapshot — ${caseId} variant: final "hello" is authoritative once, persisted reconciliation matches readItem`, async () => {
      const expected = expectedForCase(assistant.lines, caseId)
      const { ledger, records } = await runCase(assistant, caseId)
      const item = (await ledger.readItem(assistantKey)) as ItemRead
      expect(item).toMatchObject({ state: "completed", text: expected.text })
      expect(item.reconciliation).toMatchObject(
        pick(expected, RECONCILIATION_KEYS),
      )

      // Final text is item state, not another appended assistant_delta.
      expect(
        records.filter((record) => record.type === "assistant_delta").length,
      ).toBe(expected.assistantDeltaCount)
      const persisted = reconciliationRecords(records, "msg")
      expect(persisted.length).toBe(1)
      expect(persisted[0].payload?.reconciliation).toMatchObject(
        pick(expected, RECONCILIATION_KEYS),
      )
      expect(persisted[0].payload?.reconciliation).toMatchObject(
        pick(item.reconciliation, RECONCILIATION_KEYS),
      )
      expect((persisted[0].payload?.item as Record<string, unknown>).text).toBe(
        expected.text,
      )
    })
  }

  test("S18 Assistant deltas reconcile with final snapshot — missing-native-ID variant returns a correlationKey in every committed record and equal text under another key never merges", async () => {
    const lines = linesForCase(assistant.lines, "missing-native-id")
    const expected = expectedForCase(assistant.lines, "missing-native-id")
    const { ledger } = await createTestLedger({
      provenance: RUNTIME_PROVENANCE,
    })
    for (const line of lines) await drive(ledger, line)
    const records = await readAll(ledger)
    const keys = lines.map((line) => {
      const committed = recordsFor(records, line.observationKey).filter(
        (record) => record.type === "assistant_delta",
      )
      expect(committed.length).toBe(1)
      const key = itemKeyOf(committed[0])
      expect(typeof key?.correlationKey).toBe("string")
      // No fabricated native identity for an observation that had none.
      expect(key?.threadId).toBeUndefined()
      expect(key?.itemId).toBeUndefined()
      return String(key?.correlationKey)
    })
    expect(new Set(keys).size).toBe(2)
    for (const correlationKey of keys) {
      const item = (await ledger.readItem({
        correlationKey,
        channel: expected.channel,
        partIndex: expected.partIndex,
      })) as ItemRead
      expect(item.text).toBe(expected.text)
    }
  })

  test("S19 Reasoning channels and parts reconcile separately — index-less text/summary deltas use inferred text/0 and the last summaryPartAdded boundary, then reconcile to analysis/short/next", async () => {
    const lines = linesForCase(reasoning.lines, "channels")
    const expected = expectedForCase(reasoning.lines, "channels") as {
      parts: Array<Record<string, unknown>>
      streamingCheckpointAfterStep: number
    }
    const { ledger } = await createTestLedger({
      provenance: RUNTIME_PROVENANCE,
    })
    const key = (channel: string, partIndex: number) => ({
      threadId: "th",
      turnId: "tu",
      itemId: "r",
      channel,
      partIndex,
    })
    for (const line of lines.slice(0, expected.streamingCheckpointAfterStep)) {
      await drive(ledger, line)
    }
    const streaming = await Promise.all(
      expected.parts.map(
        async (part) =>
          (await ledger.readItem(
            key(String(part.channel), Number(part.partIndex)),
          )) as ItemRead,
      ),
    )
    expect(
      streaming.map((item) => ({
        state: item.state,
        text: item.text,
        indexSource: item.indexSource,
        lossPossible: item.reconciliation.lossPossible,
      })),
    ).toEqual(
      expected.parts.map((part) => ({
        state: "streaming",
        text: part.text,
        indexSource: "inferred",
        lossPossible: true,
      })),
    )

    for (const line of lines.slice(expected.streamingCheckpointAfterStep))
      await drive(ledger, line)
    const completed = await Promise.all(
      expected.parts.map(
        async (part) =>
          (await ledger.readItem(
            key(String(part.channel), Number(part.partIndex)),
          )) as ItemRead,
      ),
    )
    expect(
      completed.map((item) => ({
        state: item.state,
        text: item.text,
        indexSource: item.indexSource,
        lossPossible: item.reconciliation.lossPossible,
      })),
    ).toEqual(
      expected.parts.map((part) => ({
        state: "completed",
        text: part.text,
        indexSource: part.indexSource,
        lossPossible: part.lossPossible,
      })),
    )

    // Each channel/part has its own committed item_reconciliation carrier.
    const records = await readAll(ledger)
    const persisted = reconciliationRecords(records, "r").map((record) => ({
      channel: itemKeyOf(record)?.channel,
      partIndex: itemKeyOf(record)?.partIndex,
      text: (record.payload?.item as Record<string, unknown>).text,
      result: (record.payload?.reconciliation as Record<string, unknown>)
        .result,
    }))
    expect(
      expected.parts.map((part, index) =>
        persisted.some(
          (entry) =>
            entry.channel === part.channel &&
            entry.partIndex === part.partIndex &&
            entry.text === part.text &&
            entry.result === completed[index].reconciliation.result,
        ),
      ),
    ).toEqual(expected.parts.map(() => true))
    // No channel concatenates another channel or part.
    expect(
      records.filter((record) => record.type === "reasoning_delta").length,
    ).toBe(3)
  })

  const readReasoningParts = async (
    ledger: Ledger,
    parts: Array<Record<string, unknown>>,
  ) =>
    Promise.all(
      parts.map(async (part) => {
        const item = (await ledger.readItem({
          threadId: "th",
          turnId: "tu",
          itemId: "r",
          channel: part.channel,
          partIndex: part.partIndex,
        })) as ItemRead
        return {
          channel: part.channel,
          partIndex: part.partIndex,
          ...item,
          ...item.reconciliation,
        }
      }),
    )

  for (const caseId of [
    "no-boundary",
    "duplicate",
    "missing-part",
    "overlap",
  ]) {
    test(`S19 Reasoning channels and parts reconcile separately — ${caseId} variant has its explicit fixture result/loss/suppressed counts`, async () => {
      const expected = expectedForCase(reasoning.lines, caseId) as {
        parts: Array<Record<string, unknown>>
        reasoningDeltaCount: number
      }
      const { ledger, records } = await runCase(reasoning, caseId)
      expect(await readReasoningParts(ledger, expected.parts)).toMatchObject(
        expected.parts,
      )
      expect(
        records.filter((record) => record.type === "reasoning_delta").length,
      ).toBe(expected.reasoningDeltaCount)
    })
  }

  test("S19 Reasoning channels and parts reconcile separately — out-of-order variant: a text delta arriving after item completion never re-appends to the completed part", async () => {
    const expected = expectedForCase(reasoning.lines, "out-of-order") as {
      parts: Array<Record<string, unknown>>
    }
    const { ledger } = await runCase(reasoning, "out-of-order")
    expect(await readReasoningParts(ledger, expected.parts)).toMatchObject(
      expected.parts,
    )
  })

  test("S20 Tool item lifecycle is incomplete or repeated — each of the eight tool variants yields one tool_started/tool_finished, keeps progress facts and authoritative final fields", async () => {
    const caseIds = [...new Set(tools.lines.map((line) => line.caseId))].filter(
      (caseId) => caseId.startsWith("lifecycle-"),
    )
    expect(caseIds.length).toBe(8)
    const problems: unknown[] = []
    for (const caseId of caseIds) {
      const expected = expectedForCase(tools.lines, caseId)
      const { ledger, records } = await runCase(tools, caseId)
      const item = (await ledger.readItem({
        threadId: "th",
        turnId: "tu",
        itemId: expected.itemId,
        channel: "tool",
        partIndex: 0,
      })) as ItemRead
      const observed = {
        toolStartedCount: records.filter((r) => r.type === "tool_started")
          .length,
        toolFinishedCount: records.filter((r) => r.type === "tool_finished")
          .length,
        toolDeltaCount: records.filter((r) => r.type === "tool_delta").length,
        artifactCreatedCount: records.filter(
          (r) => r.type === "artifact_created",
        ).length,
        state: item?.state,
        fields: item?.fields,
        missingStart: item?.reconciliation?.missingStart,
        suppressedDuplicateCount:
          item?.reconciliation?.suppressedDuplicateCount,
      }
      const want = {
        toolStartedCount: expected.toolStartedCount,
        toolFinishedCount: expected.toolFinishedCount,
        toolDeltaCount: expected.toolDeltaCount,
        artifactCreatedCount: 0,
        state: "completed",
        fields: expected.fields,
        missingStart: expected.missingStart,
        suppressedDuplicateCount: expected.suppressedDuplicateCount,
      }
      if (!isSubset(observed, want)) problems.push({ caseId, observed, want })
    }
    expect(problems).toEqual([])
  })

  test("S20 Tool item lifecycle is incomplete or repeated — repeated final with the same native item key emits no second tool_finished and persists suppressedDuplicateCount=1", async () => {
    const expected = expectedForCase(tools.lines, "repeated-final")
    const { ledger, records } = await runCase(tools, "repeated-final")
    expect(records.filter((r) => r.type === "tool_started").length).toBe(
      expected.toolStartedCount,
    )
    expect(records.filter((r) => r.type === "tool_finished").length).toBe(
      expected.toolFinishedCount,
    )
    expect(records.filter((r) => r.type === "tool_delta").length).toBe(
      expected.toolDeltaCount,
    )
    const item = (await ledger.readItem({
      threadId: "th",
      turnId: "tu",
      itemId: expected.itemId,
      channel: "tool",
      partIndex: 0,
    })) as ItemRead
    expect(item.state).toBe("completed")
    expect(item.fields).toMatchObject(
      expected.fields as Record<string, unknown>,
    )
    expect(item.reconciliation.suppressedDuplicateCount).toBe(1)
    const persisted = reconciliationRecords(records, String(expected.itemId))
    expect(persisted.length).toBeGreaterThan(0)
    expect(
      (
        persisted[persisted.length - 1].payload?.reconciliation as Record<
          string,
          unknown
        >
      ).suppressedDuplicateCount,
    ).toBe(1)
  })

  test("S20 Tool item lifecycle is incomplete or repeated — missing start exposes persisted missingStart/lossPossible and at most one tool_started", async () => {
    const expected = expectedForCase(tools.lines, "missing-start")
    const { ledger, records } = await runCase(tools, "missing-start")
    expect(
      records.filter((r) => r.type === "tool_started").length,
    ).toBeLessThanOrEqual(Number(expected.maxToolStartedCount))
    expect(records.filter((r) => r.type === "tool_finished").length).toBe(
      expected.toolFinishedCount,
    )
    expect(records.filter((r) => r.type === "tool_delta").length).toBe(
      expected.toolDeltaCount,
    )
    const item = (await ledger.readItem({
      threadId: "th",
      turnId: "tu",
      itemId: expected.itemId,
      channel: "tool",
      partIndex: 0,
    })) as ItemRead
    expect(item.state).toBe("completed")
    expect(item.fields).toMatchObject(
      expected.fields as Record<string, unknown>,
    )
    expect(item.reconciliation).toMatchObject({
      missingStart: true,
      lossPossible: true,
    })
    const persisted = reconciliationRecords(records, String(expected.itemId))
    expect(persisted.length).toBe(1)
    expect(persisted[0].payload?.reconciliation).toMatchObject({
      missingStart: true,
      lossPossible: true,
    })
  })
})

// ---------------------------------------------------------------------------
// agent-runtime-core / Diagnostic Error And Terminal Invariants (late usage only)
// ---------------------------------------------------------------------------
describe("agent-runtime-core / Diagnostic Error And Terminal Invariants", () => {
  const late = loadJsonlFixture("late-usage.jsonl")

  for (const caseId of ["after-settle", "during-preparation"]) {
    test(`S25 Usage after completed is diagnostic only — ${caseId}: sealed usage stays 20 and every later observation is status/late_event referencing the sole completed`, async () => {
      const expected = expectedForCase(late.lines, caseId) as {
        sealedTotal: number
        completedCount: number
        completedStatus: string
        lateObservationKeys: string[]
        lateUsageObservation: {
          total: number
          last: number
          originalType: string
          nativeMethod: string
        }
      }
      const { ledger, records } = await runCase(late, caseId)

      const completed = records.filter((record) => record.type === "completed")
      expect(completed.length).toBe(expected.completedCount)
      expect(completed[0].payload?.status).toBe(expected.completedStatus)
      const terminalSequence = completed[0].sequence
      const outcome = (await ledger.readOutcome()) as Record<string, unknown>
      expect(outcome).toMatchObject({
        status: expected.completedStatus,
        completedSequence: terminalSequence,
      })

      const usage = (await ledger.readUsage()) as Record<
        string,
        Record<string, unknown>
      > & {
        sealedAtSequence: number
      }
      expect(usage.total.totalTokens).toBe(expected.sealedTotal)
      expect(typeof usage.sealedAtSequence).toBe("number")
      expect(usage.sealedAtSequence).toBeLessThanOrEqual(terminalSequence)

      const lateRecords = expected.lateObservationKeys.map((key) =>
        recordsFor(records, key),
      )
      expect(lateRecords.map((batch) => batch.length)).toEqual(
        expected.lateObservationKeys.map(() => 1),
      )
      expect(
        lateRecords.map(([record]) => ({
          type: record.type,
          subtype: subtypeOf(record),
          diagnosticOnly: record.payload?.diagnosticOnly,
          terminalSequence: record.payload?.terminalSequence,
          afterTerminal: record.sequence > terminalSequence,
        })),
      ).toEqual(
        expected.lateObservationKeys.map(() => ({
          type: "status",
          subtype: "late_event",
          diagnosticOnly: true,
          terminalSequence,
          afterTerminal: true,
        })),
      )
      const [lateUsage] = lateRecords[0]
      expect(lateUsage.payload?.originalType).toBe(
        expected.lateUsageObservation.originalType,
      )
      expect(lateUsage.payload?.nativeMethod).toBe(
        expected.lateUsageObservation.nativeMethod,
      )
      const observedTotals = valuesByKey(
        lateUsage.payload?.observation,
        "totalTokens",
      )
      expect(observedTotals).toContain(expected.lateUsageObservation.total)
      expect(observedTotals).toContain(expected.lateUsageObservation.last)
      // Nothing after the seal is a usage_update or another completed.
      expect(
        records
          .filter((record) => record.sequence > terminalSequence)
          .map((record) => `${record.type}/${String(subtypeOf(record))}`),
      ).toEqual(expected.lateObservationKeys.map(() => "status/late_event"))
    })
  }
})

// ---------------------------------------------------------------------------
// agent-runtime-core / Usage Snapshot Accounting
// ---------------------------------------------------------------------------
type UsageCase = {
  caseId: string
  provenanceVariant: "runtime" | "locusCompletion"
  steps: Array<{
    port: string
    observationKey: string
    transportId?: string
    input: Record<string, unknown>
  }>
  expected: Record<string, unknown>
}

describe("agent-runtime-core / Usage Snapshot Accounting", () => {
  const usageFixture = loadJsonFixture<{ cases: UsageCase[] }>("usage.json")
  const usageCase = (caseId: string) => {
    const found = usageFixture.cases.find((entry) => entry.caseId === caseId)
    if (!found) throw new Error(`usage.json case ${caseId} missing`)
    return found
  }
  const ledgerFor = async (entry: UsageCase): Promise<Ledger> =>
    (
      await createTestLedger({
        provenance:
          entry.provenanceVariant === "locusCompletion"
            ? COMPLETION_PROVENANCE
            : RUNTIME_PROVENANCE,
      })
    ).ledger
  const vector = (payload: Record<string, unknown> | undefined, name: string) =>
    (payload?.[name] as Record<string, unknown> | undefined)?.totalTokens

  test("S26 Usage snapshots are accumulated once — cumulative 10,20,20(dup),25 yield unique snapshot payloads 10/20/25 with last 10/10/5 and readUsage total 25", async () => {
    const entry = usageCase("codex-snapshots")
    const ledger = await ledgerFor(entry)
    for (const step of entry.steps) await drive(ledger, step)
    const usageRecords = (await readAll(ledger)).filter(
      (record) => record.type === "usage_update",
    )
    const firstByDedupeKey = new Map<string, LedgerRecord>()
    for (const record of usageRecords) {
      const key = JSON.stringify(record.payload?.dedupeKey ?? null)
      if (!firstByDedupeKey.has(key)) firstByDedupeKey.set(key, record)
    }
    const unique = [...firstByDedupeKey.values()]
    expect(
      usageRecords.every(
        (record) => typeof record.payload?.dedupeKey === "string",
      ),
    ).toBe(true)
    expect(unique.map((record) => record.payload?.kind)).toEqual([
      "snapshot",
      "snapshot",
      "snapshot",
    ])
    expect(unique.map((record) => vector(record.payload, "total"))).toEqual(
      entry.expected.uniqueTotals as number[],
    )
    expect(unique.map((record) => vector(record.payload, "last"))).toEqual(
      entry.expected.uniqueLasts as number[],
    )
    const usage = (await ledger.readUsage()) as Record<
      string,
      Record<string, unknown>
    >
    expect(usage.total.totalTokens).toBe(entry.expected.readUsageTotal)
    expect(usage.last.totalTokens).toBe(entry.expected.readUsageLast)
  })

  test("S26 Usage snapshots are accumulated once — per-call variant: two distinct call IDs with totalTokens=10 accumulate to 20 and a retransmitted call does not increase it", async () => {
    const entry = usageCase("per-call")
    const ledger = await ledgerFor(entry)
    for (const step of entry.steps) await drive(ledger, step)
    const usage = (await ledger.readUsage()) as Record<
      string,
      Record<string, unknown>
    >
    expect(usage.total.totalTokens).toBe(entry.expected.readUsageTotal)
    expect(usage.last.totalTokens).toBe(entry.expected.readUsageLast)
    const dedupeKeys = new Set(
      (await readAll(ledger))
        .filter((record) => record.type === "usage_update")
        .map((record) => JSON.stringify(record.payload?.dedupeKey ?? null)),
    )
    expect(dedupeKeys.size).toBe(entry.expected.distinctDedupeKeys)
  })

  test("S27 Resume establishes a usage baseline — repair baseline 100 is not consumption, 108 yields delta 8, synthetic decrease to 3 marks discontinuity with no negative delta", async () => {
    const entry = usageCase("resume-baseline")
    const ledger = await ledgerFor(entry)
    const [repair, afterResume, decrease] = entry.steps
    await drive(ledger, repair)
    const baselineOnly = (await ledger.readUsage()) as Record<
      string,
      Record<string, unknown>
    >
    expect(baselineOnly.baseline.totalTokens).toBe(entry.expected.baseline)

    await drive(ledger, afterResume)
    const at108 = (await ledger.readUsage()) as Record<
      string,
      Record<string, unknown>
    >
    expect(at108.baseline.totalTokens).toBe(entry.expected.baseline)
    expect(at108.delta.totalTokens).toBe(entry.expected.deltaAfter108)
    const record108 = recordsFor(
      await readAll(ledger),
      afterResume.observationKey,
    ).filter((record) => record.type === "usage_update")
    expect(record108.length).toBe(1)
    expect(record108[0].payload).toMatchObject({ kind: "snapshot" })
    expect(vector(record108[0].payload, "total")).toBe(108)
    expect(vector(record108[0].payload, "baseline")).toBe(
      entry.expected.baseline,
    )
    expect(vector(record108[0].payload, "delta")).toBe(
      entry.expected.deltaAfter108,
    )

    await drive(ledger, decrease)
    const record3 = recordsFor(
      await readAll(ledger),
      decrease.observationKey,
    ).filter((record) => record.type === "usage_update")
    expect(record3.length).toBe(1)
    expect(record3[0].payload?.discontinuity).toBe(
      entry.expected.discontinuityAt3,
    )
    expect(vector(record3[0].payload, "baseline")).not.toBe(
      entry.expected.baseline,
    )
    expect(
      Number(vector(record3[0].payload, "delta") ?? 0),
    ).toBeGreaterThanOrEqual(0)
    const afterDecrease = (await ledger.readUsage()) as Record<
      string,
      unknown
    > & {
      delta?: Record<string, unknown>
    }
    expect(afterDecrease.discontinuity).toBe(true)
    expect(
      Number(afterDecrease.delta?.totalTokens ?? 0),
    ).toBeGreaterThanOrEqual(0)
  })
})
