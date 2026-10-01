/**
 * Independent red suite — refactor-unified-runtime-route-catalog, catalog-core
 * domain: completion routes are provider-only execution (S09).
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
import { readdirSync } from "node:fs"
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
  type Loose,
  refusingSpawn,
  requireCatalogModule,
  runCli,
  serializeWithFunctions,
} from "./runtime-route-catalog-core-kit"

// Safety net at the process I/O end (design D1): no runtime child may start.
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

function completionProfile(s09: Loose) {
  const mdb = createMigratedLedgerDb()
  cleanups.push(() => mdb.close())
  for (const entry of asArray(s09.providerProfiles)) {
    const profile = asRecord(entry)
    mdb.sqlite
      .query(
        "INSERT INTO agent_provider_profiles (id, name, protocol, base_url, default_model, auth_mode, encrypted_token, target_runtimes_json, capabilities_json) VALUES (?, ?, 'openai-responses', 'https://provider.example.com/v1', 'provider-default-model', 'none', NULL, ?, '{}')",
      )
      .run(
        String(profile.id),
        String(profile.id),
        JSON.stringify([profile.target]),
      )
  }
  return mdb
}

function profileListing(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((name) => !name.startsWith("locus.db") && !name.endsWith(".lock"))
    .sort()
}

describe("runtime route catalog — completion routes", () => {
  test("S09 Completion routes are provider-only execution — both runtime-family completions run through the existing completion runner with exactly one upstream call and no agent delegate, child or run directory, keep locus-completion provenance, and the catalog separately describes them as provider-only completion routes", async () => {
    const catalog = await requireCatalogModule()
    const s09 = fixtureKey("completion.json", "S09")
    const metadata = asRecord(s09.catalogMetadata)
    const valid = []
    for (const entry of asArray(s09.valid)) {
      const item = asRecord(entry)
      const mdb = completionProfile(s09)
      const { declarations, ports } = baseDeclarationFixture()
      const recording = createReferencePorts(ports)
      const state = buildTestCatalog(catalog, declarations, recording)
      const fetchCalls: string[] = []
      const before = profileListing(mdb.dir)
      const outcome = await runCli({
        db: mdb.db,
        args: ["api", "runs", "create", "--request", "-", "--json"],
        stdin: JSON.stringify(item.request),
        lockPath: join(mdb.dir, "locus-daemon.lock"),
        extra: {
          runtimeRouteCatalog: state,
          completionFetch: async (url: unknown) => {
            fetchCalls.push(String(url))
            return new Response(JSON.stringify(s09.upstreamResponse), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          },
        },
      })
      const job = asRecord(
        mdb.sqlite
          .query(
            "SELECT kind, source, runtime, status, error_code, exit_code, artifact_base_dir, artifact_manifest_path, ledger_provenance_json FROM agent_jobs",
          )
          .get(),
      )
      const provenance = asRecord(
        JSON.parse(String(job.ledger_provenance_json ?? "null")) as unknown,
      )
      const resolutions = asArray(metadata.entries).map((entryName) => {
        const result = asRecord(
          catalog.resolveRuntimeRoute(
            completionQuery(String(item.family), entryName as "api"),
          ),
        )
        return {
          entry: entryName,
          ok: result.ok,
          runtimeId: result.runtimeId,
          executionSurface: result.executionSurface,
          adapterSource: result.adapterSource,
          transport: result.transport,
          delegate: result.delegate ?? null,
          readinessProbe: result.readinessProbe ?? null,
          extensions: result.extensions,
          mode: result.mode ?? null,
          inventsInstallation: /installation/i.test(
            serializeWithFunctions(result),
          ),
        }
      })
      const contrast = {
        agentBatchOnApi: asRecord(
          catalog.resolveRuntimeRoute(
            agentQuery({
              runtimeId: String(item.family),
              entry: "api",
              mode: "agent",
              executionProfile: "batch",
              source: "api",
            }),
          ),
        ).adapterSource,
        completionOnDesktop: asRecord(
          catalog.resolveRuntimeRoute({
            ...completionQuery(String(item.family), "api"),
            entry: "desktop",
          }),
        ).reason,
      }
      valid.push({
        caseId: item.caseId,
        contrast,
        settled: outcome.settled,
        code: outcome.code,
        stderr: outcome.stderr,
        fetchCalls,
        job: {
          kind: job.kind,
          source: job.source,
          runtime: job.runtime,
          status: job.status,
          error_code: job.error_code,
          exit_code: job.exit_code,
          artifact_base_dir: job.artifact_base_dir,
          artifact_manifest_path: job.artifact_manifest_path,
        },
        provenance: {
          kind: provenance.kind,
          adapterSource: provenance.adapterSource,
          runtimeId: provenance.runtimeId,
          forbiddenKeys: asArray(s09.forbiddenProvenanceKeys).filter((key) =>
            Object.hasOwn(provenance, String(key)),
          ),
        },
        agentDelegateInvocations: recording.log.invocations.length,
        probeInvocations: recording.log.probeCalls.length,
        newProfileEntries: profileListing(mdb.dir).filter(
          (name) => !before.includes(name),
        ),
        resolutions,
      })
    }
    const invalid = []
    for (const entry of asArray(s09.invalid)) {
      const item = asRecord(entry)
      const mdb = completionProfile(s09)
      const { declarations, ports } = baseDeclarationFixture()
      const recording = createReferencePorts(ports)
      const fetchCalls: string[] = []
      const outcome = await runCli({
        db: mdb.db,
        args: ["api", "runs", "create", "--request", "-", "--json"],
        stdin: JSON.stringify(item.request),
        lockPath: join(mdb.dir, "locus-daemon.lock"),
        extra: {
          runtimeRouteCatalog: buildTestCatalog(
            catalog,
            declarations,
            recording,
          ),
          completionFetch: async (url: unknown) => {
            fetchCalls.push(String(url))
            return new Response("{}", { status: 500 })
          },
        },
      })
      invalid.push({
        caseId: item.caseId,
        code: outcome.code,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        fetchCalls: fetchCalls.length,
        jobs: mdb.sqlite.query("SELECT id FROM agent_jobs").all().length,
        agentDelegateInvocations: recording.log.invocations.length,
      })
    }

    expect(valid).toEqual(
      asArray(s09.valid).map((entry) => {
        const item = asRecord(entry)
        return {
          caseId: item.caseId,
          contrast: {
            agentBatchOnApi: asRecord(
              asRecord(s09.contrast)[String(item.family)],
            ).agentBatchOnApi,
            completionOnDesktop: "route_not_found",
          },
          settled: "fulfilled",
          code: 0,
          stderr: "",
          fetchCalls: [item.upstreamUrl],
          job: { ...asRecord(s09.expectedJob), runtime: item.family },
          provenance: {
            ...asRecord(s09.expectedProvenance),
            runtimeId: item.family,
            forbiddenKeys: [],
          },
          agentDelegateInvocations: 0,
          probeInvocations: 0,
          newProfileEntries: [],
          resolutions: asArray(metadata.entries).map((entryName) => ({
            entry: entryName,
            ok: true,
            runtimeId: item.family,
            executionSurface: metadata.executionSurface,
            adapterSource: metadata.adapterSource,
            transport: metadata.transport,
            delegate: null,
            readinessProbe: null,
            extensions: metadata.extensions,
            mode: null,
            inventsInstallation: false,
          })),
        }
      }),
    )
    expect(invalid).toEqual(
      asArray(s09.invalid).map((entry) => {
        const item = asRecord(entry)
        return {
          caseId: item.caseId,
          code: item.code,
          stdout: "",
          stderr: item.stderr,
          fetchCalls: 0,
          jobs: 0,
          agentDelegateInvocations: 0,
        }
      }),
    )
    expect(realSpawnAttempts).toEqual([])
  })
})
