import type { ParsedDiffFile } from "../../../shared/unified-diff-parser"
import type { AgentWorkbenchConflict } from "./conflicts"
import type { AgentWorkbenchDiffSummary } from "./status"

export type MergeTreeCapabilityReason =
  | "git-too-old"
  | "version-unavailable"
  | "version-unparseable"

export type MergeTreeCapability = {
  available: boolean
  gitVersion: string | null
  minimumVersion: "2.38.0"
  reason: MergeTreeCapabilityReason | null
}

export type ConflictFingerprint = {
  statusHash: string
  headSha: string | null
}

export type ConflictHunkRange = {
  oldStart: number
  oldLines: number
}

export type ConflictHunkOverlap = {
  left: ConflictHunkRange
  right: ConflictHunkRange
}

export type ConflictFileDetail = {
  path: string
  kind: AgentWorkbenchConflict["kind"]
  pathWarning: true
  hunkStatus: "overlap" | "no-overlap" | "unavailable"
  hunkOverlaps: ConflictHunkOverlap[]
}

export type ConflictPairVerdict = {
  taskIds: [string, string]
  pathWarnings: Array<Pick<AgentWorkbenchConflict, "path" | "kind">>
  files: ConflictFileDetail[]
  hunkCheck: {
    status: "likely-conflict" | "no-overlap" | "unavailable"
    reason:
      | null
      | "base-commit-missing"
      | "base-commits-differ"
      | "head-commit-missing"
      | "head-commits-differ"
      | "diff-unavailable"
      | "hunk-data-unavailable"
    unavailableDetail?:
      | "workspace-head-changed"
      | "workspace-diff-changed"
      | "workspace-diff-too-large"
      | "batch-deadline-exceeded"
  }
  mergeTrial: {
    scope: "committed-changes-only"
    status: "clean" | "conflict" | "unavailable"
    reason: null | MergeTreeCapabilityReason | "branch-missing" | "trial-failed"
    unavailableDetail?:
      | "workspace-head-changed"
      | "head-commit-unavailable"
      | "trial-timeout"
      | "batch-deadline-exceeded"
    conflictPaths: string[]
  }
}

export type ConflictDeepCheckResult = {
  computedAt: string
  capability: MergeTreeCapability
  fingerprints: Record<string, ConflictFingerprint>
  pairs: ConflictPairVerdict[]
}

export type ConflictWorkspaceInput = {
  taskId: string
  projectPath: string
  worktreePath: string | null
  branch: string | null
  baseBranch: string | null
}

export type WorkspaceDiffResult = {
  success: boolean
  diff?: string
  error?: string
}

export type ConflictSnapshotOperationOptions = {
  signal?: AbortSignal
  timeoutMs?: number
}

export type MergeTreeTrialResult = {
  status: "clean" | "conflict" | "unavailable"
  reason: null | "trial-failed"
  unavailableDetail?: "trial-timeout"
  conflictPaths: string[]
}

export type MergeTreeTrialOptions = {
  timeoutMs?: number
}

export type ConflictDeepCheckDependencies = {
  ensureBaseCommit: (
    taskId: string,
    options?: ConflictSnapshotOperationOptions,
  ) => Promise<string | null>
  getHeadSha: (
    worktreePath: string,
    options?: ConflictSnapshotOperationOptions,
  ) => Promise<string | null>
  getWorkspaceSummary: (
    worktreePath: string,
    options?: ConflictSnapshotOperationOptions,
  ) => Promise<AgentWorkbenchDiffSummary>
  getWorkspaceDiff: (
    worktreePath: string,
    options?: ConflictSnapshotOperationOptions,
  ) => Promise<WorkspaceDiffResult>
  probeMergeTreeCapability: (
    options?: ConflictSnapshotOperationOptions,
  ) => Promise<MergeTreeCapability>
  runMergeTreeTrial: (
    projectPath: string,
    leftCommitSha: string,
    rightCommitSha: string,
    options?: MergeTreeTrialOptions,
  ) => Promise<MergeTreeTrialResult>
  now?: () => Date
  monotonicNow?: () => number
  mergeTrialTimeoutMs?: number
  mergeTrialBatchDeadlineMs?: number
  mergeTrialConcurrency?: number
}

export type PreparedConflictWorkspace = ConflictWorkspaceInput & {
  diff: AgentWorkbenchDiffSummary
  baseCommit: string | null
  headSha: string | null
  headChangedDuringSnapshot: boolean
  rawDiff: string | null
  parsedDiff: ParsedDiffFile[] | null
  snapshotUnavailableDetail?:
    | "workspace-diff-changed"
    | "workspace-diff-too-large"
    | "batch-deadline-exceeded"
}
