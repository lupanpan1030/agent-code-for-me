# Tasks: add-architecture-guard-ratchet

## 1. Sequencing preconditions and baseline capture

- [ ] 1.1 Confirm the Foundation 1a (route service extraction) and 1b (dual-path
      consolidation) changes are merged locally; record their merge SHAs in
      `verification.md`. Do not start baselines before this gate.
- [ ] 1.2 Re-measure every draft-time hint against the post-1a/1b tree before freezing
      anything: `wc -l` and the named-export set of `trpc/routers/claude.ts` and
      `trpc/routers/codex.ts`; banned-category direct imports in `src/main/lib/{codex,
      claude,runtime-mcp-config,runtime-capability-projection,agent-workbench}/`;
      `src/main/lib/**` imports resolving under `src/main/lib/trpc/routers/**`; the
      direct-importer set of `appendAgentJobEvent`. Record the deltas from the proposal's
      hints in `verification.md` (1a/1b are expected to have shrunk several of them).
- [ ] 1.3 Capture a green `bun run check` baseline on the pre-change commit so later
      failures are attributable.

## 2. Baseline registry and update tooling

- [ ] 2.1 Create `scripts/architecture-baselines.json` with sections
      `temporaryOwnerRoutes` (per route: `lines`, `exports[]`, optional `raiseNote`),
      `importBoundaryViolations` (entries: `file`, `specifier`, `category`),
      `reverseDirectionImports` (entries: `file`, `specifier`), and
      `reachThroughWrappers` (module list: `electron-app`, `db`, `secure-storage`,
      `provider-token`, `local-only`, `claude-credentials`, `codex/cli-path`,
      `codex/runtime-status`, `utility-chat-completion` — re-verified against the
      post-1a/1b OWNERSHIP_MAP). Header comment states entries may only be deleted and
      names the Owner-edit rule for raises.
- [ ] 2.2 Add `--update-architecture-baselines` to `scripts/check-architecture-guards.mjs`:
      regenerates deterministic sorted output and refuses to raise any number or add any
      violation/wrapper entry (prints the hand-edit instruction instead).
- [ ] 2.3 Generate the baselines at the implementation SHA via the update mode; commit the
      generated file unedited.

## 3. Canonical event single-path guard

- [ ] 3.1 Implement `assertRuntimeEventSinglePath` in `check-architecture-guards.mjs`:
      single definition sites for `createRunEvent` (`agent-runtime/runtime-events.ts`),
      `mapDesktopStreamChunkToRunEvents` / `createDesktopStreamEventMapper` /
      `appendRunEventsToAgentJob` / `redactRendererDiagnosticChunk` /
      `redactRendererRuntimeChunk` / `createRuntimeRendererChunkEmitter`
      (`agent-runtime/stream-event-mapper.ts`), `createAgentJobRunEvent`
      (`agent-runtime/job-event-bridge.ts`), `redactRuntimePayload` /
      `redactExactSecretHints` (`agent-runtime/redaction.ts`), following the
      `assertGuardDecisionSingleOwner` pattern.
- [ ] 3.2 Assert `appendAgentJobEvent` is exported only from
      `src/main/lib/headless/job-store.ts` and `insertAgentJobEventRecord` is not
      exported; assert direct importers of `appendAgentJobEvent` match the frozen
      allowlist and that no file under `src/main/lib/trpc/routers/**`,
      `src/main/lib/codex/**`, or `src/main/lib/claude/**` imports it.
- [ ] 3.3 Add synthetic pass/fail self-test fixtures (duplicate definition; disallowed
      raw-write import; clean fixture) that fail closed, mirroring the import-boundary
      self-test style.

## 4. Temporary-owner route ratchet

- [ ] 4.1 Implement `assertTemporaryOwnerRouteRatchet` reading `temporaryOwnerRoutes`:
      fail when measured lines exceed baseline or an export is outside the baseline set;
      fail with "tighten to N" when below; surface `raiseNote` when present.
- [ ] 4.2 Self-test fixtures: above-baseline, below-baseline, unlisted-export, and
      exact-match cases.
- [ ] 4.3 Document in the guard's failure text that the ratchet retires with the
      OWNERSHIP_MAP temporary-owner clauses (pointer to the map's Claude/Codex Desktop
      Chat Runtime sections).

## 5. Import-boundary expansion, direction check, wrapper registry

- [ ] 5.1 Extend `RUNTIME_CORE_DIRECTORIES` with `src/main/lib/codex`,
      `src/main/lib/claude`, `src/main/lib/runtime-mcp-config`,
      `src/main/lib/runtime-capability-projection`, and `src/main/lib/agent-workbench`;
      route findings through the `importBoundaryViolations` baseline (finding outside
      baseline → fail; stale baseline entry → fail with delete instruction).
- [ ] 5.2 Implement the repo-wide direction check over `src/main/lib/**` (excluding
      `src/main/lib/trpc/**`) rejecting imports that resolve under
      `src/main/lib/trpc/routers/**`, reusing the existing AST dependency-syntax
      machinery (type-only imports included); wire the `reverseDirectionImports`
      baseline with identical only-shrink semantics.
- [ ] 5.3 Implement one-hop reach-through detection against `reachThroughWrappers` and
      the doc-sync assertion that the OWNERSHIP_MAP wrapper list names exactly the
      registry entries.
- [ ] 5.4 Self-test fixtures for: new banned import in an expanded directory,
      baselined finding passing, reverse-direction import, unlisted wrapper, doc/registry
      mismatch.
- [ ] 5.5 Update `docs/OWNERSHIP_MAP.md` "Runtime Core Import Boundary" (guarded-directory
      list, machine-registry pointer, one-hop rule) and "tRPC Route Boundary"
      (ratchet pointer). No other doc edits.

## 6. Orphan guard wiring and residue-gate self-lock

- [ ] 6.1 Confirm the existing `retired-runtime:check` wiring is intact (package script
      `retired-runtime:check = node scripts/check-retired-runtime-residue.mjs`; present in
      the blocking `check` chain in `package.json`; run as a CI main-job step in
      `.github/workflows/ci.yml`). Do NOT add a second entry point or script name.
- [ ] 6.2 Extend the self-lock guards (`assertPackageScripts` /
      `assertCiRunsArchitectureCheck`) so `retired-runtime:check` cannot be removed from
      `check` or CI without failing `architecture:check`.
- [ ] 6.3 Add `knip` as a pinned devDependency, package script `debt:knip = knip`, and a
      `continue-on-error: true` step in the `debt-report` CI job. Record the first
      report's headline counts in `verification.md`; do not act on findings (Yellow).
- [ ] 6.4 Extend `tests/proof-evidence-gates.test.ts` with a block for
      `scripts/check-runtime-control-smoke-evidence.mjs`: spawn it like the two sibling
      gates and assert its runbook/anti-tamper source markers; keep the existing manual
      `runtime-control:smoke:evidence` script pointing at the same file (no copy).

## 7. Lint ratchet (W4.3)

- [ ] 7.1 Add `--update-lint-baseline` to `scripts/run-biome-changed.mjs` writing
      `lint-baseline.json`: per-file blocking (error+warning) counts, sorted,
      deterministic; info excluded; files at zero omitted; a header key notes the
      only-shrink rule, the pure-rename carry-over rule (an entry may move to a renamed
      path with an identical count), and the separate mechanical-cleanup batches.
- [ ] 7.2 Enforce on the normal path: for every touched file, full-file blocking count
      must be ≤ baseline entry (absent = 0); above → fail listing the file's
      diagnostics; below → fail with the tighten instruction. Changed-line
      zero-tolerance behavior stays byte-for-byte unchanged for the non-ratchet path.
- [ ] 7.3 Generate `lint-baseline.json` at the implementation SHA and commit it
      unedited. Record the total (draft-time hint: 2,743 diagnostics / 685 files, of
      which ~1,080 mechanically auto-fixable — regenerated numbers will differ).
- [ ] 7.4 Extend `tests/run-biome-changed.test.mjs`: touched-file above-baseline fails,
      at-baseline passes, below-baseline demands tightening, absent-entry file with any
      blocking diagnostic fails, update mode is deterministic and never raises.

## 8. Verification

- [ ] 8.1 `bun run architecture:check` green on the clean tree; then negative proof: for
      each new guard, locally introduce one violation of its class (second mapping
      export; +1 line in `codex.ts`; banned import in `src/main/lib/codex/`; router
      import from `src/main/lib/`; unlisted wrapper; lint-count increase in a touched
      file; removing `retired-runtime:check` from `check`) and record the red output in
      `verification.md`; revert without committing.
- [ ] 8.2 `bun run check` green including `retired-runtime:check`; `bun test` green including the
      two extended test files; CI main job and `debt-report` job green on the working
      branch (knip step may report findings but not fail the job).
- [ ] 8.3 `openspec validate add-architecture-guard-ratchet --strict --no-interactive`
      passes; repo-wide `--changes` and `--specs` validation passes.
- [ ] 8.4 Confirm scope guards held: `git diff --stat` shows no `src/` product-code edits,
      no drizzle/schema changes, no edits to the dangerous-router-input allowlist, and no
      baseline entry added or raised relative to the generated output.

## 9. Closeout (repo standard)

- [ ] 9.1 Bind the exact source SHA and the full `bun run check:full` receipt into
      `verification.md`.
- [ ] 9.2 Record IMPLEMENTATION_VERIFIED (Codex) and fresh-context REVIEW_APPROVED
      (Claude) in `verification.md` for that same SHA.
- [ ] 9.3 Record Owner acceptance.
- [ ] 9.4 Local fast-forward merge into `main`; run the post-merge gate
      (`bun run check:full`) on the local merge SHA and record the receipt.
- [ ] 9.5 Record `remote not authorized / not performed` for push, remote PR mutation,
      remote merge, and release.
- [ ] 9.6 `openspec archive add-architecture-guard-ratchet --yes` (spec deltas apply to
      `architecture-ownership`; do not pass `--skip-specs`), then
      `openspec validate --strict --no-interactive` to confirm the archived state.
