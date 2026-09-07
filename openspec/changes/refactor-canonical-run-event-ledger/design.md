# Design

Status: **DRAFT — awaiting Owner APPROVED**

## Context and Source Basis

Current product truth is code plus living specs at the reviewed base
`0bd7b2bf2452773d416c7009a208e9590daa679f`. The
[trace](../../../docs/native-resume-event-gap-trace-2026-09-04.zh-CN.md) is research,
not an approved implementation. [C2/C5/C7](../../../docs/ideas/locus-interoperability-contract-v1.zh-CN.md),
[strategy §§9/12](../../../docs/ideas/locus-product-direction-harness-strategy.zh-CN.md),
[workflow](../../../docs/ideas/locus-ai-collaboration-workflow.zh-CN.md) and
[ownership map](../../../docs/OWNERSHIP_MAP.md) constrain this slice.

| Evidence class | What is known / what is proposed |
| --- | --- |
| Measured/static trace fact | Codex 0.139 enumerates 66 notifications, 10 server requests, 16 item variants; current decoder maps 11 notifications; no global native cursor is present in their schema. |
| Measured trace fact | Resume may emit status before response, emits no thread/started in successful samples, and failed/error can become completed/error-null in Codex's own disk reconstruction (§3.1, CODEX-08). |
| Trace inference, adopted policy | Resume snapshot is not lossless event replay (§6.1); independent process resume is an offline view, not proven live attach; native thread and session must remain distinct. |
| Static provenance caveat | Trace §5.1 observes non-deterministic v2.schemas.json generation; use reproducible per-file/TS-manifest fingerprints, not that directory-manifest digest. |
| Defensive inference, synthetic tests | Counter reset/decrease, incompatible-schema rejection, post-terminal usage and interrupted in-flight snapshot handling are proposed safety rules, not measured native behavior. |
| Consumer fact | Amadeus direct native consumption: Owner relay 2026-09-02, confirmed as dispatch input here; not established by trace and not a Locus public boundary. |
| Unmeasured | Trace §6.2 dynamic frequency/order, realtime/remote/process/Windows behavior, native event retransmission, SIGKILL/power loss, in-flight rollout continuity; no support claim. |

The internal envelope is owned by `agent-runtime/runtime-events.ts`, redaction by
`agent-runtime/redaction.ts`, and usage-vector normalization by
`src/shared/usage-metadata.ts`. New ledger orchestration replaces existing business
paths; it does not become an alternate runtime, auth, interaction or binding owner.

## Goals / Non-goals / Autonomy Envelope

Goals: one committed order, testable item/usage/outcome evidence, truthful repair,
complete observable native disposition, canonical artifacts and atomic old-path deletion.
The permitted implementing modules are the inventory below plus their tests, Drizzle
schema/migrations, ownership/guards, shared types and consumer docs. Acceptance is the
six delta specs and tasks; changing these requires a revised draft.

Non-goals: C2 cross-constructor identity/cancel protocol convergence; complete C5 FSM;
Phase 5 same-Run transport replacement/lease/epoch/live-attach and Claude one-shot CAS;
async submit/v1.1 request gating/idempotency; runtime delivery registry; runtime selection
changes; native rollout writing; dynamic certification of trace §6.2 surfaces. Their
follow-up destinations are recorded in [proposal](proposal.md#non-goals).

Green: move the specified event behavior to its owner and replace all specified callers.
Yellow: adjacent owner cleanup or new protocol conformance research is recorded for a
follow-up. Red: additional public semantics, new grants/secret sources/dependencies,
Run construction or lease redesign, consumer/repository data deletion, or scope outside
this inventory requires a new Owner decision before that implementing work.

## Decisions — 统筹预设 L1–L12（Owner 可改）

This table is the original brief's preset scope, without attributing the implementation
mechanisms below to the coordinator. L10's consumer attribution is corrected by this
dispatch; L12's impossible Locus rollout-write seam is disposed in verification.

| Preset | Required behavior |
| --- | --- |
| L1 | One ledger owner per Run in its host process ingests JSON-RPC response/notification/server request plus response-send/resolved and assigns canonical sequence. |
| L2 | Preserve available redacted native threadId/sessionId/turnId/itemId/requestId/callId beside canonical sequence; never substitute thread for session. |
| L3 | Reconcile started → delta* → completed items, tolerate missing/duplicate/out-of-order input, use final snapshot authority without duplicate assistant/reasoning text, mark loss. |
| L4 | Retain willRetry/code and diagnostic-vs-terminal evidence; one completed per Run; transport exit yields synthetic terminal with provenance; explicit late policy; denial/rejection/invalid-empty cannot be bare success. |
| L5 | Fix snapshot/delta semantics, total/last, dedupe and resume baseline. |
| L6 | Native file/diff/image/path is only candidate evidence; the artifact owner validates scope/existence/digest/Run ownership/redaction before artifact_created; correct the existing enum omission. |
| L7 | No silent default [] for native methods; stable machine-readable status categories and unknown/loss. |
| L8 | Exact RuntimeInstallation, binary digest and protocol/schema provenance on each Run/trace. |
| L9 | Snapshot repair has source=snapshot, lossPossible and reconciliation; only Locus sequence is a downstream cursor. |
| L10 | Frozen 12-type Local Job API v1, optional payload additions only, accurate ten-row C7 assessment and explicit Owner disposition for Red. |
| L11 | Exclude full interactions, lease/fencing, async-submit/v1.1/idempotency, Claude CAS and unmeasured 66-method dynamics; name follow-ups. |
| L12 | Independent spec-based acceptance tests first (red), then implementation (green); every scenario has an entry, fixture and observable assertion. Pilot source is the coordinator brief, not the ratified workflow. |

## Decisions — 起草者补充（非预设，Owner 可删）

| Addition | Choice and reason |
| --- | --- |
| D1 durable visibility | SQLite commits before acknowledgement/fan-out; events plus cursor checkpoints serve as replayable projection obligations, avoiding a second outbox table. Needed to prevent a displayed fact that was never stored. |
| D2 fact key / crash | Persist a per-Run unique fact key; retry the same handoff without duplicate facts. Drop the prior network-style unknown-commit API: synchronous SQLite returns commit or rollback; crash/reopen reads committed facts/high-water. No claim that current SQLite produces unknown outcomes. |
| D3 internal alias | Remove the desktop runEventSequence wrapper and its reader atomically, with no compatibility alias. C7 §9.1 does not permit retaining an internal alias for hypothetical consumers. Existing renderer runId remains stream metadata; constructor convergence is deferred. |
| D4 redaction | One Run-scoped stateful stream redactor with memory-only exact secret hints, before any durable/public fan-out; preserve the existing provider-runtime-bindings split-secret invariant. |
| D5 public order | Dense sequence from 1, one v1 projection per record, safe status stubs for restricted evidence. This avoids the prior design's new sparse-sequence C7 #5 break. |
| D6 terminal / late | Freeze output and usage when the ledger receives the terminal boundary; no timer/drain or replacement window. All later observations, including usage, become diagnostic-only status/late_event. Deterministic tests do not assume unmeasured native ordering. |
| D7 outcome mapping | Denial/rejected/invalid-empty maps to existing failed; explicit cancel to canceled, interrupt/transport exit/recovery to interrupted; retry diagnostics alone do not fail. No new public status enum. |
| D8 artifacts | Prepare terminal files from a frozen candidate completed record; register their refs with completed in one SQL commit. Final projections do not emit artifact_created, avoiding circular event/digest dependencies. |
| D9 history | Add ledger_version=0 legacy-unverified marking; retain historical bytes/IDs/sequences, prohibit extension by the new ledger, do not fabricate missing provenance or terminal evidence. |
| D10 provenance | Minimal immutable installation/source/version/digest/schema snapshot in the existing job record; no delivery registry. Provider-only completion jobs identify a Locus completion execution source, not a fictional Codex installation. |

No D1–D10 choice is current implemented truth. A different Owner choice is incorporated
in the draft/specs before implementation; living requirements contain deterministic
behavior only.

## Test-facing Contract

These are proposed exported **internal** seams for independent tests; they do not add a
public API. `runId` is the existing durable job ID passed to the ledger. The composition
owner keeps any existing renderer ID as stream metadata without changing its minting,
stream/cancel routing or admission authority. `runtimeId` is always the stored runtime;
provider-only jobs can use an execution provenance variant without inventing a binary.

```ts
type ExecutionProvenance =
  | { kind: "runtime"; installationId: string; runtimeId: string;
      adapterSource: string; version: string; executableRef: string;
      binarySha256: string; protocolName: string; protocolVersion: string;
      schemaFiles: { path: string; sha256: string }[] }
  | { kind: "locus-completion"; runtimeId: string; locusBuild: string;
      adapterSource: "completion"; protocolName: string; schemaSha256: string }

type Boundary = {
  observationKey: string; // internal handoff ID, retained across append retries
  transportId: string; receivedAt: string;
  message: { id?: string | number; method?: string; params?: unknown;
             result?: unknown; error?: { code: string | number; message: string } };
  request?: { id: string | number; method: string; params: unknown;
              intent?: "start" | "resume" | "fork" | "attach";
              expectedSessionId?: string };
}
type OutcomeEvidence = {
  trigger: { kind: "native_terminal"; status: "succeeded" | "failed";
             observationKey: string; origin: "live"; code?: string | number }
         | { kind: "cancel" | "interrupt" | "transport_exit" | "recovery";
             observationKey: string; reason: string }
         | { kind: "host_result"; status: "succeeded" | "failed";
             observationKey: string }; // process batch/completion only
  policy: { denied: boolean; evidenceKeys: string[] };
  output: { valid: boolean; empty: boolean; allowEmpty: boolean;
            evidenceKeys: string[] }; // validated by existing output owner, not a prompt guess
  postRun: { credentialsSafe: boolean; evidenceKeys: string[] };
}
createCanonicalRunEventLedger({
  runId, runtimeId, source, provenance, clock,
  redactionContext: { secretHints }, // exact provider/gateway hints, memory only
  durableStore, projections, artifactOwner,
})
ledger.appendSystemEvent({ observationKey, type, payload })
ledger.ingestResponse(boundary: Boundary)
ledger.ingestNotification(boundary: Boundary)
ledger.ingestServerRequest(boundary: Boundary)
ledger.recordServerResponseSend({ ...boundary, requestId, result: "sent" | "failed" })
ledger.recordServerRequestResolved({ ...boundary, requestId })
ledger.ingestClaudeMessage({ observationKey, queryId, message, resumeIntent })
ledger.ingestRuntimeObservation({ observationKey, type, payload }) // coarse adapters
ledger.ingestTransportExit({ observationKey, transportId, exitCode, signal })
ledger.repairFromSnapshot({ observationKey, snapshot, sourceProvenance,
  schemaDisposition: "recognized" | "incompatible", targetTurnId })
ledger.settle(evidence: OutcomeEvidence)
ledger.read(afterSequence) // committed RunEvent[] only
ledger.readItem({ threadId, turnId, itemId, channel, partIndex }) // state or null
ledger.readUsage() // { total, last, baseline, delta, discontinuity, sealedAtSequence }
ledger.readOutcome() // null or { status, reasons, evidenceKeys, completedSequence }
ledger.readNativeContext() // host-only raw interrupt target; never serialized
admitRunArtifactCandidate(candidate, runContext)
```

Tests use a deterministic clock, the fixture shapes in tasks §7 and either an in-memory
store or temporary SQLite store. `artifactOwner` receives temporary in-scope files and
has deterministic prepare/fail hooks; tests do not depend on real credentials/binaries.
An input without a required provenance field is rejected before publication; absent
native IDs remain absent, and native IDs alone do not confer execution authority.

```ts
durableStore.appendExact({ records, expectedHighWater, jobMutation?, artifactRefs? })
// atomic batch; all supplied sequences/fact keys unchanged; throw => definite rollback
// same complete fact-key batch => return previous committed records, not a new append
durableStore.lookupFact(observationKey)
durableStore.read(runId, afterSequence)
durableStore.readHeader(runId)
durableStore.cursor(runId, projectionName)
durableStore.ack(runId, projectionName, sequence)
projections = [{ name, deliver(record), cursor(), ack(sequence) }]
```

`cursor/ack` delegate to the same store. Delivery is at least once; each projector
replaces/upserts by `(runId, sequence)`, then acknowledges only a contiguous delivered
prefix. Crash after delivery before ack can redeliver, but cannot append duplicate
rendered/persisted output. API/CLI `--after` readers are pull projections and have no
server-owned per-consumer cursor; their cursor is the caller's last sequence.

One observation can yield a deterministic ordered batch (e.g. final item plus
reconciliation). Fact keys are `(runId, observationKey, ordinal)`; candidate sequences
are reserved serially in ingress order and become canonical only on commit. Duplicate
handoff keys return the prior batch, with no new sequence. All internal non-domain
boundaries emit at least a status record; no invisible canonical sequence is consumed.
Transport handoff IDs are not native event IDs and provide no native replay guarantee.
No payload-only hash deduplication may discard two legitimately identical text deltas.

## Durable Schema and Store Invariants

The implementing change owns schema in `src/main/lib/db/schema/index.ts`, a new migration
and generated metadata under **`drizzle/`** (current base has 0000–0023), and operations
in `headless/job-store.ts`. There is no `src/main/lib/db/migrations` directory.

| Structure | Required post-cutover data / invariant |
| --- | --- |
| agent_jobs | `ledger_version` = 0 or 1; `ledger_provenance_json` nullable only for legacy; `ledger_sealed_sequence` null while live, otherwise points to its one completed. ID/retry/source/runtime columns retain their meaning. |
| agent_job_events | Existing id/job_id/sequence/type/payload_json/created_at retained; payload_json holds bare sanitized semantic payload. Add nullable legacy-compatible `fact_key` and `record_metadata_json` (redaction, boundary/source, provenance ref); v1 inserts require both. |
| uniqueness | Existing unique(job_id,sequence); new unique(job_id,fact_key) for non-null fact keys; one v1 completed per job enforced in the transaction and a partial uniqueness constraint with predicate type=completed AND fact_key IS NOT NULL. No invalid uniqueness assertion is imposed on historical bytes. |
| agent_job_projection_cursors | PK(job_id,projection_name), acknowledged_sequence >= 0, <= committed high-water; ack monotone and only over delivered contiguous prefix; foreign key cascade on job deletion. |
| artifact registration | Store the final admitted artifact refs/manifest location in the existing job result metadata in the same commit as completed; no second artifact truth table. |
| item/usage state | Rebuild from ordered committed events and item_reconciliation/repair records; no independently authoritative item table or mutable native snapshot cache. Store readers expose exactly that reduction. |

`appendExact` checks v1 marking, expected high-water and dense sequences in one local
SQLite transaction. The ledger allocates; the store validates, never re-sequences.
Committed events are immutable. Batch failure changes neither events, outcome, artifact
refs nor cursors; retry uses the same fact keys. The event log itself is the outbox
obligation; no extra outbox queue or unknown-commit state machine is introduced.

Reuse **the atomic shape of `completeAgentJob`'s status+event transaction** as the new
exact terminal sink; remove its independent event construction and sequence allocation,
not its atomicity. After sealing, the raw `assertNonTerminal` rule is relaxed only for
`type=status, payload.subtype=late_event` with `terminalSequence` referencing the seal.
Such rows cannot update job outcome, item output, usage or artifact refs. Every other
post-terminal write is rejected. Public follow exits at terminal; later explicit reads
can see these immutable late records.

On reopen, reconstruct high-water and state from committed records. There is no
uncertain acknowledgement to serialize: a crash leaves either a committed batch or
none. Lookup/retry deduplicates retained handoff keys; if a raw input was never committed
and the process died, it is not recoverable and must not be represented as replay.
A permanently unavailable store halts ingestion/provider progress and emits a sanitized
infrastructure diagnostic on the host error channel; it cannot claim a durable completed
until storage succeeds. Recovery records use the existing dead-worker detection,
reopen a ledger only after the old process is known stopped, and settle interrupted
with `synthetic.source=recovery`; stale heartbeat alone grants no live write authority.
No new lease/fencing protocol or same-Run native restart is added. A source job
without confirmed process death is not recovered; its unresolved live authority is a
Phase 5 input, not a reason to grant this ledger a parallel writer.

## Item Reconciliation and Redaction

State key: `(threadId, turnId, itemId, channel, partIndex)`; assistant channel is
`assistant`, reasoning channels are **`text` and `summary`** separately, and tools use
`tool`/part 0. Missing IDs use an observation-local correlation key and `lossPossible`,
never an inferred native ID. `summaryPartAdded` creates a summary part boundary;
`textDelta` selects `content[partIndex]`, `summaryTextDelta` selects `summary[partIndex]`.

The observable `readItem(key)` is `{ state: started|streaming|completed, text?, fields?,
reconciliation: { result, lossPossible, missingStart, suppressedDuplicateCount } }`.
On final item completion the ledger emits `status` with `subtype=item_reconciliation`
and these same fields under `payload.item` and `payload.reconciliation`. `payload.item`
contains the redacted key, itemKind and authoritative completed text/fields, so restart
can rebuild `readItem`. Materialized output means this reader's ordered part state,
not blind concatenation of every previously emitted delta. Renderers replace/update
that item on reconciliation. Existing payload text/delta fields remain in place.

Results: `matched` for exact equality, `suffix_repaired` for a missing trailing suffix,
`missing_local` for a completed item without local data, `missing_native` for a local
item absent from a supplied authoritative snapshot, `mismatch` for other disagreement.
Final text wins for pre-seal item materialization; no final text is appended a second
time. `missingStart`, missing content or mismatch sets `lossPossible=true`; a final
snapshot does not prove all intermediate events were observed. Repeated completion
with equal content increments the durable suppressed count via a reconciliation status,
but emits no second tool_finished. A duplicate handoff key emits nothing new at all.
Unidentified equal deltas remain provisional; final reconciliation corrects duplication
without pretending the native schema supplied a dedupe ID.

One Run-scoped redactor owns stream channels and exact secret hints. Potential secret
suffixes are withheld before persistence/fan-out; terminal flush never releases an
unsafe prefix. This may defer a text contribution; the ingress observation still has a
sanitized record (possibly empty text plus `redactionPending:true`), and a later safe
release gets its own ledger record with source observation refs. Hints/raw buffered
suffixes are memory only. A crash can lose a withheld suffix; repair marks that loss.
Unknown payloads retain only allowlisted diagnostic shape, never arbitrary raw unions.

## Error, Completion and Late-Event Policy

`error.payload` preserves `classification=diagnostic|retryable|fatal_candidate|policy_denial`,
`willRetry` when supplied, native code and sanitized identity. It is never itself a
RunTerminalEvent. Outcome is a single `completed.payload` with existing `status`,
`reasons` (optional strings, not a public enum) and redacted evidence references.

The ledger holds live terminal evidence pending existing output validation, credential
post-check and artifact preparation. Receipt of the first terminal boundary seals the
materialization input prefix; queued later native input becomes late diagnostics even
while terminal files are being prepared. `settle` resolves that evidence in this order:
explicit cancel → canceled; explicit interrupt/transport exit/dead-worker recovery →
interrupted; denial/output-invalid/invalid-empty/credential-postcheck failure or live
native failure → failed; live native success (or valid process/completion host result)
plus valid allowed output and post-check → succeeded. Missing/unknown success evidence
is failed. Snapshot-derived status is never a live terminal trigger.

Every transport exit supplies a synthetic interrupted
candidate with exitCode/signal/transportId and immutable provenance; it has no replacement
exception. If the Run has already sealed on a prior native terminal, the exit candidate is
recorded as a late diagnostic after that terminal commit; it does not override the
sealed trigger. Otherwise exit seals and settles interrupted. Repeated exits and
competing terminal candidates become late diagnostics. None mints a second completed. Post-run credential failure may prevent success;
it does not create a second terminal after native completion.

Late carrier: `status` / `payload.subtype=late_event`, `payload.terminalSequence`,
`payload.originalType`, optional `payload.nativeMethod`, `payload.observation` (sanitized),
`payload.diagnosticOnly=true`. A trailing `thread/tokenUsage/updated` preserves its
observed total/last in that diagnostic but does not revise `readUsage` or result usage.
No drain timer guarantees final native billing completeness; result usage is explicitly
`asOfSequence` at the sealed prefix. This is a proposed deterministic policy; whether
native usage arrives late is unmeasured in trace §6.2.

## Usage Semantics

`usage_update.payload` adds `kind:"snapshot"`, `total`, `last`, `baseline`, `delta`,
`dedupeKey`, `asOfSequence`, `discontinuity` without removing existing semantic members.
Vectors preserve available input/output/total/cache/reasoning values, not invented zeroes.
Codex cumulative total is authoritative and last is the native last vector. Snapshot
repair establishes baseline (e.g. 100), then total 108 gives `delta.totalTokens=8`;
a synthetic decrease to 3 resets baseline, sets discontinuity, and emits no negative delta.
Per-call Claude/completion usage accumulates unique call vectors into total, with last
that call's vector; dedupe uses native message/call ID plus vector revision, otherwise
retained observationKey. Distinct calls with identical vectors both count.
`normalizeRuntimeUsage` / `isInclusiveCachedInputRuntime` in shared/usage-metadata.ts
remain the only inclusive/exclusive cache arithmetic. Ledger owns totals/baseline and
native context; Codex decoder is stateless. Adapter reads the ledger's host-only
threadId/turnId interrupt target; a missing target fails without session-ID substitution.

## Artifacts and Terminal Commit Order

`run-artifacts.ts` receives candidates, checks existence, stable regular-file read,
allowed root, Run ownership, digest, media/size and redaction, and returns admitted refs.
Rejected candidates produce `status/artifact_admission` with `result:"rejected"` and
`reason=missing|out_of_scope|ownership_mismatch|digest_mismatch|redaction_unsafe`;
no unredacted path/content is in the diagnostic. Only this owner can ask the ledger
for `artifact_created`. Runtime candidates admitted while live have event sequence
strictly before completed. No new public filesystem scope is granted.

Terminal artifact registration is allowed **before completed or in its same durable
commit**, never as a prerequisite that requires completed already publicly visible:

1. Freeze the outcome/input prefix and reserve the completed record's exact sequence,
   timestamp and payload, plus pending runtime-candidate artifact events before it.
2. Prepare Locus `events.jsonl` using that frozen public event prefix including the
   candidate completed; prepare `result.json` from that same prospective terminal and
   write `artifacts.json` using verified refs. Use staging/atomic file replacement and
   existing admitted run-dir safety checks; no provider payload is written raw.
3. Existing dependency graph is kept finite: result.json references request/events;
   artifacts.json references request/events/result but not its own digest; the returned
   DB/result envelope can additionally reference the manifest with its digest. Final
   events/result/manifest files do **not** emit artifact_created events, so there is no
   events-file self-hash loop. Existing initial artifact_created semantics remain.
4. Commit the terminal job mutation, exact completed and all admitted manifest refs in
   one SQLite transaction, then publish. Final file preparation failure blocks success;
   record failed outcome with the artifact diagnostic and no unverified refs (a failure
   result need not claim files that could not be written). Do not expose a prospective
   terminal or its refs through result/events readers before this commit.
5. Crash before commit leaves only unreferenced staged/prepared files; retry validates
   or cleans those within the admitted run directory, with no deletion outside it.
   Crash after commit reuses registered digests. Once committed the terminal snapshot
   files are immutable; late diagnostics are available from explicit event reads, not
   silently added to the frozen events.jsonl and rehashed.

Initial request/events/manifest roles and final request/events/result/manifest paths
remain available. The implementing tests must characterize initial provisional files
and avoid claiming their earlier digest is a terminal snapshot digest. Only newly
admitted native roles are additive; existing v1 artifacts were already verified.

## Resume Validation and Snapshot Repair

Codex pending-request context records JSON-RPC id, method, intent, requestedThreadId and
independent expectedSessionId. A matched success response must contain equal thread.id,
non-empty independently matching sessionId, and recorded ephemeral/path/cliVersion with
installation/schema evidence. Its event subtype is `native_resume_validated`; missing,
mismatched or RPC-error response is `native_resume_rejected` with reason and original
code (-32600/-32603 included), never `expired`. An unrelated response yields
`protocol_response` with `correlated:false`, not validation. Native-load validation
alone neither proves rollout materialization for a fresh start nor grants live attach.

`thread/status/changed` before response is only thread_lifecycle. Resume never fabricates
`thread/started`; thread/start response and thread/started are distinct facts when
actually observed. `ephemeral`, redacted path and creator version are evidence, not a
new durable Binding/CAS implementation. Resume acceptance is separate from later auth failure.

Claude equivalent: a system/init from the correlated queryId with ordinary resume
session_id equal to source (or fork: valid new UUID different from source) produces
native_resume_validated; result success/is_error, arbitrary session_id or exit alone
cannot validate. Init establishes slice acceptance where resumeSessionAt was supplied.
Mismatched init/pre-init rejection is native_resume_rejected; future one-shot consumption
must use this fact, but chat-history.ts CAS behavior is not changed here.

`repairFromSnapshot` records `status/repair` with `repair:{source:"snapshot", result}`,
`lossPossible:true`, source/target provenance and item reconciliation. Pre-seal snapshots
can repair item views, never create Run success, live write authority or replay cursor.
Post-seal repair becomes status/late_event with the same repair metadata, diagnostic
only. Durable failed/error outcome always wins over CODEX-08's completed/error-null
snapshot. An unsettled Run with only that snapshot remains unsettled; transport exit
then settles interrupted, never succeeded. Cross-version known snapshots may reconcile;
incompatible schema is a synthetic mismatch case, not a measured CODEX-07 failure.

## Native Method and Item Disposition

The following closed measured universe is trace §5.2–5.4 (not dynamic certification).
Each listed method occurs exactly once below. The fixture-only normalized decode shape
is `{kind, native:{threadId?,sessionId?,turnId?,itemId?}, channel?,partIndex?,
text?, fields?, total?,last?,code?,willRetry?}`; native ThreadItem content is
normalized to the item table without claiming that this DTO is the native wire schema. `item/started` and `item/completed`
dispatch through the item table. Realtime/remote/Windows are observed/deferred, not
unknown and not supported; raw/audio content is omitted with `contentOmitted:true`.
Known supported rows do not acquire a false unknown/loss marker merely due to category.

| Notification methods (66 total) | Canonical disposition |
| --- | --- |
| account/login/completed, mcpServer/oauthLogin/completed | status/oauth_lifecycle |
| account/rateLimits/updated, account/updated | status/account_lifecycle |
| app/list/updated, externalAgentConfig/import/completed, skills/changed | status/configuration |
| command/exec/outputDelta, process/outputDelta, process/exited | status/runtime_process (process/exited notification is not transport exit) |
| configWarning, deprecationNotice, guardianWarning, warning | status/warning |
| error | error with classification/code/willRetry |
| fs/changed, fuzzyFileSearch/sessionCompleted, fuzzyFileSearch/sessionUpdated | status/workspace_observation |
| hook/completed, hook/started | status/hook_lifecycle |
| item/agentMessage/delta | assistant_delta |
| item/autoApprovalReview/completed, item/autoApprovalReview/started | status/approval_review |
| item/commandExecution/outputDelta, item/commandExecution/terminalInteraction, item/fileChange/outputDelta, item/fileChange/patchUpdated, item/mcpToolCall/progress | tool_delta (terminalInteraction is tool evidence, not a second Interaction FSM) |
| item/completed, item/started | item table below, including reconciliation on completed |
| item/plan/delta, turn/plan/updated | status/plan |
| item/reasoning/summaryPartAdded | status/reasoning_part |
| item/reasoning/summaryTextDelta, item/reasoning/textDelta | reasoning_delta with distinct channel/partIndex |
| mcpServer/startupStatus/updated | status/mcp_lifecycle |
| model/rerouted | status/reroute |
| model/verification, turn/moderationMetadata | status/model_verification |
| rawResponseItem/completed | status/raw_response_observed (allowlisted metadata only, contentOmitted:true) |
| remoteControl/status/changed, windows/worldWritableWarning, windowsSandbox/setupCompleted | status/unsupported_native_surface with surface=remote_control or windows and disposition=observed_deferred |
| serverRequest/resolved | status/interaction_boundary, boundary=resolved |
| thread/archived, thread/closed, thread/goal/cleared, thread/goal/updated, thread/name/updated, thread/settings/updated, thread/started, thread/status/changed, thread/unarchived | status/thread_lifecycle |
| thread/compacted | status/compaction |
| thread/realtime/closed, thread/realtime/error, thread/realtime/itemAdded, thread/realtime/outputAudio/delta, thread/realtime/sdp, thread/realtime/started, thread/realtime/transcript/delta, thread/realtime/transcript/done | status/unsupported_native_surface, surface=realtime, disposition=observed_deferred |
| thread/tokenUsage/updated | usage_update (after seal: late_event with observed usage) |
| turn/completed | terminal candidate, settled by core outcome rule |
| turn/diff/updated | status/diff_observation plus candidate evidence to artifact owner; no direct artifact event |
| turn/started | status/turn_lifecycle |

| Server request methods (10 total) | Disposition |
| --- | --- |
| account/chatgptAuthTokens/refresh, applyPatchApproval, attestation/generate, execCommandApproval, item/commandExecution/requestApproval, item/fileChange/requestApproval, item/permissions/requestApproval, item/tool/call, item/tool/requestUserInput, mcpServer/elicitation/request | status/interaction_boundary, boundary=request, native method + requestId; exact existing safety owner still handles authorization; no credential material persists |

For each request, response-send records boundary=response_send and sent/failed;
serverRequest/resolved records boundary=resolved. A response-send failure does not
claim success or resolution. Transport passes the resolved notification only once to
recordServerRequestResolved; it must not also ingest a duplicate generic notification.
Other client responses emit status/protocol_response with request correlation and
sanitized result/error metadata; thread/resume uses the resume subtypes above.

| ThreadItem variants (16 total) | started / completed disposition |
| --- | --- |
| agentMessage | status/item_lifecycle then status/item_reconciliation; assistant deltas and authoritative readItem text |
| reasoning | status/item_lifecycle then status/item_reconciliation; separate content/text and summary parts |
| commandExecution, mcpToolCall, dynamicToolCall, collabAgentToolCall, webSearch, imageView, imageGeneration, fileChange | tool_started / tool_finished plus item_reconciliation; imageGeneration.savedPath and fileChange/diff only feed artifact candidates |
| contextCompaction | status/compaction |
| enteredReviewMode, exitedReviewMode | status/review_mode |
| hookPrompt | status/hook_lifecycle |
| plan | status/plan |
| userMessage | status/user_message (including snapshot user items), no assistant output |

The nine existing internal types outside the 12 public v1 types project to `status`
with `payload.subtype` equal to the **original internal type name**: guard_decision,
permission_requested, scope_expansion_requested, question_pending, question_result,
mcp_needs_auth, command_started, command_output, command_finished. Preserve their old
payload members; do not double-wrap. Generic Locus status defaults to `system_lifecycle`.
Remaining ledger-origin subtypes are item_reconciliation, native_resume_validated,
native_resume_rejected, protocol_response, artifact_admission, repair, late_event,
redacted_observation and unknown_native_method. These plus table subtypes are the stable
subtype vocabulary. A future method outside the table emits unknown_native_method with
lossPossible=true and its sanitized method; a known method with malformed fields emits
warning with reason=invalid_native_shape and lossPossible=true instead of disappearing.

## Current Owner to Target Mapping

All paths below are under `src/main/lib/` unless prefixed otherwise. Every removal is
in the same implementing change; no residual second mapper or terminal owner is allowed.

| Current owner / symbols | Target / same-change disposition |
| --- | --- |
| agent-runtime/runtime-events.ts | Keep createRunEvent as pure constructor; RunTerminalEvent becomes completed-only; add internal metadata types, no sequence allocation. |
| agent-runtime/redaction.ts; shared/usage-metadata.ts | Keep single redaction algorithms and usage normalization respectively; per-Run state composed by ledger. |
| agent-runtime/stream-event-mapper.ts | Delete old exports mapDesktopStreamChunkToRunEvents, createDesktopStreamEventMapper, appendRunEventsToAgentJob, redactRendererDiagnosticChunk, redactRendererRuntimeChunk, createRuntimeRendererChunkEmitter, createRuntimeStreamChunkSecretRedactor, isDesktopRuntimeFailureChunk, persistedPayloadForRunEvent and their allocators/default-success logic. Repurpose module solely as projectRunEventToRendererChunks (pure forward projection of committed records); move coarse input decode to ledger-ingress.ts, no chunk round trip. |
| agent-runtime/job-event-bridge.ts / createAgentJobRunEvent | Delete module and old call sites; shared JSON-safe conversion, if needed, folds into runtime-events.ts; job-store no longer calls a redactor/bridge. |
| NEW agent-runtime/run-event-ledger-host.ts | Compose one ledger with job-store adapter, artifact owner, renderer/history projections; single host entry getOrCreateRunEventLedger(existingJob) for existing lifecycle callers; no ID minting or lease registry. |
| NEW agent-runtime/run-event-ledger.ts; run-artifacts.ts; ledger-ingress.ts | Ledger owns sequence/item/usage/terminal; artifacts owns validation/preparation; ingress stateless decode only. |
| codex/app-server-stream-events.ts | Stateless decodeCodexNativeBoundary and measured disposition table; no [] default, no thread/session/turn/tokenUsage state, no buildInterruptRequest state. |
| codex/app-server-adapter.ts | Submit response/notification/request/send/resolved/exit; remove sequence/lastError/pendingTerminalChunk terminal owner, fabricated thread/started on resume and sessionId<-threadId fallback; retain transport request correlation and existing safety cleanup; read interrupt target from ledger. |
| codex/app-server-adapter-runner.ts; agent-runtime/desktop-runner.ts | Inject host-composed ledger; replace emitDesktopRuntimeAdapterStarted's sequence=0 direct createRunEvent with appendSystemEvent; deliver committed records, no reconstructed terminal. |
| trpc/routers/codex.ts; codex/desktop-run-persistence.ts | Delete appServerPersistenceChunks/raw text-delta joins; use committed item projection for history; route remains envelope only. |
| codex/desktop-run-finalize.ts; desktop-agent-jobs.ts | CompleteDesktop*Safely paths submit terminal evidence to ledger instead of calling independent completeAgentJob; replace desktop status append with ledger ingress. |
| claude/agent-sdk-desktop-job.ts; agent-sdk-desktop-run-startup.ts; agent-sdk-desktop-run-state.ts; agent-sdk-desktop-run-envelope.ts | Replace mapper/emitter/appendRunEvents wiring with same host ledger and committed renderer projection; cleanup/finalization submit evidence; SDK message ingress records correlated init. |
| claude/agent-sdk-query-options.ts; claude/chat-history.ts | Read-only resume-intent source for ledger facts; do not change one-shot flag/CAS, binding policy or create a handle store. |
| headless/adapters/codex-app-server.ts | Remove completed suppression/envelope stripping as an internal ingestion path; consume existing committed record, do not append it again; public v1 serializer still emits bare payload. |
| headless/agent-runtime.ts; headless/agent-runtime-contract.ts; agent-runtime/run-contract.ts; headless/adapters/claude-code.ts, codex.ts; headless/process-runner.ts | AgentRuntimePersistedObserver.appendEvent becomes thin ledger-ingress submission with observation key for coarse outputs; no native decoder duplication or runtime selection change. |
| headless/job-runner.ts createObserver/appendDirect/appendResolvedProviderEvent; both completeAgentJob calls | Remove independent secret-buffer/redaction chain and raw append, use ledger ingress; both success/catch finalize paths submit outcome evidence. |
| headless/job-store.ts insertAgentJobEventRecord/nextEventSequence/appendAgentJobEvent/completeAgentJob | Replace exported raw writer with appendExactRunEventBatch and read/cursor functions; exact record insert remains private. Delete store-created event/sequence/redaction; reuse terminal transaction shape. |
| headless/job-store.ts createAgentJob/startAgentJob/retryAgentJob system appends | Lifecycle service supplies job_created/job_started through host ledger as part of creation/start transactions; store mutates supplied job fields only. Existing ID/retry allocation rule unchanged. |
| headless/job-recovery.ts; job-store.ts interruptStaleAgentJobs | Remove error-only interrupted mint; confirmed dead-worker recovery uses ledger synthetic interrupted completed once; no attach/live owner transfer. |
| headless/cli-dispatcher.ts cancelApiJob and jobs cancel pre-start branches | Get ledger for queued existing job and settle canceled; no raw completeAgentJob outside ledger. |
| trpc/routers/agent-jobs.ts queued cancel | Replace its direct completeAgentJob call with host cancel evidence; preserve existing request/cancel routing and internal exit metadata. |
| headless/completion-runner.ts usage append + success/catch completeAgentJob | Include kind=completion in ledger, use locus-completion provenance and host_result; retain provider/output owner. |
| headless/daemon.ts; local-job-api.ts job creation/retry services | Wire existing lifecycle calls through host composition for job_created/start/cancel/recovery; no constructor/identity convergence or queue redesign. |
| headless/schedules.ts createScheduledJob direct db.insert(agentJobEvents), sequence=1 | Replace raw event insert with the host-composed ledger job_created transaction; existing schedule jobId minting and queue transaction stay unchanged. |
| headless/cli-dispatcher.ts initial artifact_created/final write; headless/local-job-api.ts writeLocalJobApiInitialArtifacts/writeLocalJobApiFinalArtifacts/fileArtifact | Move admission/preparation to run-artifacts.ts; serializer/read helpers remain public projection; dispatcher calls owner, never emits artifacts or invents final truth. |
| src/shared/agent-jobs.ts; src/shared/local-job-api.ts | Internal 21 types and public 12 types unchanged; add feature identifier and optional metadata; no runEventSequence symbol here today. |
| renderer workbench-trace-presenter.ts; runtime-event-state.ts; chat transports | Migrate wrapper reader to committed envelope/item projection, preserve existing stream/cancel IDs and UI-state owner; no event/terminal reconstruction. |
| src/main/lib/db/schema/index.ts; drizzle/ | Own explicit schema/cutover metadata described above. |
| scripts/check-architecture-guards.mjs; docs/OWNERSHIP_MAP.md | Pin new owners; remove legacy symbol pins and all five raw-writer allowlist entries; end state: only run-event-ledger-host.ts imports appendExactRunEventBatch. |

Terminal inventory includes native turn/completed, adapter cleanup/catch/default finish,
stream mapper finish/error inference, desktop safe finalizers, headless job-runner both
branches, completion-runner both branches, pre-start cancel both CLI surfaces and agent-jobs tRPC, dead-worker
recovery, and store completeAgentJob's insert. All become evidence → one ledger settlement;
no remaining caller constructs completed or assigns event sequence independently.

## Migration Plan

`canonicalRunEventLedgerV1` is a temporary **build-time constant**, initially false in
run-event-ledger-host.ts; it is the only reader/selector and has no renderer/env/request
control. During implementation, false selects the unchanged legacy path for new test
Runs; true selects the ledger for the whole Run. No shadow/dual write and no mid-Run
switch. It carries a deprecation comment naming this change and removal before acceptance.

Activation requires all of: (1) recorded Owner APPROVED/R1 disposition; (2) red-first
fixture/scenario inventory frozen; (3) schema migration applied; (4) no active legacy
jobs (drain/cancel them using the old build, do not continue them with the ledger);
(5) all inventory callers converted as one reviewed cutover; (6) target tests for store,
terminal/artifact, projections and public contract pass with the true build in isolated
test profiles. These are explicit build/review conditions, not a markdown-checking
runtime behavior scenario.

The migration labels **all** existing jobs ledger_version=0 and preserves their events
unchanged. Readers expose `historyQuality=legacy_unverified` as optional read metadata
(public job envelope: optional job.ledger.historyQuality), with no fabricated fact
keys, binary provenance, reconciliations or completed. New jobs are version 1 with
required metadata; no new writer admits events to version 0. Workbench has one decoder
that reads versioned persisted records, not an old executable business path. Historical
v1 API payloads were bare already and keep that shape, including non-object payloads;
no wrapper is added merely to attach metadata. New optional payload members apply to
object payloads only, and record metadata remains separate. There is no hidden replay,
normalization of old IDs, row purge or consumer artifact reset. A drained legacy job can
be retried through the existing new-job operation and gets a v1 ledger.

Intermediate guard mode is a CLI test/build option `--run-event-ledger-phase=transition`
that permits exactly the declared temporary gate and legacy symbol set while checking
imports/owner pins; runtime tests enforce per-Run exclusivity. Final/default guard mode
`canonical` requires absence of that constant and all old exports/call sites. Before
acceptance delete false branch, gate and transition mode/allowlist; only canonical mode
remains. The living architecture spec describes that final static state.

Rollback before public release uses a separate disposable profile with the old build;
never let old code append to v1 rows. A published R1 rollback that removes the feature
must be explicit to consumers; no silently weaker protocol. Scope does not authorize
deleting repository/worktree, consumer DB or external artifacts.

## Risks / Trade-offs

Dense status stubs increase event count but preserve cursor density without leaking raw
payload. No native event-id means some live duplicate deltas are only corrected at final
snapshot. Immediate seal makes trailing usage diagnostic-only, so sealed usage may be
incomplete. Atomic terminal artifact visibility requires staged file preparation and
crash tests; SQL cannot roll back filesystem writes, hence unreferenced prepared files
must remain unpublished. Legacy reads honestly lack new guarantees. Minimal provenance
must not claim Runtime delivery certification. All remain proposed, pending Owner choices.

## Open Questions

1. Owner 是否对 R1（C7 rows 4/5 的终态真相及 exit code）选择 DIRECT_NEW_STANDARD，或选择 DEFER／REJECT？
2. Owner 是否接受本草案的确定规则：默认空产出失败、显式允许空产出的既有内部请求例外，以及 completed 后 usage 仅作为可读诊断？
3. Owner 是否接受最小 immutable provenance snapshot 与 schema v1／legacy-unverified 历史标记在本切片内实现，而不等待 Runtime delivery registry？
4. Owner 是否接受保持 v1 稠密 sequence 的逐记录 status 投影，以及终态 artifact 与 completed 同一 durable commit 登记的方案？
