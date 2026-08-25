# Design: Cross-Workspace conflict detection

## Context

The Agent Workbench already fans out over every project-backed Workspace
(`agent-workbench.ts:186-252`) and already fetches each Workspace's status-visible changed-file
paths, only to discard them (`:63-65`, `:81-87`). Meanwhile nothing in the product warns that two
concurrently running Workspaces have uncommitted changes to the same file; fully committed overlap
is absent from status and needs the explicit committed-tree trial instead. This change is the first
slice of the ratified thesis (safe parallel agent work) and is sequenced before the isolation change
because it is cheap, independent, and immediately visible.

## Goals

- Always-on collision awareness for status-visible, uncommitted changes across Workspaces at zero
  added git-subprocess cost, plus an ungated entry to the committed-tree check.
- An on-demand deeper verdict whose semantics are honest about what it can and cannot see.
- Substrate fixes (hunk capture, rename bug, fork-commit persistence) that the isolation change
  will also need.

## Non-Goals

- No cross-Workspace merge, rebase, or "resolve" action — adjudication shows evidence; the user
  (or later, an engine) decides.
- No new review surface — clicking a conflict routes into the existing per-Workspace diff, filtered.
- No new status or filter — the classification taxonomy is ratified and untouched.
- No lease, no rollback change, no worktree-per-run — that is the next change.
- No aggregated raw-diff view — unbounded untracked-file diffs need a truncation policy first.

## Decisions

**Decision 1: Three tiers with hard honesty rules.**
(a) *Path overlap* = warning. Computed from the already-fetched structured `status.files` result
returned by simple-git. It is always on for uncommitted/status-visible changes, but it intentionally
has no evidence once changes are fully committed and the status is clean. It may false-positive
when Workspaces forked from different commits — which is exactly why it is labeled a warning, never
a conflict.
(b) *Hunk-range overlap* = likely conflict. Requires parser ranges; **hard-gated on both
`baseCommit` equality and current HEAD equality** — old-side line numbers from different fork
points or dirty diffs anchored to different current tips are different coordinate systems, and
comparing them would manufacture false verdicts. Degrades to (a) when either gate is unavailable.
(c) *`git merge-tree --write-tree` trial* = definitive **for committed trees only**, and the verdict
string must say so. Never suppresses an (a)/(b) warning about uncommitted work. Requires git ≥ 2.38
(one-time probe, cached; degrade to (b)/(a) below that). Its affordance is available whenever the
project has at least two eligible branch-mode, non-archived sibling Workspaces, independent of a
tier-(a) warning, so a committed-only pair remains reachable.
*Alternative considered:* single-tier "same file = conflict". Rejected — path overlap across
different bases is routinely benign, and crying wolf kills the feature's credibility.

**Decision 2: Conflicts are annotations, not statuses.**
The status taxonomy (`running/blocked/needs-review/has-pr/clean/archived`) and its filters are
ratified spec with tests. A conflict does not change what state a Workspace is in; it changes what
the user should look at first. Annotation avoids reclassification churn, keeps the MODIFIED delta
to one requirement, and leaves open a later filter once real usage shows one is wanted.

**Decision 3: Tier (a) rides `listTasks`; tiers (b)/(c) are on-demand only.**
Two facts force this: the poll stops when nothing is running (`agent-workbench.tsx:1486-1489`) —
so a poll-embedded detector goes stale exactly when the user returns to adjudicate — and tier (b)'s
input (`getWorktreeDiff`) spawns one subprocess per untracked file serially (`worktree.ts:1164-1188`),
which multiplied by N Workspaces in a poll is a git storm. Deep verdicts are fingerprint-keyed
(HEAD sha + status hash per Workspace) and the UI shows computed-at state. The passive path compares
status hashes rather than treating a HEAD change alone as stale; after any observed status-hash
mismatch, staleness latches until an explicit successful re-run. A successful check invalidates and
refetches `listTasks` to establish a fresh status baseline, and the last successful verdict remains
rendered while a re-run is pending. The committed-only scope label and provenance prevent this
status-derived signal from claiming live committed-tree freshness.

**Decision 4: Persist the fork commit (`chats.baseCommit`).**
`createWorktree` already resolves it (`worktree.ts:246-257`) and throws it away. A text column,
written at creation (`chats-crud.ts` update path), lazily backfilled via `git merge-base` for
existing rows, with documented drift semantics under force-push. *Alternative:* recompute
merge-base on every check — rejected: one subprocess per Workspace per check for a value that is
immutable per worktree, and silently wrong after a base force-push with no way to tell.

**Decision 5: Reuse the existing renderer plumbing end-to-end.**
The badge lives on the existing card metrics row; clicking sets `filteredDiffFilesAtom` /
`selectedDiffFilePathAtom` and opens `diffSidebarOpenAtomFamily(task.id)` — the exact path the
Review action already walks (`agent-workbench.tsx:1705-1719`). Zero new atoms, zero new views.
The hand-duplicated `WorkbenchTask` type (`:102-141`) is updated in the same commit as the router
shape; a follow-up to share the type is noted but out of scope.

**Correction (2026-08-13, desktop smoke):** the atom named above was the former Review route, not
the current desktop route. The running app proved that toggling it alone navigated to Chat without
opening a visible diff. The implementation still reuses existing surfaces and adds no atom or view:
it opens the canonical Details diff widget on desktop, the existing `agentsMobileViewModeAtom`
`"diff"` route on mobile, and the existing full-page diff as a non-mobile fallback. The same
filtered-file and selected-file atoms continue to own conflict-path scoping.

**Decision 6: One shared parser owner, not two repaired implementations.**
`src/shared/unified-diff-parser.ts` owns unified-diff splitting, quoted-path decoding, rename
validation, hunk capture, and parsed-file types. Main-process and renderer callers import it
directly; the former main parser and renderer-local parser are deleted. A static ownership guard
prevents a compatibility facade or second parser from returning. Delete-vs-edit collisions get a
distinct annotation.

**Decision 7: Snapshot and subprocess work fail closed under explicit bounds.**
For each Workspace, deep collection is strictly ordered `HEAD-before → diff → HEAD-after`; a
changed HEAD makes hunk and merge evidence unavailable. Merge trials receive captured commit SHAs,
not branch refs. At most ten Workspaces enter a request; pair trials use bounded concurrency,
per-trial timeout, and an overall batch deadline. Timeout/deadline details remain machine-readable
and are rendered as distinct unavailable explanations.

**Decision 8: Server admission and fork history are canonical, not UI trust.**
The listing and mutation use one eligibility validator. The mutation rejects archived/missing/
cross-project tasks, missing branches/worktrees, duplicate IDs, and shared resolved directories,
then enforces registered-root boundaries before Git IO. Lazy `baseCommit` backfill is a database
compare-and-set: concurrent candidates cannot overwrite the first stored fork commit.

## Risks / Trade-offs

- **False negatives are inherent** — untracked files are invisible to merge-tree, and tier (b)
  depends on scraped untracked diffs. Mitigation: tier (a) is status-based (no scraping) and always
  on; the spec words verdicts as evidence, not guarantees.
- **`baseCommit` drift** after force-pushing a base branch: documented as accepted; lazily-backfilled
  values recompute merge-base at backfill time only.
- **Perf regression risk in tier (a)** is the one thing to guard in review: the acceptance is
  literally "no new git subprocess in the `listTasks` path" — paths must come from the existing
  `status.files` / numstat calls, `-z` variants swapped in place.

  **Correction (2026-08-13):** the shipped implementation did not add a raw porcelain/numstat
  parser or swap both commands to `-z`. simple-git's existing `git.status()` call already requests
  null-delimited status and returns structured `status.files`; `collectChangedFiles` reads those
  current/original path fields. The existing non-`-z` numstat calls remain count-only and their path
  column is unused. The abandoned production-dead helper and its helper-only test were deleted.

## Migration Plan

1. Consolidate the shared parser owner, delete duplicate implementations, and keep its ownership guard green.
2. Schema: `baseCommit` migration + capture at creation + lazy backfill.
3. Tier (a): router shape + overlap map + renderer badge + i18n (en+zhCN in one commit).
4. Tiers (b)/(c): on-demand procedure + version probe + verdict labeling + affordance.
5. Docs: focus-doc Current Cut, `agent-workbench` Purpose.
6. Verification (task 6): `bun run check`, `openspec validate --strict`, and the manual smoke list.

**Rollback:** every step is additive (new column is nullable; new procedure; new optional fields on
an API with exactly one consumer). Reverting the branch restores prior behavior; the migration is
backward-compatible (a null `baseCommit` is the pre-change state).

## Open Questions

- Should a "conflicts" filter join the taxonomy once usage shows demand? Deliberately deferred
  (Decision 2) — revisit with evidence, as its own small change.
- Whether passive staleness should later include a cheap committed-tip observer — current v1 keeps
  that explicitly outside the polling cost budget and relies on provenance plus explicit re-run.
