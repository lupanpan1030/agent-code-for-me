/** biome-ignore-all lint/suspicious/noExplicitAny: the ledger contract under test does not exist yet; records are asserted structurally. */
/**
 * Follow-up red slice B, part 2 — native interrupt context, split-secret
 * redaction and interaction boundaries of the canonical Run event ledger
 * (`openspec/changes/refactor-canonical-run-event-ledger`).
 *
 * Scenarios (agent-runtime-core):
 *   S16 Native Identity And Runtime Provenance / Interrupt target comes from native Run state
 *   S17 Stateful Ledger Redaction / Runtime splits an exact secret across adjacent events
 *   S32 Observable Native Methods And Boundary Facts / Interaction boundary is recorded
 *       without a second state machine
 *
 * Fixtures: `identity-provenance.json` (cases `interrupt-target`,
 * `interrupt-target-missing-turn`, `distinct-native-ids`; read-only reuse),
 * `split-secrets.json` (tasks 7.14), `interaction-boundaries.jsonl` (tasks 7.1).
 *
 * Entry points (design "Test-facing Contract" / owner mapping; never invented):
 * - `createCanonicalRunEventLedger` from NEW `agent-runtime/run-event-ledger.ts`:
 *   `ingestNotification`, `ingestResponse`, `ingestServerRequest`,
 *   `recordServerResponseSend`, `recordServerRequestResolved`, `settle`,
 *   `read(afterSequence)`, `readOutcome`, `readNativeContext`, with
 *   `redactionContext: { secretHints }` and a recording `projections` port.
 * - `projectRunEventToRendererChunks` (stream-event-mapper.ts, repurposed by
 *   the design as the pure renderer projection of committed records).
 * - Existing `createExactSecretStreamChannelRedactor` (agent-runtime/redaction.ts,
 *   "the sole stateful exact-secret algorithm", kept by the design) and the
 *   existing `codex/app-server-stream-events.ts` module surface.
 *
 * Shapes frozen here where the design is silent (see the slice-B report):
 * - a delta record's text contribution is its top-level payload text field
 *   (`delta`/`text`, tool progress may use `message`/`output`); a later safe
 *   release is a record of the same channel type;
 * - the applied exact-hint rule is recorded as `"secret-hint"` (the existing
 *   rule name of redaction.ts) in an `appliedRules` array of the record;
 * - response-send records carry the explicit send result under `result` (or
 *   `sendResult`) in the payload; `requestId` keeps the JSON-RPC id's type.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { createExactSecretStreamChannelRedactor } from "../src/main/lib/agent-runtime/redaction"
import {
  loadJsonFixture as loadBFixture,
  MemoryDurableStore,
  recordsForKey,
  sequencesOf,
  settledResult,
} from "./run-event-ledger-domain-b-kit"
import {
  captureHostOutput,
  channelText,
  createSliceLedger,
  loadRendererProjector,
  macrotaskTurns,
  recordingProjection,
  textLeaves,
} from "./run-event-ledger-slice-b-kit"
import {
  createTestLedger,
  drive,
  factKeyMentions,
  type LedgerRecord,
  loadJsonFixture,
  loadJsonlFixture,
  readAll,
  valuesByKey,
} from "./run-event-ledger-test-harness"

mock.module("electron", () => ({
  app: { getPath: () => "/tmp", isPackaged: false, getAppPath: () => "/tmp" },
  BrowserWindow: class BrowserWindow {},
}))

type IdentityFixture = {
  secretHints: string[]
  provenanceVariants: Record<string, Record<string, unknown>>
  cases: Array<{
    caseId: string
    steps?: Array<{
      port: string
      observationKey: string
      transportId?: string
      input: Record<string, unknown>
    }>
    expected: Record<string, any>
  }>
}

const identity = loadJsonFixture<IdentityFixture>("identity-provenance.json")
const RUNTIME_PROVENANCE = identity.provenanceVariants.runtime

function identityCase(caseId: string) {
  const found = identity.cases.find((entry) => entry.caseId === caseId)
  if (!found?.steps) throw new Error(`identity-provenance.json lacks ${caseId}`)
  return found as Required<(typeof identity.cases)[number]>
}

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

// ---------------------------------------------------------------------------
// S16 — agent-runtime-core / Native Identity And Runtime Provenance
// ---------------------------------------------------------------------------
describe("agent-runtime-core / Native Identity And Runtime Provenance", () => {
  const HOST_ONLY_KEYS = ["nativeContext", "interruptTarget", "interrupt"]

  // Enforces once run-event-ledger.ts exists: readNativeContext() is the host-only
  // raw interrupt target {threadId, turnId} reduced from committed native
  // observations; reading it appends nothing and it is never a record field.
  test("S16 Interrupt target comes from native Run state — after thread/turn observations readNativeContext() returns exactly the observed {threadId, turnId}, appends no record and is never serialized", async () => {
    const fixture = identityCase("interrupt-target")
    const { ledger, inspect } = await createTestLedger({
      provenance: RUNTIME_PROVENANCE,
    })
    for (const step of fixture.steps) await drive(ledger, step)
    const before = await readAll(ledger)

    const first = await ledger.readNativeContext()
    const second = await ledger.readNativeContext()
    const after = await readAll(ledger)

    expect(first).toEqual(fixture.expected.interrupt)
    expect(second).toEqual(fixture.expected.interrupt)
    expect(before.length).toBeGreaterThan(0)
    expect(after).toEqual(before)
    expect(inspect.rows()).toEqual(before)
    expect(HOST_ONLY_KEYS.flatMap((key) => valuesByKey(after, key))).toEqual([])
  })

  // Enforces once run-event-ledger.ts exists: the interrupt target is the raw
  // native thread/turn pair (not the redacted durable identity) and never
  // carries the session ID; the raw value never reaches committed records.
  test("S16 Interrupt target comes from native Run state — with exact secret hints the host-only target keeps the raw observed threadId/turnId, never the sessionId, while committed records never contain the raw target", async () => {
    const fixture = identityCase("distinct-native-ids")
    const raw = fixture.expected.rawIds as Record<string, any>
    const { ledger } = await createTestLedger({
      provenance: RUNTIME_PROVENANCE,
      secretHints: identity.secretHints,
    })
    for (const step of fixture.steps) await drive(ledger, step)
    const target = await ledger.readNativeContext()
    const serialized = JSON.stringify(await readAll(ledger))

    expect(target).toEqual({ threadId: raw.threadId, turnId: raw.turnId })
    expect(JSON.stringify(target)).not.toContain(raw.sessionId)
    expect(serialized).not.toContain(raw.threadId)
  })

  // Enforces once run-event-ledger.ts exists: without an observed turn ID there
  // is no interrupt target; an observed session ID (or thread ID) is never
  // substituted for the missing turn.
  test("S16 Interrupt target comes from native Run state — the missing-turn variants (thread status only; thread/start response with a distinct sessionId but no turn; no observation) return no target", async () => {
    const missingTurn = identityCase("interrupt-target-missing-turn")
    const distinct = identityCase("distinct-native-ids")
    const variants = [
      { variant: "thread-status-only", steps: missingTurn.steps },
      {
        variant: "session-observed-no-turn",
        steps: distinct.steps.filter((step) => step.port === "ingestResponse"),
      },
      { variant: "no-observation", steps: [] },
    ]
    const observed: unknown[] = []
    for (const variant of variants) {
      const { ledger } = await createTestLedger({
        provenance: RUNTIME_PROVENANCE,
      })
      for (const step of variant.steps) await drive(ledger, step)
      observed.push({
        variant: variant.variant,
        target: (await ledger.readNativeContext()) ?? null,
      })
    }
    expect(missingTurn.expected.interrupt).toBeNull()
    expect(observed).toEqual(
      variants.map((variant) => ({ variant: variant.variant, target: null })),
    )
  })

  test("S16 Interrupt target comes from native Run state — codex/app-server-stream-events.ts no longer exports a stateful mapper that builds the interrupt request from adapter-held thread/turn state", async () => {
    const streamEvents: Record<string, unknown> = await import(
      "../src/main/lib/codex/app-server-stream-events"
    )
    const statefulInterruptBuilders = Object.entries(streamEvents)
      .filter(
        ([name, value]) =>
          name.startsWith("create") &&
          typeof value === "function" &&
          (value as (...args: unknown[]) => unknown).length === 0,
      )
      .filter(([, factory]) => {
        const instance = (factory as () => unknown)() as Record<string, unknown>
        return (
          instance !== null &&
          typeof instance === "object" &&
          typeof instance.buildInterruptRequest === "function"
        )
      })
      .map(([name]) => name)
    expect(statefulInterruptBuilders).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// S17 — agent-runtime-core / Stateful Ledger Redaction
// ---------------------------------------------------------------------------
describe("agent-runtime-core / Stateful Ledger Redaction", () => {
  const split = loadBFixture("split-secrets.json")
  const HINTS: string[] = split.secretHints
  const channelOf = (name: string) => {
    const found = split.channels.find((entry: any) => entry.channel === name)
    if (!found) throw new Error(`split-secrets.json lacks channel ${name}`)
    return found
  }

  function deltaNotification(channel: any, text: string) {
    return {
      message: {
        method: channel.method,
        params: {
          threadId: split.native.threadId,
          turnId: split.native.turnId,
          itemId: channel.itemId,
          [channel.textParam]: text,
        },
      },
    }
  }

  /** One Codex Run on its own store with a recording renderer projection. */
  async function splitRun(runId: string) {
    const store = new MemoryDurableStore({ runId })
    const renderer = recordingProjection("slice-b-renderer", runId, store)
    const ledger = await createSliceLedger({
      runId,
      provenance: RUNTIME_PROVENANCE,
      durableStore: store,
      projections: [renderer.projection],
      secretHints: [...HINTS],
    })
    let counter = 0
    const nextKey = (label: string) => {
      counter += 1
      return `${runId}-${String(counter).padStart(2, "0")}-${label}`
    }
    const notify = async (label: string, input: unknown) => {
      const observationKey = nextKey(label)
      await ledger.ingestNotification({
        observationKey,
        transportId: "t1",
        receivedAt: "2026-09-04T00:00:00.000Z",
        ...(input as object),
      })
      return observationKey
    }
    return {
      store,
      ledger,
      renderer,
      notify,
      async start() {
        await notify("turn-started", { message: split.seal.turnStarted })
      },
      async seal() {
        const turnKey = await notify("turn-completed", {
          message: split.seal.turnCompleted,
        })
        const evidence = structuredClone(split.seal.evidence)
        evidence.trigger.observationKey = turnKey
        return await ledger.settle(evidence)
      },
    }
  }

  function channelMaterialized(records: any[], channel: any): string {
    return records
      .filter((record) => record.type === channel.expectedType)
      .map(channelText)
      .join("")
  }

  async function projectRenderer(delivered: any[]) {
    const project = await loadRendererProjector()
    expect(typeof project).toBe("function")
    return delivered.map((record) => ({
      record,
      chunks: project(structuredClone(record)) as any[],
    }))
  }

  function remnantsIn(
    middle: string,
    hint: string,
    position: number,
  ): string[] {
    return [hint.slice(0, position), hint.slice(position)].filter(
      (part) => part.length >= 3 && middle.includes(part),
    )
  }

  function appliedRulesOf(records: any[]): string[] {
    return valuesByKey(records, "appliedRules").flatMap((value) =>
      Array.isArray(value) ? value.map(String) : [],
    )
  }

  // Enforces once run-event-ledger.ts exists: one Run-scoped redactor withholds
  // each potential hint prefix before persistence/fan-out, so no split point of
  // either hint in any channel leaks through durable records, renderer chunks,
  // diagnostics, the outcome or host output; safe text flows before the seal.
  test("S17 Runtime splits an exact secret across adjacent events — every split position of each exact hint across assistant, reasoning, command and tool fragments leaves durable records, renderer chunks, outcome and host output without the hint, keeps the safe text visible and records the applied rule", async () => {
    const { safeBefore, safeAfter, splitPositions } = split.splitCase
    const findings: unknown[] = []
    let cases = 0
    for (const channel of split.channels) {
      for (const hint of HINTS) {
        for (const position of splitPositions[hint] as number[]) {
          cases += 1
          const runId = `ss-${channel.channel}-${hint.slice(0, 3)}-p${String(position).padStart(2, "0")}`
          const host = captureHostOutput()
          cleanups.push(() => host.restore())
          const run = await splitRun(runId)
          await run.start()
          await run.notify(
            "f1",
            deltaNotification(
              channel,
              `${safeBefore}${hint.slice(0, position)}`,
            ),
          )
          await run.notify(
            "f2",
            deltaNotification(channel, `${hint.slice(position)}${safeAfter}`),
          )
          const beforeSeal = channelMaterialized(
            await run.ledger.read(0),
            channel,
          )
          const settled = await run.seal()
          await macrotaskTurns(1)
          const records = await run.ledger.read(0)
          const outcome = await run.ledger.readOutcome()
          const renderer = await projectRenderer(run.renderer.delivered)
          host.restore()

          const materialized = channelMaterialized(records, channel)
          const middle = materialized.slice(
            safeBefore.length,
            materialized.length - safeAfter.length,
          )
          const rendererChannelText = renderer
            .filter((entry) => entry.record.type === channel.expectedType)
            .flatMap((entry) => textLeaves(entry.chunks))
            .join("")
          const everything = [
            JSON.stringify(records),
            records
              .map((record: any) => textLeaves(record.payload).join(""))
              .join(""),
            JSON.stringify(run.store.records),
            JSON.stringify(renderer.map((entry) => entry.chunks)),
            renderer.flatMap((entry) => textLeaves(entry.chunks)).join(""),
            JSON.stringify(settled ?? null),
            JSON.stringify(outcome ?? null),
            host.text(),
          ].join("\n")
          const problems = {
            leakedHint: everything.includes(hint),
            remnants: remnantsIn(middle, hint, position),
            safeBeforeSeal:
              beforeSeal.startsWith(safeBefore) &&
              beforeSeal.endsWith(safeAfter),
            safeAfterSeal:
              materialized.startsWith(safeBefore) &&
              materialized.endsWith(safeAfter) &&
              !materialized.includes(hint),
            rendererSafe:
              !rendererChannelText.includes(hint) &&
              (!channel.rendererText ||
                (rendererChannelText.startsWith(safeBefore) &&
                  rendererChannelText.endsWith(safeAfter))),
            ruleRecorded: appliedRulesOf(records).includes(
              split.expected.appliedRule,
            ),
          }
          if (
            problems.leakedHint ||
            problems.remnants.length > 0 ||
            !problems.safeBeforeSeal ||
            !problems.safeAfterSeal ||
            !problems.rendererSafe ||
            !problems.ruleRecorded
          ) {
            findings.push({ runId, materialized, beforeSeal, ...problems })
          }
        }
      }
    }
    expect(cases).toBe(4 * (18 + 17))
    expect(findings).toEqual([])
  })

  // Enforces once run-event-ledger.ts exists: an incomplete hint prefix still
  // pending when the Run seals is never released by the terminal flush; the
  // ingress observation keeps a sanitized record flagged redactionPending, and
  // secret-bearing diagnostics are redacted with the applied rule recorded.
  test("S17 Runtime splits an exact secret across adjacent events — an incomplete terminal hint prefix in each channel is withheld through the seal (redactionPending ingress record, safe text kept) and never appears in records, renderer chunks, diagnostics, outcome or host output", async () => {
    const terminal = split.terminalPrefixCase
    const findings: unknown[] = []
    for (const fragment of terminal.fragments) {
      const channel = channelOf(fragment.channel)
      const runId = `ss-terminal-${fragment.channel}`
      const host = captureHostOutput()
      cleanups.push(() => host.restore())
      const run = await splitRun(runId)
      await run.start()
      const pendingKey = await run.notify(
        "tail",
        deltaNotification(channel, fragment.text),
      )
      const diagnosticKeys: string[] = []
      for (const diagnostic of terminal.diagnostics) {
        diagnosticKeys.push(
          await run.notify(`diag-${diagnostic.method}`, {
            message: { method: diagnostic.method, params: diagnostic.params },
          }),
        )
      }
      const settled = await run.seal()
      await macrotaskTurns(1)
      const records = await run.ledger.read(0)
      const outcome = await run.ledger.readOutcome()
      const renderer = await projectRenderer(run.renderer.delivered)
      host.restore()

      const everything = [
        JSON.stringify(records),
        records
          .map((record: any) => textLeaves(record.payload).join(""))
          .join(""),
        JSON.stringify(run.store.records),
        JSON.stringify(renderer.map((entry) => entry.chunks)),
        renderer.flatMap((entry) => textLeaves(entry.chunks)).join(""),
        JSON.stringify(settled ?? null),
        JSON.stringify(outcome ?? null),
        host.text(),
      ].join("\n")
      const materialized = channelMaterialized(records, channel)
      const diagnosticRecords = diagnosticKeys.map((key) =>
        recordsForKey(records, key),
      )
      const observed = {
        channel: fragment.channel,
        leaked: [...HINTS, fragment.withheldPrefix].filter((value) =>
          everything.includes(value),
        ),
        safeVisible: materialized.startsWith(terminal.safeVisible),
        pendingFlagged: valuesByKey(
          recordsForKey(records, pendingKey),
          split.expected.redactionPendingField,
        ).includes(true),
        diagnosticsCommitted: diagnosticRecords.map(
          (entry, index) =>
            entry.some(
              (record: any) =>
                record.type === terminal.diagnostics[index].expectedType,
            ) && appliedRulesOf(entry).includes(split.expected.appliedRule),
        ),
        completed: records.filter((record: any) => record.type === "completed")
          .length,
      }
      const expected = {
        channel: fragment.channel,
        leaked: [],
        safeVisible: true,
        pendingFlagged: true,
        diagnosticsCommitted: terminal.diagnostics.map(() => true),
        completed: 1,
      }
      if (JSON.stringify(observed) !== JSON.stringify(expected)) {
        findings.push({ observed, materialized })
      }
    }
    expect(findings).toEqual([])
  })

  // Enforces once run-event-ledger.ts exists: a withheld potential prefix that
  // the next fragment proves safe is released before the seal, in order, by a
  // later record that references its source observation.
  test("S17 Runtime splits an exact secret across adjacent events — a withheld prefix that the next fragment proves safe is released before the seal by a later record referencing its source observation, so the channel text is exactly the safe text", async () => {
    const findings: unknown[] = []
    for (const channel of split.channels) {
      for (const variant of split.safeReleaseCase.variants) {
        const runId = `ss-release-${channel.channel}-${variant.variant}`
        const run = await splitRun(runId)
        await run.start()
        const firstKey = await run.notify(
          "r1",
          deltaNotification(channel, variant.fragments[0]),
        )
        const afterFirst = await run.ledger.read(0)
        const firstBatchMax = Math.max(
          0,
          ...sequencesOf(recordsForKey(afterFirst, firstKey)),
        )
        await run.notify("r2", deltaNotification(channel, variant.fragments[1]))
        const records = await run.ledger.read(0)
        const observed = {
          text: channelMaterialized(records, channel),
          pendingFlagged: valuesByKey(
            recordsForKey(afterFirst, firstKey),
            split.expected.redactionPendingField,
          ).includes(true),
          releaseReferencesSource: records.some(
            (record: any) =>
              Number(record.sequence) > firstBatchMax &&
              JSON.stringify(record).includes(firstKey),
          ),
        }
        const expected = {
          text: variant.expectedText,
          pendingFlagged: true,
          releaseReferencesSource: true,
        }
        if (JSON.stringify(observed) !== JSON.stringify(expected)) {
          findings.push({ runId, observed })
        }
      }
    }
    expect(findings).toEqual([])
  })

  // Enforces once run-event-ledger.ts exists: redaction state is per stream
  // channel inside the one Run-scoped redactor, so interleaved channels each
  // redact their own adjacent split without cross-channel contamination.
  test("S17 Runtime splits an exact secret across adjacent events — interleaved assistant and reasoning splits are redacted per channel and keep each channel's safe text", async () => {
    const interleaved = split.interleavedCase
    const run = await splitRun("ss-interleaved")
    await run.start()
    for (const step of interleaved.steps) {
      await run.notify(
        `il-${step.channel}`,
        deltaNotification(channelOf(step.channel), step.text),
      )
    }
    await run.seal()
    const records = await run.ledger.read(0)
    const observed = Object.fromEntries(
      Object.keys(interleaved.expected).map((name) => {
        const text = channelMaterialized(records, channelOf(name))
        return [
          name,
          {
            startsWith: text.startsWith(interleaved.expected[name].startsWith),
            endsWith: text.endsWith(interleaved.expected[name].endsWith),
            leaked: HINTS.filter((hint) => text.includes(hint)),
          },
        ]
      }),
    )
    expect(observed).toEqual(
      Object.fromEntries(
        Object.keys(interleaved.expected).map((name) => [
          name,
          { startsWith: true, endsWith: true, leaked: [] },
        ]),
      ),
    )
    expect(JSON.stringify(records)).not.toContain(HINTS[0])
    expect(JSON.stringify(records)).not.toContain(HINTS[1])
  })

  test("S17 Runtime splits an exact secret across adjacent events — the canonical stateful channel redactor (redaction.ts) never releases a withheld hint prefix at its terminal flush while still redacting adjacent splits and keeping safe text", () => {
    const redactor = createExactSecretStreamChannelRedactor<{
      channel: string
      text: string
    }>()
    const outputs = new Map<string, string>()
    const emit = (entry: { value: { channel: string; text: string } }) => {
      outputs.set(
        entry.value.channel,
        `${outputs.get(entry.value.channel) ?? ""}${entry.value.text}`,
      )
    }
    const push = (channel: string, text: string) =>
      emit(
        redactor.push(
          {
            channel,
            value: text,
            withValue: (value: string) => ({ channel, text: value }),
          },
          HINTS,
        ),
      )
    // One adjacent split per channel (proves the stateful path is exercised) ...
    const { safeBefore, safeAfter } = split.splitCase
    for (const [index, channel] of split.channels.entries()) {
      const hint = HINTS[index % HINTS.length]
      push(`split-${channel.channel}`, `${safeBefore}${hint.slice(0, 7)}`)
      push(`split-${channel.channel}`, `${hint.slice(7)}${safeAfter}`)
    }
    // ... and an incomplete hint prefix pending at the terminal boundary.
    for (const fragment of split.terminalPrefixCase.fragments) {
      push(`terminal-${fragment.channel}`, fragment.text)
    }
    for (const entry of redactor.flush(HINTS)) emit(entry)

    const findings = [...outputs.entries()].flatMap(([channel, text]) => {
      const fragment = split.terminalPrefixCase.fragments.find(
        (entry: any) => `terminal-${entry.channel}` === channel,
      )
      const withheld: string[] = fragment ? [fragment.withheldPrefix] : []
      const safe = fragment
        ? text.startsWith(split.terminalPrefixCase.safeVisible)
        : text.startsWith(safeBefore) && text.endsWith(safeAfter)
      const leaked = [...HINTS, ...withheld].filter((value) =>
        text.includes(value),
      )
      return leaked.length > 0 || !safe ? [{ channel, text, leaked, safe }] : []
    })
    expect(outputs.size).toBe(
      split.channels.length + split.terminalPrefixCase.fragments.length,
    )
    expect(findings).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// S32 — agent-runtime-core / Observable Native Methods And Boundary Facts
// ---------------------------------------------------------------------------
describe("agent-runtime-core / Observable Native Methods And Boundary Facts", () => {
  const interactions = loadJsonlFixture("interaction-boundaries.jsonl")
  const lines = interactions.lines
  const caseIds = [...new Set(lines.map((line) => line.caseId))]
  const OPPOSITE: Record<string, string> = { sent: "failed", failed: "sent" }
  const INTERACTION_STATE_TYPES = [
    "permission_requested",
    "question_pending",
    "question_result",
    "guard_decision",
    "scope_expansion_requested",
    "mcp_needs_auth",
    "completed",
  ]
  const FSM_OR_GRANT_KEYS = [
    "interactionId",
    "interaction",
    "interactionState",
    "interactionStatus",
    "granted",
    "grant",
    "executionGranted",
    "approved",
    "authorized",
    "decision",
  ]

  const exactIds = (value: unknown) => [
    ...new Set(valuesByKey(value, "requestId").map((id) => JSON.stringify(id))),
  ]

  function boundaryRecords(
    records: LedgerRecord[],
    line: (typeof lines)[number],
  ) {
    return records.filter(
      (record) =>
        factKeyMentions(record, line.observationKey) &&
        record.type === "status" &&
        record.payload?.subtype === line.expected.subtype &&
        record.payload?.boundary === line.expected.boundary,
    )
  }

  function sendResults(record: LedgerRecord): unknown[] {
    return [
      ...valuesByKey(record.payload, "result"),
      ...valuesByKey(record.payload, "sendResult"),
    ]
  }

  // Enforces once run-event-ledger.ts exists: each request, response-send and
  // resolved boundary of every schema-derived request method commits
  // status/interaction_boundary with its boundary, exact JSON-RPC request
  // identity and, for sends, the explicit sent/failed result.
  test("S32 Interaction boundary is recorded without a second state machine — each of the ten request methods commits request, response_send (explicit sent/failed) and resolved boundaries carrying the exact requestId and method", async () => {
    expect(caseIds.length).toBe(11)
    expect(
      new Set(
        lines
          .filter((line) => line.port === "ingestServerRequest")
          .map((line) => line.expected.method),
      ).size,
    ).toBe(10)
    expect(
      [
        ...new Set(
          lines.map((line) => line.expected.sendResult).filter(Boolean),
        ),
      ].sort(),
    ).toEqual(["failed", "sent"])
    const findings: unknown[] = []
    for (const caseId of caseIds) {
      const { ledger } = await createTestLedger({
        provenance: RUNTIME_PROVENANCE,
        runId: `run-slice-b-${caseId}`,
      })
      const caseLines = lines.filter((line) => line.caseId === caseId)
      for (const line of caseLines) await drive(ledger, line)
      const records = await readAll(ledger)
      for (const line of caseLines) {
        const hits = boundaryRecords(records, line)
        const expectedId = JSON.stringify(line.expected.requestId)
        const ok =
          hits.length === 1 &&
          exactIds(hits[0]).length === 1 &&
          exactIds(hits[0])[0] === expectedId &&
          (line.expected.method === undefined ||
            JSON.stringify(hits[0].payload).includes(
              String(line.expected.method),
            )) &&
          (line.expected.sendResult === undefined ||
            (sendResults(hits[0]).includes(line.expected.sendResult) &&
              !sendResults(hits[0]).includes(
                OPPOSITE[String(line.expected.sendResult)],
              )))
        if (!ok) {
          findings.push({
            caseId,
            observationKey: line.observationKey,
            boundary: line.expected.boundary,
            got: records
              .filter((record) => factKeyMentions(record, line.observationKey))
              .map((record) => ({
                type: record.type,
                payload: record.payload,
              })),
          })
        }
      }
    }
    expect(findings).toEqual([])
  })

  // Enforces once run-event-ledger.ts exists: interleaved boundaries of
  // different requests commit in ingress order as dense batches, and each
  // boundary record correlates only to its own requestId (no merging).
  test("S32 Interaction boundary is recorded without a second state machine — interleaved boundaries of eleven request identities commit densely in ingress order and each boundary record correlates to exactly its own requestId", async () => {
    const { ledger } = await createTestLedger({
      provenance: RUNTIME_PROVENANCE,
      runId: "run-slice-b-s32-interleaved",
    })
    for (const line of lines) await drive(ledger, line)
    const records = await readAll(ledger)
    expect(records.map((record) => record.sequence)).toEqual(
      records.map((_, index) => index + 1),
    )
    const owners = records.map((record) =>
      lines.findIndex((line) => factKeyMentions(record, line.observationKey)),
    )
    expect(owners.filter((owner) => owner < 0)).toEqual([])
    expect(owners).toEqual([...owners].sort((x, y) => x - y))
    const correlation = lines.map((line) => {
      const hits = boundaryRecords(records, line)
      return {
        observationKey: line.observationKey,
        boundaries: hits.length,
        requestIds: [...new Set(hits.flatMap((hit) => exactIds(hit)))],
      }
    })
    expect(correlation).toEqual(
      lines.map((line) => ({
        observationKey: line.observationKey,
        boundaries: 1,
        requestIds: [JSON.stringify(line.expected.requestId)],
      })),
    )
  })

  // Enforces once run-event-ledger.ts exists: boundaries are protocol facts,
  // not an Interaction state machine — resolved before send, resolved after a
  // failed send and resolved for a never-requested ID are all recorded, and no
  // payload claims a durable Interaction or grants execution.
  test("S32 Interaction boundary is recorded without a second state machine — out-of-order, failed-send and unknown-request boundaries are all recorded as facts, and no record claims a durable Interaction or grants execution", async () => {
    const { ledger } = await createTestLedger({
      provenance: RUNTIME_PROVENANCE,
      runId: "run-slice-b-s32-no-fsm",
    })
    const settled: Array<{ observationKey: string; fulfilled: boolean }> = []
    for (const line of lines) {
      const result = await settledResult(() => drive(ledger, line))
      settled.push({
        observationKey: line.observationKey,
        fulfilled: result.fulfilled,
      })
    }
    const records = await readAll(ledger)
    const lineOf = (predicate: (line: (typeof lines)[number]) => boolean) => {
      const found = lines.find(predicate)
      if (!found)
        throw new Error("interaction-boundaries.jsonl lacks a variant")
      return found
    }
    const resolvedBeforeSend = lineOf(
      (line) =>
        line.expected.boundary === "resolved" &&
        lines.findIndex(
          (other) =>
            other.caseId === line.caseId &&
            other.expected.boundary === "response_send",
        ) > lines.indexOf(line),
    )
    const failedCase = lineOf((line) => line.expected.sendResult === "failed")
    const resolvedAfterFailed = lineOf(
      (line) =>
        line.caseId === failedCase.caseId &&
        line.expected.boundary === "resolved",
    )
    const unknownRequest = lineOf(
      (line) =>
        line.expected.boundary === "resolved" &&
        !lines.some(
          (other) =>
            other.caseId === line.caseId &&
            other.expected.boundary === "request",
        ),
    )
    expect(settled.filter((entry) => !entry.fulfilled)).toEqual([])
    expect(
      [resolvedBeforeSend, resolvedAfterFailed, unknownRequest].map(
        (line) => boundaryRecords(records, line).length,
      ),
    ).toEqual([1, 1, 1])
    expect(
      records
        .filter((record) => INTERACTION_STATE_TYPES.includes(record.type))
        .map((record) => record.type),
    ).toEqual([])
    expect(
      FSM_OR_GRANT_KEYS.flatMap((key) =>
        valuesByKey(
          records.map((record) => record.payload),
          key,
        ).map((value) => ({ key, value })),
      ),
    ).toEqual([])
  })
})
