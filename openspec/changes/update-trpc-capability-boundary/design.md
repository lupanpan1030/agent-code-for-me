# Design: tRPC capability and trust boundary

> Rebaseline note (2026-09-02): this design began as a broader threat analysis. All code anchors
> below were refreshed against `d77a4b48e8d60cdaf20b8ae02d5df9482239e24a`. The archive delta
> certifies only the implemented slices identified below. Remaining renderer hardening and
> capability middleware are routing context for follow-ups, not claims of completion.

## Context

Current evidence at the rebaseline SHA:

- tRPC `Context` contains only `getWindow` at `src/main/lib/trpc/index.ts:8-10`;
  `publicProcedure` is defined at `:32` and `loggedProcedure` at `:49`.
- `src/preload/index.ts:6` calls `exposeElectronTRPC()`, exposing the app router to the renderer.
- `createAppRouter` is at `src/main/lib/trpc/routers/index.ts:41-77`. The directory contains 42
  TypeScript files (41 router modules plus `index.ts`) and the app router mounts 33 namespaces,
  including the `changes` git router.
- The main window keeps `sandbox: false`, `webviewTag: true`, and `partition: "persist:main"` at
  `src/main/windows/main.ts:469-472`; the tRPC context is created at `:498-500`.
- The renderer CSP owner is `src/main/windows/renderer-csp.ts:12-29,39-61,70-107`, installed at
  `src/main/windows/main.ts:482-487`. Production permits `self` plus the documented
  `wasm-unsafe-eval` exception, but not inline JavaScript, ordinary `unsafe-eval`, or remote
  script origins. Development alone receives the Vite HMR allowances.

Threat model:

- This is a local Electron app, not a remote multi-user API.
- The attacker is untrusted local content that influences renderer behavior: malicious repository
  files, markdown, chat/tool/MCP output, or previewed web content.
- The renderer is a confused deputy. If untrusted content can run or steer renderer code, it can
  invoke public tRPC procedures and ask the main process to use local privileges.
- A renderer-held login token would not create an independent security principal. The useful
  boundary is main-process validation of privileged effects and isolation of untrusted content.

## Renderer-Reachable Privileged-Operation Inventory

The scan was refreshed across all 41 router modules (excluding the index), the 33 mounted
namespaces, and the `changes` git router. The table is a reviewed operation-cluster inventory, not
a procedure-complete capability taxonomy. The dangerous-input source guard is a separate
mechanical control over 12 exact schema field names.

| Severity | Procedure clusters | Main-process effect | Rebaseline status |
| --- | --- | --- | --- |
| Critical | `terminal.createOrAttach/write/signal/kill/listDirectory` | Starts and controls a PTY or reads a workspace directory. | Startup cwd/intents and directory roots are hardened. `terminal.write` remains a bare public procedure accepting arbitrary string data at `src/main/lib/trpc/routers/terminal.ts:46-55`; the PTY sink is `src/main/lib/terminal/manager.ts:122-130`. |
| Critical | `claude.chat`, `codex.chat` | Starts runtimes able to read/write files and execute tools. | Execution cwd is resolved through `src/main/lib/agent-runtime/preflight.ts:162-170` (Claude call at `src/main/lib/trpc/routers/claude.ts:120-123`). Renderer `projectPath` still participates in runtime MCP lookup and is not certified by this change. The former experimental `agentRuntime.chat` no longer exists. |
| Critical | Claude/Codex/MCP-registry configuration writers | Persists stdio commands, arguments, environment, bearer tokens, or HTTP URLs for later runtime use. | Structured input/root checks exist for the covered writes. Stdio commands additionally use the Runtime MCP Config-owned native-consent gate and fail-closed materialization. |
| High | `projects.cloneFromGitHub` | Clones and registers a GitHub repository. | `src/main/lib/projects/github-clone.ts:52-119` parses owner/repository identity, constructs a canonical URL, and invokes `git clone` through argv with `--`. |
| High | `external.openInFinder/openInApp/openFileInEditor/openExternal` | Opens paths, apps, editors, or URLs with OS privilege. | Still a capability/consent follow-up surface. Some calls accept renderer paths/cwd, so the archive delta must not generalize registered-root coverage to every renderer route. |
| High | `files` read/search/watch/rename/delete and project-scoped command/agent/skill routes | Reads, watches, writes, renames, or deletes filesystem content and runtime instruction files. | Covered routes validate registered project/chat/worktree and component roots through `src/main/lib/fs/registered-roots.ts:50-231` and `src/main/lib/fs/path-boundary.ts`; adversarial route tests are retained. |
| High | Plugin/native activation and controlled-setting routes | Enables local plugin code paths, installs candidates, changes settings, or mutates caches. | Existing review gates are useful precedent; unified capability metadata/audit is not implemented. |
| High | `changes` staging, branch, commit, push/pull/sync/force-push/merge/rebase/PR routes | Mutates repository state, deletes untracked files, and writes to remotes. | Many operations use registered-worktree and secure-fs controls, but operation-level capability classification remains follow-up work. |
| High | Provider/account/auth configuration routes | Persists or removes secrets, endpoints, accounts, or local auth state. | Secrets remain main-side; unified capability decisions and audit remain follow-up work. |
| High | `projects.delete/deleteHistory`, `chats.delete`, `worktreeConfig.approveAndRunSetup`, runtime scope-expansion decisions | Deletes project/chat history and worktrees, executes approved setup commands, or changes runtime scope. | Current anchors include `src/main/lib/trpc/routers/projects.ts:166`, `chats-crud.ts:463`, `worktree-config.ts:107`, and `claude.ts:545`. These effects are not fully represented by dangerous field names and remain part of follow-up B's procedure-level classification. |
| Medium | GitHub workflow writes, agent job/schedule controls, app update controls, debug/admin mutations | Writes remote review state, controls jobs, installs updates, or destructively changes local data. | Privileged effects remain candidates for the follow-up capability inventory. |

The dangerous-input guard lives in `scripts/check-architecture-guards.mjs`:

- field set: `:2105-2118`;
- allowlist: `:2120-2517`, 50 declared entries at this baseline;
- self-test: `:2732-2756`;
- `assertNoUnresolvedDangerousRouterInput`: `:2758-2790`;
- package-chain assertion: `:2792-2810`;
- main invocation: `:4218`.

The enumerated fields are exactly `absolutePath`, `baseUrl`, `command`, `cwd`, `dirPath`, `env`,
`filePath`, `headers`, `path`, `projectPath`, `token`, and `url`. Nested, passthrough, aliased, or
effectful no-input procedures can fall outside this detector. The 50 declarations also include one
stale `agent-runtime.ts:chat` entry. The current guard rejects an unlisted finding or extra
enumerated fields, but does not prove that allowlist entries remain live or mechanically enforce
only-shrink behavior. The future capability change must start from this exact limitation rather
than claiming the 1c ratchet already covers it.

## Certified Implementation Boundary

### Registered roots and path-like inputs

The archive delta covers only the route groups hardened by this change. Reads and directory
listing use real-path checks and reject symlink escape; search omits symlinks; watch validates the
registered root; rename/delete enforce lexical containment, traversal/null-byte rejection, and
replacement-name validation; project-scoped command/agent/skill and covered MCP/provider writes
validate registered roots. It does not claim that every renderer-reachable path/cwd sink has been
converted; the `external` examples above are a known counterexample. It also does not claim that
rename/delete reject a parent-directory symlink that lexically remains inside the root: that is a
known TICKET-101/path-boundary security residual requiring product-code work.

### Runtime and terminal starts

Claude and Codex execution cwd is resolved from server-side chat/sub-chat state; a forged
renderer cwd is rejected or ignored in favor of that server value. Terminal creation derives cwd
from registered chat/workspace state and maps only
main-owned startup intent IDs. `terminal.listDirectory` resolves a registered chat root. The old
requirement language about all runtime `projectPath`, permission context, and project-scoped
configuration being server-derived was broader than the implementation and is removed.

### MCP stdio native consent

`src/main/lib/runtime-mcp-config/mcp-command-trust.ts:42-119` owns normalization and the command
fingerprint, `:128-157` checks approvals, `:216-242` owns the native dialog, and `:244-262`
enforces approval before writes. Claude/Codex runtime materialization omits unapproved stdio
commands. This is the only operation-level native-consent requirement certified here; it is not
a general tRPC capability framework.

### Renderer content and CSP

- Chat markdown uses Streamdown 2.1.0. Its default rehype raw/sanitize/harden chain preserves a
  safe HTML subset but removes active/scriptable content. Therefore the delta says raw HTML is
  sanitized/hardened before insertion, not that every raw HTML element is discarded.
- `tests/renderer-html-sinks.test.ts:27-42` mechanically limits files containing
  `dangerouslySetInnerHTML` to an exact five-file list; it does not count or individually approve
  every insertion within an allowed file. Lines `:53-68` record four Shiki-backed files. The chat
  Shiki insertion remains at `src/renderer/components/chat-markdown-renderer.tsx:137`. This source
  guard does not itself test Streamdown's sanitizer behavior and does not scan direct DOM
  `.innerHTML` assignments. The mentions editor restores its own undo/redo HTML state through
  `.innerHTML` at `src/renderer/features/agents/mentions/agents-mentions-editor.tsx:991,1019`;
  follow-up A must enumerate that surface without assuming it is exploitable.
- Mermaid strict mode and DOMPurify live in
  `src/renderer/lib/security/mermaid-svg-sanitizer.ts:1-99`, with use at
  `src/renderer/components/mermaid-block.tsx:146,257,481,558`.
- Tool subtitles render as React text at
  `src/renderer/features/agents/ui/agent-tool-call.tsx:33-58`.
- Production/development CSP separation is owned by the files cited in Context.

## Descoped Boundaries

### Follow-up A: renderer untrusted-content hardening

The renderer sink inventory must include both React `dangerouslySetInnerHTML` and direct DOM HTML
assignments. The current five-file guard covers only the former. Follow-up A must add direct
Streamdown malicious-HTML/dangerous-URL regression coverage and decide how direct DOM sinks are
reviewed or guarded.

The local-browser surface is partially hardened already:

- the main app frame has `setWindowOpenHandler` and navigation/redirect guards at
  `src/main/windows/main.ts:573-607`;
- the local browser uses a per-chat non-persistent partition at
  `src/renderer/features/agents/ui/local-browser-workbench.tsx:89-92,449-464`;
- it applies `will-navigate` and localhost/file-root URL policy at `:157-213`, backed by
  `src/shared/local-browser-workbench.ts:64,110-184` and existing tests.

Missing proof/control includes session permission handlers, `will-attach-webview`/
`did-attach-webview`, guest `window.open` policy, explicit preview preload/bridge isolation, audit
of active `executeJavaScript` uses such as `local-browser-workbench.tsx:111-119`, and reproducible
desktop smoke. Current chat export is text-only (`json`, `markdown`, or `text`); no HTML export
preview surface was found, so follow-up A must re-enumerate sinks rather than assume one exists.

### Follow-up B: tRPC capability, consent, and audit

No unified dangerous-operation capability wrapper/meta, consent decision layer, audit owner, or
kill-switch exists. The tRPC context and `terminal.write` anchors above are the current proof.
Follow-up B owns taxonomy, wrappers, non-MCP consent, audit, kill-switches, terminal input
capability, and evolution of the dangerous-input guard. It must be drafted after Foundation 1d
and the Amadeus continuation slice, using the post-1c guard structure.

## Options and Decision

The original design considered three complementary options:

1. Input trust convergence: resolve renderer inputs through server-known entities and registered
   roots. The implemented, bounded Phase 1 slices are certified here.
2. Renderer hardening: reduce the chance that untrusted content drives the privileged renderer.
   CSP, markdown/Mermaid/subtitle, and sink-guard slices are certified here; guest/webview and
   desktop-smoke work moves to follow-up A.
3. Capability and consent middleware: classify privileged operations and enforce consent/audit/
   kill-switch decisions. Only MCP stdio native consent is certified here; the general model moves
   to follow-up B.

Authentication in the tRPC context is not the selected boundary. In this local Electron threat
model, the renderer we are constraining would also hold that token.

## Impact on APIs and Delivery

The rebaseline edits only OpenSpec documents. It does not change preload exposure, route schemas,
runtime behavior, renderer behavior, persistence, or public/versioned contracts. Normal archive
will merge the six narrowed ADDED requirements into `runtime-security-baseline`; no
`--skip-specs` archive is allowed.

## Verification Strategy

- Bind the expanded 18-file targeted suite, `bun run architecture:check`, `bun run check:full`,
  and strict OpenSpec validation to one frozen docs-only source SHA.
- Record that the existing HTML-sink test proves the reviewed five-file inventory, not a
  per-insertion inventory, direct-DOM inventory, or direct Streamdown raw-HTML rendering behavior.
- Do not claim packaged/dev CSP smoke: this WSL2 host has no usable GUI session and the historical
  4.4/4.5 checkmarks have no receipt. Record the Owner-directed TICKET-114 destination without
  editing that shared ticket in this phase.
- Require fresh Claude multi-perspective review of the same frozen SHA and Owner `ACCEPTED` before
  archive. Verification receipts alone do not authorize archive.

## Open Questions for Follow-ups

- Whether terminal input requires a per-action user gesture or a remembered pane capability.
- Whether global writes under the runtime configuration roots remain renderer-callable after
  consent or move behind Settings-only workflows.
- Whether plugin and MCP command approvals keep separate owners behind a common capability
  interface.
- Whether remembered MCP stdio approvals must bind canonical project identity and what revocation
  semantics apply. The current normalized hash intentionally excludes `projectPath`, even though
  the prompt can display it.
- How follow-up A proves guest bridge isolation without breaking the electron-trpc main window.
