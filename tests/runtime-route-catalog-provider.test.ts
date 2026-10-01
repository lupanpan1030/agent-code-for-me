/**
 * Independent red suite — refactor-unified-runtime-route-catalog, catalog-core
 * domain: provider precedence, gateway cleanup and secret-safe descriptors
 * stay with the binding owners (S32). See tests/runtime-route-catalog-core-kit.ts.
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
import { createMigratedLedgerDb } from "./run-event-ledger-domain-b-kit"
import {
  agentQuery,
  asArray,
  asRecord,
  baseDeclarationFixture,
  buildTestCatalog,
  completionQuery,
  createReferencePorts,
  FIXED_NOW_ISO,
  fixtureKey,
  functionPaths,
  type Loose,
  refusingSpawn,
  requireCatalogModule,
  runCli,
  serializeWithFunctions,
  settleWithError,
} from "./runtime-route-catalog-core-kit"

// Safety net at the process I/O end (design D1).
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

// Recording wrapper over every provider-storage reader: the catalog must
// never read or decrypt provider storage (S32 THEN).
const storageReads: string[] = []
const storage = await import("../src/main/lib/provider-profiles/storage")
mock.module("../src/main/lib/provider-profiles/storage", () =>
  Object.fromEntries(
    Object.entries(storage).map(([name, value]) => [
      name,
      typeof value === "function" && /^[a-z]/.test(name)
        ? (...args: unknown[]) => {
            storageReads.push(name)
            return (value as (...inner: unknown[]) => unknown)(...args)
          }
        : value,
    ]),
  ),
)
const { ProviderProfileStorageReadError } = storage
const { resolveHeadlessProviderBinding } = await import(
  "../src/main/lib/headless/provider-binding"
)

const cleanups: Array<() => void> = []
beforeEach(() => {
  // Deterministic wall clock for every row timestamp the hosts write.
  setSystemTime(new Date(FIXED_NOW_ISO))
})
afterEach(() => {
  setSystemTime()
  while (cleanups.length > 0) cleanups.pop()?.()
})

type SentinelDependencies = {
  deps: Loose
  calls: string[]
}

function sentinelDependencies(
  s32: Loose,
  defaultProfile: string,
): SentinelDependencies {
  const calls: string[] = []
  const sentinel = asRecord(s32.sentinelProfile)
  const gateway = asRecord(s32.gateway)
  const badDefault = asRecord(s32.badDefault)
  const profile = (id: string) => ({
    id,
    name: `${id}-name`,
    presetId: null,
    protocol: sentinel.protocol,
    baseUrl: sentinel.baseUrl,
    defaultModel: `${id}-default-model`,
    authMode: sentinel.authMode,
    token: `${String(sentinel.tokenPrefix)}${id}`,
    headers: {
      [String(sentinel.headerName)]: `${String(sentinel.headerPrefix)}${id}`,
    },
    targetRuntimes: ["claude", "codex"],
    capabilities: {},
  })
  let gatewayCount = 0
  const deps: Loose = {
    getProviderProfileMetadata: (_db: unknown, id: string) => {
      calls.push(`metadata:${id}`)
      return id === "profile-explicit"
        ? { id, targetRuntimes: ["claude", "codex"] }
        : null
    },
    getProviderProfileRuntimeConfig: (_db: unknown, id: string) => {
      calls.push(`runtime-config:${id}`)
      return id === "profile-explicit" ? profile(id) : null
    },
    getProviderDefaultRuntimeConfig: (_db: unknown, purpose: string) => {
      calls.push(`default:${purpose}`)
      if (defaultProfile === "none") return null
      if (defaultProfile === "bad") {
        throw new ProviderProfileStorageReadError({
          reason: "invalid-profile",
          profileId: String(badDefault.profileId),
          message: String(badDefault.message),
        })
      }
      return { ...profile("profile-default"), modelOverride: null }
    },
    createGatewayEndpoint: async (id: string, kind: string) => {
      gatewayCount += 1
      calls.push(`gateway:${id}:${kind}`)
      return {
        baseUrl: `${String(gateway.baseUrlPrefix)}${kind}`,
        token: `${String(gateway.tokenPrefix)}${gatewayCount}`,
        providerId: id,
      }
    },
    revokeGatewayToken: (token: string) => {
      calls.push(`revoke:${token}`)
      return true
    },
  }
  return { deps, calls }
}

async function ownerOutcome(
  runtime: string,
  input: Loose,
  deps: Loose,
): Promise<Loose> {
  const settled = await settleWithError(async () => {
    const resolution = await resolveHeadlessProviderBinding({
      db: {} as Parameters<typeof resolveHeadlessProviderBinding>[0]["db"],
      runtime: runtime as "codex",
      providerProfileId: input.providerProfileId as string | null,
      modelOverride: input.modelOverride as string | null,
      dependencies: deps as Parameters<
        typeof resolveHeadlessProviderBinding
      >[0]["dependencies"],
    })
    const secretHints = [...resolution.getSecretHints()]
    resolution.cleanup()
    return {
      ok: true,
      providerBinding: resolution.providerBinding,
      resolvedProvider: resolution.resolvedProvider,
      secretHints,
    }
  })
  if (settled.fulfilled) return asRecord(settled.value)
  const record = asRecord(settled.error)
  return {
    ok: false,
    code: record.code,
    message:
      settled.error instanceof Error
        ? settled.error.message
        : String(settled.error),
    source: record.source,
    profileId: record.profileId,
  }
}

describe("runtime route catalog — provider binding owners", () => {
  test("S32 Provider precedence and secret handling stay with binding owners — explicit/model-only/default/native precedence and baseline errors are unchanged, the catalog-selected delegate receives the owner's binding only after provider binding, bad selections never reach native work, and gateway cleanup runs through the owner", async () => {
    const catalog = await requireCatalogModule()
    const s32 = fixtureKey("provider.json", "S32")
    const seeded = asRecord(s32.seededProfileRow)
    const outcomes = []
    for (const entry of asArray(s32.cases)) {
      const item = asRecord(entry)
      const owner = sentinelDependencies(s32, String(item.defaultProfile))
      const ownerResult = await ownerOutcome(
        String(item.runtime),
        asRecord(item.ownerInput),
        owner.deps,
      )

      const host = sentinelDependencies(s32, String(item.defaultProfile))
      const captured: unknown[] = []
      const { declarations, ports } = baseDeclarationFixture()
      const batchRef =
        item.runtime === "codex"
          ? "factory:codex-batch"
          : "factory:claude-code-batch"
      const recording = createReferencePorts(ports, {
        [batchRef]: async (runRequest: unknown) => {
          host.calls.push(`invoke:${batchRef}`)
          captured.push(asRecord(runRequest).providerBinding)
          return {
            status: "succeeded",
            exitCode: 0,
            result: { finalMessage: "ok" },
          }
        },
      })
      const state = buildTestCatalog(catalog, declarations, recording)
      const mdb = createMigratedLedgerDb()
      cleanups.push(() => mdb.close())
      const projectRoot = realpathSync(mdb.dir)
      mdb.sqlite
        .query("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)")
        .run("project-1", "Provider fixture", projectRoot)
      mdb.sqlite
        .query(
          "INSERT INTO agent_provider_profiles (id, name, protocol, base_url, default_model, auth_mode, encrypted_token, target_runtimes_json, capabilities_json) VALUES (?, ?, 'openai-responses', 'https://provider.example.com/v1', ?, 'none', NULL, ?, '{}')",
        )
        .run(
          String(seeded.id),
          String(seeded.name),
          String(seeded.defaultModel),
          JSON.stringify(seeded.targets),
        )
      const outcome = await runCli({
        db: mdb.db,
        args: [
          "run",
          "--cwd",
          projectRoot,
          "--runtime",
          String(item.runtime),
          ...asArray(item.flags).map(String),
          "--prompt",
          "Provider fixture.",
          "--output",
          "json",
        ],
        lockPath: join(mdb.dir, "locus-daemon.lock"),
        extra: {
          providerBindingDependencies: host.deps,
          runtimeRouteCatalog: state,
        },
      })
      const jobs = mdb.sqlite
        .query(
          "SELECT status, exit_code, error_code, error_message, result_json FROM agent_jobs",
        )
        .all()
        .map((row) => {
          const record = asRecord(row)
          const result = asRecord(
            JSON.parse(String(record.result_json ?? "null")) as unknown,
          )
          return {
            status: record.status,
            exit_code: record.exit_code,
            error_code: record.error_code,
            error_message: record.error_message,
            resolvedProvider: result.resolvedProvider ?? null,
          }
        })
      outcomes.push({
        caseId: item.caseId,
        owner: { ...ownerResult, ownerCalls: owner.calls },
        host: {
          code: outcome.code,
          stderr: outcome.stderr,
          jobs,
          delegateProviderBindings: captured,
          sequence: host.calls,
        },
      })
    }

    expect(outcomes).toEqual(
      asArray(s32.cases).map((entry) => {
        const item = asRecord(entry)
        return {
          caseId: item.caseId,
          owner: item.expectOwner,
          host: item.expectHost,
        }
      }),
    )
    expect(realSpawnAttempts).toEqual([])
  })

  test("S32 Provider precedence and secret handling stay with binding owners — catalog descriptors, projections and resolutions carry no sentinel credentials, headers, env values or factory functions, and catalog queries never read or decrypt provider storage", async () => {
    const catalog = await requireCatalogModule()
    const s32 = fixtureKey("provider.json", "S32")
    const envSentinel = asRecord(s32.envSentinel)
    const envName = String(envSentinel.name)
    const previous = process.env[envName]
    process.env[envName] = String(envSentinel.value)
    cleanups.push(() => {
      if (previous === undefined) delete process.env[envName]
      else process.env[envName] = previous
    })
    storageReads.splice(0, storageReads.length)

    const listed = catalog.listRuntimeRoutes({})
    const publicProjection = catalog.projectRuntimeRoutes("public")
    const rendererProjection = catalog.projectRuntimeRoutes("renderer")
    const resolutions = ["claude-code", "codex"].flatMap((runtimeId) => [
      catalog.resolveRuntimeRoute(
        agentQuery({
          runtimeId,
          entry: "api",
          mode: "agent",
          executionProfile: "batch",
          source: "api",
        }),
      ),
      catalog.resolveRuntimeRoute(completionQuery(runtimeId, "api")),
    ])
    const resolutionsWithoutDelegates = resolutions.map((value) => {
      const {
        delegate: _delegate,
        readinessProbe: _probe,
        ...rest
      } = asRecord(value)
      return rest
    })
    const text = serializeWithFunctions([
      listed,
      publicProjection,
      rendererProjection,
      resolutionsWithoutDelegates,
    ])

    expect({
      listedRuntimes: [
        ...new Set(asArray(listed).map((item) => asRecord(item).runtimeId)),
      ].sort(),
      resolvedSources: resolutions.map(
        (value) => asRecord(value).adapterSource ?? asRecord(value).reason,
      ),
      rendererItems: asArray(rendererProjection).length,
    }).toEqual({
      listedRuntimes: ["claude-code", "codex"],
      resolvedSources: [
        "claude-code-batch",
        "locus-completion",
        "codex-batch",
        "locus-completion",
      ],
      rendererItems: 2,
    })
    expect({
      leakedSentinels: asArray(s32.sentinelStrings)
        .map(String)
        .filter((sentinel) => text.includes(sentinel)),
      listedFunctionPaths: functionPaths(listed),
      publicFunctionPaths: functionPaths(publicProjection),
      rendererFunctionPaths: functionPaths(rendererProjection),
      resolutionFunctionPaths: functionPaths(resolutionsWithoutDelegates),
      storageReads,
    }).toEqual({
      leakedSentinels: [],
      listedFunctionPaths: [],
      publicFunctionPaths: [],
      rendererFunctionPaths: [],
      resolutionFunctionPaths: [],
      storageReads: [],
    })
  })
})
