/** biome-ignore-all lint/suspicious/noExplicitAny: the harness drives the CLI with structural fakes. */
/**
 * Implementer-unit for the Codex R1 P1-1 (add-local-job-api-async-submit,
 * design D2): the fresh `runs submit` ack is the fixed queued snapshot of the
 * completed admission. Another process may legitimately claim the Run between
 * that admission and the ack; the ack still prints the queued snapshot (no
 * worker fields) while the store already holds `job_started`.
 */
import {
  afterEach,
  beforeEach,
  expect,
  setSystemTime,
  spyOn,
  test,
} from "bun:test"
import * as localJobApi from "../src/main/lib/headless/local-job-api"
import { clearRuntimeReadinessCacheForTest } from "../src/main/lib/headless/runtime-readiness"
import {
  agentRequest,
  claimAs,
  cli,
  createProfile,
  eventTypes,
  jobRowById,
  onlyJson,
  type Profile,
  secondConnection,
} from "./local-job-api-async-submit-wait-kit"

const cleanups: Array<() => void> = []

beforeEach(() => {
  setSystemTime()
  clearRuntimeReadinessCacheForTest()
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

/**
 * Lets the real initial admission complete, then claims the Run through the
 * real claim owner on a second connection (another process's executor)
 * before the submit core returns its ack.
 */
function claimRightAfterAdmission(p: Profile) {
  const original = localJobApi.admitLocalJobApiInitialArtifacts
  const other = { ...p, db: secondConnection(p) }
  const claimed: string[] = []
  const spy = spyOn(
    localJobApi,
    "admitLocalJobApiInitialArtifacts",
  ).mockImplementation(async (input: any) => {
    const admitted = await original(input)
    await claimAs(other as Profile, input.prepared.job.id, {
      workerId: `daemon:other-process:${input.prepared.job.id}`,
      workerPid: 2_147_000_003,
    })
    claimed.push(input.prepared.job.id)
    return admitted
  })
  cleanups.push(() => spy.mockRestore())
  return claimed
}

for (const artifacts of [true, false]) {
  test(`a claim between admission and the fresh submit ack still prints the queued admission snapshot (${
    artifacts ? "run-dir admission" : "no run dir"
  })`, async () => {
    const p = createProfile()
    cleanups.push(p.cleanup)
    const claimed = claimRightAfterAdmission(p)
    const submitted = await cli(
      p,
      ["api", "runs", "submit", "--request", "-", "--json"],
      {
        stdin: JSON.stringify(agentRequest(p, {}, { artifacts })),
        lockPath: null,
      },
    )
    const ack = onlyJson(submitted.stdout)
    const jobId = ack?.job?.id
    const row = jobRowById(p, jobId)
    expect({
      exit: submitted.code,
      stderr: submitted.stderr,
      claimedBeforeAck: claimed,
      ack: {
        status: ack?.job?.status,
        workerId: ack?.job?.workerId,
        workerPid: ack?.job?.workerPid,
        startedAt: ack?.job?.startedAt,
        heartbeatAt: ack?.job?.heartbeatAt,
        idempotentReplay: ack?.idempotentReplay,
      },
      store: {
        status: row?.status,
        workerId: row?.worker_id,
        events: eventTypes(p, jobId).filter(
          (type) => type === "job_created" || type === "job_started",
        ),
      },
    }).toEqual({
      exit: 0,
      stderr: "",
      claimedBeforeAck: [jobId],
      ack: {
        status: "queued",
        workerId: null,
        workerPid: null,
        startedAt: null,
        heartbeatAt: null,
        idempotentReplay: undefined,
      },
      store: {
        status: "running",
        workerId: `daemon:other-process:${jobId}`,
        events: ["job_created", "job_started"],
      },
    })
  }, 20_000)
}
