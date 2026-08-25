import { describe, expect, test } from "bun:test"
import { reconcileDiffOpenFilterState } from "../src/renderer/features/agents/lib/diff-open-filter-state"
import type { ParsedDiffFile } from "../src/shared/unified-diff-parser"

function parsedFile(path: string): ParsedDiffFile {
  return {
    key: `${path}->${path}`,
    oldPath: path,
    newPath: path,
    diffText: "",
    isBinary: false,
    additions: 1,
    deletions: 0,
    isValid: true,
    fileLang: "typescript",
    isNewFile: false,
    isDeletedFile: false,
  }
}

describe("diff open filter state", () => {
  test("preserves a multi-file conflict filter instead of selecting an unrelated first diff", () => {
    const result = reconcileDiffOpenFilterState({
      isOpen: true,
      selectedFilePath: null,
      filteredDiffFiles: ["shared.ts", "renamed-shared.ts"],
      parsedFileDiffs: [parsedFile("unrelated.ts"), parsedFile("shared.ts")],
      showAllFilesForLayout: false,
    })

    expect(result).toEqual({
      selectedFilePath: "shared.ts",
      filteredDiffFiles: ["shared.ts", "renamed-shared.ts"],
    })
  })

  test("preserves an entry-point filter in the narrow collapsed layout", () => {
    const result = reconcileDiffOpenFilterState({
      isOpen: true,
      selectedFilePath: null,
      filteredDiffFiles: ["shared.ts"],
      parsedFileDiffs: [parsedFile("unrelated.ts"), parsedFile("shared.ts")],
      showAllFilesForLayout: true,
    })

    expect(result).toEqual({
      selectedFilePath: "shared.ts",
      filteredDiffFiles: ["shared.ts"],
    })
  })

  test("keeps the ordinary narrow layout unfiltered without a supplied filter", () => {
    const result = reconcileDiffOpenFilterState({
      isOpen: true,
      selectedFilePath: null,
      filteredDiffFiles: null,
      parsedFileDiffs: [parsedFile("first.ts"), parsedFile("second.ts")],
      showAllFilesForLayout: true,
    })

    expect(result).toEqual({
      selectedFilePath: "first.ts",
      filteredDiffFiles: null,
    })
  })

  test("clears selection and filter when the surface closes", () => {
    expect(
      reconcileDiffOpenFilterState({
        isOpen: false,
        selectedFilePath: "shared.ts",
        filteredDiffFiles: ["shared.ts"],
        parsedFileDiffs: [parsedFile("shared.ts")],
        showAllFilesForLayout: false,
      }),
    ).toEqual({ selectedFilePath: null, filteredDiffFiles: null })
  })
})
