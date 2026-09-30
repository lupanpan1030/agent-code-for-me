import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs"
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
  admitRunDirArtifacts,
  assertRunArtifactRunDir,
  describeRunArtifactFile,
  isRunArtifactNativeRole,
  type RunArtifactFileReceipt,
  type RunArtifactFilesystemHooks,
  type RunArtifactRunDir,
  readRunArtifactFile,
  writeRunArtifactFile,
} from "../agent-runtime/run-artifacts"
import type { LedgerRecord } from "../agent-runtime/run-event-ledger"
import { getOrCreateRunEventLedger } from "../agent-runtime/run-event-ledger-host"
import type { JsonValue } from "../agent-runtime/runtime-events"
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

export async function createLocalJobApiJob(
  db: AgentJobDatabase,
  request: NormalizedLocalJobApiCreateRequest,
  appVersion: string | null | undefined,
): Promise<LocalJobApiCreatePrepared> {
  if (request.kind === "completion") {
    resolveExplicitHeadlessProviderProfile({
      db,
      runtime: request.runtime.id,
      providerProfileId: request.provider.profileId,
      modelOverride: request.provider.model,
    })
    const job = await createAgentJob(db, {
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
    const job = await createAgentJob(db, {
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

export async function retryLocalJobApiJob(
  db: AgentJobDatabase,
  job: AgentJob,
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
    const retry = await retryAgentJob(db, job.id, {
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
 * `artifact_created` records (the run artifact owner already verified them
 * inside the admitted run directory; their registered digests are reused).
 */
export function localJobApiNativeArtifacts(
  records: readonly LedgerRecord[],
): LocalJobApiArtifact[] {
  const artifacts: LocalJobApiArtifact[] = []
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
      artifacts.push({
        role: artifact.role,
        path: artifact.path,
        sha256: artifact.sha256,
        contentType: artifact.contentType,
        sizeBytes: artifact.sizeBytes,
      })
    }
  }
  return artifacts
}

export function writeLocalJobApiFinalArtifacts(input: {
  runDir: LocalJobApiArtifactRunDir | null
  job: AgentJob
  events: AgentJobEvent[]
  /** Admitted native artifacts appended after the Locus run-dir files. */
  nativeArtifacts?: readonly LocalJobApiArtifact[]
  filesystemHooks?: LocalJobApiArtifactFilesystemHooks
}): LocalJobApiArtifact[] {
  if (!input.runDir) return []
  const nativeArtifacts = [...(input.nativeArtifacts ?? [])]
  try {
    assertRunArtifactRunDir(input.runDir)
    writeRunArtifactFile(
      input.runDir,
      "events.jsonl",
      input.events
        .map((event) => JSON.stringify(toLocalJobApiEventEnvelope(event)))
        .join("\n") + (input.events.length > 0 ? "\n" : ""),
      input.filesystemHooks,
    )
    const artifacts: LocalJobApiArtifact[] = [
      describeRunArtifactFile("request", input.runDir, "request.json"),
      describeRunArtifactFile("events", input.runDir, "events.jsonl"),
    ]
    writeJsonFile(
      input.runDir,
      "result.json",
      toLocalJobApiResultEnvelope(
        input.job,
        [...artifacts, ...nativeArtifacts],
        input.events,
      ),
      input.filesystemHooks,
    )
    artifacts.push(
      describeRunArtifactFile("result", input.runDir, "result.json"),
      ...nativeArtifacts,
    )
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
}): {
  preparer?: {
    prepare(prepareInput: {
      records: LedgerRecord[]
      completed: LedgerRecord
      jobMutation: Record<string, unknown>
    }): JsonValue[]
  }
  artifacts(): LocalJobApiArtifact[]
} {
  let prepared: LocalJobApiArtifact[] = []
  const runDir = input.runDir
  if (!runDir) return { artifacts: () => [] }
  return {
    preparer: {
      prepare({ records, jobMutation }) {
        const current = getAgentJob(input.db, input.jobId)
        if (!current) throw new Error(`Unknown job: ${input.jobId}`)
        const artifacts = writeLocalJobApiFinalArtifacts({
          runDir,
          job: terminalJobProjection(current, jobMutation),
          events: records.map(toCommittedEventRow),
          nativeArtifacts: localJobApiNativeArtifacts(records),
          filesystemHooks: input.filesystemHooks,
        })
        prepared = artifacts
        return artifacts as unknown as JsonValue[]
      },
    },
    artifacts: () => prepared,
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
