# Verification: Retire engine vocabulary and fork residue

## Scope and isolation

- Change: `refactor-engine-vocabulary-residue` (Foundation 1d; Owner `APPROVED`
  2026-08-26).
- Base: `main@d77a4b48e8d60cdaf20b8ae02d5df9482239e24a`.
- Branch: `codex/refactor-engine-vocabulary-residue`.
- Worktree: `/home/chen/projects/locus-refactor-engine-vocabulary-residue`.
- Implementer/Integrator: Codex `/root`.
- Remote operations: not authorized / not performed.
- Explicit exclusion: no file under
  `openspec/changes/update-trpc-capability-boundary/**` is in this change.
- Data decision: no schema, persisted-key, persisted-value, or row rewrite. The
  `metadata.provider` JSON key and its runtime ID values remain stable; historical
  `agent_jobs.input.protocol = "locus-acp-stdio.v1"` rows remain untouched.

## Pre-flight receipts

- Keep-list inspection confirmed that `src/shared/acp-tool-normalizer.ts`, the ACP
  branches in `src/shared/chat-message-normalizer.ts`, persisted `tool-acp.*` parts,
  and `src/main/lib/codex/ask-user-question.ts` belong to the genuine third-party
  ACP tool path and are not the Locus stdio protocol renamed here.
- Post-1b binding anchor confirmed: `metadata.provider` is written by the chat metadata
  builder from `chats-crud.ts` and read only by the canonical legacy-binding backfill in
  `src/main/lib/chat-session-binding.ts`; renderer `active-chat.tsx` no longer infers an
  existing chat's Engine from messages. The helper was subsequently renamed to
  `inferChatEngineIdFromMessages` without changing its fallback behavior.
- C7 consumer sweep (2026-09-02): exact-string search across this repository and every
  sibling repository under `/home/chen/projects` found no executable external consumer
  of `locus acp` or `locus-acp-stdio.v1`. Career Kit's executable adapter invokes only
  `locus api`; its archived planning text explicitly says it does not use `locus acp` or
  streaming. Result: no Red consumer stop.
- The same sweep found two post-proposal packaged entry anchors,
  `resources/cli/locus` and `resources/cli/locus.cmd`, plus their shim test. Updating
  those command allowlists is Green because packaged `locus jobs-stdio` cannot satisfy
  the approved acceptance criterion without it.
- Repository search confirmed `agent_jobs.input.protocol` is serialized and projected
  as history/metadata but is not read to select or route an adapter. No migration or
  dual-read path is required.

## Pre-change gate

- First `bun run check:full` attempt stopped before linting because the fresh worktree
  had no `node_modules` and therefore no Biome executable.
- `bun install --frozen-lockfile` populated the exact lockfile dependencies. Its
  postinstall then exited nonzero because this Linux host cannot load Electron's missing
  `libnspr4.so`; the source checks remained runnable and no GUI/native smoke is claimed
  from that install step.
- After dependencies were present, `bun run check:full` at exact base
  `d77a4b48e8d60cdaf20b8ae02d5df9482239e24a` exited **0**:
  - changed-file lint and architecture guard: passed;
  - retired-runtime residue: **1,607 files scanned / 10 allowlisted**;
  - TypeScript: passed;
  - tests: **1,917 passed / 0 failed / 9,294 expectations across 302 files**;
  - OpenSpec all/strict: **54 passed / 0 failed**;
  - Electron/Vite main, preload, and renderer production builds: passed;
  - patch whitespace check: passed.

## Scope Delta Ledger

- Green — post-1b anchor drift: the transport has two construction sites and no longer
  has the proposal's old `instanceof` site; two additional binding source-text suites
  and one quick-chat source assertion carry the renamed class/Engine identifiers.
- Green — post-1b duplicate-value drift: internal review found that
  `CHAT_SESSION_BINDING_RUNTIMES` and `chatMessageMetadataSchema.provider` also owned
  independent Engine value lists. Both now derive directly from `CONTRACT_RUNTIME_IDS`,
  and the architecture guard and routing test cover all three derived consumers.
- Green — five unused `agentChatProviders` imports in `chats-*` router files are removed
  while merging the enum source; this changes no runtime behavior.
- Green — the disabled Cursor entry left an unreachable renderer branch in
  `active-chat.tsx`; deleting that dead branch is required to retire the product residue
  and changes no active Claude Code or Codex path.
- Green — the task's broad `grep -n "cursor" new-chat-form.tsx` acceptance command is
  narrowed to the retired Engine literal/union/label. Legitimate Tailwind
  `cursor-text`/`cursor-default` classes are not product Engine residue and remain.
- Green — the managed-worktree audit found only the five approved parser/check copies
  plus the two approved main-side base-directory constructions. A structured pure parse
  result may be exposed by the shared owner so `claude-config.ts` can delete its parser
  rather than retain a hidden sixth interpretation.
- Green — packaged and installed CLI anchors drifted after approval. The checked-in POSIX
  and Windows shims and the dynamically generated installed Windows wrapper now route
  `jobs-stdio` and explicitly reject retired `acp` with the standard exit code, so the
  old command cannot accidentally fall through to GUI launch.
- Green — internal review found that a legacy-only `.1code` load could display a false
  pre-write "Saved to Locus" status and retain stale source text after migration. The UI
  now says it loaded the legacy source, shows `.1code/worktree.json`, and refetches after
  an allowed Locus/Cursor save; read precedence and the backend remain unchanged.
- Yellow — persisted renderer atom/storage identifiers
  `lastSelectedAgentIdAtom` and `projectAgentIdAtomFamily` remain unchanged and are not
  implemented here, per the approved envelope.
- Yellow — `src/main/lib/git/worktree-config.ts` and its tRPC envelope still accept a
  programmatic `"1code"` save target. The approved tasks explicitly freeze that read/
  detection owner and authorize removing the UI write target only. Backend hardening is
  recorded for a separately approved follow-up; this change does not alter the Red
  read/detection priority (`custom > .locus > .cursor > .1code`).
- Yellow — `docs/ideas/locus-interoperability-contract-v1.zh-CN.md` still uses the
  historical phrase `daemon/ACP main`. That ratified contract document is owned by the
  parallel documentation rebaseline lane and was not one of this change's enumerated
  protocol-reference edits, so it is logged here and deliberately left untouched.
- Yellow — internal review noted no direct DB-fixture behavioral test for
  `resolveProjectPathFromWorktree` or direct renderer tests for three thin helper
  delegates. The pure helper matrix, a Windows caller test, existing legacy-config
  detection tests, source residue proof, and unchanged DB lookup structure cover this
  extraction; expanding those harnesses is recorded as nonblocking follow-up work.
- Red findings: none.

## Targeted implementation receipts

- Focused suites for Engine derivation/metadata, binding/transport source contracts,
  jobs-stdio parsing/dispatch/shims, worktree parsing/callers, `.1code` UI write demotion,
  legacy-config read priority, and affected chat pipelines: **152 passed / 0 failed /
  1,034 expectations across 17 files**.
- `bun run ts:check`: passed. `bun run architecture:check`: passed.
  `bun run retired-runtime:check`: **1,614 files scanned / 10 allowlisted**.
- `bun run spec:validate`: **54 passed / 0 failed** across all changes and specs.
- Architecture-guard negative proof: temporarily replacing the direct derivation with
  `agentChatProviders = [CONTRACT_RUNTIME_IDS[0], "codex"] as const` made
  `bun run check:full` stop in `architecture:check` with the diagnostic that
  `src/shared/chat-engine-id.ts` must derive from the canonical owner in
  `src/shared/agent-runtime-capabilities.ts` and pointed to `docs/OWNERSHIP_MAP.md`.
  The mutation was then restored; lint, the architecture guard, and `git diff --check`
  passed afterward.
- Test-count accounting relative to the pre-change gate: eleven tests were added — five
  shared worktree-path cases, two read-only `.1code` UI cases, one canonical Engine-ID
  derivation/schema case, one Windows worktree caller case, and two packaged/installed
  shim cases. Renamed jobs-stdio dispatcher/parser cases replace their ACP-named
  predecessors rather than adding to the count.
- Negative residue searches are clean for `ACPChatTransport`, `acp-chat-transport`,
  `locus-acp-stdio`, `NewChatAgent`, `AgentChatProvider`, and the retired normalize/infer
  identifiers in active source/tests/ownership guards. The only product-form `cursor`
  text left in `new-chat-form.tsx` is legitimate CSS cursor styling.
- Managed-worktree marker interpretation now occurs only in
  `src/shared/worktree-path.ts`; main-side base-directory construction imports its
  shared segments. Exact-base diffs confirm that every keep-list file and
  `openspec/changes/update-trpc-capability-boundary/**` is untouched. Persisted
  `tool-acp.*` handling remains present in both genuine ACP normalizers.

## Exact-source verification

- Frozen implementation source SHA: pending.
- `bun run check:full` exact-source receipt: pending.
- Codex verdict: pending.
- Fresh-context independent review: pending coordinator dispatch.
- Owner acceptance: pending; no merge or archive is authorized in this task.

## Manual / packaged smoke

- Source-level execution of the exact CLI dispatcher with argv `jobs-stdio` and a test DB
  returned the initialize result
  `{"protocolVersion":"locus-jobs-stdio.v1","serverInfo":{"name":"Locus"},"capabilities":{"jobRun":true,"jobCancel":true,"eventStream":true,"shutdown":true}}`,
  followed by a successful shutdown response. Source-level argv `acp` returned
  `Unknown command: acp` with exit code **2**.
- Actual POSIX shim execution with `LOCUS_HEADLESS_EXECUTABLE=/bin/echo` routed
  `locus jobs-stdio` to `--locus-headless-cli jobs-stdio`; `locus acp` wrote
  `Unknown command: acp` to stderr and exited **2**. The generated Windows wrapper is
  exercised as a pure string contract because this host is Linux.
- Exact packaged Electron execution and desktop GUI smoke remain unavailable on this
  host: `bun run dev` stops during the native-module/Electron checks because Electron
  cannot load `libnspr4.so` (`cannot open shared object file`). Therefore no claim is
  made for desktop startup, repository selection, live provider send, MCP/tool use,
  Engine picker rendering, or the interactive worktree affordances. The same host issue
  was present before the implementation; production builds and source-level CLI tests
  remain covered by `check:full`.

## Authority boundary

No local merge, OpenSpec archive, push, remote PR mutation, remote merge, tag, publish,
release, or repository-rule change is authorized or performed. This handoff stops after
the exact implementation SHA and Codex `IMPLEMENTATION_VERIFIED` receipt, for the
coordinator to dispatch dual fresh-context review.
