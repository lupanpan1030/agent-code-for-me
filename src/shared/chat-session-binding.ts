import {
  PROVIDER_PROFILE_SOURCE_PREFIX,
  parseProviderProfileSource,
  providerProfileSource,
} from "./provider-profile-types"

export const CHAT_SESSION_BINDING_RUNTIMES = ["claude-code", "codex"] as const

export const CLAUDE_CHAT_MODEL_SOURCES = [
  "claude-oauth",
  "custom-provider",
] as const

export const CODEX_CHAT_MODEL_SOURCES = ["chatgpt", "openai-api-key"] as const

export const CODEX_CHAT_THINKING_LEVELS = [
  "low",
  "medium",
  "high",
  "xhigh",
] as const

export type ChatSessionBindingRuntime =
  (typeof CHAT_SESSION_BINDING_RUNTIMES)[number]
export type ClaudeChatModelSource =
  | (typeof CLAUDE_CHAT_MODEL_SOURCES)[number]
  | `provider-profile:${string}`
export type CodexChatModelSource =
  | (typeof CODEX_CHAT_MODEL_SOURCES)[number]
  | `provider-profile:${string}`
export type ChatSessionBindingModelSource =
  | ClaudeChatModelSource
  | CodexChatModelSource
export type CodexChatThinkingLevel = (typeof CODEX_CHAT_THINKING_LEVELS)[number]

export type ChatSessionBinding = {
  id: string | null
  subChatId: string
  runtime: ChatSessionBindingRuntime
  providerProfileId: string | null
  modelId: string | null
  modelSource: ChatSessionBindingModelSource | null
  thinkingLevel: CodexChatThinkingLevel | null
  createdAt: Date | null
  updatedAt: Date | null
}

export type ChatSessionBindingWriteInput = {
  runtime: ChatSessionBindingRuntime
  providerProfileId?: string | null
  modelId?: string | null
  modelSource?: string | null
  thinkingLevel?: string | null
}

type UntrustedChatSessionBindingWriteInput = {
  runtime: string
  providerProfileId?: string | null
  modelId?: string | null
  modelSource?: string | null
  thinkingLevel?: string | null
}

export type NormalizedChatSessionBindingWrite = {
  runtime: ChatSessionBindingRuntime
  providerProfileId: string | null
  modelId: string | null
  modelSource: ChatSessionBindingModelSource | null
  thinkingLevel: CodexChatThinkingLevel | null
}

export type ProviderProfileChatSessionBindingSelection = {
  id: string
  defaultModel: string
}

function normalizeNullableString(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function includesString(values: readonly string[], value: string): boolean {
  return values.includes(value)
}

export function normalizeChatSessionBindingRuntime(
  runtime: string,
): ChatSessionBindingRuntime {
  if (includesString(CHAT_SESSION_BINDING_RUNTIMES, runtime)) {
    return runtime as ChatSessionBindingRuntime
  }
  throw new Error(`Unsupported chat session binding runtime: ${runtime}`)
}

export function createProviderProfileChatSessionBindingWrite(input: {
  runtime: ChatSessionBindingRuntime
  profile: ProviderProfileChatSessionBindingSelection
}): NormalizedChatSessionBindingWrite {
  return normalizeChatSessionBindingWrite({
    runtime: input.runtime,
    providerProfileId: input.profile.id,
    modelId: input.profile.defaultModel,
    modelSource: providerProfileSource(input.profile.id),
    thinkingLevel: null,
  })
}

export function getProviderProfileIdFromModelSource(
  modelSource: string | null | undefined,
): string | null {
  const normalizedSource = normalizeNullableString(modelSource)
  if (!normalizedSource?.startsWith(PROVIDER_PROFILE_SOURCE_PREFIX)) {
    return null
  }

  const profileId = parseProviderProfileSource(normalizedSource)
  if (!profileId) {
    throw new Error(
      "A provider-profile model source must include a provider profile ID",
    )
  }
  return profileId
}

export function normalizeChatSessionBindingProviderProfile(input: {
  modelSource?: string | null
  providerProfileId?: string | null
}): {
  modelSource: string | null
  providerProfileId: string | null
} {
  const modelSource = normalizeNullableString(input.modelSource)
  const sourceProfileId = getProviderProfileIdFromModelSource(modelSource)

  if (sourceProfileId) {
    return {
      modelSource: providerProfileSource(sourceProfileId),
      providerProfileId: sourceProfileId,
    }
  }

  return {
    modelSource,
    providerProfileId: null,
  }
}

function normalizeModelSource(
  runtime: ChatSessionBindingRuntime,
  modelSource: string | null,
): ChatSessionBindingModelSource | null {
  if (!modelSource) return null
  if (modelSource.startsWith(PROVIDER_PROFILE_SOURCE_PREFIX)) {
    return modelSource as `provider-profile:${string}`
  }

  const allowedSources =
    runtime === "claude-code"
      ? CLAUDE_CHAT_MODEL_SOURCES
      : CODEX_CHAT_MODEL_SOURCES
  if (!includesString(allowedSources, modelSource)) {
    throw new Error(
      `Unsupported ${runtime} chat session binding model source: ${modelSource}`,
    )
  }
  return modelSource as ChatSessionBindingModelSource
}

function normalizeThinkingLevel(
  runtime: ChatSessionBindingRuntime,
  thinkingLevel: string | null | undefined,
): CodexChatThinkingLevel | null {
  const normalized = normalizeNullableString(thinkingLevel)
  if (!normalized) return null
  if (runtime !== "codex") {
    throw new Error("Claude chat session bindings cannot persist thinkingLevel")
  }
  if (!includesString(CODEX_CHAT_THINKING_LEVELS, normalized)) {
    throw new Error(
      `Unsupported Codex chat session binding thinking level: ${normalized}`,
    )
  }
  return normalized as CodexChatThinkingLevel
}

export function normalizeChatSessionBindingWrite(
  input: UntrustedChatSessionBindingWriteInput,
): NormalizedChatSessionBindingWrite {
  const runtime = normalizeChatSessionBindingRuntime(input.runtime)
  const profile = normalizeChatSessionBindingProviderProfile(input)
  // Provider Profiles currently advertise only reasoning=none. Normalize the
  // capability exception before validating ordinary Codex effort values so
  // every Profile write, including stale or untrusted input, becomes NULL.
  const thinkingLevel = profile.providerProfileId
    ? null
    : normalizeThinkingLevel(runtime, input.thinkingLevel)

  return {
    runtime,
    providerProfileId: profile.providerProfileId,
    modelId: normalizeNullableString(input.modelId),
    modelSource: normalizeModelSource(runtime, profile.modelSource),
    thinkingLevel,
  }
}
