import { describe, expect, test } from "bun:test"
import {
  isManagedWorktreePath,
  MANAGED_WORKTREE_PATH_MARKER,
  MANAGED_WORKTREE_PATH_SEGMENTS,
  normalizeManagedWorktreePath,
  parseManagedWorktreePath,
  parseManagedWorktreeRelativePath,
} from "../src/shared/worktree-path"

describe("managed worktree paths", () => {
  test("owns the stable managed-worktree marker", () => {
    expect(MANAGED_WORKTREE_PATH_SEGMENTS).toEqual([".21st", "worktrees"])
    expect(MANAGED_WORKTREE_PATH_MARKER).toBe(".21st/worktrees")
  })

  test("parses legacy and current two-directory layouts", () => {
    expect(
      parseManagedWorktreePath(
        "/Users/chen/.21st/worktrees/project-id/chat-id/src/legacy.ts",
      ),
    ).toEqual({
      managedRootPath: "/Users/chen/.21st/worktrees",
      projectDirectory: "project-id",
      worktreeDirectory: "chat-id",
      relativePath: "src/legacy.ts",
    })
    expect(
      parseManagedWorktreePath(
        "/Users/chen/.21st/worktrees/project-slug/quiet-ridge/packages/app.ts",
      ),
    ).toEqual({
      managedRootPath: "/Users/chen/.21st/worktrees",
      projectDirectory: "project-slug",
      worktreeDirectory: "quiet-ridge",
      relativePath: "packages/app.ts",
    })
  })

  test("normalizes Windows and mixed separators", () => {
    const windowsPath =
      "C:\\Users\\chen\\.21st\\worktrees\\project\\branch\\src\\index.ts"
    expect(normalizeManagedWorktreePath(windowsPath)).toBe(
      "C:/Users/chen/.21st/worktrees/project/branch/src/index.ts",
    )
    expect(parseManagedWorktreePath(windowsPath)).toEqual({
      managedRootPath: "C:/Users/chen/.21st/worktrees",
      projectDirectory: "project",
      worktreeDirectory: "branch",
      relativePath: "src/index.ts",
    })
    expect(
      parseManagedWorktreeRelativePath(
        "C:\\Users\\chen\\.21st/worktrees/project/branch/src\\mixed.ts",
      ),
    ).toBe("src/mixed.ts")
  })

  test("recognizes a worktree root without inventing a relative path", () => {
    const root = "/home/chen/.21st/worktrees/project/branch/"
    expect(isManagedWorktreePath(root)).toBe(true)
    expect(parseManagedWorktreePath(root)).toEqual({
      managedRootPath: "/home/chen/.21st/worktrees",
      projectDirectory: "project",
      worktreeDirectory: "branch",
      relativePath: null,
    })
    expect(parseManagedWorktreeRelativePath(root)).toBeNull()
  })

  test("rejects non-worktree paths, lookalike markers, and incomplete layouts", () => {
    expect(isManagedWorktreePath("/repo/src/index.ts")).toBe(false)
    expect(parseManagedWorktreePath("/repo/src/index.ts")).toBeNull()
    expect(
      isManagedWorktreePath(
        "/home/chen/.21st/worktrees-old/project/branch/src/index.ts",
      ),
    ).toBe(false)
    expect(
      parseManagedWorktreeRelativePath(
        "/home/chen/.21st/worktrees/project-only",
      ),
    ).toBeNull()
  })
})
