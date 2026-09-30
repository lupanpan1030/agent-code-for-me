/**
 * Implementer unit tests for the S24 recovery variants the acceptance suite
 * does not cover (refactor-canonical-run-event-ledger core scenario
 * "Pre-start cancel and dead-worker recovery settle through ledger";
 * red-receipt §6: supervisor-observed exit, unknown host and a changed claim
 * or heartbeat at commit). The confirmed ESRCH / never-claimed / alive /
 * EPERM / claimed-without-PID paths stay in the immutable
 * run-event-ledger-terminal.test.ts.
 */
import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { agentJobs } from "../src/main/lib/db/schema"
import {
  type JobRecoveryDiagnostic,
  recoverStaleAgentJobs,
} from "../src/main/lib/headless/job-recovery"
import {
  createAgentJob,
  getAgentJob,
  listAgentJobEvents,
  startAgentJob,
} from "../src/main/lib/headless/job-store"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

const NOW = new Date("2026-10-01T12:00:00.000Z")
const STALE_HEARTBEAT = new Date(NOW.getTime() - 10 * 60 * 1000)

async function staleRunningJob(workerPid: number | null = 4242) {
  const db = createAgentJobTestDb()
  const job = await createAgentJob(db, {
    source: "cli",
    runtime: "codex",
    mode: "plan",
    cwd: process.cwd(),
    prompt: "recovery variant",
  })
  await startAgentJob(db, {
    jobId: job.id,
    workerId: "worker-original",
    workerPid,
    now: STALE_HEARTBEAT,
  })
  db.update(agentJobs)
    .set({ heartbeatAt: STALE_HEARTBEAT, workerStartedAt: STALE_HEARTBEAT })
    .where(eq(agentJobs.id, job.id))
    .run()
  return { db, jobId: job.id }
}

function events(db: ReturnType<typeof createAgentJobTestDb>, jobId: string) {
  return listAgentJobEvents(db, jobId).map((event) => ({
    sequence: event.sequence,
    type: event.type,
    payload: JSON.parse(event.payloadJson) as Record<string, unknown>,
  }))
}

describe("S24 recovery variants", () => {
  test("a supervisor-observed worker exit is confirmed: one completed(interrupted) with synthetic.source=recovery and basis worker_exit_observed", async () => {
    const { db, jobId } = await staleRunningJob()
    const probed: number[] = []

    const recovered = await recoverStaleAgentJobs(db, NOW, {
      probeProcess: (pid) => {
        probed.push(pid)
        return "exited"
      },
    })

    expect(probed).toEqual([4242])
    expect(recovered.map((job) => job.id)).toEqual([jobId])
    expect(getAgentJob(db, jobId)?.status).toBe("interrupted")
    const completed = events(db, jobId).filter(
      (event) => event.type === "completed",
    )
    expect(completed).toHaveLength(1)
    expect(completed[0].payload).toMatchObject({
      status: "interrupted",
      synthetic: { source: "recovery" },
      recovery: { confidence: "confirmed", basis: "worker_exit_observed" },
    })

    // A second pass finds nothing to settle.
    expect(
      await recoverStaleAgentJobs(db, NOW, { probeProcess: () => "exited" }),
    ).toEqual([])
    expect(
      events(db, jobId).filter((event) => event.type === "completed"),
    ).toHaveLength(1)
  })

  test("an unknown or unsupported host probe leaves the row running with a heartbeat_only diagnostic and appends nothing", async () => {
    const { db, jobId } = await staleRunningJob()
    const before = events(db, jobId)
    const diagnostics: JobRecoveryDiagnostic[] = []

    const recovered = await recoverStaleAgentJobs(db, NOW, {
      probeProcess: () => "unknown",
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    })

    expect(recovered).toEqual([])
    expect(getAgentJob(db, jobId)?.status).toBe("running")
    expect(events(db, jobId)).toEqual(before)
    expect(diagnostics).toMatchObject([
      { jobId, confidence: "heartbeat_only", basis: "worker_unknown" },
    ])
  })

  test("a heartbeat or claim that changes between the probe and the commit invalidates recovery admission: nothing is written", async () => {
    for (const change of ["heartbeat", "claim"] as const) {
      const { db, jobId } = await staleRunningJob()
      const before = events(db, jobId)

      const recovered = await recoverStaleAgentJobs(db, NOW, {
        probeProcess: () => {
          // The worker (or a new claim) touches the row after the probe
          // decided, before the settlement transaction commits.
          db.update(agentJobs)
            .set(
              change === "heartbeat"
                ? { heartbeatAt: NOW }
                : { workerId: "worker-reclaimed", workerPid: 5151 },
            )
            .where(eq(agentJobs.id, jobId))
            .run()
          return "absent"
        },
      })

      expect(recovered).toEqual([])
      const job = getAgentJob(db, jobId)
      expect(job?.status).toBe("running")
      expect(job?.finishedAt ?? null).toBeNull()
      expect(events(db, jobId)).toEqual(before)
    }
  })
})
