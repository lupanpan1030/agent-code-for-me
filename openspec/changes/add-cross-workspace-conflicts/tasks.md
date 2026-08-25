# Tasks: Cross-Workspace conflict detection

## 1. Substrate fixes (land first; suite stays green throughout)

- [x] 1.1 Add hunk capture to the canonical `src/shared/unified-diff-parser.ts`: collect an
      additive `hunks?: {oldStart,oldLines,newStart,newLines}[]` on `ParsedDiffFile`. Cover
      single-line hunks (`@@ -5 +5 @@`), multi-hunk files, and binary files (no hunks).
- [x] 1.2 Fix pure-rename validity and C-quoted Unicode path decoding in the canonical parser;
      migrate all main/renderer consumers to it, delete the old main and renderer-local parser
      implementations, and add a static ownership guard forbidding their return.
- [x] 1.3 `-z` path collection: add a helper that parses `git status --porcelain -z` and
      `--numstat -z` output into repo-relative paths that survive rename syntax
      (`{old => new}`) and spaces. Unit tests with renamed and space-containing paths.

  **Correction (2026-08-13):** the checked implementation instead uses simple-git's existing
  null-delimited status call and its structured `status.files` entries. `collectChangedFiles`
  reads current/original paths from those entries; numstat remains count-only and its path column
  is unused. The experimental helper and helper-only test were production-dead and are deleted.

## 2. Fork-commit persistence (`chats.baseCommit`)

- [x] 2.1 Schema: nullable `baseCommit: text("base_commit")` on `chats`
      (`src/main/lib/db/schema/index.ts` worktree fields block `:57-59`) + drizzle migration.
- [x] 2.2 Capture at creation: `createWorktree` already resolves the start-point commit
      (`worktree.ts:246-257`) — thread it into `WorktreeResult` (`:945-953`) and persist it in the
      `chats-crud.ts` update path (`:202-214`).
- [x] 2.3 Lazy backfill: when a conflict check needs a missing `baseCommit`, compute
      `git merge-base HEAD <baseBranch>` once (precedent: `detectBaseBranch`,
      `worktree.ts:662-708`), store it, and document force-push drift as accepted in a code comment.
- [x] 2.4 Tests: creation persists the commit; backfill writes once; a null-base Workspace degrades
      tier (b) to tier (a) rather than erroring.

## 3. Tier (a): always-on path overlap in `listTasks`

- [x] 3.1 `getDiffSummary` (`agent-workbench.ts:54-101`): return `files: string[]` alongside the
      counts, sourced from the ALREADY-FETCHED `status.files` (`:63-65`) with the 1.3 helper.
      ACCEPTANCE (the perf contract): **zero new git subprocesses** in the `listTasks` path — the
      same three git calls per Workspace as before, `-z` variants swapped in place.

  **Correction (2026-08-13):** `files` is sourced from the already-computed structured
  `status.files` through `collectChangedFiles`, not the deleted 1.3 helper. No raw numstat path is
  consumed and no numstat `-z` variant was introduced. The zero-new-subprocess acceptance remains
  unchanged and is re-audited in `verification.md`.

- [x] 3.2 Cross-task overlap: after the existing `Promise.all` (`:186-252`), compute
      `Map<path, taskId[]>` and attach `conflicts: {path, withTaskIds}[]` (plus a distinct
      delete-vs-edit marker) to each task. Pure set logic; unit-testable without git.
- [x] 3.3 Renderer: update the hand-duplicated `WorkbenchTask` type (`agent-workbench.tsx:102-141`);
      render the annotation on the card metrics row (`:679-709`); clicking routes through the
      EXISTING `filteredDiffFilesAtom` / `diffSidebarOpenAtomFamily` plumbing exactly as
      `handleReview` does (`:1705-1719`). No new atoms, no new view.
- [x] 3.4 i18n: new `workbench.*` keys in `en` AND `zhCN` in one commit ("Cross-Workspace
      Conflicts" / 「跨工作区冲突」; annotation copy names the count and the sibling Workspace
      titles). The taxonomy labels are untouched.
- [x] 3.5 Tests: overlap map correctness (incl. rename and delete-vs-edit cases); per-worktree error
      containment still degrades that task only; tasks with `diff.error` never contribute paths.

## 4. Tiers (b)/(c): on-demand deep check

- [x] 4.1 One-time git capability probe (`merge-tree --write-tree` needs git ≥ 2.38; this machine
      has 2.50.1, Ubuntu 22.04 ships 2.34): detect once, cache, expose in the procedure result.
- [x] 4.2 New main-process procedure (`agentWorkbench.checkConflicts` or similar) taking N task ids:
      per Workspace compute fingerprint (HEAD sha + status hash); tier (b) hunk-range overlap using
      1.1's ranges, **hard-gated pairwise on both `baseCommit` equality and current HEAD SHA
      equality**; tier (c) `git merge-tree --write-tree` per pair against the shared object DB
      (N=4 → 6 pairs), verdict explicitly labeled "committed changes only"; degrade honestly when
      the probe fails or either tier-(b) coordinate-system gate cannot be established.
- [x] 4.3 Renderer affordance on conflict-annotated cards; verdicts render with computed-at
      fingerprint; a fingerprint mismatch on next `listTasks` marks the verdict stale (visually),
      never silently re-runs.

  **Remediation (2026-08-13):** the affordance is now gated by at least two eligible branch-mode,
  non-archived sibling Workspaces rather than by an existing annotation. Passive status-hash
  staleness latches until a successful re-run; successful checks refetch `listTasks`, and the last
  successful verdict stays rendered while a re-run is pending.

- [x] 4.4 Tests: gating (differing `baseCommit` → no tier-b verdict; equal `baseCommit` with
      differing current HEAD → no tier-b verdict with reason `head-commits-differ`), probe
      degradation, verdict labeling, fingerprint staleness. Tier (b)/(c) MUST NOT be reachable from
      the polling path — assert the procedure is invoked only by explicit user action.

## 5. Docs and spec hygiene (called out in the proposal, not silent)

- [x] 5.1 `docs/locus-workbench-focus.md`: replace the stale "Current Cut" (still the completed
      Codex-trace slice) with the parallel-safety slice (this change + the isolation change next),
      and state the thesis sentence explicitly so future proposals can quote it.
- [x] 5.2 Fill `openspec/specs/agent-workbench/spec.md`'s `Purpose` (currently the archiver's "TBD"
      stub) — one paragraph, descriptive only.
- [x] 5.3 zh-CN mirror `docs/locus-workbench-focus.zh-CN.md` updated in the same commit.

## 6. Verification

- [x] 6.1 `bun run check` green; compare test count to the post-removal baseline (1378) and account
      for every addition.
- [x] 6.2 `openspec validate --changes --strict --no-interactive` and `--specs` pass.
- [x] 6.3 Perf spot-check with evidence: instrument or trace one `listTasks` refresh over ≥3
      Workspaces and record the git subprocess count before/after tier (a) — must be equal.
- [x] 6.4 Desktop smoke (human or supervised agent, recorded in `desktop-smoke-evidence.md`):
      two Workspaces editing the same file show the annotation within one refresh; clicking it opens
      the filtered diff; deep check on a committed-vs-committed pair reports a labeled verdict;
      git-version degradation path exercised (`PATH` shim or CI matrix); zh-CN copy renders.

The 6.1 and 6.2 receipts above describe the completed implementation batches before the final-review
remediation. The post-remediation acceptance reruns are tracked separately below.

## 7. Final-review remediation (2026-08-13)

- [x] 7.1 **A:** scope tier-(a) warnings to status-visible uncommitted changes, ungate deep checks
      for eligible siblings, cover the committed-only path, and amend proposal/design/spec truth.
- [x] 7.2 **B:** latch passive status-hash staleness, refresh the listing baseline after success,
      preserve the last successful verdict while pending, and document the committed-scope caveat.
- [x] 7.3 **C:** treat an exit-1 merge trial with empty stdout as unavailable/trial-failed and cover
      a deleted-branch fixture.
- [x] 7.4 **D:** never pair two tasks whose resolved worktree paths are identical; cover two chats
      sharing the project directory.
- [x] 7.5 **E:** freeze only further marketplace expansion in both focus-doc languages because the
      runtime-scoped marketplace center is already shipped.
- [x] 7.6 **F1:** preserve the already-computed file paths with null counts when numstat fails.
- [x] 7.7 **F2:** decode C-quoted diff header paths before stripping the `a/` or `b/` prefix in both
      parsers, with quoted-Unicode regression coverage.
- [x] 7.8 **F3:** cap deep-check task IDs at 10 and skip merge trials for equal non-null HEAD tips.
- [x] 7.9 **F4:** classify an all-delete overlap as `delete-delete`, with English and Simplified
      Chinese copy and regression coverage.
- [x] 7.10 **F5:** surface a deep-check tRPC error message when present, falling back to generic copy.
- [x] 7.11 **F6:** require a `/` boundary for conflict click-through suffix matching.
- [x] 7.12 **F7:** exclude archived tasks from conflict-map participation even when displayed.
- [x] 7.13 **F8:** exclude the diff surface's lock-file patterns from conflict-map input while
      preserving the unfiltered file list and count.
- [x] 7.14 **F9:** use a dedicated short unknown-value key in both languages for verdict provenance.
- [x] 7.15 **F10:** delete the production-dead porcelain helper/test and append dated corrections
      to tasks 1.3/3.1 and the design risk record without rewriting the historical checklist text.
- [x] 7.16 **F11:** identify the three source-grep UI test suites as static source guards.
- [x] 7.17 Append the dated final-review dispositions, spec-amendment notes, and deliberate non-fix
      record to `verification.md`.

## 8. Post-remediation acceptance

- [x] 8.1 Re-run `bun run check`; record the final pass/fail total and account for additions and the
      removed helper-only tests relative to 1430/0.
- [x] 8.2 Re-run `openspec validate add-cross-workspace-conflicts --strict --no-interactive` after
      the A/B amendments.
- [x] 8.3 Re-run `openspec validate --changes --strict --no-interactive` and
      `openspec validate --specs --strict --no-interactive` after integration.

## 9. Integrated pre-merge hardening (2026-08-25)

- [x] 9.1 Build one canonical Workspace snapshot with
      `HEAD-before → summary/raw double sample → HEAD-after`; a changed HEAD or dirty diff makes
      hunk adjudication unavailable, and committed trials receive captured SHAs only.
- [x] 9.2 Bound the complete deep check, including snapshot preparation, with a 30-second default
      request deadline; additionally bound merge-tree work with a 15-second default pair timeout
      and concurrency 3 (hard maximum 4), exposing timeout/deadline details without throwing.
- [x] 9.3 Make lazy `baseCommit` persistence a database compare-and-set and cover two concurrent
      callers computing different candidates.
- [x] 9.4 Share one deep-check eligibility validator between listing and mutation; enforce archived,
      project, branch, worktree, duplicate/shared-directory, maximum-size, and registered-root rules
      at the server boundary before Git IO.
- [x] 9.5 Consolidate unified-diff parsing under `src/shared/unified-diff-parser.ts`, remove the old
      main and renderer paths and copied parsed-file DTOs, and add a static single-owner guard.
- [x] 9.6 Render distinct snapshot-change, missing-HEAD, pair-timeout, and batch-deadline unavailable
      explanations, including dirty-diff mutation, in both English and Simplified Chinese.
- [x] 9.7 Run the 15-file targeted regression set plus typecheck, architecture guards, diff check,
      and the real-Codex-home contamination assertion; record the receipt in `verification.md`.
- [ ] 9.8 Commit the integrated source, run `bun run check:full` on the exact source SHA, and record
      Codex implementation verification plus fresh-context Claude Code review for that same SHA.
- [ ] 9.9 Fast-forward the reviewed source locally into `main`, run the post-merge gate on the local
      merge SHA, record Owner acceptance plus `remote not authorized / not performed`, archive the
      change, and verify the archive.
- [x] 9.10 Close the follow-up reviewer findings without widening the public surface: decode
      C-quoted binary diff paths, preserve explicit multi-file diff-entry filters, classify a
      one-sided/missing HEAD capture as unavailable rather than moved, cap each deep-check raw diff
      at 2 MiB UTF-8, discard synchronous parse evidence that crosses the request deadline, and
      propagate deadline cancellation into canonical simple-git HEAD/status/diff operations.
- [x] 9.11 Add focused regressions for quoted binary paths, narrow-layout filter preservation,
      null-to-SHA capture, oversized multibyte diffs with an independent committed-tree trial,
      dependency abort signaling, and post-parse deadline exhaustion; record the pre-commit receipt
      in `verification.md`.
