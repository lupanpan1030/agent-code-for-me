# Design: add-architecture-guard-ratchet

## Context

`scripts/check-architecture-guards.mjs` (1,802 lines, 11 guards, blocking via
`bun run check` and the CI main job) already owns single-owner assertions
(`assertGuardDecisionSingleOwner`, `assertChatMessageModelOwner`), an AST-based
import-boundary scanner with a fail-closed synthetic-fixture self-test
(`assertRuntimeCoreImportBoundary`), and a self-lock (`assertPackageScripts`,
`assertCiRunsArchitectureCheck`). This change adds ratchet-style guards on top of that
machinery rather than introducing a second guard system. It is draft 1c of the Foundation
Stabilization batch and is implemented **after** 1a (route service extraction) and 1b
(dual-path consolidation), so every frozen baseline is generated against the post-1a/1b
tree; the numbers in the proposal are draft-time hints only.

Constraint inherited from the batch: guards + scripts + CI only. Pre-existing boundary
violations are frozen, not fixed.

## Goals / Non-Goals

- Goals: make the event single-path rule, the temporary-owner containment rule, the
  lib→routers direction rule, and W4.3 "touched files get cleaner" machine-enforced;
  eliminate the two orphan guards and self-lock the already-wired residue gate; make every
  ratchet baseline a reviewable, checked-in artifact whose growth is impossible without a
  visible diff.
- Non-Goals: fixing lint debt; clearing frozen violations; transitive import closure;
  capability consent; any product/runtime behavior change; any new spec capability.

## Decisions

- **Decision 1 — one baseline registry file for architecture ratchets.**
  `scripts/architecture-baselines.json` holds four sections (`temporaryOwnerRoutes`,
  `importBoundaryViolations`, `reverseDirectionImports`, `reachThroughWrappers`) and is
  read only by `check-architecture-guards.mjs`. Updates happen only through the guard's
  `--update-architecture-baselines` mode, which refuses to *raise* anything — raises
  require a hand edit, which is Red per the W7 envelope and unmissable in review.
  - Alternative considered: one JSON per guard — rejected, four tiny files invite drift
    and each needs its own self-lock.
  - Alternative considered: baselines inlined in the guard script (like the dangerous-input
    allowlist) — rejected: baselines are data that must be regenerated at implementation
    time and shrink routinely; inline constants make every tighten a code diff in an
    1,800-line file. The dangerous-input allowlist stays inline and untouched.
- **Decision 2 — strict equality ratchet ("tighten or fail"), with a named escape hatch.**
  When the measured value drops below baseline, the guard fails with the exact new value
  to record, so the checked-in baseline always equals reality (no silent slack to grow
  back into). For the route line-count ratchet only, a genuine in-route fix may need to add
  lines: the baseline file supports an explicit `raiseNote` (reason + date) on a route
  entry; the guard prints it and still requires the hand edit (Red). This keeps the ratchet
  honest without making small bugfixes impossible.
  - Alternative considered: tolerance bands (e.g. +2%) — rejected: slack is exactly the
    silent-growth channel this change exists to close.
- **Decision 3 — export-surface as a frozen name set, not a count.** A count of exports
  lets one export be swapped for another invisibly. The baseline stores the exact named
  exports (hint: `claude.ts` → `clearClaudeCaches`, `getAllMcpConfigHandler`,
  `claudeRouter`; `codex.ts` → `getAllCodexMcpConfigHandler`, `hasActiveCodexStreams`,
  `abortAllCodexStreams`, `codexRouter`); any export outside the set fails. Removing an
  export requires tightening the set.
- **Decision 4 — event single-path guard asserts structure, not semantics.** The guard
  enforces (a) single definition sites for the event-pipeline exports, (b)
  `appendAgentJobEvent` exported only from `src/main/lib/headless/job-store.ts` and
  `insertAgentJobEventRecord` not exported at all, (c) a frozen direct-importer allowlist
  for `appendAgentJobEvent` that excludes `trpc/routers/**`, `codex/**`, and `claude/**`.
  Whether a mapped event is *correct* stays with the behavior tests
  (`runtime-stream-event-mapper.test.ts`, `runtime-redaction.test.ts`). A grep-shaped
  "no second mapping" semantic search was rejected as exactly the "broad keyword-only
  failure" the `Architecture Guard Check` requirement forbids.
- **Decision 5 — one-hop wrapper detection, not transitive closure.** For each module `M`
  outside the guarded directories that a guarded file imports, the guard checks whether
  `M` itself directly imports a banned category; if so `M` must be in
  `reachThroughWrappers`. This catches every *new* wrapper at the moment it is created
  (the only way reach-through grows) while keeping the deferred-closure posture that
  OWNERSHIP_MAP documents. The guard additionally asserts the OWNERSHIP_MAP prose list
  and the registry name the same set, so the documented list can no longer drift.
  `db` resolves to `src/main/lib/db/` (directory owner), the rest to single modules.
- **Decision 6 — direction check is repo-wide over `src/main/lib/**` with its own frozen
  baseline.** Known violations at draft time (7 occurrences in 6 files):
  `mcp-auth.ts:25` (`claude-settings`), `claude/agent-sdk-config-dir.ts:79` (dynamic
  `import()` of `claude-settings`), `agent-builder/read-model.ts:4` (type-only
  `FileAgent` from `../trpc/routers/agent-utils`), `agent-builder/claude-native-agents.ts:8-9`
  (`agent-utils`, `getEnabledPlugins` from `claude-settings`),
  `runtime-mcp-config/claude.ts:48` (`claude-settings`), and
  `ollama/network-detector.ts:6` (`isOfflineSimulated` from `routers/debug`). Type-only
  and dynamic imports count — the existing AST machinery already recognizes `import type`
  and `import()`, and a type dependency on a
  router module is still an inverted ownership arrow. Clearing these entries means moving
  the shared helpers out of the router modules, which is product-code refactoring: Yellow
  follow-up (1a may clear the `claude-settings` ones as a side effect of extraction; the
  regenerated baseline will reflect that).
- **Decision 7 — the residue gate stays as wired; only the self-lock is new.**
  `check-retired-runtime-residue.mjs` stays a standalone script (it has its own allowlist
  vocabulary and failure modes documented in its header) and is *already* invoked as
  `retired-runtime:check` inside `package.json`'s blocking `check` chain and as a CI
  main-job step. This change adds no invocation path and no second entry point: it only
  extends the existing self-lock guard (`assertPackageScripts` /
  `assertCiRunsArchitectureCheck`) to assert `retired-runtime:check` remains in `check`
  and CI, mirroring how `architecture:check` locks itself. Folding its logic into the
  guard script would create a second copy of its allowlist semantics.
- **Decision 8 — knip is report-only.** knip lands in the `debt-report` CI job with
  `continue-on-error: true`, matching `lint:all` and `bun audit` there. Its findings are
  untriaged (entry/ignore tuning is expected); making it blocking now would gate the repo
  on an untuned tool. Promotion to blocking is a later Owner decision. `knip` is pinned as
  a devDependency because `knip.json` exists but the tool is currently not installed at
  all — an unpinned `bunx knip` would float versions in CI.
- **Decision 9 — lint baseline is per-file blocking counts, not per-rule.**
  `lint-baseline.json` maps file path → blocking (error + warning) diagnostic count.
  Per-rule granularity was rejected: the ratchet's job is "touched files only get
  cleaner", and a count is stable under Biome rule renames while still preventing
  debt-shuffling above the recorded number. Info-level diagnostics stay excluded,
  matching `run-biome-changed.mjs`'s existing blocking predicate. Files with no entry
  have implicit baseline 0 (all new files are born clean). The three `biome.json`
  whole-file exemptions (`dictionaries.ts`, `icons.tsx`, `canvas-icons.tsx`) are simply
  absent from the baseline. Rename rule: a pure file rename may carry the old path's
  baseline entry over to the new path unchanged (delete old key, add new key, identical
  count) — a mechanical, reviewable baseline edit, NOT the Red "manual baseline increase",
  since the total never grows. Without this rule, "new files are born clean" would force
  every rename (e.g. 1d's `acp-chat-transport.ts` → `codex-app-server-chat-transport.ts`)
  to clear the file's legacy lint debt first.
- **Decision 10 — baselines are generated, never authored.** Both `--update` modes emit
  deterministic, sorted output so diffs are reviewable. Task 1 regenerates everything at
  implementation start; the proposal's draft-time numbers are never copied by hand.

## Risks / Trade-offs

- **Ratchet friction on legitimate edits** (a bugfix inside `codex.ts` adds lines; a
  refactor makes a touched file's count fluctuate) → the tighten-or-fail message names the
  one-line baseline edit; the `raiseNote` hatch exists for routes; W7 marks raises Red so
  friction surfaces to the Owner instead of being absorbed silently.
- **Baseline staleness vs 1a/1b churn** → hard sequencing: baselines are generated after
  1a/1b merge (task 1.2); the guard self-test does not depend on baseline contents.
- **One-hop wrapper detection false positives** (a guarded dir imports a lib module that
  imports `electron` legitimately via its role, e.g. a future wrapper) → that is exactly
  the signal we want: the entry must be consciously added to the registry (Red), which is
  the documented growth protocol.
- **knip noise** → non-blocking by design; triage is a Yellow follow-up.
- **Self-test coverage for new guards** → each new assertion ships synthetic
  pass/fail fixtures in the same fail-closed style as the existing import-boundary
  self-test; a guard that cannot prove it detects its own violation class fails the run.

## Migration Plan

No data migration (no persisted user data, schema, or drizzle changes). Rollout is:
regenerate baselines (post-1a/1b SHA) → land guards red-green proven → wire CI. Rollback
is deleting the new guard functions, the two baseline files, and the CI steps; no state
survives outside the repo.

## Open Questions

- Should the route ratchet also track `codex.ts`'s subscription/procedure count in
  addition to lines + exports? Deferred: lines + export set is sufficient to detect
  accretion; procedure-level tracking can join when 1a defines the extracted service
  surface. (Not blocking; note for the implementer to record, not decide.)
- Exact knip `entry`/`ignore` tuning is expected to need one iteration once the first CI
  report exists — explicitly allowed within Green as long as the step stays
  non-blocking.
