# Tasks

Status: **DRAFT — awaiting Owner APPROVED**. All boxes describe future implementation,
not work authorized by the current documentation-only dispatch. The source dispatch
and raw reviews are indexed in verification.md. No product or acceptance-test authoring
starts until Owner APPROVED and the Consumer Impact decision are recorded.

## 1. Governance and baseline

- [ ] 1.1 Resolve proposal's four Open Questions and R1 (C7 rows 4/5); update the deterministic
  proposed behavior if the Owner selects a different disposition, then obtain APPROVED.
  Do not encode the approval's absence as a living runtime scenario.
- [ ] 1.2 Freeze source SHA, current living requirements, public bare API payload/12 types,
  dense order, existing one completed, retry job envelope and initial/final artifact behavior.
  Characterization uses current product readers, not the draft's former desktop wrapper example.
- [ ] 1.3 Inventory Amadeus's actual v1 dependencies and Career Kit adapter version read-only;
  record receipt links or unknown separately from Locus fixtures. Record Owner relay
  2026-09-02 as the source of direct native consumption, outside C7; no external message
  sending is implied by this task.
- [ ] 1.4 Materialize the fixture catalog below in tests/fixtures/run-event-ledger/.
  Each file has fixtureVersion=1, evidenceClass, sourceRefs, provenance and cases/steps;
  exact notification/request/item shapes are frozen before tests or implementation.
  Check in the three pinned 0.139 stable TypeScript union surfaces (or a minimal generated
  closure with manifest identifying all referenced types); verify the trace §5.1 SHA-256s.
  Verify reasoning delta index availability against that pinned ServerNotification.ts
  closure before 7.2 freeze; distinguish native fields from inferred channel/part indexes.
  Vendoring schemas/fixtures is future approved test work, not done by this draft.
- [ ] 1.5 Independently author at least one Bun test per Scenario before implementation:
  unique test ID → exactly one capability/Requirement/Scenario; use a table test where
  one scenario enumerates variants. Expand the verification scenario register with file,
  test ID, red output, then green output; no test claims several duplicate scenarios.
  Existing MODIFIED scenario tests may be retained/extended with explicit baseline evidence;
  new acceptance behavior must demonstrate a meaningful failure, not merely missing imports.
- [ ] 1.6 Confirm permitted owner inventory, threat boundaries and data stage; agree on
  active legacy drain and read-only legacy marking, not an undisclosed data reset.

## 2. Ledger owner and native identity

- [ ] 2.1 Add run-event-ledger.ts and run-event-ledger-host.ts with the design's exported
  test contract, injected clock/store/projections/artifact owner, runtimeId and memory-only
  redactionContext.secretHints; host composition receives existing job IDs, does not mint IDs.
- [ ] 2.2 Ingest native response/notification/request/send/resolved and system facts into one
  serial batch order; persist observationKey/ordinal fact keys, never assign a native cursor.
- [ ] 2.3 Implement bare semantic payload persistence with separate metadata; remove the
  internal persistedPayloadForRunEvent/runEventSequence wrapper writer atomically.
  Retain getWorkbenchSemanticPayload unwrapping only as ledger_version=0 historical
  decoding in one versioned Workbench reader; v1 reads committed envelope/item state.
  Do not introduce an internal compatibility alias or change renderer runId/cancel routing.
- [ ] 2.4 Preserve native identities and exact execution provenance, including a distinct
  pending lifecycle and locus-completion variants; bind runtime provenance only at
  executable resolution, before runtime execution/records, and reject changes after binding.
  Move interrupt target state to ledger, retain shared normalization.
- [ ] 2.5 Add explicit Drizzle migration in drizzle/ and schema/index.ts for ledger_version,
  provenance/seal metadata, event fact_key/record metadata and projection cursors; verify
  required-on-v1 record fields, null pending provenance, one-time execution tuple binding,
  uniqueness, dense sequence validation and transaction rollback.
- [ ] 2.6 Replace job-store append/complete mechanics with appendExactRunEventBatch and
  committed readers/ack; preserve atomic job-status+terminal transaction, remove nextEventSequence,
  store redaction and createAgentJobRunEvent. Event records plus cursors are the outbox;
  no additional unknown-commit API/queue is required.
- [ ] 2.7 Wire one build-time canonicalRunEventLedgerV1 selector at the host composition
  entry, initially false; meet all six design activation conditions before true cutover.
  Add transition-mode structural checks and behavioral single-writer tests, then remove
  selector/legacy branch/transition allowances before acceptance.
- [ ] 2.8 Convert desktop Claude/Codex, headless app-server/coarse observers, CLI/protocol,
  completion, system creation/start/retry, pre-start cancel and recovery entries in the
  inventory without changing construction/identity/selection policy; terminal call sites
  submit evidence. Delete job-event-bridge.ts and all its calls in the same change.
- [ ] 2.9 Migrate all historical jobs to ledger_version=0/legacy_unverified without rewriting
  their bytes/IDs/sequences; drain old active jobs before cutover and reject new append on
  legacy records. Old-build drain includes stopped/orphaned running-job recovery and
  verifies zero queued/running v0 rows; unresolved rows block cutover, never a new v0 writer.
  Exercise desktop wrapper and API bare history readers; historyQuality is internal only.
- [ ] 2.10 Replace withEventSequenceRetry with ledger-owned expectedHighWater/state conflict
  reconciliation: reload/rebuild, fact-key lookup, re-evaluate intent, re-reserve uncommitted
  dense sequences and resubmit at most three times. Cover both cross-process queued-cancel/
  start orderings: cancel-first prevents spawn; start-first forwards the existing cancel
  request to the worker. Exhaustion returns LEDGER_APPEND_CONFLICT without a false ack;
  store never re-sequences and rebased terminal candidates regenerate prepared files.

## 3. Item state and reconciliation

- [ ] 3.1 Implement readItem and committed status/item_reconciliation carriers, including
  item state, authoritative text/fields, result/loss/missingStart/suppressed count.
  Support complete native key or returned correlationKey plus channel/partIndex; missing
  IDs never force an invented native key or merge unrelated equal-text observations.
- [ ] 3.2 Implement assistant final reconciliation with missing/late start, duplicate handoff,
  equal unidentified text, prefix repair and mismatch; replace item materialization, never
  append final text as another delta or dedupe solely by equal text.
- [ ] 3.3 Key reasoning by thread/turn/item + text or summary + partIndex; cover content and
  summary arrays separately, summaryPartAdded and cross-part missing/duplicate inputs.
  Without a proven native index, ledger infers last summary boundary (default 0) or
  content/text part 0, recording indexSource=inferred/lossPossible=true; decoder is stateless.
- [ ] 3.4 Cover all eight tool variants and six remaining non-tool variants per disposition
  table; snapshot userMessage does not become assistant output.
- [ ] 3.5 Repurpose stream-event-mapper.ts to the pure projectRunEventToRendererChunks
  projection; move coarse input decoding to ledger-ingress.ts; delete raw desktop chunk
  accumulation and blind text joins in route/history owners.

## 4. Errors, terminal, usage and artifacts

- [ ] 4.1 Preserve error classification/native code/willRetry; make RunTerminalEvent completed-only;
  remove adapter/mapper lastError/default-success/pending-terminal owners.
- [ ] 4.2 Implement the exact OutcomeEvidence union/precedence; keep existing output and
  credential validation owners feeding evidence, with denial/invalid-empty → failed and
  explicit valid-empty exception. No snapshot-only success or second terminal after cleanup.
- [ ] 4.3 Route all terminal inventory sites through settle: desktop safe finalizers,
  headless job-runner success/catch, completion-runner success/catch, both CLI pre-start cancel
  branches and agent-jobs tRPC queued cancel, and confirmed-dead-worker recovery.
  Extend headless/job-recovery.ts: existing 120 s heartbeat predicate plus same-host
  ESRCH/supervised exit or never-claimed/no-PID confirmation, with alive/EPERM/unknown
  variants and transaction revalidation of worker identity/start/heartbeat. Claimed missing
  PID is unknown. Record confirmed basis or host-only heartbeat_only diagnostic; no lease/fencing.
- [ ] 4.4 Every transport exit supplies synthetic interrupted evidence with provenance;
  no beginTransportReplacement/bindReplacementTransport mechanism. Reopen durable Locus
  records for recovery; starting a native process again requires a separate existing new Run.
- [ ] 4.5 Freeze usage/item materialization at terminal ingress; permit only status/late_event
  after seal, with terminalSequence and observed total/last. Keep result usage asOfSequence;
  no drain timer or assumption about unmeasured late-native order. Buffer late rows
  during preparation at post-terminal reservations, commit after the terminal transaction;
  failed preparation keeps the terminal slot as failed and preserves late diagnostics.
  Conflict rebase changes only uncommitted reservations and terminalSequence references.
- [ ] 4.6 Normalize snapshot total/last/baseline/delta once; per-call usage sums unique IDs;
  retain shared usage-metadata.ts cache arithmetic. Dedupe revisions, mark synthetic decrease.
- [ ] 4.7 Move artifact validation/preparation into run-artifacts.ts; exact stable-file scope,
  digest/ownership/media/redaction checks and status/artifact_admission rejections. Remove
  dispatcher artifact minting and duplicate API file admission implementation.
- [ ] 4.8 Prepare terminal files from the frozen completed candidate; register final refs
  before or with completed in one durable commit. Runtime artifact events precede terminal;
  terminal projection files emit no artifact_created, preserve the finite digest dependency
  graph and existing public paths. Add preparation/rollback/reopen crash fixtures.

## 5. Unknown methods and status subtypes

- [ ] 5.1 Replace native default [] with unknown_native_method/lossPossible; malformed known
  payloads use warning/invalid_native_shape rather than silently disappearing.
- [ ] 5.2 Freeze and implement the codex-runtime-parity delta's inlined exhaustive
  66 notification / 10 request / 16 item disposition table, including plan/hook/model-verification/review/userMessage, process,
  realtime/remote-control/windows; observed_deferred does not promote capability support.
- [ ] 5.3 Project all nine non-v1 internal event types to status with subtype=internal type,
  preserving payload members, and restricted records to redacted_observation at the same
  sequence. Every v1 sequence remains dense, so there is no unexplained gap policy.
- [ ] 5.4 Record request/send/resolved boundaries with request identity and sent/failed result;
  do not implement/claim Interaction resolution state or duplicate resolved notification ingress.

## 6. Provenance and resume repair

- [ ] 6.1 Implement captureRunExecutionProvenance in NEW agent-runtime/run-provenance.ts;
  reuse runtime-executable.ts path checks without changing selection. Own deterministic
  local installation identity (runtime/source/platform/arch/version/actual binary digest),
  opaque executableRef, actual executable SHA-256 and reproducible sorted per-file schema
  fingerprints/canonical manifest encoding. Freeze repeatability/tamper fixtures; never use
  the non-deterministic v2.schemas.json bundle digest or an unimplemented delivery registry.
  All adapters call it at executable resolution; host bindExecutionProvenance atomically
  persists the tuple before runtime execution/publication and seals it for the Run.
  Lifecycle pending jobs remain null, provider completion binds its actual source;
  missing runtime fields or capture-to-launch executable changes fail closed.
- [ ] 6.2 Record Codex correlated successful response equality, independent session identity,
  durability fields/provenance and neutral native_resume_validated/rejected; preserve -32600/
  -32603, no expired inference, early status consumption or fabricated thread/started.
  Separate the four measured response clauses from durability evidence: record intent,
  observed thread/target-turn status, raceContext and ephemeral/path/creator-version;
  missing durability fields mark durableEvidence=false/lossPossible, not rejection.
- [ ] 6.3 Record Claude correlated system/init predicate for ordinary/fork/slice without
  changing query-options/chat-history one-shot CAS; result/exit alone never validate.
  In agent-sdk-errors.ts use neutral NATIVE_RESUME_REJECTED for No conversation found;
  in agent-sdk-stream-error-finalization.ts delete SESSION_EXPIRED inference and sessionId
  clearing, forward sanitized diagnostic/rejection evidence. Binding expiry/repair remains
  Phase 5; test existing sessionId is unchanged by this stream-error path.
- [ ] 6.4 Repair snapshots with fresh Locus sequence, source=snapshot, lossPossible and
  reconciliation. Durable failed/error wins over degraded native history; no durable
  terminal means the snapshot cannot alone settle succeeded or grant live owner authority.
- [ ] 6.5 Label counter reset, incompatible schema and native resume-not-replay as
  inference/policy; keep trace §6.2 dynamics and Phase 5 replacement/fencing/CAS follow-ups
  separate, without a Run identity convergence guard hidden in this slice.

## 7. Conformance fixtures (independent author first)

Fixture root for the future implementing change: `tests/fixtures/run-event-ledger/`.
The current revision supplies documentation of shapes only, not fake measured captures.

`[EVENT-01]` supplies schema/method inventory; `[EVENT-02]` is a source-search command;
`[EVENT-03]` supplies nine partial notification inputs (several deliberately malformed).
None provides response/server-request/send/resolved capture files. `[CODEX-02/06/08]`
provide response predicates/error values and partial excerpts; `[CODEX-07]` has hashes
and procedure, **not full response bodies**. Full valid request/item shapes must be
schema-derived synthetic and labeled accordingly unless a new captured receipt exists.

Every JSON case uses `{fixtureVersion:1,evidenceClass:"synthetic"|"trace-excerpt"|
"captured",sourceRefs:[...],provenance:{...},cases:[...]}`; JSONL uses one such header
line followed by `{caseId,port,observationKey,transportId,receivedAt,input,expected}`
lines. Inputs are native envelopes for native ports and normalized DTOs for host ports;
expected fields name readItem/readOutcome/readUsage/read/cursor/ack or projection output.
Runtime fixtures use distinct `th`, `session`, `tu`, `item`, request IDs and the trace's
pinned installation digest; new captures record source SHA/binary/schema and redaction.
No fixture asserts that these invented IDs were measured.

Minimal synthetic five-boundary JSONL example (complete native payloads must satisfy the
pinned referenced schema before freezing; this shape defines the ledger boundary wrapper):

```jsonl
{"fixtureVersion":1,"evidenceClass":"synthetic","sourceRefs":["trace §5.3","CODEX-02"],"provenance":{"runtimeId":"codex","version":"0.139.0"}}
{"caseId":"response","port":"ingestResponse","observationKey":"obs-1","transportId":"t1","receivedAt":"2026-09-04T00:00:00.000Z","input":{"request":{"id":2,"method":"thread/resume","params":{"threadId":"th"}},"message":{"id":2,"result":{"thread":{"id":"th","sessionId":"session","ephemeral":false,"path":"/fixture/session.jsonl","cliVersion":"0.139.0","turns":[]}}}},"expected":{"subtype":"native_resume_validated"}}
{"caseId":"notification","port":"ingestNotification","observationKey":"obs-2","transportId":"t1","receivedAt":"2026-09-04T00:00:00.001Z","input":{"message":{"method":"thread/status/changed","params":{"threadId":"th","status":{"type":"idle"}}}},"expected":{"subtype":"thread_lifecycle"}}
{"caseId":"request","port":"ingestServerRequest","observationKey":"obs-3","transportId":"t1","receivedAt":"2026-09-04T00:00:00.002Z","input":{"message":{"id":8,"method":"item/tool/requestUserInput","params":{"threadId":"th","turnId":"tu","itemId":"item","questions":[]}}},"expected":{"subtype":"interaction_boundary","boundary":"request"}}
{"caseId":"send","port":"recordServerResponseSend","observationKey":"obs-4","transportId":"t1","receivedAt":"2026-09-04T00:00:00.003Z","input":{"requestId":8,"result":"sent"},"expected":{"subtype":"interaction_boundary","boundary":"response_send"}}
{"caseId":"resolved","port":"recordServerRequestResolved","observationKey":"obs-5","transportId":"t1","receivedAt":"2026-09-04T00:00:00.004Z","input":{"requestId":8,"message":{"method":"serverRequest/resolved","params":{"threadId":"th","requestId":8}}},"expected":{"subtype":"interaction_boundary","boundary":"resolved"}}
```

Response fixture contexts additionally supply expectedSessionId="session" and intent=resume;
malformed missing-field cases are explicitly marked invalid and assert the rejection path.
Schema-derived values may need required native fields beyond the excerpt; record those in
fixtures as synthetic, never attribute the completed body to EVENT-01..03 or CODEX-07.

- [ ] 7.1 `ingress-boundaries.jsonl`, `interaction-boundaries.jsonl`: the five port shapes
  above, request context with JSON-RPC id, all ten schema-derived request methods,
  send-failed and resolved variants; assert durable batch order/correlation and no FSM claim.
- [ ] 7.2 `items-assistant.jsonl`, `items-reasoning.jsonl`: assistant item
  `{type:"agentMessage",id:"msg",text:"hello"}` with deltas "hel", final "hello";
  prefix=mismatch "heX", missing-start and duplicate-key variants; reasoning completed
  `{type:"reasoning",id:"r",content:["analysis"],summary:["short","next"]}` with
  index-less native text/summary deltas and summaryPartAdded; normalized descriptors
  distinguish schema-proven index from absence and ledger-inferred channel/partIndex.
  Include no-boundary fallback (summary/0), inferred lossPossible=true, and a missing-ID
  observation with returned correlationKey accepted by readItem.
  Freeze normalized snapshot arrays at the decoder seam while also including the exact
  schema-derived native wrapper; assert the named persisted/readItem reconciliation fields.
- [ ] 7.3 `items-tools.jsonl`: started/completed `{threadId,turnId,item:{type,id,...}}`
  for commandExecution/mcpToolCall/dynamicToolCall/collabAgentToolCall/webSearch/imageView/
  imageGeneration/fileChange, native output/progress variants, missing start and repeated
  final; record exact expected item fields and suppression count (duplicate-final=1).
  Include lifecycle fixtures for userMessage, plan, hookPrompt, contextCompaction,
  enteredReviewMode and exitedReviewMode under native-dispositions.json.
- [ ] 7.4 `terminal-evidence.json`: use the full OutcomeEvidence shape in design, with
  retry error {code:"retryable",willRetry:true}, live terminal success/failure, denied,
  invalid-output, empty disallowed/allowed, credentialsSafe=false, cancel, interrupt,
  queued cancel and confirmed-dead-worker recovery; assert exact status/reasons/evidenceKeys.
  Recovery cases inject stale/fresh/null heartbeat, ESRCH/supervised exit, never-claimed,
  alive/EPERM/unknown host/claimed missing-PID and changed claim/heartbeat at commit;
  expect either one interrupted with confidence/basis or no settlement plus host diagnostic.
- [ ] 7.5 `transport-exit.jsonl`: exitCode=1, signal=SIGINT, transportId=t1 before
  completion, duplicate same-key and second-key exits, late turn/completed; assert one
  interrupted completed with provenance. A separate post-seal exit variant leaves the
  prior succeeded/failed terminal unchanged and records only a late diagnostic.
  A new native process belongs to a separate existing new Run; do not add a same-Run replacement window.
- [ ] 7.6 `usage.json`, `late-usage.jsonl`: normalized total/last vectors 10→20→duplicate
  20→25, baseline 100→108→hypothetical 3, two distinct call IDs with vector 10 and a
  duplicate call revision; late fixture total=20 → turn/completed → total=25,last=5
  during/after terminal file preparation, including failed preparation and delayed SQL
  commit; assert late records publish after the terminal slot and retain its reference.
  Assert delta.totalTokens, asOfSequence, sealed total=20 and payload.observation on late_event; reset/late order is synthetic inference.
- [ ] 7.7 `native-dispositions.json`, `unknown-method.json`, `codex-decode.json`: arrays
  `{method|itemVariant,input,expectedType,expectedSubtype,expectedSurface?}` covering
  exactly 66/10/16 from the inlined parity requirement, unknown future/example with secret
  params, malformed known cases, reasoning channel and error/usage vectors; assert no known→unknown fallback.
- [ ] 7.8 `store-faults.json`: operations `{op:append|deliver|ack|crash|reopen,key,
  failAt?:beforeCommit|afterCommit|afterDeliver}`, expected rows/highWater/cursors;
  duplicate observationKey retains committed fact keys and sequences, no fake native dedupe ID.
  Include two SQLite connections racing queued-cancel/start from the same high-water,
  both winner orders, conflict reload/re-reserve, idempotent resubmit, claimed-state check,
  unchanged-sequence retry without conflict and three-attempt exhaustion.
- [ ] 7.9 `resume-codex.jsonl`, `resume-claude.jsonl`: use CODEX-02 predicates, CODEX-06
  -32600 missing/malformed and -32603 corrupt error responses, CODEX-08 excerpts; synthetic
  unrelated JSON-RPC id, wrong thread and absent session; Claude correlated queryId,
  system/init session_id ordinary equality or new UUID fork, invalid/no-init and later
  auth failure and No conversation found. Assert native_resume_* neutral outcomes,
  no SESSION_EXPIRED or stream-error binding clear and no fabricated thread/started.
  Include CODEX-05 no-rollout race rejection without Run state change, preserving intent,
  observed response thread/target-turn status or their absence and raceContext. Add
  otherwise-valid ephemeral/missing-path/missing-cliVersion cases that remain validated
  with durableEvidence=false/lossPossible=true.
- [ ] 7.10 `snapshot-repair.json`: local assistant prefix "hel", recognized snapshot
  completed item "hello", source/target provenance and targetTurnId; assert fresh repair
  sequence/source/loss, item replacement, no terminal success and no native replay cursor.
  Include no-local-item → completed snapshot item with result=missing_local and lossPossible=true.
- [ ] 7.11 `snapshot-versions.json`: explicitly **synthetic** normalized full fixtures for
  the two CODEX-07 reported completed outputs/turn/usage/creator-version fields, with pinned
  per-file schema identities; incompatible schema is a defensive synthetic negative.
  If full native captures are acquired, freeze them as separate captured evidence, not
  prerequisite network/provider work for the independent Bun author. Include a local
  item absent from an authoritative pre-seal snapshot → missing_native/lossPossible=true,
  retaining unverified local text without inventing a native completion.
- [ ] 7.12 `snapshot-failed.json`: commit Locus durable error plus completed(failed) from
  the live CODEX-08 excerpt, reopen the Locus store, then repair with its degraded
  `{id:"tu",status:"completed",error:null,durationMs:18439}` snapshot; assert immutable
  failed outcome and late diagnostic. Also test no-durable-terminal snapshot → no success.
  There is no Locus rollout writer; the upstream write-layer negative is a runtime limitation.
- [ ] 7.13 `artifacts.json`, `terminal-artifacts.json`: temporary allowedRunDir, candidate
  path/ownerRunId/expectedSha256/media, valid file and five rejection variants; frozen
  terminal candidate/file preparation/commit faults from design's finite dependency graph.
  Assert SHA-256 bytes, manifest membership, commit visibility, immutable terminal snapshot.
- [ ] 7.14 `split-secrets.json`: memory-only hints "provider-secret-123" / "gateway-secret-456",
  split at each boundary across assistant/reasoning/command/tool channels, plus incomplete
  terminal prefix; assert absence in concatenated records/renderer/result/stderr and safe flush.
- [ ] 7.15 `identity-provenance.json`, `legacy-store.json`: runtime/locus-completion provenance
  variants plus never-started pending enqueue/worker-claim/queued-cancel/recovery cases;
  ledger_provenance_json stays null, runtime ingress before binding rejects, binding at
  executable resolution seals the tuple and all subsequent runtime records reference it,
  earlier pending records remain pending, post-terminal binding rejects and rebind/reopen
  cannot change the tuple.
  Include runtime-required-field omissions, distinct native IDs, missing turn for interrupt;
  historical desktop/API event rows with their original byte strings, missing provenance,
  no completed or unequal desktop runEventSequence, expected legacy_unverified marking.
- [ ] 7.16 `public-v1.json`, `public-vocabulary.json`, `public-results.json`,
  `public-artifacts.json`, `discovery.json`: source=api assistant payload {text:"hello"},
  source=desktop rejection, after=2/follow/late, all 21 types→12 with exact nine subtype
  names, redacted status stub, existing six-field envelope, result statuses/artifact refs,
  job.retryOfJobId/attempt and feature present/absent + experimental extension metadata.
  Preserve runtime_selected/runtime_selection_refused payload.runtime strings while adding
  payload.extensions["runtime.codex.v1"]. Discovery cases use the actual Locus discovery
  reader and generic absent-feature envelope contract, not an invented preflight helper.
  Assert no public job.ledger.historyQuality addition; only internal legacy readers mark it.
- [ ] 7.17 `projection.json`, `desktop-projection.json`, `headless-projection.json`,
  `desktop-request.json`, `normalized-output.json`, `vocabulary.json`, `coarse-process.json`,
  `architecture-fixtures.json`: precommitted RunEvent inputs and expected surface envelopes,
  direct schedules-style db.insert(agentJobEvents) violating source, fake ports/spies, validated request DTO and raw sentinel, every existing normalized type,
  vocabulary.json cases each have port=ingestRuntimeObservation|admitRunArtifactCandidate|
  settle (artifact/terminal cases must use their owner port); coarse process
  {kind,text,exitCode} descriptors, and source-file strings with exact
  expected static symbol/import findings; no fake behavioral assertion by a source scanner.
- [ ] 7.18 Register harness-conformance follow-up for actual 66-method dynamics, trailing
  usage/warnings, realtime/remote-control/process/Windows behavior, lost retransmission,
  in-flight death snapshot and Codex rollout failure persistence. Keep CODEX-08's observed
  negative result; do not require Locus to make Codex write a failed/error rollout record.

## 8. Verification, review and stop gates

- [ ] 8.1 Run all scenario tests against the frozen source; record red and green evidence
  plus temporary-SQLite/schema/reopen, artifact and cursor fault injection results.
- [ ] 8.2 Update docs/local-job-api-v1-consumer-guide.md, its zh-CN counterpart,
  docs/local-job-api-v1.schema.json and src/shared/local-job-api.ts in the implementing
  change for feature id, optional native metadata/maturity, exact status dispositions,
  snapshot usage, diagnostic errors, outcome/exit examples, artifact roles and late reads.
  Document payload.extensions["runtime.codex.v1"] and preserved payload.runtime strings;
  keep historyQuality internal. Extend the closed discoveryFeature schema enum and
  LOCAL_JOB_API_DISCOVERY_FEATURES together, and tell consumers pinning older schema
  copies to refresh them. State increased status-record volume, --after pagination and
  no bounded per-Run event-count assumption. Keep v1 requests/12 types unchanged;
  no unsupported extension-negotiation claim.
- [ ] 8.3 Audit every inventory row and terminal mint site, including job-event-bridge.ts,
  createAgentJobRunEvent, system appends, recovery, pre-start cancel, completion and Claude
  startup/state/job wiring, agent-jobs.ts queued cancel, schedules.ts direct event INSERT
  and desktop-runner.ts sequence=0 startup event. Update OWNERSHIP_MAP for provenance
  capture, recovery liveness and Claude neutral diagnostics; explicitly split ownership:
  agent-runtime/run-artifacts.ts validates/prepares/writes files, while the local-job-api
  capability and headless/local-job-api.ts serializers own the v1 paths/roles/schema and
  consumer contract (writer consumes those definitions, never forks them). Update architecture pins; all five old raw
  writer allowlist entries disappear, leaving only the host's exact store adapter import.
- [ ] 8.4 Delete canonicalRunEventLedgerV1/legacy branch/transition guard mode before the
  final source freeze; re-run static guards and scenario tests. A later source edit
  invalidates verification and independent review.
- [ ] 8.5 Run bun run check:full plus exact strict validate and git diff --check; execute
  Desktop/Workbench Claude+Codex, headless exec/app-server/completion and API create/events/
  follow/result/retry/artifact smoke in disposable profiles. Record macOS/Windows packaged
  evidence when available/required; do not claim host-blocked smoke passed. No native
  conformance inference or fixture substitutes for actual runtime/packaged receipts.
- [ ] 8.6 Bind Codex IMPLEMENTATION_VERIFIED and fresh-context Claude REVIEW_APPROVED to
  the same exact implementing source SHA, record consumer-owned E2E status separately,
  then stop for Owner ACCEPTED; DRAFT verification does not satisfy these product gates.
- [ ] 8.7 No merge, push, remote PR mutation or release is authorized by this dispatch;
  future external action requires explicit Owner authorization for its exact scope/SHA.

## Reproducible draft validation

From this worktree, if dependencies are not installed, the existing main checkout's
pinned OpenSpec 1.10.0 binary can be used without changing package/lock files:

```bash
PATH=/home/chen/projects/agent-code-for-me/node_modules/.bin:$PATH bun x openspec validate refactor-canonical-run-event-ledger --strict --no-interactive
PATH=/home/chen/projects/agent-code-for-me/node_modules/.bin:$PATH openspec validate --all --strict --no-interactive
git diff --check
```

A direct equivalent is
`/home/chen/projects/agent-code-for-me/node_modules/.bin/openspec validate refactor-canonical-run-event-ledger --strict --no-interactive`.
Exact executions and environment belong in verification.md, not a claim that future
implementation/scenario smoke has already passed.
