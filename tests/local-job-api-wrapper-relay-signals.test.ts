/** biome-ignore-all lint/suspicious/noExplicitAny: the harness drives the CLI with structural fakes. */
/**
 * Implementer-unit for the Phase III check P2-1 (add-local-job-api-async-submit
 * R4 relay coverage). Besides SIGINT/SIGTERM (S35), a daemon-first wrapper
 * relays its own cancel on SIGHUP (POSIX terminal hangup, Windows console
 * close) and, on Windows, on SIGBREAK (Ctrl+Break). The relay arms exactly
 * the platform's catchable set, re-raises the caught signal and ends with
 * exit 8 when the runtime cannot raise it (Windows SIGBREAK/SIGHUP).
 */
import { afterEach, expect, spyOn, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { Readable } from "node:stream"
import {
  getOrCreateRunEventLedger,
  releaseRunEventLedger,
} from "../src/main/lib/agent-runtime/run-event-ledger-host"
import { HEADLESS_CLI_MARKER } from "../src/main/lib/headless/cli-args"
import {
  daemonFirstRelaySignals,
  runHeadlessCliCommand,
} from "../src/main/lib/headless/cli-dispatcher"
import * as jobStore from "../src/main/lib/headless/job-store"
import {
  captureLines,
  closeOpenDbs,
  createRegisteredProjectDb,
} from "./local-job-api-async-guards-protocol-kit"
import {
  apiJobRows,
  createProfile,
  fixtureCase,
  type Profile,
  profileVars,
  realDelay,
  renderJson,
  spawnChild,
  spawnSibling,
} from "./local-job-api-async-submit-wait-kit"

const cleanups: Array<() => void> = []

afterEach(() => {
  closeOpenDbs()
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

const SIBLING_PID = 2_147_000_002
const WATCHED: readonly NodeJS.Signals[] = [
  "SIGINT",
  "SIGTERM",
  "SIGHUP",
  "SIGBREAK",
]

test("the relay's catchable set is SIGINT/SIGTERM/SIGHUP on POSIX and adds SIGBREAK on win32", () => {
  expect({
    linux: daemonFirstRelaySignals("linux"),
    darwin: daemonFirstRelaySignals("darwin"),
    win32: daemonFirstRelaySignals("win32"),
  }).toEqual({
    linux: ["SIGINT", "SIGTERM", "SIGHUP"],
    darwin: ["SIGINT", "SIGTERM", "SIGHUP"],
    win32: ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"],
  })
})

function listenerCounts(): Record<string, number> {
  return Object.fromEntries(
    WATCHED.map((signal) => [signal, process.listenerCount(signal)]),
  )
}

/**
 * Runs a daemon-first create in-process (another executor claims the Run
 * first), delivers `signal` through `process.emit` once the relay is armed
 * and records the listeners while armed, the re-raise and the own Run.
 */
async function relayInProcess(
  signal: NodeJS.Signals,
  options: { reraiseThrows?: boolean } = {},
) {
  const store = createRegisteredProjectDb()
  const requestPath = join(store.dir, "relay-signal-request.json")
  writeFileSync(
    requestPath,
    JSON.stringify({
      apiVersion: "locus.local-job.v1",
      consumer: { id: "relay-signal", runExternalId: signal },
      project: { cwd: store.projectCwd },
      runtime: { id: "codex" },
      mode: "plan",
      prompt: { text: "relay signal probe" },
    }),
  )
  const stdout = captureLines(false)
  const stderr = captureLines(false)
  const kills: unknown[][] = []
  const killSpy = spyOn(process, "kill").mockImplementation(((
    ...args: unknown[]
  ) => {
    // Liveness probes (signal 0) are answered "alive"; real signals recorded.
    if (args[1] === 0) return true
    kills.push(args)
    if (options.reraiseThrows) {
      throw Object.assign(new Error("kill ENOSYS"), { code: "ENOSYS" })
    }
    return true
  }) as typeof process.kill)
  const before = listenerCounts()
  let claimed: string | null = null
  let claimant: ReturnType<typeof setInterval> | null = null
  try {
    const exit = runHeadlessCliCommand({
      db: store.db,
      argv: [
        "Locus",
        HEADLESS_CLI_MARKER,
        "api",
        "runs",
        "create",
        "--request",
        requestPath,
        "--json",
      ],
      stdin: Readable.from([""]),
      stdout: stdout.stream,
      stderr: stderr.stream,
      runner: null,
      env: {},
      beforeOwnPumpClaim: async (jobId: string) => {
        await jobStore.startAgentJob(store.db, {
          jobId,
          workerId: `daemon:${SIBLING_PID}:relay-signal:${jobId}`,
          workerPid: SIBLING_PID,
        })
        claimed = jobId
        // The claimant settles canceled as soon as a cancel is requested.
        let settled = false
        claimant = setInterval(() => {
          const row = jobStore.getAgentJob(store.db, jobId)
          if (settled || !row?.cancelRequestedAt) return
          settled = true
          void (async () => {
            const ledger = await getOrCreateRunEventLedger(store.db, row)
            try {
              await ledger.settle(
                {
                  trigger: {
                    kind: "cancel",
                    reason: "cancel_requested",
                    observationKey: `relay-signal-claimant:${jobId}`,
                  },
                  policy: { denied: false, evidenceKeys: [] },
                  output: {
                    valid: true,
                    empty: true,
                    allowEmpty: true,
                    evidenceKeys: [],
                  },
                  postRun: { credentialsSafe: true, evidenceKeys: [] },
                },
                {
                  jobFields: () => ({
                    exitCode: 5,
                    errorCode: "job_canceled",
                    errorMessage: "Job was canceled.",
                  }),
                },
              )
            } finally {
              releaseRunEventLedger(store.db, jobId)
            }
          })()
        }, 5)
      },
    } as Parameters<typeof runHeadlessCliCommand>[0])
    const deadline = Date.now() + 5_000
    while (!claimed && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
    const armed = listenerCounts()
    process.emit(signal as any, signal as any)
    const code = await exit
    const own = jobStore.getAgentJob(store.db, String(claimed))
    return {
      claimed: claimed !== null,
      armedDelta: Object.fromEntries(
        WATCHED.map((name) => [name, armed[name] - before[name]]),
      ),
      afterDelta: Object.fromEntries(
        WATCHED.map((name) => [
          name,
          process.listenerCount(name) - before[name],
        ]),
      ),
      stdout: stdout.text(),
      reraised: kills.map((args) => args.slice(0, 2)),
      ownStatus: own?.status,
      ownCancelRequested: own?.cancelRequestedAt !== null,
      exit: code,
    }
  } finally {
    if (claimant) clearInterval(claimant)
    killSpy.mockRestore()
  }
}

function armedFor(platform: NodeJS.Platform): Record<string, number> {
  const set = daemonFirstRelaySignals(platform)
  return Object.fromEntries(
    WATCHED.map((name) => [name, set.includes(name) ? 1 : 0]),
  )
}

const NONE = Object.fromEntries(WATCHED.map((name) => [name, 0]))

test.skipIf(process.platform === "win32")(
  "POSIX: a daemon-first wrapper arms SIGHUP (not SIGBREAK), relays one cancel on SIGHUP and re-raises SIGHUP",
  async () => {
    expect(await relayInProcess("SIGHUP")).toEqual({
      claimed: true,
      armedDelta: armedFor(process.platform),
      afterDelta: NONE,
      stdout: "",
      reraised: [[process.pid, "SIGHUP"]],
      ownStatus: "canceled",
      ownCancelRequested: true,
      // Only reached because the test intercepts the re-raise.
      exit: 8,
    })
  },
  20_000,
)

for (const signal of ["SIGBREAK", "SIGHUP"] as const) {
  test.skipIf(process.platform !== "win32")(
    `win32: a daemon-first wrapper relays one cancel on ${signal} and re-raises it`,
    async () => {
      expect(await relayInProcess(signal)).toEqual({
        claimed: true,
        armedDelta: armedFor("win32"),
        afterDelta: NONE,
        stdout: "",
        reraised: [[process.pid, signal]],
        ownStatus: "canceled",
        ownCancelRequested: true,
        exit: 8,
      })
    },
    20_000,
  )
}

test("a re-raise the runtime cannot perform (Windows SIGBREAK/SIGHUP) ends the wrapper with exit 8 after the relayed cancel", async () => {
  const result = await relayInProcess("SIGTERM", { reraiseThrows: true })
  expect({
    reraised: result.reraised,
    ownStatus: result.ownStatus,
    ownCancelRequested: result.ownCancelRequested,
    stdout: result.stdout,
    exit: result.exit,
    afterDelta: result.afterDelta,
  }).toEqual({
    reraised: [[process.pid, "SIGTERM"]],
    ownStatus: "canceled",
    ownCancelRequested: true,
    stdout: "",
    exit: 8,
    afterDelta: NONE,
  })
}, 20_000)

test.skipIf(process.platform === "win32")(
  "POSIX real process: SIGHUP of a daemon-first waiter persists the own cancel only, waits at most 5000 ms and ends by SIGHUP",
  async () => {
    const fx = fixtureCase("controls.json", "S35")
    const p: Profile = createProfile()
    cleanups.push(p.cleanup)
    const requestPath = join(p.root, "request.json")
    writeFileSync(
      requestPath,
      JSON.stringify(renderJson(fx.request, profileVars(p))),
    )
    const sibling = spawnSibling()
    const child = spawnChild(
      {
        dbFile: p.ledger.file,
        argv: ["api", "runs", "create", "--request", requestPath, "--json"],
        lockPath: p.lockPath,
        runner: "block",
        claimAs: { workerPid: sibling.pid },
      },
      { stdin: "ignore" },
    )
    try {
      const claimed = await child.waitForStderr(/CLAIMED/, 10_000)
      const started = performance.now()
      child.proc.kill("SIGHUP")
      const exit = await Promise.race([
        child.exited,
        realDelay(fx.ackWaitMaxMs + 2500).then(() => ({
          code: null,
          signal: "still-running",
        })),
      ])
      const elapsed = performance.now() - started
      const rows = apiJobRows(p)
      expect({
        claimed,
        exitSignal: exit.signal,
        withinAckBound: elapsed <= fx.ackWaitMaxMs + 1500,
        rows: rows.length,
        ownCancelRequested: (rows[0]?.cancel_requested_at ?? null) !== null,
        stdoutHasTerminal: child.stdout().includes('"result"'),
      }).toEqual({
        claimed: true,
        exitSignal: "SIGHUP",
        withinAckBound: true,
        rows: 1,
        ownCancelRequested: true,
        stdoutHasTerminal: false,
      })
    } finally {
      child.proc.kill("SIGKILL")
      await child.exited
      sibling.kill()
    }
  },
  30_000,
)
