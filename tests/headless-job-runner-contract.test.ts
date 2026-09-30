import { describe, expect, test } from "bun:test"
import type { AgentRuntimeObserver } from "../src/main/lib/headless/agent-runtime-contract"
import {
  AGENT_RUNTIME_SECURITY_CLEANUP_ERROR_CODE,
  type AgentRuntimeRunResult,
} from "../src/main/lib/headless/agent-runtime-contract"
import { runPersistedAgentJob } from "../src/main/lib/headless/job-runner"
import {
  createAgentJob,
  listAgentJobEvents,
} from "../src/main/lib/headless/job-store"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

const CODEX_TUPLE = {
  kind: "runtime",
  installationId: "inst-codex-0.139.0-runner-test",
  runtimeId: "codex",
  adapterSource: "codex-app-server",
  version: "0.139.0",
  executableRef: "exe-runner-test",
  binarySha256: "a".repeat(64),
  protocolName: "codex-app-server-jsonrpc",
  protocolVersion: "v2",
  schemaFiles: [{ path: "ServerNotification.ts", sha256: "b".repeat(64) }],
} as const

/** A native runner whose only assistant output is a completed-only item. */
function completedOnlyAssistantRunner(text: string) {
  return async (
    _request: unknown,
    observer: AgentRuntimeObserver,
  ): Promise<AgentRuntimeRunResult> => {
    const ledger = observer.runLedger
    if (!ledger) throw new Error("Expected the Run ledger")
    await observer.recordExecutionProvenance?.(CODEX_TUPLE)
    const notify = (observationKey: string, method: string, params: unknown) =>
      ledger.ingestNotification({
        observationKey,
        transportId: "t1",
        receivedAt: "2026-09-04T00:00:00.000Z",
        message: { method, params },
      })
    await notify("n-started", "turn/started", {
      threadId: "th",
      turn: { id: "tu", status: "inProgress", error: null },
    })
    if (text) {
      await notify("n-item", "item/completed", {
        threadId: "th",
        turnId: "tu",
        item: { type: "agentMessage", id: "msg-1", text },
      })
    }
    return { status: "succeeded", exitCode: 0, result: {} }
  }
}

async function createTestJob() {
  const db = createAgentJobTestDb()
  const job = await createAgentJob(db, {
    source: "cli",
    runtime: "codex",
    mode: "agent",
    cwd: process.cwd(),
    prompt: "test runtime terminal contract",
  })
  return { db, job }
}

describe("headless job runner terminal contract", () => {
  test("fails closed when a runtime omits its terminal status", async () => {
    const { db, job } = await createTestJob()

    const result = await runPersistedAgentJob({
      db,
      jobId: job.id,
      runner: async () => ({ exitCode: 0 }) as unknown as AgentRuntimeRunResult,
    })

    expect(result).toMatchObject({
      exitCode: 8,
      job: {
        status: "failed",
        errorCode: "runtime_result_invalid",
        errorMessage: "Agent runtime returned no valid terminal status.",
      },
    })
  })

  test("fails closed when a runtime reports a non-terminal running status", async () => {
    const { db, job } = await createTestJob()

    const result = await runPersistedAgentJob({
      db,
      jobId: job.id,
      runner: async () =>
        ({
          status: "running",
          exitCode: 0,
        }) as unknown as AgentRuntimeRunResult,
    })

    expect(result).toMatchObject({
      exitCode: 8,
      job: {
        status: "failed",
        errorCode: "runtime_result_invalid",
      },
    })
  })

  test("does not mask a security cleanup failure as cancellation", async () => {
    const { db, job } = await createTestJob()
    const controller = new AbortController()

    const result = await runPersistedAgentJob({
      db,
      jobId: job.id,
      signal: controller.signal,
      runner: async () => {
        controller.abort()
        return {
          status: "failed",
          exitCode: 1,
          errorCode: AGENT_RUNTIME_SECURITY_CLEANUP_ERROR_CODE,
          errorMessage: "post-run snapshot scrub failed",
        }
      },
    })

    expect(result).toMatchObject({
      exitCode: 1,
      job: {
        status: "failed",
        errorCode: AGENT_RUNTIME_SECURITY_CLEANUP_ERROR_CODE,
        errorMessage: "post-run snapshot scrub failed",
      },
    })
  })

  test("counts a completed-only assistant item as output evidence (T2-6 / S-13)", async () => {
    const { db, job } = await createTestJob()

    const result = await runPersistedAgentJob({
      db,
      jobId: job.id,
      runner: completedOnlyAssistantRunner("final answer without deltas"),
    })

    const events = listAgentJobEvents(db, job.id)
    const reconciliation = events.find(
      (event) =>
        event.type === "status" &&
        JSON.parse(event.payloadJson).subtype === "item_reconciliation",
    )
    expect(reconciliation).toBeDefined()
    expect(events.some((event) => event.type === "assistant_delta")).toBe(false)
    expect(result.job.status).toBe("succeeded")
    expect(result.outcome?.evidenceKeys).toContain(
      `record:${reconciliation?.sequence}`,
    )
  })

  test("still fails a success without any output evidence as output_empty (T2-6 / S-13)", async () => {
    const { db, job } = await createTestJob()

    const result = await runPersistedAgentJob({
      db,
      jobId: job.id,
      runner: completedOnlyAssistantRunner(""),
    })

    expect(result.job.status).toBe("failed")
    expect(result.outcome?.reasons).toContain("output_empty")
  })
})
