# Verification

- Change ID: `fix-default-branch-resolution-local-repos`
- Risk: R2 repository default-branch policy and four-consumer atomic migration
- Owner implementation approval: **APPROVED 2026-09-05**
- Base SHA: `30451539b85547223002c5017131670c1161a64d`
- Branch: `codex/fix-default-branch-resolution-local-repos`
- Worktree: `/home/chen/projects/locus-fix-ci-default-branch-fixture`
- Frozen implementation source SHA:
  `7d26fec7579b05d56e5a0ef1e1d66d76a0b91ea6`
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
- Rollback is the local revert of implementation commit
  `7d26fec7579b05d56e5a0ef1e1d66d76a0b91ea6`; no remote state or data migration
  needs reversal.
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
- `git diff --check`: no output, exit **0**.
- `bun x openspec validate fix-default-branch-resolution-local-repos --strict --no-interactive`:
  change valid, exit **0**.
- `bun run check:full`: exit **1** for the documented sandbox-only exception.
  Lint, architecture guard, retired-runtime audit (**1,608 scanned / 10
  allowlisted**), and TypeScript all passed. The test phase reported **1,960
  pass / 3 fail / 9,495 expectations / 306 files**; all three failures were in
  `tests/codex-app-server-adapter.test.ts` and all raised
  `CodexAppServerShellSnapshotScrubError` because the sandbox returned `EROFS`
  while scrubbing four files under read-only
  `/home/chen/.codex/shell_snapshots`. No change-owned test failed. The shell
  short-circuited before spec validation, build, and final diff script.
- Required standalone fallback `bun test --isolate tests`: **1,960 pass / 3
  fail / 9,495 expectations / 306 files**, exit **1**, reproducing only the
  same three `EROFS` failures.
- Short-circuited stages were run independently:
  - `bun run spec:validate`: **53 passed / 0 failed**, exit **0**;
  - `bun run build`: main, preload, and renderer production builds passed,
    exit **0**;
  - `bun run diff:check`: exit **0**.

The accepted `check:full` exception is exactly the environment case named by
the task instructions; the focused and change-owned suites are fully green.

## Policy, ownership, and scope audit

- The sole owner is `src/main/lib/git/default-branch.ts`. A source guard proves
  exactly four resolver calls across `branches.ts` and `worktree.ts`, one owner
  definition, and no surviving `getDefaultBranch` helper.
- Without configured `origin`, tests prove local `main` > local `master` > an
  attached current branch backed by `refs/heads/*` > honest `main` fallback.
  Provenance distinguishes `local`, `remote`, and `fallback`; cached-only local,
  listing, and cleanup profiles make no network lookup.
- Configured-origin tests preserve the approved branch-listing, orphan-cleanup,
  and worktree/clean-diff matrices and their network budgets.
- A real Git fixture covers a local branch, tag, and stale remote-tracking ref
  with the same `master` name but different commits. Fully qualified local refs
  preserve resolver output, worktree fork metadata, and clean-diff baseline.
- Cleanup coverage proves the resolver-selected local `master` is in the
  protected set.
- `git diff --exit-code 30451539b85547223002c5017131670c1161a64d..HEAD -- src/main/lib/github-workflow/gh-cli.ts src/main/lib/github-workflow/draft-pr-preparation.ts src/main/lib/git/git-operations.ts src/main/lib/chat-base-commit.ts src/main/lib/project-chat-worktree.ts src/main/lib/chat-project-attach.ts src/main/lib/trpc/routers/chats-crud.ts src/main/lib/db/schema`:
  no output, exit **0**. This keeps GitHub-only discovery, remote merge/rebase,
  and stored-data paths byte-identical.
- Pickaxe audits for `refreshDefaultBranch` / remote `set-head`, branch-delete
  safeguards, and cleanup deletion mechanics each returned no diff, exit **0**.
  A positive source assertion confirms explicit `selectedBaseBranch` still
  maps local choices directly and remote choices to `origin/<branch>`.
- No GitHub workflow policy, remote merge/rebase behavior, branch deletion
  rule, or stored `baseBranch` value was changed.

## Review and remaining stop gates

A fresh-context read-only Codex code review found and drove closure of a Git
branch/tag short-name ambiguity. After remediation, its final report contained
no P0, P1, P2, or P3 findings. This supplemental review is not labeled as or a
substitute for the required fresh-context Claude Code review.

- Task 4.4 fresh-context Claude Code review: **pending**.
- Task 4.5 Owner product acceptance: **pending**.

There are no design deviations or implementation TODOs. The two pending
governance gates authorize no integration or remote action.
