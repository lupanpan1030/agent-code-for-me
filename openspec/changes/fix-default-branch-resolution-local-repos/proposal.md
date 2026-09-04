# Change: Resolve default branches for local-only repositories

> Status: **DRAFT — 待 Owner APPROVED**. This change is proposal-only; it does
> not authorize product-code implementation, integration, push, or release.

## Why

Locus currently has two main-process default-branch helpers with different
fallback policies. The private helper in `src/main/lib/git/branches.ts` only
inspects `origin/HEAD` and cached remote `main`/`master` names before falling
back to `main`. In a repository with no `origin`, that fallback can name a ref
that does not exist. The exported helper in `src/main/lib/git/worktree.ts`
handles local repositories, but it prefers the current branch before known
local default names. The same repository can therefore receive different
answers depending on which product path asks.

For a local-only repository initialized on `master`, the wrong `main` answer can
flow into Workspace `baseBranch` metadata. Lazy fork-commit recovery then tries
`merge-base HEAD main`, leaves `baseCommit` null, and makes the Agent Workbench
deep check report `base-commit-missing` instead of reaching the committed-tree
trial and honestly reporting divergent heads.

## What Changes

- Establish one main-process default-branch resolver under
  `src/main/lib/git/` as the canonical owner of branch selection policy.
- For a repository without a configured `origin`, resolve an existing local
  `main`, otherwise an existing local `master`, otherwise the attached current
  `HEAD` branch.
- Return enough internal provenance to distinguish a local ref from a remote
  ref or compatibility fallback, so an auto-detected local branch is not
  rewritten as `origin/<branch>` by a consumer.
- Atomically migrate all four direct call sites and delete both existing helper
  implementations; no old/new dual path is allowed.
- Preserve each call site's existing Git/network budget. In particular,
  `changes.getBranches` and orphan cleanup remain cached/local operations and
  do not gain an implicit network request.
- Characterize and preserve remote-backed default-branch behavior; the new
  local precedence applies only when no `origin` remote is configured. The
  exact per-consumer compatibility matrix is fixed in `design.md`.
- Add a regression proving that two committed-only Workspaces created from a
  no-origin `master` repository remain annotation-free on listing but can run
  the explicit deep check, backfill the shared fork commit, report
  `head-commits-differ` for hunk comparison, and reach the committed-tree trial.

## Canonical Owner And Single-Path Statement

- Proposed canonical owner: `src/main/lib/git/default-branch.ts`, exporting the
  sole main-process `resolveDefaultBranch` policy.
- Git fact collection may be bounded by an explicit cached-only or
  network-allowed observation mode, but precedence and result provenance live
  in the canonical owner.
- The private `getDefaultBranch` in `src/main/lib/git/branches.ts` and the
  exported `getDefaultBranch` in `src/main/lib/git/worktree.ts` are removed in
  the same implementation change that migrates their four direct callers.
- Routes, worktree helpers, renderer code, and Agent Workbench code must not
  retain or introduce another `main`/`master`/current-branch fallback policy.

## Direct Call Sites And Behavioral Impact

| Direct consumer | Current use | Intended impact |
| --- | --- | --- |
| `src/main/lib/git/branches.ts` — `changes.getBranches` | Produces the private tRPC `defaultBranch` string | No-origin repositories expose the real local default. This corrects default marking, sorting, and initial selection in `new-chat-form.tsx` and `create-branch-dialog.tsx`; it also corrects the comparison-branch argument supplied by `changes-view.tsx` and default-branch presentation in `diff-sidebar-header.tsx`. The existing status implementation remains remote-comparison-oriented, so this change does not add local committed-status counts. The response shape and network budget do not change. |
| `src/main/lib/git/branches.ts` — `cleanupOrphanedBranches` | Adds the inferred default branch to the protected branch set | The real no-origin local default is protected instead of a phantom `main`. Existing active/current protection, generated-branch filtering, and deletion rules remain unchanged. |
| `src/main/lib/git/worktree.ts` — `createWorktreeForChat` | Chooses an omitted base branch and persists the resulting `baseBranch`/`baseCommit` | Auto-detected no-origin Workspaces start from the selected local ref and retain the correct fork metadata. Explicit user-selected local/remote branches remain authoritative. Failure fallback to project-directory mode is otherwise unchanged. |
| `src/main/lib/git/worktree.ts` — `getWorktreeDiff` | Chooses a baseline only for a clean worktree when no base branch was supplied | A clean no-origin worktree compares with its resolved local branch. Explicit `baseBranch`, dirty-worktree behavior, and the `onlyUncommitted` early return remain unchanged. |

The renderer files `info-section.tsx` and `active-chat.tsx` also query
`changes.getBranches`, but currently consume only `current`; they receive no
default-branch behavior change. `chat-base-commit.ts` is an indirect consumer of
persisted `baseBranch`, not a resolver caller, and remains the canonical owner
of write-once fork-commit backfill.

## Explicit Non-Goals

- Do not change `resolveGitDefaultBranch` in
  `src/main/lib/github-workflow/gh-cli.ts` or its GitHub pull-request callers;
  that helper is scoped to GitHub-origin workflow discovery.
- Do not change `mergeFromDefault` in
  `src/main/lib/git/git-operations.ts`, including its fetch, merge, rebase, or
  remote-ref policy.
- Do not change `refreshDefaultBranch` in
  `src/main/lib/git/worktree.ts`; its explicit `origin` synchronization remains
  separate from repository default selection.
- Do not redesign remote default-branch precedence, add remotes, fetch, push,
  merge, rebase, or make a cached/local route network-capable.
- Do not change Agent Workbench conflict classification, merge-tree semantics,
  timeout budgets, or renderer presentation.
- Do not change the private tRPC response shape, database schema, Local Job API,
  CLI, daemon, ACP, public events, error codes, or versioned contracts.
- Do not repair previously persisted incorrect `baseBranch` values. Existing
  rows with an explicit value continue to use it and may require Workspace
  recreation; this proposal prevents new incorrect inference.
- Do not broaden branch cleanup candidates or deletion authority.

## Risk Classification

**R2.** This is a bounded internal correctness change, but the resolver is
shared across four main-process call sites that affect branch presentation,
branch-cleanup protection, Workspace creation and persisted fork metadata, and
clean-worktree diff baselines. A wrong answer can therefore make a Workspace
fall back to project-directory mode or degrade later conflict evidence. The
change remains below R3 because it adds no external authority, dependency,
schema migration, public/versioned contract, remote write, or command-permission
change, and its local-only precedence is covered by deterministic Git fixtures.

## Consumer And Data Impact

- **Public Consumer Impact: none.** No public/versioned consumer surface or
  payload changes, so `docs/consumer-impact-template.zh-CN.md` is not required
  for this draft.
- The private renderer-facing `changes.getBranches.defaultBranch` field keeps
  the same `string` shape; its value is intentionally corrected for no-origin
  repositories.
- Internal Workspace consumers may persist a different, correct `baseBranch`
  and `baseCommit` for newly created local-only Workspaces.
- Database/schema migration: none.
- Existing data repair: none; explicit stored values are not silently rewritten.
- Rollback: revert the future implementation commit. No persisted
  transformation or compatibility cleanup is required.

## Impact

- Affected specs: new capability `git-default-branch-resolution`; existing
  `cross-workspace-conflicts` behavior is exercised but not changed.
- Expected implementation files:
  `src/main/lib/git/default-branch.ts`, `src/main/lib/git/branches.ts`,
  `src/main/lib/git/worktree.ts`, and `docs/OWNERSHIP_MAP.md`.
- Expected tests: focused resolver/call-site tests plus
  `tests/agent-workbench-list-tasks.test.ts` for the no-origin `master`
  integration regression.
- Active-change overlap: none at draft time (`openspec list` reports no active
  changes).

## Approval And Integration Gate

- Required before implementation: explicit Owner `APPROVED` for this R2 scope.
- Required before Owner acceptance: targeted tests, exact-SHA
  `bun run check:full`, strict OpenSpec validation, Codex
  `IMPLEMENTATION_VERIFIED`, and fresh-context Claude Code
  `REVIEW_APPROVED` on the same source SHA with no unresolved P0/P1 findings.
- Local integration into `main`, push, remote PR mutation, remote merge,
  release, and repository-rule changes remain unauthorized until separately
  approved.
