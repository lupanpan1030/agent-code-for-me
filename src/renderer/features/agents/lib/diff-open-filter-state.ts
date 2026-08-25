import type { ParsedDiffFile } from "../../../../shared/unified-diff-parser"

export type DiffOpenFilterState = {
  selectedFilePath: string | null
  filteredDiffFiles: string[] | null
}

function firstParsedFilePath(
  parsedFileDiffs: readonly ParsedDiffFile[] | null,
): string | null {
  const firstFile = parsedFileDiffs?.[0]
  if (!firstFile) return null
  const path =
    firstFile.newPath !== "/dev/null" ? firstFile.newPath : firstFile.oldPath
  return path && path !== "/dev/null" ? path : null
}

/**
 * Reconciles the diff surface's initial selection without discarding a filter
 * supplied by an entry point such as cross-workspace conflict review.
 */
export function reconcileDiffOpenFilterState(input: {
  isOpen: boolean
  selectedFilePath: string | null
  filteredDiffFiles: readonly string[] | null
  parsedFileDiffs: readonly ParsedDiffFile[] | null
  showAllFilesForLayout: boolean
}): DiffOpenFilterState {
  if (!input.isOpen) {
    return { selectedFilePath: null, filteredDiffFiles: null }
  }

  const suppliedFilter = Array.from(
    new Set(
      (input.filteredDiffFiles ?? []).filter(
        (path): path is string => !!path && path !== "/dev/null",
      ),
    ),
  )
  if (suppliedFilter.length > 0) {
    const selectedFilePath =
      input.selectedFilePath && suppliedFilter.includes(input.selectedFilePath)
        ? input.selectedFilePath
        : (suppliedFilter[0] ?? null)
    return {
      selectedFilePath,
      filteredDiffFiles: suppliedFilter,
    }
  }

  const selectedFilePath =
    input.selectedFilePath ?? firstParsedFilePath(input.parsedFileDiffs)
  return {
    selectedFilePath,
    filteredDiffFiles:
      input.showAllFilesForLayout || !selectedFilePath
        ? null
        : [selectedFilePath],
  }
}
