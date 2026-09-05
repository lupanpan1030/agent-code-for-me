## MODIFIED Requirements

### Requirement: Normalized Agent Events
The system SHALL normalize runtime output through the one run-scoped canonical
ledger into ordered `RunEvent` records that can be persisted, streamed, and
later mapped to protocol, CLI, desktop, and Local Job API clients. The ledger
SHALL assign `sequence` exactly once at ingestion; every downstream sink SHALL
preserve that value rather than create another event order.

#### Scenario: Event type is emitted
- **WHEN** a Bun test creates `createCanonicalRunEventLedger` with a recording
  sink and ingests a fixture containing every supported normalized category
- **THEN** each emitted type is one of `job_created`, `job_started`,
  `assistant_delta`, `reasoning_delta`, `tool_started`, `tool_delta`,
  `tool_finished`, `guard_decision`, `permission_requested`,
  `scope_expansion_requested`, `question_pending`, `question_result`,
  `mcp_needs_auth`, `usage_update`, `artifact_created`, `command_started`,
  `command_output`, `command_finished`, `status`, `error`, or `completed`
- **AND** each event has a sanitized payload and a ledger-assigned sequence
- **AND** the recording sink observes strictly increasing sequences with no
  downstream renumbering

#### Scenario: Runtime emits assistant output
- **WHEN** the ledger test ingests the trace `[EVENT-01..03]`-shaped assistant,
  reasoning, and structured-content fixture through its public native-ingestion
  functions
- **THEN** the recording sink receives ordered assistant-output events with
  sequence numbers
- **AND** the reconciled output preserves enough sanitized metadata for desktop
  and CLI renderers to display the same final content
- **AND** completed snapshots do not append text that was already represented by
  deltas

#### Scenario: Runtime emits tool activity
- **WHEN** the ledger test ingests a fixture containing the start, progress, and
  completion boundaries for each supported native tool item lifecycle
- **THEN** the recording sink receives ordered tool events with tool name,
  status, and sanitized payload metadata
- **AND** the fixture's native secrets are absent from every recorded payload
- **AND** a completion snapshot reconciles, rather than duplicates, preceding
  tool progress

#### Scenario: Runtime splits an exact secret across adjacent events
- **WHEN** a Bun test configures exact provider and gateway secret hints, then
  splits each hint across adjacent assistant, reasoning, tool-output, and
  terminal-flush fixtures submitted to `createCanonicalRunEventLedger`
- **THEN** the run/item/channel redaction state withholds each possible secret
  prefix until it can release or redact it safely
- **AND** no recording sink, reconstructed message, trace, result, or Local Job
  API envelope contains the exact secret or a leaked withheld prefix
- **AND** surrounding non-secret content remains ordered and the sanitized flush
  completes before the Run's sole `completed` event

#### Scenario: Runtime reports completion
- **WHEN** the ledger test closes success, failure, cancellation, interruption,
  denial, rejected-output, and zero-output fixtures through the public terminal
  boundary
- **THEN** each recorded Run has exactly one `completed` event carrying its
  truthful final status
- **AND** `error` events remain diagnostic facts rather than terminal events
- **AND** no event after `completed` can mutate output, usage, artifacts, or the
  final status

#### Scenario: Event is serialized for CLI
- **WHEN** the CLI serializer test is given recorded ledger events in
  `stream-json` mode
- **THEN** stdout receives one newline-delimited JSON object for each event in
  the ledger sequence order
- **AND** non-event diagnostics are written to stderr
- **AND** the serializer preserves the ledger sequence exactly

#### Scenario: Headless process emits coarse output
- **WHEN** a headless process-backed adapter feeds a fixture containing assistant
  text, command lifecycle output, status, retry error, and completion boundaries
  into `createCanonicalRunEventLedger`
- **THEN** the recording sink receives ordered `RunEvent` records with sanitized
  payloads
- **AND** job persistence receives those same events through the canonical
  ledger sink instead of a separate unredacted or renumbered event path
- **AND** the adapter does not strip the canonical envelope or mint a second
  completion event

#### Scenario: Event compatibility is required
- **WHEN** compatibility tests project a canonical fixture to CLI, protocol,
  desktop, and Local Job API v1 consumers
- **THEN** each surface receives its documented event envelope derived from the
  same recorded ledger events
- **AND** Local Job API v1 still exposes only its documented 12 event types and
  treats the redacted native, provenance, reconciliation, and status fields as
  optional payload additions
- **AND** existing v1 consumers do not need to parse raw `RunEvent` internals

### Requirement: Desktop Run Request Contract
The runtime core SHALL define a desktop-capable run request, event,
cancellation, and result contract for desktop Claude and Codex adapters that
extends the shared run request base and routes native event boundaries through
the one run-scoped canonical ledger.

#### Scenario: Adapter receives desktop request
- **WHEN** a Bun test invokes a desktop runtime adapter with a verified request
  and an injected `createCanonicalRunEventLedger` recording sink
- **THEN** it receives a `DesktopRunRequest` containing run identity, verified
  context, provider binding metadata, permission policy, MCP readiness,
  attachment references, trace observer, cancellation signal, and session
  metadata
- **AND** the request supplies the run-scoped ledger ingestion boundary used by
  that adapter rather than permitting an adapter-local sequence owner
- **AND** the request excludes plaintext provider secrets, OAuth tokens, gateway
  tokens, raw headers, and arbitrary renderer-supplied env

#### Scenario: Adapter emits normalized events
- **WHEN** a runtime-specific `[EVENT-01..03]`-shaped fixture emits assistant,
  reasoning, tool, guard, permission, question, MCP, usage, status, error,
  cancellation, or completion information
- **THEN** the adapter submits each native boundary once to the run-scoped ledger
  and callers observe ordered `RunEvent` records with sanitized payloads
- **AND** the adapter does not own a second fact chain, sequence allocator,
  terminal decision, or persistence mapper
- **AND** callers do not need runtime-specific stream objects to persist or
  display the trace

## ADDED Requirements

### Requirement: Canonical Run Event Ledger Ownership
The main process SHALL create exactly one canonical ledger owner for each Run.
`createCanonicalRunEventLedger` in
`src/main/lib/agent-runtime/run-event-ledger.ts` SHALL ingest runtime output and
system lifecycle facts, assign the canonical `sequence` at the ingestion point,
apply canonical redaction once, atomically commit each exact-sequence fact and
its projection obligation before ingestion acknowledgement, and then publish
the committed fact to injected projections. JSON-RPC responses, notifications, server requests,
server-response-send boundaries, and server-request-resolved boundaries SHALL
enter this same owner; transports and business mappers SHALL NOT maintain
independent fact chains.

#### Scenario: All protocol boundaries enter one ledger
- **WHEN** a Bun test calls the ledger's public response, notification,
  server-request, server-response-send, and server-request-resolved ingestion
  functions with an interleaved `[EVENT-01..03]`-shaped fixture
- **THEN** the recording sink contains one canonical fact for each accepted
  boundary in the exact order of ledger ingestion
- **AND** sequences are gap-explainable, strictly increasing integers allocated
  by that ledger alone
- **AND** no transport callback or mapper produces a parallel event for the same
  fact

#### Scenario: One event order crosses all sinks
- **WHEN** a ledger test attaches recording desktop, headless persistence, CLI,
  protocol, and Local Job API projection sinks and ingests one mixed Run fixture
- **THEN** every sink observes the same canonical event identity and sequence
  before applying only its documented envelope or vocabulary projection
- **AND** persistence stores the supplied canonical sequence without
  renumbering it
- **AND** terminal finalization does not insert another `completed` event

#### Scenario: Durable append fails before acknowledgement
- **WHEN** a Bun table test makes the ledger's public in-memory
  `durableStore.appendExact` either fail definitely before commit or return an
  unknown outcome that may have committed, while another native fact is waiting
- **THEN** ingestion acknowledges neither fact and no renderer, subscriber,
  result, CLI/API projection, or `read(afterSequence)` call observes the pending
  record before commit is proven
- **AND** the ledger blocks the later fact, reconciles the first by its stable
  internal fact key, and retries the same fact with the same candidate sequence
- **AND** after recovery the durable reader contains each fact once in order and
  no different accepted fact ever uses the first fact's canonical sequence

#### Scenario: Process crashes after commit and before projection
- **WHEN** a Bun fault-injection test commits one ledger record and its projection
  obligation atomically, crashes before a recording projection acknowledges it,
  and recreates the ledger over the same durable store and projection cursor
- **THEN** the committed record remains readable at its original sequence and
  the restarted projection consumes it from durable state without renumbering
- **AND** a projection failure or retry does not roll back the record, mutate its
  payload, or cause the Local Job API reader to return it twice
- **AND** the next fact receives a strictly greater canonical sequence

### Requirement: Native Identity And Runtime Provenance
Each execution attempt SHALL have one canonical `runId`; an internal/event
`jobId` or Local Job API v1 `jobId`, when present, SHALL equal that value as a
compatibility alias. A retry SHALL create a new ledger and new `runId`, retain
direct/root/attempt provenance, and leave the terminal source Run immutable.
Each canonical Run trace SHALL bind to one exact runtime installation and SHALL
carry renderer-safe provenance sufficient to identify its runtime and adapter
source, installation, resolved executable, executable digest, version or build,
protocol identity, and schema identity. When the runtime provides native
identity, the ledger SHALL preserve redacted `threadId`, `sessionId`, `turnId`,
`itemId`, `requestId`, and `callId` in a versioned payload namespace such as
`runtime.codex.v1`; missing values SHALL remain absent,
and thread and session identity SHALL never be substituted for one another.

#### Scenario: Canonical Run and Job identities cannot diverge
- **WHEN** a Bun table test creates the ledger with matching and mismatched
  `{runId, jobId}` fixtures through desktop, headless, and Local Job API Run
  constructors
- **THEN** a matching fixture emits events whose event/public `jobId` equals
  canonical `runId`, while a mismatch fails before provider work or event
  publication
- **AND** a retry fixture creates a distinct new ledger and `runId` with
  `retryOfRunId`, `rootRunId`, and deterministic `attempt` provenance
- **AND** retry does not append events to or mutate the terminal source ledger

#### Scenario: Distinct native identities are preserved
- **WHEN** the ledger test ingests a fixture whose thread, session, turn, item,
  request, and call IDs are all distinct and include secret-like substrings
- **THEN** the recorded event's `payload.runtime.codex.v1` object retains each
  available identity in its correct field after redaction
- **AND** no `threadId` is copied into `sessionId` or vice versa
- **AND** raw secret-like fixture values are absent from the serialized event

#### Scenario: Exact runtime provenance follows every event
- **WHEN** a ledger is created with a fixture RuntimeInstallation ID, binary
  digest, resolved executable, adapter source, version or build, protocol
  identity, and schema identity and then emits native and synthetic events
- **THEN** every recorded event and the trace header refer to that exact immutable
  provenance tuple
- **AND** a mismatched or missing required provenance tuple fails ledger
  admission before a runtime event is published
- **AND** synthetic events identify their Locus source without obscuring the
  bound runtime installation

### Requirement: Item Lifecycle Reconciliation
The canonical ledger SHALL reconcile each native item as
`started -> delta* -> completed`. It SHALL tolerate missing, duplicate, and
out-of-order boundaries without duplicating assistant or reasoning text, SHALL
treat a completed snapshot as the authoritative native view, and SHALL expose a
machine-readable reconciliation result and loss marker whenever the observed
stream cannot be proven complete. Reconciliation results SHALL use `matched`,
`suffix_repaired`, `missing_local`, `missing_native`, or `mismatch`.

#### Scenario: Assistant deltas reconcile with final snapshot
- **WHEN** a ledger test ingests an `[EVENT-01..03]`-shaped assistant item with
  duplicated deltas, an out-of-order start, and an authoritative completed
  snapshot
- **THEN** the materialized assistant output equals the completed snapshot
  exactly once
- **AND** the recording sink identifies suppressed duplicates and the
  reconciliation result without appending the snapshot as another delta
- **AND** any gap that cannot be reconstructed is marked `lossPossible: true`

#### Scenario: Reasoning deltas reconcile with final snapshot
- **WHEN** a ledger test ingests a reasoning item whose start is missing, whose
  deltas overlap, and whose completed snapshot contains the authoritative text
- **THEN** the materialized reasoning output equals the completed snapshot
  exactly once
- **AND** the recorded reconciliation state distinguishes repaired overlap from
  an unrecoverable gap
- **AND** the test can assert the final item state is `completed` even though the
  start boundary was absent

#### Scenario: Tool item lifecycle is incomplete or repeated
- **WHEN** a ledger test ingests duplicate, missing, and out-of-order start,
  progress, and completion boundaries for native tool item variants
- **THEN** each native item identity has one reconciled lifecycle and at most one
  canonical `tool_started` and `tool_finished` transition
- **AND** authoritative completion fields replace stale progress fields without
  erasing previously observed diagnostic facts
- **AND** incomplete lifecycles carry a machine-readable loss or reconciliation
  marker

### Requirement: Diagnostic Error And Terminal Invariants
The canonical ledger SHALL preserve a runtime error's `willRetry`, redacted
native code, native identity, and stable classification as `diagnostic`,
`retryable`, `fatal_candidate`, or `policy_denial`. An `error` event SHALL be
diagnostic evidence; each Run SHALL emit exactly one
terminal `completed` event after its terminal barrier. A definitive transport
exit without a native terminal fact SHALL create a synthetic terminal candidate
with explicit provenance. A transport replacement SHALL defer that barrier only
when the same Run owner registered its attempt/deadline before exit and binds the
same ledger, Run, installation, and compatible protocol before expiry. A denial,
rejected output, or zero-output Run SHALL NOT report
unqualified success unless the admitted request explicitly declares empty
output valid. Events received after the sealed terminal SHALL be represented
only by a diagnostic `status` event with subtype `late_event` and SHALL NOT
change outcome or materialized results.

#### Scenario: Retry error is followed by success
- **WHEN** a ledger test ingests a retry-error fixture with native code and
  `willRetry: true`, followed by successful item completion and a terminal
  boundary
- **THEN** the sink records the retry `error` as diagnostic with its redacted
  code and native identity preserved
- **AND** the Run has exactly one terminal `completed` event with status
  `succeeded`
- **AND** persistence rehydration preserves both the retry fact and the one
  terminal event

#### Scenario: Failure truth survives rollout persistence
- **WHEN** table-driven denial, rejected-output, and invalid zero-output fixtures
  plus the `[CODEX-08]` failed/error rollout-loss fixture enter through the
  rollout writer and are then rehydrated
- **THEN** denial, rejected-output, and invalid zero-output outcomes remain
  non-successful under the Owner-approved completion mapping and retain their
  corresponding diagnostic evidence
- **AND** no default-success fallback replaces an unknown or failed terminal
  status
- **AND** each rehydrated Run still has exactly one `completed` event

#### Scenario: Definitive transport exit synthesizes one terminal
- **WHEN** a ledger test records an unplanned exit, expired replacement,
  replacement identity mismatch, or failed replacement bind before any native
  terminal fact and then submits a duplicate exit and late native completion
- **THEN** one synthetic `completed` event is recorded with transport-exit and
  RuntimeInstallation provenance
- **AND** the duplicate exit does not create another terminal event
- **AND** the late native completion becomes a `status` event with subtype
  `late_event` and cannot change the synthetic outcome

#### Scenario: Pre-authorized transport replacement continues the same ledger
- **WHEN** a Bun test calls `beginTransportReplacement` before the old transport
  exits, then calls `bindReplacementTransport` with the same Run,
  RuntimeInstallation, compatible protocol, attempt ID, and a deterministic
  time before the registered deadline
- **THEN** the old exit is a `runtime_process` status fact rather than a
  terminal, and the replacement continues after the durable high-water
  `sequence`
- **AND** an incomplete item may enter `repairFromSnapshot` before settlement
  and then the Run emits exactly one final `completed`
- **AND** the same table test proves an unplanned, late, mismatched, or failed
  bind follows the definitive-exit synthetic-terminal scenario instead

### Requirement: Usage Snapshot Accounting
Canonical `usage_update` payloads SHALL use cumulative snapshot semantics. Each
unique update SHALL identify its deduplication key, cumulative `total` usage
vector, and native `last` usage vector; identical native updates SHALL not be
double counted. A resume
snapshot SHALL establish a baseline rather than replay usage, and a counter
decrease or incompatible baseline SHALL produce an explicit discontinuity
instead of a negative increment.

#### Scenario: Usage snapshots are accumulated once
- **WHEN** a ledger test ingests native `total` token fixtures of 10, 20, a
  duplicate 20 with the same native deduplication identity, and 25, paired with
  native `last` values of 10, 10, 10, and 5
- **THEN** recorded unique `usage_update` payloads declare `kind: snapshot` and
  cumulative `total` values 10, 20, and 25
- **AND** their preserved native `last` values are 10, 10, and 5
- **AND** the duplicate snapshot neither emits a second accounting update nor
  increases the materialized total

#### Scenario: Resume establishes a usage baseline
- **WHEN** a resumed ledger repairs from a native usage `total` snapshot of 100
  and then receives cumulative `total` updates of 108 and 3 after a runtime
  counter reset
- **THEN** 100 is recorded as a snapshot-repair baseline rather than new token
  consumption
- **AND** the update to 108 preserves the native `last` vector and derives a UI
  delta of 8 from the baseline without changing snapshot semantics
- **AND** the decrease to 3 records a new baseline with an explicit
  discontinuity marker and never records a negative increment

### Requirement: Canonical Artifact Admission
Native paths, diffs, images, and other runtime outputs SHALL be treated only as
artifact candidates. The canonical artifact owner SHALL verify existence,
allowed scope, Run ownership, digest, stable reference, media metadata, and
redaction before the ledger emits the existing `artifact_created` event. No
transport, mapper, or terminal finalizer SHALL emit a second artifact fact, and
accepted final artifacts SHALL be recorded before `completed`.

#### Scenario: Valid artifact candidate is admitted
- **WHEN** a ledger test submits a temporary in-scope file candidate owned by the
  fixture Run through the canonical artifact admission port
- **THEN** the sink records exactly one `artifact_created` event with a verified
  digest, size, media type, Run ownership, and redacted stable reference
- **AND** the event precedes the Run's `completed` sequence
- **AND** no raw native path outside the allowed payload fields is exposed

#### Scenario: Invalid artifact candidate is rejected
- **WHEN** a ledger test submits missing, out-of-scope, ownership-mismatched,
  digest-mismatched, and redaction-unsafe candidates
- **THEN** no `artifact_created` event is recorded for any invalid candidate
- **AND** the sink receives a sanitized diagnostic describing each admission
  failure without exposing the rejected path or content
- **AND** the terminal manifest contains only candidates accepted by the same
  canonical artifact owner

### Requirement: Observable Native Methods And Stable Status Taxonomy
Every ingested native method SHALL produce either a canonical domain event or a
machine-readable loss or unknown observation; no default mapping SHALL silently
return an empty event list. `status` payloads SHALL use the stable subtypes
`thread_lifecycle`, `turn_lifecycle`, `compaction`, `reroute`, `warning`,
`mcp_lifecycle`, `oauth_lifecycle`, `approval_review`,
`interaction_boundary`, `runtime_process`, `repair`,
`unknown_native_method`, and `late_event`. Free-form sanitized text MAY explain
a status but SHALL NOT replace its subtype. Server request and response-send or
resolved facts in this change SHALL remain ingestion-boundary observations and
SHALL NOT claim to implement the durable Interaction state machine.

#### Scenario: Unknown native method is observed
- **WHEN** a ledger test ingests an `[EVENT-03]`-shaped future native method with
  native method identity and a secret-bearing payload
- **THEN** the sink records a `status` event with subtype
  `unknown_native_method`, redacted native identity, and a machine-readable
  `lossPossible: true` marker
- **AND** the ingestion result is not an empty event list
- **AND** no secret-bearing payload value appears in the serialized event

#### Scenario: Stable status categories are projected
- **WHEN** a table-driven Bun test ingests thread and turn lifecycle,
  compaction, reroute, warning, MCP, OAuth, approval-review, runtime-process,
  repair, interaction-boundary, and late-event fixtures
- **THEN** each recorded `status` event carries the exact corresponding stable
  subtype
- **AND** Local Job API v1 projects each one through its existing `status` event
  type without adding a public event type
- **AND** consumers can branch on subtype without parsing explanatory text

#### Scenario: Interaction boundary is recorded without a second state machine
- **WHEN** a ledger test ingests a server request, its response-send boundary,
  and its resolved boundary with a shared request identity
- **THEN** the sink records ordered `interaction_boundary` status facts for all
  three observations
- **AND** the events preserve the redacted request identity and boundary kind
- **AND** they contain no assertion that an Interaction record was durably
  created, leased, or resolved

### Requirement: Resume Snapshot Repair
Native resume snapshots SHALL be treated as repair evidence, not event replay.
The ledger SHALL allocate fresh canonical sequences for repair observations,
mark `repair.source` as `snapshot`, declare `lossPossible`, and expose the
reconciliation result. Native offsets, item indexes, or protocol cursors SHALL
NOT become downstream cursors; the Locus ledger sequence SHALL be the only
consumer cursor.

#### Scenario: Resume snapshot repairs an incomplete item
- **WHEN** an unsettled ledger starts from an incomplete assistant or reasoning
  trace and submits a native thread or turn snapshot containing an authoritative
  completed item, either at initial resume or during a pre-authorized bound
  transport replacement
- **THEN** the repaired materialized item equals the authoritative snapshot
  without replaying already emitted deltas
- **AND** the repair observation has a fresh ledger sequence,
  `repair.source: snapshot`, `lossPossible: true`, and a reconciliation result
  of `matched`, `suffix_repaired`, `missing_local`, `missing_native`, or
  `mismatch`
- **AND** the native snapshot index is retained only as redacted evidence, not as
  the public cursor
- **AND** the same fixture submitted after a definitive exit or durable terminal
  is diagnostic-only and cannot mutate the materialized item

#### Scenario: Resume snapshot cannot prove continuity
- **WHEN** the ledger test submits missing, malformed, or truncated rollout
  fixtures derived from `[CODEX-06]`
- **THEN** the sink records a sanitized repair diagnostic with
  `lossPossible: true` and no fabricated per-item reconciliation result
- **AND** the ledger neither fabricates missing deltas nor reports replay
  completeness
- **AND** subsequent readers resume only from the last persisted canonical
  sequence

#### Scenario: Cross-version completed snapshot is reconciled
- **WHEN** the ledger test repairs from both directions of the `[CODEX-07]`
  cross-version completed-thread fixture with explicit source and target schema
  identities
- **THEN** a recognized snapshot schema preserves final output, turn identity,
  usage evidence, and creator-version provenance with a `matched` or
  `suffix_repaired` result
- **AND** an incompatible schema records `mismatch` and `lossPossible: true`
  instead of guessing
- **AND** neither outcome changes the canonical ledger sequence into a native
  cursor
