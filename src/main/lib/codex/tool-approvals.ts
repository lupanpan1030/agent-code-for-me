import type {
  CodexAskUserQuestionApproval,
  CodexAskUserQuestionPending,
} from "./ask-user-question"

const pendingCodexToolApprovals = new Map<string, CodexAskUserQuestionPending>()

export function setCodexPendingToolApproval(
  approvalId: string,
  pending: CodexAskUserQuestionPending,
): void {
  if (pending.approvalId !== approvalId) {
    throw new Error("Codex pending approval identity mismatch.")
  }
  pendingCodexToolApprovals.set(approvalId, pending)
}

export function deleteCodexPendingToolApproval(
  approvalId: string,
  expected: CodexAskUserQuestionPending,
): boolean {
  if (pendingCodexToolApprovals.get(approvalId) !== expected) return false
  return pendingCodexToolApprovals.delete(approvalId)
}

export function clearPendingCodexApprovals(
  message = "Session cancelled.",
  subChatId?: string,
): void {
  for (const [approvalId, pending] of pendingCodexToolApprovals) {
    if (subChatId && pending.subChatId !== subChatId) continue
    if (!deleteCodexPendingToolApproval(approvalId, pending)) continue
    pending.resolve({ approved: false, message })
  }
}

export function resolveCodexPendingToolApproval(input: {
  approvalId: string
  decision: CodexAskUserQuestionApproval
}): boolean {
  const pending = pendingCodexToolApprovals.get(input.approvalId)
  if (!pending) return false
  try {
    if (!pending.isCurrentRunOwner()) return false
  } catch {
    return false
  }
  if (!deleteCodexPendingToolApproval(input.approvalId, pending)) return false
  pending.resolve(input.decision)
  return true
}

export function clearCodexPendingToolApprovalsForTest(): void {
  pendingCodexToolApprovals.clear()
}
