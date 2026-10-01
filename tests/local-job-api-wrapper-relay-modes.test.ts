/**
 * Implementer-unit for the T3 review findings on the R4 relay
 * (add-local-job-api-async-submit, design R4 / D2), real processes (POSIX).
 *
 * Already-closed stdin (security P1-1): a stdin pipe whose write end was
 * closed before the command started (Node's `execFileSync` without `input`,
 * `child.stdin.end()` right after spawn) never arms the EOF relay; an open
 * pipe closed later still relays the own cancel.
 */
import { afterEach, expect, test } from "bun:test"
import { spawn, spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  agentRequest,
  apiJobRows,
  countType,
  createProfile,
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
