import { createHash } from "node:crypto"
import { resolve } from "node:path"
import { isGitDiffExcludedPath } from "../git/diff-exclusions"
import type { AgentWorkbenchDiffSummary } from "./status"

export type AgentWorkbenchConflict = {
  path: string
  withTaskIds: string[]
  kind: "edit-edit" | "delete-edit" | "delete-delete"
}

export type AgentWorkbenchConflictTask = {
  taskId: string
  projectId: string | null
  worktreePath?: string | null
  diff: AgentWorkbenchDiffSummary
}

export type AgentWorkbenchDeepCheckCandidate = {
  taskId: string
  projectId: string | null
  worktreePath: string | null
  branch: string | null
  archived: boolean
}

export type AgentWorkbenchDeepCheckIneligibilityReason =
  | "too-few-tasks"
  | "too-many-tasks"
  | "duplicate-task-id"
  | "archived-task"
  | "missing-project"
  | "mixed-projects"
  | "missing-branch"
  | "missing-worktree"
  | "shared-worktree"

export type AgentWorkbenchDeepCheckEligibility =
  | {
      eligible: true
      projectId: string
      taskIds: string[]
      worktreePaths: string[]
    }
  | {
      eligible: false
      reason: AgentWorkbenchDeepCheckIneligibilityReason
    }

type PathParticipant = {
  taskId: string
  deleted: boolean
  worktreeIdentity: string
}

export const MAX_DEEP_CHECK_TASKS = 10

function getResolvedWorktreePath(worktreePath: string): string {
  return resolve(worktreePath)
}

export function shareResolvedWorktreePath(
  leftPath: string | null,
  rightPath: string | null,
): boolean {
  return (
    leftPath !== null &&
    rightPath !== null &&
    getResolvedWorktreePath(leftPath) === getResolvedWorktreePath(rightPath)
  )
}

/**
 * Canonical admission rule for a cross-workspace deep check. Both the task-list
 * affordance and the mutation boundary use this validator so an advertised
 * selection cannot rely on weaker rules than the server operation.
 */
export function validateAgentWorkbenchDeepCheckCandidates(
  tasks: readonly AgentWorkbenchDeepCheckCandidate[],
): AgentWorkbenchDeepCheckEligibility {
  if (tasks.length < 2) {
    return { eligible: false, reason: "too-few-tasks" }
  }
  if (tasks.length > MAX_DEEP_CHECK_TASKS) {
    return { eligible: false, reason: "too-many-tasks" }
  }

  const taskIds = tasks.map((task) => task.taskId)
  if (new Set(taskIds).size !== taskIds.length) {
    return { eligible: false, reason: "duplicate-task-id" }
  }
  if (tasks.some((task) => task.archived)) {
    return { eligible: false, reason: "archived-task" }
  }
  const projectId = tasks[0]?.projectId
  if (!projectId?.trim() || tasks.some((task) => !task.projectId?.trim())) {
    return { eligible: false, reason: "missing-project" }
  }

  if (tasks.some((task) => task.projectId !== projectId)) {
    return { eligible: false, reason: "mixed-projects" }
  }
  if (tasks.some((task) => !task.branch?.trim())) {
    return { eligible: false, reason: "missing-branch" }
  }
  const worktreePaths: string[] = []
  const resolvedWorktreePaths: string[] = []
  for (const task of tasks) {
    if (!task.worktreePath?.trim()) {
      return { eligible: false, reason: "missing-worktree" }
    }
    worktreePaths.push(task.worktreePath)
    resolvedWorktreePaths.push(getResolvedWorktreePath(task.worktreePath))
  }
  if (new Set(resolvedWorktreePaths).size !== tasks.length) {
    return { eligible: false, reason: "shared-worktree" }
  }

  return {
    eligible: true,
    projectId,
    taskIds,
    worktreePaths,
  }
}

/**
 * Builds bounded, deterministic explicit-check selections without any Git IO.
 * A card is eligible only when it has at least one active branch-mode sibling
 * for the same project backed by a different resolved worktree directory.
 */
export function computeEligibleDeepCheckTaskIdsByTaskId(
  tasks: readonly AgentWorkbenchDeepCheckCandidate[],
): Record<string, string[]> {
  const result = Object.fromEntries(
    tasks.map((task) => [task.taskId, []]),
  ) as Record<string, string[]>
  const tasksByProject = new Map<string, AgentWorkbenchDeepCheckCandidate[]>()

  for (const task of tasks) {
    if (
      task.archived ||
      !task.projectId ||
      !task.branch ||
      !task.worktreePath
    ) {
      continue
    }
    const projectTasks = tasksByProject.get(task.projectId) ?? []
    projectTasks.push(task)
    tasksByProject.set(task.projectId, projectTasks)
  }

  for (const projectTasks of tasksByProject.values()) {
    for (const task of projectTasks) {
      if (!task.worktreePath) continue
      const selectedTasks = [task]
      const selectedWorktreePaths = new Set([
        getResolvedWorktreePath(task.worktreePath),
      ])
      const peers = projectTasks
        .filter((peer) => peer.taskId !== task.taskId)
        .sort((left, right) => left.taskId.localeCompare(right.taskId))

      for (const peer of peers) {
        if (!peer.worktreePath) continue
        const resolvedWorktreePath = getResolvedWorktreePath(peer.worktreePath)
        if (selectedWorktreePaths.has(resolvedWorktreePath)) continue
        selectedTasks.push(peer)
        selectedWorktreePaths.add(resolvedWorktreePath)
        if (selectedTasks.length === MAX_DEEP_CHECK_TASKS) break
      }

      const eligibility =
        validateAgentWorkbenchDeepCheckCandidates(selectedTasks)
      if (eligibility.eligible) {
        result[task.taskId] = eligibility.taskIds
      }
    }
  }

  return result
}

/**
 * Fingerprints the tier-(a) summary only. This deliberately excludes HEAD and
 * error text so listTasks can recompute it without any additional Git work.
 */
export function computeAgentWorkbenchStatusHash(
  diff: AgentWorkbenchDiffSummary,
): string {
  const files = diff.files
    .map((file) => ({
      path: file.path,
      deleted: file.deleted,
      ...(file.renamedTo ? { renamedTo: file.renamedTo } : {}),
    }))
    .sort((left, right) => {
      const pathOrder =
        left.path < right.path ? -1 : left.path > right.path ? 1 : 0
      if (pathOrder !== 0) return pathOrder
      const deleteOrder = Number(left.deleted) - Number(right.deleted)
      if (deleteOrder !== 0) return deleteOrder
      const leftRename = left.renamedTo ?? ""
      const rightRename = right.renamedTo ?? ""
      return leftRename < rightRename ? -1 : leftRename > rightRename ? 1 : 0
    })

  return createHash("sha256")
    .update(
      JSON.stringify({
        fileCount: diff.fileCount,
        additions: diff.additions,
        deletions: diff.deletions,
        files,
      }),
    )
    .digest("hex")
}

export function computeCrossWorkspaceConflicts(
  tasks: readonly AgentWorkbenchConflictTask[],
): Map<string, AgentWorkbenchConflict[]> {
  const conflictsByTaskId = new Map<string, AgentWorkbenchConflict[]>()
  const pathsByProject = new Map<string, Map<string, PathParticipant[]>>()

  for (const task of tasks) {
    conflictsByTaskId.set(task.taskId, [])
    if (!task.projectId || task.diff.error) continue

    const pathsForTask = new Map<string, boolean>()
    for (const file of task.diff.files) {
      if (!file.path || isGitDiffExcludedPath(file.path)) continue
      const previous = pathsForTask.get(file.path)
      pathsForTask.set(
        file.path,
        previous === undefined ? file.deleted : previous && file.deleted,
      )
    }

    let projectPaths = pathsByProject.get(task.projectId)
    if (!projectPaths) {
      projectPaths = new Map()
      pathsByProject.set(task.projectId, projectPaths)
    }

    for (const [path, deleted] of pathsForTask) {
      const participants = projectPaths.get(path) ?? []
      participants.push({
        taskId: task.taskId,
        deleted,
        worktreeIdentity: task.worktreePath
          ? getResolvedWorktreePath(task.worktreePath)
          : `task:${task.taskId}`,
      })
      projectPaths.set(path, participants)
    }
  }

  for (const projectPaths of pathsByProject.values()) {
    for (const [path, participants] of projectPaths) {
      if (participants.length < 2) continue

      for (const participant of participants) {
        const otherParticipants = participants.filter(
          (other) =>
            other.taskId !== participant.taskId &&
            other.worktreeIdentity !== participant.worktreeIdentity,
        )
        if (otherParticipants.length === 0) continue

        const comparableParticipants = [participant, ...otherParticipants]
        const hasDeletion = comparableParticipants.some(
          (entry) => entry.deleted,
        )
        const hasEdit = comparableParticipants.some((entry) => !entry.deleted)
        const kind = hasDeletion
          ? hasEdit
            ? "delete-edit"
            : "delete-delete"
          : "edit-edit"

        conflictsByTaskId.get(participant.taskId)?.push({
          path,
          withTaskIds: otherParticipants.map((other) => other.taskId),
          kind,
        })
      }
    }
  }

  return conflictsByTaskId
}
