/**
 * Implementer-units for the Phase II review P3s of
 * add-local-job-api-async-submit (design D5):
 * - the daemon tick settles over-age admitted queued API Runs without a
 *   claim (queued_age_exceeded, exit 1), bounded per tick;
 * - the gate-opened run-dir handle is closed when ledger/runner setup throws;
 * - an API agent row without its stored cwd identity fails closed with
 *   cwd_identity_changed instead of falling back to path equality.
 */
import {
  afterEach,
  beforeEach,
  expect,
  setSystemTime,
  spyOn,
  test,
} from "bun:test"
import { existsSync } from "node:fs"
import * as ledgerHost from "../src/main/lib/agent-runtime/run-event-ledger-host"
import { runPersistedCompletionJob } from "../src/main/lib/headless/completion-runner"
import {
  MAX_QUEUED_API_AGE_MS,
  pumpQueuedRuns,
  runLocalAgentDaemon,
} from "../src/main/lib/headless/daemon"
import { runPersistedAgentJob } from "../src/main/lib/headless/job-runner"
import { settleQueuedAgentJobFailed } from "../src/main/lib/headless/job-store"
import {
  OVER_AGE_QUEUED_API_SETTLEMENT_LIMIT,
  settleOverAgeQueuedLocalJobApiRuns,
} from "../src/main/lib/headless/local-job-api"
import { clearRuntimeReadinessCacheForTest } from "../src/main/lib/headless/runtime-readiness"
import {
  agentRequest,
  claimAs,
  cli,
  completionRequest,
  controlledRunner,
  countType,
  createProfile,
  eventRows,
  FIXED_NOW_ISO,
  jobRowById,
  jsonLines,
  type Profile,
  seedProviderProfile,
  seedQueuedApiJob,
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
const OVER_AGE_NOW = new Date(Date.parse(FIXED_NOW_ISO) + MAX_QUEUED_API_AGE_MS)

async function submitId(p: Profile, request: unknown): Promise<string> {
  const submitted = await cli(p, SUBMIT, { stdin: JSON.stringify(request) })
  expect(submitted.code).toBe(0)
  return jsonLines(submitted.stdout)[0]?.job?.id as string
}

function completedReasons(p: Profile, jobId: string): unknown {
  const row = eventRows(p, jobId).find((event) => event.type === "completed")
  return row ? JSON.parse(row.payload_json ?? "null")?.reasons : undefined
}

function reservationExpiry(p: Profile, jobId: string): unknown {
  return (
    p.sqlite
      .query("SELECT expires_at FROM agent_job_idempotency WHERE job_id = ?")
      .get(jobId) as { expires_at: unknown } | null
  )?.expires_at
}

// ---------------------------------------------------------------------------
// Over-age settlement on the daemon tick
// ---------------------------------------------------------------------------

test("the daemon tick settles an over-age admitted queued API Run without a claim (queued_age_exceeded, exit 1, no terminal refs)", async () => {
  const p = profile()
  const run = controlledRunner()
  const artifactId = await submitId(p, {
    ...agentRequest(p, {}, { artifacts: true }),
    idempotencyKey: "t1-over-age",
  })
  const freeId = await submitId(
    p,
    agentRequest(p, { consumer: { id: "fixture-a", runExternalId: "free" } }),
  )
  const unadmittedId = await seedQueuedApiJob(p, { artifacts: true })
  // Younger control: created one second later, still below the bound.
  setSystemTime(new Date(Date.parse(FIXED_NOW_ISO) + 1000))
  const youngerId = await submitId(
    p,
    agentRequest(p, { consumer: { id: "fixture-a", runExternalId: "young" } }),
  )
  setSystemTime(new Date(FIXED_NOW_ISO))
  const runDir = jobRowById(p, artifactId)?.artifact_base_dir as string

  // A plain (lock-less) daemon never claims API Runs: only the tick settles.
  await runLocalAgentDaemon({
    db: p.db,
    once: true,
    lockPath: null,
    runner: run.runner,
    now: OVER_AGE_NOW,
    pollIntervalMs: 100,
  })

  const waited = await cli(p, [
    "api",
    "runs",
    "wait",
    artifactId,
    "--timeout",
    "0",
    "--json",
  ])
  const waitLine = jsonLines(waited.stdout)[0]
  const project = (jobId: string) => {
    const row = jobRowById(p, jobId)
    return {
      status: row?.status,
      errorCode: row?.error_code,
      exitCode: row?.exit_code,
      workerId: row?.worker_id,
      started: countType(p, jobId, "job_started"),
      completed: countType(p, jobId, "completed"),
      reasons: completedReasons(p, jobId),
    }
  }
  const settled = {
    status: "failed",
    errorCode: "queued_age_exceeded",
    exitCode: 1,
    workerId: null,
    started: 0,
    completed: 1,
    reasons: expect.arrayContaining(["queued_age_exceeded"]),
  }
  expect({
    artifact: project(artifactId),
    free: project(freeId),
    unadmitted: jobRowById(p, unadmittedId)?.status,
    younger: jobRowById(p, youngerId)?.status,
    runnerCalls: run.calls.length,
    waitExit: waited.code,
    waitArtifacts: waitLine?.result?.artifacts,
    resultFile: existsSync(`${runDir}/result.json`),
    expirySet: reservationExpiry(p, artifactId) !== null,
  }).toEqual({
    artifact: settled,
    free: settled,
    unadmitted: "queued",
    younger: "queued",
    runnerCalls: 0,
    waitExit: 1,
    waitArtifacts: [],
    resultFile: false,
    expirySet: true,
  })
}, 30_000)

test("the over-age tick settlement is bounded per tick, oldest first", async () => {
  const p = profile()
  const ids: string[] = []
  const total = OVER_AGE_QUEUED_API_SETTLEMENT_LIMIT + 2
  for (let index = 0; index < total; index += 1) {
    setSystemTime(new Date(Date.parse(FIXED_NOW_ISO) + index * 1000))
    ids.push(
      await submitId(
        p,
        agentRequest(p, {
          consumer: { id: "fixture-a", runExternalId: `bound-${index}` },
        }),
      ),
    )
  }
  setSystemTime(new Date(FIXED_NOW_ISO))
  const now = new Date(Date.parse(FIXED_NOW_ISO) + MAX_QUEUED_API_AGE_MS * 2)

  const first = await settleOverAgeQueuedLocalJobApiRuns(p.db, {
    now,
    maxQueuedApiAgeMs: MAX_QUEUED_API_AGE_MS,
  })
  const statusesAfterFirst = ids.map((id) => jobRowById(p, id)?.status)
  const second = await settleOverAgeQueuedLocalJobApiRuns(p.db, {
    now,
    maxQueuedApiAgeMs: MAX_QUEUED_API_AGE_MS,
  })

  expect({
    firstCount: first.length,
    firstIds: first.map((job) => job.id),
    queuedAfterFirst: ids.filter(
      (_, index) => statusesAfterFirst[index] === "queued",
    ),
    secondIds: second.map((job) => job.id),
  }).toEqual({
    firstCount: OVER_AGE_QUEUED_API_SETTLEMENT_LIMIT,
    firstIds: ids.slice(0, OVER_AGE_QUEUED_API_SETTLEMENT_LIMIT),
    queuedAfterFirst: ids.slice(OVER_AGE_QUEUED_API_SETTLEMENT_LIMIT),
    secondIds: ids.slice(OVER_AGE_QUEUED_API_SETTLEMENT_LIMIT),
  })
}, 30_000)

test("the over-age settlement leaves a Run an executor already claimed to that claimant", async () => {
  const p = profile()
  const jobId = await submitId(p, agentRequest(p))
  await claimAs(p, jobId, {
    workerId: `daemon:${process.pid}:t1-claim:${jobId}`,
    workerPid: process.pid,
  })
  await expect(
    settleQueuedAgentJobFailed(p.db, jobId, {
      errorCode: "queued_age_exceeded",
      errorMessage: "over age",
      reasons: ["queued_age_exceeded"],
      observationKey: `queued-age-exceeded:${jobId}`,
      requireUnclaimed: true,
    }),
  ).rejects.toThrow()
  expect({
    status: jobRowById(p, jobId)?.status,
    completed: countType(p, jobId, "completed"),
  }).toEqual({ status: "running", completed: 0 })
}, 20_000)

// ---------------------------------------------------------------------------
// Gate-opened handle closes when setup throws after the gate
// ---------------------------------------------------------------------------

test("a ledger setup failure after the claim gate opened the run dir still closes the handle (agent and completion runners)", async () => {
  const p = profile()
  seedProviderProfile(p, { id: "completion-main", targets: ["codex"] })
  const agentId = await submitId(p, agentRequest(p, {}, { artifacts: true }))
  const completionId = await submitId(p, completionRequest())
  const closes: string[] = []
  let ledgerSpy: { mockRestore(): void } | null = null
  const failingGate = (jobId: string) => async () => {
    // The gate has opened its handle; the next ledger composition throws.
    ledgerSpy = spyOn(
      ledgerHost,
      "getOrCreateRunEventLedger",
    ).mockImplementation(async () => {
      throw new Error("ledger setup failed")
    })
    return { kind: "proceed" as const, close: () => closes.push(jobId) }
  }
  const run = controlledRunner()
  try {
    await expect(
      runPersistedAgentJob({
        db: p.db,
        jobId: agentId,
        runner: run.runner,
        claimGate: failingGate(agentId),
      }),
    ).rejects.toThrow("ledger setup failed")
  } finally {
    ledgerSpy?.mockRestore()
    ledgerSpy = null
  }
  try {
    await expect(
      runPersistedCompletionJob({
        db: p.db,
        jobId: completionId,
        claimGate: failingGate(completionId),
      }),
    ).rejects.toThrow("ledger setup failed")
  } finally {
    ledgerSpy?.mockRestore()
    ledgerSpy = null
  }
  expect({ closes, runnerCalls: run.calls.length }).toEqual({
    closes: [agentId, completionId],
    runnerCalls: 0,
  })
}, 20_000)

// ---------------------------------------------------------------------------
// Missing stored cwd identity fails closed
// ---------------------------------------------------------------------------

test("an API agent row without its stored cwd identity fails closed with cwd_identity_changed (exit 7) and zero runner calls", async () => {
  const p = profile()
  const run = controlledRunner()
  const strippedId = await submitId(p, agentRequest(p))
  const controlId = await submitId(
    p,
    agentRequest(p, { consumer: { id: "fixture-a", runExternalId: "ctrl" } }),
  )
  const row = jobRowById(p, strippedId)
  const input = JSON.parse(row.input_json)
  delete input.submissionContext
  p.sqlite
    .query("UPDATE agent_jobs SET input_json = ? WHERE id = ?")
    .run(JSON.stringify(input), strippedId)

  await pumpQueuedRuns({
    db: p.db,
    admittedIds: [strippedId],
    runner: run.runner,
  })
  const strippedCalls = run.calls.length
  await pumpQueuedRuns({
    db: p.db,
    admittedIds: [controlId],
    runner: run.runner,
  })

  const stripped = jobRowById(p, strippedId)
  expect({
    status: stripped?.status,
    errorCode: stripped?.error_code,
    exitCode: stripped?.exit_code,
    reasons: completedReasons(p, strippedId),
    strippedCalls,
    controlStatus: jobRowById(p, controlId)?.status,
    controlCalls: run.calls.length - strippedCalls,
  }).toEqual({
    status: "failed",
    errorCode: "cwd_identity_changed",
    exitCode: 7,
    reasons: expect.arrayContaining(["cwd_identity_changed"]),
    strippedCalls: 0,
    controlStatus: "succeeded",
    controlCalls: 1,
  })
}, 20_000)

// ---------------------------------------------------------------------------
// Claim-gate exception: the documented internal fallback
// ---------------------------------------------------------------------------

test("an unexpected claim-gate exception settles the documented internal fallback (claim_gate_failed, internal_error, exit 8) without runner calls", async () => {
  const p = profile()
  const run = controlledRunner()
  const jobId = await submitId(p, agentRequest(p))
  const result = await runPersistedAgentJob({
    db: p.db,
    jobId,
    runner: run.runner,
    claimGate: () => {
      throw new Error("unexpected gate failure")
    },
  })
  const row = jobRowById(p, jobId)
  expect({
    exitCode: result.exitCode,
    status: row?.status,
    errorCode: row?.error_code,
    rowExit: row?.exit_code,
    reasons: completedReasons(p, jobId),
    completed: countType(p, jobId, "completed"),
    runnerCalls: run.calls.length,
  }).toEqual({
    exitCode: 8,
    status: "failed",
    errorCode: "internal_error",
    rowExit: 8,
    reasons: expect.arrayContaining(["claim_gate_failed"]),
    completed: 1,
    runnerCalls: 0,
  })
}, 20_000)
