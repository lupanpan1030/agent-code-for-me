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

### Requirement: Dangerous Router Inputs And Privileged Operation Clusters Are Inventoried
The system SHALL maintain a procedure-keyed field allowlist for findings produced from the architecture guard's enumerated dangerous renderer-input fields. A reviewed operation-cluster snapshot SHALL document privileged renderer routes not represented by those fields; that snapshot is preserved only as historical evidence in the archived design and has no separate living carrier or ongoing completeness guarantee until `add-trpc-capability-consent-audit` establishes one.

#### Scenario: Source guard detects an enumerated dangerous field
- **WHEN** the source guard detects `absolutePath`, `baseUrl`, `command`, `cwd`, `dirPath`, `env`, `filePath`, `headers`, `path`, `projectPath`, `token`, or `url` as a supported top-level tRPC input field
- **THEN** architecture checks SHALL require a matching procedure entry that allowlists every detected enumerated field or fail before merge.

### Requirement: Enumerated Renderer Filesystem Sinks Apply Registered-Root Boundaries
The renderer-reachable route families governed by this requirement are the file read, search, watch, rename, and delete routes; project-scoped command, agent, and skill routes; `terminal.listDirectory`; and project-scoped Claude MCP and MCP-registry configuration writes. They SHALL apply these registered-root boundaries before privileged effects: file reads and `terminal.listDirectory` SHALL reject real-path escape; file search SHALL omit symlinks; file watch SHALL require a registered root; rename/delete SHALL reject lexical out-of-root, traversal, null-byte, and invalid replacement targets; and the enumerated component/configuration writes SHALL require registered project or component roots.

#### Scenario: Renderer supplies forged project path to an enumerated route
- **WHEN** one of the enumerated route families receives a project path or cwd that does not resolve to the registered project, chat worktree, or terminal workspace for the request
- **THEN** the main process SHALL reject the request before the requested privileged filesystem or process effect.

#### Scenario: Strict target path contains traversal or a read/list symlink escape
- **WHEN** a target path governed by the strict path-boundary helper contains traversal or a null byte, or an enumerated read/list target resolves through a symlink outside the approved root
- **THEN** the main process SHALL reject the request before reading, writing, watching, opening, or deleting the target.

#### Scenario: File search or watch uses an unregistered root
- **WHEN** a renderer asks the file search or watch route to operate on a project path that is not a registered project path or chat worktree path
- **THEN** the main process SHALL reject the request before scanning or watching the directory.

#### Scenario: File rename or delete targets a path outside the registered root
- **WHEN** a renderer asks the file rename or delete route to operate on a lexical absolute path outside the supplied registered project or chat worktree root
- **THEN** the main process SHALL reject the request before renaming or deleting the target.

### Requirement: Runtime And Terminal Starts Use Server-Resolved Working Directories
Renderer-reachable Claude and Codex runtime starts SHALL resolve their execution cwd from server-side chat or sub-chat records, and terminal starts SHALL resolve cwd and startup command intents from registered server-side chat or workspace state.

#### Scenario: Runtime chat request forges cwd
- **WHEN** a renderer starts a Claude or Codex runtime chat with a cwd that differs from the server-side chat or sub-chat worktree
- **THEN** the main process SHALL reject or ignore the forged cwd and SHALL NOT start the runtime in the attacker-selected directory.

#### Scenario: Terminal request includes initial commands
- **WHEN** a renderer requests a terminal session with startup commands
- **THEN** the renderer SHALL send only predefined initial command intent IDs, and the main process SHALL reject raw command strings and resolve allowed intents to app-owned commands before starting the PTY.

#### Scenario: Terminal request forges cwd
- **WHEN** a renderer requests a terminal session with a cwd or scope that differs from the server-side chat or workspace record
- **THEN** the main process SHALL reject the forged request and SHALL NOT start the PTY in the attacker-selected directory.

### Requirement: GitHub Clone Uses Constrained Repository Identity
Renderer-reachable GitHub clone procedures SHALL parse renderer input into a GitHub owner/repository identity and SHALL execute Git through argv without shell interpretation.

#### Scenario: GitHub clone receives shell metacharacters
- **WHEN** a renderer submits a repository URL or shorthand containing shell metacharacters, extra URL path/query/fragment data, or Git clone option injection
- **THEN** the main process SHALL reject the input before spawning Git.

#### Scenario: GitHub clone executes
- **WHEN** a renderer submits a valid GitHub repository identity
- **THEN** the main process SHALL construct the canonical `https://github.com/<owner>/<repo>.git` clone URL and SHALL invoke `git clone` with argv, not a shell string.

### Requirement: MCP Stdio Command Writes Require Native Consent
Renderer-reachable MCP configuration writes that would persist a stdio command for later runtime execution SHALL require native main-process confirmation, SHALL remember approvals by command fingerprint, and runtime materialization SHALL fail closed for unapproved stdio commands.

#### Scenario: MCP stdio command write is not approved
- **WHEN** a renderer-reachable MCP add, update, or registry install request would persist a stdio `command`, `args`, `env`, env-var reference, or cwd for later runtime execution
- **THEN** the main process SHALL require native main-process confirmation before writing the config, and SHALL NOT persist the command when the user cancels or the confirmation cannot be completed.

#### Scenario: MCP stdio command fingerprint is already approved
- **WHEN** an MCP stdio command write has the same approved fingerprint for runtime, server name, scope, command, args, env, env-var references, and cwd
- **THEN** the main process SHALL allow the write without showing another confirmation.
- **AND** `projectPath` is intentionally excluded from the fingerprint, so an otherwise identical approved stdio command is reused across projects without another confirmation.

#### Scenario: Runtime sees unapproved MCP stdio command
- **WHEN** Claude or Codex runtime materialization encounters a stdio MCP command without an approved fingerprint
- **THEN** the main process SHALL omit that command from runtime startup materialization and SHALL NOT pass it to a stdio MCP transport for spawn.

### Requirement: Untrusted Renderer Content Uses Reviewed Rendering Boundaries
The renderer SHALL treat repository content, chat markdown, tool output, and MCP output as untrusted: markdown raw HTML SHALL pass through the configured sanitizer and hardener before insertion, active or scriptable content SHALL NOT pass through, files containing React `dangerouslySetInnerHTML` SHALL be limited to the reviewed file list enforced by a source guard, Mermaid SVG SHALL be sanitized, tool subtitles SHALL render as text, and the renderer CSP SHALL block inline and remote script execution in production. At this baseline, the markdown sanitizer guarantee depends on Streamdown 2.1.0's default `rehype-raw` -> `rehype-sanitize` -> `rehype-harden` chain; no retained in-repository malicious-HTML regression test directly exercises that guarantee, and `add-renderer-untrusted-content-hardening` owns the gap.

#### Scenario: Markdown active HTML and highlighted HTML sinks
- **WHEN** chat, repository, MCP, or tool-output markdown contains raw HTML or a renderer inserts syntax-highlighted HTML into the privileged app document
- **THEN** markdown HTML SHALL be sanitized and hardened so scriptable elements, event-handler attributes, and dangerous URLs do not pass through, and renderer files containing `dangerouslySetInnerHTML` SHALL be limited to the reviewed five-file list enforced by a source guard test.

#### Scenario: Mermaid diagram contains scriptable content
- **WHEN** chat, repository, MCP, or tool-output markdown renders a Mermaid diagram containing `click`, `javascript:` URLs, script tags, event handler attributes, or foreign-object content
- **THEN** the renderer SHALL use Mermaid strict mode and SHALL sanitize the resulting SVG before insertion into the privileged app document.

#### Scenario: Tool subtitle contains HTML
- **WHEN** a tool-call subtitle is derived from model, repository, MCP, tool input, or tool output text containing HTML or event handler payloads
- **THEN** the renderer SHALL render the subtitle as text or through an approved sanitizer and SHALL NOT insert it as raw HTML.

#### Scenario: Production renderer CSP permits script execution
- **WHEN** the production renderer CSP is evaluated for the privileged app document
- **THEN** it SHALL NOT allow inline scripts, broad JavaScript `unsafe-eval`, or remote script origins, and any remaining WebAssembly compilation exception SHALL be documented with the code that blocks removal.

#### Scenario: Development renderer CSP permits Vite HMR
- **WHEN** the development renderer CSP is evaluated for the privileged app document
- **THEN** any inline-script or localhost connection allowance SHALL be scoped to development Vite HMR and SHALL NOT be present in the production renderer CSP.
