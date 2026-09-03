import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { execFileSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as schema from "../src/main/lib/db/schema"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

let testDb = createAgentJobTestDb()
let testRoot = ""

mock.module("electron", () => ({
  BrowserWindow: class BrowserWindow {},
}))

mock.module("../src/main/lib/db", () => ({
  ...schema,
  getDatabase: () => testDb,
}))

const { agentWorkbenchRouter } = await import(
  "../src/main/lib/trpc/routers/agent-workbench"
)

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" })
}

function gitOutput(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    encoding: "utf8",
  }).trim()
}

function createRepository(name: string): string {
  const repositoryPath = join(testRoot, name)
  mkdirSync(join(repositoryPath, "src"), { recursive: true })
  git(repositoryPath, ["init", "--quiet", "-b", "main"])
  git(repositoryPath, ["config", "user.email", "test@example.com"])
  git(repositoryPath, ["config", "user.name", "Test User"])
  writeFileSync(
    join(repositoryPath, "src/shared.ts"),
    "export const value = 1\n",
  )
  writeFileSync(join(repositoryPath, "src/removed.ts"), "remove me\n")
  writeFileSync(join(repositoryPath, "src/old-name.ts"), "rename me\n")
  git(repositoryPath, ["add", "."])
  git(repositoryPath, ["commit", "--quiet", "-m", "initial"])
  return repositoryPath
}

function seedProject(id: string, name: string, path: string): void {
  testDb.insert(schema.projects).values({ id, name, path }).run()
}

function seedWorkspace(input: {
  id: string
  title: string
  projectId: string
  worktreePath: string | null
  branch?: string | null
  baseCommit?: string
  archivedAt?: Date
}): void {
  testDb
    .insert(schema.chats)
    .values({
      id: input.id,
      name: input.title,
      projectId: input.projectId,
      worktreePath: input.worktreePath,
      branch: input.branch === undefined ? `locus/${input.id}` : input.branch,
      baseBranch: "main",
      baseCommit: input.baseCommit ?? null,
      archivedAt: input.archivedAt ?? null,
      createdAt: new Date("2026-08-13T00:00:00.000Z"),
      updatedAt: new Date("2026-08-13T00:00:00.000Z"),
    })
    .run()
}

beforeEach(() => {
  testDb = createAgentJobTestDb()
  testRoot = mkdtempSync(join(tmpdir(), "locus-workbench-conflicts-"))
})

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

describe("agent workbench task listing", () => {
  test("returns changed files alongside counts and marks deletions", async () => {
    const repositoryPath = createRepository("summary")
    seedProject("project-1", "Project", repositoryPath)
    seedWorkspace({
      id: "workspace-1",
      title: "Summary Workspace",
      projectId: "project-1",
      worktreePath: repositoryPath,
    })

    writeFileSync(
      join(repositoryPath, "src/shared.ts"),
      "export const value = 2\n",
    )
    unlinkSync(join(repositoryPath, "src/removed.ts"))
    renameSync(
      join(repositoryPath, "src/old-name.ts"),
      join(repositoryPath, "src/new-name.ts"),
    )
    git(repositoryPath, ["add", "src/old-name.ts", "src/new-name.ts"])
    writeFileSync(
      join(repositoryPath, "src/file with spaces.ts"),
      "untracked\n",
    )

    const result = await agentWorkbenchRouter
      .createCaller({ getWindow: () => null })
      .listTasks({ filter: "all" })
    const summary = result.tasks[0]?.diff

    expect(summary?.fileCount).toBe(4)
    expect(summary?.additions).not.toBeNull()
    expect(summary?.deletions).not.toBeNull()
    expect(summary?.files).toEqual(
      expect.arrayContaining([
        { path: "src/shared.ts", deleted: false },
        { path: "src/removed.ts", deleted: true },
        { path: "src/new-name.ts", deleted: false },
        {
          path: "src/old-name.ts",
          deleted: true,
          renamedTo: "src/new-name.ts",
        },
        { path: "src/file with spaces.ts", deleted: false },
      ]),
    )
    expect(summary?.files.some((file) => file.path.includes("=>"))).toBe(false)
  })

  test("degrades an unreadable workspace without disturbing healthy conflicts", async () => {
    const firstPath = createRepository("healthy-a")
    const secondPath = createRepository("healthy-b")
    const missingPath = join(testRoot, "missing-worktree")
    seedProject("project-1", "Project", testRoot)
    seedWorkspace({
      id: "healthy-a",
      title: "Workspace Alpha",
      projectId: "project-1",
      worktreePath: firstPath,
    })
    seedWorkspace({
      id: "healthy-b",
      title: "Workspace Beta",
      projectId: "project-1",
      worktreePath: secondPath,
    })
    seedWorkspace({
      id: "broken",
      title: "Broken Workspace",
      projectId: "project-1",
      worktreePath: missingPath,
    })
    testDb
      .insert(schema.subChats)
      .values({
        id: "healthy-a-sub-chat",
        chatId: "healthy-a",
        name: "Active run",
        updatedAt: new Date("2026-08-13T01:00:00.000Z"),
      })
      .run()
    writeFileSync(
      join(firstPath, "src/shared.ts"),
      "export const value = 'alpha'\n",
    )
    writeFileSync(
      join(secondPath, "src/shared.ts"),
      "export const value = 'beta'\n",
    )
    writeFileSync(join(firstPath, "package-lock.json"), "{}\n")
    writeFileSync(join(secondPath, "package-lock.json"), "{}\n")

    const result = await agentWorkbenchRouter
      .createCaller({ getWindow: () => null })
      .listTasks({ filter: "all" })
    const byId = new Map(result.tasks.map((task) => [task.id, task]))

    expect(byId.get("healthy-a")?.conflicts).toEqual([
      {
        path: "src/shared.ts",
        withTaskIds: ["healthy-b"],
        kind: "edit-edit",
      },
    ])
    expect(byId.get("healthy-b")?.conflicts[0]?.withTaskIds).toEqual([
      "healthy-a",
    ])
    expect(byId.get("healthy-a")?.diff.files).toContainEqual({
      path: "package-lock.json",
      deleted: false,
    })
    expect(byId.get("broken")?.diff.files).toEqual([])
    expect(byId.get("broken")?.diff.error).toBeString()
    expect(byId.get("broken")?.conflicts).toEqual([])
    expect(result.workspaceTitlesByTaskId).toEqual({
      "healthy-a": "Workspace Alpha",
      "healthy-b": "Workspace Beta",
      broken: "Broken Workspace",
    })
    expect(result.workspaceStatusHashesByTaskId["healthy-a"]).toHaveLength(64)
    expect(result.workspaceStatusHashesByTaskId["healthy-b"]).toHaveLength(64)
    expect(result.workspaceStatusHashesByTaskId.broken).toHaveLength(64)

    const filtered = await agentWorkbenchRouter
      .createCaller({ getWindow: () => null })
      .listTasks({
        filter: "needs-review",
        runningSubChatIds: ["healthy-a-sub-chat"],
      })

    expect(filtered.tasks.map((task) => task.id)).toEqual(["healthy-b"])
    expect(filtered.tasks[0]?.status).toBe("needs-review")
    expect(filtered.tasks[0]?.conflicts[0]?.withTaskIds).toEqual(["healthy-a"])
    expect(filtered.workspaceTitlesByTaskId["healthy-a"]).toBe(
      "Workspace Alpha",
    )
    expect(filtered.workspaceStatusHashesByTaskId["healthy-a"]).toBe(
      result.workspaceStatusHashesByTaskId["healthy-a"],
    )
    expect(filtered.counts).toMatchObject({
      all: 3,
      running: 1,
      needsReview: 1,
      blocked: 1,
    })
  })

  test("preserves status paths when numstat cannot read a changed blob", async () => {
    const repositoryPath = createRepository("numstat-failure")
    seedProject("project-1", "Project", repositoryPath)
    seedWorkspace({
      id: "workspace-1",
      title: "Workspace",
      projectId: "project-1",
      worktreePath: repositoryPath,
    })

    const blobSha = gitOutput(repositoryPath, [
      "rev-parse",
      "HEAD:src/shared.ts",
    ])
    unlinkSync(
      join(
        repositoryPath,
        ".git",
        "objects",
        blobSha.slice(0, 2),
        blobSha.slice(2),
      ),
    )
    writeFileSync(
      join(repositoryPath, "src/shared.ts"),
      "export const value = 2\n",
    )

    const result = await agentWorkbenchRouter
      .createCaller({ getWindow: () => null })
      .listTasks({ filter: "all" })

    expect(result.tasks[0]?.diff).toMatchObject({
      fileCount: 1,
      additions: null,
      deletions: null,
      files: [{ path: "src/shared.ts", deleted: false }],
    })
    expect(result.tasks[0]?.diff.error).toBeUndefined()
  })

  test("never pairs two local-directory chats backed by the project path", async () => {
    const repositoryPath = createRepository("shared-directory")
    seedProject("project-1", "Project", repositoryPath)
    seedWorkspace({
      id: "workspace-a",
      title: "Workspace A",
      projectId: "project-1",
      worktreePath: repositoryPath,
      branch: null,
    })
    seedWorkspace({
      id: "workspace-b",
      title: "Workspace B",
      projectId: "project-1",
      worktreePath: repositoryPath,
      branch: null,
    })
    writeFileSync(
      join(repositoryPath, "src/shared.ts"),
      "export const value = 2\n",
    )

    const result = await agentWorkbenchRouter
      .createCaller({ getWindow: () => null })
      .listTasks({ filter: "all" })

    expect(result.tasks).toHaveLength(2)
    expect(result.tasks.every((task) => task.conflicts.length === 0)).toBe(true)
    expect(result.eligibleDeepCheckTaskIdsByTaskId).toEqual({
      "workspace-a": [],
      "workspace-b": [],
    })
  })

  test("displays archived tasks without letting them participate in conflicts", async () => {
    const firstPath = createRepository("active-a")
    const secondPath = createRepository("active-b")
    const archivedPath = createRepository("archived")
    seedProject("project-1", "Project", testRoot)
    seedWorkspace({
      id: "active-a",
      title: "Active A",
      projectId: "project-1",
      worktreePath: firstPath,
    })
    seedWorkspace({
      id: "active-b",
      title: "Active B",
      projectId: "project-1",
      worktreePath: secondPath,
    })
    seedWorkspace({
      id: "archived",
      title: "Archived",
      projectId: "project-1",
      worktreePath: archivedPath,
      archivedAt: new Date("2026-08-13T01:00:00.000Z"),
    })
    for (const [index, path] of [
      firstPath,
      secondPath,
      archivedPath,
    ].entries()) {
      writeFileSync(
        join(path, "src/shared.ts"),
        `export const value = ${index + 2}\n`,
      )
    }

    const result = await agentWorkbenchRouter
      .createCaller({ getWindow: () => null })
      .listTasks({ filter: "all", includeArchived: true })
    const byId = new Map(result.tasks.map((task) => [task.id, task]))

    expect(byId.get("active-a")?.conflicts[0]?.withTaskIds).toEqual([
      "active-b",
    ])
    expect(byId.get("active-b")?.conflicts[0]?.withTaskIds).toEqual([
      "active-a",
    ])
    expect(byId.get("archived")?.conflicts).toEqual([])
    expect(result.eligibleDeepCheckTaskIdsByTaskId.archived).toEqual([])
    expect(result.eligibleDeepCheckTaskIdsByTaskId["active-a"]).toEqual([
      "active-a",
      "active-b",
    ])
  })

  test("rejects deep checks containing more than ten task ids", async () => {
    await expect(
      agentWorkbenchRouter
        .createCaller({ getWindow: () => null })
        .checkConflicts({
          taskIds: Array.from({ length: 11 }, (_, index) => `task-${index}`),
        }),
    ).rejects.toThrow()
  })

  test("rejects deep-check task ids from different projects", async () => {
    const firstPath = createRepository("project-a")
    const secondPath = createRepository("project-b")
    seedProject("project-a", "Project A", firstPath)
    seedProject("project-b", "Project B", secondPath)
    seedWorkspace({
      id: "workspace-a",
      title: "Workspace A",
      projectId: "project-a",
      worktreePath: firstPath,
    })
    seedWorkspace({
      id: "workspace-b",
      title: "Workspace B",
      projectId: "project-b",
      worktreePath: secondPath,
    })

    await expect(
      agentWorkbenchRouter
        .createCaller({ getWindow: () => null })
        .checkConflicts({ taskIds: ["workspace-a", "workspace-b"] }),
    ).rejects.toThrow("Conflict checks require tasks from one project")
  })

  test("rejects deep checks the task list is not allowed to advertise", async () => {
    const firstPath = createRepository("eligibility-a")
    const secondPath = createRepository("eligibility-b")
    seedProject("project-1", "Project", testRoot)
    seedWorkspace({
      id: "active-a",
      title: "Active A",
      projectId: "project-1",
      worktreePath: firstPath,
    })
    seedWorkspace({
      id: "active-b",
      title: "Active B",
      projectId: "project-1",
      worktreePath: secondPath,
    })
    seedWorkspace({
      id: "archived",
      title: "Archived",
      projectId: "project-1",
      worktreePath: secondPath,
      archivedAt: new Date("2026-08-13T01:00:00.000Z"),
    })
    seedWorkspace({
      id: "missing-branch",
      title: "Missing Branch",
      projectId: "project-1",
      worktreePath: secondPath,
      branch: null,
    })
    seedWorkspace({
      id: "missing-worktree",
      title: "Missing Worktree",
      projectId: "project-1",
      worktreePath: null,
    })
    seedWorkspace({
      id: "same-directory",
      title: "Same Directory",
      projectId: "project-1",
      worktreePath: firstPath,
    })
    const caller = agentWorkbenchRouter.createCaller({ getWindow: () => null })

    await expect(
      caller.checkConflicts({ taskIds: ["active-a", "archived"] }),
    ).rejects.toThrow("Conflict checks do not allow archived tasks")
    await expect(
      caller.checkConflicts({ taskIds: ["active-a", "missing-branch"] }),
    ).rejects.toThrow("Conflict checks require an active branch for every task")
    await expect(
      caller.checkConflicts({ taskIds: ["active-a", "missing-worktree"] }),
    ).rejects.toThrow("Conflict checks require a worktree for every task")
    await expect(
      caller.checkConflicts({ taskIds: ["active-a", "same-directory"] }),
    ).rejects.toThrow(
      "Conflict checks require tasks from distinct worktree directories",
    )
  })

  test("deep-check procedure returns fingerprints and independent tier verdicts", async () => {
    const repositoryPath = createRepository("deep-main")
    const baseCommit = gitOutput(repositoryPath, ["rev-parse", "HEAD"])
    const firstWorktree = join(testRoot, "deep-worktree-a")
    const secondWorktree = join(testRoot, "deep-worktree-b")
    git(repositoryPath, ["branch", "locus/deep-a"])
    git(repositoryPath, ["branch", "locus/deep-b"])
    git(repositoryPath, [
      "worktree",
      "add",
      "--quiet",
      firstWorktree,
      "locus/deep-a",
    ])
    git(repositoryPath, [
      "worktree",
      "add",
      "--quiet",
      secondWorktree,
      "locus/deep-b",
    ])
    seedProject("deep-project", "Deep Project", repositoryPath)
    seedWorkspace({
      id: "deep-a",
      title: "Deep A",
      projectId: "deep-project",
      worktreePath: firstWorktree,
      branch: "locus/deep-a",
      baseCommit,
    })
    seedWorkspace({
      id: "deep-b",
      title: "Deep B",
      projectId: "deep-project",
      worktreePath: secondWorktree,
      branch: "locus/deep-b",
      baseCommit,
    })
    writeFileSync(
      join(firstWorktree, "src/shared.ts"),
      "export const value = 'first'\n",
    )
    writeFileSync(
      join(secondWorktree, "src/shared.ts"),
      "export const value = 'second'\n",
    )

    const result = await agentWorkbenchRouter
      .createCaller({ getWindow: () => null })
      .checkConflicts({ taskIds: ["deep-b", "deep-a"] })

    expect(result.pairs).toHaveLength(1)
    expect(result.pairs[0]?.taskIds).toEqual(["deep-a", "deep-b"])
    expect(result.pairs[0]?.pathWarnings).toEqual([
      { path: "src/shared.ts", kind: "edit-edit" },
    ])
    expect(result.pairs[0]?.hunkCheck.status).toBe("likely-conflict")
    expect(result.pairs[0]?.mergeTrial.scope).toBe("committed-changes-only")
    expect(result.pairs[0]?.mergeTrial.status).toBe(
      result.capability.available ? "clean" : "unavailable",
    )
    expect(result.fingerprints["deep-a"]?.headSha).toBe(baseCommit)
    expect(result.fingerprints["deep-b"]?.statusHash).toHaveLength(64)
  })

  test("committed-only overlap stays annotation-free but reachable by deep check", async () => {
    const repositoryPath = createRepository("committed-main")
    const baseCommit = gitOutput(repositoryPath, ["rev-parse", "HEAD"])
    const firstWorktree = join(testRoot, "committed-worktree-a")
    const secondWorktree = join(testRoot, "committed-worktree-b")
    git(repositoryPath, ["branch", "locus/committed-a"])
    git(repositoryPath, ["branch", "locus/committed-b"])
    git(repositoryPath, [
      "worktree",
      "add",
      "--quiet",
      firstWorktree,
      "locus/committed-a",
    ])
    git(repositoryPath, [
      "worktree",
      "add",
      "--quiet",
      secondWorktree,
      "locus/committed-b",
    ])
    seedProject("committed-project", "Committed Project", repositoryPath)
    seedWorkspace({
      id: "committed-a",
      title: "Committed A",
      projectId: "committed-project",
      worktreePath: firstWorktree,
      branch: "locus/committed-a",
    })
    seedWorkspace({
      id: "committed-b",
      title: "Committed B",
      projectId: "committed-project",
      worktreePath: secondWorktree,
      branch: "locus/committed-b",
    })
    writeFileSync(join(firstWorktree, "src/shared.ts"), "first commit\n")
    git(firstWorktree, ["add", "src/shared.ts"])
    git(firstWorktree, ["commit", "--quiet", "-m", "first change"])
    writeFileSync(join(secondWorktree, "src/shared.ts"), "second commit\n")
    git(secondWorktree, ["add", "src/shared.ts"])
    git(secondWorktree, ["commit", "--quiet", "-m", "second change"])

    const caller = agentWorkbenchRouter.createCaller({ getWindow: () => null })
    const listed = await caller.listTasks({ filter: "all" })
    expect(listed.tasks.every((task) => task.conflicts.length === 0)).toBe(true)
    expect(listed.tasks.every((task) => task.diff.fileCount === 0)).toBe(true)
    expect(listed.eligibleDeepCheckTaskIdsByTaskId).toEqual({
      "committed-a": ["committed-a", "committed-b"],
      "committed-b": ["committed-b", "committed-a"],
    })

    const committedTaskIds =
      listed.eligibleDeepCheckTaskIdsByTaskId["committed-a"]
    expect(committedTaskIds).toBeDefined()
    if (!committedTaskIds)
      throw new Error("Expected committed deep-check group")
    const verdict = await caller.checkConflicts({ taskIds: committedTaskIds })
    expect(verdict.pairs).toHaveLength(1)
    expect(verdict.pairs[0]?.pathWarnings).toEqual([])
    expect(verdict.pairs[0]?.hunkCheck).toEqual({
      status: "unavailable",
      reason: "head-commits-differ",
    })
    expect(
      testDb
        .select({ id: schema.chats.id, baseCommit: schema.chats.baseCommit })
        .from(schema.chats)
        .all()
        .filter(({ id }) => id === "committed-a" || id === "committed-b")
        .sort((left, right) => left.id.localeCompare(right.id)),
    ).toEqual([
      { id: "committed-a", baseCommit },
      { id: "committed-b", baseCommit },
    ])
    if (verdict.capability.available) {
      expect(verdict.pairs[0]?.mergeTrial).toEqual({
        scope: "committed-changes-only",
        status: "conflict",
        reason: null,
        conflictPaths: ["src/shared.ts"],
      })
    } else {
      expect(verdict.pairs[0]?.mergeTrial).toEqual({
        scope: "committed-changes-only",
        status: "unavailable",
        reason: verdict.capability.reason,
        conflictPaths: [],
      })
    }
  })
})
