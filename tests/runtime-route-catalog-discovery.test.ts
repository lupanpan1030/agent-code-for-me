/**
 * Independent RED acceptance suite — refactor-unified-runtime-route-catalog,
 * public-guards domain, discovery/readiness: S22, S23
 * (openspec/changes/refactor-unified-runtime-route-catalog/specs/
 * local-job-api/spec.md:18-22, :36-69).
 *
 * Written test-first on base 19986552 (product source = 6192b13f). Discovery
 * runs through the real in-process `locus api runtimes list --json` with
 * recording readiness ports (no real probe or credential). The old schema
 * and old reader are frozen 6192b13f supporting fixtures
 * (discovery-schema-before.json, discovery-reader-before.ts); the new
 * schema is the published docs/local-job-api-v1.schema.json of the tree
 * under test.
 *
 * RED on the base: discovery output carries no `runtimes[].routes`, the
 * published schema has no route-summary definition and the catalog module
 * does not exist (lazy import, collected as an observation).
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import Ajv2020 from "ajv/dist/2020"
import addFormats from "ajv-formats"
import {
  DOCUMENTED_FEATURES_BEFORE,
  readDiscoveryBefore,
} from "./fixtures/runtime-route-catalog/discovery-reader-before"
import {
  CREATE_ARGS,
  FIXED_NOW_ISO,
  fixtureKey,
  installRecordingLeafPorts,
  type JsonObject,
  leafPorts,
  loadCatalogModule,
  REPO_ROOT,
  renderTemplate,
  SUBMIT_ARGS,
  settle,
  submitWaitKit,
} from "./runtime-route-catalog-guards-kit"

await installRecordingLeafPorts()

type Route = Record<string, unknown>
type Runtime = Record<string, unknown> & { runtimeId: string; routes?: Route[] }
type Envelope = { apiVersion: string; features: string[]; runtimes: Runtime[] }
type SchemaNode = Record<string, unknown>

const cleanups: Array<() => void> = []

beforeEach(async () => {
  setSystemTime(new Date(FIXED_NOW_ISO))
  leafPorts.reset()
  const readiness = await import("../src/main/lib/headless/runtime-readiness")
  readiness.clearRuntimeReadinessCacheForTest()
})

afterEach(() => {
  setSystemTime()
  leafPorts.reset()
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

function readJson(path: string): SchemaNode {
  return JSON.parse(readFileSync(path, "utf8")) as SchemaNode
}

function envelopeValidator(schema: SchemaNode) {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  addFormats(ajv)
  ajv.addSchema(schema, "local-job-api-v1")
  const validate = ajv.getSchema(
    "local-job-api-v1#/$defs/runtimeManifestEnvelope",
  )
  if (!validate) throw new Error("runtimeManifestEnvelope definition missing")
  return (value: unknown) => validate(value) === true
}

function resolvePointer(schema: SchemaNode, ref: unknown): unknown {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return undefined
  let node: unknown = schema
  for (const raw of ref.slice(2).split("/")) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~")
    node = (node as SchemaNode | undefined)?.[key]
  }
  return node
}

function withRoutes(
  envelope: Envelope,
  map: (route: Route, runtime: Runtime) => Route,
): Envelope {
  const copy = structuredClone(envelope)
  for (const runtime of copy.runtimes) {
    runtime.routes = (runtime.routes ?? []).map((route) => map(route, runtime))
  }
  return copy
}

function stripRoutes(envelope: Envelope): Envelope {
  const copy = structuredClone(envelope)
  for (const runtime of copy.runtimes) delete runtime.routes
  return copy
}

/** Neutral NEW reader: the old common core plus the optional routes block. */
function readDiscoveryAfter(envelope: unknown) {
  const body = envelope as Partial<Envelope>
  return {
    ...readDiscoveryBefore(envelope),
    routes: Object.fromEntries(
      (body.runtimes ?? []).map((runtime) => [
        runtime.runtimeId,
        Array.isArray(runtime.routes) ? runtime.routes.length : null,
      ]),
    ),
  }
}

function summaryOrder(a: Route, b: Route): number {
  return JSON.stringify([a.kind, a.executionProfile]).localeCompare(
    JSON.stringify([b.kind, b.executionProfile]),
  )
}

function withoutRouteId(route: Route): Route {
  const { routeId: _routeId, ...rest } = route
  return rest
}

async function recordingReadinessPorts() {
  const kit = await submitWaitKit()
  const calls: string[] = []
  const ports = Object.fromEntries(
    Object.entries(kit.READINESS_STUB).map(([name, port]) => [
      name,
      (...args: unknown[]) => {
        calls.push(name)
        return (port as (...input: unknown[]) => unknown)(...args)
      },
    ]),
  )
  return { ports, calls }
}

describe("discovery and readiness through the runtime route catalog", () => {
  test("S22 Old discovery readers safely ignore optional summaries — actual runtimes list carries experimental runtimes[].routes that both schemas accept, keep the old reader's common-core decisions (also under unknown open values), match the catalog's surface=api accepted combinations with exact keys, and the new schema rejects leaked internal fields and out-of-vocabulary kind/profile", async () => {
    const fx = fixtureKey("discovery.json", "S22")
    const kit = await submitWaitKit()
    const profile = kit.createProfile()
    cleanups.push(profile.cleanup)
    const readiness = await recordingReadinessPorts()
    const listed = await kit.cli(profile, fx.argv as string[], {
      extra: { runtimeReadinessDependencies: readiness.ports },
    })
    const actual = JSON.parse(listed.stdout) as Envelope
    const oldResponse = JSON.parse(String(fx.oldResponse)) as Envelope
    const schemaBeforeFile = (fx.supportFiles as Record<string, JsonObject>)
      .schemaBefore as Record<string, string>
    const schemaBeforeBytes = readFileSync(
      join(REPO_ROOT, schemaBeforeFile.path),
    )
    const schemaBefore = JSON.parse(String(schemaBeforeBytes)) as SchemaNode
    const schemaAfter = readJson(
      join(REPO_ROOT, "docs/local-job-api-v1.schema.json"),
    )
    const validBefore = envelopeValidator(schemaBefore)
    const validAfter = envelopeValidator(schemaAfter)
    const routeKeys = fx.routeKeys as string[]
    const extensionKeys = fx.extensionKeys as string[]
    const expectedSummaries = fx.expectedPublicSummaries as Record<
      string,
      Route[]
    >

    const routesByRuntime = Object.fromEntries(
      actual.runtimes.map((runtime) => [runtime.runtimeId, runtime.routes]),
    )
    const allRoutes = actual.runtimes.flatMap((runtime) => runtime.routes ?? [])
    const keyViolations = allRoutes.flatMap((route) => {
      const keys = Object.keys(route).sort()
      const extensions = Array.isArray(route.extensions) ? route.extensions : []
      return [
        ...(JSON.stringify(keys) === JSON.stringify(routeKeys)
          ? []
          : [`route keys ${keys.join(",")}`]),
        ...(typeof route.routeId === "string" && route.routeId.length > 0
          ? []
          : ["routeId not a non-empty string"]),
        ...extensions
          .map((extension) => Object.keys(extension as object).sort())
          .filter(
            (keysOfExtension) =>
              JSON.stringify(keysOfExtension) !== JSON.stringify(extensionKeys),
          )
          .map((keysOfExtension) => `extension keys ${keysOfExtension}`),
      ]
    })
    const summaries = Object.fromEntries(
      Object.entries(routesByRuntime).map(([runtimeId, routes]) => [
        runtimeId,
        Array.isArray(routes)
          ? routes.map(withoutRouteId).sort(summaryOrder)
          : null,
      ]),
    )
    const unknownValues = fx.unknownOpenValues as Record<string, string>
    const withUnknown = withRoutes(actual, (route) => ({
      ...route,
      ...unknownValues,
    }))
    const leaks = (fx.leakedFields as JsonObject[]).map((field) =>
      JSON.parse(
        renderTemplate(JSON.stringify(field), { REPO_ROOT: "/repo-root" }),
      ),
    )
    const leakVerdicts = leaks.map((field) => {
      const leaked = withRoutes(actual, (route) => ({ ...route, ...field }))
      return { before: validBefore(leaked), after: validAfter(leaked) }
    })
    const vocabularyVerdicts = (
      fx.closedVocabularyViolations as JsonObject[]
    ).map((field) =>
      validAfter(withRoutes(actual, (route) => ({ ...route, ...field }))),
    )
    const schemaRefResolution = allRoutes.flatMap((route) =>
      (Array.isArray(route.extensions) ? route.extensions : []).map(
        (extension) => {
          const ext = extension as Record<string, unknown>
          const def = resolvePointer(schemaAfter, ext.schemaRef) as
            | { properties?: Record<string, { const?: unknown }> }
            | undefined
          return {
            resolves: def !== undefined,
            schemaVersion: def?.properties?.schemaVersion?.const,
            maturity: def?.properties?.maturity?.const,
            declared: [ext.schemaVersion, ext.maturity],
          }
        },
      ),
    )
    const ledgerSource = readFileSync(
      join(REPO_ROOT, "src/main/lib/agent-runtime/run-event-ledger.ts"),
      "utf8",
    )
    // Enforces once runtime-route-catalog.ts exists: every public summary
    // is the catalog's own resolution of its (runtime, api, kind, profile).
    const catalogAgreement = await settle(async () => {
      const catalog = await loadCatalogModule()
      const policy = await import(
        "../src/main/lib/agent-runtime/permission-policy"
      )
      return Object.entries(routesByRuntime).flatMap(([runtimeId, routes]) =>
        (routes ?? []).map((route) => {
          const agent = route.kind === "agent"
          const resolved = catalog.resolveRuntimeRoute({
            runtimeId,
            entry: "api",
            requiredCapabilities: [],
            requiredExtensions: [],
            kind: route.kind,
            mode: agent ? fx.routeQueryMode : null,
            executionProfile: agent ? route.executionProfile : null,
            permissionPolicy: agent
              ? policy.resolveNonDesktopPermissionPolicy({
                  source: "api",
                  mode: "plan",
                  executionProfile: route.executionProfile as "batch",
                  policyGrant:
                    route.executionProfile === "policy-grant"
                      ? { scopes: fx.policyGrantScopes as string[] }
                      : null,
                })
              : null,
          }) as Record<string, unknown>
          return {
            ok: resolved.ok,
            sameRouteId: resolved.routeId === route.routeId,
            sameAdapterSource: resolved.adapterSource === route.adapterSource,
          }
        }),
      )
    })

    expect({
      schemaBeforeSha256: createHash("sha256")
        .update(schemaBeforeBytes)
        .digest("hex"),
      exit: listed.code,
      features: actual.features,
      routesPresent: Object.fromEntries(
        actual.runtimes.map((runtime) => [
          runtime.runtimeId,
          Array.isArray(runtime.routes),
        ]),
      ),
      summaries,
      keyViolations,
      routeIdsUnique:
        new Set(allRoutes.map((route) => route.routeId)).size ===
        allRoutes.length,
      bothSchemasAccept: [validBefore(actual), validAfter(actual)],
      oldReaderSameDecisions:
        JSON.stringify(readDiscoveryBefore(actual)) ===
          JSON.stringify(readDiscoveryBefore(stripRoutes(actual))) &&
        JSON.stringify(readDiscoveryBefore(actual)) ===
          JSON.stringify(readDiscoveryBefore(oldResponse)),
      unknownValues: {
        oldReaderSame:
          JSON.stringify(readDiscoveryBefore(withUnknown)) ===
          JSON.stringify(readDiscoveryBefore(actual)),
        schemas: [validBefore(withUnknown), validAfter(withUnknown)],
      },
      newReaderOnOldResponse: readDiscoveryAfter(oldResponse),
      oldResponseValidAfter: validAfter(oldResponse),
      leakVerdicts,
      vocabularyVerdicts,
      schemaRefResolution,
      producerDeclares: [
        ledgerSource.includes('"runtime.codex.v1"'),
        ledgerSource.includes('maturity: "experimental"'),
        ledgerSource.includes("schemaVersion: 1"),
      ],
      catalogAgreement: catalogAgreement.fulfilled
        ? catalogAgreement.value
        : catalogAgreement.reason,
    }).toEqual({
      schemaBeforeSha256: schemaBeforeFile.sha256,
      exit: 0,
      features: fx.features,
      routesPresent: { "claude-code": true, codex: true },
      summaries: Object.fromEntries(
        Object.entries(expectedSummaries).map(([runtimeId, routes]) => [
          runtimeId,
          [...routes].sort(summaryOrder),
        ]),
      ),
      keyViolations: [],
      routeIdsUnique: true,
      bothSchemasAccept: [true, true],
      oldReaderSameDecisions: true,
      unknownValues: { oldReaderSame: true, schemas: [true, true] },
      newReaderOnOldResponse: {
        ...readDiscoveryBefore(oldResponse),
        routes: { "claude-code": null, codex: null },
      },
      oldResponseValidAfter: true,
      leakVerdicts: leaks.map(() => ({ before: true, after: false })),
      vocabularyVerdicts: [false, false],
      schemaRefResolution: [
        {
          resolves: true,
          schemaVersion: 1,
          maturity: "experimental",
          declared: [1, "experimental"],
        },
      ],
      producerDeclares: [true, true, true],
      catalogAgreement: Object.values(expectedSummaries)
        .flat()
        .map(() => ({ ok: true, sameRouteId: true, sameAdapterSource: true })),
    })
    expect(
      DOCUMENTED_FEATURES_BEFORE.every(
        (feature) => readDiscoveryAfter(oldResponse).features[feature],
      ),
    ).toBe(true)
  }, 60_000)

  test("S23 Readiness does not claim a different executor environment — no-probe discovery performs no native probe and keeps the baseline readiness bytes beside routes that carry no environment, while a daemon-claimed API Run and a no-daemon wrapper Run each execute under their own command without persisting any submitter/daemon/wrapper environment value", async () => {
    const fx = fixtureKey("readiness.json", "S23")
    const env = fx.env as Record<string, Record<string, string>>
    const requests = fx.requests as JsonObject
    const kit = await submitWaitKit()
    const profile = kit.createProfile()
    cleanups.push(profile.cleanup)
    const readiness = await recordingReadinessPorts()
    const listed = await kit.cli(profile, fx.argv as string[], {
      extra: {
        env: env.submitter,
        runtimeReadinessDependencies: readiness.ports,
      },
    })
    const discovery = JSON.parse(listed.stdout) as Envelope
    const routeMetadata = JSON.stringify(
      discovery.runtimes.map((runtime) => runtime.routes ?? null),
    )
    const forbiddenKeys = (fx.forbiddenRouteMetadataKeys as string[]).filter(
      (key) => routeMetadata.includes(`"${key}"`),
    )
    const body = (name: string) =>
      renderTemplate(JSON.stringify(requests[name]), {
        PACKAGE_DIR: profile.packageDir,
      })

    await kit.cli(profile, SUBMIT_ARGS, {
      stdin: body("codexBatchSubmit"),
      extra: { env: env.submitter },
    })
    const callsBeforeDaemon = leafPorts.calls.length
    const daemon = await kit.cli(
      profile,
      ["daemon", "run", "--once", "--poll-interval-ms", "100"],
      { extra: { env: env.daemon } },
    )
    const daemonLeafCalls = leafPorts.calls.length - callsBeforeDaemon
    const wrapper = await kit.cli(profile, CREATE_ARGS, {
      stdin: body("codexBatch"),
      extra: { env: env.wrapper },
    })
    const persisted = JSON.stringify([
      profile.sqlite.query("SELECT * FROM agent_jobs").all(),
      profile.sqlite.query("SELECT * FROM agent_job_events").all(),
    ])
    const marker = String(fx.sentinelMarker)
    // Enforces once runtime-route-catalog.ts exists: catalog route metadata
    // (all routes, public projection) never carries environment values.
    const catalogMetadata = await settle(async () => {
      const catalog = await loadCatalogModule()
      return JSON.stringify([
        catalog.listRuntimeRoutes({}),
        catalog.projectRuntimeRoutes("public"),
      ])
    })

    expect({
      exit: listed.code,
      nativeProbeCalls: readiness.calls.filter(
        (name) => name === fx.nativeProbePort,
      ).length,
      portCalls: readiness.calls,
      readinessBytes: JSON.stringify(stripRoutes(discovery)),
      readinessStates: discovery.runtimes.map((runtime) => [
        runtime.runtimeId,
        (runtime.readiness as { state?: string }).state,
      ]),
      routesPresent: discovery.runtimes.every((runtime) =>
        Array.isArray(runtime.routes),
      ),
      routeMetadataSentinels: routeMetadata.includes(marker),
      forbiddenKeys,
      daemon: { exit: daemon.code, leafCalls: daemonLeafCalls },
      wrapper: { exit: wrapper.code },
      leafCallJobs: leafPorts.calls.length,
      persistedSentinels: persisted.includes(marker),
      catalogMetadata: catalogMetadata.fulfilled
        ? catalogMetadata.value.includes(marker)
        : catalogMetadata.reason,
    }).toEqual({
      exit: 0,
      nativeProbeCalls: 0,
      portCalls: fx.noProbePortCalls,
      readinessBytes: JSON.stringify(JSON.parse(String(fx.baselineDiscovery))),
      readinessStates: [
        ["claude-code", "needs-auth"],
        ["codex", "unknown"],
      ],
      routesPresent: true,
      routeMetadataSentinels: false,
      forbiddenKeys: [],
      daemon: { exit: 0, leafCalls: 1 },
      wrapper: { exit: 0 },
      leafCallJobs: 2,
      persistedSentinels: false,
      catalogMetadata: false,
    })
  }, 60_000)
})
