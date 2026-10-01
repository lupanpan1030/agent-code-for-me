// biome-ignore-all lint/suspicious/noExplicitAny: coordinator adjudication (red suite, CI PR-base lint ratchet) — untyped guard/stdio fixture plumbing; no assertion changed
/**
 * Independent red acceptance tests for add-local-job-api-async-submit,
 * guards-protocol domain: S29, S30 (agent-protocol-interfaces job.run /
 * cancel / shutdown), S31 (schedule canonical insertion), S32, S33
 * (architecture guard), and the inherited S48-S51 jobs-stdio scenarios
 * (S47 is registered against existing tests; see the report).
 *
 * Written before any implementation exists. New seams (run-submission.ts
 * submitRun/waitForRun, daemon.ts pumpQueuedRuns, `api runs submit`, the
 * async-submit architecture guard section) are reached lazily inside each
 * test so their absence fails that test, never the file.
 */
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { drizzle } from "drizzle-orm/bun-sqlite"
import ts from "typescript"
import * as schema from "../src/main/lib/db/schema"
import {
  serializeAgentJob,
  serializeAgentJobEvent,
} from "../src/main/lib/headless/cli-output"
import * as jobStore from "../src/main/lib/headless/job-store"
import {
  createAgentSchedule,
  evaluateDueAgentSchedules,
  listAgentScheduleRuns,
} from "../src/main/lib/headless/schedules"
import {
  ASYNC_GUARD_FIXTURE_FLAG,
  ASYNC_GUARD_LABEL,
  admittedIdsOf,
  cleanupTempDirs,
  closeOpenDbs,
  containsString,
  countEvents,
  createLatchedRunner,
  createRegisteredProjectDb,
  Database,
  eventRows,
  fixtureCase,
  fixtureSubset,
  GUARD_TIMEOUT_MS,
  idempotencyTableRowCounts,
  installClaimLatch,
  installRecordingSeams,
  jobRowOf,
  loadFixture,
  PROTOCOL_TEST_TIMEOUT_MS,
  readRepoFile,
  runArchitectureGuard,
  runCli,
  settledResult,
  startStdioSession,
  waitFor,
  withProjectCwd,
  writeTempFixture,
} from "./local-job-api-async-guards-protocol-kit"

afterEach(() => {
  mock.restore()
  closeOpenDbs()
  cleanupTempDirs()
})

const rpc = (id: string | number, method: string, params: unknown = {}) => ({
  jsonrpc: "2.0",
  id,
  method,
  params,
})

// ---------------------------------------------------------------------------
// Pinned S32/S33 guard oracle. The fixture's expectedFindings must equal this
// table, so the guard oracle cannot be weakened by editing the fixture.
// Format: caseId -> "rule|file|symbol|owner" (ownerSection is the fixture's).
// ---------------------------------------------------------------------------

const H = "src/main/lib/headless"
const HOST = "src/main/lib/agent-runtime/run-event-ledger-host.ts"
const PINNED_GUARD_FINDINGS: Record<string, string[]> = {
  "s32-clean-envelope-adapters": [],
  "s32-restored-prepared-runner": [
    `retired-symbol|${H}/cli-dispatcher.ts|runPreparedLocalJobApiJob|${H}/run-submission.ts`,
    `inline-runner-call|${H}/cli-dispatcher.ts|runPersistedAgentJob|${H}/daemon.ts`,
    `inline-runner-call|${H}/cli-dispatcher.ts|runPersistedCompletionJob|${H}/daemon.ts`,
  ],
  "s32-create-inline-agent-runner": [
    `inline-runner-call|${H}/cli-dispatcher.ts|runPersistedAgentJob|${H}/daemon.ts`,
  ],
  "s32-retry-inline-completion-runner": [
    `inline-runner-call|${H}/cli-dispatcher.ts|runPersistedCompletionJob|${H}/daemon.ts`,
  ],
  "s32-submit-core-runs-inline": [
    `inline-runner-call|${H}/run-submission.ts|runPersistedAgentJob|${H}/daemon.ts`,
  ],
  "s32-stdio-inline-agent-runner": [
    `inline-runner-call|${H}/jobs-stdio.ts|runPersistedAgentJob|${H}/daemon.ts`,
  ],
  "s32-stdio-independent-dispatch-loop": [
    `independent-dispatch|${H}/jobs-stdio.ts|listQueuedAgentJobsForSource|${H}/daemon.ts`,
    `independent-dispatch|${H}/jobs-stdio.ts|startAgentJob|${H}/daemon.ts`,
  ],
  "s33-clean-schedule-shared-insertion": [],
  "s33-duplicate-submit-core": [
    `duplicate-definition|${H}/local-job-api.ts|submitRun|${H}/run-submission.ts`,
  ],
  "s33-duplicate-wait-reexport": [
    `duplicate-reexport|${H}/cli-dispatcher.ts|waitForRun|${H}/run-submission.ts`,
  ],
  "s33-duplicate-pump": [
    `duplicate-definition|${H}/jobs-stdio.ts|pumpQueuedRuns|${H}/daemon.ts`,
  ],
  "s33-api-adapter-direct-job-insert": [
    `direct-job-insert|${H}/local-job-api.ts|agentJobs|${H}/job-store.ts`,
  ],
  "s33-stdio-aliased-direct-job-insert": [
    `direct-job-insert|${H}/jobs-stdio.ts|agentJobs|${H}/job-store.ts`,
  ],
  "s33-schedule-direct-job-insert": [
    `direct-job-insert|${H}/schedules.ts|agentJobs|${H}/job-store.ts`,
  ],
  "s33-adapter-imports-store-append": [
    `forbidden-store-import|${H}/local-job-api.ts|appendExactRunEventBatch|${HOST}`,
  ],
  "s33-migration-toggle-old-core": [
    `retired-symbol|${H}/cli-dispatcher.ts|runPreparedLocalJobApiJob|${H}/run-submission.ts`,
  ],
  "s33-migration-toggle-ledger-gate": [
    `retired-symbol|${HOST}|canonicalRunEventLedgerV1|${HOST}`,
  ],
}

function fixtureFindingTable(fixture: any, scenario: string) {
  return Object.fromEntries(
    fixture.cases
      .filter((entry: any) => entry.scenario === scenario)
      .map((entry: any) => [
        entry.caseId,
        entry.expectedFindings
          .map((finding: any) => {
            expect(finding.ownerSection).toBe(fixture.ownerSection)
            return `${finding.rule}|${finding.file}|${finding.symbol}|${finding.owner}`
          })
          .sort(),
      ]),
  )
}

function pinnedTable(prefix: string) {
  return Object.fromEntries(
    Object.entries(PINNED_GUARD_FINDINGS)
      .filter(([caseId]) => caseId.startsWith(prefix))
      .map(([caseId, findings]) => [caseId, [...findings].sort()]),
  )
}

// ---------------------------------------------------------------------------
// agent-protocol-interfaces: S29 / S30 (ADDED scenarios of the MODIFIED
// Minimal Jobs Stdio Boundary requirement)
// ---------------------------------------------------------------------------

describe("agent-protocol-interfaces / Minimal Jobs Stdio Boundary (async submit)", () => {
  // Enforces once run-submission.ts submitRun, daemon.ts pumpQueuedRuns and
  // `locus api runs submit` exist: job.run and API submit share one submit seam.
  test(
    "S29 Job run acknowledges the shared creation core — API submit and jobs-stdio job.run both go through submitRun, the job.run ack follows the committed job_created fact, the session-scoped pumpQueuedRuns runs it after the runner latch opens, and extra consumer/key params stay invalid-params",
    async () => {
      const fixture = fixtureCase("stdio.json", "S29")
      const store = createRegisteredProjectDb()
      const input = withProjectCwd(fixture.input, store.projectCwd)
      const expected = fixture.expected
      const seams = await installRecordingSeams()
      const latched = createLatchedRunner()

      // --- collect: API submit (admission only, no daemon) -----------------
      const apiSubmit = await runCli(
        store.db,
        ["api", "runs", "submit", "--request", "-", "--json"],
        {
          stdin: JSON.stringify(input.apiSubmitRequest),
          runner: latched.runner,
        },
      )
      const apiEnvelope =
        apiSubmit.code === 0 ? JSON.parse(apiSubmit.stdout) : null
      const apiJobId: string | null = apiEnvelope?.job?.id ?? null
      const submitCallsAfterApi = seams.submitCalls?.length ?? null

      // --- collect: jobs-stdio session ---------------------------------------
      const session = startStdioSession({
        db: store.db,
        runner: latched.runner,
      })
      let ackSnapshot: { jobCreated: number; rowStatus: string | null } | null =
        null
      session.stdout.onLine((line) => {
        const ackedId = line?.id === "run" ? line?.result?.job?.id : null
        if (ackedId && !ackSnapshot) {
          ackSnapshot = {
            jobCreated: countEvents(store.sqlite, ackedId, "job_created"),
            rowStatus: jobRowOf(store.sqlite, ackedId)?.status ?? null,
          }
        }
      })
      const initialize = await session.request(input.initialize)
      const run = await session.request(
        rpc("run", "job.run", input.jobRunParams),
      )
      const jobId: string = run.result?.job?.id
      const submitCallsAfterRun = seams.submitCalls?.length ?? null
      const invalid = await session.request(
        rpc("extra", "job.run", {
          ...input.jobRunParams,
          ...input.extraParams,
        }),
      )
      const submitCallsAfterInvalid = seams.submitCalls?.length ?? null
      const protocolRows = (
        store.sqlite
          .query("SELECT id FROM agent_jobs WHERE source = 'protocol'")
          .all() as { id: string }[]
      ).map((row) => row.id)
      await waitFor(
        () => latched.invocations.has(jobId),
        "session executor runner start",
      )
      latched.release(jobId)
      await waitFor(
        () =>
          session
            .notifications("job/event", jobId)
            .some((n) => n.params.event.type === "completed"),
        "completed job/event notification",
      )
      const shutdown = await session.request(rpc("shutdown", "shutdown"))
      const exit = await session.exit
      const submitReturns = await seams.submitReturns()
      const notifiedSequences = session
        .notifications("job/event", jobId)
        .map((n) => n.params.event.sequence as number)
      const committedSequences = eventRows(store.sqlite, jobId).map(
        (row) => row.sequence as number,
      )
      const pumpScopes = (seams.pumpCalls ?? []).map(admittedIdsOf)
      const apiRow = apiJobId ? jobRowOf(store.sqlite, apiJobId) : null

      // --- expect: API submit admission (real gap: no submit command today) --
      expect({ code: apiSubmit.code, stderr: apiSubmit.stderr }).toEqual({
        code: expected.apiSubmitExitCode,
        stderr: "",
      })
      expect(Object.keys(apiEnvelope ?? {}).sort()).toEqual(
        [...expected.apiSubmitEnvelopeKeys].sort(),
      )
      expect(apiEnvelope?.job?.status).toBe("queued")

      // --- expect: the shared seams exist ------------------------------------
      expect(seams.available).toEqual({
        submitRun: "function",
        waitForRun: "function",
        pumpQueuedRuns: "function",
      })

      // --- expect: initialize and the original job.run ack shape -------------
      expect(initialize.result.protocolVersion).toBe(expected.protocolVersion)
      expect(initialize.result.capabilities).toEqual(expected.capabilities)
      expect(Object.keys(run.result ?? {})).toEqual(["job"])
      expect(Object.keys(run.result.job)).toEqual(
        Object.keys(
          serializeAgentJob(jobStore.getAgentJob(store.db, jobId) as any),
        ),
      )
      expect(run.result.job).toMatchObject({
        id: jobId,
        source: "protocol",
        status: expected.jobRunAckStatus,
      })
      // ack is written only after the creation fact committed
      expect(ackSnapshot).toEqual({
        jobCreated: 1,
        rowStatus: expect.any(String),
      })

      // --- expect: one submit seam, one creation per call ---------------------
      expect([
        submitCallsAfterApi,
        submitCallsAfterRun,
        submitCallsAfterInvalid,
      ]).toEqual([1, 2, 2])
      expect(
        apiJobId !== null && containsString(submitReturns[0], apiJobId),
      ).toBe(true)
      expect(containsString(submitReturns[1], jobId)).toBe(true)
      expect(invalid.error?.code).toBe(expected.invalidParamsCode)
      expect(protocolRows).toEqual([jobId])
      expect(countEvents(store.sqlite, jobId, "job_created")).toBe(1)
      expect(
        apiJobId ? countEvents(store.sqlite, apiJobId, "job_created") : null,
      ).toBe(1)

      // --- expect: the session-scoped common pump ran it ---------------------
      expect(pumpScopes.length).toBeGreaterThan(0)
      expect(
        pumpScopes.every(
          (scope) => scope?.every((id) => id === jobId) === true,
        ),
      ).toBe(true)
      expect(pumpScopes.some((scope) => scope?.includes(jobId))).toBe(true)
      expect(jobRowOf(store.sqlite, jobId).status).toBe(expected.terminalStatus)
      expect([...latched.invocations.keys()]).toEqual([jobId])
      expect(
        apiRow ? { status: apiRow.status, startedAt: apiRow.started_at } : null,
      ).toEqual({
        status: "queued",
        startedAt: null,
      })

      // --- expect: notifications read committed records once, in sequence ---
      expect(notifiedSequences).toEqual(committedSequences)
      expect(committedSequences).toEqual(
        committedSequences.map((_, index) => index + 1),
      )

      expect(shutdown.result).toEqual(expected.shutdownResult)
      expect(exit.code).toBe(0)
      // The only diagnostic is the existing invalid-params one; the admitted
      // job never surfaces a stream failure.
      expect(
        session.stderr
          .text()
          .split("\n")
          .filter((line) => line.includes(jobId)),
      ).toEqual([])
    },
    PROTOCOL_TEST_TIMEOUT_MS,
  )

  // Enforces once daemon.ts pumpQueuedRuns exists: each session pump is
  // scoped to that session's admitted IDs. The queued-cancel half is a real
  // gap today (a queued cancel that wins the claim surfaces job/error).
  test(
    "S30 Protocol cancel and shutdown remain session-owned — queued cancel wins the claim cleanly without spawn, running cancel reaches the paused worker, cross-session cancel is -32602, the API job is never canceled or claimed, and shutdown/EOF stop each session's own pump scope",
    async () => {
      const fixture = fixtureCase("stdio.json", "S30")
      const store = createRegisteredProjectDb()
      const input = withProjectCwd(fixture.input, store.projectCwd)
      const expected = fixture.expected
      const seams = await installRecordingSeams()
      const claims = installClaimLatch()
      const latched = createLatchedRunner()
      const apiJob = await jobStore.createAgentJob(store.db, {
        ...input.apiJob,
        cwd: store.projectCwd,
        projectId: store.projectId,
      })

      const A = startStdioSession({ db: store.db, runner: latched.runner })
      const B = startStdioSession({ db: store.db, runner: latched.runner })
      await A.request(rpc("a-init", "initialize"))
      await B.request(rpc("b-init", "initialize"))
      const aR: string = (
        await A.request(rpc("a-r", "job.run", input.sessionA.running))
      ).result.job.id
      await waitFor(
        () => latched.invocations.has(aR),
        "session A running worker",
      )
      const aQ: string = (
        await A.request(rpc("a-q", "job.run", input.sessionA.queued))
      ).result.job.id
      const bR: string = (
        await B.request(rpc("b-r", "job.run", input.sessionB.running))
      ).result.job.id
      await waitFor(
        () => latched.invocations.has(bR),
        "session B running worker",
      )
      const bQ: string = (
        await B.request(rpc("b-q", "job.run", input.sessionB.queued))
      ).result.job.id

      const cancelQueued = async (
        session: typeof A,
        id: string,
        jobId: string,
      ) => {
        const response = await session.request(rpc(id, "job.cancel", { jobId }))
        const atCancel = {
          status: jobRowOf(store.sqlite, jobId).status,
          completed: countEvents(store.sqlite, jobId, "completed"),
          started: countEvents(store.sqlite, jobId, "job_started"),
        }
        // Let a held claim race the cancel; the loser must fail closed.
        claims.release(jobId)
        if (claims.attempted(jobId)) {
          await await waitFor(
            () => claims.settlement(jobId),
            `claim settlement ${jobId}`,
          )
        }
        return { response, atCancel }
      }
      const cancelRunning = async (
        session: typeof A,
        id: string,
        jobId: string,
      ) => {
        const response = await session.request(rpc(id, "job.cancel", { jobId }))
        await waitFor(
          () => latched.invocations.get(jobId)?.abortObserved,
          `worker ${jobId} observes cancel`,
        )
        const completedWhilePaused = countEvents(
          store.sqlite,
          jobId,
          "completed",
        )
        latched.releaseCancel(jobId)
        await waitFor(
          () => countEvents(store.sqlite, jobId, "completed") >= 1,
          `completed ${jobId}`,
        )
        return { response, completedWhilePaused }
      }

      // Session A: own queued + running cancel, foreign cancel, shutdown.
      const aQueued = await cancelQueued(A, "a-cancel-q", aQ)
      const aRunning = await cancelRunning(A, "a-cancel-r", aR)
      const aForeign = await A.request(
        rpc("a-cancel-foreign", "job.cancel", { jobId: bR }),
      )
      const bRAfterForeign = jobRowOf(store.sqlite, bR)
      const aStopAt = performance.now()
      const aShutdown = await A.request(rpc("a-shutdown", "shutdown"))
      const aExit = await A.exit

      // Session B: the same with stdin EOF instead of shutdown.
      const bQueued = await cancelQueued(B, "b-cancel-q", bQ)
      const bRunning = await cancelRunning(B, "b-cancel-r", bR)
      const bForeign = await B.request(
        rpc("b-cancel-foreign", "job.cancel", { jobId: aR }),
      )
      const bStopAt = performance.now()
      B.end()
      const bExit = await B.exit

      const apiRow = jobRowOf(store.sqlite, apiJob.id)
      const sessionAIds = [aQ, aR]
      const sessionBIds = [bQ, bR]
      const pumpScopes = (seams.pumpCalls ?? []).map(admittedIdsOf)
      const queuedErrorNotifications = [
        ...A.notifications("job/error", aQ),
        ...B.notifications("job/error", bQ),
      ]
      const queuedStderr = `${A.stderr.text()}${B.stderr.text()}`
        .split("\n")
        .filter((line) => line.includes(aQ) || line.includes(bQ))

      // --- expect: queued cancel wins the claim without spawn ---------------
      for (const queued of [aQueued, bQueued]) {
        expect(queued.response.result?.job?.status).toBe(expected.queuedStatus)
        expect(queued.atCancel).toEqual({
          status: expected.queuedStatus,
          completed: expected.completedPerCanceledRun,
          started: 0,
        })
      }
      expect(latched.invocations.has(aQ) || latched.invocations.has(bQ)).toBe(
        false,
      )
      expect(queuedErrorNotifications).toEqual([])
      expect(queuedStderr).toEqual([])

      // --- expect: running cancel goes through the existing worker ----------
      for (const [running, jobId] of [
        [aRunning, aR],
        [bRunning, bR],
      ] as const) {
        expect(running.response.error).toBeUndefined()
        expect(running.completedWhilePaused).toBe(
          expected.completedWhileWorkerPaused,
        )
        expect({
          status: jobRowOf(store.sqlite, jobId).status,
          completed: countEvents(store.sqlite, jobId, "completed"),
        }).toEqual({
          status: expected.runningStatus,
          completed: expected.completedPerCanceledRun,
        })
      }

      // --- expect: cross-session and API jobs are untouched -----------------
      expect(aForeign.error?.code).toBe(expected.otherSessionCancelCode)
      expect(bForeign.error?.code).toBe(expected.otherSessionCancelCode)
      expect({
        status: bRAfterForeign.status,
        cancelRequestedAt: bRAfterForeign.cancel_requested_at,
      }).toEqual({
        status: "running",
        cancelRequestedAt: null,
      })
      expect({
        status: apiRow.status,
        startedAt: apiRow.started_at,
        cancelRequestedAt: apiRow.cancel_requested_at,
        completed: countEvents(store.sqlite, apiJob.id, "completed"),
        started: countEvents(store.sqlite, apiJob.id, "job_started"),
      }).toEqual({
        status: "queued",
        startedAt: null,
        cancelRequestedAt: null,
        completed: expected.unrelatedCompleted,
        started: 0,
      })
      expect(latched.invocations.has(apiJob.id)).toBe(false)
      expect(claims.attempted(apiJob.id)).toBe(false)

      // --- expect: shutdown / EOF stop within the existing bounds -----------
      expect(aShutdown.result).toEqual(expected.shutdownResult)
      expect(aExit.code).toBe(expected.sessionExitCode)
      expect(bExit.code).toBe(expected.sessionExitCode)
      expect(aExit.at - aStopAt).toBeLessThan(expected.stopBoundMs)
      expect(bExit.at - bStopAt).toBeLessThan(expected.stopBoundMs)

      // --- expect: each session pump is scoped to its own admitted IDs ------
      expect(seams.available.pumpQueuedRuns).toBe("function")
      expect(pumpScopes.length).toBeGreaterThan(0)
      expect(
        pumpScopes.every(
          (scope) =>
            scope !== null &&
            (scope.every((id) => sessionAIds.includes(id)) ||
              scope.every((id) => sessionBIds.includes(id))),
        ),
      ).toBe(true)
      expect(pumpScopes.some((scope) => scope?.includes(aR))).toBe(true)
      expect(pumpScopes.some((scope) => scope?.includes(bR))).toBe(true)
    },
    PROTOCOL_TEST_TIMEOUT_MS,
  )
})

// ---------------------------------------------------------------------------
// agent-protocol-interfaces: inherited S48-S51 (S47 registered existing)
// ---------------------------------------------------------------------------

describe("agent-protocol-interfaces / Minimal Jobs Stdio Boundary (inherited)", () => {
  // Modified-inherited addition. Enforces once run-submission.ts submitRun and
  // daemon.ts pumpQueuedRuns exist: the prompt turn goes through the shared
  // submit core and the session-scoped canonical pump.
  test(
    "S48 Protocol client sends prompt turn — a source=protocol job is created through submitRun and run by the session-scoped pumpQueuedRuns, job/event notifications equal the normalized committed events, and job.cancel maps to the shared cancelAgentJob path",
    async () => {
      const fixture = fixtureCase("stdio.json", "S48")
      const store = createRegisteredProjectDb()
      const input = withProjectCwd(fixture.input, store.projectCwd)
      const seams = await installRecordingSeams()
      const cancelSpy = spyOn(jobStore, "cancelAgentJob")
      const latched = createLatchedRunner()
      const session = startStdioSession({
        db: store.db,
        runner: latched.runner,
      })
      await session.request(rpc(1, "initialize"))
      const first: string = (
        await session.request(rpc("turn", "job.run", input.jobRunParams))
      ).result.job.id
      await waitFor(() => latched.invocations.has(first), "prompt turn worker")
      latched.release(first)
      await waitFor(
        () =>
          session
            .notifications("job/event", first)
            .some((n) => n.params.event.type === "completed"),
        "prompt turn completed notification",
      )
      const second: string = (
        await session.request(rpc("turn-2", "job.run", input.cancelParams))
      ).result.job.id
      await waitFor(
        () => latched.invocations.has(second),
        "second prompt turn worker",
      )
      const cancel = await session.request(
        rpc("cancel", "job.cancel", { jobId: second }),
      )
      await waitFor(
        () => latched.invocations.get(second)?.abortObserved,
        "worker observes cancel",
      )
      latched.releaseCancel(second)
      await waitFor(
        () => countEvents(store.sqlite, second, "completed") === 1,
        "canceled completed",
      )
      await session.request(rpc("shutdown", "shutdown"))
      const exit = await session.exit
      const notified = session
        .notifications("job/event", first)
        .map((n) => n.params.event)
      const normalized = jobStore
        .listAgentJobEvents(store.db, first)
        .map(serializeAgentJobEvent)
      const cancelCalls = cancelSpy.mock.calls.map((call) => call[1])
      const submitReturns = await seams.submitReturns()
      const pumpScopes = (seams.pumpCalls ?? []).map(admittedIdsOf)

      // living assertions
      expect(jobRowOf(store.sqlite, first)).toMatchObject({
        source: fixture.expected.source,
        status: fixture.expected.terminalStatus,
      })
      expect(notified.length).toBeGreaterThan(0)
      expect(notified).toEqual(JSON.parse(JSON.stringify(normalized)))
      expect(cancel.result?.job?.id).toBe(second)
      expect(cancelCalls).toContain(second)
      expect(jobRowOf(store.sqlite, second).status).toBe(
        fixture.expected.canceledStatus,
      )
      expect(exit.code).toBe(0)

      // modified-inherited: shared submit core + session-scoped canonical pump
      expect(seams.available).toEqual({
        submitRun: "function",
        waitForRun: "function",
        pumpQueuedRuns: "function",
      })
      expect(seams.submitCalls?.length).toBe(2)
      expect(
        containsString(submitReturns[0], first) &&
          containsString(submitReturns[1], second),
      ).toBe(true)
      expect(pumpScopes.length).toBeGreaterThan(0)
      expect(
        pumpScopes.every(
          (scope) =>
            scope?.every((id) => id === first || id === second) === true,
        ),
      ).toBe(true)
      expect(pumpScopes.some((scope) => scope?.includes(first))).toBe(true)
      expect(pumpScopes.some((scope) => scope?.includes(second))).toBe(true)
    },
    PROTOCOL_TEST_TIMEOUT_MS,
  )

  test(
    "S49 Protocol client initializes capabilities — initialize returns exactly locus-jobs-stdio.v1, serverInfo and the four minimal job capabilities, with no ACP, MCP, session-resume or runtime-parity claim (green-by-design characterization)",
    async () => {
      const fixture = fixtureCase("stdio.json", "S49")
      const store = createRegisteredProjectDb()
      const latched = createLatchedRunner()
      const session = startStdioSession({
        db: store.db,
        runner: latched.runner,
      })
      const initialize = await session.request(fixture.input.initialize)
      await session.request(rpc("shutdown", "shutdown"))
      const exit = await session.exit
      const serialized = JSON.stringify(initialize.result).toLowerCase()

      expect(initialize.result).toEqual(fixture.expected.result)
      expect(initialize.result.protocolVersion.toLowerCase()).not.toContain(
        "acp",
      )
      expect(
        fixture.expected.forbiddenClaims.filter((claim: string) =>
          serialized.includes(claim),
        ),
      ).toEqual([])
      expect(
        session.stdout.lines.every((line) => line?.jsonrpc === "2.0"),
      ).toBe(true)
      expect(exit.code).toBe(0)
    },
    PROTOCOL_TEST_TIMEOUT_MS,
  )

  test.each(["shutdown", "stdin-eof"] as const)(
    "S50 Protocol exits cleanly — %s stops accepting protocol jobs, cancels its own queued and running jobs without re-marking a terminal job, and writes only JSON-RPC to stdout (green-by-design characterization)",
    async (variant) => {
      const fixture = fixtureCase("stdio.json", "S50")
      const store = createRegisteredProjectDb()
      const input = withProjectCwd(fixture.input, store.projectCwd)
      const claims = installClaimLatch()
      const latched = createLatchedRunner()
      const session = startStdioSession({
        db: store.db,
        runner: latched.runner,
      })
      await session.request(rpc("init", "initialize"))
      const terminal: string = (
        await session.request(rpc("terminal", "job.run", input.terminal))
      ).result.job.id
      await waitFor(
        () => latched.invocations.has(terminal),
        "terminal job worker",
      )
      latched.release(terminal)
      await waitFor(
        () =>
          session
            .notifications("job/event", terminal)
            .some((n) => n.params.event.type === "completed"),
        "terminal job completed notification",
      )
      const running: string = (
        await session.request(rpc("running", "job.run", input.running))
      ).result.job.id
      await waitFor(
        () => latched.invocations.has(running),
        "running job worker",
      )
      const queued: string = (
        await session.request(rpc("queued", "job.run", input.queued))
      ).result.job.id
      const stopAt = performance.now()
      if (variant === "shutdown") {
        session.send(rpc("shutdown", "shutdown"))
        session.send(rpc("after", "job.run", input.afterStop))
        session.end()
      } else {
        session.end()
      }
      const exit = await session.exit
      // Settle the detached worker and the held claim before reading history.
      await waitFor(
        () => latched.invocations.get(running)?.abortObserved,
        "running worker observes stop",
      )
      latched.releaseCancel(running)
      await waitFor(
        () => countEvents(store.sqlite, running, "completed") === 1,
        "running job settles",
      )
      claims.release(queued)
      if (claims.attempted(queued)) {
        await await waitFor(
          () => claims.settlement(queued),
          "queued claim settlement",
        )
      }
      const afterStopJobs = store.sqlite
        .query("SELECT COUNT(*) AS n FROM agent_jobs WHERE prompt_preview = ?")
        .get(input.afterStop.prompt) as { n: number }

      expect(exit.code).toBe(fixture.expected.exitCode)
      expect(exit.at - stopAt).toBeLessThan(3_000)
      expect(
        session.stdout.lines.every((line) => line?.jsonrpc === "2.0"),
      ).toBe(true)
      if (variant === "shutdown") {
        expect(session.responseFor("shutdown")?.result).toEqual({ ok: true })
      }
      expect(session.responseFor("after")).toBeUndefined()
      expect(afterStopJobs.n).toBe(0)
      expect({
        status: jobRowOf(store.sqlite, terminal).status,
        completed: countEvents(store.sqlite, terminal, "completed"),
      }).toEqual({
        status: fixture.expected.terminalStatus,
        completed: fixture.expected.terminalCompleted,
      })
      expect({
        status: jobRowOf(store.sqlite, queued).status,
        completed: countEvents(store.sqlite, queued, "completed"),
        spawned: latched.invocations.has(queued),
      }).toEqual({ status: "canceled", completed: 1, spawned: false })
      expect(jobRowOf(store.sqlite, running).cancel_requested_by).toBe(
        "protocol",
      )
    },
    PROTOCOL_TEST_TIMEOUT_MS,
  )

  test("S51 Historical job rows keep the retired protocol string — a pre-ledger agent_jobs row recorded under locus-acp-stdio.v1 survives every migration byte-for-byte and reads back through a read-only store connection (green-by-design characterization)", async () => {
    const fixture = fixtureCase("stdio.json", "S51")
    const seed = fixture.seed
    const store = createRegisteredProjectDb({
      seedPreLedger(sqlite) {
        sqlite
          .query(
            "INSERT INTO agent_jobs (id, kind, source, runtime, status, mode, cwd, input_json, created_at, finished_at, exit_code) VALUES (?, 'agent', ?, 'codex', ?, 'agent', '/fixture/historical', ?, 1767225600, 1767225660, 0)",
          )
          .run(seed.jobId, seed.source, seed.status, seed.inputJson)
      },
    })
    const readOnly = new Database(store.file, { readonly: true })
    const readOnlyDb = drizzle(readOnly, {
      schema,
    }) as unknown as typeof store.db
    const job = jobStore.getAgentJob(readOnlyDb, seed.jobId)
    const listed = jobStore
      .listAgentJobs(readOnlyDb, { source: "protocol" })
      .map((row) => row.id)
    const serialized = job ? serializeAgentJob(job) : null
    readOnly.close()

    expect(job?.inputJson).toBe(seed.inputJson)
    expect(JSON.parse(job?.inputJson ?? "{}").protocol).toBe(
      fixture.expected.protocol,
    )
    expect(jobRowOf(store.sqlite, seed.jobId).input_json).toBe(seed.inputJson)
    expect(listed).toContain(seed.jobId)
    expect(serialized).toMatchObject({
      id: seed.jobId,
      source: "protocol",
      status: seed.status,
    })
  })
})

// ---------------------------------------------------------------------------
// architecture-ownership: S31 Schedule Uses Canonical Job Insertion
// ---------------------------------------------------------------------------

describe("architecture-ownership / Schedule Uses Canonical Job Insertion", () => {
  test("S31 Schedule creation retains one fire without bypassing creation facts — two connections evaluating the same scheduledFor fire one job/audit run and advance nextRunAt once with job_created from the host; a failed creation append leaves no acknowledged or claimable work and no idempotency rows (green-by-design characterization)", async () => {
    const fixture = fixtureCase("schedule.json", "S31")
    const now = new Date(fixture.evaluateAt)
    const createSchedule = (db: any, cwd: string) =>
      createAgentSchedule(db, {
        name: fixture.schedule.name,
        runtime: fixture.schedule.runtime,
        mode: fixture.schedule.mode,
        cwd,
        prompt: fixture.schedule.prompt,
        intervalSeconds: fixture.schedule.intervalSeconds,
        nextRunAt: new Date(fixture.schedule.nextRunAt),
        now: new Date(fixture.schedule.createdAt),
      })

    // successful race across two connections
    const store = createRegisteredProjectDb()
    const second = store.openSecondConnection()
    const schedule = createSchedule(store.db, store.projectCwd)
    const [firstFired, secondFired] = await Promise.all([
      evaluateDueAgentSchedules(store.db, { now }),
      evaluateDueAgentSchedules(second.db, { now }),
    ])
    const fired = [...firstFired, ...secondFired]
    const scheduleJobs = store.sqlite
      .query(
        "SELECT id, api_consumer_id FROM agent_jobs WHERE source = 'schedule'",
      )
      .all() as any[]
    const firedJobId = scheduleJobs[0]?.id as string
    const created = eventRows(store.sqlite, firedJobId).filter(
      (row) => row.type === "job_created",
    )
    const scheduleRow = store.sqlite
      .query("SELECT next_run_at FROM agent_schedules WHERE id = ?")
      .get(schedule.id) as { next_run_at: number }
    const queuedForSchedule = jobStore
      .listQueuedAgentJobsForSource(store.db, "schedule", 10)
      .map((job) => job.id)

    // failed post-transaction creation append
    const failing = createRegisteredProjectDb()
    const failingSchedule = createSchedule(failing.db, failing.projectCwd)
    failing.sqlite.exec(fixture.failedAppend.trigger)
    const failedFired = await settledResult(() =>
      evaluateDueAgentSchedules(failing.db, { now }),
    )
    const orphanIds = (
      failing.sqlite
        .query("SELECT id FROM agent_jobs WHERE source = 'schedule'")
        .all() as { id: string }[]
    ).map((row) => row.id)
    const orphanClaims = await Promise.all(
      orphanIds.map((jobId) =>
        settledResult(() =>
          jobStore.startAgentJob(failing.db, {
            jobId,
            workerId: "s31-claimant",
            workerPid: process.pid,
          }),
        ),
      ),
    )
    const failingQueued = jobStore.listQueuedAgentJobsForSource(
      failing.db,
      "schedule",
      10,
    )

    expect(fired).toHaveLength(fixture.expected.fires)
    expect(fired[0]?.job.id).toBe(firedJobId)
    expect(scheduleJobs).toHaveLength(fixture.expected.fires)
    expect(listAgentScheduleRuns(store.db, schedule.id)).toHaveLength(
      fixture.expected.auditRuns,
    )
    expect(
      listAgentScheduleRuns(
        store.db,
        schedule.id,
      )[0]?.scheduledFor?.toISOString(),
    ).toBe(fixture.expected.scheduledFor)
    expect(new Date(scheduleRow.next_run_at * 1000).toISOString()).toBe(
      fixture.expected.nextRunAt,
    )
    expect(
      created.map((row) => ({
        sequence: row.sequence,
        prefixed: String(row.fact_key).startsWith(
          `${fixture.expected.jobCreatedFactKeyPrefix}${firedJobId}`,
        ),
      })),
    ).toEqual([{ sequence: 1, prefixed: true }])
    expect(queuedForSchedule).toEqual([firedJobId])
    expect(scheduleJobs[0]?.api_consumer_id).toBeNull()
    expect(
      Object.values(idempotencyTableRowCounts(store.sqlite)).filter(
        (n) => n > 0,
      ),
    ).toEqual([])

    expect(
      failedFired.fulfilled ? (failedFired.value as unknown[]).length : 0,
    ).toBe(0)
    expect(failingQueued).toEqual([])
    expect(orphanClaims.every((claim) => claim.fulfilled === false)).toBe(true)
    expect(
      orphanIds.map((jobId) => ({
        status: jobRowOf(failing.sqlite, jobId).status,
        created: countEvents(failing.sqlite, jobId, "job_created"),
        started: countEvents(failing.sqlite, jobId, "job_started"),
      })),
    ).toEqual(
      orphanIds.map(() => ({ status: "queued", created: 0, started: 0 })),
    )
    expect(
      listAgentScheduleRuns(failing.db, failingSchedule.id).length,
    ).toBeLessThanOrEqual(1)
    expect(
      Object.values(idempotencyTableRowCounts(failing.sqlite)).filter(
        (n) => n > 0,
      ),
    ).toEqual([])
  })

  test("S31 Schedule creation retains one fire without bypassing creation facts — schedules.ts constructs no agent_jobs row itself (createScheduleJobRecord's insert(agentJobs) is replaced by the job-store insertion primitive) and still records job_created through recordAgentJobCreated", () => {
    const path = "src/main/lib/headless/schedules.ts"
    const content = readRepoFile(path)
    const source = ts.createSourceFile(
      path,
      content,
      ts.ScriptTarget.Latest,
      true,
    )
    const agentJobsAliases = new Set<string>()
    const importedFromJobStore = new Set<string>()
    for (const statement of source.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings)
      ) {
        const specifier = (statement.moduleSpecifier as ts.StringLiteral).text
        for (const element of statement.importClause.namedBindings.elements) {
          const imported = (element.propertyName ?? element.name).text
          if (imported === "agentJobs") agentJobsAliases.add(element.name.text)
          if (specifier === "./job-store") importedFromJobStore.add(imported)
        }
      }
    }
    const directInserts: string[] = []
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "insert" &&
        node.arguments[0] &&
        ts.isIdentifier(node.arguments[0]) &&
        agentJobsAliases.has(node.arguments[0].text)
      ) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart())
        directInserts.push(`${path}:${line + 1}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)

    expect(directInserts).toEqual([])
    expect(importedFromJobStore.has("recordAgentJobCreated")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// architecture-ownership: S32 / S33 Single Async Submission And Wait Ownership
// ---------------------------------------------------------------------------

describe("architecture-ownership / Single Async Submission And Wait Ownership", () => {
  // Enforces once the guard has an async-submission section reading
  // --local-job-api-async-fixtures= (frozen flag/summary wording).
  test(
    "S32 Guard rejects an inline API execution fallback — the guard self-test matches every S32 case exactly: the clean wrapper/stdio pump fixture (human locus run permitted) passes and each inline-runner, restored runPreparedLocalJobApiJob and independent stdio dispatch variant reports its file, symbol and daemon/run-submission owner",
    () => {
      const fixture = loadFixture("architecture-fixtures.json")
      const subset = fixtureSubset(fixture, "S32")
      const table = fixtureFindingTable(fixture, "S32")
      const run = runArchitectureGuard([
        `${ASYNC_GUARD_FIXTURE_FLAG}${writeTempFixture(subset)}`,
      ])
      const total = subset.cases.length

      expect(table).toEqual(pinnedTable("s32-"))
      expect(run.output).toContain(
        `${ASYNC_GUARD_LABEL}: ${total}/${total} fixture cases matched`,
      )
      expect(run.output).not.toContain(`${ASYNC_GUARD_LABEL} case `)
      expect(run.status).toBe(0)
      expect(run.output).toContain("Architecture guard passed.")
    },
    GUARD_TIMEOUT_MS,
  )

  test(
    "S32 Guard rejects an inline API execution fallback — the guard self-test fails by case id when a required inline-runner finding is missing from a variant or an unexpected one is demanded of the clean fixture",
    () => {
      const fixture = loadFixture("architecture-fixtures.json")
      const subset = fixtureSubset(fixture, "S32")
      const total = subset.cases.length
      const variant = subset.cases.find(
        (entry: any) => entry.caseId === "s32-create-inline-agent-runner",
      )
      const clean = subset.cases.find(
        (entry: any) => entry.caseId === "s32-clean-envelope-adapters",
      )
      const dropped = variant.expectedFindings[0]
      variant.expectedFindings = []
      clean.expectedFindings = [
        {
          rule: "retired-symbol",
          file: `${H}/cli-dispatcher.ts`,
          symbol: "runPreparedLocalJobApiJob",
          owner: `${H}/run-submission.ts`,
          ownerSection: fixture.ownerSection,
        },
      ]
      const run = runArchitectureGuard([
        `${ASYNC_GUARD_FIXTURE_FLAG}${writeTempFixture(subset)}`,
      ])

      expect(dropped.rule).toBe("inline-runner-call")
      expect(run.status).toBe(1)
      expect(run.output).not.toContain("Architecture guard passed.")
      expect(run.output).toContain(
        `${ASYNC_GUARD_LABEL}: ${total - 2}/${total} fixture cases matched`,
      )
      expect(run.output).toContain(
        `${ASYNC_GUARD_LABEL} case s32-create-inline-agent-runner (inline-runner) missed nothing and produced unexpected`,
      )
      expect(run.output).toContain('"inline-runner-call"')
      expect(run.output).toContain(
        `${ASYNC_GUARD_LABEL} case s32-clean-envelope-adapters (clean) missed`,
      )
      expect(run.output).toContain('"runPreparedLocalJobApiJob"')
      expect(run.output).toContain("and produced unexpected nothing")
      expect(
        run.output.match(new RegExp(`${ASYNC_GUARD_LABEL} case `, "g")),
      ).toHaveLength(2)
    },
    GUARD_TIMEOUT_MS,
  )

  test(
    "S32 Guard rejects an inline API execution fallback — the default architecture check self-tests the canonical async fixture and enforces the repository end state (run-submission.ts owns submitRun/waitForRun, daemon.ts owns pumpQueuedRuns, runPreparedLocalJobApiJob and adapter runner calls are gone)",
    () => {
      const fixture = loadFixture("architecture-fixtures.json")
      const total = fixture.cases.length
      const run = runArchitectureGuard()

      expect(run.output).toContain(
        `${ASYNC_GUARD_LABEL}: ${total}/${total} fixture cases matched; repository ownership enforced.`,
      )
      expect(run.status).toBe(0)
      expect(run.output).toContain("Architecture guard passed.")
    },
    GUARD_TIMEOUT_MS,
  )

  test(
    "S33 Guard rejects duplicate creation and ledger writers — the guard self-test matches every S33 case exactly: duplicated submitRun/waitForRun/pumpQueuedRuns, direct agent_jobs inserts in API/stdio/schedule adapters and an appendExactRunEventBatch import outside the host are rejected with their owner, the schedule shared-insertion fixture passes, and no migration toggle can revive the old core or the retired ledger gate",
    () => {
      const fixture = loadFixture("architecture-fixtures.json")
      const subset = fixtureSubset(fixture, "S33")
      const table = fixtureFindingTable(fixture, "S33")
      const run = runArchitectureGuard([
        `${ASYNC_GUARD_FIXTURE_FLAG}${writeTempFixture(subset)}`,
      ])
      const total = subset.cases.length

      expect(table).toEqual(pinnedTable("s33-"))
      expect(run.output).toContain(
        `${ASYNC_GUARD_LABEL}: ${total}/${total} fixture cases matched`,
      )
      expect(run.output).not.toContain(`${ASYNC_GUARD_LABEL} case `)
      expect(run.status).toBe(0)
      expect(run.output).toContain("Architecture guard passed.")
    },
    GUARD_TIMEOUT_MS,
  )
})
