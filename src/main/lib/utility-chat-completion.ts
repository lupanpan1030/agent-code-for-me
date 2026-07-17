import { getProviderDefaultRuntimeConfig } from "./provider-profiles/storage"
import {
  getActiveLocalApiProviderConfig,
  type LocalApiProviderPurpose,
} from "./trpc/routers/local-api-provider-config"

export type LocalChatCompletionProviderConfig = {
  apiKey: string | null
  apiUrl: string
  model: string
  authMode?: "bearer" | "x-api-key" | "none"
  headers?: Record<string, string>
}

export const COMMIT_MESSAGE_PROVIDER_TIMEOUT_MS = 15_000
export const PROVIDER_ERROR_DETAIL_MAX_LENGTH = 500

export type ChatCompletionRequestBody = {
  model: string
  messages: Array<{
    role: "system" | "user" | "assistant"
    content: string
  }>
  temperature: number
  max_tokens: number
  thinking?: {
    type: "disabled"
  }
}

export function buildChatCompletionUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "")
  if (/\/chat\/completions$/i.test(normalizedBaseUrl)) {
    return normalizedBaseUrl
  }

  return `${normalizedBaseUrl}/chat/completions`
}

export type ChatCompletionLocalApiProviderPurpose = Extract<
  LocalApiProviderPurpose,
  "sub_chat_title" | "commit_message"
>

export function getLocalChatCompletionProviderConfig(
  purpose: ChatCompletionLocalApiProviderPurpose,
): LocalChatCompletionProviderConfig | null {
  const profile = getProviderDefaultRuntimeConfig(purpose)
  if (profile && profile.protocol === "openai-chat") {
    return {
      apiKey: profile.token,
      apiUrl: buildChatCompletionUrl(profile.baseUrl),
      model: profile.modelOverride || profile.defaultModel,
      authMode: profile.authMode,
      headers: profile.headers,
    }
  }

  const config = getActiveLocalApiProviderConfig(purpose)
  if (!config) return null

  return {
    apiKey: config.token,
    apiUrl: buildChatCompletionUrl(config.baseUrl),
    model: config.model,
    authMode: "bearer",
  }
}

export function buildUtilityProviderHeaders(
  config: LocalChatCompletionProviderConfig,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(config.headers ?? {}),
  }
  if (config.authMode === "x-api-key" && config.apiKey) {
    headers["x-api-key"] = config.apiKey
  } else if (config.authMode !== "none" && config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`
  }
  return headers
}

export function isDeepSeekChatCompletionProvider(
  config: LocalChatCompletionProviderConfig,
): boolean {
  const apiUrl = config.apiUrl.toLowerCase()

  return apiUrl.includes("api.deepseek.com")
}

export function buildUtilityChatCompletionBody(
  config: LocalChatCompletionProviderConfig,
  body: Omit<ChatCompletionRequestBody, "thinking">,
): ChatCompletionRequestBody {
  if (!isDeepSeekChatCompletionProvider(config)) {
    return body
  }

  return {
    ...body,
    // DeepSeek V4 enables thinking by default. Utility calls need short plain
    // content, not a reasoning stream that can consume the whole token budget.
    thinking: { type: "disabled" },
  }
}

export async function logProviderRequestFailure(
  label: string,
  response: Response,
): Promise<void> {
  let detail = ""
  try {
    detail = await response.text()
  } catch {
    // Ignore body read failures; the status code is still useful.
  }

  console.error(
    `[${label}] Provider request failed:`,
    response.status,
    detail.slice(0, PROVIDER_ERROR_DETAIL_MAX_LENGTH),
  )
}
