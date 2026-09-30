/**
 * Follow-up red slice A for `openspec/changes/refactor-canonical-run-event-ledger`:
 * ingress vocabulary, normalized output, CLI/protocol serializers and the
 * stateless Codex decoder.
 *
 * Scenarios: S01, S02, S03, S05, S07 (protocol half only; the CLI and v1 halves
 * are projection.test.ts S47/S50) of agent-runtime-core "Normalized Agent
 * Events", and S43 of codex-runtime-parity "Codex Native Boundary Forwarding
 * And Disposition".
 *
 * Entry points (design "Test-facing Contract" / "Current Owner to Target
 * Mapping"; never invented):
 * - `createCanonicalRunEventLedger` (NEW agent-runtime/run-event-ledger.ts)
 *   ports `appendSystemEvent`, `ingestRuntimeObservation`, `ingestNotification`,
 *   `settle`, `read`, `readOutcome`, over the Domain A in-memory durableStore.
 * - `admitRunArtifactCandidate` (NEW agent-runtime/run-artifacts.ts).
 * - `decodeCodexNativeBoundary` (codex/app-server-stream-events.ts).
 * - Existing serializers/readers: `runHeadlessCliCommand` `jobs logs --output
 *   stream-json` (headless/cli-dispatcher.ts), `serializeAgentJobEvent`
 *   (headless/cli-output.ts; the envelope tRPC `agentJobs.logs` and jobs-stdio
 *   `job/event` return), `runJobsStdioServer` (headless/jobs-stdio.ts,
 *   locus-jobs-stdio.v1) and the Workbench decoder `getWorkbenchTraceRow`.
 *
 * New modules are loaded lazily inside each test so a missing owner fails only
 * that test. Tests labelled "(green-by-design)" characterize behavior the
 * change keeps; every other test is expected RED on the base.
 *
 * Fixtures: tests/fixtures/run-event-ledger/{vocabulary,normalized-output,
 * projection,codex-decode}.json (+ identity-provenance.json runtime variant).
 */
import { afterEach, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { Readable } from "node:stream"
import * as schema from "../src/main/lib/db/schema"
import type {
  AgentRuntimeObserver,
  AgentRuntimeRunResult,
} from "../src/main/lib/headless/agent-runtime-contract"
import { HEADLESS_CLI_MARKER } from "../src/main/lib/headless/cli-args"
import { runHeadlessCliCommand } from "../src/main/lib/headless/cli-dispatcher"
import { serializeAgentJobEvent } from "../src/main/lib/headless/cli-output"
import { runJobsStdioServer } from "../src/main/lib/headless/jobs-stdio"
import { getWorkbenchTraceRow } from "../src/renderer/features/agents/workbench/workbench-trace-presenter"
import {
  createMigratedLedgerDb,
  loadRunArtifactsModule,
  type MigratedLedgerDb,
  settledResult,
} from "./run-event-ledger-domain-b-kit"
import {
  captureWriter,
  cleanupTempDirs,
  createSliceALedger,
  descriptorsOf,
  forbiddenPayloadKeyHits,
  isPlainObject,
  parseJsonLines,
  replaceToken,
  tempDir,
  toJobEventRow,
} from "./run-event-ledger-slice-a-kit"
import {
  drive,
  factKeyMentions,
  isSubset,
  type LedgerRecord,
  loadJsonFixture,
  range,
  readAll,
  recordsFor,
  valuesByKey,
} from "./run-event-ledger-test-harness"

// biome-ignore lint/suspicious/noExplicitAny: fixture JSON is validated by the harness header check only
type Json = any

const identity = loadJsonFixture<{
  provenanceVariants: Record<string, Record<string, unknown>>
}>("identity-provenance.json")
const RUNTIME_PROVENANCE = identity.provenanceVariants.runtime

const vocabulary = loadJsonFixture<Json>("vocabulary.json")
const normalized = loadJsonFixture<Json>("normalized-output.json")
const projection = loadJsonFixture<Json>("projection.json")
const codexDecode = loadJsonFixture<Json>("codex-decode.json")

function projectionCase(caseId: string): Json {
  const found = projection.cases.find((entry: Json) => entry.caseId === caseId)
  if (!found) throw new Error(`projection.json lacks ${caseId}`)
  return found
}

function decodeCase(caseId: string): Json {
  const found = codexDecode.cases.find((entry: Json) => entry.caseId === caseId)
  if (!found) throw new Error(`codex-decode.json lacks ${caseId}`)
  return found
}

const dbs: MigratedLedgerDb[] = []
function trackDb(db: MigratedLedgerDb): MigratedLedgerDb {
  dbs.push(db)
  return db
}

afterEach(() => {
  while (dbs.length > 0) dbs.pop()?.close()
  cleanupTempDirs()
})

async function runCli(
  db: unknown,
  argv: string[],
  options: { now?: Date } = {},
) {
  const stdout = captureWriter()
  const stderr = captureWriter()
  const code = await runHeadlessCliCommand({
    db: db as never,
    argv: ["Locus", HEADLESS_CLI_MARKER, ...argv],
    stdout: stdout.writer,
    stderr: stderr.writer,
    env: {},
    appVersion: "0.0.test",
    ...(options.now ? { now: options.now } : {}),
  })
  return { code, stdout: stdout.value(), stderr: stderr.value() }
}

function fixtureRunner(events: Json[], result: Json) {
  return async (
    _request: unknown,
    observer: AgentRuntimeObserver,
  ): Promise<AgentRuntimeRunResult> => {
    for (const event of events) {
      observer.appendEvent(event.type, structuredClone(event.payload))
    }
    return structuredClone(result) as AgentRuntimeRunResult
  }
}

/** Protocol envelope (tRPC agentJobs.logs / jobs-stdio job/event) + Workbench decode of one committed record. */
function protocolViews(record: LedgerRecord) {
  const envelope = serializeAgentJobEvent(toJobEventRow(record) as never)
  const row = getWorkbenchTraceRow(envelope)
  return { envelope, row }
}

// ---------------------------------------------------------------------------
// agent-runtime-core / Normalized Agent Events
// ---------------------------------------------------------------------------
describe("agent-runtime-core / Normalized Agent Events", () => {
  const RUN_ID: string = vocabulary.runId
  const RUNTIME_ID: string = vocabulary.runtimeId
  const settleCase = vocabulary.cases.find(
    (entry: Json) => entry.port === "settle",
  )

  // Enforces once run-event-ledger.ts and run-artifacts.ts exist: each
  // vocabulary case commits under its own internal type through its owner port
  // (no internal coercion to status, artifact only via admission, completed
  // only via settle), with dense sequences and hint-free payloads.
  test("S01 Event type is emitted — vocabulary.json driven through appendSystemEvent/ingestRuntimeObservation, admitRunArtifactCandidate and settle commits exactly the 21 internal types, each record with a dense sequence, run/runtime identity and a sanitized payload attributable to its case", async () => {
    const artifacts = await loadRunArtifactsModule()
    const { ledger, inspect } = await createSliceALedger({
      runId: RUN_ID,
      runtimeId: RUNTIME_ID,
      source: vocabulary.source,
      provenance: RUNTIME_PROVENANCE,
      secretHints: vocabulary.secretHints,
      artifactOwner: artifacts,
    })
    const allowedRunDir = tempDir("rel-slice-a-rundir-")
    expect(vocabulary.cases.map((entry: Json) => entry.port).sort()).toEqual(
      [
        ...Array(2).fill("appendSystemEvent"),
        "admitRunArtifactCandidate",
        ...Array(17).fill("ingestRuntimeObservation"),
        "settle",
      ].sort(),
    )
    for (const entry of vocabulary.cases) {
      if (entry.port === "admitRunArtifactCandidate") {
        const path = join(allowedRunDir, entry.input.fileName)
        writeFileSync(path, entry.input.content)
        const candidate = replaceToken(entry.input.candidate, "$RUN_ID", RUN_ID)
        await artifacts.admitRunArtifactCandidate(
          { path, ...candidate },
          { runId: RUN_ID, allowedRunDir, ledger },
        )
        continue
      }
      await drive(ledger, {
        port: entry.port,
        observationKey: entry.observationKey ?? entry.caseId,
        input: entry.input,
      })
    }

    const records = await readAll(ledger)
    expect([...new Set(records.map((record) => record.type))].sort()).toEqual(
      [...vocabulary.allowedTypes].sort(),
    )
    expect(records.map((record) => record.sequence)).toEqual(
      range(1, records.length),
    )

    const envelopeProblems = records.flatMap((record) => {
      const problems: string[] = []
      if (!isPlainObject(record.payload)) problems.push("payload")
      if (record.runId !== RUN_ID) problems.push("runId")
      if (record.runtimeId !== RUNTIME_ID) problems.push("runtimeId")
      if (
        typeof record.createdAt !== "string" ||
        Number.isNaN(Date.parse(record.createdAt))
      ) {
        problems.push("createdAt")
      }
      return problems.map((problem) => `${record.sequence}:${problem}`)
    })
    expect(envelopeProblems).toEqual([])

    for (const hint of vocabulary.secretHints as string[]) {
      expect(JSON.stringify(records)).not.toContain(hint)
      expect(JSON.stringify(inspect.rows())).not.toContain(hint)
    }

    const caseFindings = vocabulary.cases
      .filter((entry: Json) => typeof entry.observationKey === "string")
      .flatMap((entry: Json) => {
        const owned = recordsFor(records, entry.observationKey).filter(
          (record) => record.type === entry.expectedType,
        )
        const findings: string[] = []
        if (owned.length !== 1) findings.push(`count=${owned.length}`)
        if (
          entry.preservesPayload === true &&
          owned.length === 1 &&
          !isSubset(owned[0].payload, entry.input.payload)
        ) {
          findings.push("payload-members-not-preserved")
        }
        return findings.map((finding) => `${entry.caseId}:${finding}`)
      })
    expect(caseFindings).toEqual([])

    const artifactCase = vocabulary.cases.find(
      (entry: Json) => entry.port === "admitRunArtifactCandidate",
    )
    const created = records.filter(
      (record) => record.type === "artifact_created",
    )
    expect(created).toHaveLength(1)
    expect(created[0].payload).toMatchObject({
      artifacts: [artifactCase.expectedArtifact],
    })
    const completed = records.filter((record) => record.type === "completed")
    expect(completed).toHaveLength(1)
    expect(records.at(-1)?.type).toBe("completed")
  })

  // Enforces once run-event-ledger.ts exists: the two generic ingress ports
  // cannot mint owner-gated artifact_created/completed records; the one
  // completed comes from settle.
  test("S01 Event type is emitted — ingestRuntimeObservation and appendSystemEvent never mint artifact_created or completed (raw minting is refused or diagnosed), and only the settle owner port commits the single completed", async () => {
    const { ledger } = await createSliceALedger({
      runId: `${RUN_ID}-mint`,
      runtimeId: RUNTIME_ID,
      source: vocabulary.source,
      provenance: RUNTIME_PROVENANCE,
      secretHints: vocabulary.secretHints,
    })
    const assistant = vocabulary.cases.find(
      (entry: Json) => entry.caseId === "voc-assistant",
    )
    await drive(ledger, assistant)
    expect(
      vocabulary.rawMintAttempts.map((attempt: Json) => attempt.port).sort(),
    ).toEqual([
      "appendSystemEvent",
      "appendSystemEvent",
      "ingestRuntimeObservation",
      "ingestRuntimeObservation",
    ])
    for (const attempt of vocabulary.rawMintAttempts) {
      await settledResult(() => drive(ledger, attempt))
    }

    const beforeSettle = await readAll(ledger)
    expect(
      beforeSettle
        .filter(
          (record) =>
            record.type === "completed" || record.type === "artifact_created",
        )
        .map((record) => `${record.sequence}:${record.type}`),
    ).toEqual([])
    expect(await ledger.readOutcome()).toBeNull()

    await drive(ledger, settleCase)
    const afterSettle = await readAll(ledger)
    const completed = afterSettle.filter(
      (record) => record.type === "completed",
    )
    expect(completed).toHaveLength(1)
    expect(
      afterSettle.filter((record) => record.type === "artifact_created"),
    ).toEqual([])
    expect(await ledger.readOutcome()).toMatchObject({
      status: "succeeded",
      completedSequence: completed[0].sequence,
    })
  })

  // Enforces once run-event-ledger.ts exists: coarse assistant/reasoning/
  // structured observations commit in ingress order with their content-kind
  // and safe display metadata intact, readable by the CLI/protocol envelope
  // and the desktop Workbench decoder without unwrapping.
  test("S02 Runtime emits assistant output — normalized-output.json assistant, reasoning and structured content commit in ingress order, keep contentKind/format/messageId and the structured object, and display as assistant/reasoning rows through the CLI envelope and desktop decoder", async () => {
    const { ledger } = await createSliceALedger({
      runId: normalized.runId,
      runtimeId: normalized.runtimeId,
      source: "cli",
      provenance: RUNTIME_PROVENANCE,
      secretHints: normalized.secretHints,
    })
    const output: Json[] = normalized.output
    for (const entry of output) await drive(ledger, entry)

    const records = (await readAll(ledger)).filter(
      (record) =>
        record.type === "assistant_delta" || record.type === "reasoning_delta",
    )
    expect(
      records.map((record) =>
        output.findIndex((entry) =>
          factKeyMentions(record, entry.observationKey),
        ),
      ),
    ).toEqual(range(0, output.length - 1))
    expect(records.map((record) => record.type)).toEqual(
      output.map((entry) => entry.expectedType),
    )

    const findings = records.flatMap((record, index) => {
      const entry = output[index]
      const { envelope, row } = protocolViews(record)
      const problems: string[] = []
      if (!isSubset(record.payload, entry.input.payload))
        problems.push("content-kind-or-metadata-lost")
      if (envelope.sequence !== record.sequence) problems.push("cli-sequence")
      if (!Bun.deepEquals(envelope.payload, record.payload))
        problems.push("cli-payload")
      if (row.kind !== entry.expectedDesktopKind) problems.push("desktop-kind")
      if (row.hasRawPayload) problems.push("desktop-unwrap-required")
      return problems.map((problem) => `${entry.caseId}:${problem}`)
    })
    expect(findings).toEqual([])
  })

  // Enforces once run-event-ledger.ts exists: tool start/progress/final commit
  // as tool_started/tool_delta/tool_finished with name/status/call id, the
  // exact provider hint is redacted (with redaction metadata) while the safe
  // remainder stays, and the desktop decoder shows name and status.
  test("S03 Runtime emits tool activity — normalized-output.json tool start/progress/final commit tool_started/tool_delta/tool_finished with toolName, status and toolCallId, redact provider-secret-123 while keeping the safe remainder, and display tool name/status on the desktop decoder", async () => {
    const { ledger, inspect } = await createSliceALedger({
      runId: `${normalized.runId}-tools`,
      runtimeId: normalized.runtimeId,
      source: "cli",
      provenance: RUNTIME_PROVENANCE,
      secretHints: normalized.secretHints,
    })
    const tools: Json[] = normalized.tools
    for (const entry of tools) await drive(ledger, entry)

    const records = (await readAll(ledger)).filter((record) =>
      ["tool_started", "tool_delta", "tool_finished"].includes(record.type),
    )
    expect(
      records.map((record) =>
        tools.findIndex((entry) =>
          factKeyMentions(record, entry.observationKey),
        ),
      ),
    ).toEqual(range(0, tools.length - 1))
    expect(records.map((record) => record.type)).toEqual(
      tools.map((entry) => entry.expectedType),
    )

    const views = records.map((record) => protocolViews(record))
    const findings = records.flatMap((record, index) => {
      const entry = tools[index]
      const payload = (record.payload ?? {}) as Record<string, unknown>
      const { row } = views[index]
      const problems: string[] = []
      if (payload.toolName !== entry.expectedName) problems.push("name")
      if (payload.status !== entry.expectedStatus) problems.push("status")
      if (payload.toolCallId !== entry.input.payload.toolCallId)
        problems.push("toolCallId")
      if (!JSON.stringify(record).includes(entry.retainedSafeText))
        problems.push("safe-remainder-lost")
      if (
        entry.carriesSecret &&
        !valuesByKey(record, "redaction").some(
          (value) => isPlainObject(value) && value.status === "redacted",
        )
      ) {
        problems.push("redaction-metadata")
      }
      if (row.kind !== "tool") problems.push("desktop-kind")
      if (row.summary !== entry.expectedName) problems.push("desktop-name")
      if (row.status !== entry.expectedDesktopStatus)
        problems.push("desktop-status")
      return problems.map((problem) => `${entry.caseId}:${problem}`)
    })
    expect(findings).toEqual([])

    const serialized = JSON.stringify({
      committed: await readAll(ledger),
      stored: inspect.rows(),
      envelopes: views.map((view) => view.envelope),
    })
    for (const hint of normalized.secretHints as string[]) {
      expect(serialized).not.toContain(hint)
    }
  })

  test("S05 Event is serialized for CLI — jobs logs --output stream-json writes exactly one NDJSON {event} object per committed record at its canonical sequence with bare payload, nothing else on stdout and nothing on stderr (green-by-design)", async () => {
    const input = projectionCase("cli-stream-json-committed")
    const ledgerDb = trackDb(createMigratedLedgerDb())
    ledgerDb.db.insert(schema.agentJobs).values(input.job).run()
    const record = input.committedRecord
    ledgerDb.db
      .insert(schema.agentJobEvents)
      .values({
        id: record.id,
        jobId: input.job.id,
        sequence: record.sequence,
        type: record.type,
        payloadJson: JSON.stringify(record.payload),
        createdAt: new Date(record.createdAt),
      })
      .run()

    const out = await runCli(ledgerDb.db, input.argv)
    expect(out.code).toBe(0)
    expect(out.stdout.endsWith("\n")).toBe(true)
    expect(
      out.stdout.split("\n").filter((line) => line.length > 0),
    ).toHaveLength(input.expected.stdoutObjects.length)
    expect(parseJsonLines(out.stdout)).toEqual(input.expected.stdoutObjects)
    expect(out.stderr).toBe(input.expected.stderr)
  })

  test("S05 Event is serialized for CLI — a host recovery diagnostic for an alive stale worker (heartbeat_only) goes to stderr while stream-json stdout carries exactly the committed records and no diagnostic text", async () => {
    const input = projectionCase("cli-stream-json-host-diagnostic")
    const { createAgentJob, startAgentJob, listAgentJobEvents } = await import(
      "../src/main/lib/headless/job-store"
    )
    const ledgerDb = trackDb(createMigratedLedgerDb())
    const now = new Date(input.now)
    expect(input.worker.workerPid).toBe("$SELF_PID")
    const job = await createAgentJob(ledgerDb.db, {
      source: input.job.source,
      runtime: input.job.runtime,
      mode: input.job.mode,
      cwd: process.cwd(),
      prompt: input.job.prompt,
    })
    await startAgentJob(ledgerDb.db, {
      jobId: job.id,
      workerId: `headless:${process.pid}:1:${job.id}`,
      workerPid: process.pid,
      now: new Date(now.getTime() - input.worker.heartbeatAgeMs),
    })
    const lifecycle = await listAgentJobEvents(ledgerDb.db, job.id, 0)
    ledgerDb.db
      .insert(schema.agentJobEvents)
      .values({
        id: `evt-${job.id}-committed`,
        jobId: job.id,
        sequence: (lifecycle.at(-1)?.sequence ?? 0) + 1,
        type: input.committedRecord.type,
        payloadJson: JSON.stringify(input.committedRecord.payload),
        createdAt: new Date(input.committedRecord.createdAt),
      })
      .run()
    const committed = (await listAgentJobEvents(ledgerDb.db, job.id, 0)).map(
      serializeAgentJobEvent,
    )

    const out = await runCli(
      ledgerDb.db,
      ["jobs", "logs", job.id, "--output", "stream-json"],
      { now },
    )
    expect(out.code).toBe(0)
    expect(parseJsonLines(out.stdout)).toEqual(
      committed.map((event) => ({ event })),
    )
    expect(
      (input.hostDiagnostic.stdoutExcludes as string[]).filter((text) =>
        out.stdout.includes(text),
      ),
    ).toEqual([])
    expect(out.stderr).toContain(input.hostDiagnostic.stderrIncludes)
  })

  // Enforces once run-event-ledger.ts exists: committed desktop-source records
  // are bare, so the protocol envelope (tRPC agentJobs.logs / jobs-stdio
  // job/event via serializeAgentJobEvent) carries them at the canonical
  // sequence and the Workbench decoder needs no desktop-wrapper unwrapping.
  test("S07 Event compatibility is required — protocol envelope: committed desktop native records serialize through serializeAgentJobEvent at their canonical sequence with the six documented fields and a bare payload that the Workbench decoder reads without unwrapping raw chunks", async () => {
    const input = projectionCase("protocol-envelope-desktop")
    const { ledger } = await createSliceALedger({
      runId: input.runId,
      runtimeId: input.runtimeId,
      source: input.source,
      provenance: RUNTIME_PROVENANCE,
    })
    for (const observation of input.observations) {
      await drive(ledger, observation)
    }
    const records = await readAll(ledger)
    expect(records.length).toBeGreaterThanOrEqual(input.observations.length)
    expect(records.map((record) => record.sequence)).toEqual(
      range(1, records.length),
    )

    const views = records.map((record) => ({
      record,
      ...protocolViews(record),
    }))
    const findings = views.flatMap(({ record, envelope, row }) => {
      const problems: string[] = []
      if (
        JSON.stringify(Object.keys(envelope).sort()) !==
        JSON.stringify(input.expected.envelopeKeys)
      ) {
        problems.push("envelope-keys")
      }
      if (envelope.sequence !== record.sequence) problems.push("sequence")
      if (envelope.jobId !== input.runId) problems.push("jobId")
      if (!Bun.deepEquals(envelope.payload, record.payload ?? {}))
        problems.push("payload")
      if (row.sequence !== record.sequence) problems.push("decoder-sequence")
      if (!Bun.deepEquals(row.semanticPayload, envelope.payload))
        problems.push("decoder-payload")
      if (row.hasRawPayload) problems.push("decoder-unwrap-required")
      return problems.map((problem) => `${record.sequence}:${problem}`)
    })
    expect(findings).toEqual([])
    expect(
      forbiddenPayloadKeyHits(
        views.map((view) => view.envelope),
        input.expected.forbiddenPayloadKeys,
      ),
    ).toEqual([])

    const assistant = recordsFor(
      records,
      input.expected.assistantObservationKey,
    ).filter((record) => record.type === "assistant_delta")
    expect(assistant).toHaveLength(1)
    expect(
      JSON.stringify(protocolViews(assistant[0]).envelope.payload),
    ).toContain(input.expected.assistantText)
  })

  test("S07 Event compatibility is required — protocol envelope: jobs-stdio (locus-jobs-stdio.v1) emits one job/event notification per persisted record carrying serializeAgentJobEvent of that row at its canonical sequence, with bare payloads and JSON-RPC-only stdout (green-by-design)", async () => {
    const input = projectionCase("protocol-jobs-stdio")
    const { listAgentJobEvents } = await import(
      "../src/main/lib/headless/job-store"
    )
    const ledgerDb = trackDb(createMigratedLedgerDb())
    const projectRoot = tempDir("rel-slice-a-project-")
    ledgerDb.db
      .insert(schema.projects)
      .values({ id: "project-slice-a", name: "Slice A", path: projectRoot })
      .run()
    const request = replaceToken(input.request, "<PROJECT_CWD>", projectRoot)
    const frames = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "job.run", params: request },
      { jsonrpc: "2.0", id: 3, method: "shutdown", params: {} },
    ]
      .map((frame) => JSON.stringify(frame))
      .join("\n")
    const stdout = captureWriter()
    const stderr = captureWriter()
    const code = await runJobsStdioServer({
      db: ledgerDb.db,
      stdin: Readable.from([`${frames}\n`]),
      stdout: stdout.writer,
      stderr: stderr.writer,
      env: {},
      runner: fixtureRunner(input.runnerEvents, input.runnerResult) as never,
    })
    expect(code).toBe(0)
    expect(stderr.value()).toBe("")
    const lines = parseJsonLines(stdout.value()) as Json[]
    expect(lines.every((line) => line.jsonrpc === "2.0")).toBe(true)
    expect(lines.find((line) => line.id === 1)?.result.protocolVersion).toBe(
      input.expected.protocolVersion,
    )
    const jobId = lines.find((line) => line.id === 2)?.result.job.id as string
    const persisted = (await listAgentJobEvents(ledgerDb.db, jobId, 0)).map(
      serializeAgentJobEvent,
    )
    expect(persisted.map((event) => event.sequence)).toEqual(
      range(1, persisted.length),
    )
    expect(
      lines
        .filter((line) => line.method === input.expected.notificationMethod)
        .map((line) => line.params),
    ).toEqual(persisted.map((event) => ({ jobId, event })))
    expect(
      persisted
        .map((event) => JSON.stringify(Object.keys(event).sort()))
        .filter((keys) => keys !== JSON.stringify(input.expected.envelopeKeys)),
    ).toEqual([])
    expect(
      forbiddenPayloadKeyHits(persisted, input.expected.forbiddenPayloadKeys),
    ).toEqual([])
    expect(
      persisted
        .filter((event) => event.type === "assistant_delta")
        .map((event) => (event.payload as Json).text),
    ).toEqual([input.expected.assistantText])
    expect(
      persisted.filter((event) => event.type === "completed"),
    ).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// codex-runtime-parity / Codex Native Boundary Forwarding And Disposition
// ---------------------------------------------------------------------------
describe("codex-runtime-parity / Codex Native Boundary Forwarding And Disposition", () => {
  const RECEIVED_AT = "2026-09-04T00:00:00.000Z"

  function boundary(index: number, input: Json) {
    return {
      observationKey: `slice-a-dec-${index}`,
      transportId: "t1",
      receivedAt: RECEIVED_AT,
      ...structuredClone(input),
    }
  }

  async function loadDecoder(): Promise<(value: unknown) => unknown> {
    const decoderModule = (await import(
      "../src/main/lib/codex/app-server-stream-events"
    )) as Record<string, unknown>
    const decode = decoderModule.decodeCodexNativeBoundary
    expect(typeof decode).toBe("function")
    return decode as (value: unknown) => unknown
  }

  // Enforces once decodeCodexNativeBoundary exists (stateless): the descriptor keeps the
  // exact native channel/index/error/usage fields, invents no index, assigns no sequence.
  test("S43 Decoder retains channel and native error fields — codex-decode.json reasoning text/summary deltas keep channel, text and native IDs with the schema-proven partIndex and no invented index when absent; retry error keeps code/willRetry; usage keeps exact total/last vectors; no descriptor carries a sequence or an inferred succeeded terminal", async () => {
    const decode = await loadDecoder()
    const cases: Json[] = codexDecode.cases
    const observed = cases.map((entry, index) => {
      const output = decode(boundary(index, entry.input))
      const descriptors = descriptorsOf(output)
      return {
        caseId: entry.caseId,
        hasDescriptors: descriptors.length > 0,
        retainsExpectedFields: descriptors.some((descriptor) =>
          isSubset(descriptor, entry.expected),
        ),
        inventedKeys: (entry.absentKeys as string[]).flatMap((key) =>
          valuesByKey(output, key)
            .filter((value) => value !== undefined)
            .map((value) => `${key}=${JSON.stringify(value)}`),
        ),
        untypedDescriptors: descriptors.filter(
          (descriptor) =>
            typeof descriptor.kind !== "string" || descriptor.kind.length === 0,
        ).length,
        sequences: valuesByKey(output, "sequence"),
        inferredSucceeded:
          JSON.stringify(output ?? null).includes('"succeeded"') ||
          descriptors.some((descriptor) => descriptor.kind === "completed"),
      }
    })
    expect(observed).toEqual(
      cases.map((entry) => ({
        caseId: entry.caseId,
        hasDescriptors: true,
        retainsExpectedFields: true,
        inventedKeys: [],
        untypedDescriptors: 0,
        sequences: [],
        inferredSucceeded: false,
      })),
    )
  })

  // Enforces once decodeCodexNativeBoundary exists (stateless): the descriptor keeps the
  // exact native channel/index/error/usage fields, invents no index, assigns no sequence.
  test("S43 Decoder retains channel and native error fields — decoder output depends only on its input: after thread/started, turn/started and summaryPartAdded(summaryIndex=1) are decoded, later index-less summary/text deltas, errors and usage decode deep-equal to their first decode, never gain partIndex 1 or the earlier session/thread/turn IDs, and inputs are not mutated", async () => {
    const decode = await loadDecoder()
    const probe = codexDecode.statefulnessProbe
    const laterCases: Json[] = (probe.laterCaseIds as string[]).map(decodeCase)
    const before = laterCases.map((entry, index) =>
      decode(boundary(100 + index, entry.input)),
    )
    for (const [index, input] of (probe.interleaved as Json[]).entries()) {
      decode(boundary(200 + index, input))
    }
    const observed = laterCases.map((entry, index) => {
      const input = boundary(100 + index, entry.input)
      const snapshot = structuredClone(input)
      const output = decode(input)
      return {
        caseId: entry.caseId,
        sameAsFirstDecode: Bun.deepEquals(output, before[index]),
        inputUnchanged: Bun.deepEquals(input, snapshot),
        leakedValues: (probe.leakedValues as string[]).filter((value) =>
          JSON.stringify(output ?? null).includes(value),
        ),
        inventedKeys: (entry.absentKeys as string[]).flatMap((key) =>
          valuesByKey(output, key)
            .filter((value) => value !== undefined)
            .map((value) => `${key}=${JSON.stringify(value)}`),
        ),
      }
    })
    expect(observed).toEqual(
      laterCases.map((entry) => ({
        caseId: entry.caseId,
        sameAsFirstDecode: true,
        inputUnchanged: true,
        leakedValues: [],
        inventedKeys: [],
      })),
    )
  })
})
