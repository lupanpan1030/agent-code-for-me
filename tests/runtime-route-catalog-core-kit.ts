/**
 * Test harness for the catalog-core domain of the independent red suite of
 * `openspec/changes/refactor-unified-runtime-route-catalog` (S01–S06, S08,
 * S09, S31–S33, S40–S46, S49).
 *
 * Test infrastructure only, never product code:
 *
 * - The NEW owner `src/main/lib/agent-runtime/runtime-route-catalog.ts`
 *   (design D1) and the NEW Codex host `src/main/lib/codex/desktop-chat-run.ts`
 *   are loaded lazily inside the tests that need them, so their absence on
 *   the base makes exactly those tests fail and never crashes a file at load.
 * - Test catalogs are built from the flat fixtures under
 *   `tests/fixtures/runtime-route-catalog/` in the frozen declaration /
 *   reference-port shape listed in the red-suite report (design D1 and tasks
 *   2.2 name the seams but not their fields). Every reference port records
 *   its lookups separately from delegate invocations (tasks 2.2).
 * - Native I/O is replaced only at the leaf process/native/fetch end
 *   (design D1): a fake `spawnProcess` for the process runner, a recording
 *   Claude SDK `query`, a recording completion `fetch`. No real runtime,
 *   credential or network is touched.
 * - Temporary SQLite profiles use the repository's real Drizzle migrations
 *   through `createMigratedLedgerDb` (tests/run-event-ledger-domain-b-kit.ts,
 *   imported read-only).
 */
import { expect } from "bun:test"
import { EventEmitter } from "node:events"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PassThrough, Readable } from "node:stream"
import {
  resolveDesktopPermissionPolicy,
  resolveNonDesktopPermissionPolicy,
} from "../src/main/lib/agent-runtime/permission-policy"
import type {
  AgentRuntimeObserver,
  AgentRuntimeRunRequest,
  AgentRuntimeRunResult,
} from "../src/main/lib/headless/agent-runtime-contract"
import type { AgentJobMode, AgentJobSource } from "../src/shared/agent-jobs"
import {
  type AgentRuntimeCapabilityId,
  getAgentRunRequiredCapabilityIds,
  getAgentRuntimeCapabilityManifest,
  toAgentRuntimeId,
} from "../src/shared/agent-runtime-capabilities"
import { settledResult } from "./run-event-ledger-domain-b-kit"

export { settledResult }

export type Loose = Record<string, unknown>

export const REPO_ROOT = join(import.meta.dir, "..")
export const FIXTURE_DIR = join(
  import.meta.dir,
  "fixtures",
  "runtime-route-catalog",
)
export const CATALOG_MODULE_PATH = join(
  REPO_ROOT,
  "src/main/lib/agent-runtime/runtime-route-catalog.ts",
)
export const CODEX_DESKTOP_CHAT_RUN_MODULE_PATH = join(
  REPO_ROOT,
  "src/main/lib/codex/desktop-chat-run.ts",
)
/** design D4: the only sanitized host message for catalog faults. */
export const CATALOG_UNAVAILABLE_MESSAGE =
  "Runtime route catalog is unavailable."
export const HEADLESS_MARKER = "--locus-headless-cli"
/** Fixed wall-clock instant installed with bun:test setSystemTime. */
export const FIXED_NOW_ISO = "2026-10-02T00:00:00.000Z"

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

export function isRecord(value: unknown): value is Loose {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function asRecord(value: unknown): Loose {
  return isRecord(value) ? value : {}
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** JSON text of a value with functions rendered as a marker (leak checks). */
export function serializeWithFunctions(value: unknown): string {
  return JSON.stringify(value, (_key, entry) =>
    typeof entry === "function" ? "[function]" : entry,
  )
}

/** Every function value reachable from `value` (own enumerable keys). */
export function functionPaths(value: unknown, path = "$"): string[] {
  if (typeof value === "function") return [path]
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      functionPaths(entry, `${path}[${index}]`),
    )
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, entry]) =>
      functionPaths(entry, `${path}.${key}`),
    )
  }
  return []
}

export function sortedKeys(value: unknown): string[] {
  return Object.keys(asRecord(value)).sort()
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export type FixtureFile =
  | "catalog.json"
  | "routes.json"
  | "policy.json"
  | "refusals.json"
  | "provider.json"
  | "completion.json"

export function loadFixtureFile(file: FixtureFile): Loose {
  const parsed = JSON.parse(
    readFileSync(join(FIXTURE_DIR, file), "utf8"),
  ) as unknown
  const fixture = asRecord(parsed)
  // Fixture header contract shared by the whole red suite.
  expect({
    file,
    fixtureVersion: fixture.fixtureVersion,
    evidenceClass: fixture.evidenceClass,
    sourceRefs: Array.isArray(fixture.sourceRefs),
    provenance: isRecord(fixture.provenance),
  }).toEqual({
    file,
    fixtureVersion: 1,
    evidenceClass: "synthetic",
    sourceRefs: true,
    provenance: true,
  })
  return fixture
}

/** Loads `<file>#<key>` (top-level Sxx key, as the spec GIVEN names it). */
export function fixtureKey(file: FixtureFile, key: string): Loose {
  const value = loadFixtureFile(file)[key]
  if (!isRecord(value)) {
    throw new Error(`fixture ${file}#${key} is missing`)
  }
  return value
}

/** The shared synthetic declaration table (catalog.json#S01). */
export function baseDeclarationFixture(): {
  declarations: Loose[]
  ports: Loose
} {
  const s01 = fixtureKey("catalog.json", "S01")
  return {
    declarations: cloneJson(asArray(s01.declarations) as Loose[]),
    ports: cloneJson(asRecord(s01.ports)),
  }
}

export type DeclarationMutation =
  | { op: "set"; path: Array<string | number>; value: unknown }
  | { op: "append"; path: Array<string | number>; value: unknown }
  | { op: "remove"; path: Array<string | number> }

function containerAt(root: unknown, path: Array<string | number>): unknown {
  let current: unknown = root
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === "number") {
      current = current[segment]
    } else if (isRecord(current) && typeof segment === "string") {
      current = current[segment]
    } else {
      throw new Error(`fixture mutation path ${path.join(".")} is invalid`)
    }
  }
  return current
}

/** Applies fixture mutations to a deep copy of a declaration table. */
export function mutateDeclarations(
  declarations: Loose[],
  mutations: readonly DeclarationMutation[],
): Loose[] {
  const next = cloneJson(declarations)
  for (const mutation of mutations) {
    const parentPath = mutation.path.slice(0, -1)
    const last = mutation.path[mutation.path.length - 1]
    if (mutation.op === "append") {
      const target = containerAt(next, mutation.path)
      if (!Array.isArray(target)) {
        throw new Error(`append target ${mutation.path.join(".")} not array`)
      }
      target.push(cloneJson(mutation.value))
      continue
    }
    const parent = containerAt(next, parentPath)
    if (mutation.op === "set") {
      if (Array.isArray(parent) && typeof last === "number") {
        parent[last] = cloneJson(mutation.value)
      } else if (isRecord(parent) && typeof last === "string") {
        parent[last] = cloneJson(mutation.value)
      } else {
        throw new Error(`set target ${mutation.path.join(".")} invalid`)
      }
      continue
    }
    if (Array.isArray(parent) && typeof last === "number") {
      parent.splice(last, 1)
    } else if (isRecord(parent) && typeof last === "string") {
      delete parent[last]
    }
  }
  return next
}

/** Renders `{{NAME}}` placeholders from values the test itself owns. */
export function renderPlaceholders<T>(
  template: T,
  vars: Record<string, string>,
  rawNumbers: Record<string, number> = {},
): T {
  let json = JSON.stringify(template)
  for (const [name, value] of Object.entries(rawNumbers)) {
    json = json.split(`"{{${name}}}"`).join(String(value))
  }
  const text = json.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, name: string) => {
    if (!(name in vars)) throw new Error(`placeholder ${name} unbound`)
    return vars[name] as string
  })
  return JSON.parse(text) as T
}

// ---------------------------------------------------------------------------
// The NEW catalog owner (lazy, frozen call shapes from design D1)
// ---------------------------------------------------------------------------

export type CatalogModule = {
  validateRuntimeRouteCatalog: (
    declarations?: unknown,
    references?: unknown,
  ) => unknown
  createRuntimeRouteCatalogForTests: (
    declarations: unknown,
    references: unknown,
  ) => unknown
  resolveRuntimeRoute: (query: unknown, catalog?: unknown) => unknown
  listRuntimeRoutes: (filter: unknown, catalog?: unknown) => unknown
  projectRuntimeRoutes: (
    audience: "public" | "renderer",
    catalog?: unknown,
  ) => unknown
}

const CATALOG_EXPORTS = [
  "validateRuntimeRouteCatalog",
  "createRuntimeRouteCatalogForTests",
  "resolveRuntimeRoute",
  "listRuntimeRoutes",
  "projectRuntimeRoutes",
] as const

export async function importModule(
  path: string,
): Promise<{ namespace: Loose | null; error: string | null }> {
  const loaded = await settledResult(() => import(path))
  if (!loaded.fulfilled) {
    return {
      namespace: null,
      error: (loaded.reason ?? "import failed").split(" {")[0] ?? "",
    }
  }
  return { namespace: asRecord(loaded.value), error: null }
}

/**
 * Enforces once src/main/lib/agent-runtime/runtime-route-catalog.ts exists:
 * the five design-D1 exports must be functions.
 */
export async function requireCatalogModule(): Promise<CatalogModule> {
  const loaded = await importModule(CATALOG_MODULE_PATH)
  expect({ catalogModuleImportError: loaded.error }).toEqual({
    catalogModuleImportError: null,
  })
  const namespace = loaded.namespace ?? {}
  expect(
    Object.fromEntries(
      CATALOG_EXPORTS.map((name) => [name, typeof namespace[name]]),
    ),
  ).toEqual(
    Object.fromEntries(CATALOG_EXPORTS.map((name) => [name, "function"])),
  )
  return namespace as unknown as CatalogModule
}

export type CodexDesktopChatRun = (options: Loose) => Promise<unknown>

/**
 * Enforces once src/main/lib/codex/desktop-chat-run.ts exports
 * runCodexDesktopChatRun(options: CodexDesktopChatRunOptions).
 */
export async function requireCodexDesktopChatRun(): Promise<CodexDesktopChatRun> {
  const loaded = await importModule(CODEX_DESKTOP_CHAT_RUN_MODULE_PATH)
  expect({ codexDesktopChatRunImportError: loaded.error }).toEqual({
    codexDesktopChatRunImportError: null,
  })
  const run = loaded.namespace?.runCodexDesktopChatRun
  expect(typeof run).toBe("function")
  return run as CodexDesktopChatRun
}

// ---------------------------------------------------------------------------
// Recording reference ports (frozen RuntimeRouteCatalogReferences shape)
// ---------------------------------------------------------------------------

export type RecordedInvocation = { ref: string; args: unknown[] }

export type PortLog = {
  /** reference-port lookups (allowed; counted separately, tasks 2.2) */
  factoryLookups: string[]
  probeLookups: string[]
  evidenceLookups: string[]
  manifestLookups: string[]
  /** delegate (factory) invocations: zero for any pure query */
  invocations: RecordedInvocation[]
  /** readiness probe invocations: zero for any pure query */
  probeCalls: string[]
  /** ordered trace of lookups and invocations */
  sequence: string[]
}

export type RecordingDelegate = (...args: unknown[]) => unknown

export type ReferencePorts = {
  references: Loose
  log: PortLog
  delegates: Record<string, RecordingDelegate>
}

export function emptyPortLog(): PortLog {
  return {
    factoryLookups: [],
    probeLookups: [],
    evidenceLookups: [],
    manifestLookups: [],
    invocations: [],
    probeCalls: [],
    sequence: [],
  }
}

/**
 * Builds the frozen reference ports from a fixture `ports` block:
 * `{manifests:{ref:runtimeId}, factories:[ref], probes:{ref:state},
 * evidence:{ref:level}}`. `implementations` replaces a factory ref's
 * recording body (it is still recorded as an invocation).
 */
export function createReferencePorts(
  ports: Loose,
  implementations: Record<string, (...args: unknown[]) => unknown> = {},
  options: {
    factoryLookupOverride?: (ref: string, count: number) => boolean
  } = {},
): ReferencePorts {
  const log = emptyPortLog()
  const delegates: Record<string, RecordingDelegate> = {}
  for (const ref of asArray(ports.factories)) {
    const name = String(ref)
    const body = implementations[name]
    delegates[name] = (...args: unknown[]) => {
      log.invocations.push({ ref: name, args })
      log.sequence.push(`invoke:${name}`)
      if (body) return body(...args)
      return Promise.resolve({
        status: "failed",
        exitCode: 1,
        errorCode: "fixture_delegate_default",
        errorMessage: `fixture delegate ${name} has no scripted result`,
      })
    }
  }
  const manifests = asRecord(ports.manifests)
  const probes = asRecord(ports.probes)
  const evidence = asRecord(ports.evidence)
  const probeFunctions: Record<string, () => Promise<unknown>> = {}
  for (const [ref, state] of Object.entries(probes)) {
    probeFunctions[ref] = async () => {
      log.probeCalls.push(ref)
      log.sequence.push(`probe:${ref}`)
      return { state }
    }
  }
  const lookupCounts = new Map<string, number>()
  const references: Loose = {
    normalizeRuntimeId(raw: unknown) {
      return toAgentRuntimeId(typeof raw === "string" ? raw : null)
    },
    getManifest(ref: unknown) {
      const name = String(ref)
      log.manifestLookups.push(name)
      const runtimeId = manifests[name]
      return typeof runtimeId === "string"
        ? getAgentRuntimeCapabilityManifest(
            runtimeId as "claude-code" | "codex",
          )
        : null
    },
    lookupAgentFactory(ref: unknown) {
      const name = String(ref)
      const count = (lookupCounts.get(name) ?? 0) + 1
      lookupCounts.set(name, count)
      log.factoryLookups.push(name)
      log.sequence.push(`lookup:${name}`)
      if (options.factoryLookupOverride?.(name, count) === false) return null
      return delegates[name] ?? null
    },
    lookupReadinessProbe(ref: unknown) {
      const name = String(ref)
      log.probeLookups.push(name)
      return probeFunctions[name] ?? null
    },
    lookupEnforcementEvidence(ref: unknown) {
      const name = String(ref)
      log.evidenceLookups.push(name)
      const level = evidence[name]
      return typeof level === "string" ? level : null
    },
  }
  return { references, log, delegates }
}

/** A validated test catalog state built through the design-D1 constructor. */
export function buildTestCatalog(
  catalog: CatalogModule,
  declarations: Loose[],
  ports: ReferencePorts,
): unknown {
  return catalog.createRuntimeRouteCatalogForTests(
    declarations,
    ports.references,
  )
}

// ---------------------------------------------------------------------------
// Owner-normalized queries (design D1 RouteQuery)
// ---------------------------------------------------------------------------

export type AgentQueryInput = {
  runtimeId: string
  entry: "desktop" | "headless" | "api" | "protocol" | "completion"
  mode: AgentJobMode
  executionProfile: string
  source: AgentJobSource
  hasScopeContract?: boolean
  requestedCapabilities?: AgentRuntimeCapabilityId[]
  hasVisibleUserInteractionChannel?: boolean
  interactiveRequirements?: string[]
  policyGrant?: { scopes: string[]; canDecideAutomatically?: boolean } | null
  requiredExtensions?: string[]
}

/**
 * Agent query whose permission policy comes from the existing policy owner
 * and whose capabilities are the owner-derived implicit/explicit union.
 */
export function agentQuery(input: AgentQueryInput): Loose {
  const profile = input.executionProfile as "batch"
  const permissionPolicy = resolveNonDesktopPermissionPolicy({
    source: input.source,
    mode: input.mode,
    executionProfile: profile,
    hasVisibleUserInteractionChannel: input.hasVisibleUserInteractionChannel,
    interactiveRequirements: input.interactiveRequirements as
      | Array<"interactive-approval">
      | undefined,
    policyGrant: input.policyGrant ?? null,
  })
  return {
    runtimeId: input.runtimeId,
    entry: input.entry,
    kind: "agent",
    mode: input.mode,
    executionProfile: input.executionProfile,
    requiredCapabilities: [
      ...new Set([
        ...(input.requestedCapabilities ?? []),
        ...getAgentRunRequiredCapabilityIds({
          mode: input.mode,
          hasScopeContract: input.hasScopeContract ?? false,
        }),
      ]),
    ],
    requiredExtensions: input.requiredExtensions ?? [],
    permissionPolicy,
  }
}

export function completionQuery(
  runtimeId: string,
  entry: "api" | "completion",
): Loose {
  return {
    runtimeId,
    entry,
    kind: "completion",
    mode: null,
    executionProfile: null,
    permissionPolicy: null,
    requiredCapabilities: [],
    requiredExtensions: [],
  }
}

export function desktopPermissionPolicy(
  runtimeId: "claude-code" | "codex",
  mode: AgentJobMode,
): unknown {
  return resolveDesktopPermissionPolicy({ runtimeId, mode })
}

// ---------------------------------------------------------------------------
// Headless observer and process I/O stub
// ---------------------------------------------------------------------------

export type RecordedEvent = { type: string; payload: unknown }

export type RecordingObserver = {
  observer: AgentRuntimeObserver
  events: RecordedEvent[]
  secretHints: string[]
}

export function recordingObserver(jobId = "job-fixture"): RecordingObserver {
  const events: RecordedEvent[] = []
  const secretHints: string[] = []
  const observer = {
    appendEvent(type: string, payload: unknown) {
      events.push({ type, payload })
    },
    heartbeat() {
      return { id: jobId, status: "running" }
    },
    isCancelRequested() {
      return false
    },
    registerSecretHints(hints: readonly string[]) {
      secretHints.push(...hints)
    },
  }
  return {
    observer: observer as unknown as AgentRuntimeObserver,
    events,
    secretHints,
  }
}

export type FakeSpawnCall = {
  executable: string
  args: string[]
  cwd: unknown
}

export type FakeSpawn = {
  spawnProcess: (...args: unknown[]) => unknown
  calls: FakeSpawnCall[]
}

/**
 * A ChildProcess-like process I/O stub for `runProcessAgentTask`'s existing
 * `spawnProcess` seam: writes the scripted stdout/stderr, then closes with
 * the scripted exit code. It never starts a real process.
 */
export function createFakeSpawn(script: {
  stdout: string[]
  stderr?: string[]
  exitCode: number
}): FakeSpawn {
  const calls: FakeSpawnCall[] = []
  const spawnProcess = (...args: unknown[]) => {
    const [executable, argv, options] = args
    calls.push({
      executable: String(executable),
      args: asArray(argv).map(String),
      cwd: asRecord(options).cwd,
    })
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const child = Object.assign(new EventEmitter(), {
      stdout,
      stderr,
      stdin: null,
      pid: 4242,
      exitCode: null as number | null,
      signalCode: null as string | null,
      kill: () => true,
    })
    setImmediate(() => {
      for (const chunk of script.stdout) stdout.write(chunk)
      for (const chunk of script.stderr ?? []) stderr.write(chunk)
      stdout.end()
      stderr.end()
      setImmediate(() => {
        child.exitCode = script.exitCode
        child.emit("exit", script.exitCode, null)
        child.emit("close", script.exitCode, null)
      })
    })
    return child
  }
  return { spawnProcess, calls }
}

/** A spawn port that refuses: a real child process must never start. */
export function refusingSpawn(log: string[]): (...args: unknown[]) => never {
  return (...args: unknown[]) => {
    log.push(String(args[0]))
    throw new Error(
      "runtime-route-catalog red suite: real process spawn refused",
    )
  }
}

export type HeadlessDelegate = (
  request: AgentRuntimeRunRequest,
  observer: AgentRuntimeObserver,
) => Promise<AgentRuntimeRunResult>

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export type CliOutcome = {
  settled: "fulfilled" | "rejected"
  code: number | null
  rejection: string | null
  stdout: string
  stderr: string
}

export async function runCli(input: {
  db: unknown
  args: string[]
  stdin?: string
  extra?: Loose
  lockPath: string
}): Promise<CliOutcome> {
  const { HEADLESS_CLI_MARKER } = await import(
    "../src/main/lib/headless/cli-args"
  )
  const { runHeadlessCliCommand } = await import(
    "../src/main/lib/headless/cli-dispatcher"
  )
  let stdout = ""
  let stderr = ""
  const options = {
    db: input.db,
    argv: ["Locus", HEADLESS_CLI_MARKER, ...input.args],
    stdin: input.stdin === undefined ? undefined : Readable.from([input.stdin]),
    stdout: { write: (chunk: string) => (stdout += chunk) },
    stderr: { write: (chunk: string) => (stderr += chunk) },
    runner: null,
    env: {},
    appVersion: "0.0.route-catalog-red",
    daemonLockPath: input.lockPath,
    ...(input.extra ?? {}),
  }
  const settled = await settledResult(() =>
    runHeadlessCliCommand(
      options as unknown as Parameters<typeof runHeadlessCliCommand>[0],
    ),
  )
  return {
    settled: settled.fulfilled ? "fulfilled" : "rejected",
    code: settled.fulfilled ? Number(settled.value) : null,
    rejection: settled.fulfilled
      ? null
      : ((settled.reason ?? "").split(" {")[0]?.trim() ?? ""),
    stdout,
    stderr,
  }
}

/** First error message carried by a rejected settledResult reason. */
export function rejectionMessage(reason: string | undefined): string {
  return (reason ?? "").replace(/ \{.*\}$/s, "").trim()
}

// ---------------------------------------------------------------------------
// Readiness stub (no native probe; same shape as the async-submit kit's)
// ---------------------------------------------------------------------------

export const READINESS_DEPENDENCIES_STUB = {
  hasAnyClaudeCodeAccount: () => false,
  getExistingClaudeCredentials: () => null,
  getCodexExecutableStatus: () => ({
    ok: true,
    path: "/fixture/codex",
    exists: true,
    isExecutable: true,
    error: null,
    hint: null,
  }),
  getCodexRuntimeStatus: async () => ({
    components: [{ id: "login", status: "ready", error: null, hint: null }],
  }),
}

// ---------------------------------------------------------------------------
// Desktop host harness (existing Claude host + NEW Codex host)
// ---------------------------------------------------------------------------

export type DesktopEmissions = {
  chunks: Loose[]
  emitErrors: Array<{ message: string; context: unknown }>
  completes: number
}

export function emptyEmissions(): DesktopEmissions {
  return { chunks: [], emitErrors: [], completes: 0 }
}

/** A recording stand-in for the Run's host ledger: counts every call. */
export function recordingLedger(): { ledger: Loose; calls: string[] } {
  const calls: string[] = []
  const ledger = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") return undefined
        return (...args: unknown[]) => {
          calls.push(`${String(property)}:${args.length}`)
          return Promise.resolve([])
        }
      },
    },
  ) as Loose
  return { ledger, calls }
}

export function desktopRunRequest(input: {
  runtimeId: "claude-code" | "codex"
  mode: AgentJobMode
  cwd: string
  signal: AbortSignal
  ledger: unknown
  session: Loose
  runId?: string
  subChatId?: string
}): Loose {
  return {
    identity: { runId: input.runId ?? "run-s03", jobId: "job-s03" },
    context: {
      runtimeId: input.runtimeId,
      mode: input.mode,
      projectId: "project-1",
      chatId: "chat-1",
      subChatId: input.subChatId ?? "sub-1",
      cwd: input.cwd,
    },
    prompt: "Fixture desktop prompt.",
    permissionPolicy: desktopPermissionPolicy(input.runtimeId, input.mode),
    providerBinding: {},
    mcp: { status: "skipped", serverNames: [], blockers: [] },
    attachments: [],
    trace: { emit: () => {} },
    signal: input.signal,
    session: input.session,
    ledger: input.ledger,
  }
}

/**
 * Input of the existing host runClaudeAgentSdkDesktopRuntimeWithMcpReadiness
 * (agent-sdk-desktop-run-runtime.ts:52), shaped like the lifecycle tests'
 * input. `query` is the recording native SDK port (process/native I/O end);
 * `runtimeRouteCatalog` is the design-D1 host test option.
 */
export async function claudeHostInput(input: {
  request: Loose
  nativeQueryCalls: unknown[]
  emissions: DesktopEmissions
  db: unknown
  runtimeRouteCatalog: unknown
  oauthToken: string
}): Promise<Loose> {
  const { createClaudeAgentSdkDesktopRunState } = await import(
    "../src/main/lib/claude/agent-sdk-desktop-run-state"
  )
  const { createClaudeAgentSdkStreamConsumerMutableState } = await import(
    "../src/main/lib/claude/agent-sdk-stream-consumer"
  )
  const context = asRecord(input.request.context)
  return {
    desktopRunRequest: input.request,
    mcpReadinessStatus: "skipped",
    desktopRunState: createClaudeAgentSdkDesktopRunState(),
    query: (params: unknown) => {
      input.nativeQueryCalls.push(params)
      throw new Error(
        "runtime-route-catalog red suite: native SDK query refused",
      )
    },
    loadQuery: async () => {
      input.nativeQueryCalls.push("loadQuery")
      throw new Error("runtime-route-catalog red suite: SDK load refused")
    },
    runtimeQuery: {
      existingMessages: [],
      rawMcpServers: undefined,
      env: {},
      pendingToolApprovals: new Map(),
      shouldForkResume: false,
      forkResumeAtUuid: null,
      resumeAtUuid: null,
      resolvedModel: "claude-sonnet",
      maxThinkingTokens: null,
      projectPath: context.cwd,
      readAgentsMd: async () => null,
      getClaudeBinaryPath: () => "/fixture/bin/claude",
    },
    runtimePrompt: {
      images: [],
      prepareRuntimePrompt: async ({ prompt }: { prompt: string }) => ({
        ok: true,
        prompt,
      }),
    },
    streamState: createClaudeAgentSdkStreamConsumerMutableState(),
    isUsingOllama: false,
    customConfig: null,
    hasExistingApiConfig: false,
    oauthToken: input.oauthToken,
    historyEnabled: false,
    db: input.db,
    messagesToSave: [],
    guardedContract: null,
    guardedPreRunStatus: null,
    subId: String(context.subChatId),
    secretHints: [input.oauthToken],
    emitError: (error: unknown, context: unknown) => {
      input.emissions.emitErrors.push({
        message: error instanceof Error ? error.message : String(error),
        context,
      })
    },
    emit: (chunk: unknown) => {
      input.emissions.chunks.push(asRecord(chunk))
      return true
    },
    complete: () => {
      input.emissions.completes += 1
    },
    log: () => {},
    error: () => {},
    streamStart: 1000,
    nowMs: () => 3500,
    runtimeRouteCatalog: input.runtimeRouteCatalog,
  }
}

/** Frozen CodexDesktopChatRunOptions: the post-admission run body inputs. */
export function codexHostOptions(input: {
  request: Loose
  emissions: DesktopEmissions
  runtimeRouteCatalog: unknown
  providerGatewayToken: string | null
  appManagedApiKey: string | null
}): Loose {
  return {
    request: input.request,
    providerGatewayToken: input.providerGatewayToken,
    appManagedApiKey: input.appManagedApiKey,
    secretHints: [input.providerGatewayToken, input.appManagedApiKey].filter(
      (value): value is string => typeof value === "string",
    ),
    resolvedImages: [],
    guardedContract: null,
    isCurrentRunOwner: () => true,
    emit: (chunk: unknown) => {
      input.emissions.chunks.push(asRecord(chunk))
    },
    registerPendingQuestion: () => {},
    unregisterPendingQuestion: () => true,
    runtimeRouteCatalog: input.runtimeRouteCatalog,
  }
}

/**
 * Every channel through which a desktop host can surface a catalog fault:
 * its rejection, an emitted {type:"error"} chunk or an emitError call.
 */
export function desktopFaultMessages(
  settled: { fulfilled: boolean; reason?: string; value?: unknown },
  emissions: DesktopEmissions,
): string[] {
  const messages: string[] = []
  if (!settled.fulfilled) messages.push(rejectionMessage(settled.reason))
  for (const chunk of emissions.chunks) {
    if (chunk.type === "error" && typeof chunk.errorText === "string") {
      messages.push(chunk.errorText)
    }
  }
  for (const entry of emissions.emitErrors) messages.push(entry.message)
  const value = asRecord(settled.value)
  const error = asRecord(value.error)
  if (typeof error.message === "string") messages.push(error.message)
  return messages
}

/** Settles a call keeping the thrown value itself (error fields are oracles). */
export async function settleWithError(
  run: () => unknown,
): Promise<{ fulfilled: boolean; value: unknown; error: unknown }> {
  return await Promise.resolve()
    .then(run)
    .then(
      (value) => ({ fulfilled: true, value, error: null }),
      (error: unknown) => ({ fulfilled: false, value: null, error }),
    )
}
