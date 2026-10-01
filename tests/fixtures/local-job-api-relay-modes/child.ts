/** biome-ignore-all lint/suspicious/noExplicitAny: test harness child drives the CLI with structural fakes. */
/**
 * Real-process child for the R4 relay-mode regressions
 * (tests/local-job-api-wrapper-relay-modes.test.ts). Test infrastructure
 * only.
 *
 * Config arrives as JSON in env `RELAY_MODES_CHILD_CONFIG`:
 *   dbFile      migrated SQLite file of the parent's profile
 *   argv        CLI argv after the headless marker
 *   lockPath    daemon lock path of the profile
 *   runner      "succeed" (returns a succeeded outcome) or "block" (never
 *               returns); both print `RUNNER_ENTERED` on stderr
 *   signalOn    optional { eventType, signal }: the store hook sends `signal`
 *               to this process synchronously when the INSERT of the first
 *               `agent_job_events` row of that type runs (`SIGNALED <type>`)
 *   seam        optional `beforeOwnPumpClaim` behaviour: prints
 *               `SEAM <jobId>`, first claims the Run as a daemon worker of
 *               `claimAs.workerPid` when given, then holds up to `holdMs`
 *               (returning early once the Run is canceled or, when claimed
 *               here, cancel-requested — that claimant then settles it
 *               canceled)
 */
import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import {
  getOrCreateRunEventLedger,
  releaseRunEventLedger,
} from "../../../src/main/lib/agent-runtime/run-event-ledger-host"
import * as schema from "../../../src/main/lib/db/schema"
import { HEADLESS_CLI_MARKER } from "../../../src/main/lib/headless/cli-args"
import { runHeadlessCliCommand } from "../../../src/main/lib/headless/cli-dispatcher"
import {
  getAgentJob,
  startAgentJob,
} from "../../../src/main/lib/headless/job-store"

const config = JSON.parse(process.env.RELAY_MODES_CHILD_CONFIG ?? "{}") as {
  dbFile: string
  argv: string[]
  lockPath: string | null
  runner: "succeed" | "block"
  signalOn?: { eventType: string; signal: NodeJS.Signals } | null
  seam?: { holdMs: number; claimAs?: { workerPid: number } | null } | null
}

const sqlite = new Database(config.dbFile)
sqlite.exec("PRAGMA journal_mode = WAL")
sqlite.exec("PRAGMA busy_timeout = 5000")
sqlite.exec("PRAGMA foreign_keys = ON")

let signaled = false
/** The store hook: signals this process at the configured append. */
function storeHook(sql: string, params: unknown[]): void {
  if (!/insert into "agent_job_events"/i.test(sql)) return
  const signalOn = config.signalOn ?? null
  if (signalOn && !signaled && params.includes(signalOn.eventType)) {
    signaled = true
    process.stderr.write(`SIGNALED ${signalOn.eventType}\n`)
    process.kill(process.pid, signalOn.signal)
  }
}

const wrapStatement = (sql: string, statement: any) =>
  new Proxy(statement, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (
        typeof value === "function" &&
        ["get", "all", "values", "run"].includes(String(prop))
      ) {
        return (...params: unknown[]) => {
          storeHook(sql, params.flat())
          return value.apply(target, params)
        }
      }
      return typeof value === "function" ? value.bind(target) : value
    },
  })
const hooked = new Proxy(sqlite, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver)
    if (prop === "prepare" || prop === "query") {
      return (sql: string, ...rest: unknown[]) =>
        wrapStatement(sql, (value as any).call(target, sql, ...rest))
    }
    return typeof value === "function" ? value.bind(target) : value
  },
}) as Database
const db = drizzle(hooked, { schema }) as any

const runner = async () => {
  process.stderr.write("RUNNER_ENTERED\n")
  if (config.runner === "block") await new Promise(() => {})
  return {
    exitCode: 0,
    status: "succeeded",
    result: { finalMessage: "relay modes ok" },
  }
}

async function settleCanceled(jobId: string): Promise<void> {
  const row = getAgentJob(db, jobId)
  if (!row) return
  const ledger = await getOrCreateRunEventLedger(db, row)
  try {
    await ledger.settle(
      {
        trigger: {
          kind: "cancel",
          reason: "cancel_requested",
          observationKey: `relay-modes-claimant:${jobId}`,
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
    releaseRunEventLedger(db, jobId)
  }
}

const seam = config.seam ?? null
const claimAs = seam?.claimAs ?? null
const code = await runHeadlessCliCommand({
  db,
  argv: ["Locus", HEADLESS_CLI_MARKER, ...config.argv],
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  runner: runner as any,
  env: {},
  appVersion: "0.0.relay-modes",
  daemonLockPath: config.lockPath,
  ...(seam
    ? {
        beforeOwnPumpClaim: async (jobId: string) => {
          if (claimAs) {
            await startAgentJob(db, {
              jobId,
              workerId: `daemon:${claimAs.workerPid}:relay-modes:${jobId}`,
              workerPid: claimAs.workerPid,
            })
          }
          process.stderr.write(`SEAM ${jobId}\n`)
          const deadline = Date.now() + seam.holdMs
          while (Date.now() < deadline) {
            const row = getAgentJob(db, jobId)
            if (row?.status === "canceled") return
            if (claimAs && row?.cancelRequestedAt) {
              await settleCanceled(jobId)
              return
            }
            await new Promise((resolve) => setTimeout(resolve, 10))
          }
        },
      }
    : {}),
} as any)
process.stderr.write(`EXIT ${code}\n`)
process.exit(code)
