import { randomUUID } from "node:crypto"
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  type Stats,
  unlinkSync,
  writeSync,
} from "node:fs"
import { join, resolve } from "node:path"
import { StringDecoder } from "node:string_decoder"
import { createExactSecretStreamRedactor } from "../agent-runtime/redaction"
import {
  assertStableDirectoryPath,
  closeStableDirectory,
  fsyncStableDirectory,
  openStableDirectory,
  openStableDirectoryChild,
  type StableDirectoryHandle,
  stableDirectoryChildPath,
} from "../filesystem/stable-directory"

type EnvSource = Record<string, string | undefined>

export const CODEX_APP_SERVER_SHELL_SNAPSHOT_SECRET_ENV_NAMES = [
  "LOCUS_CODEX_PROVIDER_GATEWAY_TOKEN",
  "CODEX_API_KEY",
] as const

export type CodexAppServerShellSnapshotSecret = {
  envName: string
  value?: string | null
}

export type CodexAppServerShellSnapshotScrubResult = {
  snapshotDir: string | null
  scannedFiles: number
  scrubbedFiles: number
  removedEnvLines: number
  redactedValueOccurrences: number
  skippedFiles: number
  errors: number
  diagnostics: string[]
}

export class CodexAppServerShellSnapshotScrubError extends Error {
  constructor(
    readonly result: CodexAppServerShellSnapshotScrubResult,
    readonly phase: "pre-start" | "post-run",
  ) {
    const firstDiagnostic = result.diagnostics[0]
    super(
      `Codex app-server shell snapshot scrub failed during ${phase}: ${result.errors} filesystem error(s), ${result.skippedFiles} unverified snapshot entry/entries.${firstDiagnostic ? ` First error: ${firstDiagnostic}` : ""}`,
    )
    this.name = "CodexAppServerShellSnapshotScrubError"
  }
}

const SHELL_SNAPSHOT_STREAM_CHUNK_BYTES = 64 * 1024
const MAX_SHELL_SNAPSHOT_DIAGNOSTICS = 16

function recordFilesystemError(
  result: CodexAppServerShellSnapshotScrubResult,
  context: string,
  error: unknown,
): void {
  result.errors += 1
  const errorCode = (error as NodeJS.ErrnoException | null)?.code
  const message = errorCode
    ? errorCode
    : error instanceof Error
      ? error.message
      : String(error)
  if (result.diagnostics.length < MAX_SHELL_SNAPSHOT_DIAGNOSTICS) {
    result.diagnostics.push(`${context}: ${message}`)
  }
}

function trimmed(value: string | undefined | null): string | null {
  const next = value?.trim()
  return next ? next : null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function normalizeSecrets(
  runtimeEnv: EnvSource,
  secrets?: CodexAppServerShellSnapshotSecret[],
): CodexAppServerShellSnapshotSecret[] {
  const input =
    secrets ??
    CODEX_APP_SERVER_SHELL_SNAPSHOT_SECRET_ENV_NAMES.map((envName) => ({
      envName,
      value: runtimeEnv[envName],
    }))

  const seen = new Set<string>()
  const normalized: CodexAppServerShellSnapshotSecret[] = []
  for (const secret of input) {
    const envName = trimmed(secret.envName)
    if (!envName || seen.has(envName)) continue
    const value = trimmed(secret.value ?? runtimeEnv[envName])
    if (!value && !(envName in runtimeEnv)) continue
    seen.add(envName)
    normalized.push({ envName, value })
  }
  return normalized
}

export function resolveCodexAppServerShellSnapshotsDir(
  runtimeEnv: EnvSource,
): string | null {
  const explicitCodexHome = trimmed(runtimeEnv.CODEX_HOME)
  if (explicitCodexHome) return join(explicitCodexHome, "shell_snapshots")

  const home = trimmed(runtimeEnv.HOME) ?? trimmed(runtimeEnv.USERPROFILE)
  if (!home) return null
  return join(home, ".codex", "shell_snapshots")
}

function writeText(fd: number, value: string, position: number): number {
  if (!value) return 0
  const bytes = Buffer.from(value, "utf8")
  let offset = 0
  while (offset < bytes.length) {
    const written = writeSync(
      fd,
      bytes,
      offset,
      bytes.length - offset,
      position + offset,
    )
    if (written <= 0) {
      throw new Error("Failed to make progress writing shell snapshot scrub")
    }
    offset += written
  }
  return bytes.length
}

/**
 * Removes complete lines containing a protected env name while keeping memory
 * bounded. Content already written for the current line is truncated if an
 * env name is discovered in a later chunk.
 */
function createStreamingEnvLineFilter(
  fd: number,
  envNames: readonly string[],
): {
  push: (value: string) => void
  finish: () => void
  removedEnvLines: () => number
} {
  const patterns = envNames.map(
    (envName) => new RegExp(`\\b${escapeRegExp(envName)}\\b`),
  )
  const retainedSearchChars = Math.max(
    1,
    ...envNames.map((envName) => envName.length + 1),
  )
  let outputOffset = 0
  let lineStartOffset = 0
  let searchTail = ""
  let droppingLine = false
  let removedLines = 0

  const pushLineFragment = (fragment: string, endsLine: boolean) => {
    if (!droppingLine) {
      const searchable = `${searchTail}${fragment}`
      const searchableWithRealBoundary = endsLine
        ? searchable
        : `${searchable}A`
      if (
        patterns.some((pattern) => pattern.test(searchableWithRealBoundary))
      ) {
        ftruncateSync(fd, lineStartOffset)
        outputOffset = lineStartOffset
        droppingLine = true
      } else {
        outputOffset += writeText(fd, fragment, outputOffset)
        searchTail = searchable.slice(-retainedSearchChars)
      }
    }

    if (endsLine) {
      if (droppingLine) removedLines += 1
      droppingLine = false
      searchTail = ""
      lineStartOffset = outputOffset
    }
  }

  return {
    push(value) {
      let cursor = 0
      while (cursor < value.length) {
        const newline = value.indexOf("\n", cursor)
        const endsLine = newline >= 0
        const end = endsLine ? newline + 1 : value.length
        pushLineFragment(value.slice(cursor, end), endsLine)
        cursor = end
      }
    },
    finish() {
      if (
        !droppingLine &&
        patterns.some((pattern) => pattern.test(searchTail))
      ) {
        ftruncateSync(fd, lineStartOffset)
        outputOffset = lineStartOffset
        droppingLine = true
      }
      if (droppingLine) {
        removedLines += 1
        droppingLine = false
      }
    },
    removedEnvLines: () => removedLines,
  }
}

type ShellSnapshotDirectoryReceipt = {
  parent: StableDirectoryHandle
  snapshot: StableDirectoryHandle
}

export type CodexAppServerShellSnapshotFilesystemHooks = {
  beforeAtomicRename?: (input: {
    entryName: string
    snapshotDirPath: string
  }) => void
}

function assertPlainDirectory(path: string, label: string): Stats {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a real directory, not a symlink`)
  }
  return stat
}

function captureShellSnapshotDirectory(
  runtimeEnv: EnvSource,
  snapshotDir: string,
): ShellSnapshotDirectoryReceipt {
  const explicitCodexHome = trimmed(runtimeEnv.CODEX_HOME)
  let configuredParentPath: string
  let parentLabel: string
  if (explicitCodexHome) {
    configuredParentPath = resolve(explicitCodexHome)
    parentLabel = "CODEX_HOME"
  } else {
    const configuredHome =
      trimmed(runtimeEnv.HOME) ?? trimmed(runtimeEnv.USERPROFILE)
    if (!configuredHome) {
      throw new Error("A home directory is required for shell snapshots")
    }
    const home = realpathSync(resolve(configuredHome))
    configuredParentPath = join(home, ".codex")
    parentLabel = "HOME/.codex"
  }

  const configuredParentStat = assertPlainDirectory(
    configuredParentPath,
    parentLabel,
  )
  const configuredSnapshotStat = assertPlainDirectory(
    resolve(snapshotDir),
    "Codex shell snapshot directory",
  )
  const parent = openStableDirectory(
    realpathSync(configuredParentPath),
    parentLabel,
  )
  let snapshot: StableDirectoryHandle | null = null
  try {
    if (
      configuredParentStat.dev !== parent.dev ||
      configuredParentStat.ino !== parent.ino
    ) {
      throw new Error(`${parentLabel} changed while capturing its identity`)
    }
    const parentRecheck = lstatSync(configuredParentPath)
    if (
      parentRecheck.isSymbolicLink() ||
      parentRecheck.dev !== parent.dev ||
      parentRecheck.ino !== parent.ino
    ) {
      throw new Error(`${parentLabel} path identity changed while opening`)
    }

    snapshot = openStableDirectoryChild(
      parent,
      "shell_snapshots",
      "Codex shell snapshot directory",
    )
    if (
      configuredSnapshotStat.dev !== snapshot.dev ||
      configuredSnapshotStat.ino !== snapshot.ino ||
      realpathSync(resolve(snapshotDir)) !== snapshot.path
    ) {
      throw new Error("Codex shell snapshot directory identity changed")
    }
    return { parent, snapshot }
  } catch (error) {
    try {
      if (snapshot) closeStableDirectory(snapshot)
    } finally {
      closeStableDirectory(parent)
    }
    throw error
  }
}

function assertShellSnapshotDirectory(
  directory: ShellSnapshotDirectoryReceipt,
): void {
  assertStableDirectoryPath(directory.parent, "Codex shell snapshot parent")
  assertStableDirectoryPath(directory.snapshot, "Codex shell snapshot")
}

function closeShellSnapshotDirectory(
  directory: ShellSnapshotDirectoryReceipt,
): void {
  try {
    closeStableDirectory(directory.snapshot)
  } finally {
    closeStableDirectory(directory.parent)
  }
}

function scrubRegularShellSnapshotFile(
  entryName: string,
  stat: Stats,
  secrets: CodexAppServerShellSnapshotSecret[],
  directory: ShellSnapshotDirectoryReceipt,
  filesystemHooks?: CodexAppServerShellSnapshotFilesystemHooks,
): {
  changed: boolean
  removedEnvLines: number
  redactedValueOccurrences: number
} {
  const fileOperationPath = stableDirectoryChildPath(
    directory.snapshot,
    entryName,
  )
  const tempName = `.${entryName}.locus-scrub-${process.pid}-${randomUUID()}.tmp`
  const tempOperationPath = stableDirectoryChildPath(
    directory.snapshot,
    tempName,
  )
  const exactRedactor = createExactSecretStreamRedactor()
  const secretValues = secrets
    .map((secret) => trimmed(secret.value))
    .filter((value): value is string => Boolean(value))
  const envNames = secrets
    .map((secret) => trimmed(secret.envName))
    .filter((value): value is string => Boolean(value))
  let inputFd: number | null = null
  let outputFd: number | null = null
  let tempExists = false
  let redactedValueOccurrences = 0
  let tempReceipt: {
    dev: number
    ino: number
    size: number
    mtimeMs: number
    ctimeMs: number
  } | null = null

  const isSameStableFile = (candidate: Stats): boolean =>
    candidate.isFile() &&
    !candidate.isSymbolicLink() &&
    candidate.nlink === 1 &&
    candidate.dev === stat.dev &&
    candidate.ino === stat.ino &&
    candidate.size === stat.size &&
    candidate.mtimeMs === stat.mtimeMs &&
    candidate.ctimeMs === stat.ctimeMs

  try {
    assertShellSnapshotDirectory(directory)
    inputFd = openSync(
      fileOperationPath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    )
    const openedStat = fstatSync(inputFd)
    if (!isSameStableFile(openedStat)) {
      throw new Error("Shell snapshot changed while opening it for scrub.")
    }

    outputFd = openSync(
      tempOperationPath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0),
      stat.mode & 0o777,
    )
    tempExists = true
    fchmodSync(outputFd, stat.mode & 0o777)
    const envLineFilter = createStreamingEnvLineFilter(outputFd, envNames)
    const decoder = new StringDecoder("utf8")
    const buffer = Buffer.allocUnsafe(SHELL_SNAPSHOT_STREAM_CHUNK_BYTES)

    while (true) {
      const bytesRead = readSync(inputFd, buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      const decoded = decoder.write(buffer.subarray(0, bytesRead))
      const redacted = exactRedactor.push(decoded, secretValues)
      redactedValueOccurrences += redacted.redactionCount
      envLineFilter.push(redacted.value)
    }

    const decodedTail = decoder.end()
    if (decodedTail) {
      const redacted = exactRedactor.push(decodedTail, secretValues)
      redactedValueOccurrences += redacted.redactionCount
      envLineFilter.push(redacted.value)
    }
    const redactedTail = exactRedactor.flush(secretValues)
    redactedValueOccurrences += redactedTail.redactionCount
    envLineFilter.push(redactedTail.value)
    envLineFilter.finish()

    if (!isSameStableFile(fstatSync(inputFd))) {
      throw new Error("Shell snapshot changed while it was being scrubbed.")
    }
    assertShellSnapshotDirectory(directory)

    const removedEnvLines = envLineFilter.removedEnvLines()
    const changed = removedEnvLines > 0 || redactedValueOccurrences > 0
    const tempStat = fstatSync(outputFd)
    if (!tempStat.isFile() || tempStat.nlink !== 1) {
      throw new Error("Shell snapshot temp file link count changed")
    }
    tempReceipt = {
      dev: tempStat.dev,
      ino: tempStat.ino,
      size: tempStat.size,
      mtimeMs: tempStat.mtimeMs,
      ctimeMs: tempStat.ctimeMs,
    }
    fsyncSync(outputFd)
    closeSync(outputFd)
    outputFd = null
    closeSync(inputFd)
    inputFd = null

    if (changed) {
      assertShellSnapshotDirectory(directory)
      if (!isSameStableFile(lstatSync(fileOperationPath))) {
        throw new Error("Shell snapshot changed before atomic replacement.")
      }
      const tempBeforeRename = lstatSync(tempOperationPath)
      if (
        !tempReceipt ||
        !tempBeforeRename.isFile() ||
        tempBeforeRename.isSymbolicLink() ||
        tempBeforeRename.nlink !== 1 ||
        tempBeforeRename.dev !== tempReceipt.dev ||
        tempBeforeRename.ino !== tempReceipt.ino ||
        tempBeforeRename.size !== tempReceipt.size ||
        tempBeforeRename.mtimeMs !== tempReceipt.mtimeMs ||
        tempBeforeRename.ctimeMs !== tempReceipt.ctimeMs
      ) {
        throw new Error("Shell snapshot temp file identity changed")
      }
      filesystemHooks?.beforeAtomicRename?.({
        entryName,
        snapshotDirPath: directory.snapshot.path,
      })
      renameSync(tempOperationPath, fileOperationPath)
      tempExists = false
      fsyncStableDirectory(directory.snapshot, "Codex shell snapshot")
      assertShellSnapshotDirectory(directory)
      const installed = lstatSync(fileOperationPath)
      if (
        installed.isSymbolicLink() ||
        !installed.isFile() ||
        installed.nlink !== 1 ||
        !tempReceipt ||
        installed.dev !== tempReceipt.dev ||
        installed.ino !== tempReceipt.ino ||
        installed.size !== tempReceipt.size ||
        installed.mtimeMs !== tempReceipt.mtimeMs
      ) {
        throw new Error("Installed shell snapshot is not a regular file")
      }
    } else {
      assertShellSnapshotDirectory(directory)
      unlinkSync(tempOperationPath)
      tempExists = false
      fsyncStableDirectory(directory.snapshot, "Codex shell snapshot")
      assertShellSnapshotDirectory(directory)
    }

    return { changed, removedEnvLines, redactedValueOccurrences }
  } catch (error) {
    let cleanupError: unknown = null
    if (inputFd !== null) {
      try {
        closeSync(inputFd)
      } catch (error) {
        cleanupError = error
      }
    }
    if (outputFd !== null) {
      try {
        closeSync(outputFd)
      } catch (error) {
        cleanupError ??= error
      }
    }
    if (tempExists) {
      try {
        unlinkSync(tempOperationPath)
        fsyncStableDirectory(directory.snapshot, "Codex shell snapshot")
      } catch (error) {
        cleanupError ??= error
      }
    }
    if (cleanupError) {
      throw new Error("Failed to clean up a shell snapshot scrub temp file", {
        cause: cleanupError,
      })
    }
    throw error
  }
}

export function scrubCodexAppServerShellSnapshots({
  runtimeEnv,
  secrets,
  filesystemHooks,
}: {
  runtimeEnv: EnvSource
  secrets?: CodexAppServerShellSnapshotSecret[]
  filesystemHooks?: CodexAppServerShellSnapshotFilesystemHooks
}): CodexAppServerShellSnapshotScrubResult {
  const snapshotDir = resolveCodexAppServerShellSnapshotsDir(runtimeEnv)
  const result: CodexAppServerShellSnapshotScrubResult = {
    snapshotDir,
    scannedFiles: 0,
    scrubbedFiles: 0,
    removedEnvLines: 0,
    redactedValueOccurrences: 0,
    skippedFiles: 0,
    errors: 0,
    diagnostics: [],
  }

  const normalizedSecrets = normalizeSecrets(runtimeEnv, secrets)
  if (!snapshotDir || normalizedSecrets.length === 0) {
    return result
  }

  try {
    lstatSync(snapshotDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return result
    recordFilesystemError(result, "inspect snapshot directory", error)
    return result
  }

  let directory: ShellSnapshotDirectoryReceipt
  try {
    directory = captureShellSnapshotDirectory(runtimeEnv, snapshotDir)
  } catch (error) {
    recordFilesystemError(result, "capture snapshot directory", error)
    return result
  }

  let entries: string[]
  try {
    assertShellSnapshotDirectory(directory)
    entries = readdirSync(directory.snapshot.anchorPath)
  } catch (error) {
    recordFilesystemError(result, "read snapshot directory", error)
    try {
      closeShellSnapshotDirectory(directory)
    } catch (closeError) {
      recordFilesystemError(result, "close snapshot directory", closeError)
    }
    return result
  }

  try {
    for (const entry of entries) {
      try {
        assertShellSnapshotDirectory(directory)
        const fileOperationPath = stableDirectoryChildPath(
          directory.snapshot,
          entry,
        )
        const stat = lstatSync(fileOperationPath)
        if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
          result.skippedFiles += 1
          continue
        }
        result.scannedFiles += 1
        const scrubbed = scrubRegularShellSnapshotFile(
          entry,
          stat,
          normalizedSecrets,
          directory,
          filesystemHooks,
        )
        result.removedEnvLines += scrubbed.removedEnvLines
        result.redactedValueOccurrences += scrubbed.redactedValueOccurrences
        if (scrubbed.changed) {
          result.scrubbedFiles += 1
        }
      } catch (error) {
        recordFilesystemError(result, "scrub snapshot entry", error)
      }
    }
    try {
      assertShellSnapshotDirectory(directory)
    } catch (error) {
      recordFilesystemError(result, "revalidate snapshot directory", error)
    }
  } finally {
    try {
      closeShellSnapshotDirectory(directory)
    } catch (error) {
      recordFilesystemError(result, "close snapshot directory", error)
    }
  }

  return result
}

export function assertCodexAppServerShellSnapshotsScrubbed(
  result: CodexAppServerShellSnapshotScrubResult,
  phase: "pre-start" | "post-run",
): CodexAppServerShellSnapshotScrubResult {
  if (result.errors > 0 || result.skippedFiles > 0) {
    throw new CodexAppServerShellSnapshotScrubError(result, phase)
  }
  return result
}
