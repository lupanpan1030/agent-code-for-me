## ADDED Requirements

### Requirement: Dangerous Router Inputs And Privileged Operation Clusters Are Inventoried
The system SHALL maintain a procedure-keyed field allowlist for findings produced from the architecture guard's enumerated dangerous renderer-input fields and SHALL maintain a reviewed operation-cluster inventory for privileged renderer routes not represented by those fields.

#### Scenario: Source guard detects an enumerated dangerous field
- **WHEN** the source guard detects `absolutePath`, `baseUrl`, `command`, `cwd`, `dirPath`, `env`, `filePath`, `headers`, `path`, `projectPath`, `token`, or `url` as a supported top-level tRPC input field
- **THEN** architecture checks SHALL require a matching procedure entry that allowlists every detected enumerated field or fail before merge.

### Requirement: Hardened Renderer Filesystem Sinks Apply Registered-Root Boundaries
The renderer-reachable file, component, terminal-directory, and project-scoped configuration routes hardened by this change SHALL apply their implemented registered-root boundary before the privileged effect: file reads and directory listing SHALL reject real-path escape, file search SHALL omit symlinks, file watch SHALL require a registered root, rename/delete SHALL reject lexical out-of-root, traversal, null-byte, and invalid replacement targets, and component/configuration writes SHALL require registered project or component roots.

#### Scenario: Renderer supplies forged project path to a hardened route
- **WHEN** one of the hardened routes receives a project path or cwd that does not resolve to the registered project, chat worktree, or terminal workspace for the request
- **THEN** the main process SHALL reject the request before the requested privileged filesystem or process effect.

#### Scenario: Strict target path contains traversal or a read/list symlink escape
- **WHEN** a target path governed by the strict path-boundary helper contains traversal or a null byte, or a hardened read/list target resolves through a symlink outside the approved root
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

#### Scenario: Runtime sees unapproved MCP stdio command
- **WHEN** Claude or Codex runtime materialization encounters a stdio MCP command without an approved fingerprint
- **THEN** the main process SHALL omit that command from runtime startup materialization and SHALL NOT pass it to a stdio MCP transport for spawn.

### Requirement: Untrusted Renderer Content Uses Reviewed Rendering Boundaries
The renderer SHALL treat repository content, chat markdown, tool output, and MCP output as untrusted: markdown raw HTML SHALL pass through the configured sanitizer and hardener before insertion, active or scriptable content SHALL NOT pass through, files containing React `dangerouslySetInnerHTML` SHALL be limited to the reviewed file list enforced by a source guard, Mermaid SVG SHALL be sanitized, tool subtitles SHALL render as text, and the renderer CSP SHALL block inline and remote script execution in production.

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
