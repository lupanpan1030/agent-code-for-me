import { describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DesktopRunRequest } from "../src/main/lib/agent-runtime/desktop-run-request"
import { bindRunExecutionProvenance } from "../src/main/lib/agent-runtime/run-event-ledger-host"
import { createCodexAppServerAdapter } from "../src/main/lib/codex/app-server-adapter"
import { projects } from "../src/main/lib/db/schema"
import { createCodexAppServerHeadlessTaskRunner } from "../src/main/lib/headless/adapters/codex-app-server"
import {
  cancelAgentJob,
  listAgentJobEvents,
} from "../src/main/lib/headless/job-store"
import { LOCAL_JOB_API_VERSION } from "../src/shared/local-job-api"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"
import {
  type CodexAppServerScript,
  ScriptedCodexAppServerTransport,
} from "./helpers/codex-app-server-scripted-transport"

const appServerRuns: DesktopRunRequest[] = []

const FAKE_APP_SERVER_PROVENANCE = {
  kind: "runtime",
  installationId: "inst-codex-0.139.0-test-app-server",
  runtimeId: "codex",
  adapterSource: "codex-app-server",
  version: "0.139.0",
  executableRef: "exe-test-app-server",
  binarySha256: "a".repeat(64),
  protocolName: "codex-app-server-jsonrpc",
  protocolVersion: "v2",
  schemaFiles: [
    { path: "codex-app-server/v2/dispositions.json", sha256: "b".repeat(64) },
  ],
} as const

const {
  admitLocalJobApiInitialArtifacts,
  createLocalJobApiJob,
  createLocalJobApiTerminalArtifacts,
  getLocalJobApiEvents,
  toLocalJobApiResultEnvelope,
} = await import("../src/main/lib/headless/local-job-api")
const { runPersistedAgentJob } = await import(
  "../src/main/lib/headless/job-runner"
)
const { assertLocalJobApiCreateRequest } = await import(
  "../src/shared/local-job-api"
)

const fakeAppServerRunner = createCodexAppServerHeadlessTaskRunner({
  createDesktopAdapter: () => ({
    metadata: {
      runtimeId: "codex",
      source: "codex-app-server",
      label: "Codex app-server adapter",
      temporaryFallback: false,
    },
    async run(request: DesktopRunRequest) {
      appServerRuns.push(request)
      // Like the real adapter, ingest into the Run's host ledger (the
      // headless wrapper hands it over as request.ledger).
      const ledger = request.ledger
      if (!ledger) throw new Error("Expected the Run ledger")
      await ledger.appendSystemEvent({
        observationKey: "fake-app-server:started",
        type: "status",
        payload: {
          status: "desktop_runtime_adapter_started",
          adapterSource: "codex-app-server",
        },
      })
      await bindRunExecutionProvenance(ledger, FAKE_APP_SERVER_PROVENANCE)
      await ledger.ingestRuntimeObservation({
        observationKey: "fake-app-server:assistant",
        type: "assistant_delta",
        payload: { text: "app-server local job response" },
      })
      await ledger.ingestRuntimeObservation({
        observationKey: "fake-app-server:usage",
        type: "usage_update",
        payload: {
          inputTokens: 5,
          outputTokens: 7,
          totalTokens: 12,
        },
      })
      return {
        status: "succeeded",
        sessionId: "app-server-session-1",
        usage: {
          inputTokens: 5,
          outputTokens: 7,
          totalTokens: 12,
        },
      }
    },
  }),
})

function seedProject(
  db: ReturnType<typeof createAgentJobTestDb>,
  path: string,
) {
  db.insert(projects)
    .values({
      id: "project-1",
      name: "Policy Grant Project",
      path,
    })
    .run()
}

describe("Local Job API Codex app-server profile", () => {
  test("runs only when policy-grant profile is explicit and persists replay artifacts", async () => {
    appServerRuns.length = 0
    const db = createAgentJobTestDb()
    const projectRoot = realpathSync(
      mkdtempSync(join(tmpdir(), "locus-app-server-")),
    )
    try {
      const packageDir = join(projectRoot, "package")
      mkdirSync(packageDir)
      seedProject(db, projectRoot)
      const request = assertLocalJobApiCreateRequest({
        apiVersion: LOCAL_JOB_API_VERSION,
        consumer: {
          id: "docs-workbench",
          runExternalId: "app-server-001",
        },
        project: {
          cwd: packageDir,
        },
        runtime: {
          id: "codex",
          executionProfile: "policy-grant",
          policyGrant: {
            scopes: ["workspace:file-write"],
          },
        },
        mode: "agent",
        prompt: {
          text: "Use the gated app-server adapter.",
        },
        artifacts: {
          baseDir: join(packageDir, ".locus", "runs"),
          writePolicy: "metadata-only",
        },
      })
      const prepared = await createLocalJobApiJob(db, request, "test")
      // Initial run-dir files are admitted by the run artifact owner; the
      // terminal files are prepared at the one completed.
      await admitLocalJobApiInitialArtifacts({ db, prepared })
      const terminal = createLocalJobApiTerminalArtifacts({
        db,
        runDir: prepared.runDir,
        jobId: prepared.job.id,
      })

      const result = await runPersistedAgentJob({
        db,
        jobId: prepared.job.id,
        runner: fakeAppServerRunner,
        terminalArtifacts: terminal.preparer,
      })
      const finalArtifacts = terminal.artifacts()
      const apiEvents = getLocalJobApiEvents(db, prepared.job.id)
      const resultEnvelope = toLocalJobApiResultEnvelope(
        result.job,
        finalArtifacts,
      )

      expect(appServerRuns).toHaveLength(1)
      expect(appServerRuns[0].context.cwd).toBe(packageDir)
      expect(appServerRuns[0].permissionPolicy.runtimeMapping).toMatchObject({
        runtime: "codex",
        adapterSource: "codex-app-server",
        approvalGateFailure: "fail-closed",
      })
      expect(result.job).toMatchObject({
        status: "succeeded",
        runtime: "codex",
        source: "api",
        exitCode: 0,
      })
      expect(resultEnvelope.result).toMatchObject({
        adapterSource: "codex-app-server",
        sessionId: "app-server-session-1",
      })
      expect(apiEvents.map((event) => event.type)).toEqual([
        "job_created",
        "artifact_created",
        "job_started",
        "status",
        "assistant_delta",
        "usage_update",
        "completed",
      ])
      expect(apiEvents[3].payload).toMatchObject({
        status: "desktop_runtime_adapter_started",
        adapterSource: "codex-app-server",
      })
      expect(apiEvents[4].payload).toEqual({
        text: "app-server local job response",
        item: {
          correlationKey: expect.stringMatching(/^corr-[0-9a-f]+$/),
          channel: "assistant",
          partIndex: 0,
        },
      })
      expect(apiEvents[5].payload).toMatchObject({
        inputTokens: 5,
        outputTokens: 7,
      })
      expect(prepared.runDir).toBeTruthy()
      const runDir = prepared.runDir
      if (!runDir) throw new Error("Expected an artifact run directory")
      expect(existsSync(join(runDir.path, "request.json"))).toBe(true)
      expect(existsSync(join(runDir.path, "events.jsonl"))).toBe(true)
      expect(existsSync(join(runDir.path, "result.json"))).toBe(true)
      expect(readFileSync(join(runDir.path, "result.json"), "utf-8")).toContain(
        "codex-app-server",
      )
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })
})

type TestDb = ReturnType<typeof createAgentJobTestDb>

/**
 * Drives one API app-server Run through the real Codex app-server adapter
 * over a scripted transport whose `close()` ends the child like the stdio
 * transport (every still-attached exit handler fires).
 */
async function runScriptedAppServerApiJob(
  runExternalId: string,
  script: (context: {
    db: TestDb
    jobId: string
    abort: () => void
  }) => CodexAppServerScript,
) {
  const db = createAgentJobTestDb()
  const projectRoot = realpathSync(
    mkdtempSync(join(tmpdir(), "locus-app-server-exit-")),
  )
  const packageDir = join(projectRoot, "package")
  mkdirSync(packageDir)
  seedProject(db, projectRoot)
  const request = assertLocalJobApiCreateRequest({
    apiVersion: LOCAL_JOB_API_VERSION,
    consumer: { id: "docs-workbench", runExternalId },
    project: { cwd: packageDir },
    runtime: {
      id: "codex",
      executionProfile: "policy-grant",
      policyGrant: { scopes: ["workspace:file-write"] },
    },
    mode: "agent",
    prompt: { text: "Use the gated app-server adapter." },
    artifacts: {
      baseDir: join(packageDir, ".locus", "runs"),
      writePolicy: "metadata-only",
    },
  })
  const prepared = await createLocalJobApiJob(db, request, "test")
  await admitLocalJobApiInitialArtifacts({ db, prepared })
  const terminal = createLocalJobApiTerminalArtifacts({
    db,
    runDir: prepared.runDir,
    jobId: prepared.job.id,
  })
  const abortController = new AbortController()
  const transports: ScriptedCodexAppServerTransport[] = []
  const runner = createCodexAppServerHeadlessTaskRunner({
    createDesktopAdapter: () =>
      createCodexAppServerAdapter({
        enabled: true,
        createTransport: () => {
          const transport = new ScriptedCodexAppServerTransport({
            exitOnClose: true,
            ...script({
              db,
              jobId: prepared.job.id,
              abort: () => abortController.abort(),
            }),
          })
          transports.push(transport)
          return transport
        },
        captureExecutionProvenance: async () => FAKE_APP_SERVER_PROVENANCE,
      }),
  })
  const result = await runPersistedAgentJob({
    db,
    jobId: prepared.job.id,
    runner,
    terminalArtifacts: terminal.preparer,
    signal: abortController.signal,
  })
  const runDir = prepared.runDir?.path
  if (!runDir) throw new Error("Expected an artifact run directory")
  const events = listAgentJobEvents(db, prepared.job.id).map((event) => ({
    sequence: event.sequence,
    type: event.type,
    factKey: event.factKey,
    payload: JSON.parse(event.payloadJson) as Record<string, unknown>,
  }))
  return {
    db,
    projectRoot,
    runDir,
    result,
    events,
    transports,
    envelope: toLocalJobApiResultEnvelope(result.job, terminal.artifacts()),
  }
}

function frozenEventTypes(runDir: string): string[] {
  return readFileSync(join(runDir, "events.jsonl"), "utf-8")
    .trim()
    .split("\n")
    .map((line) => (JSON.parse(line) as { type: string }).type)
}

describe("Local Job API app-server terminal projection (T2-2 / S-01)", () => {
  test("a transport that dies before turn/completed settles interrupted with the host projection and final files", async () => {
    const run = await runScriptedAppServerApiJob("app-server-exit-001", () => ({
      turn: async (transport, threadId) => {
        transport.emit({
          method: "turn/started",
          params: {
            threadId,
            turn: { id: "turn-1", status: "inProgress", error: null },
          },
        })
        transport.emit({
          method: "item/agentMessage/delta",
          params: {
            threadId,
            turnId: "turn-1",
            itemId: "item-1",
            delta: "partial answer",
          },
        })
        transport.emitExit(new Error("Codex app-server exited unexpectedly"))
      },
    }))
    try {
      const { result, events, envelope, runDir } = run
      expect(result.job.status).toBe("interrupted")
      const completed = events.filter((event) => event.type === "completed")
      expect(completed).toHaveLength(1)
      expect(completed[0].payload).toMatchObject({
        status: "interrupted",
        synthetic: { source: "transport_exit" },
      })
      expect(result.job.errorCode).toBe("transport_exit")
      expect(result.job.errorMessage).toContain("transport_exit")
      expect(result.job.resultJson).not.toBeNull()
      expect(JSON.parse(result.job.resultJson ?? "null")).toMatchObject({
        resolvedProvider: expect.any(Object),
      })
      expect(envelope.diagnostics).toEqual([
        { code: "transport_exit", message: result.job.errorMessage },
      ])
      for (const name of [
        "request.json",
        "events.jsonl",
        "result.json",
        "artifacts.json",
      ]) {
        expect(existsSync(join(runDir, name))).toBe(true)
      }
      const frozen = frozenEventTypes(runDir)
      expect(frozen.at(-1)).toBe("completed")
      expect(frozen.filter((type) => type === "completed")).toHaveLength(1)
      const frozenResult = JSON.parse(
        readFileSync(join(runDir, "result.json"), "utf-8"),
      )
      expect(frozenResult).toMatchObject({
        status: "interrupted",
        diagnostics: [{ code: "transport_exit" }],
      })
      // The runner's own later settle becomes a competing-terminal late
      // diagnostic after the seal.
      const late = events.filter(
        (event) =>
          event.type === "status" && event.payload.subtype === "late_event",
      )
      expect(late.map((event) => event.payload.observation)).toContainEqual(
        expect.objectContaining({ kind: "competing_terminal" }),
      )
      expect(events.at(-1)?.type).toBe("status")
    } finally {
      rmSync(run.projectRoot, { recursive: true, force: true })
    }
  })

  test("an initialize error with the child alive settles failed, not a transport-exit interrupt", async () => {
    const run = await runScriptedAppServerApiJob("app-server-init-001", () => ({
      initializeError: { code: -32600, message: "initialize rejected" },
    }))
    try {
      const { result, events, envelope, runDir, transports } = run
      expect(transports).toHaveLength(1)
      expect(transports[0].closed).toBe(true)
      expect(result.job.status).toBe("failed")
      expect(result.exitCode).toBe(1)
      expect(result.job.errorCode).toBe("codex_app_server_failed")
      expect(result.job.errorMessage).toContain("initialize rejected")
      expect(envelope.diagnostics).toEqual([
        {
          code: "codex_app_server_failed",
          message: result.job.errorMessage,
        },
      ])
      const completed = events.filter((event) => event.type === "completed")
      expect(completed).toHaveLength(1)
      expect(completed[0].payload.status).toBe("failed")
      expect(completed[0].payload.synthetic).toBeUndefined()
      expect(JSON.stringify(events)).not.toContain("transport_exit")
      for (const name of [
        "request.json",
        "events.jsonl",
        "result.json",
        "artifacts.json",
      ]) {
        expect(existsSync(join(runDir, name))).toBe(true)
      }
      expect(frozenEventTypes(runDir).at(-1)).toBe("completed")
    } finally {
      rmSync(run.projectRoot, { recursive: true, force: true })
    }
  })

  test("an API cancel during the turn settles canceled with exit 5", async () => {
    const run = await runScriptedAppServerApiJob(
      "app-server-cancel-001",
      ({ db, jobId, abort }) => ({
        turn: async (transport, threadId) => {
          transport.emit({
            method: "turn/started",
            params: {
              threadId,
              turn: { id: "turn-1", status: "inProgress", error: null },
            },
          })
          await cancelAgentJob(db, jobId, { requestedBy: "api" })
          abort()
        },
      }),
    )
    try {
      const { result, events, runDir } = run
      expect(result.job.status).toBe("canceled")
      expect(result.exitCode).toBe(5)
      expect(result.job.errorCode).toBe("job_canceled")
      const completed = events.filter((event) => event.type === "completed")
      expect(completed).toHaveLength(1)
      expect(completed[0].payload.status).toBe("canceled")
      expect(completed[0].payload.synthetic).not.toMatchObject({
        source: "transport_exit",
      })
      expect(JSON.stringify(events)).not.toContain("transport_exit")
      expect(frozenEventTypes(runDir).at(-1)).toBe("completed")
    } finally {
      rmSync(run.projectRoot, { recursive: true, force: true })
    }
  })
})

describe("Local Job API app-server native terminal evidence (T2-7 / S-02)", () => {
  const turnNotifications =
    (turn: Record<string, unknown>) => (threadId: string) => [
      {
        method: "turn/started",
        params: {
          threadId,
          turn: { id: "turn-1", status: "inProgress", error: null },
        },
      },
      {
        method: "item/agentMessage/delta",
        params: {
          threadId,
          turnId: "turn-1",
          itemId: "item-1",
          delta: "an answer",
        },
      },
      {
        method: "turn/completed",
        params: { threadId, turn: { id: "turn-1", ...turn } },
      },
    ]

  function nativeTerminalLink(
    events: Awaited<ReturnType<typeof runScriptedAppServerApiJob>>["events"],
  ) {
    const turnCompleted = events.find(
      (event) =>
        event.type === "status" &&
        event.payload.subtype === "turn_lifecycle" &&
        event.payload.terminalCandidate === true,
    )
    const completed = events.filter((event) => event.type === "completed")
    expect(turnCompleted?.factKey).toMatch(/:0$/)
    expect(completed).toHaveLength(1)
    return {
      turnCompletedKey: String(turnCompleted?.factKey).replace(/:0$/, ""),
      completed: completed[0],
    }
  }

  test("a failed turn settles from the live native terminal with its code", async () => {
    const run = await runScriptedAppServerApiJob(
      "app-server-native-001",
      () => ({
        turnNotifications: turnNotifications({
          status: "failed",
          error: { message: "model overloaded", code: "server_overloaded" },
        }),
      }),
    )
    try {
      const { result } = run
      const { turnCompletedKey, completed } = nativeTerminalLink(run.events)
      expect(result.job.status).toBe("failed")
      expect(completed.payload.reasons).toContain("native_failed")
      expect(completed.payload.reasons).not.toContain("host_failed")
      expect(completed.payload.code).toBe("server_overloaded")
      // The settlement is keyed on the committed turn/completed observation.
      expect(completed.factKey).toBe(`settle:${turnCompletedKey}:0`)
    } finally {
      rmSync(run.projectRoot, { recursive: true, force: true })
    }
  })

  test("a completed turn settles succeeded from the live native terminal", async () => {
    const run = await runScriptedAppServerApiJob(
      "app-server-native-002",
      () => ({
        turnNotifications: turnNotifications({
          status: "completed",
          error: null,
        }),
      }),
    )
    try {
      const { turnCompletedKey, completed } = nativeTerminalLink(run.events)
      expect(run.result.job.status).toBe("succeeded")
      expect(completed.payload.reasons).toBeUndefined()
      expect(completed.factKey).toBe(`settle:${turnCompletedKey}:0`)
    } finally {
      rmSync(run.projectRoot, { recursive: true, force: true })
    }
  })

  test("an adapter failure before any native terminal stays host evidence", async () => {
    const run = await runScriptedAppServerApiJob(
      "app-server-native-003",
      () => ({
        initializeError: { code: -32600, message: "initialize rejected" },
      }),
    )
    try {
      const completed = run.events.find((event) => event.type === "completed")
      expect(completed?.payload.reasons).toContain("host_failed")
      expect(completed?.payload.reasons).not.toContain("native_failed")
      expect(completed?.factKey).toMatch(/^settle:runner-result:/)
    } finally {
      rmSync(run.projectRoot, { recursive: true, force: true })
    }
  })
})
