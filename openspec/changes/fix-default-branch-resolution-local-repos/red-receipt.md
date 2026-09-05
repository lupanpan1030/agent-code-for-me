# RED receipt: test-first pilot for `fix-default-branch-resolution-local-repos`

- Base SHA (implementation absent): `e11f938b417ada60eab53a5995c460f528a7a8b1`
  (`main` `d923119c` + this change's OpenSpec documents only).
- Test file: `tests/default-branch-resolution-local-repos.test.ts`.
- Author role: fresh-context test author (not the implementer). Tests were
  derived only from `proposal.md`, `design.md`, `tasks.md`, and
  `specs/git-default-branch-resolution/spec.md`; no implementation code was
  written or assumed beyond the module path and export name that the proposal
  names explicitly.
- Command: `bun test --isolate tests/default-branch-resolution-local-repos.test.ts`
- Result on base SHA: **12 fail / 4 pass, 16 tests, exit code 1**.
- Neighbor check on base SHA:
  `bun test --isolate tests/agent-workbench-list-tasks.test.ts tests/chat-base-commit.test.ts`
  -> **22 pass / 0 fail, exit code 0** (unchanged).
- Lint: `bun x biome check tests/default-branch-resolution-local-repos.test.ts`
  -> clean.

Fixture rules honored by every test: repositories are created with
`git init --quiet -b <branch>` (never relying on host `init.defaultBranch`),
no-origin fixtures assert `git remote` is empty, and no test uses `skip`,
`todo`, or conditional relaxation of the spec expectation.

## RED tests (12) — behavior failures on the base SHA

| # | Test | Spec scenario | Entry point | Failing assertion on base SHA |
| --- | --- | --- | --- | --- |
| 1 | branch listing consumer > no-origin master repository lists master as its default branch and cleanup keeps it | Local master wins when main is absent; Branch listing and cleanup agree on a local default | tRPC `changes.getBranches` (+ `cleanupOrphanedBranches` dry run) | `defaultBranch` expected `"master"`, received `"main"` (phantom ref; no local `main` exists) |
| 2 | branch listing consumer > attached HEAD is listed as the default when neither main nor master exists | Attached HEAD is the last usable local branch | tRPC `changes.getBranches` | `defaultBranch` expected `"feature/topic"`, received `"main"` |
| 3 | Workspace creation consumer > auto-detected Workspace starts from local master and retains its fork commit | Auto-detected local Workspace retains its fork; No-origin master Workspace retains a recoverable base | `createWorktreeForChat` with no explicit base (repo on `master`, `feature` checked out) | `baseBranch` expected `"master"`, received `"feature"` (checked-out branch displaces local `master`) |
| 4 | Workspace creation consumer > local main wins over master and the checked-out branch for auto-detected Workspaces | Local main wins independently of checkout state | `createWorktreeForChat` with no explicit base (local `main` + `master`, `feature` checked out) | `baseBranch` expected `"main"`, received `"feature"` |
| 5 | Workspace creation consumer > attached HEAD becomes the Workspace base when neither main nor master exists | Attached HEAD is the last usable local branch (creation + listing must agree) | `createWorktreeForChat` then `changes.getBranches` | creation returns `"trunk"` on the base SHA (current branch coincides), but listing `defaultBranch` expected `"trunk"`, received `"main"` — the two consumers disagree on the same repository |
| 6 | clean-worktree diff consumer > clean linked worktree diffs against local master when no base is supplied | Consumers preserve local Workspace evidence (clean-diff baseline) | `getWorktreeDiff(worktreePath)` on a clean linked worktree | diff expected to contain `diff --git a/src/shared.ts ...`, received `""` (baseline resolved to the worktree's own branch, so the diff is empty) |
| 7 | clean-worktree diff consumer > clean linked worktree diffs against local main rather than master or its own branch | Local main wins independently of checkout state (diff consumer) | `getWorktreeDiff(worktreePath)` | diff expected to contain `diff --git a/src/workspace.ts ...`, received `""` |
| 8 | CI event > lazy fork-commit backfill resolves merge-base against the listed local default | No-origin master Workspace retains a recoverable base (fork metadata absent) | `changes.getBranches.defaultBranch` -> stored `baseBranch` -> `ensureChatBaseCommit` | backfill expected the `master` fork SHA, received `null` (`merge-base HEAD main` fails because the stored `baseBranch` was the phantom `main`) |
| 9 | CI event > deep check on committed-only no-origin master Workspaces reaches head-commits-differ | No-origin master Workspace retains a recoverable base; design Decision 6 acceptance | Agent Workbench `listTasks` + `checkConflicts` | `hunkCheck.reason` expected `"head-commits-differ"`, received `"base-commit-missing"` — the exact CI symptom |
| 10 | CI event > Workspaces auto-created from a no-origin master repository keep fork metadata through the deep check | No-origin master Workspace retains a recoverable base (successful creation retains the fork commit) | `createWorktreeForChat` x2 (no explicit base) -> `checkConflicts` | first created Workspace `baseBranch` expected `"master"`, received `"feature"` |
| 11 | canonical owner contract > a single main-process resolver module owns default-branch policy | Canonical Repository Default Branch Resolution (one owner) | `import("../src/main/lib/git/default-branch")` | `Cannot find module '../src/main/lib/git/default-branch'` |
| 12 | canonical owner contract > the two legacy getDefaultBranch helpers are deleted from their consumers | Routes and Git helpers SHALL NOT implement a second precedence policy; both helpers removed atomically | source audit of `branches.ts` and `worktree.ts` | `{branchesDefinesGetDefaultBranch: true, worktreeDefinesGetDefaultBranch: true}`, expected both `false` |

Notes on distinguishing power:

- Tests 1-10 are RED because of real product behavior (wrong branch, empty
  diff, `null` backfill, `base-commit-missing`), not because a module is
  missing. Tests 11-12 are the only contract/guard tests; they only assert the
  module path and export name the proposal fixes, plus deletion of the two
  legacy helpers. The resolver's call signature and observation-profile names
  are implementation details and are intentionally not asserted.
- In test 5 the creation half passes on the base SHA (the worktree helper's
  "current branch first" policy coincides with `trunk`); the RED evidence
  comes from the listing route disagreeing (`main`). The test keeps both halves
  because the scenario requires the consumers to agree.
- The cleanup half of test 1 (`cleanupOrphanedBranches`) is a route sanity
  check only: protected-set membership of `master` is not observable through
  the route because the generated-name filter never matches `master`. The
  proof that cleanup consumes the canonical result is left to the
  implementer's focused resolver/consumer test (tasks 3.3), and the review
  should confirm it exists.

## Characterization tests (4) — GREEN on the base SHA by design

These encode spec scenarios that the change explicitly preserves. They pass
before the implementation and must still pass after it; they are not RED
evidence and were not weakened to pass.

| # | Test | Spec scenario | Why GREEN on base |
| --- | --- | --- | --- |
| 13 | preserved behavior > configured origin keeps origin/HEAD precedence over local main and master | Configured origin preserves each consumer profile | existing helpers already prefer cached `origin/HEAD` (`develop`) for listing and worktree creation |
| 14 | preserved behavior > configured origin without cached remote facts does not fall into local precedence | Configured origin preserves each consumer profile (last AND clause) | listing already returns the compatibility `main` when `origin` is configured but no remote refs are cached, even though local `master` exists |
| 15 | preserved behavior > degenerate detached no-origin repository keeps the compatibility fallback | Degenerate local repository retains an honest fallback | listing already returns `main` for a detached repository with no local branches; the provenance half ("not an existing local ref") is resolver-internal and is left to the implementer's unit test (tasks 3.2) |
| 16 | preserved behavior > explicit base branch and uncommitted-only diff gates stay authoritative | Explicit branch and diff gates remain authoritative | explicit `baseBranch`, `onlyUncommitted` early return, and explicit `selectedBaseBranch` + `branchType: "local"` are unchanged paths |

## Scenario coverage map

| Spec scenario | Tests |
| --- | --- |
| Local main wins independently of checkout state | 4, 7 |
| Local master wins when main is absent | 1, 3, 6, 8, 9, 10 |
| Attached HEAD is the last usable local branch | 2, 5 |
| Degenerate local repository retains an honest fallback | 15 (characterization; provenance left to resolver unit test) |
| Configured origin preserves each consumer profile | 13, 14 (characterization) |
| Branch listing and cleanup agree on a local default | 1 |
| Auto-detected local Workspace retains its fork | 3, 10 |
| Explicit branch and diff gates remain authoritative | 16 (characterization) |
| No-origin master Workspace retains a recoverable base | 3, 8, 9, 10 |
| Canonical owner / no second precedence policy | 11, 12 |

## Expected GREEN condition

After the implementation lands, the same command must report 16 pass / 0 fail
without any edit to the assertions in this file. Review should diff this file
against the frozen implementation SHA and reject any weakening of the
expectations listed above.
