## 1. Governance and Baseline

- [ ] 1.1 Freeze the approved proposal source SHA and record explicit Owner
  `APPROVED`, including a disposition (`DIRECT_NEW_STANDARD`, `NEW_VERSION`,
  `TEMPORARY_FACADE`, `DEFER`, or `REJECT`) for every C7 Red class in proposal rows 2,
  3, 4, 5, 7, and 8; do not begin implementation while this change remains DRAFT.
- [ ] 1.2 Record the baseline implementations and archived requirements that produced
  the current event paths, then capture characterization evidence for desktop,
  headless, job-store, and Local Job API ordering/terminal behavior without changing
  the expected new contract.
- [ ] 1.3 Inventory consumers using the Consumer Impact template: Amadeus, Career Kit,
  and any additional/unknown callers; classify whether Amadeus's native app-server
  stream is public or internal and freeze representative fixtures.
- [ ] 1.4 Update `docs/OWNERSHIP_MAP.md` in the future implementation change to name
  `run-event-ledger.ts` as per-Run ingestion/order owner, `runtime-events.ts` as
  envelope owner, `redaction.ts` as algorithm owner, `run-artifacts.ts` as artifact
  admission owner, and job-store as exact-sequence sink.
- [ ] 1.5 Have an independent test author translate every delta Scenario into a Bun
  acceptance test using only the documented seam, record its initial expected failure,
  and link each test to one Scenario before implementation begins.

## 2. Ledger Owner and Identity

- [ ] 2.1 Add `createCanonicalRunEventLedger` with injected Run identity,
  deterministic clock, exact RuntimeInstallation/protocol provenance, atomic
  `durableStore`, retryable projections, and observable `read(afterSequence)` seam;
  derive/validate high-water sequence from the store and reject any caller-owned
  initial-sequence authority.
- [ ] 2.2 Route `job_created`, `job_started`, JSON-RPC response, notification, server
  request, response-send, request-resolved, snapshot, restart, and transport-exit
  boundaries through the one per-Run ledger before projection or persistence.
- [ ] 2.3 Make the ledger-assigned value the internal `RunEvent`, durable job-event,
  and Local Job API cursor sequence; prove strict increase across restart, remove every
  independently assigned nested sequence, and preserve the existing optional public
  `runEventSequence` only as a deprecated equality alias that is never a second cursor.
- [ ] 2.4 Add optional redacted `payload.runtime.codex.v1` identity with independently
  preserved `threadId`, `sessionId`, `turnId`, `itemId`, `requestId`, and `callId`;
  test that thread/session are never substituted.
- [ ] 2.5 Converge renderer/durable/API attempt identity so event/public `jobId`, when
  present, equals canonical `runId`; reject mismatch before provider work, and prove a
  retry creates a new ledger/new `runId` with direct/root/attempt provenance without
  mutating the source Run.
- [ ] 2.6 Make atomic exact-sequence durable commit and projection-obligation creation
  the ingestion acknowledgement/visibility barrier. Serialize pending facts, reconcile
  failed or unknown commits by stable fact key, retry the same fact/sequence, and resume
  failed projections from durable cursor without rollback or duplicate API delivery.
- [ ] 2.7 Apply canonical redaction once before fan-out while retaining run/item/channel
  state across adjacent fragments, withholding possible exact-secret prefixes and
  flushing them safely at item/terminal boundaries so renderer, chat, Workbench,
  headless, persistence, and API projections consume the same sanitized fact.
- [ ] 2.8 Introduce the implementation-only `canonicalRunEventLedgerV1` selection at
  Run construction and assert legacy-or-ledger exclusivity; prohibit shadow dual-write.
- [ ] 2.9 Route Claude desktop stream/output boundaries through the same ledger and
  replace its raw renderer-emitter path, while leaving Claude query-resume options,
  chat-history fork flag, and one-shot handle CAS behavior unchanged for Phase 5.

## 3. Item State Machine and Reconciliation

- [ ] 3.1 Implement item correlation and `started -> delta* -> completed` transitions
  for assistant, reasoning, and every supported tool item, preserving reasoning part
  boundaries and native item identity.
- [ ] 3.2 Reconcile assembled deltas against the authoritative completed snapshot with
  explicit `matched`, `suffix_repaired`, `missing_local`, `missing_native`, or
  `mismatch` results and `lossPossible` where applicable.
- [ ] 3.3 Tolerate missing, duplicate, and out-of-order transitions with bounded state;
  never guess divergent content or append a completed assistant/reasoning snapshot as
  another user-visible delta.
- [ ] 3.4 Replace desktop raw `appServerPersistenceChunks` and blind text-delta joining
  with the reconciled ledger projection, and derive structured/final output from the
  same authoritative item state.
- [ ] 3.5 Map command execution, file change, MCP tool call, dynamic tool call,
  collaboration-agent tool call, web search, and image generation lifecycle fixtures
  plus image-view boundaries to one correlated start where supplied, zero or more
  progress events, and one finish/status transition.

## 4. Errors, Terminal, Usage, and Artifact

- [ ] 4.1 Preserve sanitized native error code, `willRetry`, native correlation, and
  exact provenance; classify errors as diagnostic/retryable/fatal-candidate/policy
  denial rather than treating every error chunk as terminal failure.
- [ ] 4.2 Make the ledger the only terminal minting owner and atomically persist exactly
  one `completed` with `succeeded`, `failed`, `canceled`, or `interrupted`; delete
  adapter pending-terminal state and job finalizers that mint another completion.
- [ ] 4.3 Implement the Owner-approved completion-truth mapping so denial, rejection,
  and invalid zero-output runs cannot return unqualified success, while preserving an
  explicit valid-empty-output exception if approved.
- [ ] 4.4 Distinguish a definitive exit from a bounded replacement registered by the
  same in-process Run owner before exit. Bind an approved replacement to the same
  ledger/Run/installation/protocol before its deadline; otherwise convert exit/expiry/
  mismatch into one synthetic terminal with exit provenance. Enforce the approved late
  policy without changing settled outcome or emitting a second terminal.
- [ ] 4.5 Emit usage as cumulative `kind=snapshot`, retaining normalized total and last
  observation, deduplicating by native scope/vector, marking reset/discontinuity, and
  treating the first post-resume snapshot as a baseline rather than a delta.
- [ ] 4.6 Add canonical artifact candidate admission for regular-file existence, real
  path/symlink/hardlink safety, allowed scope, run ownership, stability, size/type,
  SHA-256, and redaction; commit manifest association before the existing
  `artifact_created` event and before terminal.
- [ ] 4.7 Keep Local Job API v1 artifact field shapes and its existing event name; make
  rejected candidates observable as sanitized diagnostics without creating an event or
  manifest entry. Factor reusable run-directory/atomic-write/stable-file/digest I/O from
  `headless/local-job-api.ts`, and delete `headless/cli-dispatcher.ts` direct initial
  event/final registration so no non-owner decides artifact eligibility or manifest state.

## 5. Unknown Methods and Stable Status Subtypes

- [ ] 5.1 Replace every native/default `[]` or `null` projection with a ledger
  observation and prohibit transport, mapper, or adapter branches from silently
  discarding admitted native input.
- [ ] 5.2 Implement and table-test stable `status` subtypes for thread lifecycle, turn
  lifecycle, compaction, reroute, warning, MCP lifecycle, OAuth lifecycle, approval
  review, interaction boundary, runtime process, repair, unknown native method, and
  late event.
- [ ] 5.3 For unknown methods, retain sanitized method/correlation/provenance and
  payload-shape metadata with `lossPossible=true`, without storing arbitrary raw
  payload or relying on free-form text as the only discriminator.
- [ ] 5.4 Update the architecture guard with self-proving violating/clean fixtures that
  keep `createRunEvent` in `runtime-events.ts` and `redactRuntimePayload`,
  `redactExactSecretHints`, `createExactSecretStreamRedactor`, and
  `createExactSecretStreamChannelRedactor` in `redaction.ts`;
  reject a second ledger/allocator/terminal owner, raw adapter/route writes, unknown
  empty projection, headless envelope stripping, and legacy mapper/renderer fact or
  redaction buffers.

## 6. Provenance and Resume Repair

- [ ] 6.1 Capture an immutable pre-run RuntimeInstallation/protocol snapshot with
  runtime and adapter IDs, installation ID, executable real path, binary SHA-256,
  version/build when available, and schema/protocol identity; fail closed if the
  Owner-approved required identity is unavailable.
- [ ] 6.2 Bind the exact provenance to every ledger and derived trace record, including
  synthetic and repair records, while redacting local-secret path material from
  consumer projections.
- [ ] 6.3 Implement `repairFromSnapshot` as comparison against durable high-water state,
  always marking `repair.source=snapshot`, `lossPossible`, source identity, and per-item
  reconciliation result; never call it replay or expose a native cursor downstream.
- [ ] 6.4 Continue sequence and permit repair only for an unsettled, pre-authorized,
  same-Run replacement bound before its deadline. After a definitive exit or durable
  terminal, missing/malformed/truncated rollout and later snapshots are diagnostics only
  and cannot fabricate repair or overwrite failed truth.
- [ ] 6.5 Record server-request ingress, response-send, and resolved facts only; verify
  that no full Interaction FSM, lease/epoch fencing, async-submit/idempotency, or Claude
  handle CAS leaks into this change.

## 7. Conformance Fixtures (Tests First)

- [ ] 7.1 Add trace-shaped `[EVENT-01]`, `[EVENT-02]`, and `[EVENT-03]` fixtures at
  `createCanonicalRunEventLedger` and adapter boundaries, including interleaved JSON-RPC
  response/notification/server-request/response-send/resolved ordering.
- [ ] 7.2 Add assistant delta+final and reasoning delta/summary-part+final fixtures;
  assert authoritative completed reconciliation, preserved part identity, no duplicate
  text, and detectable loss/mismatch.
- [ ] 7.3 Add each tool lifecycle fixture: command execution, file change, MCP tool,
  dynamic tool, collaboration-agent tool, web search, and image generation; assert
  correlation and exactly one finish per admitted completed snapshot. Add image view
  with its native start/completed boundaries even when it has no delta.
- [ ] 7.4 Add retry-error-then-success and fatal-error fixtures; assert native code,
  `willRetry`, diagnostic versus terminal classification, and exactly one final
  `completed` with correct truth.
- [ ] 7.5 Add cancellation/interrupt fixtures and assert provider work stops, final
  status follows the approved mapping, and no second terminal appears.
- [ ] 7.6 Add repeated, increasing, decreasing, and post-resume usage snapshots; assert
  total/last values, dedupe key, discontinuity, and baseline semantics.
- [ ] 7.7 Add a future unknown native method containing secret-like values and a
  table-driven status-taxonomy fixture; assert a stable sanitized observation rather
  than `[]` or arbitrary-text-only state.
- [ ] 7.8 Add missing, duplicate, and out-of-order item transitions plus late events;
  assert bounded reconciliation, loss markers, immutable completion truth, and no
  duplicate content or terminal.
- [ ] 7.9 Add separate unplanned exit, crash, pre-authorized same-Run replacement,
  replacement timeout/identity mismatch, and no-native-terminal fixtures; assert only a
  successfully bound replacement continues the exact high-water sequence and repairs
  before settlement, while every definitive case gets one synthetic terminal with
  provenance.
- [ ] 7.10 Add resume snapshot repair with `[CODEX-07]` cross-version completed-item
  samples; assert snapshot source, loss possibility, reconciliation result, and
  canonical sequence as the only cursor.
- [ ] 7.11 Add `[CODEX-06]` missing/malformed/truncated rollout samples; assert precise
  sanitized diagnostic and no invented snapshot replay.
- [ ] 7.12 Add `[CODEX-08]` error/failed-rollout persistence and restart; assert the
  rollout write path persists error and failed terminal before close and rehydrate
  remains terminal after restart.
- [ ] 7.13 Add positive artifact fixtures and negative missing/out-of-scope/symlink/
  hardlink/cross-run/unstable/secret-bearing candidates; assert admission, digest,
  manifest ownership, redaction, and event absence on rejection.
- [ ] 7.14 Add assistant, reasoning, tool, and diagnostic fixtures that split each exact
  provider/gateway secret across adjacent fragments and terminal flush; assert no
  individual ledger event, reconstructed message, trace, result, artifact metadata, or
  public envelope exposes the secret or a withheld prefix.
- [ ] 7.15 Run the same native fixtures through desktop and headless adapters; assert
  identical canonical sequence/facts, one terminal, renderer/persistence equivalence,
  CLI/API replayability, and no envelope stripping.
- [ ] 7.16 Assert `LOCAL_JOB_API_EVENT_TYPES` remains the exact 12-value set, `--after`
  reads are strictly increasing without loss/duplication, `--follow` exits at public
  terminal, and all additions are optional/redacted/unknown-safe under the approved
  late-event disposition.
- [ ] 7.17 Run Amadeus native assembler/tool/completion/cursor fixtures and Career Kit
  batch/structured-output/result/artifact fixtures; record pass/fail, consumer version,
  schema version, and any coordinated migration. Record remaining consumers as
  `unknown`, not “none”.
- [ ] 7.18 Retain trace §6.2's unmeasured 66-notification frequency/total-order variants
  as a named follow-up; do not claim conformance evidence for unexecuted cases.
- [ ] 7.19 Fault-inject definite pre-commit failure, unknown commit outcome, crash after
  commit/before fan-out, and individual projection failure; assert no uncommitted
  acknowledgement/visibility, stable-fact-key same-sequence recovery, durable high-water
  replay, no overtaking/rollback, and no duplicate API event.
- [ ] 7.20 Feed matching and mismatched renderer/durable/API `runId`/`jobId` identities
  plus a retry chain through each Run constructor; assert equality aliases, fail-closed
  mismatch before provider work, new ledger/ID per retry, and immutable source history.

## 8. Verification, Review, and Stop Gates

- [ ] 8.1 After all red-first evidence is recorded and implementation is green, run
  targeted ledger, Codex adapter, desktop/headless parity, job-store, Local Job API,
  durable fault-injection, identity/retry, architecture-guard, redaction, and artifact
  tests and attach exact commands/output to `verification.md`.
- [ ] 8.2 Run `bun run check:full`,
  `bun x openspec validate refactor-canonical-run-event-ledger --strict --no-interactive`,
  `git diff --check`, and the repository's secret/residue checks on the frozen source
  SHA; record honest pass/fail and environment limitations.
- [ ] 8.3 Prove deletion in the same implementation change: no native default empty
  projection, adapter/mapper allocator, raw desktop fact buffer, headless envelope/
  completed suppression, job-store re-sequencing, second terminal writer, thread/session
  fallback, raw renderer redaction/emitter path, or direct candidate-to-artifact event
  remains; no non-`run-artifacts.ts` path mints `artifact_created` or owns manifest
  admission, and exact-owner guards for preserved envelope/redaction algorithms still
  pass.
- [ ] 8.4 Remove `canonicalRunEventLedgerV1` and the entire legacy branch after all Run
  constructors cut over; stop review if the migration gate, shadow write, or any second
  business path remains.
- [ ] 8.5 Obtain independent correctness, architecture, consumer-compatibility, and
  security reviews against the same source SHA; resolve every P0/P1/P2 finding or record
  an explicit Owner disposition without relabeling an unrun check as passed.
- [ ] 8.6 **Owner ACCEPTED stop gate:** do not merge, archive, or call the change
  complete until the Owner explicitly says `ACCEPTED` for the frozen implementation and
  verification evidence. `APPROVED`, green tests, and `REVIEW_APPROVED` are not
  substitutes.
- [ ] 8.7 **Remote-operation stop gate:** no push is authorized by this proposal or
  tasks file. Do not push or otherwise change a remote without separate explicit Owner
  authorization; record any later authorized operation independently.
