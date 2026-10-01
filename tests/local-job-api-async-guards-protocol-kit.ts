// biome-ignore-all lint/suspicious/noExplicitAny: coordinator adjudication (red suite, CI PR-base lint ratchet) — untyped guard/stdio fixture plumbing; no assertion changed
/**
 * Shared harness for the add-local-job-api-async-submit guards-protocol red
 * suite (S29, S30, S31, S32, S33, S47-S51). Independent red-suite author;
 * written before any implementation exists. It drives only public entry
 * points (the in-process headless CLI, the jobs-stdio command, schedule
 * evaluation, the architecture guard script) plus the design-named seams
 * (run-submission.ts submitRun/waitForRun, daemon.ts pumpQueuedRuns and the
 * job-store startAgentJob claim), which are always loaded lazily inside a
 * test so a missing seam fails that test instead of the file.
 */
import { Database } from "bun:sqlite"
import { spyOn } from "bun:test"
import { spawnSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough, Readable } from "node:stream"
import * as schema from "../src/main/lib/db/schema"
import type {
  AgentRuntimeObserver,
  AgentRuntimeRunRequest,
  AgentRuntimeRunResult,
  AgentTaskRunner,
} from "../src/main/lib/headless/agent-runtime-contract"
import { HEADLESS_CLI_MARKER } from "../src/main/lib/headless/cli-args"
import { runHeadlessCliCommand } from "../src/main/lib/headless/cli-dispatcher"
import { HEADLESS_EXIT_CODES } from "../src/main/lib/headless/job-runner"
import * as jobStore from "../src/main/lib/headless/job-store"
import {
  createMigratedLedgerDb,
  type MigratedLedgerDb,
  settledResult,
} from "./run-event-ledger-domain-b-kit"

export { settledResult }

export const REPO_ROOT = join(import.meta.dir, "..")
export const FIXTURE_DIR = join(
  import.meta.dir,
  "fixtures",
  "local-job-api-async",
  "guards-protocol",
)
export const RUN_SUBMISSION_MODULE = join(
  REPO_ROOT,
  "src/main/lib/headless/run-submission.ts",
)
export const DAEMON_MODULE = join(REPO_ROOT, "src/main/lib/headless/daemon.ts")
export const ARCHITECTURE_FIXTURE_DEFAULT_PATH =
  "tests/fixtures/local-job-api-async/guards-protocol/architecture-fixtures.json"
/** Frozen guard CLI flag (design silent; mirrors --run-event-ledger-fixtures=). */
export const ASYNC_GUARD_FIXTURE_FLAG = "--local-job-api-async-fixtures="
/** Frozen guard summary / mismatch wording (mirrors the run event ledger self-test). */
export const ASYNC_GUARD_LABEL =
  "Local job API async submission guard self-test"
export const GUARD_TIMEOUT_MS = 180_000
export const PROTOCOL_TEST_TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export function loadFixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as T
}

export function fixtureCase<T = any>(name: string, scenario: string): T {
  const fixture = loadFixture(name)
  const entry = fixture.cases?.[scenario]
  if (!entry) throw new Error(`${name} has no case ${scenario}`)
  return entry as T
}

/** Replace every "<PROJECT_CWD>" placeholder in a JSON-shaped value. */
export function withProjectCwd<T>(value: T, cwd: string): T {
  return JSON.parse(JSON.stringify(value).split("<PROJECT_CWD>").join(cwd)) as T
}

// ---------------------------------------------------------------------------
// Deferred latches
// ---------------------------------------------------------------------------

export type Deferred<T = void> = {
  promise: Promise<T>
  resolve: (value: T) => void
  settled: () => boolean
}

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void
  let done = false
  const promise = new Promise<T>((r) => {
    resolve = (value: T) => {
      done = true
      r(value)
    }
  })
  return { promise, resolve, settled: () => done }
}

function gate(map: Map<string, Deferred>, key: string): Deferred {
  let entry = map.get(key)
  if (!entry) {
    entry = deferred()
    map.set(key, entry)
  }
  return entry
}

/** Bounded event-driven wait (no fixed sleeps in assertions). */
export async function waitFor<T>(
  probe: () => T | null | undefined | false,
  label: string,
  timeoutMs = 5_000,
): Promise<T> {
  const deadline = performance.now() + timeoutMs
  while (true) {
    const value = probe()
    if (value) return value as T
    if (performance.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs} ms waiting for ${label}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

// ---------------------------------------------------------------------------
// Temporary migrated database + registered temp project
// ---------------------------------------------------------------------------

export type GuardsProtocolDb = MigratedLedgerDb & {
  projectId: string
  projectCwd: string
}

const openDbs: GuardsProtocolDb[] = []

export function createRegisteredProjectDb(
  options: Parameters<typeof createMigratedLedgerDb>[0] = {},
): GuardsProtocolDb {
  const migrated = createMigratedLedgerDb(options)
  const projectCwd = realpathSync(join(migrated.dir))
  const projectDir = join(projectCwd, "project")
  mkdirSync(projectDir, { recursive: true })
  const projectId = "guards-protocol-project"
  migrated.db
    .insert(schema.projects)
    .values({
      id: projectId,
      name: "Guards protocol project",
      path: realpathSync(projectDir),
    })
    .run()
  const value: GuardsProtocolDb = {
    ...migrated,
    projectId,
    projectCwd: realpathSync(projectDir),
  }
  openDbs.push(value)
  return value
}

export function closeOpenDbs(): void {
  while (openDbs.length > 0) {
    ;(openDbs.pop() as GuardsProtocolDb).close()
  }
}

export function eventRows(sqlite: Database, jobId: string): any[] {
  return sqlite
    .query(
      "SELECT sequence, type, fact_key, payload_json FROM agent_job_events WHERE job_id = ? ORDER BY sequence ASC",
    )
    .all(jobId) as any[]
}

export function countEvents(
  sqlite: Database,
  jobId: string,
  type: string,
): number {
  return (
    sqlite
      .query(
        "SELECT COUNT(*) AS n FROM agent_job_events WHERE job_id = ? AND type = ?",
      )
      .get(jobId, type) as {
      n: number
    }
  ).n
}

export function jobRowOf(sqlite: Database, jobId: string): any {
  return sqlite.query("SELECT * FROM agent_jobs WHERE id = ?").get(jobId)
}

export function idempotencyTableRowCounts(
  sqlite: Database,
): Record<string, number> {
  const tables = (
    sqlite
      .query("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[]
  )
    .map((row) => row.name)
    .filter((name) => /idempot/i.test(name))
  return Object.fromEntries(
    tables.map((name) => [
      name,
      (
        sqlite.query(`SELECT COUNT(*) AS n FROM "${name}"`).get() as {
          n: number
        }
      ).n,
    ]),
  )
}

// ---------------------------------------------------------------------------
// Fake runtime runner with latches (no real runtimes, credentials or network)
// ---------------------------------------------------------------------------

export type LatchedRunner = {
  runner: AgentTaskRunner
  invocations: Map<
    string,
    { prompt: string; abortObserved: boolean; returned: boolean }
  >
  /** Let a running job finish successfully. */
  release: (jobId: string) => void
  /** Let a worker that observed cancellation return its canceled result. */
  releaseCancel: (jobId: string) => void
}

export function createLatchedRunner(): LatchedRunner {
  const invocations: LatchedRunner["invocations"] = new Map()
  const releases = new Map<string, Deferred>()
  const cancelPauses = new Map<string, Deferred>()
  const runner: AgentTaskRunner = async (
    request: AgentRuntimeRunRequest,
    observer: AgentRuntimeObserver,
  ): Promise<AgentRuntimeRunResult> => {
    const jobId = request.identity.jobId
    const record = {
      prompt: request.prompt,
      abortObserved: false,
      returned: false,
    }
    invocations.set(jobId, record)
    observer.appendEvent("status", { fixture: true, status: "running" })
    const release = gate(releases, jobId)
    const aborted = deferred()
    if (request.signal.aborted) aborted.resolve()
    request.signal.addEventListener("abort", () => aborted.resolve(), {
      once: true,
    })
    // The worker keeps heartbeating like a real runtime so a cancel request
    // reaches it either through the session signal or the store heartbeat.
    const ticker = setInterval(() => {
      if (!aborted.settled() && !release.settled()) observer.heartbeat()
    }, 25)
    const outcome = await Promise.race([
      release.promise.then(() => "released" as const),
      aborted.promise.then(() => "aborted" as const),
    ])
    clearInterval(ticker)
    if (outcome === "aborted") {
      record.abortObserved = true
      await gate(cancelPauses, jobId).promise
      record.returned = true
      return {
        status: "canceled",
        exitCode: HEADLESS_EXIT_CODES.canceled,
        errorCode: "job_canceled",
        errorMessage: "Job was canceled.",
      }
    }
    observer.appendEvent("assistant_delta", { fixture: true, text: "OK" })
    record.returned = true
    return { status: "succeeded", exitCode: 0, result: { finalMessage: "OK" } }
  }
  return {
    runner,
    invocations,
    release: (jobId) => gate(releases, jobId).resolve(),
    releaseCancel: (jobId) => gate(cancelPauses, jobId).resolve(),
  }
}

// ---------------------------------------------------------------------------
// Claim latch on the design-named claim primitive (design.md:122, :187:
// the pump claims through startAgentJob). Holds the claim of jobs whose
// prompt carries HOLD_CLAIM_MARKER until released.
// ---------------------------------------------------------------------------

export const HOLD_CLAIM_MARKER = "[hold-claim]"

export type ClaimLatch = {
  attempts: string[]
  release: (jobId: string) => void
  attempted: (jobId: string) => boolean
  /** Settlement of the real claim after release (fulfilled=false: claim lost). */
  settlement: (
    jobId: string,
  ) => Promise<{ fulfilled: boolean; reason?: string }> | undefined
}

export function installClaimLatch(): ClaimLatch {
  const real = jobStore.startAgentJob
  const holds = new Map<string, Deferred>()
  const settlements = new Map<
    string,
    Promise<{ fulfilled: boolean; reason?: string }>
  >()
  const attempts: string[] = []
  spyOn(jobStore, "startAgentJob").mockImplementation((async (
    db: Parameters<typeof real>[0],
    input: Parameters<typeof real>[1],
  ) => {
    attempts.push(input.jobId)
    const prompt = jobStore.getAgentJobPrompt(db, input.jobId)
    if (prompt.includes(HOLD_CLAIM_MARKER))
      await gate(holds, input.jobId).promise
    const claim = real(db, input)
    settlements.set(
      input.jobId,
      settledResult(() => claim) as Promise<{
        fulfilled: boolean
        reason?: string
      }>,
    )
    return claim
  }) as typeof real)
  return {
    attempts,
    release: (jobId) => gate(holds, jobId).resolve(),
    attempted: (jobId) => attempts.includes(jobId),
    settlement: (jobId) => settlements.get(jobId),
  }
}

// ---------------------------------------------------------------------------
// Recording seams (loaded lazily; absence is reported, never thrown at load)
// ---------------------------------------------------------------------------

export type SeamRecorder = {
  available: { submitRun: string; waitForRun: string; pumpQueuedRuns: string }
  submitCalls: unknown[][] | null
  /** Resolved values returned by each recorded submitRun call. */
  submitReturns: () => Promise<unknown[]>
  pumpCalls: unknown[][] | null
}

export async function installRecordingSeams(): Promise<SeamRecorder> {
  const submission = await settledResult(() => import(RUN_SUBMISSION_MODULE))
  const daemon = await settledResult(() => import(DAEMON_MODULE))
  const submissionModule = submission.fulfilled
    ? (submission.value as any)
    : null
  const daemonModule = daemon.fulfilled ? (daemon.value as any) : null
  const recorder: SeamRecorder = {
    available: {
      submitRun: typeof submissionModule?.submitRun,
      waitForRun: typeof submissionModule?.waitForRun,
      pumpQueuedRuns: typeof daemonModule?.pumpQueuedRuns,
    },
    submitCalls: null,
    submitReturns: async () => [],
    pumpCalls: null,
  }
  if (typeof submissionModule?.submitRun === "function") {
    // Pass-through spy: the original submitRun still runs.
    const spy = spyOn(submissionModule, "submitRun")
    recorder.submitCalls = spy.mock.calls as unknown[][]
    recorder.submitReturns = () =>
      Promise.all(
        spy.mock.results.map((result) => Promise.resolve(result.value)),
      )
  }
  if (typeof daemonModule?.pumpQueuedRuns === "function") {
    const spy = spyOn(daemonModule, "pumpQueuedRuns")
    recorder.pumpCalls = spy.mock.calls as unknown[][]
  }
  return recorder
}

/** Union of every admittedIds array/set passed to one pumpQueuedRuns call. */
export function admittedIdsOf(call: unknown[]): string[] | null {
  for (const argument of call) {
    if (
      argument &&
      typeof argument === "object" &&
      "admittedIds" in (argument as object)
    ) {
      const ids = (argument as { admittedIds: unknown }).admittedIds
      if (
        ids &&
        typeof (ids as Iterable<unknown>)[Symbol.iterator] === "function"
      ) {
        return Array.from(ids as Iterable<unknown>).map(String)
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// In-process CLI and jobs-stdio sessions
// ---------------------------------------------------------------------------

export type LineCapture = {
  stream: { write(chunk: string | Uint8Array): boolean }
  text: () => string
  lines: any[]
  onLine: (hook: (line: any) => void) => void
}

export function captureLines(parseJson: boolean): LineCapture {
  let text = ""
  let buffer = ""
  const lines: any[] = []
  const hooks: ((line: any) => void)[] = []
  return {
    stream: {
      write(chunk) {
        const value =
          typeof chunk === "string"
            ? chunk
            : Buffer.from(chunk).toString("utf8")
        text += value
        buffer += value
        let index = buffer.indexOf("\n")
        while (index >= 0) {
          const raw = buffer.slice(0, index)
          buffer = buffer.slice(index + 1)
          if (raw.length > 0) {
            let line: any = raw
            if (parseJson) {
              // Non-JSON stdout is recorded as a raw marker, never dropped.
              line = /^\s*[{[]/.test(raw) ? JSON.parse(raw) : { __nonJson: raw }
            }
            lines.push(line)
            for (const hook of hooks) hook(line)
          }
          index = buffer.indexOf("\n")
        }
        return true
      },
    },
    text: () => text,
    lines,
    onLine: (hook) => hooks.push(hook),
  }
}

export async function runCli(
  db: unknown,
  argv: string[],
  options: {
    stdin?: string
    runner?: AgentTaskRunner | null
    env?: NodeJS.ProcessEnv
  } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout = captureLines(false)
  const stderr = captureLines(false)
  const code = await runHeadlessCliCommand({
    db: db as any,
    argv: ["Locus", HEADLESS_CLI_MARKER, ...argv],
    stdin: Readable.from([options.stdin ?? ""]),
    stdout: stdout.stream,
    stderr: stderr.stream,
    runner: options.runner ?? null,
    env: options.env ?? {},
  })
  return { code, stdout: stdout.text(), stderr: stderr.text() }
}

export type StdioSession = {
  stdout: LineCapture
  stderr: LineCapture
  send: (message: unknown) => void
  request: (
    message: { id: string | number; [key: string]: unknown },
    timeoutMs?: number,
  ) => Promise<any>
  end: () => void
  exit: Promise<{ code: number; at: number }>
  responseFor: (id: string | number) => any
  notifications: (method: string, jobId?: string) => any[]
}

export function startStdioSession(input: {
  db: unknown
  runner: AgentTaskRunner
  env?: NodeJS.ProcessEnv
}): StdioSession {
  const stdin = new PassThrough()
  const stdout = captureLines(true)
  const stderr = captureLines(false)
  const exit = runHeadlessCliCommand({
    db: input.db as any,
    argv: ["Locus", HEADLESS_CLI_MARKER, "jobs-stdio"],
    stdin,
    stdout: stdout.stream,
    stderr: stderr.stream,
    runner: input.runner,
    env: input.env ?? {},
  }).then((code) => ({ code, at: performance.now() }))
  const responseFor = (id: string | number) =>
    stdout.lines.find(
      (line) =>
        line &&
        typeof line === "object" &&
        line.id === id &&
        !("method" in line),
    )
  return {
    stdout,
    stderr,
    send: (message) => {
      stdin.write(`${JSON.stringify(message)}\n`)
    },
    request: async (message, timeoutMs = 5_000) => {
      stdin.write(`${JSON.stringify(message)}\n`)
      return waitFor(
        () => responseFor(message.id),
        `jobs-stdio response ${String(message.id)}`,
        timeoutMs,
      )
    },
    end: () => {
      stdin.end()
    },
    exit,
    responseFor,
    notifications: (method, jobId) =>
      stdout.lines.filter(
        (line) =>
          line &&
          typeof line === "object" &&
          line.method === method &&
          (jobId === undefined || line.params?.jobId === jobId),
      ),
  }
}

// ---------------------------------------------------------------------------
// Architecture guard driver (scripts/check-architecture-guards.mjs)
// ---------------------------------------------------------------------------

export type GuardRun = { status: number | null; output: string }

const tempDirs: string[] = []

export function cleanupTempDirs(): void {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true })
  }
}

export function writeTempFixture(value: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), "async-guard-fixture-"))
  tempDirs.push(directory)
  const path = join(directory, "architecture-fixtures.json")
  writeFileSync(path, JSON.stringify(value, null, 2))
  return path
}

export function runArchitectureGuard(args: string[] = []): GuardRun {
  const run = spawnSync(
    "node",
    ["scripts/check-architecture-guards.mjs", ...args],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: GUARD_TIMEOUT_MS - 10_000,
    },
  )
  return { status: run.status, output: `${run.stdout}${run.stderr}` }
}

/** Same key the run event ledger self-test prints (sorted [key, value] pairs). */
export function guardFindingKey(finding: Record<string, string>): string {
  return JSON.stringify(
    Object.keys(finding)
      .sort()
      .map((key) => [key, finding[key]]),
  )
}

export function fixtureSubset(fixture: any, scenario: string): any {
  return {
    ...fixture,
    cases: fixture.cases.filter((entry: any) => entry.scenario === scenario),
  }
}

export function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8")
}

export { Database }

/** Cycle-safe deep search for a string value (admission shapes are not frozen). */
export function containsString(
  value: unknown,
  needle: string,
  seen = new WeakSet<object>(),
): boolean {
  if (value === needle) return true
  if (!value || typeof value !== "object") return false
  if (seen.has(value as object)) return false
  seen.add(value as object)
  return Object.values(value as Record<string, unknown>).some((item) =>
    containsString(item, needle, seen),
  )
}
