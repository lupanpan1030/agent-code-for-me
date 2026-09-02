export const MANAGED_WORKTREE_PATH_SEGMENTS = [".21st", "worktrees"] as const
export const MANAGED_WORKTREE_PATH_MARKER =
  MANAGED_WORKTREE_PATH_SEGMENTS.join("/")

export interface ParsedManagedWorktreePath {
  managedRootPath: string
  projectDirectory: string
  worktreeDirectory: string
  relativePath: string | null
}

export function normalizeManagedWorktreePath(pathToNormalize: string): string {
  return pathToNormalize.replace(/\\/g, "/")
}

function findManagedWorktreeRoot(normalizedPath: string): {
  managedRootPath: string
  suffix: string
} | null {
  const markerPattern = new RegExp(
    `(?:^|/)${MANAGED_WORKTREE_PATH_MARKER.replace(".", "\\.")}(?=/|$)`,
  )
  const match = markerPattern.exec(normalizedPath)
  if (!match || match.index === undefined) return null

  const markerOffset = match[0].startsWith("/") ? 1 : 0
  const markerStart = match.index + markerOffset
  const markerEnd = markerStart + MANAGED_WORKTREE_PATH_MARKER.length

  return {
    managedRootPath: normalizedPath.slice(0, markerEnd),
    suffix: normalizedPath.slice(markerEnd),
  }
}

export function isManagedWorktreePath(pathToCheck: string): boolean {
  return (
    findManagedWorktreeRoot(normalizeManagedWorktreePath(pathToCheck)) !== null
  )
}

export function parseManagedWorktreePath(
  pathToParse: string,
): ParsedManagedWorktreePath | null {
  const normalizedPath = normalizeManagedWorktreePath(pathToParse)
  const managedRoot = findManagedWorktreeRoot(normalizedPath)
  if (!managedRoot?.suffix.startsWith("/")) return null

  const [projectDirectory, worktreeDirectory, ...relativeSegments] =
    managedRoot.suffix.slice(1).split("/")
  if (!projectDirectory || !worktreeDirectory) return null

  const relativePath = relativeSegments.join("/")
  return {
    managedRootPath: managedRoot.managedRootPath,
    projectDirectory,
    worktreeDirectory,
    relativePath: relativePath || null,
  }
}

export function parseManagedWorktreeRelativePath(
  pathToParse: string,
): string | null {
  return parseManagedWorktreePath(pathToParse)?.relativePath ?? null
}
