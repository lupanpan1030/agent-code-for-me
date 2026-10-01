/** biome-ignore-all lint/suspicious/noExplicitAny: the async-submit envelopes do not exist yet; they are asserted structurally. */
/**
 * Independent RED acceptance suite — add-local-job-api-async-submit,
 * submit-wait domain: S01–S07, S16, S17, S18, S20–S25, S34, S35
 * (openspec/changes/add-local-job-api-async-submit/specs/local-job-api/spec.md).
 *
 * Written test-first against product source 2c59664f (worktree base
 * 0447d02d) without implementation context. Every scenario is driven through
 * the existing in-process CLI entry `runHeadlessCliCommand` with a migrated
 * temp SQLite profile and a controlled fake runtime / upstream fetch. Not-yet
 * existing commands (`runs submit`, `runs wait`, `runs retry --async`), the
 * `execution` status block, lock v2, `async-submit` discovery and the frozen
 * test seams (`monotonicClock`, `beforeOwnPumpClaim`) all fail INSIDE their
 * tests (CLI exit/stdout/stderr or lazy import), never at file load.
 *
 * Byte goldens were captured from 2c59664f into
 * tests/fixtures/local-job-api-async/submit-wait/*.json; per-run values are
 * `{{PLACEHOLDERS}}` bound from the profile DB / disk, never from the
 * stdout under test.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  spyOn,
  test,
} from "bun:test"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import Ajv2020 from "ajv/dist/2020"
import addFormats from "ajv-formats"
import {
  getOrCreateRunEventLedger,
  releaseRunEventLedger,
} from "../src/main/lib/agent-runtime/run-event-ledger-host"
import { recoverStaleAgentJobs } from "../src/main/lib/headless/job-recovery"
import {
  createAgentJob,
  getAgentJob,
  listAgentJobs,
  readCommittedRunEvents,
} from "../src/main/lib/headless/job-store"
import { clearRuntimeReadinessCacheForTest } from "../src/main/lib/headless/runtime-readiness"
import {
  API_VERSION,
  allJobRows,
  apiJobRows,
  type CliOptions,
  claimAs,
  cli,
  completionFetchSpy,
  consumerPreflight,
  controlledRunner,
  countType,
  createFakeMonotonicClock,
  createLatch,
  createProfile,
  dirDigests,
  eventRows,
  eventTypes,
  FIXED_NOW_ISO,
  FIXTURE_DIR,
  faultableDb,
  fixtureCase,
  jobRowById,
  jobVars,
  jsonLines,
  loadFixture,
  type Profile,
  profileVars,
  READINESS_STUB,
  readFileOrNull,
  realDelay,
  renderGolden,
  renderJson,
  seedProviderProfile,
  seedQueuedApiJob,
  spawnChild,
  spawnSibling,
  until,
  writeLock,
} from "./local-job-api-async-submit-wait-kit"
import { settledResult } from "./run-event-ledger-domain-b-kit"

// ---------------------------------------------------------------------------
// Per-test isolation
// ---------------------------------------------------------------------------

const cleanups: Array<() => void> = []

function profile(options: { fixedRoot?: string } = {}): Profile {
  const created = createProfile(options)
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

// ---------------------------------------------------------------------------
// Command helpers (public CLI surface only)
// ---------------------------------------------------------------------------

const CREATE = ["api", "runs", "create", "--request", "-", "--json"]
const SUBMIT = ["api", "runs", "submit", "--request", "-", "--json"]

function submit(p: Profile, request: unknown, options: CliOptions = {}) {
  return cli(p, SUBMIT, { stdin: JSON.stringify(request), ...options })
}

function create(p: Profile, request: unknown, options: CliOptions = {}) {
  return cli(p, CREATE, { stdin: JSON.stringify(request), ...options })
}

function waitCmd(
  p: Profile,
  jobId: string,
  timeoutArg: string | null,
  options: CliOptions = {},
) {
  return cli(
    p,
    [
      "api",
      "runs",
      "wait",
      jobId,
      ...(timeoutArg === null ? [] : ["--timeout", timeoutArg]),
      "--json",
    ],
    options,
  )
}

function statusCmd(p: Profile, jobId: string, options: CliOptions = {}) {
  return cli(p, ["api", "runs", "status", jobId, "--json"], options)
}

function cancelCmd(p: Profile, jobId: string) {
  return cli(p, ["api", "runs", "cancel", jobId, "--json"])
}

/** The existing foreground executor, which the change makes API-capable. */
function daemonOnce(p: Profile, options: CliOptions = {}) {
  return cli(
    p,
    ["daemon", "run", "--once", "--poll-interval-ms", "100"],
    options,
  )
}

function firstApiJobId(p: Profile): string {
  return apiJobRows(p)[0]?.id ?? "<no-api-job>"
}

function clockOption(clock = createFakeMonotonicClock()) {
  return { monotonicClock: clock }
}

const terminalBytes = () => loadFixture("terminal-bytes.json")

function agentArtifactsRequest(p: Profile) {
  return renderJson(terminalBytes().requests.agentArtifacts, profileVars(p))
}

function agentArtifactFreeRequest(p: Profile) {
  return renderJson(terminalBytes().requests.agentArtifactFree, profileVars(p))
}

function completionRequestFixture() {
  return terminalBytes().requests.completion
}

function golden(ref: string): { exit: number; stdout: string } {
  return terminalBytes().cases.S03.outcomes[ref]
}

function keysOf(value: unknown): string[] {
  return value && typeof value === "object" ? Object.keys(value).sort() : []
}

/**
 * Records the canonical pump's scoped invocations (design.md:122: the Q2(a)
 * wrapper calls `pumpQueuedRuns({ admittedIds: [ownId] })`). Before the
 * export exists the recorder reports its absence instead of throwing.
 */
async function recordPumpScopes(): Promise<() => unknown> {
  const daemonModule: any = await import("../src/main/lib/headless/daemon")
  if (typeof daemonModule.pumpQueuedRuns !== "function") {
    return () => "pumpQueuedRuns is not exported by headless/daemon.ts"
  }
  const spy = spyOn(daemonModule, "pumpQueuedRuns")
  // Coordinator adjudication 2026-10-02: bun returns the same mock for an already
  // spied export, so each recorder starts from an empty call list.
  spy.mockClear()
  cleanups.push(() => spy.mockRestore())
  return () => spy.mock.calls.map((args: any[]) => args[0]?.admittedIds ?? null)
}

function hasSequenceKey(value: unknown): boolean {
  return JSON.stringify(value ?? null).includes('"sequence"')
}

// ===========================================================================
// Asynchronous Run Submission
// ===========================================================================

describe("Asynchronous Run Submission", () => {
  test("S01 Submit returns before execution is released — submit acks one queued admission with a committed job_created before any dispatch, and a later claim is visible only through status", async () => {
    const fx = fixtureCase("public-submission.json", "S01")
    const p = profile()
    const runtimeLatch = createLatch()
    const run = controlledRunner({ latch: runtimeLatch })
    const request = renderJson(fx.request, profileVars(p))

    const ack = await submit(p, request, { runner: run.runner })
    const runnerCallsAtAck = run.calls.length
    const jobsAtAck = apiJobRows(p)
    const jobId = jobsAtAck[0]?.id ?? "<no-api-job>"
    const committed = readCommittedRunEvents(p.db, jobId).map((record) => ({
      sequence: record.sequence,
      type: record.type,
      factKey: record.factKey,
    }))
    const ackLines = jsonLines(ack.stdout)

    // The paused pump's claim is released through the existing claim owner.
    const claim = await settledResult(() =>
      claimAs(p, jobId, {
        workerId: fx.claim.workerId,
        workerPid: process.pid,
      }),
    )
    const status = await statusCmd(p, jobId)
    runtimeLatch.release()

    expect({
      exit: ack.code,
      stderr: ack.stderr,
      ackLineCount: ackLines.length,
      ackKeys: keysOf(ackLines[0]),
      ackApiVersion: ackLines[0]?.apiVersion,
      ackStatus: ackLines[0]?.job?.status,
      ackJobId: ackLines[0]?.job?.id,
      runnerCallsAtAck,
      jobsAtAck: jobsAtAck.length,
      committed,
      claimFulfilled: claim.fulfilled,
      statusExit: status.code,
      statusAfterClaim: jsonLines(status.stdout)[0]?.job?.status,
      capturedAckStillQueued: jsonLines(ack.stdout)[0]?.job?.status,
      jobsAfterClaim: apiJobRows(p).length,
    }).toEqual({
      exit: 0,
      stderr: "",
      ackLineCount: 1,
      ackKeys: fx.expectedAck.keys,
      ackApiVersion: API_VERSION,
      ackStatus: fx.expectedAck.status,
      ackJobId: jobId,
      runnerCallsAtAck: 0,
      jobsAtAck: 1,
      committed: [
        {
          sequence: fx.expectedCreationFact.sequence,
          type: fx.expectedCreationFact.type,
          factKey: renderGolden(fx.expectedCreationFact.factKeyTemplate, {
            JOB_ID: jobId,
          }),
        },
      ],
      claimFulfilled: true,
      statusExit: 0,
      statusAfterClaim: fx.expectedStatusAfterClaim,
      capturedAckStillQueued: "queued",
      jobsAfterClaim: 1,
    })
  })

  test("S02 Existing admission gates run before provider work — every create-time rejection is reproduced by submit with zero provider calls and no queued ack; a no-profile request keeps the batch selector path", async () => {
    const fx = fixtureCase("public-submission.json", "S02")
    const p = profile()
    seedProviderProfile(p, { id: "completion-main", targets: ["codex"] })
    const unregistered = join(p.ledger.dir, "unregistered-project")
    mkdirSync(unregistered, { recursive: true })
    const vars = { ...profileVars(p), UNREGISTERED_DIR: unregistered }
    const run = controlledRunner()
    const fetchSpy = completionFetchSpy()

    const actual: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}
    for (const [name, entry] of Object.entries<any>(fx.cases)) {
      const request = renderJson(entry.request, vars)
      const baseline = {
        exit: entry.baseline.exit,
        stdout: renderGolden(entry.baseline.stdout, vars),
        stderr: entry.baseline.stderr,
      }
      const created = await create(p, request, {
        runner: run.runner,
        completionFetch: fetchSpy.fetchImpl,
      })
      const submitted = await submit(p, request, {
        runner: run.runner,
        completionFetch: fetchSpy.fetchImpl,
      })
      actual[name] = {
        create: {
          exit: created.code,
          stdout: created.stdout,
          stderr: created.stderr,
        },
        submit: {
          exit: submitted.code,
          stdout: submitted.stdout,
          stderr: submitted.stderr,
        },
      }
      expected[name] = { create: baseline, submit: baseline }
    }
    const rejectedJobs = allJobRows(p).length
    const providerCalls = run.calls.length + fetchSpy.calls.length

    const ordinaryRequest = renderJson(fx.ordinary.request, vars)
    const ordinary = await submit(p, ordinaryRequest, { runner: run.runner })
    const ordinaryAck = jsonLines(ordinary.stdout)[0]
    const ordinaryRow = apiJobRows(p)[0]
    const storedInput = ordinaryRow ? JSON.parse(ordinaryRow.input_json) : null

    expect({
      cases: actual,
      rejectedJobs,
      providerCalls,
      ordinary: {
        exit: ordinary.code,
        status: ordinaryAck?.job?.status,
        runtime: ordinaryRow?.runtime,
        cwd: ordinaryRow?.cwd,
        providerProfileId: ordinaryRow?.provider_profile_id ?? null,
        modelOverride: ordinaryRow?.model_override ?? null,
        executionProfile: storedInput?.runtime?.executionProfile,
        runnerCalls: run.calls.length,
      },
    }).toEqual({
      cases: expected,
      rejectedJobs: 0,
      providerCalls: 0,
      ordinary: {
        exit: 0,
        status: fx.ordinary.expected.status,
        runtime: fx.ordinary.expected.runtime,
        cwd: p.packageDir,
        providerProfileId: fx.ordinary.expected.providerProfileId,
        modelOverride: fx.ordinary.expected.modelOverride,
        executionProfile: fx.ordinary.expected.executionProfile,
        runnerCalls: 0,
      },
    })
  })
})

// ===========================================================================
// Synchronous Operations Use Submit And Wait
// ===========================================================================

describe("Synchronous Operations Use Submit And Wait", () => {
  test("S03 Old create matches submit plus wait byte for byte — old-shaped create and submit + executor + wait both reproduce the 2c59664f golden stdout/exit for every outcome and kind", async () => {
    const fx = terminalBytes()
    const actual: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}
    for (const [name, entry] of Object.entries<any>(fx.cases.S03.outcomes)) {
      const isCompletion = entry.kind === "completion"
      const flow = async (mode: "create" | "submit") => {
        const p = profile()
        if (isCompletion) {
          seedProviderProfile(p, { id: "completion-main", targets: ["codex"] })
        }
        const run = controlledRunner({ outcome: entry.runnerOutcome })
        const fetchSpy = completionFetchSpy()
        const request = isCompletion
          ? completionRequestFixture()
          : agentArtifactsRequest(p)
        const io = { runner: run.runner, completionFetch: fetchSpy.fetchImpl }
        let result: { code: number; stdout: string }
        let pumpScopes: unknown = null
        if (mode === "create") {
          const scopes = await recordPumpScopes()
          result = await create(p, request, io)
          pumpScopes = scopes()
        } else {
          await submit(p, request, io)
          await daemonOnce(p, io)
          result = await waitCmd(p, firstApiJobId(p), null, {
            extra: clockOption(),
          })
        }
        const jobId = firstApiJobId(p)
        return {
          actual: {
            exit: result.code,
            stdout: result.stdout,
            jobs: apiJobRows(p).length,
            jobCreated: countType(p, jobId, "job_created"),
            completed: countType(p, jobId, "completed"),
            dispatches: isCompletion ? fetchSpy.calls.length : run.calls.length,
            pumpScopes,
          },
          expected: {
            exit: entry.exit,
            stdout: renderGolden(entry.stdout, jobVars(p, jobId)),
            jobs: 1,
            jobCreated: 1,
            completed: 1,
            dispatches: 1,
            pumpScopes: mode === "create" ? [[jobId]] : null,
          },
        }
      }
      const created = await flow("create")
      const waited = await flow("submit")
      actual[name] = { create: created.actual, submitWait: waited.actual }
      expected[name] = { create: created.expected, submitWait: waited.expected }
    }
    expect(actual).toEqual(expected)
  }, 30_000)

  test("S03 Old create matches submit plus wait byte for byte — real processes: workerId/workerPid identify the wrapper or daemon process that actually won the claim", async () => {
    setSystemTime()
    const p = profile()
    const requestPath = join(p.root, "request.json")
    writeFileSync(requestPath, JSON.stringify(agentArtifactsRequest(p)))

    const wrapper = spawnChild({
      dbFile: p.ledger.file,
      argv: ["api", "runs", "create", "--request", requestPath, "--json"],
      lockPath: p.lockPath,
      runner: "succeed",
    })
    const wrapperExit = await wrapper.exited
    const wrapperJob = apiJobRows(p)[0]

    const submitter = spawnChild({
      dbFile: p.ledger.file,
      argv: ["api", "runs", "submit", "--request", requestPath, "--json"],
      lockPath: p.lockPath,
      runner: "succeed",
    })
    const submitExit = await submitter.exited
    const submitted = apiJobRows(p).find((row) => row.id !== wrapperJob?.id)
    const daemon = spawnChild({
      dbFile: p.ledger.file,
      argv: ["daemon", "run", "--once", "--poll-interval-ms", "100"],
      lockPath: p.lockPath,
      runner: "succeed",
    })
    const daemonExit = await daemon.exited
    const claimed = submitted ? jobRowById(p, submitted.id) : null

    expect({
      wrapperExit: wrapperExit.code,
      wrapperWorkerPid: wrapperJob?.worker_pid,
      wrapperWorkerIdNamesPid: String(wrapperJob?.worker_id).includes(
        `:${wrapper.pid}:`,
      ),
      submitExit: submitExit.code,
      submittedRunsInSubmitter: submitted?.worker_pid ?? null,
      daemonExit: daemonExit.code,
      daemonClaimPid: claimed?.worker_pid ?? null,
      daemonWorkerIdNamesPid: String(claimed?.worker_id).includes(
        `:${daemon.pid}:`,
      ),
      daemonClaimStatus: claimed?.status ?? null,
    }).toEqual({
      wrapperExit: 0,
      wrapperWorkerPid: wrapper.pid,
      wrapperWorkerIdNamesPid: true,
      submitExit: 0,
      submittedRunsInSubmitter: null,
      daemonExit: 0,
      daemonClaimPid: daemon.pid,
      daemonWorkerIdNamesPid: true,
      daemonClaimStatus: "succeeded",
    })
  }, 30_000)

  test("S04 Default retry retains synchronous response and lineage — sync retry and retry --async + executor + wait both equal the 2c59664f retry golden, each with one new child attempt and an untouched source", async () => {
    const fx = terminalBytes().cases.S04
    const flow = async (mode: "sync" | "async") => {
      const p = profile()
      const failing = controlledRunner({ outcome: fx.sourceOutcome })
      await create(p, agentArtifactsRequest(p), { runner: failing.runner })
      const sourceId = firstApiJobId(p)
      const sourceRow = JSON.stringify(jobRowById(p, sourceId))
      const sourceEvents = JSON.stringify(eventRows(p, sourceId))
      const sourceDir = jobRowById(p, sourceId)?.artifact_base_dir ?? ""
      const sourceFiles = dirDigests(sourceDir)
      const run = controlledRunner({ outcome: fx.retryOutcome })
      let output: { code: number; stdout: string }
      let ack: any = null
      if (mode === "sync") {
        output = await cli(p, ["api", "runs", "retry", sourceId, "--json"], {
          runner: run.runner,
        })
      } else {
        const admitted = await cli(
          p,
          ["api", "runs", "retry", sourceId, "--async", "--json"],
          { runner: run.runner },
        )
        ack = { exit: admitted.code, lines: jsonLines(admitted.stdout) }
        await daemonOnce(p, { runner: run.runner })
        const childId =
          apiJobRows(p).find((row) => row.id !== sourceId)?.id ?? "<no-child>"
        output = await waitCmd(p, childId, null, { extra: clockOption() })
      }
      const children = apiJobRows(p).filter((row) => row.id !== sourceId)
      const childId = children[0]?.id ?? "<no-child>"
      return {
        actual: {
          ack: ack
            ? {
                exit: ack.exit,
                lineCount: ack.lines.length,
                keys: keysOf(ack.lines[0]),
                status: ack.lines[0]?.job?.status,
                retryOfJobId: ack.lines[0]?.job?.retryOfJobId,
              }
            : null,
          exit: output.code,
          stdout: output.stdout,
          children: children.length,
          lineage: children.map((row) => ({
            retryOf: row.retry_of_job_id,
            attempt: row.attempt,
          })),
          sourceRowUnchanged:
            JSON.stringify(jobRowById(p, sourceId)) === sourceRow,
          sourceEventsUnchanged:
            JSON.stringify(eventRows(p, sourceId)) === sourceEvents,
          sourceFilesUnchanged:
            JSON.stringify(dirDigests(sourceDir)) ===
            JSON.stringify(sourceFiles),
          runtimeDispatches: run.calls.length,
        },
        expected: {
          ack:
            mode === "async"
              ? {
                  exit: 0,
                  lineCount: 1,
                  keys: ["apiVersion", "job"],
                  status: "queued",
                  retryOfJobId: sourceId,
                }
              : null,
          exit: fx.exit,
          stdout: renderGolden(
            fx.stdout,
            jobVars(p, childId, { SOURCE_ID: sourceId }),
          ),
          children: 1,
          lineage: [{ retryOf: sourceId, attempt: 2 }],
          sourceRowUnchanged: true,
          sourceEventsUnchanged: true,
          sourceFilesUnchanged: true,
          runtimeDispatches: 1,
        },
      }
    }
    const sync = await flow("sync")
    const asyncFlow = await flow("async")
    expect({ sync: sync.actual, async: asyncFlow.actual }).toEqual({
      sync: sync.expected,
      async: asyncFlow.expected,
    })
  }, 20_000)

  // Enforces once the frozen `monotonicClock` seam exists: the wrapper's
  // internal wait consumes the injected clock while its own pump runs.
  test("S25 Internal wait timeout does not become a create result — an agent create whose runtime is held past the 30000 ms internal wait deadline emits only the baseline terminal envelope with exit 0", async () => {
    const fx = terminalBytes().cases.S25
    const p = profile()
    const clock = createFakeMonotonicClock()
    const latch = createLatch()
    let releasedBy = "pending"
    void Promise.race([
      clock.reached(fx.latchReleaseAtMs).then(() => "clock"),
      realDelay(3000).then(() => "real-time-guard"),
    ]).then((by) => {
      if (releasedBy === "pending") releasedBy = by
      latch.release()
    })
    const run = controlledRunner({ latch })
    const result = await create(p, agentArtifactsRequest(p), {
      runner: run.runner,
      extra: clockOption(clock),
    })
    latch.release()
    const jobId = firstApiJobId(p)
    const lines = jsonLines(result.stdout)
    expect({
      releasedBy,
      exit: result.code,
      stdout: result.stdout,
      lineCount: lines.length,
      hasWaitMember: lines.some((line) => "wait" in line),
      stderr: result.stderr,
      attempts: apiJobRows(p).length,
      completed: countType(p, jobId, "completed"),
      dispatches: run.calls.length,
    }).toEqual({
      releasedBy: "clock",
      exit: 0,
      stdout: renderGolden(golden("succeeded").stdout, jobVars(p, jobId)),
      lineCount: 1,
      hasWaitMember: false,
      stderr: "",
      attempts: 1,
      completed: 1,
      dispatches: 1,
    })
  }, 15_000)

  // Enforces once the frozen `monotonicClock` seam exists (own-pump
  // exemption from the 30000 ms no-progress window, design.md:126).
  test("S25 Internal wait timeout does not become a create result — a kind:completion create whose single upstream call takes 45000 ms without heartbeat or high-water change returns the baseline stdout/exit", async () => {
    const fx = terminalBytes().cases.S25
    const p = profile()
    seedProviderProfile(p, { id: "completion-main", targets: ["codex"] })
    const clock = createFakeMonotonicClock()
    let releasedBy = "pending"
    const fetchSpy = completionFetchSpy({
      beforeRespond: async () => {
        releasedBy = await Promise.race([
          clock.reached(fx.completionUpstreamMs).then(() => "clock"),
          realDelay(3000).then(() => "real-time-guard"),
        ])
      },
    })
    const result = await create(p, completionRequestFixture(), {
      completionFetch: fetchSpy.fetchImpl,
      extra: clockOption(clock),
    })
    const jobId = firstApiJobId(p)
    expect({
      releasedBy,
      exit: result.code,
      stdout: result.stdout,
      attempts: apiJobRows(p).length,
      completed: countType(p, jobId, "completed"),
      upstreamCalls: fetchSpy.calls.length,
    }).toEqual({
      releasedBy: "clock",
      exit: 0,
      stdout: renderGolden(
        golden("completion_succeeded").stdout,
        jobVars(p, jobId),
      ),
      attempts: 1,
      completed: 1,
      upstreamCalls: 1,
    })
  }, 15_000)

  // Enforces once `pumpQueuedRuns` exists in headless/daemon.ts (design.md:85,
  // :122): each wrapper scopes the canonical pump to its own admitted ID.
  test("S34 Create and retry run without an external executor — with no daemon lock, create (agent, completion) and default retry claim only their own admitted Run through the canonical pump, leave unrelated queued work untouched and match baseline bytes", async () => {
    const fx = terminalBytes()
    const p = profile()
    seedProviderProfile(p, { id: "completion-main", targets: ["codex"] })
    const unrelatedApi = await seedQueuedApiJob(p)
    const unrelatedDaemon = (
      await createAgentJob(p.db, {
        source: "daemon",
        runtime: "codex",
        mode: "plan",
        cwd: p.packageDir,
        prompt: "Unrelated daemon work.",
      })
    ).id
    const before = new Set(allJobRows(p).map((row) => row.id))
    const newIds = () =>
      allJobRows(p)
        .map((row) => row.id)
        .filter((id) => !before.has(id))

    const pumpScopes = await recordPumpScopes()
    const run = controlledRunner()
    const agent = await create(p, agentArtifactsRequest(p), {
      runner: run.runner,
    })
    const agentId = newIds()[0] ?? "<none>"
    before.add(agentId)
    const fetchSpy = completionFetchSpy()
    const completion = await create(p, completionRequestFixture(), {
      completionFetch: fetchSpy.fetchImpl,
    })
    const completionId = newIds()[0] ?? "<none>"
    before.add(completionId)
    const failing = controlledRunner({ outcome: fx.cases.S04.sourceOutcome })
    await create(p, agentArtifactsRequest(p), { runner: failing.runner })
    const sourceId = newIds()[0] ?? "<none>"
    before.add(sourceId)
    const retryRun = controlledRunner()
    const retry = await cli(p, ["api", "runs", "retry", sourceId, "--json"], {
      runner: retryRun.runner,
    })
    const childId = newIds()[0] ?? "<none>"

    expect({
      pumpScopes: pumpScopes(),
      agent: { exit: agent.code, stdout: agent.stdout },
      completion: { exit: completion.code, stdout: completion.stdout },
      retry: { exit: retry.code, stdout: retry.stdout },
      claimed: [...run.calls, ...retryRun.calls].map((call) => call.jobId),
      unrelated: [unrelatedApi, unrelatedDaemon].map((id) => ({
        status: jobRowById(p, id)?.status,
        types: eventTypes(p, id),
      })),
      daemonLockCreated: existsSync(p.lockPath),
    }).toEqual({
      pumpScopes: [[agentId], [completionId], [sourceId], [childId]],
      agent: {
        exit: 0,
        stdout: renderGolden(golden("succeeded").stdout, jobVars(p, agentId)),
      },
      completion: {
        exit: 0,
        stdout: renderGolden(
          golden("completion_succeeded").stdout,
          jobVars(p, completionId),
        ),
      },
      retry: {
        exit: fx.cases.S04.exit,
        stdout: renderGolden(
          fx.cases.S04.stdout,
          jobVars(p, childId, { SOURCE_ID: sourceId }),
        ),
      },
      claimed: [agentId, childId],
      unrelated: [
        { status: "queued", types: ["job_created"] },
        { status: "queued", types: ["job_created"] },
      ],
      daemonLockCreated: false,
    })
  }, 20_000)

  // Enforces once the frozen `beforeOwnPumpClaim` claim-latch seam exists
  // (tasks.md:15 "claim latch"): a daemon wins the claim first.
  test("S34 Create and retry run without an external executor — daemon-first: when a daemon wins the claim the wrapper only waits, never double-dispatches, and returns the claimant's terminal envelope", async () => {
    const p = profile()
    const wrapperRun = controlledRunner()
    const daemonRun = controlledRunner()
    const hookCalls: string[] = []
    const result = await create(p, agentArtifactsRequest(p), {
      runner: wrapperRun.runner,
      extra: {
        ...clockOption(),
        beforeOwnPumpClaim: async (jobId: string) => {
          hookCalls.push(jobId)
          await daemonOnce(p, { runner: daemonRun.runner })
        },
      },
    })
    const jobId = firstApiJobId(p)
    expect({
      hookCalls,
      exit: result.code,
      stdout: result.stdout,
      wrapperDispatches: wrapperRun.calls.length,
      daemonDispatches: daemonRun.calls.map((call) => call.jobId),
      started: countType(p, jobId, "job_started"),
      completed: countType(p, jobId, "completed"),
      workerIsDaemon: String(jobRowById(p, jobId)?.worker_id).startsWith(
        "daemon:",
      ),
    }).toEqual({
      hookCalls: [jobId],
      exit: 0,
      stdout: renderGolden(golden("succeeded").stdout, jobVars(p, jobId)),
      wrapperDispatches: 0,
      daemonDispatches: [jobId],
      started: 1,
      completed: 1,
      workerIsDaemon: true,
    })
  }, 15_000)

  // Enforces once `beforeOwnPumpClaim` and `monotonicClock` exist.
  test("S34 Create and retry run without an external executor — daemon-first stalled worker with unknown liveness and no progress yields the identified executor_unknown error/8 at the 30000 ms window", async () => {
    const fx = terminalBytes().cases.S34
    const p = profile()
    const clock = createFakeMonotonicClock()
    const wrapperRun = controlledRunner()
    const result = await create(p, agentArtifactFreeRequest(p), {
      runner: wrapperRun.runner,
      extra: {
        ...clockOption(clock),
        beforeOwnPumpClaim: async (jobId: string) => {
          await claimAs(p, jobId, {
            workerId: `daemon:${fx.unknownWorkerPid}:fixture:${jobId}`,
            workerPid: fx.unknownWorkerPid,
          })
        },
      },
    })
    const jobId = firstApiJobId(p)
    const lines = jsonLines(result.stdout)
    expect({
      exit: result.code,
      lineCount: lines.length,
      keys: keysOf(lines[0]),
      jobId: lines[0]?.job?.id,
      wait: lines[0]?.wait,
      firedInWindow:
        clock.now() >= fx.observerNoProgressWindowMs &&
        clock.now() <= fx.observerNoProgressWindowMs + 100,
      wrapperDispatches: wrapperRun.calls.length,
      rowStatus: jobRowById(p, jobId)?.status,
      completed: countType(p, jobId, "completed"),
    }).toEqual({
      exit: fx.stalledExpected.exit,
      lineCount: 1,
      keys: ["apiVersion", "job", "wait"],
      jobId,
      wait: fx.stalledExpected.wait,
      firedInWindow: true,
      wrapperDispatches: 0,
      rowStatus: "running",
      completed: 0,
    })
  }, 15_000)

  // Enforces once `beforeOwnPumpClaim`, `monotonicClock` and the daemon's
  // completionFetch injection seam (tasks.md:25) exist.
  test("S34 Create and retry run without an external executor — daemon-first kind:completion with a 45000 ms upstream call and a confirmed-alive claimant emits no error/8 at 30000 ms and returns the claimant's terminal envelope", async () => {
    const fx = terminalBytes().cases.S34
    const p = profile()
    seedProviderProfile(p, { id: "completion-main", targets: ["codex"] })
    const clock = createFakeMonotonicClock()
    let releasedBy = "pending"
    const daemonFetch = completionFetchSpy({
      beforeRespond: async () => {
        releasedBy = await Promise.race([
          clock.reached(fx.completionUpstreamMs).then(() => "clock"),
          realDelay(3000).then(() => "real-time-guard"),
        ])
      },
    })
    const wrapperFetch = completionFetchSpy()
    let daemonDone: Promise<unknown> = Promise.resolve()
    const result = await create(p, completionRequestFixture(), {
      completionFetch: wrapperFetch.fetchImpl,
      extra: {
        ...clockOption(clock),
        beforeOwnPumpClaim: async (jobId: string) => {
          daemonDone = daemonOnce(p, { completionFetch: daemonFetch.fetchImpl })
          await until(() => jobRowById(p, jobId)?.status === "running", 2000)
        },
      },
    })
    await daemonDone
    const jobId = firstApiJobId(p)
    expect({
      releasedBy,
      exit: result.code,
      stdout: result.stdout,
      wrapperUpstreamCalls: wrapperFetch.calls.length,
      daemonUpstreamCalls: daemonFetch.calls.length,
      completed: countType(p, jobId, "completed"),
    }).toEqual({
      releasedBy: "clock",
      exit: 0,
      stdout: renderGolden(
        golden("completion_succeeded").stdout,
        jobVars(p, jobId),
      ),
      wrapperUpstreamCalls: 0,
      daemonUpstreamCalls: 1,
      completed: 1,
    })
  }, 15_000)
})

// ===========================================================================
// S35 — wrapper abort (real processes, POSIX)
// ===========================================================================

describe("Aborting a wrapper (POSIX real-process harness)", () => {
  const controls = () => fixtureCase("controls.json", "S35")

  async function abortProfile() {
    setSystemTime()
    const p = profile()
    const requestPath = join(p.root, "request.json")
    writeFileSync(
      requestPath,
      JSON.stringify(renderJson(controls().request, profileVars(p))),
    )
    const unrelated = [await seedQueuedApiJob(p), await seedQueuedApiJob(p)]
    return { p, requestPath, unrelated }
  }

  function ownJob(p: Profile, unrelated: string[]): any {
    return apiJobRows(p).find((row) => !unrelated.includes(row.id)) ?? null
  }

  function unrelatedState(p: Profile, unrelated: string[]) {
    return unrelated.map((id) => ({
      status: jobRowById(p, id)?.status,
      cancelRequested: jobRowById(p, id)?.cancel_requested_at !== null,
    }))
  }

  const untouched = [
    { status: "queued", cancelRequested: false },
    { status: "queued", cancelRequested: false },
  ]

  test("S35 Aborting a wrapper applies the chosen cancel policy — own-pump wrapper keeps the 2c59664f process-tree receipts for SIGINT/SIGTERM/SIGKILL and stdin EOF", async () => {
    const baseline = controls().ownPumpBaseline
    const { p, requestPath, unrelated } = await abortProfile()
    const actual: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}
    const seen = new Set(unrelated)
    for (const signal of ["SIGINT", "SIGTERM", "SIGKILL"] as const) {
      const child = spawnChild(
        {
          dbFile: p.ledger.file,
          argv: ["api", "runs", "create", "--request", requestPath, "--json"],
          lockPath: p.lockPath,
          runner: "block",
        },
        { stdin: "pipe" },
      )
      const entered = await child.waitForStderr(/RUNNER_ENTERED/, 10_000)
      child.proc.kill(signal)
      const exit = await child.exited
      const row = apiJobRows(p).find((r) => !seen.has(r.id))
      if (row) seen.add(row.id)
      actual[signal] = {
        entered,
        childSignal: exit.signal,
        rowStatus: row?.status,
        cancelRequested: (row?.cancel_requested_at ?? null) !== null,
        jobId: row?.id ?? null,
      }
      expected[signal] = {
        entered: true,
        childSignal: baseline[signal].childSignal,
        rowStatus: baseline[signal].rowStatus,
        cancelRequested: baseline[signal].cancelRequested,
        jobId: row?.id ?? null,
      }
    }
    const eofChild = spawnChild(
      {
        dbFile: p.ledger.file,
        argv: ["api", "runs", "create", "--request", requestPath, "--json"],
        lockPath: p.lockPath,
        runner: "block",
      },
      { stdin: "pipe" },
    )
    await eofChild.waitForStderr(/RUNNER_ENTERED/, 10_000)
    eofChild.closeStdin()
    await realDelay(baseline.stdinEOF.childAliveAfterMs)
    const eofAlive =
      eofChild.proc.exitCode === null && !eofChild.proc.signalCode
    const eofRow = apiJobRows(p).find((r) => !seen.has(r.id))
    eofChild.proc.kill("SIGKILL")
    await eofChild.exited

    const recovered = await recoverStaleAgentJobs(
      p.db,
      new Date(Date.now() + 10 * 60 * 1000),
    )
    const signalRows = Object.values(actual).map((entry: any) => entry.jobId)
    expect({
      signals: actual,
      eof: {
        alive: eofAlive,
        rowStatus: eofRow?.status,
        cancelRequested: (eofRow?.cancel_requested_at ?? null) !== null,
      },
      afterRecovery: signalRows.map((id) => jobRowById(p, id)?.status),
      recoveredAtLeast: recovered.length >= signalRows.length,
      unrelated: unrelatedState(p, unrelated),
    }).toEqual({
      signals: expected,
      eof: {
        alive: true,
        rowStatus: baseline.stdinEOF.rowStatus,
        cancelRequested: baseline.stdinEOF.cancelRequested,
      },
      afterRecovery: signalRows.map(() => baseline.SIGINT.afterRecovery),
      recoveredAtLeast: true,
      unrelated: untouched,
    })
  }, 60_000)

  async function daemonFirstChild(
    p: Profile,
    requestPath: string,
    siblingPid: number,
    stdin: "pipe" | "ignore",
    options: { requestFromStdin?: string } = {},
  ) {
    const child = spawnChild(
      {
        dbFile: p.ledger.file,
        argv: [
          "api",
          "runs",
          "create",
          "--request",
          options.requestFromStdin === undefined ? requestPath : "-",
          "--json",
        ],
        lockPath: p.lockPath,
        runner: "block",
        claimAs: { workerPid: siblingPid },
      },
      { stdin, stdinBody: options.requestFromStdin },
    )
    const claimed = await child.waitForStderr(/CLAIMED|RUNNER_ENTERED/, 10_000)
    const viaDaemonClaim = /CLAIMED/.test(child.stderr())
    return { child, claimed: claimed && viaDaemonClaim }
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    // Enforces once `beforeOwnPumpClaim` and the R4 relay exist.
    test(`S35 Aborting a wrapper applies the chosen cancel policy — daemon-first ${signal} relays one cancel for the admitted ID only, waits at most 5000 ms for the ack and re-raises ${signal}`, async () => {
      const fx = controls()
      const { p, requestPath, unrelated } = await abortProfile()
      const sibling = spawnSibling()
      const { child, claimed } = await daemonFirstChild(
        p,
        requestPath,
        sibling.pid,
        "ignore",
      )
      const started = performance.now()
      child.proc.kill(signal)
      const exit = await Promise.race([
        child.exited,
        realDelay(fx.ackWaitMaxMs + 2500).then(() => ({
          code: null,
          signal: "still-running",
        })),
      ])
      const elapsed = performance.now() - started
      child.proc.kill("SIGKILL")
      await child.exited
      sibling.kill()
      const own = ownJob(p, unrelated)
      expect({
        claimed,
        exitSignal: exit.signal,
        withinAckBound: elapsed <= fx.ackWaitMaxMs + 1500,
        ownCancelRequested: (own?.cancel_requested_at ?? null) !== null,
        stdoutHasTerminal: child.stdout().includes('"result"'),
        unrelated: unrelatedState(p, unrelated),
      }).toEqual({
        claimed: true,
        exitSignal: signal,
        withinAckBound: true,
        ownCancelRequested: true,
        stdoutHasTerminal: false,
        unrelated: untouched,
      })
    }, 30_000)
  }

  // Enforces once `beforeOwnPumpClaim` exists.
  test("S35 Aborting a wrapper applies the chosen cancel policy — SIGKILL of a daemon-backed waiter relays nothing and leaves the Run running and queryable", async () => {
    const { p, requestPath, unrelated } = await abortProfile()
    const sibling = spawnSibling()
    const { child, claimed } = await daemonFirstChild(
      p,
      requestPath,
      sibling.pid,
      "ignore",
    )
    child.proc.kill("SIGKILL")
    const exit = await child.exited
    const own = ownJob(p, unrelated)
    const status = await statusCmd(p, own?.id ?? "<none>")
    sibling.kill()
    expect({
      claimed,
      exitSignal: exit.signal,
      ownCancelRequested: (own?.cancel_requested_at ?? null) !== null,
      ownStatus: own?.status,
      queryable: {
        exit: status.code,
        status: jsonLines(status.stdout)[0]?.job?.status,
      },
      unrelated: unrelatedState(p, unrelated),
    }).toEqual({
      claimed: true,
      exitSignal: "SIGKILL",
      ownCancelRequested: false,
      ownStatus: "running",
      queryable: { exit: 0, status: "running" },
      unrelated: untouched,
    })
  }, 30_000)

  // Enforces once `beforeOwnPumpClaim` and armed-EOF relay exist.
  test("S35 Aborting a wrapper applies the chosen cancel policy — closing a stdin pipe that was open at admission relays the own cancel and exits 8 without a terminal envelope", async () => {
    const fx = controls()
    const { p, requestPath, unrelated } = await abortProfile()
    const sibling = spawnSibling()
    const { child, claimed } = await daemonFirstChild(
      p,
      requestPath,
      sibling.pid,
      "pipe",
    )
    child.closeStdin()
    const exit = await Promise.race([
      child.exited,
      realDelay(fx.ackWaitMaxMs + 2500).then(() => ({
        code: null,
        signal: "still-running",
      })),
    ])
    child.proc.kill("SIGKILL")
    await child.exited
    sibling.kill()
    const own = ownJob(p, unrelated)
    expect({
      claimed,
      exitCode: exit.code,
      stdoutHasTerminal: child.stdout().includes('"result"'),
      ownCancelRequested: (own?.cancel_requested_at ?? null) !== null,
      unrelated: unrelatedState(p, unrelated),
    }).toEqual({
      claimed: true,
      exitCode: fx.daemonFirst.expectedEofExit,
      stdoutHasTerminal: false,
      ownCancelRequested: true,
      unrelated: untouched,
    })
  }, 30_000)

  // Enforces once `beforeOwnPumpClaim` exists: unarmed stdin never cancels.
  test("S35 Aborting a wrapper applies the chosen cancel policy — ignored stdin and a --request - body EOF consumed before admission arm no EOF cancel and the Run continues", async () => {
    const { p, requestPath, unrelated } = await abortProfile()
    const sibling = spawnSibling()
    const ignored = await daemonFirstChild(
      p,
      requestPath,
      sibling.pid,
      "ignore",
    )
    await realDelay(1500)
    const ignoredAlive =
      ignored.child.proc.exitCode === null && !ignored.child.proc.signalCode
    ignored.child.proc.kill("SIGKILL")
    await ignored.child.exited
    const firstOwn = ownJob(p, unrelated)
    const seen = [...unrelated, firstOwn?.id ?? "<none>"]
    const body = readFileSync(requestPath, "utf8")
    const fromStdin = await daemonFirstChild(
      p,
      requestPath,
      sibling.pid,
      "pipe",
      {
        requestFromStdin: body,
      },
    )
    await realDelay(1500)
    const stdinAlive =
      fromStdin.child.proc.exitCode === null && !fromStdin.child.proc.signalCode
    fromStdin.child.proc.kill("SIGKILL")
    await fromStdin.child.exited
    sibling.kill()
    const secondOwn = apiJobRows(p).find((row) => !seen.includes(row.id))
    expect({
      claimed: [ignored.claimed, fromStdin.claimed],
      alive: [ignoredAlive, stdinAlive],
      cancelRequests: [firstOwn, secondOwn].map(
        (row) => (row?.cancel_requested_at ?? null) !== null,
      ),
      statuses: [firstOwn?.status, secondOwn?.status],
      unrelated: unrelatedState(p, unrelated),
    }).toEqual({
      claimed: [true, true],
      alive: [true, true],
      cancelRequests: [false, false],
      statuses: ["running", "running"],
      unrelated: untouched,
    })
  }, 40_000)

  // Enforces once `beforeOwnPumpClaim` and the R4 relay exist.
  test("S35 Aborting a wrapper applies the chosen cancel policy — Career Kit SIGTERM then SIGKILL after 500 ms truncates the ack wait without undoing the persisted cancel request", async () => {
    const fx = controls()
    const { p, requestPath, unrelated } = await abortProfile()
    const sibling = spawnSibling()
    const { child, claimed } = await daemonFirstChild(
      p,
      requestPath,
      sibling.pid,
      "ignore",
    )
    child.proc.kill("SIGTERM")
    await realDelay(fx.careerKitKillGraceMs)
    child.proc.kill("SIGKILL")
    const exit = await child.exited
    sibling.kill()
    const own = ownJob(p, unrelated)
    expect({
      claimed,
      exitSignal: exit.signal,
      ownCancelRequested: (own?.cancel_requested_at ?? null) !== null,
      unrelated: unrelatedState(p, unrelated),
    }).toEqual({
      claimed: true,
      exitSignal: "SIGKILL",
      ownCancelRequested: true,
      unrelated: untouched,
    })
  }, 30_000)
})

// ===========================================================================
// Bounded Wait For Published Terminal Result
// ===========================================================================

describe("Bounded Wait For Published Terminal Result", () => {
  test("S05 Wait observes both commit and publication — pre-commit and published-incomplete stages are non-ready, release before the deadline returns the golden create envelope, the result lists the prepared tail, and a throwing final rename stays pending", async () => {
    const fx = fixtureCase("publication.json", "S05")
    // Stage: running (staging before commit).
    const pre = profile()
    const preId = await seedQueuedApiJob(pre, { artifacts: false })
    await claimAs(pre, preId, {
      workerId: "fixture-worker",
      workerPid: process.pid,
    })
    const preCommit = await waitCmd(pre, preId, "0", { extra: clockOption() })

    // Stage: completed, one registered terminal file not (yet) published.
    const p = profile()
    const run = controlledRunner()
    const created = await create(p, renderJson(fx.request, profileVars(p)), {
      runner: run.runner,
    })
    const jobId = firstApiJobId(p)
    const runDir = jobRowById(p, jobId)?.artifact_base_dir ?? p.root
    const removed = join(runDir, fx.removedTerminalFile)
    const removedBytes = readFileOrNull(removed)
    rmSync(removed, { force: true })
    const pending = await waitCmd(p, jobId, "0", { extra: clockOption() })
    const releaseClock = createFakeMonotonicClock({
      onSleep: () => {
        if (removedBytes !== null && !existsSync(removed)) {
          writeFileSync(removed, removedBytes)
        }
      },
    })
    const released = await waitCmd(p, jobId, fx.waitTimeoutArg, {
      extra: clockOption(releaseClock),
    })
    const releasedLine = jsonLines(released.stdout)[0]
    const resultCmd = await cli(p, ["api", "runs", "result", jobId, "--json"])

    // Artifact-free completion is ready at commit.
    const c = profile()
    seedProviderProfile(c, { id: "completion-main", targets: ["codex"] })
    const fetchSpy = completionFetchSpy()
    const completion = await create(c, completionRequestFixture(), {
      completionFetch: fetchSpy.fetchImpl,
    })
    const completionWait = await waitCmd(c, firstApiJobId(c), "0", {
      extra: clockOption(),
    })

    // A final rename that throws after the terminal commit.
    const t = profile()
    const throwingRun = {
      runner: async (request: any) => {
        const dir = jobRowById(t, request.identity.jobId)?.artifact_base_dir
        if (dir) mkdirSync(join(dir, fx.removedTerminalFile))
        return {
          status: "succeeded",
          exitCode: 0,
          result: { finalMessage: "fixture done" },
        }
      },
    }
    const throwCreate = await create(
      t,
      renderJson(fx.request, profileVars(t)),
      {
        runner: throwingRun.runner,
      },
    )
    const throwId = firstApiJobId(t)
    const throwWait = await waitCmd(
      t,
      throwId,
      fx.publishThrow.waitTimeoutArg,
      {
        extra: clockOption(),
      },
    )
    const pendingLine = jsonLines(pending.stdout)[0]
    const throwLine = jsonLines(throwWait.stdout)[0]

    expect({
      preCommit: {
        exit: preCommit.code,
        reason: jsonLines(preCommit.stdout)[0]?.wait?.reason,
        hasResult: "result" in (jsonLines(preCommit.stdout)[0] ?? {}),
      },
      pending: {
        exit: pending.code,
        reason: pendingLine?.wait?.reason,
        status: pendingLine?.job?.status,
        hasResult: pendingLine ? "result" in pendingLine : true,
      },
      released: { exit: released.code, stdout: released.stdout },
      preparedTailRoles: (releasedLine?.result?.artifacts ?? []).map(
        (a: any) => a.role,
      ),
      preparedTailHasSequence: hasSequenceKey(releasedLine?.result?.artifacts),
      runsResultDefaultRoles: (
        jsonLines(resultCmd.stdout)[0]?.artifacts ?? []
      ).map((a: any) => a.role),
      artifactFree: {
        exit: completionWait.code,
        stdout: completionWait.stdout,
      },
      publishThrow: {
        createExit: throwCreate.code,
        createArtifacts: jsonLines(throwCreate.stdout)[0]?.result?.artifacts,
        waitExit: throwWait.code,
        waitReason: throwLine?.wait?.reason,
        waitStatus: throwLine?.job?.status,
      },
    }).toEqual({
      preCommit: { exit: 9, reason: "run_pending", hasResult: false },
      pending: {
        exit: 9,
        reason: fx.expectedPendingReason,
        status: "succeeded",
        hasResult: false,
      },
      released: { exit: created.code, stdout: created.stdout },
      preparedTailRoles: fx.preparedTailRoles,
      preparedTailHasSequence: false,
      runsResultDefaultRoles: fx.runsResultDefaultRoles,
      artifactFree: { exit: completion.code, stdout: completion.stdout },
      publishThrow: {
        createExit: fx.publishThrow.createBaselineExit,
        createArtifacts: fx.publishThrow.createBaselineArtifacts,
        waitExit: fx.publishThrow.expectedWaitExit,
        waitReason: fx.publishThrow.expectedReason,
        waitStatus: fx.publishThrow.createBaselineStatus,
      },
    })
  }, 20_000)

  // Enforces once `beforeOwnPumpClaim` and `monotonicClock` exist: a remote
  // (daemon-first) claimant commits but its final rename throws.
  test("S05 Wait observes both commit and publication — a daemon-first wrapper whose claimant's final rename throws returns the identified terminal_artifacts_pending error/8 after 30000 ms instead of an outcome", async () => {
    const fx = fixtureCase("publication.json", "S05")
    const p = profile()
    const clock = createFakeMonotonicClock()
    const wrapperRun = controlledRunner()
    const obstacleRunner = async (request: any) => {
      const dir = jobRowById(p, request.identity.jobId)?.artifact_base_dir
      if (dir) mkdirSync(join(dir, fx.removedTerminalFile))
      return {
        status: "succeeded",
        exitCode: 0,
        result: { finalMessage: "fixture done" },
      }
    }
    let committedAtMs = -1
    const result = await create(p, renderJson(fx.request, profileVars(p)), {
      runner: wrapperRun.runner,
      extra: {
        ...clockOption(clock),
        beforeOwnPumpClaim: async () => {
          await daemonOnce(p, { runner: obstacleRunner as any })
          committedAtMs = clock.now()
        },
      },
    })
    const jobId = firstApiJobId(p)
    const lines = jsonLines(result.stdout)
    const elapsed = clock.now() - committedAtMs
    expect({
      exit: result.code,
      lineCount: lines.length,
      keys: keysOf(lines[0]),
      jobId: lines[0]?.job?.id,
      jobStatus: lines[0]?.job?.status,
      wait: lines[0]?.wait,
      afterPublicationBound:
        committedAtMs >= 0 &&
        elapsed >=
          fx.daemonFirstPublishFailure.expected.boundAfterCompletedMs &&
        elapsed <=
          fx.daemonFirstPublishFailure.expected.boundAfterCompletedMs + 100,
      wrapperDispatches: wrapperRun.calls.length,
      completed: countType(p, jobId, "completed"),
    }).toEqual({
      exit: fx.daemonFirstPublishFailure.expected.exit,
      lineCount: 1,
      keys: ["apiVersion", "job", "wait"],
      jobId,
      jobStatus: "succeeded",
      wait: fx.daemonFirstPublishFailure.expected.wait,
      afterPublicationBound: true,
      wrapperDispatches: 0,
      completed: 1,
    })
  }, 15_000)

  async function buildObservationState(
    p: Profile,
    setup: string,
  ): Promise<string> {
    if (setup === "seeded-queued-api") return seedQueuedApiJob(p)
    if (setup === "seeded-queued-api-unadmitted-artifacts") {
      return seedQueuedApiJob(p, { artifacts: true })
    }
    if (setup === "seeded-running-api-alive-worker") {
      const id = await seedQueuedApiJob(p)
      await claimAs(p, id, {
        workerId: "fixture-worker",
        workerPid: process.pid,
      })
      return id
    }
    // created-artifacts-minus-result-json
    const run = controlledRunner()
    await create(p, agentArtifactsRequest(p), { runner: run.runner })
    const id = firstApiJobId(p)
    const dir = jobRowById(p, id)?.artifact_base_dir ?? p.root
    rmSync(join(dir, "result.json"), { force: true })
    return id
  }

  test("S06 Wait has explicit bounded timeout semantics — omitted, 0 and 25 ms timeouts emit one timeout envelope with the decision-table reason, exit 9, no result and an unmodified Run", async () => {
    const fx = fixtureCase("wait-observation.json", "S06")
    const locks = loadFixture("wait-observation.json").lockFixtures
    const actual: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}
    for (const state of fx.states) {
      for (const timeout of fx.timeoutArgs) {
        const p = profile()
        const jobId = await buildObservationState(p, state.setup)
        writeLock(p.lockPath, locks[state.lock], Date.parse(FIXED_NOW_ISO))
        const eventsBefore = eventRows(p, jobId).length
        const clock = createFakeMonotonicClock()
        const result = await waitCmd(p, jobId, timeout.arg, {
          extra: clockOption(clock),
        })
        const lines = jsonLines(result.stdout)
        const elapsed = clock.now()
        const key = `${state.id}@${timeout.arg ?? "default"}`
        actual[key] = {
          exit: result.code,
          lineCount: lines.length,
          keys: keysOf(lines[0]),
          wait: lines[0]?.wait,
          jobStatus: lines[0]?.job?.status,
          rowStatus: jobRowById(p, jobId)?.status,
          eventsAppended: eventRows(p, jobId).length - eventsBefore,
          elapsedInBound:
            timeout.timeoutMs === 0
              ? clock.sleeps.length === 0
              : elapsed >= timeout.timeoutMs &&
                elapsed <= timeout.timeoutMs + fx.pollIntervalMaxMs,
        }
        expected[key] = {
          exit: 9,
          lineCount: 1,
          keys: ["apiVersion", "job", "wait"],
          wait: {
            state: "timeout",
            timeoutMs: timeout.timeoutMs,
            reason: state.reason,
          },
          jobStatus: state.status,
          rowStatus: state.status,
          eventsAppended: 0,
          elapsedInBound: true,
        }
      }
    }
    expect(actual).toEqual(expected)
  }, 60_000)

  test("S06 Wait has explicit bounded timeout semantics — -1, 0.5, NaN, Infinity and 86400001 are rejected with the plain-text diagnostic/2, 86400000 is accepted and ready at the deadline read yields the outcome", async () => {
    const fx = fixtureCase("wait-observation.json", "S06")
    const p = profile()
    const run = controlledRunner()
    const created = await create(p, agentArtifactsRequest(p), {
      runner: run.runner,
    })
    const jobId = firstApiJobId(p)
    const invalid: Record<string, unknown> = {}
    for (const arg of fx.invalidTimeouts) {
      const result = await waitCmd(p, jobId, arg, { extra: clockOption() })
      invalid[arg] = {
        exit: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
      }
    }
    const max = await waitCmd(p, jobId, fx.maxAcceptedTimeout, {
      extra: clockOption(),
    })
    const resultFile = join(
      jobRowById(p, jobId)?.artifact_base_dir ?? p.root,
      "result.json",
    )
    const bytes = readFileOrNull(resultFile)
    rmSync(resultFile, { force: true })
    const deadlineClock = createFakeMonotonicClock({
      onSleep: (now) => {
        if (
          now >= fx.readyAtDeadline.restoreWhenClockReachesMs &&
          bytes !== null
        ) {
          writeFileSync(resultFile, bytes)
        }
      },
    })
    const atDeadline = await waitCmd(p, jobId, fx.readyAtDeadline.timeoutArg, {
      extra: clockOption(deadlineClock),
    })
    expect({
      invalid,
      max: { exit: max.code, stdout: max.stdout },
      atDeadline: { exit: atDeadline.code, stdout: atDeadline.stdout },
    }).toEqual({
      invalid: Object.fromEntries(
        fx.invalidTimeouts.map((arg: string) => [
          arg,
          { exit: 2, stdout: "", stderr: fx.invalidTimeoutStderr },
        ]),
      ),
      max: { exit: created.code, stdout: created.stdout },
      atDeadline: {
        exit: fx.readyAtDeadline.expectedExit,
        stdout: created.stdout,
      },
    })
  }, 20_000)

  test("S06 Wait has explicit bounded timeout semantics — a SQLITE_BUSY after the first valid snapshot returns the identified observation_failed/8 without touching the Run, and a fault before any snapshot emits only the plain-text diagnostic/8", async () => {
    const fx = fixtureCase("wait-observation.json", "S06")
    const p = profile()
    const runningId = await seedQueuedApiJob(p)
    await claimAs(p, runningId, {
      workerId: "fixture-worker",
      workerPid: process.pid,
    })
    let failing = false
    const afterSnapshot = faultableDb(
      p,
      (sql) => failing && /agent_job/i.test(sql),
    )
    const clock = createFakeMonotonicClock({
      onSleep: () => {
        failing = true
      },
    })
    const faulted = await waitCmd(p, runningId, "1000", {
      db: afterSnapshot.db,
      extra: clockOption(clock),
    })
    afterSnapshot.sqlite.close()
    const faultedLines = jsonLines(faulted.stdout)

    const queuedId = await seedQueuedApiJob(p)
    const beforeSnapshot = faultableDb(p, (_sql, params) =>
      params.includes(queuedId),
    )
    const early = await waitCmd(p, queuedId, "0", {
      db: beforeSnapshot.db,
      extra: clockOption(),
    })
    beforeSnapshot.sqlite.close()

    expect({
      faulted: {
        exit: faulted.code,
        lineCount: faultedLines.length,
        keys: keysOf(faultedLines[0]),
        jobId: faultedLines[0]?.job?.id,
        wait: faultedLines[0]?.wait,
      },
      runAfterFault: {
        status: jobRowById(p, runningId)?.status,
        completed: countType(p, runningId, "completed"),
        attempts: apiJobRows(p).filter(
          (row) => row.retry_of_job_id === runningId,
        ).length,
      },
      early: { exit: early.code, stdout: early.stdout, stderr: early.stderr },
    }).toEqual({
      faulted: {
        exit: fx.observationFault.expected.exit,
        lineCount: 1,
        keys: ["apiVersion", "job", "wait"],
        jobId: runningId,
        wait: fx.observationFault.expected.wait,
      },
      runAfterFault: { status: "running", completed: 0, attempts: 0 },
      early: {
        exit: fx.preSnapshotFault.expected.exit,
        stdout: fx.preSnapshotFault.expected.stdout,
        stderr: renderGolden(fx.preSnapshotFault.expected.stderrTemplate, {
          JOB_ID: queuedId,
        }),
      },
    })
  }, 20_000)

  test("S07 Multiple waiters and late facts cannot change the result — two waiters across the commit and a third after a late diagnostic return the same terminal envelope without appending events, changing digests or starting another attempt", async () => {
    const fx = fixtureCase("publication.json", "S07")
    const p = profile()
    const latch = createLatch()
    const run = controlledRunner({ latch })
    await submit(p, renderJson(fx.request, profileVars(p)), {
      runner: run.runner,
    })
    const jobId = firstApiJobId(p)
    const executor = daemonOnce(p, { runner: run.runner })
    const entered = await Promise.race([
      run.entered.then(() => true),
      realDelay(2000).then(() => false),
    ])
    const waiters = [0, 1].map(() => waitCmd(p, jobId, fx.waitTimeoutArg))
    await realDelay(150)
    latch.release()
    await executor
    const [first, second] = await Promise.all(waiters)

    const job = getAgentJob(p.db, jobId)
    if (job && job.status !== "queued" && job.status !== "running") {
      const ledger = await getOrCreateRunEventLedger(p.db, job)
      await ledger.appendSystemEvent({
        observationKey: fx.lateDiagnostic.observationKey,
        type: fx.lateDiagnostic.type,
        payload: fx.lateDiagnostic.payload,
      })
      releaseRunEventLedger(p.db, jobId)
    }
    const runDir = jobRowById(p, jobId)?.artifact_base_dir ?? p.root
    const digestsBefore = dirDigests(runDir)
    const eventsBefore = eventRows(p, jobId).length
    const third = await waitCmd(p, jobId, fx.waitTimeoutArg)
    const lateRead = await cli(p, ["api", "runs", "events", jobId, "--jsonl"])
    const lateSeen = jsonLines(lateRead.stdout).some(
      (event) =>
        event?.payload?.observation?.note === fx.lateDiagnostic.payload.note,
    )

    expect({
      entered,
      exits: [first.code, second.code, third.code],
      firstMatchesGolden: first.stdout,
      sameEnvelope: [
        second.stdout === first.stdout,
        third.stdout === first.stdout,
      ],
      eventsAppendedByWaiter: eventRows(p, jobId).length - eventsBefore,
      digestsUnchanged:
        JSON.stringify(dirDigests(runDir)) === JSON.stringify(digestsBefore),
      attempts: apiJobRows(p).length,
      completed: countType(p, jobId, "completed"),
      dispatches: run.calls.length,
      lateSeen,
    }).toEqual({
      entered: true,
      exits: [0, 0, 0],
      firstMatchesGolden: renderGolden(
        golden("succeeded").stdout,
        jobVars(p, jobId),
      ),
      sameEnvelope: [true, true],
      eventsAppendedByWaiter: 0,
      digestsUnchanged: true,
      attempts: 1,
      completed: 1,
      dispatches: 1,
      lateSeen: true,
    })
  }, 30_000)
})

// ===========================================================================
// Executor Availability Observation
// ===========================================================================

describe("Executor Availability Observation", () => {
  test("S16 Submission without an executor is observable — with no executor lock the submitted Run stays queued, status reports unavailable/no_executor with the daemon hint, wait times out with executor_unavailable/9 and the store overview lists the same job", async () => {
    const fx = fixtureCase("wait-observation.json", "S16")
    const p = profile()
    const run = controlledRunner()
    const ack = await submit(p, renderJson(fx.request, profileVars(p)), {
      runner: run.runner,
    })
    const jobId = firstApiJobId(p)
    const status = await statusCmd(p, jobId)
    const statusLine = jsonLines(status.stdout)[0]
    const waited = await waitCmd(p, jobId, fx.waitTimeoutArg, {
      extra: clockOption(),
    })
    const waitLine = jsonLines(waited.stdout)[0]
    const overview = listAgentJobs(p.db).find((job) => job.id === jobId)
    const execution = statusLine?.execution ?? {}
    expect({
      ackExit: ack.code,
      execution: {
        state: execution.state,
        reason: execution.reason,
        hint: execution.hint,
        observedAt: typeof execution.observedAt,
      },
      wait: {
        exit: waited.code,
        state: waitLine?.wait?.state,
        timeoutMs: waitLine?.wait?.timeoutMs,
        reason: waitLine?.wait?.reason,
      },
      rowStatus: jobRowById(p, jobId)?.status,
      types: eventTypes(p, jobId),
      providerCalls: run.calls.length,
      overview: overview
        ? {
            source: overview.source,
            status: overview.status,
            consumer: overview.apiConsumerId,
          }
        : null,
    }).toEqual({
      ackExit: 0,
      execution: { ...fx.expectedExecution, observedAt: "string" },
      wait: {
        exit: fx.expectedWait.exit,
        state: fx.expectedWait.state,
        timeoutMs: fx.expectedWait.timeoutMs,
        reason: fx.expectedWait.reason,
      },
      rowStatus: "queued",
      types: ["job_created"],
      providerCalls: 0,
      overview: { source: "api", status: "queued", consumer: "fixture-a" },
    })
  })

  test("S17 Lock observations do not invent liveness — status derives available/unavailable/unknown from same-profile lock evidence without writing the lock, exposing PID/nonce/path, or altering workerPid, terminal status or runtime readiness", async () => {
    const fx = fixtureCase("wait-observation.json", "S17")
    const locks = loadFixture("wait-observation.json").lockFixtures
    const actual: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}
    for (const row of fx.rows) {
      const p = profile()
      const jobId = await seedQueuedApiJob(p)
      const lockSpec =
        row.lock === "no_lock_path" ? locks.alive_v2_fresh : locks[row.lock]
      const lockText = writeLock(
        p.lockPath,
        lockSpec,
        Date.parse(FIXED_NOW_ISO),
      )
      const status = await statusCmd(p, jobId, {
        lockPath: row.lock === "no_lock_path" ? null : p.lockPath,
      })
      const execution = jsonLines(status.stdout)[0]?.execution ?? null
      const executionText = JSON.stringify(execution)
      const lockAfter = readFileOrNull(p.lockPath)
      const pidText = lockText ? String(JSON.parse(lockText).pid) : "<none>"
      actual[row.lock] = {
        state: execution?.state,
        reason: execution?.reason,
        hint: execution?.hint ?? null,
        hintKeyPresent: execution ? "hint" in execution : false,
        observedAt: typeof execution?.observedAt,
        forbiddenKeys: fx.forbiddenExecutionKeys.filter((key: string) =>
          execution ? key in execution : false,
        ),
        // Coordinator adjudication 2026-10-02: the pid probe matches a whole number
        // (the EPERM fixture pid is 1, which any ISO timestamp also contains).
        leaks: [p.lockPath, pidText, "nonce-A", "nonce-legacy"].filter(
          (needle) =>
            needle === pidText
              ? new RegExp(
                  `(^|[^0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^0-9]|$)`,
                ).test(executionText)
              : executionText.includes(needle),
        ),
        lockUnchanged: lockAfter === lockText,
      }
      expected[row.lock] = {
        state: row.state,
        reason: row.reason,
        hint: row.hint,
        hintKeyPresent: row.hint !== null,
        observedAt: "string",
        forbiddenKeys: [],
        leaks: [],
        lockUnchanged: true,
      }
    }

    const p = profile()
    const runningId = await seedQueuedApiJob(p)
    await claimAs(p, runningId, {
      workerId: "fixture-worker",
      workerPid: process.pid,
    })
    const running = jsonLines((await statusCmd(p, runningId)).stdout)[0]
    const terminalId = await seedQueuedApiJob(p)
    await cancelCmd(p, terminalId)
    const terminal = jsonLines((await statusCmd(p, terminalId)).stdout)[0]
    const readinessArgs = ["api", "runtimes", "list", "--json", "--no-probe"]
    const readinessOptions = {
      extra: { runtimeReadinessDependencies: READINESS_STUB },
    }
    const readinessWithoutLock = await cli(p, readinessArgs, readinessOptions)
    writeLock(p.lockPath, locks.alive_v2_fresh, Date.parse(FIXED_NOW_ISO))
    clearRuntimeReadinessCacheForTest()
    const readinessWithLock = await cli(p, readinessArgs, readinessOptions)

    expect({
      rows: actual,
      runningWorkerPid: running?.job?.workerPid,
      runningHasExecution: running ? "execution" in running : false,
      terminalHasExecution: terminal ? "execution" in terminal : true,
      readiness: {
        exits: [readinessWithoutLock.code, readinessWithLock.code],
        unchanged: readinessWithLock.stdout === readinessWithoutLock.stdout,
      },
    }).toEqual({
      rows: expected,
      runningWorkerPid: process.pid,
      runningHasExecution: true,
      terminalHasExecution: false,
      readiness: { exits: [0, 0], unchanged: true },
    })
  }, 20_000)

  test("S17 Lock observations do not invent liveness — an API-capable daemon writes lock v2, refreshes heartbeatAt at most 1000 ms apart without changing its nonce, and never refreshes or unlinks a successor's lock", async () => {
    setSystemTime()
    const fx = fixtureCase("wait-observation.json", "S17").writer
    const p = profile()
    await createAgentJob(p.db, {
      source: "daemon",
      runtime: "codex",
      mode: "plan",
      cwd: p.packageDir,
      prompt: "Daemon tick fixture.",
    })
    const snapshots: Array<string | null> = []
    let successorText = ""
    const runner = async () => {
      snapshots.push(readFileOrNull(p.lockPath))
      await realDelay(fx.observeForMs / 2)
      snapshots.push(readFileOrNull(p.lockPath))
      const own = JSON.parse(snapshots[1] ?? "{}")
      successorText = JSON.stringify({
        ...own,
        nonce: fx.successorNonce,
        pid: process.pid,
      })
      writeFileSync(p.lockPath, successorText)
      await realDelay(fx.observeForMs / 2)
      snapshots.push(readFileOrNull(p.lockPath))
      return {
        status: "succeeded",
        exitCode: 0,
        result: { finalMessage: "tick" },
      }
    }
    await daemonOnce(p, { runner: runner as any })
    const [first, second, third] = snapshots.map((text) =>
      JSON.parse(text ?? "{}"),
    )
    expect({
      v2: {
        lockFormat: first?.lockFormat,
        apiCapable: first?.apiCapable,
        heartbeatAt: typeof first?.heartbeatAt,
        pid: first?.pid,
      },
      sameNonce: second?.nonce === first?.nonce,
      heartbeatRefreshed: second?.heartbeatAt !== first?.heartbeatAt,
      successorUntouchedWhileRunning: snapshots[2] === successorText,
      successorSurvivesRelease: readFileOrNull(p.lockPath) === successorText,
      thirdNonce: third?.nonce,
    }).toEqual({
      v2: {
        lockFormat: 2,
        apiCapable: true,
        heartbeatAt: "string",
        pid: process.pid,
      },
      sameNonce: true,
      heartbeatRefreshed: true,
      successorUntouchedWhileRunning: true,
      successorSurvivesRelease: true,
      thirdNonce: fx.successorNonce,
    })
  }, 20_000)
})

// ===========================================================================
// Async Control Preserves Run Identity
// ===========================================================================

describe("Async Control Preserves Run Identity", () => {
  test("S18 Queued cancel wins claim without a second terminal — cancel-first (artifact and artifact-free) settles one canceled completed, the executor never spawns, wait is ready with exit 5, and repeated cancel/Workbench reads add nothing", async () => {
    const fx = fixtureCase("controls.json", "S18")
    const actual: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}
    for (const [variant, template] of Object.entries<any>(fx.requests)) {
      const p = profile()
      const run = controlledRunner()
      await submit(p, renderJson(template, profileVars(p)), {
        runner: run.runner,
      })
      const jobId = firstApiJobId(p)
      const canceled = await cancelCmd(p, jobId)
      await daemonOnce(p, { runner: run.runner })
      const waited = await waitCmd(p, jobId, "0", { extra: clockOption() })
      const waitLine = jsonLines(waited.stdout)[0]
      await cancelCmd(p, jobId)
      listAgentJobs(p.db)
      listAgentJobs(p.db, { source: "api" })
      actual[variant] = {
        cancelExit: canceled.code,
        cancelStatus: jsonLines(canceled.stdout)[0]?.job?.status,
        spawned: run.calls.length,
        started: countType(p, jobId, "job_started"),
        completed: countType(p, jobId, "completed"),
        waitExit: waited.code,
        waitStatus: waitLine?.job?.status,
        waitHasResult: waitLine ? "result" in waitLine : false,
      }
      expected[variant] = {
        cancelExit: 0,
        cancelStatus: fx.cancelFirst.expectedStatus,
        spawned: fx.cancelFirst.expectedRunnerCalls,
        started: 0,
        completed: fx.cancelFirst.expectedCompleted,
        waitExit: fx.cancelFirst.expectedWaitExit,
        waitStatus: "canceled",
        waitHasResult: true,
      }
    }
    expect(actual).toEqual(expected)
  }, 20_000)

  test("S18 Queued cancel wins claim without a second terminal — start-first records the cancel as a request until the worker confirms, and racing cancels commit exactly one terminal", async () => {
    const fx = fixtureCase("controls.json", "S18")
    const p = profile()
    const latch = createLatch()
    const run = controlledRunner({ latch })
    await submit(p, renderJson(fx.requests.artifactFree, profileVars(p)), {
      runner: run.runner,
    })
    const startedId = firstApiJobId(p)
    const executor = daemonOnce(p, { runner: run.runner })
    const entered = await Promise.race([
      run.entered.then(() => true),
      realDelay(2000).then(() => false),
    ])
    const midCancel = await cancelCmd(p, startedId)
    const midRow = jobRowById(p, startedId)
    const completedWhileRunning = countType(p, startedId, "completed")
    latch.release()
    await executor

    const q = profile()
    await submit(q, renderJson(fx.requests.artifactBearing, profileVars(q)))
    const racedId = firstApiJobId(q)
    const raced = await Promise.all([
      cancelCmd(q, racedId),
      cancelCmd(q, racedId),
    ])

    expect({
      entered,
      midCancelExit: midCancel.code,
      midStatus: midRow?.status,
      midCancelRequested: (midRow?.cancel_requested_at ?? null) !== null,
      completedWhileRunning,
      completedAfterWorker: countType(p, startedId, "completed"),
      racedExits: raced.map((r) => r.code),
      racedCompleted: countType(q, racedId, "completed"),
      racedStatus: jobRowById(q, racedId)?.status,
    }).toEqual({
      entered: true,
      midCancelExit: 0,
      midStatus: "running",
      midCancelRequested: true,
      completedWhileRunning: 0,
      completedAfterWorker: fx.startFirst.expectedCompleted,
      racedExits: [0, 0],
      racedCompleted: fx.cancelCancel.expectedCompleted,
      racedStatus: "canceled",
    })
  }, 20_000)

  test("S20 API reads and control stay source-scoped — wait on missing or non-API IDs emits only `Unknown job: <id>`/3 while cancel/events/retry keep their 2c59664f baseline errors and retry rejects succeeded/queued API jobs", async () => {
    const fx = fixtureCase("controls.json", "S20")
    const p = profile()
    const ids: Record<string, string> = { missing: fx.missingId }
    for (const source of fx.sources) {
      const job = await createAgentJob(p.db, {
        source,
        runtime: source === "desktop" ? "claude-code" : "codex",
        mode: "plan",
        cwd: p.packageDir,
        prompt: "Source scoping fixture.",
      })
      ids[source] = job.id
    }
    const run = controlledRunner()
    await create(p, agentArtifactFreeRequest(p), { runner: run.runner })
    ids.succeededApi = firstApiJobId(p)
    ids.queuedApi = await seedQueuedApiJob(p)
    const jobsBefore = allJobRows(p).length
    const dispatchesBefore = run.calls.length

    const actual: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}
    for (const key of ["missing", ...fx.sources]) {
      const id = ids[key]
      const waited = await waitCmd(p, id, "0", { extra: clockOption() })
      actual[`${key}:wait`] = {
        exit: waited.code,
        stdout: waited.stdout,
        stderr: waited.stderr,
      }
      expected[`${key}:wait`] = {
        exit: fx.waitExpected.exit,
        stdout: fx.waitExpected.stdout,
        stderr: renderGolden(fx.waitExpected.stderrTemplate, { ID: id }),
      }
    }
    for (const [name, baseline] of Object.entries<any>(fx.baselines)) {
      const [key, command] = name.split(":")
      const id = ids[key]
      const args =
        command === "events"
          ? ["api", "runs", "events", id, "--jsonl"]
          : ["api", "runs", command, id, "--json"]
      const result = await cli(p, args, { runner: run.runner })
      actual[name] = {
        exit: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
      }
      expected[name] = {
        exit: baseline.exit,
        stdout: renderGolden(baseline.stdout, { ID: id }),
        stderr: renderGolden(baseline.stderr, { ID: id }),
      }
    }
    expect({
      results: actual,
      newJobs: allJobRows(p).length - jobsBefore,
      newDispatches: run.calls.length - dispatchesBefore,
    }).toEqual({ results: expected, newJobs: 0, newDispatches: 0 })
  })
})

// ===========================================================================
// Async Features Preserve Existing V1 Contracts
// ===========================================================================

describe("Async Features Preserve Existing V1 Contracts", () => {
  test("S21 V1 event and artifact regression is unchanged — Runs produced by the queued executor replay the 2c59664f events (--after, --follow), result and terminal envelope byte for byte across all 12 public event types, with late diagnostics visible only to later reads", async () => {
    const fx = fixtureCase("public-v1.json", "S21")
    const p = profile()
    const run = controlledRunner({ events: fx.runnerEvents })
    await submit(p, agentArtifactsRequest(p), { runner: run.runner })
    await daemonOnce(p, { runner: run.runner })
    const jobId = firstApiJobId(p)
    const vars = jobVars(p, jobId)
    const after2 = await cli(p, [
      "api",
      "runs",
      "events",
      jobId,
      "--after",
      "2",
      "--jsonl",
    ])
    const follow = await cli(p, [
      "api",
      "runs",
      "events",
      jobId,
      "--follow",
      "--jsonl",
    ])
    const result = await cli(p, ["api", "runs", "result", jobId, "--json"])
    const waited = await waitCmd(p, jobId, "0", { extra: clockOption() })
    const job = getAgentJob(p.db, jobId)
    let lateRead = ""
    if (job && job.status === "succeeded") {
      const ledger = await getOrCreateRunEventLedger(p.db, job)
      await ledger.appendSystemEvent({
        observationKey: fx.lateDiagnostic.observationKey,
        type: fx.lateDiagnostic.type,
        payload: fx.lateDiagnostic.payload,
      })
      releaseRunEventLedger(p.db, jobId)
      lateRead = (await cli(p, ["api", "runs", "events", jobId, "--jsonl"]))
        .stdout
    }
    const waitAfterLate = await waitCmd(p, jobId, "0", { extra: clockOption() })

    const c = profile()
    seedProviderProfile(c, { id: "completion-main", targets: ["codex"] })
    const fetchSpy = completionFetchSpy()
    await submit(c, completionRequestFixture(), {
      completionFetch: fetchSpy.fetchImpl,
    })
    await daemonOnce(c, { completionFetch: fetchSpy.fetchImpl })
    const completionId = firstApiJobId(c)
    const completionEvents = await cli(c, [
      "api",
      "runs",
      "events",
      completionId,
      "--jsonl",
    ])

    const followLines = jsonLines(follow.stdout)
    const allTypes = new Set(
      [...followLines, ...jsonLines(completionEvents.stdout)].map(
        (event) => event.type,
      ),
    )
    expect({
      eventsAfter2: after2.stdout,
      eventsFollow: follow.stdout,
      result: result.stdout,
      wait: { exit: waited.code, stdout: waited.stdout },
      completionEvents: completionEvents.stdout,
      envelopeKeys: [
        ...new Set(followLines.map((event) => keysOf(event).join(","))),
      ],
      denseSequences: followLines.map((event) => event.sequence),
      afterIsStrict: jsonLines(after2.stdout).every(
        (event) => event.sequence > 2,
      ),
      publicTypes: [...allTypes].sort(),
      lateVisibleToLaterRead: jsonLines(lateRead).some(
        (event) =>
          event?.payload?.observation?.note === fx.lateDiagnostic.payload.note,
      ),
      waitUnchangedByLate: waitAfterLate.stdout === waited.stdout,
    }).toEqual({
      eventsAfter2: renderGolden(fx.agent.eventsAfter2, vars),
      eventsFollow: renderGolden(fx.agent.eventsFollow, vars),
      result: renderGolden(fx.agent.result, vars),
      wait: {
        exit: fx.agent.exit,
        stdout: renderGolden(fx.agent.createStdout, vars),
      },
      completionEvents: renderGolden(
        fx.completion.events,
        jobVars(c, completionId),
      ),
      envelopeKeys: [[...fx.eventEnvelopeKeys].sort().join(",")],
      denseSequences: followLines.map((_event, index) => index + 1),
      afterIsStrict: true,
      publicTypes: [...fx.publicEventTypes].sort(),
      lateVisibleToLaterRead: true,
      waitUnchangedByLate: true,
    })
  }, 20_000)

  test("S24 Completion uses the same queued admission — a submitted completion is acknowledged with zero upstream calls, an existing daemon makes exactly one call after claim, wait returns the baseline completion envelope with no child or run-dir, and an unusable explicit profile never falls back", async () => {
    const fx = fixtureCase("public-submission.json", "S24")
    const p = profile()
    seedProviderProfile(p, fx.providerProfile)
    const run = controlledRunner()
    const fetchSpy = completionFetchSpy()
    const ack = await submit(p, fx.request, {
      runner: run.runner,
      completionFetch: fetchSpy.fetchImpl,
    })
    const jobId = firstApiJobId(p)
    const fetchAtAck = fetchSpy.calls.length
    await daemonOnce(p, {
      runner: run.runner,
      completionFetch: fetchSpy.fetchImpl,
    })
    const waited = await waitCmd(p, jobId, null, { extra: clockOption() })
    const row = jobRowById(p, jobId)

    const baseline = profile()
    seedProviderProfile(baseline, fx.providerProfile)
    const baselineFetch = completionFetchSpy()
    const created = await create(baseline, fx.request, {
      completionFetch: baselineFetch.fetchImpl,
    })
    const createdId = firstApiJobId(baseline)
    const [goldenFile, goldenPath] = fx.goldenRef.split("#")
    const goldenEntry = goldenPath
      .split(".")
      .reduce(
        (value: any, key: string) => value?.[key],
        loadFixture(goldenFile).cases,
      )

    const missingFetch = completionFetchSpy()
    const jobsBeforeMissing = allJobRows(p).length
    const missing = await submit(p, fx.explicitProfileFailure.request, {
      completionFetch: missingFetch.fetchImpl,
    })

    expect({
      ackExit: ack.code,
      ackStatus: jsonLines(ack.stdout)[0]?.job?.status,
      fetchAtAck,
      upstreamCalls: fetchSpy.calls.length,
      runtimeChildren: run.calls.length,
      wait: { exit: waited.code, stdout: waited.stdout },
      artifactManifestPath: row?.artifact_manifest_path ?? null,
      runDirs: existsSync(p.artifactBaseDir)
        ? readdirSync(p.artifactBaseDir)
        : [],
      createBaseline: { exit: created.code, stdout: created.stdout },
      missingProfile: {
        exit: missing.code,
        stdout: missing.stdout,
        stderr: missing.stderr,
        upstreamCalls: missingFetch.calls.length,
        newJobs: allJobRows(p).length - jobsBeforeMissing,
      },
    }).toEqual({
      ackExit: 0,
      ackStatus: "queued",
      fetchAtAck: fx.expected.fetchCallsAtAck,
      upstreamCalls: fx.expected.fetchCallsAfterExecution,
      runtimeChildren: fx.expected.runnerCalls,
      wait: {
        exit: goldenEntry.exit,
        stdout: renderGolden(goldenEntry.stdout, jobVars(p, jobId)),
      },
      artifactManifestPath: fx.expected.artifactManifestPath,
      runDirs: [],
      createBaseline: {
        exit: goldenEntry.exit,
        stdout: renderGolden(goldenEntry.stdout, jobVars(baseline, createdId)),
      },
      missingProfile: {
        exit: fx.explicitProfileFailure.baseline.exit,
        stdout: fx.explicitProfileFailure.baseline.stdout,
        stderr: fx.explicitProfileFailure.baseline.stderr,
        upstreamCalls: 0,
        newJobs: 0,
      },
    })
  }, 20_000)
})

// ===========================================================================
// Discovery Feature Advertisement (MODIFIED) — S22 / S23
// ===========================================================================

describe("Discovery Feature Advertisement", () => {
  function validator(schema: any) {
    const ajv = new Ajv2020({ allErrors: true, strict: false })
    addFormats(ajv)
    ajv.addSchema(schema, "local-job-api-v1")
    return ajv.getSchema("local-job-api-v1#/$defs/runtimeManifestEnvelope")
  }

  test("S22 Discovery advertises the extension with explicit schema evolution — runtimes list keeps v1 and every existing feature, adds async-submit, passes the updated schema and fails the pinned 2c59664f schema exactly at the discoveryFeature enum", async () => {
    const fx = fixtureCase("discovery.json", "S22")
    const p = profile()
    const listed = await cli(
      p,
      ["api", "runtimes", "list", "--json", "--no-probe"],
      {
        extra: { runtimeReadinessDependencies: READINESS_STUB },
      },
    )
    const discovery = jsonLines(listed.stdout)[0] ?? {}
    const features: string[] = Array.isArray(discovery.features)
      ? discovery.features
      : []
    const current = validator(
      JSON.parse(
        readFileSync(
          join(import.meta.dir, "..", "docs", "local-job-api-v1.schema.json"),
          "utf8",
        ),
      ),
    )
    const pinned = validator(
      JSON.parse(readFileSync(join(FIXTURE_DIR, "schema-before.json"), "utf8")),
    )
    const currentValid = current ? current(discovery) : false
    const pinnedValid = pinned ? pinned(discovery) : true
    const asyncIndex = features.indexOf(fx.newFeature)
    const pinnedEnumErrors = (pinned?.errors ?? [])
      .filter((error: any) => error.keyword === "enum")
      .map((error: any) => error.instancePath)
    const shared = await import("../src/shared/local-job-api")

    expect({
      exit: listed.code,
      apiVersion: discovery.apiVersion,
      keepsExisting: fx.oldDiscovery.features.every((feature: string) =>
        features.includes(feature),
      ),
      advertises: features.includes(fx.newFeature),
      sharedConstant: (
        shared.LOCAL_JOB_API_DISCOVERY_FEATURES as readonly string[]
      ).includes(fx.newFeature),
      currentSchemaValid: currentValid,
      pinnedSchemaValid: pinnedValid,
      pinnedEnumErrors,
      baselineOldOutputHasFeature: fx.oldDiscovery.features.includes(
        fx.newFeature,
      ),
    }).toEqual({
      exit: 0,
      apiVersion: API_VERSION,
      keepsExisting: true,
      advertises: true,
      sharedConstant: true,
      currentSchemaValid: true,
      pinnedSchemaValid: false,
      pinnedEnumErrors: [`${fx.enumPath}${asyncIndex}`],
      baselineOldOutputHasFeature: false,
    })
  })

  test("S23 Unsupported version and absent feature fail closed — the documentation preflight refuses without the feature, the current submit parser rejects wrong versions with the v1 stderr/2 and no job, and the vendored 2c59664f parser rejects submit/retry --request/wait shapes with exit 2", async () => {
    const fx = fixtureCase("discovery.json", "S23")
    const p = profile()
    let dispatches = 0
    const preflight = consumerPreflight(
      fx.noFeatureDiscovery,
      "async-submit",
      () => {
        dispatches += 1
      },
    )
    const versions: Record<string, unknown> = {}
    for (const version of fx.wrongVersions) {
      const request = { ...agentArtifactFreeRequest(p), apiVersion: version }
      const result = await submit(p, request)
      versions[version] = {
        exit: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
      }
    }
    const jobsAfter = allJobRows(p).length
    const oldParser: any = await import(
      "./fixtures/local-job-api-async/submit-wait/cli-args-before"
    )
    const shapes = fx.oldParserShapes.map((shape: any) =>
      oldParser.parseHeadlessCliArgv([
        "Locus",
        oldParser.HEADLESS_CLI_MARKER,
        ...shape.argv,
      ]),
    )
    expect({
      preflight,
      dispatches,
      versions,
      jobsAfter,
      shapes,
      counterevidenceKeyed:
        typeof fx.keyedCreateSilentDropCounterevidence.request.idempotencyKey,
    }).toEqual({
      preflight: "unsupported",
      dispatches: 0,
      versions: Object.fromEntries(
        fx.wrongVersions.map((version: string) => [
          version,
          fx.expectedVersionError,
        ]),
      ),
      jobsAfter: 0,
      shapes: fx.oldParserShapes.map((shape: any) => shape.expected),
      counterevidenceKeyed: "string",
    })
  })
})
