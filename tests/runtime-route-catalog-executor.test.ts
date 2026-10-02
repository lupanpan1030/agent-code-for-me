/**
 * Independent RED suite, refactor-unified-runtime-route-catalog, surfaces
 * domain: pump/claim adjacency (S16) and submission replay / scoped pumps
 * (S17). Fixture: tests/fixtures/runtime-route-catalog/executor.json.
 *
 * Baseline queue behaviour (one claim per eligible Run, daemon→schedule→api
 * order, source exclusions, keyed replay, own-ID wrapper and session-scoped
 * stdio pumps) is already pinned by the archived async-submit suite and is
 * registered, not duplicated (see the red report). These tests pin what the
 * catalog adds: pumpQueuedRuns/CLI/stdio forward runtimeRouteCatalog
 * unchanged, and the catalog is consulted only inside the agent runner after
 * the winning claim and the provider binding.
 */
import { afterEach, describe, expect, test } from "bun:test"
import {
  apiAgentRequest,
  apiCompletionRequest,
  buildRecordingCatalog,
  cannedDelegates,
  cleanupSurfaceTemps,
  completionFetchRecorder,
  createLatch,
  createSurfaceProfile,
  enqueueDaemonRun,
  enqueueScheduleRun,
  eventTypes,
  fixtureKey,
  installHeadlessLeafIoMocks,
  isJson,
  type Json,
  jobIdFromEnvelope,
  jobRow,
  type Latch,
  processCalls,
  type RecordingCatalog,
  runCli,
  type SurfaceProfile,
  seedCompletionProviderProfile,
  settle,
  startStdioSession,
  submitApiRun,
  until,
} from "./runtime-route-catalog-surfaces-kit"

await installHeadlessLeafIoMocks()

type EligibleRow = {
  name: string
  source: string
  kind: "agent" | "completion"
  runtime: string
  executionSurface: string | null
}
type S16Fixture = {
  eligibleRows: EligibleRow[]
  excludedRows: { id: string; source: string; runtime: string }[]
  completionProfileId: string
  expectedDispatchOrder: string[]
  winnerAgentSegment: string[]
  winnerCompletionSegment: string[]
  loserSegment: string[]
  baselineAgentEventTypes: string[]
  forbiddenPayloadKeys: string[]
}
type S17Fixture = {
  replay: {
    consumerId: string
    idempotencyKey: string
    runtime: string
    prompt: string
    executionSurface: string
  }
  wrapper: {
    consumerId: string
    foreignConsumerId: string
    runtime: string
    prompt: string
    executionSurface: string
    workerPrefix: string
  }
  stdio: {
    runtime: string
    prompt: string
    executionSurface: string
    foreignProtocolRowId: string
    workerPrefix: string
    ackRequestId: number
  }
}

const profiles: SurfaceProfile[] = []

afterEach(() => {
  processCalls.length = 0
  while (profiles.length > 0) profiles.pop()?.close()
  cleanupSurfaceTemps()
})

function newProfile(): SurfaceProfile {
  const profile = createSurfaceProfile()
  profiles.push(profile)
  return profile
}

async function catalogOrFailure(
  build: () => Promise<RecordingCatalog>,
): Promise<RecordingCatalog | null> {
  const built = await settle(build)
  expect(built.ok ? "test catalog built" : built.error).toBe(
    "test catalog built",
  )
  return built.ok ? built.value : null
}

async function createExcludedRow(
  profile: SurfaceProfile,
  row: { id: string; source: string; runtime: string },
): Promise<void> {
  const { createAgentJob } = await import("../src/main/lib/headless/job-store")
  await createAgentJob(profile.mdb.db, {
    id: row.id,
    source: row.source as Parameters<typeof createAgentJob>[1]["source"],
    runtime: row.runtime as Parameters<typeof createAgentJob>[1]["runtime"],
    mode: "plan",
    cwd: profile.cwd,
    prompt: `excluded ${row.id}`,
    projectId: "project-surfaces",
  })
}

function payloadKeysDeep(value: unknown, keys: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) payloadKeysDeep(item, keys)
    return
  }
  if (!isJson(value)) {
    if (typeof value === "string") keys.add(`value:${value}`)
    return
  }
  for (const [key, item] of Object.entries(value)) {
    keys.add(key)
    payloadKeysDeep(item, keys)
  }
}

function forbiddenPayloadHits(
  profile: SurfaceProfile,
  jobId: string,
  forbidden: string[],
): string[] {
  const rows = profile.mdb.sqlite
    .query("SELECT payload_json FROM agent_job_events WHERE job_id = ?")
    .all(jobId) as { payload_json: string }[]
  const keys = new Set<string>()
  for (const row of rows) payloadKeysDeep(JSON.parse(row.payload_json), keys)
  return forbidden.filter((name) => keys.has(name) || keys.has(`value:${name}`))
}

function countRows(profile: SurfaceProfile, table: string): number {
  const row = profile.mdb.sqlite
    .query(`SELECT count(*) AS count FROM ${table}`)
    .get() as { count: number }
  return row.count
}

/** Per-pump segments starting at each claim attempt (`attempt` .. next). */
function segmentsOf(timeline: string[], tag: string): string[][] {
  const segments: string[][] = []
  for (const entry of timeline) {
    if (!entry.startsWith(`${tag}:`)) continue
    const [kind, ...rest] = entry.slice(tag.length + 1).split(":")
    const label =
      rest.length > 0 && kind !== "lookup" ? `${kind}:${rest.at(-1)}` : kind
    if (kind === "attempt" || segments.length === 0) segments.push([])
    const current = segments[segments.length - 1]
    // Consecutive provider-binding reads of one claim collapse to one step.
    if (kind === "provider" && current.at(-1) === "provider") continue
    current.push(kind === "provider" ? "provider" : label)
  }
  return segments
}

describe("S16 Concurrent pumps still execute an admitted Run once", () => {
  test("S16 Concurrent pumps still execute an admitted Run once — two pumpQueuedRuns instances on independent connections each forward their own runtimeRouteCatalog unchanged; the winner alone looks up and invokes the batch leaf after claim and provider binding, the loser and the completion runner never touch the catalog, daemon→schedule→api order and source exclusions hold and no catalog row/event is written", async () => {
    // Enforces once runtime-route-catalog.ts exists and pumpQueuedRuns
    // forwards runtimeRouteCatalog unchanged to the agent runner (design D1,
    // D2 daemon/job-runner row, OD-4: catalog lookup only after claim).
    const fixture = fixtureKey<S16Fixture>("executor.json", "S16")
    const profile = newProfile()
    seedCompletionProviderProfile(profile, fixture.completionProfileId)
    const ids: Record<string, string> = {}
    for (const row of fixture.eligibleRows) {
      const prompt = `S16 ${row.name}`
      if (row.source === "daemon") {
        ids[row.name] = await enqueueDaemonRun(profile, row.runtime, prompt)
      } else if (row.source === "schedule") {
        ids[row.name] = await enqueueScheduleRun(profile, row.runtime, prompt)
      } else if (row.kind === "completion") {
        ids[row.name] = await submitApiRun(
          profile,
          apiCompletionRequest({
            consumerId: `s16-${row.name}`,
            profileId: fixture.completionProfileId,
          }),
        )
      } else {
        ids[row.name] = await submitApiRun(
          profile,
          apiAgentRequest({
            cwd: profile.cwd,
            runtime: row.runtime,
            consumerId: `s16-${row.name}`,
            prompt,
          }),
        )
      }
    }
    for (const row of fixture.excludedRows) {
      await createExcludedRow(profile, row)
    }
    const nameOf = (jobId: string) =>
      Object.keys(ids).find((name) => ids[name] === jobId) ?? jobId
    const timeline: string[] = []
    let gate: Latch = createLatch()
    const catalogs: Record<string, RecordingCatalog | null> = {}
    for (const tag of ["A", "B"]) {
      catalogs[tag] = await catalogOrFailure(() =>
        buildRecordingCatalog({
          delegates: cannedDelegates(),
          timeline,
          tag,
          // Runner latch: the winner holds inside its leaf until the losing
          // claimant's pass has settled.
          beforeInvoke: () => gate.promise,
        }),
      )
    }
    const catalogA = catalogs.A
    const catalogB = catalogs.B
    if (!catalogA || !catalogB) return
    const jobsBefore = countRows(profile, "agent_jobs")
    const second = profile.mdb.openSecondConnection()
    const fetcher = completionFetchRecorder()
    const { pumpQueuedRuns } = await import("../src/main/lib/headless/daemon")
    const optionsFor = (tag: string, db: unknown, catalog: RecordingCatalog) =>
      ({
        db,
        concurrency: 1,
        workerKind: "daemon",
        completionFetch: fetcher.fetch,
        runtimeRouteCatalog: catalog.state,
        claimObserver: {
          attempting: (job: { id: string }) =>
            timeline.push(`${tag}:attempt:${job.id}`),
          claimed: (job: { id: string }) =>
            timeline.push(`${tag}:claimed:${job.id}`),
        },
        providerBindingDependencies: {
          getProviderDefaultRuntimeConfig: () => {
            timeline.push(`${tag}:provider`)
            return null
          },
        },
      }) as unknown as Parameters<typeof pumpQueuedRuns>[0]
    const passResults: Json[] = []
    for (let pass = 0; pass < 8; pass += 1) {
      gate = createLatch()
      const passA = pumpQueuedRuns(optionsFor("A", profile.mdb.db, catalogA))
      const passB = pumpQueuedRuns(optionsFor("B", second.db, catalogB))
      await Promise.race([passA, passB])
      gate.release()
      const [resultA, resultB] = await Promise.all([passA, passB])
      passResults.push({ A: resultA.runs, B: resultB.runs })
      if (resultA.runs.length === 0 && resultB.runs.length === 0) break
    }

    const claims = timeline
      .filter((entry) => entry.includes(":claimed:"))
      .map((entry) => entry.split(":"))
    const winnerOf = (jobId: string) =>
      claims.filter((parts) => parts[2] === jobId).map((parts) => parts[0])
    const kindOf = (jobId: string) =>
      fixture.eligibleRows.find((row) => ids[row.name] === jobId)?.kind
    const segmentShapes = ["A", "B"].flatMap((tag) =>
      segmentsOf(timeline, tag).map((segment) => {
        const jobId = segment[0]?.split(":")[1] ?? ""
        return {
          tag,
          job: nameOf(jobId),
          steps: segment.map((step) => step.split(":")[0]),
        }
      }),
    )
    const expectedSegmentShapes = ["A", "B"].flatMap((tag) =>
      segmentsOf(timeline, tag).map((segment) => {
        const jobId = segment[0]?.split(":")[1] ?? ""
        const won = winnerOf(jobId).includes(tag)
        return {
          tag,
          job: nameOf(jobId),
          steps: !won
            ? fixture.loserSegment
            : kindOf(jobId) === "completion"
              ? fixture.winnerCompletionSegment
              : fixture.winnerAgentSegment,
        }
      }),
    )
    const invocations = [...catalogA.invocations, ...catalogB.invocations].map(
      (invocation) => [
        nameOf(invocation.jobId),
        invocation.runtimeId,
        invocation.executionSurface,
        invocation.source,
      ],
    )
    const observed = {
      claimsPerRun: Object.fromEntries(
        fixture.eligibleRows.map((row) => [
          row.name,
          winnerOf(ids[row.name]).length,
        ]),
      ),
      dispatchOrder: claims.map((parts) => nameOf(parts[2])),
      segments: segmentShapes,
      invocations,
      completionFetches: fetcher.calls.length,
      nativeLeafStarts: processCalls.length,
      excluded: fixture.excludedRows.map((row) => [
        row.id,
        jobRow(profile.mdb, row.id).status,
        eventTypes(profile.mdb, row.id),
      ]),
      agentEventTypes: fixture.eligibleRows
        .filter((row) => row.source !== "api" && row.kind === "agent")
        .map((row) => [row.name, eventTypes(profile.mdb, ids[row.name])]),
      forbiddenPayloadHits: fixture.eligibleRows.flatMap((row) =>
        forbiddenPayloadHits(
          profile,
          ids[row.name],
          fixture.forbiddenPayloadKeys,
        ),
      ),
      jobsAfter: countRows(profile, "agent_jobs"),
      terminal: fixture.eligibleRows.map((row) => [
        row.name,
        jobRow(profile.mdb, ids[row.name]).status,
      ]),
    }
    expect(observed).toEqual({
      claimsPerRun: Object.fromEntries(
        fixture.eligibleRows.map((row) => [row.name, 1]),
      ),
      dispatchOrder: fixture.expectedDispatchOrder,
      segments: expectedSegmentShapes,
      invocations: fixture.eligibleRows
        .filter((row) => row.kind === "agent")
        .map((row) => [
          row.name,
          row.runtime,
          row.executionSurface,
          row.source,
        ]),
      completionFetches: 1,
      nativeLeafStarts: 0,
      excluded: fixture.excludedRows.map((row) => [
        row.id,
        "queued",
        ["job_created"],
      ]),
      agentEventTypes: fixture.eligibleRows
        .filter((row) => row.source !== "api" && row.kind === "agent")
        .map((row) => [row.name, fixture.baselineAgentEventTypes]),
      forbiddenPayloadHits: [],
      jobsAfter: jobsBefore,
      terminal: fixture.eligibleRows.map((row) => [row.name, "succeeded"]),
    })
    expect(passResults.length).toBeGreaterThan(0)
  }, 60_000)
})

describe("S17 Submission replay and scoped protocol execution reuse existing owners", () => {
  test("S17 Submission replay and scoped protocol execution reuse existing owners — a matching keyed submit replays its one job before and after execution, and the catalog factory is looked up and invoked exactly once for that job", async () => {
    // Enforces once runtime-route-catalog.ts exists and pumpQueuedRuns
    // forwards runtimeRouteCatalog to the agent runner (design D1).
    const fixture = fixtureKey<S17Fixture>("executor.json", "S17").replay
    const profile = newProfile()
    const catalog = await catalogOrFailure(() =>
      buildRecordingCatalog({ delegates: cannedDelegates() }),
    )
    if (!catalog) return
    const request = apiAgentRequest({
      cwd: profile.cwd,
      runtime: fixture.runtime,
      consumerId: fixture.consumerId,
      prompt: fixture.prompt,
      idempotencyKey: fixture.idempotencyKey,
    })
    const { pumpQueuedRuns } = await import("../src/main/lib/headless/daemon")
    const pump = () =>
      pumpQueuedRuns({
        db: profile.mdb.db,
        concurrency: 1,
        workerKind: "daemon",
        runtimeRouteCatalog: catalog.state,
      } as unknown as Parameters<typeof pumpQueuedRuns>[0])
    const first = await submitApiRun(profile, request)
    const replayBeforeRun = await submitApiRun(profile, request)
    const firstPass = await pump()
    const replayAfterRun = await submitApiRun(profile, request)
    const secondPass = await pump()
    const consumerRows = profile.mdb.sqlite
      .query("SELECT id FROM agent_jobs WHERE api_consumer_id = ?")
      .all(fixture.consumerId) as { id: string }[]
    expect({
      replayIds: [replayBeforeRun, replayAfterRun],
      consumerRows: consumerRows.map((row) => row.id),
      firstPass: firstPass.runs.map((run) => [run.jobId, run.claimed]),
      secondPass: secondPass.runs.length,
      lookups: catalog.lookups,
      invocations: catalog.invocations.map((call) => [
        call.jobId,
        call.runtimeId,
        call.executionSurface,
        call.source,
      ]),
      status: jobRow(profile.mdb, first).status,
    }).toEqual({
      replayIds: [first, first],
      consumerRows: [first],
      firstPass: [[first, true]],
      secondPass: 0,
      lookups: [
        {
          runtimeId: fixture.runtime,
          executionSurface: fixture.executionSurface,
        },
      ],
      invocations: [[first, fixture.runtime, fixture.executionSurface, "api"]],
      status: "succeeded",
    })
  }, 30_000)

  test("S17 Submission replay and scoped protocol execution reuse existing owners — the own-ID synchronous create wrapper forwards runtimeRouteCatalog through the existing pump and dispatches only its admitted ID, leaving a foreign queued API Run and a daemon Run untouched", async () => {
    // Enforces once runtime-route-catalog.ts exists and RunHeadlessCliCommand
    // forwards runtimeRouteCatalog to the wrapper's scoped pump (design D1).
    const fixture = fixtureKey<S17Fixture>("executor.json", "S17").wrapper
    const profile = newProfile()
    const catalog = await catalogOrFailure(() =>
      buildRecordingCatalog({ delegates: cannedDelegates() }),
    )
    if (!catalog) return
    const foreignApi = await submitApiRun(
      profile,
      apiAgentRequest({
        cwd: profile.cwd,
        runtime: fixture.runtime,
        consumerId: fixture.foreignConsumerId,
        prompt: "S17 foreign queued API run",
      }),
    )
    const foreignDaemon = await enqueueDaemonRun(
      profile,
      fixture.runtime,
      "S17 foreign daemon run",
    )
    const created = await runCli(
      profile.mdb.db,
      ["api", "runs", "create", "--request", "-", "--json"],
      {
        stdin: JSON.stringify(
          apiAgentRequest({
            cwd: profile.cwd,
            runtime: fixture.runtime,
            consumerId: fixture.consumerId,
            prompt: fixture.prompt,
          }),
        ),
        extra: { runtimeRouteCatalog: catalog.state },
      },
    )
    const own = jobIdFromEnvelope(created.stdout)
    const ownRow = jobRow(profile.mdb, own)
    expect({
      exitCode: created.code,
      ownStatus: ownRow.status,
      ownWorkerPrefix: String(ownRow.worker_id).startsWith(
        fixture.workerPrefix,
      ),
      invocations: catalog.invocations.map((call) => [
        call.jobId,
        call.runtimeId,
        call.executionSurface,
        call.source,
      ]),
      foreign: [foreignApi, foreignDaemon].map((jobId) => [
        jobRow(profile.mdb, jobId).status,
        eventTypes(profile.mdb, jobId),
      ]),
      nativeLeafStarts: processCalls.length,
    }).toEqual({
      exitCode: 0,
      ownStatus: "succeeded",
      ownWorkerPrefix: true,
      invocations: [[own, fixture.runtime, fixture.executionSurface, "api"]],
      foreign: [
        ["queued", ["job_created"]],
        ["queued", ["job_created"]],
      ],
      nativeLeafStarts: 0,
    })
  }, 30_000)

  test("S17 Submission replay and scoped protocol execution reuse existing owners — a jobs-stdio session forwards runtimeRouteCatalog to its session-scoped pump, acks before execution, dispatches only its admitted ID, and a competing claimant on another connection loses without any catalog lookup", async () => {
    // Enforces once runtime-route-catalog.ts exists and RunJobsStdioServer
    // forwards runtimeRouteCatalog to its session-scoped pump (design D1).
    const fixture = fixtureKey<S17Fixture>("executor.json", "S17").stdio
    const profile = newProfile()
    const runnerLatch = createLatch()
    const ackSeenAtInvoke: boolean[] = []
    let sessionLines: Json[] = []
    const sessionCatalog = await catalogOrFailure(() =>
      buildRecordingCatalog({
        delegates: cannedDelegates(),
        beforeInvoke: async () => {
          ackSeenAtInvoke.push(
            sessionLines.some((line) => line.id === fixture.ackRequestId),
          )
          await runnerLatch.promise
        },
      }),
    )
    const competingCatalog = await catalogOrFailure(() =>
      buildRecordingCatalog({ delegates: cannedDelegates() }),
    )
    if (!sessionCatalog || !competingCatalog) return
    await createExcludedRow(profile, {
      id: fixture.foreignProtocolRowId,
      source: "protocol",
      runtime: fixture.runtime,
    })
    const session = startStdioSession(profile.mdb.db, {
      runtimeRouteCatalog: sessionCatalog.state,
    })
    sessionLines = session.lines
    session.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    session.send({
      jsonrpc: "2.0",
      id: fixture.ackRequestId,
      method: "job.run",
      params: {
        runtime: fixture.runtime,
        cwd: profile.cwd,
        prompt: fixture.prompt,
      },
    })
    const ack = await session.waitFor(
      (line) => line.id === fixture.ackRequestId,
      "job.run ack",
    )
    const result = ack.result
    const job = isJson(result) ? result.job : null
    const sessionJobId =
      isJson(job) && typeof job.id === "string" ? job.id : "missing"
    const claimed = await settle(() =>
      until(
        () =>
          sessionCatalog.invocations.length > 0 ||
          jobRow(profile.mdb, sessionJobId).status !== "queued"
            ? true
            : null,
        "session claim",
      ),
    )
    const second = profile.mdb.openSecondConnection()
    const { pumpQueuedRuns } = await import("../src/main/lib/headless/daemon")
    const competing = await pumpQueuedRuns({
      db: second.db,
      admittedIds: [sessionJobId],
      concurrency: 1,
      runtimeRouteCatalog: competingCatalog.state,
    } as unknown as Parameters<typeof pumpQueuedRuns>[0])
    runnerLatch.release()
    const settledTerminal = await settle(() =>
      until(
        () =>
          ["succeeded", "failed", "canceled"].includes(
            String(jobRow(profile.mdb, sessionJobId).status),
          )
            ? true
            : null,
        "session run terminal",
      ),
    )
    session.send({ jsonrpc: "2.0", id: 3, method: "shutdown" })
    session.end()
    const exitCode = await session.exit
    const sessionRow = jobRow(profile.mdb, sessionJobId)
    expect({
      claimed: claimed.ok,
      settledTerminal: settledTerminal.ok,
      exitCode,
      status: sessionRow.status,
      workerPrefix: String(sessionRow.worker_id).startsWith(
        fixture.workerPrefix,
      ),
      ackSeenAtInvoke,
      sessionInvocations: sessionCatalog.invocations.map((call) => [
        call.jobId,
        call.runtimeId,
        call.executionSurface,
        call.source,
      ]),
      competing: competing.runs.map((run) => [run.jobId, run.claimed]),
      competingLookups: competingCatalog.lookups.length,
      competingInvocations: competingCatalog.invocations.length,
      foreign: [
        jobRow(profile.mdb, fixture.foreignProtocolRowId).status,
        eventTypes(profile.mdb, fixture.foreignProtocolRowId),
      ],
      nativeLeafStarts: processCalls.length,
    }).toEqual({
      claimed: true,
      settledTerminal: true,
      exitCode: 0,
      status: "succeeded",
      workerPrefix: true,
      ackSeenAtInvoke: [true],
      sessionInvocations: [
        [sessionJobId, fixture.runtime, fixture.executionSurface, "protocol"],
      ],
      competing: [],
      competingLookups: 0,
      competingInvocations: 0,
      foreign: ["queued", ["job_created"]],
      nativeLeafStarts: 0,
    })
  }, 30_000)
})
