/** biome-ignore-all lint/suspicious/noExplicitAny: emitted envelopes are validated structurally against the published schema. */
/**
 * Implementer-unit for the Phase III check P3-5 (add-local-job-api-async-submit
 * schema). The async-submit envelopes the CLI actually emits (submit, keyed
 * replay, status with `execution`, wait timeout/error/ready, keyed retry
 * replay and the stdout v1 errors) and the request bodies of submit, create
 * and retry --request validate against docs/local-job-api-v1.schema.json with
 * Ajv 2020; a keyed create body and unknown members are rejected; the
 * completion submit request shares the completion create member set.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import Ajv2020 from "ajv/dist/2020"
import addFormats from "ajv-formats"
import { clearRuntimeReadinessCacheForTest } from "../src/main/lib/headless/runtime-readiness"
import {
  agentRequest,
  claimAs,
  cli,
  completionRequest,
  controlledRunner,
  createFakeMonotonicClock,
  createProfile,
  faultableDb,
  jsonLines,
  type Profile,
  seedProviderProfile,
  seedQueuedApiJob,
} from "./local-job-api-async-submit-wait-kit"

const cleanups: Array<() => void> = []

function profile(): Profile {
  const created = createProfile()
  cleanups.push(created.cleanup)
  return created
}

beforeEach(() => clearRuntimeReadinessCacheForTest())

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

const ajv = new Ajv2020({ allErrors: true })
addFormats(ajv)
ajv.addSchema(
  JSON.parse(readFileSync("docs/local-job-api-v1.schema.json", "utf8")),
  "local-job-api-v1",
)

function valid(ref: string, value: unknown): boolean | string {
  const validate = ajv.getSchema(`local-job-api-v1#/$defs/${ref}`)
  if (!validate) return `missing ${ref}`
  return validate(value)
    ? true
    : JSON.stringify(validate.errors?.slice(0, 3) ?? [])
}

function only(stdout: string): any {
  const lines = jsonLines(stdout)
  expect(lines.length).toBe(1)
  return lines[0]
}

const SUBMIT = ["api", "runs", "submit", "--request", "-", "--json"]
const CREATE = ["api", "runs", "create", "--request", "-", "--json"]

function keyed(request: Record<string, unknown>, key: string) {
  return { ...request, idempotencyKey: key }
}

describe("request bodies", () => {
  test("submit accepts keyed and unkeyed agent and completion bodies; create accepts only unkeyed ones", () => {
    const p = profile()
    const agent = agentRequest(p, {}, { artifacts: true })
    const completion = completionRequest()
    expect({
      submitAgent: valid("submitRequest", agent),
      submitAgentKeyed: valid("submitRequest", keyed(agent, "req-001")),
      submitCompletion: valid("submitRequest", completion),
      submitCompletionKeyed: valid(
        "submitRequest",
        keyed(completion, "req:002"),
      ),
      createAgent: valid("createRequest", agent),
      createCompletion: valid("createRequest", completion),
      createAgentKeyed: valid("createRequest", keyed(agent, "req-001")),
      createCompletionKeyed: valid(
        "createRequest",
        keyed(completion, "req-001"),
      ),
      completionCreateKeyed: valid(
        "completionCreateRequest",
        keyed(completion, "req-001"),
      ),
      badKeyPattern: valid("submitRequest", keyed(agent, "bad key!")),
      completionSubmitExtraMember: valid("completionSubmitRequest", {
        ...completion,
        prompt: { text: "not a completion member" },
      }),
      completionCreateExtraMember: valid("completionCreateRequest", {
        ...completion,
        prompt: { text: "not a completion member" },
      }),
    }).toEqual({
      submitAgent: true,
      submitAgentKeyed: true,
      submitCompletion: true,
      submitCompletionKeyed: true,
      createAgent: true,
      createCompletion: true,
      createAgentKeyed: expect.any(String),
      createCompletionKeyed: expect.any(String),
      completionCreateKeyed: expect.any(String),
      badKeyPattern: expect.any(String),
      completionSubmitExtraMember: expect.any(String),
      completionCreateExtraMember: expect.any(String),
    })
  })

  test("the completion submit request is the completion create member set plus idempotencyKey", () => {
    const schema = JSON.parse(
      readFileSync("docs/local-job-api-v1.schema.json", "utf8"),
    )
    const defs = schema.$defs
    const members = { $ref: "#/$defs/completionRequestMembers" }
    expect({
      create: {
        allOf: defs.completionCreateRequest.allOf,
        closed: defs.completionCreateRequest.unevaluatedProperties,
      },
      submit: {
        allOf: defs.completionSubmitRequest.allOf,
        own: Object.keys(defs.completionSubmitRequest.properties ?? {}),
        closed: defs.completionSubmitRequest.unevaluatedProperties,
      },
    }).toEqual({
      create: { allOf: [members], closed: false },
      submit: { allOf: [members], own: ["idempotencyKey"], closed: false },
    })
  })

  test("retry --request accepts apiVersion, consumer.id and an optional key only", () => {
    const body = { apiVersion: "locus.local-job.v1", consumer: { id: "a" } }
    expect({
      plain: valid("retryRequest", body),
      keyed: valid("retryRequest", keyed(body, "retry-1")),
      extra: valid("retryRequest", { ...body, prompt: { text: "x" } }),
      extraConsumer: valid("retryRequest", {
        ...body,
        consumer: { id: "a", runExternalId: "x" },
      }),
    }).toEqual({
      plain: true,
      keyed: true,
      extra: expect.any(String),
      extraConsumer: expect.any(String),
    })
  })
})

describe("emitted envelopes", () => {
  test("submit, keyed replay, status with execution and wait timeout validate as jobEnvelope / waitEnvelope", async () => {
    const p = profile()
    const request = keyed(agentRequest(p), "schema-env-1")
    const submitted = await cli(p, SUBMIT, {
      stdin: JSON.stringify(request),
    })
    const fresh = only(submitted.stdout)
    const replayed = only(
      (await cli(p, SUBMIT, { stdin: JSON.stringify(request) })).stdout,
    )
    const status = only(
      (await cli(p, ["api", "runs", "status", fresh.job.id, "--json"])).stdout,
    )
    const waited = await cli(
      p,
      ["api", "runs", "wait", fresh.job.id, "--timeout", "0", "--json"],
      { extra: { monotonicClock: createFakeMonotonicClock() } },
    )
    const timeout = only(waited.stdout)
    expect({
      submitExit: submitted.code,
      fresh: valid("jobEnvelope", fresh),
      replay: [replayed.idempotentReplay, valid("jobEnvelope", replayed)],
      status: [status.execution?.state, valid("jobEnvelope", status)],
      timeout: [
        waited.code,
        timeout.wait?.state,
        valid("waitEnvelope", timeout),
      ],
    }).toEqual({
      submitExit: 0,
      fresh: true,
      replay: [true, true],
      status: ["unavailable", true],
      timeout: [9, "timeout", true],
    })
  }, 20_000)

  test("a completion submit and its keyed replay validate as jobEnvelope", async () => {
    const p = profile()
    seedProviderProfile(p, { id: "completion-main", targets: ["codex"] })
    const request = keyed(completionRequest(), "schema-env-completion")
    const fresh = await cli(p, SUBMIT, { stdin: JSON.stringify(request) })
    const replay = await cli(p, SUBMIT, { stdin: JSON.stringify(request) })
    expect({
      exits: [fresh.code, replay.code],
      fresh: valid("jobEnvelope", only(fresh.stdout)),
      replay: valid("jobEnvelope", only(replay.stdout)),
      kind: only(fresh.stdout).job?.kind,
    }).toEqual({
      exits: [0, 0],
      fresh: true,
      replay: true,
      kind: "completion",
    })
  }, 20_000)

  test("create and a ready wait validate as createResponseEnvelope; keyed retry --async replay as jobEnvelope", async () => {
    const p = profile()
    const run = controlledRunner({
      outcome: {
        status: "failed",
        exitCode: 1,
        errorCode: "runtime_error",
        errorMessage: "fixture failure",
      },
    })
    const created = await cli(p, CREATE, {
      stdin: JSON.stringify(agentRequest(p)),
      runner: run.runner,
      lockPath: null,
    })
    const createdEnvelope = only(created.stdout)
    const jobId = createdEnvelope.job.id
    const ready = await cli(
      p,
      ["api", "runs", "wait", jobId, "--timeout", "0", "--json"],
      { extra: { monotonicClock: createFakeMonotonicClock() } },
    )
    const retryBody = {
      apiVersion: "locus.local-job.v1",
      consumer: { id: "fixture-a" },
      idempotencyKey: "schema-retry-1",
    }
    const retryArgs = [
      "api",
      "runs",
      "retry",
      jobId,
      "--async",
      "--request",
      "-",
      "--json",
    ]
    const retried = await cli(p, retryArgs, {
      stdin: JSON.stringify(retryBody),
    })
    const replayed = await cli(p, retryArgs, {
      stdin: JSON.stringify(retryBody),
    })
    expect({
      createExit: created.code,
      create: valid("createResponseEnvelope", createdEnvelope),
      readyExit: ready.code,
      ready: valid("createResponseEnvelope", only(ready.stdout)),
      retryBody: valid("retryRequest", retryBody),
      retry: [retried.code, valid("jobEnvelope", only(retried.stdout))],
      replay: [
        replayed.code,
        only(replayed.stdout).idempotentReplay,
        valid("jobEnvelope", only(replayed.stdout)),
      ],
    }).toEqual({
      createExit: 1,
      create: true,
      readyExit: 1,
      ready: true,
      retryBody: true,
      retry: [0, true],
      replay: [0, true, true],
    })
  }, 20_000)

  test("a wait observation error validates as waitEnvelope", async () => {
    const p = profile()
    const jobId = await seedQueuedApiJob(p)
    await claimAs(p, jobId, {
      workerId: "schema-worker",
      workerPid: process.pid,
    })
    let failing = false
    const handle = faultableDb(p, (sql) => failing && /agent_job/i.test(sql))
    cleanups.push(() => handle.sqlite.close())
    const waited = await cli(
      p,
      ["api", "runs", "wait", jobId, "--timeout", "1000", "--json"],
      {
        db: handle.db,
        extra: {
          monotonicClock: createFakeMonotonicClock({
            onSleep: () => {
              failing = true
            },
          }),
        },
      },
    )
    const envelope = only(waited.stdout)
    expect({
      exit: waited.code,
      wait: envelope.wait,
      valid: valid("waitEnvelope", envelope),
    }).toEqual({
      exit: 8,
      wait: { state: "error", reason: "observation_failed" },
      valid: true,
    })
  }, 20_000)

  test("the stdout v1 errors validate as asyncErrorEnvelope", async () => {
    const p = profile()
    const keyedCreate = await cli(p, CREATE, {
      stdin: JSON.stringify(keyed(agentRequest(p), "create-key")),
    })
    const badKey = await cli(p, SUBMIT, {
      stdin: JSON.stringify(keyed(agentRequest(p), "bad key!")),
    })
    await cli(p, SUBMIT, {
      stdin: JSON.stringify(keyed(agentRequest(p), "conflict-key")),
    })
    const conflict = await cli(p, SUBMIT, {
      stdin: JSON.stringify(
        keyed(
          agentRequest(p, { prompt: { text: "A different prompt." } }),
          "conflict-key",
        ),
      ),
    })
    const failed = await cli(p, CREATE, {
      stdin: JSON.stringify(agentRequest(p)),
      runner: controlledRunner({
        outcome: {
          status: "failed",
          exitCode: 1,
          errorCode: "runtime_error",
          errorMessage: "fixture failure",
        },
      }).runner,
      lockPath: null,
    })
    const mismatch = await cli(
      p,
      [
        "api",
        "runs",
        "retry",
        only(failed.stdout).job.id,
        "--async",
        "--request",
        "-",
        "--json",
      ],
      {
        stdin: JSON.stringify({
          apiVersion: "locus.local-job.v1",
          consumer: { id: "someone-else" },
        }),
      },
    )
    const summary = (result: { code: number; stdout: string }) => {
      const envelope = only(result.stdout)
      return [
        result.code,
        envelope.error?.code,
        valid("asyncErrorEnvelope", envelope),
      ]
    }
    expect({
      keyedCreate: summary(keyedCreate),
      badKey: summary(badKey),
      conflict: summary(conflict),
      mismatch: summary(mismatch),
    }).toEqual({
      keyedCreate: [2, "idempotency_key_not_supported", true],
      badKey: [2, "invalid_idempotency_key", true],
      conflict: [2, "idempotency_conflict", true],
      mismatch: [2, "consumer_mismatch", true],
    })
  }, 20_000)
})
