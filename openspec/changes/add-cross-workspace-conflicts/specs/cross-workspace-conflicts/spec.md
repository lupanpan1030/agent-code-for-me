# cross-workspace-conflicts Specification Delta

New capability: collision awareness across concurrently active Workspaces. It aggregates evidence
and annotates; it does not merge, resolve, or reclassify.

## ADDED Requirements

### Requirement: Cross-Workspace Change Aggregation

The workbench task listing SHALL carry each project-backed Workspace's status-visible changed-file
paths, derived from the structured git status state the listing already collects, and SHALL NOT add
git subprocess cost to the listing path relative to the pre-existing per-Workspace summary. This
listing is status-derived by design: once overlapping edits are fully committed and no longer appear
in status, they SHALL contribute no tier-(a) paths or annotations. The listing SHALL NOT claim
committed-change coverage; committed-tree overlap is the explicit deep check's responsibility. Path
collection SHALL be robust to renamed and space-containing paths. A Workspace whose git state
cannot be read SHALL degrade to an error summary for that Workspace only, contribute no paths, and
never fail the listing.

#### Scenario: Listing carries changed-file paths at no added cost
- **WHEN** the workbench task listing refreshes over N project-backed Workspaces
- **THEN** each task includes its status-visible changed-file paths alongside the existing file/line
  counts
- **AND** the listing issues no git invocation beyond those the pre-existing summary already issued

#### Scenario: A broken worktree degrades alone
- **WHEN** one Workspace's worktree is missing or unreadable during a refresh
- **THEN** that task reports an error summary with no paths
- **AND** every other Workspace's paths and conflict annotations are unaffected

#### Scenario: Renamed paths do not corrupt aggregation
- **WHEN** a Workspace's changes include a renamed file or a path containing spaces
- **THEN** the aggregated paths are the true repo-relative paths
- **AND** rename arrow syntax never appears as a literal path

### Requirement: Same-File Conflict Detection

The system SHALL detect when two or more active Workspaces of the same project have uncommitted,
status-visible changes to the same repo-relative path, and SHALL express severity in tiers that
never overstate certainty: path-level overlap SHALL be presented as a warning annotation;
hunk-range overlap SHALL be presented as a likely conflict ONLY when the Workspaces share the same
recorded fork commit AND the same current HEAD; a merge trial SHALL be presented as definitive ONLY
for committed trees and labeled as such.
Delete-versus-edit collisions SHALL be flagged distinctly. Conflict information SHALL annotate
tasks without changing their classified status, and deep (hunk/merge-trial) checks SHALL run only
on explicit user action, never on the passive refresh path. A task card SHALL offer that explicit
deep check whenever its project has at least two eligible sibling Workspaces (branch-mode and
non-archived, with distinct resolved worktree directories), regardless of whether a path-level
warning exists. The server mutation SHALL apply the same eligibility rules rather than trusting the
listing or renderer, SHALL cap a request at ten unique task IDs, and SHALL verify the registered
project/worktree boundary before any Git IO. Clicking a conflict annotation
SHALL route into the existing per-Workspace diff surface filtered to the overlapping paths, not a
new review surface. All detection SHALL execute in the main process against registered worktree
roots.

#### Scenario: Two Workspaces touch the same file
- **WHEN** two active Workspaces of one project have uncommitted changes visible in git status for
  the same repo-relative path
- **THEN** each affected task shows a warning annotation naming the overlapping path count and the
  sibling Workspaces
- **AND** the tasks' classified statuses and filter counts are unchanged

#### Scenario: Committed-only conflict pair is reachable without a warning
- **WHEN** at least two eligible sibling Workspaces have overlapping edits that are fully committed
  so neither Workspace has a tier-(a) annotation
- **THEN** the deep-check affordance remains available on their task cards
- **AND** an explicit invocation runs the committed-tree merge trial and returns its scoped verdict

#### Scenario: Deep check on a shared fork commit and current HEAD
- **WHEN** the user explicitly requests a deep check on Workspaces whose recorded fork commits and
  current HEADs are equal
- **THEN** hunk-range overlap upgrades the annotation to a likely conflict for the overlapping files

#### Scenario: Deep check across different fork commits degrades honestly
- **WHEN** the user requests a deep check on Workspaces whose fork commits differ or are unrecorded
- **THEN** no hunk-level verdict is produced for those pairs
- **AND** any existing path-level warning remains, with the reason stated

#### Scenario: Equal fork commits with divergent current HEADs degrade honestly
- **WHEN** the user requests a deep check on Workspaces whose recorded fork commits are equal but
  whose current HEADs differ
- **THEN** no hunk-level verdict is produced for those pairs
- **AND** any existing path-level warning remains, with `head-commits-differ` stated as the reason

#### Scenario: Delete-versus-edit collision
- **WHEN** one Workspace deletes a file that another Workspace has edited
- **THEN** the annotation flags the delete-versus-edit collision distinctly from an edit-edit overlap

#### Scenario: Conflict click routes into the existing diff surface
- **WHEN** the user activates a conflict annotation on a task
- **THEN** the existing per-Workspace diff surface opens for that task, filtered to the overlapping
  paths

#### Scenario: Direct invalid mutation fails before Git work
- **WHEN** a caller directly requests a deep check containing an archived task, tasks from different
  projects, a missing branch/worktree, a duplicate task ID, or two tasks resolving to one directory
- **THEN** the server rejects the request as invalid
- **AND** no diff, HEAD, base-commit, capability, or merge-tree Git operation starts

### Requirement: Conflict Verdict Honesty

Deep-check verdicts SHALL be keyed to a per-Workspace fingerprint of the state they were computed
against, and displayed with that provenance. Every merge-trial verdict presentation SHALL state
that it covers committed changes only and SHALL NOT suppress a warning about uncommitted overlap.
When the local git version cannot perform a merge trial, the system SHALL degrade to the lower tiers
and say so rather than fail or fabricate a verdict. Passive staleness SHALL be based on observed
status hashes, so its guarantee is limited to status-visible changes and a HEAD SHA change alone
SHALL NOT make a pair stale. Once a status-hash mismatch or missing current status hash has made a
pair stale, it SHALL remain stale until an explicit successful re-run, even if the observed hash
later cycles back to its computed value. The committed-only scope label and computed-at provenance
SHALL remain visible so a matching status hash is never presented as proof that the committed-tree
verdict is current. While an explicit re-run is pending, the last successful verdict SHALL remain
rendered. Each Workspace snapshot SHALL be collected in `HEAD-before → diff → HEAD-after` order;
if the captured HEAD changes, hunk and merge verdicts for that Workspace SHALL be unavailable.
Committed-tree trials SHALL consume the captured commit SHAs rather than mutable branch refs.
Pair trials SHALL have bounded concurrency, a per-trial timeout, and an overall batch deadline;
timeout or deadline exhaustion SHALL degrade the affected verdicts to labeled unavailable results.

#### Scenario: Merge-trial verdict is labeled for scope
- **WHEN** a merge-trial verdict between two Workspaces is displayed
- **THEN** the presentation states it covers committed changes only
- **AND** it shows the computed-at fingerprint provenance rather than implying live committed-tip
  freshness
- **AND** any path-level warning about uncommitted overlap on the same pair remains visible

#### Scenario: Older git degrades gracefully
- **WHEN** the local git version does not support the merge-trial capability
- **THEN** the deep check reports path and hunk tiers only, with the degradation stated

#### Scenario: A status-visible stale verdict is marked and latched
- **WHEN** a Workspace's observed current status hash differs from or is unavailable relative to a
  deep-check verdict's computed status hash
- **THEN** the displayed verdict is marked stale on the next listing refresh
- **AND** it remains stale until an explicit successful re-run even if the status hash later returns
  to its computed value
- **AND** no re-computation happens without an explicit user request

#### Scenario: A pending re-run preserves the prior verdict
- **WHEN** the user explicitly re-runs a deep check after a successful verdict
- **THEN** the last successful verdict remains rendered while the new request is pending

#### Scenario: Workspace HEAD changes while collecting evidence
- **WHEN** a Workspace HEAD differs between the reads immediately before and after its diff
- **THEN** the result records no stable HEAD SHA for that Workspace
- **AND** hunk and committed-tree verdicts involving it are unavailable with the snapshot-change reason
- **AND** no merge trial starts for those pairs

#### Scenario: Branch refs change after capture
- **WHEN** both Workspace HEAD SHAs were captured successfully and a branch ref later moves or disappears
- **THEN** the committed-tree trial still evaluates the captured immutable SHAs
- **AND** provenance reports those same SHAs

#### Scenario: Merge-trial budget is exhausted
- **WHEN** a pair trial exceeds its timeout or queued pairs reach the overall deadline
- **THEN** the response completes with those pairs labeled unavailable
- **AND** the server does not start further queued trials after the deadline

### Requirement: Fork Commit Capture Is Write-Once

The system SHALL persist the worktree fork commit when it is known at creation. For an existing
Workspace whose fork commit is absent, lazy backfill SHALL choose only an unambiguous candidate and
SHALL persist it with a database compare-and-set conditioned on the field remaining null. Concurrent
backfill callers SHALL converge on the first stored value and SHALL NOT overwrite it. An unavailable
or ambiguous candidate SHALL leave the field null and SHALL make hunk comparison unavailable rather
than inventing history.

#### Scenario: Concurrent lazy backfill converges
- **WHEN** two conflict checks both observe a null fork commit and compute different candidates
- **THEN** at most one conditional database update succeeds
- **AND** both callers return the same persisted winner

#### Scenario: Historical fork point is ambiguous
- **WHEN** local and remote base refs yield distinct equally ranked merge-base candidates
- **THEN** no fork commit is persisted
- **AND** hunk-level comparison degrades to unavailable
