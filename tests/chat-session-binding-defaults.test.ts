import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"

const testWindow = new Window({ url: "http://localhost/" })
Object.assign(globalThis, {
  window: testWindow,
  document: testWindow.document,
  localStorage: testWindow.localStorage,
  sessionStorage: testWindow.sessionStorage,
})

const {
  lastSelectedAgentIdAtom,
  lastSelectedClaudeModelSourceAtom,
  lastSelectedCodexModelIdAtom,
  lastSelectedCodexModelSourceAtom,
  lastSelectedCodexThinkingAtom,
  lastSelectedModelIdAtom,
  setLastSelectedCodexSelectionAtom,
} = await import("../src/renderer/features/agents/atoms")
const {
  getNewChatSessionBindingDefaults,
  resolveCodexNewChatDefaultsForSource,
} = await import(
  "../src/renderer/features/agents/lib/chat-session-binding-defaults"
)
const { appStore } = await import("../src/renderer/lib/jotai-store")

describe("new chat session binding defaults", () => {
  test("snapshots Codex defaults into a complete creation input", () => {
    appStore.set(lastSelectedAgentIdAtom, "codex")
    appStore.set(lastSelectedCodexModelIdAtom, "provider-codex-model")
    appStore.set(
      lastSelectedCodexModelSourceAtom,
      "provider-profile:profile-codex",
    )
    appStore.set(lastSelectedCodexThinkingAtom, "xhigh")

    expect(getNewChatSessionBindingDefaults()).toEqual({
      runtime: "codex",
      providerProfileId: "profile-codex",
      modelId: "provider-codex-model",
      modelSource: "provider-profile:profile-codex",
      thinkingLevel: null,
    })
  })

  test("snapshots a Claude Provider Profile model into later hidden creators", () => {
    appStore.set(lastSelectedAgentIdAtom, "claude-code")
    appStore.set(lastSelectedModelIdAtom, "provider-claude-model")
    appStore.set(
      lastSelectedClaudeModelSourceAtom,
      "provider-profile:profile-claude",
    )

    expect(getNewChatSessionBindingDefaults()).toEqual({
      runtime: "claude-code",
      providerProfileId: "profile-claude",
      modelId: "provider-claude-model",
      modelSource: "provider-profile:profile-claude",
      thinkingLevel: null,
    })
  })

  test("maps the Claude auto preference to a persistable runtime default", () => {
    appStore.set(lastSelectedAgentIdAtom, "claude-code")
    appStore.set(lastSelectedModelIdAtom, "fable")
    appStore.set(lastSelectedClaudeModelSourceAtom, "auto")

    expect(getNewChatSessionBindingDefaults()).toEqual({
      runtime: "claude-code",
      providerProfileId: null,
      modelId: "fable",
      modelSource: "claude-oauth",
      thinkingLevel: null,
    })
  })

  test("switches a ChatGPT-only selection to coherent API-key defaults before hidden creation", () => {
    const nextDefaults = resolveCodexNewChatDefaultsForSource({
      models: [
        {
          id: "chatgpt-only",
          name: "ChatGPT only",
          displayLabel: "ChatGPT only",
          authRestriction: "chatgpt-only",
          deprecated: false,
          kind: "catalog",
          thinkings: ["xhigh"],
        },
        {
          id: "shared-api-model",
          name: "Shared API model",
          displayLabel: "Shared API model",
          deprecated: false,
          kind: "catalog",
          thinkings: ["medium"],
        },
      ],
      selectedModelId: "chatgpt-only",
      selectedThinking: "xhigh",
      source: "openai-api-key",
    })

    appStore.set(setLastSelectedCodexSelectionAtom, {
      modelSource: "openai-api-key",
      ...nextDefaults,
    })

    expect(getNewChatSessionBindingDefaults("codex")).toMatchObject({
      modelSource: "openai-api-key",
      modelId: "shared-api-model",
      thinkingLevel: "medium",
    })
  })

  test("switches an API-only selection to coherent ChatGPT defaults before hidden creation", () => {
    const nextDefaults = resolveCodexNewChatDefaultsForSource({
      models: [
        {
          id: "api-only",
          name: "API only",
          displayLabel: "API only",
          authRestriction: "api-key-only",
          deprecated: false,
          kind: "api-key",
          thinkings: ["low"],
        },
        {
          id: "shared-chatgpt-model",
          name: "Shared ChatGPT model",
          displayLabel: "Shared ChatGPT model",
          deprecated: false,
          kind: "catalog",
          thinkings: ["high"],
        },
      ],
      selectedModelId: "api-only",
      selectedThinking: "low",
      source: "chatgpt",
    })

    appStore.set(setLastSelectedCodexSelectionAtom, {
      modelSource: "chatgpt",
      ...nextDefaults,
    })

    expect(getNewChatSessionBindingDefaults("codex")).toMatchObject({
      modelSource: "chatgpt",
      modelId: "shared-chatgpt-model",
      thinkingLevel: "high",
    })
  })
})
