import {
  AGENT_JOB_KINDS,
  AGENT_JOB_MODES,
  type AgentJobKind,
  type AgentJobMode,
} from "./agent-jobs"
import {
  AGENT_RUNTIME_CAPABILITY_IDS,
  type AgentRuntimeCapabilityId,
  type AgentRuntimeCapabilityManifest,
  type AgentRuntimeContractId,
  CONTRACT_RUNTIME_IDS,
  toAgentRuntimeId,
} from "./agent-runtime-capabilities"

export const LOCAL_JOB_API_VERSION = "locus.local-job.v1" as const

export const LOCAL_JOB_API_DISCOVERY_FEATURES = [
  "runtime-readiness",
  "provider-binding",
  "completion",
] as const

export type LocalJobApiDiscoveryFeature =
  (typeof LOCAL_JOB_API_DISCOVERY_FEATURES)[number]

export const LOCAL_JOB_API_PROJECT_NOT_REGISTERED =
  "project_not_registered" as const

export const LOCAL_JOB_API_WRITE_POLICIES = [
  "metadata-only",
  "proposal-only",
] as const

export type LocalJobApiWritePolicy =
  (typeof LOCAL_JOB_API_WRITE_POLICIES)[number]

export const LOCAL_JOB_API_EXECUTION_PROFILES = [
  "batch",
  "policy-grant",
] as const

export type LocalJobApiExecutionProfile =
  (typeof LOCAL_JOB_API_EXECUTION_PROFILES)[number]

export type LocalJobApiPolicyGrant = {
  scopes: string[]
  canDecideAutomatically?: boolean
}

export type LocalJobApiProviderSelection = {
  profileId?: string
  model?: string
}

export type NormalizedLocalJobApiProviderSelection = {
  profileId: string | null
  model: string | null
}

export type NormalizedLocalJobApiExplicitProviderSelection = {
  profileId: string
  model: string | null
}

export const LOCAL_JOB_API_RESPONSE_FORMAT_TYPES = [
  "text",
  "json_schema",
] as const

export type LocalJobApiResponseFormatType =
  (typeof LOCAL_JOB_API_RESPONSE_FORMAT_TYPES)[number]

export type LocalJobApiTextResponseFormat = {
  type: "text"
}

export type LocalJobApiJsonSchemaResponseFormat = {
  type: "json_schema"
  schema: Record<string, unknown>
}

export type LocalJobApiResponseFormat =
  | LocalJobApiTextResponseFormat
  | LocalJobApiJsonSchemaResponseFormat

export const LOCAL_JOB_API_COMPLETION_MESSAGE_ROLES = [
  "system",
  "user",
  "assistant",
] as const

export type LocalJobApiCompletionMessageRole =
  (typeof LOCAL_JOB_API_COMPLETION_MESSAGE_ROLES)[number]

export type LocalJobApiCompletionMessage = {
  role: LocalJobApiCompletionMessageRole
  content: string
}

export type LocalJobApiCompletionUsage = {
  inputTokens: number
  outputTokens: number
}

export type LocalJobApiCompletionResult = {
  content: unknown
  usage: LocalJobApiCompletionUsage
  resolvedProvider: LocalJobApiResolvedProvider
}

export const LOCAL_JOB_API_RESOLVED_PROVIDER_SOURCES = [
  "request-profile",
  "default-profile",
  "native",
] as const

export type LocalJobApiResolvedProviderSource =
  (typeof LOCAL_JOB_API_RESOLVED_PROVIDER_SOURCES)[number]

export type LocalJobApiResolvedProvider = {
  source: LocalJobApiResolvedProviderSource
  profileId?: string | null
  model?: string | null
}

export const LOCAL_JOB_API_EVENT_TYPES = [
  "job_created",
  "job_started",
  "assistant_delta",
  "reasoning_delta",
  "tool_started",
  "tool_delta",
  "tool_finished",
  "usage_update",
  "artifact_created",
  "status",
  "error",
  "completed",
] as const

export type LocalJobApiEventType = (typeof LOCAL_JOB_API_EVENT_TYPES)[number]

export type LocalJobApiConsumer = {
  id: string
  runExternalId: string | null
}

export type LocalJobApiAgentCreateRequest = {
  apiVersion: typeof LOCAL_JOB_API_VERSION
  kind?: Extract<AgentJobKind, "agent">
  consumer: {
    id: string
    runExternalId?: string | null
  }
  project: {
    cwd: string
    projectId?: string | null
  }
  runtime: {
    id: AgentRuntimeContractId | "claude"
    requiredCapabilities?: AgentRuntimeCapabilityId[]
    executionProfile?: LocalJobApiExecutionProfile
    policyGrant?: LocalJobApiPolicyGrant | null
  }
  mode: AgentJobMode
  prompt: {
    text: string
  }
  provider?: LocalJobApiProviderSelection
  input?: Record<string, unknown>
  artifacts?: {
    baseDir?: string | null
    writePolicy?: LocalJobApiWritePolicy
  } | null
}

export type LocalJobApiCompletionCreateRequest = {
  apiVersion: typeof LOCAL_JOB_API_VERSION
  kind: Extract<AgentJobKind, "completion">
  consumer: {
    id: string
    runExternalId?: string | null
  }
  runtime?: {
    id?: AgentRuntimeContractId | "claude" | null
  } | null
  provider: LocalJobApiProviderSelection & {
    profileId: string
  }
  messages: LocalJobApiCompletionMessage[]
  maxTokens?: number | null
  temperature?: number | null
  responseFormat?: LocalJobApiResponseFormat | null
}

export type LocalJobApiCreateRequest =
  | LocalJobApiAgentCreateRequest
  | LocalJobApiCompletionCreateRequest

export type NormalizedLocalJobApiAgentCreateRequest = {
  apiVersion: typeof LOCAL_JOB_API_VERSION
  kind: Extract<AgentJobKind, "agent">
  consumer: LocalJobApiConsumer
  project: {
    cwd: string
    projectId: string | null
  }
  runtime: {
    id: AgentRuntimeContractId
    requiredCapabilities: AgentRuntimeCapabilityId[]
    executionProfile: LocalJobApiExecutionProfile
    policyGrant: LocalJobApiPolicyGrant | null
  }
  mode: AgentJobMode
  prompt: {
    text: string
  }
  provider: NormalizedLocalJobApiProviderSelection
  input: Record<string, unknown>
  artifacts: {
    baseDir: string | null
    writePolicy: LocalJobApiWritePolicy
  }
}

export type NormalizedLocalJobApiCompletionCreateRequest = {
  apiVersion: typeof LOCAL_JOB_API_VERSION
  kind: Extract<AgentJobKind, "completion">
  consumer: LocalJobApiConsumer
  runtime: {
    id: AgentRuntimeContractId | null
  }
  provider: NormalizedLocalJobApiExplicitProviderSelection
  messages: LocalJobApiCompletionMessage[]
  maxTokens: number | null
  temperature: number | null
  responseFormat: LocalJobApiResponseFormat
}

export type NormalizedLocalJobApiCreateRequest =
  | NormalizedLocalJobApiAgentCreateRequest
  | NormalizedLocalJobApiCompletionCreateRequest

export type LocalJobApiArtifact = {
  role: string
  path: string
  sha256: string | null
  contentType: string | null
  sizeBytes: number | null
}

export type LocalJobApiArtifactManifest = {
  apiVersion: typeof LOCAL_JOB_API_VERSION
  jobId: string
  artifactBaseDir: string
  artifacts: LocalJobApiArtifact[]
  createdAt: string
}

export type LocalJobApiEventEnvelope = {
  apiVersion: typeof LOCAL_JOB_API_VERSION
  jobId: string
  sequence: number
  type: LocalJobApiEventType
  createdAt: string | null
  payload: unknown
}

export type LocalJobApiResultEnvelope = {
  apiVersion: typeof LOCAL_JOB_API_VERSION
  jobId: string
  status: string
  runtime: string
  mode: string
  consumer: LocalJobApiConsumer | null
  artifactManifestPath: string | null
  artifacts: LocalJobApiArtifact[]
  diagnostics: Array<{
    code: string
    message: string
  }>
  resolvedProvider: LocalJobApiResolvedProvider
  result: unknown
}

export const LOCAL_JOB_API_RUNTIME_READINESS_STATES = [
  "ready",
  "needs-auth",
  "unavailable",
  "unknown",
] as const

export type LocalJobApiRuntimeReadinessState =
  (typeof LOCAL_JOB_API_RUNTIME_READINESS_STATES)[number]

export type LocalJobApiRuntimeReadiness = {
  state: LocalJobApiRuntimeReadinessState
  detail?: string
  hint?: string
}

export type LocalJobApiRuntimeManifest = AgentRuntimeCapabilityManifest & {
  readiness: LocalJobApiRuntimeReadiness
}

export type LocalJobApiRuntimeManifestEnvelope = {
  apiVersion: typeof LOCAL_JOB_API_VERSION
  features: LocalJobApiDiscoveryFeature[]
  runtimes: LocalJobApiRuntimeManifest[]
}

export type LocalJobApiValidationResult =
  | {
      ok: true
      request: NormalizedLocalJobApiCreateRequest
    }
  | {
      ok: false
      errors: string[]
    }

const MAX_CONSUMER_ID_LENGTH = 80
const MAX_EXTERNAL_ID_LENGTH = 160
const MAX_POLICY_GRANT_SCOPE_LENGTH = 120
const MAX_PROVIDER_PROFILE_ID_LENGTH = 160
const MAX_PROVIDER_MODEL_LENGTH = 200
const MAX_PROMPT_LENGTH = 256 * 1024
const MAX_REQUEST_JSON_LENGTH = 1024 * 1024
const MAX_COMPLETION_MESSAGES = 128
const MAX_COMPLETION_TOKENS = 200_000
const MAX_TEMPERATURE = 2

const SECRET_KEY_PATTERN =
  /(^|[_\-.])(api[-_]?key|authorization|auth[-_]?token|access[-_]?token|refresh[-_]?token|id[-_]?token|token|secret|password|headers?|env|environment)([_\-.]|$)/i

const SECRET_VALUE_PATTERNS = [
  /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/,
  /(^|[^A-Za-z0-9_])sk-[A-Za-z0-9_-]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /bearer\s+[A-Za-z0-9._-]+/i,
  /authorization\s*:\s*basic\s+[A-Za-z0-9+/=_-]+/i,
]

function assertNoSecretText(value: string, context: string): void {
  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    throw new Error(`${context} contains secret-like text`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function isAbsoluteLocalPath(value: string): boolean {
  return (
    value.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith("\\\\")
  )
}

function isBoundedId(value: string, maxLength: number): boolean {
  return (
    value.length > 0 &&
    value.length <= maxLength &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  )
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

function isSafeProviderModel(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_PROVIDER_MODEL_LENGTH &&
    !hasControlCharacter(value) &&
    /^[A-Za-z0-9._:@/+,\-=]+$/.test(value)
  )
}

function normalizeProviderSelection(
  value: unknown,
  errors: string[],
): NormalizedLocalJobApiProviderSelection {
  if (value === undefined || value === null) {
    return { profileId: null, model: null }
  }
  if (!isRecord(value)) {
    errors.push("provider must be an object when provided")
    return { profileId: null, model: null }
  }

  const allowedKeys = new Set(["profileId", "model"])
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      errors.push(`provider.${key} is not accepted`)
    }
  }

  let profileId: string | null = null
  if (value.profileId !== undefined && value.profileId !== null) {
    if (typeof value.profileId !== "string") {
      errors.push("provider.profileId must be a string")
    } else {
      const normalized = value.profileId.trim()
      if (!isBoundedId(normalized, MAX_PROVIDER_PROFILE_ID_LENGTH)) {
        errors.push(
          `provider.profileId must be 1-${MAX_PROVIDER_PROFILE_ID_LENGTH} chars: letters, numbers, '.', '_', ':', '-'`,
        )
      } else {
        profileId = normalized
      }
    }
  }

  let model: string | null = null
  if (value.model !== undefined && value.model !== null) {
    if (typeof value.model !== "string") {
      errors.push("provider.model must be a string")
    } else {
      const normalized = value.model.trim()
      if (!isSafeProviderModel(normalized)) {
        errors.push(
          `provider.model must be 1-${MAX_PROVIDER_MODEL_LENGTH} chars and contain only model-id safe characters`,
        )
      } else {
        model = normalized
      }
    }
  }

  return { profileId, model }
}

function normalizeConsumer(
  value: unknown,
  errors: string[],
): LocalJobApiConsumer {
  const consumer = isRecord(value) ? value : null
  const consumerId =
    consumer && typeof consumer.id === "string" ? consumer.id.trim() : ""
  if (!isBoundedId(consumerId, MAX_CONSUMER_ID_LENGTH)) {
    errors.push(
      `consumer.id must be 1-${MAX_CONSUMER_ID_LENGTH} chars: letters, numbers, '.', '_', ':', '-'`,
    )
  }
  const runExternalId = optionalString(consumer?.runExternalId, null)
  if (runExternalId && !isBoundedId(runExternalId, MAX_EXTERNAL_ID_LENGTH)) {
    errors.push(
      `consumer.runExternalId must be 1-${MAX_EXTERNAL_ID_LENGTH} chars: letters, numbers, '.', '_', ':', '-'`,
    )
  }
  return {
    id: consumerId,
    runExternalId: runExternalId || null,
  }
}

function rejectKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  errors: string[],
  reason: string,
): void {
  for (const key of keys) {
    if (value[key] !== undefined) {
      errors.push(`${key} is not accepted for ${reason}`)
    }
  }
}

function normalizeCompletionRuntime(
  value: unknown,
  errors: string[],
): { id: AgentRuntimeContractId | null } {
  if (value === undefined || value === null) return { id: null }
  if (!isRecord(value)) {
    errors.push("runtime must be an object when provided")
    return { id: null }
  }

  for (const key of Object.keys(value)) {
    if (key !== "id") {
      errors.push(`runtime.${key} is not accepted for completion jobs`)
    }
  }

  const rawRuntimeId =
    typeof value.id === "string" && value.id.trim() ? value.id : null
  if (!rawRuntimeId) return { id: null }
  const runtimeId = toAgentRuntimeId(rawRuntimeId)
  if (
    !runtimeId ||
    !(CONTRACT_RUNTIME_IDS as readonly string[]).includes(runtimeId)
  ) {
    errors.push("Unsupported runtime.id")
    return { id: null }
  }
  return { id: runtimeId as AgentRuntimeContractId }
}

function normalizeCompletionMessages(
  value: unknown,
  errors: string[],
): LocalJobApiCompletionMessage[] {
  if (!Array.isArray(value)) {
    errors.push("messages must be a non-empty array")
    return []
  }
  if (value.length === 0) {
    errors.push("messages must contain at least one message")
    return []
  }
  if (value.length > MAX_COMPLETION_MESSAGES) {
    errors.push(`messages exceeds ${MAX_COMPLETION_MESSAGES} item limit`)
  }

  let totalContentLength = 0
  const messages: LocalJobApiCompletionMessage[] = []
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push(`messages[${index}] must be an object`)
      return
    }
    const role = typeof item.role === "string" ? item.role : ""
    if (
      !(LOCAL_JOB_API_COMPLETION_MESSAGE_ROLES as readonly string[]).includes(
        role,
      )
    ) {
      errors.push(`messages[${index}].role is unsupported`)
      return
    }
    if (typeof item.content !== "string" || item.content.trim().length === 0) {
      errors.push(`messages[${index}].content is required`)
      return
    }
    totalContentLength += item.content.length
    messages.push({
      role: role as LocalJobApiCompletionMessageRole,
      content: item.content,
    })
  })
  if (totalContentLength > MAX_PROMPT_LENGTH) {
    errors.push(`messages content exceeds ${MAX_PROMPT_LENGTH} character limit`)
  }
  return messages
}

function normalizeNullablePositiveInteger(
  value: unknown,
  field: string,
  errors: string[],
): number | null {
  if (value === undefined || value === null) return null
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > MAX_COMPLETION_TOKENS
  ) {
    errors.push(`${field} must be an integer from 1-${MAX_COMPLETION_TOKENS}`)
    return null
  }
  return value
}

function normalizeNullableTemperature(
  value: unknown,
  errors: string[],
): number | null {
  if (value === undefined || value === null) return null
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > MAX_TEMPERATURE
  ) {
    errors.push(`temperature must be a number from 0-${MAX_TEMPERATURE}`)
    return null
  }
  return value
}

function normalizeResponseFormat(
  value: unknown,
  errors: string[],
): LocalJobApiResponseFormat {
  if (value === undefined || value === null) return { type: "text" }
  if (!isRecord(value)) {
    errors.push("responseFormat must be an object when provided")
    return { type: "text" }
  }
  const type = typeof value.type === "string" ? value.type : ""
  if (
    !(LOCAL_JOB_API_RESPONSE_FORMAT_TYPES as readonly string[]).includes(type)
  ) {
    errors.push("Unsupported responseFormat.type")
    return { type: "text" }
  }
  if (type === "text") {
    for (const key of Object.keys(value)) {
      if (key !== "type") {
        errors.push(`responseFormat.${key} is not accepted for text responses`)
      }
    }
    return { type: "text" }
  }
  for (const key of Object.keys(value)) {
    if (key !== "type" && key !== "schema") {
      errors.push(
        `responseFormat.${key} is not accepted for JSON schema responses`,
      )
    }
  }
  if (!isRecord(value.schema)) {
    errors.push("responseFormat.schema must be an object")
    return { type: "json_schema", schema: {} }
  }
  return {
    type: "json_schema",
    schema: value.schema,
  }
}

function collectSecretFindings(
  value: unknown,
  path: string,
  findings: string[],
): void {
  if (path === "responseFormat.schema") return
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      findings.push(`${path} contains secret-like text`)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectSecretFindings(item, `${path}[${index}]`, findings)
    })
    return
  }
  if (!isRecord(value)) return

  for (const [key, item] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key
    if (SECRET_KEY_PATTERN.test(key)) {
      findings.push(`${childPath} is not accepted in Local Job API requests`)
      continue
    }
    collectSecretFindings(item, childPath, findings)
  }
}

function optionalString(
  value: unknown,
  fallback: string | null,
): string | null {
  if (value === undefined || value === null) return fallback
  return typeof value === "string" ? value : fallback
}

function normalizeRequiredCapabilities(
  value: unknown,
  errors: string[],
): AgentRuntimeCapabilityId[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    errors.push("runtime.requiredCapabilities must be an array")
    return []
  }
  const capabilities: AgentRuntimeCapabilityId[] = []
  for (const item of value) {
    if (
      typeof item !== "string" ||
      !(AGENT_RUNTIME_CAPABILITY_IDS as readonly string[]).includes(item)
    ) {
      errors.push("Unsupported required capability")
      continue
    }
    if (!capabilities.includes(item as AgentRuntimeCapabilityId)) {
      capabilities.push(item as AgentRuntimeCapabilityId)
    }
  }
  return capabilities
}

function normalizeExecutionProfile(
  value: unknown,
  errors: string[],
): LocalJobApiExecutionProfile {
  if (value === undefined || value === null) return "batch"
  if (
    typeof value !== "string" ||
    !(LOCAL_JOB_API_EXECUTION_PROFILES as readonly string[]).includes(value)
  ) {
    errors.push("Unsupported runtime.executionProfile")
    return "batch"
  }
  return value as LocalJobApiExecutionProfile
}

function normalizePolicyGrant(
  value: unknown,
  executionProfile: LocalJobApiExecutionProfile,
  errors: string[],
): LocalJobApiPolicyGrant | null {
  if (value === undefined || value === null) {
    if (executionProfile === "policy-grant") {
      errors.push(
        "runtime.policyGrant.scopes is required for policy-grant execution",
      )
    }
    return null
  }
  if (!isRecord(value)) {
    errors.push("runtime.policyGrant must be an object")
    return null
  }
  const scopesInput = value.scopes
  if (!Array.isArray(scopesInput)) {
    errors.push("runtime.policyGrant.scopes must be an array")
    return null
  }
  const scopes: string[] = []
  for (const item of scopesInput) {
    if (
      typeof item !== "string" ||
      !isBoundedId(item.trim(), MAX_POLICY_GRANT_SCOPE_LENGTH)
    ) {
      errors.push(
        `runtime.policyGrant.scopes entries must be 1-${MAX_POLICY_GRANT_SCOPE_LENGTH} chars: letters, numbers, '.', '_', ':', '-'`,
      )
      continue
    }
    const scope = item.trim()
    if (!scopes.includes(scope)) scopes.push(scope)
  }
  if (executionProfile === "policy-grant" && scopes.length === 0) {
    errors.push(
      "runtime.policyGrant.scopes must contain at least one scope for policy-grant execution",
    )
  }
  const canDecideAutomatically = value.canDecideAutomatically
  if (
    canDecideAutomatically !== undefined &&
    typeof canDecideAutomatically !== "boolean"
  ) {
    errors.push("runtime.policyGrant.canDecideAutomatically must be a boolean")
  }
  return {
    scopes,
    ...(typeof canDecideAutomatically === "boolean"
      ? { canDecideAutomatically }
      : {}),
  }
}

export function validateLocalJobApiCreateRequest(
  value: unknown,
): LocalJobApiValidationResult {
  const errors: string[] = []
  if (!isRecord(value)) {
    return { ok: false, errors: ["Request must be a JSON object"] }
  }

  const size = JSON.stringify(value).length
  if (size > MAX_REQUEST_JSON_LENGTH) {
    errors.push(`Request JSON exceeds ${MAX_REQUEST_JSON_LENGTH} byte limit`)
  }

  if (value.apiVersion !== LOCAL_JOB_API_VERSION) {
    errors.push(`apiVersion must be ${LOCAL_JOB_API_VERSION}`)
  }

  const kind = value.kind ?? "agent"
  if (
    typeof kind !== "string" ||
    !(AGENT_JOB_KINDS as readonly string[]).includes(kind)
  ) {
    errors.push("Unsupported kind")
  }

  const consumer = normalizeConsumer(value.consumer, errors)

  if (kind === "completion") {
    rejectKeys(
      value,
      ["project", "mode", "prompt", "input", "artifacts", "cwd"],
      errors,
      "completion jobs",
    )
    const runtime = normalizeCompletionRuntime(value.runtime, errors)
    const provider = normalizeProviderSelection(value.provider, errors)
    if (!provider.profileId) {
      errors.push("provider.profileId is required for completion jobs")
    }
    const messages = normalizeCompletionMessages(value.messages, errors)
    const maxTokens = normalizeNullablePositiveInteger(
      value.maxTokens,
      "maxTokens",
      errors,
    )
    const temperature = normalizeNullableTemperature(value.temperature, errors)
    const responseFormat = normalizeResponseFormat(value.responseFormat, errors)

    const secretFindings: string[] = []
    collectSecretFindings(value, "", secretFindings)
    errors.push(...secretFindings)

    if (errors.length > 0 || !provider.profileId) {
      return { ok: false, errors }
    }

    return {
      ok: true,
      request: {
        apiVersion: LOCAL_JOB_API_VERSION,
        kind: "completion",
        consumer,
        runtime,
        provider: {
          profileId: provider.profileId,
          model: provider.model,
        },
        messages,
        maxTokens,
        temperature,
        responseFormat,
      },
    }
  }

  rejectKeys(
    value,
    ["messages", "maxTokens", "temperature", "responseFormat"],
    errors,
    "agent jobs",
  )

  const project = isRecord(value.project) ? value.project : null
  const cwd = project && typeof project.cwd === "string" ? project.cwd : ""
  if (!cwd || !isAbsoluteLocalPath(cwd)) {
    errors.push("project.cwd must be an absolute local path")
  }
  const projectId = optionalString(project?.projectId, null)

  const runtimeInput = isRecord(value.runtime) ? value.runtime : null
  const runtimeId = toAgentRuntimeId(
    typeof runtimeInput?.id === "string" ? runtimeInput.id : null,
  )
  if (
    !runtimeId ||
    !(CONTRACT_RUNTIME_IDS as readonly string[]).includes(runtimeId)
  ) {
    errors.push("Unsupported runtime.id")
  }
  const requiredCapabilities = normalizeRequiredCapabilities(
    runtimeInput?.requiredCapabilities,
    errors,
  )
  const executionProfile = normalizeExecutionProfile(
    runtimeInput?.executionProfile,
    errors,
  )
  const policyGrant = normalizePolicyGrant(
    runtimeInput?.policyGrant,
    executionProfile,
    errors,
  )

  const mode = typeof value.mode === "string" ? value.mode : ""
  if (!(AGENT_JOB_MODES as readonly string[]).includes(mode)) {
    errors.push("Unsupported mode")
  }

  const prompt = isRecord(value.prompt) ? value.prompt : null
  const promptText =
    prompt && typeof prompt.text === "string" ? prompt.text.trim() : ""
  if (!promptText) errors.push("prompt.text is required")
  if (promptText.length > MAX_PROMPT_LENGTH) {
    errors.push(`prompt.text exceeds ${MAX_PROMPT_LENGTH} character limit`)
  }

  const provider = normalizeProviderSelection(value.provider, errors)

  const input =
    value.input === undefined || value.input === null
      ? {}
      : isRecord(value.input)
        ? value.input
        : null
  if (!input) errors.push("input must be an object when provided")

  const artifacts =
    value.artifacts === undefined || value.artifacts === null
      ? {}
      : isRecord(value.artifacts)
        ? value.artifacts
        : null
  if (!artifacts) errors.push("artifacts must be an object when provided")
  const artifactBaseDir = optionalString(artifacts?.baseDir, null)
  if (artifactBaseDir && !isAbsoluteLocalPath(artifactBaseDir)) {
    errors.push("artifacts.baseDir must be an absolute local path")
  }
  const writePolicy = optionalString(artifacts?.writePolicy, "metadata-only")
  if (
    !writePolicy ||
    !(LOCAL_JOB_API_WRITE_POLICIES as readonly string[]).includes(writePolicy)
  ) {
    errors.push("Unsupported artifacts.writePolicy")
  }

  const secretFindings: string[] = []
  collectSecretFindings(value, "", secretFindings)
  errors.push(...secretFindings)

  if (errors.length > 0 || !runtimeId || !input || !artifacts || !writePolicy) {
    return { ok: false, errors }
  }
  const contractRuntimeId = runtimeId as AgentRuntimeContractId

  return {
    ok: true,
    request: {
      apiVersion: LOCAL_JOB_API_VERSION,
      kind: "agent",
      consumer,
      project: {
        cwd,
        projectId: projectId || null,
      },
      runtime: {
        id: contractRuntimeId,
        requiredCapabilities,
        executionProfile,
        policyGrant,
      },
      mode: mode as AgentJobMode,
      prompt: {
        text: promptText,
      },
      provider,
      input,
      artifacts: {
        baseDir: artifactBaseDir || null,
        writePolicy: writePolicy as LocalJobApiWritePolicy,
      },
    },
  }
}

export function assertLocalJobApiCreateRequest(
  value: unknown,
): NormalizedLocalJobApiCreateRequest {
  const result = validateLocalJobApiCreateRequest(value)
  if (result.ok) return result.request
  throw new Error(result.errors.join("; "))
}

export function assertLocalJobApiRuntimeReadiness(
  readiness: LocalJobApiRuntimeReadiness,
): void {
  if (
    !(LOCAL_JOB_API_RUNTIME_READINESS_STATES as readonly string[]).includes(
      readiness.state,
    )
  ) {
    throw new Error(`Unsupported runtime readiness state: ${readiness.state}`)
  }
  if (readiness.detail !== undefined) {
    assertNoSecretText(readiness.detail, "runtime readiness detail")
  }
  if (readiness.hint !== undefined) {
    assertNoSecretText(readiness.hint, "runtime readiness hint")
  }
}

export function normalizeLocalJobApiRuntimeReadiness(
  readiness: LocalJobApiRuntimeReadiness,
): LocalJobApiRuntimeReadiness {
  const normalized: LocalJobApiRuntimeReadiness = {
    state: readiness.state,
  }
  if (readiness.detail?.trim()) {
    normalized.detail = readiness.detail.trim()
  }
  if (readiness.hint?.trim()) {
    normalized.hint = readiness.hint.trim()
  }
  assertLocalJobApiRuntimeReadiness(normalized)
  return normalized
}
