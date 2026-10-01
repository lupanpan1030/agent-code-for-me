/** biome-ignore-all lint/suspicious/noExplicitAny: test harness child drives the CLI with structural fakes. */
/**
 * Real-process harness child for the submit-wait red suite (S03 real-process
 * variant, S35 wrapper abort). Test infrastructure only.
 *
 * Config arrives as JSON in env `ASYNC_SW_CHILD_CONFIG`:
 *   dbFile       migrated SQLite file of the parent's profile
 *   argv         CLI argv after the headless marker
 *   lockPath     daemon lock path of the profile (absent file = no executor)
 *   runner       "succeed" (returns success at once) | "block" (never returns)
 *   claimAs      optional { workerPid } — the frozen `beforeOwnPumpClaim`
 *                seam claims the wrapper's own admitted Run first, through
 *                the existing claim owner `startAgentJob`, as a daemon
 *                worker whose PID is the given (alive) sibling process.
 *
 * Markers on stderr: `RUNNER_ENTERED <jobId>` when the runtime starts,
 * `CLAIMED <jobId>` after the daemon-first claim, `EXIT <code>` on return.
 */
import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import * as schema from "../../../../src/main/lib/db/schema"
import { HEADLESS_CLI_MARKER } from "../../../../src/main/lib/headless/cli-args"
import { runHeadlessCliCommand } from "../../../../src/main/lib/headless/cli-dispatcher"
import { startAgentJob } from "../../../../src/main/lib/headless/job-store"

const config = JSON.parse(process.env.ASYNC_SW_CHILD_CONFIG ?? "{}") as {
  dbFile: string
  argv: string[]
  lockPath: string | null
  runner: "succeed" | "block"
  claimAs?: { workerPid: number } | null
}

const sqlite = new Database(config.dbFile)
sqlite.exec("PRAGMA journal_mode = WAL")
sqlite.exec("PRAGMA busy_timeout = 5000")
sqlite.exec("PRAGMA foreign_keys = ON")
const db = drizzle(sqlite, { schema })

const runner = async (request: any, observer: any) => {
  process.stderr.write(`RUNNER_ENTERED ${request.identity?.jobId}\n`)
  observer.heartbeat()
  if (config.runner === "block") await new Promise(() => {})
  return {
    status: "succeeded",
    exitCode: 0,
    result: { finalMessage: "child done" },
  }
}

const claimAs = config.claimAs ?? null
const code = await runHeadlessCliCommand({
  db: db as any,
  argv: ["Locus", HEADLESS_CLI_MARKER, ...config.argv],
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  runner: runner as any,
  env: {},
  appVersion: "0.0.async-red",
  daemonLockPath: config.lockPath,
  ...(claimAs
    ? {
        beforeOwnPumpClaim: async (jobId: string) => {
          await startAgentJob(db as any, {
            jobId,
            workerId: `daemon:${claimAs.workerPid}:fixture:${jobId}`,
            workerPid: claimAs.workerPid,
          })
          process.stderr.write(`CLAIMED ${jobId}\n`)
        },
      }
    : {}),
} as any)
process.stderr.write(`EXIT ${code}\n`)
process.exit(code)
