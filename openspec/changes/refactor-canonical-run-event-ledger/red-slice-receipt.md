# Red Slice Receipt — refactor-canonical-run-event-ledger (Phase 3 follow-up slice)

Auditor: fresh-context auditor (no author or implementer context). Date: 2026-10-01.
Worktree `/home/chen/projects/locus-refactor-canonical-run-event-ledger-draft`, branch
`codex/refactor-canonical-run-event-ledger-draft`, base HEAD `339c4e6e` (the accepted first red
suite; `red-receipt.md` is the convention reference). The slice was UNCOMMITTED at audit time.
Authors: A (vocabulary/serializers/decoder), B (store faults/native context/redaction/boundaries).
Coordinator adjudications 1–11 (dispatch brief) were applied, not reopened.

Verdict: **CHANGES_REQUESTED** — one P1 (a one-line assertion the S11 memory test must gain
before commit, see F-S1). Everything else is accepted as written; the re-audit scope is that
single test.

> Coordinator closure (2026-10-01): F-S1 applied as an adjudication edit in the slice commit —
> `duringFailure.settledKeys = settlements.map(e => e.key)` pinned to `[a.key]` (B pending, neither
> rejected nor committed ahead). F-S2 comments added to the five contract-absence tests; F-S5
> recorded in red-receipt §8.4. Re-run: store-faults 0 pass / 4 fail, vocabulary 2 pass / 8 fail
> (same failure lines); biome clean. Verdict therefore closes as **RED_SLICE_ACCEPTED**.

## 1. File list (immutable after commit)

| File | Lines | Status vs 339c4e6e |
| --- | ---: | --- |
| `tests/run-event-ledger-vocabulary.test.ts` | 739 | new (A: S01 ×2, S02, S03, S05 ×2, S07-protocol ×2, S43 ×2) |
| `tests/run-event-ledger-slice-a-kit.ts` | 146 | new helper (ledger over Domain A store with injectable artifactOwner, record→row, writer capture, temp dirs) |
| `tests/run-event-ledger-store-faults.test.ts` | 558 | new (B: S11 ×2, S12 ×2) |
| `tests/run-event-ledger-boundaries.test.ts` | 849 | new (B: S16 ×4, S17 ×5, S32 ×3) |
| `tests/run-event-ledger-slice-b-kit.ts` | 363 | new helper (explicit durableStore/projections ledger, host-process lifeline + store facade + upsert projection, ack findings, text leaves, host-output capture) |
| `tests/fixtures/run-event-ledger/vocabulary.json` | 358 | new (21 cases + 4 raw-mint attempts) |
| `tests/fixtures/run-event-ledger/normalized-output.json` | 211 | new (5 output + 5 tool observations; `terminalStatuses` reserved for S04, unasserted) |
| `tests/fixtures/run-event-ledger/projection.json` | 186 | new (2 × S05, 2 × S07) |
| `tests/fixtures/run-event-ledger/codex-decode.json` | 315 | new (8 cases + statefulness probe) |
| `tests/fixtures/run-event-ledger/split-secrets.json` | 217 | new (tasks 7.14) |
| `tests/fixtures/run-event-ledger/interaction-boundaries.jsonl` | 32 | new (header + 31 lines, tasks 7.1) |
| `tests/fixtures/run-event-ledger/store-faults.json` | 548 | MODIFIED, additive only: new top-level key `faultOperations` (4 cases) |

Immutable-set zero-diff, verified: `git status --porcelain` lists exactly the twelve paths
above and nothing else; `git diff --stat 339c4e6e -- tests/ openspec/` = `store-faults.json |
286 +` only. `jq -S .raceCases` and `jq -S 'del(.faultOperations)'` of the working copy are
byte-identical to `git show 339c4e6e:…/store-faults.json` (adjudication 5). No `src/` change.
All five new JSON fixtures and the JSONL header line carry `fixtureVersion:1`,
`evidenceClass:"synthetic"`, `sourceRefs[]`, `provenance{}`; `codex-decode.json`,
`split-secrets.json` and `interaction-boundaries.jsonl` state the codex-cli 0.159.2 stand-in
cross-check and that the pinned 0.139.0 closure is not vendored (tasks 1.4 caveat, red-receipt
§8.6; adjudication 4).

## 2. Per-file counts on 339c4e6e (auditor re-run, `bun test --isolate <file>`, bun 1.3.14)

| File | Tests | Pass | Fail | Real-gap | Contract-absence | Green-by-design |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `run-event-ledger-vocabulary.test.ts` | 10 | 2 | 8 | 1 (S05-B) | 7 | 2 (S05-A, S07-b) |
| `run-event-ledger-store-faults.test.ts` | 4 | 0 | 4 | 0 | 4 | 0 |
| `run-event-ledger-boundaries.test.ts` | 12 | 0 | 12 | 2 (S16-d, S17-e) | 10 | 0 |
| **Total** | **26** | **2** | **24** | **3** | **21** | **2** |

`bunx` is not on PATH in this environment; `./node_modules/.bin/biome check` (Biome 2.5.0) on
all eleven checkable files: clean, exit 0. Author reports reconcile with the re-run except that
Author B counted the S11-SQLite test as real-gap (auditor: contract-absence, see F-S3), so B's
"3 real gaps / 13 contract absence" becomes 2 / 14.

## 3. Per-test red reasons

Line = `test(` line in the file. Category: `real-gap` = fails on the asserted behavior through
an existing entry point; `contract-absence` = the NEW module/export does not exist (lazy import
inside the test, so the red is the test's own); `green` = characterization that must keep passing.

### 3.1 tests/run-event-ledger-vocabulary.test.ts (8 RED, 2 green)

| # | Line | Scenario | Category | Failure on base | Behavior it pins |
| - | ---: | --- | --- | --- | --- |
| 1 | 163 | S01 | contract-absence | `Cannot find module '../src/main/lib/agent-runtime/run-artifacts'` (via `loadRunArtifactsModule`) | vocabulary.json through appendSystemEvent/ingestRuntimeObservation/admitRunArtifactCandidate/settle yields exactly the 21 types, dense sequence, runId/runtimeId/ISO createdAt/object payload, one record of the expected type per case key, payload superset where declared, hint absent from records and store rows, one `artifact_created.payload.artifacts[{sha256,sizeBytes,contentType}]`, exactly one `completed` and it is last |
| 2 | 265 | S01 | contract-absence | `Cannot find module '../src/main/lib/agent-runtime/run-event-ledger'` | generic ports never mint `completed`/`artifact_created` (rejected or diagnosed, no such record), `readOutcome()` null before settle, exactly one `completed` from settle, `readOutcome()` `{status:"succeeded", completedSequence}` |
| 3 | 319 | S02 | contract-absence | same | assistant/reasoning records in ingress order (fact-key owner index 0..n-1), type per case, payload superset incl. `contentKind`/`format`/`messageId`/nested `structured`, `serializeAgentJobEvent` sequence + payload parity, Workbench row kind assistant/reasoning with `hasRawPayload=false` |
| 4 | 365 | S03 | contract-absence | same | tool_started/tool_delta/tool_finished in order with `toolName`/`status`/`toolCallId` at payload top level, `provider-secret-123` absent from records/rows/envelopes, safe remainder retained, record-level `redaction.status:"redacted"`, Workbench `kind:"tool"`, `summary`=toolName, `status` |
| 5 | 428 | S05 | green | passes: stdout is exactly one `{event:{id,jobId,sequence:1,type,payload:{text:"hello"},createdAt}}` line, stderr `""` | see §4 |
| 6 | 455 | S05 | **real-gap** | line 498 `expect(parseJsonLines(out.stdout)).toEqual(committed.map(e=>({event:e})))`: stdout carries an extra `{event:{type:"error",sequence:4,payload:{errorCode:"worker_interrupted",status:"interrupted"}}}` minted by `interruptStaleAgentJobs` for a live same-host worker; stderr is empty (the `heartbeat_only` assertion at line 506 is never reached) | alive stale worker (`headless:<self pid>:1:<jobId>`, heartbeat 600 s old) → no minted record, stdout = committed records only, host diagnostic containing `heartbeat_only` on the CLI stderr Writer (adjudication 2) |
| 7 | 513 | S07 (protocol half) | contract-absence | same module | desktop-source native records serialize through `serializeAgentJobEvent` with exactly `{createdAt,id,jobId,payload,sequence,type}` at the canonical sequence, bare payload deep-equal, Workbench decoder same sequence/`semanticPayload`, `hasRawPayload=false`, no `runId/runEventSequence/redaction/payload` payload keys, assistant text present |
| 8 | 570 | S07 (protocol half) | green | passes: every `job/event` params equals `{jobId, event: serializeAgentJobEvent(row)}` for rows 1..N, six keys, no wrapper keys, one `completed`, stderr `""`, JSON-RPC-only stdout | see §4 |
| 9 | 661 | S43 | contract-absence (export absent on existing `codex/app-server-stream-events.ts`) | line 657 `expect(typeof decode).toBe("function")` Received `"undefined"` | descriptors retain `native{threadId,turnId,itemId}`, `channel` text/summary, `partIndex` only from a native `contentIndex`/`summaryIndex`, `text`, `code`/`willRetry`, exact `total`/`last`; non-empty string `kind`; no `sequence`; no `"succeeded"`/`kind:"completed"` |
| 10 | 701 | S43 | contract-absence (same) | same | purity: after `thread/started`, `turn/started`, `summaryPartAdded(summaryIndex=1)` are decoded, later index-less deltas/error/usage decode deep-equal to their first decode, never gain `partIndex`, never carry `session-other`/`th-other`/`tu-other`, inputs unmutated |

Auditor note on #9/#10: the existing stateful `createCodexAppServerRuntimeEventMapper` would
also fail these on substance (one `reasoning-delta` without channel/index, `error` drops `code`,
closure-held sessionId/usage), so the red is meaningful beyond the export name.

### 3.2 tests/run-event-ledger-store-faults.test.ts (4 RED)

| # | Line | Scenario | Category | Failure on base | Behavior it pins |
| - | ---: | --- | --- | --- | --- |
| 11 | 101 | S11 (memory) | contract-absence | `Cannot find module '../src/main/lib/agent-runtime/run-event-ledger'` (via domain-b-kit) | while `appendExact` throws before commit for A with B queued: A's port rejects, rows/highWater 0, `read(0)`/deliveries/acks/acknowledged keys empty, cursor 0; after same-key retry: A then B at 1..a and a+1..n, resolved ack order A,B, A's resolved value = committed batch array, deliveries A,B, cursor = high-water, acks monotone over delivered prefix, one row per fact key, no observationKey in payloads, no other record consumed a sequence. **Does not pin B as pending (F-S1).** |
| 12 | 242 | S11 (SQLite) | contract-absence (new export on existing `headless/job-store.ts`; B's report said real-gap) | line 245 `expect(typeof jobStore.appendExactRunEventBatch).toBe("function")` Received `"undefined"` | mid-batch `RAISE(ABORT)` (TEMP trigger on `payload_json.$.probe`) → rejects, zero new rows, `agent_jobs` row unchanged; retry + duplicate resubmit + B → fact keys `sf-sql-a:0`, `sf-sql-a:1`, `sf-sql-b:0` at base+1..3 verbatim, `record_metadata_json` non-empty, one row per fact key, dense sequences, duplicate returns the committed batch array with the same sequences, `jobMutation {status:"running", workerId:"worker-sf"}` lands only with the commit |
| 13 | 519 | S12 (afterCommit) | contract-absence | same | P delivered+acked before A; A committed, process dies before delivering A; reopened ledger delivers `[A, N]` at original sequences (cursor+1..), upsert keyed (runId,sequence) holds P/A/N once, acks monotone from the crash cursor to high-water, `read(0)` dense with A once, N at high-water+1 |
| 14 | 536 | S12 (afterDeliver) | contract-absence | same | as #13 but A was delivered (not acked) before the crash: redelivery of A at its original sequence, no duplicate upsert/read, same ack/cursor/next-sequence pins |

### 3.3 tests/run-event-ledger-boundaries.test.ts (12 RED)

| # | Line | Scenario | Category | Failure on base | Behavior it pins |
| - | ---: | --- | --- | --- | --- |
| 15 | 110 | S16 | contract-absence | `Cannot find module …/run-event-ledger` (via harness) | `readNativeContext()` equals `identity-provenance.json#interrupt-target.expected.interrupt` `{threadId:"th-intr", turnId:"tu-intr"}` on two reads, appends nothing (records and store rows unchanged), no `nativeContext`/`interruptTarget`/`interrupt` key in any record |
| 16 | 133 | S16 | contract-absence | same | with hints, target = raw `{threadId:"th-provider-secret-123-a", turnId:"tu-5e"}` (unredacted), never the sessionId; serialized records never contain the raw threadId |
| 17 | 152 | S16 | contract-absence | same | thread-status-only, thread/start response with sessionId but no turn, and no observation all return `null` (fixture `expected.interrupt` is null) |
| 18 | 180 | S16 | **real-gap** | line 200 `expect(statefulInterruptBuilders).toEqual([])` received `["createCodexAppServerRuntimeEventMapper"]` | `codex/app-server-stream-events.ts` exports no zero-arg `create*` factory whose instance has `buildInterruptRequest` (design owner row "no buildInterruptRequest state") |
| 19 | 311 | S17 | contract-absence | same module (via domain-b-kit) | 4 channels × 35 split positions = 140 Runs: no hint and no ≥3-char remnant in records, store rows, renderer chunks, settle result, outcome or host output; `alpha-safe …  omega-safe` visible before and after seal; renderer text safe; `appliedRules` contains `secret-hint` |
| 20 | 407 | S17 | contract-absence | same | terminal withheld prefix per channel never appears anywhere (incl. host output/outcome); ingress record `redactionPending:true`; `tail-safe ` visible; `warning`→status and `error` diagnostics committed with `secret-hint` recorded; exactly one `completed` |
| 21 | 490 | S17 | contract-absence | same | a withheld prefix proven safe by the next fragment is released before the seal by a later record (sequence > source batch) referencing the source observationKey; channel text exactly `see province maps` / `open gateway-to-docs` |
| 22 | 536 | S17 | contract-absence | same | interleaved assistant/reasoning splits redact per channel; each channel's safe prefix/suffix kept; no hint in records |
| 23 | 573 | S17 | **real-gap** | line 625 `expect(findings).toEqual([])`: the four terminal channels release `provider-secret-12`, `gateway-secret-45`, `provider-secret-1`, `gateway-secret-4` at `flush()` (split channels clean) | `createExactSecretStreamChannelRedactor().flush()` never releases a withheld hint prefix while adjacent splits are still redacted and safe text kept (adjudication 6) |
| 24 | 687 | S32 | contract-absence | same (via harness) | per case (10 methods + unknown 299): exactly one `status/interaction_boundary` record per line with `payload.boundary`, exact-typed `requestId` (single value anywhere in the record), method in request payload, explicit `sent`/`failed` and never the opposite |
| 25 | 749 | S32 | contract-absence | same | 31 interleaved boundaries commit densely in ingress order; each boundary record correlates to exactly its own requestId |
| 26 | 785 | S32 | contract-absence | same | resolved-before-send, resolved-after-failed-send and resolved-for-unknown-request all fulfil and are recorded once; no `permission_requested`/`question_*`/`guard_decision`/`scope_expansion_requested`/`mcp_needs_auth`/`completed` records; no `interactionId/interaction/interactionState/interactionStatus/granted/grant/executionGranted/approved/authorized/decision` payload keys (adjudication 7) |

Scenario mapping: all 26 titles start with exactly one `Sxx` and the spec scenario heading text
(`specs/agent-runtime-core/spec.md`, `specs/codex-runtime-parity/spec.md`); the S07 titles say
"protocol envelope". No first-suite test is duplicated: S43-b's interleaved-state probe is
distinct from core S42 "exported, stateless and never returns an empty default" (they share only
the `typeof === "function"` guard); S32-a re-asserts request boundaries only as the anchor of the
per-case send/resolved correlation that core S10/S42 do not assert; S05-B seeds a job through
`createAgentJob`/`startAgentJob` like terminal S24-alive but asserts the CLI surface, which S24
leaves to implementer-unit; S16-d is not in `guards.test.ts`; S11/S12 do not touch `raceCases`.

## 4. Green-by-design (2 — characterization guards that must keep passing)

| Test | Why it is a real characterization (not a tautology) |
| --- | --- |
| S05-A (line 428) `jobs logs --output stream-json` | Pins the exact NDJSON contract the change must preserve: one `{event: serializeAgentJobEvent(row)}` per committed row, six-field envelope, bare payload, trailing newline, nothing else on stdout, empty stderr. A cutover that wraps payloads, adds a diagnostic line or re-sequences goes red. |
| S07-b (line 570) jobs-stdio `job/event` | Pins that `locus-jobs-stdio.v1` forwards every persisted row exactly once, in sequence, as `{jobId, event}` with the same six-key envelope, no wrapper keys, one `completed`, JSON-RPC-only stdout and empty stderr — i.e. no second protocol mapper. Drives a real `runJobsStdioServer` with a fixture runner through the existing `observer.appendEvent` path, which the design reroutes through ledger ingress. |

Both are kept. Reminder for the implementer: S07-b compares notifications to `listAgentJobEvents`
rows with `toEqual`, so every committed record (including any ledger-added status records) must
be forwarded, and only one `assistant_delta` with text `hello` may exist for that run.

## 5. Newly frozen shapes for the implementer (20; all consistent with red-receipt §8, F-4, F-9, F-10, F-11 and the artifactOwner call rule)

Slice A:
1. `vocabulary.json` drives `job_created`/`job_started` through `appendSystemEvent`; every other
   non-artifact, non-terminal type through `ingestRuntimeObservation`; artifact through
   `admitRunArtifactCandidate({path, ownerRunId, expectedSha256, media}, {runId, allowedRunDir,
   ledger})` with the run-artifacts module namespace as `artifactOwner`; terminal through `settle`
   with a `host_result` trigger (source `api` process batch). tasks 7.17 wording to be amended
   (adjudication 1).
2. Committed record envelope: `runId`, `runtimeId`, numeric `sequence`, `type`, ISO-string
   `createdAt`, object `payload`; record-level `redaction {status, appliedRules}` (RunEvent shape)
   with `status:"redacted"` on secret-bearing records — never inside `payload`.
3. Raw `completed`/`artifact_created` through `ingestRuntimeObservation`/`appendSystemEvent`:
   rejection or non-gated diagnostic, but no record of that type, `readOutcome()` null; settle's
   batch commits exactly one `completed` and it is the last record of the batch.
4. S02 content metadata preserved as a payload superset: `contentKind` (`text`|`structured`),
   `format`, `messageId`, nested `structured` object (no stringification); an `assistant_delta`
   without `text` is valid when `contentKind:"structured"`.
5. S03 tool payload keeps `toolName`, `status` (`started`|`running`|`completed`|`failed`) and
   `toolCallId` at payload top level; nested `input`/`output` are redacted in place with the safe
   remainder kept; Workbench row `kind:"tool"`, `summary`=toolName, `status`=payload status.
6. Persisted `payload_json` = bare `JSON.stringify(record.payload)`; protocol envelope is exactly
   `{id, jobId, sequence, type, payload, createdAt}`; payload keys `runId`, `runEventSequence`,
   `redaction`, `payload` are banned (same list as projection S47); Workbench decoder reads v1
   rows with `hasRawPayload=false` and `semanticPayload` deep-equal to the envelope payload.
7. S05-B: the CLI pre-command recovery pass writes the alive/unknown stale-host diagnostic to
   the command's `stderr` Writer and it contains `heartbeat_only`; nothing is minted (F-11) and
   stdout carries only committed records (adjudication 2; depends on the Phase II job-recovery
   alive probe with worker id `headless:<pid>:1:<jobId>`).
8. S07 protocol serializer = the shared `serializeAgentJobEvent` envelope of tRPC
   `agentJobs.logs` and jobs-stdio `job/event` (adjudication 3); jobs-stdio emits exactly one
   `job/event` per persisted row with `params = {jobId, event}`.
9. S43 decoder descriptor (design fixture-only decode shape): output may be one descriptor or an
   array; each has a non-empty string `kind` (value not pinned); `native{threadId,turnId,itemId}`,
   `channel` (`text`|`summary`), `partIndex` present only when the native `contentIndex`/
   `summaryIndex` is (key absent otherwise — no default 0), `text`, `code`, `willRetry`, `total`,
   `last` at descriptor top level; `total`/`last` are supersets of the native vectors;
   `summaryPartAdded` decodes to `{channel:"summary", partIndex}`; never `sequence`, never
   `"succeeded"` or `kind:"completed"` for these inputs; retry `code` follows the repository DTO
   `error.code` (adjudication 4 caveat).
10. Decoder purity: same input → deep-equal output regardless of previously decoded
    `thread/started`/`turn/started`/`summaryPartAdded`; no session/thread/turn IDs carried across
    calls; inputs are not mutated.

Slice B:
11. Projection ack owner and timing (extends F-10): the ledger delivers a committed batch to each
    projection and, when the projector accepts it, calls `projection.ack(sequence)` (delegating
    to `durableStore.ack`) over the contiguous delivered prefix, all before the ledger's next
    observation is processed — within the port call or at most three macrotask turns. Delivery
    is at-least-once; ingestion never blocks on a slow or failing projector (adjudication 9 —
    verified: the S12 projector always accepts or dies, it is never slow).
12. Halt on failed append (adjudication 10): a beforeCommit store throw makes A's port reject
    after bounded internal retries; per-Run ingestion then halts — B parks pending (see F-S1 for
    the missing pin), is never committed ahead, and commits at the next sequences after A is
    resubmitted with the same observationKey on the same ledger instance; A's resolved value is
    the committed batch array; no diagnostic consumes a sequence (store-failure diagnostics go to
    the host channel only); the observationKey never appears in `payload`.
13. `appendExactRunEventBatch(db, { jobId, records, expectedHighWater, jobMutation? })` exported
    by `headless/job-store.ts`: `records` are `RunEvent & { factKey, metadata }`; one SQLite
    transaction (a mid-batch failure leaves no row and the `agent_jobs` row unchanged); rejects on
    failure; stores `fact_key` verbatim (`<observationKey>:<ordinal>`, F-9) and a non-empty
    `record_metadata_json`; keeps supplied sequences; a duplicate complete fact-key batch returns
    the prior committed records array; `jobMutation` uses drizzle `agentJobs` field names
    (`status`, `workerId`, `workerPid`).
14. Crash/reopen model (S12): a crashed host makes no further effective store or projection
    calls; the projector target is an upsert keyed `(runId, sequence)`; a ledger recreated over
    the same store redelivers from `cursor(name)+1` at the original sequences (on construction or
    with its next commit), acks monotonically up to high-water, never duplicates in `read(0)`,
    and the next observation takes high-water+1. Memory-only; the SQLite cursor table is covered
    by the first suite's raw-SQL guards and S11-SQLite (adjudication 11).
15. `readNativeContext()` (sync or async) returns exactly `{threadId, turnId}` — raw, unredacted,
    even when the threadId contains a secret hint — or `null` when no turnId was observed; never a
    `sessionId` and never a threadId-only/sessionId-substituted target; reading appends nothing;
    no record carries `nativeContext`, `interruptTarget` or `interrupt`.
16. `codex/app-server-stream-events.ts` end state: no zero-arg `create*` export whose instance
    has `buildInterruptRequest` (the stateful mapper is deleted, not renamed).
17. Redaction record shapes: a delta record's text contribution is its first top-level
    `payload.delta|text|message|output`; a withheld-prefix ingress record carries
    `redactionPending:true` (any depth); the safe release is a later record of the same channel
    type, sequence above the source batch, referencing the source observationKey somewhere in the
    record; `appliedRules` (array, any depth) contains `"secret-hint"` (existing redaction.ts
    rule name) for hint redactions including `warning`→`status` and `error` diagnostics; the
    replacement text contains no ≥3-character fragment of a hint; `projectRunEventToRendererChunks
    (record)` returns a chunk array with assistant/reasoning text under `delta`/`text`.
18. Terminal flush (adjudication 6): any withheld potential-hint prefix is dropped at seal and
    appears nowhere (records, rows, renderer chunks, settle result, outcome, console/stderr); the
    fix lives in `agent-runtime/redaction.ts` (`createExactSecretStreamChannelRedactor().flush()`
    never releases it) — `tests/runtime-redaction.test.ts` `expect(normalOutput).toBe("kept
    upstream")` is obsoleted and joins red-receipt §8.4 (implementer may modify with baseline
    evidence, tasks 1.5).
19. Interaction boundaries: `status` records with `payload.subtype:"interaction_boundary"` and
    `payload.boundary` ∈ `request`|`response_send`|`resolved`; `requestId` keeps its JSON type
    (`201` ≠ `"201"`, adjudication 8) and every `requestId` key anywhere in the record carries
    the identical value (no stringified copies in metadata); send result under `payload.result`
    or `payload.sendResult` as `"sent"`|`"failed"`, never both; request payload includes the
    native method string; `recordServerResponseSend` accepts `{observationKey, transportId,
    receivedAt, requestId, result}` without a `message`; `resolved` for a never-requested id is a
    plain recorded fact (adjudication 7); no Interaction-state record types and no FSM/grant keys.
20. `store-faults.json#faultOperations` grammar (tasks 7.8): ops `append|deliver|ack|crash|reopen`
    with `key`, `failAt?` ∈ `beforeCommit|afterCommit|afterDeliver`, additive `submittedWhile`,
    `faultProbe`, `jobMutation`, `records[]`, `input`; expected blocks `duringFailure` /
    `afterRecovery`. `raceCases` and the header are untouched.

Harness assumptions carried over unchanged (no new ones): F-9 whole-token `observationKey`
lookup inside `factKey`; F-4 header-optional stores (B's facade delegates `readHeader` to the
Domain B store; A uses the Domain A store); the artifactOwner call rule (S01-b/S02/S03/S07-a use
the no-op Proxy owner and settle/ingest without an admitted run dir — the ledger must not consult
the owner there; S01-a admits one file under a temp `allowedRunDir` with the real module).

## 6. Remaining coverage (after this slice)

Totals move from 35 covered / 8 partial / 9 missing / 4 implementer-unit (red-receipt §5) to
**46 covered / 6 partial / 0 missing / 4 implementer-unit**. Newly covered: S01, S02, S03, S05,
S11, S12, S16, S17, S43; S07 and S32 move partial → covered (protocol half; send-failed/
resolved/no-FSM half).

Implementer-unit list (the implementer writes the unit test when the seam exists and records the
seam name in the register):

| Scenario | Clause still unasserted | Seam needed |
| --- | --- | --- |
| S04 | facade Run result references the committed `completed` sequence / `readOutcome()` status (`normalized-output.json#terminalStatuses` is reserved for it) | job-runner facade return value |
| S06 (half) | coarse ingress return value preserves coarse source / no invented native identity (persistence half covered by projection S46) | `ledger-ingress.ts` function name |
| S08 | desktop request ledger ingress/trace ports (`desktop-request.json`) | desktop request port names |
| S09 | fake desktop adapter through injected ports | desktop-runner ledger injection option |
| S41 | spy ledger on the Codex transport; adapter-level `sessionId←threadId` fallback removal (`app-server-adapter.ts:937–946`) — S16-d pins only the module surface | app-server-adapter(-runner) injection option |
| S13 (partial) | ledger-API append rejection on a v0 store; internal `historyQuality=legacy_unverified` reader; fixture rename to `legacy-store.json` (red-receipt F-3) | reader/port names |
| S19 (partial) | native-index variant | after tasks 1.4 vendors the 0.139 closure |
| S24 (sub-items) | supervisor-observed-exit basis, unknown host, changed claim/heartbeat at commit (the `heartbeat_only` diagnostic channel/token is now pinned by S05-B) | recovery hooks |
| S25 / S30 (partial) | preparation failure keeps one failed terminal; fault injection before preparation / before SQL commit / after commit-before-projection (`terminal-artifacts.json`) | `artifactOwner` prepare/fail hook names |
| S38 / S40 (partial) | negative guard self-test observability ("missing/unexpected findings fail") | inspectable self-test result or fixture-path option |
| S12 (SQLite half) | `agent_job_projection_cursors` monotone/≤ high-water/cascade at SQL level | covered by first-suite raw-SQL guards + S11-SQLite (adjudication 11); implementer-unit only if the job-store read/cursor functions get names |

## 7. Findings

| ID | Sev | Where | Finding | Disposition |
| --- | --- | --- | --- | --- |
| F-S1 | **P1** | `tests/run-event-ledger-store-faults.test.ts:150-180` (S11 memory, `duringFailure`) | Adjudication 10 requires B to stay **pending** while A's append fails. The test pins "not committed ahead" (`rows:0`, `highWater:0`, `readKeys:[]`) and "own sequences after A", but `acknowledgedKeys` counts only fulfilled settlements, so a ledger that **rejects** B during the failure (Author B's report §3.2 states the test "accepts both") passes unchanged: B's rejection lands in `settlements` unfulfilled and is never asserted, and the recovery path resubmits B anyway. | Must fix before commit: add to the `duringFailure` object `settledKeys: settlements.map((entry) => entry.key)` and to its expectation `settledKeys: [a.key]` (A rejected, B still unsettled after `macrotaskTurns()`). No other change; the file stays 0 pass / 4 fail on base. Re-audit scope: this test only. |
| F-S2 | P3 | `vocabulary.test.ts:661,701`; `store-faults.test.ts:101,519,536` | Five contract-absence tests lack the required one-line "Enforces once … exists" comment (A: both S43 tests; B: S11-memory and both S12 tests — the S12 behaviors are described only inside `crashFindings`). Both author reports claim full coverage. The behaviors are stated in the titles and in §3 above. | Record; may be added with F-S1 (comment-only) or left — §3 carries the text. |
| F-S3 | P3 | `store-faults.test.ts:242` (S11 SQLite) | Author B classifies this as real-gap; the red is the absence of the new `appendExactRunEventBatch` export on the existing `job-store.ts` (line 245), not a behavioral failure — the atomicity/dedupe assertions are unreached on base. Same class as A's S43 (export absent). | Reclassified contract-absence: slice totals 3 real-gap / 21 contract-absence / 2 green. |
| F-S4 | P3 | `tasks.md` 7.7 vs `codex-decode.json` | tasks 7.7 lists `{method|itemVariant,input,expectedType,expectedSubtype,expectedSurface?}` for `codex-decode.json`; the fixture pins decoder descriptors `{caseId,input,expected,absentKeys}` + `statefulnessProbe` because S43 asserts decoder output, not ledger records (design fixture-only decode shape). | Amend tasks 7.7 wording in the docs phase together with 7.17 (adjudication 1). |
| F-S5 | P3 | `red-receipt.md` §8.4 | Adjudication 6 obsoletes `tests/runtime-redaction.test.ts` "kept upstream"; the receipt's §8.4 list does not name it yet. | Docs phase: add it to §8.4 (implementer may modify with baseline evidence). |
| F-S6 | P3 | `store-faults.test.ts:206-213` (`firstAckOrder`) | Resolved-ack order A,B is derived from settlement push order, i.e. the ledger must resolve A's retry promise before the parked B's promise. | Implementer note: resolve port promises in commit order. Not a test defect. |
| F-S7 | P3 | `store-faults.test.ts:478-484` (`upsertByKey`) | "Projector upsert contains A once" is guaranteed by the test's own `(runId,sequence)` map; it discriminates only a re-sequenced A, which `faultedInRead`/`dense` also catch. | Note only. |
| F-S8 | P3 | `boundaries.test.ts:320-321,344` | `captureHostOutput` is restored inline and again from `afterEach` (double `mockRestore`, harmless); 140 spied Runs in S17-a run in ~2 ms each on base. | Note only. |
| F-S9 | P3 | `boundaries.test.ts:180-201` (S16-d) | A module-surface guard (zero-arg `create*` probe) lives in a behavior file; acceptable because the design owner row names the end state and `guards.test.ts` does not pin this symbol. | Note only. |

Quality audit results (no finding): no `skip/only/todo`; no `try/catch`; rejections captured only
through `settledResult` or unconditional `expect`; collect-then-`expect([])` throughout (all
`if` statements are collector or fixture-lookup guards); deterministic clocks
(`createDeterministicClock`/`createTestClock`, explicit `now` for the CLI, `setTimeout(0)` only
as macrotask yield); per-test stores, migrated temp SQLite DBs closed in `afterEach`, temp dirs
removed; `mock.module("electron")` matches the first suite's core/reconciliation convention;
lazy `import()` of every NEW module inside tests/kits; no `src/` writes; biome clean.

Toy-stub satisfiability (judged, not reproduced — the auditor writes no stub): both authors ran
scratch stubs outside the worktree (A: ~70-line pass-through ledger + hashing artifact owner +
field-forwarding decoder + toy stderr patch → 10/10; B: ~150-line reference ledger → 16/16 with
ten broken variants each caught). Reading the assertions confirms no test passes an
echo-everything stub: S01-b needs owner-port refusal, S03/S17 need hint-aware redaction with
metadata, S07-a needs bare payloads, S43 needs field forwarding without index invention and
without cross-call state, S11/S12 need halt/ack/resume semantics, S32 needs type-preserving
boundary facts. The pass-through satisfiability of S01/S02/S07-a is the scenario contract itself
(vocabulary, order, preservation), not a weakness; F-S1 is the one place where the intended
end state is not fully discriminated.

## 8. Verdict

**CHANGES_REQUESTED** (one P1: F-S1). Apply the one-line tightening in
`tests/run-event-ledger-store-faults.test.ts` S11-memory, re-run
`bun test --isolate tests/run-event-ledger-store-faults.test.ts` (expected 0 pass / 4 fail on
339c4e6e, same failure lines), and the slice is acceptable as `RED_SLICE_ACCEPTED` with F-S2..F-S9
recorded. No other test, fixture or kit needs a change; the `store-faults.json` additive edit,
the immutable set and the conventions are verified clean.

**Closure:** F-S1 applied by the coordinator (see the closure note under the header); slice
**RED_SLICE_ACCEPTED** at the slice commit. Combined red files now: 9 files / 141 tests
(122 RED / 19 green-by-design), 50 of 56 scenarios carry at least one test; S04, S06 (half),
S08, S09, S30 hooks and S41 remain implementer-unit.
