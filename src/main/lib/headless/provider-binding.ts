import { eq } from "drizzle-orm"
import type { AgentRuntimeContractId } from "../../../shared/agent-runtime-capabilities"
import type {
  LocalJobApiResolvedProvider,
  LocalJobApiResolvedProviderSource,
} from "../../../shared/local-job-api"
import {
  type ProviderProfileAuthMode,
  type ProviderProfileCapabilities,
  type ProviderProfileDefaultPurpose,
  type ProviderProfileProtocol,
  type ProviderProfileTarget,
  providerProfileSource,
} from "../../../shared/provider-profile-types"
import type { AgentRuntimeProviderDiagnostic } from "../agent-runtime/run-contract"
import { agentProviderDefaults, agentProviderProfiles } from "../db/schema"
import {
  getProviderGatewayEndpoint,
  revokeProviderGatewayToken,
} from "../provider-profiles/gateway"
import type { ProviderProfileRuntimeConfig } from "../provider-profiles/storage"
import { decryptProviderToken, normalizeProviderToken } from "../provider-token"
import type { HeadlessAgentRuntimeProviderReference } from "./agent-runtime-contract"
import type { AgentJobDatabase } from "./job-store"

export const HEADLESS_PROVIDER_BINDING_ERROR_CODES = [
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

type ProviderDefaultRuntimeConfig = ProviderProfileRuntimeConfig & {
  modelOverride: string | null
}

export type HeadlessProviderBindingDependencies = {
  getProviderProfileMetadata?: (
    db: AgentJobDatabase,
    profileId: string,
  ) => HeadlessProviderProfileMetadata | null
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

type HeadlessProviderProfileMetadata = {
  id: string
  targetRuntimes: ProviderProfileTarget[]
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

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function parseTargets(
  value: string | null | undefined,
): ProviderProfileTarget[] {
  const parsed = parseJson<unknown>(value, [])
  if (!Array.isArray(parsed)) return []
  return parsed.filter(
    (target): target is ProviderProfileTarget =>
      target === "claude" ||
      target === "codex" ||
      target === "helpers" ||
      target === "kun" ||
      target === "local",
  )
}

function parseAuthMode(value: string): ProviderProfileAuthMode {
  return value === "bearer" || value === "x-api-key" || value === "none"
    ? value
    : "bearer"
}

function parseProtocol(value: string): ProviderProfileProtocol {
  return value === "anthropic" ||
    value === "openai-chat" ||
    value === "openai-responses"
    ? value
    : "openai-responses"
}

function getProviderProfileMetadataFromDb(
  db: AgentJobDatabase,
  profileId: string,
): HeadlessProviderProfileMetadata | null {
  const row =
    db
      .select()
      .from(agentProviderProfiles)
      .where(eq(agentProviderProfiles.id, profileId))
      .get() ?? null
  if (!row) return null
  return {
    id: row.id,
    targetRuntimes: parseTargets(row.targetRuntimesJson),
  }
}

function getProviderProfileRuntimeConfigFromDb(
  db: AgentJobDatabase,
  profileId: string,
): ProviderProfileRuntimeConfig | null {
  const row =
    db
      .select()
      .from(agentProviderProfiles)
      .where(eq(agentProviderProfiles.id, profileId))
      .get() ?? null
  if (!row) return null

  const authMode = parseAuthMode(row.authMode)
  const decryptedToken = row.encryptedToken
    ? decryptProviderToken(row.encryptedToken)
    : null
  const token = decryptedToken ? normalizeProviderToken(decryptedToken) : null
  if (authMode !== "none" && !token) {
    throw new Error("Provider profile token is missing")
  }

  return {
    id: row.id,
    name: row.name,
    presetId: row.presetId,
    protocol: parseProtocol(row.protocol),
    baseUrl: row.baseUrl,
    defaultModel: row.defaultModel,
    authMode,
    token,
    headers: parseJson(row.headersJson, {}),
    targetRuntimes: parseTargets(row.targetRuntimesJson),
    capabilities: parseJson<ProviderProfileCapabilities>(
      row.capabilitiesJson,
      {},
    ),
  }
}

function getProviderDefaultRuntimeConfigFromDb(
  db: AgentJobDatabase,
  purpose: ProviderProfileDefaultPurpose,
): ProviderDefaultRuntimeConfig | null {
  const row =
    db
      .select()
      .from(agentProviderDefaults)
      .where(eq(agentProviderDefaults.purpose, purpose))
      .get() ?? null
  if (!row?.profileId) return null
  let profile: ProviderProfileRuntimeConfig | null
  try {
    profile = getProviderProfileRuntimeConfigFromDb(db, row.profileId)
  } catch (error) {
    if (error instanceof HeadlessProviderBindingError) throw error
    throw new HeadlessProviderBindingError({
      code: "provider_profile_unavailable",
      message:
        error instanceof Error
          ? error.message
          : `Default provider profile ${row.profileId} is unavailable.`,
      source: "default-profile",
      profileId: row.profileId,
    })
  }
  if (!profile) {
    throw new HeadlessProviderBindingError({
      code: "provider_profile_not_found",
      message: `Default provider profile ${row.profileId} was not found.`,
      source: "default-profile",
      profileId: row.profileId,
    })
  }
  return {
    ...profile,
    modelOverride: row.modelOverride,
  }
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
      getProviderProfileMetadataFromDb,
    getProviderProfileRuntimeConfig:
      dependencies?.getProviderProfileRuntimeConfig ??
      getProviderProfileRuntimeConfigFromDb,
    getProviderDefaultRuntimeConfig:
      dependencies?.getProviderDefaultRuntimeConfig ??
      getProviderDefaultRuntimeConfigFromDb,
    createGatewayEndpoint:
      dependencies?.createGatewayEndpoint ?? getProviderGatewayEndpoint,
    revokeGatewayToken:
      dependencies?.revokeGatewayToken ?? revokeProviderGatewayToken,
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
  const metadata = dependencies.getProviderProfileMetadata(input.db, profileId)
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

  let defaultProfile: ProviderDefaultRuntimeConfig | null
  try {
    defaultProfile = dependencies.getProviderDefaultRuntimeConfig(
      input.db,
      runtimeBinding.defaultPurpose,
    )
  } catch (error) {
    if (error instanceof HeadlessProviderBindingError) throw error
    throw new HeadlessProviderBindingError({
      code: "provider_profile_unavailable",
      message:
        error instanceof Error
          ? error.message
          : `Default provider profile for ${runtimeBinding.defaultPurpose} is unavailable.`,
      source: "default-profile",
    })
  }
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
