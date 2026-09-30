import { describe, expect, test } from "bun:test"
import { runPersistedAgentJob } from "../src/main/lib/headless/job-runner"
import {
  createAgentJob,
  getAgentJob,
  listAgentJobEvents,
} from "../src/main/lib/headless/job-store"
import { getLocalJobApiEvents } from "../src/main/lib/headless/local-job-api"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

const SECRET = "sk-abcdefghijklmnopqrstuvwxyz123456"

function parsePayload(event: { payloadJson: string }) {
  return JSON.parse(event.payloadJson || "{}")
}

describe("headless runtime event bridge", () => {
  test("persists headless job events through redacted RunEvent payloads without exposing RunEvent internals", async () => {
    const db = createAgentJobTestDb()
    const job = await createAgentJob(db, {
      source: "api",
      runtime: "codex",
      mode: "agent",
      cwd: "/tmp/project",
      prompt: "Run through the bridge",
      apiConsumerId: "docs-workbench",
    })

    await runPersistedAgentJob({
      db,
      jobId: job.id,
      runner: async (_request, observer) => {
        observer.appendEvent("status", {
          status: "runtime_selected",
          authorization: `Bearer ${SECRET}`,
        })
        observer.appendEvent("assistant_delta", {
          text: `hello ${SECRET}`,
        })
        observer.appendEvent("command_started", {
          label: "node",
          args: ["-e", `console.log('access_token=${SECRET}')`],
        })
        observer.appendEvent("command_output", {
          stream: "stderr",
          text: `warn bearer ${SECRET}`,
        })
        observer.appendEvent("error", {
          errorCode: "runtime_auth_required",
          errorMessage: `failed with access_token=${SECRET}`,
        })
        return {
          status: "failed",
          exitCode: 1,
          errorCode: "runtime_auth_required",
          errorMessage: `failed with ${SECRET}`,
          result: {
            stderr: `Bearer ${SECRET}`,
          },
        }
      },
    })

    const events = listAgentJobEvents(db, job.id)
    const payloads = events.map(parsePayload)
    const persistedJson = payloads
      .map((payload) => JSON.stringify(payload))
      .join("\n")

    expect(events.map((event) => event.type)).toEqual([
      "job_created",
      "job_started",
      "status",
      "assistant_delta",
      "command_started",
      "command_output",
      "error",
      "completed",
    ])
    // The ledger keeps the bare payload and adds its ID-less item correlation
    // (refactor-canonical-run-event-ledger, coarse assistant item key).
    expect(payloads[3]).toEqual({
      text: "hello <redacted>",
      item: {
        correlationKey: expect.stringMatching(/^corr-[0-9a-f]+$/),
        channel: "assistant",
        partIndex: 0,
      },
    })
    expect(payloads[3]).not.toHaveProperty("runId")
    expect(payloads[3]).not.toHaveProperty("runEventSequence")
    expect(payloads[4]).toMatchObject({
      label: "node",
      args: ["-e", expect.stringContaining("access_token=")],
    })
    expect(JSON.stringify(payloads[4])).not.toContain(SECRET)
    // The completed payload is the ledger outcome; the job row keeps the
    // result columns (refactor-canonical-run-event-ledger OutcomeEvidence).
    expect(payloads[7]).toMatchObject({
      status: "failed",
      reasons: expect.arrayContaining(["host_failed"]),
    })
    const completedJob = getAgentJob(db, job.id)
    expect(completedJob).toMatchObject({
      status: "failed",
      exitCode: 4,
      errorCode: "runtime_auth_required",
    })
    expect(JSON.parse(completedJob?.resultJson ?? "{}")).toMatchObject({
      stderr: "Bearer <redacted>",
    })
    expect(JSON.stringify(completedJob)).not.toContain(SECRET)
    expect(persistedJson).not.toContain(SECRET)
    expect(persistedJson).not.toContain("Bearer sk-")
  })

  test("keeps Local Job API v1 events readable after bridge redaction", async () => {
    const db = createAgentJobTestDb()
    const job = await createAgentJob(db, {
      source: "api",
      runtime: "claude-code",
      mode: "agent",
      cwd: "/tmp/project",
      prompt: "Run through Local Job API",
      apiConsumerId: "docs-workbench",
    })

    await runPersistedAgentJob({
      db,
      jobId: job.id,
      runner: async (_request, observer) => {
        observer.appendEvent("status", { status: "runtime_selected" })
        observer.appendEvent("assistant_delta", { text: "hello" })
        observer.appendEvent("command_started", {
          label: "node",
          args: ["-e", "console.error('warn')"],
        })
        observer.appendEvent("command_output", {
          stream: "stderr",
          text: "warn",
        })
        observer.appendEvent("error", {
          errorCode: "runtime_warning",
          errorMessage: "warning",
        })
        return {
          status: "failed",
          exitCode: 1,
          errorCode: "runtime_warning",
          errorMessage: "warning",
        }
      },
    })

    const apiEvents = getLocalJobApiEvents(db, job.id)
    const assistant = apiEvents.find(
      (event) => event.type === "assistant_delta",
    )
    const statusEvents = apiEvents.filter((event) => event.type === "status")
    const commandStarted = statusEvents.find(
      (event) => (event.payload as { label?: string }).label === "node",
    )
    const commandOutput = statusEvents.find(
      (event) => (event.payload as { stream?: string }).stream === "stderr",
    )
    const error = apiEvents.find((event) => event.type === "error")
    const completed = apiEvents.find((event) => event.type === "completed")

    expect(apiEvents.map((event) => event.type)).toEqual([
      "job_created",
      "job_started",
      "status",
      "assistant_delta",
      "status",
      "status",
      "error",
      "completed",
    ])
    // Exact public v1 payload (a leak guard): the text plus the ledger's
    // ID-less assistant item correlation.
    expect(assistant?.payload).toEqual({
      text: "hello",
      item: {
        correlationKey: expect.stringMatching(/^corr-[0-9a-f]+$/),
        channel: "assistant",
        partIndex: 0,
      },
    })
    // refactor-canonical-run-event-ledger tasks 5.3 (APPROVED design, Native
    // Method and Item Disposition): coerced internal types keep their payload
    // members and carry payload.subtype = the original internal type name.
    expect(commandStarted?.payload).toEqual({
      label: "node",
      args: ["-e", "console.error('warn')"],
      subtype: "command_started",
    })
    expect(commandOutput?.payload).toEqual({
      stream: "stderr",
      text: "warn",
      subtype: "command_output",
    })
    // The ledger adds the diagnostic classification to coarse errors.
    expect(error?.payload).toEqual({
      errorCode: "runtime_warning",
      errorMessage: "warning",
      classification: "diagnostic",
    })
    expect(completed?.payload).toMatchObject({ status: "failed" })
    expect(getAgentJob(db, job.id)).toMatchObject({
      status: "failed",
      exitCode: 1,
      errorCode: "runtime_warning",
    })
  })
})
