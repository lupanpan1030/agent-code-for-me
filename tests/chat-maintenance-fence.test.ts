import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  acquireChatMaintenanceFence,
  claimDesktopRunAdmissionWithMaintenanceFence,
  clearChatMaintenanceFencesForTest,
  hasActiveChatMaintenanceFence,
  releaseChatMaintenanceFence,
  releaseChatMaintenanceRunBlocker,
  releaseDesktopRunAdmissionWithMaintenanceFence,
} from "../src/main/lib/agent-runtime/chat-maintenance-fence"
import {
  claimDesktopRunAdmission,
  clearDesktopRunAdmissionsForTest,
  reserveDesktopRunAdmission,
} from "../src/main/lib/agent-runtime/desktop-run-admission-generation"
import {
  clearClaudeActiveSessionsForTest,
  setActiveClaudeSession,
} from "../src/main/lib/claude/active-sessions"
import {
  clearActiveCodexStreamsForTest,
  setActiveCodexStream,
} from "../src/main/lib/codex/active-streams"

function clearProcessState(): void {
  clearChatMaintenanceFencesForTest()
  clearDesktopRunAdmissionsForTest()
  clearClaudeActiveSessionsForTest()
  clearActiveCodexStreamsForTest()
}

beforeEach(clearProcessState)
afterEach(clearProcessState)

describe("chat maintenance fence", () => {
  test("rejects an active Claude owner without invalidating a pending admission", () => {
    const pending = reserveDesktopRunAdmission("sub-claude")
    setActiveClaudeSession("sub-claude", {
      controller: new AbortController(),
      runId: "claude-active",
    })

    expect(acquireChatMaintenanceFence("sub-claude")).toEqual({
      ok: false,
      error: {
        code: "SESSION_BINDING_BUSY",
        subChatId: "sub-claude",
        operation: "rollback",
        activeRunId: "claude-active",
        reason: "active-run",
      },
    })
    expect(claimDesktopRunAdmission(pending)).toBe(true)
    expect(hasActiveChatMaintenanceFence("sub-claude")).toBe(false)
  })

  test("rejects an active Codex owner without invalidating a pending admission", () => {
    const pending = reserveDesktopRunAdmission("sub-codex")
    setActiveCodexStream("sub-codex", {
      controller: new AbortController(),
      runId: "codex-active",
      cancelRequested: false,
    })

    expect(acquireChatMaintenanceFence("sub-codex")).toEqual({
      ok: false,
      error: {
        code: "SESSION_BINDING_BUSY",
        subChatId: "sub-codex",
        operation: "rollback",
        activeRunId: "codex-active",
        reason: "active-run",
      },
    })
    expect(claimDesktopRunAdmission(pending)).toBe(true)
    expect(hasActiveChatMaintenanceFence("sub-codex")).toBe(false)
  })

  test("a successful maintenance acquisition invalidates older pending admissions", () => {
    const pending = reserveDesktopRunAdmission("sub-acquired")

    const acquired = acquireChatMaintenanceFence("sub-acquired")
    if (!acquired.ok) throw new Error("Expected maintenance fence acquisition")

    expect(claimDesktopRunAdmission(pending)).toBe(false)
    expect(releaseChatMaintenanceFence(acquired.fence)).toBe(true)
  })

  test("returns maintenance BUSY once when rollback releases before the invalidated final claim", () => {
    const pending = reserveDesktopRunAdmission("sub-released-maintenance")
    const acquired = acquireChatMaintenanceFence("sub-released-maintenance")
    if (!acquired.ok) throw new Error("Expected maintenance fence acquisition")

    expect(releaseChatMaintenanceFence(acquired.fence)).toBe(true)
    expect(hasActiveChatMaintenanceFence("sub-released-maintenance")).toBe(
      false,
    )
    expect(
      claimDesktopRunAdmissionWithMaintenanceFence(pending, "run-pending"),
    ).toEqual({
      ok: false,
      reason: "maintenance",
      error: {
        code: "SESSION_BINDING_BUSY",
        subChatId: "sub-released-maintenance",
        operation: "rollback",
        activeRunId: null,
        reason: "maintenance",
      },
    })
    expect(
      claimDesktopRunAdmissionWithMaintenanceFence(pending, "run-pending"),
    ).toEqual({
      ok: false,
      reason: "stale-admission",
    })
  })

  test("keeps ordinary latest-admission supersession distinct from maintenance", () => {
    const older = reserveDesktopRunAdmission("sub-ordinary-supersession")
    const newer = reserveDesktopRunAdmission("sub-ordinary-supersession")

    expect(
      claimDesktopRunAdmissionWithMaintenanceFence(older, "run-older"),
    ).toEqual({
      ok: false,
      reason: "stale-admission",
    })
    const claimed = claimDesktopRunAdmissionWithMaintenanceFence(
      newer,
      "run-newer",
    )
    expect(claimed).toMatchObject({
      ok: true,
      blocker: {
        subChatId: "sub-ordinary-supersession",
        activeRunId: "run-newer",
      },
    })
    if (claimed.ok) {
      expect(releaseChatMaintenanceRunBlocker(claimed.blocker)).toBe(true)
    }
  })

  test("clearing the fence owner also clears maintenance tombstones", () => {
    const pending = reserveDesktopRunAdmission("sub-tombstone-clear")
    const acquired = acquireChatMaintenanceFence("sub-tombstone-clear")
    if (!acquired.ok) throw new Error("Expected maintenance fence acquisition")
    expect(releaseChatMaintenanceFence(acquired.fence)).toBe(true)

    clearChatMaintenanceFencesForTest()

    expect(
      claimDesktopRunAdmissionWithMaintenanceFence(pending, "run-pending"),
    ).toEqual({
      ok: false,
      reason: "stale-admission",
    })
  })

  test("maintenance-aware cleanup consumes an invalidated admission receipt", () => {
    const pending = reserveDesktopRunAdmission("sub-tombstone-release")
    const acquired = acquireChatMaintenanceFence("sub-tombstone-release")
    if (!acquired.ok) throw new Error("Expected maintenance fence acquisition")
    expect(releaseChatMaintenanceFence(acquired.fence)).toBe(true)

    expect(releaseDesktopRunAdmissionWithMaintenanceFence(pending)).toBe(true)
    expect(
      claimDesktopRunAdmissionWithMaintenanceFence(pending, "run-pending"),
    ).toEqual({
      ok: false,
      reason: "stale-admission",
    })
  })

  test("a maintenance BUSY rejection does not invalidate a pending admission", () => {
    const owner = acquireChatMaintenanceFence("sub-maintenance-busy")
    if (!owner.ok) throw new Error("Expected maintenance fence acquisition")
    const pending = reserveDesktopRunAdmission("sub-maintenance-busy")

    expect(acquireChatMaintenanceFence("sub-maintenance-busy")).toEqual({
      ok: false,
      error: {
        code: "SESSION_BINDING_BUSY",
        subChatId: "sub-maintenance-busy",
        operation: "rollback",
        activeRunId: null,
        reason: "maintenance",
      },
    })
    expect(releaseChatMaintenanceFence(owner.fence)).toBe(true)
    expect(claimDesktopRunAdmission(pending)).toBe(true)
  })

  test("returns a structured BUSY result when maintenance owns the final Run claim", () => {
    const acquired = acquireChatMaintenanceFence("sub-maintenance")
    if (!acquired.ok) throw new Error("Expected maintenance fence acquisition")
    const candidate = reserveDesktopRunAdmission("sub-maintenance")

    expect(
      claimDesktopRunAdmissionWithMaintenanceFence(candidate, "run-candidate"),
    ).toEqual({
      ok: false,
      reason: "maintenance",
      error: {
        code: "SESSION_BINDING_BUSY",
        subChatId: "sub-maintenance",
        operation: "rollback",
        activeRunId: null,
        reason: "maintenance",
      },
    })
    expect(claimDesktopRunAdmission(candidate)).toBe(false)
  })

  test("keeps every overlapping Run visible until its exact lifecycle settles", () => {
    const admissionA = reserveDesktopRunAdmission("sub-overlap")
    const claimedA = claimDesktopRunAdmissionWithMaintenanceFence(
      admissionA,
      "run-shared",
    )
    if (!claimedA.ok) throw new Error("Expected Run A claim")

    const admissionB = reserveDesktopRunAdmission("sub-overlap")
    const claimedB = claimDesktopRunAdmissionWithMaintenanceFence(
      admissionB,
      "run-shared",
    )
    if (!claimedB.ok) throw new Error("Expected Run B claim")

    expect(releaseChatMaintenanceRunBlocker(claimedB.blocker)).toBe(true)
    expect(acquireChatMaintenanceFence("sub-overlap")).toEqual({
      ok: false,
      error: {
        code: "SESSION_BINDING_BUSY",
        subChatId: "sub-overlap",
        operation: "rollback",
        activeRunId: "run-shared",
        reason: "active-run",
      },
    })

    expect(releaseChatMaintenanceRunBlocker(claimedA.blocker)).toBe(true)
    const maintenance = acquireChatMaintenanceFence("sub-overlap")
    expect(maintenance.ok).toBe(true)
    if (maintenance.ok) {
      expect(releaseChatMaintenanceFence(maintenance.fence)).toBe(true)
    }
  })

  test("keeps a replacement fence when stale cleanup releases an old token", () => {
    const first = acquireChatMaintenanceFence("sub-replaced")
    if (!first.ok) throw new Error("Expected first maintenance fence")
    expect(releaseChatMaintenanceFence(first.fence)).toBe(true)

    const replacement = acquireChatMaintenanceFence("sub-replaced")
    if (!replacement.ok)
      throw new Error("Expected replacement maintenance fence")

    expect(releaseChatMaintenanceFence(first.fence)).toBe(false)
    expect(hasActiveChatMaintenanceFence("sub-replaced")).toBe(true)
    expect(releaseChatMaintenanceFence(replacement.fence)).toBe(true)
  })

  test("clears process-local fence state for isolated tests and restart semantics", () => {
    const acquired = acquireChatMaintenanceFence("sub-process-clear")
    if (!acquired.ok) throw new Error("Expected maintenance fence acquisition")
    expect(hasActiveChatMaintenanceFence("sub-process-clear")).toBe(true)

    clearChatMaintenanceFencesForTest()

    expect(hasActiveChatMaintenanceFence("sub-process-clear")).toBe(false)
    expect(releaseChatMaintenanceFence(acquired.fence)).toBe(false)
  })

  test("clears rollback-only Run blockers on process restart", () => {
    const admission = reserveDesktopRunAdmission("sub-run-blocker-clear")
    const claimed = claimDesktopRunAdmissionWithMaintenanceFence(
      admission,
      "run-before-restart",
    )
    if (!claimed.ok) throw new Error("Expected Run claim")
    expect(acquireChatMaintenanceFence("sub-run-blocker-clear")).toMatchObject({
      ok: false,
      error: { activeRunId: "run-before-restart", reason: "active-run" },
    })

    clearChatMaintenanceFencesForTest()

    const maintenance = acquireChatMaintenanceFence("sub-run-blocker-clear")
    expect(maintenance.ok).toBe(true)
    expect(releaseChatMaintenanceRunBlocker(claimed.blocker)).toBe(false)
    if (maintenance.ok) {
      expect(releaseChatMaintenanceFence(maintenance.fence)).toBe(true)
    }
  })
})
