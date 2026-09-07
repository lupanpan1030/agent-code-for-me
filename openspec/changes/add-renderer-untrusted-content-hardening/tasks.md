# Tasks: add-renderer-untrusted-content-hardening

> **DIRECTION+IMPLEMENTATION APPROVED (eight defaults), 2026-09-05.** The
> Owner accepted all eight recommended defaults, conditional on 0.2/0.3/0.4/0.5.
> Among approval prerequisites, 0.1, the historical feasibility receipt in 0.2,
> and the 2026-09-07 baseline rebase/anchor audit in 0.4 are complete. Source
> edits remain gated; Owner **APPROVED the Q9 compromise on 2026-09-07**.
> Task 2.11 ticket registration is also complete; implementation remains open.

Routing from the archived parent is explicit: sections 1–2 carry original 2.2,
sections 3–4 carry original 2.3 and the removed R6 webview scenario, and section
5 carries original 2.4 plus the TICKET-114 linkage.

## 0. Approval prerequisites

- [x] 0.1 Resolve all eight approval questions in `design.md`, including the
      exact Streamdown ownership form, editor paste/state model, admission
      transport, exact-origin/network residual, descriptor-backed file support,
      guest deny policy, partition/diagnostic lifetime, and GUI matrix. Owner
      **APPROVED all eight recommended defaults, late 2026-09-05**, as supplied
      by the dispatch; approval is conditional on 0.2/0.3/0.4/0.5.
- [x] 0.2 Obtain a fresh feasibility review of Streamdown/Shiki integration,
      structured mentions undo/redo, Electron attach timing, session handler
      ownership, descriptor-backed protocol reads, diagnostic redaction, and
      supported packaged-host execution. Receipt: **REVIEW_APPROVED**, zero
      P0/P1, reviewed SHA `2292d36a2947325ace8bb982a6e11a581bf4b12f`, workflow
      `wf_461ff527-9bb`; full pasteable receipt is in `verification.md`. This
      receipt does not certify the revised text or a future implementation.
- [ ] 0.3 Obtain independent fresh-context R3 security review of the exact
      threat model and fail-closed design, with special focus on preload/bridge
      absence, programmatic/redirect ordering, file TOCTOU, permission/device
      denial, popup/download effects, partition reuse, diagnostic secret flow,
      and explicitly residual guest network egress. Historical initial review:
      **CHANGES_REQUESTED** (1 P1, 9 P2, 10 P3), SHA `2292d36a`, workflow
      `wf_461ff527-9bb`. Targeted re-review: **REVIEW_APPROVED** at
      `04193a4b7455d4619fce613307e3cafee4267c95`, workflow `wf_d03b4b51-d03`
      (20 fixes: 16 applied / 4 deviated-justified; 2 P2 + 6 P3 follow-ups).
      Final targeted re-review: **REVIEW_APPROVED** at `96ca3afe` on
      2026-09-07 (1 P2 + 4 P3, now addressed). Remains unchecked until the
      rebased exact package's fresh-context R3 approval; historical verdicts
      do not transfer to a successor SHA.
      Exact-package ledger: **CHANGES_REQUESTED at 95831ab6 → fixes at `<SHA>`
      → targeted R3 pending** (2026-09-08; workflow `wf_165bd6a0-1b5`,
      2 P1 / 9 P2 / 7 P3). Here `<SHA>` denotes the single successor commit
      containing this revision, titled `docs(openspec): address exact-package
      R3 review for renderer hardening`; resolve its full SHA from Git (the
      final handoff records it). It cannot embed its own hash. Targeted fresh
      R3 follows 0.5 re-confirmation and covers the two P1s and folded P2s.
- [x] 0.4 Rebase all source/test anchors and active-change conflicts onto
      `main` at `9cff32daa89f4431be37cf307897b97ec48cda77`, completed 2026-09-07.
      Audited proposal/design/tasks citations: no source line-number updates
      needed. Only STATUS Updated conflicts occurred; keep 2026-09-07, main's
      archive and this branch's active row. Recheck if the implementation-start
      baseline advances again.
- [ ] 0.5 Run strict OpenSpec validation and obtain explicit Owner `APPROVED`
      for the exact rebaselined package before the first source edit. The
      historical strict/rebase preconditions passed and Owner confirmation
      occurred on 2026-09-07: **confirmed content 0c805564, recording commit
      95831ab6; re-confirmation required after this revision**. This checkbox
      is reopened for the 2026-09-08 revised package. Strict target and `--all`
      validation must pass again; D7 origin option (a) is **Owner decision
      pending**, and the three earlier disclosures remain presented to Owner
      2026-09-07 (board §六), acknowledgement pending. Record the new confirmed
      exact SHA (or distinguish confirmed content from its recording commit),
      then obtain task 0.3 targeted fresh R3 on that same package. Historical
      confirmation does not certify revised text; source edits also remain
      queued after `add-linked-worktree-admission`.

## 1. Characterization and renderer source guard (original 2.2)

- [ ] 1.1 Convert `tests/renderer-html-sinks.test.ts` from a five-file allowlist
      to an exact insertion-point inventory keyed by construct, enclosing owner,
      content producer, and required behavior test.
- [ ] 1.2 Scan `dangerouslySetInnerHTML`, value-bearing and empty
      `.innerHTML` / `.outerHTML`, `insertAdjacentHTML`, `document.write` /
      `writeln`, contextual fragments, `srcDoc` / `srcdoc`, and equivalent
      unsafe HTML APIs. Walk all of `src/renderer`, including `public/` and
      `.ts/.tsx/.html/.js/.jsx/.mjs/.cjs`; scan dynamic script-element creation,
      `script.src` assignment, remote `import()`, and `importScripts`, with
      negative fixtures for each class. Recommended default, pending the
      post-approval Owner acknowledgement: remove the remote react-scan loader
      in `agents-debug-tab.tsx`; no new remote-script bypass.
      The loader is already CSP-blocked in both CSP-covered modes (removal
      costs no working functionality there); it loads only in development
      without `ELECTRON_RENDERER_URL`.
      Keep the scan rooted at `src/renderer`: shared denylist string literals
      in `plugin-controlled-ui.ts` are not executable sink sites. Add an exact
      configuration check for new Shiki-API shims/Vite aliases into DOM-producing
      dependencies, without treating configuration strings as HTML sinks.
      Add a named raw-markup/raw-CSS dependency-prop rule: `unsafeCSS` at both
      diff option sites must be exactly `PIERRE_DIFFS_THEME_CSS`, not an
      expression/interpolated template; guard the constant declaration against
      untrusted interpolation. Use that same repository constant for D2's
      diff-profile style comparison. Assert `prerenderedHTML` absent unless
      explicitly bound to a reviewed producer and its behavior gate. Include
      negative fixtures for these named rules, not a broad string scan.
- [ ] 1.3 Record the rebaselined sink and producer inventory in
      `verification.md`. Do not label a whole file safe and do not infer runtime
      safety from source inventory alone. Name the Vite-aliased Locus-owned
      `pierre-diffs-shiki-shim.ts` (`createPlainHast` live; `codeToHtml` exported
      but uncalled by the render path; private `escapeHtml`), @pierre/diffs'
      internal writers as reviewed producers under the approved Q9 compromise;
      classify Monaco files and xterm PTY output as explicit residuals tracked
      in Yellow TICKET-125. Inventory the local
      `chat-markdown-renderer.tsx` `escapeHtml` fallback and classify the
      zero-caller `diff-view-highlighter.ts#getAST` adapter as dormant.
      Inventory `openExternalUrl` plus its preload/tRPC entry points as the
      reviewed executable-URL click sink; do not introduce follow-up B policy.
      Inventory both `unsafeCSS: PIERRE_DIFFS_THEME_CSS` dependency-prop sinks
      and the absent `prerenderedHTML` path under 1.2's named rule, sharing D2's
      constant source of truth. Name plugin-controlled UI manifests as a
      classified-safe, schema-bounded text producer owned by the validator in
      `src/shared/plugin-controlled-ui.ts#parseControlledUiManifest`;
      React text rendering remains its
      boundary and richer surface types must revisit the classification.
- [ ] 1.4 Keep this renderer guard test-owned and executed by `bun run test` /
      `check:full`; do not modify `scripts/check-architecture-guards.mjs` or its
      Foundation 1c baselines.

## 2. Reviewed content producers and behavior tests (original 2.2)

- [ ] 2.1 Add the single reviewed-renderer-HTML policy owner under
      `src/renderer/lib/security/` and a typed reviewed-output contract for
      Locus-owned raw insertions. Keep Mermaid as its specialized SVG adapter;
      do not create caller-local sanitizer paths.
- [ ] 2.2 Put both static and streaming app markdown paths behind one reviewed
      Streamdown configuration; implement the Owner-approved exact dependency /
      rehype ownership decision: replacement (not merge) rehype chain
      `[rehypeRaw, [rehypeSanitize, defaultSchema-derived reviewed schema],
      [harden, reviewed non-wildcard options]]`. Add `rehype-sanitize` and every
      other app-imported rehype package as exact direct dependencies per D2/Q1,
      then import `defaultSchema` from it; the baseline has only transitive
      rehype dependencies via Streamdown. Characterize remark
      parity too; pin the `code`/`pre` overrides and assert Streamdown's dormant
      `aria-label="Mermaid chart"` sink never mounts. Give both mounts the same
      app-owned error boundary that renders source as escaped text.
- [ ] 2.3 Add black-box static and streaming regressions for script/iframe,
      active SVG/MathML, event attributes, executable and encoded URLs,
      malformed/incomplete chunks, and a safe-formatting preservation matrix.
      Include `locus://`, `vscode://`, `ms-msdt:`, relative-URL links, and a
      forced-throw plugin through both mounts. Apply D2's shared owner-located
      rendered-DOM executable-markup oracle (not string-presence checks) to
      static/streaming markdown, Shiki consumers, Mermaid, and mentions.
- [ ] 2.4 Make `highlightCode()` fail closed when Shiki throws or its expected
      output shape fails: require exactly one top-level `<pre><code>` wrapper
      with the entire output consumed. Retain forced-mismatch and forced
      dual-`<code>` fixtures so a non-greedy regex cannot silently truncate.
      Never return unescaped source as HTML and
      leave no second highlighting/extraction path in callers. Remove or route
      `chat-markdown-renderer.tsx`'s local `escapeHtml` pre-highlight/plaintext
      branch through the renderer HTML-policy owner. Under the Question 9
      decision, remove or route the shim's `escapeHtml`/exported `codeToHtml`
      branch through that owner and classify its live text-node HAST path;
      delete or explicitly retain as dormant the zero-caller `getAST` adapter.
- [ ] 2.5 Add hostile-code and forced-output-shape tests at the shared Shiki
      producer and raw insertion boundary, covering chat/repository, MCP, tool,
      and message-JSON consumers.
- [ ] 2.6 Replace mentions undo/redo `{ html, cursorOffset }` snapshots with
      lossless canonical text/atomic-mention runs plus anchor/focus positions.
      Define the round-trip/spacing/selection model, rebuild through the one
      safe DOM builder, and remove both non-empty `.innerHTML` restores and the
      superseded state path in the same change.
- [ ] 2.7 Make the mentions component own browser rich-content insertion from
      every source. Its single `beforeinput` allowlist admits `insertText`,
      `insertCompositionText`, and all `delete*` inputTypes, including
      `deleteByCut`, `deleteByDrag`, `deleteWord*`, and `deleteSoftLine*`.
      Prevent default for `insertParagraph`/`insertLineBreak` and insert the
      newline through the safe text-node/`br` builder (no `div` wrappers),
      preserving non-shift Enter submit. Prevent default for
      `historyUndo`/`historyRedo` and route to canonical undo/redo; ordinary
      text/IME input and admitted deletions are not blanket-prevented. Prevent
      every other inputType, including `insertFromDrop`, `insertFromPaste`,
      `insertLink`, `insertReplacementText`, and `format*`. Component-owned
      paste/drop/dragover handlers prevent default, consume only `text/plain`
      through the safe builder (or reject), and reject HTML-only input. Typed
      image/attachment delegation stays an explicit callback with no browser
      insertion fallback; optional parent handlers are not the boundary.
- [ ] 2.8 Add mentions regressions for exact whitespace, atomic mention tokens,
      forward/backward selection, undo/redo, mixed/HTML-only clipboard and drop
      data, `insertLink`, `formatBold`, all admitted deletion families,
      safe-builder paragraph/line-break insertion, and typed caller delegation.
      Synthetic DragEvent/InputEvent happy-dom evidence asserts `defaultPrevented`,
      unchanged DOM for HTML-only input, safe-builder text insertion, and only
      text nodes, `<br>`, and reviewed mention spans after insertion/restore.
      happy-dom has no native contentEditable paste or `execCommand`: stub the
      latter or use the safe builder; real paste/drop rejection and browser
      undo/redo are GUI 5.1 evidence, never inferred from synthetic dispatch.
- [ ] 2.9 Retain tool-subtitle text-rendering coverage and add a pinned-Mermaid
      happy-dom/jsdom end-to-end fixture through MermaidBlock's actual render
      path, beyond the existing literal-SVG sanitizer test. Render hostile
      flowchart/sequence sources (`htmlLabels`, click directives, `javascript:`,
      `themeCSS` with root `position:fixed`, `background:url(https://...)`,
      `@import`, hostile `classDef x fill:url(https://evil/x)` / `style`
      statements with `position:fixed`, and stray returned `<style>`).
      Extend the pinned configuration's
      existing `secure` list with `themeCSS`, `themeVariables`, `theme`,
      `fontFamily`, `altFontFamily`, and `htmlLabels` before rendering; fail
      closed if source directives can change styling before the transient
      mount or suppression cannot be proved. Retain only the single
      Mermaid-generated `<style>` whose content passes D3's reviewed CSS value
      profile: selectors scoped to the diagram id namespace; no `url(`,
      `@import`, `expression(`, `behavior:`, root-level `position:fixed`/
      `position:absolute`, or external references. Require a positive control
      proving safe diagram styling survives; otherwise fail closed. Strip
      unreviewed CSS-bearing attributes and reject any other `style` element;
      assert the D2 oracle on returned/sanitized SVG, no executable or
      unreviewed CSS residue under `document.body`, and the same reviewed string at inline/fullscreen
      sinks. Strict mode protects the transient pre-sanitizer body mount;
      DOMPurify is load-bearing for returned SVG, its DOMParser pass is defense
      in depth. Real transient execution/CSS/layout evidence remains GUI 5.1.
- [ ] 2.10 Implement the **Owner-approved Q9 compromise (2026-09-07)**:
      black-box hostile `<FileDiff>`/`<PatchDiff>` rendering through the real
      Locus shim/Vite alias enters the reviewed-producer contract and D10 matrix.
      Exact-pin `@pierre/diffs@1.0.10` (`bun.lock:476`), un-aliased `hast-util-to-html@9.0.5`
      (`:1360`, the load-bearing production-bundle escaper), and the actual
      Shiki resolution: nested `shiki@3.21.0` under @pierre/diffs (`:2300`),
      hoisted `@shikijs/core@3.21.0` / `@shikijs/engine-javascript@3.21.0`
      (`:618,620`), and `@shikijs/transformers@3.22.0` (`:628`) with nested
      core/types `3.22.0` (`:2328,2330`). The Shiki subtree is installed but
      aliased away from the production diff path. Gate dependency, shim, and
      exact four-specifier alias changes on hostile filename/hunk/line/patch
      and HAST-breakout fixtures. In `bun test --isolate`, explicitly bind
      `shiki`, `shiki/core`, `@shikijs/engine-javascript`, and
      `@shikijs/transformers` to the shim before importing `<FileDiff>`/
      `<PatchDiff>`; assert its `createPlainHast` text-node output shape before
      hostile cases. An unbound fixture runs nested real Shiki 3, not the shim;
      a built-renderer fixture with the same binding assertion is an alternative.
      Apply the D2 diff profile to all output including Shadow DOM: exactly
      one `style[data-unsafe-css]` byte-equal to
      `wrapUnsafeCSS(PIERRE_DIFFS_THEME_CSS)` (app-owned input, never producer
      output); `use[href]` matching `^#diffs-icon-[a-z0-9-]+$` only in separator/
      expand-button subtrees; adopted constructed stylesheets need no element
      allowance; all other DOM keeps the global rules. Use Locus's actual
      options: `disableFileHeader: true`, `unsafeCSS: PIERRE_DIFFS_THEME_CSS`,
      default `hunkSeparators` (`line-info`), `expandUnchanged: false`.
      Retain negative controls for missing/duplicate style elements, marker/CSS
      drift, and fragment hrefs outside the permitted pattern/subtrees.
      The committed `bun.lock` plus `bun install --frozen-lockfile` is the
      pin of record. Retain a lockfile-assertion test for every anchor above
      and app Shiki `1.29.2`; fail on version/resolution drift. Top-level
      `overrides` may pin only a globally correct version (e.g.
      `hast-util-to-html`); forbid a flat `@shikijs/core` override that collapses
      the mixed resolution. The stale pnpm block/packageManager metadata is
      historical and is not the Bun pin mechanism (D10); no package-manager
      migration is part of this task.
      Limit the reviewed producer to the main-thread, context-free path.
      Source-guard imports/mounts/use of `@pierre/diffs/worker`,
      `worker-portable.js`, `WorkerPoolContextProvider`,
      `getOrCreateWorkerPoolSingleton`, or `workerFactory` must fail; worker
      activation requires its own scope decision and producer review, even
      without dependency/shim/alias changes.
      Development pre-bundling's use of plugin `resolveId` is unverified and
      must be proved in implementation GUI 5.1; verify packaged binding in 5.3.
      The approved diff Scenario retains only WHEN/THEN/AND bullets; its
      pending-status paragraph has been removed. Monaco/xterm are explicit
      residuals in Threat Model/Non-Goals and Yellow TICKET-125.
- [x] 2.11 Register the Monaco file-viewer/xterm terminal residuals in Yellow
      `docs/tickets/TICKET-125-monaco-xterm-dom-producers.md` and its README
      index under the Owner-approved Q9 compromise. Completed 2026-09-07
      after confirming TICKET-124 exists on main; TICKET-123 is reserved for
      `add-linked-worktree-admission`. The ticket tracks compensating controls,
      black-box hostile fixtures and dependency/upgrade ownership and criteria.
      This is documentation registration only; the extension is not implemented.

## 3. Main-owned local-browser guest policy (original 2.3 / R6 webview)

- [ ] 3.1 Add `src/main/windows/local-browser-guest-policy.ts` as the sole
      Electron guest-policy owner; wire it from `main.ts`, project only its
      narrow operation through `src/preload/index.ts` / `index.d.ts`, and add
      exact owner entries to `docs/OWNERSHIP_MAP.md`, including reused
      `registered-roots.ts`, `stable-directory.ts`, window ownership, and
      `src/shared/local-browser-workbench.ts`. Register the diagnostics-policy
      composition adapter over the canonical main `redaction.ts` owner too.
      Expose pure, injectable decision functions for effective preferences,
      admission consume/replay, request-gate verdicts, permission/download
      verdicts and teardown state transitions. Use Electron `import type`
      plus injected factories/surfaces; no runtime Electron import-side effect
      may prevent loading the owner in `bun test --isolate tests`. Maintain
      verification.md's explicit ADDED Scenario → fixture mapping.
- [ ] 3.2 Add a narrow internal, non-tRPC preview-admission operation. Resolve
      chat/worktree state in main, derive the embedder from the IPC event,
      atomically call `windowManager.claimChat(chatId, senderWindow.id)`
      (idempotent for this window; bounded denial if another live window owns
      it; explicitly acquire if unowned, including after stale-owner cleanup),
      then resolve the DB-registered worktree and issue the partition. Cover
      all three ownership states in 4.8 without weakening DB-root checks.
      This cross-checks chat ownership; authorization derives from the live
      app-window sender plus DB-registered chat/worktree, not the chat map
      alone. Reject caller-provided filesystem/webContents authority. Return only the approved URL
      plus a high-entropy non-persistent partition treated as the sole bearer
      attachment capability.
- [ ] 3.3 Implement an embedder/chat/generation/partition/exact-src pending
      registry with one-shot consume, short TTL, replay/conflict rejection, and
      active/cumulative caps. Never persist, log, put in URL/arguments, or reuse
      the partition; do not create a second token.
- [ ] 3.4 Remove `<webview key={currentUrl}>` remounts. Keep one guest for
      allowed same-origin navigation; require a new generation/partition/
      admission for a user-entered different origin or recovery, destroying the
      old guest before replacement. Every `<webview>` element mount, including
      React remount/StrictMode, needs a fresh generation/admission; no renderer
      retry may reuse a consumed attachment capability.
- [ ] 3.5 Install one `app.on('web-contents-created')` hook before creating
      webContents; it installs every potential embedder's `will-attach-webview`
      listener. Use the per-window registry to deny unregistered embedders,
      including future window paths, before any document can attach a guest.
      At attachment, consume the exact admission,
      deny unknown guests, and force empty preload/additional arguments,
      `webviewTag`/all Node modes/insecure content off, context isolation/
      sandbox/web security on and no popup grant. Validate the element's
      partition against the pending admission and reject every mismatch;
      writing/forcing partition is best-effort reinforcement only.
      Explicitly force sandbox/contextIsolation rather than inheriting the
      privileged embedder's `sandbox:false` preferences.
- [ ] 3.6 Register valid guests through `did-attach-webview` and install all
      WebContents handlers through the one owner. If registration or any
      mandatory handler is late/missing, destroy the guest; do not copy policy
      into `main.ts` or the renderer. Account for post-navigation-start,
      pre-commit attach ordering; prove no guest request precedes installation
      of the pre-return Session gate.
      Destroy from main via `guestWebContents.close()` with
      `waitForBeforeUnload` unset, then re-check `isDestroyed()` and revoke
      registry state per D5. Invalidate authority immediately on teardown;
      reject revival/reattach or replacement until destruction is confirmed,
      and require fresh generation/admission. No renderer unmount fallback.
- [ ] 3.7 Prove guest JavaScript cannot observe `electronTRPC`, `desktopApi`,
      `webUtils`, `ipcRenderer`, `require`, or `process`, cannot send privileged
      IPC/tRPC, and cannot trigger a Locus-mediated privileged side effect.
      Verify the issued Session has no registered preload scripts, in addition
      to empty guest WebPreferences preload/additionalArguments.

## 4. Navigation, permission, popup, download, and diagnostic confinement

- [ ] 4.1 Reuse one shared local URL grammar for renderer UX and main
      enforcement. Before returning a partition, install that unique Session's
      sole `<all_urls>` `webRequest.onBeforeRequest` owner: exact-origin check
      every `mainFrame` request (initial, link/location, `loadURL`, back/forward,
      redirect) and cancel direct `file:` for every resource type. Keep
      `will-*` and committed-URL destruction as defense in depth, using
      `guestWebContents.close()` with `waitForBeforeUnload` unset, an
      `isDestroyed()` re-check and registry revocation. File admissions use
      D7's exact `locus-preview://<per-admission-random>.preview.local` origin
      plus document path; cancel other preview hosts/out-of-scope resources
      and every `locus-preview:` request on HTTP(S)-admitted Sessions. Other
      schemes fail closed except the explicit D7 non-network postconditions
      and accepted HTTP(S) subresource residual. Remove renderer `loadURL`.
- [ ] 4.2 After Owner confirms D7 origin granularity (option (a) is drafted,
      pending), register `locus-preview` before app readiness with exactly D7's
      flags: standard/secure/supportFetchAPI/corsEnabled true;
      bypassCSP/allowServiceWorkers/stream/codeCache false. Bind `protocol.handle`
      only on file-admission Sessions before partition return; HTTP(S) Sessions
      leave it unhandled and reject the scheme. Bind each random admission
      host to its document plus declared relative-asset scope, defaulting to
      its directory subtree; preserve relative URLs, deny other hosts and
      out-of-scope paths, and require fresh admission for another top-level
      document. Freeze the main-validated scope and expose its read/egress
      consequence, including when the default directory is the worktree root.
      The protocol handler enforces live admission/host/scope on every request
      independently of custom-scheme `webRequest` observability; no permissive
      CORS or origin relaxation. Translate an admitted user `file://` target to it,
      extend `src/main/lib/filesystem/stable-directory.ts` (do not add a second
      descriptor owner), traverse the registered chat root with descriptor/no-
      follow semantics, realpath-canonicalize the DB-registered root and compare
      canonical/registered-leaf lstat dev/ino with the opened anchor's fstat
      identity, fail closed on mismatch or a symlink leaf, verify a regular
      file, and stream that same descriptor
      for documents and relative assets. Reject forged roots, traversal/
      decoding ambiguity, special files, symlink/path-retarget races, and every
      path-only/direct-`file:` fallback; disable file preview when a platform/
      filesystem cannot prove the safe read. Do not claim immutable snapshots
      against concurrent writes to the same opened inode. The existing owner
      has no win32 backend: Windows packaged file preview ships disabled until
      a separately approved Yellow handle-relative backend extension lands.
- [ ] 4.3 Deny guest `window.open` / `_blank` through guest
      `setWindowOpenHandler`; assert no BrowserWindow and no
      `shell.openExternal` call occurs.
- [ ] 4.4 Install both permission-check and permission-request default-deny
      handlers on each guest partition, plus a denying device-permission
      handler. Every Session-scoped permission/device/display/selector handler
      is installed in the same pre-return configuration step as 4.1's request
      gate; guest WebContents handlers follow D5/3.6's attach timing. On
      HID/serial/USB/Bluetooth selection, call
      `event.preventDefault()` and the API-specific rejecting callback
      (Bluetooth/serial empty string; HID/USB no ID); return no display streams
      with the system-picker bypass disabled. Prove no automatic device choice
      or OS prompt appears and unknown permissions fail closed. Explicitly
      deny `openExternal` in both Session permission handlers. Probe `locus://`,
      `locus-dev://`, both `agent-code-for-me` legacy schemes, `mailto:`, and
      `vscode://` via top-level links, `location.href`, and `_blank`: no OS
      handler launch and no `mcp-import:preview` push. Trusted app-window
      `shell.openExternal` remains a separate reviewed path.
- [ ] 4.5 Cancel guest downloads, including redirect and download-attribute
      paths. Install Session `will-download` in the same pre-return step as
      the request gate; 4.8/5.2 include first-response download and early
      permission checks. Any future user-approved save flow remains out of scope.
- [ ] 4.6 Preserve the trusted app session's microphone/voice behavior and prove
      guest deny handlers are never installed as a global `persist:main`
      deny-all policy.
- [ ] 4.7 Replace arbitrary `executeJavaScript(string)` access in the workbench
      with the closed named set of app-owned diagnostic probes executed through
      main with `userGesture:false`, including the currently inline selection
      probe moved into the shared named set. Compose the diagnostics shape
      adapter with main `redaction.ts`; do not duplicate secret matching in
      shared/renderer code. Preserve Electron
      `info`/`warning`/`error`/`debug` in the existing report union; use bounded
      `log` fallback for unknown levels. Remove renderer
      `<webview>` listeners for raw `will-navigate`, `console-message`,
      `did-fail-load` / provisional failure, `page-title-updated`,
      `did-navigate`, in-page navigation, or any event payload carrying a
      page-controlled URL/title/text; after
      `did-attach-webview`, capture their equivalents from the admitted guest
      `webContents` in main. Bind probe and event results to the current guest/
      navigation identity. Before any diagnostic value enters renderer state,
      strip URL credentials/query/fragment, minimize fields, redact recognized
      and available exact secrets, then apply type/count/length bounds. Show the
      final text before explicit chat insertion and log no raw page value or
      partition capability; leave no renderer raw-event fallback. The main
      guest owner's `will-navigate`/`will-frame-navigate` listeners alone
      produce minimized/redacted blocked-origin diagnostics; the renderer may
      retain only URL-free lifecycle signals. Evidence asserts absence from
      app state, chat text, security logs, and media; Electron's element-level
      dispatch itself is not claimed to be suppressed.
      Move screenshots to main-owned `webContents.capturePage()`, binding
      request/completion to the current admitted guest/navigation generation.
      Apply approved identity/type/dimension/byte bounds before renderer
      projection; reject stale or oversized captures and remove renderer
      `webview.capturePage()` with no fallback.
- [ ] 4.8 Add focused unit/integration fixtures for unsafe attach preferences,
      bridge probes, initial/link/location/`loadURL`/back/forward/redirect
      requests, direct `file:` in main/subframe/XHR/script/image positions,
      descriptor/symlink races, popup, permissions/device/display, downloads,
      two-partition isolation, teardown/replacement races, stale diagnostics,
      secret fixtures, and handler-installation failure. Include a controlled
      test documenting (not misreporting as blocked) residual subresource egress.
      Cover win32 unsupported-platform disablement and canonical-root identity
      mismatch/symlinked-prefix cases. Distinguish non-network/external-scheme
      navigation from observable `webRequest` requests: apply D7's committed-
      URL rule to `about:`/`data:`/`blob:`/`javascript:` and test explicit
      `openExternal` denial. This task's acceptance is double-driven ordering/
      verdict/state-machine evidence, including all handlers before partition
      return, first-response download, early permission checks, acquire-if-
      unowned chat, main-alone close/isDestroyed/revocation, fresh admission
      after teardown, and bounded/stale screenshot rejection. Model file-
      admission origin/host/scope checks and HTTP(S)-admission scheme rejection,
      with cross-file fetch/XHR/iframe-contentDocument/script-src cases and
      allowed in-scope controls. Mocks SHALL NOT claim runtime observations:
      actual `file:` cancellation per mainFrame/subFrame/xhr/script/image and
      every redirect hop (including cross-port 3xx), custom-scheme gate
      observability, cross-file reads/execution, main-alone guest destruction,
      OS effects and no-state/token auth/gateway 400/401/404 outcomes are
      discharged only by 5.2 and repeated in 5.3.

## 5. GUI smoke and TICKET-114 linkage (original 2.4)

- [ ] 5.1 In development Electron on a GUI-capable host, run the malicious
      markdown (static and
      streaming), highlighted-code, Mermaid inline/fullscreen, tool subtitle,
      mentions paste/drop/beforeinput/undo/redo, and normal safe-formatting
      controls in the real privileged renderer. Prove actual browser rich-
      insertion rejection and transient Mermaid render behavior; apply the
      shared DOM oracle and record the remote-image beacon residual. Add the
      Question 9 D10 producer rows only as selected by the Owner.
- [ ] 5.2 Run the local-browser malicious fixture in development Electron:
      bridge/Node probes, exact-origin initial/link/location/`loadURL`/back/
      forward/redirect behavior, brokered-file success or honest platform
      disablement, direct-file/symlink/rename denial, popup, permission/device/
      display, download, partition isolation/revocation, secret-redacted fixed
      diagnostics, and controlled disclosure of residual subresource egress.
      Include the external-scheme/OS-handler/MCP-import probes, every direct-
      file resource type, per-hop cross-port redirects, non-network scheme
      commits, canonical-root identity failures, and controlled auth/gateway
      probes specified in 4.8.
      Record whether `locus-preview:` reaches `webRequest`, evidence for the
      protocol handler's independent admission/host/scope enforcement, and
      scheme denial from HTTP(S)-admitted guests. For file admission, attempt
      fetch, XHR, iframe `contentDocument` and `script src` reads/execution of
      in-scope assets, out-of-scope files under the same worktree, and another
      admission's host; record actual results and relative-URL controls.
      Observe first-response download/early permission denial and main-alone
      `close()`/`isDestroyed()` teardown without renderer cooperation; attempts
      to revive/reattach need a fresh generation/admission. These runtime
      observations cannot be discharged by 4.8 doubles.
- [ ] 5.3 Against a packaged build, repeat the full section 5.1 malicious-
      content matrix and section 5.2 guest-security matrix. Record OS,
      Electron/Bun versions, exact frozen source SHA, package/start commands,
      fixture hash, redacted console/main evidence, and screenshot/recording
      hashes in this change's `verification.md`. The Windows packaged track
      explicitly records file preview disabled with the current win32 backend
      gap; HTTP(S) guest tests still run. Mirror canonical-root failures and
      the Owner-selected Question 9 matrix, without calling unavailable file
      preview a successful broker-read test.
- [ ] 5.4 During the same exact-SHA GUI session when practical, execute
      TICKET-114's packaged-production CSP track and record it separately under
      that ticket's rules. Do not rewrite historical rebaseline task 4.4.
- [ ] 5.5 Execute TICKET-114's development-CSP/HMR track and record it
      separately. Do not rewrite historical task 4.5 and do not treat guest
      smoke as CSP evidence or CSP smoke as guest evidence.
- [ ] 5.6 If the GUI host or either track is unavailable, leave its checkbox
      open and stop implementation acceptance; do not substitute unit tests,
      old receipts, or another source SHA.

## 6. Exact-SHA verification, review, and closeout

- [ ] 6.1 Run the focused renderer, mentions, local-browser guest, main-window,
      CSP, filesystem-boundary, and trusted voice test suites; record exact
      files, counts, and assertions in `verification.md`.
- [ ] 6.2 Run `bun run architecture:check`, `bun run ts:check`, strict target /
      specs / all OpenSpec validation, `bun run check:full`, and
      `git diff --check` on one frozen implementation SHA.
- [ ] 6.3 Confirm the source diff removes superseded raw-HTML restore, raw Shiki
      fallback (including chat-markdown's local `escapeHtml` and the Q9-selected
      shim `escapeHtml`/`codeToHtml` disposition), unclassified dormant `getAST`,
      browser rich-HTML paste/drop/beforeinput, renderer partition authority/URL-key
      remount, direct guest `file:` loading, renderer subscriptions to raw
      guest `will-navigate`/console/load-failure/title/navigation or any other
      page-controlled URL/text payload, direct renderer `loadURL`,
      renderer `webview.capturePage()` (bounded capture now belongs to main),
      remote react-scan loading (recommended removal pending post-approval Owner
      acknowledgement), and duplicate
      guest-policy paths. Confirm the only diagnostic event path is the
      main-owned post-`did-attach-webview` guest `webContents` relay after
      minimization/redaction/bounds, with no renderer fallback; confirm it does
      not touch follow-up B or Foundation 1c guard ownership.
- [ ] 6.4 Record Codex `IMPLEMENTATION_VERIFIED` and independent fresh-context
      correctness plus R3 security `REVIEW_APPROVED` verdicts for that same
      frozen source SHA.
- [ ] 6.5 Stop for explicit Owner `ACCEPTED` before local integration/archive.
      Push, remote PR mutation/merge, release, or repository-rule changes require
      separate explicit authorization and are never implied by acceptance.
