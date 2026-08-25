import { createHash, randomUUID } from "node:crypto"
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  type Stats,
  unlinkSync,
  writeSync,
} from "node:fs"
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path"
import type { AgentRuntimeContractId } from "../../../shared/agent-runtime-capabilities"
import {
  assertLocalJobApiCreateRequest,
  assertLocalJobApiRuntimeReadiness,
  LOCAL_JOB_API_DISCOVERY_FEATURES,
  LOCAL_JOB_API_EVENT_TYPES,
  LOCAL_JOB_API_RESOLVED_PROVIDER_SOURCES,
  LOCAL_JOB_API_VERSION,
  type LocalJobApiArtifact,
  type LocalJobApiArtifactManifest,
  type LocalJobApiEventEnvelope,
  type LocalJobApiEventType,
  type LocalJobApiResolvedProvider,
  type LocalJobApiResultEnvelope,
  type LocalJobApiRuntimeManifestEnvelope,
  type NormalizedLocalJobApiCompletionCreateRequest,
  type NormalizedLocalJobApiCreateRequest,
} from "../../../shared/local-job-api"
import {
  checkRegisteredAgentRuntimeCapability,
  listRegisteredAgentRuntimeManifests,
} from "../agent-runtime/runtime-registry"
import type { AgentJob, AgentJobEvent } from "../db/schema"
import { createId } from "../db/utils"
import {
  assertStableDirectoryPath,
  closeStableDirectory,
  fsyncStableDirectory,
  openStableDirectory,
  openStableDirectoryChild,
  type StableDirectoryHandle,
  stableDirectoryChildPath,
} from "../filesystem/stable-directory"
import { serializeAgentJob, serializeAgentJobEvent } from "./cli-output"
import {
  type AgentJobDatabase,
  createAgentJob,
  getAgentJob,
  listAgentJobEvents,
  retryAgentJob,
} from "./job-store"
import {
  assertHeadlessProviderSelectionUsableAtCreate,
  type HeadlessProviderBindingDependencies,
  inspectHeadlessDefaultProviderBinding,
  resolveExplicitHeadlessProviderProfile,
} from "./provider-binding"
import {
  type RuntimeReadinessResolverDependencies,
  resolveLocalJobApiRuntimeReadiness,
} from "./runtime-readiness"
import { findRegisteredProjectForCwdWithCanonicalPath } from "./schedules"

export type LocalJobApiCreatePrepared = {
  request: NormalizedLocalJobApiCreateRequest
  job: AgentJob
  runDir: LocalJobApiArtifactRunDir | null
}

type LocalJobApiArtifactFileReceipt = {
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
export type LocalJobApiArtifactRunDir = StableDirectoryHandle & {
  fileReceipts: Map<string, LocalJobApiArtifactFileReceipt>
}

export type LocalJobApiArtifactFilesystemHooks = {
  beforeAtomicRename?: (input: { fileName: string; runDirPath: string }) => void
}

export type LocalJobApiJobEnvelope = {
  apiVersion: typeof LOCAL_JOB_API_VERSION
  job: ReturnType<typeof serializeAgentJob>
}

export type LocalJobApiRuntimeManifestEnvelopeOptions = {
  db: AgentJobDatabase
  onDiagnostic?: (message: string) => void
  probe?: boolean
  providerBindingDependencies?: HeadlessProviderBindingDependencies
  readinessDependencies?: RuntimeReadinessResolverDependencies
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(
      `Invalid JSON request: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function completionStorageRuntime(
  request: NormalizedLocalJobApiCompletionCreateRequest,
): AgentRuntimeContractId {
  return request.runtime.id ?? "codex"
}

function completionPromptPreview(
  request: NormalizedLocalJobApiCompletionCreateRequest,
): string {
  return request.messages
    .map((message) => message.content)
    .join("\n\n")
    .trim()
}

export function parseLocalJobApiCreateRequestJson(
  value: string,
): NormalizedLocalJobApiCreateRequest {
  return assertLocalJobApiCreateRequest(parseJson(value))
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const rel = relative(parentPath, childPath)
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel))
}

function canonicalizePathWithExistingPrefix(targetPath: string): string {
  const resolved = resolve(targetPath)
  if (existsSync(resolved)) return realpathSync(resolved)

  const pendingParts: string[] = []
  let current = resolved
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) return resolved
    pendingParts.unshift(basename(current))
    current = parent
  }
  return join(realpathSync(current), ...pendingParts)
}

function pathHasFinalComponent(path: string): boolean {
  return path
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((part) => part.toLowerCase() === "final")
}

function pathHasComponent(path: string, component: string): boolean {
  return path
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((part) => part.toLowerCase() === component.toLowerCase())
}

export function validateLocalJobApiArtifactBaseDir(
  artifactBaseDir: string | null,
): void {
  if (!artifactBaseDir) return
  const base = resolve(artifactBaseDir)
  if (pathHasFinalComponent(base)) {
    throw new Error(
      "artifacts.baseDir cannot be inside a final artifact directory",
    )
  }
  if (pathHasComponent(base, ".git")) {
    throw new Error(
      "artifacts.baseDir cannot be inside a git metadata directory",
    )
  }
  if (existsSync(base) && !lstatSync(base).isDirectory()) {
    throw new Error("artifacts.baseDir must be a directory")
  }
}

function assertNoSymlinkInExistingProjectPath(
  targetPath: string,
  projectRealPath: string,
): void {
  const relativePath = relative(projectRealPath, targetPath)
  if (!relativePath) return
  let current = projectRealPath
  for (const part of relativePath.split(/[\\/]+/).filter(Boolean)) {
    current = join(current, part)
    if (!existsSync(current)) return
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error("artifacts.baseDir cannot contain symlinks")
    }
  }
}

export function validateLocalJobApiArtifactBaseDirForProject(
  artifactBaseDir: string | null,
  projectCwd: string,
): void {
  validateLocalJobApiArtifactBaseDir(artifactBaseDir)
  if (!artifactBaseDir) return
  const base = canonicalizePathWithExistingPrefix(artifactBaseDir)
  const projectReal = realpathSync(projectCwd)
  if (!isPathInside(projectReal, base)) {
    throw new Error("artifacts.baseDir must be inside project.cwd")
  }
  assertNoSymlinkInExistingProjectPath(base, projectReal)
}

function openOrCreateArtifactBaseDirectory(
  projectReal: string,
  artifactBaseDir: string,
): StableDirectoryHandle {
  const targetPath = resolve(artifactBaseDir)
  if (!isPathInside(projectReal, targetPath)) {
    throw new Error("artifacts.baseDir must be inside project.cwd")
  }
  const relativePath = relative(projectReal, targetPath)
  let current = openStableDirectory(
    projectReal,
    "Local Job artifact project directory",
  )
  try {
    for (const part of relativePath.split(/[\\/]+/).filter(Boolean)) {
      const childPath = stableDirectoryChildPath(current, part)
      try {
        const stat = lstatSync(childPath)
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
          throw new Error("artifacts.baseDir cannot contain symlinks or files")
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        mkdirSync(childPath, { recursive: false, mode: 0o700 })
        fsyncStableDirectory(current, "Local Job artifact parent directory")
      }

      const child = openStableDirectoryChild(
        current,
        part,
        "Local Job artifact directory",
      )
      try {
        closeStableDirectory(current)
      } catch (error) {
        closeStableDirectory(child)
        throw error
      }
      current = child
    }
    assertStableDirectoryPath(current, "Local Job artifact base directory")
    return current
  } catch (error) {
    closeStableDirectory(current)
    throw error
  }
}

export function prepareLocalJobApiArtifactRunDir(
  artifactBaseDir: string | null,
  jobId: string,
  projectCwd: string,
): LocalJobApiArtifactRunDir | null {
  if (!artifactBaseDir) return null
  validateLocalJobApiArtifactBaseDirForProject(artifactBaseDir, projectCwd)
  const projectReal = realpathSync(projectCwd)
  const base = resolve(artifactBaseDir)
  const baseDirectory = openOrCreateArtifactBaseDirectory(projectReal, base)
  const baseReal = baseDirectory.path
  if (pathHasFinalComponent(baseReal)) {
    closeStableDirectory(baseDirectory)
    throw new Error(
      "artifacts.baseDir cannot resolve inside a final artifact directory",
    )
  }
  if (pathHasComponent(baseReal, ".git")) {
    closeStableDirectory(baseDirectory)
    throw new Error(
      "artifacts.baseDir cannot resolve inside a git metadata directory",
    )
  }
  if (!isPathInside(projectReal, baseReal)) {
    closeStableDirectory(baseDirectory)
    throw new Error("artifacts.baseDir escaped project.cwd")
  }
  let directory: StableDirectoryHandle | null = null
  try {
    const anchoredRunDir = stableDirectoryChildPath(baseDirectory, jobId)
    mkdirSync(anchoredRunDir, { recursive: false, mode: 0o700 })
    fsyncStableDirectory(baseDirectory, "Local Job artifact base directory")
    assertStableDirectoryPath(
      baseDirectory,
      "Local Job artifact base directory",
    )
    directory = openStableDirectoryChild(
      baseDirectory,
      jobId,
      "Artifact run directory",
    )
  } catch (error) {
    closeStableDirectory(baseDirectory)
    throw error
  }
  try {
    closeStableDirectory(baseDirectory)
  } catch (error) {
    if (directory) closeStableDirectory(directory)
    throw error
  }
  if (!directory) throw new Error("Artifact run directory was not opened")
  try {
    const runReal = directory.path
    if (!isPathInside(baseReal, runReal)) {
      throw new Error("Artifact run directory escaped artifact base directory")
    }
    if (!isPathInside(projectReal, runReal)) {
      throw new Error("Artifact run directory escaped project.cwd")
    }
    return Object.assign(directory, {
      fileReceipts: new Map<string, LocalJobApiArtifactFileReceipt>(),
    })
  } catch (error) {
    closeStableDirectory(directory)
    throw error
  }
}

function stableStringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function isSameArtifactFile(
  stat: Stats,
  receipt: LocalJobApiArtifactFileReceipt,
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

function assertArtifactRunDir(runDir: LocalJobApiArtifactRunDir): void {
  assertStableDirectoryPath(runDir, "Artifact run")
}

function readStableRegularArtifactFile(
  directory: StableDirectoryHandle,
  childName: string,
  expected?: LocalJobApiArtifactFileReceipt,
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
    const stableReceipt: LocalJobApiArtifactFileReceipt = {
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

function artifactFileReceipt(stat: Stats): LocalJobApiArtifactFileReceipt {
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  }
}

function validateArtifactTargetBeforeWrite(
  runDir: LocalJobApiArtifactRunDir,
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

function writeArtifactFileAtomically(
  runDir: LocalJobApiArtifactRunDir,
  fileName: string,
  content: string,
  hooks?: LocalJobApiArtifactFilesystemHooks,
): string {
  assertArtifactRunDir(runDir)
  validateArtifactTargetBeforeWrite(runDir, fileName)
  const targetPath = join(runDir.path, fileName)
  const targetOperationPath = stableDirectoryChildPath(runDir, fileName)
  const tempName = `.${fileName}.locus-${process.pid}-${randomUUID()}.tmp`
  const tempOperationPath = stableDirectoryChildPath(runDir, tempName)
  let fd: number | null = null
  let tempExists = false
  let tempReceipt: LocalJobApiArtifactFileReceipt | null = null

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

    assertArtifactRunDir(runDir)
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
    assertArtifactRunDir(runDir)
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

function fileArtifact(
  role: string,
  runDir: LocalJobApiArtifactRunDir,
  fileName: string,
): LocalJobApiArtifact {
  const publicPath = join(runDir.path, fileName)
  const content = readStableRegularArtifactFile(
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
    contentType: "application/json",
    sizeBytes: content.byteLength,
  }
}

function writeJsonFile(
  runDir: LocalJobApiArtifactRunDir,
  fileName: string,
  value: unknown,
  hooks?: LocalJobApiArtifactFilesystemHooks,
): string {
  return writeArtifactFileAtomically(
    runDir,
    fileName,
    stableStringify(value),
    hooks,
  )
}

function eventCreatedAt(event: AgentJobEvent): string | null {
  const createdAt = event.createdAt
    ? event.createdAt instanceof Date
      ? event.createdAt
      : new Date(event.createdAt)
    : null
  if (!createdAt || Number.isNaN(createdAt.getTime())) return null
  return createdAt.toISOString()
}

function parsePayload(event: AgentJobEvent): unknown {
  try {
    return JSON.parse(event.payloadJson || "{}")
  } catch {
    return {}
  }
}

export function toLocalJobApiEventEnvelope(
  event: AgentJobEvent,
): LocalJobApiEventEnvelope {
  const type = (LOCAL_JOB_API_EVENT_TYPES as readonly string[]).includes(
    event.type,
  )
    ? (event.type as LocalJobApiEventType)
    : "status"
  return {
    apiVersion: LOCAL_JOB_API_VERSION,
    jobId: event.jobId,
    sequence: event.sequence,
    type,
    createdAt: eventCreatedAt(event),
    payload: parsePayload(event),
  }
}

export function toLocalJobApiJobEnvelope(
  job: AgentJob,
): LocalJobApiJobEnvelope {
  return {
    apiVersion: LOCAL_JOB_API_VERSION,
    job: serializeAgentJob(job),
  }
}

export async function toLocalJobApiRuntimeManifestEnvelope(
  options: LocalJobApiRuntimeManifestEnvelopeOptions,
): Promise<LocalJobApiRuntimeManifestEnvelope> {
  const readinessDependencies: RuntimeReadinessResolverDependencies = {
    ...options.readinessDependencies,
  }
  if (!readinessDependencies.inspectDefaultProviderBinding) {
    readinessDependencies.inspectDefaultProviderBinding = (runtime) =>
      inspectHeadlessDefaultProviderBinding({
        db: options.db,
        runtime,
        dependencies: options.providerBindingDependencies,
      })
  }
  const runtimes = await Promise.all(
    listRegisteredAgentRuntimeManifests({ scope: "contract" }).map(
      async (runtime) => {
        const runtimeId = runtime.runtimeId as AgentRuntimeContractId
        const readiness = await resolveLocalJobApiRuntimeReadiness({
          dependencies: readinessDependencies,
          onDiagnostic: options.onDiagnostic,
          probe: options.probe,
          runtimeId,
        })
        assertLocalJobApiRuntimeReadiness(readiness)
        return {
          ...runtime,
          readiness,
        }
      },
    ),
  )
  return {
    apiVersion: LOCAL_JOB_API_VERSION,
    features: [...LOCAL_JOB_API_DISCOVERY_FEATURES],
    runtimes,
  }
}

function parseJobResult(job: AgentJob): unknown {
  if (!job.resultJson) return null
  try {
    return JSON.parse(job.resultJson)
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function compactStoredProviderSelection(input: {
  profileId: unknown
  model: unknown
}): { profileId?: string; model?: string } | undefined {
  const profileId = nullableString(input.profileId)
  const model = nullableString(input.model)
  if (!profileId && !model) return undefined
  return {
    ...(profileId ? { profileId } : {}),
    ...(model ? { model } : {}),
  }
}

function parseJobInput(job: AgentJob): Record<string, unknown> {
  try {
    const parsed = JSON.parse(job.inputJson || "{}")
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function getLocalJobApiStoredRequest(
  job: AgentJob,
): NormalizedLocalJobApiCreateRequest {
  if (job.source !== "api") throw new Error(`Job ${job.id} is not an API job`)
  const input = parseJobInput(job)
  if (job.kind === "completion") {
    const storedConsumer = isRecord(input.consumer) ? input.consumer : {}
    const storedRuntime = isRecord(input.runtime) ? input.runtime : {}
    const storedProvider = isRecord(input.provider) ? input.provider : {}
    return assertLocalJobApiCreateRequest({
      apiVersion: input.apiVersion ?? LOCAL_JOB_API_VERSION,
      kind: "completion",
      consumer: {
        id: job.apiConsumerId ?? storedConsumer.id,
        runExternalId: job.apiConsumerRunId ?? storedConsumer.runExternalId,
      },
      runtime:
        typeof storedRuntime.id === "string" ? { id: storedRuntime.id } : null,
      provider: compactStoredProviderSelection({
        profileId: job.providerProfileId ?? storedProvider.profileId,
        model: job.modelOverride ?? storedProvider.model,
      }),
      messages: input.messages,
      maxTokens: input.maxTokens,
      temperature: input.temperature,
      responseFormat: input.responseFormat,
    })
  }
  const storedRuntime = isRecord(input.runtime) ? input.runtime : {}
  const storedProject = isRecord(input.project) ? input.project : {}
  const storedConsumer = isRecord(input.consumer) ? input.consumer : {}
  const storedArtifacts = isRecord(input.artifacts) ? input.artifacts : {}
  const storedProvider = isRecord(input.provider) ? input.provider : {}
  const storedInput = isRecord(input.input) ? input.input : {}
  const prompt = typeof input.prompt === "string" ? input.prompt : ""
  return assertLocalJobApiCreateRequest({
    apiVersion: input.apiVersion ?? LOCAL_JOB_API_VERSION,
    kind: "agent",
    consumer: {
      id: job.apiConsumerId ?? storedConsumer.id,
      runExternalId: job.apiConsumerRunId ?? storedConsumer.runExternalId,
    },
    project: {
      cwd: job.cwd,
      projectId: job.projectId ?? storedProject.projectId,
    },
    runtime: {
      id: job.runtime,
      requiredCapabilities: storedRuntime.requiredCapabilities,
      executionProfile: storedRuntime.executionProfile,
      policyGrant: storedRuntime.policyGrant,
    },
    mode: job.mode,
    prompt: {
      text: prompt || job.promptPreview || "Retry API job",
    },
    provider: compactStoredProviderSelection({
      profileId: job.providerProfileId ?? storedProvider.profileId,
      model: job.modelOverride ?? storedProvider.model,
    }),
    input: storedInput,
    artifacts: storedArtifacts,
  })
}

function readArtifacts(path: string | null): LocalJobApiArtifact[] {
  if (!path) return []
  let directory: StableDirectoryHandle | null = null
  try {
    directory = openStableDirectory(
      dirname(path),
      "Local Job artifact manifest directory",
    )
    const parsed = JSON.parse(
      readStableRegularArtifactFile(directory, basename(path)).toString("utf8"),
    ) as {
      artifacts?: unknown
    }
    return Array.isArray(parsed.artifacts)
      ? (parsed.artifacts as LocalJobApiArtifact[])
      : []
  } catch {
    return []
  } finally {
    if (directory) closeStableDirectory(directory)
  }
}

function parseResolvedProviderValue(
  provider: unknown,
): LocalJobApiResolvedProvider | null {
  if (!isRecord(provider)) return null
  const source =
    typeof provider.source === "string" &&
    (LOCAL_JOB_API_RESOLVED_PROVIDER_SOURCES as readonly string[]).includes(
      provider.source,
    )
      ? provider.source
      : null
  if (!source) return null
  return {
    source,
    profileId: nullableString(provider.profileId),
    model: nullableString(provider.model),
  } as LocalJobApiResolvedProvider
}

function parseResolvedProviderFromResult(
  result: unknown,
): LocalJobApiResolvedProvider | null {
  if (!isRecord(result)) return null
  return parseResolvedProviderValue(result.resolvedProvider)
}

function parseResolvedProviderFromEvents(
  events: AgentJobEvent[] | undefined,
): LocalJobApiResolvedProvider | null {
  if (!events) return null
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const payload = parsePayload(events[index])
    if (!isRecord(payload)) continue
    const providerBinding = isRecord(payload.providerBinding)
      ? payload.providerBinding
      : null
    const resolvedProvider = parseResolvedProviderValue(
      providerBinding?.resolvedProvider,
    )
    if (resolvedProvider) return resolvedProvider
  }
  return null
}

function resolvedProviderForJob(
  job: AgentJob,
  events?: AgentJobEvent[],
): LocalJobApiResolvedProvider {
  const fromResult = parseResolvedProviderFromResult(parseJobResult(job))
  if (fromResult) return fromResult
  const fromEvents = parseResolvedProviderFromEvents(events)
  if (fromEvents) return fromEvents
  return {
    source: job.providerProfileId ? "request-profile" : "native",
    profileId: job.providerProfileId ?? null,
    model: job.modelOverride ?? null,
  }
}

export function toLocalJobApiResultEnvelope(
  job: AgentJob,
  artifacts: LocalJobApiArtifact[] = readArtifacts(job.artifactManifestPath),
  events?: AgentJobEvent[],
): LocalJobApiResultEnvelope {
  return {
    apiVersion: LOCAL_JOB_API_VERSION,
    jobId: job.id,
    status: job.status,
    runtime: job.runtime,
    mode: job.mode,
    consumer: job.apiConsumerId
      ? {
          id: job.apiConsumerId,
          runExternalId: job.apiConsumerRunId ?? null,
        }
      : null,
    artifactManifestPath: job.artifactManifestPath,
    artifacts,
    diagnostics: job.errorCode
      ? [
          {
            code: job.errorCode,
            message: job.errorMessage ?? job.errorCode,
          },
        ]
      : [],
    resolvedProvider: resolvedProviderForJob(job, events),
    result: parseJobResult(job),
  }
}

export function validateLocalJobApiRequiredCapabilities(
  request: NormalizedLocalJobApiCreateRequest,
): void {
  if (request.kind !== "agent") return
  for (const capabilityId of request.runtime.requiredCapabilities) {
    const gate = checkRegisteredAgentRuntimeCapability({
      runtime: request.runtime.id,
      capabilityId,
    })
    if (!gate.ok) {
      throw new Error(gate.diagnostic.message)
    }
  }
}

export function createLocalJobApiJob(
  db: AgentJobDatabase,
  request: NormalizedLocalJobApiCreateRequest,
  appVersion: string | null | undefined,
): LocalJobApiCreatePrepared {
  if (request.kind === "completion") {
    resolveExplicitHeadlessProviderProfile({
      db,
      runtime: request.runtime.id,
      providerProfileId: request.provider.profileId,
      modelOverride: request.provider.model,
    })
    const job = createAgentJob(db, {
      id: createId(),
      kind: "completion",
      source: "api",
      runtime: completionStorageRuntime(request),
      mode: "agent",
      cwd: process.cwd(),
      prompt: completionPromptPreview(request) || "Completion request",
      input: {
        apiVersion: request.apiVersion,
        kind: request.kind,
        consumer: request.consumer,
        runtime: request.runtime,
        provider: request.provider,
        messages: request.messages,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        responseFormat: request.responseFormat,
      },
      apiConsumerId: request.consumer.id,
      apiConsumerRunId: request.consumer.runExternalId,
      providerProfileId: request.provider.profileId,
      modelOverride: request.provider.model,
      createdByVersion: appVersion ?? null,
    })
    return { request, job: getAgentJob(db, job.id) ?? job, runDir: null }
  }

  validateLocalJobApiRequiredCapabilities(request)
  assertHeadlessProviderSelectionUsableAtCreate({
    db,
    runtime: request.runtime.id,
    providerProfileId: request.provider.profileId,
  })
  validateLocalJobApiArtifactBaseDir(request.artifacts.baseDir)
  const project = findRegisteredProjectForCwdWithCanonicalPath(
    db,
    request.project.cwd,
    request.project.projectId,
    "API run cwd",
  )
  const jobId = createId()
  const runDir = prepareLocalJobApiArtifactRunDir(
    request.artifacts.baseDir,
    jobId,
    project.cwd,
  )
  const manifestPath = runDir ? join(runDir.path, "artifacts.json") : null
  try {
    const job = createAgentJob(db, {
      id: jobId,
      source: "api",
      runtime: request.runtime.id,
      mode: request.mode,
      cwd: project.cwd,
      prompt: request.prompt.text,
      input: {
        apiVersion: request.apiVersion,
        consumer: request.consumer,
        project: request.project,
        runtime: request.runtime,
        mode: request.mode,
        provider: request.provider,
        input: request.input,
        artifacts: request.artifacts,
        prompt: request.prompt.text,
      },
      projectId: project.project.id,
      apiConsumerId: request.consumer.id,
      apiConsumerRunId: request.consumer.runExternalId,
      artifactBaseDir: runDir?.path ?? request.artifacts.baseDir,
      artifactManifestPath: manifestPath,
      providerProfileId: request.provider.profileId,
      modelOverride: request.provider.model,
      createdByVersion: appVersion ?? null,
    })

    return { request, job: getAgentJob(db, job.id) ?? job, runDir }
  } catch (error) {
    closeLocalJobApiArtifactRunDir(runDir)
    throw error
  }
}

export function retryLocalJobApiJob(
  db: AgentJobDatabase,
  job: AgentJob,
): LocalJobApiCreatePrepared {
  const request = getLocalJobApiStoredRequest(job)
  if (request.kind === "completion") {
    resolveExplicitHeadlessProviderProfile({
      db,
      runtime: request.runtime.id,
      providerProfileId: request.provider.profileId,
      modelOverride: request.provider.model,
    })
    const retry = retryAgentJob(db, job.id, {
      id: createId(),
      artifactBaseDir: null,
      artifactManifestPath: null,
    })
    return { request, job: retry, runDir: null }
  }
  validateLocalJobApiRequiredCapabilities(request)
  const project = findRegisteredProjectForCwdWithCanonicalPath(
    db,
    request.project.cwd,
    request.project.projectId,
    "API retry cwd",
  )
  const retryId = createId()
  const runDir = prepareLocalJobApiArtifactRunDir(
    request.artifacts.baseDir,
    retryId,
    project.cwd,
  )
  try {
    const retry = retryAgentJob(db, job.id, {
      id: retryId,
      artifactBaseDir: runDir?.path ?? request.artifacts.baseDir,
      artifactManifestPath: runDir ? join(runDir.path, "artifacts.json") : null,
    })
    return { request, job: retry, runDir }
  } catch (error) {
    closeLocalJobApiArtifactRunDir(runDir)
    throw error
  }
}

export function writeLocalJobApiInitialArtifacts(input: {
  runDir: LocalJobApiArtifactRunDir | null
  request: NormalizedLocalJobApiCreateRequest
  job: AgentJob
  events: AgentJobEvent[]
  filesystemHooks?: LocalJobApiArtifactFilesystemHooks
}): LocalJobApiArtifact[] {
  if (!input.runDir) return []
  try {
    assertArtifactRunDir(input.runDir)
    writeJsonFile(
      input.runDir,
      "request.json",
      input.request,
      input.filesystemHooks,
    )
    writeArtifactFileAtomically(
      input.runDir,
      "events.jsonl",
      input.events
        .map((event) => JSON.stringify(toLocalJobApiEventEnvelope(event)))
        .join("\n") + (input.events.length > 0 ? "\n" : ""),
      input.filesystemHooks,
    )
    const artifacts = [
      fileArtifact("request", input.runDir, "request.json"),
      fileArtifact("events", input.runDir, "events.jsonl"),
    ]
    const manifest: LocalJobApiArtifactManifest = {
      apiVersion: LOCAL_JOB_API_VERSION,
      jobId: input.job.id,
      artifactBaseDir: input.runDir.path,
      artifacts,
      createdAt: new Date().toISOString(),
    }
    writeJsonFile(
      input.runDir,
      "artifacts.json",
      manifest,
      input.filesystemHooks,
    )
    return [
      ...artifacts,
      fileArtifact("manifest", input.runDir, "artifacts.json"),
    ]
  } catch (error) {
    closeLocalJobApiArtifactRunDir(input.runDir)
    throw error
  }
}

export function writeLocalJobApiFinalArtifacts(input: {
  runDir: LocalJobApiArtifactRunDir | null
  job: AgentJob
  events: AgentJobEvent[]
  filesystemHooks?: LocalJobApiArtifactFilesystemHooks
}): LocalJobApiArtifact[] {
  if (!input.runDir) return []
  try {
    assertArtifactRunDir(input.runDir)
    writeArtifactFileAtomically(
      input.runDir,
      "events.jsonl",
      input.events
        .map((event) => JSON.stringify(toLocalJobApiEventEnvelope(event)))
        .join("\n") + (input.events.length > 0 ? "\n" : ""),
      input.filesystemHooks,
    )
    const artifacts = [
      fileArtifact("request", input.runDir, "request.json"),
      fileArtifact("events", input.runDir, "events.jsonl"),
    ]
    writeJsonFile(
      input.runDir,
      "result.json",
      toLocalJobApiResultEnvelope(input.job, artifacts, input.events),
      input.filesystemHooks,
    )
    artifacts.push(fileArtifact("result", input.runDir, "result.json"))
    const manifest: LocalJobApiArtifactManifest = {
      apiVersion: LOCAL_JOB_API_VERSION,
      jobId: input.job.id,
      artifactBaseDir: input.runDir.path,
      artifacts,
      createdAt: new Date().toISOString(),
    }
    writeJsonFile(
      input.runDir,
      "artifacts.json",
      manifest,
      input.filesystemHooks,
    )
    return [
      ...artifacts,
      fileArtifact("manifest", input.runDir, "artifacts.json"),
    ]
  } finally {
    closeLocalJobApiArtifactRunDir(input.runDir)
  }
}

export function closeLocalJobApiArtifactRunDir(
  runDir: LocalJobApiArtifactRunDir | null,
): void {
  if (runDir) closeStableDirectory(runDir)
}

export function getLocalJobApiJobOrThrow(
  db: AgentJobDatabase,
  jobId: string,
): AgentJob {
  const job = getAgentJob(db, jobId)
  if (!job) throw new Error(`Unknown API job: ${jobId}`)
  if (job.source !== "api") throw new Error(`Job ${jobId} is not an API job`)
  return job
}

export function getLocalJobApiEvents(
  db: AgentJobDatabase,
  jobId: string,
  afterSequence = 0,
): LocalJobApiEventEnvelope[] {
  getLocalJobApiJobOrThrow(db, jobId)
  return listAgentJobEvents(db, jobId, afterSequence).map(
    toLocalJobApiEventEnvelope,
  )
}

export function getSerializedLocalJobApiEvents(
  db: AgentJobDatabase,
  jobId: string,
  afterSequence = 0,
): ReturnType<typeof serializeAgentJobEvent>[] {
  getLocalJobApiJobOrThrow(db, jobId)
  return listAgentJobEvents(db, jobId, afterSequence).map(
    serializeAgentJobEvent,
  )
}
