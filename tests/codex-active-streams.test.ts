import { afterEach, describe, expect, test } from "bun:test"
import {
  abortAllCodexStreams,
  clearActiveCodexStreamsForTest,
  deleteActiveCodexStream,
  deleteActiveCodexStreamIfRun,
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

  test("deletes a stream only when cleanup owns its run", () => {
    setActiveCodexStream("sub-1", {
      controller: new AbortController(),
      runId: "run-new",
      cancelRequested: false,
    })

    expect(deleteActiveCodexStreamIfRun("sub-1", "run-old")).toBe(false)
    expect(getActiveCodexStream("sub-1")?.runId).toBe("run-new")
    expect(deleteActiveCodexStreamIfRun("sub-1", "run-new")).toBe(true)
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
    setCodexPendingToolApproval("tool-1", {
      subChatId: "sub-1",
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
