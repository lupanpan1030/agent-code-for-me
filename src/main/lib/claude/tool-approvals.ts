import { z } from "zod"
import type {
  ClaudeAskUserQuestionDecision,
  ClaudeAskUserQuestionPending,
} from "./agent-sdk-tool-permission"

const pendingToolApprovals = new Map<string, ClaudeAskUserQuestionPending>()

const askUserQuestionOptionSchema = z
  .object({
    label: z.string(),
    description: z.string().optional(),
  })
  .passthrough()

const askUserQuestionQuestionSchema = z.union([
  z.string(),
  z
    .object({
      question: z.string(),
      header: z.string().optional(),
      options: z.array(askUserQuestionOptionSchema).optional(),
      multiSelect: z.boolean().optional(),
    })
    .passthrough(),
])

const askUserQuestionApprovalUpdatedInputSchema = z
  .object({
    questions: z.array(askUserQuestionQuestionSchema).min(1),
    answers: z.record(z.string(), z.string()).optional(),
  })
  .strict()

function stableJson(value: unknown): string {
  return JSON.stringify(value)
}

function validateApprovalUpdatedInput(
  pending: ClaudeAskUserQuestionPending,
  updatedInput: unknown,
): Record<string, unknown> {
  const parsed =
    askUserQuestionApprovalUpdatedInputSchema.safeParse(updatedInput)
  if (!parsed.success) {
    throw new Error("Invalid updatedInput for Claude tool approval.")
  }

  const expectedQuestions =
    pending.approvalInput
      ? pending.approvalInput.questions
      : pending.toolInput.questions

  if (
    stableJson(parsed.data.questions) !==
    stableJson(expectedQuestions)
  ) {
    throw new Error(
      "Invalid updatedInput for Claude tool approval: questions changed.",
    )
  }

  if (pending.approvalInput) {
    return pending.toolInput
  }

  return parsed.data
}

export function getClaudePendingToolApprovalStore(): Map<
  string,
  ClaudeAskUserQuestionPending
> {
  return pendingToolApprovals
}

export function clearClaudePendingToolApprovals(
  message: string,
  subChatId?: string,
): void {
  for (const [approvalId, pending] of pendingToolApprovals) {
    if (subChatId && pending.subChatId !== subChatId) continue
    if (!deleteClaudePendingToolApproval(approvalId, pending)) continue
    pending.resolve({ approved: false, message })
  }
}

export function deleteClaudePendingToolApproval(
  approvalId: string,
  expected: ClaudeAskUserQuestionPending,
): boolean {
  if (pendingToolApprovals.get(approvalId) !== expected) return false
  return pendingToolApprovals.delete(approvalId)
}

function isPendingRunOwnerCurrent(
  pending: ClaudeAskUserQuestionPending,
): boolean {
  try {
    return pending.isCurrentRunOwner()
  } catch {
    return false
  }
}

export function resolveClaudePendingToolApproval(input: {
  approvalId: string
  decision: ClaudeAskUserQuestionDecision
}): boolean {
  const pending = pendingToolApprovals.get(input.approvalId)
  if (!pending) return false
  if (!isPendingRunOwnerCurrent(pending)) return false
  const decision =
    input.decision.updatedInput === undefined
      ? input.decision
      : {
          ...input.decision,
          updatedInput: validateApprovalUpdatedInput(
            pending,
            input.decision.updatedInput,
          ),
        }
  if (!deleteClaudePendingToolApproval(input.approvalId, pending)) return false
  pending.resolve(decision)
  return true
}

export function clearClaudePendingToolApprovalsForTest(): void {
  pendingToolApprovals.clear()
}
