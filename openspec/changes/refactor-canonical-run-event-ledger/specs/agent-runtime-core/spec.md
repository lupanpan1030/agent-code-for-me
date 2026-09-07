## MODIFIED Requirements

### Requirement: Normalized Agent Events
The system SHALL normalize runtime output into ordered canonical `RunEvent` records
that can be persisted, streamed, and mapped to protocol, CLI, desktop and Local Job
API clients through the Run's canonical ledger. The internal envelope SHALL retain
runId, runtimeId, sequence, type, createdAt, sanitized payload and redaction metadata.
The fixture names below refer to the file shapes in this change's tasks §7; all readers
and injection ports are defined in design's Test-facing Contract.

#### Scenario: Event type is emitted
- **WHEN** the ledger ingests `vocabulary.json` through `ingestRuntimeObservation`
- **THEN** `read(0)` contains exactly the fixture's 21 allowed internal types:
  `job_created`, `job_started`, `assistant_delta`, `reasoning_delta`, `tool_started`,
  `tool_delta`, `tool_finished`, `guard_decision`, `permission_requested`,
  `scope_expansion_requested`, `question_pending`, `question_result`, `mcp_needs_auth`,
  `usage_update`, `command_started`, `command_output`, `command_finished`,
  `artifact_created`, `status`, `error`, and `completed`
- **AND** each record has sequence and sanitized payload; artifact and terminal inputs
  in the fixture enter their dedicated owner ports, not raw event minting

#### Scenario: Runtime emits assistant output
- **WHEN** `normalized-output.json` supplies assistant, reasoning and structured content
  through `ingestRuntimeObservation`
- **THEN** `read(0)` contains ordered assistant/reasoning events preserving content kind
  and safe metadata that the desktop and CLI projections can display

#### Scenario: Runtime emits tool activity
- **WHEN** `normalized-output.json` supplies tool start/progress/final observations
- **THEN** `read(0)` contains tool_started/tool_delta/tool_finished with name, status
  and sanitized metadata, and no fixture provider secret is serialized

#### Scenario: Runtime reports completion
- **WHEN** the runner facade passes each existing terminal status in
  `normalized-output.json` as validated evidence to the ledger
- **THEN** the facade's returned Run result references the committed completed sequence
  and final status from `readOutcome()`
- **AND** every record after that sequence is diagnostic-only

#### Scenario: Event is serialized for CLI
- **WHEN** the CLI stream-json serializer receives a committed event and a separate
  host diagnostic from `projection.json`
- **THEN** stdout contains one newline-delimited JSON object for the event and stderr
  contains the host diagnostic, with no diagnostic text on stdout

#### Scenario: Headless process emits coarse output
- **WHEN** the coarse ingress port receives `coarse-process.json` assistant, command,
  status, error and host-result observations
- **THEN** its returned normalized records preserve the fixture's coarse source and
  sanitized fields, with no invented native tool/session identity
- **AND** job persistence receives those records through the ledger store port

#### Scenario: Event compatibility is required
- **WHEN** protocol, CLI and v1 serializers receive the committed `projection.json` record
- **THEN** each returns its documented envelope with the same canonical sequence
- **AND** none requires the caller to parse raw native messages or desktop chunks

### Requirement: Desktop Run Request Contract
The runtime core SHALL define a desktop-capable run request, event, cancellation and
result contract for Claude and Codex adapters that extends the shared request base.
Its host composition SHALL inject the ledger ports used for observations and committed
trace delivery; the request SHALL NOT carry credentials or change ID/cancel authority.

#### Scenario: Adapter receives desktop request
- **WHEN** `desktop-request.json` is passed through the desktop request factory to a
  recording adapter
- **THEN** the adapter receives existing run identity, verified context, provider
  metadata, permission policy, MCP readiness, attachments, trace observer, signal and
  session metadata, plus the ledger ingress/committed trace ports
- **AND** the captured request excludes plaintext provider/OAuth/gateway tokens, raw
  headers and arbitrary renderer env; exact secret hints enter only the host redactor

#### Scenario: Adapter emits normalized events
- **WHEN** a fake desktop adapter submits the event categories in `desktop-request.json`
  through its injected ports
- **THEN** its recording trace observer receives committed RunEvent records without
  runtime-specific stream objects, and the request's original cancellation signal is retained

## ADDED Requirements

### Requirement: Canonical Run Event Ledger Ownership
Each Run SHALL have one ledger in its host process. All response, notification, server
request, response-send, resolved and system observations SHALL enter it. Only that
ledger SHALL allocate sequence. Its immutable exact-sequence batches SHALL commit before
acknowledgement or fan-out; sequence SHALL be dense from 1, with no invisible records.
A retried observation key SHALL return its existing batch. Projection delivery SHALL
resume using durable acknowledged cursors and be idempotent by Run/sequence.

#### Scenario: All protocol boundaries enter one ledger
- **WHEN** `ingress-boundaries.jsonl` is submitted in listed order through the five named
  boundary ports, including a response, notification, server request, send and resolved
- **THEN** `read(0)` has one or more records for each boundary in that same batch order,
  with fact keys `(observationKey, ordinal)` and sequences 1 through the committed count
- **AND** resubmitting the same observationKey returns the previous records without
  increasing the committed count or allocating another sequence

#### Scenario: Durable append fails before acknowledgement
- **WHEN** `store-faults.json` makes appendExact throw before commit for observation A
  while B is queued, then retries A with the same key and permits both commits
- **THEN** during failure `read(0)`, projection deliveries and resolved acknowledgements
  contain neither A nor B; after recovery they contain A then B at the reserved sequences
- **AND** the temporary SQLite store has one row per fact key and no partial job mutation

#### Scenario: Process crashes after commit and before projection
- **WHEN** `store-faults.json` commits A then recreates the ledger over that store before
  projection ack, with a second variant crashing after deliver but before ack
- **THEN** cursor(name) resumes the unacknowledged record at its original sequence,
  the projector upsert contains A once, and ack advances monotonically over its prefix
- **AND** `read(0)` never duplicates A and the next observation uses the next sequence

#### Scenario: Historical rows remain explicitly unverified
- **WHEN** the schema migration is applied to `legacy-store.json` containing terminal
  desktop wrapper rows, bare API rows and an inactive incomplete historical Run
- **THEN** existing row payload/ID/sequence bytes are unchanged, header.ledger_version
  is 0, and the read projection exposes historyQuality=legacy_unverified
- **AND** opening these Runs for ledger append is rejected; no fact keys, provenance
  or missing completed are fabricated; a new job fixture is version 1 with required metadata

### Requirement: Native Identity And Runtime Provenance
The ledger SHALL preserve available native identities in redacted versioned metadata
without substituting threadId/sessionId. Each runtime-backed record SHALL refer to its
immutable installation/version/binary/protocol/schema tuple; provider-only completion
records SHALL identify their actual Locus execution source. Native context used for
interrupt SHALL be owned by the ledger and read only by the host adapter.

#### Scenario: Distinct native identities are preserved
- **WHEN** `identity-provenance.json` supplies distinct thread/session/turn/item/request/call
  values, including exact-secret substrings, to a ledger with secretHints
- **THEN** `read(0).payload.runtime.codex.v1` preserves each value's redacted field and
  omits unavailable fields; no thread ID fills a missing session ID
- **AND** serialized records contain none of the fixture secrets

#### Scenario: Exact runtime provenance follows every event
- **WHEN** runtime and locus-completion variants of `identity-provenance.json` create
  ledgers and ingest native/system/synthetic observations
- **THEN** committed record metadata and trace header retain their exact immutable
  source tuple; the completion variant claims no native binary/installation
- **AND** a missing binary digest on the runtime variant rejects construction before
  publication, and schema identity uses the fixture's reproducible per-file fingerprints

#### Scenario: Interrupt target comes from native Run state
- **WHEN** the adapter reads `readNativeContext()` after thread/turn observations in
  `identity-provenance.json`, and then repeats with a missing turn ID fixture
- **THEN** the host-only interrupt request uses the observed threadId and turnId exactly;
  the missing variant returns no target and cannot substitute sessionId

### Requirement: Stateful Ledger Redaction
The ledger SHALL apply the canonical redactor before durability and any consumer
projection, including across adjacent text fragments. Exact hints and withheld raw
suffixes SHALL remain host memory only; terminal flush SHALL never reveal a secret.

#### Scenario: Runtime splits an exact secret across adjacent events
- **WHEN** `split-secrets.json` configures exact provider/gateway hints and splits each
  across adjacent assistant, reasoning, command and tool fragments, then seals the Run
- **THEN** concatenated serialized durable records, renderer chunks, diagnostics and
  result contain neither complete hints nor the withheld terminal secret prefix
- **AND** safe text remains visible, and `redaction.appliedRules` records the applied rule

### Requirement: Item Lifecycle Reconciliation
The ledger SHALL reduce items through started → delta* → completed using the completed
snapshot as authoritative for pre-seal materialization. `readItem` SHALL expose item
state/text/fields and reconciliation result, lossPossible, missingStart and suppressed
count; committed `status/item_reconciliation` SHALL carry the same data in payload.item
and payload.reconciliation. Results SHALL be matched, suffix_repaired, missing_local,
missing_native or mismatch. Reasoning keys SHALL separate text/summary and partIndex.

#### Scenario: Assistant deltas reconcile with final snapshot
- **WHEN** `items-assistant.jsonl` supplies a missing start, repeated handoff key,
  out-of-order start and final text "hello", including prefix-only and mismatched variants
- **THEN** `readItem` is completed with text "hello" once; its persisted reconciliation
  is suffix_repaired for prefix "hel" and mismatch for "heX"
- **AND** missingStart/lossPossible are true in missing-start/gap variants; final text
  is authoritative item state rather than a second appended assistant_delta

#### Scenario: Reasoning channels and parts reconcile separately
- **WHEN** `items-reasoning.jsonl` sends textDelta("analysis"), summaryPartAdded(0),
  summaryTextDelta(0,"short"), summaryPartAdded(1), summaryTextDelta(1,"next"), plus
  completed content/summary arrays and duplicate/out-of-order variants
- **THEN** `readItem` returns distinct completed text/0="analysis", summary/0="short",
  summary/1="next" with corresponding committed reconciliation fields
- **AND** no channel concatenates another channel or part, and missing/overlap variants
  have their explicit fixture result/loss/suppressed counts

#### Scenario: Tool item lifecycle is incomplete or repeated
- **WHEN** `items-tools.jsonl` supplies start/progress/final for each of the eight tool
  variants, and repeated-final/missing-start variants with the same native item key
- **THEN** `read(0)` has at most one tool_started and tool_finished per item transition,
  and `readItem` retains authoritative final fields and earlier diagnostic facts
- **AND** missing-start and duplicate-final cases expose their persisted reconciliation
  missingStart/lossPossible/suppressedDuplicateCount fields

### Requirement: Diagnostic Error And Terminal Invariants
The ledger SHALL preserve error classification, willRetry, code and native identity
without treating every error as terminal. It SHALL emit exactly one completed per
settled Run. Transport exit SHALL supply a synthetic interrupted terminal with
provenance; there SHALL be no same-Run transport replacement exception. Outcome SHALL
be determined by the declared evidence rule: cancel → canceled; interrupt/exit/recovery
→ interrupted; denial/invalid-output/invalid-empty/credential-check failure/native
failure → failed; live success or valid host result with valid allowed output → succeeded.
Snapshot status alone SHALL NOT prove success. All observations after the seal SHALL
be immutable status/late_event diagnostics and SHALL NOT change outcome or materialization.

#### Scenario: Retry error is followed by success
- **WHEN** `terminal-evidence.json` provides error code="retryable", willRetry=true,
  then live native success, valid nonempty output and successful post-check
- **THEN** `read(0)` preserves the error as retryable evidence and has one
  completed(status=succeeded), also returned by `readOutcome()` after reopening the store

#### Scenario: Denial rejection and empty output have deterministic outcomes
- **WHEN** the denial, output-invalid, empty-not-allowed, empty-allowed, credential-failed,
  cancel and interrupt rows of `terminal-evidence.json` call settle
- **THEN** `readOutcome().status` is respectively failed, failed, failed, succeeded,
  failed, canceled and interrupted, with reasons/evidenceKeys and one completed each
- **AND** a success trigger with missing output evidence does not default to succeeded

#### Scenario: Transport exit synthesizes one terminal
- **WHEN** `transport-exit.jsonl` sends exit before live completion, duplicate exit and
  a subsequent native completed observation
- **THEN** the store has one completed(status=interrupted) with synthetic.source=transport_exit,
  transport ID, exit/signal and installation provenance
- **AND** subsequent observations are status/late_event with terminalSequence and cannot
  change the interrupted result or create a replacement transport on this Run

#### Scenario: Pre-start cancel and dead-worker recovery settle through ledger
- **WHEN** queued and confirmed-dead-worker fixtures in `terminal-evidence.json` use
  the host ledger's cancel and recovery evidence ports
- **THEN** each durable job mutation and one completed commit atomically, respectively
  canceled and interrupted, with synthetic.source=cancel or recovery
- **AND** repeating recovery does not add a terminal; stale heartbeat without confirmed
  process death cannot claim a running native owner

#### Scenario: Usage after completed is diagnostic only
- **WHEN** `late-usage.jsonl` sends total=20, turn/completed and then total=25 with last=5,
  a warning and a repeated native terminal, including arrival during artifact preparation
- **THEN** `readUsage().total.totalTokens` remains 20 at its sealed asOfSequence, and
  each later record is status/late_event with diagnosticOnly=true and terminalSequence
- **AND** the late usage's payload.observation preserves total=25/last=5, while result,
  item state, artifact refs and the sole completed remain unchanged

### Requirement: Usage Snapshot Accounting
Canonical usage_update SHALL use cumulative snapshot semantics, retaining total, last,
baseline, dedupeKey, delta and discontinuity. Duplicate native snapshots/call revisions
SHALL not double count; per-call runtimes SHALL accumulate distinct calls. The existing
shared usage normalization owner SHALL remain the only cache-vector arithmetic owner.

#### Scenario: Usage snapshots are accumulated once
- **WHEN** `usage.json` supplies cumulative totals 10,20,20,25 (duplicate identity for
  the second 20) with last=10,10,10,5
- **THEN** unique usage_update payloads have kind=snapshot, total=10,20,25 and last=10,10,5;
  `readUsage().total.totalTokens` is 25
- **AND** the per-call variant with two distinct IDs and identical totalTokens=10
  yields cumulative totalTokens=20, while retransmitting either call does not increase it

#### Scenario: Resume establishes a usage baseline
- **WHEN** the defensive synthetic `usage.json` repair baseline=100 is followed by
  total=108 and a hypothetical decrease to 3
- **THEN** baseline is not new consumption; the 108 payload has delta.totalTokens=8
- **AND** the 3 payload has discontinuity=true and a new baseline with no negative delta;
  the fixture does not claim counter resets were observed in the native trace

### Requirement: Canonical Artifact Admission
Only the artifact owner SHALL validate existence, allowed scope, stable-file digest,
Run ownership, size/media and redaction and request artifact_created. Runtime candidate
artifact events SHALL precede completed. Terminal artifact refs SHALL be registered
before or in the same durable commit as completed; terminal projection files SHALL
not emit self-referential artifact_created events. Rejection SHALL use the observable
status/artifact_admission result/reason fields, with no unsafe candidate content.

#### Scenario: Valid artifact candidate is admitted
- **WHEN** `artifacts.json` creates a temporary in-scope Run-owned file and submits it
  through admitRunArtifactCandidate, then settles
- **THEN** `read(0)` has one artifact_created with verified SHA-256/size/media/ref before
  completed and the same ref in the committed artifact manifest metadata

#### Scenario: Invalid artifact candidate is rejected
- **WHEN** the missing/out-of-scope/wrong-owner/digest-mismatch/unsafe-redaction rows of
  `artifacts.json` submit candidates
- **THEN** each has no artifact_created or manifest entry and a committed
  status/artifact_admission with result=rejected and the matching stable reason
- **AND** no rejected secret path/content is serialized

#### Scenario: Terminal files and completed become visible together
- **WHEN** `terminal-artifacts.json` freezes a completed candidate, prepares events/result/
  manifest files from it, and injects failures before file preparation, before SQL commit,
  and after commit before projection
- **THEN** before a successful commit result/events readers expose no candidate terminal
  or unregistered final refs; a successful commit stores the one completed and verified
  refs atomically, and reopened readers return that same result
- **AND** events.jsonl contains the candidate completed exactly once; result references
  request/events, manifest references request/events/result without self-digest recursion;
  final files create no artifact_created event and remain unchanged by late diagnostics

### Requirement: Observable Native Methods And Boundary Facts
Unknown native methods SHALL produce sanitized status/unknown_native_method with
lossPossible=true, rather than silently disappear. Known methods SHALL use their
canonical domain event or the stable subtype disposition table. Response/send/resolved
facts SHALL describe protocol boundaries, not claim durable Interaction state.

#### Scenario: Unknown native method is observed
- **WHEN** `unknown-method.json` provides a future method and secret-bearing params
- **THEN** `read(0)` contains status/unknown_native_method, sanitized method identity and
  lossPossible=true, with no raw secret or empty default projection

#### Scenario: Interaction boundary is recorded without a second state machine
- **WHEN** `interaction-boundaries.jsonl` submits request, sent/failed response-send
  variants and resolved with the same requestId
- **THEN** read records contain subtype=interaction_boundary and boundary=request,
  response_send or resolved with request identity and explicit send result
- **AND** no payload claims a durable Interaction was created/resolved or grants execution

### Requirement: Native Resume Validation Facts
Native resume validation SHALL use request/query correlation and independent identity
relations, never generic status, arbitrary session ID, exit or result success. Codex
SHALL require matching JSON-RPC id and returned/requested thread.id plus independent
session identity and provenance; Claude SHALL require correlated system/init with
resume equality or fork's distinct new UUID. Outcomes SHALL be neutral
native_resume_validated/native_resume_rejected facts, preserving native codes and
separating native loading from later provider success or live attach.

#### Scenario: Codex response validates the requested native thread
- **WHEN** `resume-codex.jsonl` sends early status, unrelated response, matching success,
  wrong-thread, absent-session, -32600 and -32603 variants through ingress
- **THEN** only the matching success yields status/native_resume_validated, carrying
  jsonRpcId, requestedThreadId, returnedThreadId, sessionId, ephemeral, redacted path
  and cliVersion; unrelated response is protocol_response with correlated=false
- **AND** wrong/missing/error variants yield native_resume_rejected with reason/code;
  early status remains thread_lifecycle; no variant fabricates thread/started or expired

#### Scenario: Claude correlated init validates resume independently of turn success
- **WHEN** `resume-claude.jsonl` supplies ordinary/fork correlated system/init and
  unrelated-init/result-success-is_error/no-init rejection variants
- **THEN** only correct correlated resume equality or a valid distinct fork UUID yields
  native_resume_validated; the other terminal rejection cases yield native_resume_rejected
- **AND** a later auth failure leaves the validation fact unchanged and no one-shot
  handle state is mutated by the fact recorder

### Requirement: Resume Snapshot Repair
Snapshots SHALL be recorded as repair evidence with repair.source=snapshot,
lossPossible=true, explicit reconciliation and fresh Locus sequences. They SHALL not
assert native event replay, transfer live ownership, or alone settle Run success.
Durable terminal truth SHALL be immutable even when native disk history loses failure.

#### Scenario: Resume snapshot repairs an incomplete item
- **WHEN** `snapshot-repair.json` supplies local assistant prefix "hel" and a recognized
  completed item "hello" before the Run seal
- **THEN** readItem.text becomes "hello" with suffix_repaired and a fresh status/repair
  sequence carrying repair.source=snapshot and lossPossible=true
- **AND** readOutcome remains null and native item offsets do not replace the ledger cursor

#### Scenario: Durable failure survives degraded native snapshot
- **WHEN** `snapshot-failed.json` commits a live failed terminal with 401 diagnostic,
  reopens the Locus store and feeds CODEX-08's sanitized completed/error-null snapshot
- **THEN** readOutcome and the stored completed stay failed with the original error;
  the new status/late_event has repair.source=snapshot, diagnosticOnly=true and lossPossible=true
- **AND** the fixture with no durable terminal cannot settle succeeded from that snapshot;
  its later transport exit settles interrupted, without a Locus native-rollout-write call

#### Scenario: Cross-version snapshot reconciliation declares its evidence limits
- **WHEN** `snapshot-versions.json` feeds the recognized 0.139→0.149 and reverse synthetic
  shapes derived from CODEX-07's reported fields, plus an incompatible-schema variant
- **THEN** readItem preserves the recognized final/turn data, usage baseline and source
  creator version; repair carries source/target reproducible fingerprints
- **AND** incompatible input records mismatch/lossPossible without guessing item state;
  all variants use fresh Locus sequence and are labeled synthetic, not captured full responses
