import { TRPCError } from "@trpc/server"
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm"
import { z } from "zod"
import {
  type AgentWorkbenchDeepCheckIneligibilityReason,
  computeAgentWorkbenchStatusHash,
  computeCrossWorkspaceConflicts,
  computeEligibleDeepCheckTaskIdsByTaskId,
  validateAgentWorkbenchDeepCheckCandidates,
} from "../../agent-workbench/conflicts"
import {
  checkCrossWorkspaceConflicts,
  getAgentWorkbenchDiffSummary,
  getGitHeadSha,
  probeMergeTreeCapability,
  runGitMergeTreeTrial,
} from "../../agent-workbench/deep-conflicts"
import {
  type AgentWorkbenchFilter,
  classifyAgentWorkbenchStatus,
  matchesAgentWorkbenchFilter,
  summarizeLatestSubChat,
} from "../../agent-workbench/status"
import { ensureChatBaseCommit } from "../../chat-base-commit"
import { chats, getDatabase, projects, subChats } from "../../db"
import { assertRegisteredWorktree } from "../../git/security"
import { getWorktreeDiff } from "../../git/worktree"
import { publicProcedure, router } from "../index"

const workbenchFilterSchema = z.enum([
  "all",
  "running",
  "needs-review",
  "prs",
  "blocked",
  "clean",
]) satisfies z.ZodType<AgentWorkbenchFilter>

const listTasksInputSchema = z
  .object({
    projectId: z.string().optional(),
    filter: workbenchFilterSchema.optional(),
    runningSubChatIds: z.array(z.string()).optional(),
    blockedSubChatIds: z.array(z.string()).optional(),
    includeArchived: z.boolean().optional(),
  })
  .optional()

const checkConflictsInputSchema = z.object({
  taskIds: z
    .array(z.string().trim().min(1))
    .min(2)
    .max(10)
    .refine((taskIds) => new Set(taskIds).size === taskIds.length, {
      message: "Task ids must be unique",
    }),
})

const deepCheckEligibilityErrorMessages: Record<
  AgentWorkbenchDeepCheckIneligibilityReason,
  string
> = {
  "too-few-tasks": "Conflict checks require at least two tasks",
  "too-many-tasks": "Conflict checks support at most ten tasks",
  "duplicate-task-id": "Conflict checks require unique task ids",
  "archived-task": "Conflict checks do not allow archived tasks",
  "missing-project": "Every task must belong to a registered project",
  "mixed-projects": "Conflict checks require tasks from one project",
  "missing-branch": "Conflict checks require an active branch for every task",
  "missing-worktree": "Conflict checks require a worktree for every task",
  "shared-worktree":
    "Conflict checks require tasks from distinct worktree directories",
}

type ChatRow = typeof chats.$inferSelect & {
  projectName: string
  projectPath: string
  gitProvider: string | null
  gitOwner: string | null
  gitRepo: string | null
}

type SubChatRow = Pick<
  typeof subChats.$inferSelect,
  | "id"
  | "name"
  | "chatId"
  | "sessionId"
  | "streamId"
  | "mode"
  | "messages"
  | "updatedAt"
>

function chooseLatestSubChat(rows: SubChatRow[]): SubChatRow | null {
  if (rows.length === 0) return null

  return (
    rows.slice().sort((left, right) => {
      const leftTime = left.updatedAt?.getTime() ?? 0
      const rightTime = right.updatedAt?.getTime() ?? 0
      return rightTime - leftTime
    })[0] ?? null
  )
}

export const agentWorkbenchRouter = router({
  listTasks: publicProcedure
    .input(listTasksInputSchema)
    .query(async ({ input }) => {
      const db = getDatabase()
      const filter = input?.filter ?? "all"
      const includeArchived = input?.includeArchived === true
      const runningSubChatIds = new Set(input?.runningSubChatIds ?? [])
      const blockedSubChatIds = new Set(input?.blockedSubChatIds ?? [])

      const whereClauses = [
        isNotNull(chats.projectId),
        input?.projectId ? eq(chats.projectId, input.projectId) : undefined,
        includeArchived ? undefined : isNull(chats.archivedAt),
      ].filter(Boolean)
      const whereClause =
        whereClauses.length === 0
          ? undefined
          : whereClauses.length === 1
            ? whereClauses[0]
            : and(...whereClauses)

      const chatRows = db
        .select({
          id: chats.id,
          name: chats.name,
          projectId: chats.projectId,
          createdAt: chats.createdAt,
          updatedAt: chats.updatedAt,
          archivedAt: chats.archivedAt,
          worktreePath: chats.worktreePath,
          branch: chats.branch,
          baseBranch: chats.baseBranch,
          prUrl: chats.prUrl,
          prNumber: chats.prNumber,
          projectName: projects.name,
          projectPath: projects.path,
          gitProvider: projects.gitProvider,
          gitOwner: projects.gitOwner,
          gitRepo: projects.gitRepo,
        })
        .from(chats)
        .innerJoin(projects, eq(chats.projectId, projects.id))
        .where(whereClause)
        .orderBy(desc(chats.updatedAt))
        .all() as ChatRow[]

      const chatIds = chatRows.map((chat) => chat.id)
      const subChatRows =
        chatIds.length > 0
          ? (db
              .select({
                id: subChats.id,
                name: subChats.name,
                chatId: subChats.chatId,
                sessionId: subChats.sessionId,
                streamId: subChats.streamId,
                mode: subChats.mode,
                messages: subChats.messages,
                updatedAt: subChats.updatedAt,
              })
              .from(subChats)
              .where(inArray(subChats.chatId, chatIds))
              .all() as SubChatRow[])
          : []

      const subChatsByChat = new Map<string, SubChatRow[]>()
      for (const row of subChatRows) {
        const existing = subChatsByChat.get(row.chatId) ?? []
        existing.push(row)
        subChatsByChat.set(row.chatId, existing)
      }

      const tasks = await Promise.all(
        chatRows.map(async (chat) => {
          const latestRawSubChat = chooseLatestSubChat(
            subChatsByChat.get(chat.id) ?? [],
          )
          const latestSubChat = latestRawSubChat
            ? summarizeLatestSubChat(latestRawSubChat)
            : null
          const diff = await getAgentWorkbenchDiffSummary(chat.worktreePath)
          const hasActiveStream =
            !!latestSubChat?.streamId ||
            (latestSubChat ? runningSubChatIds.has(latestSubChat.id) : false)
          const isClientBlocked = latestSubChat
            ? blockedSubChatIds.has(latestSubChat.id)
            : false
          const status = classifyAgentWorkbenchStatus({
            archived: !!chat.archivedAt,
            worktreePath: chat.worktreePath,
            hasActiveStream,
            hasPendingUserQuestion:
              latestSubChat?.pendingUserQuestion === true || isClientBlocked,
            hasPendingPlanApproval: latestSubChat?.pendingPlanApproval === true,
            runtimeError: diff.error || latestSubChat?.errorText || null,
            guardedRunStatus: latestSubChat?.guardedRunStatus,
            diff,
            prUrl: chat.prUrl,
            prNumber: chat.prNumber,
          })
          const statusHash = computeAgentWorkbenchStatusHash(diff)

          return {
            id: chat.id,
            title: chat.name || "Untitled Chat",
            project: {
              id: chat.projectId,
              name: chat.projectName,
              path: chat.projectPath,
              gitProvider: chat.gitProvider,
              gitOwner: chat.gitOwner,
              gitRepo: chat.gitRepo,
            },
            worktreePath: chat.worktreePath,
            branch: chat.branch,
            baseBranch: chat.baseBranch,
            localDirectoryMode: !chat.branch,
            latestSubChat,
            diff,
            statusHash,
            pr:
              chat.prUrl || chat.prNumber
                ? {
                    url: chat.prUrl,
                    number: chat.prNumber,
                  }
                : null,
            status: status.status,
            statusReason: status.reason,
            updatedAt: chat.updatedAt,
            archivedAt: chat.archivedAt,
            actions: {
              canOpen: true,
              canContinue: latestSubChat !== null,
              canReviewDiff: !!chat.worktreePath && diff.fileCount > 0,
              canOpenPr: !!chat.prUrl,
              canCreatePr: !!chat.worktreePath && !chat.prUrl,
            },
          }
        }),
      )

      const conflictsByTaskId = computeCrossWorkspaceConflicts(
        tasks
          .filter((task) => !task.archivedAt)
          .map((task) => ({
            taskId: task.id,
            projectId: task.project.id,
            worktreePath: task.worktreePath,
            diff: task.diff,
          })),
      )
      const eligibleDeepCheckTaskIdsByTaskId =
        computeEligibleDeepCheckTaskIdsByTaskId(
          tasks.map((task) => ({
            taskId: task.id,
            projectId: task.project.id,
            worktreePath: task.worktreePath,
            branch: task.branch,
            archived: !!task.archivedAt,
          })),
        )
      const tasksWithConflicts = tasks.map((task) => ({
        ...task,
        conflicts: conflictsByTaskId.get(task.id) ?? [],
      }))

      const counts = {
        all: tasks.length,
        running: tasks.filter((task) => task.status === "running").length,
        needsReview: tasks.filter((task) => task.status === "needs-review")
          .length,
        prs: tasks.filter((task) => task.status === "has-pr").length,
        blocked: tasks.filter((task) => task.status === "blocked").length,
        clean: tasks.filter((task) => task.status === "clean").length,
      }

      return {
        tasks: tasksWithConflicts.filter((task) =>
          matchesAgentWorkbenchFilter(task.status, filter),
        ),
        workspaceTitlesByTaskId: Object.fromEntries(
          tasks.map((task) => [task.id, task.title]),
        ),
        workspaceStatusHashesByTaskId: Object.fromEntries(
          tasks.map((task) => [task.id, task.statusHash]),
        ),
        eligibleDeepCheckTaskIdsByTaskId,
        counts,
        loadedAt: new Date(),
      }
    }),
  checkConflicts: publicProcedure
    .input(checkConflictsInputSchema)
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const taskIds = input.taskIds.slice().sort()
      const rows = db
        .select({
          taskId: chats.id,
          projectId: chats.projectId,
          projectPath: projects.path,
          worktreePath: chats.worktreePath,
          branch: chats.branch,
          baseBranch: chats.baseBranch,
          archivedAt: chats.archivedAt,
        })
        .from(chats)
        .innerJoin(projects, eq(chats.projectId, projects.id))
        .where(inArray(chats.id, taskIds))
        .all()

      if (rows.length !== taskIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Every task must belong to a registered project",
        })
      }

      const eligibility = validateAgentWorkbenchDeepCheckCandidates(
        rows.map((row) => ({
          taskId: row.taskId,
          projectId: row.projectId,
          worktreePath: row.worktreePath,
          branch: row.branch,
          archived: row.archivedAt !== null,
        })),
      )
      if (!eligibility.eligible) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: deepCheckEligibilityErrorMessages[eligibility.reason],
        })
      }

      const projectPath = rows[0]?.projectPath
      if (!projectPath) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Conflict checks require a registered project path",
        })
      }
      try {
        assertRegisteredWorktree(projectPath)
        for (const worktreePath of eligibility.worktreePaths) {
          assertRegisteredWorktree(worktreePath)
        }
      } catch (cause) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Conflict checks require registered worktree paths",
          cause,
        })
      }

      const workspaces = rows.map((row) => ({
        taskId: row.taskId,
        projectPath: row.projectPath,
        worktreePath: row.worktreePath,
        branch: row.branch,
        baseBranch: row.baseBranch,
      }))

      return checkCrossWorkspaceConflicts(workspaces, {
        ensureBaseCommit: (taskId, options) =>
          ensureChatBaseCommit(db, taskId, options),
        getHeadSha: getGitHeadSha,
        getWorkspaceSummary: (worktreePath, options) =>
          getAgentWorkbenchDiffSummary(worktreePath, options),
        getWorkspaceDiff: (worktreePath, options) =>
          getWorktreeDiff(worktreePath, undefined, {
            onlyUncommitted: true,
            signal: options?.signal,
            timeoutMs: options?.timeoutMs,
          }),
        probeMergeTreeCapability,
        runMergeTreeTrial: runGitMergeTreeTrial,
      })
    }),
})
