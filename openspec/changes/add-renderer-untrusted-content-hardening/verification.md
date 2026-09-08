# Verification: add-renderer-untrusted-content-hardening

> Status: **APPROVED (eight defaults + Q9 compromise); exact-package R3 CHANGES_REQUESTED at 95831ab6, workflow wf_165bd6a0-1b5 (2026-09-08). Fixes at fad8959c; Owner decided 2026-09-08: option (a); task 0.5 re-confirmation, then same-SHA targeted R3 (0.3) pending before source edit**.
> Historical confirmation: **confirmed content 0c805564, recording commit 95831ab6; re-confirmation required after this revision**.
> Owner direction/implementation approval was given late 2026-09-05, conditional
> on tasks 0.2/0.3/0.4/0.5. Feasibility 0.2 is `REVIEW_APPROVED` at `2292d36a`;
> R3 targeted re-review is `REVIEW_APPROVED` for `96ca3afe` only; task 0.3
> remains open for the revised exact package. Approval Question 9:
> **Owner APPROVED the compromise, 2026-09-07**. Three post-approval disclosures
> presented 2026-09-07; acknowledgement pending. This file records exact-SHA review
> receipts and documentation checks, not an implementation verification,
> fresh approval of revised text, or Owner acceptance. No source edits run.

## Draft Baseline

Current baseline after task 0.4: local `main`
`9cff32daa89f4431be37cf307897b97ec48cda77` (2026-09-07). The original draft
and 2026-09-05 audit below are historical; the completed rebase and current
strict results are recorded in the 0.4/0.5 receipt at the end of this file.

- Draft date: 2026-09-04 (Pacific/Auckland).
- Product/document baseline: local `main`
  `30c72ad3c26dd952410c6e38678faf43d8c55895` (the only delta from the audited
  product source was an `openspec/STATUS.md` push-receipt line).
- Baseline update checked 2026-09-05: local `main` is
  `d923119c090ef8a252ef084bb1453b4b937d563d`; `30c72ad3..d923119c` changes only
  tests/documentation. The cited product anchors remain current, while task
  0.4 still requires implementation-start rebase and re-anchoring.
- Draft branch: `codex/add-renderer-untrusted-content-hardening`.
- Draft worktree:
  `/home/chen/projects/locus-add-renderer-untrusted-content-hardening-draft`.
- Before scaffolding: active OpenSpec changes `0`; living specs strict
  `52 passed / 0 failed / 52 total`.
- Scope: proposal/spec/task/verification/ledger documentation only. No product
  source, dependency manifest, lockfile, generated artifact, database, remote,
  or repository rule is changed by this Draft.

## Archived Routing Accepted Here

The archived parent routes each unfinished item once:

| Parent item | Destination in this Draft |
| --- | --- |
| Original 2.2 remaining untrusted-content sink sanitization/sandboxing | Exact renderer sink inventory, Streamdown/Shiki behavior, structured mentions restore, and retained adversarial tests. |
| Original 2.3 webview/local-browser hardening | Main-owned guest admission, preload/bridge isolation, navigation/redirect, permission, popup, download, partition, diagnostic, and lifecycle policy. |
| Original 2.4 renderer desktop smoke | Exact-SHA development and packaged malicious-content/guest fixture with retained receipt. |
| Removed R6 `Previewed web page attempts bridge access` scenario | New living-target requirement `Local Browser Webview Guests Stay Outside Privileged App Bridges`. |
| Rebaseline R6 sanitizer disclosure | Static and streaming Streamdown malicious-HTML/executable-URL regression gate. |

Follow-up B keeps tRPC capability metadata/wrappers, consent, audit,
kill-switches, terminal input, and dangerous-router allowlist evolution. No item
is certified complete merely because it has been routed here.

## Current-Main Corrections To The 2026-08-26 Handoff

These corrections are design inputs, not implementation evidence:

1. The Local Browser already has renderer-side local URL validation/rollback at
   `src/renderer/features/agents/ui/local-browser-workbench.tsx:157-213` and a
   non-persistent chat-derived partition at `:89-92,449-464`. The gap is
   main-owned guest enforcement, uniqueness, and lifecycle, not total absence
   of navigation or partition behavior.
2. The privileged app window already has CSP and main-frame navigation,
   redirect, and window-open handlers at `src/main/windows/main.ts:482-487` and
   `:573-607`. Those handlers and the main-frame CSP do not cover a webview
   guest.
3. Current exports are JSON/Markdown/plain text; there is no chat HTML-export
   preview to harden. This Draft does not invent one.
4. `package.json` declares `streamdown: ^2.0.1`; `bun.lock` currently resolves
   Streamdown 2.1.0 with `rehype-raw`, `rehype-sanitize`, and `rehype-harden`.
   The top-level dependency is not an exact 2.1.0 pin.
5. `tests/renderer-html-sinks.test.ts` guards five files, not individual
   insertion sites. Current source has six React raw insertions and two
   non-empty direct `.innerHTML` writes in mentions undo/redo.
6. DOMPurify is an exact repository override, but the current dedicated
   sanitizer owner is Mermaid SVG; Shiki consumers are generated-markup paths,
   not DOMPurify-sanitized paths.
7. Normal paste callers request plain text, and mentions undo state originates
   from the editor's own DOM. The two direct restores are unreviewed sinks, but
   this audit did not prove a current exploit. The current paste helper calls
   `preventDefault()` only for images or non-empty `text/plain`; HTML-only input
   therefore retains the browser's default contentEditable insertion path.
8. The repository has no app-owned `will-attach-webview`,
   `did-attach-webview`, guest window-open/navigation/redirect,
   `setPermissionCheckHandler`, `setPermissionRequestHandler`, device/display
   handler, or guest download policy. Handler absence is a coverage/policy gap;
   it is not evidence that Electron granted a specific permission in practice.
9. The privileged app window's `sandbox: false` is retained for electron-trpc.
   Guest sandboxing is a separate effective-web-preferences boundary.
10. Historical local-browser and capability-rebaseline smoke statements have no
    exact-SHA guest-security receipt. TICKET-114's packaged-production and
    development-CSP/HMR entries remain unchecked.
11. Electron 39.4.0 typings state that `will-navigate` /
    `will-frame-navigate` do not fire for programmatic `loadURL()` or `back()`.
    The future authoritative precommit gate is therefore the unique guest
    Session's preinstalled `webRequest.onBeforeRequest`, not a guest navigation
    event alone.
12. `resolveRealPathWithinRoot()` proves containment only at check time; letting
    Electron later reopen that path would retain a symlink TOCTOU. The Draft now
    denies direct guest `file:` and requires a Session-local protocol to stream
    the same descriptor opened through an extension of the existing
    `stable-directory.ts` anchored no-follow owner, or to disable file preview
    when that primitive is unavailable. This prevents path retargeting outside
    the root but does not claim an immutable snapshot against concurrent writes
    to the same inode.
13. Current diagnostics can include full URL/query/hash, console/source text,
    DOM body text, and selected-element values before optional chat insertion.
    Bounds alone do not prevent secret disclosure; the Draft now requires
    main-before-renderer minimization and secret redaction.
14. A non-`persist:` partition does not imply an Electron Session object is
    destroyed with its webview. The Draft distinguishes registry revocation and
    best-effort storage cleanup from process-lifetime Session residue, keeps deny
    handlers installed, and never reuses a partition.
15. Top-level confinement is not network-egress confinement. Remote and other-
    loopback subresource/fetch/form/WebSocket/frame traffic remains possible and
    requires explicit Owner residual-risk acceptance.

## Draft-Time Read-Only Characterization

At baseline SHA `30c72ad3c26dd952410c6e38678faf43d8c55895`, the
drafting audit inspected the current renderer sinks/producers, Local Browser,
shared URL/report helper, app preload, Electron window creation/wiring,
filesystem root helpers, living specs, archived parent, and TICKET-114.

A focused pre-change characterization run covered:

```text
bun test --isolate \
  tests/local-browser-workbench.test.ts \
  tests/main-window-navigation-guard.test.ts \
  tests/renderer-csp-policy.test.ts
```

Result: **13 passed / 0 failed / 57 expectations**. This proves only the current
pure URL/report helpers, privileged app-window navigation helper, and CSP policy
construction. It does not prove guest attach, permissions, preload/bridge
absence, popup, download, partition lifecycle, real Electron wiring, or any
proposed behavior.

Existing retained evidence also includes a literal-SVG Mermaid sanitizer test
and tool-subtitle tests; it does not execute `mermaid.render()` or the actual
MermaidBlock transient `document.body` mount. Task 2.9 now requires that
end-to-end path and both inline/fullscreen sinks. The source inventory test is file-level only, and there is no
direct Streamdown malicious-HTML, Shiki fallback-shape, mentions undo/redo, or
guest Electron behavior test.

## Draft-Package Validation Receipt

The following commands validate proposal structure only and do not authorize
implementation:

| Command | Result |
| --- | --- |
| `bun x openspec validate add-renderer-untrusted-content-hardening --strict --no-interactive` | PASS — target valid on 2026-09-05 using the repository-pinned dependency through the temporary worktree `node_modules` link |
| `/home/chen/projects/agent-code-for-me/node_modules/.bin/openspec show add-renderer-untrusted-content-hardening --json --deltas-only` | PASS — 4 deltas: `local-browser-workbench` MODIFIED (5 scenarios) + MODIFIED Browser Diagnostics Capture (4), `runtime-security-baseline` MODIFIED (8) + ADDED (10) |
| `/home/chen/projects/agent-code-for-me/node_modules/.bin/openspec validate --specs --strict --no-interactive` | PASS — 52 / 52 living specs |
| `/home/chen/projects/agent-code-for-me/node_modules/.bin/openspec validate --all --strict --no-interactive` | PASS — 53 / 53 change + living specs |
| `bun run check:full` | PASS — docs-only lint, architecture, retired-runtime (1,607 scanned / 10 allowlisted), TypeScript, 1,928 tests / 0 failures / 9,350 expectations across 304 files, OpenSpec 53 / 53, build, and patch-whitespace gate |
| `git diff --check` | PASS |

An initial `bun x openspec` probe resolved a different similarly named package
and returned `could not determine executable to run`; it changed no tracked
file and is not counted as repository validation. All OpenSpec receipts above
use the repository-pinned `@fission-ai/openspec` 1.10.0 binary. The temporary
`node_modules` symlink used to run the isolated worktree gate was removed after
each run.

## Drafting Self-Review

The author applied three read-only drafting lenses to the post-fix package.
These are drafting self-review notes, not independent receipts and not an
implementation verdict:

- Security lens rechecked programmatic navigation, file TOCTOU, diagnostics
  redaction, network residuals, admission/lifecycle, effective preferences/
  permissions, and A/B/1c ownership.
- OpenSpec-consistency lens checked preservation of the old MODIFIED scenarios,
  delta parsing, living ownership for unsupported file-preview platforms, and
  matching development/packaged GUI matrices.
- Feasibility lens checked Electron event/selector contracts, single-guest
  admission timing, the lossless mentions model, direct dependency ownership,
  and extension of the existing descriptor owner without an immutable-snapshot
  overclaim.

At the historical drafting checkpoint all 44 task checkboxes were open. The
2026-09-06 touch-up checks only 0.1/0.2; 0.3/0.4/0.5 and all implementation/
closeout tasks, including new Question 9 tasks 2.10/2.11, remain open.

## Implementation Evidence Matrix (Not Run / Source Edit Still Gated)

| Evidence | Required future receipt | Draft state |
| --- | --- | --- |
| Exact renderer sink/source guard | Rebaselined insertion inventory, negative scanner fixtures, named producer/test for every sink | NOT RUN |
| Streamdown | Static + streaming hostile matrix and safe-format controls through the actual app wrapper | NOT RUN |
| Shiki | Hostile inputs plus forced exception/mismatch/dual-code output through inventoried raw consumers; exactly one fully consumed pre/code wrapper; chat-local escape fallback disposition | NOT RUN |
| Dependency-internal producers | Owner-approved @pierre/diffs coverage through the Locus shim/Vite alias; D2 diff profile with actual Locus options, named unsafeCSS/prerenderedHTML rules, lockfile-assertion pin and worker-activation gate; Monaco/xterm explicit residuals in Yellow TICKET-125 | Q9 compromise APPROVED 2026-09-07; revised exact package awaiting re-confirmation; implementation NOT RUN |
| Mentions | Lossless text/atomic-mention runs, exact spacing/selection, component-owned mixed/HTML-only paste/drop and beforeinput rejection, synthetic defaultPrevented/DOM oracle plus separate real-browser undo/redo, and no value-bearing HTML restore | NOT RUN |
| Mermaid/subtitle/CSP | Pinned MermaidBlock end-to-end flowchart/sequence, CSS payloads, transient body cleanup, identical inline/fullscreen reviewed SVG; retained subtitle and CSP construction/GUI evidence | NOT RUN |
| Guest unit/integration | Exact attach preferences, bridge globals, Session-gated initial/link/location/`loadURL`/back/forward/redirect, direct-file denial and descriptor broker, popup, full permission/device/display selectors, download, partitions, teardown/race, redacted diagnostics, documented network residual | NOT RUN |
| Trusted app regression | `persist:main` preload/tRPC and voice/microphone path remain separately governed | NOT RUN |
| Development Electron GUI | Full malicious-content and guest fixture; exact SHA/platform/tool/log/media receipt | NOT RUN |
| Packaged Electron GUI | Same security fixture against packaged artifact; exact SHA/artifact/hash receipt | NOT RUN |
| TICKET-114 production CSP | Separate current-SHA receipt under ticket rules; never historical task 4.4 backfill | NOT RUN; ticket unchecked |
| TICKET-114 development CSP/HMR | Separate current-SHA receipt under ticket rules; never historical task 4.5 backfill | NOT RUN; ticket unchecked |
| Full quality gate | Targeted suites, architecture, TypeScript, strict OpenSpec, build, diff, `check:full` on one frozen implementation SHA | NOT RUN |

Explicit mapping for every Scenario under the ADDED `Local Browser Webview
Guests Stay Outside Privileged App Bridges` requirement follows. Fixture IDs
are planned retained cases in the future injectable guest-policy suite; all
are **NOT RUN**, not mock or GUI receipts. Task 4.8 owns double-driven decisions,
ordering and state transitions. Runtime observations listed here belong to
5.2/5.3 and cannot be claimed by doubles or registration-only assertions.

| ADDED Scenario | 4.8 injectable fixture / assertion | 5.2 / 5.3 runtime observation |
| --- | --- | --- |
| Renderer attempts an unsafe or unregistered guest attachment | GP-01: global creation-hook/per-window registry, reject unknown embedder/partition mismatch, effective preferences, no preloads, all Session handlers installed before return; early permission/first-response download | Actual first-request order, effective sandbox/bridge absence and no early prompt/download |
| Renderer requests or replays a preview admission | GP-02: acquire-if-unowned, same-owner idempotence, deny other live owner, DB-root checks, one-shot/replay/TTL/caps/StrictMode/remount rejection | Each remount requires fresh generation/admission; no capability leakage |
| Preview JavaScript probes privileged capabilities | GP-03: injected bridge-probe result/IPC spy and preference policy; doubles do not prove runtime global absence | Actual electronTRPC/desktopApi/webUtils/ipcRenderer/require/process absence and zero privileged effect |
| Preview attempts disallowed top-level navigation or redirect | GP-04: origin/document-path/scheme verdicts, HTTP(S)-guest preview-scheme rejection, direct-file resource cases, programmatic/redirect and non-network postconditions | Per-hop network/file cancellation, locus-preview gate observability, non-network inherited origins, main-alone close/isDestroyed and no renderer revival |
| Preview attempts file-root escape | GP-05: anchored filesystem fixture plus injected Session/protocol, canonical identity/no-follow/races/win32 refusal, host/document/declared-scope checks, fetch/XHR/iframe/script decisions | Actual in-scope relative asset read controls, denied out-of-scope/other-host fetch/XHR/iframe-contentDocument/script-src read/execution; file-admission-only handler; unsupported platforms reported honestly |
| Preview attempts to open another window | GP-06: window-open deny and no shell/BrowserWindow/OS/MCP-import dispatch under every external-scheme probe | No new window, OS handler or mcp-import preview push |
| Preview requests permission, capture, or download | GP-07: permission/device/display/selector/download deny verdicts, rejecting callbacks, pre-return order, first-response download and early permission | No device auto-selection/system picker/OS prompt/file write, including early requests |
| Two previews use guest storage | GP-08: unique partitions/caps/revocation/cleanup, close with waitForBeforeUnload unset then isDestroyed check, fail-closed cleanup/replacement races | Storage isolation, main-alone destruction, no renderer-cooperation dependency or reattach without fresh admission; no Session-destroy claim |
| Host captures guest diagnostics | GP-09: closed userGesture:false probes, generation/stale-result rejection, redaction/bounds/level mapping, no raw renderer event listeners; screenshot identity/type/dimension/byte bounds via main capture | Raw values absent from app state/chat/logs/media, bounded capture and stale rejection; Electron element dispatch not claimed suppressed |
| Trusted app requests its existing microphone behavior | GP-10: inject distinct trusted/guest Sessions, assert guest deny handlers never installed on persist:main | Trusted app voice path remains separately governed and functional |

## Future GUI Receipt Requirements

The future receipt must identify the exact frozen implementation SHA, OS and
version, Electron/Bun versions, development and package commands, packaged
artifact identity/hash, malicious fixture identity/hash, and redacted main /
renderer console output. Screenshot or recording files must have stable names
and hashes. Logs and media must contain no provider secret, gateway token,
OAuth credential, repository secret, or unrelated user content.

For every denial case, record both the denied observation and absence of the
app-mediated side effect: no privileged IPC/tRPC call, BrowserWindow, external
application, OS permission prompt, file download, escaped file read, or cross-
partition storage. Include controlled evidence that non-top-level network
egress remains possible so it is not mislabeled as denied. Diagnostic fixtures
must prove URL credentials/query/fragment plus bearer/API-key/JWT/OAuth-like
values are absent from renderer state, chat-ready text, logs, and media. A
single successful track cannot stand in for another track.

## TICKET-114 Linkage

- The packaged-production CSP and development-CSP/HMR tracks remain owned by
  `docs/tickets/TICKET-114-codex-desktop-extraction-gui-smoke.md` and are still
  unchecked at Draft creation.
- This change owns malicious renderer-content and guest-security smoke. It may
  collect those results in the same GUI session, but records them here.
- A TICKET-114 update is allowed only after the corresponding track actually
  runs on the recorded current SHA. It cannot rewrite the archived rebaseline's
  historical no-receipt statements or its verdicts.
- If a GUI-capable host is unavailable, the affected future tasks remain open
  and implementation acceptance is blocked. This Draft does not convert host
  absence into a pass.

## Verdict Ledger

- Draft OpenSpec validation: PASS (proposal structure only).
- Drafting feasibility/security/consistency self-review: completed; not an
  independent receipt and not implementation approval.
- Independent fresh-context Draft review: `REVIEW_APPROVED` on 2026-09-05; not
  implementation `REVIEW_APPROVED` and not Owner approval.
- Owner direction + implementation `APPROVED`: **eight recommended defaults
  accepted late 2026-09-05**, per this dispatch's fact input, conditional on
  tasks 0.2/0.3/0.4/0.5. Source edits remain gated.
- Pre-implementation feasibility 0.2: **REVIEW_APPROVED**, zero P0/P1, exact SHA
  `2292d36a2947325ace8bb982a6e11a581bf4b12f`, workflow `wf_461ff527-9bb`.
- Pre-implementation R3 security 0.3: **CHANGES_REQUESTED**, 1 P1 / 9 P2 / 10 P3,
  same SHA/workflow (historical initial verdict).
- Targeted re-review of touch-ups: **REVIEW_APPROVED**, exact SHA
  `04193a4b7455d4619fce613307e3cafee4267c95`, workflow `wf_d03b4b51-d03`;
  20 fixes: 16 applied / 4 deviated-justified, with 2 P2 / 6 P3 text follow-ups
  addressed in the disposition below. This verdict applies only to that SHA;
  final targeted re-review at `96ca3afe` is also **REVIEW_APPROVED** (receipt
  below). Task 0.3 stays open for the rebased exact package; neither historical
  verdict transfers to a successor SHA.
- Approval Question 9: **Owner APPROVED the compromise, 2026-09-07**;
  three post-approval disclosures presented 2026-09-07; acknowledgement pending.
- Task 0.4: COMPLETE, rebased onto `9cff32da` and anchors rechecked 2026-09-07.
- Exact-package R3 0.3: **CHANGES_REQUESTED** at
  `95831ab6055411b95d308f8042e530f98687ef6b`, workflow `wf_165bd6a0-1b5`,
  2026-09-08, 2 P1 / 9 P2 / 7 P3; successor fixes and targeted R3 pending
  are recorded in the appended ledger, with no approval transfer.
- Task 0.5: **REOPENED**. Historical strict/Owner confirmation on 2026-09-07:
  **confirmed content 0c805564, recording commit 95831ab6; re-confirmation
  required after this revision**. D7 origin: Owner decided 2026-09-08: option (a); the three disclosure acknowledgements remain pending.
  Re-confirm the revised exact package, then obtain same-SHA targeted R3;
  implementation is queued after `add-linked-worktree-admission`.
- Codex `IMPLEMENTATION_VERIFIED`: NOT APPLICABLE / NOT RUN.
- Independent implementation `REVIEW_APPROVED`: NOT APPLICABLE / NOT RUN.
- Owner `ACCEPTED`: NOT APPLICABLE / NOT REQUESTED.
- Archive: prohibited before implementation verification, independent review,
  GUI evidence, and Owner `ACCEPTED`.
- Remote operations: none authorized; no push or remote mutation performed.

## Review Record — 2026-09-05

- Review mode: fresh-context.
- Scope: documentation-only Draft package at branch head before this review
  touch-up; product implementation was not reviewed or authorized.
- Findings: P2 required raw `<webview>` console/load-failure/title/navigation
  events to move behind main-owned post-attach minimization/redaction before
  renderer delivery; P3 required traceable review wording and the advanced-main
  baseline note while retaining task 0.4.
- Disposition: addressed in D9, Security Invariant 7, tasks 4.7/6.3, the
  migration deletion list, the `Browser Diagnostics Capture` MODIFIED delta,
  and this verification ledger.
- Verdict: **REVIEW_APPROVED** (Draft quality only; fresh-context; 2026-09-05).


## Owner Approval And Pre-Implementation Review Receipts — 2026-09-06

- Owner approval: supplied explicitly by the coordinating dispatch; late
  2026-09-05 **APPROVED according to all eight recommended defaults** in
  `design.md`, with 0.2 feasibility, 0.3 fresh R3 security, 0.4 rebase, and
  0.5 strict validation plus exact-package confirmation required before source
  edits. Question 9 was not part of that approval.
- Review source SHA: `2292d36a2947325ace8bb982a6e11a581bf4b12f` (`2292d36a`).
- Workflow: `wf_461ff527-9bb`; reviewers: fresh-context Claude feasibility and
  two R3 lenses, merged by a fresh-context synthesizer, 2026-09-05/06 NZST.
- Canonical source receipt:
  `/home/chen/.claude/projects/-home-chen-projects-agent-code-for-me/f1888632-cd03-49a0-a57d-51704695f29d/handoff/reviews/followup-a-preimpl-review-2292d36a.md`.
- The two sections below reproduce the review's pasteable ledger text with its
  literal escaped newlines/quotes decoded for Markdown. References to approval
  not yet being recorded describe the reviewed SHA; this section records that
  approval now. Historical verdicts do not transfer to the touched-up SHA.

### Feasibility review (0.2)

- Review mode: fresh-context feasibility lens, merged with two R3 security lenses by a fresh-context synthesizer; commit `2292d36a2947325ace8bb982a6e11a581bf4b12f` (worktree HEAD confirmed; branch is documentation-only over `30c72ad3`; strict OpenSpec validation of the change re-run and valid; 44/0 task checkboxes).
- Scope: D1–D10, W7 envelope, and the eight approval defaults (Owner-approved 2026-09-05 per dispatcher; not yet recorded in this ledger).
- Result: every cited product anchor is current at HEAD; every Electron 39.4.0 handler/selector/callback shape named in D5–D9 exists in `electron.d.ts`; Streamdown 2.1.0's `rehypePlugins` prop replaces its default `raw → sanitize({}) → harden(wildcards)` chain, so D2's explicit app-owned chain needs no new package; the mentions safe builder/serializer and the `stable-directory` descriptor owner exist as D4/D7 assume; the existing `mock.module("electron")`/DB/happy-dom test patterns support the D10 unit half. No P0/P1 feasibility defect.
- P2 touch-ups before Owner `APPROVED` is recorded against the exact scope: (a) D6's `getChatOwner` precondition must claim atomically for the sender window — 19 selection paths never claim, so "require match" would falsely deny previews; (b) D7/Q5/Impact/LBW scenario must state that the existing descriptor owner has no win32 backend (file preview ships disabled on Windows, a packaged target) and that registered roots must be realpath-canonicalized before anchoring; (c) the Shiki/HTML producer inventory must name the `@pierre/diffs` shim path and the caller-local `escapeHtml` in `chat-markdown-renderer.tsx` (shared with security finding 1).
- P3 notes: D2 parity characterization (replace-not-merge; defaultSchema is load-bearing), happy-dom cannot exercise `execCommand`/native paste (unit vs GUI 5.1 evidence split), explicit `sandbox` forcing and `did-attach-webview` ordering, runtime proof of `file:`/redirect interception, D9 ownership/wording/level-mapping touch-ups, ledger closure.
- Verdict: **REVIEW_APPROVED** (feasibility, Draft quality; fresh-context; 2026-09-05).

### R3 security review (0.3)

- Review mode: two fresh-context lenses (A: renderer content boundary; B: local-browser guest / Electron boundary) merged by a fresh-context synthesizer who re-verified every single-reviewer P1 in code at `2292d36a`.
- Lens B (guest boundary): no privileged-bridge exposure or exploitable race in D5–D9; Session-gate-before-return ordering, exact forced preference set, deny-all handlers, never-reused partitions, descriptor-anchored broker, and main-before-renderer diagnostics are sound; egress/CSRF residual stated honestly. Zero P0/P1.
- Lens A (renderer content): D1–D4 are fail-closed in intent; no `document.write`/`insertAdjacentHTML`/`outerHTML`/`srcdoc`/`createContextualFragment`/`setHTMLUnsafe`/`eval` sink exists in `src/renderer`. One P1 survives re-verification:
  1. **P1** — The inventory, threat-model controls, D10 matrix, and the "sole Shiki producer"/"centralized" statements (design.md:24,142; proposal.md:35,153-155) omit dependency-internal DOM producers of attacker-controlled content: `@pierre/diffs` 1.0.10 (repository diffs via the Locus-owned Vite-aliased `pierre-diffs-shiki-shim.ts` — a second Shiki-API producer with its own `escapeHtml` — 20 library-internal `.innerHTML =` sites into a Shadow DOM, Shiki ^3 major), Monaco (repository files), and xterm (PTY output). Currently safe by construction (text-node hast, default `toHtml` escaping) but uncovered by any guard, behavior test, upgrade gate, or explicit residual. Fix is text-only: name the class, choose (a) reviewed-producer contract with black-box hostile-diff/file tests and exact pins, or (b) explicit residual with compensating controls; correct the wording; list the caller-local `escapeHtml` branches and the dormant `getAST` adapter for removal/classification. Does not change any approved default.
- P2 (touch-ups; fold in with the P1 revision): (2) D4/2.7/2.8/scenario gate clipboard only while drop/`beforeinput` rich insertion stays host-owned, contradicting D4's own principle — downgraded from lens A's P1 because the scenario WHEN is clipboard-scoped, both (and only) hosts already `preventDefault` drop, and the residual is the non-exploit class D4 already frames; (3) win32/realpath disclosure for Q5 (shared with feasibility); (4) D6 atomic claim and per-element-mount admission (shared); (5) renderer `will-navigate` listener (stores page-controlled URLs into `loadFailures`/report) missing from Invariant 7/D9/4.7/6.3 removal lists; (6) `openExternal` permission / external-scheme top-level navigation only implicitly denied although Locus is a `locus://` protocol client and the Session request gate cannot observe it; (7) Mermaid `themeCSS`/`<style>` CSS injection outside the threat model and fixtures (DOMPurify svg profile keeps `style`); (8) `mermaid.render` transient `document.body` mount precedes the app sanitizer with no end-to-end render test; (9) source guard skips `.js` files and dynamic script/remote `import()` (a remote unpkg loader exists, CSP-only); (10) "no executable form" needs a defined DOM oracle.
- P3: D2 wrapper contract details (drop `allowedProtocols:['*']`, pin `code`/`pre` overrides against Streamdown's dormant Mermaid sink, inventory `openExternalUrl`), Session-level preload proof and `userGesture:false`, non-network scheme handling, loopback-listener enumeration in the residual, remote-image beacon residual and `object-src`/`base-uri`/`frame-src`, Streamdown error-boundary owner for Invariant 3, Mermaid load-bearing-layer statement, ledger closure (Owner APPROVED still PENDING at verification.md:231).
- Verdict: **CHANGES_REQUESTED** (security, Draft quality; fresh-context; 2026-09-05). Re-review of the revised text is required only for finding 1; the P2/P3 items may be verified in the same pass, after which 0.5 strict validation and the Owner's exact-scope `APPROVED` can be recorded.


## Review touch-up ledger

All rows refer to documentation edits against review SHA `2292d36a`, not
implemented controls or a replacement security verdict. Findings 2–20 are
applied for targeted review; finding 1's inventory/wording is corrected, but
its coverage disposition remains pending Question 9. Location names are stable
section/task/scenario anchors in this change package.

| Finding | Modified file / section | Touch-up |
| --- | --- | --- |
| #1 P1 | `design.md` Context, Threat Model, D1/D3/D10, Question 9; `proposal.md` Why/Canonical Owners/Non-Goals; `tasks.md` 1.2/1.3/2.4/2.10/2.11/6.3; runtime delta conditional producer Scenario | Inventory the Vite-aliased pierre shim, library DOM writers, Monaco/xterm, chat-local escape fallback and dormant getAST; correct sole-producer claims and leave coverage/pins/ticket choice explicitly pending Owner. |
| #2 P2 | `design.md` Threat Model/D4; `tasks.md` 2.7/2.8/5.1/6.3; runtime delta mentions Scenario | Extend component-owned default prevention to drop and beforeinput rich insertion, safe-builder plain text, typed callbacks, and DOM-shape fixtures. |
| #3 P2 | `design.md` D7/D10/Q5; `proposal.md` Impact; `tasks.md` 4.2/4.8/5.2/5.3; local-browser delta unavailable-broker Scenario | Disclose win32 file-preview disablement and require realpath, registered/canonical/anchor dev/ino identity checks with fail-closed mismatch. |
| #4 P2 | `design.md` D6; `tasks.md` 3.2/3.4; runtime delta admission Scenario | Atomically claim for the true sender, retain DB-root authorization, and require a new admission on every element mount. |
| #5 P2 | `design.md` Invariant 7/D9/Migration; `tasks.md` 4.7/6.3; local-browser delta remote-navigation/diagnostics Scenarios | Remove raw renderer will-navigate and all page-controlled URL/text listeners; main alone emits minimized blocked-origin diagnostics. |
| #6 P2 | `design.md` Threat Model attacker-must-not list/D7/D8/D10; `tasks.md` 4.4/4.8/5.2; runtime delta popup/permission Scenarios | Explicitly deny guest openExternal and probe current/legacy Locus, mailto, and vscode schemes for zero OS launch or MCP-import push. |
| #7 P2 | `design.md` Threat Model/D3/D10; `tasks.md` 2.9; runtime delta Mermaid Scenario | Model themeCSS/returned-style injection and require overlay, URL-beacon, @import and stray-style fixtures with app-owned CSS control. |
| #8 P2 | `design.md` Threat Model/D3/D10; `tasks.md` 2.9/5.1; runtime delta Mermaid Scenario; this file characterization/matrix | Require pinned MermaidBlock end-to-end rendering, sanitized output, transient body cleanup, and identical inline/fullscreen sink values; old literal-SVG tests are not that proof. |
| #9 P2 | `design.md` D1; `proposal.md` Reviewed renderer-content boundary; `tasks.md` 1.2/6.3; runtime delta sink-guard Scenario | Scan renderer public JS/JSX/MJS/CJS and dynamic script/remote import classes; remove the remote react-scan loader. |
| #10 P2 | `design.md` D2; `tasks.md` 2.3/2.8/2.9; runtime delta markdown/Shiki/Mermaid/mentions Scenarios | Define and reuse a rendered-DOM element/attribute/URL executable-markup oracle with positive safe-format controls. |
| #11 P3 | `design.md` D1/D2; `proposal.md` Canonical Owners; `tasks.md` 1.3/2.2/2.3; runtime delta markdown Scenarios | Record replace-not-merge chain/defaultSchema/non-wildcard options, remark parity, code/pre overrides, dormant Mermaid assertion and reviewed external-link owner. |
| #12 P3 | `design.md` D4/D10; `tasks.md` 2.8/5.1; this file implementation matrix | Separate synthetic happy-dom defaultPrevented/DOM evidence from live browser paste/drop and undo/redo proof. |
| #13 P3 | `design.md` D5/D9; `tasks.md` 3.5/3.6/3.7/4.7; runtime delta bridge/probe Scenarios | Force guest isolation explicitly, prove pre-return Session timing and empty Session preloads, and run fixed probes without user gesture. |
| #14 P3 | `design.md` D7/D10; `tasks.md` 4.8/5.2/6.3; runtime delta navigation Scenario | Distinguish non-network commits from webRequest coverage; require runtime file/resource/per-hop redirect cancellation and remove renderer loadURL authority. |
| #15 P3 | `design.md` Invariant 7/D9/D10; `proposal.md` Canonical Owners; `tasks.md` 3.1/4.7; both diagnostic deltas | Declare diagnostics a main-redaction composition adapter, register reused owners, map console levels, name selection probe and assert app-state absence without claiming Electron dispatch suppression. |
| #16 P3 | `design.md` Non-Goals/Threat Model/D10/Risks/Q4; `proposal.md` Non-Goals; `tasks.md` 4.8/5.2 | Name Locus loopback listeners and state/Bearer controls, with bounded no-credential probes proving no state change. |
| #17 P3 | `design.md` Threat Model/D10 CSP note; `proposal.md` Non-Goals; runtime delta CSP Scenario | Record privileged-document remote-image beacons separately and assess the optional object-src/base-uri/frame-src tightening without silently changing approved CSP scope. |
| #18 P3 | `design.md` D2; `proposal.md` Canonical Owners; `tasks.md` 2.2/2.3; runtime delta markdown failure Scenario | Assign one app-owned error boundary to both Streamdown mounts and force a plugin throw to prove escaped-text fallback. |
| #19 P3 | `design.md` D1/D3 Mermaid inventory; `proposal.md` renderer-content boundary; `tasks.md` 2.9; runtime delta Mermaid Scenario | Name DOMPurify as load-bearing for returned SVG and the later DOMParser pass as defense in depth. |
| #20 P3 | `proposal.md` status/Approval Gate; `tasks.md` 0.1–0.5/1.2; this file receipts/verdicts; `openspec/STATUS.md` active row | Record eight-default approval and both exact-SHA review receipts, leave R3/rebase/final confirmation open, and keep literal-token scan scope precise. |

## Scope Delta And Recommendation Disposition

- Question 9: **Owner APPROVED the compromise, 2026-09-07**: @pierre/diffs
  via the owned shim under (a), with Monaco/xterm residuals under (b).
- Yellow `TICKET-125` and its README index were registered in `96ca3afe`;
  task 2.11 is complete (0.1/0.2/2.11 checked, 3/46 at that SHA).
  TICKET-124 exists on main; TICKET-123 belongs to
  `add-linked-worktree-admission`. This supersedes the earlier tentative
  TICKET-123 allocation and deferred-creation note.
- Finding 1's instruction to wait before recording any Owner approval was
  superseded by the dispatch's explicit instruction to record the already
  granted eight-default approval. The Q9 compromise is now approved too;
  exact-package confirmation and the three disclosure acknowledgements remain
  open, so product implementation is still gated.
- Finding 3's canonical-path versus registered-path `lstat` comparison is
  clarified: a symlinked parent prefix can resolve to the same directory leaf,
  but a final-component symlink has its own inode and is rejected. Comparing
  a symlink inode with its target cannot prove safe support; identity is also
  rechecked against the anchored descriptor, with mismatch failing closed.
- Finding 14's suggested `about:blank` allowance is narrowed to an initial,
  browser-created empty document inheriting the admission; same-origin blob
  commits require proven equality with the exact admitted origin. Unconditional
  `about:blank` allowance would overstate the eight-default exact-origin
  guarantee. Unknown/other non-admitted commits fail closed.
- Finding 17's three optional CSP directives were considered. This touch-up
  records the image-egress residual and preserves the already approved CSP
  behavior; any added `object-src 'none'`, `base-uri 'none'`, or `frame-src
  'none'` requires parity/guest-separation proof in a separately recorded scope
  decision. The recommendation said “consider”, not “must add”.
- Finding 19's optional parsererror code change is not prescribed here:
  DOMPurify already ran, so the unchanged second-pass input is not an overall
  fail-open path. The required layer/ordering documentation and end-to-end
  evidence are added, with no product-code edit in this turn.

## Documentation Touch-Up Validation — 2026-09-06

- Initial HEAD precondition: **PASS** —
  `2292d36a2947325ace8bb982a6e11a581bf4b12f`, clean worktree.
- Actual branch: `codex/add-renderer-untrusted-content-hardening`; the dispatch
  named a `-draft` suffix, but the required SHA matched. No branch rename,
  checkout, rebase, merge, push, or remote mutation was performed.
- Scope: only this change directory and `openspec/STATUS.md`; no product or
  test code, dependency manifest/lockfile, or ticket file changed.
- Environment: Linux sandbox, Bun 1.3.14 / Node v24.19.0. Temporary worktree
  `node_modules` symlink to `/home/chen/projects/agent-code-for-me/node_modules`
  is used only after both `package.json` and `bun.lock` compare byte-identical;
  it is removed after checks. No dependency update is performed.
- Pre-commit documentation checks after the touch-ups: strict target validation
  **PASS**, exact output `Change 'add-renderer-untrusted-content-hardening' is
  valid`; `git diff --check` **PASS** (no output). OpenSpec lists **2/46 tasks**
  complete (only 0.1/0.2), with all source/re-review gates still open.
- Pre-commit regression run against unchanged product/test source at base
  `2292d36a`: `bun run check:full` **exit 1**, after docs lint, architecture,
  retired-runtime and TypeScript passed. Tests: **1,925 pass / 3 fail / 9,338
  expectations / 304 files**. All three failures are in
  `tests/codex-app-server-adapter.test.ts`, from
  `CodexAppServerShellSnapshotScrubError` (pre-start, two filesystem errors)
  while accessing the read-only sandbox path `/home/chen/.codex/shell_snapshots`
  (`EROFS`). No node-pty failure was observed. The aggregate stopped at tests;
  its later OpenSpec/build/diff stages did not run, so this is not a full pass.
- Required fallback `bun test --isolate tests`: **exit 1**, same **1,925 pass /
  3 fail / 9,338 expectations / 304 files**, with the same three sandbox
  shell-snapshot failures. No environment bypass or source/test fix was made.
- Pre-commit logs (local temporary artifacts; retained for this handoff, subject
  to host `/tmp` cleanup; full log text is not committed):
  `/tmp/followup-a-check-full-precheck.log`, SHA-256
  `87d0c72944cfc708df3718f99553ff2d682a8c11a85beeaa06f85a54c1a91b6f`;
  `/tmp/followup-a-isolated-tests-precheck.log`, SHA-256
  `232742ea0ffecd5d016e0af73e768b3bd9203adf844a065051003e621115cfcc`.
- The single commit containing this receipt freezes the documentation successor
  of `2292d36a`; its exact SHA and post-commit rerun output are returned in the
  dispatch response, without a second evidence commit. This pre-commit record
  does not claim that the revised text has a fresh Claude verdict. Targeted
  P1/P2 review and all implementation/GUI verdicts remain outstanding.

## Targeted Re-review Receipt And Follow-up Disposition

- Canonical receipt: `/home/chen/.claude/projects/-home-chen-projects-agent-code-for-me/f1888632-cd03-49a0-a57d-51704695f29d/handoff/reviews/followup-a-rereview-04193a4b.md`.
- Workflow: `wf_d03b4b51-d03`; Claude fresh-context, read-only, 2026-09-06.
- The following pasteable text is reproduced verbatim. Its findings, remaining
  work, write-scope references, and sequencing recommendation describe reviewed
  SHA `04193a4b7455d4619fce613307e3cafee4267c95`. This later dispatch authorizes
  the eight text fixes before the Q9 decision and the single ticket-README
  sentence; their current disposition follows the historical receipt. No
  verdict or Owner acknowledgement is transferred to the revised SHA.

### Targeted re-review of touch-ups (0.3 continuation) — 2026-09-06

- Review mode: two fresh-context lenses (fix-fidelity; security re-check) merged by a fresh-context synthesizer who re-verified every P2 candidate in code; commit `04193a4b7455d4619fce613307e3cafee4267c95` (`04193a4b`; worktree HEAD confirmed; docs-only successor of `2292d36a`; `src`/`package.json`/`bun.lock`/`tests` byte-identical to `30c72ad3`; strict OpenSpec validation re-run and valid; `git diff --check` clean; 44 open / 2 checked task checkboxes). Read-only; no files edited.
- Fix fidelity: all 20 findings from the `2292d36a` review are traceable in the diff — 16 applied as recommended, 4 deviated with stated, justified reasons (#1 coverage decision deferred to Approval Question 9 per dispatch; #14 `about:blank`/`blob:` narrowed to protect the exact-origin default; #17 optional CSP directives assessed but not mandated; #19 optional parsererror code change not prescribed); none missing. Approval Questions 1–3 and 6–8 are byte-unchanged; Q4/Q5 received additive disclosures only; no approved default is weakened. Approval bookkeeping (proposal status block, tasks 0.1/0.2 receipts, Verdict Ledger, both receipt sections, touch-up ledger, `openspec/STATUS.md` row) is recorded as instructed; the cited precheck log SHA-256s re-hash correctly.
- P1 disposition: framed as Approval Question 9 with options (a)/(b) and the coordinator compromise, **PENDING**, selecting nothing; provisional `TICKET-123` sequencing verified (TICKET-122 current on branch and main).
- Remaining (text-only; fold into the Q9 decision record before task 0.4): **P2** Mermaid `<style>` rule — D3/spec forbid every returned `style` element, but mermaid 11.16.0 `render()` always inserts the diagram base stylesheet as the SVG's first-child `<style>` (`mermaid.esm.mjs:1685-1688`) and `themeCSS`/`themeVariables`/`theme` are not in Mermaid's default `secure` list; D2/spec.md:31 already describe a retain-under-profile model — reconcile to one rule (add the theme keys to `secure` pre-render; retain the single value-profile-validated paint element, or strip it and name the app CSS source). **P2** Q9 pin/fixture precision — '(locked 3.21.0)' is actually shiki 3.21.0 nested + @shikijs/core/engine-javascript 3.21.0 hoisted + @shikijs/transformers 3.22.0 with nested core/types 3.22.0; only the four Shiki specifiers are aliased, so the live bundle escaper is un-aliased `hast-util-to-html@9.0.5` (unnamed in the pin gate); a `bun test` `<FileDiff>`/`<PatchDiff>` fixture resolves nested real Shiki 3, not the shim, unless it binds the four specifiers and asserts the binding; state the producer binding per runtime (production bundle / development pre-bundle / bun test); `escapeHtml` is private, only `codeToHtml` is re-exported. **P3 ×6**: task 2.2 misstates `rehype-sanitize` as already direct (transitive via streamdown only); three post-approval disclosures (Q4 named loopback listeners, Q5 win32 disablement, react-scan loader removal) should be listed for Owner acknowledgement rather than written as already accepted; ledger rows #3/#6/#14 over-claim one location each (W7 / Invariant 5 / local-browser delta); the conditional Q9 scenario's status prose needs a strip instruction under (a)/compromise; D4 `beforeinput` allowlist precision (`insertParagraph` `<div>` vs the text/br/mention oracle; `deleteContent*`-only blocks markup-free deletions); `docs/tickets/README.md:48` on the branch is stale (outside this dispatch's write scope).
- Verdict: **REVIEW_APPROVED** (targeted re-review, Draft quality; fresh-context; 2026-09-06; 0 P0 / 0 P1 / 2 P2 / 6 P3). Technical verdict for SHA `04193a4b` only; it does not replace Owner product acceptance and does not authorize push, remote PR mutation, merge, release, or repository-rules changes.
- Single remaining approval item: **Approval Question 9 — dependency-internal DOM producer coverage.** 统筹推荐默认值 = 折中 / recommended default = compromise: apply (a) to `@pierre/diffs` — exact-pin the package, its resolved Shiki subtree, and `hast-util-to-html`; one adversarial black-box fixture group through the real shim-backed `<FileDiff>`/`<PatchDiff>` path with the alias bound and asserted; D10 row plus upgrade/source guard — and apply (b) to Monaco/xterm — explicit Threat Model residuals plus Yellow `TICKET-123` (revalidate the sequence before creation in a separately authorized write). Record the Owner's choice, fold the two P2 precision items and the three disclosures into the same text pass, then proceed to task 0.4 rebase and task 0.5 strict validation / exact-package confirmation before any source edit.

### Targeted re-review follow-up disposition — 2026-09-07 (as of `aee1e283`)

Historical snapshot at `aee1e283`, superseded by the Q9 receipt below.
All eight rows are documentation fixes against `04193a4b`, not implemented
controls or fresh review verdicts. Approval Question 9 and all three
post-approval Owner acknowledgements remain **PENDING**; task 0.3 remains
unchecked for the final targeted re-review after the Q9 decision. Only tasks
0.1/0.2 are checked (2/46). No rebase or task 0.5 confirmation occurs here.

| Finding | Disposition | Modified sections / result |
| --- | --- | --- |
| P2 #1 | Applied | `design.md` D2/D3, runtime delta oracle/Mermaid Scenario, task 2.9: preserve existing pinned `secure` entries and add all six style/label keys before render; retain only the single Mermaid-generated paint `<style>` validated against the diagram-id CSS value profile with a positive control; otherwise fail closed. Keep themeCSS/overlay/url/@import/stray-style fixtures. |
| P2 #2 | Applied | Context/Q9/D10, conditional diff Scenario and task 2.10: verify mixed Shiki 3.21.0/3.22.0 resolution against `bun.lock:476,618,620,628,1360,1978,2300,2328,2330`; name un-aliased `hast-util-to-html@9.0.5` as the production-bundle load-bearing escaper in the exact-pin/upgrade gate; correct exported `codeToHtml` versus private `escapeHtml`; require four-specifier fixture binding and text-node-shape assertion, and implementation proof of currently unverified development pre-bundling. As of `aee1e283`, Q9 selects nothing. |
| P3 #3 | Applied | D2/task 2.2: `rehype-sanitize` is baseline transitive-only via Streamdown; add it and every app-imported rehype package as exact direct dependencies before importing `defaultSchema`. No new package enters the tree; a direct exact declaration is still required. |
| P3 #4 | Applied; Owner acknowledgement pending | Add the dated post-approval disclosure section for named Q4 loopback listeners, Q5 win32 file-preview disablement, and recommended react-scan loader removal; align Non-Goals/Risks/Q4/Q5, proposal, tasks and migration wording. These are not retroactive Owner approvals; collect acknowledgements with the Q9 packet before 0.5. |
| P3 #5 | Applied | Correct historical touch-up ledger locations: #3 drops W7; #6 names the Threat Model attacker-must-not list instead of Invariant 5; #14 names only the runtime navigation Scenario. |
| P3 #6 | Applied | Q9/task 2.10: under (a)/compromise strip the conditional Scenario status paragraph and keep only WHEN/THEN/AND bullets before 0.5; under (b) delete the Scenario. The paragraph remains pending the actual decision. |
| P3 #7 | Applied | D4/tasks 2.7–2.8/runtime mentions Scenario: admit all `delete*`; prevent default for paragraph/line-break insertion and use the safe text-node/`br` builder without `div` wrappers; prevent default for canonical historyUndo/Redo and non-admitted types, not ordinary text/IME/deletions. Preserve non-shift Enter submit and unit/GUI evidence separation. |
| P3 #8 | Applied | Change only the sentence for this change in `docs/tickets/README.md` to “eight defaults APPROVED 2026-09-05; source edits gated on 0.3/0.4/0.5 and Approval Question 9”. |

### Documentation validation for this targeted touch-up — 2026-09-07

- Initial HEAD precondition: **PASS**, exact
  `04193a4b7455d4619fce613307e3cafee4267c95`, clean worktree.
- Write scope: this change package and only its existing status sentence in
  `docs/tickets/README.md`. No product/test source, dependency declaration or
  lockfile, living spec, `openspec/STATUS.md`, or new ticket is changed. No
  rebase, merge, push, remote PR, release, or repository-rule operation occurs.
- Strict target validation from the dispatched worktree: **PASS**, exit 0,
  command `/home/chen/projects/agent-code-for-me/node_modules/.bin/openspec
  validate add-renderer-untrusted-content-hardening --strict --no-interactive`;
  exact output: `Change 'add-renderer-untrusted-content-hardening' is valid`.
  `git diff --check`: **PASS**, exit 0, no output. The same documentation gates
  are rerun after the final receipt edit and against the single committed SHA.
- Repository-required `bun run check:full`: **exit 1**, run in the local
  `/tmp/followup-a-rereview-9732qlgs/repo` snapshot of base `04193a4b` plus these
  documentation fixes, before final wording/receipt edits. Product/test source
  remains byte-identical to `04193a4b` in the snapshot and final worktree; this
  is a regression attempt on that unchanged source, not an implementation
  verdict or final-documentation-SHA pass. Linux sandbox, Bun 1.3.14 / Node
  v24.19.0; existing dependencies were linked only inside the temporary snapshot
  after `package.json` and `bun.lock` compared byte-identical to the main
  checkout. No dependency installation or update was performed.
- Lint, architecture, retired-runtime residue (1,607 files / 10 allowlisted),
  and TypeScript stages passed. Tests: **1,925 pass / 3 fail / 9,338
  expectations / 304 files**. The same three
  `tests/codex-app-server-adapter.test.ts` cases identified in the previous
  round fail before startup with `CodexAppServerShellSnapshotScrubError`:
  two `EROFS` errors against `/home/chen/.codex/shell_snapshots`. No product/test
  change or environment bypass was made. The aggregate stopped at tests; its
  subsequent OpenSpec/build/diff stages did not run. The direct documentation
  gates above are separate, passing checks.
- Full regression log: `/tmp/followup-a-rereview-9732qlgs/check-full.log`, SHA-256
  `521f4cdff9f5a816b6b80f8627597c8f165c61781b99b191e1853b3e99b86224`.
  This temporary local artifact is subject to host cleanup.
- Approval Question 9, the three post-approval acknowledgements, and tasks
  0.3/0.4/0.5 remain open. The `wf_d03b4b51-d03` verdict applies only to
  `04193a4b`; no fresh independent verdict for this successor is claimed.
  Product implementation and its targeted/GUI smoke remain unstarted.

### Approval Question 9 decision — 2026-09-07

- Initial HEAD precondition: **PASS**, exact
  `aee1e2835cb4ea03d386e6f49e0271fb31bc83db`, clean worktree.
- Decision source: Owner decision dated **2026-09-07**, supplied by the
  coordination dispatch. Selected **折中方案（统筹推荐默认值） / compromise**:
  (a) for the Locus shim/Vite-aliased `@pierre/diffs` path, (b) for Monaco/xterm.
  This receipt supersedes the Q9-pending state in the historical receipts above;
  it does not change their exact-SHA technical verdicts.
- Rationale: the diff producer includes Locus-owned shim/alias code and the
  load-bearing HAST serializer, so its reviewed-producer behavior and dependency
  drift belong in A. Monaco file-viewer/xterm terminal DOM producers are
  explicit Threat Model residuals and Non-Goals with a separate Yellow scope.
- Applied to proposal/design, D10, tasks 1.3/2.10/2.11 and the runtime delta:
  exact-pin `@pierre/diffs@1.0.10`, its resolved Shiki ^3 subtree (mixed
  3.21.0/3.22.0 as inventoried in Q9), and `hast-util-to-html@9.0.5`; require
  hostile black-box fixtures through the real shim-backed diff renderer with
  all four aliases bound and `createPlainHast` shape asserted; dependency,
  shim and alias changes enter the upgrade gate. These remain implementation
  requirements, not completed product controls. The retained diff Scenario now
  contains only WHEN/THEN/AND bullets, with pending-status prose removed.
- Yellow [TICKET-125](../../../docs/tickets/TICKET-125-monaco-xterm-dom-producers.md)
  and README index registered. Ran the requested `ls` of
  `/home/chen/projects/agent-code-for-me/docs/tickets` and confirmed the checkout
  is on `main`; `git -C /home/chen/projects/agent-code-for-me ls-tree --name-only
  main docs/tickets/TICKET-124-default-branch-guard-cleanup-hermetic-tests.md`
  returned that tracked path. TICKET-123 belongs to
  `add-linked-worktree-admission`; TICKET-124 is the archived default-branch fix.
  Task 2.11 registration is complete; checked tasks are now 0.1/0.2/2.11 (3/46).
- All three post-approval disclosures — Q4 named loopback listeners, Q5 win32
  file-preview disablement, and developer react-scan loader removal — are
  **presented to Owner 2026-09-07 (board §六); acknowledgement pending**.
  The Q9 decision does not acknowledge these disclosures.
- Next gate: **targeted re-review → 0.4 rebase → 0.5 strict/exact-package
  confirmation**; collect all three acknowledgements before 0.5 confirmation.
  Tasks 0.3/0.4/0.5 remain unchecked. No independent verdict for this successor
  SHA is claimed; historical reviews do not transfer to it.
- Documentation gates: **PASS**, exit 0,
  `/home/chen/projects/agent-code-for-me/node_modules/.bin/openspec validate
  add-renderer-untrusted-content-hardening --strict --no-interactive` output:
  `Change 'add-renderer-untrusted-content-hardening' is valid`.
  `git diff --check`: **PASS**, exit 0, no output. These gates are rerun after
  this receipt edit and against the single local commit.
- Repository-required `bun run check:full`: **exit 1**, attempted in this
  worktree. It stopped at lint because
  `node_modules/.bin/biome` is absent (this worktree has no `node_modules`).
  Tests/build were not reached; this is not a full-check pass. Log:
  `/tmp/followup-a-q9-check-full.log` (temporary local artifact).
- Write scope: only this change package, its `openspec/STATUS.md` row,
  `docs/tickets/README.md` index/status and the new TICKET-125. No product code,
  tests, dependency declarations, lockfile or living spec changed. No rebase,
  merge, push or remote mutation; product implementation and GUI smoke remain
  unstarted. The local documentation commit does not close implementation gates.

### Targeted re-review of aee1e283+96ca3afe — 2026-09-07

- Review mode: Claude fresh-context, read-only, 2026-09-07; commits `aee1e2835cb4ea03d386e6f49e0271fb31bc83db` and `96ca3afe8a0bf247946c30349edc5d57fbfe4551` (worktree HEAD confirmed; docs-only successors of `04193a4b`; `src`/`electron.vite.config.ts`/`package.json`/`bun.lock`/`tests` byte-identical to `30c72ad3`; `git diff --check` clean; strict OpenSpec validation exit 0, `openspec list` 3/46). Canonical receipt: `/home/chen/.claude/projects/-home-chen-projects-agent-code-for-me/f1888632-cd03-49a0-a57d-51704695f29d/handoff/reviews/followup-a-rereview-96ca3afe.md`.
- Fix fidelity: all **8** follow-ups from the `04193a4b` re-review are **applied** (2 P2 + 6 P3, none partial or missing). The Mermaid rule is now one consistent rule across the D2 oracle bullet, the D2 Mermaid profile, D3, the spec requirement, the Mermaid Scenario and task 2.9, with the same six `secure` keys in all five places; re-verified feasible in pinned mermaid 11.16.0 (`sanitize` applies to directives only, so the app's own initialize theming survives; `render()` emits exactly one paint `<style>`). Every new `bun.lock`/`electron.vite.config.ts`/shim citation in the Q9 text re-verified exact.
- Q9 fidelity: recorded as **Owner APPROVED the compromise, 2026-09-07** — (a) for `@pierre/diffs` with exact pins on `@pierre/diffs@1.0.10`, the actual mixed Shiki resolution and un-aliased `hast-util-to-html@9.0.5`, four-specifier-bound black-box fixtures and the unconditional D10 row; (b) for Monaco/xterm as explicit residuals in Yellow `TICKET-125` (numbering verified: TICKET-124 on main, TICKET-123 on the admission branch, TICKET-125 nowhere else). Conditional Scenario kept its WHEN/THEN/AND bullets with the status prose stripped; tasks 1.3/2.10/2.11 are unconditional. Q1–Q3 and Q6–Q8 are byte-unchanged; Q4/Q5 changed only to mark their disclosures pending; **no approved default is weakened and none of the three disclosures is acknowledged**.
- Remaining (text-only, fold into the pre-0.4 pass): **P2** `verification.md:3-9` and `:250-251` still record Q9 as "PENDING Owner decision (morning 2026-09-06)", contradicting the Q9 receipt at `:508-533` and `proposal.md`/`STATUS.md`. **P3 ×4**: three further stale spots (`:188` matrix row, `:344-351` Scope Delta with the superseded TICKET-123 text, `:442-451` asserting Q9 PENDING and "2/46"); attacker `classDef`/`style` statements are a second CSS ingress into the retained paint `<style>` that `secure` cannot suppress (`mermaid.esm.mjs:1684` → `:1477-1516` → `:1685-1688`) and need a fixture in D3/task 2.9/the Scenario; `STATUS.md:7` and `design.md:857` date stamps lag their content; 0.4 rebase onto `9cff32da` has exactly one overlapping file (`openspec/STATUS.md`, conflicting "Updated:" line) — `docs/tickets/README.md` is untouched on main so TICKET-125's index rebases cleanly, and no package citation points into any file main changed.
- Verdict: **REVIEW_APPROVED** (targeted re-review, Draft quality; fresh-context; 2026-09-07; 0 P0 / 0 P1 / 1 P2 / 4 P3). Technical verdict for SHA `96ca3afe` only; it does not replace Owner product acceptance and does not authorize push, remote PR mutation, merge, release, or repository-rules changes. Remaining gates unchanged: three post-approval acknowledgements, task 0.4 rebase, task 0.5 strict validation and exact-package confirmation before any source edit.

### Pre-rebase re-review fixes — 2026-09-07

Applied N1–N4 from the `96ca3afe` review: refreshed current Q9 approval,
TICKET-125 and 3/46 bookkeeping; marked the `aee1e283` disposition historical;
named Mermaid `classDef`/`style` CSS ingress and added hostile fixtures to D3,
task 2.9 and the Mermaid Scenario; corrected both date stamps. The verbatim
review receipt above describes `96ca3afe`, before these fixes. N5 is handled
by task 0.4 below; no historical technical verdict transfers to a successor SHA.

### Tasks 0.4 rebase and 0.5 strict gate — 2026-09-07

- Authorized documentation repair commit before rebase:
  `62d14d7eea297fe39443eeda6ca3e38d083f8473`
  (`docs(openspec): apply re-review fixes before rebase`).
- Rebase target: read-only local `main`
  `9cff32daa89f4431be37cf307897b97ec48cda77`; rebased HEAD before this
  bookkeeping commit: `e12860b773e32a811357e098c36f50f39e99d346`.
  The repair commit was rewritten to that rebased HEAD.
- Conflict file list: **only `openspec/STATUS.md`**. Its Updated line
  conflicted while replaying `81cce589` and `04193a4b`; each was resolved to
  `2026-09-07`. Main's complete 2026-09-07 archive and this branch's active row
  were retained. No other file conflicted; no abort condition was encountered.
- Anchor audit: proposal/design/tasks reference 12 distinct source/test/config/
  lock files. Their Git blobs are identical at `30c72ad3`, reviewed `96ca3afe`,
  main `9cff32da`, and rebased HEAD, preserving every cited line and range:
  `chat-markdown-renderer.tsx`, `renderer-html-sinks.test.ts`,
  `shiki-theme-loader.ts`, `pierre-diffs-shiki-shim.ts`,
  `agents-mentions-editor.tsx`, `src/main/windows/main.ts`,
  `local-browser-workbench.tsx`, `registered-roots.ts`, `stable-directory.ts`,
  `use-voice-recording.ts`, `electron.vite.config.ts`, and `bun.lock`.
  No package line citation targets main's changed `src/main/lib/git/branches.ts`,
  `default-branch.ts`, `worktree.ts`, or TICKET-124; ownership-map references
  have no line numbers. **Source-anchor updates: none required.** Proposal's
  top baseline note now names `9cff32da`; task 0.4 is checked.
- 0.5 strict passed at `e12860b773e32a811357e098c36f50f39e99d346`;
  exact package awaiting Owner confirmation. Validation includes the final
  documentation bookkeeping diff; both strict commands and diff check are
  rerun after its commit. This is a documentation gate, not an implementation
  verdict or fresh independent review of the rebased package.
- Validation environment: this worktree has no `node_modules`. Initial bare
  `bun x openspec` exited 1 (`could not determine executable to run for package
  openspec`). Reruns prepend the read-only main checkout's existing
  `node_modules/.bin` to PATH; no dependency declarations or lockfiles change.
- `bun run check:full`: **exit 1**, stops at lint because this worktree's
  `node_modules/.bin/biome` is absent. Tests/build were not reached; no full-gate
  pass is claimed. Log: `/tmp/followup-a-rebase-check-full.log` (ephemeral).
- Checked tasks are 0.1/0.2/0.4/2.11 (**4/46**). Task 0.5 remains unchecked
  for exact-package Owner confirmation and the three pending acknowledgements;
  task 0.3 remains open for the successor package's independent R3 approval.
  Implementation is queued after `add-linked-worktree-admission`. Product code,
  tests, dependencies and living specs remain byte-identical to main `9cff32da`.
  No main mutation, merge, push or other remote action was performed.

Validation commands/results (PATH prepends
`/home/chen/projects/agent-code-for-me/node_modules/.bin`):

```text
$ bun x openspec validate add-renderer-untrusted-content-hardening --strict --no-interactive
Change 'add-renderer-untrusted-content-hardening' is valid
exit 0

$ bun x openspec validate --strict --no-interactive
Nothing to validate. Try one of:
  openspec validate --all
  openspec validate --changes
  openspec validate --specs
  openspec validate <item-name>
Or run in an interactive terminal.
exit 1

$ bun x openspec validate --all --strict --no-interactive
[all 54 change/spec items printed with checkmarks]
Totals: 54 passed, 0 failed (54 items)
exit 0

$ git diff --check
[no output]
exit 0
```

The installed CLI requires explicit `--all` for noninteractive full validation;
the corrected command fulfills the full strict gate, while the original
command's exit 1 above remains recorded. `git diff --check main` also passed.


## Exact-package R3 review and revision ledger — 2026-09-08

- Required starting HEAD: **PASS**, `95831ab6055411b95d308f8042e530f98687ef6b`,
  `git rev-parse --short HEAD` = `95831ab6`; initial worktree clean.
- Workflow: **`wf_165bd6a0-1b5`** (2 opus lenses + fable synthesis).
- Canonical review input:
  `/home/chen/.claude/projects/-home-chen-projects-agent-code-for-me/f1888632-cd03-49a0-a57d-51704695f29d/handoff/reviews/followup-a-r3-exact-package-95831ab6.md`.
- The following receipt is retained verbatim from that input. It describes the
  reviewed SHA, not the revised package or an implementation verdict.

### Fresh-context R3 approval of the exact package (0.3) — 2026-09-08

- Review mode: fresh-context; two security lenses (A: renderer content boundary; B: local-browser guest / Electron boundary) merged by a fresh-context synthesizer who re-verified both P1s in package text and code at the exact SHA. Read-only: no edits, commits, or worktrees; no bun tests run in the draft worktree (no node_modules); code and installed packages read from the draft worktree and the main checkout's node_modules.
- SHA: `95831ab6055411b95d308f8042e530f98687ef6b` (worktree HEAD confirmed; main `9cff32da` is an ancestor; documentation-only vs main, 9 files +3024/−5, and documentation-only vs the Owner-confirmed `0c805564`, 4 files +8/−5). `openspec validate add-renderer-untrusted-content-hardening --strict --no-interactive`: valid.
- Verified at this SHA: exact sink inventory (6 `dangerouslySetInnerHTML` / 5 files, 2 innerHTML restores, 1 dynamic-script loader); all nine bun.lock anchors and the mixed Shiki resolution; four-specifier alias completeness; shim text-node HAST and un-aliased `hast-util-to-html@9.0.5` default escaping; Streamdown 2.1.0 replace-not-merge and dormant Mermaid sink; Mermaid strict/DOMPurify-first and the svg `style` allowance; mentions innerHTML restores and HTML-only paste fall-through; production CSP without unsafe-inline; no existing guest attach/protocol/webRequest policy; every Electron 39.4.0 primitive named in D5–D9 (except a typed `WebContents.destroy()`); win32 descriptor-backend absence; `claimChat` semantics; task 0.4 anchor audit.
- Findings: 0 P0 / 2 P1 / 9 P2 / 7 P3.
  - **P1-1** — Q9(a) diff row cannot pass the shared rendered-DOM oracle as written: no diff profile exists, and the real shim-backed diff DOM contains Locus's own `<style data-unsafe-css>` element (`unsafeCSS: PIERRE_DIFFS_THEME_CSS`, agent-diff-view.tsx:211,814,827 → FileDiff.js:309-318) and `<use href="#diffs-icon-…">` expand icons (hast_utils.js:16-29; createSeparator.js; DiffHunksRenderer.js:86,326-341) that the oracle's `style` and fragment-href rules reject (spec.md:18-32; design.md:282-301 vs spec.md:100-102). Fix: add a strictly enumerated diff profile (one `data-unsafe-css` `<style>` byte-equal to `wrapUnsafeCSS(PIERRE_DIFFS_THEME_CSS)`; `use[href]` matching `^#diffs-icon-[a-z0-9-]+$` in separator subtrees; adopted stylesheet needs no allowance; fixtures use Locus's actual option set) to D2, the D10 diff row, the RSB oracle paragraph and the diff Scenario.
  - **P1-2** — The fixed-origin `locus-preview://preview.local` broker (design.md:539-544; tasks 4.2; RSB/LBW Scenarios) with standard/secure/fetch privileges serving the whole registered worktree grants any previewed file same-origin read of every file under the root, composing with the accepted egress residual (default 4) into worktree exfiltration; a confinement regression versus today's `file://` previews, disclosed nowhere. Fix: decide origin granularity before source edit — per-admission origin (preferred), narrowed served scope, or an explicit Owner-acknowledged disclosure — name the exact `Privileges` flags, add Threat Model/Non-Goals/Risks entries and a cross-file-read fixture in 4.8/5.2.
  - P2 (fold into the re-confirmation round): locus-preview gate treatment and HTTP(S)-Session handler scoping; dependency-prop `unsafeCSS`/`prerenderedHTML` sink class in D1/1.2/1.3; worker-pool activation as a Q9 trigger; named exact-pin mechanism (lockfile assertion; no flat `@shikijs/core` override); typed guest-destroy primitive; pre-return ordering for all Session-scoped deny handlers; main-owned bounded screenshot in 4.7/6.3; injectable guest-policy owner in 3.1; consistent task 0.5 record and confirmed-SHA naming.
  - P3: react-scan loader already CSP-blocked; plugin-controlled UI classification; Shiki `<code>` regex truncation fixture; D6 acquire-if-unowned semantics; per-embedder vs global attach denial and partition validation wording; query/fragment loss in the address bar; 4.8/5.2 observation split.
- Verdict: **CHANGES_REQUESTED** (security, exact-package R3; fresh-context; 2026-09-08; 0 P0 / 2 P1 / 9 P2 / 7 P3). Technical verdict for SHA `95831ab6` only; it does not replace Owner product acceptance and does not authorize push, remote PR mutation, merge, release, or repository-rules changes. The first source edit remains gated: apply the two P1 text fixes (both touch spec deltas: the runtime-security-baseline oracle paragraph and diff Scenario; the preview-broker Scenarios and D7) and the folded P2s, re-run 0.5 strict validation and exact-package confirmation (plus Owner acknowledgement of the preview-origin trade if the disclosure option is chosen), then a same-SHA targeted fresh R3 limited to the two P1 items and the folded P2s. On approval of that successor SHA, the first source edit may begin only after `add-linked-worktree-admission` per the Owner's ordering.
- Freeze-time proof set retained unchanged for the eventual approval: malicious-content matrix (static + streaming markdown), Shiki consumer and shim-backed `<FileDiff>`/`<PatchDiff>` fixtures with all four aliases bound and the diff profile applied, Mermaid inline/fullscreen fixtures, mentions-editor paste/drop/beforeinput/undo/redo fixtures, guest-security matrix in development and packaged tracks (attach preferences, bridge probes, request gate incl. observed `file:` cancellation per position and redirect hop, brokered preview incl. cross-file-read attempt, popup/permission/device/display/download denial, two-partition isolation, teardown races, diagnostics minimization), TICKET-114 development-HMR and packaged-production CSP tracks, `bun run check:full`, strict OpenSpec validation, the 1c ratchet, and same-SHA fresh R3 plus normal implementation review.

### Disposition of all 18 findings

All rows describe documentation revisions only; product controls and fixtures
remain unimplemented/unrun. Row 2 records the recommended draft, **not an Owner
approval**. The eight defaults and Q9 coverage compromise remain in force.

| Finding | Changed section / task / Scenario | Disposition |
| --- | --- | --- |
| #1 P1 | D2/D10; 2.10; runtime oracle/diff Scenario | 已写严格 diff profile：唯一常量 style、限域 use href、adopted stylesheet 非元素；使用实际 Locus options，全 Shadow DOM 仍受全局规则约束。 |
| #2 P1 | D7/Threat Model/Non-Goals/Risks/Q5; proposal Impact; 4.2/4.8/5.2; LBW/RSB file Scenarios | 已起草每 admission 独立 origin 与目录子树资源范围；列明全部 Privileges、范围内读取/egress 后果及跨文件用例；Owner decision pending。 |
| #3 P2 | D7; 4.1/4.2/4.8/5.2; navigation/file Scenarios | 明确 file admitted-origin、其它 scheme fail closed、file-only protocol.handle、HTTP(S) Session 拒绝及真实 gate 可观察性证据。 |
| #4 P2 | D1; 1.2/1.3; raw-markup Scenario | 新增依赖 raw CSS/HTML props 命名规则：unsafeCSS 只能是同一仓库常量，prerenderedHTML 缺席或显式 reviewed binding。 |
| #5 P2 | D10/Q9; 2.10; diff Scenario | 增补五类 worker 入口/挂载/option guard；reviewed producer 限 main-thread context-free，worker activation 需独立决策与评审。 |
| #6 P2 | D10; 2.10; diff Scenario | 指定 bun.lock + frozen-lockfile + 全 anchors 断言为 pin；禁平面 core override，解释历史 pnpm metadata 不作为该机制。 |
| #7 P2 | D5/D6/D7; 3.6/4.1/4.8/5.2; navigation/storage Scenarios | 指定 main close()、不设置 waitForBeforeUnload、isDestroyed 复核与撤销；加入无 renderer 协作销毁和重新 admission 用例。 |
| #8 P2 | D8/D10; 4.4/4.5/4.8/5.2; attachment/permission Scenarios | 全 Session deny handlers 与 gate 同步在 partition 返回前安装；覆盖首响应下载与早期权限检查。 |
| #9 P2 | D9/Migration; 4.7/6.3; LBW capture Scenario | 截图改由 main capturePage，绑定 generation 并在投影前检查 identity/type/dimensions/bytes；删除 renderer fallback。 |
| #10 P2 | 3.1; runtime ADDED requirement; evidence matrix | 指定纯函数、import type 与注入工厂；为全部 10 个 ADDED Scenarios 各列 fixture/runtime 映射。 |
| #11 P2 | 0.3/0.5; proposal/verification status; STATUS | 0.5 重新未勾选；统一 confirmed content 0c805564 / recording commit 95831ab6，明确本轮需重确认并再定向 R3。 |
| #12 P3 | 第三项 disclosure; 1.2 | 说明 react-scan 在两个 CSP-covered modes 已不可用；仅无 ELECTRON_RENDERER_URL 的 dev 路径可加载。 |
| #13 P3 | D1/Threat Model; 1.3; runtime source list | plugin-controlled UI manifests 归为 validator-owned、schema-bounded React text；更丰富 surface 必须重审分类。 |
| #14 P3 | D3; 2.4; highlighted Scenario | 正向验证完整唯一 pre/code wrapper；保留 mismatch 与 dual-code 截断用例。 |
| #15 P3 | D6; 3.2/4.8; admission Scenario | 明确 acquire-if-unowned、同窗幂等、其它活窗拒绝，并覆盖三个状态。 |
| #16 P3 | D5; 3.5; attachment Scenario | 统一全局 web-contents-created hook + per-window registry；partition mismatch 必拒绝，forcing 仅 best effort。 |
| #17 P3 | proposal Impact compatibility | 明确地址栏/diagnostics 不显示 query/fragment，main 保留 reload 目标，无 raw-URL fallback。 |
| #18 P3 | 4.8/5.2/5.3; evidence matrix | 4.8 仅 doubles 顺序/决策；真实请求、读取、销毁和 OS 观察由 5.2/5.3 承担，mock 不得冒充。 |

### Revision gates and source identity

- Task 0.3: **CHANGES_REQUESTED at 95831ab6 → fixes at `<SHA>` → targeted R3
  pending**. `<SHA>` is this document's single revision commit, whose parent
  is `95831ab6055411b95d308f8042e530f98687ef6b` and whose exact subject is
  `docs(openspec): address exact-package R3 review for renderer hardening`.
  A Git commit cannot contain its own final hash; the final handoff supplies
  it. Resolve the immutable revision from this checkout with:
  `git log --format=%H --fixed-strings --grep='docs(openspec): address exact-package R3 review for renderer hardening' -1`.
- Task 0.5 is reopened: **confirmed content 0c805564, recording commit 95831ab6;
  re-confirmation required after this revision**. The new D7 option (a) is
  drafted pending Owner decision, while the three earlier disclosure
  acknowledgements retain their pending status. No confirmation is inferred.
- Next gate: Owner D7 decision + 0.5 revised exact-package confirmation, then
  targeted fresh R3 for that same SHA covering both P1s and folded P2s. Record
  any confirmation-only commit separately from confirmed content. Task 0.4
  remains complete for its recorded baseline and must be rechecked if that
  baseline advances. Implementation stays after `add-linked-worktree-admission`.
- Scope: this change directory and its STATUS row only; zero product/test/
  dependency/living-spec edits. No merge, push or remote operation. No
  implementation/GUI pass or independent review of this successor is claimed.

### Documentation validation — 2026-09-08 revision

Run in the required worktree using the main checkout's existing OpenSpec
binary, without installing or changing dependencies:

```text
$ /home/chen/projects/agent-code-for-me/node_modules/.bin/openspec validate add-renderer-untrusted-content-hardening --strict --no-interactive
Change 'add-renderer-untrusted-content-hardening' is valid
exit 0

$ /home/chen/projects/agent-code-for-me/node_modules/.bin/openspec validate --all --strict --no-interactive
[all 54 change/spec items printed with checkmarks]
Totals: 54 passed, 0 failed (54 items)
exit 0

$ git diff --check
[no output]
exit 0
```

The receipt-inclusive working diff and the single revision commit are checked
with these commands; post-commit whitespace uses `git diff --check HEAD^ HEAD`
to inspect the actual committed revision. The final handoff binds their output
to the resulting full commit SHA; no same-SHA independent review is claimed.

Repository-required `bun run check:full`: **exit 1** at `lint:changed`, because
`node_modules/.bin/biome` is absent from this worktree. Architecture, tests,
TypeScript and build were not reached; this is not a full-check pass. The
direct strict target/all and diff checks above passed independently. No
dependency install or product edit was performed to work around this
environment limitation. Product targeted/manual/GUI tasks remain unrun and
open because this dispatch is documentation-only.

Consistency audit: **PASS**, 18/18 disposition rows, 10/10 ADDED Scenario
fixture mappings, all four required D7/Q5/Impact/LBW Owner-pending markers,
0.3/0.5 unchecked and checked tasks 0.1/0.2/0.4/2.11 (**4/46**). Exactly seven
documentation files differ from `95831ab6`; only this change directory and its
single STATUS row are touched. The eight defaults and Q9 compromise were not
reopened; D7 origin granularity is the newly pending Owner decision.


## Owner preview-origin decision receipt — 2026-09-08 follow-up A

- Authority: Owner decision supplied by coordination dispatch on 2026-09-08.
  Starting HEAD verified as `fad8959c70b4494c21fdcbff41d1bf394d5cf5f8`, clean.
- **Owner decided 2026-09-08: option (a)**. Each admission serves its document
  and declared relative-resource scope (default: document-directory subtree)
  from `locus-preview://<per-admission-random>.preview.local/`.
  Alternatives (b) narrowed subtree on fixed origin and (c) whole-root + fourth
  disclosure are not adopted.
- Owner accepts incomplete previews for pages referencing parent-directory
  resources. Future extension via an explicit resource-scope declaration is
  recorded in proposal Impact as a Yellow compatibility/consumer note, subject
  to D7 validation; no new ticket is opened.
- This receipt supersedes origin-decision-pending statements in the historical
  revision/disposition ledger above; it does not rewrite those historical
  review results or acknowledge the three earlier disclosures.
- Task 0.3: **fixes at fad8959c + Owner origin decision → targeted R3 pending**.
  Task 0.5 remains unchecked pending revised exact-package re-confirmation,
  followed by targeted fresh R3 on that same SHA. The origin decision alone
  is not exact-package confirmation or independent review approval.
- Only this change directory and its STATUS row are edited; no product code,
  merge, push, or remote operations. Implementation remains queued after
  `add-linked-worktree-admission` and the existing gates.

### Decision-record validation

Using `/home/chen/projects/agent-code-for-me/node_modules/.bin/openspec`:

```text
validate add-renderer-untrusted-content-hardening --strict --no-interactive
Change 'add-renderer-untrusted-content-hardening' is valid
exit 0

validate --all --strict --no-interactive
Totals: 54 passed, 0 failed (54 items)
exit 0

git diff --check
[no output]
exit 0
```

`bun run check:full`: exit 1 at `lint:changed`; this worktree lacks
`node_modules/.bin/biome`. Later stages were not reached. No dependency install
or product/manual/GUI verification is claimed. The receipt-inclusive revision
is validated again before the single local commit; the final handoff records
its full SHA, and `git diff --check HEAD^ HEAD` checks the committed diff.


## Targeted R3 ledger and sole-P1 disposition — 2026-09-09 follow-up A

- Review: **CHANGES_REQUESTED (0 P0 / 1 P1)**, exact reviewed SHA
  `e86d341f193c0421a1e3f50a4afe24962eaa8552`, workflow `wf_11f5b099-acd`
  (opus verifier + fable judge). Starting HEAD matched this SHA; worktree clean.
- Receipt: `/home/chen/.claude/projects/-home-chen-projects-agent-code-for-me/f1888632-cd03-49a0-a57d-51704695f29d/handoff/reviews/followup-a-r3-targeted-e86d341f.md`.
- Prior 18 findings: 17 resolved; #1 partially resolved. The sole surviving
  P1 is the diff-profile style clause's raw-wrapper comparison after the
  library writes it through `innerText`.
- Disposition: applied the Recommended fix verbatim at all five locations:
  RSB spec oracle paragraph and diff Scenario, design D2 allowance (a),
  design D10 Q9 row, and task 2.10. Only Text/`br` children are allowed;
  `textContent` is compared with the repository-constant wrapper after removal
  of every line-break code point. The `br` nodes are the write's artefact,
  never a producer-output allowance; one added non-line-break character must
  still fail the negative control.
- **targeted R3 CHANGES_REQUESTED (1 P1) → fix at <SHA> → final judge pending**.
  `<SHA>` denotes the single commit carrying this entry and the five-place fix;
  the final handoff supplies its full SHA. No independent approval is claimed
  for this successor. Tasks 0.3 and 0.5 remain unchecked; exact-package Owner
  re-confirmation and same-SHA final judge remain pending before source edits.
- Scope: this change directory and its single STATUS row only, zero product
  code. No merge, push, remote mutation, or implementation/manual/GUI evidence.

### Sole-P1 documentation validation

Using `/home/chen/projects/agent-code-for-me/node_modules/.bin/openspec`:

```text
validate add-renderer-untrusted-content-hardening --strict --no-interactive
Change 'add-renderer-untrusted-content-hardening' is valid
exit 0

validate --all --strict --no-interactive
Totals: 54 passed, 0 failed (54 items)
exit 0

git diff --check
[no output]
exit 0
```

All five replacement strings were checked directly against the review's
Recommended fix: verbatim PASS (5/5). Receipt-inclusive strict target/all and
diff checks are repeated before the single local commit and bound to its
full SHA in the final handoff; no same-SHA independent approval is claimed.

Repository-required `bun run check:full`: exit 1 at `lint:changed` because
`node_modules/.bin/biome` is missing in this worktree. Later stages were not
reached; this is not a full-check pass. No dependency install or product edits
were performed. Product targeted/manual/GUI checks remain unrun and open.
