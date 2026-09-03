# Verification: add-renderer-untrusted-content-hardening

> Status: **DRAFT — PROPOSAL VALIDATION ONLY**. Product implementation is not
> authorized and has not been run. Nothing in this file is an
> `IMPLEMENTATION_VERIFIED`, `REVIEW_APPROVED`, Owner `APPROVED`, or Owner
> `ACCEPTED` verdict.

## Draft Baseline

- Draft date: 2026-09-04 (Pacific/Auckland).
- Product/document baseline: local `main`
  `30c72ad3c26dd952410c6e38678faf43d8c55895` (the only delta from the audited
  product source was an `openspec/STATUS.md` push-receipt line).
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

Existing retained evidence also includes focused Mermaid sanitizer and tool
subtitle tests. The source inventory test is file-level only, and there is no
direct Streamdown malicious-HTML, Shiki fallback-shape, mentions undo/redo, or
guest Electron behavior test.

## Draft-Package Validation Receipt

The following commands validate proposal structure only and do not authorize
implementation:

| Command | Result |
| --- | --- |
| `/home/chen/projects/agent-code-for-me/node_modules/.bin/openspec validate add-renderer-untrusted-content-hardening --strict --no-interactive` | PASS — target valid |
| `/home/chen/projects/agent-code-for-me/node_modules/.bin/openspec show add-renderer-untrusted-content-hardening --json --deltas-only` | PASS — 3 deltas: `local-browser-workbench` MODIFIED (5 scenarios), `runtime-security-baseline` MODIFIED (8) + ADDED (10) |
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

## Draft Review Receipt

Three independent read-only drafting lenses reviewed the post-fix package. The
labels below approve proposal quality only; none is an implementation verdict:

- Security: **APPROVED-for-Draft**, no remaining P0/P1/P2. It specifically
  rechecked programmatic navigation, file TOCTOU, diagnostics redaction,
  network residuals, admission/lifecycle, effective preferences/permissions,
  and A/B/1c ownership.
- OpenSpec consistency: **APPROVED-for-Draft**, no remaining finding. It
  confirmed all old MODIFIED scenarios remain, all three deltas parse, the
  unsupported-platform file branch has living ownership, and development plus
  packaged GUI matrices match.
- Feasibility: **APPROVED-for-Draft**, no remaining finding. It rechecked
  Electron event/selector contracts, single-guest admission timing, the
  lossless mentions model, direct dependency ownership, and extension of the
  existing descriptor owner without an immutable-snapshot overclaim.

All 44 implementation/closeout task checkboxes remain open.

## Implementation Evidence Matrix (Not Run / Not Authorized)

| Evidence | Required future receipt | Draft state |
| --- | --- | --- |
| Exact renderer sink/source guard | Rebaselined insertion inventory, negative scanner fixtures, named producer/test for every sink | NOT RUN |
| Streamdown | Static + streaming hostile matrix and safe-format controls through the actual app wrapper | NOT RUN |
| Shiki | Hostile inputs plus forced exception/output-shape mismatch through all raw consumers | NOT RUN |
| Mentions | Lossless text/atomic-mention runs, exact spacing/selection, component-owned mixed/HTML-only paste denial, undo/redo, and no value-bearing HTML restore | NOT RUN |
| Mermaid/subtitle/CSP | Existing adversarial suites retained; inline/fullscreen Mermaid behavior and CSP assertions re-run | NOT RUN |
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
- Draft feasibility lens: APPROVED-for-Draft; not implementation approval.
- Independent fresh-context R3 drafting security lens: APPROVED-for-Draft; not
  implementation `REVIEW_APPROVED`.
- Owner `APPROVED` to implement: **PENDING — implementation prohibited**.
- Codex `IMPLEMENTATION_VERIFIED`: NOT APPLICABLE / NOT RUN.
- Independent implementation `REVIEW_APPROVED`: NOT APPLICABLE / NOT RUN.
- Owner `ACCEPTED`: NOT APPLICABLE / NOT REQUESTED.
- Archive: prohibited before implementation verification, independent review,
  GUI evidence, and Owner `ACCEPTED`.
- Remote operations: none authorized; no push or remote mutation performed.
