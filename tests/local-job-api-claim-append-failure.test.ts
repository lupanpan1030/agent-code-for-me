/** biome-ignore-all lint/suspicious/noExplicitAny: the harness drives the CLI and daemon with structural fakes. */
/**
 * Implementer-unit for the final design review F1/F2
 * (add-local-job-api-async-submit). A claim whose `job_started` append fails
 * without a competing claim leaves this host's cached ledger halted; the
 * claim owner drops it, so the same process can still cancel or settle the
 * Run. The create/default-retry wrapper then reports the baseline error and
 * its own Run ends canceled; a daemon still settles the Run when it ages
 * out.
 */
import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test"
import {
  MAX_QUEUED_API_AGE_MS,
  runLocalAgentDaemon,
} from "../src/main/lib/headless/daemon"
import { clearRuntimeReadinessCacheForTest } from "../src/main/lib/headless/runtime-readiness"
import {
  agentRequest,
  apiJobRows,
  cli,
  countType,
  createProfile,
  FIXED_NOW_ISO,
  faultableDb,
  jobRowById,
  jsonLines,
  type Profile,
  realDelay,
} from "./local-job-api-async-submit-wait-kit"

const cleanups: Array<() => void> = []

function profile(): Profile {
  const created = createProfile()
  cleanups.push(created.cleanup)
  return created
}

beforeEach(() => {
  setSystemTime()
  clearRuntimeReadinessCacheForTest()
})

afterEach(() => {
  setSystemTime()
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

const CREATE = ["api", "runs", "create", "--request", "-", "--json"]
const SUBMIT = ["api", "runs", "submit", "--request", "-", "--json"]

/**
 * A connection whose `job_started` inserts fail with SQLITE_BUSY (as a
 * busy store past busy_timeout would): every time, or the first `times`.
 */
function failingClaimAppends(p: Profile, times = Number.POSITIVE_INFINITY) {
  const state = { failures: 0 }
  const handle = faultableDb(p, (sql, params) => {
    if (!/^\s*insert into "agent_job_events"/i.test(sql)) return false
    if (!params.includes("job_started")) return false
    if (state.failures >= times) return false
    state.failures += 1
    return true
  })
  cleanups.push(() => handle.sqlite.close())
  return { db: handle.db, state }
}

function countingRunner() {
  const calls = { entered: 0 }
  const runner = async (_request: any, observer: any) => {
    calls.entered += 1
    observer.heartbeat()
    return { exitCode: 0, status: "succeeded", result: { finalMessage: "ok" } }
  }
  return { runner, calls }
}

test("an own-pump create whose claim append fails reports the baseline error with exit 2, no stdout, and its own Run ends canceled", async () => {
  const p = profile()
  const { db, state } = failingClaimAppends(p)
  const { runner, calls } = countingRunner()
  const started = performance.now()
  const created = await cli(p, CREATE, {
    db,
    stdin: JSON.stringify(agentRequest(p)),
    runner,
    lockPath: null,
  })
  const elapsed = performance.now() - started
  const rows = apiJobRows(p)
  expect({
    exit: created.code,
    stdout: created.stdout,
    stderrLines: created.stderr.split("\n").filter(Boolean).length,
    stderrNewline: created.stderr.endsWith("\n"),
    claimAppendFailed: state.failures > 0,
    runner: calls.entered,
    rows: rows.map((row) => [row.status, row.error_code]),
    started: countType(p, rows[0]?.id, "job_started"),
    bounded: elapsed < 10_000,
  }).toEqual({
    exit: 2,
    stdout: "",
    stderrLines: 1,
    stderrNewline: true,
    claimAppendFailed: true,
    runner: 0,
    rows: [["canceled", "job_canceled"]],
    started: 0,
    bounded: true,
  })
}, 30_000)

test("an own-pump default retry whose claim append fails reports the baseline retry exit 3 and its own Run ends canceled", async () => {
  const p = profile()
  const source = await cli(p, CREATE, {
    stdin: JSON.stringify(agentRequest(p)),
    runner: async () => ({
      exitCode: 1,
      status: "failed",
      errorCode: "runtime_error",
      errorMessage: "fixture failure",
    }),
    lockPath: null,
  })
  const sourceId = jsonLines(source.stdout)[0]?.job?.id
  const { db } = failingClaimAppends(p)
  const { runner, calls } = countingRunner()
  const retried = await cli(p, ["api", "runs", "retry", sourceId, "--json"], {
    db,
    runner,
    lockPath: null,
  })
  const child = apiJobRows(p).find((row) => row.retry_of_job_id === sourceId)
  expect({
    sourceExit: source.code,
    exit: retried.code,
    stdout: retried.stdout,
    stderrLines: retried.stderr.split("\n").filter(Boolean).length,
    runner: calls.entered,
    child: child?.status,
  }).toEqual({
    sourceExit: 1,
    exit: 3,
    stdout: "",
    stderrLines: 1,
    runner: 0,
    child: "canceled",
  })
}, 30_000)

test("a daemon whose claim append failed still settles that Run when it ages out and keeps ticking", async () => {
  setSystemTime(new Date(FIXED_NOW_ISO))
  const p = profile()
  const submitted = await cli(p, SUBMIT, {
    stdin: JSON.stringify(agentRequest(p)),
  })
  const jobId = jsonLines(submitted.stdout)[0]?.job?.id as string
  const { db, state } = failingClaimAppends(p)
  const { runner, calls } = countingRunner()
  const stderr: string[] = []
  const abort = new AbortController()
  const daemon = runLocalAgentDaemon({
    db,
    env: {},
    runner: runner as any,
    lockPath: p.lockPath,
    pollIntervalMs: 100,
    signal: abort.signal,
    stderr: { write: (chunk: string) => stderr.push(chunk) } as any,
  })
  // The first ticks claim and fail; then the Run ages past the bound.
  const deadline = performance.now() + 5_000
  while (state.failures === 0 && performance.now() < deadline) {
    await realDelay(20)
  }
  setSystemTime(
    new Date(Date.parse(FIXED_NOW_ISO) + MAX_QUEUED_API_AGE_MS + 1000),
  )
  const settleDeadline = performance.now() + 8_000
  while (
    jobRowById(p, jobId)?.status === "queued" &&
    performance.now() < settleDeadline
  ) {
    await realDelay(50)
  }
  abort.abort()
  const stopped = await Promise.race([
    daemon.then(() => "stopped"),
    realDelay(8_000).then(() => "hung"),
  ])
  const row = jobRowById(p, jobId)
  expect({
    claimAppendFailed: state.failures > 0,
    status: row?.status,
    errorCode: row?.error_code,
    runner: calls.entered,
    stopped,
  }).toEqual({
    claimAppendFailed: true,
    status: "failed",
    errorCode: "queued_age_exceeded",
    runner: 0,
    stopped: "stopped",
  })
}, 30_000)
