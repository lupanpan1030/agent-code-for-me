/**
 * Implementer unit tests for the desktop Run request contract (refactor-
 * canonical-run-event-ledger core scenarios S08 "Adapter receives desktop
 * request" and S09 "Adapter emits normalized events"; red-receipt §6
 * implementer-unit: desktop request ledger ports and desktop-runner ledger
 * injection), driven by tests/fixtures/run-event-ledger-units/
 * desktop-request.json through the Claude runtime-startup request factory, a
 * recording adapter reached as the runtime route catalog's typed Claude
 * desktop delegate (refactor-unified-runtime-route-catalog D5) and the Run's
 * host ledger over the SQLite store.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { DesktopRunRequest } from "../src/main/lib/agent-runtime/desktop-run-request"
import {
  type DesktopRuntimeAdapter,
  recordDesktopRuntimeAdapterStarted,
} from "../src/main/lib/agent-runtime/desktop-runner"
import { resolveDesktopPermissionPolicy } from "../src/main/lib/agent-runtime/permission-policy"
import type { LedgerRecord } from "../src/main/lib/agent-runtime/run-event-ledger"
import {
  getOrCreateRunEventLedger,
  releaseRunEventLedger,
} from "../src/main/lib/agent-runtime/run-event-ledger-host"
import { validateRuntimeRouteCatalog } from "../src/main/lib/agent-runtime/runtime-route-catalog"
import { resolveClaudeAgentSdkDesktopRouteDelegate } from "../src/main/lib/claude/agent-sdk-desktop-route"
import { createClaudeDesktopRunRequestFromRuntimeStartup } from "../src/main/lib/claude/desktop-run-request"
import {
  createAgentJob,
  listAgentJobEvents,
  startAgentJob,
} from "../src/main/lib/headless/job-store"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

type Json = Record<string, unknown>
type Fixture = {
  secretHints: string[]
  rawSentinels: string[]
  startup: Json & {
    runId: string
    streamId: string
    mode: "agent"
    prompt: string
    cwd: string
    chatId: string
    subChatId: string
    projectId: string
  }
  expected: Json & { identity: Json }
  events: Array<{ category: string; type: string; payload: Json }>
}

const FIXTURE = JSON.parse(
  readFileSync(
    join(
      import.meta.dir,
      "fixtures/run-event-ledger-units/desktop-request.json",
    ),
    "utf8",
  ),
) as Fixture

const RUNTIME_STREAM_KEYS = [
  '"text-delta"',
  '"tool-input-available"',
  '"stream_event"',
  "content_block_delta",
]

async function desktopRun() {
  const db = createAgentJobTestDb()
  const job = await createAgentJob(db, {
    source: "desktop",
    runtime: "claude-code",
    mode: FIXTURE.startup.mode,
    cwd: FIXTURE.startup.cwd,
    prompt: FIXTURE.startup.prompt,
  })
  await startAgentJob(db, {
    jobId: job.id,
    workerId: "desktop-worker",
    workerPid: null,
  })
  const trace: LedgerRecord[] = []
  const ledger = await getOrCreateRunEventLedger(db, job, {
    secretHints: FIXTURE.secretHints,
    projections: [
      {
        name: "recording-trace",
        transientCursor: 0,
        deliver: (record) => {
          trace.push(record)
        },
      },
    ],
  })
  const signal = new AbortController().signal
  const permissionPolicy = resolveDesktopPermissionPolicy({
    runtimeId: "claude-code",
    mode: FIXTURE.startup.mode,
  })
  const request = createClaudeDesktopRunRequestFromRuntimeStartup({
    ...(FIXTURE.startup as never),
    jobId: job.id,
    preflight: {
      kind: "project",
      cwd: FIXTURE.startup.cwd,
      chat: { id: FIXTURE.startup.chatId },
      subChat: { id: FIXTURE.startup.subChatId },
      project: { id: FIXTURE.startup.projectId, path: FIXTURE.startup.cwd },
    } as never,
    permissionPolicy,
    signal,
    ledger,
  })
  return { db, job, ledger, trace, request, signal, permissionPolicy }
}

function recordingAdapter(
  onRun: (request: DesktopRunRequest) => Promise<void>,
): DesktopRuntimeAdapter {
  return {
    metadata: {
      runtimeId: "claude-code",
      source: "claude-agent-sdk",
      label: "Recording desktop adapter",
      temporaryFallback: false,
    },
    async run(request) {
      await onRun(request)
      return { status: "succeeded" }
    },
  }
}

/**
 * The recording adapter as the catalog's typed Claude desktop delegate: a
 * validated test catalog over the production table whose Claude desktop
 * factory reference resolves to the recording leaf.
 */
function catalogDesktopDelegate(
  adapter: DesktopRuntimeAdapter,
  request: DesktopRunRequest,
): (request: DesktopRunRequest) => ReturnType<DesktopRuntimeAdapter["run"]> {
  const validated = validateRuntimeRouteCatalog(undefined, {
    lookupAgentFactory: (ref: unknown) =>
      ref === "desktop:claude-agent-sdk"
        ? (input: { request: DesktopRunRequest }) => adapter.run(input.request)
        : () => Promise.reject(new Error(`unexpected leaf ${String(ref)}`)),
  })
  if (!validated.ok) throw new Error("test catalog is invalid")
  const delegate = resolveClaudeAgentSdkDesktopRouteDelegate(
    request,
    validated.catalog,
  )
  return (runRequest) => delegate({ request: runRequest } as never)
}

/** The request as the adapter sees it, without the host ledger object. */
function capturedRequestJson(request: DesktopRunRequest): string {
  const { ledger: _ledger, signal: _signal, ...rest } = request
  return JSON.stringify(rest)
}

describe("S08 adapter receives desktop request (desktop-request.json)", () => {
  test("the catalog delegate hands the recording adapter identity, verified context, provider metadata, policy, MCP readiness, attachments, signal, session and the ledger ports, without raw tokens, headers, renderer env or secret hints", async () => {
    const run = await desktopRun()
    let received: DesktopRunRequest | null = null
    const runDelegate = catalogDesktopDelegate(
      recordingAdapter(async (request) => {
        received = request
      }),
      run.request,
    )

    await runDelegate(run.request)
    releaseRunEventLedger(run.db, run.job.id)

    const request = received as unknown as DesktopRunRequest
    expect(request.identity).toMatchObject({
      ...FIXTURE.expected.identity,
      jobId: run.job.id,
    })
    expect(request.context).toEqual(FIXTURE.expected.context)
    expect(request.providerBinding).toMatchObject(
      FIXTURE.expected.providerBinding as Json,
    )
    expect(request.permissionPolicy).toBe(run.permissionPolicy)
    expect(request.mcp).toEqual(FIXTURE.expected.mcp)
    expect(request.attachments).toEqual(FIXTURE.expected.attachments)
    expect(request.session).toEqual(FIXTURE.expected.session)
    expect(request.signal).toBe(run.signal)
    // Ledger ingress ports and the committed-record (trace) ports.
    expect(request.ledger).toBe(run.ledger)
    for (const port of [
      "appendSystemEvent",
      "ingestRuntimeObservation",
      "ingestNotification",
      "ingestResponse",
      "ingestClaudeMessage",
      "read",
      "attachProjection",
    ]) {
      expect(typeof (request.ledger as unknown as Json)[port]).toBe("function")
    }
    const captured = capturedRequestJson(request)
    for (const sentinel of FIXTURE.rawSentinels) {
      expect(captured).not.toContain(sentinel)
    }
    for (const key of ["headers", "oauthRefreshToken", '"env"', '"token"']) {
      expect(captured).not.toContain(key)
    }
  })
})

describe("S09 adapter emits normalized events (desktop-request.json)", () => {
  test("a fake adapter submitting the fixture categories through its injected ports yields committed RunEvent records to the recording trace, redacted by the host, with the original signal retained", async () => {
    const run = await desktopRun()
    let signalSeen: AbortSignal | null = null
    const adapter = recordingAdapter(async (request) => {
      signalSeen = request.signal
      const metadata = adapter.metadata
      await recordDesktopRuntimeAdapterStarted(request, metadata)
      for (const [index, event] of FIXTURE.events.entries()) {
        await request.ledger?.ingestRuntimeObservation({
          observationKey: `desktop-request:${index}`,
          type: event.type,
          payload: event.payload,
        })
      }
    })
    const runDelegate = catalogDesktopDelegate(adapter, run.request)

    const result = await runDelegate(run.request)
    await run.ledger.whenIdle()
    releaseRunEventLedger(run.db, run.job.id)

    expect(result).toEqual({ status: "succeeded" })
    expect(signalSeen).toBe(run.signal)
    const persisted = listAgentJobEvents(run.db, run.job.id)
    expect(run.trace.map((record) => record.sequence)).toEqual(
      persisted.map((row) => row.sequence),
    )
    const byType = run.trace.map((record) => record.type)
    for (const event of FIXTURE.events) {
      expect(byType).toContain(event.type)
    }
    expect(byType).toContain("status")
    for (const record of run.trace) {
      expect(record.runId).toBe(run.job.id)
      expect(record.runtimeId).toBe("claude-code")
      expect(typeof record.sequence).toBe("number")
      expect(record.payload).not.toBeNull()
    }
    const serialized = JSON.stringify(run.trace)
    for (const key of RUNTIME_STREAM_KEYS) {
      expect(serialized).not.toContain(key)
    }
    for (const hint of FIXTURE.secretHints) {
      expect(serialized).not.toContain(hint)
    }
    expect(serialized).toContain("is near expiry")
    // One committed record per submitted category, plus the host's
    // adapter-started fact and the lifecycle records.
    expect(
      run.trace.filter((record) =>
        FIXTURE.events.some(
          (event) => event.type === record.type && event.type !== "status",
        ),
      ),
    ).toHaveLength(
      FIXTURE.events.filter((event) => event.type !== "status").length,
    )
  })
})
