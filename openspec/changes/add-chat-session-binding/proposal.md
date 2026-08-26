# Change: Persist chat session binding truth in the database

## Why

The runtime/model/thinking binding of every desktop Chat lives **only in renderer
localStorage plus a per-render inference over message metadata** — the database has no record of
which runtime a chat is bound to. `sub_chats` (`src/main/lib/db/schema/index.ts`, `subChats`
table, ~L135) carries only `sessionId` (Claude-oriented), `streamId`, `mode`, and `messages`;
meanwhile the job path already persists `runtime` and `providerProfileId` on `agent_jobs`
(same file, ~L301/~L320). This is a confirmed dual path for the same binding concept, and it
splits the truth three ways:

1. Five per-sub-chat `atomWithStorage` families in
   `src/renderer/features/agents/atoms/index.ts` (`subChatModelIdAtomFamily`,
   `subChatClaudeModelSourceAtomFamily`, `subChatCodexModelSourceAtomFamily`,
   `subChatCodexModelIdAtomFamily`, `subChatCodexThinkingAtomFamily`, plus the
   `lastSelected*` global defaults) hold model/source/thinking truth in localStorage.
   (The sixth per-sub-chat family, `subChatModeAtomFamily`, is mode, not binding — see
   Out of scope.)
2. The runtime (provider) of an existing chat is **re-inferred from message metadata on every
   render**: `inferProviderFromMessages` (`active-chat.tsx` ~L5584) wraps
   `inferAgentChatProviderFromMessages` (`src/shared/agent-chat-provider.ts:51`), called at
   `getOrCreateChat` (~L5826) and per-render at ~L6807/6854/6914; empty chats additionally rely
   on the `subChatProviderOverrides` `useState` (~L4764) and a
   `transport instanceof ACPChatTransport` back-inference (~L5777).
3. Both transports steal-read the atoms from `appStore` at `sendMessages` time and even write
   normalized results back: `ipc-chat-transport.ts` (~L228–309, two `appStore.set` write-back
   sites) and `acp-chat-transport.ts` (`getSelectedCodexModel` ~L128, source read ~L180).

Consequences today: clearing localStorage or reading the DB from any non-renderer consumer
(Job API, headless, a second machine) loses or cannot see the binding; ratified contract C4
(`docs/ideas/locus-interoperability-contract-v1.zh-CN.md` §6) acceptance invariant 8 explicitly
requires that `sub_chats.sessionId`, message-metadata inference, and in-process maps stop acting
as a second binding owner. The Owner approved doing this narrow binding-truth move in the
Foundation Stabilization batch, shaped per C4 SessionBinding, so Phase 5 Portable Sessions
**extends** this schema instead of re-migrating it.

## What Changes

- **Add persistent binding truth to the DB**: a narrow `sub_chat_bindings` table (one row per
  sub-chat, unique on `sub_chat_id`), shaped as the C4 SessionBinding seed: `runtime`
  (`"claude-code" | "codex"`, NOT NULL), `providerProfileId` (nullable), `modelId` (nullable),
  `modelSource` (nullable), `thinkingLevel` (nullable), timestamps. Table-vs-columns rationale
  in `design.md` Decision 1. `sub_chats.sessionId` stays exactly where and what it is.
- **Drizzle migration + one-time backfill (the migration gate)**: a new migration creates the
  table; an idempotent startup backfill (insert-if-missing, invoked right after `migrate()` in
  `src/main/lib/db/index.ts:63`) assigns `runtime` for existing rows by reusing
  `inferAgentChatProviderFromMessages` **once, in the backfill path only**. All other call
  sites of that inference are deleted.
- **Canonical owner**: new main-process module `src/main/lib/chat-session-binding.ts` owns all
  reads/writes of `sub_chat_bindings` (get/join onto sub-chat DTOs, seed-at-create, update,
  copy-on-fork, backfill). Routers stay envelope surfaces. Shared type in
  `src/shared/chat-session-binding.ts`.
- **Transports get binding injected explicitly at construction** (read from the DB-backed
  sub-chat DTO by the creator): delete the `appStore` binding reads and write-backs inside
  `ipc-chat-transport.ts` and `acp-chat-transport.ts`; delete the `subChatProviderOverrides`
  `useState` and every per-render `inferProviderFromMessages` call in `active-chat.tsx`.
  Point surgery: the two transport files plus the `getOrCreateChat` / `createNewSubChat`
  construction sites and the selection read/write sites they feed
  (`chat-input-area.tsx` ~L536–561, `new-chat-form.tsx` ~L1311–1315).
- **Binding writes go through one mutation**: `chats.updateSubChatBinding` (envelope in
  `src/main/lib/trpc/routers/chats-sub-chats.ts`, logic in the owner). Runtime switch on an
  empty chat becomes a binding update + transport recreation (replacing the
  `handleProviderChange` override path at `active-chat.tsx` ~L5963–5998). Creation paths
  (`chats.create` in `chats-crud.ts` ~L173, `chats.createSubChat` in `chats-sub-chats.ts`
  ~L93) seed a binding row; `forkSubChat` (~L197) copies the source binding. A shared
  per-sub-chat gate serializes binding mutations with direct/queued sends, initial
  regeneration, and stream resume so no send can retain a transport replaced by a completed
  mutation. Renderer state is receipt-first: it waits for the canonical mutation result,
  publishes that returned binding, and then recreates the transport. A same-sub-chat
  `chat-view-instance-key` remount prevents a cached Chat instance from surviving recreation.
  The pre-await pending-operation context is inherited by every nested gate, so explicit close
  followed by same-ID reopen cannot give an old submit a fresh cancellation generation.
- **The five per-sub-chat binding atom families are deleted in this same change**, together
  with all their remaining read/write call sites (Owner decision 2026-08-26; see design.md
  "No temporary dual path"). The `lastSelected*` global atoms keep their default-seeding role
  for NEW chats only. Existing chats read their binding from the DB alone — localStorage is no
  longer consulted for existing chats; the stored defaults apply only at creation time.
- **Provider Profile capability honesty** (Owner decision 2026-08-26): Codex Provider
  Profiles currently advertise reasoning `none` only, so their bindings normalize
  `thinkingLevel` to `NULL`, their effort selector is hidden, and the transport continues to
  submit `/none`. Real per-protocol reasoning-effort support is Yellow follow-up TICKET-116,
  not implemented here.
- **Provider Profile model snapshot**: explicit Profile selection writes its current
  `defaultModel` into the binding in the same mutation as source/profile identity. Runtime and
  gateway startup use that snapshotted model, so editing a Profile later cannot silently
  rebind an existing chat. Run-scoped OAuth diversion remains non-persistent and may use the
  diverted Profile's current default for that one run.
- **Exact snapshot admission**: creation, entering a Profile, and explicit Profile model
  reselection require a live Profile that targets the selected runtime and require `modelId`
  to equal its current `defaultModel`; a fork instead copies the historical source binding
  without consulting a subsequently edited or deleted Profile. Before a desktop run starts,
  main re-reads the DB binding and rejects a stale or forged renderer source/profile/model/
  effort tuple. Claude's documented run-scoped OAuth diversion is the only non-persistent
  source exception and remains constrained to a valid targeted Profile. Full chat/cwd/scope
  preflight also completes before active-run replacement, and a per-chat admission generation
  ensures only the latest concurrent request may activate after asynchronous checks.
- **Owner-authorized rollback maintenance fence** (Red exception approved 2026-08-26): a
  canonical main-process owner at
  `src/main/lib/agent-runtime/chat-maintenance-fence.ts` holds an exact, per-sub-chat,
  in-memory token only while `rollbackToMessage` is performing its maintenance operation.
  An active Claude or Codex Run rejects rollback, and an acquired rollback fence rejects the
  final claim of a new desktop Run. Conflicts use the C4.1-aligned code
  `SESSION_BINDING_BUSY` with structured `subChatId`, `operation: "rollback"`, exact
  `activeRunId` (or `null` when maintenance is the blocker), and
  `reason: "active-run" | "maintenance"`. This is deliberately not a durable or general
  execution lease: it writes no database state, survives no process restart, and never touches
  `agent_jobs` or a binding row. Phase 5 MUST absorb or replace it with the durable C4
  SessionBinding lease and delete this temporary owner. If rollback invalidates an already
  reserved candidate and releases before its final claim, a one-shot exact-admission in-memory
  tombstone preserves the same BUSY result without turning ordinary staleness into maintenance.
- **Rollback checkpoint and history-write hardening**: rollback requires main-minted checkpoint
  metadata containing a unique canonical ref plus its exact OID, verifies the ref/OID binding
  before any destructive Git operation, and fails closed when metadata, publication, the ref,
  or OID is missing or mismatched. Same-SDK-UUID Runs receive different refs; stale cleanup may
  retract only its exact ref/OID. A failed checkpoint publication persists explicit
  unavailability, and a DB failure after publication retracts only that exact public ref while
  preserving the old message row. The unused `updateSubChatMessages` arbitrary overwrite route
  is deleted in the same change, leaving rollback as the sole history-rewrite envelope.
- **Token-scoped gateway decoding and headless isolation**: a server-minted desktop Codex chat
  token carries the exact admitted model snapshot and uses it as the sole upstream model
  authority; a request's reserved final `/none` transport marker or arbitrary body model cannot
  expand that scope. Desktop Claude chat tokens forward opaque model IDs verbatim, and the
  default `legacy-profile-default` token preserves the existing headless/Local Job
  Profile-default behavior. Request data cannot select a decode mode, and headless remains
  independent of `sub_chat_bindings`.
- **Coherent new-chat defaults**: Profile save/delete/target/default changes and app-managed
  API-key save/remove update global source/model/thinking defaults as one compatible tuple.
  These writes affect only subsequently created chats; existing DB bindings never change.
- **Register ownership and guards**: `docs/OWNERSHIP_MAP.md` gains a "Chat Session Binding"
  section naming `src/main/lib/chat-session-binding.ts` as canonical owner;
  `scripts/check-architecture-guards.mjs` gains assertions that (a) no `atomWithStorage`
  carries per-chat runtime/model binding semantics at all (the five deleted families must not
  reappear; no allowlist needed), and (b) `inferAgentChatProviderFromMessages` has no call site
  outside `src/shared/agent-chat-provider.ts`, the backfill in the owner module, and tests.
- **Data lifecycle note (W4.2)**: the repo is PRE-PRODUCTION / DISPOSABLE TEST DATA, so the
  migration is deliberately simple (no rollback path, per-sub-chat localStorage model/thinking
  overrides for existing chats are not migrated — they fall back to DB `NULL` + the
  runtime/catalog defaults resolved at send time, never renderer localStorage). The backfill
  is still documented and verified as the migration gate.

## Sequencing

Part of the Owner-approved Foundation Stabilization batch. Soft-ordered **after**
`refactor-codex-desktop-service-extraction` (review bandwidth and merge order inside the
batch), but technically independent: this change touches renderer transports, `chats-*`
routers, DB schema, and shared chat-provider code, none of which that extraction owns.

## Out of scope

- Any structural split of `active-chat.tsx` (7,250 lines stays; only binding-related surgery).
- Conversation / SessionBinding as a first-class API object, binding lifecycle states,
  runtime-installation pins, durable/general execution leases, successor bindings (Phase 5 /
  C4 full shape). The Owner-authorized, process-local rollback maintenance fence above is the
  only narrow exception and carries a mandatory Phase 5 absorption/deletion note.
- Headless/job binding — `agent_jobs.runtime` / `agent_jobs.providerProfileId` already exist
  and remain the job path's own admission snapshot; `sub_chat_bindings` is **not** made
  authoritative for headless paths.
- Changing `sub_chats.sessionId` semantics or moving it.
- Renaming tables (C1 `sub_chats` → `conversations` naming is a later atomic change).
- Moving renderer pre-resolution (`normalizeClaudeModelSourceForRun`, OAuth divert) into main —
  registered debt per the dual-path audit (c); the divert becomes per-send-effective-only here
  (no persistence), relocation is a follow-up.
- Adding low/medium/high/xhigh reasoning support to Provider Profiles or changing gateway
  protocol translation/capability declarations (TICKET-116).
- `mode` handling (`sub_chats.mode` / `subChatModeAtomFamily`) — mode is not binding and is
  already DB-persisted.

## Impact

- **Affected specs**: new capability `chat-session-binding` (ADDED requirements). No existing
  spec is modified: `provider-runtime-bindings` (main-process credential/gateway resolution) and
  `architecture-ownership` (generic ownership/guard rules) are unchanged in behavior; the new
  guard assertions implement, not alter, `architecture-ownership`'s existing requirements.
- **Affected code**:
  - New: `drizzle/0023_lonely_wrecking_crew.sql` migration,
    `src/main/lib/chat-session-binding.ts`, `src/shared/chat-session-binding.ts`, renderer
    binding gate/default/resume/remount helpers, the desktop Run admission-generation guard,
    the process-local chat maintenance fence owner, smoke binding tuple helper, and tests.
  - Edited: `src/main/lib/db/schema/index.ts`, `src/main/lib/db/index.ts`,
    `src/main/lib/trpc/routers/chats-sub-chats.ts`, `src/main/lib/trpc/routers/chats-crud.ts`,
    Codex/Claude desktop Run routers and startup owners, rollback/checkpoint persistence and
    Git-apply helpers, Provider Profile storage/gateway,
    settings/onboarding Profile and API-key surfaces,
    `src/shared/agent-chat-provider.ts` (no signature change; call-site retirement),
    `src/renderer/features/agents/lib/ipc-chat-transport.ts`,
    `src/renderer/features/agents/lib/acp-chat-transport.ts`,
    `src/renderer/features/agents/lib/agent-chat-api.ts` (DTO carries `binding`),
    `src/renderer/features/agents/main/active-chat.tsx`,
    `src/renderer/features/agents/main/chat-input-area.tsx`,
    `src/renderer/features/agents/main/new-chat-form.tsx`,
    `src/renderer/features/agents/atoms/index.ts` (the five per-sub-chat binding atom
    families deleted),
    both desktop smoke scripts, `scripts/check-architecture-guards.mjs`, and
    `docs/OWNERSHIP_MAP.md`.
- **Persisted data**: new table + backfill (migration gate; W4.2 pre-production simplicity).
- **Public consumers**: none. The Local Job API surface is untouched; `chats.*` tRPC is a
  private main↔renderer boundary (W4.2 atomic replacement applies, no compatibility layer).

## Verification consumers

- New unit tests: owner module (seed/update/fork-copy/backfill idempotency; backfill runtime
  assignment from legacy metadata incl. the `codex`/`gpt-` model-string fallbacks and the
  `claude-code` default), binding normalization (provider-profile source ↔ `providerProfileId`
  consistency), and a transport-construction test asserting binding is consumed from config
  (no `appStore` binding atom imports in either transport — also enforced by guard).
- Main-boundary tests prove stale/forged desktop Run tuples fail closed, the one documented
  Claude run-scoped divert is constrained, and unknown Claude sources never fall through to
  OAuth credentials.
- Gateway-scope tests prove Codex token-bound model authority despite arbitrary body models,
  Claude verbatim models, immutable token-selected modes, and the legacy headless/Local Job
  default. Renderer tests prove
  receipt-first transport recreation, same-id Chat remount, persisted stream resume dedupe/
  retry, close-context inheritance across nested sends, and coherent global default writes.
- Rollback/fence tests prove both active Engines reject maintenance; maintenance rejects both
  Engines' final Run claims; BUSY errors carry the exact approved shape; exact-token release
  survives success, failure, and stale cleanup; an earlier invalidated candidate still reports
  BUSY after token release; and the fence remains process-local without DB or schema writes.
  Checkpoint tests cover same-SDK-UUID A/B unique refs, publication failure,
  DB transaction failure, missing/unavailable metadata, wrong OID, and an unchanged worktree on
  every pre-apply rejection. A route-surface assertion proves `updateSubChatMessages` is gone.
- Negative assertion (residue proof): the five deleted family identifiers
  (`subChatModelIdAtomFamily`, `subChatClaudeModelSourceAtomFamily`,
  `subChatCodexModelSourceAtomFamily`, `subChatCodexModelIdAtomFamily`,
  `subChatCodexThinkingAtomFamily`) no longer appear anywhere in `src/`.
- `scripts/check-architecture-guards.mjs` (via `bun run architecture:check` inside
  `bun run check`): new binding-atom and inference-call-site assertions fail on regression.
- Existing suites that exercise chat creation/fork and transports must stay green.
- Desktop smoke (recorded in `verification.md`): create a Claude chat and a Codex chat, send a
  message in each, change model/thinking on the Codex chat, restart the app **after clearing
  localStorage**, and verify both chats reopen with the correct runtime/model binding and can
  continue; runtime switch on an empty chat still works.
- `bun run check:full` on the exact source SHA (closeout).

## W7 autonomy envelope

- **Green (implementer may do autonomously)**: exact migration filename; owner-module internal
  structure and helper naming; DTO field naming (`binding`) and `agent-chat-api.ts` mapping;
  backfill batching/ordering; transport-recreation mechanics on binding update; test file
  placement; guard assertion wording; deleting the five per-sub-chat binding atom families and
  rewiring/removing every call site; copying binding on fork.
- **Yellow (log a follow-up ticket, do not implement)**: persisting the OAuth-divert result
  into the binding; moving
  `normalizeClaudeModelSourceForRun` / renderer pre-resolution into main; surfacing binding in
  History/Workbench UI; a per-chat Claude thinking level (today Claude thinking is the global
  `extendedThinkingEnabledAtom` settings toggle and stays out of the binding row); real Codex
  Provider Profile reasoning-effort support, including per-protocol gateway translation and
  explicit provider capability declarations (TICKET-116).
- **Owner-authorized Red exception (implement exactly, no widening)**: the process-local
  per-sub-chat rollback maintenance fence described above. It may coordinate only rollback and
  a new desktop Run's final claim; its state must not be persisted or reused as a generic Run,
  binding-mutation, headless, job, or workspace lease. Phase 5 must absorb/replace it and delete
  its temporary owner.
- **Red (stop and ask Owner)**: any deviation from C4 field semantics — including adding
  lifecycle/status, `runtimeInstallationId` pins, any other lease/fence, or successor-binding
  columns now;
  making `sub_chat_bindings` authoritative for headless/job paths or feeding it into Run
  admission beyond desktop chat transports; changing `sub_chats.sessionId` semantics; renaming
  tables; exposing binding through the public Local Job API; widening the runtime enum beyond
  `"claude-code" | "codex"`.
