# TICKET-123 — Default-branch guard, dead-helper cleanup, and hermetic adapter tests

## Status

🟡 Yellow — 待设计 / 未授权实施（default-branch fresh review follow-up；2026-09-06）。

This single ticket registers the follow-up from findings P2#2, P2#3, and P3#5
of the `fix-default-branch-resolution-local-repos` fresh-context review.
Registration does not authorize implementation. A separately approved change
must define the scope and obtain Owner authorization before source or tests
change; the current source remains frozen at
`7d26fec7579b05d56e5a0ef1e1d66d76a0b91ea6` (review/evidence head `e1f8a7f9`).

## Evidence and ownership

- Review artifact:
  `/home/chen/.claude/projects/-home-chen-projects-agent-code-for-me/f1888632-cd03-49a0-a57d-51704695f29d/handoff/reviews/default-branch-fix-review-7d26fec7.md`.
- In-repository verdict and dispositions:
  [verification.md](../../openspec/changes/fix-default-branch-resolution-local-repos/verification.md#44-fresh-context-review).
- Default-branch policy owner: `src/main/lib/git/default-branch.ts`.
  Consumers remain `branches.ts` and `worktree.ts`; the existing guard in
  `tests/git-default-branch-resolver.test.ts:454-480` proves legacy-helper
  deletion, two resolver calls per file, and a single definition owner. An
  additional name-free inline precedence closure can pass those assertions.
- `src/main/lib/git/worktree.ts:606-620` contains the currently unreferenced
  `detectBaseBranch` heuristic over `origin/*`. The pre-existing
  `refreshDefaultBranch`, `fetchDefaultBranch`, and `hasOriginRemote` helpers
  are also dead outside their internal dependency. Their removal is outside
  the approved four-call-site migration.
- Test isolation responsibility: `tests/codex-app-server-adapter.test.ts`.
  Shell-snapshot scrubbing resolves the adapter's runtime home; tests currently
  reach the real `~/.codex/shell_snapshots`, producing three sandbox `EROFS`
  failures. The coordination session's independent `check:full` run at
  `e1f8a7f9` passed with writable `~/.codex`; see the linked verification ledger.

## Required follow-up scope

- Strengthen the consumer source guard with shape-targeted assertions against
  the deleted `for (const candidate of ["main", "master", "develop", "trunk"])`
  loop and equivalent `main`/`master` candidate arrays outside the canonical
  owner. Use a narrow, documented allowlist only if an approved adjacent
  heuristic must remain; do not reject unrelated strings by keyword alone.
- Recheck callers/barrel exports with source searches and `bun run debt:knip`,
  then delete `detectBaseBranch`, `refreshDefaultBranch`, `fetchDefaultBranch`,
  and `hasOriginRemote` with their obsolete exports/references. Update the
  ownership-map exclusions to match; retain no replacement duplicate policy.
- Make adapter tests hermetic by supplying temporary `CODEX_HOME` and `HOME`
  through `runtimeEnv`, creating and cleaning up fixtures under those roots.
  Preserve shell-snapshot scrub assertions and failure coverage while avoiding
  reads or writes to the operator's real home.

## Out of scope until separately approved

- Any source, test, or `lint-baseline.json` edit during the current docs-only
  review disposition; weakening assertions or approving a baseline increase.
- Changing resolver precedence, lone-`branchType` semantics, linked-worktree
  HEAD semantics, remote network/timeout budgets, or renderer heuristics.
- Changing production Codex runtime/auth/config behavior, branch deletion
  authority, persisted data, public APIs, or versioned contracts.

## Acceptance outline for a future approved change

- Negative fixtures reject a reintroduced candidate loop/array or name-free
  inline local precedence closure in either consumer, while preserving the
  existing helper-deletion, call-count, and single-owner assertions.
- Source/knip evidence confirms the four dead helpers and obsolete references
  are removed; no second default-branch policy replaces them.
- Adapter tests pass with an unwritable real home and temporary runtime homes;
  fixture cleanup and scrub failures remain covered without touching real
  `~/.codex` state.
- Focused resolver/consumer and adapter suites, strict OpenSpec validation,
  architecture guard, and `bun run check:full` pass. Record implementation
  verification and fresh-context Claude review against the same new source
  SHA, followed by explicit Owner acceptance.
