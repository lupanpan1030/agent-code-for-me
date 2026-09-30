import { isAbsolute, resolve } from "node:path"
import type { AgentJob } from "../db/schema"
import {
  type AgentJobDatabase,
  acknowledgeRunEventProjection,
  appendExactRunEventBatch,
  type ExactRunEventJobMutation,
  type ExactRunEventJobPrecondition,
  type ExactRunEventRecord,
  getAgentJob,
  lookupCommittedRunEventFact,
  readCommittedRunEvents,
  readRunEventLedgerHeader,
  readRunEventProjectionCursor,
} from "../headless/job-store"
import { decodeDesktopStreamChunk } from "./ledger-ingress"
import { redactRuntimePayload } from "./redaction"
import {
  admitRunArtifactCandidate,
  admitRunArtifactContent,
  type RunArtifactRunDir,
  runArtifactMediaType,
} from "./run-artifacts"
import {
  type CanonicalRunEventLedger,
  createCanonicalRunEventLedger,
  type DurableStorePort,
  type ExecutionProvenance,
  type LedgerClock,
  type LedgerProjection,
  RunEventLedgerError,
  type TerminalProjectionRegistration,
} from "./run-event-ledger"
import type { JsonValue, RunEvent } from "./runtime-events"
import { projectRunEventToRendererChunks } from "./stream-event-mapper"

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

/** The host-composed ledger a desktop runtime adapter ingests into. */
export type CanonicalDesktopRunLedger = CanonicalRunEventLedger

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
        ...(input.jobPrecondition
          ? {
              jobPrecondition:
                input.jobPrecondition as ExactRunEventJobPrecondition,
            }
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

/**
 * A host projector. Durable projectors delegate cursor/ack to the job store;
 * a transient projector (a live renderer subscription) supplies its own
 * starting cursor and keeps no durable acknowledgement.
 */
export type HostRunEventProjector = {
  name: string
  deliver: LedgerProjection["deliver"]
  transientCursor?: number
}

function hostProjection(
  db: AgentJobDatabase,
  jobId: string,
  projector: HostRunEventProjector,
): LedgerProjection {
  if (projector.transientCursor !== undefined) {
    const cursor = projector.transientCursor
    return {
      name: projector.name,
      deliver: (record) => projector.deliver(record),
      cursor: () => cursor,
      ack: () => {},
    }
  }
  return {
    name: projector.name,
    deliver: (record) => projector.deliver(record),
    cursor: () => readRunEventProjectionCursor(db, jobId, projector.name),
    ack: (sequence: number) =>
      acknowledgeRunEventProjection(db, jobId, projector.name, sequence),
  }
}

export type GetOrCreateRunEventLedgerOptions = {
  secretHints?: readonly string[]
  projections?: readonly HostRunEventProjector[]
  artifactOwner?: unknown
  clock?: LedgerClock
  onHostDiagnostic?: (diagnostic: { code: string; message: string }) => void
} & TerminalProjectionRegistration

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
  if (existing) {
    // The executing host registers the Run's terminal projection once; a
    // differing re-registration on the cached ledger is rejected.
    existing.registerTerminalProjection({
      terminalArtifacts: options.terminalArtifacts,
      terminalJobFields: options.terminalJobFields,
    })
    existing.addSecretHints(options.secretHints ?? [])
    for (const projector of options.projections ?? []) {
      await existing.attachProjection(
        hostProjection(db, existingJob.id, projector),
      )
    }
    return existing
  }
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
    projections: (options.projections ?? []).map((projector) =>
      hostProjection(db, job.id, projector),
    ),
    artifactOwner: options.artifactOwner ?? null,
    ...(options.terminalArtifacts
      ? { terminalArtifacts: options.terminalArtifacts }
      : {}),
    ...(options.terminalJobFields
      ? { terminalJobFields: options.terminalJobFields }
      : {}),
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

// ---------------------------------------------------------------------------
// Native artifact candidates (design "Artifacts and Terminal Commit Order";
// codex-runtime-parity: `turn/diff/updated`, `imageGeneration.savedPath` and
// `fileChange` paths only feed artifact candidates). The host composes one
// sink per Run that has an admitted run directory and hands every candidate
// to the run artifact owner; it never mints an artifact event itself and
// grants no filesystem scope beyond that directory.
// ---------------------------------------------------------------------------

/** Runtime-neutral native candidate evidence decoded by an adapter. */
export type NativeArtifactEvidence =
  | {
      role: "native-file" | "native-image"
      /** Native path (relative paths resolve against the Run's cwd). */
      path: string
      /** Native evidence identity (e.g. item id and change index). */
      sourceKey: string
    }
  | {
      role: "native-diff"
      /** Turn whose latest cumulative diff this is. */
      turnId: string
      diff: string
    }

export type RunArtifactCandidateSink = {
  /** Submits one piece of evidence; a diff is kept until its turn flushes. */
  observe(evidence: NativeArtifactEvidence): void
  /**
   * Submits the latest diff of one turn. Adapters call it before they submit
   * the turn's terminal notification, so the admission precedes completed.
   */
  flushTurn(turnId: string): void
  /** Flushes every pending diff and resolves once all admissions settled. */
  drain(): Promise<void>
}

export function createRunArtifactCandidateSink(input: {
  ledger: CanonicalRunEventLedger
  runId: string
  runDir: RunArtifactRunDir
  cwd: string
  onHostDiagnostic?: (message: string) => void
}): RunArtifactCandidateSink {
  const pendingDiffs = new Map<string, string>()
  const admissions = new Set<Promise<unknown>>()
  let stagedDiffs = 0
  const track = (admission: () => Promise<unknown>) => {
    let promise: Promise<unknown>
    try {
      // Called synchronously so the owner's ledger submission is ordered
      // with the adapter's own boundary submissions.
      promise = admission()
    } catch (error) {
      promise = Promise.reject(error)
    }
    const settled = promise.then(
      () => undefined,
      (error: unknown) => {
        input.onHostDiagnostic?.(
          `[artifacts] native artifact candidate was not recorded (${
            error instanceof RunEventLedgerError ? error.code : "error"
          }).`,
        )
      },
    )
    admissions.add(settled)
    void settled.finally(() => admissions.delete(settled))
  }
  const flushTurn = (turnId: string) => {
    const diff = pendingDiffs.get(turnId)
    pendingDiffs.delete(turnId)
    if (diff === undefined || diff.length === 0) return
    stagedDiffs += 1
    const fileName = `native-diff-${stagedDiffs}.patch`
    track(() =>
      admitRunArtifactContent(
        {
          role: "native-diff",
          fileName,
          text: diff,
          media: "text/x-diff",
          sourceKey: `turn-diff:${stagedDiffs}`,
        },
        { runId: input.runId, runDir: input.runDir, ledger: input.ledger },
      ),
    )
  }
  return {
    observe(evidence) {
      if (evidence.role === "native-diff") {
        pendingDiffs.set(evidence.turnId, evidence.diff)
        return
      }
      if (typeof evidence.path !== "string" || evidence.path.length === 0) {
        return
      }
      const path = isAbsolute(evidence.path)
        ? evidence.path
        : resolve(input.cwd, evidence.path)
      track(() =>
        admitRunArtifactCandidate(
          {
            path,
            ownerRunId: input.runId,
            media: runArtifactMediaType(path),
            role: evidence.role,
            sourceKey: evidence.sourceKey,
          },
          {
            runId: input.runId,
            // The run directory's stable handle is the admission authority.
            runDir: input.runDir,
            ledger: input.ledger,
          },
        ),
      )
    },
    flushTurn,
    async drain() {
      for (const turnId of [...pendingDiffs.keys()]) flushTurn(turnId)
      while (admissions.size > 0) {
        await Promise.allSettled([...admissions])
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Desktop live renderer channel (design "Current Owner to Target Mapping":
// desktop Claude/Codex wiring uses the same host ledger and the committed
// renderer projection).
//
// Durable stream input reaches the renderer only as the projection of the
// records the Run's ledger committed (projectRunEventToRendererChunks), in
// submission order; renderer framing and interaction chunks that carry no
// durable fact are redacted with the Run's exact hints (redaction.ts) and
// emitted at their place in that order. Before a desktop job exists (e.g. a
// preflight blocker) there is no ledger and every chunk is renderer-only.
// ---------------------------------------------------------------------------

/** Projection chunks the chat renderer does not consume. */
const NON_CHAT_PROJECTION_CHUNKS = new Set([
  "data-run-event",
  "data-item-reconciliation",
])

export type DesktopRendererChannel = {
  /** Submits one renderer-bound chunk of the live desktop stream. */
  submit(chunk: Record<string, unknown>): void
  /**
   * Emits the committed projection of records an adapter committed through
   * a native ledger port, in order with submitted chunks.
   */
  deliverCommitted(committed: Promise<unknown>): void
  /** Resolves after every submitted chunk was emitted or dropped. */
  drain(): Promise<void>
}

export function createDesktopRendererChannel(input: {
  runtimeId: RunEvent["runtimeId"]
  runId: string
  observationPrefix: string
  getLedger: () => CanonicalRunEventLedger | null
  getSecretHints?: () => readonly string[]
  emit: (chunk: Record<string, unknown>) => void
  onHostDiagnostic?: (message: string) => void
}): DesktopRendererChannel {
  let chain: Promise<void> = Promise.resolve()
  let counter = 0
  let pendingDurable = 0
  const track = (work: () => Promise<void>) => {
    pendingDurable += 1
    chain = chain.then(work).finally(() => {
      pendingDurable -= 1
    })
  }
  const emitSafely = (chunk: Record<string, unknown>) => {
    try {
      input.emit(chunk)
    } catch {
      // The renderer sink owns its own inactive state.
    }
  }
  const emitCommitted = async (
    committed: Promise<unknown>,
    bufferedChunk?: Record<string, unknown>,
  ) => {
    let records: unknown
    try {
      records = await committed
    } catch (error) {
      input.onHostDiagnostic?.(
        `[desktop] stream observation was not recorded (${
          error instanceof RunEventLedgerError ? error.code : "error"
        }).`,
      )
      return
    }
    if (!Array.isArray(records)) return
    if (records.length === 0 && bufferedChunk) {
      // After the native terminal candidate the ledger buffers the fact as a
      // post-terminal late diagnostic; the live renderer still receives the
      // redacted chunk at its place in the stream.
      emitSafely(redactRendererOnly(bufferedChunk))
      return
    }
    for (const record of records) {
      for (const chunk of projectRunEventToRendererChunks(record)) {
        if (!NON_CHAT_PROJECTION_CHUNKS.has(chunk.type)) emitSafely(chunk)
      }
    }
  }
  function redactRendererOnly(
    chunk: Record<string, unknown>,
  ): Record<string, unknown> {
    const redacted = redactRuntimePayload(
      JSON.parse(JSON.stringify(chunk)) as JsonValue,
      {
        runtimeId: input.runtimeId,
        runId: input.runId,
        source: "runtime-diagnostic",
        secretHints: input.getSecretHints?.() ?? [],
      },
    ).payload
    return redacted && typeof redacted === "object" && !Array.isArray(redacted)
      ? { ...(redacted as Record<string, unknown>), type: chunk.type }
      : { type: chunk.type }
  }
  return {
    submit(chunk) {
      const ledger = input.getLedger()
      const decoded = ledger
        ? decodeDesktopStreamChunk(chunk)
        : ({ kind: "renderer_only" } as const)
      if (ledger && decoded.kind === "observation") {
        counter += 1
        const committed = ledger.ingestRuntimeObservation({
          observationKey: `${input.observationPrefix}:${counter}`,
          type: decoded.type,
          payload: decoded.payload,
        })
        track(() => emitCommitted(committed, chunk))
        return
      }
      const redacted = redactRendererOnly(chunk)
      if (pendingDurable === 0) {
        // Nothing durable is in flight: framing keeps its synchronous order.
        emitSafely(redacted)
        return
      }
      chain = chain.then(() => emitSafely(redacted))
    },
    deliverCommitted(committed) {
      track(() => emitCommitted(committed))
    },
    drain() {
      return chain
    },
  }
}
