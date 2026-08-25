import { describe, expect, test } from "bun:test"
import {
  AGENT_RUNTIME_SECURITY_CLEANUP_ERROR_CODE,
  type AgentRuntimeRunResult,
} from "../src/main/lib/headless/agent-runtime-contract"
import { runPersistedAgentJob } from "../src/main/lib/headless/job-runner"
import { createAgentJob } from "../src/main/lib/headless/job-store"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

function createTestJob() {
  const db = createAgentJobTestDb()
  const job = createAgentJob(db, {
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
    const { db, job } = createTestJob()

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
    const { db, job } = createTestJob()

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
    const { db, job } = createTestJob()
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
})
