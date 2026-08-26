import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { ClaudeAskUserQuestionPending } from "../src/main/lib/claude/agent-sdk-tool-permission"
import {
  clearClaudePendingToolApprovals,
  clearClaudePendingToolApprovalsForTest,
  getClaudePendingToolApprovalStore,
  resolveClaudePendingToolApproval,
} from "../src/main/lib/claude/tool-approvals"

function setPending(
  approvalId: string,
  pending: Omit<
    ClaudeAskUserQuestionPending,
    "approvalId" | "isCurrentRunOwner"
  > & { isCurrentRunOwner?: () => boolean },
): void {
  getClaudePendingToolApprovalStore().set(approvalId, {
    approvalId,
    isCurrentRunOwner: () => true,
    ...pending,
  })
}

describe("Claude tool approval owner", () => {
  afterEach(() => {
    clearClaudePendingToolApprovalsForTest()
  })

  test("resolves and removes a pending approval", () => {
    const decisions: unknown[] = []
    setPending("approval-1", {
      toolUseId: "tool-1",
      subChatId: "sub-1",
      toolName: "AskUserQuestion",
      toolInput: { questions: ["Proceed?"] },
      resolve: (decision) => decisions.push(decision),
    })

    expect(
      resolveClaudePendingToolApproval({
        approvalId: "approval-1",
        decision: {
          approved: true,
          updatedInput: {
            questions: ["Proceed?"],
            answers: { "Proceed?": "yes" },
          },
        },
      }),
    ).toBe(true)

    expect(decisions).toEqual([
      {
        approved: true,
        updatedInput: {
          questions: ["Proceed?"],
          answers: { "Proceed?": "yes" },
        },
      },
    ])
    expect(getClaudePendingToolApprovalStore().has("approval-1")).toBe(false)
  })

  test("rejects approval updatedInput fields outside the approved tool schema", () => {
    const decisions: unknown[] = []
    setPending("approval-1", {
      toolUseId: "tool-1",
      subChatId: "sub-1",
      toolName: "AskUserQuestion",
      toolInput: { questions: ["Proceed?"] },
      resolve: (decision) => decisions.push(decision),
    })

    expect(() =>
      resolveClaudePendingToolApproval({
        approvalId: "approval-1",
        decision: {
          approved: true,
          updatedInput: {
            questions: ["Proceed?"],
            answers: { "Proceed?": "yes" },
            command: "rm -rf /",
          },
        },
      }),
    ).toThrow("Invalid updatedInput for Claude tool approval.")

    expect(decisions).toEqual([])
    expect(getClaudePendingToolApprovalStore().has("approval-1")).toBe(true)
  })

  test("rejects approval updatedInput that swaps the displayed questions", () => {
    const decisions: unknown[] = []
    setPending("approval-1", {
      toolUseId: "tool-1",
      subChatId: "sub-1",
      toolName: "AskUserQuestion",
      toolInput: { questions: ["Proceed?"] },
      resolve: (decision) => decisions.push(decision),
    })

    expect(() =>
      resolveClaudePendingToolApproval({
        approvalId: "approval-1",
        decision: {
          approved: true,
          updatedInput: {
            questions: ["Run a different command?"],
            answers: { "Proceed?": "yes" },
          },
        },
      }),
    ).toThrow("questions changed")

    expect(decisions).toEqual([])
    expect(getClaudePendingToolApprovalStore().has("approval-1")).toBe(true)
  })

  test("guarded tool approvals cannot replace the approved tool input", () => {
    const decisions: unknown[] = []
    const questions = [
      {
        question:
          "Scoped shell file operation targets approved editable scope and requires user approval.",
        header: "Scoped shell write",
        options: [
          { label: "Approve", description: "Allow this action once." },
          { label: "Deny", description: "Block this action." },
        ],
        multiSelect: false,
      },
    ]
    const originalToolInput = {
      command: "printf 'safe' > /repo/src/generated.txt",
    }
    setPending("approval-guarded-shell", {
      toolUseId: "tool-guarded-shell",
      subChatId: "sub-1",
      toolName: "Bash",
      toolInput: originalToolInput,
      approvalInput: { questions },
      resolve: (decision) => decisions.push(decision),
    })

    expect(() =>
      resolveClaudePendingToolApproval({
        approvalId: "approval-guarded-shell",
        decision: {
          approved: true,
          updatedInput: {
            questions,
            answers: {
              [questions[0].question]: "Approve",
            },
            command: "rm -rf /",
          },
        },
      }),
    ).toThrow("Invalid updatedInput for Claude tool approval.")

    expect(decisions).toEqual([])
    expect(
      getClaudePendingToolApprovalStore().has("approval-guarded-shell"),
    ).toBe(true)

    expect(
      resolveClaudePendingToolApproval({
        approvalId: "approval-guarded-shell",
        decision: {
          approved: true,
          updatedInput: {
            questions,
            answers: {
              [questions[0].question]: "Approve",
            },
          },
        },
      }),
    ).toBe(true)

    expect(decisions).toEqual([
      {
        approved: true,
        updatedInput: originalToolInput,
      },
    ])
    expect(
      getClaudePendingToolApprovalStore().has("approval-guarded-shell"),
    ).toBe(false)
  })

  test("clears only approvals for the requested sub-chat", () => {
    const decisions: Record<string, unknown[]> = {
      first: [],
      second: [],
    }
    setPending("approval-1", {
      toolUseId: "tool-1",
      subChatId: "sub-1",
      toolName: "AskUserQuestion",
      toolInput: { questions: ["Proceed?"] },
      resolve: (decision) => decisions.first.push(decision),
    })
    setPending("approval-2", {
      toolUseId: "tool-2",
      subChatId: "sub-2",
      toolName: "AskUserQuestion",
      toolInput: { questions: ["Proceed?"] },
      resolve: (decision) => decisions.second.push(decision),
    })

    clearClaudePendingToolApprovals("Session ended.", "sub-1")

    expect(decisions.first).toEqual([
      {
        approved: false,
        message: "Session ended.",
      },
    ])
    expect(decisions.second).toEqual([])
    expect(getClaudePendingToolApprovalStore().has("approval-1")).toBe(false)
    expect(getClaudePendingToolApprovalStore().has("approval-2")).toBe(true)
  })

  test("returns false when no pending approval exists", () => {
    expect(
      resolveClaudePendingToolApproval({
        approvalId: "missing",
        decision: { approved: false },
      }),
    ).toBe(false)
  })

  test("rejects delayed A approval after same-run-id owner replacement", () => {
    let currentOwner = "A"
    const decisions: string[] = []
    for (const owner of ["A", "B"] as const) {
      setPending(`approval-${owner}`, {
        toolUseId: "shared-runtime-tool",
        subChatId: "sub-1",
        toolName: "AskUserQuestion",
        toolInput: { questions: ["Continue?"] },
        isCurrentRunOwner: () => currentOwner === owner,
        resolve: () => decisions.push(owner),
      })
      currentOwner = owner
    }

    expect(
      resolveClaudePendingToolApproval({
        approvalId: "approval-A",
        decision: { approved: true },
      }),
    ).toBe(false)
    expect(decisions).toEqual([])
    expect(
      resolveClaudePendingToolApproval({
        approvalId: "approval-B",
        decision: { approved: true },
      }),
    ).toBe(true)
    expect(decisions).toEqual(["B"])
  })

  test("Claude approval route no longer accepts unknown top-level updatedInput", () => {
    const claudeRouterSource = readFileSync(
      join(process.cwd(), "src/main/lib/trpc/routers/claude.ts"),
      "utf-8",
    )

    expect(claudeRouterSource).not.toContain(
      "updatedInput: z.unknown().optional()",
    )
    expect(claudeRouterSource).toContain(
      "updatedInput: z.object({}).passthrough().optional()",
    )
  })
})
