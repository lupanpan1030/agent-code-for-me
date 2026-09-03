## MODIFIED Requirements

### Requirement: Untrusted Renderer Content Uses Reviewed Rendering Boundaries

The renderer SHALL treat repository content, chat markdown, tool output, MCP
output, highlighted code, and editable-content state as untrusted. Static and
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

#### Scenario: Markdown active HTML and highlighted HTML sinks

- **WHEN** chat, repository, MCP, or tool-output markdown in either app render
  mode contains scripts, active HTML/SVG/MathML, event-handler attributes,
  executable URLs, or a malformed/incomplete variant of those payloads
- **THEN** the rendered privileged app DOM SHALL contain no executable form of
  the payload
- **AND** retained behavior tests SHALL also prove that the reviewed safe
  formatting subset still renders

#### Scenario: A raw-markup insertion is introduced or changed

- **WHEN** renderer source adds or changes `dangerouslySetInnerHTML`, a
  value-bearing direct DOM HTML assignment, `insertAdjacentHTML`, `srcDoc`,
  `document.write`, a contextual fragment, or an equivalent raw-markup sink
- **THEN** the renderer source guard SHALL require an exact insertion-point
  entry naming its reviewed producer and adversarial behavior test or fail
  before merge
- **AND** adding a sink inside an already reviewed file SHALL NOT bypass the
  guard

#### Scenario: Highlighted HTML reaches a raw insertion sink

- **WHEN** untrusted chat, repository, MCP, tool, or message-JSON code is
  converted to highlighted HTML
- **THEN** markup-breaking source characters SHALL remain non-executable at the
  insertion boundary
- **AND** a generator exception, output-shape mismatch, or extraction failure
  SHALL NOT fall back to inserting the original source as HTML

#### Scenario: Mentions editor pastes or restores content

- **WHEN** the mentions editor receives mixed or HTML-only clipboard data or
  restores an undo/redo entry containing attacker-controlled markup
- **THEN** the editor itself SHALL prevent browser rich-content insertion,
  consume only explicit plain text from mixed data, and reject HTML-only data
- **AND** undo/redo SHALL retain lossless canonical text/atomic-mention runs and
  logical selection state, rebuilding with safe DOM construction rather than a
  value-bearing `.innerHTML` restore

#### Scenario: Mermaid diagram contains scriptable content

- **WHEN** chat, repository, MCP, or tool-output markdown renders a Mermaid
  diagram containing `click`, `javascript:` URLs, script tags, event-handler
  attributes, or foreign-object content
- **THEN** the renderer SHALL use Mermaid strict mode
- **AND** it SHALL sanitize the resulting SVG before insertion into either the
  inline or fullscreen privileged app document

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

#### Scenario: Development renderer CSP permits Vite HMR

- **WHEN** the development renderer CSP is evaluated for the privileged app
  document
- **THEN** any inline-script or localhost connection allowance SHALL be scoped
  to development Vite HMR
- **AND** that allowance SHALL NOT be present in the production renderer CSP

## ADDED Requirements

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

#### Scenario: Renderer requests or replays a preview admission

- **WHEN** the privileged renderer requests a preview, supplies filesystem or
  webContents authority, races two attachments, or reuses an issued partition
- **THEN** main SHALL derive the embedder from the IPC event, require it to own
  the registered chat, ignore caller-provided authority, and bind one exact
  initial URL to a short-TTL single-consume partition admission
- **AND** the partition capability SHALL be count-bounded, never reused or
  persisted, and absent from URLs, guest arguments/data, diagnostics, and logs

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
- **THEN** a Session request gate installed before the partition was exposed to
  the renderer SHALL block it before commit, including `loadURL`, back/forward,
  and every redirect request
- **AND** an unexpected disallowed committed postcondition SHALL destroy the
  guest and record only a bounded diagnostic rather than rely on renderer
  rollback

#### Scenario: Preview attempts file-root escape

- **WHEN** a `file://` target uses a renderer-forged root, traversal, decoding
  ambiguity, or a path inside the registered root that resolves through a
  symlink outside it
- **THEN** the guest SHALL NOT load direct `file://` content; main SHALL resolve
  the owning chat worktree and map an admitted target to a Session-local
  fixed-origin preview protocol
- **AND** the protocol SHALL traverse without following symlinks and serve the
  same verified regular-file descriptor it opened, rejecting the preview before
  path/symlink retargeting can load bytes from outside the registered root
- **AND** file preview SHALL fail closed on a platform/filesystem without that
  proven safe-read primitive rather than use a path-only fallback
- **AND** this containment guarantee SHALL NOT be represented as an immutable
  snapshot of an admitted inode that another process can modify concurrently

#### Scenario: Preview attempts to open another window

- **WHEN** guest content invokes `window.open`, follows a `_blank` target, or
  otherwise requests a new window
- **THEN** the guest window-open policy SHALL deny the request
- **AND** it SHALL create no BrowserWindow and SHALL NOT launch the target in an
  external application

#### Scenario: Preview requests permission, capture, or download

- **WHEN** guest content requests media, clipboard read, geolocation,
  notification, fullscreen/lock, filesystem, device, display-media, an unknown
  permission, or a download
- **THEN** guest permission-check and permission-request policy SHALL
  consistently deny the request, device-permission policy and HID/serial/USB/
  Bluetooth selection SHALL prevent Electron default handling and invoke its
  rejecting callback, display selection SHALL return no stream without a
  system-picker bypass, and the download SHALL be cancelled
- **AND** no operating-system prompt or file write SHALL occur

#### Scenario: Two previews use guest storage

- **WHEN** two unrelated preview admissions create guests or a stale admission
  is reused after preview/window teardown
- **THEN** each live preview SHALL use a distinct main-issued process-local
  partition and SHALL NOT share cookies or storage with the other preview, the
  default session, or `persist:main`
- **AND** stale, cross-embedder, expired, or conflicting admission reuse SHALL
  fail closed; teardown SHALL revoke registry state, destroy the guest, attempt
  storage/cache/service-worker cleanup, and never reuse the partition
- **AND** the system SHALL NOT claim that Electron destroyed a non-persistent
  Session object that can remain until process exit

#### Scenario: Host captures guest diagnostics

- **WHEN** the workbench requests click tracking, a DOM summary, or selected
  element context from an admitted guest
- **THEN** it SHALL invoke only a named fixed repository-owned script with no
  untrusted string interpolation
- **AND** raw results SHALL remain in main until they are bound to the current
  guest/navigation, minimized, stripped of URL credentials/query/fragment,
  secret-redacted, normalized, and bounded before renderer state
- **AND** only the final visible redacted report SHALL be eligible for explicit
  user insertion into chat; raw page values and exact-secret hints SHALL NOT
  enter the renderer, chat, or security logs

#### Scenario: Trusted app requests its existing microphone behavior

- **WHEN** the privileged app document exercises its existing voice-recording
  path
- **THEN** the guest default-deny handlers SHALL NOT have been installed as a
  deny-all policy on the trusted app session
- **AND** guest denial SHALL NOT by itself change the app document's separately
  governed permission behavior
