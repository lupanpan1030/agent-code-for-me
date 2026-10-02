/**
 * Independent RED acceptance suite — refactor-unified-runtime-route-catalog,
 * public-guards domain, public contract: S21, S24, S25
 * (openspec/changes/refactor-unified-runtime-route-catalog/specs/
 * local-job-api/spec.md:12-34).
 *
 * Written test-first on base 19986552 (product source = 6192b13f) without
 * implementation context. Every surface case runs through the real
 * in-process CLI (`runHeadlessCliCommand`), the real `runAgentTask` and the
 * real selector/catalog; only the three headless leaf modules are recording
 * stubs (installRecordingLeafPorts). The job-runner fake runner is never
 * used. Byte goldens were captured from 6192b13f with the same harness into
 * tests/fixtures/runtime-route-catalog/{public-contract,errors,artifacts}.json;
 * per-run values are `{{PLACEHOLDERS}}` bound from the profile DB/disk.
 *
 * RED on the base: `runtime-route-catalog.ts` and its D1 functions do not
 * exist, so the catalog host option cannot be constructed (lazy import fails
 * inside each test). After implementation the same inputs must reproduce the
 * frozen 6192b13f oracles through `runtimeRouteCatalog`.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test"
import {
  type DriverStep,
  FIXED_NOW_ISO,
  failureCatalogState,
  fixtureKey,
  installRecordingLeafPorts,
  type JsonObject,
  type LeafCall,
  leafPorts,
  productionCatalogState,
  renderRun,
  runAgentContract,
  runAgentTaskDirect,
  runArtifactResiduals,
  runCatalogFailureCreate,
  runCompletionContract,
  runRefusalSurfaces,
  SANITIZED_CATALOG_MESSAGE,
  settle,
  submitWaitKit,
} from "./runtime-route-catalog-guards-kit"

await installRecordingLeafPorts()

type Golden = { steps: DriverStep[]; leafCalls: LeafCall[]; fetchCalls: number }

const INTERNAL_REASON_TEXT = [
  "routeId",
  "transportId",
  "catalog_invalid",
  "route_not_found",
  "policy_refused",
  "capability_refused",
  "unsupported_required_extension",
]
const RUNTIME_SELECTED_KEYS = [
  "adapterSource",
  "executionProfile",
  "fallbackReason",
  "label",
  "runtime",
  "source",
  "status",
]
const RUNTIME_SELECTION_REFUSED_KEYS = [
  "adapterSource",
  "errorCode",
  "executionProfile",
  "message",
  "reason",
  "runtime",
  "source",
  "status",
]
const EVENT_ENVELOPE_KEYS = [
  "apiVersion",
  "createdAt",
  "jobId",
  "payload",
  "sequence",
  "type",
]

beforeEach(() => {
  setSystemTime(new Date(FIXED_NOW_ISO))
  leafPorts.reset()
})

afterEach(() => {
  setSystemTime()
  leafPorts.reset()
})

function golden(value: unknown): Golden {
  return value as Golden
}

/** Envelope/vocabulary violations across every `events` step (collected). */
async function eventEnvelopeViolations(steps: DriverStep[]): Promise<string[]> {
  const shared = await import("../src/shared/local-job-api")
  const types = new Set<string>(shared.LOCAL_JOB_API_EVENT_TYPES)
  const violations: string[] = []
  if (types.size !== 12) violations.push(`public event types: ${types.size}`)
  for (const step of steps.filter((entry) => entry.step.startsWith("events"))) {
    for (const line of step.stdout.split("\n").filter(Boolean)) {
      const event = JSON.parse(line) as Record<string, unknown>
      const keys = Object.keys(event).sort()
      if (JSON.stringify(keys) !== JSON.stringify(EVENT_ENVELOPE_KEYS)) {
        violations.push(`${step.step}: envelope keys ${keys.join(",")}`)
      }
      if (!types.has(String(event.type))) {
        violations.push(`${step.step}: event type ${String(event.type)}`)
      }
    }
  }
  return violations
}

function internalTextLeaks(steps: DriverStep[]): string[] {
  return steps.flatMap((step) =>
    INTERNAL_REASON_TEXT.filter(
      (text) => step.stdout.includes(text) || step.stderr.includes(text),
    ).map((text) => `${step.step}: ${text}`),
  )
}

describe("public contract through the runtime route catalog", () => {
  test("S21 Existing operations match frozen complete contract oracles — agent create, keyed submit/replay/conflict, wait timeout(9)/ready, status, events --after/--follow, result, retry sync/--async, cancel and the named claude-policy-grant, fail-closed and codex grant cases reproduce the 6192b13f bytes, channels, exits and leaf calls through the runtimeRouteCatalog host option", async () => {
    const fx = fixtureKey("public-contract.json", "S21")
    // Enforces once runtime-route-catalog.ts exists: the validated production
    // catalog is injected through RunHeadlessCliCommandOptions.runtimeRouteCatalog.
    const catalog = await productionCatalogState()
    const actual = await runAgentContract(fx.requests as JsonObject, {
      extra: { runtimeRouteCatalog: catalog },
    })
    // Control: the same create with an injected failure state must not reach
    // a leaf, proving the surfaces honor the injected catalog option.
    const control = await runCatalogFailureCreate(fx.requests as JsonObject, {
      extra: { runtimeRouteCatalog: await failureCatalogState() },
      leafThrow: false,
    })
    const expected = renderRun(golden(fx.agent), actual.vars)
    expect({
      steps: actual.steps,
      leafCalls: actual.leafCalls,
      fetchCalls: actual.fetchCalls,
      envelopeViolations: await eventEnvelopeViolations(actual.steps),
      internalTextLeaks: internalTextLeaks(actual.steps),
      controlLeafCalls: control.leafCalls.length,
      controlExit: control.steps[0]?.code,
    }).toEqual({
      ...expected,
      envelopeViolations: [],
      internalTextLeaks: [],
      controlLeafCalls: 0,
      controlExit: 1,
    })
  }, 60_000)

  test("S21 Existing operations match frozen complete contract oracles — completion create, keyed submit/replay/conflict, wait timeout(9)/ready, status, events --after/--follow, result, retry sync/--async of a failed Run and cancel reproduce the 6192b13f bytes with one upstream call per executed Run and zero agent leaf calls through the runtimeRouteCatalog host option", async () => {
    const fx = fixtureKey("public-contract.json", "S21")
    // Enforces once runtime-route-catalog.ts exists (host option above).
    const catalog = await productionCatalogState()
    const actual = await runCompletionContract(fx.requests as JsonObject, {
      extra: { runtimeRouteCatalog: catalog },
    })
    const expected = renderRun(golden(fx.completion), actual.vars)
    expect({
      steps: actual.steps,
      leafCalls: actual.leafCalls,
      fetchCalls: actual.fetchCalls,
      envelopeViolations: await eventEnvelopeViolations(actual.steps),
      internalTextLeaks: internalTextLeaks(actual.steps),
    }).toEqual({
      ...expected,
      envelopeViolations: [],
      internalTextLeaks: [],
    })
    expect(expected.leafCalls).toEqual([])
  }, 60_000)

  test("S21 Existing operations match frozen complete contract oracles — runAgentTask with the third-argument runtimeRouteCatalog emits the internal interactive-refusal oracle and runtime_selected / runtime_selection_refused payloads with exactly the 6192b13f key sets (policyGrantScopeBinding only for the codex grant case) and no routeId/transportId/internal reason", async () => {
    const fx = fixtureKey("public-contract.json", "S21")
    const internal = fx.internal as JsonObject
    const cases = internal.cases as Record<string, JsonObject>
    const oracles = internal.oracles as Record<string, JsonObject>
    // Enforces once runtime-route-catalog.ts exists: runAgentTask's D1 third
    // options argument carries runtimeRouteCatalog.
    const catalog = await productionCatalogState()
    const actual: Record<string, unknown> = {}
    const keySets: Record<string, string[][]> = {}
    for (const [name, input] of Object.entries(cases)) {
      leafPorts.reset()
      const run = await runAgentTaskDirect(
        input as unknown as Parameters<typeof runAgentTaskDirect>[0],
        { runtimeRouteCatalog: catalog },
      )
      actual[name] = { ...run, leafCalls: [...leafPorts.calls] }
      keySets[name] = run.events
        .filter((event) => event.type === "status")
        .map((event) => Object.keys(event.payload).sort())
    }
    const failureState = await failureCatalogState()
    leafPorts.reset()
    const failure = await settle(() =>
      runAgentTaskDirect(
        cases.selectedCodexBatch as unknown as Parameters<
          typeof runAgentTaskDirect
        >[0],
        { runtimeRouteCatalog: failureState },
      ),
    )
    const failureMessage = failure.fulfilled
      ? (failure.value.result as { errorMessage?: string }).errorMessage
      : failure.reason
    expect({
      actual,
      keySets,
      leaks: JSON.stringify(actual).match(
        /routeId|transportId|catalog_invalid|route_not_found|policy_refused|capability_refused/g,
      ),
      failureLeafCalls: leafPorts.calls.length,
      failureMessage,
    }).toEqual({
      actual: oracles,
      keySets: {
        interactiveCodex: [RUNTIME_SELECTION_REFUSED_KEYS],
        interactiveClaude: [RUNTIME_SELECTION_REFUSED_KEYS],
        selectedCodexBatch: [RUNTIME_SELECTED_KEYS],
        selectedCodexGrant: [
          [...RUNTIME_SELECTED_KEYS, "policyGrantScopeBinding"].sort(),
        ],
        refusedClaudeGrant: [RUNTIME_SELECTION_REFUSED_KEYS],
      },
      leaks: null,
      failureLeafCalls: 0,
      failureMessage: SANITIZED_CATALOG_MESSAGE,
    })
  }, 60_000)

  test("S24 Refusals retain surface-specific errors and exit codes — admission unsupported_capability (3), parser (3), provider profile (2), claude grant / fail-closed runtime refusals (1), wait-only timeout (9), claim-gate failure, run/schedule regex mappings (3/7), jobs-stdio -32700/-32601/verbatim -32602 and the adapter-local exit 1 vs normalized 3 reproduce the 6192b13f oracles through the catalog with no catalog reason in any channel", async () => {
    const fx = fixtureKey("errors.json", "S24")
    // Enforces once runtime-route-catalog.ts exists (host options).
    const catalog = await productionCatalogState()
    const actual = await runRefusalSurfaces(fx.requests as JsonObject, {
      extra: { runtimeRouteCatalog: catalog },
    })
    const internal = (fx.internal as JsonObject)
      .unsupportedCapability as JsonObject
    leafPorts.reset()
    const direct = await runAgentTaskDirect(
      internal.input as unknown as Parameters<typeof runAgentTaskDirect>[0],
      { runtimeRouteCatalog: catalog },
    )
    const directLeafCalls = [...leafPorts.calls]
    const { normalizeHeadlessExitCode } = await import(
      "../src/main/lib/headless/job-runner"
    )
    const expected = renderRun(golden(fx.surfaces), actual.vars)
    expect({
      steps: actual.steps,
      leafCalls: actual.leafCalls,
      internalTextLeaks: internalTextLeaks(actual.steps),
      direct: { ...direct, leafCalls: directLeafCalls },
      normalizedExit: normalizeHeadlessExitCode({
        status: "failed",
        errorCode: "unsupported_capability",
      }),
    }).toEqual({
      steps: expected.steps,
      leafCalls: expected.leafCalls,
      internalTextLeaks: [],
      direct: internal.oracle,
      normalizedExit: internal.normalizedExit,
    })
  }, 60_000)

  test('S24 Refusals retain surface-specific errors and exit codes — an injected RuntimeRouteCatalogFailureState settles API create as the runner-level runtime_error/1 envelope with exactly "Runtime route catalog is unavailable." and zero leaf work, and runtimes list rejects with that message and no stdout', async () => {
    const fx = fixtureKey("errors.json", "S24")
    // Enforces once runtime-route-catalog.ts exists: the failure state is the
    // validator's own catalog_invalid result for a malformed declaration.
    const failure = await failureCatalogState()
    const actual = await runCatalogFailureCreate(fx.requests as JsonObject, {
      extra: { runtimeRouteCatalog: failure },
      leafThrow: false,
    })
    const expected = renderRun(golden(fx.catalogFailureOracle), actual.vars)
    const kit = await submitWaitKit()
    const profile = kit.createProfile()
    let listStdout = ""
    const listed = await settle(() =>
      kit.cli(profile, ["api", "runtimes", "list", "--json", "--no-probe"], {
        extra: {
          runtimeRouteCatalog: failure,
          runtimeReadinessDependencies: kit.READINESS_STUB,
        },
      }),
    ).finally(() => profile.cleanup())
    if (listed.fulfilled) listStdout = listed.value.stdout
    expect({
      steps: actual.steps,
      leafCalls: actual.leafCalls,
      selectionEvents: actual.eventPayloads.filter((line) =>
        /runtime_selected|catalog_invalid|route_not_found/.test(line),
      ),
      listRejected: listed.fulfilled ? null : listed.reason,
      listStdout,
    }).toEqual({
      steps: expected.steps,
      leafCalls: [],
      selectionEvents: [],
      listRejected: SANITIZED_CATALOG_MESSAGE,
      listStdout: "",
    })
  }, 60_000)

  test("S25 Artifact and ledger residuals are not bypassed by route availability — with an available route a win32 stable-directory refusal keeps the baseline failed/artifact_admission_failed bytes and an incomplete registered-file publication stays non-ready (9) with no event, file or settlement added by wait", async () => {
    const fx = fixtureKey("artifacts.json", "S25")
    // Enforces once runtime-route-catalog.ts exists (host options).
    const catalog = await productionCatalogState()
    const actual = await runArtifactResiduals(fx.requests as JsonObject, {
      extra: { runtimeRouteCatalog: catalog },
    })
    const expected = renderRun(golden(fx.golden), actual.vars)
    expect({
      steps: actual.steps,
      leafCalls: actual.leafCalls,
      observations: actual.observations,
    }).toEqual({
      steps: expected.steps,
      leafCalls: expected.leafCalls,
      observations: fx.observations,
    })
  }, 60_000)
})
