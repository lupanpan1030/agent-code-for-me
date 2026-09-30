/**
 * Implementer unit tests for the headless runner facade and the coarse
 * ingress port (refactor-canonical-run-event-ledger; core scenarios S04
 * "Runtime reports completion" and S06 "Headless process emits coarse
 * output"; red-receipt §6 implementer-unit assignments). S04 drives every
 * terminal status of normalized-output.json through runPersistedAgentJob;
 * S06 drives tests/fixtures/run-event-ledger-units/coarse-process.json
 * through the Run's host ledger over the SQLite store port.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { OutcomeEvidence } from "../src/main/lib/agent-runtime/run-event-ledger"
import {
  getOrCreateRunEventLedger,
  releaseRunEventLedger,
} from "../src/main/lib/agent-runtime/run-event-ledger-host"
import type {
  AgentRuntimeObserver,
  AgentRuntimeRunRequest,
  AgentRuntimeRunResult,
} from "../src/main/lib/headless/agent-runtime-contract"
import { runPersistedAgentJob } from "../src/main/lib/headless/job-runner"
import {
  createAgentJob,
  listAgentJobEvents,
  startAgentJob,
} from "../src/main/lib/headless/job-store"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

type Json = Record<string, unknown>

const NORMALIZED_OUTPUT = JSON.parse(
  readFileSync(
    join(import.meta.dir, "fixtures/run-event-ledger/normalized-output.json"),
    "utf8",
  ),
) as { terminalStatuses: string[] }

type CoarseCase = {
  caseId: string
  descriptor: { kind: string; text: string | null; exitCode: number | null }
  observation?: { type: string; payload: Json }
  settle?: OutcomeEvidence
  expected: {
    type: string
    status?: string
    preserved?: Json
    retainedSafeText?: string
    carriesSecret?: boolean
  }
}

const COARSE = JSON.parse(
  readFileSync(
    join(
      import.meta.dir,
      "fixtures/run-event-ledger-units/coarse-process.json",
    ),
    "utf8",
  ),
) as {
  runtimeId: string
  secretHints: string[]
  cases: CoarseCase[]
}

const NATIVE_IDENTITY_KEYS = [
  "threadId",
  "turnId",
  "itemId",
  "sessionId",
  "runtime.codex.v1",
]

function runnerFor(
  status: string,
): (
  request: AgentRuntimeRunRequest,
  observer: AgentRuntimeObserver,
) => Promise<AgentRuntimeRunResult> {
  return async (_request, observer) => {
    observer.appendEvent("assistant_delta", { text: `runner said ${status}` })
    switch (status) {
      case "succeeded":
        return { status: "succeeded", exitCode: 0, result: { ok: true } }
      case "failed":
        return {
          status: "failed",
          exitCode: 1,
          errorCode: "runtime_process_failed",
          errorMessage: "Runner exited with code 1.",
        }
      case "canceled":
        return {
          status: "canceled",
          exitCode: 5,
          errorCode: "job_canceled",
          errorMessage: "Runner canceled.",
        }
      default:
        return {
          status: "interrupted",
          exitCode: 1,
          errorCode: "runtime_interrupted",
          errorMessage: "Runner interrupted.",
        }
    }
  }
}

describe("S04 runner facade reports the committed completion (normalized-output.json terminal statuses)", () => {
  test("each terminal status returns the committed completed sequence and final status from readOutcome, and later records are diagnostic-only", async () => {
    expect(NORMALIZED_OUTPUT.terminalStatuses).toEqual([
      "succeeded",
      "failed",
      "canceled",
      "interrupted",
    ])
    for (const status of NORMALIZED_OUTPUT.terminalStatuses) {
      const db = createAgentJobTestDb()
      const job = await createAgentJob(db, {
        source: "cli",
        runtime: "codex",
        mode: "plan",
        cwd: process.cwd(),
        prompt: `facade ${status}`,
      })
      const result = await runPersistedAgentJob({
        db,
        jobId: job.id,
        runner: runnerFor(status),
        env: {},
        workerPid: null,
      })
      const completed = listAgentJobEvents(db, job.id).filter(
        (event) => event.type === "completed",
      )
      expect(completed).toHaveLength(1)
      expect(result.job.status).toBe(status)
      expect(result.outcome).toMatchObject({
        status,
        completedSequence: completed[0].sequence,
      })

      const reopened = await getOrCreateRunEventLedger(db, job)
      expect(await reopened.readOutcome()).toEqual(result.outcome)
      await reopened.ingestRuntimeObservation({
        observationKey: `facade-late:${status}`,
        type: "status",
        payload: { status: "late" },
      })
      releaseRunEventLedger(db, job.id)
      const after = listAgentJobEvents(db, job.id).filter(
        (event) => event.sequence > completed[0].sequence,
      )
      expect(after.length).toBeGreaterThan(0)
      for (const event of after) {
        expect(event.type).toBe("status")
        expect(JSON.parse(event.payloadJson)).toMatchObject({
          subtype: "late_event",
          diagnosticOnly: true,
          terminalSequence: completed[0].sequence,
        })
      }
    }
  })
})

describe("S06 headless process emits coarse output (coarse-process.json)", () => {
  test("the coarse ingress port returns sanitized records preserving the coarse source with no invented native identity, and the job store persists exactly those records", async () => {
    const db = createAgentJobTestDb()
    const job = await createAgentJob(db, {
      source: "cli",
      runtime: COARSE.runtimeId as "claude-code",
      mode: "agent",
      cwd: process.cwd(),
      prompt: "coarse process",
    })
    await startAgentJob(db, {
      jobId: job.id,
      workerId: "worker-coarse",
      workerPid: null,
    })
    const ledger = await getOrCreateRunEventLedger(db, job, {
      secretHints: COARSE.secretHints,
    })
    const returned: Json[] = []
    for (const row of COARSE.cases) {
      if (row.settle) {
        await ledger.settle(row.settle)
        continue
      }
      if (!row.observation) throw new Error(`${row.caseId} has no input`)
      const records = (await ledger.ingestRuntimeObservation({
        observationKey: `coarse:${row.caseId}`,
        type: row.observation.type,
        payload: row.observation.payload,
      })) as Json[]
      expect(records).toHaveLength(1)
      const [record] = records
      expect(record.type).toBe(row.expected.type)
      expect(record.payload).toMatchObject(row.expected.preserved ?? {})
      const serialized = JSON.stringify(record)
      for (const key of NATIVE_IDENTITY_KEYS) {
        expect(serialized).not.toContain(key)
      }
      for (const hint of COARSE.secretHints) {
        expect(serialized).not.toContain(hint)
      }
      if (row.expected.carriesSecret) {
        expect(serialized).toContain(String(row.expected.retainedSafeText))
      }
      returned.push(record)
    }
    releaseRunEventLedger(db, job.id)

    const rows = listAgentJobEvents(db, job.id)
    for (const record of returned) {
      const row = rows.find((entry) => entry.sequence === record.sequence)
      expect(row?.type).toBe(String(record.type))
      expect(JSON.parse(row?.payloadJson ?? "null")).toEqual(record.payload)
    }
    const hostResult = COARSE.cases.find((row) => row.settle)
    const completed = rows.filter((row) => row.type === "completed")
    expect(completed).toHaveLength(1)
    expect(JSON.parse(completed[0].payloadJson)).toMatchObject({
      status: hostResult?.expected.status,
    })
    expect(JSON.stringify(rows)).not.toContain(COARSE.secretHints[0])
  })
})
