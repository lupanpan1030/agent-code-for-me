import { afterEach, describe, expect, mock, test } from "bun:test"
import { execFileSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { simpleGit } from "simple-git"
import * as schema from "../src/main/lib/db/schema"
import { resolveDefaultBranch } from "../src/main/lib/git/default-branch"

mock.module("electron", () => ({
  BrowserWindow: class BrowserWindow {},
}))

mock.module("../src/main/lib/db", () => ({
  ...schema,
  getDatabase: () => {
    throw new Error("Database access is not expected in this unit test")
  },
}))

const { buildCleanupProtectedBranches } = await import(
  "../src/main/lib/git/branches"
)
const { createWorktreeForChat, getWorktreeDiff } = await import(
  "../src/main/lib/git/worktree"
)

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

type GitFixtureOptions = {
  remotes?: string[]
  localBranches?: string[]
  currentBranch?: string
  cachedOriginHead?: string
  remoteBranches?: string[]
  remoteHead?: string
  remoteHeadFailure?: boolean
}

function createGitFixture(options: GitFixtureOptions = {}) {
  const rawCalls: string[][] = []
  const branchCalls: string[][] = []

  const git = {
    async getRemotes() {
      return (options.remotes ?? []).map((name) => ({ name }))
    },
    async raw(commands: string[]) {
      rawCalls.push(commands)

      if (commands[0] === "for-each-ref") {
        return (options.localBranches ?? [])
          .map((branch) => `refs/heads/${branch}`)
          .join("\n")
      }

      if (
        commands[0] === "symbolic-ref" &&
        commands[1] === "refs/remotes/origin/HEAD"
      ) {
        if (!options.cachedOriginHead) {
          throw new Error("origin/HEAD is not cached")
        }
        return `refs/remotes/origin/${options.cachedOriginHead}\n`
      }

      if (commands[0] === "symbolic-ref" && commands.includes("HEAD")) {
        if (!options.currentBranch) {
          throw new Error("HEAD is detached")
        }
        return `refs/heads/${options.currentBranch}\n`
      }

      if (commands[0] === "ls-remote") {
        if (options.remoteHeadFailure) {
          throw new Error("origin is unavailable")
        }
        return options.remoteHead
          ? `ref: refs/heads/${options.remoteHead}\tHEAD\n`
          : "malformed response\n"
      }

      throw new Error(`Unexpected git raw call: ${commands.join(" ")}`)
    },
    async branch(commands: string[]) {
      branchCalls.push(commands)
      return {
        all: (options.remoteBranches ?? []).map((branch) =>
          branch.startsWith("origin/") ? branch : `origin/${branch}`,
        ),
      }
    },
  }

  return {
    git,
    rawCalls,
    branchCalls,
    networkCalls: () =>
      rawCalls.filter((commands) => commands[0] === "ls-remote"),
  }
}

describe("canonical local default-branch precedence and provenance", () => {
  test("local main wins over master and the attached current branch", async () => {
    const fixture = createGitFixture({
      localBranches: ["feature/topic", "master", "main"],
      currentBranch: "feature/topic",
    })

    await expect(
      resolveDefaultBranch(fixture.git, { profile: "worktree" }),
    ).resolves.toEqual({ branch: "main", source: "local" })
    expect(fixture.networkCalls()).toEqual([])
  })

  test("local master wins when main is absent", async () => {
    const fixture = createGitFixture({
      localBranches: ["feature/topic", "master"],
      currentBranch: "feature/topic",
    })

    await expect(
      resolveDefaultBranch(fixture.git, { profile: "worktree" }),
    ).resolves.toEqual({ branch: "master", source: "local" })
    expect(fixture.networkCalls()).toEqual([])
  })

  test("the attached current branch wins only after main and master", async () => {
    const fixture = createGitFixture({
      localBranches: ["feature/other", "feature/topic"],
      currentBranch: "feature/topic",
    })

    await expect(
      resolveDefaultBranch(fixture.git, { profile: "worktree" }),
    ).resolves.toEqual({ branch: "feature/topic", source: "local" })
  })

  test("detached HEAD with no local refs uses an honest fallback", async () => {
    const fixture = createGitFixture()

    await expect(
      resolveDefaultBranch(fixture.git, { profile: "worktree" }),
    ).resolves.toEqual({ branch: "main", source: "fallback" })
  })

  test("an unborn attached HEAD is not claimed as an existing local ref", async () => {
    const fixture = createGitFixture({ currentBranch: "feature/unborn" })

    await expect(
      resolveDefaultBranch(fixture.git, { profile: "worktree" }),
    ).resolves.toEqual({ branch: "main", source: "fallback" })
  })

  test("a non-origin remote does not activate origin-backed precedence", async () => {
    const fixture = createGitFixture({
      remotes: ["upstream"],
      localBranches: ["master"],
      currentBranch: "master",
      remoteBranches: ["main"],
      remoteHead: "develop",
    })

    await expect(
      resolveDefaultBranch(fixture.git, { profile: "worktree" }),
    ).resolves.toEqual({ branch: "master", source: "local" })
    expect(fixture.branchCalls).toEqual([])
    expect(fixture.networkCalls()).toEqual([])
  })
})

describe("configured-origin observation profiles", () => {
  test("branch listing prefers cached origin/HEAD without network work", async () => {
    const fixture = createGitFixture({
      remotes: ["origin"],
      cachedOriginHead: "develop",
    })

    await expect(
      resolveDefaultBranch(fixture.git, {
        profile: "branch-listing",
        remoteBranches: ["main", "master"],
      }),
    ).resolves.toEqual({ branch: "develop", source: "remote" })
    expect(fixture.networkCalls()).toEqual([])
  })

  test("branch listing preserves cached main and master compatibility", async () => {
    const masterOnly = createGitFixture({ remotes: ["origin"] })
    const mainAndMaster = createGitFixture({ remotes: ["origin"] })

    await expect(
      resolveDefaultBranch(masterOnly.git, {
        profile: "branch-listing",
        remoteBranches: ["master"],
      }),
    ).resolves.toEqual({ branch: "master", source: "remote" })
    await expect(
      resolveDefaultBranch(mainAndMaster.git, {
        profile: "branch-listing",
        remoteBranches: ["master", "main"],
      }),
    ).resolves.toEqual({ branch: "main", source: "remote" })
    expect(masterOnly.networkCalls()).toEqual([])
    expect(mainAndMaster.networkCalls()).toEqual([])
  })

  test("branch listing labels an unsupported cached branch set as fallback", async () => {
    const fixture = createGitFixture({ remotes: ["origin"] })

    await expect(
      resolveDefaultBranch(fixture.git, {
        profile: "branch-listing",
        remoteBranches: ["develop"],
      }),
    ).resolves.toEqual({ branch: "main", source: "fallback" })
    expect(fixture.branchCalls).toEqual([])
    expect(fixture.networkCalls()).toEqual([])
  })

  test("orphan cleanup uses cached origin/HEAD without network work", async () => {
    const fixture = createGitFixture({
      remotes: ["origin"],
      cachedOriginHead: "master",
    })

    await expect(
      resolveDefaultBranch(fixture.git, { profile: "orphan-cleanup" }),
    ).resolves.toEqual({ branch: "master", source: "remote" })
    expect(fixture.branchCalls).toEqual([])
    expect(fixture.networkCalls()).toEqual([])
  })

  test("orphan cleanup retains main fallback without inspecting remote branches", async () => {
    const fixture = createGitFixture({
      remotes: ["origin"],
      remoteBranches: ["master"],
      remoteHead: "master",
    })

    await expect(
      resolveDefaultBranch(fixture.git, { profile: "orphan-cleanup" }),
    ).resolves.toEqual({ branch: "main", source: "fallback" })
    expect(fixture.branchCalls).toEqual([])
    expect(fixture.networkCalls()).toEqual([])
  })

  test("worktree consumers prefer cached origin/HEAD without branch scans", async () => {
    const fixture = createGitFixture({
      remotes: ["origin"],
      cachedOriginHead: "release",
      remoteBranches: ["main"],
    })

    await expect(
      resolveDefaultBranch(fixture.git, { profile: "worktree" }),
    ).resolves.toEqual({ branch: "release", source: "remote" })
    expect(fixture.branchCalls).toEqual([])
    expect(fixture.networkCalls()).toEqual([])
  })

  test("worktree consumers preserve cached candidate order", async () => {
    const cases = [
      { branches: ["trunk"], expected: "trunk" },
      { branches: ["trunk", "develop"], expected: "develop" },
      {
        branches: ["trunk", "develop", "master"],
        expected: "master",
      },
      {
        branches: ["trunk", "develop", "master", "main"],
        expected: "main",
      },
    ]

    for (const { branches, expected } of cases) {
      const fixture = createGitFixture({
        remotes: ["origin"],
        remoteBranches: branches,
        remoteHead: "network-only",
      })
      await expect(
        resolveDefaultBranch(fixture.git, { profile: "worktree" }),
      ).resolves.toEqual({ branch: expected, source: "remote" })
      expect(fixture.branchCalls).toEqual([["-r"]])
      expect(fixture.networkCalls()).toEqual([])
    }
  })

  test("worktree consumers use the permitted ls-remote fallback once", async () => {
    const fixture = createGitFixture({
      remotes: ["origin"],
      remoteHead: "release",
    })

    await expect(
      resolveDefaultBranch(fixture.git, { profile: "worktree" }),
    ).resolves.toEqual({ branch: "release", source: "remote" })
    expect(fixture.networkCalls()).toEqual([
      ["ls-remote", "--symref", "origin", "HEAD"],
    ])
  })

  test("worktree consumers label failed network observation as fallback", async () => {
    const failed = createGitFixture({
      remotes: ["origin"],
      remoteHeadFailure: true,
    })
    const malformed = createGitFixture({ remotes: ["origin"] })

    await expect(
      resolveDefaultBranch(failed.git, { profile: "worktree" }),
    ).resolves.toEqual({ branch: "main", source: "fallback" })
    await expect(
      resolveDefaultBranch(malformed.git, { profile: "worktree" }),
    ).resolves.toEqual({ branch: "main", source: "fallback" })
    expect(failed.networkCalls()).toHaveLength(1)
    expect(malformed.networkCalls()).toHaveLength(1)
  })

  test("configured origin never falls into local precedence on cache miss", async () => {
    const fixture = createGitFixture({
      remotes: ["origin"],
      localBranches: ["master"],
      currentBranch: "master",
      remoteHeadFailure: true,
    })

    await expect(
      resolveDefaultBranch(fixture.git, {
        profile: "branch-listing",
        remoteBranches: [],
      }),
    ).resolves.toEqual({ branch: "main", source: "fallback" })
    expect(
      fixture.rawCalls.some((commands) => commands[0] === "for-each-ref"),
    ).toBe(false)
    expect(fixture.networkCalls()).toEqual([])
  })
})

describe("default-branch consumer ownership", () => {
  test("cleanup protects the resolver-selected local master", async () => {
    const fixture = createGitFixture({
      localBranches: ["master", "feature/current"],
      currentBranch: "feature/current",
    })
    const resolution = await resolveDefaultBranch(fixture.git, {
      profile: "orphan-cleanup",
    })

    expect(
      buildCleanupProtectedBranches(
        ["locus/active", null],
        resolution.branch,
        "feature/current",
      ),
    ).toEqual(new Set(["locus/active", "master", "feature/current"]))
  })

  test("local provenance is not rewritten to a stale origin ref", async () => {
    const root = mkdtempSync(join(tmpdir(), "locus-default-branch-owner-"))
    temporaryRoots.push(root)
    const repositoryPath = join(root, "repository")
    mkdirSync(repositoryPath)
    runGit(repositoryPath, ["init", "--quiet", "-b", "master"])
    runGit(repositoryPath, ["config", "user.name", "Locus Test"])
    runGit(repositoryPath, [
      "config",
      "user.email",
      "locus-test@example.invalid",
    ])
    writeFileSync(join(repositoryPath, "shared.ts"), "export const base = 1\n")
    runGit(repositoryPath, ["add", "shared.ts"])
    runGit(repositoryPath, ["commit", "--quiet", "-m", "base"])

    runGit(repositoryPath, ["checkout", "--quiet", "-b", "feature"])
    writeFileSync(
      join(repositoryPath, "feature.ts"),
      "export const feature = true\n",
    )
    runGit(repositoryPath, ["add", "feature.ts"])
    runGit(repositoryPath, ["commit", "--quiet", "-m", "feature"])
    const featureSha = runGit(repositoryPath, ["rev-parse", "HEAD"])
    runGit(repositoryPath, ["tag", "master", featureSha])
    runGit(repositoryPath, ["checkout", "--quiet", "master"])
    writeFileSync(
      join(repositoryPath, "master-only.ts"),
      "export const masterOnly = true\n",
    )
    runGit(repositoryPath, ["add", "master-only.ts"])
    runGit(repositoryPath, ["commit", "--quiet", "-m", "master only"])
    const masterSha = runGit(repositoryPath, ["rev-parse", "refs/heads/master"])
    runGit(repositoryPath, [
      "update-ref",
      "refs/remotes/origin/master",
      featureSha,
    ])
    expect(runGit(repositoryPath, ["remote"])).toBe("")
    expect(runGit(repositoryPath, ["rev-parse", "refs/tags/master"])).toBe(
      featureSha,
    )
    await expect(
      resolveDefaultBranch(simpleGit(repositoryPath), { profile: "worktree" }),
    ).resolves.toEqual({ branch: "master", source: "local" })

    const created = await createWorktreeForChat(
      repositoryPath,
      "repository",
      "chat-local-provenance",
      undefined,
      undefined,
      { worktreesDir: join(root, "worktrees") },
    )
    expect(created.success).toBe(true)
    expect(created.baseBranch).toBe("master")
    expect(created.baseCommit).toBe(masterSha)
    if (!created.worktreePath) throw new Error("Expected a created worktree")

    writeFileSync(
      join(created.worktreePath, "workspace.ts"),
      "export const workspace = true\n",
    )
    runGit(created.worktreePath, ["add", "workspace.ts"])
    runGit(created.worktreePath, ["commit", "--quiet", "-m", "workspace"])
    runGit(repositoryPath, [
      "update-ref",
      "refs/remotes/origin/master",
      runGit(created.worktreePath, ["rev-parse", "HEAD"]),
    ])

    const diff = await getWorktreeDiff(created.worktreePath)
    expect(diff.success).toBe(true)
    expect(diff.diff).toContain("diff --git a/workspace.ts b/workspace.ts")
    expect(diff.diff).not.toContain(
      "diff --git a/master-only.ts b/master-only.ts",
    )
  })

  test("one owner serves exactly the four direct consumers", () => {
    const ownerPath = "src/main/lib/git/default-branch.ts"
    const branchesPath = "src/main/lib/git/branches.ts"
    const worktreePath = "src/main/lib/git/worktree.ts"
    const branchesSource = readFileSync(branchesPath, "utf8")
    const worktreeSource = readFileSync(worktreePath, "utf8")

    expect(branchesSource).toContain(
      'import { resolveDefaultBranch } from "./default-branch"',
    )
    expect(worktreeSource).toContain(
      'import { resolveDefaultBranch } from "./default-branch"',
    )
    expect(branchesSource.match(/\bresolveDefaultBranch\s*\(/g)).toHaveLength(2)
    expect(worktreeSource.match(/\bresolveDefaultBranch\s*\(/g)).toHaveLength(2)
    expect(branchesSource).not.toMatch(/function\s+getDefaultBranch\b/)
    expect(worktreeSource).not.toMatch(/function\s+getDefaultBranch\b/)

    const definitionOwners = collectTypeScriptFiles("src/main/lib/git")
      .filter((file) =>
        /\b(?:function|const)\s+resolveDefaultBranch\b/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .sort()
    expect(definitionOwners).toEqual([ownerPath])
  })
})

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return collectTypeScriptFiles(path)
    return entry.isFile() && path.endsWith(".ts") ? [path] : []
  })
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim()
}
