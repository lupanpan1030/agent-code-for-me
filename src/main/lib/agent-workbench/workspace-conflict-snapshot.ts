import { splitUnifiedDiffByFile } from "../../../shared/unified-diff-parser"
import { createGit } from "../git/git-factory"
import { assertRegisteredWorktree } from "../git/security"
import { computeAgentWorkbenchStatusHash } from "./conflicts"
import {
  type DeepConflictRequestBudget,
  exceedsDeepConflictDiffLimit,
  isRequestBudgetExceeded,
  OPERATION_TIMED_OUT,
  settleWithinRequest,
} from "./deep-conflict-deadline"
import type {
  ConflictDeepCheckDependencies,
  ConflictSnapshotOperationOptions,
  ConflictWorkspaceInput,
  PreparedConflictWorkspace,
  WorkspaceDiffResult,
} from "./deep-conflict-types"
import {
  type AgentWorkbenchDiffSummary,
  collectAgentWorkbenchDiffFiles,
} from "./status"

function diffExceedsByteLimit(
  result: WorkspaceDiffResult | typeof OPERATION_TIMED_OUT,
): boolean {
  return (
    result !== OPERATION_TIMED_OUT &&
    result.success &&
    result.diff !== undefined &&
    exceedsDeepConflictDiffLimit(result.diff)
  )
}

// Shared by listTasks and deep snapshots so both observe the same status shape.
export async function getAgentWorkbenchDiffSummary(
  worktreePath: string | null,
  options?: ConflictSnapshotOperationOptions,
): Promise<AgentWorkbenchDiffSummary> {
  if (!worktreePath) {
    return { fileCount: 0, additions: null, deletions: null, files: [] }
  }

  try {
    assertRegisteredWorktree(worktreePath)
    const git = createGit(worktreePath, {
      timeoutMs: options?.timeoutMs,
      signal: options?.signal,
      absoluteTimeout: true,
    })
    const status = await git.status()
    const fileCount = status.files.length
    const files = collectAgentWorkbenchDiffFiles(status.files)

    if (fileCount === 0) {
      return { fileCount: 0, additions: 0, deletions: 0, files: [] }
    }

    let additions = 0
    let deletions = 0
    try {
      const [unstagedNumstat, stagedNumstat] = await Promise.all([
        git.diff(["--numstat"]),
        git.diff(["--cached", "--numstat"]),
      ])
      const numstat = [unstagedNumstat, stagedNumstat]
        .filter(Boolean)
        .join("\n")
      for (const line of numstat.split("\n")) {
        const [added, removed] = line.trim().split(/\s+/)
        const addedCount = Number.parseInt(added ?? "", 10)
        const removedCount = Number.parseInt(removed ?? "", 10)
        if (Number.isFinite(addedCount)) additions += addedCount
        if (Number.isFinite(removedCount)) deletions += removedCount
      }
    } catch {
      return { fileCount, additions: null, deletions: null, files }
    }

    return { fileCount, additions, deletions, files }
  } catch (error) {
    return {
      fileCount: 0,
      additions: null,
      deletions: null,
      files: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function getGitHeadSha(
  worktreePath: string,
  options?: ConflictSnapshotOperationOptions,
): Promise<string | null> {
  try {
    const headSha = (
      await createGit(worktreePath, {
        timeoutMs: options?.timeoutMs,
        signal: options?.signal,
        absoluteTimeout: true,
      }).revparse(["HEAD"])
    ).trim()
    return headSha || null
  } catch {
    return null
  }
}

function createUnavailableDiff(): AgentWorkbenchDiffSummary {
  return {
    fileCount: 0,
    additions: null,
    deletions: null,
    files: [],
    error: "Deep conflict snapshot unavailable",
  }
}

export async function prepareConflictWorkspaceSnapshot(
  workspace: ConflictWorkspaceInput,
  dependencies: ConflictDeepCheckDependencies,
  budget: DeepConflictRequestBudget,
): Promise<PreparedConflictWorkspace> {
  const unavailableDiff = createUnavailableDiff()
  const baseCommitPromise = settleWithinRequest(
    ({ signal, timeoutMs }) =>
      dependencies
        .ensureBaseCommit(workspace.taskId, { signal, timeoutMs })
        .catch(() => null),
    budget,
  )
  if (!workspace.worktreePath) {
    const baseCommit = await baseCommitPromise
    return {
      ...workspace,
      diff: unavailableDiff,
      baseCommit: baseCommit === OPERATION_TIMED_OUT ? null : baseCommit,
      headSha: null,
      headChangedDuringSnapshot: false,
      rawDiff: null,
      parsedDiff: null,
      ...(baseCommit === OPERATION_TIMED_OUT
        ? { snapshotUnavailableDetail: "batch-deadline-exceeded" as const }
        : {}),
    }
  }
  const worktreePath = workspace.worktreePath

  // Every deep-check evidence field is produced by this one bounded protocol.
  // Re-reading both the status summary and raw dirty diff prevents a hunk
  // verdict when worktree content changes while it is being collected.
  const headBefore = await settleWithinRequest(
    ({ signal, timeoutMs }) =>
      dependencies
        .getHeadSha(worktreePath, { signal, timeoutMs })
        .catch(() => null),
    budget,
  )
  const summaryBefore = await settleWithinRequest(
    ({ signal, timeoutMs }) =>
      dependencies
        .getWorkspaceSummary(worktreePath, { signal, timeoutMs })
        .catch(() => unavailableDiff),
    budget,
  )
  let diffBefore = await settleWithinRequest(
    ({ signal, timeoutMs }) =>
      dependencies
        .getWorkspaceDiff(worktreePath, { signal, timeoutMs })
        .catch(() => ({ success: false }) satisfies WorkspaceDiffResult),
    budget,
  )
  const diffBeforeTooLarge = diffExceedsByteLimit(diffBefore)
  if (diffBeforeTooLarge) {
    // Drop the oversized string immediately and avoid collecting it twice.
    diffBefore = { success: false, error: "workspace-diff-too-large" }
  }
  let diffAfter: WorkspaceDiffResult | typeof OPERATION_TIMED_OUT = {
    success: false,
  }
  if (!diffBeforeTooLarge) {
    diffAfter = await settleWithinRequest(
      ({ signal, timeoutMs }) =>
        dependencies
          .getWorkspaceDiff(worktreePath, { signal, timeoutMs })
          .catch(() => ({ success: false }) satisfies WorkspaceDiffResult),
      budget,
    )
  }
  const diffAfterTooLarge = diffExceedsByteLimit(diffAfter)
  if (diffAfterTooLarge) {
    diffAfter = { success: false, error: "workspace-diff-too-large" }
  }
  const summaryAfter = await settleWithinRequest(
    ({ signal, timeoutMs }) =>
      dependencies
        .getWorkspaceSummary(worktreePath, { signal, timeoutMs })
        .catch(() => unavailableDiff),
    budget,
  )
  const headAfter = await settleWithinRequest(
    ({ signal, timeoutMs }) =>
      dependencies
        .getHeadSha(worktreePath, { signal, timeoutMs })
        .catch(() => null),
    budget,
  )
  const baseCommit = await baseCommitPromise

  const requestDeadlineExceeded = [
    headBefore,
    summaryBefore,
    diffBefore,
    diffAfter,
    summaryAfter,
    headAfter,
    baseCommit,
  ].some((value) => value === OPERATION_TIMED_OUT)
  const canonicalSummary =
    summaryAfter === OPERATION_TIMED_OUT ? unavailableDiff : summaryAfter
  const canonicalDiff =
    diffAfter === OPERATION_TIMED_OUT ||
    !diffAfter.success ||
    diffAfter.diff === undefined
      ? null
      : diffAfter.diff
  // A failed/missing HEAD read is not evidence that HEAD moved. Only two
  // successfully captured, distinct SHAs justify the snapshot-change reason.
  const headChangedDuringSnapshot =
    headBefore !== OPERATION_TIMED_OUT &&
    headAfter !== OPERATION_TIMED_OUT &&
    headBefore !== null &&
    headAfter !== null &&
    headBefore !== headAfter
  const summaryStable =
    summaryBefore !== OPERATION_TIMED_OUT &&
    summaryAfter !== OPERATION_TIMED_OUT &&
    !summaryBefore.error &&
    !summaryAfter.error &&
    computeAgentWorkbenchStatusHash(summaryBefore) ===
      computeAgentWorkbenchStatusHash(summaryAfter)
  const diffStable =
    diffBefore !== OPERATION_TIMED_OUT &&
    diffAfter !== OPERATION_TIMED_OUT &&
    diffBefore.success &&
    diffAfter.success &&
    diffBefore.diff !== undefined &&
    diffBefore.diff === diffAfter.diff
  const dirtySnapshotStable = summaryStable && diffStable
  const dirtySnapshotChanged =
    (summaryBefore !== OPERATION_TIMED_OUT &&
      summaryAfter !== OPERATION_TIMED_OUT &&
      !summaryBefore.error &&
      !summaryAfter.error &&
      computeAgentWorkbenchStatusHash(summaryBefore) !==
        computeAgentWorkbenchStatusHash(summaryAfter)) ||
    (diffBefore !== OPERATION_TIMED_OUT &&
      diffAfter !== OPERATION_TIMED_OUT &&
      diffBefore.success &&
      diffAfter.success &&
      diffBefore.diff !== undefined &&
      diffAfter.diff !== undefined &&
      diffBefore.diff !== diffAfter.diff)

  const diffTooLarge = diffBeforeTooLarge || diffAfterTooLarge
  let snapshotUnavailableDetail:
    | PreparedConflictWorkspace["snapshotUnavailableDetail"]
    | undefined
  if (requestDeadlineExceeded || isRequestBudgetExceeded(budget)) {
    snapshotUnavailableDetail = "batch-deadline-exceeded"
  } else if (diffTooLarge) {
    snapshotUnavailableDetail = "workspace-diff-too-large"
  } else if (dirtySnapshotChanged) {
    snapshotUnavailableDetail = "workspace-diff-changed"
  }

  let parsedDiff: PreparedConflictWorkspace["parsedDiff"] = null
  if (
    !headChangedDuringSnapshot &&
    !snapshotUnavailableDetail &&
    dirtySnapshotStable &&
    canonicalDiff !== null
  ) {
    // Parsing is synchronous, so it cannot be interrupted. Check the shared
    // request budget immediately before and after it and discard evidence that
    // completed after the deadline rather than publishing a late verdict.
    if (isRequestBudgetExceeded(budget)) {
      snapshotUnavailableDetail = "batch-deadline-exceeded"
    } else {
      const parsedCandidate = splitUnifiedDiffByFile(canonicalDiff)
      if (isRequestBudgetExceeded(budget)) {
        snapshotUnavailableDetail = "batch-deadline-exceeded"
      } else {
        parsedDiff = parsedCandidate
      }
    }
  }

  return {
    ...workspace,
    diff: canonicalSummary,
    baseCommit: baseCommit === OPERATION_TIMED_OUT ? null : baseCommit,
    headSha:
      headBefore !== OPERATION_TIMED_OUT &&
      headAfter !== OPERATION_TIMED_OUT &&
      headBefore !== null &&
      headBefore === headAfter
        ? headBefore
        : null,
    headChangedDuringSnapshot,
    rawDiff: canonicalDiff,
    parsedDiff,
    ...(snapshotUnavailableDetail ? { snapshotUnavailableDetail } : {}),
  }
}
