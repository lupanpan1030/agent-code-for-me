import { clearPendingCodexApprovals } from "./tool-approvals"

export type ActiveCodexStream = {
  runId: string
  controller: AbortController
  cancelRequested: boolean
}

const activeCodexStreams = new Map<string, ActiveCodexStream>()

export function getActiveCodexStream(
  subChatId: string,
): ActiveCodexStream | undefined {
  return activeCodexStreams.get(subChatId)
}

export function setActiveCodexStream(
  subChatId: string,
  stream: ActiveCodexStream,
): void {
  activeCodexStreams.set(subChatId, stream)
}

export function deleteActiveCodexStream(subChatId: string): boolean {
  return activeCodexStreams.delete(subChatId)
}

export function deleteActiveCodexStreamIfOwner(
  subChatId: string,
  owner: ActiveCodexStream,
): boolean {
  const stream = activeCodexStreams.get(subChatId)
  if (stream !== owner) return false
  activeCodexStreams.delete(subChatId)
  return true
}

export function hasActiveCodexStreams(): boolean {
  return activeCodexStreams.size > 0
}

export function abortAllCodexStreams(): void {
  for (const [subChatId, stream] of activeCodexStreams) {
    console.log(`[codex] Aborting stream ${subChatId} before reload`)
    stream.controller.abort()
    clearPendingCodexApprovals("Session cancelled.", subChatId)
  }
  activeCodexStreams.clear()
}

export function clearActiveCodexStreamsForTest(): void {
  activeCodexStreams.clear()
}
