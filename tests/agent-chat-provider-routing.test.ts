import { describe, expect, test } from "bun:test"
import { CONTRACT_RUNTIME_IDS } from "../src/shared/agent-runtime-capabilities"
import {
  agentChatProviders,
  buildAgentChatMessageMetadata,
  inferChatEngineIdFromMessages,
  normalizeAgentChatMetadataModel,
  normalizeChatEngineId,
} from "../src/shared/chat-engine-id"
import { chatMessageMetadataSchema } from "../src/shared/chat-message"
import { CHAT_SESSION_BINDING_RUNTIMES } from "../src/shared/chat-session-binding"
import { providerProfileSource } from "../src/shared/provider-profile-types"

describe("chat engine routing metadata", () => {
  test("derives supported Engine IDs directly from the runtime contract", () => {
    expect(agentChatProviders).toBe(CONTRACT_RUNTIME_IDS)
    expect(CHAT_SESSION_BINDING_RUNTIMES).toBe(CONTRACT_RUNTIME_IDS)
    expect(normalizeChatEngineId("claude-code")).toBe("claude-code")
    expect(normalizeChatEngineId("codex")).toBe("codex")
    expect(normalizeChatEngineId("skunkworks")).toBeNull()
    for (const provider of CONTRACT_RUNTIME_IDS) {
      expect(chatMessageMetadataSchema.safeParse({ provider }).success).toBe(
        true,
      )
    }
    expect(
      chatMessageMetadataSchema.safeParse({ provider: "skunkworks" }).success,
    ).toBe(false)
  })

  test("persists explicit Codex provider metadata for provider-profile models", () => {
    const metadata = buildAgentChatMessageMetadata({
      model: "deepseek-v4-flash",
      provider: "codex",
      modelSource: providerProfileSource("profile-deepseek"),
      providerProfileId: "profile-deepseek",
    })

    expect(metadata).toEqual({
      model: "deepseek-v4-flash",
      provider: "codex",
      modelSource: "provider-profile:profile-deepseek",
      providerProfileId: "profile-deepseek",
    })
    expect(inferChatEngineIdFromMessages([{ metadata }])).toBe("codex")
  })

  test("keeps legacy model-name inference as a fallback only", () => {
    expect(
      inferChatEngineIdFromMessages([{ metadata: { model: "gpt-5.5" } }]),
    ).toBe("codex")
    expect(
      inferChatEngineIdFromMessages([
        { metadata: { model: "deepseek-v4-flash" } },
      ]),
    ).toBe("claude-code")
  })

  test("falls back for legacy and unknown providers without escaping the provider union", () => {
    const retiredCliRuntimeId = "qwen-code"
    const retiredManagedRuntimeId = "kun"
    const legacyOrUnknownMessages = [
      {
        metadata: {
          provider: retiredCliRuntimeId,
          model: retiredCliRuntimeId,
        },
      },
      {
        metadata: {
          provider: retiredManagedRuntimeId,
          model: retiredManagedRuntimeId,
        },
      },
      { metadata: { provider: "skunkworks", model: "skunkworks-agent" } },
    ]

    for (const message of legacyOrUnknownMessages) {
      const provider = inferChatEngineIdFromMessages([message])
      expect(provider).toBe("claude-code")
      expect(agentChatProviders).toContain(provider)
    }
  })

  test("explicit provider metadata wins over model-name inference", () => {
    expect(
      inferChatEngineIdFromMessages([
        { metadata: { model: "gpt-5.5", provider: "claude-code" } },
      ]),
    ).toBe("claude-code")
  })

  test("normalizes persisted metadata model names for transport requests", () => {
    expect(normalizeAgentChatMetadataModel(" deepseek-v4-flash ")).toBe(
      "deepseek-v4-flash",
    )
    expect(normalizeAgentChatMetadataModel("")).toBeNull()
    expect(normalizeAgentChatMetadataModel(null)).toBeNull()
  })
})
