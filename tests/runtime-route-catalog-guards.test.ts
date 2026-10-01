/**
 * Independent RED acceptance suite — refactor-unified-runtime-route-catalog,
 * public-guards domain, architecture guards: S26, S27, S28, S29, S30, S48,
 * S50 (openspec/changes/refactor-unified-runtime-route-catalog/specs/
 * architecture-ownership/spec.md:72-158; design.md D5).
 *
 * Written test-first on base 19986552. The guard is driven as a child
 * process exactly like tests/run-event-ledger-guard-self-test.test.ts:
 * `node scripts/check-architecture-guards.mjs
 * --runtime-route-catalog-fixtures=<path>`. Two guard runs are shared by
 * the scenario tests: the canonical fixture (every case must match and the
 * production tree must pass) and a mutated copy in which, per scenario, one
 * negative case loses its expected findings and one clean case gains a bogus
 * finding (each must be reported by case id, so a guard that prints the
 * summary without scanning cannot pass).
 *
 * RED on the base: the guard has no "Runtime Route Catalog Single Owner"
 * section, ignores the flag, prints no route-catalog summary and the
 * production tree still contains the retired selector modules/branches.
 */
import {
  afterAll,
  describe,
  expect,
  setSystemTime,
  spyOn,
  test,
} from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import {
  architectureFixture,
  CATALOG_FILE,
  CREATE_ARGS,
  cleanupTempDirs,
  FIXED_NOW_ISO,
  fixtureKey,
  GUARD_FIXTURE_DEFAULT,
  GUARD_SCENARIOS,
  GUARD_TIMEOUT_MS,
  type GuardCase,
  type GuardFinding,
  type GuardRun,
  installRecordingLeafPorts,
  type JsonObject,
  leafPorts,
  OWNER_SECTION,
  productionCatalogState,
  REPO_ROOT,
  renderTemplate,
  runArchitectureGuard,
  scenarioCases,
  submitWaitKit,
  totalCaseCount,
  writeTempJson,
} from "./runtime-route-catalog-guards-kit"

await installRecordingLeafPorts()

afterAll(() => cleanupTempDirs())

const LABEL = "Runtime route catalog guard self-test"
const RETIRED_SYMBOLS = [
  "getAgentRuntimeAdapter",
  "selectAgentRuntimeAdapter",
  "SelectAgentRuntimeAdapterOptions",
  "preferredAdapterSource",
  "DesktopRuntimeAdapterFactory",
  "resolveCodexDesktopAdapterSelection",
  "resolveCodexAppServerDesktopAdapter",
  "resolveClaudeAgentSdkDesktopAdapter",
]
const RETIRED_MODULES = [
  "src/main/lib/headless/adapter-selector.ts",
  "src/main/lib/agent-runtime/runtime-registry.ts",
]

type Scenario = (typeof GUARD_SCENARIOS)[number]

let canonicalRun: GuardRun | null = null
let mutatedRun: {
  run: GuardRun
  mutations: Record<
    string,
    { negative: GuardCase; clean: GuardCase; bogus: GuardFinding }
  >
} | null = null

function canonical(): GuardRun {
  if (!canonicalRun) canonicalRun = runArchitectureGuard(GUARD_FIXTURE_DEFAULT)
  return canonicalRun
}

/**
 * Per scenario: the first case with findings loses them (the guard must
 * report them as unexpected) and the first clean case gains a bogus
 * finding (the guard must report it as missed).
 */
function mutated() {
  if (mutatedRun) return mutatedRun
  const fixture = architectureFixture()
  const mutations: Record<
    string,
    { negative: GuardCase; clean: GuardCase; bogus: GuardFinding }
  > = {}
  for (const scenario of GUARD_SCENARIOS) {
    const cases = scenarioCases(fixture, scenario)
    const negative = cases.find((entry) => entry.expectedFindings.length > 0)
    const clean = cases.find((entry) => entry.expectedFindings.length === 0)
    if (!negative || !clean) throw new Error(`${scenario} lacks a case pair`)
    const original = structuredClone(negative)
    negative.expectedFindings = []
    const bogus: GuardFinding = {
      rule: "route-dispatch-outside-owner",
      file: clean.files[0]?.file ?? CATALOG_FILE,
      symbol: `bogusExpectation${scenario}`,
      owner: CATALOG_FILE,
      ownerSection: OWNER_SECTION,
    }
    clean.expectedFindings = [bogus]
    mutations[scenario] = { negative: original, clean, bogus }
  }
  const path = writeTempJson("architecture-fixtures.json", fixture)
  mutatedRun = { run: runArchitectureGuard(path), mutations }
  return mutatedRun
}

function output(run: GuardRun): string {
  return `${run.stdout}${run.stderr}`
}

function caseLines(text: string, caseIds: string[]): string[] {
  return text
    .split("\n")
    .filter((line) =>
      caseIds.some((caseId) => line.includes(`${LABEL} case ${caseId} `)),
    )
}

/** Guard-level observation shared by every scenario test (collected). */
function guardObservation(scenario: Scenario) {
  const fixture = architectureFixture()
  const total = totalCaseCount(fixture)
  const cases = scenarioCases(fixture, scenario)
  const canonicalText = output(canonical())
  const { run, mutations } = mutated()
  const mutatedText = output(run)
  const mutation = mutations[scenario]
  const negativeLine =
    caseLines(mutatedText, [mutation.negative.caseId])[0] ?? "<no line>"
  const cleanLine =
    caseLines(mutatedText, [mutation.clean.caseId])[0] ?? "<no line>"
  const mutatedCount = GUARD_SCENARIOS.length * 2
  return {
    actual: {
      canonicalExit: canonical().status,
      canonicalPassed: canonicalText.includes("Architecture guard passed."),
      canonicalSummary: canonicalText.includes(
        `${LABEL}: ${total}/${total} fixture cases matched; repository ownership enforced.`,
      ),
      canonicalScenarioMismatches: caseLines(
        canonicalText,
        cases.map((entry) => entry.caseId),
      ),
      mutatedExit: run.status,
      mutatedSummary: mutatedText.includes(
        `${LABEL}: ${total - mutatedCount}/${total} fixture cases matched`,
      ),
      mutatedCaseLines: (
        mutatedText.match(new RegExp(`${LABEL} case `, "g")) ?? []
      ).length,
      negativeReported: {
        prefix: negativeLine.includes(
          `${LABEL} case ${mutation.negative.caseId} missed nothing and produced unexpected `,
        ),
        everyFinding: mutation.negative.expectedFindings.every(
          (finding) =>
            negativeLine.includes(finding.rule) &&
            negativeLine.includes(finding.symbol),
        ),
        section: negativeLine.includes(`. See ${OWNER_SECTION}.`),
      },
      cleanReported: {
        prefix: cleanLine.includes(
          `${LABEL} case ${mutation.clean.caseId} missed `,
        ),
        bogus: cleanLine.includes(mutation.bogus.symbol),
        nothingUnexpected: cleanLine.includes(
          `and produced unexpected nothing. See ${OWNER_SECTION}.`,
        ),
      },
    },
    expected: {
      canonicalExit: 0,
      canonicalPassed: true,
      canonicalSummary: true,
      canonicalScenarioMismatches: [],
      mutatedExit: 1,
      mutatedSummary: true,
      mutatedCaseLines: mutatedCount,
      negativeReported: { prefix: true, everyFinding: true, section: true },
      cleanReported: { prefix: true, bogus: true, nothingUnexpected: true },
    },
  }
}

function productionFiles(dir: string): string[] {
  const absolute = join(REPO_ROOT, dir)
  if (!existsSync(absolute)) return []
  const out: string[] = []
  for (const name of readdirSync(absolute)) {
    const path = join(absolute, name)
    const relative = `${dir}/${name}`
    if (statSync(path).isDirectory()) out.push(...productionFiles(relative))
    else if (/\.(ts|tsx|mts|cts|js|mjs)$/.test(name)) out.push(relative)
  }
  return out
}

function readRepo(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8")
}

/** Production files under src/ that mention any retired selector symbol. */
function retiredSymbolHits(): string[] {
  const pattern = new RegExp(`\\b(${RETIRED_SYMBOLS.join("|")})\\b`)
  return productionFiles("src").filter((file) => pattern.test(readRepo(file)))
}

describe("runtime route catalog architecture guard", () => {
  test(
    "S26 Duplicate routing is detected through direct and aliased forms — every if/switch, runtime-keyed map, aliased/namespace retired-selector, one-hop wrapper and fixed-runtime direct leaf import (including the Claude lifecycle) case yields exactly its expected tuples, mismatches fail by case id, and the existing ledger/async self-test summaries stay unchanged",
    () => {
      const observation = guardObservation("S26")
      const text = output(canonical())
      expect({
        ...observation.actual,
        ledgerSummary:
          /Run event ledger guard self-test: (\d+)\/\1 fixture cases matched; repository ownership enforced\./.test(
            text,
          ),
        asyncSummary:
          /Local job API async submission guard self-test: (\d+)\/\1 fixture cases matched; repository ownership enforced\./.test(
            text,
          ),
      }).toEqual({
        ...observation.expected,
        ledgerSummary: true,
        asyncSummary: true,
      })
    },
    GUARD_TIMEOUT_MS,
  )

  test(
    "S27 All retired selector symbols and transport branches are absent — each restored module/export/forwarding alias/active-chat branch fixture yields its exact retired-route-selector or renderer-route-projection-bypass tuple, while the production tree has no retired module, symbol or Engine transport branch and keeps the ledger helpers, adapter-local assertion and pump kind dispatch",
    () => {
      const observation = guardObservation("S27")
      const activeChat = readRepo(
        "src/renderer/features/agents/main/active-chat.tsx",
      )
      const desktopRunner = readRepo(
        "src/main/lib/agent-runtime/desktop-runner.ts",
      )
      const appServer = readRepo(
        "src/main/lib/headless/adapters/codex-app-server.ts",
      )
      const daemon = readRepo("src/main/lib/headless/daemon.ts")
      expect({
        ...observation.actual,
        retiredModulesPresent: RETIRED_MODULES.filter((file) =>
          existsSync(join(REPO_ROOT, file)),
        ),
        retiredSymbolFiles: retiredSymbolHits(),
        activeChatDirectTransportConstruction: [
          activeChat.includes("new CodexAppServerChatTransport("),
          activeChat.includes("new IPCChatTransport("),
        ],
        activeChatHelperCalls: (
          activeChat.match(/createRuntimeRouteTransport\(/g) ?? []
        ).length,
        retainedOwners: [
          desktopRunner.includes(
            "export async function recordDesktopRuntimeAdapterStarted",
          ),
          desktopRunner.includes(
            "export function assertDesktopRuntimeAdapterMatchesRequest",
          ),
          appServer.includes("assertAppServerPolicyGrantRequest"),
          daemon.includes("runPersistedCompletionJob") &&
            daemon.includes("runPersistedAgentJob"),
        ],
      }).toEqual({
        ...observation.expected,
        retiredModulesPresent: [],
        retiredSymbolFiles: [],
        activeChatDirectTransportConstruction: [false, false],
        activeChatHelperCalls: 2,
        retainedOwners: [true, true, true, true],
      })
    },
    GUARD_TIMEOUT_MS,
  )

  test(
    "S28 Catalog imports preserve runtime core direction — clean lazy factory/probe references pass while Electron, tRPC, renderer, preload, router, router-through-wrapper and readiness-to-catalog imports each yield their exact route-catalog-forbidden-dependency tuple, and no architecture baseline gains a catalog entry",
    () => {
      const observation = guardObservation("S28")
      const baselines = readRepo("scripts/architecture-baselines.json")
      expect({
        ...observation.actual,
        baselineMentionsCatalog: baselines.includes("runtime-route-catalog"),
      }).toEqual({ ...observation.expected, baselineMentionsCatalog: false })
    },
    GUARD_TIMEOUT_MS,
  )

  test(
    "S29 Adjacent legitimate owners are not banned as routing duplicates — provider target/purpose, policy mode, source cancel, command/method parsing, native decoding, selected-route assertions, transportId-only construction, chunk.type, binding admit/provider target, desktop allowlist, active-chat adjacent branches, manifest aliases, job-runner seams, pump kind dispatch, the injected Claude lifecycle delegate and the projection-based read model pass, while each paired runtimeId-chooses-a-second-adapter mutation fails with its exact tuples",
    () => {
      const observation = guardObservation("S29")
      expect(observation.actual).toEqual(observation.expected)
    },
    GUARD_TIMEOUT_MS,
  )

  test(
    "S30 Catalog composition cannot create another business core — job/event insertion, claim, sequence allocation, terminal settlement, artifact preparation, provider-storage reads, process.env/fs/config reads, a production second catalog or test constructor and a non-forwarded production runtimeRouteCatalog option each yield their exact tuple against the canonical owner while the selection-only catalog passes; the production catalog itself reads no env/fs/config",
    () => {
      const observation = guardObservation("S30")
      const catalogPath = join(REPO_ROOT, CATALOG_FILE)
      const catalogSource = existsSync(catalogPath)
        ? readFileSync(catalogPath, "utf8")
        : null
      expect({
        ...observation.actual,
        productionCatalogExists: catalogSource !== null,
        productionCatalogReads: catalogSource
          ? [
              /process\.env/.test(catalogSource),
              /from\s+"(node:)?fs(\/promises)?"/.test(catalogSource),
              /claude-config|user-data-path|electron-store/.test(catalogSource),
            ]
          : null,
      }).toEqual({
        ...observation.expected,
        productionCatalogExists: true,
        productionCatalogReads: [false, false, false],
      })
    },
    GUARD_TIMEOUT_MS,
  )

  test("S30 Catalog composition cannot create another business core — real API create and a jobs-stdio job.run reach submitRun and pumpQueuedRuns through the injected catalog with exactly one recording leaf call per Run and no second dispatch loop", async () => {
    setSystemTime(new Date(FIXED_NOW_ISO))
    leafPorts.reset()
    const fx = fixtureKey("public-contract.json", "S21")
    // Enforces once runtime-route-catalog.ts exists: production catalog
    // injected through the CLI and jobs-stdio host options.
    const catalog = await productionCatalogState()
    const submission = await import("../src/main/lib/headless/run-submission")
    const daemon = await import("../src/main/lib/headless/daemon")
    const submitSpy = spyOn(submission, "submitRun")
    const pumpSpy = spyOn(daemon, "pumpQueuedRuns")
    const kit = await submitWaitKit()
    const profile = kit.createProfile()
    const requests = fx.requests as JsonObject
    const created = await kit.cli(profile, CREATE_ARGS, {
      stdin: renderTemplate(JSON.stringify(requests.codexBatch), {
        PACKAGE_DIR: profile.packageDir,
      }),
      extra: { runtimeRouteCatalog: catalog },
    })
    const afterCreate = {
      submit: submitSpy.mock.calls.length,
      pump: pumpSpy.mock.calls.length,
      leaf: leafPorts.calls.length,
    }
    const stdio = await kit.cli(profile, ["jobs-stdio"], {
      stdin: `${[
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "job.run",
          params: {
            runtime: "codex",
            mode: "plan",
            cwd: profile.packageDir,
            prompt: "Review this local package.",
          },
        }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "shutdown" }),
      ].join("\n")}\n`,
      extra: { runtimeRouteCatalog: catalog },
    })
    const totals = {
      submit: submitSpy.mock.calls.length,
      pump: pumpSpy.mock.calls.length,
      leaf: leafPorts.calls.map((call) => [call.leaf, call.source]),
    }
    submitSpy.mockRestore()
    pumpSpy.mockRestore()
    profile.cleanup()
    setSystemTime()
    expect({
      createExit: created.code,
      afterCreate: {
        submitted: afterCreate.submit >= 1,
        pumped: afterCreate.pump >= 1,
        leaf: afterCreate.leaf,
      },
      stdioExit: stdio.code,
      submittedTwice: totals.submit >= 2,
      pumpedForBoth: totals.pump >= 2,
      leaf: totals.leaf,
    }).toEqual({
      createExit: 0,
      afterCreate: { submitted: true, pumped: true, leaf: 1 },
      stdioExit: 0,
      submittedTwice: true,
      pumpedForBoth: true,
      leaf: [
        ["codex-batch", "api"],
        ["codex-batch", "protocol"],
      ],
    })
  }, 60_000)

  test(
    "S48 Adapter selection changes — catalog declarations for batch, SDK, app-server and a future source yield zero findings while route, CLI, protocol and Local Job API files that select from a second adapter table yield their exact route-dispatch-outside-owner tuples; OWNERSHIP_MAP names the single owner and drops the superseded selection section",
    () => {
      const observation = guardObservation("S48")
      const ownership = readRepo("docs/OWNERSHIP_MAP.md")
      expect({
        ...observation.actual,
        ownershipSection: ownership.includes(`## ${OWNER_SECTION}`),
        ownershipPinsCatalog: ownership.includes(CATALOG_FILE),
        supersededSection: ownership.includes(
          "## Headless Runtime Adapter Selection",
        ),
        supersededOwner: ownership.includes(
          "Canonical owner: `src/main/lib/headless/adapter-selector.ts`",
        ),
      }).toEqual({
        ...observation.expected,
        ownershipSection: true,
        ownershipPinsCatalog: true,
        supersededSection: false,
        supersededOwner: false,
      })
    },
    GUARD_TIMEOUT_MS,
  )

  test(
    "S50 Temporary dual execution path is required — the restored-selector and dual-path-flag mutations are rejected with their exact retired-route-selector / route-catalog-test-port-in-production tuples and the production source has neither an old selector nor a runtime-route path-selection flag",
    () => {
      const observation = guardObservation("S50")
      const flagPattern = /LOCUS_[A-Z0-9_]*(ROUTE|SELECTOR|DUAL_PATH)[A-Z0-9_]*/
      expect({
        ...observation.actual,
        retiredModulesPresent: RETIRED_MODULES.filter((file) =>
          existsSync(join(REPO_ROOT, file)),
        ),
        retiredSymbolFiles: retiredSymbolHits(),
        pathSelectionFlagFiles: productionFiles("src").filter((file) =>
          flagPattern.test(readRepo(file)),
        ),
      }).toEqual({
        ...observation.expected,
        retiredModulesPresent: [],
        retiredSymbolFiles: [],
        pathSelectionFlagFiles: [],
      })
    },
    GUARD_TIMEOUT_MS,
  )
})
