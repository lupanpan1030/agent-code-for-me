import type { AgentJob } from "../db/schema"
import {
  type AgentJobDatabase,
  acknowledgeRunEventProjection,
  appendExactRunEventBatch,
  type ExactRunEventJobMutation,
  type ExactRunEventRecord,
  getAgentJob,
  lookupCommittedRunEventFact,
  readCommittedRunEvents,
  readRunEventLedgerHeader,
  readRunEventProjectionCursor,
} from "../headless/job-store"
import {
  type CanonicalRunEventLedger,
  createCanonicalRunEventLedger,
  type DurableStorePort,
  type ExecutionProvenance,
  type LedgerClock,
  type LedgerProjection,
} from "./run-event-ledger"
import type { JsonValue } from "./runtime-events"

/**
 * Host composition of the canonical Run event ledger
 * (refactor-canonical-run-event-ledger, design "Current Owner to Target
 * Mapping" / "Migration Plan").
 *
 * This is the single host entry for existing lifecycle callers: it composes
 * one ledger per existing job ID with the SQLite job-store adapter (the only
 * importer of `appendExactRunEventBatch`), the artifact owner and the
 * host-supplied projections. It never mints job or Run IDs and keeps no lease
 * registry; the per-process map only ensures one ledger per Run in this host.
 */

/**
 * @deprecated Temporary build-time selector of refactor-canonical-run-event-
 * ledger. `false` keeps every inventory caller on the unchanged legacy path;
 * the Phase II cutover converts all callers as one reviewed change, flips it
 * and then deletes this constant, the legacy branch and the transition guard
 * mode before acceptance. It has no renderer, environment or request control.
 */
export const canonicalRunEventLedgerV1 = false

/** The durableStore port over the SQLite job store for one existing job. */
export function createJobStoreDurableStore(
  db: AgentJobDatabase,
  jobId: string,
): DurableStorePort {
  const assertRun = (runId: string) => {
    if (runId !== jobId) {
      throw new Error("Ledger store adapter is bound to another job")
    }
  }
  return {
    appendExact(input) {
      return appendExactRunEventBatch(db, {
        jobId,
        records: input.records as ExactRunEventRecord[],
        expectedHighWater: input.expectedHighWater,
        ...(input.jobMutation
          ? { jobMutation: input.jobMutation as ExactRunEventJobMutation }
          : {}),
        ...(input.artifactRefs
          ? { artifactRefs: input.artifactRefs as JsonValue[] }
          : {}),
      })
    },
    lookupFact(observationKey) {
      return lookupCommittedRunEventFact(db, jobId, observationKey)
    },
    read(runId, afterSequence = 0) {
      assertRun(runId)
      return readCommittedRunEvents(db, jobId, afterSequence)
    },
    readHeader(runId) {
      assertRun(runId)
      return readRunEventLedgerHeader(db, jobId)
    },
    cursor(runId, projectionName) {
      assertRun(runId)
      return readRunEventProjectionCursor(db, jobId, projectionName)
    },
    ack(runId, projectionName, sequence) {
      assertRun(runId)
      acknowledgeRunEventProjection(db, jobId, projectionName, sequence)
    },
  }
}

/** A host projector; the host delegates its cursor/ack to the job store. */
export type HostRunEventProjector = {
  name: string
  deliver: LedgerProjection["deliver"]
}

export type GetOrCreateRunEventLedgerOptions = {
  secretHints?: readonly string[]
  projections?: readonly HostRunEventProjector[]
  artifactOwner?: unknown
  clock?: LedgerClock
  onHostDiagnostic?: (diagnostic: { code: string; message: string }) => void
}

const hostLedgers = new WeakMap<
  AgentJobDatabase,
  Map<string, CanonicalRunEventLedger>
>()

function storedProvenance(job: AgentJob): ExecutionProvenance {
  if (job.ledgerProvenanceJson) {
    try {
      const parsed = JSON.parse(job.ledgerProvenanceJson) as unknown
      if (parsed && typeof parsed === "object") {
        return parsed as ExecutionProvenance
      }
    } catch {
      // A malformed stored tuple fails closed through ledger validation.
    }
  }
  return { kind: "pending", runtimeId: job.runtime }
}

/**
 * Returns this host's one ledger for an existing job, composing it on first
 * use. The job must already exist and be a ledger (v1) job; historical v0
 * jobs are never extended.
 */
export async function getOrCreateRunEventLedger(
  db: AgentJobDatabase,
  existingJob: Pick<AgentJob, "id">,
  options: GetOrCreateRunEventLedgerOptions = {},
): Promise<CanonicalRunEventLedger> {
  let ledgers = hostLedgers.get(db)
  if (!ledgers) {
    ledgers = new Map()
    hostLedgers.set(db, ledgers)
  }
  const existing = ledgers.get(existingJob.id)
  if (existing) return existing
  const job = getAgentJob(db, existingJob.id)
  if (!job) throw new Error(`Unknown job: ${existingJob.id}`)
  if (job.ledgerVersion !== 1) {
    throw new Error(`Job ${job.id} is pre-ledger history and is not extended`)
  }
  const ledger = createCanonicalRunEventLedger({
    runId: job.id,
    runtimeId: job.runtime,
    source: job.source,
    provenance: storedProvenance(job),
    ...(options.clock ? { clock: options.clock } : {}),
    redactionContext: { secretHints: [...(options.secretHints ?? [])] },
    durableStore: createJobStoreDurableStore(db, job.id),
    projections: (options.projections ?? []).map((projector) => ({
      name: projector.name,
      deliver: (record) => projector.deliver(record),
      cursor: () => readRunEventProjectionCursor(db, job.id, projector.name),
      ack: (sequence: number) =>
        acknowledgeRunEventProjection(db, job.id, projector.name, sequence),
    })),
    artifactOwner: options.artifactOwner ?? null,
    ...(options.onHostDiagnostic
      ? { onHostDiagnostic: options.onHostDiagnostic }
      : {}),
  })
  ledgers.set(job.id, ledger)
  return ledger
}

/** Drops this host's ledger for a job (e.g. after its terminal projection). */
export function releaseRunEventLedger(
  db: AgentJobDatabase,
  jobId: string,
): void {
  hostLedgers.get(db)?.delete(jobId)
}

/**
 * Host-only execution binding: the launch caller hands the tuple it captured
 * through run-provenance.ts; only the host binds it to the Run's ledger.
 */
export async function bindRunExecutionProvenance(
  ledger: CanonicalRunEventLedger,
  provenance: ExecutionProvenance,
): Promise<void> {
  await ledger.bindExecutionProvenance(provenance)
}
