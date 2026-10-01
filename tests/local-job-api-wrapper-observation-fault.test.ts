/** biome-ignore-all lint/suspicious/noExplicitAny: the harness drives the CLI with structural fakes. */
/**
 * Implementer-unit for the Phase III check P3-1 (add-local-job-api-async-submit,
 * local-job-api delta "Non-outcome read failure with an owned child"). A
 * store read failure of the create/default-retry wrapper while its own pump
 * executes the Run stops that execution tree and keeps the baseline stderr
 * text and exit (create 2, retry 3) with no stdout; only a Run another
 * claimant executes gets the identified observation_failed/8 envelope.
 */
import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test"
import { clearRuntimeReadinessCacheForTest } from "../src/main/lib/headless/runtime-readiness"
import {
  agentRequest,
  apiJobRows,
  cli,
  createProfile,
  faultableDb,
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
  setSystemTime()
  clearRuntimeReadinessCacheForTest()
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

const CREATE = ["api", "runs", "create", "--request", "-", "--json"]

/** Job-row reads of the wrapper's observation fail while `failing` is set. */
function faultOnJobReads(p: Profile) {
  const state = { failing: false }
  const handle = faultableDb(
    p,
    (sql) =>
      state.failing && /^\s*select/i.test(sql) && /"agent_jobs"/.test(sql),
  )
  cleanups.push(() => handle.sqlite.close())
  return { db: handle.db, state }
}

/**
 * A runtime that starts the fault once it runs, then blocks until its
 * execution tree is stopped (abort signal) and ends the fault so the
 * runner can settle the stopped Run.
 */
function abortableRunner(state: { failing: boolean }) {
  const calls = { entered: 0, aborted: 0 }
  const runner = async (request: any, observer: any) => {
    calls.entered += 1
    observer.heartbeat()
    await new Promise((resolve) => setTimeout(resolve, 50))
    state.failing = true
    await new Promise<void>((resolve) => {
      if (request.signal.aborted) resolve()
      else request.signal.addEventListener("abort", () => resolve())
    })
    calls.aborted += 1
    state.failing = false
    return { exitCode: null, status: "canceled" }
  }
  return { runner, calls }
}

test("an own-pump create whose store read fails stops the own execution tree and keeps the baseline stderr text and exit 2 with no stdout", async () => {
  const p = profile()
  const { db, state } = faultOnJobReads(p)
  const { runner, calls } = abortableRunner(state)
  const created = await cli(p, CREATE, {
    db,
    stdin: JSON.stringify(agentRequest(p)),
    runner,
    lockPath: null,
  })
  const rows = apiJobRows(p)
  expect({
    exit: created.code,
    stdout: created.stdout,
    stderr: created.stderr,
    runner: calls,
    rows: rows.map((row) => row.status),
  }).toEqual({
    exit: 2,
    stdout: "",
    stderr: "database is locked\n",
    runner: { entered: 1, aborted: 1 },
    // The stopped own Run is settled by its runner, never left executing.
    rows: ["canceled"],
  })
}, 20_000)

test("an own-pump default retry whose store read fails stops the own execution tree and keeps the baseline retry exit 3", async () => {
  const p = profile()
  // A failed source Run to retry, created by an ordinary own-pump create.
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
  const { db, state } = faultOnJobReads(p)
  const { runner, calls } = abortableRunner(state)
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
    stderr: retried.stderr,
    runner: calls,
    child: child?.status,
  }).toEqual({
    sourceExit: 1,
    exit: 3,
    stdout: "",
    stderr: "database is locked\n",
    runner: { entered: 1, aborted: 1 },
    child: "canceled",
  })
}, 20_000)

test("a daemon-first create whose store read fails after a snapshot still prints the identified observation_failed/8 and leaves the Run alone", async () => {
  const p = profile()
  const { db, state } = faultOnJobReads(p)
  const { startAgentJob } = await import("../src/main/lib/headless/job-store")
  let claimedId: string | null = null
  const sibling = Bun.spawn(["sleep", "60"], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  })
  try {
    const created = await cli(p, CREATE, {
      db,
      stdin: JSON.stringify(agentRequest(p)),
      runner: null,
      lockPath: null,
      extra: {
        beforeOwnPumpClaim: async (jobId: string) => {
          await startAgentJob(p.db, {
            jobId,
            workerId: `daemon:${sibling.pid}:observation-fault:${jobId}`,
            workerPid: sibling.pid,
          })
          claimedId = jobId
          // Fault every read after the wrapper's first snapshot.
          setTimeout(() => {
            state.failing = true
          }, 50)
        },
      },
    })
    state.failing = false
    const lines = jsonLines(created.stdout)
    const row = apiJobRows(p)[0]
    expect({
      exit: created.code,
      lineCount: lines.length,
      jobId: lines[0]?.job?.id,
      wait: lines[0]?.wait,
      rowStatus: row?.status,
      cancelRequested: row?.cancel_requested_at !== null,
    }).toEqual({
      exit: 8,
      lineCount: 1,
      jobId: claimedId,
      wait: { state: "error", reason: "observation_failed" },
      rowStatus: "running",
      cancelRequested: false,
    })
  } finally {
    sibling.kill("SIGKILL")
  }
}, 20_000)
