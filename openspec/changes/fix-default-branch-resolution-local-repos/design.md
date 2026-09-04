## Context

Default-branch selection is currently split between two main-process helpers:

- `src/main/lib/git/branches.ts:getDefaultBranch` serves branch listing and
  orphan cleanup. It checks cached `origin/HEAD`, recognizes cached `master`
  only when cached `main` is absent, and otherwise returns `main`. With no
  remote refs, it therefore always returns `main` without checking local refs.
- `src/main/lib/git/worktree.ts:getDefaultBranch` serves Workspace creation and
  clean-worktree diff fallback. For repositories with an `origin`, it checks
  cached remote facts and may use `ls-remote`; without an `origin`, it checks
  the attached current branch before common local branch names and then the
  first local branch.

These policies disagree precisely where Locus must be local-first. A local-only
repository can expose `main` through `changes.getBranches` while the worktree
helper returns the currently checked-out feature branch, even when a local
`master` or `main` exists. Default selection is a main-process Git policy and
must have one owner.

The downstream deep-check failure is indirect. Workspace creation persists
`baseBranch` and the fork commit when known. For an older/missing `baseCommit`,
`src/main/lib/chat-base-commit.ts` computes `merge-base HEAD <baseBranch>` and
persists an unambiguous result with compare-and-set. A phantom `main` makes that
backfill fail in a no-origin `master` repository, so the deep check cannot
compare the Workspace pair against a shared fork.

## Goals / Non-Goals

### Goals

- Make one main-process module the canonical owner of default-branch selection.
- Apply deterministic no-origin precedence: existing local `main`, then
  existing local `master`, then attached current `HEAD` branch.
- Migrate all four direct consumers atomically and delete both existing policy
  helpers.
- Preserve explicit branch choices, remote-backed behavior, and per-call-site
  network budgets.
- Carry enough internal provenance for consumers to use a local result as a
  local ref.
- Prove a no-origin `master` repository can retain/recover fork metadata and
  reach the existing committed-tree deep-check path.

### Non-Goals

- No changes to GitHub workflow default-branch discovery.
- No changes to remote merge/rebase/fetch policy or branch mutation authority.
- No changes to conflict adjudication, `chat-base-commit.ts` backfill policy,
  renderer conflict semantics, or the private tRPC payload shape.
- No database migration or retroactive repair of stored `baseBranch` values.
- No new dependency, public API, versioned event, error code, or permission.

## Current Consumer Map

### Four direct resolver call sites

| Call site | Inputs and branch-resolution timing | Observable behavior |
| --- | --- | --- |
| `src/main/lib/git/branches.ts:50` (`getBranches`) | Resolves after one local/cached `git branch -a` scan | Returns `defaultBranch` to the renderer. `new-chat-form.tsx` marks, sorts, and initially selects it and passes its local/remote type into chat creation. `create-branch-dialog.tsx` initializes its base selector from it. `changes-view.tsx` uses it as the implicit status comparison branch. `diff-sidebar-header.tsx` uses it for default-branch state and labels/actions that are separately gated by upstream state. |
| `src/main/lib/git/branches.ts:227` (`cleanupOrphanedBranches`) | Currently calls the private helper with no remote branch facts | Adds the answer to the protected set alongside active-chat and current branches before applying the existing generated-branch candidate filter. |
| `src/main/lib/git/worktree.ts:1014` (`createWorktreeForChat`) | Resolves only when `selectedBaseBranch` is absent | Chooses the start ref and returns `baseBranch` plus the exact `baseCommit`; `project-chat-worktree.ts` passes those values to the chat persistence path. An invalid inferred ref causes the existing project-directory fallback. |
| `src/main/lib/git/worktree.ts:1226` (`getWorktreeDiff`) | Resolves only for a clean worktree, no explicit `baseBranch`, and after the `onlyUncommitted` early return | Selects the three-dot diff baseline, preferring an available `origin/<name>` ref and otherwise the local ref. Chat diff/generation paths can observe the result. Agent Workbench's `onlyUncommitted` summary call returns earlier and does not invoke the resolver. |

### Indirect consumers and unchanged owners

- `src/main/lib/chat-base-commit.ts` consumes stored `baseBranch` and owns
  lazy, write-once fork-commit backfill. It does not resolve a default branch.
- `src/main/lib/agent-workbench/` consumes fork metadata and owns hunk/merge
  verdicts. It does not resolve a default branch.
- `info-section.tsx` and `active-chat.tsx` query `changes.getBranches` but use
  only `current`; their behavior is unchanged.
- `src/main/lib/git/status.ts` consumes an optional branch string and retains
  its transport fallback. It is not a resolver owner or direct resolver caller.

### Explicitly excluded adjacent resolvers

- `src/main/lib/github-workflow/gh-cli.ts:resolveGitDefaultBranch` is
  GitHub-origin workflow logic used by pull-request preparation and remains
  separate.
- `src/main/lib/git/git-operations.ts:mergeFromDefault` owns an explicit remote
  fetch plus merge/rebase operation and remains unchanged.
- `src/main/lib/git/worktree.ts:refreshDefaultBranch` explicitly synchronizes
  `origin/HEAD` and remains outside repository default selection.

## Decisions

### Decision 1: One main-process owner replaces both helpers atomically

Add `src/main/lib/git/default-branch.ts` with the sole exported
`resolveDefaultBranch` policy. The implementation change removes the private
branches helper and the exported worktree helper while migrating all four
direct callers in the same source commit. `docs/OWNERSHIP_MAP.md` records the
new owner and consumers. A focused architecture assertion or equivalent source
audit prevents a second local default-branch precedence list from being added
to those consumers.

This is an extraction-and-replacement, not a compatibility layer. No alias or
deprecated helper remains after migration.

### Decision 2: “No remote” means no configured `origin`

The resolver first determines whether a remote named exactly `origin` is
configured. Only when it is absent does the local-only precedence apply:

1. return local `main` if `refs/heads/main` exists;
2. otherwise return local `master` if `refs/heads/master` exists;
3. otherwise return the attached current `HEAD` branch;
4. if none is usable (for example, an unborn or detached repository without a
   local `main`/`master`), retain the current string-API compatibility fallback
   `main` and label its internal source as fallback.

The order is independent of checkout state. Thus a checked-out feature branch
does not displace an existing local `main` or `master`, and `main` wins when
both known local names exist.

A configured but unreachable `origin`, or an `origin` whose refs have not been
fetched, is not silently reclassified as local-only. That edge remains under
the existing remote-backed policy and its honest fallback behavior.

### Decision 3: The internal result carries ref provenance

The canonical resolver returns an internal structured result containing at
least the branch name and whether it was established from a local ref, a remote
fact, or the compatibility fallback. This does not cross tRPC; callers that
already expose `defaultBranch` continue to return only the branch-name string.

The provenance closes a consumer ambiguity in `createWorktreeForChat`: when an
omitted branch is auto-resolved from a no-origin repository, the worktree start
point must be the local branch name, not `origin/<name>`. Explicit
`selectedBaseBranch` plus `branchType` input remains authoritative and is not
reinterpreted.

### Decision 4: Remote observation profiles are explicit and behavior-preserving

The owner accepts an explicit observation profile rather than hiding network
access or silently standardizing different legacy consumers. Profile names are
an implementation detail; their required behavior is:

| Consumer profile | Existing remote-backed result order | Network budget |
| --- | --- | --- |
| Branch listing | cached `origin/HEAD`; otherwise cached `master` only when cached `main` is absent; otherwise `main` | Never performs `ls-remote` or fetch |
| Orphan cleanup | cached `origin/HEAD`; otherwise `main` because this path supplies no cached remote-branch list | Never performs `ls-remote` or fetch |
| Worktree creation / clean-diff fallback | cached `origin/HEAD`; otherwise first available cached `main`, `master`, `develop`, or `trunk` in that order; otherwise the existing `ls-remote --symref origin HEAD` lookup; otherwise `main` | Retains the existing network-allowed fallback |

The no-origin profile is the one intentional behavior change and always uses
the local precedence from Decision 2 without network work. The compatibility
profiles above are centralized in the same owner; callers select their bounded
fact/IO context but do not implement branch precedence themselves.

This proposal does not use consolidation as authorization to redesign remote
candidate names, change their order, or add network work to polling/cleanup
paths. Characterization tests lock the table before the old helpers are
deleted.

### Decision 5: Consumers retain their existing override rules

- `getBranches` and cleanup always use the canonical answer for their current
  repository facts.
- `createWorktreeForChat` resolves only when no explicit base was supplied and
  persists the resolved name/exact fork commit on success.
- `getWorktreeDiff` resolves only when no explicit base was supplied and its
  existing clean/dirty and `onlyUncommitted` gates permit it.
- Stored `baseBranch` values remain authoritative. The resolver does not rewrite
  historical chat rows, and `ensureChatBaseCommit` retains its current local
  then optional `origin/<baseBranch>` candidate logic.

### Decision 6: The regression crosses the real metadata boundary

The integration fixture initializes its repository explicitly with
`git init --quiet -b master` and configures no `origin`. It obtains `master`
through the canonical resolver rather than hard-coding the expected branch,
then creates/records two eligible branch-mode Workspaces from the same fork and
commits overlapping changes on divergent heads.

Acceptance asserts all of the following:

1. passive listing remains annotation-free because the overlapping edits are
   fully committed;
2. both tasks remain eligible for an explicit deep check;
3. missing fork commits can be backfilled to the same `master` fork commit;
4. hunk comparison is unavailable with `head-commits-differ`, not
   `base-commit-missing`;
5. the committed-tree trial is reached and retains its existing
   `committed-changes-only` scope.

The fixture's explicit `-b master` makes the regression independent of the
machine's `init.defaultBranch` configuration while still exercising the
product's no-origin master behavior.

## Risks / Trade-offs

- **Cross-module semantic drift (R2):** four consumers currently rely on two
  policies. Mitigation: one atomic replacement, a complete caller inventory,
  deletion/source audit, and direct precedence tests.
- **Accidental network regression:** a shared helper could make branch polling
  or cleanup call `ls-remote`. Mitigation: explicit observation budgets and a
  test that cached/local consumers do not invoke the network fallback.
- **Incorrect worktree start ref:** returning only a name can lose whether the
  answer is local. Mitigation: internal provenance and a no-origin worktree
  creation test.
- **Remote behavior drift:** consolidation could change uncommon remote
  fallbacks. Mitigation: characterize existing remote cases and keep them
  outside the normative local-only change.
- **Historical bad metadata remains:** rows already storing a phantom `main`
  are not repaired. Mitigation: disclose the limitation; Workspace recreation
  is the bounded recovery, and no ambiguous history is invented.
- **Cleanup safety:** a wrong protected branch could affect deletion analysis.
  Mitigation: preserve active/current protection and the generated-name filter,
  add a focused protected-default assertion, and make no deletion-rule change.

## Migration Plan

1. After Owner approval, add the canonical resolver and focused unit tests.
2. Characterize existing remote behavior and observation budgets.
3. Migrate the four direct call sites and delete both old helpers in the same
   implementation commit.
4. Add the no-origin `master` end-to-end regression and ownership/source guard.
5. Run targeted tests, strict OpenSpec validation, and `bun run check:full` at
   the frozen source SHA; obtain fresh-context review on that exact SHA.
6. Stop for Owner acceptance. Integration, archive, push, and release require
   their own authorization.

Rollback is a source revert. There is no schema migration, data rewrite, remote
operation, or compatibility path to unwind.

## Consumer And Data Impact

- Public/versioned consumer impact: none.
- Private tRPC field shape: unchanged (`defaultBranch: string`).
- Renderer semantic impact: corrected default labels/selections/comparison
  branch for no-origin repositories.
- Persisted data impact: newly inferred Workspaces can store the correct local
  branch/fork commit; existing explicit values are untouched.
- Reset/migration requirement: none.

## W7 Autonomy Envelope

- **Green:** internal naming, focused fixture organization, and extra assertions
  that preserve the specified order and observation budgets.
- **Yellow:** changing the internal result shape beyond branch/source facts,
  expanding remote candidate rules, altering fallback for detached/unborn
  repositories, or repairing stored chat metadata. Record and return to the
  Owner before implementation.
- **Red:** new network access from branch listing/cleanup; any fetch/push/merge/
  rebase behavior change; branch deletion-rule expansion; public/schema/error/
  permission change; retaining duplicate resolver paths. Stop and return to the
  Owner/OpenSpec gate.

## Open Questions

None. Explicit Owner `APPROVED` is the next gate.
