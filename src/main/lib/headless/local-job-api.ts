import { randomUUID } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  statSync,
} from "node:fs"
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path"
import { eq } from "drizzle-orm"
import type { AgentRuntimeContractId } from "../../../shared/agent-runtime-capabilities"
import {
  assertLocalJobApiCreateRequest,
  assertLocalJobApiRetryRequest,
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
  type LocalJobApiRetryRequest,
  type LocalJobApiRuntimeManifestEnvelope,
  type NormalizedLocalJobApiCompletionCreateRequest,
  type NormalizedLocalJobApiCreateRequest,
  splitLocalJobApiIdempotencyKey,
} from "../../../shared/local-job-api"
import {
  admitRunDirArtifacts,
  assertRunArtifactRunDir,
  describeRunArtifactFile,
  discardRunArtifactFile,
  isRunArtifactNativeRole,
  publishRunArtifactFile,
  type RunArtifactFileReceipt,
  type RunArtifactFilesystemHooks,
  type RunArtifactRunDir,
  type RunDirArtifact,
  readRunArtifactFile,
  reopenAdmittedRunDir,
  runDirInitialArtifactsObservationKey,
  verifyRunDirArtifactRef,
  writeRunArtifactFile,
} from "../agent-runtime/run-artifacts"
import type { LedgerRecord } from "../agent-runtime/run-event-ledger"
import { getOrCreateRunEventLedger } from "../agent-runtime/run-event-ledger-host"
import type { JsonValue } from "../agent-runtime/runtime-events"
import {
  checkRegisteredAgentRuntimeCapability,
  listRegisteredAgentRuntimeManifests,
} from "../agent-runtime/runtime-registry"
import { type AgentJob, type AgentJobEvent, projects } from "../db/schema"
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
import {
  getProjectRegistrationForCwd,
  isProjectRegistrationError,
} from "../projects/registry"
import {
  parsePublicJobResult,
  serializeAgentJob,
  serializeAgentJobEvent,
} from "./cli-output"
import type { RunClaimGateDecision } from "./job-runner"
import {
  type AgentJobDatabase,
  type AgentJobIdempotencyReservationInput,
  createAgentJob,
  getAgentJob,
  listAgentJobEvents,
  lookupCommittedRunEventFact,
  type QueuedCancelTerminalProjection,
  retryAgentJob,
  settleQueuedAgentJobFailed,
} from "./job-store"
import {
  assertHeadlessProviderSelectionUsableAtCreate,
  type HeadlessProviderBindingDependencies,
  HeadlessProviderBindingError,
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

/**
 * A run directory is authority captured at exclusive creation time, not merely
 * a pathname that an untrusted workspace process may later replace. The file
 * writer/reader lives with the run artifact owner (run-artifacts.ts).
 */
export type LocalJobApiArtifactRunDir = RunArtifactRunDir

export type LocalJobApiArtifactFilesystemHooks = RunArtifactFilesystemHooks

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

/**
 * Parses a create/submit body: the optional `idempotencyKey` member is split
 * off before the existing create normalizer runs, so it never reaches the
 * normalized, stored or written request. `hasKey` lets create refuse it.
 */
export function parseLocalJobApiSubmitRequestJson(value: string): {
  request: NormalizedLocalJobApiCreateRequest
  hasKey: boolean
  idempotencyKey: unknown
} {
  const { body, hasKey, key } = splitLocalJobApiIdempotencyKey(parseJson(value))
  return {
    request: assertLocalJobApiCreateRequest(body),
    hasKey,
    idempotencyKey: key,
  }
}

/** Parses a `runs retry --request` body (apiVersion, consumer.id, key). */
export function parseLocalJobApiRetryRequestJson(
  value: string,
): LocalJobApiRetryRequest {
  return assertLocalJobApiRetryRequest(parseJson(value))
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
      fileReceipts: new Map<string, RunArtifactFileReceipt>(),
    })
  } catch (error) {
    closeStableDirectory(directory)
    throw error
  }
}

function stableStringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function writeJsonFile(
  runDir: LocalJobApiArtifactRunDir,
  fileName: string,
  value: unknown,
  hooks?: LocalJobApiArtifactFilesystemHooks,
): string {
  return writeRunArtifactFile(runDir, fileName, stableStringify(value), hooks)
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

/**
 * Internal event types outside the 12 public v1 types project to `status` at
 * the same sequence with `payload.subtype` set to the original internal type
 * name. Object payload members are preserved (no double wrap); non-object
 * historical payloads are returned unchanged.
 */
function coercedStatusPayload(internalType: string, payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload
  }
  return { ...(payload as Record<string, unknown>), subtype: internalType }
}

export function toLocalJobApiEventEnvelope(
  event: AgentJobEvent,
): LocalJobApiEventEnvelope {
  const isPublicType = (
    LOCAL_JOB_API_EVENT_TYPES as readonly string[]
  ).includes(event.type)
  const payload = parsePayload(event)
  return {
    apiVersion: LOCAL_JOB_API_VERSION,
    jobId: event.jobId,
    sequence: event.sequence,
    type: isPublicType ? (event.type as LocalJobApiEventType) : "status",
    createdAt: eventCreatedAt(event),
    payload: isPublicType ? payload : coercedStatusPayload(event.type, payload),
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
      readRunArtifactFile(directory, basename(path)).toString("utf8"),
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

function registeredArtifactKey(entry: unknown): string | null {
  if (!isRecord(entry)) return null
  return typeof entry.role === "string" && typeof entry.sha256 === "string"
    ? `${entry.role}\u0000${entry.sha256}`
    : null
}

/**
 * Manifest entries a result reader may expose (design "Artifacts and
 * Terminal Commit Order": no prospective terminal or unregistered final ref
 * is readable before its commit). A ledger job lists only manifest entries
 * whose role and digest the ledger registered: the refs committed with its
 * one completed, or the committed `artifact_created` refs before it. A final
 * manifest prepared for a terminal that has not committed is therefore not
 * exposed. Pre-ledger (v0) jobs keep reading their historical manifest.
 */
function readRegisteredArtifacts(
  job: AgentJob,
  events: readonly AgentJobEvent[] | undefined,
): LocalJobApiArtifact[] {
  const artifacts = readArtifacts(job.artifactManifestPath)
  if (job.ledgerVersion === 0) return artifacts
  const registered = new Set<string>()
  const register = (list: unknown) => {
    for (const entry of Array.isArray(list) ? list : []) {
      const key = registeredArtifactKey(entry)
      if (key) registered.add(key)
    }
  }
  const result = parseJobResult(job)
  if (isRecord(result)) register(result.artifactRefs)
  for (const event of events ?? []) {
    if (event.type !== "artifact_created") continue
    try {
      const payload = JSON.parse(event.payloadJson) as unknown
      if (isRecord(payload)) register(payload.artifacts)
    } catch {
      // A malformed row registers nothing.
    }
  }
  return artifacts.filter((artifact) => {
    const key = registeredArtifactKey(artifact)
    return key !== null && registered.has(key)
  })
}

export function toLocalJobApiResultEnvelope(
  job: AgentJob,
  artifacts?: LocalJobApiArtifact[],
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
    artifacts: artifacts ?? readRegisteredArtifacts(job, events),
    diagnostics: job.errorCode
      ? [
          {
            code: job.errorCode,
            message: job.errorMessage ?? job.errorCode,
          },
        ]
      : [],
    resolvedProvider: resolvedProviderForJob(job, events),
    // The public inner result never carries the ledger's internal
    // registered-artifact refs (they stay a job-row reader detail).
    result: parsePublicJobResult(job.resultJson),
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

export type LocalJobApiAdmissionOptions = {
  /** Idempotency reservation inserted with the job row (one transaction). */
  reservation?: AgentJobIdempotencyReservationInput | null
}

export type LocalJobApiProjectIdentity = {
  canonicalPath: string
  dev: string
  ino: string
}

/**
 * Canonical identity of an admitted cwd (design D5): its canonical path and
 * device/inode, kept only in the job's internal inputJson
 * `submissionContext.projectIdentity` (never serialized or written to
 * request.json).
 */
export function localJobApiProjectIdentity(
  cwd: string,
): LocalJobApiProjectIdentity {
  const canonicalPath = realpathSync(cwd)
  const stat = statSync(canonicalPath, { bigint: true })
  if (!stat.isDirectory()) throw new Error("API run cwd is not a directory")
  return {
    canonicalPath,
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
  }
}

function storedProjectIdentity(
  job: AgentJob,
): LocalJobApiProjectIdentity | null {
  const context = parseJobInput(job).submissionContext
  const identity = isRecord(context) ? context.projectIdentity : null
  if (
    !isRecord(identity) ||
    typeof identity.canonicalPath !== "string" ||
    typeof identity.dev !== "string" ||
    typeof identity.ino !== "string"
  ) {
    return null
  }
  return {
    canonicalPath: identity.canonicalPath,
    dev: identity.dev,
    ino: identity.ino,
  }
}

function plannedRunDirPaths(
  artifactBaseDir: string | null,
  jobId: string,
): { runDirPath: string; manifestPath: string } | null {
  if (!artifactBaseDir) return null
  const runDirPath = join(
    canonicalizePathWithExistingPrefix(artifactBaseDir),
    jobId,
  )
  return { runDirPath, manifestPath: join(runDirPath, "artifacts.json") }
}

/**
 * Creates the admitted run directory of a job whose creation fact already
 * committed (design D3: only the reservation winner mkdirs, after the
 * creation commit). The opened directory must be the one the job row names.
 */
function createAdmittedRunDir(
  artifactBaseDir: string | null,
  job: AgentJob,
  projectCwd: string,
): LocalJobApiArtifactRunDir | null {
  if (!artifactBaseDir) return null
  const runDir = prepareLocalJobApiArtifactRunDir(
    artifactBaseDir,
    job.id,
    projectCwd,
  )
  if (runDir && runDir.path !== job.artifactBaseDir) {
    closeLocalJobApiArtifactRunDir(runDir)
    throw new Error("Artifact run directory does not match the admitted job")
  }
  return runDir
}

/**
 * Admission adapter of an API create/submit intent: existing v1 gates, then
 * the queued job row (+ optional reservation) and its committed creation
 * fact, then the winner-only run directory. The submission core
 * (run-submission.ts) orchestrates idempotency, initial admission and ack.
 */
export async function createLocalJobApiJob(
  db: AgentJobDatabase,
  request: NormalizedLocalJobApiCreateRequest,
  appVersion: string | null | undefined,
  options: LocalJobApiAdmissionOptions = {},
): Promise<LocalJobApiCreatePrepared> {
  if (request.kind === "completion") {
    resolveExplicitHeadlessProviderProfile({
      db,
      runtime: request.runtime.id,
      providerProfileId: request.provider.profileId,
      modelOverride: request.provider.model,
    })
    const job = await createAgentJob(
      db,
      {
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
      },
      { reservation: options.reservation },
    )
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
  validateLocalJobApiArtifactBaseDirForProject(
    request.artifacts.baseDir,
    project.cwd,
  )
  const jobId = createId()
  const planned = plannedRunDirPaths(request.artifacts.baseDir, jobId)
  const job = await createAgentJob(
    db,
    {
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
        submissionContext: {
          projectIdentity: localJobApiProjectIdentity(project.cwd),
        },
      },
      projectId: project.project.id,
      apiConsumerId: request.consumer.id,
      apiConsumerRunId: request.consumer.runExternalId,
      artifactBaseDir: planned?.runDirPath ?? request.artifacts.baseDir,
      artifactManifestPath: planned?.manifestPath ?? null,
      providerProfileId: request.provider.profileId,
      modelOverride: request.provider.model,
      createdByVersion: appVersion ?? null,
    },
    { reservation: options.reservation },
  )
  const created = getAgentJob(db, job.id) ?? job
  const runDir = await admittedRunDirOrSettleFailed(db, created, () =>
    createAdmittedRunDir(request.artifacts.baseDir, created, project.cwd),
  )
  return { request, job: created, runDir }
}

/**
 * The creation fact already committed: a run directory that cannot be
 * created settles the attempt failed through the host (the attempt and its
 * reservation are kept, no committed fact is deleted).
 */
async function admittedRunDirOrSettleFailed(
  db: AgentJobDatabase,
  job: AgentJob,
  create: () => LocalJobApiArtifactRunDir | null,
): Promise<LocalJobApiArtifactRunDir | null> {
  try {
    return create()
  } catch (error) {
    await settleLocalJobApiAdmissionFailure(db, job.id, error)
    throw error
  }
}

/** Host settlement of an admitted-but-not-started API Run whose admission failed. */
export async function settleLocalJobApiAdmissionFailure(
  db: AgentJobDatabase,
  jobId: string,
  error: unknown,
): Promise<void> {
  try {
    await settleQueuedAgentJobFailed(db, jobId, {
      errorCode: "artifact_admission_failed",
      errorMessage:
        error instanceof Error ? error.message : "Run admission failed.",
    })
  } catch {
    // The admission error stays the reported failure; a job that cannot be
    // settled remains queued without admission and is never claimed.
  }
}

/**
 * Admission adapter of an API retry intent: a new attempt of a terminal
 * source with its stored input, gated like create, plus the winner-only
 * run directory.
 */
export async function retryLocalJobApiJob(
  db: AgentJobDatabase,
  job: AgentJob,
  options: LocalJobApiAdmissionOptions = {},
): Promise<LocalJobApiCreatePrepared> {
  const request = getLocalJobApiStoredRequest(job)
  if (request.kind === "completion") {
    resolveExplicitHeadlessProviderProfile({
      db,
      runtime: request.runtime.id,
      providerProfileId: request.provider.profileId,
      modelOverride: request.provider.model,
    })
    const retry = await retryAgentJob(db, job.id, {
      id: createId(),
      artifactBaseDir: null,
      artifactManifestPath: null,
      reservation: options.reservation,
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
  validateLocalJobApiArtifactBaseDirForProject(
    request.artifacts.baseDir,
    project.cwd,
  )
  const retryId = createId()
  const planned = plannedRunDirPaths(request.artifacts.baseDir, retryId)
  const retry = await retryAgentJob(db, job.id, {
    id: retryId,
    input: {
      ...parseJobInput(job),
      submissionContext: {
        projectIdentity: localJobApiProjectIdentity(project.cwd),
      },
    },
    artifactBaseDir: planned?.runDirPath ?? request.artifacts.baseDir,
    artifactManifestPath: planned?.manifestPath ?? null,
    reservation: options.reservation,
  })
  const runDir = await admittedRunDirOrSettleFailed(db, retry, () =>
    createAdmittedRunDir(request.artifacts.baseDir, retry, project.cwd),
  )
  return { request, job: retry, runDir }
}

/**
 * Canonical submission intent of an API create/submit request for the
 * idempotency fingerprint (design D4): canonical cwd and artifact base,
 * current defaults and runtime aliases already normalized, the capability
 * set sorted; key, execution controls, generated IDs/times and credentials
 * excluded. Opaque input/schema stay uninterpreted (key order is canonical).
 */
export function localJobApiSubmissionFingerprint(
  request: NormalizedLocalJobApiCreateRequest,
): Record<string, unknown> {
  if (request.kind === "completion") {
    return {
      intent: "submit",
      kind: "completion",
      consumer: { runExternalId: request.consumer.runExternalId },
      runtime: { id: request.runtime.id },
      provider: request.provider,
      messages: request.messages,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      responseFormat: request.responseFormat,
    }
  }
  return {
    intent: "submit",
    kind: "agent",
    consumer: { runExternalId: request.consumer.runExternalId },
    project: {
      cwd: canonicalizePathWithExistingPrefix(request.project.cwd),
      projectId: request.project.projectId,
    },
    runtime: {
      id: request.runtime.id,
      requiredCapabilities: [...request.runtime.requiredCapabilities].sort(),
      executionProfile: request.runtime.executionProfile,
      policyGrant: request.runtime.policyGrant,
    },
    mode: request.mode,
    prompt: request.prompt.text,
    provider: request.provider,
    input: request.input,
    artifacts: {
      baseDir: request.artifacts.baseDir
        ? canonicalizePathWithExistingPrefix(request.artifacts.baseDir)
        : null,
      writePolicy: request.artifacts.writePolicy,
    },
  }
}

/** Canonical retry intent: the source attempt and its stored input. */
export function localJobApiRetryFingerprint(
  source: AgentJob,
): Record<string, unknown> {
  return {
    intent: "retry",
    sourceJobId: source.id,
    sourceInput: parseJobInput(source),
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
    assertRunArtifactRunDir(input.runDir)
    writeJsonFile(
      input.runDir,
      "request.json",
      input.request,
      input.filesystemHooks,
    )
    writeRunArtifactFile(
      input.runDir,
      "events.jsonl",
      input.events
        .map((event) => JSON.stringify(toLocalJobApiEventEnvelope(event)))
        .join("\n") + (input.events.length > 0 ? "\n" : ""),
      input.filesystemHooks,
    )
    const artifacts = [
      describeRunArtifactFile("request", input.runDir, "request.json"),
      describeRunArtifactFile("events", input.runDir, "events.jsonl"),
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
      describeRunArtifactFile("manifest", input.runDir, "artifacts.json"),
    ]
  } catch (error) {
    closeLocalJobApiArtifactRunDir(input.runDir)
    throw error
  }
}

/**
 * Admitted native artifact refs of one Run, from its committed
 * `artifact_created` records, as published in the terminal run-dir files.
 * Entries are collapsed by path (the last admission of a file wins: a file
 * edited twice is one entry with its latest digest), and each one is
 * re-read through the run directory handle and must still match its
 * registered digest and size; a stale or missing file is not listed (the
 * committed `artifact_created` facts stay, the drop is a host diagnostic).
 */
export function localJobApiNativeArtifacts(
  records: readonly LedgerRecord[],
  runDir: LocalJobApiArtifactRunDir,
  onDropped?: (message: string) => void,
): LocalJobApiArtifact[] {
  const latestByPath = new Map<string, LocalJobApiArtifact>()
  for (const record of records) {
    if (record.type !== "artifact_created") continue
    const payload =
      record.payload && typeof record.payload === "object"
        ? (record.payload as Record<string, unknown>)
        : {}
    for (const entry of Array.isArray(payload.artifacts)
      ? payload.artifacts
      : []) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
      const artifact = entry as Record<string, unknown>
      if (
        !isRunArtifactNativeRole(artifact.role) ||
        typeof artifact.path !== "string" ||
        typeof artifact.sha256 !== "string" ||
        typeof artifact.contentType !== "string" ||
        typeof artifact.sizeBytes !== "number"
      ) {
        continue
      }
      latestByPath.delete(artifact.path)
      latestByPath.set(artifact.path, {
        role: artifact.role,
        path: artifact.path,
        sha256: artifact.sha256,
        contentType: artifact.contentType,
        sizeBytes: artifact.sizeBytes,
      })
    }
  }
  const artifacts: LocalJobApiArtifact[] = []
  for (const artifact of latestByPath.values()) {
    if (
      verifyRunDirArtifactRef(runDir, {
        path: artifact.path,
        sha256: artifact.sha256 ?? "",
        sizeBytes: artifact.sizeBytes ?? -1,
      })
    ) {
      artifacts.push(artifact)
    } else {
      onDropped?.(
        `[artifacts] a ${artifact.role} ref no longer matches its file and is not listed.`,
      )
    }
  }
  return artifacts
}

type LocalJobApiFinalArtifactsInput = {
  runDir: LocalJobApiArtifactRunDir | null
  job: AgentJob
  events: AgentJobEvent[]
  /** Admitted native artifacts appended after the Locus run-dir files. */
  nativeArtifacts?: readonly LocalJobApiArtifact[]
  filesystemHooks?: LocalJobApiArtifactFilesystemHooks
}

/** Terminal run-dir files prepared under staged names, not yet visible. */
export type StagedLocalJobApiFinalArtifacts = {
  /** Refs of the final files (final paths, digests of the staged bytes). */
  artifacts: LocalJobApiArtifact[]
  /** Renames every staged file to its final name (after the SQL commit). */
  publish(): void
  /** Removes every staged file; the initial run-dir files stay intact. */
  discard(): void
}

/**
 * Staged terminal names are unique per process and preparation attempt
 * (design D5): a losing preparer can only discard its own staging.
 */
function stagedLocalJobApiArtifactName(
  fileName: string,
  attemptToken: string,
): string {
  return `.${fileName}.locus-staged-${process.pid}-${attemptToken}`
}

/**
 * Prepares events.jsonl, result.json and artifacts.json under staged names
 * inside the admitted run directory (design "Artifacts and Terminal Commit
 * Order" steps 2 and 5): their digests are over the staged bytes and their
 * refs carry the final paths. Nothing is visible under a final name until
 * `publish()`; `discard()` leaves only the initial files.
 */
export function stageLocalJobApiFinalArtifacts(
  input: LocalJobApiFinalArtifactsInput,
): StagedLocalJobApiFinalArtifacts {
  const runDir = input.runDir
  if (!runDir) return { artifacts: [], publish() {}, discard() {} }
  const nativeArtifacts = [...(input.nativeArtifacts ?? [])]
  const staged: Array<{ stagedName: string; finalName: string }> = []
  const attemptToken = randomUUID()
  const stage = (finalName: string, content: string): string => {
    const stagedName = stagedLocalJobApiArtifactName(finalName, attemptToken)
    writeRunArtifactFile(runDir, stagedName, content, input.filesystemHooks)
    staged.push({ stagedName, finalName })
    return stagedName
  }
  const describe = (
    role: string,
    finalName: string,
    stagedName = finalName,
  ): LocalJobApiArtifact => ({
    ...describeRunArtifactFile(role, runDir, stagedName),
    path: join(runDir.path, finalName),
  })
  const discard = () => {
    for (const entry of staged.splice(0)) {
      try {
        discardRunArtifactFile(runDir, entry.stagedName)
      } catch {
        // A staged file that cannot be removed stays unreferenced.
      }
    }
  }
  try {
    assertRunArtifactRunDir(runDir)
    const eventsName = stage(
      "events.jsonl",
      input.events
        .map((event) => JSON.stringify(toLocalJobApiEventEnvelope(event)))
        .join("\n") + (input.events.length > 0 ? "\n" : ""),
    )
    const artifacts: LocalJobApiArtifact[] = [
      describe("request", "request.json"),
      describe("events", "events.jsonl", eventsName),
    ]
    const resultName = stage(
      "result.json",
      stableStringify(
        toLocalJobApiResultEnvelope(
          input.job,
          [...artifacts, ...nativeArtifacts],
          input.events,
        ),
      ),
    )
    artifacts.push(
      describe("result", "result.json", resultName),
      ...nativeArtifacts,
    )
    const manifest: LocalJobApiArtifactManifest = {
      apiVersion: LOCAL_JOB_API_VERSION,
      jobId: input.job.id,
      artifactBaseDir: runDir.path,
      artifacts,
      createdAt: new Date().toISOString(),
    }
    const manifestName = stage("artifacts.json", stableStringify(manifest))
    return {
      artifacts: [
        ...artifacts,
        describe("manifest", "artifacts.json", manifestName),
      ],
      publish() {
        try {
          while (staged.length > 0) {
            const entry = staged[0]
            publishRunArtifactFile(
              runDir,
              entry.stagedName,
              entry.finalName,
              input.filesystemHooks,
            )
            staged.shift()
          }
        } catch (error) {
          discard()
          closeLocalJobApiArtifactRunDir(runDir)
          throw error
        }
      },
      discard,
    }
  } catch (error) {
    discard()
    closeLocalJobApiArtifactRunDir(runDir)
    throw error
  }
}

/** Stages and immediately publishes the final run-dir files. */
export function writeLocalJobApiFinalArtifacts(
  input: LocalJobApiFinalArtifactsInput,
): LocalJobApiArtifact[] {
  const staged = stageLocalJobApiFinalArtifacts(input)
  staged.publish()
  return staged.artifacts
}

/**
 * Writes the initial run-dir files (lifecycle output of API create/retry)
 * and admits them through the run artifact owner, so the one initial
 * `artifact_created` commits before `job_started`.
 */
export async function admitLocalJobApiInitialArtifacts(input: {
  db: AgentJobDatabase
  prepared: LocalJobApiCreatePrepared
  filesystemHooks?: LocalJobApiArtifactFilesystemHooks
}): Promise<LocalJobApiArtifact[]> {
  const { prepared } = input
  if (!prepared.runDir) return []
  const artifacts = writeLocalJobApiInitialArtifacts({
    runDir: prepared.runDir,
    request: prepared.request,
    job: prepared.job,
    events: listAgentJobEvents(input.db, prepared.job.id),
    filesystemHooks: input.filesystemHooks,
  })
  if (artifacts.length === 0) return artifacts
  const ledger = await getOrCreateRunEventLedger(input.db, prepared.job)
  await admitRunDirArtifacts({
    runId: prepared.job.id,
    runDir: prepared.runDir,
    artifacts: artifacts.map((artifact) => ({
      role: artifact.role,
      path: artifact.path,
      sha256: artifact.sha256 ?? "",
      contentType: artifact.contentType ?? "application/octet-stream",
      sizeBytes: artifact.sizeBytes ?? -1,
    })),
    ledger,
  })
  return artifacts
}

function toCommittedEventRow(record: LedgerRecord): AgentJobEvent {
  const createdMs = Date.parse(String(record.createdAt))
  return {
    id: `${record.runId}:${record.sequence}`,
    jobId: record.jobId ?? record.runId,
    sequence: record.sequence,
    type: record.type,
    payloadJson: JSON.stringify(record.payload ?? {}),
    // The job store keeps second precision; the frozen files match it.
    createdAt: Number.isNaN(createdMs)
      ? null
      : new Date(Math.floor(createdMs / 1000) * 1000),
    factKey: null,
    recordMetadataJson: null,
  }
}

function terminalJobProjection(
  job: AgentJob,
  jobMutation: Record<string, unknown>,
): AgentJob {
  const date = (value: unknown): Date | null => {
    if (value === undefined || value === null) return null
    const parsed = new Date(String(value))
    return Number.isNaN(parsed.getTime())
      ? null
      : new Date(Math.floor(parsed.getTime() / 1000) * 1000)
  }
  const text = (value: unknown, fallback: string | null) =>
    value === undefined ? fallback : (value as string | null)
  return {
    ...job,
    status: text(jobMutation.status, job.status) ?? job.status,
    finishedAt:
      jobMutation.finishedAt === undefined
        ? job.finishedAt
        : date(jobMutation.finishedAt),
    heartbeatAt:
      jobMutation.heartbeatAt === undefined
        ? job.heartbeatAt
        : date(jobMutation.heartbeatAt),
    exitCode:
      jobMutation.exitCode === undefined
        ? job.exitCode
        : (jobMutation.exitCode as number | null),
    errorCode: text(jobMutation.errorCode, job.errorCode),
    errorMessage: text(jobMutation.errorMessage, job.errorMessage),
    resultJson: text(jobMutation.resultJson, job.resultJson),
  }
}

/**
 * Terminal run-dir preparation of one API Run (design "Artifacts and
 * Terminal Commit Order"): the ledger hands the frozen public prefix with the
 * candidate `completed` and the terminal job-row fields; these serializers
 * produce events.jsonl, result.json and artifacts.json, the run artifact
 * owner writes and digests them, and the refs join the completed commit.
 */
export function createLocalJobApiTerminalArtifacts(input: {
  db: AgentJobDatabase
  runDir: LocalJobApiArtifactRunDir | null
  jobId: string
  filesystemHooks?: LocalJobApiArtifactFilesystemHooks
  /** Sanitized host diagnostics (never persisted). */
  onHostDiagnostic?: (message: string) => void
}): {
  preparer?: {
    prepare(prepareInput: {
      records: LedgerRecord[]
      completed: LedgerRecord
      jobMutation: Record<string, unknown>
    }): JsonValue[]
    publish(): void
    discard(): void
  }
  artifacts(): LocalJobApiArtifact[]
} {
  // Published refs (visible only after the terminal commit).
  let published: LocalJobApiArtifact[] = []
  let staged: StagedLocalJobApiFinalArtifacts | null = null
  const runDir = input.runDir
  if (!runDir) return { artifacts: () => [] }
  const discardStaged = () => {
    const current = staged
    staged = null
    current?.discard()
  }
  return {
    preparer: {
      prepare({ records, jobMutation }) {
        // A rebased attempt regenerates the files from its own prefix.
        discardStaged()
        const current = getAgentJob(input.db, input.jobId)
        if (!current) throw new Error(`Unknown job: ${input.jobId}`)
        staged = stageLocalJobApiFinalArtifacts({
          runDir,
          job: terminalJobProjection(current, jobMutation),
          events: records.map(toCommittedEventRow),
          nativeArtifacts: localJobApiNativeArtifacts(
            records,
            runDir,
            input.onHostDiagnostic,
          ),
          filesystemHooks: input.filesystemHooks,
        })
        return staged.artifacts as unknown as JsonValue[]
      },
      publish() {
        const current = staged
        staged = null
        if (!current) return
        current.publish()
        published = current.artifacts
      },
      discard: discardStaged,
    },
    artifacts: () => published,
  }
}

/** Committed refs of a Run's one initial run-dir admission batch. */
function committedInitialRunDirRefs(
  db: AgentJobDatabase,
  jobId: string,
): RunDirArtifact[] {
  const refs: RunDirArtifact[] = []
  for (const record of lookupCommittedRunEventFact(
    db,
    jobId,
    runDirInitialArtifactsObservationKey(jobId),
  )) {
    if (record.type !== "artifact_created") continue
    const payload = isRecord(record.payload) ? record.payload : {}
    for (const entry of Array.isArray(payload.artifacts)
      ? payload.artifacts
      : []) {
      if (!isRecord(entry)) continue
      if (
        typeof entry.role !== "string" ||
        typeof entry.path !== "string" ||
        typeof entry.sha256 !== "string" ||
        typeof entry.contentType !== "string" ||
        typeof entry.sizeBytes !== "number"
      ) {
        continue
      }
      refs.push({
        role: entry.role,
        path: entry.path,
        sha256: entry.sha256,
        contentType: entry.contentType,
        sizeBytes: entry.sizeBytes,
      })
    }
  }
  return refs
}

export type LocalJobApiClaimGateOptions = {
  /** Clock of the claim-time age check. */
  now?: Date
  /** Maximum queued age from createdAt to claim (equal is rejected). */
  maxQueuedApiAgeMs: number
  providerBindingDependencies?: HeadlessProviderBindingDependencies
  onHostDiagnostic?: (message: string) => void
}

function claimGateFail(
  reason: string,
  errorCode: string,
  error: unknown,
  fallback: string,
): RunClaimGateDecision {
  return {
    kind: "fail",
    reason,
    errorCode,
    errorMessage: error instanceof Error ? error.message : fallback,
  }
}

/**
 * Claim-time re-validation of an API Run's registered project and its
 * canonical cwd identity (design D5). Returns the current registration or a
 * fail-closed decision.
 */
function revalidateClaimedLocalJobApiProject(
  db: AgentJobDatabase,
  job: AgentJob,
):
  | { ok: true; projectCwd: string }
  | { ok: false; decision: RunClaimGateDecision } {
  const unregistered = (error: unknown) => ({
    ok: false as const,
    decision: claimGateFail(
      "project_unregistered",
      "project_unregistered",
      error,
      "The Run's project is no longer registered.",
    ),
  })
  const identityChanged = (error: unknown) => ({
    ok: false as const,
    decision: claimGateFail(
      "cwd_identity_changed",
      "cwd_identity_changed",
      error,
      "The Run's cwd no longer has its admitted identity.",
    ),
  })
  if (job.projectId) {
    const project = db
      .select()
      .from(projects)
      .where(eq(projects.id, job.projectId))
      .get()
    if (!project || project.removedAt) return unregistered(null)
  }
  let registration: ReturnType<typeof getProjectRegistrationForCwd>
  try {
    registration = getProjectRegistrationForCwd({
      db,
      cwd: job.cwd,
      projectId: job.projectId,
      label: "API run cwd",
    })
  } catch (error) {
    return isProjectRegistrationError(error) && error.code === "unknown_project"
      ? unregistered(error)
      : identityChanged(error)
  }
  if (!registration.registered) return unregistered(null)
  if (registration.cwd !== job.cwd) return identityChanged(null)
  // Every admitted API agent row carries its stored identity; a row without
  // one (or with a malformed one) cannot prove its cwd is unchanged, so it
  // fails closed rather than falling back to path equality.
  const stored = storedProjectIdentity(job)
  if (!stored) return identityChanged(null)
  let current: LocalJobApiProjectIdentity
  try {
    current = localJobApiProjectIdentity(job.cwd)
  } catch (error) {
    return identityChanged(error)
  }
  if (
    current.canonicalPath !== stored.canonicalPath ||
    current.dev !== stored.dev ||
    current.ino !== stored.ino
  ) {
    return identityChanged(null)
  }
  return { ok: true, projectCwd: registration.cwd }
}

/**
 * Reopens an admitted API Run's stored run directory through the run
 * artifact owner after re-checking that the stored request still plans the
 * same run directory inside its registered project (design D5). Throws on
 * any mismatch.
 */
function reopenLocalJobApiAdmittedRunDir(
  job: AgentJob,
  request: Extract<NormalizedLocalJobApiCreateRequest, { kind: "agent" }>,
  projectCwd: string,
  committedInitialRefs: readonly RunDirArtifact[],
): LocalJobApiArtifactRunDir {
  validateLocalJobApiArtifactBaseDirForProject(
    request.artifacts.baseDir,
    projectCwd,
  )
  const planned = plannedRunDirPaths(request.artifacts.baseDir, job.id)
  if (
    !planned ||
    planned.runDirPath !== job.artifactBaseDir ||
    planned.manifestPath !== job.artifactManifestPath
  ) {
    throw new Error("Admitted run directory does not match the stored request")
  }
  return reopenAdmittedRunDir(job, committedInitialRefs, {
    projectRoot: projectCwd,
    artifactsBaseDir: dirname(planned.runDirPath),
  })
}

/**
 * Terminal projection a queued cancel registers for one API Run (design D5
 * trigger table). A queued agent Run whose initial run-dir admission is
 * complete gets the same terminal preparer the worker registers, composed
 * from its persistent input and the reopened admitted run directory, so the
 * canceled terminal publishes result.json, events.jsonl and artifacts.json
 * exactly like a worker-settled Run. A Run without that admission, an
 * artifact-free Run, or one whose project/cwd/run directory no longer
 * verifies gets none (null): its cancel registers no terminal refs.
 */
export function openQueuedCancelLocalJobApiTerminal(
  db: AgentJobDatabase,
  job: AgentJob,
  options: { onHostDiagnostic?: (message: string) => void } = {},
): QueuedCancelTerminalProjection | null {
  if (
    job.source !== "api" ||
    job.kind === "completion" ||
    job.status !== "queued" ||
    !job.artifactBaseDir ||
    !job.artifactManifestPath
  ) {
    return null
  }
  const committedInitialRefs = committedInitialRunDirRefs(db, job.id)
  if (committedInitialRefs.length === 0) return null
  let runDir: LocalJobApiArtifactRunDir
  try {
    const request = getLocalJobApiStoredRequest(job)
    if (request.kind !== "agent") return null
    const project = revalidateClaimedLocalJobApiProject(db, job)
    if (!project.ok) return null
    runDir = reopenLocalJobApiAdmittedRunDir(
      job,
      request,
      project.projectCwd,
      committedInitialRefs,
    )
  } catch {
    return null
  }
  const terminal = createLocalJobApiTerminalArtifacts({
    db,
    runDir,
    jobId: job.id,
    ...(options.onHostDiagnostic
      ? { onHostDiagnostic: options.onHostDiagnostic }
      : {}),
  })
  if (!terminal.preparer) {
    closeLocalJobApiArtifactRunDir(runDir)
    return null
  }
  return {
    terminalArtifacts: terminal.preparer,
    close: () => closeLocalJobApiArtifactRunDir(runDir),
  }
}

/**
 * Claim-time host gate of a claimed API Run (design D5), run after the
 * conditional claim and before any provider call or spawn: the registered
 * project still exists, the stored canonical cwd identity is unchanged, the
 * stored execution profile/grant and provider reference are still valid,
 * the queued age is below the bound, and the admitted run directory
 * reopens with every committed initial ref verified. The executing process
 * then registers the same terminal preparer the inline create used.
 */
export function openClaimedLocalJobApiExecution(
  db: AgentJobDatabase,
  job: AgentJob,
  options: LocalJobApiClaimGateOptions,
): RunClaimGateDecision {
  if (job.source !== "api") return { kind: "proceed" }
  let projectCwd: string | null = null
  if (job.kind !== "completion") {
    const project = revalidateClaimedLocalJobApiProject(db, job)
    if (!project.ok) return project.decision
    projectCwd = project.projectCwd
  }
  let request: NormalizedLocalJobApiCreateRequest
  try {
    request = getLocalJobApiStoredRequest(job)
    if (request.kind === "agent") {
      validateLocalJobApiRequiredCapabilities(request)
    }
  } catch (error) {
    return claimGateFail(
      "execution_profile_invalid",
      "execution_profile_invalid",
      error,
      "The Run's stored execution profile is no longer valid.",
    )
  }
  const profileId = request.provider.profileId
  if (profileId || request.kind === "completion") {
    try {
      resolveExplicitHeadlessProviderProfile({
        db,
        runtime: request.runtime.id,
        providerProfileId: profileId,
        modelOverride: request.provider.model,
        dependencies: options.providerBindingDependencies,
      })
    } catch (error) {
      return claimGateFail(
        "execution_profile_invalid",
        error instanceof HeadlessProviderBindingError
          ? error.code
          : "execution_profile_invalid",
        error,
        "The Run's provider reference is no longer usable.",
      )
    }
  }
  const nowMs = (options.now ?? new Date()).getTime()
  const createdAtMs = job.createdAt ? job.createdAt.getTime() : nowMs
  if (nowMs - createdAtMs >= options.maxQueuedApiAgeMs) {
    return claimGateFail(
      "queued_age_exceeded",
      "queued_age_exceeded",
      null,
      "The Run stayed queued longer than the maximum queued age.",
    )
  }
  if (!job.artifactManifestPath || request.kind !== "agent" || !projectCwd) {
    return { kind: "proceed" }
  }
  let runDir: LocalJobApiArtifactRunDir
  try {
    runDir = reopenLocalJobApiAdmittedRunDir(
      job,
      request,
      projectCwd,
      committedInitialRunDirRefs(db, job.id),
    )
  } catch (error) {
    return claimGateFail(
      "artifact_admission_mismatch",
      "artifact_admission_mismatch",
      error,
      "The admitted run directory no longer matches its committed refs.",
    )
  }
  const terminal = createLocalJobApiTerminalArtifacts({
    db,
    runDir,
    jobId: job.id,
    ...(options.onHostDiagnostic
      ? { onHostDiagnostic: options.onHostDiagnostic }
      : {}),
  })
  return {
    kind: "proceed",
    runDir,
    terminalArtifacts: terminal.preparer,
    close: () => closeLocalJobApiArtifactRunDir(runDir),
  }
}

/** Committed events up to a terminal's seal (the frozen terminal prefix). */
export function localJobApiTerminalEvents(
  db: AgentJobDatabase,
  job: AgentJob,
): AgentJobEvent[] {
  const events = listAgentJobEvents(db, job.id)
  const sealed = job.ledgerSealedSequence
  return sealed === null
    ? events
    : events.filter((event) => event.sequence <= sealed)
}

/**
 * The create/default-retry terminal envelope `{apiVersion, job, result}`,
 * byte-compatible with the 2c59664f inline create: `result.artifacts` is
 * the terminal commit's prepared tail (or `[]` when its publication failed).
 */
export function toLocalJobApiTerminalEnvelope(
  job: AgentJob,
  artifacts: readonly Record<string, unknown>[],
  events: AgentJobEvent[],
) {
  return {
    apiVersion: LOCAL_JOB_API_VERSION,
    job: serializeAgentJob(job),
    result: toLocalJobApiResultEnvelope(
      job,
      artifacts as unknown as LocalJobApiArtifact[],
      events,
    ),
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
