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
