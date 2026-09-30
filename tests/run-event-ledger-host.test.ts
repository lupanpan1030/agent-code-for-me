/**
 * Implementer unit tests for the Phase I host composition of the canonical
 * run event ledger (refactor-canonical-run-event-ledger): the SQLite
 * job-store durableStore adapter behind getOrCreateRunEventLedger, the
 * transition gate and the v0 history guard. The acceptance scenarios live in
 * the immutable run-event-ledger-*.test.ts red suite.
 */
import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import {
  bindRunExecutionProvenance,
  canonicalRunEventLedgerV1,
  getOrCreateRunEventLedger,
  releaseRunEventLedger,
} from "../src/main/lib/agent-runtime/run-event-ledger-host"
import * as schema from "../src/main/lib/db/schema"
import { createAgentJob } from "../src/main/lib/headless/job-store"

const RUNTIME = {
  kind: "runtime",
  installationId: "inst-codex-0.139.0-linux-x64-host-test",
  runtimeId: "codex",
  adapterSource: "codex-app-server",
  version: "0.139.0",
  executableRef: "exe-host-test",
  binarySha256: "a".repeat(64),
  protocolName: "codex-app-server-jsonrpc",
  protocolVersion: "v2",
  schemaFiles: [{ path: "ServerNotification.ts", sha256: "b".repeat(64) }],
} as const

const databases: Database[] = []
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
})

function migratedDb() {
  const sqlite = new Database(":memory:")
  sqlite.exec("PRAGMA foreign_keys = ON")
  databases.push(sqlite)
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: join(import.meta.dir, "..", "drizzle") })
  return { sqlite, db }
}

function rows(sqlite: Database, jobId: string) {
  return sqlite
    .query(
      "SELECT sequence, type, fact_key, record_metadata_json, payload_json FROM agent_job_events WHERE job_id = ? ORDER BY sequence",
    )
    .all(jobId) as Array<{
    sequence: number
    type: string
    fact_key: string | null
    record_metadata_json: string | null
    payload_json: string
  }>
}

function job(sqlite: Database, jobId: string) {
  return sqlite
    .query(
      "SELECT status, ledger_version, ledger_provenance_json, ledger_sealed_sequence, worker_id FROM agent_jobs WHERE id = ?",
    )
    .get(jobId) as {
    status: string
    ledger_version: number
    ledger_provenance_json: string | null
    ledger_sealed_sequence: number | null
    worker_id: string | null
  }
}

describe("run event ledger host (Phase I transition)", () => {
  test("the build-time gate keeps every inventory caller on the legacy path", () => {
    expect(canonicalRunEventLedgerV1).toBe(false)
  })

  test("the SQLite adapter commits exact batches with fact keys, binds provenance once, settles one completed and persists projection cursors", async () => {
    const { sqlite, db } = migratedDb()
    const created = createAgentJob(db as never, {
      source: "cli",
      runtime: "codex",
      mode: "plan",
      cwd: process.cwd(),
      prompt: "host adapter",
    })
    const delivered: number[] = []
    const ledger = await getOrCreateRunEventLedger(db as never, created, {
      projections: [
        {
          name: "host-test",
          deliver: (record) => {
            delivered.push(Number(record.sequence))
          },
        },
      ],
    })
    expect(await getOrCreateRunEventLedger(db as never, created)).toBe(ledger)

    await ledger.appendSystemEvent({
      observationKey: "host-start",
      type: "job_started",
      payload: { workerId: "worker-host", workerPid: null },
    })
    expect(job(sqlite, created.id)).toMatchObject({
      status: "running",
      ledger_version: 1,
      ledger_provenance_json: null,
      worker_id: "worker-host",
    })
    const started = rows(sqlite, created.id).at(-1)
    expect(started?.fact_key).toBe("host-start:0")
    expect(started?.record_metadata_json).toContain("pending")

    await bindRunExecutionProvenance(ledger, RUNTIME)
    await ledger.ingestNotification({
      observationKey: "host-turn",
      transportId: "t1",
      receivedAt: "2026-09-04T00:00:00.000Z",
      message: {
        method: "turn/started",
        params: {
          threadId: "th",
          turn: { id: "tu", items: [], status: "inProgress", error: null },
        },
      },
    })
    expect(job(sqlite, created.id).ledger_provenance_json).toContain(
      RUNTIME.binarySha256,
    )
    expect(rows(sqlite, created.id).at(-1)?.record_metadata_json).toContain(
      RUNTIME.installationId,
    )

    const evidence = {
      trigger: {
        kind: "host_result" as const,
        status: "succeeded" as const,
        observationKey: "host-result",
      },
      policy: { denied: false, evidenceKeys: [] },
      output: {
        valid: true,
        empty: false,
        allowEmpty: false,
        evidenceKeys: ["output:host"],
      },
      postRun: { credentialsSafe: true, evidenceKeys: [] },
    }
    await ledger.settle(evidence)
    const before = rows(sqlite, created.id).length
    await ledger.settle(evidence)
    const committed = rows(sqlite, created.id)
    expect(committed).toHaveLength(before)
    const completed = committed.filter((row) => row.type === "completed")
    expect(completed).toHaveLength(1)
    expect(job(sqlite, created.id)).toMatchObject({
      status: "succeeded",
      ledger_sealed_sequence: completed[0].sequence,
    })
    expect(committed.map((row) => row.sequence)).toEqual(
      committed.map((_, index) => index + 1),
    )
    expect(delivered).toEqual(
      committed.map((row) => row.sequence).filter((sequence) => sequence > 0),
    )
    expect(await ledger.readOutcome()).toMatchObject({ status: "succeeded" })

    releaseRunEventLedger(db as never, created.id)
    const reopened = await getOrCreateRunEventLedger(db as never, created)
    expect(reopened).not.toBe(ledger)
    expect(await reopened.readOutcome()).toMatchObject({
      status: "succeeded",
      completedSequence: completed[0].sequence,
    })
  })

  test("a projection cursor is acknowledged in agent_job_projection_cursors", async () => {
    const { sqlite, db } = migratedDb()
    const created = createAgentJob(db as never, {
      source: "api",
      runtime: "codex",
      mode: "plan",
      cwd: process.cwd(),
      prompt: "cursor",
    })
    const ledger = await getOrCreateRunEventLedger(db as never, created, {
      projections: [
        {
          name: "host-cursor",
          deliver: () => undefined,
        },
      ],
    })
    await ledger.appendSystemEvent({
      observationKey: "cursor-status",
      type: "status",
      payload: { status: "runtime_selected", runtime: "codex" },
    })
    expect(
      sqlite
        .query(
          "SELECT acknowledged_sequence FROM agent_job_projection_cursors WHERE job_id = ?",
        )
        .get(created.id),
    ).toEqual({ acknowledged_sequence: rows(sqlite, created.id).length })
  })

  test("pre-ledger (ledger_version=0) history is never extended", async () => {
    const { sqlite, db } = migratedDb()
    sqlite
      .query(
        "INSERT INTO agent_jobs (id, source, runtime, cwd, status, ledger_version) VALUES ('legacy-job', 'cli', 'codex', '/fixture', 'running', 0)",
      )
      .run()
    await expect(
      getOrCreateRunEventLedger(db as never, { id: "legacy-job" }),
    ).rejects.toThrow("pre-ledger history")
  })
})
