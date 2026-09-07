# Verification

Status: **DRAFT — awaiting Owner APPROVED**

This is documentation-revision evidence plus a future implementation evidence register.
No product code, acceptance test or runtime fixture is implemented by this revision.
Passing document/unchanged-code checks does not mean IMPLEMENTATION_VERIFIED,
REVIEW_APPROVED or Owner ACCEPTED. A fresh review of the revised source remains pending.

## Sources

- Required starting source: `0bd7b2bf2452773d416c7009a208e9590daa679f`, branch
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

## Draft Revision Receipts

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

## Review dispositions

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
Claude one-shot CAS; add-durable-agent-interactions; add-local-job-api-async-submit;
native rollout writer and trace §6.2 dynamic conformance. No deferred work was implemented.
Open Questions have one canonical wording, mirrored in proposal/design (four items).
