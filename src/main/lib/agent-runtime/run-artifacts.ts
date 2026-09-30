import { createHash } from "node:crypto"
import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path"
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

export type RunArtifactCandidate = {
  path: string
  ownerRunId: string
  expectedSha256: string
  media: string
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
        sha256: string
        sizeBytes: number
        contentType: string
        name: string
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

function candidateObservationKey(
  candidate: RunArtifactCandidate,
  runId: string,
): string {
  const identity = JSON.stringify([
    runId,
    candidate.path,
    candidate.ownerRunId,
    candidate.expectedSha256,
    candidate.media,
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
  if (sha256 !== String(candidate.expectedSha256).toLowerCase()) {
    return { result: "rejected", reason: "digest_mismatch" }
  }
  if (
    typeof candidate.media !== "string" ||
    !MEDIA_TYPE.test(candidate.media)
  ) {
    return { result: "rejected", reason: "out_of_scope" }
  }
  if (isRedactionUnsafe(bytes.toString("utf8"))) {
    return { result: "rejected", reason: "redaction_unsafe" }
  }
  return {
    result: "admitted",
    artifact: {
      sha256,
      sizeBytes: bytes.length,
      contentType: candidate.media,
      name: basename(actual),
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
  if (admission.result === "rejected") {
    await port.reject({ observationKey, reason: admission.reason })
    return admission
  }
  const artifact: JsonObject = {
    role: "native",
    sha256: admission.artifact.sha256,
    sizeBytes: admission.artifact.sizeBytes,
    contentType: admission.artifact.contentType,
    name: admission.artifact.name,
  }
  await port.admit({
    observationKey,
    artifact,
    ref: artifact,
    runDir: runContext.allowedRunDir,
  })
  return admission
}

export type RunTerminalArtifactFile = {
  /** Relative file name inside the admitted run directory. */
  name: string
  role: string
  content: string
}

export type RunTerminalArtifactRef = {
  role: string
  name: string
  sha256: string
  sizeBytes: number
}

/**
 * Prepares terminal run-dir files from a frozen terminal candidate (design
 * step 2): each file is staged and atomically renamed inside the admitted
 * run directory, and the returned refs carry the digests the ledger
 * registers with `completed` in one durable commit. Serialization of the v1
 * public files stays with the local-job-api owner; this function only writes
 * the bytes it is handed. A failure removes staged files and throws so the
 * ledger can settle `failed` with the preparation diagnostic.
 */
export function prepareRunTerminalArtifacts(input: {
  allowedRunDir: string
  files: readonly RunTerminalArtifactFile[]
}): RunTerminalArtifactRef[] {
  const root = realpathSync(input.allowedRunDir)
  const staged: string[] = []
  try {
    const refs: RunTerminalArtifactRef[] = []
    for (const file of input.files) {
      const target = resolve(root, file.name)
      if (!isInside(root, target) || target === root) {
        throw new Error("Terminal artifact escapes the admitted run directory")
      }
      mkdirSync(dirname(target), { recursive: true })
      const stagedPath = join(
        dirname(target),
        `.${basename(target)}.${process.pid}.staged`,
      )
      writeFileSync(stagedPath, file.content, { flag: "w" })
      staged.push(stagedPath)
      renameSync(stagedPath, target)
      staged.pop()
      const bytes = Buffer.from(file.content)
      refs.push({
        role: file.role,
        name: file.name,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        sizeBytes: bytes.length,
      })
    }
    return refs
  } catch (error) {
    for (const path of staged) rmSync(path, { force: true })
    throw error
  }
}
