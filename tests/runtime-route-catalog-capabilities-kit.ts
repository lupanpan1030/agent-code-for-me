/**
 * Shared harness for the refactor-unified-runtime-route-catalog capabilities
 * red suite (S10, S11, S12, S13, S34-S39, S47, S51, S52). Independent red-test
 * author; written before any implementation exists, from the approved
 * spec/design only.
 *
 * - The NEW owner `src/main/lib/agent-runtime/runtime-route-catalog.ts`
 *   (design D1) is loaded lazily inside each test through
 *   `loadRouteCatalogModule`, so a missing module fails that test instead of
 *   the whole file.
 * - Every shape the design leaves open is declared here once (see the
 *   "Frozen shapes" section and the report) so an adjudication is a one-file
 *   change. The declaration table and reference ports follow the catalog-core
 *   shape of `catalog.json#S01` (coordinator adjudication P1-1, 2026-10-02)
 *   and are built through the core kit's `createReferencePorts`, so the whole
 *   red suite binds `validateRuntimeRouteCatalog` to one shape.
 * - Enforcing ports are the real adapter/shared-layer owners
 *   (`createClaudeAgentSdkPermissionControls`,
 *   `createCodexAppServerApprovalBridge`); the "recording ports" are the sinks
 *   those owners call (guard events, emitted chunks, user-approval port) plus
 *   a call counter around the enforcing port itself.
 * - No real runtime, credential, network or user HOME is touched: readiness
 *   dependencies, manifests and approval answers are all injected.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Readable } from "node:stream"
import type { ValidatedAgentScopeContract } from "../src/main/lib/agent-guard"
import {
  clearActiveGuardedContractsForTest,
  replaceActiveGuardedContractForSubChat,
} from "../src/main/lib/agent-guard"
import {
  getCodexAppServerPermissionMapping,
  resolveDesktopPermissionPolicy,
  resolveNonDesktopPermissionPolicy,
} from "../src/main/lib/agent-runtime/permission-policy"
import type { AgentRuntimePermissionPolicySummary } from "../src/main/lib/agent-runtime/run-contract"
import {
  type ClaudeAgentSdkCanUseTool,
  type ClaudeAskUserQuestionPending,
  createClaudeAgentSdkPermissionControls,
} from "../src/main/lib/claude/agent-sdk-tool-permission"
import { createCodexAppServerApprovalBridge } from "../src/main/lib/codex/app-server-approval"
import type { CodexAskUserQuestionPending } from "../src/main/lib/codex/ask-user-question"
import { HEADLESS_CLI_MARKER } from "../src/main/lib/headless/cli-args"
import { runHeadlessCliCommand } from "../src/main/lib/headless/cli-dispatcher"
import type { HeadlessDefaultProviderBindingInspection } from "../src/main/lib/headless/provider-binding"
import type { RuntimeReadinessResolverDependencies } from "../src/main/lib/headless/runtime-readiness"
import type { RuntimeExecutableStatus } from "../src/main/lib/runtime-executable"
import {
  type AgentRuntimeCapability,
  type AgentRuntimeCapabilityId,
  type AgentRuntimeCapabilityManifest,
  getAgentRuntimeCapabilityManifest,
  resolveAgentRuntimeCapabilityManifest,
  toAgentRuntimeId,
  validateAgentRuntimeCapabilityManifest,
} from "../src/shared/agent-runtime-capabilities"
import type { LocalJobApiRuntimeReadiness } from "../src/shared/local-job-api"
import {
  createMigratedLedgerDb,
  type MigratedLedgerDb,
  settledResult,
} from "./run-event-ledger-domain-b-kit"
import {
  createReferencePorts,
  type PortLog,
  type RecordingDelegate,
} from "./runtime-route-catalog-core-kit"

export { settledResult }

export const REPO_ROOT = join(import.meta.dir, "..")
export const FIXTURE_DIR = join(
  import.meta.dir,
  "fixtures",
  "runtime-route-catalog",
)
/** Design D2: the single NEW production owner (not present on base 19986552). */
export const ROUTE_CATALOG_MODULE = join(
  REPO_ROOT,
  "src/main/lib/agent-runtime/runtime-route-catalog.ts",
)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export type FixtureHeader = {
  fixtureVersion: 1
  evidenceClass: "synthetic"
  sourceRefs: string[]
  provenance: Record<string, unknown>
}

export function loadFixture<T>(name: string): FixtureHeader & T {
  return JSON.parse(
    readFileSync(join(FIXTURE_DIR, name), "utf8"),
  ) as FixtureHeader & T
}

// ---------------------------------------------------------------------------
// Frozen shapes (design D1 names the functions; these members are the
// smallest observable surface the scenarios need; listed in the report)
// ---------------------------------------------------------------------------

export type RouteEntry =
  | "desktop"
  | "headless"
  | "api"
  | "protocol"
  | "completion"
export type EnforcementLevel =
  | "none"
  | "sandbox-level"
  | "admission-audit"
  | "pre-execution"

/** Design D1 RouteQuery (verbatim field names). */
export type RouteQuery = {
  runtimeId: string
  entry: RouteEntry
  requiredCapabilities: readonly AgentRuntimeCapabilityId[]
  requiredExtensions: readonly string[]
} & (
  | {
      kind: "agent"
      mode: "plan" | "agent"
      executionProfile: "batch" | "policy-grant" | "interactive"
      permissionPolicy: AgentRuntimePermissionPolicySummary
    }
  | {
      kind: "completion"
      mode: null
      executionProfile: null
      permissionPolicy: null
    }
)

/** Frozen extension declaration (design D3 items + L7 redactionOwner). */
export type RouteExtensionDeclaration = {
  namespace: string
  schemaVersion: number
  maturity: string
  schemaRef: string
  redactionOwner?: string
}

/**
 * Design D1 success fields. Frozen here: `manifestRef.runtimeId` is the
 * canonical runtime id; `enforcementEvidence` is the leaf's typed level
 * string; `delegate` is a function for agent routes.
 */
export type RouteResolutionOk = {
  ok: true
  routeId: string
  runtimeId: string
  entry: RouteEntry
  executionSurface: string
  adapterSource: string
  adapterLabel: string
  delegate: unknown
  transport: unknown
  manifestRef: { runtimeId: string } & Record<string, unknown>
  readinessProbe: unknown
  enforcementEvidence: EnforcementLevel
  extensions: readonly RouteExtensionDeclaration[]
  diagnostic: { fallbackReason: null } & Record<string, unknown>
}

/**
 * Design D1 failure fields. Frozen here: `result` mirrors the existing
 * selection result `{status, exitCode, errorCode, errorMessage}` and
 * `diagnostic` keeps the existing `message` / `reason` / `capability`.
 */
export type RouteResolutionFailure = {
  ok: false
  reason:
    | "policy_refused"
    | "capability_refused"
    | "route_not_found"
    | "catalog_invalid"
    | "unsupported_required_extension"
  candidateAdapterSource: string | null
  candidateAdapterLabel: string | null
  diagnostic?: {
    message?: string
    reason?: string
    capability?: Record<string, unknown>
  } & Record<string, unknown>
  result?: {
    status: string
    exitCode: number | null
    errorCode: string | null
    errorMessage: string | null
  }
} & Record<string, unknown>

export type RouteResolution = RouteResolutionOk | RouteResolutionFailure

/** Design D3 public route summary, exact keys. */
export const PUBLIC_ROUTE_KEYS = [
  "adapterSource",
  "executionProfile",
  "extensions",
  "kind",
  "routeId",
  "surface",
  "transport",
] as const
/** Design D3 renderer overload, exact keys. */
export const RENDERER_ROUTE_KEYS = [
  "routeId",
  "runtimeId",
  "transportId",
] as const
/** Design D3 extension item, exact keys. */
export const PUBLIC_EXTENSION_KEYS = [
  "maturity",
  "namespace",
  "schemaRef",
  "schemaVersion",
] as const

export type PublicRouteSummary = {
  routeId: string
  surface: string
  kind: string
  executionProfile: string | null
  adapterSource: string
  transport: string
  extensions: readonly Record<string, unknown>[]
}

/** Frozen: the public overload groups summaries per runtime. */
export type PublicRuntimeRoutes = readonly {
  runtimeId: string
  routes: readonly PublicRouteSummary[]
}[]

export type RendererRouteEntry = {
  routeId: string
  runtimeId: string
  transportId: string
}

/** Frozen: probe context mirrors ResolveRuntimeReadinessOptions minus runtimeId. */
export type RouteReadinessContext = {
  probe?: boolean
  dependencies?: RuntimeReadinessResolverDependencies
  onDiagnostic?: (message: string) => void
}

export type ValidationResult =
  | { ok: true; catalog: unknown }
  | { ok: false; reason: "catalog_invalid"; offending: unknown }

/**
 * Frozen route declaration: the catalog-core shape of `catalog.json#S01`
 * (coordinator adjudication P1-1). Each agent leaf names its factory,
 * readiness probe and enforcement evidence by a reference key resolved
 * through `RouteCatalogTestReferences`, and also declares the enforcement
 * level that the evidence port must confirm. Completion leaves carry `null`
 * references and the declared level `"none"`.
 */
export type RouteLeafDeclaration = {
  routeId: string
  entries: readonly RouteEntry[]
  kind: "agent" | "completion"
  modes: readonly ("plan" | "agent")[] | null
  executionProfile: "batch" | "policy-grant" | "interactive" | null
  executionSurface: string
  adapterSource: string
  adapterLabel: string
  transport: string
  transportId: string | null
  factoryRef: string | null
  readinessProbeRef: string | null
  enforcementEvidenceRef: string | null
  enforcementEvidence: EnforcementLevel
  extensions: readonly RouteExtensionDeclaration[]
}

/** Frozen runtime declaration (catalog.json#S01 core shape). */
export type RuntimeRouteDeclarationForTests = {
  runtimeId: string
  label: string
  manifestRef: string
  cancellation: string
  sessionReference: string
  routes: readonly RouteLeafDeclaration[]
}

/**
 * Frozen reference ports (catalog.json#S01 core shape; tasks 2.2 lists the
 * manifest getter, agent factory / probe / enforcement-evidence ports and the
 * runtime normalizer). Omitted inputs validate the production table/ports; a
 * partial object is merged over the production ports (frozen merge rule, used
 * by S10/S38 with `getManifest` only). Reference lookups are recorded
 * separately from delegate invocations (tasks 2.2).
 */
export type RouteCatalogTestReferences = {
  normalizeRuntimeId: (raw: unknown) => string | null
  getManifest: (ref: unknown) => AgentRuntimeCapabilityManifest | null
  lookupAgentFactory: (ref: unknown) => RecordingDelegate | null
  lookupReadinessProbe: (
    ref: unknown,
  ) => ((context?: RouteReadinessContext) => Promise<unknown>) | null
  lookupEnforcementEvidence: (ref: unknown) => EnforcementLevel | null
}

/**
 * Fixture `ports` block (catalog.json#S01 convention):
 * `{manifests:{ref:runtimeId}, factories:[ref], probes:{ref:state},
 * evidence:{ref:level}}`.
 */
export type RouteCatalogTestPorts = {
  manifests: Record<string, string>
  factories: readonly string[]
  probes: Record<string, string>
  evidence: Record<string, EnforcementLevel>
}

export type RouteCatalogTestReferencePorts = {
  references: RouteCatalogTestReferences
  /** lookups and delegate invocations, recorded separately (tasks 2.2) */
  log: PortLog
  delegates: Record<string, RecordingDelegate>
}

/** Builds the recording reference ports through the core kit (one shape). */
export function capabilityReferencePorts(
  ports: RouteCatalogTestPorts,
): RouteCatalogTestReferencePorts {
  const built = createReferencePorts({
    manifests: ports.manifests,
    factories: [...ports.factories],
    probes: ports.probes,
    evidence: ports.evidence,
  })
  return {
    references: built.references as unknown as RouteCatalogTestReferences,
    log: built.log,
    delegates: built.delegates,
  }
}

export type RouteCatalogModule = {
  resolveRuntimeRoute: (query: RouteQuery, catalog?: unknown) => RouteResolution
  projectRuntimeRoutes: {
    (audience: "public", catalog?: unknown): PublicRuntimeRoutes
    (audience: "renderer", catalog?: unknown): readonly RendererRouteEntry[]
  }
  probeRuntimeRouteReadiness: (
    resolvedRoute: RouteResolution,
    context: RouteReadinessContext,
  ) => Promise<LocalJobApiRuntimeReadiness>
  validateRuntimeRouteCatalog: (
    declarations?: readonly RuntimeRouteDeclarationForTests[],
    references?: Partial<RouteCatalogTestReferences>,
  ) => ValidationResult
}

/**
 * Lazily loads the design-D1 catalog owner. On the base the module does not
 * exist, so the settled result is `{ fulfilled: false }` and the caller's
 * expectation fails inside the test.
 */
export async function loadRouteCatalogModule(): Promise<
  { ok: true; module: RouteCatalogModule } | { ok: false; reason: string }
> {
  const settled = await settledResult(() => import(ROUTE_CATALOG_MODULE))
  if (!settled.fulfilled) {
    return { ok: false, reason: settled.reason ?? "module not loaded" }
  }
  return { ok: true, module: settled.value as RouteCatalogModule }
}

// ---------------------------------------------------------------------------
// Query builders (permission policy comes from the real policy owner)
// ---------------------------------------------------------------------------

/**
 * Frozen: a desktop query carries a non-null summary projected from the
 * desktop policy owner (`kind: "desktop"`, visible-user interaction).
 */
export function desktopQuery(input: {
  runtimeId: "claude-code" | "codex"
  mode?: "plan" | "agent"
  requiredCapabilities?: readonly AgentRuntimeCapabilityId[]
  requiredExtensions?: readonly string[]
}): RouteQuery {
  const mode = input.mode ?? "agent"
  const policy = resolveDesktopPermissionPolicy({
    runtimeId: input.runtimeId,
    mode,
    ...(input.runtimeId === "codex"
      ? { codexAdapterSource: "codex-app-server" as const }
      : {}),
  })
  return {
    runtimeId: input.runtimeId,
    entry: "desktop",
    kind: "agent",
    mode,
    executionProfile: "interactive",
    requiredCapabilities: input.requiredCapabilities ?? [],
    requiredExtensions: input.requiredExtensions ?? [],
    permissionPolicy: {
      kind: "desktop",
      interaction: "visible-user",
      enforcement: policy.enforcement,
      diagnostics: [...policy.diagnostics],
    },
  }
}

export function nonDesktopQuery(input: {
  runtimeId: string
  entry: "headless" | "api" | "protocol"
  executionProfile?: "batch" | "policy-grant" | "interactive"
  mode?: "plan" | "agent"
  requiredCapabilities?: readonly AgentRuntimeCapabilityId[]
  requiredExtensions?: readonly string[]
  grantedScopes?: readonly string[]
}): RouteQuery {
  const executionProfile = input.executionProfile ?? "batch"
  const mode = input.mode ?? "agent"
  const source = input.entry === "api" ? "api" : "cli"
  return {
    runtimeId: input.runtimeId,
    entry: input.entry,
    kind: "agent",
    mode,
    executionProfile,
    requiredCapabilities: input.requiredCapabilities ?? [],
    requiredExtensions: input.requiredExtensions ?? [],
    permissionPolicy: resolveNonDesktopPermissionPolicy({
      source,
      mode,
      executionProfile,
      ...(input.grantedScopes
        ? { policyGrant: { scopes: [...input.grantedScopes] } }
        : {}),
    }),
  }
}

export function completionQuery(input: {
  runtimeId: string
  entry: "api" | "completion"
}): RouteQuery {
  return {
    runtimeId: input.runtimeId,
    entry: input.entry,
    kind: "completion",
    mode: null,
    executionProfile: null,
    permissionPolicy: null,
    requiredCapabilities: [],
    requiredExtensions: [],
  }
}

// ---------------------------------------------------------------------------
// Manifest owner port (S10 / S38): canonical manifest + fixture overrides
// ---------------------------------------------------------------------------

export type CapabilityOverride = {
  runtimeId: "claude-code" | "codex"
  capabilityId: AgentRuntimeCapabilityId
  status: "supported" | "degraded" | "unsupported"
  scope: AgentRuntimeCapability["scope"]
  reason: string
  hint: string | null
}

export type RecordingManifestPort = {
  port: (runtimeId: string) => AgentRuntimeCapabilityManifest
  /**
   * The `getManifest(ref)` reference port over `port`: resolves the
   * declaration's manifestRef alias through the shared owner
   * (`resolveAgentRuntimeCapabilityManifest`, as the production port does),
   * then returns `port(canonicalRuntimeId)`; `null` for an unresolvable ref.
   */
  getManifest: (ref: unknown) => AgentRuntimeCapabilityManifest | null
  calls: string[]
}

/**
 * A recording manifest owner port. Each call returns a fresh clone of the
 * canonical manifest with the fixture overrides applied and validated by the
 * shared owner's own manifest validator, so the injected truth is a legal
 * manifest rather than an ad-hoc table.
 */
export function manifestPortWithOverrides(
  overrides: readonly CapabilityOverride[],
): RecordingManifestPort {
  const calls: string[] = []
  const port = (runtimeId: string): AgentRuntimeCapabilityManifest => {
    calls.push(runtimeId)
    const canonical = toAgentRuntimeId(runtimeId)
    if (!canonical) throw new Error(`Unknown agent runtime: ${runtimeId}`)
    const manifest = getAgentRuntimeCapabilityManifest(canonical)
    const capabilities = manifest.capabilities.map((capability) => {
      const override = overrides.find(
        (item) =>
          item.runtimeId === canonical && item.capabilityId === capability.id,
      )
      if (!override) return capability
      return {
        ...capability,
        status: override.status,
        scope: override.scope,
        reason: override.reason,
        hint: override.hint,
        support: override.status === "supported" ? capability.support : null,
      }
    })
    const next = { ...manifest, capabilities }
    validateAgentRuntimeCapabilityManifest(next)
    return next
  }
  const getManifest = (ref: unknown): AgentRuntimeCapabilityManifest | null => {
    const lookup = resolveAgentRuntimeCapabilityManifest(
      typeof ref === "string" ? ref : null,
    )
    return lookup.ok ? port(lookup.runtimeId) : null
  }
  return { port, getManifest, calls }
}

/** The shared owner's diagnostic message template applied to `manifest`. */
export function capabilityMessage(
  manifest: AgentRuntimeCapabilityManifest,
  capabilityId: AgentRuntimeCapabilityId,
): string {
  const capability = manifest.capabilities.find(
    (item) => item.id === capabilityId,
  )
  if (!capability) throw new Error(`fixture capability ${capabilityId} missing`)
  return `${manifest.label} ${capability.label} is ${capability.status}. ${capability.reason}`
}

// ---------------------------------------------------------------------------
// Readiness dependencies (S11): every native/default port is injected and
// recorded; a deterministic clock drives the existing 30000 ms cache.
// ---------------------------------------------------------------------------

export type ReadinessCaseInput = {
  defaultProvider:
    | { state: "not-configured" }
    | { state: "ready"; profileId: string; model: string }
    | { state: "unavailable"; code: string; profileId: string | null }
  claudeAppAccount?: boolean
  claudeAppMetadata?: {
    isConnected: boolean
    credentialUsable: boolean
    isExpired: boolean
    isExpiringSoon: boolean
    refreshable: boolean
  }
  claudeCliCredential?: {
    accessToken: string
    expiresAt: number
    refreshToken: string | null
  } | null
  codexExecutableOk?: boolean
  codexLoginStatus?: string | null
  codexProbeThrows?: boolean
}

export type ReadinessRecorder = {
  dependencies: RuntimeReadinessResolverDependencies
  calls: Record<string, number>
  setNow: (value: number) => void
  setCodexLoginStatus: (value: string) => void
  nativeCallCount: () => number
}

const NATIVE_PORTS = [
  "getClaudeCodeCredentialMetadata",
  "getCodexRuntimeStatus",
  "getExistingClaudeCredentials",
  "hasAnyClaudeCodeAccount",
  "getCodexExecutableStatus",
] as const

export function readinessDependencies(
  input: ReadinessCaseInput,
  startNow = 1_000_000,
): ReadinessRecorder {
  const calls: Record<string, number> = {}
  const bump = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1
  }
  let now = startNow
  let codexLogin = input.codexLoginStatus ?? "ready"
  const executable: RuntimeExecutableStatus = {
    ok: input.codexExecutableOk ?? true,
    path: "{{FIXTURE_CODEX_PATH}}",
    exists: input.codexExecutableOk ?? true,
    isExecutable: input.codexExecutableOk ?? true,
    error:
      (input.codexExecutableOk ?? true)
        ? null
        : "Fixture: bundled Codex CLI is missing.",
    hint: (input.codexExecutableOk ?? true) ? null : "Fixture: restore it.",
  }
  const dependencies: RuntimeReadinessResolverDependencies = {
    inspectDefaultProviderBinding: () => {
      bump("inspectDefaultProviderBinding")
      return input.defaultProvider as HeadlessDefaultProviderBindingInspection
    },
    hasAnyClaudeCodeAccount: () => {
      bump("hasAnyClaudeCodeAccount")
      return input.claudeAppAccount ?? false
    },
    getClaudeCodeCredentialMetadata: () => {
      bump("getClaudeCodeCredentialMetadata")
      return (
        input.claudeAppMetadata ?? {
          isConnected: false,
          credentialUsable: false,
          isExpired: false,
          isExpiringSoon: false,
          refreshable: false,
        }
      )
    },
    getExistingClaudeCredentials: () => {
      bump("getExistingClaudeCredentials")
      return input.claudeCliCredential ?? null
    },
    getCodexExecutableStatus: () => {
      bump("getCodexExecutableStatus")
      return executable
    },
    getCodexRuntimeStatus: async () => {
      bump("getCodexRuntimeStatus")
      if (input.codexProbeThrows) {
        throw new Error("Fixture: Codex status subprocess failed.")
      }
      return {
        components: [
          { id: "login-cli", status: "ready", error: null, hint: null },
          { id: "login", status: codexLogin, error: null, hint: null },
        ],
      }
    },
    now: () => now,
  }
  return {
    dependencies,
    calls,
    setNow: (value) => {
      now = value
    },
    setCodexLoginStatus: (value) => {
      codexLogin = value
    },
    nativeCallCount: () =>
      NATIVE_PORTS.reduce((total, name) => total + (calls[name] ?? 0), 0),
  }
}

// ---------------------------------------------------------------------------
// Temp DB + in-process headless CLI
// ---------------------------------------------------------------------------

const openDbs: MigratedLedgerDb[] = []

export function createTempDb(): MigratedLedgerDb {
  const db = createMigratedLedgerDb()
  openDbs.push(db)
  return db
}

export function closeTempDbs(): void {
  while (openDbs.length > 0) {
    openDbs.pop()?.close()
  }
}

function textSink(): {
  stream: { write(chunk: string): boolean }
  text: () => string
} {
  let text = ""
  return {
    stream: {
      write(chunk: string) {
        text += chunk
        return true
      },
    },
    text: () => text,
  }
}

export async function runHeadlessCli(
  db: MigratedLedgerDb,
  argv: string[],
  options: {
    runtimeReadinessDependencies?: RuntimeReadinessResolverDependencies
  } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout = textSink()
  const stderr = textSink()
  const code = await runHeadlessCliCommand({
    db: db.db,
    argv: ["Locus", HEADLESS_CLI_MARKER, ...argv],
    stdin: Readable.from([""]),
    stdout: stdout.stream,
    stderr: stderr.stream,
    runner: null,
    env: {},
    runtimeReadinessDependencies: options.runtimeReadinessDependencies,
  })
  return { code, stdout: stdout.text(), stderr: stderr.text() }
}

// ---------------------------------------------------------------------------
// Supported-capability conformance through the actual enforcing ports
// (S36 / S37 / S52)
// ---------------------------------------------------------------------------

export const CONFORMANCE_SUB_CHAT_ID = "route-catalog-sub-1"

export function fixtureGuardedContract(): ValidatedAgentScopeContract {
  return {
    id: "route-catalog-contract",
    version: 1,
    status: "approved",
    createdAt: "2026-10-02T00:00:00.000Z",
    approvedAt: "2026-10-02T00:00:01.000Z",
    source: "manual",
    chatId: "route-catalog-chat",
    subChatId: CONFORMANCE_SUB_CHAT_ID,
    runId: "route-catalog-run",
    cwd: "/fixture-repo",
    projectPath: "/fixture-repo",
    editableScope: [{ path: "src", kind: "directory" }],
    readOnlyEvidence: [],
    successChecks: [{ command: "bun test" }],
    blockedPaths: [],
    expansions: [],
  }
}

export type ConformancePolicy = {
  mode: "plan" | "agent"
  workspaceKind: "project" | "folderless"
  guarded: boolean
  isUsingOllama?: boolean
}

export type ConformanceOperation =
  | {
      port: "canUseTool"
      toolName: string
      toolInput: Record<string, unknown>
    }
  | { port: "handleCommandExecution"; command: string }
  | { port: "handleFileChange"; grantRoot: string }

export type ConformanceExpectation = {
  response: unknown
  recordedInput?: Record<string, unknown>
  guardEventTypes: string[]
}

export type ConformanceObservation = {
  enforcingPortCalls: number
  response: unknown
  recordedInput: Record<string, unknown> | null
  guardEventTypes: string[]
  emittedChunkTypes: string[]
}

/**
 * Runs one fixture operation through the actual enforcing port of the
 * adapter named by `adapterSource` (the catalog-selected desktop adapter).
 * Recording ports: the enforcing-port call counter, the guard-event sink,
 * the emitted-chunk sink and an always-approve user-question port.
 */
export async function runEnforcingOperation(input: {
  adapterSource: string
  runtimeId: "claude-code" | "codex"
  policy: ConformancePolicy
  operation: ConformanceOperation
}): Promise<ConformanceObservation> {
  const guardEventTypes: string[] = []
  const emittedChunkTypes: string[] = []
  let enforcingPortCalls = 0
  const contract = input.policy.guarded ? fixtureGuardedContract() : null
  if (contract) {
    replaceActiveGuardedContractForSubChat(contract.subChatId, contract)
  }
  try {
    if (input.adapterSource === "claude-agent-sdk") {
      if (input.operation.port !== "canUseTool") {
        throw new Error(`claude-agent-sdk has no ${input.operation.port} port`)
      }
      const pending = new Map<string, ClaudeAskUserQuestionPending>()
      const controls = createClaudeAgentSdkPermissionControls({
        isUsingOllama: input.policy.isUsingOllama ?? false,
        permissionPolicy: resolveDesktopPermissionPolicy({
          runtimeId: "claude-code",
          mode: input.policy.mode,
          workspaceKind: input.policy.workspaceKind,
          hasScopeContract: input.policy.guarded,
        }),
        guardedContract: contract,
        isGuardedContractCurrent: () => true,
        recordGuardEvent: (event) => guardEventTypes.push(event.type),
        emit: (chunk) => emittedChunkTypes.push(chunk.type),
        subChatId: CONFORMANCE_SUB_CHAT_ID,
        pendingToolApprovals: pending,
        parts: [],
      })
      const canUseTool: ClaudeAgentSdkCanUseTool = (...args) => {
        enforcingPortCalls += 1
        return controls.canUseTool(...args)
      }
      const recordedInput = { ...input.operation.toolInput }
      const response = await canUseTool(
        input.operation.toolName,
        recordedInput,
        {
          toolUseID: "route-catalog-tool-1",
          signal: new AbortController().signal,
        } as Parameters<ClaudeAgentSdkCanUseTool>[2],
      )
      return {
        enforcingPortCalls,
        response,
        recordedInput,
        guardEventTypes,
        emittedChunkTypes,
      }
    }

    if (input.adapterSource === "codex-app-server") {
      const pending = new Map<string, CodexAskUserQuestionPending>()
      const bridge = createCodexAppServerApprovalBridge({
        subChatId: CONFORMANCE_SUB_CHAT_ID,
        permission: getCodexAppServerPermissionMapping(
          resolveDesktopPermissionPolicy({
            runtimeId: "codex",
            mode: input.policy.mode,
            workspaceKind: input.policy.workspaceKind,
            hasScopeContract: input.policy.guarded,
            codexAdapterSource: "codex-app-server",
          }),
        ),
        guardedContract: contract,
        emit: (chunk) => emittedChunkTypes.push(String(chunk.type)),
        onGuardEvent: (event) => guardEventTypes.push(event.type),
        registerPendingQuestion: (approvalId, approval) => {
          pending.set(approvalId, approval)
          // Recording user port: approves once, after registration.
          queueMicrotask(() => approval.resolve({ approved: true }))
        },
        unregisterPendingQuestion: (approvalId) => pending.delete(approvalId),
        timeoutMs: 5_000,
      })
      const operation = input.operation
      let response: unknown
      if (operation.port === "handleCommandExecution") {
        enforcingPortCalls += 1
        response = await bridge.handleCommandExecution({
          requestId: "route-catalog-command",
          params: {
            threadId: "route-catalog-thread",
            turnId: "route-catalog-turn",
            itemId: "route-catalog-item",
            startedAtMs: 0,
            command: operation.command,
          },
        })
      } else if (operation.port === "handleFileChange") {
        enforcingPortCalls += 1
        response = await bridge.handleFileChange({
          requestId: "route-catalog-file",
          params: {
            threadId: "route-catalog-thread",
            turnId: "route-catalog-turn",
            itemId: "route-catalog-item",
            startedAtMs: 0,
            grantRoot: operation.grantRoot,
          },
        })
      } else {
        throw new Error("codex-app-server has no canUseTool port")
      }
      return {
        enforcingPortCalls,
        response,
        recordedInput: null,
        guardEventTypes,
        emittedChunkTypes,
      }
    }

    throw new Error(`no enforcing port fixture for ${input.adapterSource}`)
  } finally {
    clearActiveGuardedContractsForTest()
  }
}

/**
 * The supported-capability conformance assertion: a supported declaration
 * passes only when the enforcing port was called and its observed result
 * (and guard events / rewritten input when declared) equals the fixture.
 */
export function supportedCapabilityConformanceFailures(
  expected: ConformanceExpectation,
  observed: ConformanceObservation,
): string[] {
  const failures: string[] = []
  if (observed.enforcingPortCalls === 0) {
    failures.push("enforcing-port-uncalled")
    return failures
  }
  if (JSON.stringify(observed.response) !== JSON.stringify(expected.response)) {
    failures.push("result-mismatch")
  }
  if (
    expected.recordedInput &&
    JSON.stringify(observed.recordedInput) !==
      JSON.stringify(expected.recordedInput)
  ) {
    failures.push("rewrite-mismatch")
  }
  if (
    JSON.stringify(observed.guardEventTypes) !==
    JSON.stringify(expected.guardEventTypes)
  ) {
    failures.push("guard-events-mismatch")
  }
  return failures
}

/** Every value of `value` (deep), for leak / vocabulary scans. */
export function deepKeys(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) deepKeys(item, into)
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      into.push(key)
      deepKeys(item, into)
    }
  }
  return into
}

export function sortedKeys(value: unknown): string[] {
  return value && typeof value === "object" ? Object.keys(value).sort() : []
}
