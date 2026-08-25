"use client"

import type { inferRouterOutputs } from "@trpc/server"
import { AlertCircle, Loader2 } from "lucide-react"
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import type { AppRouter } from "../../../../main/lib/trpc/routers"
import { Button } from "../../../components/ui/button"
import { useI18n } from "../../../lib/i18n"
import { trpc } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"
import { createConflictVerdictStalenessLatch } from "./conflict-verdict-state"

type DeepConflictCheckResult =
  inferRouterOutputs<AppRouter>["agentWorkbench"]["checkConflicts"]
type DeepConflictPair = DeepConflictCheckResult["pairs"][number]
type DeepConflictHunkCheck = DeepConflictPair["hunkCheck"]
type DeepConflictMergeTrial = DeepConflictPair["mergeTrial"]

type WorkspaceConflict = {
  path: string
  withTaskIds: string[]
  kind: "edit-edit" | "delete-edit" | "delete-delete"
}

type WorkspaceDiffFile = {
  path: string
  renamedTo?: string
}

type WorkspaceConflictSectionSlots = {
  summary: ReactNode
  details: ReactNode
  action: ReactNode
}

type WorkspaceConflictSectionProps = {
  taskId: string
  conflicts: WorkspaceConflict[]
  diffFiles: WorkspaceDiffFile[]
  eligibleDeepCheckTaskIds: string[]
  workspaceTitlesByTaskId: Record<string, string>
  workspaceStatusHashesByTaskId: Record<string, string>
  onReviewConflicts: (filteredFiles: string[]) => void
  children: (slots: WorkspaceConflictSectionSlots) => ReactNode
}

function formatComputedAt(value: Date | string | null): string {
  if (!value) return ""
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function getHunkCheckLabel(
  check: DeepConflictHunkCheck,
  overlapPaths: string[],
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (check.status === "likely-conflict") {
    return t("workbench.hunkLikelyConflict", {
      files: overlapPaths.join(", "),
    })
  }
  if (check.status === "no-overlap") {
    return t("workbench.hunkNoOverlap")
  }
  if (check.unavailableDetail === "workspace-head-changed") {
    return t("workbench.hunkSkippedWorkspaceChanged")
  }
  if (check.unavailableDetail === "workspace-diff-changed") {
    return t("workbench.hunkSkippedWorkspaceDiffChanged")
  }
  if (check.unavailableDetail === "workspace-diff-too-large") {
    return t("workbench.hunkSkippedWorkspaceDiffTooLarge")
  }
  if (check.unavailableDetail === "batch-deadline-exceeded") {
    return t("workbench.hunkSkippedBatchDeadline")
  }

  switch (check.reason) {
    case "base-commit-missing":
      return t("workbench.hunkSkippedBaseCommitMissing")
    case "base-commits-differ":
      return t("workbench.hunkSkippedBaseCommitsDiffer")
    case "head-commit-missing":
      return t("workbench.hunkSkippedHeadCommitMissing")
    case "head-commits-differ":
      return t("workbench.hunkSkippedHeadCommitsDiffer")
    case "diff-unavailable":
      return t("workbench.hunkSkippedDiffUnavailable")
    case "hunk-data-unavailable":
    case null:
      return t("workbench.hunkDataUnavailable")
  }
}

function getMergeTrialLabel(
  trial: DeepConflictMergeTrial,
  capability: DeepConflictCheckResult["capability"],
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (trial.status === "clean") {
    return t("workbench.mergeTrialCleanCommittedOnly")
  }
  if (trial.status === "conflict") {
    return t("workbench.mergeTrialConflictsCommittedOnly", {
      files: trial.conflictPaths.join(", ") || t("workbench.notAvailable"),
    })
  }

  switch (trial.unavailableDetail) {
    case "workspace-head-changed":
      return t("workbench.mergeTrialWorkspaceChanged")
    case "head-commit-unavailable":
      return t("workbench.mergeTrialHeadUnavailable")
    case "trial-timeout":
      return t("workbench.mergeTrialTimedOut")
    case "batch-deadline-exceeded":
      return t("workbench.mergeTrialBatchDeadline")
    case undefined:
      break
  }

  switch (trial.reason) {
    case "git-too-old":
      return t("workbench.mergeTrialOldGit", {
        minimum: capability.minimumVersion,
        version: capability.gitVersion ?? t("workbench.unknownValue"),
      })
    case "version-unavailable":
      return t("workbench.mergeTrialVersionUnavailable")
    case "version-unparseable":
      return t("workbench.mergeTrialVersionUnparseable")
    case "branch-missing":
      return t("workbench.mergeTrialBranchMissing")
    case "trial-failed":
    case null:
      return t("workbench.mergeTrialFailedCommittedOnly")
  }
}

/**
 * Owns the state and presentation for cross-workspace conflict adjudication.
 * Slots preserve the existing TaskCard layout without splitting the mutation or
 * verdict state across multiple component instances.
 */
export function WorkspaceConflictSection({
  taskId,
  conflicts,
  diffFiles,
  eligibleDeepCheckTaskIds,
  workspaceTitlesByTaskId,
  workspaceStatusHashesByTaskId,
  onReviewConflicts,
  children,
}: WorkspaceConflictSectionProps) {
  const { t } = useI18n()
  const trpcUtils = trpc.useUtils()
  const [lastSuccessfulConflictCheck, setLastSuccessfulConflictCheck] =
    useState<DeepConflictCheckResult | null>(null)
  const conflictVerdictStalenessLatch = useMemo(
    () => createConflictVerdictStalenessLatch(),
    [],
  )
  const checkConflictsMutation = trpc.agentWorkbench.checkConflicts.useMutation(
    {
      onSuccess: async (result) => {
        // Awaiting the refetch refreshes the passive status baseline before
        // the newly computed verdict is rendered.
        await trpcUtils.agentWorkbench.listTasks.invalidate()
        conflictVerdictStalenessLatch.reset()
        setLastSuccessfulConflictCheck(result)
      },
    },
  )
  const conflictPaths = useMemo(
    () => Array.from(new Set(conflicts.map((conflict) => conflict.path))),
    [conflicts],
  )
  const reviewConflictPaths = useMemo(() => {
    const paths = new Set(conflictPaths)
    for (const file of diffFiles) {
      if (paths.has(file.path) && file.renamedTo) {
        paths.add(file.renamedTo)
      }
    }
    return Array.from(paths)
  }, [conflictPaths, diffFiles])
  const conflictingWorkspaceTitles = useMemo(
    () =>
      Array.from(
        new Set(
          conflicts.flatMap((conflict) =>
            conflict.withTaskIds.map(
              (conflictingTaskId) =>
                workspaceTitlesByTaskId[conflictingTaskId] ?? conflictingTaskId,
            ),
          ),
        ),
      ),
    [conflicts, workspaceTitlesByTaskId],
  )
  const deleteEditConflictCount = conflicts.filter(
    (conflict) => conflict.kind === "delete-edit",
  ).length
  const deleteDeleteConflictCount = conflicts.filter(
    (conflict) => conflict.kind === "delete-delete",
  ).length
  const deepCheckTaskIds = useMemo(() => {
    const siblingTaskIds = Array.from(
      new Set(
        eligibleDeepCheckTaskIds.filter(
          (eligibleTaskId) => eligibleTaskId !== taskId,
        ),
      ),
    )
      .sort()
      .slice(0, 9)

    return siblingTaskIds.length > 0 ? [taskId, ...siblingTaskIds].sort() : []
  }, [eligibleDeepCheckTaskIds, taskId])
  const canDeepCheck = deepCheckTaskIds.length >= 2

  useEffect(() => {
    if (!lastSuccessfulConflictCheck) return

    for (const pair of lastSuccessfulConflictCheck.pairs) {
      conflictVerdictStalenessLatch.observePair(
        pair.taskIds,
        workspaceStatusHashesByTaskId,
        lastSuccessfulConflictCheck.fingerprints,
      )
    }
  }, [
    conflictVerdictStalenessLatch,
    lastSuccessfulConflictCheck,
    workspaceStatusHashesByTaskId,
  ])

  const handleConflictReview = useCallback(() => {
    onReviewConflicts(reviewConflictPaths)
  }, [onReviewConflicts, reviewConflictPaths])
  const handleDeepCheck = useCallback(() => {
    checkConflictsMutation.mutate({ taskIds: deepCheckTaskIds })
  }, [checkConflictsMutation, deepCheckTaskIds])

  const summary =
    conflictPaths.length > 0 ? (
      <button
        type="button"
        className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md border border-amber-500/25 bg-amber-500/5 px-2 py-1 text-left text-amber-700 transition-colors hover:bg-amber-500/10 dark:text-amber-300"
        onClick={handleConflictReview}
      >
        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="font-medium">
          {t("workbench.crossWorkspaceConflicts")}
        </span>
        <span>
          {t("workbench.conflictAnnotation", {
            count: conflictPaths.length,
            workspaces: conflictingWorkspaceTitles.join(", "),
          })}
        </span>
        {deleteEditConflictCount > 0 && (
          <span className="font-medium">
            {t("workbench.deleteEditConflict", {
              count: deleteEditConflictCount,
            })}
          </span>
        )}
        {deleteDeleteConflictCount > 0 && (
          <span className="font-medium">
            {t("workbench.deleteDeleteConflict", {
              count: deleteDeleteConflictCount,
            })}
          </span>
        )}
      </button>
    ) : null

  const details = (
    <>
      {checkConflictsMutation.error && (
        <p className="mt-3 text-xs text-destructive">
          {checkConflictsMutation.error.message?.trim() ||
            t("workbench.deepCheckFailed")}
        </p>
      )}

      {lastSuccessfulConflictCheck && (
        <div className="mt-3 space-y-2">
          {lastSuccessfulConflictCheck.pairs.map((pair) => {
            const isStale = conflictVerdictStalenessLatch.isPairStale(
              pair.taskIds,
              workspaceStatusHashesByTaskId,
              lastSuccessfulConflictCheck.fingerprints,
            )
            const overlapPaths = pair.files
              .filter((file) => file.hunkStatus === "overlap")
              .map((file) => file.path)
            const provenance = pair.taskIds
              .map((pairTaskId) =>
                t("workbench.conflictVerdictWorkspaceState", {
                  workspace: workspaceTitlesByTaskId[pairTaskId] ?? pairTaskId,
                  sha:
                    lastSuccessfulConflictCheck.fingerprints[
                      pairTaskId
                    ]?.headSha?.slice(0, 7) ?? t("workbench.unknownValue"),
                }),
              )
              .join(" · ")

            return (
              <section
                key={pair.taskIds.join(":")}
                className={cn(
                  "rounded-md border px-3 py-2 text-xs",
                  isStale
                    ? "border-orange-500/30 bg-orange-500/5"
                    : "border-border bg-muted/20",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-foreground">
                    {pair.taskIds
                      .map(
                        (pairTaskId) =>
                          workspaceTitlesByTaskId[pairTaskId] ?? pairTaskId,
                      )
                      .join(" ↔ ")}
                  </span>
                  {isStale && (
                    <span className="font-medium text-orange-700 dark:text-orange-300">
                      {t("workbench.conflictVerdictStale")}
                    </span>
                  )}
                </div>

                <ul className="mt-2 space-y-1 text-muted-foreground">
                  {pair.files.map((file) => (
                    <li key={file.path} className="break-all">
                      <span className="font-medium text-amber-700 dark:text-amber-300">
                        {file.path}
                      </span>{" "}
                      · {t("workbench.pathOverlapWarning")} ·{" "}
                      {file.kind === "delete-edit"
                        ? t("workbench.deleteEditConflictLabel")
                        : file.kind === "delete-delete"
                          ? t("workbench.deleteDeleteConflictLabel")
                          : t("workbench.editEditConflictLabel")}
                      {file.hunkStatus === "overlap" &&
                        file.hunkOverlaps.map((overlap) => (
                          <span
                            key={`${overlap.left.oldStart}:${overlap.left.oldLines}:${overlap.right.oldStart}:${overlap.right.oldLines}`}
                          >
                            {" "}
                            · L{overlap.left.oldStart}+{overlap.left.oldLines} ↔
                            L{overlap.right.oldStart}+{overlap.right.oldLines}
                          </span>
                        ))}
                    </li>
                  ))}
                </ul>

                <p className="mt-2 text-muted-foreground">
                  {getHunkCheckLabel(pair.hunkCheck, overlapPaths, t)}
                </p>
                <p
                  className={cn(
                    "mt-1 font-medium",
                    pair.mergeTrial.status === "conflict"
                      ? "text-red-700 dark:text-red-300"
                      : pair.mergeTrial.status === "clean"
                        ? "text-green-700 dark:text-green-300"
                        : "text-muted-foreground",
                  )}
                >
                  {getMergeTrialLabel(
                    pair.mergeTrial,
                    lastSuccessfulConflictCheck.capability,
                    t,
                  )}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {t("workbench.conflictVerdictComputedAt", {
                    time: formatComputedAt(
                      lastSuccessfulConflictCheck.computedAt,
                    ),
                    provenance,
                  })}
                </p>
              </section>
            )
          })}
        </div>
      )}
    </>
  )

  const action = canDeepCheck ? (
    <Button
      variant="outline"
      size="sm"
      className="h-7 px-3 text-xs"
      disabled={checkConflictsMutation.isPending}
      onClick={handleDeepCheck}
    >
      {checkConflictsMutation.isPending && (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      )}
      {checkConflictsMutation.isPending
        ? t("workbench.deepChecking")
        : conflictPaths.length > 0
          ? t("workbench.deepCheck")
          : t("workbench.deepCheckNoWarnings")}
    </Button>
  ) : null

  return children({ summary, details, action })
}
