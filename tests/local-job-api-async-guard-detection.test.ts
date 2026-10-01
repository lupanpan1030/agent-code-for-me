/** biome-ignore-all lint/suspicious/noExplicitAny: the fixture is untyped JSON. */
/**
 * Implementer-unit for the final tests/static review P3-1
 * (add-local-job-api-async-submit guard detection). The frozen fixture's
 * configuration is reused with additional cases: a nested helper or a class
 * method named like the permitted caller, a destructured or declared
 * re-binding of a runner/claim symbol, an element-access job-table insert
 * and a new headless module outside the fixture's nonExecutingFiles are all
 * reported; the frozen cases keep matching.
 */
import { afterAll, expect, test } from "bun:test"
import {
  ASYNC_GUARD_FIXTURE_FLAG,
  ASYNC_GUARD_LABEL,
  cleanupTempDirs,
  GUARD_TIMEOUT_MS,
  readRepoFile,
  runArchitectureGuard,
  writeTempFixture,
} from "./local-job-api-async-guards-protocol-kit"

afterAll(() => cleanupTempDirs())

const FROZEN = JSON.parse(
  readRepoFile(
    "tests/fixtures/local-job-api-async/guards-protocol/architecture-fixtures.json",
  ),
)
const CLI = "src/main/lib/headless/cli-dispatcher.ts"
const QUEUE_OWNER = FROZEN.queueOwner
const SECTION = FROZEN.ownerSection

function finding(rule: string, file: string, symbol: string, owner: string) {
  return { rule, file, symbol, owner, ownerSection: SECTION }
}

const CASES = [
  {
    caseId: "detection-nested-permitted-name",
    category: "inline-runner",
    files: [
      {
        filePath: CLI,
        content: `import { runPersistedAgentJob } from "./job-runner"
async function apiRunsCreateCommand(db: unknown, jobId: string) {
  async function runCommand() {
    return runPersistedAgentJob({ db, jobId })
  }
  return runCommand()
}
export const commands = { apiRunsCreateCommand }
`,
      },
    ],
    expectedFindings: [
      finding("inline-runner-call", CLI, "runPersistedAgentJob", QUEUE_OWNER),
    ],
  },
  {
    caseId: "detection-method-named-like-permitted",
    category: "inline-runner",
    files: [
      {
        filePath: CLI,
        content: `import { runPersistedCompletionJob } from "./completion-runner"
class ApiCommands {
  async runCommand(db: unknown, jobId: string) {
    return runPersistedCompletionJob({ db, jobId })
  }
}
export const commands = new ApiCommands()
`,
      },
    ],
    expectedFindings: [
      finding(
        "inline-runner-call",
        CLI,
        "runPersistedCompletionJob",
        QUEUE_OWNER,
      ),
    ],
  },
  {
    caseId: "detection-top-level-permitted-caller",
    category: "clean",
    files: [
      {
        filePath: CLI,
        content: `import { runPersistedAgentJob } from "./job-runner"
async function runCommand(db: unknown, jobId: string) {
  const run = async () => runPersistedAgentJob({ db, jobId })
  return run()
}
export const commands = { runCommand }
`,
      },
    ],
    expectedFindings: [],
  },
  {
    caseId: "detection-destructured-rebinding",
    category: "independent-dispatch",
    files: [
      {
        filePath: "src/main/lib/headless/jobs-stdio.ts",
        content: `import * as store from "./job-store"
const { startAgentJob: claim } = store
export async function dispatch(db: unknown, jobId: string) {
  return claim(db, { jobId, workerId: "stdio" })
}
`,
      },
    ],
    expectedFindings: [
      finding(
        "independent-dispatch",
        "src/main/lib/headless/jobs-stdio.ts",
        "startAgentJob",
        QUEUE_OWNER,
      ),
    ],
  },
  {
    caseId: "detection-declared-rebinding",
    category: "inline-runner",
    files: [
      {
        filePath: "src/main/lib/headless/run-submission.ts",
        content: `import * as runner from "./job-runner"
const execute = runner.runPersistedAgentJob
export async function submitRun(db: unknown, jobId: string) {
  return execute({ db, jobId })
}
`,
      },
    ],
    expectedFindings: [
      finding(
        "inline-runner-call",
        "src/main/lib/headless/run-submission.ts",
        "runPersistedAgentJob",
        QUEUE_OWNER,
      ),
    ],
  },
  {
    caseId: "detection-element-access-insert",
    category: "direct-job-insert",
    files: [
      {
        filePath: "src/main/lib/headless/local-job-api.ts",
        content: `import * as schema from "../db/schema"
export function insertRow(db: any, values: unknown) {
  db.insert(schema["agentJobs"]).values(values).run()
}
`,
      },
    ],
    expectedFindings: [
      finding(
        "direct-job-insert",
        "src/main/lib/headless/local-job-api.ts",
        "agentJobs",
        FROZEN.jobRowInsertOwner,
      ),
    ],
  },
  {
    caseId: "detection-new-headless-module",
    category: "inline-runner",
    files: [
      {
        filePath: "src/main/lib/headless/api-executor.ts",
        content: `import { runPersistedAgentJob } from "./job-runner"
export async function executeApiRun(db: unknown, jobId: string) {
  return runPersistedAgentJob({ db, jobId })
}
`,
      },
    ],
    expectedFindings: [
      finding(
        "inline-runner-call",
        "src/main/lib/headless/api-executor.ts",
        "runPersistedAgentJob",
        QUEUE_OWNER,
      ),
    ],
  },
]

test(
  "the async submission guard reports nested/method permitted names, re-bindings, element-access inserts and new headless modules; the frozen cases still match",
  () => {
    const fixturePath = writeTempFixture({
      ...FROZEN,
      cases: [...FROZEN.cases, ...CASES],
    })
    const run = runArchitectureGuard([
      `${ASYNC_GUARD_FIXTURE_FLAG}${fixturePath}`,
    ])
    const total = FROZEN.cases.length + CASES.length
    expect({
      status: run.status,
      summary: run.output.includes(
        `${ASYNC_GUARD_LABEL}: ${total}/${total} fixture cases matched; repository ownership enforced.`,
      ),
      mismatches: run.output
        .split("\n")
        .filter((line) => line.includes(`${ASYNC_GUARD_LABEL} case`)),
    }).toEqual({ status: 0, summary: true, mismatches: [] })
  },
  GUARD_TIMEOUT_MS,
)
