/**
 * Runtime Route Catalog Single Owner (refactor-unified-runtime-route-catalog,
 * design D1/D2/D3).
 *
 * One static, declarative, module-private production table of the runtime
 * routes Locus executes: per runtime family, which entry (desktop, headless,
 * api, protocol, completion) reaches which leaf adapter, transport, manifest,
 * readiness probe and enforcement evidence. The table is validated once at
 * module initialization and kept as a deep-frozen singleton; an invalid table
 * becomes a non-executable failure state (never a partial catalog).
 *
 * Queries are pure: they read the validated table and the reference ports
 * only (reference lookups are allowed and counted apart from invocations).
 * No query constructs an adapter, runs a probe, reads a provider, the
 * database, the environment, the filesystem or any configuration. The
 * catalog owns no queue, claim, binding, provider policy, event, artifact or
 * terminal state; hosts keep executing through their existing owners.
 *
 * The optional `catalog` argument of every query and the
 * `createRuntimeRouteCatalogForTests` constructor exist for tests only; a
 * production caller never constructs or overrides the table.
 */
import {
  type AgentRuntimeCapabilityId,
  type AgentRuntimeCapabilityManifest,
  checkAgentRuntimeManifestCapability,
  resolveAgentRuntimeCapabilityManifest,
  toAgentRuntimeId,
} from "../../../shared/agent-runtime-capabilities"
import {
  LOCAL_JOB_API_RUNTIME_EXTENSION_SCHEMA_REFS,
  type LocalJobApiRuntimeReadiness,
  type LocalJobApiRuntimeRouteSummary,
} from "../../../shared/local-job-api"
import type { RunClaudeAgentSdkDesktopAdapterWithPreparedRuntimeQueryInput } from "../claude/agent-sdk-adapter-runner"
import type { CodexAppServerDesktopAdapterInput } from "../codex/app-server-adapter-runner"
import {
  CLAUDE_CODE_BATCH_ENFORCEMENT_EVIDENCE,
  CODEX_APP_SERVER_HEADLESS_ENFORCEMENT_EVIDENCE,
  CODEX_BATCH_ENFORCEMENT_EVIDENCE,
} from "../headless/adapters/enforcement-evidence"
import type {
  AgentRuntimeObserver,
  AgentRuntimeRunRequest,
  AgentRuntimeRunResult,
} from "../headless/agent-runtime-contract"
import {
  type RuntimeReadinessProbeOptions,
  type RuntimeReadinessResolverDependencies,
  resolveClaudeCodeRuntimeReadiness,
  resolveCodexRuntimeReadiness,
  unknownRuntimeReadiness,
} from "../headless/runtime-readiness"
import {
  CLAUDE_AGENT_SDK_DESKTOP_ENFORCEMENT_EVIDENCE,
  CODEX_APP_SERVER_DESKTOP_ENFORCEMENT_EVIDENCE,
} from "./desktop-adapter-metadata"
import type { DesktopRunResult } from "./desktop-run-request"
import type {
  AgentRuntimeEnforcementEvidence,
  AgentRuntimePermissionPolicySummary,
} from "./run-contract"

/** The only message a host surfaces for any internal catalog fault (D4). */
export const RUNTIME_ROUTE_CATALOG_UNAVAILABLE_MESSAGE =
  "Runtime route catalog is unavailable."

// ---------------------------------------------------------------------------
// Declaration shape (frozen with the red suite, red-receipt §8.1 / P1-1)
// ---------------------------------------------------------------------------

export const RUNTIME_ROUTE_ENTRIES = [
  "desktop",
  "headless",
  "api",
  "protocol",
  "completion",
] as const
export type RuntimeRouteEntry = (typeof RUNTIME_ROUTE_ENTRIES)[number]

export type RuntimeRouteKind = "agent" | "completion"
export type RuntimeRouteMode = "plan" | "agent"
export type RuntimeRouteExecutionProfile =
  | "batch"
  | "policy-grant"
  | "interactive"

export const RUNTIME_ROUTE_EXECUTION_SURFACES = [
  "desktop-sdk",
  "desktop-app-server",
  "headless-exec",
  "headless-app-server",
  "completion",
] as const
export type RuntimeRouteExecutionSurface =
  (typeof RUNTIME_ROUTE_EXECUTION_SURFACES)[number]

/** `runtime.<runtimeId>.v1` extension declaration (design D3 / L7). */
export type RuntimeRouteExtensionDeclaration = {
  namespace: string
  schemaVersion: 1
  maturity: "experimental" | "stable"
  /** A published JSON Pointer into docs/local-job-api-v1.schema.json. */
  schemaRef: string
  /** Owner that redacts the extension payload (never projected publicly). */
  redactionOwner: string
}

export type RuntimeRouteDeclaration = {
  routeId: string
  entries: readonly RuntimeRouteEntry[]
  kind: RuntimeRouteKind
  modes: readonly RuntimeRouteMode[] | null
  executionProfile: RuntimeRouteExecutionProfile | null
  executionSurface: RuntimeRouteExecutionSurface
  adapterSource: string
  adapterLabel: string
  transport: string
  /** Renderer wire family key of a desktop route; null elsewhere. */
  transportId: string | null
  factoryRef: string | null
  readinessProbeRef: string | null
  enforcementEvidenceRef: string | null
  /** Declared level; must equal the leaf evidence the reference resolves. */
  enforcementEvidence: AgentRuntimeEnforcementEvidence
  extensions: readonly RuntimeRouteExtensionDeclaration[]
}

export type RuntimeRouteRuntimeDeclaration = {
  runtimeId: string
  label: string
  /** An alias the shared capability owner resolves to the manifest. */
  manifestRef: string
  cancellation: string
  sessionReference: string
  routes: readonly RuntimeRouteDeclaration[]
}

export type RuntimeRouteCatalogDeclarations =
  readonly RuntimeRouteRuntimeDeclaration[]

// ---------------------------------------------------------------------------
// Typed main-only delegates and reference ports
// ---------------------------------------------------------------------------

/** Headless leaf delegate: the existing `(request, observer)` leaf input. */
export type HeadlessRuntimeRouteDelegate = (
  request: AgentRuntimeRunRequest,
  observer: AgentRuntimeObserver,
) => Promise<AgentRuntimeRunResult>

/** Claude desktop leaf delegate (Agent SDK prepared-runtime-query input). */
export type ClaudeDesktopRuntimeRouteDelegate = (
  input: RunClaudeAgentSdkDesktopAdapterWithPreparedRuntimeQueryInput,
) => Promise<DesktopRunResult>

/** Codex desktop leaf delegate (app-server adapter runner input). */
export type CodexDesktopRuntimeRouteDelegate = (
  input: CodexAppServerDesktopAdapterInput,
) => Promise<DesktopRunResult>

export type RuntimeRouteDelegate =
  | HeadlessRuntimeRouteDelegate
  | ClaudeDesktopRuntimeRouteDelegate
  | CodexDesktopRuntimeRouteDelegate

export type RuntimeRouteReadinessContext = {
  probe?: boolean
  dependencies?: RuntimeReadinessResolverDependencies
  onDiagnostic?: (message: string) => void
}

export type RuntimeRouteReadinessProbe = (
  context?: RuntimeRouteReadinessContext,
) => Promise<unknown>

/**
 * Reference ports of a declaration table. Omitted inputs validate the
 * production table and ports; a partial object is merged over the
 * production ports (tests only).
 */
export type RuntimeRouteCatalogReferences = {
  normalizeRuntimeId: (raw: unknown) => string | null
  getManifest: (ref: unknown) => AgentRuntimeCapabilityManifest | null
  lookupAgentFactory: (ref: unknown) => unknown
  lookupReadinessProbe: (ref: unknown) => unknown
  lookupEnforcementEvidence: (ref: unknown) => unknown
}

// ---------------------------------------------------------------------------
// Catalog states
// ---------------------------------------------------------------------------

declare const validatedRuntimeRouteCatalogBrand: unique symbol

/** An opaque handle of a table that passed validation. */
export type ValidatedRuntimeRouteCatalog = Readonly<{
  kind: "runtime-route-catalog"
  routeIds: readonly string[]
}> & { readonly [validatedRuntimeRouteCatalogBrand]: true }

export type RuntimeRouteCatalogOffending = Readonly<{
  runtimeId: string | null
  routeId: string | null
  conflictingRouteId: string | null
  field: string
  problem: string
}>

/** The non-executable state an invalid table becomes (no partial catalog). */
export type RuntimeRouteCatalogFailureState = Readonly<{
  ok: false
  reason: "catalog_invalid"
  offending: RuntimeRouteCatalogOffending
}>

export type RuntimeRouteCatalogState =
  | ValidatedRuntimeRouteCatalog
  | RuntimeRouteCatalogFailureState

export type RuntimeRouteCatalogValidation =
  | Readonly<{ ok: true; catalog: ValidatedRuntimeRouteCatalog }>
  | RuntimeRouteCatalogFailureState

// ---------------------------------------------------------------------------
// Query and results (design D1)
// ---------------------------------------------------------------------------

export type RouteQuery = {
  runtimeId: string
  entry: RuntimeRouteEntry
  requiredCapabilities: readonly AgentRuntimeCapabilityId[]
  /** Internal only; Local Job API v1 has no such request field. */
  requiredExtensions: readonly string[]
} & (
  | {
      kind: "agent"
      mode: RuntimeRouteMode
      executionProfile: RuntimeRouteExecutionProfile
      permissionPolicy: AgentRuntimePermissionPolicySummary
    }
  | {
      kind: "completion"
      mode: null
      executionProfile: null
      permissionPolicy: null
    }
)

export type RuntimeRouteResolutionFailureReason =
  | "policy_refused"
  | "capability_refused"
  | "route_not_found"
  | "catalog_invalid"
  | "unsupported_required_extension"

export type RuntimeRouteManifestRef = Readonly<{
  ref: string
  runtimeId: string
  label: string
}>

export type RuntimeRouteSelectionDiagnostic = Readonly<{
  type: "adapter-selected"
  status: "selected"
  runtime: string
  entry: RuntimeRouteEntry
  executionProfile: RuntimeRouteExecutionProfile | null
  adapterSource: string
  adapterLabel: string
  fallbackReason: null
  policyGrantScopeBinding:
    | "admission-audit-only"
    | "declared-scopes-bound"
    | null
  message: string
}>

export type RuntimeRouteRefusalDiagnostic = Readonly<{
  type: "adapter-refused" | "unsupported-capability" | "route-unavailable"
  status: "refused"
  runtime: string
  entry: string
  executionProfile: string | null
  adapterSource: string | null
  adapterLabel: string | null
  reason: string
  message: string
  capability?: unknown
}>

export type RuntimeRouteResolutionOk = Readonly<{
  ok: true
  routeId: string
  runtimeId: string
  entry: RuntimeRouteEntry
  kind: RuntimeRouteKind
  executionSurface: RuntimeRouteExecutionSurface
  adapterSource: string
  adapterLabel: string
  /** Typed main-only leaf delegate; `null` for a completion route. */
  delegate: RuntimeRouteDelegate | null
  transport: string
  manifestRef: RuntimeRouteManifestRef
  /** `null` for a completion route (null does not mean ready). */
  readinessProbe: RuntimeRouteReadinessProbe | null
  enforcementEvidence: AgentRuntimeEnforcementEvidence
  extensions: readonly RuntimeRouteExtensionDeclaration[]
  diagnostic: RuntimeRouteSelectionDiagnostic
}>

export type RuntimeRouteResolutionFailure = Readonly<{
  ok: false
  reason: RuntimeRouteResolutionFailureReason
  runtimeId: string
  entry: string
  kind: string
  executionProfile: string | null
  candidateAdapterSource: string | null
  candidateAdapterLabel: string | null
  diagnostic: RuntimeRouteRefusalDiagnostic
  result: Readonly<{
    status: "failed"
    exitCode: 1
    errorCode: string
    errorMessage: string
  }>
}>

export type RuntimeRouteResolution =
  | RuntimeRouteResolutionOk
  | RuntimeRouteResolutionFailure

/** Function-free enumeration descriptor (listRuntimeRoutes). */
export type RuntimeRouteDescriptor = Readonly<{
  routeId: string
  runtimeId: string
  runtimeLabel: string
  manifestRef: string
  cancellation: string
  sessionReference: string
  entries: readonly RuntimeRouteEntry[]
  kind: RuntimeRouteKind
  modes: readonly RuntimeRouteMode[] | null
  executionProfile: RuntimeRouteExecutionProfile | null
  executionSurface: RuntimeRouteExecutionSurface
  adapterSource: string
  adapterLabel: string
  transport: string
  transportId: string | null
  enforcementEvidence: AgentRuntimeEnforcementEvidence
  extensions: readonly RuntimeRouteExtensionDeclaration[]
}>

export type RuntimeRouteListFilter = {
  runtimeId?: string
  entry?: RuntimeRouteEntry
  kind?: RuntimeRouteKind
}

/** Renderer overload: exactly `{routeId, runtimeId, transportId}`. */
export type RendererRuntimeRouteProjection = Readonly<{
  routeId: string
  runtimeId: string
  transportId: string
}>

/** Public overload: optional experimental discovery summaries (surface api). */
export type PublicRuntimeRouteProjection = Readonly<{
  runtimeId: string
  routes: readonly LocalJobApiRuntimeRouteSummary[]
}>

// ---------------------------------------------------------------------------
// Production table (static; the only production declaration)
// ---------------------------------------------------------------------------

const RUNTIME_CODEX_V1_EXTENSION: RuntimeRouteExtensionDeclaration = {
  namespace: "runtime.codex.v1",
  schemaVersion: 1,
  maturity: "experimental",
  schemaRef: "#/$defs/eventPayloadExtensions/properties/runtime.codex.v1",
  redactionOwner: "src/main/lib/agent-runtime/run-event-ledger.ts",
}

function completionRoute(runtimeId: string): RuntimeRouteDeclaration {
  return {
    routeId: `${runtimeId}.completion`,
    entries: ["api", "completion"],
    kind: "completion",
    modes: null,
    executionProfile: null,
    executionSurface: "completion",
    adapterSource: "locus-completion",
    adapterLabel: "Locus completion",
    transport: "provider-http",
    transportId: null,
    factoryRef: null,
    readinessProbeRef: null,
    enforcementEvidenceRef: null,
    enforcementEvidence: "none",
    extensions: [],
  }
}

const PRODUCTION_DECLARATIONS: RuntimeRouteCatalogDeclarations = deepFreeze([
  {
    runtimeId: "claude-code",
    label: "Claude Code",
    manifestRef: "claude-code",
    cancellation: "abort-signal",
    sessionReference: "native-session-id",
    routes: [
      completionRoute("claude-code"),
      {
        routeId: "claude-code.desktop.agent-sdk",
        entries: ["desktop"],
        kind: "agent",
        modes: ["plan", "agent"],
        executionProfile: "interactive",
        executionSurface: "desktop-sdk",
        adapterSource: "claude-agent-sdk",
        adapterLabel: "Claude Agent SDK",
        transport: "agent-sdk",
        transportId: "claude-chat-ipc",
        factoryRef: "desktop:claude-agent-sdk",
        readinessProbeRef: "readiness:claude-code",
        enforcementEvidenceRef: "desktop:claude-agent-sdk",
        enforcementEvidence: "pre-execution",
        extensions: [],
      },
      {
        routeId: "claude-code.headless.batch",
        entries: ["headless", "api", "protocol"],
        kind: "agent",
        modes: ["plan", "agent"],
        executionProfile: "batch",
        executionSurface: "headless-exec",
        adapterSource: "claude-code-batch",
        adapterLabel: "Claude Code batch",
        transport: "process-stdio",
        transportId: null,
        factoryRef: "headless:claude-code-batch",
        readinessProbeRef: "readiness:claude-code",
        enforcementEvidenceRef: "headless:claude-code-batch",
        enforcementEvidence: "sandbox-level",
        extensions: [],
      },
    ],
  },
  {
    runtimeId: "codex",
    label: "Codex",
    manifestRef: "codex",
    cancellation: "abort-signal",
    sessionReference: "native-thread-id",
    routes: [
      {
        routeId: "codex.api.policy-grant",
        entries: ["api"],
        kind: "agent",
        modes: ["plan", "agent"],
        executionProfile: "policy-grant",
        executionSurface: "headless-app-server",
        adapterSource: "codex-app-server",
        adapterLabel: "Codex app-server",
        transport: "json-rpc-stdio",
        transportId: null,
        factoryRef: "headless:codex-app-server",
        readinessProbeRef: "readiness:codex",
        enforcementEvidenceRef: "headless:codex-app-server",
        enforcementEvidence: "admission-audit",
        extensions: [RUNTIME_CODEX_V1_EXTENSION],
      },
      completionRoute("codex"),
      {
        routeId: "codex.desktop.app-server",
        entries: ["desktop"],
        kind: "agent",
        modes: ["plan", "agent"],
        executionProfile: "interactive",
        executionSurface: "desktop-app-server",
        adapterSource: "codex-app-server",
        adapterLabel: "Codex app-server adapter",
        transport: "json-rpc-stdio",
        transportId: "codex-chat-ipc",
        factoryRef: "desktop:codex-app-server",
        readinessProbeRef: "readiness:codex",
        enforcementEvidenceRef: "desktop:codex-app-server",
        enforcementEvidence: "pre-execution",
        extensions: [],
      },
      {
        routeId: "codex.headless.batch",
        entries: ["headless", "api", "protocol"],
        kind: "agent",
        modes: ["plan", "agent"],
        executionProfile: "batch",
        executionSurface: "headless-exec",
        adapterSource: "codex-batch",
        adapterLabel: "Codex headless/batch",
        transport: "process-stdio",
        transportId: null,
        factoryRef: "headless:codex-batch",
        readinessProbeRef: "readiness:codex",
        enforcementEvidenceRef: "headless:codex-batch",
        enforcementEvidence: "sandbox-level",
        extensions: [],
      },
    ],
  },
])

/**
 * Lazy leaf references: a leaf module is loaded only when its delegate is
 * invoked, so no query or module import constructs a native adapter.
 */
const PRODUCTION_AGENT_FACTORIES: Readonly<
  Record<string, RuntimeRouteDelegate>
> = {
  "headless:claude-code-batch": (async (request, observer) =>
    (
      await import("../headless/adapters/claude-code")
    ).runClaudeCodeHeadlessTask(
      request,
      observer,
    )) satisfies HeadlessRuntimeRouteDelegate,
  "headless:codex-batch": (async (request, observer) =>
    (await import("../headless/adapters/codex")).runCodexHeadlessTask(
      request,
      observer,
    )) satisfies HeadlessRuntimeRouteDelegate,
  "headless:codex-app-server": (async (request, observer) =>
    (
      await import("../headless/adapters/codex-app-server")
    ).runCodexAppServerHeadlessTask(
      request,
      observer,
    )) satisfies HeadlessRuntimeRouteDelegate,
  "desktop:claude-agent-sdk": (async (input) =>
    (
      await import("../claude/agent-sdk-adapter-runner")
    ).runClaudeAgentSdkDesktopAdapterWithPreparedRuntimeQuery(
      input,
    )) satisfies ClaudeDesktopRuntimeRouteDelegate,
  "desktop:codex-app-server": (async (input) =>
    (
      await import("../codex/app-server-adapter-runner")
    ).runCodexAppServerDesktopAdapter(
      input,
    )) satisfies CodexDesktopRuntimeRouteDelegate,
}

/** The probe context forwarded to a runtime's readiness leaf probe. */
function readinessProbeOptions(
  context: RuntimeRouteReadinessContext,
): RuntimeReadinessProbeOptions {
  return {
    ...(context.dependencies ? { dependencies: context.dependencies } : {}),
    ...(context.onDiagnostic ? { onDiagnostic: context.onDiagnostic } : {}),
    ...(context.probe === undefined ? {} : { probe: context.probe }),
  }
}

/** Per-runtime readiness leaf probes (runtime-readiness.ts owns them). */
const PRODUCTION_READINESS_PROBES: Readonly<
  Record<string, RuntimeRouteReadinessProbe>
> = {
  "readiness:claude-code": (context = {}) =>
    resolveClaudeCodeRuntimeReadiness(readinessProbeOptions(context)),
  "readiness:codex": (context = {}) =>
    resolveCodexRuntimeReadiness(readinessProbeOptions(context)),
}

/**
 * The typed enforcement evidence each leaf exports (its value is the one the
 * side-effect-free evidence module holds, so referencing it loads no leaf):
 * the type checker binds every entry to its leaf's export.
 */
const PRODUCTION_ENFORCEMENT_EVIDENCE: Readonly<
  Record<string, AgentRuntimeEnforcementEvidence>
> = {
  "headless:claude-code-batch":
    CLAUDE_CODE_BATCH_ENFORCEMENT_EVIDENCE satisfies typeof import("../headless/adapters/claude-code").CLAUDE_CODE_BATCH_ENFORCEMENT_EVIDENCE,
  "headless:codex-batch":
    CODEX_BATCH_ENFORCEMENT_EVIDENCE satisfies typeof import("../headless/adapters/codex").CODEX_BATCH_ENFORCEMENT_EVIDENCE,
  "headless:codex-app-server":
    CODEX_APP_SERVER_HEADLESS_ENFORCEMENT_EVIDENCE satisfies typeof import("../headless/adapters/codex-app-server").CODEX_APP_SERVER_HEADLESS_ENFORCEMENT_EVIDENCE,
  "desktop:claude-agent-sdk": CLAUDE_AGENT_SDK_DESKTOP_ENFORCEMENT_EVIDENCE,
  "desktop:codex-app-server": CODEX_APP_SERVER_DESKTOP_ENFORCEMENT_EVIDENCE,
}

function ownEntry<T>(
  table: Readonly<Record<string, T>>,
  ref: unknown,
): T | null {
  return typeof ref === "string" && Object.hasOwn(table, ref)
    ? (table[ref] ?? null)
    : null
}

const PRODUCTION_REFERENCES: RuntimeRouteCatalogReferences = Object.freeze({
  normalizeRuntimeId: (raw: unknown) =>
    toAgentRuntimeId(typeof raw === "string" ? raw : null),
  getManifest: (ref: unknown) => {
    const lookup = resolveAgentRuntimeCapabilityManifest(
      typeof ref === "string" ? ref : null,
    )
    return lookup.ok ? lookup.manifest : null
  },
  lookupAgentFactory: (ref: unknown) =>
    ownEntry(PRODUCTION_AGENT_FACTORIES, ref),
  lookupReadinessProbe: (ref: unknown) =>
    ownEntry(PRODUCTION_READINESS_PROBES, ref),
  lookupEnforcementEvidence: (ref: unknown) =>
    ownEntry(PRODUCTION_ENFORCEMENT_EVIDENCE, ref),
})

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type InternalRoute = {
  runtimeId: string
  routeId: string
  entries: readonly RuntimeRouteEntry[]
  kind: RuntimeRouteKind
  modes: readonly RuntimeRouteMode[] | null
  executionProfile: RuntimeRouteExecutionProfile | null
  executionSurface: RuntimeRouteExecutionSurface
  adapterSource: string
  adapterLabel: string
  transport: string
  transportId: string | null
  factoryRef: string | null
  readinessProbeRef: string | null
  enforcementEvidence: AgentRuntimeEnforcementEvidence
  extensions: readonly RuntimeRouteExtensionDeclaration[]
}

type InternalRuntime = {
  runtimeId: string
  runtimeLabel: string
  manifestRef: string
  cancellation: string
  sessionReference: string
  routes: readonly InternalRoute[]
}

type CatalogData = {
  runtimes: readonly InternalRuntime[]
  routes: readonly InternalRoute[]
  references: RuntimeRouteCatalogReferences
}

const catalogData = new WeakMap<object, CatalogData>()

const ENFORCEMENT_LEVELS: readonly AgentRuntimeEnforcementEvidence[] = [
  "none",
  "sandbox-level",
  "admission-audit",
  "pre-execution",
]
const ROUTE_MODES: readonly RuntimeRouteMode[] = ["plan", "agent"]
const AGENT_PROFILES: readonly RuntimeRouteExecutionProfile[] = [
  "batch",
  "policy-grant",
  "interactive",
]
const EXTENSION_MATURITIES = ["experimental", "stable"] as const

class RuntimeRouteCatalogInvalid extends Error {
  constructor(readonly offending: RuntimeRouteCatalogOffending) {
    super(offending.problem)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const entry of Object.values(value)) deepFreeze(entry)
  }
  return value
}

function invalid(
  problem: string,
  field: string,
  at: { runtimeId?: string | null; routeId?: string | null } = {},
  conflictingRouteId: string | null = null,
): never {
  throw new RuntimeRouteCatalogInvalid({
    runtimeId: at.runtimeId ?? null,
    routeId: at.routeId ?? null,
    conflictingRouteId,
    field,
    problem,
  })
}

function stringList<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const items: T[] = []
  for (const item of value) {
    if (typeof item !== "string" || !allowed.includes(item as T)) return null
    if (items.includes(item as T)) return null
    items.push(item as T)
  }
  return items
}

function validateExtensions(
  value: unknown,
  at: { runtimeId: string; routeId: string },
): RuntimeRouteExtensionDeclaration[] {
  if (!Array.isArray(value)) invalid("extensions_not_array", "extensions", at)
  const namespaces = new Set<string>()
  return value.map((entry) => {
    if (!isRecord(entry)) invalid("extension_malformed", "extensions", at)
    const namespace = entry.namespace
    if (namespace !== `runtime.${at.runtimeId}.v1`) {
      invalid("extension_namespace_illegal", "extensions.namespace", at)
    }
    if (namespaces.has(namespace)) {
      invalid("extension_duplicate", "extensions.namespace", at)
    }
    namespaces.add(namespace)
    if (entry.schemaVersion !== 1) {
      invalid("extension_schema_version", "extensions.schemaVersion", at)
    }
    const maturity = entry.maturity
    if (
      typeof maturity !== "string" ||
      !EXTENSION_MATURITIES.includes(
        maturity as (typeof EXTENSION_MATURITIES)[number],
      )
    ) {
      invalid("extension_maturity", "extensions.maturity", at)
    }
    const schemaRef = entry.schemaRef
    const published = Object.hasOwn(
      LOCAL_JOB_API_RUNTIME_EXTENSION_SCHEMA_REFS,
      namespace,
    )
      ? LOCAL_JOB_API_RUNTIME_EXTENSION_SCHEMA_REFS[namespace]
      : undefined
    if (
      typeof schemaRef !== "string" ||
      !schemaRef.startsWith("#/") ||
      schemaRef !== published
    ) {
      invalid("extension_schema_unresolved", "extensions.schemaRef", at)
    }
    if (!isNonEmptyString(entry.redactionOwner)) {
      invalid("extension_redaction_owner", "extensions.redactionOwner", at)
    }
    return {
      namespace,
      schemaVersion: 1,
      maturity: maturity as RuntimeRouteExtensionDeclaration["maturity"],
      schemaRef,
      redactionOwner: entry.redactionOwner,
    }
  })
}

function validateRoute(
  value: unknown,
  runtimeId: string,
  references: RuntimeRouteCatalogReferences,
): InternalRoute {
  const routeId =
    isRecord(value) && isNonEmptyString(value.routeId) ? value.routeId : null
  const at = { runtimeId, routeId }
  if (!isRecord(value) || routeId === null) {
    invalid("route_malformed", "routeId", at)
  }
  const entries = stringList(value.entries, RUNTIME_ROUTE_ENTRIES)
  if (!entries) invalid("route_entries", "entries", at)
  const kind = value.kind
  if (kind !== "agent" && kind !== "completion") {
    invalid("route_kind", "kind", at)
  }
  const executionSurface = value.executionSurface
  if (
    typeof executionSurface !== "string" ||
    !RUNTIME_ROUTE_EXECUTION_SURFACES.includes(
      executionSurface as RuntimeRouteExecutionSurface,
    ) ||
    (kind === "completion") !== (executionSurface === "completion")
  ) {
    invalid("route_execution_surface", "executionSurface", at)
  }
  for (const field of ["adapterSource", "adapterLabel", "transport"]) {
    if (!isNonEmptyString(value[field])) invalid("route_field", field, at)
  }
  const enforcementEvidence = value.enforcementEvidence
  if (
    typeof enforcementEvidence !== "string" ||
    !ENFORCEMENT_LEVELS.includes(
      enforcementEvidence as AgentRuntimeEnforcementEvidence,
    )
  ) {
    invalid("route_enforcement_evidence", "enforcementEvidence", at)
  }

  let modes: RuntimeRouteMode[] | null = null
  let executionProfile: RuntimeRouteExecutionProfile | null = null
  let factoryRef: string | null = null
  if (kind === "agent") {
    if (entries.includes("completion")) {
      invalid("agent_route_on_completion_entry", "entries", at)
    }
    modes = stringList(value.modes, ROUTE_MODES)
    if (!modes) invalid("route_modes", "modes", at)
    const profile = value.executionProfile
    if (
      typeof profile !== "string" ||
      !AGENT_PROFILES.includes(profile as RuntimeRouteExecutionProfile)
    ) {
      invalid("route_execution_profile", "executionProfile", at)
    }
    executionProfile = profile as RuntimeRouteExecutionProfile
    const desktop = entries.includes("desktop")
    if (
      (executionProfile === "interactive") !== desktop ||
      (desktop && entries.length !== 1)
    ) {
      invalid("route_desktop_profile", "executionProfile", at)
    }
    if (!isNonEmptyString(value.factoryRef)) {
      invalid("agent_factory_missing", "factoryRef", at)
    }
    // The reference port resolves the typed delegate; the catalog treats it
    // as opaque and only requires that the reference resolves.
    if (references.lookupAgentFactory(value.factoryRef) == null) {
      invalid("agent_factory_unresolved", "factoryRef", at)
    }
    factoryRef = value.factoryRef
    if (!isNonEmptyString(value.readinessProbeRef)) {
      invalid("agent_readiness_probe_missing", "readinessProbeRef", at)
    }
  } else {
    if (
      value.modes !== null ||
      value.executionProfile !== null ||
      value.factoryRef !== null ||
      entries.some((entry) => entry !== "api" && entry !== "completion")
    ) {
      invalid("completion_route_shape", "kind", at)
    }
  }

  const readinessProbeRef = value.readinessProbeRef
  if (readinessProbeRef !== null) {
    if (
      !isNonEmptyString(readinessProbeRef) ||
      typeof references.lookupReadinessProbe(readinessProbeRef) !== "function"
    ) {
      invalid("readiness_probe_unresolved", "readinessProbeRef", at)
    }
  }

  const evidenceRef = value.enforcementEvidenceRef
  if (evidenceRef === null) {
    if (kind === "agent" || enforcementEvidence !== "none") {
      invalid("enforcement_evidence_missing", "enforcementEvidenceRef", at)
    }
  } else {
    const leafEvidence = isNonEmptyString(evidenceRef)
      ? references.lookupEnforcementEvidence(evidenceRef)
      : null
    if (leafEvidence !== enforcementEvidence) {
      invalid("enforcement_evidence_mismatch", "enforcementEvidence", at)
    }
  }

  const transportId = value.transportId
  if (entries.includes("desktop")) {
    if (!isNonEmptyString(transportId)) {
      invalid("desktop_transport_id_missing", "transportId", at)
    }
  } else if (transportId !== null) {
    invalid("transport_id_outside_desktop", "transportId", at)
  }

  return {
    runtimeId,
    routeId,
    entries,
    kind,
    modes,
    executionProfile,
    executionSurface: executionSurface as RuntimeRouteExecutionSurface,
    adapterSource: value.adapterSource as string,
    adapterLabel: value.adapterLabel as string,
    transport: value.transport as string,
    transportId: entries.includes("desktop") ? (transportId as string) : null,
    factoryRef,
    readinessProbeRef: readinessProbeRef as string | null,
    enforcementEvidence: enforcementEvidence as AgentRuntimeEnforcementEvidence,
    extensions: validateExtensions(value.extensions, { runtimeId, routeId }),
  }
}

function intersects<T>(
  left: readonly T[] | null,
  right: readonly T[] | null,
): boolean {
  if (left === null || right === null) return left === right
  return left.some((item) => right.includes(item))
}

function validateDeclarations(
  declarations: unknown,
  references: RuntimeRouteCatalogReferences,
): CatalogData {
  if (!Array.isArray(declarations) || declarations.length === 0) {
    invalid("declarations_malformed", "declarations")
  }
  const runtimes: InternalRuntime[] = []
  const routeIds = new Set<string>()
  for (const value of declarations) {
    const declaredRuntimeId =
      isRecord(value) && isNonEmptyString(value.runtimeId)
        ? value.runtimeId
        : null
    const at = {
      runtimeId: declaredRuntimeId,
      routeId:
        isRecord(value) && isNonEmptyString(value.routeId)
          ? value.routeId
          : null,
    }
    if (!isRecord(value) || declaredRuntimeId === null) {
      invalid("runtime_malformed", "runtimeId", at)
    }
    const runtimeId = declaredRuntimeId
    if (references.normalizeRuntimeId(runtimeId) !== runtimeId) {
      invalid("runtime_id_not_canonical", "runtimeId", at)
    }
    if (runtimes.some((runtime) => runtime.runtimeId === runtimeId)) {
      invalid("duplicate_runtime", "runtimeId", at)
    }
    for (const field of [
      "label",
      "manifestRef",
      "cancellation",
      "sessionReference",
    ]) {
      if (!isNonEmptyString(value[field])) invalid("runtime_field", field, at)
    }
    const manifest = references.getManifest(value.manifestRef)
    if (
      !isRecord(manifest) ||
      manifest.runtimeId !== runtimeId ||
      !isNonEmptyString(manifest.label) ||
      !Array.isArray(manifest.capabilities)
    ) {
      invalid("manifest_unresolved", "manifestRef", at)
    }
    if (!Array.isArray(value.routes)) invalid("routes_malformed", "routes", at)
    const routes: InternalRoute[] = []
    for (const routeValue of value.routes) {
      const route = validateRoute(routeValue, runtimeId, references)
      if (routeIds.has(route.routeId)) {
        invalid("duplicate_route", "routeId", {
          runtimeId,
          routeId: route.routeId,
        })
      }
      routeIds.add(route.routeId)
      const overlapping = routes.find(
        (other) =>
          other.kind === route.kind &&
          other.executionProfile === route.executionProfile &&
          intersects(other.entries, route.entries) &&
          intersects(other.modes, route.modes),
      )
      if (overlapping) {
        invalid(
          "overlapping_routes",
          "entries",
          { runtimeId, routeId: route.routeId },
          overlapping.routeId,
        )
      }
      routes.push(route)
    }
    runtimes.push({
      runtimeId,
      runtimeLabel: manifest.label,
      manifestRef: value.manifestRef as string,
      cancellation: value.cancellation as string,
      sessionReference: value.sessionReference as string,
      routes: [...routes].sort((left, right) =>
        codePointCompare(left.routeId, right.routeId),
      ),
    })
  }
  runtimes.sort((left, right) =>
    codePointCompare(left.runtimeId, right.runtimeId),
  )
  return {
    runtimes: deepFreeze(runtimes),
    routes: deepFreeze(
      runtimes
        .flatMap((runtime) => runtime.routes)
        .sort((left, right) => codePointCompare(left.routeId, right.routeId)),
    ),
    references,
  }
}

/**
 * Validates a declaration table against its reference ports. Omitted inputs
 * validate the real production table and ports; a partial `references`
 * object is merged over the production ports. Invalid tables (duplicates,
 * intersecting match domains, missing references, illegal extension
 * namespaces, enforcement mismatches) return the non-executable failure
 * state, never a partial catalog.
 */
export function validateRuntimeRouteCatalog(
  declarations?: RuntimeRouteCatalogDeclarations,
  references?: Partial<RuntimeRouteCatalogReferences>,
): RuntimeRouteCatalogValidation {
  const ports: RuntimeRouteCatalogReferences = Object.freeze({
    ...PRODUCTION_REFERENCES,
    ...(references ?? {}),
  })
  try {
    const data = validateDeclarations(
      declarations ?? PRODUCTION_DECLARATIONS,
      ports,
    )
    const catalog = Object.freeze({
      kind: "runtime-route-catalog" as const,
      routeIds: Object.freeze(data.routes.map((route) => route.routeId)),
    }) as ValidatedRuntimeRouteCatalog
    catalogData.set(catalog, data)
    return Object.freeze({ ok: true as const, catalog })
  } catch (error) {
    const offending: RuntimeRouteCatalogOffending =
      error instanceof RuntimeRouteCatalogInvalid
        ? error.offending
        : {
            runtimeId: null,
            routeId: null,
            conflictingRouteId: null,
            field: "references",
            problem: "reference_port_failed",
          }
    return deepFreeze({
      ok: false as const,
      reason: "catalog_invalid" as const,
      offending: { ...offending },
    })
  }
}

/**
 * Tests only: builds a catalog state through the same validator. An invalid
 * table returns the validator's own failure state (no throw).
 */
export function createRuntimeRouteCatalogForTests(
  declarations: RuntimeRouteCatalogDeclarations,
  references: Partial<RuntimeRouteCatalogReferences>,
): RuntimeRouteCatalogState {
  const validated = validateRuntimeRouteCatalog(declarations, references)
  return validated.ok ? validated.catalog : validated
}

function initializeProductionCatalog(): RuntimeRouteCatalogState {
  const validated = validateRuntimeRouteCatalog()
  return validated.ok ? validated.catalog : validated
}

/** Module-private validated production singleton (or its failure state). */
const PRODUCTION_CATALOG: RuntimeRouteCatalogState =
  initializeProductionCatalog()

function dataOf(
  catalog: RuntimeRouteCatalogState | undefined,
): CatalogData | null {
  const state = catalog === undefined ? PRODUCTION_CATALOG : catalog
  return isRecord(state) ? (catalogData.get(state) ?? null) : null
}

function requireData(
  catalog: RuntimeRouteCatalogState | undefined,
): CatalogData {
  const data = dataOf(catalog)
  if (!data) throw new Error(RUNTIME_ROUTE_CATALOG_UNAVAILABLE_MESSAGE)
  return data
}

// ---------------------------------------------------------------------------
// Resolution (design D1 matching order and the baseline refusal chain)
// ---------------------------------------------------------------------------

const HEADLESS_DIAGNOSTIC_CANDIDATE_ENTRIES: readonly string[] = [
  "headless",
  "api",
  "protocol",
]

type QueryView = {
  runtimeId: string
  entry: string
  kind: string
  executionProfile: string | null
}

function queryView(query: unknown, runtimeId: string | null): QueryView {
  const record = isRecord(query) ? query : {}
  return {
    runtimeId:
      runtimeId ??
      (typeof record.runtimeId === "string" ? record.runtimeId : ""),
    entry: typeof record.entry === "string" ? record.entry : "",
    kind: typeof record.kind === "string" ? record.kind : "",
    executionProfile:
      typeof record.executionProfile === "string"
        ? record.executionProfile
        : null,
  }
}

function refusal(input: {
  view: QueryView
  reason: RuntimeRouteResolutionFailureReason
  candidate: InternalRoute | null
  type?: RuntimeRouteRefusalDiagnostic["type"]
  diagnosticReason: string
  errorCode: string
  message: string
  capability?: unknown
}): RuntimeRouteResolutionFailure {
  const { view, candidate } = input
  return deepFreeze({
    ok: false as const,
    reason: input.reason,
    runtimeId: view.runtimeId,
    entry: view.entry,
    kind: view.kind,
    executionProfile: view.executionProfile,
    candidateAdapterSource: candidate?.adapterSource ?? null,
    candidateAdapterLabel: candidate?.adapterLabel ?? null,
    diagnostic: {
      type: input.type ?? "adapter-refused",
      status: "refused" as const,
      runtime: view.runtimeId,
      entry: view.entry,
      executionProfile: view.executionProfile,
      adapterSource: candidate?.adapterSource ?? null,
      adapterLabel: candidate?.adapterLabel ?? null,
      reason: input.diagnosticReason,
      message: input.message,
      ...(input.capability === undefined
        ? {}
        : { capability: input.capability }),
    },
    result: {
      status: "failed" as const,
      exitCode: 1 as const,
      errorCode: input.errorCode,
      errorMessage: input.message,
    },
  })
}

function unavailable(
  view: QueryView,
  reason: "route_not_found" | "catalog_invalid",
  candidate: InternalRoute | null = null,
): RuntimeRouteResolutionFailure {
  return refusal({
    view,
    reason,
    candidate,
    type: "route-unavailable",
    diagnosticReason: reason,
    errorCode: "runtime_error",
    message: RUNTIME_ROUTE_CATALOG_UNAVAILABLE_MESSAGE,
  })
}

function supportsPolicyGrantGate(route: InternalRoute): boolean {
  return (
    route.enforcementEvidence === "admission-audit" ||
    route.enforcementEvidence === "pre-execution"
  )
}

function uniqueCapabilities(value: unknown): AgentRuntimeCapabilityId[] | null {
  if (!Array.isArray(value)) return null
  const items: AgentRuntimeCapabilityId[] = []
  for (const item of value) {
    if (typeof item !== "string") return null
    if (!items.includes(item as AgentRuntimeCapabilityId)) {
      items.push(item as AgentRuntimeCapabilityId)
    }
  }
  return items
}

function selectedResolution(input: {
  data: CatalogData
  runtime: InternalRuntime
  route: InternalRoute
  entry: RuntimeRouteEntry
  executionProfile: RuntimeRouteExecutionProfile | null
  delegate: RuntimeRouteDelegate | null
  policy: AgentRuntimePermissionPolicySummary | null
}): RuntimeRouteResolutionOk {
  const { data, runtime, route } = input
  const probe =
    route.readinessProbeRef === null
      ? null
      : data.references.lookupReadinessProbe(route.readinessProbeRef)
  const policyGrant = input.policy?.kind === "policy-grant"
  const policyGrantScopeBinding = policyGrant
    ? route.enforcementEvidence === "pre-execution"
      ? ("declared-scopes-bound" as const)
      : ("admission-audit-only" as const)
    : null
  const profileLabel = input.executionProfile ?? route.kind
  const message =
    policyGrant && route.enforcementEvidence === "admission-audit"
      ? `Selected ${route.adapterLabel} for ${input.entry} ${profileLabel} execution; declared policy grant scopes are admission/audit metadata and are not bound to app-server permission enforcement in this change.`
      : `Selected ${route.adapterLabel} for ${input.entry} ${profileLabel} execution.`
  const resolution: RuntimeRouteResolutionOk = {
    ok: true,
    routeId: route.routeId,
    runtimeId: runtime.runtimeId,
    entry: input.entry,
    kind: route.kind,
    executionSurface: route.executionSurface,
    adapterSource: route.adapterSource,
    adapterLabel: route.adapterLabel,
    delegate: input.delegate,
    transport: route.transport,
    manifestRef: {
      ref: runtime.manifestRef,
      runtimeId: runtime.runtimeId,
      label: runtime.runtimeLabel,
    },
    readinessProbe:
      typeof probe === "function"
        ? (probe as RuntimeRouteReadinessProbe)
        : null,
    enforcementEvidence: route.enforcementEvidence,
    extensions: route.extensions,
    diagnostic: {
      type: "adapter-selected",
      status: "selected",
      runtime: runtime.runtimeId,
      entry: input.entry,
      executionProfile: input.executionProfile,
      adapterSource: route.adapterSource,
      adapterLabel: route.adapterLabel,
      fallbackReason: null,
      policyGrantScopeBinding,
      message,
    },
  }
  return deepFreeze(resolution)
}

function missingRequiredExtension(
  route: InternalRoute,
  requiredExtensions: readonly string[],
): string | null {
  return (
    requiredExtensions.find(
      (namespace) =>
        !route.extensions.some(
          (extension) => extension.namespace === namespace,
        ),
    ) ?? null
  )
}

function resolveCompletion(input: {
  data: CatalogData
  runtime: InternalRuntime
  query: Record<string, unknown>
  view: QueryView
  entry: RuntimeRouteEntry
  requiredExtensions: readonly string[]
}): RuntimeRouteResolution {
  const { query, view } = input
  if (
    query.mode !== null ||
    query.executionProfile !== null ||
    query.permissionPolicy != null
  ) {
    return unavailable(view, "route_not_found")
  }
  const route = input.runtime.routes.find(
    (candidate) =>
      candidate.kind === "completion" &&
      candidate.entries.includes(input.entry),
  )
  if (!route) return unavailable(view, "route_not_found")
  const missing = missingRequiredExtension(route, input.requiredExtensions)
  if (missing) {
    return refusal({
      view,
      reason: "unsupported_required_extension",
      candidate: route,
      diagnosticReason: "unsupported_required_extension",
      errorCode: "unsupported_required_extension",
      message: `${route.adapterLabel} does not declare required runtime extension ${missing}.`,
    })
  }
  return selectedResolution({
    data: input.data,
    runtime: input.runtime,
    route,
    entry: input.entry,
    executionProfile: null,
    delegate: null,
    policy: null,
  })
}

function resolveAgent(input: {
  data: CatalogData
  runtime: InternalRuntime
  query: Record<string, unknown>
  view: QueryView
  entry: RuntimeRouteEntry
  requiredExtensions: readonly string[]
}): RuntimeRouteResolution {
  const { data, runtime, query, view, entry } = input
  const mode = query.mode
  const executionProfile = query.executionProfile
  const policy = query.permissionPolicy
  const requiredCapabilities = uniqueCapabilities(query.requiredCapabilities)
  if (
    (mode !== "plan" && mode !== "agent") ||
    typeof executionProfile !== "string" ||
    !isRecord(policy) ||
    !Array.isArray(policy.diagnostics) ||
    requiredCapabilities === null
  ) {
    return unavailable(view, "route_not_found")
  }
  const permissionPolicy = policy as AgentRuntimePermissionPolicySummary

  // entry/kind/mode/profile domain, then the diagnostic candidate: the
  // exact profile leaf, else the runtime's batch route of a headless/api/
  // protocol entry (never an executable substitute).
  const domain = runtime.routes.filter(
    (route) =>
      route.kind === "agent" &&
      route.entries.includes(entry) &&
      (route.modes ?? []).includes(mode),
  )
  const exact =
    domain.find((route) => route.executionProfile === executionProfile) ?? null
  const candidate =
    exact ??
    (HEADLESS_DIAGNOSTIC_CANDIDATE_ENTRIES.includes(entry)
      ? (domain.find((route) => route.executionProfile === "batch") ?? null)
      : null)
  if (!candidate) return unavailable(view, "route_not_found")

  // The baseline refusal chain, in its original order.
  if (permissionPolicy.kind === "fail-closed") {
    return refusal({
      view,
      reason: "policy_refused",
      candidate,
      diagnosticReason:
        permissionPolicy.failClosedReasons?.[0] ??
        "permission_policy_fail_closed",
      errorCode: "permission_policy_fail_closed",
      message:
        permissionPolicy.diagnostics[0] ??
        "Non-desktop permission policy failed closed before provider work.",
    })
  }
  if (
    permissionPolicy.kind === "policy-grant" &&
    !supportsPolicyGrantGate(candidate)
  ) {
    return refusal({
      view,
      reason: "policy_refused",
      candidate,
      diagnosticReason: "policy_grant_adapter_unavailable",
      errorCode: "policy_grant_adapter_unavailable",
      message: `${candidate.adapterLabel} exposes only ${candidate.enforcementEvidence} enforcement for this headless adapter; policy-grant execution requires an app-server admission gate or true pre-execution scope binding before provider work.`,
    })
  }
  if (
    requiredCapabilities.includes("hardToolGuard") &&
    candidate.enforcementEvidence !== "pre-execution"
  ) {
    return refusal({
      view,
      reason: "policy_refused",
      candidate,
      diagnosticReason: "guarded_scope_requires_pre_execution_hook",
      errorCode: "guarded_scope_requires_pre_execution_hook",
      message: `${candidate.adapterLabel} exposes only ${candidate.enforcementEvidence} enforcement for this headless adapter; guarded scope contracts require a pre-execution hook or must fail closed before provider work.`,
    })
  }
  if (
    executionProfile === "interactive" &&
    (candidate !== exact || permissionPolicy.interaction !== "visible-user")
  ) {
    return refusal({
      view,
      reason: "policy_refused",
      candidate,
      diagnosticReason: "interactive_channel_required",
      errorCode: "interactive_channel_required",
      message:
        "Interactive runtime execution requires a visible user interaction channel.",
    })
  }
  if (
    executionProfile !== "batch" &&
    executionProfile !== "policy-grant" &&
    executionProfile !== "interactive"
  ) {
    return refusal({
      view,
      reason: "policy_refused",
      candidate,
      diagnosticReason: "unsupported_execution_profile",
      errorCode: "unsupported_execution_profile",
      message: `${executionProfile} runtime execution is not available for current headless adapters.`,
    })
  }
  if (requiredCapabilities.length > 0) {
    const manifest = data.references.getManifest(runtime.manifestRef)
    if (!isRecord(manifest) || manifest.runtimeId !== runtime.runtimeId) {
      return unavailable(view, "catalog_invalid", candidate)
    }
    for (const capabilityId of requiredCapabilities) {
      const gate = checkAgentRuntimeManifestCapability({
        manifest,
        capabilityId,
      })
      if (!gate.ok) {
        return refusal({
          view,
          reason: "capability_refused",
          candidate,
          type: "unsupported-capability",
          diagnosticReason: "unsupported_capability",
          errorCode: "unsupported_capability",
          message: gate.diagnostic.message,
          capability: gate.diagnostic,
        })
      }
    }
  }
  const missing = missingRequiredExtension(candidate, input.requiredExtensions)
  if (missing) {
    return refusal({
      view,
      reason: "unsupported_required_extension",
      candidate,
      diagnosticReason: "unsupported_required_extension",
      errorCode: "unsupported_required_extension",
      message: `${candidate.adapterLabel} does not declare required runtime extension ${missing}.`,
    })
  }
  if (candidate !== exact)
    return unavailable(view, "route_not_found", candidate)

  // The one executable leaf: its typed delegate is looked up now.
  const delegate =
    exact.factoryRef === null
      ? null
      : data.references.lookupAgentFactory(exact.factoryRef)
  if (delegate == null) {
    return unavailable(view, "catalog_invalid", exact)
  }
  return selectedResolution({
    data,
    runtime,
    route: exact,
    entry,
    executionProfile: exact.executionProfile,
    delegate: delegate as RuntimeRouteDelegate,
    policy: permissionPolicy,
  })
}

/**
 * Resolves one route query against the validated catalog (the production
 * singleton unless a test passes its own state). Pure: reads the table and
 * reference ports only; returns an `ok` discriminated Result.
 */
export function resolveRuntimeRoute(
  query: RouteQuery,
  catalog?: RuntimeRouteCatalogState,
): RuntimeRouteResolution {
  const data = dataOf(catalog)
  if (!data) return unavailable(queryView(query, null), "catalog_invalid")
  const record: Record<string, unknown> = isRecord(query) ? query : {}
  const normalized = data.references.normalizeRuntimeId(record.runtimeId)
  const runtime =
    typeof normalized === "string"
      ? (data.runtimes.find((item) => item.runtimeId === normalized) ?? null)
      : null
  const view = queryView(query, runtime?.runtimeId ?? null)
  const entry = record.entry
  const requiredExtensions = Array.isArray(record.requiredExtensions)
    ? record.requiredExtensions.filter(
        (item): item is string => typeof item === "string",
      )
    : null
  if (
    !runtime ||
    typeof entry !== "string" ||
    !RUNTIME_ROUTE_ENTRIES.includes(entry as RuntimeRouteEntry) ||
    requiredExtensions === null
  ) {
    return unavailable(view, "route_not_found")
  }
  const shared = {
    data,
    runtime,
    query: record,
    view,
    entry: entry as RuntimeRouteEntry,
    requiredExtensions,
  }
  if (record.kind === "completion") return resolveCompletion(shared)
  if (record.kind === "agent") return resolveAgent(shared)
  return unavailable(view, "route_not_found")
}

// ---------------------------------------------------------------------------
// Enumeration and projections (design D3)
// ---------------------------------------------------------------------------

/**
 * Every route descriptor in stable routeId (code-point) order, function
 * free. Throws the sanitized message for a failure state.
 */
export function listRuntimeRoutes(
  filter: RuntimeRouteListFilter = {},
  catalog?: RuntimeRouteCatalogState,
): readonly RuntimeRouteDescriptor[] {
  const data = requireData(catalog)
  const runtimes = new Map(
    data.runtimes.map((runtime) => [runtime.runtimeId, runtime]),
  )
  const descriptors = data.routes
    .filter(
      (route) =>
        (filter.runtimeId === undefined ||
          route.runtimeId === filter.runtimeId) &&
        (filter.entry === undefined || route.entries.includes(filter.entry)) &&
        (filter.kind === undefined || route.kind === filter.kind),
    )
    .map((route) => {
      const runtime = runtimes.get(route.runtimeId) as InternalRuntime
      return {
        routeId: route.routeId,
        runtimeId: route.runtimeId,
        runtimeLabel: runtime.runtimeLabel,
        manifestRef: runtime.manifestRef,
        cancellation: runtime.cancellation,
        sessionReference: runtime.sessionReference,
        entries: route.entries,
        kind: route.kind,
        modes: route.modes,
        executionProfile: route.executionProfile,
        executionSurface: route.executionSurface,
        adapterSource: route.adapterSource,
        adapterLabel: route.adapterLabel,
        transport: route.transport,
        transportId: route.transportId,
        enforcementEvidence: route.enforcementEvidence,
        extensions: route.extensions,
      }
    })
  return deepFreeze(descriptors)
}

function publicSummary(route: InternalRoute): LocalJobApiRuntimeRouteSummary {
  return {
    routeId: route.routeId,
    surface: "api",
    kind: route.kind,
    executionProfile:
      route.executionProfile === "batch" ||
      route.executionProfile === "policy-grant"
        ? route.executionProfile
        : null,
    adapterSource: route.adapterSource,
    transport: route.transport,
    extensions: route.extensions.map((extension) => ({
      namespace: extension.namespace,
      schemaVersion: extension.schemaVersion,
      maturity: extension.maturity,
      schemaRef: extension.schemaRef,
    })),
  }
}

function isPublicApiRoute(route: InternalRoute): boolean {
  if (!route.entries.includes("api")) return false
  return (
    route.kind === "completion" ||
    route.executionProfile === "batch" ||
    route.executionProfile === "policy-grant"
  )
}

/**
 * Read-only projections. `public`: per runtime, the experimental surface=api
 * summaries with exact keys (protocol omitted). `renderer`: exactly
 * `{routeId, runtimeId, transportId}` per desktop route. Both throw the
 * sanitized message for a failure state.
 */
export function projectRuntimeRoutes(
  audience: "public",
  catalog?: RuntimeRouteCatalogState,
): readonly PublicRuntimeRouteProjection[]
export function projectRuntimeRoutes(
  audience: "renderer",
  catalog?: RuntimeRouteCatalogState,
): readonly RendererRuntimeRouteProjection[]
export function projectRuntimeRoutes(
  audience: "public" | "renderer",
  catalog?: RuntimeRouteCatalogState,
):
  | readonly PublicRuntimeRouteProjection[]
  | readonly RendererRuntimeRouteProjection[] {
  const data = requireData(catalog)
  if (audience === "renderer") {
    return deepFreeze(
      data.routes
        .filter(
          (route): route is InternalRoute & { transportId: string } =>
            route.entries.includes("desktop") && route.transportId !== null,
        )
        .map((route) => ({
          routeId: route.routeId,
          runtimeId: route.runtimeId,
          transportId: route.transportId,
        })),
    )
  }
  return deepFreeze(
    data.runtimes.map((runtime) => ({
      runtimeId: runtime.runtimeId,
      routes: runtime.routes.filter(isPublicApiRoute).map(publicSummary),
    })),
  )
}

/**
 * The capability manifest of every catalog runtime (stable runtimeId order),
 * read through the catalog's manifest reference port (the shared capability
 * owner in production) and returned as deep-frozen copies, so a caller
 * cannot change capability truth. Throws the sanitized message for a
 * failure state.
 */
export function listRuntimeRouteManifests(
  catalog?: RuntimeRouteCatalogState,
): readonly AgentRuntimeCapabilityManifest[] {
  const data = requireData(catalog)
  return deepFreeze(
    data.runtimes.map((runtime) => {
      const manifest = data.references.getManifest(runtime.manifestRef)
      if (!isRecord(manifest) || manifest.runtimeId !== runtime.runtimeId) {
        throw new Error(RUNTIME_ROUTE_CATALOG_UNAVAILABLE_MESSAGE)
      }
      return structuredClone(manifest)
    }),
  )
}

// ---------------------------------------------------------------------------
// Readiness (observation only; never admission)
// ---------------------------------------------------------------------------

function isReadiness(value: unknown): value is LocalJobApiRuntimeReadiness {
  return (
    isRecord(value) &&
    (value.state === "ready" ||
      value.state === "needs-auth" ||
      value.state === "unavailable" ||
      value.state === "unknown")
  )
}

/**
 * Runs the existing readiness probe a resolved route references. A refused
 * or missing route, a route without a probe and an invalid observation are
 * `unknown`, never ready. The probe owner keeps its cache and fallbacks.
 */
export async function probeRuntimeRouteReadiness(
  resolution: RuntimeRouteResolution,
  context: RuntimeRouteReadinessContext = {},
): Promise<LocalJobApiRuntimeReadiness> {
  if (
    !isRecord(resolution) ||
    resolution.ok !== true ||
    typeof resolution.readinessProbe !== "function"
  ) {
    return unknownRuntimeReadiness()
  }
  try {
    const observed = await resolution.readinessProbe(context)
    return isReadiness(observed) ? observed : unknownRuntimeReadiness()
  } catch {
    return unknownRuntimeReadiness()
  }
}
