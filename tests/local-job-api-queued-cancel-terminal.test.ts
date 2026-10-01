/**
 * Implementer-unit for the Phase II review P2-1 (add-local-job-api-async-submit
 * design D5 trigger table, tasks 2.7): a queued cancel of an API Run whose
 * initial run-dir admission is complete composes the worker's terminal
 * preparer from the persistent input and the reopened run directory, so the
 * canceled terminal registers and publishes result.json, events.jsonl and
 * artifacts.json like a worker-settled Run, and wait/result expose the refs.
 * A Run that never completed its admission (and an artifact-free Run) is
 * canceled without terminal refs.
 */
import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { clearRuntimeReadinessCacheForTest } from "../src/main/lib/headless/runtime-readiness"
import {
  agentRequest,
  type CliOptions,
  cli,
  countType,
  createProfile,
  FIXED_NOW_ISO,
  jobRowById,
  jsonLines,
  type Profile,
  seedQueuedApiJob,
  sha256File,
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

async function submitId(p: Profile, request: unknown): Promise<string> {
  const submitted = await cli(p, SUBMIT, { stdin: JSON.stringify(request) })
  expect(submitted.code).toBe(0)
  const id = jsonLines(submitted.stdout)[0]?.job?.id
  expect(typeof id).toBe("string")
  return id as string
}

function cancelCmd(p: Profile, jobId: string, options: CliOptions = {}) {
  return cli(p, ["api", "runs", "cancel", jobId, "--json"], options)
}

function waitCmd(p: Profile, jobId: string) {
  return cli(p, ["api", "runs", "wait", jobId, "--timeout", "0", "--json"])
}

function runDirNames(runDir: string | null): string[] {
  return runDir && existsSync(runDir) ? readdirSync(runDir).sort() : []
}

type Ref = { role: string; path: string; sha256: string; sizeBytes: number }

function refsOf(waitStdout: string): Ref[] {
  return (jsonLines(waitStdout)[0]?.result?.artifacts ?? []) as Ref[]
}

function reservationExpiry(p: Profile, jobId: string): unknown {
  return (
    p.sqlite
      .query("SELECT expires_at FROM agent_job_idempotency WHERE job_id = ?")
      .get(jobId) as { expires_at: unknown } | null
  )?.expires_at
}

function stagedLeftovers(runDir: string | null): string[] {
  return runDirNames(runDir).filter((name) => name.includes("locus-staged"))
}

test("an admitted queued artifact Run's cancel publishes its terminal refs like a worker-settled Run", async () => {
  const p = profile()
  const jobId = await submitId(p, {
    ...agentRequest(p, {}, { artifacts: true }),
    idempotencyKey: "t1-admitted-cancel",
  })
  const runDir = jobRowById(p, jobId)?.artifact_base_dir as string
  expect(runDirNames(runDir)).toEqual([
    "artifacts.json",
    "events.jsonl",
    "request.json",
  ])
  expect(reservationExpiry(p, jobId)).toBeNull()

  const canceled = await cancelCmd(p, jobId)
  const waited = await waitCmd(p, jobId)
  const refs = refsOf(waited.stdout)
  const result = JSON.parse(readFileSync(join(runDir, "result.json"), "utf8"))
  const manifest = JSON.parse(
    readFileSync(join(runDir, "artifacts.json"), "utf8"),
  )
  const eventsFile = readFileSync(join(runDir, "events.jsonl"), "utf8")

  expect({
    cancelExit: canceled.code,
    cancelStatus: jsonLines(canceled.stdout)[0]?.job?.status,
    waitExit: waited.code,
    waitStatus: jsonLines(waited.stdout)[0]?.job?.status,
    roles: refs.map((ref) => ref.role),
    names: runDirNames(runDir),
    completed: countType(p, jobId, "completed"),
    started: countType(p, jobId, "job_started"),
    resultStatus: result?.status,
    manifestRoles: (manifest?.artifacts ?? []).map(
      (entry: { role: string }) => entry.role,
    ),
    eventsEndWithCompleted: eventsFile
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).type)
      .includes("completed"),
    staged: stagedLeftovers(runDir),
    expirySet: reservationExpiry(p, jobId) !== null,
  }).toEqual({
    cancelExit: 0,
    cancelStatus: "canceled",
    waitExit: 5,
    waitStatus: "canceled",
    roles: ["request", "events", "result", "manifest"],
    names: ["artifacts.json", "events.jsonl", "request.json", "result.json"],
    completed: 1,
    started: 0,
    resultStatus: "canceled",
    manifestRoles: expect.arrayContaining(["request", "events", "result"]),
    eventsEndWithCompleted: true,
    staged: [],
    expirySet: true,
  })
  // Every published ref matches its file byte for byte.
  for (const ref of refs) {
    expect(sha256File(ref.path)).toBe(ref.sha256)
    expect(ref.path.startsWith(`${runDir}/`)).toBe(true)
  }

  // A repeated cancel neither republishes nor adds a terminal.
  const before = refs.map((ref) => sha256File(ref.path))
  expect((await cancelCmd(p, jobId)).code).toBe(0)
  expect(countType(p, jobId, "completed")).toBe(1)
  expect(refs.map((ref) => sha256File(ref.path))).toEqual(before)
}, 20_000)

test("a never-admitted queued artifact Run's cancel registers no terminal refs", async () => {
  const p = profile()
  const jobId = await seedQueuedApiJob(p, { artifacts: true })
  const runDir = jobRowById(p, jobId)?.artifact_base_dir as string
  const namesBefore = runDirNames(runDir)

  const canceled = await cancelCmd(p, jobId)
  const waited = await waitCmd(p, jobId)

  expect({
    cancelExit: canceled.code,
    waitExit: waited.code,
    status: jobRowById(p, jobId)?.status,
    artifacts: refsOf(waited.stdout),
    names: runDirNames(runDir),
    completed: countType(p, jobId, "completed"),
  }).toEqual({
    cancelExit: 0,
    waitExit: 5,
    status: "canceled",
    artifacts: [],
    names: namesBefore,
    completed: 1,
  })
}, 20_000)

test("an artifact-free queued Run's cancel registers no terminal refs", async () => {
  const p = profile()
  const jobId = await submitId(p, agentRequest(p))
  const canceled = await cancelCmd(p, jobId)
  const waited = await waitCmd(p, jobId)
  expect({
    cancelExit: canceled.code,
    waitExit: waited.code,
    artifacts: refsOf(waited.stdout),
    completed: countType(p, jobId, "completed"),
  }).toEqual({ cancelExit: 0, waitExit: 5, artifacts: [], completed: 1 })
}, 20_000)

test("racing cancels of an admitted Run publish one terminal and leave no staging", async () => {
  const p = profile()
  const jobId = await submitId(p, agentRequest(p, {}, { artifacts: true }))
  const runDir = jobRowById(p, jobId)?.artifact_base_dir as string
  const raced = await Promise.all([cancelCmd(p, jobId), cancelCmd(p, jobId)])
  const waited = await waitCmd(p, jobId)
  const refs = refsOf(waited.stdout)
  expect({
    exits: raced.map((r) => r.code),
    waitExit: waited.code,
    completed: countType(p, jobId, "completed"),
    roles: refs.map((ref) => ref.role),
    staged: stagedLeftovers(runDir),
  }).toEqual({
    exits: [0, 0],
    waitExit: 5,
    completed: 1,
    roles: ["request", "events", "result", "manifest"],
    staged: [],
  })
  for (const ref of refs) expect(sha256File(ref.path)).toBe(ref.sha256)
}, 20_000)

test("an admitted Run whose run directory no longer verifies is canceled without terminal refs", async () => {
  const p = profile()
  const jobId = await submitId(p, agentRequest(p, {}, { artifacts: true }))
  const runDir = jobRowById(p, jobId)?.artifact_base_dir as string
  writeFileSync(join(runDir, "request.json"), "{}\n")
  const canceled = await cancelCmd(p, jobId)
  const waited = await waitCmd(p, jobId)
  expect({
    cancelExit: canceled.code,
    waitExit: waited.code,
    status: jobRowById(p, jobId)?.status,
    artifacts: refsOf(waited.stdout),
    hasResultFile: existsSync(join(runDir, "result.json")),
    completed: countType(p, jobId, "completed"),
  }).toEqual({
    cancelExit: 0,
    waitExit: 5,
    status: "canceled",
    artifacts: [],
    hasResultFile: false,
    completed: 1,
  })
}, 20_000)
