/** biome-ignore-all lint/suspicious/noExplicitAny: the ledger contract under test does not exist yet; records are asserted structurally. */
/**
 * Follow-up red slice B, part 1 — durable append faults and crash recovery of
 * the canonical Run event ledger (`openspec/changes/refactor-canonical-run-event-ledger`).
 *
 * Scenarios (agent-runtime-core / Canonical Run Event Ledger Ownership):
 *   S11 Durable append fails before acknowledgement
 *   S12 Process crashes after commit and before projection
 *
 * Fixture: `tests/fixtures/run-event-ledger/store-faults.json#faultOperations`
 * (tasks 7.8 `{op: append|deliver|ack|crash|reopen, key, failAt?}`); the S56
 * `raceCases` of the same file are untouched.
 *
 * Entry points (design "Test-facing Contract" / owner mapping; never invented):
 * - `createCanonicalRunEventLedger` from NEW `agent-runtime/run-event-ledger.ts`
 *   with the `durableStore` port (appendExact/lookupFact/read/readHeader/
 *   cursor/ack) and `projections = [{ name, deliver(record), cursor(), ack(sequence) }]`,
 *   ports `appendSystemEvent` and `read(afterSequence)`; memory half over the
 *   Domain B kit's `MemoryDurableStore` (its `beforeAppend` hook injects the
 *   beforeCommit fault).
 * - NEW `appendExactRunEventBatch` exported by the existing
 *   `headless/job-store.ts` (owner mapping row "Replace exported raw writer with
 *   appendExactRunEventBatch"), over a temporary SQLite database migrated with
 *   the repository's real Drizzle migrations; a TEMP trigger injects the
 *   beforeCommit fault inside the batch transaction.
 *
 * Shapes frozen here where the design is silent (see the slice-B report):
 * - the ledger (not the projector) calls `projection.ack(sequence)` after the
 *   delivery of a contiguous prefix; `ack` delegates to `durableStore.ack`;
 * - a port's resolved acknowledgement is the committed batch array (red-receipt §8);
 * - `appendExactRunEventBatch(db, { jobId, records, expectedHighWater, jobMutation? })`
 *   with records `RunEvent & { factKey, metadata }`, fact key `<observationKey>:<ordinal>`
 *   (red-receipt F-9), and `jobMutation` in drizzle `agentJobs` field names.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { createRunEvent } from "../src/main/lib/agent-runtime/runtime-events"
import {
  createMigratedLedgerDb,
  denseRange,
  factKeyMentions,
  factKeyOf,
  jobEventRows,
  jobRow,
  loadJsonFixture,
  MemoryDurableStore,
  type MigratedLedgerDb,
  recordsForKey,
  sequencesOf,
  settledResult,
} from "./run-event-ledger-domain-b-kit"
import {
  ackFindings,
  createLifeline,
  createSliceLedger,
  eventsOf,
  macrotaskTurns,
  type ProjectionEvent,
  processStoreFacade,
  upsertProjection,
} from "./run-event-ledger-slice-b-kit"

const identity = loadJsonFixture("identity-provenance.json")
const RUNTIME_PROVENANCE = identity.provenanceVariants.runtime
const storeFaults = loadJsonFixture("store-faults.json")

function faultCase(caseId: string): any {
  const found = (storeFaults.faultOperations ?? []).find(
    (entry: any) => entry.caseId === caseId,
  )
  if (!found)
    throw new Error(`store-faults.json#faultOperations lacks ${caseId}`)
  return found
}

function firstOp(row: any, predicate: (op: any) => boolean): any {
  const found = row.ops.find(predicate)
  if (!found) throw new Error(`${row.caseId} lacks the requested op`)
  return found
}

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

function trackDb(db: MigratedLedgerDb): MigratedLedgerDb {
  cleanups.push(() => db.close())
  return db
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i)
}

function keyOwner(record: any, keys: string[]): string[] {
  return keys.filter((key) => factKeyMentions(factKeyOf(record), key))
}

// ---------------------------------------------------------------------------
describe("agent-runtime-core / Canonical Run Event Ledger Ownership", () => {
  // Enforces once run-event-ledger.ts exists: a pre-commit store fault parks the
  // Run's ingestion (B pending, nothing read/delivered/acked) until the same key is retried.
  test("S11 Durable append fails before acknowledgement — memory store: while appendExact throws before commit for A and B is queued behind it, read(0), projection deliveries/acks and resolved acknowledgements contain neither; the same-key retry commits A then B at the reserved sequences", async () => {
    const row = faultCase("append-fails-before-commit")
    const runId = "run-slice-b-s11"
    const shared = new MemoryDurableStore({ runId })
    const log: ProjectionEvent[] = []
    const lifeline = createLifeline("p1")
    const store = processStoreFacade(shared, lifeline, { log })
    const output = new Map<string, any>()
    const projection = upsertProjection({
      name: row.projection,
      runId,
      lifeline,
      store,
      output,
      log,
    })
    const ledger = await createSliceLedger({
      runId,
      provenance: RUNTIME_PROVENANCE,
      durableStore: store,
      projections: [projection],
    })
    const a = firstOp(row, (op) => op.failAt === "beforeCommit")
    const b = firstOp(row, (op) => op.submittedWhile !== undefined)
    const keys = [a.key, b.key]

    const settlements: Array<{ key: string; fulfilled: boolean; value?: any }> =
      []
    const submit = (op: any) =>
      settledResult(() =>
        ledger.appendSystemEvent({ observationKey: op.key, ...op.input }),
      ).then((result) => {
        settlements.push({ key: op.key, ...result })
        return result
      })

    let faultActive = true
    let faultedAttempts = 0
    let queuedB: Promise<unknown> | null = null
    shared.beforeAppend = (batch) => {
      if (!faultActive || !batchMentionsKey(batch.records, a.key)) return
      faultedAttempts += 1
      // B is submitted while A's append is still failing inside the store.
      queuedB ??= submit(b)
      throw new Error("SQLITE_IOERR: injected fault before commit")
    }

    const firstA = await submit(a)
    await macrotaskTurns()
    const duringFailure = {
      aAcknowledged: firstA.fulfilled,
      faulted: faultedAttempts > 0,
      bSubmitted: queuedB !== null,
      rows: shared.records.length,
      highWater: shared.highWater(),
      readKeys: ((await ledger.read(0)) as any[]).flatMap((record) =>
        keyOwner(record, keys),
      ),
      deliveredKeys: eventsOf(log, "p1", "deliver").flatMap((event) =>
        keys.filter((key) => factKeyMentions(String(event.factKey), key)),
      ),
      acks: eventsOf(log, "p1", "ack").map((event) => event.sequence),
      acknowledgedKeys: settlements
        .filter((entry) => entry.fulfilled)
        .map((entry) => entry.key),
      // Adjudication (coordinator, audit F-S1): B parks pending while A's
      // append is failing — it is neither rejected nor committed ahead.
      settledKeys: settlements.map((entry) => entry.key),
      cursor: shared.cursor(runId, row.projection),
    }
    const expectedDuring = row.expected.duringFailure
    expect(duringFailure).toEqual({
      aAcknowledged: false,
      faulted: true,
      bSubmitted: true,
      rows: expectedDuring.rows,
      highWater: expectedDuring.highWater,
      readKeys: expectedDuring.readKeys,
      deliveredKeys: expectedDuring.deliveredKeys,
      acks: [],
      acknowledgedKeys: expectedDuring.acknowledgedKeys,
      settledKeys: [a.key],
      cursor: expectedDuring.cursor,
    })

    // Recovery: the fault clears, A is retried with the same key, both commit.
    faultActive = false
    const retriedA = await submit(a)
    await queuedB
    const retriedB = await submit(b)
    await macrotaskTurns()

    const records = (await ledger.read(0)) as any[]
    const aRecords = recordsForKey(records, a.key)
    const bRecords = recordsForKey(records, b.key)
    const expectedAfter = row.expected.afterRecovery
    expect(retriedA.fulfilled).toBe(true)
    expect(retriedB.fulfilled).toBe(true)
    expect(aRecords.length).toBeGreaterThan(0)
    expect(bRecords.length).toBeGreaterThan(0)
    // Only A and B exist: no diagnostic or partial record consumed a sequence.
    expect(records.length).toBe(aRecords.length + bRecords.length)
    expect(sequencesOf(records)).toEqual(denseRange(records.length))
    // A kept the first reserved sequences, B the next ones.
    expect(sequencesOf(aRecords)).toEqual(denseRange(aRecords.length))
    expect(sequencesOf(bRecords)).toEqual(
      range(aRecords.length + 1, records.length),
    )
    // Resolved acknowledgements: A first, then B, each the committed batch.
    const firstAckOrder = [
      ...new Set(
        settlements
          .filter((entry) => entry.fulfilled)
          .map((entry) => entry.key),
      ),
    ]
    expect(firstAckOrder).toEqual(expectedAfter.acknowledgedKeys)
    expect(Array.isArray(retriedA.value)).toBe(true)
    expect(sequencesOf(retriedA.value as any[])).toEqual(sequencesOf(aRecords))
    // Projection: A then B delivered at their committed sequences, cursor at high-water.
    const deliveredOrder = [
      ...new Set(
        eventsOf(log, "p1", "deliver").flatMap((event) =>
          keys.filter((key) => factKeyMentions(String(event.factKey), key)),
        ),
      ),
    ]
    expect(deliveredOrder).toEqual(expectedAfter.deliveredKeys)
    expect([...output.values()].map((record) => record.sequence)).toEqual(
      sequencesOf(records),
    )
    expect(shared.cursor(runId, row.projection)).toBe(records.length)
    expect(ackFindings(log, "p1", 0)).toEqual([])
    // One committed row per fact key; the handoff key is no native dedupe ID in payloads.
    const factKeys = shared.records.map(factKeyOf)
    expect(new Set(factKeys).size).toBe(factKeys.length)
    expect(
      records.filter((record) =>
        keys.some((key) =>
          JSON.stringify(record.payload ?? null).includes(key),
        ),
      ),
    ).toEqual([])
  })

  test("S11 Durable append fails before acknowledgement — SQLite: appendExactRunEventBatch rolls a mid-batch beforeCommit fault back atomically (no event row, no job mutation) and the same-key retry and resubmission leave exactly one row per fact key", async () => {
    const jobStore: any = await import("../src/main/lib/headless/job-store")
    // Real gap: job-store exports only the raw re-sequencing writers today.
    expect(typeof jobStore.appendExactRunEventBatch).toBe("function")

    const row = faultCase("sqlite-batch-fault")
    const ledgerDb = trackDb(createMigratedLedgerDb())
    const job = await jobStore.createAgentJob(ledgerDb.db, {
      source: "api",
      runtime: "codex",
      mode: "plan",
      cwd: process.cwd(),
      prompt: "store fault probe",
      apiConsumerId: "slice-b",
      apiConsumerRunId: "store-fault-001",
    })
    const baseRows = jobEventRows(ledgerDb.sqlite, job.id)
    const base = Math.max(0, ...baseRows.map((event) => Number(event.sequence)))
    const jobBefore = jobRow(ledgerDb.sqlite, job.id)

    const a = firstOp(row, (op) => op.failAt === "beforeCommit")
    const b = firstOp(row, (op) => op.key !== a.key)
    const batchOf = (op: any, highWater: number) =>
      op.records.map((input: any, ordinal: number) => ({
        ...createRunEvent({
          runId: job.id,
          jobId: job.id,
          runtimeId: "codex",
          sequence: highWater + ordinal + 1,
          type: input.type,
          payload: input.payload,
          createdAt: "2026-09-04T00:00:00.000Z",
        }),
        factKey: `${op.key}:${ordinal}`,
        metadata: {
          factKey: `${op.key}:${ordinal}`,
          observationKey: op.key,
          ordinal,
          boundary: "system",
          source: "api",
          provenance: { kind: "pending", runtimeId: "codex" },
          redaction: { status: "not-required", appliedRules: [] },
        },
      }))
    const append = (op: any, highWater: number) =>
      settledResult(() =>
        jobStore.appendExactRunEventBatch(ledgerDb.db, {
          jobId: job.id,
          records: batchOf(op, highWater),
          expectedHighWater: highWater,
          ...(op.jobMutation ? { jobMutation: op.jobMutation } : {}),
        }),
      )

    ledgerDb.sqlite.exec(
      `CREATE TEMP TRIGGER slice_b_before_commit_fault BEFORE INSERT ON main.agent_job_events WHEN json_extract(NEW.payload_json, '$.probe') = '${a.faultProbe}' BEGIN SELECT RAISE(ABORT, 'injected fault before commit'); END`,
    )
    const failed = await append(a, base)
    const duringFailure = {
      fulfilled: failed.fulfilled,
      newRows: jobEventRows(ledgerDb.sqlite, job.id).length - baseRows.length,
      job: jobRow(ledgerDb.sqlite, job.id),
    }
    expect(duringFailure).toEqual({
      fulfilled: false,
      newRows: row.expected.duringFailure.newRows,
      job: jobBefore,
    })

    ledgerDb.sqlite.exec("DROP TRIGGER temp.slice_b_before_commit_fault")
    const retried = await append(a, base)
    const resubmitted = await append(a, base)
    const bResult = await append(b, base + a.records.length)

    const rows = jobEventRows(ledgerDb.sqlite, job.id)
    const newRows = rows.slice(baseRows.length)
    const expectedAfter = row.expected.afterRecovery
    expect([
      retried.fulfilled,
      resubmitted.fulfilled,
      bResult.fulfilled,
    ]).toEqual([true, true, true])
    // The duplicate complete fact-key batch returns the committed records, no new append.
    expect(Array.isArray(resubmitted.value)).toBe(true)
    expect(sequencesOf(resubmitted.value as any[])).toEqual(
      range(base + 1, base + a.records.length),
    )
    // The store never changes supplied sequences or fact keys; one row per fact key.
    expect(newRows.map((event) => [event.sequence, event.fact_key])).toEqual(
      expectedAfter.factKeys.map((factKey: string, index: number) => [
        base + index + 1,
        factKey,
      ]),
    )
    expect(
      newRows.filter(
        (event) =>
          typeof event.record_metadata_json !== "string" ||
          event.record_metadata_json.length === 0,
      ),
    ).toEqual([])
    const perFactKey = new Map<string, number>()
    for (const event of rows.filter((entry) => entry.fact_key !== null)) {
      perFactKey.set(event.fact_key, (perFactKey.get(event.fact_key) ?? 0) + 1)
    }
    expect([...perFactKey.values()].filter((count) => count !== 1)).toEqual([])
    expect(rows.map((event) => event.sequence)).toEqual(denseRange(rows.length))
    // The job mutation landed exactly with the committed batch.
    const jobAfter = jobRow(ledgerDb.sqlite, job.id)
    expect({ status: jobAfter.status, workerId: jobAfter.worker_id }).toEqual({
      status: expectedAfter.status,
      workerId: expectedAfter.workerId,
    })
  })

  async function crashAndReopen(caseId: string) {
    const row = faultCase(caseId)
    const runId = `run-slice-b-${caseId}`
    const shared = new MemoryDurableStore({ runId })
    const log: ProjectionEvent[] = []
    const output = new Map<string, any>()
    const faultOp = firstOp(row, (op) => op.failAt !== undefined)
    const fault = { key: faultOp.key, failAt: faultOp.failAt }
    const appends = row.ops.filter((op: any) => op.op === "append")
    const reopenIndex = row.ops.findIndex((op: any) => op.op === "reopen")
    const beforeCrash = appends.filter(
      (op: any) => row.ops.indexOf(op) < reopenIndex,
    )
    const afterReopen = appends.filter(
      (op: any) => row.ops.indexOf(op) > reopenIndex,
    )

    // Host process 1.
    const p1 = createLifeline("p1")
    const store1 = processStoreFacade(shared, p1, { log, fault })
    const ledger1 = await createSliceLedger({
      runId,
      provenance: RUNTIME_PROVENANCE,
      durableStore: store1,
      projections: [
        upsertProjection({
          name: row.projection,
          runId,
          lifeline: p1,
          store: store1,
          output,
          log,
          fault,
        }),
      ],
    })
    const prefixKey = row.expected.cursorAtCrashKey
    for (const op of beforeCrash) {
      // The process may die inside this call; a dead process acknowledges nothing.
      await settledResult(() =>
        ledger1.appendSystemEvent({ observationKey: op.key, ...op.input }),
      )
      await macrotaskTurns()
    }
    const atCrash = {
      dead: p1.dead,
      crashedAt: p1.crashedAt,
      cursor: shared.cursor(runId, row.projection),
      committedKeys: beforeCrash
        .map((op: any) => op.key)
        .filter((key: string) => recordsForKey(shared.records, key).length > 0),
      deliveredBeforeCrash: [
        ...new Set(
          eventsOf(log, "p1", "deliver").flatMap((event) =>
            appends
              .map((op: any) => op.key)
              .filter((key: string) =>
                factKeyMentions(String(event.factKey), key),
              ),
          ),
        ),
      ],
    }
    const prefixRecords = recordsForKey(shared.records, prefixKey)
    const cursorAtCrash = Math.max(0, ...sequencesOf(prefixRecords))
    const highWaterAtCrash = shared.highWater()
    const faultedRecords = recordsForKey(shared.records, fault.key)

    // Host process 2 recreates the ledger over the same store and cursor.
    const p2 = createLifeline("p2")
    const store2 = processStoreFacade(shared, p2, { log })
    const ledger2 = await createSliceLedger({
      runId,
      provenance: RUNTIME_PROVENANCE,
      durableStore: store2,
      projections: [
        upsertProjection({
          name: row.projection,
          runId,
          lifeline: p2,
          store: store2,
          output,
          log,
        }),
      ],
    })
    for (const op of afterReopen) {
      await ledger2.appendSystemEvent({ observationKey: op.key, ...op.input })
    }
    await macrotaskTurns()
    return {
      row,
      runId,
      shared,
      log,
      output,
      fault,
      atCrash,
      prefixRecords,
      cursorAtCrash,
      highWaterAtCrash,
      faultedRecords,
      afterReopen,
      records: (await ledger2.read(0)) as any[],
    }
  }

  function crashFindings(run: Awaited<ReturnType<typeof crashAndReopen>>) {
    const { row, log, output, records, faultedRecords } = run
    const nextKey = run.afterReopen[0].key
    const nextRecords = recordsForKey(records, nextKey)
    const upsertValues = [...output.values()]
    return {
      // cursor(name) resumed at the unacknowledged record's original sequence.
      deliveredAfterReopen: eventsOf(log, "p2", "deliver").map(
        (event) => event.sequence,
      ),
      // read(0) never duplicates A; the next observation takes the next sequence.
      faultedInRead: sequencesOf(recordsForKey(records, run.fault.key)),
      nextSequences: sequencesOf(nextRecords),
      dense: sequencesOf(records),
      // The projector upsert holds each record (A included) exactly once.
      upsertByKey: row.expected.upsertOnce.map(
        (key: string) =>
          upsertValues.filter((record) =>
            factKeyMentions(factKeyOf(record), key),
          ).length,
      ),
      upsertSequences: upsertValues
        .map((record) => Number(record.sequence))
        .sort((x, y) => x - y),
      // ack advances monotonically over the delivered contiguous prefix.
      ackFindings: ackFindings(log, "p2", run.cursorAtCrash),
      finalCursor: run.shared.cursor(run.runId, row.projection),
      faultedCount: faultedRecords.length,
    }
  }

  function expectedCrashFindings(
    run: Awaited<ReturnType<typeof crashAndReopen>>,
  ) {
    const { row, records } = run
    const nextKey = run.afterReopen[0].key
    const nextCount = recordsForKey(records, nextKey).length
    return {
      deliveredAfterReopen: range(run.cursorAtCrash + 1, records.length),
      faultedInRead: sequencesOf(run.faultedRecords),
      nextSequences: range(
        run.highWaterAtCrash + 1,
        run.highWaterAtCrash + Math.max(1, nextCount),
      ),
      dense: denseRange(records.length),
      upsertByKey: row.expected.upsertOnce.map(
        (key: string) => recordsForKey(records, key).length,
      ),
      upsertSequences: denseRange(records.length),
      ackFindings: [],
      finalCursor: records.length,
      faultedCount: Math.max(1, run.faultedRecords.length),
    }
  }

  // Enforces once run-event-ledger.ts exists: reopen resumes the projection cursor at the
  // unacknowledged committed record without duplicating it in read(0) or the upsert.
  test("S12 Process crashes after commit and before projection — crash right after A commits: the reopened ledger resumes cursor(name) at A's original sequence, the projector upsert holds A once, acks advance monotonically and the next observation takes the next sequence", async () => {
    const run = await crashAndReopen("crash-after-commit")
    expect(run.atCrash).toEqual({
      dead: true,
      crashedAt: "afterCommit",
      cursor: run.cursorAtCrash,
      committedKeys: run.row.ops
        .filter(
          (op: any) => op.op === "append" && op.key !== run.afterReopen[0].key,
        )
        .map((op: any) => op.key),
      deliveredBeforeCrash: run.row.expected.deliveredBeforeCrash,
    })
    expect(run.cursorAtCrash).toBeGreaterThan(0)
    expect(crashFindings(run)).toEqual(expectedCrashFindings(run))
  })

  // Enforces once run-event-ledger.ts exists: at-least-once redelivery after a
  // deliver-without-ack crash upserts by (runId, sequence) and keeps acks monotone.
  test("S12 Process crashes after commit and before projection — crash after A is delivered but before its ack: the reopened ledger redelivers A at its original sequence without duplicating the upsert or read(0), acks stay monotone over the prefix and the next observation takes the next sequence", async () => {
    const run = await crashAndReopen("crash-after-deliver")
    expect(run.atCrash).toEqual({
      dead: true,
      crashedAt: "afterDeliver",
      cursor: run.cursorAtCrash,
      committedKeys: run.row.ops
        .filter(
          (op: any) => op.op === "append" && op.key !== run.afterReopen[0].key,
        )
        .map((op: any) => op.key),
      deliveredBeforeCrash: run.row.expected.deliveredBeforeCrash,
    })
    expect(run.cursorAtCrash).toBeGreaterThan(0)
    expect(crashFindings(run)).toEqual(expectedCrashFindings(run))
  })
})

function batchMentionsKey(records: any[] | undefined, key: string): boolean {
  return (records ?? []).some((record) =>
    factKeyMentions(factKeyOf(record), key),
  )
}
