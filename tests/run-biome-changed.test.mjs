import { describe, expect, test } from "bun:test"
import { execFileSync, spawnSync } from "node:child_process"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  BIOME_JSON_MAX_BUFFER_BYTES,
  COMMAND_MAX_BUFFER_BYTES,
  collectChangedLinesFromUnifiedDiff,
  countBlockingDiagnosticsByFile,
  createLintBaselineDocument,
  diagnosticTouchesChangedLines,
  evaluateTouchedFileLintBaseline,
  filterDiagnosticsForChangedLines,
  isBlockingChangedDiagnostic,
  isChangedLineSupportedPath,
  isLintRatchetSupportedPath,
  LINT_BASELINE_POLICY,
  markAllLinesChanged,
  parseGitNameStatusZ,
  parseValidatedBiomeResult,
  planLintBaselineUpdate,
  resolveBiomeExecutable,
  resolveChangedSince,
} from "../scripts/run-biome-changed.mjs"

function writeFakeBiome(repo, diagnostics) {
  const binDir = join(repo, "node_modules", ".bin")
  mkdirSync(binDir, { recursive: true })
  const source = `#!/usr/bin/env node
console.log(${JSON.stringify(
    JSON.stringify({
      diagnostics,
      summary: biomeSummary(diagnostics),
    }),
  )})
process.exit(${diagnostics.length > 0 ? 1 : 0})
`
  const unixPath = join(binDir, "biome")
  writeFileSync(unixPath, source)
  chmodSync(unixPath, 0o755)
  writeFileSync(
    join(binDir, "biome.cmd"),
    `@node "%~dp0\\fake-biome.mjs" %*\r\n`,
  )
  writeFileSync(join(binDir, "fake-biome.mjs"), source)
}

function biomeSummary(diagnostics, overrides = {}) {
  return {
    errors: diagnostics.filter((diagnostic) => diagnostic.severity === "error")
      .length,
    warnings: diagnostics.filter(
      (diagnostic) => diagnostic.severity === "warning",
    ).length,
    infos: diagnostics.filter((diagnostic) => diagnostic.severity === "info")
      .length,
    diagnosticsNotPrinted: 0,
    ...overrides,
  }
}

function runGit(repo, args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim()
}

function baselineDocument(entries) {
  return createLintBaselineDocument(new Map(entries))
}

describe("run-biome-changed helpers", () => {
  test("uses a large buffer for command output", () => {
    expect(COMMAND_MAX_BUFFER_BYTES).toBe(64 * 1024 * 1024)
    expect(BIOME_JSON_MAX_BUFFER_BYTES).toBe(64 * 1024 * 1024)
  })

  test("collects added line numbers from unified diff hunks", () => {
    const changes =
      collectChangedLinesFromUnifiedDiff(`diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,0 +11,2 @@
+const a = 1
+const b = 2
@@ -20,1 +22,1 @@
-const oldValue = 1
+const newValue = 1
`)

    expect([...changes.get("src/a.ts").lines]).toEqual([11, 12, 22])
  })

  test("filters diagnostics to changed lines only", () => {
    const changes =
      collectChangedLinesFromUnifiedDiff(`diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -4,0 +5,1 @@
+const value = 1
`)
    const diagnostics = [
      {
        severity: "error",
        message: "legacy",
        location: { path: "src/a.ts", start: { line: 2, column: 1 } },
      },
      {
        severity: "error",
        message: "changed",
        location: { path: "src/a.ts", start: { line: 5, column: 1 } },
      },
    ]

    expect(filterDiagnosticsForChangedLines(diagnostics, changes)).toEqual([
      diagnostics[1],
    ])
  })

  test("treats untracked files as fully changed", () => {
    const changes = markAllLinesChanged(new Map(), ["src/new.ts"])
    expect(
      diagnosticTouchesChangedLines(
        {
          severity: "error",
          message: "new file diagnostic",
          location: { path: "src/new.ts", start: { line: 99, column: 1 } },
        },
        changes,
      ),
    ).toBe(true)
  })

  test("blocks new warnings and errors but not informational diagnostics", () => {
    expect(isBlockingChangedDiagnostic({ severity: "error" })).toBe(true)
    expect(isBlockingChangedDiagnostic({ severity: "warning" })).toBe(true)
    expect(isBlockingChangedDiagnostic({ severity: "info" })).toBe(false)
  })

  test("full-file ratchet covers HTML and SVG without expanding changed-line scope", () => {
    expect(isLintRatchetSupportedPath("src/index.html")).toBe(true)
    expect(isLintRatchetSupportedPath("src/icon.svg")).toBe(true)
    expect(isChangedLineSupportedPath("src/index.html")).toBe(false)
    expect(isChangedLineSupportedPath("src/icon.svg")).toBe(false)
    expect(isChangedLineSupportedPath("src/app.ts")).toBe(true)
  })

  test("uses the exact closeout base when the CI-specific lint base is absent", () => {
    expect(
      resolveChangedSince({
        BIOME_CHANGED_SINCE: " pr-base ",
        DIFF_BASE_SHA: " closeout-base ",
      }),
    ).toBe("pr-base")
    expect(resolveChangedSince({ DIFF_BASE_SHA: " closeout-base " })).toBe(
      "closeout-base",
    )
    expect(resolveChangedSince({})).toBeUndefined()
  })

  test("ignores file-level diagnostics for legacy lines in modified files", () => {
    const changes =
      collectChangedLinesFromUnifiedDiff(`diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -9,0 +10,1 @@
+const value = 1
`)

    expect(
      diagnosticTouchesChangedLines(
        {
          severity: "error",
          message: "legacy file-level format diagnostic",
          location: { path: "src/a.ts", start: { line: 0, column: 0 } },
        },
        changes,
      ),
    ).toBe(false)
  })

  test("fails closed when the local Biome executable is missing", () => {
    expect(
      resolveBiomeExecutable({
        cwd: "/repo",
        platform: "darwin",
        exists: () => false,
      }),
    ).toEqual({
      ok: false,
      error:
        "Biome executable not found at /repo/node_modules/.bin/biome. Run `bun install` before linting.",
    })
  })

  test("keeps pure renames and deletions in the full-file inventory", () => {
    const inventory = parseGitNameStatusZ(
      "R100\0src/old.ts\0src/new.ts\0D\0src/deleted.ts\0M\0src/kept.ts\0",
    )

    expect([...inventory.paths].sort()).toEqual([
      "src/deleted.ts",
      "src/kept.ts",
      "src/new.ts",
      "src/old.ts",
    ])
    expect([...inventory.renames]).toEqual([["src/old.ts", "src/new.ts"]])
  })

  test("counts only warning and error diagnostics by normalized file", () => {
    const counts = countBlockingDiagnosticsByFile([
      { severity: "error", location: { path: "./src/a.ts" } },
      { severity: "warning", location: { path: "src/a.ts" } },
      { severity: "info", location: { path: "src/a.ts" } },
      { severity: "error", location: { path: "src/b.ts" } },
    ])

    expect([...counts]).toEqual([
      ["src/a.ts", 2],
      ["src/b.ts", 1],
    ])
  })

  test("passes touched files at baseline", () => {
    const result = evaluateTouchedFileLintBaseline({
      touchedFiles: ["src/a.ts"],
      diagnosticCounts: new Map([["src/a.ts", 2]]),
      baselineDocument: createLintBaselineDocument(new Map([["src/a.ts", 2]])),
    })

    expect(result).toEqual({ above: [], below: [] })
  })

  test("fails touched files above baseline and absent entries above zero", () => {
    const result = evaluateTouchedFileLintBaseline({
      touchedFiles: ["src/a.ts", "src/new.ts"],
      diagnosticCounts: new Map([
        ["src/a.ts", 3],
        ["src/new.ts", 1],
      ]),
      baselineDocument: createLintBaselineDocument(new Map([["src/a.ts", 2]])),
    })

    expect(result.above).toEqual([
      { path: "src/a.ts", actual: 3, expected: 2 },
      { path: "src/new.ts", actual: 1, expected: 0 },
    ])
    expect(result.below).toEqual([])
  })

  test("requires tightening when a touched file gets cleaner", () => {
    const result = evaluateTouchedFileLintBaseline({
      touchedFiles: ["src/a.ts"],
      diagnosticCounts: new Map([["src/a.ts", 1]]),
      baselineDocument: createLintBaselineDocument(new Map([["src/a.ts", 2]])),
    })

    expect(result).toEqual({
      above: [],
      below: [{ path: "src/a.ts", actual: 1, expected: 2 }],
    })
  })

  test("serializes update output deterministically and omits zero counts", () => {
    const first = createLintBaselineDocument(
      new Map([
        ["src/z.ts", 0],
        ["src/b.ts", 1],
        ["src/a.ts", 2],
      ]),
    )
    const second = createLintBaselineDocument(
      new Map([
        ["src/a.ts", 2],
        ["src/b.ts", 1],
      ]),
    )

    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(Object.keys(first.files)).toEqual(["src/a.ts", "src/b.ts"])
  })

  test("uses code-point ordering and locks the generated policy header", () => {
    const baseline = createLintBaselineDocument(
      new Map([
        ["src/é.ts", 1],
        ["src/a.ts", 1],
        ["src/_.ts", 1],
        ["src/A.ts", 1],
      ]),
    )

    expect(Object.keys(baseline.files)).toEqual([
      "src/A.ts",
      "src/_.ts",
      "src/a.ts",
      "src/é.ts",
    ])
    expect(baseline.$comment).toBe(LINT_BASELINE_POLICY)
    expect(() =>
      evaluateTouchedFileLintBaseline({
        touchedFiles: [],
        diagnosticCounts: new Map(),
        baselineDocument: { ...baseline, $comment: "weakened" },
      }),
    ).toThrow("canonical generated-only policy")
  })

  test("update mode never raises or adds debt", () => {
    const existingDocument = createLintBaselineDocument(
      new Map([["src/a.ts", 2]]),
    )

    expect(
      planLintBaselineUpdate({
        existingDocument,
        measuredDocument: createLintBaselineDocument(
          new Map([["src/a.ts", 3]]),
        ),
      }).ok,
    ).toBe(false)
    expect(
      planLintBaselineUpdate({
        existingDocument,
        measuredDocument: createLintBaselineDocument(
          new Map([
            ["src/a.ts", 2],
            ["src/new.ts", 1],
          ]),
        ),
      }).ok,
    ).toBe(false)
  })

  test("update mode permits an identical pure-rename carry", () => {
    const plan = planLintBaselineUpdate({
      existingDocument: createLintBaselineDocument(
        new Map([["src/old.ts", 2]]),
      ),
      measuredDocument: createLintBaselineDocument(
        new Map([["src/new.ts", 2]]),
      ),
      renames: new Map([["src/old.ts", "src/new.ts"]]),
    })

    expect(plan.ok).toBe(true)
    expect(plan.document.files).toEqual({ "src/new.ts": 2 })
  })

  test("non-pure renames cannot carry legacy debt", () => {
    const inventory = parseGitNameStatusZ("R099\0src/old.ts\0src/new.ts\0")
    const plan = planLintBaselineUpdate({
      existingDocument: createLintBaselineDocument(
        new Map([["src/old.ts", 2]]),
      ),
      measuredDocument: createLintBaselineDocument(
        new Map([["src/new.ts", 2]]),
      ),
      renames: inventory.renames,
    })

    expect(inventory.renames.size).toBe(0)
    expect(plan.ok).toBe(false)
  })

  test("rejects omitted diagnostics, internal errors, and unexplained exits", () => {
    expect(() =>
      parseValidatedBiomeResult({
        status: 1,
        signal: null,
        stdout: JSON.stringify({
          diagnostics: [],
          summary: biomeSummary([], { diagnosticsNotPrinted: 1 }),
        }),
      }),
    ).toThrow("omitted diagnostics")
    expect(() =>
      parseValidatedBiomeResult({
        status: 1,
        signal: null,
        stdout: JSON.stringify({
          diagnostics: [
            {
              severity: "error",
              category: "internalError/io",
              message: "cannot read file",
              location: { path: "src/a.ts" },
            },
          ],
          summary: biomeSummary([
            {
              severity: "error",
              category: "internalError/io",
              message: "cannot read file",
              location: { path: "src/a.ts" },
            },
          ]),
        }),
      }),
    ).toThrow("internal error")
    expect(() =>
      parseValidatedBiomeResult({
        status: 2,
        signal: null,
        stdout: JSON.stringify({
          diagnostics: [],
          summary: biomeSummary([]),
        }),
      }),
    ).toThrow("without a complete ordinary")
  })

  test("accepts an ordinary nonzero Biome lint result", () => {
    const diagnostics = [
      {
        severity: "warning",
        category: "lint/correctness/noUnusedVariables",
        message: "unused",
        location: { path: "src/a.ts" },
      },
    ]
    const output = parseValidatedBiomeResult({
      status: 1,
      signal: null,
      stdout: JSON.stringify({
        diagnostics,
        summary: biomeSummary(diagnostics),
      }),
    })

    expect(output.diagnostics).toHaveLength(1)
  })

  test("rejects pathless, unexpected-path, and incomplete Biome results", () => {
    const pathless = [
      {
        severity: "error",
        category: "configuration",
        message: "invalid configuration",
      },
    ]
    expect(() =>
      parseValidatedBiomeResult({
        status: 1,
        signal: null,
        stdout: JSON.stringify({
          diagnostics: pathless,
          summary: biomeSummary(pathless),
        }),
      }),
    ).toThrow("without a file path")

    const unexpected = [
      {
        severity: "error",
        category: "configuration",
        message: "invalid configuration",
        location: { path: "biome.json" },
      },
    ]
    expect(() =>
      parseValidatedBiomeResult(
        {
          status: 1,
          signal: null,
          stdout: JSON.stringify({
            diagnostics: unexpected,
            summary: biomeSummary(unexpected),
          }),
        },
        { expectedFiles: ["src/a.ts"] },
      ),
    ).toThrow("unexpected path biome.json")

    expect(() =>
      parseValidatedBiomeResult({
        status: 0,
        signal: null,
        stdout: JSON.stringify({ diagnostics: [], summary: {} }),
      }),
    ).toThrow("summary.errors")
  })

  test("CLI enforces SVG through the full-file ratchet only", () => {
    const repo = mkdtempSync(join(tmpdir(), "locus-lint-svg-ratchet-"))
    const scriptPath = resolve("scripts/run-biome-changed.mjs")
    const svgDiagnostics = (count) =>
      Array.from({ length: count }, (_, index) => ({
        severity: "warning",
        category: "lint/a11y/noSvgWithoutTitle",
        message: `svg-${index}`,
        location: {
          path: "src/icon.svg",
          start: { line: 1, column: 1 },
          end: { line: 1, column: 2 },
        },
      }))

    try {
      runGit(repo, ["init"])
      runGit(repo, ["config", "user.email", "lint-svg@example.invalid"])
      runGit(repo, ["config", "user.name", "Lint SVG Test"])
      mkdirSync(join(repo, "src"), { recursive: true })
      writeFileSync(join(repo, ".gitignore"), "node_modules/\n")
      writeFileSync(join(repo, "src", "icon.svg"), "<svg></svg>\n")
      writeFileSync(
        join(repo, "lint-baseline.json"),
        `${JSON.stringify(baselineDocument([["src/icon.svg", 1]]), null, 2)}\n`,
      )
      runGit(repo, ["add", "."])
      runGit(repo, ["commit", "-m", "svg baseline"])
      writeFileSync(join(repo, "src", "icon.svg"), "<svg> </svg>\n")

      writeFakeBiome(repo, svgDiagnostics(1))
      const atBaseline = spawnSync("node", [scriptPath], {
        cwd: repo,
        encoding: "utf8",
      })
      expect(atBaseline.status).toBe(0)

      writeFakeBiome(repo, svgDiagnostics(2))
      const aboveBaseline = spawnSync("node", [scriptPath], {
        cwd: repo,
        encoding: "utf8",
      })
      expect(aboveBaseline.status).toBe(1)
      expect(aboveBaseline.stderr).toContain(
        "Touched files exceed their full-file lint baseline",
      )
      expect(aboveBaseline.stderr).not.toContain(
        "Biome diagnostics on changed lines",
      )
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  test("CLI carries pure renames, tightens deletions, and blocks dirty untracked files", () => {
    const repo = mkdtempSync(join(tmpdir(), "locus-lint-git-inventory-"))
    const scriptPath = resolve("scripts/run-biome-changed.mjs")
    const diagnosticFor = (path) => ({
      severity: "warning",
      category: "lint/correctness/noUnusedVariables",
      message: `unused-${path}`,
      location: {
        path,
        start: { line: 1, column: 1 },
        end: { line: 1, column: 2 },
      },
    })

    try {
      runGit(repo, ["init"])
      runGit(repo, ["config", "user.email", "lint-git@example.invalid"])
      runGit(repo, ["config", "user.name", "Lint Git Test"])
      mkdirSync(join(repo, "src"), { recursive: true })
      writeFileSync(join(repo, ".gitignore"), "node_modules/\n")
      writeFileSync(join(repo, "src", "old.ts"), "export const old = 1\n")
      writeFileSync(
        join(repo, "lint-baseline.json"),
        `${JSON.stringify(baselineDocument([["src/old.ts", 1]]), null, 2)}\n`,
      )
      runGit(repo, ["add", "."])
      runGit(repo, ["commit", "-m", "inventory baseline"])

      runGit(repo, ["mv", "src/old.ts", "src/new.ts"])
      writeFileSync(
        join(repo, "lint-baseline.json"),
        `${JSON.stringify(baselineDocument([["src/new.ts", 1]]), null, 2)}\n`,
      )
      writeFakeBiome(repo, [diagnosticFor("src/new.ts")])
      const renameCarry = spawnSync("node", [scriptPath], {
        cwd: repo,
        encoding: "utf8",
      })
      expect(renameCarry.status).toBe(0)

      runGit(repo, ["add", "."])
      runGit(repo, ["commit", "-m", "pure rename carry"])
      rmSync(join(repo, "src", "new.ts"))
      writeFileSync(
        join(repo, "lint-baseline.json"),
        `${JSON.stringify(baselineDocument([]), null, 2)}\n`,
      )
      writeFakeBiome(repo, [])
      const deletionTighten = spawnSync("node", [scriptPath], {
        cwd: repo,
        encoding: "utf8",
      })
      expect(deletionTighten.status).toBe(0)

      runGit(repo, ["add", "."])
      runGit(repo, ["commit", "-m", "delete and tighten"])
      writeFileSync(join(repo, "src", "untracked.ts"), "const dirty = 1\n")
      writeFakeBiome(repo, [diagnosticFor("src/untracked.ts")])
      const untrackedDebt = spawnSync("node", [scriptPath], {
        cwd: repo,
        encoding: "utf8",
      })
      expect(untrackedDebt.status).toBe(1)
      expect(untrackedDebt.stderr).toContain("src/untracked.ts")
      expect(untrackedDebt.stderr).toContain("baseline 0")
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  test("CLI rejects working-tree, deleted, and CI-base baseline raises", () => {
    const repo = mkdtempSync(join(tmpdir(), "locus-lint-ratchet-"))
    const scriptPath = resolve("scripts/run-biome-changed.mjs")
    const diagnostic = (count) =>
      Array.from({ length: count }, (_, index) => ({
        severity: "warning",
        category: "lint/correctness/noUnusedVariables",
        message: `unused-${index}`,
        location: {
          path: "src/a.ts",
          start: { line: 1, column: 1 },
          end: { line: 1, column: 2 },
        },
      }))

    try {
      runGit(repo, ["init"])
      runGit(repo, ["config", "user.email", "lint-ratchet@example.invalid"])
      runGit(repo, ["config", "user.name", "Lint Ratchet Test"])
      mkdirSync(join(repo, "src"), { recursive: true })
      writeFileSync(join(repo, ".gitignore"), "node_modules/\n")
      writeFileSync(join(repo, "src", "a.ts"), "export const a = 1\n")
      writeFileSync(
        join(repo, "lint-baseline.json"),
        `${JSON.stringify(baselineDocument([["src/a.ts", 1]]), null, 2)}\n`,
      )
      runGit(repo, ["add", "."])
      runGit(repo, ["commit", "-m", "baseline"])
      const base = runGit(repo, ["rev-parse", "HEAD"])
      writeFakeBiome(repo, diagnostic(2))

      writeFileSync(
        join(repo, "lint-baseline.json"),
        `${JSON.stringify(baselineDocument([["src/a.ts", 2]]), null, 2)}\n`,
      )
      const workingRaise = spawnSync("node", [scriptPath], {
        cwd: repo,
        encoding: "utf8",
      })
      expect(workingRaise.status).toBe(1)
      expect(workingRaise.stderr).toContain("raises debt relative to HEAD")

      const updateRaise = spawnSync(
        "node",
        [scriptPath, "--update-lint-baseline"],
        { cwd: repo, encoding: "utf8" },
      )
      expect(updateRaise.status).toBe(1)
      expect(updateRaise.stderr).toContain("relative to HEAD")

      runGit(repo, ["add", "lint-baseline.json"])
      runGit(repo, ["commit", "-m", "raised baseline"])
      const ciRaise = spawnSync("node", [scriptPath], {
        cwd: repo,
        encoding: "utf8",
        env: { ...process.env, DIFF_BASE_SHA: base },
      })
      expect(ciRaise.status).toBe(1)
      expect(ciRaise.stderr).toContain(`raises debt relative to ${base}`)

      writeFakeBiome(repo, diagnostic(3))
      rmSync(join(repo, "lint-baseline.json"))
      const deletedRebootstrap = spawnSync(
        "node",
        [scriptPath, "--update-lint-baseline"],
        { cwd: repo, encoding: "utf8" },
      )
      expect(deletedRebootstrap.status).toBe(1)
      expect(deletedRebootstrap.stderr).toContain("relative to HEAD")
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})
