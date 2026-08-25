# agent-workbench Specification Delta

One requirement is modified: "Workbench Task Actions" gains a scenario for inspecting a
cross-Workspace conflict annotation. The full requirement is pasted; every existing scenario is
reproduced verbatim. The status-classification requirement is deliberately NOT modified — conflicts
annotate tasks, they do not reclassify them (see the change's design Decision 2).

## MODIFIED Requirements

### Requirement: Workbench Task Actions
The system SHALL expose safe actions that reuse existing local chat, diff, and GitHub workflow behavior.

#### Scenario: User opens a task
- **WHEN** the user chooses Open or Continue on a workbench task
- **THEN** the app navigates to the matching chat
- **AND** selects the latest or requested sub-chat when available

#### Scenario: User reviews a task
- **WHEN** the user chooses Review Diff on a task with reviewable changes
- **THEN** the app opens the existing diff/review surface for that task
- **AND** the action is disabled with a reason when no worktree or diff is available

#### Scenario: User opens or creates a pull request
- **WHEN** the user chooses Open PR on a task with a pull request URL
- **THEN** the app opens that pull request externally
- **WHEN** the user chooses Create PR on a task without a pull request
- **THEN** the app uses the existing GitHub workflow preparation and confirmation flow
- **AND** no public GitHub write occurs without explicit confirmation

#### Scenario: User inspects a cross-workspace conflict
- **WHEN** the user activates a conflict annotation on a task card
- **THEN** the app opens the existing diff/review surface for that task filtered to the overlapping
  paths
- **AND** no new review surface is introduced and the task's classified status is unchanged
