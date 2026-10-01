/**
 * Implementer-unit for the final security review P3-1
 * (add-local-job-api-async-submit). A malformed JSON body of `runs submit`
 * or `runs retry --request` (bodies that may carry an idempotency key) gets
 * one generic stderr diagnostic that never quotes request text; `runs
 * create` keeps its 2c59664f diagnostic.
 */
import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test"
import { clearRuntimeReadinessCacheForTest } from "../src/main/lib/headless/runtime-readiness"
import {
  agentRequest,
  apiJobRows,
  cli,
  createProfile,
  jsonLines,
  type Profile,
} from "./local-job-api-async-submit-wait-kit"

const cleanups: Array<() => void> = []

function profile(): Profile {
  const created = createProfile()
  cleanups.push(created.cleanup)
  return created
}

beforeEach(() => {
  setSystemTime()
  clearRuntimeReadinessCacheForTest()
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

const SENTINEL = "SENTINELKEY77"
// The key value is an unquoted identifier: a parser message quotes it.
const MALFORMED = `{"apiVersion":"locus.local-job.v1","idempotencyKey":req-${SENTINEL}}`

test("a malformed runs submit body gets the generic diagnostic, exit 2, no stdout and no request text", async () => {
  const p = profile()
  const submitted = await cli(
    p,
    ["api", "runs", "submit", "--request", "-", "--json"],
    { stdin: MALFORMED },
  )
  expect({
    exit: submitted.code,
    stdout: submitted.stdout,
    stderr: submitted.stderr,
    rows: apiJobRows(p).length,
  }).toEqual({
    exit: 2,
    stdout: "",
    stderr: "Invalid JSON request\n",
    rows: 0,
  })
})

test("a malformed runs retry --request body gets the generic diagnostic, exit 2 and no request text", async () => {
  const p = profile()
  const source = await cli(
    p,
    ["api", "runs", "create", "--request", "-", "--json"],
    {
      stdin: JSON.stringify(agentRequest(p)),
      runner: async () => ({
        exitCode: 1,
        status: "failed",
        errorCode: "runtime_error",
        errorMessage: "fixture failure",
      }),
      lockPath: null,
    },
  )
  const sourceId = jsonLines(source.stdout)[0]?.job?.id
  const retried = await cli(
    p,
    ["api", "runs", "retry", sourceId, "--request", "-", "--json"],
    { stdin: MALFORMED },
  )
  expect({
    exit: retried.code,
    stdout: retried.stdout,
    stderr: retried.stderr,
    rows: apiJobRows(p).length,
  }).toEqual({
    exit: 2,
    stdout: "",
    stderr: "Invalid JSON request\n",
    rows: 1,
  })
})

test("runs create keeps its 2c59664f malformed-JSON diagnostic", async () => {
  const p = profile()
  const created = await cli(
    p,
    ["api", "runs", "create", "--request", "-", "--json"],
    { stdin: "{" },
  )
  let parserMessage = ""
  try {
    JSON.parse("{")
  } catch (error) {
    parserMessage = (error as Error).message
  }
  expect({
    exit: created.code,
    stdout: created.stdout,
    stderr: created.stderr,
  }).toEqual({
    exit: 2,
    stdout: "",
    stderr: `Invalid JSON request: ${parserMessage}\n`,
  })
})
