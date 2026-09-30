/**
 * Implementer invariant test (refactor-canonical-run-event-ledger, Phase II
 * coordinator ruling): once every writer goes through the canonical ledger,
 * no path may append a record without a fact key or record metadata to a
 * ledger_version=1 job. One migrated database is driven through every
 * lifecycle writer that exists today — CLI run (fake runner), queued run +
 * cancel, API create (agent and completion) and retry, desktop job creation,
 * completion and cancel, schedules, jobs recovery (confirmed-stopped worker)
 * and the daemon — and every committed row of a v1 job is then checked.
 */
import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { getOrCreateRunEventLedger } from "../src/main/lib/agent-runtime/run-event-ledger-host"
import * as schema from "../src/main/lib/db/schema"
import {
  completeDesktopChatAgentJobSafely,
  createAndStartDesktopAgentJob,
  requestCancelDesktopAgentJob,
} from "../src/main/lib/desktop-agent-jobs"
import { HEADLESS_CLI_MARKER } from "../src/main/lib/headless/cli-args"
import { runHeadlessCliCommand } from "../src/main/lib/headless/cli-dispatcher"
import { runLocalAgentDaemon } from "../src/main/lib/headless/daemon"
import { recoverStaleAgentJobs } from "../src/main/lib/headless/job-recovery"
import {
  createAgentJob,
  startAgentJob,
} from "../src/main/lib/headless/job-store"
import {
  createAgentSchedule,
  runAgentScheduleNow,
} from "../src/main/lib/headless/schedules"

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

function migratedDb() {
  const sqlite = new Database(":memory:")
  sqlite.exec("PRAGMA foreign_keys = ON")
  cleanups.push(() => sqlite.close())
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: join(import.meta.dir, "..", "drizzle") })
  return { sqlite, db }
}

function seedWorkspace(db: ReturnType<typeof migratedDb>["db"]) {
  const projectRoot = realpathSync(
    mkdtempSync(join(tmpdir(), "ledger-v1-fact-keys-")),
  )
  cleanups.push(() => rmSync(projectRoot, { recursive: true, force: true }))
  const packageDir = join(projectRoot, "pkg")
  mkdirSync(packageDir)
  db.insert(schema.projects)
    .values({ id: "project-v1", name: "V1", path: projectRoot })
    .run()
  db.insert(schema.chats)
    .values({
      id: "chat-v1",
      projectId: "project-v1",
      worktreePath: packageDir,
    })
    .run()
  db.insert(schema.subChats)
    .values({ id: "sub-chat-v1", chatId: "chat-v1" })
    .run()
  return { projectRoot, packageDir: realpathSync(packageDir) }
}

async function cli(
  db: ReturnType<typeof migratedDb>["db"],
  argv: string[],
  stdin?: string,
) {
  let stdout = ""
  const code = await runHeadlessCliCommand({
    db: db as never,
    argv: ["Locus", HEADLESS_CLI_MARKER, ...argv],
    stdin: stdin === undefined ? undefined : Readable.from([stdin]),
    stdout: {
      write(chunk: string) {
        stdout += chunk
      },
    },
    stderr: { write: () => true },
    env: { LOCUS_HEADLESS_FAKE_RUNNER: "1" },
    appVersion: "0.0.test",
  })
  return { code, stdout }
}

describe("canonical run event ledger v1 fact-key invariant", () => {
  test("every lifecycle writer leaves only fact-keyed, metadata-bearing rows on ledger_version=1 jobs", async () => {
    const { sqlite, db } = migratedDb()
    const { packageDir } = seedWorkspace(db)

    // CLI run through the fake runner, queued daemon run + cancel.
    expect(
      (
        await cli(db, [
          "run",
          "--runtime",
          "codex",
          "--cwd",
          packageDir,
          "--prompt",
          "run",
        ])
      ).code,
    ).toBe(0)
    const queued = await cli(db, [
      "run",
      "--daemon",
      "--runtime",
      "codex",
      "--cwd",
      packageDir,
      "--output",
      "json",
      "--prompt",
      "queued",
    ])
    const queuedId = JSON.parse(queued.stdout).job.id as string
    expect((await cli(db, ["jobs", "cancel", queuedId])).code).toBe(0)

    // API create (with a run dir) and retry of a canceled API run.
    const apiCreate = await cli(
      db,
      ["api", "runs", "create", "--request", "-", "--json"],
      JSON.stringify({
        apiVersion: "locus.local-job.v1",
        consumer: { id: "v1-invariant", runExternalId: "api-1" },
        project: { cwd: packageDir },
        runtime: { id: "codex" },
        mode: "agent",
        prompt: { text: "api run" },
        artifacts: {
          baseDir: join(packageDir, ".locus", "runs"),
          writePolicy: "metadata-only",
        },
      }),
    )
    expect(apiCreate.code).toBe(0)
    const apiJobId = JSON.parse(apiCreate.stdout).job.id as string
    const queuedApi = await createAgentJob(db as never, {
      source: "api",
      runtime: "codex",
      mode: "agent",
      cwd: packageDir,
      prompt: "api queued",
      input: {
        apiVersion: "locus.local-job.v1",
        consumer: { id: "v1-invariant", runExternalId: "api-2" },
        project: { cwd: packageDir },
        runtime: { id: "codex" },
        mode: "agent",
        prompt: "api queued",
        artifacts: { baseDir: null, writePolicy: "metadata-only" },
      },
      projectId: "project-v1",
      apiConsumerId: "v1-invariant",
    })
    expect(
      (await cli(db, ["api", "runs", "cancel", queuedApi.id, "--json"])).code,
    ).toBe(0)
    await cli(db, ["api", "runs", "retry", queuedApi.id, "--json"])

    // Desktop job: created, started, one output, completed; a second one
    // canceled while running.
    const desktop = await createAndStartDesktopAgentJob(db as never, {
      runtime: "codex",
      mode: "plan",
      chatId: "chat-v1",
      subChatId: "sub-chat-v1",
      cwd: packageDir,
      prompt: "desktop",
      runId: "run-desktop-v1",
    })
    const desktopLedger = await getOrCreateRunEventLedger(
      db as never,
      desktop.job,
    )
    await desktopLedger.ingestRuntimeObservation({
      observationKey: "desktop-output",
      type: "assistant_delta",
      payload: { text: "done" },
    })
    await completeDesktopChatAgentJobSafely(db as never, {
      jobId: desktop.job.id,
      runtime: "codex",
      aborted: false,
      reachedNaturalFinish: true,
      sawError: false,
    })
    const desktopCanceled = await createAndStartDesktopAgentJob(db as never, {
      runtime: "claude-code",
      mode: "agent",
      chatId: "chat-v1",
      subChatId: "sub-chat-v1",
      cwd: packageDir,
      prompt: "desktop cancel",
      runId: "run-desktop-cancel-v1",
    })
    await requestCancelDesktopAgentJob(
      db as never,
      desktopCanceled.job.id,
      "desktop",
    )

    // Schedule fired now, then drained by one daemon pass.
    const schedule = createAgentSchedule(db as never, {
      name: "v1",
      cwd: packageDir,
      runtime: "codex",
      mode: "plan",
      prompt: "scheduled",
      intervalSeconds: 3600,
    })
    await runAgentScheduleNow(db as never, schedule.id)
    await runLocalAgentDaemon({
      db: db as never,
      env: { LOCUS_HEADLESS_FAKE_RUNNER: "1" },
      once: true,
    })

    // A claimed job whose worker process is gone is recovered.
    const orphan = await createAgentJob(db as never, {
      source: "cli",
      runtime: "codex",
      mode: "plan",
      cwd: packageDir,
      prompt: "orphan",
    })
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid
    await startAgentJob(db as never, {
      jobId: orphan.id,
      workerId: `headless:${deadPid}:1:${orphan.id}`,
      workerPid: deadPid,
      now: new Date(Date.now() - 10 * 60_000),
    })
    const recovered = await recoverStaleAgentJobs(db as never, new Date())
    expect(recovered.map((job) => job.id)).toContain(orphan.id)

    const offending = sqlite
      .query(
        `SELECT j.id AS job_id, e.sequence, e.type
           FROM agent_job_events e
           JOIN agent_jobs j ON j.id = e.job_id
          WHERE j.ledger_version = 1
            AND (e.fact_key IS NULL OR e.fact_key = ''
                 OR e.record_metadata_json IS NULL)`,
      )
      .all()
    expect(offending).toEqual([])

    const summary = sqlite
      .query(
        `SELECT count(DISTINCT j.id) AS jobs, count(e.id) AS rows,
                sum(CASE WHEN e.type = 'completed' THEN 1 ELSE 0 END) AS completed
           FROM agent_jobs j JOIN agent_job_events e ON e.job_id = j.id
          WHERE j.ledger_version = 1`,
      )
      .get() as { jobs: number; rows: number; completed: number }
    expect(summary.jobs).toBeGreaterThanOrEqual(9)
    expect(summary.completed).toBeGreaterThanOrEqual(7)
    expect(
      sqlite
        .query(
          "SELECT count(*) AS count FROM agent_jobs WHERE ledger_version <> 1",
        )
        .get(),
    ).toEqual({ count: 0 })
    expect(apiJobId).toBeTruthy()
  })
})
