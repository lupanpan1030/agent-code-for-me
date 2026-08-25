import { describe, expect, test } from "bun:test"
import { createConflictVerdictStalenessLatch } from "../src/renderer/features/agents/workbench/conflict-verdict-state"

const fingerprints = {
  "task-a": { statusHash: "status-a", headSha: "head-a" },
  "task-b": { statusHash: "status-b", headSha: "head-b" },
}

describe("agent workbench conflict verdict state", () => {
  test("keeps a deep-check pair current when both status hashes match", () => {
    const latch = createConflictVerdictStalenessLatch()

    expect(
      latch.isPairStale(
        ["task-a", "task-b"],
        { "task-a": "status-a", "task-b": "status-b" },
        fingerprints,
      ),
    ).toBe(false)
  })

  test("marks a deep-check pair stale when either workspace status hash changes", () => {
    const latch = createConflictVerdictStalenessLatch()

    expect(
      latch.isPairStale(
        ["task-a", "task-b"],
        { "task-a": "status-a", "task-b": "changed" },
        fingerprints,
      ),
    ).toBe(true)
  })

  test("marks a deep-check pair stale when a current sibling hash is unavailable", () => {
    const latch = createConflictVerdictStalenessLatch()

    expect(
      latch.isPairStale(
        ["task-a", "task-b"],
        { "task-a": "status-a" },
        fingerprints,
      ),
    ).toBe(true)
  })

  test("ignores head SHA changes but latches an observed status-hash mismatch", () => {
    const latch = createConflictVerdictStalenessLatch()
    const changedHeads = {
      "task-a": { statusHash: "status-a", headSha: "new-head-a" },
      "task-b": { statusHash: "status-b", headSha: "new-head-b" },
    }

    expect(
      latch.isPairStale(
        ["task-a", "task-b"],
        { "task-a": "status-a", "task-b": "status-b" },
        changedHeads,
      ),
    ).toBe(false)

    expect(
      latch.isPairStale(
        ["task-a", "task-b"],
        { "task-a": "status-a", "task-b": "dirty-status-b" },
        changedHeads,
      ),
    ).toBe(true)
    latch.observePair(
      ["task-a", "task-b"],
      { "task-a": "status-a", "task-b": "dirty-status-b" },
      changedHeads,
    )
    expect(
      latch.isPairStale(
        ["task-a", "task-b"],
        { "task-a": "status-a", "task-b": "status-b" },
        changedHeads,
      ),
    ).toBe(true)

    latch.reset()
    expect(
      latch.isPairStale(
        ["task-a", "task-b"],
        { "task-a": "status-a", "task-b": "status-b" },
        changedHeads,
      ),
    ).toBe(false)
  })
})
