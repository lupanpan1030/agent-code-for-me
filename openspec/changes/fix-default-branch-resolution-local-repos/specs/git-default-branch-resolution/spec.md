## ADDED Requirements

### Requirement: Canonical Repository Default Branch Resolution

The main process SHALL resolve a repository's default branch through one
canonical owner. For a repository without a configured remote named `origin`,
the owner SHALL select an existing local `main`, otherwise an existing local
`master`, otherwise the attached current `HEAD` branch. The result SHALL retain
enough internal provenance for consumers to distinguish a local ref, a remote
fact, and a compatibility fallback. Main-process routes and Git helpers SHALL
NOT implement a second local default-branch precedence policy.

#### Scenario: Local main wins independently of checkout state
- **WHEN** a repository has no configured `origin`, has local `main` and
  `master` branches, and has any attached branch checked out
- **THEN** the canonical resolver returns `main`
- **AND** the result identifies an existing local ref

#### Scenario: Local master wins when main is absent
- **WHEN** a repository has no configured `origin`, has no local `main`, and has
  a local `master`
- **THEN** the canonical resolver returns `master`
- **AND** the result identifies an existing local ref

#### Scenario: Attached HEAD is the last usable local branch
- **WHEN** a repository has no configured `origin`, has neither local `main`
  nor local `master`, and `HEAD` is attached to a named branch
- **THEN** the canonical resolver returns the attached branch name
- **AND** it does not invent `main` or `master`

#### Scenario: Degenerate local repository retains an honest fallback
- **WHEN** a repository has no configured `origin`, has neither local `main`
  nor local `master`, and has no attached named `HEAD` branch
- **THEN** the resolver returns the documented compatibility fallback `main`
- **AND** its internal provenance does not claim that fallback is an existing
  local ref

#### Scenario: Configured origin preserves each consumer profile
- **WHEN** a repository has a configured remote named `origin`
- **THEN** branch listing uses cached `origin/HEAD`, otherwise cached `master`
  only when cached `main` is absent, otherwise `main`, without network lookup
- **AND** orphan cleanup uses cached `origin/HEAD`, otherwise `main`, without
  network lookup
- **AND** worktree creation and clean-diff fallback use cached `origin/HEAD`,
  otherwise the first available cached `main`, `master`, `develop`, or `trunk`
  in that order, otherwise their existing permitted `ls-remote` lookup,
  otherwise `main`
- **AND** no consumer activates the no-origin local precedence merely because
  cached remote facts are missing

### Requirement: Default Branch Consumers Preserve Local Workspace Evidence

The branch-listing route, orphan-cleanup route, Workspace creation helper, and
clean-worktree diff helper SHALL consume the canonical default-branch result
without changing their existing explicit-override or operation gates. When a
Workspace base is auto-detected from a no-origin repository, the system SHALL
use the resolved local ref as the start point and SHALL retain its branch name
and exact fork commit when creation succeeds. Existing explicit stored branch
values SHALL remain authoritative and SHALL NOT be silently rewritten.

#### Scenario: Branch listing and cleanup agree on a local default
- **WHEN** branch listing and orphan cleanup inspect the same no-origin
  repository whose local default resolves to `master`
- **THEN** branch listing returns `master` as its `defaultBranch`
- **AND** orphan cleanup includes `master` in its protected branch set
- **AND** neither operation performs a network lookup

#### Scenario: Auto-detected local Workspace retains its fork
- **WHEN** Workspace creation receives no explicit base for a no-origin
  repository whose local default resolves to `master`
- **THEN** it creates the Workspace from the local `master` ref rather than
  `origin/master`
- **AND** it returns the base branch `master` and the exact fork commit for
  persistence

#### Scenario: Explicit branch and diff gates remain authoritative
- **WHEN** a caller supplies an explicit base branch, or requests an
  uncommitted-only diff that returns before default resolution
- **THEN** the consumer preserves that explicit branch or early-return behavior
- **AND** default-branch resolution does not override it

#### Scenario: No-origin master Workspace retains a recoverable base
- **WHEN** a branch-mode Workspace is created from a no-origin repository whose
  canonical default resolves to local `master`
- **THEN** its inferred `baseBranch` is `master`, never a phantom `main`
- **AND** successful creation retains the exact fork commit
- **AND** if fork metadata is absent, the existing lazy backfill can evaluate
  `merge-base HEAD master` without default-branch resolution causing a missing
  base ref
