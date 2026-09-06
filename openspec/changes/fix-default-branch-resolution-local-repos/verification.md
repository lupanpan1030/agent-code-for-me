# Verification

- Change ID: `fix-default-branch-resolution-local-repos`
- Risk: R2 repository default-branch policy and four-consumer atomic migration
- Owner implementation approval: **APPROVED 2026-09-05**
- Base SHA: `30451539b85547223002c5017131670c1161a64d`
- Branch: `codex/fix-default-branch-resolution-local-repos`
- Worktree: `/home/chen/projects/locus-fix-ci-default-branch-fixture`
- Frozen implementation source SHA:
  `7d26fec7579b05d56e5a0ef1e1d66d76a0b91ea6`
- Acceptance/review evidence SHA:
  `e1f8a7f95a49905aa078879fa873fb7e8500acee` (`7d26fec7` source + docs,
  including the ownership-map rule); the implementation and independent review
  verdicts bind the same frozen source. This follow-up records documentation
  dispositions only and does not re-freeze source or grant Owner acceptance.
- Date / operator: 2026-09-05 / Codex
- Environment: Linux 6.18.33.2-microsoft-standard-WSL2 x86_64;
  linux/x64; Node v24.19.0; Bun 1.3.14
- Codex implementation verdict: **IMPLEMENTATION_VERIFIED** for
  `7d26fec7579b05d56e5a0ef1e1d66d76a0b91ea6`

## Approval, impact, and rollback

- The independent acceptance-test commit and Owner-approved proposal were the
  implementation baseline. Product code was not changed until HEAD, branch,
  clean-tree state, ratified product documents, living specs, and active-change
  overlap were checked.
- There is no public API or renderer contract change. The private tRPC result
  remains `defaultBranch: string`; provenance remains inside the main process.
- There is no schema, stored-data, dependency, or migration change. Existing
  explicit and persisted `baseBranch` values remain authoritative and are not
  rewritten.
- Rollback the complete reviewed pilot together: `e1f8a7f9` (evidence docs) +
  `7d26fec7` (implementation) + `30451539` (RED tests), or do not integrate the
  branch. Include any later documentation-only review/disposition commits in
  that rollback. Reverting only `7d26fec7` leaves 12 RED tests failing;
  `lint-baseline.json` reverts with `7d26fec7`. No remote state or data migration
  needs reversal. This supersedes the proposal's pre-implementation shorthand
  of reverting the future implementation commit alone.
- No merge, push, archive, release, remote PR mutation, or repository-rule
  change was performed.

## Baseline and immutable test-first artifacts

At exact base SHA `30451539b85547223002c5017131670c1161a64d`:

- `bun test --isolate tests/default-branch-resolution-local-repos.test.ts`:
  **4 pass / 12 fail / 61 expectations / 1 file**, exit **1**. This reproduced
  the supplied red receipt before implementation.

At frozen source SHA `7d26fec7579b05d56e5a0ef1e1d66d76a0b91ea6`:

- `git diff --exit-code 30451539b85547223002c5017131670c1161a64d..HEAD -- tests/default-branch-resolution-local-repos.test.ts openspec/changes/fix-default-branch-resolution-local-repos/red-receipt.md`:
  no output, exit **0**.
- `git diff 30451539b85547223002c5017131670c1161a64d..HEAD --stat -- tests/default-branch-resolution-local-repos.test.ts`:
  no output. The red test file is **zero-change relative to 30451539**.
- The immutable test SHA-1 remains
  `94c8af738645c191758cc941046922fd7c478b25`; `red-receipt.md` remains
  `aa638ed1247c4e686da4f369b4215b46c66c69c0`.

## Exact-source automated receipts

All commands in this section ran at frozen source SHA
`7d26fec7579b05d56e5a0ef1e1d66d76a0b91ea6` with a clean worktree.

- `bun test --isolate tests/default-branch-resolution-local-repos.test.ts`:
  **16 pass / 0 fail / 91 expectations / 1 file**, exit **0**.
- `bun test --isolate tests/git-default-branch-resolver.test.ts`:
  **19 pass / 0 fail / 66 expectations / 1 file**, exit **0**.
- Focused task-4.1 command:

  ```text
  bun test --isolate tests/default-branch-resolution-local-repos.test.ts tests/git-default-branch-resolver.test.ts tests/worktree-create-failure.test.ts tests/worktree-setup-rce-regression.test.ts tests/chat-base-commit.test.ts tests/chat-create-base-commit.test.ts tests/chat-project-attach.test.ts tests/agent-workbench-list-tasks.test.ts tests/agent-workbench-conflicts.test.ts tests/agent-workbench-deep-conflicts.test.ts tests/agent-workbench-deep-conflict-ownership.test.ts
  ```

  Result: **116 pass / 0 fail / 468 expectations / 11 files**, exit **0**.
- `git diff --check`: no output, exit **0**; this historical working-tree
  check is supplemented by the range check in the evidence-head receipts below.
- `bun x openspec validate fix-default-branch-resolution-local-repos --strict --no-interactive`:
  change valid, exit **0**.
- `bun run check:full`: exit **1** in the Codex sandbox.
  Lint, architecture guard, retired-runtime audit (**1,608 scanned / 10
  allowlisted**), and TypeScript all passed. The test phase reported **1,960
  pass / 3 fail / 9,495 expectations / 306 files**; all three failures were in
  `tests/codex-app-server-adapter.test.ts` and all raised
  `CodexAppServerShellSnapshotScrubError` because the sandbox returned `EROFS`
  while scrubbing four files under read-only
  `/home/chen/.codex/shell_snapshots`. No change-owned test failed. The shell
  short-circuited before spec validation, build, and final diff script.
  The original lint receipt did not record `BIOME_CHANGED_SINCE` or
  `DIFF_BASE_SHA`; use the explicit-base lint receipt below for reproducible
  coverage of the implementation diff.
- Required standalone fallback `bun test --isolate tests`: **1,960 pass / 3
  fail / 9,495 expectations / 306 files**, exit **1**, reproducing only the
  same three `EROFS` failures.
- Short-circuited stages were run independently:
  - `bun run spec:validate`: **53 passed / 0 failed**, exit **0**;
  - `bun run build`: main, preload, and renderer production builds passed,
    exit **0**;
  - `bun run diff:check`: exit **0**.

The coordination session, dispatch `impl-default-branch-green`, is the recorded
authority accepting the original `EROFS` outcome as an environment-only
exception, conditional on its independent full-gate rerun. That rerun is green
below; the exception does not waive the full gate or replace Owner `ACCEPTED`.

## Coordination session independent full-gate receipt

- Executor / accepting authority: **coordination session**, dispatch
  `impl-default-branch-green`.
- Time: **2026-09-05 23:4x NZST** (coordination session receipt).
- Exact execution HEAD: `e1f8a7f95a49905aa078879fa873fb7e8500acee`;
  frozen source `7d26fec7579b05d56e5a0ef1e1d66d76a0b91ea6` is byte-identical.
- Environment: non-sandbox session with writable `/home/chen/.codex`.
- Command: `bun run check:full`; exit **0** (`CHECKFULL_EXIT=0`).
- Tests: **1963 pass / 0 fail / 9507 expectations / 306 files**.
- OpenSpec: **53 passed / 0 failed (53 items)**. Architecture guard,
  retired-runtime audit (**1609 scanned / 10 allowlisted**), TypeScript,
  production main/preload/renderer build, and final diff check passed.
- Full log:
  `/home/chen/.claude/projects/-home-chen-projects-agent-code-for-me/f1888632-cd03-49a0-a57d-51704695f29d/handoff/reviews/default-branch-checkfull-e1f8a7f9.log`.
- The aggregate run's lint stage reported `No changed files supported by Biome.`
  on the clean tree; the explicit-base lint receipt below supplies changed-file
  coverage. This receipt resolves P2#3 and task 4.2's original exit-1 gap.
  Adapter-test home isolation remains a separately registered Yellow follow-up
  in [TICKET-124](../../../docs/tickets/TICKET-124-default-branch-guard-cleanup-hermetic-tests.md).

## Reproducible evidence-head audit commands

Codex reran the following on **2026-09-06**, before this documentation edit,
with clean HEAD `e1f8a7f95a49905aa078879fa873fb7e8500acee`:

- `BIOME_CHANGED_SINCE=30451539 bun run lint`: exit **0**;
  `Biome reported diagnostics only outside changed lines; ignoring legacy file diagnostics.`
  This scopes lint to the implementation diff rather than an empty clean-tree
  diff. Fresh reviewers also recorded successful lint against `30451539` and
  `e11f938b`; no original unrecorded environment value is inferred.
- `DIFF_BASE_SHA=30451539 bun run architecture:check`: exit **0**,
  `Architecture guard passed.` at HEAD, which includes `docs/OWNERSHIP_MAP.md`.
- `git diff --check 30451539..HEAD`: no output, exit **0**.
- `git diff --exit-code 7d26fec7..HEAD -- src/ tests/ lint-baseline.json`:
  no output, exit **0**, confirming source, tests, and lint baseline match the
  reviewed frozen source.

Exact pickaxe commands for `refreshDefaultBranch` / remote `set-head`,
branch-delete safeguards, and cleanup deletion mechanics, respectively:

```sh
git diff --exit-code -G 'refreshDefaultBranch|set-head' 30451539..HEAD -- src/main/lib/git/worktree.ts
git diff --exit-code -G 'input\.branch === currentBranch|checkedOutBranches\[input\.branch\]|const deleteFlag|networkGit\.push' 30451539..HEAD -- src/main/lib/git/branches.ts
git diff --exit-code -G 'worktreeBranchPattern|activeBranches\.has|input\.dryRun|git\.branch\(\["-D", branch\]\)' 30451539..HEAD -- src/main/lib/git/branches.ts
```

Each command returned no output, exit **0**. These are reproducible reruns of
the earlier audit summary; the original commands were not preserved there.
The lint ratchet changed only `src/main/lib/git/branches.ts` from 4 to 2 in
`lint-baseline.json` with `7d26fec7`; it was tightened, not waived.

## Policy, ownership, and scope audit

- The sole owner is `src/main/lib/git/default-branch.ts`. A source guard proves
  exactly two resolver calls per consumer file (`branches.ts` and `worktree.ts`,
  four total), one owner definition, and no surviving `getDefaultBranch`
  helper. It does not rule out every name-free inline precedence policy;
  task 2.6 and design Decision 1 now state this measured scope. The currently
  unreferenced `detectBaseBranch` heuristic over `origin/*` and the other
  pre-existing exclusions are inventoried in
  [OWNERSHIP_MAP.md](../../../docs/OWNERSHIP_MAP.md#repository-default-branch-resolution).
  Shape-targeted strengthening, deletion of `detectBaseBranch`, dead
  `refreshDefaultBranch` / `fetchDefaultBranch` / `hasOriginRemote` cleanup,
  and hermetic adapter tests share the single Yellow follow-up
  [TICKET-124](../../../docs/tickets/TICKET-124-default-branch-guard-cleanup-hermetic-tests.md).
- Without configured `origin`, tests prove local `main` > local `master` > an
  attached current branch backed by `refs/heads/*` > honest `main` fallback.
  Provenance distinguishes `local`, `remote`, and `fallback`; cached-only local,
  listing, and cleanup profiles make no network lookup.
- Configured-origin tests preserve the approved branch-listing, orphan-cleanup,
  and worktree/clean-diff matrices and their network budgets.
- A real Git fixture covers a local branch, tag, and stale remote-tracking ref
  with the same `master` name but different commits. Fully qualified local refs
  preserve resolver output, worktree fork metadata, and clean-diff baseline.
- Cleanup protected-set coverage is helper-level (`buildCleanupProtectedBranches`)
  plus the source guard, rather than a route-output assertion of membership.
- `git diff --exit-code 30451539b85547223002c5017131670c1161a64d..HEAD -- src/main/lib/github-workflow/gh-cli.ts src/main/lib/github-workflow/draft-pr-preparation.ts src/main/lib/git/git-operations.ts src/main/lib/chat-base-commit.ts src/main/lib/project-chat-worktree.ts src/main/lib/chat-project-attach.ts src/main/lib/trpc/routers/chats-crud.ts src/main/lib/db/schema`:
  no output, exit **0**. This keeps GitHub-only discovery, remote merge/rebase,
  and stored-data paths byte-identical.
- A positive source assertion confirms explicit `selectedBaseBranch` still
  maps local choices directly and remote choices to `origin/<branch>`.
- `branchType` is honored only alongside an explicit `selectedBaseBranch`;
  auto-resolved bases derive their start ref from resolver provenance. Thus a
  lone `branchType: "local"` no longer forces an origin-backed automatic base
  to the local ref: the local-main-ahead-of-origin fixture changes its fork
  from local `main` to `origin/main`. Current renderer callers cannot produce
  this combination, but private tRPC inputs permit it. This documents the
  Decision 3 edge without restoring the legacy override or reopening the
  branch/tag short-name ambiguity.
- No GitHub workflow policy, remote merge/rebase behavior, branch deletion
  rule, or stored `baseBranch` value was changed.

## Review and remaining stop gates

A fresh-context read-only Codex code review found and drove closure of a Git
branch/tag short-name ambiguity. After remediation, its final report contained
no P0, P1, P2, or P3 findings. This supplemental review is not labeled as or a
substitute for the required fresh-context Claude Code review.

- Task 4.4 fresh-context Claude Code review: **REVIEW_APPROVED**; full ledger
  and documentation dispositions follow.
- Task 4.5 Owner product acceptance: **pending**.

The recorded consumer behavior change beyond the no-origin precedence is the
lone-`branchType` edge in Decision 3. Remaining guard-strength and test-isolation
work is registered separately in TICKET-124; this source SHA is unchanged.
Owner acceptance remains a separate gate.

## 4.4 Fresh-context review

Review date: **2026-09-06 NZST**; workflow `wf_f11b4f62-29f`.
Full review artifact:
`/home/chen/.claude/projects/-home-chen-projects-agent-code-for-me/f1888632-cd03-49a0-a57d-51704695f29d/handoff/reviews/default-branch-fix-review-7d26fec7.md`.

The synthesizer's ledger is reproduced verbatim below (section heading
renumbered). Its line references and evidence-gap statements describe the
pre-disposition evidence head `e1f8a7f9`; the green coordination receipt and
recorded dispositions in this document resolve those documentation/evidence
conditions without changing the review verdict or frozen source.

Reviewer: Claude Code (fresh context, read-only synthesis over five dimension reviews plus adversarial verification). Source SHA under review: `7d26fec7579b05d56e5a0ef1e1d66d76a0b91ea6`; evidence head `e1f8a7f95a49905aa078879fa873fb7e8500acee` (adds only docs/OWNERSHIP_MAP.md, tasks.md, verification.md; product code byte-identical). Red-test baseline: `30451539b85547223002c5017131670c1161a64d`.

**Verdict: REVIEW_APPROVED** (zero P0/P1). Three P2 items require a disposition before Owner `ACCEPTED`; all are docs/evidence touch-ups or a separate follow-up and none requires re-freezing the source SHA.

### Findings

1. **P2 (behavior record)** `createWorktreeForChat` no longer honors a lone `branchType: "local"` for auto-resolved bases on origin-backed repositories: baseline applied `branchType === "local" ? baseBranch : origin/<b>` to auto-detected names too (30451539 worktree.ts:1013-1014, 1027-1028); 7d26fec7 consults `branchType` only under `if (selectedBaseBranch)` (worktree.ts:951-962) and derives the auto start ref from resolver provenance. Reproduced by four verifiers with a live fixture (local main ahead of origin/main: baseCommit = local main before, origin/main after; every other (baseBranch, branchType) cell identical). Unreachable from current renderer callers, permitted by the private tRPC inputs (chats-crud.ts:112-113, 260-261), no spec scenario unmet, no test weakened, and the coherent reading of Decision 3 — but design.md:145-146 ("the no-origin profile is the one intentional behavior change") and verification.md:128 ("no design deviations") claim a preservation that a probe contradicts. Disposition: one sentence in design.md Decision 3 and verification.md stating `branchType` is honored only alongside an explicit `selectedBaseBranch`. Do not restore the legacy override (it would reopen the short-name branch/tag ambiguity). Verifier votes P2/P2/P2/P3.
2. **P2 (guard scope)** The task-2.6 guard (tests/git-default-branch-resolver.test.ts:454-480) and red test 12 prove helper-name deletion, exactly two resolver calls per consumer, and one definition owner — not absence of a second precedence policy (an appended name-free inline main>master>current closure passes every assertion, reproduced by both verifiers). worktree.ts:606-620 still carries dead `detectBaseBranch` with `[defaultBranch, "main", "master", "develop", "development"]` (pre-existing, zero callers, base detection over origin/* rather than default resolution, inventoried nowhere). spec.md:10-11 is satisfied in the delivered code and verification.md:94-96 scopes the guard honestly. Disposition: Owner nod to delete `detectBaseBranch` in a separate Green change or list it in OWNERSHIP_MAP Adjacent exclusions (docs-only), then add a shape-targeted guard assertion (the deleted `["main","master","develop","trunk"]` loop / candidate arrays absent from consumer files with a narrow allowlist), or soften tasks.md 2.6 to what the guard proves. Verifier votes P2/P2.
3. **P2 (evidence gap)** No green exact-SHA `bun run check:full` receipt exists: verification.md:71 records exit 1 and :80-82 the fallback full suite also exit 1 (1,960/3, EROFS in the unrelated tests/codex-app-server-adapter.test.ts under read-only ~/.codex/shell_snapshots); the cited "environment case named by the task instructions" (:89-90) has no in-repo referent; tasks.md:65-67 ticks 4.2 bare. Honest disclosure, not a gate lie; failing suite is not change-owned and passes 47/0 with a writable ~/.codex; all short-circuited stages re-run green individually. Disposition: append a green `bun run check:full` (minimum: fully green `bun test --isolate tests`) receipt at e1f8a7f9 with counts and exit code, record the accepting authority in-repo, annotate task 4.2 with the exit-1 outcome. Follow-up (separate): make the adapter tests hermetic via a temporary CODEX_HOME/HOME. Verifier votes P2/P2.
4. **P3** docs/OWNERSHIP_MAP.md section landed in e1f8a7f9, not in the frozen source SHA; architecture guard passed at HEAD with DIFF_BASE_SHA=30451539. Record e1f8a7f9 as the acceptance SHA.
5. **P3** `refreshDefaultBranch` / `fetchDefaultBranch` / `hasOriginRemote` are dead (pre-existing) yet named as an adjacent owner; follow-up knip pass.
6. **P3** Pre-existing `|| "main"` fallbacks and name-list heuristics outside the documented boundary (file-contents.ts:80, chats-pr.ts:75, status.ts:35, changes-widget.tsx:309-312, sub-chat-status-card.tsx:82, createWorktree default `origin/main`); add to Adjacent exclusions or follow-up.
7. **P3** worktree.ts consumers pass bare `simpleGit` to the resolver, so the retained worktree-profile `ls-remote` fallback ignores the caller's signal/timeout (identical to the deleted helper; not reached on the no-origin path).
8. **P3** Attached-HEAD rule evaluated in the linked chat worktree yields the chat's own branch for no-origin repos lacking main/master (spec-consistent; Owner awareness; optional follow-up spec delta).
9. **P3** Degenerate no-origin repos drop the legacy develop/trunk/first-branch candidates in favor of honest `main` fallback (approved scenario; record in Owner acceptance).
10. **P3** Rollback recipe must revert e1f8a7f9 + 7d26fec7 + 30451539 together (reverting the implementation alone leaves 12 RED tests).
11. **P3** Ledger precision: record `BIOME_CHANGED_SINCE=<base>` with the lint receipt (vacuous otherwise on a clean tree; re-runs vs 30451539 and e11f938b exit 0), the exact pickaxe commands, and the range form of `git diff --check`.
12. **P3** Test touch-ups: guard uses cwd-relative paths (house convention; red suite uses `import.meta.dir`); cleanup protected-set proof is helper-level plus source-guard rather than route-level; branch-listing input is re-normalized redundantly (pathological ref layouts only).

### Test-first pilot attestations

- Red test file `tests/default-branch-resolution-local-repos.test.ts` zero-diff vs 30451539b85547223002c5017131670c1161a64d: **yes** (blob 94c8af738645c191758cc941046922fd7c478b25 identical at 30451539, 7d26fec7, e1f8a7f9; `red-receipt.md` zero-diff, `git diff --exit-code` 0).
- New tests weakened: **no** (tests/git-default-branch-resolver.test.ts has no .skip/.only/.todo/skipIf/conditional/try-catch patterns; red suite untouched; implementation contains no teach-to-the-test patterns).
- Counts: red suite 4 pass / 12 fail at 30451539 (independently reproduced via git archive) -> **16 pass / 0 fail / 91 expect** at HEAD; implementer suite **19 pass / 0 fail / 66 expect**; combined `bun test --isolate` **35 pass / 0 fail / 157 expect**, exit 0; recorded 11-file task-4.1 command 116 pass / 0 fail. lint-baseline.json `src/main/lib/git/branches.ts` 4 -> 2 (ratchet tightened; measured at both SHAs).
- Ownership: one owner `src/main/lib/git/default-branch.ts`, exactly four `resolveDefaultBranch(` call sites (branches.ts:51, :228; worktree.ts:955, :1172), zero `getDefaultBranch` occurrences in src/.

### Consumer impact

No public, shared, renderer, preload, Local Job API, ACP, schema, migration, dependency, or versioned contract surface changed. The private tRPC `changes.getBranches` output keeps `defaultBranch: string`; only its value is corrected for no-origin repositories (local main > master > attached HEAD backed by refs/heads > honest `main` fallback), auto-detected local results are consumed as `refs/heads/<name>` for worktree start and clean-diff baseline, explicit `selectedBaseBranch`/`branchType` and `onlyUncommitted` gates are preserved, configured-origin profiles are behavior-preserving except the recorded lone-`branchType` edge (finding 1), and no network work is added to any path. Non-goal files (gh-cli.ts, git-operations.ts, chat-base-commit.ts, project-chat-worktree.ts, chat-project-attach.ts, chats-crud.ts, db/schema, agent-workbench/, renderer/) are byte-identical across the range.

Not re-run per the review brief: `bun run check:full`, `bun run build`, full-suite counts. This is a technical verdict for the named SHA only; it does not replace Owner product acceptance and authorizes no local integration, push, remote PR mutation, merge, archive, release, or repository-rule change.

## Recorded review dispositions

These are documentation dispositions from the coordination session's dispatch;
none changes source/tests or records Owner product acceptance.

| Finding | Recorded disposition |
| --- | --- |
| P2#1 | [Design Decision 3](design.md#decision-3-the-internal-result-carries-ref-provenance) and the policy audit above record explicit-pair-only `branchType` semantics and resolver provenance for automatic bases. Decision 4 and the stop-gate summary qualify the earlier blanket preservation claims. The legacy override stays removed. |
| P2#2 | [OWNERSHIP_MAP adjacent exclusions](../../../docs/OWNERSHIP_MAP.md#repository-default-branch-resolution) inventories dead `detectBaseBranch`; [task 2.6](tasks.md#2-canonical-resolver-and-atomic-migration) and design Decision 1 state the actual guard proof. Shape-targeted strengthening and helper removal are registered in [TICKET-124](../../../docs/tickets/TICKET-124-default-branch-guard-cleanup-hermetic-tests.md). |
| P2#3 | The coordination session's independent full gate at `e1f8a7f9` is exit 0, 1963 pass / 0 fail, OpenSpec 53 passed / 0 failed; the execution time, log path, and accepting dispatch `impl-default-branch-green` are recorded above, and task 4.2 records both outcomes. Adapter-test isolation joins TICKET-124. |
| P3#4 | Acceptance/review evidence SHA is `e1f8a7f9` (source `7d26fec7` + docs); the evidence-head architecture command and passing output are recorded above. |
| P3#5 | The ownership map labels the existing dead helpers; `refreshDefaultBranch` / `fetchDefaultBranch` / `hasOriginRemote` cleanup and a caller/knip recheck join TICKET-124. |
| P3#6 | The ownership map inventories the existing file-contents, chats-pr, status, renderer, and low-level createWorktree fallback exclusions. |
| P3#7 | No change required for this SHA: the pre-existing bare-simpleGit signal/timeout gap is preserved within the worktree profile, and the no-origin path never reaches the network fallback. |
| P3#8 | Linked-worktree attached-HEAD behavior is disclosed in Owner acceptance notes below. |
| P3#9 | Degenerate-repository candidate narrowing is disclosed in Owner acceptance notes below. |
| P3#10 | This ledger and design Migration Plan define rollback as the complete pilot commit group, including the RED tests and the implementation's lint baseline. |
| P3#11 | Explicit-base lint, exact pickaxe commands, and the range whitespace check are recorded in the reproducible evidence-head receipts above. |
| P3#12 | The policy audit clarifies helper-level cleanup coverage plus the source guard; tests remain unchanged. |

## Owner acceptance notes

- **P3#8 — linked-worktree attached HEAD:** when a no-origin repository has
  neither local `main` nor `master`, rule 3 resolves HEAD in the caller's linked
  worktree. Its chat branch can therefore become `defaultBranch`; a legacy row
  with no explicit base can receive an empty clean diff against that branch.
  This is consistent with the approved attached-HEAD scenario. Resolving HEAD
  in the main worktree instead would require a separate Owner decision and
  spec delta; this SHA retains the caller-worktree rule.
- **P3#9 — degenerate repositories:** without local `main`/`master` or a usable
  attached HEAD, the resolver deliberately drops legacy `develop`, `trunk`,
  and first-local-branch candidates and returns honest fallback `main`.
  For example, a detached no-origin repository containing only `develop` can
  fall back to project-directory mode when worktree creation cannot resolve
  `main`. This is the approved degenerate-repository scenario.

Task **4.5 remains pending explicit Owner `ACCEPTED`**. The technical verdicts
bind source `7d26fec7` with review/acceptance evidence at `e1f8a7f9`; this later
documentation-only disposition records their evidence and follow-up boundaries.
It does not authorize integration, archive, push, remote PR mutation/merge,
release, or repository-rule changes.

## Documentation disposition checks (2026-09-06)

Parent HEAD is `e1f8a7f95a49905aa078879fa873fb7e8500acee`; this follow-up changes
only `design.md`, `tasks.md`, this ledger, `docs/OWNERSHIP_MAP.md`, and the new
Yellow TICKET-124. Source, tests, and `lint-baseline.json` remain frozen.

- `bun x openspec validate fix-default-branch-resolution-local-repos --strict --no-interactive`:
  `Change 'fix-default-branch-resolution-local-repos' is valid`, exit **0**.
- `git diff --check`: no output, exit **0**.
