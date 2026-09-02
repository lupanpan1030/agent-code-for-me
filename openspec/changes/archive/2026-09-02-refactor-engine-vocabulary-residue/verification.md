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
  `bun run retired-runtime:check`: passed; the frozen-source gate reports
  **1,611 files scanned / 10 allowlisted**.
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

- Frozen implementation source SHA:
  `911c01320b6b417d4ff6cf2305863a1d56a5522a` (direct child of the required base;
  commit `refactor: retire residual engine vocabulary`).
- `bun run check:full` at that exact clean source SHA exited **0** on 2026-09-02:
  - architecture guard: passed;
  - retired-runtime residue: **1,611 files scanned / 10 allowlisted**;
  - TypeScript: passed;
  - tests: **1,928 passed / 0 failed / 9,350 expectations across 304 files**;
  - baseline delta: **+11 tests**, exactly matching the addition ledger above, and
    **+2 test files**;
  - OpenSpec all/strict: **54 passed / 0 failed**;
  - Electron/Vite main, preload, and renderer production builds: passed;
  - patch whitespace check: passed.
- The clean-SHA gate's changed-file lint stage correctly reported no uncommitted files;
  immediately before freezing, `bun run lint` checked the implementation diff and passed
  with only pre-existing diagnostics outside changed lines ignored by the repository
  baseline mechanism.
- Codex verdict for the frozen source SHA: **IMPLEMENTATION_VERIFIED**. This verdict covers
  the implementation and automated/source-level acceptance evidence; the explicitly
  disclosed host-blocked packaged/GUI scenarios below are not represented as passed.
- Fresh-context independent review: two independent `REVIEW_APPROVED` verdicts are recorded
  below for the same frozen source SHA.
- Owner acceptance: `ACCEPTED` on 2026-09-02; the evidence and closeout authority are
  recorded below.

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

The Owner-authorized local fast-forward merge and standard OpenSpec archive are recorded
below. No push, remote PR mutation, remote merge, tag, publish, release, or repository-rule
change was authorized or performed.

## Fresh-context Claude review (2026-09-02)

- Reviewed source SHA: `911c01320b6b417d4ff6cf2305863a1d56a5522a`; evidence commit
  `8fd48269` independently confirmed docs-only.
- Two independent fresh-context lenses (rename-completeness/correctness and
  consumer-impact/trust-boundary), each in a uniquely-assigned isolated detached worktree
  (1d-review-a/b, removed after review; Codex worktree untouched).

**Both lenses: `REVIEW_APPROVED` for `911c0132`. No P0/P1/P2.**

Key confirmations (independently reproduced): `check:full` exit 0 with exactly
1,928/0/9,350/304 and OpenSpec 54/54; dual-enum single truth via reference derivation with a
live guard-mutation negative proof; old-format persisted metadata parses unchanged
(zero-migration claim proven by probe tests); `jobs-stdio` handshake and explicit `acp`
rejection (exit 2) verified live on POSIX shim, packaged `locus.cmd`, generated Windows
wrapper, and dispatcher; independent C7 sweep found zero real external `locus acp`
consumers; worktree parsing single owner with all five former copies importing it; `.1code`
read-only demotion with the programmatic-write Yellow honestly scoped; excluded rebaseline
directory and keep-list zero-diff; +11 tests reconciled file-by-file.

Non-blocking P3 notes (informational): ① test filename `agent-chat-provider-routing.test.ts`
retains retired vocabulary (cosmetic); ② `resolveProjectPathFromWorktree` strictly narrower
on two unreachable legacy edge inputs (corrections; Yellow-logged fixture gap stands);
③ `.cursor` save target now offered unconditionally (gate removal matches task acceptance
text; disclosure noted); ④ `acp` rejection message carries no `jobs-stdio` migration hint;
⑤ engine-id single-owner guard inspects the three derived files, narrower than the
proposal's repo-wide wording; ⑥ installed Windows wrapper routes fewer commands than the
packaged shim (pre-existing asymmetry, out of approved scope); ⑦ node-pty/Electron
reproduction caveat on --ignore-scripts hosts (TICKET-114 pattern).

Gate status at review time: fresh-context review was complete for the exact source SHA;
the subsequent Owner acceptance, local merge, and archive closeout are recorded below.
No push or other remote operation was authorized by the review record.

## Owner acceptance (2026-09-02)

**Owner `ACCEPTED`** recorded via the coordination session on 2026-09-02 for source SHA
`911c01320b6b417d4ff6cf2305863a1d56a5522a`, with the evidence chain through `89efd7dd`
(dual `REVIEW_APPROVED`, zero P0/P1/P2). Gates 4-6 closeout is now authorized: local
fast-forward merge into `main`, post-merge `bun run check:full` on the merge SHA, and
`openspec archive`. This completes Foundation Stabilization 4/4 upon archive. No push or
other remote operation is authorized by this record.

## Local main merge and post-merge gate (2026-09-02)

- Pre-merge confirmation: branch `codex/refactor-engine-vocabulary-residue` and its
  dedicated worktree were clean at accepted evidence HEAD
  `6f107d610ae2dbc4f423fcf3573f340e707a5331`; local `main` was its direct ancestor.
- The primary worktree was clean on
  `codex/update-trpc-capability-boundary-rebaseline`, then explicitly switched to `main`.
  `git merge --ff-only codex/refactor-engine-vocabulary-residue` advanced local `main`
  from `d77a4b48e8d60cdaf20b8ae02d5df9482239e24a` to merge SHA
  `6f107d610ae2dbc4f423fcf3573f340e707a5331` without a merge commit or conflict.
- `bun run check:full` at that exact clean merge SHA exited **0**:
  - architecture guard: passed;
  - retired-runtime residue: **1,611 files scanned / 10 allowlisted**;
  - TypeScript: passed;
  - tests: **1,928 passed / 0 failed / 9,350 expectations across 304 files**;
  - OpenSpec all/strict before archive: **54 passed / 0 failed**;
  - Electron/Vite main, preload, and renderer production builds: passed;
  - patch whitespace check: passed.
- No push or other remote operation was performed. The primary worktree remains on
  `main`.

## Standard archive closeout (2026-09-02)

- `openspec archive refactor-engine-vocabulary-residue --yes` completed without
  `--skip-specs` and moved the change to
  `openspec/changes/archive/2026-09-02-refactor-engine-vocabulary-residue/`.
- The archiver applied the accepted deltas to the living
  `agent-protocol-interfaces`, `canonical-entity-vocabulary`, and
  `fork-residue-hygiene` specs: **3 requirements added / 1 retired**.
- Post-archive `openspec validate --all --strict --no-interactive` passed:
  **53 passed / 0 failed**.
- Foundation Stabilization is complete **4/4**. No remote operation was performed.
