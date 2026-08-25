import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { join } from "node:path"
import type { Readable } from "node:stream"

const repoRoot = join(__dirname, "..")
const ONE_MIB = 1024 * 1024
const LATE_STDERR_BYTES = 64 * 1024

async function readStream(stream: Readable | null): Promise<string> {
  if (!stream) return ""
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString("utf-8")
}

describe("headless stdio flushing", () => {
  test("flushes a large Local Job API result JSON envelope through a stdout pipe before exit", async () => {
    const childSource = `
      const { HEADLESS_CLI_MARKER } = await import("./src/main/lib/headless/cli-args.ts")
      const { runHeadlessCliCommand } = await import("./src/main/lib/headless/cli-dispatcher.ts")
      const { flushHeadlessStdio } = await import("./src/main/lib/headless/stdio.ts")
      const { createAgentJob, completeAgentJob } = await import("./src/main/lib/headless/job-store.ts")
      const { createAgentJobTestDb } = await import("./tests/helpers/agent-job-test-db.ts")

      const db = createAgentJobTestDb()
      const job = createAgentJob(db, {
        id: "job_large_pipe_result",
        source: "api",
        runtime: "codex",
        mode: "plan",
        cwd: process.cwd(),
        prompt: "large result",
        apiConsumerId: "pipe-test",
        apiConsumerRunId: "large-json",
      })
      completeAgentJob(db, {
        jobId: job.id,
        status: "succeeded",
        exitCode: 0,
        result: {
          finalMessage: "x".repeat(${ONE_MIB}),
        },
      })

      const exitCode = await runHeadlessCliCommand({
        db,
        argv: [
          "Locus",
          HEADLESS_CLI_MARKER,
          "api",
          "runs",
          "result",
          job.id,
          "--json",
        ],
        stdout: process.stdout,
        stderr: process.stderr,
      })
      await flushHeadlessStdio(process.stdout, process.stderr)
      process.exitCode = exitCode
    `
    const child = spawn(process.execPath, ["--eval", childSource], {
      cwd: repoRoot,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const [stdout, stderr, closeArgs] = await Promise.all([
      readStream(child.stdout),
      readStream(child.stderr),
      once(child, "close"),
    ])
    const [code, signal] = closeArgs as [number | null, NodeJS.Signals | null]

    expect(signal).toBeNull()
    expect(code).toBe(0)
    expect(stderr).toBe("")
    expect(stdout.length).toBeGreaterThan(ONE_MIB)

    const parsed = JSON.parse(stdout)
    expect(parsed.apiVersion).toBe("locus.local-job.v1")
    expect(parsed.jobId).toBe("job_large_pipe_result")
    expect(parsed.status).toBe("succeeded")
    expect(typeof parsed.result.finalMessage).toBe("string")
    expect(parsed.result.finalMessage).toHaveLength(ONE_MIB)
  })

  test("keeps piped stdio writable after the flush barrier for late runtime output", async () => {
    const lateStdout = "\nlate-stdout-after-barrier\n"
    const lateStderr = `late-stderr-after-barrier:${"z".repeat(LATE_STDERR_BYTES)}\n`
    const childSource = `
      const { flushHeadlessStdio } = await import("./src/main/lib/headless/stdio.ts")

      process.stdout.write("x".repeat(${ONE_MIB}))
      await flushHeadlessStdio(process.stdout, process.stderr)
      await new Promise((resolve) => setImmediate(resolve))

      process.stdout.write(${JSON.stringify(lateStdout)})
      process.stderr.write("late-stderr-after-barrier:" + "z".repeat(${LATE_STDERR_BYTES}) + "\\n")
      await flushHeadlessStdio(process.stdout, process.stderr)
      process.exit(0)
    `
    const child = spawn("node", ["--eval", childSource], {
      cwd: repoRoot,
      env: {
        ...process.env,
        NODE_NO_WARNINGS: "1",
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const [stdout, stderr, closeArgs] = await Promise.all([
      readStream(child.stdout),
      readStream(child.stderr),
      once(child, "close"),
    ])
    const [code, signal] = closeArgs as [number | null, NodeJS.Signals | null]

    expect(signal).toBeNull()
    expect(code).toBe(0)
    expect(stdout).toBe(`${"x".repeat(ONE_MIB)}${lateStdout}`)
    expect(stderr).toBe(lateStderr)
  })
})
