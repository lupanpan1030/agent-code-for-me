/**
 * Implementer unit tests for native artifact candidates (refactor-canonical-
 * run-event-ledger design "Artifacts and Terminal Commit Order", the
 * codex-runtime-parity disposition rows for `turn/diff/updated`,
 * `imageGeneration.savedPath` and `fileChange`, proposal artifact roles
 * `native-file` / `native-image` / `native-diff`; verification gap G2).
 * The acceptance scenarios S28/S29 drive the artifact owner directly in the
 * immutable run-event-ledger-terminal.test.ts; these tests pin the Codex
 * evidence decoder, the owner's roles and staging, the host candidate sink
 * and the production path from the Codex app-server adapter through an API
 * run's admitted run directory to its terminal manifest.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import {
  admitRunArtifactCandidate,
  admitRunArtifactContent,
  type RunArtifactRunDir,
} from "../src/main/lib/agent-runtime/run-artifacts"
import {
  createCanonicalRunEventLedger,
  type RuntimeExecutionProvenance,
} from "../src/main/lib/agent-runtime/run-event-ledger"
import { createRunArtifactCandidateSink } from "../src/main/lib/agent-runtime/run-event-ledger-host"
import { createCodexAppServerAdapter } from "../src/main/lib/codex/app-server-adapter"
import { codexNativeArtifactEvidence } from "../src/main/lib/codex/app-server-stream-events"
import { projects } from "../src/main/lib/db/schema"
import {
  closeStableDirectory,
  openStableDirectory,
} from "../src/main/lib/filesystem/stable-directory"
import { createCodexAppServerHeadlessTaskRunner } from "../src/main/lib/headless/adapters/codex-app-server"
import { HEADLESS_CLI_MARKER } from "../src/main/lib/headless/cli-args"
import { runHeadlessCliCommand } from "../src/main/lib/headless/cli-dispatcher"
import { listAgentJobEvents } from "../src/main/lib/headless/job-store"
import { localJobApiNativeArtifacts } from "../src/main/lib/headless/local-job-api"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"
import {
  type CodexAppServerScript,
  ScriptedCodexAppServerTransport,
} from "./helpers/codex-app-server-scripted-transport"

type Row = {
  sequence: number
  type: string
  payload?: Record<string, unknown>
}

const SECRET = "provider-secret-123"
const RUNTIME_TUPLE: RuntimeExecutionProvenance = {
  kind: "runtime",
  installationId: "inst-codex-native-artifacts-test",
  runtimeId: "codex",
  adapterSource: "codex-app-server",
  version: "0.139.0",
  executableRef: "exe-native-artifacts-test",
  binarySha256: "a".repeat(64),
  protocolName: "codex-app-server-jsonrpc",
  protocolVersion: "v2",
  schemaFiles: [
    { path: "codex-app-server/v2/dispositions.json", sha256: "b".repeat(64) },
  ],
}

const cleanup: Array<() => void> = []
afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.()
})

function tempDir(prefix: string): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

function runDirHandle(path: string): RunArtifactRunDir {
  const handle = Object.assign(openStableDirectory(path, "Artifact run"), {
    fileReceipts: new Map(),
  })
  cleanup.push(() => {
    if (!handle.closed) closeStableDirectory(handle)
  })
  return handle
}

function memoryLedger(
  runId: string,
  provenance: unknown = RUNTIME_TUPLE,
  secretHints: string[] = [SECRET],
) {
  const rows: Row[] = []
  const refs: unknown[] = []
  const ledger = createCanonicalRunEventLedger({
    runId,
    runtimeId: "codex",
    provenance,
    redactionContext: { secretHints },
    durableStore: {
      appendExact(input: { records: unknown[]; artifactRefs?: unknown[] }) {
        rows.push(...(input.records as Row[]))
        refs.push(...(input.artifactRefs ?? []))
        return input.records
      },
      read(_runId: string, after = 0) {
        return rows.filter((row) => row.sequence > after)
      },
    },
  })
  return { ledger, rows, refs }
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

function artifactsOf(rows: Row[]): Array<Record<string, unknown>> {
  return rows
    .filter((row) => row.type === "artifact_created")
    .flatMap(
      (row) => (row.payload?.artifacts as Array<Record<string, unknown>>) ?? [],
    )
}

function admissionsOf(rows: Row[]): Array<Record<string, unknown>> {
  return rows
    .filter(
      (row) =>
        row.type === "status" && row.payload?.subtype === "artifact_admission",
    )
    .map((row) => row.payload as Record<string, unknown>)
}

const SUCCESS_EVIDENCE = {
  trigger: {
    kind: "host_result" as const,
    status: "succeeded",
    observationKey: "native-artifacts-terminal",
  },
  policy: { denied: false, evidenceKeys: ["policy:none"] },
  output: {
    valid: true,
    empty: false,
    allowEmpty: false,
    evidenceKeys: ["output:test"],
  },
  postRun: { credentialsSafe: true, evidenceKeys: ["postrun:ok"] },
}

describe("codexNativeArtifactEvidence", () => {
  test("routes imageGeneration.savedPath, completed fileChange paths and turn diffs to candidate evidence only", () => {
    expect(
      codexNativeArtifactEvidence({
        method: "item/completed",
        params: {
          threadId: "th",
          turnId: "tu",
          item: {
            type: "imageGeneration",
            id: "img-1",
            status: "completed",
            revisedPrompt: "a cat",
            result: "",
            savedPath: "/codex-home/generated/cat.png",
          },
        },
      }),
    ).toEqual([
      {
        role: "native-image",
        path: "/codex-home/generated/cat.png",
        sourceKey: "item:img-1",
      },
    ])
    expect(
      codexNativeArtifactEvidence({
        method: "item/completed",
        params: {
          threadId: "th",
          turnId: "tu",
          item: {
            type: "fileChange",
            id: "fc-1",
            status: "completed",
            changes: [
              { path: "src/a.ts", kind: { type: "add" }, diff: "+a" },
              { path: "src/b.ts", kind: { type: "delete" }, diff: "-b" },
              {
                path: "src/c.ts",
                kind: { type: "update", move_path: "src/d.ts" },
                diff: "",
              },
              { path: "src/e.ts", kind: "update", diff: "" },
            ],
          },
        },
      }),
    ).toEqual([
      { role: "native-file", path: "src/a.ts", sourceKey: "item:fc-1:0" },
      { role: "native-file", path: "src/d.ts", sourceKey: "item:fc-1:2" },
      { role: "native-file", path: "src/e.ts", sourceKey: "item:fc-1:3" },
    ])
    expect(
      codexNativeArtifactEvidence({
        method: "turn/diff/updated",
        params: { threadId: "th", turnId: "tu", diff: "--- a/x\n+++ b/x\n" },
      }),
    ).toEqual([
      { role: "native-diff", turnId: "tu", diff: "--- a/x\n+++ b/x\n" },
    ])
  })

  test("started items, unfinished file changes, missing paths, empty diffs and other methods produce no evidence", () => {
    const none = [
      {
        method: "item/started",
        params: {
          item: { type: "imageGeneration", id: "img", savedPath: "/x.png" },
        },
      },
      {
        method: "item/completed",
        params: {
          item: { type: "imageGeneration", id: "img", savedPath: null },
        },
      },
      {
        method: "item/completed",
        params: {
          item: {
            type: "fileChange",
            id: "fc",
            status: "failed",
            changes: [{ path: "a", kind: { type: "add" } }],
          },
        },
      },
      {
        method: "turn/diff/updated",
        params: { threadId: "th", turnId: "tu", diff: "" },
      },
      {
        method: "item/fileChange/patchUpdated",
        params: { itemId: "fc", changes: [{ path: "a" }] },
      },
      { method: "turn/completed", params: { turn: { id: "tu" } } },
      null,
    ]
    for (const notification of none) {
      expect(codexNativeArtifactEvidence(notification)).toEqual([])
    }
  })
})

describe("run artifact owner native roles", () => {
  test("a staged native diff is admitted with role native-diff, its content digest and a run-dir path", async () => {
    const dir = tempDir("native-art-rundir-")
    const runDir = runDirHandle(dir)
    const { ledger, rows } = memoryLedger("run-native-diff")
    const diff = "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n"

    const admission = await admitRunArtifactContent(
      {
        role: "native-diff",
        fileName: "native-diff-1.patch",
        text: diff,
        media: "text/x-diff",
        sourceKey: "turn-diff:1",
      },
      { runId: "run-native-diff", runDir, ledger },
    )

    expect(admission.result).toBe("admitted")
    const path = join(dir, "native-diff-1.patch")
    expect(readFileSync(path, "utf8")).toBe(diff)
    expect(artifactsOf(rows)).toEqual([
      {
        role: "native-diff",
        path,
        sha256: sha256(diff),
        contentType: "text/x-diff",
        sizeBytes: Buffer.byteLength(diff),
      },
    ])
  })

  test("diff content with exact secret material is rejected redaction_unsafe without staging a file or recording the secret", async () => {
    const dir = tempDir("native-art-rundir-")
    const runDir = runDirHandle(dir)
    const { ledger, rows } = memoryLedger("run-native-secret")

    const admission = await admitRunArtifactContent(
      {
        role: "native-diff",
        fileName: "native-diff-1.patch",
        text: `+token=${SECRET}\n`,
        media: "text/x-diff",
      },
      { runId: "run-native-secret", runDir, ledger },
    )

    expect(admission).toEqual({
      result: "rejected",
      reason: "redaction_unsafe",
    })
    expect(existsSync(join(dir, "native-diff-1.patch"))).toBe(false)
    expect(artifactsOf(rows)).toEqual([])
    expect(admissionsOf(rows)).toEqual([
      {
        subtype: "artifact_admission",
        result: "rejected",
        reason: "redaction_unsafe",
        role: "native-diff",
      },
    ])
    expect(JSON.stringify(rows)).not.toContain(SECRET)
  })

  test("a path-only native image inside the run dir is admitted by its stable read; one outside is rejected out_of_scope with no path in the record", async () => {
    const dir = tempDir("native-art-rundir-")
    const outside = tempDir("native-art-codex-home-")
    const inside = join(dir, "generated.png")
    const elsewhere = join(outside, "generated.png")
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    writeFileSync(inside, image)
    writeFileSync(elsewhere, image)
    const { ledger, rows } = memoryLedger("run-native-image")
    const context = { runId: "run-native-image", allowedRunDir: dir, ledger }

    await admitRunArtifactCandidate(
      {
        path: inside,
        ownerRunId: "run-native-image",
        media: "image/png",
        role: "native-image",
        sourceKey: "item:img-1",
      },
      context,
    )
    await admitRunArtifactCandidate(
      {
        path: elsewhere,
        ownerRunId: "run-native-image",
        media: "image/png",
        role: "native-image",
        sourceKey: "item:img-2",
      },
      context,
    )

    expect(artifactsOf(rows)).toEqual([
      {
        role: "native-image",
        path: inside,
        sha256: sha256(image),
        contentType: "image/png",
        sizeBytes: image.length,
      },
    ])
    expect(admissionsOf(rows)).toEqual([
      {
        subtype: "artifact_admission",
        result: "rejected",
        reason: "out_of_scope",
        role: "native-image",
      },
    ])
    expect(JSON.stringify(admissionsOf(rows))).not.toContain(outside)
  })

  test("native candidate publication waits for the Run's execution binding", async () => {
    const dir = tempDir("native-art-rundir-")
    writeFileSync(join(dir, "report.txt"), "report\n")
    const { ledger, rows } = memoryLedger("run-native-pending", {
      kind: "pending",
      runtimeId: "codex",
    })
    let error: unknown = null
    try {
      await admitRunArtifactCandidate(
        {
          path: join(dir, "report.txt"),
          ownerRunId: "run-native-pending",
          media: "text/plain",
        },
        { runId: "run-native-pending", allowedRunDir: dir, ledger },
      )
    } catch (caught) {
      error = caught
    }
    expect(String(error)).toContain("PROVENANCE_PENDING")
    expect(rows).toEqual([])
  })
})

describe("host native artifact candidate sink", () => {
  test("keeps only a turn's latest diff, resolves relative paths against the Run cwd and settles every admission before completed", async () => {
    const dir = tempDir("native-art-rundir-")
    const cwd = tempDir("native-art-cwd-")
    const runDir = runDirHandle(dir)
    const { ledger, rows, refs } = memoryLedger("run-native-sink")
    const diagnostics: string[] = []
    const sink = createRunArtifactCandidateSink({
      ledger,
      runId: "run-native-sink",
      runDir,
      cwd,
      onHostDiagnostic: (message) => diagnostics.push(message),
    })

    sink.observe({ role: "native-diff", turnId: "tu-1", diff: "first\n" })
    sink.observe({ role: "native-diff", turnId: "tu-1", diff: "latest\n" })
    sink.observe({
      role: "native-file",
      path: "src/changed.ts",
      sourceKey: "item:fc:0",
    })
    sink.flushTurn("tu-1")
    sink.observe({ role: "native-diff", turnId: "tu-2", diff: "second\n" })
    await sink.drain()
    await ledger.settle(SUCCESS_EVIDENCE)

    const diffs = artifactsOf(rows).filter(
      (artifact) => artifact.role === "native-diff",
    )
    expect(diffs.map((artifact) => artifact.path)).toEqual([
      join(dir, "native-diff-1.patch"),
      join(dir, "native-diff-2.patch"),
    ])
    expect(readFileSync(join(dir, "native-diff-1.patch"), "utf8")).toBe(
      "latest\n",
    )
    // The workspace file resolves under the Run cwd, outside the run dir.
    expect(admissionsOf(rows)).toEqual([
      {
        subtype: "artifact_admission",
        result: "rejected",
        reason: "out_of_scope",
        role: "native-file",
      },
    ])
    const completed = rows.filter((row) => row.type === "completed")
    expect(completed).toHaveLength(1)
    for (const row of rows) {
      if (
        row.type === "artifact_created" ||
        row.payload?.subtype === "artifact_admission"
      ) {
        expect(row.sequence).toBeLessThan(completed[0].sequence)
      }
    }
    expect(JSON.stringify(refs)).toContain(sha256("latest\n"))
    expect(diagnostics).toEqual([])
  })
})

describe("Codex app-server API run native artifacts", () => {
  test("an API run admits in-run-dir native images and the turn diff before completed, rejects out-of-scope candidates and lists admitted roles in result and manifest", async () => {
    const db = createAgentJobTestDb()
    const projectRoot = tempDir("native-art-project-")
    const codexHome = tempDir("native-art-codex-home-")
    db.insert(projects)
      .values({ id: "project-native", name: "Native", path: projectRoot })
      .run()
    const artifactBaseDir = join(projectRoot, ".locus", "runs")
    mkdirSync(join(projectRoot, "src"), { recursive: true })
    const workspaceFile = join(projectRoot, "src", "changed.ts")
    writeFileSync(workspaceFile, "export const changed = true\n")
    const outsideImage = join(codexHome, "outside.png")
    writeFileSync(outsideImage, Buffer.from([0x89, 0x50, 0x4e, 0x47, 9]))
    const insideImageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 7, 7])
    const turnDiff = "--- a/src/changed.ts\n+++ b/src/changed.ts\n+changed\n"
    let insideImage = ""

    const script = (jobId: string): CodexAppServerScript => {
      insideImage = join(artifactBaseDir, jobId, "generated.png")
      writeFileSync(insideImage, insideImageBytes)
      const item = (params: Record<string, unknown>) => ({
        method: "item/completed" as const,
        params: { threadId: "thread-1", turnId: "turn-1", ...params },
      })
      return {
        turnNotifications: (threadId) => [
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
              itemId: "msg-1",
              delta: "made the change",
            },
          },
          item({
            item: {
              type: "imageGeneration",
              id: "img-in",
              status: "completed",
              revisedPrompt: "logo",
              result: "",
              savedPath: insideImage,
            },
          }),
          item({
            item: {
              type: "imageGeneration",
              id: "img-out",
              status: "completed",
              revisedPrompt: "logo",
              result: "",
              savedPath: outsideImage,
            },
          }),
          item({
            item: {
              type: "fileChange",
              id: "fc-1",
              status: "completed",
              changes: [
                { path: workspaceFile, kind: { type: "update" }, diff: "" },
              ],
            },
          }),
          {
            method: "turn/diff/updated",
            params: { threadId, turnId: "turn-1", diff: "stale\n" },
          },
          {
            method: "turn/diff/updated",
            params: { threadId, turnId: "turn-1", diff: turnDiff },
          },
          {
            method: "turn/completed",
            params: {
              threadId,
              turn: { id: "turn-1", status: "completed", error: null },
            },
          },
        ],
      }
    }

    const runner = createCodexAppServerHeadlessTaskRunner({
      createDesktopAdapter: () =>
        createCodexAppServerAdapter({
          enabled: true,
          createTransport: ({ request }) =>
            new ScriptedCodexAppServerTransport(
              script(String(request.identity.jobId)),
            ),
          captureExecutionProvenance: async () => RUNTIME_TUPLE,
        }),
    })
    const request = {
      apiVersion: "locus.local-job.v1",
      consumer: { id: "native-artifacts", runExternalId: "native-001" },
      project: { cwd: projectRoot },
      runtime: {
        id: "codex",
        executionProfile: "policy-grant",
        policyGrant: { scopes: ["workspace:file-write"] },
      },
      mode: "agent",
      prompt: { text: "Change a file and draw a logo." },
      artifacts: { baseDir: artifactBaseDir },
    }
    let stdout = ""
    let stderr = ""
    const code = await runHeadlessCliCommand({
      db,
      argv: [
        "Locus",
        HEADLESS_CLI_MARKER,
        "api",
        "runs",
        "create",
        "--request",
        "-",
        "--json",
      ],
      stdin: Readable.from([JSON.stringify(request)]),
      stdout: {
        write(chunk: string) {
          stdout += chunk
        },
      },
      stderr: {
        write(chunk: string) {
          stderr += chunk
        },
      },
      runner: runner as never,
      appVersion: "0.0.test",
    })

    expect(stderr).toBe("")
    expect(code).toBe(0)
    const created = JSON.parse(stdout)
    expect(created.result.status).toBe("succeeded")
    const jobId = created.job.id as string
    const runDir = join(artifactBaseDir, jobId)

    const events = listAgentJobEvents(db, jobId).map((event) => ({
      sequence: event.sequence,
      type: event.type,
      payload: JSON.parse(event.payloadJson) as Record<string, unknown>,
    }))
    const completed = events.filter((event) => event.type === "completed")
    expect(completed).toHaveLength(1)
    const native = events.filter(
      (event) =>
        event.type === "artifact_created" &&
        JSON.stringify(event.payload).includes('"native-'),
    )
    expect(
      native.flatMap(
        (event) =>
          (event.payload.artifacts as Array<Record<string, unknown>>) ?? [],
      ),
    ).toEqual([
      {
        role: "native-image",
        path: insideImage,
        sha256: sha256(insideImageBytes),
        contentType: "image/png",
        sizeBytes: insideImageBytes.length,
      },
      {
        role: "native-diff",
        path: join(runDir, "native-diff-1.patch"),
        sha256: sha256(turnDiff),
        contentType: "text/x-diff",
        sizeBytes: Buffer.byteLength(turnDiff),
      },
    ])
    const rejections = events
      .filter(
        (event) =>
          event.type === "status" &&
          event.payload.subtype === "artifact_admission",
      )
      .map((event) => event.payload)
    expect(rejections).toEqual([
      {
        subtype: "artifact_admission",
        result: "rejected",
        reason: "out_of_scope",
        role: "native-image",
      },
      {
        subtype: "artifact_admission",
        result: "rejected",
        reason: "out_of_scope",
        role: "native-file",
      },
    ])
    const terminalCandidate = events.find(
      (event) =>
        event.type === "status" &&
        event.payload.subtype === "turn_lifecycle" &&
        JSON.stringify(event.payload).includes("turn/completed"),
    )
    const admissionEvents = events.filter(
      (event) => event.payload.subtype === "artifact_admission",
    )
    for (const event of [...native, ...admissionEvents]) {
      expect(event.sequence).toBeLessThan(completed[0].sequence)
    }
    // The turn's diff candidate is submitted before its terminal notification.
    const diffEvent = native.find((event) =>
      JSON.stringify(event.payload).includes("native-diff"),
    )
    expect(diffEvent?.sequence ?? Infinity).toBeLessThan(
      terminalCandidate?.sequence ?? 0,
    )
    // Rejection diagnostics carry no path; only the latest diff is staged.
    const rejectionText = JSON.stringify(admissionEvents)
    expect(rejectionText).not.toContain(outsideImage)
    expect(rejectionText).not.toContain(workspaceFile)
    expect(JSON.stringify(events)).not.toContain("stale\n")
    expect(existsSync(join(runDir, "native-diff-2.patch"))).toBe(false)

    const roles = (list: Array<{ role: string }>) =>
      list.map((artifact) => artifact.role)
    expect(roles(created.result.artifacts)).toEqual([
      "request",
      "events",
      "result",
      "native-image",
      "native-diff",
      "manifest",
    ])
    const manifest = JSON.parse(
      readFileSync(join(runDir, "artifacts.json"), "utf8"),
    )
    expect(roles(manifest.artifacts)).toEqual([
      "request",
      "events",
      "result",
      "native-image",
      "native-diff",
    ])
    const result = JSON.parse(readFileSync(join(runDir, "result.json"), "utf8"))
    expect(roles(result.artifacts)).toEqual([
      "request",
      "events",
      "native-image",
      "native-diff",
    ])
    for (const artifact of manifest.artifacts as Array<{
      path: string
      sha256: string
    }>) {
      expect(sha256(readFileSync(artifact.path))).toBe(artifact.sha256)
    }
  })
})

describe("native admission through the run directory handle (T2-11 / S-08, S-09)", () => {
  test("a hard link inside the run dir to an outside file is rejected out_of_scope", async () => {
    const dir = tempDir("native-art-rundir-")
    const outside = tempDir("native-art-outside-")
    const target = join(outside, "config.json")
    writeFileSync(target, '{"auths":{"r":{"auth":"x"}}}')
    linkSync(target, join(dir, "linked.json"))
    const runDir = runDirHandle(dir)
    const { ledger, rows } = memoryLedger("run-native-hardlink")
    // The production host sink hands its run directory handle to the owner.
    const sink = createRunArtifactCandidateSink({
      ledger,
      runId: "run-native-hardlink",
      runDir,
      cwd: dir,
    })
    sink.observe({
      role: "native-file",
      path: join(dir, "linked.json"),
      sourceKey: "item:fc-1",
    })
    await sink.drain()

    expect(artifactsOf(rows)).toEqual([])
    expect(admissionsOf(rows)).toEqual([
      {
        subtype: "artifact_admission",
        result: "rejected",
        reason: "out_of_scope",
        role: "native-file",
      },
    ])
    expect(JSON.stringify(rows)).not.toContain(outside)
  })

  test("a run dir swapped for a symlink to an outside directory admits nothing and publishes no outside path", async () => {
    const parent = tempDir("native-art-parent-")
    const dir = join(parent, "run")
    mkdirSync(dir)
    const runDir = runDirHandle(dir)
    const outside = tempDir("native-art-outside-")
    writeFileSync(join(outside, "report.txt"), "outside bytes\n")
    renameSync(dir, join(parent, "run-moved"))
    symlinkSync(outside, dir)
    const { ledger, rows } = memoryLedger("run-native-swap")
    const sink = createRunArtifactCandidateSink({
      ledger,
      runId: "run-native-swap",
      runDir,
      cwd: parent,
    })
    sink.observe({
      role: "native-file",
      path: join(dir, "report.txt"),
      sourceKey: "item:fc-1",
    })
    await sink.drain()

    expect(admissionsOf(rows).map((row) => row.result)).toEqual(["rejected"])
    expect(artifactsOf(rows)).toEqual([])
    expect(JSON.stringify(rows)).not.toContain(outside)
    expect(JSON.stringify(rows)).not.toContain("outside bytes")
  })

  test("terminal preparation lists a file edited twice once with its last digest and drops a file deleted after admission", async () => {
    const dir = tempDir("native-art-rundir-")
    const runDir = runDirHandle(dir)
    const { ledger, rows } = memoryLedger("run-native-stale")
    const context = { runId: "run-native-stale", runDir, ledger }
    const output = join(dir, "output.json")
    const gone = join(dir, "gone.txt")
    const candidate = (path: string, sourceKey: string) => ({
      path,
      ownerRunId: "run-native-stale",
      media: runArtifactMedia(path),
      sourceKey,
    })

    writeFileSync(output, '{"draft":1}')
    await admitRunArtifactCandidate(candidate(output, "item:fc-1"), context)
    writeFileSync(output, '{"final":2}')
    await admitRunArtifactCandidate(candidate(output, "item:fc-2"), context)
    writeFileSync(gone, "temporary\n")
    await admitRunArtifactCandidate(candidate(gone, "item:fc-3"), context)
    unlinkSync(gone)
    await ledger.settle(SUCCESS_EVIDENCE)

    // The committed facts stay: three admissions.
    expect(artifactsOf(rows).map((artifact) => artifact.path)).toEqual([
      output,
      output,
      gone,
    ])
    const dropped: string[] = []
    const listed = localJobApiNativeArtifacts(
      rows as never,
      runDir,
      (message) => dropped.push(message),
    )
    expect(listed).toEqual([
      {
        role: "native-file",
        path: output,
        sha256: sha256('{"final":2}'),
        contentType: "application/json",
        sizeBytes: Buffer.byteLength('{"final":2}'),
      },
    ])
    expect(dropped).toHaveLength(1)
    expect(dropped[0]).not.toContain(gone)
    const completed = rows.find((row) => row.type === "completed")
    for (const row of rows.filter(
      (entry) => entry.type === "artifact_created",
    )) {
      expect(row.sequence).toBeLessThan(completed?.sequence ?? 0)
    }
  })
})

function runArtifactMedia(path: string): string {
  return path.endsWith(".json") ? "application/json" : "text/plain"
}
