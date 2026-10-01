/** biome-ignore-all lint/suspicious/noExplicitAny: test harness child drives the CLI with structural fakes. */
/**
 * Real-process child for the R4 relay-arming regression
 * (tests/local-job-api-wrapper-relay-arming.test.ts). Test infrastructure
 * only.
 *
 * Config arrives as JSON in env `RELAY_ARMING_CHILD_CONFIG`:
 *   dbFile      migrated SQLite file of the parent's profile
 *   argv        CLI argv after the headless marker
 *   lockPath    daemon lock path of the profile
 *   claimAs     optional { workerPid }: the `beforeOwnPumpClaim` seam first
 *               claims the wrapper's own admitted Run as a daemon worker of
 *               that PID and then acknowledges a cancel request by settling
 *               the Run canceled (the daemon's part); without it the Run
 *               stays queued and unclaimed
 *
 * The seam prints `SEAM <jobId>` on stderr once it holds — after the claim
 * when `claimAs` is set — and holds the wrapper there (before the point the
 * relay used to be armed) until the Run is canceled or cancel-requested, at
 * most 5000 ms. The runner prints `RUNNER_ENTERED` and never returns.
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

const config = JSON.parse(process.env.RELAY_ARMING_CHILD_CONFIG ?? "{}") as {
  dbFile: string
  argv: string[]
  lockPath: string | null
  claimAs?: { workerPid: number } | null
}

const sqlite = new Database(config.dbFile)
sqlite.exec("PRAGMA journal_mode = WAL")
sqlite.exec("PRAGMA busy_timeout = 5000")
sqlite.exec("PRAGMA foreign_keys = ON")
const db = drizzle(sqlite, { schema }) as any

const runner = async () => {
  process.stderr.write("RUNNER_ENTERED\n")
  await new Promise(() => {})
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
          observationKey: `relay-arming-claimant:${jobId}`,
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

const claimAs = config.claimAs ?? null
const code = await runHeadlessCliCommand({
  db,
  argv: ["Locus", HEADLESS_CLI_MARKER, ...config.argv],
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  runner: runner as any,
  env: {},
  appVersion: "0.0.relay-arming",
  daemonLockPath: config.lockPath,
  beforeOwnPumpClaim: async (jobId: string) => {
    if (claimAs) {
      await startAgentJob(db, {
        jobId,
        workerId: `daemon:${claimAs.workerPid}:relay-arming:${jobId}`,
        workerPid: claimAs.workerPid,
      })
    }
    process.stderr.write(`SEAM ${jobId}\n`)
    const deadline = Date.now() + 5_000
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
} as any)
process.stderr.write(`EXIT ${code}\n`)
process.exit(code)
