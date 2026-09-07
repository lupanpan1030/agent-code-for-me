# Tasks: fix-default-branch-resolution-local-repos

## 1. Governance and baseline

- [x] 1.1 Obtain explicit Owner `APPROVED` for the R2 proposal before changing
      product code.
- [x] 1.2 Confirm the implementation branch/worktree, exact base SHA, clean
      baseline, relevant living specs, canonical owner, four direct call sites,
      and active-change overlap.
- [x] 1.3 Record the no-public-consumer-impact decision, no-migration posture,
      explicit non-goals, rollback, and local/remote observation budgets.

## 2. Canonical resolver and atomic migration

- [x] 2.1 Add the sole main-process default-branch owner at
      `src/main/lib/git/default-branch.ts`, with explicit observation budget and
      local/remote/fallback result provenance.
- [x] 2.2 Implement no-origin precedence as existing local `main`, otherwise
      existing local `master`, otherwise attached current `HEAD`; retain the
      documented degenerate compatibility fallback without claiming it is an
      existing ref.
- [x] 2.3 Characterize and preserve the three remote observation profiles from
      `design.md`—branch listing, orphan cleanup, and worktree/clean diff—and
      prove the local-only path performs no network work.
- [x] 2.4 Atomically migrate `changes.getBranches`,
      `cleanupOrphanedBranches`, `createWorktreeForChat`, and
      `getWorktreeDiff`; delete both previous `getDefaultBranch` helpers in the
      same change.
- [x] 2.5 Preserve explicit branch overrides and ensure an auto-detected local
      branch is used as a local worktree start ref while the private tRPC output
      remains `defaultBranch: string`.
- [x] 2.6 Add the canonical owner and consumer rule to
      `docs/OWNERSHIP_MAP.md`, plus a focused guard/source audit proving both
      legacy helper definitions are deleted, each consumer file has exactly
      two resolver calls (four total), and the resolver has one definition
      owner. Broader shape-targeted guard coverage, dead-helper cleanup, and
      hermetic adapter tests are registered as the separate Yellow follow-up
      [TICKET-124](../../../docs/tickets/TICKET-124-default-branch-guard-cleanup-hermetic-tests.md).

## 3. Regression coverage

- [x] 3.1 Add resolver tests proving `main` wins over `master` and current,
      `master` wins when `main` is absent, and attached current `HEAD` wins only
      when neither known local name exists.
- [x] 3.2 Cover detached/unborn compatibility fallback, configured-origin
      classification, the exact remote compatibility matrix in `design.md`,
      and cached-only paths that must not invoke network lookup.
- [x] 3.3 Cover all four consumers: renderer-facing branch output, protected
      cleanup default, local auto-detected worktree start/fork metadata, and
      clean-worktree diff baseline; preserve explicit overrides and
      `onlyUncommitted` early-return behavior.
- [x] 3.4 Add a no-origin fixture initialized with
      `git init --quiet -b master`; source both Workspace `baseBranch` values
      from the canonical resolver, create divergent committed heads from one
      fork, and leave no status-visible overlap.
- [x] 3.5 Prove the fixture remains deep-check eligible, backfills the same fork
      commit, reports hunk reason `head-commits-differ` rather than
      `base-commit-missing`, and reaches a merge trial labeled
      `committed-changes-only`.
- [x] 3.6 Prove GitHub-only default-branch discovery, explicit `origin/HEAD`
      refresh, remote merge/rebase, branch deletion rules, and existing
      explicit stored `baseBranch` values are not changed by this
      implementation.

## 4. Verification, review, and stop gate

- [x] 4.1 Run focused resolver, Git branches/worktree, chat base-commit, and
      Agent Workbench tests, including the no-origin `master` regression.
- [x] 4.2 Run `git diff --check`,
      `bun x openspec validate fix-default-branch-resolution-local-repos --strict --no-interactive`,
      and `bun run check:full`: Codex 沙箱 exit 1（EROFS）→ 统筹独立复跑 exit 0
      at `e1f8a7f9` (coordination session, dispatch `impl-default-branch-green`;
      receipt and acceptance authority recorded in `verification.md`).
- [x] 4.3 Freeze the implementation source SHA and record exact commands,
      counts, exit codes, and Codex `IMPLEMENTATION_VERIFIED` in
      `verification.md`.
- [x] 4.4 Obtain fresh-context, read-only Claude Code review on that same exact
      source SHA and record `REVIEW_APPROVED` with all findings in
      `verification.md` §4.4: zero P0/P1, three P2 dispositions recorded, nine
      P3 notes retained; evidence/acceptance SHA `e1f8a7f9`, source `7d26fec7`.
- [x] 4.5 Obtain explicit Owner `ACCEPTED` on 2026-09-07 for evidence
      `88bb8029`, frozen source `7d26fec7`, including both Owner acceptance
      notes; see verification.md §4.5. The coordination dispatch separately
      authorizes this slice’s local merge, gates, archive, and one main push.
