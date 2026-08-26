import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { tmpdir } from "node:os"
import { eq } from "drizzle-orm"
import type { ValidatedAgentScopeContract } from "../src/main/lib/agent-guard"
import * as schema from "../src/main/lib/db/schema"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

type Deferred<T> = {
  promise: Promise<T>
  resolve(value: T): void
}

type ClaudeRunInputsResult = {
  ok: true
  historyEnabled: boolean
  resolvedImages: []
  chatHistory: {
    existingMessages: []
    existingSessionId: null
    resumeAtUuid: null
    shouldForkResume: false
    forkResumeAtUuid: null
    messagesToSave: []
  }
}

type ClaudeRunStartupResult = {
  ok: true
  desktopRunRequest: Record<string, never>
  resumeSessionId: null
  runtimeStartup: Record<string, never>
  isolatedConfigReady: true
  providerStartup: {
    claudeCodeToken: null
    claudeCredentialMetadata: null
    finalCustomConfig: null
    isUsingOllama: false
  }
}

type ClaudeMcpResolution = {
  mcpServersForSdk: Record<string, never>
  mcpReadinessStatus: "ready"
  mcpRegistryVerificationTargets: []
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

let testDb = createAgentJobTestDb()
let codexPreflights: Array<Deferred<{ ok: true; blockers: [] }>> = []
let codexProviderLifecycles: Array<{
  releases: number
  revocations: number
  resolution: Deferred<{
    ok: true
    providerProfile: undefined
    appManagedApiKey: null
    metadataModel: string
    providerBinding: Record<string, unknown>
  }>
}> = []
let codexMcpResolutions: Array<
  Deferred<{
    mcpServersForSession: []
    groups: []
    fingerprint: string
    fetchedAt: number
    toolsResolved: boolean
  }>
> = []
let codexAdapterInvocations = 0
let codexAdapterHook:
  | ((input: {
      guardedContract: ValidatedAgentScopeContract | null
    }) => Promise<void> | void)
  | null = null
let claudeSecretReleases = 0
let claudePreflights: Array<
  Deferred<{
    ok: true
    preflight: { kind: "folderless"; cwd: string }
    runtimeCwd: string
    guardedContract: ValidatedAgentScopeContract | null
    guardedPreRunStatus: null
    permissionPolicy: { controlLevel: "default" }
  }>
> = []
let claudeRunInputs: Array<Deferred<ClaudeRunInputsResult>> = []
let claudeRunStartups: Array<Deferred<ClaudeRunStartupResult>> = []
let claudeMcpResolutions: Array<Deferred<ClaudeMcpResolution>> = []
let claudeRuntimeInvocations = 0
let claudeRuntimeHook: (() => Promise<void> | void) | null = null

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
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`sealed:${value}`, "utf8"),
    decryptString: (value: Buffer) =>
      value.toString("utf8").replace(/^sealed:/, ""),
  },
  shell: {},
}))

mock.module("../src/main/lib/db", () => ({
  ...schema,
  getDatabase: () => testDb,
}))

mock.module("../src/main/lib/codex/runtime-status", () => ({
  getCodexRuntimeStatus: () => {
    const pending = deferred<{ ok: true; blockers: [] }>()
    codexPreflights.push(pending)
    return pending.promise
  },
}))

mock.module("../src/main/lib/codex/desktop-run-provider-binding", () => ({
  createCodexDesktopRunProviderBindingStage: () => {
    const lifecycle = {
      releases: 0,
      revocations: 0,
      resolution: deferred<{
        ok: true
        providerProfile: undefined
        appManagedApiKey: null
        metadataModel: string
        providerBinding: Record<string, unknown>
      }>(),
    }
    codexProviderLifecycles.push(lifecycle)
    return {
      getSecretHints: () => [],
      release: () => {
        lifecycle.releases += 1
      },
      resolve: () => lifecycle.resolution.promise,
      revoke: () => {
        lifecycle.revocations += 1
      },
    }
  },
}))

const {
  prepareClaudeAgentSdkDesktopRunControls: prepareRealClaudeRunControls,
} = await import("../src/main/lib/claude/agent-sdk-desktop-run-controls")
let deferClaudeRunControls = false

mock.module("../src/main/lib/claude/agent-sdk-desktop-run-controls", () => ({
  prepareClaudeAgentSdkDesktopRunControls: (
    input: Parameters<typeof prepareRealClaudeRunControls>[0],
  ) => {
    if (!deferClaudeRunControls) {
      return prepareRealClaudeRunControls(input)
    }
    const pending = deferred<{
      ok: true
      preflight: { kind: "folderless"; cwd: string }
      runtimeCwd: string
      guardedContract: ValidatedAgentScopeContract | null
      guardedPreRunStatus: null
      permissionPolicy: { controlLevel: "default" }
    }>()
    claudePreflights.push(pending)
    return pending.promise
  },
}))

mock.module("../src/main/lib/claude/agent-sdk-desktop-run-inputs", () => ({
  prepareClaudeAgentSdkDesktopRunInputs: () => {
    const pending = deferred<ClaudeRunInputsResult>()
    claudeRunInputs.push(pending)
    return pending.promise
  },
}))

mock.module("../src/main/lib/claude/agent-sdk-desktop-run-startup", () => ({
  prepareClaudeAgentSdkDesktopRunStartup: () => {
    const pending = deferred<ClaudeRunStartupResult>()
    claudeRunStartups.push(pending)
    return pending.promise
  },
}))

mock.module("../src/main/lib/claude/agent-sdk-desktop-run-runtime", () => ({
  runClaudeAgentSdkDesktopRuntimeWithMcpReadiness: async () => {
    claudeRuntimeInvocations += 1
    await claudeRuntimeHook?.()
    return { status: "succeeded", reachedNaturalFinish: true }
  },
}))

mock.module("../src/main/lib/codex/app-server-adapter-runner", () => ({
  runCodexAppServerDesktopAdapter: async (input: {
    guardedContract: ValidatedAgentScopeContract | null
  }) => {
    codexAdapterInvocations += 1
    await codexAdapterHook?.(input)
    return { status: "succeeded" }
  },
}))

mock.module("../src/main/lib/runtime-mcp-config/codex", () => ({
  addCodexMcpServer: async () => ({}),
  clearCodexMcpConfigCache: () => {},
  createEmptyCodexMcpSnapshot: ({
    toolsResolved,
  }: {
    toolsResolved: boolean
  }) => ({
    mcpServersForSession: [],
    groups: [],
    fingerprint: "empty",
    fetchedAt: 0,
    toolsResolved,
  }),
  getAllCodexMcpConfigHandler: async () => [],
  logoutCodexMcpServer: async () => ({}),
  removeCodexMcpServer: async () => ({}),
  resolveCodexMcpSnapshotForDesktopRun: () => {
    const pending = deferred<{
      mcpServersForSession: []
      groups: []
      fingerprint: string
      fetchedAt: number
      toolsResolved: boolean
    }>()
    codexMcpResolutions.push(pending)
    return pending.promise
  },
  startCodexMcpOAuth: async () => ({}),
}))

mock.module("../src/main/lib/runtime-mcp-config/claude", () => ({
  addClaudeMcpServer: async () => ({}),
  clearClaudeCaches: () => {},
  getAllMcpConfigHandler: async () => [],
  getClaudeMcpAuthStatus: async () => ({}),
  getClaudeMcpConfig: async () => ({}),
  getPendingPluginMcpApprovals: async () => [],
  refreshClaudeMcpConfig: () => {},
  removeClaudeMcpServer: async () => ({}),
  resolveClaudeMcpServersForSdk: () => {
    const pending = deferred<ClaudeMcpResolution>()
    claudeMcpResolutions.push(pending)
    return pending.promise
  },
  setClaudeMcpBearerToken: async () => ({}),
  startClaudeMcpOAuth: async () => ({}),
  updateClaudeMcpServer: async () => ({}),
}))

mock.module("../src/main/lib/claude/agent-sdk-runtime-secrets", () => ({
  createClaudeAgentSdkRuntimeSecretLifecycle: () => ({
    register: () => {},
    getSecretHints: () => [],
    revoke: () => {},
    release: () => {
      claudeSecretReleases += 1
    },
  }),
}))

const {
  clearActiveCodexStreamsForTest,
  getActiveCodexStream,
  setActiveCodexStream,
} = await import("../src/main/lib/codex/active-streams")
const {
  clearClaudeActiveSessionsForTest,
  getActiveClaudeSession,
  setActiveClaudeSession,
} = await import("../src/main/lib/claude/active-sessions")
const { clearDesktopRunAdmissionsForTest } = await import(
  "../src/main/lib/agent-runtime/desktop-run-admission-generation"
)
const {
  acquireChatMaintenanceFence,
  clearChatMaintenanceFencesForTest,
  releaseChatMaintenanceFence,
} = await import("../src/main/lib/agent-runtime/chat-maintenance-fence")
const {
  clearActiveGuardedContractsForTest,
  isActiveGuardedContract,
  registerActiveGuardedScopeExpansionRequest,
  replaceActiveGuardedContractForSubChat,
} = await import("../src/main/lib/agent-guard")
const { codexRouter } = await import("../src/main/lib/trpc/routers/codex")
const { claudeRouter } = await import("../src/main/lib/trpc/routers/claude")

function seedBinding(input: {
  chatId: string
  subChatId: string
  runtime: "codex" | "claude-code"
}): void {
  testDb.insert(schema.chats).values({ id: input.chatId }).run()
  testDb
    .insert(schema.subChats)
    .values({ id: input.subChatId, chatId: input.chatId })
    .run()
  testDb
    .insert(schema.subChatBindings)
    .values({
      id: `binding-${input.subChatId}`,
      subChatId: input.subChatId,
      runtime: input.runtime,
      modelId:
        input.runtime === "codex" ? "gpt-5.5" : "claude-sonnet-4-20250514",
      modelSource: input.runtime === "codex" ? "chatgpt" : "claude-oauth",
      thinkingLevel: input.runtime === "codex" ? "high" : null,
    })
    .run()
}

function mutateBindingModel(subChatId: string, modelId: string): void {
  testDb
    .update(schema.subChatBindings)
    .set({ modelId, updatedAt: new Date() })
    .where(eq(schema.subChatBindings.subChatId, subChatId))
    .run()
}

function seedProviderProfile(input: {
  id: string
  targetRuntimesJson: string
}): void {
  testDb
    .insert(schema.agentProviderProfiles)
    .values({
      id: input.id,
      name: input.id,
      protocol: "openai-responses",
      baseUrl: "https://provider.example.com/v1",
      defaultModel: "provider-model",
      authMode: "none",
      targetRuntimesJson: input.targetRuntimesJson,
      capabilitiesJson: "{}",
    })
    .run()
}

function createGuardedContract(input: {
  chatId: string
  subChatId: string
  runId: string
  cwd: string
}): ValidatedAgentScopeContract {
  return {
    id: `contract-${input.runId}`,
    version: 1,
    status: "approved",
    createdAt: "2026-08-26T00:00:00.000Z",
    approvedAt: "2026-08-26T00:00:00.000Z",
    source: "manual",
    chatId: input.chatId,
    subChatId: input.subChatId,
    runId: input.runId,
    cwd: input.cwd,
    projectPath: input.cwd,
    editableScope: [{ path: "src", kind: "directory" }],
    readOnlyEvidence: [],
    successChecks: [],
    blockedPaths: [],
    expansions: [],
  }
}

async function startSubscription<T>(
  streamPromise: Promise<{
    subscribe(observer: {
      next(value: T): void
      error(error: unknown): void
      complete(): void
    }): { unsubscribe(): void }
  }>,
) {
  const chunks: T[] = []
  let completed = false
  let observedError: unknown = null
  const stream = await streamPromise
  const subscription = stream.subscribe({
    next: (chunk) => chunks.push(chunk),
    error: (error) => {
      observedError = error
    },
    complete: () => {
      completed = true
    },
  })
  return {
    chunks,
    get completed() {
      return completed
    },
    get error() {
      return observedError
    },
    subscription,
  }
}

async function waitFor(assertion: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (assertion()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  throw new Error("Timed out waiting for deterministic preflight transition")
}

function chunkTypes(chunks: readonly unknown[]): Array<string | undefined> {
  return chunks.map((chunk) => {
    if (!chunk || typeof chunk !== "object" || !("type" in chunk)) {
      return undefined
    }
    return typeof chunk.type === "string" ? chunk.type : undefined
  })
}

beforeEach(() => {
  deferClaudeRunControls = true
  testDb = createAgentJobTestDb()
  codexPreflights = []
  codexProviderLifecycles = []
  codexMcpResolutions = []
  codexAdapterInvocations = 0
  codexAdapterHook = null
  claudeSecretReleases = 0
  claudePreflights = []
  claudeRunInputs = []
  claudeRunStartups = []
  claudeMcpResolutions = []
  claudeRuntimeInvocations = 0
  claudeRuntimeHook = null
  clearActiveCodexStreamsForTest()
  clearClaudeActiveSessionsForTest()
  clearDesktopRunAdmissionsForTest()
  clearChatMaintenanceFencesForTest()
  clearActiveGuardedContractsForTest()
})

afterEach(() => {
  deferClaudeRunControls = false
  clearActiveCodexStreamsForTest()
  clearClaudeActiveSessionsForTest()
  clearDesktopRunAdmissionsForTest()
  clearChatMaintenanceFencesForTest()
  clearActiveGuardedContractsForTest()
})

describe("desktop Run latest-admission generation", () => {
  test("prevents an older slow Codex preflight from replacing a newer admitted Run", async () => {
    seedBinding({
      chatId: "chat-codex-race",
      subChatId: "sub-codex-race",
      runtime: "codex",
    })
    const originalController = new AbortController()
    setActiveCodexStream("sub-codex-race", {
      runId: "original-codex",
      controller: originalController,
      cancelRequested: false,
    })
    const caller = codexRouter.createCaller({ getWindow: () => null })
    const older = await startSubscription(
      caller.chat({
        chatId: "chat-codex-race",
        subChatId: "sub-codex-race",
        runId: "codex-older",
        prompt: "older",
        model: "gpt-5.5/high",
        codexAuthMethod: "chatgpt",
      }),
    )
    const newer = await startSubscription(
      caller.chat({
        chatId: "chat-codex-race",
        subChatId: "sub-codex-race",
        runId: "codex-newer",
        prompt: "newer",
        model: "gpt-5.5/high",
        codexAuthMethod: "chatgpt",
      }),
    )
    expect(codexPreflights).toHaveLength(2)

    codexPreflights[1]?.resolve({ ok: true, blockers: [] })
    await waitFor(
      () => getActiveCodexStream("sub-codex-race")?.runId === "codex-newer",
    )
    const newerActive = getActiveCodexStream("sub-codex-race")
    expect(originalController.signal.aborted).toBe(true)
    expect(newerActive?.controller.signal.aborted).toBe(false)

    codexPreflights[0]?.resolve({ ok: true, blockers: [] })
    await waitFor(() => older.completed)
    expect(getActiveCodexStream("sub-codex-race")).toBe(newerActive)
    expect(newerActive?.controller.signal.aborted).toBe(false)
    expect(older.error).toBeNull()

    newer.subscription.unsubscribe()
    older.subscription.unsubscribe()
  })

  test("publishes the exact Codex guarded winner before adapter scope expansion and cleans it by identity", async () => {
    const chatId = "chat-codex-guard-publication"
    const subChatId = "sub-codex-guard-publication"
    const projectId = "project-codex-guard-publication"
    const runtimeCwd = process.cwd()
    testDb
      .insert(schema.projects)
      .values({ id: projectId, name: "Guarded project", path: runtimeCwd })
      .run()
    testDb.insert(schema.chats).values({ id: chatId, projectId }).run()
    testDb.insert(schema.subChats).values({ id: subChatId, chatId }).run()
    testDb
      .insert(schema.subChatBindings)
      .values({
        id: `binding-${subChatId}`,
        subChatId,
        runtime: "codex",
        modelId: "gpt-5.5",
        modelSource: "chatgpt",
        thinkingLevel: "high",
      })
      .run()

    const scopeContract = createGuardedContract({
      chatId,
      subChatId,
      runId: "run-codex-guard-publication",
      cwd: runtimeCwd,
    })
    const adapterRelease = deferred<undefined>()
    let adapterContract: ValidatedAgentScopeContract | null = null
    let expansionRegistered = false
    codexAdapterHook = async (input) => {
      adapterContract = input.guardedContract
      if (!input.guardedContract) {
        throw new Error("Expected guarded Codex adapter input")
      }
      expansionRegistered = registerActiveGuardedScopeExpansionRequest({
        contract: input.guardedContract,
        event: {
          id: "scope-request-codex-router",
          runId: "run-codex-guard-publication",
          contractId: input.guardedContract.id,
          type: "scope-expansion-request",
          toolName: "Edit",
          toolUseId: "runtime-tool-codex-router",
          path: "tests",
          paths: ["tests"],
          reason: "Codex adapter requested canonical test scope.",
          createdAt: "2026-08-26T00:00:01.000Z",
        },
      })
      await adapterRelease.promise
    }

    const caller = codexRouter.createCaller({ getWindow: () => null })
    const candidate = await startSubscription(
      caller.chat({
        chatId,
        subChatId,
        runId: "run-codex-guard-publication",
        prompt: "exercise guarded scope expansion",
        model: "gpt-5.5/high",
        codexAuthMethod: "chatgpt",
        cwd: runtimeCwd,
        projectPath: runtimeCwd,
        scopeContract,
      }),
    )
    await waitFor(() => codexPreflights.length === 1)
    codexPreflights[0]?.resolve({ ok: true, blockers: [] })
    await waitFor(
      () =>
        getActiveCodexStream(subChatId)?.runId ===
          "run-codex-guard-publication" || candidate.completed,
    )
    expect(candidate.chunks).not.toContainEqual(
      expect.objectContaining({ type: "error" }),
    )
    codexProviderLifecycles[0]?.resolution.resolve({
      ok: true,
      providerProfile: undefined,
      appManagedApiKey: null,
      metadataModel: "gpt-5.5",
      providerBinding: {},
    })
    await waitFor(() => codexMcpResolutions.length === 1)
    codexMcpResolutions[0]?.resolve({
      mcpServersForSession: [],
      groups: [],
      fingerprint: "guarded",
      fetchedAt: 1,
      toolsResolved: true,
    })
    await waitFor(() => expansionRegistered)

    const publishedContract = adapterContract
    if (!publishedContract) throw new Error("Expected published guard contract")
    expect(isActiveGuardedContract(publishedContract)).toBe(true)
    expect(adapterContract).toBe(publishedContract)
    const expansionResponse = await claudeRouter
      .createCaller({ getWindow: () => null })
      .respondScopeExpansion({
        requestId: "scope-request-codex-router",
        approved: true,
      })
    expect(expansionResponse.ok).toBe(true)
    if (!expansionResponse.ok) {
      throw new Error(expansionResponse.error)
    }
    expect(expansionResponse.contract).toBe(publishedContract)
    expect(
      expansionResponse.contract.editableScope.map((scope) => scope.path),
    ).toContain("tests")

    adapterRelease.resolve(undefined)
    await waitFor(
      () => candidate.completed && !isActiveGuardedContract(publishedContract),
    )
    expect(candidate.error).toBeNull()
    candidate.subscription.unsubscribe()
  })

  test("an unguarded Codex winner revokes the prior guarded owner", async () => {
    const chatId = "chat-codex-unguarded-winner"
    const subChatId = "sub-codex-unguarded-winner"
    seedBinding({ chatId, subChatId, runtime: "codex" })
    const staleContract = createGuardedContract({
      chatId,
      subChatId,
      runId: "run-stale-guarded",
      cwd: "/tmp/stale-codex-guard",
    })
    replaceActiveGuardedContractForSubChat(
      staleContract.subChatId,
      staleContract,
    )

    const candidate = await startSubscription(
      codexRouter.createCaller({ getWindow: () => null }).chat({
        chatId,
        subChatId,
        runId: "run-unguarded-winner",
        prompt: "replace guarded owner",
        model: "gpt-5.5/high",
        codexAuthMethod: "chatgpt",
      }),
    )
    codexPreflights[0]?.resolve({ ok: true, blockers: [] })
    await waitFor(
      () => getActiveCodexStream(subChatId)?.runId === "run-unguarded-winner",
    )

    expect(isActiveGuardedContract(staleContract)).toBe(false)
    candidate.subscription.unsubscribe()
  })

  test("prevents replaced Codex A from persisting its user message after the same run id installs B", async () => {
    seedBinding({
      chatId: "chat-codex-user-write-race",
      subChatId: "sub-codex-user-write-race",
      runtime: "codex",
    })
    const caller = codexRouter.createCaller({ getWindow: () => null })
    const runInput = {
      chatId: "chat-codex-user-write-race",
      subChatId: "sub-codex-user-write-race",
      runId: "run-shared",
      model: "gpt-5.5/high",
      codexAuthMethod: "chatgpt" as const,
    }
    const candidateA = await startSubscription(
      caller.chat({ ...runInput, prompt: "stale A prompt" }),
    )
    codexPreflights[0]?.resolve({ ok: true, blockers: [] })
    await waitFor(
      () =>
        getActiveCodexStream("sub-codex-user-write-race")?.runId ===
          "run-shared" && codexProviderLifecycles.length === 1,
    )
    const ownerA = getActiveCodexStream("sub-codex-user-write-race")

    const candidateB = await startSubscription(
      caller.chat({ ...runInput, prompt: "current B prompt" }),
    )
    codexPreflights[1]?.resolve({ ok: true, blockers: [] })
    await waitFor(() => {
      const current = getActiveCodexStream("sub-codex-user-write-race")
      return current !== undefined && current !== ownerA
    })
    const ownerB = getActiveCodexStream("sub-codex-user-write-race")
    expect(ownerB?.runId).toBe("run-shared")
    expect(ownerB?.controller.signal.aborted).toBe(false)

    codexProviderLifecycles[0]?.resolution.resolve({
      ok: true,
      providerProfile: undefined,
      appManagedApiKey: null,
      metadataModel: "gpt-5.5",
      providerBinding: {},
    })
    await waitFor(
      () => candidateA.completed && codexProviderLifecycles[0]?.releases === 1,
    )

    const stored = testDb
      .select({ messages: schema.subChats.messages })
      .from(schema.subChats)
      .where(eq(schema.subChats.id, "sub-codex-user-write-race"))
      .get()
    expect(JSON.parse(stored?.messages ?? "[]")).toEqual([])
    expect(getActiveCodexStream("sub-codex-user-write-race")).toBe(ownerB)
    expect(ownerB?.controller.signal.aborted).toBe(false)
    expect(candidateA.error).toBeNull()
    expect(chunkTypes(candidateA.chunks)).toContain("finish")

    candidateB.subscription.unsubscribe()
    candidateA.subscription.unsubscribe()
  })

  test("prevents replaced Codex A from registering a job or dispatching after deferred MCP resolution", async () => {
    seedBinding({
      chatId: "chat-codex-mcp-owner-race",
      subChatId: "sub-codex-mcp-owner-race",
      runtime: "codex",
    })
    const caller = codexRouter.createCaller({ getWindow: () => null })
    const runInput = {
      chatId: "chat-codex-mcp-owner-race",
      subChatId: "sub-codex-mcp-owner-race",
      runId: "run-shared",
      model: "gpt-5.5/high",
      codexAuthMethod: "chatgpt" as const,
    }
    const candidateA = await startSubscription(
      caller.chat({ ...runInput, prompt: "candidate A" }),
    )
    codexPreflights[0]?.resolve({ ok: true, blockers: [] })
    await waitFor(
      () =>
        getActiveCodexStream("sub-codex-mcp-owner-race")?.runId ===
          "run-shared" && codexProviderLifecycles.length === 1,
    )
    const ownerA = getActiveCodexStream("sub-codex-mcp-owner-race")
    codexProviderLifecycles[0]?.resolution.resolve({
      ok: true,
      providerProfile: undefined,
      appManagedApiKey: null,
      metadataModel: "gpt-5.5",
      providerBinding: {},
    })
    await waitFor(() => codexMcpResolutions.length === 1)

    const candidateB = await startSubscription(
      caller.chat({ ...runInput, prompt: "candidate B" }),
    )
    codexPreflights[1]?.resolve({ ok: true, blockers: [] })
    await waitFor(() => {
      const current = getActiveCodexStream("sub-codex-mcp-owner-race")
      return current !== undefined && current !== ownerA
    })
    const ownerB = getActiveCodexStream("sub-codex-mcp-owner-race")
    expect(ownerB?.runId).toBe("run-shared")
    expect(ownerA?.controller.signal.aborted).toBe(true)

    codexMcpResolutions[0]?.resolve({
      mcpServersForSession: [],
      groups: [],
      fingerprint: "candidate-a",
      fetchedAt: 1,
      toolsResolved: true,
    })
    await waitFor(() => candidateA.completed)

    expect(codexAdapterInvocations).toBe(0)
    expect(
      testDb.select({ id: schema.agentJobs.id }).from(schema.agentJobs).all(),
    ).toEqual([])
    expect(getActiveCodexStream("sub-codex-mcp-owner-race")).toBe(ownerB)
    expect(ownerB?.controller.signal.aborted).toBe(false)
    expect(candidateA.error).toBeNull()

    candidateB.subscription.unsubscribe()
    candidateA.subscription.unsubscribe()
  })

  test("keeps rollback BUSY when Codex B settles before the replaced A lifecycle", async () => {
    const chatId = "chat-codex-overlapping-drain"
    const subChatId = "sub-codex-overlapping-drain"
    seedBinding({ chatId, subChatId, runtime: "codex" })
    const caller = codexRouter.createCaller({ getWindow: () => null })
    const adapterSettlements: Array<Deferred<void>> = []
    codexAdapterHook = () => {
      const settlement = deferred<void>()
      adapterSettlements.push(settlement)
      return settlement.promise
    }
    const runInput = {
      chatId,
      subChatId,
      runId: "run-shared",
      model: "gpt-5.5/high",
      codexAuthMethod: "chatgpt" as const,
    }

    const candidateA = await startSubscription(
      caller.chat({ ...runInput, prompt: "candidate A" }),
    )
    codexPreflights[0]?.resolve({ ok: true, blockers: [] })
    await waitFor(() => getActiveCodexStream(subChatId) !== undefined)
    const ownerA = getActiveCodexStream(subChatId)
    codexProviderLifecycles[0]?.resolution.resolve({
      ok: true,
      providerProfile: undefined,
      appManagedApiKey: null,
      metadataModel: "gpt-5.5",
      providerBinding: {},
    })
    await waitFor(() => codexMcpResolutions.length === 1)
    codexMcpResolutions[0]?.resolve({
      mcpServersForSession: [],
      groups: [],
      fingerprint: "candidate-a",
      fetchedAt: 1,
      toolsResolved: true,
    })
    await waitFor(() => adapterSettlements.length === 1)

    const candidateB = await startSubscription(
      caller.chat({ ...runInput, prompt: "candidate B" }),
    )
    codexPreflights[1]?.resolve({ ok: true, blockers: [] })
    await waitFor(() => {
      const current = getActiveCodexStream(subChatId)
      return current !== undefined && current !== ownerA
    })
    expect(ownerA?.controller.signal.aborted).toBe(true)
    codexProviderLifecycles[1]?.resolution.resolve({
      ok: true,
      providerProfile: undefined,
      appManagedApiKey: null,
      metadataModel: "gpt-5.5",
      providerBinding: {},
    })
    await waitFor(() => codexMcpResolutions.length === 2)
    codexMcpResolutions[1]?.resolve({
      mcpServersForSession: [],
      groups: [],
      fingerprint: "candidate-b",
      fetchedAt: 2,
      toolsResolved: true,
    })
    await waitFor(() => adapterSettlements.length === 2)

    adapterSettlements[1]?.resolve()
    await waitFor(
      () =>
        candidateB.completed && getActiveCodexStream(subChatId) === undefined,
    )
    expect(acquireChatMaintenanceFence(subChatId)).toEqual({
      ok: false,
      error: {
        code: "SESSION_BINDING_BUSY",
        subChatId,
        operation: "rollback",
        activeRunId: "run-shared",
        reason: "active-run",
      },
    })

    adapterSettlements[0]?.resolve()
    await waitFor(() => candidateA.completed)
    const maintenance = acquireChatMaintenanceFence(subChatId)
    expect(maintenance.ok).toBe(true)
    if (maintenance.ok) {
      expect(releaseChatMaintenanceFence(maintenance.fence)).toBe(true)
    }

    candidateB.subscription.unsubscribe()
    candidateA.subscription.unsubscribe()
  })

  test("prevents an older slow Claude preflight from replacing a newer admitted Run", async () => {
    seedBinding({
      chatId: "chat-claude-race",
      subChatId: "sub-claude-race",
      runtime: "claude-code",
    })
    const originalController = new AbortController()
    setActiveClaudeSession("sub-claude-race", {
      runId: "original-claude",
      controller: originalController,
    })
    const sharedGuardId = "contract-claude-race"
    const sentinelGuard = {
      ...createGuardedContract({
        chatId: "chat-claude-race",
        subChatId: "sub-claude-race",
        runId: "original-claude",
        cwd: "/tmp/claude-original",
      }),
      id: sharedGuardId,
    }
    const olderGuard = {
      ...createGuardedContract({
        chatId: "chat-claude-race",
        subChatId: "sub-claude-race",
        runId: "claude-older",
        cwd: "/tmp/claude-older",
      }),
      id: sharedGuardId,
    }
    const newerGuard = {
      ...createGuardedContract({
        chatId: "chat-claude-race",
        subChatId: "sub-claude-race",
        runId: "claude-newer",
        cwd: "/tmp/claude-newer",
      }),
      id: sharedGuardId,
    }
    replaceActiveGuardedContractForSubChat(
      sentinelGuard.subChatId,
      sentinelGuard,
    )
    const caller = claudeRouter.createCaller({ getWindow: () => null })
    const older = await startSubscription(
      caller.chat({
        chatId: "chat-claude-race",
        subChatId: "sub-claude-race",
        runId: "claude-older",
        prompt: "older",
        model: "claude-sonnet-4-20250514",
        modelSource: "claude-oauth",
      }),
    )
    const newer = await startSubscription(
      caller.chat({
        chatId: "chat-claude-race",
        subChatId: "sub-claude-race",
        runId: "claude-newer",
        prompt: "newer",
        model: "claude-sonnet-4-20250514",
        modelSource: "claude-oauth",
      }),
    )
    expect(claudePreflights).toHaveLength(2)

    claudePreflights[1]?.resolve({
      ok: true,
      preflight: { kind: "folderless", cwd: "/tmp/claude-newer" },
      runtimeCwd: "/tmp/claude-newer",
      guardedContract: newerGuard,
      guardedPreRunStatus: null,
      permissionPolicy: { controlLevel: "default" },
    })
    await waitFor(
      () => getActiveClaudeSession("sub-claude-race")?.runId === "claude-newer",
    )
    const newerActive = getActiveClaudeSession("sub-claude-race")
    expect(originalController.signal.aborted).toBe(true)
    expect(newerActive?.controller.signal.aborted).toBe(false)
    expect(isActiveGuardedContract(newerGuard)).toBe(true)

    claudePreflights[0]?.resolve({
      ok: true,
      preflight: { kind: "folderless", cwd: "/tmp/claude-older" },
      runtimeCwd: "/tmp/claude-older",
      guardedContract: olderGuard,
      guardedPreRunStatus: null,
      permissionPolicy: { controlLevel: "default" },
    })
    await waitFor(() => older.completed)
    expect(getActiveClaudeSession("sub-claude-race")).toBe(newerActive)
    expect(newerActive?.controller.signal.aborted).toBe(false)
    expect(isActiveGuardedContract(newerGuard)).toBe(true)
    expect(older.error).toBeNull()

    newer.subscription.unsubscribe()
    older.subscription.unsubscribe()
  })

  test("prevents replaced Claude A from dispatching the runtime after deferred MCP resolution", async () => {
    seedBinding({
      chatId: "chat-claude-mcp-owner-race",
      subChatId: "sub-claude-mcp-owner-race",
      runtime: "claude-code",
    })
    const caller = claudeRouter.createCaller({ getWindow: () => null })
    const runInput = {
      chatId: "chat-claude-mcp-owner-race",
      subChatId: "sub-claude-mcp-owner-race",
      runId: "run-shared",
      model: "claude-sonnet-4-20250514",
      modelSource: "claude-oauth" as const,
    }
    const candidateA = await startSubscription(
      caller.chat({ ...runInput, prompt: "candidate A" }),
    )
    claudePreflights[0]?.resolve({
      ok: true,
      preflight: { kind: "folderless", cwd: "/tmp/claude-mcp-owner-race" },
      runtimeCwd: "/tmp/claude-mcp-owner-race",
      guardedContract: null,
      guardedPreRunStatus: null,
      permissionPolicy: { controlLevel: "default" },
    })
    await waitFor(
      () =>
        getActiveClaudeSession("sub-claude-mcp-owner-race")?.runId ===
          "run-shared" && claudeRunInputs.length === 1,
    )
    const ownerA = getActiveClaudeSession("sub-claude-mcp-owner-race")
    claudeRunInputs[0]?.resolve({
      ok: true,
      historyEnabled: false,
      resolvedImages: [],
      chatHistory: {
        existingMessages: [],
        existingSessionId: null,
        resumeAtUuid: null,
        shouldForkResume: false,
        forkResumeAtUuid: null,
        messagesToSave: [],
      },
    })
    await waitFor(() => claudeRunStartups.length === 1)
    claudeRunStartups[0]?.resolve({
      ok: true,
      desktopRunRequest: {},
      resumeSessionId: null,
      runtimeStartup: {},
      isolatedConfigReady: true,
      providerStartup: {
        claudeCodeToken: null,
        claudeCredentialMetadata: null,
        finalCustomConfig: null,
        isUsingOllama: false,
      },
    })
    await waitFor(() => claudeMcpResolutions.length === 1)

    const candidateB = await startSubscription(
      caller.chat({ ...runInput, prompt: "candidate B" }),
    )
    claudePreflights[1]?.resolve({
      ok: true,
      preflight: { kind: "folderless", cwd: "/tmp/claude-mcp-owner-race" },
      runtimeCwd: "/tmp/claude-mcp-owner-race",
      guardedContract: null,
      guardedPreRunStatus: null,
      permissionPolicy: { controlLevel: "default" },
    })
    await waitFor(() => {
      const current = getActiveClaudeSession("sub-claude-mcp-owner-race")
      return current !== undefined && current !== ownerA
    })
    const ownerB = getActiveClaudeSession("sub-claude-mcp-owner-race")
    expect(ownerB?.runId).toBe("run-shared")
    expect(ownerA?.controller.signal.aborted).toBe(true)

    claudeMcpResolutions[0]?.resolve({
      mcpServersForSdk: {},
      mcpReadinessStatus: "ready",
      mcpRegistryVerificationTargets: [],
    })
    await waitFor(() => candidateA.completed)

    expect(claudeRuntimeInvocations).toBe(0)
    expect(getActiveClaudeSession("sub-claude-mcp-owner-race")).toBe(ownerB)
    expect(ownerB?.controller.signal.aborted).toBe(false)
    expect(candidateA.error).toBeNull()

    candidateB.subscription.unsubscribe()
    candidateA.subscription.unsubscribe()
  })

  test("keeps rollback BUSY when Claude B settles before the replaced A lifecycle", async () => {
    const chatId = "chat-claude-overlapping-drain"
    const subChatId = "sub-claude-overlapping-drain"
    seedBinding({ chatId, subChatId, runtime: "claude-code" })
    const caller = claudeRouter.createCaller({ getWindow: () => null })
    const runtimeSettlements: Array<Deferred<void>> = []
    claudeRuntimeHook = () => {
      const settlement = deferred<void>()
      runtimeSettlements.push(settlement)
      return settlement.promise
    }
    const runInput = {
      chatId,
      subChatId,
      runId: "run-shared",
      model: "claude-sonnet-4-20250514",
      modelSource: "claude-oauth" as const,
    }
    const resolveControls = (index: number) => {
      claudePreflights[index]?.resolve({
        ok: true,
        preflight: { kind: "folderless", cwd: "/tmp/claude-overlap" },
        runtimeCwd: "/tmp/claude-overlap",
        guardedContract: null,
        guardedPreRunStatus: null,
        permissionPolicy: { controlLevel: "default" },
      })
    }
    const resolveInputs = (index: number) => {
      claudeRunInputs[index]?.resolve({
        ok: true,
        historyEnabled: false,
        resolvedImages: [],
        chatHistory: {
          existingMessages: [],
          existingSessionId: null,
          resumeAtUuid: null,
          shouldForkResume: false,
          forkResumeAtUuid: null,
          messagesToSave: [],
        },
      })
    }
    const resolveStartup = (index: number) => {
      claudeRunStartups[index]?.resolve({
        ok: true,
        desktopRunRequest: {},
        resumeSessionId: null,
        runtimeStartup: {},
        isolatedConfigReady: true,
        providerStartup: {
          claudeCodeToken: null,
          claudeCredentialMetadata: null,
          finalCustomConfig: null,
          isUsingOllama: false,
        },
      })
    }
    const resolveMcp = (index: number) => {
      claudeMcpResolutions[index]?.resolve({
        mcpServersForSdk: {},
        mcpReadinessStatus: "ready",
        mcpRegistryVerificationTargets: [],
      })
    }

    const candidateA = await startSubscription(
      caller.chat({ ...runInput, prompt: "candidate A" }),
    )
    resolveControls(0)
    await waitFor(() => claudeRunInputs.length === 1)
    const ownerA = getActiveClaudeSession(subChatId)
    resolveInputs(0)
    await waitFor(() => claudeRunStartups.length === 1)
    resolveStartup(0)
    await waitFor(() => claudeMcpResolutions.length === 1)
    resolveMcp(0)
    await waitFor(() => runtimeSettlements.length === 1)

    const candidateB = await startSubscription(
      caller.chat({ ...runInput, prompt: "candidate B" }),
    )
    resolveControls(1)
    await waitFor(() => {
      const current = getActiveClaudeSession(subChatId)
      return current !== undefined && current !== ownerA
    })
    expect(ownerA?.controller.signal.aborted).toBe(true)
    await waitFor(() => claudeRunInputs.length === 2)
    resolveInputs(1)
    await waitFor(() => claudeRunStartups.length === 2)
    resolveStartup(1)
    await waitFor(() => claudeMcpResolutions.length === 2)
    resolveMcp(1)
    await waitFor(() => runtimeSettlements.length === 2)

    runtimeSettlements[1]?.resolve()
    await waitFor(
      () =>
        getActiveClaudeSession(subChatId) === undefined &&
        claudeSecretReleases >= 1,
    )
    expect(acquireChatMaintenanceFence(subChatId)).toEqual({
      ok: false,
      error: {
        code: "SESSION_BINDING_BUSY",
        subChatId,
        operation: "rollback",
        activeRunId: "run-shared",
        reason: "active-run",
      },
    })

    runtimeSettlements[0]?.resolve()
    await waitFor(() => claudeSecretReleases >= 2)
    const maintenance = acquireChatMaintenanceFence(subChatId)
    expect(maintenance.ok).toBe(true)
    if (maintenance.ok) {
      expect(releaseChatMaintenanceFence(maintenance.fence)).toBe(true)
    }

    candidateB.subscription.unsubscribe()
    candidateA.subscription.unsubscribe()
  })

  test("rejects a Codex candidate when its binding changes during deferred preflight", async () => {
    seedBinding({
      chatId: "chat-codex-binding-mutation",
      subChatId: "sub-codex-binding-mutation",
      runtime: "codex",
    })
    const sentinelController = new AbortController()
    const sentinel = {
      runId: "sentinel-codex-binding-mutation",
      controller: sentinelController,
      cancelRequested: false,
    }
    setActiveCodexStream("sub-codex-binding-mutation", sentinel)
    const guardedContractSentinel = createGuardedContract({
      chatId: "chat-codex-binding-mutation",
      subChatId: "sub-codex-binding-mutation",
      runId: "sentinel-codex-binding-mutation",
      cwd: "/tmp/codex-binding-mutation",
    })
    replaceActiveGuardedContractForSubChat(
      guardedContractSentinel.subChatId,
      guardedContractSentinel,
    )

    const candidate = await startSubscription(
      codexRouter.createCaller({ getWindow: () => null }).chat({
        chatId: "chat-codex-binding-mutation",
        subChatId: "sub-codex-binding-mutation",
        runId: "candidate-codex-binding-mutation",
        prompt: "must be rejected after the durable binding changes",
        model: "gpt-5.5/high",
        codexAuthMethod: "chatgpt",
      }),
    )
    expect(codexPreflights).toHaveLength(1)
    expect(codexProviderLifecycles).toHaveLength(1)

    mutateBindingModel("sub-codex-binding-mutation", "gpt-5.6")
    codexPreflights[0]?.resolve({ ok: true, blockers: [] })

    await waitFor(
      () => candidate.completed && codexProviderLifecycles[0]?.releases === 1,
    )
    expect(chunkTypes(candidate.chunks)).toEqual(["error", "finish"])
    expect(getActiveCodexStream("sub-codex-binding-mutation")).toBe(sentinel)
    expect(sentinelController.signal.aborted).toBe(false)
    expect(sentinel.cancelRequested).toBe(false)
    expect(isActiveGuardedContract(guardedContractSentinel)).toBe(true)
    expect(codexProviderLifecycles[0]?.revocations).toBeGreaterThanOrEqual(1)
    expect(candidate.error).toBeNull()

    candidate.subscription.unsubscribe()
  })

  test("rejects a Claude candidate when its binding changes during deferred preflight", async () => {
    seedBinding({
      chatId: "chat-claude-binding-mutation",
      subChatId: "sub-claude-binding-mutation",
      runtime: "claude-code",
    })
    const sentinelController = new AbortController()
    const sentinel = {
      runId: "sentinel-claude-binding-mutation",
      controller: sentinelController,
    }
    setActiveClaudeSession("sub-claude-binding-mutation", sentinel)
    const guardedContractSentinel = createGuardedContract({
      chatId: "chat-claude-binding-mutation",
      subChatId: "sub-claude-binding-mutation",
      runId: "sentinel-claude-binding-mutation",
      cwd: "/tmp/claude-binding-mutation",
    })
    const guardedContractCandidate = {
      ...createGuardedContract({
        chatId: "chat-claude-binding-mutation",
        subChatId: "sub-claude-binding-mutation",
        runId: "candidate-claude-binding-mutation",
        cwd: "/tmp/claude-binding-mutation",
      }),
      id: guardedContractSentinel.id,
    }
    replaceActiveGuardedContractForSubChat(
      guardedContractSentinel.subChatId,
      guardedContractSentinel,
    )

    const candidate = await startSubscription(
      claudeRouter.createCaller({ getWindow: () => null }).chat({
        chatId: "chat-claude-binding-mutation",
        subChatId: "sub-claude-binding-mutation",
        runId: "candidate-claude-binding-mutation",
        prompt: "must be rejected after the durable binding changes",
        model: "claude-sonnet-4-20250514",
        modelSource: "claude-oauth",
      }),
    )
    expect(claudePreflights).toHaveLength(1)

    mutateBindingModel("sub-claude-binding-mutation", "claude-opus-4-20250514")
    claudePreflights[0]?.resolve({
      ok: true,
      preflight: {
        kind: "folderless",
        cwd: "/tmp/claude-binding-mutation",
      },
      runtimeCwd: "/tmp/claude-binding-mutation",
      guardedContract: guardedContractCandidate,
      guardedPreRunStatus: null,
      permissionPolicy: { controlLevel: "default" },
    })

    await waitFor(() => candidate.completed && claudeSecretReleases === 1)
    expect(chunkTypes(candidate.chunks)).toEqual(["error", "finish"])
    expect(getActiveClaudeSession("sub-claude-binding-mutation")).toBe(sentinel)
    expect(sentinelController.signal.aborted).toBe(false)
    expect(isActiveGuardedContract(guardedContractSentinel)).toBe(true)
    expect(candidate.error).toBeNull()

    candidate.subscription.unsubscribe()
  })

  test("rejects unavailable diverted Claude Profiles before preflight without touching active state or messages", async () => {
    const cases = [
      {
        suffix: "deleted",
        profileId: "deleted-profile",
        targetRuntimesJson: null,
      },
      {
        suffix: "codex-only",
        profileId: "codex-only-profile",
        targetRuntimesJson: JSON.stringify(["codex"]),
      },
      {
        suffix: "malformed",
        profileId: "malformed-profile",
        targetRuntimesJson: "{not-json",
      },
    ] as const

    for (const testCase of cases) {
      const chatId = `chat-claude-divert-${testCase.suffix}`
      const subChatId = `sub-claude-divert-${testCase.suffix}`
      seedBinding({ chatId, subChatId, runtime: "claude-code" })
      if (testCase.targetRuntimesJson !== null) {
        seedProviderProfile({
          id: testCase.profileId,
          targetRuntimesJson: testCase.targetRuntimesJson,
        })
      }
      const sentinelController = new AbortController()
      const sentinel = {
        runId: `sentinel-${testCase.suffix}`,
        controller: sentinelController,
      }
      setActiveClaudeSession(subChatId, sentinel)

      const candidate = await startSubscription(
        claudeRouter.createCaller({ getWindow: () => null }).chat({
          chatId,
          subChatId,
          runId: `candidate-${testCase.suffix}`,
          prompt: "must not be persisted",
          modelSource: `provider-profile:${testCase.profileId}`,
        }),
      )

      expect(candidate.completed).toBe(true)
      expect(chunkTypes(candidate.chunks)).toEqual(["error", "finish"])
      expect(getActiveClaudeSession(subChatId)).toBe(sentinel)
      expect(sentinelController.signal.aborted).toBe(false)
      expect(
        testDb
          .select({ messages: schema.subChats.messages })
          .from(schema.subChats)
          .where(eq(schema.subChats.id, subChatId))
          .get()?.messages,
      ).toBe("[]")
      expect(candidate.error).toBeNull()
      candidate.subscription.unsubscribe()
    }

    expect(claudePreflights).toHaveLength(0)
  })

  test("revalidates a diverted Claude Profile after deferred preflight before claiming the run", async () => {
    const chatId = "chat-claude-divert-deferred-delete"
    const subChatId = "sub-claude-divert-deferred-delete"
    const profileId = "claude-divert-deferred-delete"
    seedBinding({ chatId, subChatId, runtime: "claude-code" })
    seedProviderProfile({
      id: profileId,
      targetRuntimesJson: JSON.stringify(["claude"]),
    })
    const sentinelController = new AbortController()
    const sentinel = {
      runId: "sentinel-claude-divert-deferred-delete",
      controller: sentinelController,
    }
    setActiveClaudeSession(subChatId, sentinel)

    const candidate = await startSubscription(
      claudeRouter.createCaller({ getWindow: () => null }).chat({
        chatId,
        subChatId,
        runId: "candidate-claude-divert-deferred-delete",
        prompt: "must not be persisted",
        modelSource: `provider-profile:${profileId}`,
      }),
    )
    expect(claudePreflights).toHaveLength(1)

    testDb
      .delete(schema.agentProviderProfiles)
      .where(eq(schema.agentProviderProfiles.id, profileId))
      .run()
    claudePreflights[0]?.resolve({
      ok: true,
      preflight: { kind: "folderless", cwd: "/tmp/claude-divert" },
      runtimeCwd: "/tmp/claude-divert",
      guardedContract: null,
      guardedPreRunStatus: null,
      permissionPolicy: { controlLevel: "default" },
    })

    await waitFor(() => candidate.completed && claudeSecretReleases === 1)
    expect(chunkTypes(candidate.chunks)).toEqual(["error", "finish"])
    expect(getActiveClaudeSession(subChatId)).toBe(sentinel)
    expect(sentinelController.signal.aborted).toBe(false)
    expect(
      testDb
        .select({ messages: schema.subChats.messages })
        .from(schema.subChats)
        .where(eq(schema.subChats.id, subChatId))
        .get()?.messages,
    ).toBe("[]")
    expect(candidate.error).toBeNull()

    candidate.subscription.unsubscribe()
  })

  for (const runIds of [
    ["shared-run-id", "shared-run-id"],
    ["run-id-a", "run-id-b"],
  ] as const) {
    const runIdCase = runIds[0] === runIds[1] ? "same" : "different"

    test(`rejects Codex final claims during rollback maintenance with ${runIdCase} external run IDs`, async () => {
      const chatId = `chat-codex-maintenance-${runIdCase}`
      const subChatId = `sub-codex-maintenance-${runIdCase}`
      seedBinding({ chatId, subChatId, runtime: "codex" })
      const caller = codexRouter.createCaller({ getWindow: () => null })
      const candidates = await Promise.all(
        runIds.map((runId, index) =>
          startSubscription(
            caller.chat({
              chatId,
              subChatId,
              runId,
              prompt: `candidate-${index}`,
              model: "gpt-5.5/high",
              codexAuthMethod: "chatgpt",
            }),
          ),
        ),
      )
      await waitFor(() => codexPreflights.length === 2)

      const maintenance = acquireChatMaintenanceFence(subChatId)
      if (!maintenance.ok) {
        throw new Error("Expected Codex maintenance fence acquisition")
      }
      for (const pending of codexPreflights) {
        pending.resolve({ ok: true, blockers: [] })
      }

      await waitFor(() => candidates.every((candidate) => candidate.completed))
      expect(getActiveCodexStream(subChatId)).toBeUndefined()
      for (const candidate of candidates) {
        expect(chunkTypes(candidate.chunks)).toEqual(["error", "finish"])
        expect(candidate.chunks[0]).toMatchObject({
          type: "error",
          errorText: `Chat ${subChatId} is busy with rollback maintenance; a new Run cannot start.`,
          code: "SESSION_BINDING_BUSY",
          subChatId,
          operation: "rollback",
          activeRunId: null,
          reason: "maintenance",
        })
        expect(candidate.error).toBeNull()
        candidate.subscription.unsubscribe()
      }
      expect(releaseChatMaintenanceFence(maintenance.fence)).toBe(true)
    })

    test(`rejects Claude final claims during rollback maintenance with ${runIdCase} external run IDs`, async () => {
      const chatId = `chat-claude-maintenance-${runIdCase}`
      const subChatId = `sub-claude-maintenance-${runIdCase}`
      seedBinding({ chatId, subChatId, runtime: "claude-code" })
      const caller = claudeRouter.createCaller({ getWindow: () => null })
      const candidates = await Promise.all(
        runIds.map((runId, index) =>
          startSubscription(
            caller.chat({
              chatId,
              subChatId,
              runId,
              prompt: `candidate-${index}`,
              model: "claude-sonnet-4-20250514",
              modelSource: "claude-oauth",
            }),
          ),
        ),
      )
      await waitFor(() => claudePreflights.length === 2)

      const maintenance = acquireChatMaintenanceFence(subChatId)
      if (!maintenance.ok) {
        throw new Error("Expected Claude maintenance fence acquisition")
      }
      for (const pending of claudePreflights) {
        pending.resolve({
          ok: true,
          preflight: { kind: "folderless", cwd: "/tmp/claude-maintenance" },
          runtimeCwd: "/tmp/claude-maintenance",
          guardedContract: null,
          guardedPreRunStatus: null,
          permissionPolicy: { controlLevel: "default" },
        })
      }

      await waitFor(() => candidates.every((candidate) => candidate.completed))
      expect(getActiveClaudeSession(subChatId)).toBeUndefined()
      for (const candidate of candidates) {
        expect(chunkTypes(candidate.chunks)).toEqual(["error", "finish"])
        expect(candidate.chunks[0]).toMatchObject({
          type: "error",
          errorText: `Chat ${subChatId} is busy with rollback maintenance; a new Run cannot start.`,
          code: "SESSION_BINDING_BUSY",
          subChatId,
          operation: "rollback",
          activeRunId: null,
          reason: "maintenance",
        })
        expect(candidate.error).toBeNull()
        candidate.subscription.unsubscribe()
      }
      expect(releaseChatMaintenanceFence(maintenance.fence)).toBe(true)
    })
  }
})
