# Change: Cross-Workspace conflict detection (the adjudication layer, v1)

## Why

Locus's ratified Harness strategy includes a visible workbench for operating mature coding Engines
**safely in parallel** on real git repos. The parallel half already exists: multiple project-backed
Workspaces, each with its own worktree, and an Agent Workbench that fans out over all of them
(`agent-workbench.ts:186-252`, one `Promise.all` per refresh). The safety half has a gap this
change closes at its cheapest point: **nothing tells the user while two Workspaces have
status-visible changes to the same file.** Once those changes are fully committed, they disappear
from the status-derived listing by design; the explicit committed-tree check is the evidence path
for that class. Today the first hint of either class can otherwise be a merge conflict — after both
agents have finished.

The decisive substrate fact: `getDiffSummary` (`agent-workbench.ts:54-101`) already runs
`git.status()` per Workspace and **fetches every changed file's path, then discards it** — only
`status.files.length` survives (`:63-65`), and the numstat parse drops the path column (`:81-87`).
Path-level conflict detection across all Workspaces therefore costs **zero additional git
subprocesses**: keep what is already fetched, intersect the sets.

This is deliberately sequenced BEFORE the isolation change (cwd leases, rollback safety,
worktree-per-run): it is far cheaper, has zero dependency on it, and makes today's parallel work
reviewable while the harder isolation design is researched.

## What Changes

- **Tier (a) — always-on path-overlap warnings for uncommitted/status-visible changes, zero
  subprocess cost.** `listTasks` returns each task's changed-file paths from simple-git's
  already-fetched structured `status.files` result (including its current/original rename fields)
  plus a cross-task overlap map. Fully committed changes are absent from this map because a clean
  status has no paths. Workbench cards get a conflict annotation ("also changed in N other
  Workspaces"); clicking it feeds the overlapping paths into the **existing** filtered-diff
  plumbing (`filteredDiffFilesAtom` → the per-Workspace diff sidebar). Conflicts are
  **annotations, not statuses** — the ratified running/blocked/needs-review/has-pr/clean taxonomy
  and its filters are untouched.
- **Tier (b)/(c) — on-demand deep check with honest verdicts.** A new main-process procedure
  computes, for a selected set of Workspaces:
  - *hunk-range overlap* (tier b) — uses the canonical shared unified-diff parser's captured `@@`
    ranges; **gated on equal fork commits and equal current HEADs**,
    because old-side line numbers from different bases or current tips live in different coordinate
    systems;
  - *a `git merge-tree --write-tree` trial* (tier c) — uses captured immutable commit SHAs, is
    definitive for **committed** trees only, and
    labeled as such (the dominant workbench state is dirty worktrees; an unlabeled "clean" verdict
    would be a lie); requires git ≥ 2.38, so a one-time version probe degrades to tier (b)/(a) on
    older git.
  The deep-check affordance is available whenever the card's project has at least two eligible
  branch-mode, non-archived sibling Workspaces in distinct worktree directories, whether or not
  tier (a) found a warning. The mutation repeats this admission rule and verifies every project/
  worktree root before Git IO. Verdicts are fingerprint-keyed (HEAD sha + status hash per
  Workspace) and displayed with their computed-at state, because agents keep writing while the
  check runs. Passive staleness observes and latches status-hash mismatches; the displayed
  committed-only scope and provenance avoid implying that an unchanged status hash proves a
  still-current committed-tree verdict.
- **`chats.baseCommit` column (new migration).** Worktree creation already resolves the fork commit
  and throws it away (`worktree.ts:246-257` vs the `WorktreeResult` shape at `:945-953`). Persist
  it at creation; backfill lazily via `git merge-base` for existing rows; document merge-base drift
  under force-push as an accepted inaccuracy. This is what makes tier (b) gating sound — and the
  isolation change will want the same column.
- **Substrate fixes (prerequisites, shipped first):**
  - one canonical `src/shared/unified-diff-parser.ts` owns path decoding, rename validation, hunk
    capture, and parsed types for main and renderer; the old main parser and renderer duplicate are
    removed, with an ownership guard preventing either path from returning;
  - the canonical parser fixes pure-rename validity and C-quoted Unicode paths;
  - delete-vs-edit collisions are flagged distinctly in same-file matching.
- **Race and cost bounds:** each Workspace snapshot is read as `HEAD-before → diff → HEAD-after`;
  a changed HEAD makes both deeper tiers unavailable. Merge trials consume only captured SHAs,
  run with bounded concurrency, a per-trial timeout, and an overall batch deadline.
- **Write-once backfill:** concurrent lazy `baseCommit` writers use database compare-and-set, so
  only the first candidate persists and all contenders return the same stored winner.
- **Detection freshness is tied to the view, not the poll.** `listTasks` polls only while something
  is running (`agent-workbench.tsx:1486-1489`, else `refetchInterval: false`) — i.e. polling stops
  exactly when the user returns to adjudicate. Tier (a) rides the existing query; tiers (b)/(c) run
  on demand only.
- **Docs:** update `docs/locus-workbench-focus.md`'s "Current Cut" (still naming the completed
  Codex-trace slice) to the parallel-safety slice, and fill `agent-workbench`'s `Purpose` (still
  the archiver's "TBD" stub) — both called out here so neither is silent scope creep.
- **i18n:** new `workbench.*` keys land in `en` and `zhCN` together (feature copy: "Cross-Workspace
  Conflicts" / 「跨工作区冲突」, per the ratified vocabulary — the unit compared is the Workspace).

### Explicitly NOT changed (scope guards)

| Surface | Why it survives untouched |
| --- | --- |
| The per-Workspace diff/review surface | Ownership is spec'd (`agent-workbench` "User reviews a task", details-sidebar requirements). This change *feeds* it via `filteredDiffFilesAtom`; it does not build a second review surface. |
| The status taxonomy and filters | Conflicts annotate; they do not reclassify. No new status, no new filter in v1. |
| The split view | It runs up to 4 **Chats within one Workspace** (`sub-chat-store.ts:10`) — it is not, and must not be described as, parallel Workspaces. |
| Renderer file access | All detection runs in the main process. `runtime-security-baseline` (`spec.md:76-83`) confines renderer reads to registered roots; nothing here widens that. |
| Isolation (leases, rollback, worktree-per-run) | The next change. This change must not grow a lease. |
| `getWorktreeDiff`'s serial untracked-file loop | A known cost (`worktree.ts:1164-1188`), inherited unchanged: tier (a) never calls it, tiers (b)/(c) are on-demand. Fixing it is independent hygiene. |

## Impact

**Affected specs** — NEW capability `cross-workspace-conflicts` (3 ADDED requirements);
`agent-workbench` MODIFIED ("Workbench Task Actions" — full paste + one added scenario) and its
`Purpose` stub filled.

**Affected code (edit)** — `src/main/lib/trpc/routers/agent-workbench.ts` (files[] + overlap map;
new deep-check procedure), `src/main/lib/agent-workbench/{conflicts,deep-conflicts,status}.ts`,
`src/shared/unified-diff-parser.ts` (single parser owner), `src/main/lib/git/worktree.ts`
(persist fork commit), `src/main/lib/db/schema/index.ts` + drizzle migration (`baseCommit`),
`src/main/lib/trpc/routers/chats-crud.ts` (store it),
`src/renderer/features/agents/workbench/agent-workbench.tsx` (badge, verdict and click-through),
`src/renderer/features/agents/ui/agent-diff-view.tsx` (shared-parser consumer), `dictionaries.ts`
(en + zhCN), `docs/locus-workbench-focus.md`.

**Consumers** — `listTasks` has exactly one consumer (`agent-workbench.tsx:1479`; verified), so the
API extension is additive and safe.

## Risks

- **Coordinate-system lies.** Hunk overlap between Workspaces forked from different commits or
  whose dirty diffs are anchored to different current tips is meaningless; tier (b) is hard-gated
  on both `baseCommit` equality and current HEAD equality and degrades to tier (a) otherwise.
- **`merge-tree` blind spot.** It sees committed trees only; the verdict is labeled
  "committed changes only" and never suppresses a tier (a)/(b) warning about uncommitted work.
- **git < 2.38** (e.g. Ubuntu 22.04 ships 2.34; this machine has 2.50.1): version probe with
  graceful degradation; no probe exists in the codebase today.
- **TOCTOU.** Agents write while detection runs. A HEAD change during snapshot collection fails
  closed; merge trials use immutable captured SHAs. Dirty worktree content can still change after
  collection, so verdicts carry fingerprints and passive refresh latches status-visible staleness.
  The committed-only label and computed provenance invite an intentional re-run.
- **Untracked-file fragility.** Untracked diffs are recovered by scraping simple-git error text
  (`worktree.ts:1180-1186`); tier (b) inherits that fragility — one reason tier (a) (status-based,
  no scraping) is the always-on layer.
- **Aggregate size and process cost.** Per-file path lists are bounded; raw diff aggregation is NOT part of v1
  precisely because untracked-file diffs are unbounded multi-MB strings with no truncation policy.
  Deep checks accept at most ten distinct Workspaces; merge-tree trials default to concurrency 3
  (hard maximum 4), 15-second per-pair timeout, and 30-second overall deadline.
