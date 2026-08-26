import type { ChatSessionBinding } from "../../../../shared/chat-session-binding"

export type AuthRetryTransportGeneration = {
  subChatId: string
  bindingIdentity: string
  token: symbol
}

const currentTransportGenerationBySubChat = new Map<string, symbol>()
const currentBindingIdentityBySubChat = new Map<string, string>()

function normalizeTimestamp(value: Date | string | null): string | null {
  return value instanceof Date ? value.toISOString() : value
}

/**
 * Stable, non-secret identity for the exact binding that owned a failed
 * request. Auth retry payloads may only be republished and consumed while this
 * tuple is still current.
 */
export function getChatSessionBindingIdentity(
  binding: ChatSessionBinding,
): string {
  return JSON.stringify([
    binding.id,
    binding.subChatId,
    binding.runtime,
    binding.providerProfileId,
    binding.modelId,
    binding.modelSource,
    binding.thinkingLevel,
    normalizeTimestamp(binding.createdAt),
    normalizeTimestamp(binding.updatedAt),
  ])
}

export function registerAuthRetryTransportGeneration(
  subChatId: string,
  binding: ChatSessionBinding,
): AuthRetryTransportGeneration {
  const generation = {
    subChatId,
    bindingIdentity: getChatSessionBindingIdentity(binding),
    token: Symbol(subChatId),
  }
  currentTransportGenerationBySubChat.set(subChatId, generation.token)
  currentBindingIdentityBySubChat.set(subChatId, generation.bindingIdentity)
  return generation
}

export function isCurrentAuthRetryTransportGeneration(
  generation: AuthRetryTransportGeneration,
): boolean {
  return (
    currentTransportGenerationBySubChat.get(generation.subChatId) ===
    generation.token
  )
}

export function releaseAuthRetryTransportGeneration(
  generation: AuthRetryTransportGeneration,
): void {
  if (!isCurrentAuthRetryTransportGeneration(generation)) return
  currentTransportGenerationBySubChat.delete(generation.subChatId)
  currentBindingIdentityBySubChat.delete(generation.subChatId)
}

export function isCurrentAuthRetryBindingIdentity(
  subChatId: string,
  bindingIdentity: string,
): boolean {
  return currentBindingIdentityBySubChat.get(subChatId) === bindingIdentity
}

export function pendingAuthRetryMatchesBinding(
  pending: { bindingIdentity: string } | null,
  binding: ChatSessionBinding,
): boolean {
  return (
    pending !== null &&
    pending.bindingIdentity === getChatSessionBindingIdentity(binding)
  )
}

export function clearAuthRetryTransportGenerationsForTest(): void {
  currentTransportGenerationBySubChat.clear()
  currentBindingIdentityBySubChat.clear()
}
