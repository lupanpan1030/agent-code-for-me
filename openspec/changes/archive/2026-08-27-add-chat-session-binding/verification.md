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
  `libnspr4.so`. No GUI scenario is claimed. Owner accepted this disclosed residual risk on
  2026-08-27, and task 7.4 is closed only as a risk-disposition/follow-up-registration item.
- Codex verdict: **`IMPLEMENTATION_VERIFIED`** for
  `1d019f8d4fab38829ad0e3108e9569b260ab9302`. The five Owner-authorized maintenance/checkpoint
  constraints and Provider Profile A/TICKET-116 boundary are implemented and covered, and no
  actionable P0-P3 implementation finding remains. This verdict is exact-source only; any
  subsequent source change invalidates it.
- Claude Code independent verdict: **`REVIEW_APPROVED`** for the frozen source SHA; both
  fresh-context review receipts are recorded below and report zero P0/P1/P2 findings.
- Owner acceptance: **`ACCEPTED add-chat-session-binding`** on 2026-08-27 after the local
  post-merge gate, including explicit acceptance of the disclosed GUI-smoke gap as a residual
  risk without claiming the GUI scenarios passed.
- Local merge: completed by fast-forward at
  `1d4e004b30e573ebf95235fd7baa725780d659e8`; the post-merge gate passed. Local archive remains
  pending at this checkpoint.

## Local integration, post-merge gate, and Owner acceptance (2026-08-27)

- Reviewed implementation source: `1d019f8d4fab38829ad0e3108e9569b260ab9302`.
- Evidence-only commits: Codex verification
  `e10e31ca95d5d3ea8e14b7f5a57d65691320eb46` and Claude review
  `1d4e004b30e573ebf95235fd7baa725780d659e8`.
- Local integration: `main` was fast-forwarded from
  `0dee7dc0f31b6b9c44516cbce81b1f63243a4a94` to
  `1d4e004b30e573ebf95235fd7baa725780d659e8`, with no conflict and no merge commit. The range
  from the reviewed source to the integration endpoint changes only this change's `tasks.md`
  and `verification.md`; it contains no product-code change.
- Post-merge gate: `bun run check:full` passed at the unchanged local-main SHA
  `1d4e004b30e573ebf95235fd7baa725780d659e8`: architecture guard, retired-runtime residue guard
  (**1,609 files scanned / 10 allowlisted**), TypeScript, Electron/Vite production build, and
  patch whitespace check all passed; tests reported **1,897 passed / 0 failed / 9,230
  expectations across 302 files**; OpenSpec all/strict validation reported **55 passed / 0
  failed**. Only the already-recorded non-failing Vite/Browserslist warnings remained.
- Owner decision received verbatim on 2026-08-27:
  **`ACCEPTED add-chat-session-binding`**.
- The Owner explicitly accepted the missing Electron GUI smoke as a disclosed residual risk.
  No GUI scenario is retroactively claimed as run or passed. The required rerun on a
  GUI-capable machine is consolidated into
  `docs/tickets/TICKET-114-codex-desktop-extraction-gui-smoke.md` alongside the 1a track.
- Final change verdict: **`IMPLEMENTATION_VERIFIED` + `REVIEW_APPROVED` + `ACCEPTED`**, all
  referring to the unchanged product source at the frozen SHA. The four non-blocking P3 review
  observations remain recorded below for later triage.
- Archive state at this checkpoint: pending local archive and post-archive strict validation.
- Push, remote PR mutation, remote merge, release, and every other remote operation:
  **not authorized and not performed**.

## Archive receipt (2026-08-27)

- `./node_modules/.bin/openspec archive add-chat-session-binding --yes` exited 0 and moved this
  change to `openspec/changes/archive/2026-08-27-add-chat-session-binding/`.
- The archive applied the accepted delta to the living product truth by creating
  `openspec/specs/chat-session-binding/spec.md` with **7 added requirements**. This was not a
  tooling-only archive, so `--skip-specs` was intentionally not used.
- Task 8.5 was checked only after the archive command completed. The command's pre-move warning
  about one incomplete task referred only to that not-yet-executed archive step, not to missing
  implementation, review, acceptance, or verification work.
- `bun run spec:validate` passed **55/55** after the archive. Archived-task strict validation
  marks `2026-08-27-add-chat-session-binding` **passed**; its archive-wide aggregate is **104
  passed / 6 failed across 110 entries** because six older archived entries contain pre-existing
  incomplete task checkboxes. None of those failures is this change.
- Final archive state: **Owner `ACCEPTED`; locally archived**. The GUI-capable desktop-smoke
  follow-up remains tracked in
  `docs/tickets/TICKET-114-codex-desktop-extraction-gui-smoke.md` for both Foundation 1a and 1b.
- No push, remote PR mutation, remote merge, release, or other remote operation was performed.

## Independent review — fresh-context Claude Code (2026-08-26)

- Source SHA under review: `1d019f8d4fab38829ad0e3108e9569b260ab9302` (worktree at review time: `e10e31ca`, docs-only evidence commit on top — verified by the reviewers via `git diff --stat`).
- Review mode: two read-only fresh-context reviewers (correctness/compliance + security/trust-boundary) dispatched by the Claude Code coordination session; implementation context not reused; no files edited during review; worktree confirmed clean after all spot-run tests.
- Owner mid-flight rulings verified as implemented: R1 provider-profile thinking exception (thinkingLevel forced null on every write path when a profile is bound; effort UI gated; TICKET-116 Yellow) and R2 maintenance fence under all five constraints (in-memory only; maintenance-vs-run mutual exclusion with SESSION_BINDING_BUSY; OWNERSHIP_MAP registration with mandatory Phase-5 absorption note; updateSubChatMessages route deleted; checkpoint exact-OID verification failing closed).
- Combined verdict: **`REVIEW_APPROVED`** for `1d019f8d4fab38829ad0e3108e9569b260ab9302` — zero P0/P1/P2 findings across both lenses; four P3 notes recorded for follow-up triage. The audited rollback/run concurrency race is assessed as closed in both directions (run-start blocked while fence held; fence acquisition refused while a run is active; release on all paths).
- Technical verdict for this exact SHA only; it does not constitute Owner product acceptance and does not authorize any remote operation. Any subsequent code change to the source invalidates it.

### Correctness / compliance review

- Verdict: **`REVIEW_APPROVED`** for `1d019f8d4fab38829ad0e3108e9569b260ab9302`.
- Findings (non-blocking):
  - [P3] `tests/external-launch-spawn.test.ts` — Full `bun test` (without --isolate) shows spurious cross-file failures due to mock.module leakage. Running the bare `bun test` command (no --isolate) across the whole suite produces 57 failures/12 errors from unrelated pre-existing files (plugin-update-review, local-only-open-external, headless-stdio-flush, mcp-oauth-error-boundary, desktop-run-admission-generation-race under contention) due to mock.module state leaking between test files. This is pre-existing test-suite fragility, not a regression from this change: the canonical `bun run test` script uses `bun test --isolate tests` and I reproduced its reported receipt exactly (1897 pass / 0 fail / 9230 expect() calls), matching verification.md line 349. Flagging only so future reviewers use `bun run test`, not bare `bun test`, when spot-checking this or later changes.
  - [P3] `openspec/changes/add-chat-session-binding/verification.md` — Disclosed Linux GUI smoke gap. Electron cannot load libnspr4.so on this host, so no GUI smoke was performed for either this review or the implementation evidence (same gap as 1a/TICKET-114). Compensating evidence is substantial: full targeted binding/fence/checkpoint/router/transport suites pass, ts:check is clean, architecture guard passes, and the full isolated test run matches the recorded receipt exactly. Owner should still gate final acceptance on a real desktop smoke when a compatible host is available.

#### Reviewer summary

Fresh-context review of add-chat-session-binding at source SHA 1d019f8d4fab38829ad0e3108e9569b260ab9302 (worktree /home/chen/projects/locus-add-chat-session-binding, HEAD e10e31ca = source SHA + a docs-only evidence commit touching only tasks.md/verification.md, confirmed via `git diff --stat`).

Verified item-by-item against the (revised) proposal:

1. Schema/migration: `drizzle/0023_lonely_wrecking_crew.sql` and `src/main/lib/db/schema/index.ts` (subChatBindings, ~L164-198) match the C4 seed exactly — runtime NOT NULL, providerProfileId/modelId/modelSource/thinkingLevel nullable, unique index on sub_chat_id, FK cascade to sub_chats. Backfill (`backfillSubChatBindings` in src/main/lib/chat-session-binding.ts:554-595) is insert-if-missing and invoked immediately after `migrate()` in src/main/lib/db/index.ts:64-65. `inferAgentChatProviderFromMessages` has exactly one non-definition, non-test call site (chat-session-binding.ts:573), confirmed by grep across src/.

2. Canonical owner: src/main/lib/chat-session-binding.ts owns all get/seed/update/copy/backfill logic; chats-crud.ts and chats-sub-chats.ts call into it as thin envelopes (seed at chats.create ~L186, chats.createSubChat ~L142, updateSubChatBinding ~L158, forkSubChat copy ~L270).

3. Transports: ChatSessionBinding is injected via constructor config in both ipc-chat-transport.ts and acp-chat-transport.ts (grep confirms no remaining appStore reads/writes of binding-semantics atoms, only unrelated atoms like extendedThinkingEnabledAtom/sessionInfoAtom/approvedGuardedRunContractsAtom). active-chat.tsx has zero occurrences of subChatProviderOverrides or inferProviderFromMessages/inferAgentChatProviderFromMessages.

4. Atom deletion: all five identifiers (subChatModelIdAtomFamily, subChatClaudeModelSourceAtomFamily, subChatCodexModelSourceAtomFamily, subChatCodexModelIdAtomFamily, subChatCodexThinkingAtomFamily) are absent from src/ (grep, zero hits). lastSelected* atoms and subChatModeAtomFamily remain in atoms/index.ts. getNewChatSessionBindingDefaults / getNewSubChatBinding (renderer) read lastSelected* only at chat-creation and empty-chat runtime-switch call sites (agents-project-worktree-tab.tsx, active-chat.tsx getNewSubChatBinding, chat-input-area.tsx engine switch, agents-subchats-sidebar.tsx) — server-side updateSubChatBinding still rejects a runtime change unless the persisted message list is verifiably empty, so this cannot resurrect stale local state for non-empty chats.

5. Guards: scripts/check-architecture-guards.mjs bans binding-semantics atomWithStorage/atomFamily generically via AST inspection (CHAT_BINDING_SEMANTIC_NAME + collectPerChatBindingAtomFindings, ~L1706-1750), not just an allowlist of the five names, and bans inferAgentChatProviderFromMessages call sites outside the owner/shared definition file. Ran `bun run scripts/check-architecture-guards.mjs` directly — passes. docs/OWNERSHIP_MAP.md registers both 'Chat Session Binding' (L78-91) and 'Chat Maintenance Fence (Temporary Phase 5 Precursor)' (L136-171) with the mandatory Phase-5 absorption/deletion note (L168-171).

6. R1 (provider-profile thinking exception): normalizeChatSessionBindingWrite in src/shared/chat-session-binding.ts:188-207 forces thinkingLevel=null whenever providerProfileId is set, applied uniformly to every write path (seed/update/copy). Renderer wires `supportsThinking: !selectedCodexProfileId` in chat-input-area.tsx:2476, hiding/disabling the effort UI for profile-backed chats. TICKET-116 exists and documents the deferred real-effort-support Yellow follow-up with no scope creep.
   R2 (maintenance fence): src/main/lib/agent-runtime/chat-maintenance-fence.ts is purely in-memory (two Maps + a WeakSet, no DB import), synchronous acquire/claim closes the TOCTOU window (blocker installed atomically at claim time and consulted by acquireChatMaintenanceFence via getLatestRunBlocker, closing the gap between claim success and actual session registration), BUSY error uses code SESSION_BINDING_BUSY with subChatId/operation/activeRunId/reason exactly as specified. chats-sub-chats.ts rollbackToMessage acquires the fence before all work and releases it in a `finally` (L351-472), covering success/error/throw. updateSubChatMessages is fully deleted (only a negative-assertion test reference remains). Checkpoint verification in src/main/lib/git/stash.ts re-resolves the ref via `rev-parse --verify` and compares the exact OID both before and immediately before each destructive read-tree/checkout-index/clean sequence (retried up to 3x with a fresh OID recheck each attempt), failing closed on any mismatch, missing ref, or partial metadata.

7. Behavior preservation: backfillSubChatBindings only reads subChats.messages (never writes it), so byte-identity holds. Headless/Local Job surfaces are provably untouched (`git diff 0dee7dc0..1d019f8d -- src/main/lib/headless src/shared/local-job-api.ts docs/local-job-api-v1.schema.json` is empty). Ran targeted suites directly: chat-maintenance-fence, chat-session-binding(-gate/-router/-transports/-defaults/-renderer-owner), git-rollback-stash, chat-session-provenance, chat-stream-resume, message-store-rollback-checkpoint, desktop-run-admission-generation-race, desktop-run-binding-admission-order — all green. `bun run ts:check` clean. Full `bun run test` (the canonical --isolate invocation) reproduced exactly 1897 pass / 0 fail / 9230 expect() calls, matching verification.md's recorded receipt. Worktree confirmed clean (`git status --porcelain`) before and after all commands.

No P0/P1 findings. Two P3 notes recorded (test-runner isolation footgun for future reviewers; the already-disclosed Linux GUI smoke gap, for which the compensating evidence — full green isolated suite, clean ts:check, passing architecture guard, and direct manual code-path inspection of the fence/checkpoint/binding logic — is substantial). Both R1 and R2's five constraints, and every checklist item in the review brief, verify against the code as implemented at 1d019f8d4fab38829ad0e3108e9569b260ab9302.

### Security / trust-boundary review

- Verdict: **`REVIEW_APPROVED`** for `1d019f8d4fab38829ad0e3108e9569b260ab9302`.
- Findings (non-blocking):
  - [P3] `src/main/lib/db/schema/index.ts` — Provider profiles are user-global, not project-scoped — 'ownership' framing does not map to a real boundary. agentProviderProfiles has no projectId column, so there is no per-project profile ownership concept in this local single-user app; updateSubChatBinding (src/main/lib/chat-session-binding.ts:401-536) validates providerProfileId only by existence/capability (assertNewProviderProfileBindingUsable), not by project affiliation. This matches the app's actual trust model (single local user owns all profiles) so it is not exploitable as a privilege-escalation vector, but the review-brief phrasing ('inject a providerProfileId it doesn't own') presumes a boundary that doesn't exist in the schema. Informational only — no fix required unless profiles become project-scoped in a future change.
  - [P3] `src/main/lib/trpc/routers/chats-sub-chats.ts` — updateSubChatBinding takes subChatId with no chatId cross-check in the tRPC input. updateSubChatBinding: publicProcedure input is {id, binding} with no chatId, so the route trusts subChatId alone (chats-sub-chats.ts:150-161). Given single-user local trust model this is low risk, but if a future change adds any renderer content that isn't fully trusted (e.g. embedded webview/MCP output driving IPC calls), a stricter contract binding subChatId to an expected chatId would be a cheap defense-in-depth addition. Not a blocking issue for this change.

#### Reviewer summary

Scope confirmed: worktree HEAD e10e31ca = 1d019f8d (implementation) + one docs-only commit touching only tasks.md/verification.md (git diff --stat verified, 2 files, docs only). Full review conducted read-only; git status clean after `bun test`, `bun run architecture:check`, `bun run ts:check` (all in-scope, no writes).

Risk summary: This change closes a real, previously-unmitigated race between destructive rollback (git checkout-index/clean + message-history truncation) and an in-flight desktop Run, and removes a prior arbitrary chat-history overwrite route (updateSubChatMessages). No P0/P1 found. The mutual-exclusion design (chat-maintenance-fence.ts) is sound in both directions and closes the TOCTOU window that a naive implementation would have: rollback's fence.acquire() is checked synchronously and, critically, the Run's admission commit (claimDesktopRunAdmissionWithMaintenanceFence) re-checks the live maintenance-fence map at the exact moment it would start executing — so even if a Run reserved its admission before rollback acquired the fence, the Run's final claim is rejected once the fence is held, and rollback's own fence-holder window is protected by a synchronous invalidateDesktopRunAdmission() call before the fence Map is installed. Release is guaranteed via try/finally on both the rollback route (chats-sub-chats.ts) and both runtime routers (claude.ts, codex.ts), including exception paths mid-rollback and mid-run.

Findings by review item:
1. Maintenance fence bidirectionality — VERIFIED. src/main/lib/agent-runtime/chat-maintenance-fence.ts implements acquireChatMaintenanceFence (rollback side, chats-sub-chats.ts:351-471, released in `finally`) and claimDesktopRunAdmissionWithMaintenanceFence (run-start side, wired symmetrically into BOTH src/main/lib/trpc/routers/claude.ts:204/465 and src/main/lib/trpc/routers/codex.ts:589/885 — a fence honored by only one runtime would have been P1, but both are covered). Exact-token release (Object.freeze + `Map.get(id) !== token` guard) prevents stale-cleanup races; runBlockersBySubChat/maintenanceInvalidatedAdmissions close the residual TOCTOU windows described in the docstrings, and tests/desktop-run-admission-generation-race.test.ts + tests/desktop-run-binding-admission-order.test.ts + tests/chat-maintenance-fence.test.ts (all passing, 100+23 tests, 0 fail) exercise these interleavings directly.
2. Fence constraint compliance (R2.1/R2.2) — VERIFIED. Storage is exclusively module-scope Map/Set/WeakSet (no DB writes, no agent_jobs/binding-row touch), `clearChatMaintenanceFencesForTest` confirms restart-clears semantics, and docs/OWNERSHIP_MAP.md:136-170 registers this exactly as a temporary precursor that Phase 5's C4 SessionBinding lease must absorb/delete. The renderer can only reach the fence indirectly via `rollbackToMessage` (validated tRPC input: subChatId + sdkMessageUuid) — no direct set/clear exposed. ChatMaintenanceBusyError (chat-maintenance-fence.ts:20-26) carries only code/subChatId/operation/activeRunId/reason — no paths, tokens, or credential material.
3. Binding writes — VERIFIED with one informational note (see findings). updateSubChatBinding (src/main/lib/chat-session-binding.ts:401-536) rejects mutation while a Run is active, fails closed on runtime switch unless messages are provably empty, and validates providerProfileId existence + capability (target runtime, defaultModel snapshot match) via assertNewProviderProfileBindingUsable before persisting. ChatSessionBinding DTO (src/shared/chat-session-binding.ts) carries only id/runtime/providerProfileId/modelId/modelSource/thinkingLevel — reference fields only, no secrets. getProviderProfileChatBindingMetadataFromDatabase (provider-profiles/storage.ts) selects only id/targetRuntimesJson/defaultModel — confirmed no credential columns leak into the binding-admission path.
4. Backfill safety — VERIFIED. backfillSubChatBindings (chat-session-binding.ts:554-595) only reads subChats.messages (never mutates it), inserts via `onConflictDoNothing({target: subChatBindings.subChatId})` making repeated invocation a no-op, and is called exactly once from src/main/lib/db/index.ts:65 during main-process DB initialization — not exposed via any tRPC route, so it cannot be renderer-triggered.
5. updateSubChatMessages deletion — VERIFIED. Confirmed present at base (`git show 0dee7dc0:...chats-sub-chats.ts` line 261) and absent at the reviewed SHA; tests/chat-session-binding-router.test.ts:727 asserts `"updateSubChatMessages" in subChatProcedures === false` as a regression guard. Checkpoint OID verification (src/main/lib/git/stash.ts applyRollbackStash) pins the exact 40/64-hex OID and re-verifies it immediately before the destructive read-tree/checkout-index/clean sequence (double-check pattern defeats a ref being swapped between initial resolve and apply); ref format is restricted to `^refs/locus-checkpoints/<uuid>$` and OID to hex-only via isCanonicalRollbackCheckpointBinding (src/shared/chat-message.ts:37-38, 63-70), enforced both at write time (zod schema) and read time — this prevents checking out an arbitrary/attacker-influenced ref such as refs/heads/main. tests/git-rollback-stash.test.ts:163 ("rejects a wrong expected OID before modifying the worktree") gives adversarial coverage; passing.
6. R1 (thinkingLevel exception) — VERIFIED, structurally enforced, not just convention. normalizeChatSessionBindingWrite (src/shared/chat-session-binding.ts:196-198) forces `thinkingLevel = null` unconditionally whenever `providerProfileId` is set, regardless of caller input — so no stale/legacy persisted value can survive a profile bind. expectedCodexTransportModel (chat-session-binding.ts:211-219) returns `${modelId}/none` for profile bindings, ignoring thinkingLevel entirely on the gateway-facing path. Renderer UI gates the effort control via `supportsThinking: !selectedCodexProfileId` (chat-input-area.tsx ~2472). No gateway capability widening found; TICKET-116 correctly recorded as the deferred real-effort-support ticket, not implemented here.
7. Import-boundary / redaction pipelines — VERIFIED. `bun run architecture:check` and `bun run ts:check` both pass clean at this SHA. Reviewed diffs to stream-event-mapper.ts (adds approvalId passthrough, non-security) and agent-sdk-guard-metadata.ts / agent-guard/active-contracts.ts (refactor from contractId-string-keyed registries to subChatId-keyed + exact-object-identity registries) — this is a net security hardening (closes cross-chat contractId-collision confusion and stale string-ID lookups), consistent with the exact-token pattern used elsewhere in this change. No new secret logging found in the full main-process diff (grepped for token/secret/key/password/credential/oauth near new console.log/error/warn calls — zero matches).

Verification gaps: No Electron GUI smoke possible on this Linux host (disclosed, same gap as 1a/TICKET-114) — compensated by targeted adversarial unit/integration tests (chat-maintenance-fence, admission-generation-race, binding-admission-order, git-rollback-stash) all passing, plus architecture/type checks passing clean. This review did not execute the full `bun run check:full` suite (time-scoped to security-relevant files/tests per the assigned lens) — the fresh-context implementation-verification review's full-suite results should be treated as the primary coverage record; this pass corroborates the security-relevant subset only.
