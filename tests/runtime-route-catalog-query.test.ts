/**
 * Independent red suite — refactor-unified-runtime-route-catalog, catalog-core
 * domain: declarative validation, pure queries, refusals and registration
 * (S01, S02, S06, S33, S46). See tests/runtime-route-catalog-core-kit.ts.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test"
import { realpathSync } from "node:fs"
import { join } from "node:path"
import {
  type AgentRuntimeCapabilityId,
  CONTRACT_RUNTIME_IDS,
  getAgentRuntimeCapabilityManifest,
  resolveAgentRuntimeCapabilityManifest,
} from "../src/shared/agent-runtime-capabilities"
import { createMigratedLedgerDb } from "./run-event-ledger-domain-b-kit"
import {
  type AgentQueryInput,
  agentQuery,
  asArray,
  asRecord,
  baseDeclarationFixture,
  buildTestCatalog,
  CATALOG_UNAVAILABLE_MESSAGE,
  type CatalogModule,
  claudeHostInput,
  codexHostOptions,
  createReferencePorts,
  type DeclarationMutation,
  desktopFaultMessages,
  desktopRunRequest,
  emptyEmissions,
  FIXED_NOW_ISO,
  fixtureKey,
  functionPaths,
  isRecord,
  type Loose,
  mutateDeclarations,
  READINESS_DEPENDENCIES_STUB,
  recordingLedger,
  refusingSpawn,
  rejectionMessage,
  renderPlaceholders,
  requireCatalogModule,
  requireCodexDesktopChatRun,
  runCli,
  serializeWithFunctions,
  settledResult,
  sortedKeys,
} from "./runtime-route-catalog-core-kit"

// Safety net at the process I/O end (design D1): a real child process must
// never start, even if a future host forwarding bug reached a real leaf.
const realSpawnAttempts: string[] = []
const processRunner = await import("../src/main/lib/headless/process-runner")
const realRunProcessAgentTask = processRunner.runProcessAgentTask
mock.module("../src/main/lib/headless/process-runner", () => ({
  ...processRunner,
  runProcessAgentTask: (input: Parameters<typeof realRunProcessAgentTask>[0]) =>
    realRunProcessAgentTask({
      ...input,
      spawnProcess: (input.spawnProcess ??
        refusingSpawn(realSpawnAttempts)) as typeof input.spawnProcess,
    }),
}))

const cleanups: Array<() => void> = []
beforeEach(() => {
  // Deterministic wall clock for every row timestamp the hosts write.
  setSystemTime(new Date(FIXED_NOW_ISO))
})
afterEach(() => {
  setSystemTime()
  while (cleanups.length > 0) cleanups.pop()?.()
})

function migratedProfile() {
  const mdb = createMigratedLedgerDb()
  const projectRoot = realpathSync(mdb.dir)
  mdb.sqlite
    .query("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)")
    .run("project-1", "Route catalog fixture", projectRoot)
  cleanups.push(() => mdb.close())
  return { mdb, projectRoot, lockPath: join(mdb.dir, "locus-daemon.lock") }
}

function validatorVerdict(value: unknown): {
  ok: unknown
  reason: unknown
  hasCatalog: boolean
  offending: unknown
} {
  const record = asRecord(value)
  return {
    ok: record.ok,
    reason: record.reason ?? null,
    hasCatalog: record.catalog !== undefined && record.catalog !== null,
    offending: record.offending ?? null,
  }
}

function resolveSummary(value: unknown): Loose {
  const record = asRecord(value)
  return {
    ok: record.ok,
    reason: record.reason ?? null,
    routeId: record.routeId ?? null,
    adapterSource: record.adapterSource ?? null,
    executionSurface: record.executionSurface ?? null,
    delegateType: typeof record.delegate,
  }
}

function zeroCalls(log: {
  invocations: unknown[]
  probeCalls: unknown[]
}): Loose {
  return {
    delegateInvocations: log.invocations.length,
    probeInvocations: log.probeCalls.length,
  }
}

describe("runtime route catalog — validation and pure queries", () => {
  test("S01 Invalid declarations cannot become executable — validator accepts production/valid/completion-null-probe tables, rejects every invalid variant with catalog_invalid, and the test constructor returns that same non-executable failure state without factory/probe calls", async () => {
    const catalog = await requireCatalogModule()
    const s01 = fixtureKey("catalog.json", "S01")
    const { declarations, ports } = baseDeclarationFixture()
    const recording = createReferencePorts(ports)
    const probeQuery = asRecord(s01.probeQuery)

    const production = validatorVerdict(catalog.validateRuntimeRouteCatalog())

    const valid = asArray(s01.validVariants).map((entry) => {
      const variant = asRecord(entry)
      const table = mutateDeclarations(
        declarations,
        asArray(variant.mutations) as DeclarationMutation[],
      )
      const verdict = validatorVerdict(
        catalog.validateRuntimeRouteCatalog(table, recording.references),
      )
      const state = buildTestCatalog(catalog, table, recording)
      const resolved = resolveSummary(
        catalog.resolveRuntimeRoute(
          agentQuery(probeQuery as unknown as AgentQueryInput),
          state,
        ),
      )
      return {
        variantId: variant.variantId,
        ok: verdict.ok,
        hasCatalog: verdict.hasCatalog,
        resolvedRouteId: resolved.routeId,
      }
    })

    const invalid = await Promise.all(
      asArray(s01.invalidVariants).map(async (entry) => {
        const variant = asRecord(entry)
        const table = mutateDeclarations(
          declarations,
          asArray(variant.mutations) as DeclarationMutation[],
        )
        const verdictValue = catalog.validateRuntimeRouteCatalog(
          table,
          recording.references,
        )
        const verdict = validatorVerdict(verdictValue)
        const constructed = await settledResult(() =>
          catalog.createRuntimeRouteCatalogForTests(
            table,
            recording.references,
          ),
        )
        const resolved = constructed.fulfilled
          ? resolveSummary(
              catalog.resolveRuntimeRoute(
                agentQuery(probeQuery as unknown as AgentQueryInput),
                constructed.value,
              ),
            )
          : null
        return {
          variantId: variant.variantId,
          ok: verdict.ok,
          reason: verdict.reason,
          hasCatalog: verdict.hasCatalog,
          offendingIsObject: isRecord(verdict.offending),
          offendingNamesVariant: asArray(variant.offendingAnyOf).some((name) =>
            JSON.stringify(verdict.offending).includes(String(name)),
          ),
          constructorThrew: !constructed.fulfilled,
          constructorEqualsValidatorFailure:
            constructed.fulfilled &&
            JSON.stringify(constructed.value) === JSON.stringify(verdictValue),
          resolvedReason: resolved?.reason ?? null,
          resolvedDelegateType: resolved?.delegateType ?? null,
        }
      }),
    )

    expect(production).toMatchObject({
      ok: true,
      reason: null,
      hasCatalog: true,
    })
    expect(valid).toEqual(
      asArray(s01.validVariants).map((entry) => ({
        variantId: asRecord(entry).variantId,
        ok: true,
        hasCatalog: true,
        resolvedRouteId: probeQuery.expectRouteId,
      })),
    )
    expect(invalid).toEqual(
      asArray(s01.invalidVariants).map((entry) => ({
        variantId: asRecord(entry).variantId,
        ok: false,
        reason: "catalog_invalid",
        hasCatalog: false,
        offendingIsObject: true,
        offendingNamesVariant: true,
        constructorThrew: false,
        constructorEqualsValidatorFailure: true,
        resolvedReason: "catalog_invalid",
        resolvedDelegateType: "undefined",
      })),
    )
    expect(zeroCalls(recording.log)).toEqual({
      delegateInvocations: 0,
      probeInvocations: 0,
    })
    expect(realSpawnAttempts).toEqual([])
  })

  test("S01 Invalid declarations cannot become executable — an injected failure state makes resolve return catalog_invalid, list/projection reject without partial output, and both discovery CLI forms reject with exactly the sanitized message and empty stdout", async () => {
    const catalog = await requireCatalogModule()
    const s01 = fixtureKey("catalog.json", "S01")
    const { declarations, ports } = baseDeclarationFixture()
    const recording = createReferencePorts(ports)
    const invalidVariant = asRecord(asArray(s01.invalidVariants)[0])
    const failureState = buildTestCatalog(
      catalog,
      mutateDeclarations(
        declarations,
        asArray(invalidVariant.mutations) as DeclarationMutation[],
      ),
      recording,
    )
    const resolved = asRecord(
      catalog.resolveRuntimeRoute(
        agentQuery(asRecord(s01.probeQuery) as unknown as AgentQueryInput),
        failureState,
      ),
    )
    const listed = await settledResult(() =>
      catalog.listRuntimeRoutes({}, failureState),
    )
    const projectedPublic = await settledResult(() =>
      catalog.projectRuntimeRoutes("public", failureState),
    )
    const projectedRenderer = await settledResult(() =>
      catalog.projectRuntimeRoutes("renderer", failureState),
    )
    const { toLocalJobApiRuntimeManifestEnvelope } = await import(
      "../src/main/lib/headless/local-job-api"
    )
    const profile = migratedProfile()
    const envelope = await settledResult(() =>
      toLocalJobApiRuntimeManifestEnvelope({
        db: profile.mdb.db,
        probe: false,
        runtimeRouteCatalog: failureState,
      } as unknown as Parameters<
        typeof toLocalJobApiRuntimeManifestEnvelope
      >[0]),
    )
    const discovery = []
    for (const args of [
      ["api", "runtimes", "list", "--json"],
      ["api", "runtimes", "list", "--json", "--no-probe"],
    ]) {
      const outcome = await runCli({
        db: profile.mdb.db,
        args,
        lockPath: profile.lockPath,
        extra: {
          runtimeRouteCatalog: failureState,
          runtimeReadinessDependencies: READINESS_DEPENDENCIES_STUB,
        },
      })
      discovery.push({
        args: args.join(" "),
        settled: outcome.settled,
        rejection: outcome.rejection,
        stdout: outcome.stdout,
      })
    }

    expect({ ok: resolved.ok, reason: resolved.reason }).toEqual({
      ok: false,
      reason: "catalog_invalid",
    })
    expect(typeof resolved.delegate).toBe("undefined")
    expect({
      list: listed.fulfilled,
      public: projectedPublic.fulfilled,
      renderer: projectedRenderer.fulfilled,
      envelope: envelope.fulfilled,
      envelopeMessage: rejectionMessage(envelope.reason),
    }).toEqual({
      list: false,
      public: false,
      renderer: false,
      envelope: false,
      envelopeMessage: CATALOG_UNAVAILABLE_MESSAGE,
    })
    expect(discovery).toEqual([
      {
        args: "api runtimes list --json",
        settled: "rejected",
        rejection: CATALOG_UNAVAILABLE_MESSAGE,
        stdout: "",
      },
      {
        args: "api runtimes list --json --no-probe",
        settled: "rejected",
        rejection: CATALOG_UNAVAILABLE_MESSAGE,
        stdout: "",
      },
    ])
    expect(zeroCalls(recording.log)).toEqual({
      delegateInvocations: 0,
      probeInvocations: 0,
    })
  })

  test("S01 Invalid declarations cannot become executable — a run command meeting the injected failure state settles runtime_error with exit 1 and the sanitized message instead of rejecting", async () => {
    const catalog = await requireCatalogModule()
    const s01 = fixtureKey("catalog.json", "S01")
    const { declarations, ports } = baseDeclarationFixture()
    const recording = createReferencePorts(ports)
    const failureState = buildTestCatalog(
      catalog,
      mutateDeclarations(
        declarations,
        asArray(
          asRecord(asArray(s01.invalidVariants)[2]).mutations,
        ) as DeclarationMutation[],
      ),
      recording,
    )
    const profile = migratedProfile()
    const outcome = await runCli({
      db: profile.mdb.db,
      args: [
        "run",
        "--cwd",
        profile.projectRoot,
        "--runtime",
        "codex",
        "--prompt",
        "Route catalog failure-state fixture.",
        "--output",
        "json",
      ],
      lockPath: profile.lockPath,
      extra: {
        runtimeRouteCatalog: failureState,
        providerBindingDependencies: {
          getProviderDefaultRuntimeConfig: () => null,
        },
      },
    })
    const jobs = profile.mdb.sqlite
      .query(
        "SELECT status, error_code, error_message, exit_code FROM agent_jobs",
      )
      .all()
    const eventPayloads = profile.mdb.sqlite
      .query("SELECT type, payload_json FROM agent_job_events")
      .all()
      .map((row) => JSON.stringify(row))
      .join("\n")

    expect({ settled: outcome.settled, code: outcome.code }).toEqual({
      settled: "fulfilled",
      code: 1,
    })
    expect(jobs).toEqual([
      {
        status: "failed",
        error_code: "runtime_error",
        error_message: CATALOG_UNAVAILABLE_MESSAGE,
        exit_code: 1,
      },
    ])
    expect(eventPayloads).not.toContain("catalog_invalid")
    expect(eventPayloads).not.toContain("runtime_selected")
    expect(zeroCalls(recording.log)).toEqual({
      delegateInvocations: 0,
      probeInvocations: 0,
    })
    expect(realSpawnAttempts).toEqual([])
  })

  test("S01 Invalid declarations cannot become executable — both named desktop hosts given the failure state surface only the sanitized message through their existing error channel and call no delegate or native SDK", async () => {
    const catalog = await requireCatalogModule()
    const runCodexDesktopChatRun = await requireCodexDesktopChatRun()
    const { runClaudeAgentSdkDesktopRuntimeWithMcpReadiness } = await import(
      "../src/main/lib/claude/agent-sdk-desktop-run-runtime"
    )
    const s01 = fixtureKey("catalog.json", "S01")
    const { declarations, ports } = baseDeclarationFixture()
    const recording = createReferencePorts(ports)
    const failureState = buildTestCatalog(
      catalog,
      mutateDeclarations(
        declarations,
        asArray(
          asRecord(asArray(s01.invalidVariants)[5]).mutations,
        ) as DeclarationMutation[],
      ),
      recording,
    )
    const profile = migratedProfile()

    const claudeEmissions = emptyEmissions()
    const nativeQueryCalls: unknown[] = []
    const claudeLedger = recordingLedger()
    const claudeInput = await claudeHostInput({
      request: desktopRunRequest({
        runtimeId: "claude-code",
        mode: "agent",
        cwd: profile.projectRoot,
        signal: new AbortController().signal,
        ledger: claudeLedger.ledger,
        session: {},
      }),
      nativeQueryCalls,
      emissions: claudeEmissions,
      db: profile.mdb.db,
      runtimeRouteCatalog: failureState,
      oauthToken: "nonsecret-sentinel-oauth-s01",
    })
    const claude = await settledResult(() =>
      runClaudeAgentSdkDesktopRuntimeWithMcpReadiness(
        claudeInput as unknown as Parameters<
          typeof runClaudeAgentSdkDesktopRuntimeWithMcpReadiness
        >[0],
      ),
    )

    const codexEmissions = emptyEmissions()
    const codexLedger = recordingLedger()
    const codex = await settledResult(() =>
      runCodexDesktopChatRun(
        codexHostOptions({
          request: desktopRunRequest({
            runtimeId: "codex",
            mode: "agent",
            cwd: profile.projectRoot,
            signal: new AbortController().signal,
            ledger: codexLedger.ledger,
            session: {},
          }),
          emissions: codexEmissions,
          runtimeRouteCatalog: failureState,
          providerGatewayToken: null,
          appManagedApiKey: "nonsecret-sentinel-app-key-s01",
        }),
      ),
    )

    const claudeMessages = desktopFaultMessages(claude, claudeEmissions)
    const codexMessages = desktopFaultMessages(codex, codexEmissions)
    expect({
      claudeCarriesMessage: claudeMessages.includes(
        CATALOG_UNAVAILABLE_MESSAGE,
      ),
      codexCarriesMessage: codexMessages.includes(CATALOG_UNAVAILABLE_MESSAGE),
      internalReasonLeaked: JSON.stringify([
        claudeMessages,
        codexMessages,
        claudeEmissions,
        codexEmissions,
      ]).includes("catalog_invalid"),
      nativeQueryCalls: nativeQueryCalls.length,
      ...zeroCalls(recording.log),
    }).toEqual({
      claudeCarriesMessage: true,
      codexCarriesMessage: true,
      internalReasonLeaked: false,
      nativeQueryCalls: 0,
      delegateInvocations: 0,
      probeInvocations: 0,
    })
  })

  test("S02 Query and enumeration are deterministic and side-effect free — permuted declarations and duplicate capability requests resolve the same route, enumeration keeps a stable routeId order, caller mutation cannot change a later query, and recording ports stay uncalled", async () => {
    const catalog = await requireCatalogModule()
    const s02 = fixtureKey("catalog.json", "S02")
    const { declarations, ports } = baseDeclarationFixture()
    const reversed = [...declarations].reverse().map((runtime) => ({
      ...runtime,
      routes: [...asArray(runtime.routes)].reverse(),
    }))
    const recordingA = createReferencePorts(ports)
    const recordingB = createReferencePorts(ports)
    const tableA = buildTestCatalog(catalog, declarations, recordingA)
    const tableB = buildTestCatalog(catalog, reversed, recordingB)

    const resolutions = asArray(s02.queries).map((entry) => {
      const item = asRecord(entry)
      const a = asRecord(
        catalog.resolveRuntimeRoute(
          agentQuery(item.a as unknown as AgentQueryInput),
          tableA,
        ),
      )
      const b = asRecord(
        catalog.resolveRuntimeRoute(
          agentQuery(item.b as unknown as AgentQueryInput),
          tableB,
        ),
      )
      const expected = asRecord(item.expect)
      return {
        queryId: item.queryId,
        a: resolveSummary(a),
        b: resolveSummary(b),
        aDelegateIsDeclared:
          a.delegate === recordingA.delegates[String(expected.factoryRef)],
        bDelegateIsDeclared:
          b.delegate === recordingB.delegates[String(expected.factoryRef)],
      }
    })
    const routeIdsA = asArray(catalog.listRuntimeRoutes({}, tableA)).map(
      (descriptor) => asRecord(descriptor).routeId,
    )
    const routeIdsB = asArray(catalog.listRuntimeRoutes({}, tableB)).map(
      (descriptor) => asRecord(descriptor).routeId,
    )

    const mutation = asRecord(s02.mutationAttempt)
    const firstQuery = agentQuery(
      asRecord(asArray(s02.queries)[0]).a as unknown as AgentQueryInput,
    )
    const before = resolveSummary(
      catalog.resolveRuntimeRoute(firstQuery, tableA),
    )
    const listedOnce = asArray(catalog.listRuntimeRoutes({}, tableA))
    const resolvedOnce = catalog.resolveRuntimeRoute(firstQuery, tableA)
    await settledResult(() => {
      asRecord(listedOnce[0])[String(mutation.field)] = mutation.value
    })
    await settledResult(() => {
      asRecord(resolvedOnce)[String(mutation.field)] = mutation.value
    })
    await settledResult(() => {
      listedOnce.splice(0, listedOnce.length)
    })
    const after = resolveSummary(
      catalog.resolveRuntimeRoute(firstQuery, tableA),
    )
    const relisted = asArray(catalog.listRuntimeRoutes({}, tableA)).map(
      (descriptor) => asRecord(descriptor).routeId,
    )
    const relistedSources = asArray(catalog.listRuntimeRoutes({}, tableA)).map(
      (descriptor) => asRecord(descriptor).adapterSource,
    )

    expect(resolutions).toEqual(
      asArray(s02.queries).map((entry) => {
        const item = asRecord(entry)
        const expected = asRecord(item.expect)
        const summary = {
          ok: true,
          reason: null,
          routeId: expected.routeId,
          adapterSource: expected.adapterSource,
          executionSurface: expected.executionSurface,
          delegateType: "function",
        }
        return {
          queryId: item.queryId,
          a: summary,
          b: summary,
          aDelegateIsDeclared: true,
          bDelegateIsDeclared: true,
        }
      }),
    )
    expect(routeIdsA).toEqual(asArray(s02.expectedRouteIdOrder))
    expect(routeIdsB).toEqual(routeIdsA)
    expect(after).toEqual(before)
    expect(relisted).toEqual(routeIdsA)
    expect(relistedSources).not.toContain(mutation.value)
    expect({
      a: zeroCalls(recordingA.log),
      b: zeroCalls(recordingB.log),
    }).toEqual({
      a: { delegateInvocations: 0, probeInvocations: 0 },
      b: { delegateInvocations: 0, probeInvocations: 0 },
    })
  })

  test("S06 Missing routes and invalid catalogs have distinct oracles — an overlapping table fails only at validation, while unknown, retired, missing-entry and illegal kind/mode queries return route_not_found with no delegate, no ambiguity result and no calls", async () => {
    const catalog = await requireCatalogModule()
    const s06 = fixtureKey("refusals.json", "S06")
    const { declarations, ports } = baseDeclarationFixture()
    const recording = createReferencePorts(ports)
    const overlap = asRecord(s06.overlappingTable)
    const overlapVerdict = validatorVerdict(
      catalog.validateRuntimeRouteCatalog(
        mutateDeclarations(
          declarations,
          asArray(overlap.mutations) as DeclarationMutation[],
        ),
        recording.references,
      ),
    )
    const state = buildTestCatalog(catalog, declarations, recording)
    const template = asRecord(s06.runtimeQueryTemplate)
    const runtimeCases = [
      ...asArray(s06.unknownRuntimeIds),
      ...asArray(s06.retiredRuntimeIds),
    ].map((runtimeId) => ({
      caseId: `runtime:${String(runtimeId)}`,
      query: agentQuery({
        ...(template as unknown as AgentQueryInput),
        runtimeId: String(runtimeId),
      }),
    }))
    const shapeCases = asArray(s06.routeNotFound).map((entry) => {
      const item = asRecord(entry)
      return {
        caseId: String(item.caseId),
        query: isRecord(item.query)
          ? item.query
          : agentQuery(item.agent as unknown as AgentQueryInput),
      }
    })
    const outcomes = [...runtimeCases, ...shapeCases].map(
      ({ caseId, query }) => {
        const result = asRecord(catalog.resolveRuntimeRoute(query, state))
        return {
          caseId,
          ok: result.ok,
          reason: result.reason,
          hasDelegate:
            result.delegate !== undefined && result.delegate !== null,
          candidateAdapterSource: caseId.startsWith("runtime:")
            ? (result.candidateAdapterSource ?? null)
            : "n/a",
        }
      },
    )
    const controls = asArray(s06.controls).map((entry) => {
      const item = asRecord(entry)
      const result = asRecord(
        catalog.resolveRuntimeRoute(
          agentQuery(item.agent as unknown as AgentQueryInput),
          state,
        ),
      )
      return {
        caseId: item.caseId,
        ok: result.ok,
        reason: result.reason ?? null,
        adapterSource: result.adapterSource ?? null,
      }
    })
    const serialized = serializeWithFunctions(
      [...runtimeCases, ...shapeCases].map(({ query }) =>
        catalog.resolveRuntimeRoute(query, state),
      ),
    )

    expect(overlapVerdict).toMatchObject({
      ok: false,
      reason: "catalog_invalid",
      hasCatalog: false,
    })
    expect(
      asArray(overlap.offendingAnyOf).some((name) =>
        JSON.stringify(overlapVerdict.offending).includes(String(name)),
      ),
    ).toBe(true)
    expect(outcomes).toEqual(
      [...runtimeCases, ...shapeCases].map(({ caseId }) => ({
        caseId,
        ok: false,
        reason: "route_not_found",
        hasDelegate: false,
        candidateAdapterSource: caseId.startsWith("runtime:") ? null : "n/a",
      })),
    )
    expect(controls).toEqual(
      asArray(s06.controls).map((entry) => ({
        caseId: asRecord(entry).caseId,
        ...asRecord(asRecord(entry).expect),
      })),
    )
    for (const forbidden of asArray(s06.forbiddenReasons)) {
      expect(serialized).not.toContain(String(forbidden))
    }
    expect(zeroCalls(recording.log)).toEqual({
      delegateInvocations: 0,
      probeInvocations: 0,
    })
  })

  test("S33 Runtime is registered — the real production declarations validate, each supported runtime declares id, display metadata, shared-owner manifest, run entry point, cancellation and session reference, a duplicate runtime is rejected, and the renderer projection is non-secret", async () => {
    const catalog = await requireCatalogModule()
    const s33 = fixtureKey("catalog.json", "S33")
    const production = validatorVerdict(catalog.validateRuntimeRouteCatalog())
    const descriptors = asArray(catalog.listRuntimeRoutes({})).map(asRecord)
    const runtimes = [
      ...new Set(descriptors.map((descriptor) => descriptor.runtimeId)),
    ].sort()
    const perRuntime = asArray(s33.productionRuntimes).map((runtimeIdValue) => {
      const runtimeId = String(runtimeIdValue) as "claude-code" | "codex"
      const own = descriptors.filter(
        (descriptor) => descriptor.runtimeId === runtimeId,
      )
      const entries = [
        ...new Set(own.flatMap((descriptor) => asArray(descriptor.entries))),
      ]
      const desktop = asRecord(
        catalog.resolveRuntimeRoute({
          runtimeId,
          entry: "desktop",
          kind: "agent",
          mode: "agent",
          executionProfile: "interactive",
          requiredCapabilities: [],
          requiredExtensions: [],
          permissionPolicy: agentQuery({
            runtimeId,
            entry: "desktop",
            mode: "agent",
            executionProfile: "interactive",
            source: "desktop",
            hasVisibleUserInteractionChannel: true,
          }).permissionPolicy,
        }),
      )
      const headless = asRecord(
        catalog.resolveRuntimeRoute(
          agentQuery({
            runtimeId,
            entry: "headless",
            mode: "agent",
            executionProfile: "batch",
            source: "cli",
          }),
        ),
      )
      return {
        runtimeId,
        hasDescriptors: own.length > 0,
        runtimeLabels: [...new Set(own.map((d) => d.runtimeLabel))],
        manifestsFromSharedOwner: [
          ...new Set(
            own.map((d) =>
              typeof d.manifestRef === "string" &&
              resolveAgentRuntimeCapabilityManifest(d.manifestRef).ok
                ? JSON.stringify(
                    getAgentRuntimeCapabilityManifest(
                      d.manifestRef as "claude-code" | "codex",
                    ),
                  )
                : `unresolvable:${String(d.manifestRef)}`,
            ),
          ),
        ],
        cancellationDeclared: own.every(
          (d) => typeof d.cancellation === "string" && d.cancellation !== "",
        ),
        sessionReferenceDeclared: own.every(
          (d) =>
            typeof d.sessionReference === "string" && d.sessionReference !== "",
        ),
        coversRequiredEntries: asArray(
          asRecord(s33.requiredEntries)[runtimeId],
        ).every((entry) => entries.includes(entry)),
        desktopEntryPoint: typeof desktop.delegate,
        headlessEntryPoint: typeof headless.delegate,
      }
    })
    const duplicate = asRecord(s33.duplicateRuntimeVariant)
    const { declarations, ports } = baseDeclarationFixture()
    const duplicateVerdict = validatorVerdict(
      catalog.validateRuntimeRouteCatalog(
        mutateDeclarations(
          declarations,
          asArray(duplicate.mutations) as DeclarationMutation[],
        ),
        createReferencePorts(ports).references,
      ),
    )
    const renderer = asArray(catalog.projectRuntimeRoutes("renderer"))
    const rendererText = serializeWithFunctions(renderer)

    expect(production).toMatchObject({ ok: true, hasCatalog: true })
    expect(runtimes).toEqual([...CONTRACT_RUNTIME_IDS].sort())
    expect(perRuntime).toEqual(
      asArray(s33.productionRuntimes).map((runtimeIdValue) => {
        const runtimeId = String(runtimeIdValue) as "claude-code" | "codex"
        return {
          runtimeId,
          hasDescriptors: true,
          runtimeLabels: [getAgentRuntimeCapabilityManifest(runtimeId).label],
          manifestsFromSharedOwner: [
            JSON.stringify(getAgentRuntimeCapabilityManifest(runtimeId)),
          ],
          cancellationDeclared: true,
          sessionReferenceDeclared: true,
          coversRequiredEntries: true,
          desktopEntryPoint: "function",
          headlessEntryPoint: "function",
        }
      }),
    )
    expect(duplicateVerdict).toMatchObject({
      ok: false,
      reason: "catalog_invalid",
    })
    expect(
      asArray(duplicate.offendingAnyOf).some((name) =>
        JSON.stringify(duplicateVerdict.offending).includes(String(name)),
      ),
    ).toBe(true)
    expect(renderer.map(sortedKeys)).toEqual(
      renderer.map(() => [...asArray(s33.rendererKeys)].map(String).sort()),
    )
    expect(
      Object.fromEntries(
        renderer.map((item) => [
          asRecord(item).runtimeId,
          asRecord(item).transportId,
        ]),
      ),
    ).toEqual(asRecord(s33.rendererTransportIds))
    expect(functionPaths(renderer)).toEqual([])
    for (const pattern of asArray(s33.secretPatterns)) {
      expect(rendererText).not.toMatch(new RegExp(String(pattern), "i"))
    }
  })

  test("S46 Unsupported runtime requested — the existing public parsers keep their normalized unsupported-runtime errors while the internal query returns route_not_found, both with zero provider and delegate calls", async () => {
    const s46 = fixtureKey("refusals.json", "S46")
    const { validateLocalJobApiCreateRequest } = await import(
      "../src/shared/local-job-api"
    )
    const { parseHeadlessCliArgv } = await import(
      "../src/main/lib/headless/cli-args"
    )
    const unsupported = asArray(s46.unsupportedRuntimeIds).map(String)
    const projectCwd = realpathSync(join(import.meta.dir, ".."))
    const publicOutcomes = unsupported.map((runtimeId) => {
      const agent = validateLocalJobApiCreateRequest({
        ...renderPlaceholders(asRecord(s46.publicAgentRequest), {
          PROJECT_CWD: projectCwd,
        }),
        runtime: { id: runtimeId },
      })
      const completion = validateLocalJobApiCreateRequest({
        ...asRecord(s46.publicCompletionRequest),
        runtime: { id: runtimeId },
      })
      const cli = parseHeadlessCliArgv([
        "Locus",
        "--locus-headless-cli",
        "run",
        "--runtime",
        runtimeId,
        "--prompt",
        "Unsupported runtime fixture.",
      ])
      return {
        runtimeId,
        agent: agent.ok
          ? "accepted"
          : agent.errors.includes(String(s46.publicParserError)),
        completion: completion.ok
          ? "accepted"
          : completion.errors.includes(String(s46.publicParserError)),
        cli: cli.ok ? "accepted" : { code: cli.code, message: cli.message },
      }
    })

    const catalog: CatalogModule = await requireCatalogModule()
    const { declarations, ports } = baseDeclarationFixture()
    const recording = createReferencePorts(ports)
    const state = buildTestCatalog(catalog, declarations, recording)
    const internal = unsupported.map((runtimeId) => {
      const result = asRecord(
        catalog.resolveRuntimeRoute(
          agentQuery({
            runtimeId,
            entry: "api",
            mode: "agent",
            executionProfile: "batch",
            source: "api",
            requestedCapabilities: [] as AgentRuntimeCapabilityId[],
          }),
          state,
        ),
      )
      return {
        runtimeId,
        ok: result.ok,
        reason: result.reason,
        delegate: typeof result.delegate,
      }
    })

    expect(publicOutcomes).toEqual(
      unsupported.map((runtimeId) => ({
        runtimeId,
        agent: true,
        completion: true,
        cli: {
          code: Number(s46.cliParserExitCode),
          message: String(s46.cliParserError),
        },
      })),
    )
    const control = asRecord(s46.supportedControl)
    const controlResult = asRecord(
      catalog.resolveRuntimeRoute(
        agentQuery({
          runtimeId: String(control.runtimeId),
          entry: "api",
          mode: "agent",
          executionProfile: "batch",
          source: "api",
        }),
        state,
      ),
    )
    expect({
      ok: controlResult.ok,
      adapterSource: controlResult.adapterSource,
    }).toEqual({ ok: true, adapterSource: control.adapterSource })
    expect(internal).toEqual(
      unsupported.map((runtimeId) => ({
        runtimeId,
        ok: false,
        reason: String(s46.internalReason),
        delegate: "undefined",
      })),
    )
    expect(zeroCalls(recording.log)).toEqual({
      delegateInvocations: 0,
      probeInvocations: 0,
    })
    expect(realSpawnAttempts).toEqual([])
  })
})
