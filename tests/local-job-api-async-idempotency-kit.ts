/** biome-ignore-all lint/suspicious/noExplicitAny: the async-submit/idempotency contract under test does not exist yet; envelopes and rows are asserted structurally. */
/**
 * Harness for the idempotency red suite of
 * `openspec/changes/add-local-job-api-async-submit` (S08-S15, S19, S53).
 *
 * Test infrastructure only, never product code:
 *
 * - Every product interaction goes through entry points that exist on the
 *   baseline: the in-process CLI (`runHeadlessCliCommand` +
 *   `HEADLESS_CLI_MARKER`), the job-store lifecycle exports and the daemon.
 *   New commands (`runs submit`, `runs retry --request`) are exercised
 *   through that CLI, so on the baseline they fail inside each test with
 *   the parser's own "Unknown api runs subcommand" / "Unexpected arguments"
 *   diagnostics instead of crashing the file at load time.
 * - The reservation table is discovered by name (`%idempotency%`) and its
 *   columns by role; nothing here hard-codes a column layout the design
 *   leaves open (see the report's frozen shapes).
 * - Faults and latches that the product exposes no seam for are injected
 *   with SQLite triggers (schema objects every connection honours) or with a
 *   real child process that SIGKILLs itself at a named SQL boundary. The
 *   child entry point is this file's `import.meta.main` block.
 * - Each profile is a temporary file-backed SQLite with every repository
 *   Drizzle migration applied (reused from the ledger domain-B kit) plus a
 *   temporary registered project directory; `close()` removes both.
 */
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
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
import { agentProviderProfiles, projects } from "../src/main/lib/db/schema"
import type {
  AgentRuntimeObserver,
  AgentRuntimeRunRequest,
  AgentRuntimeRunResult,
} from "../src/main/lib/headless/agent-runtime-contract"
import { HEADLESS_CLI_MARKER } from "../src/main/lib/headless/cli-args"
import { runHeadlessCliCommand } from "../src/main/lib/headless/cli-dispatcher"
import { fakeAgentTaskRunner } from "../src/main/lib/headless/job-runner"
import {
  createMigratedLedgerDb,
  type MigratedLedgerDb,
} from "./run-event-ledger-domain-b-kit"

export const IDEMPOTENCY_FIXTURE_DIR = join(
  import.meta.dir,
  "fixtures",
  "local-job-api-async",
  "idempotency",
)
const KIT_PATH = join(import.meta.dir, "local-job-api-async-idempotency-kit.ts")

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export type IdempotencyFixture = {
  fixtureVersion: number
  evidenceClass: string
  sourceRefs: string[]
  provenance: Record<string, unknown>
  cases: Record<string, any>
}

export function loadIdempotencyFixture(name: string): IdempotencyFixture {
  return JSON.parse(readFileSync(join(IDEMPOTENCY_FIXTURE_DIR, name), "utf8"))
}

/** Deep-substitutes `${NAME}` placeholders in a fixture template. */
export function materialize<T>(template: T, values: Record<string, string>): T {
  const text = JSON.stringify(template).replace(
    /\$\{([A-Z_]+)\}/g,
    (whole, name: string) => (name in values ? values[name] : whole),
  )
  return JSON.parse(text) as T
}

export function withKey(request: any, key: string): any {
  return { ...request, idempotencyKey: key }
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function sha256Base64(value: string): string {
  return createHash("sha256").update(value).digest("base64")
}

// ---------------------------------------------------------------------------
// Scripted fake runner (no real runtime, no credentials, no network)
// ---------------------------------------------------------------------------

export type ScriptedRunner = {
  fn: (
    request: AgentRuntimeRunRequest,
    observer: AgentRuntimeObserver,
  ) => Promise<AgentRuntimeRunResult>
  calls: string[]
  mode: "succeed" | "fail"
  /** Per-job hook run inside the runner, i.e. after claim and before the terminal commit. */
  duringRun: Map<string, () => void>
  callsFor(jobId: string): number
}

export function scriptedRunner(): ScriptedRunner {
  const state: ScriptedRunner = {
    calls: [],
    mode: "succeed",
    duringRun: new Map(),
    callsFor(jobId) {
      return state.calls.filter((id) => id === jobId).length
    },
    fn: async (request, observer) => {
      const jobId = String(request.identity?.jobId ?? "")
      state.calls.push(jobId)
      state.duringRun.get(jobId)?.()
      if (state.mode === "fail") {
        return {
          status: "failed",
          exitCode: 1,
          errorCode: "fixture_failure",
          errorMessage: "Scripted fixture failure",
        } as AgentRuntimeRunResult
      }
      return await fakeAgentTaskRunner(request, observer)
    },
  }
  return state
}

// ---------------------------------------------------------------------------
// Profiles: migrated temporary SQLite + registered temporary project
// ---------------------------------------------------------------------------

export type Profile = {
  m: MigratedLedgerDb
  root: string
  artifactBase: string
  otherArtifactBase: string
  scratch: string
  lockPath: string
  runner: ScriptedRunner
  values: Record<string, string>
  close(): void
}

export function createProfile(): Profile {
  const m = createMigratedLedgerDb()
  const root = realpathSync(mkdtempSync(join(tmpdir(), "locus-idem-project-")))
  const scratch = mkdtempSync(join(tmpdir(), "locus-idem-scratch-"))
  m.db
    .insert(projects)
    .values({ id: "project-idem", name: "Idempotency", path: root })
    .run()
  const artifactBase = join(root, ".locus", "runs")
  const otherArtifactBase = join(root, ".locus", "other-runs")
  return {
    m,
    root,
    artifactBase,
    otherArtifactBase,
    scratch,
    lockPath: join(scratch, "daemon.lock"),
    runner: scriptedRunner(),
    values: {
      PROJECT_ROOT: root,
      ARTIFACT_BASE: artifactBase,
      OTHER_ARTIFACT_BASE: otherArtifactBase,
    },
    close() {
      m.close()
      rmSync(root, { recursive: true, force: true })
      rmSync(scratch, { recursive: true, force: true })
    },
  }
}

export function seedProviderProfile(
  profile: Profile,
  input: { id: string; targets: string[] },
): void {
  profile.m.db
    .insert(agentProviderProfiles)
    .values({
      id: input.id,
      name: input.id,
      protocol: "openai-responses",
      baseUrl: "https://provider.example.invalid/v1",
      defaultModel: "provider-default-model",
      authMode: "none",
      encryptedToken: null,
      targetRuntimesJson: JSON.stringify(input.targets),
      capabilitiesJson: "{}",
    })
    .run()
}

// ---------------------------------------------------------------------------
// In-process CLI
// ---------------------------------------------------------------------------

export type CliResult = {
  code: number
  stdout: string
  stderr: string
  lines: string[]
  /** The single stdout JSON line, or null when stdout is not exactly one JSON line. */
  json: any
}

export function parseSingleJsonLine(stdout: string): Promise<any> {
  const lines = stdout.split("\n").filter((line) => line.length > 0)
  if (lines.length !== 1) return null
  return Promise.resolve(lines[0])
    .then(JSON.parse)
    .catch(() => null)
}

export async function cli(
  profile: Profile,
  argv: string[],
  options: { stdin?: string; completionFetch?: typeof fetch } = {},
): Promise<CliResult> {
  let stdout = ""
  let stderr = ""
  const code = await runHeadlessCliCommand({
    db: profile.m.db,
    argv: ["Locus", HEADLESS_CLI_MARKER, ...argv],
    ...(options.stdin !== undefined
      ? { stdin: Readable.from([options.stdin]) }
      : {}),
    stdout: { write: (chunk: string) => (stdout += chunk) },
    stderr: { write: (chunk: string) => (stderr += chunk) },
    runner: profile.runner.fn,
    appVersion: "0.0.test",
    daemonLockPath: profile.lockPath,
    ...(options.completionFetch
      ? { completionFetch: options.completionFetch as any }
      : {}),
  })
  return {
    code,
    stdout,
    stderr,
    lines: stdout.split("\n").filter((line) => line.length > 0),
    json: await parseSingleJsonLine(stdout),
  }
}

export async function submit(profile: Profile, request: unknown) {
  return await cli(
    profile,
    ["api", "runs", "submit", "--request", "-", "--json"],
    {
      stdin: JSON.stringify(request),
    },
  )
}

export async function create(profile: Profile, request: unknown) {
  return await cli(
    profile,
    ["api", "runs", "create", "--request", "-", "--json"],
    {
      stdin: JSON.stringify(request),
    },
  )
}

export async function retryWithRequest(
  profile: Profile,
  sourceId: string,
  request: unknown,
  mode: "async" | "sync",
) {
  return await cli(
    profile,
    [
      "api",
      "runs",
      "retry",
      sourceId,
      "--request",
      "-",
      ...(mode === "async" ? ["--async"] : []),
      "--json",
    ],
    { stdin: JSON.stringify(request) },
  )
}

/** One daemon pass through the existing CLI (`daemon run --once`). */
export async function daemonOnce(profile: Profile) {
  return await cli(profile, [
    "daemon",
    "run",
    "--once",
    "--poll-interval-ms",
    "100",
    "--output",
    "json",
  ])
}

/** Normalized summary of a submit/retry response used by structural oracles. */
export function envelopeSummary(result: CliResult) {
  const json = result.json
  return {
    exit: result.code,
    envelopeKeys:
      json && typeof json === "object" ? Object.keys(json).sort() : null,
    status: json?.job?.status ?? null,
    idempotentReplay: json?.idempotentReplay ?? null,
    errorCode: json?.error?.code ?? null,
    retryable: json?.error?.retryable ?? null,
    hasJob: Boolean(json?.job),
    hasResult: Boolean(json?.result),
  }
}

// ---------------------------------------------------------------------------
// DB observation (fresh connections, discovered reservation table)
// ---------------------------------------------------------------------------

export type ReservationTable = {
  table: string
  columns: string[]
  expiresColumn: string | null
  jobColumn: string | null
  consumerColumn: string | null
  keyHashColumn: string | null
}

export function findReservationTable(
  sqlite: Database,
): ReservationTable | null {
  const row = sqlite
    .query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%idempotency%' ORDER BY name LIMIT 1",
    )
    .get() as { name: string } | null
  if (!row) return null
  const columns = (
    sqlite.query(`PRAGMA table_info("${row.name}")`).all() as { name: string }[]
  ).map((column) => column.name)
  const pick = (pattern: RegExp) =>
    columns.find((column) => pattern.test(column)) ?? null
  return {
    table: row.name,
    columns,
    expiresColumn: pick(/expire/i),
    jobColumn: pick(/^job|job_?id/i),
    consumerColumn: pick(/consumer/i),
    keyHashColumn: pick(/key_?hash/i),
  }
}

export function reservationRows(sqlite: Database): any[] {
  const info = findReservationTable(sqlite)
  if (!info) return []
  return sqlite.query(`SELECT * FROM "${info.table}"`).all() as any[]
}

export function reservationForJob(sqlite: Database, jobId: string): any | null {
  const info = findReservationTable(sqlite)
  if (!info?.jobColumn) return null
  return (
    (sqlite
      .query(`SELECT * FROM "${info.table}" WHERE "${info.jobColumn}" = ?`)
      .get(jobId) as any) ?? null
  )
}

/** Reservation expiry in epoch ms (integer seconds, ms or ISO accepted); undefined when absent. */
export function reservationExpiryMs(
  sqlite: Database,
  jobId: string | null,
): number | null | undefined {
  if (!jobId) return undefined
  const info = findReservationTable(sqlite)
  const row = reservationForJob(sqlite, jobId)
  if (!info?.expiresColumn || !row) return undefined
  return toEpochMs(row[info.expiresColumn])
}

export function toEpochMs(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === "number") return value < 1e11 ? value * 1000 : value
  if (typeof value === "string") {
    const parsed = /^\d+$/.test(value) ? Number(value) : Date.parse(value)
    if (Number.isNaN(parsed)) return null
    return parsed < 1e11 ? parsed * 1000 : parsed
  }
  return null
}

export function apiJobs(sqlite: Database, consumerId?: string): any[] {
  return (
    consumerId
      ? sqlite
          .query(
            "SELECT * FROM agent_jobs WHERE source = 'api' AND api_consumer_id = ? ORDER BY rowid",
          )
          .all(consumerId)
      : sqlite
          .query("SELECT * FROM agent_jobs WHERE source = 'api' ORDER BY rowid")
          .all()
  ) as any[]
}

export function jobById(sqlite: Database, jobId: string | null): any | null {
  if (!jobId) return null
  return (
    (sqlite.query("SELECT * FROM agent_jobs WHERE id = ?").get(jobId) as any) ??
    null
  )
}

export function jobByPrompt(sqlite: Database, prompt: string): any | null {
  return (
    (sqlite
      .query(
        "SELECT * FROM agent_jobs WHERE prompt_preview = ? ORDER BY rowid LIMIT 1",
      )
      .get(prompt) as any) ?? null
  )
}

export function eventCount(
  sqlite: Database,
  filter: { jobId?: string | null; type?: string } = {},
): number {
  const clauses: string[] = []
  const params: string[] = []
  if (filter.jobId !== undefined) {
    clauses.push("job_id = ?")
    params.push(String(filter.jobId))
  }
  if (filter.type) {
    clauses.push("type = ?")
    params.push(filter.type)
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""
  const row = sqlite
    .query(`SELECT count(*) AS n FROM agent_job_events ${where}`)
    .get(...params) as { n: number }
  return row.n
}

export function jobEvents(sqlite: Database, jobId: string): any[] {
  return sqlite
    .query("SELECT * FROM agent_job_events WHERE job_id = ? ORDER BY sequence")
    .all(jobId) as any[]
}

export function installTrigger(
  sqlite: Database,
  name: string,
  body: string,
): void {
  sqlite.exec(`CREATE TRIGGER "${name}" ${body}`)
}

export function dropTrigger(sqlite: Database, name: string): void {
  sqlite.exec(`DROP TRIGGER IF EXISTS "${name}"`)
}

/**
 * Latch emulation for "after job+reservation commit, before creation
 * commit": job_created appends abort and API job deletes abort (so the
 * queued/no-facts compensation cannot run). Returns the release function.
 */
export function holdCreationBoundary(sqlite: Database): () => void {
  installTrigger(
    sqlite,
    "idem_hold_job_created",
    "BEFORE INSERT ON agent_job_events WHEN NEW.type = 'job_created' BEGIN SELECT RAISE(ABORT, 'fixture latch: creation append held'); END",
  )
  installTrigger(
    sqlite,
    "idem_hold_compensation",
    "BEFORE DELETE ON agent_jobs WHEN OLD.source = 'api' BEGIN SELECT RAISE(ABORT, 'fixture latch: compensation held'); END",
  )
  return () => {
    dropTrigger(sqlite, "idem_hold_job_created")
    dropTrigger(sqlite, "idem_hold_compensation")
  }
}

// ---------------------------------------------------------------------------
// Byte scans
// ---------------------------------------------------------------------------

/** True when any of the SQLite main/WAL/SHM files contains `needle` (UTF-8). */
export function sqliteFilesContain(dbFile: string, needle: string): boolean {
  const probe = Buffer.from(needle, "utf8")
  return [dbFile, `${dbFile}-wal`, `${dbFile}-shm`].some(
    (file) => existsSync(file) && readFileSync(file).includes(probe),
  )
}

export function listFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = lstatSync(path)
    if (stat.isDirectory()) out.push(...listFilesRecursive(path))
    else out.push(path)
  }
  return out
}

export function filesContaining(dir: string, needle: string): string[] {
  const probe = Buffer.from(needle, "utf8")
  return listFilesRecursive(dir).filter((file) =>
    readFileSync(file).includes(probe),
  )
}

/** Immediate subdirectories (run dirs) of an artifact base, sorted. */
export function runDirNames(base: string): string[] {
  if (!existsSync(base)) return []
  return readdirSync(base)
    .filter((entry) => lstatSync(join(base, entry)).isDirectory())
    .sort()
}

export function snapshotFiles(dir: string): Record<string, string> {
  return Object.fromEntries(
    listFilesRecursive(dir).map((file) => [
      file,
      sha256Hex(readFileSync(file).toString("base64")),
    ]),
  )
}

// ---------------------------------------------------------------------------
// Real child process at a named SQL boundary
// ---------------------------------------------------------------------------

export type ChildSpec = {
  dbFile: string
  argv: string[]
  stdinText?: string
  lockPath?: string
  /** SIGKILL self when preparing the `nth` statement whose SQL matches. */
  kill?: { pattern: string; flags?: string; nth: number }
  /** Written once the child has loaded and is waiting on `goFile`. */
  readyFile?: string
  /** Wait for this file to exist before running the command (start barrier). */
  goFile?: string
  resultFile: string
}

export type ChildOutcome = {
  exitCode: number | null
  signalCode: string | null
  result: { code: number; stdout: string; stderr: string } | null
}

export function spawnCliChild(spec: ChildSpec, scratch: string) {
  const specFile = join(
    scratch,
    `child-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  )
  writeFileSync(specFile, JSON.stringify(spec))
  const child = Bun.spawn([process.execPath, KIT_PATH, specFile], {
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, LOCUS_IDEMPOTENCY_KIT_CHILD: "1" },
  })
  return {
    child,
    async done(): Promise<ChildOutcome> {
      await child.exited
      const result = existsSync(spec.resultFile)
        ? JSON.parse(readFileSync(spec.resultFile, "utf8"))
        : null
      return {
        exitCode: child.exitCode,
        signalCode: child.signalCode ?? null,
        result,
      }
    },
  }
}

export async function runCliChild(spec: ChildSpec, scratch: string) {
  return await spawnCliChild(spec, scratch).done()
}

async function childMain(specFile: string): Promise<void> {
  const spec = JSON.parse(readFileSync(specFile, "utf8")) as ChildSpec
  if (spec.kill) {
    const pattern = new RegExp(spec.kill.pattern, spec.kill.flags ?? "i")
    let seen = 0
    let nested = false
    const check = (sql: unknown) => {
      if (nested || typeof sql !== "string" || !pattern.test(sql)) return
      seen += 1
      if (seen === spec.kill?.nth) process.kill(process.pid, "SIGKILL")
    }
    const proto = Database.prototype as any
    const originalPrepare = proto.prepare
    const originalQuery = proto.query
    proto.prepare = function (sql: unknown, ...rest: unknown[]) {
      check(sql)
      return originalPrepare.call(this, sql, ...rest)
    }
    proto.query = function (sql: unknown, ...rest: unknown[]) {
      check(sql)
      nested = true
      try {
        return originalQuery.call(this, sql, ...rest)
      } finally {
        nested = false
      }
    }
  }
  const sqlite = new Database(spec.dbFile)
  sqlite.exec("PRAGMA journal_mode = WAL")
  sqlite.exec("PRAGMA busy_timeout = 5000")
  sqlite.exec("PRAGMA foreign_keys = ON")
  const db = drizzle(sqlite, { schema })
  if (spec.readyFile) writeFileSync(spec.readyFile, "ready")
  if (spec.goFile) {
    while (!existsSync(spec.goFile)) await Bun.sleep(2)
  }
  let stdout = ""
  let stderr = ""
  const code = await runHeadlessCliCommand({
    db: db as any,
    argv: ["Locus", HEADLESS_CLI_MARKER, ...spec.argv],
    ...(spec.stdinText !== undefined
      ? { stdin: Readable.from([spec.stdinText]) }
      : {}),
    stdout: { write: (chunk: string) => (stdout += chunk) },
    stderr: { write: (chunk: string) => (stderr += chunk) },
    runner: fakeAgentTaskRunner,
    appVersion: "0.0.test",
    daemonLockPath: spec.lockPath ?? null,
  })
  writeFileSync(spec.resultFile, JSON.stringify({ code, stdout, stderr }))
  sqlite.close()
  process.exit(code)
}

// ---------------------------------------------------------------------------
// S53 documentation-example consumer preflight (not evidence about Locus)
// ---------------------------------------------------------------------------

/**
 * Neutral consumer preflight, documentation example only (tasks.md:88): it
 * reads a discovery envelope and dispatches only when the required feature
 * identifier is advertised. Its spy proves nothing about the Locus parser.
 */
export async function preflightThenDispatch(
  discovery: { apiVersion?: unknown; features?: unknown },
  requiredFeature: string,
  dispatch: () => Promise<unknown>,
): Promise<{ supported: boolean; dispatched: boolean }> {
  const supported =
    discovery.apiVersion === "locus.local-job.v1" &&
    Array.isArray(discovery.features) &&
    discovery.features.includes(requiredFeature)
  if (!supported) return { supported: false, dispatched: false }
  await dispatch()
  return { supported: true, dispatched: true }
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

if (import.meta.main) {
  await childMain(process.argv[2] as string)
}
