/** biome-ignore-all lint/suspicious/noExplicitAny: the async-submit executor contract under test does not exist yet; envelopes, rows and future ports are asserted structurally. */
/**
 * Independent RED acceptance suite — executor / durability domain of
 * `openspec/changes/add-local-job-api-async-submit` (Owner APPROVED
 * 2026-10-02): S26, S27, S28, S36, S37, S38, S39, S40 and the inherited
 * daemon scenarios S41–S46 (S43/S45 and the living parts of S42/S46 are
 * registered against existing tests, see the report).
 *
 * Authority: the scenario WHEN/THEN text of
 * specs/agent-runtime-core/spec.md and specs/headless-agent-jobs/spec.md,
 * design.md D3/D5, tasks.md §7 fixture catalog. Fixtures live under
 * tests/fixtures/local-job-api-async/executor/.
 *
 * Future seams are reached lazily inside each test (`runs submit`,
 * `runs wait`, `pumpQueuedRuns`, `readRunPublicationReadiness`,
 * `cleanupExpiredAgentJobIdempotency`, the reservation table); none is
 * imported at file load.
 */
import { afterEach, describe, expect, test } from "bun:test"
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import net from "node:net"
import { join } from "node:path"
import {
  admitRunDirArtifacts,
  describeRunArtifactFile,
  writeRunArtifactFile,
} from "../src/main/lib/agent-runtime/run-artifacts"
import {
  getOrCreateRunEventLedger,
  releaseRunEventLedger,
} from "../src/main/lib/agent-runtime/run-event-ledger-host"
import {
  acquireDaemonLock,
  runLocalAgentDaemon,
} from "../src/main/lib/headless/daemon"
import {
  createAgentJob,
  getAgentJob,
  listQueuedAgentJobsForSource,
  startAgentJob,
} from "../src/main/lib/headless/job-store"
import {
  closeLocalJobApiArtifactRunDir,
  prepareLocalJobApiArtifactRunDir,
} from "../src/main/lib/headless/local-job-api"
import {
  agentRequest,
  childEnv,
  cli,
  completedPayload,
  completionFetchRecorder,
  completionRequest,
  createExecutorProfile,
  dirListing,
  type ExecutorProfile,
  eventRows,
  eventsOfType,
  fixtureCase,
  jobRow,
  jobRows,
  parseOnlyJson,
  pollUntil,
  providerCallLog,
  realDelay,
  recordingRunner,
  reservationRows,
  seedProviderProfile,
  sha256File,
  spawnRole,
  storedMs,
  submit,
  within,
} from "./local-job-api-async-executor-kit"
import { settledResult } from "./run-event-ledger-domain-b-kit"

const LONG = 120_000
const profiles: ExecutorProfile[] = []

function newProfile(): ExecutorProfile {
  const profile = createExecutorProfile()
  profiles.push(profile)
  return profile
}

afterEach(() => {
  for (const profile of profiles.splice(0)) profile.cleanup()
})

function waitArgs(jobId: string, timeout = "0"): string[] {
  return ["api", "runs", "wait", jobId, "--timeout", timeout, "--json"]
}

async function waitOnce(
  db: any,
  jobId: string,
  options: Parameters<typeof cli>[2] = {},
): Promise<{ code: number; stdout: string; stderr: string; envelope: any }> {
  const result = await cli(db, waitArgs(String(jobId)), options)
  return { ...result, envelope: parseOnlyJson(result.stdout) }
}

function setCreatedAtMs(sqlite: any, jobId: string, ms: number): void {
  sqlite
    .query("UPDATE agent_jobs SET created_at = ? WHERE id = ?")
    .run(Math.floor(ms / 1000), jobId)
}

function eventShape(sqlite: any, jobId: string): string {
  return JSON.stringify(
    eventRows(sqlite, jobId).map((row) => [
      row.sequence,
      row.type,
      row.fact_key,
    ]),
  )
}

function runDirOf(project: { artifactBaseDir: string }, jobId: string): string {
  return join(project.artifactBaseDir, jobId)
}

function fileHashes(dir: string): Record<string, string> {
  const hashes: Record<string, string> = {}
  for (const name of dirListing(dir)) {
    const path = join(dir, name)
    if (lstatSync(path).isFile()) hashes[name] = sha256File(path)
  }
  return hashes
}

async function readinessOf(db: any, jobId: string): Promise<unknown> {
  const host: any = await import(
    "../src/main/lib/agent-runtime/run-event-ledger-host"
  )
  if (typeof host.readRunPublicationReadiness !== "function") {
    return "readRunPublicationReadiness-absent"
  }
  const value = await host.readRunPublicationReadiness(db, jobId)
  return Boolean(value?.ready)
}

const LOCAL_ONLY_KEYS = [
  "LOCUS_LOCAL_ONLY",
  "AGENT_CODE_FOR_ME_LOCAL_ONLY",
  "ONECODE_LOCAL_ONLY",
  "MAIN_VITE_LOCAL_ONLY",
] as const

async function withDefaultLocalOnly<T>(run: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(
    LOCAL_ONLY_KEYS.map((key) => [key, process.env[key]]),
  )
  for (const key of LOCAL_ONLY_KEYS) delete process.env[key]
  try {
    return await run()
  } finally {
    for (const key of LOCAL_ONLY_KEYS) {
      const value = previous[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

// ---------------------------------------------------------------------------
// S26
// ---------------------------------------------------------------------------

describe("executor: committed admission predicate (S26)", () => {
  test(
    "S26 Queue listing and claim require the same committed facts — list and start admit only the exact ledger-v1 creation fact plus required lifecycle:initial-artifacts admission",
    async () => {
      const fx = fixtureCase("admission.json", "S26")
      const p = newProfile()
      const project = p.addProject("s26")
      const nowSeconds = Math.floor(Date.now() / 1000)
      const ids: Record<string, string> = {}
      for (const row of fx.rows) {
        const id = String(row.id)
        ids[row.name] = id
        const runDir = join(project.artifactBaseDir, id)
        if (row.kind === "store-create") {
          await createAgentJob(p.db, {
            id,
            source: "api",
            runtime: "codex",
            mode: "plan",
            cwd: project.packageDir,
            prompt: "S26 admission predicate",
            apiConsumerId: "s26-fixture",
            artifactBaseDir: row.runDir ? runDir : null,
            artifactManifestPath: row.runDir
              ? join(runDir, "artifacts.json")
              : null,
          })
          for (const [index, event] of (row.extraEvents ?? []).entries()) {
            p.sqlite
              .query(
                "INSERT INTO agent_job_events (id, job_id, sequence, type, payload_json, created_at, fact_key) VALUES (?, ?, ?, ?, '{}', ?, ?)",
              )
              .run(
                `${id}:${index + 2}`,
                id,
                index + 2,
                event.type,
                nowSeconds,
                String(event.factKey).replace("<id>", id),
              )
          }
        } else {
          p.sqlite
            .query(
              "INSERT INTO agent_jobs (id, kind, source, runtime, status, mode, cwd, prompt_preview, input_json, api_consumer_id, created_at, ledger_version) VALUES (?, 'agent', 'api', 'codex', 'queued', 'plan', ?, 'S26', '{\"prompt\":\"S26\"}', 's26-fixture', ?, ?)",
            )
            .run(id, project.packageDir, nowSeconds, row.ledgerVersion)
          for (const [index, event] of (row.events ?? []).entries()) {
            p.sqlite
              .query(
                "INSERT INTO agent_job_events (id, job_id, sequence, type, payload_json, created_at, fact_key) VALUES (?, ?, ?, ?, '{}', ?, ?)",
              )
              .run(
                `${id}:${index + 1}`,
                id,
                index + 1,
                event.type,
                nowSeconds,
                event.factKey === null
                  ? null
                  : String(event.factKey).replace("<id>", id),
              )
          }
        }
      }

      const before = Object.fromEntries(
        Object.values(ids).map((id) => [id, eventShape(p.sqlite, id)]),
      )
      const listed = listQueuedAgentJobsForSource(p.db, "api", 200)
        .map((job) => job.id)
        .sort()
      const started: Record<string, boolean> = {}
      for (const row of fx.rows) {
        const result = await settledResult(() =>
          startAgentJob(p.db, {
            jobId: ids[row.name],
            workerId: `s26-claim:${row.name}`,
            workerPid: process.pid,
          }),
        )
        started[row.name] = result.fulfilled
      }
      const refused = fx.rows.filter((row: any) => !row.eligible)
      const refusedState = Object.fromEntries(
        refused.map((row: any) => [
          row.name,
          {
            status: jobRow(p.sqlite, ids[row.name])?.status,
            eventsUnchanged:
              eventShape(p.sqlite, ids[row.name]) === before[ids[row.name]],
          },
        ]),
      )
      const valid = ids["valid-artifact-free"]
      const validCreated = eventsOfType(p.sqlite, valid, "job_created")
      const validStarted = eventsOfType(p.sqlite, valid, "job_started")

      expect(listed).toEqual([valid])
      expect(started).toEqual(
        Object.fromEntries(
          fx.rows.map((row: any) => [row.name, row.eligible === true]),
        ),
      )
      expect(refusedState).toEqual(
        Object.fromEntries(
          refused.map((row: any) => [
            row.name,
            { status: "queued", eventsUnchanged: true },
          ]),
        ),
      )
      expect(validCreated.map((row) => [row.sequence, row.fact_key])).toEqual([
        [1, `lifecycle:job-created:${valid}:0`],
      ])
      expect(validStarted).toHaveLength(1)
    },
    LONG,
  )

  test(
    "S26 Queue listing and claim require the same committed facts — the genuine initial batch admitted through the host is keyed lifecycle:initial-artifacts:<id>:0 and only then makes the run-dir job listable and claimable",
    async () => {
      const fx = fixtureCase("admission.json", "S26").genuineAdmission
      const p = newProfile()
      const project = p.addProject("s26-genuine")
      const id = String(fx.id)
      const runDir = prepareLocalJobApiArtifactRunDir(
        project.artifactBaseDir,
        id,
        project.packageDir,
      )
      if (!runDir) throw new Error("fixture run directory was not prepared")
      const job = await createAgentJob(p.db, {
        id,
        source: "api",
        runtime: "codex",
        mode: "plan",
        cwd: project.packageDir,
        prompt: "S26 genuine admission",
        apiConsumerId: "s26-fixture",
        artifactBaseDir: runDir.path,
        artifactManifestPath: join(runDir.path, "artifacts.json"),
      })
      const listedBeforeAdmission = listQueuedAgentJobsForSource(
        p.db,
        "api",
        200,
      ).map((row) => row.id)
      for (const file of fx.files) {
        writeRunArtifactFile(runDir, file.name, file.content)
      }
      const artifacts = fx.files.map((file: any) =>
        describeRunArtifactFile(file.role, runDir, file.name),
      )
      const ledger = await getOrCreateRunEventLedger(p.db, job)
      await admitRunDirArtifacts({ runId: id, runDir, artifacts, ledger })
      releaseRunEventLedger(p.db, id)
      closeLocalJobApiArtifactRunDir(runDir)

      const rows = eventRows(p.sqlite, id)
      const admissionRows = rows.filter(
        (row) => row.type === "artifact_created",
      )
      const listedAfterAdmission = listQueuedAgentJobsForSource(
        p.db,
        "api",
        200,
      ).map((row) => row.id)
      const claim = await settledResult(() =>
        startAgentJob(p.db, {
          jobId: id,
          workerId: "s26-genuine-claim",
          workerPid: process.pid,
        }),
      )
      const after = eventRows(p.sqlite, id)

      expect(listedBeforeAdmission).not.toContain(id)
      expect(admissionRows[0]?.fact_key).toBe(
        String(fx.expectedFirstFactKey).replace("<id>", id),
      )
      expect(
        admissionRows.every((row) =>
          String(row.fact_key).startsWith(`lifecycle:initial-artifacts:${id}:`),
        ),
      ).toBe(true)
      expect(admissionRows.map((row) => row.sequence)).toEqual(
        admissionRows.map((_, index) => 2 + index),
      )
      expect(listedAfterAdmission).toEqual([id])
      expect(claim.fulfilled).toBe(true)
      expect(after.filter((row) => row.type === "job_created")).toHaveLength(1)
      expect(after.map((row) => row.sequence)).toEqual(
        after.map((_, index) => index + 1),
      )
    },
    LONG,
  )
})

// ---------------------------------------------------------------------------
// S27
// ---------------------------------------------------------------------------

describe("executor: publication observation (S27)", () => {
  // Enforces once `api runs submit`, `api runs wait` and the host's readRunPublicationReadiness exist (design D2/D5).
  test(
    "S27 Publication faults cannot be mistaken for completion — pre-commit staged, post-commit and between-rename fault points stay non-ready with run_pending or terminal_artifacts_pending and only the full final set is ready",
    async () => {
      const fx = fixtureCase("publication.json", "S27")
      const observed: any[] = []
      for (const point of fx.faultPoints) {
        const p = newProfile()
        const project = p.addProject("s27")
        const sub = await submit(
          p.db,
          agentRequest({
            project,
            consumerId: "s27-fixture",
            artifacts: true,
          }),
        )
        const jobId = sub.envelope?.job?.id
        if (!jobId) {
          observed.push({ freezeAt: point.freezeAt, submitExit: sub.code })
          continue
        }
        const worker = spawnRole(
          "daemon",
          {
            dbFile: p.dbFile,
            markerDir: p.markerDir,
            runner: "record",
            freezeAt: point.freezeAt,
          },
          childEnv(),
        )
        let exited = false
        void worker.exited.then(() => {
          exited = true
        })
        const frozenMarker = join(p.markerDir, "frozen.json")
        await pollUntil(() => existsSync(frozenMarker) || exited, 30_000)
        const reader = p.mdb.openSecondConnection()
        const wait = await waitOnce(reader.db, jobId)
        const ready = await readinessOf(reader.db, jobId)
        const row = jobRow(reader.sqlite, jobId)
        observed.push({
          freezeAt: point.freezeAt,
          submitExit: sub.code,
          frozen: point.freezeAt ? existsSync(frozenMarker) : exited,
          status: row?.status,
          completed: eventsOfType(reader.sqlite, jobId, "completed").length,
          waitExit: wait.code,
          waitReason: wait.envelope?.wait?.reason ?? null,
          waitJobStatus: wait.envelope?.job?.status,
          waitHasResult: Boolean(wait.envelope && "result" in wait.envelope),
          ready,
        })
        worker.kill(9)
        await worker.exited
      }

      expect(observed).toEqual(
        fx.faultPoints.map((point: any) => ({
          freezeAt: point.freezeAt,
          submitExit: 0,
          frozen: true,
          status: point.expect.status,
          completed: point.expect.completed,
          waitExit: point.expect.waitExit,
          waitReason: point.expect.waitReason,
          waitJobStatus: point.expect.status,
          waitHasResult: point.expect.waitExit === 0,
          ready: point.expect.ready,
        })),
      )
    },
    LONG * 2,
  )

  // Enforces once `api runs submit`, `api runs wait` and the host's readRunPublicationReadiness exist (design D2/D5).
  test(
    "S27 Publication faults cannot be mistaken for completion — a changed final digest or a run directory swapped for a symlink fails closed without touching outside files or yielding a successful wait",
    async () => {
      const fx = fixtureCase("publication.json", "S27")
      const p = newProfile()
      const project = p.addProject("s27-tamper")
      const digestSub = await submit(
        p.db,
        agentRequest({ project, consumerId: "s27-digest", artifacts: true }),
      )
      const symlinkSub = await submit(
        p.db,
        agentRequest({ project, consumerId: "s27-symlink", artifacts: true }),
      )
      const digestId = String(digestSub.envelope?.job?.id)
      const symlinkId = String(symlinkSub.envelope?.job?.id)
      const worker = spawnRole(
        "daemon",
        { dbFile: p.dbFile, markerDir: p.markerDir, runner: "record" },
        childEnv(),
      )
      await within(worker.exited, 60_000)
      const baseline = {
        digest: (await waitOnce(p.db, digestId)).code,
        symlink: (await waitOnce(p.db, symlinkId)).code,
      }

      const digestDir = runDirOf(project, digestId)
      if (existsSync(join(digestDir, "result.json"))) {
        appendFileSync(join(digestDir, "result.json"), " ")
      }
      const symlinkDir = runDirOf(project, symlinkId)
      const outside = join(p.root, "outside-s27", symlinkId)
      mkdirSync(join(p.root, "outside-s27"), { recursive: true })
      if (existsSync(symlinkDir)) {
        renameSync(symlinkDir, outside)
        symlinkSync(outside, symlinkDir)
      }
      const outsideBefore = fileHashes(outside)

      const digestWait = await waitOnce(p.db, digestId)
      const symlinkWait = await waitOnce(p.db, symlinkId)
      const observed = {
        digest: {
          exit: digestWait.code,
          reason: digestWait.envelope?.wait?.reason ?? null,
          status: digestWait.envelope?.job?.status ?? null,
          hasResult: Boolean(digestWait.envelope?.result),
          ready: await readinessOf(p.db, digestId),
          completed: eventsOfType(p.sqlite, digestId, "completed").length,
        },
        symlink: {
          exit: symlinkWait.code,
          reason: symlinkWait.envelope?.wait?.reason ?? null,
          status: symlinkWait.envelope?.job?.status ?? null,
          hasResult: Boolean(symlinkWait.envelope?.result),
          ready: await readinessOf(p.db, symlinkId),
          completed: eventsOfType(p.sqlite, symlinkId, "completed").length,
          outsideUnchanged:
            JSON.stringify(fileHashes(outside)) ===
            JSON.stringify(outsideBefore),
        },
      }
      const pending = {
        exit: 9,
        reason: "terminal_artifacts_pending",
        status: "succeeded",
        hasResult: false,
        ready: false,
        completed: 1,
      }

      expect(fx.tamper.map((entry: any) => entry.name)).toEqual([
        "result-digest-changed",
        "run-dir-swapped-for-symlink",
      ])
      expect([digestSub.code, symlinkSub.code]).toEqual([0, 0])
      expect(baseline).toEqual({ digest: 0, symlink: 0 })
      expect(observed).toEqual({
        digest: pending,
        symlink: { ...pending, outsideUnchanged: true },
      })
    },
    LONG,
  )
})

// ---------------------------------------------------------------------------
// S28
// ---------------------------------------------------------------------------

async function seedQueueRows(
  p: ExecutorProfile,
  rows: any[],
  options: { apiArtifacts: boolean },
): Promise<{ ids: Record<string, string>; submitExits: number[] }> {
  const project = p.addProject("queue")
  seedProviderProfile(p, { id: "s28-completion", targets: ["codex"] })
  const ids: Record<string, string> = {}
  const submitExits: number[] = []
  const nowMs = Date.now()
  for (const row of rows) {
    if (row.source === "api") {
      const request =
        row.kind === "completion"
          ? completionRequest({
              consumerId: `s28-${row.name}`,
              profileId: "s28-completion",
            })
          : agentRequest({
              project,
              consumerId: `s28-${row.name}`,
              artifacts: options.apiArtifacts && row.artifacts === true,
            })
      const sub = await submit(p.db, request)
      submitExits.push(sub.code)
      ids[row.name] = String(sub.envelope?.job?.id)
    } else {
      const job = await createAgentJob(p.db, {
        source: row.source,
        runtime: row.runtime ?? "codex",
        mode: "plan",
        cwd: project.packageDir,
        prompt: `S28 ${row.name}`,
        projectId: project.id,
      })
      ids[row.name] = job.id
    }
    if (typeof row.createdAtOffsetMs === "number") {
      setCreatedAtMs(p.sqlite, ids[row.name], nowMs + row.createdAtOffsetMs)
    }
  }
  return { ids, submitExits }
}

describe("executor: daemon queue (S28, S42)", () => {
  // Enforces once `api runs submit` exists and the daemon claims admitted source=api Runs (design D1/D5).
  test(
    "S28 Daemon executes API work once and preserves source exclusions — one concurrency-1 daemon pass dispatches daemon, then schedule, then API agent/completion exactly once and leaves desktop/CLI/protocol queued",
    async () => {
      const fx = fixtureCase("queue.json", "S28")
      const p = newProfile()
      const { ids, submitExits } = await seedQueueRows(p, fx.rows, {
        apiArtifacts: true,
      })
      const log: string[] = []
      const recorder = recordingRunner(log)
      const fetcher = completionFetchRecorder(log)
      const run = await within(
        runLocalAgentDaemon({
          db: p.db,
          lockPath: join(p.root, "daemon.lock"),
          once: true,
          concurrency: 1,
          pollIntervalMs: 100,
          runner: recorder.runner,
          completionFetch: fetcher.fetch,
          appVersion: "0.0.executor-red",
        } as any),
        60_000,
      )
      const sourceOf = (entry: string) => {
        if (entry.startsWith("completion:")) return "api"
        const id = entry.slice("runner:".length)
        const name = Object.keys(ids).find((key) => ids[key] === id)
        return fx.rows.find((row: any) => row.name === name)?.source ?? id
      }
      const dispatchedSources = log.map(sourceOf)
      const eligible = fx.rows.filter((row: any) => row.eligible)
      const excluded = fx.rows.filter((row: any) => !row.eligible)
      const startedCounts = Object.fromEntries(
        eligible.map((row: any) => [
          row.name,
          eventsOfType(p.sqlite, ids[row.name], "job_started").length,
        ]),
      )
      const excludedState = Object.fromEntries(
        excluded.map((row: any) => [
          row.name,
          [
            jobRow(p.sqlite, ids[row.name])?.status,
            eventsOfType(p.sqlite, ids[row.name], "job_started").length,
          ],
        ]),
      )
      const agentWait = await waitOnce(p.db, ids["api-agent"])

      expect(submitExits).toEqual([0, 0])
      expect(run.settled).toBe(true)
      expect(dispatchedSources).toEqual(["daemon", "schedule", "api", "api"])
      expect(
        recorder.calls.filter((id) => id === ids["api-agent"]),
      ).toHaveLength(1)
      expect(fetcher.calls).toHaveLength(1)
      expect(startedCounts).toEqual(
        Object.fromEntries(eligible.map((row: any) => [row.name, 1])),
      )
      expect(excludedState).toEqual(
        Object.fromEntries(
          excluded.map((row: any) => [row.name, ["queued", 0]]),
        ),
      )
      expect(agentWait.code).toBe(0)
      expect(
        (agentWait.envelope?.result?.artifacts ?? []).map(
          (ref: any) => ref.role,
        ),
      ).toEqual(fx.expectedPrepareTailRoles)
    },
    LONG,
  )

  // Enforces once `api runs submit` and pumpQueuedRuns exist: the canonical
  // scoped pump in headless/daemon.ts (design D1/D5) shared by daemon,
  // stdio and wrapper.
  test(
    "S28 Daemon executes API work once and preserves source exclusions — two direct pumpQueuedRuns instances on independent connections race claim; every eligible Run dispatches once and each pump stays within concurrency 1",
    async () => {
      const fx = fixtureCase("queue.json", "S28")
      const p = newProfile()
      const { ids, submitExits } = await seedQueueRows(p, fx.rows, {
        apiArtifacts: false,
      })
      const daemonModule: any = await import("../src/main/lib/headless/daemon")
      const pump = daemonModule.pumpQueuedRuns
      const connA = p.db
      const connB = p.mdb.openSecondConnection().db
      const makePorts = (tag: string) => {
        let active = 0
        let maxActive = 0
        const calls: string[] = []
        const enter = async (id: string) => {
          active += 1
          maxActive = Math.max(maxActive, active)
          calls.push(id)
          await realDelay(40)
          active -= 1
        }
        return {
          calls,
          maxActive: () => maxActive,
          runner: async (request: any, observer: any) => {
            observer.appendEvent("assistant_delta", { text: tag })
            await enter(String(request.identity.jobId))
            return {
              status: "succeeded",
              exitCode: 0,
              result: { finalMessage: `${tag} done` },
            }
          },
          fetch: async () => {
            await enter("completion")
            return new Response(
              JSON.stringify({
                output_text: "done",
                usage: { input_tokens: 1, output_tokens: 1 },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            )
          },
        }
      }
      const portsA = makePorts("pump-a")
      const portsB = makePorts("pump-b")
      const eligible = fx.rows.filter((row: any) => row.eligible)
      const excluded = fx.rows.filter((row: any) => !row.eligible)
      const allTerminal = () =>
        eligible.every((row: any) =>
          ["succeeded", "failed", "canceled", "interrupted"].includes(
            jobRow(p.sqlite, ids[row.name])?.status,
          ),
        )
      let rounds = 0
      if (typeof pump === "function") {
        while (!allTerminal() && rounds < 10) {
          rounds += 1
          await within(
            Promise.all([
              pump({
                db: connA,
                concurrency: fx.pumpConcurrency,
                runner: portsA.runner,
                completionFetch: portsA.fetch,
                appVersion: "0.0.executor-red",
              }),
              pump({
                db: connB,
                concurrency: fx.pumpConcurrency,
                runner: portsB.runner,
                completionFetch: portsB.fetch,
                appVersion: "0.0.executor-red",
              }),
            ]),
            30_000,
          )
        }
      }
      const agentDispatches = Object.fromEntries(
        eligible
          .filter((row: any) => row.kind !== "completion")
          .map((row: any) => [
            row.name,
            [...portsA.calls, ...portsB.calls].filter(
              (id) => id === ids[row.name],
            ).length,
          ]),
      )
      const completionDispatches = [...portsA.calls, ...portsB.calls].filter(
        (id) => id === "completion",
      ).length
      const startedCounts = Object.fromEntries(
        eligible.map((row: any) => [
          row.name,
          eventsOfType(p.sqlite, ids[row.name], "job_started").length,
        ]),
      )
      const excludedState = Object.fromEntries(
        excluded.map((row: any) => [
          row.name,
          jobRow(p.sqlite, ids[row.name])?.status,
        ]),
      )

      expect(typeof pump).toBe("function")
      expect(submitExits).toEqual([0, 0])
      expect(allTerminal()).toBe(true)
      expect(agentDispatches).toEqual(
        Object.fromEntries(
          eligible
            .filter((row: any) => row.kind !== "completion")
            .map((row: any) => [row.name, 1]),
        ),
      )
      expect(completionDispatches).toBe(1)
      expect(startedCounts).toEqual(
        Object.fromEntries(eligible.map((row: any) => [row.name, 1])),
      )
      expect([portsA.maxActive() <= 1, portsB.maxActive() <= 1]).toEqual([
        true,
        true,
      ])
      expect(excludedState).toEqual(
        Object.fromEntries(excluded.map((row: any) => [row.name, "queued"])),
      )
    },
    LONG,
  )

  test(
    "S28 Daemon executes API work once and preserves source exclusions — only one real daemon lock acquisition succeeds and a stale-nonce release never unlinks its successor",
    async () => {
      const p = newProfile()
      const lockPath = join(p.root, "agent-daemon.lock")
      const abort = new AbortController()
      const first = runLocalAgentDaemon({
        db: p.db,
        lockPath,
        pollIntervalMs: 100,
        signal: abort.signal,
      })
      await pollUntil(() => existsSync(lockPath), 5_000)
      const holder = readFileSync(lockPath, "utf8")
      const second = await settledResult(() =>
        runLocalAgentDaemon({ db: p.db, lockPath, once: true }),
      )
      const holderAfterSecond = readFileSync(lockPath, "utf8")
      abort.abort()
      await first
      const releasedAfterStop = existsSync(lockPath)

      const stale = acquireDaemonLock(lockPath)
      const successor = JSON.stringify({
        pid: process.pid,
        nonce: "successor-nonce",
        startedAt: new Date().toISOString(),
      })
      writeFileSync(lockPath, successor)
      stale.release()
      const successorSurvives = existsSync(lockPath)
        ? readFileSync(lockPath, "utf8")
        : null

      expect(second.fulfilled).toBe(false)
      expect(holderAfterSecond).toBe(holder)
      expect(releasedAfterStop).toBe(false)
      expect(successorSurvives).toBe(successor)
    },
    LONG,
  )

  // Enforces once `api runs submit` exists and the daemon claims admitted source=api Runs (MODIFIED S42 line).
  test(
    "S42 Daemon claims queued daemon jobs — the daemon additionally claims an admitted source=api job through the same pump while an unadmitted API row and protocol work stay unclaimed",
    async () => {
      const fx = fixtureCase("queue.json", "S42")
      const p = newProfile()
      const project = p.addProject("s42")
      const daemonJob = await createAgentJob(p.db, {
        source: "daemon",
        runtime: "codex",
        mode: "plan",
        cwd: project.packageDir,
        prompt: "S42 daemon",
        projectId: project.id,
      })
      const protocolJob = await createAgentJob(p.db, {
        source: "protocol",
        runtime: "codex",
        mode: "plan",
        cwd: project.packageDir,
        prompt: "S42 protocol",
      })
      const admitted = await submit(
        p.db,
        agentRequest({ project, consumerId: "s42-admitted" }),
      )
      const orphanId = "s42unadmittedorphan"
      p.sqlite
        .query(
          "INSERT INTO agent_jobs (id, kind, source, runtime, status, mode, cwd, prompt_preview, input_json, api_consumer_id, created_at, ledger_version) VALUES (?, 'agent', 'api', 'codex', 'queued', 'plan', ?, 'S42', '{\"prompt\":\"S42\"}', 's42-orphan', ?, 1)",
        )
        .run(orphanId, project.packageDir, Math.floor(Date.now() / 1000))
      const recorder = recordingRunner()
      await within(
        runLocalAgentDaemon({
          db: p.db,
          lockPath: join(p.root, "daemon.lock"),
          once: true,
          pollIntervalMs: 100,
          runner: recorder.runner,
        }),
        60_000,
      )
      const byName: Record<string, string> = {
        daemon: daemonJob.id,
        "api-admitted": String(admitted.envelope?.job?.id),
        "api-unadmitted-orphan": orphanId,
        protocol: protocolJob.id,
      }
      const claimed = Object.fromEntries(
        fx.rows.map((row: any) => [
          row.name,
          recorder.calls.includes(byName[row.name]),
        ]),
      )

      expect(admitted.code).toBe(0)
      expect(claimed).toEqual(
        Object.fromEntries(fx.rows.map((row: any) => [row.name, row.eligible])),
      )
      expect(eventRows(p.sqlite, orphanId)).toEqual([])
      expect(jobRow(p.sqlite, orphanId)?.status).toBe("queued")
      expect(jobRow(p.sqlite, protocolJob.id)?.status).toBe("queued")
    },
    LONG,
  )
})

// ---------------------------------------------------------------------------
// S36
// ---------------------------------------------------------------------------

describe("executor: daemon death recovery (S36)", () => {
  // Enforces once keyed `api runs submit`, `api runs wait` and the agent_job_idempotency reservation exist (design D2/D4/D5).
  test(
    "S36 Daemon death recovers to a readable interrupted result — a killed daemon worker settles once as interrupted/worker_stopped and wait returns exit 1 with result.artifacts [] and retention from settlement",
    async () => {
      const fx = fixtureCase("publication.json", "S36")
      const p = newProfile()
      const project = p.addProject("s36")
      const sub = await submit(
        p.db,
        agentRequest({
          project,
          consumerId: "s36-fixture",
          artifacts: true,
          idempotencyKey: fx.idempotencyKey,
        }),
      )
      const jobId = String(sub.envelope?.job?.id)
      const runDir = runDirOf(project, jobId)
      const initialHashes = fileHashes(runDir)
      const worker = spawnRole(
        "daemon",
        { dbFile: p.dbFile, markerDir: p.markerDir, runner: "block" },
        childEnv(),
      )
      let exited = false
      void worker.exited.then(() => {
        exited = true
      })
      const startedMarker = join(p.markerDir, `started-${jobId}`)
      const started = await pollUntil(
        () => existsSync(startedMarker) || exited,
        30_000,
      )
      const claimedRow = jobRow(p.sqlite, jobId)
      worker.kill(9)
      await worker.exited
      const heartbeatMs = storedMs(claimedRow?.heartbeat_at) ?? Date.now()
      const now = new Date(
        Math.max(Date.now(), heartbeatMs) + Number(fx.staleBeyondMs),
      )
      const reader = p.mdb.openSecondConnection()
      const first = await waitOnce(reader.db, jobId, { now })
      const second = await waitOnce(reader.db, jobId, { now })
      const row = jobRow(p.sqlite, jobId)
      const completed = eventsOfType(p.sqlite, jobId, "completed")
      const payload = completedPayload(p.sqlite, jobId)
      const initialAdmission = eventsOfType(
        p.sqlite,
        jobId,
        "artifact_created",
      ).filter((event) =>
        String(event.fact_key).startsWith(
          `lifecycle:initial-artifacts:${jobId}:`,
        ),
      )
      const reservations = reservationRows(p.sqlite, jobId)
      const expiresMs = storedMs(reservations[0]?.expires_at)
      const finishedMs = storedMs(row?.finished_at) ?? 0
      const retentionWindowOk =
        expiresMs !== null &&
        expiresMs >= finishedMs + fx.expect.retentionMs - 2_000 &&
        expiresMs <=
          Math.max(finishedMs, now.getTime()) + fx.expect.retentionMs + 2_000

      expect(sub.code).toBe(0)
      expect(started && existsSync(startedMarker)).toBe(true)
      expect([claimedRow?.status, claimedRow?.worker_pid]).toEqual([
        "running",
        worker.proc.pid,
      ])
      expect(first.code).toBe(fx.expect.waitExit)
      expect(first.envelope?.job?.status).toBe(fx.expect.status)
      expect(first.envelope?.result?.artifacts).toEqual(
        fx.expect.resultArtifacts,
      )
      expect(first.envelope).not.toHaveProperty("wait")
      expect(second.stdout).toBe(first.stdout)
      expect(completed).toHaveLength(1)
      expect(payload?.status).toBe(fx.expect.status)
      expect(payload?.reasons).toContain(fx.expect.completedReason)
      expect(row?.error_code).toBe(fx.expect.errorCode)
      expect(fileHashes(runDir)).toEqual(initialHashes)
      expect(dirListing(runDir)).not.toContain("result.json")
      expect(initialAdmission.length).toBeGreaterThan(0)
      expect(reservations).toHaveLength(1)
      expect(retentionWindowOk).toBe(true)
    },
    LONG,
  )

  // Enforces once `api runs submit` and `api runs wait` exist (design D2/D5).
  test(
    "S36 Daemon death recovers to a readable interrupted result — a stale heartbeat whose worker is alive or EPERM stays running with no false recovery and wait reports run_pending",
    async () => {
      const fx = fixtureCase("publication.json", "S36")
      const p = newProfile()
      const project = p.addProject("s36-live")
      const sub = await submit(
        p.db,
        agentRequest({ project, consumerId: "s36-live", artifacts: true }),
      )
      const jobId = String(sub.envelope?.job?.id)
      const worker = spawnRole(
        "daemon",
        { dbFile: p.dbFile, markerDir: p.markerDir, runner: "block" },
        childEnv(),
      )
      let exited = false
      void worker.exited.then(() => {
        exited = true
      })
      await pollUntil(
        () => existsSync(join(p.markerDir, `started-${jobId}`)) || exited,
        30_000,
      )
      const heartbeatMs =
        storedMs(jobRow(p.sqlite, jobId)?.heartbeat_at) ?? Date.now()
      const now = new Date(
        Math.max(Date.now(), heartbeatMs) + Number(fx.staleBeyondMs),
      )
      const observed: any[] = []
      for (const variant of fx.liveVariants) {
        if (typeof variant.workerPid === "number") {
          p.sqlite
            .query("UPDATE agent_jobs SET worker_pid = ? WHERE id = ?")
            .run(variant.workerPid, jobId)
        }
        const wait = await waitOnce(p.db, jobId, { now })
        observed.push({
          name: variant.name,
          status: jobRow(p.sqlite, jobId)?.status,
          completed: eventsOfType(p.sqlite, jobId, "completed").length,
          waitExit: wait.code,
          waitReason: wait.envelope?.wait?.reason ?? null,
        })
      }
      worker.kill(9)
      await worker.exited

      expect(sub.code).toBe(0)
      expect(observed).toEqual(
        fx.liveVariants.map((variant: any) => ({
          name: variant.name,
          status: "running",
          completed: 0,
          waitExit: 9,
          waitReason: "run_pending",
        })),
      )
    },
    LONG,
  )
})

// ---------------------------------------------------------------------------
// S37
// ---------------------------------------------------------------------------

describe("executor: cross-process reopen and publication (S37)", () => {
  // Enforces once `api runs submit`, `api runs wait` and run-artifacts reopenAdmittedRunDir exist (design D5).
  test(
    "S37 Submit in one process and publish in another — process A submits and exits, process B reopens/executes/publishes and process C waits ready with the golden prepared tail and no dev/ino/env leakage",
    async () => {
      const fx = fixtureCase("publication.json", "S37")
      const p = newProfile()
      const project = p.addProject("s37")
      const sentinelEnv = { LOCUS_S37_SENTINEL: fx.processEnvSentinel }
      const a = spawnRole(
        "cli",
        {
          dbFile: p.dbFile,
          markerDir: p.markerDir,
          argv: ["api", "runs", "submit", "--request", "-", "--json"],
          stdinText: JSON.stringify(
            agentRequest({
              project,
              consumerId: "s37-fixture",
              artifacts: true,
            }),
          ),
          runner: "record",
        },
        childEnv(sentinelEnv),
      )
      await within(a.exited, 60_000)
      const aResult = await a.result()
      const ack = parseOnlyJson(aResult?.stdout ?? "")
      const jobId = String(ack?.job?.id)
      const runDir = runDirOf(project, jobId)
      const requestHashBefore = existsSync(join(runDir, "request.json"))
        ? sha256File(join(runDir, "request.json"))
        : null
      const b = spawnRole(
        "daemon",
        { dbFile: p.dbFile, markerDir: p.markerDir, runner: "record" },
        childEnv(sentinelEnv),
      )
      await within(b.exited, 60_000)
      const c = spawnRole(
        "cli",
        {
          dbFile: p.dbFile,
          markerDir: p.markerDir,
          argv: waitArgs(jobId, "5000"),
        },
        childEnv(sentinelEnv),
      )
      await within(c.exited, 60_000)
      const cResult = await c.result()
      const ready = parseOnlyJson(cResult?.stdout ?? "")
      const refs: any[] = ready?.result?.artifacts ?? []
      const row = jobRow(p.sqlite, jobId)
      const calls = providerCallLog(p.markerDir).filter((line) =>
        line.startsWith(`${jobId} `),
      )
      const finalEvents = existsSync(join(runDir, "events.jsonl"))
        ? readFileSync(join(runDir, "events.jsonl"), "utf8")
        : ""

      expect(aResult?.code).toBe(0)
      expect(ack?.job?.status).toBe("queued")
      expect(ack).not.toHaveProperty("result")
      expect(calls).toEqual([`${jobId} pid=${b.proc.pid}`])
      expect(row?.worker_pid).toBe(b.proc.pid)
      expect(cResult?.code).toBe(0)
      expect(ready?.result?.status).toBe("succeeded")
      expect(refs.map((ref) => ref.role)).toEqual(fx.goldenPreparedTailRoles)
      expect(refs.map((ref) => ref.path)).toEqual(
        fx.goldenPreparedTailFiles.map((name: string) => join(runDir, name)),
      )
      expect(refs.map((ref) => ref.sha256)).toEqual(
        refs.map((ref) => sha256File(String(ref.path))),
      )
      expect(refs.some((ref) => "sequence" in ref)).toBe(false)
      expect(sha256File(join(runDir, "request.json"))).toBe(
        String(requestHashBefore),
      )
      expect(finalEvents).toContain('"type":"completed"')
      expect(cResult?.stdout ?? "").not.toMatch(/"(dev|ino)"\s*:/)
      expect(cResult?.stdout ?? "").not.toContain(fx.processEnvSentinel)
    },
    LONG,
  )

  // Enforces once `api runs submit`, `api runs wait` and run-artifacts reopenAdmittedRunDir exist (design D5).
  test(
    "S37 Submit in one process and publish in another — an initial-file digest, symlink or hardlink mismatch found by the claiming process settles failed/artifact_admission_mismatch once, calls no provider and wait returns exit 1",
    async () => {
      const fx = fixtureCase("publication.json", "S37")
      const p = newProfile()
      const project = p.addProject("s37-mismatch")
      const outsideDir = join(p.root, "outside-s37")
      mkdirSync(outsideDir, { recursive: true })
      const ids: Record<string, string> = {}
      const submitExits: number[] = []
      for (const mismatch of fx.mismatches) {
        const sub = await submit(
          p.db,
          agentRequest({
            project,
            consumerId: `s37-${mismatch.name}`,
            artifacts: true,
          }),
        )
        submitExits.push(sub.code)
        ids[mismatch.name] = String(sub.envelope?.job?.id)
      }
      for (const mismatch of fx.mismatches) {
        const target = join(
          runDirOf(project, ids[mismatch.name]),
          mismatch.file,
        )
        if (!existsSync(target)) continue
        const outsideCopy = join(
          outsideDir,
          `${mismatch.name}-${mismatch.file}`,
        )
        if (mismatch.action === "rewrite-different-bytes") {
          writeFileSync(target, `${readFileSync(target, "utf8")} `)
        } else {
          copyFileSync(target, outsideCopy)
          unlinkSync(target)
          if (mismatch.action === "symlink-to-outside-copy") {
            symlinkSync(outsideCopy, target)
          } else {
            linkSync(outsideCopy, target)
          }
        }
      }
      const outsideBefore = fileHashes(outsideDir)
      const b = spawnRole(
        "daemon",
        { dbFile: p.dbFile, markerDir: p.markerDir, runner: "record" },
        childEnv(),
      )
      await within(b.exited, 60_000)
      const reader = p.mdb.openSecondConnection()
      const observed: Record<string, any> = {}
      for (const mismatch of fx.mismatches) {
        const id = ids[mismatch.name]
        const wait = await waitOnce(reader.db, id)
        observed[mismatch.name] = {
          status: jobRow(reader.sqlite, id)?.status,
          errorCode: jobRow(reader.sqlite, id)?.error_code,
          completed: eventsOfType(reader.sqlite, id, "completed").length,
          reasonPresent: (
            completedPayload(reader.sqlite, id)?.reasons ?? []
          ).includes(fx.mismatchExpect.reason),
          providerCalls: providerCallLog(p.markerDir).filter((line) =>
            line.startsWith(`${id} `),
          ).length,
          waitExit: wait.code,
          resultArtifacts: wait.envelope?.result?.artifacts ?? null,
          resultFilePublished: existsSync(
            join(runDirOf(project, id), "result.json"),
          ),
        }
      }

      expect(submitExits).toEqual(fx.mismatches.map(() => 0))
      expect(observed).toEqual(
        Object.fromEntries(
          fx.mismatches.map((mismatch: any) => [
            mismatch.name,
            {
              status: fx.mismatchExpect.status,
              errorCode: fx.mismatchExpect.errorCode,
              completed: 1,
              reasonPresent: true,
              providerCalls: fx.mismatchExpect.providerCalls,
              waitExit: fx.mismatchExpect.waitExit,
              resultArtifacts: [],
              resultFilePublished: false,
            },
          ]),
        ),
      )
      expect(fileHashes(outsideDir)).toEqual(outsideBefore)
    },
    LONG,
  )
})

// ---------------------------------------------------------------------------
// S38
// ---------------------------------------------------------------------------

async function crashAtInitialAdmission(
  p: ExecutorProfile,
  fx: any,
): Promise<{ crashed: boolean; jobId: string | null; project: any }> {
  const project = p.addProject("s38")
  const child = spawnRole(
    "cli",
    {
      dbFile: p.dbFile,
      markerDir: p.markerDir,
      argv: ["api", "runs", "submit", "--request", "-", "--json"],
      stdinText: JSON.stringify(
        agentRequest({
          project,
          consumerId: fx.consumerId,
          artifacts: true,
          idempotencyKey: fx.idempotencyKey,
        }),
      ),
      runner: "record",
      crashAt: fx.crashAt,
    },
    childEnv(),
  )
  await within(child.exited, 60_000)
  const rows = jobRows(p.sqlite, `api_consumer_id = '${fx.consumerId}'`)
  return {
    crashed: existsSync(join(p.markerDir, "crashed.json")),
    jobId: rows.length === 1 ? String(rows[0].id) : null,
    project,
  }
}

describe("executor: creation-to-admission crash boundary (S38)", () => {
  // Enforces once keyed `api runs submit`, status `execution` and `api runs wait` exist (design D3/D5).
  test(
    "S38 Crash at creation to initial admission boundary — the half-admitted Run is never listed or claimed, same-key submit is submission_pending/8 and status/wait report admission_incomplete",
    async () => {
      const fx = fixtureCase("idempotency.json", "S38")
      const p = newProfile()
      const { crashed, jobId, project } = await crashAtInitialAdmission(p, fx)
      const id = String(jobId)
      const shapeAfterCrash = eventShape(p.sqlite, id)
      const listed = listQueuedAgentJobsForSource(p.db, "api", 200).map(
        (job) => job.id,
      )
      const claim = await settledResult(() =>
        startAgentJob(p.db, {
          jobId: id,
          workerId: "s38-claim",
          workerPid: process.pid,
        }),
      )
      const recorder = recordingRunner()
      await within(
        runLocalAgentDaemon({
          db: p.db,
          lockPath: join(p.root, "daemon.lock"),
          once: true,
          pollIntervalMs: 100,
          runner: recorder.runner,
        }),
        30_000,
      )
      const replay = await submit(
        p.db,
        agentRequest({
          project,
          consumerId: fx.consumerId,
          artifacts: true,
          idempotencyKey: fx.idempotencyKey,
        }),
      )
      const status = await cli(p.db, ["api", "runs", "status", id, "--json"])
      const statusEnvelope = parseOnlyJson(status.stdout)
      const wait = await waitOnce(p.db, id)

      expect(crashed).toBe(true)
      expect(jobId).not.toBeNull()
      expect(JSON.parse(shapeAfterCrash)).toEqual([
        [1, "job_created", `lifecycle:job-created:${id}:0`],
      ])
      expect(listed).not.toContain(id)
      expect(claim.fulfilled).toBe(false)
      expect(recorder.calls).toEqual([])
      expect(replay.code).toBe(fx.expect.submitPending.exit)
      expect(replay.envelope).toEqual({
        apiVersion: "locus.local-job.v1",
        error: {
          code: fx.expect.submitPending.code,
          message: fx.expect.submitPending.message,
          retryable: fx.expect.submitPending.retryable,
        },
      })
      expect(replay.stdout + replay.stderr).not.toContain(fx.idempotencyKey)
      expect(status.code).toBe(0)
      expect(statusEnvelope?.job?.status).toBe(fx.expect.status.status)
      expect(statusEnvelope?.execution).toMatchObject(
        fx.expect.status.execution,
      )
      expect(typeof statusEnvelope?.execution?.observedAt).toBe("string")
      expect(statusEnvelope?.execution).not.toHaveProperty("hint")
      expect(wait.code).toBe(fx.expect.wait.exit)
      expect(wait.envelope?.wait).toEqual({
        state: fx.expect.wait.state,
        timeoutMs: fx.expect.wait.timeoutMs,
        reason: fx.expect.wait.reason,
      })
      expect(wait.envelope).not.toHaveProperty("result")
      expect(eventShape(p.sqlite, id)).toBe(shapeAfterCrash)
      expect(jobRow(p.sqlite, id)?.status).toBe("queued")
    },
    LONG,
  )

  // Enforces once keyed `api runs submit`, `api runs wait` and job-store's
  // cleanupExpiredAgentJobIdempotency exist (design D3/D4 named cleanup owner).
  test(
    "S38 Crash at creation to initial admission boundary — runs cancel settles one canceled terminal without terminal refs and only the named cleanup at settlement+30 days releases the reservation",
    async () => {
      const fx = fixtureCase("idempotency.json", "S38")
      const p = newProfile()
      const { crashed, jobId, project } = await crashAtInitialAdmission(p, fx)
      const id = String(jobId)
      const runDir = runDirOf(project, id)
      const listingBefore = dirListing(runDir)
      const cancel = await cli(p.db, ["api", "runs", "cancel", id, "--json"])
      const wait = await waitOnce(p.db, id)
      const row = jobRow(p.sqlite, id)
      const finishedMs = storedMs(row?.finished_at) ?? 0
      const reservations = reservationRows(p.sqlite, id)
      const expiresMs = storedMs(reservations[0]?.expires_at)
      const store: any = await import("../src/main/lib/headless/job-store")
      const cleanup = store.cleanupExpiredAgentJobIdempotency
      const historyBefore = eventShape(p.sqlite, id)
      let keptBeforeExpiry: number | null = null
      let keptAtExpiry: number | null = null
      if (typeof cleanup === "function" && expiresMs !== null) {
        await cleanup(p.db, { now: new Date(expiresMs - 1) })
        keptBeforeExpiry = reservationRows(p.sqlite, id).length
        await cleanup(p.db, { now: new Date(expiresMs) })
        keptAtExpiry = reservationRows(p.sqlite, id).length
      }

      expect(crashed).toBe(true)
      expect(cancel.code).toBe(0)
      expect(parseOnlyJson(cancel.stdout)?.job?.status).toBe("canceled")
      expect(wait.code).toBe(fx.expect.cancelWait.exit)
      expect(wait.envelope?.job?.status).toBe(fx.expect.cancelWait.status)
      expect(wait.envelope?.result?.artifacts).toEqual(
        fx.expect.cancelWait.artifacts,
      )
      expect(eventsOfType(p.sqlite, id, "completed")).toHaveLength(1)
      expect(eventsOfType(p.sqlite, id, "artifact_created")).toHaveLength(0)
      expect(dirListing(runDir)).toEqual(listingBefore)
      expect(reservations).toHaveLength(1)
      expect(expiresMs).not.toBeNull()
      expect(
        Math.abs(Number(expiresMs) - (finishedMs + fx.expect.retentionMs)),
      ).toBeLessThanOrEqual(2_000)
      expect(typeof cleanup).toBe("function")
      expect([keptBeforeExpiry, keptAtExpiry]).toEqual([1, 0])
      expect(jobRow(p.sqlite, id)?.status).toBe("canceled")
      expect(eventShape(p.sqlite, id)).toBe(historyBefore)
      expect(dirListing(runDir)).toEqual(listingBefore)
    },
    LONG,
  )
})

// ---------------------------------------------------------------------------
// S39
// ---------------------------------------------------------------------------

function bindingDependencies(fx: any) {
  const byId = Object.fromEntries(
    fx.variants
      .filter((variant: any) => variant.profileId)
      .map((variant: any) => [variant.profileId, variant.mutation]),
  )
  const officialConfig = (id: string) => ({
    id,
    name: id,
    presetId: null,
    protocol: "openai-responses",
    baseUrl: fx.officialCloudBaseUrl,
    defaultModel: "provider-default-model",
    authMode: "none",
    token: null,
    headers: {},
    targetRuntimes: ["codex"],
    capabilities: {},
  })
  return {
    getProviderProfileMetadata: (_db: any, id: string) => {
      if (byId[id] === "binding-owner-throws") {
        throw new Error("S39 fixture: provider profile store unavailable")
      }
      if (byId[id] === "binding-owner-official-cloud") {
        return { id, targetRuntimes: ["codex"] }
      }
      return null
    },
    getProviderProfileRuntimeConfig: (_db: any, id: string) => {
      if (byId[id] === "binding-owner-throws") {
        throw new Error("S39 fixture: provider profile store unavailable")
      }
      if (byId[id] === "binding-owner-official-cloud") return officialConfig(id)
      return null
    },
  }
}

describe("executor: claim-time revalidation (S39)", () => {
  // Enforces once `api runs submit` exists and the daemon claim gate revalidates project/cwd/profile/age (design D5).
  test(
    "S39 Claim revalidates project identity profile and age — each post-ack mutation settles failed once with its reason, errorCode and outcome exit (7/7/4,2,6 or 3/1) and zero provider calls while the younger control runs once",
    async () => {
      const fx = fixtureCase("admission.json", "S39")
      const p = newProfile()
      for (const variant of fx.variants) {
        if (variant.profileId) {
          seedProviderProfile(p, { id: variant.profileId, targets: ["codex"] })
        }
      }
      const ids: Record<string, string> = {}
      const submitExits: Record<string, number> = {}
      const projects: Record<string, any> = {}
      for (const variant of fx.variants) {
        const project = p.addProject(`s39-${variant.name}`)
        projects[variant.name] = project
        const sub = await submit(
          p.db,
          agentRequest({
            project,
            consumerId: `s39-${variant.name}`,
            runtime: variant.runtime,
            mode: variant.mode,
            provider: variant.profileId
              ? { profileId: variant.profileId }
              : undefined,
          }),
        )
        submitExits[variant.name] = sub.code
        ids[variant.name] = String(sub.envelope?.job?.id)
      }
      const claimAt = Math.floor(Date.now() / 1000) * 1000 + 5_000
      for (const variant of fx.variants) {
        const project = projects[variant.name]
        const id = ids[variant.name]
        if (variant.mutation === "unregister-project") {
          await cli(p.db, [
            "api",
            "projects",
            "unregister",
            "--cwd",
            project.projectRoot,
            "--force",
            "--json",
          ])
        } else if (variant.mutation === "replace-cwd-directory") {
          renameSync(project.packageDir, `${project.packageDir}-moved`)
          mkdirSync(project.packageDir)
        } else if (variant.mutation === "remove-stored-policy-grant") {
          p.sqlite
            .query(
              "UPDATE agent_jobs SET input_json = json_remove(input_json, '$.runtime.policyGrant') WHERE id = ?",
            )
            .run(id)
        } else if (variant.mutation === "created-at-now-minus-86400000") {
          setCreatedAtMs(p.sqlite, id, claimAt - fx.maxQueuedApiAgeMsDefault)
        }
      }
      const recorder = recordingRunner()
      const observed = await withDefaultLocalOnly(async () => {
        await within(
          runLocalAgentDaemon({
            db: p.db,
            lockPath: join(p.root, "daemon.lock"),
            once: true,
            concurrency: 1,
            pollIntervalMs: 100,
            runner: recorder.runner,
            now: new Date(claimAt),
            providerBindingDependencies: bindingDependencies(fx),
            appVersion: "0.0.executor-red",
          } as any),
          60_000,
        )
        const result: Record<string, any> = {}
        for (const variant of fx.variants) {
          const id = ids[variant.name]
          const row = jobRow(p.sqlite, id)
          const payload = completedPayload(p.sqlite, id)
          const wait = await waitOnce(p.db, id, { now: new Date(claimAt) })
          result[variant.name] = {
            status: row?.status,
            errorCode: row?.error_code ?? null,
            reason:
              variant.expect.reason === null
                ? null
                : (payload?.reasons ?? []).includes(variant.expect.reason)
                  ? variant.expect.reason
                  : (payload?.reasons ?? null),
            exit: wait.code,
            providerCalls: recorder.calls.filter((call) => call === id).length,
            completed: eventsOfType(p.sqlite, id, "completed").length,
          }
        }
        return result
      })
      const replacedDirEntries = readdirSync(
        projects["cwd-identity-changed"].packageDir,
      )

      expect(submitExits).toEqual(
        Object.fromEntries(
          fx.variants.map((variant: any) => [variant.name, 0]),
        ),
      )
      expect(observed).toEqual(
        Object.fromEntries(
          fx.variants.map((variant: any) => [
            variant.name,
            { ...variant.expect, completed: 1 },
          ]),
        ),
      )
      expect(replacedDirEntries).toEqual([])
    },
    LONG,
  )

  // Enforces once `api runs submit` and RunLocalAgentDaemonOptions.maxQueuedApiAgeMs exist (design D5).
  test(
    "S39 Claim revalidates project identity profile and age — injected maxQueuedApiAgeMs moves only the age threshold and never bypasses the identity gate",
    async () => {
      const fx = fixtureCase("admission.json", "S39")
      const p = newProfile()
      const ageProject = p.addProject("s39-age")
      const cwdProject = p.addProject("s39-cwd")
      const lowProject = p.addProject("s39-low")
      const ageSub = await submit(
        p.db,
        agentRequest({ project: ageProject, consumerId: "s39-age" }),
      )
      const cwdSub = await submit(
        p.db,
        agentRequest({ project: cwdProject, consumerId: "s39-cwd" }),
      )
      const ageId = String(ageSub.envelope?.job?.id)
      const cwdId = String(cwdSub.envelope?.job?.id)
      const claimAt = Math.floor(Date.now() / 1000) * 1000 + 5_000
      setCreatedAtMs(p.sqlite, ageId, claimAt - fx.maxQueuedApiAgeMsDefault)
      renameSync(cwdProject.packageDir, `${cwdProject.packageDir}-moved`)
      mkdirSync(cwdProject.packageDir)
      const raised = recordingRunner()
      await within(
        runLocalAgentDaemon({
          db: p.db,
          lockPath: join(p.root, "daemon.lock"),
          once: true,
          pollIntervalMs: 100,
          runner: raised.runner,
          now: new Date(claimAt),
          maxQueuedApiAgeMs: fx.thresholdInjection.raisedMaxQueuedApiAgeMs,
        } as any),
        60_000,
      )
      const lowSub = await submit(
        p.db,
        agentRequest({ project: lowProject, consumerId: "s39-low" }),
      )
      const lowId = String(lowSub.envelope?.job?.id)
      setCreatedAtMs(
        p.sqlite,
        lowId,
        claimAt - fx.thresholdInjection.loweredAgeMs,
      )
      const lowered = recordingRunner()
      await within(
        runLocalAgentDaemon({
          db: p.db,
          lockPath: join(p.root, "daemon.lock"),
          once: true,
          pollIntervalMs: 100,
          runner: lowered.runner,
          now: new Date(claimAt),
          maxQueuedApiAgeMs: fx.thresholdInjection.loweredMaxQueuedApiAgeMs,
        } as any),
        60_000,
      )
      const state = (id: string, runner: { calls: string[] }) => [
        jobRow(p.sqlite, id)?.status,
        jobRow(p.sqlite, id)?.error_code ?? null,
        runner.calls.filter((call) => call === id).length,
      ]

      expect([ageSub.code, cwdSub.code, lowSub.code]).toEqual([0, 0, 0])
      expect({
        raisedAge: state(ageId, raised),
        raisedCwd: state(cwdId, raised),
        loweredAge: state(lowId, lowered),
      }).toEqual({
        raisedAge: ["succeeded", null, 1],
        raisedCwd: ["failed", "cwd_identity_changed", 0],
        loweredAge: ["failed", "queued_age_exceeded", 0],
      })
    },
    LONG,
  )
})

// ---------------------------------------------------------------------------
// S40
// ---------------------------------------------------------------------------

describe("executor: execution environment provenance (S40)", () => {
  // Enforces once `api runs submit` exists and the daemon claims admitted source=api Runs (design R3).
  test(
    "S40 Runtime environment belongs to the actual claimant — the daemon-claimed child uses the daemon's native homes/PATH/proxy, the local wrapper child uses the caller's, secrets never pass and no env snapshot is stored",
    async () => {
      const fx = fixtureCase("environment.json", "S40")
      const platform = process.platform === "win32" ? fx.win32 : fx.posix
      const p = newProfile()
      const project = p.addProject("s40")
      const envFor = (name: "A" | "B") => {
        const claimant = fx.claimants[name]
        const home = join(p.root, claimant.homeToken)
        const codexHome = join(p.root, claimant.codexHomeToken)
        const pathDir = join(p.root, claimant.pathToken)
        for (const dir of [home, codexHome, pathDir]) {
          mkdirSync(dir, { recursive: true })
        }
        const homes: Record<string, string> = {}
        for (const key of platform.nativeHomeVariables) {
          homes[key] = key === "CODEX_HOME" ? codexHome : home
        }
        return childEnv({
          ...homes,
          PATH: `${pathDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
          HTTPS_PROXY: claimant.proxy,
          ...claimant.secrets,
        })
      }
      const envA = envFor("A")
      const envB = envFor("B")
      const submitter = spawnRole(
        "cli",
        {
          dbFile: p.dbFile,
          markerDir: p.markerDir,
          argv: ["api", "runs", "submit", "--request", "-", "--json"],
          stdinText: JSON.stringify(
            agentRequest({ project, consumerId: "s40-daemon-claimed" }),
          ),
          runner: "capture-env",
        },
        envA,
      )
      await within(submitter.exited, 60_000)
      const daemonClaimedId = String(
        parseOnlyJson((await submitter.result())?.stdout ?? "")?.job?.id,
      )
      const daemon = spawnRole(
        "daemon",
        { dbFile: p.dbFile, markerDir: p.markerDir, runner: "capture-env" },
        envB,
      )
      await within(daemon.exited, 60_000)
      const wrapper = spawnRole(
        "cli",
        {
          dbFile: p.dbFile,
          markerDir: p.markerDir,
          argv: ["api", "runs", "create", "--request", "-", "--json"],
          stdinText: JSON.stringify(
            agentRequest({ project, consumerId: "s40-local-wrapper" }),
          ),
          runner: "capture-env",
        },
        envA,
      )
      await within(wrapper.exited, 60_000)
      const localId = String(
        parseOnlyJson((await wrapper.result())?.stdout ?? "")?.job?.id,
      )
      const runtimes = spawnRole(
        "cli",
        {
          dbFile: p.dbFile,
          markerDir: p.markerDir,
          argv: ["api", "runtimes", "list", "--json", "--no-probe"],
        },
        envA,
      )
      await within(runtimes.exited, 60_000)
      const runtimesOut = (await runtimes.result())?.stdout ?? ""
      const capture = (id: string) => {
        const file = join(p.markerDir, `child-env-${id}.json`)
        return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null
      }
      const daemonCapture = capture(daemonClaimedId)
      const localCapture = capture(localId)
      const projectEnv = (env: Record<string, string>, source: any) =>
        Object.fromEntries(
          [
            ...platform.nativeHomeVariables,
            ...platform.pathVariables,
            ...platform.forwardedProxyVariables,
          ].map((key: string) => [key, source?.env?.[key] === env[key]]),
        )
      const allTrue = (keys: string[]) =>
        Object.fromEntries(keys.map((key) => [key, true]))
      const keys = [
        ...platform.nativeHomeVariables,
        ...platform.pathVariables,
        ...platform.forwardedProxyVariables,
      ]
      const secretKeys = Object.keys(fx.claimants.A.secrets)
      const forwardedSecrets = (source: any) =>
        secretKeys.filter((key) => source?.env && key in source.env)
      const tokensOf = (name: "A" | "B") => {
        const claimant = fx.claimants[name]
        return [
          claimant.homeToken,
          claimant.codexHomeToken,
          claimant.pathToken,
          claimant.proxy,
          ...Object.values(claimant.secrets as Record<string, string>),
        ]
      }
      const dump = [
        JSON.stringify(p.sqlite.query("SELECT * FROM agent_jobs").all()),
        JSON.stringify(p.sqlite.query("SELECT * FROM agent_job_events").all()),
      ].join("\n")

      expect(daemonCapture?.claimantPid).toBe(daemon.proc.pid)
      expect(projectEnv(envB, daemonCapture)).toEqual(allTrue(keys))
      expect(forwardedSecrets(daemonCapture)).toEqual([])
      expect(
        tokensOf("A").filter((token) =>
          JSON.stringify(daemonCapture?.env ?? {}).includes(token),
        ),
      ).toEqual([])
      expect(localCapture?.claimantPid).toBe(wrapper.proc.pid)
      expect(projectEnv(envA, localCapture)).toEqual(allTrue(keys))
      expect(forwardedSecrets(localCapture)).toEqual([])
      expect(
        tokensOf("B").filter((token) =>
          JSON.stringify(localCapture?.env ?? {}).includes(token),
        ),
      ).toEqual([])
      expect(
        [...tokensOf("A"), ...tokensOf("B")].filter((token) =>
          runtimesOut.includes(token),
        ),
      ).toEqual([])
      expect(
        [...tokensOf("A"), ...tokensOf("B")].filter((token) =>
          dump.includes(token),
        ),
      ).toEqual([])
    },
    LONG,
  )
})

// ---------------------------------------------------------------------------
// S41, S44, S46 (inherited, green-by-design characterization)
// ---------------------------------------------------------------------------

describe("executor: inherited daemon scenarios (S41, S44, S46)", () => {
  test(
    "S41 Daemon starts without a renderer window — the headless branch dispatches daemon mode before single-instance, menu, window, updater, auth-callback and MCP startup and keeps diagnostics on stderr",
    async () => {
      const fx = fixtureCase("queue.json", "S41")
      const source = readFileSync(
        join(import.meta.dir, "..", "src", "main", "index.ts"),
        "utf8",
      )
      const dispatch = source.indexOf("app.whenReady().then(runHeadlessMain)")
      const branchStart = source.lastIndexOf(
        "if (isHeadlessCliLaunch) {",
        dispatch,
      )
      const elseStart = source.indexOf("} else {", dispatch)
      const headlessBranch = source.slice(branchStart, elseStart)
      const guiBranch = source.slice(elseStart)
      const mainStart = source.indexOf("async function runHeadlessMain")
      const mainBody = source.slice(
        mainStart,
        source.indexOf("\n}\n", mainStart),
      )
      const p = newProfile()
      const daemon = await cli(p.db, [
        "daemon",
        "run",
        "--once",
        "--poll-interval-ms",
        "100",
        "--output",
        "json",
      ])

      expect([dispatch > 0, branchStart > 0, elseStart > dispatch]).toEqual([
        true,
        true,
        true,
      ])
      expect(mainBody).toContain("runHeadlessCliCommand(")
      expect(mainBody).toContain("daemonLockPath")
      expect(
        fx.headlessBranchMustNotContain.filter(
          (token: string) =>
            headlessBranch.includes(token) || mainBody.includes(token),
        ),
      ).toEqual([])
      expect(
        fx.guiBranchMustContain.filter(
          (token: string) => !guiBranch.includes(token),
        ),
      ).toEqual([])
      expect(source.indexOf("requestSingleInstanceLock")).toBeGreaterThan(
        dispatch,
      )
      expect(daemon.code).toBe(0)
      expect(parseOnlyJson(daemon.stdout)?.daemon?.stoppedBy).toBe("once")
      expect(daemon.stdout).not.toContain("[Daemon]")
      expect(daemon.stderr).toContain("[Daemon] Started local agent daemon")
    },
    LONG,
  )

  test(
    "S44 User follows daemon logs — jobs logs --follow and run --daemon --follow stream persisted events in sequence and exit after the daemon job is terminal",
    async () => {
      const fx = fixtureCase("queue.json", "S44")
      const observed: Record<string, any> = {}
      for (const entry of fx.entryPoints) {
        const p = newProfile()
        const project = p.addProject("s44")
        let follow: Promise<any>
        let jobId: string | null = null
        if (entry === "jobs-logs-follow") {
          const job = await createAgentJob(p.db, {
            source: "daemon",
            runtime: "codex",
            mode: "plan",
            cwd: project.packageDir,
            prompt: "S44 follow",
            projectId: project.id,
          })
          jobId = job.id
          follow = cli(p.db, [
            "jobs",
            "logs",
            job.id,
            "--follow",
            "--output",
            "stream-json",
          ])
        } else {
          follow = cli(p.db, [
            "run",
            "--daemon",
            "--follow",
            "--runtime",
            "codex",
            "--cwd",
            project.projectRoot,
            "--prompt",
            "S44 run follow",
            "--output",
            "stream-json",
          ])
          await pollUntil(
            () => jobRows(p.sqlite, "source = 'daemon'").length === 1,
            5_000,
          )
          jobId = String(jobRows(p.sqlite, "source = 'daemon'")[0]?.id)
        }
        await realDelay(50)
        const recorder = recordingRunner([], { holdMs: 100 })
        await runLocalAgentDaemon({
          db: p.db,
          once: true,
          pollIntervalMs: 100,
          runner: recorder.runner,
        })
        const settled = await within(follow, fx.followPollBoundMs)
        const lines = settled.settled
          ? String(settled.value.stdout)
              .split("\n")
              .filter((line) => line.trim().length > 0)
              .map((line) => JSON.parse(line))
          : []
        const events = lines
          .filter((line) => line.event)
          .map((line) => line.event)
        observed[entry] = {
          exited: settled.settled,
          code: settled.settled ? settled.value.code : null,
          sequences: events.map((event: any) => event.sequence),
          lastType: events.at(-1)?.type ?? null,
          allSameJob: events.every((event: any) => event.jobId === jobId),
          terminal: getAgentJob(p.db, String(jobId))?.status,
        }
      }

      for (const entry of fx.entryPoints) {
        const value = observed[entry]
        expect({ entry, exited: value.exited, code: value.code }).toEqual({
          entry,
          exited: true,
          code: 0,
        })
        expect(value.sequences).toEqual(
          value.sequences.map((_: number, index: number) => index + 1),
        )
        expect(value.sequences.length).toBeGreaterThan(2)
        expect([value.lastType, value.allSameJob, value.terminal]).toEqual([
          "completed",
          true,
          "succeeded",
        ])
      }
    },
    LONG,
  )

  test(
    "S46 Daemon coordination stays local — token/API-key/raw-env daemon-client inputs are rejected before any job or provider call and a daemon pass opens no listening socket while touching only its profile",
    async () => {
      const fx = fixtureCase("queue.json", "S46")
      const p = newProfile()
      const project = p.addProject("s46")
      const recorder = recordingRunner()
      const originalListen = net.Server.prototype.listen
      let listenCalls = 0
      net.Server.prototype.listen = function (this: any, ...args: any[]) {
        listenCalls += 1
        return (originalListen as any).apply(this, args)
      } as any
      const lockPath = join(p.root, "agent-daemon.lock")
      const outputs: string[] = []
      const rejected: Record<string, any> = {}
      let daemon: any = null
      const rootBefore = dirListing(p.root)
      try {
        for (const input of fx.forbiddenInputs) {
          const jobsBefore = jobRows(p.sqlite).length
          let code: number
          if (input.argv) {
            const argv = input.argv.map((arg: string) =>
              arg === "x" ? "S46 forbidden input" : arg,
            )
            const result = await cli(
              p.db,
              [...argv, "--cwd", project.projectRoot],
              { runner: recorder.runner },
            )
            code = result.code
            outputs.push(result.stdout, result.stderr)
          } else {
            const params = { ...input.stdio.params, cwd: project.projectRoot }
            const stdin = [
              JSON.stringify({ ...input.stdio, params }),
              JSON.stringify({
                jsonrpc: "2.0",
                id: "shutdown",
                method: "shutdown",
                params: {},
              }),
            ].join("\n")
            const result = await cli(p.db, ["jobs-stdio"], {
              stdin: `${stdin}\n`,
              runner: recorder.runner,
            })
            code = result.code
            outputs.push(result.stdout, result.stderr)
            const response = result.stdout
              .split("\n")
              .filter((line) => line.trim().length > 0)
              .map((line) => JSON.parse(line))
              .find((line) => line.id === "run")
            rejected[`${input.name}:rpcError`] = Boolean(response?.error)
          }
          rejected[input.name] = {
            exit: input.expectExit === undefined ? "n/a" : code,
            jobsCreated: jobRows(p.sqlite).length - jobsBefore,
          }
        }
        daemon = await cli(
          p.db,
          [
            "daemon",
            "run",
            "--once",
            "--poll-interval-ms",
            "100",
            "--output",
            "json",
          ],
          { runner: recorder.runner, daemonLockPath: lockPath },
        )
      } finally {
        net.Server.prototype.listen = originalListen
      }
      const rootAfter = dirListing(p.root)
      const dump = JSON.stringify(
        p.sqlite.query("SELECT * FROM agent_jobs").all(),
      )

      expect(rejected).toEqual(
        Object.fromEntries(
          fx.forbiddenInputs.flatMap((input: any) => [
            [
              input.name,
              {
                exit: input.expectExit === undefined ? "n/a" : input.expectExit,
                jobsCreated: 0,
              },
            ],
            ...(input.stdio ? [[`${input.name}:rpcError`, true]] : []),
          ]),
        ),
      )
      expect(recorder.calls).toEqual([])
      expect(daemon?.code).toBe(0)
      expect(listenCalls).toBe(0)
      expect(existsSync(lockPath)).toBe(false)
      expect(rootAfter).toEqual(rootBefore)
      expect(
        fx.secretSentinels.filter(
          (secret: string) =>
            outputs.some((output) => output.includes(secret)) ||
            dump.includes(secret),
        ),
      ).toEqual([])
    },
    LONG,
  )
})
