# Red Receipt — refactor-canonical-run-event-ledger

Auditor: fresh-context red-suite auditor (not an author, not the implementer).
Audit date: 2026-10-01. Worktree: `/home/chen/projects/locus-refactor-canonical-run-event-ledger-draft`.

**Base SHA: `e1370a78` (`e1370a7801360b74e72eaa8c875539e51ba9fd1d`)** — every count and every red
reason below was re-run by the auditor on this SHA with `bun test --isolate <file>` (bun 1.3.14).
Product source is untouched; the authors' files are untracked additions under `tests/` only.

**Verdict: RED_SUITE_ACCEPTED** (zero P1 in the authored suite; P2/P3 findings and a coverage
debt register are recorded below). Auditor edits to the authors' files: **none**.

## 1. Immutable file list (the red suite)

Test files and helpers (8):

| File | Role |
| --- | --- |
| `tests/run-event-ledger-core.test.ts` | Domain A: S10, S14, S31, S42, S50 (nine-type subset) |
| `tests/run-event-ledger-reconciliation.test.ts` | Domain A: S18, S19, S20, S25, S26, S27 |
| `tests/run-event-ledger-test-harness.ts` | Domain A helper (fixture loaders, in-memory durableStore, clock, no-op artifactOwner) |
| `tests/run-event-ledger-terminal.test.ts` | Domain B: S21–S25, S28, S29, S56 |
| `tests/run-event-ledger-provenance-resume.test.ts` | Domain B: S15, S33–S37 |
| `tests/run-event-ledger-domain-b-kit.ts` | Domain B helper (MemoryDurableStore, migrated temp SQLite, clock) |
| `tests/run-event-ledger-projection.test.ts` | Domain C: S44–S55 |
| `tests/run-event-ledger-guards.test.ts` | Domain C: S38–S40, S13, S15 (row facet) |

Fixtures under `tests/fixtures/run-event-ledger/` (27; all carry the tasks §7 header
`fixtureVersion:1 / evidenceClass / sourceRefs / provenance`):

`architecture-fixtures.json`, `artifacts.json`, `desktop-projection.json`, `discovery.json`,
`headless-projection.json`, `identity-provenance.json`, `ingress-boundaries.jsonl`,
`items-assistant.jsonl`, `items-reasoning.jsonl`, `items-tools.jsonl`, `late-usage.jsonl`,
`legacy-migration.json`, `native-dispositions.json`, `public-artifacts.json`,
`public-results.json`, `public-v1.json`, `public-vocabulary.json`, `resume-claude.jsonl`,
`resume-codex.jsonl`, `snapshot-failed.json`, `snapshot-repair.json`, `snapshot-versions.json`,
`store-faults.json`, `terminal-evidence.json`, `transport-exit.jsonl`, `unknown-method.json`,
`usage.json`.

Not present (named by spec/tasks §7, no test consumes them): `vocabulary.json`,
`normalized-output.json`, `projection.json`, `coarse-process.json`, `desktop-request.json`,
`interaction-boundaries.jsonl`, `split-secrets.json`, `terminal-artifacts.json`,
`codex-decode.json`, `legacy-store.json` (see coverage debt, §6).

## 2. Per-file counts on e1370a78 (auditor re-run, reconciled with the three author reports)

| File | Tests | RED | GREEN (by design) | Author-reported |
| --- | ---: | ---: | ---: | --- |
| run-event-ledger-core.test.ts | 13 | 12 | 1 | 13 / 12 / 1 (matches) |
| run-event-ledger-reconciliation.test.ts | 22 | 22 | 0 | 22 / 22 / 0 (matches) |
| run-event-ledger-terminal.test.ts | 20 | 19 | 1 | 20 / 19 / 1 (matches) |
| run-event-ledger-provenance-resume.test.ts | 22 | 22 | 0 | 22 / 22 / 0 (matches) |
| run-event-ledger-projection.test.ts | 23 | 10 | 13 | 23 / 10 / 13 (matches) |
| run-event-ledger-guards.test.ts | 15 | 13 | 2 | 15 / 13 / 2 (matches) |
| **Total** | **115** | **98** | **17** | A 35/34/1, B 42/41/1, C 38/23/15 (all match) |

Red composition: 33 reds are real behavior gaps reached through **existing** entry points;
65 reds are contract-absence reds for the design-named NEW modules
(`agent-runtime/run-event-ledger.ts` ×64, `agent-runtime/run-provenance.ts` ×1), loaded lazily
per test so each test fails individually. Spot-checked commands:

```
bun test --isolate tests/run-event-ledger-core.test.ts                # 1 pass, 12 fail
bun test --isolate tests/run-event-ledger-reconciliation.test.ts      # 0 pass, 22 fail
bun test --isolate tests/run-event-ledger-terminal.test.ts            # 1 pass, 19 fail
bun test --isolate tests/run-event-ledger-provenance-resume.test.ts   # 0 pass, 22 fail
bun test --isolate tests/run-event-ledger-projection.test.ts          # 13 pass, 10 fail
bun test --isolate tests/run-event-ledger-guards.test.ts              # 2 pass, 13 fail
```

Tooling: `biome check` on all 8 TS files + fixture dir → 0 errors (2 `noExplicitAny` warnings
on the `type Json = any` alias in the two Domain C files, 1 info). `tsconfig` includes only
`src/**`, so the test files are not part of `ts:check`. The repository `test` script already
uses `--isolate`, which is what the two `mock.module("electron")` files (a convention shared by
46 existing tests) rely on.

## 3. Per-test red reasons (98)

Legend — **CONTRACT**: fails with `Cannot find module` for a design-named NEW module; the
"behavior gap" column is the assertion the test will pin once the module exists.
**REAL-GAP**: fails on an assertion through an existing entry point (observed message quoted).

### 3.1 tests/run-event-ledger-core.test.ts (12 RED)

| Scenario | Test (short) | Observed red | Behavior gap pinned |
| --- | --- | --- | --- |
| S10 | five ports commit one dense batch-ordered fact chain | CONTRACT run-event-ledger | No single ingest owner; adapter/mapper/job-store each allocate sequence; serverRequest/send/resolved never reach a durable trace (trace §6). |
| S10 | resubmitting an observationKey returns the prior batch | CONTRACT run-event-ledger | Baseline job-store has no fact key; a retried handoff appends a new row via nextEventSequence. |
| S14 | thread/session/turn/item/request/call land redacted in `payload.extensions["runtime.codex.v1"]` | CONTRACT run-event-ledger | Baseline canonical payloads drop threadId/turnId/requestId/callId (EVENT-03); no extension namespace. |
| S14 | unavailable sessionId is omitted, never filled from threadId | CONTRACT run-event-ledger | Baseline app-server-adapter back-fills sessionId from threadId (trace §3.2). |
| S31 | future method becomes status/unknown_native_method with lossPossible | CONTRACT run-event-ledger | Baseline mapper default branch returns `[]` for unknown methods. |
| S31 | malformed known method becomes warning/invalid_native_shape | CONTRACT run-event-ledger | Baseline mapper has no shape validation. |
| S42 | every non-terminal notification (65) commits its table disposition; deferred surfaces observed_deferred; capability manifest unchanged | CONTRACT run-event-ledger | Baseline decodes 11/66 notifications; 55 project to `[]`. |
| S42 | turn/completed is only a terminal candidate settled by settle() | CONTRACT run-event-ledger | Baseline maps turn/completed straight to a completed chunk with no settlement evidence. |
| S42 | all 10 server requests commit status/interaction_boundary(request) | CONTRACT run-event-ledger | Baseline handles server requests online only; none enters the trace. |
| S42 | all 16 ThreadItem variants map started/completed through the item table | CONTRACT run-event-ledger | Baseline item/started and item/completed return `[]` for all variants. |
| S42 | decodeCodexNativeBoundary is exported, stateless, never empty for a known method | REAL-GAP `expect(typeof decode).toBe("function")` — received `"undefined"` | `app-server-stream-events.ts` exports only the stateful `createCodexAppServerRuntimeEventMapper`. |
| S50 | nine coerced internal types become status with `payload.subtype` = internal name | REAL-GAP `toEqual` — subtype is `undefined` for all nine | `toLocalJobApiEventEnvelope` coerces type to `status` but leaves payload unchanged. |

### 3.2 tests/run-event-ledger-reconciliation.test.ts (22 RED)

| Scenario | Test (short) | Observed red | Behavior gap pinned |
| --- | --- | --- | --- |
| S18 | exact variant ("hel"+"lo" → "hello", matched, 2 deltas) | CONTRACT run-event-ledger | Baseline drops the item/completed(agentMessage) snapshot; no readItem/reconciliation carrier. |
| S18 | prefix variant ("hel" → "hello", suffix_repaired) | CONTRACT run-event-ledger | Baseline keeps "hel"; no suffix repair. |
| S18 | mismatch variant ("heX" → "hello", mismatch, lossPossible) | CONTRACT run-event-ledger | Baseline keeps "heX"; no mismatch marker. |
| S18 | missing-start variant (missingStart/lossPossible) | CONTRACT run-event-ledger | No item state machine. |
| S18 | gap variant ("he"+"lo" → mismatch/lossPossible) | CONTRACT run-event-ledger | Lost middle delta undetected on baseline (trace §6). |
| S18 | duplicate-key variant (same observationKey twice emits nothing new) | CONTRACT run-event-ledger | Baseline has no handoff key; retried delta appended twice. |
| S18 | out-of-order-start variant | CONTRACT run-event-ledger | No lifecycle tolerating a late item/started. |
| S18 | missing-native-ID variant returns distinct correlationKeys; equal text never merges | CONTRACT run-event-ledger | No observation-local correlationKey; no addressable ID-less item state. |
| S19 | index-less text/summary deltas use text/0 and last summaryPartAdded boundary; reconcile to analysis/short/next (indexSource=inferred, lossPossible) | CONTRACT run-event-ledger | Baseline folds textDelta and summaryTextDelta into one chunk, drops summaryPartAdded and the completed reasoning item. |
| S19 | no-boundary variant (summary/0 fallback, streaming) | CONTRACT run-event-ledger | No summary/0 fallback, no indexSource. |
| S19 | duplicate variant (dup handoff + repeated completed → suppressedDuplicateCount=1) | CONTRACT run-event-ledger | No dedupe/suppression counter. |
| S19 | missing-part variant (summary/1 missing_local) | CONTRACT run-event-ledger | Unseen summary part never marked missing_local. |
| S19 | overlap variant ("analy" → "analysis" suffix_repaired) | CONTRACT run-event-ledger | No suffix repair. |
| S19 | out-of-order variant (delta after completion never re-appends) | CONTRACT run-event-ledger | Baseline appends every delta blindly. |
| S20 | each of the eight tool variants yields one tool_started/tool_finished, keeps progress, authoritative fields | CONTRACT run-event-ledger | Baseline emits no tool_started/tool_finished; command/MCP progress dropped. |
| S20 | repeated final emits no second tool_finished; suppressedDuplicateCount=1 | CONTRACT run-event-ledger | No item-keyed dedupe. |
| S20 | missing start exposes missingStart/lossPossible; at most one tool_started | CONTRACT run-event-ledger | No reconciliation fields. |
| S25 | after-settle: sealed total stays 20; later usage(25/5)/warning/repeated terminal are status/late_event with terminalSequence | CONTRACT run-event-ledger | No seal; trailing tokenUsage mutates mapper usage state. |
| S25 | during-preparation: same, arrivals before settle | CONTRACT run-event-ledger | No post-terminal reservation / late_event carrier. |
| S26 | cumulative 10,20,20(dup),25 → unique snapshot payloads 10/20/25, last 10/10/5, readUsage 25 | CONTRACT run-event-ledger | usage_update payload is only `{messageMetadata}`; no kind/total/last/dedupeKey. |
| S26 | per-call: two call IDs ×10 → 20; retransmit does not increase | CONTRACT run-event-ledger | completion-runner appends raw per-call usage without accumulation/dedupe. |
| S27 | baseline 100 (repairFromSnapshot) → 108 delta 8 → 3 discontinuity, no negative delta | CONTRACT run-event-ledger | No repairFromSnapshot/baseline/delta/discontinuity. |

### 3.3 tests/run-event-ledger-terminal.test.ts (19 RED)

| Scenario | Test (short) | Observed red | Behavior gap pinned |
| --- | --- | --- | --- |
| S21 | retryable error stays diagnostic (classification/willRetry/code/native ids); one completed(succeeded) survives reopen | CONTRACT run-event-ledger | Mapper drops willRetry/code (EVENT-03); any error chunk treated as failure. |
| S22 | 8-row settle table (denial/output-invalid/empty-not-allowed → failed; empty-allowed → succeeded; credential-failed → failed; cancel; interrupt; missing output evidence → not succeeded) | CONTRACT run-event-ledger | No OutcomeEvidence owner; default-success today. |
| S23 | exit before completion → one completed(interrupted) with synthetic transport_exit/t1/1/SIGINT + installation provenance; duplicate/second exit and late turn/completed → late_event; no replacement port | CONTRACT run-event-ledger | No synthetic transport-exit terminal owner. |
| S23 | post-seal exit keeps prior succeeded/failed terminal; only a late_event | CONTRACT run-event-ledger | Same. |
| S24 | host cancel/recovery evidence ports commit job mutation + one completed atomically; pending vs sealed tuple; repeated settle adds no terminal | CONTRACT run-event-ledger | No settle owner. |
| S24 | CLI `jobs cancel` / `api runs cancel` of queued jobs → one completed(canceled), synthetic.source=cancel, ledger_version=1, ledger_provenance_json null | REAL-GAP `toEqual` — no `synthetic.source`; `ledger_version`/`ledger_provenance_json` undefined | cancelApiJob/jobs cancel call raw completeAgentJob; columns absent. |
| S24 | job-recovery settles only confirmed-stopped stale workers (ESRCH stale, ESRCH null heartbeat, never-claimed) with completed(interrupted), synthetic.source=recovery, confidence=confirmed+basis | REAL-GAP `toEqual` — 0 completed, error-only interrupted mint | interruptStaleAgentJobs mints an error record only; no PID probe. |
| S24 | alive (signal-0), EPERM (pid 1), claimed-without-PID stale rows stay running with no appended record | REAL-GAP `toEqual` — all three become interrupted with worker_interrupted | Baseline is heartbeat-only. |
| S24 | repeated recovery of a confirmed-dead worker leaves exactly one completed | REAL-GAP `toHaveLength(1)` — received 0 | Baseline mints no completed at all. |
| S24 | v0 drain gate: ledger_version=0 stale running row never written by the new recovery owner | REAL-GAP `expect(job.ledger_version).toBe(0)` — undefined | No migration adds ledger_version; baseline would append to the legacy row. |
| S25 | seal ordering: arrivals after turn/completed but before settle stay unpublished until the terminal commit, then commit after the terminal slot | CONTRACT run-event-ledger | No seal / reservation. |
| S28 | valid candidate → artifact_created with sha256/sizeBytes/contentType before completed; ref in committed manifest refs | CONTRACT run-event-ledger (and run-artifacts) | No canonical artifact owner. |
| S29 | five rejection reasons → status/artifact_admission(rejected, reason), no artifact_created, no manifest entry, no secret path/content | CONTRACT run-event-ledger (and run-artifacts) | Same. |
| S56 | cancel-first: host B commits canceled; host A's stale start reloads, never commits job_started; ≤3 attempts | CONTRACT run-event-ledger | withEventSequenceRetry (5 attempts, no reload) is today's mechanism. |
| S56 | start-first: B's stale queued cancel → cancel_requested status only; resubmit idempotent | CONTRACT run-event-ledger | Same. |
| S56 | retry exhaustion: competing commit before every attempt → LEDGER_APPEND_CONFLICT after exactly 3 attempts; nothing committed | CONTRACT run-event-ledger | No LEDGER_APPEND_CONFLICT. |
| S56 | definite rollback without competing commit retries unchanged sequence (2 attempts, sequence 1) | CONTRACT run-event-ledger | Same. |
| S56 | two SQLite connections, cancel-first: CLI cancel commits completed(canceled, synthetic.source=cancel); start rejected; every row has fact_key | REAL-GAP `toBe` — synthetic.source undefined; no fact_key column | Columns/ledger absent. |
| S56 | two SQLite connections, start-first: losing cancel only sets cancel_requested_at; every row has fact_key | REAL-GAP `toEqual` — rows lack fact_key | Ordering already holds; fact_key column absent. |

### 3.4 tests/run-event-ledger-provenance-resume.test.ts (22 RED)

| Scenario | Test (short) | Observed red | Behavior gap pinned |
| --- | --- | --- | --- |
| S15 | pending facts stay pending; native input before binding rejected; bindExecutionProvenance seals once; later records reference it; reopen preserves; rebind rejected | CONTRACT run-event-ledger | No execution provenance on any record today. |
| S15 | any of the 9 required runtime tuple fields missing → construction and binding rejected before publication; pending needs no digest | CONTRACT run-event-ledger | Same. |
| S15 | locus-completion variant records locusBuild, claims no binary/installation | CONTRACT run-event-ledger | Same. |
| S15 | never-started pending ledgers (queued cancel, recovery) settle with null provenance; binding after seal rejected | CONTRACT run-event-ledger | Same. |
| S15 | createAgentJob/startAgentJob/CLI queued cancel write v1 rows with fact_key and pending record_metadata_json; ledger_provenance_json stays null | REAL-GAP `toEqual` — ledger_version undefined, fact_key/record_metadata_json absent | No columns, no ledger-routed lifecycle appends. |
| S15 | captureRunExecutionProvenance hashes the executable resolved by resolveBundledCodexCliPath + sorted per-file schema fingerprints; repeatable, tamper-sensitive, opaque executableRef | CONTRACT run-provenance (resolution seam already passes) | No provenance capture owner. |
| S33 | early status stays thread_lifecycle; only matching JSON-RPC success → native_resume_validated (jsonRpcId 2, th/th, session, ephemeral false, cliVersion, intent, observedThreadStatus, durableEvidence true); unrelated id → protocol_response correlated=false; no thread/started | CONTRACT run-event-ledger | Adapter accepts any thread id and fabricates thread/started (trace §3.2). |
| S33 | wrong-thread / absent-session / -32600 ×2 / -32603 → native_resume_rejected with reason + native code; never validated/expired | CONTRACT run-event-ledger | Same. |
| S33 | ephemeral / missing-path / missing-cliVersion stay validated with durableEvidence=false, lossPossible=true | CONTRACT run-event-ledger | Same. |
| S33 | CODEX-05 no-rollout beside turn/start → rejected with raceContext=start_resume_no_rollout, intent attach, code -32600; readOutcome null | CONTRACT run-event-ledger | Same. |
| S34 | ordinary/fork validated; fork-same-id, mismatched init, pre-init result, no-init, No conversation found → rejected; init from another query validates nothing | CONTRACT run-event-ledger | No Claude init-correlation fact recorder. |
| S34 | later auth failure leaves one unchanged validation fact; no rejection/terminal | CONTRACT run-event-ledger | Same. |
| S34 | No conversation found rejection carries sanitized diagnostic without SESSION_EXPIRED/expiry wording | CONTRACT run-event-ledger | Same. |
| S34 | classifyClaudeAgentSdkStreamError maps No conversation found → NATIVE_RESUME_REJECTED | REAL-GAP `toBe` — returns `SESSION_EXPIRED` | agent-sdk-errors.ts:129–138 upgrades to SESSION_EXPIRED. |
| S34 | finalizeClaudeAgentSdkStreamError keeps sessionId, code NATIVE_RESUME_REJECTED, no expiry wording | REAL-GAP `toEqual` — code SESSION_EXPIRED, sessionId cleared to null, "expired" emitted | stream-error-finalization.ts:130–132 clears sub_chats.session_id. |
| S35 | "hel" + snapshot "hello" → suffix_repaired; fresh status/repair (source=snapshot, lossPossible); readOutcome null | CONTRACT run-event-ledger | No snapshot repair owner. |
| S35 | snapshot item with no local item → missing_local, authoritative text, lossPossible | CONTRACT run-event-ledger | Same. |
| S36 | durable failed(401) survives reopen + CODEX-08 completed/error-null snapshot → late_event repair diagnostic | CONTRACT run-event-ledger | Same. |
| S36 | no durable terminal: snapshot cannot settle; later transport exit → interrupted | CONTRACT run-event-ledger | Same. |
| S37 | 0.139↔0.149 recognized snapshots keep final text, creator version, both fingerprints at fresh sequence | CONTRACT run-event-ledger | Same. |
| S37 | incompatible-schema snapshot → mismatch/lossPossible, no guessed item state | CONTRACT run-event-ledger | Same. |
| S37 | pre-seal local item absent from snapshot → missing_native/lossPossible, unverified local text | CONTRACT run-event-ledger | Same. |

### 3.5 tests/run-event-ledger-projection.test.ts (10 RED)

| Scenario | Test (short) | Observed red | Behavior gap pinned |
| --- | --- | --- | --- |
| S48 | runtime-backed records carry `payload.extensions["runtime.codex.v1"]`; pending runtime_selected keeps payload.runtime and is not retroactively extended | CONTRACT run-event-ledger | No extension emitted anywhere. |
| S50 | 21 types + redacted stub keep contiguous sequences, map to exactly 12 public types, nine coerced carry subtype | REAL-GAP `toEqual` — guard_decision payload lacks `subtype` | Serializer leaves coerced payloads unchanged. |
| S51 | R1 r1-zero-output-default-success → failed / exit 1 / reasons | REAL-GAP `toBe` — exit 0 / succeeded | job-runner trusts the runner's default success with no output. |
| S51 | R1 r1-recorded-denial-default-success → failed / exit 1 / reasons | REAL-GAP `toBe` — exit 0 / succeeded | Recorded permission_requested decision=deny ignored. |
| S55 | discovery advertises canonical-run-ledger; schema documents runtime.codex.v1 with schemaVersion=1/maturity=experimental | REAL-GAP `toContain` — features are only runtime-readiness/provider-binding/completion | Feature id and schema extension absent. |
| S46 | committed app-server records consumed without a second observer append or extra terminal mint | REAL-GAP `toEqual` — every non-completed record re-appended through observer.appendEvent | headless/adapters/codex-app-server.ts appendTraceEvent duplicates records and suppresses completed. |
| S46 | coarse assistant/command/status/error/result observations persisted once with fact_key and record_metadata_json, one completed | REAL-GAP `SQLiteError: no such column: fact_key` | Columns absent; raw append path. |
| S47 | jobs logs / runs events return documented envelopes in sequence with bare payloads; rows retain record metadata | REAL-GAP `SQLiteError: no such column: record_metadata_json` | Readers already bare; metadata column absent. |
| S44 | projectRunEventToRendererChunks replaces the reconciled item instead of appending final text | REAL-GAP `expect(typeof …).toBe("function")` — undefined | stream-event-mapper.ts exports only chunk→RunEvent mappers. |
| S45 | desktop writer/renderer projections receive only committed redacted records; never the raw sentinel or hints | CONTRACT run-event-ledger | No ledger delivering committed records to projections. |

### 3.6 tests/run-event-ledger-guards.test.ts (13 RED)

| Scenario | Test (short) | Observed red | Behavior gap pinned |
| --- | --- | --- | --- |
| S38 | every pinned symbol defined only in its owner and re-exported nowhere | REAL-GAP `toEqual` — createCanonicalRunEventLedger, getOrCreateRunEventLedger, projectRunEventToRendererChunks, admitRunArtifactCandidate, appendExactRunEventBatch, captureRunExecutionProvenance defined nowhere | New owners absent. |
| S38 | OWNERSHIP_MAP "Runtime Events, Trace, And Redaction" pins ledger/host/provenance/artifact owners; map records decoder/ingress/recovery rows | REAL-GAP `toEqual` — section names only runtime-events.ts and redaction.ts | Docs not updated. |
| S39 | appendExactRunEventBatch referenced only by job-store and run-event-ledger-host.ts | REAL-GAP `toEqual` — no file references it; host file absent | Not implemented. |
| S39 | eleven legacy exports/helpers have no definitions/re-exports/call sites; job-event-bridge.ts deleted | REAL-GAP `toEqual` — 25 residues (stream-event-mapper.ts nine mapper symbols + persistedPayloadForRunEvent, job-event-bridge.ts createAgentJobRunEvent, appendAgentJobEvent used by job-runner/cli-dispatcher/completion-runner/desktop-agent-jobs) | Legacy paths present. |
| S39 | no db.insert(agentJobEvents) outside headless/job-store.ts (incl. schedules bypass) | REAL-GAP `toEqual` — schedules.ts:346 inserts job_created sequence=1 | Bypass present. |
| S39 | job-store exports appendExactRunEventBatch; record insert helper stays private | REAL-GAP `toBe` — not exported; legacy appendAgentJobEvent still exported | Not implemented. |
| S39 | runEventSequence confined to the single versioned Workbench reader | REAL-GAP `toHaveLength(1)` — 2 files (workbench-trace-presenter.ts + stream-event-mapper.ts writer) | Wrapper writer still live. |
| S40 | guard consumes architecture-fixtures.json and its self-test passes | REAL-GAP `toBe(true)` — guard source does not read the fixture path | Guard self-test covers inline strings only. |
| S13 | migration labels pre-ledger jobs ledger_version=0; bytes/IDs/sequences unchanged; no fabricated fact keys/provenance/completed | REAL-GAP `toContain` — agent_jobs has no ledger_version/ledger_provenance_json/ledger_sealed_sequence | No migration after 0023. |
| S13 | migrated store enforces v1 fact-key + single-completed uniqueness, keeps historical duplicate terminal bytes, adds cascading agent_job_projection_cursors | REAL-GAP `SQLiteError: table agent_jobs has no column named ledger_version` | Same. |
| S15 | never-started API run refused at runtime selection is a v1 job, null provenance, sealed at its one completed | REAL-GAP `SQLiteError: no such column: ledger_version` | Same. |
| S15 | queued job canceled before start keeps null provenance, sealed at one completed | REAL-GAP `SQLiteError: no such column: ledger_version` | Same. |
| S15 | executed provider-only completion binds a locus-completion tuple (no binary/installation) | REAL-GAP `SQLiteError: no such column: ledger_version` | Same. |

## 4. Green-by-design (17 — characterization guards that must keep passing)

| File | Test |
| --- | --- |
| core | S42 — fixture enumerates exactly the trace's 66 notifications, 10 requests and 16 item variants (auditor re-verified: sets equal trace §5.2–5.4; expected dispositions match the parity table row-for-row; `serverRequest/resolved` enters through `recordServerRequestResolved`; `turn/completed` is flagged terminalCandidate) |
| terminal | S24 — [green-by-design] a heartbeat exactly 120 s old is not stale (strict-less-than predicate the design keeps) |
| projection | S48 — runs events --after=2 returns only later bare envelopes |
| projection | S48 — pre-binding runtime_selection_refused keeps string payload.runtime, no extension |
| projection | S48 — source=desktop job rejected by getLocalJobApiEvents and runs events |
| projection | S48 — admitted initial artifact_created precedes job_started on API create and retry |
| projection | S49 — follow exits at terminal, one JSON envelope per stdout line; explicit later read returns seeded late_event rows without another completed or altered result |
| projection | S51 — committed outcomes serialize status/runtime/mode/consumer/diagnostics/manifest and the status-derived exit code without secrets |
| projection | S51 — retryable diagnostic then live success stays succeeded/exit 0, no secret |
| projection | S51 — runs status on the retry job links retryOfJobId/attempt |
| projection | S52 — run-dir files exist with matching SHA-256, frozen terminal prefix, digests unchanged by later diagnostics |
| projection | S53 — discovery advertises runtime-readiness with per-runtime readiness objects |
| projection | S54 — envelope without a feature id is a valid v1 discovery envelope; addition reads as unsupported |
| projection | S44 — Workbench persisted-event reader reads committed v1 records at their sequence with bare payload incl. item_reconciliation |
| projection | S45 — single versioned Workbench decoder unwraps a ledger_version=0 historical desktop wrapper row |
| guards | S39 — no transitional canonicalRunEventLedgerV1 gate / run-event-ledger-phase remains in src/ or scripts/ (end state; will go red while the build-time gate exists and must return green before acceptance) |
| guards | S13 — public job/result/event envelopes of a migrated legacy API job expose no historyQuality / job.ledger and keep historical payloads and sequences |

## 5. Coverage matrix S01–S56

Status: **covered** / **partial** (a named clause is not asserted) / **missing** (authorable now
against design-named seams, no test exists) / **implementer-unit** (needs a seam the design does
not name). Totals: 35 covered, 8 partial, 9 missing, 4 implementer-unit.

| ID | Scenario | Status | Covered by / reason |
| --- | --- | --- | --- |
| S01 | Event type is emitted (vocabulary.json) | missing | Authorable: ledger ports + admitRunArtifactCandidate + settle, read(0) = 21 types. No fixture. |
| S02 | Runtime emits assistant output (normalized-output.json) | missing | Authorable via ingestRuntimeObservation + read(0). |
| S03 | Runtime emits tool activity | missing | Authorable via ingestRuntimeObservation + read(0). |
| S04 | Runtime reports completion (runner facade result references committed completed sequence) | implementer-unit | The facade return value (job-runner internal result) is not reachable through a public entry; S51 R1 tests cover only public status/exit. |
| S05 | Event is serialized for CLI (projection.json; stdout JSON vs stderr diagnostic) | missing | Authorable against the existing stream-json serializer; likely green-by-design. |
| S06 | Headless process emits coarse output (coarse-process.json) | partial | projection S46 (coarse rows persisted via ledger store port). The "returned normalized records preserve coarse source / no invented native identity" half needs the ledger-ingress.ts function name (unnamed) → implementer-unit. |
| S07 | Event compatibility is required (protocol/CLI/v1 serializers, same sequence) | partial | projection S47 (jobs logs + runs events same sequence) and S50 (v1 serializer). Protocol (tRPC/IPC) serializer not asserted; authorable. |
| S08 | Adapter receives desktop request (desktop-request.json incl. ledger ingress/trace ports) | implementer-unit | Port names on the desktop request are not named by design. |
| S09 | Adapter emits normalized events (fake desktop adapter through injected ports) | implementer-unit | No injection option for the host-composed ledger on desktop-runner is named. |
| S10 | All protocol boundaries enter one ledger | covered | core ×2 |
| S11 | Durable append fails before acknowledgement | missing | Authorable now: in-memory appendExact throw + projections deliver/ack (design ports); SQLite half via `appendExactRunEventBatch` + `getOrCreateRunEventLedger` (named). store-faults.json has only S56 raceCases. **Top coverage debt.** |
| S12 | Process crashes after commit and before projection | missing | Authorable now (reopen over the same in-memory/SQLite store, cursor/ack). **Top coverage debt.** |
| S13 | Historical rows remain explicitly unverified | partial | guards ×3 (labeling, bytes, constraints, public envelopes) + terminal S24 v0-drain. Not asserted: ledger-API append rejection on a v0 store; internal `historyQuality=legacy_unverified` reader (no reader named). Fixture is `legacy-migration.json`, not the spec-named `legacy-store.json`. |
| S14 | Distinct native identities are preserved | covered | core ×2 |
| S15 | Exact runtime provenance follows every event | covered | provenance-resume ×6, guards ×3 |
| S16 | Interrupt target comes from native Run state (readNativeContext) | missing | Authorable now: `readNativeContext()` is in the Test-facing Contract; `identity-provenance.json` already carries `interrupt-target` and `interrupt-target-missing-turn` cases (unconsumed). |
| S17 | Runtime splits an exact secret across adjacent events (split-secrets.json) | missing | Authorable now: secretHints + ingestRuntimeObservation across channels + settle + projectRunEventToRendererChunks; `redaction.appliedRules` in record metadata. **Top coverage debt.** |
| S18 | Assistant deltas reconcile with final snapshot | covered | reconciliation ×8 |
| S19 | Reasoning channels and parts reconcile separately | covered | reconciliation ×6 (native-index variant deferred to tasks 1.4) |
| S20 | Tool item lifecycle is incomplete or repeated | covered | reconciliation ×3 |
| S21 | Retry error is followed by success | covered | terminal ×1 |
| S22 | Denial rejection and empty output have deterministic outcomes | covered | terminal ×1 (8-row table) |
| S23 | Transport exit synthesizes one terminal | covered | terminal ×2 |
| S24 | Pre-start cancel and dead-worker recovery settle through ledger | covered | terminal ×7 (supervisor-observed-exit basis, unknown host, changed claim/heartbeat at commit, heartbeat_only diagnostic content → implementer-unit sub-items) |
| S25 | Usage after completed is diagnostic only | partial | reconciliation ×2 + terminal ×1 (seal, late_event shape, during-preparation ordering). "Preparation failure keeps one failed terminal in the slot" needs artifactOwner prepare/fail hook names → implementer-unit. |
| S26 | Usage snapshots are accumulated once | covered | reconciliation ×2 |
| S27 | Resume establishes a usage baseline | covered | reconciliation ×1 |
| S28 | Valid artifact candidate is admitted | covered | terminal ×1 |
| S29 | Invalid artifact candidate is rejected | covered | terminal ×1 |
| S30 | Terminal files and completed become visible together (terminal-artifacts.json) | partial | projection S52 (green) covers events.jsonl-contains-completed-once, result/manifest refs, digests unchanged by late diagnostics. Fault injection before preparation / before SQL commit / after commit-before-projection needs hook names → implementer-unit. |
| S31 | Unknown native method is observed | covered | core ×2 |
| S32 | Interaction boundary is recorded without a second state machine (interaction-boundaries.jsonl) | partial | core S10 (request/response_send/resolved boundaries) + S42 (10 requests). Missing: send `failed` variant and the "no payload claims a durable Interaction / grants execution" negative; authorable now. |
| S33 | Codex response validates the requested native thread | covered | provenance-resume ×4 (observedTargetTurnStatus not asserted: design does not say how the target turn is identified) |
| S34 | Claude correlated init validates resume independently of turn success | covered | provenance-resume ×5 |
| S35 | Resume snapshot repairs an incomplete item | covered | provenance-resume ×2 |
| S36 | Durable failure survives degraded native snapshot | covered | provenance-resume ×2 |
| S37 | Cross-version snapshot reconciliation declares its evidence limits | covered | provenance-resume ×3 |
| S38 | Second event mapping definition appears | partial | guards ×2 assert the static end state (owners, ownership map). The "guard fails naming file/symbol on an injected duplicate" clause is delegated to the guard's own self-test (S40), which is only observed to pass. |
| S39 | Route or runtime adapter writes job events directly | covered | guards ×6 (end-state scans; same self-test delegation note) |
| S40 | Guard proves its own detection | partial | guards ×1 checks the guard consumes the fixture and passes. "Missing/unexpected findings fail the self-test" is not observable without a seam → implementer-unit. |
| S41 | Transport forwards protocol boundary shapes (spy ledger on the Codex transport) | implementer-unit | Design says "inject host-composed ledger" into app-server-adapter(-runner) but names no injection option. |
| S42 | Pinned native surface has complete disposition | covered | core ×5 red + 1 green (asserted at the committed-record level plus decoder export/statelessness) |
| S43 | Decoder retains channel and native error fields (codex-decode.json) | missing | Authorable now against `decodeCodexNativeBoundary` and the design's fixture-only decode shape `{kind, native, channel?, partIndex?, text?, fields?, total?, last?, code?, willRetry?}`. |
| S44 | Desktop stream emits semantic events | covered | projection ×2 |
| S45 | Secret-like payload is observed | covered | projection ×2 |
| S46 | Batch process event is persisted | covered | projection ×2 |
| S47 | Existing event readers remain compatible | covered | projection ×1 |
| S48 | Consumer reads events | covered | projection ×5 |
| S49 | Consumer follows events | covered | projection ×1 (green; host stderr injection not possible through the CLI) |
| S50 | All internal event types preserve dense v1 projection | covered | projection ×1 (complete) + core ×1 (nine-type subset on the spec-named fixture) — duplicated across files, see P2-2 |
| S51 | API job completes | covered | projection ×5 |
| S52 | Run artifact directory is configured | covered | projection ×1 (green) |
| S53 | Consumer detects readiness support | covered | projection ×1 (green) |
| S54 | Older build lacks the feature | covered | projection ×1 (green) |
| S55 | Consumer detects canonical ledger support | covered | projection ×1 |
| S56 | Cross-process queued cancel races with start | covered | terminal ×6 |

## 6. Uncovered / implementer-unit assignments

Follow-up red slice (independent author, before the implementer edits the named owners):

| Scenario | Owner it gates | Fixture to create |
| --- | --- | --- |
| S11, S12 | job-store `appendExactRunEventBatch`, ledger commit/ack/reopen, `run-event-ledger-host.ts` | `store-faults.json` operations key (tasks 7.8 `{op,key,failAt?}`), beside the existing `raceCases` |
| S17 | ledger Run-scoped redactor (`redaction.ts` composition), renderer projection | `split-secrets.json` (tasks 7.14) |
| S16 | ledger `readNativeContext`, app-server-adapter interrupt target | reuse `identity-provenance.json` cases `interrupt-target`, `interrupt-target-missing-turn` |
| S43 | `decodeCodexNativeBoundary` | `codex-decode.json` (tasks 7.7) |
| S32 | ledger request/send/resolved boundaries | `interaction-boundaries.jsonl` (tasks 7.1) incl. send `failed` |
| S01, S02, S03, S05, S07 (protocol half) | ledger ingress vocabulary, CLI/protocol serializers | `vocabulary.json`, `normalized-output.json`, `projection.json` (tasks 7.17) |

Implementer-unit (the implementer writes the unit test when the seam exists, records it in the
register with the seam name): S04 (facade result ↔ completedSequence), S06 (coarse ingress
return value in `ledger-ingress.ts`), S08/S09 (desktop request ledger ports and desktop-runner
ledger injection), S41 (spy-ledger injection on the Codex transport), S25/S30 prepare-fail hooks
of the `artifactOwner` (terminal-artifacts.json), S38/S40 negative self-test observation,
S24 supervisor-observed-exit / unknown-host / changed-claim-at-commit variants, S19 native-index
variant after tasks 1.4 vendors the 0.139 closure.

## 7. Findings (no P1)

| ID | Sev | Where | Finding | Disposition |
| --- | --- | --- | --- | --- |
| F-1 | P2 | suite-wide | Coverage debt: 9 scenarios missing, of which S11, S12, S17, S16, S43, S32(half), S01–S03, S05 are authorable now against design-named seams; none was assigned to a domain author. | Dispatch the follow-up red slice in §6 before the implementer touches the corresponding owners (tasks 1.5/1.7 gate). |
| F-2 | P2 | core.test.ts S50 vs projection.test.ts S50 | S50 is asserted twice through the same entry point (`toLocalJobApiEventEnvelope`) on two fixtures (`public-vocabulary.json`, spec-named; `public-v1.json#dense-vocabulary`, superset incl. redacted stub). Assertions are compatible, not conflicting. | Register the projection test as primary for S50 and the core test as the nine-type table on the spec-named fixture; consolidate when convenient. |
| F-3 | P2 | guards.test.ts / `legacy-migration.json` | Spec/tasks name the S13 fixture `legacy-store.json`; the authored file is `legacy-migration.json` (content matches tasks 7.15: desktop wrapper rows, bare API rows, duplicate historical completed, incomplete run). | Rename to `legacy-store.json` (two string references in guards.test.ts) in the follow-up slice; not behavior-affecting. |
| F-4 | P2 | three harnesses | Three different in-memory `durableStore` fakes (header shapes: `ledgerSealedSequence` vs `sealedSequence`; `lookupFact` null vs list), three `artifactOwner` fakes (`{}`, Proxy returning `{result:"rejected"}` for any method, the run-artifacts module namespace). A ledger that depends on a specific header field or that fails a run when the artifactOwner rejects an unrequested preparation will go spuriously red. | Implementer: rebuild high-water/state from committed records (design), treat header fields as optional, and call the artifactOwner only when the run has an admitted run directory. |
| F-5 | P2 | S38/S40 | Negative guard detection (fail naming file/symbol/section) is only reachable through the guard's own self-test, which the test observes as pass/fail of the whole run. | Implementer: expose an inspectable self-test result (or a fixture-path option) so S40's "missing/unexpected findings fail" clause becomes testable. |
| F-6 | P3 | core.test.ts S42 | Disposition table is asserted on committed ledger records (ingestNotification/ingestServerRequest) rather than on `decodeCodexNativeBoundary` output; the decoder itself is checked only for export/statelessness/non-empty. | Acceptable superset; S43 (missing) covers the decoder descriptor. |
| F-7 | P3 | reconciliation S26 | "Unique usage_update payloads" is computed by `payload.dedupeKey`. For Codex cumulative snapshots the design's fallback ("otherwise retained observationKey") would give the duplicate 20-snapshot a distinct key and fail the test. | Implementer: derive the Codex snapshot dedupeKey from native identity + vector (threadId/turnId/total), or emit no second usage_update for an identical snapshot. |
| F-8 | P3 | terminal S23/S24, provenance S15 | Tests require the literal `installationId` / `locusBuild` string to appear in the serialized committed record (the "provenance ref"), and `record_metadata_json` to contain the substring `pending` for pending rows. | Implementer: serialize the provenance ref as the installationId (runtime) or locusBuild (completion) and the provenance kind in record metadata. |
| F-9 | P3 | all fact-key readers | Both harnesses locate the observationKey as a whole token inside `factKey` (object, tuple or delimited string) at any depth; a hashed fact_key would break every `recordsFor` lookup. | Implementer: encode `fact_key` as `<observationKey>:<ordinal>` (or the object) — never a digest. |
| F-10 | P3 | projection S45 | Projection deliveries are asserted right after the awaited port call. | Implementer: complete synchronous post-commit fan-out before the port promise resolves (or expose a flush). |
| F-11 | P3 | terminal S24 alive/EPERM/claimed-missing-pid | Test pins "no appended record" for heartbeat_only rows (the recovery process is not the run host; design forbids a parallel writer). | If the implementer wants a durable heartbeat_only diagnostic, raise with the coordinator first. |
| F-12 | P3 | domain-b-kit `exitedPid()` | Uses `Bun.spawnSync(["true"])`; not portable to a Windows CI host (dev/CI is Linux/WSL today). | Note only. |
| F-13 | P3 | projection/guards `seedProject` | Temp project dirs are created with `mkdtempSync` and never removed. | Housekeeping. |
| F-14 | P3 | suite-wide | 65 of 98 reds are contract-absence reds (`Cannot find module` for NEW `run-event-ledger.ts` / `run-provenance.ts`), loaded lazily per test; tasks 1.5 asks for meaningful failures. Both authors report toy-stub satisfiability runs (A: 35/35 green; B: 22/30, remaining 2 were toy shortcuts) that the auditor could not reproduce without writing a stub. | Recorded; the 33 real-gap reds through existing entry points anchor the suite, and the per-test "behavior gap pinned" column above states what each contract red will enforce. |

Quality audit results (no finding): no `skip/todo/only`, no `try/catch` swallowing (rejections
are captured only through an explicit `settledResult` and asserted), no conditional assertions
(collect-then-`expect([])` pattern only), deterministic clocks/fixtures (the one `Date.now()` is
intentional content of the never-hashed `v2.schemas.json`), per-test stores/DBs/temp dirs,
`afterEach` cleanup of the Claude active-session registry, readiness cache reset, every entry
point name traced to the design owner mapping / Test-facing Contract / tasks §7, Scenario
parameters verified in fixtures (S18 hel/hello/heX, S19 analysis/short/next, S22 status table,
S23 exit 1/SIGINT/t1, S25 20→25/5, S26 10/20/20/25, S27 100/108/3, S29 five reasons, S33 codes,
S42 66/10/16 exact).

## 8. Auditor notes for the implementer

1. Shapes the suite froze where the design is silent (adopt or negotiate before coding):
   status subtype in `payload.subtype`; synthetic terminal in `completed.payload.synthetic
   {source, transportId, exitCode, signal}`; recovery in `completed.payload.recovery
   {confidence, basis, observedAt}`; error `payload.classification/willRetry/code` plus
   `payload.extensions["runtime.codex.v1"]`; resume facts at the top of the status payload;
   repair in `payload.repair {source, result}`; late records `status/late_event` with
   `diagnosticOnly, terminalSequence, originalType, nativeMethod, observation`; usage vectors as
   `payload.total/last/baseline/delta.totalTokens`, `kind:"snapshot"`, `dedupeKey`; item key in
   `payload.item` (or `payload.item.key`) with channels `assistant|text|summary|tool` and
   `partIndex`; `readItem().fields` matched as a superset of the final native item fields;
   per-call usage DTO `{type:"usage_update", payload:{callId, revision, usage}}`;
   `repairFromSnapshot` snapshot `{thread…}` / `{…, tokenUsage:{total,last}}`; coarse ID-less
   output via `ingestRuntimeObservation({type:"assistant_delta", payload:{text}})`;
   `admitRunArtifactCandidate({path, ownerRunId, expectedSha256, media}, {runId, allowedRunDir,
   ledger})`; `artifact_created.payload.artifacts[{sha256, sizeBytes, contentType}]`;
   `captureRunExecutionProvenance({runtimeId, adapterSource, version, protocolName,
   protocolVersion, executablePath, schemaRoot, schemaFiles})`; Claude `resumeIntent {queryId,
   resume, forkSession, resumeSessionAt}`; the S10 retry port returns the committed batch array.
2. Raw SQL names the tests use: `agent_jobs.ledger_version/ledger_provenance_json/
   ledger_sealed_sequence`, `agent_job_events.fact_key/record_metadata_json` (nullable, unique
   `(job_id,fact_key)`, partial unique completed with non-null fact_key),
   `agent_job_projection_cursors(job_id, projection_name, acknowledged_sequence)` PK + cascade.
3. The desktop wrapper writer must go: exactly one `src/` file (the Workbench reader) may mention
   `runEventSequence`; `schedules.ts:346` must route through the host ledger; all eleven legacy
   symbols must vanish from `src/` (25 residues today).
4. Existing baseline tests the design obsoletes (not touched by the authors):
   `tests/claude-agent-sdk-stream-error-finalization.test.ts` ("clears expired session ids"),
   `tests/claude-agent-sdk-errors.test.ts` (SESSION_EXPIRED), `tests/agent-job-store.test.ts`
   (interruptStaleAgentJobs error-only mint), plus the guard's inline self-test strings.
   Added 2026-10-01 (follow-up slice adjudication 6): `tests/runtime-redaction.test.ts`
   `expect(normalOutput).toBe("kept upstream")` — terminal flush must not release a withheld
   potential-hint prefix (design, no length threshold); S17 pins the new behavior.
   Added 2026-10-01 (Phase I rulings, coordinator): the same flush rule obsoletes the withheld-
   prefix-release assertions in `tests/runtime-stream-event-mapper.test.ts` and
   `tests/headless-provider-binding.test.ts` (updated with before/after evidence in 1af858f7), and
   `tests/headless-runtime-event-bridge.test.ts` now expects the coerced `payload.subtype` that
   S50 requires (46293fec). Phase I transition state accepted: new jobs default to
   `ledger_version=1` while the unconverted legacy writers still run (needed by S11-SQLite);
   Phase II converts every writer so that, at acceptance, no v1 job carries a fact-key-less
   record. Frozen in Phase I where the design is silent (consistent with §8): terminal fact keys
   are `settle:<trigger.observationKey>`; `createCanonicalRunEventLedger` returns synchronously
   (projection S45 calls ports without await). `check:full` cannot exit 0 while declared red
   tests remain; the Phase I gate is every other stage green, and Phase II must reach exit 0.
   Added 2026-10-01 (Phase II rulings, coordinator, candidate e7198bc7 — nine red files 141/141,
   full suite 2665/0, `bun run check:full` exit 0 reproduced independently): of the seven
   decisions the implementer took inside the design's latitude, (2) v0 rows drain with the old
   build, (5) desktop completion waits for the renderer channel to drain and flush drops withheld
   prefixes, and (6) artifact refs merge into `result_json` are accepted as design-conformant;
   (1) coarse non-usage observations admitted before provenance binding and (4) schema identity
   over compiled-in schema documents are accepted with disclosure (Phase III records every real
   coarse runner's binding point and defines `schemaFiles` as the adapter's compiled-in documents);
   (3) headless app-server runs settling with `host_result` instead of `native_terminal` is
   referred to the fresh review (design limits `host_result` to process batch/completion);
   (7) the consumer-visible changes go into both consumer guides with a C7 check against the
   signed DIRECT_NEW_STANDARD scope. The final Phase II commit rewrote 32 baseline test files;
   the review must confirm no assertion was weakened.
   Added 2026-10-01 (post-T1 lint adjudication, coordinator): CI's PR-base lint ratchet
   (`BIOME_CHANGED_SINCE` = base) flagged two `type Json = any` declarations in
   `tests/run-event-ledger-guards.test.ts` / `tests/run-event-ledger-projection.test.ts` and a
   useless regex escape in `tests/run-event-ledger-domain-b-kit.ts:179`. Coordinator edits:
   one `biome-ignore` comment above each `any` and `[^A-Za-z0-9_.\-]` → `[^A-Za-z0-9_.-]`
   (identical character class). No assertion, fixture or test title changed; nine red files
   remain 141/141. The immutable-set zero-diff baseline for review moves from `e63457a5` to
   this adjudication commit.
5. The green-by-design set (§4) is part of the acceptance gate: S39's gate-absence test will go
   red while `canonicalRunEventLedgerV1` exists and must be green again before acceptance.
6. Fixture caveat carried from the authors: param shapes are schema-derived synthetic values
   cross-checked against codex-cli 0.159.2 as a stand-in; the pinned 0.139.0 TypeScript closure is
   not vendored (tasks 1.4 open). S19's schema-proven index path is unauthored until then.
