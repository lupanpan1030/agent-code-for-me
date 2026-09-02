> 2026-09-02 rebaseline at `d77a4b48`: this change archives only the implemented slices below.
> Checkbox items assert completed work. Descoped or unreceipted work is recorded as ordinary
> routing text and is not made complete by changing a checkbox.

## 0. Proposal Gate

- [x] 0.1 Inspect tRPC context, preload bridge, mounted routers, and the current runtime-security-baseline spec.
- [x] 0.2 Scan all 41 router modules (excluding the index), 33 mounted namespaces, and the mounted git `changes` router; record reviewed privileged-operation clusters and the dangerous-input guard's procedure-keyed field-allowlist boundary.
- [x] 0.3 Write proposal, design, tasks, and runtime-security-baseline delta.
- [x] 0.4 Receive emergency approval for the renderer XSS slice; the broader rollout remained pending.

## 1. Phase 1 - Implemented Input Trust Slices

- [x] 1.1 Add shared main-process owners for registered project roots, chat worktree roots, command/agent/skill roots, terminal workspace cwd, and path containment.
- [x] 1.2 Harden covered `files` routes: reads reject real-path symlink escapes, search skips symlink entries, watch requires a registered root, and rename/delete reject lexical out-of-root, traversal, null-byte, or invalid replacement targets.
- [x] 1.3 Harden project-scoped `commands`, `agents`, and `skills` routes so renderer-supplied project/cwd values must resolve to registered roots.
- [x] 1.4 Make Claude and Codex runtime execution cwd resolve from `chatId`/`subChatId` server-side and reject or ignore forged renderer cwd. The former experimental `agentRuntime.chat` was removed and is not an implemented route claim.
- [x] 1.5 Make terminal `createOrAttach` and `listDirectory` resolve cwd/root from registered workspace or chat state.
- [x] 1.5a Remove raw terminal startup `cwd`/`initialCommands` authority: map only whitelisted `initialCommandIntents` to app-owned commands.
- [x] 1.6 Validate registered project roots for the covered project-scoped Claude MCP/MCP-registry writes and structured command/url/env input without weakening MCP stdio native consent.
- [x] 1.7 Replace shell-string GitHub clone with constrained owner/repository parsing and argv execution using `git clone --`.
- [x] 1.8 Add adversarial coverage for registered-root, traversal, read/list symlink, forged-cwd, terminal-intent, GitHub-clone, MCP/provider, and nested-project boundaries.
- [x] 1.8a Cover forged terminal cwd/scope, legacy raw `initialCommands`, arbitrary strings masquerading as intents, whitelisted `gh auth login`, shell metacharacters, Git option injection, and argv clone execution.
- [x] 1.8b Cover unregistered file search/watch roots, lexical rename/delete targets outside a registered root, and invalid rename replacements.
- [x] 1.9 Add the dangerous-router-input architecture guard for its 12 enumerated schema field names, with a procedure-keyed field allowlist plus self-test/package-chain checks.

## 2. Phase 2 - Implemented Renderer Slices

- [x] 2.1 Remove broad JavaScript `unsafe-eval` and remote script origins from the privileged renderer CSP while retaining the documented WebAssembly exception.
- [x] 2.1a Remove production `script-src 'unsafe-inline'`, externalize boot scripts, install the main-process CSP header, and keep Vite HMR allowances development-only.
- [x] 2.5 Use Streamdown sanitization/hardening for markdown HTML, constrain files containing `dangerouslySetInnerHTML` to the reviewed five-file list, use Mermaid strict mode plus DOMPurify, render tool subtitles as text, and add the retained CSP/XSS/source-guard tests.

## 3. Phase 3 - Implemented MCP Stdio Slice

- [x] 3.3a Require main-process native consent before persisting Claude/Codex/registry stdio command configs, remember normalized command fingerprints, and fail closed when runtime materialization encounters an unapproved stdio command.

## 4. Historical Closeout Evidence

- [x] 4.1 Historical implemented slices ran the then-current `bun run check` gate.
- [x] 4.2 Historical implemented slices passed strict target-change validation.
- [x] 4.3 Historical R0a/R0b/R0c and MCP stdio implementation records exist in `PROJECT-MAP.md`; that shared map is not the refreshed code-anchor authority for this rebaseline.

- Historical statement 4.4: packaged production CSP smoke was marked complete in the old task list, but no receipt exists. It is not rerun or certified by this rebaseline.
- Historical statement 4.5: development CSP/HMR smoke was marked complete in the old task list, but no receipt exists. It is not rerun or certified by this rebaseline.
- Owner-directed destination for both unreceipted smoke checks: add them to the TICKET-114 GUI rerun checklist. During rebaseline drafting and review this shared ticket was not edited; post-archive task 5.6 now routes both still-unreceipted checks there without claiming completion.

## 5. Rebaseline Closeout

- [x] 5.1 Refresh every implementation claim, code anchor, line reference, targeted-test inventory, and OpenSpec aggregate against `d77a4b48`; narrow the delta/proposal/design/tasks to current implementation truth and add `verification.md`.
- [x] 5.2 Create frozen docs-only source `f89c7ee4a104c79d4c362972be8cac9c982dbc68`; on that exact SHA run the expanded 18-file targeted suite, `bun run architecture:check`, `bun run check:full`, and strict OpenSpec validation; record the receipts in an evidence-only commit.
- [x] 5.2a Freeze the Owner-authorized wording-only successor to review record `08021f29` as `38ef174cd8423c05874aebdfbd9f921fad1c5a7a` and record its exact-SHA re-verification receipts without rewriting the `f89c7ee4` history.
- [x] 5.3 Obtain three fresh-context Claude review lenses against frozen source `f89c7ee4a104c79d4c362972be8cac9c982dbc68`; all returned `REVIEW_APPROVED`, recorded in `08021f29`.
- [x] 5.3a Obtain targeted review of only the post-review wording-touch-up diff; `REVIEW_APPROVED` for `38ef174cd8423c05874aebdfbd9f921fad1c5a7a` is recorded in `c9f8c69cf0ec3ea715d9c46e3e72ee36e2181668`, without rerunning the full multi-view review.
- [x] 5.4 Record the Owner's 2026-09-02 `rebaseline ACCEPTED` for reviewed frozen source `38ef174cd8423c05874aebdfbd9f921fad1c5a7a`.
- [x] 5.5 Archive normally with `bun x openspec archive update-trpc-capability-boundary --yes` (never `--skip-specs`) from `f8f03e9cfd6596e6c851558fe4f2647fefa2f1a5`; mechanical archive commit `41a1dfbdbe431b16e0d08e3b7322390b3ddd4501` merges all six requirements as 15 requirements / 35 scenarios in the living spec.
- [x] 5.6 Complete post-archive mechanical closeout against the post-1d archive baseline: active changes `0/0`, living specs `52/52`, all `52/52`, and archived `108 passed / 6 failed / 114 total` with this entry passing; update `openspec/STATUS.md`, this archived task/verification receipt, and TICKET-114 with the still-pending packaged-production and development-CSP/HMR smoke rerun items.

## Descoped - Routing Records, Not Completed Tasks

- Original 2.2 remaining untrusted-content sink sanitization/sandboxing -> follow-up A `add-renderer-untrusted-content-hardening`.
- Direct Streamdown malicious-raw-HTML/dangerous-URL renderer regression coverage and direct DOM HTML-sink enumeration -> follow-up A; the current source guard is file-level and scans only React `dangerouslySetInnerHTML`, not `.innerHTML` assignments such as the mentions-editor undo/redo restores.
- Original 2.3 webview/local-browser hardening -> follow-up A. Existing URL/navigation policy and per-chat partition are retained; remaining work is permission policy, guest/preload/bridge isolation proof, guest window-open and JavaScript-surface audit.
- Original 2.4 renderer desktop smoke -> follow-up A, including the Owner-directed TICKET-114 CSP reruns.
- Original R6 preview/webview bridge-access scenario -> follow-up A.
- Original 3.1 capability taxonomy -> follow-up B `add-trpc-capability-consent-audit`.
- Original 3.2 typed procedure wrappers/capability metadata -> follow-up B.
- Original 3.3 consent gates other than MCP stdio 3.3a -> follow-up B.
- Original 3.4 capability audit log and kill-switch -> follow-up B.
- Original 3.5 bare-dangerous-`publicProcedure` guard and tests -> follow-up B.
- Original R3 `terminal.write` arbitrary-input capability scenario -> follow-up B.
- Inherited renderer-selected runtime MCP `projectPath` lookup is excluded from the narrowed R3 certification and remains with the TICKET-101/104 lineage and the Amadeus continuation slice.
- Parent-directory symlink escape for `files.renameFile/deleteFile` is excluded from narrowed R2: current writes enforce lexical containment only. It remains a TICKET-101/path-boundary security residual and requires a separately owned product-code fix.
- Whether remembered MCP stdio approvals bind canonical project identity and how they are revoked -> follow-up B; the current command fingerprint intentionally excludes `projectPath`.

Follow-up A may be drafted only after this archive and is independently scheduled. Follow-up B
waits until Foundation 1d and the Amadeus continuation slice. Neither follow-up is created or
implemented by this change.
