import {
  computeAgentWorkbenchStatusHash,
  shareResolvedWorktreePath,
} from "./conflicts"
import {
  type DeepConflictRequestBudget,
  normaliseDuration,
  OPERATION_TIMED_OUT,
  settleWithinRequest,
  settleWithTimeout,
} from "./deep-conflict-deadline"
import type {
  ConflictDeepCheckDependencies,
  ConflictDeepCheckResult,
  ConflictPairVerdict,
  ConflictWorkspaceInput,
  MergeTreeCapability,
  MergeTreeTrialResult,
  PreparedConflictWorkspace,
} from "./deep-conflict-types"
import { collectDeepConflictPairEvidence } from "./hunk-conflicts"
import {
  DEFAULT_MERGE_TREE_TRIAL_TIMEOUT_MS,
  MERGE_TREE_MINIMUM_VERSION,
} from "./merge-tree"
import { prepareConflictWorkspaceSnapshot } from "./workspace-conflict-snapshot"

export { MAX_DEEP_CONFLICT_DIFF_BYTES } from "./deep-conflict-deadline"
export type {
  ConflictDeepCheckDependencies,
  ConflictDeepCheckResult,
  ConflictFileDetail,
  ConflictFingerprint,
  ConflictHunkOverlap,
  ConflictHunkRange,
  ConflictPairVerdict,
  ConflictSnapshotOperationOptions,
  ConflictWorkspaceInput,
  MergeTreeCapability,
  MergeTreeCapabilityReason,
  MergeTreeTrialOptions,
  MergeTreeTrialResult,
  WorkspaceDiffResult,
} from "./deep-conflict-types"
export {
  createMergeTreeCapabilityProbe,
  DEFAULT_MERGE_TREE_TRIAL_TIMEOUT_MS,
  isMergeTreeConflictExitCode,
  MERGE_TREE_MINIMUM_VERSION,
  parseGitMergeTreeCapability,
  parseMergeTreeConflictPaths,
  probeMergeTreeCapability,
  runGitMergeTreeTrial,
} from "./merge-tree"
export {
  getAgentWorkbenchDiffSummary,
  getGitHeadSha,
} from "./workspace-conflict-snapshot"

export const DEFAULT_MERGE_TREE_BATCH_DEADLINE_MS = 30_000
export const DEFAULT_MERGE_TREE_CONCURRENCY = 3
export const MAX_MERGE_TREE_CONCURRENCY = 4

function normaliseConcurrency(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MERGE_TREE_CONCURRENCY
  }
  return Math.max(1, Math.min(MAX_MERGE_TREE_CONCURRENCY, Math.floor(value)))
}

async function mapWithConcurrency<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  mapInput: (input: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  const outputs = new Array<Output>(inputs.length)
  let nextIndex = 0

  const worker = async () => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= inputs.length) return

      const input = inputs[index]
      if (input === undefined) continue
      outputs[index] = await mapInput(input, index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, async () =>
      worker(),
    ),
  )
  return outputs
}

async function getMergeVerdict(
  left: PreparedConflictWorkspace,
  right: PreparedConflictWorkspace,
  capability: MergeTreeCapability,
  dependencies: ConflictDeepCheckDependencies,
  batch: {
    deadlineAt: number
    preparationDeadlineExceeded: boolean
    perTrialTimeoutMs: number
    monotonicNow: () => number
  },
): Promise<ConflictPairVerdict["mergeTrial"]> {
  if (
    left.snapshotUnavailableDetail === "batch-deadline-exceeded" ||
    right.snapshotUnavailableDetail === "batch-deadline-exceeded" ||
    batch.preparationDeadlineExceeded ||
    batch.monotonicNow() >= batch.deadlineAt
  ) {
    return {
      scope: "committed-changes-only",
      status: "unavailable",
      reason: "trial-failed",
      unavailableDetail: "batch-deadline-exceeded",
      conflictPaths: [],
    }
  }

  if (left.headChangedDuringSnapshot || right.headChangedDuringSnapshot) {
    return {
      scope: "committed-changes-only",
      status: "unavailable",
      reason: "trial-failed",
      unavailableDetail: "workspace-head-changed",
      conflictPaths: [],
    }
  }

  const leftHeadSha = left.headSha
  const rightHeadSha = right.headSha
  if (leftHeadSha && leftHeadSha === rightHeadSha) {
    return {
      scope: "committed-changes-only",
      status: "clean",
      reason: null,
      conflictPaths: [],
    }
  }

  if (!leftHeadSha || !rightHeadSha) {
    return {
      scope: "committed-changes-only",
      status: "unavailable",
      reason: "trial-failed",
      unavailableDetail: "head-commit-unavailable",
      conflictPaths: [],
    }
  }

  if (!capability.available) {
    return {
      scope: "committed-changes-only",
      status: "unavailable",
      reason: capability.reason,
      conflictPaths: [],
    }
  }

  if (!left.branch || !right.branch) {
    return {
      scope: "committed-changes-only",
      status: "unavailable",
      reason: "branch-missing",
      conflictPaths: [],
    }
  }

  const remainingMs = batch.deadlineAt - batch.monotonicNow()
  if (remainingMs <= 0) {
    return {
      scope: "committed-changes-only",
      status: "unavailable",
      reason: "trial-failed",
      unavailableDetail: "batch-deadline-exceeded",
      conflictPaths: [],
    }
  }

  const batchLimitsTimeout = remainingMs <= batch.perTrialTimeoutMs
  const effectiveTimeoutMs = Math.max(
    1,
    Math.floor(Math.min(remainingMs, batch.perTrialTimeoutMs)),
  )
  let trial: MergeTreeTrialResult | typeof OPERATION_TIMED_OUT
  try {
    trial = await settleWithTimeout(
      Promise.resolve().then(() =>
        dependencies.runMergeTreeTrial(
          left.projectPath,
          leftHeadSha,
          rightHeadSha,
          { timeoutMs: effectiveTimeoutMs },
        ),
      ),
      effectiveTimeoutMs,
    )
  } catch {
    return {
      scope: "committed-changes-only",
      status: "unavailable",
      reason: "trial-failed",
      conflictPaths: [],
    }
  }

  if (trial === OPERATION_TIMED_OUT) {
    return {
      scope: "committed-changes-only",
      status: "unavailable",
      reason: "trial-failed",
      unavailableDetail: batchLimitsTimeout
        ? "batch-deadline-exceeded"
        : "trial-timeout",
      conflictPaths: [],
    }
  }

  if (
    batch.monotonicNow() >= batch.deadlineAt ||
    (batchLimitsTimeout && trial.unavailableDetail === "trial-timeout")
  ) {
    return {
      scope: "committed-changes-only",
      status: "unavailable",
      reason: "trial-failed",
      unavailableDetail: "batch-deadline-exceeded",
      conflictPaths: [],
    }
  }

  return {
    scope: "committed-changes-only",
    status: trial.status,
    reason: trial.reason,
    ...(trial.unavailableDetail
      ? { unavailableDetail: trial.unavailableDetail }
      : {}),
    conflictPaths: trial.conflictPaths,
  }
}

export async function checkCrossWorkspaceConflicts(
  workspaces: readonly ConflictWorkspaceInput[],
  dependencies: ConflictDeepCheckDependencies,
): Promise<ConflictDeepCheckResult> {
  const monotonicNow = dependencies.monotonicNow ?? (() => performance.now())
  const batchDeadlineMs = normaliseDuration(
    dependencies.mergeTrialBatchDeadlineMs,
    DEFAULT_MERGE_TREE_BATCH_DEADLINE_MS,
  )
  const requestBudget: DeepConflictRequestBudget = {
    deadlineAt: monotonicNow() + batchDeadlineMs,
    monotonicNow,
  }
  const sorted = workspaces
    .slice()
    .sort((a, b) => a.taskId.localeCompare(b.taskId))
  const unavailableCapability: MergeTreeCapability = {
    available: false,
    gitVersion: null,
    minimumVersion: MERGE_TREE_MINIMUM_VERSION,
    reason: "version-unavailable",
  }
  const [capabilityResult, prepared] = await Promise.all([
    settleWithinRequest(
      ({ signal, timeoutMs }) =>
        dependencies
          .probeMergeTreeCapability({ signal, timeoutMs })
          .catch(() => unavailableCapability),
      requestBudget,
    ),
    Promise.all(
      sorted.map((workspace) =>
        prepareConflictWorkspaceSnapshot(
          workspace,
          dependencies,
          requestBudget,
        ),
      ),
    ),
  ])
  const capability =
    capabilityResult === OPERATION_TIMED_OUT
      ? unavailableCapability
      : capabilityResult

  const fingerprints = Object.fromEntries(
    prepared.map((workspace) => [
      workspace.taskId,
      {
        statusHash: computeAgentWorkbenchStatusHash(workspace.diff),
        headSha: workspace.headSha,
      },
    ]),
  )
  const pairInputs: Array<{
    left: PreparedConflictWorkspace
    right: PreparedConflictWorkspace
    partialVerdict: Omit<ConflictPairVerdict, "mergeTrial">
  }> = []

  for (let leftIndex = 0; leftIndex < prepared.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < prepared.length;
      rightIndex += 1
    ) {
      const left = prepared[leftIndex]
      const right = prepared[rightIndex]
      if (!left || !right) continue
      if (shareResolvedWorktreePath(left.worktreePath, right.worktreePath)) {
        continue
      }
      const pairEvidence = collectDeepConflictPairEvidence(left, right)
      pairInputs.push({
        left,
        right,
        partialVerdict: {
          taskIds: [left.taskId, right.taskId],
          ...pairEvidence,
        },
      })
    }
  }

  const batch = {
    deadlineAt: requestBudget.deadlineAt,
    preparationDeadlineExceeded:
      capabilityResult === OPERATION_TIMED_OUT ||
      prepared.some(
        (workspace) =>
          workspace.snapshotUnavailableDetail === "batch-deadline-exceeded",
      ),
    perTrialTimeoutMs: normaliseDuration(
      dependencies.mergeTrialTimeoutMs,
      DEFAULT_MERGE_TREE_TRIAL_TIMEOUT_MS,
    ),
    monotonicNow: requestBudget.monotonicNow,
  }
  const pairs = await mapWithConcurrency(
    pairInputs,
    normaliseConcurrency(dependencies.mergeTrialConcurrency),
    async ({ left, right, partialVerdict }) => ({
      ...partialVerdict,
      mergeTrial: await getMergeVerdict(
        left,
        right,
        capability,
        dependencies,
        batch,
      ),
    }),
  )

  return {
    computedAt: (dependencies.now?.() ?? new Date()).toISOString(),
    capability,
    fingerprints,
    pairs,
  }
}
