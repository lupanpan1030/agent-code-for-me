import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const OWNER_ROOT = "src/main/lib/agent-workbench"
const FACADE = `${OWNER_ROOT}/deep-conflicts.ts`
const TYPES = `${OWNER_ROOT}/deep-conflict-types.ts`
const DEADLINE = `${OWNER_ROOT}/deep-conflict-deadline.ts`
const SNAPSHOT = `${OWNER_ROOT}/workspace-conflict-snapshot.ts`
const HUNKS = `${OWNER_ROOT}/hunk-conflicts.ts`
const MERGE_TREE = `${OWNER_ROOT}/merge-tree.ts`

const ownerFiles = [FACADE, TYPES, DEADLINE, SNAPSHOT, HUNKS, MERGE_TREE]

function source(file: string): string {
  return readFileSync(file, "utf8")
}

function definitionOwners(name: string): string[] {
  const definition = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b`,
  )
  return ownerFiles.filter((file) => definition.test(source(file)))
}

function lineCount(file: string): number {
  return source(file).split("\n").length
}

describe("Agent Workbench deep-conflict ownership", () => {
  test("keeps each deep-check implementation in one high-cohesion module", () => {
    expect(definitionOwners("checkCrossWorkspaceConflicts")).toEqual([FACADE])
    expect(definitionOwners("prepareConflictWorkspaceSnapshot")).toEqual([
      SNAPSHOT,
    ])
    expect(definitionOwners("getAgentWorkbenchDiffSummary")).toEqual([SNAPSHOT])
    expect(definitionOwners("collectDeepConflictPairEvidence")).toEqual([HUNKS])
    expect(definitionOwners("runGitMergeTreeTrial")).toEqual([MERGE_TREE])
    expect(definitionOwners("parseGitMergeTreeCapability")).toEqual([
      MERGE_TREE,
    ])
  })

  test("keeps the facade focused and routes external callers through it", () => {
    const facadeSource = source(FACADE)
    const routerSource = source("src/main/lib/trpc/routers/agent-workbench.ts")

    expect(facadeSource).not.toContain('from "simple-git"')
    expect(facadeSource).not.toContain("execWithShellEnv")
    expect(facadeSource).not.toContain("splitUnifiedDiffByFile")
    expect(routerSource).toContain(
      'from "../../agent-workbench/deep-conflicts"',
    )
    expect(routerSource).not.toContain("workspace-conflict-snapshot")
    expect(routerSource).not.toContain("hunk-conflicts")
    expect(routerSource).not.toContain("agent-workbench/merge-tree")
  })

  test("keeps the request budget wired through the production base-commit owner", () => {
    const routerSource = source("src/main/lib/trpc/routers/agent-workbench.ts")
    const baseCommitSource = source("src/main/lib/chat-base-commit.ts")
    const worktreeSource = source("src/main/lib/git/worktree.ts")

    expect(routerSource).toMatch(
      /ensureBaseCommit: \(taskId, options\) =>\s*ensureChatBaseCommit\(db, taskId, options\)/,
    )
    expect(baseCommitSource).toContain('from "./git/git-factory"')
    expect(baseCommitSource).not.toContain('from "simple-git"')
    expect(baseCommitSource.match(/absoluteTimeout: true/g)).toHaveLength(2)
    expect(baseCommitSource).toContain(
      "await readMergeBase(worktreePath, baseBranch, options)",
    )
    expect(baseCommitSource).toContain(
      "distance: await readDistance(worktreePath, candidate, options)",
    )
    expect(worktreeSource).toMatch(
      /export async function refExistsLocally[\s\S]*?createGit\(repoPath, \{[\s\S]*?signal: options\?\.signal,[\s\S]*?timeoutMs: options\?\.timeoutMs,[\s\S]*?absoluteTimeout: true,[\s\S]*?\}\)/,
    )
  })

  test("guards against rebuilding a single giant deep-conflict file", () => {
    expect(lineCount(FACADE)).toBeLessThan(450)
    expect(lineCount(SNAPSHOT)).toBeLessThan(320)
    expect(lineCount(HUNKS)).toBeLessThan(280)
    expect(lineCount(MERGE_TREE)).toBeLessThan(260)
    expect(lineCount(TYPES)).toBeLessThan(180)
    expect(lineCount(DEADLINE)).toBeLessThan(80)
  })

  test("documents the directory owner and its internal responsibilities", () => {
    const ownershipMap = source("docs/OWNERSHIP_MAP.md")

    for (const file of [
      "deep-conflicts.ts",
      "workspace-conflict-snapshot.ts",
      "hunk-conflicts.ts",
      "merge-tree.ts",
      "deep-conflict-{types,deadline}.ts",
    ]) {
      expect(ownershipMap).toContain(file)
    }
  })
})
