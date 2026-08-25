#!/usr/bin/env node
import { execSync } from "node:child_process"
import { lstatSync, readFileSync } from "node:fs"

// Residue gate for the removed `kun` / `qwen-code` runtimes.
//
// The naive `grep -r kun` gate is impossible to satisfy honestly: legitimate
// regression tests must name the retired ids to prove they are handled, and the
// startup cleanup must name the paths it deletes. During implementation that
// pressure produced three separate evasions — a base64 asset was XML-escaped, a
// protected Ollama comment was reworded, and production literals were built by
// joining split fragments — all so a grep would print zero. This script replaces
// that gate with an explicit allowlist, so "zero" means something.
//
// The matchers deliberately do NOT match a bare `qwen`, `qwen-coder`, or
// `qwen2.5-coder`: those are surviving Ollama model names. They do cover the
// retired runtime id, its camel-case spelling, and its former manifest symbol.
const RETIRED_RUNTIME_PATTERNS = [
  /\bkun\b/i,
  /\bkun-[a-z0-9_-]+\b/i,
  /\bkun[A-Z][A-Za-z0-9_]*\b/,
  /\bKun[A-Z][A-Za-z0-9_]*\b/,
  /\bkun_(?:[a-z0-9]+_?)+\b/i,
  /\bqwen-code\b/i,
  /\bqwenCode\b/i,
  /\b(?:qwenCode|QwenCode)[A-Z][A-Za-z0-9_]*\b/,
  /\bqwen_code(?:_[a-z0-9]+)*\b/i,
]

function containsRetiredRuntime(subject) {
  return RETIRED_RUNTIME_PATTERNS.some((pattern) => pattern.test(subject))
}

function assertPatternContract() {
  const cases = [
    ["kun", true],
    ["src/main/lib/kun/adapter.ts", true],
    ["kun-runtime", true],
    ["KunRuntime", true],
    ["KUN_RUNTIME_MANIFEST", true],
    ["kun_runtime_manifest", true],
    ["qwen-code", true],
    ["Qwen-Code", true],
    ["qwenCode", true],
    ["qwenCodeRuntime", true],
    ["QWEN_CODE_RUNTIME_MANIFEST", true],
    ["qwen-coder", false],
    ["qwen2.5-coder", false],
    ["QwenCoder", false],
    ["src/main/lib/ollama/qwen-coder.ts", false],
    ["skunkworks", false],
  ]

  const failures = cases.filter(
    ([subject, expected]) => containsRetiredRuntime(subject) !== expected,
  )
  if (failures.length > 0) {
    throw new Error(
      `Retired-runtime matcher self-test failed: ${failures
        .map(
          ([subject, expected]) =>
            `${JSON.stringify(subject)} expected ${expected}`,
        )
        .join(", ")}`,
    )
  }
}

assertPatternContract()

// Files that MUST mention a retired id, with the reason. Anything else is residue.
const ALLOWED = new Map([
  [
    "src/main/lib/retired-runtime-state-cleanup.ts",
    "deletes the retired runtimes' leftover userData paths; must name them",
  ],
  [
    "tests/retired-runtime-state-cleanup.test.ts",
    "tests the cleanup above, including its symlink-escape guard",
  ],
  [
    "tests/agent-runtime-registry.test.ts",
    "negative assertions proving the router no longer contains the retired symbols",
  ],
  [
    "tests/agent-chat-provider-routing.test.ts",
    "regression: a legacy/unknown provider string must fall back inside the union",
  ],
  [
    "tests/provider-profile-storage-security.test.ts",
    "regression: a stored kun-only provider profile must load and re-save",
  ],
  [
    "tests/local-job-api.test.ts",
    "asserts the API rejects retired runtime ids",
  ],
  [
    "scripts/check-retired-runtime-residue.mjs",
    "this gate itself: the pattern and the allowlist reasons name the retired ids",
  ],
  [
    "tests/local-job-api-schema.test.ts",
    "asserts the published schema rejects retired runtime ids",
  ],
  [
    "docs/locus-adapt-open-source-direction.zh-CN.md",
    "forward-looking external harness/adaptation research; does not define a live runtime implementation",
  ],
  [
    "docs/locus-architecture-strategy-handoff.zh-CN.md",
    "historical removal record and external harness research; does not define a live runtime path",
  ],
])

const ARCHIVED_CHANGE_PREFIX = "openspec/changes/archive/"
const SKIP_CONTENT_EXT = /\.(svg|png|ico|icns|jpg|jpeg|gif|woff2?|ttf|lockb)$/i

function isScanTarget(file) {
  // The delivery surface is not limited to src/: resources/, packages/,
  // build/, migrations, and future roots can all ship live code or metadata.
  // Scan every tracked or untracked-nonignored path by default. Only immutable
  // OpenSpec history is excluded from the live-residue contract.
  return !file.startsWith(ARCHIVED_CHANGE_PREFIX)
}

function readRepositoryTextFile(file) {
  try {
    // Never follow a tracked or untracked repository symlink while running a
    // source-residue gate. A path hit is still reported separately, but its
    // target may live outside the repository and is not part of this scan.
    if (!lstatSync(file).isFile()) return ""
    return readFileSync(file, "utf8")
  } catch {
    return ""
  }
}

function assertScanScopeContract() {
  const cases = [
    ["package.json", true],
    ["electron-builder.yml", true],
    [".github/workflows/ci.yml", true],
    ["src/main/lib/kun/adapter.ts", true],
    ["resources/cli/kun-adapter.ts", true],
    ["packages/kun-runtime/index.ts", true],
    ["build/kun-runtime.json", true],
    ["drizzle/9999_kun_runtime.sql", true],
    ["openspec/specs/runtime/spec.md", true],
    ["openspec/changes/add-runtime/specs/runtime/spec.md", true],
    [
      "openspec/changes/archive/2026-08-25-add-runtime/specs/runtime/spec.md",
      false,
    ],
    // Ignored files such as node_modules are removed by git ls-files
    // --exclude-standard; if explicitly tracked, they are part of the product
    // surface and must be scanned too.
    ["node_modules/example/package.json", true],
  ]
  const failures = cases.filter(
    ([file, expected]) => isScanTarget(file) !== expected,
  )
  if (failures.length > 0) {
    throw new Error(
      `Retired-runtime scan-scope self-test failed: ${failures
        .map(
          ([file, expected]) => `${JSON.stringify(file)} expected ${expected}`,
        )
        .join(", ")}`,
    )
  }
}

assertScanScopeContract()

if (process.argv.includes("--self-test")) {
  console.log(
    "Retired-runtime self-test passed (matchers, paths, live roots, and archive exclusion).",
  )
  process.exit(0)
}

const tracked = execSync(
  // --others --exclude-standard so NEW, not-yet-added files are scanned too.
  // Without it a brand-new file is invisible to this gate — which is exactly how
  // the untracked startup-cleanup module first slipped past it.
  "git ls-files --cached --others --exclude-standard",
  { encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean)
  .filter(isScanTarget)

const residue = []
for (const file of tracked) {
  const pathHit = containsRetiredRuntime(file)
  let text = ""
  if (!SKIP_CONTENT_EXT.test(file)) {
    text = readRepositoryTextFile(file)
  }
  const hits = text
    .split("\n")
    .map((line, i) => ({ line: i + 1, text: line }))
    .filter((line) => containsRetiredRuntime(line.text))
  if (!pathHit && hits.length === 0) continue
  if (ALLOWED.has(file)) continue
  residue.push({ file, pathHit, hits })
}

const unusedAllowances = [...ALLOWED.keys()].filter(
  (file) =>
    !tracked.includes(file) ||
    (!containsRetiredRuntime(file) &&
      !containsRetiredRuntime(readRepositoryTextFile(file))),
)

if (residue.length > 0) {
  console.error("Retired-runtime residue found:\n")
  for (const { file, pathHit, hits } of residue) {
    if (pathHit)
      console.error(`  ${file}: path contains a retired runtime identifier`)
    for (const h of hits) {
      console.error(`  ${file}:${h.line}: ${h.text.trim().slice(0, 120)}`)
    }
  }
  console.error(
    "\nIf a hit is legitimate, add the file to ALLOWED with a reason —" +
      " do not reword, split, or escape the string to dodge this check.",
  )
  process.exit(1)
}

if (unusedAllowances.length > 0) {
  console.error(
    `Stale allowance entries (no longer contain a retired id): ${unusedAllowances.join(", ")}`,
  )
  process.exit(1)
}

console.log(
  `Retired-runtime residue check passed (${tracked.length} files scanned, ${ALLOWED.size} allowlisted).`,
)
