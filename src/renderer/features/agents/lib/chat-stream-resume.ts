// Resume admission must outlive a ChatView mount. React remounts the view when
// the same sub-chat receives a replacement Chat instance, so a component-local
// ref would admit the same persisted stream again.
// Keep only the latest claim for each sub-chat. Persisted stream ids are unique,
// so retaining older successful keys would only grow process memory without
// adding deduplication value.
const claimedChatStreamResumeKeyBySubChat = new Map<string, string>()

export function resolvePersistedChatStreamId(input: {
  stream_id?: unknown
  streamId?: unknown
}): string | null {
  const candidate = input.stream_id ?? input.streamId
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : null
}

export function claimChatStreamResume(
  subChatId: string,
  streamId: string | null | undefined,
): string | null {
  if (!streamId) {
    claimedChatStreamResumeKeyBySubChat.delete(subChatId)
    return null
  }

  const resumeKey = `${subChatId}:${streamId}`
  if (claimedChatStreamResumeKeyBySubChat.get(subChatId) === resumeKey) {
    return null
  }
  claimedChatStreamResumeKeyBySubChat.set(subChatId, resumeKey)
  return resumeKey
}

export function releaseFailedChatStreamResume(resumeKey: string): void {
  for (const [subChatId, claimedKey] of claimedChatStreamResumeKeyBySubChat) {
    if (claimedKey !== resumeKey) continue
    claimedChatStreamResumeKeyBySubChat.delete(subChatId)
    return
  }
}

export async function resumeClaimedChatStream(input: {
  resumeKey: string
  resume: () => Promise<void>
  getStatus: () => string
}): Promise<"retained" | "released"> {
  try {
    await input.resume()
  } catch (error) {
    releaseFailedChatStreamResume(input.resumeKey)
    throw error
  }

  // AI SDK Chat catches transport/stream failures and resolves resumeStream()
  // after setting its own status to error. Inspect that exact Chat instance;
  // Promise rejection alone cannot distinguish a failed resume.
  if (input.getStatus() === "error") {
    releaseFailedChatStreamResume(input.resumeKey)
    return "released"
  }

  return "retained"
}

export function clearChatStreamResumeClaimsForTest(): void {
  claimedChatStreamResumeKeyBySubChat.clear()
}
