import { beforeEach, describe, expect, mock, test } from "bun:test"
import { eq } from "drizzle-orm"
import * as schema from "../src/main/lib/db/schema"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

let testDb = createAgentJobTestDb()

mock.module("electron", () => ({
  BrowserWindow: class BrowserWindow {},
}))

mock.module("../src/main/lib/db", () => ({
  ...schema,
  getDatabase: () => testDb,
}))

mock.module("../src/main/lib/project-chat-worktree", () => ({
  resolveProjectChatWorktree: async () => ({
    worktreePath: "/tmp/project-worktree",
    branch: "locus-worktree",
    baseBranch: "main",
    baseCommit: "fork-commit-sha",
  }),
}))

mock.module("../src/main/lib/chats/workspace-cleanup", () => ({
  cleanupChatWorkspaceForDelete: async () => ({
    success: true,
    workspaceId: null,
    worktreeRemoved: false,
    terminalKilled: 0,
    terminalFailed: 0,
    errors: [],
  }),
}))

mock.module("../src/main/lib/git", () => ({
  removeWorktree: async () => ({ success: true }),
}))

mock.module("../src/main/lib/git/cache", () => ({
  gitCache: {
    invalidateStatus: () => {},
    invalidateParsedDiff: () => {},
  },
}))

mock.module("../src/main/lib/terminal/manager", () => ({
  terminalManager: {
    killByWorkspaceId: async () => ({ killed: 0, failed: 0 }),
  },
}))

mock.module("../src/main/lib/trpc/routers/chats-helpers", () => ({
  sendWorktreeSetupApprovalRequired: () => {},
  sendWorktreeSetupFailure: () => {},
}))

const { chatCrudProcedures } = await import(
  "../src/main/lib/trpc/routers/chats-crud"
)
const { router } = await import("../src/main/lib/trpc")
const createChatRouter = router({ create: chatCrudProcedures.create })

beforeEach(() => {
  testDb = createAgentJobTestDb()
  testDb
    .insert(schema.projects)
    .values({
      id: "project-1",
      name: "Project",
      path: "/tmp/project",
    })
    .run()
})

describe("chat creation base commit persistence", () => {
  test("create with worktree persists the resolved base commit", async () => {
    const caller = createChatRouter.createCaller({ getWindow: () => null })

    const created = await caller.create({
      projectId: "project-1",
      name: "Workspace",
      baseBranch: "main",
      branchType: "local",
      useWorktree: true,
      mode: "agent",
    })

    expect(created.baseCommit).toBe("fork-commit-sha")
    expect(
      testDb
        .select({ baseCommit: schema.chats.baseCommit })
        .from(schema.chats)
        .where(eq(schema.chats.id, created.id))
        .get()?.baseCommit,
    ).toBe("fork-commit-sha")
  })
})
