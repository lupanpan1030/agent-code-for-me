import { afterEach, describe, expect, test } from "bun:test"
import {
  abortAllCodexStreams,
  clearActiveCodexStreamsForTest,
  deleteActiveCodexStream,
  deleteActiveCodexStreamIfOwner,
  getActiveCodexStream,
  hasActiveCodexStreams,
  setActiveCodexStream,
} from "../src/main/lib/codex/active-streams"
import {
  clearCodexPendingToolApprovalsForTest,
  setCodexPendingToolApproval,
} from "../src/main/lib/codex/tool-approvals"

describe("Codex active stream owner", () => {
  afterEach(() => {
    clearActiveCodexStreamsForTest()
    clearCodexPendingToolApprovalsForTest()
  })

  test("tracks active streams by sub-chat and run id", () => {
    const controller = new AbortController()

    setActiveCodexStream("sub-1", {
      controller,
      runId: "run-1",
      cancelRequested: false,
    })

    expect(hasActiveCodexStreams()).toBe(true)
    expect(getActiveCodexStream("sub-1")).toEqual({
      controller,
      runId: "run-1",
      cancelRequested: false,
    })
    expect(deleteActiveCodexStream("sub-1")).toBe(true)
    expect(hasActiveCodexStreams()).toBe(false)
  })

  test("deletes a stream only when cleanup owns its exact installed stream", () => {
    const staleOwner = {
      controller: new AbortController(),
      runId: "run-shared",
      cancelRequested: false,
    }
    const currentOwner = {
      controller: new AbortController(),
      runId: "run-shared",
      cancelRequested: false,
    }
    setActiveCodexStream("sub-1", currentOwner)

    expect(deleteActiveCodexStreamIfOwner("sub-1", staleOwner)).toBe(false)
    expect(getActiveCodexStream("sub-1")).toBe(currentOwner)
    expect(deleteActiveCodexStreamIfOwner("sub-1", currentOwner)).toBe(true)
    expect(hasActiveCodexStreams()).toBe(false)
  })

  test("aborts all streams and clears their pending approvals", () => {
    const controller = new AbortController()
    const decisions: unknown[] = []
    setActiveCodexStream("sub-1", {
      controller,
      runId: "run-1",
      cancelRequested: false,
    })
    setCodexPendingToolApproval("approval-1", {
      approvalId: "approval-1",
      toolUseId: "tool-1",
      subChatId: "sub-1",
      isCurrentRunOwner: () => true,
      resolve: (decision) => decisions.push(decision),
    })

    abortAllCodexStreams()

    expect(controller.signal.aborted).toBe(true)
    expect(hasActiveCodexStreams()).toBe(false)
    expect(decisions).toEqual([
      { approved: false, message: "Session cancelled." },
    ])
  })
})
