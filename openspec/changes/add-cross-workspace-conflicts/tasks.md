# Tasks: Cross-Workspace conflict detection

## 1. Substrate fixes (land first; suite stays green throughout)

- [ ] 1.1 `src/main/lib/git/diff-parser.ts`: give `hunkHeaderRegex` (`:88`) capture groups and
      collect an additive `hunks?: {oldStart,oldLines,newStart,newLines}[]` on `ParsedDiffFile`
      (`:10-22`). Existing consumers are unaffected (field is optional). Unit tests for single-line
      hunks (`@@ -5 +5 @@`), multi-hunk files, and binary files (no hunks).
- [ ] 1.2 Fix the pure-rename bug in BOTH parsers: the missing-headers early return
      (`diff-parser.ts:95-97`) fires before the rename special-case (`:105-113`), so
      100%-similarity renames come back `isValid: false`. Same logic, same bug in the renderer
      duplicate (`agent-diff-view.tsx:380-466`). Regression test: a pure-rename diff parses valid
      with `oldPath`/`newPath` populated.
- [ ] 1.3 `-z` path collection: add a helper that parses `git status --porcelain -z` and
      `--numstat -z` output into repo-relative paths that survive rename syntax
      (`{old => new}`) and spaces. Unit tests with renamed and space-containing paths.

## 2. Fork-commit persistence (`chats.baseCommit`)

- [ ] 2.1 Schema: nullable `baseCommit: text("base_commit")` on `chats`
      (`src/main/lib/db/schema/index.ts` worktree fields block `:57-59`) + drizzle migration.
- [ ] 2.2 Capture at creation: `createWorktree` already resolves the start-point commit
      (`worktree.ts:246-257`) — thread it into `WorktreeResult` (`:945-953`) and persist it in the
      `chats-crud.ts` update path (`:202-214`).
- [ ] 2.3 Lazy backfill: when a conflict check needs a missing `baseCommit`, compute
      `git merge-base HEAD <baseBranch>` once (precedent: `detectBaseBranch`,
      `worktree.ts:662-708`), store it, and document force-push drift as accepted in a code comment.
- [ ] 2.4 Tests: creation persists the commit; backfill writes once; a null-base Workspace degrades
      tier (b) to tier (a) rather than erroring.

## 3. Tier (a): always-on path overlap in `listTasks`

- [ ] 3.1 `getDiffSummary` (`agent-workbench.ts:54-101`): return `files: string[]` alongside the
      counts, sourced from the ALREADY-FETCHED `status.files` (`:63-65`) with the 1.3 helper.
      ACCEPTANCE (the perf contract): **zero new git subprocesses** in the `listTasks` path — the
      same three git calls per Workspace as before, `-z` variants swapped in place.
- [ ] 3.2 Cross-task overlap: after the existing `Promise.all` (`:186-252`), compute
      `Map<path, taskId[]>` and attach `conflicts: {path, withTaskIds}[]` (plus a distinct
      delete-vs-edit marker) to each task. Pure set logic; unit-testable without git.
- [ ] 3.3 Renderer: update the hand-duplicated `WorkbenchTask` type (`agent-workbench.tsx:102-141`);
      render the annotation on the card metrics row (`:679-709`); clicking routes through the
      EXISTING `filteredDiffFilesAtom` / `diffSidebarOpenAtomFamily` plumbing exactly as
      `handleReview` does (`:1705-1719`). No new atoms, no new view.
- [ ] 3.4 i18n: new `workbench.*` keys in `en` AND `zhCN` in one commit ("Cross-Workspace
      Conflicts" / 「跨工作区冲突」; annotation copy names the count and the sibling Workspace
      titles). The taxonomy labels are untouched.
- [ ] 3.5 Tests: overlap map correctness (incl. rename and delete-vs-edit cases); per-worktree error
      containment still degrades that task only; tasks with `diff.error` never contribute paths.

## 4. Tiers (b)/(c): on-demand deep check

- [ ] 4.1 One-time git capability probe (`merge-tree --write-tree` needs git ≥ 2.38; this machine
      has 2.50.1, Ubuntu 22.04 ships 2.34): detect once, cache, expose in the procedure result.
- [ ] 4.2 New main-process procedure (`agentWorkbench.checkConflicts` or similar) taking N task ids:
      per Workspace compute fingerprint (HEAD sha + status hash); tier (b) hunk-range overlap using
      1.1's ranges, **hard-gated on `baseCommit` equality**; tier (c) `git merge-tree --write-tree`
      per pair against the shared object DB (N=4 → 6 pairs), verdict explicitly labeled
      "committed changes only"; degrade honestly when the probe fails or bases differ.
- [ ] 4.3 Renderer affordance on conflict-annotated cards; verdicts render with computed-at
      fingerprint; a fingerprint mismatch on next `listTasks` marks the verdict stale (visually),
      never silently re-runs.
- [ ] 4.4 Tests: gating (differing `baseCommit` → no tier-b verdict), probe degradation, verdict
      labeling, fingerprint staleness. Tier (b)/(c) MUST NOT be reachable from the polling path —
      assert the procedure is invoked only by explicit user action.

## 5. Docs and spec hygiene (called out in the proposal, not silent)

- [ ] 5.1 `docs/locus-workbench-focus.md`: replace the stale "Current Cut" (still the completed
      Codex-trace slice) with the parallel-safety slice (this change + the isolation change next),
      and state the thesis sentence explicitly so future proposals can quote it.
- [ ] 5.2 Fill `openspec/specs/agent-workbench/spec.md`'s `Purpose` (currently the archiver's "TBD"
      stub) — one paragraph, descriptive only.
- [ ] 5.3 zh-CN mirror `docs/locus-workbench-focus.zh-CN.md` updated in the same commit.

## 6. Verification

- [ ] 6.1 `bun run check` green; compare test count to the post-removal baseline (1378) and account
      for every addition.
- [ ] 6.2 `openspec validate --changes --strict --no-interactive` and `--specs` pass.
- [ ] 6.3 Perf spot-check with evidence: instrument or trace one `listTasks` refresh over ≥3
      Workspaces and record the git subprocess count before/after tier (a) — must be equal.
- [ ] 6.4 Desktop smoke (human or supervised agent, recorded in `desktop-smoke-evidence.md`):
      two Workspaces editing the same file show the annotation within one refresh; clicking it opens
      the filtered diff; deep check on a committed-vs-committed pair reports a labeled verdict;
      git-version degradation path exercised (`PATH` shim or CI matrix); zh-CN copy renders.
