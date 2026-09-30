/**
 * Implementer tests for the S-06 option (a) disposition (Owner 2026-10-01,
 * refactor-canonical-run-event-ledger): the public v1 `completed.payload`
 * keeps the base members `exitCode`, `errorCode`, `errorMessage` and
 * `result` as optional nullable members (additive restore). They carry the
 * same values the settlement writes to the job row, `null` when the
 * settlement has no such field; `result` is the public job result (never the
 * ledger's internal `artifactRefs`); every value goes through the persisted
 * redaction walker with the rest of the stored record.
 */
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import type { OutcomeEvidence } from "../src/main/lib/agent-runtime/run-event-ledger"
import {
  bindRunExecutionProvenance,
  getOrCreateRunEventLedger,
  releaseRunEventLedger,
} from "../src/main/lib/agent-runtime/run-event-ledger-host"
import { projects } from "../src/main/lib/db/schema"
import type { AgentRuntimeRunResult } from "../src/main/lib/headless/agent-runtime-contract"
import { HEADLESS_CLI_MARKER } from "../src/main/lib/headless/cli-args"
import { runHeadlessCliCommand } from "../src/main/lib/headless/cli-dispatcher"
import { runPersistedAgentJob } from "../src/main/lib/headless/job-runner"
import {
  cancelAgentJob,
  createAgentJob,
  getAgentJob,
  listAgentJobEvents,
  startAgentJob,
} from "../src/main/lib/headless/job-store"
import { EXACT_SECRET_REDACTION_MARKER } from "../src/shared/secret-redaction-policy"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

type Db = ReturnType<typeof createAgentJobTestDb>
type Json = Record<string, unknown>

const MEMBERS = ["exitCode", "errorCode", "errorMessage", "result"] as const

const RUNTIME = {
  kind: "runtime",
  installationId: "inst-codex-0.139.0-linux-x64-completed-members",
  runtimeId: "codex",
  adapterSource: "codex-app-server",
  version: "0.139.0",
  executableRef: "exe-completed-members",
  binarySha256: "a".repeat(64),
  protocolName: "codex-app-server-jsonrpc",
  protocolVersion: "v2",
  schemaFiles: [{ path: "ServerNotification.ts", sha256: "b".repeat(64) }],
} as const

const HOST_FAILED: Omit<OutcomeEvidence, "trigger"> = {
  policy: { denied: false, evidenceKeys: [] },
  output: { valid: true, empty: true, allowEmpty: false, evidenceKeys: [] },
  postRun: { credentialsSafe: true, evidenceKeys: [] },
} as never

function completedEvent(db: Db, jobId: string) {
  const completed = listAgentJobEvents(db, jobId).filter(
    (event) => event.type === "completed",
  )
  expect(completed).toHaveLength(1)
  return {
    payload: JSON.parse(completed[0].payloadJson) as Json,
    metadata: JSON.parse(completed[0].recordMetadataJson ?? "{}") as Json,
  }
}

/** The job-row columns the completed members mirror. */
function jobRowMembers(db: Db, jobId: string) {
  const job = getAgentJob(db, jobId)
  if (!job) throw new Error(`Unknown job: ${jobId}`)
  return {
    exitCode: job.exitCode ?? null,
    errorCode: job.errorCode ?? null,
    errorMessage: job.errorMessage ?? null,
    resultJson: job.resultJson ?? null,
  }
}

function writer() {
  let value = ""
  return {
    stream: {
      write(chunk: string) {
        value += chunk
      },
    },
    value: () => value,
  }
}

async function startedJob(db: Db, prompt: string) {
  const created = await createAgentJob(db, {
    source: "api",
    runtime: "codex",
    mode: "plan",
    cwd: process.cwd(),
    prompt,
  })
  return startAgentJob(db, { jobId: created.id, workerId: "worker-1" })
}

describe("S-06 option (a): completed.payload keeps the base job members", () => {
  test("an API Run's succeeded completed carries exitCode 0, null error members and the public result without artifactRefs, in the store and the frozen events.jsonl", async () => {
    const db = createAgentJobTestDb()
    const projectRoot = realpathSync(
      mkdtempSync(join(tmpdir(), "locus-completed-members-")),
    )
    const packageDir = join(projectRoot, "local-package")
    mkdirSync(packageDir)
    db.insert(projects)
      .values({ id: "project-1", name: "Current", path: projectRoot })
      .run()
    const artifactBaseDir = join(packageDir, ".locus", "runs")
    const stdout = writer()
    const stderr = writer()
    const code = await runHeadlessCliCommand({
      db,
      argv: [
        "Locus",
        HEADLESS_CLI_MARKER,
        "api",
        "runs",
        "create",
        "--request",
        "-",
        "--json",
      ],
      stdin: Readable.from([
        JSON.stringify({
          apiVersion: "locus.local-job.v1",
          consumer: { id: "docs-workbench", runExternalId: "members-001" },
          project: { cwd: realpathSync(packageDir) },
          runtime: { id: "codex" },
          mode: "plan",
          prompt: { text: "Review this local package." },
          artifacts: { baseDir: artifactBaseDir, writePolicy: "metadata-only" },
        }),
      ]),
      stdout: stdout.stream,
      stderr: stderr.stream,
      env: { LOCUS_HEADLESS_FAKE_RUNNER: "1" },
      appVersion: "0.0.test",
    })
    expect(stderr.value()).toBe("")
    expect(code).toBe(0)
    const created = JSON.parse(stdout.value())
    const jobId = created.job.id as string

    const { payload } = completedEvent(db, jobId)
    expect(payload.status).toBe("succeeded")
    expect(payload.exitCode).toBe(0)
    expect(payload.errorCode).toBeNull()
    expect(payload.errorMessage).toBeNull()
    // The store merged the registered refs into result_json; the completed
    // member is the public result every public reader exposes.
    expect(jobRowMembers(db, jobId).resultJson).toContain('"artifactRefs"')
    expect(payload.result).toEqual(created.result.result)
    expect(payload.result).toEqual(created.job.result)
    expect(Object.keys(payload.result as Json).sort()).toEqual([
      "fake",
      "finalMessage",
      "resolvedProvider",
    ])
    expect(JSON.stringify(payload)).not.toContain("artifactRefs")

    // The frozen run-dir stream carries the same completed members.
    const frozen = readFileSync(join(artifactBaseDir, jobId, "events.jsonl"), {
      encoding: "utf-8",
    })
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Json)
      .filter((event) => event.type === "completed")
    expect(frozen).toHaveLength(1)
    for (const member of MEMBERS) {
      expect((frozen[0].payload as Json)[member]).toEqual(payload[member])
    }
  })

  test("a headless failed completed carries the job row's exitCode, errorCode and errorMessage", async () => {
    const db = createAgentJobTestDb()
    const created = await createAgentJob(db, {
      source: "cli",
      runtime: "codex",
      mode: "plan",
      cwd: process.cwd(),
      prompt: "members failed",
    })
    await runPersistedAgentJob({
      db,
      jobId: created.id,
      runner: async (_request, observer): Promise<AgentRuntimeRunResult> => {
        observer.appendEvent("assistant_delta", { text: "partial" })
        return {
          status: "failed",
          exitCode: 1,
          errorCode: "runtime_process_failed",
          errorMessage: "Runner exited with code 1.",
        }
      },
      env: {},
      workerPid: null,
    })
    const { payload } = completedEvent(db, created.id)
    const row = jobRowMembers(db, created.id)
    expect(payload.status).toBe("failed")
    expect(row.exitCode).not.toBeNull()
    expect(row.errorCode).toBe("runtime_process_failed")
    expect(row.errorMessage).toBe("Runner exited with code 1.")
    expect(payload.exitCode).toBe(row.exitCode)
    expect(payload.errorCode).toBe("runtime_process_failed")
    expect(payload.errorMessage).toBe("Runner exited with code 1.")
    expect(payload.result).toEqual(JSON.parse(row.resultJson ?? "null"))
  })

  test("a transport exit with no job-row projection carries the four members as null (never fabricated)", async () => {
    const db = createAgentJobTestDb()
    const job = await startedJob(db, "members transport exit")
    const ledger = await getOrCreateRunEventLedger(db, job)
    await bindRunExecutionProvenance(ledger, RUNTIME)
    await ledger.ingestTransportExit({
      observationKey: "members-transport-exit",
      transportId: "t1",
      exitCode: 137,
      signal: "SIGKILL",
    })
    const { payload } = completedEvent(db, job.id)
    expect(payload).toMatchObject({
      status: "interrupted",
      reasons: ["transport_exit"],
      synthetic: { source: "transport_exit", exitCode: 137 },
      exitCode: null,
      errorCode: null,
      errorMessage: null,
      result: null,
    })
    for (const member of MEMBERS) expect(member in payload).toBe(true)
    releaseRunEventLedger(db, job.id)
  })

  test("a queued cancel with no job-row fields carries the four members as null", async () => {
    const db = createAgentJobTestDb()
    const created = await createAgentJob(db, {
      source: "api",
      runtime: "codex",
      mode: "plan",
      cwd: process.cwd(),
      prompt: "members queued cancel",
    })
    await cancelAgentJob(db, created.id, { requestedBy: "test" })
    const { payload } = completedEvent(db, created.id)
    expect(payload).toMatchObject({
      status: "canceled",
      exitCode: null,
      errorCode: null,
      errorMessage: null,
      result: null,
    })
  })

  test("the result member never contains artifactRefs; a result of nothing but refs is null", async () => {
    for (const [runnerResult, expected] of [
      [{ artifactRefs: [{ role: "x", sequence: 3 }], kept: 1 }, { kept: 1 }],
      [{ artifactRefs: [{ role: "x", sequence: 3 }] }, null],
    ] as const) {
      const db = createAgentJobTestDb()
      const job = await startedJob(db, "members refs")
      const ledger = await getOrCreateRunEventLedger(db, job)
      await ledger.settle(
        {
          trigger: {
            kind: "host_result",
            status: "failed",
            observationKey: `members-refs:${job.id}`,
          },
          ...HOST_FAILED,
        } as OutcomeEvidence,
        {
          jobFields: () => ({
            exitCode: 1,
            errorCode: "runtime_failed",
            result: runnerResult,
          }),
        },
      )
      const { payload } = completedEvent(db, job.id)
      expect(payload.result).toEqual(expected)
      expect(JSON.stringify(payload)).not.toContain("artifactRefs")
      releaseRunEventLedger(db, job.id)
    }
  })

  test("an errorMessage carrying a configured secret hint is redacted in the stored record, identically to the job row", async () => {
    const secret = "sk-completed-members-0123456789abcdef"
    const db = createAgentJobTestDb()
    const job = await startedJob(db, "members redaction")
    const ledger = await getOrCreateRunEventLedger(db, job, {
      secretHints: [secret],
    })
    await ledger.settle(
      {
        trigger: {
          kind: "host_result",
          status: "failed",
          observationKey: `members-redaction:${job.id}`,
        },
        ...HOST_FAILED,
      } as OutcomeEvidence,
      {
        jobFields: () => ({
          exitCode: 1,
          errorCode: "runtime_failed",
          errorMessage: `upstream rejected key ${secret}`,
          result: { detail: `echo ${secret}` },
        }),
      },
    )
    const { payload, metadata } = completedEvent(db, job.id)
    const row = jobRowMembers(db, job.id)
    const stored = JSON.stringify(payload)
    expect(stored).not.toContain(secret)
    expect(payload.errorMessage).toContain(EXACT_SECRET_REDACTION_MARKER)
    expect(payload.errorMessage).toBe(row.errorMessage)
    expect(payload.result).toEqual(JSON.parse(row.resultJson ?? "null"))
    expect(metadata.redaction?.status).toBe("redacted")
    releaseRunEventLedger(db, job.id)
  })

  test("a terminal run-dir preparation failure re-derives the members from the failed job row", async () => {
    const db = createAgentJobTestDb()
    const job = await startedJob(db, "members preparation failure")
    const ledger = await getOrCreateRunEventLedger(db, job)
    await ledger.settle(
      {
        trigger: {
          kind: "host_result",
          status: "succeeded",
          observationKey: `members-prepare:${job.id}`,
        },
        policy: { denied: false, evidenceKeys: [] },
        output: {
          valid: true,
          empty: false,
          allowEmpty: true,
          evidenceKeys: ["host:output"],
        },
        postRun: { credentialsSafe: true, evidenceKeys: [] },
      } as OutcomeEvidence,
      {
        jobFields: (outcome) =>
          outcome.status === "succeeded"
            ? { exitCode: 0, errorCode: null, errorMessage: null, result: {} }
            : {
                exitCode: 1,
                errorCode: outcome.reasons.at(-1) ?? "failed",
                errorMessage: `Run outcome ${outcome.status}`,
                result: { failed: true },
              },
        terminalArtifacts: {
          prepare: () => {
            throw new Error("disk full")
          },
        },
      },
    )
    const { payload } = completedEvent(db, job.id)
    const row = jobRowMembers(db, job.id)
    expect(payload.status).toBe("failed")
    expect(payload.reasons).toContain("terminal_artifact_preparation_failed")
    expect(payload).toMatchObject({
      exitCode: 1,
      errorCode: "terminal_artifact_preparation_failed",
      errorMessage: "Run outcome failed",
      result: { failed: true },
    })
    expect(payload.exitCode).toBe(row.exitCode)
    expect(payload.errorCode).toBe(row.errorCode)
    expect(payload.errorMessage).toBe(row.errorMessage)
    releaseRunEventLedger(db, job.id)
  })
})
