/**
 * Test-first acceptance suite for `openspec/changes/refactor-canonical-run-event-ledger`,
 * domain C (public projection): local-job-api, desktop-agent-jobs and
 * headless-agent-jobs deltas.
 *
 * Every assertion goes through an observable entry point named by the spec,
 * design or tasks: the Local Job API CLI dispatcher (`api runs create/events/
 * result/status/retry`, `run`, `jobs logs`), the v1 serializers in
 * `headless/local-job-api.ts`, the discovery reader, the headless job runner,
 * the headless Codex app-server task runner, the Workbench trace presenter,
 * temporary SQLite rows created by the real drizzle migrations, and the
 * design's test-facing ledger contract (`createCanonicalRunEventLedger`,
 * `projectRunEventToRendererChunks`). Modules the design introduces are loaded
 * with a dynamic import inside the test that needs them, so a missing owner
 * fails only that test.
 *
 * Tests labelled "(green-by-design)" are characterization guards for behavior
 * the deltas keep unchanged; they pass on the pre-implementation base and must
 * keep passing. Every other test is expected RED on the base.
 *
 * Fixtures: tests/fixtures/run-event-ledger/{public-v1,public-results,
 * public-artifacts,discovery,desktop-projection,headless-projection}.json.
 */
import { Database } from "bun:sqlite"
import { beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import Ajv2020 from "ajv/dist/2020"
import addFormats from "ajv-formats"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import * as schema from "../src/main/lib/db/schema"
import { createCodexAppServerHeadlessTaskRunner } from "../src/main/lib/headless/adapters/codex-app-server"
import {
  type AgentRuntimeObserver,
  type AgentRuntimeRunResult,
  createAgentRuntimeRunRequest,
} from "../src/main/lib/headless/agent-runtime-contract"
import { HEADLESS_CLI_MARKER } from "../src/main/lib/headless/cli-args"
import { runHeadlessCliCommand } from "../src/main/lib/headless/cli-dispatcher"
import { normalizeHeadlessExitCode } from "../src/main/lib/headless/job-runner"
import {
  getLocalJobApiEvents,
  toLocalJobApiEventEnvelope,
  toLocalJobApiResultEnvelope,
  toLocalJobApiRuntimeManifestEnvelope,
} from "../src/main/lib/headless/local-job-api"
import { clearRuntimeReadinessCacheForTest } from "../src/main/lib/headless/runtime-readiness"
import { getWorkbenchTraceRow } from "../src/renderer/features/agents/workbench/workbench-trace-presenter"
import { AGENT_JOB_EVENT_TYPES } from "../src/shared/agent-jobs"
import {
  LOCAL_JOB_API_DISCOVERY_FEATURES,
  LOCAL_JOB_API_EVENT_TYPES,
} from "../src/shared/local-job-api"

// ---------------------------------------------------------------------------
// Fixtures and helpers (all state is created per test; nothing is shared)
// ---------------------------------------------------------------------------

const FIXTURE_DIR = join(import.meta.dir, "fixtures/run-event-ledger")
const REPO_ROOT = join(import.meta.dir, "..")
const MIGRATIONS_DIR = join(REPO_ROOT, "drizzle")
const CLI_TEST_TIMEOUT_MS = 30_000

type Json = any

function fixture(name: string): Json {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8"))
}

function caseById(file: string, caseId: string): Json {
  const found = fixture(file).cases.find(
    (entry: { caseId: string }) => entry.caseId === caseId,
  )
  if (!found) throw new Error(`Missing fixture case ${file}#${caseId}`)
  return found
}

function materialize<T>(value: T, replacements: Record<string, string>): T {
  let text = JSON.stringify(value)
  for (const [token, replacement] of Object.entries(replacements)) {
    text = text.split(token).join(replacement)
  }
  return JSON.parse(text) as T
}

/** Temporary in-memory SQLite database built by the real drizzle migrations. */
function createMigratedDb() {
  const sqlite = new Database(":memory:")
  sqlite.exec("PRAGMA foreign_keys = ON")
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  return { sqlite, db }
}

type MigratedDb = ReturnType<typeof createMigratedDb>

function seedProject(db: MigratedDb["db"]) {
  const projectRoot = realpathSync(
    mkdtempSync(join(tmpdir(), "run-event-ledger-projection-")),
  )
  const packageDir = join(projectRoot, "pkg")
  mkdirSync(packageDir)
  db.insert(schema.projects)
    .values({ id: "project-domain-c", name: "Domain C", path: projectRoot })
    .run()
  return { projectRoot, packageDir: realpathSync(packageDir) }
}

type FixtureEvent = { type: string; payload: unknown }

function fixtureRunner(
  events: FixtureEvent[],
  result: unknown,
  secretHints: string[] = [],
) {
  return async (
    _request: unknown,
    observer: AgentRuntimeObserver,
  ): Promise<AgentRuntimeRunResult> => {
    if (secretHints.length > 0) observer.registerSecretHints(secretHints)
    for (const event of events) {
      observer.appendEvent(
        event.type as Parameters<AgentRuntimeObserver["appendEvent"]>[0],
        structuredClone(event.payload),
      )
    }
    return structuredClone(result) as AgentRuntimeRunResult
  }
}

async function runCli(
  db: MigratedDb["db"],
  argv: string[],
  options: {
    stdin?: string
    runner?: ReturnType<typeof fixtureRunner>
    completionFetch?: (url: string, init?: RequestInit) => Promise<Response>
  } = {},
) {
  let stdout = ""
  let stderr = ""
  const code = await runHeadlessCliCommand({
    db: db as never,
    argv: ["Locus", HEADLESS_CLI_MARKER, ...argv],
    stdin:
      options.stdin === undefined ? undefined : Readable.from([options.stdin]),
    stdout: {
      write(chunk: string) {
        stdout += chunk
      },
    },
    stderr: {
      write(chunk: string) {
        stderr += chunk
      },
    },
    runner: options.runner as never,
    completionFetch: options.completionFetch as never,
    env: {},
    appVersion: "0.0.test",
  })
  return { code, stdout, stderr }
}

function jsonLines(text: string): Json[] {
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
}

async function createApiRun(
  db: MigratedDb["db"],
  request: unknown,
  runner?: ReturnType<typeof fixtureRunner>,
) {
  const out = await runCli(
    db,
    ["api", "runs", "create", "--request", "-", "--json"],
    { stdin: JSON.stringify(request), runner },
  )
  return { ...out, created: JSON.parse(out.stdout) }
}

async function readApiEvents(
  db: MigratedDb["db"],
  jobId: string,
  after: number,
  follow = false,
) {
  const argv = ["api", "runs", "events", jobId, "--after", String(after)]
  if (follow) argv.push("--follow")
  argv.push("--jsonl")
  const out = await runCli(db, argv)
  return { ...out, events: jsonLines(out.stdout) }
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function expectContiguousFrom(sequences: number[], first: number) {
  expect(sequences.length).toBeGreaterThan(0)
  expect(sequences).toEqual(sequences.map((_value, index) => first + index))
}

function seedCommittedEventRows(
  db: MigratedDb["db"],
  jobId: string,
  firstSequence: number,
  records: FixtureEvent[],
) {
  records.forEach((record, index) => {
    db.insert(schema.agentJobEvents)
      .values({
        id: `seeded-${jobId}-${firstSequence + index}`,
        jobId,
        sequence: firstSequence + index,
        type: record.type,
        payloadJson: JSON.stringify(record.payload),
        createdAt: new Date("2026-09-04T00:10:00.000Z"),
      })
      .run()
  })
}

/**
 * In-memory durable store satisfying the design's store port
 * (appendExact/lookupFact/read/readHeader/cursor/ack). It validates the
 * expected high-water and dense sequences, never re-sequences, and exposes
 * only committed records.
 */
function createMemoryDurableStore(runId: string) {
  const committed: Json[] = []
  const cursors = new Map<string, number>()
  return {
    committed,
    appendExact(input: { records: Json[]; expectedHighWater: number }) {
      if (input.expectedHighWater !== committed.length) {
        throw new Error("expectedHighWater conflict")
      }
      input.records.forEach((record, index) => {
        if (record.sequence !== committed.length + index + 1) {
          throw new Error("non-dense sequence")
        }
      })
      committed.push(...input.records)
      return input.records
    },
    lookupFact(_observationKey: string) {
      return null
    },
    read(_runId: string, afterSequence: number) {
      return committed.filter((record) => record.sequence > afterSequence)
    },
    readHeader(_runId: string) {
      return {
        runId,
        ledgerVersion: 1,
        highWater: committed.length,
        sealedSequence: null,
      }
    },
    cursor(_runId: string, projectionName: string) {
      return cursors.get(projectionName) ?? 0
    },
    ack(_runId: string, projectionName: string, sequence: number) {
      cursors.set(
        projectionName,
        Math.max(cursors.get(projectionName) ?? 0, sequence),
      )
    },
  }
}

function recordingProjection(
  name: string,
  store: ReturnType<typeof createMemoryDurableStore>,
  runId: string,
) {
  const deliveries: unknown[][] = []
  return {
    deliveries,
    projection: {
      name,
      deliver(...args: unknown[]) {
        deliveries.push(args)
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

/** Deterministic clock usable either as a function or as `{ now() }`. */
function fixedClock(iso: string) {
  return Object.assign(() => new Date(iso), { now: () => new Date(iso) })
}

async function importOwner(relativePath: string): Promise<Json> {
  return await import(join(REPO_ROOT, relativePath))
}

function toJobEventRow(record: Json) {
  return {
    id: `row-${record.sequence}`,
    jobId: record.runId,
    sequence: record.sequence,
    type: record.type,
    payloadJson: JSON.stringify(record.payload ?? {}),
    createdAt: new Date(record.createdAt),
  }
}

const WRAPPER_KEYS = ["runId", "runEventSequence", "redaction", "payload"]

/** Returns `sequence:key` for every object payload that carries a listed key. */
function wrapperKeyHits(events: Json[], keys: string[]): string[] {
  return events.flatMap((event) =>
    isObject(event.payload)
      ? keys
          .filter((key) => Object.hasOwn(event.payload, key))
          .map((key) => `${event.sequence}:${key}`)
      : [],
  )
}

// ---------------------------------------------------------------------------
// local-job-api / Stable API Event Stream
// ---------------------------------------------------------------------------

describe("local-job-api / Stable API Event Stream", () => {
  test(
    "S48 Consumer reads events — runs events --after=2 returns only later bare envelopes of the same API job (green-by-design)",
    async () => {
      const { db } = createMigratedDb()
      const { packageDir } = seedProject(db)
      const input = caseById("public-v1.json", "api-assistant-hello")
      const request = materialize(input.request, {
        "<PROJECT_CWD>": packageDir,
      })
      const created = await createApiRun(
        db,
        request,
        fixtureRunner(input.runnerEvents, input.runnerResult),
      )
      expect(created.code).toBe(0)
      const jobId = created.created.job.id as string

      const read = await readApiEvents(db, jobId, input.afterSequence)
      expect(read.code).toBe(0)
      expect(read.stderr).toBe("")
      const sequences = read.events.map((event) => event.sequence as number)
      expect(
        sequences.every((sequence) => sequence > input.afterSequence),
      ).toBe(true)
      expectContiguousFrom(sequences, input.afterSequence + 1)
      for (const event of read.events) {
        expect(Object.keys(event).sort()).toEqual(input.expected.envelopeKeys)
        expect(event.apiVersion).toBe(input.expected.apiVersion)
        expect(event.jobId).toBe(jobId)
      }
      expect(
        wrapperKeyHits(read.events, input.expected.forbiddenPayloadKeys),
      ).toEqual([])
      const assistant = read.events.filter(
        (event) => event.type === "assistant_delta",
      )
      expect(assistant.map((event) => event.payload.text)).toEqual([
        input.expected.assistantText,
      ])
      expect(
        getLocalJobApiEvents(db as never, jobId, input.afterSequence),
      ).toEqual(read.events)

      const last = sequences.at(-1) as number
      const again = await readApiEvents(db, jobId, last)
      expect(again.code).toBe(0)
      expect(again.events).toEqual([])
    },
    CLI_TEST_TIMEOUT_MS,
  )

  test(
    "S48 Consumer reads events — pre-binding runtime_selection_refused keeps its string payload.runtime and has no runtime.codex.v1 extension (green-by-design)",
    async () => {
      const { db } = createMigratedDb()
      const { packageDir } = seedProject(db)
      const input = caseById(
        "public-v1.json",
        "api-runtime-selection-refused-pre-binding",
      )
      const request = materialize(input.request, {
        "<PROJECT_CWD>": packageDir,
      })
      const created = await createApiRun(db, request)
      expect(created.code).toBe(input.expected.exitCode)
      expect(created.created.job.status).toBe(input.expected.jobStatus)
      const jobId = created.created.job.id as string

      const read = await readApiEvents(db, jobId, 0)
      const refused = read.events.filter(
        (event) =>
          event.type === "status" &&
          isObject(event.payload) &&
          event.payload.status === input.expected.statusSubject,
      )
      expect(refused).toHaveLength(1)
      expect(refused[0].payload.runtime).toBe(input.expected.payloadRuntime)
      const extensions = refused[0].payload.extensions
      expect(
        isObject(extensions)
          ? Object.hasOwn(extensions, input.expected.extensionNamespace)
          : false,
      ).toBe(false)
    },
    CLI_TEST_TIMEOUT_MS,
  )

  test(
    "S48 Consumer reads events — a source=desktop job is rejected by getLocalJobApiEvents and runs events (green-by-design)",
    async () => {
      const { db } = createMigratedDb()
      const { packageDir } = seedProject(db)
      const input = caseById("public-v1.json", "desktop-source-rejected")
      db.insert(schema.agentJobs)
        .values({
          id: "job-desktop-source",
          source: input.job.source,
          runtime: input.job.runtime,
          mode: input.job.mode,
          cwd: packageDir,
          promptPreview: input.job.prompt,
          status: "running",
        })
        .run()

      expect(() =>
        getLocalJobApiEvents(db as never, "job-desktop-source", 0),
      ).toThrow(input.expected.errorMessageIncludes)
      const read = await readApiEvents(db, "job-desktop-source", 0)
      expect(read.code).not.toBe(0)
      expect(read.stdout).toBe("")
      expect(read.stderr).toContain(input.expected.errorMessageIncludes)
    },
    CLI_TEST_TIMEOUT_MS,
  )

  test("S48 Consumer reads events — runtime-backed records carry payload.extensions['runtime.codex.v1'] while the pending runtime_selected record keeps payload.runtime and is not retroactively extended", async () => {
    const input = caseById("public-v1.json", "runtime-backed-extension")
    const { createCanonicalRunEventLedger } = await importOwner(
      "src/main/lib/agent-runtime/run-event-ledger.ts",
    )
    expect(typeof createCanonicalRunEventLedger).toBe("function")
    const store = createMemoryDurableStore(input.runId)
    const ledger = createCanonicalRunEventLedger({
      runId: input.runId,
      runtimeId: input.runtimeId,
      source: input.source,
      provenance: input.pendingProvenance,
      clock: fixedClock("2026-09-04T00:00:00.000Z"),
      redactionContext: { secretHints: [] },
      durableStore: store,
      projections: [],
      artifactOwner: {},
    })
    await ledger.appendSystemEvent(input.systemEvent)
    const beforeBinding = structuredClone(await ledger.read(0))
    await ledger.bindExecutionProvenance(input.runtimeProvenance)
    await ledger.ingestNotification(input.notification)
    const records: Json[] = await ledger.read(0)

    const selected = records.filter(
      (record) =>
        record.type === "status" &&
        record.payload?.status === input.systemEvent.payload.status,
    )
    expect(selected).toHaveLength(1)
    expect(selected[0].payload.runtime).toBe(input.systemEvent.payload.runtime)
    expect(selected[0].payload.extensions?.["runtime.codex.v1"]).toBeUndefined()
    expect(
      beforeBinding.find(
        (record: Json) => record.sequence === selected[0].sequence,
      ),
    ).toEqual(selected[0])

    const assistant = records.filter(
      (record) => record.type === "assistant_delta",
    )
    expect(assistant).toHaveLength(1)
    expect(assistant[0].payload.extensions["runtime.codex.v1"]).toMatchObject(
      input.expected.extension,
    )
    const envelope = toLocalJobApiEventEnvelope(
      toJobEventRow(assistant[0]) as never,
    )
    expect(envelope.type).toBe("assistant_delta")
    expect(
      (envelope.payload as Json).extensions["runtime.codex.v1"],
    ).toMatchObject(input.expected.extension)
    expect(Object.hasOwn(envelope.payload as object, "runEventSequence")).toBe(
      false,
    )
  })

  test(
    "S48 Consumer reads events — admitted initial artifact_created precedes job_started on API create and retry (green-by-design)",
    async () => {
      const { db } = createMigratedDb()
      const { packageDir } = seedProject(db)
      const input = caseById("public-artifacts.json", "public-artifacts")
      const retryInput = caseById(
        "public-results.json",
        "public-results",
      ).retryCase
      const artifactBaseDir = join(packageDir, ".locus", "runs")
      const request = materialize(input.request, {
        "<PROJECT_CWD>": packageDir,
        "<ARTIFACT_BASE_DIR>": artifactBaseDir,
      })
      const source = await createApiRun(
        db,
        request,
        fixtureRunner(
          retryInput.sourceRunnerEvents,
          retryInput.sourceRunnerResult,
        ),
      )
      expect(source.code).toBe(retryInput.expected.sourceExitCode)
      const sourceId = source.created.job.id as string
      const sourceTypes = (await readApiEvents(db, sourceId, 0)).events.map(
        (event) => event.type,
      )
      expect(sourceTypes.indexOf("artifact_created")).toBeGreaterThan(-1)
      expect(sourceTypes.indexOf("artifact_created")).toBeLessThan(
        sourceTypes.indexOf("job_started"),
      )

      const retry = await runCli(
        db,
        ["api", "runs", "retry", sourceId, "--json"],
        {
          runner: fixtureRunner(
            retryInput.retryRunnerEvents,
            retryInput.retryRunnerResult,
          ),
        },
      )
      expect(retry.code).toBe(retryInput.expected.retryExitCode)
      const retryId = JSON.parse(retry.stdout).job.id as string
      const retryTypes = (await readApiEvents(db, retryId, 0)).events.map(
        (event) => event.type,
      )
      expect(retryTypes.indexOf("artifact_created")).toBeGreaterThan(-1)
      expect(retryTypes.indexOf("artifact_created")).toBeLessThan(
        retryTypes.indexOf("job_started"),
      )
    },
    CLI_TEST_TIMEOUT_MS,
  )

  test(
    "S49 Consumer follows events — follow exits at the committed terminal with one JSON envelope per stdout line; an explicit later read returns late_event diagnostics without another completed or altered result (green-by-design)",
    async () => {
      const { db } = createMigratedDb()
      const { packageDir } = seedProject(db)
      const hello = caseById("public-v1.json", "api-assistant-hello")
      const late = caseById("public-v1.json", "follow-late-diagnostics")
      const created = await createApiRun(
        db,
        materialize(hello.request, { "<PROJECT_CWD>": packageDir }),
        fixtureRunner(hello.runnerEvents, hello.runnerResult),
      )
      expect(created.code).toBe(0)
      const jobId = created.created.job.id as string
      const resultBefore = await runCli(db, [
        "api",
        "runs",
        "result",
        jobId,
        "--json",
      ])
      const committed = (await readApiEvents(db, jobId, 0)).events
      const completedSequence = committed.find(
        (event) => event.type === "completed",
      )?.sequence as number
      expect(committed.at(-1)?.sequence).toBe(completedSequence)
      const lateRecords = late.lateRecords.map((record: Json) => ({
        type: record.type,
        payload: { ...record.payload, terminalSequence: completedSequence },
      }))
      seedCommittedEventRows(db, jobId, completedSequence + 1, lateRecords)

      const followed = await readApiEvents(db, jobId, 0, true)
      expect(followed.code).toBe(0)
      expect(followed.stderr).toBe("")
      const lines = followed.stdout.split("\n").filter(Boolean)
      expect(lines.length).toBe(followed.events.length)
      for (const event of followed.events) {
        expect(event.apiVersion).toBe("locus.local-job.v1")
        expect(event.jobId).toBe(jobId)
      }
      expect(
        followed.events.filter((event) => event.type === "completed"),
      ).toHaveLength(1)

      const explicit = await readApiEvents(db, jobId, completedSequence)
      expect(explicit.events.map((event) => event.type)).toEqual(
        late.lateRecords.map(() => "status"),
      )
      expectContiguousFrom(
        explicit.events.map((event) => event.sequence),
        completedSequence + 1,
      )
      for (const event of explicit.events) {
        expect(event.payload.subtype).toBe("late_event")
        expect(event.payload.diagnosticOnly).toBe(true)
        expect(event.payload.terminalSequence).toBe(completedSequence)
      }
      const resultAfter = await runCli(db, [
        "api",
        "runs",
        "result",
        jobId,
        "--json",
      ])
      expect(resultAfter.stdout).toBe(resultBefore.stdout)
    },
    CLI_TEST_TIMEOUT_MS,
  )

  test("S50 All internal event types preserve dense v1 projection — 21 internal types plus a redacted-only stub keep their contiguous sequences, map to exactly the 12 public types, and the nine coerced types carry subtype = internal type name", () => {
    const input = caseById("public-v1.json", "dense-vocabulary")
    expect([...LOCAL_JOB_API_EVENT_TYPES]).toEqual(input.expected.publicTypes)
    expect(AGENT_JOB_EVENT_TYPES).toHaveLength(21)
    expect(
      input.records
        .slice(0, 21)
        .map((record: Json) => record.type)
        .sort(),
    ).toEqual([...AGENT_JOB_EVENT_TYPES].sort())

    const envelopes = input.records.map((record: Json) =>
      toLocalJobApiEventEnvelope({
        ...record,
        createdAt: new Date(record.createdAt),
      } as never),
    )
    expect(envelopes.map((envelope: Json) => envelope.sequence)).toEqual(
      input.records.map((record: Json) => record.sequence),
    )
    expectContiguousFrom(
      envelopes.map((envelope: Json) => envelope.sequence),
      1,
    )
    expect(
      [...new Set(envelopes.map((envelope: Json) => envelope.type))].sort(),
    ).toEqual([...input.expected.publicTypes].sort())

    const pairs = input.records.map((record: Json, index: number) => ({
      record,
      envelope: envelopes[index],
      original: JSON.parse(record.payloadJson),
    }))
    const coerced = pairs.filter((pair: Json) =>
      input.expected.coercedToStatus.includes(pair.record.type),
    )
    const preserved = pairs.filter(
      (pair: Json) =>
        !input.expected.coercedToStatus.includes(pair.record.type),
    )
    expect(coerced).toHaveLength(9)
    for (const pair of coerced) {
      expect(pair.envelope.type).toBe("status")
      expect(pair.envelope.payload).toEqual({
        ...pair.original,
        subtype: pair.record.type,
      })
    }
    for (const pair of preserved) {
      expect(pair.envelope.type).toBe(pair.record.type)
      expect(pair.envelope.payload).toEqual(pair.original)
    }
    for (const pair of pairs) {
      expect(pair.envelope.jobId).toBe(input.jobId)
      expect(pair.envelope.apiVersion).toBe("locus.local-job.v1")
    }

    const stub = envelopes.find(
      (envelope: Json) =>
        envelope.sequence === input.expected.redactedStubSequence,
    )
    expect(stub.type).toBe("status")
    expect(stub.payload.subtype).toBe(input.expected.redactedStubSubtype)
    expect(stub.payload.contentOmitted).toBe(true)
    expect(stub.payload.futureOptionalField).toBe("ignorable")
  })
})

// ---------------------------------------------------------------------------
// local-job-api / Run Result and Artifact Manifest
// ---------------------------------------------------------------------------

describe("local-job-api / Run Result and Artifact Manifest", () => {
  test("S51 API job completes — committed succeeded/failed/canceled/interrupted outcomes serialize status, runtime/mode/consumer, diagnostics, manifest entries and the status-derived exit code without secrets (green-by-design)", () => {
    const input = caseById("public-results.json", "public-results")
    for (const entry of input.committedJobs) {
      const job = {
        ...entry.job,
        kind: "agent",
        source: "api",
        artifactManifestPath:
          entry.artifacts.length > 0
            ? `/fixture/runs/${entry.job.id}/artifacts.json`
            : null,
      }
      const envelope = toLocalJobApiResultEnvelope(
        job as never,
        entry.artifacts,
        [],
      )
      expect(envelope).toMatchObject({
        apiVersion: "locus.local-job.v1",
        jobId: entry.job.id,
        status: entry.expected.status,
        runtime: entry.job.runtime,
        mode: entry.job.mode,
        consumer: {
          id: entry.job.apiConsumerId,
          runExternalId: entry.job.apiConsumerRunId,
        },
        artifactManifestPath: job.artifactManifestPath,
        artifacts: entry.artifacts,
        diagnostics: entry.expected.diagnostics,
      })
      expect(
        normalizeHeadlessExitCode({
          status: entry.expected.status,
          errorCode: entry.job.errorCode,
        }),
      ).toBe(entry.expected.exitCode)
      const serialized = JSON.stringify(envelope)
      for (const secret of input.forbiddenSecrets) {
        expect(serialized).not.toContain(secret)
      }
    }
  })

  for (const caseId of [
    "r1-zero-output-default-success",
    "r1-recorded-denial-default-success",
  ]) {
    test(
      `S51 API job completes — R1 DIRECT_NEW_STANDARD: ${caseId} reports failed with a reason and the failure exit code`,
      async () => {
        const { db } = createMigratedDb()
        const { packageDir } = seedProject(db)
        const input = caseById("public-results.json", "public-results")
        const runnerCase = input.runnerCases.find(
          (entry: Json) => entry.caseId === caseId,
        )
        const request = materialize(input.requestTemplate, {
          "<PROJECT_CWD>": packageDir,
          "<RUN_EXTERNAL_ID>": caseId,
        })
        const created = await createApiRun(
          db,
          request,
          fixtureRunner(runnerCase.runnerEvents, runnerCase.runnerResult),
        )
        expect(created.code).toBe(runnerCase.expected.exitCode)
        expect(created.created.job.status).toBe(runnerCase.expected.jobStatus)
        expect(created.created.result.status).toBe(
          runnerCase.expected.jobStatus,
        )
        expect(created.created.result.diagnostics.length).toBeGreaterThan(0)

        const jobId = created.created.job.id as string
        const events = (await readApiEvents(db, jobId, 0)).events
        const completed = events.filter((event) => event.type === "completed")
        expect(completed).toHaveLength(1)
        expect(completed[0].payload.status).toBe(runnerCase.expected.jobStatus)
        expect(Array.isArray(completed[0].payload.reasons)).toBe(true)
        expect(completed[0].payload.reasons.length).toBeGreaterThan(0)
        expect(
          completed[0].payload.reasons.every(
            (reason: unknown) => typeof reason === "string",
          ),
        ).toBe(true)

        const result = await runCli(db, [
          "api",
          "runs",
          "result",
          jobId,
          "--json",
        ])
        expect(JSON.parse(result.stdout).status).toBe(
          runnerCase.expected.jobStatus,
        )
      },
      CLI_TEST_TIMEOUT_MS,
    )
  }

  test(
    "S51 API job completes — a retryable diagnostic followed by live success and valid output stays succeeded/exit 0 and serializes no secret (green-by-design)",
    async () => {
      const { db } = createMigratedDb()
      const { packageDir } = seedProject(db)
      const input = caseById("public-results.json", "public-results")
      const runnerCase = input.runnerCases.find(
        (entry: Json) => entry.caseId === "r1-retry-diagnostic-then-success",
      )
      const created = await createApiRun(
        db,
        materialize(input.requestTemplate, {
          "<PROJECT_CWD>": packageDir,
          "<RUN_EXTERNAL_ID>": runnerCase.caseId,
        }),
        fixtureRunner(
          runnerCase.runnerEvents,
          runnerCase.runnerResult,
          runnerCase.secretHints,
        ),
      )
      expect(created.code).toBe(runnerCase.expected.exitCode)
      expect(created.created.job.status).toBe(runnerCase.expected.jobStatus)
      expect(created.created.result.status).toBe(runnerCase.expected.jobStatus)
      const jobId = created.created.job.id as string
      const events = await readApiEvents(db, jobId, 0)
      const errors = events.events.filter((event) => event.type === "error")
      expect(errors).toHaveLength(1)
      expect(errors[0].payload.willRetry).toBe(true)
      expect(errors[0].payload.code).toBe("retryable")
      expect(
        events.events.filter((event) => event.type === "completed"),
      ).toHaveLength(1)
      const result = await runCli(db, [
        "api",
        "runs",
        "result",
        jobId,
        "--json",
      ])
      for (const text of [created.stdout, events.stdout, result.stdout]) {
        for (const secret of runnerCase.secretHints) {
          expect(text).not.toContain(secret)
        }
      }
    },
    CLI_TEST_TIMEOUT_MS,
  )

  test(
    "S51 API job completes — runs status on the retry job links job.retryOfJobId and job.attempt to its failed source (green-by-design)",
    async () => {
      const { db } = createMigratedDb()
      const { packageDir } = seedProject(db)
      const input = caseById("public-results.json", "public-results")
      const retryCase = input.retryCase
      const source = await createApiRun(
        db,
        materialize(input.requestTemplate, {
          "<PROJECT_CWD>": packageDir,
          "<RUN_EXTERNAL_ID>": retryCase.caseId,
        }),
        fixtureRunner(
          retryCase.sourceRunnerEvents,
          retryCase.sourceRunnerResult,
        ),
      )
      expect(source.code).toBe(retryCase.expected.sourceExitCode)
      const sourceId = source.created.job.id as string
      const retry = await runCli(
        db,
        ["api", "runs", "retry", sourceId, "--json"],
        {
          runner: fixtureRunner(
            retryCase.retryRunnerEvents,
            retryCase.retryRunnerResult,
          ),
        },
      )
      expect(retry.code).toBe(retryCase.expected.retryExitCode)
      const retryId = JSON.parse(retry.stdout).job.id as string
      expect(retryId).not.toBe(sourceId)
      const status = await runCli(db, [
        "api",
        "runs",
        "status",
        retryId,
        "--json",
      ])
      expect(JSON.parse(status.stdout).job).toMatchObject({
        id: retryId,
        retryOfJobId: sourceId,
        attempt: retryCase.expected.attempt,
        status: retryCase.expected.retryStatus,
      })
    },
    CLI_TEST_TIMEOUT_MS,
  )

  test(
    "S52 Run artifact directory is configured — request/events/result/manifest files exist under <artifactBaseDir>/<jobId>/ with matching SHA-256, a frozen terminal prefix and digests unchanged by later diagnostics (green-by-design)",
    async () => {
      const { db } = createMigratedDb()
      const { packageDir } = seedProject(db)
      const input = caseById("public-artifacts.json", "public-artifacts")
      const artifactBaseDir = join(packageDir, ".locus", "runs")
      const created = await createApiRun(
        db,
        materialize(input.request, {
          "<PROJECT_CWD>": packageDir,
          "<ARTIFACT_BASE_DIR>": artifactBaseDir,
        }),
        fixtureRunner(input.runnerEvents, input.runnerResult),
      )
      expect(created.code).toBe(0)
      const jobId = created.created.job.id as string
      const runDir = join(realpathSync(artifactBaseDir), jobId)
      expect(readdirSync(runDir).sort()).toEqual(input.expected.runDirFiles)
      for (const forbidden of input.expected.forbiddenRunDirEntries) {
        expect(existsSync(join(runDir, forbidden))).toBe(false)
      }
      expect(created.created.job.artifactManifestPath).toBe(
        join(runDir, "artifacts.json"),
      )

      const artifacts = created.created.result.artifacts as Json[]
      expect(artifacts.map((artifact) => artifact.role)).toEqual(
        input.expected.resultEnvelopeRoles,
      )
      for (const artifact of artifacts) {
        expect(artifact.sha256).toBe(sha256File(artifact.path))
      }
      const manifest = JSON.parse(
        readFileSync(join(runDir, "artifacts.json"), "utf8"),
      )
      expect(manifest.artifacts.map((artifact: Json) => artifact.role)).toEqual(
        input.expected.finalManifestFileRoles,
      )

      const fileEvents = jsonLines(
        readFileSync(join(runDir, "events.jsonl"), "utf8"),
      )
      expectContiguousFrom(
        fileEvents.map((event) => event.sequence),
        1,
      )
      expect(
        fileEvents.filter((event) => event.type === "completed"),
      ).toHaveLength(1)
      expect(fileEvents.at(-1)?.type).toBe("completed")
      const initial = fileEvents.find(
        (event) => event.type === "artifact_created",
      )
      expect(
        initial?.payload.artifacts.map((artifact: Json) => artifact.role),
      ).toEqual(input.expected.initialArtifactRoles)

      const completedSequence = fileEvents.at(-1)?.sequence as number
      seedCommittedEventRows(
        db,
        jobId,
        completedSequence + 1,
        input.lateRecords,
      )
      for (const artifact of artifacts) {
        expect(sha256File(artifact.path)).toBe(artifact.sha256)
      }
      const later = await readApiEvents(db, jobId, completedSequence)
      expect(later.events.map((event) => event.payload.subtype)).toEqual(
        input.lateRecords.map(() => "late_event"),
      )
    },
    CLI_TEST_TIMEOUT_MS,
  )
})

// ---------------------------------------------------------------------------
// local-job-api / Discovery Feature Advertisement
// ---------------------------------------------------------------------------

function discoveryReadiness(input: Json) {
  return {
    hasAnyClaudeCodeAccount: () => input.readiness.claudeConnected,
    getExistingClaudeCredentials: () => null,
    getCodexExecutableStatus: () => input.readiness.codexExecutableStatus,
    getCodexRuntimeStatus: async () => ({
      components: input.readiness.codexRuntimeComponents,
    }),
  }
}

function localJobApiSchema(): Json {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, "docs/local-job-api-v1.schema.json"), "utf8"),
  )
}

function schemaValidator(schemaDocument: Json, ref: string) {
  const ajv = new Ajv2020({ allErrors: true })
  addFormats(ajv)
  ajv.addSchema(schemaDocument, "local-job-api-v1")
  const validate = ajv.getSchema(`local-job-api-v1${ref}`)
  if (!validate) throw new Error(`Missing schema validator for ${ref}`)
  return validate
}

function findPropertySchemas(node: unknown, key: string, found: Json[] = []) {
  if (Array.isArray(node)) {
    for (const item of node) findPropertySchemas(item, key, found)
    return found
  }
  if (!isObject(node)) return found
  if (isObject(node.properties) && isObject(node.properties[key])) {
    found.push(node.properties[key])
  }
  for (const value of Object.values(node))
    findPropertySchemas(value, key, found)
  return found
}

describe("local-job-api / Discovery Feature Advertisement", () => {
  beforeEach(() => {
    clearRuntimeReadinessCacheForTest()
  })

  test("S53 Consumer detects readiness support — the discovery reader advertises runtime-readiness with per-runtime readiness objects (green-by-design)", async () => {
    const input = caseById("discovery.json", "discovery")
    const { db } = createMigratedDb()
    const envelope = await toLocalJobApiRuntimeManifestEnvelope({
      db: db as never,
      probe: false,
      readinessDependencies: discoveryReadiness(input) as never,
    })
    expect(envelope.apiVersion).toBe("locus.local-job.v1")
    expect(envelope.features).toContain("runtime-readiness")
    expect(envelope.runtimes.length).toBeGreaterThan(0)
    for (const runtime of envelope.runtimes) {
      expect(input.expected.readinessStates).toContain(runtime.readiness.state)
    }
    expect(
      schemaValidator(
        localJobApiSchema(),
        "#/$defs/runtimeManifestEnvelope",
      )(envelope),
    ).toBe(true)
  })

  test("S54 Older build lacks the feature — an envelope without a feature identifier is a valid v1 discovery envelope and that addition reads as unsupported (green-by-design)", () => {
    const input = caseById("discovery.json", "discovery")
    const envelope = input.olderBuildEnvelope
    expect(
      schemaValidator(
        localJobApiSchema(),
        "#/$defs/runtimeManifestEnvelope",
      )(envelope),
    ).toBe(true)
    expect(envelope.features.includes(input.expected.ledgerFeature)).toBe(false)
    for (const feature of input.expected.existingFeatures) {
      expect(envelope.features.includes(feature)).toBe(true)
    }
  })

  test("S55 Consumer detects canonical ledger support — discovery advertises canonical-run-ledger alongside existing features and the documented runtime.codex.v1 extension declares schemaVersion=1 and experimental maturity", async () => {
    const input = caseById("discovery.json", "discovery")
    const { db } = createMigratedDb()
    const envelope = await toLocalJobApiRuntimeManifestEnvelope({
      db: db as never,
      probe: false,
      readinessDependencies: discoveryReadiness(input) as never,
    })
    for (const feature of input.expected.existingFeatures) {
      expect(envelope.features).toContain(feature)
    }
    expect(envelope.features).toContain(input.expected.ledgerFeature)
    expect([...LOCAL_JOB_API_DISCOVERY_FEATURES]).toContain(
      input.expected.ledgerFeature,
    )

    const schemaDocument = localJobApiSchema()
    expect(schemaDocument.$defs.discoveryFeature.enum).toContain(
      input.expected.ledgerFeature,
    )
    expect(
      schemaValidator(
        schemaDocument,
        "#/$defs/runtimeManifestEnvelope",
      )(envelope),
    ).toBe(true)

    const extensionSchemas = findPropertySchemas(
      schemaDocument,
      input.expected.extension.namespace,
    )
    expect(extensionSchemas.length).toBeGreaterThan(0)
    const emittedMetadata = caseById(
      "public-v1.json",
      "runtime-backed-extension",
    ).expected.extension
    for (const extensionSchema of extensionSchemas) {
      const properties = extensionSchema.properties ?? {}
      const schemaVersion = properties.schemaVersion ?? {}
      const maturity = properties.maturity ?? {}
      expect(
        schemaVersion.const === input.expected.extension.schemaVersion ||
          JSON.stringify(schemaVersion.enum) ===
            JSON.stringify([input.expected.extension.schemaVersion]),
      ).toBe(true)
      expect(
        maturity.const === input.expected.extension.maturity ||
          JSON.stringify(maturity.enum) ===
            JSON.stringify([input.expected.extension.maturity]),
      ).toBe(true)
    }
    expect(emittedMetadata.schemaVersion).toBe(
      input.expected.extension.schemaVersion,
    )
    expect(emittedMetadata.maturity).toBe(input.expected.extension.maturity)
  })
})

// ---------------------------------------------------------------------------
// headless-agent-jobs / Headless Runtime Event Convergence
// ---------------------------------------------------------------------------

describe("headless-agent-jobs / Headless Runtime Event Convergence", () => {
  test("S46 Batch process event is persisted — committed app-server records are consumed without a second observer append or an extra terminal mint", async () => {
    const input = caseById("headless-projection.json", "headless-projection")
    const appends: FixtureEvent[] = []
    const observer: AgentRuntimeObserver = {
      appendEvent(type, payload) {
        appends.push({ type, payload })
        return null as never
      },
      heartbeat() {
        return null as never
      },
      isCancelRequested() {
        return false
      },
      registerSecretHints() {},
    }
    const runner = createCodexAppServerHeadlessTaskRunner({
      createDesktopAdapter: () => ({
        metadata: {
          runtimeId: "codex",
          source: "codex-app-server",
          label: "Codex app-server adapter",
          temporaryFallback: false,
        } as never,
        async run(desktopRequest) {
          for (const record of input.appServer.committedRecords) {
            desktopRequest.trace.emit(structuredClone(record))
          }
          return structuredClone(input.appServer.desktopResult)
        },
      }),
    })
    const request = createAgentRuntimeRunRequest({
      jobId: input.appServer.request.jobId,
      runtime: input.appServer.request.runtime,
      cwd: input.appServer.request.cwd,
      mode: input.appServer.request.mode,
      source: input.appServer.request.source,
      executionProfile: input.appServer.request.executionProfile,
      policyGrant: input.appServer.request.policyGrant,
      prompt: input.appServer.request.prompt,
      signal: new AbortController().signal,
    })
    const result = await runner(request, observer)
    expect(result.status).toBe("succeeded")
    const reappended = appends.filter((append) =>
      input.appServer.committedRecords.some(
        (record: Json) =>
          record.type === append.type &&
          JSON.stringify(record.payload) === JSON.stringify(append.payload),
      ),
    )
    expect(reappended).toEqual([])
    expect(appends.filter((append) => append.type === "completed")).toEqual([])
  })

  test(
    "S46 Batch process event is persisted — coarse assistant/command/status/error/result observations enter the ledger once, each persisted with a fact key and record metadata and one completed",
    async () => {
      const { db, sqlite } = createMigratedDb()
      const { packageDir } = seedProject(db)
      const input = caseById("headless-projection.json", "headless-projection")
      const events = materialize(input.coarse.runnerEvents, {
        "<PROJECT_CWD>": packageDir,
      }) as FixtureEvent[]
      const out = await runCli(
        db,
        [
          "run",
          "--runtime",
          "codex",
          "--cwd",
          packageDir,
          "--output",
          "json",
          "--prompt",
          input.coarse.prompt,
        ],
        { runner: fixtureRunner(events, input.coarse.runnerResult) },
      )
      expect(out.code).toBe(0)
      const jobId = JSON.parse(out.stdout).job.id as string
      const rows = sqlite
        .query(
          "SELECT sequence, type, payload_json, fact_key, record_metadata_json FROM agent_job_events WHERE job_id = ? ORDER BY sequence",
        )
        .all(jobId) as Json[]
      expectContiguousFrom(
        rows.map((row) => row.sequence),
        1,
      )
      for (const row of rows) {
        expect(typeof row.fact_key).toBe("string")
        expect(row.fact_key.length).toBeGreaterThan(0)
        expect(isObject(JSON.parse(row.record_metadata_json))).toBe(true)
      }
      expect(rows.filter((row) => row.type === "completed")).toHaveLength(1)
      expect(
        rows.filter((row) => row.payload_json.includes("a.txt")),
      ).toHaveLength(1)
      expect(new Set(rows.map((row) => row.fact_key)).size).toBe(rows.length)
    },
    CLI_TEST_TIMEOUT_MS,
  )

  test(
    "S47 Existing event readers remain compatible — jobs logs and runs events return their documented envelopes in sequence with bare payloads while persisted rows retain record metadata",
    async () => {
      const { db, sqlite } = createMigratedDb()
      const { packageDir } = seedProject(db)
      const input = caseById("headless-projection.json", "headless-projection")
      const events = materialize(input.coarse.runnerEvents, {
        "<PROJECT_CWD>": packageDir,
      }) as FixtureEvent[]
      const cli = await runCli(
        db,
        [
          "run",
          "--runtime",
          "codex",
          "--cwd",
          packageDir,
          "--output",
          "json",
          "--prompt",
          input.coarse.prompt,
        ],
        { runner: fixtureRunner(events, input.coarse.runnerResult) },
      )
      expect(cli.code).toBe(0)
      const cliJobId = JSON.parse(cli.stdout).job.id as string
      const logs = await runCli(db, [
        "jobs",
        "logs",
        cliJobId,
        "--output",
        "json",
      ])
      expect(logs.code).toBe(0)
      const internal = JSON.parse(logs.stdout).events as Json[]
      expectContiguousFrom(
        internal.map((event) => event.sequence),
        1,
      )
      for (const event of internal) {
        for (const key of input.expected.internalEnvelopeKeys) {
          expect(Object.hasOwn(event, key)).toBe(true)
        }
        expect(event.jobId).toBe(cliJobId)
      }
      expect(wrapperKeyHits(internal, ["runEventSequence"])).toEqual([])

      const api = await createApiRun(
        db,
        materialize(input.apiReaderRequest, { "<PROJECT_CWD>": packageDir }),
        fixtureRunner(
          [{ type: "assistant_delta", payload: { text: "hello" } }],
          {
            status: "succeeded",
            exitCode: 0,
            result: { finalMessage: "hello" },
          },
        ),
      )
      expect(api.code).toBe(0)
      const apiJobId = api.created.job.id as string
      const v1 = (await readApiEvents(db, apiJobId, 0)).events
      expectContiguousFrom(
        v1.map((event) => event.sequence),
        1,
      )
      for (const event of v1) {
        expect(Object.keys(event).sort()).toEqual(input.expected.v1EnvelopeKeys)
      }
      expect(wrapperKeyHits(v1, input.expected.wrapperKeys)).toEqual([])

      for (const jobId of [cliJobId, apiJobId]) {
        const rows = sqlite
          .query(
            "SELECT record_metadata_json FROM agent_job_events WHERE job_id = ? ORDER BY sequence",
          )
          .all(jobId) as Json[]
        expect(rows.length).toBeGreaterThan(0)
        for (const row of rows) {
          expect(isObject(JSON.parse(row.record_metadata_json))).toBe(true)
        }
      }
    },
    CLI_TEST_TIMEOUT_MS,
  )
})

// ---------------------------------------------------------------------------
// desktop-agent-jobs / Desktop Jobs Persist Semantic Runtime Events
// ---------------------------------------------------------------------------

function workbenchEvent(record: Json) {
  return {
    id: `evt-${record.sequence}`,
    jobId: record.runId,
    sequence: record.sequence,
    type: record.type,
    payload: structuredClone(record.payload),
    createdAt: record.createdAt,
  }
}

describe("desktop-agent-jobs / Desktop Jobs Persist Semantic Runtime Events", () => {
  test("S44 Desktop stream emits semantic events — the live renderer projector consumes committed records and replaces the reconciled item instead of appending its final text again", async () => {
    const input = caseById("desktop-projection.json", "desktop-projection")
    const { projectRunEventToRendererChunks } = await importOwner(
      "src/main/lib/agent-runtime/stream-event-mapper.ts",
    )
    expect(typeof projectRunEventToRendererChunks).toBe("function")

    const projected = input.committedRecords.map((record: Json) => {
      const chunks = projectRunEventToRendererChunks(structuredClone(record))
      expect(Array.isArray(chunks)).toBe(true)
      return { record, chunks: chunks as Json[] }
    })
    const allChunks = projected.flatMap((entry: Json) => entry.chunks)
    for (const chunk of allChunks) {
      expect(isObject(chunk)).toBe(true)
      expect(JSON.stringify(chunk)).not.toContain("runEventSequence")
    }

    const reconciliation = projected.find(
      (entry: Json) =>
        entry.record.sequence === input.reconciliation.recordSequence,
    )
    expect(reconciliation.chunks.length).toBeGreaterThan(0)
    expect(JSON.stringify(reconciliation.chunks)).toContain(
      input.reconciliation.authoritativeText,
    )
    expect(
      reconciliation.chunks.filter(
        (chunk: Json) =>
          chunk.type === "text-delta" &&
          chunk.delta === input.reconciliation.authoritativeText,
      ),
    ).toEqual([])
    const concatenated = allChunks
      .filter((chunk: Json) => chunk.type === "text-delta")
      .map((chunk: Json) => chunk.delta)
      .join("")
    expect(concatenated).not.toContain(
      `${input.reconciliation.priorDeltaText}${input.reconciliation.authoritativeText}`,
    )
  })

  test("S44 Desktop stream emits semantic events — the Workbench persisted-event reader reads committed v1 records at their sequence with bare semantic payload, including the item_reconciliation carrier (green-by-design)", () => {
    const input = caseById("desktop-projection.json", "desktop-projection")
    for (const record of input.committedRecords) {
      const row = getWorkbenchTraceRow(workbenchEvent(record))
      expect(row.sequence).toBe(record.sequence)
      expect(row.type).toBe(record.type)
      expect(row.semanticPayload).toEqual(record.payload)
      expect(row.hasRawPayload).toBe(false)
    }
    const reconciliation = input.committedRecords.find(
      (record: Json) => record.sequence === input.reconciliation.recordSequence,
    )
    const row = getWorkbenchTraceRow(workbenchEvent(reconciliation))
    expect((row.semanticPayload as Json).item.text).toBe(
      input.reconciliation.authoritativeText,
    )
    expect((row.semanticPayload as Json).reconciliation).toEqual(
      reconciliation.payload.reconciliation,
    )
  })

  test("S45 Secret-like payload is observed — desktop writer and renderer projections receive only committed redacted records, never the raw sentinel input or exact secret hints", async () => {
    const input = caseById("desktop-projection.json", "desktop-projection")
    const { createCanonicalRunEventLedger } = await importOwner(
      "src/main/lib/agent-runtime/run-event-ledger.ts",
    )
    expect(typeof createCanonicalRunEventLedger).toBe("function")
    const store = createMemoryDurableStore(input.runId)
    const writer = recordingProjection("desktop-history", store, input.runId)
    const renderer = recordingProjection("desktop-renderer", store, input.runId)
    const ledger = createCanonicalRunEventLedger({
      runId: input.runId,
      runtimeId: input.runtimeId,
      source: "desktop",
      provenance: input.ingressOnly.runtimeProvenance,
      clock: fixedClock("2026-09-04T00:00:01.000Z"),
      redactionContext: { secretHints: [...input.ingressOnly.secretHints] },
      durableStore: store,
      projections: [writer.projection, renderer.projection],
      artifactOwner: {},
    })
    for (const observation of input.ingressOnly.observations) {
      await ledger[observation.port](structuredClone(observation.input))
    }

    const committed: Json[] = await ledger.read(0)
    expect(committed.length).toBeGreaterThanOrEqual(
      input.ingressOnly.observations.length,
    )
    expectContiguousFrom(
      committed.map((record) => record.sequence),
      1,
    )
    for (const projection of [writer, renderer]) {
      expect(projection.deliveries.length).toBeGreaterThan(0)
      for (const args of projection.deliveries) {
        expect(args).toHaveLength(1)
        expect(typeof (args[0] as Json).sequence).toBe("number")
      }
      const delivered = JSON.stringify(projection.deliveries)
      expect(delivered).not.toContain(input.ingressOnly.rawSentinel)
      for (const hint of input.ingressOnly.secretHints) {
        expect(delivered).not.toContain(hint)
      }
    }
    const everything = JSON.stringify({ committed, store: store.committed })
    expect(everything).not.toContain(input.ingressOnly.rawSentinel)
    for (const hint of input.ingressOnly.secretHints) {
      expect(everything).not.toContain(hint)
    }
  })

  test("S45 Secret-like payload is observed — the single versioned Workbench decoder unwraps a ledger_version=0 historical desktop wrapper row for display (green-by-design)", () => {
    const input = caseById("desktop-projection.json", "desktop-projection")
    const historical = input.historicalV0Row
    const row = getWorkbenchTraceRow({
      id: historical.id,
      jobId: historical.jobId,
      sequence: historical.sequence,
      type: historical.type,
      payload: structuredClone(historical.payload),
      createdAt: historical.createdAt,
    })
    expect(row.sequence).toBe(historical.sequence)
    expect(row.semanticPayload).toEqual(historical.expectedSemanticPayload)
    expect(row.rawPayload).toEqual(historical.payload)
    for (const key of WRAPPER_KEYS) {
      expect(Object.hasOwn(row.semanticPayload as object, key)).toBe(false)
    }
  })
})
