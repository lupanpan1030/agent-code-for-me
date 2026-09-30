/**
 * Test-first acceptance suite for `openspec/changes/refactor-canonical-run-event-ledger`,
 * domain C (deletion guards and migration): the architecture-ownership delta,
 * plus the store-migration / historical-row and two-stage provenance facets
 * of the agent-runtime-core delta that are observable in SQLite rows.
 *
 * Architecture tests assert source structure only (TypeScript AST facts over
 * `src/`, the Ownership Map text and the architecture guard's own run), never
 * runtime outcomes or secret leakage. Migration tests apply the real drizzle
 * migrations to temporary SQLite databases: first the pre-ledger migrations
 * 0000-0023 (the journal copied and truncated in a temp dir), then the
 * pre-ledger rows from `legacy-store.json`, then every later migration.
 * Provenance tests drive the existing CLI entry points (API create, run
 * --daemon + jobs cancel, completion create) and read the persisted rows.
 *
 * Tests labelled "(green-by-design)" pass on the pre-implementation base by
 * design and must keep passing. Every other test is expected RED on the base.
 */
import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { Readable } from "node:stream"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import ts from "typescript"
import * as schema from "../src/main/lib/db/schema"
import type {
  AgentRuntimeObserver,
  AgentRuntimeRunResult,
} from "../src/main/lib/headless/agent-runtime-contract"
import { HEADLESS_CLI_MARKER } from "../src/main/lib/headless/cli-args"
import { runHeadlessCliCommand } from "../src/main/lib/headless/cli-dispatcher"

const REPO_ROOT = join(import.meta.dir, "..")
const FIXTURE_DIR = join(import.meta.dir, "fixtures/run-event-ledger")
const MIGRATIONS_DIR = join(REPO_ROOT, "drizzle")
const ARCHITECTURE_FIXTURE_PATH =
  "tests/fixtures/run-event-ledger/architecture-fixtures.json"
const GUARD_TIMEOUT_MS = 180_000
const CLI_TEST_TIMEOUT_MS = 30_000

// biome-ignore lint/suspicious/noExplicitAny: coordinator adjudication (CI PR-base lint ratchet) — untyped fixture JSON; no assertion changed
type Json = any

function fixture(name: string): Json {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8"))
}

function caseById(file: string, caseId: string): Json {
  const found = fixture(file).cases.find(
    (entry: { caseId: string }) => entry.caseId === caseId,
  )
  if (!found) throw new Error(`Missing fixture case ${file}#${caseId}`)
  return found
}

// ---------------------------------------------------------------------------
// Static source facts (TypeScript AST; structure only)
// ---------------------------------------------------------------------------

function walkSource(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry)
    if (statSync(absolute).isDirectory()) {
      walkSource(absolute, found)
    } else if (/\.(ts|tsx|mts|cts)$/.test(entry) && !entry.endsWith(".d.ts")) {
      found.push(absolute)
    }
  }
  return found
}

type SourceFacts = {
  file: string
  definitions: Set<string>
  reexports: Set<string>
  identifiers: Set<string>
  exportedNames: Set<string>
  eventInsertFunctions: Set<string>
  eventInsertCount: number
  text: string
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  )
}

function collectSourceFacts(absolutePath: string): SourceFacts {
  const text = readFileSync(absolutePath, "utf8")
  const file = relative(REPO_ROOT, absolutePath).split("\\").join("/")
  const sourceFile = ts.createSourceFile(
    absolutePath,
    text,
    ts.ScriptTarget.Latest,
    true,
  )
  const facts: SourceFacts = {
    file,
    definitions: new Set(),
    reexports: new Set(),
    identifiers: new Set(),
    exportedNames: new Set(),
    eventInsertFunctions: new Set(),
    eventInsertCount: 0,
    text,
  }
  const eventTableAliases = new Set<string>()
  // First pass: import aliases of the agentJobEvents table.
  sourceFile.forEachChild((node) => {
    if (
      ts.isImportDeclaration(node) &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const element of node.importClause.namedBindings.elements) {
        const imported = (element.propertyName ?? element.name).text
        if (imported === "agentJobEvents")
          eventTableAliases.add(element.name.text)
      }
    }
  })
  const enclosingFunctionName = (node: ts.Node): string | null => {
    let current: ts.Node | undefined = node.parent
    while (current) {
      if (
        (ts.isFunctionDeclaration(current) ||
          ts.isFunctionExpression(current) ||
          ts.isArrowFunction(current)) &&
        current.parent
      ) {
        if (ts.isFunctionDeclaration(current) && current.name) {
          return current.name.text
        }
        if (
          ts.isVariableDeclaration(current.parent) &&
          ts.isIdentifier(current.parent.name)
        ) {
          return current.parent.name.text
        }
      }
      current = current.parent
    }
    return null
  }
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      facts.definitions.add(node.name.text)
      if (hasExportModifier(node)) facts.exportedNames.add(node.name.text)
    }
    if (ts.isClassDeclaration(node) && node.name) {
      facts.definitions.add(node.name.text)
      if (hasExportModifier(node)) facts.exportedNames.add(node.name.text)
    }
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          facts.definitions.add(declaration.name.text)
          if (hasExportModifier(node)) {
            facts.exportedNames.add(declaration.name.text)
          }
        }
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      facts.definitions.add(node.name.text)
    }
    if (ts.isExportDeclaration(node) && node.exportClause) {
      if (ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          const local = (element.propertyName ?? element.name).text
          facts.exportedNames.add(element.name.text)
          if (node.moduleSpecifier) {
            facts.reexports.add(local)
          } else {
            facts.exportedNames.add(local)
          }
        }
      }
    }
    if (ts.isIdentifier(node)) facts.identifiers.add(node.text)
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression)
    ) {
      facts.identifiers.add(node.argumentExpression.text)
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "insert" &&
      node.arguments.length > 0
    ) {
      const target = node.arguments[0]
      const targetName = ts.isIdentifier(target)
        ? target.text
        : ts.isPropertyAccessExpression(target)
          ? target.name.text
          : null
      if (
        targetName === "agentJobEvents" ||
        (targetName !== null && eventTableAliases.has(targetName))
      ) {
        facts.eventInsertCount += 1
        const owner = enclosingFunctionName(node)
        if (owner) facts.eventInsertFunctions.add(owner)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return facts
}

function collectAllSourceFacts(): SourceFacts[] {
  return walkSource(join(REPO_ROOT, "src")).map(collectSourceFacts)
}

function ownershipSection(markdown: string, heading: string): string {
  const start = markdown.indexOf(`## ${heading}`)
  if (start < 0) return ""
  const rest = markdown.slice(start + heading.length + 3)
  const next = rest.search(/\n## /)
  return next < 0 ? rest : rest.slice(0, next)
}

// ---------------------------------------------------------------------------
// architecture-ownership / Canonical Runtime Event Mapping Single Path
// ---------------------------------------------------------------------------

describe("architecture-ownership / Canonical Runtime Event Mapping Single Path", () => {
  test("S38 Second event mapping definition appears — every pinned canonical symbol is defined only in its stated owner module and re-exported nowhere else", () => {
    const pins = fixture("architecture-fixtures.json").pinnedOwners as Record<
      string,
      string
    >
    const facts = collectAllSourceFacts()
    const report = Object.fromEntries(
      Object.entries(pins).map(([symbol, owner]) => [
        symbol,
        {
          owner,
          definedIn: facts
            .filter((entry) => entry.definitions.has(symbol))
            .map((entry) => entry.file)
            .sort(),
          reexportedIn: facts
            .filter((entry) => entry.reexports.has(symbol))
            .map((entry) => entry.file)
            .sort(),
          exportedByOwner:
            facts
              .find((entry) => entry.file === owner)
              ?.exportedNames.has(symbol) ?? false,
        },
      ]),
    )
    expect(report).toEqual(
      Object.fromEntries(
        Object.entries(pins).map(([symbol, owner]) => [
          symbol,
          {
            owner,
            definedIn: [owner],
            reexportedIn: [],
            exportedByOwner: true,
          },
        ]),
      ),
    )
  })

  test("S38 Second event mapping definition appears — the Ownership Map's Runtime Events, Trace, And Redaction section pins the ledger, host, provenance, artifact and ingress owners, and the map records the stateless decoder and provenance/recovery owner rows", () => {
    const architecture = fixture("architecture-fixtures.json")
    const markdown = readFileSync(
      join(REPO_ROOT, "docs/OWNERSHIP_MAP.md"),
      "utf8",
    )
    const section = ownershipSection(markdown, architecture.ownerSection)
    expect(section.length).toBeGreaterThan(0)
    const requiredInSection = [
      "src/main/lib/agent-runtime/run-event-ledger.ts",
      "src/main/lib/agent-runtime/run-event-ledger-host.ts",
      "src/main/lib/agent-runtime/run-provenance.ts",
      "src/main/lib/agent-runtime/run-artifacts.ts",
      "src/main/lib/agent-runtime/runtime-events.ts",
      "src/main/lib/agent-runtime/redaction.ts",
      "appendExactRunEventBatch",
      "captureRunExecutionProvenance",
    ]
    expect(
      requiredInSection.filter((entry) => !section.includes(entry)),
    ).toEqual([])
    const requiredInMap = [
      "src/main/lib/agent-runtime/ledger-ingress.ts",
      "decodeCodexNativeBoundary",
      "src/main/lib/codex/app-server-stream-events.ts",
      "src/main/lib/headless/job-recovery.ts",
      "src/main/lib/headless/local-job-api.ts",
    ]
    expect(requiredInMap.filter((entry) => !markdown.includes(entry))).toEqual(
      [],
    )
  })

  test("S39 Route or runtime adapter writes job events directly — appendExactRunEventBatch is referenced only by its job-store definition and its sole importer run-event-ledger-host.ts", () => {
    const architecture = fixture("architecture-fixtures.json")
    const storeOwner = architecture.pinnedOwners.appendExactRunEventBatch
    const importer = architecture.storeAppendImporter
    const facts = collectAllSourceFacts()
    const referencing = facts
      .filter((entry) => entry.identifiers.has("appendExactRunEventBatch"))
      .map((entry) => entry.file)
      .sort()
    expect(referencing).toEqual([importer, storeOwner].sort())
    const host = facts.find((entry) => entry.file === importer)
    expect(host?.text.includes("headless/job-store")).toBe(true)
  })

  test("S39 Route or runtime adapter writes job events directly — the eleven removed legacy exports and helpers (including createAgentJobRunEvent and appendAgentJobEvent) have no definitions, re-exports or call sites and job-event-bridge.ts is deleted", () => {
    const architecture = fixture("architecture-fixtures.json")
    const legacy = architecture.legacySymbols as string[]
    expect(legacy).toHaveLength(11)
    const facts = collectAllSourceFacts()
    const residue = facts.flatMap((entry) =>
      legacy
        .filter(
          (symbol) =>
            entry.definitions.has(symbol) ||
            entry.reexports.has(symbol) ||
            entry.identifiers.has(symbol),
        )
        .map((symbol) => `${entry.file}:${symbol}`),
    )
    expect(residue).toEqual([])
    expect(
      existsSync(
        join(REPO_ROOT, "src/main/lib/agent-runtime/job-event-bridge.ts"),
      ),
    ).toBe(false)
  })

  test("S39 Route or runtime adapter writes job events directly — no db.insert(agentJobEvents) exists outside headless/job-store.ts, including the schedules bypass", () => {
    const storeOwner = fixture("architecture-fixtures.json").pinnedOwners
      .appendExactRunEventBatch
    const facts = collectAllSourceFacts()
    const outside = facts
      .filter(
        (entry) => entry.file !== storeOwner && entry.eventInsertCount > 0,
      )
      .map((entry) => entry.file)
    expect(outside).toEqual([])
    const store = facts.find((entry) => entry.file === storeOwner)
    expect(store?.eventInsertCount ?? 0).toBeGreaterThan(0)
  })

  test("S39 Route or runtime adapter writes job events directly — job-store exports appendExactRunEventBatch while its record insert helper stays module-private", () => {
    const storeOwner = fixture("architecture-fixtures.json").pinnedOwners
      .appendExactRunEventBatch
    const store = collectSourceFacts(join(REPO_ROOT, storeOwner))
    expect(store.exportedNames.has("appendExactRunEventBatch")).toBe(true)
    expect(store.exportedNames.has("appendAgentJobEvent")).toBe(false)
    const insertHelpers = [...store.eventInsertFunctions].filter(
      (name) => name !== "appendExactRunEventBatch",
    )
    expect(insertHelpers.length).toBeGreaterThan(0)
    expect(
      insertHelpers.filter((name) => store.exportedNames.has(name)),
    ).toEqual([])
  })

  test("S39 Route or runtime adapter writes job events directly — historical wrapper decoding (runEventSequence) is confined to the single versioned Workbench reader with no live wrapper writer", () => {
    const facts = collectAllSourceFacts()
    const wrapperReferences = facts
      .filter((entry) => entry.text.includes("runEventSequence"))
      .map((entry) => entry.file)
    expect(wrapperReferences).toHaveLength(1)
    expect(
      wrapperReferences.filter((file) =>
        file.startsWith("src/renderer/features/agents/workbench/"),
      ),
    ).toEqual(wrapperReferences)
  })

  test("S39 Route or runtime adapter writes job events directly — no transitional canonicalRunEventLedgerV1 gate, legacy branch or transition guard mode remains in src/ or scripts/ (green-by-design)", () => {
    const files = [
      ...walkSource(join(REPO_ROOT, "src")),
      ...readdirSync(join(REPO_ROOT, "scripts"))
        .filter((entry) => /\.(mjs|js|ts|cjs)$/.test(entry))
        .map((entry) => join(REPO_ROOT, "scripts", entry)),
    ]
    const residue = files
      .filter((absolute) => {
        const text = readFileSync(absolute, "utf8")
        return (
          text.includes("canonicalRunEventLedgerV1") ||
          text.includes("run-event-ledger-phase")
        )
      })
      .map((absolute) => relative(REPO_ROOT, absolute))
    expect(residue).toEqual([])
  })

  test(
    "S40 Guard proves its own detection — the architecture guard consumes architecture-fixtures.json (clean, duplicate-definition, forbidden-import, exported-insert, direct-event-insert and legacy-symbol cases) and its self-test passes",
    () => {
      const architecture = fixture("architecture-fixtures.json")
      const categories = new Set(
        architecture.cases.map((entry: Json) => entry.category),
      )
      for (const category of [
        "clean",
        "duplicate-definition",
        "forbidden-import",
        "exported-insert",
        "direct-event-insert",
        "legacy-symbol",
      ]) {
        expect(categories.has(category)).toBe(true)
      }
      const clean = architecture.cases.filter(
        (entry: Json) => entry.category === "clean",
      )
      expect(
        clean.every((entry: Json) => entry.expectedFindings.length === 0),
      ).toBe(true)
      const findings = architecture.cases.flatMap(
        (entry: Json) => entry.expectedFindings,
      )
      expect(
        findings.every(
          (finding: Json) => finding.ownerSection === architecture.ownerSection,
        ),
      ).toBe(true)

      const guardSource = readFileSync(
        join(REPO_ROOT, "scripts/check-architecture-guards.mjs"),
        "utf8",
      )
      expect(guardSource.includes(ARCHITECTURE_FIXTURE_PATH)).toBe(true)

      const run = spawnSync("node", ["scripts/check-architecture-guards.mjs"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: GUARD_TIMEOUT_MS - 10_000,
      })
      expect(`${run.stdout}${run.stderr}`).toContain(
        "Architecture guard passed.",
      )
      expect(run.status).toBe(0)
    },
    GUARD_TIMEOUT_MS,
  )
})

// ---------------------------------------------------------------------------
// Migration helpers
// ---------------------------------------------------------------------------

function stagedMigrationFolder(lastIdx: number): string {
  const folder = mkdtempSync(join(tmpdir(), "run-event-ledger-migrations-"))
  cpSync(MIGRATIONS_DIR, folder, { recursive: true })
  const journalPath = join(folder, "meta/_journal.json")
  const journal = JSON.parse(readFileSync(journalPath, "utf8"))
  journal.entries = journal.entries.filter(
    (entry: { idx: number }) => entry.idx <= lastIdx,
  )
  writeFileSync(journalPath, JSON.stringify(journal))
  return folder
}

function insertRow(
  sqlite: Database,
  table: string,
  row: Record<string, unknown>,
) {
  const columns = Object.keys(row)
  sqlite
    .query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns
        .map(() => "?")
        .join(", ")})`,
    )
    .run(...(Object.values(row) as never[]))
}

/** Pre-ledger database with legacy rows, then every later migration applied. */
function migrateLegacyStore() {
  const input = caseById("legacy-store.json", "legacy-migration")
  const sqlite = new Database(":memory:")
  sqlite.exec("PRAGMA foreign_keys = ON")
  const db = drizzle(sqlite, { schema })
  migrate(db, {
    migrationsFolder: stagedMigrationFolder(input.lastPreLedgerMigrationIdx),
  })
  for (const job of input.jobs) insertRow(sqlite, "agent_jobs", job)
  for (const event of input.events) insertRow(sqlite, "agent_job_events", event)
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  return { input, sqlite, db }
}

function tableColumns(sqlite: Database, table: string): Json[] {
  return sqlite.query(`PRAGMA table_info(${table})`).all() as Json[]
}

function createMigratedDb() {
  const sqlite = new Database(":memory:")
  sqlite.exec("PRAGMA foreign_keys = ON")
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  return { sqlite, db }
}

function seedProject(db: ReturnType<typeof createMigratedDb>["db"]) {
  const projectRoot = realpathSync(
    mkdtempSync(join(tmpdir(), "run-event-ledger-guards-")),
  )
  const packageDir = join(projectRoot, "pkg")
  mkdirSync(packageDir)
  db.insert(schema.projects)
    .values({
      id: "project-domain-c-guards",
      name: "Guards",
      path: projectRoot,
    })
    .run()
  return { projectRoot, packageDir: realpathSync(packageDir) }
}

async function runCli(
  db: ReturnType<typeof createMigratedDb>["db"],
  argv: string[],
  options: {
    stdin?: string
    runner?: (
      request: unknown,
      observer: AgentRuntimeObserver,
    ) => Promise<AgentRuntimeRunResult>
    completionFetch?: (url: string, init?: RequestInit) => Promise<Response>
  } = {},
) {
  let stdout = ""
  let stderr = ""
  const code = await runHeadlessCliCommand({
    db: db as never,
    argv: ["Locus", HEADLESS_CLI_MARKER, ...argv],
    stdin:
      options.stdin === undefined ? undefined : Readable.from([options.stdin]),
    stdout: {
      write(chunk: string) {
        stdout += chunk
      },
    },
    stderr: {
      write(chunk: string) {
        stderr += chunk
      },
    },
    runner: options.runner as never,
    completionFetch: options.completionFetch as never,
    env: {},
    appVersion: "0.0.test",
  })
  return { code, stdout, stderr }
}

function ledgerRows(sqlite: Database, jobId: string) {
  const job = sqlite
    .query(
      "SELECT status, ledger_version, ledger_provenance_json, ledger_sealed_sequence FROM agent_jobs WHERE id = ?",
    )
    .get(jobId) as Json
  const events = sqlite
    .query(
      "SELECT sequence, type, fact_key, record_metadata_json FROM agent_job_events WHERE job_id = ? ORDER BY sequence",
    )
    .all(jobId) as Json[]
  return { job, events }
}

function expectV1LedgerRows(rows: ReturnType<typeof ledgerRows>) {
  expect(rows.job.ledger_version).toBe(1)
  expect(rows.events.map((event) => event.sequence)).toEqual(
    rows.events.map((_event, index) => index + 1),
  )
  expect(
    rows.events.filter(
      (event) =>
        typeof event.fact_key !== "string" ||
        typeof event.record_metadata_json !== "string",
    ),
  ).toEqual([])
  const completed = rows.events.filter((event) => event.type === "completed")
  expect(completed).toHaveLength(1)
  expect(rows.job.ledger_sealed_sequence).toBe(completed[0].sequence)
}

// ---------------------------------------------------------------------------
// agent-runtime-core / Canonical Run Event Ledger Ownership (migration facet)
// ---------------------------------------------------------------------------

describe("agent-runtime-core / Canonical Run Event Ledger Ownership", () => {
  test("S13 Historical rows remain explicitly unverified — the ledger migration labels every pre-ledger job ledger_version=0 and keeps event bytes/IDs/sequences unchanged without fabricating fact keys, provenance or a missing completed", () => {
    const { input, sqlite } = migrateLegacyStore()
    const jobColumns = tableColumns(sqlite, "agent_jobs")
    const eventColumns = tableColumns(sqlite, "agent_job_events")
    for (const column of input.expected.newAgentJobsColumns) {
      expect(jobColumns.map((entry) => entry.name)).toContain(column)
    }
    for (const column of input.expected.newAgentJobEventsColumns) {
      const found = eventColumns.find((entry) => entry.name === column)
      expect(found?.notnull).toBe(0)
    }
    expect(
      jobColumns.find((entry) => entry.name === "ledger_provenance_json")
        ?.notnull,
    ).toBe(0)

    const jobs = sqlite
      .query(
        "SELECT id, ledger_version, ledger_provenance_json FROM agent_jobs ORDER BY id",
      )
      .all() as Json[]
    expect(jobs).toEqual(
      [...input.jobs]
        .map((job: Json) => ({
          id: job.id,
          ledger_version: input.expected.ledgerVersion,
          ledger_provenance_json: null,
        }))
        .sort((left: Json, right: Json) => left.id.localeCompare(right.id)),
    )

    const events = sqlite
      .query(
        "SELECT id, job_id, sequence, type, payload_json, created_at, fact_key, record_metadata_json FROM agent_job_events ORDER BY id",
      )
      .all() as Json[]
    expect(events).toEqual(
      [...input.events]
        .map((event: Json) => ({
          ...event,
          fact_key: null,
          record_metadata_json: null,
        }))
        .sort((left: Json, right: Json) => left.id.localeCompare(right.id)),
    )
    const incompleteCompleted = events.filter(
      (event) =>
        event.job_id === "job-legacy-incomplete" && event.type === "completed",
    )
    expect(incompleteCompleted).toEqual([])
  })

  test("S13 Historical rows remain explicitly unverified — the migrated store enforces v1 fact-key and single-completed uniqueness, keeps historical duplicate terminal bytes, and adds cascading projection cursors", () => {
    const { input, sqlite } = migrateLegacyStore()
    const legacyCompleted = sqlite
      .query(
        "SELECT id FROM agent_job_events WHERE job_id = 'job-legacy-api' AND type = 'completed' ORDER BY id",
      )
      .all() as Json[]
    expect(legacyCompleted.map((row) => row.id)).toEqual([
      "legacy-a-6",
      "legacy-a-7",
    ])

    insertRow(sqlite, "agent_jobs", {
      id: "job-v1-constraints",
      source: "api",
      runtime: "codex",
      cwd: "/fixture/v1",
      status: "running",
      ledger_version: 1,
    })
    const v1Event = (sequence: number, type: string, factKey: string) => ({
      id: `v1-${sequence}`,
      job_id: "job-v1-constraints",
      sequence,
      type,
      payload_json: "{}",
      fact_key: factKey,
      record_metadata_json: "{}",
    })
    insertRow(sqlite, "agent_job_events", v1Event(1, "job_created", "obs-1:0"))
    expect(() =>
      insertRow(sqlite, "agent_job_events", v1Event(2, "status", "obs-1:0")),
    ).toThrow()
    insertRow(sqlite, "agent_job_events", v1Event(2, "completed", "obs-2:0"))
    expect(() =>
      insertRow(sqlite, "agent_job_events", v1Event(3, "completed", "obs-3:0")),
    ).toThrow()

    const cursorTable = input.expected.cursorTable
    const cursorColumns = tableColumns(sqlite, cursorTable)
    expect(cursorColumns.map((column) => column.name).sort()).toEqual(
      [...input.expected.cursorColumns].sort(),
    )
    expect(
      cursorColumns
        .filter((column) => column.pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map((column) => column.name),
    ).toEqual(["job_id", "projection_name"])
    const foreignKeys = sqlite
      .query(`PRAGMA foreign_key_list(${cursorTable})`)
      .all() as Json[]
    expect(
      foreignKeys.map((key) => ({
        table: key.table,
        from: key.from,
        on_delete: key.on_delete,
      })),
    ).toEqual([{ table: "agent_jobs", from: "job_id", on_delete: "CASCADE" }])
    insertRow(sqlite, cursorTable, {
      job_id: "job-v1-constraints",
      projection_name: "desktop-renderer",
      acknowledged_sequence: 1,
    })
    expect(() =>
      insertRow(sqlite, cursorTable, {
        job_id: "job-v1-constraints",
        projection_name: "desktop-renderer",
        acknowledged_sequence: 2,
      }),
    ).toThrow()
    sqlite.query("DELETE FROM agent_jobs WHERE id = 'job-v1-constraints'").run()
    expect(
      sqlite
        .query(`SELECT count(*) AS count FROM ${cursorTable} WHERE job_id = ?`)
        .get("job-v1-constraints"),
    ).toEqual({ count: 0 })
  })

  test(
    "S13 Historical rows remain explicitly unverified — public job/result/event envelopes of a migrated legacy API job expose no historyQuality or job.ledger field and keep historical payloads and sequences (green-by-design)",
    async () => {
      const { input, db } = migrateLegacyStore()
      const status = await runCli(db as never, [
        "api",
        "runs",
        "status",
        "job-legacy-api",
        "--json",
      ])
      const result = await runCli(db as never, [
        "api",
        "runs",
        "result",
        "job-legacy-api",
        "--json",
      ])
      const events = await runCli(db as never, [
        "api",
        "runs",
        "events",
        "job-legacy-api",
        "--after",
        "0",
        "--jsonl",
      ])
      for (const out of [status, result, events]) {
        expect(out.code).toBe(0)
        expect(out.stdout).not.toContain("historyQuality")
        expect(out.stdout).not.toContain(input.expected.historyQuality)
      }
      expect(Object.hasOwn(JSON.parse(status.stdout).job, "ledger")).toBe(false)
      const envelopes = events.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
      const legacyApi = input.events.filter(
        (event: Json) => event.job_id === "job-legacy-api",
      )
      expect(envelopes.map((envelope) => envelope.sequence)).toEqual(
        legacyApi.map((event: Json) => event.sequence),
      )
      const assistant = envelopes.find(
        (envelope) => envelope.type === "assistant_delta",
      )
      expect(assistant.payload).toEqual(
        JSON.parse(
          legacyApi.find((event: Json) => event.type === "assistant_delta")
            .payload_json,
        ),
      )
    },
    CLI_TEST_TIMEOUT_MS,
  )
})

// ---------------------------------------------------------------------------
// agent-runtime-core / Native Identity And Runtime Provenance (row facet)
// ---------------------------------------------------------------------------

describe("agent-runtime-core / Native Identity And Runtime Provenance", () => {
  test(
    "S15 Exact runtime provenance follows every event — a never-started API run refused at runtime selection is a v1 ledger job with null ledger_provenance_json sealed at its one completed",
    async () => {
      const { db, sqlite } = createMigratedDb()
      const { packageDir } = seedProject(db)
      const refused = caseById(
        "public-v1.json",
        "api-runtime-selection-refused-pre-binding",
      )
      const request = JSON.parse(
        JSON.stringify(refused.request).split("<PROJECT_CWD>").join(packageDir),
      )
      const out = await runCli(
        db,
        ["api", "runs", "create", "--request", "-", "--json"],
        { stdin: JSON.stringify(request) },
      )
      expect(out.code).toBe(refused.expected.exitCode)
      const jobId = JSON.parse(out.stdout).job.id as string
      const rows = ledgerRows(sqlite, jobId)
      expect(rows.job.status).toBe(refused.expected.jobStatus)
      expect(rows.job.ledger_provenance_json).toBeNull()
      expectV1LedgerRows(rows)
    },
    CLI_TEST_TIMEOUT_MS,
  )

  test(
    "S15 Exact runtime provenance follows every event — a queued job canceled before start keeps null ledger_provenance_json and is sealed at its one completed",
    async () => {
      const { db, sqlite } = createMigratedDb()
      const { packageDir } = seedProject(db)
      const queued = await runCli(db, [
        "run",
        "--daemon",
        "--runtime",
        "codex",
        "--cwd",
        packageDir,
        "--output",
        "json",
        "--prompt",
        "Queued then canceled.",
      ])
      expect(queued.code).toBe(0)
      const jobId = JSON.parse(queued.stdout).job.id as string
      const canceled = await runCli(db, [
        "jobs",
        "cancel",
        jobId,
        "--output",
        "json",
      ])
      expect(canceled.code).toBe(0)
      expect(JSON.parse(canceled.stdout).job.status).toBe("canceled")
      const rows = ledgerRows(sqlite, jobId)
      expect(rows.job.status).toBe("canceled")
      expect(rows.job.ledger_provenance_json).toBeNull()
      expectV1LedgerRows(rows)
    },
    CLI_TEST_TIMEOUT_MS,
  )

  test(
    "S15 Exact runtime provenance follows every event — an executed provider-only completion binds a locus-completion provenance tuple that claims no native binary or installation",
    async () => {
      const { db, sqlite } = createMigratedDb()
      db.insert(schema.agentProviderProfiles)
        .values({
          id: "completion-main",
          name: "completion-main",
          protocol: "openai-responses",
          baseUrl: "https://provider.example.com/v1",
          defaultModel: "provider-default-model",
          authMode: "none",
          encryptedToken: null,
          targetRuntimesJson: JSON.stringify(["codex"]),
          capabilitiesJson: "{}",
        })
        .run()
      const out = await runCli(
        db,
        ["api", "runs", "create", "--request", "-", "--json"],
        {
          stdin: JSON.stringify({
            apiVersion: "locus.local-job.v1",
            kind: "completion",
            consumer: {
              id: "provenance-consumer",
              runExternalId: "completion-1",
            },
            runtime: { id: "codex" },
            provider: { profileId: "completion-main", model: "provider-model" },
            messages: [{ role: "user", content: "Return short text." }],
            responseFormat: { type: "text" },
          }),
          completionFetch: async () =>
            new Response(
              JSON.stringify({
                output_text: "done",
                usage: { input_tokens: 7, output_tokens: 3 },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
        },
      )
      expect(out.code).toBe(0)
      const jobId = JSON.parse(out.stdout).job.id as string
      const rows = ledgerRows(sqlite, jobId)
      expect(rows.job.status).toBe("succeeded")
      expectV1LedgerRows(rows)
      const provenance = JSON.parse(rows.job.ledger_provenance_json)
      const storedRuntime = (
        sqlite
          .query("SELECT runtime FROM agent_jobs WHERE id = ?")
          .get(jobId) as Json
      ).runtime
      expect(provenance).toMatchObject({
        kind: "locus-completion",
        runtimeId: storedRuntime,
        adapterSource: "completion",
      })
      expect(typeof provenance.locusBuild).toBe("string")
      expect(typeof provenance.protocolName).toBe("string")
      expect(provenance.schemaSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(Object.hasOwn(provenance, "binarySha256")).toBe(false)
      expect(Object.hasOwn(provenance, "installationId")).toBe(false)
    },
    CLI_TEST_TIMEOUT_MS,
  )
})
