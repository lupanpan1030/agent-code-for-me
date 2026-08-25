import { describe, expect, test } from "bun:test"
import {
  type AgentWorkbenchConflictTask,
  computeCrossWorkspaceConflicts,
  computeEligibleDeepCheckTaskIdsByTaskId,
  validateAgentWorkbenchDeepCheckCandidates,
} from "../src/main/lib/agent-workbench/conflicts"
import type { AgentWorkbenchDiffSummary } from "../src/main/lib/agent-workbench/status"

function diff(
  files: AgentWorkbenchDiffSummary["files"],
  error?: string,
): AgentWorkbenchDiffSummary {
  return {
    fileCount: files.length,
    additions: error ? null : 0,
    deletions: error ? null : 0,
    files,
    ...(error ? { error } : {}),
  }
}

function task(
  taskId: string,
  projectId: string,
  files: AgentWorkbenchDiffSummary["files"],
  error?: string,
  worktreePath?: string,
): AgentWorkbenchConflictTask {
  return {
    taskId,
    projectId,
    worktreePath: worktreePath ?? `/worktrees/${taskId}`,
    diff: diff(files, error),
  }
}

describe("cross-workspace conflicts", () => {
  test("detects edit-edit overlap within one project", () => {
    const result = computeCrossWorkspaceConflicts([
      task("task-a", "project-1", [{ path: "src/shared.ts", deleted: false }]),
      task("task-b", "project-1", [{ path: "src/shared.ts", deleted: false }]),
    ])

    expect(result.get("task-a")).toEqual([
      {
        path: "src/shared.ts",
        withTaskIds: ["task-b"],
        kind: "edit-edit",
      },
    ])
    expect(result.get("task-b")?.[0]?.withTaskIds).toEqual(["task-a"])
  })

  test("marks delete-edit overlap distinctly", () => {
    const result = computeCrossWorkspaceConflicts([
      task("delete-task", "project-1", [
        { path: "src/removed.ts", deleted: true },
      ]),
      task("edit-task", "project-1", [
        { path: "src/removed.ts", deleted: false },
      ]),
    ])

    expect(result.get("delete-task")?.[0]?.kind).toBe("delete-edit")
    expect(result.get("edit-task")?.[0]?.kind).toBe("delete-edit")
  })

  test("marks all-deleted overlap as delete-delete", () => {
    const result = computeCrossWorkspaceConflicts([
      task("delete-a", "project-1", [
        { path: "src/removed.ts", deleted: true },
      ]),
      task("delete-b", "project-1", [
        { path: "src/removed.ts", deleted: true },
      ]),
    ])

    expect(result.get("delete-a")?.[0]?.kind).toBe("delete-delete")
    expect(result.get("delete-b")?.[0]?.kind).toBe("delete-delete")
  })

  test("matches a rename under both old and new path identities", () => {
    const result = computeCrossWorkspaceConflicts([
      task("rename-task", "project-1", [
        { path: "src/new-name.ts", deleted: false },
        { path: "src/old-name.ts", deleted: true },
      ]),
      task("old-path-task", "project-1", [
        { path: "src/old-name.ts", deleted: false },
      ]),
      task("new-path-task", "project-1", [
        { path: "src/new-name.ts", deleted: false },
      ]),
    ])

    expect(result.get("rename-task")).toEqual([
      {
        path: "src/new-name.ts",
        withTaskIds: ["new-path-task"],
        kind: "edit-edit",
      },
      {
        path: "src/old-name.ts",
        withTaskIds: ["old-path-task"],
        kind: "delete-edit",
      },
    ])
    expect(result.get("old-path-task")?.[0]?.path).toBe("src/old-name.ts")
    expect(result.get("new-path-task")?.[0]?.path).toBe("src/new-name.ts")
  })

  test("does not overlap identical paths across projects", () => {
    const result = computeCrossWorkspaceConflicts([
      task("task-a", "project-1", [{ path: "src/shared.ts", deleted: false }]),
      task("task-b", "project-2", [{ path: "src/shared.ts", deleted: false }]),
    ])

    expect(result.get("task-a")).toEqual([])
    expect(result.get("task-b")).toEqual([])
  })

  test("does not compare chats backed by the same resolved directory", () => {
    const result = computeCrossWorkspaceConflicts([
      task(
        "task-a",
        "project-1",
        [{ path: "src/shared.ts", deleted: false }],
        undefined,
        "/project",
      ),
      task(
        "task-b",
        "project-1",
        [{ path: "src/shared.ts", deleted: false }],
        undefined,
        "/project/.",
      ),
    ])

    expect(result.get("task-a")).toEqual([])
    expect(result.get("task-b")).toEqual([])
  })

  test("excludes diff-view lock patterns from the conflict map only", () => {
    const files = [
      { path: "bun.lock", deleted: false },
      { path: "src/dependency-lock.snapshot", deleted: false },
      { path: "nested/package-lock.json", deleted: false },
      { path: "nested/pnpm-lock.yaml", deleted: false },
      { path: "nested/yarn.lock", deleted: false },
      { path: "src/shared.ts", deleted: false },
    ]
    const result = computeCrossWorkspaceConflicts([
      task("task-a", "project-1", files),
      task("task-b", "project-1", files),
    ])

    expect(result.get("task-a")).toEqual([
      {
        path: "src/shared.ts",
        withTaskIds: ["task-b"],
        kind: "edit-edit",
      },
    ])
  })

  test("returns no conflicts for a single workspace", () => {
    const result = computeCrossWorkspaceConflicts([
      task("only-task", "project-1", [
        { path: "src/standalone.ts", deleted: false },
      ]),
    ])

    expect(result.get("only-task")).toEqual([])
  })

  test("ignores errored summaries without changing healthy-task conflicts", () => {
    const result = computeCrossWorkspaceConflicts([
      task("healthy-a", "project-1", [
        { path: "src/shared.ts", deleted: false },
      ]),
      task("healthy-b", "project-1", [
        { path: "src/shared.ts", deleted: false },
      ]),
      task(
        "errored",
        "project-1",
        [{ path: "src/shared.ts", deleted: true }],
        "unreadable workspace",
      ),
    ])

    expect(result.get("healthy-a")).toEqual([
      {
        path: "src/shared.ts",
        withTaskIds: ["healthy-b"],
        kind: "edit-edit",
      },
    ])
    expect(result.get("healthy-b")?.[0]?.withTaskIds).toEqual(["healthy-a"])
    expect(result.get("errored")).toEqual([])
  })

  test("builds bounded deep-check groups from active branch workspaces on distinct paths", () => {
    const candidates = Array.from({ length: 12 }, (_, index) => ({
      taskId: `task-${String(index).padStart(2, "0")}`,
      projectId: "project-1",
      worktreePath: `/worktrees/${index}`,
      branch: `locus/${index}`,
      archived: false,
    }))
    candidates.push(
      {
        taskId: "archived",
        projectId: "project-1",
        worktreePath: "/worktrees/archived",
        branch: "locus/archived",
        archived: true,
      },
      {
        taskId: "local-directory",
        projectId: "project-1",
        worktreePath: "/project",
        branch: null,
        archived: false,
      },
    )

    const result = computeEligibleDeepCheckTaskIdsByTaskId(candidates)

    expect(result["task-00"]).toEqual([
      "task-00",
      "task-01",
      "task-02",
      "task-03",
      "task-04",
      "task-05",
      "task-06",
      "task-07",
      "task-08",
      "task-09",
    ])
    expect(result["task-11"]).toHaveLength(10)
    expect(result["task-11"]?.[0]).toBe("task-11")
    expect(result.archived).toEqual([])
    expect(result["local-directory"]).toEqual([])
  })

  test("does not create a deep-check group from same-directory aliases", () => {
    const result = computeEligibleDeepCheckTaskIdsByTaskId([
      {
        taskId: "task-a",
        projectId: "project-1",
        worktreePath: "/project",
        branch: "locus/a",
        archived: false,
      },
      {
        taskId: "task-b",
        projectId: "project-1",
        worktreePath: "/project/.",
        branch: "locus/b",
        archived: false,
      },
    ])

    expect(result).toEqual({ "task-a": [], "task-b": [] })
  })

  test("uses one canonical rule for deep-check admission", () => {
    const first = {
      taskId: "task-a",
      projectId: "project-1",
      worktreePath: "/worktrees/a",
      branch: "locus/a",
      archived: false,
    }
    const second = {
      taskId: "task-b",
      projectId: "project-1",
      worktreePath: "/worktrees/b",
      branch: "locus/b",
      archived: false,
    }

    expect(validateAgentWorkbenchDeepCheckCandidates([first, second])).toEqual({
      eligible: true,
      projectId: "project-1",
      taskIds: ["task-a", "task-b"],
      worktreePaths: ["/worktrees/a", "/worktrees/b"],
    })
    expect(validateAgentWorkbenchDeepCheckCandidates([first])).toEqual({
      eligible: false,
      reason: "too-few-tasks",
    })
    expect(
      validateAgentWorkbenchDeepCheckCandidates([
        first,
        { ...second, taskId: first.taskId },
      ]),
    ).toEqual({ eligible: false, reason: "duplicate-task-id" })
    expect(
      validateAgentWorkbenchDeepCheckCandidates([
        first,
        { ...second, archived: true },
      ]),
    ).toEqual({ eligible: false, reason: "archived-task" })
    expect(
      validateAgentWorkbenchDeepCheckCandidates([
        first,
        { ...second, projectId: null },
      ]),
    ).toEqual({ eligible: false, reason: "missing-project" })
    expect(
      validateAgentWorkbenchDeepCheckCandidates([
        first,
        { ...second, projectId: "project-2" },
      ]),
    ).toEqual({ eligible: false, reason: "mixed-projects" })
    expect(
      validateAgentWorkbenchDeepCheckCandidates([
        first,
        { ...second, branch: null },
      ]),
    ).toEqual({ eligible: false, reason: "missing-branch" })
    expect(
      validateAgentWorkbenchDeepCheckCandidates([
        first,
        { ...second, worktreePath: null },
      ]),
    ).toEqual({ eligible: false, reason: "missing-worktree" })
    expect(
      validateAgentWorkbenchDeepCheckCandidates([
        first,
        { ...second, worktreePath: "/worktrees/a/." },
      ]),
    ).toEqual({ eligible: false, reason: "shared-worktree" })
  })

  test("advertised groups contain at most one task per resolved directory", () => {
    const result = computeEligibleDeepCheckTaskIdsByTaskId([
      {
        taskId: "task-a",
        projectId: "project-1",
        worktreePath: "/worktrees/a",
        branch: "locus/a",
        archived: false,
      },
      {
        taskId: "task-b",
        projectId: "project-1",
        worktreePath: "/worktrees/b",
        branch: "locus/b",
        archived: false,
      },
      {
        taskId: "task-b-alias",
        projectId: "project-1",
        worktreePath: "/worktrees/b/.",
        branch: "locus/b-alias",
        archived: false,
      },
      {
        taskId: "task-c",
        projectId: "project-1",
        worktreePath: "/worktrees/c",
        branch: "locus/c",
        archived: false,
      },
    ])

    expect(result["task-a"]).toEqual(["task-a", "task-b", "task-c"])
  })
})
