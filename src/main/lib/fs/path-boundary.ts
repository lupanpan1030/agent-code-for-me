import { realpath } from "node:fs/promises"
import { basename, dirname, isAbsolute, relative, resolve } from "node:path"

export class PathBoundaryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PathBoundaryError"
  }
}

function containsNullByte(pathValue: string): boolean {
  return pathValue.includes("\0")
}

function containsTraversalSegment(pathValue: string): boolean {
  return pathValue.split(/[\\/]+/).includes("..")
}

export function isPathInsideOrEqual(
  rootPath: string,
  targetPath: string,
): boolean {
  const resolvedRoot = resolve(rootPath)
  const resolvedTarget = resolve(targetPath)
  const relativePath = relative(resolvedRoot, resolvedTarget)

  return (
    relativePath === "" ||
    (!!relativePath &&
      !relativePath.startsWith("..") &&
      !isAbsolute(relativePath))
  )
}

export function resolvePathWithinRoot(input: {
  targetPath: string
  rootPath: string
}): string {
  const { targetPath, rootPath } = input

  if (containsNullByte(targetPath) || containsNullByte(rootPath)) {
    throw new PathBoundaryError("Path contains invalid characters")
  }
  if (!isAbsolute(targetPath)) {
    throw new PathBoundaryError("Path must be absolute")
  }
  if (!isAbsolute(rootPath)) {
    throw new PathBoundaryError("Allowed root must be absolute")
  }
  if (
    containsTraversalSegment(targetPath) ||
    containsTraversalSegment(rootPath)
  ) {
    throw new PathBoundaryError("Path traversal not allowed")
  }

  const resolvedTarget = resolve(targetPath)
  const resolvedRoot = resolve(rootPath)

  if (!isPathInsideOrEqual(resolvedRoot, resolvedTarget)) {
    throw new PathBoundaryError("Path escapes allowed directory")
  }

  return resolvedTarget
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  )
}

export async function resolveRealPathWithinRoot(input: {
  targetPath: string
  rootPath: string
}): Promise<string> {
  const resolvedTarget = resolvePathWithinRoot(input)
  const resolvedRoot = resolve(input.rootPath)
  const realRoot = await realpath(resolvedRoot)

  let realTarget: string
  try {
    realTarget = await realpath(resolvedTarget)
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error
    }
    const realParent = await realpath(dirname(resolvedTarget))
    realTarget = resolve(realParent, basename(resolvedTarget))
  }

  if (!isPathInsideOrEqual(realRoot, realTarget)) {
    throw new PathBoundaryError("Path escapes allowed directory")
  }

  return resolvedTarget
}

export function assertRelativePathBoundary(pathValue: string): void {
  if (containsNullByte(pathValue)) {
    throw new PathBoundaryError("Path contains invalid characters")
  }
  if (isAbsolute(pathValue)) {
    throw new PathBoundaryError("Absolute paths are not allowed")
  }
  if (containsTraversalSegment(pathValue)) {
    throw new PathBoundaryError("Path traversal not allowed")
  }
}
