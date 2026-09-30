import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
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

export type StableDirectoryFile = {
  readonly dev: number
  readonly ino: number
  readonly size: number
  readonly bytes: Buffer
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

/**
 * Anchors a registered directory that may be reached through stable symlinked
 * parent prefixes (for example macOS `/tmp` or a symlinked `~/projects`).
 *
 * The registered path's own leaf must be a real directory. Its realpath is the
 * canonical anchor path, and the registered leaf `lstat`, the canonical path
 * and the opened descriptor must share one directory `dev`/`ino` identity. The
 * registered identity and canonical resolution are re-read after anchoring so
 * a retarget during admission fails closed. `path.resolve()` alone is never
 * treated as canonicalization.
 */
export function openRegisteredStableDirectory(
  registeredPath: string,
  label: string,
): StableDirectoryHandle {
  const resolvedPath = resolve(registeredPath)
  const registeredStat = lstatSync(resolvedPath)
  if (registeredStat.isSymbolicLink() || !registeredStat.isDirectory()) {
    throw new Error(`${label} must be a real directory, not a symlink`)
  }
  const registered = { dev: registeredStat.dev, ino: registeredStat.ino }
  const canonicalPath = realpathSync(resolvedPath)
  if (!sameDirectoryIdentity(lstatSync(canonicalPath), registered)) {
    throw new Error(`${label} canonical directory identity does not match`)
  }

  const directory = openStableDirectory(canonicalPath, label)
  try {
    if (!sameDirectoryIdentity(fstatSync(directory.fd), registered)) {
      throw new Error(`${label} canonical directory identity does not match`)
    }
    const reread = lstatSync(resolvedPath)
    if (
      reread.isSymbolicLink() ||
      !sameDirectoryIdentity(reread, registered) ||
      realpathSync(resolvedPath) !== canonicalPath
    ) {
      throw new Error(`${label} directory identity changed while anchoring`)
    }
    return directory
  } catch (error) {
    closeStableDirectory(directory)
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

/**
 * Opens one regular-file child of an anchored directory without following a
 * final symlink, verifies the opened descriptor is a regular file within the
 * byte bound, and reads the bytes from that same descriptor. There is no
 * authorization-check-then-path-reopen gap. Concurrent in-place writes to the
 * already opened inode remain possible, so the bytes stay untrusted content.
 */
export function readStableDirectoryFile(
  directory: StableDirectoryHandle,
  childName: string,
  label: string,
  options: { maxBytes: number },
): StableDirectoryFile {
  assertStableDirectoryHandle(directory, `${label} parent`)
  const operationPath = stableDirectoryChildPath(directory, childName)
  const fd = openSync(
    operationPath,
    constants.O_RDONLY |
      (constants.O_NOFOLLOW ?? 0) |
      (constants.O_NONBLOCK ?? 0),
  )
  try {
    const opened = fstatSync(fd)
    if (!opened.isFile()) {
      throw new Error(`${label} must be a regular file`)
    }
    if (opened.size > options.maxBytes) {
      throw new Error(`${label} exceeds the allowed size`)
    }
    const bytes = Buffer.alloc(opened.size)
    let offset = 0
    while (offset < bytes.length) {
      const read = readSync(fd, bytes, offset, bytes.length - offset, offset)
      if (read === 0) break
      offset += read
    }
    const completed = fstatSync(fd)
    if (completed.dev !== opened.dev || completed.ino !== opened.ino) {
      throw new Error(`${label} descriptor identity changed while reading`)
    }
    assertStableDirectoryHandle(directory, `${label} parent`)
    return {
      dev: opened.dev,
      ino: opened.ino,
      size: offset,
      bytes: offset === bytes.length ? bytes : bytes.subarray(0, offset),
    }
  } finally {
    closeSync(fd)
  }
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
