import { describe, expect, test } from "bun:test"
import { claudeChatInputSchema } from "../src/main/lib/claude/chat-input-schema"
import { codexChatInputSchema } from "../src/main/lib/codex/chat-input-schema"

const claudeInput = {
  subChatId: "sub-chat",
  chatId: "chat",
  prompt: "hello",
  modelSource: "claude-oauth",
}

const codexInput = {
  subChatId: "sub-chat",
  chatId: "chat",
  runId: "run",
  prompt: "hello",
}

describe("first-party desktop model validation", () => {
  test("accepts safe custom ids and Codex reasoning suffixes", () => {
    expect(
      claudeChatInputSchema.safeParse({
        ...claudeInput,
        model: "vendor/claude-next:v2",
      }).success,
    ).toBe(true)
    expect(
      codexChatInputSchema.safeParse({
        ...codexInput,
        model: "vendor/codex-next:v2/xhigh",
      }).success,
    ).toBe(true)
  })

  test("preserves the existing empty Codex model fallback", () => {
    for (const model of [undefined, "", "   ", "codex"]) {
      expect(
        codexChatInputSchema.safeParse({ ...codexInput, model }).success,
      ).toBe(true)
    }
  })

  test("rejects renderer-bypassed unsafe first-party ids", () => {
    for (const model of [
      "bad model",
      "bad;model",
      "bad\u0000model",
      "x".repeat(201),
    ]) {
      expect(
        claudeChatInputSchema.safeParse({ ...claudeInput, model }).success,
      ).toBe(false)
      expect(
        codexChatInputSchema.safeParse({ ...codexInput, model }).success,
      ).toBe(false)
    }
  })

  test("does not change provider-profile or Ollama free-text boundaries", () => {
    expect(
      claudeChatInputSchema.safeParse({
        ...claudeInput,
        modelSource: "provider-profile:claude-main",
        model: "provider model with spaces",
      }).success,
    ).toBe(true)
    expect(
      claudeChatInputSchema.safeParse({
        ...claudeInput,
        offlineModeEnabled: true,
        model: "ollama model with spaces",
      }).success,
    ).toBe(true)
    expect(
      codexChatInputSchema.safeParse({
        ...codexInput,
        providerProfileId: "codex-main",
        model: "provider model with spaces",
      }).success,
    ).toBe(true)
  })
})
