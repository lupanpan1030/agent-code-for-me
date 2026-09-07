# Tasks: add-renderer-untrusted-content-hardening

> **DIRECTION+IMPLEMENTATION APPROVED (eight defaults), 2026-09-05.** The
> Owner accepted all eight recommended defaults, conditional on 0.2/0.3/0.4/0.5.
> Among approval prerequisites, only 0.1 and the historical feasibility receipt
> in 0.2 are complete. Source edits remain gated; Owner **APPROVED the Q9 compromise on 2026-09-07**.
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
      The eight text fixes and Owner-approved Q9 compromise are recorded;
      **待最终定向复核**. Remains unchecked until the revised exact SHA's final
      fresh-context R3 approval; the historical verdict does not transfer.
- [ ] 0.4 Rebase all source/test anchors and active-change conflicts onto the
      implementation-start SHA; update the Draft rather than carrying stale
      counts or line numbers forward.
- [ ] 0.5 Run strict OpenSpec validation and obtain explicit Owner `APPROVED`
      for the exact rebaselined package before the first source edit. The
      present documentation strict-validation run does not close this task;
      final targeted re-review, three post-approval Owner acknowledgements,
      and 0.4 precede exact-package confirmation. Each disclosure is
      presented to Owner 2026-09-07 (board §六); acknowledgement pending.

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
      Keep the scan rooted at `src/renderer`: shared denylist string literals
      in `plugin-controlled-ui.ts` are not executable sink sites. Add an exact
      configuration check for new Shiki-API shims/Vite aliases into DOM-producing
      dependencies, without treating configuration strings as HTML sinks.
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
      `<code>` output shape is absent; never return unescaped source as HTML and
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
- [ ] 3.2 Add a narrow internal, non-tRPC preview-admission operation. Resolve
      chat/worktree state in main, derive the embedder from the IPC event,
      atomically call `windowManager.claimChat(chatId, senderWindow.id)`
      (idempotent for this window; bounded denial if another live window owns
      it), then resolve the DB-registered worktree and issue the partition.
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
- [ ] 3.5 Install each embedder's `will-attach-webview` listener before its app
      document can attach a guest. At attachment, consume the exact admission,
      deny unknown guests, and force empty preload/additional arguments,
      `webviewTag`/all Node modes/insecure content off, context isolation/
      sandbox/web security on, no popup grant, and the issued partition.
      Explicitly force sandbox/contextIsolation rather than inheriting the
      privileged embedder's `sandbox:false` preferences.
- [ ] 3.6 Register valid guests through `did-attach-webview` and install all
      WebContents handlers through the one owner. If registration or any
      mandatory handler is late/missing, destroy the guest; do not copy policy
      into `main.ts` or the renderer. Account for post-navigation-start,
      pre-commit attach ordering; prove no guest request precedes installation
      of the pre-return Session gate.
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
      `will-*` and committed-URL destruction as defense in depth.
- [ ] 4.2 Register/configure the fixed-origin Session-local
      `locus-preview://preview.local` scheme with minimum privileges before app
      readiness, then bind its handler/root on each unique Session before the
      partition is returned. Translate an admitted user `file://` target to it,
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
      handler. On HID/serial/USB/Bluetooth selection, call
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
      paths. Any future user-approved save flow remains out of scope.
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
      `openExternal` denial. Require runtime-observed cancellation of `file:`
      mainFrame/subFrame/xhr/script/image requests and every redirect hop,
      including 3xx to another loopback port; mock registration proves neither.
      Remove the renderer `<webview>.loadURL` escape hatch. Probe Locus auth
      callback/gateway with no state/token: observe bounded 400/401/404 and no
      state change, without claiming egress itself is blocked.

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
      page-controlled URL/text payload, direct renderer `loadURL`, remote
      react-scan loading (recommended removal pending post-approval Owner
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
