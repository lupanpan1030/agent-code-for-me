import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import simpleGit from "simple-git"
import {
  isCanonicalRollbackCheckpointBinding,
  type RollbackCheckpointBinding,
} from "../../../shared/chat-message"

const APPLY_RETRIES = 3
const APPLY_RETRY_DELAY_MS = 200

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type CheckpointPayload = {
  sdkMessageUuid: string
  indexTree: string
  worktreeTree: string
}

export type RollbackStashDraft = {
  cwd: string
  sdkMessageUuid: string
  oid: string
  privateRef: string
  publicRef: string
}

async function deleteRefIfMatching(input: {
  cwd: string
  ref: string
  oid: string
}): Promise<boolean> {
  const git = simpleGit(input.cwd)
  try {
    await git.raw(["update-ref", "-d", input.ref, input.oid])
    return true
  } catch (error) {
    let currentCommitHash: string | null = null
    try {
      currentCommitHash = (
        await git.raw(["rev-parse", "--verify", input.ref])
      ).trim()
    } catch {
      return false
    }
    if (currentCommitHash !== input.oid) {
      return false
    }
    throw error
  }
}

/**
 * Capture a rollback checkpoint without publishing it to refs/locus-checkpoints/.
 *
 * The temporary ref keeps the orphan commit alive while the caller verifies
 * that its Run still owns the chat. Rollback readers never consult this ref.
 */
export async function createRollbackStashDraft(
  cwd: string,
  sdkMessageUuid: string,
): Promise<RollbackStashDraft | null> {
  let privateRef: string | null = null
  let privateRefCreated = false
  let oid = ""
  try {
    const git = simpleGit(cwd)

    const indexTreeRaw = await git.raw(["write-tree"])
    const indexTree = indexTreeRaw.trim()
    if (!indexTree) {
      return null
    }

    let worktreeTree = ""
    let tempDir: string | undefined
    try {
      tempDir = await mkdtemp(join(tmpdir(), "checkpoint-index-"))
      const tempIndexPath = join(tempDir, "index")
      const gitWithTempIndex = simpleGit(cwd).env({
        GIT_INDEX_FILE: tempIndexPath,
      })
      await gitWithTempIndex.raw(["add", "-A"])
      worktreeTree = (await gitWithTempIndex.raw(["write-tree"])).trim()
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true })
      }
    }

    if (!worktreeTree) {
      return null
    }

    const checkpointPayload: CheckpointPayload = {
      sdkMessageUuid,
      indexTree,
      worktreeTree,
    }
    const commitRaw = await git.raw([
      "-c",
      "user.name=Checkpoint",
      "-c",
      "user.email=checkpoint@local",
      "commit-tree",
      worktreeTree,
      "-m",
      JSON.stringify(checkpointPayload),
    ])
    oid = commitRaw.trim()
    if (!oid) {
      return null
    }

    privateRef = `refs/locus-checkpoint-drafts/${randomUUID()}`
    const publicRef = `refs/locus-checkpoints/${randomUUID()}`
    await git.raw(["update-ref", privateRef, oid, "0".repeat(oid.length)])
    privateRefCreated = true
    return {
      cwd,
      sdkMessageUuid,
      oid,
      privateRef,
      publicRef,
    }
  } catch (e) {
    if (privateRefCreated && privateRef && oid) {
      try {
        await deleteRefIfMatching({ cwd, ref: privateRef, oid })
      } catch {
        // The draft is private and best-effort cleanup is sufficient here.
      }
    }
    console.error("[claude] Failed to create rollback checkpoint draft:", e)
    return null
  }
}

/** Publish a prepared draft to its main-minted, never-reused public ref. */
export async function publishRollbackStashDraft(
  draft: RollbackStashDraft,
): Promise<RollbackCheckpointBinding | null> {
  const checkpoint = { ref: draft.publicRef, oid: draft.oid }
  if (!isCanonicalRollbackCheckpointBinding(checkpoint)) {
    console.error(
      "[claude] Refusing to publish an invalid rollback checkpoint draft",
    )
    return null
  }
  const git = simpleGit(draft.cwd)
  try {
    await git.raw([
      "update-ref",
      draft.publicRef,
      draft.oid,
      "0".repeat(draft.oid.length),
    ])
    return checkpoint
  } catch (e) {
    try {
      if ((await git.raw(["rev-parse", "--verify", draft.publicRef])).trim()) {
        console.warn(
          "[claude] Rollback checkpoint ref collision; publication skipped",
        )
        return null
      }
    } catch {
      // Fall through to the unexpected publication failure diagnostic.
    }
    console.error("[claude] Failed to publish rollback checkpoint draft:", e)
    return null
  }
}

/**
 * Discard a private draft and, when requested, retract only the public ref that
 * still points to this exact draft. A newer checkpoint is never deleted.
 */
export async function discardRollbackStashDraft(
  draft: RollbackStashDraft,
  options: { publishedCheckpoint?: RollbackCheckpointBinding | null } = {},
): Promise<void> {
  const publishedCheckpoint = options.publishedCheckpoint
  if (
    publishedCheckpoint &&
    publishedCheckpoint.ref === draft.publicRef &&
    publishedCheckpoint.oid === draft.oid
  ) {
    try {
      await deleteRefIfMatching({
        cwd: draft.cwd,
        ref: publishedCheckpoint.ref,
        oid: publishedCheckpoint.oid,
      })
    } catch (e) {
      console.error("[claude] Failed to retract rollback checkpoint:", e)
    }
  }

  try {
    await deleteRefIfMatching({
      cwd: draft.cwd,
      ref: draft.privateRef,
      oid: draft.oid,
    })
  } catch (e) {
    console.error("[claude] Failed to discard rollback checkpoint draft:", e)
  }
}

function parseCheckpointTrees(message: string): {
  indexTree: string | null
  worktreeTree: string | null
} {
  const body = message.trim()
  if (body) {
    try {
      const parsed = JSON.parse(body) as CheckpointPayload
      if (parsed.indexTree && parsed.worktreeTree) {
        return {
          indexTree: parsed.indexTree,
          worktreeTree: parsed.worktreeTree,
        }
      }
    } catch {
      // Ignore invalid payload.
    }
  }
  return {
    indexTree: null,
    worktreeTree: null,
  }
}

export type RollbackResult =
  | { success: true; checkpointFound: true }
  | { success: true; checkpointFound: false }
  | { success: false; error: string }

type ApplyRollbackStashDependencies = {
  beforeApplyRefRecheck?: () => Promise<void> | void
}

export async function applyRollbackStash(
  worktreePath: string,
  checkpoint: RollbackCheckpointBinding,
  dependencies: ApplyRollbackStashDependencies = {},
): Promise<RollbackResult> {
  try {
    if (!isCanonicalRollbackCheckpointBinding(checkpoint)) {
      return { success: false, error: "Invalid rollback checkpoint binding" }
    }

    const git = simpleGit(worktreePath)

    let resolvedOid = ""
    try {
      resolvedOid = (
        await git.raw(["rev-parse", "--verify", checkpoint.ref])
      ).trim()
    } catch {
      return { success: true, checkpointFound: false }
    }
    if (resolvedOid !== checkpoint.oid) {
      return {
        success: false,
        error: "Rollback checkpoint reference does not match its expected OID",
      }
    }

    const commitMessage = await git.raw([
      "show",
      "-s",
      "--format=%B",
      checkpoint.oid,
    ])
    const { indexTree, worktreeTree } = parseCheckpointTrees(commitMessage)
    if (!indexTree || !worktreeTree) {
      return { success: false, error: "Checkpoint missing tree metadata" }
    }

    await dependencies.beforeApplyRefRecheck?.()

    let lastError: unknown
    for (let attempt = 1; attempt <= APPLY_RETRIES; attempt += 1) {
      try {
        const currentOid = (
          await git.raw(["rev-parse", "--verify", checkpoint.ref])
        ).trim()
        if (currentOid !== checkpoint.oid) {
          return {
            success: false,
            error: "Rollback checkpoint changed before it could be applied",
          }
        }
        await git.raw(["read-tree", worktreeTree])
        await git.raw(["checkout-index", "-a", "-f"])
        await git.raw(["clean", "-fd"])
        await git.raw(["read-tree", indexTree])
        return { success: true, checkpointFound: true }
      } catch (error) {
        lastError = error
        if (attempt < APPLY_RETRIES) {
          await sleep(APPLY_RETRY_DELAY_MS)
        }
      }
    }
    throw lastError
  } catch (e) {
    console.error("[claude] Failed to apply rollback checkpoint:", e)
    const errorMessage = e instanceof Error ? e.message : "Unknown error"
    return { success: false, error: errorMessage }
  }
}
