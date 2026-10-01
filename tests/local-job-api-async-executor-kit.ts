/** biome-ignore-all lint/suspicious/noExplicitAny: the async-submit executor contract under test does not exist yet; envelopes and rows are asserted structurally. */
/**
 * Test harness for the executor / durability domain of the red suite of
 * `openspec/changes/add-local-job-api-async-submit` (S26, S27, S28, S36–S46).
 *
 * Test infrastructure only, never product code:
 *
 * - CLI interaction goes through the existing in-process entry point
 *   `runHeadlessCliCommand` + `HEADLESS_CLI_MARKER` with an injected
 *   database, stdin/stdout/stderr and a controlled runner, as
 *   `tests/headless-cli-dispatcher.test.ts` does today.
 * - Profiles are temporary file-backed SQLite databases built from the
 *   repository's real Drizzle migrations through `createMigratedLedgerDb`
 *   (tests/run-event-ledger-domain-b-kit.ts, reused by import), so the
 *   implementing change's additive reservation migration is exercised and a
 *   second connection or a second OS process can open the same profile.
 * - Cross-process scenarios (S27/S36/S37/S38/S40) run this same kit in a
 *   child process (`bun -e <bootstrap> <role> <args>`, see
 *   childBootstrapSource),
 *   sharing only the DB file and the run directory: no memory, no receipts
 *   map, no file descriptors.
 * - Fault points are injected inside the child process only:
 *     * database: Drizzle's `logger.logQuery` hook (called immediately before
 *       each statement executes) either SIGKILLs the child exactly before the
 *       first `artifact_created` insert, i.e. after the committed
 *       `job_created` and before `lifecycle:initial-artifacts:<id>:0` (S38),
 *       or freezes the worker right before its terminal `completed` insert,
 *       i.e. after every terminal file was staged and before the SQL commit
 *       (S27). A frozen worker stays a confirmed-alive process, excluding the
 *       independent recovery trigger (S27 GIVEN).
 *     * filesystem: `fs.renameSync` is wrapped by the child bootstrap BEFORE
 *       this kit or any product module is linked, so the worker freezes
 *       before its N-th final publish rename (a rename whose target is a
 *       final run-dir file name) after the terminal commit.
 * - Runtime work is a controlled fake `AgentTaskRunner` (or the real Codex
 *   headless adapter with an injected process seam for the S40 env capture);
 *   completion work is a fake `fetch`. No real runtime, credential or network.
 *
 * No product module is imported statically: role code must be able to wrap
 * `fs` before the product graph loads, and a missing future export must fail
 * inside the test that needs it, never at file load.
 */
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { drizzle } from "drizzle-orm/bun-sqlite"
import * as schema from "../src/main/lib/db/schema"
import {
  createMigratedLedgerDb,
  type MigratedLedgerDb,
} from "./run-event-ledger-domain-b-kit"

export const KIT_PATH = import.meta.path
export const FIXTURE_DIR = join(
  import.meta.dir,
  "fixtures",
  "local-job-api-async",
  "executor",
)
export const API_VERSION = "locus.local-job.v1"
export const HEADLESS_MARKER_ARG = "--locus-headless-cli"
export const THIRTY_DAYS_MS = 2_592_000_000
export const MAX_QUEUED_API_AGE_MS_DEFAULT = 86_400_000
export const RECOVERY_STALE_MS = 120_000

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export function loadFixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as T
}

export function fixtureCase<T = any>(file: string, caseId: string): T {
  const fixture = loadFixture(file)
  if (fixture.fixtureVersion !== 1) {
    throw new Error(`${file}: unsupported fixtureVersion`)
  }
  const value = fixture.cases?.[caseId]
  if (!value) throw new Error(`${file}: missing case ${caseId}`)
  return value as T
}

// ---------------------------------------------------------------------------
// Profiles (temporary DB + registered project + run-dir base)
// ---------------------------------------------------------------------------

export type ExecutorProfile = {
  root: string
  dbFile: string
  mdb: MigratedLedgerDb
  db: any
  sqlite: Database
  markerDir: string
  projects: Map<string, ProjectFixture>
  addProject: (name: string) => ProjectFixture
  cleanup: () => void
}

export type ProjectFixture = {
  id: string
  projectRoot: string
  packageDir: string
  artifactBaseDir: string
}

/** One isolated profile: its own migrated DB file, project roots, markers. */
export function createExecutorProfile(): ExecutorProfile {
  const mdb = createMigratedLedgerDb()
  const root = realpathSync(mkdtempSync(join(tmpdir(), "locus-async-exec-")))
  const markerDir = join(root, "markers")
  mkdirSync(markerDir, { recursive: true })
  const projects = new Map<string, ProjectFixture>()
  const profile: ExecutorProfile = {
    root,
    dbFile: mdb.file,
    mdb,
    db: mdb.db,
    sqlite: mdb.sqlite,
    markerDir,
    projects,
    addProject(name: string) {
      const projectRoot = join(root, `project-${name}`)
      const packageDir = join(projectRoot, "pkg")
      mkdirSync(packageDir, { recursive: true })
      const id = `project-${name}`
      mdb.sqlite
        .query("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)")
        .run(id, `Project ${name}`, projectRoot)
      const fixture = {
        id,
        projectRoot,
        packageDir,
        artifactBaseDir: join(packageDir, ".locus", "runs"),
      }
      projects.set(name, fixture)
      return fixture
    },
    cleanup() {
      for (const child of liveChildren.splice(0)) child.kill(9)
      mdb.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
  return profile
}

export function seedProviderProfile(
  profile: ExecutorProfile,
  input: { id: string; targets: string[]; baseUrl?: string },
): void {
  profile.sqlite
    .query(
      `INSERT INTO agent_provider_profiles
        (id, name, protocol, base_url, default_model, auth_mode, encrypted_token,
         target_runtimes_json, capabilities_json)
       VALUES (?, ?, 'openai-responses', ?, 'provider-default-model', 'none', NULL, ?, '{}')`,
    )
    .run(
      input.id,
      input.id,
      input.baseUrl ?? "https://provider.example.com/v1",
      JSON.stringify(input.targets),
    )
}

/** Opens another connection on the same DB file (another "process"). */
export function openDbFile(
  file: string,
  logger?: any,
): { sqlite: Database; db: any } {
  const sqlite = new Database(file)
  sqlite.exec("PRAGMA journal_mode = WAL")
  sqlite.exec("PRAGMA busy_timeout = 5000")
  sqlite.exec("PRAGMA foreign_keys = ON")
  return {
    sqlite,
    db: drizzle(sqlite, logger ? { schema, logger } : { schema }),
  }
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export function agentRequest(input: {
  project: ProjectFixture
  consumerId: string
  runExternalId?: string
  prompt?: string
  artifacts?: boolean
  idempotencyKey?: string
  runtime?: Record<string, unknown>
  provider?: Record<string, unknown>
  mode?: "plan" | "agent"
}): Record<string, unknown> {
  return {
    apiVersion: API_VERSION,
    consumer: {
      id: input.consumerId,
      ...(input.runExternalId ? { runExternalId: input.runExternalId } : {}),
    },
    project: { cwd: input.project.packageDir },
    runtime: input.runtime ?? { id: "codex" },
    ...(input.provider ? { provider: input.provider } : {}),
    mode: input.mode ?? "plan",
    prompt: { text: input.prompt ?? "Executor fixture work." },
    ...(input.artifacts
      ? {
          artifacts: {
            baseDir: input.project.artifactBaseDir,
            writePolicy: "metadata-only",
          },
        }
      : {}),
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
  }
}

export function completionRequest(input: {
  consumerId: string
  profileId: string
  idempotencyKey?: string
}): Record<string, unknown> {
  return {
    apiVersion: API_VERSION,
    kind: "completion",
    consumer: { id: input.consumerId },
    runtime: { id: "codex" },
    provider: { profileId: input.profileId, model: "provider-model" },
    messages: [{ role: "user", content: "Return short text." }],
    responseFormat: { type: "text" },
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
  }
}

// ---------------------------------------------------------------------------
// In-process CLI and runners
// ---------------------------------------------------------------------------

export type CliResult = { code: number; stdout: string; stderr: string }

function bufferWriter() {
  let value = ""
  return {
    stream: {
      write(chunk: string) {
        value += chunk
        return true
      },
    },
    value: () => value,
  }
}

/**
 * Runs one `locus ...` command in-process. `args` follow the marker, e.g.
 * `["api", "runs", "submit", "--request", "-", "--json"]`.
 */
export async function cli(
  db: any,
  args: string[],
  options: {
    stdin?: string
    runner?: any
    env?: NodeJS.ProcessEnv
    now?: Date
    completionFetch?: any
    providerBindingDependencies?: any
    daemonLockPath?: string | null
  } = {},
): Promise<CliResult> {
  const { runHeadlessCliCommand } = await import(
    "../src/main/lib/headless/cli-dispatcher"
  )
  const stdout = bufferWriter()
  const stderr = bufferWriter()
  const code = await runHeadlessCliCommand({
    db,
    argv: ["Locus", HEADLESS_MARKER_ARG, ...args],
    stdin:
      options.stdin === undefined ? undefined : Readable.from([options.stdin]),
    stdout: stdout.stream,
    stderr: stderr.stream,
    env: options.env ?? {},
    appVersion: "0.0.executor-red",
    ...(options.runner ? { runner: options.runner } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.completionFetch
      ? { completionFetch: options.completionFetch }
      : {}),
    ...(options.providerBindingDependencies
      ? { providerBindingDependencies: options.providerBindingDependencies }
      : {}),
    ...(options.daemonLockPath !== undefined
      ? { daemonLockPath: options.daemonLockPath }
      : {}),
  } as any)
  return { code, stdout: stdout.value(), stderr: stderr.value() }
}

export async function submit(
  db: any,
  request: Record<string, unknown>,
  options: Parameters<typeof cli>[2] = {},
): Promise<CliResult & { envelope: any }> {
  const result = await cli(
    db,
    ["api", "runs", "submit", "--request", "-", "--json"],
    { ...options, stdin: JSON.stringify(request) },
  )
  return { ...result, envelope: parseOnlyJson(result.stdout) }
}

/** The single JSON line of a stdout, or null when it is not exactly that. */
export function parseOnlyJson(value: string): any {
  const lines = value.split("\n").filter((line) => line.trim().length > 0)
  if (lines.length !== 1 || !lines[0].trim().startsWith("{")) return null
  return JSON.parse(lines[0])
}

export type RecordingRunner = {
  runner: (request: any, observer: any) => Promise<any>
  calls: string[]
  active: () => number
  maxActive: () => number
}

/** A runner that records dispatch order and per-runner concurrency. */
export function recordingRunner(
  log: string[] = [],
  options: { holdMs?: number; tag?: string } = {},
): RecordingRunner {
  let active = 0
  let maxActive = 0
  const calls: string[] = []
  return {
    calls,
    active: () => active,
    maxActive: () => maxActive,
    async runner(request: any, observer: any) {
      active += 1
      maxActive = Math.max(maxActive, active)
      const jobId = String(request?.identity?.jobId)
      calls.push(jobId)
      log.push(`${options.tag ?? "runner"}:${jobId}`)
      observer.appendEvent("assistant_delta", { text: "executor fixture" })
      observer.heartbeat()
      if (options.holdMs) {
        await new Promise((resolve) => setTimeout(resolve, options.holdMs))
      }
      active -= 1
      return {
        status: "succeeded",
        exitCode: 0,
        result: { finalMessage: "executor fixture done" },
      }
    },
  }
}

export type FetchRecorder = {
  fetch: (url: any, init?: any) => Promise<Response>
  calls: string[]
}

export function completionFetchRecorder(
  log: string[] = [],
  tag = "completion",
): FetchRecorder {
  const calls: string[] = []
  return {
    calls,
    async fetch(url: any) {
      calls.push(String(url))
      log.push(`${tag}:${String(url)}`)
      return new Response(
        JSON.stringify({
          output_text: "done",
          usage: { input_tokens: 3, output_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    },
  }
}

// ---------------------------------------------------------------------------
// Store readers (raw SQL, so assertions never depend on product helpers)
// ---------------------------------------------------------------------------

export function jobRow(sqlite: Database, jobId: string): any {
  return sqlite.query("SELECT * FROM agent_jobs WHERE id = ?").get(jobId)
}

export function jobRows(sqlite: Database, where = "1=1"): any[] {
  return sqlite
    .query(`SELECT * FROM agent_jobs WHERE ${where} ORDER BY created_at, id`)
    .all() as any[]
}

export function eventRows(sqlite: Database, jobId: string): any[] {
  return sqlite
    .query(
      "SELECT * FROM agent_job_events WHERE job_id = ? ORDER BY sequence ASC",
    )
    .all(jobId) as any[]
}

export function eventsOfType(
  sqlite: Database,
  jobId: string,
  type: string,
): any[] {
  return eventRows(sqlite, jobId).filter((row) => row.type === type)
}

export function completedPayload(sqlite: Database, jobId: string): any {
  const [row] = eventsOfType(sqlite, jobId, "completed")
  return row ? JSON.parse(row.payload_json) : null
}

/** Reservation rows of a job (frozen table/column names, see report). */
export function reservationRows(sqlite: Database, jobId: string): any[] {
  const table = sqlite
    .query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_job_idempotency'",
    )
    .get()
  if (!table) return []
  return sqlite
    .query("SELECT * FROM agent_job_idempotency WHERE job_id = ?")
    .all(jobId) as any[]
}

/** Normalizes a stored timestamp (Drizzle seconds or epoch ms) to ms. */
export function storedMs(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string" && !/^\d+$/.test(value)) {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return numeric < 100_000_000_000 ? numeric * 1000 : numeric
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

export function dirListing(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).sort()
}

export function providerCallLog(markerDir: string): string[] {
  const file = join(markerDir, "provider-calls.log")
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
}

export async function realDelay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** Polls until `predicate` holds; returns whether it did before the bound. */
export async function pollUntil(
  predicate: () => boolean,
  timeoutMs = 10_000,
  intervalMs = 20,
): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true
    await realDelay(intervalMs)
  }
  return predicate()
}

/** Resolves a promise or reports that it did not settle within a bound. */
export async function within<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<{ settled: true; value: T } | { settled: false }> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<{ settled: false }>((resolve) => {
    timer = setTimeout(() => resolve({ settled: false }), timeoutMs)
  })
  const settled = promise.then((value) => ({ settled: true as const, value }))
  const result = await Promise.race([settled, timeout])
  if (timer) clearTimeout(timer)
  return result
}

// ---------------------------------------------------------------------------
// Child processes (roles of this same file)
// ---------------------------------------------------------------------------

export type RoleArgs = {
  dbFile: string
  markerDir: string
  /** `cli`: argv after the headless marker; `daemon`: unused. */
  argv?: string[]
  stdinText?: string
  runner?: "record" | "block" | "capture-env"
  /** Filesystem freeze point (worker process only). */
  freezeAt?:
    | "before-terminal-commit"
    | "before-publish-1"
    | "before-publish-2"
    | "before-publish-3"
    | null
  /** Database crash point (submitter process only). */
  crashAt?: "before-initial-admission" | null
  nowIso?: string | null
  lockPath?: string | null
  daemonOptions?: Record<string, unknown>
}

export type ChildHandle = {
  proc: ReturnType<typeof Bun.spawn>
  exited: Promise<number>
  output: () => Promise<{ stdout: string; stderr: string }>
  result: () => Promise<any>
  kill: (signal?: number) => void
}

const liveChildren: ChildHandle[] = []

export function spawnRole(
  role: "cli" | "daemon",
  args: RoleArgs,
  env: Record<string, string | undefined>,
): ChildHandle {
  const encoded = Buffer.from(JSON.stringify(args)).toString("base64")
  const proc = Bun.spawn(
    [process.execPath, "-e", childBootstrapSource(), role, encoded],
    {
      env: env as Record<string, string>,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    },
  )
  let captured: Promise<{ stdout: string; stderr: string }> | null = null
  const output = () => {
    captured ??= Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
    ]).then(([stdout, stderr]) => ({ stdout, stderr }))
    return captured
  }
  const handle: ChildHandle = {
    proc,
    exited: proc.exited,
    output,
    async result() {
      const { stdout } = await output()
      const line = stdout
        .split("\n")
        .reverse()
        .find((entry) => entry.startsWith("@@ROLE-RESULT "))
      return line ? JSON.parse(line.slice("@@ROLE-RESULT ".length)) : null
    },
    kill(signal = 9) {
      // Bun's Subprocess.kill is a no-op once the child has exited.
      proc.kill(signal)
    },
  }
  liveChildren.push(handle)
  return handle
}

/** Minimal inherited environment for a child (no host secrets forwarded). */
export function childEnv(
  extra: Record<string, string> = {},
): Record<string, string> {
  const base: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? tmpdir(),
    TMPDIR: tmpdir(),
    LOCUS_EXECUTOR_TEST_CHILD: "1",
  }
  return { ...base, ...extra }
}

// ---------------------------------------------------------------------------
// Role implementation (runs only inside a child process)
// ---------------------------------------------------------------------------

/**
 * Self-contained (serialized into the child bootstrap): wraps the CJS
 * `node:fs` object BEFORE the first ESM link of `node:fs` in the child, so
 * every later `import { renameSync } from "node:fs"` (the run-artifact
 * owner) binds to this wrapper. Must not reference outer-scope names.
 */
export function renameFreezeBootstrap(args: any): void {
  if (!/^before-publish-\d+$/.test(String(args?.freezeAt))) return
  const fs = require("node:fs")
  const path = require("node:path")
  const finals = new Set([
    "request.json",
    "events.jsonl",
    "result.json",
    "artifacts.json",
  ])
  const original = fs.renameSync
  let publishRenames = 0
  const freeze = (point: string) => {
    fs.writeFileSync(
      path.join(args.markerDir, "frozen.json"),
      JSON.stringify({ point, pid: process.pid }),
    )
    const cell = new Int32Array(new SharedArrayBuffer(4))
    while (true) Atomics.wait(cell, 0, 0)
  }
  fs.renameSync = (from: any, to: any) => {
    // The child's own daemon lock lives under markerDir: its atomic
    // rewrites are passed through and are never fault points.
    if (String(to).startsWith(String(args.markerDir))) {
      return original(from, to)
    }
    const target = path.basename(String(to))
    if (finals.has(target)) {
      publishRenames += 1
      const match = /^before-publish-(\d+)$/.exec(String(args.freezeAt))
      if (match && publishRenames === Number(match[1])) {
        freeze(String(args.freezeAt))
      }
      return original(from, to)
    }
    return original(from, to)
  }
}

/** Child entry: install the fs fault wrapper, then load this kit and run. */
function childBootstrapSource(): string {
  return [
    'const args = JSON.parse(Buffer.from(String(process.argv[2]), "base64").toString("utf8"));',
    `(${renameFreezeBootstrap.toString()})(args);`,
    `const kit = await import(${JSON.stringify(KIT_PATH)});`,
    "await kit.runRole(String(process.argv[1]), args);",
    "process.exit(0);",
  ].join("\n")
}

function freezeInPlace(markerDir: string, point: string): never {
  writeFileSync(
    join(markerDir, "frozen.json"),
    JSON.stringify({ point, pid: process.pid }),
  )
  const cell = new Int32Array(new SharedArrayBuffer(4))
  while (true) Atomics.wait(cell, 0, 0)
}

/**
 * Drizzle's logQuery runs immediately before a statement executes. Two DB
 * fault points use it: SIGKILL before the first `artifact_created` insert
 * (S38), and a freeze right before the terminal `completed` insert, i.e.
 * after every terminal file was staged and before the SQL commit (S27).
 */
function faultLogger(args: RoleArgs): any {
  const crash = args.crashAt === "before-initial-admission"
  const freeze = args.freezeAt === "before-terminal-commit"
  if (!crash && !freeze) return undefined
  return {
    logQuery(query: string, params: unknown[]) {
      if (!/insert\s+into\s+"?agent_job_events"?/i.test(query)) return
      if (crash && params.some((param) => param === "artifact_created")) {
        writeFileSync(
          join(args.markerDir, "crashed.json"),
          JSON.stringify({ point: args.crashAt, pid: process.pid }),
        )
        process.kill(process.pid, "SIGKILL")
      }
      if (freeze && params.some((param) => param === "completed")) {
        freezeInPlace(args.markerDir, "before-terminal-commit")
      }
    },
  }
}

async function buildRunner(args: RoleArgs): Promise<any> {
  const log = join(args.markerDir, "provider-calls.log")
  const record = (jobId: string) =>
    appendFileSync(log, `${jobId} pid=${process.pid}\n`)
  if (args.runner === "capture-env") {
    const { createCodexHeadlessTaskRunner, __testCodexHeadless } = await import(
      "../src/main/lib/headless/adapters/codex"
    )
    const fakeExecutable = join(args.markerDir, "fake-codex")
    if (!existsSync(fakeExecutable)) {
      writeFileSync(fakeExecutable, "#!/bin/sh\nexit 0\n", { mode: 0o755 })
    }
    return createCodexHeadlessTaskRunner({
      // The real Codex env builder (unchanged secret stripping) over the
      // claimant process's own environment; the shell snapshot is empty so
      // the capture reflects process.env only.
      buildRuntimeEnv: (request: any) =>
        __testCodexHeadless.buildCodexEnv(request, process.env, {}),
      resolveExecutable: () => fakeExecutable,
      runProcess: async (input: any) => {
        const jobId = String(input.request.identity.jobId)
        record(jobId)
        writeFileSync(
          join(args.markerDir, `child-env-${jobId}.json`),
          JSON.stringify({ claimantPid: process.pid, env: input.env }),
        )
        return {
          status: "succeeded",
          exitCode: 0,
          result: { finalMessage: "env captured" },
        }
      },
    } as any)
  }
  return async (request: any, observer: any) => {
    const jobId = String(request.identity.jobId)
    record(jobId)
    observer.appendEvent("assistant_delta", { text: "executor fixture" })
    observer.heartbeat()
    if (args.runner === "block") {
      writeFileSync(
        join(args.markerDir, `started-${jobId}`),
        String(process.pid),
      )
      await new Promise(() => {})
    }
    return {
      status: "succeeded",
      exitCode: 0,
      result: { finalMessage: "executor fixture done" },
    }
  }
}

export async function runRole(role: string, args: RoleArgs): Promise<void> {
  const { db } = openDbFile(args.dbFile, faultLogger(args))
  const runner = await buildRunner(args)
  const markerFetch = async () => {
    appendFileSync(
      join(args.markerDir, "provider-calls.log"),
      `completion pid=${process.pid}\n`,
    )
    return new Response(
      JSON.stringify({
        output_text: "done",
        usage: { input_tokens: 3, output_tokens: 2 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )
  }
  if (role === "cli") {
    const result = await cli(db, args.argv ?? [], {
      stdin: args.stdinText,
      runner,
      env: process.env,
      completionFetch: markerFetch,
      ...(args.nowIso ? { now: new Date(args.nowIso) } : {}),
    })
    process.stdout.write(`@@ROLE-RESULT ${JSON.stringify(result)}\n`)
    return
  }
  if (role === "daemon") {
    const { runLocalAgentDaemon } = await import(
      "../src/main/lib/headless/daemon"
    )
    const daemonResult = await runLocalAgentDaemon({
      db,
      once: true,
      concurrency: 1,
      pollIntervalMs: 100,
      runner,
      env: process.env,
      appVersion: "0.0.executor-red",
      completionFetch: markerFetch,
      // An API-capable daemon requires a lock path (spec: headless delta).
      lockPath: args.lockPath ?? join(args.markerDir, "agent-daemon.lock"),
      ...(args.nowIso ? { now: new Date(args.nowIso) } : {}),
      ...(args.daemonOptions ?? {}),
    } as any)
    process.stdout.write(
      `@@ROLE-RESULT ${JSON.stringify({ daemon: daemonResult, pid: process.pid })}\n`,
    )
    return
  }
  throw new Error(`unknown role ${role}`)
}
