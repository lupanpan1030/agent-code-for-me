/** biome-ignore-all lint/suspicious/noExplicitAny: the ledger contract under test does not exist yet; records are asserted structurally. */
/**
 * Domain B red suite, part 2 — two-stage execution provenance, native resume
 * validation facts and snapshot repair for
 * `openspec/changes/refactor-canonical-run-event-ledger`.
 *
 * Scenarios: S15 (Native Identity And Runtime Provenance / exact runtime
 * provenance follows every event), S33, S34 (Native Resume Validation
 * Facts), S35, S36, S37 (Resume Snapshot Repair).
 *
 * Entry points (design "Test-facing Contract", "Current Owner to Target
 * Mapping", tasks 6.1-6.4; never invented):
 * - `createCanonicalRunEventLedger` (NEW agent-runtime/run-event-ledger.ts):
 *   `bindExecutionProvenance`, `appendSystemEvent`, `ingestNotification`,
 *   `ingestResponse`, `ingestClaudeMessage`, `ingestRuntimeObservation`,
 *   `ingestTransportExit`, `repairFromSnapshot`, `settle`, `read`,
 *   `readItem`, `readOutcome`, over the kit's in-memory durableStore port.
 * - `captureRunExecutionProvenance` (NEW agent-runtime/run-provenance.ts)
 *   fed by the existing resolution seam `resolveBundledCodexCliPath`
 *   (codex/cli-path.ts:58). The input field names of the capture call are
 *   not fixed by the design; this suite passes the ExecutionProvenance field
 *   names plus `executablePath`, `schemaRoot` and relative `schemaFiles`.
 * - Existing owners the design modifies: `classifyClaudeAgentSdkStreamError`
 *   (claude/agent-sdk-errors.ts) and `finalizeClaudeAgentSdkStreamError`
 *   (claude/agent-sdk-stream-error-finalization.ts), plus the lifecycle
 *   entries `createAgentJob` / `startAgentJob` / CLI `jobs cancel` asserted
 *   on rows of a temporary SQLite database migrated with the real Drizzle
 *   migrations.
 *
 * Shape assumptions: status subtype in `payload.subtype`; resume fact fields
 * (jsonRpcId, requestedThreadId, ...) and `durableEvidence`/`lossPossible`
 * at the top of that status payload; repair metadata in `payload.repair`.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { eq } from "drizzle-orm"
import {
  clearClaudeActiveSessionsForTest,
  setActiveClaudeSession,
} from "../src/main/lib/claude/active-sessions"
import { chats, projects, subChats } from "../src/main/lib/db/schema"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"
import {
  applyStep,
  completedRecords,
  createLedger,
  createMigratedLedgerDb,
  denseRange,
  jobEventRows,
  jobRow,
  loadJsonFixture,
  loadJsonlFixture,
  loadRunProvenanceModule,
  MemoryDurableStore,
  type MigratedLedgerDb,
  recordsForKey,
  sequencesOf,
  settledResult,
  sha256Hex,
  statusRecords,
} from "./run-event-ledger-domain-b-kit"

const identity = loadJsonFixture("identity-provenance.json")
const RUNTIME = identity.provenanceVariants.runtime
const RUNTIME_MISSING_DIGEST =
  identity.provenanceVariants.runtimeMissingBinarySha256
const LOCUS_COMPLETION = identity.provenanceVariants.locusCompletion
const PENDING = identity.provenanceVariants.pending
const REQUIRED_RUNTIME_FIELDS = [
  "installationId",
  "runtimeId",
  "adapterSource",
  "version",
  "executableRef",
  "binarySha256",
  "protocolName",
  "protocolVersion",
  "schemaFiles",
] as const
/** A different, otherwise complete runtime tuple (rebind must be rejected). */
const ALTERNATE_RUNTIME = {
  ...RUNTIME,
  installationId: "inst-codex-0.139.0-linux-x64-ffffffff",
  binarySha256: "f".repeat(64),
}

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
  clearClaudeActiveSessionsForTest()
})

function trackDb(db: MigratedLedgerDb): MigratedLedgerDb {
  cleanups.push(() => db.close())
  return db
}

function n(method: string, params: unknown) {
  return { message: { method, params } }
}

const TURN_STARTED = n("turn/started", {
  threadId: "th",
  turn: { id: "tu", items: [], status: "inProgress", error: null },
})

function nativeStep(observationKey: string, input: unknown) {
  return {
    port: "ingestNotification",
    observationKey,
    transportId: "t1",
    input,
  }
}

// ---------------------------------------------------------------------------
describe("agent-runtime-core / Native Identity And Runtime Provenance", () => {
  test("S15 Exact runtime provenance follows every event — pending lifecycle facts stay pending, native input before binding is rejected, bindExecutionProvenance seals the tuple once, every later runtime record references it, reopening preserves it and a different tuple is rejected", async () => {
    const runId = "run-b-s15-runtime"
    const store = new MemoryDurableStore({
      runId,
      header: { status: "queued" },
    })
    const ledger = await createLedger({
      runId,
      runtimeId: "codex",
      provenance: PENDING,
      store,
    })
    await ledger.appendSystemEvent({
      observationKey: "p15-created",
      type: "job_created",
      payload: { kind: "agent", source: "api", runtime: "codex", mode: "plan" },
    })
    const pendingBytes = JSON.stringify(
      recordsForKey(store.read(runId, 0), "p15-created"),
    )

    const beforeBinding = await settledResult(() =>
      applyStep(ledger, nativeStep("p15-native-early", TURN_STARTED)),
    )
    expect(beforeBinding.fulfilled).toBe(false)
    expect(
      recordsForKey(store.read(runId, 0), "p15-native-early"),
    ).toHaveLength(0)
    expect(store.header.ledgerProvenanceJson).toBeNull()

    await ledger.bindExecutionProvenance(RUNTIME)
    await applyStep(ledger, nativeStep("p15-native-1", TURN_STARTED))
    await applyStep(
      ledger,
      nativeStep(
        "p15-native-2",
        n("item/agentMessage/delta", {
          threadId: "th",
          turnId: "tu",
          itemId: "msg",
          delta: "hi",
        }),
      ),
    )
    await ledger.appendSystemEvent({
      observationKey: "p15-system",
      type: "status",
      payload: { status: "runtime_selected", runtime: "codex" },
    })

    const records = await ledger.read(0)
    for (const key of ["p15-native-1", "p15-native-2", "p15-system"]) {
      const forKey = recordsForKey(records, key)
      expect(forKey.length).toBeGreaterThan(0)
      for (const record of forKey) {
        expect(JSON.stringify(record)).toContain(RUNTIME.installationId)
      }
    }
    expect(JSON.stringify(recordsForKey(records, "p15-created"))).toBe(
      pendingBytes,
    )
    expect(pendingBytes).not.toContain(RUNTIME.installationId)
    expect(JSON.stringify(store.readHeader(runId))).toContain(
      RUNTIME.binarySha256,
    )

    const rebind = await settledResult(() =>
      ledger.bindExecutionProvenance(ALTERNATE_RUNTIME),
    )
    expect(rebind.fulfilled).toBe(false)

    const reopened = await createLedger({
      runId,
      runtimeId: "codex",
      provenance: PENDING,
      store,
    })
    await applyStep(reopened, nativeStep("p15-native-3", TURN_STARTED))
    const afterReopen = recordsForKey(await reopened.read(0), "p15-native-3")
    expect(afterReopen.length).toBeGreaterThan(0)
    expect(JSON.stringify(afterReopen)).toContain(RUNTIME.installationId)
    const rebindAfterReopen = await settledResult(() =>
      reopened.bindExecutionProvenance(ALTERNATE_RUNTIME),
    )
    expect(rebindAfterReopen.fulfilled).toBe(false)
    const headerAfter = JSON.stringify(store.readHeader(runId))
    expect(headerAfter).toContain(RUNTIME.binarySha256)
    expect(headerAfter).not.toContain(ALTERNATE_RUNTIME.binarySha256)
  })

  test("S15 Exact runtime provenance follows every event — a runtime-execution ledger or pending-to-runtime binding missing any required tuple field (binary digest included) is rejected before runtime publication; a pending lifecycle ledger needs no digest", async () => {
    const variants = REQUIRED_RUNTIME_FIELDS.map((field) => {
      const { [field]: _omitted, ...rest } = RUNTIME
      return { field, tuple: rest }
    })
    expect(Object.keys(RUNTIME_MISSING_DIGEST).includes("binarySha256")).toBe(
      false,
    )
    variants.push({
      field: "binarySha256 (fixture variant)",
      tuple: RUNTIME_MISSING_DIGEST,
    })

    const observed: unknown[] = []
    for (const variant of variants) {
      const constructStore = new MemoryDurableStore({
        runId: "run-b-s15-construct",
      })
      const construct = await settledResult(() =>
        createLedger({
          runId: "run-b-s15-construct",
          runtimeId: "codex",
          provenance: variant.tuple,
          store: constructStore,
        }),
      )
      const bindStore = new MemoryDurableStore({ runId: "run-b-s15-bind" })
      const pendingLedger = await createLedger({
        runId: "run-b-s15-bind",
        runtimeId: "codex",
        provenance: PENDING,
        store: bindStore,
      })
      const bind = await settledResult(() =>
        pendingLedger.bindExecutionProvenance(variant.tuple),
      )
      observed.push({
        field: variant.field,
        constructionRejected: !construct.fulfilled,
        bindingRejected: !bind.fulfilled,
        publishedRecords:
          constructStore.records.length + bindStore.records.length,
        boundProvenance: bindStore.header.ledgerProvenanceJson,
      })
    }
    expect(observed).toEqual(
      variants.map((variant) => ({
        field: variant.field,
        constructionRejected: true,
        bindingRejected: true,
        publishedRecords: 0,
        boundProvenance: null,
      })),
    )

    const lifecycleStore = new MemoryDurableStore({
      runId: "run-b-s15-lifecycle",
    })
    const lifecycle = await createLedger({
      runId: "run-b-s15-lifecycle",
      runtimeId: "codex",
      provenance: PENDING,
      store: lifecycleStore,
    })
    await lifecycle.appendSystemEvent({
      observationKey: "p15-lc-created",
      type: "job_created",
      payload: { kind: "agent", source: "cli", runtime: "codex", mode: "plan" },
    })
    expect(
      recordsForKey(await lifecycle.read(0), "p15-lc-created").length,
    ).toBeGreaterThan(0)
    expect(lifecycleStore.header.ledgerProvenanceJson).toBeNull()
    expect(JSON.stringify(lifecycleStore.records)).not.toContain("binarySha256")
  })

  test("S15 Exact runtime provenance follows every event — the locus-completion variant records its actual Locus completion source and claims no native binary or installation", async () => {
    const runId = "run-b-s15-completion"
    const store = new MemoryDurableStore({ runId })
    const ledger = await createLedger({
      runId,
      runtimeId: LOCUS_COMPLETION.runtimeId,
      source: "api",
      provenance: LOCUS_COMPLETION,
      store,
    })
    await ledger.ingestRuntimeObservation({
      observationKey: "p15-comp-out",
      type: "assistant_delta",
      payload: { text: "completion output" },
    })
    await ledger.settle({
      trigger: {
        kind: "host_result",
        status: "succeeded",
        observationKey: "p15-comp-result",
      },
      policy: { denied: false, evidenceKeys: ["policy:allow"] },
      output: {
        valid: true,
        empty: false,
        allowEmpty: false,
        evidenceKeys: ["output:completion"],
      },
      postRun: {
        credentialsSafe: true,
        evidenceKeys: ["postrun:credentials-ok"],
      },
    })
    const records = await ledger.read(0)
    expect(completedRecords(records)).toHaveLength(1)
    const outputRecords = recordsForKey(records, "p15-comp-out")
    expect(outputRecords.length).toBeGreaterThan(0)
    expect(JSON.stringify(outputRecords)).toContain(LOCUS_COMPLETION.locusBuild)
    const serialized = JSON.stringify({
      records,
      header: store.readHeader(runId),
    })
    expect(serialized).toContain(LOCUS_COMPLETION.locusBuild)
    expect(serialized).not.toContain("binarySha256")
    expect(serialized).not.toContain("installationId")
  })

  test("S15 Exact runtime provenance follows every event — never-started pending ledgers (enqueue, worker claim, queued cancel, recovery) settle with null provenance; binding after the terminal seal is rejected so the header stays null", async () => {
    const neverStarted = identity.cases.find(
      (c: any) => c.caseId === "never-started-pending",
    )
    expect(neverStarted.variants).toEqual([
      "enqueue",
      "worker-claim",
      "queued-cancel",
      "recovery",
    ])
    const settleFor = (kind: "cancel" | "recovery", key: string) => ({
      trigger: {
        kind,
        observationKey: key,
        reason: kind === "cancel" ? "queued_cancel" : "confirmed_dead_worker",
      },
      policy: { denied: false, evidenceKeys: [] },
      output: {
        valid: false,
        empty: true,
        allowEmpty: false,
        evidenceKeys: [],
      },
      postRun: { credentialsSafe: true, evidenceKeys: [] },
    })
    const plans = [
      {
        name: "queued-cancel",
        headerStatus: "queued",
        claim: false,
        terminal: "cancel" as const,
        status: "canceled",
      },
      {
        name: "recovery",
        headerStatus: "running",
        claim: true,
        terminal: "recovery" as const,
        status: "interrupted",
      },
    ]
    const observed: unknown[] = []
    for (const plan of plans) {
      const runId = `run-b-s15-never-${plan.name}`
      const store = new MemoryDurableStore({
        runId,
        header: { status: plan.headerStatus },
      })
      const ledger = await createLedger({
        runId,
        runtimeId: "codex",
        provenance: neverStarted.provenance,
        store,
      })
      await ledger.appendSystemEvent({
        observationKey: `${plan.name}-enqueue`,
        type: "job_created",
        payload: {
          kind: "agent",
          source: "cli",
          runtime: "codex",
          mode: "plan",
        },
      })
      if (plan.claim) {
        await ledger.appendSystemEvent({
          observationKey: `${plan.name}-claim`,
          type: "job_started",
          payload: { workerId: "worker-never", workerPid: null },
        })
      }
      const native = await settledResult(() =>
        applyStep(ledger, nativeStep(`${plan.name}-native`, TURN_STARTED)),
      )
      await ledger.settle(settleFor(plan.terminal, `${plan.name}-terminal`))
      const lateBind = await settledResult(() =>
        ledger.bindExecutionProvenance(RUNTIME),
      )
      const records = await ledger.read(0)
      observed.push({
        name: plan.name,
        nativeBeforeBindingRejected: !native.fulfilled,
        completed: completedRecords(records).map(
          (record: any) => record.payload?.status,
        ),
        lateBindingRejected: !lateBind.fulfilled,
        ledgerProvenanceJson: store.header.ledgerProvenanceJson,
        claimsInstallation: JSON.stringify(records).includes(
          RUNTIME.installationId,
        ),
      })
    }
    expect(observed).toEqual(
      plans.map((plan) => ({
        name: plan.name,
        nativeBeforeBindingRejected:
          neverStarted.expected.nativeBeforeBinding === "rejected",
        completed: [plan.status],
        lateBindingRejected: true,
        ledgerProvenanceJson: neverStarted.expected.ledgerProvenanceJson,
        claimsInstallation: false,
      })),
    )
  })

  test("S15 Exact runtime provenance follows every event — lifecycle entries (createAgentJob enqueue, startAgentJob worker claim, CLI queued cancel) write v1 rows with fact keys and pending record metadata while agent_jobs.ledger_provenance_json stays null", async () => {
    const { createAgentJob, startAgentJob } = await import(
      "../src/main/lib/headless/job-store"
    )
    const { runHeadlessCliCommand } = await import(
      "../src/main/lib/headless/cli-dispatcher"
    )
    const { HEADLESS_CLI_MARKER } = await import(
      "../src/main/lib/headless/cli-args"
    )
    const ledgerDb = trackDb(createMigratedLedgerDb())
    const canceled = await createAgentJob(ledgerDb.db, {
      source: "cli",
      runtime: "codex",
      mode: "plan",
      cwd: process.cwd(),
      prompt: "never started, canceled",
    })
    const sink = { write: (_chunk: string) => {} }
    await runHeadlessCliCommand({
      db: ledgerDb.db,
      argv: ["Locus", HEADLESS_CLI_MARKER, "jobs", "cancel", canceled.id],
      stdout: sink,
      stderr: sink,
    })
    const claimed = await createAgentJob(ledgerDb.db, {
      source: "cli",
      runtime: "codex",
      mode: "plan",
      cwd: process.cwd(),
      prompt: "worker claimed, never executed",
    })
    await startAgentJob(ledgerDb.db, {
      jobId: claimed.id,
      workerId: "worker-claim",
      workerPid: null,
    })

    const observed = [canceled.id, claimed.id].map((jobId) => {
      const job = jobRow(ledgerDb.sqlite, jobId)
      const rows = jobEventRows(ledgerDb.sqlite, jobId)
      return {
        ledgerVersion: job.ledger_version,
        ledgerProvenanceJson: job.ledger_provenance_json,
        firstType: rows[0]?.type,
        lastType: rows.at(-1)?.type,
        everyRowHasFactKey: rows.every(
          (row) => typeof row.fact_key === "string" && row.fact_key.length > 0,
        ),
        everyRowPending: rows.every(
          (row) =>
            typeof row.record_metadata_json === "string" &&
            row.record_metadata_json.includes("pending") &&
            !row.record_metadata_json.includes("binarySha256"),
        ),
      }
    })
    expect(observed).toEqual([
      {
        ledgerVersion: 1,
        ledgerProvenanceJson: null,
        firstType: "job_created",
        lastType: "completed",
        everyRowHasFactKey: true,
        everyRowPending: true,
      },
      {
        ledgerVersion: 1,
        ledgerProvenanceJson: null,
        firstType: "job_created",
        lastType: "job_started",
        everyRowHasFactKey: true,
        everyRowPending: true,
      },
    ])
  })

  test("S15 Exact runtime provenance follows every event — captureRunExecutionProvenance (run-provenance.ts) hashes the executable actually resolved by resolveBundledCodexCliPath and reproducible sorted per-file schema fingerprints; repeatable, tamper-sensitive, opaque executableRef, never the v2.schemas.json bundle", async () => {
    const { resolveBundledCodexCliPath, BUNDLED_CODEX_CLI_VERSION } =
      await import("../src/main/lib/codex/cli-path")
    const root = mkdtempSync(join(tmpdir(), "run-event-ledger-b-app-"))
    cleanups.push(() => rmSync(root, { recursive: true, force: true }))
    writeFileSync(join(root, "package.json"), "{}")
    mkdirSync(join(root, "resources", "cli"), { recursive: true })
    const binDir = join(
      root,
      "resources",
      "bin",
      `${process.platform}-${process.arch}`,
    )
    mkdirSync(binDir, { recursive: true })
    const binaryName = process.platform === "win32" ? "codex.exe" : "codex"
    const binaryBytes = "#!/bin/sh\necho codex-cli 0.139.0\n"
    writeFileSync(join(binDir, binaryName), binaryBytes)
    const schemaRoot = join(root, "schema")
    mkdirSync(join(schemaRoot, "v2"), { recursive: true })
    const schemaContents: Record<string, string> = {
      "v2/ThreadItem.ts": 'export type ThreadItem = { type: "agentMessage" }\n',
      "ServerRequest.ts":
        'export type ServerRequest = { method: "item/tool/call" }\n',
      "ServerNotification.ts":
        'export type ServerNotification = { method: "turn/started" }\n',
    }
    for (const [path, content] of Object.entries(schemaContents)) {
      writeFileSync(join(schemaRoot, path), content)
    }
    writeFileSync(
      join(schemaRoot, "v2.schemas.json"),
      JSON.stringify({ nonDeterministic: Date.now() }),
    )

    const executablePath = resolveBundledCodexCliPath({
      isPackaged: false,
      getAppPath: () => root,
    })
    expect(executablePath).toBe(join(binDir, binaryName))

    const { captureRunExecutionProvenance } = await loadRunProvenanceModule()
    const captureInput = {
      runtimeId: "codex",
      adapterSource: "codex-app-server",
      version: BUNDLED_CODEX_CLI_VERSION,
      protocolName: "codex-app-server-jsonrpc",
      protocolVersion: "v2",
      executablePath,
      schemaRoot,
      schemaFiles: Object.keys(schemaContents),
    }
    const first = await captureRunExecutionProvenance(captureInput)
    const second = await captureRunExecutionProvenance(captureInput)
    expect(first).toMatchObject({
      kind: "runtime",
      runtimeId: "codex",
      version: BUNDLED_CODEX_CLI_VERSION,
      binarySha256: sha256Hex(binaryBytes),
      schemaFiles: Object.keys(schemaContents)
        .sort()
        .map((path) => ({ path, sha256: sha256Hex(schemaContents[path]) })),
    })
    expect(first.schemaFiles).toHaveLength(3)
    expect(second).toEqual(first)
    expect(typeof first.installationId).toBe("string")
    expect(String(first.executableRef)).not.toContain(root)

    writeFileSync(join(binDir, binaryName), `${binaryBytes}# tampered\n`)
    const tampered = await captureRunExecutionProvenance(captureInput)
    expect(tampered.binarySha256).toBe(sha256Hex(`${binaryBytes}# tampered\n`))
    expect(tampered.installationId).not.toBe(first.installationId)
  })
})

// ---------------------------------------------------------------------------
describe("agent-runtime-core / Native Resume Validation Facts", () => {
  const codexResume = loadJsonlFixture("resume-codex.jsonl")
  const claudeResume = loadJsonlFixture("resume-claude.jsonl")
  const CLAUDE_RUNTIME = {
    ...RUNTIME,
    installationId: "inst-claude-code-2.1.177-linux-x64-ff417536",
    runtimeId: "claude-code",
    adapterSource: "claude-agent-sdk",
    version: "2.1.177",
    executableRef: "exe-ref-claude-21177",
    binarySha256: String(claudeResume.header.provenance.binarySha256),
    protocolName: "claude-agent-sdk-stream-json",
    protocolVersion: "0.3.177",
    schemaFiles: [{ path: "sdk.d.ts", sha256: "c".repeat(64) }],
  }

  async function runGroup(
    fixture: ReturnType<typeof loadJsonlFixture>,
    group: string,
    runtimeId: string,
    provenance: unknown,
  ) {
    const lines = fixture.lines.filter((line) => line.group === group)
    if (lines.length === 0) throw new Error(`fixture lacks group ${group}`)
    const runId = `run-b-resume-${runtimeId}-${group}`
    const store = new MemoryDurableStore({ runId })
    const ledger = await createLedger({ runId, runtimeId, provenance, store })
    for (const line of lines) await applyStep(ledger, line)
    return { ledger, store, lines, records: await ledger.read(0) }
  }

  function factFor(records: any[], observationKey: string, subtype: string) {
    return recordsForKey(records, observationKey).find(
      (record: any) =>
        record.type === "status" && record.payload?.subtype === subtype,
    )
  }

  function pick(payload: any, expected: Record<string, unknown>) {
    return Object.fromEntries(
      Object.keys(expected).map((key) => [key, payload?.[key]]),
    )
  }

  test("S33 Codex response validates the requested native thread — early thread/status/changed stays thread_lifecycle; only the matching JSON-RPC success yields native_resume_validated with jsonRpcId/requested/returned thread, sessionId, durability evidence and intent; an unrelated id is protocol_response correlated=false; no thread/started is fabricated", async () => {
    const observed: unknown[] = []
    const expected: unknown[] = []
    const serializedAll: string[] = []
    for (const group of ["matching-success", "unrelated"]) {
      const { lines, records } = await runGroup(
        codexResume,
        group,
        "codex",
        RUNTIME,
      )
      serializedAll.push(JSON.stringify(records))
      for (const line of lines) {
        const fact = factFor(
          records,
          line.observationKey,
          line.expected.subtype,
        )
        observed.push({
          caseId: line.caseId,
          payload: pick(fact?.payload, line.expected),
        })
        expected.push({ caseId: line.caseId, payload: line.expected })
      }
      expect(statusRecords(records, "native_resume_validated")).toHaveLength(
        group === "matching-success" ? 1 : 0,
      )
    }
    expect(observed).toEqual(expected)
    expect(serializedAll.join("\n")).not.toContain("thread/started")
  })

  test("S33 Codex response validates the requested native thread — wrong-thread, absent-session, -32600 missing/malformed and -32603 corrupt responses yield native_resume_rejected with a reason and the original native code, never validated or expired", async () => {
    const groups = [
      "wrong-thread",
      "absent-session",
      "missing-32600",
      "malformed-32600",
      "corrupt-32603",
    ]
    const observed: unknown[] = []
    const expected: unknown[] = []
    for (const group of groups) {
      const { lines, records } = await runGroup(
        codexResume,
        group,
        "codex",
        RUNTIME,
      )
      const line = lines[0]
      const fact = factFor(
        records,
        line.observationKey,
        "native_resume_rejected",
      )
      observed.push({
        group,
        payload: pick(fact?.payload, line.expected),
        hasReason:
          typeof fact?.payload?.reason === "string" &&
          fact.payload.reason.length > 0,
        validated: statusRecords(records, "native_resume_validated").length,
        mentionsExpired: /expired/i.test(JSON.stringify(records)),
        fabricatedThreadStarted:
          JSON.stringify(records).includes("thread/started"),
      })
      expected.push({
        group,
        payload: line.expected,
        hasReason: true,
        validated: 0,
        mentionsExpired: false,
        fabricatedThreadStarted: false,
      })
    }
    expect(observed).toEqual(expected)
  })

  test("S33 Codex response validates the requested native thread — otherwise valid ephemeral / missing-path / missing-cliVersion responses stay validated with durableEvidence=false and lossPossible=true", async () => {
    const observed: unknown[] = []
    const expected: unknown[] = []
    for (const group of ["ephemeral", "missing-path", "missing-cliVersion"]) {
      const { lines, records } = await runGroup(
        codexResume,
        group,
        "codex",
        RUNTIME,
      )
      const line = lines[0]
      const fact = factFor(
        records,
        line.observationKey,
        "native_resume_validated",
      )
      observed.push({ group, payload: pick(fact?.payload, line.expected) })
      expected.push({ group, payload: line.expected })
    }
    expect(observed).toEqual(expected)
  })

  test("S33 Codex response validates the requested native thread — CODEX-05 no-rollout response beside turn/start is native_resume_rejected with raceContext=start_resume_no_rollout, intent and native code, without changing readOutcome", async () => {
    const { ledger, lines, records } = await runGroup(
      codexResume,
      "codex05-race",
      "codex",
      RUNTIME,
    )
    const [turnStart, resume] = lines
    const protocol = factFor(
      records,
      turnStart.observationKey,
      "protocol_response",
    )
    expect(pick(protocol?.payload, turnStart.expected)).toEqual(
      turnStart.expected,
    )
    const { readOutcome: expectedOutcome, ...expectedFact } = resume.expected
    const fact = factFor(
      records,
      resume.observationKey,
      "native_resume_rejected",
    )
    expect(pick(fact?.payload, expectedFact)).toEqual(expectedFact)
    expect(await ledger.readOutcome()).toBe(expectedOutcome)
    expect(completedRecords(records)).toHaveLength(0)
  })

  test("S34 Claude correlated init validates resume independently of turn success — only a correlated system/init with resume equality or a distinct fork UUID yields native_resume_validated; fork-equals-source, mismatched init, pre-init result (success+is_error), no-init error and No conversation found yield native_resume_rejected; an init from another query validates nothing", async () => {
    const groups = [
      "ordinary",
      "fork",
      "fork-same-id",
      "mismatched-init",
      "unrelated-init",
      "result-success-is-error",
      "no-init",
      "no-conversation-found",
    ]
    const observed: unknown[] = []
    const expected: unknown[] = []
    for (const group of groups) {
      const { lines, records } = await runGroup(
        claudeResume,
        group,
        "claude-code",
        CLAUDE_RUNTIME,
      )
      const line = lines[lines.length - 1]
      const validated = statusRecords(records, "native_resume_validated").length
      const rejected = statusRecords(records, "native_resume_rejected").length
      observed.push({ group, validated, rejected })
      expected.push({
        group,
        validated: line.expected.subtype === "native_resume_validated" ? 1 : 0,
        rejected: line.expected.subtype === "native_resume_rejected" ? 1 : 0,
      })
    }
    expect(observed).toEqual(expected)
  })

  test("S34 Claude correlated init validates resume independently of turn success — a later auth failure after a validated init leaves exactly one unchanged validation fact and adds no rejection or terminal", async () => {
    const { lines, records } = await runGroup(
      claudeResume,
      "ordinary-then-auth-failure",
      "claude-code",
      CLAUDE_RUNTIME,
    )
    const [init, authFailure] = lines
    const validated = statusRecords(records, "native_resume_validated")
    expect(validated).toHaveLength(authFailure.expected.validatedCount)
    expect(statusRecords(records, "native_resume_rejected")).toHaveLength(
      authFailure.expected.rejectedCount,
    )
    expect(recordsForKey(validated, init.observationKey)).toHaveLength(1)
    expect(completedRecords(records)).toHaveLength(0)
  })

  test("S34 Claude correlated init validates resume independently of turn success — the No conversation found rejection carries the sanitized native diagnostic without SESSION_EXPIRED or proven-expiry wording", async () => {
    const { lines, records } = await runGroup(
      claudeResume,
      "no-conversation-found",
      "claude-code",
      CLAUDE_RUNTIME,
    )
    const line = lines[0]
    const fact = factFor(records, line.observationKey, "native_resume_rejected")
    expect(JSON.stringify(fact?.payload ?? null)).toContain(
      "No conversation found",
    )
    const serialized = JSON.stringify(records)
    for (const forbidden of line.expected.forbidden) {
      expect(serialized.toLowerCase()).not.toContain(
        String(forbidden).toLowerCase(),
      )
    }
  })

  test("S34 Claude correlated init validates resume independently of turn success — classifyClaudeAgentSdkStreamError maps No conversation found stderr to neutral NATIVE_RESUME_REJECTED, never SESSION_EXPIRED", async () => {
    const { classifyClaudeAgentSdkStreamError } = await import(
      "../src/main/lib/claude/agent-sdk-errors"
    )
    const line = claudeResume.lines.find(
      (l) => l.group === "no-conversation-found",
    )
    const stderr = String(line?.input.message.errors[0])
    const diagnostic = classifyClaudeAgentSdkStreamError({
      error: new Error("stream ended"),
      stderrOutput: stderr,
    })
    expect(diagnostic.category).toBe("NATIVE_RESUME_REJECTED")
    expect(diagnostic.context.toLowerCase()).not.toContain("expired")
  })

  test("S34 Claude correlated init validates resume independently of turn success — stream-error finalization keeps the existing sessionId intact and reports NATIVE_RESUME_REJECTED without expiry wording", async () => {
    const { finalizeClaudeAgentSdkStreamError } = await import(
      "../src/main/lib/claude/agent-sdk-stream-error-finalization"
    )
    const line = claudeResume.lines.find(
      (l) => l.group === "no-conversation-found",
    )
    const db = createAgentJobTestDb()
    db.insert(projects)
      .values({ id: "project-1", name: "Project", path: "/repo" })
      .run()
    db.insert(chats)
      .values({ id: "chat-1", projectId: "project-1", worktreePath: "/repo" })
      .run()
    db.insert(subChats)
      .values({
        id: "sub-1",
        chatId: "chat-1",
        sessionId: "old-session",
        streamId: "stream-1",
        messages: JSON.stringify([{ id: "existing", role: "user" }]),
      })
      .run()
    const controller = new AbortController()
    setActiveClaudeSession("sub-1", { controller, runId: "run-1" })
    const emit = mock((_chunk: unknown) => {})
    const result = await finalizeClaudeAgentSdkStreamError({
      streamError: new Error("stream ended"),
      stderrLines: [String(line?.input.message.errors[0])],
      isUsingOllama: false,
      messageCount: 1,
      db,
      chatId: "chat-1",
      subChatId: "sub-1",
      activeSessionSignal: controller.signal,
      messagesToSave: [],
      parts: [],
      metadata: { sessionId: "old-session" },
      currentText: "",
      historyEnabled: false,
      cwd: "/repo",
      mode: "agent",
      aborted: false,
      guardedContract: null,
      guardedPreRunStatus: null,
      guardEvents: [],
      guardedRunStartedAt: "2026-09-04T00:00:00.000Z",
      subId: "sub-1",
      chunkCount: 1,
      lastChunkType: "start",
      emit,
      complete: mock(() => {}),
      deleteContract: () => undefined,
      log: mock(() => {}),
    })
    const emitted = JSON.stringify(emit.mock.calls).toLowerCase()
    expect({
      code: result.error.code,
      sessionId: db
        .select()
        .from(subChats)
        .where(eq(subChats.id, "sub-1"))
        .get()?.sessionId,
      emittedExpiryWording: emitted.includes("expired"),
    }).toEqual({
      code: "NATIVE_RESUME_REJECTED",
      sessionId: "old-session",
      emittedExpiryWording: false,
    })
  })
})

// ---------------------------------------------------------------------------
describe("agent-runtime-core / Resume Snapshot Repair", () => {
  const snapshotRepair = loadJsonFixture("snapshot-repair.json")
  const snapshotFailed = loadJsonFixture("snapshot-failed.json")
  const snapshotVersions = loadJsonFixture("snapshot-versions.json")

  async function repairCase(
    runId: string,
    provenance: unknown,
    fixtureCase: any,
  ) {
    const store = new MemoryDurableStore({ runId })
    const ledger = await createLedger({
      runId,
      runtimeId: "codex",
      provenance,
      store,
    })
    for (const step of fixtureCase.localSteps) await applyStep(ledger, step)
    const highWaterBefore = store.highWater()
    await ledger.repairFromSnapshot(fixtureCase.repair)
    const records = await ledger.read(0)
    return { ledger, store, records, highWaterBefore }
  }

  test('S35 Resume snapshot repairs an incomplete item — local prefix "hel" plus a recognized completed "hello" becomes readItem text "hello" with suffix_repaired, and a fresh status/repair (repair.source=snapshot, lossPossible) is appended at the next Locus sequence; readOutcome stays null', async () => {
    const fixtureCase = snapshotRepair.cases.find(
      (c: any) => c.caseId === "prefix-hel",
    )
    const { ledger, records, highWaterBefore } = await repairCase(
      "run-b-s35-prefix",
      snapshotRepair.provenance.ledgerProvenance,
      fixtureCase,
    )
    const item = await ledger.readItem(fixtureCase.itemKey)
    expect(item).toMatchObject({
      state: fixtureCase.expected.state,
      text: fixtureCase.expected.text,
      reconciliation: {
        result: fixtureCase.expected.result,
        lossPossible: fixtureCase.expected.lossPossible,
      },
    })
    const repairs = statusRecords(
      recordsForKey(records, fixtureCase.repair.observationKey),
      "repair",
    )
    expect(repairs).toHaveLength(1)
    expect(repairs[0].payload).toMatchObject({
      repair: { source: fixtureCase.expected.repairSource },
      lossPossible: true,
    })
    expect(repairs[0].sequence).toBeGreaterThan(highWaterBefore)
    expect(await ledger.readOutcome()).toBe(fixtureCase.expected.readOutcome)
    expect(completedRecords(records)).toHaveLength(0)
    expect(sequencesOf(records)).toEqual(denseRange(records.length))
  })

  test("S35 Resume snapshot repairs an incomplete item — a completed snapshot item with no local item yields missing_local with the authoritative text and lossPossible=true, no terminal and a dense Locus cursor", async () => {
    const fixtureCase = snapshotRepair.cases.find(
      (c: any) => c.caseId === "no-local-item",
    )
    const { ledger, records } = await repairCase(
      "run-b-s35-nolocal",
      snapshotRepair.provenance.ledgerProvenance,
      fixtureCase,
    )
    expect(await ledger.readItem(fixtureCase.itemKey)).toMatchObject({
      state: fixtureCase.expected.state,
      text: fixtureCase.expected.text,
      reconciliation: {
        result: fixtureCase.expected.result,
        lossPossible: fixtureCase.expected.lossPossible,
      },
    })
    expect(await ledger.readOutcome()).toBe(fixtureCase.expected.readOutcome)
    expect(sequencesOf(records)).toEqual(denseRange(records.length))
  })

  test("S36 Durable failure survives degraded native snapshot — after a committed live failed terminal (401) and a reopened store, CODEX-08's completed/error-null snapshot becomes status/late_event (repair.source=snapshot, diagnosticOnly, lossPossible) and readOutcome plus the stored completed stay failed with the original error", async () => {
    const fixtureCase = snapshotFailed.cases.find(
      (c: any) => c.caseId === "durable-failed-then-degraded-snapshot",
    )
    const runId = "run-b-s36-failed"
    const provenance = snapshotFailed.provenance.ledgerProvenance
    const store = new MemoryDurableStore({ runId })
    const live = await createLedger({
      runId,
      runtimeId: "codex",
      provenance,
      store,
    })
    for (const step of fixtureCase.liveSteps) await applyStep(live, step)
    await live.settle(fixtureCase.settle)
    const completedBefore = JSON.stringify(completedRecords(await live.read(0)))

    const reopened = await createLedger({
      runId,
      runtimeId: "codex",
      provenance,
      store,
    })
    await reopened.repairFromSnapshot(fixtureCase.repair)
    const records = await reopened.read(0)
    const completed = completedRecords(records)
    expect(completed).toHaveLength(1)
    expect(JSON.stringify(completed)).toBe(completedBefore)
    expect(completed[0].payload).toMatchObject({
      status: fixtureCase.expected.completedStatus,
    })
    expect(JSON.stringify(completed[0].payload)).toContain(
      fixtureCase.expected.errorText,
    )
    expect(await reopened.readOutcome()).toMatchObject({
      status: fixtureCase.expected.completedStatus,
    })
    const late = recordsForKey(records, fixtureCase.repair.observationKey)
    expect(late.length).toBeGreaterThan(0)
    for (const record of late) {
      expect(record.type).toBe("status")
      expect(record.payload).toMatchObject({
        subtype: fixtureCase.expected.lateSubtype,
        diagnosticOnly: fixtureCase.expected.diagnosticOnly,
        lossPossible: fixtureCase.expected.lossPossible,
        repair: { source: fixtureCase.expected.repairSource },
        terminalSequence: completed[0].sequence,
      })
    }
  })

  test("S36 Durable failure survives degraded native snapshot — with no durable terminal the degraded completed snapshot cannot settle the Run; the later transport exit settles interrupted, never succeeded", async () => {
    const fixtureCase = snapshotFailed.cases.find(
      (c: any) => c.caseId === "no-durable-terminal",
    )
    const runId = "run-b-s36-no-terminal"
    const store = new MemoryDurableStore({ runId })
    const ledger = await createLedger({
      runId,
      runtimeId: "codex",
      provenance: snapshotFailed.provenance.ledgerProvenance,
      store,
    })
    for (const step of fixtureCase.liveSteps) await applyStep(ledger, step)
    await ledger.repairFromSnapshot(fixtureCase.repair)
    expect(await ledger.readOutcome()).toBe(
      fixtureCase.expected.outcomeAfterRepair,
    )
    expect(completedRecords(await ledger.read(0))).toHaveLength(0)
    await ledger.ingestTransportExit(fixtureCase.exit)
    const completed = completedRecords(await ledger.read(0))
    expect(completed.map((record: any) => record.payload?.status)).toEqual([
      fixtureCase.expected.completedStatusAfterExit,
    ])
    expect(await ledger.readOutcome()).toMatchObject({
      status: fixtureCase.expected.completedStatusAfterExit,
    })
  })

  test("S37 Cross-version snapshot reconciliation declares its evidence limits — recognized 0.139→0.149 and 0.149→0.139 synthetic snapshots keep the final item text, the source creator version and both reproducible schema fingerprints on a fresh-sequence repair record", async () => {
    const observed: unknown[] = []
    const expected: unknown[] = []
    for (const caseId of ["0.139-to-0.149", "0.149-to-0.139"]) {
      const fixtureCase = snapshotVersions.cases.find(
        (c: any) => c.caseId === caseId,
      )
      const { ledger, records, highWaterBefore } = await repairCase(
        `run-b-s37-${caseId}`,
        fixtureCase.ledgerProvenance,
        fixtureCase,
      )
      const item = await ledger.readItem(fixtureCase.itemKey)
      const repairs = recordsForKey(records, fixtureCase.repair.observationKey)
      const serializedRepair = JSON.stringify(repairs)
      observed.push({
        caseId,
        state: item?.state,
        text: item?.text,
        repairAtFreshSequence:
          repairs.length > 0 &&
          repairs.every((record: any) => record.sequence > highWaterBefore),
        repairSource: statusRecords(repairs, "repair")[0]?.payload?.repair
          ?.source,
        creatorVersion: serializedRepair.includes(
          fixtureCase.expected.creatorVersion,
        ),
        fingerprints: fixtureCase.expected.fingerprints.map((sha: string) =>
          serializedRepair.includes(sha),
        ),
        outcome: await ledger.readOutcome(),
      })
      expected.push({
        caseId,
        state: fixtureCase.expected.state,
        text: fixtureCase.expected.text,
        repairAtFreshSequence: true,
        repairSource: "snapshot",
        creatorVersion: true,
        fingerprints: fixtureCase.expected.fingerprints.map(() => true),
        outcome: null,
      })
    }
    expect(observed).toEqual(expected)
  })

  test("S37 Cross-version snapshot reconciliation declares its evidence limits — an incompatible-schema snapshot records mismatch/lossPossible without guessing item state", async () => {
    const fixtureCase = snapshotVersions.cases.find(
      (c: any) => c.caseId === "incompatible-schema",
    )
    const { ledger, records } = await repairCase(
      "run-b-s37-incompatible",
      fixtureCase.ledgerProvenance,
      fixtureCase,
    )
    const repair = statusRecords(
      recordsForKey(records, fixtureCase.repair.observationKey),
      "repair",
    )
    expect(repair).toHaveLength(1)
    expect(repair[0].payload).toMatchObject({
      repair: { source: "snapshot", result: fixtureCase.expected.result },
      lossPossible: fixtureCase.expected.lossPossible,
    })
    const item = await ledger.readItem(fixtureCase.itemKey)
    expect(item?.state === "completed").toBe(false)
  })

  test("S37 Cross-version snapshot reconciliation declares its evidence limits — a pre-seal local item absent from the authoritative snapshot is missing_native/lossPossible, keeps its local text as unverified and never gains an invented native completion", async () => {
    const fixtureCase = snapshotVersions.cases.find(
      (c: any) => c.caseId === "local-item-missing-native",
    )
    const { ledger } = await repairCase(
      "run-b-s37-missing-native",
      fixtureCase.ledgerProvenance,
      fixtureCase,
    )
    const item = await ledger.readItem(fixtureCase.itemKey)
    expect(item).toMatchObject({
      text: fixtureCase.expected.text,
      reconciliation: {
        result: fixtureCase.expected.result,
        lossPossible: fixtureCase.expected.lossPossible,
      },
    })
    expect(item.state === "completed").toBe(false)
  })
})
