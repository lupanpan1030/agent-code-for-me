import type { AgentRuntimeContractId } from "../../../shared/agent-runtime-capabilities"
import type {
  LocalJobApiResolvedProvider,
  LocalJobApiResolvedProviderSource,
} from "../../../shared/local-job-api"
import {
  type ProviderProfileDefaultPurpose,
  type ProviderProfileTarget,
  providerProfileSource,
} from "../../../shared/provider-profile-types"
import type { AgentRuntimeProviderDiagnostic } from "../agent-runtime/run-contract"
import {
  getProviderGatewayEndpoint,
  revokeProviderGatewayToken,
} from "../provider-profiles/gateway"
import {
  getProviderDefaultRuntimeConfigFromDatabase,
  getProviderProfileRuntimeConfigFromDatabase,
  getProviderProfileRuntimeMetadataFromDatabase,
  type ProviderDefaultRuntimeConfig,
  type ProviderProfileRuntimeConfig,
  type ProviderProfileRuntimeMetadata,
  ProviderProfileStorageReadError,
} from "../provider-profiles/storage"
import type { HeadlessAgentRuntimeProviderReference } from "./agent-runtime-contract"
import type { AgentJobDatabase } from "./job-store"

export const HEADLESS_PROVIDER_BINDING_ERROR_CODES = [
  "provider_profile_required",
  "provider_profile_not_found",
  "provider_profile_runtime_mismatch",
  "provider_profile_unavailable",
] as const

export type HeadlessProviderBindingErrorCode =
  (typeof HEADLESS_PROVIDER_BINDING_ERROR_CODES)[number]

export function isInvalidHeadlessProviderBindingRequestCode(
  code: string | null | undefined,
): boolean {
  return (
    code === "provider_profile_not_found" ||
    code === "provider_profile_required" ||
    code === "provider_profile_runtime_mismatch"
  )
}

export function isUnavailableHeadlessProviderBindingCode(
  code: string | null | undefined,
): boolean {
  return code === "provider_profile_unavailable"
}

type GatewayEndpointKind = "anthropic" | "responses"

type HeadlessProviderRuntimeBinding = {
  target: ProviderProfileTarget
  defaultPurpose: ProviderProfileDefaultPurpose
  gatewayKind: GatewayEndpointKind
}

type ProviderGatewayEndpoint = {
  baseUrl: string
  token: string
  providerId: string
}

export type HeadlessProviderBindingDependencies = {
  getProviderProfileMetadata?: (
    db: AgentJobDatabase,
    profileId: string,
  ) => ProviderProfileRuntimeMetadata | null
  getProviderProfileRuntimeConfig?: (
    db: AgentJobDatabase,
    profileId: string,
  ) => ProviderProfileRuntimeConfig | null
  getProviderDefaultRuntimeConfig?: (
    db: AgentJobDatabase,
    purpose: ProviderProfileDefaultPurpose,
  ) => ProviderDefaultRuntimeConfig | null
  createGatewayEndpoint?: (
    profileId: string,
    kind: GatewayEndpointKind,
    options?: { ttlMs?: number },
  ) => Promise<ProviderGatewayEndpoint>
  revokeGatewayToken?: (token: string) => boolean
}

export type ResolveHeadlessProviderBindingInput = {
  db: AgentJobDatabase
  runtime: AgentRuntimeContractId
  providerProfileId?: string | null
  modelOverride?: string | null
  gatewayTtlMs?: number
  dependencies?: HeadlessProviderBindingDependencies
}

export type HeadlessProviderBindingResolution = {
  providerBinding: HeadlessAgentRuntimeProviderReference | null
  resolvedProvider: LocalJobApiResolvedProvider
  cleanup: () => void
}

export type HeadlessDefaultProviderBindingInspection =
  | { state: "not-configured" }
  | {
      state: "ready"
      profileId: string
      model: string
    }
  | {
      state: "unavailable"
      code: HeadlessProviderBindingErrorCode
      profileId: string | null
    }

export class HeadlessProviderBindingError extends Error {
  readonly code: HeadlessProviderBindingErrorCode
  readonly source: LocalJobApiResolvedProviderSource
  readonly profileId: string | null

  constructor(input: {
    code: HeadlessProviderBindingErrorCode
    message: string
    source: LocalJobApiResolvedProviderSource
    profileId?: string | null
  }) {
    super(input.message)
    this.name = "HeadlessProviderBindingError"
    this.code = input.code
    this.source = input.source
    this.profileId = input.profileId ?? null
  }
}

const HEADLESS_PROVIDER_RUNTIME_BINDINGS: Partial<
  Record<AgentRuntimeContractId, HeadlessProviderRuntimeBinding>
> = {
  "claude-code": {
    target: "claude",
    defaultPurpose: "claude-main",
    gatewayKind: "anthropic",
  },
  codex: {
    target: "codex",
    defaultPurpose: "codex-main",
    gatewayKind: "responses",
  },
}

function normalizeOptionalText(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed || null
}

function requireRuntimeBinding(
  runtime: AgentRuntimeContractId,
): HeadlessProviderRuntimeBinding | null {
  return HEADLESS_PROVIDER_RUNTIME_BINDINGS[runtime] ?? null
}

function assertProfileTargetsRuntime(input: {
  profileId: string
  targetRuntimes: ProviderProfileTarget[]
  runtimeBinding: HeadlessProviderRuntimeBinding
  source: LocalJobApiResolvedProviderSource
}): void {
  if (input.targetRuntimes.includes(input.runtimeBinding.target)) return
  throw new HeadlessProviderBindingError({
    code: "provider_profile_runtime_mismatch",
    message: `Provider profile ${input.profileId} is not enabled for ${input.runtimeBinding.target} headless jobs.`,
    source: input.source,
    profileId: input.profileId,
  })
}

function defaultDependencies(
  dependencies: HeadlessProviderBindingDependencies | undefined,
): Required<HeadlessProviderBindingDependencies> {
  return {
    getProviderProfileMetadata:
      dependencies?.getProviderProfileMetadata ??
      getProviderProfileRuntimeMetadataFromDatabase,
    getProviderProfileRuntimeConfig:
      dependencies?.getProviderProfileRuntimeConfig ??
      getProviderProfileRuntimeConfigFromDatabase,
    getProviderDefaultRuntimeConfig:
      dependencies?.getProviderDefaultRuntimeConfig ??
      getProviderDefaultRuntimeConfigFromDatabase,
    createGatewayEndpoint:
      dependencies?.createGatewayEndpoint ?? getProviderGatewayEndpoint,
    revokeGatewayToken:
      dependencies?.revokeGatewayToken ?? revokeProviderGatewayToken,
  }
}

function toDefaultProviderBindingError(
  error: unknown,
  purpose: ProviderProfileDefaultPurpose,
): HeadlessProviderBindingError {
  if (error instanceof HeadlessProviderBindingError) return error
  if (error instanceof ProviderProfileStorageReadError) {
    return new HeadlessProviderBindingError({
      code:
        error.reason === "default-profile-not-found"
          ? "provider_profile_not_found"
          : "provider_profile_unavailable",
      message: error.message,
      source: "default-profile",
      profileId: error.profileId,
    })
  }
  return new HeadlessProviderBindingError({
    code: "provider_profile_unavailable",
    message:
      error instanceof Error
        ? error.message
        : `Default provider profile for ${purpose} is unavailable.`,
    source: "default-profile",
  })
}

function readDefaultProviderProfile(input: {
  db: AgentJobDatabase
  purpose: ProviderProfileDefaultPurpose
  dependencies: Required<HeadlessProviderBindingDependencies>
}): ProviderDefaultRuntimeConfig | null {
  try {
    return input.dependencies.getProviderDefaultRuntimeConfig(
      input.db,
      input.purpose,
    )
  } catch (error) {
    throw toDefaultProviderBindingError(error, input.purpose)
  }
}

export function assertHeadlessProviderSelectionUsableAtCreate(input: {
  db: AgentJobDatabase
  runtime: AgentRuntimeContractId
  providerProfileId?: string | null
  dependencies?: HeadlessProviderBindingDependencies
}): void {
  const profileId = normalizeOptionalText(input.providerProfileId)
  if (!profileId) return
  const runtimeBinding = requireRuntimeBinding(input.runtime)
  if (!runtimeBinding) return
  const dependencies = defaultDependencies(input.dependencies)
  let metadata: ProviderProfileRuntimeMetadata | null
  try {
    metadata = dependencies.getProviderProfileMetadata(input.db, profileId)
  } catch (error) {
    throw new HeadlessProviderBindingError({
      code: "provider_profile_unavailable",
      message:
        error instanceof Error
          ? error.message
          : `Provider profile ${profileId} is unavailable.`,
      source: "request-profile",
      profileId,
    })
  }
  if (!metadata) {
    throw new HeadlessProviderBindingError({
      code: "provider_profile_not_found",
      message: `Provider profile ${profileId} was not found.`,
      source: "request-profile",
      profileId,
    })
  }
  assertProfileTargetsRuntime({
    profileId,
    targetRuntimes: metadata.targetRuntimes,
    runtimeBinding,
    source: "request-profile",
  })
}

export function resolveExplicitHeadlessProviderProfile(input: {
  db: AgentJobDatabase
  runtime?: AgentRuntimeContractId | null
  providerProfileId?: string | null
  modelOverride?: string | null
  dependencies?: HeadlessProviderBindingDependencies
}): {
  profile: ProviderProfileRuntimeConfig
  resolvedProvider: LocalJobApiResolvedProvider
} {
  const profileId = normalizeOptionalText(input.providerProfileId)
  if (!profileId) {
    throw new HeadlessProviderBindingError({
      code: "provider_profile_required",
      message: "provider.profileId is required.",
      source: "request-profile",
      profileId: null,
    })
  }

  const dependencies = defaultDependencies(input.dependencies)
  let profile: ProviderProfileRuntimeConfig | null
  try {
    profile = dependencies.getProviderProfileRuntimeConfig(input.db, profileId)
  } catch (error) {
    throw new HeadlessProviderBindingError({
      code: "provider_profile_unavailable",
      message:
        error instanceof Error
          ? error.message
          : `Provider profile ${profileId} is unavailable.`,
      source: "request-profile",
      profileId,
    })
  }
  if (!profile) {
    throw new HeadlessProviderBindingError({
      code: "provider_profile_not_found",
      message: `Provider profile ${profileId} was not found.`,
      source: "request-profile",
      profileId,
    })
  }

  if (input.runtime) {
    const runtimeBinding = requireRuntimeBinding(input.runtime)
    if (runtimeBinding) {
      assertProfileTargetsRuntime({
        profileId,
        targetRuntimes: profile.targetRuntimes,
        runtimeBinding,
        source: "request-profile",
      })
    }
  }

  const model =
    normalizeOptionalText(input.modelOverride) ?? profile.defaultModel
  return {
    profile,
    resolvedProvider: {
      source: "request-profile",
      profileId: profile.id,
      model,
    },
  }
}

async function profileProviderBinding(input: {
  profile: ProviderProfileRuntimeConfig
  model: string | null
  source: LocalJobApiResolvedProviderSource
  runtimeBinding: HeadlessProviderRuntimeBinding
  gatewayTtlMs?: number
  dependencies: Required<HeadlessProviderBindingDependencies>
}): Promise<HeadlessProviderBindingResolution> {
  assertProfileTargetsRuntime({
    profileId: input.profile.id,
    targetRuntimes: input.profile.targetRuntimes,
    runtimeBinding: input.runtimeBinding,
    source: input.source,
  })

  let endpoint: ProviderGatewayEndpoint
  try {
    endpoint = await input.dependencies.createGatewayEndpoint(
      input.profile.id,
      input.runtimeBinding.gatewayKind,
      { ttlMs: input.gatewayTtlMs },
    )
  } catch (error) {
    throw new HeadlessProviderBindingError({
      code: "provider_profile_unavailable",
      message:
        error instanceof Error
          ? error.message
          : `Provider profile ${input.profile.id} is unavailable.`,
      source: input.source,
      profileId: input.profile.id,
    })
  }

  const model = input.model ?? input.profile.defaultModel
  const diagnostics: AgentRuntimeProviderDiagnostic[] = [
    {
      id: "headless-provider-binding",
      status: "ready",
      message:
        "Resolved provider profile through a scoped local gateway token.",
    },
  ]

  return {
    providerBinding: {
      model,
      modelSource: providerProfileSource(input.profile.id),
      providerProfileId: input.profile.id,
      providerProfileName: input.profile.name,
      gatewayEndpoint: endpoint.baseUrl,
      gatewayToken: endpoint.token,
      authMode: "provider-profile",
      diagnostics,
    },
    resolvedProvider: {
      source: input.source,
      profileId: input.profile.id,
      model,
    },
    cleanup() {
      input.dependencies.revokeGatewayToken(endpoint.token)
    },
  }
}

function nativeProviderBinding(
  model: string | null,
): HeadlessProviderBindingResolution {
  return {
    providerBinding: model
      ? {
          model,
          modelSource: "request",
          providerProfileId: null,
          gatewayEndpoint: null,
          authMode: "runtime-managed",
          diagnostics: [
            {
              id: "headless-provider-binding-native-model",
              status: "ready",
              message:
                "Resolved explicit model for runtime-managed credentials.",
            },
          ],
        }
      : null,
    resolvedProvider: {
      source: "native",
      profileId: null,
      model,
    },
    cleanup() {},
  }
}

export function inspectHeadlessDefaultProviderBinding(input: {
  db: AgentJobDatabase
  runtime: AgentRuntimeContractId
  dependencies?: HeadlessProviderBindingDependencies
}): HeadlessDefaultProviderBindingInspection {
  const runtimeBinding = requireRuntimeBinding(input.runtime)
  if (!runtimeBinding) return { state: "not-configured" }
  const dependencies = defaultDependencies(input.dependencies)

  try {
    const profile = readDefaultProviderProfile({
      db: input.db,
      purpose: runtimeBinding.defaultPurpose,
      dependencies,
    })
    if (!profile) return { state: "not-configured" }
    assertProfileTargetsRuntime({
      profileId: profile.id,
      targetRuntimes: profile.targetRuntimes,
      runtimeBinding,
      source: "default-profile",
    })
    return {
      state: "ready",
      profileId: profile.id,
      model:
        normalizeOptionalText(profile.modelOverride) ?? profile.defaultModel,
    }
  } catch (error) {
    const providerError =
      error instanceof HeadlessProviderBindingError
        ? error
        : toDefaultProviderBindingError(error, runtimeBinding.defaultPurpose)
    return {
      state: "unavailable",
      code: providerError.code,
      profileId: providerError.profileId,
    }
  }
}

export async function resolveHeadlessProviderBinding(
  input: ResolveHeadlessProviderBindingInput,
): Promise<HeadlessProviderBindingResolution> {
  const runtimeBinding = requireRuntimeBinding(input.runtime)
  const modelOverride = normalizeOptionalText(input.modelOverride)
  const explicitProfileId = normalizeOptionalText(input.providerProfileId)
  if (!runtimeBinding) return nativeProviderBinding(modelOverride)

  const dependencies = defaultDependencies(input.dependencies)
  if (explicitProfileId) {
    let profile: ProviderProfileRuntimeConfig | null
    try {
      profile = dependencies.getProviderProfileRuntimeConfig(
        input.db,
        explicitProfileId,
      )
    } catch (error) {
      throw new HeadlessProviderBindingError({
        code: "provider_profile_unavailable",
        message:
          error instanceof Error
            ? error.message
            : `Provider profile ${explicitProfileId} is unavailable.`,
        source: "request-profile",
        profileId: explicitProfileId,
      })
    }
    if (!profile) {
      throw new HeadlessProviderBindingError({
        code: "provider_profile_not_found",
        message: `Provider profile ${explicitProfileId} was not found.`,
        source: "request-profile",
        profileId: explicitProfileId,
      })
    }
    return profileProviderBinding({
      profile,
      model: modelOverride,
      source: "request-profile",
      runtimeBinding,
      gatewayTtlMs: input.gatewayTtlMs,
      dependencies,
    })
  }

  if (modelOverride) {
    return nativeProviderBinding(modelOverride)
  }

  const defaultProfile = readDefaultProviderProfile({
    db: input.db,
    purpose: runtimeBinding.defaultPurpose,
    dependencies,
  })
  if (!defaultProfile) return nativeProviderBinding(null)

  return profileProviderBinding({
    profile: defaultProfile,
    model: defaultProfile.modelOverride,
    source: "default-profile",
    runtimeBinding,
    gatewayTtlMs: input.gatewayTtlMs,
    dependencies,
  })
}
