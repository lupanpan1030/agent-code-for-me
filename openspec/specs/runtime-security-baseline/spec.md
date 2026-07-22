# runtime-security-baseline Specification

## Purpose
TBD - created by archiving change harden-runtime-security-baseline. Update Purpose after archive.
## Requirements
### Requirement: Provider Secrets Stay In Main-Process Boundaries
The system SHALL keep provider tokens, voice transcription keys, and runtime gateway credentials out of renderer persistence and inherited environment fallback paths.

#### Scenario: Voice transcription uses helper provider storage
- **WHEN** voice transcription is available
- **THEN** the renderer SHALL only send audio payloads and non-secret request metadata
- **AND** the main process SHALL resolve the configured `voice_transcription` helper provider credential.

#### Scenario: Inherited environment contains stale provider secrets
- **WHEN** an inherited shell or process environment contains stale provider API keys
- **THEN** selected app-managed runtime/provider configuration SHALL NOT be silently overridden by those inherited secrets.

### Requirement: Provider Gateway Errors Are Redacted
The system SHALL redact provider tokens, gateway tokens, custom secret headers, bearer values, and credentialed URLs before returning upstream gateway errors.

#### Scenario: Upstream error body echoes a provider token
- **WHEN** an upstream provider returns a failed response whose body includes a configured provider token or custom secret header value
- **THEN** the gateway SHALL return a redacted error
- **AND** the raw secret SHALL NOT be exposed to the renderer or runtime client.

### Requirement: Raw Runtime Logs Are Explicit Opt-In
The system SHALL keep raw Claude runtime logging disabled unless the user or developer explicitly enables it with `CLAUDE_RAW_LOG=1`.

#### Scenario: Development app starts without raw log opt-in
- **WHEN** the app runs in development without `CLAUDE_RAW_LOG=1`
- **THEN** raw Claude messages SHALL NOT be written to the user data log directory.

#### Scenario: Raw log opt-in is enabled
- **WHEN** `CLAUDE_RAW_LOG=1` is set
- **THEN** raw Claude messages MAY be written to the bounded raw log directory
- **AND** logging errors SHALL NOT break the main runtime flow.

### Requirement: MCP Configuration Writes Are Scoped
The system SHALL guard Claude MCP configuration mutations with normalized server names and registered project path resolution.

#### Scenario: Renderer requests a project-scoped MCP write
- **WHEN** the renderer requests a project-scoped MCP server add, update, remove, or bearer-token write
- **THEN** the main process SHALL require a registered project path
- **AND** use the registered project path when mutating Claude configuration.

#### Scenario: Renderer supplies an invalid server name
- **WHEN** an MCP server name contains unsupported characters or is empty after trimming
- **THEN** the mutation SHALL be rejected before writing Claude configuration.

### Requirement: Protocol Job Paths Are Canonical
The system SHALL canonicalize protocol job working directories through the registered project guard before creating or running headless ACP jobs.

#### Scenario: Protocol job uses a relative cwd
- **WHEN** an ACP protocol job run request supplies a relative or symlinked cwd inside a registered project
- **THEN** the stored job cwd SHALL be the canonical existing path.

### Requirement: Repository Worktree Setup Requires Explicit Trust
The system SHALL NOT execute repository-provided worktree setup commands until the user has explicitly approved the exact setup command fingerprint for that project.

#### Scenario: Worktree setup config is first detected
- **WHEN** a project worktree is created and a setup command exists in `.locus/worktree.json`, `.cursor/worktrees.json`, or `.1code/worktree.json`
- **THEN** the main process SHALL NOT execute the setup command
- **AND** the renderer SHALL show the config source, config path, and original command list for user review.

#### Scenario: User approves setup commands
- **WHEN** the user approves the displayed setup command list for the project
- **THEN** the main process SHALL remember the approval by project and setup command fingerprint
- **AND** only then MAY execute the approved command list in the worktree.

#### Scenario: Setup commands change after approval
- **WHEN** the setup config source, config path, platform, or command list changes after approval
- **THEN** the setup command fingerprint SHALL change
- **AND** the main process SHALL require fresh user approval before executing the changed commands.

### Requirement: Renderer-Reachable File Reads Stay Inside Registered Roots
The system SHALL reject renderer-reachable file read requests unless the requested file resolves inside a registered project root or chat worktree root.

#### Scenario: Renderer requests an arbitrary absolute path
- **WHEN** a renderer-reachable file read route receives an absolute file path outside the supplied registered root
- **THEN** the main process SHALL reject the request before reading the file.

#### Scenario: Renderer supplies an unregistered read root
- **WHEN** a renderer-reachable file read route receives a root that is not a registered project path or chat worktree path
- **THEN** the main process SHALL reject the request before reading the file.

### Requirement: Command File Mutations Stay Inside Command Roots
The system SHALL restrict command file read, update, and delete paths to the Claude user command directory or the selected project's `.claude/commands` directory.

#### Scenario: Renderer supplies an absolute command path
- **WHEN** a command file route receives an absolute path or a path traversal segment
- **THEN** the main process SHALL reject the request before reading, writing, or deleting the target.

### Requirement: MCP OAuth Tokens Are Not Stored In Shared Claude Config
The system SHALL store MCP OAuth access and refresh tokens only in app-owned safeStorage-backed storage, not in shared Claude CLI configuration.

#### Scenario: OAuth tokens are saved or refreshed
- **WHEN** an MCP OAuth access token or refresh token is saved after login or refresh
- **THEN** `~/.claude.json` SHALL contain only non-sensitive OAuth metadata and SHALL NOT contain bearer Authorization headers, access tokens, or refresh tokens.

#### Scenario: Runtime prepares OAuth MCP config
- **WHEN** the runtime prepares an OAuth MCP server for SDK/tool access
- **THEN** it SHALL decrypt the stored token and materialize the Authorization header only in the in-memory runtime config.

#### Scenario: Legacy plaintext OAuth config is encountered
- **WHEN** an existing Claude config contains plaintext MCP OAuth access or refresh tokens
- **THEN** the system SHALL migrate the tokens into safeStorage-backed app storage and scrub the plaintext fields from Claude config.

