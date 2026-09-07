# Change: Refactor to a Canonical Run Event Ledger

Status: **APPROVED 2026-09-07 (Owner; bound to 9ebe6c34; open questions 1–4 answered as recorded below); implementation queued after add-linked-worktree-admission and add-renderer-untrusted-content-hardening; source edit still requires the test-first red suite (independent author) per repository pilot policy**

## Why

Codex's native decoder currently handles 11 of the 66 notification methods in the
pinned protocol, drops completed item snapshots, and loses retry/correlation data.
Adapter, desktop mapper and job store independently construct event order and terminal
facts. The public API currently hides these internal chains: it already returns one
`completed`, dense per-job sequences and bare redacted semantic payloads for API jobs.
The problem is incomplete evidence and unreliable terminal inference, not a public
Run/Job identity split.

The [trace](../../../docs/native-resume-event-gap-trace-2026-09-04.zh-CN.md) §§0, 5–8
is a non-normative factual baseline; [strategy](../../../docs/ideas/locus-product-direction-harness-strategy.zh-CN.md)
§§9/12 sets Phase 3 direction, and [C2/C5/C7](../../../docs/ideas/locus-interoperability-contract-v1.zh-CN.md)
constrains the execution, interaction and public boundaries. This revision disposes the
second fresh-context review (5 opus dimensions + fable synthesis) against
`9e47e2ddb79e3856d16ba1753d87f1cafd107a8d`, following the first review at `0bd7b2bf`;
that revision record is historical. Owner implementation approval is now recorded below;
no new independent review verdict is claimed.

## What Changes

- Create one ledger in each Run's host process (Electron main or CLI/daemon host),
  ingest all native and system boundaries, and commit records before projection.
- Preserve native thread/session/turn/item/request/call identities independently;
  record correlated resume validation and exact installation/schema provenance.
- Reconcile assistant, reasoning text/summary parts and tool lifecycles against item
  snapshots, with explicit item-state and reconciliation readers.
- **BREAKING — C7 Red R1 (rows 4/5), Owner DIRECT_NEW_STANDARD 2026-09-07:** correct terminal result
  truth and its CLI exit-code consequences: denial/rejected/invalid-empty output is
  failed; a retryable diagnostic alone cannot force a successful Run to failed.
- Keep exactly one terminal, make transport exit a synthetic terminal with provenance,
  and retain post-terminal usage/warnings as diagnostic-only late observations.
- Define cumulative usage, resume baseline, native artifact admission, complete status
  disposition and observable unknown-method loss; correct the existing internal enum
  omission of `artifact_created` without adding a second artifact event.
- Preserve the v1 envelope, bare payload paths, 12 types and dense sequence domain;
  add optional metadata and the `canonical-run-ledger` discovery feature.
- Replace all old event writers/terminal minting call sites atomically; explicitly
  migrate store schema and mark historical rows without inventing historical evidence.

## Non-goals

- Run/Job identity convergence across desktop/headless/scheduler/API constructors and
  its renderer/cancel protocol or static ID-generator guard: C2 §4.4 follow-up, input
  to `add-durable-session-bindings` / Phase 5; existing IDs are used as given here.
- Same-Run transport replacement, lease/epoch/live-attach fencing and Claude one-shot
  handle CAS: Phase 5 continuation input; no replacement window in this change.
- Full Interaction FSM/resolution ledger: `add-durable-agent-interactions`; only ingress,
  response-send and resolved observations are recorded here.
- Async submit, v1.1 request gating and idempotency keys: `add-local-job-api-async-submit`.
- Native rollout writing, 66-method dynamic frequency/total order, SIGKILL/OS restart,
  realtime/remote-control/Windows execution certification: harness conformance follow-up.
- Runtime delivery/update infrastructure, new native protocol selection or capability
  promotion; Codex exec remains the existing headless fallback.

## Canonical Owner, Deletion, Migration, and Verification

| Deliverable | Proposed disposition |
| --- | --- |
| Owner | `agent-runtime/run-provenance.ts` captures the two-stage immutable runtime tuple; `headless/job-recovery.ts` owns stale/death confirmation; `agent-runtime/run-event-ledger.ts` owns facts, sequence, state and settlement; `run-event-ledger-host.ts` composes the store and projections; `run-artifacts.ts` owns admission and manifests. Existing `runtime-events.ts`, `redaction.ts`, `shared/usage-metadata.ts` retain types/redaction/vector normalization. |
| Same-change deletion | Delete `job-event-bridge.ts` / `createAgentJobRunEvent`, the old chunk-to-RunEvent exports and `runEventSequence` wrapper writer (unwrap only for v0 historical reads); remove native default empty projection, adapter/mapping sequence and terminal inference, raw desktop text joins, headless completed suppression, job-store sequence/terminal minting and dispatcher artifact minting. [Design owner inventory](design.md#current-owner-to-target-mapping) enumerates all system, recovery, cancel and completion paths. |
| Migration | `canonicalRunEventLedgerV1` is a build-time implementation gate read only by the host composition module; [design](design.md#migration-plan) defines activation conditions, legacy marking and final deletion. No Run is written by both cores. |
| Verification consumers | Locus-owned Desktop/Workbench, headless/CLI, public batch and interactive conformance fixtures; separately record Career Kit and Amadeus's own adapter/E2E receipts or `unknown`. |

## Consumer Impact

This section follows all ten fields of the [Consumer Impact template](../../../docs/consumer-impact-template.zh-CN.md).

### 1. Gate status

```text
Status: APPROVED 2026-09-07 — R1 = DIRECT_NEW_STANDARD
OpenSpec change: refactor-canonical-run-event-ledger
Author / date: Codex / 2026-09-07
Decision owner: Owner
Implementation queued after: add-linked-worktree-admission and add-renderer-untrusted-content-hardening
Next gate: independent red acceptance-test authoring before source edits
```

Owner APPROVED is bound to design content SHA 9ebe6c34. Governance gates live here
and in tasks, not in living behavior requirements. The deterministic deltas describe
the approved direct-standard behavior; implementation remains queued behind the
two preceding changes and requires the independent test-first red suite.

### 2. One-line change

```text
Current: source=api jobs expose bare redacted payloads, dense per-job sequence, one
  completed, and existing jobId/retry identity; some native facts and terminal evidence are lost.
Proposed: preserve that public shape/order domain, add optional evidence, and correct
  which runs succeed or fail and therefore which CLI exit code is returned.
Why: callers need trustworthy results and loss-aware observations from one durable owner.
```

Public evidence at the reviewed base:
[getLocalJobApiJobOrThrow / getLocalJobApiEvents](../../../src/main/lib/headless/local-job-api.ts)
serve only `source === "api"`;
[createAgentJobRunEvent](../../../src/main/lib/agent-runtime/job-event-bridge.ts)
sets `runId = jobId` and persists `runEvent.payload` bare;
[bridge tests](../../../tests/headless-runtime-event-bridge.test.ts) assert both the bare
`{text:"hello"}` shape and absence of `runEventSequence`.
The desktop-only `{runId, runtimeId, runEventSequence, redaction, payload}` wrapper in
[stream-event-mapper.ts](../../../src/main/lib/agent-runtime/stream-event-mapper.ts)
is C7 §9.1 internal SQLite/renderer projection. Its removal has no public alias or C7
sunset obligation. Historical v0 wrapper decoding remains a read-only data-format branch.
The new public extension pointer is **`/payload/extensions/runtime.codex.v1`**, accessed as
`payload.extensions["runtime.codex.v1"]`. This replaces the previous draft pointer because
`headless/agent-runtime.ts` already emits a string `payload.runtime` in runtime_selected /
runtime_selection_refused status events; that semantic string is preserved.

### 3. Affected public boundaries and C7 classification

| C7 §9.2 row | Classification | Consumer-observable change / evidence |
| --- | --- | --- |
| 1 — deletion/rename | Non-breaking | No public command, field, event or error is deleted/renamed; desktop wrapper removal is internal. |
| 2 — type/requiredness/nullable/enum/default/validation | Non-breaking | No public input validation/default, required field, nullable field or status/event enum changes; the additive discovery feature enum extension is accounted for under row 10; output truth is classified once as R1 under 4/5. |
| 3 — identity | Non-breaking | `jobId` already identifies the API Run; retry already creates a new job with `job.retryOfJobId` and `job.attempt` ([serializer](../../../src/main/lib/headless/cli-output.ts), [schema](../../../docs/local-job-api-v1.schema.json)); these stay unchanged. |
| 4 — lifecycle | **Red R1: Owner DIRECT_NEW_STANDARD 2026-09-07** | Existing succeeded/failed/canceled/interrupted vocabulary and synchronous create/retry waiting remain; denial, rejection and invalid-empty completion become failed, and retry-only diagnostics no longer force failed. See 5 for the same decision's result/exit effects. |
| 5 — ordering/cursor/replay/retry/terminal result | **Red R1 for terminal result only** | Result status and derived create/retry exit codes change for the R1 cases. Additional already-declared event types/optional evidence are additive. Proposed v1 projects EVERY ledger record, including safe status stubs, so sequence remains dense; no sparse-sequence break is taken. |
| 6 — Runtime/provider/model/policy defaults | Non-breaking | Existing selections, fallback and unsupported/degraded states unchanged. |
| 7 — trust/access boundary | Non-breaking | Redaction remains inside the existing promised boundary; no new auth, permission, workspace, filesystem or network grant. R1 is not counted again here. |
| 8 — artifact/ref/digest/retention/access | Non-breaking, additive | Existing run-dir request/events/result/manifest paths, SHA-256 and retention remain; they are already verified today ([fileArtifact](../../../src/main/lib/headless/local-job-api.ts)). Newly admitted native artifacts add entries; no formerly public native candidate is removed. |
| 9 — transport/Host/platform | Non-breaking | No launch, shutdown, packaging or public transport changes; additional feature advertisement uses existing discovery. |
| 10 — mandatory new event/enum/extension or unknown handling | Non-breaking | Twelve public types unchanged; `runtime.codex.v1` schemaVersion 1 is optional and experimental; unknown optional fields remain ignorable under the [guide Stability Contract](../../../docs/local-job-api-v1-consumer-guide.md). No new mandatory extension request is introduced. The living Discovery requirement defines additive feature detection; the published discoveryFeature enum and LOCAL_JOB_API_DISCOVERY_FEATURES are closed today and must be extended in this change. Consumers validating with a pinned older schema copy must refresh it; unknown-field tolerance alone does not cover enum values. |

Row 5's rejected sparse alternative is an actual potential public ordering change:
filtering internal ledger records would make v1 `sequence` sparse relative to today's
`max+1` store. This draft instead emits a redacted `status` stub for such a record at
its original sequence; v1 never renumbers and never skips it. A future sparse design
requires a new R1-independent C7 #5 decision and a consumer-visible gap explanation.

C7 rows 5/8: initial non-native `artifact_created` retains its existing order before
`job_started` on API create/retry after successful initial preparation/admission. A
never-started run retains any such committed event and prepared result/manifest refs;
if initial preparation/admission was not reached or failed, no event is invented.
Only native artifact candidates wait for execution binding; no initial event is moved
or suppressed solely because the Run remains pending.

| Contract / version | Surface | Current | Proposed | Breaking? | Evidence |
| --- | --- | --- | --- | --- | --- |
| `locus.local-job.v1` | runs create/retry, status/result, exit code | Some error/default paths can infer wrong terminal status | Core outcome evidence determines existing statuses; Existing code mapping stays: 0 success, 5 canceled, generic failure/interruption 1; specialized error codes remain 2/3/4/6/7/8 | R1 | [job runner](../../../src/main/lib/headless/job-runner.ts), [exit codes](../../../src/main/lib/headless/job-runner.ts), core terminal delta |
| same | runs events / --after / --follow | Bare payload, dense sequence, one completed, follow stops at terminal | Same contract; fuller tool/status/error evidence; late diagnostics available on explicit reads | Additive except R1 terminal payload | [public reader](../../../src/main/lib/headless/local-job-api.ts), local-job-api delta |
| same | artifact manifest/result | Stable verified Locus run-dir files; no public unverified native candidates | Preserve files; append admitted native entries (document roles `native-file`, `native-image`, `native-diff`) | Non-breaking | same artifact owner, core artifact delta |
| same | discovery / optional payload | features array; ignore unknown fields | Add `canonical-run-ledger`; optional status/usage/error/repair fields and `runtime.codex.v1` | Non-breaking | [Discovery Feature Advertisement](../../specs/local-job-api/spec.md), C7 §9.7–9.9 |

Codex native events consumed directly by Amadeus are Runtime-owned information,
unchanged by this Locus change and outside C7. They are not an additional public-boundary row.

### 4. Current and proposed examples

Current API-job event (shape characterized by the existing bridge test):

```json
{"apiVersion":"locus.local-job.v1","jobId":"job-example","sequence":3,"type":"assistant_delta","createdAt":"2026-09-04T00:00:00.000Z","payload":{"text":"hello"}}
```

Proposed optional additions, with the original semantic field in place:

```json
{"apiVersion":"locus.local-job.v1","jobId":"job-example","sequence":3,"type":"assistant_delta","createdAt":"2026-09-04T00:00:00.000Z","payload":{"text":"hello","extensions":{"runtime.codex.v1":{"schemaVersion":1,"maturity":"experimental","threadId":"th","turnId":"tu","itemId":"msg"}}}}
```

A status payload can retain `"runtime":"codex"` beside the optional `extensions` object;
`public-v1.json` includes pre-binding runtime_selected and runtime_selection_refused
cases that preserve that string but omit `extensions["runtime.codex.v1"]`; binding
does not retroactively add provenance to these committed pending records.
Dense projection increases the number of status records per Run. Consumers page with
`--after` and must not assume a bounded event count; consumers filtering to their
existing non-status event types retain those semantics.

Pure schema diff cannot express R1: a native completed/default-success result with a
recorded denied request becomes `failed`/exit 1; a retry error followed by a live success
and valid output becomes `succeeded`/exit 0. `error` remains evidence, `completed` remains
the sole outcome. An empty output is valid only when the already-admitted internal
output contract explicitly allows it; the default proposed rule rejects empty output.
No new public success status/reason enum or request field is proposed.

### 5. Known consumers and required changes

| Consumer | Use evidence | Affected calls | Required modification | Consumer-owned test/E2E |
| --- | --- | --- | --- | --- |
| Career Kit | [adapter](../../../../career-application-kit/app/electron/runtime/locus-adapter.cjs), [contract](../../../../career-application-kit/openspec/specs/locus-runtime-adapter/spec.md), [historical smoke](../../../../career-application-kit/openspec/changes/archive/2026-06-15-add-career-profile-locus-extraction-mvp/smoke-evidence.md); strategy §2.1 | create/status/result, exit/diagnostics and manifest; event-stream dependency not evidenced | Verify fail-closed result validation and updated R1 expectations; keep domain review/apply gate | Current revision receipt `unknown`; historical smoke is not this change's E2E |
| Amadeus | [strategy §2.2](../../../docs/ideas/locus-product-direction-harness-strategy.zh-CN.md) and its pinned README links; direct native consumption is a **consumer fact from Owner relay, 2026-09-02**, restated by the current dispatch, not a trace conclusion | Locus v1 field/version dependencies `unknown`; direct native path outside Locus C7 | Inventory actual v1 dependencies; evaluate R1 only where Locus is consumed | `unknown`; maintained in Amadeus's repository |
| Other consumers | `unknown` | `unknown` | Publish upgrade evidence and record discovered dependencies | `unknown` |

Locus owns neutral batch/structured-output and interactive event/cursor fixtures;
these are distinct from consumer-owned adapter/E2E tests. Consumer receipts are recorded,
not invented, and do not automatically become a consumer Owner release veto (C9.1).

### 6. Options and costs

| Option | Locus change | Consumer change | Cost | Risk | Deletion condition |
| --- | --- | --- | --- | --- | --- |
| DIRECT_NEW_STANDARD (Owner selected 2026-09-07) | Correct R1 on v1 with feature discovery and updated guide | Coordinate status/exit expectations | Low | Unknown consumers may have false-success assumptions | N/A |
| NEW_VERSION | Separate public serializer over this same core, if separately scoped | Version selection/migration | Medium | Cannot preserve false-success semantics in old version under C7 §9.5 | Explicit old-version sunset |
| TEMPORARY_FACADE | Lossless envelope-only translation over the same core | Parser migration can be staged | Medium | Cannot translate failed to success or run a second terminal state machine; no compatibility solution for R1 | Objective removal condition required |
| DEFER / REJECT | No affected public implementation | None | Delay | Existing evidence gaps remain | New decision |

New-version/facade choices cannot lawfully preserve the unsafe terminal inference R1
removes; meaningful R1 choices are direct correction or defer/reject. No option keeps
an old business core, DB, worker, ledger or artifact lifecycle.

### 7. Compatibility facade boundary

```text
Canonical owner: agent-runtime/run-event-ledger.ts
Old contract/version: locus.local-job.v1
New canonical contract/core: same Run ledger
Allowed translation: none proposed; if selected, parse/validate/serialize only
Explicitly forbidden business logic/state: persistence, sequence, outcome, retry/cancel,
  interaction/policy, auth, dispatch, artifact admission; no false-success translation
Migration flag or gate: N/A unless a lossless public facade is separately specified
Deprecation owner/comment: N/A; implementation gate is not a public facade
Deletion date or objective removal condition: must be filled before any facade is approved
Architecture guard / contract tests: canonical symbol/import pins and facade serializer tests
```

### 8. Release, recovery and rollback

```text
Required release order: Owner C7 decision + APPROVED -> independent red tests ->
  implement/schema/atomic replacement -> green tests/docs/schema -> same-SHA review -> acceptance
Can old consumer call new Locus?: Proposed direct standard preserves parsing, but R1
  assumptions must be coordinated; no claim of old false-success compatibility
Can new consumer call old Locus?: A consumer requiring corrected semantics must check
  features for canonical-run-ledger and refuse an absent feature before dispatch
Unsupported-version error: existing exact-version invalid-request rejection; no guessing
Downgrade behavior: missing required feature/extension is unsupported at consumer
  preflight, not silently honored; v1 has no required-extension request field
Rollback target: the pre-cutover build with a separate disposable test profile; never
  open schema-v1 Runs with the old writer or silently advertise corrected semantics
External data/artifact impact: no consumer DB or repository reset; no artifact retention
  change; legacy rows are marked, not rewritten/purged; staged unreferenced files only
  are recoverable by the run-artifact owner within the admitted run directory
Security impact: no new grants; native metadata is redacted before durable publication
```

### 9. Verification evidence (future implementation)

- [ ] Same-change consumer guides (English/Chinese), machine-readable schema, shared
  generated/public types, feature identifier, examples and error semantics agree.
- [ ] Common-core, dense 12-type v1 and consumer-neutral conformance tests pass.
- [ ] Unsupported version/capability tests and consumer required-feature/extension
  preflight tests fail closed; no unsupported Host extension-negotiation claim.
- [ ] Store cutover, projection cursor recovery, artifact preparation and static owner
  guards pass; public facade tests apply only if a facade is subsequently specified.
- [ ] Consumer-owned receipts/version or `unknown` are recorded separately.
- [ ] Desktop/CLI transport smoke and applicable macOS/Windows packaged evidence are
  recorded without upgrading untested runtime surfaces.

### 10. Owner decision

```text
Decision: R1 = DIRECT_NEW_STANDARD (semantic breaking; BREAKING retained)
Approved exact scope: C7 rows 4/5 terminal-result truth and derived CLI exit codes;
  design content SHA 9ebe6c3410c23575e991d91ee8fb71b95854bea8
Compatibility obligation: same-change consumer guide/schema/examples/error semantics
  and conformance updates (tasks 7.16, 8.1 and 8.2); rejected/invalid-empty runs fail with
  reasons and corresponding exit codes; preserve the existing explicit internal
  allow-empty exception; no false-success compatibility
Sunset/deletion condition: N/A — direct new standard, no public compatibility facade
Consumer coordination required: Amadeus and Career Kit adapt to R1; inventory actual
  dependencies and record consumer-owned receipts or unknown (tasks 1.3 and 8.6)
Owner: Owner
Date: 2026-09-07 (evening decision)
Approval: APPROVED; implementation queued after add-linked-worktree-admission and
  add-renderer-untrusted-content-hardening; next gate: independent red test authoring
```

## Impact

Six capability deltas are affected: agent-runtime-core, architecture-ownership,
local-job-api, desktop-agent-jobs, headless-agent-jobs and codex-runtime-parity.
The implementing slice also migrates Claude desktop event persistence (including SDK
job/startup/state wiring) to the ledger and removes the ambiguous SESSION_EXPIRED
inference/stream-error binding clear; one-shot resume/CAS remains deferred,
and all existing headless/completion/system terminal writers. It does not replace
Run constructors or expand capability claims. Schema/store and artifact preparation
are explicit design additions, requiring their own tests within this change.

The red-first pilot is sourced to the original coordinator dispatch dated 2026-09-05
([verification source index](verification.md#sources)); it is not asserted to be present
in the ratified workflow document. This turn edits only this draft directory and its
STATUS row, creates one local commit, and performs no product/test changes, merge or push.

## Owner answers (2026-09-07)

Owner 2026-09-07 晚裁决，绑定设计内容 SHA `9ebe6c3410c23575e991d91ee8fb71b95854bea8`：

1. R1（C7 rows 4/5 终态真相与 CLI exit code）：**DIRECT_NEW_STANDARD**。被拒／零产出的运行报失败并给原因，退出码跟着变；同变更更新 consumer guide/schema/conformance，已知消费者 Amadeus、Career Kit 适配。此项为 semantic breaking，保留 **BREAKING** 标记。
2. 接受确定性规则：默认空产出 = 失败；既有内部请求显式允许空产出的例外保留；completed 后到的 usage 只作可读诊断。
3. 接受本切片内最小不可变 provenance 快照与 schema v1／`legacy_unverified` 历史标记；采用两阶段规则（入队 pending，实际可执行文件解析时捕获并封存 runtime tuple），不等待 Runtime delivery registry。
4. 接受 v1 稠密序号逐记录 status 投影；每个 Run 的 status 记录会增加，消费者用 `--after` 分页且不假定事件数量上限；终态 artifact 与 completed 同一持久提交登记。

综上 **Owner APPROVED**（实施许可），绑定设计内容 SHA `9ebe6c34`；实施排在
`add-linked-worktree-admission` 与 `add-renderer-untrusted-content-hardening` 之后。
下一门禁为独立作者先编写 red acceptance tests；产品源码编辑仍须先满足
2026-09-05 test-first pilot policy。本次派单仅记录文档，不执行测试编写或产品实现。
