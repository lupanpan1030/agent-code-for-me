# Design: Persist chat session binding truth in the database

## Context

Ratified contract C4 (`docs/ideas/locus-interoperability-contract-v1.zh-CN.md` §6, RATIFIED
2026-08-25) defines SessionBinding under a Conversation (`Conversation → SessionBinding[]`,
one-to-many per C1 §3.1), with acceptance invariant 8 requiring that `sub_chats.sessionId`,
message-metadata inference, and in-process maps stop acting as a second binding owner. Today the
chat path's binding truth is 100% renderer-side (five localStorage atom families + a `useState`
override + per-render metadata inference), while the job path already persists `runtime` and
`providerProfileId` on `agent_jobs` — a confirmed dual path.

Foundation scope is deliberately narrow: move binding truth to the DB and make transports take
it explicitly. No lifecycle, no leases, no installation pins, no API object — those are Phase 5
(Portable Sessions) and later C4 work. The data stage is **PRE-PRODUCTION / DISPOSABLE TEST
DATA** (W4.2 Owner decision), which authorizes a simple forward-only migration with no
data-rollback path, while still requiring the backfill to be named and verified as the
migration gate.

## Goals / Non-Goals

- Goals:
  - One durable, main-process-owned truth for each chat's runtime/model/source/thinking/profile
    binding, shaped so Phase 5 extends it (add columns / relax uniqueness) instead of
    re-migrating truth out of `sub_chats`.
  - Transports consume binding via constructor injection; zero `appStore` binding reads or
    write-backs in `sendMessages`.
  - Retire message-metadata provider inference everywhere except the one-time backfill.
  - Guards + OWNERSHIP_MAP entry so the split-brain cannot regrow.
- Non-Goals:
  - C4 lifecycle/version-pin semantics (states, leases, `runtimeInstallationId`, successor
    bindings), Conversation identity work, table renames.
  - Headless/job binding — `agent_jobs` columns remain that path's own snapshot.
  - Moving renderer provider pre-resolution (`normalizeClaudeModelSourceForRun`, OAuth divert)
    into main — registered debt from the dual-path audit (c), untouched here.
  - Restructuring `active-chat.tsx` beyond the binding call sites.

## Decisions

**Decision 1: A narrow `sub_chat_bindings` table, not columns on `sub_chats`.**

Schema (Drizzle, `src/main/lib/db/schema/index.ts`):

```ts
export const subChatBindings = sqliteTable(
  "sub_chat_bindings",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    subChatId: text("sub_chat_id")
      .notNull()
      .references(() => subChats.id, { onDelete: "cascade" }),
    runtime: text("runtime").notNull(), // "claude-code" | "codex"
    providerProfileId: text("provider_profile_id"), // nullable
    modelId: text("model_id"), // nullable; interpreted under `runtime`
    modelSource: text("model_source"), // nullable; runtime-scoped source string
    thinkingLevel: text("thinking_level"), // nullable; Codex effort today
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("sub_chat_bindings_sub_chat_idx").on(table.subChatId)],
)
```

*Alternative considered:* columns directly on `sub_chats`, mirroring the `agent_jobs`
precedent. Simpler (binding rides existing selects for free, no join), and `agent_jobs` proves
the column style works.
*Rejected* — the Owner approved this Foundation item specifically "shaped per ratified contract
C4 SessionBinding so Phase 5 Portable Sessions extends instead of re-migrating". C1/C4 ratify
`Conversation → SessionBinding[]` as one-to-many; columns on the conversation row bake in a
one-to-one shape that Phase 5 must then migrate *out* of `sub_chats` — a second truth move of
exactly the kind this change exists to end. The `agent_jobs` precedent does not transfer: a job
is a single execution attempt, inherently 1:1 with its binding snapshot; a conversation is not.
With the table, Phase 5 extends by adding columns (status, installation pin, native identity,
`supersedesBindingId`) and relaxing the unique index — no truth migration. The unique index on
`sub_chat_id` encodes today's invariant (exactly one binding per chat) and is the single thing
Phase 5 relaxes.

Field semantics (Red-flag any deviation — see W7 envelope):

| Field | Claude chat | Codex chat |
| --- | --- | --- |
| `runtime` | `"claude-code"` | `"codex"` |
| `modelId` | renderer Claude model id (e.g. `"fable"`) | Codex model id (e.g. `"gpt-5.5"`) |
| `modelSource` | `"claude-oauth" \| "custom-provider" \| "provider-profile:<id>"` | `"chatgpt" \| "openai-api-key" \| "provider-profile:<id>"` |
| `providerProfileId` | denormalized from `provider-profile:*` source, else `NULL` | same |
| `thinkingLevel` | `NULL` (global `extendedThinkingEnabledAtom` stays a settings toggle) | `"low" \| "medium" \| "high" \| "xhigh"` |

The owner normalizes on write: when `modelSource` is `provider-profile:<id>`,
`providerProfileId` MUST equal `<id>`; when it is not, `providerProfileId` MUST be `NULL`.
`runtime` accepts only the contract runtime ids. `sub_chats.sessionId` is untouched: it stays
the Claude-oriented native-session field, which C1 §3.2 already classifies as provenance, not
binding truth.

**Decision 2: Canonical owner is a single main-process module.**

`src/main/lib/chat-session-binding.ts` (patterned on `src/main/lib/job-store.ts`: one file,
storage + invariants) owns every read and write of `sub_chat_bindings`:

- `getSubChatBinding(subChatId)` / `attachBindingsToSubChats(rows)` — used by `chats.get`
  (`chats-crud.ts:68–90`) and `chats.getSubChat` so the binding rides the existing sub-chat
  DTO; `agent-chat-api.ts` (`toDesktopAgentSubChat`) passes it through to the renderer.
- `seedSubChatBinding(subChatId, input)` — called from `chats.create` (`chats-crud.ts` ~L173)
  and `chats.createSubChat` (`chats-sub-chats.ts` ~L93); creator supplies `runtime` (from the
  renderer's global default atoms), other fields optional.
- `copySubChatBinding(sourceSubChatId, targetSubChatId)` — called from `forkSubChat`
  (`chats-sub-chats.ts` ~L197).
- `updateSubChatBinding(subChatId, patch)` — the only mutation path; enforces normalization.
- `backfillSubChatBindings(db)` — the migration gate (Decision 4).

Routers stay envelope/input surfaces per the existing OWNERSHIP_MAP convention. Shared types
(`ChatSessionBinding`, runtime/source/thinking unions) live in
`src/shared/chat-session-binding.ts` so transports and main share one definition.

*Alternative considered:* folding storage into `chats-sub-chats.ts`. Rejected — routers as
owners is the exact drift OWNERSHIP_MAP exists to prevent, and the backfill must be callable
from DB startup, not from a router.

**Decision 3: Binding is injected at transport construction; updates recreate the transport.**

`IPCChatTransportConfig` / `ACPChatTransportConfig` gain a required `binding:
ChatSessionBinding`. `getOrCreateChat` (`active-chat.tsx` ~L5754) and `createNewSubChat`
(~L6091–6113) already have the sub-chat DTO in hand (`agentSubChats`, from `chats.get`) and
pass `subChat.binding` in. Transport selection becomes `binding.runtime === "codex"` —
deleting `inferProviderFromMessages` (~L5584), the per-render calls (~L6807/6854/6914), the
`subChatProviderOverrides` `useState` (~L4764) and the `instanceof ACPChatTransport`
back-inference (~L5777–5780).

Inside `sendMessages`, the transports replace every `appStore.get(subChat*AtomFamily(...))`
read (`ipc-chat-transport.ts` ~L228–309; `acp-chat-transport.ts` `getSelectedCodexModel`
~L128–134 and source read ~L180) with `this.config.binding`, and both `appStore.set(...)`
write-back sites in the IPC transport are deleted. The OAuth-unusable divert
(`normalizeClaudeModelSourceForRun`) still runs at send time but its result is
**per-send-effective only** — it is never persisted anywhere (previously it wrote back to
localStorage). Non-binding settings reads (`extendedThinkingEnabledAtom`, `historyEnabledAtom`,
offline atoms) are global settings, not binding, and stay as-is.

Mid-conversation binding changes (model/thinking on Codex, model/source on Claude, runtime on
an empty chat) go through `chats.updateSubChatBinding` and then reuse the existing
recreation mechanism (`agentChatStore.delete(subChatId)` + invalidate, generalized from
`handleProviderChange` ~L5963–5998, which is deleted).

*Alternative considered:* transports fetch the binding from tRPC at each `sendMessages`.
Rejected — it keeps the transport a self-serving reader (same shape as the appStore steal-read,
just a different store) and adds an async read per send; construction injection makes the data
flow inspectable at exactly two creator sites.

**Decision 4: Migration gate = table migration + idempotent startup backfill.**

A generated Drizzle migration (next index after `0022_legal_wendell_vaughn.sql`) creates the
table. `backfillSubChatBindings` runs immediately after `migrate()` in
`src/main/lib/db/index.ts` (~L63): for every `sub_chats` row with no binding row, insert
`runtime = inferAgentChatProviderFromMessages(JSON.parse(messages))` (the shared function at
`src/shared/agent-chat-provider.ts:51`, mapped 1:1 onto runtime ids), all other fields `NULL`.
Insert-if-missing makes it idempotent and safe to run every startup. This is the **only**
permitted call site of the inference outside its defining module and tests (guarded).

Per W4.2 (PRE-PRODUCTION / DISPOSABLE TEST DATA) the backfill is deliberately lossy about
renderer-only state: per-sub-chat localStorage model/thinking overrides for existing chats are
not migrated (main cannot read renderer localStorage, and the data stage does not warrant a
renderer-side export hop). Existing chats fall back to `NULL` binding fields, which resolve
through the documented read order (DB > defaults). This loss is accepted and documented here;
it does not touch project/Git data or external consumers.

**Decision 5: localStorage demotion and the temporary dual path.**

After this change the atoms split into two roles:

- `lastSelectedAgentIdAtom` / `projectAgentIdAtomFamily` / `lastSelectedModelIdAtom` /
  `lastSelectedClaudeModelSourceAtom` / `lastSelectedCodexModelSourceAtom` /
  `lastSelectedCodexModelIdAtom` / `lastSelectedCodexThinkingAtom` — **kept, legitimate**:
  defaults used by the creators (`new-chat-form.tsx`, `handleCreateNewSubChat`) to seed the
  binding row of NEW chats. Read order everywhere: DB binding value > these defaults.
- The five per-sub-chat storage families (`subChatModelIdAtomFamily`,
  `subChatClaudeModelSourceAtomFamily`, `subChatCodexModelSourceAtomFamily`,
  `subChatCodexModelIdAtomFamily`, `subChatCodexThinkingAtomFamily`, and their storage atoms)
  — **demoted**: `chat-input-area.tsx` (~L536–561) reads the binding from the sub-chat DTO and
  writes through the mutation; `new-chat-form.tsx` (~L1311–1315) seeds via the creation input
  instead. The definitions are NOT deleted in this change (Owner scope: "no removal of the
  atoms themselves beyond the demotion").

Because the demoted families remain defined while the DB is truth, this is a sanctioned
**temporary dual path** with the five required elements:

1. **Canonical owner**: `src/main/lib/chat-session-binding.ts` (DB truth).
2. **Migration gate**: the Decision 4 backfill.
3. **Deletion date / follow-up**: a `docs/tickets/` ticket filed by this change ("delete the
   demoted per-sub-chat binding atom families"), scheduled for Phase 5 Portable Sessions or
   the next change touching `src/renderer/features/agents/atoms/index.ts`, whichever first.
4. **Boundary test/guard**: the architecture guard (Decision 6) pins the demoted families to
   an allowlist and fails on any reader outside `atoms/index.ts` itself — new readers cannot
   appear; transports are additionally asserted to import no binding atoms.
5. **Deprecation comment**: each demoted definition gets a comment naming the owner module,
   the guard, and the follow-up ticket.

**Decision 6: Guards.**

In `scripts/check-architecture-guards.mjs` (existing framework; atom matcher precedent at
~L1657):

- *Binding-atom freeze*: parse `src/renderer/features/agents/atoms/index.ts`; any
  `atomWithStorage`/storage-backed `atomFamily` whose key or name matches binding semantics
  (`model`, `modelSource`, `thinking`, `agentId`, `runtime`, `provider` — case-insensitive,
  scoped to per-chat keys) must be on the explicit allowlist (the current definitions).
  A new binding-semantics storage atom fails the guard.
- *Demoted-family reader freeze*: the five demoted family names have zero references outside
  `atoms/index.ts` (mirroring the liveness scan in `assertNoDeadSettingsState`).
- *Inference retirement*: `inferAgentChatProviderFromMessages` is referenced only in
  `src/shared/agent-chat-provider.ts`, `src/main/lib/chat-session-binding.ts`, and `tests/`.
- *Transport purity*: `ipc-chat-transport.ts` and `acp-chat-transport.ts` contain no
  `subChat*AtomFamily` identifier.

`docs/OWNERSHIP_MAP.md` gains a "Chat Session Binding" section (owner, consumers, rule:
binding truth is read/written only through the owner; renderer atoms are new-chat defaults
only; metadata inference lives only in the backfill).

## Risks / Trade-offs

- **Empty-chat runtime switch changes from local state to a mutation round-trip.** The
  `subChatProviderOverrides` path was synchronous; the replacement awaits
  `updateSubChatBinding` before recreating the transport. → Mitigation: optimistic cache
  update on the `chats.get` query (the pattern already used by `handleCreateNewSubChat`,
  ~L6019), plus a regression test for switch-then-send-immediately.
- **A sub-chat row without a binding row** (e.g. created by a concurrent older build during
  the transition). → Mitigation: the startup backfill is insert-if-missing on every boot, and
  the owner's read path falls back to `runtime: "claude-code"`-shaped defaults *in memory*
  (never inventing a DB row on read); a unit test covers the missing-row read.
- **Divert no longer persists.** Previously an OAuth-unusable Claude run wrote the diverted
  source back to localStorage; now the divert is per-send only, so a user stays on their
  chosen source until they change it. This is the intended truth semantics; UX surfacing of a
  standing divert is a Yellow follow-up.
- **`chats.get` grows a join/second query.** Trivial for SQLite at this row count; the owner
  batches with a single `IN` select in `attachBindingsToSubChats`.
- **Guard false positives** on the name-based binding-atom scan. → Mitigation: explicit
  allowlist + scoped key-prefix matching (`agents:subChat*`), same style as existing guards.

## Migration Plan

1. Land spec delta + validate (`openspec validate add-chat-session-binding --strict`).
2. Schema + generated migration + owner module + backfill + unit tests (main-only; app still
   reads atoms — DB is written but unread for one commit; acceptable within a single change).
3. tRPC surface: DTO join, creation seeding, fork copy, `updateSubChatBinding`.
4. Renderer point surgery in one commit (W4.2 atomic replacement): transports consume injected
   binding; `active-chat.tsx` / `chat-input-area.tsx` / `new-chat-form.tsx` switch to DTO +
   mutation; delete `subChatProviderOverrides`, `inferProviderFromMessages`, both transport
   steal-read/write-back blocks, `handleProviderChange` override logic.
5. Demote atoms (deprecation comments), guards, OWNERSHIP_MAP, follow-up ticket.
6. Verify: unit tests, `bun run check`, desktop smoke (localStorage-clear survival), then
   closeout gates.

**Rollback:** pre-production/disposable stage — revert the branch; the orphaned
`sub_chat_bindings` table in an existing test profile is inert (no old code reads it) and may
be dropped by a later migration or profile reset. No data-rollback path is required (W4.2).

## Open Questions

- None blocking. Phase 5 questions deliberately deferred (lifecycle states, native identity
  columns, relaxing the unique index, Conversation-level API) — flagged Red if pulled forward.
