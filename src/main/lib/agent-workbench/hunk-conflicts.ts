import type { ParsedDiffFile } from "../../../shared/unified-diff-parser"
import { computeCrossWorkspaceConflicts } from "./conflicts"
import type {
  ConflictFileDetail,
  ConflictHunkOverlap,
  ConflictPairVerdict,
  PreparedConflictWorkspace,
} from "./deep-conflict-types"

function getParsedPaths(file: ParsedDiffFile): string[] {
  return Array.from(
    new Set(
      [file.oldPath, file.newPath].filter(
        (path): path is string => !!path && path !== "/dev/null",
      ),
    ),
  )
}

function indexParsedDiff(
  files: ParsedDiffFile[],
): Map<string, ParsedDiffFile[]> {
  const result = new Map<string, ParsedDiffFile[]>()
  for (const file of files) {
    for (const path of getParsedPaths(file)) {
      const entries = result.get(path) ?? []
      entries.push(file)
      result.set(path, entries)
    }
  }
  return result
}

function rangesOverlap(
  left: NonNullable<ParsedDiffFile["hunks"]>[number],
  right: NonNullable<ParsedDiffFile["hunks"]>[number],
): boolean {
  const leftEnd = left.oldStart + Math.max(left.oldLines, 1) - 1
  const rightEnd = right.oldStart + Math.max(right.oldLines, 1) - 1
  return left.oldStart <= rightEnd && right.oldStart <= leftEnd
}

function unavailableFileDetails(
  warnings: ConflictPairVerdict["pathWarnings"],
): ConflictFileDetail[] {
  return warnings.map((warning) => ({
    ...warning,
    pathWarning: true,
    hunkStatus: "unavailable",
    hunkOverlaps: [],
  }))
}

function compareHunks(
  warnings: ConflictPairVerdict["pathWarnings"],
  leftFiles: ParsedDiffFile[],
  rightFiles: ParsedDiffFile[],
): ConflictFileDetail[] {
  const leftByPath = indexParsedDiff(leftFiles)
  const rightByPath = indexParsedDiff(rightFiles)

  return warnings.map((warning) => {
    const leftCandidates = leftByPath.get(warning.path) ?? []
    const rightCandidates = rightByPath.get(warning.path) ?? []
    const overlapsByKey = new Map<string, ConflictHunkOverlap>()
    let hadComparableHunks = false

    for (const leftFile of leftCandidates) {
      for (const rightFile of rightCandidates) {
        if (!leftFile.hunks?.length || !rightFile.hunks?.length) continue
        hadComparableHunks = true

        for (const leftHunk of leftFile.hunks) {
          for (const rightHunk of rightFile.hunks) {
            if (!rangesOverlap(leftHunk, rightHunk)) continue
            const overlap = {
              left: {
                oldStart: leftHunk.oldStart,
                oldLines: leftHunk.oldLines,
              },
              right: {
                oldStart: rightHunk.oldStart,
                oldLines: rightHunk.oldLines,
              },
            }
            overlapsByKey.set(
              `${overlap.left.oldStart}:${overlap.left.oldLines}:${overlap.right.oldStart}:${overlap.right.oldLines}`,
              overlap,
            )
          }
        }
      }
    }

    const hunkOverlaps = Array.from(overlapsByKey.values())
    return {
      ...warning,
      pathWarning: true,
      hunkStatus:
        hunkOverlaps.length > 0
          ? "overlap"
          : hadComparableHunks
            ? "no-overlap"
            : "unavailable",
      hunkOverlaps,
    }
  })
}

function pairPathWarnings(
  left: PreparedConflictWorkspace,
  right: PreparedConflictWorkspace,
): ConflictPairVerdict["pathWarnings"] {
  const conflicts = computeCrossWorkspaceConflicts([
    {
      taskId: left.taskId,
      projectId: "deep-check",
      worktreePath: left.worktreePath,
      diff: left.diff,
    },
    {
      taskId: right.taskId,
      projectId: "deep-check",
      worktreePath: right.worktreePath,
      diff: right.diff,
    },
  ])

  return (conflicts.get(left.taskId) ?? [])
    .map(({ path, kind }) => ({ path, kind }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

function getHunkVerdict(
  left: PreparedConflictWorkspace,
  right: PreparedConflictWorkspace,
  warnings: ConflictPairVerdict["pathWarnings"],
): Pick<ConflictPairVerdict, "files" | "hunkCheck"> {
  if (left.headChangedDuringSnapshot || right.headChangedDuringSnapshot) {
    return {
      files: unavailableFileDetails(warnings),
      hunkCheck: {
        status: "unavailable",
        reason: "diff-unavailable",
        unavailableDetail: "workspace-head-changed",
      },
    }
  }

  const snapshotUnavailableDetail =
    left.snapshotUnavailableDetail ?? right.snapshotUnavailableDetail
  if (snapshotUnavailableDetail) {
    return {
      files: unavailableFileDetails(warnings),
      hunkCheck: {
        status: "unavailable",
        reason: "diff-unavailable",
        unavailableDetail: snapshotUnavailableDetail,
      },
    }
  }

  if (!left.baseCommit || !right.baseCommit) {
    return {
      files: unavailableFileDetails(warnings),
      hunkCheck: { status: "unavailable", reason: "base-commit-missing" },
    }
  }

  if (left.baseCommit !== right.baseCommit) {
    return {
      files: unavailableFileDetails(warnings),
      hunkCheck: { status: "unavailable", reason: "base-commits-differ" },
    }
  }

  // Dirty-worktree diffs are anchored to HEAD by getWorktreeDiff. Equal fork
  // commits alone do not make their hunk coordinates comparable when the
  // workspaces have since committed different changes.
  if (!left.headSha || !right.headSha) {
    return {
      files: unavailableFileDetails(warnings),
      hunkCheck: { status: "unavailable", reason: "head-commit-missing" },
    }
  }

  if (left.headSha !== right.headSha) {
    return {
      files: unavailableFileDetails(warnings),
      hunkCheck: { status: "unavailable", reason: "head-commits-differ" },
    }
  }

  if (!left.parsedDiff || !right.parsedDiff) {
    return {
      files: unavailableFileDetails(warnings),
      hunkCheck: { status: "unavailable", reason: "diff-unavailable" },
    }
  }

  const files = compareHunks(warnings, left.parsedDiff, right.parsedDiff)
  if (files.some((file) => file.hunkStatus === "overlap")) {
    return {
      files,
      hunkCheck: { status: "likely-conflict", reason: null },
    }
  }

  if (files.some((file) => file.hunkStatus === "unavailable")) {
    return {
      files,
      hunkCheck: { status: "unavailable", reason: "hunk-data-unavailable" },
    }
  }

  return {
    files,
    hunkCheck: { status: "no-overlap", reason: null },
  }
}

export function collectDeepConflictPairEvidence(
  left: PreparedConflictWorkspace,
  right: PreparedConflictWorkspace,
): Pick<ConflictPairVerdict, "pathWarnings" | "files" | "hunkCheck"> {
  const pathWarnings = pairPathWarnings(left, right)
  return {
    pathWarnings,
    ...getHunkVerdict(left, right, pathWarnings),
  }
}
