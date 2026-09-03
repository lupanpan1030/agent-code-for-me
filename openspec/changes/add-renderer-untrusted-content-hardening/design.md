## Context

This is an R3 design Draft. It carries forward only the unfinished renderer and
webview work routed out of archived `update-trpc-capability-boundary`; it does
not reopen the capability, consent, or router-boundary decisions assigned to
follow-up B.

The evidence baseline is local `main` at
`30c72ad3c26dd952410c6e38678faf43d8c55895`. The 2026-08-26 handoff is useful
scope history, but several of its implementation statements are now stale. The
following table is the current-main baseline that this Draft uses.

| Surface | Implemented baseline | Remaining gap owned here |
| --- | --- | --- |
| Markdown | Static and streaming `Streamdown` mounts are at `src/renderer/components/chat-markdown-renderer.tsx:460-469,693-700`. `bun.lock` resolves Streamdown 2.1.0 and its default raw/sanitize/harden chain; `package.json` declares the wider `^2.0.1` range. | No retained malicious-HTML or executable-URL render test covers either app path; dependency behavior is carrying a security statement without a local upgrade gate. |
| React raw HTML | `tests/renderer-html-sinks.test.ts:27-68` permits five files. Current source has six `dangerouslySetInnerHTML` insertions: chat markdown (one), Mermaid (two), and three tool/message views. Mermaid alone has a dedicated sanitizer. | The guard exempts whole files, not individual sinks, and does not bind each sink to a reviewed producer or test its rendered behavior. |
| Shiki | Four non-Mermaid sinks converge on `highlightCode()` in `src/renderer/lib/themes/shiki-theme-loader.ts:255-292`. The locked Shiki output escapes sampled hostile text. | `<code>` extraction failure returns raw `code` at line 287. There is no hostile-input or changed-output-shape regression, so the fallback is fail open if a dependency shape changes. |
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

- No implementation before Owner `APPROVED`.
- No generic renderer-to-main capability, consent, audit, or kill-switch layer.
- No `scripts/check-architecture-guards.mjs` or Foundation 1c baseline change.
- No privileged-main-window sandbox migration and no WebContentsView rewrite.
- No blanket disabling of preview JavaScript.
- No claim of guest network-egress isolation. Exact-origin top-level navigation
  is enforced, but remote or other-loopback fetch/form/WebSocket/image/ping/
  frame traffic remains possible unless the Owner separately expands scope.
  This is an explicit residual requiring Owner acceptance, not a safety claim.
- No public/versioned API or durable-data change.

## Threat Model

The attacker may control:

- repository files, chat/model output, MCP and tool input/output, markdown raw
  HTML, fenced code, Mermaid source, and URLs embedded in those values;
- a local HTTP server or file preview, including its JavaScript, redirects,
  popup/download attempts, permission requests, storage, and returned
  diagnostics;
- HTML-only or mixed-format clipboard content presented to a contentEditable
  mentions editor;
- output-shape drift introduced by an allowed Streamdown or Shiki upgrade; and
- timing around guest creation, navigation, teardown, and stale diagnostic
  results.

The guest is not treated as a network sandbox. A malicious preview may still
send page-originated subresource, fetch, form, WebSocket, image/ping, or frame
traffic to remote hosts or another loopback service. Exact-origin top-level
confinement prevents silent guest replacement but does not prevent that egress
or its possible CSRF-like side effects.

The attacker must not:

- execute script or event handlers in the privileged app document through a
  reviewed content path;
- turn source text into markup by breaking out of a highlighted-code sink;
- cause an unclassified raw insertion to enter source without the guard failing;
- obtain `electronTRPC`, `desktopApi`, `webUtils`, Node globals, the app preload,
  or privileged IPC from a preview guest;
- navigate a guest top-level frame outside its main-authorized local boundary,
  escape an allowed file root through a symlink, create/open another window,
  trigger a system permission prompt, or write a download; or
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
7. Page-controlled diagnostic bytes do not enter privileged renderer state,
   chat, security logs, or receipts before main-owned minimization, redaction,
   and bounds have run.

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
different schema. `highlightCode()` remains the sole Shiki producer and returns
only reviewed output. Streamdown is wrapped at the component boundary and is
covered by rendered behavior tests even though its internal tree-to-React
conversion does not expose the same branded string.

`tests/renderer-html-sinks.test.ts` becomes the renderer source-guard owner. Its
inventory is keyed by stable enclosing symbol/construct and expected producer,
not a broad file name or volatile line number. It scans at least:

- `dangerouslySetInnerHTML`;
- non-empty and empty `.innerHTML` / `.outerHTML` writes;
- `insertAdjacentHTML`, `document.write` / `writeln`, and
  `Range#createContextualFragment`;
- `srcDoc` / `srcdoc`; and
- platform equivalents such as `setHTMLUnsafe`.

The scanner includes negative self-test fixtures so a new or disguised
value-bearing sink makes the test fail. Constant empty clears may be separately
classified, though replacing them with DOM removal APIs is preferred.

### D2. Streamdown behavior is repository-gated in both modes

Both Streamdown mounts move behind one app-owned wrapper/configuration so they
cannot drift. The implementation must retain black-box tests for static and
streaming modes that cover, at minimum:

- script/iframe and active SVG/MathML constructs;
- event-handler attributes;
- executable and encoded URL payloads in links and media attributes;
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

### D3. Shiki extraction fails closed

Keep one `highlightCode()` owner, remove the raw-code fallback, and make output
parsing failure return escaped text or a bounded failure value. Add hostile code
tests and a forced extraction-mismatch fixture. Callers may not each add their
own escape/sanitizer branch. The tests must cover code originating from chat,
repository views, MCP results, and tool output because those consumers share
the same producer but exercise different components.

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

The editor component itself owns a default-preventing paste gate. Mixed input
may consume only its explicit `text/plain` representation. HTML-only input is
rejected with no DOM insertion; attachment/image delegation remains typed but
never returns control to the browser's rich-content default. Optional parent
handlers cannot be the security boundary. Tests cover ordinary typing, exact
spacing, atomic mention selection, undo/redo, mixed clipboard data, HTML-only
clipboard data, and forward/backward selection restoration.

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
preferences before the first guest load. `did-attach-webview` then registers
the known guest and installs WebContents defenses; any missing/late handler
destroys the guest.

Unknown webviews are denied. The forced preference set is exact rather than a
partial denylist: `preload` and `additionalArguments` empty,
`nodeIntegration`, `nodeIntegrationInSubFrames`, and
`nodeIntegrationInWorker` false, `contextIsolation`, `sandbox`, and
`webSecurity` true, `allowRunningInsecureContent` and `webviewTag` false, no
popup grant, and the exact issued non-persistent partition. Any supplied value
outside that set is removed or rejects attachment; the decision and logs never
include the capability value or raw page URL.

This does not alter `main.ts`'s `sandbox: false` setting for the privileged app
document. App CSP and app-window navigation handlers remain separate owners and
must not be cited as guest coverage.

### D6. Main issues a bounded preview admission from registered state

A dedicated internal IPC/preload operation requests a preview using chat
identity and the proposed initial URL. It is not a tRPC procedure and carries
no caller-provided filesystem root or webContents ID. Main derives the true
embedder from `IpcMainInvokeEvent.sender`, verifies that its BrowserWindow ID is
`windowManager.getChatOwner(chatId)` (`src/main/windows/window-manager.ts:206-211`),
resolves the registered worktree, and normalizes the proposed URL.

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
admission; the old guest is destroyed and cannot consume the new entry. Main
rejects concurrent conflicting guests, expired entries, unknown/default/
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
scheme/host tables. Renderer checks remain immediate UX. For HTTP(S), one
admission fixes the exact normalized origin, including port. Another local
origin requires a fresh user-entered admission.

Before main returns the unique partition, it creates/configures that Session
and installs its sole `webRequest.onBeforeRequest` listener over `<all_urls>`.
All `mainFrame` requests pass through the exact-origin policy, so initial src,
link/location, programmatic `webContents.loadURL`, back/forward, and each
redirect request are checked before commit. The same listener cancels every
direct `file:` request for every resource type. `will-frame-navigate`,
`will-redirect`, and committed-URL checks are defense in depth; they are not
cited for programmatic coverage. An unexpected disallowed postcondition
destroys the guest and emits only a minimized diagnostic.

An admitted user-facing `file://` target is never handed to the guest. Main
resolves the root through
`src/main/lib/fs/registered-roots.ts:66-109`, then maps the relative target to a
fixed-origin, Session-local `locus-preview://preview.local/...` URL. A protocol
scheme with the minimum required standard/secure/fetch privileges is registered
once before app readiness; the per-Session handler and root binding exist before
the partition is returned. That handler serves top-level documents and relative
assets. It extends the existing descriptor owner at
`src/main/lib/filesystem/stable-directory.ts:65-157,191-205`, rather than adding
a competing backend: anchor the registered root by directory descriptor,
traverse each component without following symlinks, open the final regular file
with no-follow semantics, verify it, and stream bytes from that same descriptor.
There is no authorization-check-then-path-reopen gap. This guarantees root
containment against path/symlink retargeting; it does not make an immutable
snapshot, so concurrent in-place writes to the already opened inode remain
possible and the resulting bytes remain untrusted content. Traversal, ambiguous
decoding, credentials, symlinks, special files, remote hosts, and unsupported
schemes fail closed.

If the platform/filesystem cannot expose and verify the required anchored read,
file preview is unavailable with a bounded local explanation; direct
`file://`, `net.fetch(file:)`, or path-only fallback is forbidden. This is a
compatibility decision the Owner must approve, not a claim that the current
`resolveRealPathWithinRoot()` removes TOCTOU.

Guest `setWindowOpenHandler` always denies `window.open` and `_blank`; unlike
the trusted app-window handler, it does not call `shell.openExternal`.

### D8. Guest permissions and downloads default deny without changing app voice

Each issued guest partition installs both Electron
`setPermissionCheckHandler` and `setPermissionRequestHandler` before load, with
consistent default denial, plus `setDevicePermissionHandler(() => false)`.
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
that map to fixed reviewed scripts. Bind each request/result to the current
guest and navigation generation; ignore a result from a destroyed, replaced,
or navigated guest.

Raw probe results remain in main. A single proposed
`src/shared/local-browser-diagnostics-policy.ts` defines the serializable safe
shape, while main applies it before returning data: drop URL credentials and
query/fragment by default; minimize console/load-failure, DOM-body, and selected
element fields; compose the existing provider-pattern and exact-secret
redaction owners; then enforce type, count, and length bounds. Exact secret
hints, if supplied by main, never cross into the renderer. Security logs and
receipts contain only reason codes and redacted origins, never the partition
capability, raw URL, console/DOM text, or probe result.

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
redacted logs, and screenshot/recording hashes.

The GUI matrix must demonstrate:

- static/streaming markdown, Shiki, Mermaid, subtitle, and mentions behavior;
- guest bridge/Node-global absence;
- initial/link/location/`loadURL`/back/forward/redirect exact-origin denial;
- direct `file:` denial plus brokered-file success and descriptor-race/symlink
  denial, or an honestly recorded fail-closed unsupported-platform result;
- popup, permission/device/display, and download denial with no BrowserWindow,
  external-app launch, OS prompt, or file write;
- isolation between two preview partitions, registry revocation, storage
  cleanup, and never-reused partition identity after teardown;
- fixed diagnostic probes whose displayed/chat-ready results are minimized,
  secret-redacted, bounded, and stale-result rejecting;
- a controlled observation that remote/other-loopback subresource egress is an
  accepted residual and not mislabeled as blocked; and
- packaged production plus development/HMR CSP as two TICKET-114 tracks.

TICKET-114 receipt rules remain authoritative for the last item. No current
result rewrites historical tasks 4.4/4.5.

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
- **Diagnostic data controlled by the page.** Bind to guest/navigation identity
  and minimize/redact/bound all output in main before renderer or chat use.
- **Guest network egress remains.** A page can contact remote or unrelated
  loopback services through non-top-level requests. Exact-origin navigation
  reduces silent replacement but not egress/CSRF; Owner acceptance is required.
- **Webview remains a powerful primitive.** Deny all unregistered attachments
  globally on app webContents and retain a future WebContentsView migration as
  a separate decision.
- **GUI hosts may be unavailable.** That blocks implementation acceptance; this
  Draft does not permit substituting historical or unit evidence for the new
  guest receipt.

## Migration, Failure, And Rollback

There is no database migration. Introduce characterization tests first, then
the reviewed-content owner, then the main guest owner and renderer projection.
Remove superseded whole-file exemptions, raw-code fallback, raw-HTML undo state,
default rich-HTML paste, renderer-derived partition authority/URL-key remount,
direct guest `file://` loading, and duplicate guest policy in the same
implementation.

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
  before proceeding.
- **Red:** public/versioned API, database state, generic tRPC capability work,
  permission allowlisting for guests, remote subresource firewalling,
  privileged-main sandbox migration, WebContentsView replacement, a new runtime
  dependency not named in the approved design, direct/path-only `file:`
  fallback, widening top-level origin, weakening any fail-closed rule, or
  proceeding without GUI evidence. Return to OpenSpec and the Owner.

## Approval Questions (Recommended Defaults)

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
5. **File preview:** approve direct `file:` denial plus the Session-local,
   descriptor-anchored `locus-preview://` broker; accept fail-closed loss of
   file preview on platforms/filesystems lacking a proven safe-read backend and
   accept that containment does not freeze concurrent writes to the same inode.
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
