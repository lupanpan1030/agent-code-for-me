# Tasks: Persist chat session binding truth in the database

## 1. Pre-flight

- [ ] 1.1 Confirm the audit anchors still hold at implementation time (line numbers are hints;
      anchor on symbols): `subChats` table has no binding columns
      (`src/main/lib/db/schema/index.ts`); `inferAgentChatProviderFromMessages`
      (`src/shared/agent-chat-provider.ts:51`) has exactly one non-defining call site
      (`active-chat.tsx` `inferProviderFromMessages`); both transports read
      `subChat*AtomFamily` atoms from `appStore` in `sendMessages`
      (`ipc-chat-transport.ts` ~L228–309 incl. two `appStore.set` write-backs;
      `acp-chat-transport.ts` `getSelectedCodexModel` ~L128 and source read ~L180).
- [ ] 1.2 Confirm no active change conflicts on `sub_chats` schema or the `chats-*` routers
      (`openspec list`; coordinate especially with the Foundation batch sibling
      `refactor-codex-desktop-service-extraction` — soft-ordered before this change).
- [ ] 1.3 Capture a baseline: `bun run check` output on the pre-change commit.

## 2. Specs first

- [ ] 2.1 Land the `chat-session-binding` ADDED delta from this change directory.
- [ ] 2.2 `openspec validate add-chat-session-binding --strict --no-interactive` → valid.

## 3. Schema, owner module, backfill (main process)

- [ ] 3.1 Add `subChatBindings` to `src/main/lib/db/schema/index.ts` per design.md Decision 1
      (unique index on `sub_chat_id`, FK cascade to `sub_chats`); generate the Drizzle
      migration (next index after `0022_legal_wendell_vaughn.sql`).
- [ ] 3.2 Add `src/shared/chat-session-binding.ts`: `ChatSessionBinding` type, runtime union
      (`"claude-code" | "codex"`), source/thinking unions, and the
      provider-profile-source ↔ `providerProfileId` consistency helper.
- [ ] 3.3 Add canonical owner `src/main/lib/chat-session-binding.ts`:
      `getSubChatBinding`, `attachBindingsToSubChats` (batched `IN` select),
      `seedSubChatBinding`, `copySubChatBinding`, `updateSubChatBinding` (normalizing writes,
      rejecting unknown runtimes), `backfillSubChatBindings` (insert-if-missing; runtime from
      `inferAgentChatProviderFromMessages`, all other fields `NULL`).
- [ ] 3.4 Invoke `backfillSubChatBindings` right after `migrate()` in
      `src/main/lib/db/index.ts` (~L63). ACCEPTANCE: running startup twice inserts no second
      row and modifies no existing row.
- [ ] 3.5 Unit tests: backfill inference (metadata `provider`, `codex`/`gpt-` model-string
      fallback, `claude-code` default), backfill idempotency, missing-binding-row read
      fallback (in-memory defaults, no row invented), write normalization
      (profile-source consistency, runtime enum rejection), fork copy.

## 4. tRPC surface (envelopes only; logic in the owner)

- [ ] 4.1 `chats.get` (`chats-crud.ts:68–90`) and `chats.getSubChat` return `binding` on each
      sub-chat via `attachBindingsToSubChats`; pass it through
      `agent-chat-api.ts` `toDesktopAgentSubChat`.
- [ ] 4.2 `chats.create` (`chats-crud.ts` ~L173) and `chats.createSubChat`
      (`chats-sub-chats.ts` ~L93) accept optional binding input (runtime required from the
      creator) and call `seedSubChatBinding` in the same flow.
- [ ] 4.3 `forkSubChat` (`chats-sub-chats.ts` ~L197) calls `copySubChatBinding`.
- [ ] 4.4 Add `chats.updateSubChatBinding` mutation delegating to the owner.

## 5. Renderer point surgery (one commit — W4.2 atomic replacement, no dual read path)

- [ ] 5.1 Transports: add required `binding` to `IPCChatTransportConfig` /
      `ACPChatTransportConfig`; replace every `appStore.get(subChat*AtomFamily(...))` in
      `sendMessages` with `this.config.binding`; delete both `appStore.set` write-back sites
      in `ipc-chat-transport.ts` (normalized-source and divert write-backs — the divert result
      becomes per-send-effective only); delete `getSelectedCodexModel`'s atom reads in
      `acp-chat-transport.ts`. ACCEPTANCE: neither transport file contains a
      `subChat*AtomFamily` identifier or a binding-atom import.
- [ ] 5.2 `active-chat.tsx`: `getOrCreateChat` (~L5754) and the `createNewSubChat` transport
      block (~L6091–6113) select the transport from `subChat.binding.runtime` and inject
      `binding`; delete `inferProviderFromMessages` (~L5584), its per-render call sites
      (~L6807/6854/6914), the `subChatProviderOverrides` `useState` (~L4764) and its reset
      effect, and the `instanceof ACPChatTransport` back-inference (~L5777–5780).
- [ ] 5.3 Replace `handleProviderChange` (~L5963–5998): empty-chat runtime switch calls
      `chats.updateSubChatBinding`, optimistically updates the `chats.get` cache, then
      `agentChatStore.delete(subChatId)` to force transport recreation. Regression test:
      switch runtime then send immediately.
- [ ] 5.4 `chat-input-area.tsx` (~L536–561): model/source/thinking selectors read from the
      sub-chat DTO `binding` and write through `updateSubChatBinding`; keep updating the
      global `lastSelected*` defaults as today. Binding updates recreate the transport.
- [ ] 5.5 `new-chat-form.tsx` (~L1311–1315) and `handleCreateNewSubChat`
      (`active-chat.tsx` ~L6001): seed the creation mutation's binding input from the global
      default atoms instead of writing per-sub-chat atom families.
- [ ] 5.6 `bun run ts:check`; the compiler enumerates any missed reader of the demoted
      families on the existing-chat path.

## 6. Demotion, guards, ownership registration

- [ ] 6.1 Add deprecation comments to the five demoted per-sub-chat storage families in
      `src/renderer/features/agents/atoms/index.ts` naming the owner module, the guard, and
      the follow-up ticket. Do NOT delete the definitions (Owner scope).
- [ ] 6.2 File the follow-up ticket under `docs/tickets/`: delete the demoted families in
      Phase 5 Portable Sessions or the next change touching that atoms file.
- [ ] 6.3 `scripts/check-architecture-guards.mjs`: add the four assertions from design.md
      Decision 6 (binding-atom allowlist freeze; zero readers of demoted families outside
      `atoms/index.ts`; `inferAgentChatProviderFromMessages` call sites limited to its module,
      the owner backfill, and tests; transport files free of binding-atom identifiers).
      ACCEPTANCE: each guard demonstrably fails when its rule is violated on a scratch edit.
- [ ] 6.4 `docs/OWNERSHIP_MAP.md`: add the "Chat Session Binding" section (canonical owner
      `src/main/lib/chat-session-binding.ts`; consumers: `chats-*` routers, renderer
      transports via injected binding, startup backfill; rule per design.md Decision 6).

## 7. Verification

- [ ] 7.1 `bun run check` green; account for test-count delta against the 1.3 baseline.
- [ ] 7.2 `openspec validate --strict --no-interactive` across changes and specs.
- [ ] 7.3 Residue proof: repo grep shows `inferAgentChatProviderFromMessages` referenced only
      in `src/shared/agent-chat-provider.ts`, `src/main/lib/chat-session-binding.ts`, and
      tests; `subChatProviderOverrides` returns zero hits.
- [ ] 7.4 Desktop smoke (record in `verification.md`): create one Claude chat and one Codex
      chat; send a message in each; change the Codex chat's model and thinking level; quit,
      clear renderer localStorage, relaunch; both chats reopen with correct runtime/model
      binding and continue successfully; empty-chat runtime switch still works; changing a
      new-chat default does not rebind either existing chat.
- [ ] 7.5 Confirm the untouched-surface scope guards held: `sub_chats.sessionId` semantics
      unchanged; `agent_jobs.runtime`/`providerProfileId` untouched; no Local Job API surface
      change; headless paths do not read `sub_chat_bindings`.

## 8. Closeout

- [ ] 8.1 Commit the integrated source, run `bun run check:full` on the exact source SHA, and
      bind the SHA + receipt into `verification.md`.
- [ ] 8.2 Record `IMPLEMENTATION_VERIFIED` (Codex) and fresh-context `REVIEW_APPROVED`
      (Claude) for the same source SHA; any code change after either mark invalidates both.
- [ ] 8.3 Record Owner product acceptance.
- [ ] 8.4 Local fast-forward merge into `main`; run the post-merge gate on the merge SHA;
      record `remote not authorized / not performed`.
- [ ] 8.5 `openspec archive add-chat-session-binding --yes` (specs apply: this change carries
      a `chat-session-binding` delta, so do NOT pass `--skip-specs`); validate the archive.
