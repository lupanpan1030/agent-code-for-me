# Tasks: add-architecture-guard-ratchet

## 1. Sequencing preconditions and baseline capture

- [x] 1.1 Confirm the Foundation 1a (route service extraction) and 1b (dual-path
      consolidation) changes are merged locally; record their merge SHAs in
      `verification.md`. Do not start baselines before this gate.
- [x] 1.2 Re-measure every draft-time hint against the post-1a/1b tree before freezing
      anything: `wc -l` and the named-export set of `trpc/routers/claude.ts` and
      `trpc/routers/codex.ts`; banned-category direct imports in `src/main/lib/{codex,
      claude,runtime-mcp-config,runtime-capability-projection,agent-workbench}/`;
      `src/main/lib/**` imports resolving under `src/main/lib/trpc/routers/**`; the
      direct-importer set of `appendAgentJobEvent`. Record the deltas from the proposal's
      hints in `verification.md` (1a/1b are expected to have shrunk several of them).
- [x] 1.3 Capture a green `bun run check` baseline on the pre-change commit so later
      failures are attributable.

## 2. Baseline registry and update tooling

- [x] 2.1 Create `scripts/architecture-baselines.json` with sections
      `routeSurfaceRatchets` (per route: `lines`, `exports[]`, optional `raiseNote`),
      `importBoundaryViolations` (entries: `file`, `specifier`, `category`),
      `reverseDirectionImports` (entries: `file`, `specifier`), and
      `reachThroughWrappers` (Owner-authorized first-freeze module list: `electron-app`,
      `db`, `secure-storage`,
      `provider-token`, `local-only`, `claude-credentials`, `codex/cli-path`,
      `codex/runtime-status`, `utility-chat-completion`, `chat-attachments`, `mcp-auth`,
      `skills/registry` — re-verified against the
      post-1a/1b OWNERSHIP_MAP). Header comment states entries may only be deleted and
      names the Owner-edit rule for raises; the authorized 12-entry first freeze is the
      bootstrap, not permission for any later addition. The normal-path follow-up in 8.6
      additionally requires an explicit Owner-approved guard/spec change for a later raise.
- [x] 2.2 Add `--update-architecture-baselines` to `scripts/check-architecture-guards.mjs`:
      regenerates deterministic sorted output and refuses to raise any number or add any
      violation/wrapper entry (prints the Owner-approved guard/spec-change instruction
      instead).
- [x] 2.3 Generate the baselines at the implementation SHA via the update mode; commit the
      generated file unedited.

## 3. Canonical event single-path guard

- [x] 3.1 Implement `assertRuntimeEventSinglePath` in `check-architecture-guards.mjs`:
      single definition sites for `createRunEvent` (`agent-runtime/runtime-events.ts`),
      `mapDesktopStreamChunkToRunEvents` / `createDesktopStreamEventMapper` /
      `appendRunEventsToAgentJob` / `redactRendererDiagnosticChunk` /
      `redactRendererRuntimeChunk` / `createRuntimeRendererChunkEmitter`
      (`agent-runtime/stream-event-mapper.ts`), `createAgentJobRunEvent`
      (`agent-runtime/job-event-bridge.ts`), `redactRuntimePayload` /
      `redactExactSecretHints` (`agent-runtime/redaction.ts`), following the
      `assertGuardDecisionSingleOwner` pattern.
- [x] 3.2 Assert `appendAgentJobEvent` is exported only from
      `src/main/lib/headless/job-store.ts` and `insertAgentJobEventRecord` is not
      exported; assert direct importers of `appendAgentJobEvent` match the frozen
      allowlist and that no file under `src/main/lib/trpc/routers/**`,
      `src/main/lib/codex/**`, or `src/main/lib/claude/**` imports it.
- [x] 3.3 Add synthetic pass/fail self-test fixtures (duplicate definition; disallowed
      raw-write import; clean fixture) that fail closed, mirroring the import-boundary
      self-test style.

## 4. Route surface ratchets

- [x] 4.1 Implement `assertRouteSurfaceRatchets` reading `routeSurfaceRatchets`:
      fail when measured lines exceed baseline or an export is outside the baseline set;
      fail with "tighten to N" when below; surface `raiseNote` when present. Failure text
      identifies `claude.ts` as temporary-owner containment and `codex.ts` as
      orchestration-boundary no-growth containment.
- [x] 4.2 Self-test fixtures: above-baseline, below-baseline, unlisted-export, and
      exact-match cases.
- [x] 4.3 Document distinct retirement rules in guard failures and OWNERSHIP_MAP pointers:
      Claude retires with the approved extraction that removes its temporary-owner clause;
      Codex retires only by explicit Owner decision or in the same approved change that
      structurally decomposes the route (for example Job Kernel).

## 5. Import-boundary expansion, direction check, wrapper registry

- [x] 5.1 Extend `RUNTIME_CORE_DIRECTORIES` with `src/main/lib/codex`,
      `src/main/lib/claude`, `src/main/lib/runtime-mcp-config`,
      `src/main/lib/runtime-capability-projection`, and `src/main/lib/agent-workbench`;
      route findings through the `importBoundaryViolations` baseline (finding outside
      baseline → fail; stale baseline entry → fail with delete instruction).
- [x] 5.2 Implement the repo-wide direction check over `src/main/lib/**` (excluding
      `src/main/lib/trpc/**`) rejecting imports that resolve under
      `src/main/lib/trpc/routers/**`, reusing the existing AST dependency-syntax
      machinery (type-only imports included); wire the `reverseDirectionImports`
      baseline with identical only-shrink semantics.
- [x] 5.3 Implement one-hop reach-through detection against `reachThroughWrappers` and
      the doc-sync assertion that the OWNERSHIP_MAP wrapper list names exactly the
      registry entries. Freeze the Owner-authorized 12-entry bootstrap; later additions
      fail Red and removals demand tightening.
- [x] 5.4 Self-test fixtures for: new banned import in an expanded directory,
      baselined finding passing, reverse-direction import, unlisted wrapper inside and
      outside `src/main/lib/`, doc/registry mismatch.
- [x] 5.5 Update `docs/OWNERSHIP_MAP.md` "Runtime Core Import Boundary" (guarded-directory
      list, machine-registry pointer, one-hop rule), "tRPC Route Boundary" (neutral
      ratchet pointer), and the "Claude Desktop Chat Runtime" / "Codex Desktop Chat
      Runtime" sections (their distinct containment and retirement rules). Make no
      unrelated OWNERSHIP_MAP edits.
- [x] 5.6 Register one Yellow contraction follow-up for each newly frozen wrapper:
      TICKET-119 (`src/main/lib/chat-attachments.ts`), TICKET-120
      (`src/main/lib/mcp-auth.ts`), and TICKET-121
      (`src/main/lib/skills/registry.ts`). Do not implement the product-code cleanup.

## 6. Orphan guard wiring and residue-gate self-lock

- [x] 6.1 Confirm the existing `retired-runtime:check` wiring is intact (package script
      `retired-runtime:check = node scripts/check-retired-runtime-residue.mjs`; present in
      the blocking `check` chain in `package.json`; run as a CI main-job step in
      `.github/workflows/ci.yml`). Do NOT add a second entry point or script name.
- [x] 6.2 Extend the self-lock guards (`assertPackageScripts` /
      `assertCiRunsArchitectureCheck`) so `retired-runtime:check` cannot be removed from
      `check` or CI without failing `architecture:check`.
- [x] 6.3 Add `knip` as a pinned devDependency, package script `debt:knip = knip`, and a
      `continue-on-error: true` step in the `debt-report` CI job. Record the first
      report's headline counts in `verification.md`; do not act on findings (Yellow).
- [x] 6.4 Extend `tests/proof-evidence-gates.test.ts` with a block for
      `scripts/check-runtime-control-smoke-evidence.mjs`: spawn it like the two sibling
      gates and assert its runbook/anti-tamper source markers; keep the existing manual
      `runtime-control:smoke:evidence` script pointing at the same file (no copy).

## 7. Lint ratchet (W4.3)

- [x] 7.1 Add `--update-lint-baseline` to `scripts/run-biome-changed.mjs` writing
      `lint-baseline.json`: per-file blocking (error+warning) counts, sorted,
      deterministic; info excluded; files at zero omitted; a header key notes the
      only-shrink rule, the pure-rename carry-over rule (an entry may move to a renamed
      path with an identical count), and the separate mechanical-cleanup batches.
- [x] 7.2 Enforce on the normal path: for every touched file, full-file blocking count
      must be ≤ baseline entry (absent = 0); above → fail listing the file's
      diagnostics; below → fail with the tighten instruction. Changed-line
      zero-tolerance behavior stays byte-for-byte unchanged for the non-ratchet path.
- [x] 7.3 Generate `lint-baseline.json` at the implementation SHA and commit it
      unedited. Record the total (draft-time hint: 2,743 diagnostics / 685 files, of
      which ~1,080 mechanically auto-fixable — regenerated numbers will differ).
- [x] 7.4 Extend `tests/run-biome-changed.test.mjs`: touched-file above-baseline fails,
      at-baseline passes, below-baseline demands tightening, absent-entry file with any
      blocking diagnostic fails, update mode is deterministic and never raises.

## 8. Verification

- [x] 8.1 `bun run architecture:check` green on the clean tree; then negative proof: for
      each new guard, locally introduce one violation of its class (second mapping
      export; +1 line in `codex.ts`; banned import in `src/main/lib/codex/`; router
      import from `src/main/lib/`; unlisted wrapper; lint-count increase in a touched
      file; removing `retired-runtime:check` from `check`) and record the red output in
      `verification.md`; revert without committing.
- [x] 8.2 `bun run check` green including `retired-runtime:check`; `bun test` green including the
      two extended test files; CI main job and `debt-report` job green on the working
      branch (knip step may report findings but not fail the job).
- [x] 8.3 `openspec validate add-architecture-guard-ratchet --strict --no-interactive`
      passes; repo-wide `--changes` and `--specs` validation passes.
- [x] 8.4 Confirm scope guards held: `git diff --stat` shows no `src/` product-code edits,
      no drizzle/schema changes, no edits to the dangerous-router-input allowlist, and no
      baseline entry added or raised relative to the generated output.
- [x] 8.5 Superseding-review repair: make architecture-baseline parsing fail closed for
      empty, whitespace-only, invalid JSON, and invalid shape; run all four ratchets only
      from a valid document.
- [x] 8.6 Add the symmetric reach-through stale-entry check and wire the normal blocking
      path to compare the working architecture baseline with committed `HEAD`, its previous
      changed version, and the self-locked CI diff base using the existing only-shrink
      comparison. Mechanically remove any now-stale registry/doc entries; do not change
      product code.
- [x] 8.7 Add fail-closed parser and stale-wrapper synthetic fixtures. Reproduce and record
      both superseding-review negatives: a synchronized padding wrapper/doc entry replaying
      the original thirteenth-entry violation class and an empty baseline file must each
      make `architecture:check` exit nonzero; restore all probes and rerun green.
- [x] 8.8 Register the sibling-router route-ratchet gap as Yellow TICKET-122. Do not
      implement directory-level route coverage in Foundation 1c.

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
