import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  statSync,
} from "node:fs"
import { basename, join, resolve } from "node:path"

export type StableDirectoryHandle = {
  readonly path: string
  readonly dev: number
  readonly ino: number
  readonly fd: number
  readonly anchorPath: string
  closed: boolean
}

function sameDirectoryIdentity(
  stat: ReturnType<typeof fstatSync>,
  directory: Pick<StableDirectoryHandle, "dev" | "ino">,
): boolean {
  return (
    stat.isDirectory() &&
    stat.dev === directory.dev &&
    stat.ino === directory.ino
  )
}

function resolveDirectoryFdAnchor(
  fd: number,
  directory: Pick<StableDirectoryHandle, "dev" | "ino">,
  label: string,
): string {
  const candidates =
    process.platform === "linux"
      ? [`/proc/self/fd/${fd}`]
      : process.platform === "darwin" || process.platform === "freebsd"
        ? [`/dev/fd/${fd}`]
        : []

  for (const candidate of candidates) {
    try {
      if (sameDirectoryIdentity(statSync(candidate), directory)) {
        return candidate
      }
    } catch {
      // Try the next platform-supported descriptor namespace.
    }
  }

  throw new Error(
    `${label} cannot be secured because this platform or filesystem does not expose a verified directory-fd anchor (${process.platform})`,
  )
}

/**
 * Opens a canonical, non-symlink directory and returns a descriptor-backed
 * namespace for child operations. Callers must never fall back to path-only
 * writes when this function rejects the current platform or filesystem.
 */
export function openStableDirectory(
  path: string,
  label: string,
): StableDirectoryHandle {
  const resolvedPath = resolve(path)
  const pathStat = lstatSync(resolvedPath)
  if (pathStat.isSymbolicLink() || !pathStat.isDirectory()) {
    throw new Error(`${label} must be a real directory, not a symlink`)
  }
  const canonicalPath = realpathSync(resolvedPath)
  if (canonicalPath !== resolvedPath) {
    throw new Error(`${label} must use a canonical directory path`)
  }

  const fd = openSync(
    canonicalPath,
    constants.O_RDONLY |
      (constants.O_DIRECTORY ?? 0) |
      (constants.O_NOFOLLOW ?? 0),
  )
  try {
    const opened = fstatSync(fd)
    const directory = {
      dev: pathStat.dev,
      ino: pathStat.ino,
    }
    if (!sameDirectoryIdentity(opened, directory)) {
      throw new Error(`${label} changed while opening its directory descriptor`)
    }
    return {
      path: canonicalPath,
      ...directory,
      fd,
      anchorPath: resolveDirectoryFdAnchor(fd, directory, label),
      closed: false,
    }
  } catch (error) {
    closeSync(fd)
    throw error
  }
}

/** Opens one non-symlink child directory through an already anchored parent. */
export function openStableDirectoryChild(
  parent: StableDirectoryHandle,
  childName: string,
  label: string,
): StableDirectoryHandle {
  assertStableDirectoryPath(parent, `${label} parent`)
  const childOperationPath = stableDirectoryChildPath(parent, childName)
  const childStat = lstatSync(childOperationPath)
  if (childStat.isSymbolicLink() || !childStat.isDirectory()) {
    throw new Error(`${label} must be a real directory, not a symlink`)
  }

  const fd = openSync(
    childOperationPath,
    constants.O_RDONLY |
      (constants.O_DIRECTORY ?? 0) |
      (constants.O_NOFOLLOW ?? 0),
  )
  try {
    const opened = fstatSync(fd)
    const directory = { dev: childStat.dev, ino: childStat.ino }
    if (!sameDirectoryIdentity(opened, directory)) {
      throw new Error(`${label} changed while opening its directory descriptor`)
    }
    const anchorPath = resolveDirectoryFdAnchor(fd, directory, label)
    const canonicalPath = realpathSync(anchorPath)
    const expectedPath = join(parent.path, childName)
    if (canonicalPath !== expectedPath) {
      throw new Error(`${label} escaped its anchored parent directory`)
    }
    assertStableDirectoryPath(parent, `${label} parent`)
    const installed = lstatSync(expectedPath)
    if (
      installed.isSymbolicLink() ||
      !sameDirectoryIdentity(installed, directory)
    ) {
      throw new Error(`${label} path identity changed while opening`)
    }
    return {
      path: canonicalPath,
      ...directory,
      fd,
      anchorPath,
      closed: false,
    }
  } catch (error) {
    closeSync(fd)
    throw error
  }
}

export function assertStableDirectoryHandle(
  directory: StableDirectoryHandle,
  label: string,
): void {
  if (directory.closed) throw new Error(`${label} directory handle is closed`)
  if (!sameDirectoryIdentity(fstatSync(directory.fd), directory)) {
    throw new Error(`${label} directory descriptor identity changed`)
  }
  if (!sameDirectoryIdentity(statSync(directory.anchorPath), directory)) {
    throw new Error(`${label} directory-fd anchor identity changed`)
  }
}

export function assertStableDirectoryPath(
  directory: StableDirectoryHandle,
  label: string,
): void {
  assertStableDirectoryHandle(directory, label)
  let pathStat: ReturnType<typeof lstatSync>
  try {
    pathStat = lstatSync(directory.path)
  } catch {
    throw new Error(`${label} directory path identity changed`)
  }
  if (
    pathStat.isSymbolicLink() ||
    !sameDirectoryIdentity(pathStat, directory)
  ) {
    throw new Error(`${label} directory path identity changed`)
  }
}

export function stableDirectoryChildPath(
  directory: StableDirectoryHandle,
  childName: string,
): string {
  if (
    !childName ||
    childName === "." ||
    childName === ".." ||
    basename(childName) !== childName
  ) {
    throw new Error("Stable directory child must be a single path component")
  }
  assertStableDirectoryHandle(directory, "Stable")
  return join(directory.anchorPath, childName)
}

export function fsyncStableDirectory(
  directory: StableDirectoryHandle,
  label: string,
): void {
  assertStableDirectoryHandle(directory, label)
  fsyncSync(directory.fd)
  assertStableDirectoryHandle(directory, label)
}

export function closeStableDirectory(directory: StableDirectoryHandle): void {
  if (directory.closed) return
  try {
    closeSync(directory.fd)
  } finally {
    directory.closed = true
  }
}
