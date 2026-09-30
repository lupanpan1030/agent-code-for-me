/** biome-ignore-all lint/suspicious/noExplicitAny: the ledger contract under test does not exist yet; records are asserted structurally. */
/**
 * Domain B red suite, part 1 — terminal truth, errors, artifacts, recovery and
 * cross-process reconciliation for
 * `openspec/changes/refactor-canonical-run-event-ledger`.
 *
 * Scenarios: S21, S22, S23, S24, S25 (Diagnostic Error And Terminal
 * Invariants), S28, S29 (Canonical Artifact Admission) and S56 (Canonical Run
 * Event Ledger Ownership / cross-process queued cancel race).
 *
 * Entry points (design "Test-facing Contract" / "Current Owner to Target
 * Mapping"; never invented):
 * - `createCanonicalRunEventLedger` from NEW
 *   `src/main/lib/agent-runtime/run-event-ledger.ts` with the design's ports
 *   (`ingestNotification`, `ingestTransportExit`, `appendSystemEvent`,
 *   `settle`, `read`, `readOutcome`, `readUsage`) over the kit's in-memory
 *   `durableStore` port.
 * - `admitRunArtifactCandidate` from NEW
 *   `src/main/lib/agent-runtime/run-artifacts.ts`.
 * - Existing lifecycle entries that the design routes through the host
 *   ledger: `recoverStaleAgentJobs` (headless/job-recovery.ts),
 *   `runHeadlessCliCommand` jobs/api-runs cancel (headless/cli-dispatcher.ts),
 *   `createAgentJob` / `startAgentJob` (headless/job-store.ts), asserted on
 *   rows of a temporary SQLite database migrated with the repository's real
 *   Drizzle migrations.
 *
 * Shape assumptions the design leaves open are stated at their use site:
 * status subtypes live in `payload.subtype`; synthetic terminal metadata in
 * `completed.payload.synthetic`; recovery confidence in
 * `completed.payload.recovery`; the run context of
 * `admitRunArtifactCandidate` is `{ runId, allowedRunDir, ledger }`.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  applyStep,
  completedRecords,
  createLedger,
  createMigratedLedgerDb,
  denseRange,
  exitedPid,
  factKeyMentions,
  factKeyOf,
  jobEventRows,
  jobRow,
  loadJsonFixture,
  loadJsonlFixture,
  loadRunArtifactsModule,
  MemoryDurableStore,
  type MigratedLedgerDb,
  parsePayload,
  recordsForKey,
  sequencesOf,
  settledResult,
  statusRecords,
} from "./run-event-ledger-domain-b-kit"

const identity = loadJsonFixture("identity-provenance.json")
const RUNTIME_PROVENANCE = identity.provenanceVariants.runtime
const PENDING_PROVENANCE = identity.provenanceVariants.pending
const INSTALLATION_ID: string = RUNTIME_PROVENANCE.installationId

const terminalEvidence = loadJsonFixture("terminal-evidence.json")
const terminalCase = (caseId: string) => {
  const found = terminalEvidence.cases.find((c: any) => c.caseId === caseId)
  if (!found) throw new Error(`terminal-evidence.json lacks ${caseId}`)
  return found
}

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

function trackDb(db: MigratedLedgerDb): MigratedLedgerDb {
  cleanups.push(() => db.close())
  return db
}

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

async function runtimeLedger(
  runId: string,
  store: MemoryDurableStore,
  secretHints: string[] = [],
) {
  return await createLedger({
    runId,
    runtimeId: "codex",
    provenance: RUNTIME_PROVENANCE,
    store,
    secretHints,
  })
}

// ---------------------------------------------------------------------------
describe("agent-runtime-core / Diagnostic Error And Terminal Invariants", () => {
  test("S21 Retry error is followed by success — the retryable error stays diagnostic evidence (classification/willRetry/code/native ids) and exactly one completed(succeeded) is returned again after reopening the store", async () => {
    const fixture = terminalCase("retry-then-success")
    const runId = "run-b-s21"
    const store = new MemoryDurableStore({ runId })
    const ledger = await runtimeLedger(runId, store)
    for (const step of fixture.steps) await applyStep(ledger, step)
    await ledger.settle(fixture.evidence)

    const records = await ledger.read(0)
    const errors = records.filter((record: any) => record.type === "error")
    expect(errors).toHaveLength(1)
    expect(errors[0].payload).toMatchObject({
      classification: "retryable",
      willRetry: true,
      code: "retryable",
    })
    expect(errors[0].payload.extensions?.["runtime.codex.v1"]).toMatchObject({
      threadId: "th",
      turnId: "tu",
    })
    const completed = completedRecords(records)
    expect(completed).toHaveLength(1)
    expect(completed[0].payload).toMatchObject({ status: "succeeded" })
    expect(errors[0].sequence).toBeLessThan(completed[0].sequence)
    expect(sequencesOf(records)).toEqual(denseRange(records.length))

    const reopened = await runtimeLedger(runId, store)
    expect(await reopened.readOutcome()).toMatchObject({
      status: "succeeded",
      completedSequence: completed[0].sequence,
    })
    expect(completedRecords(await reopened.read(0))).toHaveLength(1)
  })

  test("S22 Denial rejection and empty output have deterministic outcomes — denial/output-invalid/empty-not-allowed/empty-allowed/credential-failed/cancel/interrupt rows settle failed/failed/failed/succeeded/failed/canceled/interrupted with reasons/evidenceKeys and one completed each; a success trigger without output evidence is not succeeded", async () => {
    const rows = [
      "denial",
      "output-invalid",
      "empty-not-allowed",
      "empty-allowed",
      "credential-failed",
      "cancel",
      "interrupt",
      "success-missing-output-evidence",
    ].map(terminalCase)
    const expected = rows.map((row: any) => ({
      caseId: row.caseId,
      status: row.expected.status,
      completedStatuses: [row.expected.status],
      ...(row.expected.status === "failed" ? { hasReasons: true } : {}),
      ...(row.expected.evidenceKeys ? { carriesEvidenceKeys: true } : {}),
    }))

    const observed: unknown[] = []
    for (const row of rows) {
      const runId = `run-b-s22-${row.caseId}`
      const store = new MemoryDurableStore({ runId })
      const ledger = await runtimeLedger(runId, store)
      for (const step of row.steps) await applyStep(ledger, step)
      await ledger.settle(row.evidence)
      const outcome = await ledger.readOutcome()
      const records = await ledger.read(0)
      observed.push({
        caseId: row.caseId,
        status: outcome?.status,
        completedStatuses: completedRecords(records).map(
          (record: any) => record.payload?.status,
        ),
        ...(row.expected.status === "failed"
          ? {
              hasReasons:
                Array.isArray(outcome?.reasons) && outcome.reasons.length > 0,
            }
          : {}),
        ...(row.expected.evidenceKeys
          ? {
              carriesEvidenceKeys: row.expected.evidenceKeys.every(
                (key: string) => (outcome?.evidenceKeys ?? []).includes(key),
              ),
            }
          : {}),
      })
    }
    expect(observed).toEqual(expected)
  })

  test("S23 Transport exit synthesizes one terminal — exit before live completion settles one completed(interrupted) carrying synthetic.source=transport_exit, transportId/exit/signal and installation provenance; duplicate/second exits and the later native completed are late_event diagnostics; no same-Run replacement port exists", async () => {
    const { lines } = loadJsonlFixture("transport-exit.jsonl")
    const variant = lines.filter(
      (line) => line.variant === "exit-before-completion",
    )
    const runId = "run-b-s23"
    const store = new MemoryDurableStore({ runId })
    const ledger = await runtimeLedger(runId, store)

    const countsAfter: Record<string, number> = {}
    for (const line of variant) {
      await applyStep(ledger, line)
      countsAfter[line.caseId] = (await ledger.read(0)).length
    }
    expect(countsAfter["exit-duplicate-same-key"]).toBe(countsAfter.exit)

    const records = await ledger.read(0)
    const completed = completedRecords(records)
    expect(completed).toHaveLength(1)
    expect(completed[0].payload).toMatchObject({ status: "interrupted" })
    expect(completed[0].payload.synthetic).toMatchObject({
      source: "transport_exit",
      transportId: "t1",
      exitCode: 1,
      signal: "SIGINT",
    })
    expect(JSON.stringify(completed[0])).toContain(INSTALLATION_ID)
    expect(await ledger.readOutcome()).toMatchObject({ status: "interrupted" })

    for (const key of ["tx-exit-2", "tx-late-term"]) {
      const late = recordsForKey(records, key)
      expect(late.length).toBeGreaterThan(0)
      for (const record of late) {
        expect(record.type).toBe("status")
        expect(record.payload).toMatchObject({
          subtype: "late_event",
          diagnosticOnly: true,
          terminalSequence: completed[0].sequence,
        })
        expect(record.sequence).toBeGreaterThan(completed[0].sequence)
      }
    }
    expect(sequencesOf(records)).toEqual(denseRange(records.length))
    expect(ledger.beginTransportReplacement).toBeUndefined()
    expect(ledger.bindReplacementTransport).toBeUndefined()
  })

  test("S23 Transport exit synthesizes one terminal — post-seal-exit variants keep the prior succeeded/failed terminal and record only a status/late_event referencing it, never an interrupted completed", async () => {
    const { lines } = loadJsonlFixture("transport-exit.jsonl")
    const observed: unknown[] = []
    const expected: unknown[] = []
    for (const variantName of [
      "post-seal-exit-failed",
      "post-seal-exit-succeeded",
    ]) {
      const variant = lines.filter((line) => line.variant === variantName)
      const exitLine = variant.find((line) => line.caseId === "exit-after-seal")
      if (!exitLine) throw new Error(`${variantName} lacks exit-after-seal`)
      const runId = `run-b-s23-${variantName}`
      const store = new MemoryDurableStore({ runId })
      const ledger = await runtimeLedger(runId, store)
      for (const line of variant) await applyStep(ledger, line)
      const records = await ledger.read(0)
      const completed = completedRecords(records)
      const lateForExit = recordsForKey(records, exitLine.observationKey)
      observed.push({
        variantName,
        completedStatuses: completed.map(
          (record: any) => record.payload?.status,
        ),
        outcome: (await ledger.readOutcome())?.status,
        exitRecords: lateForExit.map((record: any) => ({
          type: record.type,
          subtype: record.payload?.subtype,
          diagnosticOnly: record.payload?.diagnosticOnly,
          terminalSequence: record.payload?.terminalSequence,
        })),
      })
      expected.push({
        variantName,
        completedStatuses: [exitLine.expected.completedStatus],
        outcome: exitLine.expected.completedStatus,
        exitRecords: [
          {
            type: "status",
            subtype: "late_event",
            diagnosticOnly: true,
            terminalSequence: completed[0]?.sequence,
          },
        ],
      })
    }
    expect(observed).toEqual(expected)
  })

  test("S24 Pre-start cancel and dead-worker recovery settle through ledger — host cancel/recovery evidence ports commit the job mutation and one completed atomically (canceled / interrupted, synthetic.source=cancel|recovery); never-started keeps pending provenance, executed recovery reuses the sealed tuple, repeated recovery adds no terminal", async () => {
    const observed: unknown[] = []
    const expected: unknown[] = []
    for (const caseId of ["queued-cancel", "dead-worker-recovery-executed"]) {
      const row = terminalCase(caseId)
      const runId = `run-b-s24-${caseId}`
      const store = new MemoryDurableStore({
        runId,
        header: { status: row.headerStatus },
      })
      const ledger = await createLedger({
        runId,
        runtimeId: "codex",
        provenance:
          row.provenance === "pending"
            ? PENDING_PROVENANCE
            : RUNTIME_PROVENANCE,
        store,
      })
      for (const step of row.steps) await applyStep(ledger, step)
      await ledger.settle(row.evidence)
      await ledger.settle({
        ...row.evidence,
        trigger: {
          ...row.evidence.trigger,
          observationKey: `${caseId}-repeat`,
        },
      })

      const records = await ledger.read(0)
      const completed = completedRecords(records)
      const terminalCommit = store.commits.find((commit) =>
        commit.records.some((record: any) => record.type === "completed"),
      )
      observed.push({
        caseId,
        completedCount: completed.length,
        status: completed[0]?.payload?.status,
        syntheticSource: completed[0]?.payload?.synthetic?.source,
        atomicJobMutation:
          typeof terminalCommit?.jobMutation === "object" &&
          terminalCommit?.jobMutation !== null,
        carriesInstallation: JSON.stringify(completed[0] ?? null).includes(
          INSTALLATION_ID,
        ),
        headerCarriesInstallation: JSON.stringify(
          store.readHeader(runId),
        ).includes(INSTALLATION_ID),
      })
      expected.push({
        caseId,
        completedCount: 1,
        status: row.expected.status,
        syntheticSource: row.expected.syntheticSource,
        atomicJobMutation: true,
        carriesInstallation: row.expected.provenanceKind === "runtime",
        headerCarriesInstallation: row.expected.provenanceKind === "runtime",
      })
    }
    expect(observed).toEqual(expected)
  })

  test("S24 Pre-start cancel and dead-worker recovery settle through ledger — CLI `jobs cancel` and `api runs cancel` of queued jobs commit one completed(canceled) with synthetic.source=cancel on a v1 job whose ledger_provenance_json stays null", async () => {
    const { runHeadlessCliCommand } = await import(
      "../src/main/lib/headless/cli-dispatcher"
    )
    const { HEADLESS_CLI_MARKER } = await import(
      "../src/main/lib/headless/cli-args"
    )
    const { createAgentJob } = await import(
      "../src/main/lib/headless/job-store"
    )
    const ledgerDb = trackDb(createMigratedLedgerDb())
    const sink = { write: (_chunk: string) => {} }

    const cliJob = await createAgentJob(ledgerDb.db, {
      source: "cli",
      runtime: "codex",
      mode: "plan",
      cwd: process.cwd(),
      prompt: "queued cli job",
    })
    const apiJob = await createAgentJob(ledgerDb.db, {
      source: "api",
      runtime: "codex",
      mode: "plan",
      cwd: process.cwd(),
      prompt: "queued api job",
      apiConsumerId: "domain-b",
      apiConsumerRunId: "cancel-queued-001",
    })
    expect(
      await runHeadlessCliCommand({
        db: ledgerDb.db,
        argv: ["Locus", HEADLESS_CLI_MARKER, "jobs", "cancel", cliJob.id],
        stdout: sink,
        stderr: sink,
      }),
    ).toBe(0)
    expect(
      await runHeadlessCliCommand({
        db: ledgerDb.db,
        argv: [
          "Locus",
          HEADLESS_CLI_MARKER,
          "api",
          "runs",
          "cancel",
          apiJob.id,
          "--json",
        ],
        stdout: sink,
        stderr: sink,
      }),
    ).toBe(0)

    const observed = [cliJob.id, apiJob.id].map((jobId) => {
      const rows = jobEventRows(ledgerDb.sqlite, jobId)
      const completed = rows.filter((row) => row.type === "completed")
      const job = jobRow(ledgerDb.sqlite, jobId)
      return {
        status: job.status,
        ledgerVersion: job.ledger_version,
        ledgerProvenanceJson: job.ledger_provenance_json,
        completedCount: completed.length,
        completedStatus: completed[0]
          ? parsePayload(completed[0]).status
          : null,
        syntheticSource: completed[0]
          ? parsePayload(completed[0]).synthetic?.source
          : null,
      }
    })
    const expectation = {
      status: "canceled",
      ledgerVersion: 1,
      ledgerProvenanceJson: null,
      completedCount: 1,
      completedStatus: "canceled",
      syntheticSource: "cancel",
    }
    expect(observed).toEqual([expectation, expectation])
  })

  const recoveryFixture = terminalEvidence.recovery
  const STALE_MS: number = recoveryFixture.staleThresholdMs
  const RECOVERY_NOW = new Date("2026-09-04T01:00:00.000Z")

  async function seedRecoveryCase(
    ledgerDb: MigratedLedgerDb,
    row: any,
    createAgentJob: any,
    startAgentJob: any,
  ) {
    const pid =
      row.workerPid === "$EXITED_PID"
        ? exitedPid()
        : row.workerPid === "$SELF_PID"
          ? process.pid
          : row.workerPid
    const job = await createAgentJob(ledgerDb.db, {
      source: "cli",
      runtime: "codex",
      mode: "plan",
      cwd: process.cwd(),
      prompt: `recovery ${row.caseId}`,
    })
    const heartbeatAt =
      row.heartbeatAgeMs === null
        ? null
        : new Date(RECOVERY_NOW.getTime() - row.heartbeatAgeMs)
    if (row.claimed) {
      await startAgentJob(ledgerDb.db, {
        jobId: job.id,
        workerId: `headless:${pid ?? "none"}:1:${job.id}`,
        workerPid: pid,
        now: heartbeatAt ?? new Date(RECOVERY_NOW.getTime() - 10 * STALE_MS),
      })
      if (heartbeatAt === null) {
        ledgerDb.sqlite
          .query("UPDATE agent_jobs SET heartbeat_at = NULL WHERE id = ?")
          .run(job.id)
      }
    } else {
      ledgerDb.sqlite
        .query(
          "UPDATE agent_jobs SET status = 'running', worker_id = NULL, worker_pid = NULL, worker_started_at = NULL, heartbeat_at = NULL WHERE id = ?",
        )
        .run(job.id)
    }
    return job.id as string
  }

  test("S24 Pre-start cancel and dead-worker recovery settle through ledger — job-recovery.ts settles only confirmed-stopped stale workers (ESRCH with stale or null heartbeat, never-claimed job) with one completed(interrupted), synthetic.source=recovery and recovery.confidence=confirmed plus basis; never-started keeps null provenance", async () => {
    const { recoverStaleAgentJobs } = await import(
      "../src/main/lib/headless/job-recovery"
    )
    const { createAgentJob, startAgentJob } = await import(
      "../src/main/lib/headless/job-store"
    )
    const rows = recoveryFixture.cases.filter(
      (row: any) => row.expected.settled,
    )
    const observed: unknown[] = []
    const expected: unknown[] = []
    for (const row of rows) {
      const ledgerDb = trackDb(createMigratedLedgerDb())
      const jobId = await seedRecoveryCase(
        ledgerDb,
        row,
        createAgentJob,
        startAgentJob,
      )
      await recoverStaleAgentJobs(ledgerDb.db, RECOVERY_NOW)
      const events = jobEventRows(ledgerDb.sqlite, jobId)
      const completed = events.filter((event) => event.type === "completed")
      const payload = completed[0] ? parsePayload(completed[0]) : null
      observed.push({
        caseId: row.caseId,
        status: jobRow(ledgerDb.sqlite, jobId).status,
        completedCount: completed.length,
        completedStatus: payload?.status,
        syntheticSource: payload?.synthetic?.source,
        confidence: payload?.recovery?.confidence,
        hasBasis:
          typeof payload?.recovery?.basis === "string" &&
          payload.recovery.basis.length > 0,
        hasObservedAt: Boolean(payload?.recovery?.observedAt),
        ...(row.caseId === "never-claimed"
          ? {
              ledgerProvenanceJson: jobRow(ledgerDb.sqlite, jobId)
                .ledger_provenance_json,
            }
          : {}),
      })
      expected.push({
        caseId: row.caseId,
        status: "interrupted",
        completedCount: 1,
        completedStatus: "interrupted",
        syntheticSource: "recovery",
        confidence: "confirmed",
        hasBasis: true,
        hasObservedAt: true,
        ...(row.caseId === "never-claimed"
          ? { ledgerProvenanceJson: null }
          : {}),
      })
    }
    expect(observed).toEqual(expected)
  })

  test("S24 Pre-start cancel and dead-worker recovery settle through ledger — alive (signal-0 ok), EPERM and claimed-worker-without-PID stale rows stay running and unsettled (heartbeat_only), with no appended record", async () => {
    const { recoverStaleAgentJobs } = await import(
      "../src/main/lib/headless/job-recovery"
    )
    const { createAgentJob, startAgentJob } = await import(
      "../src/main/lib/headless/job-store"
    )
    const rows = recoveryFixture.cases.filter(
      (row: any) =>
        !row.expected.settled && row.caseId !== "fresh-boundary-120s",
    )
    expect(rows.map((row: any) => row.caseId)).toEqual([
      "alive-self",
      "eperm-init",
      "claimed-missing-pid",
    ])
    const observed: unknown[] = []
    for (const row of rows) {
      const ledgerDb = trackDb(createMigratedLedgerDb())
      const jobId = await seedRecoveryCase(
        ledgerDb,
        row,
        createAgentJob,
        startAgentJob,
      )
      const before = jobEventRows(ledgerDb.sqlite, jobId)
      await recoverStaleAgentJobs(ledgerDb.db, RECOVERY_NOW)
      const after = jobEventRows(ledgerDb.sqlite, jobId)
      const job = jobRow(ledgerDb.sqlite, jobId)
      observed.push({
        caseId: row.caseId,
        status: job.status,
        errorCode: job.error_code,
        appendedRecords: after.length - before.length,
      })
    }
    expect(observed).toEqual(
      rows.map((row: any) => ({
        caseId: row.caseId,
        status: "running",
        errorCode: null,
        appendedRecords: 0,
      })),
    )
  })

  test("S24 Pre-start cancel and dead-worker recovery settle through ledger — repeated recovery of a confirmed-dead worker adds no second terminal (exactly one completed after two passes)", async () => {
    const { recoverStaleAgentJobs } = await import(
      "../src/main/lib/headless/job-recovery"
    )
    const { createAgentJob, startAgentJob } = await import(
      "../src/main/lib/headless/job-store"
    )
    const row = recoveryFixture.cases.find(
      (c: any) => c.caseId === "stale-esrch",
    )
    const ledgerDb = trackDb(createMigratedLedgerDb())
    const jobId = await seedRecoveryCase(
      ledgerDb,
      row,
      createAgentJob,
      startAgentJob,
    )
    await recoverStaleAgentJobs(ledgerDb.db, RECOVERY_NOW)
    await recoverStaleAgentJobs(
      ledgerDb.db,
      new Date(RECOVERY_NOW.getTime() + STALE_MS),
    )
    const completed = jobEventRows(ledgerDb.sqlite, jobId).filter(
      (event) => event.type === "completed",
    )
    expect(completed).toHaveLength(1)
    expect(parsePayload(completed[0])).toMatchObject({ status: "interrupted" })
  })

  test("S24 Pre-start cancel and dead-worker recovery settle through ledger — [green-by-design] a heartbeat exactly 120 s old is not stale, so even an exited worker PID is left running", async () => {
    const { recoverStaleAgentJobs } = await import(
      "../src/main/lib/headless/job-recovery"
    )
    const { createAgentJob, startAgentJob } = await import(
      "../src/main/lib/headless/job-store"
    )
    const row = recoveryFixture.cases.find(
      (c: any) => c.caseId === "fresh-boundary-120s",
    )
    expect(row.heartbeatAgeMs).toBe(STALE_MS)
    const ledgerDb = trackDb(createMigratedLedgerDb())
    const jobId = await seedRecoveryCase(
      ledgerDb,
      row,
      createAgentJob,
      startAgentJob,
    )
    const before = jobEventRows(ledgerDb.sqlite, jobId).length
    await recoverStaleAgentJobs(ledgerDb.db, RECOVERY_NOW)
    expect(jobRow(ledgerDb.sqlite, jobId).status).toBe("running")
    expect(jobEventRows(ledgerDb.sqlite, jobId)).toHaveLength(before)
  })

  test("S24 Pre-start cancel and dead-worker recovery settle through ledger — v0 drain gate: a pre-ledger (ledger_version=0) stale running row with an exited worker is never written by the new recovery owner; its historical rows stay byte-identical", async () => {
    const { recoverStaleAgentJobs } = await import(
      "../src/main/lib/headless/job-recovery"
    )
    const deadPid = exitedPid()
    const staleSeconds = Math.floor(
      (Date.parse("2026-09-04T01:00:00.000Z") - 10 * STALE_MS) / 1000,
    )
    const ledgerDb = trackDb(
      createMigratedLedgerDb({
        seedPreLedger(sqlite) {
          sqlite
            .query(
              "INSERT INTO agent_jobs (id, kind, source, runtime, status, mode, cwd, created_at, started_at, worker_id, worker_pid, worker_started_at, heartbeat_at) VALUES ('legacy-running', 'agent', 'cli', 'codex', 'running', 'plan', '/fixture/legacy', ?, ?, ?, ?, ?, ?)",
            )
            .run(
              staleSeconds,
              staleSeconds,
              `headless:${deadPid}:1:legacy-running`,
              deadPid,
              staleSeconds,
              staleSeconds,
            )
          sqlite
            .query(
              "INSERT INTO agent_job_events (id, job_id, sequence, type, payload_json, created_at) VALUES ('legacy-ev-1', 'legacy-running', 1, 'job_created', ?, ?), ('legacy-ev-2', 'legacy-running', 2, 'job_started', ?, ?)",
            )
            .run(
              JSON.stringify({
                kind: "agent",
                source: "cli",
                runtime: "codex",
              }),
              staleSeconds,
              JSON.stringify({
                workerId: `headless:${deadPid}:1:legacy-running`,
                workerPid: deadPid,
              }),
              staleSeconds,
            )
        },
      }),
    )
    const before = jobEventRows(ledgerDb.sqlite, "legacy-running").map((row) =>
      JSON.stringify([row.id, row.sequence, row.type, row.payload_json]),
    )
    await recoverStaleAgentJobs(
      ledgerDb.db,
      new Date("2026-09-04T01:00:00.000Z"),
    )
    const job = jobRow(ledgerDb.sqlite, "legacy-running")
    expect(job.ledger_version).toBe(0)
    expect(job.status).toBe("running")
    expect(
      jobEventRows(ledgerDb.sqlite, "legacy-running").map((row) =>
        JSON.stringify([row.id, row.sequence, row.type, row.payload_json]),
      ),
    ).toEqual(before)
  })

  test("S25 Usage after completed is diagnostic only — seal ordering: late usage/warning/repeated terminal arriving after turn/completed but before settle (during terminal preparation) stay unpublished until the terminal transaction commits, then commit at post-terminal slots referencing the sole completed; readUsage stays at the sealed total", async () => {
    const { lines } = loadJsonlFixture("late-usage.jsonl")
    const caseLines = lines.filter(
      (line) => line.caseId === "during-preparation",
    )
    const expectation = caseLines.find(
      (line) => Object.keys(line.expected).length > 0,
    )?.expected
    if (!expectation) {
      throw new Error("late-usage.jsonl during-preparation lacks expectation")
    }
    const runId = "run-b-s25-seal-order"
    const store = new MemoryDurableStore({ runId })
    const ledger = await runtimeLedger(runId, store)
    const settleLine = caseLines.find((line) => line.port === "settle")
    if (!settleLine)
      throw new Error("late-usage.jsonl during-preparation lacks settle")
    for (const line of caseLines.filter((line) => line.port !== "settle")) {
      await applyStep(ledger, line)
    }
    const beforeTerminal = await ledger.read(0)
    const visibleBeforeTerminal = expectation.lateObservationKeys.filter(
      (key: string) => recordsForKey(beforeTerminal, key).length > 0,
    )
    const completedBeforeTerminal = completedRecords(beforeTerminal).length

    await applyStep(ledger, settleLine)
    const records = await ledger.read(0)
    const completed = completedRecords(records)
    const lateSequences = expectation.lateObservationKeys.map((key: string) =>
      recordsForKey(records, key).map((record: any) => record.sequence),
    )
    expect({
      visibleBeforeTerminal,
      completedBeforeTerminal,
      completed: completed.map((record: any) => record.payload?.status),
      lateAfterTerminal: lateSequences.map(
        (sequences: number[]) =>
          sequences.length > 0 &&
          sequences.every(
            (sequence) => sequence > (completed[0]?.sequence ?? Infinity),
          ),
      ),
      lateTerminalSequence: expectation.lateObservationKeys.map((key: string) =>
        recordsForKey(records, key).map(
          (record: any) => record.payload?.terminalSequence,
        ),
      ),
      sealedTotal: (await ledger.readUsage())?.total?.totalTokens,
      dense:
        sequencesOf(records).join(",") === denseRange(records.length).join(","),
    }).toEqual({
      visibleBeforeTerminal: [],
      completedBeforeTerminal: 0,
      completed: [expectation.completedStatus],
      lateAfterTerminal: expectation.lateObservationKeys.map(() => true),
      lateTerminalSequence: expectation.lateObservationKeys.map(() => [
        completed[0]?.sequence,
      ]),
      sealedTotal: expectation.sealedTotal,
      dense: true,
    })
  })
})

// ---------------------------------------------------------------------------
describe("agent-runtime-core / Canonical Artifact Admission", () => {
  const artifactsFixture = loadJsonFixture("artifacts.json")
  const artifactCase = (caseId: string) =>
    artifactsFixture.cases.find((c: any) => c.caseId === caseId)
  const successEvidence = terminalCase("retry-then-success").evidence

  async function admitAndSettle(caseRow: any) {
    const runId = `run-b-art-${caseRow.caseId}`
    const allowedRunDir = tempDir("run-event-ledger-b-rundir-")
    const outsideDir = tempDir("run-event-ledger-b-outside-")
    const baseDir = caseRow.location === "outside" ? outsideDir : allowedRunDir
    const path = join(baseDir, caseRow.fileName)
    if (caseRow.content !== null) {
      mkdirSync(baseDir, { recursive: true })
      writeFileSync(path, caseRow.content)
    }
    const store = new MemoryDurableStore({ runId })
    const ledger = await runtimeLedger(
      runId,
      store,
      artifactsFixture.secretHints,
    )
    const liveSteps = terminalCase("retry-then-success").steps
    const beforeTerminal = liveSteps.filter(
      (step: any) =>
        step.observationKey !== "te-retry-err" &&
        step.observationKey !== "te-retry-term",
    )
    const terminalStep = liveSteps.find(
      (step: any) => step.observationKey === "te-retry-term",
    )
    for (const step of beforeTerminal) await applyStep(ledger, step)
    const { admitRunArtifactCandidate } = await loadRunArtifactsModule()
    await admitRunArtifactCandidate(
      {
        path,
        ownerRunId:
          caseRow.candidate.ownerRunId === "$RUN_ID"
            ? runId
            : caseRow.candidate.ownerRunId,
        expectedSha256: caseRow.candidate.expectedSha256,
        media: caseRow.candidate.media,
      },
      { runId, allowedRunDir, ledger },
    )
    await applyStep(ledger, terminalStep)
    await ledger.settle(successEvidence)
    return { runId, path, store, records: await ledger.read(0) }
  }

  test("S28 Valid artifact candidate is admitted — one artifact_created with verified SHA-256/size/media precedes completed and the same ref is registered in the committed manifest metadata", async () => {
    const row = artifactCase("valid")
    const { store, records } = await admitAndSettle(row)
    const created = records.filter(
      (record: any) => record.type === "artifact_created",
    )
    const completed = completedRecords(records)
    expect(created).toHaveLength(1)
    expect(completed).toHaveLength(1)
    expect(created[0].sequence).toBeLessThan(completed[0].sequence)
    expect(created[0].payload).toMatchObject({
      artifacts: [
        {
          sha256: row.expected.sha256,
          sizeBytes: row.expected.sizeBytes,
          contentType: row.expected.contentType,
        },
      ],
    })
    expect(JSON.stringify(store.artifactRefs)).toContain(row.expected.sha256)
  })

  test("S29 Invalid artifact candidate is rejected — missing/out-of-scope/wrong-owner/digest-mismatch/unsafe-redaction candidates each commit status/artifact_admission(result=rejected, stable reason), no artifact_created, no manifest entry and no secret path/content", async () => {
    const rows = artifactsFixture.cases.filter(
      (c: any) => c.expected.result === "rejected",
    )
    expect(rows.map((row: any) => row.expected.reason)).toEqual([
      "missing",
      "out_of_scope",
      "ownership_mismatch",
      "digest_mismatch",
      "redaction_unsafe",
    ])
    const observed: unknown[] = []
    for (const row of rows) {
      const { path, store, records } = await admitAndSettle(row)
      const serialized = JSON.stringify(records)
      observed.push({
        caseId: row.caseId,
        artifactCreated: records.filter(
          (r: any) => r.type === "artifact_created",
        ).length,
        admissions: statusRecords(records, "artifact_admission").map(
          (record: any) => ({
            result: record.payload?.result,
            reason: record.payload?.reason,
          }),
        ),
        manifestMentionsFile: JSON.stringify(store.artifactRefs).includes(
          row.fileName,
        ),
        leaksSecret: artifactsFixture.secretHints.some((hint: string) =>
          serialized.includes(hint),
        ),
        leaksPath: serialized.includes(path),
      })
    }
    expect(observed).toEqual(
      rows.map((row: any) => ({
        caseId: row.caseId,
        artifactCreated: 0,
        admissions: [{ result: "rejected", reason: row.expected.reason }],
        manifestMentionsFile: false,
        leaksSecret: false,
        leaksPath: false,
      })),
    )
  })
})

// ---------------------------------------------------------------------------
describe("agent-runtime-core / Canonical Run Event Ledger Ownership", () => {
  const storeFaults = loadJsonFixture("store-faults.json")
  const raceCase = (caseId: string) => {
    const found = storeFaults.raceCases.find((c: any) => c.caseId === caseId)
    if (!found) throw new Error(`store-faults.json lacks ${caseId}`)
    return found
  }
  const opOf = (row: any, predicate: (op: any) => boolean) => {
    const found = row.ops.find(predicate)
    if (!found) throw new Error(`${row.caseId} lacks op`)
    return found
  }
  const pendingLedger = (runId: string, store: MemoryDurableStore) =>
    createLedger({
      runId,
      runtimeId: "codex",
      provenance: PENDING_PROVENANCE,
      store,
    })

  test("S56 Cross-process queued cancel races with start — cancel-first: host B commits canceled, host A's start from the stale high-water reloads and never commits job_started; one completed, dense sequence, at most three attempts", async () => {
    const row = raceCase("cancel-first")
    const runId = "run-b-s56-cancel-first"
    const store = new MemoryDurableStore({
      runId,
      header: { status: row.initialStatus },
    })
    const hostA = await pendingLedger(runId, store)
    const created = opOf(row, (op) => op.key === "sf-race-created")
    await hostA.appendSystemEvent({
      observationKey: created.key,
      ...created.input,
    })
    const hostB = await pendingLedger(runId, store)
    const cancel = opOf(row, (op) => op.op === "settle")
    await hostB.settle(cancel.input)

    const start = opOf(row, (op) => op.key === "sf-race-start")
    const attemptsBefore = store.appendAttempts
    await settledResult(() =>
      hostA.appendSystemEvent({ observationKey: start.key, ...start.input }),
    )
    const records = store.read(runId, 0)
    expect(
      records.filter((record) => record.type === "job_started"),
    ).toHaveLength(0)
    expect(completedRecords(records)).toHaveLength(row.expected.completedCount)
    expect(completedRecords(records)[0].payload).toMatchObject({
      status: row.expected.completedStatus,
    })
    expect(store.appendAttempts - attemptsBefore).toBeLessThanOrEqual(
      row.expected.maxAttemptsPerCall,
    )
    expect(sequencesOf(records)).toEqual(denseRange(records.length))
    expect(await hostA.readOutcome()).toMatchObject({ status: "canceled" })
  })

  test("S56 Cross-process queued cancel races with start — start-first: host B's stale queued cancel reloads the running state and records only the existing cancel-request status (no completed); resubmitting its key returns the prior batch", async () => {
    const row = raceCase("start-first")
    const runId = "run-b-s56-start-first"
    const store = new MemoryDurableStore({
      runId,
      header: { status: row.initialStatus },
    })
    const hostA = await pendingLedger(runId, store)
    const created = opOf(row, (op) => op.key === "sf-race2-created")
    await hostA.appendSystemEvent({
      observationKey: created.key,
      ...created.input,
    })
    const hostB = await pendingLedger(runId, store)
    const start = opOf(row, (op) => op.key === "sf-race2-start")
    await hostA.appendSystemEvent({ observationKey: start.key, ...start.input })
    const cancel = opOf(row, (op) => op.op === "settle")
    await hostB.settle(cancel.input)
    const afterCancel = store.read(runId, 0)
    await hostB.settle(cancel.input)
    const afterResubmit = store.read(runId, 0)

    expect(completedRecords(afterResubmit)).toHaveLength(
      row.expected.completedCount,
    )
    expect(
      afterResubmit.filter((record) => record.type === "job_started"),
    ).toHaveLength(row.expected.jobStartedCount)
    expect(
      afterResubmit.filter(
        (record) =>
          record.type === "status" &&
          record.payload?.status === row.expected.cancelRequestStatus,
      ),
    ).toHaveLength(1)
    expect(afterResubmit.length - afterCancel.length).toBe(
      row.expected.resubmitNewRecords,
    )
    expect(await hostB.readOutcome()).toBeNull()
    expect(sequencesOf(afterResubmit)).toEqual(denseRange(afterResubmit.length))
  })

  test("S56 Cross-process queued cancel races with start — retry exhaustion: a competing commit before every attempt makes the call fail with LEDGER_APPEND_CONFLICT after exactly three attempts, with nothing committed from that call", async () => {
    const row = raceCase("retry-exhaustion")
    const runId = "run-b-s56-exhaustion"
    const store = new MemoryDurableStore({
      runId,
      header: { status: row.initialStatus },
    })
    const hostA = await pendingLedger(runId, store)
    const op = row.ops[0]
    let attemptsForKey = 0
    store.beforeAppend = (batch) => {
      const mine = batch.records.some((record: any) =>
        factKeyMentions(factKeyOf(record), op.key),
      )
      if (!mine || recordsForKey(store.records, op.key).length > 0) return
      attemptsForKey += 1
      store.commitForeign([
        {
          runId,
          type: "status",
          payload: { status: "foreign_host_commit" },
          factKey: `${runId}:foreign-${attemptsForKey}:0`,
        },
      ])
    }
    const result = await settledResult(() =>
      hostA.appendSystemEvent({ observationKey: op.key, ...op.input }),
    )
    expect(result.fulfilled).toBe(false)
    expect(result.reason).toContain(row.expected.error)
    expect(attemptsForKey).toBe(row.expected.attempts)
    expect(recordsForKey(store.read(runId, 0), op.key)).toHaveLength(
      row.expected.committedFromCall,
    )
    const records = store.read(runId, 0)
    expect(sequencesOf(records)).toEqual(denseRange(records.length))
  })

  test("S56 Cross-process queued cancel races with start — a definite rollback without a competing commit retries its unchanged reserved sequence (one row per fact key, sequence 1)", async () => {
    const row = raceCase("unchanged-sequence-retry")
    const runId = "run-b-s56-rollback"
    const store = new MemoryDurableStore({
      runId,
      header: { status: row.initialStatus },
    })
    const hostA = await pendingLedger(runId, store)
    const op = row.ops[0]
    let attemptsForKey = 0
    store.beforeAppend = (batch) => {
      const mine = batch.records.some((record: any) =>
        factKeyMentions(factKeyOf(record), op.key),
      )
      // Count only real transaction attempts, not idempotent duplicate-key
      // resubmissions of an already committed batch.
      if (!mine || recordsForKey(store.records, op.key).length > 0) return
      attemptsForKey += 1
      if (attemptsForKey === 1) {
        throw new Error("SQLITE_BUSY: definite rollback before commit")
      }
    }
    const input = { observationKey: op.key, ...op.input }
    await settledResult(() => hostA.appendSystemEvent(input))
    await hostA.appendSystemEvent(input)
    const committed = recordsForKey(store.read(runId, 0), op.key)
    expect(committed).toHaveLength(1)
    expect(committed[0].sequence).toBe(row.expected.sequence)
    expect(attemptsForKey).toBe(row.expected.attempts)
  })

  test("S56 Cross-process queued cancel races with start — two SQLite connections, cancel-first: CLI cancel on connection 2 commits one completed(canceled, synthetic.source=cancel); start on connection 1 is rejected and writes no job_started; every row carries a fact key", async () => {
    const { runHeadlessCliCommand } = await import(
      "../src/main/lib/headless/cli-dispatcher"
    )
    const { HEADLESS_CLI_MARKER } = await import(
      "../src/main/lib/headless/cli-args"
    )
    const { createAgentJob, startAgentJob } = await import(
      "../src/main/lib/headless/job-store"
    )
    const row = raceCase("sqlite-cancel-first")
    const ledgerDb = trackDb(createMigratedLedgerDb())
    const second = ledgerDb.openSecondConnection()
    const job = await createAgentJob(ledgerDb.db, {
      source: "cli",
      runtime: "codex",
      mode: "plan",
      cwd: process.cwd(),
      prompt: "race cancel-first",
    })
    const sink = { write: (_chunk: string) => {} }
    await runHeadlessCliCommand({
      db: second.db,
      argv: ["Locus", HEADLESS_CLI_MARKER, "jobs", "cancel", job.id],
      stdout: sink,
      stderr: sink,
    })
    const startWorker = opOf(row, (op) => op.op === "start").workerId
    const start = await settledResult(() =>
      startAgentJob(ledgerDb.db, {
        jobId: job.id,
        workerId: startWorker,
        workerPid: null,
      }),
    )
    const rows = jobEventRows(ledgerDb.sqlite, job.id)
    const completed = rows.filter((event) => event.type === "completed")
    expect(start.fulfilled).toBe(!row.expected.startRejected)
    expect(rows.filter((event) => event.type === "job_started")).toHaveLength(0)
    expect(jobRow(ledgerDb.sqlite, job.id).status).toBe(row.expected.status)
    expect(completed).toHaveLength(row.expected.completedCount)
    expect(parsePayload(completed[0]).synthetic?.source).toBe(
      row.expected.syntheticSource,
    )
    expect(
      rows.map(
        (event) => event.fact_key === null || event.fact_key === undefined,
      ),
    ).toEqual(rows.map(() => false))
    expect(rows.map((event) => event.sequence)).toEqual(denseRange(rows.length))
  })

  test("S56 Cross-process queued cancel races with start — two SQLite connections, start-first: the losing CLI cancel only sets the existing cancel-request flag (job stays running, no completed); every row carries a fact key", async () => {
    const { runHeadlessCliCommand } = await import(
      "../src/main/lib/headless/cli-dispatcher"
    )
    const { HEADLESS_CLI_MARKER } = await import(
      "../src/main/lib/headless/cli-args"
    )
    const { createAgentJob, startAgentJob } = await import(
      "../src/main/lib/headless/job-store"
    )
    const row = raceCase("sqlite-start-first")
    const ledgerDb = trackDb(createMigratedLedgerDb())
    const second = ledgerDb.openSecondConnection()
    const job = await createAgentJob(ledgerDb.db, {
      source: "cli",
      runtime: "codex",
      mode: "plan",
      cwd: process.cwd(),
      prompt: "race start-first",
    })
    await startAgentJob(ledgerDb.db, {
      jobId: job.id,
      workerId: opOf(row, (op) => op.op === "start").workerId,
      workerPid: null,
    })
    const sink = { write: (_chunk: string) => {} }
    await runHeadlessCliCommand({
      db: second.db,
      argv: ["Locus", HEADLESS_CLI_MARKER, "jobs", "cancel", job.id],
      stdout: sink,
      stderr: sink,
    })
    const rows = jobEventRows(ledgerDb.sqlite, job.id)
    const current = jobRow(ledgerDb.sqlite, job.id)
    expect(current.status).toBe(row.expected.status)
    expect(current.cancel_requested_at !== null).toBe(
      row.expected.cancelRequested,
    )
    expect(rows.filter((event) => event.type === "completed")).toHaveLength(
      row.expected.completedCount,
    )
    expect(
      rows.map(
        (event) => event.fact_key === null || event.fact_key === undefined,
      ),
    ).toEqual(rows.map(() => false))
    expect(rows.map((event) => event.sequence)).toEqual(denseRange(rows.length))
  })
})
