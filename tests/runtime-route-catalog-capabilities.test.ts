/**
 * refactor-unified-runtime-route-catalog — capabilities / readiness /
 * extensions red suite (S10, S11, S12, S13, S34-S39, S47, S51, S52).
 *
 * Independent red-test author, written from the approved delta specs and
 * design only (approved spec a9b74594, base 19986552). Every test reaches the
 * NEW owner `src/main/lib/agent-runtime/runtime-route-catalog.ts` lazily, so on
 * the base each test is individually RED with "Cannot find module" while the
 * file still loads; the rest of each test pins the real owners the catalog
 * must reference (shared manifests, readiness probes/cache, projection owner,
 * ledger extension producer, Claude/Codex enforcing ports).
 */
import { afterEach, describe, expect, test } from "bun:test"
import {
  buildGuardedRunAudit,
  buildGuardedRunPromptBlock,
} from "../src/main/lib/agent-guard"
import { createAgentRuntimeRunRequest } from "../src/main/lib/headless/agent-runtime-contract"
import {
  type LocalJobApiRuntimeManifestEnvelopeOptions,
  toLocalJobApiRuntimeManifestEnvelope,
} from "../src/main/lib/headless/local-job-api"
import * as readinessOwner from "../src/main/lib/headless/runtime-readiness"
import {
  createRuntimeCapabilityProjectionService,
  type RuntimeCapabilityProjectionAdapter,
  type RuntimeCapabilityProjectionRecord,
} from "../src/main/lib/runtime-capability-projection"
import { agentRuntimeRouter } from "../src/main/lib/trpc/routers/agent-runtime"
import {
  type AgentRuntimeCapabilityId,
  type AgentRuntimeCapabilityManifest,
  checkAgentRuntimeCapability,
  getAgentRunRequiredCapabilityIds,
  getAgentRuntimeCapability,
  getAgentRuntimeCapabilityManifest,
  getAgentRuntimeCapabilityManifests,
  toAgentRuntimeId,
} from "../src/shared/agent-runtime-capabilities"
import { readDiscoveryBefore } from "./fixtures/runtime-route-catalog/discovery-reader-before"
import {
  applyStep,
  createLedger,
  MemoryDurableStore,
} from "./run-event-ledger-domain-b-kit"
import {
  type CapabilityOverride,
  type ConformanceExpectation,
  type ConformanceObservation,
  type ConformanceOperation,
  type ConformancePolicy,
  capabilityReferencePorts,
  closeTempDbs,
  completionQuery,
  createTempDb,
  deepKeys,
  desktopQuery,
  fixtureGuardedContract,
  loadFixture,
  loadRouteCatalogModule,
  manifestPortWithOverrides,
  nonDesktopQuery,
  PUBLIC_EXTENSION_KEYS,
  PUBLIC_ROUTE_KEYS,
  type PublicRouteSummary,
  RENDERER_ROUTE_KEYS,
  type ReadinessCaseInput,
  type RouteCatalogModule,
  type RouteCatalogTestPorts,
  type RouteResolution,
  type RuntimeRouteDeclarationForTests,
  readinessDependencies,
  runEnforcingOperation,
  runHeadlessCli,
  sortedKeys,
  supportedCapabilityConformanceFailures,
} from "./runtime-route-catalog-capabilities-kit"

// ---------------------------------------------------------------------------
// Fixture types
// ---------------------------------------------------------------------------

type QuerySpec = {
  runtimeId: string
  entry: "headless" | "api" | "protocol"
  executionProfile: "batch" | "policy-grant" | "interactive"
  mode?: "plan" | "agent"
  requiredCapabilities?: AgentRuntimeCapabilityId[]
  grantedScopes?: string[]
}

type BaselineRefusal = {
  reason: string
  errorCode: string
  errorMessage: string
  exitCode: number
  candidateAdapterSource: string
  candidateAdapterLabel?: string
  diagnosticReason?: string
  capability?: Record<string, unknown> | null
}

type ConformanceEntry = {
  runtimeId: "claude-code" | "codex"
  capabilityId: AgentRuntimeCapabilityId
  policy: ConformancePolicy
  operation: ConformanceOperation
  expected: ConformanceExpectation
}

type CapabilitiesFixture = {
  S10: {
    manifestOverrides: CapabilityOverride[]
    unmetQuery: QuerySpec
    expectedRefusal: {
      reason: string
      errorCode: string
      exitCode: number
      candidateAdapterSource: string
      errorMessage: string
      capability: Record<string, unknown>
    }
    metQuery: QuerySpec
    expectedMetManifestRuntimeId: string
    envelopeExpected: {
      runtimeId: string
      capabilityId: AgentRuntimeCapabilityId
      status: string
      reason: string
    }
    canonicalAfter: {
      runtimeId: "codex"
      capabilityId: AgentRuntimeCapabilityId
      status: string
    }
    desktopSupportedHeadlessLimited: {
      desktopRuntimeId: "claude-code"
      capabilityId: AgentRuntimeCapabilityId
      desktopManifestStatus: string
      query: QuerySpec
      expected: BaselineRefusal
      desktopQuery: {
        runtimeId: "claude-code"
        requiredCapabilities: AgentRuntimeCapabilityId[]
      }
      desktopExpectedEnforcement: string
    }
  }
  S12: {
    runtimeId: "codex"
    classCapability: AgentRuntimeCapabilityId
    classCapabilityStatus: string
    query: {
      runtimeId: "codex"
      requiredCapabilities: AgentRuntimeCapabilityId[]
    }
    registeredKind: string
    projectionRecord: RuntimeCapabilityProjectionRecord
    unregisteredKind: string
    forbiddenRouteKeyPattern: string
    forbiddenRouteValues: string[]
    expectedRoute: Record<string, unknown>
  }
  S34: {
    runtimeId: "codex"
    basicQuery: QuerySpec
    expectedBasic: {
      adapterSource: string
      executionSurface: string
      manifestRuntimeId: string
      enforcementEvidence: string
    }
    optional: {
      capabilityId: AgentRuntimeCapabilityId
      status: string
      errorMessage: string
    }[]
    basicRequestInput: {
      jobId: string
      runtime: "codex"
      cwd: string
      mode: "agent"
      source: "cli"
      prompt: string
    }
    basicRequestKeys: string[]
    basicRequestedCapabilities: string[]
    forbiddenOptionalFields: string[]
  }
  S35: {
    rendererRoutes: { runtimeId: string; transportId: string }[]
    states: Record<string, Record<string, { status: string; reason?: string }>>
    explicitStatuses: string[]
    secretPatterns: string[]
    cliArgv: string[]
  }
  S36: {
    desktopRoutes: {
      runtimeId: "claude-code" | "codex"
      adapterSource: string
      executionSurface: string
      enforcementEvidence: string
    }[]
    enforcementCapabilities: AgentRuntimeCapabilityId[]
    conformance: ConformanceEntry[]
    mismatchVariant: {
      runtimeId: "claude-code" | "codex"
      capabilityId: AgentRuntimeCapabilityId
      declaredResponse: unknown
      expectedFailures: string[]
    }
  }
  S37: {
    capabilityId: AgentRuntimeCapabilityId
    decisions: (ConformanceEntry & {
      caseId: string
      decision: "allow" | "deny" | "rewrite"
      expected: ConformanceExpectation & { emittedChunkTypes: string[] }
    })[]
  }
  S38: {
    headlessEvidence: (QuerySpec & {
      adapterSource: string
      enforcementEvidence: string
    })[]
    guardedHeadlessRefusals: (BaselineRefusal & { query: QuerySpec })[]
    variants: {
      variantId: string
      override: CapabilityOverride
      expectedMessage: string
    }[]
  }
  S39: {
    runtimeId: "codex"
    capabilityId: AgentRuntimeCapabilityId
    claudeStatus: string
    codex: {
      status: string
      scope: string
      reason: string
      hint: string
      message: string
    }
    queries: ({
      surface: "desktop" | "headless" | "api"
      runtimeId: "codex"
      candidateAdapterSource: string
    } & Partial<QuerySpec>)[]
    cliArgv: string[]
  }
  S47: {
    cases: {
      caseId: string
      query: QuerySpec
      explicit: AgentRuntimeCapabilityId[]
      implicitInput: { mode: "plan" | "agent" }
      expected: BaselineRefusal
    }[]
    supportedControl: {
      query: QuerySpec
      explicit: AgentRuntimeCapabilityId[]
      implicitInput: { mode: "plan" | "agent" }
      expectedAdapterSource: string
    }
  }
  S51: {
    runtimeId: "codex"
    states: Record<string, { status: string; reason?: string }>
    messages: Record<string, string>
    headlessQuery: QuerySpec
    headlessPolicyGated: Record<string, BaselineRefusal>
    cliArgv: string[]
  }
  S52: {
    runtimeId: "codex"
    adapterSource: string
    capabilities: {
      capabilityId: AgentRuntimeCapabilityId
      policy: ConformancePolicy
      operation: ConformanceOperation
      expected: ConformanceExpectation
    }[]
    nonEnforcingVariants: string[]
    expectedVariantFailures: string[]
    auditSnapshots: {
      preRunStatus: {
        dirty: boolean
        files: string[]
        capturedAt: string
        available: boolean
      }
      postRunStatus: {
        dirty: boolean
        files: string[]
        capturedAt: string
        available: boolean
      }
      startedAt: string
      finishedAt: string
    }
  }
}

type ReadinessFixture = {
  S11: {
    cases: {
      caseId: string
      route: QuerySpec
      dependencies: ReadinessCaseInput
      context: { probe?: boolean }
      expected: {
        readiness: Record<string, unknown>
        calls: Record<string, number>
        diagnostics: string[]
      }
    }[]
    cache: {
      route: QuerySpec
      secondRoute: QuerySpec
      dependencies: ReadinessCaseInput
      steps: {
        now: number
        route: "route" | "secondRoute"
        codexLoginStatus: string
        expectedState: string
        expectedStatusCalls: number
      }[]
      expectedReadiness: Record<string, Record<string, unknown>>
    }
    missingRoute: QuerySpec & {
      dependencies: ReadinessCaseInput
      expectedState: string
    }
    completionNullProbe: {
      routes: { runtimeId: string; entry: "api" | "completion" }[]
      dependencies: ReadinessCaseInput
      expectedState: string
    }
    advisoryNotAdmission: {
      route: QuerySpec
      dependencies: ReadinessCaseInput
      expectedReadinessState: string
      noProbeExpectedState: string
      expectedAdapterSource: string
    }
  }
}

type ExtensionsFixture = {
  S13: {
    codexExtension: Record<string, unknown>
    declarations: RuntimeRouteDeclarationForTests[]
    ports: RouteCatalogTestPorts
    malformedVariants: { caseId: string; field: string; value: unknown }[]
    queries: { policyGrant: QuerySpec; batch: QuerySpec }
    unknownRequiredExtension: string
    optionalUnknownExtension: Record<string, unknown>
    expectedUnknownRequiredReason: string
    publicExpectations: {
      policyGrantExtensions: Record<string, unknown>[]
      batchExtensions: Record<string, unknown>[]
      completionExtensions: Record<string, unknown>[]
    }
    producer: {
      runId: string
      provenance: Record<string, unknown>
      steps: Record<string, unknown>[]
      expectedExtensionNamespaces: string[]
      expectedExtensionHeader: Record<string, unknown>
    }
  }
}

const capabilities = loadFixture<CapabilitiesFixture>("capabilities.json")
const readinessFixture = loadFixture<ReadinessFixture>("readiness.json")
const extensionsFixture = loadFixture<ExtensionsFixture>("extensions.json")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearReadinessCache(): void {
  const clear = (readinessOwner as Record<string, unknown>)
    .clearRuntimeReadinessCacheForTest
  if (typeof clear === "function") clear()
}

afterEach(() => {
  closeTempDbs()
  clearReadinessCache()
})

/**
 * Gate on the design-D1 owner. On the base this is the RED point:
 * "Cannot find module .../runtime-route-catalog.ts".
 */
async function requireCatalog(): Promise<RouteCatalogModule> {
  const loaded = await loadRouteCatalogModule()
  expect(loaded.ok ? "runtime-route-catalog loaded" : loaded.reason).toBe(
    "runtime-route-catalog loaded",
  )
  if (!loaded.ok) throw new Error(loaded.reason)
  return loaded.module
}

function query(spec: QuerySpec) {
  return nonDesktopQuery({
    runtimeId: spec.runtimeId,
    entry: spec.entry,
    executionProfile: spec.executionProfile,
    mode: spec.mode,
    requiredCapabilities: spec.requiredCapabilities,
    grantedScopes: spec.grantedScopes,
  })
}

/** Observable projection of a failed resolution (no functions). */
function refusalView(resolution: RouteResolution) {
  if (resolution.ok) {
    return { ok: true, routeId: resolution.routeId }
  }
  return {
    ok: false,
    reason: resolution.reason,
    candidateAdapterSource: resolution.candidateAdapterSource,
    errorCode: resolution.result?.errorCode ?? null,
    errorMessage: resolution.result?.errorMessage ?? null,
    exitCode: resolution.result?.exitCode ?? null,
    hasDelegate: "delegate" in resolution,
  }
}

function okView(resolution: RouteResolution) {
  if (!resolution.ok) {
    return { ok: false, reason: resolution.reason }
  }
  return {
    ok: true,
    adapterSource: resolution.adapterSource,
    executionSurface: resolution.executionSurface,
    manifestRuntimeId: resolution.manifestRef?.runtimeId ?? null,
    enforcementEvidence: resolution.enforcementEvidence,
    delegateType: typeof resolution.delegate,
    fallbackReason: resolution.diagnostic?.fallbackReason,
  }
}

function capabilityOf(
  manifest: { capabilities: { id: string }[] } | undefined,
  capabilityId: string,
): Record<string, unknown> | null {
  const found = manifest?.capabilities.find((item) => item.id === capabilityId)
  return found ? (found as Record<string, unknown>) : null
}

function publicSummaries(
  projection: ReturnType<RouteCatalogModule["projectRuntimeRoutes"]>,
): { runtimeId: string; route: PublicRouteSummary }[] {
  const out: { runtimeId: string; route: PublicRouteSummary }[] = []
  for (const runtime of projection as readonly {
    runtimeId: string
    routes: readonly PublicRouteSummary[]
  }[]) {
    for (const route of runtime.routes)
      out.push({ runtimeId: runtime.runtimeId, route })
  }
  return out
}

async function manifestEnvelope(
  catalogState: unknown,
  options: { probe?: boolean } = {},
) {
  const db = createTempDb()
  const readiness = readinessDependencies({
    defaultProvider: { state: "not-configured" },
    codexLoginStatus: "ready",
  })
  const envelopeOptions = {
    db: db.db,
    probe: options.probe ?? false,
    readinessDependencies: readiness.dependencies,
    // Enforces once the LocalJobApiRuntimeManifestEnvelopeOptions
    // runtimeRouteCatalog test option (design D1) exists.
    runtimeRouteCatalog: catalogState,
  } as LocalJobApiRuntimeManifestEnvelopeOptions & {
    runtimeRouteCatalog: unknown
  }
  return await toLocalJobApiRuntimeManifestEnvelope(envelopeOptions)
}

function envelopeCapability(
  envelope: Awaited<ReturnType<typeof toLocalJobApiRuntimeManifestEnvelope>>,
  runtimeId: string,
  capabilityId: string,
): Record<string, unknown> | null {
  const runtime = envelope.runtimes.find((item) => item.runtimeId === runtimeId)
  return capabilityOf(runtime, capabilityId)
}

// ---------------------------------------------------------------------------
// agent-runtime-capabilities / Route Capability And Readiness References
// ---------------------------------------------------------------------------

describe("agent-runtime-capabilities / Route Capability And Readiness References", () => {
  test("S10 Capability truth is referenced rather than copied — resolver and discovery envelope read one injected manifest port, mutation never changes truth, and desktop support never lifts a headless enforcement limit", async () => {
    const f = capabilities.S10
    const catalog = await requireCatalog()
    const port = manifestPortWithOverrides(f.manifestOverrides)
    // Enforces once validateRuntimeRouteCatalog(undefined, partialReferences)
    // merges the capability-owner getManifest port over the production
    // references (catalog.json#S01 core shape, adjudication P1-1).
    const validation = catalog.validateRuntimeRouteCatalog(undefined, {
      getManifest: port.getManifest,
    })
    const state = validation.ok ? validation.catalog : undefined

    const unmet = catalog.resolveRuntimeRoute(query(f.unmetQuery), state)
    const met = catalog.resolveRuntimeRoute(query(f.metQuery), state)
    const envelope = await manifestEnvelope(state)
    const envelopeCodex = envelope.runtimes.find(
      (runtime) => runtime.runtimeId === "codex",
    )
    const injectedManifest = port.port("codex")

    // Mutating every returned projection must not change manifest truth.
    const envelopeAttachment = envelopeCapability(
      envelope,
      f.envelopeExpected.runtimeId,
      f.envelopeExpected.capabilityId,
    )
    // Reflect.set never throws on a deep-frozen descriptor; it just refuses.
    if (envelopeAttachment)
      Reflect.set(envelopeAttachment, "status", "supported")
    if (met.ok && met.manifestRef && typeof met.manifestRef === "object") {
      Reflect.set(met.manifestRef, "runtimeId", "mutated-runtime")
      const refCapabilities = Reflect.get(met.manifestRef, "capabilities")
      if (Array.isArray(refCapabilities))
        Reflect.set(refCapabilities, "length", 0)
    }
    const unmetAfterMutation = catalog.resolveRuntimeRoute(
      query(f.unmetQuery),
      state,
    )
    const canonicalAfter = getAgentRuntimeCapability(
      f.canonicalAfter.runtimeId,
      f.canonicalAfter.capabilityId,
    ).status

    const limited = f.desktopSupportedHeadlessLimited
    const headlessLimited = catalog.resolveRuntimeRoute(
      query(limited.query),
      state,
    )
    const desktopSupported = catalog.resolveRuntimeRoute(
      desktopQuery(limited.desktopQuery),
      state,
    )

    expect(validation.ok).toBe(true)
    expect(refusalView(unmet)).toEqual({
      ok: false,
      reason: f.expectedRefusal.reason,
      candidateAdapterSource: f.expectedRefusal.candidateAdapterSource,
      errorCode: f.expectedRefusal.errorCode,
      errorMessage: f.expectedRefusal.errorMessage,
      exitCode: f.expectedRefusal.exitCode,
      hasDelegate: false,
    })
    expect(unmet.ok ? null : unmet.diagnostic?.capability).toMatchObject(
      f.expectedRefusal.capability,
    )
    expect(met.ok).toBe(true)
    expect(port.calls.length).toBeGreaterThan(0)
    // Discovery reports the same port-supplied states/reasons: no own table.
    expect(envelopeCodex?.capabilities).toEqual(injectedManifest.capabilities)
    expect(envelope.runtimes.map((runtime) => runtime.runtimeId)).toEqual([
      "claude-code",
      "codex",
    ])
    expect(refusalView(unmetAfterMutation)).toEqual(refusalView(unmet))
    expect(canonicalAfter).toBe(f.canonicalAfter.status)
    expect(port.port("codex").capabilities).toEqual(
      injectedManifest.capabilities,
    )
    expect(
      getAgentRuntimeCapability(limited.desktopRuntimeId, limited.capabilityId)
        .status,
    ).toBe(limited.desktopManifestStatus)
    expect(refusalView(headlessLimited)).toEqual({
      ok: false,
      reason: limited.expected.reason,
      candidateAdapterSource: limited.expected.candidateAdapterSource,
      errorCode: limited.expected.errorCode,
      errorMessage: limited.expected.errorMessage,
      exitCode: limited.expected.exitCode,
      hasDelegate: false,
    })
    expect(
      desktopSupported.ok ? desktopSupported.enforcementEvidence : null,
    ).toBe(limited.desktopExpectedEnforcement)
  })

  test("S11 Readiness selects the existing probe without becoming admission — default/native order, 30000 ms shared cache, no-probe/exception/missing-route/null-probe unknown, advisory never gates resolution", async () => {
    const f = readinessFixture.S11
    const catalog = await requireCatalog()

    const caseResults: unknown[] = []
    for (const item of f.cases) {
      clearReadinessCache()
      const recorder = readinessDependencies(item.dependencies)
      const diagnostics: string[] = []
      const route = catalog.resolveRuntimeRoute(query(item.route))
      const readiness = await catalog.probeRuntimeRouteReadiness(route, {
        ...(item.context.probe === undefined
          ? {}
          : { probe: item.context.probe }),
        dependencies: recorder.dependencies,
        onDiagnostic: (message) => diagnostics.push(message),
      })
      caseResults.push({
        caseId: item.caseId,
        routeOk: route.ok,
        readiness,
        calls: { ...recorder.calls },
        diagnostics,
      })
    }

    // Cache: one 30000 ms cache shared by every Codex route (no second cache).
    clearReadinessCache()
    const cacheRecorder = readinessDependencies(f.cache.dependencies, 0)
    const cacheResults: unknown[] = []
    for (const step of f.cache.steps) {
      cacheRecorder.setNow(step.now)
      cacheRecorder.setCodexLoginStatus(step.codexLoginStatus)
      const route = catalog.resolveRuntimeRoute(query(f.cache[step.route]))
      const readiness = await catalog.probeRuntimeRouteReadiness(route, {
        dependencies: cacheRecorder.dependencies,
      })
      cacheResults.push({
        now: step.now,
        readiness,
        statusCalls: cacheRecorder.calls.getCodexRuntimeStatus ?? 0,
      })
    }

    // Missing route and completion null probe: unknown, never ready, no probe.
    const missingRecorder = readinessDependencies(f.missingRoute.dependencies)
    const missing = catalog.resolveRuntimeRoute(query(f.missingRoute))
    const missingReadiness = await catalog.probeRuntimeRouteReadiness(missing, {
      dependencies: missingRecorder.dependencies,
    })
    const completionRecorder = readinessDependencies(
      f.completionNullProbe.dependencies,
    )
    const completionResults: unknown[] = []
    for (const spec of f.completionNullProbe.routes) {
      const route = catalog.resolveRuntimeRoute(completionQuery(spec))
      const readiness = await catalog.probeRuntimeRouteReadiness(route, {
        dependencies: completionRecorder.dependencies,
      })
      completionResults.push({
        routeOk: route.ok,
        readinessProbe: route.ok ? route.readinessProbe : "route-missing",
        state: readiness.state,
      })
    }

    // Advisory readiness never becomes admission.
    clearReadinessCache()
    const advisory = f.advisoryNotAdmission
    const advisoryRecorder = readinessDependencies(
      advisory.dependencies,
      9_000_000,
    )
    const beforeRoute = catalog.resolveRuntimeRoute(query(advisory.route))
    const advisoryReadiness = await catalog.probeRuntimeRouteReadiness(
      beforeRoute,
      {
        dependencies: advisoryRecorder.dependencies,
      },
    )
    const statusCallsAfterProbe =
      advisoryRecorder.calls.getCodexRuntimeStatus ?? 0
    const afterRoute = catalog.resolveRuntimeRoute(query(advisory.route))
    const noProbeReadiness = await catalog.probeRuntimeRouteReadiness(
      afterRoute,
      {
        probe: false,
        dependencies: advisoryRecorder.dependencies,
      },
    )

    expect(caseResults).toEqual(
      f.cases.map((item) => ({
        caseId: item.caseId,
        routeOk: true,
        readiness: item.expected.readiness,
        calls: item.expected.calls,
        diagnostics: item.expected.diagnostics,
      })),
    )
    expect(cacheResults).toEqual(
      f.cache.steps.map((step) => ({
        now: step.now,
        readiness: f.cache.expectedReadiness[step.expectedState],
        statusCalls: step.expectedStatusCalls,
      })),
    )
    expect(missing.ok).toBe(false)
    expect(missingReadiness.state).toBe(f.missingRoute.expectedState)
    expect(missingRecorder.nativeCallCount()).toBe(0)
    expect(missingRecorder.calls.inspectDefaultProviderBinding ?? 0).toBe(0)
    expect(completionResults).toEqual(
      f.completionNullProbe.routes.map(() => ({
        routeOk: true,
        readinessProbe: null,
        state: f.completionNullProbe.expectedState,
      })),
    )
    expect(completionRecorder.nativeCallCount()).toBe(0)
    expect(advisoryReadiness.state).toBe(advisory.expectedReadinessState)
    expect(noProbeReadiness.state).toBe(advisory.noProbeExpectedState)
    expect(okView(beforeRoute)).toEqual(okView(afterRoute))
    expect(afterRoute.ok ? afterRoute.adapterSource : null).toBe(
      advisory.expectedAdapterSource,
    )
    // Resolution itself never runs the probe.
    expect(advisoryRecorder.calls.getCodexRuntimeStatus ?? 0).toBe(
      statusCallsAfterProbe,
    )
  })

  test("S12 Concrete projection availability is not guessed from the route — the registered projection owner reports unavailable, an unregistered kind stays registered=false/records=[], and route outputs carry no install/usability label", async () => {
    const f = capabilities.S12
    const catalog = await requireCatalog()
    const projectCalls: string[] = []
    const adapter: RuntimeCapabilityProjectionAdapter = {
      kind: f.registeredKind,
      runtimeId: "codex",
      async project() {
        projectCalls.push(f.registeredKind)
        return [structuredClone(f.projectionRecord)]
      },
    }
    const service = createRuntimeCapabilityProjectionService([adapter])

    const route = catalog.resolveRuntimeRoute(desktopQuery(f.query))
    const publicProjection = catalog.projectRuntimeRoutes("public")
    const rendererProjection = catalog.projectRuntimeRoutes("renderer")
    const callsBeforeOwner = projectCalls.length
    const registered = await service.project({
      kind: f.registeredKind,
      runtimeId: "codex",
      payload: {},
      now: new Date("2026-10-02T00:00:00.000Z"),
    })
    const unregistered = await service.project({
      kind: f.unregisteredKind,
      runtimeId: "codex",
      payload: {},
      now: new Date("2026-10-02T00:00:00.000Z"),
    })

    const forbiddenKey = new RegExp(f.forbiddenRouteKeyPattern, "i")
    const routeOutputs = [
      route.ok
        ? {
            ...route,
            delegate: typeof route.delegate,
            readinessProbe: typeof route.readinessProbe,
          }
        : route,
      publicProjection,
      rendererProjection,
    ]
    const leakedKeys = deepKeys(routeOutputs).filter((key) =>
      forbiddenKey.test(key),
    )
    const serialized = JSON.stringify(routeOutputs)
    const leakedValues = f.forbiddenRouteValues.filter((value) =>
      serialized.includes(`"${value}"`),
    )

    expect(
      getAgentRuntimeCapability(f.runtimeId, f.classCapability).status,
    ).toBe(f.classCapabilityStatus)
    expect(okView(route)).toEqual(f.expectedRoute)
    expect(callsBeforeOwner).toBe(0)
    expect(projectCalls).toEqual([f.registeredKind])
    expect(registered).toEqual({
      registered: true,
      kind: f.registeredKind,
      runtimeId: "codex",
      records: [f.projectionRecord],
    })
    expect(unregistered).toEqual({
      registered: false,
      kind: f.unregisteredKind,
      runtimeId: "codex",
      records: [],
    })
    expect(leakedKeys).toEqual([])
    expect(leakedValues).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// agent-runtime-capabilities / Route Runtime Extension Declarations
// ---------------------------------------------------------------------------

describe("agent-runtime-capabilities / Route Runtime Extension Declarations", () => {
  test("S13 Optional and required extensions are distinguished — runtime.codex.v1 keeps schemaVersion 1/experimental, malformed declarations are catalog_invalid, an unknown required internal extension fails before any factory call, and declared extensions equal the actual ledger producer", async () => {
    const f = extensionsFixture.S13
    const catalog = await requireCatalog()
    // catalog.json#S01 core-shape reference ports (adjudication P1-1):
    // lookups are recorded apart from delegate invocations (tasks 2.2).
    const ports = capabilityReferencePorts(f.ports)
    const references = ports.references
    const factoryCalls = ports.log.invocations

    const valid = catalog.validateRuntimeRouteCatalog(
      f.declarations,
      references,
    )
    const malformed = f.malformedVariants.map((variant) => {
      const table = structuredClone(f.declarations)
      const extension = table[0].routes[1].extensions[0] as unknown as Record<
        string,
        unknown
      >
      if (variant.value === null)
        Reflect.deleteProperty(extension, variant.field)
      else Reflect.set(extension, variant.field, variant.value)
      const result = catalog.validateRuntimeRouteCatalog(table, references)
      return {
        caseId: variant.caseId,
        ok: result.ok,
        reason: result.ok ? null : result.reason,
      }
    })
    const state = valid.ok ? valid.catalog : undefined

    const unknownRequired = catalog.resolveRuntimeRoute(
      {
        ...query(f.queries.policyGrant),
        requiredExtensions: [f.unknownRequiredExtension],
      },
      state,
    )
    const codexRequired = catalog.resolveRuntimeRoute(
      {
        ...query(f.queries.policyGrant),
        requiredExtensions: ["runtime.codex.v1"],
      },
      state,
    )
    const batchRequired = catalog.resolveRuntimeRoute(
      {
        ...query(f.queries.batch),
        requiredExtensions: ["runtime.codex.v1"],
      },
      state,
    )
    const testPublic = publicSummaries(
      catalog.projectRuntimeRoutes("public", state),
    )
    const productionPublic = publicSummaries(
      catalog.projectRuntimeRoutes("public"),
    )

    // The actual ledger producer for a Codex app-server runtime-backed Run.
    const store = new MemoryDurableStore({ runId: f.producer.runId })
    const ledger = await createLedger({
      runId: f.producer.runId,
      runtimeId: "codex",
      provenance: f.producer.provenance,
      store,
    })
    for (const step of f.producer.steps) await applyStep(ledger, step)
    const producedExtensions = (store.records as { payload?: unknown }[])
      .map((record) =>
        record.payload && typeof record.payload === "object"
          ? (
              record.payload as {
                extensions?: Record<string, Record<string, unknown>>
              }
            ).extensions
          : undefined,
      )
      .filter((extensions) => extensions !== undefined)
    const producedNamespaces = [
      ...new Set(
        producedExtensions.flatMap((extensions) =>
          Object.keys(extensions ?? {}),
        ),
      ),
    ].sort()
    const producedHeaders = producedExtensions.map((extensions) => ({
      schemaVersion: extensions?.["runtime.codex.v1"]?.schemaVersion,
      maturity: extensions?.["runtime.codex.v1"]?.maturity,
    }))
    const productionPolicyGrantNamespaces = productionPublic
      .filter(
        (item) =>
          item.runtimeId === "codex" &&
          item.route.executionProfile === "policy-grant",
      )
      .flatMap((item) =>
        item.route.extensions.map((extension) => extension.namespace),
      )

    // The fixture-only common-core reader must ignore an unknown optional
    // extension namespace on a discovery response that carries routes.
    const envelope = await manifestEnvelope(undefined)
    const routesByRuntime = new Map(
      (
        catalog.projectRuntimeRoutes("public") as readonly {
          runtimeId: string
          routes: readonly PublicRouteSummary[]
        }[]
      ).map((runtime) => [runtime.runtimeId, runtime.routes]),
    )
    const withRoutes = {
      ...envelope,
      runtimes: envelope.runtimes.map((runtime) => ({
        ...runtime,
        routes: structuredClone(routesByRuntime.get(runtime.runtimeId) ?? []),
      })),
    }
    const withUnknownOptional = structuredClone(withRoutes)
    for (const runtime of withUnknownOptional.runtimes) {
      for (const route of runtime.routes) {
        ;(route.extensions as Record<string, unknown>[]).push({
          ...f.optionalUnknownExtension,
        })
      }
    }
    const readerBaseline = readDiscoveryBefore(withRoutes)
    const readerWithUnknown = readDiscoveryBefore(withUnknownOptional)
    const unknownOptionalRoutes = withUnknownOptional.runtimes.flatMap(
      (runtime) => runtime.routes,
    ).length

    const byProfile = (
      items: { runtimeId: string; route: PublicRouteSummary }[],
      predicate: (route: PublicRouteSummary) => boolean,
    ) =>
      items
        .filter((item) => predicate(item.route))
        .map((item) => item.route.extensions)

    expect(valid.ok).toBe(true)
    expect(malformed).toEqual(
      f.malformedVariants.map((variant) => ({
        caseId: variant.caseId,
        ok: false,
        reason: "catalog_invalid",
      })),
    )
    expect(refusalView(unknownRequired)).toMatchObject({
      ok: false,
      reason: f.expectedUnknownRequiredReason,
      hasDelegate: false,
    })
    expect(
      codexRequired.ok
        ? codexRequired.extensions.map((extension) =>
            Object.fromEntries(
              PUBLIC_EXTENSION_KEYS.map((key) => [key, extension[key]]),
            ),
          )
        : codexRequired.reason,
    ).toEqual([f.codexExtension])
    expect(refusalView(batchRequired)).toMatchObject({
      ok: false,
      reason: f.expectedUnknownRequiredReason,
      hasDelegate: false,
    })
    expect(factoryCalls).toEqual([])
    for (const items of [testPublic, productionPublic]) {
      expect(
        byProfile(items, (route) => route.executionProfile === "policy-grant"),
      ).toEqual([f.publicExpectations.policyGrantExtensions])
      expect(
        byProfile(items, (route) => route.executionProfile === "batch").filter(
          (extensions) =>
            JSON.stringify(extensions) !==
            JSON.stringify(f.publicExpectations.batchExtensions),
        ),
      ).toEqual([])
      expect(
        byProfile(items, (route) => route.kind === "completion").filter(
          (extensions) =>
            JSON.stringify(extensions) !==
            JSON.stringify(f.publicExpectations.completionExtensions),
        ),
      ).toEqual([])
      expect(
        byProfile(items, (route) => route.executionProfile === "batch").length,
      ).toBeGreaterThan(0)
      expect(
        byProfile(items, (route) => route.kind === "completion").length,
      ).toBeGreaterThan(0)
      expect(
        items.flatMap((item) =>
          item.route.extensions.map((extension) => sortedKeys(extension)),
        ),
      ).toEqual(
        items.flatMap((item) =>
          item.route.extensions.map(() => [...PUBLIC_EXTENSION_KEYS]),
        ),
      )
    }
    expect(unknownOptionalRoutes).toBeGreaterThan(0)
    expect(readerWithUnknown).toEqual(readerBaseline)
    expect(readerWithUnknown.apiSupported).toBe(true)
    expect(producedNamespaces).toEqual(f.producer.expectedExtensionNamespaces)
    expect(producedHeaders.length).toBeGreaterThan(0)
    expect([
      ...new Set(producedHeaders.map((header) => JSON.stringify(header))),
    ]).toEqual([JSON.stringify(f.producer.expectedExtensionHeader)])
    expect(productionPolicyGrantNamespaces).toEqual(producedNamespaces)
  })
})

// ---------------------------------------------------------------------------
// agent-runtime-core / Agent Runtime Contract (MODIFIED, S34-S36)
// ---------------------------------------------------------------------------

describe("agent-runtime-core / Agent Runtime Contract", () => {
  test("S34 Runtime-specific behavior is not forced into the contract — a basic Codex route resolves with manifestRef and delegate while rollback/commands/workflows/plugins requests keep the existing capability refusal and the basic request carries no optional fields", async () => {
    const f = capabilities.S34
    const catalog = await requireCatalog()
    const basic = catalog.resolveRuntimeRoute(query(f.basicQuery))
    const optional = f.optional.map((item) => ({
      capabilityId: item.capabilityId,
      view: refusalView(
        catalog.resolveRuntimeRoute(
          query({ ...f.basicQuery, requiredCapabilities: [item.capabilityId] }),
        ),
      ),
      status: getAgentRuntimeCapability(f.runtimeId, item.capabilityId).status,
    }))
    const request = createAgentRuntimeRunRequest({
      ...f.basicRequestInput,
      signal: new AbortController().signal,
    })
    const requestFields = deepKeys({ ...request, signal: null })
    const forbidden = requestFields.filter((key) =>
      f.forbiddenOptionalFields.includes(key),
    )

    expect(okView(basic)).toEqual({
      ok: true,
      adapterSource: f.expectedBasic.adapterSource,
      executionSurface: f.expectedBasic.executionSurface,
      manifestRuntimeId: f.expectedBasic.manifestRuntimeId,
      enforcementEvidence: f.expectedBasic.enforcementEvidence,
      delegateType: "function",
      fallbackReason: null,
    })
    expect(optional).toEqual(
      f.optional.map((item) => ({
        capabilityId: item.capabilityId,
        view: {
          ok: false,
          reason: "capability_refused",
          candidateAdapterSource: f.expectedBasic.adapterSource,
          errorCode: "unsupported_capability",
          errorMessage: item.errorMessage,
          exitCode: 1,
          hasDelegate: false,
        },
        status: item.status,
      })),
    )
    expect(Object.keys(request).sort()).toEqual(f.basicRequestKeys)
    expect(request.requestedCapabilities).toEqual(f.basicRequestedCapabilities)
    expect(forbidden).toEqual([])
  })

  test("S35 Caller requests runtime capabilities — renderer/public route projections stay sanitized while desktop, CLI and main callers all read the shared explicit supported/degraded/unsupported states with reasons", async () => {
    const f = capabilities.S35
    const catalog = await requireCatalog()
    const renderer = catalog.projectRuntimeRoutes("renderer")
    const publicProjection = catalog.projectRuntimeRoutes("public")
    const desktopDto = await agentRuntimeRouter
      .createCaller({} as never)
      .listManifests()
    const db = createTempDb()
    const recorder = readinessDependencies({
      defaultProvider: { state: "not-configured" },
    })
    const cli = await runHeadlessCli(db, f.cliArgv, {
      runtimeReadinessDependencies: recorder.dependencies,
    })
    const cliEnvelope = JSON.parse(cli.stdout) as {
      runtimes: (AgentRuntimeCapabilityManifest & { readiness: unknown })[]
    }
    const rendererRuntimeIds = [
      ...new Set(renderer.map((entry) => entry.runtimeId)),
    ].sort()
    const mainStates = Object.fromEntries(
      rendererRuntimeIds.map((runtimeId) => {
        const canonical = toAgentRuntimeId(runtimeId)
        const manifest = canonical
          ? getAgentRuntimeCapabilityManifest(canonical)
          : null
        return [
          runtimeId,
          Object.fromEntries(
            (manifest?.capabilities ?? []).map((capability) => [
              capability.id,
              capability.status === "supported"
                ? { status: capability.status }
                : { status: capability.status, reason: capability.reason },
            ]),
          ),
        ]
      }),
    )
    const toStates = (manifests: AgentRuntimeCapabilityManifest[]) =>
      Object.fromEntries(
        manifests.map((manifest) => [
          manifest.runtimeId,
          Object.fromEntries(
            manifest.capabilities.map((capability) => [
              capability.id,
              capability.status === "supported"
                ? { status: capability.status }
                : { status: capability.status, reason: capability.reason },
            ]),
          ),
        ]),
      )
    const statuses = [
      ...new Set(
        getAgentRuntimeCapabilityManifests().flatMap((manifest) =>
          manifest.capabilities.map((capability) => capability.status),
        ),
      ),
    ].sort()
    const serializedProjections = JSON.stringify({ renderer, publicProjection })
    const secretHits = f.secretPatterns.filter((pattern) =>
      new RegExp(pattern).test(serializedProjections),
    )

    expect(renderer.map((entry) => sortedKeys(entry))).toEqual(
      renderer.map(() => [...RENDERER_ROUTE_KEYS]),
    )
    expect(
      rendererRuntimeIds.map((runtimeId) => ({
        runtimeId,
        transportId: renderer.find((entry) => entry.runtimeId === runtimeId)
          ?.transportId,
      })),
    ).toEqual(f.rendererRoutes)
    for (const item of publicSummaries(publicProjection)) {
      expect(sortedKeys(item.route)).toEqual([...PUBLIC_ROUTE_KEYS])
    }
    expect(serializedProjections).not.toContain("{{REPO_ROOT}}")
    expect(serializedProjections).not.toMatch(/"\/(home|Users|tmp)\//)
    expect(secretHits).toEqual([])
    expect(mainStates).toEqual(f.states)
    expect(toStates(desktopDto)).toEqual(f.states)
    expect(cli.code).toBe(0)
    expect(toStates(cliEnvelope.runtimes)).toEqual(f.states)
    expect(
      statuses.every((status) => f.explicitStatuses.includes(status)),
    ).toBe(true)
  })

  test("S36 Runtime declares support — each catalog-selected desktop adapter's supported hardToolGuard/planMode/quickChatAssistant claim is observed through its actual enforcing port, and a mismatched declared result fails conformance", async () => {
    const f = capabilities.S36
    const catalog = await requireCatalog()
    const routes = f.desktopRoutes.map((expected) => {
      const resolution = catalog.resolveRuntimeRoute(
        desktopQuery({ runtimeId: expected.runtimeId }),
      )
      return { expected, resolution }
    })
    const observations: {
      runtimeId: string
      capabilityId: string
      manifestStatus: string
      routeWithCapability: boolean
      failures: string[]
    }[] = []
    for (const entry of f.conformance) {
      const selected = routes.find(
        (item) => item.expected.runtimeId === entry.runtimeId,
      )?.resolution
      const withCapability = catalog.resolveRuntimeRoute(
        desktopQuery({
          runtimeId: entry.runtimeId,
          mode: entry.policy.mode,
          requiredCapabilities: [entry.capabilityId],
        }),
      )
      const observed = selected?.ok
        ? await runEnforcingOperation({
            adapterSource: selected.adapterSource,
            runtimeId: entry.runtimeId,
            policy: entry.policy,
            operation: entry.operation,
          })
        : null
      observations.push({
        runtimeId: entry.runtimeId,
        capabilityId: entry.capabilityId,
        manifestStatus: getAgentRuntimeCapability(
          entry.runtimeId,
          entry.capabilityId,
        ).status,
        routeWithCapability: withCapability.ok,
        failures: observed
          ? supportedCapabilityConformanceFailures(entry.expected, observed)
          : ["route-not-selected"],
      })
    }
    const mismatchEntry = f.conformance.find(
      (entry) =>
        entry.runtimeId === f.mismatchVariant.runtimeId &&
        entry.capabilityId === f.mismatchVariant.capabilityId,
    )
    const mismatchRoute = routes.find(
      (item) => item.expected.runtimeId === f.mismatchVariant.runtimeId,
    )?.resolution
    const mismatchObserved =
      mismatchEntry && mismatchRoute?.ok
        ? await runEnforcingOperation({
            adapterSource: mismatchRoute.adapterSource,
            runtimeId: mismatchEntry.runtimeId,
            policy: mismatchEntry.policy,
            operation: mismatchEntry.operation,
          })
        : null
    const coverage = f.desktopRoutes.map((route) => ({
      runtimeId: route.runtimeId,
      supported: f.enforcementCapabilities.filter(
        (capabilityId) =>
          getAgentRuntimeCapability(route.runtimeId, capabilityId).status ===
          "supported",
      ),
      covered: f.conformance
        .filter((entry) => entry.runtimeId === route.runtimeId)
        .map((entry) => entry.capabilityId),
    }))

    expect(
      routes.map((item) => ({
        runtimeId: item.expected.runtimeId,
        adapterSource: item.resolution.ok
          ? item.resolution.adapterSource
          : null,
        executionSurface: item.resolution.ok
          ? item.resolution.executionSurface
          : null,
        enforcementEvidence: item.resolution.ok
          ? item.resolution.enforcementEvidence
          : null,
      })),
    ).toEqual(
      f.desktopRoutes.map((route) => ({
        runtimeId: route.runtimeId,
        adapterSource: route.adapterSource,
        executionSurface: route.executionSurface,
        enforcementEvidence: route.enforcementEvidence,
      })),
    )
    expect(observations).toEqual(
      f.conformance.map((entry) => ({
        runtimeId: entry.runtimeId,
        capabilityId: entry.capabilityId,
        manifestStatus: "supported",
        routeWithCapability: true,
        failures: [],
      })),
    )
    expect(coverage.map((item) => item.supported)).toEqual(
      coverage.map((item) => item.covered),
    )
    expect(
      mismatchEntry && mismatchObserved
        ? supportedCapabilityConformanceFailures(
            {
              ...mismatchEntry.expected,
              response: f.mismatchVariant.declaredResponse,
            },
            mismatchObserved,
          )
        : ["route-not-selected"],
    ).toEqual(f.mismatchVariant.expectedFailures)
  })
})

// ---------------------------------------------------------------------------
// agent-runtime-core / Capability Honesty (MODIFIED, S37-S39)
// ---------------------------------------------------------------------------

describe("agent-runtime-core / Capability Honesty", () => {
  test("S37 Runtime supports hard tool guard — the catalog selects pre-execution desktop adapters whose tool-decision ports allow, deny and rewrite before execution and emit guard events", async () => {
    const f = capabilities.S37
    const catalog = await requireCatalog()
    const results: unknown[] = []
    for (const decision of f.decisions) {
      const route = catalog.resolveRuntimeRoute(
        desktopQuery({
          runtimeId: decision.runtimeId,
          requiredCapabilities: [f.capabilityId],
        }),
      )
      const observed: ConformanceObservation | null = route.ok
        ? await runEnforcingOperation({
            adapterSource: route.adapterSource,
            runtimeId: decision.runtimeId,
            policy: decision.policy,
            operation: decision.operation,
          })
        : null
      results.push({
        caseId: decision.caseId,
        manifestStatus: getAgentRuntimeCapability(
          decision.runtimeId,
          f.capabilityId,
        ).status,
        enforcementEvidence: route.ok
          ? route.enforcementEvidence
          : route.reason,
        enforcingPortCalls: observed?.enforcingPortCalls ?? 0,
        response: observed?.response ?? null,
        ...(decision.expected.recordedInput
          ? { recordedInput: observed?.recordedInput ?? null }
          : {}),
        guardEventTypes: observed?.guardEventTypes ?? [],
        emittedChunkTypes: observed?.emittedChunkTypes ?? [],
      })
    }

    expect(results).toEqual(
      f.decisions.map((decision) => ({
        caseId: decision.caseId,
        manifestStatus: "supported",
        enforcementEvidence: "pre-execution",
        enforcingPortCalls: 1,
        response: decision.expected.response,
        ...(decision.expected.recordedInput
          ? { recordedInput: decision.expected.recordedInput }
          : {}),
        guardEventTypes: decision.expected.guardEventTypes,
        emittedChunkTypes: decision.expected.emittedChunkTypes,
      })),
    )
  })

  test("S38 Runtime lacks pre-tool interception — headless leaves expose only sandbox-level/admission-audit evidence and the baseline guarded-scope refusal, and prompt-only/post-run-audit manifest variants surface only their degraded/unsupported state in discovery and the capability gate", async () => {
    const f = capabilities.S38
    const catalog = await requireCatalog()
    const evidence = f.headlessEvidence.map((spec) => {
      const resolution = catalog.resolveRuntimeRoute(query(spec))
      return {
        runtimeId: spec.runtimeId,
        adapterSource: resolution.ok ? resolution.adapterSource : null,
        enforcementEvidence: resolution.ok
          ? resolution.enforcementEvidence
          : resolution.reason,
      }
    })
    const refusals = f.guardedHeadlessRefusals.map((item) =>
      refusalView(
        catalog.resolveRuntimeRoute(
          query({ ...item.query, requiredCapabilities: ["hardToolGuard"] }),
        ),
      ),
    )
    const variants: unknown[] = []
    for (const variant of f.variants) {
      const port = manifestPortWithOverrides([variant.override])
      const validation = catalog.validateRuntimeRouteCatalog(undefined, {
        getManifest: port.getManifest,
      })
      const state = validation.ok ? validation.catalog : undefined
      const envelope = await manifestEnvelope(state)
      const discovered = envelopeCapability(
        envelope,
        variant.override.runtimeId,
        "hardToolGuard",
      )
      const desktop = catalog.resolveRuntimeRoute(
        desktopQuery({
          runtimeId: variant.override.runtimeId,
          requiredCapabilities: ["hardToolGuard"],
        }),
        state,
      )
      const headless = catalog.resolveRuntimeRoute(
        query({
          runtimeId: variant.override.runtimeId,
          entry: "headless",
          executionProfile: "batch",
        }),
        state,
      )
      variants.push({
        variantId: variant.variantId,
        validationOk: validation.ok,
        discovered: discovered
          ? { status: discovered.status, reason: discovered.reason }
          : null,
        desktop: refusalView(desktop),
        headlessEvidence: headless.ok
          ? headless.enforcementEvidence
          : headless.reason,
      })
    }

    expect(evidence).toEqual(
      f.headlessEvidence.map((spec) => ({
        runtimeId: spec.runtimeId,
        adapterSource: spec.adapterSource,
        enforcementEvidence: spec.enforcementEvidence,
      })),
    )
    expect(evidence.map((item) => item.enforcementEvidence)).not.toContain(
      "pre-execution",
    )
    expect(refusals).toEqual(
      f.guardedHeadlessRefusals.map((item) => ({
        ok: false,
        reason: item.reason,
        candidateAdapterSource: item.candidateAdapterSource,
        errorCode: item.errorCode,
        errorMessage: item.errorMessage,
        exitCode: item.exitCode,
        hasDelegate: false,
      })),
    )
    expect(variants).toEqual(
      f.variants.map((variant) => ({
        variantId: variant.variantId,
        validationOk: true,
        discovered: {
          status: variant.override.status,
          reason: variant.override.reason,
        },
        desktop: {
          ok: false,
          reason: "capability_refused",
          candidateAdapterSource: "codex-app-server",
          errorCode: "unsupported_capability",
          errorMessage: variant.expectedMessage,
          exitCode: 1,
          hasDelegate: false,
        },
        headlessEvidence: "sandbox-level",
      })),
    )
  })

  test("S39 Codex capability is missing — canonical Codex rollback stays unsupported in the renderer DTO, CLI discovery and shared gate while every catalog surface refuses a rollback-requiring query with capability_refused and no delegate", async () => {
    const f = capabilities.S39
    const catalog = await requireCatalog()
    const desktopDto = await agentRuntimeRouter
      .createCaller({} as never)
      .listManifests()
    const db = createTempDb()
    const recorder = readinessDependencies({
      defaultProvider: { state: "not-configured" },
    })
    const cli = await runHeadlessCli(db, f.cliArgv, {
      runtimeReadinessDependencies: recorder.dependencies,
    })
    const cliEnvelope = JSON.parse(cli.stdout) as {
      runtimes: AgentRuntimeCapabilityManifest[]
    }
    const gate = checkAgentRuntimeCapability({
      runtime: f.runtimeId,
      capabilityId: f.capabilityId,
    })
    const surfaces = f.queries.map((spec) => {
      const resolution =
        spec.surface === "desktop"
          ? catalog.resolveRuntimeRoute(
              desktopQuery({
                runtimeId: spec.runtimeId,
                requiredCapabilities: [f.capabilityId],
              }),
            )
          : catalog.resolveRuntimeRoute(
              query({
                runtimeId: spec.runtimeId,
                entry: spec.entry ?? "headless",
                executionProfile: spec.executionProfile ?? "batch",
                requiredCapabilities: [f.capabilityId],
              }),
            )
      return { surface: spec.surface, view: refusalView(resolution) }
    })
    const rendererRuntimeIds = catalog
      .projectRuntimeRoutes("renderer")
      .map((entry) => entry.runtimeId)
    const pick = (capability: Record<string, unknown> | null) =>
      capability
        ? {
            status: capability.status,
            scope: capability.scope,
            reason: capability.reason,
            hint: capability.hint,
          }
        : null
    const codexDto = desktopDto.find(
      (manifest) => manifest.runtimeId === "codex",
    )
    const claudeDto = desktopDto.find(
      (manifest) => manifest.runtimeId === "claude-code",
    )
    const codexCli = cliEnvelope.runtimes.find(
      (manifest) => manifest.runtimeId === "codex",
    )
    const expectedState = {
      status: f.codex.status,
      scope: f.codex.scope,
      reason: f.codex.reason,
      hint: f.codex.hint,
    }

    expect(pick(capabilityOf(codexDto, f.capabilityId))).toEqual(expectedState)
    expect(capabilityOf(claudeDto, f.capabilityId)?.status).toBe(f.claudeStatus)
    expect(pick(capabilityOf(codexCli, f.capabilityId))).toEqual(expectedState)
    expect(gate.ok ? null : gate.diagnostic.message).toBe(f.codex.message)
    expect(surfaces).toEqual(
      f.queries.map((spec) => ({
        surface: spec.surface,
        view: {
          ok: false,
          reason: "capability_refused",
          candidateAdapterSource: spec.candidateAdapterSource,
          errorCode: "unsupported_capability",
          errorMessage: f.codex.message,
          exitCode: 1,
          hasDelegate: false,
        },
      })),
    )
    // A missing capability never removes the runtime's desktop route.
    expect(rendererRuntimeIds).toContain(f.runtimeId)
  })
})

// ---------------------------------------------------------------------------
// agent-runtime-core / Runtime-Neutral Agent Runner (MODIFIED, S47)
// ---------------------------------------------------------------------------

describe("agent-runtime-core / Runtime-Neutral Agent Runner", () => {
  test("S47 Unsupported capability requested — the owner-derived implicit/explicit capability union is refused with the baseline unsupported_capability diagnostic before any provider work, independent of union order", async () => {
    const f = capabilities.S47
    const catalog = await requireCatalog()
    const union = (
      explicit: AgentRuntimeCapabilityId[],
      implicitInput: { mode: "plan" | "agent" },
    ) => [
      ...new Set([
        ...explicit,
        ...getAgentRunRequiredCapabilityIds(implicitInput),
      ]),
    ]
    const results = f.cases.map((item) => {
      const capabilitiesUnion = union(item.explicit, item.implicitInput)
      const forward = catalog.resolveRuntimeRoute(
        query({ ...item.query, requiredCapabilities: capabilitiesUnion }),
      )
      const reversed = catalog.resolveRuntimeRoute(
        query({
          ...item.query,
          requiredCapabilities: [...capabilitiesUnion].reverse(),
        }),
      )
      return {
        caseId: item.caseId,
        view: refusalView(forward),
        reversedView: refusalView(reversed),
        candidateAdapterLabel: forward.ok
          ? null
          : forward.candidateAdapterLabel,
        diagnosticReason: forward.ok ? null : forward.diagnostic?.reason,
        diagnosticMessage: forward.ok ? null : forward.diagnostic?.message,
        capability: forward.ok ? null : forward.diagnostic?.capability,
        resultStatus: forward.ok ? null : forward.result?.status,
      }
    })
    const control = catalog.resolveRuntimeRoute(
      query({
        ...f.supportedControl.query,
        requiredCapabilities: union(
          f.supportedControl.explicit,
          f.supportedControl.implicitInput,
        ),
      }),
    )

    expect(results).toEqual(
      f.cases.map((item) => {
        const view = {
          ok: false,
          reason: item.expected.reason,
          candidateAdapterSource: item.expected.candidateAdapterSource,
          errorCode: item.expected.errorCode,
          errorMessage: item.expected.errorMessage,
          exitCode: item.expected.exitCode,
          hasDelegate: false,
        }
        return {
          caseId: item.caseId,
          view,
          reversedView: view,
          candidateAdapterLabel: item.expected.candidateAdapterLabel,
          diagnosticReason: item.expected.diagnosticReason,
          diagnosticMessage: item.expected.errorMessage,
          capability: item.expected.capability,
          resultStatus: "failed",
        }
      }),
    )
    expect(control.ok ? control.adapterSource : control.reason).toBe(
      f.supportedControl.expectedAdapterSource,
    )
  })
})

// ---------------------------------------------------------------------------
// codex-runtime-parity / Codex Runtime Parity Dependency (MODIFIED, S51-S52)
// ---------------------------------------------------------------------------

describe("codex-runtime-parity / Codex Runtime Parity Dependency", () => {
  test("S51 Headless jobs depend on capability truth — every canonical Codex state is identical in catalog headless resolution, CLI discovery and the shared caller gate, and refused capabilities hand out no delegate", async () => {
    const f = capabilities.S51
    const catalog = await requireCatalog()
    const db = createTempDb()
    const recorder = readinessDependencies({
      defaultProvider: { state: "not-configured" },
    })
    const cli = await runHeadlessCli(db, f.cliArgv, {
      runtimeReadinessDependencies: recorder.dependencies,
    })
    const cliCodex = (
      JSON.parse(cli.stdout) as { runtimes: AgentRuntimeCapabilityManifest[] }
    ).runtimes.find((manifest) => manifest.runtimeId === f.runtimeId)
    const publicRuntimeIds = publicSummaries(
      catalog.projectRuntimeRoutes("public"),
    ).map((item) => item.runtimeId)
    const rows = (Object.keys(f.states) as AgentRuntimeCapabilityId[]).map(
      (capabilityId) => {
        const gate = checkAgentRuntimeCapability({
          runtime: f.runtimeId,
          capabilityId,
        })
        const resolution = catalog.resolveRuntimeRoute(
          query({ ...f.headlessQuery, requiredCapabilities: [capabilityId] }),
        )
        return {
          capabilityId,
          discovered: capabilityOf(cliCodex, capabilityId)?.status ?? null,
          gateOk: gate.ok,
          gateMessage: gate.ok ? null : gate.diagnostic.message,
          resolution: resolution.ok
            ? { ok: true, adapterSource: resolution.adapterSource }
            : refusalView(resolution),
        }
      },
    )

    expect(rows).toEqual(
      (Object.keys(f.states) as AgentRuntimeCapabilityId[]).map(
        (capabilityId) => {
          const state = f.states[capabilityId]
          const gated = f.headlessPolicyGated[capabilityId]
          return {
            capabilityId,
            discovered: state.status,
            gateOk: state.status === "supported",
            gateMessage:
              state.status === "supported" ? null : f.messages[capabilityId],
            resolution: gated
              ? {
                  ok: false,
                  reason: gated.reason,
                  candidateAdapterSource: gated.candidateAdapterSource,
                  errorCode: gated.errorCode,
                  errorMessage: gated.errorMessage,
                  exitCode: gated.exitCode,
                  hasDelegate: false,
                }
              : state.status === "supported"
                ? { ok: true, adapterSource: "codex-batch" }
                : {
                    ok: false,
                    reason: "capability_refused",
                    candidateAdapterSource: "codex-batch",
                    errorCode: "unsupported_capability",
                    errorMessage: f.messages[capabilityId],
                    exitCode: 1,
                    hasDelegate: false,
                  },
          }
        },
      ),
    )
    expect(publicRuntimeIds).toContain(f.runtimeId)
  })

  test("S52 Parity claim is attempted without implementation — supported Codex claims pass only through the catalog-selected app-server enforcing port; prompt-only, UI-label, indexed-documentation and post-run-audit variants never call it and fail conformance", async () => {
    const f = capabilities.S52
    const catalog = await requireCatalog()
    const route = catalog.resolveRuntimeRoute(
      desktopQuery({ runtimeId: f.runtimeId }),
    )
    const positive: { capabilityId: string; failures: string[] }[] = []
    const variants: {
      capabilityId: string
      variant: string
      failures: string[]
    }[] = []
    for (const entry of f.capabilities) {
      const capability = getAgentRuntimeCapability(
        f.runtimeId,
        entry.capabilityId,
      )
      const observed = route.ok
        ? await runEnforcingOperation({
            adapterSource: route.adapterSource,
            runtimeId: f.runtimeId,
            policy: entry.policy,
            operation: entry.operation,
          })
        : null
      positive.push({
        capabilityId: entry.capabilityId,
        failures: observed
          ? supportedCapabilityConformanceFailures(entry.expected, observed)
          : ["route-not-selected"],
      })
      // Non-enforcing evidence sources: real product artifacts that describe
      // the capability without ever reaching the enforcing port.
      const contract = fixtureGuardedContract()
      // Recording enforcing port offered to every variant; a variant that
      // really enforced would have to call it.
      let variantPortCalls = 0
      const recordingPort = () => {
        variantPortCalls += 1
      }
      const sources: Record<string, (port: () => void) => unknown> = {
        "prompt-only": () => buildGuardedRunPromptBlock(contract),
        "ui-label": () => `${capability.label}: ${capability.hint ?? ""}`,
        "indexed-documentation": () => capability.support?.references ?? [],
        "post-run-audit": () =>
          buildGuardedRunAudit({
            contract,
            runtime: "codex",
            enforcementMode: "contract-and-audit",
            preRunStatus: f.auditSnapshots.preRunStatus,
            postRunStatus: f.auditSnapshots.postRunStatus,
            startedAt: f.auditSnapshots.startedAt,
            finishedAt: f.auditSnapshots.finishedAt,
          }),
      }
      for (const variant of f.nonEnforcingVariants) {
        variantPortCalls = 0
        const produced = sources[variant]?.(recordingPort)
        const observation: ConformanceObservation = {
          enforcingPortCalls: variantPortCalls,
          response: produced ?? null,
          recordedInput: null,
          guardEventTypes: [],
          emittedChunkTypes: [],
        }
        variants.push({
          capabilityId: entry.capabilityId,
          variant,
          failures: supportedCapabilityConformanceFailures(
            entry.expected,
            observation,
          ),
        })
      }
    }

    expect(route.ok ? route.adapterSource : route.reason).toBe(f.adapterSource)
    expect(
      f.capabilities.map(
        (entry) =>
          getAgentRuntimeCapability(f.runtimeId, entry.capabilityId).status,
      ),
    ).toEqual(f.capabilities.map(() => "supported"))
    expect(positive).toEqual(
      f.capabilities.map((entry) => ({
        capabilityId: entry.capabilityId,
        failures: [],
      })),
    )
    expect(variants).toEqual(
      f.capabilities.flatMap((entry) =>
        f.nonEnforcingVariants.map((variant) => ({
          capabilityId: entry.capabilityId,
          variant,
          failures: f.expectedVariantFailures,
        })),
      ),
    )
  })
})
