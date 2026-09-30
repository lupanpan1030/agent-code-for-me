/**
 * Implementer invariant test (refactor-canonical-run-event-ledger, Phase II
 * coordinator ruling): once every writer goes through the canonical ledger,
 * no path may append a record without a fact key or record metadata to a
 * ledger_version=1 job. One migrated database is driven through these
 * lifecycle writers: CLI run (fake runner), queued run + CLI cancel, API
 * create (agent with a run dir, and completion), API cancel and retry,
 * jobs-stdio run and cancel, desktop job creation, output, completion and
 * cancel (host ledger ports), a schedule fired now and drained by one daemon
 * pass, and jobs recovery of a confirmed-stopped worker. Every committed row
 * of a v1 job is then checked.
 *
 * Not driven here: the desktop renderer channel, the adapter-started fact
 * and the Codex app-server headless wrapper (they reach the same host ledger;
 * architecture:check enforces that run-event-ledger-host.ts is the only
 * importer of the store's exact batch writer, so every path is fact-keyed by
 * construction, and their own tests pin their records).
 */
import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough, Readable } from "node:stream"
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
    completionFetch: async () =>
      new Response(
        JSON.stringify({
          output_text: "completion done",
          usage: { input_tokens: 4, output_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
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
    expect(
      (await cli(db, ["api", "runs", "retry", queuedApi.id, "--json"])).code,
    ).toBe(0)

    // API completion create (the completion runner binds locus-completion
    // provenance and settles through the same ledger).
    db.insert(schema.agentProviderProfiles)
      .values({
        id: "completion-v1",
        name: "completion-v1",
        protocol: "openai-responses",
        baseUrl: "https://provider.example.com/v1",
        defaultModel: "provider-default-model",
        authMode: "none",
        encryptedToken: null,
        targetRuntimesJson: JSON.stringify(["codex"]),
        capabilitiesJson: "{}",
      })
      .run()
    const completion = await cli(
      db,
      ["api", "runs", "create", "--request", "-", "--json"],
      JSON.stringify({
        apiVersion: "locus.local-job.v1",
        kind: "completion",
        consumer: { id: "v1-invariant", runExternalId: "completion-1" },
        runtime: { id: "codex" },
        provider: { profileId: "completion-v1" },
        messages: [{ role: "user", content: "Return short text." }],
        responseFormat: { type: "text" },
      }),
    )
    expect(completion.code).toBe(0)
    expect(JSON.parse(completion.stdout).job).toMatchObject({
      kind: "completion",
      status: "succeeded",
    })

    // jobs-stdio: a protocol job run, then a cancel of that session's job.
    const stdio = await cli(
      db,
      ["jobs-stdio"],
      `${[
        {
          jsonrpc: "2.0",
          id: 1,
          method: "job.run",
          params: {
            runtime: "codex",
            mode: "agent",
            cwd: packageDir,
            prompt: "stdio run",
          },
        },
        { jsonrpc: "2.0", id: 3, method: "shutdown", params: {} },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n")}\n`,
    )
    expect(stdio.code).toBe(0)
    const stdioJobId = stdio.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .find((line) => line.id === 1)?.result.job.id as string
    expect(stdioJobId).toBeTruthy()
    // A second session cancels its own running protocol job.
    const stdin = new PassThrough()
    let stdioOut = ""
    let runAcknowledged: () => void = () => {}
    const acknowledged = new Promise<void>((resolve) => {
      runAcknowledged = resolve
    })
    const stdioSession = runHeadlessCliCommand({
      db: db as never,
      argv: ["Locus", HEADLESS_CLI_MARKER, "jobs-stdio"],
      stdin,
      stdout: {
        write(chunk: string) {
          stdioOut += chunk
          if (stdioOut.includes('"id":1')) runAcknowledged()
        },
      },
      stderr: { write: () => true },
      runner: async (request, observer) => {
        observer.appendEvent("assistant_delta", { text: "working" })
        await new Promise((resolve) => {
          if (request.signal.aborted) resolve(null)
          request.signal.addEventListener("abort", () => resolve(null), {
            once: true,
          })
        })
        return { status: "canceled", exitCode: 5 }
      },
    })
    stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "job.run",
        params: {
          runtime: "codex",
          mode: "agent",
          cwd: packageDir,
          prompt: "stdio cancel",
        },
      })}\n`,
    )
    await acknowledged
    const cancelJobId = JSON.parse(
      stdioOut
        .trim()
        .split("\n")
        .find((line) => line.includes('"id":1')) ?? "{}",
    ).result.job.id as string
    stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "job.cancel",
        params: { jobId: cancelJobId },
      })}\n${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "shutdown", params: {} })}\n`,
    )
    stdin.end()
    expect(await stdioSession).toBe(0)
    expect(
      sqlite
        .query("SELECT status FROM agent_jobs WHERE id = ?")
        .get(cancelJobId),
    ).toEqual({ status: "canceled" })

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
    // Exact counts: 12 v1 jobs (CLI run, queued CLI run, API agent create,
    // queued API run, its retry, API completion, two jobs-stdio jobs, two
    // desktop jobs, the schedule job, the recovered job); every one but the
    // desktop job whose cancel was only requested (still running) completed.
    expect(summary.jobs).toBe(12)
    expect(summary.completed).toBe(11)
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
