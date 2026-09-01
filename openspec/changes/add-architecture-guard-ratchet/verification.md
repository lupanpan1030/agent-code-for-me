# Verification: Ratchet architecture ownership and touched-file debt

## Scope and isolation

- Change: `add-architecture-guard-ratchet` (Foundation 1c; Owner `APPROVED`
  2026-08-26).
- Base: `main@ce916a86a6f2559890e4fc2990b42d9ca49c8b15`.
- Branch: `codex/add-architecture-guard-ratchet`.
- Worktree: `/home/chen/projects/locus-add-architecture-guard-ratchet`.
- Integrator: Codex `/root`; this worktree contains only the 1c guard, script, CI,
  documentation, test, and verification changes.
- Remote operations: not authorized / not performed.
- Scope boundary: no `src/` product-code edits, database/schema changes, public-contract
  changes, runtime behavior changes, or dangerous-router-input allowlist edits are authorized.
  Existing product-code debt is frozen as a baseline; Yellow findings are recorded only.

## W1 sequencing receipt

- Foundation 1a, `refactor-codex-desktop-service-extraction`:
  - reviewed source SHA: `6bf928bf00051ab1e9513b67162280677134d972`;
  - local integration/evidence SHA: `13e3777a0a39724f171eb2e563dae4774d0b0926`;
  - accepted archive closeout on `main`: `0dee7dc0f31b6b9c44516cbce81b1f63243a4a94`.
- Foundation 1b, `add-chat-session-binding`:
  - reviewed source SHA: `1d019f8d4fab38829ad0e3108e9569b260ab9302`;
  - local integration/evidence SHA: `1d4e004b30e573ebf95235fd7baa725780d659e8`;
  - accepted archive closeout and this change's exact base:
    `ce916a86a6f2559890e4fc2990b42d9ca49c8b15`.
- Both predecessors were locally merged, Owner-accepted, archived, and strictly validated
  before this branch/worktree was created. `main` remains at the exact base above while 1c
  is implemented; no other change shares this worktree.

## Post-1a/1b baseline measurements

Measured on the clean base `ce916a86a6f2559890e4fc2990b42d9ca49c8b15`; draft-time
proposal values were not copied into either checked-in baseline:

- Route surface ratchets:
  - `src/main/lib/trpc/routers/claude.ts`: **658 lines** and named exports
    `clearClaudeCaches`, `getAllMcpConfigHandler`, `claudeRouter`. The draft hint was 518
    lines with the same export set: **+140 lines** after the intervening 1b work.
  - `src/main/lib/trpc/routers/codex.ts`: **957 lines** and the sole named export
    `codexRouter`. The draft hint was 1,334 lines and four exports: **-377 lines**, while
    `getAllCodexMcpConfigHandler`, `hasActiveCodexStreams`, and `abortAllCodexStreams` left
    the route during 1a extraction.
- Expanded runtime-core direct-import findings: **7 entries**:
  - `src/main/lib/claude/agent-sdk-file-change-notification.ts` → `electron` (Electron);
  - `src/main/lib/claude/env.ts` → `electron` (Electron);
  - `src/main/lib/claude/raw-logger.ts` → `electron` (Electron);
  - `src/main/lib/claude/agent-sdk-runtime-startup.ts` → `electron` (Electron);
  - `src/main/lib/claude/agent-sdk-config-dir.ts` →
    `../trpc/routers/claude-settings` (tRPC, dynamic import);
  - `src/main/lib/runtime-mcp-config/mcp-command-trust.ts` → `electron` (Electron);
  - `src/main/lib/runtime-mcp-config/claude.ts` →
    `../trpc/routers/claude-settings` (tRPC).
  The draft's highlighted category counts remain four Claude Electron plus one Runtime MCP
  Electron and one Runtime MCP router import; its separately listed Claude dynamic router
  import is also, correctly, an expanded import-boundary finding, giving the exact total 7.
  `codex/`, `runtime-capability-projection/`, and `agent-workbench/` remain clean.
- `src/main/lib/**` → `src/main/lib/trpc/routers/**` reverse direction: **7 occurrences
  across 6 files**, exactly matching the draft hint:
  `agent-builder/claude-native-agents.ts` ×2, `agent-builder/read-model.ts`,
  `claude/agent-sdk-config-dir.ts`, `mcp-auth.ts`, `ollama/network-detector.ts`, and
  `runtime-mcp-config/claude.ts`.
- Direct importers of `appendAgentJobEvent`: **5 files** —
  `src/main/lib/agent-runtime/stream-event-mapper.ts`,
  `src/main/lib/desktop-agent-jobs.ts`,
  `src/main/lib/headless/cli-dispatcher.ts`,
  `src/main/lib/headless/completion-runner.ts`, and
  `src/main/lib/headless/job-runner.ts`. The only export owner is
  `src/main/lib/headless/job-store.ts`; its own calls are not importers.

## Pre-change gate

- The first attempt stopped before linting because the fresh worktree had no `node_modules`
  and therefore no Biome executable. `bun install --frozen-lockfile` populated the exact
  lockfile dependencies and rebuilt Electron native modules, then its postinstall exited
  nonzero only because Electron cannot load this host's missing `libnspr4.so`. This is the
  already tracked TICKET-114 GUI-host limitation; no GUI smoke is claimed.
- After dependencies were present, `bun run check` on a clean worktree at exact base
  `ce916a86a6f2559890e4fc2990b42d9ca49c8b15` exited **0**:
  - changed-file lint: passed (no changed supported files);
  - architecture guard: passed;
  - retired-runtime residue: passed (**1,605 files scanned / 10 allowlisted**);
  - TypeScript: passed;
  - tests: **1,897 passed / 0 failed / 9,230 expectations across 302 files**.

## Scope Delta Ledger

- Green: approved guard/script/test/CI implementation, mechanically generated only-shrink
  baselines, pinned report-only `knip`, and the four named OWNERSHIP_MAP section updates:
  Runtime Core Import Boundary, tRPC Route Boundary, Claude Desktop Chat Runtime, and
  Codex Desktop Chat Runtime. No unrelated OWNERSHIP_MAP edits are authorized.
- Yellow: existing import/reverse-import/lint/knip findings and migration of the 1b inline
  atom allowlist are record-only; they are not implemented in this change.
- Red: any baseline raise or new entry, weakening/deleting an existing guard, changing the
  dangerous-router-input allowlist, product/runtime/schema/public/security behavior, or
  expanding the blocking check composition beyond the approved self-lock is a stop-and-ask.
- Red stop resolved by Owner A (2026-08-27): the route mechanism remains for both files,
  but its schema and documentation use the neutral `routeSurfaceRatchets` name. Claude is
  the temporary-owner ratchet. Codex is an orchestration-boundary no-growth ratchet and is
  never described as a temporary owner; it retires only by explicit Owner decision or in
  the approved structural-decomposition change that absorbs it (for example Job Kernel).
- Red stop resolved by Owner A (2026-08-27): the first `reachThroughWrappers` freeze is
  explicitly authorized at 12 entries — the approved nine plus `chat-attachments`
  (Electron), `mcp-auth` (Electron + router), and `skills/registry` (Electron). This is a
  one-time bootstrap exception; after the freeze the registry may only shrink. Product-code
  cleanup is not part of 1c and is registered separately as Yellow TICKET-119, TICKET-120,
  and TICKET-121.
- The Owner amendment was applied to `proposal.md`, `design.md`, `tasks.md`, and the
  `architecture-ownership` delta before implementation resumed.
  `openspec validate add-architecture-guard-ratchet --strict --no-interactive` then exited
  **0**. The three Yellow tickets and their `docs/tickets/README.md` index entries exist;
  none authorizes or performs the product-code cleanup.
- Outstanding Red: none.

## Exact-source verification

- Frozen implementation source SHA:
  `74a2a93a54549ed48cee897a11e4860f73c69a0d`.
- The worktree was clean before and after the exact-source gate. Local `main` remained at
  `ce916a86a6f2559890e4fc2990b42d9ca49c8b15`.
- `bun run check:full` at the frozen source SHA: **exit 0**.
  - committed-tree lint: passed (no changed supported files);
  - architecture guard: passed;
  - retired-runtime residue: passed (**1,611 files scanned / 10 allowlisted**);
  - TypeScript: passed;
  - tests: **1,916 passed / 0 failed / 9,291 expectations across 302 files**;
  - OpenSpec all/strict: **55 passed / 0 failed**;
  - Electron/Vite main, preload, and renderer production builds: passed;
  - patch whitespace check: passed.
- Codex verdict: **`IMPLEMENTATION_VERIFIED`** for
  `74a2a93a54549ed48cee897a11e4860f73c69a0d`. The Owner-amended Codex/Claude route
  meanings, exact 12-entry first wrapper freeze, only-shrink architecture and lint
  baselines, event-owner guard, residue/CI self-lock, and three Yellow contraction tickets
  are implemented and verified. No product-code cleanup or existing-debt repair was folded
  into 1c. This verdict is exact-source only; any later source change invalidates it.
- Fresh-context Claude `REVIEW_APPROVED`: pending for the exact source SHA above.
- Owner acceptance: pending after both technical verdicts exist.

## Incremental implementation receipts

- Existing residue wiring confirmed unchanged before self-lock implementation:
  `retired-runtime:check = node scripts/check-retired-runtime-residue.mjs`, present in the
  blocking `check` chain and as the CI main-job step. No second entry point was added.
- The mechanically generated architecture baseline contains **2 route ratchets**, **7
  direct-import findings**, **7 reverse-direction findings**, and the Owner-authorized
  **12-entry** first-freeze wrapper registry. Its current SHA-256 is
  `8bb835c06ddc60f36086fed60d2ba7002312ff4285d7a07a750cb227df399642`.
  The neutral registry schema records the two distinct meanings: Claude remains
  temporary-owner containment; Codex is orchestration-boundary no-growth containment.
  The updater is deterministic, refuses a raise or addition relative to the committed
  baseline, and refuses first-freeze bootstrap while any tracked or untracked `src/`
  change exists.
- The architecture guard now enforces the canonical runtime-event definition/export
  owners, the sole public raw writer and exact five-importer allowlist, the private insert
  helper, both route surfaces, expanded direct-import boundaries, the repo-wide
  lib-to-router reverse boundary, exact one-hop wrapper/doc registry synchronization, and
  package/CI self-locks. Top-level direct identifier aliases, import aliases, namespace
  access, dynamic imports, import-equals, `require`, `module.require`, and `createRequire`
  paths are included where applicable; the wrapper check remains intentionally one-hop.
- The mechanically generated lint baseline contains **2,450 blocking diagnostics across
  662 files** (errors and warnings only; info excluded). Its current SHA-256 is
  `c4581d67bb3d5a312fe46dcbdc98784dd79b7f6935b0b2a3c3a7b5a473781c87`.
  The full-file ratchet includes all supported baseline extensions, including HTML and
  SVG, while the pre-existing changed-line extension scope remains unchanged. A touched
  file may stay equal or shrink; shrinkage demands a checked-in baseline tightening;
  only a Git `R100` pure rename may carry an identical count. The Biome adapter fails
  closed on incomplete summaries, omitted diagnostics, internal errors, pathless blocking
  diagnostics, unexpected target paths, and unexplained exits.
- Pinned report-only dependency: `knip@6.32.3` with package script `debt:knip = knip` and
  a `continue-on-error: true` step only in the existing `debt-report` CI job. `bun.lock`
  was regenerated mechanically; legacy `bun.lockb` was not touched.
- First pinned `bun run debt:knip` report: **exit 0**, no included unused-file/dependency/
  unlisted/unresolved findings, and **10 configuration hints**. The hints were recorded but
  not tuned or acted on (Yellow).
- `bun run runtime-control:smoke:evidence`: **exit 0** against the existing historical
  four-scenario evidence; this does not claim a new desktop smoke or revive the retired
  temporary Codex ACP path.
- `bun test --isolate tests/proof-evidence-gates.test.ts`: **7 passed / 0 failed / 43
  expectations**. The test now spawns the existing runtime-control gate and locks its real
  evidence/task-state markers; no checker copy or invented runbook/secret-scan claim was
  added.
- `bun test --isolate tests/run-biome-changed.test.mjs`: **25 passed / 0 failed / 60
  expectations**. Besides helper cases, CLI integration covers SVG full-file-only
  enforcement, pure-rename carry, deletion tightening, dirty untracked files, and
  working-tree/deleted/CI-base attempts to raise the baseline.
- Combined targeted receipt after final guard hardening:
  `bun test --isolate tests/proof-evidence-gates.test.ts
  tests/run-biome-changed.test.mjs`: **32 passed / 0 failed / 103 expectations**.

## Negative guard receipts

Each mutation below was introduced locally against the implementation tree, observed red,
and reverted without committing. A clean rerun of `bun run architecture:check`, `bun run
lint`, and `git diff --check` then passed.

- Second `createRunEvent` definition/export: failed with both a duplicate definition owner
  and duplicate public export owner naming the synthetic file and canonical owner.
- One added line in `src/main/lib/trpc/routers/codex.ts`: failed with
  `codex.ts orchestration-boundary no-growth containment grew to 958 lines (baseline 957)`
  and printed the Owner/structural-decomposition retirement rule.
- New `electron` import in `src/main/lib/codex/`: failed as an unbaselined Runtime Core
  Import Boundary finding.
- New lib-to-router import: failed as an unbaselined reverse-direction finding for
  `src/main/lib/__negative-router-import.ts` → `./trpc/routers/debug`.
- New shared Electron wrapper plus consumer: failed because
  `src/main/lib/codex/__negative-wrapper-consumer.ts` reached banned ownership through the
  unregistered one-hop wrapper `src/shared/__negative-wrapper`.
- One blocking lint diagnostic added to a zero-baseline touched file: failed with
  `tests/run-biome-changed.test.mjs: 1 blocking diagnostics (baseline 0)`.
- `retired-runtime:check` removed from the package `check` composition: failed with
  `package.json scripts.check must include bun run retired-runtime:check`.

Three independent implementation-slice reviews were used to harden the work before source
freeze: architecture guards, lint ratchet/fail-closed behavior, and scope/OpenSpec evidence.
All reported P2 items were remediated and their reviewers found no remaining P0/P1/P2 in
their assigned slices. These are implementation aids only and are **not** the repository's
required fresh-context Claude `REVIEW_APPROVED` verdict, which remains pending exact-SHA
freeze.

## Pre-freeze working-tree gate

- Final updater replay was deterministic. Before/after SHA-256 remained
  `8bb835c06ddc60f36086fed60d2ba7002312ff4285d7a07a750cb227df399642`
  for `scripts/architecture-baselines.json` and
  `c4581d67bb3d5a312fe46dcbdc98784dd79b7f6935b0b2a3c3a7b5a473781c87`
  for `lint-baseline.json`; the updater reported **2,450 blocking diagnostics / 662
  files**. Both generated files are committed without hand editing.
- `bun run architecture:check`, `bun run lint`, and `git diff --check`: exit **0**.
- `bun run check`: exit **0**:
  - lint and architecture checks passed;
  - retired-runtime residue passed (**1,611 files scanned / 10 allowlisted**);
  - TypeScript passed;
  - tests: **1,916 passed / 0 failed / 9,291 expectations across 302 files**.
- Local equivalents of both CI jobs passed without a remote run: the blocking main-job
  composition above plus `bun run debt:knip` (exit **0**, 10 report-only configuration
  hints). The architecture self-lock parses `.github/workflows/ci.yml` and confirms the
  architecture/residue steps remain unconditional and blocking. Creating a remote branch
  or CI run is outside the no-push authority boundary.
- OpenSpec via the repository-pinned `./node_modules/.bin/openspec`:
  - targeted change validation: valid;
  - `--changes`: **3 passed / 0 failed**;
  - `--specs`: **52 passed / 0 failed**.
- Scope audit: `git status --short -- src drizzle` and `git diff --name-only -- src
  drizzle` were empty; no product or schema file changed. `main` and branch base both
  remained `ce916a86a6f2559890e4fc2990b42d9ca49c8b15`. The extracted
  `DANGEROUS_ROUTER_INPUT_ALLOWLIST` section was byte-identical to `HEAD` (both SHA-256
  `0a7523f9b53c48405a162c0cd01c4a01ca6feed27ea07e7aa0c0f1002e539cdd`).

## Independent review and Owner acceptance

Codex `IMPLEMENTATION_VERIFIED` is recorded for the frozen source SHA. Fresh-context Claude
`REVIEW_APPROVED` and later Owner acceptance remain pending. No merge, archive, push, remote
PR mutation, remote merge, release, or other remote operation is authorized at this stage.

## Independent review — fresh-context Claude Code (2026-08-27)

- Source SHA under review: `74a2a93a54549ed48cee897a11e4860f73c69a0d` (worktree at review time: `2d0cee79`, docs-only evidence commit on top — verified by the reviewers via `git diff --stat`).
- Review mode: two read-only fresh-context reviewers (proposal-compliance + ratchet-soundness/evasion) dispatched by the Claude Code coordination session (633a3e4a); implementation context not reused; no files edited during review; worktree confirmed clean after all guard-script and self-test runs (each reviewer independently ran `bun run architecture:check`, reproduced multiple red failures by mutating baselines in place, and restored byte-identically).
- Owner mid-flight ruling A (2026-08-27) verified as implemented: A1 codex.ts ratchet reworded to "orchestration boundary no-growth" with no temporary-owner claim (claude.ts keeps temporary-owner framing); A2 retirement condition rewritten to explicit Owner decision or structural decomposition; A3 reach-through wrapper registry first-freeze is exactly 12 entries (9 original + chat-attachments/mcp-auth/skills-registry); A4 three Yellow cleanup tickets (TICKET-119/120/121) recorded and not implemented.
- Combined verdict: **`REVIEW_APPROVED`** for `74a2a93a54549ed48cee897a11e4860f73c69a0d` — zero P0/P1 findings across both lenses. Non-blocking: one P2 (route-surface ratchet does not yet watch brand-new sibling router files) and two P3 (documented two-hop wrapper limitation; biome.json rule-downgrade not cross-checked against the lint baseline), recorded for follow-up triage.
- Technical verdict for this exact SHA only; it does not constitute Owner product acceptance and does not authorize any remote operation. Any subsequent code change to the source invalidates it.

### Proposal-compliance review

- Verdict: **`REVIEW_APPROVED`** for `74a2a93a54549ed48cee897a11e4860f73c69a0d`.
- Findings: none.

#### Reviewer summary

Fresh-context review of Foundation 1c (add-architecture-guard-ratchet) at source SHA 74a2a93a54549ed48cee897a11e4860f73c69a0d, verified in the dedicated worktree at HEAD 2d0cee79 (confirmed to be exactly 74a2a93a plus one docs-only tasks.md/verification.md commit via `git diff 74a2a93a 2d0cee79 --stat`).\n\nScope invariant verified: `git diff --stat ce916a86..74a2a93a -- src drizzle` is empty. This is guards/scripts/CI/docs only, no product code, schema, or migration changes. bun.lock diff is fully explained by the new `knip@6.32.3` devDependency.\n\nA1/A2 (route-surface ratchet reword) — VERIFIED. `ROUTE_SURFACE_TARGETS` in scripts/check-architecture-guards.mjs (lines 912-925) defines claude.ts with governance \"temporary-owner containment\" (unchanged framing) and codex.ts with governance \"orchestration-boundary no-growth containment\" and a rewritten retirement clause: \"retire only by explicit Owner decision or in the same approved structural-decomposition change (for example Job Kernel)\" — no temporary-owner claim remains for codex.ts. `architecture-baselines.json._meta.routeSemantics` and the OWNERSHIP_MAP.md diff (Codex Desktop Chat Runtime and tRPC Route Boundary sections) mirror this exactly. Below-baseline correctly fails with a \"tighten\" message (routeSurfaceMessages, lines 951-955); above-baseline fails with the retirement note. Confirmed live: temporarily lowering claude.ts's baseline line count triggered the expected \"grew to 658 lines (baseline 1)... a baseline raise is Red\" failure, then restored cleanly.\n\nA3 (12-entry wrapper freeze) — VERIFIED. `OWNER_AUTHORIZED_INITIAL_REACH_THROUGH_WRAPPERS` (lines 1094-1107) and `architecture-baselines.json.reachThroughWrappers` both contain exactly 12 entries: the original 9 (electron-app, db, secure-storage, provider-token, local-only, claude-credentials, codex/cli-path, codex/runtime-status, utility-chat-completion) plus the 3 newly authorized (chat-attachments, mcp-auth, skills/registry). The guard hard-fails if the first freeze doesn't equal this exact list (line ~1879), and the OWNERSHIP_MAP.md wrapper mirror block matches via set-comparison (order-agnostic, confirmed via `sameStringSet`). Confirmed live: removing `mcp-auth` from the baseline registry triggered both an OWNERSHIP_MAP mirror mismatch and an \"unregistered one-hop wrapper mcp-auth\" failure at the real one-hop import site (src/main/lib/claude/agent-sdk-runtime-query.ts), then restored cleanly.\n\nA4 (Yellow follow-up tickets) — VERIFIED. docs/tickets/TICKET-119 (chat-attachments), TICKET-120 (mcp-auth), TICKET-121 (skills/registry) each name their tracked contraction file, are explicitly marked \"待设计 / 未授权实施\" (design pending, not authorized for implementation) dated 2026-08-27, and none is implemented in this change (their target files retain direct Electron/router imports, correctly frozen in the baseline).\n\nItem 1 (canonical event single-path guard) — VERIFIED. `RUNTIME_EVENT_SYMBOL_OWNERS` (lines 2845-2874) covers exactly the 10 named exports from the proposal, correctly attributed to runtime-events.ts, stream-event-mapper.ts, job-event-bridge.ts, and redaction.ts. `APPEND_AGENT_JOB_EVENT_IMPORTERS` (lines 2876-2882) is the exact frozen 5-file allowlist from the proposal. `assertRuntimeEventSinglePath` (lines 3197-3325) enforces single-definition, single-export-site, module-private insert helper, and explicitly bans direct `appendAgentJobEvent` imports from trpc/routers/**, codex/**, and claude/** even if they were (hypothetically) in the importer allowlist. A synthetic self-test (`assertRuntimeEventSinglePathSelfTest`) runs first and covers multiple import syntaxes (namespace, dynamic import, require, createRequire, aliasing).\n\nItem 3 (import-boundary expansion + wrapper registry) — VERIFIED. `RUNTIME_CORE_DIRECTORIES` (lines 189-200) adds exactly the 5 specified directories. `importBoundaryViolations` (7 entries) and `reverseDirectionImports` (7 entries across 6 files) in architecture-baselines.json match the proposal's measured counts (differences from the proposal's draft-time hints are explained in verification.md as expected post-1a/1b drift, not implementation error). Confirmed live: removing a frozen import-boundary entry (claude/env.ts) triggered an \"unbaselined finding\" failure since the underlying electron import is still present.\n\nItem 4 (orphan guard wiring + self-lock) — VERIFIED. `assertPackageScripts`/`assertCiRunsArchitectureCheck` (lines 2644-2746) require `retired-runtime:check` to remain both in the package `check` chain and as an unconditional, non-continue-on-error step in the CI main job, with no second entry point created. `knip` is a pinned devDependency (6.32.3) with `debt:knip` script wired into a `continue-on-error: true` CI step (same posture as lint:all/bun audit), correctly excluded from the blocking `check`/`check:full` chains. `tests/proof-evidence-gates.test.ts` now wires `check-runtime-control-smoke-evidence.mjs` identically to its two siblings with equivalent anti-tamper source-marker assertions.\n\nItem 5 (lint ratchet) — VERIFIED. lint-baseline.json (667 lines, per-file blocking counts, errors+warnings only) with tighten-on-shrink and reject-on-raise semantics (`planLintBaselineUpdate`, lines 317-365), a pure-rename carry-over rule requiring an unchanged count, and explicit exclusion of the ~1,080 auto-fixable diagnostics from this change (documented as out of scope).\n\nSelf-tests / negative proof (item 7) — VERIFIED. `assertArchitectureRatchetSelfTests` (lines 1515+) exercises synthetic fixtures for route-surface exact/above/below/export cases, frozen-finding-set growth rejection, reverse-direction detection, one-hop wrapper detection (including repository-local wrappers outside src/main/lib), wrapper-doc-mirror mismatch detection, and CI self-lock parsing (conditional/continue-on-error/wrong-job edge cases). I independently ran `bun run architecture:check` clean, then reproduced four independent red failures (route-surface growth, wrapper-registry removal producing an unregistered one-hop finding, import-boundary baseline shrink without the underlying fix) by mutating architecture-baselines.json in place, confirmed each failed as expected, and restored the file (byte-identical via diff, SHA-256 matches verification.md's recorded hash `8bb835c0...`). `bun test tests/run-biome-changed.test.mjs` (25/25 pass) and `bun test tests/proof-evidence-gates.test.ts` (7/7 pass) both green. `openspec validate add-architecture-guard-ratchet --strict --no-interactive` valid. Worktree confirmed clean (`git status --porcelain` empty) after all experiments.\n\nNo P0-P3 findings. The implementation is a precise, disciplined match to the revised proposal and the Owner's A1-A4 decision, with strong fail-closed self-test coverage and clean scope isolation from src/drizzle.

### Ratchet-soundness / evasion review

- Verdict: **`REVIEW_APPROVED`** for `74a2a93a54549ed48cee897a11e4860f73c69a0d`.
- Findings (non-blocking):
  - [P2] `scripts/check-architecture-guards.mjs` — Route-surface ratchet has zero coverage for a brand-new sibling router file. ROUTE_SURFACE_TARGETS only tracks src/main/lib/trpc/routers/claude.ts and codex.ts by exact filename (line count + named-export set). Empirically verified: creating a new file src/main/lib/trpc/routers/__new_router__.ts with unbounded new business logic and running `node scripts/check-architecture-guards.mjs` passes cleanly (exit 0, no findings) as long as claude.ts/codex.ts themselves are untouched. Since the import-boundary and reverse-direction checks only watch src/main/lib/** (not src/main/lib/trpc/routers/** growth itself), a new router file that is wired into the app only via the root router composition (not via an import/line-count change inside claude.ts or codex.ts) fully evades every growth ratchet in this change. This is consistent with the OWNER-approved narrow two-file scope (docs/OWNERSHIP_MAP.md "tRPC Route Boundary" documents route governance as applying only to the two named files) and is not a regression introduced by 1c, but it is a real, silent (to the automated guard) evasion path worth Owner awareness — the containment story only holds for the two frozen files, not for `src/main/lib/trpc/routers/` as a whole.
  - [P3] `scripts/check-architecture-guards.mjs` — Two-hop reach-through wrapper chains are undetected (documented, not a silent hole). Empirically verified: a guarded file (src/main/lib/agent-runtime/*) importing local wrapper A, which imports local module B, which directly imports `electron`, passes the guard with exit 0 (no finding) even though A and B are new, unregistered files. reachThroughFindingForResolvedModule only inspects the immediately resolved one-hop module's own import list (collectRuntimeCoreImportBoundaryFindings on that single file), never following a second hop. This is explicitly documented as a deferred non-goal in openspec/changes/add-architecture-guard-ratchet/design.md ("Decision 5 — one-hop wrapper detection, not transitive closure"), proposal.md, and docs/OWNERSHIP_MAP.md line ~424-428 ("Full transitive closure remains deferred by design"), matching the ground rules' expectation that this deferral be acknowledged rather than silent. Recorded for completeness per the review lens; not a defect in 1c.
  - [P3] `scripts/run-biome-changed.mjs` — Lint-baseline shrink via biome.json rule downgrade is not cross-checked. lint-baseline.json blocking counts are derived from Biome's own error/warning severities (isBlockingChangedDiagnostic). If biome.json is edited to downgrade a rule from error/warning to off/info, the measured diagnostic count legitimately shrinks and would pass through `assertOnlyShrinkFromAuthoritativeBaseline` and a subsequent `--update-lint-baseline` run without any special flag, since a shrink is always accepted. This is inherent to any severity-based ratchet and is mitigated by the fact that a biome.json edit is itself a visible diff line in the same PR (matching the design's stated "visible diff" review bar), so it is not a silent bypass at the PR-review level, but the guard scripts themselves have no cross-check tying baseline shrink to unchanged biome.json rule config.

#### Reviewer summary

Verified against the exact worktree state at HEAD 2d0cee79 (74a2a93a + one docs-only evidence commit touching only tasks.md/verification.md; confirmed via `git diff --stat` that only those two files changed between the two commits). Confirmed the full implementation diff ce916a86..74a2a93a touches only guards/scripts/CI/docs/tests — zero changes under src/ or drizzle/ (`git diff --stat -- src drizzle` empty, and a broader `.ts`/`.tsx` scan outside scripts/tests turned up only the new tests/proof-evidence-gates.test.ts).

Owner-ruling invariants A1–A4 all verified directly in the diff and by grep across the full repo:
- A1: codex.ts ratchet is redefined as \"orchestration-boundary no-growth containment\" (ROUTE_SURFACE_TARGETS in scripts/check-architecture-guards.mjs, mirrored in docs/OWNERSHIP_MAP.md and proposal.md); grepped the whole diff for any residual \"codex.ts ... temporary owner\" claim and found none — proposal.md explicitly states codex.ts is \"not a temporary-owner\" ratchet. claude.ts retains its original temporary-owner wording unchanged.
- A2: codex.ts retirement condition reads \"retire only by explicit Owner decision or in the same approved structural-decomposition change (for example Job Kernel)\" in both the guard script and design.md — matches the required rewrite exactly.
- A3: scripts/architecture-baselines.json reachThroughWrappers has exactly 12 entries = the original 9 plus chat-attachments, mcp-auth, skills/registry; _meta.reachThroughWrapperBootstrap records the 2026-08-27 freeze date and only-shrink-after-freeze rule; docs/OWNERSHIP_MAP.md's guard-asserted mirror block matches exactly (verified byte-for-byte enumeration).
- A4: TICKET-119 (chat-attachments), TICKET-120 (mcp-auth), TICKET-121 (skills/registry) all exist under docs/tickets/, each explicitly marked Yellow/未授权实施 (2026-08-27), each names its tracked contraction file, and each states 1c does not edit the underlying product code.

Ran the guard scripts live in the worktree (read-only except for throwaway probe files, all removed and confirmed via `git status --porcelain` clean afterward): `node scripts/check-architecture-guards.mjs` passes cleanly on the unmodified tree. Empirically probed and confirmed guard soundness for: (1) a new direct Electron import in a guarded directory — caught; (2) a new one-hop wrapper reaching Electron — caught with an exact \"unregistered one-hop wrapper\" message; (3) a two-hop wrapper chain (guarded file → wrapper A → wrapper B → electron) — NOT caught, confirming the documented one-hop-only deferral is real but is explicitly acknowledged in design.md/proposal.md/OWNERSHIP_MAP.md, not silent; (4) a brand-new sibling file under src/main/lib/trpc/routers/ with unbounded new logic that never touches claude.ts/codex.ts — NOT caught by any ratchet, since route-surface ratchets are scoped to exactly those two named files; (5) self-lock: adding `continue-on-error: true` to the Architecture guards CI step is caught immediately by assertCiRunsArchitectureCheck's exact-match, no-continue-on-error, no-if requirement. Ran `bun test tests/proof-evidence-gates.test.ts tests/run-biome-changed.test.mjs` — 32/32 pass. Confirmed the lint ratchet's below-baseline (shrink) and above-baseline (raise) cases both force a hard failure (no silent drift in either direction), that route-surface baseline comparisons are exact-equal (not ≤) forcing tighten-on-shrink, and that the CI-side authoritative-baseline comparison for the lint ratchet is pinned to the real GitHub PR base SHA (github.event.pull_request.base.sha), not an attacker-controllable value.

Findings above are P2/P3 only — real, empirically-confirmed evasion paths, but each is either an explicitly documented non-goal (two-hop wrapper closure) or a narrow, Owner-approved scope limitation (route-surface ratchet covers only two named files) rather than a defect introduced by 1c. No P0/P1 issues found; all four Owner-ruling invariants (A1–A4) verified as implemented exactly as specified.

## Superseding review record — fresh-context Claude Code (2026-09-02, coordination session f227cc27)

- The `REVIEW_APPROVED` entry above (commit `2bc77adb`, dispatched from the prior coordination
  session 633a3e4a) is **SUPERSEDED** for source SHA
  `74a2a93a54549ed48cee897a11e4860f73c69a0d`.
- A concurrently dispatched second dual fresh-context review (correctness + security lenses)
  returned **`CHANGES_REQUESTED` / `CHANGES_REQUESTED`** with two P1 findings. The coordinating
  session then reproduced both P1s by hand in this worktree (all probe mutations reverted;
  `git status --porcelain` clean and the guard re-run green afterwards):
  - **P1-1 — violates Owner ruling R2 ("after the first freeze the registry may only shrink")**:
    adding a 13th entry to `scripts/architecture-baselines.json#reachThroughWrappers` together
    with the matching `docs/OWNERSHIP_MAP.md` mirror line passes
    `node scripts/check-architecture-guards.mjs` with exit 0. The shrink-only comparison
    (`architectureBaselineRaiseMessages`) runs only in the opt-in
    `--update-architecture-baselines` mode; the blocking path has no committed-baseline diff and
    no stale-entry check for this section (unlike the symmetric `importBoundaryViolations` /
    `reverseDirectionImports` frozen-set checks). The superseded record's claim that registry
    growth hard-fails is falsified by this repro.
  - **P1-2 — fail-open**: truncating `scripts/architecture-baselines.json` to an empty file makes
    `parseArchitectureBaselines()` return null without `fail()`, and the caller
    (`if (architectureBaselines) { ... }`) silently skips all four ratchet assertions — the guard
    prints `Architecture guard passed.` with the route ratchets, import-boundary freeze,
    reverse-direction freeze, and wrapper registry all inactive.
- Non-blocking findings carried forward: P2 route-surface ratchet does not cover brand-new
  sibling router files (found independently by BOTH review rounds — recommend a Yellow follow-up
  widening coverage to `src/main/lib/trpc/routers/`); P2 direct `agentJobEvents` table-write
  bypass of the event single-path guard (disclosed Decision-4 non-goal); P3 non-literal import
  specifiers undetected (inherited AST-infra limitation); P3 biome rule-downgrade legitimately
  shrinks the lint baseline (disclosed).
- **Verdict of record for `74a2a93a54549ed48cee897a11e4860f73c69a0d`: `CHANGES_REQUESTED`.**
  Required before re-freeze:
  1. `parseArchitectureBaselines()` fails closed on empty/whitespace/invalid baseline content
     (or the four asserts fail loudly on a null baseline).
  2. `assertReachThroughWrapperRegistry()` gains the symmetric stale-entry check — a registry
     entry with no matching live one-hop finding fails the blocking gate — mirroring
     `frozenFindingSetMessages`.
  3. Shrink-only enforcement for the architecture baselines is wired into the normal blocking
     check path (committed-baseline comparison or equivalent), not only the opt-in update mode.
  4. Negative self-test fixtures plus verification.md receipts covering both repro scenarios
     (registry padding with doc mirror; empty baseline file).
- A new frozen source SHA is required after the fixes; the follow-up review will target the
  delta plus a full guard re-run. Owner acceptance must not proceed on the superseded record.
  No merge, archive, push, remote PR mutation, remote merge, release, or other remote operation
  is authorized.

## P1 remediation and re-freeze preparation (2026-09-02)

This section records the repair and pre-freeze negative evidence. The exact replacement source
SHA, `bun run check:full`, and Codex verdict are recorded only after the repair tree is committed;
the historical `74a2a93a` verdict remains `CHANGES_REQUESTED`, and `2bc77adb` remains superseded.

### Repair

- `parseArchitectureBaselines()` now routes empty and whitespace-only content through the
  required parser, which records a blocking failure before returning `null`. Malformed JSON and
  invalid canonical shape also remain blocking. A null parse result can no longer produce a
  successful guard run.
- The normal (non-`--update`) path runs the same
  `architectureBaselineRaiseMessages()` only-shrink comparison against committed `HEAD`, the
  previous commit that changed `scripts/architecture-baselines.json`, and `DIFF_BASE_SHA` when
  supplied. The prior-changed revision keeps the comparison effective at the clean replacement
  source SHA and after evidence-only commits. CI supplies the exact pull-request base / push-before
  SHA and the guard self-locks that step environment. An unreadable revision fails closed; the
  current pre-bootstrap `main` base may omit the file because Foundation 1c is its authorized
  introduction.
- `assertReachThroughWrapperRegistry()` now collects live findings once and checks both
  directions: live finding without registry entry, and registry entry without a live finding.
  The latter fails as stale even when `docs/OWNERSHIP_MAP.md` mirrors the padded name.
- Enabling the symmetric check exposed five already-stale bootstrap names:
  `claude-credentials`, `codex/cli-path`, `codex/runtime-status`, `provider-token`, and
  `utility-chat-completion`. The generated registry and its documentation mirror tightened from
  12 to the **7 live entries** (`chat-attachments`, `db`, `electron-app`, `local-only`,
  `mcp-auth`, `secure-storage`, `skills/registry`). No `src/` product code changed.
- Built-in synthetic fixtures cover empty, whitespace-only, and malformed baseline content plus
  a registry entry without a live one-hop finding.
- The sibling-router P2 found by both review rounds is registered as Yellow
  [TICKET-122](../../../docs/tickets/TICKET-122-router-sibling-route-surface-ratchet.md), marked
  design-pending / implementation-not-authorized. Foundation 1c does not widen route coverage.

### Superseding-review negative receipts

Both probes were applied locally to the repaired working tree, observed red, and reverted with
`apply_patch`; neither probe is committed.

1. **Synchronized padding wrapper/doc entry (replay of the original thirteenth-entry violation
   class):** added `zz-review-padding` to
   `scripts/architecture-baselines.json#reachThroughWrappers` and the OWNERSHIP_MAP mirror, then
   ran `node scripts/check-architecture-guards.mjs`. Exit **1** reported both independent
   blockers:
   - `Working architecture baseline against committed HEAD
     8ca11c18655287bd1ebc53c22414ff45b7b11991 adds reachThroughWrappers entry
     zz-review-padding; architecture baselines may only shrink relative to the committed
     baseline.`
   - `reachThroughWrappers baseline entry "zz-review-padding" is stale; delete it to tighten
     the baseline.`
2. **Empty/whitespace-only baseline:** replaced the baseline document with a single blank line,
   then ran the same normal guard command. Exit **1** reported
   `scripts/architecture-baselines.json must contain non-empty JSON content.` It did not print
   `Architecture guard passed.`

After each restoration, `bun run architecture:check` exited **0**. Current post-restoration,
pre-freeze SHA-256 values:

- `scripts/architecture-baselines.json`:
  `52147726abcf446a7e0580a90bec2e17f01c8c2daed57a624f0ae3bf8e6abdca`;
- `docs/OWNERSHIP_MAP.md`:
  `31ff2955b87a9bc79ba2923ccd8aa624ff9298e01dddbcdce11575dbe6aeb658`.

`git diff --check` passed after restoration. No probe file or padding entry remains.

### Pre-freeze targeted receipts

- `bun run architecture:check`: exit **0** (`Architecture guard passed.`).
- `bun run lint`: exit **0**.
- `bun test --isolate tests/proof-evidence-gates.test.ts
  tests/run-biome-changed.test.mjs`: **32 passed / 0 failed / 103 expectations**.
- `./node_modules/.bin/openspec validate add-architecture-guard-ratchet --strict
  --no-interactive`: valid.
- `bun run spec:validate`: **55 passed / 0 failed**.
- `bun run check`: exit **0**; architecture and lint passed; retired-runtime residue passed
  (**1,612 files scanned / 10 allowlisted**); TypeScript passed; tests **1,916 passed / 0
  failed / 9,291 expectations across 302 files**.
- Remote operations: not authorized / not performed. No merge or archive is authorized.
