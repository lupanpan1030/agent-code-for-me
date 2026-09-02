import {
  type AgentRuntimeContractId,
  CONTRACT_RUNTIME_IDS,
} from "./agent-runtime-capabilities"

export const agentChatProviders = CONTRACT_RUNTIME_IDS

export type ChatEngineId = AgentRuntimeContractId

export type AgentChatMessageMetadata = {
  model?: string
  provider?: ChatEngineId
  modelSource?: string
  providerProfileId?: string
}

export function normalizeChatEngineId(
  provider: string | null | undefined,
): ChatEngineId | null {
  return agentChatProviders.includes(provider as ChatEngineId)
    ? (provider as ChatEngineId)
    : null
}

export function normalizeAgentChatMetadataModel(model: unknown): string | null {
  return typeof model === "string" && model.trim() ? model.trim() : null
}

export function buildAgentChatMessageMetadata(input: {
  model?: string | null
  provider?: ChatEngineId | null
  modelSource?: string | null
  providerProfileId?: string | null
}): AgentChatMessageMetadata | undefined {
  const metadata: AgentChatMessageMetadata = {}

  const model = normalizeAgentChatMetadataModel(input.model)
  if (model) {
    metadata.model = model
  }

  const provider = normalizeChatEngineId(input.provider)
  if (provider) {
    metadata.provider = provider
  }

  if (input.modelSource?.trim()) {
    metadata.modelSource = input.modelSource.trim()
  }

  if (input.providerProfileId?.trim()) {
    metadata.providerProfileId = input.providerProfileId.trim()
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined
}

export function inferChatEngineIdFromMessages(
  messages: unknown[],
): ChatEngineId {
  for (const message of messages) {
    if (typeof message !== "object" || message === null) continue

    const metadata = (message as { metadata?: unknown }).metadata
    if (typeof metadata !== "object" || metadata === null) continue

    const provider = normalizeChatEngineId(
      (metadata as { provider?: unknown }).provider as string | undefined,
    )
    if (provider) return provider

    const model = (metadata as { model?: unknown }).model
    if (typeof model !== "string") continue
    const normalizedModel = model.toLowerCase()
    if (
      normalizedModel.includes("codex") ||
      normalizedModel.startsWith("gpt-")
    ) {
      return "codex"
    }
  }

  return "claude-code"
}
