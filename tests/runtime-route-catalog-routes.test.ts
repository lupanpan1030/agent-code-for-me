/**
 * Independent red suite — refactor-unified-runtime-route-catalog, catalog-core
 * domain: surface-aware resolution, desktop hosts, policy refusals and the
 * shared runner (S03, S04, S05, S08, S31, S40–S45, S49).
 * See tests/runtime-route-catalog-core-kit.ts.
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
import { spawnSync } from "node:child_process"
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createMigratedLedgerDb } from "./run-event-ledger-domain-b-kit"
import {
  type AgentQueryInput,
  agentQuery,
  asArray,
  asRecord,
  baseDeclarationFixture,
  buildTestCatalog,
  type CatalogModule,
  claudeHostInput,
  codexHostOptions,
  createFakeSpawn,
  createReferencePorts,
  desktopRunRequest,
  emptyEmissions,
  FIXED_NOW_ISO,
  fixtureKey,
  type HeadlessDelegate,
  importModule,
  type Loose,
  REPO_ROOT,
  type ReferencePorts,
  recordingLedger,
  recordingObserver,
  refusingSpawn,
  renderPlaceholders,
  requireCatalogModule,
  requireCodexDesktopChatRun,
  runCli,
  serializeWithFunctions,
  settledResult,
  sortedKeys,
} from "./runtime-route-catalog-core-kit"

mock.module("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath() {
      return REPO_ROOT
    },
  },
}))

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

// The same net at the native app-server end: no real Codex app-server child.
const appServerAdapter = await import(
  "../src/main/lib/codex/app-server-adapter"
)
mock.module("../src/main/lib/codex/app-server-adapter", () => ({
  ...appServerAdapter,
  createCodexAppServerAdapter: () => {
    realSpawnAttempts.push("createCodexAppServerAdapter")
    throw new Error(
      "runtime-route-catalog red suite: real Codex app-server adapter refused",
    )
  },
}))

const { createAgentRuntimeRunRequest } = await import(
  "../src/main/lib/headless/agent-runtime-contract"
)
const { createCodexHeadlessTaskRunner } = await import(
  "../src/main/lib/headless/adapters/codex"
)
const { __testClaudeCodeHeadless } = await import(
  "../src/main/lib/headless/adapters/claude-code"
)
const { toAgentRuntimeId } = await import(
  "../src/shared/agent-runtime-capabilities"
)

type CreateRequestInput = Parameters<typeof createAgentRuntimeRunRequest>[0]

const cleanups: Array<() => void> = []
beforeEach(() => {
  // Deterministic wall clock for every row timestamp the hosts write.
  setSystemTime(new Date(FIXED_NOW_ISO))
})
afterEach(() => {
  setSystemTime()
  while (cleanups.length > 0) cleanups.pop()?.()
})

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function migratedProfile() {
  const mdb = createMigratedLedgerDb()
  const projectRoot = realpathSync(mdb.dir)
  mdb.sqlite
    .query("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)")
    .run("project-1", "Route catalog fixture", projectRoot)
  cleanups.push(() => mdb.close())
  return { mdb, projectRoot, lockPath: join(mdb.dir, "locus-daemon.lock") }
}

function request(input: Loose, signal = new AbortController().signal) {
  return createAgentRuntimeRunRequest({
    ...(input as unknown as CreateRequestInput),
    signal,
  })
}

/** runAgentTask's design-D1 third options parameter (lazy, test-only). */
async function runAgentTaskWithCatalog(
  runRequest: ReturnType<typeof createAgentRuntimeRunRequest>,
  observer: ReturnType<typeof recordingObserver>["observer"],
  runtimeRouteCatalog: unknown,
) {
  const { runAgentTask } = await import(
    "../src/main/lib/headless/agent-runtime"
  )
  const run = runAgentTask as unknown as (
    request: unknown,
    observer: unknown,
    options: Loose,
  ) => Promise<unknown>
  return settledResult(() => run(runRequest, observer, { runtimeRouteCatalog }))
}

function claudeBatchDelegate(
  spawnProcess: (...args: unknown[]) => unknown,
): HeadlessDelegate {
  return (runRequest, observer) =>
    realRunProcessAgentTask({
      request: runRequest,
      observer,
      executable: "/fixture/bin/claude",
      args: __testClaudeCodeHeadless.buildClaudeArgs(runRequest),
      env: {},
      label: "Claude Code",
      spawnProcess: spawnProcess as Parameters<
        typeof realRunProcessAgentTask
      >[0]["spawnProcess"],
    })
}

function codexBatchDelegate(
  spawnProcess: (...args: unknown[]) => unknown,
  codexHome: string,
): HeadlessDelegate {
  return createCodexHeadlessTaskRunner({
    resolveExecutable: () => "/fixture/bin/codex",
    buildRuntimeEnv: () => ({ CODEX_HOME: codexHome }),
    runProcess: (input) =>
      realRunProcessAgentTask({
        ...input,
        spawnProcess: spawnProcess as Parameters<
          typeof realRunProcessAgentTask
        >[0]["spawnProcess"],
      }),
  })
}

function testCatalog(
  catalog: CatalogModule,
  implementations: Record<string, (...args: unknown[]) => unknown> = {},
): { state: unknown; ports: ReferencePorts } {
  const { declarations, ports } = baseDeclarationFixture()
  const recording = createReferencePorts(ports, implementations)
  return {
    state: buildTestCatalog(catalog, declarations, recording),
    ports: recording,
  }
}

function invocationRefs(ports: ReferencePorts): string[] {
  return ports.log.invocations.map((entry) => entry.ref)
}

function refusalSummary(value: unknown): Loose {
  const record = asRecord(value)
  const result = asRecord(record.result)
  const diagnostic = asRecord(record.diagnostic)
  return {
    ok: record.ok,
    reason: record.reason ?? null,
    candidateAdapterSource: record.candidateAdapterSource ?? null,
    candidateAdapterLabel: record.candidateAdapterLabel ?? null,
    diagnosticReason: diagnostic.reason ?? null,
    errorCode: result.errorCode ?? null,
    errorMessage: result.errorMessage ?? null,
    exitCode: result.exitCode ?? null,
  }
}

function seedDesktopBindings(
  sqlite: { query: (sql: string) => { run: (...args: unknown[]) => unknown } },
  bindings: Loose[],
): void {
  sqlite
    .query("INSERT INTO chats (id, name, project_id) VALUES (?, ?, ?)")
    .run("chat-1", "Route catalog chat", "project-1")
  for (const binding of bindings) {
    sqlite
      .query("INSERT INTO sub_chats (id, name, chat_id) VALUES (?, ?, ?)")
      .run(binding.subChatId, binding.subChatId, "chat-1")
    sqlite
      .query(
        "INSERT INTO sub_chat_bindings (id, sub_chat_id, runtime, provider_profile_id, model_id, model_source, thinking_level) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        `binding-${String(binding.subChatId)}`,
        binding.subChatId,
        binding.runtime,
        binding.providerProfileId,
        binding.modelId,
        binding.modelSource,
        binding.thinkingLevel,
      )
  }
}

function firstArgument(ports: ReferencePorts, ref: string): Loose {
  const invocation = ports.log.invocations.find((entry) => entry.ref === ref)
  return asRecord(invocation?.args[0])
}

describe("runtime route catalog — surfaces, hosts and shared runner", () => {
  test("S03 Desktop routes select the existing native adapters — after the real Claude admission, runClaudeAgentSdkDesktopRuntimeWithMcpReadiness queries its fixed runtime and invokes only the catalog SDK delegate once with the unchanged verified request, before any native SDK work", async () => {
    const catalog = await requireCatalogModule()
    const s03 = fixtureKey("routes.json", "S03")
    const { admitClaudeChatSessionBindingRun } = await import(
      "../src/main/lib/chat-session-binding"
    )
    const { runClaudeAgentSdkDesktopRuntimeWithMcpReadiness } = await import(
      "../src/main/lib/claude/agent-sdk-desktop-run-runtime"
    )
    const profile = migratedProfile()
    seedDesktopBindings(profile.mdb.sqlite, asArray(s03.bindings) as Loose[])
    const stop = asRecord(s03.delegateStop)
    const oauthToken = String(asRecord(s03.secretSentinels).claudeOauthToken)
    const outcomes = []
    for (const entry of asArray(s03.cases).filter(
      (item) => asRecord(item).runtimeId === "claude-code",
    )) {
      const item = asRecord(entry)
      const ref = String(item.factoryRef)
      const { state, ports } = testCatalog(catalog, {
        [ref]: async () => stop,
      })
      // Coordinator adjudication P1-4 (red-receipt §9): eager validation looks up
      // every declared factory reference (S01/S24, tasks 2.2); only post-binding
      // lookups count as "looked up the other runtime".
      const validationLookupCount = ports.log.factoryLookups.length
      const admission = admitClaudeChatSessionBindingRun(
        profile.mdb.db,
        String(item.subChatId),
        asRecord(item.admission),
        { getProviderProfileRuntimeMetadata: () => null },
      )
      const controller = new AbortController()
      const ledger = recordingLedger()
      const session = { resumeSessionId: null, parentSessionId: null }
      const verified = desktopRunRequest({
        runtimeId: "claude-code",
        mode: item.mode as "plan",
        cwd: profile.projectRoot,
        signal: controller.signal,
        ledger: ledger.ledger,
        session,
        subChatId: String(item.subChatId),
      })
      const nativeQueryCalls: unknown[] = []
      const emissions = emptyEmissions()
      const hostResult = admission.ok
        ? await settledResult(async () =>
            runClaudeAgentSdkDesktopRuntimeWithMcpReadiness(
              (await claudeHostInput({
                request: verified,
                nativeQueryCalls,
                emissions,
                db: profile.mdb.db,
                runtimeRouteCatalog: state,
                oauthToken,
              })) as unknown as Parameters<
                typeof runClaudeAgentSdkDesktopRuntimeWithMcpReadiness
              >[0],
            ),
          )
        : null
      const delegateInput = firstArgument(ports, ref)
      const delegateRequest = asRecord(delegateInput.request)
      outcomes.push({
        caseId: item.caseId,
        admitted: admission.ok,
        hostResult: hostResult?.value ?? hostResult?.reason ?? null,
        invocations: invocationRefs(ports),
        lookupBeforeInvoke:
          ports.log.sequence.indexOf(`lookup:${ref}`) >= 0 &&
          ports.log.sequence.indexOf(`lookup:${ref}`) <
            ports.log.sequence.indexOf(`invoke:${ref}`),
        lookedUpOtherRuntime: ports.log.factoryLookups
          .slice(validationLookupCount)
          .some((name) => name.startsWith("factory:codex")),
        sameSignal: delegateRequest.signal === controller.signal,
        sameLedger: delegateRequest.ledger === ledger.ledger,
        sameSession: delegateRequest.session === session,
        sameContext:
          JSON.stringify(delegateRequest.context) ===
          JSON.stringify(verified.context),
        secretReachedOnlyDelegate: delegateInput.oauthToken === oauthToken,
        nativeQueryCalls: nativeQueryCalls.length,
        ledgerCallsByHost: ledger.calls.length,
      })
    }
    const blocked = asArray(s03.blocked)
      .map(asRecord)
      .filter((item) => item.runtimeId === "claude-code")
      .map((item) => {
        const result = admitClaudeChatSessionBindingRun(
          profile.mdb.db,
          String(item.subChatId),
          asRecord(item.admission),
          { getProviderProfileRuntimeMetadata: () => null },
        )
        return { caseId: item.caseId, result }
      })

    expect(outcomes).toEqual(
      asArray(s03.cases)
        .map(asRecord)
        .filter((item) => item.runtimeId === "claude-code")
        .map((item) => ({
          caseId: item.caseId,
          admitted: true,
          hostResult: s03.claudeHostResult,
          invocations: [item.factoryRef],
          lookupBeforeInvoke: true,
          lookedUpOtherRuntime: false,
          sameSignal: true,
          sameLedger: true,
          sameSession: true,
          sameContext: true,
          secretReachedOnlyDelegate: true,
          nativeQueryCalls: 0,
          ledgerCallsByHost: 0,
        })),
    )
    expect(blocked).toEqual(
      asArray(s03.blocked)
        .map(asRecord)
        .filter((item) => item.runtimeId === "claude-code")
        .map((item) => ({
          caseId: item.caseId,
          result: { ok: false, message: item.message, hint: item.hint },
        })),
    )
    expect(realSpawnAttempts).toEqual([])
  })

  test("S03 Desktop routes select the existing native adapters — after the real Codex admission, NEW runCodexDesktopChatRun queries its fixed runtime and invokes only the catalog app-server delegate once with the unchanged verified request and secret-bearing ports", async () => {
    const catalog = await requireCatalogModule()
    const runCodexDesktopChatRun = await requireCodexDesktopChatRun()
    const s03 = fixtureKey("routes.json", "S03")
    const { admitCodexChatSessionBindingRun } = await import(
      "../src/main/lib/chat-session-binding"
    )
    const profile = migratedProfile()
    seedDesktopBindings(profile.mdb.sqlite, asArray(s03.bindings) as Loose[])
    const stop = asRecord(s03.delegateStop)
    const appKey = String(asRecord(s03.secretSentinels).codexAppManagedApiKey)
    const outcomes = []
    for (const entry of asArray(s03.cases).filter(
      (item) => asRecord(item).runtimeId === "codex",
    )) {
      const item = asRecord(entry)
      const ref = String(item.factoryRef)
      const { state, ports } = testCatalog(catalog, {
        [ref]: async () => stop,
      })
      // Coordinator adjudication P1-4 (red-receipt §9): eager validation looks up
      // every declared factory reference (S01/S24, tasks 2.2); only post-binding
      // lookups count as "looked up the other runtime".
      const validationLookupCount = ports.log.factoryLookups.length
      const admission = admitCodexChatSessionBindingRun(
        profile.mdb.db,
        String(item.subChatId),
        asRecord(item.admission),
      )
      const ledger = recordingLedger()
      const verified = desktopRunRequest({
        runtimeId: "codex",
        mode: item.mode as "plan",
        cwd: profile.projectRoot,
        signal: new AbortController().signal,
        ledger: ledger.ledger,
        session: { resumeSessionId: null, parentSessionId: null },
        subChatId: String(item.subChatId),
      })
      const emissions = emptyEmissions()
      const hostResult = admission.ok
        ? await settledResult(() =>
            runCodexDesktopChatRun(
              codexHostOptions({
                request: verified,
                emissions,
                runtimeRouteCatalog: state,
                providerGatewayToken: null,
                appManagedApiKey: appKey,
              }),
            ),
          )
        : null
      const delegateInput = firstArgument(ports, ref)
      outcomes.push({
        caseId: item.caseId,
        admitted: admission.ok,
        hostResult: hostResult?.value ?? hostResult?.reason ?? null,
        invocations: invocationRefs(ports),
        lookupBeforeInvoke:
          ports.log.sequence.indexOf(`lookup:${ref}`) >= 0 &&
          ports.log.sequence.indexOf(`lookup:${ref}`) <
            ports.log.sequence.indexOf(`invoke:${ref}`),
        lookedUpOtherRuntime: ports.log.factoryLookups
          .slice(validationLookupCount)
          .some((name) => name.startsWith("factory:claude")),
        sameRequest: delegateInput.request === verified,
        secretReachedOnlyDelegate: delegateInput.appManagedApiKey === appKey,
        ledgerCallsByHost: ledger.calls.length,
      })
    }
    const blocked = asArray(s03.blocked)
      .map(asRecord)
      .filter((item) => item.runtimeId === "codex")
      .map((item) => ({
        caseId: item.caseId,
        result: admitCodexChatSessionBindingRun(
          profile.mdb.db,
          String(item.subChatId),
          asRecord(item.admission),
        ),
      }))

    expect(outcomes).toEqual(
      asArray(s03.cases)
        .map(asRecord)
        .filter((item) => item.runtimeId === "codex")
        .map((item) => ({
          caseId: item.caseId,
          admitted: true,
          hostResult: stop,
          invocations: [item.factoryRef],
          lookupBeforeInvoke: true,
          lookedUpOtherRuntime: false,
          sameRequest: true,
          secretReachedOnlyDelegate: true,
          ledgerCallsByHost: 0,
        })),
    )
    expect(blocked).toEqual(
      asArray(s03.blocked)
        .map(asRecord)
        .filter((item) => item.runtimeId === "codex")
        .map((item) => ({
          caseId: item.caseId,
          result: { ok: false, message: item.message, hint: item.hint },
        })),
    )
  })

  test("S03 Desktop routes select the existing native adapters — source guards bind claude.chat and codex.chat to their named hosts after admission, with no direct leaf value import in the routers or the Claude lifecycle", () => {
    const guards = asRecord(fixtureKey("routes.json", "S03").sourceGuards)
    const findings: string[] = []
    const valueImportLines = (source: string) =>
      source
        .split("\n")
        .filter(
          (line) =>
            /^\s*import\s/.test(line) && !/^\s*import\s+type\s/.test(line),
        )
        .join("\n")
    const importBlocks = (source: string) =>
      (source.match(/^import[\s\S]*?from\s+["'][^"']+["']/gm) ?? [])
        .filter((block) => !/^import\s+type\s/.test(block))
        .map((block) =>
          block
            .replace(/\btype\s+[A-Za-z0-9_]+\s*,?/g, "")
            .replace(/\s+/g, " "),
        )
        .join("\n")
    for (const [name, value] of Object.entries(guards)) {
      const guard = asRecord(value)
      const source = readFileSync(join(REPO_ROOT, String(guard.file)), "utf8")
      const imports = `${valueImportLines(source)}\n${importBlocks(source)}`
      for (const forbidden of asArray(guard.forbiddenValueImports)) {
        if (imports.includes(String(forbidden))) {
          findings.push(`${name}: value-imports ${String(forbidden)}`)
        }
      }
      if (typeof guard.hostImportSpecifier === "string") {
        if (!importBlocks(source).includes(guard.hostImportSpecifier)) {
          findings.push(`${name}: does not import ${guard.hostImportSpecifier}`)
        }
      }
      if (
        typeof guard.admission === "string" &&
        typeof guard.host === "string"
      ) {
        const admissionAt = source.indexOf(guard.admission)
        const hostAt = source.indexOf(guard.host)
        if (admissionAt < 0 || hostAt < 0 || hostAt < admissionAt) {
          findings.push(
            `${name}: ${guard.host} is not called after ${guard.admission}`,
          )
        }
      }
    }
    expect(findings).toEqual([])
  })

  test("S03 Desktop routes select the existing native adapters — codex.getRuntimeStatus keeps its baseline adapters.selection projection and adapter-source hint bytes (green-by-design characterization)", async () => {
    const expected = asRecord(
      fixtureKey("routes.json", "S03").codexRuntimeStatus,
    )
    const { getCodexRuntimeStatus } = await import(
      "../src/main/lib/codex/runtime-status"
    )
    const appPath = tempDir("route-catalog-status-")
    const status = asRecord(
      await getCodexRuntimeStatus({
        appContext: { isPackaged: false, getAppPath: () => appPath },
        env: {},
      }),
    )
    const adapterSource = asArray(status.components)
      .map(asRecord)
      .find((component) => component.id === "adapter-source")

    expect({
      adapters: status.adapters,
      adapterSourceHint: adapterSource?.hint ?? null,
    }).toEqual({
      adapters: expected.adapters,
      adapterSourceHint: expected.adapterSourceHint,
    })
  })

  test("S04 Entry surfaces resolve to the same batch leaf — headless/api/protocol queries for both runtimes yield the runtime's batch adapterSource, executionSurface headless-exec and the identical leaf delegate, with ready rich probes untouched and the query unchanged", async () => {
    const catalog = await requireCatalogModule()
    const s04 = fixtureKey("routes.json", "S04")
    const { state, ports } = testCatalog(catalog)
    const expected = asRecord(s04.expected)
    const outcomes = []
    for (const mode of asArray(s04.modes)) {
      for (const entry of asArray(s04.matrix)) {
        const item = asRecord(entry)
        const query = agentQuery({
          runtimeId: String(item.runtimeId),
          entry: item.entry as "headless",
          source: item.source as "cli",
          mode: mode as "agent",
          executionProfile: "batch",
        })
        const snapshot = JSON.stringify(query)
        const result = asRecord(catalog.resolveRuntimeRoute(query, state))
        const runtimeExpected = asRecord(expected[String(item.runtimeId)])
        outcomes.push({
          case: `${String(item.runtimeId)}/${String(item.entry)}/${String(item.source)}/${String(mode)}`,
          ok: result.ok,
          entry: result.entry,
          adapterSource: result.adapterSource,
          executionSurface: result.executionSurface,
          sameLeaf:
            result.delegate ===
            ports.delegates[String(runtimeExpected.factoryRef)],
          queryUnchanged: JSON.stringify(query) === snapshot,
        })
      }
    }

    expect(outcomes).toEqual(
      asArray(s04.modes).flatMap((mode) =>
        asArray(s04.matrix).map((entry) => {
          const item = asRecord(entry)
          return {
            case: `${String(item.runtimeId)}/${String(item.entry)}/${String(item.source)}/${String(mode)}`,
            ok: true,
            entry: item.entry,
            adapterSource: asRecord(expected[String(item.runtimeId)])
              .adapterSource,
            executionSurface: s04.executionSurface,
            sameLeaf: true,
            queryUnchanged: true,
          }
        }),
      ),
    )
    expect({
      probeInvocations: ports.log.probeCalls.length,
      delegateInvocations: ports.log.invocations.length,
    }).toEqual({ probeInvocations: 0, delegateInvocations: 0 })
  })

  test("S05 Policy grant does not upgrade adapter enforcement — direct Codex app-server leaf calls with wrong runtime, wrong profile or empty grantedScopes keep unsupported_runtime / unsupported_execution_profile / permission_policy_fail_closed with zero createDesktopAdapter calls (green-by-design characterization of the retained P05 assertion)", async () => {
    const s05 = fixtureKey("policy.json", "S05")
    const { createCodexAppServerHeadlessTaskRunner } = await import(
      "../src/main/lib/headless/adapters/codex-app-server"
    )
    const factoryCalls: unknown[] = []
    const leaf = createCodexAppServerHeadlessTaskRunner({
      createDesktopAdapter: (options) => {
        factoryCalls.push(options)
        throw new Error("createDesktopAdapter must not be reached")
      },
    })
    const root = tempDir("route-catalog-leaf-")
    const outcomes = []
    for (const entry of asArray(s05.leafInvalid)) {
      const item = asRecord(entry)
      const leafRequest = request(
        renderPlaceholders(asRecord(item.request), { PROJECT_ROOT: root }),
      )
      const runRequest = item.clearGrantedScopes
        ? {
            ...leafRequest,
            permissionPolicy: {
              ...leafRequest.permissionPolicy,
              grantedScopes: [],
            },
          }
        : leafRequest
      const observed = recordingObserver()
      outcomes.push({
        variantId: item.variantId,
        result: await leaf(runRequest, observed.observer),
        events: observed.events,
      })
    }

    expect(outcomes).toEqual(
      asArray(s05.leafInvalid).map((entry) => ({
        variantId: asRecord(entry).variantId,
        result: asRecord(entry).expect,
        events: [],
      })),
    )
    expect(factoryCalls).toEqual([])
  })

  test("S05 Policy grant does not upgrade adapter enforcement — only a valid Codex grant selects headless-app-server with admission-audit-only binding; Claude grant, fail-closed, interactive, invalid grant, hard guard, out-of-union profile and capability variants refuse in the baseline order with baseline codes and messages", async () => {
    const catalog = await requireCatalogModule()
    const s05 = fixtureKey("policy.json", "S05")
    const { state, ports } = testCatalog(catalog)
    const outcomes = asArray(s05.variants).map((entry) => {
      const item = asRecord(entry)
      const result = asRecord(
        catalog.resolveRuntimeRoute(
          agentQuery(item.query as unknown as AgentQueryInput),
          state,
        ),
      )
      if (result.ok === true) {
        const diagnostic = asRecord(result.diagnostic)
        return {
          variantId: item.variantId,
          actual: {
            ok: true,
            routeId: result.routeId,
            executionSurface: result.executionSurface,
            adapterSource: result.adapterSource,
            adapterLabel: result.adapterLabel,
            enforcementEvidence: result.enforcementEvidence,
            policyGrantScopeBinding: diagnostic.policyGrantScopeBinding ?? null,
            fallbackReason: diagnostic.fallbackReason,
            message: diagnostic.message,
          },
        }
      }
      return {
        variantId: item.variantId,
        actual: refusalSummary(result),
        hasDelegate: result.delegate !== undefined,
      }
    })

    expect(outcomes).toEqual(
      asArray(s05.variants).map((entry) => {
        const item = asRecord(entry)
        const expected = asRecord(item.expect)
        return expected.ok === true
          ? { variantId: item.variantId, actual: expected }
          : { variantId: item.variantId, actual: expected, hasDelegate: false }
      }),
    )
    expect({
      delegateInvocations: ports.log.invocations.length,
      probeInvocations: ports.log.probeCalls.length,
    }).toEqual({ delegateInvocations: 0, probeInvocations: 0 })
  })

  test("S08 No dead preference option or implicit downgrade remains — accepted batch queries keep diagnostic and public runtime_selected fallbackReason:null, the internal interactive query keeps interactive_channel_required, and the retired selector module with its preference option is gone", async () => {
    const retiredModule = await importModule(
      join(REPO_ROOT, "src/main/lib/headless/adapter-selector.ts"),
    )
    const catalog = await requireCatalogModule()
    const s08 = fixtureKey("policy.json", "S08")
    const root = tempDir("route-catalog-s08-")
    const outcomes = []
    for (const entry of asArray(s08.batchQueries)) {
      const item = asRecord(entry)
      const query = asRecord(item.query)
      const ref = String(item.factoryRef)
      const spawn = createFakeSpawn({ stdout: ["ok\n"], exitCode: 0 })
      const { state } = testCatalog(catalog, {
        [ref]: (runRequest, observer) =>
          (query.runtimeId === "codex"
            ? codexBatchDelegate(spawn.spawnProcess, root)
            : claudeBatchDelegate(spawn.spawnProcess))(
            runRequest as Parameters<HeadlessDelegate>[0],
            observer as Parameters<HeadlessDelegate>[1],
          ),
      })
      const resolved = asRecord(
        catalog.resolveRuntimeRoute(
          agentQuery(query as unknown as AgentQueryInput),
          state,
        ),
      )
      const observed = recordingObserver()
      await runAgentTaskWithCatalog(
        request({
          jobId: `job-${String(item.queryId)}`,
          runtime: query.runtimeId,
          cwd: root,
          mode: query.mode,
          source: query.source,
          prompt: "Fallback fixture.",
        }),
        observed.observer,
        state,
      )
      const selected = asRecord(
        observed.events.find(
          (event) => asRecord(event.payload).status === "runtime_selected",
        )?.payload,
      )
      outcomes.push({
        queryId: item.queryId,
        adapterSource: resolved.adapterSource,
        diagnosticFallbackReason: asRecord(resolved.diagnostic).fallbackReason,
        diagnosticHasPreferredKey:
          "preferredAdapterSource" in asRecord(resolved.diagnostic),
        publicFallbackReason: selected.fallbackReason,
        publicAdapterSource: selected.adapterSource,
      })
    }
    const interactive = asRecord(s08.interactiveQuery)
    const { state: interactiveState } = testCatalog(catalog)
    const interactiveOutcome = refusalSummary(
      catalog.resolveRuntimeRoute(
        agentQuery(interactive.query as unknown as AgentQueryInput),
        interactiveState,
      ),
    )
    const catalogExports = Object.keys(
      (
        await importModule(
          join(
            REPO_ROOT,
            "src/main/lib/agent-runtime/runtime-route-catalog.ts",
          ),
        )
      ).namespace ?? {},
    )

    expect(outcomes).toEqual(
      asArray(s08.batchQueries).map((entry) => {
        const item = asRecord(entry)
        return {
          queryId: item.queryId,
          adapterSource: item.adapterSource,
          diagnosticFallbackReason: null,
          diagnosticHasPreferredKey: false,
          publicFallbackReason: null,
          publicAdapterSource: item.adapterSource,
        }
      }),
    )
    expect(interactiveOutcome).toEqual(interactive.expect as Loose)
    expect(serializeWithFunctions(outcomes)).not.toContain(
      String(s08.forbiddenFallbackReason),
    )
    expect({
      retiredSelectorImportable: retiredModule.namespace !== null,
      catalogPreferenceExports: catalogExports.filter((name) =>
        /prefer/i.test(name),
      ),
    }).toEqual({
      retiredSelectorImportable: false,
      catalogPreferenceExports: [],
    })
    expect(realSpawnAttempts).toEqual([])
  })

  test("S08 No dead preference option or implicit downgrade remains — the retired-route-selector guard rejects a source fixture importing the retired preferredAdapterSource option instead of passing it as clean", () => {
    const guardCase = asRecord(
      fixtureKey("policy.json", "S08").retiredOptionGuardCase,
    )
    const dir = tempDir("route-catalog-s08-guard-")
    const fixturePath = join(dir, "architecture-fixtures.json")
    writeFileSync(
      fixturePath,
      JSON.stringify({
        [String(guardCase.fixtureKey)]: {
          cases: [
            {
              caseId: guardCase.caseId,
              files: guardCase.files,
              expectedFindings: guardCase.expectedFindings,
            },
          ],
        },
      }),
    )
    const run = spawnSync(
      "node",
      [
        "scripts/check-architecture-guards.mjs",
        `--runtime-route-catalog-fixtures=${fixturePath}`,
      ],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 170_000 },
    )
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`
    const mismatchLine =
      output
        .split("\n")
        .find((line) =>
          line.startsWith(
            `Runtime route catalog guard self-test case ${String(guardCase.caseId)} missed `,
          ),
        ) ?? null

    expect({
      exitCode: run.status,
      mismatchLineFound: mismatchLine !== null,
      mentionsOwnerSection:
        mismatchLine?.endsWith(`See ${String(guardCase.ownerSection)}.`) ??
        false,
      mentions: asArray(guardCase.mismatchMustMention).map((needle) =>
        (mismatchLine ?? "").includes(String(needle)),
      ),
    }).toEqual({
      exitCode: 1,
      mismatchLineFound: true,
      mentionsOwnerSection: true,
      mentions: asArray(guardCase.mismatchMustMention).map(() => true),
    })
  }, 180_000)

  test("S31 Codex desktop failure does not activate a batch fallback — runCodexDesktopChatRun invokes only the selected failing app-server delegate, returns its failure unchanged for the existing finalizer and never invokes the exec delegate or touches the Run ledger", async () => {
    const catalog = await requireCatalogModule()
    const runCodexDesktopChatRun = await requireCodexDesktopChatRun()
    const s31 = fixtureKey("routes.json", "S31")
    const failing = asRecord(s31.failingResult)
    const execCalls: unknown[] = []
    const { state, ports } = testCatalog(catalog, {
      [String(s31.selectedFactoryRef)]: async () => failing,
      [String(s31.execFactoryRef)]: async (...args: unknown[]) => {
        execCalls.push(args)
        return { status: "succeeded", exitCode: 0 }
      },
    })
    const ledger = recordingLedger()
    const root = tempDir("route-catalog-s31-")
    const emissions = emptyEmissions()
    const settled = await settledResult(() =>
      runCodexDesktopChatRun(
        codexHostOptions({
          request: desktopRunRequest({
            runtimeId: "codex",
            mode: "agent",
            cwd: root,
            signal: new AbortController().signal,
            ledger: ledger.ledger,
            session: {},
          }),
          emissions,
          runtimeRouteCatalog: state,
          providerGatewayToken: null,
          appManagedApiKey: null,
        }),
      ),
    )

    expect({
      fulfilled: settled.fulfilled,
      value: settled.value ?? null,
      invocations: invocationRefs(ports),
      execCalls: execCalls.length,
      ledgerCalls: ledger.calls,
      hostEmittedTerminal: emissions.chunks.filter(
        (chunk) => chunk.type === "finish" || chunk.type === "error",
      ).length,
    }).toEqual({
      fulfilled: true,
      value: failing,
      invocations: [s31.selectedFactoryRef],
      execCalls: 0,
      ledgerCalls: [],
      hostEmittedTerminal: 0,
    })
  })

  test("S40 Policy grant requires adapter enforcement — a bounded Codex grant is limited to the admission/audit gate with a sanitized admission-audit-only diagnostic, while Claude grant and guarded-scope grant fail closed before provider work", async () => {
    const catalog = await requireCatalogModule()
    const s40 = fixtureKey("policy.json", "S40")
    const grantExpect = asRecord(s40.grantExpect)
    const appServerRef = "factory:codex-headless-app-server"
    const { state, ports } = testCatalog(catalog, {
      [appServerRef]: async () => ({
        status: "succeeded",
        exitCode: 0,
        result: { adapterSource: "codex-app-server" },
      }),
    })
    const resolved = asRecord(
      catalog.resolveRuntimeRoute(
        agentQuery(s40.grantQuery as unknown as AgentQueryInput),
        state,
      ),
    )
    const diagnostic = asRecord(resolved.diagnostic)
    const root = tempDir("route-catalog-s40-")
    const grantObserved = recordingObserver()
    const grantRun = await runAgentTaskWithCatalog(
      request({
        jobId: "job-s40-grant",
        cwd: root,
        prompt: "Grant fixture.",
        ...asRecord(s40.grantRequest),
      }),
      grantObserved.observer,
      state,
    )
    const refusals = []
    for (const entry of asArray(s40.refusals)) {
      const item = asRecord(entry)
      const observed = recordingObserver()
      const run = await runAgentTaskWithCatalog(
        request({
          jobId: `job-s40-${String(item.variantId)}`,
          cwd: root,
          prompt: "Grant fixture.",
          ...asRecord(item.request),
        }),
        observed.observer,
        state,
      )
      refusals.push({
        variantId: item.variantId,
        status: asRecord(run.value).status,
        events: observed.events,
      })
    }

    expect({
      executionSurface: resolved.executionSurface,
      adapterSource: resolved.adapterSource,
      enforcementEvidence: resolved.enforcementEvidence,
      policyGrantScopeBinding: diagnostic.policyGrantScopeBinding,
      admissionAuditMessage: String(diagnostic.message ?? "").includes(
        String(grantExpect.messageMustContain),
      ),
    }).toEqual({
      executionSurface: grantExpect.executionSurface,
      adapterSource: grantExpect.adapterSource,
      enforcementEvidence: grantExpect.enforcementEvidence,
      policyGrantScopeBinding: grantExpect.policyGrantScopeBinding,
      admissionAuditMessage: true,
    })
    expect(resolved.enforcementEvidence).not.toBe("pre-execution")
    expect({
      grantFulfilled: grantRun.fulfilled,
      grantEvents: grantObserved.events,
      grantInvocations: invocationRefs(ports),
    }).toEqual({
      grantFulfilled: true,
      grantEvents: [{ type: "status", payload: s40.runtimeSelectedPayload }],
      grantInvocations: [appServerRef],
    })
    expect(refusals).toEqual(
      asArray(s40.refusals).map((entry) => ({
        variantId: asRecord(entry).variantId,
        status: "failed",
        events: [{ type: "status", payload: asRecord(entry).payload }],
      })),
    )
  })

  test("S41 Run Claude through shared runner — a claude alias normalized by the shared owner resolves and runs the Claude batch adapter selected by the catalog, emitting normalized events and returning the normalized result", async () => {
    const catalog = await requireCatalogModule()
    const s41 = fixtureKey("routes.json", "S41")
    const root = tempDir("route-catalog-s41-")
    const spawn = createFakeSpawn(
      asRecord(s41.processScript) as unknown as Parameters<
        typeof createFakeSpawn
      >[0],
    )
    const ref = String(s41.factoryRef)
    const { state, ports } = testCatalog(catalog, {
      [ref]: (runRequest, observer) =>
        claudeBatchDelegate(spawn.spawnProcess)(
          runRequest as Parameters<HeadlessDelegate>[0],
          observer as Parameters<HeadlessDelegate>[1],
        ),
    })
    const normalized = toAgentRuntimeId(String(s41.rawRuntimeAlias))
    const aliasResolution = asRecord(
      catalog.resolveRuntimeRoute(
        agentQuery({
          runtimeId: String(s41.rawRuntimeAlias),
          entry: "headless",
          mode: "plan",
          executionProfile: "batch",
          source: "cli",
        }),
        state,
      ),
    )
    const observed = recordingObserver("job-s41")
    const run = await runAgentTaskWithCatalog(
      request(
        renderPlaceholders(
          { ...asRecord(s41.request), runtime: normalized },
          { PROJECT_ROOT: root },
        ),
      ),
      observed.observer,
      state,
    )

    expect({
      normalized,
      aliasRuntimeId: aliasResolution.runtimeId,
      aliasAdapterSource: aliasResolution.adapterSource,
    }).toEqual({
      normalized: s41.normalizedRuntimeId,
      aliasRuntimeId: s41.normalizedRuntimeId,
      aliasAdapterSource: "claude-code-batch",
    })
    expect({
      fulfilled: run.fulfilled,
      result: run.value ?? run.reason,
      events: observed.events,
      spawn: spawn.calls,
      invocations: invocationRefs(ports),
    }).toEqual(
      renderPlaceholders(
        {
          fulfilled: true,
          result: s41.expectedResult,
          events: s41.expectedEvents,
          spawn: s41.expectedSpawn,
          invocations: [ref],
        },
        { PROJECT_ROOT: root },
      ),
    )
    expect(realSpawnAttempts).toEqual([])
  })

  test("S42 Run Codex through shared runner — runAgentTask runs the Codex batch adapter selected by the catalog, emitting normalized events and returning the normalized result", async () => {
    const catalog = await requireCatalogModule()
    const s42 = fixtureKey("routes.json", "S42")
    const root = tempDir("route-catalog-s42-")
    const spawn = createFakeSpawn(
      asRecord(s42.processScript) as unknown as Parameters<
        typeof createFakeSpawn
      >[0],
    )
    const ref = String(s42.factoryRef)
    const { state, ports } = testCatalog(catalog, {
      [ref]: (runRequest, observer) =>
        codexBatchDelegate(spawn.spawnProcess, root)(
          runRequest as Parameters<HeadlessDelegate>[0],
          observer as Parameters<HeadlessDelegate>[1],
        ),
    })
    const observed = recordingObserver("job-s42")
    const run = await runAgentTaskWithCatalog(
      request(
        renderPlaceholders(asRecord(s42.request), { PROJECT_ROOT: root }),
      ),
      observed.observer,
      state,
    )

    expect({
      fulfilled: run.fulfilled,
      result: run.value ?? run.reason,
      events: observed.events,
      spawn: spawn.calls,
      invocations: invocationRefs(ports),
    }).toEqual(
      renderPlaceholders(
        {
          fulfilled: true,
          result: s42.expectedResult,
          events: s42.expectedEvents,
          spawn: s42.expectedSpawn,
          invocations: [ref],
        },
        { PROJECT_ROOT: root },
      ),
    )
    expect(realSpawnAttempts).toEqual([])
  })

  test("S43 Default headless batch runtime is selected — headless and API default requests for Codex and Claude resolve and run the process-backed batch adapter despite ready rich references, and the selection diagnostic names the adapter source without exposing secrets", async () => {
    const catalog = await requireCatalogModule()
    const s43 = fixtureKey("routes.json", "S43")
    const root = tempDir("route-catalog-s43-")
    const outcomes = []
    let leakedSentinel = false
    let richTouched: string[] = []
    for (const entry of asArray(s43.cases)) {
      const item = asRecord(entry)
      const spawn = createFakeSpawn(
        asRecord(s43.processScript) as unknown as Parameters<
          typeof createFakeSpawn
        >[0],
      )
      const ref = String(item.factoryRef)
      const runRequestInput = renderPlaceholders(asRecord(item.request), {
        PROJECT_ROOT: root,
      })
      const { state, ports } = testCatalog(catalog, {
        [ref]: (runRequest, observer) =>
          (runRequestInput.runtime === "codex"
            ? codexBatchDelegate(spawn.spawnProcess, root)
            : claudeBatchDelegate(spawn.spawnProcess))(
            runRequest as Parameters<HeadlessDelegate>[0],
            observer as Parameters<HeadlessDelegate>[1],
          ),
      })
      const resolved = asRecord(
        catalog.resolveRuntimeRoute(
          agentQuery({
            runtimeId: String(runRequestInput.runtime),
            entry: item.entry as "api",
            mode: runRequestInput.mode as "agent",
            executionProfile: "batch",
            source: runRequestInput.source as "api",
          }),
          state,
        ),
      )
      const observed = recordingObserver()
      await runAgentTaskWithCatalog(
        {
          ...request(runRequestInput),
          providerBinding: asRecord(s43.providerBinding),
        } as ReturnType<typeof request>,
        observed.observer,
        state,
      )
      const selected = observed.events.find(
        (event) => asRecord(event.payload).status === "runtime_selected",
      )
      const eventsText = JSON.stringify(observed.events)
      for (const sentinel of asArray(s43.secretSentinels)) {
        if (eventsText.includes(String(sentinel))) leakedSentinel = true
      }
      richTouched = [
        ...richTouched,
        ...ports.log.invocations
          .map((invocation) => invocation.ref)
          .filter((name) => asArray(s43.richFactoryRefs).includes(name)),
        ...ports.log.probeCalls,
      ]
      outcomes.push({
        caseId: item.caseId,
        resolvedAdapterSource: resolved.adapterSource,
        selectedPayload: selected?.payload ?? null,
        invocations: invocationRefs(ports),
        spawned: spawn.calls.length,
      })
    }

    expect(outcomes).toEqual(
      asArray(s43.cases).map((entry) => {
        const item = asRecord(entry)
        const runRequest = asRecord(item.request)
        return {
          caseId: item.caseId,
          resolvedAdapterSource: item.adapterSource,
          selectedPayload: {
            status: "runtime_selected",
            runtime: runRequest.runtime,
            label: item.label,
            source: runRequest.source,
            adapterSource: item.adapterSource,
            executionProfile: "batch",
            fallbackReason: null,
          },
          invocations: [item.factoryRef],
          spawned: 1,
        }
      }),
    )
    expect({ leakedSentinel, richTouched }).toEqual({
      leakedSentinel: false,
      richTouched: [],
    })
    expect(realSpawnAttempts).toEqual([])
  })

  test("S44 Interactive runtime is requested without interaction — internal interactive callbacks with no approved channel or grant are refused by the catalog's existing refusal chain before provider work with the sanitized fail-closed diagnostic", async () => {
    const catalog = await requireCatalogModule()
    const s44 = fixtureKey("policy.json", "S44")
    const { state, ports } = testCatalog(catalog)
    const resolved = catalog.resolveRuntimeRoute(
      agentQuery(s44.query as unknown as AgentQueryInput),
      state,
    )
    const root = tempDir("route-catalog-s44-")
    const observed = recordingObserver()
    const run = await runAgentTaskWithCatalog(
      request({
        jobId: "job-s44",
        cwd: root,
        prompt: String(s44.promptSentinel),
        ...asRecord(s44.request),
      }),
      observed.observer,
      state,
    )

    expect(refusalSummary(resolved)).toEqual(s44.expect as Loose)
    expect(asRecord(resolved).delegate).toBeUndefined()
    expect({
      status: asRecord(run.value).status,
      errorCode: asRecord(run.value).errorCode,
      events: observed.events,
      invocations: invocationRefs(ports),
    }).toEqual({
      status: "failed",
      errorCode: "permission_policy_fail_closed",
      events: [{ type: "status", payload: s44.payload }],
      invocations: [],
    })
    expect(serializeWithFunctions([resolved, observed.events])).not.toContain(
      String(s44.promptSentinel),
    )
  })

  test("S45 Adapter selection falls back — batch selection keeps fallbackReason:null with exact runtime_selected keys, an internal interactive request keeps its original refusal keys, a smuggled preference cannot change the selection, and batch metadata never claims pre-execution enforcement", async () => {
    const catalog = await requireCatalogModule()
    const s45 = fixtureKey("policy.json", "S45")
    const root = tempDir("route-catalog-s45-")
    const spawn = createFakeSpawn({ stdout: ["ok\n"], exitCode: 0 })
    const { state, ports } = testCatalog(catalog, {
      "factory:codex-batch": (runRequest, observer) =>
        codexBatchDelegate(spawn.spawnProcess, root)(
          runRequest as Parameters<HeadlessDelegate>[0],
          observer as Parameters<HeadlessDelegate>[1],
        ),
    })
    const batchQuery = agentQuery(s45.batchQuery as unknown as AgentQueryInput)
    const plain = asRecord(catalog.resolveRuntimeRoute(batchQuery, state))
    const smuggled = asRecord(
      catalog.resolveRuntimeRoute(
        { ...batchQuery, ...asRecord(s45.smuggledPreference) },
        state,
      ),
    )
    const batchObserved = recordingObserver()
    await runAgentTaskWithCatalog(
      request({
        jobId: "job-s45-batch",
        cwd: root,
        prompt: "Fallback fixture.",
        ...asRecord(s45.batchRequest),
      }),
      batchObserved.observer,
      state,
    )
    const interactiveObserved = recordingObserver()
    await runAgentTaskWithCatalog(
      request({
        jobId: "job-s45-interactive",
        cwd: root,
        prompt: "Fallback fixture.",
        ...asRecord(s45.interactiveRequest),
      }),
      interactiveObserved.observer,
      state,
    )
    const selected = asRecord(batchObserved.events[0]?.payload)
    const refused = asRecord(interactiveObserved.events[0]?.payload)

    expect({
      plainAdapterSource: plain.adapterSource,
      smuggledAdapterSource: smuggled.adapterSource ?? smuggled.reason,
      plainFallbackReason: asRecord(plain.diagnostic).fallbackReason,
      diagnosticKeysWithPreference: Object.keys(
        asRecord(plain.diagnostic),
      ).filter((key) => /prefer/i.test(key)),
      enforcementEvidence: plain.enforcementEvidence,
    }).toEqual({
      plainAdapterSource: "codex-batch",
      smuggledAdapterSource: "codex-batch",
      plainFallbackReason: null,
      diagnosticKeysWithPreference: [],
      enforcementEvidence: s45.batchEnforcementEvidence,
    })
    expect({
      selectedKeys: sortedKeys(selected),
      selectedFallbackReason: selected.fallbackReason,
      refusedKeys: sortedKeys(refused),
      refused,
      interactiveEventCount: interactiveObserved.events.length,
    }).toEqual({
      selectedKeys: asArray(s45.runtimeSelectedKeys),
      selectedFallbackReason: null,
      refusedKeys: asArray(s45.runtimeSelectionRefusedKeys),
      refused: s45.interactivePayload,
      interactiveEventCount: 1,
    })
    expect(invocationRefs(ports)).toEqual(["factory:codex-batch"])
    expect(realSpawnAttempts).toEqual([])
  })

  test("S49 Runtime events cross surfaces — a run executed by the named hosts reaches the canonical ledger and redaction owners: committed records and the CLI-projected envelopes equal the baseline (redaction and order) and neither the catalog nor the desktop host creates an event", async () => {
    const catalog = await requireCatalogModule()
    const runCodexDesktopChatRun = await requireCodexDesktopChatRun()
    const s49 = fixtureKey("routes.json", "S49")
    const secret = String(s49.secret)
    const ref = String(s49.factoryRef)
    const { state, ports } = testCatalog(catalog, {
      [ref]: async (_runRequest, observerValue) => {
        const observer = observerValue as ReturnType<
          typeof recordingObserver
        >["observer"]
        observer.registerSecretHints([secret])
        for (const event of asArray(s49.delegateEvents)) {
          const item = asRecord(event)
          observer.appendEvent(
            item.type as "assistant_delta",
            asRecord(item.payload),
          )
        }
        return s49.delegateResult
      },
      "factory:codex-desktop-app-server": async () => s49.desktopDelegateResult,
    })
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
        "Ledger fixture.",
        "--output",
        "json",
      ],
      lockPath: profile.lockPath,
      extra: {
        runtimeRouteCatalog: state,
        providerBindingDependencies: {
          getProviderDefaultRuntimeConfig: () => null,
        },
      },
    })
    const job = asRecord(
      profile.mdb.sqlite
        .query("SELECT id, worker_id, worker_pid FROM agent_jobs")
        .get(),
    )
    const committed = profile.mdb.sqlite
      .query(
        "SELECT sequence, type, payload_json FROM agent_job_events ORDER BY sequence",
      )
      .all()
      .map((row) => {
        const record = asRecord(row)
        return {
          sequence: record.sequence,
          type: record.type,
          payload: JSON.parse(String(record.payload_json)) as unknown,
        }
      })
    const projected = asArray(
      asRecord(
        outcome.stdout.trim() ? (JSON.parse(outcome.stdout) as unknown) : {},
      ).events,
    ).map((event) => {
      const record = asRecord(event)
      return {
        sequence: record.sequence,
        type: record.type,
        payload: record.payload,
      }
    })
    const correlationKeys = committed
      .map((record) => asRecord(asRecord(record.payload).item).correlationKey)
      .filter((key): key is string => typeof key === "string")
    const expected = renderPlaceholders(
      s49.expectedCommitted,
      {
        PROJECT_ROOT: profile.projectRoot,
        WORKER_ID: String(job.worker_id),
        ...Object.fromEntries(
          correlationKeys.map((key, index) => [`CORR_${index + 1}`, key]),
        ),
      },
      { WORKER_PID: Number(job.worker_pid) },
    )

    const ledger = recordingLedger()
    const desktop = await settledResult(() =>
      runCodexDesktopChatRun(
        codexHostOptions({
          request: desktopRunRequest({
            runtimeId: "codex",
            mode: "agent",
            cwd: profile.projectRoot,
            signal: new AbortController().signal,
            ledger: ledger.ledger,
            session: {},
          }),
          emissions: emptyEmissions(),
          runtimeRouteCatalog: state,
          providerGatewayToken: null,
          appManagedApiKey: null,
        }),
      ),
    )
    const everything = `${outcome.stdout}\n${outcome.stderr}\n${JSON.stringify(committed)}`

    expect({ settled: outcome.settled, code: outcome.code }).toEqual({
      settled: "fulfilled",
      code: 0,
    })
    expect(committed).toEqual(expected as unknown as typeof committed)
    expect(projected).toEqual(committed)
    expect(
      correlationKeys.every((key) => /^corr-[0-9a-f]{20}$/.test(key)),
    ).toBe(true)
    expect(everything).not.toContain(secret)
    expect(
      [...new Set(committed.map((record) => String(record.type)))].every(
        (type) => asArray(s49.publicEventTypes).includes(type),
      ),
    ).toBe(true)
    expect({
      desktopValue: desktop.value ?? desktop.reason,
      desktopLedgerCalls: ledger.calls,
      invocations: invocationRefs(ports),
      jobIdIsString: typeof job.id === "string",
    }).toEqual({
      desktopValue: s49.desktopDelegateResult,
      desktopLedgerCalls: [],
      invocations: [ref, "factory:codex-desktop-app-server"],
      jobIdIsString: true,
    })
    expect(realSpawnAttempts).toEqual([])
  })
})
