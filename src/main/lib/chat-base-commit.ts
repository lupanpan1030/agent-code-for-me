import { and, eq, isNull } from "drizzle-orm"
import type { getDatabase } from "./db"
import { chats } from "./db/schema"
import { createGit } from "./git/git-factory"
import { refExistsLocally } from "./git/worktree"

export type ChatBaseCommitDatabase = ReturnType<typeof getDatabase>

export type ChatBaseCommitOperationOptions = {
  signal?: AbortSignal
  timeoutMs?: number
}

export type EnsureChatBaseCommitDependencies = {
  getMergeBase?: (
    worktreePath: string,
    baseBranch: string,
    options?: ChatBaseCommitOperationOptions,
  ) => Promise<string>
  getCommitDistance?: (
    worktreePath: string,
    baseCommit: string,
    options?: ChatBaseCommitOperationOptions,
  ) => Promise<number>
  refExistsLocally?: (
    worktreePath: string,
    ref: string,
    options?: ChatBaseCommitOperationOptions,
  ) => Promise<boolean>
}

async function getMergeBase(
  worktreePath: string,
  baseBranch: string,
  options?: ChatBaseCommitOperationOptions,
): Promise<string> {
  return createGit(worktreePath, {
    signal: options?.signal,
    timeoutMs: options?.timeoutMs,
    absoluteTimeout: true,
  }).raw(["merge-base", "HEAD", baseBranch])
}

async function getCommitDistance(
  worktreePath: string,
  baseCommit: string,
  options?: ChatBaseCommitOperationOptions,
): Promise<number> {
  const output = await createGit(worktreePath, {
    signal: options?.signal,
    timeoutMs: options?.timeoutMs,
    absoluteTimeout: true,
  }).raw(["rev-list", "--count", `${baseCommit}..HEAD`])
  const distance = Number.parseInt(output.trim(), 10)
  if (!Number.isFinite(distance)) {
    throw new Error("Could not determine the fork-commit distance")
  }
  return distance
}

async function resolveBackfillBaseCommit(
  worktreePath: string,
  baseBranch: string,
  options: ChatBaseCommitOperationOptions,
  dependencies: EnsureChatBaseCommitDependencies,
): Promise<string | null> {
  const readMergeBase = dependencies.getMergeBase ?? getMergeBase
  const candidates: string[] = []

  if (options.signal?.aborted) return null
  try {
    const localMergeBase = (
      await readMergeBase(worktreePath, baseBranch, options)
    ).trim()
    if (localMergeBase) candidates.push(localMergeBase)
  } catch {}
  if (options.signal?.aborted) return null

  const remoteBaseRef = `origin/${baseBranch}`
  if (
    await (dependencies.refExistsLocally ?? refExistsLocally)(
      worktreePath,
      remoteBaseRef,
      options,
    )
  ) {
    if (options.signal?.aborted) return null
    try {
      const remoteMergeBase = (
        await readMergeBase(worktreePath, remoteBaseRef, options)
      ).trim()
      if (remoteMergeBase) candidates.push(remoteMergeBase)
    } catch {}
  }
  if (options.signal?.aborted) return null

  const uniqueCandidates = Array.from(new Set(candidates))
  if (uniqueCandidates.length === 0) return null
  if (uniqueCandidates.length === 1) return uniqueCandidates[0] ?? null

  const readDistance = dependencies.getCommitDistance ?? getCommitDistance
  const rankedCandidates = await Promise.all(
    uniqueCandidates.map(async (candidate) => ({
      candidate,
      distance: await readDistance(worktreePath, candidate, options),
    })),
  )
  if (options.signal?.aborted) return null
  rankedCandidates.sort((left, right) => left.distance - right.distance)
  if (rankedCandidates[0]?.distance === rankedCandidates[1]?.distance) {
    return null
  }
  return rankedCandidates[0]?.candidate ?? null
}

export async function ensureChatBaseCommit(
  db: ChatBaseCommitDatabase,
  chatId: string,
  options: ChatBaseCommitOperationOptions = {},
  dependencies: EnsureChatBaseCommitDependencies = {},
): Promise<string | null> {
  if (options.signal?.aborted) return null

  const chat = db
    .select({
      baseCommit: chats.baseCommit,
      worktreePath: chats.worktreePath,
      baseBranch: chats.baseBranch,
    })
    .from(chats)
    .where(eq(chats.id, chatId))
    .get()

  if (!chat) return null
  if (chat.baseCommit !== null) return chat.baseCommit
  if (!chat.worktreePath || !chat.baseBranch) return null

  let baseCommit: string | null
  try {
    baseCommit = await resolveBackfillBaseCommit(
      chat.worktreePath,
      chat.baseBranch,
      options,
      dependencies,
    )
  } catch {
    return null
  }

  if (!baseCommit) return null
  // The request-level timeout may already have won its promise race while an
  // injected dependency ignored cancellation and returned late. Never turn
  // that stale result into a durable write after the signal is aborted.
  if (options.signal?.aborted) return null

  // Force-push drift is accepted per Decision 4: backfill once and retain the
  // first stored fork commit. The compare-and-set prevents concurrent callers
  // from replacing one another after both observed the initial NULL value.
  const writeResult = db
    .update(chats)
    .set({ baseCommit })
    .where(and(eq(chats.id, chatId), isNull(chats.baseCommit)))
    .run()

  if (writeResult.changes > 0) return baseCommit

  return (
    db
      .select({ baseCommit: chats.baseCommit })
      .from(chats)
      .where(eq(chats.id, chatId))
      .get()?.baseCommit ?? null
  )
}
