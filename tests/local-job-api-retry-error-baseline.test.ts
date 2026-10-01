/**
 * Regression for the Phase I review P2-1 (add-local-job-api-async-submit):
 * `api runs retry` keeps the 2c59664f error streams, exits and gate order.
 * Every expected value below was measured identically on 2c59664f.
 */
import { afterEach, expect, test } from "bun:test"
import type { AgentTaskRunner } from "../src/main/lib/headless/agent-runtime-contract"
import * as jobStore from "../src/main/lib/headless/job-store"
import {
  closeOpenDbs,
  createRegisteredProjectDb,
  runCli,
} from "./local-job-api-async-guards-protocol-kit"

afterEach(() => closeOpenDbs())

const failingRunner: AgentTaskRunner = async () => ({
  status: "failed",
  exitCode: 1,
  errorCode: "runtime_error",
  errorMessage: "probe failure",
})

test("retry of a failed agent source after unregistering its project", async () => {
  const store = createRegisteredProjectDb()
  const create = await runCli(
    store.db,
    ["api", "runs", "create", "--request", "-", "--json"],
    {
      stdin: JSON.stringify({
        apiVersion: "locus.local-job.v1",
        consumer: { id: "probe", runExternalId: "p4" },
        project: { cwd: store.projectCwd },
        runtime: { id: "codex" },
        mode: "plan",
        prompt: { text: "probe" },
      }),
      runner: failingRunner,
    },
  )
  const jobId = JSON.parse(create.stdout).job.id
  const unreg = await runCli(store.db, [
    "api",
    "projects",
    "unregister",
    "--cwd",
    store.projectCwd,
    "--force",
    "--json",
  ])
  const retry = await runCli(
    store.db,
    ["api", "runs", "retry", jobId, "--json"],
    { runner: failingRunner },
  )
  expect([create.code, unreg.code]).toEqual([1, 0])
  expect(retry).toEqual({
    code: 3,
    stdout: "",
    stderr: "API retry cwd must be inside a registered project\n",
  })
})

test("retry of a succeeded completion source whose profile is gone", async () => {
  const store = createRegisteredProjectDb()
  const job = await jobStore.createAgentJob(store.db, {
    kind: "completion",
    source: "api",
    runtime: "codex",
    mode: "agent",
    cwd: store.projectCwd,
    prompt: "probe",
    input: {
      apiVersion: "locus.local-job.v1",
      kind: "completion",
      consumer: { id: "probe", runExternalId: "p7" },
      runtime: { id: "codex" },
      provider: { profileId: "deleted-profile" },
      messages: [{ role: "user", content: "hi" }],
      responseFormat: { type: "text" },
    },
    apiConsumerId: "probe",
    apiConsumerRunId: "p7",
    providerProfileId: "deleted-profile",
  })
  store.sqlite
    .query("UPDATE agent_jobs SET status = 'succeeded' WHERE id = ?")
    .run(job.id)
  const retry = await runCli(store.db, [
    "api",
    "runs",
    "retry",
    job.id,
    "--json",
  ])
  expect(retry.code).toBe(2)
  expect(retry.stderr).toBe("")
  expect(JSON.parse(retry.stdout).error.code).toBe("provider_profile_not_found")
})

test("retry of a succeeded agent source keeps the status error", async () => {
  const store = createRegisteredProjectDb()
  const job = await jobStore.createAgentJob(store.db, {
    source: "api",
    runtime: "codex",
    mode: "plan",
    cwd: store.projectCwd,
    prompt: "probe",
    input: {
      apiVersion: "locus.local-job.v1",
      consumer: { id: "probe", runExternalId: "p8" },
      project: { cwd: store.projectCwd },
      runtime: { id: "codex" },
      mode: "plan",
      prompt: "probe",
    },
    projectId: store.projectId,
    apiConsumerId: "probe",
    apiConsumerRunId: "p8",
  })
  store.sqlite
    .query("UPDATE agent_jobs SET status = 'succeeded' WHERE id = ?")
    .run(job.id)
  const retry = await runCli(store.db, [
    "api",
    "runs",
    "retry",
    job.id,
    "--json",
  ])
  expect(retry).toEqual({
    code: 3,
    stdout: "",
    stderr: `Job ${job.id} cannot be retried from status succeeded\n`,
  })
})
