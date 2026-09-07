# Verification: add-renderer-untrusted-content-hardening

> Status: **APPROVED (eight defaults) — pre-implementation touch-up**.
> Owner direction/implementation approval was given late 2026-09-05, conditional
> on tasks 0.2/0.3/0.4/0.5. Feasibility 0.2 is `REVIEW_APPROVED` at `2292d36a`;
> R3 0.3 remains `CHANGES_REQUESTED`. Approval Question 9 is **PENDING Owner
> decision (morning 2026-09-06)**. This file records historical exact-SHA review
> receipts and documentation checks, not an implementation verification,
> fresh approval of revised text, or Owner acceptance. No source edits run.

## Draft Baseline

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
| Shiki | Hostile inputs plus forced exception/output-shape mismatch through inventoried raw consumers; chat-local escape fallback disposition | NOT RUN |
| Dependency-internal producers | Q9-selected @pierre/diffs through the Locus shim/Vite alias, file-viewer/PTY coverage or explicit residual, exact pins/upgrade gate and Yellow ticket | PENDING Owner decision; NOT RUN |
| Mentions | Lossless text/atomic-mention runs, exact spacing/selection, component-owned mixed/HTML-only paste/drop and beforeinput rejection, synthetic defaultPrevented/DOM oracle plus separate real-browser undo/redo, and no value-bearing HTML restore | NOT RUN |
| Mermaid/subtitle/CSP | Pinned MermaidBlock end-to-end flowchart/sequence, CSS payloads, transient body cleanup, identical inline/fullscreen reviewed SVG; retained subtitle and CSP construction/GUI evidence | NOT RUN |
| Guest unit/integration | Exact attach preferences, bridge globals, Session-gated initial/link/location/`loadURL`/back/forward/redirect, direct-file denial and descriptor broker, popup, full permission/device/display selectors, download, partitions, teardown/race, redacted diagnostics, documented network residual | NOT RUN |
| Trusted app regression | `persist:main` preload/tRPC and voice/microphone path remain separately governed | NOT RUN |
| Development Electron GUI | Full malicious-content and guest fixture; exact SHA/platform/tool/log/media receipt | NOT RUN |
| Packaged Electron GUI | Same security fixture against packaged artifact; exact SHA/artifact/hash receipt | NOT RUN |
| TICKET-114 production CSP | Separate current-SHA receipt under ticket rules; never historical task 4.4 backfill | NOT RUN; ticket unchecked |
| TICKET-114 development CSP/HMR | Separate current-SHA receipt under ticket rules; never historical task 4.5 backfill | NOT RUN; ticket unchecked |
| Full quality gate | Targeted suites, architecture, TypeScript, strict OpenSpec, build, diff, `check:full` on one frozen implementation SHA | NOT RUN |

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
  task 0.3 stays open for final targeted re-review after the Q9 decision.
- Approval Question 9: **PENDING Owner decision (morning 2026-09-06)**;
  coordination recommendation recorded, no coverage option selected.
- Tasks 0.4/0.5: NOT COMPLETE; no rebase in this docs-only dispatch, and current
  strict validation is not the final exact-package confirmation.
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

- Question 9 remains **PENDING Owner decision (morning 2026-09-06)**. The
  coordination recommendation is pierre via the owned shim under (a), with
  Monaco/xterm residual under (b); no option has been selected by an AI.
- The user restricted writes to this change directory and `openspec/STATUS.md`
  while also mentioning a new `docs/tickets/TICKET-1xx`. This turn records the
  Yellow follow-up in task 2.11, with tentative next number **TICKET-123**
  (current sequence ends at TICKET-122), and defers the actual out-of-scope file
  until the Question 9 decision and authorized ticket creation. Recheck the
  sequence before allocating; no nonexistent ticket is presented as created.
- Finding 1's instruction to wait before recording any Owner approval is
  superseded by the dispatch's explicit instruction to record the already
  granted eight-default approval now. Question 9 and exact-package gates remain
  open, so the record does not imply approval of dependency scope.
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

### Targeted re-review follow-up disposition — 2026-09-07

All eight rows are documentation fixes against `04193a4b`, not implemented
controls or fresh review verdicts. Approval Question 9 and all three
post-approval Owner acknowledgements remain **PENDING**; task 0.3 remains
unchecked for the final targeted re-review after the Q9 decision. Only tasks
0.1/0.2 are checked (2/46). No rebase or task 0.5 confirmation occurs here.

| Finding | Disposition | Modified sections / result |
| --- | --- | --- |
| P2 #1 | Applied | `design.md` D2/D3, runtime delta oracle/Mermaid Scenario, task 2.9: preserve existing pinned `secure` entries and add all six style/label keys before render; retain only the single Mermaid-generated paint `<style>` validated against the diagram-id CSS value profile with a positive control; otherwise fail closed. Keep themeCSS/overlay/url/@import/stray-style fixtures. |
| P2 #2 | Applied | Context/Q9/D10, conditional diff Scenario and task 2.10: verify mixed Shiki 3.21.0/3.22.0 resolution against `bun.lock:476,618,620,628,1360,1978,2300,2328,2330`; name un-aliased `hast-util-to-html@9.0.5` as the production-bundle load-bearing escaper in the exact-pin/upgrade gate; correct exported `codeToHtml` versus private `escapeHtml`; require four-specifier fixture binding and text-node-shape assertion, and implementation proof of currently unverified development pre-bundling. Q9 selects nothing. |
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
