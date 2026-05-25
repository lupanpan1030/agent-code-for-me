## ADDED Requirements

### Requirement: Local Runtime Registry
The system SHALL model supported coding-agent runtimes explicitly so Claude Code, Codex, and Antigravity CLI can be detected and presented without treating them as interchangeable model providers.

#### Scenario: Runtime metadata is requested
- **WHEN** the renderer requests local runtime status
- **THEN** the main process returns renderer-safe metadata for supported runtimes
- **AND** each runtime has a stable id, label, executable status, version when available, and local guidance
- **AND** the response does not include plaintext credentials, tokens, or keyring contents

#### Scenario: Runtime id is used across renderer surfaces
- **WHEN** renderer code needs to refer to an agent runtime
- **THEN** it uses a shared runtime id that includes `claude-code`, `codex`, and `antigravity`
- **AND** surfaces that only support persisted chat streaming use a narrower type that excludes unsupported runtimes
- **AND** unsupported runtime selections fail visibly instead of silently falling back to Claude Code

#### Scenario: Runtime is unavailable
- **WHEN** a runtime executable is missing, not executable, or cannot be resolved
- **THEN** the app reports that runtime as unavailable with a safe error and setup hint
- **AND** other runtimes remain usable

### Requirement: Sub-chat Runtime Selection
The system SHALL persist the selected runtime for each sub-chat instead of relying only on message-model inference.

#### Scenario: User creates an empty sub-chat
- **WHEN** the user creates a sub-chat while a runtime is selected
- **THEN** the sub-chat stores the selected runtime id
- **AND** reopening the chat restores that runtime selection without inspecting message text

#### Scenario: Existing sub-chat has no runtime field
- **WHEN** an older sub-chat lacks persisted runtime metadata
- **THEN** the app falls back to the current message-metadata inference
- **AND** it does not rewrite unrelated message data during read

### Requirement: Antigravity CLI Detection
The system SHALL detect Antigravity CLI from the local `agy` executable without requiring network access.

#### Scenario: `agy` is installed
- **WHEN** `agy` can be resolved from the user's shell environment or PATH
- **AND** safe version/help probing completes before the timeout
- **THEN** the app marks Antigravity CLI as available
- **AND** shows the executable path, version when available, and locally detected command summary

#### Scenario: `agy` is not installed
- **WHEN** `agy` cannot be resolved
- **THEN** the app marks Antigravity CLI as unavailable
- **AND** shows installation or setup guidance without blocking Claude Code or Codex

### Requirement: Command Guide Runtime Surface
The system SHALL surface Antigravity CLI in the command guide as a local runtime command surface.

#### Scenario: User opens Settings > Commands
- **WHEN** Antigravity CLI detection has completed
- **THEN** the command guide shows Antigravity CLI alongside Claude Code and Codex runtime status
- **AND** links to official Antigravity CLI documentation for complete command reference and setup
- **AND** labels Antigravity commands as runtime commands rather than Locus chat slash commands

#### Scenario: Local command output differs from official documentation
- **WHEN** local Antigravity help output and official documentation differ
- **THEN** the app explains that local output depends on the installed `agy` version
- **AND** does not imply that refreshing documentation updates the local executable

### Requirement: Project-Scoped Antigravity Launch
The system SHALL allow the user to launch Antigravity CLI from the active project or worktree without converting it into a persisted Locus chat stream.

#### Scenario: User launches Antigravity from a project
- **WHEN** the user launches Antigravity CLI from a selected project or worktree
- **AND** the `agy` executable is available
- **THEN** the app starts `agy` in a managed terminal session with the selected directory as `cwd`
- **AND** the user interacts with Antigravity CLI's own TUI, approvals, model settings, and session controls

#### Scenario: Antigravity launch fails
- **WHEN** the user launches Antigravity CLI
- **AND** `agy` is missing, not executable, or exits immediately
- **THEN** the app shows a retryable local runtime error
- **AND** does not create a misleading Locus chat session

### Requirement: Antigravity Credential Boundary
The system SHALL keep Antigravity CLI authentication and account state outside Locus credential storage.

#### Scenario: Antigravity requires login
- **WHEN** Antigravity CLI prompts for Google sign-in or account selection
- **THEN** the prompt is handled by Antigravity CLI's own flow
- **AND** Locus does not import, persist, display, or forward Google account tokens

#### Scenario: Renderer receives Antigravity status
- **WHEN** the main process reports Antigravity availability to the renderer
- **THEN** the report contains only safe metadata such as installed state, executable path, version, docs links, and setup hints
- **AND** it omits credentials and config secrets from Antigravity's settings or keyring

### Requirement: Chat Transport Gate
The system SHALL not present Antigravity CLI as a persisted Locus chat provider until a stable transport design is implemented.

#### Scenario: User selects a chat model/provider
- **WHEN** the Antigravity launch MVP is installed
- **THEN** Claude Code and Codex remain the supported persisted Locus chat providers
- **AND** Antigravity is offered as an external runtime launch surface rather than a chat model source

#### Scenario: Future Antigravity transport is proposed
- **WHEN** a future change adds a machine-readable Antigravity chat transport
- **THEN** that change defines session persistence, streaming normalization, cancellation, tool approval, and message storage behavior before exposing Antigravity as a chat provider
