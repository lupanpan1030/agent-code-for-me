/** biome-ignore-all lint/suspicious/noExplicitAny: the async-submit contract under test does not exist yet; envelopes are asserted structurally. */
/**
 * Test harness for the submit-wait domain of the red suite of
 * `openspec/changes/add-local-job-api-async-submit` (S01–S07, S16–S18,
 * S20–S25, S34, S35).
 *
 * Test infrastructure only, never product code:
 *
 * - Every CLI interaction goes through the existing in-process entry point
 *   `runHeadlessCliCommand` + `HEADLESS_CLI_MARKER` with an injected
 *   database, stdin/stdout/stderr and a controlled runner, exactly as
 *   `tests/headless-cli-dispatcher.test.ts` does today.
 * - Profiles use the repository's real Drizzle migrations through
 *   `createMigratedLedgerDb` (tests/run-event-ledger-domain-b-kit.ts, reused
 *   by import), so the implementing change's additive reservation migration
 *   is exercised without editing a hand-written schema.
 * - Runtime work is a controlled fake `AgentTaskRunner`; completion work is
 *   a fake `fetch`. No real runtime, credential or network is touched.
 * - Frozen test seams (design is silent on their names; see the report):
 *   `RunHeadlessCliCommandOptions.monotonicClock` ({ now(), sleep(ms) }) for
 *   the wait / wrapper deadlines, and
 *   `RunHeadlessCliCommandOptions.beforeOwnPumpClaim(jobId)` for the
 *   wrapper's own scoped pump claim latch (task 1.5 "claim latch").
 *   Today's dispatcher ignores unknown option keys, so passing them never
 *   crashes the file at load.
 */
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Readable } from "node:stream"
import { drizzle } from "drizzle-orm/bun-sqlite"
import * as schema from "../src/main/lib/db/schema"
import { agentProviderProfiles, projects } from "../src/main/lib/db/schema"
import { HEADLESS_CLI_MARKER } from "../src/main/lib/headless/cli-args"
import { runHeadlessCliCommand } from "../src/main/lib/headless/cli-dispatcher"
import {
  createMigratedLedgerDb,
  type MigratedLedgerDb,
} from "./run-event-ledger-domain-b-kit"

export const FIXTURE_DIR = join(
  import.meta.dir,
  "fixtures",
  "local-job-api-async",
  "submit-wait",
)
export const REPO_ROOT = join(import.meta.dir, "..")
export const API_VERSION = "locus.local-job.v1"
/** Fixed wall-clock instant for byte goldens (bun:test setSystemTime). */
export const FIXED_NOW_ISO = "2026-10-02T00:00:00.000Z"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export function loadFixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as T
}

export function fixtureCase<T = any>(file: string, caseId: string): T {
  const fixture = loadFixture(file)
  const value = fixture.cases?.[caseId]
  if (value === undefined) {
    throw new Error(`fixture ${file}#${caseId} is missing`)
  }
  return value as T
}

/**
 * Renders a golden template: `{{NAME}}` placeholders are replaced by values
 * read from the profile's own database / filesystem (job ids, worker
 * identity, temp root), never by values parsed from the stdout under test.
 */
export function renderGolden(
  template: string,
  vars: Record<string, string | number | null>,
): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_match, name: string) => {
    if (!(name in vars)) throw new Error(`golden placeholder ${name} unbound`)
    const value = vars[name]
    return value === null ? "null" : String(value)
  })
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export type Profile = {
  ledger: MigratedLedgerDb
  db: any
  sqlite: Database
  root: string
  packageDir: string
  artifactBaseDir: string
  lockPath: string
  cleanup: () => void
}

/**
 * An isolated profile: migrated temp SQLite, registered temp project and an
 * (absent by default) daemon lock path. `fixedRoot` gives a deterministic
 * project path so two sequential profiles share byte-identical paths.
 */
export function createProfile(options: { fixedRoot?: string } = {}): Profile {
  const ledger = createMigratedLedgerDb()
  let root: string
  if (options.fixedRoot) {
    root = join(tmpdir(), options.fixedRoot)
    rmSync(root, { recursive: true, force: true })
    mkdirSync(root, { recursive: true })
    root = realpathSync(root)
  } else {
    root = realpathSync(mkdtempSync(join(tmpdir(), "locus-async-sw-")))
  }
  const packageDir = join(root, "local-package")
  mkdirSync(packageDir, { recursive: true })
  ledger.db
    .insert(projects)
    .values({ id: "project-1", name: "Async fixture", path: root })
    .run()
  return {
    ledger,
    db: ledger.db,
    sqlite: ledger.sqlite,
    root,
    packageDir: realpathSync(packageDir),
    artifactBaseDir: join(realpathSync(packageDir), ".locus", "runs"),
    lockPath: join(ledger.dir, "locus-daemon.lock"),
    cleanup() {
      ledger.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

export function seedProviderProfile(
  profile: Profile,
  input: { id: string; targets: string[] },
): void {
  profile.db
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

/** A drizzle handle over a second SQLite connection of the same profile. */
export function secondConnection(profile: Profile): any {
  return profile.ledger.openSecondConnection().db
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export function agentRequest(
  profile: Profile,
  overrides: Record<string, unknown> = {},
  options: { artifacts?: boolean } = {},
): Record<string, unknown> {
  return {
    apiVersion: API_VERSION,
    consumer: { id: "fixture-a", runExternalId: "run-ext-001" },
    project: { cwd: profile.packageDir },
    runtime: { id: "codex", requiredCapabilities: ["planMode"] },
    mode: "plan",
    prompt: { text: "Review this local package." },
    input: { contract: "example.local-package.v1" },
    ...(options.artifacts
      ? {
          artifacts: {
            baseDir: profile.artifactBaseDir,
            writePolicy: "metadata-only",
          },
        }
      : {}),
    ...overrides,
  }
}

export function completionRequest(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    apiVersion: API_VERSION,
    kind: "completion",
    consumer: { id: "fixture-a", runExternalId: "completion-ext-001" },
    runtime: { id: "codex" },
    provider: { profileId: "completion-main", model: "provider-model" },
    messages: [{ role: "user", content: "Return the fixture summary." }],
    responseFormat: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
        additionalProperties: false,
      },
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Latches, runner, fetch and clock
// ---------------------------------------------------------------------------

export type Latch = {
  promise: Promise<void>
  release: () => void
  released: () => boolean
}

export function createLatch(): Latch {
  let release!: () => void
  let done = false
  const promise = new Promise<void>((resolve) => {
    release = () => {
      done = true
      resolve()
    }
  })
  return { promise, release, released: () => done }
}

export type RunnerOutcome = {
  status: "succeeded" | "failed" | "canceled" | "interrupted"
  exitCode?: number | null
  errorCode?: string | null
  errorMessage?: string | null
  result?: unknown
}

export type ControlledRunner = {
  runner: (request: any, observer: any) => Promise<any>
  calls: Array<{ jobId: string; at: number }>
  /** Resolves the first time the runner is entered. */
  entered: Promise<void>
}

/**
 * Deterministic fake runtime. Emits the fixture's coarse events, then waits
 * on `latch` (if any) before returning `outcome`.
 */
export function controlledRunner(
  input: {
    outcome?: RunnerOutcome
    latch?: Latch
    events?: Array<{ type: string; payload: Record<string, unknown> }>
  } = {},
): ControlledRunner {
  const calls: Array<{ jobId: string; at: number }> = []
  let markEntered!: () => void
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve
  })
  const runner = async (request: any, observer: any) => {
    calls.push({
      jobId: request.identity?.jobId ?? request.jobId,
      at: calls.length,
    })
    markEntered()
    for (const event of input.events ?? [
      { type: "assistant_delta", payload: { text: "fixture response" } },
    ]) {
      observer.appendEvent(event.type, event.payload)
    }
    observer.heartbeat()
    if (input.latch) await input.latch.promise
    const outcome = input.outcome ?? {
      status: "succeeded",
      exitCode: 0,
      result: { finalMessage: "fixture done" },
    }
    return { exitCode: null, ...outcome }
  }
  return { runner, calls, entered }
}

export type FetchSpy = {
  fetchImpl: (url: unknown, init?: any) => Promise<Response>
  calls: Array<{ url: string; body: any }>
}

export function completionFetchSpy(
  input: { content?: string; beforeRespond?: () => Promise<void> } = {},
): FetchSpy {
  const calls: Array<{ url: string; body: any }> = []
  const fetchImpl = async (url: unknown, init?: any) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")),
    })
    if (input.beforeRespond) await input.beforeRespond()
    return new Response(
      JSON.stringify({
        output_text: input.content ?? JSON.stringify({ summary: "fixture" }),
        usage: { input_tokens: 11, output_tokens: 5 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )
  }
  return { fetchImpl, calls }
}

export type FakeMonotonicClock = {
  now: () => number
  sleep: (ms: number) => Promise<void>
  advance: (ms: number) => void
  sleeps: number[]
  /** Resolves when fake monotonic time first reaches `ms`. */
  reached: (ms: number) => Promise<void>
}

/**
 * Fake monotonic clock for the frozen `monotonicClock` seam: `sleep(ms)`
 * advances fake time by `ms` and yields one macrotask so other in-process
 * work (pump, runner, waiters) can progress.
 */
export function createFakeMonotonicClock(
  options: { onSleep?: (nowMs: number) => void } = {},
): FakeMonotonicClock {
  let current = 0
  const sleeps: number[] = []
  const waiters: Array<{ at: number; resolve: () => void }> = []
  const flush = () => {
    for (const waiter of [...waiters]) {
      if (current >= waiter.at) {
        waiters.splice(waiters.indexOf(waiter), 1)
        waiter.resolve()
      }
    }
  }
  return {
    now: () => current,
    async sleep(ms: number) {
      sleeps.push(ms)
      current += Math.max(0, ms)
      options.onSleep?.(current)
      flush()
      await new Promise((resolve) => setImmediate(resolve))
    },
    advance(ms: number) {
      current += ms
      flush()
    },
    sleeps,
    reached(ms: number) {
      if (current >= ms) return Promise.resolve()
      return new Promise<void>((resolve) => waiters.push({ at: ms, resolve }))
    },
  }
}

/** Resolves after `ms` of real time (a hang guard, never an oracle). */
export function realDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export type CliResult = { code: number; stdout: string; stderr: string }

export type CliOptions = {
  stdin?: string | Readable
  runner?: ControlledRunner["runner"] | null
  completionFetch?: FetchSpy["fetchImpl"]
  lockPath?: string | null
  /** Alternative drizzle handle (fault-injectable connection). */
  db?: any
  /** Extra (possibly not-yet-existing) RunHeadlessCliCommandOptions keys. */
  extra?: Record<string, unknown>
}

export async function cli(
  profile: Profile,
  args: string[],
  options: CliOptions = {},
): Promise<CliResult> {
  let stdout = ""
  let stderr = ""
  const stdin =
    typeof options.stdin === "string"
      ? Readable.from([options.stdin])
      : options.stdin
  const code = await runHeadlessCliCommand({
    db: options.db ?? profile.db,
    argv: ["Locus", HEADLESS_CLI_MARKER, ...args],
    stdin,
    stdout: { write: (chunk: string) => (stdout += chunk) },
    stderr: { write: (chunk: string) => (stderr += chunk) },
    runner: options.runner ?? null,
    env: {},
    appVersion: "0.0.async-red",
    daemonLockPath:
      options.lockPath === undefined ? profile.lockPath : options.lockPath,
    ...(options.completionFetch
      ? { completionFetch: options.completionFetch as any }
      : {}),
    ...((options.extra ?? {}) as any),
  })
  return { code, stdout, stderr }
}

export function jsonLines(value: string): any[] {
  return value
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return { unparseable: line }
      }
    })
}

export function onlyJson(value: string): any {
  const lines = jsonLines(value)
  return lines.length === 1 ? lines[0] : { lineCount: lines.length, lines }
}

// ---------------------------------------------------------------------------
// Store / filesystem readers
// ---------------------------------------------------------------------------

export function apiJobRows(profile: Profile): any[] {
  return profile.sqlite
    .query(
      "SELECT * FROM agent_jobs WHERE source = 'api' ORDER BY created_at, id",
    )
    .all() as any[]
}

export function allJobRows(profile: Profile): any[] {
  return profile.sqlite
    .query("SELECT * FROM agent_jobs ORDER BY created_at, id")
    .all() as any[]
}

export function jobRowById(profile: Profile, jobId: string): any {
  return profile.sqlite
    .query("SELECT * FROM agent_jobs WHERE id = ?")
    .get(jobId)
}

export function eventRows(profile: Profile, jobId: string): any[] {
  return profile.sqlite
    .query(
      "SELECT * FROM agent_job_events WHERE job_id = ? ORDER BY sequence ASC",
    )
    .all(jobId) as any[]
}

export function eventTypes(profile: Profile, jobId: string): string[] {
  return eventRows(profile, jobId).map((row) => row.type)
}

export function countType(
  profile: Profile,
  jobId: string,
  type: string,
): number {
  return eventTypes(profile, jobId).filter((t) => t === type).length
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

/** Name → sha256 of every regular file directly inside `dir` (sorted). */
export function dirDigests(dir: string): Record<string, string> {
  if (!existsSync(dir)) return {}
  const out: Record<string, string> = {}
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name)
    if (statSync(path).isFile()) out[name] = sha256File(path)
  }
  return out
}

export const RUN_DIR_FILES = {
  REQUEST: "request.json",
  EVENTS: "events.jsonl",
  RESULT: "result.json",
  MANIFEST: "artifacts.json",
} as const

/** SHA_<ROLE> / SIZE_<ROLE> of the published files on disk. */
export function artifactVars(
  runDir: string | null,
): Record<string, string | number> {
  const vars: Record<string, string | number> = {}
  for (const [role, name] of Object.entries(RUN_DIR_FILES)) {
    const path = runDir ? join(runDir, name) : ""
    const present = runDir !== null && existsSync(path)
    vars[`SHA_${role}`] = present ? sha256File(path) : "<missing>"
    vars[`SIZE_${role}`] = present ? statSync(path).size : -1
  }
  return vars
}

/** Template variables for one job read from the profile DB / disk (never stdout). */
export function jobVars(
  profile: Profile,
  jobId: string,
  extra: Record<string, string | number | null> = {},
): Record<string, string | number | null> {
  const row = jobRowById(profile, jobId)
  return {
    ROOT: profile.root,
    JOB_ID: jobId,
    WORKER_ID: row?.worker_id ?? "<unclaimed>",
    WORKER_PID: row?.worker_pid ?? null,
    ...artifactVars(row?.artifact_base_dir ?? null),
    ...correlationVars(profile, jobId),
    ...extra,
  }
}

/** CORR_<sequence> = the ledger-minted correlation key of that committed event. */
export function correlationVars(
  profile: Profile,
  jobId: string,
): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const row of eventRows(profile, jobId)) {
    const payload = JSON.parse(row.payload_json ?? "null")
    const key = payload?.item?.correlationKey
    if (typeof key === "string") vars[`CORR_${row.sequence}`] = key
  }
  return vars
}

// ---------------------------------------------------------------------------
// Fault-injectable connection
// ---------------------------------------------------------------------------

/**
 * A drizzle handle over the profile's SQLite file whose statements throw
 * SQLITE_BUSY while `shouldFail(sql, params)` is true. Used for the wait
 * observation-fault scenarios; the store contents are never modified.
 */
export function faultableDb(
  profile: Profile,
  shouldFail: (sql: string, params: unknown[]) => boolean,
): { db: any; sqlite: Database } {
  const sqlite = new Database(profile.ledger.file)
  sqlite.exec("PRAGMA journal_mode = WAL")
  sqlite.exec("PRAGMA busy_timeout = 5000")
  sqlite.exec("PRAGMA foreign_keys = ON")
  const busy = () =>
    Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" })
  const wrapStatement = (sql: string, statement: any) =>
    new Proxy(statement, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver)
        if (
          typeof value === "function" &&
          ["get", "all", "values", "run"].includes(String(prop))
        ) {
          return (...params: unknown[]) => {
            const flat = params.flat()
            if (shouldFail(sql, flat)) throw busy()
            return value.apply(target, params)
          }
        }
        return typeof value === "function" ? value.bind(target) : value
      },
    })
  const proxied = new Proxy(sqlite, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (prop === "prepare" || prop === "query") {
        return (sql: string, ...rest: unknown[]) =>
          wrapStatement(sql, (value as any).call(target, sql, ...rest))
      }
      return typeof value === "function" ? value.bind(target) : value
    },
  }) as Database
  return { db: drizzle(proxied, { schema }), sqlite }
}

// ---------------------------------------------------------------------------
// Real-process harness (S03 real-process variant, S35)
// ---------------------------------------------------------------------------

export const PROCESS_CHILD = join(FIXTURE_DIR, "process-child.ts")

export type ChildConfig = {
  dbFile: string
  argv: string[]
  lockPath: string | null
  runner: "succeed" | "block"
  claimAs?: { workerPid: number } | null
}

export type ChildHandle = {
  pid: number
  proc: ReturnType<typeof Bun.spawn>
  stdout: () => string
  stderr: () => string
  /** Resolves true once `pattern` appears on stderr, false after `ms`. */
  waitForStderr: (pattern: RegExp, ms: number) => Promise<boolean>
  exited: Promise<{ code: number | null; signal: string | null }>
  closeStdin: () => void
}

export function spawnChild(
  config: ChildConfig,
  options: { stdin: "pipe" | "ignore"; stdinBody?: string } = {
    stdin: "ignore",
  },
): ChildHandle {
  const proc = Bun.spawn(["bun", PROCESS_CHILD], {
    cwd: REPO_ROOT,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      ASYNC_SW_CHILD_CONFIG: JSON.stringify(config),
    },
    stdin: options.stdin,
    stdout: "pipe",
    stderr: "pipe",
  })
  let out = ""
  let err = ""
  const pump = async (
    stream: ReadableStream<Uint8Array>,
    sink: (s: string) => void,
  ) => {
    const decoder = new TextDecoder()
    for await (const chunk of stream as any) sink(decoder.decode(chunk))
  }
  const outDone = pump(proc.stdout as any, (s) => (out += s))
  const errDone = pump(proc.stderr as any, (s) => (err += s))
  if (options.stdin === "pipe" && options.stdinBody !== undefined) {
    ;(proc.stdin as any).write(options.stdinBody)
    ;(proc.stdin as any).end()
  }
  const exited = proc.exited.then(async () => {
    await Promise.allSettled([outDone, errDone])
    return { code: proc.exitCode, signal: proc.signalCode ?? null }
  })
  return {
    pid: proc.pid,
    proc,
    stdout: () => out,
    stderr: () => err,
    async waitForStderr(pattern: RegExp, ms: number) {
      const deadline = performance.now() + ms
      while (performance.now() < deadline) {
        if (pattern.test(err)) return true
        if (proc.exitCode !== null || proc.signalCode) return pattern.test(err)
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      return pattern.test(err)
    },
    exited,
    closeStdin() {
      ;(proc.stdin as any)?.end?.()
    },
  }
}

/** A long-lived sibling process standing in for an alive daemon worker. */
export function spawnSibling(): { pid: number; kill: () => void } {
  const proc = Bun.spawn(["sleep", "120"], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  })
  return { pid: proc.pid, kill: () => proc.kill("SIGKILL") }
}

/** Renders `{{NAME}}` placeholders inside a JSON fixture value. */
export function renderJson<T = any>(
  template: unknown,
  vars: Record<string, string | number | null>,
): T {
  return JSON.parse(renderGolden(JSON.stringify(template), vars)) as T
}

export function profileVars(
  profile: Profile,
): Record<string, string | number | null> {
  return {
    ROOT: profile.root,
    PACKAGE_DIR: profile.packageDir,
    ARTIFACT_BASE: profile.artifactBaseDir,
  }
}

// ---------------------------------------------------------------------------
// Store seeding through existing lifecycle owners
// ---------------------------------------------------------------------------

/**
 * A queued, creation-committed API Run seeded through the existing store
 * owner `createAgentJob` (job row + host `job_created` fact), with the same
 * stored request shape `createLocalJobApiJob` writes today. With
 * `artifacts: true` it carries an artifact manifest path but no committed
 * initial `artifact_created` admission (design.md:159-163).
 */
export async function seedQueuedApiJob(
  profile: Profile,
  options: { artifacts?: boolean; consumerId?: string } = {},
): Promise<string> {
  const { createAgentJob } = await import("../src/main/lib/headless/job-store")
  const { createId } = await import("../src/main/lib/db/utils")
  const id = createId()
  const runDir = options.artifacts ? join(profile.artifactBaseDir, id) : null
  if (runDir) mkdirSync(runDir, { recursive: true })
  const consumerId = options.consumerId ?? "fixture-a"
  await createAgentJob(profile.db, {
    id,
    source: "api",
    runtime: "codex",
    mode: "plan",
    cwd: profile.packageDir,
    prompt: "Review this local package.",
    input: {
      apiVersion: API_VERSION,
      consumer: { id: consumerId, runExternalId: null },
      project: { cwd: profile.packageDir, projectId: null },
      runtime: {
        id: "codex",
        requiredCapabilities: ["planMode"],
        executionProfile: "batch",
        policyGrant: null,
      },
      mode: "plan",
      provider: { profileId: null, model: null },
      input: { contract: "example.local-package.v1" },
      artifacts: {
        baseDir: runDir ? profile.artifactBaseDir : null,
        writePolicy: "metadata-only",
      },
      prompt: "Review this local package.",
    },
    projectId: "project-1",
    apiConsumerId: consumerId,
    apiConsumerRunId: null,
    artifactBaseDir: runDir,
    artifactManifestPath: runDir ? join(runDir, "artifacts.json") : null,
    createdByVersion: "0.0.async-red",
  })
  return id
}

/** Claims a queued Run through the existing claim owner `startAgentJob`. */
export async function claimAs(
  profile: Profile,
  jobId: string,
  worker: { workerId: string; workerPid: number | null },
): Promise<void> {
  const { startAgentJob } = await import("../src/main/lib/headless/job-store")
  await startAgentJob(profile.db, { jobId, ...worker })
}

export type LockSpec = {
  pid: "self" | "dead" | "init"
  lockFormat?: number
  apiCapable?: boolean
  heartbeatOffsetMs?: number
  nonce: string
} | null

export function lockPid(symbol: "self" | "dead" | "init"): number {
  if (symbol === "self") return process.pid
  if (symbol === "init") return 1
  const child = Bun.spawnSync(["true"])
  return child.pid
}

/** Writes a daemon lock fixture (lock v2 when lockFormat is given). */
export function writeLock(
  path: string,
  spec: LockSpec,
  nowMs = Date.now(),
): string | null {
  if (!spec) return null
  const body: Record<string, unknown> = {
    pid: lockPid(spec.pid),
    nonce: spec.nonce,
    startedAt: new Date(nowMs - 60_000).toISOString(),
  }
  if (spec.lockFormat !== undefined) body.lockFormat = spec.lockFormat
  if (spec.apiCapable !== undefined) body.apiCapable = spec.apiCapable
  if (spec.heartbeatOffsetMs !== undefined) {
    body.heartbeatAt = new Date(nowMs + spec.heartbeatOffsetMs).toISOString()
  }
  const text = JSON.stringify(body)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
  return text
}

export function readFileOrNull(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null
}

/** Readiness ports that never probe a real runtime (discovery tests). */
export const READINESS_STUB = {
  hasAnyClaudeCodeAccount: () => false,
  getExistingClaudeCredentials: () => null,
  getCodexExecutableStatus: () => ({
    ok: true,
    path: "/fixture/codex",
    exists: true,
    isExecutable: true,
    error: null,
    hint: null,
  }),
  getCodexRuntimeStatus: async () => ({
    components: [{ id: "login", status: "ready", error: null, hint: null }],
  }),
}

/**
 * Neutral consumer preflight — documentation example only (tasks.md:88):
 * a consumer that reads `features` and refuses to dispatch an addition the
 * build does not advertise. Its spy is not evidence about the Locus parser.
 */
export function consumerPreflight(
  discovery: { apiVersion?: unknown; features?: unknown },
  feature: string,
  dispatch: () => void,
): "unsupported" | "dispatched" {
  const features = Array.isArray(discovery.features) ? discovery.features : []
  if (discovery.apiVersion !== API_VERSION || !features.includes(feature)) {
    return "unsupported"
  }
  dispatch()
  return "dispatched"
}

/** Polls `predicate` (real time) until true or `ms` elapse. */
export async function until(
  predicate: () => boolean,
  ms: number,
): Promise<boolean> {
  const deadline = performance.now() + ms
  while (performance.now() < deadline) {
    if (predicate()) return true
    await realDelay(10)
  }
  return predicate()
}
