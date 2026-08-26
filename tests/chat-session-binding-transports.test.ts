import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  composeProviderProfileCodexTransportModel,
  isBoundProviderProfileUnavailable,
  resolveClaudeTransportModelForEffectiveSource,
  resolveCodexAuthMethodForBindingSource,
  resolveCodexBoundCredentialState,
} from "../src/renderer/features/agents/lib/transport-model-selection"

const ipcTransportSource = readFileSync(
  "src/renderer/features/agents/lib/ipc-chat-transport.ts",
  "utf8",
)
const acpTransportSource = readFileSync(
  "src/renderer/features/agents/lib/acp-chat-transport.ts",
  "utf8",
)
const authRetryHookSource = readFileSync(
  "src/renderer/features/agents/hooks/use-auth-retry.ts",
  "utf8",
)

const transportSources = [ipcTransportSource, acpTransportSource]

describe("chat session binding transport injection", () => {
  test("requires the shared binding in both transport configs", () => {
    expect(ipcTransportSource).toMatch(
      /type IPCChatTransportConfig = \{[\s\S]*?binding: ChatSessionBinding/,
    )
    expect(acpTransportSource).toMatch(
      /type ACPChatTransportConfig = \{[\s\S]*?binding: ChatSessionBinding/,
    )

    for (const source of transportSources) {
      expect(source).toContain(
        'import type { ChatSessionBinding } from "../../../../shared/chat-session-binding"',
      )
    }
  })

  test("uses injected fields for send-time model routing", () => {
    expect(ipcTransportSource).toContain("this.config.binding.modelId")
    expect(ipcTransportSource).toContain("this.config.binding.modelSource")

    expect(acpTransportSource).toContain("this.config.binding.modelId")
    expect(acpTransportSource).toContain("this.config.binding.modelSource")
    expect(acpTransportSource).toContain("this.config.binding.thinkingLevel")
    expect(acpTransportSource).toContain(
      "this.config.binding.providerProfileId",
    )
    expect(composeProviderProfileCodexTransportModel("provider-model")).toBe(
      "provider-model/none",
    )
    expect(
      composeProviderProfileCodexTransportModel("provider-model/high"),
    ).toBe("provider-model/high/none")
    expect(composeProviderProfileCodexTransportModel("org/model/minimal")).toBe(
      "org/model/minimal/none",
    )
    expect(composeProviderProfileCodexTransportModel("vendor/none")).toBe(
      "vendor/none/none",
    )
    expect(acpTransportSource).not.toContain("normalizeAgentChatMetadataModel")
    expect(acpTransportSource).not.toContain("metadataModelSource")
  })

  test("never rewrites a Codex binding source from available credentials", () => {
    expect(resolveCodexAuthMethodForBindingSource("chatgpt")).toBe("chatgpt")
    expect(resolveCodexAuthMethodForBindingSource("openai-api-key")).toBe(
      "api_key",
    )
    expect(acpTransportSource).not.toContain("effectiveCodexModelSource")
    expect(acpTransportSource).not.toContain(
      "const codexCredentials = await getStoredCodexCredentials()",
    )
  })

  test("retries Codex auth only for the credential required by the bound source", () => {
    expect(
      resolveCodexBoundCredentialState("chatgpt", {
        hasSubscription: true,
        hasApiKey: false,
      }),
    ).toEqual({ hasBoundCredential: true, kind: "subscription" })
    expect(
      resolveCodexBoundCredentialState("chatgpt", {
        hasSubscription: false,
        hasApiKey: true,
      }),
    ).toEqual({ hasBoundCredential: false, kind: "subscription" })
    expect(
      resolveCodexBoundCredentialState("openai-api-key", {
        hasSubscription: false,
        hasApiKey: true,
      }),
    ).toEqual({ hasBoundCredential: true, kind: "api-key" })
    expect(
      resolveCodexBoundCredentialState("openai-api-key", {
        hasSubscription: true,
        hasApiKey: false,
      }),
    ).toEqual({ hasBoundCredential: false, kind: "api-key" })
    expect(acpTransportSource).not.toContain("credentials.hasAny")
    expect(acpTransportSource).toContain("boundCredential.kind")
  })

  test("retires stale auth retries by exact binding and transport generation", () => {
    for (const source of transportSources) {
      expect(source).toContain("registerAuthRetryTransportGeneration(")
      expect(source).toContain("isCurrentAuthRetryTransportGeneration(")
      expect(source).toContain("bindingIdentity:")
      expect(source).toContain(
        "this.authRetryTransportGeneration.bindingIdentity",
      )
      expect(source).toContain("releaseAuthRetryTransportGeneration(")
    }

    const codexCredentialProbeIndex = acpTransportSource.indexOf(
      "await resolveCodexCredentialsForAuthError()",
    )
    const codexGenerationCheckIndex = acpTransportSource.indexOf(
      "!isCurrentAuthRetryTransportGeneration(",
      codexCredentialProbeIndex,
    )
    const codexRetryPublishIndex = acpTransportSource.indexOf(
      "appStore.set(pendingAuthRetryMessageAtom",
      codexGenerationCheckIndex,
    )
    expect(codexCredentialProbeIndex).toBeGreaterThanOrEqual(0)
    expect(codexGenerationCheckIndex).toBeGreaterThan(codexCredentialProbeIndex)
    expect(codexRetryPublishIndex).toBeGreaterThan(codexGenerationCheckIndex)

    const claudeGenerationCheckIndex = ipcTransportSource.indexOf(
      "!isCurrentAuthRetryTransportGeneration(",
    )
    const claudeRetryPublishIndex = ipcTransportSource.indexOf(
      "appStore.set(pendingAuthRetryMessageAtom",
      claudeGenerationCheckIndex,
    )
    expect(claudeGenerationCheckIndex).toBeGreaterThanOrEqual(0)
    expect(claudeRetryPublishIndex).toBeGreaterThan(claudeGenerationCheckIndex)

    expect(authRetryHookSource).toContain(
      "pendingAuthRetryMatchesBinding(pendingAuthRetry, binding)",
    )
    expect(authRetryHookSource).toContain("pendingAuthRetry.bindingIdentity")
  })

  test("routes Codex stop and cleanup through the exact subscription owner", () => {
    expect(acpTransportSource).toContain("private activeRunOwner:")
    expect(acpTransportSource).toContain("previousRunOwner?.unsubscribe()")
    expect(acpTransportSource).toContain("this.activeRunOwner === runOwner")
    expect(acpTransportSource).not.toContain("trpcClient.codex.cancel")
    expect(acpTransportSource).not.toContain("trpcClient.codex.cleanup")
  })

  test("unsubscribes the exact Codex subscription for first-party and Profile auth errors", () => {
    expect(acpTransportSource.match(/failAuthErrorStream\(/g)).toHaveLength(2)
    expect(acpTransportSource).toContain("failCodexAuthErrorStream({")
    expect(acpTransportSource).toContain("unsubscribe: safeUnsubscribe")

    const profileFailure = acpTransportSource.slice(
      acpTransportSource.indexOf("if (providerProfileId) {"),
      acpTransportSource.indexOf("void (async () => {"),
    )
    expect(profileFailure).toContain("failAuthErrorStream(error)")

    const firstPartyFailure = acpTransportSource.slice(
      acpTransportSource.indexOf("void (async () => {"),
      acpTransportSource.indexOf('if (chunk.type === "error")'),
    )
    expect(firstPartyFailure).toContain("failAuthErrorStream(")
  })

  test("never forwards native session provenance sourced from renderer messages", () => {
    for (const source of transportSources) {
      expect(source).not.toContain("AgentMessageMetadata")
      expect(source).not.toMatch(/\bsessionId\b/)
    }
  })

  test("contains no per-chat binding atom read or write path", () => {
    for (const source of transportSources) {
      expect(source).not.toMatch(/subChat\w*AtomFamily/)
    }
  })

  test("keeps Claude OAuth diversion run-scoped", () => {
    expect(
      resolveClaudeTransportModelForEffectiveSource({
        selectedModelId: "fable",
        bindingModelSource: "claude-oauth",
        effectiveModelSource: "provider-profile:profile-a",
      }),
    ).toBeUndefined()
    expect(
      resolveClaudeTransportModelForEffectiveSource({
        selectedModelId: "bound-vendor-model",
        bindingModelSource: "provider-profile:profile-a",
        effectiveModelSource: "provider-profile:profile-a",
      }),
    ).toBe("bound-vendor-model")

    const divertStart = ipcTransportSource.indexOf(
      "// Run-admission guard: never launch the OAuth path when OAuth is not usable.",
    )
    const streamStart = ipcTransportSource.indexOf(
      "return new ReadableStream({",
      divertStart,
    )

    expect(divertStart).toBeGreaterThan(0)
    expect(streamStart).toBeGreaterThan(divertStart)
    const divertPath = ipcTransportSource.slice(divertStart, streamStart)
    expect(divertPath).toContain("modelSource = diverted.source")
    expect(divertPath).not.toContain("appStore.set(")
    expect(divertPath).not.toContain("this.config.binding =")
  })

  test("keeps an unavailable Claude Profile visible instead of substituting OAuth", () => {
    const base = {
      modelSource: "provider-profile:bound-profile",
      profilesLoaded: true,
      targetRuntime: "claude" as const,
    }

    expect(
      isBoundProviderProfileUnavailable({
        ...base,
        providerProfiles: [],
      }),
    ).toBe(true)
    expect(
      isBoundProviderProfileUnavailable({
        ...base,
        providerProfiles: [{ id: "bound-profile", targetRuntimes: ["codex"] }],
      }),
    ).toBe(true)
    expect(
      isBoundProviderProfileUnavailable({
        ...base,
        providerProfiles: [{ id: "bound-profile", targetRuntimes: ["claude"] }],
      }),
    ).toBe(false)
    expect(
      isBoundProviderProfileUnavailable({
        ...base,
        targetRuntime: "codex",
        providerProfiles: [{ id: "bound-profile", targetRuntimes: ["claude"] }],
      }),
    ).toBe(true)
    expect(
      isBoundProviderProfileUnavailable({
        ...base,
        profilesLoaded: false,
        providerProfiles: [],
      }),
    ).toBe(false)
  })
})
