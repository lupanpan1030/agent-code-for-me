## Context

This is a documentation-only Phase 3 design. It does not authorize implementation.
The current Codex app-server path has three competing notions of a Run history:
native-to-desktop mapping, desktop-to-`RunEvent` mapping, and durable job-event
projection. Headless execution removes the canonical envelope and terminal before the
job layer reconstructs both. Those paths cannot prove loss, identity continuity,
artifact ownership, or exactly-one completion.

The target is a single append-only, loss-aware Run ledger in the main process. It is
the fact source from which renderer, chat, Workbench, headless, CLI, Local Job API, and
result projections derive. Runtime-specific mappers decode native protocol; they do
not own ordering, persistence, completion, or a second fact chain.

## Source Basis and Constraints

| Source | Constraint carried into this design |
| --- | --- |
| [Native/resume event gap trace](../../../docs/native-resume-event-gap-trace-2026-09-04.zh-CN.md) §§0, 6, 6.1, 6.2, 7, 8 | 11/66 Codex notifications are mapped; default empty projections, completed-snapshot loss, retry-metadata loss, dual sequence/terminal paths, and resume-not-replay are current facts. The unmeasured dynamic frequency/order cases in §6.2 remain unclaimed. |
| [Interoperability contract](../../../docs/ideas/locus-interoperability-contract-v1.zh-CN.md) §4 (C2) | A Run is one canonical attempt and a Job is a durable/public projection; adapters must not create competing Run truth. |
| Same contract §7 (C5) | Durable Interaction state and its resolution ledger are a separate contract. This change records only request/response boundaries and does not implement that state machine. |
| Same contract §9 (C7) | Public evolution requires explicit ten-class Consumer Impact analysis. Publicly observable lifecycle, ordering, trust, and artifact changes are Red until Owner disposition. |
| [Product direction and harness strategy](../../../docs/ideas/locus-product-direction-harness-strategy.zh-CN.md) §9 Phase 3 and §12 batch 3 | The canonical ledger precedes async submit and must state its owner, deletion points, migration gate, and verification consumers. |
| [AI collaboration workflow](../../../docs/ideas/locus-ai-collaboration-workflow.zh-CN.md) | OpenSpec and tests are evidence gates; Owner acceptance is distinct from implementation/review, and push is not implied. |
| [Ownership map](../../../docs/OWNERSHIP_MAP.md) | Runtime event envelope and redaction remain under `src/main/lib/agent-runtime/`; transport, routes, and provider adapters stay thin. |
| [`agent-runtime-core`](../../specs/agent-runtime-core/spec.md) | Ordered sanitized `RunEvent` is the internal contract. Its event enumeration must include the existing `artifact_created` type. |
| [`local-job-api`](../../specs/local-job-api/spec.md) | v1 retains its 12 event types, event envelope, `--after` cursor, result envelope, and run-owned manifest. |
| [`desktop-agent-jobs`](../../specs/desktop-agent-jobs/spec.md), [`headless-agent-jobs`](../../specs/headless-agent-jobs/spec.md), and [`codex-runtime-parity`](../../specs/codex-runtime-parity/spec.md) | Desktop and headless projections converge on the same semantic facts without raw-provider reconstruction, while Codex safety/capability claims remain honest. |
| [`provider-runtime-bindings`](../../specs/provider-runtime-bindings/spec.md) | The existing exact-secret invariant already requires stateful withholding across adjacent stream chunks and a safe terminal flush; the ledger refactor must preserve it. |
| [`architecture-ownership`](../../specs/architecture-ownership/spec.md) | The existing exact-symbol single-path guard must be updated in the same change so it enforces the new owner instead of preserving deleted helpers. |
| Current code: [`app-server-stream-events.ts`](../../../src/main/lib/codex/app-server-stream-events.ts), [`stream-event-mapper.ts`](../../../src/main/lib/agent-runtime/stream-event-mapper.ts), [`runtime-events.ts`](../../../src/main/lib/agent-runtime/runtime-events.ts), and [`redaction.ts`](../../../src/main/lib/agent-runtime/redaction.ts) | The native mapper silently returns no event for unknown/default input; the stream mapper allocates sequence and infers terminal truth; the envelope lacks native/provenance identity; redaction algorithms can remain canonical but must run once before fan-out. |
| Current code: [`agent-jobs.ts`](../../../src/shared/agent-jobs.ts), [`local-job-api.ts`](../../../src/shared/local-job-api.ts), and [`codex-app-server.ts`](../../../src/main/lib/headless/adapters/codex-app-server.ts) | Internal durable vocabulary already has `artifact_created`; public v1 has exactly 12 types; headless currently drops `completed` and the `RunEvent` envelope and must stop doing so. |
| [Consumer Impact template](../../../docs/consumer-impact-template.zh-CN.md) | Known consumers, schema/behavior impact, rollout, rollback, and unknowns must be named; “internal refactor” is not a compatibility conclusion. |

## Goals

- Establish one owner and one canonical sequence for all Run facts.
- Make loss, repair, native identity, runtime provenance, reconciliation, artifact
  admission, and terminal truth testable at an implementation-neutral seam.
- Atomically remove the existing empty/default projections and competing fact chains.
- Keep Local Job API v1 vocabulary stable while exposing only optional, namespaced,
  redacted payload additions.
- Let an independent author write failing Bun acceptance tests directly from every
  specification scenario before reading the implementation.

## Non-goals

- Complete Interaction state or resolution-ledger behavior; that belongs to
  `add-durable-agent-interactions`.
- Lease/epoch/live-attach fencing or Claude one-shot handle compare-and-set; those
  belong to the Phase 5 continuation slice.
- Async submit, `locus.local-job.v1.1` request gating, or idempotency keys; those
  belong to `add-local-job-api-async-submit`.
- A claim that all 66 Codex notification methods have known dynamic frequency or
  total-order behavior. Trace §6.2 remains a follow-up evidence source.
- A new public event type, a second artifact event, a database/event replay claim, or
  an upgrade of any Codex capability state merely because an event is observable.

## Test-facing Contract

The implementation SHALL expose this internal, exported test seam (names are part of
this proposal unless the Owner changes them before approval):

```ts
createCanonicalRunEventLedger({
  runId,
  jobId,
  retryProvenance,
  runtimeInstallation,
  protocolIdentity,
  clock,
  durableStore,
  projections,
})

ledger.appendSystemEvent(event)
ledger.ingestResponse(responseBoundary)
ledger.ingestNotification(notificationBoundary)
ledger.ingestServerRequest(requestBoundary)
ledger.recordServerResponseSend(sendBoundary)
ledger.recordServerRequestResolved(resolvedBoundary)
ledger.beginTransportReplacement({ attemptId, deadline })
ledger.bindReplacementTransport({ attemptId, runtimeInstallation, protocolIdentity })
ledger.ingestTransportExit(exitBoundary)
ledger.repairFromSnapshot(snapshotBoundary)
ledger.settle(outcomeEvidence)
ledger.read(afterSequence)

admitRunArtifactCandidate(candidate, runContext)
```

`durableStore` exposes atomic `appendExact`/`read` operations; tests use an in-memory
implementation with commit-failure and unknown-commit fault injection. `projections`
are retryable consumers of committed records, never primary sinks. Ledger ingestion
returns an acknowledgement only after durable commit, and `read` returns those same
ordered records. At construction the ledger derives and validates its high-water
sequence from `durableStore`; a caller cannot inject `initialSequence` as a competing
authority. Tests seed the store, inject a deterministic clock and exact provenance, and
then use the same recovery path as production. All scenario fixtures name one of these
entries, the persisted job-event reader, or the existing Local Job API reader; no
scenario requires access to private implementation.

## Decisions

Every decision in this section is a **统筹预设，Owner 可改**. Objections are recorded
under Open Questions instead of silently changing a preset.

### L1 — Single ingestion and ordering owner

`src/main/lib/agent-runtime/run-event-ledger.ts` owns one ledger instance per Run. The
transport passes it every JSON-RPC response, notification, and server request, plus
response-send, request-resolved, snapshot, process-restart, and transport-exit
boundaries. The owner assigns `sequence` at ingestion before redaction-safe fan-out.

`job_created` and `job_started` enter through `appendSystemEvent`, so the durable job
stream, internal `RunEvent`, and Local Job API envelope use the same sequence value and
high-water mark. Gaps are allowed only when a fact is intentionally retained in a more
restricted internal trace; ordering is strictly increasing and `sequence` is the only
downstream cursor. The existing optional public payload member `runEventSequence` is
preserved as a deprecated compatibility alias whose value equals envelope `sequence`;
it is not accepted or documented as a second cursor, and deleting it requires a later
C7 change.

The transport and Codex decoder may parse and classify, but neither allocates sequence,
mints completion, persists independently, or owns a parallel list of “truth” chunks.

Durable commit is the visibility and ingestion-acknowledgement barrier. The per-Run
ledger serializes one pending fact at a time, derives a stable internal fact key, and
submits the record plus exact candidate sequence to job-store in one transaction. The
sequence becomes canonical only when `appendExact` commits; before that it is tentative
and no renderer, trace subscriber, result builder, CLI/API reader, or other projection
may observe it. A failed or unknown commit blocks later facts. The ledger queries by
fact key and retries the same fact/sequence until it can prove committed or absent; it
never assigns that pending sequence to a different accepted fact.

Commit also creates the durable projection/outbox obligation. If the process crashes
after commit but before live fan-out, restart reads the committed high-water record and
resumes each projection from its last acknowledged canonical sequence. A projection
failure cannot roll back, renumber, or duplicate the durable fact and cannot cause
provider work to observe a false ingestion acknowledgement. An unrecoverable durable
store failure stops further Run ingestion/provider progress and reports a sanitized
infrastructure failure out of band; it does not invent a terminal that was not durably
committed.

### L2 — Canonical and native identity remain separate

The envelope keeps its existing canonical `{runId, jobId?, runtimeId, sequence, type,
createdAt, payload?, redaction}` fields; this change does not rename `createdAt` or add a
required envelope field. There is exactly one Locus attempt identity: `runId`. When the
legacy/internal `jobId` field or Local Job API v1 `jobId` is present, its value must equal
that same `runId` as a compatibility alias. A renderer-generated ephemeral run ID and a
durable job ID may not remain independently variable; mismatch fails ledger admission
before provider work or event publication.

A retry creates a new ledger with a new `runId`, leaving the terminal source ledger
immutable and recording `{retryOfRunId, rootRunId, attempt}` provenance. The Local Job
v1 projection maps that same relationship to its existing `retryOfJobId`/attempt fields;
it does not append a new attempt to the prior ledger or create another Job lifecycle.

Optional redacted native identity is stored under a versioned namespace, initially
`payload.runtime.codex.v1`, with separately typed `threadId`, `sessionId`, `turnId`,
`itemId`, `requestId`, and `callId` when the protocol supplies them. It also records
the native method and item/part identity needed for correlation.

That pointer names the internal `RunEvent.payload`. Local Job API v1 preserves its
existing persisted-RunEvent wrapper, so the same optional semantic namespace appears at
JSON pointer `/payload/payload/runtime/codex/v1`; this change does not flatten or replace
the wrapper.

No fallback assigns a thread ID to `sessionId` or a session ID to `threadId`. Missing
native identity remains absent and produces a correlation/loss diagnostic when needed;
it is never fabricated from another identity domain. Redaction occurs before any sink
sees the namespace.

“Redaction once” means one canonical stateful redaction path, not stateless per-event
replacement. The ledger owns per-Run, per-item/output-channel state backed by the
stream algorithms in `redaction.ts`: it withholds a suffix that may prefix an exact
secret across adjacent deltas, releases it only when safe, and performs a sanitized
flush at item/Run terminal boundaries. Assistant, reasoning, tool output, completed
snapshots, diagnostics, repair, and synthetic facts all pass through that state before
fan-out. A secret split across two events must appear in no individual event,
reconstructed message, trace, result, or public envelope.

### L3 — Item state machine and completed-snapshot reconciliation

The ledger keys an item by installation plus available thread, turn, item, and part
identity. Its logical lifecycle is `started -> delta* -> completed`. It tolerates:

- missing `started` by creating an inferred state with a loss marker;
- duplicate transitions by retaining a dedupe/reconciliation observation rather than
  appending duplicate user-visible text;
- out-of-order transitions by buffering until the bounded reconciliation barrier or
  recording the unresolved order/loss explicitly; and
- missing deltas by comparing the assembled value with the completed snapshot.

The completed item snapshot is authoritative for final materialization. Delta events
remain the streaming record, but the final snapshot is not emitted as a second text
delta. Exact agreement yields `matched`; a provable missing suffix may be repaired once
with `suffix_repaired`; all other divergence yields `mismatch` and `lossPossible=true`
without guessing. Assistant and reasoning states are independent, reasoning part
boundaries remain visible, and tool completion becomes one correlated `tool_finished`.

### L4 — Error and terminal invariants

`error` is evidence, not a terminal event. It retains sanitized native code,
`willRetry`, native identity, provenance, and a stable classification:
`diagnostic`, `retryable`, `fatal_candidate`, or `policy_denial`. A retryable error does
not settle the Run.

Every admitted Run emits exactly one terminal `completed`. The ledger alone mints it
after its settlement barrier, with final status `succeeded`, `failed`, `canceled`, or
`interrupted`. Native completion, cancellation, policy outcome, output-contract result,
artifact settlement, and fatal diagnostics are evidence for that decision.

A **definitive transport exit** is an unplanned exit, or expiry/failure of a replacement
attempt that the same in-process Run owner registered before the old transport exited.
It produces a synthetic `completed` carrying exit code/signal and
`synthetic.source=transport_exit` provenance. A bounded in-process replacement is not
definitive only when `beginTransportReplacement({attemptId, deadline})` was recorded
before the exit and `bindReplacementTransport` attaches the same ledger, Run,
RuntimeInstallation identity, and compatible protocol before that deadline. Its exit is
a `runtime_process` status fact; it may then use snapshot repair before settlement. An
unplanned exit, identity/schema mismatch, missed deadline, or failed bind closes the
barrier and synthesizes the terminal. This narrow continuation is owned by the existing
Run and is not a live-attach lease, epoch/fencing protocol, or permission for another
process to claim write ownership.

Completion truth is fail-closed: policy denial, model refusal/rejection, or required
output that is absent/invalid cannot become bare `succeeded`. The exact public mapping
and valid-empty exception are an Owner decision because they are C7 Red.

Preset late-event policy: the ledger drains events already accepted before its
settlement barrier, emits `completed` once, then accepts only sanitized diagnostic
observations with subtype `late_event`; those observations cannot change status,
usage/result materialization, artifacts, or item text and cannot produce another
terminal. Public `--follow` exits at `completed`; whether later explicit reads may expose
the diagnostic is an open Owner decision.

### L5 — Usage is a cumulative snapshot

`usage_update` means a cumulative snapshot, never a token delta. Its optional payload
declares `kind=snapshot`, normalized cumulative totals, and the last native observation.
The dedupe key is the native usage scope/turn identity plus a canonicalized usage vector;
the same key/value is recorded once. An increasing snapshot replaces `last` and derives
any UI delta from the prior baseline without adding the cumulative total twice.

After resume, the first valid native snapshot establishes `baseline.source=snapshot` and
does not pretend that pre-resume usage was replayed. A decreasing/reset vector records
`discontinuity=true` and starts a new baseline segment; it never silently produces a
negative delta. Existing inclusive/exclusive prompt-cache normalization remains in its
current canonical owner rather than being reimplemented by the ledger.

### L6 — Canonical artifact admission

Native path, diff, file, and image data are candidates only. A canonical owner,
proposed as `src/main/lib/agent-runtime/run-artifacts.ts`, performs admission before the
ledger can emit the existing `artifact_created` event. It verifies:

1. the candidate resolves to an existing regular file without symlink/hardlink escape;
2. real path and scope are within the run-owned allowed root;
3. the candidate belongs to the same Run and is stable while hashed;
4. size, media/type metadata, and SHA-256 digest are computed;
5. path/reference/metadata are redacted for the destination surface; and
6. the manifest entry is durably associated with the Run before event publication.

Missing, out-of-scope, cross-run, unstable, or secret-bearing candidates emit a stable
sanitized diagnostic and no `artifact_created`. Final artifact registration settles
before `completed`. `agent-runtime-core` is corrected by adding its already implemented
internal `artifact_created` value; Local Job API v1 gains no new event type and its
existing nullable field shapes remain unchanged unless the Owner separately approves a
breaking revision.

### L7 — Unknown input and stable status taxonomy

No native input admitted to the ledger may end as `[]`, `null`, or an unobservable
default branch. Known non-content state uses a `status` event with one of these stable
subtypes:

- `thread_lifecycle`
- `turn_lifecycle`
- `compaction`
- `reroute`
- `warning`
- `mcp_lifecycle`
- `oauth_lifecycle`
- `approval_review`
- `interaction_boundary`
- `runtime_process`
- `repair`
- `unknown_native_method`
- `late_event`

Unknown methods record the sanitized method name, native correlation/provenance,
`lossPossible=true`, and payload-shape metadata rather than arbitrary raw payload or
free-form-only text. Newly understood methods can later map to a stable subtype without
changing the public 12-type vocabulary.

### L8 — Exact RuntimeInstallation provenance

Every ledger record and derived trace binds immutable provenance captured before Run
start: runtime ID and adapter source, installation ID, resolved executable real path,
binary SHA-256, version/build when available, and protocol/schema name plus version or
digest. A record cannot substitute a mutable “current runtime” lookup. Missing required
installation or protocol identity fails closed before provider work; whether this change
owns the minimal installation snapshot is an Owner decision.

Synthetic, repair, and projection events add their source marker without replacing the
underlying runtime provenance. Redaction removes local-secret path components from
consumer projections while the restricted ledger retains the verified identity.

### L9 — Resume is snapshot repair, not replay

`repairFromSnapshot` compares a native thread/turn/item snapshot to the durable ledger
high-water state. Every repair observation declares `repair.source=snapshot`,
`lossPossible`, source response/request identity, and per-item reconciliation result
(`matched`, `suffix_repaired`, `missing_local`, `missing_native`, or `mismatch`). It does
not reuse native ordering as a cursor and never describes the snapshot as replay.

After an explicitly pre-authorized same-Run transport replacement, ledger sequence
continues strictly after the persisted high-water mark and snapshot repair may complete
an unsettled item before the replacement deadline/barrier. After a definitive exit or
already durable terminal, a later snapshot is diagnostic-only and cannot repair
materialized output. Missing, malformed, or truncated rollout data produces a diagnostic
and no false repair. A previously durable failed/error terminal remains authoritative
after rehydrate; a later degraded snapshot cannot overwrite it.

### L10 — C7 public boundary

Local Job API v1 keeps exactly 12 event types and its existing envelope. The ledger maps
internal guard, permission, question, command, interaction-boundary, and loss details
onto existing v1 types, chiefly namespaced optional payloads under `status`/`error`.
Optional additions must be unknown-safe and redacted.

Proposal Consumer Impact rows 2, 3, 4, 5, 7, and 8 are C7 Red. No implementation may begin
until the Owner records a compatibility disposition. The implementation may not hide a
Red behavior behind “internal refactor”; if the Owner chooses a facade, it must be a
projection of this same ledger, not a second fact chain.

### L11 — Explicit exclusions and handoffs

- `add-durable-agent-interactions`: full Interaction state machine and resolution
  ledger; this ledger records only ingress/send/resolved boundary facts.
- Phase 5 continuation: lease/epoch/live-attach fencing and Claude one-shot handle CAS.
- `add-local-job-api-async-submit`: async submit, v1.1 request gate, idempotency key.
- Future conformance work: dynamic frequency/ordering of all 66 notifications and
  trace §6.2's realtime/unobserved variants.

The ledger boundary must remain extensible enough for these owners, but this change must
not partially implement them or claim their guarantees.

### L12 — Acceptance tests precede implementation

An independent author reads only the approved specs and writes Bun tests at the seam
above. Each implementation task starts with a red test commit/evidence entry, then the
implementation makes it green. The minimum fixture matrix is in tasks §7 and includes
trace `[EVENT-01..03]`, `[CODEX-06]`, `[CODEX-07]`, and `[CODEX-08]` shapes. A passing
test written after implementation is not sufficient evidence for this pilot.

## Current Owner to Target Mapping

| Current owner/path | Target responsibility | Same-change deletion or preservation |
| --- | --- | --- |
| `codex/app-server-stream-events.ts` | Stateless native decoding into typed ledger boundary input | Delete unknown/default empty projection and terminal/sequence inference; preserve protocol-specific decoding. |
| `agent-runtime/stream-event-mapper.ts` | Compatibility projection from reconciled ledger facts where still needed | Delete local sequence, chunk-based failure truth, final-snapshot text append, unknown empty projection, terminal mint, raw renderer redaction/emitter path, and `createRuntimeStreamChunkSecretRedactor`; retain the underlying stateful algorithm only in `redaction.ts` for ledger-owned use. |
| `agent-runtime/runtime-events.ts` | Canonical event envelope/types | Preserve owner; add optional native/provenance/reconciliation shapes and define only `completed` as terminal. |
| `agent-runtime/redaction.ts` | Canonical stateless and stateful redaction algorithms | Preserve `redactRuntimePayload`, `redactExactSecretHints`, `createExactSecretStreamRedactor`, and `createExactSecretStreamChannelRedactor` as exact-owner symbols; the ledger owns their per-Run state and applies them once before fan-out. |
| New `agent-runtime/run-event-ledger.ts` | Ingestion order, exact sequence, item/usage reconciliation, error evidence, terminal barrier, late policy, repair, and fan-out | New single canonical owner. |
| New `agent-runtime/run-artifacts.ts` | Artifact candidate validation, digest, scope/run ownership, and manifest admission | Factor and reuse existing strong run-artifact checks; native mapper cannot emit artifacts directly. |
| `codex/app-server-adapter.ts` and transport | Deliver response/notification/request/send/resolved/exit boundaries | Delete adapter sequence, `lastError`/pending-terminal state machine, listener-driven early cutoff, and session/thread fallback. |
| `claude/agent-sdk-desktop-run-envelope.ts` | Submit Claude stream/output boundaries to the same Run ledger and consume its renderer projection | Replace the raw `createRuntimeRendererChunkEmitter` fact/redaction path while preserving Claude runtime behavior; this does not change query resume or consume continuation handles. |
| `trpc/routers/codex.ts` and desktop run persistence | Consume renderer/chat projections from ledger | Delete raw `appServerPersistenceChunks` fact chain and blind delta join. |
| `headless/adapters/codex-app-server.ts` | Consume the same complete ledger envelope | Delete `completed` suppression, envelope stripping, direct catch-to-observer errors, and independently reconstructed result truth. |
| `headless/job-store.ts` | Atomic exact-sequence durable source plus projection/outbox obligations | Delete re-sequencing and second `completed`; atomically persist ledger fact/high-water and, for terminal, job status; support fact-key commit reconciliation before fan-out. |
| `headless/local-job-api.ts` | Existing run-directory, atomic-write, stable-file, receipt, digest, and manifest I/O primitives | Preserve reusable filesystem primitives, but move/factor artifact eligibility, receipt acceptance, Run association, and manifest-admission decisions into `run-artifacts.ts`; this module may serialize admitted results only. |
| `headless/cli-dispatcher.ts` | Submit initial/final output files as candidates | Delete its direct `artifact_created` append and final artifact registration path; it receives only the canonical owner's admitted event/manifest result. |
| `shared/agent-jobs.ts` | Internal durable event vocabulary | Preserve existing 21 values including `artifact_created`. |
| `shared/local-job-api.ts` | v1 facade and 12-type vocabulary | Preserve types/envelope and pre-existing payload members; keep `runEventSequence` only as a deprecated alias equal to canonical `sequence`, and add optional redacted metadata without another cursor. |
| `claude/agent-sdk-query-options.ts` and `claude/chat-history.ts` | Existing Claude resume options and fork/one-shot-handle consumption | No change in this slice; preserve current behavior and defer compare-and-set consumption plus continuation fencing to the Phase 5 continuation change. |
| Architecture ownership map/guard | Enforce the above owners and shrinking import paths | Replace old exact-symbol guard baseline and add banned-pattern fixtures for former chains. |

## Migration Plan and Gate

1. Freeze legacy behavior with characterization fixtures, then have an independent
   author add spec-derived acceptance tests that fail for the documented gaps.
2. Add the inactive ledger and exact-sequence durable sink behind the internal
   `canonicalRunEventLedgerV1` Run-construction gate. No production Run may dual-write
   or compare shadow ledgers.
3. In disposable pre-production data, cut one Run atomically to the ledger, including
   desktop/headless projections, result, artifact, and Local API reads. A process restart
   resumes from the durable high-water mark.
4. Run the full fixture matrix and known-consumer verification. Inventory unknown
   consumers and record the Owner's C7 disposition.
5. Cut all supported Run constructors to the ledger. Existing active pre-cutover test
   jobs are canceled/interrupted or reset in disposable data; no external artifact is
   deleted. This proposal does not claim cross-format migration of historical raw chunks.
6. Before implementation review, delete the legacy branch, the migration gate, raw
   projection buffers, local allocators, empty defaults, envelope stripping, and second
   terminal writers. Update the architecture guard so reintroduction fails.

Rollback before legacy deletion selects the legacy path only for newly created test
Runs and discards disposable ledger fixtures. Rollback after deletion requires a new
Owner-approved change; it may not restore dual-write. Public compatibility rollback, if
the Owner selects a facade or version, changes projection only and never creates a
second ledger.

## Acceptance and Stop Conditions

Implementation review stops if any of the following is true:

- a Run has more than one sequence allocator, persisted sequence domain, or terminal;
- canonical `runId`, internal/event `jobId`, and public v1 `jobId` can differ for one
  attempt, or a retry reuses/mutates the source Run instead of creating a new ledger;
- an uncommitted record is visible/acknowledged, a failed/unknown append lets a later
  fact overtake or reuse its accepted sequence, or projection failure rolls back truth;
- a known or unknown native boundary can silently return an empty projection;
- assistant/reasoning final snapshots can be appended as duplicate deltas;
- retry metadata, native identity, or exact runtime/protocol provenance is lost;
- adjacent event fragments can concatenate into an exact secret in any event,
  reconstructed output, terminal flush, or consumer projection;
- headless strips the envelope/completion or persistence reassigns sequence;
- an artifact event is emitted before canonical admission;
- any module other than `run-artifacts.ts` decides artifact eligibility, mutates the
  manifest lifecycle, or mints `artifact_created` rather than persisting an admitted fact;
- resume is described as event replay or uses a native cursor downstream;
- an unplanned/expired/mismatched transport replacement avoids its synthetic terminal,
  or a snapshot mutates output after a definitive exit/settled terminal;
- any C7 Red item lacks an explicit Owner disposition;
- Amadeus, Career Kit, or discovered consumers lack recorded evidence; or
- the implementation-only migration gate or legacy path remains at Owner acceptance.

`REVIEW_APPROVED` and green tests do not complete the change. The final stop gate is
explicit Owner `ACCEPTED` on a frozen source SHA with verification evidence. Push and
merge remain separately unauthorized.

## Risks and Trade-offs

- A single serialized owner can become a throughput bottleneck. Correctness takes
  precedence; performance must be measured with deterministic fixtures before any
  partitioning, and partitioning may not split a Run's order.
- Buffering out-of-order item transitions can consume memory. The implementation needs
  bounded buffers and explicit loss/mismatch settlement rather than unbounded waiting.
- Optional payload growth can expose local identity if redaction is late. The ledger
  must redact before fan-out and tests must use secret-like fixture values.
- Exact artifact checks can reject formerly visible candidates. That is intentional
  fail-closed behavior but is a C7 Red trust/artifact decision.
- Publishing `completed` promptly conflicts with preserving late diagnostics. The
  preset isolates late facts from outcome, but the public read policy awaits Owner choice.

## Open Questions

1. **C7 disposition:** Which of `DIRECT_NEW_STANDARD`, `NEW_VERSION`, `TEMPORARY_FACADE`, `DEFER`, or `REJECT` governs Red rows 2, 3, 4, 5, 7, and 8?
2. **Amadeus boundary:** Is its direct native stream supported public API or an internal consumer migrated in lockstep?
3. **Completion truth:** Which public status/reason represents denial, rejection, and invalid zero output, and when is empty output explicitly valid?
4. **Provenance owner:** Does this change add the minimal immutable `RuntimeInstallation` snapshot or wait for a separate release-manifest owner?
5. **Late visibility:** After public `completed`, may explicit reads expose immutable sanitized late diagnostics, or must all admissible facts drain first?
