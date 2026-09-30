/**
 * Parity of the assistant output-evidence helper with the ledger's item read
 * model (refactor-canonical-run-event-ledger, T4 review P3).
 * `assistantItemOutputRecords` re-implements the assistant branch of the
 * ledger's private item reduction (`reduceItem`) over committed records. Over
 * the same committed records, the items it counts and their text must equal
 * what `readItem()` reports for those keys (a counted item has non-empty
 * trimmed text), and the records it cites must be the ones that carry that
 * text: the non-empty deltas of an item still streaming, or the latest
 * `item_reconciliation` carrying a completed item's final text.
 *
 * Pinned citation choice: the ledger restates the final text in the echo it
 * commits for a delta after completion (`ignoredDelta: true`) and for a
 * duplicate completion (`suppressedDuplicateCount` + 1), so each echo is the
 * latest reconciliation carrying the final text and is the cited record, not
 * the completion reconciliation before it.
 */
import { describe, expect, test } from "bun:test"
import {
  assistantItemOutputRecords,
  createCanonicalRunEventLedger,
  isAssistantItemRecord,
  type LedgerRecord,
  type RuntimeExecutionProvenance,
} from "../src/main/lib/agent-runtime/run-event-ledger"

const HINT = "zq-provider-secret-ABCDEFGH12345678"

const CODEX_TUPLE: RuntimeExecutionProvenance = {
  kind: "runtime",
  installationId: "inst-codex-output-evidence-parity",
  runtimeId: "codex",
  adapterSource: "codex-app-server",
  version: "0.139.0",
  executableRef: "exe-output-evidence-parity",
  binarySha256: "a".repeat(64),
  protocolName: "codex-app-server-jsonrpc",
  protocolVersion: "v2",
  schemaFiles: [{ path: "ServerNotification.ts", sha256: "b".repeat(64) }],
}

type Step =
  | { kind: "delta"; itemId: string; delta: string }
  | { kind: "completed"; itemId: string; text: string }
  | { kind: "coarse"; text: string }

let runs = 0

/** Drives a real ledger over an in-memory store; returns its records. */
async function committedRecords(steps: readonly Step[]) {
  runs += 1
  const rows: LedgerRecord[] = []
  const ledger = createCanonicalRunEventLedger({
    runId: `run-output-evidence-parity-${runs}`,
    runtimeId: "codex",
    provenance: CODEX_TUPLE,
    redactionContext: { secretHints: [HINT] },
    durableStore: {
      appendExact(input: { records: unknown[] }) {
        rows.push(...(input.records as LedgerRecord[]))
        return input.records
      },
      read(_runId: string, after = 0) {
        return rows.filter((row) => row.sequence > after)
      },
    },
  })
  let ordinal = 0
  const notify = (method: string, params: unknown) => {
    ordinal += 1
    return ledger.ingestNotification({
      observationKey: `n-${ordinal}`,
      transportId: "t1",
      receivedAt: "2026-10-01T00:00:00.000Z",
      message: { method, params },
    })
  }
  await notify("turn/started", {
    threadId: "th",
    turn: { id: "tu", status: "inProgress", error: null },
  })
  for (const step of steps) {
    if (step.kind === "delta") {
      await notify("item/agentMessage/delta", {
        threadId: "th",
        turnId: "tu",
        itemId: step.itemId,
        delta: step.delta,
      })
    } else if (step.kind === "completed") {
      await notify("item/completed", {
        threadId: "th",
        turnId: "tu",
        item: { type: "agentMessage", id: step.itemId, text: step.text },
      })
    } else {
      ordinal += 1
      await ledger.ingestRuntimeObservation({
        observationKey: `coarse-${ordinal}`,
        type: "assistant_delta",
        payload: { text: step.text },
      })
    }
  }
  return { ledger, records: await ledger.read(0) }
}

type Ledger = Awaited<ReturnType<typeof committedRecords>>["ledger"]

/** The read-model lookup of a record's item (native ids or correlation). */
function itemLookup(record: LedgerRecord): Record<string, unknown> {
  const item = (record.payload as { item: Record<string, unknown> }).item
  const lookup: Record<string, unknown> = {
    channel: item.channel,
    partIndex: item.partIndex ?? 0,
  }
  if (typeof item.correlationKey === "string") {
    lookup.correlationKey = item.correlationKey
  } else {
    lookup.threadId = item.threadId
    lookup.turnId = item.turnId
    lookup.itemId = item.itemId
  }
  return lookup
}

type ItemParity = {
  lookup: Record<string, unknown>
  model: Awaited<ReturnType<Ledger["readItem"]>>
  cited: LedgerRecord[]
}

/**
 * Asserts the parity over every assistant item of the records and returns,
 * per item key, the read model and the records the helper cites.
 */
async function assertParity(
  ledger: Ledger,
  records: readonly LedgerRecord[],
): Promise<Map<string, ItemParity>> {
  const cited = assistantItemOutputRecords(records)
  const items = new Map<string, ItemParity>()
  for (const record of records) {
    if (!isAssistantItemRecord(record)) continue
    const lookup = itemLookup(record)
    const key = JSON.stringify(lookup)
    if (!items.has(key)) {
      items.set(key, {
        lookup,
        model: await ledger.readItem(lookup),
        cited: [],
      })
    }
  }
  for (const record of cited) {
    const entry = items.get(JSON.stringify(itemLookup(record)))
    if (!entry) throw new Error("the helper cited a non-item record")
    entry.cited.push(record)
  }
  for (const { model, cited: carriers } of items.values()) {
    expect(model).not.toBeNull()
    const text = model?.text ?? ""
    const counted = text.trim().length > 0
    // Counted items are exactly the read-model items with non-empty text.
    expect(carriers.length > 0).toBe(counted)
    if (!counted) continue
    if (model?.state === "completed") {
      // One carrier: a reconciliation carrying the read model's final text.
      expect(carriers).toHaveLength(1)
      expect(carriers[0].type).toBe("status")
      expect(carriers[0].payload?.subtype).toBe("item_reconciliation")
      const item = carriers[0].payload?.item as Record<string, unknown>
      expect(item.state).toBe("completed")
      expect(item.text).toBe(text)
    } else {
      // Its non-empty deltas, which together are its materialized text.
      for (const carrier of carriers)
        expect(carrier.type).toBe("assistant_delta")
      expect(
        carriers.map((carrier) => String(carrier.payload?.text ?? "")).join(""),
      ).toBe(text)
    }
  }
  return items
}

function only(items: Map<string, ItemParity>): ItemParity {
  expect(items.size).toBe(1)
  return [...items.values()][0]
}

function sequences(records: readonly LedgerRecord[]): number[] {
  return records.map((record) => record.sequence)
}

function reconciliations(records: readonly LedgerRecord[]): LedgerRecord[] {
  return records.filter(
    (record) =>
      record.type === "status" &&
      record.payload?.subtype === "item_reconciliation",
  )
}

describe("assistantItemOutputRecords parity with readItem (T4 review P3)", () => {
  test("streaming only: the item counts by its materialized text, citing its deltas", async () => {
    const { ledger, records } = await committedRecords([
      { kind: "delta", itemId: "m1", delta: "Hello, " },
      { kind: "delta", itemId: "m1", delta: "world" },
    ])
    const item = only(await assertParity(ledger, records))
    expect(item.model?.state).toBe("streaming")
    expect(item.model?.text).toBe("Hello, world")
    expect(sequences(item.cited)).toEqual(
      sequences(records.filter((record) => record.type === "assistant_delta")),
    )
  })

  test("completed non-empty: the final text replaces the deltas; the completion reconciliation is cited", async () => {
    const { ledger, records } = await committedRecords([
      { kind: "delta", itemId: "m1", delta: "draft" },
      { kind: "completed", itemId: "m1", text: "final answer" },
    ])
    const item = only(await assertParity(ledger, records))
    expect(item.model?.state).toBe("completed")
    expect(item.model?.text).toBe("final answer")
    expect(sequences(item.cited)).toEqual(sequences(reconciliations(records)))
  })

  test("completed empty after deltas: the item is not counted and readItem reports empty text", async () => {
    const { ledger, records } = await committedRecords([
      { kind: "delta", itemId: "m1", delta: "draft " },
      { kind: "delta", itemId: "m1", delta: "answer" },
      { kind: "completed", itemId: "m1", text: "" },
    ])
    const item = only(await assertParity(ledger, records))
    expect(item.model?.state).toBe("completed")
    expect(item.model?.text).toBe("")
    expect(item.cited).toEqual([])
    expect(assistantItemOutputRecords(records)).toEqual([])
  })

  test("delta after completion: the ignoredDelta echo restates the final text and is the cited record", async () => {
    const { ledger, records } = await committedRecords([
      { kind: "delta", itemId: "m1", delta: "draft" },
      { kind: "completed", itemId: "m1", text: "final answer" },
      { kind: "delta", itemId: "m1", delta: " late tail" },
    ])
    const item = only(await assertParity(ledger, records))
    expect(item.model?.state).toBe("completed")
    expect(item.model?.text).toBe("final answer")
    expect(item.model?.reconciliation.suppressedDuplicateCount).toBe(1)
    const [completion, echo] = reconciliations(records)
    expect(completion.payload?.ignoredDelta).toBeUndefined()
    expect(echo.payload?.ignoredDelta).toBe(true)
    expect((echo.payload?.item as { text?: unknown }).text).toBe("final answer")
    // Pinned: the echo (the latest reconciliation carrying the final text) is
    // cited; the completion reconciliation before it is not.
    expect(sequences(item.cited)).toEqual([echo.sequence])
    expect(sequences(item.cited)).not.toContain(completion.sequence)
  })

  test("repeated completion: the suppressed-count echo restates the final text and is the cited record", async () => {
    const { ledger, records } = await committedRecords([
      { kind: "completed", itemId: "m1", text: "final answer" },
      { kind: "completed", itemId: "m1", text: "final answer" },
    ])
    const item = only(await assertParity(ledger, records))
    expect(item.model?.text).toBe("final answer")
    expect(item.model?.reconciliation.suppressedDuplicateCount).toBe(1)
    const [first, repeat] = reconciliations(records)
    const counts = (record: LedgerRecord) =>
      (record.payload?.reconciliation as { suppressedDuplicateCount?: unknown })
        .suppressedDuplicateCount
    expect(counts(first)).toBe(0)
    expect(counts(repeat)).toBe(1)
    expect((repeat.payload?.item as { text?: unknown }).text).toBe(
      "final answer",
    )
    // Pinned: the repeat (the latest reconciliation carrying the final text)
    // is cited; the first completion is not.
    expect(sequences(item.cited)).toEqual([repeat.sequence])
  })

  test("withheld-prefix-only delta: redactionPending with empty text is not counted", async () => {
    const { ledger, records } = await committedRecords([
      { kind: "delta", itemId: "m1", delta: "zq-provider" },
    ])
    const [delta] = records.filter(
      (record) => record.type === "assistant_delta",
    )
    expect(delta.payload?.redactionPending).toBe(true)
    expect(delta.payload?.text).toBe("")
    const item = only(await assertParity(ledger, records))
    expect(item.model?.state).toBe("streaming")
    expect(item.model?.text).toBe("")
    expect(item.cited).toEqual([])
  })

  test("coarse whitespace-only delta: its correlation item is not counted", async () => {
    const { ledger, records } = await committedRecords([
      { kind: "coarse", text: "  \n\t " },
    ])
    const item = only(await assertParity(ledger, records))
    expect(typeof item.lookup.correlationKey).toBe("string")
    expect(item.model?.text).toBe("  \n\t ")
    expect(item.cited).toEqual([])
  })

  test("all scenarios in one Run: per-item parity holds and only the non-empty items are cited", async () => {
    const { ledger, records } = await committedRecords([
      { kind: "delta", itemId: "streaming", delta: "partial" },
      { kind: "delta", itemId: "done", delta: "draft" },
      { kind: "completed", itemId: "done", text: "done text" },
      { kind: "delta", itemId: "emptied", delta: "gone" },
      { kind: "completed", itemId: "emptied", text: "" },
      { kind: "completed", itemId: "echoed", text: "echoed text" },
      { kind: "delta", itemId: "echoed", delta: "late" },
      { kind: "completed", itemId: "echoed", text: "echoed text" },
      { kind: "delta", itemId: "withheld", delta: "zq-provider" },
      { kind: "coarse", text: "   " },
    ])
    const items = await assertParity(ledger, records)
    expect(items.size).toBe(6)
    const counted = [...items.values()]
      .filter((item) => item.cited.length > 0)
      .map((item) => item.model?.text)
    expect(counted.sort()).toEqual(["done text", "echoed text", "partial"])
  })
})
