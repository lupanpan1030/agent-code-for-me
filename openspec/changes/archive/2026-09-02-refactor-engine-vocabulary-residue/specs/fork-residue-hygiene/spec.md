## ADDED Requirements
### Requirement: Legacy fork worktree config is read-only compatibility

The application MUST NOT offer the legacy fork path `.1code/worktree.json` as a worktree-config
save target. It MUST continue reading existing `.1code/worktree.json` (and `.cursor/worktrees.json`)
files through the established detection priority so no user configuration is lost.

#### Scenario: Save targets exclude the legacy fork path

- **WHEN** the worktree settings tab offers config save targets
- **THEN** `.1code/worktree.json` is not among them
- **AND** `.locus/worktree.json` remains the primary target

#### Scenario: Existing legacy config still loads

- **WHEN** a project contains only a `.1code/worktree.json` config
- **THEN** worktree config detection still reads it via the unchanged priority
  (custom > `.locus/worktree.json` > `.cursor/worktrees.json` > `.1code/worktree.json`)
- **AND** the UI shows its source without offering to write back to it
