# Verification: Persist chat session binding truth in the database

## Scope and isolation

- Change: `add-chat-session-binding` (Foundation 1b; Owner `APPROVED` 2026-08-26).
- Base: `main@0dee7dc0f31b6b9c44516cbce81b1f63243a4a94`.
- Branch: `codex/add-chat-session-binding`.
- Worktree: `/home/chen/projects/locus-add-chat-session-binding`.
- Integrator: Codex `/root`; this worktree contains only 1b implementation/evidence.
- Remote operations: not authorized / not performed.
- Risk/data stage: R2; PRE-PRODUCTION / DISPOSABLE TEST DATA applies only to the approved
  binding-table migration and idempotent backfill in Locus-owned test-profile state. Repository
  and worktree Git data are not disposable: rollback maintenance/checkpoint safety is now in
  scope and every pre-apply failure must leave them unchanged. External consumer data,
  artifacts, Local Job API, and headless binding remain out of scope.

## W1 pre-flight and baseline

- The 1a closeout was locally archived and committed on `main` before this worktree was
  created. Both the new branch and worktree path were confirmed absent before
  `git worktree add -b` created them at the exact base above.
- Active changes were inspected. `add-architecture-guard-ratchet` (1c) and
  `refactor-engine-vocabulary-residue` (1d) remain sequenced after 1b and have no concurrent
  writer. `update-trpc-capability-boundary` remains blocked pending rebaseline and is not
  mixed into this worktree.
- Anchor audit at the base confirmed:
  - `subChats` has no binding columns/table relation;
  - `inferAgentChatProviderFromMessages` has one non-test direct caller, the
    `active-chat.tsx` inference wrapper, which is then used throughout renderer selection;
  - IPC and ACP transports read the five per-chat binding atom families during sends;
  - IPC still has both normalized/diverted source write-backs;
  - `subChatProviderOverrides` and transport-instance back-inference are still present.
- Dependency installation populated the isolated worktree. Its Electron native postinstall
  rebuilt successfully but could not launch Electron because this Linux host lacks
  `libnspr4.so`; the command exited nonzero after reporting the same loader limitation for
  `better-sqlite3` and `node-pty`. Static/type/Bun verification remains usable. No desktop
  smoke is claimed by this receipt.
- Pre-change `bun run check` at the clean base: **exit 0**.
  - changed-line lint: passed (no changed supported files);
  - architecture guard: passed;
  - retired-runtime residue: passed (**1,573 files scanned / 10 allowlisted**);
  - TypeScript: passed;
  - tests: **1,679 passed / 0 failed / 8,115 expectations across 286 files**.
- `./node_modules/.bin/openspec validate add-chat-session-binding --strict --no-interactive`:
  valid.

## Scope Delta Ledger

- Green: the tRPC envelope schema lives in
  `src/main/lib/trpc/chat-session-binding-schema.ts`; all normalization and table access stay
  in the shared contract/canonical main owner.
- Yellow (recorded, not implemented): Claude source pre-resolution ownership, automatic
  OAuth/provider divert persistence, and standing divert UX are deferred to
  `docs/tickets/TICKET-115-claude-binding-source-resolution.md`. Foundation 1b keeps the
  effective divert run-scoped and never changes an existing binding because availability
  changed.
- Red pause (resolved by Owner 2026-08-26): Codex Provider Profile reasoning could not
  honestly represent low/medium/high/xhigh because the current gateway advertises only
  `none`. Owner selected A: Profile bindings persist `thinkingLevel = NULL`, the UI hides
  effort, and transport/gateway execution canonicalizes to `none`.
- Yellow (recorded, not implemented): option B — real Provider Profile reasoning effort with
  explicit provider capability declarations and per-protocol gateway translation — is
  deferred to `docs/tickets/TICKET-116-provider-profile-codex-reasoning-effort.md`.
- Red pause (resolved by Owner 2026-08-26): destructive rollback could race an active Run or a
  new Run's final claim. Owner authorized only a main-process-memory per-sub-chat maintenance
  fence, scoped to rollback versus Claude/Codex final claim, with no schema/DB/job/binding-row
  state. The approved BUSY shape is `SESSION_BINDING_BUSY` + `subChatId` +
  `operation: rollback` + `activeRunId: string | null` +
  `reason: active-run | maintenance`. Phase 5 must absorb/replace it and delete the temporary
  owner.
- Review P3 / Yellow (recorded, not implemented): helper defaults currently use target-only
  eligibility while the utility execution path consumes only `openai-chat`; protocol-aware
  eligibility or translation is deferred to
  `docs/tickets/TICKET-117-provider-helper-default-protocol-eligibility.md`.
- Review P3 / Yellow (recorded, not implemented): strict first-party model admission needs a
  canonical main-process authority spanning remote and dynamically discovered API-key models;
  that design is deferred to
  `docs/tickets/TICKET-118-first-party-chat-model-admission-authority.md`.
- Outstanding Red: none.

## Implementation and remediation ledger

- `drizzle/0023_lonely_wrecking_crew.sql` creates the one-row-per-sub-chat binding table;
  startup backfill is idempotent and is the only production message-metadata inference call.
- `src/main/lib/chat-session-binding.ts` owns table access, normalization, exact Profile model
  snapshot admission, historical fork copy, and Codex/Claude desktop Run admission. Routes use
  canonical admission results and do not own binding rules.
- Provider Profile capability exception is explicit and tested: Codex Profile writes persist
  `thinkingLevel = NULL`, selectors hide effort, and transport uses the declared `none`; real
  effort remains unimplemented Yellow TICKET-116.
- Provider Profile create/enter/reselect validates existence, runtime target, and exact current
  default model. Later Profile edits do not change existing bindings; fork copies the historical
  tuple without consulting a now-edited/deleted Profile.
- Renderer recreation is receipt-first: canonical mutation result → query/DTO publication →
  old transport deletion → explicit replacement-Chat creation → binding-sensitive same-ID
  view remount when still mounted. Replacement publication is independent of the target view;
  normal parent navigation, resident-tab eviction, and detached-finish cleanup retain pending
  work and schedule a post-release eviction recheck, while explicit close cancels it and a
  post-receipt cancellation check prevents reopen. Close-raced popped queue items normalize to
  cancellation and are dropped by both queue senders instead of being requeued after clear.
  A real React regression verifies the remount, while the shared gate covers direct/queued send,
  regeneration, resume, and mutation without stale-transport or stop/wait deadlock.
- Direct submit paths capture uncontrolled input, attachments, and file-content payload before
  awaiting a binding mutation that can unmount the submitting component. Once the gate is
  acquired, send, regeneration, and persisted resume resolve the current same-ID `Chat` from
  `agentChatStore`; real two-Chat regressions prove the retired transport receives no send or
  reconnect while the replacement receives the preserved payload/resume.
- Explicit-close authority is inherited through nested gates: the context captured by the
  outer submit/force-send/custom-question/queue operation is rechecked after asynchronous
  preparation and immediately before current-Chat lookup/send. A same-ID reopen cannot give an
  old continuation a fresh cancellation generation or execute its captured prompt.
- Persisted resume accepts Drizzle `streamId` and legacy `stream_id`, deduplicates remounts, and
  releases a failed claim for retry. Initial-generation and resume claims also release when the
  outer current-Chat gate fails before their inner lifecycle helper receives control.
- Profile settings/onboarding and app-managed API-key changes update global new-chat
  source/model/thinking defaults as a coherent tuple. Existing chats are not rebound. If a
  bound Claude Profile is deleted or loses its target, UI retains and labels the Profile source
  unavailable instead of disguising it as OAuth.
- Main-boundary review remediations: stale/forged/wrong-runtime desktop Run tuples fail closed;
  rejected requests do not replace a valid active run; the one Claude run-scoped divert is
  constrained; unknown/malformed Claude sources cannot fall through to OAuth credentials.
  Chat/cwd/scope controls precede active-state replacement, while per-chat admission generations
  make asynchronous preflight latest-request-wins without becoming a second active registry.
- The canonical binding owner synchronously rejects every mutation while either Codex or Claude
  owns an active Run, including same-runtime model/Profile/effort edits. A pre-claim mutation
  still relies on the candidate's final DB re-admission, so 1b adds no durable lease or second
  pending-run registry.
- Codex auth-error retry is source-specific: matched ChatGPT/API-key credentials permit the
  one existing fresh-session retry, while both crossed-credential cases remain not-ready and
  select the diagnostic for the durable binding source. Pending retries carry the required auth
  method; the login modal preselects it and a crossed-method success cannot unlock resend. Both
  runtimes additionally bind retry publication/consumption to the exact non-secret binding
  identity and an opaque transport generation; a delayed old Codex credential probe or retired
  Claude transport cannot publish or send an old prompt through the replacement binding.
- Both desktop routes repeat exact binding admission after asynchronous preflight and before
  claiming/replacing active state. A binding mutation in that interval rejects the stale
  candidate while preserving the existing active Run and cleaning prepared resources.
- Claude guarded contracts remain candidate-local during preflight. Only a claimed active
  envelope publishes one; finalize/unsubscribe/audit cleanup compare-delete the exact object so
  an old Run cannot delete a newer winner. Activation revokes every older contract for that
  sub-chat even when the renderer contract ID changes. Scope expansion preserves the installed
  object's identity.
- Both runtime lifecycle owners use exact installed-object identity rather than an external Run
  ID. In particular, Codex threads one `ActiveCodexStream` object through desktop-job cancel,
  user/assistant persistence, finalize, and unsubscribe; Claude threads its exact installed
  controller/signal through user/assistant/error persistence. Every history write checks owner
  identity immediately before committing, so an old Run cannot abort, mark, persist over, clear
  approvals for, or delete a newer Run that reused the same `runId`. Nested provider/plugin/MCP,
  prompt/context, SDK-import, and retry awaits all recheck before job or actual runtime dispatch.
  Codex stop/auth-error/transport cleanup unsubscribe the exact tRPC subscription; unsafe public
  sub-chat/run-ID teardown routes have been removed.
- Pending-question authority uses a main-minted `approvalId` distinct from runtime `toolUseId`
  across Claude AskUserQuestion/guard approvals and Codex approvals, user-input, and MCP
  elicitation. Response/timeout paths compare the exact pending object and active Run, preventing
  an old same-tool-ID Run from approving or clearing the new Run or its renderer state. Renderer
  authority is keyed by `approvalId` and bound to the exact sub-chat/tool tuple; pending UI,
  real-time results, dialog detection, and memo state remain isolated when two chats reuse the
  same runtime-local `toolUseId`.
- Claude guarded tool callbacks require their exact captured contract to remain installed before
  authorization, after asynchronous user approval, and before consuming a cached `PreToolUse`
  decision. A newer same-ID or different-ID contract is never substituted, including when it
  has broader editable scope.
- Rollback checkpoints now use unique main-minted public refs bound to exact OIDs. Same-SDK-UUID
  A/B drafts cannot alias; publication failure persists explicit unavailability; DB failure
  retracts only the exact published ref and preserves the old row; unavailable/malformed/wrong
  OID input, a missing/moved ref, and replacement between the first validation and pre-apply
  recheck all fail before destructive application. The unused `updateSubChatMessages` arbitrary
  history-overwrite route is absent.
- The Owner-authorized maintenance fence is implemented as process-only state. BUSY rejection is
  side-effect free for pending Run admission; only a rollback that wins both active-owner and
  existing-maintenance checks invalidates older candidates immediately before installing its
  exact token. Both Engines use the same synchronous final-claim owner and exact cleanup cannot
  release a replacement fence. An exact-admission, process-local tombstone preserves the
  maintenance BUSY receipt when rollback invalidates an already-reserved Run and releases before
  that Run's final claim; ordinary stale candidates remain distinct. Exact-source verification
  remains pending below. Claude unsubscribe retains its exact aborted active owner until
  supervised lifecycle finalization, keeping rollback BUSY while signal-aware execution and
  history writers reject the draining owner. Codex user, duplicate-authority, and assistant
  persistence require exact installed owner plus a non-aborted controller at their write
  barriers, so cancellation cannot write while cleanup is still draining. The same canonical
  fence owner also keeps one exact rollback-only blocker for every successful final claim until
  that Run's supervised lifecycle `finally`. Replacement B never waits on A, but if B settles
  first it releases only B and A keeps rollback BUSY even after the single current-runtime
  registry becomes empty. Both Engines and same-external-Run-ID overlap are deterministic tests;
  blockers confer no execution or Run-vs-Run authority. This pre-freeze implementation statement
  is not the final technical verdict.
- Claude run-scoped Profile diversion resolves strict DB-scoped metadata both before and after
  preflight. Missing, malformed, deleted, or Codex-only Profiles fail before active replacement
  and before message persistence.
- Persisted resume claims are owned outside the React mount lifecycle, bounded to the latest
  stream key per sub-chat, retained after success, and released only for the matching failure.
- Initial-message generation uses the same lifecycle principle with its own bounded
  sub-chat/message-identity claim. A binding-gated real React remount now produces exactly one
  generation on the replacement AI SDK Chat; the retired Chat receives none, and only a failed
  exact claim becomes retryable.
- Gateway tokens select immutable model-resolution modes: a Codex chat token's admitted model
  snapshot is authoritative for both `/models` and forwarding (the request's reserved final
  `/none` cannot be used to select another model), Claude forwards opaque models verbatim, and default
  `legacy-profile-default` remains for headless/Local Job. Request body/header/query cannot
  select the mode or expand the Codex token's model scope.
- Both runtime smoke scripts now seed complete canonical binding rows and submit matching Run
  tuples; they no longer rely on a legacy creator envelope or runtime-only DB seed.
- Architecture guard covers semantic per-chat storage (`model/source/thinking/effort/agent/
  engine/runtime/provider/profile`), all five retired family identifiers, inference ownership,
  transport purity, and schema/owner-only `sub_chat_bindings` table access.

## Owner-authorized maintenance and rollback verification plan

Fresh-context review and the exact-SHA implementation gate MUST reconcile each Owner constraint
independently:

1. **Pure memory / no persistence:** inspect the canonical owner and schema diff; prove process
   restart/new owner starts empty and there are no new schema fields, database writes,
   `agent_jobs` mutations, or binding-row mutations for the fence, its tombstones, or its
   rollback-only lifecycle blockers.
2. **Narrow mutual exclusion / BUSY contract:** deterministic tests cover active Claude →
   rollback rejected, active Codex → rollback rejected, held rollback maintenance → Claude final
   claim rejected, and held maintenance → Codex final claim rejected. Every result must match
   `SESSION_BINDING_BUSY`, exact `subChatId`, `operation: rollback`, exact active Run ID or
   `null`, and the corresponding `active-run`/`maintenance` reason. No generic lease behavior or
   runtime dispatch is permitted. Also cover reserve → rollback acquire/invalidate → rollback
   release → final claim: that exact earlier candidate consumes a process-local tombstone and
   still reports maintenance BUSY, while ordinary superseded candidates remain
   `stale-admission`. For both Engines, cover replacement B settling before still-draining A:
   rollback remains BUSY until exact A finalization even with the same external Run ID and an
   empty current-runtime registry, while B was neither delayed nor authorized by A's blocker.
3. **Canonical owner / Phase 5 deletion:** confirm all fence state lives only in
   `src/main/lib/agent-runtime/chat-maintenance-fence.ts`, all consumers delegate to it, and the
   OWNERSHIP_MAP contains the mandatory C4 durable-lease absorption/replacement plus temporary
   owner deletion note.
4. **Single history path / exact checkpoint:** assert `updateSubChatMessages` is absent. Test
   same-SDK-UUID A/B unique refs and exact cleanup, publish failure, DB transaction throw,
   unavailable/missing metadata, missing or moved ref, wrong OID, pre-apply recheck, and unchanged
   worktree/history for every fail-closed case.
5. **Release and integrated evidence:** test success, returned failure, throw, and stale cleanup
   release only the exact maintenance token or lifecycle blocker, including same-sub-chat/
   same-external-Run-ID A/B and out-of-order B-before-A lifecycle settlement.
   Then rerun focused suites, OpenSpec strict validation, `git diff --check`, smoke receipts, and
   `bun run check:full` on the frozen source SHA before recording `IMPLEMENTATION_VERIFIED`.

The integrated matrix additionally MUST cover close → same-ID reopen after deferred slash
expansion, force-send readiness waits, and custom-question continuation; exact Run + captured
guard-contract loss at the final Codex child-write barrier; arbitrary request-body models under
a Codex chat gateway token; a large backfill shape with no unbounded `IN` query; and bounded
500-ID query batches when attaching binding rows to an unpaginated large Chat. It also covers
aborted-but-registered Codex write denial and Claude unsubscribe drain ownership through exact
lifecycle finalization, including a same-external-Run-ID successor. Both Engine route harnesses
also hold A unresolved, let replacement B settle first, prove the active registry is empty while
rollback is still BUSY, and release rollback only after exact A settlement.

Current status: staged-tree pins `acf33bd7a87994248f8ec96c9e9bb81169f65f84`,
`6754b4eaf97b38007b99b9c14ec27f70fb59bf91`,
`e64637077c15eb9aa39d48f14da39ca457bd750b`,
`1ff58134cfe2634df86e692baee009b7773b218c`,
`e8ac2f51b47f5dfdf0116c139e9fcd2d29c558c8`, and
`e0b27a9c71a79b27b88ba9d7c37d6a4db775bb7e` were invalidated by their audits. The third pin's
pre-freeze scope audit found that final-Run maintenance conflicts carried the correct structured
BUSY payload but rendered the blocked operation backwards as “rollback cannot start.” Callers
now explicitly select rollback-vs-Run wording, with exact router assertions. The fourth pin's
functional audit then found that
`attachBindingsToSubChats` still put an unpaginated Chat's complete ID set into one SQLite `IN`;
canonical list hydration now uses bounded 500-ID batches and carries a large-set regression.
The fifth pin then exposed two drain-window blockers: Codex could persist user/assistant content
after its exact controller aborted but before owner cleanup, and Claude unsubscribe removed its
active owner before the asynchronous runtime lifecycle settled, allowing rollback to enter.
Exact non-aborted Codex write barriers and retained-but-signal-inactive Claude drain ownership
close both windows, including same-external-Run-ID replacement. The sixth pin then exposed the
remaining overlapping-drain P1 in both Engines: B could replace A and settle first, emptying the
single current-owner registry while A still drained. Exact rollback-only blockers now remain in
the canonical fence owner through each supervised lifecycle, so B releases only B and A still
blocks rollback without blocking or authorizing B.
The remediated candidate was frozen as staged tree
`506d51c742f07d327417092108ddd706ff2294ee`. Two fresh-context internal audits left that pin
unchanged and reported no actionable P0-P3 finding. The tree was then committed as source SHA
`1d019f8d4fab38829ad0e3108e9569b260ab9302`; the exact-source receipt and Codex verdict are
recorded below. The independent Claude Code review remains pending and is not asserted here.

## Staged-tree audit remediation (pin `acf33bd7`; candidate invalidated)

- Security P1: Codex native app-server approvals could lose exact ownership after the
  post-approval check but before the transport's child write. The replacement binds the
  response envelope to exact Run/contract authority and synchronously fails closed immediately
  before `writeJsonLine`; deterministic replacement/cancel tests are required.
- P2: renderer approval A could clear newer B after either `ok: true` or `ok: false`; canonical
  tuple compare-delete and deferred-response tests are required.
- P2: guarded contracts were globally keyed by renderer `contract.id`, and an exported
  prepare-and-publish compatibility path bypassed final admission. The sole registry is moving
  to `subChatId` + exact-object authority and the old path is being deleted.
- P2: a Codex Profile token's `/models` response read the mutable Profile default instead of
  the admitted historical chat model. The existing scoped token now carries the DB model
  snapshot for `codex-chat-binding`; legacy/headless remains isolated.
- P2: explicit close after a successful binding mutation could suppress cache/ref receipt
  publication and make reopen use a stale transport. Successful canonical receipts must publish
  before the cancellation check that protects recreate/send.
- P2: renderer chat inputs could select native `sessionId`, and an unused public mutation could
  rewrite it. Both transport/schema inputs and `updateSubChatSession` are being retired; main
  DB/history is the only resume provenance.
- Lifecycle spec gap: Provider Profile `auth-error` returned before exact ACP unsubscribe; both
  Profile and first-party branches must tear down the captured subscription.
- P3 cleanup accepted into the same renderer surgery: ask-user memo cleanup must use its
  composite chat/tool key rather than raw tool ID.
- Security P3 (inherited, not implemented here): desktop `projectPath` still participates in
  renderer-selected MCP configuration lookup. Main resolves the execution cwd, and existing
  MCP approval reduces impact, but complete registered-root derivation remains tracked by
  TICKET-104/TICKET-101 rather than expanding 1b.
- Security P3 (documented recovery boundary): checkpoint-ref cleanup is best effort; exact
  compare-delete protects a successor but a failed delete can leave an unreachable ref. Git
  rollback and SQLite history truncation are not cross-store atomic; exact checkpoint/history
  metadata remains available for diagnosis/retry if the DB step fails after Git application.

All edits after `acf33bd7` invalidate its test receipts and both internal audit results. A new
staged-tree pin and both internal audits are mandatory before source commit.

## Second staged-tree audit remediation (pin `6754b4ea`; candidate invalidated)

- Functional P1: an old outer submit could await preparation, observe explicit close, then
  capture a fresh generation in a nested gate after same-ID reopen and send its old prompt.
  The captured operation context now flows through direct/force/question/queue preparation and
  the final current-Chat gate; deterministic close/reopen testing proves zero old transport or
  replacement transport sends before a genuinely fresh prompt.
- Security P1: the final Codex native response predicate rechecked the exact Run but omitted its
  captured guarded contract. Contract replacement or clear at the existing pre-write barrier
  now selects the protocol-valid denial while the exact Run owner remains unchanged.
- Security P2: a `codex-chat-binding` token advertised its historical model but trusted an
  arbitrary request-body model for forwarding. The token's admitted model snapshot is now the
  sole upstream authority; four distinct body values all forward only that snapshot.
- Concurrency P2: rollback could invalidate an earlier pending admission, release, and leave its
  later final claim as a silent generic stale finish. A one-shot exact-admission tombstone in
  the canonical process-memory fence owner preserves structured maintenance BUSY after release;
  maintenance-aware cleanup consumes it and ordinary supersession remains distinct.
- Functional P2: checked task 5.3 contradicted the ratified receipt-first rule. It now states
  that a successful canonical receipt publishes to query/ref before cancellation blocks only
  recreate/send.
- Startup P3: backfill placed every sub-chat ID into one SQLite `IN` query. It now scans existing
  binding IDs without an unbounded bind list, with a 100,001-row executor regression.
- Inherited boundaries remain documented rather than widened into 1b: renderer-selected MCP
  configuration roots are tracked by TICKET-101/104; Git rollback and SQLite history truncation
  are not cross-store atomic; strict first-party model catalog authority remains TICKET-118.

All edits after `6754b4ea` invalidate that pin's **179 pass / 0 fail / 817 expectations**
functional audit and **98 focused tests** security audit. Both exact-tree audits reported no P0,
but their verdicts are historical only; a new pin and clean re-audits are mandatory.

## Current integrated pre-freeze receipts (not the exact-source verdict)

- `git diff --check && bun run check`: **exit 0**.
  - changed-line lint, architecture guard, retired-runtime residue, and TypeScript: passed;
  - retired-runtime residue: **1,609 files scanned / 10 allowlisted**;
  - tests: **1,897 passed / 0 failed / 9,230 expectations across 302 files**;
  - delta from the clean base: **+218 tests / +1,115 expectations / +16 test files**.
- `bun run spec:validate`: **exit 0**, **55 passed / 0 failed** across all active changes and
  specs.
- Post-remediation focused matrix covering the maintenance owner/router, exact admission and
  binding races, renderer close/reopen gate, canonical binding/backfill, rollback checkpoint,
  final Codex native write barrier, token-bound Profile model authority, aborted Codex write
  denial, retained Claude drain ownership through exact lifecycle finalization, and both
  Engines' B-before-A overlapping lifecycle settlement: **184 passed / 0 failed / 958
  expectations across 17 files**.
- Focused final-owner batch covering renderer approval isolation, static guard/runtime wiring,
  smoke exact-owner residue, Codex guarded-contract publication/cleanup, admission races, and
  maintenance ordering: **56 passed / 0 failed / 483 expectations across 6 files**.
- Exact checkpoint batch: **9 passed / 0 failed / 44 expectations**. It covers same-SDK-UUID
  unique refs, collision, wrong OID, missing/moved ref, replacement in the two-check window, and
  unchanged HEAD/history/index/status/tracked/untracked state on every fail-closed case.
- Both runtime smoke scripts bundle with Bun's Node target and Electron externalized: **exit 0**;
  each bundles **1,069 modules**. Outputs were **5,672,574 bytes**
  (`smoke-codex-app-server-desktop`) and **5,672,848 bytes**
  (`smoke-quick-chat-project-sidebar`); outputs were written outside the worktree.
- Headless/public-contract isolation against base `0dee7dc0`: **exit 0** for the Local Job and
  headless provider-binding surfaces, with zero `subChatBindings` / `sub_chat_bindings` reads in
  those paths.
- Desktop GUI smoke remains unavailable on this host because Electron cannot load `libnspr4.so`.
  No GUI path is claimed. The limitation will be recorded again on the frozen source SHA.
- These receipts bind only the current integrated worktree. Any source/doc edit, including this
  evidence update, requires the exact-source gate after the source commit.

## Historical pre-maintenance-fence receipts (superseded for final verdict)

The receipts below were green on an earlier integrated tree, but the Owner-authorized fence and
subsequent remediation make them stale. They are retained as audit history only and MUST NOT be
used as the exact-source closeout receipt.

- Earlier integrated-tree `bun run check`: **exit 0** (stale; rerun pending).
  - changed-line lint, architecture guard, retired-runtime residue, and TypeScript: passed;
  - retired-runtime residue: **1,601 files scanned / 10 allowlisted**;
  - tests: **1,771 passed / 0 failed / 8,624 expectations across 297 files**;
  - delta from the clean base: **+92 tests / +509 expectations / +11 test files**.
- Earlier `bun run spec:validate`: **exit 0**, **55 passed / 0 failed** across all active changes
  and specs (stale; rerun pending).
- Headless/public-contract isolation:
  `git diff --exit-code 0dee7dc0... -- src/main/lib/headless/provider-binding.ts
  src/main/lib/headless/local-job-api.ts src/shared/local-job-api.ts
  docs/local-job-api-v1.schema.json`: **exit 0**. A residue search found no
  `subChatBindings` / `sub_chat_bindings` read under headless or the Local Job contract.
- Earlier 1b focused batch (owner/router/transports/defaults/gate, Provider storage/onboarding,
  gateway token modes, exact Codex/Claude admission, admission/guard races, guard lifecycle,
  real AI SDK send/resume, and React remount): **182 passed / 0 failed / 1,093 expectations
  across 26 files**. This proves
  legacy-token isolation, exactly one final Codex `/none` removal, Claude verbatim IDs,
  immutable token modes, Profile `thinkingLevel = NULL`, snapshot admission, historical fork
  copy, source-specific credential retry, latest-request-wins, resume retry, same-ID remount,
  pre-await payload capture, and current-Chat-only send/reconnect after replacement.
- Earlier runtime smoke-script bundle verification: **exit 0** for both scripts using Bun's Node target
  with Electron externalized; each bundled **1,068 modules**. Outputs were
  `5,641,289` bytes (`smoke-codex-app-server-desktop`) and `5,643,334` bytes
  (`smoke-quick-chat-project-sidebar`). Temporary outputs were removed after verification.
- Desktop GUI smoke command: `bun run dev` → **exit 1 before app launch**. Electron's native
  module check rebuilt successfully, then both `better-sqlite3` and `node-pty` probes failed
  because the Electron binary could not load `libnspr4.so`. Therefore the local-mode, repo,
  provider/model, tool-call, renderer, and token-log tracks were not reached and are **not
  claimed**. This is an environment limitation, not a passing desktop receipt.

## Pre-freeze review observations

- Fresh-context Codex review identified and remediation verified seven blockers:
  binding-admission TOCTOU, component-local resume claims, crossed-method login success unlocking
  Codex retry, pre-claim guarded-contract publication/ID-only deletion, and invalid run-scoped
  Profile diversion, plus immediate binding-switch sends retaining an unmounted input or old
  transport and component-local initial generation replaying the same prompt after remount.
  Deterministic regressions cover each case. Final re-review is pending. This internal quality
  pass is not the required independent Claude `REVIEW_APPROVED` verdict.
- The final pre-freeze review then identified three additional blockers: normal navigation could
  evict a Chat holding a captured operation, active Run ownership did not fence binding mutation,
  and stale auth retry publication could cross a binding/transport replacement. All three were
  remediated in their canonical owners with deterministic regressions; final re-review remains
  pending and no technical verdict is claimed yet.
- Security re-review identified one further owner-aliasing blocker: Codex lifecycle cleanup and
  persistence previously treated the external `runId` as owner identity. Exact installed-stream
  comparisons now cover cancellation, persistence, finalize, unsubscribe, approval cleanup, and
  registry deletion, including a same-`runId`/different-controller regression. Final re-review
  remains pending and no technical verdict is claimed yet.
- The same security pass then found stale post-activation history writes in both runtimes and a
  Claude guarded-tool callback that could consume a newer contract. Exact owner checks now sit
  immediately before every user/assistant/error DB write; stale Runs stop before later dispatch.
  Claude tool authorization checks its captured contract before decision, after asynchronous
  approval, and again before consuming a cached `PreToolUse` result. Contract activation revokes
  the older authority for that sub-chat across both same- and different-ID replacements.
  Deterministic regressions cover same-`runId` replacement, aborted partial/error finalization,
  both contract-ID cases, and the cached-decision gap. Final re-review remains pending and no
  technical verdict is claimed yet.
- Security review then found that `rollbackToMessage` could perform destructive Git restoration
  and message truncation concurrently with an active or newly claiming Run. This crossed the W7
  Red boundary. Owner authorization on 2026-08-26 selected the narrow process-local maintenance
  fence described above, required removal of `updateSubChatMessages`, and required unique-ref +
  exact-OID checkpoint validation. Implementation and deterministic coverage of all five Owner
  rows are now present; exact-source re-review remains pending and no verdict is claimed.
- The sixth staged-tree audit then reproduced a remaining P1 in both Engines: after A was
  aborted/replaced, B could settle first and empty the single current-owner registry while A's
  provider lifecycle still drained, allowing rollback to acquire. The canonical fence owner now
  registers an exact rollback-only blocker at every successful final claim and releases it only
  from that lifecycle's supervised `finally`. Route-level tests hold A unresolved, settle B
  first, observe an empty runtime registry plus structured BUSY, then prove rollback becomes
  available only after A settles. These blockers do not exclude Run B or grant execution
  authority. The invalidated `e0b27a9c` pin is not a verdict; a new tree audit is required.
- The first final pre-freeze snapshot review found four additional closeout blockers: Codex did
  not publish its winning guarded contract; renderer approval state collided across chats that
  reused a runtime-local tool ID; the Codex smoke used the retired approval/cancel envelopes; and
  rejected rollback BUSY checks invalidated unrelated pending Runs. The same audit also found the
  missing/moved-ref and two-check-window checkpoint cases absent from the required matrix. The
  canonical owners and smoke were remediated: Codex publishes/revokes and exact-cleans contracts,
  renderer authority is scoped by approval plus chat/tool identity, smoke captures `approvalId`
  and cancels its exact subscription, BUSY checks are side-effect free, and all checkpoint races
  fail closed without changing Git/worktree state. The invalidated old staged tree is not a clean
  verdict; a new pinned-tree re-review is required.
- Scope-isolation review removed unrelated UI, cache sorting, type-cleanup, and formatter churn
  from `active-chat.tsx`; the remaining diff is limited to the binding gate, receipt-first Chat
  replacement, exact retry/transport ownership, and remount behavior required by this change.
- P3: identity-based admission release proves that a later failed/cancelled candidate cannot
  restore an older candidate, but that exact branch does not have a separate router regression.
- P3: a malformed mixed resume DTO with empty legacy `stream_id` and non-empty camel
  `streamId` would currently resolve as no stream; canonical tRPC DTOs expose camelCase only.

## Exact-source verdict

- Frozen source SHA: `1d019f8d4fab38829ad0e3108e9569b260ab9302`.
- Frozen source tree: `506d51c742f07d327417092108ddd706ff2294ee`; it exactly matches the
  independently audited staged-tree pin.
- Verified at: `2026-08-26 23:18:37 NZST (+1200)`.
- Before and after the exact-source gates, the implementation worktree was clean and `HEAD`
  still resolved to the frozen source SHA. Local `main` remained fixed at
  `0dee7dc0f31b6b9c44516cbce81b1f63243a4a94`.
- Fresh-context internal functional audit on the frozen tree: no actionable P0-P3 finding;
  **96/96** concurrency/maintenance/rollback/persistence/cleanup/registry tests and **248/248**
  binding/renderer/approval/auth/gateway/final-child-write tests passed; architecture guard
  passed. Pre/post tree pins were identical and the audit made no file or index change.
- Fresh-context internal security audit on the frozen tree: no actionable P0-P3 finding;
  focused matrix **250 passed / 0 failed / 1,259 expectations across 24 files**, including both
  Engines' same-external-Run-ID A/B overlap with B settling before A, unsubscribe/bulk-clear,
  process restart/reset, exact checkpoint OID, final native child-write authority, renderer
  close/reopen, gateway scope, and redaction. Architecture, TypeScript, OpenSpec strict, and
  cached-diff checks passed; the pre/post tree pins were identical.
- `bun run check:full` exact-SHA receipt: **exit 0**.
  - changed-worktree lint: passed (the committed worktree had no changed supported file);
  - architecture guard: passed;
  - retired-runtime residue: passed (**1,609 files scanned / 10 allowlisted**);
  - TypeScript: passed;
  - tests: **1,897 passed / 0 failed / 9,230 expectations across 302 files**;
  - OpenSpec all/strict: **55 passed / 0 failed**;
  - Electron/Vite production build: passed;
  - patch whitespace check: passed.
- Exact-source runtime-script smoke: both Bun Node-target bundles externalizing Electron passed,
  each with **1,069 modules**. Outputs written outside the worktree were **5,675,290 bytes**
  (`smoke-codex-app-server-desktop`) and **5,675,564 bytes**
  (`smoke-quick-chat-project-sidebar`).
- Exact-source headless/public-contract isolation against base `0dee7dc0`: **exit 0** for
  `src/main/lib/headless/provider-binding.ts`, `src/main/lib/headless/local-job-api.ts`,
  `src/shared/local-job-api.ts`, and `docs/local-job-api-v1.schema.json`; residue search found
  zero `subChatBindings` / `sub_chat_bindings` references in the headless/Local Job surfaces.
- Desktop GUI smoke remains unavailable on this host because Electron cannot load
  `libnspr4.so`. No GUI scenario is claimed; task 7.4 remains visibly unchecked for Owner risk
  handling during acceptance.
- Codex verdict: **`IMPLEMENTATION_VERIFIED`** for
  `1d019f8d4fab38829ad0e3108e9569b260ab9302`. The five Owner-authorized maintenance/checkpoint
  constraints and Provider Profile A/TICKET-116 boundary are implemented and covered, and no
  actionable P0-P3 implementation finding remains. This verdict is exact-source only; any
  subsequent source change invalidates it.
- Claude Code independent verdict: pending.
- Local merge / Owner acceptance / archive: pending.
