/**
 * Implementer unit for refactor-unified-runtime-route-catalog (red-receipt
 * §6, S24 sub-clause): a validated test catalog whose agent-factory
 * reference port returns the typed delegate at validation and `null` at the
 * post-binding lookup. The headless runner must settle runtime_error / exit 1
 * with exactly the sanitized catalog message, invoke no leaf, never report
 * internal_error / 8 and leave the frozen table unchanged.
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
  baseDeclarationFixture,
  buildTestCatalog,
  CATALOG_UNAVAILABLE_MESSAGE,
  createReferencePorts,
  FIXED_NOW_ISO,
  type Loose,
  refusingSpawn,
  requireCatalogModule,
  runCli,
} from "./runtime-route-catalog-core-kit"

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

describe("runtime route catalog — post-binding agent-factory lookup returns null", () => {
  test("run and API create settle runtime_error / exit 1 with the sanitized message and zero leaf calls", async () => {
    const catalog = await requireCatalogModule()
    const outcomes: Loose[] = []
    for (const surface of ["run", "api-create"] as const) {
      const { declarations, ports } = baseDeclarationFixture()
      const recording = createReferencePorts(
        ports,
        {},
        // First lookup of a factory is the validator's; later ones return null.
        { factoryLookupOverride: (_ref, count) => count < 2 },
      )
      const state = buildTestCatalog(catalog, declarations, recording)
      const before = JSON.stringify(catalog.listRuntimeRoutes({}, state))
      const profile = migratedProfile()
      const args =
        surface === "run"
          ? [
              "run",
              "--cwd",
              profile.projectRoot,
              "--runtime",
              "codex",
              "--prompt",
              "Null factory fixture.",
              "--output",
              "json",
            ]
          : ["api", "runs", "create", "--request", "-", "--json"]
      const outcome = await runCli({
        db: profile.mdb.db,
        args,
        stdin:
          surface === "run"
            ? undefined
            : JSON.stringify({
                apiVersion: "locus.local-job.v1",
                consumer: { id: "null-factory-consumer" },
                project: { cwd: profile.projectRoot },
                runtime: { id: "codex" },
                mode: "plan",
                prompt: { text: "Null factory fixture." },
              }),
        lockPath: profile.lockPath,
        extra: {
          runtimeRouteCatalog: state,
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
      const resolvedAfter = catalog.resolveRuntimeRoute(
        agentQuery({
          runtimeId: "codex",
          entry: "headless",
          mode: "agent",
          executionProfile: "batch",
          source: "cli",
        }),
        state,
      ) as Loose
      outcomes.push({
        surface,
        settled: outcome.settled,
        code: outcome.code,
        jobs,
        invocations: recording.log.invocations.length,
        tableUnchanged:
          JSON.stringify(catalog.listRuntimeRoutes({}, state)) === before,
        resolvedAfter: [resolvedAfter.ok, resolvedAfter.reason],
      })
    }

    expect(outcomes).toEqual(
      ["run", "api-create"].map((surface) => ({
        surface,
        settled: "fulfilled",
        code: 1,
        jobs: [
          {
            status: "failed",
            error_code: "runtime_error",
            error_message: CATALOG_UNAVAILABLE_MESSAGE,
            exit_code: 1,
          },
        ],
        invocations: 0,
        tableUnchanged: true,
        resolvedAfter: [false, "catalog_invalid"],
      })),
    )
    expect(realSpawnAttempts).toEqual([])
  })
})
