/**
 * Implementer unit tests for the production snapshot-repair caller on the
 * Codex resume path (refactor-canonical-run-event-ledger design "Resume
 * Validation and Snapshot Repair", tasks 6.4, verification gap G3). The
 * acceptance scenarios S35–S37 drive `repairFromSnapshot` directly in the
 * immutable run-event-ledger-provenance-resume.test.ts; these tests pin the
 * caller: only a validated thread/resume response submits its snapshot, with
 * the schema disposition, creator-version source provenance and a target turn
 * only when the Run itself observed that turn.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { DesktopRunRequest } from "../src/main/lib/agent-runtime/desktop-run-request"
import { resolveDesktopPermissionPolicy } from "../src/main/lib/agent-runtime/permission-policy"
import {
  createCanonicalRunEventLedger,
  type RuntimeExecutionProvenance,
} from "../src/main/lib/agent-runtime/run-event-ledger"
import {
  createCodexAppServerAdapter,
  repairFromValidatedResumeSnapshot,
} from "../src/main/lib/codex/app-server-adapter"
import { classifyCodexThreadSnapshot } from "../src/main/lib/codex/app-server-stream-events"
import { committedCodexAssistantText } from "../src/main/lib/codex/desktop-run-persistence"
import { ScriptedCodexAppServerTransport } from "./helpers/codex-app-server-scripted-transport"

type Row = {
  sequence: number
  type: string
  observationKey?: string
  payload?: Record<string, unknown>
}

const RUNTIME_TUPLE: RuntimeExecutionProvenance = {
  kind: "runtime",
  installationId: "inst-codex-0.149.0-resume-snapshot-test",
  runtimeId: "codex",
  adapterSource: "codex-app-server",
  version: "0.149.0",
  executableRef: "exe-resume-snapshot-test",
  binarySha256: "e".repeat(64),
  protocolName: "codex-app-server-jsonrpc",
  protocolVersion: "v2",
  schemaFiles: [
    { path: "codex-app-server/v2/dispositions.json", sha256: "f".repeat(64) },
  ],
}

const SNAPSHOT_VERSIONS = JSON.parse(
  readFileSync(
    join(import.meta.dir, "fixtures/run-event-ledger/snapshot-versions.json"),
    "utf8",
  ),
) as { cases: Array<{ caseId: string; repair: { snapshot: Row["payload"] } }> }

/** The fixture's recognized 0.139.0 thread snapshot (read-only). */
function recognizedThread(): Record<string, unknown> {
  const found = SNAPSHOT_VERSIONS.cases.find(
    (entry) => entry.caseId === "0.139-to-0.149",
  )
  if (!found?.repair.snapshot) throw new Error("snapshot fixture missing")
  return structuredClone(found.repair.snapshot) as Record<string, unknown>
}

function incompatibleThread(): Record<string, unknown> {
  const thread = recognizedThread()
  const turns = thread.turns as Array<Record<string, unknown>>
  ;(turns[0].items as unknown[]).push({ type: "futureItem", id: "x1" })
  return thread
}

function memoryLedger(
  runId: string,
  provenance: unknown = { kind: "pending", runtimeId: "codex" },
) {
  const rows: Row[] = []
  const ledger = createCanonicalRunEventLedger({
    runId,
    runtimeId: "codex",
    provenance,
    durableStore: {
      appendExact(input: { records: unknown[] }) {
        rows.push(...(input.records as Row[]))
        return input.records
      },
      read(_runId: string, after = 0) {
        return rows.filter((row) => row.sequence > after)
      },
    },
  })
  return { ledger, rows }
}

function resumeRequest(
  ledger: unknown,
  resumeSessionId: string,
): DesktopRunRequest {
  return {
    identity: { runId: "run-resume", jobId: "job-resume" },
    context: {
      runtimeId: "codex",
      mode: "plan",
      projectId: "project-1",
      chatId: "chat-1",
      subChatId: "sub-1",
      cwd: "/repo",
    },
    prompt: "continue",
    permissionPolicy: resolveDesktopPermissionPolicy({
      runtimeId: "codex",
      mode: "plan",
      codexAdapterSource: "codex-app-server",
    }),
    providerBinding: { authMode: "runtime-managed" },
    mcp: { status: "skipped", serverNames: [], blockers: [] },
    attachments: [],
    ledger: ledger as DesktopRunRequest["ledger"],
    signal: new AbortController().signal,
    session: { resumeSessionId, parentSessionId: resumeSessionId },
  }
}

async function runResume(threadResponse: (threadId: string) => unknown) {
  const { ledger, rows } = memoryLedger("run-resume")
  const transport = new ScriptedCodexAppServerTransport({
    threadResume: (params) => threadResponse(String(params.threadId)),
  })
  const result = await createCodexAppServerAdapter({
    enabled: true,
    createTransport: () => transport,
    captureExecutionProvenance: async () => RUNTIME_TUPLE,
  }).run(resumeRequest(ledger, "th"))
  await ledger.whenIdle()
  return { result, rows }
}

function statusRows(rows: Row[], subtype: string): Row[] {
  return rows.filter(
    (row) => row.type === "status" && row.payload?.subtype === subtype,
  )
}

describe("classifyCodexThreadSnapshot", () => {
  test("a snapshot of known items is recognized with its turn ids and creator version, without mutating the input", () => {
    const response = { thread: recognizedThread() }
    const before = JSON.stringify(response)
    expect(classifyCodexThreadSnapshot(response)).toEqual({
      schemaDisposition: "recognized",
      turnIds: ["tu-prev"],
      creatorVersion: "0.139.0",
    })
    expect(JSON.stringify(response)).toBe(before)
  })

  test("an item variant outside the pinned table or a malformed turns member is incompatible; no snapshot is null", () => {
    expect(
      classifyCodexThreadSnapshot({ thread: incompatibleThread() }),
    ).toMatchObject({ schemaDisposition: "incompatible", turnIds: ["tu-prev"] })
    expect(
      classifyCodexThreadSnapshot({ thread: { id: "th", turns: {} } }),
    ).toEqual({ schemaDisposition: "incompatible", turnIds: [] })
    expect(
      classifyCodexThreadSnapshot({
        thread: { id: "th", turns: [{ id: "tu", items: [{ type: "plan" }] }] },
      }),
    ).toMatchObject({ schemaDisposition: "incompatible" })
    expect(classifyCodexThreadSnapshot({ thread: { id: "th" } })).toBeNull()
    expect(classifyCodexThreadSnapshot({})).toBeNull()
    expect(classifyCodexThreadSnapshot(null)).toBeNull()
  })
})

describe("Codex resume path snapshot repair", () => {
  test("a validated resume with a recognized snapshot records status/repair before the new turn, with creator-version source provenance and no prior-turn item text", async () => {
    const { result, rows } = await runResume((threadId) => ({
      thread: { ...recognizedThread(), id: threadId, sessionId: threadId },
    }))
    expect(result).toMatchObject({ status: "succeeded", sessionId: "th" })

    const validated = statusRows(rows, "native_resume_validated")
    const repairs = statusRows(rows, "repair")
    const turnStarted = rows.find(
      (row) =>
        row.type === "status" &&
        row.payload?.subtype === "turn_lifecycle" &&
        JSON.stringify(row.payload).includes("turn/started"),
    )
    expect(validated).toHaveLength(1)
    expect(repairs).toHaveLength(1)
    expect(repairs[0].sequence).toBeGreaterThan(validated[0].sequence)
    expect(turnStarted?.sequence ?? 0).toBeGreaterThan(repairs[0].sequence)
    expect(repairs[0].payload).toMatchObject({
      subtype: "repair",
      lossPossible: true,
      repair: {
        source: "snapshot",
        result: "reconciled",
        schemaDisposition: "recognized",
        creatorVersion: "0.139.0",
        sourceProvenance: {
          kind: "runtime",
          runtimeId: "codex",
          version: "0.139.0",
        },
        targetProvenance: {
          installationId: RUNTIME_TUPLE.installationId,
          version: "0.149.0",
        },
      },
    })
    // This Run never observed the snapshot's turn: no target turn and no
    // prior-turn reconciliation enters this Run's assistant history.
    expect(
      (repairs[0].payload?.repair as Record<string, unknown>).targetTurnId,
    ).toBeUndefined()
    expect(JSON.stringify(rows)).not.toContain("final answer from 0.139.0")
    expect(committedCodexAssistantText(rows)).toBe(
      "hello from the scripted turn",
    )
    expect(rows.filter((row) => row.type === "completed")).toEqual([])
  })

  test("an incompatible snapshot records a mismatch repair without guessing item state", async () => {
    const { rows } = await runResume((threadId) => ({
      thread: { ...incompatibleThread(), id: threadId, sessionId: threadId },
    }))
    const repairs = statusRows(rows, "repair")
    expect(repairs).toHaveLength(1)
    expect(repairs[0].payload).toMatchObject({
      lossPossible: true,
      repair: {
        source: "snapshot",
        result: "mismatch",
        schemaDisposition: "incompatible",
      },
    })
    expect(
      (repairs[0].payload?.repair as Record<string, unknown>).evidenceLimits,
    ).toContain("incompatible_schema_policy")
    expect(
      statusRows(rows, "item_reconciliation").filter((row) =>
        JSON.stringify(row.payload).includes('"source":"snapshot"'),
      ),
    ).toEqual([])
  })

  test("a rejected resume response or a response without a turns snapshot submits no repair", async () => {
    const rejected = await runResume(() => ({
      thread: { ...recognizedThread(), id: "another-thread", sessionId: "s" },
    }))
    expect(statusRows(rejected.rows, "native_resume_rejected")).toHaveLength(1)
    expect(statusRows(rejected.rows, "repair")).toEqual([])

    const bare = await runResume((threadId) => ({
      thread: { id: threadId, sessionId: threadId },
    }))
    expect(statusRows(bare.rows, "native_resume_validated")).toHaveLength(1)
    expect(statusRows(bare.rows, "repair")).toEqual([])
  })
})

describe("repairFromValidatedResumeSnapshot", () => {
  const validatedCommit = Promise.resolve([
    { type: "status", payload: { subtype: "native_resume_validated" } },
  ])

  test("pre-seal, a turn this Run observed is the target: the snapshot repairs its item view and never settles the Run", async () => {
    const { ledger, rows } = memoryLedger("run-pre-seal", RUNTIME_TUPLE)
    await ledger.ingestNotification({
      observationKey: "pre-turn",
      transportId: "t1",
      receivedAt: "2026-10-01T00:00:00.000Z",
      message: {
        method: "turn/started",
        params: {
          threadId: "th",
          turn: { id: "tu-prev", status: "inProgress", error: null },
        },
      },
    })
    await ledger.ingestNotification({
      observationKey: "pre-delta",
      transportId: "t1",
      receivedAt: "2026-10-01T00:00:00.001Z",
      message: {
        method: "item/agentMessage/delta",
        params: {
          threadId: "th",
          turnId: "tu-prev",
          itemId: "msg",
          delta: "final",
        },
      },
    })
    await repairFromValidatedResumeSnapshot({
      ledger,
      observationKey: "pre-repair",
      responseCommitted: validatedCommit,
      response: { thread: recognizedThread() },
    })
    const repair = statusRows(rows, "repair")[0]
    expect(repair.payload?.repair).toMatchObject({
      source: "snapshot",
      targetTurnId: "tu-prev",
    })
    expect(
      await ledger.readItem({
        threadId: "th",
        turnId: "tu-prev",
        itemId: "msg",
        channel: "assistant",
        partIndex: 0,
      }),
    ).toMatchObject({
      text: "final answer from 0.139.0",
      reconciliation: { lossPossible: true },
    })
    expect(await ledger.readOutcome()).toBeNull()
  })

  test("post-seal the snapshot becomes a diagnostic late_event carrying the repair metadata", async () => {
    const { ledger, rows } = memoryLedger("run-post-seal", RUNTIME_TUPLE)
    await ledger.settle({
      trigger: {
        kind: "host_result",
        status: "failed",
        observationKey: "post-seal-terminal",
      },
      policy: { denied: false, evidenceKeys: ["policy:none"] },
      output: {
        valid: false,
        empty: true,
        allowEmpty: false,
        evidenceKeys: [],
      },
      postRun: { credentialsSafe: true, evidenceKeys: ["postrun:ok"] },
    })
    const completed = rows.filter((row) => row.type === "completed")
    expect(completed).toHaveLength(1)
    await repairFromValidatedResumeSnapshot({
      ledger,
      observationKey: "post-repair",
      responseCommitted: validatedCommit,
      response: { thread: recognizedThread() },
    })
    await ledger.whenIdle()
    const late = statusRows(rows, "late_event")
    expect(late).toHaveLength(1)
    expect(late[0].payload).toMatchObject({
      diagnosticOnly: true,
      terminalSequence: completed[0].sequence,
      lossPossible: true,
      repair: { source: "snapshot", schemaDisposition: "recognized" },
    })
    expect(rows.filter((row) => row.type === "completed")).toEqual(completed)
    expect(await ledger.readOutcome()).toMatchObject({ status: "failed" })
  })

  test("a response the ledger did not validate is never submitted", async () => {
    const { ledger, rows } = memoryLedger("run-not-validated", RUNTIME_TUPLE)
    expect(
      await repairFromValidatedResumeSnapshot({
        ledger,
        observationKey: "unvalidated-repair",
        responseCommitted: Promise.resolve([
          { type: "status", payload: { subtype: "native_resume_rejected" } },
        ]),
        response: { thread: recognizedThread() },
      }),
    ).toEqual([])
    expect(rows).toEqual([])
  })
})

describe("Codex client response correlation (T2-8 / S-03)", () => {
  test("every client response is recorded once under the transport's wire id; resume validation is unchanged", async () => {
    const { ledger, rows } = memoryLedger("run-wire-ids")
    const transport = new ScriptedCodexAppServerTransport({
      threadResume: (params) => ({
        thread: {
          ...recognizedThread(),
          id: String(params.threadId),
          sessionId: String(params.threadId),
        },
      }),
    })
    const result = await createCodexAppServerAdapter({
      enabled: true,
      createTransport: () => transport,
      captureExecutionProvenance: async () => RUNTIME_TUPLE,
    }).run(resumeRequest(ledger, "th"))
    await ledger.whenIdle()
    expect(result).toMatchObject({ status: "succeeded", sessionId: "th" })

    const wireId = (method: string) =>
      transport.requests.find((entry) => entry.method === method)?.id
    // (The scripted turn/start response arrives after its turn/completed
    // terminal candidate, so it is a buffered late observation here.)
    const responses = statusRows(rows, "protocol_response")
    expect(
      responses.map((row) => [row.payload?.method, row.payload?.jsonRpcId]),
    ).toEqual([
      ["initialize", wireId("initialize")],
      ["mcpServerStatus/list", wireId("mcpServerStatus/list")],
    ])
    for (const row of responses) {
      expect(row.payload?.correlated).toBe(true)
      expect(String(row.payload?.jsonRpcId)).not.toMatch(/^locus-/)
    }
    const validated = statusRows(rows, "native_resume_validated")
    expect(validated).toHaveLength(1)
    expect(validated[0].payload?.jsonRpcId).toBe(wireId("thread/resume"))
    // No thread/started is fabricated for the resumed thread.
    expect(JSON.stringify(rows)).not.toContain('"thread/started"')
  })

  test("a turn/interrupt response is recorded as a protocol_response under its wire id", async () => {
    const { ledger, rows } = memoryLedger("run-interrupt-id")
    const abortController = new AbortController()
    const transport = new ScriptedCodexAppServerTransport({
      turn: async (scripted, threadId) => {
        scripted.emit({
          method: "turn/started",
          params: {
            threadId,
            turn: { id: "turn-1", status: "inProgress", error: null },
          },
        })
        abortController.abort()
        await ledger.whenIdle()
      },
    })
    const request = resumeRequest(ledger, "th")
    const result = await createCodexAppServerAdapter({
      enabled: true,
      createTransport: () => transport,
      captureExecutionProvenance: async () => RUNTIME_TUPLE,
    }).run({ ...request, session: {}, signal: abortController.signal })
    expect(result.status).toBe("canceled")
    await new Promise((resolve) => setTimeout(resolve, 0))
    await ledger.whenIdle()

    const interrupt = transport.requests.find(
      (entry) => entry.method === "turn/interrupt",
    )
    expect(interrupt?.params).toEqual({
      threadId: "thread-1",
      turnId: "turn-1",
    })
    const interruptResponse = statusRows(rows, "protocol_response").find(
      (row) => row.payload?.method === "turn/interrupt",
    )
    expect(interruptResponse?.payload).toMatchObject({
      correlated: true,
      jsonRpcId: interrupt?.id,
    })
  })
})
