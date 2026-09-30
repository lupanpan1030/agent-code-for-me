/**
 * Implementer unit tests for S30 "Terminal files and completed become
 * visible together" (refactor-canonical-run-event-ledger design "Artifacts
 * and Terminal Commit Order", tasks 7.13), driven by the implementer fixture
 * tests/fixtures/run-event-ledger-units/terminal-artifacts.json: one API Run
 * over the real SQLite job store and the local-job-api terminal preparer,
 * with faults injected before file preparation, before the SQL commit and
 * after the commit before projection.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type RunArtifactRunDir,
  writeRunArtifactFile,
} from "../src/main/lib/agent-runtime/run-artifacts"
import {
  createCanonicalRunEventLedger,
  type DurableStorePort,
  type LedgerRecord,
  type OutcomeEvidence,
  type RuntimeExecutionProvenance,
} from "../src/main/lib/agent-runtime/run-event-ledger"
import {
  createJobStoreDurableStore,
  getOrCreateRunEventLedger,
  releaseRunEventLedger,
} from "../src/main/lib/agent-runtime/run-event-ledger-host"
import {
  closeStableDirectory,
  openStableDirectory,
} from "../src/main/lib/filesystem/stable-directory"
import {
  createAgentJob,
  getAgentJob,
  listAgentJobEvents,
  startAgentJob,
} from "../src/main/lib/headless/job-store"
import {
  createLocalJobApiTerminalArtifacts,
  getLocalJobApiEvents,
  toLocalJobApiResultEnvelope,
} from "../src/main/lib/headless/local-job-api"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

type Json = Record<string, unknown>
type FixtureCase = {
  caseId: string
  failAt:
    | null
    | "before_file_preparation"
    | "before_sql_commit"
    | "after_commit_before_projection"
  expected: {
    completedStatus: string
    reason?: string
    finalRoles: string[]
    resultFileRoles?: string[]
    manifestFileRoles?: string[]
  }
}
type Fixture = {
  secretHints: string[]
  observations: Array<{ observationKey: string; type: string; payload: Json }>
  evidence: OutcomeEvidence
  lateObservation: { observationKey: string; type: string; payload: Json }
  cases: FixtureCase[]
}

const FIXTURE = JSON.parse(
  readFileSync(
    join(
      import.meta.dir,
      "fixtures/run-event-ledger-units/terminal-artifacts.json",
    ),
    "utf8",
  ),
) as Fixture

const RUNTIME_TUPLE: RuntimeExecutionProvenance = {
  kind: "runtime",
  installationId: "inst-codex-terminal-faults-test",
  runtimeId: "codex",
  adapterSource: "codex-app-server",
  version: "0.139.0",
  executableRef: "exe-terminal-faults-test",
  binarySha256: "c".repeat(64),
  protocolName: "codex-app-server-jsonrpc",
  protocolVersion: "v2",
  schemaFiles: [
    { path: "codex-app-server/v2/dispositions.json", sha256: "d".repeat(64) },
  ],
}

const cleanup: Array<() => void> = []
afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.()
})

function fixtureCase(caseId: string): FixtureCase {
  const found = FIXTURE.cases.find((entry) => entry.caseId === caseId)
  if (!found) throw new Error(`terminal-artifacts.json lacks ${caseId}`)
  return found
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

function roles(list: unknown): string[] {
  return Array.isArray(list)
    ? list.map((entry) => String((entry as Json).role))
    : []
}

/** A started API job with an admitted run dir and its initial files. */
async function preparedApiRun() {
  const db = createAgentJobTestDb()
  const runDirPath = realpathSync(
    mkdtempSync(join(tmpdir(), "terminal-faults-rundir-")),
  )
  cleanup.push(() => rmSync(runDirPath, { recursive: true, force: true }))
  const runDir: RunArtifactRunDir = Object.assign(
    openStableDirectory(runDirPath, "Artifact run"),
    { fileReceipts: new Map() },
  )
  cleanup.push(() => {
    if (!runDir.closed) closeStableDirectory(runDir)
  })
  writeRunArtifactFile(
    runDir,
    "request.json",
    `${JSON.stringify({ apiVersion: "locus.local-job.v1" })}\n`,
  )
  const created = await createAgentJob(db, {
    source: "api",
    runtime: "codex",
    mode: "agent",
    cwd: runDirPath,
    prompt: "terminal artifacts",
    apiConsumerId: "terminal-faults",
    artifactBaseDir: runDirPath,
    artifactManifestPath: join(runDirPath, "artifacts.json"),
  })
  await startAgentJob(db, {
    jobId: created.id,
    workerId: "worker-terminal-faults",
    workerPid: null,
  })
  releaseRunEventLedger(db, created.id)
  return { db, runDir, runDirPath, jobId: created.id }
}

function readerSnapshot(
  db: ReturnType<typeof createAgentJobTestDb>,
  jobId: string,
) {
  const job = getAgentJob(db, jobId)
  if (!job) throw new Error("job missing")
  const events = listAgentJobEvents(db, jobId)
  return {
    status: job.status,
    completedEvents: getLocalJobApiEvents(db, jobId).filter(
      (event) => event.type === "completed",
    ).length,
    resultStatus: toLocalJobApiResultEnvelope(job, undefined, events).status,
    resultRoles: roles(
      toLocalJobApiResultEnvelope(job, undefined, events).artifacts,
    ),
    registeredRefs: roles(
      (JSON.parse(job.resultJson ?? "{}") as Json).artifactRefs,
    ),
  }
}

async function settleCase(caseId: string) {
  const row = fixtureCase(caseId)
  const run = await preparedApiRun()
  const store = createJobStoreDurableStore(run.db, run.jobId)
  const beforeCommit: ReturnType<typeof readerSnapshot>[] = []
  let failCommit = row.failAt === "before_sql_commit"
  const faultyStore: DurableStorePort = {
    ...store,
    appendExact(input) {
      if (
        failCommit &&
        input.records.some((record) => record.type === "completed")
      ) {
        failCommit = false
        // Readers observed at the moment the SQL commit is refused.
        beforeCommit.push(readerSnapshot(run.db, run.jobId))
        throw new Error("injected: SQL commit refused")
      }
      return store.appendExact(input)
    },
  }
  const delivered: number[] = []
  let acknowledged = 0
  // The projection is unavailable for the completed until the host that
  // committed it is gone (a crash after commit, before projection).
  const projectionFault = {
    active: row.failAt === "after_commit_before_projection",
  }
  const projection = {
    name: "s30-projection",
    deliver(record: LedgerRecord) {
      if (projectionFault.active && record.type === "completed") {
        throw new Error("injected: projection unavailable")
      }
      delivered.push(Number(record.sequence))
    },
    cursor: () => acknowledged,
    ack: (sequence: number) => {
      acknowledged = sequence
    },
  }
  const terminal = createLocalJobApiTerminalArtifacts({
    db: run.db,
    runDir: run.runDir,
    jobId: run.jobId,
    ...(row.failAt === "before_file_preparation"
      ? {
          filesystemHooks: {
            beforeAtomicRename: () => {
              throw new Error("injected: file preparation fault")
            },
          },
        }
      : {}),
  })
  const ledger = createCanonicalRunEventLedger({
    runId: run.jobId,
    runtimeId: "codex",
    source: "api",
    provenance: RUNTIME_TUPLE,
    redactionContext: { secretHints: FIXTURE.secretHints },
    durableStore: faultyStore,
    projections: [projection],
    ...(terminal.preparer ? { terminalArtifacts: terminal.preparer } : {}),
  })
  for (const observation of FIXTURE.observations) {
    await ledger.ingestRuntimeObservation(observation)
  }
  await ledger.settle(FIXTURE.evidence)
  await ledger.whenIdle()
  return {
    row,
    run,
    ledger,
    terminal,
    beforeCommit,
    delivered,
    projection,
    projectionFault,
  }
}

function committedCompleted(
  db: ReturnType<typeof createAgentJobTestDb>,
  jobId: string,
) {
  return listAgentJobEvents(db, jobId).filter(
    (event) => event.type === "completed",
  )
}

function assertFrozenTerminalFiles(input: {
  row: FixtureCase
  runDirPath: string
  db: ReturnType<typeof createAgentJobTestDb>
  jobId: string
}) {
  const completed = committedCompleted(input.db, input.jobId)
  expect(completed).toHaveLength(1)
  const job = getAgentJob(input.db, input.jobId)
  const registered = (JSON.parse(job?.resultJson ?? "{}") as Json)
    .artifactRefs as Array<{ role: string; path?: string; sha256?: string }>
  // Every final file is registered with its on-disk digest.
  for (const role of ["events", "result", "manifest"]) {
    const ref = registered.find(
      (entry) =>
        entry.role === role && entry.path?.startsWith(input.runDirPath),
    )
    const finalRef = [...registered]
      .reverse()
      .find((entry) => entry.role === role)
    expect(ref).toBeDefined()
    expect(sha256(readFileSync(String(finalRef?.path)))).toBe(
      String(finalRef?.sha256),
    )
  }
  const lines = readFileSync(join(input.runDirPath, "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Json)
  const fileCompleted = lines.filter((line) => line.type === "completed")
  expect(fileCompleted).toHaveLength(1)
  expect(fileCompleted[0].sequence).toBe(completed[0].sequence)
  const resultFile = JSON.parse(
    readFileSync(join(input.runDirPath, "result.json"), "utf8"),
  ) as Json
  const manifestFile = JSON.parse(
    readFileSync(join(input.runDirPath, "artifacts.json"), "utf8"),
  ) as Json
  expect(roles(resultFile.artifacts)).toEqual(
    input.row.expected.resultFileRoles ?? [],
  )
  expect(roles(manifestFile.artifacts)).toEqual(
    input.row.expected.manifestFileRoles ?? [],
  )
  // Final files mint no artifact_created of their own.
  const created = listAgentJobEvents(input.db, input.jobId).filter(
    (event) => event.type === "artifact_created",
  )
  expect(created).toEqual([])
}

describe("S30 terminal files and completed become visible together (terminal-artifacts.json)", () => {
  test("clean: the one completed, its frozen files and verified refs commit together; reopened readers return the same result and late diagnostics leave the files unchanged", async () => {
    const { row, run, terminal } = await settleCase("clean")
    expect(roles(terminal.artifacts())).toEqual(row.expected.finalRoles)
    assertFrozenTerminalFiles({ row, ...run })
    const job = getAgentJob(run.db, run.jobId)
    expect(job?.status).toBe(row.expected.completedStatus)

    const eventsBytes = readFileSync(join(run.runDirPath, "events.jsonl"))
    const resultBefore = toLocalJobApiResultEnvelope(
      getAgentJob(run.db, run.jobId) as NonNullable<
        ReturnType<typeof getAgentJob>
      >,
      undefined,
      listAgentJobEvents(run.db, run.jobId),
    )
    const reopened = await getOrCreateRunEventLedger(run.db, { id: run.jobId })
    await reopened.ingestRuntimeObservation(FIXTURE.lateObservation)
    releaseRunEventLedger(run.db, run.jobId)
    const late = listAgentJobEvents(run.db, run.jobId).at(-1)
    expect(late?.type).toBe("status")
    expect(JSON.parse(late?.payloadJson ?? "{}")).toMatchObject({
      subtype: "late_event",
      diagnosticOnly: true,
    })
    expect(readFileSync(join(run.runDirPath, "events.jsonl"))).toEqual(
      eventsBytes,
    )
    const completed = committedCompleted(run.db, run.jobId)
    expect(await reopened.readOutcome()).toMatchObject({
      status: row.expected.completedStatus,
      completedSequence: completed[0].sequence,
    })
    const resultAfter = toLocalJobApiResultEnvelope(
      getAgentJob(run.db, run.jobId) as NonNullable<
        ReturnType<typeof getAgentJob>
      >,
      undefined,
      listAgentJobEvents(run.db, run.jobId),
    )
    expect(resultAfter.status).toBe(resultBefore.status)
    expect(resultAfter.artifacts).toEqual(resultBefore.artifacts)
  })

  test("a file-preparation fault keeps the terminal slot, settles failed with the diagnostic and registers no final refs", async () => {
    const { row, run, terminal } = await settleCase("file-preparation-fault")
    const completed = committedCompleted(run.db, run.jobId)
    expect(completed).toHaveLength(1)
    expect(JSON.parse(completed[0].payloadJson)).toMatchObject({
      status: row.expected.completedStatus,
    })
    expect(
      (JSON.parse(completed[0].payloadJson) as Json).reasons as string[],
    ).toContain(row.expected.reason)
    expect(roles(terminal.artifacts())).toEqual(row.expected.finalRoles)
    const registered = roles(
      (JSON.parse(getAgentJob(run.db, run.jobId)?.resultJson ?? "{}") as Json)
        .artifactRefs,
    )
    expect(registered).not.toContain("result")
  })

  test("a refused SQL commit exposes no candidate terminal or unregistered final ref to the result/events readers; the unchanged reserved terminal then commits once", async () => {
    const { row, run, beforeCommit, terminal } =
      await settleCase("sql-commit-fault")
    expect(beforeCommit).toHaveLength(1)
    expect(beforeCommit[0]).toEqual({
      status: "running",
      completedEvents: 0,
      resultStatus: "running",
      resultRoles: beforeCommit[0].resultRoles.filter(
        (role) => role !== "result",
      ),
      registeredRefs: [],
    })
    expect(beforeCommit[0].resultRoles).not.toContain("result")
    expect(roles(terminal.artifacts())).toEqual(row.expected.finalRoles)
    assertFrozenTerminalFiles({ row, ...run })
    expect(getAgentJob(run.db, run.jobId)?.status).toBe(
      row.expected.completedStatus,
    )
  })

  test("a projection fault after the commit keeps the committed terminal; reopening redelivers the completed exactly once", async () => {
    const { row, run, delivered, projection, projectionFault } =
      await settleCase("projection-fault")
    const completed = committedCompleted(run.db, run.jobId)
    expect(completed).toHaveLength(1)
    expect(getAgentJob(run.db, run.jobId)?.status).toBe(
      row.expected.completedStatus,
    )
    expect(delivered).not.toContain(completed[0].sequence)
    expect(projection.cursor()).toBeLessThan(completed[0].sequence)
    assertFrozenTerminalFiles({ row, ...run })

    projectionFault.active = false
    const reopened = createCanonicalRunEventLedger({
      runId: run.jobId,
      runtimeId: "codex",
      source: "api",
      provenance: RUNTIME_TUPLE,
      durableStore: createJobStoreDurableStore(run.db, run.jobId),
      projections: [projection],
    })
    await reopened.whenIdle()
    expect(
      delivered.filter((sequence) => sequence === completed[0].sequence),
    ).toHaveLength(1)
    expect(projection.cursor()).toBe(completed[0].sequence)
    expect(committedCompleted(run.db, run.jobId)).toHaveLength(1)
  })
})
