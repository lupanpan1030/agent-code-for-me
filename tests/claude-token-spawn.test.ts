import { beforeEach, describe, expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"

type SpawnCall = {
  command: string
  args: string[]
  options: Record<string, unknown>
}

const spawnCalls: SpawnCall[] = []
let stdoutChunks: string[] = []
let stderrChunks: string[] = []

mock.module("node:child_process", () => ({
  exec: mock(() => {}),
  execFile: mock(() => {}),
  execSync: mock(() => ""),
  spawn: (command: string, args: string[], options: Record<string, unknown>) => {
    spawnCalls.push({ command, args, options })
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      kill: () => void
    }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => {}
    queueMicrotask(() => {
      for (const chunk of stdoutChunks) child.stdout.emit("data", Buffer.from(chunk))
      for (const chunk of stderrChunks) child.stderr.emit("data", Buffer.from(chunk))
      child.emit("close", 1)
    })
    return child
  },
}))

mock.module("../src/main/lib/claude/env", () => ({
  getBundledClaudeBinaryPath: () => "/app/resources/bin/claude",
}))

describe("Claude setup-token spawning", () => {
  beforeEach(() => {
    spawnCalls.length = 0
    stdoutChunks = []
    stderrChunks = []
  })

  test("uses the bundled Claude binary with argv and no shell", async () => {
    const { runClaudeSetupToken } = await import("../src/main/lib/claude-token")

    const result = await runClaudeSetupToken(() => {})

    expect(result.success).toBe(false)
    expect(spawnCalls).toEqual([
      {
        command: "/app/resources/bin/claude",
        args: ["setup-token"],
        options: {
          stdio: ["ignore", "pipe", "pipe"],
          shell: false,
        },
      },
    ])
  })

  test("never forwards credential-bound stdout or stderr content", async () => {
    const token = "setup-token-secret-value"
    stdoutChunks = [token.slice(0, 10), token.slice(10)]
    stderrChunks = [`setup failed with ${token}`]
    const statuses: string[] = []
    const { runClaudeSetupToken } = await import("../src/main/lib/claude-token")

    const result = await runClaudeSetupToken((status) => statuses.push(status))

    expect(result).toEqual({
      success: false,
      error: "Claude setup-token exited with code 1.",
    })
    expect(JSON.stringify({ statuses, result })).not.toContain(token)
    expect(statuses).toEqual(["Starting Claude setup-token..."])
  })
})
