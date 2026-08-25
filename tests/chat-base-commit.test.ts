import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { eq } from "drizzle-orm"
import {
  type ChatBaseCommitDatabase,
  type ChatBaseCommitOperationOptions,
  ensureChatBaseCommit,
} from "../src/main/lib/chat-base-commit"
import { chats } from "../src/main/lib/db/schema"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

const temporaryRoots: string[] = []

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim()
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function seedChat(
  db: ReturnType<typeof createAgentJobTestDb>,
  input: {
    id: string
    worktreePath?: string | null
    baseBranch?: string | null
    baseCommit?: string | null
  },
): void {
  db.insert(chats)
    .values({
      id: input.id,
      projectId: null,
      worktreePath: input.worktreePath ?? null,
      baseBranch: input.baseBranch ?? null,
      baseCommit: input.baseCommit ?? null,
    })
    .run()
}

function totalChanges(db: ReturnType<typeof createAgentJobTestDb>): number {
  const result = db.$client.query("SELECT total_changes() AS count").get() as {
    count: number
  }
  return result.count
}

describe("ensureChatBaseCommit", () => {
  test("computes and stores a missing base commit once", async () => {
    const db = createAgentJobTestDb()
    seedChat(db, {
      id: "chat-backfill",
      worktreePath: "/tmp/project-worktree",
      baseBranch: "main",
    })
    const calls: Array<[string, string]> = []
    const getMergeBase = async (
      worktreePath: string,
      baseBranch: string,
    ): Promise<string> => {
      calls.push([worktreePath, baseBranch])
      return "fork-commit-sha\n"
    }
    const changesBefore = totalChanges(db)

    const first = await ensureChatBaseCommit(
      db as unknown as ChatBaseCommitDatabase,
      "chat-backfill",
      {},
      { getMergeBase, refExistsLocally: async () => false },
    )
    const changesAfterFirst = totalChanges(db)
    const second = await ensureChatBaseCommit(
      db as unknown as ChatBaseCommitDatabase,
      "chat-backfill",
      {},
      { getMergeBase, refExistsLocally: async () => false },
    )

    expect(first).toBe("fork-commit-sha")
    expect(second).toBe("fork-commit-sha")
    expect(calls).toEqual([["/tmp/project-worktree", "main"]])
    expect(changesAfterFirst).toBe(changesBefore + 1)
    expect(totalChanges(db)).toBe(changesAfterFirst)
    expect(
      db
        .select({ baseCommit: chats.baseCommit })
        .from(chats)
        .where(eq(chats.id, "chat-backfill"))
        .get()?.baseCommit,
    ).toBe("fork-commit-sha")
  })

  test("concurrent backfills converge on the compare-and-set winner", async () => {
    const db = createAgentJobTestDb()
    seedChat(db, {
      id: "chat-concurrent-backfill",
      worktreePath: "/tmp/project-worktree",
      baseBranch: "main",
    })

    let mergeBaseCalls = 0
    let releaseBoth!: () => void
    const bothCallersReady = new Promise<void>((resolve) => {
      releaseBoth = resolve
    })
    const getMergeBase = async (): Promise<string> => {
      mergeBaseCalls += 1
      const candidate = `fork-commit-${mergeBaseCalls}`
      if (mergeBaseCalls === 2) releaseBoth()
      await bothCallersReady
      return candidate
    }
    const dependencies = {
      getMergeBase,
      refExistsLocally: async () => false,
    }
    const changesBefore = totalChanges(db)

    const results = await Promise.all([
      ensureChatBaseCommit(
        db as unknown as ChatBaseCommitDatabase,
        "chat-concurrent-backfill",
        {},
        dependencies,
      ),
      ensureChatBaseCommit(
        db as unknown as ChatBaseCommitDatabase,
        "chat-concurrent-backfill",
        {},
        dependencies,
      ),
    ])
    const storedBaseCommit = db
      .select({ baseCommit: chats.baseCommit })
      .from(chats)
      .where(eq(chats.id, "chat-concurrent-backfill"))
      .get()?.baseCommit

    expect(mergeBaseCalls).toBe(2)
    expect(new Set(results).size).toBe(1)
    expect(results[0]).toBe(storedBaseCommit)
    expect(["fork-commit-1", "fork-commit-2"]).toContain(storedBaseCommit)
    expect(totalChanges(db)).toBe(changesBefore + 1)
  })

  test("backfills from origin when only the remote base branch exists", async () => {
    const db = createAgentJobTestDb()
    const repositoryPath = mkdtempSync(join(tmpdir(), "locus-remote-base-"))
    temporaryRoots.push(repositoryPath)
    git(repositoryPath, ["init", "--quiet"])
    git(repositoryPath, ["config", "user.email", "test@example.com"])
    git(repositoryPath, ["config", "user.name", "Test User"])
    git(repositoryPath, ["commit", "--quiet", "--allow-empty", "-m", "base"])
    const baseCommit = git(repositoryPath, ["rev-parse", "HEAD"])
    git(repositoryPath, ["branch", "feature"])
    git(repositoryPath, ["update-ref", "refs/remotes/origin/main", baseCommit])
    git(repositoryPath, ["symbolic-ref", "HEAD", "refs/heads/feature"])
    git(repositoryPath, ["update-ref", "-d", "refs/heads/master"])
    git(repositoryPath, ["update-ref", "-d", "refs/heads/main"])
    seedChat(db, {
      id: "chat-remote-base",
      worktreePath: repositoryPath,
      baseBranch: "main",
    })

    const result = await ensureChatBaseCommit(
      db as unknown as ChatBaseCommitDatabase,
      "chat-remote-base",
    )

    expect(result).toBe(baseCommit)
    expect(
      db
        .select({ baseCommit: chats.baseCommit })
        .from(chats)
        .where(eq(chats.id, "chat-remote-base"))
        .get()?.baseCommit,
    ).toBe(baseCommit)
  })

  test("backfills from a local base branch when no matching remote ref exists", async () => {
    const db = createAgentJobTestDb()
    const repositoryPath = mkdtempSync(join(tmpdir(), "locus-local-base-"))
    temporaryRoots.push(repositoryPath)
    git(repositoryPath, ["init", "--quiet", "--initial-branch=main"])
    git(repositoryPath, ["config", "user.email", "test@example.com"])
    git(repositoryPath, ["config", "user.name", "Test User"])
    git(repositoryPath, ["commit", "--quiet", "--allow-empty", "-m", "base"])
    const baseCommit = git(repositoryPath, ["rev-parse", "HEAD"])
    git(repositoryPath, ["checkout", "--quiet", "-b", "feature"])
    git(repositoryPath, ["commit", "--quiet", "--allow-empty", "-m", "feature"])
    seedChat(db, {
      id: "chat-local-base",
      worktreePath: repositoryPath,
      baseBranch: "main",
    })

    const result = await ensureChatBaseCommit(
      db as unknown as ChatBaseCommitDatabase,
      "chat-local-base",
    )

    expect(result).toBe(baseCommit)
    expect(
      db
        .select({ baseCommit: chats.baseCommit })
        .from(chats)
        .where(eq(chats.id, "chat-local-base"))
        .get()?.baseCommit,
    ).toBe(baseCommit)
  })

  test("prefers a divergent local base branch when both local and remote refs exist", async () => {
    const db = createAgentJobTestDb()
    const repositoryPath = mkdtempSync(join(tmpdir(), "locus-diverged-base-"))
    temporaryRoots.push(repositoryPath)
    git(repositoryPath, ["init", "--quiet", "--initial-branch=main"])
    git(repositoryPath, ["config", "user.email", "test@example.com"])
    git(repositoryPath, ["config", "user.name", "Test User"])
    git(repositoryPath, [
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "remote base",
    ])
    const remoteBaseCommit = git(repositoryPath, ["rev-parse", "HEAD"])
    git(repositoryPath, [
      "update-ref",
      "refs/remotes/origin/main",
      remoteBaseCommit,
    ])
    git(repositoryPath, [
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "local base",
    ])
    const localBaseCommit = git(repositoryPath, ["rev-parse", "HEAD"])
    git(repositoryPath, ["checkout", "--quiet", "-b", "feature"])
    git(repositoryPath, ["commit", "--quiet", "--allow-empty", "-m", "feature"])
    seedChat(db, {
      id: "chat-diverged-local-base",
      worktreePath: repositoryPath,
      baseBranch: "main",
    })

    const result = await ensureChatBaseCommit(
      db as unknown as ChatBaseCommitDatabase,
      "chat-diverged-local-base",
    )

    expect(result).toBe(localBaseCommit)
    expect(result).not.toBe(remoteBaseCommit)
    expect(
      db
        .select({ baseCommit: chats.baseCommit })
        .from(chats)
        .where(eq(chats.id, "chat-diverged-local-base"))
        .get()?.baseCommit,
    ).toBe(localBaseCommit)
  })

  test("prefers a divergent remote fork when it is closer to the Workspace HEAD", async () => {
    const db = createAgentJobTestDb()
    const repositoryPath = mkdtempSync(join(tmpdir(), "locus-remote-fork-"))
    temporaryRoots.push(repositoryPath)
    git(repositoryPath, ["init", "--quiet", "--initial-branch=main"])
    git(repositoryPath, ["config", "user.email", "test@example.com"])
    git(repositoryPath, ["config", "user.name", "Test User"])
    git(repositoryPath, ["commit", "--quiet", "--allow-empty", "-m", "root"])
    const rootCommit = git(repositoryPath, ["rev-parse", "HEAD"])
    git(repositoryPath, [
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "local base",
    ])
    git(repositoryPath, [
      "checkout",
      "--quiet",
      "-b",
      "remote-main",
      rootCommit,
    ])
    git(repositoryPath, [
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "remote base",
    ])
    const remoteBaseCommit = git(repositoryPath, ["rev-parse", "HEAD"])
    git(repositoryPath, [
      "update-ref",
      "refs/remotes/origin/main",
      remoteBaseCommit,
    ])
    git(repositoryPath, ["checkout", "--quiet", "-b", "feature"])
    git(repositoryPath, ["commit", "--quiet", "--allow-empty", "-m", "feature"])
    seedChat(db, {
      id: "chat-diverged-remote-base",
      worktreePath: repositoryPath,
      baseBranch: "main",
    })

    const result = await ensureChatBaseCommit(
      db as unknown as ChatBaseCommitDatabase,
      "chat-diverged-remote-base",
    )

    expect(result).toBe(remoteBaseCommit)
    expect(
      db
        .select({ baseCommit: chats.baseCommit })
        .from(chats)
        .where(eq(chats.id, "chat-diverged-remote-base"))
        .get()?.baseCommit,
    ).toBe(remoteBaseCommit)
  })

  test("degrades without persisting when divergent candidates are equally close", async () => {
    const db = createAgentJobTestDb()
    seedChat(db, {
      id: "chat-ambiguous-base",
      worktreePath: "/tmp/project-worktree",
      baseBranch: "main",
    })

    const result = await ensureChatBaseCommit(
      db as unknown as ChatBaseCommitDatabase,
      "chat-ambiguous-base",
      {},
      {
        refExistsLocally: async () => true,
        getMergeBase: async (_worktreePath, baseRef) =>
          baseRef === "main" ? "local-candidate" : "remote-candidate",
        getCommitDistance: async () => 2,
      },
    )

    expect(result).toBeNull()
    expect(
      db
        .select({ baseCommit: chats.baseCommit })
        .from(chats)
        .where(eq(chats.id, "chat-ambiguous-base"))
        .get()?.baseCommit,
    ).toBeNull()
  })

  test("returns null when the worktree is missing without invoking git", async () => {
    const db = createAgentJobTestDb()
    seedChat(db, { id: "chat-no-worktree", baseBranch: "main" })
    let gitCalls = 0

    const result = await ensureChatBaseCommit(
      db as unknown as ChatBaseCommitDatabase,
      "chat-no-worktree",
      {},
      {
        getMergeBase: async () => {
          gitCalls += 1
          return "unexpected"
        },
      },
    )

    expect(result).toBeNull()
    expect(gitCalls).toBe(0)
  })

  test("returns null when the base branch is unset without invoking git", async () => {
    const db = createAgentJobTestDb()
    seedChat(db, {
      id: "chat-no-base-branch",
      worktreePath: "/tmp/project-worktree",
    })
    let gitCalls = 0

    const result = await ensureChatBaseCommit(
      db as unknown as ChatBaseCommitDatabase,
      "chat-no-base-branch",
      {},
      {
        getMergeBase: async () => {
          gitCalls += 1
          return "unexpected"
        },
      },
    )

    expect(result).toBeNull()
    expect(gitCalls).toBe(0)
  })

  test("returns null without throwing when merge-base fails", async () => {
    const db = createAgentJobTestDb()
    seedChat(db, {
      id: "chat-merge-base-failure",
      worktreePath: "/tmp/missing-worktree",
      baseBranch: "main",
    })

    await expect(
      ensureChatBaseCommit(
        db as unknown as ChatBaseCommitDatabase,
        "chat-merge-base-failure",
        {},
        {
          refExistsLocally: async () => false,
          getMergeBase: async () => {
            throw new Error("merge-base failed")
          },
        },
      ),
    ).resolves.toBeNull()
    expect(
      db
        .select({ baseCommit: chats.baseCommit })
        .from(chats)
        .where(eq(chats.id, "chat-merge-base-failure"))
        .get()?.baseCommit,
    ).toBeNull()
  })

  test("forwards one request cancellation budget to every backfill Git operation", async () => {
    const db = createAgentJobTestDb()
    seedChat(db, {
      id: "chat-forward-budget",
      worktreePath: "/tmp/project-worktree",
      baseBranch: "main",
    })
    const controller = new AbortController()
    const options: ChatBaseCommitOperationOptions = {
      signal: controller.signal,
      timeoutMs: 321,
    }
    const observed: Array<{
      operation: string
      options: ChatBaseCommitOperationOptions | undefined
    }> = []

    const result = await ensureChatBaseCommit(
      db as unknown as ChatBaseCommitDatabase,
      "chat-forward-budget",
      options,
      {
        getMergeBase: async (_worktreePath, baseRef, operationOptions) => {
          observed.push({
            operation: `merge-base:${baseRef}`,
            options: operationOptions,
          })
          return baseRef === "main" ? "local-candidate" : "remote-candidate"
        },
        refExistsLocally: async (
          _worktreePath,
          remoteRef,
          operationOptions,
        ) => {
          observed.push({
            operation: `ref-exists:${remoteRef}`,
            options: operationOptions,
          })
          return true
        },
        getCommitDistance: async (
          _worktreePath,
          candidate,
          operationOptions,
        ) => {
          observed.push({
            operation: `distance:${candidate}`,
            options: operationOptions,
          })
          return candidate === "local-candidate" ? 1 : 2
        },
      },
    )

    expect(result).toBe("local-candidate")
    expect(observed.map(({ operation }) => operation)).toEqual([
      "merge-base:main",
      "ref-exists:origin/main",
      "merge-base:origin/main",
      "distance:local-candidate",
      "distance:remote-candidate",
    ])
    for (const observation of observed) {
      expect(observation.options).toBe(options)
      expect(observation.options?.signal).toBe(controller.signal)
      expect(observation.options?.timeoutMs).toBe(321)
    }
  })

  test("does not persist a late backfill result after request cancellation", async () => {
    const db = createAgentJobTestDb()
    seedChat(db, {
      id: "chat-aborted-backfill",
      worktreePath: "/tmp/project-worktree",
      baseBranch: "main",
    })
    const controller = new AbortController()
    let resolveMergeBase!: (value: string) => void
    let markMergeBaseStarted!: () => void
    const mergeBaseStarted = new Promise<void>((resolve) => {
      markMergeBaseStarted = resolve
    })
    const lateMergeBase = new Promise<string>((resolve) => {
      resolveMergeBase = resolve
    })
    const changesBefore = totalChanges(db)

    const resultPromise = ensureChatBaseCommit(
      db as unknown as ChatBaseCommitDatabase,
      "chat-aborted-backfill",
      { signal: controller.signal, timeoutMs: 25 },
      {
        getMergeBase: async () => {
          markMergeBaseStarted()
          // Deliberately ignore the AbortSignal to model an injected or legacy
          // dependency that resolves after the request deadline.
          return lateMergeBase
        },
        refExistsLocally: async () => false,
      },
    )

    await mergeBaseStarted
    controller.abort()
    resolveMergeBase("late-fork-commit")

    await expect(resultPromise).resolves.toBeNull()
    expect(totalChanges(db)).toBe(changesBefore)
    expect(
      db
        .select({ baseCommit: chats.baseCommit })
        .from(chats)
        .where(eq(chats.id, "chat-aborted-backfill"))
        .get()?.baseCommit,
    ).toBeNull()
  })
})
