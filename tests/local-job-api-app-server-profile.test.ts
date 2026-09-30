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
import { projects } from "../src/main/lib/db/schema"
import { createCodexAppServerHeadlessTaskRunner } from "../src/main/lib/headless/adapters/codex-app-server"
import { LOCAL_JOB_API_VERSION } from "../src/shared/local-job-api"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

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
      expect(apiEvents[4].payload).toMatchObject({
        text: "app-server local job response",
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
