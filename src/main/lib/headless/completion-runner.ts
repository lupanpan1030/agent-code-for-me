import Ajv2020 from "ajv/dist/2020"
import type {
  LocalJobApiCompletionMessage,
  LocalJobApiCompletionResult,
  LocalJobApiCompletionUsage,
  LocalJobApiResponseFormat,
} from "../../../shared/local-job-api"
import type { ProviderProfileProtocol } from "../../../shared/provider-profile-types"
import type {
  CreateCanonicalRunEventLedgerOptions,
  OutcomeEvidence,
} from "../agent-runtime/run-event-ledger"
import {
  bindRunExecutionProvenance,
  getOrCreateRunEventLedger,
  releaseRunEventLedger,
} from "../agent-runtime/run-event-ledger-host"
import { captureLocusCompletionProvenance } from "../agent-runtime/run-provenance"
import type { AgentJob, AgentJobEvent } from "../db/schema"
import type { ProviderProfileRuntimeConfig } from "../provider-profiles/storage"
import {
  buildChatCompletionUrl,
  buildUtilityChatCompletionBody,
  buildUtilityProviderHeaders,
  redactAndTruncateUtilityProviderText,
} from "../utility-chat-completion"
import { HEADLESS_EXIT_CODES, normalizeHeadlessExitCode } from "./job-runner"
import {
  type AgentJobDatabase,
  getAgentJob,
  listAgentJobEvents,
  startAgentJob,
} from "./job-store"
import { getLocalJobApiStoredRequest } from "./local-job-api"
import {
  type HeadlessProviderBindingDependencies,
  HeadlessProviderBindingError,
  resolveExplicitHeadlessProviderProfile,
} from "./provider-binding"

type CompletionFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export type RunPersistedCompletionJobOptions = {
  db: AgentJobDatabase
  jobId: string
  fetchImpl?: CompletionFetch
  workerId?: string
  workerPid?: number | null
  signal?: AbortSignal
  providerBindingDependencies?: HeadlessProviderBindingDependencies
  /** Locus build that executes the provider-only completion. */
  locusBuild?: string | null
  /** Terminal run-dir preparation registered with the one completed. */
  terminalArtifacts?: CreateCanonicalRunEventLedgerOptions["terminalArtifacts"]
}

export type RunPersistedCompletionJobResult = {
  job: AgentJob
  events: AgentJobEvent[]
  exitCode: number
}

type CompletionProviderRequest = {
  url: string
  body: Record<string, unknown>
}

type CompletionProviderResult = {
  content: unknown
  usage: LocalJobApiCompletionUsage
}

const STRUCTURED_OUTPUT_NAME = "structured_output"

function endpointUrl(
  baseUrl: string,
  suffix: "messages" | "responses",
): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "")
  if (new RegExp(`/${suffix}$`, "i").test(normalizedBaseUrl)) {
    return normalizedBaseUrl
  }
  return `${normalizedBaseUrl}/${suffix}`
}

function providerHeaders(
  profile: ProviderProfileRuntimeConfig,
  url: string,
  model: string,
): Record<string, string> {
  const headers = buildUtilityProviderHeaders({
    apiKey: profile.token,
    apiUrl: url,
    model,
    authMode: profile.authMode,
    headers: profile.headers,
  })
  if (profile.protocol === "anthropic" && !headers["anthropic-version"]) {
    headers["anthropic-version"] = "2023-06-01"
  }
  return headers
}

function openAiJsonSchemaFormat(schema: Record<string, unknown>) {
  return {
    type: "json_schema",
    name: STRUCTURED_OUTPUT_NAME,
    strict: true,
    schema,
  }
}

function openAiChatJsonSchema(schema: Record<string, unknown>) {
  return {
    name: STRUCTURED_OUTPUT_NAME,
    strict: true,
    schema,
  }
}

function buildOpenAiChatRequest(input: {
  profile: ProviderProfileRuntimeConfig
  model: string
  messages: LocalJobApiCompletionMessage[]
  maxTokens: number | null
  temperature: number | null
  responseFormat: LocalJobApiResponseFormat
}): CompletionProviderRequest {
  const url = buildChatCompletionUrl(input.profile.baseUrl)
  const body: Record<string, unknown> = buildUtilityChatCompletionBody(
    {
      apiKey: input.profile.token,
      apiUrl: url,
      model: input.model,
      authMode: input.profile.authMode,
      headers: input.profile.headers,
    },
    {
      model: input.model,
      messages: input.messages,
      temperature: input.temperature ?? 0,
      max_tokens: input.maxTokens ?? 1024,
    },
  )
  if (input.responseFormat.type === "json_schema") {
    body.response_format = {
      type: "json_schema",
      json_schema: openAiChatJsonSchema(input.responseFormat.schema),
    }
  }
  return { url, body }
}

function buildOpenAiResponsesRequest(input: {
  profile: ProviderProfileRuntimeConfig
  model: string
  messages: LocalJobApiCompletionMessage[]
  maxTokens: number | null
  temperature: number | null
  responseFormat: LocalJobApiResponseFormat
}): CompletionProviderRequest {
  const url = endpointUrl(input.profile.baseUrl, "responses")
  const body: Record<string, unknown> = {
    model: input.model,
    input: input.messages,
  }
  if (input.temperature !== null) body.temperature = input.temperature
  if (input.maxTokens !== null) body.max_output_tokens = input.maxTokens
  if (input.responseFormat.type === "json_schema") {
    body.text = {
      format: openAiJsonSchemaFormat(input.responseFormat.schema),
    }
  }
  return { url, body }
}

function buildAnthropicRequest(input: {
  profile: ProviderProfileRuntimeConfig
  model: string
  messages: LocalJobApiCompletionMessage[]
  maxTokens: number | null
  temperature: number | null
  responseFormat: LocalJobApiResponseFormat
}): CompletionProviderRequest {
  const url = endpointUrl(input.profile.baseUrl, "messages")
  const system = input.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n")
  const messages = input.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role,
      content: message.content,
    }))
  if (messages.length === 0) {
    throw new Error(
      "Anthropic completion requests require a user or assistant message.",
    )
  }
  const body: Record<string, unknown> = {
    model: input.model,
    messages,
    max_tokens: input.maxTokens ?? 1024,
  }
  if (system) body.system = system
  if (input.temperature !== null) body.temperature = input.temperature
  if (input.responseFormat.type === "json_schema") {
    body.tools = [
      {
        name: STRUCTURED_OUTPUT_NAME,
        description: "Return a JSON value matching the requested schema.",
        input_schema: input.responseFormat.schema,
      },
    ]
    body.tool_choice = {
      type: "tool",
      name: STRUCTURED_OUTPUT_NAME,
    }
  }
  return { url, body }
}

function buildProviderRequest(input: {
  profile: ProviderProfileRuntimeConfig
  model: string
  messages: LocalJobApiCompletionMessage[]
  maxTokens: number | null
  temperature: number | null
  responseFormat: LocalJobApiResponseFormat
}): CompletionProviderRequest {
  if (input.profile.protocol === "openai-chat") {
    return buildOpenAiChatRequest(input)
  }
  if (input.profile.protocol === "anthropic") {
    return buildAnthropicRequest(input)
  }
  return buildOpenAiResponsesRequest(input)
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function readUsage(
  protocol: ProviderProfileProtocol,
  data: Record<string, unknown>,
): LocalJobApiCompletionUsage {
  const usage =
    data.usage && typeof data.usage === "object" && !Array.isArray(data.usage)
      ? (data.usage as Record<string, unknown>)
      : {}
  if (protocol === "openai-chat") {
    return {
      inputTokens: readNumber(usage.prompt_tokens),
      outputTokens: readNumber(usage.completion_tokens),
    }
  }
  return {
    inputTokens: readNumber(usage.input_tokens),
    outputTokens: readNumber(usage.output_tokens),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function contentToText(value: unknown): string {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return ""
  return value
    .map((part) => {
      if (!isRecord(part)) return ""
      if (typeof part.text === "string") return part.text
      if (typeof part.output_text === "string") return part.output_text
      if (Array.isArray(part.content)) return contentToText(part.content)
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

function parseJsonText(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(
      `Completion response was not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

function extractOpenAiChatContent(
  data: Record<string, unknown>,
  responseFormat: LocalJobApiResponseFormat,
): string | unknown {
  const choices = Array.isArray(data.choices) ? data.choices : []
  const firstChoice = isRecord(choices[0]) ? choices[0] : {}
  const message = isRecord(firstChoice.message) ? firstChoice.message : {}
  const content = typeof message.content === "string" ? message.content : ""
  return responseFormat.type === "json_schema"
    ? parseJsonText(content)
    : content
}

function extractOpenAiResponsesText(data: Record<string, unknown>): string {
  if (typeof data.output_text === "string") return data.output_text
  const output = Array.isArray(data.output) ? data.output : []
  return output
    .map((item) => {
      if (!isRecord(item)) return ""
      if (typeof item.output_text === "string") return item.output_text
      if (typeof item.text === "string") return item.text
      return contentToText(item.content)
    })
    .filter(Boolean)
    .join("\n")
}

function extractOpenAiResponsesContent(
  data: Record<string, unknown>,
  responseFormat: LocalJobApiResponseFormat,
): string | unknown {
  const text = extractOpenAiResponsesText(data)
  return responseFormat.type === "json_schema" ? parseJsonText(text) : text
}

function extractAnthropicContent(
  data: Record<string, unknown>,
  responseFormat: LocalJobApiResponseFormat,
): string | unknown {
  const content = Array.isArray(data.content) ? data.content : []
  if (responseFormat.type === "json_schema") {
    const toolUse = content.find(
      (part) =>
        isRecord(part) &&
        part.type === "tool_use" &&
        part.name === STRUCTURED_OUTPUT_NAME,
    )
    if (isRecord(toolUse)) return toolUse.input ?? {}
    throw new Error(
      "Anthropic completion response did not include structured output.",
    )
  }
  return contentToText(content)
}

function validateJsonSchemaContent(
  schema: Record<string, unknown>,
  content: unknown,
): void {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  const validate = ajv.compile(schema)
  if (!validate(content)) {
    throw new Error(
      `Completion response did not match responseFormat.schema: ${ajv.errorsText(
        validate.errors,
      )}`,
    )
  }
}

function extractProviderContent(input: {
  protocol: ProviderProfileProtocol
  data: Record<string, unknown>
  responseFormat: LocalJobApiResponseFormat
}): string | unknown {
  if (input.protocol === "openai-chat") {
    return extractOpenAiChatContent(input.data, input.responseFormat)
  }
  if (input.protocol === "anthropic") {
    return extractAnthropicContent(input.data, input.responseFormat)
  }
  return extractOpenAiResponsesContent(input.data, input.responseFormat)
}

async function performCompletion(input: {
  profile: ProviderProfileRuntimeConfig
  model: string
  messages: LocalJobApiCompletionMessage[]
  maxTokens: number | null
  temperature: number | null
  responseFormat: LocalJobApiResponseFormat
  fetchImpl: CompletionFetch
  signal?: AbortSignal
}): Promise<CompletionProviderResult> {
  const request = buildProviderRequest(input)
  const response = await input.fetchImpl(request.url, {
    method: "POST",
    headers: providerHeaders(input.profile, request.url, input.model),
    body: JSON.stringify(request.body),
    signal: input.signal,
  })
  if (!response.ok) {
    let detail = ""
    try {
      detail = await response.text()
    } catch {
      detail = ""
    }
    throw new Error(
      `Provider request failed with status ${response.status}${
        detail
          ? `: ${redactAndTruncateUtilityProviderText(
              detail,
              {
                apiKey: input.profile.token,
                apiUrl: request.url,
                model: input.model,
                authMode: input.profile.authMode,
                headers: input.profile.headers,
              },
              500,
            )}`
          : ""
      }`,
    )
  }
  const data = await response.json()
  const record = isRecord(data) ? data : {}
  const content = extractProviderContent({
    protocol: input.profile.protocol,
    data: record,
    responseFormat: input.responseFormat,
  })
  if (input.responseFormat.type === "json_schema") {
    validateJsonSchemaContent(input.responseFormat.schema, content)
  }
  return {
    content,
    usage: readUsage(input.profile.protocol, record),
  }
}

function errorCodeForCompletion(error: unknown): string {
  if (error instanceof HeadlessProviderBindingError) return error.code
  if (error instanceof Error) {
    if (
      /responseFormat\.schema|valid JSON|structured output/i.test(error.message)
    ) {
      return "completion_schema_validation_failed"
    }
    if (/Provider request failed/i.test(error.message)) {
      return "provider_request_failed"
    }
    if (error.name === "AbortError") return "job_canceled"
  }
  return "runtime_error"
}

function completionResult(input: {
  content: unknown
  usage: LocalJobApiCompletionUsage
  resolvedProvider: LocalJobApiCompletionResult["resolvedProvider"]
}): LocalJobApiCompletionResult {
  return {
    content: input.content,
    usage: input.usage,
    resolvedProvider: input.resolvedProvider,
  }
}

const COMPLETION_PROTOCOL_NAME = "locus-local-job-api-completion"

function completionOutcomeEvidence(input: {
  jobId: string
  status: "succeeded" | "failed" | "canceled"
  content: unknown
}): OutcomeEvidence {
  const observationKey = `completion-result:${input.jobId}`
  const hasContent =
    input.content !== undefined &&
    input.content !== null &&
    !(typeof input.content === "string" && input.content.trim().length === 0)
  return {
    trigger:
      input.status === "canceled"
        ? { kind: "cancel", reason: "job_canceled", observationKey }
        : { kind: "host_result", status: input.status, observationKey },
    policy: { denied: false, evidenceKeys: ["policy:provider-only"] },
    output: {
      valid: input.status === "succeeded",
      empty: !hasContent,
      allowEmpty: false,
      evidenceKeys: hasContent ? ["completion:content"] : [],
    },
    postRun: {
      credentialsSafe: true,
      evidenceKeys: ["postrun:provider-only"],
    },
  }
}

export async function runPersistedCompletionJob(
  options: RunPersistedCompletionJobOptions,
): Promise<RunPersistedCompletionJobResult> {
  const initial = getAgentJob(options.db, options.jobId)
  if (!initial) throw new Error(`Unknown job: ${options.jobId}`)
  if (initial.kind !== "completion") {
    throw new Error(`Job ${initial.id} is not a completion job`)
  }
  const request = getLocalJobApiStoredRequest(initial)
  if (request.kind !== "completion") {
    throw new Error(`Job ${initial.id} did not persist a completion request`)
  }

  const workerId =
    options.workerId ?? `completion:${process.pid}:${Date.now()}:${initial.id}`
  const workerPid =
    options.workerPid === undefined ? process.pid : options.workerPid
  const job = await startAgentJob(options.db, {
    jobId: initial.id,
    workerId,
    workerPid,
  })
  const ledger = await getOrCreateRunEventLedger(options.db, job)

  const settleCompletion = async (input: {
    status: "succeeded" | "failed" | "canceled"
    content: unknown
    errorCode: string | null
    errorMessage: string | null
    result: unknown
  }): Promise<RunPersistedCompletionJobResult> => {
    await ledger.settle(
      completionOutcomeEvidence({
        jobId: job.id,
        status: input.status,
        content: input.content,
      }),
      {
        jobFields: (outcome) => {
          const errorCode =
            outcome.status === "succeeded"
              ? null
              : outcome.status === "canceled"
                ? "job_canceled"
                : (input.errorCode ?? outcome.reasons[0] ?? "runtime_error")
          return {
            exitCode: normalizeHeadlessExitCode({
              status: outcome.status as "succeeded" | "failed" | "canceled",
              errorCode,
            }),
            errorCode,
            errorMessage:
              outcome.status === "succeeded"
                ? null
                : outcome.status === "canceled"
                  ? "Job was canceled."
                  : (input.errorMessage ??
                    `Run outcome ${outcome.status}: ${outcome.reasons.join(", ")}.`),
            result: input.result,
          }
        },
        ...(options.terminalArtifacts
          ? { terminalArtifacts: options.terminalArtifacts }
          : {}),
      },
    )
    const completed = getAgentJob(options.db, job.id) ?? job
    return {
      job: completed,
      events: listAgentJobEvents(options.db, job.id),
      exitCode: normalizeHeadlessExitCode({
        status: completed.status as "succeeded" | "failed" | "canceled",
        errorCode: completed.errorCode,
      }),
    }
  }

  try {
    const provider = resolveExplicitHeadlessProviderProfile({
      db: options.db,
      runtime: request.runtime.id,
      providerProfileId: request.provider.profileId,
      modelOverride: request.provider.model,
      dependencies: options.providerBindingDependencies,
    })
    ledger.addSecretHints(
      provider.profile.token ? [provider.profile.token] : [],
    )
    await bindRunExecutionProvenance(
      ledger,
      captureLocusCompletionProvenance({
        runtimeId: job.runtime,
        locusBuild: options.locusBuild || job.createdByVersion || "unknown",
        protocolName: `${COMPLETION_PROTOCOL_NAME}:${provider.profile.protocol}`,
        schemaDocument: JSON.stringify({
          protocol: provider.profile.protocol,
          responseFormat: request.responseFormat.type,
        }),
      }),
    )
    const model =
      provider.resolvedProvider.model ?? provider.profile.defaultModel
    const result = await performCompletion({
      profile: provider.profile,
      model,
      messages: request.messages,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      responseFormat: request.responseFormat,
      fetchImpl: options.fetchImpl ?? fetch,
      signal: options.signal,
    })
    await ledger.ingestRuntimeObservation({
      observationKey: `completion-usage:${job.id}`,
      type: "usage_update",
      payload: {
        usage: result.usage,
        resolvedProvider: provider.resolvedProvider,
      },
    })
    return await settleCompletion({
      status: "succeeded",
      content: result.content,
      errorCode: null,
      errorMessage: null,
      result: completionResult({
        content: result.content,
        usage: result.usage,
        resolvedProvider: provider.resolvedProvider,
      }),
    })
  } catch (error) {
    const errorCode = errorCodeForCompletion(error)
    const status = errorCode === "job_canceled" ? "canceled" : "failed"
    const message = error instanceof Error ? error.message : String(error)
    return await settleCompletion({
      status,
      content: null,
      errorCode,
      errorMessage: message,
      result: null,
    })
  } finally {
    releaseRunEventLedger(options.db, job.id)
  }
}
