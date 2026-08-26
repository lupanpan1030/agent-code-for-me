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
it explicitly. No portable/durable lifecycle model, general execution lease, installation pin,
or API object is introduced — those are Phase 5 (Portable Sessions) and later C4 work. The sole
exception is the Owner-authorized, process-local rollback maintenance fence in Decision 7. It
coordinates only rollback with a new desktop Run's final claim and carries a mandatory Phase 5
absorption/deletion note; it is not SessionBinding lease state. The data stage is
**PRE-PRODUCTION / DISPOSABLE TEST DATA** (W4.2 Owner decision), which authorizes a simple
forward-only migration with no data-rollback path, while still requiring the backfill to be
named and verified as the migration gate.

## Goals / Non-Goals

- Goals:
  - One durable, main-process-owned truth for each chat's runtime/model/source/thinking/profile
    binding, shaped so Phase 5 extends it (add columns / relax uniqueness) instead of
    re-migrating truth out of `sub_chats`.
  - Transports consume binding via constructor injection; zero `appStore` binding reads or
    write-backs in `sendMessages`.
  - Retire message-metadata provider inference everywhere except the one-time backfill.
  - Guards + OWNERSHIP_MAP entry so the split-brain cannot regrow.
  - Prevent destructive rollback from racing either Engine's active Run or final Run claim,
    without creating durable state or a second general execution owner.
- Non-Goals:
  - C4 lifecycle/version-pin semantics (states, durable SessionBinding leases,
    `runtimeInstallationId`, successor bindings), Conversation identity work, table renames.
  - Headless/job binding — `agent_jobs` columns remain that path's own snapshot.
  - Moving renderer provider pre-resolution (`normalizeClaudeModelSourceForRun`, OAuth divert)
    into main — registered debt from the dual-path audit (c), untouched here.
  - Adding reasoning-effort support to Codex Provider Profiles. Their gateway advertises only
    `none`; protocol-specific translation and capability declaration require a separately
    approved change and are tracked, but not authorized, by TICKET-116.
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
| `thinkingLevel` | `NULL` (global `extendedThinkingEnabledAtom` stays a settings toggle) | `"low" \| "medium" \| "high" \| "xhigh"` for sources that advertise selectable effort; `NULL` for Provider Profiles, whose current gateway capability is reasoning `none` only |

The owner normalizes on write: when `modelSource` is `provider-profile:<id>`,
`providerProfileId` MUST equal `<id>`; when it is not, `providerProfileId` MUST be `NULL`.
An explicit Profile selection snapshots that Profile's current `defaultModel` into `modelId`
in the same write. Provider credentials/protocol routing remain dynamic, but later Profile
edits MUST NOT override an existing binding's model at renderer, main-runtime, or gateway
boundaries. Leaving a Profile likewise writes source/profile/model/thinking as one mutation.
For creation, entering a Profile, or explicitly reselecting a Profile model, the owner requires
the Profile to exist, target the binding runtime, and have `defaultModel === modelId`; this
prevents a caller from manufacturing a historical Profile snapshot. Fork is intentionally
different: it copies the source chat's complete historical tuple without consulting the
current Profile row, so an edited or deleted Profile cannot mutate fork provenance.
`runtime` accepts only the contract runtime ids. The `sub_chats.sessionId` column stays the
Claude-oriented native-session provenance field classified by C1 §3.2, but its authority is
main-only: renderer chat schemas and transports do not accept or submit a native `sessionId`,
and the unused `updateSubChatSession` renderer mutation is deleted. Claude resume/parent
identity comes from the main-owned sub-chat row; Codex resume/parent identity comes from the
main-read persisted message history. A stale or forged renderer therefore cannot select or
rewrite another native session.

Capability-honesty exception (Owner decision 2026-08-26): the current Provider Profile gateway
advertises `supported_reasoning_levels = [none]`. Therefore a Codex Provider Profile binding
MUST normalize `thinkingLevel` to `NULL`, the renderer MUST hide its effort selector, and the
transport keeps submitting `/none`. Persisting low/medium/high/xhigh while the gateway ignores
it would be false capability state. Real Provider Profile effort support requires per-protocol
translation and explicit provider capability declarations and is deferred to TICKET-116.
The Codex responses gateway treats the model snapshot carried by a `codex-chat-binding` token
as the sole upstream model authority. The app-server may submit that opaque model with the
reserved final `/none` transport suffix, but the gateway forwards the token-bound snapshot;
an arbitrary request-body model cannot expand the token's authority. Anthropic model IDs remain
verbatim. The gateway does not translate or advertise another effort. This decode is scoped by
the server-minted gateway token: desktop Codex requests `codex-chat-binding` model resolution,
desktop Claude requests `claude-chat-binding` verbatim resolution, and the default
`legacy-profile-default` behavior remains isolated to headless/Local Job callers. Request
bodies, headers, and query parameters cannot opt into another model-resolution mode or model.

This is a token capability, not a client option. Desktop tokens are minted only by the
main-process chat startup owners; the unchanged headless owner never reads
`sub_chat_bindings`, and its default token retains `legacy-profile-default`. The Local Job API
schema and `agent_jobs.runtime` / `providerProfileId` admission snapshot remain independent.
For a `codex-chat-binding` token, the main owner also embeds the DB-admitted `modelId` (without
the reserved `/none` transport marker) in that same token scope. Authenticated `/models`
advertises this immutable catalog model rather than re-reading the Profile's mutable current
default. Other token modes carry no such snapshot and retain their existing catalog behavior;
there is no second registry or client-selectable override.

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
- `updateSubChatBinding(subChatId, patch)` — the only mutation path; enforces normalization
  and synchronously rejects every mutation while either the Codex or Claude active-run owner
  holds that sub-chat. This includes same-runtime model/Profile/effort edits as well as runtime
  switches.
- `backfillSubChatBindings(db)` — the migration gate (Decision 4).
- `admitCodexChatSessionBindingRun` / `admitClaudeChatSessionBindingRun` — desktop Run
  admission after preflight and before any active-run replacement. The owner re-reads the DB
  row and exact-checks runtime/source/profile/model/effort against renderer input, returning
  only canonical values to startup. Claude permits one documented run-scoped exception:
  OAuth/custom-provider may divert to a valid Claude-targeted Profile when the request omits
  the bound model. Unknown or malformed sources fail closed and never fall through to OAuth.

Binding admission alone is not enough to authorize active-state replacement. Chat/sub-chat/cwd
preflight and scope controls also complete first. Each candidate reserves a per-sub-chat
admission generation before its first asynchronous control; after the last `await`, only the
latest generation may synchronously abort/replace the active run. A failed, cancelled, or stale
candidate never restores an earlier generation and never touches the current active owner.
Guarded scope validation and pre-run status capture likewise remain candidate-local during
preflight: the contract enters the global active registry only after the candidate wins its
admission claim and creates the active envelope. Cleanup compare-deletes the exact contract
object, so a late old Run cannot delete a new Run that reused or replaced the renderer contract
ID. Contract activation also revokes any earlier contract for the same sub-chat, regardless of
renderer contract ID, so the registry cannot retain two Runs' authority for one lifecycle owner.
The sole registry is keyed by `subChatId`, never by renderer-supplied contract ID, and exposes
only winner publication, exact-object current checks, and exact compare-delete. The retired
prepare-and-publish compatibility wrapper/raw mutation exports are deleted so preflight cannot
activate authority through a second path.
This generation is an admission-order guard, not a second active-session registry.

Active lifecycle authority also uses exact installed-owner identity, never the renderer-supplied
`runId` alone. Codex installs one `ActiveCodexStream` object and passes that same object through
desktop-job cancellation, natural-finish persistence, finalization, and unsubscribe cleanup.
Each path compares the object against the current registry entry before mutating active state,
clearing approvals, or persisting either side of the conversation. Claude applies the equivalent
rule with its exact installed active-session controller/signal. Both engines recheck their exact
owner immediately before every user/assistant/error history write, so an old Run cannot alias a
new Run that happens to reuse the same external `runId`. A stale candidate stops before later
MCP, job, or adapter dispatch. The check repeats after every nested asynchronous preparation and
retry backoff immediately before the actual adapter/SDK query call. Codex transport stop,
auth-error teardown, and replacement cleanup unsubscribe the exact subscription closure; no
public mutation accepting only `subChatId` or external `runId` remains.
For native Codex app-server requests, exact authority is checked once more in the same
synchronous callback immediately before the protocol response is written to the child. Losing
the Run or guarded-contract owner during any approval Promise gap fails closed and can never
write an allow/accept response. Claude relies on the exact Run signal shared with the official
SDK transport, whose final write boundary checks the same aborted signal.

Pending approval identity is separate from provider tool identity. Main mints a unique
`approvalId` for every pending Codex or Claude question, keys the pending store and renderer
response by that ID, and carries the provider `toolUseId` separately for tool-part association.
Resolution and timeout compare-delete the exact pending object and exact active Run owner. Thus a
late response or timeout from Run A cannot approve, remove, or clear Run B even when the runtime
reuses the same `toolUseId`, sub-chat, and external `runId`.
Renderer retirement follows the same tuple: after a response receipt (including `ok: false`) it
compare-deletes only the captured `{subChatId, approvalId, toolUseId}`. If question B replaced A
while A awaited main, A's continuation cannot hide B; a transport exception leaves exact A
visible for retry and surfaces the error.

Guarded tool authority follows the same identity rule. Claude tool callbacks require the active
guard registry to contain the exact captured contract object before deciding a tool and again
after any asynchronous user approval. The later `canUseTool` consumption of a cached
`PreToolUse` decision repeats the same exact-object check. Installing a newer contract revokes
the previous contract for that sub-chat even if its renderer ID differs; no newer contract is
substituted. Scope expansion mutates the installed object in place, so this exact-object rule
preserves valid expansions without granting an old callback a newer Run's scope.

The active-run mutation fence is likewise not a Phase 5 lifecycle lease. Because binding
mutation and active-owner registration occur synchronously in one main-process event loop, the
canonical owner can atomically reject mutations after a Run has claimed active ownership.
Before that claim exists, a mutation remains allowed and the candidate Run's mandatory final
DB re-admission invalidates its stale tuple. No pending-preflight registry or durable lock is
introduced.

This binding-mutation rule is distinct from the rollback maintenance fence in Decision 7. The
latter has its own canonical owner and coordinates only destructive rollback with the final
claim of a new desktop Run; neither mechanism is generalized into a durable SessionBinding
lease in Foundation 1b.

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

When that run-scoped divert selects a Profile for a non-Profile binding, the transport omits
the original binding model for that run so the diverted Profile can use its current default;
the durable source/model binding remains untouched. This is distinct from an explicitly bound
Profile, whose snapshotted `modelId` stays authoritative across Profile edits.

Mid-conversation binding changes (model/thinking on Codex, model/source on Claude, runtime on
an empty chat) go through `chats.updateSubChatBinding` and then reuse the existing
recreation mechanism (`agentChatStore.delete(subChatId)` + invalidate, generalized from
`handleProviderChange` ~L5963–5998, which is deleted).

Recreation is receipt-first, not optimistic: the renderer awaits the owner mutation, publishes
the returned canonical binding into the query cache and local DTO reference, deletes the old
transport, explicitly creates the replacement `Chat` from the published DTO, and only then
notifies a still-mounted view. Canonical receipt publication does not depend on the target view
remaining mounted: normal parent-workspace navigation, resident-tab eviction, or explicit close
can occur while the mutation awaits main without leaving the continuously mounted query/DTO
cache stale. A successful receipt always updates the canonical query and local DTO reference
first; cancellation is checked immediately before deleting/recreating/sending through a Chat.
Therefore explicit close never resurrects UI work, while a later history reopen constructs the
transport from the committed binding.
`getChatViewInstanceKey` includes the binding revision so a same-sub-chat-id view remounts
instead of retaining a stale Chat object; a real React regression test covers this case.

All existing-chat send and lifecycle entry points share one per-sub-chat serialization gate:
direct sends, queued sends, initial-message regeneration, stream resume, and binding mutation.
Every direct submit captures its uncontrolled editor/attachment payload and claims its durable
draft before awaiting a pending binding mutation, because the mutation receipt may remount the
same chat ID and detach the submitting component. After acquiring the gate, direct sends,
queued sends, regeneration, and resume resolve the current `Chat`/transport from
`agentChatStore`; none closes over a mounted component's `useChat` send/regenerate/resume
callback. Actions that must replace an active run (force-send, empty-input queue drain, and a
live question answer followed by custom text) stop/release that run before awaiting a binding
mutation queued behind it; ordinary sends await the pending mutation directly. This ordering
prevents payload loss, stale-transport sends, duplicate restored drafts, and stop/wait
deadlocks.

The pending-operation context captured before those awaited preparation steps is also the
cancellation authority for every nested binding/current-Chat gate. A nested gate MUST reuse
that inherited context rather than capture the post-close generation. Each awaited binding
wait, slash-command expansion, stop/readiness wait, and live-question continuation rechecks the
inherited context before queue publication, current-Chat lookup, or send. Therefore close →
same-ID reopen cannot let an old prompt execute through the replacement Chat; a genuinely new
post-reopen user operation receives a new context and remains independent.

The same operation owner also controls renderer eviction. Parent-workspace pruning,
resident-tab bounding, and detached-finish cleanup all retain a `Chat` while a captured direct
submit, binding mutation, regeneration, or resume is pending. An explicit user tab close is the
only path that cancels that pending UI work. Binding mutation publishes any successful
main-process receipt to canonical cache/ref even after cancellation, then checks cancellation
before recreating or sending, so explicit close does not reopen the tab or lose committed truth.
Operation counts and cancellation generations
are removed when the last operation releases; deferred normal-eviction callbacks then recheck
the current mount/stream/queue state so a completion callback cannot retain a detached Chat
forever merely because its send promise had not yet unwound. They are not another durable state
owner. If explicit close races a queue item that was already popped, gate exit normalizes the
result/error to cancellation and both queue senders drop that item instead of requeueing it
after `clearQueue`.

Initial-message auto-generation also owns a module-scoped claim keyed by stable sub-chat and
initial-message identity. The claim is acquired before entering the gate, survives a
binding-sensitive React remount, and is retained after success; only the exact failed claim is
released for a later retry. This is separate from active Run state: it prevents the old and new
mount from both queuing the same initial prompt while the binding mutation owns the gate.

Persisted stream resume is part of the same lifecycle boundary. The DTO mapper accepts the
Drizzle `streamId` field (and the legacy snake-case wire spelling), and a per-key claim prevents
duplicate resume on remount. The claim owner lives outside the React component lifecycle and
retains at most the current stream key per sub-chat; a failed resume releases only its own claim
so a later render can retry without clearing a newer stream's claim. If the outer current-Chat
gate fails before the resume or initial-generation helper receives control (for example after
an explicit close), that outer failure releases the exact claim as well.

For non-Profile Codex bindings, `modelSource` is also strict binding truth. Credential probes
are admission/readiness checks only: a ChatGPT-bound chat is never silently rewritten to
`openai-api-key`, and an API-key-bound chat is never silently rewritten to `chatgpt`. Changing
the app-managed API-key state updates the global new-chat source/model/thinking defaults as one
coherent write, but never changes an existing chat binding.
Auth-error retry follows the same rule: only subscription availability can make a `chatgpt`
binding retry-ready, and only the app-managed API key can make an `openai-api-key` binding
retry-ready. An unrelated credential neither triggers a doomed retry nor selects the error
diagnostic. The pending retry records its required Codex auth method; the login modal preselects
that method and unlocks the retry only when the same method reaches success.

Every pending auth retry also records the exact non-secret binding identity, including runtime,
source, Profile, model, effort, and binding revision. Each constructed transport owns an opaque
per-sub-chat generation. A replacement transport retires the old generation, and both Codex's
asynchronous credential probe and Claude's auth-error publisher verify that ownership before
publishing a retry. Consumption repeats the exact binding check inside the current-Chat gate.
Therefore an old prompt cannot be published or auto-sent through a newly selected Profile or
credential endpoint.

The same tuple-coherence rule applies to settings and onboarding Profile operations. Save,
delete, runtime-target removal, and default selection update source/model/thinking together
when the affected Profile is the global default; API-key save/remove does the same for its
source. An existing chat whose Profile becomes unavailable keeps displaying its bound Profile
source as unavailable and blocks honestly until the user explicitly rebinds; it never
masquerades as OAuth.

For Codex Provider Profiles, model/source changes still use this path, but thinking selection
is absent because that source currently declares only reasoning `none`; its binding stores
`thinkingLevel = NULL`. The transport's `/none` suffix is a capability result, not a second
binding owner.

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
The existing-binding scan is independent of the number of sub-chat IDs (it does not construct
one unbounded SQLite `IN (...)` parameter list), so a large local history cannot exceed the
driver's bind-variable limit during startup. The canonical owner's list hydration also chunks
`attachBindingsToSubChats` lookups into at most 500 IDs per query, so opening an unpaginated Chat
cannot recreate the same bind-variable failure through a second read shape.

Per W4.2 (PRE-PRODUCTION / DISPOSABLE TEST DATA) the backfill is deliberately lossy about
renderer-only state: per-sub-chat localStorage model/thinking overrides for existing chats are
not migrated (main cannot read renderer localStorage, and the data stage does not warrant a
renderer-side export hop). Existing chats fall back to `NULL` binding fields, which resolve at
send time through the runtime-default handling the transports already apply when no explicit
selection exists — localStorage is not consulted for existing chats. This loss is accepted and
documented here; it does not touch project/Git data or external consumers.

**Decision 5: Delete the per-sub-chat binding atoms — no temporary dual path.**

After this change the atoms split into two fates:

- `lastSelectedAgentIdAtom` / `projectAgentIdAtomFamily` / `lastSelectedModelIdAtom` /
  `lastSelectedClaudeModelSourceAtom` / `lastSelectedCodexModelSourceAtom` /
  `lastSelectedCodexModelIdAtom` / `lastSelectedCodexThinkingAtom` — **kept, legitimate**:
  defaults used by the creators (`new-chat-form.tsx`, `handleCreateNewSubChat`) to seed the
  binding row of NEW chats. They apply only at creation time; existing chats read the DB
  binding only, and localStorage is never consulted for an existing chat.
- The five per-sub-chat storage families (`subChatModelIdAtomFamily`,
  `subChatClaudeModelSourceAtomFamily`, `subChatCodexModelSourceAtomFamily`,
  `subChatCodexModelIdAtomFamily`, `subChatCodexThinkingAtomFamily`, and their storage atoms)
  — **deleted in this same change, together with all their remaining read/write call sites**
  (Owner decision 2026-08-26): `chat-input-area.tsx` (~L536–561) reads the binding from the
  sub-chat DTO and writes through the mutation; `new-chat-form.tsx` (~L1311–1315) seeds via
  the creation input instead. Once transports and UI read/write binding via the DB-backed DTO
  and `updateSubChatBinding`, the families have zero legitimate readers; atomic same-change
  replacement matches the repo's no-dual-path rule (W4.2/C7). Stale per-sub-chat localStorage
  keys on disk are simply no longer read — no cleanup migration (pre-production data policy).

**No temporary dual path**: with the families deleted, the DB binding is the only truth for
existing chats from the moment this change lands, so no deprecation comments, reader-freeze
allowlist, or deletion follow-up ticket is needed. The global `lastSelected*` atoms are not a
dual path because they only seed new-chat defaults and never describe an existing chat's
binding.

**Decision 6: Guards.**

In `scripts/check-architecture-guards.mjs` (existing framework; atom matcher precedent at
~L1657):

- *Binding-atom ban*: scan all `src/renderer/**/*.{ts,tsx}` sources; any
  `atomWithStorage`/storage-backed `atomFamily` whose key or name matches binding semantics
  (`model`, `source`, `thinking`, `effort`, `agentId`, `engine`, `runtime`, `provider`,
  `profile` — case-insensitive,
  scoped to per-chat keys) fails the guard. No allowlist is needed: no per-chat binding
  storage atom may exist at all, so the five deleted families cannot reappear.
- *Deleted-family residue*: the five deleted family identifiers have zero references anywhere
  in `src/` (mirroring the liveness scan in `assertNoDeadSettingsState`).
- *Inference retirement*: `inferAgentChatProviderFromMessages` is referenced only in
  `src/shared/agent-chat-provider.ts`, `src/main/lib/chat-session-binding.ts`, and `tests/`.
- *Transport purity*: `ipc-chat-transport.ts` and `acp-chat-transport.ts` contain no
  `subChat*AtomFamily` identifier.
- *Table ownership*: `subChatBindings` / `sub_chat_bindings` may appear only in the DB schema
  and `src/main/lib/chat-session-binding.ts`; routers and other consumers must use the owner.

`docs/OWNERSHIP_MAP.md` gains a "Chat Session Binding" section (owner, consumers, rule:
binding truth is read/written only through the owner; renderer atoms are new-chat defaults
only; metadata inference lives only in the backfill).

**Decision 7: Rollback and a new desktop Run's final claim share one temporary in-memory
maintenance fence.**

`src/main/lib/agent-runtime/chat-maintenance-fence.ts` is the canonical owner of one exact
maintenance token per sub-chat, exact rollback-only blockers for claimed-but-unsettled desktop
Run lifecycles, and one-shot admission rejection receipts. The owner is intentionally next to
`desktop-run-admission-generation.ts`, because it participates only in desktop Run admission
and maintenance ordering. Its tokens, blockers, and one-shot rejection receipts are
main-process in-memory structures: they are not written to SQLite, create no schema column,
never change `agent_jobs`, never change `sub_chat_bindings`, and are empty after process
restart.

The only permitted interaction is:

1. `rollbackToMessage` synchronously checks that neither Claude nor Codex owns an active Run
   for the sub-chat, then acquires an exact maintenance token. An active owner rejects the
   rollback before checkpoint/Git/history mutation. Signal-aware runtime and persistence checks
   reject an aborted owner, but rollback continues to see every claimed lifecycle's exact
   rollback blocker until side effects have settled.
2. The rollback holds that token through sub-chat/checkpoint re-read, exact checkpoint
   validation, destructive Git application, and message-history truncation. It compare-releases
   only its exact token in `finally`, whether rollback succeeds, returns a failure, or throws.
3. Each Claude and Codex desktop Run checks the same owner immediately before its final active
   claim. A held rollback token rejects that claim; it does not cancel, replace, or queue the
   candidate. A successful claim atomically creates an exact rollback-only lifecycle blocker,
   and only the corresponding supervised lifecycle `finally` releases it. The fence check,
   blocker creation, and active-owner install stay synchronous in the main-process event loop,
   so rollback cannot enter between the final check and claim.
4. These lifecycle blockers do not arbitrate or authorize Run versus Run. Successor B may start
   while aborted predecessor A drains. If B settles first, exact cleanup releases only B; A
   continues to make rollback BUSY even when both share an external Run ID, B removed the single
   current-owner entry, or renderer reload cleanup cleared that registry. Only A's actual
   supervised finalization releases A.
5. If rollback wins against a Run candidate that was already reserved, the owner retains only
   an exact, process-local rejection tombstone for that candidate. Its later final claim consumes
   the tombstone and returns the same structured maintenance BUSY result even if rollback has
   already released its token. Ordinary latest-request-wins staleness remains silent and is not
   reclassified. The tombstone is neither durable state nor a waiting/execution lease and is
   cleared by process restart.

Codex user, duplicate-prompt authority, and assistant persistence likewise require both the
exact installed stream object and its captured controller to remain non-aborted immediately at
the write barrier. Retaining an aborted owner for lifecycle cleanup never authorizes a late DB
write.

The structured conflict shape is deliberately named for future C4.1 absorption:

```ts
{
  code: "SESSION_BINDING_BUSY"
  subChatId: string
  operation: "rollback"
  activeRunId: string | null
  reason: "active-run" | "maintenance"
}
```

When an active Run blocks rollback, `activeRunId` is that exact installed owner's external Run
identifier and `reason` is `active-run`. When rollback maintenance blocks a new final claim,
`activeRunId` is `null` and `reason` is `maintenance`. Foundation 1b uses `subChatId`, not a
durable `bindingId`, because this temporary owner is scoped to today's one-binding-per-chat
desktop implementation and MUST NOT pretend to be the C4 SessionBinding lease.

This is not a general execution, binding-mutation, headless/job, workspace, or pending-preflight
lease. A lifecycle blocker is negative rollback authority only: it cannot admit, cancel, wait
for, renew, or exclude another Run. The owner has no waiting/renewal/recovery semantics and does
not survive a Host/process crash.
Phase 5's durable C4 SessionBinding lease design MUST absorb or replace this ordering rule and
delete `chat-maintenance-fence.ts`; carrying both owners forward is forbidden. The
`OWNERSHIP_MAP` entry contains this explicit absorption/deletion condition.

*Alternative considered:* treat rollback as another binding mutation under
`chat-session-binding.ts`. Rejected — rollback mutates Git and message history, not binding
truth, and folding it into the durable binding owner would misrepresent this narrow precursor
as SessionBinding lifecycle authority.

**Decision 8: Rollback checkpoint authority is a unique main-minted ref bound to an exact
OID.**

Checkpoint capture first creates a private draft ref, then publishes a never-reused
`refs/locus-checkpoints/<uuid>` public ref with compare-and-create semantics. Persisted assistant
metadata marks rollback available only when it contains all three canonical fields:
`rollbackCheckpointAvailable: true`, that unique `rollbackCheckpointRef`, and the exact
40- or 64-hex `rollbackCheckpointOid`. Runtime-supplied paths or legacy SDK UUID-derived refs
cannot become rollback authority. Two Runs A/B with the same SDK message UUID therefore receive
different public refs, and stale A cleanup can compare-delete only A's exact ref/OID without
altering B.

Publication and DB persistence fail closed. If public-ref publication fails, the assistant row
records `rollbackCheckpointAvailable: false` and stores no ref/OID. If the DB transaction throws
after publication, exact compare-delete retracts that public ref and the old message row remains
unchanged. Rollback accepts only canonical availability/ref/OID metadata, resolves the ref and
requires it to equal the recorded OID before any `read-tree`, `checkout-index`, `clean`, or
history truncation, and rechecks the same binding immediately before application. Missing,
unavailable, malformed, moved, or wrong-OID checkpoints return failure with both worktree and
message history unchanged.

The unused `updateSubChatMessages` tRPC mutation is deleted in this same change. It allowed an
arbitrary renderer-supplied history replacement without checkpoint/Git coupling and would be a
second history-write path. `rollbackToMessage` remains the only renderer envelope for this
maintenance operation and delegates checkpoint authority to the shared metadata/Git helpers.

## Risks / Trade-offs

- **Empty-chat runtime switch changes from local state to a mutation round-trip.** The
  `subChatProviderOverrides` path was synchronous; the replacement awaits
  `updateSubChatBinding` before recreating the transport. → Mitigation: publish the canonical
  mutation receipt before transport recreation, serialize switch/send through the gate, and
  cover switch-then-send-immediately plus same-id remount in regression tests.
- **Same-ID remount can replay an initial prompt.** A component-local auto-generation ref resets
  when binding recreation remounts the view, allowing both mounts to queue generation. →
  Mitigation: a bounded module-scoped claim keyed by sub-chat/message identity, plus a real
  React + AI SDK replacement-Chat regression proving one transport execution.
- **A sub-chat row without a binding row** (e.g. created by a concurrent older build during
  the transition). → Mitigation: the startup backfill is insert-if-missing on every boot, and
  the owner's read path falls back to `runtime: "claude-code"`-shaped defaults *in memory*
  (never inventing a DB row on read); a unit test covers the missing-row read.
- **Divert no longer persists.** Previously an OAuth-unusable Claude run wrote the diverted
  source back to localStorage; now the divert is per-send only, so a user stays on their
  chosen source until they change it. This is the intended truth semantics; UX surfacing of a
  standing divert is a Yellow follow-up.
- **Provider Profile reasoning remains `none`.** Exposing low..xhigh would claim a capability
  the gateway does not advertise. → Mitigation: normalize the binding field to `NULL`, hide
  the selector, and track real per-protocol support in TICKET-116.
- **`chats.get` grows a join/second query.** Trivial for SQLite at this row count; the owner
  batches with a single `IN` select in `attachBindingsToSubChats`.
- **Guard false positives** on the name-based binding-atom scan. → Mitigation: scoped
  key-prefix matching (`agents:subChat*`) plus the semantic-term list, same style as existing
  guards; `subChatModeAtomFamily` (mode, not binding) and the global `lastSelected*` atoms
  fall outside the per-chat binding scan by construction.
- **The maintenance fence is process-local.** A process crash clears it rather than recovering
  a durable operation. → Mitigation: rollback and desktop Runs already cannot survive that
  process; Foundation does not claim recovery semantics. Phase 5 must replace this owner with
  the durable C4 lease rather than extending the map.
- **Checkpoint publication and message persistence are separate effects.** A publication or DB
  failure could otherwise leave false authority or an orphan ref. → Mitigation: availability
  is explicit, public refs are unique and compare-created, post-publication DB failure retracts
  only the exact ref/OID, and destructive rollback verifies exact metadata before touching the
  worktree.

## Migration Plan

1. Land spec delta + validate (`openspec validate add-chat-session-binding --strict`).
2. Schema + generated migration + owner module + backfill + unit tests (main-only; app still
   reads atoms — DB is written but unread for one commit; acceptable within a single change).
3. tRPC surface: DTO join, creation seeding, fork copy, `updateSubChatBinding`.
4. Renderer point surgery in one commit (W4.2 atomic replacement): transports consume injected
   binding; `active-chat.tsx` / `chat-input-area.tsx` / `new-chat-form.tsx` switch to DTO +
   mutation; delete `subChatProviderOverrides`, `inferProviderFromMessages`, both transport
   steal-read/write-back blocks, `handleProviderChange` override logic, and the five
   per-sub-chat binding atom family definitions.
5. Add the narrow rollback maintenance owner, wire both desktop final-claim paths, harden
   checkpoint ref/OID authority, and delete `updateSubChatMessages` in the same change.
6. Guards, OWNERSHIP_MAP, including the mandatory Phase 5 fence absorption/deletion note.
7. Verify: unit tests, `bun run check`, desktop smoke (localStorage-clear survival), then
   closeout gates.

**Rollback:** pre-production/disposable stage — revert the branch; the orphaned
`sub_chat_bindings` table in an existing test profile is inert (no old code reads it) and may
be dropped by a later migration or profile reset. No data-rollback path is required (W4.2).

## Open Questions

- None blocking. Phase 5 questions deliberately deferred (lifecycle states, native identity
  columns, relaxing the unique index, Conversation-level API) — flagged Red if pulled forward.
  Phase 5 has one mandatory input rather than an open question: absorb/replace the temporary
  `chat-maintenance-fence.ts` owner with its durable C4 SessionBinding lease and delete the
  temporary owner so no dual fence survives.
