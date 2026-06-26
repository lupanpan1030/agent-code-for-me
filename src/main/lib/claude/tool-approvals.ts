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
    "approvalInput" in pending
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

  if ("approvalInput" in pending) {
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
  for (const [toolUseId, pending] of pendingToolApprovals) {
    if (subChatId && pending.subChatId !== subChatId) continue
    pending.resolve({ approved: false, message })
    pendingToolApprovals.delete(toolUseId)
  }
}

export function resolveClaudePendingToolApproval(input: {
  toolUseId: string
  decision: ClaudeAskUserQuestionDecision
}): boolean {
  const pending = pendingToolApprovals.get(input.toolUseId)
  if (!pending) return false
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
  pending.resolve(decision)
  pendingToolApprovals.delete(input.toolUseId)
  return true
}

export function clearClaudePendingToolApprovalsForTest(): void {
  pendingToolApprovals.clear()
}
