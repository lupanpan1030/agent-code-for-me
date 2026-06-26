import { describe, expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"

type SpawnCall = {
  command: string
  args: string[]
  options: Record<string, unknown>
}

const spawnCalls: SpawnCall[] = []

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
    queueMicrotask(() => child.emit("close", 1))
    return child
  },
}))

mock.module("../src/main/lib/claude/env", () => ({
  getBundledClaudeBinaryPath: () => "/app/resources/bin/claude",
}))

describe("Claude setup-token spawning", () => {
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
})
