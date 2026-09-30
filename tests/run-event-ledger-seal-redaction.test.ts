/**
 * Implementer unit tests for stream redaction across the seal
 * (refactor-canonical-run-event-ledger T2-10 / S-07; design "Item
 * Reconciliation and Redaction": potential secret suffixes are withheld
 * before persistence/fan-out and a terminal flush never releases an unsafe
 * prefix; core spec "Stateful Ledger Redaction"). The seal drops a
 * channel's withheld prefix; a continuation of that channel after the seal
 * must not publish the rest of the secret in its late diagnostic or to the
 * live renderer. The immutable boundaries red file pins the pre-seal half.
 */
import { describe, expect, test } from "bun:test"
import {
  createCanonicalRunEventLedger,
  type OutcomeEvidence,
  type RuntimeExecutionProvenance,
} from "../src/main/lib/agent-runtime/run-event-ledger"
import { createDesktopRendererChannel } from "../src/main/lib/agent-runtime/run-event-ledger-host"

type Row = {
  sequence: number
  type: string
  payload?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

const HINT = "zq-provider-secret-ABCDEFGH12345678"
const SECRET_PARTS = ["-secret-", "ABCDEFGH", "12345678", "secret-ABCD"]

const CODEX_TUPLE: RuntimeExecutionProvenance = {
  kind: "runtime",
  installationId: "inst-codex-seal-redaction-test",
  runtimeId: "codex",
  adapterSource: "codex-app-server",
  version: "0.139.0",
  executableRef: "exe-seal-redaction-test",
  binarySha256: "a".repeat(64),
  protocolName: "codex-app-server-jsonrpc",
  protocolVersion: "v2",
  schemaFiles: [{ path: "ServerNotification.ts", sha256: "b".repeat(64) }],
}

const SUCCESS: OutcomeEvidence = {
  trigger: {
    kind: "host_result",
    status: "succeeded",
    observationKey: "seal-redaction-terminal",
  },
  policy: { denied: false, evidenceKeys: ["policy:none"] },
  output: {
    valid: true,
    empty: false,
    allowEmpty: false,
    evidenceKeys: ["output:test"],
  },
  postRun: { credentialsSafe: true, evidenceKeys: ["postrun:ok"] },
}

function memoryLedger(runId: string, provenance: unknown = CODEX_TUPLE) {
  const rows: Row[] = []
  const ledger = createCanonicalRunEventLedger({
    runId,
    runtimeId: "codex",
    provenance,
    redactionContext: { secretHints: [HINT] },
    durableStore: {
      appendExact(input: { records: unknown[] }) {
        rows.push(...(input.records as Row[]))
        return input.records
      },
      read(_runId: string, after = 0) {
        return rows.filter((row) => row.sequence > after)
      },
    },
  })
  return { ledger, rows }
}

function lateEvents(rows: Row[]): Row[] {
  return rows.filter(
    (row) => row.type === "status" && row.payload?.subtype === "late_event",
  )
}

function expectNoSecretPart(value: unknown) {
  const text = JSON.stringify(value)
  expect(text).not.toContain(HINT)
  for (const part of SECRET_PARTS) expect(text).not.toContain(part)
}

function completedOf(rows: Row[]): Row {
  const completed = rows.find((row) => row.type === "completed")
  if (!completed) throw new Error("expected one completed")
  return completed
}

describe("stream redaction across the seal (T2-10 / S-07)", () => {
  test("a coarse delta continuing a withheld hint prefix after the seal publishes no part of the hint", async () => {
    const { ledger, rows } = memoryLedger("run-seal-coarse")
    await ledger.ingestRuntimeObservation({
      observationKey: "coarse-1",
      type: "assistant_delta",
      payload: { text: "answer zq-provider" },
    })
    await ledger.settle(SUCCESS)
    await ledger.ingestRuntimeObservation({
      observationKey: "coarse-2",
      type: "assistant_delta",
      payload: { text: "-secret-ABCDEFGH12345678 done" },
    })

    const late = lateEvents(rows)
    expect(late).toHaveLength(1)
    expect(late[0].payload?.observation).toMatchObject({
      contentOmitted: true,
      contentLength: "-secret-ABCDEFGH12345678 done".length,
    })
    expectNoSecretPart(rows)
    // The seal's loss accounting is unchanged.
    const completed = completedOf(rows)
    expect(completed.payload?.lossPossible).toBe(true)
    expect(completed.metadata).toMatchObject({
      redaction: { withheldDropped: 1 },
    })
  })

  test("a native Codex delta continuing a withheld hint prefix after the seal publishes no part of the hint", async () => {
    const { ledger, rows } = memoryLedger("run-seal-native")
    const notify = (observationKey: string, method: string, params: unknown) =>
      ledger.ingestNotification({
        observationKey,
        transportId: "t1",
        receivedAt: "2026-09-04T00:00:00.000Z",
        message: { method, params },
      })
    await notify("n-started", "turn/started", {
      threadId: "th",
      turn: { id: "tu", status: "inProgress", error: null },
    })
    await notify("n-delta-1", "item/agentMessage/delta", {
      threadId: "th",
      turnId: "tu",
      itemId: "msg-1",
      delta: "answer zq-provider",
    })
    await ledger.settle(SUCCESS)
    await notify("n-delta-2", "item/agentMessage/delta", {
      threadId: "th",
      turnId: "tu",
      itemId: "msg-1",
      delta: "-secret-ABCDEFGH12345678 done",
    })

    const late = lateEvents(rows)
    expect(late).toHaveLength(1)
    expect(late[0].payload?.observation).toMatchObject({
      contentOmitted: true,
      contentLength: "-secret-ABCDEFGH12345678 done".length,
    })
    expect(late[0].payload?.observation).not.toHaveProperty("text")
    expectNoSecretPart(rows)
    expect(completedOf(rows).payload?.lossPossible).toBe(true)
  })

  test("a channel with nothing withheld at the seal keeps its redacted late text", async () => {
    const { ledger, rows } = memoryLedger("run-seal-clean")
    await ledger.ingestRuntimeObservation({
      observationKey: "coarse-1",
      type: "assistant_delta",
      payload: { text: "a complete answer" },
    })
    await ledger.settle(SUCCESS)
    await ledger.ingestRuntimeObservation({
      observationKey: "coarse-2",
      type: "assistant_delta",
      payload: { text: "a trailing note" },
    })

    const [late] = lateEvents(rows)
    expect(late.payload?.observation).toMatchObject({
      text: "a trailing note",
    })
    expect(late.payload?.observation).not.toHaveProperty("contentOmitted")
    expect(completedOf(rows).payload?.lossPossible).toBeUndefined()
  })

  test("the live renderer never receives a buffered post-terminal stream fragment continuing a withheld prefix", async () => {
    const { ledger, rows } = memoryLedger("run-seal-renderer")
    const emitted: Array<Record<string, unknown>> = []
    const channel = createDesktopRendererChannel({
      runtimeId: "codex",
      runId: "run-seal-renderer",
      observationPrefix: "renderer",
      getLedger: () => ledger,
      getSecretHints: () => [HINT],
      emit: (chunk) => emitted.push(chunk),
    })
    await ledger.ingestNotification({
      observationKey: "n-started",
      transportId: "t1",
      message: {
        method: "turn/started",
        params: {
          threadId: "th",
          turn: { id: "tu", status: "inProgress", error: null },
        },
      },
    })
    channel.submit({
      type: "text-delta",
      id: "m1",
      delta: "answer zq-provider",
    })
    await channel.drain()
    // The native terminal candidate: later durable observations are
    // buffered as post-terminal late diagnostics.
    await ledger.ingestNotification({
      observationKey: "n-completed",
      transportId: "t1",
      message: {
        method: "turn/completed",
        params: {
          threadId: "th",
          turn: { id: "tu", status: "completed", error: null },
        },
      },
    })
    channel.submit({
      type: "text-delta",
      id: "m1",
      delta: "-secret-ABCDEFGH12345678 done",
    })
    // A buffered non-stream chunk still reaches the renderer (redacted).
    channel.submit({
      type: "error",
      errorText: "post-run check failed",
    })
    await channel.drain()
    await ledger.settle(SUCCESS)

    expectNoSecretPart(emitted)
    expect(emitted.filter((chunk) => chunk.type === "text-delta")).toHaveLength(
      1,
    )
    expect(emitted.some((chunk) => chunk.type === "error")).toBe(true)
    expectNoSecretPart(rows)
  })
})
