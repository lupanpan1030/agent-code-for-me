/**
 * Implementer-unit for the Phase I review P2-2 (add-local-job-api-async-submit
 * R4 relay, S35 variant). A daemon-first create wrapper whose claimant
 * acknowledges the relayed cancel immediately must stop its own wait at the
 * signal: it relays one cancel, waits for that terminal and re-raises the
 * signal without writing a (stale) terminal envelope to stdout.
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
import { runHeadlessCliCommand } from "../src/main/lib/headless/cli-dispatcher"
import * as jobStore from "../src/main/lib/headless/job-store"
import {
  captureLines,
  closeOpenDbs,
  createRegisteredProjectDb,
} from "./local-job-api-async-guards-protocol-kit"

afterEach(() => closeOpenDbs())

const SIBLING_PID = 2_147_000_001

test("daemon-first SIGTERM with a fast-acknowledging claimant relays one cancel, writes no terminal envelope and re-raises the signal", async () => {
  const store = createRegisteredProjectDb()
  const requestPath = join(store.dir, "relay-request.json")
  writeFileSync(
    requestPath,
    JSON.stringify({
      apiVersion: "locus.local-job.v1",
      consumer: { id: "relay-probe", runExternalId: "p2-2" },
      project: { cwd: store.projectCwd },
      runtime: { id: "codex" },
      mode: "plan",
      prompt: { text: "relay probe" },
    }),
  )
  const stdout = captureLines(false)
  const stderr = captureLines(false)
  const kills: unknown[][] = []
  const killSpy = spyOn(process, "kill").mockImplementation(((
    ...args: unknown[]
  ) => {
    // Liveness probes (signal 0) are answered "alive"; real signals recorded.
    if (args[1] !== 0) kills.push(args)
    return true
  }) as typeof process.kill)
  let claimed: string | null = null
  let claimant: ReturnType<typeof setInterval> | null = null
  let settledByClaimant = false
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
      // Another executor claims the admitted Run first (daemon-first).
      beforeOwnPumpClaim: async (jobId: string) => {
        await jobStore.startAgentJob(store.db, {
          jobId,
          workerId: `daemon:${SIBLING_PID}:relay-probe:${jobId}`,
          workerPid: SIBLING_PID,
        })
        claimed = jobId
        // The fast claimant settles canceled as soon as a cancel is requested.
        claimant = setInterval(() => {
          const row = jobStore.getAgentJob(store.db, jobId)
          if (settledByClaimant || !row?.cancelRequestedAt) return
          settledByClaimant = true
          void (async () => {
            const ledger = await getOrCreateRunEventLedger(store.db, row)
            try {
              await ledger.settle(
                {
                  trigger: {
                    kind: "cancel",
                    reason: "cancel_requested",
                    observationKey: `relay-probe-claimant:${jobId}`,
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
    // Let the wrapper arm its relay and start waiting, then deliver SIGTERM.
    const deadline = Date.now() + 5_000
    while (!claimed && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
    process.emit("SIGTERM", "SIGTERM")
    const code = await exit
    const own = jobStore.getAgentJob(store.db, String(claimed))
    expect({
      claimed: claimed !== null,
      stdout: stdout.text(),
      reraised: kills.map((args) => args.slice(0, 2)),
      ownStatus: own?.status,
      ownCancelRequested: own?.cancelRequestedAt !== null,
      settledByClaimant,
      fallbackExit: code,
    }).toEqual({
      claimed: true,
      stdout: "",
      reraised: [[process.pid, "SIGTERM"]],
      ownStatus: "canceled",
      ownCancelRequested: true,
      settledByClaimant: true,
      // Only reached because the test intercepts the re-raise.
      fallbackExit: 8,
    })
  } finally {
    if (claimant) clearInterval(claimant)
    killSpy.mockRestore()
  }
}, 20_000)
