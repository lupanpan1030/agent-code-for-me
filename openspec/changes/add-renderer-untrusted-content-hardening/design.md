## Context

This is an R3 design whose eight recommended defaults received Owner
DIRECTION+IMPLEMENTATION APPROVED on 2026-09-05. Source edits remain gated on
tasks 0.2/0.3/0.4/0.5. The 2292d36a pre-implementation review accepted
feasibility (0.2) and requested security touch-ups (0.3); Approval Question 9
below remains PENDING Owner decision (morning 2026-09-06). This package carries
forward only the unfinished renderer and webview work routed out of archived
`update-trpc-capability-boundary`; it does not reopen the capability, consent,
or router-boundary decisions assigned to follow-up B.

The evidence baseline is local `main` at
`30c72ad3c26dd952410c6e38678faf43d8c55895`. The 2026-08-26 handoff is useful
scope history, but several of its implementation statements are now stale. The
following table is the current-main baseline that this Draft uses.

As of 2026-09-05, local `main` is
`d923119c090ef8a252ef084bb1453b4b937d563d`. The range
`30c72ad3..d923119c` changes only tests and documentation; the product anchors
below were rechecked and remain current. This note does not satisfy task 0.4:
implementation still requires rebasing every source/test anchor and
active-change conflict onto the implementation-start SHA.

| Surface | Implemented baseline | Remaining gap owned here |
| --- | --- | --- |
| Markdown | Static and streaming `Streamdown` mounts are at `src/renderer/components/chat-markdown-renderer.tsx:460-469,693-700`. `bun.lock` resolves Streamdown 2.1.0 and its default raw/sanitize/harden chain; `package.json` declares the wider `^2.0.1` range. | No retained malicious-HTML or executable-URL render test covers either app path; dependency behavior is carrying a security statement without a local upgrade gate. |
| React raw HTML | `tests/renderer-html-sinks.test.ts:27-68` permits five files. Current source has six `dangerouslySetInnerHTML` insertions: chat markdown (one), Mermaid (two), and three tool/message views. Mermaid alone has a dedicated sanitizer. | The guard exempts whole files, not individual sinks, and does not bind each sink to a reviewed producer or test its rendered behavior. |
| Shiki HTML-string insertions | The four inventoried non-Mermaid raw insertions consume `highlightCode()` in `src/renderer/lib/themes/shiki-theme-loader.ts:255-292`; chat markdown also has a local `escapeHtml` pre-highlight/plaintext fallback at `chat-markdown-renderer.tsx:24-26,90-92`. The locked Shiki output escapes sampled hostile text. | `<code>` extraction failure returns raw `code` at line 287; local escaping must route through the reviewed-content owner. This is not the only Shiki-API path in the app. |
| Dependency-internal DOM producers of untrusted content | `@pierre/diffs` `FileDiff`/`PatchDiff` render repository diffs through the Locus-owned `src/renderer/lib/vendor/pierre-diffs-shiki-shim.ts` and `electron.vite.config.ts` aliases. Its live `createPlainHast` uses text nodes; local `codeToHtml`/`escapeHtml` is re-exported but not used by the live diff render path. `@pierre/diffs` 1.0.10 has its own `shiki ^3` subtree (locked 3.21.0), beside app Shiki 1.29.2. Monaco renders repository files; xterm renders hostile PTY output. `diff-view-highlighter.ts` constructs a `getAST` adapter with no callers. | Library DOM writes and Shadow DOM are outside the source-only raw-sink scan; Shadow DOM is not a script/CSP boundary. Coverage/pins/upgrade evidence and explicit residuals need the Owner's Question 9 decision; no coverage option is selected here. |
| Mentions editor | Programmatic rebuild uses text nodes / `textContent` in `src/renderer/features/agents/mentions/agents-mentions-editor.tsx:74-253`; production callers install `handlePasteEvent`, which normally pastes `text/plain`. | Undo and redo restore captured DOM through non-empty `.innerHTML` at `:991` and `:1019`. The current paste helper prevents default only for images or non-empty `text/plain`, so HTML-only data can retain the browser's default contentEditable insertion. Neither path has retained adversarial coverage. This is an unreviewed sink, not a claimed current exploit. |
| Main app document | `main.ts:447-474` sets Node integration off, context isolation and web security on, main sandbox off for electron-trpc, `webviewTag` on, and `persist:main`. CSP is installed at `:482-487`; app-window popup/navigation/redirect guards are at `:573-607`. | App-window handlers and main-frame CSP do not establish a policy for guest webContents. The main sandbox constraint is not the guest sandbox decision. |
| Local Browser | The renderer derives a non-persistent chat partition at `local-browser-workbench.tsx:89-92`, validates/rolls back top-level navigation at `:157-213`, runs fixed diagnostic scripts at `:111-119,268-305`, and creates the sole webview at `:449-464`. | Partition derivation can collide after filtering/truncation and has no lifecycle owner. There is no main-owned attach, guest navigation/redirect, bridge/preload, permission, popup, download, or cleanup policy. Renderer-supplied roots are only lexically checked. Full URL, console, DOM, and selection data also lack one pre-renderer secret-minimization owner. |
| Existing tests | Mermaid sanitizer, tool-subtitle escaping, source inventory, local URL/report helpers, app-window navigation, and CSP construction have focused unit tests. | They do not exercise guest Electron wiring, permission prompts, bridge globals, popup/download side effects, partition isolation, redirect timing, file symlink escape, or packaged behavior. |

There is no current chat HTML-export preview: export formats are text based. It
is deliberately absent from this change rather than treated as an existing
sink.

## Goals / Non-Goals

### Goals

- Make raw renderer markup insertions exact, named, and mechanically reviewable.
- Bind every retained raw sink to one safe producer contract plus adversarial
  behavior evidence.
- Close the disclosed Streamdown regression gap without removing intended safe
  markdown formatting.
- Eliminate the mentions editor's value-bearing direct-HTML restore path.
- Establish a fail-closed main-process owner for every local-browser webview
  guest before its first load.
- Replace direct guest `file://` loading with a race-resistant, registered-root
  file broker and fail closed where that safe-read primitive is unavailable.
- Prove guest bridge, navigation, popup, permission, download, partition, and
  minimized/redacted diagnostic behavior in both unit/integration tests and a
  real Electron GUI fixture.
- Preserve existing renderer functionality and the trusted app's voice path.

### Non-Goals

- No source implementation before tasks 0.2/0.3/0.4/0.5 close; the eight-default
  approval does not resolve the new Question 9 coverage decision.
- No generic renderer-to-main capability, consent, audit, or kill-switch layer.
- No `scripts/check-architecture-guards.mjs` or Foundation 1c baseline change.
- No privileged-main-window sandbox migration and no WebContentsView rewrite.
- No blanket disabling of preview JavaScript.
- No claim of guest network-egress isolation. Exact-origin top-level navigation
  is enforced, but remote or other-loopback fetch/form/WebSocket/image/ping/
  frame traffic remains possible unless the Owner separately expands scope.
  The eight-default approval accepts this residual, including Locus's own
  state-validated MCP/OAuth callback listeners and Bearer-authenticated provider
  gateway; Vite/HMR exposure exists only in development (see Threat Model).
- No app-document remote-image egress isolation: allowed HTTPS markdown images
  can disclose IP/timing without a click; this is an explicit residual.
- Dependency-internal DOM producer coverage is pending Question 9. If option
  (b) or the recommended compromise is approved, Monaco/xterm hardening beyond
  existing controls becomes an explicit residual and Yellow follow-up; option
  (b) also leaves the diff path residual. No option is deemed accepted here.
- No public/versioned API or durable-data change.

## Threat Model

The attacker may control:

- repository files, chat/model output, MCP and tool input/output, markdown raw
  HTML, fenced code, Mermaid source, and URLs embedded in those values;
- a local HTTP server or file preview, including its JavaScript, redirects,
  popup/download attempts, permission requests, storage, and returned
  diagnostics;
- browser rich-content insertion from clipboard, drag/drop, replacement/link
  insertion, formatting commands, or other `beforeinput` types presented to the
  contentEditable mentions editor;
- dependency-internal DOM producers of untrusted content: `@pierre/diffs`
  through Locus's Shiki shim/Vite alias, Monaco files, and xterm PTY streams.
  Shadow DOM is not a script/CSP boundary (Shadow DOM 不是脚本/CSP 边界).
  Current diff controls are text-node HAST, default `toHtml` escaping, production
  CSP and `DiffErrorBoundary`; exact pinning and coverage remain gated on
  Question 9. Under (b), these controls accompany an explicit diff residual;
  under the compromise, only Monaco/xterm remain residual, with Yellow tracking;
- output-shape drift introduced by an allowed Streamdown, Shiki, or
  DOM-producing dependency upgrade; and
- timing around guest creation, navigation, teardown, and stale diagnostic
  results.

The guest is not treated as a network sandbox. A malicious preview may still
send page-originated subresource, fetch, form, WebSocket, image/ping, or frame
traffic to remote hosts or another loopback service. Exact-origin top-level
confinement prevents silent guest replacement but does not prevent that egress
or its possible CSRF-like side effects. Locus listeners include the MCP auth
callback on localhost:21321 (development 21322, random pending-flow state),
OAuth callback on 127.0.0.1:8914 (state validated), the provider gateway on a
random 127.0.0.1 port (per-endpoint Bearer token), and development Vite/HMR.
No unauthenticated state-changing Locus endpoint was identified; presence
fingerprinting and nuisance probes remain possible. Codex app-server uses
stdio and is not a loopback listener.

Allowed HTTPS images in privileged-document markdown also permit remote beacon
requests and IP/timing disclosure. This app-document egress residual is
separate from the accepted guest-egress residual and is not claimed blocked.
Mermaid CSS injection is in scope: attacker `themeCSS`, retained `style`,
`@import`, remote `url()`, and fixed-position overlays must not survive the
reviewed path. Mermaid temporarily mounts diagram DOM under `document.body`
before the app sanitizer sees returned SVG. Pinned Mermaid strict mode is the
load-bearing script control during that transient mount; D3 adds source/config
CSS control before rendering and post-render cleanup/evidence, rather than
claiming final SVG sanitization protects the earlier mount.

The attacker must not:

- execute script or event handlers in the privileged app document through a
  reviewed content path;
- turn source text into markup by breaking out of a highlighted-code sink;
- cause an unclassified raw insertion to enter source without the guard failing;
- obtain `electronTRPC`, `desktopApi`, `webUtils`, Node globals, the app preload,
  or privileged IPC from a preview guest;
- navigate a guest top-level frame outside its main-authorized local boundary,
  escape an allowed file root through a symlink, create/open another window,
  launch an OS protocol handler (including a Locus deep link that publishes an
  MCP import preview), trigger a system permission prompt, or write a download; or
- share guest cookies/storage across unrelated preview admissions.

A separately compromised privileged renderer remains within follow-up B's
threat model. This design nevertheless makes webview attachment fail closed so
an arbitrary element created in that renderer cannot select unsafe guest
preferences or an app preload.

## Security Invariants

1. A plain `string` is not sufficient evidence for a value-bearing raw HTML
   insertion owned by Locus.
2. Source inventory is an architecture alarm, not a substitute for rendered
   behavior tests.
3. Any sanitizer/parser/dependency failure on untrusted content degrades to
   escaped text, a bounded error, or no render; it never degrades to raw markup.
4. The renderer is not the authorization owner for guest preload, partition,
   file root, permissions, navigation, popup, download, or effective web
   preferences.
5. Guest JavaScript has no app bridge and cannot use Locus-mediated privileged
   IPC, popup/external-open, permission, capture, or download effects. This
   invariant does not claim that page network traffic has no external effect.
6. Missing registration, unknown state, invalid URL/root, handler-installation
   failure, or teardown race disables or destroys the guest rather than falling
   back to the current renderer-only policy.
7. Page-controlled diagnostic bytes, including raw `console-message`,
   `did-fail-load`, `page-title-updated`, `will-navigate`, and `did-navigate`
   family payloads, and any `<webview>` event carrying a page-controlled URL,
   title, or text, have no app renderer listener, state, chat insertion, security
   log, or receipt before main-owned minimization, redaction, and bounds.
   Electron's dispatch to the element itself is not claimed to be suppressed;
   evidence checks absence from app state, chat text, logs, and receipt media.

## Decisions

### D1. One reviewed-output contract and an exact sink inventory

Introduce `src/renderer/lib/security/renderer-html-policy.ts` as the canonical
owner for Locus-produced raw markup. It exposes an opaque-at-normal-call-sites
TypeScript contract such as `ReviewedRendererHtml`, with narrow construction
adapters for approved producers. The source guard and behavior tests remain the
enforcement backstop because a TypeScript brand alone is not a security
boundary. The owner does not become a generic `sanitize(anything)` helper that
callers can use to bypass source classification.

The existing Mermaid sanitizer remains a specialized adapter because SVG has a
different schema: DOMPurify is its load-bearing returned-SVG control; the later
DOMParser attribute pass is defense in depth. Its current parsererror branch
returns already-purified input, not raw SVG; this ordering must not reverse.
`highlightCode()` becomes the sole Shiki HTML-string producer for the four
inventoried raw insertions, returning only reviewed output. The diff-view shim
is a separately classified producer whose reviewed-producer coverage is gated
on Question 9. Streamdown is wrapped at the component boundary and covered by
rendered behavior tests even though its internal tree-to-React conversion does
not expose the same branded string.

Inventory both local escaping branches: chat-markdown-renderer.tsx's plaintext
fallback routes through `renderer-html-policy.ts`; if Question 9 includes the
diff path, the shim's `escapeHtml`/`codeToHtml` must be removed if unused or
routed through that owner, never retained as a parallel policy. Classify the
constructed but unused `diff-view-highlighter.ts#getAST` adapter as dormant;
activating it requires an explicit inventory/producer/behavior-gate update.
The reviewed executable-URL click sink is `src/main/lib/local-only.ts#openExternalUrl`
(http/https/mailto only), reached through `src/preload/index.ts#openExternal`
/ `shell:open-external` and `src/main/lib/trpc/routers/external.ts#openExternal`.
Inventory these named boundary endpoints without widening the renderer scanner
into a new generic capability guard.

`tests/renderer-html-sinks.test.ts` becomes the renderer source-guard owner. Its
inventory is keyed by stable enclosing symbol/construct and expected producer,
not a broad file name or volatile line number. Its filesystem walk covers all
of `src/renderer`, including `public/` and `.ts/.tsx/.js/.jsx/.mjs/.cjs/.html`.
It remains rooted there: literal denylist tokens in
`src/shared/plugin-controlled-ui.ts` are not executable renderer sinks.
Explicit out-of-root inventory anchors (for example the reviewed main URL sink
and Vite aliases) are checked as named rules, not a broad shared-code scan.
It scans at least:

- `dangerouslySetInnerHTML`;
- non-empty and empty `.innerHTML` / `.outerHTML` writes;
- `insertAdjacentHTML`, `document.write` / `writeln`, and
  `Range#createContextualFragment`;
- `srcDoc` / `srcdoc`;
- platform equivalents such as `setHTMLUnsafe`; and
- dynamic script element creation, `script.src` assignment, remote dynamic
  `import()`, and `importScripts`.

The scanner includes negative self-test fixtures so a new or disguised
value-bearing sink makes the test fail. Constant empty clears may be separately
classified, though replacing them with DOM removal APIs is preferred. Remove
the `agents-debug-tab.tsx` unpkg react-scan script loader during implementation;
no new runtime dependency or remote-script exception is introduced. Its absence
is an explicit guard fixture. Add an inventory alarm for any new Shiki-API
shim or Vite alias into a DOM-producing dependency. Conditional on Question 9
including the diff path, bind the existing alias/shim to the reviewed diff
entry and its behavior/upgrade gate. An inventory alarm alone does not select
reviewed-producer coverage over an explicit residual.

### D2. Streamdown behavior is repository-gated in both modes

Both Streamdown mounts move behind one app-owned wrapper/configuration so they
cannot drift. That wrapper owns an error boundary around each mount: a
parser/plugin exception renders the source as escaped text without unmounting
the chat view. A forced-throw plugin fixture proves this fallback contains no
raw markup. The implementation must retain black-box tests for static and
streaming modes that cover, at minimum:

- script/iframe and active SVG/MathML constructs;
- event-handler attributes;
- executable and encoded URL payloads in links and media attributes, including
  `locus://`, `vscode://`, `ms-msdt:`, and relative-URL links;
- malformed/incomplete streaming blocks; and
- an explicit safe-formatting control set such as emphasis, tables, code, and
  reviewed safe links.

The preferred implementation pins the top-level Streamdown dependency to exact
`2.1.0` and explicitly supplies the reviewed raw -> sanitize -> harden rehype
pipeline after parity characterization. Any rehype package imported by app code
must also be an exact, direct top-level dependency; a transitive Bun hoist is
not an ownership boundary. If the Owner instead selects Streamdown's exported
default pipeline, the exact alternative and upgrade gate must be recorded in
this design before approval. In either form, the retained behavior suite is
mandatory and the living spec no longer relies on an untested dependency
default.

At pinned 2.1.0, supplying `rehypePlugins` replaces rather than merges defaults.
The explicit chain is `[rehypeRaw, [rehypeSanitize, reviewedSchema],
[harden, reviewedOptions]]`: `reviewedSchema` derives from `defaultSchema`
imported from `rehype-sanitize` (no extra dependency), and harden receives
reviewed non-wildcard protocol/image/link options. Current harden wildcard
prefixes/protocols are not the load-bearing sanitizer; `rehype-sanitize`'s
schema is. Parity characterization covers the remark chain too, including GFM
and breaks. Both wrapper paths retain the app `code`/`pre` overrides so
Streamdown's built-in Mermaid raw sink stays dormant; a fixture asserts that
no element with `aria-label="Mermaid chart"` mounts.

A single owner-associated test helper, proposed as
`tests/helpers/renderer-executable-markup-oracle.ts`, defines the rendered-DOM
oracle for markdown static/streaming, all Shiki consumers, Mermaid and editor
suites. Tests walk the actual untrusted output subtree (not source strings),
including namespace-aware SVG/MathML nodes and, when Question 9 includes the
diff path, its Shadow DOM descendants, and fail on:

- `script`, `iframe`, `object`, `embed`, `frame`, `base`, `meta`, `link`,
  `style`, `foreignObject`, any `animate*`, `set`, or `maction` element;
- any attribute whose normalized name begins with `on`, or any `srcdoc`
  attribute; and
- `href`, `src`, `xlink:href`, `action`, `formaction`, `poster`, or `data`
  values whose parsed/decoded protocol is `javascript:`, `data:`, `vbscript:`,
  `file:`, `blob:`, any custom scheme, or otherwise outside the reviewed
  sink-specific HTTP(S)/mailto allowlist. Mailto is link-only; it is not a media
  or form allowlist. Relative URLs must resolve through an explicit reviewed
  base or fail closed, never inherit the privileged file document implicitly.

The Mermaid profile may retain only validated same-SVG fragment references
needed for diagram paint; this does not authorize navigable URLs or weaken its
existing href stripping. Generated Shiki span styles and app-controlled
Mermaid paint use separate reviewed value profiles, rejecting remote CSS URLs
and active/overlay constructs. The safe-format matrix (emphasis, tables, code,
reviewed HTTP(S)/mailto links and safe HTTP(S) images where supported) is a
positive control alongside every negative suite. Executable data/blob payloads
are not accepted as formatting compatibility exceptions.

### D3. Shiki extraction fails closed

Keep one `highlightCode()` owner, remove the raw-code fallback, and make output
parsing failure return escaped text or a bounded failure value. Add hostile code
tests and a forced extraction-mismatch fixture. Callers may not each add their
own escape/sanitizer branch. The tests must cover code originating from chat,
repository views, MCP results, and tool output because those consumers share
the same producer but exercise different components. Replace the existing
`chat-markdown-renderer.tsx` local `escapeHtml` fallback with the reviewed
owner. Diff shim and dormant HAST paths stay separately inventoried under D1
and their Question 9 gates; they are not claimed consumers of `highlightCode`.

Mermaid remains its own reviewed adapter: forbid returned `style` elements,
strip unreviewed CSS-bearing attributes, and reapply only app-owned diagram
CSS. Attacker-controlled `themeCSS`/theme overrides must not affect the
transient render mount; the pinned configuration/source boundary must suppress
or reject them before `mermaid.render`, failing closed if that cannot be
proved. Test root `position:fixed`, background remote `url()`, `@import`, and
stray returned `style` in addition to script/link payloads. Strict mode is
load-bearing during Mermaid's temporary `document.body` mount, while DOMPurify
is load-bearing for returned SVG and the later DOMParser pass is defense in
depth. End-to-end tests must use pinned Mermaid through MermaidBlock's actual
render path with hostile flowchart/sequence `htmlLabels`, click directives,
`javascript:` links, and themeCSS. Assert the shared executable-markup oracle
on returned/sanitized SVG, no executable or unreviewed CSS artifacts from the
render remaining under `document.body`, and the identical reviewed string at both inline and
fullscreen sinks. Real GUI evidence also checks transient CSS effects and
cleanup; a literal-SVG sanitizer unit alone is insufficient.

### D4. Mentions undo/redo stores canonical editor state, not DOM HTML

Change undo/redo entries from `{ html, cursorOffset }` to a lossless canonical
run model: text runs and atomic reviewed mention runs, plus anchor/focus
positions expressed as run index and intra-text offset (mention positions are
only before or after the atomic run). Define and test the invariant
`serialize(build(state)) === normalize(state)`, including whitespace adjacent
to mentions; the current builder's unconditional post-mention space and the
current mention-as-one cursor arithmetic cannot silently become the canonical
model. Restore exclusively through the one safe builder, using text nodes and
reviewed mention elements. Remove the two non-empty `.innerHTML` assignments;
do not retain a sanitizer-based restore beside a structured restore.

The editor component owns browser rich-content insertion from every source,
not only paste. One `beforeinput` allowlist permits `insertText`,
`insertCompositionText`, `insertParagraph`/`insertLineBreak`, and reviewed
`deleteContent*` operations; `historyUndo`/`historyRedo` route through the safe
state builder with browser default prevented. Every other inputType is
prevented, including `insertFromDrop`, `insertFromPaste` (handled by the paste
gate), `insertLink`, `insertReplacementText`, and `format*`. Component-owned
`onDrop`/`onDragOver` prevent browser rich insertion and either consume only
explicit `text/plain` through the safe builder or reject it. The paste gate
likewise uses only `text/plain` for mixed input and rejects HTML-only input.
Typed attachment/image callbacks never return control to a browser rich-content
default. Optional parent handlers cannot be the security boundary.

Tests cover ordinary typing/IME, line breaks, exact spacing, atomic mentions,
undo/redo and forward/backward selection. Synthetic DragEvent/InputEvent
fixtures include HTML-only/mixed drop, `insertLink` and `formatBold`; DOM must
contain only text nodes, `br`, and reviewed mention spans under the shared
oracle. In happy-dom, prove `defaultPrevented`, unchanged DOM for HTML-only
input and safe-builder plain-text insertion (replace or stub `execCommand`).
Happy-dom has no native contentEditable rich paste or `execCommand`; actual
rich paste/drop rejection and native undo/redo are GUI task 5.1 evidence.

### D5. One main-process guest-policy owner guards every attachment

Create `src/main/windows/local-browser-guest-policy.ts` and install it from
`main.ts` for each privileged app window. It owns:

- pending preview admissions and guest identity;
- `will-attach-webview` validation and effective web preferences;
- `did-attach-webview` registration and all guest webContents handlers;
- guest session permission, device/display-capture, and download policy;
- partition lifecycle and cleanup; and
- minimized/redacted security diagnostics.

Install the embedder listener immediately after BrowserWindow construction and
before its app document can create a webview. `will-attach-webview` is the
attachment-time gate, not a pre-creation event: it consumes the one-shot pending
admission, validates initial `src` and partition, and forces the effective
preferences before the first guest load. Force `sandbox` and `contextIsolation`
explicitly in `will-attach-webview`: the privileged embedder's `sandbox:false`
is not a guest security default. `did-attach-webview` runs after initial
navigation starts and before commit; it registers the known guest and installs
WebContents defenses, while the already-created Session request gate is the
precommit authority. A fixture asserts no guest request precedes Session-gate
installation; any missing/late mandatory handler destroys the guest.

Unknown webviews are denied. The forced preference set is exact rather than a
partial denylist: `preload` and `additionalArguments` empty,
`nodeIntegration`, `nodeIntegrationInSubFrames`, and
`nodeIntegrationInWorker` false, `contextIsolation`, `sandbox`, and
`webSecurity` true, `allowRunningInsecureContent` and `webviewTag` false, no
popup grant, and the exact issued non-persistent partition. Any supplied value
outside that set is removed or rejects attachment; the decision and logs never
include the capability value or raw page URL. The issued guest Session must
also have zero registered preload scripts (`registerPreloadScript`/`setPreloads`);
empty webPreferences alone does not prove preload absence.

This does not alter `main.ts`'s `sandbox: false` setting for the privileged app
document. App CSP and app-window navigation handlers remain separate owners and
must not be cited as guest coverage.

### D6. Main issues a bounded preview admission from registered state

A dedicated internal IPC/preload operation requests a preview using chat
identity and the proposed initial URL. It is not a tRPC procedure and carries
no caller-provided filesystem root or webContents ID. Main derives the true
embedder from `IpcMainInvokeEvent.sender`, calls
`windowManager.claimChat(chatId, senderWindow.id)` atomically, then resolves the
DB-registered chat/worktree through `resolveRegisteredChatWorktreeRoot` and
normalizes the proposed URL before issuing a partition. Claiming is idempotent
for the same window and denies another live-window owner with a bounded reason;
it handles non-claiming chat-selection paths and first-preview IPC races.
This cross-checks chat ownership; authorization derives from the live app-window
sender and DB-registered chat/worktree, not from a renderer-named chat or the
ownership map alone.

Main creates a high-entropy, non-`persist:` partition before returning it. That
partition string is the only opaque correlation handle/bearer capability; do
not create a second attachment token. A pending registry entry binds
`embedder webContents ID + chat ID + preview generation + exact partition +
exact initial src`. It is single-consume, short-TTL, count-limited, replay
rejecting, and never placed in URL/query/hash, `additionalArguments`, guest
page data, logs, diagnostics, a database, or durable storage. It contains no
provider/user credential, but must be treated as security-sensitive.

The current `<webview key={currentUrl}>` behavior must be removed: allowed
same-origin navigation keeps one guest instead of remounting on every URL
change. A user-entered transition to a different local origin or a deliberate
guest recovery requests a new preview generation, partition, and one-shot
admission; the old guest is destroyed and cannot consume the new entry.
Every `<webview>` element mount, including a React remount or StrictMode double
mount, is a new attachment requiring a new generation. No renderer-side retry
may reuse a consumed admission. Main rejects concurrent conflicting guests, expired entries, unknown/default/
persistent partitions, `persist:main`, and cross-embedder or cross-preview
reuse.

Non-persistent Electron Session objects may remain alive until process exit;
Electron exposes no partition-destroy primitive. Teardown therefore means:
immediately revoke registry/admission state, destroy the guest, stop/unregister
service workers where supported, best-effort clear storage/cache/auth state,
and retain the Session's deny/webRequest handlers for its remaining lifetime.
Partition names are never reused. The owner bounds both active and cumulative
issued partitions and fails closed at its cap rather than falling back to a
shared/default Session.

This narrow admission exists only to create an isolated guest; it does not add
generic capability metadata, user consent, or an operation audit layer. Its IPC
and preload projection are owned by this change and explicitly outside
follow-up B's tRPC scope; wrapping or transferring them later requires a new
approved scope decision.

### D7. Main enforces top-level URL and file-root policy

Reuse `src/shared/local-browser-workbench.ts` for the single local URL grammar;
refactor its pure API if necessary so main and renderer do not carry separate
scheme/host tables. Renderer checks validate only user-entered URL input for
immediate UX; they must not retain page-controlled navigation-event listeners.
The main guest owner's `will-navigate`/`will-frame-navigate` handlers are the
sole source of minimized/redacted blocked-origin diagnostics. For HTTP(S), one
admission fixes the exact normalized origin, including port. Another local
origin requires a fresh user-entered admission.

Before main returns the unique partition, it creates/configures that Session
and installs its sole `webRequest.onBeforeRequest` listener over `<all_urls>`.
Observable network `mainFrame` requests pass through the exact-origin policy,
covering initial src, link/location, main-owned `webContents.loadURL`,
back/forward and redirect requests before commit. Remove the renderer
`<webview>.loadURL` escape hatch; named main navigation operations use the same
admission. The same listener must cancel direct `file:` requests for every
resource type. Runtime task 5.2 proves observed cancellation for `file:` in
mainFrame/subFrame/xhr/script/image positions and at every redirect hop,
including a 3xx to another loopback port; typings/net.fetch documentation alone
do not establish renderer request interception.

Non-network `about:`, `data:`, `blob:` and `javascript:` navigation is not
observable by `webRequest`; no fixture may attribute those denials to that
gate. The committed-URL postcondition owner permits only an initial
browser-created empty `about:blank` document inheriting the current admission,
and `blob:` documents whose inherited origin is verified equal to the exact
admitted origin. This is not permission for an arbitrary switch to `about:` or
another blob origin. Any other non-admitted or unprovable commit, including
`data:`, destroys the guest with a minimized reason. Guest
`will-navigate`/`will-frame-navigate` also deny non-admitted requests, including
`javascript:` attempts that need not commit a new document; unit fixtures and
GUI observation must prove the combined controls without claiming Session
coverage for non-network schemes. External-protocol top-level navigation
(`locus://`, `locus-dev://`, legacy `agent-code-for-me` variants, `mailto:`,
`vscode://`) likewise has no observable network request and is denied by these
guest navigation handlers plus the explicit `openExternal` permission denial
in D8. No OS handler or `mcp-import:preview` push may result.

`will-redirect` and committed-URL checks are additional defenses; they do not
replace the preinstalled request gate for programmatic network navigation. An
unexpected disallowed postcondition destroys the guest and emits only a
minimized diagnostic.

An admitted user-facing `file://` target is never handed to the guest. Main
resolves the root through
`src/main/lib/fs/registered-roots.ts:66-109`, then maps the relative target to a
fixed-origin, Session-local `locus-preview://preview.local/...` URL. A protocol
scheme with the minimum required standard/secure/fetch privileges is registered
once before app readiness; the per-Session handler and root binding exist before
the partition is returned. That handler serves top-level documents and relative
assets. It extends the existing descriptor owner at
`src/main/lib/filesystem/stable-directory.ts:65-157,191-205`, rather than adding
a competing backend. First `lstat` the DB-registered root and reject a final
symlink or non-directory. `realpath`-canonicalize it (allowing stable symlinked
parent prefixes such as macOS `/tmp` or `~/projects`), require the canonical
path's directory `dev`/`ino` to match the registered path's `lstat` directory
identity, then anchor the canonical root by directory descriptor and verify
its `fstat` identity. Re-read the registered identity and canonical resolution
after anchoring and fail closed on drift or mismatch. A symlink leaf's inode
is not its target's inode: this permits canonicalized parent prefixes, not a
final symlink root. Traverse child components without following symlinks, open
the final regular file with no-follow semantics, verify it, and stream bytes
from that same descriptor.
There is no authorization-check-then-path-reopen gap. This guarantees root
containment against path/symlink retargeting; it does not make an immutable
snapshot, so concurrent in-place writes to the already opened inode remain
possible and the resulting bytes remain untrusted content. Traversal, ambiguous
decoding, credentials, symlinks, special files, remote hosts, and unsupported
schemes fail closed.

If the platform/filesystem cannot expose and verify the required anchored read,
file preview is unavailable with a bounded local explanation; direct
`file://`, `net.fetch(file:)`, or path-only fallback is forbidden. This is a
compatibility decision covered by approved Question 5, not a claim that the
current `resolveRealPathWithinRoot()` removes TOCTOU. Concretely, the existing
owner has Linux `/proc/self/fd` and Darwin/FreeBSD `/dev/fd` anchors and no win32
backend: file preview ships disabled for the Windows nsis/portable targets
until a Yellow handle-relative backend extension lands. Windows packaged
receipts must record that unsupported-platform result; broker success cannot
be claimed there. Root identity/canonicalization mismatch is a separate honest
fail-closed case.

Guest `setWindowOpenHandler` always denies `window.open` and `_blank`; unlike
the trusted app-window handler, it does not call `shell.openExternal`.

### D8. Guest permissions and downloads default deny without changing app voice

Each issued guest partition installs both Electron
`setPermissionCheckHandler` and `setPermissionRequestHandler` before load, with
consistent default denial, explicitly including `openExternal`, plus
`setDevicePermissionHandler(() => false)`. External protocols such as Locus
and legacy deep links, mailto and vscode must not open an OS handler or publish
an MCP import preview through top-level links, `location.href`, or `_blank`.
The trusted app-window `shell.openExternal`/`openExternalUrl` path is separate.
For every Session HID/serial/USB selector and guest Bluetooth selection event,
the owner calls `event.preventDefault()` and then its denying callback: empty
string for Bluetooth/serial and no selected ID for HID/USB. This prevents
Electron's default first-device selection. `setDisplayMediaRequestHandler`
returns no streams with `useSystemPicker: false`, unknown permission types fail
closed, and no native prompt is shown. Session `will-download` cancels ordinary,
redirected, and download-attribute downloads.

Handlers are partition-specific and must not be installed as a deny-all policy
on `persist:main`, where
`src/renderer/lib/hooks/use-voice-recording.ts:95-120` legitimately requests
microphone access. Tests prove guest denial and trusted app voice behavior
independently.

### D9. Diagnostic JavaScript is a closed operation set

Do not accept a code string from a component, model, page, repository, or tool.
Expose named app-owned operations (click tracker, DOM summary, last selection)
that map to fixed reviewed scripts. Move the existing inline selection probe
from `local-browser-workbench.tsx:301-304` into the shared named script set.
Main invokes all probes with `userGesture:false`; page-poisonable diagnostics
must not gain transient user activation. Bind each request/result to the current
guest and navigation generation; ignore a result from a destroyed, replaced,
or navigated guest.

Raw probe results remain in main. A single proposed
`src/shared/local-browser-diagnostics-policy.ts` is a serializable shape and
composition adapter, not a second redaction owner. Main applies the shape
before returning data: drop URL credentials and query/fragment by default;
minimize console/load-failure, DOM-body and selected-element fields; compose
`src/main/lib/agent-runtime/redaction.ts` for provider-pattern and exact-secret
redaction; then enforce type, count and length bounds. The shared adapter must
not import main or recreate secret matching. Electron console levels
`info`/`warning`/`error`/`debug` map identically into `LocalBrowserConsoleLevel`;
`log` remains the bounded fallback for an unknown level, with no raw payload
included in a fallback diagnostic. Exact secret hints, if supplied by main,
never cross into the renderer. Security logs and
receipts contain only reason codes and redacted origins, never the partition
capability, raw URL, console/DOM text, or probe result.

Electron dispatches `console-message`, `did-fail-load` (including provisional
load failure), `page-title-updated`, `will-navigate`, `did-navigate`, and in-page
navigation events directly from a `<webview>` element to its embedder renderer.
The workbench currently listens to those raw events and writes their page-controlled
fields into renderer state. Implementation removes all these renderer
listeners, including `will-navigate#handleNavigate` writes to URL input/error
and load-failure report state, and generically every raw `<webview>` event
whose payload carries page-controlled URL/title/text. Electron element dispatch
itself is not claimed suppressed. Proof asserts absence from app state, chat
text, security logs and receipt media. The renderer keeps at most a URL-free
lifecycle signal. After `did-attach-webview`, the main guest-policy owner listens
on the admitted guest `webContents`, binds every event to the current guest/navigation
generation, and runs the same minimization/redaction/bounds policy before a
narrow internal projection reaches renderer state. URLs in that projection
omit credentials, query, and fragment. The renderer may keep lifecycle-only
element signals that carry no page-controlled diagnostic value, but it cannot
reconstruct or recover the raw event payload from them.

The workbench shows the final minimized/redacted report for user inspection.
Only the existing explicit insert action can copy that final text into chat;
the raw result is neither stored in renderer state nor automatically sent.
Tests include bearer/API-key/JWT, Authorization, OAuth code/state/nonce, URL
credentials/query/fragment, and ordinary safe-content controls. Page JavaScript
otherwise remains enabled.

### D10. Unit evidence and real Electron evidence are separate gates

Unit/integration coverage uses Electron doubles for event ordering and a
malicious local fixture for rendered content and guest requests. A GUI-capable
host then runs development and packaged tracks against the same frozen source
SHA. The receipt records platform/tool versions, commands, fixture commit/hash,
redacted logs, and screenshot/recording hashes. Unit editor evidence is limited
to `defaultPrevented`, unchanged DOM for HTML-only input, and safe-builder
plain-text insertion; happy-dom cannot prove native paste/drop or execCommand
behavior. The real browser task 5.1 owns rich-paste/drop rejection and undo/redo.
All content suites apply D2's shared rendered-DOM oracle and safe-format
controls. Mermaid additionally runs the pinned dependency through the actual
component, checks body cleanup and identical inline/fullscreen output, then
uses GUI observation for transient rendering effects.

The GUI matrix must demonstrate:

- static/streaming markdown, Shiki, Mermaid (including themeCSS/stray style,
  actual transient mount and cleanup), subtitle, and mentions typing/IME,
  rich-paste/drop, formatting rejection, and undo/redo behavior;
- **Question 9 conditional row:** if (a) or the compromise is approved, hostile
  file names, hunk headers, line content and diff-text/HAST serialization
  breakouts through actual `<FileDiff>`/`<PatchDiff>` with Locus's shim/Vite
  aliases; exact `@pierre/diffs` and resolved Shiki 3 subtree pins join the
  upgrade gate. If (a) is approved in full, add Monaco file-viewer and hostile
  PTY-stream xterm rendering fixtures too. Under (b), remove this reviewed-
  producer row and record explicit residuals; under the compromise, Monaco/
  xterm receive the Yellow residual receipt instead. No outcome is preselected;
- guest bridge/Node-global absence and zero Session-level registered preloads;
- initial/link/location/main-owned `loadURL`/back/forward/each redirect-hop
  exact-origin denial, including a 3xx to another loopback port;
- observed direct `file:` cancellation in mainFrame/subFrame/xhr/script/image,
  brokered-file success plus descriptor-race/symlink/root-identity mismatch
  denial, or an honest unsupported-platform result; Windows packaged preview
  remains disabled with the current backend. Stable symlinked parent-prefix
  canonicalization is a positive control on supported hosts;
- non-network about/data/blob/javascript cases and external-protocol
  `locus://`/development/legacy/mailto/vscode top-level, `location.href` and
  `_blank` probes, with no claimed webRequest observation, OS handler launch,
  or `mcp-import:preview` push;
- popup, explicit `openExternal` permission/device/display, and download denial
  with no BrowserWindow, external-app launch, OS prompt, or file write;
- isolation between two preview partitions, registry revocation, storage
  cleanup, and never-reused partition identity after teardown;
- fixed `userGesture:false` diagnostic probes whose displayed/chat-ready
  results are minimized, secret-redacted, bounded, and stale-result rejecting;
  raw event bytes must be absent from app state/chat/logs/media, without a claim
  that Electron element dispatch itself is suppressed;
- controlled observation that remote/other-loopback subresource egress is an
  accepted residual: guest fetch to Locus's fixed-port auth callback and an
  isolated gateway fixture produces bounded 400/401/404 with no state change;
  these requests are not mislabeled as blocked. Record app-document HTTPS
  image-beacon egress separately; and
- packaged production plus development/HMR CSP as two TICKET-114 tracks.

TICKET-114 receipt rules remain authoritative for the last item. No current
result rewrites historical tasks 4.4/4.5. Review suggestion #17 to add explicit
`object-src 'none'; base-uri 'none'; frame-src 'none'` was considered but is not
a new mandatory CSP edit in this document-only touch-up: it would require
separate compatibility evidence against app surfaces. Current CSP construction
and development/packaged enforcement remain required tracks; D2's markup
oracle excludes these active elements regardless of that optional policy work.

## Alternatives Considered

### Sanitize every string at every caller

Rejected. It creates duplicate policy, loses the distinction between generated
code HTML and SVG, and lets a new caller select a broad sanitizer without
declaring its producer. One reviewed-output owner plus exact sink inventory is
more auditable.

### Keep raw HTML in the mentions undo stack and sanitize on restore

Rejected. The editor already has a canonical serialized representation and a
safe builder. Keeping both HTML restore and structured restore would preserve a
second business path and make cursor/state behavior harder to reason about.

### Rely on the renderer's current URL listeners and partition string

Rejected as a security boundary. Those checks provide useful UX but can run
after redirect commit, accept a renderer-supplied lexical file root, do not own
effective guest preferences, and do not cover guest permissions or popups.
Electron `will-navigate` / `will-frame-navigate` also omit programmatic
`loadURL` and back navigation, so they cannot replace the Session request gate.

### Realpath once and let Electron load the resulting `file://` path

Rejected. A successful containment check followed by a later path-based open
leaves a symlink/check-to-open race. The broker must serve the descriptor it
verified, and direct `file:` requests stay denied. Where the platform cannot do
that, losing file preview is safer and more honest than claiming containment.

### Disable `webviewTag` or replace webview with WebContentsView now

Deferred. Either may reduce long-term attack surface, but a replacement changes
layout, event plumbing, capture/diagnostic behavior, and lifecycle ownership.
This bounded change keeps the sole existing webview behind a main-owned policy.
A later replacement must preserve these invariants rather than bypass them.

### Disable all guest JavaScript

Rejected. Local app behavior and the existing capture/click diagnostics depend
on JavaScript. Isolation, permission denial, closed diagnostic operations, and
navigation policy address the privileged boundary without removing the feature.

### Implement guest policy through follow-up B's generic capability layer

Rejected. Attach preferences, preload absence, permission handlers, and guest
navigation must exist before a guest can request anything. Follow-up B governs
privileged renderer requests after compromise and is not a prerequisite for
guest confinement.

## Risks / Trade-offs

- **Rendering regressions from an explicit markdown policy.** Preserve a safe
  control matrix and compare static/streaming output before switching the owner.
- **Event-order gaps in Electron.** Test attach, redirect, replacement, teardown,
  `loadURL`, back/forward, and unexpected postcondition paths with doubles,
  then prove wiring in real development and packaged Electron.
- **Process-lifetime Session accumulation.** Use main-issued, never-reused
  ephemeral partitions, cap active/cumulative issuance, revoke registry state,
  and retain deny handlers until process exit; never share with the trusted
  app/default session or claim the Session object was destroyed.
- **File-path TOCTOU or symlink escape.** Use a descriptor-anchored broker, not
  just registered-root/realpath prechecks. Unsupported platforms fail closed,
  which may reduce file-preview availability. The broker prevents path
  retargeting outside the root, not concurrent mutation of the same admitted
  inode; all served bytes therefore remain untrusted renderer content.
- **Dependency-internal producers.** The shim-backed diff path, Monaco and
  xterm must not disappear from the inventory; Question 9 decides reviewed
  coverage versus named residuals. Shadow DOM provides no script/CSP isolation.
- **Diagnostic data controlled by the page.** Bind to guest/navigation identity
  and minimize/redact/bound all output in main before renderer or chat use.
- **Guest network egress remains.** A page can contact remote or unrelated
  loopback services through non-top-level requests. Exact-origin navigation
  reduces silent replacement but not egress/CSRF; the eight-default Owner
  approval accepts this residual, now including the named local listeners.
- **Webview remains a powerful primitive.** Deny all unregistered attachments
  globally on app webContents and retain a future WebContentsView migration as
  a separate decision.
- **GUI hosts may be unavailable.** That blocks implementation acceptance; this
  design does not permit substituting historical or unit evidence for the new
  guest receipt.

## Migration, Failure, And Rollback

There is no database migration. Introduce characterization tests first, then
the reviewed-content owner, then the main guest owner and renderer projection.
Remove superseded whole-file exemptions, raw-code fallback, caller-local chat
escaping, the remote react-scan script loader, raw-HTML undo state, default
rich-HTML paste/drop/other browser rich-content insertion, renderer-derived
partition authority/URL-key remount, direct guest `file://` loading, and renderer
listeners for raw
`console-message`, `did-fail-load`, `page-title-updated`, `will-navigate`,
`did-navigate`, in-page navigation, and any page-controlled URL/title/text event
payloads, and duplicate guest policy in the same implementation. Replace those raw event paths with the sole main-owned
post-`did-attach-webview` guest `webContents` relay after
minimization/redaction/bounds; do not leave a renderer fallback listener.

If the content policy cannot initialize, render escaped text or a bounded error.
If guest admission or any mandatory handler cannot initialize, keep the Local
Browser panel disabled with a bounded local diagnostic. Never fall back to an
unregistered webview, a shared Session, path-only file loading, or the
renderer-only policy.

Rollback returns to escaped content and a disabled Local Browser, not to the
unsafe fallback. Because admissions are process-local, rollback has no database
cleanup, though issued non-persistent Session objects may remain until the
Electron process exits and therefore retain their deny handlers.

## W7 Autonomy Envelope

- **Green after approval only:** test-fixture organization, exact bounded
  constants, internal type names, additional hostile payloads, and equivalent
  fail-closed implementation details within the approved owners.
- **Yellow:** safe-markdown schema adjustments, diagnostic field additions,
  TTL/count tuning within approved bounds, or extending the existing stable-
  directory owner with another platform-safe backend without weakening the
  broker contract. Record the decision and obtain targeted reviewer agreement
  before proceeding. If Question 9 selects (b) or the compromise, register the
  Monaco/xterm residual in a Yellow ticket provisionally numbered TICKET-123
  (next after current TICKET-122); recheck the repository sequence before
  creating `docs/tickets/TICKET-123-dependency-dom-producer-residuals.md` in a
  separately authorized write scope. This document-only dispatch permits only
  the change package and `openspec/STATUS.md`, so no ticket outside that scope
  is created here. Its closure must define file-viewer and hostile-PTY behavior
  evidence, dependency/upgrade ownership, and a scope decision without
  authorizing product implementation. Option (b) also records the diff residual.
- **Red:** public/versioned API, database state, generic tRPC capability work,
  permission allowlisting for guests, remote subresource firewalling,
  privileged-main sandbox migration, WebContentsView replacement, a new runtime
  dependency not named in the approved design, direct/path-only `file:`
  fallback, widening top-level origin, weakening any fail-closed rule, or
  proceeding without GUI evidence. Return to OpenSpec and the Owner.

## Approval Questions (Recommended Defaults)

Questions 1–8: **Owner APPROVED all eight recommended defaults, 2026-09-05**.
The disclosures below clarify their implementation and evidence without
weakening those defaults. Source editing still requires tasks 0.2/0.3/0.4/0.5;
Question 9 is a separate, unresolved coverage decision.

1. **Markdown owner:** approve exact Streamdown 2.1.0, one app wrapper, and an
   explicit reviewed rehype chain with every imported plugin exact/direct; any
   exported-default alternative must first be written into this design and pass
   the same retained behavior gate.
2. **Editor paste/state:** approve the lossless run/selection model, component-
   owned default prevention, plain-text-only mixed paste, and rejection of
   HTML-only paste.
3. **Guest primitive and transport:** retain the sole webview, make the random
   partition the only one-shot attachment capability, remove URL-key remounts,
   and keep the narrow IPC/preload handshake A-owned and outside follow-up B.
4. **Navigation/network boundary:** require a pre-return Session
   `onBeforeRequest` gate and exact admitted top-level origin; explicitly accept
   that remote/other-loopback subresource, fetch, form, WebSocket, image/ping,
   and frame traffic remains possible and can have external/CSRF effects.
   This includes Locus's state-validated MCP auth callback (21321; dev 21322),
   state-validated OAuth callback (8914), Bearer-authenticated random-port
   provider gateway, and development Vite/HMR; fingerprinting/nuisance probing
   remains possible, without an identified unauthenticated state-changing Locus
   endpoint.
5. **File preview:** approve direct `file:` denial plus the Session-local,
   descriptor-anchored `locus-preview://` broker; accept fail-closed loss of
   file preview on platforms/filesystems lacking a proven safe-read backend and
   accept that containment does not freeze concurrent writes to the same inode.
   With the existing descriptor owner, **file preview ships disabled on win32**
   (including nsis/portable) until a Yellow handle-relative backend extension
   lands; supported platforms still require canonical root/descriptor identity
   re-verification, including roots with symlinked parent prefixes.
6. **Guest permissions:** approve deny-all guest permissions, device selectors,
   display capture, downloads, and popups, while leaving the trusted app Session
   under its own policy.
7. **Partition/diagnostic lifetime:** approve never-reused process-local
   partitions whose Session objects may remain until process exit, bounded
   issuance and best-effort state cleanup, plus main-before-renderer diagnostic
   minimization/redaction and user preview before chat insertion.
8. **GUI gate:** require the full malicious-content plus guest-security matrix
   in both development and packaged tracks, plus separately recorded
   TICKET-114 development-HMR and packaged-production CSP tracks, before
   `IMPLEMENTATION_VERIFIED`.

### Approval Question 9 — Dependency-internal DOM producer coverage

**Status: PENDING Owner decision (morning 2026-09-06).** The eight approved
recommended defaults remain in force. This question does not select a coverage
option or authorize source edits.

**(a) Include all three paths in the reviewed-producer contract.** Add black-box
adversarial rendering tests through `<FileDiff>`/`<PatchDiff>` with the Locus-owned
Shiki shim and Vite aliases (hostile file names, hunk headers, line content and
diff text that attempts HAST serialization breakouts), the Monaco file viewer,
and hostile PTY streams through xterm. Exact-pin `@pierre/diffs` and its resolved
`shiki ^3` subtree, and put dependency/shim/alias changes behind the retained
upgrade gate. Add D10 rows and a source-guard alarm for new Shiki-API shims or
Vite aliases into DOM-producing dependencies. Route or remove the shim's local
`escapeHtml`/`codeToHtml` through the reviewed-content owner; classify the
dormant `diff-view-highlighter.ts#getAST` adapter rather than calling it a live
producer.

**(b) Declare explicit residuals.** Record these dependency-internal paths in
Threat Model residuals and Non-Goals, naming the diff path's current text-node
HAST, default `toHtml` escaping, production CSP and `DiffErrorBoundary` controls.
Still exact-pin `@pierre/diffs` as a low-cost drift control; retain its resolved
Shiki subtree in the dependency review inventory. Register a Yellow ticket for
Monaco/xterm coverage and record the diff residual there. Remove the conditional
reviewed-diff Scenario and D10 behavior row; do not describe residual paths as
reviewed producers.

**统筹推荐默认值 = 折中 / Coordinator recommended default = compromise:** apply
(a) to the `@pierre/diffs` path, because its Shiki shim and Vite aliases are
Locus-owned code: exact-pin the package and its resolved Shiki subtree, retain
one adversarial black-box fixture group through the real shim-backed
`<FileDiff>`/`<PatchDiff>` path, and add its D10 row and upgrade/source guard.
Apply (b) to Monaco/xterm: explicit Threat Model residuals plus a Yellow ticket,
provisionally `TICKET-123` after the current repository sequence (revalidate
before creation). The intended ticket path is
`docs/tickets/TICKET-123-dependency-dom-producer-residuals.md`; this dispatch's
write scope excludes `docs/tickets`, so the ticket content/scope remains a
tracked follow-up pending the Owner decision and an authorized ticket write.

All corresponding tasks and the delta Scenario “Dependency diff rendering
is covered if Approval Question 9 includes it” are **gated on Approval Question 9**.
If the Owner selects (b), delete that Scenario; if the Owner selects the
compromise, retain only the diff-path reviewed-producer scope; if the Owner
selects (a), also finalize Monaco/xterm coverage before task 0.5 exact-package
confirmation. Record the actual Owner decision and obtain the targeted P1/P2
re-review, then task 0.4 rebase and task 0.5 strict validation/exact-package
confirmation, before source edits.
