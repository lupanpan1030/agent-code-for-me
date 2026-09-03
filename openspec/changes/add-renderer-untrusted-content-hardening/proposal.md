# Change: Harden untrusted renderer content and local-browser guests

> Status: **DRAFT (R3) — NOT APPROVED FOR IMPLEMENTATION**. This package is
> rebased on local `main` at
> `30c72ad3c26dd952410c6e38678faf43d8c55895` (2026-09-04). It authorizes no
> product-code edit. Implementation requires an exact-scope Owner `APPROVED`
> verdict after feasibility and independent security review.

## Why

The archived `update-trpc-capability-boundary` change now carries the renderer
security behavior that is already implemented, while routing its unfinished
2.2–2.4 work and the removed R6 webview scenario here. Its living R6 also
records one concrete gap: markdown sanitization currently relies on the
Streamdown version resolved by `bun.lock` (2.1.0) and its default
`rehype-raw -> rehype-sanitize -> rehype-harden` chain, but no retained
in-repository regression renders malicious HTML through the app's static and
streaming paths.

The current source guard is narrower than its name suggests. It permits the
five renderer files that contain six React `dangerouslySetInnerHTML` insertions,
but does not inventory individual insertions, bind each one to a reviewed
producer, or scan direct DOM assignments. The mentions editor has two non-empty
`.innerHTML` restores for undo and redo. Those restores replay the editor's own
DOM snapshot, and normal callers install a plain-text paste handler. However,
an HTML-only clipboard currently leaves the browser's default contentEditable
insertion available. This Draft does not claim a demonstrated exploit; it
requires eliminating both the unreviewed restore and default-paste paths.
Shiki is the shared producer for four raw HTML consumers, and its wrapper
currently falls back to unescaped source text if its `<code>` extraction no
longer matches. That is a fail-open dependency-shape risk, not a claim that the
locked Shiki version is currently exploitable.

The Local Browser Workbench also has meaningful defenses already: it normalizes
local-only top-level URLs in the renderer, rolls back rejected navigation, and
uses a non-persistent chat-derived partition. The privileged main window has
its own CSP, navigation/redirect guard, and window-open policy. Those app-window
handlers do not govern a webview guest. The repository has no app-owned
`will-attach-webview` / `did-attach-webview` policy, guest navigation or popup
handler, guest permission check/request policy, download cancellation, or
retained proof that a preview cannot receive the app preload and its
`electronTRPC`, `desktopApi`, or `webUtils` bridges. Current diagnostics also
move page-controlled URLs, console text, DOM text, and selected-element data
toward renderer state and optional chat insertion without one canonical
minimization/redaction owner.

## What Changes

### Reviewed renderer-content boundary

- Replace the five-file source allowlist with an exact insertion-point
  inventory. Every value-bearing `dangerouslySetInnerHTML`, `.innerHTML`,
  `.outerHTML`, `insertAdjacentHTML`, `srcDoc`, `document.write`, contextual
  fragment, or equivalent raw-markup sink must name one reviewed producer and
  have adversarial behavior coverage. A whole-file exemption is insufficient.
- Exercise the app's real static and streaming Streamdown render paths with
  malicious raw HTML, mixed HTML/SVG/MathML, event attributes, and executable
  URLs while also proving that the intended safe formatting subset survives.
  The retained tests become the dependency-upgrade gate instead of trusting a
  transitive default without local evidence.
- Make the shared Shiki adapter fail closed: markup extraction or output-shape
  failure must produce escaped text or no rendered result, never raw code.
  Cover repository, chat, MCP, and tool-origin hostile code at the shared
  producer and its raw insertion boundary.
- Remove the mentions editor's raw-HTML undo/redo state in favor of canonical
  text/mention runs plus logical selection state rebuilt with text nodes and
  reviewed element construction. Make the editor itself prevent browser rich
  paste: mixed clipboard input consumes only its plain-text member, while an
  HTML-only paste is rejected. Cover lossless spacing, atomic mention
  selection, undo, redo, and clipboard behavior without assuming the current
  path is exploitable.
- Preserve the existing Mermaid strict-mode plus sanitizer owner, React-text
  tool subtitles, and production/development CSP guarantees. This change adds
  missing behavior proof; it does not replace those specialized owners with a
  second sanitizer path.

### Main-owned local-browser guest boundary

- Add one Electron main-process owner for local-browser guest admission,
  effective web preferences, partition identity/lifecycle, navigation and
  redirects, popup denial, permissions, device/display capture, downloads, and
  guest cleanup. `main.ts` only installs that owner; renderer checks remain UX
  feedback and defense in depth.
- Bind each permitted guest to an opaque, main-issued, process-local admission
  derived from server-resolved chat/worktree state and the true IPC sender.
  The high-entropy, never-reused non-persistent partition is the single
  attachment capability and is bound to the embedder, preview generation, and
  exact approved initial URL; renderer-provided `worktreePath`, webContents ID,
  sanitized chat ID, or `persist:` partition is not authorization.
- Install the embedder's `will-attach-webview` guard before its app document can
  create a webview. At attachment, reject an unknown guest and force an exact
  secure preference set: no preload/additional arguments, no nested webviews,
  sandbox and context isolation on, web security on, insecure content off, and
  Node integration off in the main frame, subframes, and workers. Prove from
  guest JavaScript that app bridges, Node globals, and privileged IPC are
  unavailable.
- Before returning a partition to the renderer, install one Session-owned
  `webRequest.onBeforeRequest` gate for every `mainFrame` request. It enforces
  the exact admitted origin across initial, link/location, `loadURL`, back/
  forward, and redirect requests; `will-*` handlers and postcondition
  destruction remain defense in depth.
- Never load direct `file://` content in a guest. Translate an admitted file
  target to a fixed-origin, Session-local `locus-preview://` URL and serve every
  path through a main-owned registered-root broker that traverses without
  following symlinks and streams the same verified file descriptor it opened.
  If the platform/filesystem cannot prove that race-resistant read, file
  preview fails closed rather than falling back to check-then-load.
- Deny guest `window.open` / `_blank` without creating an Electron window or
  launching the system browser.
- Install both permission-check and permission-request handlers for guest
  sessions; deny device grants and HID/serial/USB/Bluetooth selectors; deny
  display capture without a system-picker bypass; deny unknown permissions;
  and cancel guest downloads. Keep the trusted `persist:main` app session
  separate so the existing voice-recording permission path is not accidentally
  denied.
- Keep page JavaScript and the current diagnostic feature, but admit only fixed,
  repository-owned capture/click probes with no untrusted interpolation. Raw
  page results stay in main until a canonical policy has removed URL
  credentials/query/fragment, minimized fields, redacted recognized and exact
  secret values, and applied type/count/length bounds. The user reviews that
  final text before an explicit chat insertion.

### Exact-SHA desktop evidence

- Add a reproducible malicious-content and guest-security Electron fixture for
  both development and packaged builds. Record OS, Electron/Bun versions,
  frozen source SHA, commands, redacted main/console evidence, and screenshot or
  recording hashes in this change's `verification.md`.
- Reuse the same GUI session to run the two still-unchecked TICKET-114 CSP tracks
  when possible, but keep their conclusions separate. A current-SHA pass may be
  appended to TICKET-114 under its rules; it must not retroactively certify the
  old rebaseline tasks 4.4/4.5. Guest smoke cannot substitute for CSP smoke, or
  vice versa.

## Risk Classification

R3. This proposal changes the executable-content boundary inside the privileged
renderer and the Electron guest/preload/permission boundary adjacent to a broad
desktop bridge.

## Canonical Owners

- Renderer raw-markup policy and typed reviewed-output contract: proposed
  `src/renderer/lib/security/renderer-html-policy.ts`.
- Mermaid-specific SVG adapter remains
  `src/renderer/lib/security/mermaid-svg-sanitizer.ts` under that policy.
- Shiki production remains centralized in
  `src/renderer/lib/themes/shiki-theme-loader.ts`; callers must not add local
  extraction, escaping, or sanitizer variants.
- Exact renderer sink source guard remains
  `tests/renderer-html-sinks.test.ts`, executed through the normal test suite.
- Electron local-browser guest policy: proposed
  `src/main/windows/local-browser-guest-policy.ts`, installed by
  `src/main/windows/main.ts`.
- Pure URL/report helpers remain in `src/shared/local-browser-workbench.ts`;
  main-process file authorization composes the existing registered-root owner
  and extends `src/main/lib/filesystem/stable-directory.ts` with final regular-
  file open/same-descriptor streaming rather than creating a second descriptor
  backend or copying its rules.

Implementation must add these owners to `docs/OWNERSHIP_MAP.md` and remove or
replace the superseded renderer-side partition and raw-HTML restore paths in the
same change. It must not leave old and new business paths live together.

## Impact

- Affected specs: `runtime-security-baseline` and `local-browser-workbench`.
  The latter is narrowed so a guest remains on its exact admitted HTTP(S)
  origin; opening another local origin/port is a new explicit preview
  admission, not an in-page transition.
- Candidate product files: `package.json` / `bun.lock`, renderer
  security/theme/markdown/mentions modules, Local Browser UI and shared URL/
  diagnostic helpers, `src/preload/index.ts` plus `src/preload/index.d.ts`,
  Electron window/guest-policy and brokered-file wiring, filesystem safe-read
  extensions in the existing stable-directory owner, ownership documentation,
  focused tests, and a GUI evidence fixture/runbook.
- Public/versioned contract: none. Any public API or versioned schema change is
  Red and requires a Consumer Impact decision before implementation. A bounded
  internal preview-admission bridge, if needed, must not become a generic
  renderer capability API.
- Durable data or migration: none. The partition identifier contains no
  provider or user credential, but it is a security-sensitive, short-lived
  bearer capability: it is never persisted, placed in a URL/page argument, or
  logged. Any proposal to persist it is Red and returns to the Owner.
- User-visible compatibility: safe markdown formatting, code highlighting,
  Mermaid rendering, mentions editing, local preview, diagnostics, and trusted
  app voice recording remain functional. Direct guest `file://` loading is
  replaced by the broker; a platform/filesystem without the approved
  race-resistant read primitive retains HTTP(S) preview but disables file
  preview with a bounded explanation.

## Explicit Non-Goals

- No product implementation while this package is Draft, and no remote push,
  PR mutation, merge, release, or repository-rule change.
- No tRPC capability taxonomy, procedure wrapper, consent memory, audit log,
  kill-switch, `terminal.write` policy, or dangerous-router allowlist evolution;
  those belong to follow-up B `add-trpc-capability-consent-audit`.
- No modification of `scripts/check-architecture-guards.mjs` or Foundation 1c
  baselines. The renderer source guard stays test-owned unless separately
  approved by the architecture-guard owner.
- No claim that a compromised privileged renderer has no main-process
  authority. This change prevents reviewed content and guest pages from gaining
  that renderer/bridge position; follow-up B governs what a compromised
  renderer may ask main to do.
- No removal of the privileged main window's `sandbox: false` setting required
  by electron-trpc, and no removal of `webviewTag` in this bounded change. The
  guest is separately forced into its reviewed sandboxed preferences.
- No disabling of JavaScript in the local preview and no guest network sandbox.
  Top-level navigation is exact-origin confined, but page-controlled fetch,
  form, WebSocket, image/ping, frame, and other subresource traffic may still
  reach remote hosts or other loopback services. That residual network/CSRF
  risk requires explicit Owner acceptance; a network-egress firewall is a
  separate scope decision.
- No nonexistent chat HTML-export preview work. Current exports are text-based;
  future HTML preview would require its own reviewed sink before it ships.

## Dependencies And Overlap

- `update-trpc-capability-boundary` is archived and its current R6 is the exact
  MODIFIED baseline for this Draft.
- Foundation 1c is archived. This change consumes its architecture rules but
  does not modify its main-process guard script or baselines.
- Follow-up B is intentionally disjoint as described above. The narrow
  preview-admission IPC and preload projection are A-owned transport for this
  guest boundary, not a generic tRPC procedure or a second capability taxonomy.
  B does not wrap or own them without a separately approved scope change.
- TICKET-114 remains the ledger for the two historical CSP reruns. New
  malicious-content and guest-security evidence is owned by this change even if
  collected during the same GUI session.

## Approval Gate

Before any source edit, this Draft requires:

1. strict OpenSpec validation and a fresh feasibility review of the proposed
   renderer-output and main guest-policy owners;
2. independent fresh-context R3 review of attach timing, preload isolation,
   permissions, registered file roots, redirects, popup/download behavior,
   partition lifecycle, and testability on supported Electron hosts;
3. resolution of every Red/open decision recorded in `design.md`, including
   explicit disposition of file-preview platform support and residual guest
   network egress; and
4. explicit Owner `APPROVED` for the exact rebaselined scope.
