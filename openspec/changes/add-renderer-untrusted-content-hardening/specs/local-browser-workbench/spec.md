## MODIFIED Requirements

### Requirement: Local Preview Boundary

The system SHALL load only main-admitted local top-level targets in the Local
Browser Workbench. Each HTTP(S) preview admission SHALL fix the exact normalized
origin, including port; a user who chooses another local origin starts a new
preview admission rather than letting the current page cross origins. An
admitted file target SHALL load only through the registered-root preview broker,
never as direct guest `file://` content. This boundary governs top-level
navigation; it does not claim to block page-controlled fetch, form, WebSocket,
image/ping, frame, or other subresource egress to remote or other loopback
services.

File-origin granularity follows the pending D7 draft: a unique origin per
admitted document and a main-validated relative-asset scope defaulting to the
document-directory subtree. This does not claim confidentiality for in-scope
files; their read/egress consequence remains visible, including when the
directory is the worktree root. These details await exact-package confirmation.

#### Scenario: User opens a localhost page

- **WHEN** the user enters `localhost`, `127.0.0.1`, `[::1]`, or an allowed
  `file://` URL
- **THEN** the workbench normalizes the URL and main issues a new bounded
  preview admission
- **AND** it loads HTTP(S) at the exact admitted origin or file content through
  the main-owned registered-root broker

#### Scenario: User enters a remote URL

- **WHEN** the user enters a non-local HTTP or HTTPS URL
- **THEN** the workbench blocks navigation
- **AND** displays a clear local-only reason

#### Scenario: Preview attempts remote navigation

- **WHEN** the loaded page attempts top-level navigation to a remote target or
  another local origin/port without a new user-entered admission
- **THEN** the main-owned request gate prevents the navigation before commit
- **AND** the main guest owner's `will-navigate`/`will-frame-navigate` handling
  is the sole source of a minimized/redacted blocked-origin diagnostic
- **AND** the renderer SHALL NOT subscribe to raw `<webview>` `will-navigate`
  or any other event carrying page-controlled URL, title, or text; it SHALL
  retain at most URL-free lifecycle signals and the safe main projection

#### Scenario: User deliberately opens another local origin

- **WHEN** the user enters a valid local URL whose origin differs from the
  active preview
- **THEN** main creates a new preview generation, one-shot admission, and unique
  non-persistent partition
- **AND** the workbench destroys the old guest rather than letting its page
  carry storage or navigation authority into the new origin
- **AND** every `<webview>` element mount SHALL request a fresh generation and
  one-shot admission, including remounts; a consumed admission SHALL NOT be
  reused by renderer recovery

#### Scenario: The registered file root needs canonicalization

- **WHEN** an allowed file preview uses a DB-registered worktree path containing
  a symlinked prefix or a path whose directory identity changes during admission
- **THEN** main SHALL realpath-canonicalize that registered root before
  descriptor anchoring and verify matching directory `dev`/`ino` identities
  from the registered path's `lstat`, the canonical path, and the opened anchor
- **AND** it SHALL re-verify the binding before use and fail closed on a
  terminal symlink or identity mismatch; `path.resolve()` alone SHALL NOT be
  treated as canonicalization or authorization

#### Scenario: An admitted file attempts cross-file or cross-admission reads

**Owner decision pending (2026-09-08): origin granularity option (a) drafted as recommended default; alternatives (b) narrowed subtree on fixed origin / (c) whole-root + fourth disclosure**

- **WHEN** previewed file content attempts fetch, XHR, iframe `contentDocument`,
  or `script src` access to another file or admission
- **THEN** main SHALL bind `locus-preview://<per-admission-random>.preview.local/`
  to that document plus its declared relative-asset scope (default: its
  directory subtree under the registered worktree), preserving relative URLs
  while isolating admissions by origin
- **AND** the scope SHALL be frozen by main; out-of-scope paths and other
  hosts SHALL be denied for every resource type. A different top-level document
  SHALL require fresh admission/origin; in-scope asset reads remain permitted
  and SHALL NOT be represented as confidential or protected from egress
- **AND** `protocol.handle` SHALL be bound only to file-admission Sessions,
  with live admission/host/scope/descriptor checks on every request and all
  Session deny handlers installed before partition return. HTTP(S)-admission
  Sessions SHALL leave the scheme unhandled and reject it in the request gate
- **AND** file admissions SHALL use that exact scheme/host/port tuple as their
  admitted origin, with document-path checks for top-level requests; other
  observable schemes SHALL fail closed except accepted HTTP(S) subresource
  egress, with D7's non-network postconditions separately enforced
- **AND** the scheme SHALL use exactly D7's standard/secure/supportFetchAPI/
  corsEnabled true and bypassCSP/allowServiceWorkers/stream/codeCache false,
  without permissive CORS responses or origin relaxation
- **AND** 4.8 SHALL cover policy verdicts with doubles, and real Electron
  5.2/5.3 SHALL record actual read/execution results for allowed in-scope and
  relative-URL controls, denied out-of-scope worktree files and other hosts,
  scheme rejection from HTTP(S) guests, and whether custom-scheme requests
  reach `webRequest`; protocol-handler enforcement SHALL NOT depend on that
  observation being positive

#### Scenario: Safe file broker is unavailable

- **WHEN** the current platform or filesystem cannot prove the approved
  descriptor-anchored, no-follow safe-read primitive for an otherwise allowed
  file preview, including `win32` with the existing descriptor owner
- **THEN** the workbench SHALL reject or disable that file preview and display
  a clear bounded reason
- **AND** it SHALL NOT fall back to direct guest `file://` loading or a
  containment-check-then-path-open flow
- **AND** Windows packaged file-preview evidence SHALL record the disabled/
  unsupported-platform result until a separately approved Yellow
  handle-relative backend extension is available

### Requirement: Browser Diagnostics Capture

The system SHALL capture bounded local page diagnostics from the preview.
Main-owned event/probe processing SHALL bind page-controlled results to the
current admitted guest/navigation, minimize, secret-redact, and bound them before
publishing a safe projection to the app. URLs exposed in renderer diagnostics
SHALL omit credentials, query, and fragment. The renderer SHALL receive only
the resulting safe projection through the app diagnostics channel and SHALL NOT
directly subscribe to raw guest console, load-failure, title, or navigation event
payloads, including `will-navigate` and any other event carrying page-controlled
URL, title, or text. The guarantee is absence of unprocessed values from app
listeners/state, chat, security logs, and verification receipt media; Electron's
dispatch to the `<webview>` element itself is not claimed to be suppressed.

#### Scenario: Console errors occur

- **WHEN** the preview emits console errors or warnings
- **THEN** main SHALL capture them from the admitted guest `webContents` after
  attachment, minimize and redact the level/text/source/line projection, and
  only then deliver recent messages to renderer state
- **AND** projection SHALL explicitly map Electron's `info`/`warning`/`error`/
  `debug` levels to the shared console-level contract
- **AND** the workbench SHALL bound the retained list and SHALL NOT listen to
  the raw `<webview>` `console-message` payload in the renderer

#### Scenario: Network or load failure occurs

- **WHEN** the preview reports a provisional or committed load failure
- **THEN** main SHALL capture the guest failure, remove URL credentials, query,
  and fragment, minimize and redact its reason/code fields, and only then
  deliver the failure projection to renderer diagnostics
- **AND** the renderer SHALL NOT subscribe to or retain the raw `<webview>`
  failure payload in app state, chat, logs, or verification receipt media

#### Scenario: Guest title or navigation changes

- **WHEN** the preview updates its page title, attempts navigation, or completes
  top-level or in-page navigation
- **THEN** main SHALL capture the admitted guest event, bind it to the current
  navigation generation, minimize/redact/bound the title and URL, and remove
  URL credentials, query, and fragment before renderer delivery
- **AND** the renderer SHALL NOT directly listen for raw `<webview>`
  `page-title-updated`, `will-navigate`, `did-navigate`, or
  `did-navigate-in-page` payloads, or any other page-controlled URL/title/text
  event; any renderer lifecycle signal SHALL be URL-free

#### Scenario: User captures page context

- **WHEN** the user clicks capture diagnostics
- **THEN** main SHALL run only the named fixed capture operations against the
  current admitted guest, with `userGesture:false`, and SHALL reject stale
  guest/navigation results; the selected-element probe SHALL be in the same
  repository-owned shared closed set
- **AND** it SHALL capture a screenshot if available only after applying the
  approved identity, type, dimension, and byte bounds: main-owned
  `webContents.capturePage()` SHALL validate the current guest/navigation
  generation before capture and on completion, reject stale or oversized
  results, and apply bounds before projection reaches renderer state; no
  renderer `webview.capturePage()` fallback SHALL remain
- **AND** it SHALL minimize, secret-redact, and bound the DOM summary before
  returning it to local renderer state for review
