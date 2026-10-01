/** biome-ignore-all lint/suspicious/noExplicitAny: the async-submit/idempotency contract under test does not exist yet; envelopes and rows are asserted structurally. */
/**
 * Independent red suite for `openspec/changes/add-local-job-api-async-submit`,
 * idempotency domain: S08-S15, S19 and the inherited discovery scenario S53
 * (S52/S54 are registered against existing tests, see the report).
 *
 * Every test drives the product through baseline entry points (in-process
 * CLI, job-store lifecycle exports, daemon). On the baseline the new
 * surfaces fail inside each test: `runs submit` is an unknown subcommand,
 * `runs retry --request` is an unexpected argument and keyed `runs create`
 * silently executes. Observations are collected first and compared with one
 * structural oracle per test, so the diff shows every gap at once.
 */
import { afterEach, describe, expect, setSystemTime, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { runLocalAgentDaemon } from "../src/main/lib/headless/daemon"
import {
  getAgentJob,
  recordAgentJobCreated,
  startAgentJob,
} from "../src/main/lib/headless/job-store"
import {
  apiJobs,
  type CliResult,
  cli,
  create,
  createProfile,
  daemonOnce,
  dropTrigger,
  envelopeSummary,
  eventCount,
  filesContaining,
  findReservationTable,
  holdCreationBoundary,
  installTrigger,
  jobById,
  jobByPrompt,
  jobEvents,
  loadIdempotencyFixture,
  materialize,
  type Profile,
  parseSingleJsonLine,
  preflightThenDispatch,
  reservationExpiryMs,
  reservationForJob,
  reservationRows,
  retryWithRequest,
  runCliChild,
  runDirNames,
  seedProviderProfile,
  sha256Base64,
  sha256Hex,
  snapshotFiles,
  spawnCliChild,
  sqliteFilesContain,
  submit,
  withKey,
} from "./local-job-api-async-idempotency-kit"
import { exitedPid } from "./run-event-ledger-domain-b-kit"

const IDEMPOTENCY = loadIdempotencyFixture("idempotency.json")
const CONTROLS = loadIdempotencyFixture("controls.json")
const DISCOVERY = loadIdempotencyFixture("discovery.json")

const SUBMIT_ARGV = ["api", "runs", "submit", "--request", "-", "--json"]
const EVENTS_INSERT = 'insert\\s+into\\s+["`]?agent_job_events'

const openProfiles: Profile[] = []
function track(profile: Profile): Profile {
  openProfiles.push(profile)
  return profile
}

afterEach(() => {
  setSystemTime()
  for (const profile of openProfiles.splice(0)) profile.close()
})

function idOf(result: Pick<CliResult, "json">): string | null {
  return typeof result.json?.job?.id === "string" ? result.json.job.id : null
}

function counts(profile: Profile) {
  return {
    jobs: apiJobs(profile.m.sqlite).length,
    events: eventCount(profile.m.sqlite),
    reservations: reservationRows(profile.m.sqlite).length,
    runnerCalls: profile.runner.calls.length,
  }
}

function delta(
  before: ReturnType<typeof counts>,
  after: ReturnType<typeof counts>,
) {
  return {
    jobs: after.jobs - before.jobs,
    events: after.events - before.events,
    reservations: after.reservations - before.reservations,
    runnerCalls: after.runnerCalls - before.runnerCalls,
  }
}

const NO_GROWTH = { jobs: 0, events: 0, reservations: 0, runnerCalls: 0 }
const FRESH_KEYS = ["apiVersion", "job"]
const REPLAY_KEYS = ["apiVersion", "idempotentReplay", "job"]
const ERROR_KEYS = ["apiVersion", "error"]

const FRESH_QUEUED_ACK = {
  exit: 0,
  envelopeKeys: FRESH_KEYS,
  status: "queued",
  idempotentReplay: null,
  errorCode: null,
  retryable: null,
  hasJob: true,
  hasResult: false,
}

const SUBMISSION_PENDING = {
  exit: 8,
  envelopeKeys: ERROR_KEYS,
  status: null,
  idempotentReplay: null,
  errorCode: "submission_pending",
  retryable: true,
  hasJob: false,
  hasResult: false,
}

function replayOf(status: string) {
  return {
    exit: 0,
    envelopeKeys: REPLAY_KEYS,
    status,
    idempotentReplay: true,
    errorCode: null,
    retryable: null,
    hasJob: true,
    hasResult: false,
  }
}

describe("local-job-api / Consumer Scoped Idempotent Submission", () => {
  // Enforces once `runs submit` / `runs retry --request` exist: keyed replay on
  // the two supported surfaces. The keyed-create clause is a real gap today:
  // create silently drops idempotencyKey and executes an unkeyed job.
  test("S08 Normalized replay stays on supported key surfaces — submit and retry --request replay their own retained attempt with idempotentReplay=true and no new jobs/events/runner calls, while keyed create is refused with stdout idempotency_key_not_supported/2 and unkeyed create stays fresh", async () => {
    const fx = IDEMPOTENCY.cases.S08
    const p = track(createProfile())
    const base = materialize(fx.submit, p.values)

    const first = await submit(p, withKey(base, fx.key))
    const firstId = idOf(first)
    const publish = await daemonOnce(p)

    p.runner.mode = "fail"
    const source = await create(p, materialize(fx.retrySource, p.values))
    const sourceId = idOf(source) ?? "missing-retry-source"
    p.runner.mode = "succeed"
    const retryFresh = await retryWithRequest(
      p,
      sourceId,
      fx.retryRequest,
      "async",
    )
    const childId = idOf(retryFresh)
    await daemonOnce(p)

    const baseline = counts(p)
    const submitReplays: Record<string, unknown> = {}
    for (const [name, variant] of Object.entries(fx.equivalentVariants)) {
      const replay = await submit(
        p,
        withKey(materialize(variant, p.values), fx.key),
      )
      submitReplays[name] = {
        ...envelopeSummary(replay),
        sameAttempt: firstId !== null && idOf(replay) === firstId,
      }
    }
    seedProviderProfile(p, fx.providerConfigChange)
    const afterConfigChange = await submit(p, withKey(base, fx.key))
    const retryAsyncReplay = await retryWithRequest(
      p,
      sourceId,
      fx.retryRequest,
      "async",
    )
    const retrySyncReplay = await retryWithRequest(
      p,
      sourceId,
      fx.retryRequest,
      "sync",
    )
    const growthAfterReplays = delta(baseline, counts(p))

    const beforeKeyedCreate = counts(p)
    const keyedCreate = await create(p, withKey(base, "create-key-1"))
    const keyedCreateDelta = delta(beforeKeyedCreate, counts(p))
    const unkeyedCreate = await create(p, base)

    const replay = { ...replayOf("succeeded"), sameAttempt: true }
    expect({
      firstSubmit: envelopeSummary(first),
      published: {
        daemonExit: publish.code,
        status: jobById(p.m.sqlite, firstId)?.status ?? null,
        runnerCallsForAttempt: firstId ? p.runner.callsFor(firstId) : 0,
      },
      retryFresh: {
        ...envelopeSummary(retryFresh),
        retryOfSource: retryFresh.json?.job?.retryOfJobId === sourceId,
      },
      submitReplays,
      afterConfigChange: {
        ...envelopeSummary(afterConfigChange),
        sameAttempt: firstId !== null && idOf(afterConfigChange) === firstId,
      },
      retryAsyncReplay: {
        ...envelopeSummary(retryAsyncReplay),
        sameChild: childId !== null && idOf(retryAsyncReplay) === childId,
      },
      retrySyncReplay: {
        exit: retrySyncReplay.code,
        sameChild: childId !== null && idOf(retrySyncReplay) === childId,
        resultStatus: retrySyncReplay.json?.result?.status ?? null,
      },
      growthAfterReplays,
      keyedCreate: {
        exit: keyedCreate.code,
        stdoutLines: keyedCreate.lines.length,
        apiVersion: keyedCreate.json?.apiVersion ?? null,
        errorCode: keyedCreate.json?.error?.code ?? null,
        hasJob: Boolean(keyedCreate.json?.job),
        jobs: keyedCreateDelta.jobs,
        runnerCalls: keyedCreateDelta.runnerCalls,
      },
      unkeyedCreate: {
        ...envelopeSummary(unkeyedCreate),
        freshAttempt:
          idOf(unkeyedCreate) !== null && idOf(unkeyedCreate) !== firstId,
      },
    }).toEqual({
      firstSubmit: FRESH_QUEUED_ACK,
      published: {
        daemonExit: 0,
        status: "succeeded",
        runnerCallsForAttempt: 1,
      },
      retryFresh: { ...FRESH_QUEUED_ACK, retryOfSource: true },
      submitReplays: Object.fromEntries(
        Object.keys(fx.equivalentVariants).map((name) => [name, replay]),
      ),
      afterConfigChange: replay,
      retryAsyncReplay: { ...replayOf("succeeded"), sameChild: true },
      retrySyncReplay: { exit: 0, sameChild: true, resultStatus: "succeeded" },
      growthAfterReplays: NO_GROWTH,
      keyedCreate: {
        exit: fx.expected.keyedCreate.exit,
        stdoutLines: 1,
        apiVersion: "locus.local-job.v1",
        errorCode: fx.expected.keyedCreate.errorCode,
        hasJob: false,
        jobs: 0,
        runnerCalls: 0,
      },
      unkeyedCreate: {
        exit: 0,
        envelopeKeys: fx.expected.unkeyedCreateEnvelopeKeys,
        status: "succeeded",
        idempotentReplay: null,
        errorCode: null,
        retryable: null,
        hasJob: true,
        hasResult: true,
        freshAttempt: true,
      },
    })
  }, 60_000)

  // Enforces once `runs submit` exists: semantic conflict on the same scoped key.
  test("S09 Changed request conflicts without exposing the key — prompt/mode/provider/artifact-base/external-ID and completion messages/schema variants each exit 2 with stdout idempotency_conflict, add no job/event/runner call and echo neither the key nor stored request content", async () => {
    const fx = IDEMPOTENCY.cases.S09
    const p = track(createProfile())
    seedProviderProfile(p, fx.completionProviderProfile)
    // The changed artifact base exists, so only the reservation can refuse it.
    mkdirSync(p.otherArtifactBase, { recursive: true })
    const agentBinding = materialize(fx.agentBinding, p.values)
    const completionBinding = materialize(fx.completionBinding, p.values)

    const bindings = {
      agent: envelopeSummary(
        await submit(p, withKey(agentBinding, fx.agentKey)),
      ),
      completion: envelopeSummary(
        await submit(p, withKey(completionBinding, fx.completionKey)),
      ),
    }

    const probe = async (request: unknown, key: string) => {
      const before = counts(p)
      const result = await submit(p, withKey(request, key))
      const output = result.stdout + result.stderr
      return {
        exit: result.code,
        stdoutLines: result.lines.length,
        apiVersion: result.json?.apiVersion ?? null,
        errorCode: result.json?.error?.code ?? null,
        hasJob: Boolean(result.json?.job),
        delta: delta(before, counts(p)),
        keyEchoed: output.includes(key),
        storedContentEchoed: (fx.storedContentSentinels as string[]).filter(
          (sentinel) => output.includes(sentinel),
        ),
      }
    }
    const variants: Record<string, unknown> = {}
    for (const [name, change] of Object.entries(fx.agentVariants)) {
      variants[`agent:${name}`] = await probe(
        { ...agentBinding, ...materialize(change as object, p.values) },
        fx.agentKey,
      )
    }
    for (const [name, change] of Object.entries(fx.completionVariants)) {
      variants[`completion:${name}`] = await probe(
        { ...completionBinding, ...(change as object) },
        fx.completionKey,
      )
    }

    const conflict = {
      exit: fx.expected.exit,
      stdoutLines: 1,
      apiVersion: "locus.local-job.v1",
      errorCode: fx.expected.errorCode,
      hasJob: false,
      delta: NO_GROWTH,
      keyEchoed: false,
      storedContentEchoed: [],
    }
    expect({ bindings, variants }).toEqual({
      bindings: { agent: FRESH_QUEUED_ACK, completion: FRESH_QUEUED_ACK },
      variants: Object.fromEntries(
        Object.keys(variants).map((name) => [name, conflict]),
      ),
    })
  }, 60_000)

  // Enforces once `runs submit` exists: the namespace is consumer.id + key.
  test("S10 Same key cannot replay across consumers — fixture-a and fixture-b with key req-1 get distinct jobs and reservations with one creation fact each, and repeating fixture-b returns only fixture-b's ID", async () => {
    const fx = IDEMPOTENCY.cases.S10
    const p = track(createProfile())
    const requestA = withKey(materialize(fx.requestA, p.values), fx.key)
    const requestB = withKey(materialize(fx.requestB, p.values), fx.key)
    const a = await submit(p, requestA)
    const b = await submit(p, requestB)
    const bAgain = await submit(p, requestB)
    const aId = idOf(a)
    const bId = idOf(b)

    expect({
      a: envelopeSummary(a),
      b: envelopeSummary(b),
      distinctIds: aId !== null && bId !== null && aId !== bId,
      storedConsumers: [aId, bId].map(
        (id) => jobById(p.m.sqlite, id)?.api_consumer_id ?? null,
      ),
      creationFacts: [aId, bId].map((id) =>
        id ? eventCount(p.m.sqlite, { jobId: id, type: "job_created" }) : 0,
      ),
      reservations: reservationRows(p.m.sqlite).length,
      reservedJobs: [aId, bId].map((id) =>
        id ? reservationForJob(p.m.sqlite, id) !== null : false,
      ),
      bAgain: {
        ...envelopeSummary(bAgain),
        isB: bId !== null && idOf(bAgain) === bId,
        isA: aId !== null && idOf(bAgain) === aId,
      },
      pausedExecutor: {
        claims: eventCount(p.m.sqlite, { type: "job_started" }),
        runnerCalls: p.runner.calls.length,
      },
    }).toEqual({
      a: FRESH_QUEUED_ACK,
      b: FRESH_QUEUED_ACK,
      distinctIds: true,
      storedConsumers: ["fixture-a", "fixture-b"],
      creationFacts: [1, 1],
      reservations: 2,
      reservedJobs: [true, true],
      bAgain: { ...replayOf("queued"), isB: true, isA: false },
      pausedExecutor: { claims: 0, runnerCalls: 0 },
    })
  }, 60_000)

  // Enforces once `runs submit` and the unique (consumer,keyHash) reservation
  // exist. The creation latch is emulated with SQLite triggers (no seam yet).
  test("S11 Concurrent requests reserve one attempt — three real processes race one consumer/key (two matching, one changed) leaving one job, one reservation and one run-dir, and a held creation latch yields pending/8 then replay with zero claims until the executor runs exactly once", async () => {
    const fx = IDEMPOTENCY.cases.S11
    const p = track(createProfile())

    // Phase A: real processes on independent connections, released together.
    const go = join(p.scratch, "race.go")
    const contenders = [
      { name: "matching-1", request: materialize(fx.matching, p.values) },
      { name: "matching-2", request: materialize(fx.matching, p.values) },
      { name: "different", request: materialize(fx.different, p.values) },
    ].map((contender) => {
      const ready = join(p.scratch, `${contender.name}.ready`)
      const handle = spawnCliChild(
        {
          dbFile: p.m.file,
          argv: SUBMIT_ARGV,
          stdinText: JSON.stringify(withKey(contender.request, fx.raceKey)),
          readyFile: ready,
          goFile: go,
          resultFile: join(p.scratch, `${contender.name}.result.json`),
        },
        p.scratch,
      )
      return { ...contender, ready, handle }
    })
    const readyDeadline = performance.now() + 30_000
    while (
      contenders.some((contender) => Bun.file(contender.ready).size === 0) &&
      performance.now() < readyDeadline
    ) {
      await Bun.sleep(5)
    }
    writeFileSync(go, "go")
    const outcomes = await Promise.all(
      contenders.map((contender) => contender.handle.done()),
    )
    const responses = await Promise.all(
      outcomes.map(async (outcome, index) => ({
        request: contenders[index].request,
        code: outcome.result?.code ?? null,
        json: outcome.result
          ? await parseSingleJsonLine(outcome.result.stdout)
          : null,
      })),
    )

    const racePrompts = [fx.matching.prompt.text, fx.different.prompt.text]
    const raceJobs = apiJobs(p.m.sqlite, "fixture-a").filter((job) =>
      racePrompts.includes(job.prompt_preview),
    )
    const winner = raceJobs[0] ?? null
    const consistency = responses.map(({ request, code, json }) => {
      if (!winner) return "no-winner"
      if (request.prompt.text !== winner.prompt_preview) {
        return code === 2 && json?.error?.code === "idempotency_conflict"
          ? "ok"
          : "changed-request-did-not-conflict"
      }
      if (code === 0 && json?.job?.id === winner.id) return "ok"
      if (
        code === 8 &&
        json?.error?.code === "submission_pending" &&
        json?.error?.retryable === true
      ) {
        return "ok"
      }
      return "matching-request-not-fresh-replay-or-pending"
    })
    const freshResponses = responses.filter(
      ({ code, json }) =>
        code === 0 && json?.job && json?.idempotentReplay !== true,
    ).length
    const independent = p.m.openSecondConnection().sqlite
    const info = findReservationTable(independent)
    const danglingReservations = info?.jobColumn
      ? (
          independent
            .query(
              `SELECT count(*) AS n FROM "${info.table}" r LEFT JOIN agent_jobs j ON j.id = r."${info.jobColumn}" WHERE j.id IS NULL`,
            )
            .get() as { n: number }
        ).n
      : "no-reservation-table"
    const race = {
      jobs: raceJobs.length,
      reservations: reservationRows(independent).length,
      runDirsAreTheWinner:
        winner !== null &&
        JSON.stringify(runDirNames(p.artifactBase)) ===
          JSON.stringify([winner.id]),
      freshResponses,
      consistency,
      danglingReservations,
      claimsWhilePaused: eventCount(p.m.sqlite, { type: "job_started" }),
      runnerCallsWhilePaused: p.runner.calls.length,
    }

    // Phase B: creation latch held after the job+reservation commit.
    const latchRequest = withKey(
      materialize(fx.latchMatching, p.values),
      fx.latchKey,
    )
    const release = holdCreationBoundary(p.m.sqlite)
    const creator = await submit(p, latchRequest)
    release()
    const latchJob = jobByPrompt(p.m.sqlite, fx.latchMatching.prompt.text)
    const pendingMatching = await submit(p, latchRequest)
    const changedWhilePending = await submit(
      p,
      withKey(materialize(fx.latchDifferent, p.values), fx.latchKey),
    )
    const pausedDaemon = await daemonOnce(p)
    const claimsWhileLatched = latchJob
      ? eventCount(p.m.sqlite, { jobId: latchJob.id, type: "job_started" })
      : "no-latch-job"
    const job = latchJob ? getAgentJob(p.m.db, latchJob.id) : null
    if (job) {
      await recordAgentJobCreated(p.m.db, job, {
        kind: job.kind,
        source: job.source,
        runtime: job.runtime,
        mode: job.mode,
        cwd: job.cwd,
      })
    }
    const replayAfterAdmission = await submit(p, latchRequest)
    await daemonOnce(p)

    expect({
      race: {
        ...race,
        winnerExecutions: winner ? p.runner.callsFor(winner.id) : 0,
      },
      latch: {
        creatorAcked: Boolean(creator.json?.job),
        latchJobCommitted: latchJob !== null,
        pendingMatching: envelopeSummary(pendingMatching),
        changedWhilePending: envelopeSummary(changedWhilePending),
        pausedDaemonExit: pausedDaemon.code,
        claimsWhileLatched,
        replayAfterAdmission: {
          ...envelopeSummary(replayAfterAdmission),
          sameJob:
            latchJob !== null && idOf(replayAfterAdmission) === latchJob.id,
        },
        executions: latchJob ? p.runner.callsFor(latchJob.id) : 0,
        claims: latchJob
          ? eventCount(p.m.sqlite, { jobId: latchJob.id, type: "job_started" })
          : 0,
      },
    }).toEqual({
      race: {
        jobs: 1,
        reservations: 1,
        runDirsAreTheWinner: true,
        freshResponses: 1,
        consistency: ["ok", "ok", "ok"],
        danglingReservations: 0,
        claimsWhilePaused: 0,
        runnerCallsWhilePaused: 0,
        winnerExecutions: 1,
      },
      latch: {
        creatorAcked: false,
        latchJobCommitted: true,
        pendingMatching: SUBMISSION_PENDING,
        changedWhilePending: {
          exit: 2,
          envelopeKeys: ERROR_KEYS,
          status: null,
          idempotentReplay: null,
          errorCode: "idempotency_conflict",
          retryable: null,
          hasJob: false,
          hasResult: false,
        },
        pausedDaemonExit: 0,
        claimsWhileLatched: 0,
        replayAfterAdmission: { ...replayOf("queued"), sameJob: true },
        executions: 1,
        claims: 1,
      },
    })
  }, 90_000)

  // Enforces once `runs submit` and the reservation table exist: job+key in one
  // SQLite transaction; creation compensation releases both; winner-only mkdir.
  test("S12 Rollback and creation compensation release the key — reservation/job insert faults before commit and a job_created append fault after commit leave zero rows, no ack and no run-dir, and the same key then yields one fresh admitted job without idempotentReplay", async () => {
    const fx = IDEMPOTENCY.cases.S12
    const observed: Record<string, unknown> = {}
    for (const fault of fx.faults as { id: string }[]) {
      const p = track(createProfile())
      const request = withKey(materialize(fx.request, p.values), fx.key)
      const info = findReservationTable(p.m.sqlite)
      let triggerInstalled = true
      if (fault.id === "reservation-insert-before-commit") {
        if (info) {
          installTrigger(
            p.m.sqlite,
            "idem_fault",
            `AFTER INSERT ON "${info.table}" BEGIN SELECT RAISE(ABORT, 'fixture fault: reservation insert'); END`,
          )
        } else {
          triggerInstalled = false
        }
      } else if (fault.id === "job-insert-before-commit") {
        installTrigger(
          p.m.sqlite,
          "idem_fault",
          "AFTER INSERT ON agent_jobs WHEN NEW.source = 'api' BEGIN SELECT RAISE(ABORT, 'fixture fault: job insert'); END",
        )
      } else {
        installTrigger(
          p.m.sqlite,
          "idem_fault",
          "BEFORE INSERT ON agent_job_events WHEN NEW.type = 'job_created' BEGIN SELECT RAISE(ABORT, 'fixture fault: creation append'); END",
        )
      }
      const failed = await submit(p, request)
      const independent = p.m.openSecondConnection().sqlite
      const afterFault = {
        jobs: apiJobs(independent).length,
        reservations: reservationRows(independent).length,
        events: eventCount(independent),
        runDirs: runDirNames(p.artifactBase).length,
      }
      dropTrigger(p.m.sqlite, "idem_fault")
      const retried = await submit(p, request)
      const retriedId = idOf(retried)
      observed[fault.id] = {
        triggerInstalled,
        failedAcked: Boolean(failed.json?.job),
        failedExit: failed.code === 0 ? "zero" : "nonzero",
        afterFault,
        retry: {
          ...envelopeSummary(retried),
          jobs: apiJobs(p.m.sqlite).length,
          creationFacts: retriedId
            ? eventCount(p.m.sqlite, { jobId: retriedId, type: "job_created" })
            : 0,
          runDirIsTheJob:
            retriedId !== null &&
            JSON.stringify(runDirNames(p.artifactBase)) ===
              JSON.stringify([retriedId]),
        },
      }
    }
    const expected = {
      triggerInstalled: true,
      failedAcked: false,
      failedExit: "nonzero",
      afterFault: { jobs: 0, reservations: 0, events: 0, runDirs: 0 },
      retry: {
        ...FRESH_QUEUED_ACK,
        jobs: 1,
        creationFacts: 1,
        runDirIsTheJob: true,
      },
    }
    expect(observed).toEqual(
      Object.fromEntries(
        (fx.faults as { id: string }[]).map((fault) => [fault.id, expected]),
      ),
    )
  }, 60_000)

  // Enforces once `runs submit` exists: an orphan (job+reservation committed,
  // creation not committed) is pending/8+retryable, never replayed, claimed
  // or expired.
  test("S13 Crashed creation never becomes a successful replay — killed, failed-compensation and paused-live creators stay submission_pending/8 retryable with zero claims and retained reservations past 30 days, the released live creator replays its one ID and a new key succeeds beside the orphan", async () => {
    const fx = IDEMPOTENCY.cases.S13
    const T0 = Date.parse("2026-10-02T00:00:00.000Z")
    setSystemTime(new Date(T0))
    const p = track(createProfile())
    const requestFor = (prompt: string) =>
      materialize(fx.requestTemplate, { ...p.values, PROMPT: prompt })
    const cases = fx.cases as Record<
      string,
      { key: string; prompt: string; newKey?: string }
    >

    const killedChild = await runCliChild(
      {
        dbFile: p.m.file,
        argv: SUBMIT_ARGV,
        stdinText: JSON.stringify(
          withKey(requestFor(cases.killed.prompt), cases.killed.key),
        ),
        kill: { pattern: EVENTS_INSERT, nth: 1 },
        resultFile: join(p.scratch, "s13-killed.result.json"),
      },
      p.scratch,
    )
    for (const name of ["failedCompensation", "liveCreator"]) {
      const release = holdCreationBoundary(p.m.sqlite)
      await submit(p, withKey(requestFor(cases[name].prompt), cases[name].key))
      release()
    }
    const orphanIds = Object.fromEntries(
      Object.entries(cases).map(([name, c]) => [
        name,
        jobByPrompt(p.m.sqlite, c.prompt)?.id ?? null,
      ]),
    ) as Record<string, string | null>
    const orphanState = Object.fromEntries(
      Object.entries(orphanIds).map(([name, id]) => [
        name,
        {
          jobRow: id !== null,
          creationFacts: id
            ? eventCount(p.m.sqlite, { jobId: id, type: "job_created" })
            : "no-job",
          reserved: id ? reservationForJob(p.m.sqlite, id) !== null : false,
        },
      ]),
    )

    const repeats: Record<string, unknown> = {}
    for (const [name, c] of Object.entries(cases)) {
      repeats[name] = envelopeSummary(
        await submit(p, withKey(requestFor(c.prompt), c.key)),
      )
    }
    await daemonOnce(p)
    setSystemTime(new Date(T0 + fx.advanceMs))
    await submit(
      p,
      withKey(requestFor("S13 cleanup trigger"), fx.cleanupTriggerKey),
    )
    await daemonOnce(p)
    const afterCleanup = Object.fromEntries(
      Object.entries(orphanIds).map(([name, id]) => [
        name,
        {
          reserved: id ? reservationForJob(p.m.sqlite, id) !== null : false,
          claims: id
            ? eventCount(p.m.sqlite, { jobId: id, type: "job_started" })
            : "no-job",
          runnerCalls: id ? p.runner.callsFor(id) : "no-job",
        },
      ]),
    )

    const liveId = orphanIds.liveCreator
    const liveJob = liveId ? getAgentJob(p.m.db, liveId) : null
    if (liveJob) {
      await recordAgentJobCreated(p.m.db, liveJob, {
        kind: liveJob.kind,
        source: liveJob.source,
        runtime: liveJob.runtime,
        mode: liveJob.mode,
        cwd: liveJob.cwd,
      })
    }
    const liveReplay = await submit(
      p,
      withKey(requestFor(cases.liveCreator.prompt), cases.liveCreator.key),
    )
    const killedNewKey = await submit(
      p,
      withKey(requestFor(cases.killed.prompt), cases.killed.newKey as string),
    )
    const newId = idOf(killedNewKey)

    const orphan = { jobRow: true, creationFacts: 0, reserved: true }
    const retained = { reserved: true, claims: 0, runnerCalls: 0 }
    expect({
      killedChildSignal: killedChild.signalCode,
      orphanState,
      repeats,
      afterCleanup,
      liveReplay: {
        ...envelopeSummary(liveReplay),
        sameJob: liveId !== null && idOf(liveReplay) === liveId,
      },
      killedNewKey: {
        ...envelopeSummary(killedNewKey),
        newIdBesideOrphan:
          newId !== null &&
          orphanIds.killed !== null &&
          newId !== orphanIds.killed,
        orphanStillPresent: jobById(p.m.sqlite, orphanIds.killed) !== null,
      },
    }).toEqual({
      killedChildSignal: "SIGKILL",
      orphanState: {
        killed: orphan,
        failedCompensation: orphan,
        liveCreator: orphan,
      },
      repeats: {
        killed: SUBMISSION_PENDING,
        failedCompensation: SUBMISSION_PENDING,
        liveCreator: SUBMISSION_PENDING,
      },
      afterCleanup: {
        killed: retained,
        failedCompensation: retained,
        liveCreator: retained,
      },
      liveReplay: { ...replayOf("queued"), sameJob: true },
      killedNewKey: {
        ...FRESH_QUEUED_ACK,
        newIdBesideOrphan: true,
        orphanStillPresent: true,
      },
    })
  }, 90_000)
})

// ---------------------------------------------------------------------------
// S14 retention: one shared setup, three tests pinning distinct THEN clauses
// ---------------------------------------------------------------------------

type RetentionCase =
  | "workerPublished"
  | "artifactFree"
  | "recovery"
  | "admittedCancel"
  | "missingAdmissionCancel"
  | "otherConsumerFree"
  | "running"
  | "publishFault"
  | "crashBeforeSetter"
  | "orphan"

const S14 = IDEMPOTENCY.cases.S14
const RETENTION_MS: number = S14.retentionMs
const RETENTION_T0 = Date.parse(S14.t0)
const ENDPOINT_CASES: RetentionCase[] = [
  "workerPublished",
  "artifactFree",
  "recovery",
  "admittedCancel",
  "missingAdmissionCancel",
  "otherConsumerFree",
]
const NULL_EXPIRY_CASES: RetentionCase[] = [
  "running",
  "publishFault",
  "crashBeforeSetter",
  "orphan",
]

function retentionRequest(p: Profile, name: RetentionCase) {
  const c = S14.cases[name]
  const request = materialize(S14.requestTemplate, {
    ...p.values,
    CONSUMER: c.consumer,
    PROMPT: `S14 ${name}`,
  })
  return withKey(
    c.artifacts
      ? { ...request, artifacts: { baseDir: p.artifactBase } }
      : request,
    c.key,
  )
}

/**
 * Builds the S14 profile: six terminal reservations whose expiry endpoint is
 * T0 + 30 d and four that must stay NULL. Date is frozen with setSystemTime
 * except around the crash-case submission and its real child daemon.
 */
async function buildRetentionProfile() {
  const p = track(createProfile())
  const ids: Partial<Record<RetentionCase, string | null>> = {}
  const idFor = (name: RetentionCase) =>
    jobByPrompt(p.m.sqlite, `S14 ${name}`)?.id ?? null

  // Missing initial admission: a real creator killed when preparing its
  // second ledger append (job_created committed, initial admission not).
  await runCliChild(
    {
      dbFile: p.m.file,
      argv: SUBMIT_ARGV,
      stdinText: JSON.stringify(retentionRequest(p, "missingAdmissionCancel")),
      kill: { pattern: EVENTS_INSERT, nth: 2 },
      resultFile: join(p.scratch, "s14-missing-admission.result.json"),
    },
    p.scratch,
  )
  ids.missingAdmissionCancel = idFor("missingAdmissionCancel")

  // Recovery: claimed by an exited worker whose heartbeat is stale at T0.
  setSystemTime(new Date(RETENTION_T0 - S14.staleHeartbeatLeadMs))
  await submit(p, retentionRequest(p, "recovery"))
  ids.recovery = idFor("recovery")
  if (ids.recovery) {
    await startAgentJob(p.m.db, {
      jobId: ids.recovery,
      workerId: "s14-exited-worker",
      workerPid: exitedPid(),
    })
  }

  setSystemTime(new Date(RETENTION_T0))
  for (const name of [
    "workerPublished",
    "artifactFree",
    "otherConsumerFree",
    "admittedCancel",
    "publishFault",
  ] as RetentionCase[]) {
    await submit(p, retentionRequest(p, name))
    ids[name] = idFor(name)
  }
  for (const name of [
    "admittedCancel",
    "missingAdmissionCancel",
  ] as RetentionCase[]) {
    await cli(p, [
      "api",
      "runs",
      "cancel",
      ids[name] ?? `missing-${name}`,
      "--json",
    ])
  }
  // Post-commit publish fault: inside the runner (after claim/reopen, before
  // the terminal commit) the terminal-only result.json name is occupied by a
  // directory, so publishing result.json after the commit cannot succeed.
  const publishFaultId = ids.publishFault
  if (publishFaultId) {
    p.runner.duringRun.set(publishFaultId, () => {
      const runDir = jobById(p.m.sqlite, publishFaultId)?.artifact_base_dir
      if (runDir) {
        mkdirSync(join(runDir, "result.json"), { recursive: true })
        writeFileSync(join(runDir, "result.json", "occupied"), "fixture")
      }
    })
  }
  await daemonOnce(p)

  // Running: claimed by this live process, never confirmed stopped.
  await submit(p, retentionRequest(p, "running"))
  ids.running = idFor("running")
  if (ids.running) {
    await startAgentJob(p.m.db, {
      jobId: ids.running,
      workerId: "s14-live-worker",
      workerPid: process.pid,
    })
  }

  // Crash after publish, before the one-time expiry setter: a real daemon
  // process SIGKILLs itself when preparing its first UPDATE of the
  // reservation table. Real time keeps the claim inside the 24 h queue age.
  setSystemTime()
  await submit(p, retentionRequest(p, "crashBeforeSetter"))
  ids.crashBeforeSetter = idFor("crashBeforeSetter")
  const info = findReservationTable(p.m.sqlite)
  const crashChild = info
    ? await runCliChild(
        {
          dbFile: p.m.file,
          argv: [
            "daemon",
            "run",
            "--once",
            "--poll-interval-ms",
            "100",
            "--output",
            "json",
          ],
          lockPath: join(p.scratch, "child-daemon.lock"),
          kill: {
            pattern: `update\\s+["\`]?${info.table}["\`]?\\s+set`,
            nth: 1,
          },
          resultFile: join(p.scratch, "s14-crash.result.json"),
        },
        p.scratch,
      )
    : null
  setSystemTime(new Date(RETENTION_T0))

  // Orphan: job+reservation committed, creation never committed.
  const release = holdCreationBoundary(p.m.sqlite)
  await submit(p, retentionRequest(p, "orphan"))
  release()
  ids.orphan = idFor("orphan")

  return {
    p,
    ids: ids as Record<RetentionCase, string | null>,
    crashChildSignal: crashChild?.signalCode ?? "no-reservation-table",
  }
}

function expiryOffsets(
  p: Profile,
  ids: Record<RetentionCase, string | null>,
  names: RetentionCase[],
) {
  return Object.fromEntries(
    names.map((name) => {
      const expiry = reservationExpiryMs(p.m.sqlite, ids[name])
      return [
        name,
        typeof expiry === "number"
          ? expiry - RETENTION_T0
          : expiry === null
            ? null
            : "no-reservation",
      ]
    }),
  )
}

describe("local-job-api / Consumer Scoped Idempotent Submission (retention and redaction)", () => {
  // Enforces once the reservation table and the lifecycle-host expiry setter exist.
  test("S14 Retention has a declared endpoint — worker-published, artifact-free, recovery, admitted-cancel, missing-admission-cancel and other-consumer terminals get expiresAt = verified-publish-or-settle time + 2592000000 and a same-key replay just before expiry is marked and never extends it", async () => {
    const { p, ids } = await buildRetentionProfile()
    const endpoints = expiryOffsets(p, ids, ENDPOINT_CASES)
    const statuses = Object.fromEntries(
      ENDPOINT_CASES.map((name) => [
        name,
        jobById(p.m.sqlite, ids[name])?.status ?? null,
      ]),
    )

    setSystemTime(new Date(RETENTION_T0 + RETENTION_MS - 1000))
    const replays: Record<string, unknown> = {}
    for (const name of ENDPOINT_CASES) {
      const replay = await submit(p, retentionRequest(p, name))
      replays[name] = {
        exit: replay.code,
        idempotentReplay: replay.json?.idempotentReplay ?? null,
        sameJob: ids[name] !== null && idOf(replay) === ids[name],
      }
    }
    const endpointsAfterReplay = expiryOffsets(p, ids, ENDPOINT_CASES)

    const endpoint = Object.fromEntries(
      ENDPOINT_CASES.map((name) => [name, RETENTION_MS]),
    )
    expect({ endpoints, statuses, replays, endpointsAfterReplay }).toEqual({
      endpoints: endpoint,
      statuses: {
        workerPublished: "succeeded",
        artifactFree: "succeeded",
        recovery: "interrupted",
        admittedCancel: "canceled",
        missingAdmissionCancel: "canceled",
        otherConsumerFree: "succeeded",
      },
      replays: Object.fromEntries(
        ENDPOINT_CASES.map((name) => [
          name,
          { exit: 0, idempotentReplay: true, sameJob: true },
        ]),
      ),
      endpointsAfterReplay: endpoint,
    })
  }, 120_000)

  // Enforces once job-store cleanupExpiredAgentJobIdempotency and its two named
  // triggers (same-consumer submit, daemon loop tick) exist.
  test("S14 Retention has a declared endpoint — at expiry a same-consumer submit and, for another consumer, a daemon tick delete only expired terminal reservations; the same key then creates a new job without replay and every job row, event and run-dir file remains", async () => {
    const { p, ids } = await buildRetentionProfile()
    const jobStore: Record<string, unknown> = await import(
      "../src/main/lib/headless/job-store"
    )
    const terminalIds = [
      ...ENDPOINT_CASES,
      "publishFault",
      "crashBeforeSetter",
    ].map((name) => ids[name as RetentionCase])
    const eventsBefore = terminalIds.map((jobId) =>
      jobId ? jobEvents(p.m.sqlite, jobId).length : "no-job",
    )
    const filesBefore = snapshotFiles(p.artifactBase)
    const reserved = (name: RetentionCase) => {
      const jobId = ids[name]
      return jobId ? reservationForJob(p.m.sqlite, jobId) !== null : false
    }
    const allCases = [...ENDPOINT_CASES, ...NULL_EXPIRY_CASES]

    setSystemTime(new Date(RETENTION_T0 + RETENTION_MS))
    const sameConsumer = await submit(p, retentionRequest(p, "workerPublished"))
    const afterSameConsumer = Object.fromEntries(
      allCases.map((name) => [name, reserved(name)]),
    )
    setSystemTime(new Date(RETENTION_T0 + RETENTION_MS + 1000))
    const tick = await daemonOnce(p)
    const afterTick = Object.fromEntries(
      allCases.map((name) => [name, reserved(name)]),
    )
    const otherConsumer = await submit(
      p,
      retentionRequest(p, "otherConsumerFree"),
    )
    const filesAfter = snapshotFiles(p.artifactBase)

    expect({
      cleanupOwnerExported: typeof jobStore.cleanupExpiredAgentJobIdempotency,
      sameConsumer: {
        ...envelopeSummary(sameConsumer),
        newJob:
          idOf(sameConsumer) !== null &&
          idOf(sameConsumer) !== ids.workerPublished,
      },
      afterSameConsumer,
      tickExit: tick.code,
      afterTick,
      otherConsumer: {
        ...envelopeSummary(otherConsumer),
        newJob:
          idOf(otherConsumer) !== null &&
          idOf(otherConsumer) !== ids.otherConsumerFree,
      },
      history: {
        jobRows: terminalIds.map(
          (jobId) => jobById(p.m.sqlite, jobId) !== null,
        ),
        events: terminalIds.map((jobId) =>
          jobId ? jobEvents(p.m.sqlite, jobId).length : "no-job",
        ),
        filesUnchanged: Object.entries(filesBefore).every(
          ([file, digest]) => filesAfter[file] === digest,
        ),
        hadRunDirFiles: Object.keys(filesBefore).length > 0,
      },
    }).toEqual({
      cleanupOwnerExported: "function",
      sameConsumer: { ...FRESH_QUEUED_ACK, newJob: true },
      afterSameConsumer: {
        workerPublished: false,
        artifactFree: false,
        recovery: false,
        admittedCancel: false,
        missingAdmissionCancel: false,
        otherConsumerFree: true,
        running: true,
        publishFault: true,
        crashBeforeSetter: true,
        orphan: true,
      },
      tickExit: 0,
      afterTick: {
        workerPublished: false,
        artifactFree: false,
        recovery: false,
        admittedCancel: false,
        missingAdmissionCancel: false,
        otherConsumerFree: false,
        running: true,
        publishFault: true,
        crashBeforeSetter: true,
        orphan: true,
      },
      otherConsumer: { ...FRESH_QUEUED_ACK, newJob: true },
      history: {
        jobRows: terminalIds.map(() => true),
        events: eventsBefore,
        filesUnchanged: true,
        hadRunDirFiles: true,
      },
    })
  }, 120_000)

  // Enforces once the reservation table exists: NULL expiry is conservative.
  test("S14 Retention has a declared endpoint — running, publish-fault, crash-after-publish-before-setter and orphan reservations keep NULL expiry through wait/status reads and 31-day cleanup triggers, and their keys stay bound (replay or pending, never fresh)", async () => {
    const { p, ids, crashChildSignal } = await buildRetentionProfile()
    const nullBefore = expiryOffsets(p, ids, NULL_EXPIRY_CASES)
    for (const name of NULL_EXPIRY_CASES) {
      const jobId = ids[name] ?? `missing-${name}`
      await cli(p, ["api", "runs", "status", jobId, "--json"])
      await cli(p, ["api", "runs", "wait", jobId, "--timeout", "0", "--json"])
    }
    const nullAfterReads = expiryOffsets(p, ids, NULL_EXPIRY_CASES)
    setSystemTime(new Date(RETENTION_T0 + RETENTION_MS + 86_400_000))
    await submit(
      p,
      withKey(
        materialize(S14.requestTemplate, {
          ...p.values,
          CONSUMER: "fixture-a",
          PROMPT: "S14 cleanup trigger",
        }),
        S14.cleanupTriggerKey,
      ),
    )
    await daemonOnce(p)
    const nullAfterCleanup = expiryOffsets(p, ids, NULL_EXPIRY_CASES)
    const sameKey: Record<string, unknown> = {}
    for (const name of NULL_EXPIRY_CASES) {
      const again = await submit(p, retentionRequest(p, name))
      sameKey[name] = {
        exit: again.code,
        idempotentReplay: again.json?.idempotentReplay ?? null,
        errorCode: again.json?.error?.code ?? null,
        sameJob: ids[name] !== null && idOf(again) === ids[name],
      }
    }

    const allNull = Object.fromEntries(
      NULL_EXPIRY_CASES.map((name) => [name, null]),
    )
    const replay = {
      exit: 0,
      idempotentReplay: true,
      errorCode: null,
      sameJob: true,
    }
    expect({
      crashChildSignal,
      crashJobTerminal: ["succeeded", "failed"].includes(
        jobById(p.m.sqlite, ids.crashBeforeSetter)?.status,
      ),
      nullBefore,
      nullAfterReads,
      nullAfterCleanup,
      sameKey,
    }).toEqual({
      crashChildSignal: "SIGKILL",
      crashJobTerminal: true,
      nullBefore: allNull,
      nullAfterReads: allNull,
      nullAfterCleanup: allNull,
      sameKey: {
        running: replay,
        publishFault: replay,
        crashBeforeSetter: replay,
        orphan: {
          exit: 8,
          idempotentReplay: null,
          errorCode: "submission_pending",
          sameJob: false,
        },
      },
    })
  }, 120_000)

  // Enforces once `runs submit` and the reservation key hash exist.
  test("S15 Idempotency key stays out of durable and diagnostic output — the raw sentinel key never reaches the SQLite files, project/run-dir files, stdout or stderr; only a domain-separated hash is stored; malformed keys are invalid_idempotency_key/2, sk-/Bearer keys are secret_in_request/2 without echo, and a redactor-altered consumer.id is rejected before reservation", async () => {
    const fx = IDEMPOTENCY.cases.S15
    const p = track(createProfile())
    const request = materialize(fx.request, p.values)
    const outputs: string[] = []
    const run = async (body: unknown) => {
      const result = await submit(p, body)
      outputs.push(result.stdout, result.stderr)
      return result
    }

    const fresh = await run(withKey(request, fx.sentinelKey))
    const replay = await run(withKey(request, fx.sentinelKey))
    const conflict = await run(
      withKey(
        { ...request, prompt: { text: fx.conflictPrompt } },
        fx.sentinelKey,
      ),
    )
    const executed = await daemonOnce(p)
    outputs.push(executed.stdout, executed.stderr)
    const freshId = idOf(fresh)
    const info = findReservationTable(p.m.sqlite)
    const row = freshId ? reservationForJob(p.m.sqlite, freshId) : null
    const storedHash =
      info?.keyHashColumn && row ? row[info.keyHashColumn] : null
    const undomained = [
      fx.sentinelKey,
      sha256Hex(fx.sentinelKey),
      sha256Base64(fx.sentinelKey),
      sha256Hex(`fixture-a${fx.sentinelKey}`),
      sha256Hex(`fixture-a:${fx.sentinelKey}`),
    ]

    const variants: Record<string, unknown> = {}
    for (const variant of fx.keyVariants as {
      id: string
      key: string
      echoProbe: string | null
    }[]) {
      const before = counts(p)
      const result = await submit(p, withKey(request, variant.key))
      variants[variant.id] = {
        exit: result.code,
        stdoutLines: result.lines.length,
        errorCode: result.json?.error?.code ?? null,
        echoed:
          variant.echoProbe !== null &&
          (result.stdout + result.stderr).includes(variant.echoProbe),
        delta: delta(before, counts(p)),
      }
    }
    const beforeConsumer = counts(p)
    const consumerResult = await submit(
      p,
      withKey(
        { ...request, consumer: { id: fx.redactorAlteredConsumer.id } },
        fx.redactorAlteredConsumer.key,
      ),
    )
    const consumerDelta = delta(beforeConsumer, counts(p))

    expect({
      flow: {
        fresh: {
          exit: fresh.code,
          idempotentReplay: fresh.json?.idempotentReplay ?? null,
        },
        replay: {
          exit: replay.code,
          idempotentReplay: replay.json?.idempotentReplay ?? null,
        },
        conflict: {
          exit: conflict.code,
          errorCode: conflict.json?.error?.code ?? null,
        },
        executedStatus: jobById(p.m.sqlite, freshId)?.status ?? null,
      },
      sentinel: {
        inSqliteFiles: sqliteFilesContain(p.m.file, fx.sentinelKey),
        inProjectFiles: filesContaining(p.root, fx.sentinelKey),
        inStdoutOrStderr: outputs.some((text) => text.includes(fx.sentinelKey)),
        runDirFilesInspected:
          filesContaining(p.artifactBase, "fixture-a").length > 0,
      },
      storedHash: {
        reservationRows: reservationRows(p.m.sqlite).length,
        present: typeof storedHash === "string" && storedHash.length > 0,
        undomained: undomained.includes(String(storedHash)),
      },
      variants,
      redactorAlteredConsumer: {
        exit: consumerResult.code,
        acked: Boolean(consumerResult.json?.job),
        delta: consumerDelta,
        silentlyRedactedRow: apiJobs(p.m.sqlite).some((job) =>
          String(job.api_consumer_id).includes("[redacted"),
        ),
      },
    }).toEqual({
      flow: {
        fresh: { exit: 0, idempotentReplay: null },
        replay: { exit: 0, idempotentReplay: true },
        conflict: { exit: 2, errorCode: "idempotency_conflict" },
        executedStatus: "succeeded",
      },
      sentinel: {
        inSqliteFiles: false,
        inProjectFiles: [],
        inStdoutOrStderr: false,
        runDirFilesInspected: true,
      },
      storedHash: { reservationRows: 1, present: true, undomained: false },
      variants: Object.fromEntries(
        (fx.keyVariants as { id: string; errorCode: string }[]).map(
          (variant) => [
            variant.id,
            {
              exit: 2,
              stdoutLines: 1,
              errorCode: variant.errorCode,
              echoed: false,
              delta: NO_GROWTH,
            },
          ],
        ),
      ),
      redactorAlteredConsumer: {
        exit: 2,
        acked: false,
        delta: NO_GROWTH,
        silentlyRedactedRow: false,
      },
    })
  }, 60_000)
})

describe("local-job-api / Async Control Preserves Run Identity", () => {
  // Enforces once `runs retry --request` exists (today: "Unexpected arguments: --request -"/2).
  test("S19 Retry key replays the child and preserves the parent — two concurrent --async retries and one synchronous retry with key retry-1 share one child (retryOfJobId=source, attempt+1, one execution), replays are marked, another source conflicts, fixture-b is consumer_mismatch/2 without an id and the parent stays byte-identical", async () => {
    const fx = CONTROLS.cases.S19
    const p = track(createProfile())
    p.runner.mode = "fail"
    const source = await create(p, materialize(fx.sourceRequest, p.values))
    const other = await create(p, materialize(fx.otherSourceRequest, p.values))
    p.runner.mode = "succeed"
    const sourceId = idOf(source) ?? "missing-source"
    const otherId = idOf(other) ?? "missing-other-source"
    const sourceRow = jobById(p.m.sqlite, sourceId)
    const parentRunDir: string | null = sourceRow?.artifact_base_dir ?? null
    const parentBefore = {
      row: JSON.stringify(sourceRow),
      events: JSON.stringify(jobEvents(p.m.sqlite, sourceId)),
      files: parentRunDir ? snapshotFiles(parentRunDir) : {},
    }

    const controller = new AbortController()
    const daemon = runLocalAgentDaemon({
      db: p.m.db,
      runner: p.runner.fn,
      pollIntervalMs: 100,
      lockPath: p.lockPath,
      signal: controller.signal,
      stderr: { write: () => true },
    })
    const modes = ["async", "async", "sync"] as const
    const concurrent = await Promise.all(
      modes.map((mode) => retryWithRequest(p, sourceId, fx.retryRequest, mode)),
    )
    // A contender that observed the winner between its reservation and its
    // creation commit legitimately gets submission_pending/8 (design D3);
    // the documented consumer remedy is to repeat the same key, which must
    // then resolve to the same child.
    const settled = await Promise.all(
      concurrent.map((result, index) =>
        result.code === 8 && result.json?.error?.code === "submission_pending"
          ? retryWithRequest(p, sourceId, fx.retryRequest, modes[index])
          : Promise.resolve(result),
      ),
    )
    const [asyncA, asyncB, sync] = settled
    controller.abort()
    await daemon

    const children = apiJobs(p.m.sqlite).filter(
      (job) => job.retry_of_job_id === sourceId,
    )
    const child = children[0] ?? null
    const responseIds = [asyncA, asyncB, sync].map(idOf)
    const asyncUnflagged = [asyncA, asyncB].filter(
      (result) => result.json?.idempotentReplay !== true,
    ).length

    const beforeRejections = counts(p)
    const otherSource = await retryWithRequest(
      p,
      otherId,
      fx.retryRequest,
      "async",
    )
    const mismatch = await retryWithRequest(
      p,
      sourceId,
      fx.mismatchedConsumerRetryRequest,
      "async",
    )
    const afterRejections = delta(beforeRejections, counts(p))
    const filesAfter = parentRunDir ? snapshotFiles(parentRunDir) : {}

    expect({
      sourceStatus: sourceRow?.status ?? null,
      exits: [asyncA.code, asyncB.code, sync.code],
      oneChild: children.length,
      allSameChild:
        child !== null && responseIds.every((id) => id === child.id),
      lineage: child
        ? {
            retryOfSource: child.retry_of_job_id === sourceId,
            attemptIsSourcePlusOne:
              child.attempt === (sourceRow?.attempt ?? 0) + 1,
            status: child.status,
          }
        : "no-child",
      executions: child ? p.runner.callsFor(child.id) : 0,
      claims: child
        ? eventCount(p.m.sqlite, { jobId: child.id, type: "job_started" })
        : 0,
      asyncEnvelopes: [asyncA, asyncB].map((result) =>
        JSON.stringify(Object.keys(result.json ?? {}).sort()) ===
        JSON.stringify(
          result.json?.idempotentReplay === true
            ? fx.expected.asyncEnvelopeKeysReplay
            : fx.expected.asyncEnvelopeKeysFresh,
        )
          ? "ok"
          : "unexpected-async-envelope",
      ),
      asyncUnflaggedAtMostOne: asyncUnflagged <= 1,
      sync: {
        resultStatus: sync.json?.result?.status ?? null,
        resultIsTheChild:
          child !== null && sync.json?.result?.jobId === child.id,
      },
      otherSource: {
        exit: otherSource.code,
        errorCode: otherSource.json?.error?.code ?? null,
        childrenOfOther: apiJobs(p.m.sqlite).filter(
          (job) => job.retry_of_job_id === otherId,
        ).length,
      },
      mismatch: {
        exit: mismatch.code,
        errorCode: mismatch.json?.error?.code ?? null,
        hasJob: Boolean(mismatch.json?.job),
        revealsAnId: [sourceId, child?.id ?? "no-child"].some((id) =>
          (mismatch.stdout + mismatch.stderr).includes(id),
        ),
      },
      noNewWork: {
        jobs: afterRejections.jobs,
        runnerCalls: afterRejections.runnerCalls,
      },
      parentUnchanged: {
        row: JSON.stringify(jobById(p.m.sqlite, sourceId)) === parentBefore.row,
        events:
          JSON.stringify(jobEvents(p.m.sqlite, sourceId)) ===
          parentBefore.events,
        files:
          JSON.stringify(filesAfter) === JSON.stringify(parentBefore.files),
        hadFiles: Object.keys(parentBefore.files).length > 0,
      },
    }).toEqual({
      sourceStatus: "failed",
      exits: [0, 0, fx.expected.syncExit],
      oneChild: 1,
      allSameChild: true,
      lineage: {
        retryOfSource: true,
        attemptIsSourcePlusOne: true,
        status: fx.expected.childStatus,
      },
      executions: 1,
      claims: 1,
      asyncEnvelopes: ["ok", "ok"],
      asyncUnflaggedAtMostOne: true,
      sync: { resultStatus: fx.expected.childStatus, resultIsTheChild: true },
      otherSource: {
        exit: fx.expected.differentSource.exit,
        errorCode: fx.expected.differentSource.errorCode,
        childrenOfOther: 0,
      },
      mismatch: {
        exit: fx.expected.consumerMismatch.exit,
        errorCode: fx.expected.consumerMismatch.errorCode,
        hasJob: false,
        revealsAnId: false,
      },
      noNewWork: { jobs: 0, runnerCalls: 0 },
      parentUnchanged: { row: true, events: true, files: true, hadFiles: true },
    })
  }, 60_000)
})

describe("local-job-api / Discovery Feature Advertisement (inherited)", () => {
  test("S53 Older build lacks the feature — documentation-example preflight reads a no-async-submit discovery envelope as unsupported and its dispatch spy stays zero, while an envelope advertising the feature dispatches once (green-by-design; not evidence about the Locus parser)", async () => {
    const fx = DISCOVERY.cases.S53
    let dispatches = 0
    const dispatch = async () => {
      dispatches += 1
    }
    const older = await preflightThenDispatch(
      fx.olderBuildEnvelope,
      fx.requiredFeature,
      dispatch,
    )
    const dispatchesAfterOlder = dispatches
    const advertising = await preflightThenDispatch(
      {
        ...fx.olderBuildEnvelope,
        features: [...fx.olderBuildEnvelope.features, fx.requiredFeature],
      },
      fx.requiredFeature,
      dispatch,
    )

    expect({
      olderBuild: {
        apiVersion: fx.olderBuildEnvelope.apiVersion,
        lacksFeature: !fx.olderBuildEnvelope.features.includes(
          fx.requiredFeature,
        ),
        supported: older.supported,
        dispatchCount: dispatchesAfterOlder,
      },
      positiveControl: {
        supported: advertising.supported,
        dispatchCount: dispatches,
      },
    }).toEqual({
      olderBuild: {
        apiVersion: "locus.local-job.v1",
        lacksFeature: true,
        supported: fx.expected.supported,
        dispatchCount: fx.expected.dispatchCount,
      },
      positiveControl: { supported: true, dispatchCount: 1 },
    })
  })
})
