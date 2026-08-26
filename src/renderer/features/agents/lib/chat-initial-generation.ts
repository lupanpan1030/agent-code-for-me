// Initial-generation admission must outlive a ChatView mount. Binding changes
// replace the same-id Chat and remount its view while a generation is waiting
// on the per-chat gate; a component-local ref would admit the initial prompt
// once from each mount.
//
// Keep only the latest initial-message identity per sub-chat. A different
// initial message may legitimately be generated later, while retaining a
// successful key prevents the same persisted prompt from executing twice.
const claimedInitialGenerationKeyBySubChat = new Map<string, string>()

export function claimChatInitialGeneration(
  subChatId: string,
  initialMessageId: string | null | undefined,
): string | null {
  if (!initialMessageId) return null

  const generationKey = `${subChatId}:${initialMessageId}`
  if (claimedInitialGenerationKeyBySubChat.get(subChatId) === generationKey) {
    return null
  }
  claimedInitialGenerationKeyBySubChat.set(subChatId, generationKey)
  return generationKey
}

export function releaseFailedChatInitialGeneration(
  generationKey: string,
): void {
  for (const [subChatId, claimedKey] of claimedInitialGenerationKeyBySubChat) {
    if (claimedKey !== generationKey) continue
    claimedInitialGenerationKeyBySubChat.delete(subChatId)
    return
  }
}

export async function runClaimedChatInitialGeneration(input: {
  generationKey: string
  regenerate: () => Promise<void>
  getStatus: () => string
}): Promise<"retained" | "released"> {
  try {
    await input.regenerate()
  } catch (error) {
    releaseFailedChatInitialGeneration(input.generationKey)
    throw error
  }

  // AI SDK Chat resolves regenerate() after transport failures and records the
  // failure on the Chat. Release only the exact failed claim so a later mount
  // can retry without allowing two successful executions.
  if (input.getStatus() === "error") {
    releaseFailedChatInitialGeneration(input.generationKey)
    return "released"
  }

  return "retained"
}

export function clearChatInitialGenerationClaimsForTest(): void {
  claimedInitialGenerationKeyBySubChat.clear()
}
