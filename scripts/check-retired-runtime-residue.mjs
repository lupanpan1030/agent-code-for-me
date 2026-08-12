#!/usr/bin/env node
import { execSync } from "node:child_process"
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
// The pattern deliberately does NOT match a bare `qwen`: that is an Ollama MODEL
// name (qwen2.5-coder, qwen3-coder) used across many surviving tests. The retired
// runtime id is `qwen-code`.
import { readFileSync } from "node:fs"

const PATTERN = /\bkun\b|kun-|kun[A-Z]|\bKun\b|Kun[A-Z]|KUN_|qwen-code|QwenC/

// Files that MUST mention a retired id, with the reason. Anything else is residue.
const ALLOWED = new Map([
  [
    "src/main/lib/retired-runtime-state-cleanup.ts",
    "deletes the retired runtimes' leftover userData paths; must name them",
  ],
  [
    "src/main/lib/ollama/detector.ts",
    "Ollama MODEL names (qwen-coder / qwen2.5-coder); unrelated to the runtime",
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
])

const SCAN = ["src", "tests", "scripts", "openspec/specs", "docs"]
const SKIP_EXT = /\.(svg|png|ico|icns|jpg|jpeg|gif|woff2?|ttf)$/i

const tracked = execSync(
  // --others --exclude-standard so NEW, not-yet-added files are scanned too.
  // Without it a brand-new file is invisible to this gate — which is exactly how
  // the untracked startup-cleanup module first slipped past it.
  `git ls-files --cached --others --exclude-standard ${SCAN.join(" ")} CLAUDE.md PROJECT-MAP.md`,
  { encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean)
  .filter((f) => !SKIP_EXT.test(f))

const residue = []
for (const file of tracked) {
  let text
  try {
    text = readFileSync(file, "utf8")
  } catch {
    continue
  }
  const hits = text
    .split("\n")
    .map((line, i) => ({ line: i + 1, text: line }))
    .filter((l) => PATTERN.test(l.text))
  if (hits.length === 0) continue
  if (ALLOWED.has(file)) continue
  residue.push({ file, hits })
}

const unusedAllowances = [...ALLOWED.keys()].filter(
  (f) => !tracked.includes(f) || !PATTERN.test(readFileSync(f, "utf8")),
)

if (residue.length > 0) {
  console.error("Retired-runtime residue found:\n")
  for (const { file, hits } of residue) {
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
