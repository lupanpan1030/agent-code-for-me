import {
  isProviderProfileSource,
  parseProviderProfileSource,
} from "../../../../shared/provider-profile-types"

export const MODEL_ID_MAP: Record<string, string> = {
  fable: "fable",
  opus: "opus",
  sonnet: "sonnet",
  haiku: "haiku",
}

const CODEX_THINKING_LEVELS = new Set(["low", "medium", "high", "xhigh"])
const PROVIDER_PROFILE_CODEX_REASONING = "none"

export function isBoundProviderProfileUnavailable(input: {
  modelSource: string | null
  profilesLoaded: boolean
  targetRuntime: "claude" | "codex"
  providerProfiles: Array<{
    id: string
    targetRuntimes: string[]
  }>
}): boolean {
  const profileId = parseProviderProfileSource(input.modelSource)
  if (!profileId || !input.profilesLoaded) return false
  return !input.providerProfiles.some(
    (profile) =>
      profile.id === profileId &&
      profile.targetRuntimes.includes(input.targetRuntime),
  )
}

export function resolveCodexAuthMethodForBindingSource(
  modelSource: string | null,
): "chatgpt" | "api_key" {
  return modelSource === "openai-api-key" ? "api_key" : "chatgpt"
}

export function resolveCodexBoundCredentialState(
  modelSource: string | null,
  credentials: { hasApiKey: boolean; hasSubscription: boolean },
): {
  hasBoundCredential: boolean
  kind: "api-key" | "subscription"
} {
  if (modelSource === "openai-api-key") {
    return {
      hasBoundCredential: credentials.hasApiKey,
      kind: "api-key",
    }
  }
  return {
    hasBoundCredential: credentials.hasSubscription,
    kind: "subscription",
  }
}

export function resolveClaudeTransportModelId(selectedModelId: string): string {
  return Object.hasOwn(MODEL_ID_MAP, selectedModelId)
    ? MODEL_ID_MAP[selectedModelId]
    : selectedModelId
}

export function resolveClaudeTransportModelForEffectiveSource(input: {
  selectedModelId: string | null
  bindingModelSource: string | null
  effectiveModelSource: string
}): string | undefined {
  if (
    input.effectiveModelSource !== input.bindingModelSource &&
    isProviderProfileSource(input.effectiveModelSource)
  ) {
    // OAuth/custom-provider diversion is run-scoped. Let that Profile use its
    // own current default without mutating the durable non-Profile binding.
    return undefined
  }
  return input.selectedModelId
    ? resolveClaudeTransportModelId(input.selectedModelId)
    : undefined
}

export function composeCodexTransportModel(
  selectedModelId: string,
  selectedThinking: unknown,
): string {
  if (!selectedModelId) return ""
  const normalizedThinking =
    typeof selectedThinking === "string" &&
    CODEX_THINKING_LEVELS.has(selectedThinking)
      ? selectedThinking
      : "high"
  return `${selectedModelId}/${normalizedThinking}`
}

export function composeProviderProfileCodexTransportModel(
  selectedModelId: string,
): string {
  if (!selectedModelId) return ""
  // The binding modelId is an opaque provider model snapshot. Append Locus's
  // reserved transport suffix without interpreting a legitimate final segment
  // such as `org/high` or `vendor/none`; the gateway strips only this suffix.
  return `${selectedModelId}/${PROVIDER_PROFILE_CODEX_REASONING}`
}
