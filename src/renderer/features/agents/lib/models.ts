import {
  CODEX_MODELS,
  type CodexThinkingLevel,
} from "../../../../shared/model-catalog"
import {
  type ProviderProfileMetadata,
  parseProviderProfileSource,
  providerProfileSource,
} from "../../../../shared/provider-profile-types"

export {
  CLAUDE_MODELS,
  type ClaudeModel,
  type ClaudeModelInfo,
} from "../../../../shared/custom-agent-models"
export type { CodexThinkingLevel }
export { CODEX_MODELS }

export type ModelInfo = {
  summary?: string
  bestFor?: string
  tokenNote?: string
  contextWindow?: string
  maxOutput?: string
  pricing?: string
  cachedInput?: string
  latency?: string
}

export type CodexFirstPartyModelSource = "chatgpt" | "openai-api-key"

const CODEX_CHATGPT_AUTH_ONLY_MODEL_IDS = new Set(
  CODEX_MODELS.filter((model) => model.authRestriction === "chatgpt-only").map(
    (model) => model.id,
  ),
)

export function isCodexApiKeySupportedModel(modelId: string): boolean {
  return !CODEX_CHATGPT_AUTH_ONLY_MODEL_IDS.has(modelId)
}

type CodexModelSupport = {
  id: string
  authRestriction?: "chatgpt-only" | "api-key-only"
}

function getCodexModelAuthRestriction(
  model: string | CodexModelSupport,
): CodexModelSupport["authRestriction"] {
  if (typeof model !== "string") return model.authRestriction
  return CODEX_MODELS.find((candidate) => candidate.id === model)
    ?.authRestriction
}

export function isFirstPartyCodexModelSource(
  source: string,
): source is CodexFirstPartyModelSource {
  return source === "chatgpt" || source === "openai-api-key"
}

export function isCodexModelSupportedBySource(
  source: CodexFirstPartyModelSource,
  model: string | CodexModelSupport,
): boolean {
  const restriction = getCodexModelAuthRestriction(model)
  if (restriction === "chatgpt-only") return source === "chatgpt"
  if (restriction === "api-key-only") return source === "openai-api-key"
  return true
}

export function getCodexModelsForSource<TModel extends CodexModelSupport>(
  models: TModel[],
  source: CodexFirstPartyModelSource,
): TModel[] {
  return models.filter((model) => isCodexModelSupportedBySource(source, model))
}

export function resolveCodexModelForSource<TModel extends CodexModelSupport>({
  models,
  selectedModelId,
  source,
}: {
  models: TModel[]
  selectedModelId: string
  source: CodexFirstPartyModelSource
}): { model: TModel | undefined; changed: boolean } {
  const selectedModel = models.find((model) => model.id === selectedModelId)
  if (selectedModel && isCodexModelSupportedBySource(source, selectedModel)) {
    return { model: selectedModel, changed: false }
  }

  return {
    model: models.find((model) => isCodexModelSupportedBySource(source, model)),
    changed: true,
  }
}

export const LEGACY_CLAUDE_PROVIDER_PROFILE_ID = "legacy-claude-provider"

export type ClaudeSourceProviderProfile = Pick<
  ProviderProfileMetadata,
  "id" | "targetRuntimes" | "lastTestStatus"
>

export type ClaudeModelSourceNormalizationResult =
  | {
      ok: true
      source: string
      changed: boolean
      reason?:
        | "auto"
        | "legacy-profile"
        | "oauth-fallback"
        | "provider-profile-fallback"
    }
  | {
      ok: false
      blocker: {
        code: "provider-profile-required"
        message: string
        hint: string
      }
    }

export function getLegacyClaudeProviderProfile(
  profiles: ClaudeSourceProviderProfile[],
): ClaudeSourceProviderProfile | undefined {
  return profiles.find(
    (profile) =>
      profile.id === LEGACY_CLAUDE_PROVIDER_PROFILE_ID &&
      profile.targetRuntimes.includes("claude") &&
      profile.lastTestStatus?.ok !== false,
  )
}

/** First Claude-capable profile that has not failed its last test. */
export function getUsableClaudeProviderProfile(
  profiles: ClaudeSourceProviderProfile[],
): ClaudeSourceProviderProfile | undefined {
  return (
    getLegacyClaudeProviderProfile(profiles) ??
    profiles.find(
      (profile) =>
        profile.targetRuntimes.includes("claude") &&
        profile.lastTestStatus?.ok !== false,
    )
  )
}

function providerProfileRequiredBlocker(): ClaudeModelSourceNormalizationResult {
  return {
    ok: false,
    blocker: {
      code: "provider-profile-required",
      message: "Custom provider is now configured through Provider Profiles.",
      hint: "Create or select a Claude-capable Provider Profile in Settings > Models.",
    },
  }
}

export function normalizeClaudeModelSourceForRun(input: {
  source: string | undefined | null
  providerProfiles: ClaudeSourceProviderProfile[]
  canUseClaudeOAuth?: boolean
}): ClaudeModelSourceNormalizationResult {
  const rawSource = input.source?.trim()
  // When OAuth is explicitly unusable, an unspecified/OAuth source must not run
  // the (nonexistent) OAuth path — divert to a usable Provider Profile if any.
  const oauthExplicitlyUnusable = input.canUseClaudeOAuth === false
  if (
    oauthExplicitlyUnusable &&
    (!rawSource || rawSource === "auto" || rawSource === "claude-oauth")
  ) {
    const usableProfile = getUsableClaudeProviderProfile(input.providerProfiles)
    if (usableProfile) {
      return {
        ok: true,
        source: providerProfileSource(usableProfile.id),
        changed: true,
        reason: "provider-profile-fallback",
      }
    }
    return providerProfileRequiredBlocker()
  }

  if (!rawSource || rawSource === "auto") {
    return {
      ok: true,
      source: "claude-oauth",
      changed: rawSource !== "claude-oauth",
      reason: rawSource === "auto" ? "auto" : undefined,
    }
  }

  if (parseProviderProfileSource(rawSource) || rawSource === "claude-oauth") {
    return { ok: true, source: rawSource, changed: false }
  }

  if (rawSource !== "custom-provider") {
    return { ok: true, source: rawSource, changed: false }
  }

  const legacyProfile = getLegacyClaudeProviderProfile(input.providerProfiles)
  if (legacyProfile) {
    return {
      ok: true,
      source: providerProfileSource(legacyProfile.id),
      changed: true,
      reason: "legacy-profile",
    }
  }

  if (input.canUseClaudeOAuth) {
    return {
      ok: true,
      source: "claude-oauth",
      changed: true,
      reason: "oauth-fallback",
    }
  }

  return providerProfileRequiredBlocker()
}

export function formatCodexThinkingLabel(thinking: CodexThinkingLevel): string {
  if (thinking === "xhigh") return "Extra High"
  return thinking.charAt(0).toUpperCase() + thinking.slice(1)
}

export function formatModelLabel(name: string, version?: string): string {
  return version ? `${name} ${version}` : name
}
