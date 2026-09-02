## Context

`getProjectRegistrationForCwd` canonicalizes the requested cwd and each stored
project root, filters removed or unavailable projects, and uses `isPathInside`
to decide membership. Its implicit branch currently returns on the first match.
That makes nested registration attribution depend on database row order.

The same function is consumed by Local Job API, headless CLI, schedules, ACP,
and other project-scoped main-process paths. The implementation therefore stays
inside the existing registry owner and changes no caller-specific behavior.

## Goals / Non-Goals

### Goals

- Resolve an implicit cwd to the deepest eligible explicitly registered
  canonical root.
- Preserve all existing canonicalization, eligibility, and rejection behavior.
- Prove the result is independent of registration/database enumeration order.
- Keep the patch small enough to inspect as a trust-boundary refinement.

### Non-Goals

- Do not interpret `.git`, `gitdir`, `commondir`, remotes, or worktree metadata.
- Do not admit linked worktrees, sibling clones, or any path outside an explicitly
  registered root.
- Do not change explicit `projectId` resolution or removed-project semantics.
- Do not add a helper, cache, table, dependency, migration, or compatibility path.

## Decisions

### Decision 1: Filter membership before comparing specificity

The resolver performs the existing eligibility checks first:

1. skip removed projects unless `includeRemoved` is true;
2. canonicalize the stored project path and skip unavailable paths;
3. require `isPathInside(projectReal, cwdReal)`;
4. among only those matches, retain the candidate whose canonical
   `projectReal.length` is greatest.

Canonical ancestor paths are nested strings after `realpathSync`, so the longest
matching canonical root is the deepest root. The comparison uses strict `>`;
equal canonical roots retain the existing first-row behavior for legacy duplicate
data without introducing an unrelated tie-break policy.

### Decision 2: Keep explicit project identity authoritative

When callers provide `projectId`, the existing branch continues to resolve and
validate only that project. An explicit outer project remains valid for a cwd
inside it even when a nested project is also registered.

### Decision 3: Replace the loop in place

No second resolver is introduced. The canonical function accumulates one
`bestMatch` during its existing database scan and emits the existing
`ProjectCwdRegistration` shape after the scan.

## Trust-Boundary Argument

Let `E` be the set of project rows that pass the existing removed-state,
canonical-path, and `isPathInside` checks. The old implementation returned an
arbitrary first element of `E`; the new implementation returns `arg max` by
canonical root length. The definition of `E` is unchanged. Therefore:

- a cwd rejected before the change is still rejected;
- no external directory becomes a project member;
- no Git-controlled metadata becomes an authority input;
- only attribution among already-authorized nested roots becomes deterministic.

## Test Design

One ordering-adversarial fixture registers:

1. outer root;
2. deepest root;
3. a longer unrelated root;
4. middle root.

The cwd is below the deepest root. This order makes the current first-match
implementation choose outer, a naive last-match implementation choose middle,
and a naive unfiltered longest-path implementation choose the unrelated root.
The expected result is the deepest canonical root. The same fixture also asserts
that explicit outer `projectId` resolution remains outer and that the read path
does not mutate the project table.

## Consumer And Data Impact

- Consumer shape/version: unchanged; see `consumer-impact.md` for the intentional
  nested-attribution semantic correction.
- Database/schema: unchanged.
- Data reset/migration: none.
- Rollback: revert the source commit; stored rows need no repair.

## Active-Change Coordination

`update-trpc-capability-boundary` is blocked pending rebaseline and includes
broader registered-root/capability work. This change neither depends on nor edits
that proposal. Any later linked-worktree admission must rebaseline against both
current living specs and the separate R3 draft.

## W7 Autonomy Envelope

- **Green:** local naming, one-pass accumulator shape, additional assertions that
  do not change eligibility or public shape.
- **Yellow:** adjacent cleanup, helper extraction, ordering/index optimization, or
  legacy duplicate-root policy. Record but do not implement.
- **Red:** any `.git`/Git/worktree inference; any new eligible cwd; any public
  field/error/version change; database/schema/dependency change; command,
  filesystem, auth, provider, or runtime boundary change. Stop and return to the
  Owner/OpenSpec gate.

## Open Questions

None. The Owner-fixed scope and acceptance criteria are complete.
