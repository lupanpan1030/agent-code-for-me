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
    setCodexPendingToolApproval("tool-1", {
      subChatId: "sub-1",
      resolve: (decision) => decisions.push(decision),
    })

    expect(
      resolveCodexPendingToolApproval({
        toolUseId: "tool-1",
        decision: { approved: true, message: "Approved." },
      }),
    ).toBe(true)
    expect(decisions).toEqual([{ approved: true, message: "Approved." }])
    expect(
      resolveCodexPendingToolApproval({
        toolUseId: "tool-1",
        decision: { approved: false },
      }),
    ).toBe(false)
  })

  test("clears only approvals for the requested sub-chat", () => {
    const first: unknown[] = []
    const second: unknown[] = []
    setCodexPendingToolApproval("tool-1", {
      subChatId: "sub-1",
      resolve: (decision) => first.push(decision),
    })
    setCodexPendingToolApproval("tool-2", {
      subChatId: "sub-2",
      resolve: (decision) => second.push(decision),
    })

    clearPendingCodexApprovals("Session ended.", "sub-1")

    expect(first).toEqual([{ approved: false, message: "Session ended." }])
    expect(second).toEqual([])
    expect(deleteCodexPendingToolApproval("tool-1")).toBe(false)
    expect(deleteCodexPendingToolApproval("tool-2")).toBe(true)
  })
})
