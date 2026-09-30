import { describe, expect, test } from "bun:test"
import type { TerminalJobFields } from "../src/main/lib/agent-runtime/run-event-ledger"
import { getOrCreateRunEventLedger } from "../src/main/lib/agent-runtime/run-event-ledger-host"
import type { AgentJob } from "../src/main/lib/db/schema"
import {
  type JobRecoveryDiagnostic,
  recoverStaleAgentJobs,
} from "../src/main/lib/headless/job-recovery"
import {
  cancelAgentJob,
  createAgentJob,
  getAgentJob,
  getAgentJobPrompt,
  heartbeatAgentJob,
  listAgentJobEvents,
  retryAgentJob,
  startAgentJob,
} from "../src/main/lib/headless/job-store"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

type TestDb = ReturnType<typeof createAgentJobTestDb>

// refactor-canonical-run-event-ledger: the deleted store writers
// (appendAgentJobEvent/completeAgentJob/requestCancelAgentJob/
// interruptStaleAgentJobs) are replaced by the job's host ledger, which owns
// event ingress, redaction and the one terminal commit.
async function ingestRuntimeObservation(
  db: TestDb,
  job: AgentJob,
  observationKey: string,
  type: string,
  payload: unknown,
) {
  const ledger = await getOrCreateRunEventLedger(db, job)
  await ledger.ingestRuntimeObservation({ observationKey, type, payload })
}

async function settleHostResult(
  db: TestDb,
  job: AgentJob,
  input: {
    status: "succeeded" | "failed"
    outputEvidenceKeys?: string[]
    jobFields: TerminalJobFields
  },
): Promise<AgentJob | null> {
  const outputEvidenceKeys = input.outputEvidenceKeys ?? []
  const ledger = await getOrCreateRunEventLedger(db, job)
  await ledger.settle(
    {
      trigger: {
        kind: "host_result",
        status: input.status,
        observationKey: `host-result:${job.id}`,
      },
      policy: { denied: false, evidenceKeys: [] },
      output: {
        valid: true,
        empty: outputEvidenceKeys.length === 0,
        allowEmpty: false,
        evidenceKeys: outputEvidenceKeys,
      },
      postRun: { credentialsSafe: true, evidenceKeys: [] },
    },
    { jobFields: () => input.jobFields },
  )
  return getAgentJob(db, job.id)
}

describe("agent job store", () => {
  test("creates, starts, appends events, and completes a job", async () => {
    const db = createAgentJobTestDb()
    const job = await createAgentJob(db, {
      source: "cli",
      runtime: "claude-code",
      mode: "agent",
      cwd: "/tmp/project",
      prompt: "Fix the failing test",
      createdByVersion: "0.0.test",
    })

    expect(job.status).toBe("queued")
    expect(job.promptPreview).toBe("Fix the failing test")
    expect(getAgentJobPrompt(db, job.id)).toBe("Fix the failing test")

    const running = await startAgentJob(db, {
      jobId: job.id,
      workerId: "worker-1",
      workerPid: 1234,
      now: new Date("2026-06-03T01:00:00.000Z"),
    })
    expect(running.status).toBe("running")
    expect(running.workerId).toBe("worker-1")

    await ingestRuntimeObservation(db, job, "working", "assistant_delta", {
      text: "Working",
    })
    const events = listAgentJobEvents(db, job.id)
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3])
    expect(events.map((event) => event.type)).toEqual([
      "job_created",
      "job_started",
      "assistant_delta",
    ])

    const done = await settleHostResult(db, job, {
      status: "succeeded",
      outputEvidenceKeys: ["record:3"],
      jobFields: { exitCode: 0, result: { finalMessage: "Done" } },
    })
    expect(done?.status).toBe("succeeded")
    expect(done?.exitCode).toBe(0)
    expect(JSON.parse(done?.resultJson || "{}")).toEqual({
      finalMessage: "Done",
    })

    // Late-event policy: runtime output after the terminal commit is kept
    // only as a diagnostic status/late_event (never as a Run fact), and host
    // lifecycle facts are rejected on the terminal Run.
    await ingestRuntimeObservation(db, job, "late", "assistant_delta", {
      text: "late",
    })
    const afterTerminal = listAgentJobEvents(db, job.id)
    expect(afterTerminal.map((event) => event.type)).toEqual([
      "job_created",
      "job_started",
      "assistant_delta",
      "completed",
      "status",
    ])
    expect(JSON.parse(afterTerminal[4].payloadJson)).toMatchObject({
      subtype: "late_event",
      diagnosticOnly: true,
      terminalSequence: 4,
      originalType: "assistant_delta",
    })
    await expect(
      startAgentJob(db, { jobId: job.id, workerId: "worker-2" }),
    ).rejects.toThrow("already terminal")
  })

  test("redacts token values in persisted job event payloads", async () => {
    const db = createAgentJobTestDb()
    const job = await createAgentJob(db, {
      source: "cli",
      runtime: "claude-code",
      mode: "agent",
      cwd: "/tmp/project",
      prompt: "Run with token-shaped diagnostics",
    })

    await ingestRuntimeObservation(db, job, "stderr", "command_output", {
      stream: "stderr",
      CLAUDE_CODE_OAUTH_TOKEN: "oauth-token-value",
      text: "CLAUDE_CODE_OAUTH_TOKEN=oauth-token-value",
    })

    const events = listAgentJobEvents(db, job.id)
    const payload = JSON.parse(events.at(-1)?.payloadJson || "{}")
    const persistedJson = JSON.stringify(payload)

    // The canonical redactor (agent-runtime/redaction.ts) now owns the
    // secret-key marker; the job store no longer re-redacts payloads.
    expect(payload.CLAUDE_CODE_OAUTH_TOKEN).toBe("<redacted>")
    expect(payload.text).toBe("CLAUDE_CODE_OAUTH_TOKEN=<redacted>")
    expect(persistedJson).not.toContain("oauth-token-value")
  })

  test("records cancel request before terminal cancellation", async () => {
    const db = createAgentJobTestDb()
    const job = await createAgentJob(db, {
      source: "cli",
      runtime: "codex",
      mode: "plan",
      cwd: "/tmp/project",
      prompt: "Inspect only",
    })
    await startAgentJob(db, { jobId: job.id, workerId: "worker-1" })

    const cancelRequested = await cancelAgentJob(db, job.id, {
      requestedBy: "desktop",
      now: new Date("2026-06-03T01:01:00.000Z"),
    })
    expect(cancelRequested.status).toBe("running")
    expect(cancelRequested.cancelRequestedBy).toBe("desktop")

    const ledger = await getOrCreateRunEventLedger(db, job)
    await ledger.settle(
      {
        trigger: {
          kind: "cancel",
          reason: "cancel_requested",
          observationKey: `worker-cancel:${job.id}`,
        },
        policy: { denied: false, evidenceKeys: [] },
        output: {
          valid: false,
          empty: true,
          allowEmpty: false,
          evidenceKeys: [],
        },
        postRun: { credentialsSafe: true, evidenceKeys: [] },
      },
      { jobFields: () => ({ exitCode: 5 }) },
    )
    const canceled = getAgentJob(db, job.id)
    expect(canceled?.status).toBe("canceled")
    expect(canceled?.exitCode).toBe(5)
    expect(listAgentJobEvents(db, job.id).map((event) => event.type)).toEqual([
      "job_created",
      "job_started",
      "status",
      "completed",
    ])
  })

  // red-receipt §8.4: the interruptStaleAgentJobs error-only mint is
  // obsoleted; job-recovery.ts settles only confirmed-stopped stale workers.
  test("heartbeats running jobs and recovers only confirmed-stopped stale workers", async () => {
    const db = createAgentJobTestDb()
    const job = await createAgentJob(db, {
      source: "cli",
      runtime: "claude-code",
      mode: "agent",
      cwd: "/tmp/project",
      prompt: "Run",
    })
    await startAgentJob(db, {
      jobId: job.id,
      workerId: "worker-1",
      workerPid: 4321,
      now: new Date("2026-06-03T01:00:00.000Z"),
    })
    heartbeatAgentJob(
      db,
      job.id,
      "worker-1",
      new Date("2026-06-03T01:01:00.000Z"),
    )

    const probed: number[] = []
    const diagnostics: JobRecoveryDiagnostic[] = []
    let probeResult: "alive" | "absent" = "alive"
    const recoveryOptions = {
      onDiagnostic: (diagnostic: JobRecoveryDiagnostic) => {
        diagnostics.push(diagnostic)
      },
      probeProcess: (pid: number) => {
        probed.push(pid)
        return probeResult
      },
    }

    // The 01:01 heartbeat is fresh at 01:02:30 (within 120 s): no candidate.
    expect(
      await recoverStaleAgentJobs(
        db,
        new Date("2026-06-03T01:02:30.000Z"),
        recoveryOptions,
      ),
    ).toHaveLength(0)
    expect(probed).toEqual([])
    expect(diagnostics).toEqual([])

    // Stale heartbeat but the worker is alive: left running, heartbeat_only
    // host diagnostic, nothing appended.
    const eventCountBefore = listAgentJobEvents(db, job.id).length
    expect(
      await recoverStaleAgentJobs(
        db,
        new Date("2026-06-03T01:03:30.000Z"),
        recoveryOptions,
      ),
    ).toHaveLength(0)
    expect(probed).toEqual([4321])
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({
      jobId: job.id,
      confidence: "heartbeat_only",
      basis: "worker_alive",
    })
    expect(getAgentJob(db, job.id)?.status).toBe("running")
    expect(getAgentJob(db, job.id)?.errorCode).toBeNull()
    expect(listAgentJobEvents(db, job.id)).toHaveLength(eventCountBefore)

    // Confirmed stopped (ESRCH): settles one completed(interrupted).
    probeResult = "absent"
    const interrupted = await recoverStaleAgentJobs(
      db,
      new Date("2026-06-03T01:03:30.000Z"),
      recoveryOptions,
    )
    expect(interrupted).toHaveLength(1)
    expect(getAgentJob(db, job.id)?.status).toBe("interrupted")
    expect(getAgentJob(db, job.id)?.errorCode).toBe("worker_interrupted")
    const completed = listAgentJobEvents(db, job.id).filter(
      (event) => event.type === "completed",
    )
    expect(completed).toHaveLength(1)
    expect(JSON.parse(completed[0].payloadJson)).toMatchObject({
      status: "interrupted",
      synthetic: { source: "recovery" },
      recovery: { confidence: "confirmed", basis: "worker_process_absent" },
    })

    // A later pass does not settle the terminal job again.
    expect(
      await recoverStaleAgentJobs(
        db,
        new Date("2026-06-03T01:10:00.000Z"),
        recoveryOptions,
      ),
    ).toHaveLength(0)
    expect(
      listAgentJobEvents(db, job.id).filter(
        (event) => event.type === "completed",
      ),
    ).toHaveLength(1)
  })

  test("creates retry jobs only from retryable terminal states", async () => {
    const db = createAgentJobTestDb()
    const job = await createAgentJob(db, {
      source: "cli",
      runtime: "codex",
      mode: "agent",
      cwd: "/tmp/project",
      prompt: "Try",
    })

    await expect(retryAgentJob(db, job.id)).rejects.toThrow("cannot be retried")
    await startAgentJob(db, { jobId: job.id, workerId: "worker-1" })
    await settleHostResult(db, job, {
      status: "failed",
      jobFields: {
        exitCode: 1,
        errorCode: "runtime_failed",
        errorMessage: "Runtime failed",
      },
    })

    const retry = await retryAgentJob(db, job.id)
    expect(retry.status).toBe("queued")
    expect(retry.retryOfJobId).toBe(job.id)
    expect(retry.attempt).toBe(2)
    expect(retry.runtime).toBe("codex")
  })

  test("redacts secret-like text from durable job metadata and events", async () => {
    const db = createAgentJobTestDb()
    const secret = "sk-abcdefghijklmnopqrstuvwxyz123456"
    const job = await createAgentJob(db, {
      source: "cli",
      runtime: "claude-code",
      mode: "agent",
      cwd: "/tmp/project",
      prompt: `Use token ${secret}`,
    })
    expect(job.promptPreview).not.toContain(secret)
    expect(getAgentJobPrompt(db, job.id)).not.toContain(secret)

    await startAgentJob(db, { jobId: job.id, workerId: "worker-1" })
    await ingestRuntimeObservation(db, job, "runtime-error", "error", {
      errorText: `Authorization: Bearer abc.def.ghi ${secret}`,
      nested: { access_token: "abc.def.ghi" },
    })
    await settleHostResult(db, job, {
      status: "failed",
      jobFields: {
        exitCode: 1,
        errorMessage: `failed with ${secret}`,
        result: { stderr: `Bearer abc.def.ghi` },
      },
    })

    const persisted = getAgentJob(db, job.id)
    expect(persisted?.errorMessage).not.toContain(secret)
    expect(persisted?.resultJson).not.toContain("abc.def.ghi")
    for (const event of listAgentJobEvents(db, job.id)) {
      expect(event.payloadJson).not.toContain(secret)
      expect(event.payloadJson).not.toContain("abc.def.ghi")
    }
  })

  test("redacts a prompt secret before the preview truncation boundary", async () => {
    const db = createAgentJobTestDb()
    const secret = "sk-abcdefghijklmnopqrstuvwxyz123456"
    const exposedPrefix = secret.slice(0, 12)
    const job = await createAgentJob(db, {
      source: "cli",
      runtime: "codex",
      mode: "agent",
      cwd: "/tmp/project",
      prompt: `${"p".repeat(230)}${secret}`,
    })

    expect(job.promptPreview).not.toContain(secret)
    expect(job.promptPreview).not.toContain(exposedPrefix)
  })

  test("redacts common non-sk secret formats from job storage", async () => {
    const db = createAgentJobTestDb()
    const prompt = [
      "OPENAI_API_KEY=plain-openai-token",
      "ANTHROPIC_AUTH_TOKEN=plain-anthropic-token",
      "Authorization: Basic dXNlcjpwYXNz",
      "ghp_abcdefghijklmnopqrstuvwxyz123456",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature",
      "https://example.test/callback?code=oauth-code&access_token=oauth-token",
      "-----BEGIN PRIVATE KEY-----\\nsecret\\n-----END PRIVATE KEY-----",
    ].join("\\n")

    const job = await createAgentJob(db, {
      source: "cli",
      runtime: "codex",
      mode: "agent",
      cwd: "/tmp/project",
      prompt,
    })

    expect(job.promptPreview).not.toContain("plain-openai-token")
    expect(job.promptPreview).not.toContain("dXNlcjpwYXNz")
    expect(getAgentJobPrompt(db, job.id)).not.toContain("plain-anthropic-token")
    expect(getAgentJobPrompt(db, job.id)).not.toContain("ghp_")
    expect(getAgentJobPrompt(db, job.id)).not.toContain("oauth-code")

    await startAgentJob(db, { jobId: job.id, workerId: "worker-1" })
    await ingestRuntimeObservation(db, job, "runtime-error", "error", {
      output: prompt,
    })
    const eventPayloads = listAgentJobEvents(db, job.id)
      .map((event) => event.payloadJson)
      .join("\\n")
    expect(eventPayloads).not.toContain("plain-openai-token")
    expect(eventPayloads).not.toContain("PRIVATE KEY")
  })
})
