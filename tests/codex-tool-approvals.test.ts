import { afterEach, describe, expect, test } from "bun:test"
import {
  clearCodexPendingToolApprovalsForTest,
  clearPendingCodexApprovals,
  deleteCodexPendingToolApproval,
  resolveCodexPendingToolApproval,
  setCodexPendingToolApproval,
} from "../src/main/lib/codex/tool-approvals"

describe("Codex tool approval owner", () => {
  afterEach(() => {
    clearCodexPendingToolApprovalsForTest()
  })

  test("resolves and removes a pending approval", () => {
    const decisions: unknown[] = []
    setCodexPendingToolApproval("approval-1", {
      approvalId: "approval-1",
      toolUseId: "tool-1",
      subChatId: "sub-1",
      isCurrentRunOwner: () => true,
      resolve: (decision) => decisions.push(decision),
    })

    expect(
      resolveCodexPendingToolApproval({
        approvalId: "approval-1",
        decision: { approved: true, message: "Approved." },
      }),
    ).toBe(true)
    expect(decisions).toEqual([{ approved: true, message: "Approved." }])
    expect(
      resolveCodexPendingToolApproval({
        approvalId: "approval-1",
        decision: { approved: false },
      }),
    ).toBe(false)
  })

  test("clears only approvals for the requested sub-chat", () => {
    const first: unknown[] = []
    const second: unknown[] = []
    const firstPending = {
      approvalId: "approval-1",
      toolUseId: "tool-1",
      subChatId: "sub-1",
      isCurrentRunOwner: () => true,
      resolve: (decision) => first.push(decision),
    }
    const secondPending = {
      approvalId: "approval-2",
      toolUseId: "tool-2",
      subChatId: "sub-2",
      isCurrentRunOwner: () => true,
      resolve: (decision) => second.push(decision),
    }
    setCodexPendingToolApproval("approval-1", firstPending)
    setCodexPendingToolApproval("approval-2", secondPending)

    clearPendingCodexApprovals("Session ended.", "sub-1")

    expect(first).toEqual([{ approved: false, message: "Session ended." }])
    expect(second).toEqual([])
    expect(deleteCodexPendingToolApproval("approval-1", firstPending)).toBe(
      false,
    )
    expect(deleteCodexPendingToolApproval("approval-2", secondPending)).toBe(
      true,
    )
  })

  test("rejects delayed A approval after same-run-id owner replacement", () => {
    let currentOwner = "A"
    const decisions: string[] = []
    const createPending = (approvalId: string, owner: string) => ({
      approvalId,
      toolUseId: "shared-runtime-tool",
      subChatId: "sub-1",
      isCurrentRunOwner: () => currentOwner === owner,
      resolve: () => decisions.push(owner),
    })
    const pendingA = createPending("approval-A", "A")
    const pendingB = createPending("approval-B", "B")
    setCodexPendingToolApproval("approval-A", pendingA)
    currentOwner = "B"
    setCodexPendingToolApproval("approval-B", pendingB)

    expect(
      resolveCodexPendingToolApproval({
        approvalId: "approval-A",
        decision: { approved: true },
      }),
    ).toBe(false)
    expect(decisions).toEqual([])
    expect(
      resolveCodexPendingToolApproval({
        approvalId: "approval-B",
        decision: { approved: true },
      }),
    ).toBe(true)
    expect(decisions).toEqual(["B"])
  })
})
