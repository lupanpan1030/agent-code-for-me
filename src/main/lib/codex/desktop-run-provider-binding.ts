import {
  buildCodexCapabilityErrorChunk,
  buildCodexRuntimeStatusChunk,
  createCodexRuntimeBlocker,
} from "../../../shared/codex-runtime-status"
import type { DesktopRunProviderBinding } from "../agent-runtime/desktop-run-request"
import {
  getProviderGatewayEndpoint,
  revokeProviderGatewayToken,
} from "../provider-profiles/gateway"
import {
  getProviderProfileRuntimeConfig,
  type ProviderProfileRuntimeConfig,
} from "../provider-profiles/storage"
import {
  readCodexApiKey,
  updateStoredCodexApiKeyModelIds,
} from "./api-key-store"
import {
  getCachedCodexApiKeyModelIds,
  validateCodexApiKey,
} from "./api-key-validation"
import type { CodexDesktopRunPreflightStage } from "./desktop-run-preflight"
import { getCodexIntegrationStatus } from "./integration-status"
import {
  normalizeCodexAppServerModelId,
  resolveCodexSelectedModelId,
} from "./model-selection"
import type { CodexProviderProfileBinding } from "./provider-runtime-binding"

type ProviderGatewayEndpoint = Awaited<
  ReturnType<typeof getProviderGatewayEndpoint>
>

export type CodexDesktopRunProviderBindingDependencies = {
  getProviderProfileRuntimeConfig: (
    id: string,
  ) => ProviderProfileRuntimeConfig | null
  getProviderGatewayEndpoint: (
    providerId: string,
    kind: "responses",
  ) => Promise<ProviderGatewayEndpoint>
  revokeProviderGatewayToken: (token: string) => boolean
  readCodexApiKey: () => string | null
  validateCodexApiKey: typeof validateCodexApiKey
  getCachedCodexApiKeyModelIds: () => string[]
  updateStoredCodexApiKeyModelIds: (modelIds: string[]) => unknown
  getCodexIntegrationStatus: typeof getCodexIntegrationStatus
  warn: (...args: unknown[]) => void
}

export type CodexDesktopRunProviderProfileBinding =
  CodexProviderProfileBinding & {
    defaultModel: string
  }

export type CodexDesktopRunProviderBindingResolution = {
  ok: true
  providerProfile: CodexDesktopRunProviderProfileBinding | undefined
  appManagedApiKey: string | null
  selectedModelId: string
  appServerSelectedModelId: string
  metadataModel: string
  providerBinding: Omit<DesktopRunProviderBinding, "diagnostics">
  getSecretHints: () => readonly string[]
  revoke: () => void
}

export type CodexDesktopRunProviderBindingResult =
  | CodexDesktopRunProviderBindingResolution
  | { ok: false }

export type ResolveCodexDesktopRunProviderBindingInput = {
  providerProfileId?: string
  codexAuthMethod?: "chatgpt" | "api_key"
  requestedModel?: string
  signal: AbortSignal
  emit: (chunk: Record<string, unknown>) => unknown
  complete: () => void
  emitPreflightBlocker: CodexDesktopRunPreflightStage["emitPreflightBlocker"]
  emitLocalOnlyPreflightBlocker: CodexDesktopRunPreflightStage["emitLocalOnlyPreflightBlocker"]
}

export type CodexDesktopRunProviderBindingStage = {
  resolve: (
    input: ResolveCodexDesktopRunProviderBindingInput,
  ) => Promise<CodexDesktopRunProviderBindingResult>
  getSecretHints: () => readonly string[]
  revoke: () => void
  release: () => void
}

const defaultDependencies: CodexDesktopRunProviderBindingDependencies = {
  getProviderProfileRuntimeConfig,
  getProviderGatewayEndpoint,
  revokeProviderGatewayToken,
  readCodexApiKey,
  validateCodexApiKey,
  getCachedCodexApiKeyModelIds,
  updateStoredCodexApiKeyModelIds,
  getCodexIntegrationStatus,
  warn: (...args) => console.warn(...args),
}

export function createCodexDesktopRunProviderBindingStage(options?: {
  dependencies?: Partial<CodexDesktopRunProviderBindingDependencies>
}): CodexDesktopRunProviderBindingStage {
  const dependencies = {
    ...defaultDependencies,
    ...options?.dependencies,
  }
  let providerUpstreamToken: string | null = null
  let providerGatewayToken: string | null = null
  let providerGatewayTokenRevoked = false

  const getSecretHints = (): readonly string[] =>
    [providerUpstreamToken, providerGatewayToken].filter(
      (secret): secret is string => Boolean(secret),
    )

  const revoke = () => {
    if (!providerGatewayToken || providerGatewayTokenRevoked) {
      return
    }
    dependencies.revokeProviderGatewayToken(providerGatewayToken)
    providerGatewayTokenRevoked = true
  }

  const release = () => {
    providerUpstreamToken = null
    providerGatewayToken = null
  }

  const resolve = async (
    input: ResolveCodexDesktopRunProviderBindingInput,
  ): Promise<CodexDesktopRunProviderBindingResult> => {
    let providerProfile: CodexDesktopRunProviderProfileBinding | undefined
    let appManagedApiKey: string | null = null
    const wantsAppManagedApiKey =
      input.codexAuthMethod === "api_key" && !input.providerProfileId

    if (input.providerProfileId) {
      const profile = dependencies.getProviderProfileRuntimeConfig(
        input.providerProfileId,
      )
      if (!profile?.targetRuntimes.includes("codex")) {
        const blocker = createCodexRuntimeBlocker({
          id: "provider-profile",
          label: "Codex provider profile",
          status: "unavailable",
          ok: false,
          message: "Provider profile is not available for Codex.",
          hint: "Choose a provider profile that targets Codex.",
        })
        input.emitPreflightBlocker(
          {
            id: "provider-profile",
            status: "blocked",
            message: blocker.message,
            hint: blocker.hint,
          },
          [
            buildCodexRuntimeStatusChunk(blocker),
            buildCodexCapabilityErrorChunk(blocker),
          ],
        )
        return { ok: false }
      }
      if (
        input.emitLocalOnlyPreflightBlocker(
          "use Codex provider endpoint",
          profile.baseUrl,
        )
      ) {
        return { ok: false }
      }
      providerUpstreamToken = profile.token || null
      const gateway = await dependencies.getProviderGatewayEndpoint(
        profile.id,
        "responses",
      )
      providerGatewayToken = gateway.token
      providerGatewayTokenRevoked = false
      providerProfile = {
        id: profile.id,
        name: profile.name,
        baseUrl: gateway.baseUrl,
        token: gateway.token,
        defaultModel: profile.defaultModel,
      }
    } else if (wantsAppManagedApiKey) {
      appManagedApiKey = dependencies.readCodexApiKey()
      if (!appManagedApiKey) {
        const blocker = createCodexRuntimeBlocker({
          id: "login",
          label: "Codex API key",
          status: "needs-auth",
          ok: false,
          message: "Saved Codex API key is required.",
          hint: "Save a Codex API key again from onboarding or Settings > Models.",
        })
        input.emitPreflightBlocker(
          {
            id: "provider-profile",
            status: "needs-auth",
            message: blocker.message,
            hint: blocker.hint,
          },
          [
            buildCodexRuntimeStatusChunk(blocker),
            buildCodexCapabilityErrorChunk(blocker),
          ],
        )
        return { ok: false }
      }

      const apiKeyValidation = await dependencies.validateCodexApiKey(
        appManagedApiKey,
        { signal: input.signal },
      )
      if (!apiKeyValidation.ok) {
        if (apiKeyValidation.category === "cancelled" && input.signal.aborted) {
          input.emit({ type: "finish", finishReason: "stop" })
          input.complete()
          return { ok: false }
        }

        const blocker = createCodexRuntimeBlocker({
          id: "login",
          label: "Codex API key",
          status: apiKeyValidation.status,
          ok: false,
          message: apiKeyValidation.message,
          hint: apiKeyValidation.hint,
        })
        input.emitPreflightBlocker(
          {
            id: "provider-profile",
            status:
              apiKeyValidation.status === "needs-auth"
                ? "needs-auth"
                : "blocked",
            message: blocker.message,
            hint: blocker.hint,
          },
          [
            buildCodexRuntimeStatusChunk(blocker),
            buildCodexCapabilityErrorChunk(blocker),
          ],
        )
        return { ok: false }
      }
      try {
        dependencies.updateStoredCodexApiKeyModelIds(
          dependencies.getCachedCodexApiKeyModelIds(),
        )
      } catch (error) {
        dependencies.warn(
          "[codex] Failed to persist the validated API-key model list; continuing with the in-memory snapshot.",
          error instanceof Error ? error.message : String(error),
        )
      }
    } else {
      const integration = await dependencies.getCodexIntegrationStatus()
      if (!integration.isConnected) {
        const blocker = createCodexRuntimeBlocker({
          id: "login",
          label: "Codex login",
          status: "needs-auth",
          ok: false,
          message: "Codex login or API key is required.",
          hint: "Connect Codex with ChatGPT login or choose a Codex API key/provider profile.",
        })
        input.emitPreflightBlocker(
          {
            id: "provider-profile",
            status: "needs-auth",
            message: blocker.message,
            hint: blocker.hint,
          },
          [
            buildCodexRuntimeStatusChunk(blocker),
            buildCodexCapabilityErrorChunk(blocker),
          ],
        )
        return { ok: false }
      }
    }

    const selectedModelId = resolveCodexSelectedModelId({
      requestedModel: input.requestedModel,
      hasAppManagedApiKey: Boolean(appManagedApiKey),
    })
    const appServerSelectedModelId = !providerProfile
      ? normalizeCodexAppServerModelId(selectedModelId)
      : selectedModelId
    const metadataModel =
      providerProfile?.defaultModel ?? appServerSelectedModelId
    const authMode = providerProfile
      ? "provider-profile"
      : appManagedApiKey
        ? "app-managed"
        : "runtime-managed"

    return {
      ok: true,
      providerProfile,
      appManagedApiKey,
      selectedModelId,
      appServerSelectedModelId,
      metadataModel,
      providerBinding: {
        model: metadataModel,
        modelSource: input.requestedModel ? "request" : "default",
        providerProfileId: providerProfile?.id ?? null,
        gatewayEndpoint: providerProfile?.baseUrl ?? null,
        authMode,
      },
      getSecretHints,
      revoke,
    }
  }

  return {
    resolve,
    getSecretHints,
    revoke,
    release,
  }
}
