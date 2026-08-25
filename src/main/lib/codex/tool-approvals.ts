import type {
  CodexAskUserQuestionApproval,
  CodexAskUserQuestionPending,
} from "./ask-user-question"

const pendingCodexToolApprovals = new Map<string, CodexAskUserQuestionPending>()

export function setCodexPendingToolApproval(
  toolUseId: string,
  pending: CodexAskUserQuestionPending,
): void {
  pendingCodexToolApprovals.set(toolUseId, pending)
}

export function deleteCodexPendingToolApproval(toolUseId: string): boolean {
  return pendingCodexToolApprovals.delete(toolUseId)
}

export function clearPendingCodexApprovals(
  message = "Session cancelled.",
  subChatId?: string,
): void {
  for (const [toolUseId, pending] of pendingCodexToolApprovals) {
    if (subChatId && pending.subChatId !== subChatId) continue
    pending.resolve({ approved: false, message })
    pendingCodexToolApprovals.delete(toolUseId)
  }
}

export function resolveCodexPendingToolApproval(input: {
  toolUseId: string
  decision: CodexAskUserQuestionApproval
}): boolean {
  const pending = pendingCodexToolApprovals.get(input.toolUseId)
  if (!pending) return false
  pending.resolve(input.decision)
  pendingCodexToolApprovals.delete(input.toolUseId)
  return true
}

export function clearCodexPendingToolApprovalsForTest(): void {
  pendingCodexToolApprovals.clear()
}
