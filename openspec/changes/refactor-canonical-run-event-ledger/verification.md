# Verification

Status: **DRAFT — awaiting Owner APPROVED**

This is documentation-revision evidence plus a future implementation evidence register.
No product code, acceptance test or runtime fixture is implemented by this revision.
Passing document/unchanged-code checks does not mean IMPLEMENTATION_VERIFIED,
REVIEW_APPROVED or Owner ACCEPTED. The third re-check below is REVIEW_APPROVED only
for source 4b6ca640288555ca1d94c546ca6bf9d13e4b7fba; it is not a fresh review verdict
on this subsequent documentation touch-up commit. Owner answers/APPROVED remain pending.

## Sources

- Third-revision required starting/reviewed source:
  `9e47e2ddb79e3856d16ba1753d87f1cafd107a8d`; HEAD matched and worktree was clean.
  Current dispatch authorizes one local documentation commit only.
- [Second fresh-context review](/home/chen/.claude/projects/-home-chen-projects-agent-code-for-me/f1888632-cd03-49a0-a57d-51704695f29d/handoff/reviews/run-event-ledger-rereview-9e47e2dd.md),
  workflow `wf_28e60ec0-0f1`: 5 opus dimensions + fable synthesis,
  CHANGES_REQUESTED, 1 P1 + 10 P2 + 10 P3; 58/59 first-review findings resolved,
  SQ-8 partially resolved, no regressions. Its closing summary is reproduced verbatim
  below; prior author responses/receipts remain historical, not current approval.

- Second-revision starting source: `0bd7b2bf2452773d416c7009a208e9590daa679f`, branch
  `codex/refactor-canonical-run-event-ledger-draft`, worktree
  `/home/chen/projects/locus-refactor-canonical-run-event-ledger-draft` (clean at intake).
- [Raw five-dimension review](/home/chen/.claude/projects/-home-chen-projects-agent-code-for-me/f1888632-cd03-49a0-a57d-51704695f29d/handoff/reviews/run-event-ledger-draft-review-0bd7b2bf.md):
  all five verdicts CHANGES_REQUESTED; adversarial verification and synthesis were
  **not completed due to usage limits**. Findings below are raw reviewer claims, not
  an adjudicated composite verdict.
- [Original coordinator brief / L1–L12 / 2026-09-05 test-first pilot](/home/chen/.claude/projects/-home-chen-projects-agent-code-for-me/f1888632-cd03-49a0-a57d-51704695f29d/handoff/dispatch-logs/draft-run-event-ledger.prompt.md).
  The pilot's authority is this dispatch; it is not claimed to appear in AGENTS.md or
  the ratified workflow. Current rewrite dispatch supplies the corrected scope and
  Amadeus consumer-fact attribution (Owner relay 2026-09-02).
- [Trace](../../../docs/native-resume-event-gap-trace-2026-09-04.zh-CN.md),
  [C7 §9](../../../docs/ideas/locus-interoperability-contract-v1.zh-CN.md),
  [Consumer Impact template](../../../docs/consumer-impact-template.zh-CN.md),
  [ownership](../../../docs/OWNERSHIP_MAP.md), living specs and code at the base SHA.

## Second Revision Receipts (historical source 9e47e2dd)

Date: 2026-09-07 (Pacific/Auckland). All source edits are confined to this change
folder and its one STATUS row; even STATUS's global Updated date is left untouched.
Temporary dependency/tool setup is not a source change: the main checkout's existing
node_modules is used for checks, with a temporary untracked symlink removed before handoff;
no package or lockfile is changed.

| Check | Executed command/environment | Result |
| --- | --- | --- |
| Intake | git rev-parse HEAD / branch / status | Required SHA and branch match; working tree clean |
| Draft strict validation | PATH=/home/chen/projects/agent-code-for-me/node_modules/.bin:$PATH bun x openspec validate refactor-canonical-run-event-ledger --strict --no-interactive | Exit 0: `Change 'refactor-canonical-run-event-ledger' is valid` |
| Whitespace | git diff --check | Exit 0, no output |
| Current-code regression gate | bun run check:full, existing dependencies via temporary node_modules symlink | Exit 1: 1925 passed / 3 failed / 9338 expectations / 304 files; three unchanged Codex adapter tests attempt pre-start snapshot scrubbing in read-only /home/chen/.codex/shell_snapshots and fail EROFS; lint/architecture/residue/typecheck passed |
| Source inventory | Only change documents and the STATUS row; six capability deltas | 11 tracked files; all 8 MODIFIED requirements retain their baseline scenario names; 55 unique scenario register rows; 66/10/16 table coverage and local links checked |
| Remaining aggregate steps (run separately after test failure) | bun run spec:validate; bun run build | Exit 0: 53/53 OpenSpec items; production build succeeded |
| Product/new scenario execution | Not performed; future tasks remain unchecked | No implementation or native conformance verdict |

The failing tests are `redacts upstream and gateway echoes from successful response,
tool output, and trace persistence`, `exposes controlled edit dynamic tool on provider-profile
gateway runs`, and `passes provider-profile config through app-server client config without
exposing gateway token` in tests/codex-app-server-adapter.test.ts. No product/test edit
or permission escalation was made to bypass the restricted home path. The aggregate
check is recorded as failed, not relabeled passed by the separate build/spec results.

The final handoff identifies the one local revision commit and rerun validation output.
These authoring receipts do not rewrite the original review's verdict or bind future
implementation to the old source. After the implementing source is frozen, **every**
implementation check and fresh independent review must name that same exact SHA.
No merge/push/remote PR/release was authorized or performed.

## First Review Dispositions (historical author response)

IDs use the raw report's dimension and numbered heading: BA=brief-adherence,
C7=contract-c7, CF=code-fit, TF=trace-fidelity, SQ=spec-quality.
A direct count of `### N. [Px]` headings gives **19 P1, 24 P2, 16 P3**, differing from
this dispatch's aggregate 17 P1 / 25 P2. To deliver the requested **17-row P1 table**,
BA-3, TF-4 and SQ-3 (the identical transport-replacement finding) share one row.
All 19 raw P1 IDs, all 24 raw P2 IDs and all 16 P3 IDs are explicitly disposed below;
no absent 25th P2 is invented. Dispositions are draft-author responses, not reviewer approval.

### P1 dispositions (17 rows, 19 raw IDs)

| Row | Raw finding | Disposition / evidence | Revised location |
| --- | --- | --- | --- |
| 1 | BA-1 public wrapper/identity | Accepted. API reader rejects non-api; bridge persists bare payload with runId=jobId; desktop wrapper is internal. | proposal Consumer Impact §§2–4; local-job-api Stable API Event Stream |
| 2 | BA-2 identity scope expansion | Accepted. Delete cross-constructor identity convergence, mismatch admission and static ID-generator guard; C2 follow-up → Phase 5/add-durable-session-bindings. | proposal Non-goals; design envelope/host contract; tasks 2.1/2.8 |
| 3 | BA-3, TF-4, SQ-3 transport replacement | Accepted jointly. Remove attempt/deadline replacement functions/window from design/spec/tasks/verification; exit supplies synthetic terminal; Phase 5 owns any same-Run replacement. | core Transport exit synthesizes one terminal; design terminal policy; tasks 4.4/7.5 |
| 4 | BA-4 transient governance in living requirement | Accepted. Remove C7-absent scenario and all Owner/gate alternatives from MODIFIED requirements; proposed terminal/late/artifact rules are deterministic. | proposal §1/§10; tasks 1.1; all MODIFIED deltas |
| 5 | BA-5 false preset labels | Accepted. Separate L1–L12 from D1–D10 additions with reasons; simplify to SQLite commit + log/cursors, drop unknown-commit state machine and alias retention. | design two Decisions sections |
| 6 | C7-1 public shape / new headless wrapper break | Accepted. Internal committed envelope does not become public payload; preserve existing semantic fields, remove internal wrapper/alias atomically, extension at /payload/runtime/codex/v1. | proposal examples; headless and local API deltas; tasks 2.3 |
| 7 | C7-2 Amadeus mis-source and false C7 boundary | Accepted with updated dispatch source. Direct-native fact is Owner relay 2026-09-02; no trace attribution, no Locus C7 native boundary/OQ; consumer E2E remains unknown. | proposal Consumer Impact §5; design Source Basis |
| 8 | C7-3 Red rows 3/8 based on false baseline | Accepted. Retry already creates job; public artifacts already stable-file/SHA verified. Identity unchanged, native entries additive, no removed public candidate. | proposal classification rows 3/8, artifacts impact |
| 9 | CF-1 impossible artifact-before-terminal | Accepted; current dispatch selects before-or-same-commit variant. Prepare terminal-dependent files from frozen candidate; commit verified refs and completed together, no final artifact event/hash cycle. | design Artifacts and Terminal Commit Order; core terminal-artifacts scenario; tasks 4.8 |
| 10 | CF-2 desktop/public shape confusion | Accepted. Same code evidence as BA-1/C7-1; public shape and baseline fixed independently of internal migration. | proposal Consumer Impact; public-v1 fixture/task 7.16 |
| 11 | CF-3 incomplete deletion/terminal inventory | Accepted. Include job-runner observer, store system appends, recovery, both pre-start cancel branches, completion, Claude wiring, coarse observers and raw-writer allowlist end state. | design Current Owner to Target Mapping + terminal inventory; tasks 2.8/4.3/8.3 |
| 12 | CF-4 implicit schema/store redesign | Accepted, with corrected evidence path: migrations are drizzle/0000–0023, not src/main/lib/db/migrations/0000–0009. Explicit fact keys/metadata, seal, cursors, legacy marking, late-only exception and reused terminal transaction. | design Durable Schema and Store Invariants; tasks 2.5/2.6/2.9 |
| 13 | TF-1 resume consumption predicates absent | Accepted. Correlated Codex response id/thread equality/independent session/provenance; Claude correlated init relation; no synthesized started, no expired inference, separate later turn failure. | core Native Resume Validation Facts; design Resume; tasks 6.2/6.3/7.9 |
| 14 | TF-2 incomplete status/item taxonomy | Accepted. Explicit 66/10/16 table including all omitted families and non-tool items, known deferred categories distinct from unknown. | design Native Method and Item Disposition; Codex decoder scenario; tasks 5.2/7.7 |
| 15 | TF-3 nonexistent Locus rollout seam | Accepted. Locus store failure commit → reopen → degraded native snapshot; no upstream writer owned by Locus; native limitation remains follow-up. | core Durable failure survives degraded native snapshot; tasks 7.12/7.18 |
| 16 | SQ-1 four unimplementable rollout scenarios | Accepted. Remove three duplicate scenarios; one core Locus durable-store scenario owns rehydration behavior; other capabilities test their own projections/ports. | six deltas; tasks 1.5/7.12 |
| 17 | SQ-2 missing reconciliation observable | Accepted. Define readItem plus committed status/item_reconciliation payload.item/payload.reconciliation including state/text/result/loss/missingStart/suppressed count. | design Test-facing Contract/Item Reconciliation; core L3 scenarios |

### P2 dispositions (all 24 raw findings)

| Raw finding | Disposition / concrete response |
| --- | --- |
| BA-6 | Accepted: complete native table adds plan, hook_lifecycle, model_verification, process and observed_deferred realtime/remote/windows. |
| BA-7 | Accepted: job-event-bridge.ts/createAgentJobRunEvent, insertAgentJobEventRecord and sequence/redaction deletion are explicit inventory/tasks. |
| BA-8 | Accepted: tasks 1.4/7.1 define new files and five-boundary shapes; EVENT-01 inventory, EVENT-02 search and EVENT-03 partial notifications are distinguished. |
| C7-4 | Accepted: rows 2/7 no longer duplicate semantic Red; one R1 under 4/5; facade/new version cannot preserve false success under C7 §9.5. |
| C7-5 | Accepted: name the genuine sparse-sequence alternative and reject it in this draft; every record projects to v1 (safe status stubs), so density is preserved. Completeness/late diagnostics are additive. |
| C7-6 | Accepted: canonical-run-ledger feature, runtime.codex.v1 schemaVersion=1/maturity=experimental; tasks 8.2 updates both guides/schema/types/examples. v1 has no required-extension request field; neutral consumer preflight refuses absent required evidence without claiming new Host negotiation. |
| C7-7 | Accepted: consumer evidence links added; Career Kit result/exit/manifest surface narrowed, current consumer-owned E2E unknown and separate from Locus fixtures. |
| CF-5 | Accepted: every historical row remains byte/identity/sequence-preserved with ledger_version=0/legacy_unverified; no hidden correction or new append; drain active legacy before cutover. |
| CF-6 | Accepted scope concern: remove constructor/renderer ID/cancel flow redesign rather than choose an unmapped minting protocol; separate C2 follow-up. |
| CF-7 | Accepted: nine non-v1 internal types force status subtype equal to original type; public-vocabulary fixture asserts all nine. |
| CF-8 | Accepted: build-time gate mechanism/default/sole reader, six activation conditions, all lifecycle entries, transition and final guard modes plus deletion are concrete in design. |
| TF-5 | Accepted: seal at native terminal ingress, trailing usage stored as late diagnostic with total/last but sealed usage/result unchanged; no timer; tasks 7.6 covers arrival during/after preparation and marks order unmeasured. |
| TF-6 | Accepted: reasoning keys include text vs summary and partIndex; explicit native methods and completed content/summary arrays in tasks 7.2/core scenario. |
| TF-7 | Accepted source correction; **reject recommendation to retain unknown C7 native row**: C7 §9.1 Runtime-native boundary plus current dispatch excludes it; Owner relay 2026-09-02 is a consumer fact, not Locus public contract. |
| TF-8 | Accepted: snapshot-only state cannot prove succeeded for an unsettled Run; no-durable-terminal CODEX-08 fixture plus later exit → interrupted. |
| TF-9 | Accepted: no EVENT-01/02 response/request capture claims; schema-derived synthetic files explicitly defined, CODEX-07 full bodies unknown. |
| TF-10 | **Partially accepted / factual premise rejected with code evidence**: retry fields are absent on event envelopes, so assert job-envelope via runs status; they already ARE public v1 job fields. local-job-api.ts:106–109 types job as ReturnType<typeof serializeAgentJob>; :651–656 invokes it; cli-output.ts:86–89 emits retryOfJobId/attempt; schema:1033–1034/1069–1079 requires/defines them. No new C7 field added. |
| SQ-4 | Accepted: core alone specifies commit/item/terminal/usage/repair behavior; desktop/headless/API/Codex assert specific projections/port forwarding/static decode. Scenario register is one test ID per unique scenario. |
| SQ-5 | Accepted: future checked-in fixture catalog with filenames, evidenceClass/sourceRefs, protocol fingerprints and payload wrappers; no capture bodies fabricated or product tests written during DRAFT. |
| SQ-6 | Accepted: constructor runtimeId/secretHints, full OutcomeEvidence, readItem/readUsage/readOutcome, cursor/ack/deliver and sole host composition specified; constructor convergence removed. |
| SQ-7 | Accepted: exhaustive native method/item table and fixtures cover all 66/10/16, including six non-tool variants. |
| SQ-8 | Accepted: architecture scenarios assert symbol definitions/imports/private insert/legacy residue only; runtime faults/redaction belong to core; transient gates remain design/tasks. |
| SQ-9 | Accepted: explicit job-event-bridge deletion and observer ingress mapping; raw writer end state only run-event-ledger-host imports appendExactRunEventBatch. |
| SQ-10 | Accepted: artifact rejection uses status/artifact_admission result/reason; public gaps prohibited by dense status stubs, so no undefined gap-explainable assertion. |

### P3 dispositions (all 16 raw findings)

| Raw finding | Disposition |
| --- | --- |
| BA-9 | Accepted: retry is preserved existing new-job behavior, not introduced by this change. |
| BA-10 | Accepted: What Changes explicitly marks **BREAKING** R1. |
| BA-11 | Accepted: Run's host process wording covers Electron main and CLI/daemon. |
| BA-12 | Accepted: proposal Impact explicitly names Claude desktop persistence/startup/state migration; resume/CAS remains separate. |
| C7-8 | Accepted: Consumer Impact Status=OWNER_DECISION_REQUIRED, change Status=DRAFT; no governance Bun scenario; facade applicability constrained. |
| CF-9 | Accepted: ledger owns native interrupt/usage state; shared/usage-metadata.ts remains vector arithmetic owner. |
| CF-10 | Accepted: stream-event-mapper.ts becomes only projectRunEventToRendererChunks; run-event-ledger-host.ts composes store/projections. |
| CF-11 | Accepted: working PATH-qualified bun x and direct pinned binary commands recorded; missing local dependencies disclosed. |
| TF-11 | Accepted: reset/decrease fixture expressly defensive synthetic inference, not native measured behavior. |
| TF-12 | Accepted: non-deterministic JSON bundle caveat and reproducible per-file/TS-manifest fingerprint rule included. |
| TF-13 | Accepted: incompatible-schema branch synthetic; resume-not-replay labeled trace inference from no native cursor. |
| TF-14 | Accepted: unique per-call Claude/completion usage accumulates total; last retains call vector and IDs/revisions dedupe. |
| SQ-11 | Accepted: R1 BREAKING marker in proposal. |
| SQ-12 | Accepted: this receipt table is canonical for draft checks; future checks separated; exact per-scenario register replaces misleading grouped table. |
| SQ-13 | Accepted: red-first pilot cites original dispatch explicitly, with no ratified-workflow attribution. |
| SQ-14 | Accepted: retry assertions on job envelope; derived usage field is delta.totalTokens. Also corrected suggested nonexistent runs get to actual runs status. |

Additional read-only corrections while disposing claims: public command is `runs status`,
not `runs get`; `normalizeHeadlessExitCode` gives 5 only to canceled, generic interrupted
falls through to 1, and specialized error mappings 2/3/4/6/7/8 remain intact. These are
code-grounded baseline corrections, not added public behavior. An additional source audit found agent-jobs.ts:89 queued-cancel completeAgentJob,
schedules.ts:346 direct event INSERT/sequence=1, and desktop-runner.ts:48–52 direct
createRunEvent/sequence=0; these are now explicit deletion/rewiring points and the raw
INSERT is statically guarded. Actual migration paths
and retry job typing above take precedence over contradictory raw reviewer claims.

## Scenario Register — Future Independent Red/Green Evidence

Each row below identifies one exact capability/Requirement/Scenario. Independent author
adds one test file/ID and red command/output, then a green command/output at the frozen
implementing SHA. Fixtures are defined in tasks §7; no row is already a passing test.
Third revision: 56 unique scenarios = 38 core + 3 architecture + 3 Codex + 2 desktop +
2 headless + 8 Local Job API. S01–S55 retain their IDs; S56 adds conflict reconciliation.

| ID | Capability / Requirement / Scenario | Test ID / red / green |
| --- | --- | --- |
| S01 | agent-runtime-core / Normalized Agent Events / Event type is emitted | Pending / Pending / Pending |
| S02 | agent-runtime-core / Normalized Agent Events / Runtime emits assistant output | Pending / Pending / Pending |
| S03 | agent-runtime-core / Normalized Agent Events / Runtime emits tool activity | Pending / Pending / Pending |
| S04 | agent-runtime-core / Normalized Agent Events / Runtime reports completion | Pending / Pending / Pending |
| S05 | agent-runtime-core / Normalized Agent Events / Event is serialized for CLI | Pending / Pending / Pending |
| S06 | agent-runtime-core / Normalized Agent Events / Headless process emits coarse output | Pending / Pending / Pending |
| S07 | agent-runtime-core / Normalized Agent Events / Event compatibility is required | Pending / Pending / Pending |
| S08 | agent-runtime-core / Desktop Run Request Contract / Adapter receives desktop request | Pending / Pending / Pending |
| S09 | agent-runtime-core / Desktop Run Request Contract / Adapter emits normalized events | Pending / Pending / Pending |
| S10 | agent-runtime-core / Canonical Run Event Ledger Ownership / All protocol boundaries enter one ledger | Pending / Pending / Pending |
| S11 | agent-runtime-core / Canonical Run Event Ledger Ownership / Durable append fails before acknowledgement | Pending / Pending / Pending |
| S12 | agent-runtime-core / Canonical Run Event Ledger Ownership / Process crashes after commit and before projection | Pending / Pending / Pending |
| S13 | agent-runtime-core / Canonical Run Event Ledger Ownership / Historical rows remain explicitly unverified | Pending / Pending / Pending |
| S14 | agent-runtime-core / Native Identity And Runtime Provenance / Distinct native identities are preserved | Pending / Pending / Pending |
| S15 | agent-runtime-core / Native Identity And Runtime Provenance / Exact runtime provenance follows every event | Pending / Pending / Pending |
| S16 | agent-runtime-core / Native Identity And Runtime Provenance / Interrupt target comes from native Run state | Pending / Pending / Pending |
| S17 | agent-runtime-core / Stateful Ledger Redaction / Runtime splits an exact secret across adjacent events | Pending / Pending / Pending |
| S18 | agent-runtime-core / Item Lifecycle Reconciliation / Assistant deltas reconcile with final snapshot | Pending / Pending / Pending |
| S19 | agent-runtime-core / Item Lifecycle Reconciliation / Reasoning channels and parts reconcile separately | Pending / Pending / Pending |
| S20 | agent-runtime-core / Item Lifecycle Reconciliation / Tool item lifecycle is incomplete or repeated | Pending / Pending / Pending |
| S21 | agent-runtime-core / Diagnostic Error And Terminal Invariants / Retry error is followed by success | Pending / Pending / Pending |
| S22 | agent-runtime-core / Diagnostic Error And Terminal Invariants / Denial rejection and empty output have deterministic outcomes | Pending / Pending / Pending |
| S23 | agent-runtime-core / Diagnostic Error And Terminal Invariants / Transport exit synthesizes one terminal | Pending / Pending / Pending |
| S24 | agent-runtime-core / Diagnostic Error And Terminal Invariants / Pre-start cancel and dead-worker recovery settle through ledger | Pending / Pending / Pending |
| S25 | agent-runtime-core / Diagnostic Error And Terminal Invariants / Usage after completed is diagnostic only | Pending / Pending / Pending |
| S26 | agent-runtime-core / Usage Snapshot Accounting / Usage snapshots are accumulated once | Pending / Pending / Pending |
| S27 | agent-runtime-core / Usage Snapshot Accounting / Resume establishes a usage baseline | Pending / Pending / Pending |
| S28 | agent-runtime-core / Canonical Artifact Admission / Valid artifact candidate is admitted | Pending / Pending / Pending |
| S29 | agent-runtime-core / Canonical Artifact Admission / Invalid artifact candidate is rejected | Pending / Pending / Pending |
| S30 | agent-runtime-core / Canonical Artifact Admission / Terminal files and completed become visible together | Pending / Pending / Pending |
| S31 | agent-runtime-core / Observable Native Methods And Boundary Facts / Unknown native method is observed | Pending / Pending / Pending |
| S32 | agent-runtime-core / Observable Native Methods And Boundary Facts / Interaction boundary is recorded without a second state machine | Pending / Pending / Pending |
| S33 | agent-runtime-core / Native Resume Validation Facts / Codex response validates the requested native thread | Pending / Pending / Pending |
| S34 | agent-runtime-core / Native Resume Validation Facts / Claude correlated init validates resume independently of turn success | Pending / Pending / Pending |
| S35 | agent-runtime-core / Resume Snapshot Repair / Resume snapshot repairs an incomplete item | Pending / Pending / Pending |
| S36 | agent-runtime-core / Resume Snapshot Repair / Durable failure survives degraded native snapshot | Pending / Pending / Pending |
| S37 | agent-runtime-core / Resume Snapshot Repair / Cross-version snapshot reconciliation declares its evidence limits | Pending / Pending / Pending |
| S38 | architecture-ownership / Canonical Runtime Event Mapping Single Path / Second event mapping definition appears | Pending / Pending / Pending |
| S39 | architecture-ownership / Canonical Runtime Event Mapping Single Path / Route or runtime adapter writes job events directly | Pending / Pending / Pending |
| S40 | architecture-ownership / Canonical Runtime Event Mapping Single Path / Guard proves its own detection | Pending / Pending / Pending |
| S41 | codex-runtime-parity / Codex Native Boundary Forwarding And Disposition / Transport forwards protocol boundary shapes | Pending / Pending / Pending |
| S42 | codex-runtime-parity / Codex Native Boundary Forwarding And Disposition / Pinned native surface has complete disposition | Pending / Pending / Pending |
| S43 | codex-runtime-parity / Codex Native Boundary Forwarding And Disposition / Decoder retains channel and native error fields | Pending / Pending / Pending |
| S44 | desktop-agent-jobs / Desktop Jobs Persist Semantic Runtime Events / Desktop stream emits semantic events | Pending / Pending / Pending |
| S45 | desktop-agent-jobs / Desktop Jobs Persist Semantic Runtime Events / Secret-like payload is observed | Pending / Pending / Pending |
| S46 | headless-agent-jobs / Headless Runtime Event Convergence / Batch process event is persisted | Pending / Pending / Pending |
| S47 | headless-agent-jobs / Headless Runtime Event Convergence / Existing event readers remain compatible | Pending / Pending / Pending |
| S48 | local-job-api / Stable API Event Stream / Consumer reads events | Pending / Pending / Pending |
| S49 | local-job-api / Stable API Event Stream / Consumer follows events | Pending / Pending / Pending |
| S50 | local-job-api / Stable API Event Stream / All internal event types preserve dense v1 projection | Pending / Pending / Pending |
| S51 | local-job-api / Run Result and Artifact Manifest / API job completes | Pending / Pending / Pending |
| S52 | local-job-api / Run Result and Artifact Manifest / Run artifact directory is configured | Pending / Pending / Pending |
| S53 | local-job-api / Discovery Feature Advertisement / Consumer detects readiness support | Pending / Pending / Pending |
| S54 | local-job-api / Discovery Feature Advertisement / Older build lacks the feature | Pending / Pending / Pending |
| S55 | local-job-api / Discovery Feature Advertisement / Consumer detects canonical ledger support | Pending / Pending / Pending |
| S56 | agent-runtime-core / Canonical Run Event Ledger Ownership / Cross-process queued cancel races with start | Pending / Pending / Pending |


## Future Implementation Receipts

| Evidence | Required receipt / state |
| --- | --- |
| Owner APPROVED | Proposal section 10 R1 disposition, four Open Questions, exact scope; Pending |
| Code/store | One exact-sequence append path, definite rollback, reopen/ack, legacy marking and post-terminal late-only constraint; Pending |
| Terminal/artifact | All inventory terminal callers, candidate files + same-commit refs, digest graph/failed preparation/recovery; Pending |
| Native/repair | Correlated resume, 66/10/16 static coverage, two reasoning channels, snapshot-only no-success; Pending |
| Static architecture | Owner pins, legacy symbols absent, raw store importer only host; gate/transition branch deleted; Pending |
| Security | Stateful split-secret flush, raw native omitted, scope/digest/ownership admission and no new grants; Pending |
| check:full / strict / diff | Commands rerun on frozen implementing SHA; Pending |
| Manual/packaged | Claude/Codex Desktop/Workbench, headless/completion/CLI and public API smoke; applicable macOS/Windows receipts or explicit limitations; Pending |
| Codex IMPLEMENTATION_VERIFIED | Not issued — no implementing source in this DRAFT |
| Claude fresh REVIEW_APPROVED | Not issued — revised draft review and later implementing review pending |
| Owner ACCEPTED | Not issued; explicit acceptance required after same-SHA technical evidence |
| Merge/push/remote PR/release | Not authorized / not performed |

## Consumer Evidence Ownership

| Owner | Evidence scope | Current revision result |
| --- | --- | --- |
| Locus | Neutral batch/structured-output, interactive events/cursor, dense 12-type v1, feature/maturity, terminal and artifact fixtures | Pending implementation |
| Locus | Desktop/Workbench and headless/CLI projections | Pending implementation |
| Career Kit | Its adapter/version and business E2E (historical links in proposal are background only) | unknown |
| Amadeus | Its adapter/version and E2E, actual Locus v1 dependencies | unknown |
| Other consumer | Inventory and its own receipts | unknown |

## Remaining Red and Deferred Inputs

Remaining Red: **R1, C7 rows 4/5 — terminal result truth and corresponding CLI exit-code
outcomes**. Row 5's sparse-sequence alternative is not selected; dense projection is
specified. Rows 2/3/7/8 are not separate Red changes. Governance approval remains in
proposal/tasks/STATUS, not in living behavior requirements.

Deferred: C2 constructor/renderer identity convergence; Phase 5 replacement/lease/fencing/
Claude one-shot CAS and binding expiry/repair (the ambiguous stream-error classification/clear is addressed in this slice); add-durable-agent-interactions; add-local-job-api-async-submit;
native rollout writer and trace §6.2 dynamic conformance. No deferred work was implemented.
Open Questions have one canonical wording, mirrored in proposal/design (four items).


## Third Revision Dispositions — Second Review Items 1–21

These are author dispositions on the review of `9e47e2ddb79e3856d16ba1753d87f1cafd107a8d`,
workflow `wf_28e60ec0-0f1`. All 21 findings are addressed in this DRAFT; no current P3 is
left undisposed. This does not issue a third-review verdict. A third fresh-context review
of the new committed SHA, followed by Owner APPROVED, is still the next gate.

| Review item | Priority | Disposition and concrete revised location |
| --- | --- | --- |
| 1 | P1 | Accepted two-stage provenance: pending lifecycle records/null job tuple at enqueue, worker claim, queued cancel and never-started recovery; runtime capture at adapter executable resolution, one-time bind and immutable references thereafter. Runtime-required-field rejection applies to runtime construction/binding. NEW run-provenance.ts owns installation identity/executableRef/digest/reproducible schema manifest; no registry. design Test-facing Contract / Durable Schema / owner table; core Native Identity And Runtime Provenance; tasks 2.4–2.5, 6.1, 7.15. |
| 2 | P2 | Inline all 11 forbidden exports in architecture delta. Move the complete 66/10/16 table from design to the parity requirement; design references that normative table. Core defines observable ports/readers directly. No living delta delegates normative content to design/tasks or a not-yet-committed fixture. |
| 3 | P2 | Select internal-only option: historyQuality belongs to the store/Workbench reader; remove public job.ledger.historyQuality addition. design Migration Plan, core historical scenario and tasks 2.9/7.16/8.2 agree. No new public-envelope/C7 addition is implied. |
| 4 | P2 | Replace colliding pointer with /payload/extensions/runtime.codex.v1, i.e. payload.extensions["runtime.codex.v1"]. Keep string payload.runtime in runtime_selected/runtime_selection_refused; proposal example/C7, core identity, local API delta and tasks 7.16/8.2 include collision cases. |
| 5 | P2 | Name job-recovery.ts owner and 120 s stale + same-host absent/observed-exit/never-claimed predicate; alive/EPERM/unknown/claimed-missing-PID is not death. Revalidate claim/heartbeat transactionally, record confidence and basis. Drain/cancel/recover all old queued/running jobs with old build before activation; no v0 writes after cutover. design Store/Migration/owner table; core recovery scenario; tasks 2.9/4.3/7.4. |
| 6 | P2 | Ledger reloads committed header/events, rebuilds state, looks up stable fact keys, re-evaluates intent and re-reserves uncommitted sequences on conflict, at most three attempts. Cancel-first blocks spawn; start-first forwards existing cancel request to worker. Store never re-sequences. design Store Invariants; core new race scenario S56; tasks 2.10/7.8. |
| 7 | P2 | Delete writer-side wrapper only; getWorkbenchSemanticPayload logic remains solely in the ledger_version=0 historical branch of one versioned decoder. v1 uses direct committed records. design D3/owner table/Migration; desktop delta; tasks 2.3/2.9/7.15. |
| 8 | P2 | Label part-index rule 推断/inferred. Stateless decoder preserves proven index or absence; ledger fallback is last summary boundary/default 0 and text/content 0, with indexSource=inferred/lossPossible=true. Verify pinned 0.139 schema before 7.2 freeze. design evidence/reconciliation; core/parity scenarios; tasks 1.4/3.3/7.2. |
| 9 | P2 | Choose in-slice correction: map No conversation found to neutral NATIVE_RESUME_REJECTED; remove SESSION_EXPIRED inference and stream-error sessionId clear. Both Claude error files have owner-table rows/tasks; rejection itself neither settles the Run nor mutates a binding. Full expiry/repair/CAS remains Phase 5. design Resume/owner table; core Claude scenario; tasks 6.3/7.9. |
| 10 | P2 | Vocabulary WHEN explicitly drives ingestRuntimeObservation, admitRunArtifactCandidate and settle; tasks 7.17 requires a per-case port field for owner-gated artifact/terminal inputs. core Event type is emitted. |
| 11 | P2 | Restore the living Older build lacks the feature WHEN/THEN verbatim and generic. The existing Consumer detects canonical ledger support scenario carries this change's IDs; task 7.16 names the actual Locus discovery reader, no invented preflight subject. |
| 12 | P3 | State higher status-event volume, --after pagination and no bounded count assumption in Consumer Impact §4, local API requirement, task 8.2 and identical Open Question 4 in proposal/design. |
| 13 | P3 | C7 row 10 explicitly accounts for the closed discoveryFeature enum/LOCAL_JOB_API_DISCOVERY_FEATURES, same-change extension and consumers refreshing pinned schema copies. Row 2 no longer claims no enum additions at all. task 8.2 names both owners. |
| 14 | P3 | Task 8.3 explicitly records run-artifacts.ts file validation/preparation/writing versus local-job-api capability/serializer ownership of public paths/roles/schema; writer consumes that contract rather than forking it. |
| 15 | P3 | Late observations during preparation retain post-terminal reservations, publish only after terminal commit and point to its terminal slot. Failed preparation keeps one failed candidate in that slot and preserves diagnostics (no discard needed); conflict rebase affects only uncommitted reservations. design Late Policy; core late-usage scenario; tasks 4.5/7.6. |
| 16 | P3 | Resume validated/rejected facts record intent, available observed thread/target-turn statuses and CODEX-05 no-rollout raceContext without changing live outcome. design Resume; core Codex scenario; tasks 6.2/7.9. |
| 17 | P3 | Separate four measured response clauses from ephemeral/path/cliVersion durability evidence. Otherwise valid load remains validated, missing/non-durable evidence sets durableEvidence=false/lossPossible=true. design/core/tasks 7.9 agree. |
| 18 | P3 | Transport exit is a candidate: unsealed settles interrupted; already sealed becomes late diagnostic. Add post-seal exit fixture variant and assertion in core and task 7.5. |
| 19 | P3 | Add missing_local completed-without-local snapshot and missing_native local-absent-from-authoritative-snapshot variants with explicit reconciliation/loss assertions; core repair scenarios and tasks 7.10/7.11. |
| 20 | P3 | readItem accepts complete native key or returned observation-local correlationKey plus channel/partIndex. Missing-ID fixture checks addressability and no merge of unrelated equal-text observations. design contract/reconciliation; core assistant scenario; tasks 3.1/7.2. |
| 21 | P3 | Historical invariant WHEN now opens a store of pre-ledger rows, not a one-time migration act; task 2.9 retains migration work. Fix comma between exported-insert and direct-event-insert architecture variants. This addresses the residual first-review SQ-8. |

Unaddressed P3 and reasons: **none**. R1 and the four mirrored Open Questions remain
Owner decisions; this author response does not resolve or approve them.

## Third Revision Receipts

Date: 2026-09-07 (Pacific/Auckland). Required base/reviewed source:
`9e47e2ddb79e3856d16ba1753d87f1cafd107a8d`. Scope: this change directory plus the single
STATUS row only; product code, tests, fixture files, living specs, package/lock files
and global STATUS Updated date are untouched. Tasks/fixture descriptions remain future
approved work. Existing dependencies are temporarily linked for checks and the link
is removed before commit. The final local source SHA is the commit containing this
receipt (reported in the handoff); it must receive its own fresh review.

| Check | Command / evidence | Result |
| --- | --- | --- |
| Intake | pwd; git rev-parse HEAD; git status --short | Required worktree/SHA, clean |
| Single strict | PATH=/home/chen/projects/agent-code-for-me/node_modules/.bin:$PATH openspec validate refactor-canonical-run-event-ledger --strict --no-interactive | Exit 0: Change 'refactor-canonical-run-event-ledger' is valid |
| All strict | PATH=/home/chen/projects/agent-code-for-me/node_modules/.bin:$PATH openspec validate --all --strict --no-interactive | Exit 0: Totals: 53 passed, 0 failed (53 items) |
| Whitespace | git diff --check | Exit 0, no output |
| Document consistency | Unique scenario/register mapping; MODIFIED baseline names; inline native table vs trace; JSON examples; identical ≤5 Open Questions; source scope | Passed: 56 scenarios/56 rows; 66/10/16 table preserved exactly; 4 mirrored questions; 21 dispositions; exact summary; 10 changed documents/one STATUS row |
| Required current-code gate | bun run check:full (temporary existing-dependency link) | Exit 1: 1925 pass / 3 fail / 9338 expectations / 304 files; same three Codex snapshot EROFS failures as second revision; lint/architecture/residue/typecheck passed |
| Interrupted aggregate build step, run separately | bun run build | Exit 0: main/preload/renderer production build succeeded |
| Independent third review / implementation / product smoke | Not performed; this remains a pure-document DRAFT | No IMPLEMENTATION_VERIFIED / REVIEW_APPROVED / Owner acceptance |
| Git authority | One local docs commit only | No merge/push/remote PR/release |

The three failed tests are the exact second-revision test names listed above; each
throws CodexAppServerShellSnapshotScrubError during pre-start with `scrub snapshot entry:
EROFS` in the restricted home snapshot area. Product/test code is unchanged. The aggregate
is **failed**, not converted to a pass by separate strict/build results; no out-of-scope
fix or permission escalation was attempted. Native/manual/packaged implementation smoke
is not applicable to this unapproved documentation revision and is not claimed passed.

## Second Review Receipt — Verbatim Closing Summary

Source: the full second-review file indexed above; reviewed SHA
`9e47e2ddb79e3856d16ba1753d87f1cafd107a8d`, workflow `wf_28e60ec0-0f1`.
The text below is the original closing summary, including historical line references
and recommended defaults. It records that review, not a verdict on this revision.

```text
## Second fresh-context draft review

Reviewed SHA: `9e47e2ddb79e3856d16ba1753d87f1cafd107a8d` (one docs-only commit over `0bd7b2bf`; 11 files, +1736/−2006; strict validate exit 0; `git diff --check` exit 0). Five dimension reports (BA, C7, CF, TF, SQ) merged by one synthesizer who re-checked the sole P1 in the documents and code.

**Verdict: CHANGES_REQUESTED** — 0 P0, **1 P1**, 10 P2, 10 P3. Approval-blocking work is a single, bounded document fix (item 1); everything else is touch-up.

**Prior findings:** 58 of 59 first-round findings resolved with checkable evidence; SQ-8 partially resolved (residual is P3 item 21). No regressions. Highlights: Consumer Impact rebuilt on the real public v1 shape (bare payload, source=api, jobId = Run id, one dense sequence); identity convergence and the transport-replacement window removed and registered as Non-goals with real sibling change ids; no gate/Owner state in living requirements; L1–L12 presets separated from labelled D1–D10 additions; 66/10/16 disposition table machine-checked against the trace; resume predicates, late-usage seal, reconciliation carrier, schema/migration path, deletion inventory and the build-time gate all concrete; 12-type v1 vocabulary frozen; 55 scenarios = 55 register rows.

### Findings
1. **[P1] Provenance capture point/owner** — design.md:128-132/156-157/193 and core delta:138-139 require a runtime provenance tuple with binary digest at ledger construction and make `ledger_provenance_json` non-null for every v1 job, while design.md:484/486-487/490 and the architecture delta route `job_created`, scheduled creation and pre-start cancel through that ledger at enqueue time, where no binary is resolved (job-store.ts:302-368; schedules.ts:346-351; agent-jobs.ts:88-96) and no digest facility or owner row exists (runtime-executable.ts stats only; no installation/digest symbol in src/). Fix: add a provenance-owner row + task; two-stage rule (`kind:"pending"` for lifecycle-only records, runtime tuple captured when the adapter resolves its executable and sealed thereafter); scope the construction rejection to runtime-execution ledgers; design.md:193 → nullable for legacy and never-started jobs.
2. **[P2] Living requirements by reference** — architecture delta:12-13, parity delta:6-7/20, core delta:8-9 delegate normative lists to design/tasks, which are not living after archive (AGENTS.md:271). Inline the deletion list; point the parity requirement at the checked-in fixture.
3. **[P2] `job.ledger.historyQuality`** — new optional public job-envelope field named only at design.md:520-521; no local-job-api delta, no C7 row, not in tasks 8.2. Declare and classify it, or scope it internal.
4. **[P2] `/payload/runtime/codex/v1` collision** — `payload.runtime` is already a string in runAgentTask status events on the default API path (agent-runtime.ts:18-40). Coordinator preset with new code evidence: move to `payload.extensions["runtime.codex.v1"]` or state a collision rule plus fixture case.
5. **[P2] "Confirmed dead-worker" predicate** — undefined; today's detection is heartbeat-only (job-recovery.ts; job-store.ts:645-700), workerPid never probed; v0 rows left running become unsettleable after cutover (core delta:116-117; design.md:513). Name the predicate, owner and v0 drain disposition.
6. **[P2] Cross-process conflict reconciliation** — store re-sequencing deleted (design.md:200-204) with only "runtime tests enforce exclusivity" (design.md:533) for the queued-cancel/start race today's withEventSequenceRetry handles (job-store.ts:234-245; agent-jobs.ts:88-96). State reload/re-reserve/idempotent-resubmit or single-process writer rule.
7. **[P2] Task 2.3 vs 2.9/7.15** — atomic deletion of the Workbench wrapper reader (the sole unwrap, workbench-trace-presenter.ts:202-209) contradicts the versioned-decoder migration plan. Keep the unwrap as the ledger_version=0 read branch.
8. **[P2] Reasoning part index** — design.md:232-233 selects `content[partIndex]`/`summary[partIndex]` but the pinned delta params carry no index (app-server-stream-events.ts:51-58); label as inferred and state the fallback.
9. **[P2] Claude SESSION_EXPIRED** — trace §0/§4 obligation has no disposition; classifier still upgrades and clears the binding (agent-sdk-errors.ts:129-138; stream-error-finalization.ts:119-151). Add an inventory row or an explicit Deferred line.
10. **[P2] One-port WHEN** — core delta:11-20 drives vocabulary.json through `ingestRuntimeObservation` alone while requiring artifact/terminal owner ports. Name all three ports / per-case `port` field.
11. **[P2] Discovery scenario narrowing** — local-job-api delta:79-83 replaces the generic living 'Older build lacks the feature' with this change's ids and an unowned 'preflight fixture'. Restore generic wording; name a Locus subject if kept.
12. [P3] Dense projection status-volume increase not stated to consumers (proposal.md:115/122-126; tasks 8.2).
13. [P3] Row 10 rationale ignores the closed `discoveryFeature` enum (schema:106; local-job-api.ts:18-25).
14. [P3] run-artifacts.ts under agent-runtime writes public v1 files; ownership split unrecorded in 8.3.
15. [P3] Commit ordering of late diagnostics between seal and terminal commit unstated (design.md:208-212/271-273/322-345).
16. [P3] Resume fact omits observed thread/turn status, intent and the CODEX-05 race (design.md:354-361; core delta:320-327).
17. [P3] Design vs scenario disagree on ephemeral/path/cliVersion rejection (design.md:355-359; core delta:320-327).
18. [P3] Transport-exit SHALL is unconditional vs the post-seal late-diagnostic rule (core delta:195-197; design.md:283-285).
19. [P3] `missing_local`/`missing_native` never asserted (core delta:164-165).
20. [P3] `readItem` key cannot address items with absent native IDs (design.md:146, 231-232).
21. [P3] Migration-act WHEN in a living scenario (core delta:112) and a run-on fixture list (architecture delta:33-34) — SQ-8 residual.

### Owner decision items (remaining Red + open questions, with recommended defaults)
- **R1 / Open Question 1 — C7 rows 4/5 terminal-result truth and derived create/retry exit codes.** Recommended default: **DIRECT_NEW_STANDARD** (NEW_VERSION and TEMPORARY_FACADE cannot preserve false success under C7 §9.5; the exit-code table is unchanged; the change ships behind the `canonical-run-ledger` feature id with same-change guide/schema/examples and explicit consumer notice).
- **Open Question 2 — deterministic rules: default empty-output failure with the existing explicit allow-empty internal exception; post-completed usage diagnostic-only.** Recommended default: **accept** (matches preset L4 and D6; the trace marks late-usage order unmeasured, so a deterministic seal is the only testable rule).
- **Open Question 3 — minimal immutable provenance snapshot plus schema v1 / legacy-unverified marking in this slice, without a Runtime delivery registry.** Recommended default: **accept, conditioned on item 1** (two-stage capture: pending at enqueue, runtime tuple sealed when the adapter resolves its executable; named owner for digest/fingerprints; L8 preset is preserved).
- **Open Question 4 — dense per-record v1 status projection and terminal-artifact registration in the same durable commit as `completed`.** Recommended default: **accept** (only alternative is a sparse-sequence C7 #5 break; the artifact rule is now implementable), with the status-volume consequence (item 12) stated to consumers.
- Coordinator item (preset, not an Owner gate): item 4 pointer collision — recommended default `payload.extensions["runtime.codex.v1"]`.

Next gate: revised draft addressing item 1 (and the P2 touch-ups as convenient), then a third fresh review, then Owner APPROVED. Nothing here authorizes push, merge, remote PR or release.
```

## Third Fresh-Context Re-check — 4b6ca640 (prev 9e47e2dd)

Targeted re-check of third revision `4b6ca640288555ca1d94c546ca6bf9d13e4b7fba`: HEAD matched,
worktree clean, docs-only diff (10 files, +627/-167), `git diff --check` exit 0. Verdict
**REVIEW_APPROVED** — 0 P0, 0 P1, 2 P2, 5 P3. The second review's P1 (provenance capture
point/owner) is resolved: the two-stage pending/runtime rule is consistent across design,
the agent-runtime-core and architecture-ownership deltas, tasks 2.4/2.5/6.1/7.15 and the
never-started fixtures, with `run-provenance.ts` as a named owner row plus guard pin, and
red tests are now writable for job_created, queued-cancel, never-started and runtime-backed
records. All 10 P2 items applied; the 10 P3s disposed; no regression of the 58 first-round
resolutions (public shape, transport-replacement removal and gate-free living requirements
all re-verified). Strict validation exit 0 single and `--all` (53 passed, 0 failed);
56 scenarios = 56 register rows S01–S56. New P2s (non-blocking, fix before implementation):
(1) design.md:174-176/429-431 make initial `artifact_created` publication wait for execution
binding, unqualified, while core spec.md:164-165 rejects only *native* candidates — today
cli-dispatcher.ts:458-472 emits that event before any executable resolution, so the rule
reorders an already-public event and drops it for never-started runs with no C7 line;
(2) design.md:168/543 and tasks.md:149/154 name `runtime-executable.ts` (only
`getRuntimeExecutableStatus`, never called by an adapter on a run path) as the capture seam
instead of `codex/cli-path.ts:58` and `claude/env.ts:157`. P3s: private
`persistedPayloadForRunEvent` labelled an export; `runtime_selected`/`runtime_selection_refused`
emitted pre-binding; retry budget silently 5→3; unreachable `SESSION_EXPIRED` renderer card
unaudited; `captureRunExecutionProvenance` absent from the guard fixture inventory. R1 and
the four Open Questions remain Owner decisions. Nothing here authorizes push, merge, remote
PR, release or Owner product acceptance.

## Third Re-check Touch-up Dispositions — 2 P2 + 5 P3

Input: [targeted re-check report](/home/chen/.claude/projects/-home-chen-projects-agent-code-for-me/f1888632-cd03-49a0-a57d-51704695f29d/handoff/reviews/run-event-ledger-recheck-4b6ca640.md).
Intake HEAD matched `4b6ca640288555ca1d94c546ca6bf9d13e4b7fba`, with a clean worktree.
The ledger entry above is copied verbatim from report §6. These are author dispositions
of its new findings, not a new independent verdict or Owner decision.

| Finding | Disposition | Updated evidence |
| --- | --- | --- |
| P2 #1 — initial artifact ordering | Applied: only native candidates wait for binding; admitted non-native initial artifact_created keeps its order before job_started. Never-started runs retain any committed initial event/refs; no event is invented when preparation/admission was not reached or failed. | design two-stage capture and terminal artifact step 3; proposal Consumer Impact C7 rows 5/8 clause; core provenance delta; tasks 7.16 |
| P2 #2 — provenance capture seam | Applied: capture the actual executable resolved by codex/cli-path.ts:58 resolveBundledCodexCliPath and claude/env.ts:157 getBundledClaudeBinaryPath at their run launch callers; runtime-executable.ts is status/readiness query only. | design two-stage capture and owner row; tasks 6.1 |
| P3 #1 — private helper called export | Applied: distinguish legacy exports and internal helpers; persistedPayloadForRunEvent is explicitly module-private, with unchanged no-definition/re-export/call-site guard. | architecture-ownership delta; design mapper owner row |
| P3 #2 — pre-binding selection status | Applied: runtime_selected/runtime_selection_refused are pending-admissible host status; preserve payload.runtime strings, omit runtime.codex.v1 extension before binding, never retrofit committed records. | design pending admission; core provenance and local-job-api deltas; tasks 7.16 |
| P3 #3 — retry budget 5→3 | Applied: retain three attempts and explicitly identify the deliberate replacement of today's five-attempt EVENT_SEQUENCE_RETRY_LIMIT. | design conflict reconciliation |
| P3 #4 — unreachable SESSION_EXPIRED card | Applied: audit the union and ipc-chat-transport.ts card in 8.3; replace the path with neutral NATIVE_RESUME_REJECTED / “Session resume rejected”, remove dead category/card, preserve sessionId and avoid expiry/fresh-session claims. | tasks 8.3; existing 6.3 correction remains |
| P3 #5 — provenance guard fixture | Applied: name captureRunExecutionProvenance clean-owner, duplicate-definition and re-export fixtures plus host-only composition/binding checks. | tasks 7.17 architecture-fixtures.json inventory |

R1 and all four mirrored Open Questions remain unchanged and require Owner answers plus
APPROVED before implementation. This dispatch creates one local documentation commit;
no product/test implementation, merge, push, remote PR mutation or release is performed.

## Third Re-check Touch-up Receipts

Date: 2026-09-07 (Pacific/Auckland). Checks cover the documentation tree prepared
from `4b6ca640288555ca1d94c546ca6bf9d13e4b7fba` for the single local commit titled
`docs(openspec): apply re-check touch-ups to canonical run event ledger draft`.
The resulting commit SHA is reported in the handoff; no implementing-source technical
verdict is claimed. Only eight documentation files change: this change directory and
its one STATUS row. Product/test files and the four Open Questions are unchanged.

| Check | Command / environment | Result |
| --- | --- | --- |
| Single strict validation | /home/chen/projects/agent-code-for-me/node_modules/.bin/openspec validate refactor-canonical-run-event-ledger --strict --no-interactive | Exit 0: `Change 'refactor-canonical-run-event-ledger' is valid` |
| All strict validation | /home/chen/projects/agent-code-for-me/node_modules/.bin/openspec validate --all --strict --no-interactive | Exit 0: `Totals: 53 passed, 0 failed (53 items)` |
| Whitespace | git diff --check | Exit 0, no output |
| Documentation inventory | Scripted scope/STATUS-row check, report §6 exact-text comparison, disposition and scenario counts, Open Questions comparison against intake HEAD | Pass: 8 documentation files, only the target STATUS row, verbatim ledger, 7 dispositions, 56 scenarios, all 4 Open Questions unchanged |
| Current-code regression gate | bun run check:full using the main checkout's existing node_modules through a temporary symlink, removed after the check | Exit 1: 1925 passed / 3 failed / 9338 expectations / 304 files. Lint, architecture, retired-runtime residue and typecheck passed; the same three unchanged Codex adapter tests recorded above fail during pre-start snapshot scrubbing with EROFS. The aggregate stops at tests, so its build/diff stages did not run; strict validation and git diff --check ran separately. |
| Product / manual smoke | Not run: documentation-only DRAFT; no approved product implementation | No product, runtime conformance or Owner acceptance claim |

Full aggregate output: `/tmp/run-event-ledger-touchups-check-full.log` (local diagnostic
receipt). No package/lockfile change, product-code workaround or permission escalation
was used. The historical REVIEW_APPROVED stays bound exclusively to `4b6ca640`; these
receipts do not transfer that independent verdict to the touch-up commit.
