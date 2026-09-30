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

The renderer SHALL treat repository content, chat markdown, tool output, MCP
output, plugin-controlled UI manifests, highlighted code, and editable-content
state as untrusted. Plugin-controlled UI manifests SHALL remain classified-safe
only as schema-bounded text validated by
`src/shared/plugin-controlled-ui.ts#parseControlledUiManifest`
and rendered as React text; richer surface types SHALL revisit that producer
classification. Static and
streaming markdown raw HTML SHALL pass through one reviewed sanitizer/hardener
policy with retained adversarial behavior tests. Every Locus-owned
value-bearing raw-markup insertion SHALL appear in an exact source-guard
inventory and accept output only from its named reviewed producer; a whole-file
exemption SHALL NOT be sufficient. Generated highlighted HTML SHALL fail closed
to escaped text, a bounded error, or no render when generation or extraction
fails. Editable content SHALL be restored from canonical structured state
through safe DOM construction rather than replaying untrusted HTML. Mermaid SVG
SHALL remain sanitized, tool subtitles SHALL render as text, and the renderer
CSP SHALL block inline and remote script execution in production.

Retained behavior suites SHALL share the rendered-DOM oracle specified by the
`renderer-html-policy.ts` owner in design D2, with explicit profiles for markdown,
highlighted code, Mermaid SVG, diff, and the editor, implemented by the shared test
helper in D2. Within each untrusted-content subtree the oracle SHALL reject
script/iframe/object/embed/frame/base/meta/link/
foreignObject, animation (`animate*`/`set`), and MathML `maction` elements;
`style` elements other than the single value-profile-validated Mermaid paint
element allowed only by the Mermaid profile and its pre-render `secure` rule,
or the exact constant style allowed only by the diff profile below;
`on*` attributes; `srcdoc`; and executable, encoded, or disallowed URL schemes in
`href`, `src`, `xlink:href`, `action`, `formaction`, `poster`, or `data`.
`javascript:`, `data:`, `vbscript:`, `file:`, and `blob:` URL values SHALL be
rejected in these untrusted subtrees. URL decisions SHALL use parsed DOM values
and the attribute's context: reviewed HTTP(S) links/images, `mailto:` links,
reviewed relative links resolved against the trusted base, and same-SVG local
fragment references are permitted only by the corresponding explicit profile.
Safe formatting and approved diagram styling SHALL have positive controls.
The Mermaid profile SHALL retain the single Mermaid-generated `<style>` only
after reviewed CSS value-profile validation: every selector SHALL be scoped to
the diagram id namespace; `url(`, `@import`, `expression(`, `behavior:`, root-level
`position:fixed`/`position:absolute`, and external references SHALL be forbidden.
The pinned configuration's existing `secure` list SHALL include `themeCSS`,
`themeVariables`, `theme`, `fontFamily`, `altFontFamily`, and `htmlLabels` before
rendering so source directives cannot change styling before the transient
mount. Unprovable suppression or failed CSS validation SHALL fail closed;
unreviewed CSS-bearing attributes SHALL be stripped. No other `style` element
SHALL be admitted by the Mermaid oracle.

Per rendered `<FileDiff>`/`<PatchDiff>` subtree, the strictly enumerated diff profile SHALL require exactly one `<style data-unsafe-css>` element whose child nodes are only Text and `br` nodes and whose `textContent` is byte-equal to `wrapUnsafeCSS(PIERRE_DIFFS_THEME_CSS)` (the public `@pierre/diffs` export applied to the repository constant) with every `\n`/`\r` code point removed. That transform mirrors the library's `innerText` write, which replaces each line break with a `br` element; the `br` nodes are that write's artefact, not a producer-output allowance, and the compared `textContent` is the CSS the browser actually applies. Any other `style` element, missing marker, any non-Text/non-`br` child, or any other text drift SHALL fail; a negative control SHALL prove that one added non-line-break character in the constant still fails.
The constant CSS is app-owned input, never producer output. The profile SHALL
allow `href` on `use` only when it matches `^#diffs-icon-[a-z0-9-]+$` inside a
separator/expand-button subtree. Adopted constructed stylesheets are not
elements and need no allowance. All remaining nodes, attributes and URLs,
including every Shadow DOM descendant, SHALL retain the global oracle rules.
Fixtures SHALL use Locus's actual option set: `disableFileHeader: true`,
`unsafeCSS: PIERRE_DIFFS_THEME_CSS`, default `hunkSeparators` (`line-info`),
and `expandUnchanged: false`.

#### Scenario: Markdown active HTML and highlighted HTML sinks

- **WHEN** chat, repository, MCP, or tool-output markdown in either app render
  mode contains scripts, active HTML/SVG/MathML, event-handler attributes,
  executable URLs, or a malformed/incomplete variant of those payloads
- **THEN** the rendered privileged app DOM SHALL satisfy the shared
  rendered-DOM oracle for its reviewed content profile
- **AND** retained behavior tests SHALL also prove that the reviewed safe
  formatting subset still renders
- **AND** both app markdown modes SHALL use the same explicit raw/sanitize/
  harden chain, whose sanitizer schema derives from `rehype-sanitize`'s
  `defaultSchema`; the hardener receives an empty protocol allowlist (no
  wildcard protocol), refuses data images and uses the `*` link/image
  prefixes; the hardener's built-in safe-protocol set and relative-URL
  handling are not relied on, because the reviewed sanitizer schema alone
  enforces the absolute `http`/`https` policy (plus `mailto` for links), and
  the hardener is defense in depth; parity fixtures SHALL cover the remark
  configuration as well as the replacing rehype chain
- **AND** the wrapper's `code`/`pre` overrides SHALL keep Streamdown's built-in
  Mermaid renderer dormant, proven by the absence of its `aria-label="Mermaid
  chart"` element; custom-scheme and relative-link fixtures SHALL exercise the
  reviewed `openExternalUrl` click boundary

#### Scenario: The app markdown pipeline throws while rendering untrusted content

- **WHEN** a parser or plugin throws in either app Streamdown mount
- **THEN** the shared app-owned markdown error boundary SHALL render the source
  as escaped text without unmounting the surrounding chat view
- **AND** a forced-throw behavior fixture SHALL prove the fallback satisfies
  the shared rendered-DOM oracle

#### Scenario: A raw-markup insertion is introduced or changed

- **WHEN** renderer source adds or changes `dangerouslySetInnerHTML`, a
  value-bearing direct DOM HTML assignment, `insertAdjacentHTML`, `srcDoc`,
  `document.write`, a contextual fragment, an equivalent raw-markup sink,
  dynamic script creation/`script.src`, remote `import()`, or `importScripts`
  or raw-markup/raw-CSS props passed to a DOM-producing dependency
- **THEN** the renderer source guard SHALL require an exact insertion-point
  entry naming its reviewed producer and adversarial behavior test or fail
  before merge
- **AND** adding a sink inside an already reviewed file SHALL NOT bypass the
  guard
- **AND** the guard SHALL scan all of `src/renderer`, including `public/` and
  `.ts`/`.tsx`/`.html`/`.js`/`.jsx`/`.mjs`/`.cjs` files, with negative fixtures
  for the scanned classes and a rule flagging new Shiki-API shims or Vite aliases
  into DOM-producing dependencies
- **AND** a named dependency-prop rule SHALL require both diff `unsafeCSS`
  arguments to be the single `PIERRE_DIFFS_THEME_CSS` constant identifier,
  rejecting expressions/interpolated templates and untrusted interpolation in
  its declaration; that same constant SHALL drive the diff-profile comparison.
  `prerenderedHTML` SHALL be absent unless explicitly bound to a reviewed
  producer and behavior gate; broad string scanning is not this named rule

#### Scenario: Highlighted HTML reaches a raw insertion sink

- **WHEN** untrusted chat, repository, MCP, tool, or message-JSON code is
  converted to highlighted HTML
- **THEN** markup-breaking source characters SHALL remain non-executable at the
  insertion boundary under the shared rendered-DOM oracle
- **AND** a generator exception, output-shape mismatch, or extraction failure
  SHALL NOT fall back to inserting the original source as HTML
- **AND** extraction SHALL positively validate exactly one top-level
  `<pre><code>` wrapper and consume the complete output; forced-mismatch and
  forced dual-`<code>` fixtures SHALL reject silent regex truncation

#### Scenario: Dependency diff rendering is covered by the reviewed-producer contract

- **WHEN** repository content renders through `<FileDiff>` or `<PatchDiff>` via the
  Locus-owned `pierre-diffs-shiki-shim.ts` and its Vite aliases
- **THEN** black-box hostile filename, hunk-header, line-content, and patch-text
  fixtures SHALL exercise that actual path and apply the shared rendered-DOM
  oracle's diff profile to its resulting DOM, including every Shadow DOM
  descendant: exactly one `style[data-unsafe-css]` with only Text/`br` children whose `textContent` is byte-equal to `wrapUnsafeCSS(PIERRE_DIFFS_THEME_CSS)` with `\n`/`\r` removed (the library's `innerText` write), and `use[href]` matching
  `^#diffs-icon-[a-z0-9-]+$` only in separator/expand-button subtrees; adopted
  constructed stylesheets are not elements and need no allowance. The CSS is
  app-owned input, never producer output; all other DOM keeps the global rules
- **AND** both fixtures SHALL use `disableFileHeader: true`,
  `unsafeCSS: PIERRE_DIFFS_THEME_CSS`, default `hunkSeparators` (`line-info`),
  and `expandUnchanged: false`, including benign collapsed multi-region controls
- **AND** `@pierre/diffs@1.0.10` (`bun.lock:476`), un-aliased
  `hast-util-to-html@9.0.5` (`:1360`, the load-bearing production-bundle
  `toHtml` escaper), and the actual Shiki resolution SHALL be exact-pinned:
  nested `shiki@3.21.0` under @pierre/diffs (`:2300`), hoisted
  `@shikijs/core@3.21.0` / `@shikijs/engine-javascript@3.21.0` (`:618,620`),
  and `@shikijs/transformers@3.22.0` (`:628`) with nested core/types `3.22.0`
  (`:2328,2330`); the Shiki subtree is installed but aliased away from the
  production diff path, and remains inventoried for test/type resolution
- **AND** the pin of record SHALL be committed `bun.lock` plus
  `bun install --frozen-lockfile`, enforced by a retained lockfile-assertion
  test for all those anchors and separate app Shiki `1.29.2`. A flat
  `@shikijs/core` override SHALL NOT collapse the mixed resolution; top-level
  overrides may select only globally correct versions. Historical pnpm
  metadata SHALL NOT be treated as this Bun pin mechanism
- **AND** the fixtures and design D10 row SHALL gate dependency, Locus shim,
  and four-specifier Vite alias changes. A `bun test --isolate` `<FileDiff>`/
  `<PatchDiff>` fixture SHALL bind `shiki`, `shiki/core`,
  `@shikijs/engine-javascript`, and `@shikijs/transformers` to the shim before
  importing the diff renderer and assert its `createPlainHast` text-node shape
  before hostile cases; an unbound test runs nested real Shiki 3 and SHALL NOT
  count as shim evidence. A built-renderer fixture with the same binding
  assertion is an alternative
- **AND** the reviewed producer SHALL be limited to the main-thread,
  context-free path. A source-guard rule SHALL fail on import/mount/use of
  `@pierre/diffs/worker`, `worker-portable.js`, `WorkerPoolContextProvider`,
  `getOrCreateWorkerPoolSingleton`, or a `workerFactory` option; enabling the
  worker pool requires a new scope decision and separate producer review
- **AND** implementation evidence SHALL prove producer binding in development
  GUI track 5.1 and packaged track 5.3. Development pre-bundling's use of the
  plugin `resolveId` hook is unverified at the draft baseline and SHALL NOT be
  inferred from production bundling or a bound bun test
- **AND** Shadow DOM SHALL NOT be treated as a script/CSP boundary

#### Scenario: Mentions editor receives browser rich content or restores content

- **WHEN** the mentions editor receives clipboard/drop data, any browser
  rich-content insertion input type, or an undo/redo entry containing
  attacker-controlled markup
- **THEN** the editor itself SHALL prevent browser rich-content insertion,
  consume only explicit `text/plain` through the safe builder or reject it,
  and reject HTML-only clipboard/drop data
- **AND** one component-owned `beforeinput` allowlist SHALL admit ordinary
  `insertText`, `insertCompositionText`, and all `delete*` inputTypes, including
  `deleteByCut`, `deleteByDrag`, `deleteWord*`, and `deleteSoftLine*`.
  `insertParagraph`/`insertLineBreak` SHALL prevent browser default and insert
  the newline through the safe text-node/`br` builder without `div` wrappers,
  preserving non-shift Enter submit. `historyUndo`/`historyRedo` SHALL also
  prevent browser default and route through canonical state restoration;
  ordinary text/IME input and admitted deletions SHALL NOT be blanket-prevented
- **AND** all other input types,
  including `insertFromPaste`, `insertFromDrop`, `insertLink`,
  `insertReplacementText`, and `format*`, SHALL be prevented and handled only
  by the explicit safe insertion path if supported
- **AND** component-owned paste/drop/drag-over gates SHALL prevent browser
  defaults independently of optional parent handlers; typed attachment/image
  delegation SHALL remain an explicit callback
- **AND** undo/redo SHALL retain lossless canonical text/atomic-mention runs and
  logical selection state, rebuilding with safe DOM construction rather than a
  value-bearing `.innerHTML` restore
- **AND** synthetic clipboard/drop/input fixtures SHALL prove default
  prevention, unchanged DOM for HTML-only input, safe-builder insertion for
  plain text, and only text nodes, `<br>`, and reviewed mention spans under the
  editor oracle; native rich-paste/drop rejection and undo/redo SHALL be proven
  separately in GUI track 5.1 because happy-dom does not implement native
  contentEditable editing or `execCommand`

#### Scenario: Mermaid diagram contains scriptable content

- **WHEN** chat, repository, MCP, or tool-output markdown renders a Mermaid
  diagram containing `click`, `javascript:` URLs, script tags, event-handler
  attributes, foreign-object content, hostile `themeCSS` (`position:fixed`,
  `background:url(...)`, or `@import`), hostile `classDef x fill:url(https://evil/x)`
  / `style` statements with `position:fixed`, or a stray SVG `<style>` element
- **THEN** the renderer SHALL use Mermaid strict mode as the load-bearing
  control while Mermaid transiently mounts content under `document.body`
- **AND** before `mermaid.render`, the pinned configuration's existing `secure`
  list SHALL be extended with `themeCSS`, `themeVariables`, `theme`, `fontFamily`,
  `altFontFamily`, and `htmlLabels`; source directives SHALL NOT change styling
  before that transient mount, failing closed when suppression cannot be proved
- **AND** it SHALL sanitize the resulting SVG before insertion into either the
  inline or fullscreen privileged app document, retaining only the single
  Mermaid-generated `<style>` whose content passes the reviewed CSS value
  profile: selectors scoped to the diagram id namespace; no `url(`, `@import`,
  `expression(`, `behavior:`, root-level `position:fixed`/`position:absolute`,
  or external references. Unreviewed CSS-bearing attributes SHALL be stripped;
  any other `style` element or failed profile validation SHALL fail closed
- **AND** a positive control SHALL prove safe diagram styling survives under
  that profile; themeCSS/classDef/style-statement/overlay/url/@import/stray-style
  fixtures SHALL remain
- **AND** an end-to-end fixture using pinned Mermaid through MermaidBlock's
  actual render path SHALL prove that the shared rendered-DOM oracle holds for
  returned/sanitized SVG and that no executable or unreviewed CSS artifact
  remains under `document.body` after rendering; the identical sanitized output SHALL reach
  both inline and fullscreen sinks
- **AND** DOMPurify SHALL remain the load-bearing sanitizer before the
  defensive DOMParser attribute pass; a parser-error pass-through SHALL NOT
  bypass or reorder that preceding sanitization

#### Scenario: Tool subtitle contains HTML

- **WHEN** a tool-call subtitle is derived from model, repository, MCP, tool
  input, or tool output text containing HTML or event-handler payloads
- **THEN** the renderer SHALL render the subtitle as text or through its named
  approved sanitizer
- **AND** it SHALL NOT insert the subtitle as raw HTML

#### Scenario: Production renderer CSP permits script execution

- **WHEN** the production renderer CSP is evaluated for the privileged app
  document
- **THEN** it SHALL NOT allow inline scripts, broad JavaScript `unsafe-eval`, or
  remote script origins
- **AND** any remaining WebAssembly compilation exception SHALL be documented
  with the code that blocks removal
- **AND** HTTPS markdown-image requests from the app document remain an
  explicit IP/timing-beacon egress residual; production script restrictions
  SHALL NOT be represented as blocking those image requests

#### Scenario: Development renderer CSP permits Vite HMR

- **WHEN** the development renderer CSP is evaluated for the privileged app
  document
- **THEN** any inline-script or localhost connection allowance SHALL be scoped
  to development Vite HMR
- **AND** that allowance SHALL NOT be present in the production renderer CSP

### Requirement: Local Browser Webview Guests Stay Outside Privileged App Bridges

Every Local Browser webview SHALL be an explicitly admitted, main-process
governed guest. Before first load, the main process SHALL bind the guest to a
registered chat/worktree, a unique process-local non-persistent partition, an
exact approved top-level origin, and fixed secure web preferences. The
guest SHALL receive no app preload, privileged bridge, Node integration,
permission, popup, or download authority. Main-process policy SHALL govern
attachment, initial and subsequent top-level navigation, redirects, file-root
containment, window opening, permissions, device/display capture, downloads,
diagnostic execution, and lifecycle cleanup; renderer policy SHALL be defense
in depth only. This requirement is not a guest network-egress sandbox:
page-controlled fetch, form, WebSocket, image/ping, frame, and other subresource
traffic can still reach remote or other loopback services.
That accepted residual includes Locus's state-protected MCP auth callback on
`localhost:21321` (`21322` in development), its per-endpoint Bearer-protected
provider gateway on a random `127.0.0.1` port, the state-protected OAuth callback
on `127.0.0.1:8914`, and development Vite/HMR. Presence probing or nuisance
requests SHALL NOT be described as authenticated access; a controlled auth/
gateway probe SHALL demonstrate rejection without state changes. Codex
app-server uses stdio rather than an additional loopback listener.

The following file-origin details implement Owner-decided option (a) in D7
(2026-09-08): each document has a separate
admission origin and declared relative-asset scope, defaulting to its directory
subtree. In-scope files remain readable and subject to the accepted egress
residual, including the entire worktree if that directory is the root.

The guest-policy owner SHALL expose pure injectable decisions for effective
preferences, admission consume/replay, request/permission/download verdicts
and teardown transitions, using Electron `import type` and injected factories.
Each ADDED Scenario SHALL have a double-driven fixture mapping plus any required
runtime evidence in `verification.md`; mock handler registration alone SHALL
NOT satisfy runtime observations.

#### Scenario: Renderer attempts an unsafe or unregistered guest attachment

- **WHEN** a webview attachment has no live main-issued admission, selects an
  unknown/default/persistent partition, supplies a preload, enables Node or
  popups, disables context isolation/web security/sandboxing, or otherwise
  weakens the approved guest preferences
- **THEN** the main-process guest owner SHALL reject the attachment or remove
  the unsafe preference before its first load
- **AND** the effective admitted guest SHALL have no preload or additional
  arguments, no nested webviews, Node integration off in frames and workers,
  context isolation/web security/sandbox on, insecure content off, and the
  exact issued non-persistent partition
- **AND** `will-attach-webview` SHALL explicitly force sandbox and context
  isolation, independent of the embedder's `sandbox:false`; the issued guest
  Session SHALL have no registered preload scripts
- **AND** a main `app.on('web-contents-created')` hook installed before any
  webContents creation SHALL guard all potential embedders using the per-window
  registry; unregistered embedders SHALL be denied. Partition mismatch with
  the pending admission SHALL reject attachment; writing a partition is only
  best-effort reinforcement, not proof that an attribute was overridden
- **AND** the first-request fixture SHALL prove Session-gate installation
  precedes any guest request; `did-attach-webview` handlers are installed after
  navigation starts and SHALL NOT substitute for that preinstalled gate
- **AND** all Session-scoped permission/device/display/selector/download deny
  handlers SHALL be installed in that same step before partition return;
  first-response download and early permission fixtures SHALL prove the order
  with doubles and actual denial separately in runtime tracks 5.2/5.3

#### Scenario: Renderer requests or replays a preview admission

- **WHEN** the privileged renderer requests a preview, supplies filesystem or
  webContents authority, races two attachments, or reuses an issued partition
- **THEN** main SHALL derive the live app-window sender from the IPC event,
  atomically call `windowManager.claimChat(chatId, senderWindow.id)`, and deny
  with a bounded reason if another live window owns the chat; a same-window
  claim SHALL be idempotent and an unowned chat MAY be acquired, including
  after stale-owner cleanup; fixtures SHALL cover all three ownership states
- **AND** authorization SHALL derive from that live app-window sender and the
  DB-registered chat/worktree resolved by main; the claim is an ownership
  cross-check, not independent filesystem authority
- **AND** main SHALL ignore caller-provided authority and bind one exact
  initial URL to a short-TTL single-consume partition admission
- **AND** the partition capability SHALL be count-bounded, never reused or
  persisted, and absent from URLs, guest arguments/data, diagnostics, and logs
- **AND** every `<webview>` element mount, including a React remount or
  StrictMode double-mount, SHALL request a new generation and admission;
  renderer retries SHALL NOT reuse a consumed admission

#### Scenario: Preview JavaScript probes privileged capabilities

- **WHEN** an admitted local preview executes JavaScript that probes
  `electronTRPC`, `desktopApi`, `webUtils`, Electron IPC, `require`, or `process`
- **THEN** those privileged app and Node capabilities SHALL be unavailable in
  the guest
- **AND** the probe SHALL cause no privileged IPC/tRPC request or main-process
  side effect

#### Scenario: Preview attempts disallowed top-level navigation or redirect

- **WHEN** initial load, a link/location change, a programmatic load, or an HTTP
  redirect targets credentials, a remote host, another local origin or port,
  an unsupported scheme, or any other target outside the exact admitted origin
- **THEN** for requests observable by `webRequest`, a Session request gate
  installed before the partition was exposed to the renderer SHALL block it
  before commit, including main-owned `loadURL`, back/forward, and every
  redirect request; runtime fixtures SHALL observe direct `file:` cancellation
  across main-frame, subframe, XHR, script, and image positions and each
  redirect hop, including a redirect to another loopback port
- **AND** file-admission requests SHALL use the exact
  `locus-preview://<per-admission-random>.preview.local` scheme/host/port tuple
  as admitted origin plus the admitted document path; other preview hosts or
  out-of-scope paths SHALL fail closed, and HTTP(S)-admitted Sessions SHALL
  reject every `locus-preview:` request. Other observable schemes SHALL fail
  closed except HTTP(S) subresources under the accepted egress residual;
  runtime fixtures SHALL record custom-scheme gate observability without
  assuming `protocol.handle` requests pass through `webRequest`
- **AND** the renderer SHALL retain no `<webview>.loadURL` escape hatch;
  non-network top-level schemes SHALL instead be governed by the main guest's
  navigation listeners, explicit `openExternal` permission denial, and
  committed-URL postconditions, without claiming `webRequest` observes them
- **AND** `about:blank` SHALL be permitted only as a browser-created initial
  empty document proven to inherit the current admission, and a same-origin
  `blob:` document only when its creator origin is proven to match that exact
  admission; unknown/cross-origin blob, `data:`, `javascript:`, and other
  non-admitted commits SHALL fail closed, with runtime evidence required for
  the inherited-origin cases
- **AND** an unexpected disallowed committed postcondition SHALL destroy the
  guest and record only a bounded diagnostic rather than rely on renderer
  rollback: main SHALL use `guestWebContents.close()` with
  `waitForBeforeUnload` unset, re-check `isDestroyed()` and revoke registry
  state, invalidating authority immediately on teardown. No replacement or
  renderer fallback SHALL bypass unconfirmed destruction

#### Scenario: Preview attempts file-root escape

- **WHEN** a `file://` target uses a renderer-forged root, traversal, decoding
  ambiguity, or a path inside the registered root that resolves through a
  symlink outside it, or preview content attempts to read another file or
  another admission's host
- **THEN** the guest SHALL NOT load direct `file://` content; main SHALL resolve
  the owning chat worktree and map an admitted target to a Session-local
  per-admission preview origin `locus-preview://<per-admission-random>.preview.local/`
- **AND** main SHALL bind that host to the admitted document plus declared
  relative assets (default: document-directory subtree), preserve relative
  URLs, freeze the main-validated scope and deny another host or out-of-scope
  path for every resource type. Another top-level document SHALL need fresh
  admission; the scope's read/egress consequence SHALL be visible, including
  when the default document directory is the worktree root
- **AND** only file-admission Sessions SHALL bind `protocol.handle`, before
  partition return, enforcing live admission/host/scope/anchored reads on every
  request independently of `webRequest` observability; HTTP(S)-admission
  Sessions SHALL leave the scheme unhandled and reject it at the request gate
- **AND** scheme privileges SHALL be exactly D7's standard/secure/
  supportFetchAPI/corsEnabled true and bypassCSP/allowServiceWorkers/stream/
  codeCache false, with no permissive CORS response or origin relaxation
- **AND** 4.8 doubles SHALL test scope/verdicts, while 5.2/5.3 SHALL record actual
  cross-file fetch, XHR, iframe `contentDocument`, and `script src` results for
  allowed in-scope controls, denied out-of-scope worktree files and other hosts,
  plus HTTP(S)-guest scheme denial and custom-scheme gate observability
- **AND** main SHALL realpath-canonicalize the DB-registered root and require
  matching directory `dev`/`ino` identities from the registered path's `lstat`,
  the canonical path, and the opened anchor, re-verifying the binding before
  use; a terminal symlink or any mismatch SHALL fail closed, while a symlinked
  prefix is usable only when the canonical identity checks succeed
- **AND** the protocol SHALL traverse without following symlinks and serve the
  same verified regular-file descriptor it opened, rejecting the preview before
  path/symlink retargeting can load bytes from outside the registered root
- **AND** file preview SHALL fail closed on a platform/filesystem without that
  proven safe-read primitive rather than use a path-only fallback
- **AND** with the existing descriptor owner, file preview SHALL ship disabled
  on `win32`, a packaged release target, until an approved Yellow
  handle-relative backend extension provides that primitive
- **AND** this containment guarantee SHALL NOT be represented as an immutable
  snapshot of an admitted inode that another process can modify concurrently

#### Scenario: Preview attempts to open another window

- **WHEN** guest content invokes `window.open`, follows a `_blank` target, or
  otherwise requests a new window, including `locus://`, supported legacy
  Locus schemes, `mailto:`, or `vscode://` targets
- **THEN** the guest window-open policy SHALL deny the request
- **AND** it SHALL create no BrowserWindow and SHALL NOT launch the target in an
  external application
- **AND** guest `openExternal` permission SHALL be explicitly denied; top-level
  links, `location.href`, and `_blank` probes for those schemes SHALL cause no
  OS handler launch or `mcp-import:preview` push, while the app-window
  `shell.openExternal` path remains separately governed

#### Scenario: Preview requests permission, capture, or download

- **WHEN** guest content requests media, clipboard read, geolocation,
  notification, fullscreen/lock, filesystem, device, display-media,
  `openExternal` for an external-scheme navigation, an unknown permission, or a
  download
- **THEN** guest permission-check and permission-request policy SHALL
  consistently deny the request, device-permission policy and HID/serial/USB/
  Bluetooth selection SHALL prevent Electron default handling and invoke its
  rejecting callback, display selection SHALL return no stream without a
  system-picker bypass, and the download SHALL be cancelled
- **AND** no operating-system prompt or file write SHALL occur
- **AND** every Session-scoped deny handler SHALL be ready before partition
  return, including for an early permission check or first-response download
- **AND** external-protocol probes SHALL cause no OS handler launch or
  `mcp-import:preview` push

#### Scenario: Two previews use guest storage

- **WHEN** two unrelated preview admissions create guests or a stale admission
  is reused after preview/window teardown
- **THEN** each live preview SHALL use a distinct main-issued process-local
  partition and SHALL NOT share cookies or storage with the other preview, the
  default session, or `persist:main`
- **AND** stale, cross-embedder, expired, or conflicting admission reuse SHALL
  fail closed; teardown SHALL revoke registry state, destroy the guest, attempt
  storage/cache/service-worker cleanup, and never reuse the partition
- **AND** destruction SHALL use main-owned `guestWebContents.close()` with
  `waitForBeforeUnload` unset, an `isDestroyed()` re-check and registry
  revocation per D5; runtime evidence SHALL prove main-alone destruction and
  that renderer revival/reattachment requires fresh generation/admission
- **AND** the system SHALL NOT claim that Electron destroyed a non-persistent
  Session object that can remain until process exit

#### Scenario: Host captures guest diagnostics

- **WHEN** an admitted guest emits console, load-failure, title, or navigation
  events, or the workbench requests click tracking, a DOM summary, or selected
  element context
- **THEN** it SHALL invoke only a named fixed repository-owned script with no
  untrusted string interpolation and `userGesture:false` for active probes;
  the selection probe SHALL belong to that same closed shared script set
- **AND** main SHALL capture the admitted guest's diagnostic events from its
  `webContents` after attachment; the renderer SHALL NOT directly subscribe to
  raw `<webview>` console/load-failure/title/navigation payloads, including
  `will-navigate` or any event carrying page-controlled URL, title, or text;
  renderer lifecycle signals SHALL be URL-free
- **AND** main-owned event/probe processing SHALL bind results to the current
  guest/navigation, minimize them, strip URL credentials/query/fragment,
  secret-redact, normalize, and bound them before publishing the safe
  projection to renderer state; console levels SHALL use an explicit mapping
  from Electron's `info`/`warning`/`error`/`debug` levels to the shared contract
- **AND** only the final visible redacted report SHALL be eligible for explicit
  user insertion into chat; raw page values and exact-secret hints SHALL NOT
  enter app listeners/state, chat text, security logs, or verification receipt
  media
- **AND** tests SHALL assert those app-consumption and retention boundaries;
  Electron's own dispatch to the `<webview>` element is not claimed to be
  suppressed

#### Scenario: Trusted app requests its existing microphone behavior

- **WHEN** the privileged app document exercises its existing voice-recording
  path
- **THEN** the guest default-deny handlers SHALL NOT have been installed as a
  deny-all policy on the trusted app session
- **AND** guest denial SHALL NOT by itself change the app document's separately
  governed permission behavior
