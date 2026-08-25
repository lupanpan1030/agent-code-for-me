import { and, eq, isNull } from "drizzle-orm"
import simpleGit from "simple-git"
import type { getDatabase } from "./db"
import { chats } from "./db/schema"
import { refExistsLocally } from "./git/worktree"

export type ChatBaseCommitDatabase = ReturnType<typeof getDatabase>

export type EnsureChatBaseCommitDependencies = {
  getMergeBase?: (worktreePath: string, baseBranch: string) => Promise<string>
  getCommitDistance?: (
    worktreePath: string,
    baseCommit: string,
  ) => Promise<number>
  refExistsLocally?: (worktreePath: string, ref: string) => Promise<boolean>
}

async function getMergeBase(
  worktreePath: string,
  baseBranch: string,
): Promise<string> {
  return simpleGit(worktreePath).raw(["merge-base", "HEAD", baseBranch])
}

async function getCommitDistance(
  worktreePath: string,
  baseCommit: string,
): Promise<number> {
  const output = await simpleGit(worktreePath).raw([
    "rev-list",
    "--count",
    `${baseCommit}..HEAD`,
  ])
  const distance = Number.parseInt(output.trim(), 10)
  if (!Number.isFinite(distance)) {
    throw new Error("Could not determine the fork-commit distance")
  }
  return distance
}

async function resolveBackfillBaseCommit(
  worktreePath: string,
  baseBranch: string,
  dependencies: EnsureChatBaseCommitDependencies,
): Promise<string | null> {
  const readMergeBase = dependencies.getMergeBase ?? getMergeBase
  const candidates: string[] = []

  try {
    const localMergeBase = (
      await readMergeBase(worktreePath, baseBranch)
    ).trim()
    if (localMergeBase) candidates.push(localMergeBase)
  } catch {}

  const remoteBaseRef = `origin/${baseBranch}`
  if (
    await (dependencies.refExistsLocally ?? refExistsLocally)(
      worktreePath,
      remoteBaseRef,
    )
  ) {
    try {
      const remoteMergeBase = (
        await readMergeBase(worktreePath, remoteBaseRef)
      ).trim()
      if (remoteMergeBase) candidates.push(remoteMergeBase)
    } catch {}
  }

  const uniqueCandidates = Array.from(new Set(candidates))
  if (uniqueCandidates.length === 0) return null
  if (uniqueCandidates.length === 1) return uniqueCandidates[0] ?? null

  const readDistance = dependencies.getCommitDistance ?? getCommitDistance
  const rankedCandidates = await Promise.all(
    uniqueCandidates.map(async (candidate) => ({
      candidate,
      distance: await readDistance(worktreePath, candidate),
    })),
  )
  rankedCandidates.sort((left, right) => left.distance - right.distance)
  if (rankedCandidates[0]?.distance === rankedCandidates[1]?.distance) {
    return null
  }
  return rankedCandidates[0]?.candidate ?? null
}

export async function ensureChatBaseCommit(
  db: ChatBaseCommitDatabase,
  chatId: string,
  dependencies: EnsureChatBaseCommitDependencies = {},
): Promise<string | null> {
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
      dependencies,
    )
  } catch {
    return null
  }

  if (!baseCommit) return null

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
