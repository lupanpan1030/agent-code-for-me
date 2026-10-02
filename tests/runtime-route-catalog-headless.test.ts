/**
 * Independent RED suite, refactor-unified-runtime-route-catalog, surfaces
 * domain: headless batch hosts (S14) and rich-adapter non-selection (S15).
 * Fixture: tests/fixtures/runtime-route-catalog/headless.json.
 */
import { afterEach, describe, expect, test } from "bun:test"
import type {
  AgentRuntimeObserver,
  AgentRuntimeRunRequest,
  AgentRuntimeRunResult,
  CreateAgentRuntimeRunRequestInput,
} from "../src/main/lib/headless/agent-runtime-contract"
import {
  apiAgentRequest,
  buildRecordingCatalog,
  cannedDelegates,
  cannedHeadlessDelegate,
  cleanupSurfaceTemps,
  createSurfaceProfile,
  FIXTURE_CLAUDE_EXECUTABLE,
  FIXTURE_CODEX_EXECUTABLE,
  fixtureKey,
  installHeadlessLeafIoMocks,
  isJson,
  type Json,
  jobRow,
  onlyJsonLine,
  pick,
  processCalls,
  type RecordingCatalog,
  render,
  runCli,
  type SurfaceProfile,
  settle,
  startStdioSession,
  statusPayloads,
  until,
} from "./runtime-route-catalog-surfaces-kit"

await installHeadlessLeafIoMocks()

type HostCase = { host: string; source: string; mode: "agent" | "plan" }
type RuntimeExpectation = {
  executable: string
  label: string
  argsByMode: Record<string, string[]>
  runtimeSelected: Json
}
type S14Fixture = {
  hosts: HostCase[]
  runtimes: Record<string, RuntimeExpectation>
  runtimeSelectedKeys: string[]
  forbiddenPayloadKeys: string[]
  batchExecutionSurface: string
  richExecutionSurfaces: string[]
}
type S15Case = {
  caseId: string
  input: Omit<CreateAgentRuntimeRunRequestInput, "cwd" | "signal">
  expect: {
    outcome: "selected" | "refused"
    executionSurface?: string
    baselineArgs?: string[]
    result?: Json
    status: Json
  }
}
type S15Fixture = {
  richExecutionSurfaces: string[]
  requests: S15Case[]
  runtimeSelectedKeys: string[]
  runtimeSelectionRefusedKeys: string[]
}

const RUNTIMES = ["codex", "claude-code"] as const
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

function jobIdOf(stdout: string): string {
  const job = onlyJsonLine(stdout).job
  if (!isJson(job) || typeof job.id !== "string") {
    throw new Error(`no job id in ${stdout}`)
  }
  return job.id
}

function terminal(profile: SurfaceProfile, jobId: string): Promise<true> {
  return until(
    () =>
      ["succeeded", "failed", "canceled"].includes(
        String(jobRow(profile.mdb, jobId).status),
      )
        ? true
        : null,
    `terminal ${jobId}`,
  )
}

/**
 * Starts one existing batch job through its real host. `catalogExtra` is the
 * `runtimeRouteCatalog` forwarding option (empty for the baseline legs).
 */
async function startThroughHost(input: {
  profile: SurfaceProfile
  host: string
  runtime: string
  prompt: string
  catalogExtra: Json
}): Promise<{ jobId: string; exitCode: number | null }> {
  const { profile, host, runtime, prompt, catalogExtra } = input
  const db = profile.mdb.db
  const { pumpQueuedRuns } = await import("../src/main/lib/headless/daemon")
  const pumpOptions = (extra: Json) =>
    ({ db, concurrency: 1, workerKind: "daemon", ...extra }) as Parameters<
      typeof pumpQueuedRuns
    >[0]
  if (host === "cli") {
    const result = await runCli(
      db,
      [
        "run",
        "--runtime",
        runtime,
        "--cwd",
        profile.cwd,
        "--prompt",
        prompt,
        "--output",
        "json",
      ],
      { extra: catalogExtra },
    )
    return { jobId: jobIdOf(result.stdout), exitCode: result.code }
  }
  if (host === "daemon" || host === "schedule") {
    let jobId: string
    if (host === "daemon") {
      const created = await runCli(db, [
        "run",
        "--daemon",
        "--runtime",
        runtime,
        "--cwd",
        profile.cwd,
        "--prompt",
        prompt,
        "--output",
        "json",
      ])
      jobId = jobIdOf(created.stdout)
    } else {
      const created = await runCli(db, [
        "schedules",
        "create",
        "--name",
        `S14 ${runtime}`,
        "--prompt",
        prompt,
        "--interval-seconds",
        "3600",
        "--cwd",
        profile.cwd,
        "--runtime",
        runtime,
        "--output",
        "json",
      ])
      const schedule = onlyJsonLine(created.stdout).schedule
      if (!isJson(schedule)) throw new Error(created.stdout)
      const fired = await runCli(db, [
        "schedules",
        "run",
        String(schedule.id),
        "--output",
        "json",
      ])
      jobId = jobIdOf(fired.stdout)
    }
    const pumped = await pumpQueuedRuns(pumpOptions(catalogExtra))
    return {
      jobId,
      exitCode:
        pumped.runs.find((run) => run.jobId === jobId)?.exitCode ?? null,
    }
  }
  if (host === "protocol") {
    const session = startStdioSession(db, catalogExtra)
    session.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    session.send({
      jsonrpc: "2.0",
      id: 2,
      method: "job.run",
      params: { runtime, cwd: profile.cwd, prompt },
    })
    const ack = await session.waitFor((line) => line.id === 2, "job.run ack")
    const result = ack.result
    const job = isJson(result) ? result.job : null
    if (!isJson(job) || typeof job.id !== "string") {
      throw new Error(`job.run ack without job: ${JSON.stringify(ack)}`)
    }
    await terminal(profile, job.id)
    session.send({ jsonrpc: "2.0", id: 3, method: "shutdown" })
    session.end()
    return { jobId: job.id, exitCode: await session.exit }
  }
  const request = apiAgentRequest({
    cwd: profile.cwd,
    runtime,
    consumerId: "route-catalog-s14",
    prompt,
  })
  const created = await runCli(
    db,
    ["api", "runs", "create", "--request", "-", "--json"],
    { stdin: JSON.stringify(request), extra: catalogExtra },
  )
  return { jobId: jobIdOf(created.stdout), exitCode: created.code }
}

function runtimeValues(profile: SurfaceProfile, prompt: string) {
  return {
    CWD: profile.cwd,
    PROMPT: prompt,
    CODEX_EXECUTABLE: FIXTURE_CODEX_EXECUTABLE,
    CLAUDE_EXECUTABLE: FIXTURE_CLAUDE_EXECUTABLE,
  }
}

describe("S14 Existing batch behavior is preserved", () => {
  test("S14 Existing batch behavior is preserved — CLI, daemon, schedule, protocol and API hosts start codex exec / claude -p with the baseline argv, stdin, source and cancellation port and the baseline runtime_selected payload", async () => {
    const fixture = fixtureKey<S14Fixture>("headless.json", "S14")
    const observed: Json[] = []
    const expected: Json[] = []
    for (const hostCase of fixture.hosts) {
      for (const runtime of RUNTIMES) {
        const profile = newProfile()
        const prompt = `S14 baseline ${hostCase.host} ${runtime}`
        const started = await startThroughHost({
          profile,
          host: hostCase.host,
          runtime,
          prompt,
          catalogExtra: {},
        })
        const expectation = fixture.runtimes[runtime]
        const values = runtimeValues(profile, prompt)
        const selected = statusPayloads(profile.mdb, started.jobId).filter(
          (payload) => payload.status === "runtime_selected",
        )
        observed.push({
          host: hostCase.host,
          runtime,
          exitCode: started.exitCode,
          status: jobRow(profile.mdb, started.jobId).status,
          leafStarts: processCalls
            .filter((call) => call.jobId === started.jobId)
            .map((call) => ({
              executable: call.executable,
              args: call.args,
              stdin: call.stdin,
              label: call.label,
              source: call.source,
              executionProfile: call.executionProfile,
              cancellationPort: call.cancellationPort,
              abortedAtStart: call.abortedAtStart,
            })),
          runtimeSelected: selected.map((payload) =>
            pick(payload, fixture.runtimeSelectedKeys),
          ),
          forbiddenKeys: selected.flatMap((payload) =>
            fixture.forbiddenPayloadKeys.filter((key) =>
              Object.hasOwn(payload, key),
            ),
          ),
        })
        expected.push({
          host: hostCase.host,
          runtime,
          exitCode: 0,
          status: "succeeded",
          leafStarts: [
            {
              executable: render(expectation.executable, values),
              args: render(expectation.argsByMode[hostCase.mode], values),
              stdin: null,
              label: expectation.label,
              source: hostCase.source,
              executionProfile: "batch",
              cancellationPort: "abort-signal",
              abortedAtStart: false,
            },
          ],
          runtimeSelected: [
            { ...expectation.runtimeSelected, source: hostCase.source },
          ],
          forbiddenKeys: [],
        })
      }
    }
    expect(observed).toEqual(expected)
  }, 60_000)

  test("S14 Existing batch behavior is preserved — every real host forwards its runtimeRouteCatalog option to runAgentTask, which runs the catalog batch leaf (one post-binding factory lookup, one delegate call) with unchanged argv, source and cancellation port and never a rich factory", async () => {
    // Enforces once runtime-route-catalog.ts exists and the CLI/pump/stdio/API
    // hosts forward runtimeRouteCatalog to runAgentTask (design D1 seam).
    const fixture = fixtureKey<S14Fixture>("headless.json", "S14")
    const { runClaudeCodeHeadlessTask } = await import(
      "../src/main/lib/headless/adapters/claude-code"
    )
    const { runCodexHeadlessTask } = await import(
      "../src/main/lib/headless/adapters/codex"
    )
    const observed: Json[] = []
    const expected: Json[] = []
    for (const hostCase of fixture.hosts) {
      for (const runtime of RUNTIMES) {
        const built = await settle(() =>
          buildRecordingCatalog({
            // Batch routes delegate to the real leaves (argv recorded at the
            // process seam); every rich route gets a recording canned leaf.
            delegates: (row) =>
              row.executionSurface !== fixture.batchExecutionSurface
                ? cannedHeadlessDelegate("rich")
                : row.runtimeId === "codex"
                  ? runCodexHeadlessTask
                  : runClaudeCodeHeadlessTask,
          }),
        )
        expect(built.ok ? "test catalog built" : built.error).toBe(
          "test catalog built",
        )
        if (!built.ok) return
        const catalog: RecordingCatalog = built.value
        const profile = newProfile()
        const prompt = `S14 catalog ${hostCase.host} ${runtime}`
        const started = await startThroughHost({
          profile,
          host: hostCase.host,
          runtime,
          prompt,
          catalogExtra: { runtimeRouteCatalog: catalog.state },
        })
        const expectation = fixture.runtimes[runtime]
        const values = runtimeValues(profile, prompt)
        observed.push({
          host: hostCase.host,
          runtime,
          exitCode: started.exitCode,
          postBindingLookups: catalog.lookups.filter(
            (lookup) =>
              lookup.runtimeId === runtime &&
              lookup.executionSurface === fixture.batchExecutionSurface,
          ).length,
          richLookups: catalog.lookups.filter((lookup) =>
            fixture.richExecutionSurfaces.includes(lookup.executionSurface),
          ),
          invocations: catalog.invocations.map((invocation) => ({
            runtimeId: invocation.runtimeId,
            executionSurface: invocation.executionSurface,
            jobId: invocation.jobId,
            source: invocation.source,
            executionProfile: invocation.executionProfile,
          })),
          leafArgs: processCalls
            .filter((call) => call.jobId === started.jobId)
            .map((call) => [call.args, call.cancellationPort]),
        })
        expected.push({
          host: hostCase.host,
          runtime,
          exitCode: 0,
          postBindingLookups: 1,
          richLookups: [],
          invocations: [
            {
              runtimeId: runtime,
              executionSurface: fixture.batchExecutionSurface,
              jobId: started.jobId,
              source: hostCase.source,
              executionProfile: "batch",
            },
          ],
          leafArgs: [
            [
              render(expectation.argsByMode[hostCase.mode], values),
              "abort-signal",
            ],
          ],
        })
      }
    }
    expect(observed).toEqual(expected)
  }, 60_000)
})

function recordingObserver() {
  const events: { type: string; payload: Json }[] = []
  const observer: AgentRuntimeObserver = {
    appendEvent(type, payload) {
      events.push({ type, payload: isJson(payload) ? payload : {} })
    },
    heartbeat() {
      return undefined as unknown as ReturnType<
        AgentRuntimeObserver["heartbeat"]
      >
    },
    isCancelRequested: () => false,
    registerSecretHints: () => {},
  }
  return { events, observer }
}

async function s15Request(
  input: S15Case["input"],
  cwd: string,
): Promise<AgentRuntimeRunRequest> {
  const { createAgentRuntimeRunRequest } = await import(
    "../src/main/lib/headless/agent-runtime-contract"
  )
  return createAgentRuntimeRunRequest({
    ...input,
    cwd,
    signal: new AbortController().signal,
  })
}

type RunAgentTaskWithOptions = (
  request: AgentRuntimeRunRequest,
  observer: AgentRuntimeObserver,
  options?: Json,
) => Promise<AgentRuntimeRunResult>

function statusOf(
  events: { type: string; payload: Json }[],
  keys: string[],
): Json[] {
  return events
    .filter((event) => event.type === "status")
    .map((event) => pick(event.payload, keys))
}

describe("S15 Rich adapter is not silently selected", () => {
  test("S15 Rich adapter is not silently selected — baseline runAgentTask runs only the batch leaf for batch requests and refuses interactive-only / guarded-scope requests with the original diagnostic before any leaf start", async () => {
    const fixture = fixtureKey<S15Fixture>("headless.json", "S15")
    const profile = newProfile()
    const { runAgentTask } = await import(
      "../src/main/lib/headless/agent-runtime"
    )
    const observed: Json[] = []
    const expected: Json[] = []
    for (const entry of fixture.requests) {
      processCalls.length = 0
      const { events, observer } = recordingObserver()
      const result = await runAgentTask(
        await s15Request(entry.input, profile.cwd),
        observer,
      )
      const keys =
        entry.expect.outcome === "selected"
          ? fixture.runtimeSelectedKeys
          : fixture.runtimeSelectionRefusedKeys
      observed.push({
        caseId: entry.caseId,
        status: statusOf(events, keys),
        result:
          entry.expect.outcome === "refused"
            ? pick(result as Json, [
                "status",
                "exitCode",
                "errorCode",
                "errorMessage",
              ])
            : result.status,
        leafArgs: processCalls.map((call) => call.args),
      })
      expected.push({
        caseId: entry.caseId,
        status: [entry.expect.status],
        result:
          entry.expect.outcome === "refused"
            ? entry.expect.result
            : "succeeded",
        leafArgs:
          entry.expect.outcome === "selected"
            ? [render(entry.expect.baselineArgs, { CWD: profile.cwd })]
            : [],
      })
    }
    expect(observed).toEqual(expected)
  })

  test("S15 Rich adapter is not silently selected — runAgentTask with a runtimeRouteCatalog holding batch and rich factories invokes only the batch delegate for batch requests and no delegate, no rich lookup and no native leaf start for interactive-only / guarded-scope requests", async () => {
    // Enforces once runtime-route-catalog.ts exists and runAgentTask accepts
    // the third options argument { runtimeRouteCatalog } (design D1).
    const fixture = fixtureKey<S15Fixture>("headless.json", "S15")
    const profile = newProfile()
    const { runAgentTask } = await import(
      "../src/main/lib/headless/agent-runtime"
    )
    const runWithOptions = runAgentTask as unknown as RunAgentTaskWithOptions
    const observed: Json[] = []
    const expected: Json[] = []
    for (const entry of fixture.requests) {
      processCalls.length = 0
      const built = await settle(() =>
        buildRecordingCatalog({ delegates: cannedDelegates() }),
      )
      expect(built.ok ? "test catalog built" : built.error).toBe(
        "test catalog built",
      )
      if (!built.ok) return
      const catalog = built.value
      const { events, observer } = recordingObserver()
      const result = await runWithOptions(
        await s15Request(entry.input, profile.cwd),
        observer,
        { runtimeRouteCatalog: catalog.state },
      )
      const selected = entry.expect.outcome === "selected"
      observed.push({
        caseId: entry.caseId,
        invokedRoutes: catalog.invocations.map((call) => [
          call.runtimeId,
          call.executionSurface,
        ]),
        richLookups: catalog.lookups.filter((lookup) =>
          fixture.richExecutionSurfaces.includes(lookup.executionSurface),
        ),
        nativeLeafStarts: processCalls.length,
        status: statusOf(
          events,
          selected
            ? fixture.runtimeSelectedKeys
            : fixture.runtimeSelectionRefusedKeys,
        ),
        resultStatus: result.status,
        errorCode: result.errorCode ?? null,
      })
      expected.push({
        caseId: entry.caseId,
        invokedRoutes: selected
          ? [[entry.input.runtime, entry.expect.executionSurface]]
          : [],
        richLookups: [],
        nativeLeafStarts: 0,
        status: [entry.expect.status],
        resultStatus: selected ? "succeeded" : "failed",
        errorCode: selected ? null : (entry.expect.result?.errorCode ?? null),
      })
    }
    expect(observed).toEqual(expected)
  })
})
