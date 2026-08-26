import type { ChatSessionBindingWriteInput } from "../../src/shared/chat-session-binding"
import { providerProfileSource } from "../../src/shared/provider-profile-types"

export type CodexAppServerSmokeAuthMode = "provider" | "chatgpt" | "api_key"

export type CodexAppServerSmokeBindingTuple = {
  binding: ChatSessionBindingWriteInput
  request: {
    model: string
    providerProfileId?: string
    codexAuthMethod?: "chatgpt" | "api_key"
  }
}

/** Builds the same binding/request tuple as the desktop Codex transport. */
export function createCodexAppServerSmokeBindingTuple(input: {
  authMode: CodexAppServerSmokeAuthMode
  providerProfileId: string | null
  modelId: string
}): CodexAppServerSmokeBindingTuple {
  const modelId = input.modelId.trim()
  if (!modelId) throw new Error("Codex smoke modelId is required.")

  if (input.authMode === "provider") {
    if (!input.providerProfileId) {
      throw new Error("Codex provider smoke requires a Provider Profile id.")
    }
    return {
      binding: {
        runtime: "codex",
        providerProfileId: input.providerProfileId,
        modelSource: providerProfileSource(input.providerProfileId),
        modelId,
        thinkingLevel: null,
      },
      request: {
        providerProfileId: input.providerProfileId,
        model: `${modelId}/none`,
      },
    }
  }

  const apiKey = input.authMode === "api_key"
  return {
    binding: {
      runtime: "codex",
      providerProfileId: null,
      modelSource: apiKey ? "openai-api-key" : "chatgpt",
      modelId,
      thinkingLevel: "high",
    },
    request: {
      codexAuthMethod: apiKey ? "api_key" : "chatgpt",
      model: `${modelId}/high`,
    },
  }
}
