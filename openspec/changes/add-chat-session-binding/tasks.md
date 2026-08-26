# Tasks: Persist chat session binding truth in the database

## 1. Pre-flight

- [x] 1.1 Confirm the audit anchors still hold at implementation time (line numbers are hints;
      anchor on symbols): `subChats` table has no binding columns
      (`src/main/lib/db/schema/index.ts`); `inferAgentChatProviderFromMessages`
      (`src/shared/agent-chat-provider.ts:51`) has exactly one non-defining call site
      (`active-chat.tsx` `inferProviderFromMessages`); both transports read
      `subChat*AtomFamily` atoms from `appStore` in `sendMessages`
      (`ipc-chat-transport.ts` ~L228–309 incl. two `appStore.set` write-backs;
      `acp-chat-transport.ts` `getSelectedCodexModel` ~L128 and source read ~L180).
- [x] 1.2 Confirm no active change conflicts on `sub_chats` schema or the `chats-*` routers
      (`openspec list`; coordinate especially with the Foundation batch sibling
      `refactor-codex-desktop-service-extraction` — soft-ordered before this change).
- [x] 1.3 Capture a baseline: `bun run check` output on the pre-change commit.

## 2. Specs first

- [x] 2.1 Land the `chat-session-binding` ADDED delta from this change directory.
- [x] 2.2 `openspec validate add-chat-session-binding --strict --no-interactive` → valid.

## 3. Schema, owner module, backfill (main process)

- [x] 3.1 Add `subChatBindings` to `src/main/lib/db/schema/index.ts` per design.md Decision 1
      (unique index on `sub_chat_id`, FK cascade to `sub_chats`); generate the Drizzle
      migration (next index after `0022_legal_wendell_vaughn.sql`).
- [x] 3.2 Add `src/shared/chat-session-binding.ts`: `ChatSessionBinding` type, runtime union
      (`"claude-code" | "codex"`), source/thinking unions, and the
      provider-profile-source ↔ `providerProfileId` consistency helper; Codex Provider Profile
      writes normalize `thinkingLevel` to `NULL` because the current gateway advertises only
      reasoning `none` (Owner decision 2026-08-26); explicit Profile selection snapshots its
      current `defaultModel` into `modelId` and validates Profile existence, runtime target,
      and exact current default for create/enter/reselect operations; fork preserves its
      historical snapshot without consulting the current Profile.
- [x] 3.3 Add canonical owner `src/main/lib/chat-session-binding.ts`:
      `getSubChatBinding`, `attachBindingsToSubChats` (batched `IN` select),
      `seedSubChatBinding`, `copySubChatBinding`, `updateSubChatBinding` (normalizing writes,
      rejecting unknown runtimes), `backfillSubChatBindings` (insert-if-missing; runtime from
      `inferAgentChatProviderFromMessages`, all other fields `NULL`), plus Codex/Claude desktop
      Run admission that exact-checks the current DB tuple before active-run replacement and
      returns only canonical startup values. Constrain the documented Claude run-scoped divert;
      unknown sources fail closed before credential lookup, and diverted Profile existence/Claude
      target are rechecked after preflight. Complete chat/cwd/scope controls before active-state
      replacement and add a per-sub-chat admission generation so only the latest candidate may
      activate after asynchronous preflight. Guarded contracts stay candidate-local until claim;
      activation revokes any older contract for the same sub-chat regardless of renderer ID, and
      late cleanup compare-deletes the exact contract owner rather than a reused ID. Carry each
      runtime's exact installed active-owner object through cancellation, persistence, finalize,
      and unsubscribe paths so an external `runId` cannot alias a newer Run. Recheck that owner
      immediately before every user/assistant/error history write and stop stale candidates
      after every nested asynchronous preparation/retry before job creation or actual runtime
      dispatch. Route Codex stop/cleanup through its exact subscription closure; remove public
      sub-chat/run-ID teardown mutations that cannot express owner identity. Mint a distinct
      main-process `approvalId` per pending question, retain runtime `toolUseId` only as
      provenance, and exact-owner/compare-delete approval responses and timeouts. Guarded tool
      callbacks exact-check their captured active
      contract before authorization, after asynchronous approval, and before consuming a cached
      pre-tool decision. Key the sole active-contract registry by `subChatId`, expose only exact
      winner publication/current-object/compare-delete operations, and delete the old
      prepare-and-publish compatibility wrapper/raw exports. At the Codex native transport's
      final child-write boundary, synchronously recheck exact Run + contract authority and fail
      closed rather than sending a stale allow response.
- [x] 3.4 Invoke `backfillSubChatBindings` right after `migrate()` in
      `src/main/lib/db/index.ts` (~L63). ACCEPTANCE: running startup twice inserts no second
      row and modifies no existing row.
- [x] 3.5 Unit tests: backfill inference (metadata `provider`, `codex`/`gpt-` model-string
      fallback, `claude-code` default), backfill idempotency, missing-binding-row read
      fallback (in-memory defaults, no row invented), write normalization
      (profile-source consistency, runtime enum rejection), fork copy, and a large Chat
      attachment read proving canonical list hydration uses bounded 500-ID query batches.
      Add active-run sentinel regressions proving rejected Codex/Claude binding mismatches do
      not abort or replace an existing valid run, plus deterministic deferred-preflight tests
      proving a slow stale candidate cannot replace the newer winner. Cover two Codex Runs with
      the same external `runId` but distinct controllers: the old owner cannot cancel, mark,
      persist over, clear approvals for, or delete the new owner, and the new owner continues to
      fence binding mutation. Add post-activation/pre-persist races for both engines, including
      aborted Claude partial/error finalization, plus same-ID and different-ID broader-contract
      replacements proving the old Claude guarded callback is denied before authorization,
      after user approval, and when consuming a cached pre-tool decision. Cover replacement
      during provider/plugin/MCP/prompt/SDK-import/retry awaits, stale job cancel/late unsubscribe,
      exact Codex subscription teardown, and reused runtime tool IDs with delayed approval and
      timeout for both engines.
- [x] 3.6 Close native-session provenance authority: remove renderer `sessionId` from both chat
      schemas and transport payloads; derive Claude resume/parent identity only from the
      main-owned sub-chat row and Codex identity only from main-read persisted history. Delete
      the unused `updateSubChatSession` route and add forged/foreign/stale session regressions.

## 4. tRPC surface (envelopes only; logic in the owner)

- [x] 4.1 `chats.get` (`chats-crud.ts:68–90`) and `chats.getSubChat` return `binding` on each
      sub-chat via `attachBindingsToSubChats`; pass it through
      `agent-chat-api.ts` `toDesktopAgentSubChat`.
- [x] 4.2 `chats.create` (`chats-crud.ts` ~L173) and `chats.createSubChat`
      (`chats-sub-chats.ts` ~L93) require one binding input (runtime required from the
      creator; no legacy provider/model fallback) and call `seedSubChatBinding` in the same
      flow.
- [x] 4.3 `forkSubChat` (`chats-sub-chats.ts` ~L197) calls `copySubChatBinding`.
- [x] 4.4 Add `chats.updateSubChatBinding` mutation delegating to the owner.
- [x] 4.5 Add canonical process-local owner
      `src/main/lib/agent-runtime/chat-maintenance-fence.ts`: one exact in-memory token per
      sub-chat plus exact rollback-only blockers for claimed-but-unsettled desktop Run
      lifecycles; no persistence, schema column, `agent_jobs` write, or binding-row write;
      process restart clears all state. Scope it only to rollback maintenance versus desktop
      Run final claim/lifecycle settlement, not a general execution/binding/workspace/headless/job
      lease. Exact-token `finally` release must not clear a newer owner.
- [x] 4.6 Wire `rollbackToMessage` to reject while either Claude or Codex has an active Run and
      otherwise hold the exact maintenance token across checkpoint validation, Git apply, and
      message truncation. Wire both Engines' final Run-claim paths to reject while maintenance
      is held. Return the approved structured shape:
      `code: SESSION_BINDING_BUSY`, `subChatId`, `operation: rollback`,
      `activeRunId: string | null`, and `reason: active-run | maintenance`. Keep the final
      fence check + active-owner install synchronous; do not cancel/replace/queue a loser. If
      rollback invalidates an already-reserved candidate and releases before its final claim,
      retain a one-shot exact-admission tombstone in the same process-local owner so that
      candidate still reports maintenance BUSY; ordinary supersession stays stale. On Claude
      unsubscribe, abort but retain the exact active-session owner until supervised lifecycle
      finalization so rollback still observes the draining Run; all signal-aware runtime and
      history paths must reject its aborted signal. Codex user/duplicate/assistant persistence
      must require exact owner plus a non-aborted captured controller immediately at each write
      barrier. A successful final claim must register an exact rollback-only lifecycle blocker,
      released only after supervised lifecycle finalization; when replacement B settles before
      draining A, rollback remains BUSY until A settles, for both Engines and same external Run
      IDs. Blockers must not delay or authorize B and must survive only process-locally when a
      current-runtime registry is replaced or cleared.
- [x] 4.7 Harden rollback checkpoint authority: publish a unique main-minted canonical ref per
      draft (including same-SDK-UUID A/B); persist explicit availability plus exact ref/OID only
      after successful compare-and-create publication; on DB throw retract only that exact
      ref/OID and preserve the old row. Before any destructive Git or history operation, require
      canonical metadata, resolve ref === expected OID, and recheck immediately before apply;
      unavailable/missing/malformed/moved/wrong-OID input fails closed with an unchanged
      worktree/history.
- [x] 4.8 Delete the unused `updateSubChatMessages` tRPC mutation in the same change so
      `rollbackToMessage` is the sole renderer history-rewrite envelope; retain no compatibility
      route for this internal API.
- [x] 4.9 Bind Provider Profile model discovery to the admitted chat snapshot: carry the DB
      `modelId` without reserved `/none` in the existing `codex-chat-binding` gateway-token
      scope, serve it from authenticated `/models`, force forwarding to that token-bound model
      regardless of request-body model, and retain mutable-current-default behavior only for
      legacy/headless tokens. The real app-server smoke must permit historical model A while the
      Profile current default is B.

## 5. Renderer point surgery (one commit — W4.2 atomic replacement, no dual read path)

- [x] 5.1 Transports: add required `binding` to `IPCChatTransportConfig` /
      `ACPChatTransportConfig`; replace every `appStore.get(subChat*AtomFamily(...))` in
      `sendMessages` with `this.config.binding`; delete both `appStore.set` write-back sites
      in `ipc-chat-transport.ts` (normalized-source and divert write-backs — the divert result
      becomes per-send-effective only); delete `getSelectedCodexModel`'s atom reads in
      `acp-chat-transport.ts`. ACCEPTANCE: neither transport file contains a
      `subChat*AtomFamily` identifier or a binding-atom import.
- [x] 5.2 `active-chat.tsx`: `getOrCreateChat` (~L5754) and the `createNewSubChat` transport
      block (~L6091–6113) select the transport from `subChat.binding.runtime` and inject
      `binding`; delete `inferProviderFromMessages` (~L5584), its per-render call sites
      (~L6807/6854/6914), the `subChatProviderOverrides` `useState` (~L4764) and its reset
      effect, and the `instanceof ACPChatTransport` back-inference (~L5777–5780).
- [x] 5.3 Replace `handleProviderChange` (~L5963–5998): empty-chat runtime switch calls
      `chats.updateSubChatBinding`, awaits and publishes the canonical receipt, then
      `agentChatStore.delete(subChatId)` to force transport recreation. Regression test:
      switch runtime then send immediately. Serialize binding mutation, direct/queued send,
      initial regeneration, and resume through one per-sub-chat gate; resolve the current
      Chat/transport inside gated send, regeneration, and resume operations. Capture direct-send
      editor/attachment payload and claim its draft before awaiting a mutation that may remount
      the input. Stop an active run before waiting on a queued binding update in force-send,
      queue-drain, and live-question-follow-up paths. Include a binding-sensitive same-ID Chat
      remount key and real replacement-Chat regressions. Own initial-message generation outside
      the React mount lifecycle, keyed by sub-chat/message identity, so old and replacement
      mounts cannot both execute it. Map persisted `streamId`/`stream_id`, dedupe resume across
      remount, and release only exact failed generation/resume claims for retry, including an
      outer current-Chat failure before the lifecycle helper receives control. Retain pending
      captured work across normal parent navigation, resident-tab eviction, and detached-finish
      cleanup; explicit tab close alone cancels it. After an awaited mutation receipt, publish
      the successful canonical receipt to query/ref before cancellation can block Chat
      recreation or send, and create the replacement Chat independently of a mounted target
      view. Propagate the outer captured-operation context through awaited direct-send,
      force-send, live-question follow-up, and queue-drain preparation into the final current-Chat
      send gate, so explicit close followed by same-ID reopen cannot let an old continuation
      claim a fresh cancellation generation and send its stale prompt. Re-run normal eviction
      after the last pending operation releases so a finish callback cannot leak the detached
      Chat. Normalize a close-raced gate exit to cancellation, and make both queue send paths drop
      rather than requeue a popped item after explicit close. The canonical main owner rejects
      every binding mutation while either Engine owns an active Run; pre-claim mutations remain
      covered by final DB re-admission, not a new lease.
- [x] 5.4 `chat-input-area.tsx` (~L536–561): model/source/thinking selectors read from the
      sub-chat DTO `binding` and write through `updateSubChatBinding`; keep updating the
      global `lastSelected*` defaults as today. Binding updates recreate the transport.
      Hide the thinking selector for Codex Provider Profile bindings; do not claim selectable
      effort where the profile capability is reasoning `none` only. Profile enter/leave writes
      source/profile/model/thinking as one mutation, and runtime/gateway startup must honor the
      snapshotted model after later Profile edits. Treat non-Profile Codex `modelSource` as
      strict binding truth; credentials may block admission but may not substitute another
      source. Auth-error retry readiness and diagnostics must inspect only the credential
      required by that bound source, including both crossed-credential negative cases; pending
      retry state carries that method and crossed-method login success cannot unlock resend.
      Bind every retry to the exact non-secret binding identity and transport generation;
      delayed credential probes from a retired transport cannot publish, and consumption
      repeats the exact identity check inside the current-Chat gate.
      App-managed API-key save/remove must update global new-chat source/model/thinking
      together to a source-compatible selection without rebinding existing chats. Profile
      save/delete/target/default changes follow the same composite-write rule. If an existing
      Claude binding's Profile is deleted or loses its Claude target, keep displaying the
      bound source as unavailable and block honestly; never disguise it as OAuth.
- [x] 5.5 `new-chat-form.tsx` (~L1311–1315) and `handleCreateNewSubChat`
      (`active-chat.tsx` ~L6001): seed the creation mutation's binding input from the global
      default atoms instead of writing per-sub-chat atom families.
- [x] 5.6 Delete the five per-sub-chat binding atom families (`subChatModelIdAtomFamily`,
      `subChatClaudeModelSourceAtomFamily`, `subChatCodexModelSourceAtomFamily`,
      `subChatCodexModelIdAtomFamily`, `subChatCodexThinkingAtomFamily`, and their underlying
      storage atoms) from `src/renderer/features/agents/atoms/index.ts` in the same commit,
      together with any remaining read/write call site (Owner decision 2026-08-26). Keep the
      global `lastSelected*` atoms and `subChatModeAtomFamily`. Stale localStorage keys on
      disk are simply no longer read — no cleanup migration. ACCEPTANCE: the five family
      identifiers appear nowhere in `src/`.
- [x] 5.7 `bun run ts:check`; with the five family definitions deleted, the compiler
      enumerates any missed call site.
- [x] 5.8 Make renderer lifecycle receipts exact: approval A may retire only its captured
      `{subChatId, approvalId, toolUseId}` after `ok: true` or `ok: false`, never a newer B;
      transport throws preserve A for retry. A successful binding mutation always publishes its
      canonical receipt to query/ref even after explicit close, but cancellation still prevents
      Chat recreation/send. Provider Profile and first-party `auth-error` paths both unsubscribe
      their exact captured ACP subscription. Add deterministic deferred-response/close/reopen
      regressions for each case.

## 6. Guards and ownership registration

- [x] 6.1 `scripts/check-architecture-guards.mjs`: add the five assertions from design.md
      Decision 6 (per-chat binding-semantics storage atoms banned outright — no allowlist;
      the five deleted family identifiers have zero references anywhere in `src/`;
      `inferAgentChatProviderFromMessages` call sites limited to its module,
      the owner backfill, and tests; transport files free of binding-atom identifiers;
      `sub_chat_bindings` table access limited to schema + owner). Semantic scan includes
      model/source/thinking/effort/agentId/engine/runtime/provider/profile terms.
      Audit ratchets additionally reject renderer/native-session payload ownership, the retired
      `updateSubChatSession` mutation, a second maintenance-state owner, either retired history
      mutation, and loss of the admitted Provider Profile model snapshot on Codex `/models`.
      ACCEPTANCE: each guard demonstrably fails when its rule is violated on a scratch edit.
- [x] 6.2 `docs/OWNERSHIP_MAP.md`: add the "Chat Session Binding" section (canonical owner
      `src/main/lib/chat-session-binding.ts`; consumers: `chats-*` routers, renderer
      transports via injected binding, startup backfill; rule per design.md Decision 6).
- [x] 6.3 `docs/OWNERSHIP_MAP.md`: register
      `src/main/lib/agent-runtime/chat-maintenance-fence.ts` as the canonical owner of the
      process-local rollback-vs-final-Run-claim exclusion only. Record that Phase 5's durable C4
      SessionBinding lease MUST absorb/replace the rule and delete this temporary owner; a dual
      fence is forbidden.

## 7. Verification

- [x] 7.1 `bun run check` green; account for test-count delta against the 1.3 baseline.
- [x] 7.2 `openspec validate --strict --no-interactive` across changes and specs.
- [x] 7.3 Residue proof: repo grep shows `inferAgentChatProviderFromMessages` referenced only
      in `src/shared/agent-chat-provider.ts`, `src/main/lib/chat-session-binding.ts`, and
      tests; `subChatProviderOverrides` and the five deleted binding atom family identifiers
      return zero hits in `src/`.
- [ ] 7.4 Desktop smoke (record in `verification.md`): create one Claude chat and one Codex
      chat; send a message in each; change the Codex chat's model and thinking level; quit,
      clear renderer localStorage, relaunch; both chats reopen with correct runtime/model
      binding and continue successfully; empty-chat runtime switch still works; changing a
      new-chat default does not rebind either existing chat.
- [x] 7.5 Confirm the untouched-surface scope guards held: the `sub_chats.sessionId` schema field
      remains native provenance while its renderer mutation/input path is retired;
      `agent_jobs.runtime`/`providerProfileId` untouched; no Local Job API surface
      change; headless paths do not read `sub_chat_bindings`; default gateway tokens retain
      `legacy-profile-default`; Codex/Claude desktop tokens alone select their decode modes and
      request body/header/query cannot override them.
- [x] 7.6 Build both runtime smoke scripts and verify they seed a complete canonical binding
      plus the matching Run tuple; the bundled Codex app-server smoke admits Profile `none`
      and first-party API-key bindings without a legacy creator envelope, and accepts an
      explicit historical Profile model that differs from the Profile's current default.
- [x] 7.7 Run deterministic maintenance-fence tests for: active Claude rejects rollback; active
      Codex rejects rollback; held maintenance rejects each Engine's final claim; same sub-chat
      and same external Run ID A/B cannot alias authority; every BUSY response matches the exact
      approved code/fields/reason; success, returned failure, throw, and stale cleanup release
      only the exact token; release-before-final-claim still returns BUSY to the exact invalidated
      candidate once while ordinary staleness remains distinct; process restart/new owner starts
      empty; schema/table/job/binding-row residue remains zero. For both Engines, B may replace
      A and settle first, but exact rollback blockers keep rollback BUSY until A settles even
      with the same external Run ID and an empty current-runtime registry.
- [x] 7.8 Re-run rollback/checkpoint tests proving: same SDK UUID A/B uses unique refs; stale A
      cleanup cannot retract B; publication failure persists unavailable metadata without
      ref/OID; DB throw preserves the prior row and retracts only the exact published ref;
      unavailable/missing/wrong OID fails before destructive work; and the worktree/history is
      unchanged. Reassert `updateSubChatMessages` is absent from the router surface.
- [x] 7.9 Run the post-audit targeted matrix for: final Codex child-write owner loss (same/different
      external Run ID, cancel/unsubscribe, command/file/permissions); cross-chat same contract ID;
      renderer A→B approval continuation for both receipt values; mutation→close→receipt→reopen;
      Profile/first-party auth-error teardown; Profile A→B `/models`; and forged native session
      provenance. Include exact contract replacement/clear at the final native write barrier,
      arbitrary body models under a token-bound Codex Profile, release-before-claim maintenance,
      a backfill lookup with no unbounded `IN`, bounded large-Chat binding attachment reads, and
      close→same-ID reopen after deferred direct, force, custom-question, and queue preparation.
      Cover aborted-but-still-registered Codex persistence (including duplicate authority) and
      Claude unsubscribe/lifecycle drain with same external Run IDs: rollback stays BUSY until
      exact finalization, aborted signals cannot write, and stale finalization cannot delete the
      successor. Cover both Engines' overlapping drain ordering where B finalizes before A and
      exact rollback blockers survive current-owner replacement/clear without becoming Run-vs-Run
      leases. Re-run both internal staged-tree audits on the new tree pin before source freeze.

## 8. Closeout

- [x] 8.1 Commit the integrated source, run `bun run check:full` on the exact source SHA, and
      bind the SHA + receipt into `verification.md`.
- [ ] 8.2 Record `IMPLEMENTATION_VERIFIED` (Codex) and fresh-context `REVIEW_APPROVED`
      (Claude) for the same source SHA; any code change after either mark invalidates both. The
      fresh-context review checklist MUST explicitly reconcile all five Owner constraints:
      process-local/no-DB scope; rollback-vs-final-claim-only BUSY semantics; canonical owner +
      mandatory Phase 5 absorption/deletion; retired `updateSubChatMessages` + exact checkpoint
      OID; and the complete verification matrix.
- [ ] 8.3 Record Owner product acceptance.
- [ ] 8.4 Local fast-forward merge into `main`; run the post-merge gate on the merge SHA;
      record `remote not authorized / not performed`.
- [ ] 8.5 `openspec archive add-chat-session-binding --yes` (specs apply: this change carries
      a `chat-session-binding` delta, so do NOT pass `--skip-specs`); validate the archive.
