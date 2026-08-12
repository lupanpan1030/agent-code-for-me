# cross-workspace-conflicts Specification Delta

New capability: collision awareness across concurrently active Workspaces. It aggregates evidence
and annotates; it does not merge, resolve, or reclassify.

## ADDED Requirements

### Requirement: Cross-Workspace Change Aggregation

The workbench task listing SHALL carry each project-backed Workspace's changed-file paths, derived
from git state the listing already collects, and SHALL NOT add git subprocess cost to the listing
path relative to the pre-existing per-Workspace summary. Path collection SHALL be robust to renamed
and space-containing paths. A Workspace whose git state cannot be read SHALL degrade to an error
summary for that Workspace only, contribute no paths, and never fail the listing.

#### Scenario: Listing carries changed-file paths at no added cost
- **WHEN** the workbench task listing refreshes over N project-backed Workspaces
- **THEN** each task includes its changed-file paths alongside the existing file/line counts
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

The system SHALL detect when two or more active Workspaces of the same project have changed the
same repo-relative path, and SHALL express severity in tiers that never overstate certainty:
path-level overlap SHALL be presented as a warning annotation; hunk-range overlap SHALL be
presented as a likely conflict ONLY when the Workspaces share the same recorded fork commit;
a merge trial SHALL be presented as definitive ONLY for committed trees and labeled as such.
Delete-versus-edit collisions SHALL be flagged distinctly. Conflict information SHALL annotate
tasks without changing their classified status, and deep (hunk/merge-trial) checks SHALL run only
on explicit user action, never on the passive refresh path. Clicking a conflict annotation SHALL
route into the existing per-Workspace diff surface filtered to the overlapping paths, not a new
review surface. All detection SHALL execute in the main process against registered worktree roots.

#### Scenario: Two Workspaces touch the same file
- **WHEN** two active Workspaces of one project have uncommitted or committed changes to the same
  repo-relative path
- **THEN** each affected task shows a warning annotation naming the overlapping path count and the
  sibling Workspaces
- **AND** the tasks' classified statuses and filter counts are unchanged

#### Scenario: Deep check on a shared fork commit
- **WHEN** the user explicitly requests a deep check on Workspaces whose recorded fork commits are
  equal
- **THEN** hunk-range overlap upgrades the annotation to a likely conflict for the overlapping files

#### Scenario: Deep check across different fork commits degrades honestly
- **WHEN** the user requests a deep check on Workspaces whose fork commits differ or are unrecorded
- **THEN** no hunk-level verdict is produced for those pairs
- **AND** the path-level warning remains, with the reason stated

#### Scenario: Delete-versus-edit collision
- **WHEN** one Workspace deletes a file that another Workspace has edited
- **THEN** the annotation flags the delete-versus-edit collision distinctly from an edit-edit overlap

#### Scenario: Conflict click routes into the existing diff surface
- **WHEN** the user activates a conflict annotation on a task
- **THEN** the existing per-Workspace diff surface opens for that task, filtered to the overlapping
  paths

### Requirement: Conflict Verdict Honesty

Deep-check verdicts SHALL be keyed to a per-Workspace fingerprint of the state they were computed
against, and displayed with that provenance. A merge-trial verdict SHALL state that it covers
committed changes only and SHALL NOT suppress a warning about uncommitted overlap. When the local
git version cannot perform a merge trial, the system SHALL degrade to the lower tiers and say so
rather than fail or fabricate a verdict. A verdict whose fingerprint no longer matches the
Workspace's current state SHALL be marked stale rather than silently re-trusted or silently
re-computed.

#### Scenario: Merge-trial verdict is labeled for scope
- **WHEN** a merge trial between two Workspaces reports no collision
- **THEN** the verdict states it covers committed changes only
- **AND** any path-level warning about uncommitted overlap on the same pair remains visible

#### Scenario: Older git degrades gracefully
- **WHEN** the local git version does not support the merge-trial capability
- **THEN** the deep check reports path and hunk tiers only, with the degradation stated

#### Scenario: A stale verdict is marked, not trusted
- **WHEN** a Workspace's state changes after a deep-check verdict was computed
- **THEN** the displayed verdict is marked stale on the next listing refresh
- **AND** no re-computation happens without an explicit user request
