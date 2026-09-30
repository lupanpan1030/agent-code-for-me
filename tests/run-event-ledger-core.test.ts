/**
 * Red acceptance tests — refactor-canonical-run-event-ledger, Domain A part 1:
 * ledger ingest/ordering owner, two-layer native identity, observable unknown
 * native methods, the 66/10/16 native disposition table and the nine internal
 * types coerced to v1 status.
 *
 * Written test-first by an independent author from:
 *   openspec/changes/refactor-canonical-run-event-ledger/{design,tasks}.md and
 *   specs/{agent-runtime-core,codex-runtime-parity,local-job-api}/spec.md.
 * Fixtures: tests/fixtures/run-event-ledger/ (tasks §7 shapes; all synthetic).
 *
 * Entry points (named by design "Test-facing Contract" / owner mapping):
 *   - createCanonicalRunEventLedger from NEW src/main/lib/agent-runtime/run-event-ledger.ts
 *     (ingestResponse / ingestNotification / ingestServerRequest /
 *      recordServerResponseSend / recordServerRequestResolved / settle / read / readOutcome)
 *   - decodeCodexNativeBoundary from src/main/lib/codex/app-server-stream-events.ts
 *   - toLocalJobApiEventEnvelope from src/main/lib/headless/local-job-api.ts (v1 serializer)
 *   - getAgentRuntimeCapabilityManifest from src/shared/agent-runtime-capabilities.ts (guard)
 *
 * Before implementation the ledger/decoder tests fail with "Cannot find module"
 * or "not a function"; the S50 test fails on a real behavior gap (no subtype).
 */
import { describe, expect, mock, test } from "bun:test"
import { toLocalJobApiEventEnvelope } from "../src/main/lib/headless/local-job-api"
import { getAgentRuntimeCapabilityManifest } from "../src/shared/agent-runtime-capabilities"
import {
  codexExtensionOf,
  createTestLedger,
  drive,
  factKeyMentions,
  factKeyOrdinal,
  isSubset,
  type LedgerRecord,
  loadJsonFixture,
  loadJsonlFixture,
  range,
  readAll,
  recordsFor,
  subtypeOf,
  typeLabel,
  valuesByKey,
} from "./run-event-ledger-test-harness"

mock.module("electron", () => ({
  app: { getPath: () => "/tmp", isPackaged: false, getAppPath: () => "/tmp" },
  BrowserWindow: class BrowserWindow {},
}))

type ProvenanceFixture = {
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
    expected: Record<string, unknown>
  }>
}

const identity = loadJsonFixture<ProvenanceFixture>("identity-provenance.json")
const RUNTIME_PROVENANCE = identity.provenanceVariants.runtime
const SECRET_HINTS = identity.secretHints

function identityCase(caseId: string) {
  const found = identity.cases.find((entry) => entry.caseId === caseId)
  if (!found?.steps)
    throw new Error(`identity-provenance.json case ${caseId} missing`)
  return found as Required<(typeof identity.cases)[number]>
}

// ---------------------------------------------------------------------------
// agent-runtime-core / Canonical Run Event Ledger Ownership
// ---------------------------------------------------------------------------
describe("agent-runtime-core / Canonical Run Event Ledger Ownership", () => {
  const ingress = loadJsonlFixture("ingress-boundaries.jsonl")
  const boundaryKeys = ingress.lines.map((line) => line.observationKey)

  test("S10 All protocol boundaries enter one ledger — five ports commit one dense batch-ordered fact chain keyed by (observationKey, ordinal)", async () => {
    const { ledger, inspect } = await createTestLedger({
      provenance: RUNTIME_PROVENANCE,
    })
    const ports = ingress.lines.map((line) => line.port)
    expect(ports).toEqual([
      "ingestResponse",
      "ingestNotification",
      "ingestServerRequest",
      "recordServerResponseSend",
      "recordServerRequestResolved",
    ])
    for (const line of ingress.lines) await drive(ledger, line)

    const records = await readAll(ledger)
    // Dense canonical sequence from 1, assigned at ingest by the single owner.
    expect(records.map((record) => record.sequence)).toEqual(
      range(1, records.length),
    )
    // The store never re-sequences: what was committed is exactly what read(0) returns.
    expect(inspect.rows().map((row) => row.sequence)).toEqual(
      records.map((r) => r.sequence),
    )

    // Every committed record belongs to exactly one boundary observation.
    const owners = records.map((record) =>
      boundaryKeys.filter((key) => factKeyMentions(record, key)),
    )
    expect(owners.map((owner) => owner.length)).toEqual(records.map(() => 1))
    // One or more records per boundary, in the submitted batch order.
    const ownerIndex = owners.map((owner) => boundaryKeys.indexOf(owner[0]))
    expect(ownerIndex).toEqual([...ownerIndex].sort((a, b) => a - b))
    expect([...new Set(owners.map((owner) => owner[0]))]).toEqual(boundaryKeys)
    // Ordinals within each observation batch are 0..n-1 in sequence order.
    const ordinalsPerKey = boundaryKeys.map((key) =>
      recordsFor(records, key).map((record) => factKeyOrdinal(record)),
    )
    expect(ordinalsPerKey).toEqual(
      boundaryKeys.map((key) => range(0, recordsFor(records, key).length - 1)),
    )
    // Each boundary produced its fixture-declared observable status subtype.
    const subtypes = ingress.lines.map((line) =>
      recordsFor(records, line.observationKey).map((record) =>
        subtypeOf(record),
      ),
    )
    expect(
      ingress.lines.map((line, index) =>
        subtypes[index].includes(line.expected.subtype),
      ),
    ).toEqual(ingress.lines.map(() => true))
    const boundaries = ingress.lines
      .filter((line) => line.expected.boundary !== undefined)
      .map((line) =>
        recordsFor(records, line.observationKey).some(
          (record) => record.payload?.boundary === line.expected.boundary,
        ),
      )
    expect(boundaries).toEqual([true, true, true])
  })

  test("S10 All protocol boundaries enter one ledger — resubmitting an observationKey returns the prior batch without a new sequence", async () => {
    const { ledger, inspect } = await createTestLedger({
      provenance: RUNTIME_PROVENANCE,
    })
    for (const line of ingress.lines) await drive(ledger, line)
    const before = await readAll(ledger)
    const firstBatch = recordsFor(before, ingress.lines[0].observationKey)
    expect(firstBatch.length).toBeGreaterThan(0)

    const retried = (await drive(ledger, ingress.lines[0])) as LedgerRecord[]
    expect(Array.isArray(retried)).toBe(true)
    expect(retried.map((record) => record.sequence)).toEqual(
      firstBatch.map((record) => record.sequence),
    )
    // Retrying a mid-stream boundary (the send) is idempotent as well.
    await drive(ledger, ingress.lines[3])
    const after = await readAll(ledger)
    expect(after).toEqual(before)
    expect(inspect.rows().length).toBe(before.length)

    // The next genuinely new observation continues the dense sequence.
    await drive(ledger, {
      port: "ingestNotification",
      observationKey: "ib-obs-next",
      transportId: "t1",
      input: {
        message: {
          method: "thread/status/changed",
          params: { threadId: "th", status: { type: "idle" } },
        },
      },
    })
    const next = recordsFor(await readAll(ledger), "ib-obs-next")
    expect(next.map((record) => record.sequence)).toEqual(
      range(before.length + 1, before.length + next.length),
    )
    expect(next.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// agent-runtime-core / Native Identity And Runtime Provenance
// ---------------------------------------------------------------------------
describe("agent-runtime-core / Native Identity And Runtime Provenance", () => {
  test('S14 Distinct native identities are preserved — thread/session/turn/item/request/call land redacted in payload.extensions["runtime.codex.v1"] without substitution', async () => {
    const fixture = identityCase("distinct-native-ids")
    const { ledger } = await createTestLedger({
      provenance: RUNTIME_PROVENANCE,
      secretHints: SECRET_HINTS,
    })
    for (const step of fixture.steps) await drive(ledger, step)
    const records = await readAll(ledger)
    const expected = fixture.expected as {
      responseObservationKey: string
      itemObservationKey: string
      requestObservationKey: string
      exactTurnId: string
      extension: Record<string, unknown>
    }

    const serialized = JSON.stringify(records)
    expect(
      SECRET_HINTS.filter((secret) => serialized.includes(secret)),
    ).toEqual([])

    const extensionFor = (observationKey: string) => {
      const found = recordsFor(records, observationKey)
        .map(codexExtensionOf)
        .filter((extension) => extension !== undefined)
      expect(found.length).toBeGreaterThan(0)
      return found[0] as Record<string, unknown>
    }
    const response = extensionFor(expected.responseObservationKey)
    const item = extensionFor(expected.itemObservationKey)
    const request = extensionFor(expected.requestObservationKey)

    expect(response).toMatchObject(expected.extension)
    expect(typeof response.threadId).toBe("string")
    expect(typeof response.sessionId).toBe("string")
    expect(String(response.threadId).length).toBeGreaterThan(0)
    expect(String(response.sessionId).length).toBeGreaterThan(0)
    // Thread and session are distinct identities, never folded into one field.
    expect(response.sessionId).not.toBe(response.threadId)

    expect(item).toMatchObject({
      threadId: response.threadId,
      turnId: expected.exactTurnId,
    })
    expect(typeof item.itemId).toBe("string")
    expect(String(item.itemId).length).toBeGreaterThan(0)

    expect(String(request.requestId)).toBe("41")
    expect(typeof request.callId).toBe("string")
    expect(String(request.callId).length).toBeGreaterThan(0)

    // Wherever a sessionId is carried, it is the observed session, never the thread.
    const carriedSessions = records
      .map(codexExtensionOf)
      .filter(
        (extension): extension is Record<string, unknown> =>
          extension !== undefined && Object.hasOwn(extension, "sessionId"),
      )
      .map((extension) => extension.sessionId)
    expect([...new Set(carriedSessions)]).toEqual([response.sessionId])
  })

  test("S14 Distinct native identities are preserved — unavailable sessionId is omitted, never filled from threadId", async () => {
    const fixture = identityCase("no-session-observed")
    const { ledger } = await createTestLedger({
      provenance: RUNTIME_PROVENANCE,
    })
    for (const step of fixture.steps) await drive(ledger, step)
    const extensions = (await readAll(ledger))
      .map(codexExtensionOf)
      .filter(
        (extension): extension is Record<string, unknown> =>
          extension !== undefined,
      )
    expect(extensions.length).toBeGreaterThan(0)
    expect(extensions.map((extension) => extension.threadId)).toContain(
      fixture.expected.threadId,
    )
    expect(
      extensions.filter((extension) => Object.hasOwn(extension, "sessionId")),
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// agent-runtime-core / Observable Native Methods And Boundary Facts
// ---------------------------------------------------------------------------
describe("agent-runtime-core / Observable Native Methods And Boundary Facts", () => {
  const unknownFixture = loadJsonFixture<{
    secretHints: string[]
    cases: Array<{
      caseId: string
      port: string
      observationKey: string
      transportId: string
      input: Record<string, unknown>
      expected: Record<string, unknown>
    }>
  }>("unknown-method.json")

  test("S31 Unknown native method is observed — future method becomes sanitized status/unknown_native_method with lossPossible, never a silent []", async () => {
    const entry = unknownFixture.cases.find((c) => c.caseId === "future-method")
    if (!entry)
      throw new Error("unknown-method.json future-method case missing")
    const { ledger } = await createTestLedger({
      provenance: RUNTIME_PROVENANCE,
      secretHints: unknownFixture.secretHints,
    })
    await drive(ledger, entry)
    const records = await readAll(ledger)
    expect(records.length).toBeGreaterThan(0)
    const unknown = records.filter(
      (record) => subtypeOf(record) === entry.expected.subtype,
    )
    expect(unknown.length).toBe(1)
    expect(unknown[0].type).toBe(entry.expected.type)
    expect(unknown[0].payload?.lossPossible).toBe(true)
    // Sanitized method identity is retained.
    expect(JSON.stringify(unknown[0].payload)).toContain(
      String(entry.expected.method),
    )
    const serialized = JSON.stringify(records)
    expect(
      unknownFixture.secretHints.filter((secret) =>
        serialized.includes(secret),
      ),
    ).toEqual([])
  })

  test("S31 Unknown native method is observed — a known method with malformed fields becomes warning/invalid_native_shape with lossPossible instead of disappearing", async () => {
    const entry = unknownFixture.cases.find(
      (c) => c.caseId === "malformed-known",
    )
    if (!entry)
      throw new Error("unknown-method.json malformed-known case missing")
    const { ledger } = await createTestLedger({
      provenance: RUNTIME_PROVENANCE,
    })
    await drive(ledger, entry)
    const records = await readAll(ledger)
    const warnings = records.filter(
      (record) =>
        record.type === entry.expected.type &&
        subtypeOf(record) === entry.expected.subtype,
    )
    expect(warnings.length).toBe(1)
    expect(warnings[0].payload).toMatchObject({
      reason: entry.expected.reason,
      lossPossible: true,
    })
    expect(
      records.filter((record) => record.type === "assistant_delta"),
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// codex-runtime-parity / Codex Native Boundary Forwarding And Disposition
// ---------------------------------------------------------------------------
type Disposition = {
  method?: string
  itemVariant?: string
  port?: string
  input: Record<string, unknown>
  expectedType: string
  expectedSubtype?: string
  expectedFields?: Record<string, unknown>
  expectedCompletedType?: string
  expectedCompletedSubtype?: string
  forbiddenSubstrings?: string[]
  forbiddenTypes?: string[]
  terminalCandidate?: boolean
  requestId?: number
}

describe("codex-runtime-parity / Codex Native Boundary Forwarding And Disposition", () => {
  const dispositions = loadJsonFixture<{
    secretHints: string[]
    counts: { notifications: number; requests: number; items: number }
    notifications: Disposition[]
    requests: Disposition[]
    items: Disposition[]
  }>("native-dispositions.json")

  const matchesDisposition = (
    record: LedgerRecord,
    type: string,
    subtype: string | undefined,
  ) =>
    record.type === type &&
    (subtype === undefined || subtypeOf(record) === subtype)

  test("S42 Pinned native surface has complete disposition — fixture enumerates exactly the trace's 66 notifications, 10 requests and 16 item variants", () => {
    expect(dispositions.counts).toEqual({
      notifications: 66,
      requests: 10,
      items: 16,
    })
    expect(new Set(dispositions.notifications.map((d) => d.method)).size).toBe(
      66,
    )
    expect(new Set(dispositions.requests.map((d) => d.method)).size).toBe(10)
    expect(new Set(dispositions.items.map((d) => d.itemVariant)).size).toBe(16)
  })

  test("S42 Pinned native surface has complete disposition — every non-terminal notification commits its table domain event or status subtype; deferred surfaces stay observed_deferred and capability manifest is unchanged", async () => {
    const manifestBefore = JSON.stringify(
      getAgentRuntimeCapabilityManifest("codex"),
    )
    const problems: unknown[] = []
    const cases = dispositions.notifications.filter(
      (entry) => !entry.terminalCandidate,
    )
    expect(cases.length).toBe(65)
    for (const [index, entry] of cases.entries()) {
      const { ledger } = await createTestLedger({
        provenance: RUNTIME_PROVENANCE,
        secretHints: dispositions.secretHints,
      })
      await drive(ledger, {
        port: entry.port ?? "ingestNotification",
        observationKey: `disp-n-${String(index + 1).padStart(2, "0")}`,
        transportId: "t1",
        input: entry.input,
      })
      const records = await readAll(ledger)
      const hit = records.find((record) =>
        matchesDisposition(record, entry.expectedType, entry.expectedSubtype),
      )
      const serialized = JSON.stringify(records)
      const leaked = [
        ...(entry.forbiddenSubstrings ?? []),
        ...dispositions.secretHints,
      ].filter((value) => serialized.includes(value))
      const falseUnknown = records.some(
        (record) => subtypeOf(record) === "unknown_native_method",
      )
      const fieldsOk =
        hit !== undefined && isSubset(hit.payload, entry.expectedFields ?? {})
      const falseTerminal = records.some(
        (record) => record.type === "completed",
      )
      const directArtifact = records.some(
        (record) => record.type === "artifact_created",
      )
      if (
        !hit ||
        !fieldsOk ||
        leaked.length > 0 ||
        falseUnknown ||
        falseTerminal ||
        directArtifact
      ) {
        problems.push({
          method: entry.method,
          expected: `${entry.expectedType}/${entry.expectedSubtype ?? ""}`,
          got: records.map(typeLabel),
          fieldsOk,
          leaked,
          falseUnknown,
          falseTerminal,
          directArtifact,
        })
      }
    }
    expect(problems).toEqual([])
    expect(JSON.stringify(getAgentRuntimeCapabilityManifest("codex"))).toBe(
      manifestBefore,
    )
  })

  test("S42 Pinned native surface has complete disposition — turn/completed is only a terminal candidate settled by the core outcome rule", async () => {
    const entry = dispositions.notifications.find(
      (d) => d.method === "turn/completed",
    )
    if (!entry) throw new Error("native-dispositions.json lacks turn/completed")
    const { ledger } = await createTestLedger({
      provenance: RUNTIME_PROVENANCE,
    })
    await drive(ledger, {
      port: "ingestNotification",
      observationKey: "disp-turn-completed",
      transportId: "t1",
      input: entry.input,
    })
    expect(
      (await readAll(ledger)).filter((record) => record.type === "completed"),
    ).toEqual([])
    expect(await ledger.readOutcome()).toBeNull()
    await drive(ledger, {
      port: "settle",
      observationKey: "disp-turn-completed-settle",
      input: {
        trigger: {
          kind: "native_terminal",
          status: "succeeded",
          observationKey: "disp-turn-completed",
          origin: "live",
        },
        policy: { denied: false, evidenceKeys: [] },
        output: {
          valid: true,
          empty: false,
          allowEmpty: false,
          evidenceKeys: ["output:validated"],
        },
        postRun: {
          credentialsSafe: true,
          evidenceKeys: ["postrun:credentials-safe"],
        },
      },
    })
    const completed = (await readAll(ledger)).filter(
      (record) => record.type === entry.expectedType,
    )
    expect(completed.length).toBe(1)
    expect(completed[0].payload?.status).toBe("succeeded")
  })

  test("S42 Pinned native surface has complete disposition — all 10 server requests commit status/interaction_boundary(request) with native method and requestId, no credential material", async () => {
    const problems: unknown[] = []
    for (const [index, entry] of dispositions.requests.entries()) {
      const { ledger } = await createTestLedger({
        provenance: RUNTIME_PROVENANCE,
        secretHints: dispositions.secretHints,
      })
      await drive(ledger, {
        port: "ingestServerRequest",
        observationKey: `disp-r-${String(index + 1).padStart(2, "0")}`,
        transportId: "t1",
        input: entry.input,
      })
      const records = await readAll(ledger)
      const hit = records.find((record) =>
        matchesDisposition(record, entry.expectedType, entry.expectedSubtype),
      )
      const serialized = JSON.stringify(records)
      const requestIds = hit ? valuesByKey(hit, "requestId").map(String) : []
      const ok =
        hit !== undefined &&
        isSubset(hit.payload, entry.expectedFields ?? {}) &&
        JSON.stringify(hit.payload).includes(String(entry.method)) &&
        requestIds.includes(String(entry.requestId)) &&
        dispositions.secretHints.every(
          (secret) => !serialized.includes(secret),
        ) &&
        !records.some((record) => subtypeOf(record) === "unknown_native_method")
      if (!ok)
        problems.push({
          method: entry.method,
          got: records.map(typeLabel),
          requestIds,
        })
    }
    expect(problems).toEqual([])
  })

  test("S42 Pinned native surface has complete disposition — all 16 ThreadItem variants map started/completed through the item table (six non-tool variants explicit, userMessage never assistant output)", async () => {
    const problems: unknown[] = []
    for (const [index, entry] of dispositions.items.entries()) {
      const { ledger } = await createTestLedger({
        provenance: RUNTIME_PROVENANCE,
        secretHints: dispositions.secretHints,
      })
      const input = entry.input as {
        started: Record<string, unknown>
        completed: Record<string, unknown>
      }
      const startedKey = `disp-i-${String(index + 1).padStart(2, "0")}-s`
      const completedKey = `disp-i-${String(index + 1).padStart(2, "0")}-c`
      await drive(ledger, {
        port: "ingestNotification",
        observationKey: startedKey,
        transportId: "t1",
        input: input.started,
      })
      await drive(ledger, {
        port: "ingestNotification",
        observationKey: completedKey,
        transportId: "t1",
        input: input.completed,
      })
      const records = await readAll(ledger)
      const startedOk = recordsFor(records, startedKey).some((record) =>
        matchesDisposition(record, entry.expectedType, entry.expectedSubtype),
      )
      const completedOk = recordsFor(records, completedKey).some((record) =>
        matchesDisposition(
          record,
          String(entry.expectedCompletedType),
          entry.expectedCompletedSubtype,
        ),
      )
      const forbidden = records.filter((record) =>
        (entry.forbiddenTypes ?? []).includes(record.type),
      )
      const falseUnknown = records.some(
        (record) => subtypeOf(record) === "unknown_native_method",
      )
      if (!startedOk || !completedOk || forbidden.length > 0 || falseUnknown) {
        problems.push({
          itemVariant: entry.itemVariant,
          started: recordsFor(records, startedKey).map(typeLabel),
          completed: recordsFor(records, completedKey).map(typeLabel),
          forbidden: forbidden.map(typeLabel),
          falseUnknown,
        })
      }
    }
    expect(problems).toEqual([])
  })

  test("S42 Pinned native surface has complete disposition — decodeCodexNativeBoundary is exported, stateless and never returns an empty default for a known method", async () => {
    const decoderModule = (await import(
      "../src/main/lib/codex/app-server-stream-events"
    )) as Record<string, unknown>
    const decode = decoderModule.decodeCodexNativeBoundary
    expect(typeof decode).toBe("function")
    const decodeFn = decode as (boundary: Record<string, unknown>) => unknown
    const problems: unknown[] = []
    const known = [...dispositions.notifications, ...dispositions.requests]
    for (const [index, entry] of known.entries()) {
      const boundary = {
        observationKey: `dec-${index}`,
        transportId: "t1",
        receivedAt: "2026-09-04T00:00:00.000Z",
        ...(entry.input as Record<string, unknown>),
      }
      const first = decodeFn(structuredClone(boundary))
      const second = decodeFn(structuredClone(boundary))
      const empty =
        first === null ||
        first === undefined ||
        (Array.isArray(first) && first.length === 0)
      const stateful = JSON.stringify(first) !== JSON.stringify(second)
      const ownsSequence = valuesByKey(first, "sequence").length > 0
      if (empty || stateful || ownsSequence) {
        problems.push({ method: entry.method, empty, stateful, ownsSequence })
      }
    }
    expect(problems).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// local-job-api / Stable API Event Stream (nine coerced internal types only)
// ---------------------------------------------------------------------------
describe("local-job-api / Stable API Event Stream", () => {
  const vocabulary = loadJsonFixture<{
    records: Array<{
      id: string
      jobId: string
      sequence: number
      type: string
      payloadJson: string
      createdAt: string
    }>
    expected: { publicTypes: string[]; coercedToStatus: string[] }
  }>("public-vocabulary.json")

  test("S50 All internal event types preserve dense v1 projection — the nine coerced internal types become status with subtype equal to their internal name, payload members preserved, sequences dense", () => {
    const envelopes = vocabulary.records.map((record) =>
      toLocalJobApiEventEnvelope({
        ...record,
        createdAt: new Date(record.createdAt),
      } as unknown as Parameters<typeof toLocalJobApiEventEnvelope>[0]),
    )
    expect(envelopes.map((envelope) => envelope.sequence)).toEqual(
      vocabulary.records.map((record) => record.sequence),
    )
    expect(envelopes.map((envelope) => envelope.sequence)).toEqual(range(1, 21))
    expect(
      envelopes.filter(
        (envelope) => !vocabulary.expected.publicTypes.includes(envelope.type),
      ),
    ).toEqual([])

    const coerced = vocabulary.records
      .map((record, index) => ({ record, envelope: envelopes[index] }))
      .filter(({ record }) =>
        vocabulary.expected.coercedToStatus.includes(record.type),
      )
    expect(coerced.map(({ record }) => record.type)).toEqual(
      vocabulary.expected.coercedToStatus,
    )
    expect(
      coerced.map(({ envelope }) => ({
        type: envelope.type,
        subtype: (envelope.payload as Record<string, unknown>).subtype,
      })),
    ).toEqual(
      coerced.map(({ record }) => ({ type: "status", subtype: record.type })),
    )
    // Old payload members stay in place; no double wrap.
    for (const { record, envelope } of coerced) {
      expect(envelope.payload).toMatchObject(JSON.parse(record.payloadJson))
      expect(
        (envelope.payload as Record<string, unknown>).payload,
      ).toBeUndefined()
    }
  })
})
