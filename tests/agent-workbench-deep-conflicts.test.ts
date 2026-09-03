import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { computeAgentWorkbenchStatusHash } from "../src/main/lib/agent-workbench/conflicts"
import {
  OPERATION_TIMED_OUT,
  settleWithinRequest,
} from "../src/main/lib/agent-workbench/deep-conflict-deadline"
import {
  type ConflictDeepCheckDependencies,
  type ConflictWorkspaceInput,
  checkCrossWorkspaceConflicts,
  createMergeTreeCapabilityProbe,
  isMergeTreeConflictExitCode,
  MAX_DEEP_CONFLICT_DIFF_BYTES,
  MAX_MERGE_TREE_CONCURRENCY,
  MERGE_TREE_MINIMUM_VERSION,
  type MergeTreeCapability,
  parseGitMergeTreeCapability,
  parseMergeTreeConflictPaths,
  runGitMergeTreeTrial,
  type WorkspaceDiffResult,
} from "../src/main/lib/agent-workbench/deep-conflicts"
import type { AgentWorkbenchDiffSummary } from "../src/main/lib/agent-workbench/status"
import { prepareConflictWorkspaceSnapshot } from "../src/main/lib/agent-workbench/workspace-conflict-snapshot"

const supportedCapability: MergeTreeCapability = {
  available: true,
  gitVersion: "2.50.1",
  minimumVersion: MERGE_TREE_MINIMUM_VERSION,
  reason: null,
}

function summary(path = "src/shared.ts"): AgentWorkbenchDiffSummary {
  return {
    fileCount: 1,
    additions: 1,
    deletions: 1,
    files: [{ path, deleted: false }],
  }
}

function unifiedDiff(path: string, line: number): string {
  return [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${line},2 +${line},2 @@`,
    "-before",
    "+after",
  ].join("\n")
}

function workspace(taskId: string): ConflictWorkspaceInput {
  return {
    taskId,
    projectPath: "/project",
    worktreePath: `/worktrees/${taskId}`,
    branch: `locus/${taskId}`,
    baseBranch: "main",
  }
}

function dependencies(input?: {
  bases?: Record<string, string | null>
  heads?: Record<string, string | null>
  headSequences?: Record<string, Array<string | null>>
  lines?: Record<string, number>
  summaries?: Record<string, AgentWorkbenchDiffSummary>
  summarySequences?: Record<string, AgentWorkbenchDiffSummary[]>
  diffSequences?: Record<string, WorkspaceDiffResult[]>
  capability?: MergeTreeCapability
  runMergeTreeTrial?: ConflictDeepCheckDependencies["runMergeTreeTrial"]
  mergeTrialTimeoutMs?: number
  mergeTrialBatchDeadlineMs?: number
  mergeTrialConcurrency?: number
}): ConflictDeepCheckDependencies {
  const headCalls = new Map<string, number>()
  const summaryCalls = new Map<string, number>()
  const diffCalls = new Map<string, number>()
  return {
    ensureBaseCommit: async (taskId) =>
      input?.bases?.[taskId] === undefined
        ? "shared-base"
        : input.bases[taskId],
    getHeadSha: async (worktreePath) => {
      const taskId = worktreePath.split("/").at(-1) ?? "unknown"
      const sequence = input?.headSequences?.[taskId]
      if (sequence) {
        const call = headCalls.get(taskId) ?? 0
        headCalls.set(taskId, call + 1)
        return sequence[Math.min(call, sequence.length - 1)] ?? null
      }
      return input?.heads?.[taskId] === undefined
        ? "shared-head"
        : input.heads[taskId]
    },
    getWorkspaceSummary: async (worktreePath) => {
      const taskId = worktreePath.split("/").at(-1) ?? "unknown"
      const sequence = input?.summarySequences?.[taskId]
      if (sequence) {
        const call = summaryCalls.get(taskId) ?? 0
        summaryCalls.set(taskId, call + 1)
        return sequence[Math.min(call, sequence.length - 1)] ?? summary()
      }
      return input?.summaries?.[taskId] ?? summary()
    },
    getWorkspaceDiff: async (worktreePath) => {
      const taskId = worktreePath.split("/").at(-1) ?? "unknown"
      const sequence = input?.diffSequences?.[taskId]
      if (sequence) {
        const call = diffCalls.get(taskId) ?? 0
        diffCalls.set(taskId, call + 1)
        return (
          sequence[Math.min(call, sequence.length - 1)] ?? {
            success: false,
          }
        )
      }
      return {
        success: true,
        diff: unifiedDiff("src/shared.ts", input?.lines?.[taskId] ?? 5),
      }
    },
    probeMergeTreeCapability: async () =>
      input?.capability ?? supportedCapability,
    runMergeTreeTrial:
      input?.runMergeTreeTrial ??
      (async () => ({ status: "clean", reason: null, conflictPaths: [] })),
    now: () => new Date("2026-08-13T02:00:00.000Z"),
    ...(input?.mergeTrialTimeoutMs === undefined
      ? {}
      : { mergeTrialTimeoutMs: input.mergeTrialTimeoutMs }),
    ...(input?.mergeTrialBatchDeadlineMs === undefined
      ? {}
      : { mergeTrialBatchDeadlineMs: input.mergeTrialBatchDeadlineMs }),
    ...(input?.mergeTrialConcurrency === undefined
      ? {}
      : { mergeTrialConcurrency: input.mergeTrialConcurrency }),
  }
}

describe("agent workbench deep conflicts", () => {
  test("computes a stable tier-a status hash independent of file order", () => {
    const first: AgentWorkbenchDiffSummary = {
      fileCount: 2,
      additions: 3,
      deletions: 1,
      files: [
        { path: "z.ts", deleted: false },
        { path: "a.ts", deleted: true, renamedTo: "b.ts" },
      ],
    }
    const reordered = { ...first, files: first.files.slice().reverse() }
    const changed = { ...first, additions: 4 }

    expect(computeAgentWorkbenchStatusHash(first)).toBe(
      computeAgentWorkbenchStatusHash(reordered),
    )
    expect(computeAgentWorkbenchStatusHash(first)).not.toBe(
      computeAgentWorkbenchStatusHash(changed),
    )
    expect(computeAgentWorkbenchStatusHash(first)).toHaveLength(64)
  })

  test("parses Apple Git suffixes and rejects versions older than 2.38", () => {
    expect(
      parseGitMergeTreeCapability("git version 2.50.1 (Apple Git-155)\n"),
    ).toEqual(supportedCapability)
    expect(parseGitMergeTreeCapability("git version 2.34.1\n")).toEqual({
      available: false,
      gitVersion: "2.34.1",
      minimumVersion: MERGE_TREE_MINIMUM_VERSION,
      reason: "git-too-old",
    })
    expect(parseGitMergeTreeCapability("unexpected output").reason).toBe(
      "version-unparseable",
    )
  })

  test("caches a failed git capability probe and degrades without throwing", async () => {
    let calls = 0
    const probe = createMergeTreeCapabilityProbe(async () => {
      calls += 1
      throw new Error("git unavailable")
    })

    const [first, second] = await Promise.all([probe(), probe()])
    expect(first).toEqual({
      available: false,
      gitVersion: null,
      minimumVersion: MERGE_TREE_MINIMUM_VERSION,
      reason: "version-unavailable",
    })
    expect(second).toEqual(first)
    expect(calls).toBe(1)
  })

  test("degrades when an injected capability probe rejects", async () => {
    let mergeTrials = 0
    const deps = dependencies({
      heads: { "task-a": "head-a", "task-b": "head-b" },
      runMergeTreeTrial: async () => {
        mergeTrials += 1
        return { status: "clean", reason: null, conflictPaths: [] }
      },
    })
    deps.probeMergeTreeCapability = async () => {
      throw new Error("probe failed")
    }

    const result = await checkCrossWorkspaceConflicts(
      [workspace("task-a"), workspace("task-b")],
      deps,
    )

    expect(result.capability.reason).toBe("version-unavailable")
    expect(result.pairs[0]?.hunkCheck).toEqual({
      status: "unavailable",
      reason: "head-commits-differ",
    })
    expect(result.pairs[0]?.mergeTrial.reason).toBe("version-unavailable")
    expect(mergeTrials).toBe(0)
  })

  test("parses real merge-tree NUL output before the message separator", () => {
    expect(
      parseMergeTreeConflictPaths(
        "tree-sha\0src/a.ts\0src/b.ts\0\0Auto-merging\0message\0",
      ),
    ).toEqual(["src/a.ts", "src/b.ts"])
    expect(parseMergeTreeConflictPaths("tree-sha\0")).toEqual([])
  })

  test("recognizes numeric and string exit-one merge conflicts", () => {
    expect(isMergeTreeConflictExitCode(1)).toBe(true)
    expect(isMergeTreeConflictExitCode("1")).toBe(true)
    expect(isMergeTreeConflictExitCode(128)).toBe(false)
    expect(isMergeTreeConflictExitCode(undefined)).toBe(false)
  })

  test("different base commits produce no tier-b verdict and state the reason", async () => {
    const result = await checkCrossWorkspaceConflicts(
      [workspace("task-b"), workspace("task-a")],
      dependencies({ bases: { "task-a": "base-a", "task-b": "base-b" } }),
    )

    expect(result.pairs[0]?.taskIds).toEqual(["task-a", "task-b"])
    expect(result.pairs[0]?.hunkCheck).toEqual({
      status: "unavailable",
      reason: "base-commits-differ",
    })
    expect(result.pairs[0]?.files[0]?.hunkStatus).toBe("unavailable")
    expect(result.pairs[0]?.pathWarnings).toHaveLength(1)
  })

  test("a null base commit produces no tier-b verdict and states the reason", async () => {
    const result = await checkCrossWorkspaceConflicts(
      [workspace("task-a"), workspace("task-b")],
      dependencies({ bases: { "task-a": null, "task-b": "base-b" } }),
    )

    expect(result.pairs[0]?.hunkCheck).toEqual({
      status: "unavailable",
      reason: "base-commit-missing",
    })
    expect(result.pairs[0]?.files[0]?.hunkOverlaps).toEqual([])
  })

  test("different current HEADs produce no tier-b verdict despite equal fork commits", async () => {
    const result = await checkCrossWorkspaceConflicts(
      [workspace("task-a"), workspace("task-b")],
      dependencies({
        heads: { "task-a": "head-a", "task-b": "head-b" },
      }),
    )

    expect(result.pairs[0]?.hunkCheck).toEqual({
      status: "unavailable",
      reason: "head-commits-differ",
    })
    expect(result.pairs[0]?.files[0]?.hunkStatus).toBe("unavailable")
    expect(result.pairs[0]?.pathWarnings).toHaveLength(1)
  })

  test("bounds each Workspace diff with HEAD reads and rejects a raced snapshot", async () => {
    const events: string[] = []
    const headCalls = new Map<string, number>()
    let mergeTrials = 0
    const deps = dependencies({
      runMergeTreeTrial: async () => {
        mergeTrials += 1
        return { status: "clean", reason: null, conflictPaths: [] }
      },
    })
    deps.getHeadSha = async (worktreePath) => {
      const taskId = worktreePath.split("/").at(-1) ?? "unknown"
      events.push(`${taskId}:head`)
      const call = headCalls.get(taskId) ?? 0
      headCalls.set(taskId, call + 1)
      if (taskId === "task-a") return call === 0 ? "head-a" : "head-a-next"
      return "head-b"
    }
    deps.getWorkspaceDiff = async (worktreePath) => {
      const taskId = worktreePath.split("/").at(-1) ?? "unknown"
      events.push(`${taskId}:diff`)
      return { success: true, diff: unifiedDiff("src/shared.ts", 5) }
    }

    const result = await checkCrossWorkspaceConflicts(
      [workspace("task-a"), workspace("task-b")],
      deps,
    )

    expect(events.filter((event) => event.startsWith("task-a:"))).toEqual([
      "task-a:head",
      "task-a:diff",
      "task-a:diff",
      "task-a:head",
    ])
    expect(result.fingerprints["task-a"]?.headSha).toBeNull()
    expect(result.pairs[0]?.hunkCheck).toEqual({
      status: "unavailable",
      reason: "diff-unavailable",
      unavailableDetail: "workspace-head-changed",
    })
    expect(result.pairs[0]?.mergeTrial).toEqual({
      scope: "committed-changes-only",
      status: "unavailable",
      reason: "trial-failed",
      unavailableDetail: "workspace-head-changed",
      conflictPaths: [],
    })
    expect(mergeTrials).toBe(0)
  })

  test("does not mislabel one missing HEAD read as a moved Workspace HEAD", async () => {
    let mergeTrials = 0
    const result = await checkCrossWorkspaceConflicts(
      [workspace("task-a"), workspace("task-b")],
      dependencies({
        headSequences: {
          "task-a": [null, "sha-a"],
          "task-b": ["sha-b", "sha-b"],
        },
        runMergeTreeTrial: async () => {
          mergeTrials += 1
          return { status: "clean", reason: null, conflictPaths: [] }
        },
      }),
    )

    expect(result.fingerprints["task-a"]?.headSha).toBeNull()
    expect(result.pairs[0]?.hunkCheck).toEqual({
      status: "unavailable",
      reason: "head-commit-missing",
    })
    expect(result.pairs[0]?.mergeTrial).toEqual({
      scope: "committed-changes-only",
      status: "unavailable",
      reason: "trial-failed",
      unavailableDetail: "head-commit-unavailable",
      conflictPaths: [],
    })
    expect(mergeTrials).toBe(0)
  })

  test("builds warnings, hunks, and fingerprints only from the current deep snapshot", async () => {
    const previousListSummary: AgentWorkbenchDiffSummary = {
      fileCount: 0,
      additions: 0,
      deletions: 0,
      files: [],
    }
    const currentSnapshotSummary = summary("src/new-overlap.ts")
    const currentDiff = unifiedDiff("src/new-overlap.ts", 8)
    const result = await checkCrossWorkspaceConflicts(
      [workspace("task-a"), workspace("task-b")],
      dependencies({
        summaries: {
          "task-a": currentSnapshotSummary,
          "task-b": currentSnapshotSummary,
        },
        diffSequences: {
          "task-a": [
            { success: true, diff: currentDiff },
            { success: true, diff: currentDiff },
          ],
          "task-b": [
            { success: true, diff: currentDiff },
            { success: true, diff: currentDiff },
          ],
        },
      }),
    )

    expect(result.pairs[0]?.pathWarnings).toEqual([
      { path: "src/new-overlap.ts", kind: "edit-edit" },
    ])
    expect(result.pairs[0]?.hunkCheck.status).toBe("likely-conflict")
    expect(result.fingerprints["task-a"]?.statusHash).toBe(
      computeAgentWorkbenchStatusHash(currentSnapshotSummary),
    )
    expect(result.fingerprints["task-a"]?.statusHash).not.toBe(
      computeAgentWorkbenchStatusHash(previousListSummary),
    )
  })

  test("fails hunk comparison closed when dirty content changes during collection", async () => {
    const firstDiff = unifiedDiff("src/shared.ts", 5)
    const changedDiff = unifiedDiff("src/shared.ts", 50)
    const result = await checkCrossWorkspaceConflicts(
      [workspace("task-a"), workspace("task-b")],
      dependencies({
        diffSequences: {
          "task-a": [
            { success: true, diff: firstDiff },
            { success: true, diff: changedDiff },
          ],
          "task-b": [
            { success: true, diff: firstDiff },
            { success: true, diff: firstDiff },
          ],
        },
      }),
    )

    expect(result.pairs[0]?.pathWarnings).toEqual([
      { path: "src/shared.ts", kind: "edit-edit" },
    ])
    expect(result.pairs[0]?.hunkCheck).toEqual({
      status: "unavailable",
      reason: "diff-unavailable",
      unavailableDetail: "workspace-diff-changed",
    })
    expect(result.pairs[0]?.files[0]?.hunkStatus).toBe("unavailable")
    expect(result.fingerprints["task-a"]?.statusHash).toBe(
      computeAgentWorkbenchStatusHash(summary()),
    )
  })

  test("fails hunk comparison closed above the UTF-8 raw-diff byte cap while preserving committed evidence", async () => {
    const oversizedUtf8Diff = `${unifiedDiff("src/shared.ts", 5)}\n+${"界".repeat(
      Math.ceil(MAX_DEEP_CONFLICT_DIFF_BYTES / 3),
    )}`
    expect(oversizedUtf8Diff.length).toBeLessThan(MAX_DEEP_CONFLICT_DIFF_BYTES)
    expect(Buffer.byteLength(oversizedUtf8Diff, "utf8")).toBeGreaterThan(
      MAX_DEEP_CONFLICT_DIFF_BYTES,
    )

    let taskADiffReads = 0
    let mergeTrials = 0
    const deps = dependencies({
      heads: { "task-a": "sha-a", "task-b": "sha-b" },
      runMergeTreeTrial: async () => {
        mergeTrials += 1
        return { status: "clean", reason: null, conflictPaths: [] }
      },
    })
    deps.getWorkspaceDiff = async (worktreePath) => {
      if (worktreePath.endsWith("task-a")) {
        taskADiffReads += 1
        return { success: true, diff: oversizedUtf8Diff }
      }
      return { success: true, diff: unifiedDiff("src/shared.ts", 5) }
    }

    const result = await checkCrossWorkspaceConflicts(
      [workspace("task-a"), workspace("task-b")],
      deps,
    )

    expect(taskADiffReads).toBe(1)
    expect(result.pairs[0]?.pathWarnings).toEqual([
      { path: "src/shared.ts", kind: "edit-edit" },
    ])
    expect(result.pairs[0]?.hunkCheck).toEqual({
      status: "unavailable",
      reason: "diff-unavailable",
      unavailableDetail: "workspace-diff-too-large",
    })
    expect(result.pairs[0]?.files[0]?.hunkStatus).toBe("unavailable")
    expect(result.pairs[0]?.mergeTrial.status).toBe("clean")
    expect(mergeTrials).toBe(1)
  })

  test("passes captured immutable HEAD SHAs to the committed merge trial", async () => {
    let observed:
      | {
          projectPath: string
          left: string
          right: string
          timeoutMs: number | undefined
        }
      | undefined
    const result = await checkCrossWorkspaceConflicts(
      [workspace("task-a"), workspace("task-b")],
      dependencies({
        heads: { "task-a": "sha-a", "task-b": "sha-b" },
        runMergeTreeTrial: async (projectPath, left, right, options) => {
          observed = { projectPath, left, right, timeoutMs: options?.timeoutMs }
          return { status: "clean", reason: null, conflictPaths: [] }
        },
      }),
    )

    expect(observed).toEqual({
      projectPath: "/project",
      left: "sha-a",
      right: "sha-b",
      timeoutMs: 15_000,
    })
    expect(result.pairs[0]?.mergeTrial.status).toBe("clean")
  })

  test("committed-only divergent HEADs stay unavailable without tier-a warnings", async () => {
    const cleanDiff: AgentWorkbenchDiffSummary = {
      fileCount: 0,
      additions: 0,
      deletions: 0,
      files: [],
    }
    const result = await checkCrossWorkspaceConflicts(
      [workspace("task-a"), workspace("task-b")],
      dependencies({
        heads: { "task-a": "head-a", "task-b": "head-b" },
        summaries: { "task-a": cleanDiff, "task-b": cleanDiff },
      }),
    )

    expect(result.pairs[0]?.pathWarnings).toEqual([])
    expect(result.pairs[0]?.hunkCheck).toEqual({
      status: "unavailable",
      reason: "head-commits-differ",
    })
  })

  test("old Git returns a labeled tier-a/b-only result without a merge trial", async () => {
    let mergeTrials = 0
    const result = await checkCrossWorkspaceConflicts(
      [workspace("task-a"), workspace("task-b")],
      dependencies({
        heads: { "task-a": "head-a", "task-b": "head-b" },
        capability: {
          available: false,
          gitVersion: "2.34.1",
          minimumVersion: MERGE_TREE_MINIMUM_VERSION,
          reason: "git-too-old",
        },
        runMergeTreeTrial: async () => {
          mergeTrials += 1
          return { status: "clean", reason: null, conflictPaths: [] }
        },
      }),
    )

    expect(result.capability.reason).toBe("git-too-old")
    expect(result.pairs[0]?.pathWarnings).toHaveLength(1)
    expect(result.pairs[0]?.hunkCheck).toEqual({
      status: "unavailable",
      reason: "head-commits-differ",
    })
    expect(result.pairs[0]?.mergeTrial).toEqual({
      scope: "committed-changes-only",
      status: "unavailable",
      reason: "git-too-old",
      conflictPaths: [],
    })
    expect(mergeTrials).toBe(0)
  })

  test("a clean committed merge trial never suppresses an uncommitted overlap warning", async () => {
    const result = await checkCrossWorkspaceConflicts(
      [workspace("task-a"), workspace("task-b")],
      dependencies(),
    )
    const pair = result.pairs[0]

    expect(pair?.pathWarnings).toEqual([
      { path: "src/shared.ts", kind: "edit-edit" },
    ])
    expect(pair?.files[0]).toMatchObject({
      path: "src/shared.ts",
      pathWarning: true,
      hunkStatus: "overlap",
    })
    expect(pair?.hunkCheck.status).toBe("likely-conflict")
    expect(pair?.mergeTrial).toEqual({
      scope: "committed-changes-only",
      status: "clean",
      reason: null,
      conflictPaths: [],
    })
    expect(result.fingerprints["task-a"]).toMatchObject({
      statusHash: expect.any(String),
      headSha: "shared-head",
    })
  })

  test("skips the merge trial for identical non-null head SHAs", async () => {
    let mergeTrials = 0
    const result = await checkCrossWorkspaceConflicts(
      [workspace("task-a"), workspace("task-b")],
      dependencies({
        heads: { "task-a": "identical-head", "task-b": "identical-head" },
        runMergeTreeTrial: async () => {
          mergeTrials += 1
          return { status: "conflict", reason: null, conflictPaths: ["x.ts"] }
        },
      }),
    )

    expect(result.pairs[0]?.mergeTrial).toEqual({
      scope: "committed-changes-only",
      status: "clean",
      reason: null,
      conflictPaths: [],
    })
    expect(mergeTrials).toBe(0)
  })

  test("does not adjudicate two tasks backed by the same resolved directory", async () => {
    const left = workspace("task-a")
    const right = {
      ...workspace("task-b"),
      worktreePath: `${left.worktreePath}/.`,
    }
    let mergeTrials = 0
    const result = await checkCrossWorkspaceConflicts([left, right], {
      ...dependencies(),
      runMergeTreeTrial: async () => {
        mergeTrials += 1
        return { status: "clean", reason: null, conflictPaths: [] }
      },
    })

    expect(result.pairs).toEqual([])
    expect(mergeTrials).toBe(0)
  })

  test("merge-tree keeps using captured commit SHAs after branch refs disappear", async () => {
    const root = mkdtempSync(join(tmpdir(), "locus-merge-tree-immutable-sha-"))
    try {
      mkdirSync(join(root, "src"), { recursive: true })
      execFileSync("git", ["init", "--quiet", "-b", "main"], {
        cwd: root,
      })
      execFileSync("git", ["config", "user.email", "test@example.com"], {
        cwd: root,
      })
      execFileSync("git", ["config", "user.name", "Test User"], {
        cwd: root,
      })
      writeFileSync(join(root, "src/shared.ts"), "initial\n")
      execFileSync("git", ["add", "."], { cwd: root })
      execFileSync("git", ["commit", "--quiet", "-m", "initial"], {
        cwd: root,
      })
      const baseSha = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim()

      execFileSync("git", ["checkout", "--quiet", "-b", "locus/left"], {
        cwd: root,
      })
      writeFileSync(join(root, "src/shared.ts"), "left\n")
      execFileSync("git", ["commit", "--quiet", "-am", "left"], {
        cwd: root,
      })
      const leftSha = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim()

      execFileSync(
        "git",
        ["checkout", "--quiet", "-b", "locus/right", baseSha],
        { cwd: root },
      )
      writeFileSync(join(root, "src/shared.ts"), "right\n")
      execFileSync("git", ["commit", "--quiet", "-am", "right"], {
        cwd: root,
      })
      const rightSha = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim()

      execFileSync("git", ["checkout", "--quiet", "--detach", baseSha], {
        cwd: root,
      })
      execFileSync("git", ["branch", "-D", "locus/left", "locus/right"], {
        cwd: root,
      })

      expect(await runGitMergeTreeTrial(root, leftSha, rightSha)).toEqual({
        status: "conflict",
        reason: null,
        conflictPaths: ["src/shared.ts"],
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("marks an individually timed-out merge trial unavailable", async () => {
    let mergeTrials = 0
    const result = await checkCrossWorkspaceConflicts(
      [workspace("task-a"), workspace("task-b")],
      dependencies({
        heads: { "task-a": "sha-a", "task-b": "sha-b" },
        mergeTrialTimeoutMs: 10,
        mergeTrialBatchDeadlineMs: 500,
        runMergeTreeTrial: () => {
          mergeTrials += 1
          return new Promise(() => {})
        },
      }),
    )

    expect(mergeTrials).toBe(1)
    expect(result.pairs[0]?.mergeTrial).toEqual({
      scope: "committed-changes-only",
      status: "unavailable",
      reason: "trial-failed",
      unavailableDetail: "trial-timeout",
      conflictPaths: [],
    })
  })

  test("applies the overall deadline to every preparation phase", async () => {
    const phases = ["capability", "base", "head", "summary", "diff"] as const

    for (const phase of phases) {
      const deps = dependencies({
        mergeTrialBatchDeadlineMs: 15,
        heads: { "task-a": "head-a", "task-b": "head-b" },
      })
      if (phase === "capability") {
        deps.probeMergeTreeCapability = () => new Promise(() => {})
      } else if (phase === "base") {
        deps.ensureBaseCommit = () => new Promise(() => {})
      } else if (phase === "head") {
        deps.getHeadSha = () => new Promise(() => {})
      } else if (phase === "summary") {
        deps.getWorkspaceSummary = () => new Promise(() => {})
      } else {
        deps.getWorkspaceDiff = () => new Promise(() => {})
      }

      const startedAt = performance.now()
      const result = await checkCrossWorkspaceConflicts(
        [workspace("task-a"), workspace("task-b")],
        deps,
      )

      expect(performance.now() - startedAt).toBeLessThan(500)
      expect(result.pairs).toHaveLength(1)
      expect(result.pairs[0]?.mergeTrial).toEqual({
        scope: "committed-changes-only",
        status: "unavailable",
        reason: "trial-failed",
        unavailableDetail: "batch-deadline-exceeded",
        conflictPaths: [],
      })
      if (phase !== "capability") {
        expect(result.pairs[0]?.hunkCheck).toMatchObject({
          status: "unavailable",
          reason: "diff-unavailable",
        })
      }
    }
  })

  test("keeps request-timeout provenance when abort settles the dependency", async () => {
    let observedSignal: AbortSignal | undefined
    const result = await settleWithinRequest(
      ({ signal }) =>
        new Promise<string>((resolve) => {
          observedSignal = signal
          signal.addEventListener("abort", () => resolve("aborted"), {
            once: true,
          })
        }),
      { deadlineAt: 1, monotonicNow: () => 0 },
    )

    expect(result).toBe(OPERATION_TIMED_OUT)
    expect(observedSignal?.aborted).toBe(true)
  })

  test("latches a preparation timeout despite sub-millisecond clock skew", async () => {
    const deps = dependencies({
      heads: { "task-a": "head-a", "task-b": "head-b" },
      mergeTrialBatchDeadlineMs: 1,
    })
    deps.monotonicNow = () => 0
    deps.probeMergeTreeCapability = () => new Promise(() => {})

    const result = await checkCrossWorkspaceConflicts(
      [workspace("task-a"), workspace("task-b")],
      deps,
    )

    expect(result.pairs[0]?.mergeTrial).toEqual({
      scope: "committed-changes-only",
      status: "unavailable",
      reason: "trial-failed",
      unavailableDetail: "batch-deadline-exceeded",
      conflictPaths: [],
    })
  })

  test("aborts an in-flight snapshot dependency when the request deadline expires", async () => {
    const observedSignals: AbortSignal[] = []
    const deps = dependencies({ mergeTrialBatchDeadlineMs: 15 })
    deps.getWorkspaceDiff = (_worktreePath, options) =>
      new Promise((resolve) => {
        const signal = options?.signal
        if (!signal) {
          resolve({ success: false })
          return
        }
        observedSignals.push(signal)
        signal.addEventListener(
          "abort",
          () => resolve({ success: false, error: "aborted" }),
          { once: true },
        )
      })

    const result = await checkCrossWorkspaceConflicts(
      [workspace("task-a"), workspace("task-b")],
      deps,
    )

    expect(observedSignals).toHaveLength(2)
    expect(observedSignals.every((signal) => signal.aborted)).toBe(true)
    expect(result.pairs[0]?.hunkCheck).toEqual({
      status: "unavailable",
      reason: "diff-unavailable",
      unavailableDetail: "batch-deadline-exceeded",
    })
    expect(result.pairs[0]?.mergeTrial.unavailableDetail).toBe(
      "batch-deadline-exceeded",
    )
  })

  test("discards synchronously parsed hunk evidence when parsing crosses the request deadline", async () => {
    let monotonicReads = 0
    const prepared = await prepareConflictWorkspaceSnapshot(
      workspace("task-a"),
      dependencies(),
      {
        deadlineAt: 50,
        monotonicNow: () => {
          monotonicReads += 1
          return monotonicReads >= 10 ? 50 : 0
        },
      },
    )

    expect(monotonicReads).toBe(10)
    expect(prepared.rawDiff).not.toBeNull()
    expect(prepared.parsedDiff).toBeNull()
    expect(prepared.snapshotUnavailableDetail).toBe("batch-deadline-exceeded")
  })

  test("hard-bounds merge-trial concurrency while preserving pair order", async () => {
    let activeTrials = 0
    let maximumActiveTrials = 0
    let mergeTrials = 0
    const result = await checkCrossWorkspaceConflicts(
      [workspace("d"), workspace("b"), workspace("a"), workspace("c")],
      dependencies({
        heads: { a: "sha-a", b: "sha-b", c: "sha-c", d: "sha-d" },
        mergeTrialConcurrency: 99,
        mergeTrialTimeoutMs: 500,
        mergeTrialBatchDeadlineMs: 2_000,
        runMergeTreeTrial: async () => {
          mergeTrials += 1
          activeTrials += 1
          maximumActiveTrials = Math.max(maximumActiveTrials, activeTrials)
          try {
            await new Promise((resolve) => setTimeout(resolve, 15))
            return { status: "clean", reason: null, conflictPaths: [] }
          } finally {
            activeTrials -= 1
          }
        },
      }),
    )

    expect(mergeTrials).toBe(6)
    expect(maximumActiveTrials).toBe(MAX_MERGE_TREE_CONCURRENCY)
    expect(result.pairs.map((pair) => pair.taskIds)).toEqual([
      ["a", "b"],
      ["a", "c"],
      ["a", "d"],
      ["b", "c"],
      ["b", "d"],
      ["c", "d"],
    ])
  })

  test("stops starting pair trials after the overall batch deadline", async () => {
    let monotonicTime = 0
    let mergeTrials = 0
    const deps = dependencies({
      heads: { a: "sha-a", b: "sha-b", c: "sha-c", d: "sha-d" },
      mergeTrialConcurrency: 1,
      mergeTrialTimeoutMs: 1_000,
      mergeTrialBatchDeadlineMs: 50,
      runMergeTreeTrial: async () => {
        mergeTrials += 1
        monotonicTime = 51
        return { status: "clean", reason: null, conflictPaths: [] }
      },
    })
    deps.monotonicNow = () => monotonicTime

    const result = await checkCrossWorkspaceConflicts(
      [workspace("a"), workspace("b"), workspace("c"), workspace("d")],
      deps,
    )

    expect(mergeTrials).toBe(1)
    expect(result.pairs).toHaveLength(6)
    expect(
      result.pairs.every(
        (pair) =>
          pair.mergeTrial.status === "unavailable" &&
          pair.mergeTrial.reason === "trial-failed" &&
          pair.mergeTrial.unavailableDetail === "batch-deadline-exceeded",
      ),
    ).toBe(true)
  })

  test("enumerates four Workspaces as six stable lexical pairs", async () => {
    const result = await checkCrossWorkspaceConflicts(
      [workspace("d"), workspace("b"), workspace("a"), workspace("c")],
      dependencies(),
    )

    expect(result.pairs.map((pair) => pair.taskIds)).toEqual([
      ["a", "b"],
      ["a", "c"],
      ["a", "d"],
      ["b", "c"],
      ["b", "d"],
      ["c", "d"],
    ])
    expect(result.computedAt).toBe("2026-08-13T02:00:00.000Z")
  })
})
