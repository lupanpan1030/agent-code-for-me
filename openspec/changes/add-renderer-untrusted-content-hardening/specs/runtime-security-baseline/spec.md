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

Retained behavior suites SHALL share the rendered-DOM oracle specified by the
`renderer-html-policy.ts` owner in design D2, with explicit profiles for markdown,
highlighted code, Mermaid SVG, and the editor, implemented by the shared test
helper in D2. Within each untrusted-content subtree the oracle SHALL reject
script/iframe/object/embed/frame/base/meta/link/
foreignObject, animation (`animate*`/`set`), and MathML `maction` elements;
`style` elements other than the single value-profile-validated Mermaid paint
element allowed only by the Mermaid profile and its pre-render `secure` rule;
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
  `defaultSchema` and whose hardener options are non-wildcard; parity fixtures
  SHALL cover the remark configuration as well as the replacing rehype chain
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
- **THEN** the renderer source guard SHALL require an exact insertion-point
  entry naming its reviewed producer and adversarial behavior test or fail
  before merge
- **AND** adding a sink inside an already reviewed file SHALL NOT bypass the
  guard
- **AND** the guard SHALL scan all of `src/renderer`, including `public/` and
  `.ts`/`.tsx`/`.html`/`.js`/`.jsx`/`.mjs`/`.cjs` files, with negative fixtures
  for the scanned classes and a rule flagging new Shiki-API shims or Vite aliases
  into DOM-producing dependencies

#### Scenario: Highlighted HTML reaches a raw insertion sink

- **WHEN** untrusted chat, repository, MCP, tool, or message-JSON code is
  converted to highlighted HTML
- **THEN** markup-breaking source characters SHALL remain non-executable at the
  insertion boundary under the shared rendered-DOM oracle
- **AND** a generator exception, output-shape mismatch, or extraction failure
  SHALL NOT fall back to inserting the original source as HTML

#### Scenario: Dependency diff rendering is covered by the reviewed-producer contract

- **WHEN** repository content renders through `<FileDiff>` or `<PatchDiff>` via the
  Locus-owned `pierre-diffs-shiki-shim.ts` and its Vite aliases
- **THEN** black-box hostile filename, hunk-header, line-content, and patch-text
  fixtures SHALL exercise that actual path and apply the shared rendered-DOM
  oracle to its resulting DOM, including Shadow DOM
- **AND** `@pierre/diffs@1.0.10` (`bun.lock:476`), un-aliased
  `hast-util-to-html@9.0.5` (`:1360`, the load-bearing production-bundle
  `toHtml` escaper), and the actual Shiki resolution SHALL be exact-pinned:
  nested `shiki@3.21.0` under @pierre/diffs (`:2300`), hoisted
  `@shikijs/core@3.21.0` / `@shikijs/engine-javascript@3.21.0` (`:618,620`),
  and `@shikijs/transformers@3.22.0` (`:628`) with nested core/types `3.22.0`
  (`:2328,2330`); the Shiki subtree is installed but aliased away from the
  production diff path, and remains inventoried for test/type resolution
- **AND** the fixtures and design D10 row SHALL gate dependency, Locus shim,
  and four-specifier Vite alias changes. A `bun test --isolate` `<FileDiff>`/
  `<PatchDiff>` fixture SHALL bind `shiki`, `shiki/core`,
  `@shikijs/engine-javascript`, and `@shikijs/transformers` to the shim before
  importing the diff renderer and assert its `createPlainHast` text-node shape
  before hostile cases; an unbound test runs nested real Shiki 3 and SHALL NOT
  count as shim evidence. A built-renderer fixture with the same binding
  assertion is an alternative
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
That accepted residual includes Locus's state-protected MCP auth callback on
`localhost:21321` (`21322` in development), its per-endpoint Bearer-protected
provider gateway on a random `127.0.0.1` port, the state-protected OAuth callback
on `127.0.0.1:8914`, and development Vite/HMR. Presence probing or nuisance
requests SHALL NOT be described as authenticated access; a controlled auth/
gateway probe SHALL demonstrate rejection without state changes. Codex
app-server uses stdio rather than an additional loopback listener.

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
- **AND** the first-request fixture SHALL prove Session-gate installation
  precedes any guest request; `did-attach-webview` handlers are installed after
  navigation starts and SHALL NOT substitute for that preinstalled gate

#### Scenario: Renderer requests or replays a preview admission

- **WHEN** the privileged renderer requests a preview, supplies filesystem or
  webContents authority, races two attachments, or reuses an issued partition
- **THEN** main SHALL derive the live app-window sender from the IPC event,
  atomically call `windowManager.claimChat(chatId, senderWindow.id)`, and deny
  with a bounded reason if another live window owns the chat; a same-window
  claim SHALL be idempotent
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
  rollback

#### Scenario: Preview attempts file-root escape

- **WHEN** a `file://` target uses a renderer-forged root, traversal, decoding
  ambiguity, or a path inside the registered root that resolves through a
  symlink outside it
- **THEN** the guest SHALL NOT load direct `file://` content; main SHALL resolve
  the owning chat worktree and map an admitted target to a Session-local
  fixed-origin preview protocol
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
