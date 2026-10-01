import { and, eq, isNull, lt, or } from "drizzle-orm"
import type { SettleOptions } from "../agent-runtime/run-event-ledger"
import {
  getOrCreateRunEventLedger,
  recordVerifiedRunRetention,
  releaseRunEventLedger,
} from "../agent-runtime/run-event-ledger-host"
import type { AgentJob } from "../db/schema"
import { agentJobs } from "../db/schema"
import { type AgentJobDatabase, getAgentJob } from "./job-store"

/**
 * Stale-worker recovery (refactor-canonical-run-event-ledger, design
 * "Error, Completion and Late-Event Policy", tasks 4.3).
 *
 * The existing 120 s heartbeat predicate selects candidates; a same-host
 * liveness probe then decides. Only a confirmed-stopped worker (the claimed
 * PID is gone: ESRCH, its exit was observed by the same-host supervisor that
 * probes it, or the job was never claimed at all) is settled, once,
 * through the ledger's recovery evidence as a synthetic `interrupted`
 * completed; the store revalidates the probed worker identity, start and
 * heartbeat inside the commit transaction. An alive, permission-denied
 * (EPERM) or unknown worker (a claimed row without a PID) is left running and
 * reported only as a host `heartbeat_only` diagnostic: recovery is not the
 * Run's host, so it appends nothing and holds no lease. Pre-ledger
 * (ledger_version=0) rows are never written: they drain with the old build.
 */

export const DEFAULT_STALE_RUNNING_JOB_MS = 2 * 60 * 1000

export type JobRecoveryDiagnostic = {
  jobId: string
  confidence: "heartbeat_only"
  basis: "worker_alive" | "worker_permission_denied" | "worker_unknown"
  message: string
}

export type RecoverStaleAgentJobsOptions = {
  /** Host-only diagnostics (e.g. the CLI command's stderr); never persisted. */
  onDiagnostic?: (diagnostic: JobRecoveryDiagnostic) => void
  /**
   * Same-host liveness probe; defaults to `process.kill(pid, 0)`. A
   * supervisor that observed the claimed worker process exit reports
   * `exited` (confirmed, basis `worker_exit_observed`).
   */
  probeProcess?: (
    pid: number,
  ) => "alive" | "absent" | "exited" | "denied" | "unknown"
}

type RecoveryDecision =
  | { kind: "confirmed"; basis: string }
  | { kind: "heartbeat_only"; basis: JobRecoveryDiagnostic["basis"] }

function probeSameHostProcess(
  pid: number,
): "alive" | "absent" | "denied" | "unknown" {
  if (!Number.isSafeInteger(pid) || pid <= 0) return "unknown"
  try {
    process.kill(pid, 0)
    return "alive"
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : null
    if (code === "ESRCH") return "absent"
    if (code === "EPERM") return "denied"
    return "unknown"
  }
}

function decide(
  job: AgentJob,
  probe: NonNullable<RecoverStaleAgentJobsOptions["probeProcess"]>,
): RecoveryDecision {
  if (job.workerId === null && job.workerPid === null) {
    return { kind: "confirmed", basis: "never_claimed" }
  }
  if (job.workerPid === null) {
    return { kind: "heartbeat_only", basis: "worker_unknown" }
  }
  switch (probe(job.workerPid)) {
    case "absent":
      return { kind: "confirmed", basis: "worker_process_absent" }
    case "exited":
      return { kind: "confirmed", basis: "worker_exit_observed" }
    case "alive":
      return { kind: "heartbeat_only", basis: "worker_alive" }
    case "denied":
      return { kind: "heartbeat_only", basis: "worker_permission_denied" }
    default:
      return { kind: "heartbeat_only", basis: "worker_unknown" }
  }
}

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

const RECOVERY_EVIDENCE = {
  policy: { denied: false, evidenceKeys: [] },
  output: { valid: false, empty: true, allowEmpty: false, evidenceKeys: [] },
  postRun: { credentialsSafe: true, evidenceKeys: [] },
}

/**
 * Recovers stale running ledger jobs. Returns the jobs this pass settled
 * `interrupted` (confirmed-stopped workers only).
 */
export async function recoverStaleAgentJobs(
  db: AgentJobDatabase,
  now = new Date(),
  options: RecoverStaleAgentJobsOptions = {},
): Promise<AgentJob[]> {
  const staleBefore = new Date(now.getTime() - DEFAULT_STALE_RUNNING_JOB_MS)
  const probe = options.probeProcess ?? probeSameHostProcess
  const candidates = db
    .select()
    .from(agentJobs)
    .where(
      and(
        eq(agentJobs.status, "running"),
        eq(agentJobs.ledgerVersion, 1),
        or(
          isNull(agentJobs.heartbeatAt),
          lt(agentJobs.heartbeatAt, staleBefore),
        ),
      ),
    )
    .all()

  const recovered: AgentJob[] = []
  for (const job of candidates) {
    const decision = decide(job, probe)
    if (decision.kind === "heartbeat_only") {
      options.onDiagnostic?.({
        jobId: job.id,
        confidence: "heartbeat_only",
        basis: decision.basis,
        message: `Job ${job.id} has a stale heartbeat but its worker is not confirmed stopped (${decision.basis}); recovery confidence heartbeat_only, left running.`,
      })
      continue
    }
    const precondition: SettleOptions["jobPrecondition"] = {
      status: "running",
      workerId: job.workerId,
      workerPid: job.workerPid,
      workerStartedAt: isoOrNull(job.workerStartedAt),
      heartbeatAt: isoOrNull(job.heartbeatAt),
    }
    try {
      const ledger = await getOrCreateRunEventLedger(db, job)
      await ledger.settle(
        {
          trigger: {
            kind: "recovery",
            reason: "worker_stopped",
            observationKey: `recovery:${job.id}:${job.workerId ?? "unclaimed"}`,
            confidence: "confirmed",
            basis: decision.basis,
            observedAt: now.toISOString(),
          },
          ...RECOVERY_EVIDENCE,
        },
        {
          jobPrecondition: precondition,
          jobFields: () => ({
            errorCode: "worker_interrupted",
            errorMessage: "Worker stopped before the job finished.",
          }),
        },
      )
      releaseRunEventLedger(db, job.id)
      const settled = getAgentJob(db, job.id)
      if (settled && settled.status === "interrupted") {
        // Recovery registers no terminal refs: retention starts at the
        // settlement (design D4/D5).
        recordVerifiedRunRetention(db, job.id)
        recovered.push(settled)
      }
    } catch {
      // A changed claim/heartbeat at commit or a concurrent terminal means the
      // worker is not confirmed stopped any more; nothing is written.
      releaseRunEventLedger(db, job.id)
    }
  }
  return recovered
}
