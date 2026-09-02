# Change: Resolve nested registered cwd to the most specific project

> Status: **APPROVED / IMPLEMENTING (R2)**. The Owner instruction dated
> 2026-09-02 explicitly authorizes this bounded implementation and exact-SHA
> verification. Owner product `ACCEPTED` is still required before any local
> integration into `main`.

## Why

`getProjectRegistrationForCwd` is the shared main-process owner used to map an
implicit working directory to an active registered project. When more than one
explicitly registered canonical project root contains the cwd, the current
implementation returns the first database row that matches. Database enumeration
order is not a project-ownership rule, so a cwd inside a separately registered
nested project can be attributed to its outer parent.

The resolver must deterministically select the most specific eligible registered
root while preserving the existing trust boundary: this change changes which
already-eligible project wins, but it never makes a new cwd eligible.

## What Changes

- Scan every eligible explicitly registered project during implicit cwd
  resolution and select the matching canonical `projectReal` path with the
  greatest length.
- Keep explicit `projectId` resolution unchanged: it validates only the named
  project and does not search for a more specific project.
- Add an ordering-adversarial unit test with outer, middle, deepest, and longer
  unrelated registered roots so neither first-match, last-match, nor unfiltered
  longest-path implementations can pass.
- Record the observable Local Job v1 attribution correction in
  [consumer-impact.md](consumer-impact.md).

## Canonical Owner And Single-Path Statement

- Canonical owner: `src/main/lib/projects/registry.ts`, specifically
  `getProjectRegistrationForCwd`.
- Existing consumers continue to call that one owner; no route, CLI, ACP, or
  schedule-specific resolver is added.
- There is no old/new dual path. The existing implicit loop is replaced in place.

## Explicit Non-Goals

- No `.git`, gitfile, `gitdir`, `commondir`, remote, or Git worktree identity
  inspection.
- No automatic admission of linked worktrees or any directory outside an
  explicitly registered canonical root.
- No change to explicit `projectId`, removed-project eligibility, path
  canonicalization, error codes, API fields, database schema, provider/runtime
  selection, or command/filesystem permissions.
- No implementation from external PR #18 is cherry-picked.

The rejected linked-worktree half is tracked separately by the R3 draft
`add-linked-worktree-admission` and is not a dependency of this change.

## Risk Classification

R2. The change affects a shared registered-root resolver and can change the
observable owning project ID/path for the ambiguous case where multiple nested
roots were explicitly registered. It does not widen filesystem or command
authority because candidate eligibility is unchanged.

## Impact

- Affected specs: `project-lifecycle`
- Observable public projection: `locus.local-job.v1` project status and run
  attribution can select the nested project instead of an outer project when
  both were explicitly registered.
- Affected code: `src/main/lib/projects/registry.ts`
- Affected tests: `tests/project-registry.test.ts`
- Data/migration: none
- Rollback: revert the bounded source commit; no persisted transformation is
  required.
- Active-change overlap: `update-trpc-capability-boundary` also discusses
  registered roots but is blocked pending rebaseline. This change does not adopt
  that proposal's unfinished router/capability work and does not modify its files.

## Approval And Integration Gate

- Implementation approval: Owner task, 2026-09-02.
- Required before integration: exact-SHA `bun run check:full`, Codex
  `IMPLEMENTATION_VERIFIED`, fresh-context Claude Code `REVIEW_APPROVED`, no
  unresolved P0/P1, then explicit Owner `ACCEPTED`.
- Remote push, remote merge, and release are not authorized.
