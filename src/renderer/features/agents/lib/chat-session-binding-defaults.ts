import {
  type ChatSessionBindingRuntime,
  type CodexChatThinkingLevel,
  type NormalizedChatSessionBindingWrite,
  normalizeChatSessionBindingWrite,
} from "../../../../shared/chat-session-binding"
import { appStore } from "../../../lib/jotai-store"
import {
  lastSelectedAgentIdAtom,
  lastSelectedClaudeModelSourceAtom,
  lastSelectedCodexModelIdAtom,
  lastSelectedCodexModelSourceAtom,
  lastSelectedCodexThinkingAtom,
  lastSelectedModelIdAtom,
} from "../atoms"
import {
  type CodexCatalogModel,
  getDefaultCodexThinking,
} from "./model-catalog-selection"
import {
  type CodexFirstPartyModelSource,
  resolveCodexModelForSource,
} from "./models"

export function resolveCodexNewChatDefaultsForSource(input: {
  models: CodexCatalogModel[]
  selectedModelId: string
  selectedThinking: CodexChatThinkingLevel
  source: CodexFirstPartyModelSource
}): { modelId: string; thinkingLevel: CodexChatThinkingLevel } {
  const resolved = resolveCodexModelForSource({
    models: input.models,
    selectedModelId: input.selectedModelId,
    source: input.source,
  })
  if (!resolved.model) {
    throw new Error(`No Codex model supports ${input.source}.`)
  }

  return {
    modelId: resolved.model.id,
    thinkingLevel: resolved.model.thinkings.includes(input.selectedThinking)
      ? input.selectedThinking
      : getDefaultCodexThinking(resolved.model),
  }
}

function getDefaultRuntime(): ChatSessionBindingRuntime {
  return appStore.get(lastSelectedAgentIdAtom) === "codex"
    ? "codex"
    : "claude-code"
}

/**
 * Snapshots the global new-chat defaults into a durable per-chat binding.
 * Existing chats must never call this helper to resolve their binding.
 */
export function getNewChatSessionBindingDefaults(
  runtime: ChatSessionBindingRuntime = getDefaultRuntime(),
): NormalizedChatSessionBindingWrite {
  if (runtime === "codex") {
    return normalizeChatSessionBindingWrite({
      runtime,
      modelId: appStore.get(lastSelectedCodexModelIdAtom),
      modelSource: appStore.get(lastSelectedCodexModelSourceAtom),
      thinkingLevel: appStore.get(lastSelectedCodexThinkingAtom),
    })
  }

  const selectedSource = appStore.get(lastSelectedClaudeModelSourceAtom)
  return normalizeChatSessionBindingWrite({
    runtime,
    modelId: appStore.get(lastSelectedModelIdAtom),
    modelSource: selectedSource === "auto" ? "claude-oauth" : selectedSource,
    thinkingLevel: null,
  })
}
