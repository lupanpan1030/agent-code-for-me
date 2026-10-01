/**
 * Shared harness for the public-guards domain of the independent RED suite
 * of `openspec/changes/refactor-unified-runtime-route-catalog` (S21–S30,
 * S48, S50). Independent red-suite author; written before any
 * implementation exists, against base 19986552 (product source identical to
 * 6192b13f).
 *
 * Test infrastructure only, never product code:
 *
 * - Recording leaf ports. `installRecordingLeafPorts()` replaces the three
 *   headless leaf modules (`headless/adapters/{claude-code,codex,
 *   codex-app-server}.ts`) with recording stubs through `mock.module`, before
 *   any selector/catalog module is loaded. The baseline goldens were captured
 *   through the real `runAgentTask` and the real 6192b13f selector with these
 *   same stubs at the leaf I/O boundary (design.md D1 last paragraph); the
 *   job-runner fake runner (`options.runner` / `LOCUS_HEADLESS_FAKE_RUNNER`)
 *   is never used.
 * - The catalog module and its D1 functions do not exist on the base; they
 *   are always imported lazily inside a test (`loadCatalogModule`) so a
 *   missing seam fails that test instead of the file.
 * - The architecture guard is driven as a child process exactly like
 *   tests/run-event-ledger-guard-self-test.test.ts does.
 */
import { mock } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

export const REPO_ROOT = join(import.meta.dir, "..")
export const FIXTURE_DIR = join(
  import.meta.dir,
  "fixtures",
  "runtime-route-catalog",
)
export const CATALOG_FILE =
  "src/main/lib/agent-runtime/runtime-route-catalog.ts"
export const CATALOG_MODULE = join(REPO_ROOT, CATALOG_FILE)
export const OWNER_SECTION = "Runtime Route Catalog Single Owner"
export const GUARD_FLAG = "--runtime-route-catalog-fixtures="
export const GUARD_FIXTURE_DEFAULT =
  "tests/fixtures/runtime-route-catalog/architecture-fixtures.json"
export const GUARD_TIMEOUT_MS = 180_000
export const SANITIZED_CATALOG_MESSAGE = "Runtime route catalog is unavailable."
/** Fixed wall-clock instant of every byte golden (bun:test setSystemTime). */
export const FIXED_NOW_ISO = "2026-10-02T00:00:00.000Z"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export function loadFixture(name: string): JsonObject {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as JsonObject
}

export function fixtureKey(name: string, key: string): JsonObject {
  const value = loadFixture(name)[key]
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`fixture ${name}#${key} is missing`)
  }
  return value
}

/** Renders `{{NAME}}` placeholders bound from the profile DB/disk. */
export function renderTemplate(
  template: string,
  vars: Record<string, string | number | null>,
): string {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, name: string) => {
    if (!(name in vars)) throw new Error(`golden placeholder ${name} unbound`)
    const value = vars[name]
    return value === null ? "null" : String(value)
  })
}

/**
 * Inverse of `renderTemplate`, used only by the scratch golden generator:
 * replaces every bound value (longest first) with its placeholder, and the
 * worker pid only at `"workerPid":` / `"pid":` positions.
 */
export function templatize(
  text: string,
  vars: Record<string, string | number | null>,
): string {
  let out = text
  const entries = Object.entries(vars)
    .filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1].length >= 8,
    )
    .sort((a, b) => b[1].length - a[1].length)
  for (const [name, value] of entries)
    out = out.split(value).join(`{{${name}}}`)
  const pid = vars.PID
  if (typeof pid === "number") {
    out = out.replace(
      new RegExp(`("(?:workerPid|pid)":)${pid}(?![0-9])`, "g"),
      "$1{{PID}}",
    )
  }
  return out
}

// ---------------------------------------------------------------------------
// Settled results (no swallowing try/catch in tests)
// ---------------------------------------------------------------------------

export type Settled<T> =
  | { fulfilled: true; value: T; reason: null }
  | { fulfilled: false; value: null; reason: string }

export async function settle<T>(
  run: () => T | Promise<T>,
): Promise<Settled<T>> {
  return await Promise.resolve()
    .then(run)
    .then(
      (value) => ({ fulfilled: true as const, value, reason: null }),
      (error: unknown) => ({
        fulfilled: false as const,
        value: null,
        reason: error instanceof Error ? error.message : String(error),
      }),
    )
}

// ---------------------------------------------------------------------------
// Catalog module (NEW; lazy)
// ---------------------------------------------------------------------------

export type CatalogModule = {
  validateRuntimeRouteCatalog: (
    declarations?: unknown,
    references?: unknown,
  ) => { ok: boolean; catalog?: unknown; reason?: string; offending?: unknown }
  listRuntimeRoutes: (filter: unknown, catalog?: unknown) => unknown
  projectRuntimeRoutes: (audience: string, catalog?: unknown) => unknown
  resolveRuntimeRoute: (query: unknown, catalog?: unknown) => unknown
}

/** Enforces once runtime-route-catalog.ts exists: imports it lazily. */
export async function loadCatalogModule(): Promise<CatalogModule> {
  return (await import(CATALOG_MODULE)) as CatalogModule
}

/** The validated production table with its real reference ports. */
export async function productionCatalogState(): Promise<unknown> {
  const catalog = await loadCatalogModule()
  const validated = catalog.validateRuntimeRouteCatalog()
  if (!validated.ok) {
    throw new Error(
      `production runtime route catalog failed validation: ${JSON.stringify(validated)}`,
    )
  }
  return validated.catalog
}

/**
 * A non-executable RuntimeRouteCatalogFailureState: the validator's own
 * `{ok:false, reason:"catalog_invalid", offending}` for a declaration that
 * cannot satisfy any frozen declaration schema (design.md D1:151-157).
 */
export async function failureCatalogState(): Promise<unknown> {
  const catalog = await loadCatalogModule()
  const validated = catalog.validateRuntimeRouteCatalog([
    { routeId: "s24-malformed-declaration" },
  ])
  if (validated.ok || validated.reason !== "catalog_invalid") {
    throw new Error(
      `a malformed declaration did not yield catalog_invalid: ${JSON.stringify(validated)}`,
    )
  }
  return validated
}

// ---------------------------------------------------------------------------
// Recording leaf ports
// ---------------------------------------------------------------------------

export type LeafCall = {
  leaf: "claude-code-batch" | "codex-batch" | "codex-app-server"
  jobId: string
  runtimeId: string
  source: string
  mode: string
  executionProfile: string | null
  permissionPolicyKind: string
}

type LeafRequest = {
  identity?: { jobId?: string }
  context: {
    runtimeId: string
    source: string
    mode: string
    executionProfile?: string | null
  }
  permissionPolicy: { kind: string }
}

type LeafObserver = {
  appendEvent: (type: string, payload: Record<string, unknown>) => void
  heartbeat: () => void
}

export type LeafBehavior =
  | { kind: "succeed" }
  | { kind: "throw"; message: string }

export const leafPorts = {
  calls: [] as LeafCall[],
  behavior: { kind: "succeed" } as LeafBehavior,
  reset(): void {
    leafPorts.calls.length = 0
    leafPorts.behavior = { kind: "succeed" }
  },
}

function recordingLeaf(leaf: LeafCall["leaf"]) {
  return async (request: LeafRequest, observer: LeafObserver) => {
    leafPorts.calls.push({
      leaf,
      jobId: request.identity?.jobId ?? "<none>",
      runtimeId: request.context.runtimeId,
      source: request.context.source,
      mode: request.context.mode,
      executionProfile: request.context.executionProfile ?? null,
      permissionPolicyKind: request.permissionPolicy.kind,
    })
    if (leafPorts.behavior.kind === "throw") {
      throw new Error(leafPorts.behavior.message)
    }
    observer.appendEvent("assistant_delta", {
      text: `fixture ${leaf} response`,
    })
    observer.heartbeat()
    return {
      status: "succeeded",
      exitCode: 0,
      result: { finalMessage: `fixture ${leaf} done` },
    }
  }
}

let leafPortsInstalled = false

/**
 * Must run at the top level of a test file before anything imports a
 * selector, catalog, runner or CLI module. Real exports are kept (spread)
 * so every other importer still links; only the run/create leaf exports are
 * replaced by recording stubs.
 */
export async function installRecordingLeafPorts(): Promise<void> {
  if (leafPortsInstalled) return
  leafPortsInstalled = true
  const claudePath = join(
    REPO_ROOT,
    "src/main/lib/headless/adapters/claude-code",
  )
  const codexPath = join(REPO_ROOT, "src/main/lib/headless/adapters/codex")
  const appServerPath = join(
    REPO_ROOT,
    "src/main/lib/headless/adapters/codex-app-server",
  )
  const realClaude = { ...(await import(`${claudePath}.ts`)) }
  const realCodex = { ...(await import(`${codexPath}.ts`)) }
  const realAppServer = { ...(await import(`${appServerPath}.ts`)) }
  const claudeLeaf = recordingLeaf("claude-code-batch")
  const codexLeaf = recordingLeaf("codex-batch")
  const appServerLeaf = recordingLeaf("codex-app-server")
  mock.module(`${claudePath}.ts`, () => ({
    ...realClaude,
    runClaudeCodeHeadlessTask: claudeLeaf,
  }))
  mock.module(`${codexPath}.ts`, () => ({
    ...realCodex,
    createCodexHeadlessTaskRunner: () => codexLeaf,
    runCodexHeadlessTask: codexLeaf,
  }))
  mock.module(`${appServerPath}.ts`, () => ({
    ...realAppServer,
    createCodexAppServerHeadlessTaskRunner: () => appServerLeaf,
    runCodexAppServerHeadlessTask: appServerLeaf,
  }))
}

// ---------------------------------------------------------------------------
// Architecture guard
// ---------------------------------------------------------------------------

export type GuardFinding = {
  rule: string
  file: string
  symbol: string
  owner: string
  ownerSection: string
}
export type GuardCase = {
  caseId: string
  files: Array<{ file: string; source: string }>
  expectedFindings: GuardFinding[]
}
export type GuardRun = { status: number | null; stdout: string; stderr: string }

export const GUARD_SCENARIOS = [
  "S26",
  "S27",
  "S28",
  "S29",
  "S30",
  "S48",
  "S50",
] as const

export function architectureFixture(): JsonObject {
  return loadFixture("architecture-fixtures.json")
}

export function scenarioCases(fixture: JsonObject, key: string): GuardCase[] {
  const entry = fixture[key] as unknown as { cases?: GuardCase[] } | undefined
  if (!entry?.cases)
    throw new Error(`architecture-fixtures.json#${key} missing`)
  return entry.cases
}

export function totalCaseCount(fixture: JsonObject): number {
  return GUARD_SCENARIOS.reduce(
    (sum, key) => sum + scenarioCases(fixture, key).length,
    0,
  )
}

export function runArchitectureGuard(fixturePath: string): GuardRun {
  const run = spawnSync(
    "node",
    ["scripts/check-architecture-guards.mjs", `${GUARD_FLAG}${fixturePath}`],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: GUARD_TIMEOUT_MS - 10_000 },
  )
  return { status: run.status, stdout: run.stdout, stderr: run.stderr }
}

const tempDirs: string[] = []

export function writeTempJson(name: string, value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "route-catalog-guard-"))
  tempDirs.push(dir)
  const path = join(dir, name)
  writeFileSync(path, JSON.stringify(value, null, 2))
  return path
}

export function cleanupTempDirs(): void {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true })
  }
}

export function findingKey(finding: GuardFinding): string {
  return JSON.stringify([
    finding.rule,
    finding.file,
    finding.symbol,
    finding.owner,
    finding.ownerSection,
  ])
}

// ---------------------------------------------------------------------------
// Public-contract drivers (S21, S24, S25)
// ---------------------------------------------------------------------------

/** The async-submit kit is loaded lazily so recording leaf ports come first. */
export async function submitWaitKit() {
  return await import("./local-job-api-async-submit-wait-kit")
}

type SubmitWaitKit = Awaited<ReturnType<typeof submitWaitKit>>
export type Profile = ReturnType<SubmitWaitKit["createProfile"]>

export type DriverStep = {
  step: string
  code: number
  stdout: string
  stderr: string
}

export type DriverRun = {
  steps: DriverStep[]
  leafCalls: LeafCall[]
  fetchCalls: number
  vars: Record<string, string | number | null>
}

export const CREATE_ARGS = ["api", "runs", "create", "--request", "-", "--json"]
export const SUBMIT_ARGS = ["api", "runs", "submit", "--request", "-", "--json"]

type DbRow = Record<string, string | number | null>

function rows(profile: Profile, sql: string, ...params: string[]): DbRow[] {
  return profile.sqlite.query(sql).all(...params) as DbRow[]
}

/**
 * Placeholder bindings read from the profile DB/disk after the run (never
 * from the stdout under test): jobs J1..Jn and workers W1..Wn in insertion
 * order, ledger correlation keys, temp paths, the checkout root and pid.
 */
export function profileBindings(
  profile: Profile,
): Record<string, string | number | null> {
  const vars: Record<string, string | number | null> = {
    ROOT: profile.root,
    PACKAGE_DIR: profile.packageDir,
    ARTIFACT_BASE: profile.artifactBaseDir,
    // Completion Runs record the CLI process cwd (no project cwd).
    PROCESS_CWD: process.cwd(),
    PID: process.pid,
  }
  const jobs = rows(
    profile,
    "SELECT id, worker_id FROM agent_jobs ORDER BY rowid",
  )
  const workers: string[] = []
  const digests: Array<{ sha256: string; sizeBytes: number }> = []
  jobs.forEach((job, index) => {
    vars[`J${index + 1}`] = String(job.id)
    const worker = job.worker_id
    if (typeof worker === "string" && !workers.includes(worker)) {
      workers.push(worker)
    }
    for (const event of rows(
      profile,
      "SELECT sequence, payload_json FROM agent_job_events WHERE job_id = ? ORDER BY sequence",
      String(job.id),
    )) {
      const payload = JSON.parse(String(event.payload_json ?? "null"))
      const key = payload?.item?.correlationKey
      if (typeof key === "string") {
        vars[`CORR_J${index + 1}_${event.sequence}`] = key
      }
      collectArtifactDigests(payload, digests)
    }
    const manifest = rows(
      profile,
      "SELECT artifact_manifest_path FROM agent_jobs WHERE id = ?",
      String(job.id),
    )[0]?.artifact_manifest_path
    if (typeof manifest === "string" && existsSync(manifest)) {
      collectArtifactDigests(
        JSON.parse(readFileSync(manifest, "utf8")),
        digests,
      )
      const runDir = dirname(manifest)
      for (const name of readdirSync(runDir).sort()) {
        const path = join(runDir, name)
        if (!statSync(path).isFile()) continue
        const bytes = readFileSync(path)
        const sha256 = createHash("sha256").update(bytes).digest("hex")
        if (!digests.some((entry) => entry.sha256 === sha256)) {
          digests.push({ sha256, sizeBytes: bytes.length })
        }
      }
    }
    digests.forEach((entry, k) => {
      if (Object.values(vars).includes(entry.sha256)) return
      vars[`ART_J${index + 1}_${k + 1}`] = entry.sha256
      vars[`ARTSIZE_J${index + 1}_${k + 1}`] = entry.sizeBytes
    })
    digests.length = 0
  })
  workers.forEach((worker, index) => {
    vars[`W${index + 1}`] = worker
  })
  return vars
}

/** Every `{sha256, sizeBytes}` artifact entry inside a JSON value, in order. */
function collectArtifactDigests(
  value: unknown,
  out: Array<{ sha256: string; sizeBytes: number }>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectArtifactDigests(item, out)
    return
  }
  if (!value || typeof value !== "object") return
  const record = value as Record<string, unknown>
  if (
    typeof record.sha256 === "string" &&
    typeof record.sizeBytes === "number" &&
    !out.some((entry) => entry.sha256 === record.sha256)
  ) {
    out.push({ sha256: record.sha256, sizeBytes: record.sizeBytes })
  }
  for (const child of Object.values(record)) collectArtifactDigests(child, out)
}

/** Replaces each bound artifact digest and the size that follows it. */
function templatizeArtifacts(
  text: string,
  vars: Record<string, string | number | null>,
): string {
  return text.replace(
    /"sha256":"([0-9a-f]{64})"((?:,"[A-Za-z]+":(?:"[^"]*"|null))*),"sizeBytes":(\d+)/g,
    (match, sha: string, middle: string) => {
      const name = Object.entries(vars).find(
        ([key, value]) => key.startsWith("ART_") && value === sha,
      )?.[0]
      if (!name) return match
      const size = name.replace("ART_", "ARTSIZE_")
      return `"sha256":"{{${name}}}"${middle},"sizeBytes":{{${size}}}`
    },
  )
}

export function templatizeRun(run: DriverRun): {
  steps: DriverStep[]
  leafCalls: LeafCall[]
  fetchCalls: number
} {
  const t = (value: string) =>
    templatize(templatizeArtifacts(value, run.vars), run.vars).replace(
      new RegExp(`pid=${String(run.vars.PID)}(?![0-9])`, "g"),
      "pid={{PID}}",
    )
  return {
    steps: run.steps.map((step) => ({
      ...step,
      stdout: t(step.stdout),
      stderr: t(step.stderr),
    })),
    leafCalls: run.leafCalls.map((call) => ({ ...call, jobId: t(call.jobId) })),
    fetchCalls: run.fetchCalls,
  }
}

export function renderRun(
  golden: { steps: DriverStep[]; leafCalls: LeafCall[]; fetchCalls: number },
  vars: Record<string, string | number | null>,
): { steps: DriverStep[]; leafCalls: LeafCall[]; fetchCalls: number } {
  return {
    steps: golden.steps.map((step) => ({
      ...step,
      stdout: renderTemplate(step.stdout, vars),
      stderr: renderTemplate(step.stderr, vars),
    })),
    leafCalls: golden.leafCalls.map((call) => ({
      ...call,
      jobId: renderTemplate(call.jobId, vars),
    })),
    fetchCalls: golden.fetchCalls,
  }
}

function renderRequest(value: JsonValue, profile: Profile): string {
  return renderTemplate(JSON.stringify(value), {
    ROOT: profile.root,
    PACKAGE_DIR: profile.packageDir,
    ARTIFACT_BASE: profile.artifactBaseDir,
  })
}

export type DriverOptions = {
  /** Extra RunHeadlessCliCommandOptions keys (e.g. runtimeRouteCatalog). */
  extra: Record<string, unknown>
}

type StepRunner = (
  step: string,
  args: string[],
  options?: { stdin?: string; extra?: Record<string, unknown> },
) => Promise<DriverStep>

function stepRunner(
  kit: SubmitWaitKit,
  profile: Profile,
  steps: DriverStep[],
  base: DriverOptions,
  completionFetch?: (url: unknown, init?: unknown) => Promise<Response>,
): StepRunner {
  return async (step, args, options = {}) => {
    const result = await kit.cli(profile, args, {
      stdin: options.stdin,
      ...(completionFetch ? { completionFetch } : {}),
      extra: { ...base.extra, ...(options.extra ?? {}) },
    })
    const entry = { step, ...result }
    steps.push(entry)
    return entry
  }
}

function lastJobId(profile: Profile): string {
  const job = rows(
    profile,
    "SELECT id FROM agent_jobs ORDER BY rowid DESC LIMIT 1",
  )[0]
  return job ? String(job.id) : "<no-job>"
}

const DAEMON_ONCE = ["daemon", "run", "--once", "--poll-interval-ms", "100"]

function waitArgs(jobId: string, timeout: string): string[] {
  return ["api", "runs", "wait", jobId, "--timeout", timeout, "--json"]
}

function readArgs(command: string, jobId: string, ...rest: string[]): string[] {
  return ["api", "runs", command, jobId, ...rest]
}

/** S21 agent operations, in a fixed order (public-contract.json#S21). */
export async function runAgentContract(
  requests: JsonObject,
  options: DriverOptions,
): Promise<DriverRun> {
  const kit = await submitWaitKit()
  const profile = kit.createProfile()
  leafPorts.reset()
  const steps: DriverStep[] = []
  const run = stepRunner(kit, profile, steps, options)
  const clock = () => ({ monotonicClock: kit.createFakeMonotonicClock() })
  const body = (name: string) => renderRequest(requests[name], profile)
  try {
    await run("create-batch", CREATE_ARGS, { stdin: body("codexBatch") })
    await run("submit-keyed", SUBMIT_ARGS, { stdin: body("codexBatchKeyed") })
    const queued = lastJobId(profile)
    await run("submit-keyed-replay", SUBMIT_ARGS, {
      stdin: body("codexBatchKeyed"),
    })
    await run("submit-keyed-conflict", SUBMIT_ARGS, {
      stdin: body("codexBatchKeyedConflict"),
    })
    await run("wait-timeout", waitArgs(queued, "1"), { extra: clock() })
    await run("daemon-once", DAEMON_ONCE)
    await run("wait-ready", waitArgs(queued, "5"), { extra: clock() })
    await run("status", readArgs("status", queued, "--json"))
    await run(
      "events-after",
      readArgs("events", queued, "--after", "2", "--jsonl"),
    )
    await run(
      "events-follow",
      readArgs("events", queued, "--follow", "--jsonl"),
    )
    await run("result", readArgs("result", queued, "--json"))
    await run("create-claude-policy-grant", CREATE_ARGS, {
      stdin: body("claudePolicyGrant"),
    })
    const refused = lastJobId(profile)
    await run(
      "events-claude-policy-grant",
      readArgs("events", refused, "--jsonl"),
    )
    await run(
      "result-claude-policy-grant",
      readArgs("result", refused, "--json"),
    )
    await run("retry-sync", readArgs("retry", refused, "--json"), {
      extra: clock(),
    })
    await run("retry-async", readArgs("retry", refused, "--async", "--json"))
    const asyncRetry = lastJobId(profile)
    await run("cancel", readArgs("cancel", asyncRetry, "--json"))
    await run("status-canceled", readArgs("status", asyncRetry, "--json"))
    await run("create-fail-closed", CREATE_ARGS, {
      stdin: body("codexFailClosed"),
    })
    await run(
      "events-fail-closed",
      readArgs("events", lastJobId(profile), "--jsonl"),
    )
    await run("create-codex-policy-grant", CREATE_ARGS, {
      stdin: body("codexPolicyGrant"),
    })
    await run(
      "events-codex-policy-grant",
      readArgs("events", lastJobId(profile), "--jsonl"),
    )
    await run("create-claude-batch", CREATE_ARGS, {
      stdin: body("claudeBatch"),
    })
    await run(
      "events-claude-batch",
      readArgs("events", lastJobId(profile), "--jsonl"),
    )
    return {
      steps,
      leafCalls: [...leafPorts.calls],
      fetchCalls: 0,
      vars: profileBindings(profile),
    }
  } finally {
    profile.cleanup()
  }
}

/**
 * Deterministic upstream for completion Runs: a message containing
 * "FAIL_UPSTREAM" gets an HTTP 500 so the Run fails and can be retried.
 */
export function completionUpstream(): {
  fetchImpl: (url: unknown, init?: unknown) => Promise<Response>
  calls: string[]
} {
  const calls: string[] = []
  const fetchImpl = async (url: unknown, init?: unknown) => {
    const body = String((init as { body?: unknown } | undefined)?.body ?? "")
    calls.push(String(url))
    if (body.includes("FAIL_UPSTREAM")) {
      return new Response(JSON.stringify({ error: { message: "fixture" } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    }
    return new Response(
      JSON.stringify({
        output_text: JSON.stringify({ summary: "fixture" }),
        usage: { input_tokens: 11, output_tokens: 5 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )
  }
  return { fetchImpl, calls }
}

/** S21 completion operations, in a fixed order (public-contract.json#S21). */
export async function runCompletionContract(
  requests: JsonObject,
  options: DriverOptions,
): Promise<DriverRun> {
  const kit = await submitWaitKit()
  const profile = kit.createProfile()
  kit.seedProviderProfile(profile, {
    id: "completion-main",
    targets: ["codex"],
  })
  leafPorts.reset()
  const upstream = completionUpstream()
  const steps: DriverStep[] = []
  const run = stepRunner(kit, profile, steps, options, upstream.fetchImpl)
  const clock = () => ({ monotonicClock: kit.createFakeMonotonicClock() })
  const body = (name: string) => renderRequest(requests[name], profile)
  try {
    await run("create-completion", CREATE_ARGS, { stdin: body("completion") })
    await run("submit-completion-keyed", SUBMIT_ARGS, {
      stdin: body("completionKeyed"),
    })
    const queued = lastJobId(profile)
    await run("submit-completion-replay", SUBMIT_ARGS, {
      stdin: body("completionKeyed"),
    })
    await run("submit-completion-conflict", SUBMIT_ARGS, {
      stdin: body("completionKeyedConflict"),
    })
    await run("wait-completion-timeout", waitArgs(queued, "1"), {
      extra: clock(),
    })
    await run("daemon-once", DAEMON_ONCE)
    await run("wait-completion-ready", waitArgs(queued, "5"), {
      extra: clock(),
    })
    await run("status-completion", readArgs("status", queued, "--json"))
    await run(
      "events-completion-after",
      readArgs("events", queued, "--after", "1", "--jsonl"),
    )
    await run(
      "events-completion-follow",
      readArgs("events", queued, "--follow", "--jsonl"),
    )
    await run("result-completion", readArgs("result", queued, "--json"))
    await run("create-completion-upstream-failure", CREATE_ARGS, {
      stdin: body("completionUpstreamFailure"),
    })
    const failed = lastJobId(profile)
    await run("retry-completion-sync", readArgs("retry", failed, "--json"), {
      extra: clock(),
    })
    await run(
      "retry-completion-async",
      readArgs("retry", failed, "--async", "--json"),
    )
    const asyncRetry = lastJobId(profile)
    await run("cancel-completion", readArgs("cancel", asyncRetry, "--json"))
    await run(
      "status-completion-canceled",
      readArgs("status", asyncRetry, "--json"),
    )
    return {
      steps,
      leafCalls: [...leafPorts.calls],
      fetchCalls: upstream.calls.length,
      vars: profileBindings(profile),
    }
  } finally {
    profile.cleanup()
  }
}

/**
 * S24 surface refusals in a fixed order (errors.json#S24). `leafThrow`
 * steps run the recording leaf in throw mode with the sanitized catalog
 * message; on the baseline that is the runner-level oracle of
 * job-runner.ts:820-836 that an injected catalog failure must reproduce.
 */
export async function runRefusalSurfaces(
  requests: JsonObject,
  options: DriverOptions,
): Promise<DriverRun> {
  const kit = await submitWaitKit()
  const profile = kit.createProfile()
  leafPorts.reset()
  const steps: DriverStep[] = []
  const run = stepRunner(kit, profile, steps, options)
  const clock = () => ({ monotonicClock: kit.createFakeMonotonicClock() })
  const body = (name: string) => renderRequest(requests[name], profile)
  try {
    for (const name of [
      "admissionUnsupportedCodex",
      "admissionUnsupportedClaude",
      "parserUnknownRuntime",
      "providerProfileMissing",
      "guardedScopeHardToolGuard",
      "claudePolicyGrant",
      "codexFailClosed",
    ]) {
      await run(`create-${name}`, CREATE_ARGS, { stdin: body(name) })
    }
    await run("submit-for-wait", SUBMIT_ARGS, { stdin: body("waitOnly") })
    const queued = lastJobId(profile)
    await run("wait-only-timeout", waitArgs(queued, "1"), { extra: clock() })
    await run("cancel-wait-only", readArgs("cancel", queued, "--json"))
    const seeded = await kit.seedQueuedApiJob(profile)
    profile.sqlite
      .query(
        "UPDATE agent_jobs SET input_json = replace(input_json, '\"planMode\"', '\"rollback\"') WHERE id = ?",
      )
      .run(seeded)
    await run("claim-gate-daemon-once", DAEMON_ONCE)
    await run("claim-gate-status", readArgs("status", seeded, "--json"))
    await run("run-unsupported-runtime", [
      "run",
      "--runtime",
      "gemini",
      "--mode",
      "plan",
      "--cwd",
      profile.packageDir,
      "--prompt",
      "Review this local package.",
      "--json",
    ])
    await run("schedule-unsupported-runtime", [
      "schedules",
      "create",
      "--name",
      "fixture schedule",
      "--runtime",
      "gemini",
      "--cwd",
      profile.packageDir,
      "--prompt",
      "Review this local package.",
      "--json",
    ])
    await run("schedule-unregistered-cwd", [
      "schedules",
      "create",
      "--name",
      "fixture schedule",
      "--runtime",
      "codex",
      "--cwd",
      join(profile.root, "unregistered"),
      "--prompt",
      "Review this local package.",
      "--json",
    ])
    await run("jobs-stdio-malformed", ["jobs-stdio"], {
      stdin: [
        "{not json",
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "job.unknown" }),
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "job.run",
          params: {
            runtime: "gemini",
            mode: "plan",
            cwd: profile.packageDir,
            prompt: "Review this local package.",
          },
        }),
        JSON.stringify({ jsonrpc: "2.0", id: 3, method: "shutdown" }),
        "",
      ].join("\n"),
    })
    leafPorts.behavior = { kind: "throw", message: SANITIZED_CATALOG_MESSAGE }
    await run("create-leaf-throw-oracle", CREATE_ARGS, {
      stdin: body("codexBatch"),
    })
    leafPorts.behavior = { kind: "succeed" }
    return {
      steps,
      leafCalls: [...leafPorts.calls],
      fetchCalls: 0,
      vars: profileBindings(profile),
    }
  } finally {
    profile.cleanup()
  }
}

/** Observer-level payloads of one direct runAgentTask call. */
export type DirectRun = {
  events: Array<{ type: string; payload: Record<string, unknown> }>
  result: unknown
}

/**
 * Calls the real runAgentTask (D1: optional third options argument carrying
 * runtimeRouteCatalog) with a request built by the real request factory.
 */
export async function runAgentTaskDirect(
  input: {
    runtime: "claude-code" | "codex"
    mode: "plan" | "agent"
    executionProfile: "batch" | "policy-grant" | "interactive"
    hasVisibleUserInteractionChannel?: boolean
    policyGrant?: { scopes: string[] } | null
    requestedCapabilities?: string[]
  },
  third: Record<string, unknown> | undefined,
): Promise<DirectRun> {
  const contract = await import(
    "../src/main/lib/headless/agent-runtime-contract"
  )
  const runtime = await import("../src/main/lib/headless/agent-runtime")
  const request = contract.createAgentRuntimeRunRequest({
    jobId: "s-direct-job",
    runtime: input.runtime,
    cwd: "/fixture/cwd",
    mode: input.mode,
    source: "api",
    executionProfile: input.executionProfile,
    prompt: "Direct fixture prompt.",
    signal: new AbortController().signal,
    attempt: 1,
    hasVisibleUserInteractionChannel: input.hasVisibleUserInteractionChannel,
    policyGrant: input.policyGrant ?? null,
  })
  if (input.requestedCapabilities) {
    Object.assign(request, {
      requestedCapabilities: input.requestedCapabilities,
    })
  }
  const events: DirectRun["events"] = []
  const observer = {
    appendEvent(type: string, payload: Record<string, unknown>) {
      events.push({ type, payload })
    },
    heartbeat() {},
    isCancelRequested: () => false,
  }
  const runAgentTask = runtime.runAgentTask as (
    request: unknown,
    observer: unknown,
    options?: Record<string, unknown>,
  ) => Promise<unknown>
  const result =
    third === undefined
      ? await runAgentTask(request, observer)
      : await runAgentTask(request, observer, third)
  return { events, result }
}

/** S25 artifact/publication residuals (artifacts.json#S25). */
export async function runArtifactResiduals(
  requests: JsonObject,
  options: DriverOptions,
): Promise<DriverRun & { observations: JsonObject }> {
  const kit = await submitWaitKit()
  const profile = kit.createProfile()
  leafPorts.reset()
  const steps: DriverStep[] = []
  const run = stepRunner(kit, profile, steps, options)
  const clock = () => ({ monotonicClock: kit.createFakeMonotonicClock() })
  const body = (name: string) => renderRequest(requests[name], profile)
  const original = Object.getOwnPropertyDescriptor(process, "platform")
  try {
    Object.defineProperty(process, "platform", { value: "win32" })
    const win32 = await settle(() =>
      run("create-win32-artifacts", CREATE_ARGS, {
        stdin: body("codexArtifacts"),
      }),
    )
    if (original) Object.defineProperty(process, "platform", original)
    const refusedId = lastJobId(profile)
    await run("status-win32-artifacts", readArgs("status", refusedId, "--json"))
    await run(
      "events-win32-artifacts",
      readArgs("events", refusedId, "--jsonl"),
    )
    await run("create-artifacts", CREATE_ARGS, {
      stdin: body("codexArtifacts"),
    })
    const published = lastJobId(profile)
    const runDir = String(
      rows(
        profile,
        "SELECT artifact_base_dir FROM agent_jobs WHERE id = ?",
        published,
      )[0]?.artifact_base_dir ?? "",
    )
    const removed = join(runDir, String(requests.removedTerminalFile))
    rmSync(removed, { force: true })
    const eventsBefore = rows(
      profile,
      "SELECT sequence FROM agent_job_events WHERE job_id = ?",
      published,
    ).length
    const digestsBefore = kit.dirDigests(runDir)
    await run("wait-incomplete-publication", waitArgs(published, "1"), {
      extra: clock(),
    })
    await run(
      "result-incomplete-publication",
      readArgs("result", published, "--json"),
    )
    const eventsAfter = rows(
      profile,
      "SELECT sequence FROM agent_job_events WHERE job_id = ?",
      published,
    ).length
    const digestsAfter = kit.dirDigests(runDir)
    return {
      steps,
      leafCalls: [...leafPorts.calls],
      fetchCalls: 0,
      vars: profileBindings(profile),
      observations: {
        win32CreateSettled: win32.fulfilled,
        removedFilePresentAfterWait: kit.readFileOrNull(removed) !== null,
        eventsAddedByWait: eventsAfter - eventsBefore,
        runDirUnchangedByWait:
          JSON.stringify(digestsBefore) === JSON.stringify(digestsAfter),
      },
    }
  } finally {
    if (original) Object.defineProperty(process, "platform", original)
    profile.cleanup()
  }
}

/**
 * One artifact-free codex batch create in a fresh profile (errors.json#S24
 * catalogFailure). With `leafThrow` the recording leaf throws the sanitized
 * catalog message (baseline oracle); otherwise the caller injects a
 * RuntimeRouteCatalogFailureState through `options.extra`.
 */
export async function runCatalogFailureCreate(
  requests: JsonObject,
  options: DriverOptions & { leafThrow: boolean },
): Promise<DriverRun & { eventPayloads: string[] }> {
  const kit = await submitWaitKit()
  const profile = kit.createProfile()
  leafPorts.reset()
  if (options.leafThrow) {
    leafPorts.behavior = { kind: "throw", message: SANITIZED_CATALOG_MESSAGE }
  }
  const steps: DriverStep[] = []
  const run = stepRunner(kit, profile, steps, options)
  try {
    await run("create-catalog-failure", CREATE_ARGS, {
      stdin: renderRequest(requests.codexBatch, profile),
    })
    const eventPayloads = rows(
      profile,
      "SELECT type, payload_json FROM agent_job_events ORDER BY job_id, sequence",
    ).map((row) => `${row.type} ${row.payload_json}`)
    return {
      steps,
      leafCalls: [...leafPorts.calls],
      fetchCalls: 0,
      vars: profileBindings(profile),
      eventPayloads,
    }
  } finally {
    leafPorts.behavior = { kind: "succeed" }
    profile.cleanup()
  }
}
