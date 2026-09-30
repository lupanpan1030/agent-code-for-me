/**
 * Implementer unit tests for Phase I seams of refactor-canonical-run-event-ledger
 * that the immutable red suite leaves to the implementer (red-receipt §6 /
 * red-slice-receipt §6): the stateless coarse ingress decoder (S06 half),
 * terminal artifact preparation registered with the one completed (S30
 * hooks), the provenance manifest encoding and the locus-completion variant.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { decodeCoarseRuntimeObservation } from "../src/main/lib/agent-runtime/ledger-ingress"
import {
  admitRunDirArtifacts,
  describeRunArtifactFile,
  type RunArtifactRunDir,
  writeRunArtifactFile,
} from "../src/main/lib/agent-runtime/run-artifacts"
import { createCanonicalRunEventLedger } from "../src/main/lib/agent-runtime/run-event-ledger"
import {
  captureLocusCompletionProvenance,
  encodeRunSchemaManifest,
} from "../src/main/lib/agent-runtime/run-provenance"
import {
  closeStableDirectory,
  openStableDirectory,
} from "../src/main/lib/filesystem/stable-directory"

const RUNTIME = {
  kind: "runtime",
  installationId: "inst-codex-0.139.0-linux-x64-units",
  runtimeId: "codex",
  adapterSource: "codex-app-server",
  version: "0.139.0",
  executableRef: "exe-units",
  binarySha256: "c".repeat(64),
  protocolName: "codex-app-server-jsonrpc",
  protocolVersion: "v2",
  schemaFiles: [{ path: "ServerNotification.ts", sha256: "d".repeat(64) }],
}

const tempDirs: string[] = []
afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true })
  }
})

type Commit = {
  records: Array<Record<string, unknown>>
  artifactRefs?: unknown[]
  jobMutation?: Record<string, unknown>
}

function memoryStore(runId: string) {
  const records: Array<Record<string, unknown>> = []
  const commits: Commit[] = []
  return {
    commits,
    store: {
      appendExact(input: Commit & { expectedHighWater: number }) {
        if (input.expectedHighWater !== records.length) {
          throw new Error("expectedHighWater conflict")
        }
        records.push(...structuredClone(input.records))
        commits.push(structuredClone(input))
        return structuredClone(input.records)
      },
      read(_runId: string, after = 0) {
        return structuredClone(
          records.filter((record) => Number(record.sequence) > after),
        )
      },
      readHeader() {
        return { runId, status: "running", ledgerVersion: 1 }
      },
    },
  }
}

const SUCCESS = {
  trigger: {
    kind: "host_result" as const,
    status: "succeeded" as const,
    observationKey: "units-result",
  },
  policy: { denied: false, evidenceKeys: [] },
  output: {
    valid: true,
    empty: false,
    allowEmpty: false,
    evidenceKeys: ["output:units"],
  },
  postRun: { credentialsSafe: true, evidenceKeys: [] },
}

describe("ledger-ingress (stateless coarse decode)", () => {
  test("owner-gated and host lifecycle types are refused; unknown types are refused", () => {
    expect(
      [
        "completed",
        "artifact_created",
        "job_created",
        "job_started",
        "nope",
      ].map((type) => decodeCoarseRuntimeObservation({ type, payload: {} })),
    ).toEqual([
      { kind: "rejected", reason: "owner_gated_type", type: "completed" },
      {
        kind: "rejected",
        reason: "owner_gated_type",
        type: "artifact_created",
      },
      { kind: "rejected", reason: "host_lifecycle_type", type: "job_created" },
      { kind: "rejected", reason: "host_lifecycle_type", type: "job_started" },
      { kind: "rejected", reason: "unknown_type", type: "nope" },
    ])
  })

  test("coarse output keeps its source payload, describes the stream field and invents no native identity", () => {
    const input = {
      type: "assistant_delta",
      payload: { text: "hello", messageId: "m-1", contentKind: "text" },
    }
    const snapshot = structuredClone(input)
    const first = decodeCoarseRuntimeObservation(input)
    const second = decodeCoarseRuntimeObservation(input)
    expect(first).toEqual(second)
    expect(input).toEqual(snapshot)
    expect(first).toEqual({
      kind: "event",
      type: "assistant_delta",
      payload: { text: "hello", messageId: "m-1", contentKind: "text" },
      stream: {
        field: "text",
        itemChannel: "assistant",
        streamChannel: "coarse:assistant:m-1",
      },
    })
    const serialized = JSON.stringify(first)
    for (const key of ["threadId", "turnId", "itemId", "sessionId"]) {
      expect(serialized).not.toContain(key)
    }
  })

  test("tool observations default a status and per-call usage exposes its vector", () => {
    expect(
      decodeCoarseRuntimeObservation({
        type: "tool_delta",
        payload: { toolCallId: "call-1", output: "a" },
      }),
    ).toMatchObject({
      payload: { toolCallId: "call-1", output: "a", status: "running" },
      stream: { field: "output", itemChannel: "tool" },
    })
    expect(
      decodeCoarseRuntimeObservation({
        type: "usage_update",
        payload: { callId: "c", revision: 2, usage: { totalTokens: 7 } },
      }),
    ).toMatchObject({
      usage: { callId: "c", revision: 2, vector: { totalTokens: 7 } },
    })
  })
})

describe("terminal artifact preparation (design Artifacts and Terminal Commit Order)", () => {
  test("refs prepared from the frozen prefix plus the candidate completed join the completed commit", async () => {
    const { store, commits } = memoryStore("run-units-terminal")
    const seen: Array<{ lastType: unknown; completedSequence: unknown }> = []
    const ledger = createCanonicalRunEventLedger({
      runId: "run-units-terminal",
      runtimeId: "codex",
      provenance: RUNTIME,
      durableStore: store,
      terminalArtifacts: {
        prepare({ records, completed }) {
          seen.push({
            lastType: records.at(-1)?.type,
            completedSequence: completed.sequence,
          })
          return [{ role: "result", sha256: "e".repeat(64) }]
        },
      },
    })
    await ledger.ingestRuntimeObservation({
      observationKey: "units-out",
      type: "assistant_delta",
      payload: { text: "done" },
    })
    await ledger.settle(SUCCESS)
    const terminal = commits.find((commit) =>
      commit.records.some((record) => record.type === "completed"),
    )
    expect(seen).toEqual([{ lastType: "completed", completedSequence: 2 }])
    expect(terminal?.artifactRefs).toEqual([
      { role: "result", sha256: "e".repeat(64) },
    ])
    expect(await ledger.readOutcome()).toMatchObject({ status: "succeeded" })
  })

  test("a preparation failure keeps the terminal slot, settles failed with the diagnostic and registers no unverified refs", async () => {
    const { store, commits } = memoryStore("run-units-terminal-fail")
    const ledger = createCanonicalRunEventLedger({
      runId: "run-units-terminal-fail",
      runtimeId: "codex",
      provenance: RUNTIME,
      durableStore: store,
      terminalArtifacts: {
        prepare() {
          throw new Error("disk full")
        },
      },
    })
    await ledger.settle(SUCCESS)
    const terminal = commits.find((commit) =>
      commit.records.some((record) => record.type === "completed"),
    )
    expect(terminal?.artifactRefs).toBeUndefined()
    expect(terminal?.jobMutation?.status).toBe("failed")
    expect(await ledger.readOutcome()).toMatchObject({
      status: "failed",
      reasons: ["terminal_artifact_preparation_failed"],
    })
  })

  test("canceled keeps its precedence when terminal preparation fails", async () => {
    const { store } = memoryStore("run-units-terminal-cancel")
    const ledger = createCanonicalRunEventLedger({
      runId: "run-units-terminal-cancel",
      runtimeId: "codex",
      provenance: RUNTIME,
      durableStore: store,
      terminalArtifacts: {
        prepare() {
          throw new Error("disk full")
        },
      },
    })
    await ledger.settle({
      ...SUCCESS,
      trigger: {
        kind: "cancel",
        observationKey: "units-cancel",
        reason: "user_cancel",
      },
    })
    expect(await ledger.readOutcome()).toMatchObject({
      status: "canceled",
      reasons: ["user_cancel", "terminal_artifact_preparation_failed"],
    })
  })

  test("run-dir files are written by the artifact owner and admitted as one artifact_created only when their digests still match", async () => {
    const runDir = mkdtempSync(join(tmpdir(), "run-units-dir-"))
    tempDirs.push(runDir)
    const handle: RunArtifactRunDir = Object.assign(
      openStableDirectory(runDir, "Artifact run"),
      { fileReceipts: new Map() },
    )
    writeRunArtifactFile(handle, "request.json", '{"ok":true}')
    const request = describeRunArtifactFile("request", handle, "request.json")
    expect(request).toMatchObject({
      role: "request",
      path: join(handle.path, "request.json"),
      sha256: createHash("sha256").update('{"ok":true}').digest("hex"),
      sizeBytes: 11,
    })
    const { store, commits } = memoryStore("run-units-run-dir")
    const ledger = createCanonicalRunEventLedger({
      runId: "run-units-run-dir",
      runtimeId: "codex",
      provenance: { kind: "pending", runtimeId: "codex" },
      durableStore: store,
    })
    await expect(
      admitRunDirArtifacts({
        runId: "run-units-run-dir",
        runDir: handle,
        artifacts: [{ ...request, sha256: "0".repeat(64) }],
        ledger,
      }),
    ).rejects.toThrow("changed before admission")
    await admitRunDirArtifacts({
      runId: "run-units-run-dir",
      runDir: handle,
      artifacts: [request],
      ledger,
    })
    const created = commits
      .flatMap((commit) => commit.records)
      .filter((record) => record.type === "artifact_created")
    expect(created).toHaveLength(1)
    expect(created[0]?.payload).toMatchObject({ artifacts: [request] })
    closeStableDirectory(handle)
  })

  test("the run-dir writer refuses a path that escapes the admitted run directory (T2-13 / S-24)", () => {
    const parent = mkdtempSync(join(tmpdir(), "run-units-escape-"))
    tempDirs.push(parent)
    const runDir = join(parent, "run")
    mkdirSync(runDir)
    const handle: RunArtifactRunDir = Object.assign(
      openStableDirectory(runDir, "Artifact run"),
      { fileReceipts: new Map() },
    )
    try {
      expect(() =>
        writeRunArtifactFile(handle, "../escape.json", "{}"),
      ).toThrow("single path component")
      expect(() =>
        writeRunArtifactFile(handle, "nested/escape.json", "{}"),
      ).toThrow("single path component")
      expect(existsSync(join(parent, "escape.json"))).toBe(false)
      expect(existsSync(join(runDir, "nested"))).toBe(false)
    } finally {
      closeStableDirectory(handle)
    }
  })
})

describe("run provenance encodings", () => {
  test("the schema manifest encoding is versioned and order-independent", () => {
    const a = { path: "b.ts", sha256: "1".repeat(64) }
    const b = { path: "a.ts", sha256: "2".repeat(64) }
    expect(encodeRunSchemaManifest([a, b])).toBe(
      encodeRunSchemaManifest([b, a]),
    )
    expect(encodeRunSchemaManifest([a, b])).toBe(
      `locus.run-schema-manifest.v1\n${"2".repeat(64)}  a.ts\n${"1".repeat(64)}  b.ts\n`,
    )
  })

  test("the locus-completion variant names its completion source and claims no binary", () => {
    const provenance = captureLocusCompletionProvenance({
      runtimeId: "codex",
      locusBuild: "locus-0.0.test",
      protocolName: "openai-responses",
      schemaDocument: '{"type":"object"}',
    })
    expect(provenance).toEqual({
      kind: "locus-completion",
      runtimeId: "codex",
      locusBuild: "locus-0.0.test",
      adapterSource: "completion",
      protocolName: "openai-responses",
      schemaSha256: createHash("sha256")
        .update('{"type":"object"}')
        .digest("hex"),
    })
    expect(JSON.stringify(provenance)).not.toContain("binarySha256")
  })
})
