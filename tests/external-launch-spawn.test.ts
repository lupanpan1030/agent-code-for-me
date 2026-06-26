import { afterEach, describe, expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"

type SpawnCall = {
  command: string
  args: string[]
  options: Record<string, unknown>
}

const spawnCalls: SpawnCall[] = []
const lookupCalls: Array<{ command: string; args: string[] }> = []

mock.module("node:child_process", () => ({
  execFileSync: (command: string, args: string[]) => {
    lookupCalls.push({ command, args })
    if (args[0] === "cursor") return "/safe/bin/cursor\n"
    throw new Error("not found")
  },
  spawn: (command: string, args: string[], options: Record<string, unknown>) => {
    spawnCalls.push({ command, args, options })
    const child = new EventEmitter() as EventEmitter & { unref: () => void }
    child.unref = () => {}
    queueMicrotask(() => child.emit("spawn"))
    return child
  },
}))

mock.module("electron", () => ({
  clipboard: { writeText: mock(() => {}) },
  dialog: { showSaveDialog: mock(() => Promise.resolve({ canceled: true })) },
  shell: {
    openExternal: mock(() => Promise.resolve()),
    openPath: mock(() => Promise.resolve("")),
    showItemInFolder: mock(() => {}),
  },
  BrowserWindow: class {},
}))

describe("external launch spawning", () => {
  afterEach(() => {
    spawnCalls.length = 0
    lookupCalls.length = 0
  })

  test("openInApp launches the resolved executable with argv and no shell", async () => {
    const { externalRouter } = await import(
      "../src/main/lib/trpc/routers/external"
    )
    const caller = externalRouter.createCaller({ getWindow: () => null })

    await caller.openInApp({
      app: "cursor",
      path: "/tmp/project/file & echo injected",
    })

    expect(lookupCalls).toEqual([{ command: "which", args: ["cursor"] }])
    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0]).toMatchObject({
      command: "/safe/bin/cursor",
      args: ["/tmp/project/file & echo injected"],
      options: {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        shell: false,
      },
    })
  })
})
