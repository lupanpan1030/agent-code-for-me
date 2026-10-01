/** biome-ignore-all lint/suspicious/noExplicitAny: the harness drives the store with structural fakes. */
/**
 * Implementer-unit for the T1 review P3-2 (add-local-job-api-async-submit
 * over-age tick). Only a lost race (commit precondition failed, or a re-read
 * shows the Run claimed or terminal) is silent; any other settlement error
 * is reported with a sanitized code, the daemon writes one `[Daemon]`
 * diagnostic and excludes that Run from later ticks so it cannot starve
 * younger over-age Runs of the per-tick bound.
 */
import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test"
import {
  MAX_QUEUED_API_AGE_MS,
  runLocalAgentDaemon,
} from "../src/main/lib/headless/daemon"
import { settleOverAgeQueuedLocalJobApiRuns } from "../src/main/lib/headless/local-job-api"
import { clearRuntimeReadinessCacheForTest } from "../src/main/lib/headless/runtime-readiness"
import {
  agentRequest,
  cli,
  countType,
  createProfile,
  FIXED_NOW_ISO,
  faultableDb,
  jobRowById,
  jsonLines,
  type Profile,
} from "./local-job-api-async-submit-wait-kit"

const cleanups: Array<() => void> = []

function profile(): Profile {
  const created = createProfile()
  cleanups.push(created.cleanup)
  return created
}

beforeEach(() => {
  setSystemTime(new Date(FIXED_NOW_ISO))
  clearRuntimeReadinessCacheForTest()
})

afterEach(() => {
  setSystemTime()
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

const SUBMIT = ["api", "runs", "submit", "--request", "-", "--json"]
const OVER_AGE_NOW = new Date(
  Date.parse(FIXED_NOW_ISO) + MAX_QUEUED_API_AGE_MS * 2,
)

/** Submits `count` queued API Runs, one second apart (oldest first). */
async function submitRuns(p: Profile, count: number): Promise<string[]> {
  const ids: string[] = []
  for (let index = 0; index < count; index += 1) {
    setSystemTime(new Date(Date.parse(FIXED_NOW_ISO) + index * 1000))
    const submitted = await cli(p, SUBMIT, {
      stdin: JSON.stringify(
        agentRequest(p, {
          consumer: { id: "fixture-a", runExternalId: `over-age-${index}` },
        }),
      ),
    })
    expect(submitted.code).toBe(0)
    ids.push(jsonLines(submitted.stdout)[0]?.job?.id as string)
  }
  setSystemTime(new Date(FIXED_NOW_ISO))
  return ids
}

/** A connection whose reads naming `jobId` fail with SQLITE_BUSY. */
function failingReadsFor(p: Profile, jobId: string) {
  const handle = faultableDb(
    p,
    (sql, params) => /^\s*select/i.test(sql) && params.includes(jobId),
  )
  cleanups.push(() => handle.sqlite.close())
  return handle.db
}

test("a non-race settlement error is reported with a sanitized code and an excluded Run no longer takes a slot of the per-tick bound", async () => {
  const p = profile()
  const [stuck, younger] = await submitRuns(p, 2)
  const db = failingReadsFor(p, stuck)
  const errors: Array<[string, string]> = []
  const first = await settleOverAgeQueuedLocalJobApiRuns(db, {
    now: OVER_AGE_NOW,
    maxQueuedApiAgeMs: MAX_QUEUED_API_AGE_MS,
    limit: 1,
    onSettlementError: (jobId, code) => errors.push([jobId, code]),
  })
  const excluded = new Set(errors.map(([jobId]) => jobId))
  const second = await settleOverAgeQueuedLocalJobApiRuns(db, {
    now: OVER_AGE_NOW,
    maxQueuedApiAgeMs: MAX_QUEUED_API_AGE_MS,
    limit: 1,
    excludeIds: excluded,
    onSettlementError: (jobId, code) => errors.push([jobId, code]),
  })
  expect({
    first: first.map((job) => job.id),
    errors,
    second: second.map((job) => job.id),
    stuck: jobRowById(p, stuck)?.status,
    younger: {
      status: jobRowById(p, younger)?.status,
      errorCode: jobRowById(p, younger)?.error_code,
    },
  }).toEqual({
    first: [],
    errors: [[stuck, "SQLITE_BUSY"]],
    second: [younger],
    stuck: "queued",
    younger: { status: "failed", errorCode: "queued_age_exceeded" },
  })
}, 30_000)

test("a claim that wins between the listing and the settlement commit stays silent", async () => {
  const p = profile()
  const [raced] = await submitRuns(p, 1)
  let claimed = false
  const handle = faultableDb(p, (sql, params) => {
    // The first job-row read inside the settlement: a claimant wins first.
    if (!claimed && /^\s*select/i.test(sql) && params.includes(raced)) {
      claimed = true
      p.sqlite
        .query(
          "UPDATE agent_jobs SET status = 'running', worker_id = ?, worker_pid = ? WHERE id = ?",
        )
        .run(`daemon:${process.pid}:race:${raced}`, process.pid, raced)
    }
    return false
  })
  cleanups.push(() => handle.sqlite.close())
  const errors: Array<[string, string]> = []
  const settled = await settleOverAgeQueuedLocalJobApiRuns(handle.db, {
    now: OVER_AGE_NOW,
    maxQueuedApiAgeMs: MAX_QUEUED_API_AGE_MS,
    onSettlementError: (jobId, code) => errors.push([jobId, code]),
  })
  expect({
    claimed,
    settled: settled.length,
    errors,
    status: jobRowById(p, raced)?.status,
    completed: countType(p, raced, "completed"),
  }).toEqual({
    claimed: true,
    settled: 0,
    errors: [],
    status: "running",
    completed: 0,
  })
}, 30_000)

test("the daemon writes one sanitized [Daemon] diagnostic for a Run it cannot settle, does not retry it on later ticks and still settles younger over-age Runs", async () => {
  const p = profile()
  const [stuck, younger] = await submitRuns(p, 2)
  const db = failingReadsFor(p, stuck)
  let stderr = ""
  const controller = new AbortController()
  const stop = setTimeout(() => controller.abort(), 600)
  try {
    await runLocalAgentDaemon({
      db,
      runner: null,
      stderr: { write: (chunk: string) => (stderr += chunk) },
      pollIntervalMs: 100,
      lockPath: null,
      signal: controller.signal,
      now: OVER_AGE_NOW,
    })
  } finally {
    clearTimeout(stop)
  }
  const diagnostics = stderr.split("\n").filter((line) => line.includes(stuck))
  expect({
    diagnostics,
    rawErrorText: stderr.includes("database is locked"),
    stuck: jobRowById(p, stuck)?.status,
    younger: {
      status: jobRowById(p, younger)?.status,
      errorCode: jobRowById(p, younger)?.error_code,
    },
  }).toEqual({
    diagnostics: [
      `[Daemon] Over-age job ${stuck} was not settled (SQLITE_BUSY); not retried by this daemon.`,
    ],
    rawErrorText: false,
    stuck: "queued",
    younger: { status: "failed", errorCode: "queued_age_exceeded" },
  })
}, 30_000)
