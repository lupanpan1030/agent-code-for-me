import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import simpleGit from "simple-git"
import {
  applyRollbackStash,
  createRollbackStashDraft,
  discardRollbackStashDraft,
  publishRollbackStashDraft,
} from "../src/main/lib/git/stash"

const temporaryRepos: string[] = []

async function createRepo(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "locus-rollback-draft-test-"))
  temporaryRepos.push(cwd)
  const git = simpleGit(cwd)
  await git.init()
  await git.addConfig("user.name", "Locus Test")
  await git.addConfig("user.email", "locus-test@example.invalid")
  await writeFile(join(cwd, "state.txt"), "baseline\n")
  await git.add(["state.txt"])
  await git.commit("baseline")
  return cwd
}

async function readRef(cwd: string, ref: string): Promise<string | null> {
  try {
    return (await simpleGit(cwd).raw(["rev-parse", "--verify", ref])).trim()
  } catch {
    return null
  }
}

async function snapshotWorktreeAndHistory(cwd: string): Promise<{
  head: string
  history: string
  indexTree: string
  status: string
  trackedState: string
  untrackedState: string
}> {
  const git = simpleGit(cwd)
  return {
    head: (await git.raw(["rev-parse", "HEAD"])).trim(),
    history: await git.raw(["log", "--format=%H", "HEAD"]),
    indexTree: (await git.raw(["write-tree"])).trim(),
    status: await git.raw([
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]),
    trackedState: await readFile(join(cwd, "state.txt"), "utf8"),
    untrackedState: await readFile(join(cwd, "must-remain.txt"), "utf8"),
  }
}

async function prepareRollbackTargetSnapshot(cwd: string) {
  await writeFile(join(cwd, "state.txt"), "must-remain-untouched\n")
  await writeFile(join(cwd, "must-remain.txt"), "untracked-must-remain\n")
  return snapshotWorktreeAndHistory(cwd)
}

describe("rollback stash drafts", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryRepos.splice(0).map((cwd) =>
        rm(cwd, {
          recursive: true,
          force: true,
        }),
      ),
    )
  })

  test("keeps a captured draft private until it is explicitly published", async () => {
    const cwd = await createRepo()
    await writeFile(join(cwd, "state.txt"), "run-a\n")

    const draft = await createRollbackStashDraft(cwd, "sdk-message-a")
    expect(draft).not.toBeNull()
    if (!draft) throw new Error("Expected rollback draft")

    expect(await readRef(cwd, draft.publicRef)).toBeNull()
    expect(await readRef(cwd, draft.privateRef)).toBe(draft.oid)

    await discardRollbackStashDraft(draft)
    expect(await readRef(cwd, draft.privateRef)).toBeNull()
    expect(await readRef(cwd, draft.publicRef)).toBeNull()
  })

  test("publishes the draft and removes only its private ref on normal cleanup", async () => {
    const cwd = await createRepo()
    await writeFile(join(cwd, "state.txt"), "run-a\n")

    const draft = await createRollbackStashDraft(cwd, "sdk-message-a")
    expect(draft).not.toBeNull()
    if (!draft) throw new Error("Expected rollback draft")

    const checkpoint = await publishRollbackStashDraft(draft)
    expect(checkpoint).toEqual({ ref: draft.publicRef, oid: draft.oid })
    expect(await readRef(cwd, draft.publicRef)).toBe(draft.oid)

    await discardRollbackStashDraft(draft)
    expect(await readRef(cwd, draft.privateRef)).toBeNull()
    expect(await readRef(cwd, draft.publicRef)).toBe(draft.oid)
  })

  test("same SDK UUID drafts use unique refs and stale cleanup cannot alter the newer checkpoint", async () => {
    const cwd = await createRepo()
    await writeFile(join(cwd, "state.txt"), "run-a\n")
    const staleDraft = await createRollbackStashDraft(cwd, "shared-sdk-message")
    expect(staleDraft).not.toBeNull()
    if (!staleDraft) throw new Error("Expected stale rollback draft")
    const staleCheckpoint = await publishRollbackStashDraft(staleDraft)
    expect(staleCheckpoint).not.toBeNull()

    await writeFile(join(cwd, "state.txt"), "run-b\n")
    const currentDraft = await createRollbackStashDraft(
      cwd,
      "shared-sdk-message",
    )
    expect(currentDraft).not.toBeNull()
    if (!currentDraft) throw new Error("Expected current rollback draft")
    const currentCheckpoint = await publishRollbackStashDraft(currentDraft)
    expect(currentCheckpoint).not.toBeNull()
    expect(currentDraft.publicRef).not.toBe(staleDraft.publicRef)

    await discardRollbackStashDraft(staleDraft, {
      publishedCheckpoint: staleCheckpoint,
    })
    expect(await readRef(cwd, staleDraft.publicRef)).toBeNull()
    expect(await readRef(cwd, currentDraft.publicRef)).toBe(currentDraft.oid)

    await discardRollbackStashDraft(currentDraft, {
      publishedCheckpoint: currentCheckpoint,
    })
    expect(await readRef(cwd, currentDraft.publicRef)).toBeNull()
  })

  test("publish uses compare-and-create and never overwrites an occupied public ref", async () => {
    const cwd = await createRepo()
    await writeFile(join(cwd, "state.txt"), "run-a\n")
    const draft = await createRollbackStashDraft(cwd, "sdk-message-a")
    expect(draft).not.toBeNull()
    if (!draft) throw new Error("Expected rollback draft")

    const existingOid = (await simpleGit(cwd).raw(["rev-parse", "HEAD"])).trim()
    await simpleGit(cwd).raw([
      "update-ref",
      draft.publicRef,
      existingOid,
      "0".repeat(existingOid.length),
    ])

    expect(await publishRollbackStashDraft(draft)).toBeNull()
    expect(await readRef(cwd, draft.publicRef)).toBe(existingOid)
    await discardRollbackStashDraft(draft)
    expect(await readRef(cwd, draft.publicRef)).toBe(existingOid)
  })

  test("rejects a wrong expected OID before modifying the worktree", async () => {
    const cwd = await createRepo()
    await writeFile(join(cwd, "state.txt"), "checkpoint-state\n")
    const draft = await createRollbackStashDraft(cwd, "sdk-message-a")
    expect(draft).not.toBeNull()
    if (!draft) throw new Error("Expected rollback draft")
    const checkpoint = await publishRollbackStashDraft(draft)
    expect(checkpoint).not.toBeNull()
    if (!checkpoint) throw new Error("Expected published checkpoint")

    await writeFile(join(cwd, "state.txt"), "must-remain-untouched\n")
    const result = await applyRollbackStash(cwd, {
      ref: checkpoint.ref,
      oid: "f".repeat(checkpoint.oid.length),
    })

    expect(result).toEqual({
      success: false,
      error: "Rollback checkpoint reference does not match its expected OID",
    })
    expect(await readFile(join(cwd, "state.txt"), "utf8")).toBe(
      "must-remain-untouched\n",
    )
    await discardRollbackStashDraft(draft, {
      publishedCheckpoint: checkpoint,
    })
  })

  test("fails closed when the published ref is missing without changing the worktree or history", async () => {
    const cwd = await createRepo()
    await writeFile(join(cwd, "state.txt"), "checkpoint-state\n")
    const draft = await createRollbackStashDraft(cwd, "sdk-message-a")
    expect(draft).not.toBeNull()
    if (!draft) throw new Error("Expected rollback draft")
    const checkpoint = await publishRollbackStashDraft(draft)
    expect(checkpoint).not.toBeNull()
    if (!checkpoint) throw new Error("Expected published checkpoint")

    await simpleGit(cwd).raw([
      "update-ref",
      "-d",
      checkpoint.ref,
      checkpoint.oid,
    ])
    const before = await prepareRollbackTargetSnapshot(cwd)

    expect(await applyRollbackStash(cwd, checkpoint)).toEqual({
      success: true,
      checkpointFound: false,
    })
    expect(await snapshotWorktreeAndHistory(cwd)).toEqual(before)
  })

  test("fails closed when the published ref moved before validation without changing the worktree or history", async () => {
    const cwd = await createRepo()
    await writeFile(join(cwd, "state.txt"), "checkpoint-state\n")
    const draft = await createRollbackStashDraft(cwd, "sdk-message-a")
    expect(draft).not.toBeNull()
    if (!draft) throw new Error("Expected rollback draft")
    const checkpoint = await publishRollbackStashDraft(draft)
    expect(checkpoint).not.toBeNull()
    if (!checkpoint) throw new Error("Expected published checkpoint")

    const replacementOid = (
      await simpleGit(cwd).raw(["rev-parse", "HEAD"])
    ).trim()
    await simpleGit(cwd).raw([
      "update-ref",
      checkpoint.ref,
      replacementOid,
      checkpoint.oid,
    ])
    const before = await prepareRollbackTargetSnapshot(cwd)

    expect(await applyRollbackStash(cwd, checkpoint)).toEqual({
      success: false,
      error: "Rollback checkpoint reference does not match its expected OID",
    })
    expect(await snapshotWorktreeAndHistory(cwd)).toEqual(before)
  })

  test("fails closed when the published ref is replaced between exact validation and the pre-apply recheck", async () => {
    const cwd = await createRepo()
    await writeFile(join(cwd, "state.txt"), "checkpoint-state\n")
    const draft = await createRollbackStashDraft(cwd, "sdk-message-a")
    expect(draft).not.toBeNull()
    if (!draft) throw new Error("Expected rollback draft")
    const checkpoint = await publishRollbackStashDraft(draft)
    expect(checkpoint).not.toBeNull()
    if (!checkpoint) throw new Error("Expected published checkpoint")

    const replacementOid = (
      await simpleGit(cwd).raw(["rev-parse", "HEAD"])
    ).trim()
    const before = await prepareRollbackTargetSnapshot(cwd)
    let recheckWindowEntered = 0

    const result = await applyRollbackStash(cwd, checkpoint, {
      beforeApplyRefRecheck: async () => {
        recheckWindowEntered += 1
        await simpleGit(cwd).raw([
          "update-ref",
          checkpoint.ref,
          replacementOid,
          checkpoint.oid,
        ])
      },
    })

    expect(recheckWindowEntered).toBe(1)
    expect(await readRef(cwd, checkpoint.ref)).toBe(replacementOid)
    expect(result).toEqual({
      success: false,
      error: "Rollback checkpoint changed before it could be applied",
    })
    expect(await snapshotWorktreeAndHistory(cwd)).toEqual(before)
  })

  test("applies the exact published ref and OID on the happy path", async () => {
    const cwd = await createRepo()
    await writeFile(join(cwd, "state.txt"), "checkpoint-state\n")
    const draft = await createRollbackStashDraft(cwd, "sdk-message-a")
    expect(draft).not.toBeNull()
    if (!draft) throw new Error("Expected rollback draft")
    const checkpoint = await publishRollbackStashDraft(draft)
    expect(checkpoint).not.toBeNull()
    if (!checkpoint) throw new Error("Expected published checkpoint")

    await writeFile(join(cwd, "state.txt"), "later-state\n")
    expect(await applyRollbackStash(cwd, checkpoint)).toEqual({
      success: true,
      checkpointFound: true,
    })
    expect(await readFile(join(cwd, "state.txt"), "utf8")).toBe(
      "checkpoint-state\n",
    )
  })
})
