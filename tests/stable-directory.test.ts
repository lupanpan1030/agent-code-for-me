import { describe, expect, test } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  assertStableDirectoryHandle,
  assertStableDirectoryPath,
  closeStableDirectory,
  openStableDirectory,
  openStableDirectoryChild,
  stableDirectoryChildPath,
} from "../src/main/lib/filesystem/stable-directory"

describe("stable directory descriptor anchor", () => {
  test("keeps child operations on the opened inode and detects path replacement", () => {
    const root = mkdtempSync(join(tmpdir(), "locus-stable-directory-"))
    const movedRoot = `${root}.moved`
    const directory = openStableDirectory(root, "Test directory")
    try {
      writeFileSync(stableDirectoryChildPath(directory, "owned.txt"), "owned")
      renameSync(root, movedRoot)
      mkdirSync(root)
      writeFileSync(join(root, "owned.txt"), "replacement")

      expect(() =>
        assertStableDirectoryPath(directory, "Test directory"),
      ).toThrow("directory path identity changed")
      expect(
        readFileSync(stableDirectoryChildPath(directory, "owned.txt"), "utf8"),
      ).toBe("owned")
      expect(readFileSync(join(root, "owned.txt"), "utf8")).toBe("replacement")
    } finally {
      closeStableDirectory(directory)
      rmSync(root, { recursive: true, force: true })
      rmSync(movedRoot, { recursive: true, force: true })
    }

    expect(() =>
      assertStableDirectoryHandle(directory, "Test directory"),
    ).toThrow("directory handle is closed")
  })

  test("refuses to open a symlink child through an anchored parent", () => {
    const root = mkdtempSync(join(tmpdir(), "locus-stable-child-"))
    const parent = openStableDirectory(root, "Test parent")
    try {
      const target = join(root, "target")
      mkdirSync(target)
      symlinkSync(target, join(root, "linked-child"), "dir")

      expect(() =>
        openStableDirectoryChild(parent, "linked-child", "Test child"),
      ).toThrow("must be a real directory, not a symlink")
    } finally {
      closeStableDirectory(parent)
      rmSync(root, { recursive: true, force: true })
    }
  })
})
