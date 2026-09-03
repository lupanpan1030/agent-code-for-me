# Tasks: add-renderer-untrusted-content-hardening

> All checkboxes remain open while this change is **Draft**. No product-code
> implementation is authorized until the exact proposal receives Owner
> `APPROVED`.

Routing from the archived parent is explicit: sections 1–2 carry original 2.2,
sections 3–4 carry original 2.3 and the removed R6 webview scenario, and section
5 carries original 2.4 plus the TICKET-114 linkage.

## 0. Approval prerequisites

- [ ] 0.1 Resolve all eight approval questions in `design.md`, including the
      exact Streamdown ownership form, editor paste/state model, admission
      transport, exact-origin/network residual, descriptor-backed file support,
      guest deny policy, partition/diagnostic lifetime, and GUI matrix.
- [ ] 0.2 Obtain a fresh feasibility review of Streamdown/Shiki integration,
      structured mentions undo/redo, Electron attach timing, session handler
      ownership, descriptor-backed protocol reads, diagnostic redaction, and
      supported packaged-host execution.
- [ ] 0.3 Obtain independent fresh-context R3 security review of the exact
      threat model and fail-closed design, with special focus on preload/bridge
      absence, programmatic/redirect ordering, file TOCTOU, permission/device
      denial, popup/download effects, partition reuse, diagnostic secret flow,
      and explicitly residual guest network egress.
- [ ] 0.4 Rebase all source/test anchors and active-change conflicts onto the
      implementation-start SHA; update the Draft rather than carrying stale
      counts or line numbers forward.
- [ ] 0.5 Run strict OpenSpec validation and obtain explicit Owner `APPROVED`
      for the exact rebaselined package before the first source edit.

## 1. Characterization and renderer source guard (original 2.2)

- [ ] 1.1 Convert `tests/renderer-html-sinks.test.ts` from a five-file allowlist
      to an exact insertion-point inventory keyed by construct, enclosing owner,
      content producer, and required behavior test.
- [ ] 1.2 Scan `dangerouslySetInnerHTML`, value-bearing and empty
      `.innerHTML` / `.outerHTML`, `insertAdjacentHTML`, `document.write` /
      `writeln`, contextual fragments, `srcDoc` / `srcdoc`, and equivalent
      unsafe HTML APIs; add negative fixtures proving every class trips the
      guard.
- [ ] 1.3 Record the rebaselined sink and producer inventory in
      `verification.md`. Do not label a whole file safe and do not infer runtime
      safety from source inventory alone.
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
      rehype ownership decision.
- [ ] 2.3 Add black-box static and streaming regressions for script/iframe,
      active SVG/MathML, event attributes, executable and encoded URLs,
      malformed/incomplete chunks, and a safe-formatting preservation matrix.
- [ ] 2.4 Make `highlightCode()` fail closed when Shiki throws or its expected
      `<code>` output shape is absent; never return unescaped source as HTML and
      leave no second highlighting/extraction path in callers.
- [ ] 2.5 Add hostile-code and forced-output-shape tests at the shared Shiki
      producer and raw insertion boundary, covering chat/repository, MCP, tool,
      and message-JSON consumers.
- [ ] 2.6 Replace mentions undo/redo `{ html, cursorOffset }` snapshots with
      lossless canonical text/atomic-mention runs plus anchor/focus positions.
      Define the round-trip/spacing/selection model, rebuild through the one
      safe DOM builder, and remove both non-empty `.innerHTML` restores and the
      superseded state path in the same change.
- [ ] 2.7 Make the mentions editor itself always prevent browser rich-content
      paste. Consume only `text/plain` from mixed data, reject HTML-only input,
      and keep typed image/attachment delegation from falling back to default
      contentEditable insertion; do not rely on optional parent handlers.
- [ ] 2.8 Add mentions regressions for exact whitespace, atomic mention tokens,
      forward/backward selection, undo/redo, mixed clipboard data, HTML-only
      clipboard data, and caller delegation. Prove markup cannot survive into
      the editor DOM or later restore.
- [ ] 2.9 Preserve and rerun Mermaid source-to-sanitized inline/fullscreen
      insertion and tool-subtitle text-rendering adversarial coverage. Update
      existing tests only where the canonical policy owner changes their path.

## 3. Main-owned local-browser guest policy (original 2.3 / R6 webview)

- [ ] 3.1 Add `src/main/windows/local-browser-guest-policy.ts` as the sole
      Electron guest-policy owner; wire it from `main.ts`, project only its
      narrow operation through `src/preload/index.ts` / `index.d.ts`, and add
      exact owner entries to `docs/OWNERSHIP_MAP.md`.
- [ ] 3.2 Add a narrow internal, non-tRPC preview-admission operation. Resolve
      chat/worktree state in main, derive the embedder from the IPC event,
      require `windowManager.getChatOwner(chatId)` to match, and reject caller-
      provided filesystem/webContents authority. Return only the approved URL
      plus a high-entropy non-persistent partition treated as the sole bearer
      attachment capability.
- [ ] 3.3 Implement an embedder/chat/generation/partition/exact-src pending
      registry with one-shot consume, short TTL, replay/conflict rejection, and
      active/cumulative caps. Never persist, log, put in URL/arguments, or reuse
      the partition; do not create a second token.
- [ ] 3.4 Remove `<webview key={currentUrl}>` remounts. Keep one guest for
      allowed same-origin navigation; require a new generation/partition/
      admission for a user-entered different origin or recovery, destroying the
      old guest before replacement.
- [ ] 3.5 Install each embedder's `will-attach-webview` listener before its app
      document can attach a guest. At attachment, consume the exact admission,
      deny unknown guests, and force empty preload/additional arguments,
      `webviewTag`/all Node modes/insecure content off, context isolation/
      sandbox/web security on, no popup grant, and the issued partition.
- [ ] 3.6 Register valid guests through `did-attach-webview` and install all
      WebContents handlers through the one owner. If registration or any
      mandatory handler is late/missing, destroy the guest; do not copy policy
      into `main.ts` or the renderer.
- [ ] 3.7 Prove guest JavaScript cannot observe `electronTRPC`, `desktopApi`,
      `webUtils`, `ipcRenderer`, `require`, or `process`, cannot send privileged
      IPC/tRPC, and cannot trigger a Locus-mediated privileged side effect.

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
      follow semantics, verify a regular file, and stream that same descriptor
      for documents and relative assets. Reject forged roots, traversal/
      decoding ambiguity, special files, symlink/path-retarget races, and every
      path-only/direct-`file:` fallback; disable file preview when a platform/
      filesystem cannot prove the safe read. Do not claim immutable snapshots
      against concurrent writes to the same opened inode.
- [ ] 4.3 Deny guest `window.open` / `_blank` through guest
      `setWindowOpenHandler`; assert no BrowserWindow and no
      `shell.openExternal` call occurs.
- [ ] 4.4 Install both permission-check and permission-request default-deny
      handlers on each guest partition, plus a denying device-permission
      handler. On HID/serial/USB/Bluetooth selection, call
      `event.preventDefault()` and the API-specific rejecting callback
      (Bluetooth/serial empty string; HID/USB no ID); return no display streams
      with the system-picker bypass disabled. Prove no automatic device choice
      or OS prompt appears and unknown permissions fail closed.
- [ ] 4.5 Cancel guest downloads, including redirect and download-attribute
      paths. Any future user-approved save flow remains out of scope.
- [ ] 4.6 Preserve the trusted app session's microphone/voice behavior and prove
      guest deny handlers are never installed as a global `persist:main`
      deny-all policy.
- [ ] 4.7 Replace arbitrary `executeJavaScript(string)` access in the workbench
      with the closed named set of app-owned diagnostic probes executed through
      main; bind results to current guest/navigation identity. Before data enters
      renderer state, strip URL credentials/query/fragment, minimize fields,
      redact recognized and available exact secrets, then apply type/count/
      length bounds. Show the final text before explicit chat insertion and log
      no raw page value or partition capability.
- [ ] 4.8 Add focused unit/integration fixtures for unsafe attach preferences,
      bridge probes, initial/link/location/`loadURL`/back/forward/redirect
      requests, direct `file:` in main/subframe/XHR/script/image positions,
      descriptor/symlink races, popup, permissions/device/display, downloads,
      two-partition isolation, teardown/replacement races, stale diagnostics,
      secret fixtures, and handler-installation failure. Include a controlled
      test documenting (not misreporting as blocked) residual subresource egress.

## 5. GUI smoke and TICKET-114 linkage (original 2.4)

- [ ] 5.1 In development Electron on a GUI-capable host, run the malicious
      markdown (static and
      streaming), highlighted-code, Mermaid inline/fullscreen, tool subtitle,
      mentions paste/undo/redo, and normal safe-formatting controls in the real
      privileged renderer.
- [ ] 5.2 Run the local-browser malicious fixture in development Electron:
      bridge/Node probes, exact-origin initial/link/location/`loadURL`/back/
      forward/redirect behavior, brokered-file success or honest platform
      disablement, direct-file/symlink/rename denial, popup, permission/device/
      display, download, partition isolation/revocation, secret-redacted fixed
      diagnostics, and controlled disclosure of residual subresource egress.
- [ ] 5.3 Against a packaged build, repeat the full section 5.1 malicious-
      content matrix and section 5.2 guest-security matrix. Record OS,
      Electron/Bun versions, exact frozen source SHA, package/start commands,
      fixture hash, redacted console/main evidence, and screenshot/recording
      hashes in this change's `verification.md`.
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
      fallback, browser rich-HTML paste, renderer partition authority/URL-key
      remount, direct guest `file:` loading, and duplicate guest-policy paths;
      confirm it does not touch follow-up B or Foundation 1c guard ownership.
- [ ] 6.4 Record Codex `IMPLEMENTATION_VERIFIED` and independent fresh-context
      correctness plus R3 security `REVIEW_APPROVED` verdicts for that same
      frozen source SHA.
- [ ] 6.5 Stop for explicit Owner `ACCEPTED` before local integration/archive.
      Push, remote PR mutation/merge, release, or repository-rule changes require
      separate explicit authorization and are never implied by acceptance.
