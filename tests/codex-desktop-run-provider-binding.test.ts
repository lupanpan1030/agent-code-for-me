import { describe, expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import {
  type CodexDesktopRunProviderBindingDependencies,
  createCodexDesktopRunProviderBindingStage,
  type ResolveCodexDesktopRunProviderBindingInput,
} from "../src/main/lib/codex/desktop-run-provider-binding"
import type { ProviderProfileRuntimeConfig } from "../src/main/lib/provider-profiles/storage"

function providerProfile(
  overrides: Partial<ProviderProfileRuntimeConfig> = {},
): ProviderProfileRuntimeConfig {
  return {
    id: "profile-1",
    name: "Profile 1",
    presetId: null,
    protocol: "openai-responses",
    baseUrl: "https://provider.example.com/v1",
    defaultModel: "provider-model",
    authMode: "bearer",
    token: "upstream-token",
    headers: {},
    targetRuntimes: ["codex"],
    capabilities: {},
    ...overrides,
  }
}

function dependencies(
  overrides: Partial<CodexDesktopRunProviderBindingDependencies> = {},
): Partial<CodexDesktopRunProviderBindingDependencies> {
  return {
    getProviderProfileRuntimeConfig: () => null,
    getProviderGatewayEndpoint: async (providerId) => ({
      baseUrl: `http://127.0.0.1:45100/profile/${providerId}/responses/v1`,
      token: `gateway-token-${providerId}`,
      providerId,
    }),
    revokeProviderGatewayToken: () => true,
    readCodexApiKey: () => null,
    validateCodexApiKey: async () => ({ ok: true }),
    getCachedCodexApiKeyModelIds: () => [],
    updateStoredCodexApiKeyModelIds: () => {},
    getCodexIntegrationStatus: async () => ({
      state: "connected_chatgpt",
      isConnected: true,
      rawOutput: "Logged in using ChatGPT",
      exitCode: 0,
    }),
    warn: () => {},
    ...overrides,
  }
}

function runInput(
  overrides: Partial<ResolveCodexDesktopRunProviderBindingInput> = {},
): ResolveCodexDesktopRunProviderBindingInput {
  return {
    requestedModel: "gpt-5.5/high",
    providerProfileBoundModelId: "gpt-5.5",
    signal: new AbortController().signal,
    emit: () => {},
    complete: () => {},
    emitPreflightBlocker: () => {},
    emitLocalOnlyPreflightBlocker: () => false,
    ...overrides,
  }
}

describe("Codex desktop run provider binding", () => {
  test("gives a provider profile priority and exposes its upstream hint before gateway await", async () => {
    const upstreamToken = randomBytes(32).toString("hex")
    const gatewayToken = randomBytes(32).toString("hex")
    let releaseGateway: (() => void) | undefined
    let appManagedKeyRead = false
    let gatewayModelResolution: string | undefined
    let gatewayBoundModelId: string | undefined
    const gatewayReady = new Promise<void>((resolve) => {
      releaseGateway = resolve
    })
    const stage = createCodexDesktopRunProviderBindingStage({
      dependencies: dependencies({
        getProviderProfileRuntimeConfig: (id) =>
          providerProfile({ id, token: upstreamToken }),
        getProviderGatewayEndpoint: async (providerId, _kind, options) => {
          gatewayModelResolution = options?.modelResolution
          gatewayBoundModelId = options?.codexChatBoundModelId
          await gatewayReady
          return {
            baseUrl: `http://127.0.0.1:45100/profile/${providerId}/responses/v1`,
            token: gatewayToken,
            providerId,
          }
        },
        readCodexApiKey: () => {
          appManagedKeyRead = true
          return "sk-must-not-be-read"
        },
      }),
    })

    const resultPromise = stage.resolve(
      runInput({
        providerProfileId: "profile-1",
        codexAuthMethod: "api_key",
      }),
    )

    expect(stage.getSecretHints()).toEqual([upstreamToken])
    releaseGateway?.()
    const result = await resultPromise

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected provider binding")
    expect(gatewayModelResolution).toBe("codex-chat-binding")
    expect(gatewayBoundModelId).toBe("gpt-5.5")
    expect(appManagedKeyRead).toBe(false)
    expect(result.providerProfile).toEqual({
      id: "profile-1",
      name: "Profile 1",
      baseUrl: "http://127.0.0.1:45100/profile/profile-1/responses/v1",
      token: gatewayToken,
      defaultModel: "provider-model",
    })
    expect(result.providerBinding).toEqual({
      model: "gpt-5.5/high",
      modelSource: "request",
      providerProfileId: "profile-1",
      gatewayEndpoint: "http://127.0.0.1:45100/profile/profile-1/responses/v1",
      authMode: "provider-profile",
    })
    expect(result.getSecretHints()).toEqual([upstreamToken, gatewayToken])
  })

  test("keeps the requested chat model authoritative over an edited profile default", async () => {
    let gatewayBoundModelId: string | undefined
    const stage = createCodexDesktopRunProviderBindingStage({
      dependencies: dependencies({
        getProviderProfileRuntimeConfig: (id) =>
          providerProfile({ id, defaultModel: "new-profile-default/high" }),
        getProviderGatewayEndpoint: async (providerId, _kind, options) => {
          gatewayBoundModelId = options?.codexChatBoundModelId
          return {
            baseUrl: `http://127.0.0.1:45100/profile/${providerId}/responses/v1`,
            token: `gateway-token-${providerId}`,
            providerId,
          }
        },
      }),
    })

    const result = await stage.resolve(
      runInput({
        providerProfileId: "profile-1",
        requestedModel: "bound-profile-model/none",
        providerProfileBoundModelId: "bound-profile-model",
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected provider binding")
    expect(result.appServerSelectedModelId).toBe("bound-profile-model/none")
    expect(result.metadataModel).toBe("bound-profile-model/none")
    expect(result.providerBinding.model).toBe("bound-profile-model/none")
    expect(result.providerProfile.defaultModel).toBe("new-profile-default/high")
    expect(gatewayBoundModelId).toBe("bound-profile-model")
  })

  test("shares one idempotent gateway revoke across unsubscribe and finally", async () => {
    const gatewayToken = randomBytes(32).toString("hex")
    const revoked: string[] = []
    const stage = createCodexDesktopRunProviderBindingStage({
      dependencies: dependencies({
        getProviderProfileRuntimeConfig: (id) => providerProfile({ id }),
        getProviderGatewayEndpoint: async (providerId) => ({
          baseUrl: "http://127.0.0.1:45100/v1",
          token: gatewayToken,
          providerId,
        }),
        revokeProviderGatewayToken: (token) => {
          revoked.push(token)
          return true
        },
      }),
    })
    const result = await stage.resolve(
      runInput({ providerProfileId: "profile-1" }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected provider binding")
    stage.revoke()
    result.revoke()
    expect(revoked).toEqual([gatewayToken])
  })

  test("marks the gateway token revoked only after revocation succeeds", async () => {
    let revokeCalls = 0
    const stage = createCodexDesktopRunProviderBindingStage({
      dependencies: dependencies({
        getProviderProfileRuntimeConfig: (id) => providerProfile({ id }),
        revokeProviderGatewayToken: () => {
          revokeCalls += 1
          if (revokeCalls === 1) throw new Error("temporary revoke failure")
          return true
        },
      }),
    })
    const result = await stage.resolve(
      runInput({ providerProfileId: "profile-1" }),
    )
    expect(result.ok).toBe(true)

    expect(() => stage.revoke()).toThrow("temporary revoke failure")
    stage.revoke()
    stage.revoke()
    expect(revokeCalls).toBe(2)
  })

  test("validates an app-managed key without adding it to router secret hints", async () => {
    const apiKey = randomBytes(32).toString("hex")
    const warned: unknown[][] = []
    let validatedSignal: AbortSignal | undefined
    const stage = createCodexDesktopRunProviderBindingStage({
      dependencies: dependencies({
        readCodexApiKey: () => apiKey,
        validateCodexApiKey: async (_key, options) => {
          validatedSignal = options?.signal
          return { ok: true }
        },
        getCachedCodexApiKeyModelIds: () => ["gpt-5.5"],
        updateStoredCodexApiKeyModelIds: () => {
          throw new Error("snapshot unavailable")
        },
        warn: (...args) => warned.push(args),
      }),
    })
    const input = runInput({ codexAuthMethod: "api_key" })
    const result = await stage.resolve(input)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected provider binding")
    expect(validatedSignal).toBe(input.signal)
    expect(result.appManagedApiKey).toBe(apiKey)
    expect(result.getSecretHints()).toEqual([])
    expect(result.providerBinding).toEqual({
      model: "gpt-5.5",
      modelSource: "request",
      providerProfileId: null,
      gatewayEndpoint: null,
      authMode: "app-managed",
    })
    expect(warned).toEqual([
      [
        "[codex] Failed to persist the validated API-key model list; continuing with the in-memory snapshot.",
        "snapshot unavailable",
      ],
    ])
  })

  test("keeps the aborted API-key validation finish-only branch", async () => {
    const emitted: Record<string, unknown>[] = []
    let completeCalls = 0
    const blockers: unknown[] = []
    const controller = new AbortController()
    controller.abort()
    const stage = createCodexDesktopRunProviderBindingStage({
      dependencies: dependencies({
        readCodexApiKey: () => "sk-cancelled",
        validateCodexApiKey: async () => ({
          ok: false,
          category: "cancelled",
          status: "failed",
          message: "Codex API key validation was cancelled.",
          hint: "Try again.",
        }),
      }),
    })
    const result = await stage.resolve(
      runInput({
        codexAuthMethod: "api_key",
        signal: controller.signal,
        emit: (chunk) => emitted.push(chunk),
        complete: () => {
          completeCalls += 1
        },
        emitPreflightBlocker: (blocker, chunks) => {
          blockers.push({ blocker, chunks })
        },
      }),
    )

    expect(result).toEqual({ ok: false })
    expect(emitted).toEqual([{ type: "finish", finishReason: "stop" }])
    expect(completeCalls).toBe(1)
    expect(blockers).toEqual([])
  })

  test("preserves blocker chunks and text for unavailable credentials", async () => {
    const cases = [
      {
        input: runInput({
          providerProfileId: "missing-profile",
          codexAuthMethod: "api_key",
        }),
        expected: {
          status: "blocked",
          message: "Provider profile is not available for Codex.",
          hint: "Choose a provider profile that targets Codex.",
        },
      },
      {
        input: runInput({ codexAuthMethod: "api_key" }),
        expected: {
          status: "needs-auth",
          message: "Saved Codex API key is required.",
          hint: "Save a Codex API key again from onboarding or Settings > Models.",
        },
      },
      {
        input: runInput({ codexAuthMethod: "chatgpt" }),
        expected: {
          status: "needs-auth",
          message: "Codex login or API key is required.",
          hint: "Connect Codex with ChatGPT login or choose a Codex API key/provider profile.",
        },
      },
    ]

    for (const testCase of cases) {
      const emitted: Array<{
        blocker: Record<string, unknown>
        chunks?: Record<string, unknown>[]
      }> = []
      const stage = createCodexDesktopRunProviderBindingStage({
        dependencies: dependencies({
          getCodexIntegrationStatus: async () =>
            ({
              state: "not_logged_in",
              isConnected: false,
              rawOutput: "Not logged in",
              exitCode: 1,
            }) as const,
        }),
      })
      const result = await stage.resolve({
        ...testCase.input,
        emitPreflightBlocker: (blocker, chunks) => {
          emitted.push({ blocker, chunks })
        },
      })

      expect(result).toEqual({ ok: false })
      expect(emitted).toHaveLength(1)
      expect(emitted[0]?.blocker).toMatchObject({
        id: "provider-profile",
        ...testCase.expected,
      })
      expect(emitted[0]?.chunks?.map((chunk) => chunk.type)).toEqual([
        "runtime-status",
        "capability-error",
      ])
    }
  })

  test("rejects CLI API-key auth for a ChatGPT-bound chat", async () => {
    const emitted: Record<string, unknown>[] = []
    const stage = createCodexDesktopRunProviderBindingStage({
      dependencies: dependencies({
        getCodexIntegrationStatus: async () => ({
          state: "connected_api_key",
          isConnected: true,
          rawOutput: "Logged in using an API key",
          exitCode: 0,
        }),
      }),
    })

    const result = await stage.resolve(
      runInput({
        codexAuthMethod: "chatgpt",
        emitPreflightBlocker: (blocker) => emitted.push(blocker),
      }),
    )

    expect(result).toEqual({ ok: false })
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      id: "provider-profile",
      status: "needs-auth",
    })
  })
})
