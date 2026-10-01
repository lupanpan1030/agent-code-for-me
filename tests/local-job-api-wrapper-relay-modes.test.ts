/**
 * Implementer-unit for the T3 review findings on the R4 relay
 * (add-local-job-api-async-submit, design R4 / D2), real processes (POSIX):
 *
 * - Already-closed stdin (security P1-1): a stdin pipe whose write end was
 *   closed before the command started (Node's `execFileSync` without
 *   `input`, `child.stdin.end()` right after spawn) never arms the EOF
 *   relay; an open pipe closed later still relays the own cancel.
 * - Own claim (design-probes F1): a catchable signal caught while the own
 *   pump claims the Run is never swallowed; it takes the 2c59664f default
 *   disposition of a local execution.
 * - Admission (design-probes F2): a signal caught while the Run is being
 *   admitted is held and, once the ID is known, cancels the queued own Run;
 *   when admission throws, it is re-raised with the default disposition.
 * - Keyed replay (security P3-1): a keyed sync retry waiter that replays a
 *   retained child does not own it; its abort never cancels that child.
 */
import { afterEach, expect, test } from "bun:test"
import { spawn, spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { recoverStaleAgentJobs } from "../src/main/lib/headless/job-recovery"
import { startAgentJob } from "../src/main/lib/headless/job-store"
import {
  agentRequest,
  apiJobRows,
  cli,
  countType,
  createProfile,
  fixtureCase,
  jobRowById,
  type Profile,
  REPO_ROOT,
  realDelay,
  spawnSibling,
} from "./local-job-api-async-submit-wait-kit"

const CHILD = join(
  REPO_ROOT,
  "tests",
  "fixtures",
  "local-job-api-relay-modes",
  "child.ts",
)

const POSIX = process.platform !== "win32"

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

type ChildConfig = {
  argv: string[]
  runner: "succeed" | "block"
  signalOn?: { eventType: string; signal: NodeJS.Signals } | null
  seam?: { holdMs: number; claimAs?: { workerPid: number } | null } | null
}

function childEnv(p: Profile, config: ChildConfig) {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    RELAY_MODES_CHILD_CONFIG: JSON.stringify({
      dbFile: p.ledger.file,
      lockPath: p.lockPath,
      ...config,
    }),
  }
}

function writeRequest(
  p: Profile,
  body: Record<string, unknown>,
  name = "relay-modes-request.json",
): string {
  const path = join(p.root, name)
  writeFileSync(path, JSON.stringify(body))
  return path
}

function createArgv(requestPath: string): string[] {
  return ["api", "runs", "create", "--request", requestPath, "--json"]
}

/** Spawns the child; `closeStdin` closes the stdin pipe right after spawn. */
function spawnWrapper(
  p: Profile,
  config: ChildConfig,
  stdin: "ignore" | "pipe" | "closed",
) {
  const proc = spawn("bun", [CHILD], {
    cwd: REPO_ROOT,
    env: childEnv(p, config),
    stdio: [stdin === "ignore" ? "ignore" : "pipe", "pipe", "pipe"],
  })
  if (stdin === "closed") proc.stdin?.end()
  let out = ""
  let err = ""
  proc.stdout?.on("data", (chunk) => {
    out += chunk
  })
  proc.stderr?.on("data", (chunk) => {
    err += chunk
  })
  const exited = new Promise<{
    code: number | null
    signal: string | null
  }>((resolve) => {
    proc.on("close", (code, signal) => resolve({ code, signal }))
  })
  return {
    proc,
    exited,
    stdout: () => out,
    stderr: () => err,
    alive: () => proc.exitCode === null && proc.signalCode === null,
    async waitForStderr(pattern: RegExp, ms: number): Promise<boolean> {
      const deadline = performance.now() + ms
      while (performance.now() < deadline) {
        if (pattern.test(err)) return true
        if (proc.exitCode !== null || proc.signalCode !== null) break
        await realDelay(10)
      }
      return pattern.test(err)
    },
    async exitWithin(ms: number) {
      return await Promise.race([
        exited,
        realDelay(ms).then(() => ({ code: null, signal: "still-running" })),
      ])
    },
  }
}

function profile(): Profile {
  const p = createProfile()
  cleanups.push(p.cleanup)
  return p
}

function sibling(): number {
  const proc = spawnSibling()
  cleanups.push(proc.kill)
  return proc.pid
}

function rowSummary(p: Profile) {
  return apiJobRows(p).map((row) => ({
    status: row.status,
    cancelRequested: row.cancel_requested_at !== null,
    started: countType(p, row.id, "job_started"),
  }))
}

// ---------------------------------------------------------------------------
// Already-closed stdin (P1)
// ---------------------------------------------------------------------------

/**
 * Runs the child through Node's `execFileSync` without `input` — the shape of
 * a synchronous Node consumer. Node hands the child a stdin socket whose
 * peer is already shut down (Bun's own spawnSync does not, so a Node driver
 * is used).
 */
function execFileSyncWithoutInput(env: Record<string, string>) {
  const driver = `
    const { execFileSync } = require("node:child_process")
    let result
    try {
      const stdout = execFileSync("bun", [${JSON.stringify(CHILD)}], {
        cwd: ${JSON.stringify(REPO_ROOT)},
        env: JSON.parse(process.env.DRIVER_CHILD_ENV),
        stdio: ["pipe", "pipe", "pipe"],
        encoding: "utf8",
        timeout: 20000,
      })
      result = { status: 0, signal: null, stdout, stderr: "" }
    } catch (error) {
      result = {
        status: error.status ?? null,
        signal: error.signal ?? null,
        stdout: String(error.stdout ?? ""),
        stderr: String(error.stderr ?? ""),
      }
    }
    process.stdout.write(JSON.stringify(result))
  `
  const driven = spawnSync("node", ["-e", driver], {
    env: { ...env, DRIVER_CHILD_ENV: JSON.stringify(env) },
    encoding: "utf8",
    timeout: 25_000,
  })
  return JSON.parse(driven.stdout || "{}") as {
    status: number | null
    signal: string | null
    stdout: string
    stderr: string
  }
}

test.skipIf(!POSIX)(
  "closed stdin, execFileSync without input: an own-pump create held 300 ms before its claim is never canceled by the pending EOF and completes",
  () => {
    const p = profile()
    const requestPath = writeRequest(p, agentRequest(p))
    const result = execFileSyncWithoutInput(
      childEnv(p, {
        argv: createArgv(requestPath),
        runner: "succeed",
        seam: { holdMs: 300 },
      }),
    )
    expect({
      exit: result.status,
      signal: result.signal,
      stdoutStatus: JSON.parse(result.stdout || "{}")?.job?.status ?? null,
      rows: rowSummary(p),
    }).toEqual({
      exit: 0,
      signal: null,
      stdoutStatus: "succeeded",
      rows: [{ status: "succeeded", cancelRequested: false, started: 1 }],
    })
  },
  30_000,
)

test.skipIf(!POSIX)(
  "closed stdin, end() right after spawn: an own-pump create held 300 ms before its claim completes without a cancel",
  async () => {
    const p = profile()
    const requestPath = writeRequest(p, agentRequest(p))
    const child = spawnWrapper(
      p,
      {
        argv: createArgv(requestPath),
        runner: "succeed",
        seam: { holdMs: 300 },
      },
      "closed",
    )
    try {
      const exit = await child.exitWithin(15_000)
      expect({
        exit,
        stdoutStatus: JSON.parse(child.stdout() || "{}")?.job?.status ?? null,
        rows: rowSummary(p),
      }).toEqual({
        exit: { code: 0, signal: null },
        stdoutStatus: "succeeded",
        rows: [{ status: "succeeded", cancelRequested: false, started: 1 }],
      })
    } finally {
      child.proc.kill("SIGKILL")
      await child.exited
    }
  },
  30_000,
)

test.skipIf(!POSIX)(
  "closed stdin, end() right after spawn: a daemon-first create waits for the claimant and records no cancel request",
  async () => {
    const p = profile()
    const requestPath = writeRequest(p, agentRequest(p))
    const child = spawnWrapper(
      p,
      {
        argv: createArgv(requestPath),
        runner: "block",
        seam: { holdMs: 300, claimAs: { workerPid: sibling() } },
      },
      "closed",
    )
    try {
      const held = await child.waitForStderr(/SEAM /, 10_000)
      await realDelay(1_500)
      expect({
        held,
        alive: child.alive(),
        stdout: child.stdout(),
        rows: rowSummary(p),
      }).toEqual({
        held: true,
        alive: true,
        stdout: "",
        rows: [{ status: "running", cancelRequested: false, started: 1 }],
      })
    } finally {
      child.proc.kill("SIGKILL")
      await child.exited
    }
  },
  30_000,
)

test.skipIf(!POSIX)(
  "open stdin pipe closed after arming: EOF still relays the own cancel of the queued Run and exits 8 with no stdout",
  async () => {
    const p = profile()
    const requestPath = writeRequest(p, agentRequest(p))
    const child = spawnWrapper(
      p,
      {
        argv: createArgv(requestPath),
        runner: "block",
        seam: { holdMs: 5_000 },
      },
      "pipe",
    )
    try {
      const held = await child.waitForStderr(/SEAM /, 10_000)
      child.proc.stdin?.end()
      const exit = await child.exitWithin(9_000)
      expect({
        held,
        exit,
        stdout: child.stdout(),
        runnerEntered: /RUNNER_ENTERED/.test(child.stderr()),
        rows: rowSummary(p),
      }).toEqual({
        held: true,
        exit: { code: 8, signal: null },
        stdout: "",
        runnerEntered: false,
        rows: [{ status: "canceled", cancelRequested: true, started: 0 }],
      })
    } finally {
      child.proc.kill("SIGKILL")
      await child.exited
    }
  },
  30_000,
)

// ---------------------------------------------------------------------------
// Own claim (P2)
// ---------------------------------------------------------------------------

test.skipIf(!POSIX)(
  "a SIGTERM caught while the own pump claims the Run takes the default disposition: the wrapper ends by SIGTERM and recovery settles the baseline outcome",
  async () => {
    const baseline = fixtureCase("controls.json", "S35").ownPumpBaseline.SIGTERM
    const p = profile()
    const requestPath = writeRequest(p, agentRequest(p))
    const child = spawnWrapper(
      p,
      {
        argv: createArgv(requestPath),
        runner: "block",
        signalOn: { eventType: "job_started", signal: "SIGTERM" },
      },
      "pipe",
    )
    try {
      const exit = await child.exitWithin(5_000)
      const rows = apiJobRows(p)
      const own = rows[0]
      const before = {
        status: own?.status,
        cancelRequested: (own?.cancel_requested_at ?? null) !== null,
        workerKind: String(own?.worker_id ?? "").split(":")[0],
      }
      await recoverStaleAgentJobs(p.db, new Date(Date.now() + 10 * 60 * 1000))
      expect({
        signaled: /SIGNALED job_started/.test(child.stderr()),
        exitSignal: exit.signal,
        stdout: child.stdout(),
        rows: rows.length,
        before,
        afterRecovery: jobRowById(p, own?.id)?.status,
      }).toEqual({
        signaled: true,
        exitSignal: baseline.childSignal,
        stdout: "",
        rows: 1,
        before: {
          status: baseline.rowStatus,
          cancelRequested: baseline.cancelRequested,
          workerKind: "headless",
        },
        afterRecovery: baseline.afterRecovery,
      })
    } finally {
      child.proc.kill("SIGKILL")
      await child.exited
    }
  },
  30_000,
)

// ---------------------------------------------------------------------------
// Admission (P3)
// ---------------------------------------------------------------------------

for (const variant of [
  { eventType: "job_created", artifacts: false },
  { eventType: "artifact_created", artifacts: true },
] as const) {
  test.skipIf(!POSIX)(
    `a SIGTERM caught during admission (at the ${variant.eventType} append) is held and then cancels the queued own Run before any claim, ending by SIGTERM`,
    async () => {
      const p = profile()
      const requestPath = writeRequest(
        p,
        agentRequest(p, {}, { artifacts: variant.artifacts }),
      )
      const child = spawnWrapper(
        p,
        {
          argv: createArgv(requestPath),
          runner: "block",
          signalOn: { eventType: variant.eventType, signal: "SIGTERM" },
        },
        "ignore",
      )
      try {
        const exit = await child.exitWithin(9_000)
        expect({
          signaled: new RegExp(`SIGNALED ${variant.eventType}`).test(
            child.stderr(),
          ),
          exitSignal: exit.signal,
          stdout: child.stdout(),
          runnerEntered: /RUNNER_ENTERED/.test(child.stderr()),
          rows: rowSummary(p),
        }).toEqual({
          signaled: true,
          exitSignal: "SIGTERM",
          stdout: "",
          runnerEntered: false,
          rows: [{ status: "canceled", cancelRequested: true, started: 0 }],
        })
      } finally {
        child.proc.kill("SIGKILL")
        await child.exited
      }
    },
    30_000,
  )
}

test.skipIf(!POSIX)(
  "a SIGTERM held during an admission that then fails (the run directory cannot be created) is re-raised with the default disposition and cancels nothing",
  async () => {
    const p = profile()
    const requestPath = writeRequest(
      p,
      agentRequest(p, {}, { artifacts: true }),
    )
    // The winner-only mkdir of the run directory fails after the creation
    // commit, so admission throws (design D3: the host settles it failed).
    mkdirSync(p.artifactBaseDir, { recursive: true })
    chmodSync(p.artifactBaseDir, 0o555)
    cleanups.push(() => chmodSync(p.artifactBaseDir, 0o755))
    const child = spawnWrapper(
      p,
      {
        argv: createArgv(requestPath),
        runner: "block",
        signalOn: { eventType: "job_created", signal: "SIGTERM" },
      },
      "ignore",
    )
    try {
      const exit = await child.exitWithin(9_000)
      expect({
        signaled: /SIGNALED job_created/.test(child.stderr()),
        exitSignal: exit.signal,
        stdout: child.stdout(),
        runnerEntered: /RUNNER_ENTERED/.test(child.stderr()),
        rows: apiJobRows(p).map((row) => ({
          status: row.status,
          errorCode: row.error_code,
          cancelRequested: row.cancel_requested_at !== null,
          started: countType(p, row.id, "job_started"),
        })),
      }).toEqual({
        signaled: true,
        exitSignal: "SIGTERM",
        stdout: "",
        runnerEntered: false,
        rows: [
          {
            status: "failed",
            errorCode: "artifact_admission_failed",
            cancelRequested: false,
            started: 0,
          },
        ],
      })
    } finally {
      child.proc.kill("SIGKILL")
      await child.exited
    }
  },
  30_000,
)

// ---------------------------------------------------------------------------
// Keyed sync retry replay (P3)
// ---------------------------------------------------------------------------

/** A canceled source and its keyed `--async` retry child (queued). */
async function retainedRetryChild(p: Profile) {
  const submitted = await cli(
    p,
    ["api", "runs", "submit", "--request", "-", "--json"],
    { stdin: JSON.stringify(agentRequest(p)) },
  )
  const source = JSON.parse(submitted.stdout).job.id as string
  await cli(p, ["api", "runs", "cancel", source, "--json"])
  const body = {
    apiVersion: "locus.local-job.v1",
    consumer: { id: "fixture-a" },
    idempotencyKey: "req-relay-modes-replay",
  }
  const retried = await cli(
    p,
    ["api", "runs", "retry", source, "--request", "-", "--async", "--json"],
    { stdin: JSON.stringify(body) },
  )
  const child = JSON.parse(retried.stdout).job.id as string
  const requestPath = writeRequest(p, body, "relay-modes-retry.json")
  return {
    source,
    child,
    argv: ["api", "runs", "retry", source, "--request", requestPath, "--json"],
  }
}

test.skipIf(!POSIX)(
  "keyed sync retry replay of a retained child another executor runs: SIGTERM ends the waiter by SIGTERM and a closed stdin is ignored; the shared child is never canceled",
  async () => {
    const p = profile()
    const retained = await retainedRetryChild(p)
    const claimant = sibling()
    await startAgentJob(p.db, {
      jobId: retained.child,
      workerId: `daemon:${claimant}:relay-modes:${retained.child}`,
      workerPid: claimant,
    })
    const child = spawnWrapper(
      p,
      { argv: retained.argv, runner: "block", seam: { holdMs: 0 } },
      "closed",
    )
    try {
      const reached = await child.waitForStderr(/SEAM /, 10_000)
      // Long enough for an armed EOF to have relayed a cancel.
      await realDelay(800)
      const aliveAfterEof = child.alive()
      child.proc.kill("SIGTERM")
      const exit = await child.exitWithin(5_000)
      const row = jobRowById(p, retained.child)
      expect({
        replayed: child.stderr().includes(`SEAM ${retained.child}`),
        reached,
        aliveAfterEof,
        exitSignal: exit.signal,
        stdout: child.stdout(),
        child: {
          status: row?.status,
          cancelRequested: row?.cancel_requested_at !== null,
        },
        rows: apiJobRows(p).length,
      }).toEqual({
        replayed: true,
        reached: true,
        aliveAfterEof: true,
        exitSignal: "SIGTERM",
        stdout: "",
        child: { status: "running", cancelRequested: false },
        rows: 2,
      })
    } finally {
      child.proc.kill("SIGKILL")
      await child.exited
    }
  },
  30_000,
)

test.skipIf(!POSIX)(
  "keyed sync retry replay of a still-queued retained child: SIGTERM before the waiter's own claim cancels nothing and ends the waiter by SIGTERM",
  async () => {
    const p = profile()
    const retained = await retainedRetryChild(p)
    const child = spawnWrapper(
      p,
      { argv: retained.argv, runner: "block", seam: { holdMs: 5_000 } },
      "ignore",
    )
    try {
      const reached = await child.waitForStderr(/SEAM /, 10_000)
      child.proc.kill("SIGTERM")
      const exit = await child.exitWithin(5_000)
      const row = jobRowById(p, retained.child)
      expect({
        replayed: child.stderr().includes(`SEAM ${retained.child}`),
        reached,
        exitSignal: exit.signal,
        stdout: child.stdout(),
        child: {
          status: row?.status,
          cancelRequested: row?.cancel_requested_at !== null,
          started: countType(p, retained.child, "job_started"),
        },
      }).toEqual({
        replayed: true,
        reached: true,
        exitSignal: "SIGTERM",
        stdout: "",
        child: { status: "queued", cancelRequested: false, started: 0 },
      })
    } finally {
      child.proc.kill("SIGKILL")
      await child.exited
    }
  },
  30_000,
)
