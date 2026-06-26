import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  clearClaudePendingToolApprovals,
  clearClaudePendingToolApprovalsForTest,
  getClaudePendingToolApprovalStore,
  resolveClaudePendingToolApproval,
} from "../src/main/lib/claude/tool-approvals"

describe("Claude tool approval owner", () => {
  afterEach(() => {
    clearClaudePendingToolApprovalsForTest()
  })

  test("resolves and removes a pending approval", () => {
    const decisions: unknown[] = []
    getClaudePendingToolApprovalStore().set("tool-1", {
      subChatId: "sub-1",
      toolName: "AskUserQuestion",
      toolInput: { questions: ["Proceed?"] },
      resolve: (decision) => decisions.push(decision),
    })

    expect(
      resolveClaudePendingToolApproval({
        toolUseId: "tool-1",
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
    expect(getClaudePendingToolApprovalStore().has("tool-1")).toBe(false)
  })

  test("rejects approval updatedInput fields outside the approved tool schema", () => {
    const decisions: unknown[] = []
    getClaudePendingToolApprovalStore().set("tool-1", {
      subChatId: "sub-1",
      toolName: "AskUserQuestion",
      toolInput: { questions: ["Proceed?"] },
      resolve: (decision) => decisions.push(decision),
    })

    expect(() =>
      resolveClaudePendingToolApproval({
        toolUseId: "tool-1",
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
    expect(getClaudePendingToolApprovalStore().has("tool-1")).toBe(true)
  })

  test("rejects approval updatedInput that swaps the displayed questions", () => {
    const decisions: unknown[] = []
    getClaudePendingToolApprovalStore().set("tool-1", {
      subChatId: "sub-1",
      toolName: "AskUserQuestion",
      toolInput: { questions: ["Proceed?"] },
      resolve: (decision) => decisions.push(decision),
    })

    expect(() =>
      resolveClaudePendingToolApproval({
        toolUseId: "tool-1",
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
    expect(getClaudePendingToolApprovalStore().has("tool-1")).toBe(true)
  })

  test("guarded tool approvals cannot replace the approved tool input", () => {
    const decisions: unknown[] = []
    const questions = [
      {
        question: "Scoped shell file operation targets approved editable scope and requires user approval.",
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
    getClaudePendingToolApprovalStore().set("tool-guarded-shell", {
      subChatId: "sub-1",
      toolName: "Bash",
      toolInput: originalToolInput,
      approvalInput: { questions },
      resolve: (decision) => decisions.push(decision),
    })

    expect(() =>
      resolveClaudePendingToolApproval({
        toolUseId: "tool-guarded-shell",
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
    expect(getClaudePendingToolApprovalStore().has("tool-guarded-shell")).toBe(
      true,
    )

    expect(
      resolveClaudePendingToolApproval({
        toolUseId: "tool-guarded-shell",
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
    expect(getClaudePendingToolApprovalStore().has("tool-guarded-shell")).toBe(
      false,
    )
  })

  test("clears only approvals for the requested sub-chat", () => {
    const decisions: Record<string, unknown[]> = {
      first: [],
      second: [],
    }
    getClaudePendingToolApprovalStore().set("tool-1", {
      subChatId: "sub-1",
      toolName: "AskUserQuestion",
      toolInput: { questions: ["Proceed?"] },
      resolve: (decision) => decisions.first.push(decision),
    })
    getClaudePendingToolApprovalStore().set("tool-2", {
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
    expect(getClaudePendingToolApprovalStore().has("tool-1")).toBe(false)
    expect(getClaudePendingToolApprovalStore().has("tool-2")).toBe(true)
  })

  test("returns false when no pending approval exists", () => {
    expect(
      resolveClaudePendingToolApproval({
        toolUseId: "missing",
        decision: { approved: false },
      }),
    ).toBe(false)
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
