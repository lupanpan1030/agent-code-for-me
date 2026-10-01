/**
 * Test harness for the surfaces domain of the independent RED suite of
 * `openspec/changes/refactor-unified-runtime-route-catalog` (S07, S14–S20,
 * S53). Test infrastructure only, never product code.
 *
 * - Product modules the design names as NEW
 *   (`agent-runtime/runtime-route-catalog.ts`,
 *   `agent-runtime/runtime-route-read-model.ts`,
 *   `renderer/features/agents/lib/runtime-route-transport.ts`) are loaded
 *   lazily inside the test that needs them, so a missing module fails that
 *   test only, never the file at load.
 * - Native leaf I/O (process spawn, bundled-binary lookup, shell env,
 *   credential store) is replaced by recording stubs at the leaf side only
 *   (design D1 "6192b13f baseline": recording stubs at process/native I/O,
 *   still through runAgentTask). No `options.runner` and no
 *   `LOCUS_HEADLESS_FAKE_RUNNER` is ever used by this kit.
 * - The test catalog is built through the design's test-only constructor
 *   `createRuntimeRouteCatalogForTests(declarations, references)`. The
 *   declaration fields and reference-port names are NOT frozen by the
 *   approved design (tasks 2.2 defers them); this kit freezes them in one
 *   place (`surfaceRouteDeclarations` / `buildRecordingCatalog`) and the
 *   report lists them as frozen shapes for coordinator reconciliation.
 * - Every database is a temporary migrated SQLite profile; every temporary
 *   directory is removed by the caller through `cleanupSurfaceTemps()`.
 */

import { mock } from "bun:test"
import { spawnSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough, Readable } from "node:stream"
import type {
  AgentRuntimeObserver,
  AgentRuntimeRunRequest,
  AgentRuntimeRunResult,
} from "../src/main/lib/headless/agent-runtime-contract"
import type { AgentRuntimeCapabilityManifest } from "../src/shared/agent-runtime-capabilities"
import {
  createMigratedLedgerDb,
  type MigratedLedgerDb,
} from "./run-event-ledger-domain-b-kit"

export const REPO_ROOT = join(import.meta.dir, "..")
export const FIXTURE_DIR = join(
  import.meta.dir,
  "fixtures",
  "runtime-route-catalog",
)
export const HEADLESS_MARKER_ARG = "--locus-headless-cli"
export const API_VERSION = "locus.local-job.v1"
export const ROUTE_CATALOG_MODULE =
  "../src/main/lib/agent-runtime/runtime-route-catalog"
export const ROUTE_READ_MODEL_MODULE =
  "../src/main/lib/agent-runtime/runtime-route-read-model"
export const ROUTE_TRANSPORT_MODULE =
  "../src/renderer/features/agents/lib/runtime-route-transport"

export type Json = Record<string, unknown>

export function isJson(value: unknown): value is Json {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export function loadFixtureFile(name: string): Json {
  const parsed: unknown = JSON.parse(
    readFileSync(join(FIXTURE_DIR, name), "utf8"),
  )
  if (!isJson(parsed)) throw new Error(`${name}: fixture is not an object`)
  if (parsed.fixtureVersion !== 1) {
    throw new Error(`${name}: unsupported fixtureVersion`)
  }
  if (parsed.evidenceClass !== "synthetic") {
    throw new Error(`${name}: evidenceClass must be synthetic`)
  }
  return parsed
}

/** The `file.json#Sxx` value named by a spec GIVEN clause. */
export function fixtureKey<T = Json>(file: string, key: string): T {
  const fixture = loadFixtureFile(file)
  const value = fixture[key]
  if (value === undefined) throw new Error(`${file}: missing key ${key}`)
  return value as T
}

/** Renders `{{NAME}}` placeholders (never absolute checkout paths). */
export function render<T>(template: T, values: Record<string, string>): T {
  let text = JSON.stringify(template)
  for (const [name, value] of Object.entries(values)) {
    text = text.split(`{{${name}}}`).join(value)
  }
  return JSON.parse(text) as T
}

// ---------------------------------------------------------------------------
// Settled results (no swallowing try/catch in tests)
// ---------------------------------------------------------------------------

export type Settled<T> = { ok: true; value: T } | { ok: false; error: string }

export async function settle<T>(
  run: () => T | Promise<T>,
): Promise<Settled<T>> {
  return await Promise.resolve()
    .then(run)
    .then(
      (value): Settled<T> => ({ ok: true, value }),
      (error: unknown): Settled<T> => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
}

export function settledValue<T>(result: Settled<T>, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.error}`)
  return result.value
}

// ---------------------------------------------------------------------------
// Lazy NEW-module loaders
// ---------------------------------------------------------------------------

export type RouteCatalogModule = {
  createRuntimeRouteCatalogForTests: (
    declarations: readonly Json[],
    references: Record<string, (ref: unknown) => unknown>,
  ) => unknown
  resolveRuntimeRoute: (query: Json, catalog?: unknown) => Json
  listRuntimeRoutes: (filter: Json, catalog?: unknown) => readonly Json[]
  projectRuntimeRoutes: (
    audience: "public" | "renderer",
    catalog?: unknown,
  ) => readonly Json[]
}

export type RouteReadModelModule = {
  withRuntimeRouteTransportId: (binding: Json, catalog?: unknown) => Json
}

export type RouteTransportResult =
  | { ok: true; transport: unknown }
  | { ok: false; failure: string }

export type RouteTransportInput =
  | { state: "loaded"; transportId: string }
  | { state: "not-loaded" }
  | { state: "error" }

export type RouteTransportModule = {
  createRuntimeRouteTransport: (
    input: RouteTransportInput,
    config: Json,
  ) => RouteTransportResult
}

export async function loadRouteCatalogModule(): Promise<RouteCatalogModule> {
  // Enforces once the NEW single owner module exists (design D2 row 1).
  return (await import(ROUTE_CATALOG_MODULE)) as RouteCatalogModule
}

export async function loadRouteReadModelModule(): Promise<RouteReadModelModule> {
  // Enforces once the NEW main read-model helper exists (design D2/D3).
  return (await import(ROUTE_READ_MODEL_MODULE)) as RouteReadModelModule
}

export async function loadRouteTransportModule(): Promise<RouteTransportModule> {
  // Enforces once the NEW renderer helper exists (design D2/D3).
  return (await import(ROUTE_TRANSPORT_MODULE)) as RouteTransportModule
}

// ---------------------------------------------------------------------------
// Leaf-side native I/O stubs (process spawn / binary / shell env / creds)
// ---------------------------------------------------------------------------

export type ProcessCall = {
  jobId: string
  runtimeId: string
  source: string
  executionProfile: string
  executable: string
  args: string[]
  stdin: string | null
  label: string
  cancellationPort: "abort-signal" | "missing"
  abortedAtStart: boolean
}

/** Every leaf process start, in order (reset per test by the caller). */
export const processCalls: ProcessCall[] = []

export const FIXTURE_CLAUDE_EXECUTABLE = "/fixture/bin/claude"
export const FIXTURE_CODEX_EXECUTABLE = "/fixture/bin/codex"

function processCallOf(input: Json): ProcessCall {
  const request = input.request as AgentRuntimeRunRequest
  return {
    jobId: request.identity.jobId,
    runtimeId: request.context.runtimeId,
    source: request.context.source,
    executionProfile: String(request.context.executionProfile ?? "batch"),
    executable: String(input.executable),
    args: [...(input.args as string[])],
    stdin: typeof input.stdin === "string" ? input.stdin : null,
    label: String(input.label),
    cancellationPort:
      request.signal instanceof AbortSignal ? "abort-signal" : "missing",
    abortedAtStart: request.signal?.aborted === true,
  }
}

/**
 * Replaces only the leaf-side native I/O: the headless process runner (no
 * child is ever spawned), the bundled-binary path lookups, the login-shell
 * env and the Claude credential store. Must run before any product module
 * that imports them is loaded.
 */
export async function installHeadlessLeafIoMocks(): Promise<void> {
  mock.module("electron", () => ({
    app: {
      isPackaged: false,
      getAppPath: () => REPO_ROOT,
      getPath: () => tmpdir(),
    },
    BrowserWindow: class BrowserWindow {},
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value: string) => Buffer.from(value, "utf8"),
      decryptString: (value: Buffer) => value.toString("utf8"),
    },
  }))
  const realProcessRunner = await import(
    "../src/main/lib/headless/process-runner"
  )
  mock.module("../src/main/lib/headless/process-runner", () => ({
    ...realProcessRunner,
    runProcessAgentTask: async (
      input: Json & { observer: AgentRuntimeObserver },
    ): Promise<AgentRuntimeRunResult> => {
      processCalls.push(processCallOf(input))
      input.observer.appendEvent("assistant_delta", {
        text: "surfaces fixture output",
      })
      return {
        status: "succeeded",
        exitCode: 0,
        result: { finalMessage: "surfaces fixture done" },
      }
    },
    bindProcessRunExecutionProvenance: async () => {},
  }))
  const realClaudeEnv = await import("../src/main/lib/claude/env")
  mock.module("../src/main/lib/claude/env", () => ({
    ...realClaudeEnv,
    getClaudeShellEnvironment: () => ({ PATH: "/usr/bin" }),
    buildClaudeEnv: (options?: { customEnv?: Record<string, string> }) => ({
      PATH: "/usr/bin",
      ...(options?.customEnv ?? {}),
    }),
    getBundledClaudeBinaryPath: () => FIXTURE_CLAUDE_EXECUTABLE,
    readBundledClaudeBinaryVersion: () => "fixture",
  }))
  const realClaudeCredentials = await import(
    "../src/main/lib/claude-credentials"
  )
  mock.module("../src/main/lib/claude-credentials", () => ({
    ...realClaudeCredentials,
    hasAnyClaudeCodeAccount: () => false,
    getValidClaudeCodeCredential: async () => {
      throw new Error("surfaces fixture: no credential store")
    },
  }))
  const realCodexCliPath = await import("../src/main/lib/codex/cli-path")
  mock.module("../src/main/lib/codex/cli-path", () => ({
    ...realCodexCliPath,
    resolveBundledCodexCliPath: () => FIXTURE_CODEX_EXECUTABLE,
  }))
}

// ---------------------------------------------------------------------------
// Test catalog — shared declaration table (catalog.json#S01)
// ---------------------------------------------------------------------------
//
// The approved design does not freeze RuntimeRouteDeclaration fields or the
// RuntimeRouteCatalogReferences port names (tasks 2.2). To keep ONE frozen
// shape across the red suite, this kit consumes the shared synthetic table of
// the catalog-core author (`catalog.json#S01`: per-runtime declarations with
// `routes[]` carrying factoryRef / readinessProbeRef / enforcementEvidenceRef,
// plus a `ports` block) and the same reference-port names
// (normalizeRuntimeId, getManifest, lookupAgentFactory, lookupReadinessProbe,
// lookupEnforcementEvidence). Routes are addressed here by
// (runtimeId, executionSurface), never by a hard-coded factoryRef.

export type SharedPorts = {
  manifests: Record<string, string>
  factories: string[]
  probes: Record<string, string>
  evidence: Record<string, string>
}

export type SharedDeclarationTable = {
  declarations: Json[]
  ports: SharedPorts
}

export type RouteRow = {
  runtimeId: string
  routeId: string
  executionSurface: string
  executionProfile: string | null
  kind: string
  factoryRef: string | null
  transportId: string | null
}

export function sharedDeclarationTable(): SharedDeclarationTable {
  const s01 = fixtureKey<Json>("catalog.json", "S01")
  const declarations = s01.declarations
  const ports = s01.ports
  if (!Array.isArray(declarations) || !isJson(ports)) {
    throw new Error("catalog.json#S01 lacks declarations/ports")
  }
  return JSON.parse(
    JSON.stringify({ declarations, ports }),
  ) as SharedDeclarationTable
}

export function routeRows(table: SharedDeclarationTable): RouteRow[] {
  const rows: RouteRow[] = []
  for (const declaration of table.declarations) {
    const routes = Array.isArray(declaration.routes) ? declaration.routes : []
    for (const route of routes) {
      if (!isJson(route)) continue
      rows.push({
        runtimeId: String(declaration.runtimeId),
        routeId: String(route.routeId),
        executionSurface: String(route.executionSurface),
        executionProfile:
          typeof route.executionProfile === "string"
            ? route.executionProfile
            : null,
        kind: String(route.kind),
        factoryRef:
          typeof route.factoryRef === "string" ? route.factoryRef : null,
        transportId:
          typeof route.transportId === "string" ? route.transportId : null,
      })
    }
  }
  return rows
}

export function routeFor(
  table: SharedDeclarationTable,
  runtimeId: string,
  executionSurface: string,
): RouteRow {
  const row = routeRows(table).find(
    (candidate) =>
      candidate.runtimeId === runtimeId &&
      candidate.executionSurface === executionSurface,
  )
  if (!row) {
    throw new Error(`shared table lacks ${runtimeId} ${executionSurface}`)
  }
  return row
}

export type HeadlessDelegate = (
  request: AgentRuntimeRunRequest,
  observer: AgentRuntimeObserver,
) => Promise<AgentRuntimeRunResult>

export type DelegateInvocation = {
  runtimeId: string
  executionSurface: string
  jobId: string
  source: string
  executionProfile: string
}

export type FactoryLookup = { runtimeId: string; executionSurface: string }

export type RecordingCatalog = {
  state: unknown
  table: SharedDeclarationTable
  /** agent-factory reference lookups made while the catalog validated. */
  validationLookups: FactoryLookup[]
  /** agent-factory reference lookups after validation (post-binding). */
  lookups: FactoryLookup[]
  invocations: DelegateInvocation[]
  timeline: string[]
}

/** A headless delegate that returns a canned success (no native work). */
export function cannedHeadlessDelegate(text: string): HeadlessDelegate {
  return async (_request, observer) => {
    observer.appendEvent("assistant_delta", { text })
    return {
      status: "succeeded",
      exitCode: 0,
      result: { finalMessage: text },
    }
  }
}

/** Canned delegates for every agent route of the shared table. */
export function cannedDelegates(): (row: RouteRow) => unknown {
  return (row) => cannedHeadlessDelegate(`${row.routeId} fixture output`)
}

/**
 * Builds a validated test catalog through the design's test-only
 * constructor `createRuntimeRouteCatalogForTests(declarations, references)`.
 * Function delegates are wrapped so each invocation is recorded; the
 * agent-factory reference port records lookups (validation lookups and
 * post-binding lookups are counted separately, tasks 2.2).
 */
export async function buildRecordingCatalog(input: {
  delegates: (row: RouteRow) => unknown
  table?: SharedDeclarationTable
  manifests?: Record<string, AgentRuntimeCapabilityManifest>
  timeline?: string[]
  tag?: string
  beforeInvoke?: (invocation: DelegateInvocation) => Promise<void> | void
}): Promise<RecordingCatalog> {
  const catalogModule = await loadRouteCatalogModule()
  const { getAgentRuntimeCapabilityManifest, toAgentRuntimeId } = await import(
    "../src/shared/agent-runtime-capabilities"
  )
  const table = input.table ?? sharedDeclarationTable()
  const rows = routeRows(table)
  const timeline = input.timeline ?? []
  const tag = input.tag ? `${input.tag}:` : ""
  const recorder: RecordingCatalog = {
    state: null,
    table,
    validationLookups: [],
    lookups: [],
    invocations: [],
    timeline,
  }
  let validated = false
  const wrapped = new Map<string, unknown>()
  for (const row of rows) {
    if (!row.factoryRef) continue
    const delegate = input.delegates(row)
    if (typeof delegate !== "function") {
      wrapped.set(row.factoryRef, delegate)
      continue
    }
    const inner = delegate as HeadlessDelegate
    wrapped.set(
      row.factoryRef,
      async (
        request: AgentRuntimeRunRequest,
        observer: AgentRuntimeObserver,
      ) => {
        const invocation: DelegateInvocation = {
          runtimeId: row.runtimeId,
          executionSurface: row.executionSurface,
          jobId: request.identity.jobId,
          source: request.context.source,
          executionProfile: String(request.context.executionProfile ?? "batch"),
        }
        recorder.invocations.push(invocation)
        timeline.push(
          `${tag}invoke:${row.executionSurface}:${invocation.jobId}`,
        )
        await input.beforeInvoke?.(invocation)
        return inner(request, observer)
      },
    )
  }
  const extraRuntimeIds = new Set(
    Object.values(table.ports.manifests).filter(
      (runtimeId) => input.manifests?.[runtimeId] !== undefined,
    ),
  )
  const references = {
    normalizeRuntimeId: (raw: unknown) =>
      typeof raw === "string" && extraRuntimeIds.has(raw)
        ? raw
        : toAgentRuntimeId(typeof raw === "string" ? raw : null),
    getManifest: (ref: unknown) => {
      const runtimeId = table.ports.manifests[String(ref)]
      if (typeof runtimeId !== "string") return null
      const fixtureManifest = input.manifests?.[runtimeId]
      if (fixtureManifest) return fixtureManifest
      const canonical = toAgentRuntimeId(runtimeId)
      return canonical ? getAgentRuntimeCapabilityManifest(canonical) : null
    },
    lookupAgentFactory: (ref: unknown) => {
      const factoryRef = String(ref)
      const row = rows.find((candidate) => candidate.factoryRef === factoryRef)
      const lookup: FactoryLookup = {
        runtimeId: row?.runtimeId ?? "unknown",
        executionSurface: row?.executionSurface ?? factoryRef,
      }
      if (validated) {
        recorder.lookups.push(lookup)
        timeline.push(`${tag}lookup:${lookup.executionSurface}`)
      } else {
        recorder.validationLookups.push(lookup)
      }
      return wrapped.get(factoryRef) ?? null
    },
    lookupReadinessProbe: (ref: unknown) => {
      const state = table.ports.probes[String(ref)]
      return typeof state === "string" ? async () => ({ state }) : null
    },
    lookupEnforcementEvidence: (ref: unknown) => {
      const level = table.ports.evidence[String(ref)]
      return typeof level === "string" ? level : null
    },
  }
  const state = catalogModule.createRuntimeRouteCatalogForTests(
    table.declarations,
    references,
  )
  if (
    isJson(state) &&
    state.ok === false &&
    state.reason === "catalog_invalid"
  ) {
    throw new Error(
      `surfaces test catalog failed validation: ${JSON.stringify(state)}`,
    )
  }
  validated = true
  recorder.state = state
  return recorder
}

/** A failure state: the shared table plus a duplicate (overlapping) route. */
export async function buildFailureStateCatalog(): Promise<unknown> {
  const catalogModule = await loadRouteCatalogModule()
  const { getAgentRuntimeCapabilityManifest, toAgentRuntimeId } = await import(
    "../src/shared/agent-runtime-capabilities"
  )
  const table = sharedDeclarationTable()
  const first = table.declarations[0]
  const routes = Array.isArray(first.routes) ? [...first.routes] : []
  const duplicated = routes.find(
    (route) => isJson(route) && route.executionSurface === "headless-exec",
  )
  if (!isJson(duplicated)) throw new Error("shared table lacks a batch route")
  table.declarations[0] = {
    ...first,
    routes: [
      ...routes,
      { ...duplicated, routeId: `${duplicated.routeId}.dup` },
    ],
  }
  return catalogModule.createRuntimeRouteCatalogForTests(table.declarations, {
    normalizeRuntimeId: (raw: unknown) =>
      toAgentRuntimeId(typeof raw === "string" ? raw : null),
    getManifest: (ref: unknown) => {
      const runtimeId = toAgentRuntimeId(table.ports.manifests[String(ref)])
      return runtimeId ? getAgentRuntimeCapabilityManifest(runtimeId) : null
    },
    lookupAgentFactory: () => cannedHeadlessDelegate("never"),
    lookupReadinessProbe: () => async () => ({ state: "unknown" }),
    lookupEnforcementEvidence: (ref: unknown) =>
      table.ports.evidence[String(ref)] ?? null,
  })
}

// ---------------------------------------------------------------------------
// Profiles and in-process hosts
// ---------------------------------------------------------------------------

const tempDirs: string[] = []

export function cleanupSurfaceTemps(): void {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true })
  }
}

export function surfaceTempDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(directory)
  return directory
}

export type SurfaceProfile = {
  mdb: MigratedLedgerDb
  projectRoot: string
  cwd: string
  close: () => void
}

/** A migrated temporary DB with one registered project (cwd = pkg dir). */
export function createSurfaceProfile(): SurfaceProfile {
  const mdb = createMigratedLedgerDb()
  const projectRoot = join(mdb.dir, "project-surfaces")
  const cwd = join(projectRoot, "pkg")
  mkdirSync(cwd, { recursive: true })
  mdb.sqlite
    .query("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)")
    .run("project-surfaces", "Project surfaces", projectRoot)
  return { mdb, projectRoot, cwd, close: () => mdb.close() }
}

export type CliResult = { code: number; stdout: string; stderr: string }

function bufferWriter() {
  let value = ""
  return {
    stream: {
      write(chunk: string) {
        value += chunk
        return true
      },
    },
    value: () => value,
  }
}

/** One in-process `locus ...` command; `args` follow the CLI marker. */
export async function runCli(
  db: unknown,
  args: string[],
  options: { stdin?: string; extra?: Json } = {},
): Promise<CliResult> {
  const { runHeadlessCliCommand } = await import(
    "../src/main/lib/headless/cli-dispatcher"
  )
  const stdout = bufferWriter()
  const stderr = bufferWriter()
  const code = await runHeadlessCliCommand({
    db,
    argv: ["Locus", HEADLESS_MARKER_ARG, ...args],
    stdin: Readable.from([options.stdin ?? ""]),
    stdout: stdout.stream,
    stderr: stderr.stream,
    env: {},
    appVersion: "0.0.route-catalog-red",
    ...(options.extra ?? {}),
  } as Parameters<typeof runHeadlessCliCommand>[0])
  return { code, stdout: stdout.value(), stderr: stderr.value() }
}

export function onlyJsonLine(stdout: string): Json {
  const lines = stdout.split("\n").filter((line) => line.trim().length > 0)
  if (lines.length !== 1) {
    throw new Error(`expected one JSON line, got ${lines.length}: ${stdout}`)
  }
  const parsed: unknown = JSON.parse(lines[0])
  if (!isJson(parsed)) throw new Error(`not a JSON object: ${lines[0]}`)
  return parsed
}

export function apiAgentRequest(input: {
  cwd: string
  runtime: string
  consumerId: string
  prompt: string
  idempotencyKey?: string
}): Json {
  return {
    apiVersion: API_VERSION,
    consumer: { id: input.consumerId },
    project: { cwd: input.cwd },
    runtime: { id: input.runtime },
    mode: "plan",
    prompt: { text: input.prompt },
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
  }
}

export type StdioSession = {
  lines: Json[]
  send: (message: Json) => void
  waitFor: (predicate: (line: Json) => boolean, label: string) => Promise<Json>
  end: () => void
  exit: Promise<number>
}

/** A `locus jobs-stdio` session over in-memory streams. */
export function startStdioSession(db: unknown, extra: Json = {}): StdioSession {
  const stdin = new PassThrough()
  const lines: Json[] = []
  let buffer = ""
  const stdout = {
    write(chunk: string) {
      buffer += chunk
      let index = buffer.indexOf("\n")
      while (index >= 0) {
        const raw = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        if (raw.trim().length > 0) {
          const parsed: unknown = JSON.parse(raw)
          if (isJson(parsed)) lines.push(parsed)
        }
        index = buffer.indexOf("\n")
      }
      return true
    },
  }
  const exit = import("../src/main/lib/headless/cli-dispatcher").then(
    ({ runHeadlessCliCommand }) =>
      runHeadlessCliCommand({
        db,
        argv: ["Locus", HEADLESS_MARKER_ARG, "jobs-stdio"],
        stdin,
        stdout,
        stderr: { write: () => true },
        env: {},
        ...extra,
      } as Parameters<typeof runHeadlessCliCommand>[0]),
  )
  return {
    lines,
    send: (message) => {
      stdin.write(`${JSON.stringify(message)}\n`)
    },
    waitFor: (predicate, label) =>
      until(() => lines.find(predicate) ?? null, label),
    end: () => {
      stdin.end()
    },
    exit,
  }
}

export async function until<T>(
  probe: () => T | null | undefined,
  label: string,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = probe()
    if (value !== null && value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

export type Latch = {
  promise: Promise<void>
  release: () => void
}

export function createLatch(): Latch {
  let release = () => {}
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export function jobRow(mdb: MigratedLedgerDb, jobId: string): Json {
  const row: unknown = mdb.sqlite
    .query("SELECT * FROM agent_jobs WHERE id = ?")
    .get(jobId)
  if (!isJson(row)) throw new Error(`missing job row ${jobId}`)
  return row
}

export function eventTypes(mdb: MigratedLedgerDb, jobId: string): string[] {
  return (
    mdb.sqlite
      .query(
        "SELECT type FROM agent_job_events WHERE job_id = ? ORDER BY sequence ASC",
      )
      .all(jobId) as { type: string }[]
  ).map((row) => row.type)
}

export function statusPayloads(mdb: MigratedLedgerDb, jobId: string): Json[] {
  return (
    mdb.sqlite
      .query(
        "SELECT payload_json FROM agent_job_events WHERE job_id = ? AND type = 'status' ORDER BY sequence ASC",
      )
      .all(jobId) as { payload_json: string }[]
  ).map((row) => JSON.parse(row.payload_json) as Json)
}

export function pick(value: Json, keys: readonly string[]): Json {
  const picked: Json = {}
  for (const key of keys) {
    if (Object.hasOwn(value, key)) picked[key] = value[key]
  }
  return picked
}

// ---------------------------------------------------------------------------
// Architecture guard (Runtime Route Catalog Single Owner section, D5)
// ---------------------------------------------------------------------------

export type GuardRun = { status: number | null; output: string }

export const GUARD_TIMEOUT_MS = 120_000

/**
 * Runs `scripts/check-architecture-guards.mjs` with a temporary
 * `--runtime-route-catalog-fixtures=<path>` file built from `fixture`.
 */
export function runRouteCatalogGuard(fixture: Json): GuardRun {
  const directory = surfaceTempDir("route-catalog-surfaces-guard-")
  const path = join(directory, "architecture-fixtures.json")
  writeFileSync(path, JSON.stringify(fixture, null, 2))
  const run = spawnSync(
    "node",
    [
      "scripts/check-architecture-guards.mjs",
      `--runtime-route-catalog-fixtures=${path}`,
    ],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: GUARD_TIMEOUT_MS - 10_000 },
  )
  return { status: run.status, output: `${run.stdout}${run.stderr}` }
}

export const ROUTE_GUARD_SUMMARY =
  /Runtime route catalog guard self-test: (\d+)\/(\d+) fixture cases matched; repository ownership enforced\./

export function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8")
}

// ---------------------------------------------------------------------------
// Queued-row seeding through the existing owners
// ---------------------------------------------------------------------------

export function jobIdFromEnvelope(stdout: string): string {
  const job = onlyJsonLine(stdout).job
  if (!isJson(job) || typeof job.id !== "string") {
    throw new Error(`no job id in ${stdout}`)
  }
  return job.id
}

/** `locus run --daemon` (queued daemon-source Run). */
export async function enqueueDaemonRun(
  profile: SurfaceProfile,
  runtime: string,
  prompt: string,
): Promise<string> {
  const created = await runCli(profile.mdb.db, [
    "run",
    "--daemon",
    "--runtime",
    runtime,
    "--cwd",
    profile.cwd,
    "--prompt",
    prompt,
    "--output",
    "json",
  ])
  return jobIdFromEnvelope(created.stdout)
}

/** `locus schedules create` + `locus schedules run` (queued schedule Run). */
export async function enqueueScheduleRun(
  profile: SurfaceProfile,
  runtime: string,
  prompt: string,
): Promise<string> {
  const created = await runCli(profile.mdb.db, [
    "schedules",
    "create",
    "--name",
    `surfaces ${runtime}`,
    "--prompt",
    prompt,
    "--interval-seconds",
    "3600",
    "--cwd",
    profile.cwd,
    "--runtime",
    runtime,
    "--output",
    "json",
  ])
  const schedule = onlyJsonLine(created.stdout).schedule
  if (!isJson(schedule)) throw new Error(created.stdout)
  const fired = await runCli(profile.mdb.db, [
    "schedules",
    "run",
    String(schedule.id),
    "--output",
    "json",
  ])
  return jobIdFromEnvelope(fired.stdout)
}

/** `locus api runs submit` (queued admitted API Run). */
export async function submitApiRun(
  profile: SurfaceProfile,
  request: Json,
): Promise<string> {
  const submitted = await runCli(
    profile.mdb.db,
    ["api", "runs", "submit", "--request", "-", "--json"],
    { stdin: JSON.stringify(request) },
  )
  return jobIdFromEnvelope(submitted.stdout)
}

export function seedCompletionProviderProfile(
  profile: SurfaceProfile,
  profileId: string,
): void {
  profile.mdb.sqlite
    .query(
      `INSERT INTO agent_provider_profiles
        (id, name, protocol, base_url, default_model, auth_mode, encrypted_token,
         target_runtimes_json, capabilities_json)
       VALUES (?, ?, 'openai-responses', 'https://provider.example.com/v1',
         'provider-default-model', 'none', NULL, '["codex"]', '{}')`,
    )
    .run(profileId, profileId)
}

export function apiCompletionRequest(input: {
  consumerId: string
  profileId: string
}): Json {
  return {
    apiVersion: API_VERSION,
    kind: "completion",
    consumer: { id: input.consumerId },
    runtime: { id: "codex" },
    provider: { profileId: input.profileId, model: "provider-model" },
    messages: [{ role: "user", content: "Return short text." }],
    responseFormat: { type: "text" },
  }
}

export type FetchRecorder = {
  fetch: (url: unknown) => Promise<Response>
  calls: string[]
}

/** Provider HTTP stub of the completion leaf (no network). */
export function completionFetchRecorder(): FetchRecorder {
  const calls: string[] = []
  return {
    calls,
    async fetch(url: unknown) {
      calls.push(String(url))
      return new Response(
        JSON.stringify({
          output_text: "done",
          usage: { input_tokens: 3, output_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    },
  }
}

/**
 * Async variant (several guard runs in parallel). `fixture === null` runs
 * the default repository check without the fixture flag.
 */
export async function runRouteCatalogGuardAsync(
  fixture: Json | null,
): Promise<GuardRun> {
  const args = ["scripts/check-architecture-guards.mjs"]
  if (fixture) {
    const directory = surfaceTempDir("route-catalog-surfaces-guard-")
    const path = join(directory, "architecture-fixtures.json")
    writeFileSync(path, JSON.stringify(fixture, null, 2))
    args.push(`--runtime-route-catalog-fixtures=${path}`)
  }
  const child = Bun.spawn(["node", ...args], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  })
  const timer = setTimeout(() => child.kill(), GUARD_TIMEOUT_MS - 10_000)
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  clearTimeout(timer)
  return { status, output: `${stdout}${stderr}` }
}

/** A guard fixture file holding one scenario's cases (D5 case shape). */
export function guardFixture(scenario: string, cases: Json[]): Json {
  return {
    fixtureVersion: 1,
    evidenceClass: "synthetic",
    sourceRefs: [
      "openspec/changes/refactor-unified-runtime-route-catalog/design.md:420-441",
    ],
    provenance: {
      author: "independent red-test author (surfaces domain)",
      notes: `Temporary per-test guard fixture for ${scenario}.`,
    },
    [scenario]: { cases },
  }
}

export function guardMismatchPattern(caseId: string, rule: string): RegExp {
  return new RegExp(
    `Runtime route catalog guard self-test case ${caseId} missed nothing and produced unexpected [^\\n]*${rule}[^\\n]*See Runtime Route Catalog Single Owner\\.`,
  )
}
