/**
 * Independent RED suite, refactor-unified-runtime-route-catalog, surfaces
 * domain: wrong-procedure admission (S07), renderer route projection (S18,
 * S19), exact-owner job actions (S20) and main read-model stamping (S53).
 * Fixtures: tests/fixtures/runtime-route-catalog/renderer.json and
 * desktop-actions.json.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { tmpdir } from "node:os"
import { Window } from "happy-dom"
import * as schema from "../src/main/lib/db/schema"
import {
  createMigratedLedgerDb,
  type MigratedLedgerDb,
} from "./run-event-ledger-domain-b-kit"
import {
  apiAgentRequest,
  buildFailureStateCatalog,
  buildRecordingCatalog,
  cannedDelegates,
  cannedHeadlessDelegate,
  cleanupSurfaceTemps,
  fixtureKey,
  type GuardRun,
  guardFixture,
  guardMismatchPattern,
  isJson,
  type Json,
  loadRouteCatalogModule,
  loadRouteReadModelModule,
  loadRouteTransportModule,
  pick,
  ROUTE_GUARD_SUMMARY,
  type RouteTransportInput,
  readRepoFile,
  render,
  runCli,
  runRouteCatalogGuardAsync,
  type SharedDeclarationTable,
  settle,
  sharedDeclarationTable,
  surfaceTempDir,
} from "./runtime-route-catalog-surfaces-kit"

const testWindow = new Window({ url: "http://localhost/" })
Object.assign(globalThis, {
  window: testWindow,
  document: testWindow.document,
  localStorage: testWindow.localStorage,
  sessionStorage: testWindow.sessionStorage,
})

let currentDb: MigratedLedgerDb | null = null
const openDbs: MigratedLedgerDb[] = []

function freshDb(): MigratedLedgerDb {
  const db = createMigratedLedgerDb()
  openDbs.push(db)
  currentDb = db
  return db
}

mock.module("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: () => tmpdir(),
  },
  BrowserWindow: class BrowserWindow {},
  clipboard: {},
  dialog: {},
  ipcMain: {},
  net: {},
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
  shell: {},
}))

mock.module("../src/main/lib/db", () => ({
  ...schema,
  getDatabase: () => {
    if (!currentDb) throw new Error("no test database")
    return currentDb.db
  },
}))

// --- recording wire constructors (renderer P16 wire adapters) -------------

type TransportConstruction = { ctor: string; config: Json }
const transportConstructions: TransportConstruction[] = []
const transportSubscriptions: string[] = []

class RecordingIpcChatTransport {
  readonly wire = "IPCChatTransport"
  constructor(readonly config: Json) {
    transportConstructions.push({ ctor: this.wire, config })
  }
  async sendMessages(): Promise<ReadableStream> {
    transportSubscriptions.push(this.wire)
    return new ReadableStream()
  }
  async reconnectToStream(): Promise<null> {
    return null
  }
}

class RecordingCodexAppServerChatTransport {
  readonly wire = "CodexAppServerChatTransport"
  constructor(readonly config: Json) {
    transportConstructions.push({ ctor: this.wire, config })
  }
  async sendMessages(): Promise<ReadableStream> {
    transportSubscriptions.push(this.wire)
    return new ReadableStream()
  }
  async reconnectToStream(): Promise<null> {
    return null
  }
}

mock.module("../src/renderer/features/agents/lib/ipc-chat-transport", () => ({
  IPCChatTransport: RecordingIpcChatTransport,
}))
mock.module(
  "../src/renderer/features/agents/lib/codex-app-server-chat-transport",
  () => ({ CodexAppServerChatTransport: RecordingCodexAppServerChatTransport }),
)

// --- S07 recording factory / secret / provider / credential ports ----------

const s07Calls: string[] = []

const realDesktopRunRuntime = await import(
  "../src/main/lib/claude/agent-sdk-desktop-run-runtime"
)
mock.module("../src/main/lib/claude/agent-sdk-desktop-run-runtime", () => ({
  ...realDesktopRunRuntime,
  runClaudeAgentSdkDesktopRuntimeWithMcpReadiness: async () => {
    s07Calls.push(
      "desktop-host:runClaudeAgentSdkDesktopRuntimeWithMcpReadiness",
    )
    throw new Error("S07 recording host must not run")
  },
}))
const realRuntimeSecrets = await import(
  "../src/main/lib/claude/agent-sdk-runtime-secrets"
)
mock.module("../src/main/lib/claude/agent-sdk-runtime-secrets", () => ({
  ...realRuntimeSecrets,
  createClaudeAgentSdkRuntimeSecretLifecycle: (
    ...args: Parameters<
      typeof realRuntimeSecrets.createClaudeAgentSdkRuntimeSecretLifecycle
    >
  ) => {
    s07Calls.push("secret:createClaudeAgentSdkRuntimeSecretLifecycle")
    return realRuntimeSecrets.createClaudeAgentSdkRuntimeSecretLifecycle(
      ...args,
    )
  },
}))
const realProviderStorage = await import(
  "../src/main/lib/provider-profiles/storage"
)
mock.module("../src/main/lib/provider-profiles/storage", () => ({
  ...realProviderStorage,
  getProviderProfileRuntimeMetadataFromDatabase: (
    ...args: Parameters<
      typeof realProviderStorage.getProviderProfileRuntimeMetadataFromDatabase
    >
  ) => {
    s07Calls.push("provider:getProviderProfileRuntimeMetadataFromDatabase")
    return realProviderStorage.getProviderProfileRuntimeMetadataFromDatabase(
      ...args,
    )
  },
}))
const realClaudeCredentials = await import("../src/main/lib/claude-credentials")
mock.module("../src/main/lib/claude-credentials", () => ({
  ...realClaudeCredentials,
  getValidClaudeCodeCredential: async () => {
    s07Calls.push("credential:getValidClaudeCodeCredential")
    throw new Error("S07 recording credential port must not run")
  },
}))

afterEach(() => {
  currentDb = null
  while (openDbs.length > 0) openDbs.pop()?.close()
  transportConstructions.length = 0
  transportSubscriptions.length = 0
  s07Calls.length = 0
  cleanupSurfaceTemps()
})

// --- shared helpers --------------------------------------------------------

type Subscribable<T> = {
  subscribe(observer: {
    next(value: T): void
    error?(error: unknown): void
    complete(): void
  }): { unsubscribe(): void }
}

async function collectSubscription<T>(
  stream: Subscribable<T> | Promise<Subscribable<T>>,
): Promise<T[]> {
  const resolved = await stream
  return new Promise<T[]>((resolve, reject) => {
    const chunks: T[] = []
    resolved.subscribe({
      next: (chunk) => chunks.push(chunk),
      error: reject,
      complete: () => resolve(chunks),
    })
  })
}

function seedChat(
  db: MigratedLedgerDb,
  input: { chatId: string; projectId: string; projectPath: string },
): void {
  db.sqlite
    .query("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)")
    .run(input.projectId, `Project ${input.projectId}`, input.projectPath)
  db.sqlite
    .query("INSERT INTO chats (id, project_id, worktree_path) VALUES (?, ?, ?)")
    .run(input.chatId, input.projectId, input.projectPath)
}

function seedSubChat(
  db: MigratedLedgerDb,
  input: { chatId: string; subChatId: string; binding: Json },
): void {
  db.sqlite
    .query("INSERT INTO sub_chats (id, chat_id) VALUES (?, ?)")
    .run(input.subChatId, input.chatId)
  db.sqlite
    .query(
      `INSERT INTO sub_chat_bindings
        (id, sub_chat_id, runtime, model_id, model_source, thinking_level)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `binding-${input.subChatId}`,
      input.subChatId,
      String(input.binding.runtime),
      String(input.binding.modelId),
      String(input.binding.modelSource),
      (input.binding.thinkingLevel as string | null | undefined) ?? null,
    )
}

function bindingRows(db: MigratedLedgerDb): Json[] {
  return db.sqlite
    .query("SELECT * FROM sub_chat_bindings ORDER BY id")
    .all() as Json[]
}

function sortedKeys(value: unknown): string[] {
  return isJson(value) ? Object.keys(value).sort() : []
}

let defaultGuardRun: Promise<GuardRun> | null = null

/** One default repository guard run shared by S18/S19/S53. */
function defaultRepositoryGuard(): Promise<GuardRun> {
  defaultGuardRun ??= runRouteCatalogGuardAsync(null)
  return defaultGuardRun
}

type GuardSpec = { rule: string; clean: Json; mutations: Json[] }

async function guardOutcomes(scenario: string, spec: GuardSpec) {
  const [repository, clean, ...mutations] = await Promise.all([
    defaultRepositoryGuard(),
    runRouteCatalogGuardAsync(guardFixture(scenario, [spec.clean])),
    ...spec.mutations.map((mutation) =>
      runRouteCatalogGuardAsync(guardFixture(scenario, [spec.clean, mutation])),
    ),
  ])
  const cleanId = String(spec.clean.caseId)
  return {
    observed: {
      repository: [
        repository.status,
        ROUTE_GUARD_SUMMARY.test(repository.output),
      ],
      clean: [
        clean.status,
        clean.output.match(ROUTE_GUARD_SUMMARY)?.slice(1, 3) ?? null,
      ],
      mutations: spec.mutations.map((mutation, index) => {
        const run = mutations[index]
        const caseId = String(mutation.caseId)
        return [
          caseId,
          run.status,
          guardMismatchPattern(caseId, spec.rule).test(run.output),
          run.output.includes(`self-test case ${cleanId} missed`),
        ]
      }),
    },
    expected: {
      repository: [0, true],
      clean: [0, ["1", "1"]],
      mutations: spec.mutations.map((mutation) => [
        String(mutation.caseId),
        1,
        true,
        false,
      ]),
    },
  }
}

// ---------------------------------------------------------------------------
// S07
// ---------------------------------------------------------------------------

type S07Fixture = {
  durableSubChat: Json & { chatId: string; subChatId: string }
  staleClaudeChatInput: Json
  expectedChunks: Json[]
  expectedAdmission: Json
  descriptorKeys: string[]
  descriptorValues: Json
  codexChatInput: Json
  transportSources: string[]
}

describe("S07 A wrong desktop procedure cannot override the binding", () => {
  test("S07 A wrong desktop procedure cannot override the binding — the real claude.chat procedure on a durable Codex subChat emits the original rejectStaleRunPayload message/hint with zero desktop-host, secret, provider and credential calls and leaves the durable binding unchanged", async () => {
    const fixture = fixtureKey<S07Fixture>("renderer.json", "S07")
    const db = freshDb()
    seedChat(db, {
      chatId: fixture.durableSubChat.chatId,
      projectId: "s07-project",
      projectPath: surfaceTempDir("route-catalog-s07-"),
    })
    seedSubChat(db, {
      chatId: fixture.durableSubChat.chatId,
      subChatId: fixture.durableSubChat.subChatId,
      binding: fixture.durableSubChat,
    })
    const before = bindingRows(db)
    const { claudeRouter } = await import("../src/main/lib/trpc/routers/claude")
    const { admitClaudeChatSessionBindingRun } = await import(
      "../src/main/lib/chat-session-binding"
    )
    const chunks = await collectSubscription<Json>(
      claudeRouter
        .createCaller({ getWindow: () => null })
        .chat(
          fixture.staleClaudeChatInput as Parameters<
            ReturnType<typeof claudeRouter.createCaller>["chat"]
          >[0],
        ) as unknown as Promise<Subscribable<Json>>,
    )
    const admission = admitClaudeChatSessionBindingRun(
      db.db,
      fixture.durableSubChat.subChatId,
      {
        modelSource: String(fixture.staleClaudeChatInput.modelSource),
        requestedModel: String(fixture.staleClaudeChatInput.model),
      },
      {
        getProviderProfileRuntimeMetadata: () => {
          s07Calls.push("provider:admission-dependency")
          return null
        },
      },
    )
    expect({
      chunks: chunks.map((chunk) => pick(chunk, ["type", "errorText"])),
      admission,
      calls: [...s07Calls],
      bindingRows: bindingRows(db),
    }).toEqual({
      chunks: fixture.expectedChunks,
      admission: fixture.expectedAdmission,
      calls: [],
      bindingRows: before,
    })
  })

  test("S07 A wrong desktop procedure cannot override the binding — routeId/transportId never cross chat request IPC: both strict chat inputs refuse a descriptor-carrying request and neither renderer transport sends a descriptor field", async () => {
    const fixture = fixtureKey<S07Fixture>("renderer.json", "S07")
    const db = freshDb()
    seedChat(db, {
      chatId: fixture.durableSubChat.chatId,
      projectId: "s07-project",
      projectPath: surfaceTempDir("route-catalog-s07-"),
    })
    seedSubChat(db, {
      chatId: fixture.durableSubChat.chatId,
      subChatId: fixture.durableSubChat.subChatId,
      binding: fixture.durableSubChat,
    })
    const { claudeChatInputSchema } = await import(
      "../src/main/lib/claude/chat-input-schema"
    )
    const { codexChatInputSchema } = await import(
      "../src/main/lib/codex/chat-input-schema"
    )
    const refusals = fixture.descriptorKeys.flatMap((key) => {
      const descriptor = { [key]: fixture.descriptorValues[key] }
      const claude = claudeChatInputSchema.safeParse({
        ...fixture.staleClaudeChatInput,
        ...descriptor,
      })
      const codex = codexChatInputSchema.safeParse({
        ...fixture.codexChatInput,
        ...descriptor,
      })
      return [
        [
          `claude.chat+${key}`,
          claude.success,
          JSON.stringify(claude.error ?? ""),
        ],
        [`codex.chat+${key}`, codex.success, JSON.stringify(codex.error ?? "")],
      ]
    })
    const transportMentions = fixture.transportSources.map((path) => {
      const source = readRepoFile(path)
      return [
        path,
        fixture.descriptorKeys.filter((key) => source.includes(key)),
      ]
    })
    expect({
      refusals: refusals.map(([name, success, error]) => [
        name,
        success,
        fixture.descriptorKeys.some((key) => String(error).includes(key)),
      ]),
      transportMentions,
      calls: [...s07Calls],
    }).toEqual({
      refusals: refusals.map(([name]) => [name, false, true]),
      transportMentions: fixture.transportSources.map((path) => [path, []]),
      calls: [],
    })
  })
})

// ---------------------------------------------------------------------------
// S18
// ---------------------------------------------------------------------------

type S18Fixture = {
  config: Json
  bindings: Record<string, Json>
  knownTransports: {
    transportId: string
    runtime: string
    constructor: string
  }[]
  baselineConfigKeys: string[]
  failureInputs: { variant: string; input: RouteTransportInput; result: Json }[]
  guard: GuardSpec
}

describe("S18 Both renderer entry points consume the binding descriptor", () => {
  test("S18 Both renderer entry points consume the binding descriptor — createRuntimeRouteTransport returns {ok:true,transport} from the compiled constructor for loaded known IDs with the baseline config, and route_descriptor_unavailable / route_descriptor_error / unknown_transport with zero constructor or subscription calls and no Claude fallback, after which a loaded retry succeeds", async () => {
    // Enforces once src/renderer/features/agents/lib/runtime-route-transport.ts
    // exports createRuntimeRouteTransport (design D1/D3).
    const fixture = fixtureKey<S18Fixture>("renderer.json", "S18")
    const config = render(fixture.config, {
      PROJECT_PATH: surfaceTempDir("route-catalog-s18-"),
    })
    const loaded = await settle(loadRouteTransportModule)
    expect(loaded.ok ? "helper loaded" : loaded.error).toBe("helper loaded")
    if (!loaded.ok) return
    const { createRuntimeRouteTransport } = loaded.value
    const failures = fixture.failureInputs.map((entry) => ({
      variant: entry.variant,
      result: createRuntimeRouteTransport(entry.input, {
        ...config,
        binding: fixture.bindings["claude-code"],
      }),
    }))
    const afterFailures = {
      constructions: transportConstructions.length,
      subscriptions: transportSubscriptions.length,
    }
    const known = fixture.knownTransports.map((entry) => {
      const before = transportConstructions.length
      const requestConfig = {
        ...config,
        binding: fixture.bindings[entry.runtime],
      }
      const result = createRuntimeRouteTransport(
        { state: "loaded", transportId: entry.transportId },
        requestConfig,
      )
      const constructed = transportConstructions.slice(before)
      return {
        transportId: entry.transportId,
        ok: result.ok,
        wire:
          result.ok && isJson(result.transport)
            ? (result.transport as { wire?: string }).wire
            : null,
        constructed: constructed.map((call) => [
          call.ctor,
          pick(call.config, fixture.baselineConfigKeys),
        ]),
        expectedConfig: pick(requestConfig, fixture.baselineConfigKeys),
      }
    })
    const retry = createRuntimeRouteTransport(
      { state: "loaded", transportId: fixture.knownTransports[0].transportId },
      {
        ...config,
        binding: fixture.bindings[fixture.knownTransports[0].runtime],
      },
    )
    expect({
      failures,
      afterFailures,
      known: known.map(({ expectedConfig: _ignored, ...rest }) => rest),
      retryOk: retry.ok,
      subscriptions: transportSubscriptions.length,
    }).toEqual({
      failures: fixture.failureInputs.map((entry) => ({
        variant: entry.variant,
        result: entry.result,
      })),
      afterFailures: { constructions: 0, subscriptions: 0 },
      known: fixture.knownTransports.map((entry, index) => ({
        transportId: entry.transportId,
        ok: true,
        wire: entry.constructor,
        constructed: [[entry.constructor, known[index].expectedConfig]],
      })),
      retryOk: true,
      subscriptions: 0,
    })
  })

  test("S18 Both renderer entry points consume the binding descriptor — renderer-route-projection-bypass passes the repository and the clean two-site fixture, and reports Chat caching on ok:false, a binding.runtime comparison and an unmapped read error as unexpected findings", async () => {
    // Enforces once scripts/check-architecture-guards.mjs has the Runtime
    // Route Catalog Single Owner section (design D5, tasks 4.1).
    const fixture = fixtureKey<S18Fixture>("renderer.json", "S18")
    const { observed, expected } = await guardOutcomes("S18", fixture.guard)
    expect(observed).toEqual(expected)
  }, 120_000)
})

// ---------------------------------------------------------------------------
// S19
// ---------------------------------------------------------------------------

type S19Fixture = {
  fixtureRuntimeId: string
  fixtureDeclaration: Json
  fixturePorts: SharedDeclarationTable["ports"]
  fixtureManifest: {
    baseManifest: string
    runtimeId: string
    label: string
    description: string
  }
  query: Json
  expectedResolved: Json
  existingWireTransportId: string
  rendererProjectionKeys: string[]
  productionRendererProjection: Record<string, string>
  productionRuntimeIds: string[]
  context: { subChatId: string; parentChatId: string }
  chunks: { question: Json; guardEvent: Json; finish: Json }
  guard: GuardSpec
}

function projectionMap(entries: readonly Json[]): Record<string, unknown> {
  return Object.fromEntries(
    entries.map((entry) => [String(entry.runtimeId), entry.transportId]),
  )
}

describe("S19 A fixture Runtime reuses an existing wire family without core edits", () => {
  test("S19 A fixture Runtime reuses an existing wire family without core edits — an isolated validated catalog resolves the fixture Runtime's fixed-runtime delegate, its read-only renderer projection carries only {routeId,runtimeId,transportId} for an existing wire transportId that createRuntimeRouteTransport constructs, and the production projection stays the two existing runtimes", async () => {
    // Enforces once runtime-route-catalog.ts (createRuntimeRouteCatalogForTests,
    // resolveRuntimeRoute, projectRuntimeRoutes) and runtime-route-transport.ts
    // exist (design D1/D3, OD-1 narrowed L2).
    const fixture = fixtureKey<S19Fixture>("renderer.json", "S19")
    const { getAgentRuntimeCapabilityManifest, CONTRACT_RUNTIME_IDS } =
      await import("../src/shared/agent-runtime-capabilities")
    const table = sharedDeclarationTable()
    table.declarations.push(fixture.fixtureDeclaration)
    table.ports = {
      manifests: {
        ...table.ports.manifests,
        ...fixture.fixturePorts.manifests,
      },
      factories: [...table.ports.factories, ...fixture.fixturePorts.factories],
      probes: { ...table.ports.probes, ...fixture.fixturePorts.probes },
      evidence: { ...table.ports.evidence, ...fixture.fixturePorts.evidence },
    }
    const fixtureManifest = {
      ...getAgentRuntimeCapabilityManifest("claude-code"),
      runtimeId: fixture.fixtureManifest.runtimeId,
      label: fixture.fixtureManifest.label,
      description: fixture.fixtureManifest.description,
    } as unknown as ReturnType<typeof getAgentRuntimeCapabilityManifest>
    const fixtureDelegate = Object.freeze({
      fixedRuntimeDelegate: fixture.fixtureRuntimeId,
    })
    const built = await settle(() =>
      buildRecordingCatalog({
        table,
        manifests: { [fixture.fixtureRuntimeId]: fixtureManifest },
        delegates: (row) =>
          row.runtimeId === fixture.fixtureRuntimeId
            ? fixtureDelegate
            : cannedHeadlessDelegate(`${row.routeId} unused`),
      }),
    )
    expect(built.ok ? "test catalog built" : built.error).toBe(
      "test catalog built",
    )
    if (!built.ok) return
    const catalogModule = await loadRouteCatalogModule()
    const { createRuntimeRouteTransport } = await loadRouteTransportModule()
    const resolved = catalogModule.resolveRuntimeRoute(
      fixture.query,
      built.value.state,
    )
    const projection = catalogModule.projectRuntimeRoutes(
      "renderer",
      built.value.state,
    )
    const fixtureEntry =
      projection.find(
        (entry) => entry.runtimeId === fixture.fixtureRuntimeId,
      ) ?? {}
    const transport = createRuntimeRouteTransport(
      {
        state: "loaded",
        transportId: String(fixtureEntry.transportId ?? "missing"),
      },
      {
        chatId: fixture.context.parentChatId,
        subChatId: fixture.context.subChatId,
        binding: { runtime: fixture.fixtureRuntimeId },
        mode: "agent",
      },
    )
    const production = catalogModule.projectRuntimeRoutes("renderer")
    expect({
      resolved: pick(resolved, Object.keys(fixture.expectedResolved)),
      delegateIsFixturePort: resolved.delegate === fixtureDelegate,
      fixtureProjectionKeys: sortedKeys(fixtureEntry),
      fixtureTransportId: fixtureEntry.transportId,
      transport: [
        transport.ok,
        transport.ok
          ? (transport.transport as { wire?: string }).wire
          : transport.failure,
      ],
      productionProjection: projectionMap(production),
      productionProjectionKeys: production.map(sortedKeys),
      contractRuntimeIds: [...CONTRACT_RUNTIME_IDS],
    }).toEqual({
      resolved: fixture.expectedResolved,
      delegateIsFixturePort: true,
      fixtureProjectionKeys: [...fixture.rendererProjectionKeys].sort(),
      fixtureTransportId: fixture.existingWireTransportId,
      transport: [true, "IPCChatTransport"],
      productionProjection: fixture.productionRendererProjection,
      productionProjectionKeys: fixture.productionRuntimeIds.map(() =>
        [...fixture.rendererProjectionKeys].sort(),
      ),
      contractRuntimeIds: fixture.productionRuntimeIds,
    })
  })

  test("S19 A fixture Runtime reuses an existing wire family without core edits — the shared event-state owner applies the fixture Runtime's normalized question/guard/finish chunks with the baseline atom transitions and no runtime input (green-by-design characterization)", async () => {
    const fixture = fixtureKey<S19Fixture>("renderer.json", "S19")
    const { appStore } = await import("../src/renderer/lib/jotai-store")
    const atoms = await import("../src/renderer/features/agents/atoms")
    const {
      applyRuntimeEventStateChunk,
      clearPendingUserQuestionForRuntimeChunk,
    } = await import("../src/renderer/features/agents/lib/runtime-event-state")
    const sub = fixture.context.subChatId
    const reset = () => {
      appStore.set(atoms.pendingUserQuestionsAtom, new Map())
      appStore.set(atoms.askUserQuestionApprovalIdsAtom, new Map())
      appStore.set(atoms.guardedRunEventsAtom, new Map())
      appStore.set(atoms.pendingScopeExpansionRequestsAtom, new Map())
    }
    reset()
    const appliedQuestion = applyRuntimeEventStateChunk(
      fixture.context,
      fixture.chunks.question,
    )
    const afterQuestion = {
      pendingApprovalId:
        appStore.get(atoms.pendingUserQuestionsAtom).get(sub)?.approvalId ??
        null,
      approvalOwners: appStore.get(atoms.askUserQuestionApprovalIdsAtom).size,
    }
    const appliedGuard = applyRuntimeEventStateChunk(
      fixture.context,
      fixture.chunks.guardEvent,
    )
    const guardEvent = fixture.chunks.guardEvent.event as Json
    const afterGuard = {
      guardEvents: (
        appStore.get(atoms.guardedRunEventsAtom).get(sub) ?? []
      ).map((event) => event.id),
      scopeRequest:
        appStore.get(atoms.pendingScopeExpansionRequestsAtom).get(sub)
          ?.requestId ?? null,
      pendingStillSet: appStore.get(atoms.pendingUserQuestionsAtom).has(sub),
    }
    const appliedFinish = applyRuntimeEventStateChunk(
      fixture.context,
      fixture.chunks.finish,
    )
    clearPendingUserQuestionForRuntimeChunk({
      subChatId: sub,
      chunk: fixture.chunks.finish,
    })
    const afterFinish = {
      pending: appStore.get(atoms.pendingUserQuestionsAtom).has(sub),
      approvalOwners: appStore.get(atoms.askUserQuestionApprovalIdsAtom).size,
      guardEvents: (appStore.get(atoms.guardedRunEventsAtom).get(sub) ?? [])
        .length,
    }
    reset()
    expect({
      appliedQuestion,
      afterQuestion,
      appliedGuard,
      afterGuard,
      appliedFinish,
      afterFinish,
    }).toEqual({
      appliedQuestion: true,
      afterQuestion: {
        pendingApprovalId: fixture.chunks.question.approvalId,
        approvalOwners: 1,
      },
      appliedGuard: true,
      afterGuard: {
        guardEvents: [guardEvent.id],
        scopeRequest: guardEvent.id,
        pendingStillSet: true,
      },
      appliedFinish: false,
      afterFinish: { pending: false, approvalOwners: 0, guardEvents: 1 },
    })
  })

  test("S19 A fixture Runtime reuses an existing wire family without core edits — renderer-route-projection-bypass passes the repository (runtime-route-transport.ts and runtime-event-state.ts) and the clean transportId-keyed helper fixture, and reports a helper runtime-ID branch as an unexpected finding", async () => {
    // Enforces once scripts/check-architecture-guards.mjs has the Runtime
    // Route Catalog Single Owner section (design D5, tasks 4.1).
    const fixture = fixtureKey<S19Fixture>("renderer.json", "S19")
    const { observed, expected } = await guardOutcomes("S19", fixture.guard)
    expect(observed).toEqual(expected)
  }, 120_000)
})

// ---------------------------------------------------------------------------
// S20
// ---------------------------------------------------------------------------

type S20Fixture = {
  chat: { chatId: string; subChatId: string; projectId: string }
  desktopRuntime: "claude-code" | "codex"
  oldStream: { runId: string }
  newStream: { runId: string }
  apiRequest: { consumerId: string; runtime: string; prompt: string }
  headlessJob: { id: string; source: string; runtime: string }
  expected: {
    oldCancel: Json
    desktopRetryError: string
    apiRetryError: string
    headlessCancel: Json
    headlessRetry: Json
  }
  envelopeKeys: string[]
  jobEnvelopeKeys: string[]
  catalogModuleTokens: string[]
  ownerSources: string[]
}

describe("S20 Job actions preserve exact desktop ownership", () => {
  test("S20 Job actions preserve exact desktop ownership — Workbench cancel of the old desktop job reaches only its own stream owner, desktop retry stays linked-chat-only, API retry stays CLI-API-only, headless cancel/retry use the store owner with baseline envelopes, and neither owner consults the catalog (green-by-design characterization)", async () => {
    const fixture = fixtureKey<S20Fixture>("desktop-actions.json", "S20")
    const db = freshDb()
    const projectPath = surfaceTempDir("route-catalog-s20-")
    seedChat(db, {
      chatId: fixture.chat.chatId,
      projectId: fixture.chat.projectId,
      projectPath,
    })
    db.sqlite
      .query("INSERT INTO sub_chats (id, chat_id) VALUES (?, ?)")
      .run(fixture.chat.subChatId, fixture.chat.chatId)
    const desktopJobs = await import("../src/main/lib/desktop-agent-jobs")
    const { createAgentJob, getAgentJob } = await import(
      "../src/main/lib/headless/job-store"
    )
    const { agentJobsRouter } = await import(
      "../src/main/lib/trpc/routers/agent-jobs"
    )
    const deliveries: string[] = []
    const startDesktop = (runId: string) =>
      desktopJobs.createAndRegisterDesktopChatAgentJob(db.db, {
        runtime: fixture.desktopRuntime,
        mode: "agent",
        chatId: fixture.chat.chatId,
        subChatId: fixture.chat.subChatId,
        cwd: projectPath,
        prompt: `S20 ${runId}`,
        runId,
        cancel: () => {
          deliveries.push(runId)
        },
      })
    const oldJob = await startDesktop(fixture.oldStream.runId)
    const newJob = await startDesktop(fixture.newStream.runId)
    const apiProfileCwd = projectPath
    const apiSubmitted = await runCli(
      db.db,
      ["api", "runs", "submit", "--request", "-", "--json"],
      {
        stdin: JSON.stringify(
          apiAgentRequest({
            cwd: apiProfileCwd,
            runtime: fixture.apiRequest.runtime,
            consumerId: fixture.apiRequest.consumerId,
            prompt: fixture.apiRequest.prompt,
          }),
        ),
      },
    )
    const apiEnvelope = JSON.parse(apiSubmitted.stdout.trim()) as Json
    const apiJobId = isJson(apiEnvelope.job) ? String(apiEnvelope.job.id) : ""
    await createAgentJob(db.db, {
      id: fixture.headlessJob.id,
      source: fixture.headlessJob.source as "cli",
      runtime: fixture.headlessJob.runtime as "codex",
      mode: "plan",
      cwd: projectPath,
      prompt: "S20 headless job",
      projectId: fixture.chat.projectId,
    })
    const caller = agentJobsRouter.createCaller({
      getWindow: () => null,
    } as never)
    const oldCancel = await caller.cancel({ jobId: oldJob.job.id })
    const newAfter = getAgentJob(db.db, newJob.job.id)
    const desktopRetry = await settle(() =>
      caller.retry({ jobId: oldJob.job.id }),
    )
    const apiRetry = await settle(() => caller.retry({ jobId: apiJobId }))
    const headlessCancel = await caller.cancel({
      jobId: fixture.headlessJob.id,
    })
    const headlessRetry = await caller.retry({ jobId: fixture.headlessJob.id })
    desktopJobs.unregisterActiveDesktopAgentJob(oldJob.job.id)
    desktopJobs.unregisterActiveDesktopAgentJob(newJob.job.id)
    const ownerMentions = fixture.ownerSources.map((path) => [
      path,
      fixture.catalogModuleTokens.filter((token) =>
        readRepoFile(path).includes(token),
      ),
    ])
    expect({
      apiSubmitExit: apiSubmitted.code,
      oldCancel: {
        oldCancelDeliveries: deliveries.filter(
          (runId) => runId === fixture.oldStream.runId,
        ).length,
        newCancelDeliveries: deliveries.filter(
          (runId) => runId === fixture.newStream.runId,
        ).length,
        oldCancelRequestedBy: oldCancel.job.cancelRequestedBy,
        newStatus: newAfter?.status,
        newCancelRequestedBy: newAfter?.cancelRequestedBy ?? null,
      },
      desktopRetry: desktopRetry.ok ? "accepted" : desktopRetry.error,
      apiRetry: apiRetry.ok ? "accepted" : apiRetry.error,
      apiStatus: getAgentJob(db.db, apiJobId)?.status,
      headlessCancel: pick(headlessCancel.job as unknown as Json, [
        "status",
        "exitCode",
        "errorCode",
        "errorMessage",
        "cancelRequestedBy",
      ]),
      headlessRetry: {
        ...pick(headlessRetry.job as unknown as Json, [
          "source",
          "attempt",
          "status",
        ]),
        retryOf: headlessRetry.job.retryOfJobId,
      },
      envelopes: [oldCancel, headlessCancel, headlessRetry].map((envelope) => [
        sortedKeys(envelope),
        sortedKeys(envelope.job),
      ]),
      ownerMentions,
    }).toEqual({
      apiSubmitExit: 0,
      oldCancel: fixture.expected.oldCancel,
      desktopRetry: fixture.expected.desktopRetryError,
      apiRetry: fixture.expected.apiRetryError,
      apiStatus: "queued",
      headlessCancel: fixture.expected.headlessCancel,
      headlessRetry: {
        ...fixture.expected.headlessRetry,
        retryOf: fixture.headlessJob.id,
      },
      envelopes: [0, 1, 2].map(() => [
        [...fixture.envelopeKeys].sort(),
        [...fixture.jobEnvelopeKeys].sort(),
      ]),
      ownerMentions: fixture.ownerSources.map((path) => [path, []]),
    })
  })
})

// ---------------------------------------------------------------------------
// S53
// ---------------------------------------------------------------------------

type S53Fixture = {
  chat: { chatId: string; projectId: string; projectPath: string }
  subChats: { subChatId: string; binding: Json; transportId: string }[]
  createSubChatBindings: Json[]
  durableBindingKeys: string[]
  forbiddenColumns: string[]
  failureStateMappedInput: RouteTransportInput
  failureStateResult: Json
  guard: GuardSpec
}

async function s53Router() {
  const { subChatProcedures } = await import(
    "../src/main/lib/trpc/routers/chats-sub-chats"
  )
  const { chatCrudProcedures } = await import(
    "../src/main/lib/trpc/routers/chats-crud"
  )
  const { router } = await import("../src/main/lib/trpc")
  return router({
    get: chatCrudProcedures.get,
    getSubChat: subChatProcedures.getSubChat,
    createSubChat: subChatProcedures.createSubChat,
  }).createCaller({ getWindow: () => null } as never)
}

function seedS53(fixture: S53Fixture): MigratedLedgerDb {
  const db = freshDb()
  seedChat(db, fixture.chat)
  for (const subChat of fixture.subChats) {
    seedSubChat(db, {
      chatId: fixture.chat.chatId,
      subChatId: subChat.subChatId,
      binding: subChat.binding,
    })
  }
  return db
}

async function productionRendererProjection(): Promise<
  Record<string, unknown> | string
> {
  const loaded = await settle(async () =>
    projectionMap(
      (await loadRouteCatalogModule()).projectRuntimeRoutes("renderer"),
    ),
  )
  return loaded.ok ? loaded.value : loaded.error
}

function bindingShape(binding: unknown, durableKeys: string[]) {
  const record = isJson(binding) ? binding : {}
  return {
    transportId: record.transportId ?? null,
    keys: sortedKeys(record),
    durable: pick(record, durableKeys),
  }
}

describe("S53 Main stamps transport IDs only on the binding read model", () => {
  test("S53 Main stamps transport IDs only on the binding read model — the real getSubChat and createSubChat procedures return binding.transportId equal to the production renderer projection for claude-code and codex while the persisted binding rows and schema carry no transport column", async () => {
    const fixture = fixtureKey<S53Fixture>("renderer.json", "S53")
    const db = seedS53(fixture)
    const before = bindingRows(db)
    const caller = await s53Router()
    const read = []
    for (const subChat of fixture.subChats) {
      const result = await caller.getSubChat({ id: subChat.subChatId })
      read.push(bindingShape(result?.binding, fixture.durableBindingKeys))
    }
    const afterReads = bindingRows(db)
    const created = []
    for (const binding of fixture.createSubChatBindings) {
      const result = await caller.createSubChat({
        chatId: fixture.chat.chatId,
        binding: binding as never,
      })
      const row = db.sqlite
        .query("SELECT runtime FROM sub_chat_bindings WHERE sub_chat_id = ?")
        .get(result.id) as Json | null
      created.push({
        ...bindingShape(result.binding, fixture.durableBindingKeys),
        persistedRuntime: row?.runtime ?? null,
      })
    }
    const columns = (
      db.sqlite.query("PRAGMA table_info(sub_chat_bindings)").all() as Json[]
    ).map((column) => String(column.name))
    const durableBindings = fixture.subChats.map((subChat) =>
      before.find((entry) => entry.sub_chat_id === subChat.subChatId),
    )
    const { getSubChatBinding } = await import(
      "../src/main/lib/chat-session-binding"
    )
    const durableNow = fixture.subChats.map((subChat) =>
      pick(
        getSubChatBinding(db.db, subChat.subChatId) as unknown as Json,
        fixture.durableBindingKeys,
      ),
    )
    const projection = await productionRendererProjection()
    expect({
      read: read.map(({ transportId, keys }) => ({ transportId, keys })),
      readDurable: read.map(({ durable }) => durable),
      created: created.map(({ transportId, keys, persistedRuntime }) => ({
        transportId,
        keys,
        persistedRuntime,
      })),
      projection,
      rowsUnchanged: afterReads.filter((row) =>
        durableBindings.some((entry) => entry?.id === row.id),
      ),
      forbiddenColumns: fixture.forbiddenColumns.filter((name) =>
        columns.includes(name),
      ),
      schemaColumn: Object.hasOwn(schema.subChatBindings, "transportId"),
    }).toEqual({
      read: fixture.subChats.map((subChat) => ({
        transportId: subChat.transportId,
        keys: [...fixture.durableBindingKeys, "transportId"].sort(),
      })),
      readDurable: durableNow,
      created: fixture.createSubChatBindings.map((binding) => ({
        transportId:
          fixture.subChats.find(
            (subChat) => subChat.binding.runtime === binding.runtime,
          )?.transportId ?? null,
        keys: [...fixture.durableBindingKeys, "transportId"].sort(),
        persistedRuntime: binding.runtime,
      })),
      projection: Object.fromEntries(
        fixture.subChats.map((subChat) => [
          String(subChat.binding.runtime),
          subChat.transportId,
        ]),
      ),
      rowsUnchanged: before,
      forbiddenColumns: [],
      schemaColumn: false,
    })
  })

  test("S53 Main stamps transport IDs only on the binding read model — the chat query (chats.get) that feeds the getOrCreateChat construction site returns each sub-chat binding stamped with its renderer transportId", async () => {
    // Open question for adjudication: spec cites chats-sub-chats.ts:107/:116,
    // but P14 (active-chat.tsx getOrCreateChat) reads bindings from chats.get
    // (chats-crud.ts:96 attachBindingsToSubChats).
    const fixture = fixtureKey<S53Fixture>("renderer.json", "S53")
    seedS53(fixture)
    const caller = await s53Router()
    const chat = (await caller.get({ id: fixture.chat.chatId })) as unknown as {
      subChats?: { id: string; binding?: Json }[]
    } | null
    const stamped = Object.fromEntries(
      (chat?.subChats ?? []).map((subChat) => [
        subChat.id,
        subChat.binding?.transportId ?? null,
      ]),
    )
    expect(stamped).toEqual(
      Object.fromEntries(
        fixture.subChats.map((subChat) => [
          subChat.subChatId,
          subChat.transportId,
        ]),
      ),
    )
  })

  test('S53 Main stamps transport IDs only on the binding read model — withRuntimeRouteTransportId stamps a copy from a validated test catalog\'s renderer projection, omits transportId for the createRuntimeRouteCatalogForTests failure state (mapped to {state:"not-loaded"} → route_descriptor_unavailable) and never writes the durable binding', async () => {
    // Enforces once runtime-route-read-model.ts, runtime-route-catalog.ts and
    // runtime-route-transport.ts exist (design D1/D3, tasks 5.1).
    const fixture = fixtureKey<S53Fixture>("renderer.json", "S53")
    const db = seedS53(fixture)
    const before = bindingRows(db)
    const prepared = await settle(async () => ({
      readModel: await loadRouteReadModelModule(),
      catalogModule: await loadRouteCatalogModule(),
      transportModule: await loadRouteTransportModule(),
      valid: await buildRecordingCatalog({ delegates: cannedDelegates() }),
      failure: await buildFailureStateCatalog(),
    }))
    expect(prepared.ok ? "modules loaded" : prepared.error).toBe(
      "modules loaded",
    )
    if (!prepared.ok) return
    const { readModel, catalogModule, transportModule, valid, failure } =
      prepared.value
    const { getSubChatBinding } = await import(
      "../src/main/lib/chat-session-binding"
    )
    const validProjection = projectionMap(
      catalogModule.projectRuntimeRoutes("renderer", valid.state),
    )
    const results = fixture.subChats.map((subChat) => {
      const binding = getSubChatBinding(
        db.db,
        subChat.subChatId,
      ) as unknown as Json
      const original = JSON.stringify(binding)
      const stampedValid = readModel.withRuntimeRouteTransportId(
        binding,
        valid.state,
      )
      const stampedFailure = readModel.withRuntimeRouteTransportId(
        binding,
        failure,
      )
      const mappedInput: RouteTransportInput =
        typeof stampedFailure.transportId === "string"
          ? { state: "loaded", transportId: stampedFailure.transportId }
          : { state: "not-loaded" }
      return {
        validTransportId: stampedValid.transportId,
        validRest: pick(stampedValid, fixture.durableBindingKeys),
        failureHasTransportId: Object.hasOwn(stampedFailure, "transportId"),
        failureRest: pick(stampedFailure, fixture.durableBindingKeys),
        originalUntouched: JSON.stringify(binding) === original,
        mappedInput,
        rendererResult: transportModule.createRuntimeRouteTransport(
          mappedInput,
          {
            chatId: fixture.chat.chatId,
            subChatId: subChat.subChatId,
            binding,
            mode: "agent",
          },
        ),
        expectedRest: pick(binding, fixture.durableBindingKeys),
        runtime: String(binding.runtime),
      }
    })
    expect({
      results: results.map(
        ({ expectedRest: _e, runtime: _r, ...rest }) => rest,
      ),
      rows: bindingRows(db),
      constructions: transportConstructions.length,
    }).toEqual({
      results: results.map((result) => ({
        validTransportId: validProjection[result.runtime],
        validRest: result.expectedRest,
        failureHasTransportId: false,
        failureRest: result.expectedRest,
        originalUntouched: true,
        mappedInput: fixture.failureStateMappedInput,
        rendererResult: fixture.failureStateResult,
      })),
      rows: before,
      constructions: 0,
    })
    expect(Object.keys(validProjection).sort()).toEqual(
      fixture.subChats.map((subChat) => String(subChat.binding.runtime)).sort(),
    )
  })

  test("S53 Main stamps transport IDs only on the binding read model — renderer-route-projection-bypass passes the repository and a main composition calling withRuntimeRouteTransportId, and reports a main runtimeId→transportId literal mapping as an unexpected finding", async () => {
    // Enforces once scripts/check-architecture-guards.mjs has the Runtime
    // Route Catalog Single Owner section (design D5, tasks 4.1).
    const fixture = fixtureKey<S53Fixture>("renderer.json", "S53")
    const { observed, expected } = await guardOutcomes("S53", fixture.guard)
    expect(observed).toEqual(expected)
  }, 120_000)
})
