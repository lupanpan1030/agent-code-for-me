import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import * as schema from "../src/main/lib/db/schema"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

type IpcHandler = (event: { sender: unknown }, worktreePath: string) => Promise<void>

let testDb = createAgentJobTestDb()
const ipcHandlers = new Map<string, IpcHandler>()
const subscribeCalls: string[] = []
const unsubscribeCalls: string[] = []

const fakeWindow = {
  id: 42,
  isDestroyed: () => false,
  webContents: {
    send: () => {},
  },
}

mock.module("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => {
      ipcHandlers.set(channel, handler)
    },
  },
  BrowserWindow: {
    fromWebContents: () => fakeWindow,
    fromId: () => fakeWindow,
  },
}))

mock.module("../src/main/lib/db", () => ({
  ...schema,
  getDatabase: () => testDb,
}))

mock.module("../src/main/lib/git/cache", () => ({
  gitCache: {
    invalidateStatus: () => {},
    invalidateParsedDiff: () => {},
  },
}))

mock.module("../src/main/lib/git/watcher/git-watcher", () => ({
  gitWatcherRegistry: {
    subscribe: async (worktreePath: string) => {
      subscribeCalls.push(worktreePath)
      return () => {
        unsubscribeCalls.push(worktreePath)
      }
    },
    disposeAll: async () => {},
  },
}))

const { cleanupGitWatchers, registerGitWatcherIPC } = await import(
  "../src/main/lib/git/watcher/ipc-bridge"
)

function subscribeHandler(): IpcHandler {
  const handler = ipcHandlers.get("git:subscribe-watcher")
  if (!handler) throw new Error("git:subscribe-watcher handler was not registered")
  return handler
}

describe("git watcher IPC bridge", () => {
  beforeEach(async () => {
    await cleanupGitWatchers()
    testDb = createAgentJobTestDb()
    ipcHandlers.clear()
    subscribeCalls.length = 0
    unsubscribeCalls.length = 0
    registerGitWatcherIPC()
  })

  afterEach(async () => {
    await cleanupGitWatchers()
  })

  test("rejects watcher subscriptions for unregistered worktree paths", async () => {
    await expect(
      subscribeHandler()({ sender: {} }, "/tmp/locus-unregistered-worktree"),
    ).rejects.toThrow("Workspace path not registered in database")

    expect(subscribeCalls).toEqual([])
  })

  test("allows watcher subscriptions for registered project and chat worktree paths", async () => {
    const projectPath = "/tmp/locus-registered-project"
    const worktreePath = "/tmp/locus-registered-worktree"
    testDb
      .insert(schema.projects)
      .values({ id: "project-1", name: "Project", path: projectPath })
      .run()
    testDb
      .insert(schema.chats)
      .values({
        id: "chat-1",
        projectId: "project-1",
        worktreePath,
      })
      .run()

    await expect(
      subscribeHandler()({ sender: {} }, projectPath),
    ).resolves.toBeUndefined()
    await expect(
      subscribeHandler()({ sender: {} }, worktreePath),
    ).resolves.toBeUndefined()

    expect(subscribeCalls).toEqual([projectPath, worktreePath])
  })
})
