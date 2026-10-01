/**
 * Implementer-unit for the Codex R1 P1-2 (add-local-job-api-async-submit,
 * design R4): the create/default-retry wrapper arms its abort relay at
 * admission, before the own pump attempts its claim. A catchable signal that
 * lands before the own claim — while another executor already holds the Run
 * (daemon-first) or while the Run is still queued — relays one cancel for the
 * own admitted ID instead of the default termination, then re-raises the
 * signal. Real processes (POSIX); the frozen `beforeOwnPumpClaim` seam holds
 * the wrapper in the window where the relay used to be unarmed.
 */
import { afterEach, expect, test } from "bun:test"
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
  "local-job-api-relay-arming",
  "child.ts",
)

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

function spawnWrapper(p: Profile, claimAs: { workerPid: number } | null) {
  const requestPath = join(p.root, "relay-arming-request.json")
  writeFileSync(requestPath, JSON.stringify(agentRequest(p)))
  const proc = Bun.spawn(["bun", CHILD], {
    cwd: REPO_ROOT,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      RELAY_ARMING_CHILD_CONFIG: JSON.stringify({
        dbFile: p.ledger.file,
        argv: ["api", "runs", "create", "--request", requestPath, "--json"],
        lockPath: p.lockPath,
        claimAs,
      }),
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  let out = ""
  let err = ""
  const pump = async (
    stream: ReadableStream<Uint8Array>,
    sink: (text: string) => void,
  ) => {
    const decoder = new TextDecoder()
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
      sink(decoder.decode(chunk))
    }
  }
  const done = Promise.allSettled([
    pump(proc.stdout, (text) => {
      out += text
    }),
    pump(proc.stderr, (text) => {
      err += text
    }),
  ])
  const exited = proc.exited.then(async () => {
    await done
    return { code: proc.exitCode, signal: proc.signalCode ?? null }
  })
  return {
    proc,
    exited,
    stdout: () => out,
    stderr: () => err,
    async waitForSeam(ms: number): Promise<boolean> {
      const deadline = performance.now() + ms
      while (performance.now() < deadline) {
        if (/SEAM /.test(err)) return true
        if (proc.exitCode !== null || proc.signalCode) break
        await realDelay(10)
      }
      return /SEAM /.test(err)
    },
  }
}

test.skipIf(process.platform === "win32")(
  "daemon-first: SIGTERM after another executor claimed the Run but before the wrapper's own claim attempt relays one cancel and then re-raises SIGTERM",
  async () => {
    const p = createProfile()
    cleanups.push(p.cleanup)
    const sibling = spawnSibling()
    cleanups.push(sibling.kill)
    const child = spawnWrapper(p, { workerPid: sibling.pid })
    try {
      const held = await child.waitForSeam(10_000)
      const started = performance.now()
      child.proc.kill("SIGTERM")
      const exit = await Promise.race([
        child.exited,
        realDelay(9_000).then(() => ({ code: null, signal: "still-running" })),
      ])
      const elapsed = performance.now() - started
      const rows = apiJobRows(p)
      expect({
        held,
        exitSignal: exit.signal,
        withinAckBound: elapsed <= 6_500,
        stdout: child.stdout(),
        runnerEntered: /RUNNER_ENTERED/.test(child.stderr()),
        rows: rows.map((row) => ({
          status: row.status,
          cancelRequested: row.cancel_requested_at !== null,
          workerPid: row.worker_pid,
        })),
      }).toEqual({
        held: true,
        exitSignal: "SIGTERM",
        withinAckBound: true,
        stdout: "",
        runnerEntered: false,
        // The relayed cancel reached the claimant, which settled it.
        rows: [
          { status: "canceled", cancelRequested: true, workerPid: sibling.pid },
        ],
      })
    } finally {
      child.proc.kill("SIGKILL")
      await child.exited
    }
  },
  30_000,
)

test.skipIf(process.platform === "win32")(
  "before any claim: SIGTERM cancels the wrapper's own queued Run (never started) and then re-raises SIGTERM",
  async () => {
    const p = createProfile()
    cleanups.push(p.cleanup)
    const child = spawnWrapper(p, null)
    try {
      const held = await child.waitForSeam(10_000)
      child.proc.kill("SIGTERM")
      const exit = await Promise.race([
        child.exited,
        realDelay(9_000).then(() => ({ code: null, signal: "still-running" })),
      ])
      const rows = apiJobRows(p)
      expect({
        held,
        exitSignal: exit.signal,
        stdout: child.stdout(),
        runnerEntered: /RUNNER_ENTERED/.test(child.stderr()),
        rows: rows.map((row) => ({
          status: row.status,
          started: countType(p, row.id, "job_started"),
        })),
      }).toEqual({
        held: true,
        exitSignal: "SIGTERM",
        stdout: "",
        runnerEntered: false,
        rows: [{ status: "canceled", started: 0 }],
      })
    } finally {
      child.proc.kill("SIGKILL")
      await child.exited
    }
  },
  30_000,
)
