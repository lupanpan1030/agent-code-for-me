/**
 * Implementer unit tests for the internal `historyQuality` read metadata
 * (refactor-canonical-run-event-ledger, design "Migration Plan"; core
 * scenario "Historical rows remain explicitly unverified"): pre-ledger
 * (`ledger_version=0`) jobs read as `legacy_unverified` through the store
 * header and the Workbench read, ledger (v1) jobs read as `ledger`, and no
 * public job/result/event envelope carries the field. The acceptance half of
 * S13 lives in the immutable run-event-ledger-guards.test.ts.
 */
import { Database } from "bun:sqlite"
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import * as schema from "../src/main/lib/db/schema"

type Json = Record<string, unknown>
type LegacyEventRow = {
  id: string
  job_id: string
  sequence: number
  type: string
  payload_json: string
}
type LegacyStoreCase = {
  caseId: string
  lastPreLedgerMigrationIdx: number
  jobs: Json[]
  events: LegacyEventRow[]
  expected: { historyQuality: string }
}

const REPO_ROOT = join(import.meta.dir, "..")
const MIGRATIONS_DIR = join(REPO_ROOT, "drizzle")
const LEGACY_STORE = JSON.parse(
  readFileSync(
    join(import.meta.dir, "fixtures/run-event-ledger/legacy-store.json"),
    "utf8",
  ),
).cases.find(
  (entry: LegacyStoreCase) => entry.caseId === "legacy-migration",
) as LegacyStoreCase

let currentDb: ReturnType<typeof drizzle> | null = null
const opened: Database[] = []

mock.module("electron", () => ({
  BrowserWindow: class BrowserWindow {},
}))
mock.module("../src/main/lib/db", () => ({
  ...schema,
  getDatabase: () => currentDb,
}))

const { agentJobsRouter } = await import(
  "../src/main/lib/trpc/routers/agent-jobs"
)
const {
  createAgentJob,
  getAgentJob,
  listAgentJobEvents,
  readRunEventLedgerHeader,
  runEventHistoryQuality,
} = await import("../src/main/lib/headless/job-store")
const { serializeAgentJob, serializeAgentJobEvent } = await import(
  "../src/main/lib/headless/cli-output"
)
const {
  toLocalJobApiEventEnvelope,
  toLocalJobApiJobEnvelope,
  toLocalJobApiResultEnvelope,
} = await import("../src/main/lib/headless/local-job-api")
const { getWorkbenchTraceRow, withWorkbenchHistoryQuality } = await import(
  "../src/renderer/features/agents/workbench/workbench-trace-presenter"
)

afterEach(() => {
  currentDb = null
  while (opened.length > 0) opened.pop()?.close()
})

function stagedMigrationFolder(lastIdx: number): string {
  const folder = mkdtempSync(join(tmpdir(), "history-quality-migrations-"))
  cpSync(MIGRATIONS_DIR, folder, { recursive: true })
  const journalPath = join(folder, "meta/_journal.json")
  const journal = JSON.parse(readFileSync(journalPath, "utf8"))
  journal.entries = journal.entries.filter(
    (entry: { idx: number }) => entry.idx <= lastIdx,
  )
  writeFileSync(journalPath, JSON.stringify(journal))
  return folder
}

function insertRow(sqlite: Database, table: string, row: Json) {
  const columns = Object.keys(row)
  sqlite
    .query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns
        .map(() => "?")
        .join(", ")})`,
    )
    .run(...(Object.values(row) as never[]))
}

/** The pre-ledger store of legacy-store.json, then every later migration. */
function migratedLegacyStore() {
  const sqlite = new Database(":memory:")
  opened.push(sqlite)
  sqlite.exec("PRAGMA foreign_keys = ON")
  const db = drizzle(sqlite, { schema })
  migrate(db, {
    migrationsFolder: stagedMigrationFolder(
      LEGACY_STORE.lastPreLedgerMigrationIdx,
    ),
  })
  for (const job of LEGACY_STORE.jobs) insertRow(sqlite, "agent_jobs", job)
  for (const event of LEGACY_STORE.events) {
    insertRow(sqlite, "agent_job_events", event)
  }
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  currentDb = db
  return { sqlite, db }
}

describe("run event ledger internal history quality", () => {
  test("the store header reads every migrated legacy job as ledger_version 0 / legacy_unverified and a new job as ledger", async () => {
    const { db } = migratedLegacyStore()
    const legacyIds = LEGACY_STORE.jobs.map((job) => String(job.id))
    expect(legacyIds.length).toBeGreaterThan(0)
    for (const jobId of legacyIds) {
      expect(readRunEventLedgerHeader(db as never, jobId)).toMatchObject({
        jobId,
        ledgerVersion: 0,
        historyQuality: LEGACY_STORE.expected.historyQuality,
      })
    }
    const created = await createAgentJob(db as never, {
      source: "cli",
      runtime: "codex",
      mode: "plan",
      cwd: process.cwd(),
      prompt: "history quality",
    })
    expect(readRunEventLedgerHeader(db as never, created.id)).toMatchObject({
      ledgerVersion: 1,
      historyQuality: "ledger",
    })
    expect(runEventHistoryQuality({ ledgerVersion: 0 })).toBe(
      "legacy_unverified",
    )
    expect(runEventHistoryQuality({ ledgerVersion: 1 })).toBe("ledger")
  })

  test("the Workbench read (tRPC agentJobs.logs) carries historyQuality beside the job and events, never inside a job or event envelope", async () => {
    const { db } = migratedLegacyStore()
    const caller = agentJobsRouter.createCaller({
      getWindow: () => null,
    } as never)
    const legacy = await caller.logs({
      jobId: "job-legacy-desktop",
      afterSequence: 0,
    })
    expect(legacy.historyQuality).toBe("legacy_unverified")
    expect(Object.hasOwn(legacy.job, "historyQuality")).toBe(false)
    expect(
      legacy.events.some((event) => Object.hasOwn(event, "historyQuality")),
    ).toBe(false)

    const created = await createAgentJob(db as never, {
      source: "cli",
      runtime: "codex",
      mode: "plan",
      cwd: process.cwd(),
      prompt: "history quality v1",
    })
    const current = await caller.logs({ jobId: created.id, afterSequence: 0 })
    expect(current.historyQuality).toBe("ledger")
  })

  test("the single Workbench reader unwraps only legacy_unverified wrapper rows; a ledger row with a wrapper-shaped bare payload stays bare", () => {
    const legacyWrapper = LEGACY_STORE.events.find(
      (event) =>
        event.job_id === "job-legacy-desktop" &&
        event.type === "assistant_delta",
    )
    if (!legacyWrapper) throw new Error("legacy-store.json lacks the wrapper")
    const wrapperPayload = JSON.parse(legacyWrapper.payload_json) as Json
    const [legacyEvent] = withWorkbenchHistoryQuality(
      [
        {
          id: legacyWrapper.id,
          jobId: legacyWrapper.job_id,
          sequence: legacyWrapper.sequence,
          type: legacyWrapper.type,
          payload: wrapperPayload,
          createdAt: null,
        },
      ],
      "legacy_unverified",
    )
    const legacyRow = getWorkbenchTraceRow(legacyEvent)
    expect(legacyRow.historyQuality).toBe("legacy_unverified")
    expect(legacyRow.semanticPayload).toEqual(wrapperPayload.payload)
    expect(legacyRow.hasRawPayload).toBe(true)

    // A committed v1 record is bare; a runtime payload that merely looks like
    // the historical wrapper must not be unwrapped.
    const [ledgerEvent] = withWorkbenchHistoryQuality(
      [
        {
          id: "v1-3",
          jobId: "job-v1",
          sequence: 3,
          type: "status",
          payload: wrapperPayload,
          createdAt: null,
        },
      ],
      "ledger",
    )
    const ledgerRow = getWorkbenchTraceRow(ledgerEvent)
    expect(ledgerRow.historyQuality).toBe("ledger")
    expect(ledgerRow.semanticPayload).toBe(ledgerEvent.payload)
    expect(ledgerRow.hasRawPayload).toBe(false)

    // Without the store metadata the stamp is a no-op.
    expect(withWorkbenchHistoryQuality([ledgerEvent], null)).toEqual([
      ledgerEvent,
    ])
    expect(withWorkbenchHistoryQuality(undefined, "ledger")).toEqual([])
  })

  test("no public or protocol serializer of a legacy job emits historyQuality", () => {
    const { db } = migratedLegacyStore()
    for (const jobId of ["job-legacy-api", "job-legacy-desktop"]) {
      const job = getAgentJob(db as never, jobId)
      expect(job?.ledgerVersion).toBe(0)
      if (!job) continue
      const events = listAgentJobEvents(db as never, jobId)
      const surfaces = [
        serializeAgentJob(job),
        events.map(serializeAgentJobEvent),
        toLocalJobApiJobEnvelope(job),
        toLocalJobApiResultEnvelope(job, [], events),
        events.map(toLocalJobApiEventEnvelope),
      ]
      for (const surface of surfaces) {
        const text = JSON.stringify(surface)
        expect(text).not.toContain("historyQuality")
        expect(text).not.toContain("legacy_unverified")
      }
    }
  })
})
