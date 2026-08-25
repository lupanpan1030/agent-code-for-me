import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
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
  runDir: string | null
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

export function prepareLocalJobApiArtifactRunDir(
  artifactBaseDir: string | null,
  jobId: string,
  projectCwd?: string,
): string | null {
  if (!artifactBaseDir) return null
  if (projectCwd) {
    validateLocalJobApiArtifactBaseDirForProject(artifactBaseDir, projectCwd)
  } else {
    validateLocalJobApiArtifactBaseDir(artifactBaseDir)
  }
  const projectReal = projectCwd ? realpathSync(projectCwd) : null
  const base = resolve(artifactBaseDir)
  mkdirSync(base, { recursive: true, mode: 0o700 })
  const baseReal = realpathSync(base)
  if (pathHasFinalComponent(baseReal)) {
    throw new Error(
      "artifacts.baseDir cannot resolve inside a final artifact directory",
    )
  }
  if (pathHasComponent(baseReal, ".git")) {
    throw new Error(
      "artifacts.baseDir cannot resolve inside a git metadata directory",
    )
  }
  if (projectReal && !isPathInside(projectReal, baseReal)) {
    throw new Error("artifacts.baseDir escaped project.cwd")
  }
  const runDir = join(baseReal, jobId)
  if (existsSync(runDir) && lstatSync(runDir).isSymbolicLink()) {
    throw new Error(`Artifact run directory cannot be a symlink: ${runDir}`)
  }
  mkdirSync(runDir, { recursive: true, mode: 0o700 })
  const runReal = realpathSync(runDir)
  if (!isPathInside(baseReal, runReal)) {
    throw new Error("Artifact run directory escaped artifact base directory")
  }
  if (projectReal && !isPathInside(projectReal, runReal)) {
    throw new Error("Artifact run directory escaped project.cwd")
  }
  return runReal
}

function stableStringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function fileArtifact(role: string, path: string): LocalJobApiArtifact {
  const stat = statSync(path)
  const hash = createHash("sha256")
  hash.update(readFileSync(path))
  return {
    role,
    path,
    sha256: hash.digest("hex"),
    contentType: "application/json",
    sizeBytes: stat.size,
  }
}

function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, stableStringify(value), { mode: 0o600 })
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
      provider: {
        profileId:
          job.providerProfileId ?? nullableString(storedProvider.profileId),
        model: job.modelOverride ?? nullableString(storedProvider.model),
      },
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
    provider: {
      profileId:
        job.providerProfileId ?? nullableString(storedProvider.profileId),
      model: job.modelOverride ?? nullableString(storedProvider.model),
    },
    input: storedInput,
    artifacts: storedArtifacts,
  })
}

function readArtifacts(path: string | null): LocalJobApiArtifact[] {
  if (!path || !existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as {
      artifacts?: unknown
    }
    return Array.isArray(parsed.artifacts)
      ? (parsed.artifacts as LocalJobApiArtifact[])
      : []
  } catch {
    return []
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
  const manifestPath = runDir ? join(runDir, "artifacts.json") : null
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
    artifactBaseDir: runDir ?? request.artifacts.baseDir,
    artifactManifestPath: manifestPath,
    providerProfileId: request.provider.profileId,
    modelOverride: request.provider.model,
    createdByVersion: appVersion ?? null,
  })

  return { request, job: getAgentJob(db, job.id) ?? job, runDir }
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
  const retry = retryAgentJob(db, job.id, {
    id: retryId,
    artifactBaseDir: runDir ?? request.artifacts.baseDir,
    artifactManifestPath: runDir ? join(runDir, "artifacts.json") : null,
  })
  return { request, job: retry, runDir }
}

export function writeLocalJobApiInitialArtifacts(input: {
  runDir: string | null
  request: NormalizedLocalJobApiCreateRequest
  job: AgentJob
  events: AgentJobEvent[]
}): LocalJobApiArtifact[] {
  if (!input.runDir) return []
  const requestPath = join(input.runDir, "request.json")
  const eventsPath = join(input.runDir, "events.jsonl")
  const manifestPath = join(input.runDir, "artifacts.json")
  writeJsonFile(requestPath, input.request)
  writeFileSync(
    eventsPath,
    input.events
      .map((event) => JSON.stringify(toLocalJobApiEventEnvelope(event)))
      .join("\n") + (input.events.length > 0 ? "\n" : ""),
    { mode: 0o600 },
  )
  const artifacts = [
    fileArtifact("request", requestPath),
    fileArtifact("events", eventsPath),
  ]
  const manifest: LocalJobApiArtifactManifest = {
    apiVersion: LOCAL_JOB_API_VERSION,
    jobId: input.job.id,
    artifactBaseDir: input.runDir,
    artifacts,
    createdAt: new Date().toISOString(),
  }
  writeJsonFile(manifestPath, manifest)
  return [...artifacts, fileArtifact("manifest", manifestPath)]
}

export function writeLocalJobApiFinalArtifacts(input: {
  runDir: string | null
  job: AgentJob
  events: AgentJobEvent[]
}): LocalJobApiArtifact[] {
  if (!input.runDir) return []
  const eventsPath = join(input.runDir, "events.jsonl")
  const resultPath = join(input.runDir, "result.json")
  const manifestPath = join(input.runDir, "artifacts.json")
  writeFileSync(
    eventsPath,
    input.events
      .map((event) => JSON.stringify(toLocalJobApiEventEnvelope(event)))
      .join("\n") + (input.events.length > 0 ? "\n" : ""),
    { mode: 0o600 },
  )
  const artifacts = [
    fileArtifact("request", join(input.runDir, "request.json")),
    fileArtifact("events", eventsPath),
  ]
  writeJsonFile(
    resultPath,
    toLocalJobApiResultEnvelope(input.job, artifacts, input.events),
  )
  artifacts.push(fileArtifact("result", resultPath))
  const manifest: LocalJobApiArtifactManifest = {
    apiVersion: LOCAL_JOB_API_VERSION,
    jobId: input.job.id,
    artifactBaseDir: input.runDir,
    artifacts,
    createdAt: new Date().toISOString(),
  }
  writeJsonFile(manifestPath, manifest)
  return [...artifacts, fileArtifact("manifest", manifestPath)]
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
