/**
 * Regression tests for `openspec/changes/fix-default-branch-resolution-local-repos`.
 *
 * Written test-first from the spec scenarios in
 * `specs/git-default-branch-resolution/spec.md`. Every assertion goes through
 * an existing observable entry point (tRPC `changes.getBranches`,
 * `cleanupOrphanedBranches`, `createWorktreeForChat`, `getWorktreeDiff`,
 * `ensureChatBaseCommit`, and the Agent Workbench `listTasks`/`checkConflicts`
 * procedures). Fixture repositories always name their initial branch
 * explicitly so the host `init.defaultBranch` never influences the outcome.
 *
 * The "preserved behavior" group intentionally describes scenarios the spec
 * marks as unchanged (configured `origin`, explicit overrides, degenerate
 * fallback). Those are characterization guards and are expected to pass both
 * before and after the implementation; see `red-receipt.md`.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { execFileSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { eq } from "drizzle-orm"
import * as schema from "../src/main/lib/db/schema"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

let testDb = createAgentJobTestDb()
let testRoot = ""

mock.module("electron", () => ({
  BrowserWindow: class BrowserWindow {},
}))

mock.module("../src/main/lib/db", () => ({
  ...schema,
  getDatabase: () => testDb,
}))

const { agentWorkbenchRouter } = await import(
  "../src/main/lib/trpc/routers/agent-workbench"
)
const { createBranchesRouter } = await import("../src/main/lib/git/branches")
const { createWorktreeForChat, getWorktreeDiff } = await import(
  "../src/main/lib/git/worktree"
)
const { ensureChatBaseCommit } = await import(
  "../src/main/lib/chat-base-commit"
)

const WORKTREE_TEST_TIMEOUT_MS = 60_000

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    encoding: "utf8",
  }).trim()
}

function headSha(cwd: string): string {
  return git(cwd, ["rev-parse", "HEAD"])
}

function commitFile(
  cwd: string,
  relativePath: string,
  content: string,
  message: string,
): string {
  mkdirSync(join(cwd, relativePath, ".."), { recursive: true })
  writeFileSync(join(cwd, relativePath), content)
  git(cwd, ["add", relativePath])
  git(cwd, ["commit", "--quiet", "-m", message])
  return headSha(cwd)
}

/**
 * Creates a repository whose initial branch is named explicitly and which has
 * no remote configured at all. The caller owns any further branch layout.
 */
function initRepository(name: string, initialBranch: string): string {
  const repositoryPath = join(testRoot, name)
  mkdirSync(repositoryPath, { recursive: true })
  git(repositoryPath, ["init", "--quiet", "-b", initialBranch])
  git(repositoryPath, ["config", "user.email", "test@example.com"])
  git(repositoryPath, ["config", "user.name", "Test User"])
  commitFile(
    repositoryPath,
    "src/shared.ts",
    "export const value = 1\n",
    "initial",
  )
  expect(git(repositoryPath, ["remote"])).toBe("")
  return repositoryPath
}

function addLinkedWorktree(
  repositoryPath: string,
  name: string,
  branch: string,
  startPoint: string,
): string {
  const worktreePath = join(testRoot, name)
  git(repositoryPath, [
    "worktree",
    "add",
    "--quiet",
    "-b",
    branch,
    worktreePath,
    startPoint,
  ])
  return worktreePath
}

function seedProject(id: string, path: string): void {
  testDb.insert(schema.projects).values({ id, name: id, path }).run()
}

function seedWorkspace(input: {
  id: string
  projectId: string
  worktreePath: string
  branch: string
  baseBranch: string
  baseCommit?: string | null
}): void {
  testDb
    .insert(schema.chats)
    .values({
      id: input.id,
      name: input.id,
      projectId: input.projectId,
      worktreePath: input.worktreePath,
      branch: input.branch,
      baseBranch: input.baseBranch,
      baseCommit: input.baseCommit ?? null,
      createdAt: new Date("2026-09-05T00:00:00.000Z"),
      updatedAt: new Date("2026-09-05T00:00:00.000Z"),
    })
    .run()
}

function storedBaseCommit(chatId: string): string | null {
  return (
    testDb
      .select({ baseCommit: schema.chats.baseCommit })
      .from(schema.chats)
      .where(eq(schema.chats.id, chatId))
      .get()?.baseCommit ?? null
  )
}

function branchesCaller() {
  return createBranchesRouter().createCaller({ getWindow: () => null })
}

function workbenchCaller() {
  return agentWorkbenchRouter.createCaller({ getWindow: () => null })
}

/**
 * Resolves the default branch the way the renderer observes it: through the
 * registered-project `changes.getBranches` route. Registration is required by
 * the route's security boundary, so the project is seeded first.
 */
async function listedDefaultBranch(
  projectId: string,
  repositoryPath: string,
): Promise<string> {
  seedProject(projectId, repositoryPath)
  const branches = await branchesCaller().getBranches({
    worktreePath: repositoryPath,
  })
  return branches.defaultBranch
}

beforeEach(() => {
  testDb = createAgentJobTestDb()
  testRoot = mkdtempSync(join(tmpdir(), "locus-default-branch-"))
})

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

describe("no-origin default branch resolution: branch listing consumer", () => {
  test("no-origin master repository lists master as its default branch and cleanup keeps it", async () => {
    // Scenario: Local master wins when main is absent
    // Scenario: Branch listing and cleanup agree on a local default
    const repositoryPath = initRepository("master-only", "master")
    git(repositoryPath, ["branch", "clever-fox-a1b2"])
    seedProject("project-master-only", repositoryPath)
    const caller = branchesCaller()

    const branches = await caller.getBranches({ worktreePath: repositoryPath })

    expect(branches.local.map((entry) => entry.branch)).toContain("master")
    expect(branches.local.map((entry) => entry.branch)).not.toContain("main")
    expect(branches.remote).toEqual([])
    expect(branches.defaultBranch).toBe("master")

    const cleanup = await caller.cleanupOrphanedBranches({
      worktreePath: repositoryPath,
      dryRun: true,
    })
    expect(cleanup.orphanedBranches).toEqual(["clever-fox-a1b2"])
    expect(cleanup.orphanedBranches).not.toContain("master")
    expect(cleanup.deleted).toEqual([])
    expect(git(repositoryPath, ["branch", "--list", "master"])).not.toBe("")
  })

  test("attached HEAD is listed as the default when neither main nor master exists", async () => {
    // Scenario: Attached HEAD is the last usable local branch
    const repositoryPath = initRepository("feature-only", "feature/topic")
    git(repositoryPath, ["branch", "another-branch"])

    const defaultBranch = await listedDefaultBranch(
      "project-feature-only",
      repositoryPath,
    )

    expect(defaultBranch).toBe("feature/topic")
    expect(["main", "master"]).not.toContain(defaultBranch)
  })
})

describe("no-origin default branch resolution: Workspace creation consumer", () => {
  test(
    "auto-detected Workspace starts from local master and retains its fork commit",
    async () => {
      // Scenario: Auto-detected local Workspace retains its fork
      // Scenario: No-origin master Workspace retains a recoverable base
      const repositoryPath = initRepository("master-checkout-feature", "master")
      const masterSha = headSha(repositoryPath)
      git(repositoryPath, ["checkout", "--quiet", "-b", "feature"])
      const featureSha = commitFile(
        repositoryPath,
        "src/feature.ts",
        "export const feature = true\n",
        "feature work",
      )
      expect(featureSha).not.toBe(masterSha)
      const worktreesDir = join(testRoot, "worktrees")

      const result = await createWorktreeForChat(
        repositoryPath,
        "master-checkout-feature",
        "chat-auto-master",
        undefined,
        undefined,
        { worktreesDir },
      )

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
      expect(result.baseBranch).toBe("master")
      expect(result.baseCommit).toBe(masterSha)
      expect(result.worktreePath).toBeString()
      if (!result.worktreePath) throw new Error("Expected a worktree path")
      expect(headSha(result.worktreePath)).toBe(masterSha)
      // The start point must have been the local ref: no origin/* ref exists.
      expect(git(repositoryPath, ["for-each-ref", "refs/remotes/"])).toBe("")
    },
    WORKTREE_TEST_TIMEOUT_MS,
  )

  test(
    "local main wins over master and the checked-out branch for auto-detected Workspaces",
    async () => {
      // Scenario: Local main wins independently of checkout state
      const repositoryPath = initRepository("main-and-master", "master")
      const masterSha = headSha(repositoryPath)
      git(repositoryPath, ["checkout", "--quiet", "-b", "main"])
      const mainSha = commitFile(
        repositoryPath,
        "src/main-only.ts",
        "export const main = true\n",
        "main work",
      )
      git(repositoryPath, ["checkout", "--quiet", "-b", "feature", "master"])
      const featureSha = commitFile(
        repositoryPath,
        "src/feature.ts",
        "export const feature = true\n",
        "feature work",
      )
      expect(new Set([masterSha, mainSha, featureSha]).size).toBe(3)
      const worktreesDir = join(testRoot, "worktrees")

      const result = await createWorktreeForChat(
        repositoryPath,
        "main-and-master",
        "chat-auto-main",
        undefined,
        undefined,
        { worktreesDir },
      )

      expect(result.success).toBe(true)
      expect(result.baseBranch).toBe("main")
      expect(result.baseCommit).toBe(mainSha)
      if (!result.worktreePath) throw new Error("Expected a worktree path")
      expect(headSha(result.worktreePath)).toBe(mainSha)

      const listed = await listedDefaultBranch(
        "project-main-and-master",
        repositoryPath,
      )
      expect(listed).toBe("main")
    },
    WORKTREE_TEST_TIMEOUT_MS,
  )

  test(
    "attached HEAD becomes the Workspace base when neither main nor master exists",
    async () => {
      // Scenario: Attached HEAD is the last usable local branch (creation consumer)
      const repositoryPath = initRepository("trunk-only", "trunk")
      const trunkSha = headSha(repositoryPath)
      const worktreesDir = join(testRoot, "worktrees")

      const result = await createWorktreeForChat(
        repositoryPath,
        "trunk-only",
        "chat-auto-trunk",
        undefined,
        undefined,
        { worktreesDir },
      )

      expect(result.success).toBe(true)
      expect(result.baseBranch).toBe("trunk")
      expect(result.baseCommit).toBe(trunkSha)

      const listed = await listedDefaultBranch(
        "project-trunk-only",
        repositoryPath,
      )
      expect(listed).toBe("trunk")
    },
    WORKTREE_TEST_TIMEOUT_MS,
  )
})

describe("no-origin default branch resolution: clean-worktree diff consumer", () => {
  test("clean linked worktree diffs against local master when no base is supplied", async () => {
    // Scenario: Default Branch Consumers Preserve Local Workspace Evidence
    // (clean-worktree diff helper consumes the canonical local result)
    const repositoryPath = initRepository("diff-master", "master")
    const worktreePath = addLinkedWorktree(
      repositoryPath,
      "diff-master-worktree",
      "locus/diff-master",
      "master",
    )
    commitFile(
      worktreePath,
      "src/shared.ts",
      "export const value = 'workspace'\n",
      "workspace change",
    )
    expect(git(worktreePath, ["status", "--porcelain"])).toBe("")

    const result = await getWorktreeDiff(worktreePath)

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
    expect(result.diff).toContain("diff --git a/src/shared.ts b/src/shared.ts")
    expect(result.diff).toContain("+export const value = 'workspace'")
  })

  test("clean linked worktree diffs against local main rather than master or its own branch", async () => {
    // Scenario: Local main wins independently of checkout state (diff consumer)
    const repositoryPath = initRepository("diff-main", "master")
    git(repositoryPath, ["checkout", "--quiet", "-b", "main"])
    commitFile(
      repositoryPath,
      "src/main-only.ts",
      "export const main = true\n",
      "main work",
    )
    git(repositoryPath, ["checkout", "--quiet", "master"])
    const worktreePath = addLinkedWorktree(
      repositoryPath,
      "diff-main-worktree",
      "locus/diff-main",
      "main",
    )
    commitFile(
      worktreePath,
      "src/workspace.ts",
      "export const workspace = true\n",
      "workspace change",
    )

    const result = await getWorktreeDiff(worktreePath)

    expect(result.success).toBe(true)
    expect(result.diff).toContain(
      "diff --git a/src/workspace.ts b/src/workspace.ts",
    )
    // A master baseline would also include main's own commit; the spec says
    // main wins, so the diff must be scoped to the Workspace's change only.
    expect(result.diff).not.toContain("src/main-only.ts")
  })
})

describe("no-origin master Workspaces keep a recoverable base (CI event)", () => {
  test("lazy fork-commit backfill resolves merge-base against the listed local default", async () => {
    // Scenario: No-origin master Workspace retains a recoverable base
    // (fork metadata absent -> backfill uses the resolved base branch)
    const repositoryPath = initRepository("backfill-master", "master")
    const forkSha = headSha(repositoryPath)
    const worktreePath = addLinkedWorktree(
      repositoryPath,
      "backfill-worktree",
      "locus/backfill",
      "master",
    )
    commitFile(
      worktreePath,
      "src/shared.ts",
      "export const value = 'backfill'\n",
      "workspace change",
    )
    const baseBranch = await listedDefaultBranch(
      "project-backfill",
      repositoryPath,
    )
    seedWorkspace({
      id: "chat-backfill",
      projectId: "project-backfill",
      worktreePath,
      branch: "locus/backfill",
      baseBranch,
      baseCommit: null,
    })

    const result = await ensureChatBaseCommit(testDb, "chat-backfill")

    expect(result).toBe(forkSha)
    expect(storedBaseCommit("chat-backfill")).toBe(forkSha)
    expect(baseBranch).toBe("master")
  })

  test("deep check on committed-only no-origin master Workspaces reaches head-commits-differ", async () => {
    // Scenario: No-origin master Workspace retains a recoverable base
    // Design Decision 6 acceptance: listing stays annotation-free, deep check
    // stays eligible, backfill converges on the shared master fork, hunk
    // comparison reports head-commits-differ (never base-commit-missing), and
    // the committed-tree trial is reached.
    const repositoryPath = initRepository("ci-master", "master")
    const forkSha = headSha(repositoryPath)
    const firstWorktree = addLinkedWorktree(
      repositoryPath,
      "ci-worktree-a",
      "locus/ci-a",
      "master",
    )
    const secondWorktree = addLinkedWorktree(
      repositoryPath,
      "ci-worktree-b",
      "locus/ci-b",
      "master",
    )
    const baseBranch = await listedDefaultBranch("ci-project", repositoryPath)
    seedWorkspace({
      id: "ci-a",
      projectId: "ci-project",
      worktreePath: firstWorktree,
      branch: "locus/ci-a",
      baseBranch,
      baseCommit: null,
    })
    seedWorkspace({
      id: "ci-b",
      projectId: "ci-project",
      worktreePath: secondWorktree,
      branch: "locus/ci-b",
      baseBranch,
      baseCommit: null,
    })
    commitFile(firstWorktree, "src/shared.ts", "first commit\n", "first change")
    commitFile(
      secondWorktree,
      "src/shared.ts",
      "second commit\n",
      "second change",
    )

    const caller = workbenchCaller()
    const listed = await caller.listTasks({ filter: "all" })
    expect(listed.tasks.every((task) => task.conflicts.length === 0)).toBe(true)
    expect(listed.tasks.every((task) => task.diff.fileCount === 0)).toBe(true)
    expect(listed.eligibleDeepCheckTaskIdsByTaskId).toEqual({
      "ci-a": ["ci-a", "ci-b"],
      "ci-b": ["ci-b", "ci-a"],
    })

    const verdict = await caller.checkConflicts({ taskIds: ["ci-a", "ci-b"] })

    expect(verdict.pairs).toHaveLength(1)
    expect(verdict.pairs[0]?.pathWarnings).toEqual([])
    expect(verdict.pairs[0]?.hunkCheck).toEqual({
      status: "unavailable",
      reason: "head-commits-differ",
    })
    expect(storedBaseCommit("ci-a")).toBe(forkSha)
    expect(storedBaseCommit("ci-b")).toBe(forkSha)
    expect(verdict.pairs[0]?.mergeTrial.scope).toBe("committed-changes-only")
    if (verdict.capability.available) {
      expect(verdict.pairs[0]?.mergeTrial).toEqual({
        scope: "committed-changes-only",
        status: "conflict",
        reason: null,
        conflictPaths: ["src/shared.ts"],
      })
    } else {
      expect(verdict.pairs[0]?.mergeTrial).toEqual({
        scope: "committed-changes-only",
        status: "unavailable",
        reason: verdict.capability.reason,
        conflictPaths: [],
      })
    }
    expect(baseBranch).toBe("master")
  })

  test(
    "Workspaces auto-created from a no-origin master repository keep fork metadata through the deep check",
    async () => {
      // Scenario: No-origin master Workspace retains a recoverable base
      // (successful creation retains the exact fork commit; the deep check
      // then works without any backfill).
      const repositoryPath = initRepository("created-master", "master")
      const forkSha = headSha(repositoryPath)
      git(repositoryPath, ["checkout", "--quiet", "-b", "feature"])
      commitFile(
        repositoryPath,
        "src/feature.ts",
        "export const feature = true\n",
        "feature work",
      )
      const worktreesDir = join(testRoot, "worktrees")
      seedProject("created-project", repositoryPath)

      const created = await Promise.all(
        ["created-a", "created-b"].map((chatId) =>
          createWorktreeForChat(
            repositoryPath,
            "created-master",
            chatId,
            undefined,
            undefined,
            { worktreesDir },
          ),
        ),
      )

      for (const [index, result] of created.entries()) {
        expect(result.success).toBe(true)
        expect(result.baseBranch).toBe("master")
        expect(result.baseCommit).toBe(forkSha)
        if (!result.worktreePath || !result.branch || !result.baseBranch)
          throw new Error("Expected a created worktree")
        seedWorkspace({
          id: index === 0 ? "created-a" : "created-b",
          projectId: "created-project",
          worktreePath: result.worktreePath,
          branch: result.branch,
          baseBranch: result.baseBranch,
          baseCommit: result.baseCommit,
        })
        commitFile(
          result.worktreePath,
          "src/shared.ts",
          `export const value = ${index + 2}\n`,
          `change ${index}`,
        )
      }

      const verdict = await workbenchCaller().checkConflicts({
        taskIds: ["created-a", "created-b"],
      })

      expect(verdict.pairs[0]?.hunkCheck).toEqual({
        status: "unavailable",
        reason: "head-commits-differ",
      })
      expect(storedBaseCommit("created-a")).toBe(forkSha)
      expect(storedBaseCommit("created-b")).toBe(forkSha)
      expect(verdict.pairs[0]?.mergeTrial.scope).toBe("committed-changes-only")
    },
    WORKTREE_TEST_TIMEOUT_MS,
  )
})

describe("canonical owner contract", () => {
  test("a single main-process resolver module owns default-branch policy", async () => {
    // Requirement: one canonical owner at src/main/lib/git/default-branch.ts
    // exporting resolveDefaultBranch (proposal "Canonical Owner And
    // Single-Path Statement"). The call signature is an implementation
    // detail and is intentionally not asserted here.
    const module = (await import(
      "../src/main/lib/git/default-branch"
    )) as Record<string, unknown>
    expect(typeof module.resolveDefaultBranch).toBe("function")
  })

  test("the two legacy getDefaultBranch helpers are deleted from their consumers", () => {
    // Requirement: Main-process routes and Git helpers SHALL NOT implement a
    // second local default-branch precedence policy; both prior helpers are
    // removed in the same change that migrates their callers.
    const branchesSource = readFileSync(
      join(import.meta.dir, "../src/main/lib/git/branches.ts"),
      "utf8",
    )
    const worktreeSource = readFileSync(
      join(import.meta.dir, "../src/main/lib/git/worktree.ts"),
      "utf8",
    )
    const legacyHelperDefinition = /function\s+getDefaultBranch\s*\(/
    expect({
      branchesDefinesGetDefaultBranch:
        legacyHelperDefinition.test(branchesSource),
      worktreeDefinesGetDefaultBranch:
        legacyHelperDefinition.test(worktreeSource),
    }).toEqual({
      branchesDefinesGetDefaultBranch: false,
      worktreeDefinesGetDefaultBranch: false,
    })
  })
})

describe("preserved behavior (characterization; expected to pass before and after)", () => {
  test(
    "configured origin keeps origin/HEAD precedence over local main and master",
    async () => {
      // Scenario: Configured origin preserves each consumer profile
      const repositoryPath = initRepository("origin-head", "master")
      const developSha = headSha(repositoryPath)
      git(repositoryPath, ["branch", "main"])
      git(repositoryPath, ["checkout", "--quiet", "-b", "feature"])
      const remotePath = join(testRoot, "origin-head-remote.git")
      git(testRoot, ["init", "--quiet", "--bare", "-b", "develop", remotePath])
      git(repositoryPath, ["remote", "add", "origin", remotePath])
      git(repositoryPath, [
        "update-ref",
        "refs/remotes/origin/develop",
        developSha,
      ])
      git(repositoryPath, [
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
        "refs/remotes/origin/develop",
      ])

      const listed = await listedDefaultBranch(
        "project-origin-head",
        repositoryPath,
      )
      expect(listed).toBe("develop")

      const result = await createWorktreeForChat(
        repositoryPath,
        "origin-head",
        "chat-origin-head",
        undefined,
        undefined,
        { worktreesDir: join(testRoot, "worktrees") },
      )
      expect(result.success).toBe(true)
      expect(result.baseBranch).toBe("develop")
      expect(result.baseCommit).toBe(developSha)
    },
    WORKTREE_TEST_TIMEOUT_MS,
  )

  test("configured origin without cached remote facts does not fall into local precedence", async () => {
    // Scenario: Configured origin preserves each consumer profile
    // (no consumer activates the no-origin local precedence merely because
    // cached remote facts are missing)
    const repositoryPath = initRepository("origin-unfetched", "master")
    git(repositoryPath, ["checkout", "--quiet", "-b", "feature"])
    const remotePath = join(testRoot, "origin-unfetched-remote.git")
    git(testRoot, ["init", "--quiet", "--bare", "-b", "develop", remotePath])
    git(repositoryPath, ["remote", "add", "origin", remotePath])
    expect(git(repositoryPath, ["for-each-ref", "refs/remotes/"])).toBe("")

    const listed = await listedDefaultBranch(
      "project-origin-unfetched",
      repositoryPath,
    )

    expect(listed).toBe("main")
  })

  test("degenerate detached no-origin repository keeps the compatibility fallback", async () => {
    // Scenario: Degenerate local repository retains an honest fallback
    const repositoryPath = initRepository("detached", "feature")
    git(repositoryPath, ["checkout", "--quiet", "--detach"])
    git(repositoryPath, ["branch", "-D", "feature"])
    expect(git(repositoryPath, ["for-each-ref", "refs/heads/"])).toBe("")

    const listed = await listedDefaultBranch("project-detached", repositoryPath)

    expect(listed).toBe("main")
  })

  test(
    "explicit base branch and uncommitted-only diff gates stay authoritative",
    async () => {
      // Scenario: Explicit branch and diff gates remain authoritative
      const repositoryPath = initRepository("explicit-gates", "master")
      const masterSha = headSha(repositoryPath)
      git(repositoryPath, ["checkout", "--quiet", "-b", "main"])
      commitFile(
        repositoryPath,
        "src/main-only.ts",
        "export const main = true\n",
        "main work",
      )
      git(repositoryPath, ["checkout", "--quiet", "master"])
      const worktreePath = addLinkedWorktree(
        repositoryPath,
        "explicit-gates-worktree",
        "locus/explicit",
        "main",
      )
      commitFile(
        worktreePath,
        "src/workspace.ts",
        "export const workspace = true\n",
        "workspace change",
      )

      const explicitDiff = await getWorktreeDiff(worktreePath, "master")
      expect(explicitDiff.success).toBe(true)
      expect(explicitDiff.diff).toContain("src/main-only.ts")
      expect(explicitDiff.diff).toContain("src/workspace.ts")

      const uncommittedOnly = await getWorktreeDiff(worktreePath, undefined, {
        onlyUncommitted: true,
      })
      expect(uncommittedOnly).toEqual({ success: true, diff: "" })

      const explicitCreate = await createWorktreeForChat(
        repositoryPath,
        "explicit-gates",
        "chat-explicit",
        "master",
        "local",
        { worktreesDir: join(testRoot, "worktrees") },
      )
      expect(explicitCreate.success).toBe(true)
      expect(explicitCreate.baseBranch).toBe("master")
      expect(explicitCreate.baseCommit).toBe(masterSha)
    },
    WORKTREE_TEST_TIMEOUT_MS,
  )
})
