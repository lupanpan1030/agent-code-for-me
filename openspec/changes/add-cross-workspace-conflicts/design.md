# Design: Cross-Workspace conflict detection

## Context

The Agent Workbench already fans out over every project-backed Workspace
(`agent-workbench.ts:186-252`) and already fetches each Workspace's changed-file paths, only to
discard them (`:63-65`, `:81-87`). Meanwhile nothing in the product warns that two concurrently
running Workspaces are editing the same file — the first signal is a merge conflict after the fact.
This change is the first slice of the ratified thesis (safe parallel agent work) and is sequenced
before the isolation change because it is cheap, independent, and immediately visible.

## Goals

- Always-on collision awareness across Workspaces at zero added git-subprocess cost.
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
(a) *Path overlap* = warning. Computed from already-fetched `git status` paths, `-z`-parsed. Always
on. May false-positive when Workspaces forked from different commits — which is exactly why it is
labeled a warning, never a conflict.
(b) *Hunk-range overlap* = likely conflict. Requires parser ranges; **hard-gated on
`baseCommit` equality** — old-side line numbers from different fork points are different coordinate
systems, and comparing them would manufacture false verdicts. Degrades to (a) when bases differ.
(c) *`git merge-tree --write-tree` trial* = definitive **for committed trees only**, and the verdict
string must say so. Never suppresses an (a)/(b) warning about uncommitted work. Requires git ≥ 2.38
(one-time probe, cached; degrade to (b)/(a) below that).
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
(HEAD sha + status hash per Workspace) and the UI shows computed-at state; a fingerprint mismatch
marks the verdict stale rather than silently re-running.

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

**Decision 6: Fix the shared parser bugs first, in both parsers.**
Hunk capture is additive (`hunks?` on `ParsedDiffFile`). The pure-rename `isValid:false` bug is
fixed in `diff-parser.ts` AND the renderer duplicate (`agent-diff-view.tsx:380-466`) — same-file
matching built on a parser that mislabels renames would silently miss the rename-vs-edit collision
class. Delete-vs-edit collisions get a distinct annotation (the cheapest genuinely-dangerous case:
one agent deletes what another is editing).

## Risks / Trade-offs

- **False negatives are inherent** — untracked files are invisible to merge-tree, and tier (b)
  depends on scraped untracked diffs. Mitigation: tier (a) is status-based (no scraping) and always
  on; the spec words verdicts as evidence, not guarantees.
- **`baseCommit` drift** after force-pushing a base branch: documented as accepted; lazily-backfilled
  values recompute merge-base at backfill time only.
- **Perf regression risk in tier (a)** is the one thing to guard in review: the acceptance is
  literally "no new git subprocess in the `listTasks` path" — paths must come from the existing
  `status.files` / numstat calls, `-z` variants swapped in place.

## Migration Plan

1. Substrate fixes (parser + rename bug) — green suite throughout.
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
- Whether to consolidate the duplicated renderer parser onto server-parsed files entirely — noted
  as follow-up hygiene, out of scope here.
