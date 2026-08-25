import { describe, expect, test } from "bun:test"
import { splitUnifiedDiffByFile } from "../src/shared/unified-diff-parser"

describe("unified diff parser", () => {
  test("captures single-line hunk ranges", () => {
    const [file] =
      splitUnifiedDiffByFile(`diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -5 +5 @@
-oldValue
+newValue`)

    expect(file?.hunks).toEqual([
      { oldStart: 5, oldLines: 1, newStart: 5, newLines: 1 },
    ])
  })

  test("captures multiple hunk ranges in one file", () => {
    const [file] =
      splitUnifiedDiffByFile(`diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,2 +1,3 @@
-oldStart
+newStart
@@ -10,4 +11,2 @@
-oldEnd
+newEnd`)

    expect(file?.hunks).toEqual([
      { oldStart: 1, oldLines: 2, newStart: 1, newLines: 3 },
      { oldStart: 10, oldLines: 4, newStart: 11, newLines: 2 },
    ])
  })

  test("defaults omitted hunk counts to one", () => {
    const [file] =
      splitUnifiedDiffByFile(`diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -5 +5,3 @@
-oldValue
+newValue
+anotherValue
+finalValue`)

    expect(file?.hunks).toEqual([
      { oldStart: 5, oldLines: 1, newStart: 5, newLines: 3 },
    ])
  })

  test("omits hunk ranges for binary files", () => {
    const [file] = splitUnifiedDiffByFile(`diff --git a/image.png b/image.png
index 1111111..2222222 100644
Binary files a/image.png and b/image.png differ`)

    expect(file?.isValid).toBe(true)
    expect(file?.isBinary).toBe(true)
    expect(file?.hunks).toBeUndefined()
  })

  test("decodes C-quoted Unicode binary paths without text headers", () => {
    const [file] =
      splitUnifiedDiffByFile(`diff --git "a/\\346\\210\\252\\345\\233\\276.png" "b/\\346\\210\\252\\345\\233\\276.png"
index bdc955b..8835708 100644
Binary files "a/\\346\\210\\252\\345\\233\\276.png" and "b/\\346\\210\\252\\345\\233\\276.png" differ`)

    expect(file).toMatchObject({
      oldPath: "截图.png",
      newPath: "截图.png",
      isBinary: true,
      isValid: true,
      isNewFile: false,
      isDeletedFile: false,
    })
    expect(file?.key).toBe("截图.png->截图.png")
  })

  test("keeps unquoted binary paths containing spaces", () => {
    const [file] =
      splitUnifiedDiffByFile(`diff --git a/image file.png b/image file.png
index bdc955b..8835708 100644
Binary files a/image file.png and b/image file.png differ`)

    expect(file).toMatchObject({
      oldPath: "image file.png",
      newPath: "image file.png",
      isBinary: true,
    })
  })

  test("parses a git diff -M pure rename as valid", () => {
    // Captured from `git diff -M HEAD` after renaming the only tracked file.
    const [file] =
      splitUnifiedDiffByFile(`diff --git "a/\\346\\227\\247\\345\\220\\215.txt" "b/\\346\\226\\260\\345\\220\\215.txt"
similarity index 100%
rename from "\\346\\227\\247\\345\\220\\215.txt"
rename to "\\346\\226\\260\\345\\220\\215.txt"`)

    expect(file?.isValid).toBe(true)
    expect(file?.oldPath).toBe("旧名.txt")
    expect(file?.newPath).toBe("新名.txt")
    expect(file?.hunks).toEqual([])
  })

  test("decodes quoted Unicode header paths before stripping git prefixes", () => {
    const [file] =
      splitUnifiedDiffByFile(`diff --git "a/\\344\\270\\255\\346\\226\\207.txt" "b/\\344\\270\\255\\346\\226\\207.txt"
index 1111111..2222222 100644
--- "a/\\344\\270\\255\\346\\226\\207.txt"
+++ "b/\\344\\270\\255\\346\\226\\207.txt"
@@ -1 +1 @@
-before
+after`)

    expect(file?.isValid).toBe(true)
    expect(file?.oldPath).toBe("中文.txt")
    expect(file?.newPath).toBe("中文.txt")
  })

  test("rejects incomplete or content-changing rename metadata", () => {
    const [incompleteRename] =
      splitUnifiedDiffByFile(`diff --git a/before.txt b/after.txt
similarity index 100%
rename from before.txt`)

    const [contentChangingRename] =
      splitUnifiedDiffByFile(`diff --git a/before.txt b/after.txt
similarity index 80%
rename from before.txt
rename to after.txt`)

    expect(incompleteRename?.isValid).toBe(false)
    expect(contentChangingRename?.isValid).toBe(false)
  })
})
