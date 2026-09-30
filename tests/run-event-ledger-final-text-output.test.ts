/**
 * T4-P1 (refactor-canonical-run-event-ledger, negotiation round 1): output
 * evidence of a Run's assistant items comes from their final item state
 * (design "Final text wins for pre-seal item materialization"; invalid-empty
 * output fails). A non-empty delta superseded by an empty authoritative final
 * text is not output, on the headless and the desktop host alike; a
 * completed item with non-empty final text, an independent non-empty item
 * and an item-less coarse assistant output still count.
 */
import { describe, expect, test } from "bun:test"
import type { CanonicalRunEventLedger } from "../src/main/lib/agent-runtime/run-event-ledger"
import { getOrCreateRunEventLedger } from "../src/main/lib/agent-runtime/run-event-ledger-host"
import { chats, projects, subChats } from "../src/main/lib/db/schema"
import {
  completeDesktopChatAgentJobSafely,
  createAndStartDesktopAgentJob,
} from "../src/main/lib/desktop-agent-jobs"
import type {
  AgentRuntimeObserver,
  AgentRuntimeRunResult,
} from "../src/main/lib/headless/agent-runtime-contract"
import { runPersistedAgentJob } from "../src/main/lib/headless/job-runner"
import {
  createAgentJob,
  listAgentJobEvents,
} from "../src/main/lib/headless/job-store"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

type Db = ReturnType<typeof createAgentJobTestDb>

const CODEX_TUPLE = {
  kind: "runtime",
  installationId: "inst-codex-0.139.0-final-text-output",
  runtimeId: "codex",
  adapterSource: "codex-app-server",
  version: "0.139.0",
  executableRef: "exe-final-text-output",
  binarySha256: "a".repeat(64),
  protocolName: "codex-app-server-jsonrpc",
  protocolVersion: "v2",
  schemaFiles: [{ path: "ServerNotification.ts", sha256: "b".repeat(64) }],
} as const

/** One step of a native Codex app-server script over the Run's ledger. */
type Step =
  | { kind: "delta"; itemId: string; delta: string }
  | { kind: "completed"; itemId: string; text: string }
  | { kind: "coarse"; payload: Record<string, unknown> }

const TURN_COMPLETED_KEY = "n-turn-completed"

/**
 * Drives the real ledger with `turn/started`, the given item steps and a
 * successful `turn/completed` (the committed live native terminal).
 */
async function driveNativeTurn(
  ledger: CanonicalRunEventLedger,
  steps: readonly Step[],
): Promise<void> {
  let ordinal = 0
  const nextKey = (prefix: string) => {
    ordinal += 1
    return `${prefix}-${ordinal}`
  }
  const notify = (method: string, params: unknown, key?: string) =>
    ledger.ingestNotification({
      observationKey: key ?? nextKey("n"),
      transportId: "t1",
      receivedAt: "2026-10-01T00:00:00.000Z",
      message: { method, params },
    })
  await notify("turn/started", {
    threadId: "th",
    turn: { id: "tu", status: "inProgress", error: null },
  })
  for (const step of steps) {
    if (step.kind === "delta") {
      await notify("item/agentMessage/delta", {
        threadId: "th",
        turnId: "tu",
        itemId: step.itemId,
        delta: step.delta,
      })
    } else if (step.kind === "completed") {
      await notify("item/completed", {
        threadId: "th",
        turnId: "tu",
        item: { type: "agentMessage", id: step.itemId, text: step.text },
      })
    } else {
      await ledger.ingestRuntimeObservation({
        observationKey: nextKey("coarse"),
        type: "assistant_delta",
        payload: step.payload,
      })
    }
  }
  await notify(
    "turn/completed",
    { threadId: "th", turn: { id: "tu", status: "completed", error: null } },
    TURN_COMPLETED_KEY,
  )
}

type Settled = {
  status: string | undefined
  reasons: string[]
  evidenceKeys: string[]
  events: ReturnType<typeof listAgentJobEvents>
}

function completedPayload(db: Db, jobId: string) {
  const events = listAgentJobEvents(db, jobId)
  const completed = events.filter((event) => event.type === "completed")
  expect(completed).toHaveLength(1)
  const payload = JSON.parse(completed[0].payloadJson) as {
    status?: string
    reasons?: string[]
    evidenceKeys?: string[]
  }
  return {
    status: payload.status,
    reasons: payload.reasons ?? [],
    evidenceKeys: payload.evidenceKeys ?? [],
    events,
  }
}

/** Headless: a native runner settles through runPersistedAgentJob. */
async function settleHeadless(steps: readonly Step[]): Promise<Settled> {
  const db = createAgentJobTestDb()
  const job = await createAgentJob(db, {
    source: "cli",
    runtime: "codex",
    mode: "agent",
    cwd: process.cwd(),
    prompt: "final text output evidence",
  })
  await runPersistedAgentJob({
    db,
    jobId: job.id,
    runner: async (
      _request: unknown,
      observer: AgentRuntimeObserver,
    ): Promise<AgentRuntimeRunResult> => {
      const ledger = observer.runLedger
      if (!ledger) throw new Error("Expected the Run ledger")
      await observer.recordExecutionProvenance?.(CODEX_TUPLE)
      await driveNativeTurn(ledger, steps)
      return {
        status: "succeeded",
        exitCode: 0,
        result: {},
        nativeTerminal: {
          observationKey: TURN_COMPLETED_KEY,
          status: "succeeded",
        },
      }
    },
  })
  return completedPayload(db, job.id)
}

let desktopRuns = 0

/** Desktop: the safe finalizer settles a natural finish of the stream. */
async function settleDesktop(steps: readonly Step[]): Promise<Settled> {
  const db = createAgentJobTestDb()
  db.insert(projects)
    .values({ id: "project-1", name: "Project", path: "/tmp/project" })
    .run()
  db.insert(chats)
    .values({
      id: "chat-1",
      projectId: "project-1",
      worktreePath: "/tmp/project-worktree",
    })
    .run()
  db.insert(subChats).values({ id: "sub-chat-1", chatId: "chat-1" }).run()
  desktopRuns += 1
  const { job } = await createAndStartDesktopAgentJob(db, {
    runtime: "codex",
    mode: "agent",
    chatId: "chat-1",
    subChatId: "sub-chat-1",
    cwd: "/tmp/project-worktree",
    prompt: "Implement",
    runId: `run-final-text-${desktopRuns}`,
  })
  const ledger = await getOrCreateRunEventLedger(db, job)
  await ledger.bindExecutionProvenance(CODEX_TUPLE)
  await driveNativeTurn(ledger, steps)
  await completeDesktopChatAgentJobSafely(db, {
    jobId: job.id,
    runtime: "codex",
    aborted: false,
    reachedNaturalFinish: true,
    sawError: false,
  })
  return completedPayload(db, job.id)
}

function sequenceOf(
  settled: Settled,
  predicate: (type: string, payload: Record<string, unknown>) => boolean,
): number {
  const event = settled.events.find((candidate) =>
    predicate(
      candidate.type,
      JSON.parse(candidate.payloadJson) as Record<string, unknown>,
    ),
  )
  if (!event) throw new Error("Expected a matching committed record")
  return event.sequence
}

const isReconciliation =
  (text: string) => (type: string, payload: Record<string, unknown>) =>
    type === "status" &&
    payload.subtype === "item_reconciliation" &&
    (payload.item as { text?: unknown } | undefined)?.text === text

const HOSTS = [
  ["headless", settleHeadless],
  ["desktop", settleDesktop],
] as const

describe("T4-P1: assistant output evidence from the final item state", () => {
  for (const [host, settle] of HOSTS) {
    test(`${host}: a non-empty delta superseded by an empty final text fails as output_empty despite a native success`, async () => {
      const settled = await settle([
        { kind: "delta", itemId: "msg-1", delta: "draft answer" },
        { kind: "completed", itemId: "msg-1", text: "" },
      ])
      expect(settled.events.some((e) => e.type === "assistant_delta")).toBe(
        true,
      )
      expect(settled.status).toBe("failed")
      expect(settled.reasons).toContain("output_empty")
      const delta = sequenceOf(settled, (type) => type === "assistant_delta")
      expect(settled.evidenceKeys).not.toContain(`record:${delta}`)
    })

    test(`${host}: a completed-only item with non-empty final text succeeds`, async () => {
      const settled = await settle([
        { kind: "completed", itemId: "msg-1", text: "final answer" },
      ])
      expect(settled.status).toBe("succeeded")
      expect(settled.reasons).toEqual([])
      expect(settled.evidenceKeys).toContain(
        `record:${sequenceOf(settled, isReconciliation("final answer"))}`,
      )
    })

    test(`${host}: a streamed item whose final text replaces the deltas cites the final text carrier`, async () => {
      const settled = await settle([
        { kind: "delta", itemId: "msg-1", delta: "draft" },
        { kind: "completed", itemId: "msg-1", text: "final answer" },
      ])
      expect(settled.status).toBe("succeeded")
      const delta = sequenceOf(settled, (type) => type === "assistant_delta")
      expect(settled.evidenceKeys).toContain(
        `record:${sequenceOf(settled, isReconciliation("final answer"))}`,
      )
      expect(settled.evidenceKeys).not.toContain(`record:${delta}`)
    })

    test(`${host}: an empty final item beside an independent non-empty item succeeds`, async () => {
      const settled = await settle([
        { kind: "delta", itemId: "msg-1", delta: "draft answer" },
        { kind: "completed", itemId: "msg-1", text: "" },
        { kind: "completed", itemId: "msg-2", text: "the real answer" },
      ])
      expect(settled.status).toBe("succeeded")
      expect(settled.reasons).toEqual([])
      expect(settled.evidenceKeys).toContain(
        `record:${sequenceOf(settled, isReconciliation("the real answer"))}`,
      )
      const delta = sequenceOf(settled, (type) => type === "assistant_delta")
      expect(settled.evidenceKeys).not.toContain(`record:${delta}`)
    })

    test(`${host}: an item still streaming at the native terminal counts by its materialized text`, async () => {
      const settled = await settle([
        { kind: "delta", itemId: "msg-1", delta: "partial answer" },
      ])
      expect(settled.status).toBe("succeeded")
      expect(settled.evidenceKeys).toContain(
        `record:${sequenceOf(settled, (type) => type === "assistant_delta")}`,
      )
    })

    test(`${host}: coarse assistant output without a native item still counts`, async () => {
      const settled = await settle([
        { kind: "coarse", payload: { text: "coarse answer" } },
      ])
      expect(settled.status).toBe("succeeded")
      expect(settled.evidenceKeys).toContain(
        `record:${sequenceOf(settled, (type) => type === "assistant_delta")}`,
      )
    })
  }

  test("headless: an item-less structured assistant_delta keeps counting", async () => {
    const settled = await settleHeadless([
      { kind: "coarse", payload: { structured: { answer: 42 } } },
    ])
    expect(settled.status).toBe("succeeded")
    const record = sequenceOf(
      settled,
      (type, payload) => type === "assistant_delta" && !("item" in payload),
    )
    expect(settled.evidenceKeys).toContain(`record:${record}`)
  })
})
