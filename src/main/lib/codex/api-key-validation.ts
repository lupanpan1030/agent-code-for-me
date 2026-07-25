import { normalizeCodexApiKey } from "../../../shared/codex-api-key"
import { isSafeProviderModel } from "../../../shared/local-job-api"
import { redactProviderSecrets } from "../../../shared/provider-profile-security"

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

export type CodexApiKeyValidationCategory =
  | "invalid_format"
  | "auth_failed"
  | "rate_limited"
  | "request_failed"
  | "network_failed"
  | "cancelled"

export type CodexApiKeyValidationResult =
  | {
      ok: true
    }
  | {
      ok: false
      category: CodexApiKeyValidationCategory
      status: "needs-auth" | "failed"
      message: string
      hint: string
      httpStatus?: number
    }

export type CodexApiKeyValidationOptions = {
  fetchImpl?: FetchLike
  signal?: AbortSignal
  timeoutMs?: number
  modelsUrl?: string
  maxResponseBytes?: number
}

const DEFAULT_OPENAI_MODELS_URL = "https://api.openai.com/v1/models"
const DEFAULT_VALIDATION_TIMEOUT_MS = 8_000
const DEFAULT_MAX_RESPONSE_BYTES = 2_000_000
const MAX_CODEX_API_MODEL_IDS = 500
const CODEX_API_MODEL_PREFIX = /^(?:gpt-|o|codex)/

let cachedModelIds: string[] = []
let cachedModelIdsInitialized = false
const modelIdListeners = new Set<(modelIds: string[]) => void>()

export function normalizeCodexApiModelIds(entries: unknown): string[] {
  if (!Array.isArray(entries)) return []

  const seen = new Set<string>()
  const modelIds: string[] = []
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue
    const id = (entry as { id?: unknown }).id
    if (
      typeof id !== "string" ||
      !CODEX_API_MODEL_PREFIX.test(id) ||
      !isSafeProviderModel(id) ||
      seen.has(id)
    ) {
      continue
    }
    seen.add(id)
    modelIds.push(id)
    if (modelIds.length >= MAX_CODEX_API_MODEL_IDS) break
  }
  return modelIds
}

export function parseCodexApiModelIds(rawBody: string): string[] {
  try {
    const parsed = JSON.parse(rawBody) as { data?: unknown }
    return normalizeCodexApiModelIds(parsed.data)
  } catch {
    return []
  }
}

function replaceCachedModelIds(modelIds: string[]): void {
  const changed =
    !cachedModelIdsInitialized ||
    cachedModelIds.length !== modelIds.length ||
    cachedModelIds.some((modelId, index) => modelId !== modelIds[index])
  cachedModelIds = [...modelIds]
  cachedModelIdsInitialized = true
  if (!changed) return

  for (const listener of modelIdListeners) {
    try {
      listener([...cachedModelIds])
    } catch {
      // A renderer subscriber must not affect key validation.
    }
  }
}

async function readBoundedResponseText(
  response: Response,
  maxResponseBytes: number,
): Promise<string | null> {
  const contentLength = response.headers.get("content-length")
  if (contentLength && Number(contentLength) > maxResponseBytes) {
    await response.body?.cancel().catch(() => undefined)
    return null
  }

  if (!response.body) return ""

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let responseBytes = 0
  let text = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      responseBytes += value.byteLength
      if (responseBytes > maxResponseBytes) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return text
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}

export function getCachedCodexApiKeyModelIds(): string[] {
  return [...cachedModelIds]
}

export function hasCachedCodexApiKeyModelIdsSnapshot(): boolean {
  return cachedModelIdsInitialized
}

export function subscribeCodexApiKeyModelIds(
  listener: (modelIds: string[]) => void,
): () => void {
  modelIdListeners.add(listener)
  return () => modelIdListeners.delete(listener)
}

export function clearCachedCodexApiKeyModelIds(): void {
  replaceCachedModelIds([])
}

export class CodexApiKeyValidationError extends Error {
  category: CodexApiKeyValidationCategory
  status: "needs-auth" | "failed"
  hint: string
  httpStatus?: number

  constructor(result: Extract<CodexApiKeyValidationResult, { ok: false }>) {
    super(result.hint ? `${result.message} ${result.hint}` : result.message)
    this.name = "CodexApiKeyValidationError"
    this.category = result.category
    this.status = result.status
    this.hint = result.hint
    this.httpStatus = result.httpStatus
  }
}

function createAbortController(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): {
  signal: AbortSignal
  cleanup: () => void
} {
  const controller = new AbortController()
  const abortFromParent = () => controller.abort(parentSignal?.reason)

  if (parentSignal?.aborted) {
    controller.abort(parentSignal.reason)
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true })
  }

  const timeoutId = setTimeout(() => {
    controller.abort(new Error("Codex API key validation timed out."))
  }, timeoutMs)

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId)
      parentSignal?.removeEventListener("abort", abortFromParent)
    },
  }
}

function parseProviderErrorMessage(rawBody: string): string | null {
  if (!rawBody.trim()) return null

  try {
    const parsed = JSON.parse(rawBody) as {
      error?: { message?: unknown; code?: unknown; type?: unknown } | string
      message?: unknown
    }
    if (typeof parsed.error === "string") return parsed.error
    if (typeof parsed.error?.message === "string") return parsed.error.message
    if (typeof parsed.message === "string") return parsed.message
  } catch {
    // Plain-text error bodies are handled below.
  }

  return rawBody
}

function redactedProviderMessage(
  rawBody: string,
  apiKey: string,
): string | null {
  const message = parseProviderErrorMessage(rawBody)
  if (!message) return null
  return redactProviderSecrets(message, [apiKey])
}

function validationFailure(params: {
  category: CodexApiKeyValidationCategory
  status: "needs-auth" | "failed"
  message: string
  hint: string
  httpStatus?: number
}): CodexApiKeyValidationResult {
  return {
    ok: false,
    category: params.category,
    status: params.status,
    message: params.message,
    hint: params.hint,
    ...(params.httpStatus !== undefined
      ? { httpStatus: params.httpStatus }
      : {}),
  }
}

function classifyHttpFailure(
  httpStatus: number,
): Pick<
  Extract<CodexApiKeyValidationResult, { ok: false }>,
  "category" | "status" | "message" | "hint"
> {
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      category: "auth_failed",
      status: "needs-auth",
      message: `OpenAI rejected the saved Codex API key (${httpStatus}).`,
      hint: "Save a valid OpenAI API key in Settings > Models before starting Codex.",
    }
  }

  if (httpStatus === 429) {
    return {
      category: "rate_limited",
      status: "failed",
      message: "OpenAI rate-limited Codex API key validation.",
      hint: "Try again later, or use a different API key with available quota.",
    }
  }

  return {
    category: "request_failed",
    status: "failed",
    message: `OpenAI API key validation failed with HTTP ${httpStatus}.`,
    hint: "Check OpenAI API availability, billing, and key permissions before starting Codex.",
  }
}

export async function validateCodexApiKey(
  apiKey: string,
  options: CodexApiKeyValidationOptions = {},
): Promise<CodexApiKeyValidationResult> {
  const normalized = normalizeCodexApiKey(apiKey)
  if (!normalized) {
    return validationFailure({
      category: "invalid_format",
      status: "needs-auth",
      message: "Codex API key format is invalid.",
      hint: "Use an OpenAI API key that starts with sk-.",
    })
  }

  clearCachedCodexApiKeyModelIds()

  const timeout = Math.max(
    1,
    options.timeoutMs ?? DEFAULT_VALIDATION_TIMEOUT_MS,
  )
  const { signal, cleanup } = createAbortController(options.signal, timeout)
  const fetchImpl = options.fetchImpl ?? fetch
  const maxResponseBytes = Math.max(
    1,
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
  )

  try {
    const response = await fetchImpl(
      options.modelsUrl ?? DEFAULT_OPENAI_MODELS_URL,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${normalized}`,
        },
        signal,
      },
    )

    if (response.ok) {
      const rawBody = await readBoundedResponseText(response, maxResponseBytes)
      replaceCachedModelIds(rawBody ? parseCodexApiModelIds(rawBody) : [])
      return { ok: true }
    }

    const rawBody =
      (await readBoundedResponseText(response, maxResponseBytes)) ?? ""
    const classified = classifyHttpFailure(response.status)
    const upstreamMessage = redactedProviderMessage(rawBody, normalized)
    return validationFailure({
      ...classified,
      message: upstreamMessage
        ? `${classified.message} ${upstreamMessage}`
        : classified.message,
      httpStatus: response.status,
    })
  } catch (error) {
    if (signal.aborted) {
      return validationFailure({
        category: options.signal?.aborted ? "cancelled" : "network_failed",
        status: "failed",
        message: options.signal?.aborted
          ? "Codex API key validation was cancelled."
          : "Codex API key validation timed out.",
        hint: "Try again when the OpenAI API is reachable.",
      })
    }

    const message = error instanceof Error ? error.message : String(error)
    const redacted = redactProviderSecrets(message, [normalized])
    return validationFailure({
      category: "network_failed",
      status: "failed",
      message: `Codex API key validation could not reach OpenAI: ${redacted}`,
      hint: "Check network connectivity before starting Codex.",
    })
  } finally {
    cleanup()
  }
}

export async function assertValidCodexApiKey(
  apiKey: string,
  options: CodexApiKeyValidationOptions = {},
): Promise<void> {
  const result = await validateCodexApiKey(apiKey, options)
  if (!result.ok) {
    throw new CodexApiKeyValidationError(result)
  }
}
