import { createHash, randomUUID } from "node:crypto"
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  type Stats,
  unlinkSync,
  writeSync,
} from "node:fs"
import { extname, isAbsolute, join, relative, resolve } from "node:path"
import {
  assertStableDirectoryPath,
  fsyncStableDirectory,
  type StableDirectoryHandle,
  stableDirectoryChildPath,
} from "../filesystem/stable-directory"
import {
  type JsonObject,
  RUN_ARTIFACT_LEDGER_PORT,
  type RunArtifactLedgerPort,
} from "./run-event-ledger"

/**
 * Canonical Run artifact owner (refactor-canonical-run-event-ledger, design
 * "Artifacts and Terminal Commit Order").
 *
 * Native file/diff/image/path observations are only candidate evidence. This
 * owner checks existence, a stable regular-file read inside the admitted run
 * directory, Run ownership, the expected SHA-256 digest, media and exact
 * secret redaction before asking the ledger's owner-gated port for
 * `artifact_created`. A rejected candidate becomes
 * `status/artifact_admission {result:"rejected", reason}` with no path or
 * content. It grants no new filesystem scope.
 */

/**
 * Roles of admitted native artifacts (proposal artifact row): a native file
 * path, a generated image and a runtime-reported diff. Locus run-dir files
 * keep their request/events/result/manifest roles.
 */
export const RUN_ARTIFACT_NATIVE_ROLES = [
  "native-file",
  "native-image",
  "native-diff",
] as const

export type RunArtifactNativeRole = (typeof RUN_ARTIFACT_NATIVE_ROLES)[number]

export function isRunArtifactNativeRole(
  value: unknown,
): value is RunArtifactNativeRole {
  return (RUN_ARTIFACT_NATIVE_ROLES as readonly unknown[]).includes(value)
}

export type RunArtifactCandidate = {
  path: string
  ownerRunId: string
  /**
   * Digest the native evidence independently claims. Absent when the native
   * surface reports only a path: the admitted digest is then the one of the
   * owner's own stable read.
   */
  expectedSha256?: string | null
  media: string
  /** Admitted role (default `native-file`). */
  role?: RunArtifactNativeRole
  /** Native evidence identity (e.g. item id) distinguishing observations. */
  sourceKey?: string
}

export type RunArtifactRunContext = {
  runId: string
  allowedRunDir: string
  ledger: unknown
}

export type RunArtifactRejectionReason =
  | "missing"
  | "out_of_scope"
  | "ownership_mismatch"
  | "digest_mismatch"
  | "redaction_unsafe"

export type RunArtifactAdmission =
  | {
      result: "admitted"
      artifact: {
        path: string
        sha256: string
        sizeBytes: number
        contentType: string
      }
    }
  | { result: "rejected"; reason: RunArtifactRejectionReason }

/** Largest candidate the owner reads into memory for digest/redaction. */
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
const MEDIA_TYPE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === "" || (!path.startsWith("..") && !isAbsolute(path))
}

function ledgerPort(ledger: unknown): RunArtifactLedgerPort {
  const port =
    ledger && typeof ledger === "object"
      ? (ledger as Record<PropertyKey, unknown>)[RUN_ARTIFACT_LEDGER_PORT]
      : undefined
  if (!port || typeof port !== "object") {
    throw new Error("Run artifact admission requires the canonical ledger")
  }
  return port as RunArtifactLedgerPort
}

const MEDIA_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".diff": "text/x-diff",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".patch": "text/x-diff",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".webp": "image/webp",
}

/** Media type a native candidate path declares by its extension. */
export function runArtifactMediaType(path: string): string {
  return (
    MEDIA_BY_EXTENSION[extname(path).toLowerCase()] ??
    "application/octet-stream"
  )
}

function candidateObservationKey(
  candidate: RunArtifactCandidate,
  runId: string,
): string {
  const identity = JSON.stringify([
    runId,
    candidate.path,
    candidate.ownerRunId,
    candidate.expectedSha256 ?? null,
    candidate.media,
    candidate.role ?? "native-file",
    candidate.sourceKey ?? null,
  ])
  return `artifact-${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`
}

/** Reads a stable regular file (same inode before and after the read). */
function readStableRegularFile(path: string): Buffer | null {
  let fd: number | null = null
  try {
    fd = openSync(path, "r")
    const before = fstatSync(fd)
    if (!before.isFile() || before.size > MAX_ARTIFACT_BYTES) return null
    const buffer = Buffer.alloc(before.size)
    let offset = 0
    while (offset < before.size) {
      const read = readSync(fd, buffer, offset, before.size - offset, offset)
      if (read === 0) break
      offset += read
    }
    const after = fstatSync(fd)
    if (
      offset !== before.size ||
      after.size !== before.size ||
      after.ino !== before.ino ||
      after.mtimeMs !== before.mtimeMs
    ) {
      return null
    }
    return buffer
  } catch {
    return null
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

/**
 * Validates one candidate without touching the ledger. Pure with respect to
 * the filesystem: it only reads the candidate inside the admitted run dir.
 */
export function evaluateRunArtifactCandidate(
  candidate: RunArtifactCandidate,
  context: { runId: string; allowedRunDir: string },
  isRedactionUnsafe: (text: string) => boolean,
): RunArtifactAdmission {
  if (typeof candidate?.path !== "string" || candidate.path.length === 0) {
    return { result: "rejected", reason: "missing" }
  }
  let allowedRoot: string
  try {
    allowedRoot = realpathSync(context.allowedRunDir)
  } catch {
    return { result: "rejected", reason: "out_of_scope" }
  }
  const requested = resolve(candidate.path)
  if (
    !isInside(allowedRoot, requested) &&
    !isInside(resolve(context.allowedRunDir), requested)
  ) {
    return { result: "rejected", reason: "out_of_scope" }
  }
  try {
    lstatSync(requested)
  } catch {
    return { result: "rejected", reason: "missing" }
  }
  let actual: string
  try {
    actual = realpathSync(requested)
  } catch {
    return { result: "rejected", reason: "missing" }
  }
  if (!isInside(allowedRoot, actual)) {
    return { result: "rejected", reason: "out_of_scope" }
  }
  if (candidate.ownerRunId !== context.runId) {
    return { result: "rejected", reason: "ownership_mismatch" }
  }
  const bytes = readStableRegularFile(actual)
  if (!bytes) return { result: "rejected", reason: "missing" }
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  const expected = candidate.expectedSha256
  if (
    expected !== undefined &&
    expected !== null &&
    sha256 !== String(expected).toLowerCase()
  ) {
    return { result: "rejected", reason: "digest_mismatch" }
  }
  if (
    typeof candidate.media !== "string" ||
    !MEDIA_TYPE.test(candidate.media)
  ) {
    return { result: "rejected", reason: "out_of_scope" }
  }
  // The admitted path is published with the ref, so it is checked too.
  if (isRedactionUnsafe(actual) || isRedactionUnsafe(bytes.toString("utf8"))) {
    return { result: "rejected", reason: "redaction_unsafe" }
  }
  return {
    result: "admitted",
    artifact: {
      path: actual,
      sha256,
      sizeBytes: bytes.length,
      contentType: candidate.media,
    },
  }
}

/**
 * Admits (or rejects) one native artifact candidate for a live Run and asks
 * the ledger's owner-gated port to commit the matching record.
 */
export async function admitRunArtifactCandidate(
  candidate: RunArtifactCandidate,
  runContext: RunArtifactRunContext,
): Promise<RunArtifactAdmission> {
  const port = ledgerPort(runContext.ledger)
  if (port.runId !== runContext.runId) {
    throw new Error("Run artifact admission context belongs to another Run")
  }
  const admission = evaluateRunArtifactCandidate(
    candidate,
    runContext,
    (text) => port.containsSecretMaterial(text),
  )
  const observationKey = candidateObservationKey(candidate, runContext.runId)
  const role = isRunArtifactNativeRole(candidate.role)
    ? candidate.role
    : "native-file"
  if (admission.result === "rejected") {
    await port.reject({
      observationKey,
      reason: admission.reason,
      role,
      native: true,
    })
    return admission
  }
  const artifact: JsonObject = {
    role,
    path: admission.artifact.path,
    sha256: admission.artifact.sha256,
    contentType: admission.artifact.contentType,
    sizeBytes: admission.artifact.sizeBytes,
  }
  await port.admit({
    observationKey,
    artifacts: [artifact],
    runDir: runContext.allowedRunDir,
    native: true,
  })
  return admission
}

/**
 * Native evidence that carries content rather than a file (a runtime-reported
 * diff): the owner stages the exact bytes as a new file inside the admitted
 * run directory with its hardened writer, then admits it as a candidate whose
 * expected digest is that content's digest. Content with exact secret
 * material, or too large to stage, is rejected without writing anything; no
 * filesystem scope outside the admitted run directory is used.
 */
export async function admitRunArtifactContent(
  content: {
    role: RunArtifactNativeRole
    fileName: string
    text: string
    media: string
    sourceKey?: string
  },
  runContext: { runId: string; runDir: RunArtifactRunDir; ledger: unknown },
): Promise<RunArtifactAdmission> {
  const port = ledgerPort(runContext.ledger)
  if (port.runId !== runContext.runId) {
    throw new Error("Run artifact admission context belongs to another Run")
  }
  const path = join(runContext.runDir.path, content.fileName)
  const expectedSha256 = createHash("sha256")
    .update(content.text, "utf8")
    .digest("hex")
  const candidate: RunArtifactCandidate = {
    path,
    ownerRunId: runContext.runId,
    expectedSha256,
    media: content.media,
    role: content.role,
    ...(content.sourceKey ? { sourceKey: content.sourceKey } : {}),
  }
  const rejectUnstaged = async (reason: RunArtifactRejectionReason) => {
    await port.reject({
      observationKey: candidateObservationKey(candidate, runContext.runId),
      reason,
      role: content.role,
      native: true,
    })
    return { result: "rejected" as const, reason }
  }
  if (
    basenameOnly(content.fileName) === null ||
    Buffer.byteLength(content.text, "utf8") > MAX_ARTIFACT_BYTES
  ) {
    return rejectUnstaged("out_of_scope")
  }
  if (port.containsSecretMaterial(content.text)) {
    return rejectUnstaged("redaction_unsafe")
  }
  try {
    writeRunArtifactFile(runContext.runDir, content.fileName, content.text)
  } catch {
    return rejectUnstaged("out_of_scope")
  }
  return admitRunArtifactCandidate(candidate, {
    runId: runContext.runId,
    allowedRunDir: runContext.runDir.path,
    ledger: runContext.ledger,
  })
}

function basenameOnly(fileName: string): string | null {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fileName) &&
    !fileName.includes("..")
    ? fileName
    : null
}

/**
 * Admits already prepared lifecycle run-dir files (API create/retry initial
 * request/events/manifest) as one `artifact_created` through the ledger's
 * owner-gated port. Each descriptor is re-read inside the admitted run
 * directory and must match its recorded digest and size; the admission
 * claims no native artifact or binary and needs no execution binding.
 */
export async function admitRunDirArtifacts(input: {
  runId: string
  runDir: RunArtifactRunDir
  artifacts: readonly RunDirArtifact[]
  ledger: unknown
}): Promise<void> {
  const port = ledgerPort(input.ledger)
  if (port.runId !== input.runId) {
    throw new Error("Run artifact admission context belongs to another Run")
  }
  for (const artifact of input.artifacts) {
    const name = relative(input.runDir.path, artifact.path)
    if (name.length === 0 || name.startsWith("..") || isAbsolute(name)) {
      throw new Error("Run-dir artifact escapes the admitted run directory")
    }
    const actual = describeRunArtifactFile(
      artifact.role,
      input.runDir,
      name,
      artifact.contentType,
    )
    if (
      actual.sha256 !== artifact.sha256 ||
      actual.sizeBytes !== artifact.sizeBytes
    ) {
      throw new Error("Run-dir artifact changed before admission")
    }
  }
  const identity = JSON.stringify(
    input.artifacts.map((artifact) => [artifact.role, artifact.sha256]),
  )
  await port.admit({
    observationKey: `run-dir-artifacts-${createHash("sha256")
      .update(`${input.runId}\u0000${identity}`)
      .digest("hex")
      .slice(0, 24)}`,
    artifacts: input.artifacts.map((artifact) => ({ ...artifact })),
    runDir: input.runDir.path,
  })
}

// ---------------------------------------------------------------------------
// Hardened run-dir file writer/reader (moved from headless/local-job-api.ts;
// the local-job-api serializers own the v1 file names, roles and contents and
// hand the bytes to this owner, which writes, re-reads and digests them).
// ---------------------------------------------------------------------------

export type RunArtifactFileReceipt = {
  dev: number
  ino: number
  size: number
  mtimeMs: number
  ctimeMs: number
}

/**
 * A run directory is authority captured at exclusive creation time, not merely
 * a pathname that an untrusted workspace process may later replace.
 */
export type RunArtifactRunDir = StableDirectoryHandle & {
  fileReceipts: Map<string, RunArtifactFileReceipt>
}

export type RunArtifactFilesystemHooks = {
  beforeAtomicRename?: (input: { fileName: string; runDirPath: string }) => void
}

/** Public descriptor of one prepared run-dir file (v1 artifact shape). */
export type RunDirArtifact = {
  role: string
  path: string
  sha256: string
  contentType: string
  sizeBytes: number
}

function isSameArtifactFile(
  stat: Stats,
  receipt: RunArtifactFileReceipt,
): boolean {
  return (
    stat.isFile() &&
    !stat.isSymbolicLink() &&
    stat.nlink === 1 &&
    stat.dev === receipt.dev &&
    stat.ino === receipt.ino &&
    stat.size === receipt.size &&
    stat.mtimeMs === receipt.mtimeMs &&
    stat.ctimeMs === receipt.ctimeMs
  )
}

export function assertRunArtifactRunDir(runDir: RunArtifactRunDir): void {
  assertStableDirectoryPath(runDir, "Artifact run")
}

export function readRunArtifactFile(
  directory: StableDirectoryHandle,
  childName: string,
  expected?: RunArtifactFileReceipt,
): Buffer {
  const path = join(directory.path, childName)
  assertStableDirectoryPath(directory, "Artifact directory")
  const operationPath = stableDirectoryChildPath(directory, childName)
  const before = lstatSync(operationPath)
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1) {
    throw new Error(`Artifact must be a single-link regular file: ${path}`)
  }
  if (expected && !isSameArtifactFile(before, expected)) {
    throw new Error(`Artifact file identity changed during the run: ${path}`)
  }

  const fd = openSync(
    operationPath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  )
  try {
    const opened = fstatSync(fd)
    const stableReceipt: RunArtifactFileReceipt = {
      dev: before.dev,
      ino: before.ino,
      size: before.size,
      mtimeMs: before.mtimeMs,
      ctimeMs: before.ctimeMs,
    }
    if (!isSameArtifactFile(opened, stableReceipt)) {
      throw new Error(`Artifact changed while opening it: ${path}`)
    }
    const chunks: Buffer[] = []
    const buffer = Buffer.allocUnsafe(64 * 1024)
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)))
    }
    if (!isSameArtifactFile(fstatSync(fd), stableReceipt)) {
      throw new Error(`Artifact changed while reading it: ${path}`)
    }
    assertStableDirectoryPath(directory, "Artifact directory")
    return Buffer.concat(chunks)
  } finally {
    closeSync(fd)
  }
}

function artifactFileReceipt(stat: Stats): RunArtifactFileReceipt {
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  }
}

function validateArtifactTargetBeforeWrite(
  runDir: RunArtifactRunDir,
  fileName: string,
): void {
  const targetPath = join(runDir.path, fileName)
  const operationPath = stableDirectoryChildPath(runDir, fileName)
  const expected = runDir.fileReceipts.get(fileName)
  let stat: Stats
  try {
    stat = lstatSync(operationPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    if (expected) {
      throw new Error(`Artifact disappeared during the run: ${targetPath}`)
    }
    return
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
    throw new Error(
      `Artifact target is not a single-link regular file: ${targetPath}`,
    )
  }
  if (!expected) {
    throw new Error(`Unexpected artifact target already exists: ${targetPath}`)
  }
  if (!isSameArtifactFile(stat, expected)) {
    throw new Error(
      `Artifact file identity changed during the run: ${targetPath}`,
    )
  }
}

export function writeRunArtifactFile(
  runDir: RunArtifactRunDir,
  fileName: string,
  content: string,
  hooks?: RunArtifactFilesystemHooks,
): string {
  assertRunArtifactRunDir(runDir)
  validateArtifactTargetBeforeWrite(runDir, fileName)
  const targetPath = join(runDir.path, fileName)
  const targetOperationPath = stableDirectoryChildPath(runDir, fileName)
  const tempName = `.${fileName}.locus-${process.pid}-${randomUUID()}.tmp`
  const tempOperationPath = stableDirectoryChildPath(runDir, tempName)
  let fd: number | null = null
  let tempExists = false
  let tempReceipt: RunArtifactFileReceipt | null = null

  try {
    fd = openSync(
      tempOperationPath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0),
      0o600,
    )
    tempExists = true
    fchmodSync(fd, 0o600)
    const bytes = Buffer.from(content, "utf8")
    let offset = 0
    while (offset < bytes.length) {
      const written = writeSync(
        fd,
        bytes,
        offset,
        bytes.length - offset,
        offset,
      )
      if (written <= 0) {
        throw new Error(
          `Failed to make progress writing artifact: ${targetPath}`,
        )
      }
      offset += written
    }
    const tempStat = fstatSync(fd)
    if (!tempStat.isFile() || tempStat.nlink !== 1) {
      throw new Error(`Artifact temp file link count changed: ${targetPath}`)
    }
    tempReceipt = artifactFileReceipt(tempStat)
    fsyncSync(fd)
    closeSync(fd)
    fd = null

    assertRunArtifactRunDir(runDir)
    validateArtifactTargetBeforeWrite(runDir, fileName)
    if (
      !tempReceipt ||
      !isSameArtifactFile(lstatSync(tempOperationPath), tempReceipt)
    ) {
      throw new Error(`Artifact temp file identity changed: ${targetPath}`)
    }
    hooks?.beforeAtomicRename?.({
      fileName,
      runDirPath: runDir.path,
    })
    renameSync(tempOperationPath, targetOperationPath)
    tempExists = false

    fsyncStableDirectory(runDir, "Artifact run")
    assertRunArtifactRunDir(runDir)
    const installed = lstatSync(targetOperationPath)
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
      throw new Error(
        `Installed artifact is not a single-link regular file: ${targetPath}`,
      )
    }
    runDir.fileReceipts.set(fileName, artifactFileReceipt(installed))
    return targetPath
  } catch (error) {
    let cleanupError: unknown = null
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch (error) {
        cleanupError = error
      }
    }
    if (tempExists) {
      try {
        unlinkSync(tempOperationPath)
        fsyncStableDirectory(runDir, "Artifact run")
      } catch (error) {
        cleanupError ??= error
      }
    }
    if (cleanupError) {
      throw new Error("Failed to clean up an atomic artifact temp file", {
        cause: cleanupError,
      })
    }
    throw error
  }
}

export function describeRunArtifactFile(
  role: string,
  runDir: RunArtifactRunDir,
  fileName: string,
  contentType = "application/json",
): RunDirArtifact {
  const publicPath = join(runDir.path, fileName)
  const content = readRunArtifactFile(
    runDir,
    fileName,
    runDir.fileReceipts.get(fileName),
  )
  const hash = createHash("sha256")
  hash.update(content)
  return {
    role,
    path: publicPath,
    sha256: hash.digest("hex"),
    contentType,
    sizeBytes: content.byteLength,
  }
}
