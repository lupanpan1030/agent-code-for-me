# RED receipt — add-renderer-untrusted-content-hardening (test-first suite)

- Base SHA: `45f6e54c5fd7f26dd39bd9e9354ad8c7d14325c2` (worktree `locus-add-renderer-untrusted-content-hardening-draft`, HEAD unchanged; no commits, no product source touched)
- Auditor: fresh-context RED-suite auditor (not an author). Authors: content (Domain A), mermaid-editor (Domain B), guest (Domain C).
- Verdict: **RED_SUITE_ACCEPTED** (one P1 found and fixed in the authors' fixture; zero P1 remaining)
- Command of record: `bun run test` = `bun test --isolate tests` (the `--isolate` flag is load-bearing: `mock.module` and the happy-dom prototype shims are file-scoped only under it). Audit spot-runs: `bun test --isolate tests/renderer-hardening-<file>.test.ts`, one file per process.
- Toolchain observed: bun 1.3.14, happy-dom 20.10.6, dompurify 3.4.11, mermaid 11.16.0, shiki 1.29.2, @pierre/diffs 1.0.10, hast-util-to-html 9.0.5, react/react-dom 19.2.1. `tsc --noEmit` covers `src/**` only (tests are not type-gated); `biome check` is clean on all author files including the auditor edit.

## 1. Per-file counts (auditor-observed, reconciled with author reports)

| File | Tests | RED | GREEN (by design) | Author report | Reconciled |
| --- | ---: | ---: | ---: | --- | --- |
| tests/renderer-hardening-content.test.ts | 84 | 11 | 73 | 73/11 | yes |
| tests/renderer-hardening-content-markdown-boundary.test.ts | 2 | 2 | 0 | 0/2 | yes |
| tests/renderer-hardening-content-shiki.test.ts | 20 | 12 | 8 | 8/12 | yes |
| tests/renderer-hardening-content-diff.test.ts | 12 | 0 | 12 | 12/0 | yes |
| tests/renderer-hardening-mermaid-editor.test.ts | 72 | 48 | 24 | 24/48 | yes after fix (see §2; before the fix run 1 of 5 gave 23/49) |
| tests/renderer-hardening-guest-policy.test.ts | 31 | 26 | 5 | 5/26 | yes |
| tests/renderer-hardening-preview-broker.test.ts | 12 | 5 | 7 | 7/5 | yes |
| **Total** | **233** | **104** | **129** | 233 | yes |

Neighbour suites unchanged: `renderer-html-sinks`, `renderer-mermaid-xss`, `renderer-csp-policy`, `local-browser-workbench` = 16 pass / 0 fail.

## 2. Fixes applied by the auditor (fixture-only, authors' files only)

1. **P1 — non-deterministic Mermaid settle harness** (`tests/renderer-hardening-mermaid-editor.test.ts`, `renderMermaidBlock`). The loop "settled" when markup had been stable for 1.5 s after the 600 ms debounce. MermaidBlock's `parsing` and `loading` states render byte-identical spinner markup, so `stableSince` never resets while `mermaid.render` is in flight; any render slower than ~1.5 s (observed once in five full-file runs on the `safe sequence diagram` positive control: `sinkSvgs` length 0, i.e. no inline sink yet) exited the loop early. Fix: the pinned mermaid singleton (the same module instance MermaidBlock lazy-imports; verified mutable, `render` writable) has `render` wrapped to count call/settle; the loop now exits only when the debounce elapsed, a render was called, none is in flight, and either the spinner is gone (success/error committed) or the component returned to the spinner (parse-error path) with no re-render for `STABLE_WINDOW_MS`. A fixture that never reaches `mermaid.render` now throws a precondition error at `SETTLE_LIMIT_MS` instead of "settling". The real render runs unchanged; no sanitizer, oracle, or policy is touched. Post-fix: 3/3 runs at 24 pass / 48 fail with the author's exact fail list; biome clean.

No other author file was edited. No `src/`, `package.json`, `bun.lock`, existing test, or other openspec file was changed.

## 3. Coverage matrix

Status legend: covered = unit-scope evidence complete for the Scenario/Decision; partial = unit-scope gaps remain (named); gui-track = discharged only by section 5 runtime tasks; missing = nothing in the suite.

### runtime-security-baseline — MODIFIED requirement Scenarios

| Scenario | Covered by | Status | Runtime / open half |
| --- | --- | --- | --- |
| Markdown active HTML and highlighted HTML sinks | content: 9 malicious fixtures x static/streaming (green), `custom-scheme-links` and `relative-url-links-and-media` x2 (RED), 7 chunked streaming fixtures x2 (green), 10 safe-format controls x2 (green), Mermaid `aria-label="Mermaid chart"` dormant x2 (green), openExternalUrl click x2 (green); D2 exact pin / defaultSchema import / one wrapper + explicit rehypePlugins (3 RED); shiki suite for highlighted sinks | covered (harden non-wildcard options proved only behaviourally) | GUI 5.1 real renderer |
| The app markdown pipeline throws while rendering untrusted content | markdown-boundary: static + streaming forced remark-breaks throw (2 RED) | covered | 5.1 |
| A raw-markup insertion is introduced or changed | content D1: exact inventory (RED), dynamic/remote script absent (RED), scanner self-test over 23 negative + 1 clean fixture, full-tree walk incl. public/.js/.html, HTML entry, producer-import binding, unsafeCSS/prerenderedHTML named rule, four-specifier alias + shim inventory, worker guard, dormant getAST, sole codeToHtml | covered (independent scanner; conversion of the canonical `tests/renderer-html-sinks.test.ts` per task 1.1 is implementer-owned) | — |
| Highlighted HTML reaches a raw insertion sink | shiki: 4 consumers x {real-Shiki hostile (green), forced mismatch / dual-code / trailing (RED x12), forced throw (green)} | covered | 5.1 |
| Dependency diff rendering is covered by the reviewed-producer contract | diff: binding identity + createPlainHast shape, benign collapsed unified/split, hostile FileDiff unified/split, hostile PatchDiff unified/split, multi-file no-DOM, 4 negative controls (12 green); content: 9-anchor lockfile assertion, single-resolution/no-flat-override, worker guard, alias rule | covered (all green-by-design: bun.lock already resolves the pins) | 5.1 dev pre-bundle `resolveId` binding; 5.3 packaged; `bun install --frozen-lockfile` = CI |
| Mentions editor receives browser rich content or restores content | mermaid-editor D4: paste gate 4 (RED), drop/dragover 3 (RED), beforeinput allowlist 17 prevented (RED) + 12 admitted (green) + insertLineBreak/insertParagraph (RED) + Enter submit (green) + historyUndo/historyRedo (RED), undo/redo markup 2 (RED), forward/backward selection 2 (RED), atomic mention (RED), round-trip (green), lossless spacing 4 (RED) | covered (unit half per D10) | GUI 5.1 native paste/drop, execCommand, IME, native undo/redo |
| Mermaid diagram contains scriptable content | mermaid-editor D3: secure list (RED), themeCSS/fonts/theme/htmlLabels/sequence directives (5 RED), classDef/style position:fixed (2 RED), adapter stray style / CSS attrs / animate (3 RED); positive controls x2, classDef remote url, flowchart click/htmlLabels, sequence links, securityLevel loose, parsererror ordering (green); env self-checks | covered | GUI 5.1 transient mount/CSS/cleanup |
| Tool subtitle contains HTML | existing retained `tests/renderer-agent-tool-call-xss.test.tsx` (task 2.9 "retain") | covered (existing) | 5.1 |
| Production renderer CSP permits script execution | content: `buildRendererContentSecurityPolicy(false)` script-src exactly `'self' 'wasm-unsafe-eval'` (green) | covered (construction only) | 5.4 TICKET-114 packaged track |
| Development renderer CSP permits Vite HMR | content: dev-only tokens exactly `'unsafe-inline' ws://localhost:* http://localhost:*` (green) | covered (construction only) | 5.5 TICKET-114 dev track |

### runtime-security-baseline — ADDED requirement Scenarios

| Scenario | Covered by | Status | Open half |
| --- | --- | --- | --- |
| Renderer attempts an unsafe or unregistered guest attachment | guest-policy: owner exists/loads (RED), import-type only (RED), main.ts installs (RED), exactly one `web-contents-created` (RED), will/did-attach only in owner (RED), D8 handlers in owner (RED); webview attribute guard (green) | partial: GP-01 effective-preference/partition-mismatch verdicts uncovered (no export identifier named in tasks/design) | 5.2/5.3 first-request order, sandbox, no prompt |
| Renderer requests or replays a preview admission | guest-policy: claimChat acquire/idempotent/deny/stale (green), partition not chat-derived/persist (RED), no URL-key remount (RED) | partial: GP-02 one-shot/TTL/caps/replay/StrictMode registry uncovered (no export name; IPC op unnamed) | 5.2 |
| Preview JavaScript probes privileged capabilities | (webview carries no preload/webpreferences attribute — proxy only) | gui-track 5.2 (GP-03 injected probe not written; no pure decision named) | 5.2/5.3 |
| Preview attempts disallowed top-level navigation or redirect | guest-policy: D7 gate/navigation/redirect/window-open wiring in owner (RED), no renderer loadURL (RED), no raw will-navigate listeners (RED) | partial: GP-04 origin/document/scheme verdicts, about/blob/data postconditions uncovered | 5.2/5.3 per-hop, file: per resource type, cross-port 3xx |
| Preview attempts file-root escape | preview-broker: terminal symlink, symlinked-prefix canonicalization, identity drift, escape symlink, child names, win32, single backend (7 green); isFile extension, scheme privileges, Session-only protocol.handle, composition, no fallback (5 RED); guest-policy: no direct `file:` src (RED); fixture `preview-worktree.json` | partial: GP-05 host/document/scope verdicts and descriptor-race cases uncovered | 5.2/5.3 read/execution results |
| Preview attempts to open another window | guest-policy: `setWindowOpenHandler` present, no `openExternal(` in owner (static RED) | partial: GP-06 deny verdicts under each external-scheme probe uncovered | 5.2 |
| Preview requests permission, capture, or download | guest-policy: permission check/request, device, display-media, HID/serial/USB/Bluetooth, will-download present in owner (static RED); persist:main never denied (green) | partial: GP-07 rejecting-callback verdicts and pre-return ordering uncovered | 5.2/5.3 |
| Two previews use guest storage | guest-policy: `close()` + `isDestroyed()` present, no `destroy()`/`waitForBeforeUnload:true` (static RED) | partial: GP-08 revocation/cleanup/never-reuse uncovered | 5.2/5.3 |
| Host captures guest diagnostics | guest-policy: console/did-fail-load/title/navigation payloads absent from state (4 RED), insert-report (RED), removal list executeJavaScript/capturePage/selection probe/listeners (RED), shared adapter exists/import direction/main composition (3 RED), redaction fixture validation (green) | covered for the renderer half; GP-09 level mapping/bounds/stale rejection uncovered | 5.2 |
| Trusted app requests its existing microphone behavior | guest-policy: no `setPermission*Handler` on defaultSession/persist:main (green) | covered (static half) | 5.2 |

### local-browser-workbench — MODIFIED Scenarios

| Scenario | Covered by | Status | Open half |
| --- | --- | --- | --- |
| User opens a localhost page | guest-policy: allowed file:// never becomes a direct `file:` webview src (RED) | partial: HTTP(S) admission issuance uncovered (op unnamed) | 5.2 |
| User enters a remote URL | guest-policy: blocked + shared-grammar reason (green) | covered | — |
| Preview attempts remote navigation | guest-policy: raw navigation listeners removed (RED) | partial: main gate GP-04 | 5.2 |
| User deliberately opens another local origin | guest-policy: same-origin navigation keeps one guest element (RED) | partial: fresh generation/partition on different origin uncovered | 5.2 |
| The registered file root needs canonicalization | preview-broker canonicalization group (3 green) | partial: broker-level re-verification after anchoring unnamed | 5.2/5.3 |
| An admitted file attempts cross-file or cross-admission reads | preview-broker static wiring (RED x4) + `preview-worktree.json` | partial: verdict doubles uncovered | 5.2/5.3 results |
| Safe file broker is unavailable | preview-broker win32 refusal + single backend (green) | partial: workbench bounded reason unnamed | 5.3 Windows record |
| Console errors occur | guest-policy console-message (RED) | partial: level mapping uncovered | 5.2 |
| Network or load failure occurs | guest-policy did-fail-load/provisional (RED) | partial | 5.2 |
| Guest title or navigation changes | guest-policy title/navigate/in-page (RED) | partial | 5.2 |
| User captures page context | guest-policy removal list (RED x3) | partial: main capture bounds/stale rejection uncovered | 5.2 |

### Decisions

| Decision | Covered by | Status |
| --- | --- | --- |
| D1 reviewed-output contract + exact inventory | content D1 groups (owner path from design; inventory keyed by construct@symbol verified against the scanner on 45f6e54c) | covered (preload/tRPC openExternal entry points not exercised; main `openExternalUrl` is) |
| D2 Streamdown repository-gated + oracle | content D2 + malicious/safe matrices, boundary, diff profile, oracle self-test | covered |
| D3 Shiki fail-closed + Mermaid secure/CSS profile | shiki + mermaid-editor D3 | covered |
| D4 mentions canonical state + component-owned insertion | mermaid-editor D4 | covered (unit half) |
| D5 main guest-policy owner | guest-policy static contract tests | partial (GP-01) |
| D6 bounded admission | guest-policy claimChat/partition/remount/file | partial (GP-02) |
| D7 URL/file-root policy | guest-policy static + preview-broker | partial (GP-04/05) |
| D8 permissions/downloads | guest-policy static + persist:main guard | partial (GP-07) |
| D9 closed diagnostics set | guest-policy behavioural + removal + adapter | partial (GP-09 projection details) |
| D10 evidence split | lockfile assertion, worker guard, CSP construction; every runtime row assigned to 5.1–5.5 below | covered for the unit half; gui-track for the rest |

## 4. RED tests and their (auditor-verified) reasons on 45f6e54c

### tests/renderer-hardening-content.test.ts (11)
1. D1 > exact inventory entry — scanner finds four un-inventoried value-bearing sinks: `dom-html-write@handleKeyDown` x2 (agents-mentions-editor.tsx:991,1019), `dynamic-script@script` (agents-debug-tab.tsx:39), `script-src-assignment@loadReactScan` (:41). Inventory symbols (CodeBlock, DiffLineRow, HighlightedJson, MermaidBlockInner x2, MessageJsonDisplay, FileDiffCard x2) verified real.
2. D1 > dynamic script/script.src/remote import/importScripts absent — agents-debug-tab.tsx:39/:41 unpkg react-scan loader present (recommended default, Owner acknowledgement pending; encoded per D1 "Its absence is an explicit guard fixture").
3. D1 > `src/renderer/lib/security/renderer-html-policy.ts` exists — module absent.
4. D1 > no caller-local HTML escaping literal outside the owner — chat-markdown-renderer.tsx:25 and pierre-diffs-shiki-shim.ts:227-229 emit `&lt;`/`&gt;`/`&amp;`.
5. D2 > package.json pins streamdown `2.1.0` — declares `^2.0.1`.
6. D2 > `defaultSchema` imported from `rehype-sanitize` and app-imported rehype packages exact/direct — no renderer module imports any rehype package; rehype-* are Streamdown transitives only.
7. D2 > both `<Streamdown>` mounts in one file with literal `rehypePlugins`/`remarkPlugins`/`components` — chat-markdown-renderer.tsx:460/:693 omit `rehypePlugins` (Streamdown default raw→sanitize({})→harden(wildcards) chain in use).
8–9. Markdown sinks > static/streaming `custom-scheme-links` — `irc:`, `xmpp:`, `ircs:` hrefs survive (defaultSchema protocols + wildcard harden); oracle allows only HTTP(S)/mailto links.
10–11. Markdown sinks > static/streaming `relative-url-links-and-media` — relative links/images rewritten to rooted paths (`/etc/passwd`, `/secrets/.env`, `/a.png`, `/private/avatar.png`, `//evil.example/x`→`/x`) that resolve to `file:` against the privileged document base; D2 requires an explicit reviewed base or fail-closed.

### tests/renderer-hardening-content-markdown-boundary.test.ts (2)
12–13. static/streaming mount: forced remark-breaks throw — no app-owned boundary; the throw escapes the root ("escaped the app boundary: forced remark-breaks plugin failure") and unmounts the chat view.

### tests/renderer-hardening-content-shiki.test.ts (12 = 4 consumers x 3 shapes)
Consumers: chat/repository fence (MemoizedMarkdown→CodeBlock), MCP (AgentMcpToolCall→HighlightedJson), tool (AgentEditTool Write→DiffLineRow), message JSON (MessageJsonDisplay).
14–17. forced extraction mismatch (no `<code>` wrapper) — shiki-theme-loader.ts:287 `match ? match[1] : code` inserts the raw source: `<img onerror>` + `file:`-resolving `src` reach the DOM (`sourceMarkupElements: 2`).
18–21. forced dual top-level `<pre><code>` — non-greedy regex accepts the first block (`data-shiki-forged="first"` rendered) and silently drops the second.
22–25. forced trailing output after the wrapper — inner block accepted ("inside") and the trailing output silently dropped instead of failing closed.

### tests/renderer-hardening-mermaid-editor.test.ts (48)
D3 MermaidBlock (8):
26. secure list extended with themeCSS/themeVariables/theme/fontFamily/altFontFamily/htmlLabels — `getSiteConfig().secure` holds only Mermaid's six defaults.
27. hostile themeCSS directive — paint gains `:root{position:fixed}`, `svg{position:fixed;…background:url("https://evil.example/beacon.png")}`, `behavior:url(…)`.
28. hostile fontFamily/altFontFamily — paint becomes `font-family:EvilFontFamily`.
29. hostile theme/themeVariables — forest theme + injected colours/`EvilThemeVariableFont` applied.
30. hostile htmlLabels directive — label rendering and SVG markup differ from the control.
31. hostile sequence themeCSS/fontFamily — `EvilSequenceFont` + injected rules in paint.
32. classDef position:fixed — both sinks receive `.overlay>*{…position:fixed!important}` and `rect style="…position:fixed…"`.
33. style statement position:fixed — both sinks keep `rect style="fill:#f00 !important;position:fixed !important;…width:100vw"`.
D3 adapter (3):
34. stray `<style>` — DOMPurify svg profile keeps both style elements incl. `@import url(https://…)` and unscoped `:root{position:fixed;…}`.
35. CSS-bearing attributes — `style="position:fixed;…url(https://…)"`, `fill="url(https://…)"`, `filter="url(https://…)"` survive.
36. animate*/set — `<animate>`, `<animateTransform>`, `<animateMotion>`, `<set>` survive the svg allowlist.
D4 paste/drop (7):
37. HTML-only paste, no parent onPaste — not default-prevented (component onPaste only saves undo state and delegates).
38. mixed paste — nothing inserts `text/plain` or prevents default.
39. image paste, no typed callback — not default-prevented.
40. parent onPaste that does not preventDefault — component does not prevent independently.
41. HTML-only drop — no `onDrop` handler.
42. mixed drop — no drop gate.
43. dragover — no `onDragOver` handler.
D4 beforeinput (21):
44–60. prevented inputTypes (17 `test.each`: insertFromPaste, insertFromDrop, insertLink, insertReplacementText, formatBold, formatItalic, formatUnderline, formatStrikeThrough, formatFontColor, formatBackColor, formatSetBlockTextDirection, insertOrderedList, insertUnorderedList, insertHorizontalRule, insertFromYank, insertFromPasteAsQuotation, insertTranspose) — no `beforeinput` listener exists; none is default-prevented.
61–62. insertLineBreak / insertParagraph — not prevented; no safe-builder newline (`getValue()` stays `abcd`).
63. historyUndo — not prevented, not routed (undo wired only to keydown Ctrl+Z).
64. historyRedo — not handled.
D4 restore (9):
65. undo entry with attacker markup — `editorRef.innerHTML = state.html` (:991) replays `<b onmouseover>`, `<img onerror>`, `<a href=javascript:>`, `<meta>`, `<div style=position:fixed>`.
66. redo entry with attacker markup — same via :1019.
67. forward selection (6,11) — entry stores a single collapsed `cursorOffset`; restored as {6,6}.
68. backward selection (11,6) — direction/extent lost; restored {6,6}.
69. caret inside a mention chip — mention-as-1 arithmetic restores to content end (26), not 2/23.
70–73. lossless round-trip (double spaces, trailing mention, adjacent mentions, newlines adjacent) — `buildContentFromSerialized` appends an unconditional space after every mention.

### tests/renderer-hardening-guest-policy.test.ts (26)
Invariant 7 / D9 (5), leaks verified in the rendered DOM/inputs/inserted text:
74. console-message — bearer JWT, `sk-` key, `api_key` value rendered from `consoleMessages`.
75. did-fail-load / provisional — OAuth code/state/nonce + fragment rendered from `loadFailures`.
76. page-title-updated — `titlemarker-…` rendered from `pageTitle`.
77. will-navigate / did-navigate / did-navigate-in-page — URL password, query token, fragment reach the URL input / `currentUrl` / failures.
78. insert-report — `buildLocalBrowserReport` copies raw console/failure/title values into the inserted chat text (9 fixture secrets).
D6 (3):
79. partition — webview `partition="local-browser-chatpartitionA1"` derived from the chat id.
80. same-origin did-navigate — `<webview key={currentUrl}>` remounts (different element identity).
81. allowed file:// — webview `src="file:///tmp/locus-guest-file-wt/index.html"` (direct guest file loading).
Renderer removal list (6):
82. raw page-controlled listeners — workbench adds will-navigate, did-navigate, did-navigate-in-page, did-fail-load, did-fail-provisional-load, page-title-updated, console-message (local-browser-workbench.tsx:193-199).
83. `<webview>.loadURL` — `rollbackToLastAllowedUrl` (:667-669) plus the type declaration (:45).
84. `capturePage` — renderer `webview.capturePage?.()` (:278).
85. `executeJavaScript` — renderer executes probe strings with `userGesture:true` (:115, :289, :301).
86. inline selection probe — `window.__LOCUS_LAST_CLICKED_ELEMENT__ || null` string in the renderer (:302).
87. URL key / chat-derived partition — `key={currentUrl}` (:450) and the `` `local-browser-${…}` `` template.
D5 / task 3.1 (9):
88. owner module `src/main/windows/local-browser-guest-policy.ts` exists and exports functions — absent.
89. owner imports Electron only as types — file absent.
90. main.ts imports `./local-browser-guest-policy` — no such import.
91. exactly one `web-contents-created` registration in src/main — zero.
92. will/did-attach-webview handled only by the owner — no file handles them.
93. D7 wiring (onBeforeRequest, will-navigate, will-frame-navigate, will-redirect, setWindowOpenHandler) in owner — absent.
94. D8 wiring (permission check/request, device, display media, HID/serial/USB/Bluetooth selectors, will-download) in owner — absent anywhere in src/main.
95. D5 `close()` + `isDestroyed()` teardown, no `destroy()` — absent.
96. no `openExternal(` in the guest owner — file absent (contract alarm retained after implementation).
D9 (3):
97. `src/shared/local-browser-diagnostics-policy.ts` exists and loads — absent.
98. adapter imports no main/Electron and no `secret-redaction-policy` — absent.
99. a src/main module composes the adapter with `agent-runtime/redaction` — none.

### tests/renderer-hardening-preview-broker.test.ts (5)
100. stable-directory.ts has `.isFile()` regular-file verification — absent (directory-only owner).
101. `registerSchemesAsPrivileged` for `locus-preview` with exact flags — no registration, no scheme literal in src/main.
102. Session-scoped `.protocol.handle(`, no global handler / legacy protocol APIs — no locus-preview files.
103. locus-preview path reaches stable-directory.ts via imports — no files.
104. no `net.fetch(` / `pathToFileURL(` / `.loadFile(` on the path — no files (guard becomes meaningful once the broker exists).

## 5. GREEN-by-design (129) — characterization / upgrade-gate guards that must stay green

- content (73): scanner self-test (16 classes, 24 fixtures) and full-tree walk (public/, .js/.html); producer-import binding; HTML entry has no inline handler/srcdoc/remote script; highlightCode sole codeToHtml caller; dormant getAST has no callers; `unsafeCSS` is exactly `PIERRE_DIFFS_THEME_CSS` at both sites with an interpolation-free const declaration; `prerenderedHTML` absent; Vite `resolveId` binds exactly the four specifiers to the shim and the only alias key is `@`; the shim is the only Shiki-API module; worker-entry guard; nine Q9 lockfile anchors exact; single resolution of hast-util-to-html/@pierre/diffs, shiki keys exactly {`shiki`, `@pierre/diffs/shiki`}, no flat shiki/@shikijs override; no `defaultRehypePlugins` adoption (real Streamdown export name); 18 malicious-matrix cases; 14 chunk-by-chunk streaming cases; 20 safe-format controls; Mermaid dormant x2; openExternalUrl click boundary x2; oracle self-test (30 must-fail constructs, safe DOM accepted, `/etc/passwd` resolves to `file:` against the privileged base); production CSP script-src exactly `'self' 'wasm-unsafe-eval'`; dev-only allowances exactly `'unsafe-inline'`, `ws://localhost:*`, `http://localhost:*`.
- shiki (8): 4 consumers x real-Shiki hostile source escaped and fully preserved as text; 4 consumers x forced generator exception never inserts source as HTML.
- diff (12): four-specifier binding identity + `createPlainHast` text-node HAST; benign collapsed multi-region unified/split under the strict diff profile with separator/expand `use[href]`; hostile names/lines unified/split; hostile patch text unified/split; hostile multi-file patch produces no DOM (`getSingularPatch` throws into the test boundary); negative controls: +1 char CSS drift, missing style, duplicate style / lost marker / non-Text-br child, bad fragment href / `use` outside separator subtree.
- mermaid-editor (24): env self-checks (DOMPurify keeps an SVG root, siblings after SVG `<style>`, and iterates past removals under the shims; Mermaid oracle rejects each forbidden class and accepts a scoped paint style; editor oracle admits only text/br/mention spans); safe flowchart + classDef paint = single value-profile-validated `<style>` identical at both sinks; safe sequence diagram at both sinks; `classDef x fill:url(https://evil/x)` rejected at parse time with body cleanup (upgrade regression guard); flowchart htmlLabels/click/javascript: links hold the oracle at both identical sinks with no body/head residue; sequence link/links javascript: + script/img labels; `securityLevel:loose` directive cannot relax strict; parser-error pass-through does not bypass DOMPurify; 12 admitted inputTypes not prevented; non-shift Enter submits; undo/redo round-trips the serialized value.
- guest-policy (5): webview carries no preload/webpreferences/nodeintegration/allowpopups/disablewebsecurity; remote URL blocked with the shared-grammar reason; no `setPermission*Handler` on defaultSession/`persist:main`; `redactRuntimePayload` recognises the fixture secrets (`secret-text` rule); `claimChat` acquire/idempotent/other-owner denial/stale cleanup.
- preview-broker (7): terminal symlink root refused; `path.resolve()` is not canonicalization (symlinked-prefix refused; realpath-canonical root anchors with matching lstat dev/ino); identity drift after anchoring fails closed; symlinked asset dir outside the root refused; parent/empty/dot/absolute/multi-component child names rejected with a single-component control; win32 refusal (override verified effective and restored); `/proc/self/fd` and `/dev/fd` anchors exist only in stable-directory.ts.

## 6. Uncovered and GUI-track assignments

GUI 5.1 (development Electron, content matrix): real-browser rich paste/drop rejection, native execCommand/undo/redo, IME composition sequences; transient Mermaid mount/CSS/layout/network effects and cleanup timing; dark-theme Mermaid positive control (needs a ThemeProvider/matchMedia harness); real-browser CSP enforcement; HTTPS markdown image-beacon residual (record separately); proof of the `@pierre/diffs` development pre-bundle `resolveId` binding.
GUI 5.2 / 5.3 (guest matrix, development then packaged): every runtime observation listed in verification.md's GP-01…GP-10 right-hand column (first-request order, bridge/Node-global absence and zero registered preloads, per-hop/file:/cross-port cancellation, custom-scheme gate observability, cross-file read/execution results, main-alone close/isDestroyed, no revival without fresh admission, prompt/download/OS-handler/mcp-import absence, two-partition isolation, stale-result rejection, auth/gateway 400/401/404 residual). 5.3 packaged additionally: production alias binding; Windows record of file preview disabled.
5.4 / 5.5: TICKET-114 packaged-production and development-HMR CSP tracks (construction is unit-tested; `object-src`/`base-uri`/`frame-src` not asserted because D10 did not adopt them).

Uncovered in unit scope because the package names no export identifier (double-driven verdicts, implementer task 4.8 — GP-01…GP-09): effective web-preference decision; opaque one-shot admission registry (consume/TTL/caps/replay/cross-embedder, per-mount generation incl. StrictMode); preview-admission IPC/preload op (sender-derived embedder, `resolveRegisteredChatWorktreeRoot`, caller-authority rejection, preload projection narrowness); request-gate verdicts (exact origin incl. port; initial/link/location/loadURL/back-forward/redirect hops; file: per resource type; locus-preview host/document/scope; HTTP(S)-Session scheme rejection); Session-gate-before-return ordering with first-response download / early permission; committed-URL postconditions (about:blank inherited, same-origin blob, data:/javascript:/cross-origin blob destroy); navigation/popup/external-scheme denial verdicts and no `mcp-import:preview` push; permission/device/display/download deny verdicts with rejecting callbacks; teardown state machine; locus-preview broker binding (per-admission random host, frozen declared scope, fresh admission per top-level document, worktree-root-directory consequence); broker-level canonicalize-then-anchor re-verification, descriptor race, special-file rejection, same-descriptor streaming; win32 bounded workbench explanation; diagnostics projection details (level mapping incl. `log` fallback, URL credential/query/fragment stripping, field minimization, count/length bounds, exact-secret hints, stale rejection, `userGesture:false`, capturePage identity/type/dimension/byte bounds).
Other unit-scope gaps: Streamdown wrapper module path/export and harden options (only behaviour asserted); `ReviewedRendererHtml` brand (only owner existence/exports asserted); the proposed shared helper `tests/helpers/renderer-executable-markup-oracle.ts` (the suites use two independent oracles by design); preload `shell:open-external` and tRPC `external.openExternal` entry points; streaming MermaidBlock placeholder path (`finishedStreamingBlocks` has no reset seam); typed attachment callback positive path (no prop named); markdown→MermaidBlock routing through the Streamdown `code` override; Monaco/xterm (explicit residual, Yellow TICKET-125).

## 7. Quality audit (no P1 remaining)

Verified across all files: no `.only`/`.skip`/`.todo`/`skipIf`; no try/catch swallowing (the broker's `try/finally` only restores `process.platform`; `Promise.allSettled` in the link test deliberately collects openExternalUrl denials and then asserts the shell calls); no invented module/seam names (every named path or identifier is in design/tasks/proposal or is an existing export: `renderer-html-policy.ts`, `local-browser-guest-policy.ts`, `local-browser-diagnostics-policy.ts`, `PIERRE_DIFFS_THEME_CSS`, `defaultRehypePlugins` (real Streamdown export), `claimChat`, `redactRuntimePayload`, `normalizeLocalBrowserUrl`, stable-directory exports, `mermaid.mermaidAPI.getSiteConfig`, `secret-redaction-policy.ts` (real shared module)); entry points are the observable app mounts named in design; Scenario parameters (`isStreaming`, options, theme, chatId/worktreePath) are passed explicitly except MermaidBlock's `isStreaming` (defaults false; P3); no cross-file process-wide state under `bun run test` (`--isolate`); every RED reason is a real behaviour gap on 45f6e54c (verified against source and failure output, §4).

Environment assumptions verified on this host: `innerText` write on `<style>` yields Text/`br` alternation with `textContent` = wrapper minus line breaks (D2 rule); stock happy-dom 20.10.6 `Node.prototype.nodeName` getter returns `''`; stock DOMPurify 3.4.11 over happy-dom removes every SVG child element (and in some inputs the root); stock parser swallows siblings after an SVG `<style>`; the mermaid default export is a mutable singleton shared with MermaidBlock's lazy import; React DOM's synthetic `onBeforeInput` is not driven by native `beforeinput` and carries no `inputType` (the fixture correctly dispatches native `InputEvent("beforeinput")`; the implementer needs a native listener).

Findings:
- P2 — guest-policy Invariant-7/D6 behavioural tests loop over every mounted `<webview>`; if the implemented workbench mounts the guest only after a main admission (preload op), these tests pass vacuously with zero webviews. Implementer must add the admitted-mount harness seam and the tests should then assert `webviews().length > 0` before dispatching. Not a RED-suite defect (RED reasons are real on the baseline).
- P2 — existing `tests/renderer-mermaid-xss.test.ts` (neighbour, not an author file) passes under stock happy-dom only because DOMPurify strips every child element (`<svg …>\n</svg>` remains); its negative assertions do not exercise the configured `FORBID_TAGS`/`FORBID_ATTR` rules. The new suite's shimmed environment self-check is the meaningful proof; task 2.9's "beyond the existing literal-SVG sanitizer test" should record this.
- P3 — react-scan removal (content test 2) encodes the recommended default whose Owner acknowledgement is pending; retarget if the Owner declines.
- P3 — content "no caller-local HTML escaping literal" is a character-reference heuristic; a future legitimate literal in src/renderer would false-fail.
- P3 — content wrapper rule requires literal `rehypePlugins`/`remarkPlugins`/`components` JSX attributes (a spread would false-fail); `EXPECTED_INVENTORY` is keyed by enclosing symbol names (renames need an intentional update).
- P3 — content scanner: `html-inline-script` has no negative fixture (16 of 17 classes); producer-import binding uses `.some()` over {renderer-html-policy, shiki-theme-loader} so it does not require the new owner import.
- P3 — content relative-URL rule: the markdown profile admits no relative links at all (resolves against the packaged `file:` document); an implementation must strip or rewrite them to an explicit HTTP(S) base — consistent with D2 "fail closed", but the RSB oracle text also allows "reviewed relative links resolved against the trusted base" by profile; coordinator should confirm the markdown profile has no trusted base.
- P3 — mermaid-editor directive tests require a successful render whose paint equals the control (D3's primary secure-list path); a fail-closed no-render implementation would fail them. classDef/style tests accept a fail-closed empty sink (mitigated by positive controls). MermaidBlock `isStreaming` not passed explicitly. Undo/redo markup tests additionally require the attacker text to survive as text (lossless reading); round-trip tests assert identity rather than an undefined `normalize`.
- P3 — guest-policy `web-contents-created` exact-count-1 and `key={currentUrl}` literal checks are narrow string guards; preview-broker `.isFile()` literal presence likewise. Forbidding `secret-redaction-policy` in the shared adapter is the strict reading of "not a second redaction owner".
- P3 — all Q9/diff evidence is green-by-design (bun.lock already resolves the pins); the lockfile assertion + alias/worker/unsafeCSS rules are the upgrade gate, no package.json pin is required by D10.
- P3 — the happy-dom prototype shims and `mock.module` calls are process-global; safe only under `--isolate` (which `bun run test` uses). Running a single file with plain `bun test` alongside others would leak.

## 8. Reproduction

```
bun test --isolate tests/renderer-hardening-content.test.ts                    # 73 pass / 11 fail
bun test --isolate tests/renderer-hardening-content-markdown-boundary.test.ts  # 0 / 2
bun test --isolate tests/renderer-hardening-content-shiki.test.ts              # 8 / 12
bun test --isolate tests/renderer-hardening-content-diff.test.ts               # 12 / 0
bun test --isolate tests/renderer-hardening-mermaid-editor.test.ts             # 24 / 48 (3/3 runs post-fix)
bun test --isolate tests/renderer-hardening-guest-policy.test.ts               # 5 / 26
bun test --isolate tests/renderer-hardening-preview-broker.test.ts             # 7 / 5
```
