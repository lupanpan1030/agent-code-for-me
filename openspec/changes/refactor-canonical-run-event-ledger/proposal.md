# Change: Refactor to a Canonical Run Event Ledger

Status: **DRAFT — awaiting Owner APPROVED**

## Why

The Codex app-server path currently projects only a small subset of native
notifications, silently drops unknown methods and completed item snapshots, loses
retry and native correlation metadata, and lets adapters, stream mappers, and job
persistence allocate or reconstruct separate event and terminal histories. The
result is not a trustworthy Run record: text can be duplicated when final snapshots
are added, retry diagnostics can become failures, headless execution strips the
canonical envelope, and persistence can mint a second `completed` event.

Phase 3 requires one loss-aware, resumable ledger before async submit or durable
interaction work builds on the Run abstraction. The factual baseline is the
[native/resume event gap trace](../../../docs/native-resume-event-gap-trace-2026-09-04.zh-CN.md),
especially §§0, 6–8; the direction and sequencing come from the
[Phase 3 strategy](../../../docs/ideas/locus-product-direction-harness-strategy.zh-CN.md)
§§9 and 12 and the [interoperability contract](../../../docs/ideas/locus-interoperability-contract-v1.zh-CN.md)
§§4, 7, and 9.

## What Changes

- Introduce one main-process canonical ledger owner per Run. It ingests JSON-RPC
  responses, notifications, server requests, response-send/resolved boundaries,
  snapshot repairs, and transport exits, and assigns the only canonical `sequence`
  at ingestion. Atomic durable append is the acknowledgement/visibility barrier;
  projections resume from committed sequence after failure or crash.
- Converge renderer, durable, event, and Local Job API attempt identity on one
  canonical `runId`; legacy/public `jobId` is an equal compatibility alias, and each
  retry creates a new ledger/ID with source-chain provenance.
- Preserve redacted native identity separately from canonical Run identity, including
  distinct `threadId` and `sessionId`, and bind every record to exact runtime binary
  and protocol/schema provenance.
- Reconcile assistant, reasoning, and tool items with a loss-aware
  `started -> delta* -> completed` state machine whose completed snapshot is the
  authoritative comparison point, without appending final text twice.
- Make errors diagnostic evidence until the ledger settles exactly one terminal
  `completed`; retain retry metadata, synthesize transport-exit terminals with
  provenance after an unplanned/expired/mismatched exit, permit only a bounded
  same-Run replacement registered before exit to repair before settlement, make late
  events observable, and prevent denial, rejection, or invalid zero-output runs from
  reporting unqualified success.
- Define usage events as cumulative snapshots with an explicit last observation,
  deduplication identity, discontinuity handling, and a resume baseline.
- Treat native file, diff, image, and path data as artifact candidates. Only the
  canonical artifact owner may emit the existing `artifact_created` event after
  scope, ownership, existence, digest, and redaction checks.
- Map every native method to a ledger fact. Known lifecycle categories use stable
  `status` subtypes; unknown methods produce a sanitized unknown/loss observation
  instead of an empty projection.
- Mark native resume snapshot reconciliation as `repair.source=snapshot`, with
  loss possibility and reconciliation results; it is never described as replay.
- Replace the current adapter/mapper/persistence double chains atomically behind an
  implementation-only per-Run migration gate, then delete the legacy branch and the
  gate before acceptance.
- Correct the internal `Normalized Agent Events` specification to include its already
  existing `artifact_created` event. No second artifact vocabulary is created.

## Non-goals

- The complete Interaction state machine and resolution ledger are deferred to
  `add-durable-agent-interactions`. This change records only server-request ingress,
  response-send, and resolved boundary facts.
- Lease, epoch, live-attach fencing, and Claude one-shot handle compare-and-set are
  deferred to the Phase 5 continuation slice.
- Async submit, `locus.local-job.v1.1` request gating, and idempotency keys are deferred
  to the sister change `add-local-job-api-async-submit`.
- Dynamic frequency and total-order characterization of all 66 Codex notifications is
  not claimed here; the unmeasured trace §6.2 cases remain follow-up conformance input.
- This draft does not implement, merge, push, or change product code or tests.

## Canonical Owner, Deletion, Migration, and Verification

| Delivery question | Proposed answer |
| --- | --- |
| Canonical owner | New `src/main/lib/agent-runtime/run-event-ledger.ts`, one instance per Run, with `runtime-events.ts` as envelope/type owner, `redaction.ts` as redaction-algorithm owner, and new `src/main/lib/agent-runtime/run-artifacts.ts` as the only artifact admission/manifest lifecycle owner. |
| Old paths deleted in the same implementation change | Native mapper default `[]`; adapter/stream-mapper sequence allocators and terminal state; raw desktop text concatenation; headless envelope stripping and completed suppression; job-store re-sequencing and second terminal minting; thread/session fallback; CLI dispatcher direct `artifact_created` and final manifest registration; any non-owner candidate-to-artifact emission. |
| Migration gate | An implementation-only `canonicalRunEventLedgerV1` selection at Run construction. A Run uses legacy or ledger, never shadow dual-write. Characterization and commit/crash fault tests land red first, then the atomic cutover occurs, then the legacy branch and gate are removed before acceptance. |
| Verification consumers | Desktop/Workbench and headless/CLI projections; Local Job API v1; Amadeus native-event fixtures; Career Kit batch/structured-output fixtures; other consumers recorded as `unknown`. |

The exact current-owner-to-target mapping and stop conditions are defined in
[design.md](design.md). This satisfies the strategy §12 requirement that each split
declare its owner, deletion point, migration gate, and verification consumer.

## Consumer Impact (C7 §9.2)

### Gate status and one-line change

```text
Status: DRAFT (OWNER_DECISION_REQUIRED before implementation)
OpenSpec change: refactor-canonical-run-event-ledger
Author / date: Codex draft / 2026-09-06
Decision owner: Owner
Implementation blocked until: Owner records §10 decision for every Red row
```

```text
Current: Local Job API v1 may receive an incomplete, independently resequenced Run
history whose nested renderer identity, terminal, retry, resume, and artifact facts are
reconstructed downstream.
Proposed: v1 keeps its envelope and 12 event types but projects one canonical Run
identity and a complete optional-metadata view of one durably committed ledger with
stricter completion and artifact truth.
Why: Consumers need one loss-aware cursor and terminal result that survive restart.
```

The public Local Job API v1 event vocabulary remains exactly these 12 values:
`job_created`, `job_started`, `assistant_delta`, `reasoning_delta`, `tool_started`,
`tool_delta`, `tool_finished`, `usage_update`, `artifact_created`, `status`, `error`,
and `completed`. Existing envelope fields remain unchanged; native identity,
provenance, reconciliation, repair, loss, and status-subtype fields are optional,
namespaced, redacted payload additions. The pre-existing optional
`payload.runEventSequence` member is retained as a deprecated alias equal to envelope
`sequence`, not as a second cursor; deleting it would require a later C7 decision. The
optional internal `RunEvent.payload.runtime.codex.v1` namespace appears through the
preserved v1 wrapper at `/payload/payload/runtime/codex/v1`; it is not flattened. The
following classification applies to every
item in C7 §9.2 rather than treating the internal refactor as automatically private.

| C7 public-change class | Classification | This change |
| --- | --- | --- |
| 1. Public name deletion or rename | **Non-breaking** | No command, route, field, event type, or public identifier is deleted or renamed. Amadeus native-surface identity still needs the Owner clarification below. |
| 2. Type, requiredness, default, or validation change | **Owner decision needed — C7 Red** | Completion truth can change status/default outcome for denial, rejection, and invalid zero-output runs. Artifact admission tightens validation. No optional payload member becomes required and nullable public artifact fields stay nullable unless separately approved. |
| 3. Identity or uniqueness semantics | **Owner decision needed — C7 Red** | C2 requires internal/event/public `jobId` to equal the one canonical `runId`, but current desktop code can expose an independently generated renderer `runId` in the event payload. Retry also becomes a new Run/ledger rather than mutating an attempt. Public envelope `jobId` remains stable, but the observable nested identity must converge. |
| 4. Lifecycle, terminal, retry, cancel, or status semantics | **Owner decision needed — C7 Red** | Exactly one terminal, diagnostic retry errors, synthetic transport-exit completion, completion truth, and the late-event policy change observable lifecycle semantics. |
| 5. Ordering, cursor, replay, idempotency, retry, or terminal-read semantics | **Owner decision needed — C7 Red** | Ledger ordering, durable-commit visibility/recovery, complete event projection, delta/final reconciliation, resume repair, usage dedupe, and unknown/loss observations alter the observable event history even though `--after` remains the same opaque cursor contract. |
| 6. Runtime/provider/model/policy default | **Non-breaking** | Runtime, provider, model, and policy selection defaults do not change. |
| 7. Security, trust, approval, or access boundary | **Owner decision needed — C7 Red** | Artifact eligibility and redaction are tightened, and denied/rejected execution can no longer be presented as success. Full interaction policy remains out of scope. |
| 8. Artifact path, reference, digest, retention, or access | **Owner decision needed — C7 Red** | Only verified run-owned artifacts become visible and receive a digest; unverified native candidates no longer qualify. Public manifest shape and retention policy otherwise remain unchanged. |
| 9. Transport, Host, platform, or deployment support | **Non-breaking** | No public transport, Host requirement, platform, or deployment surface changes. Transport exit is covered under lifecycle semantics above. |
| 10. Any externally observable behavior | **Non-breaking only under stated constraint** | Stable `status` subtypes and namespaced metadata are optional and unknown-safe. Their increased frequency and the semantics already identified in rows 2, 3, 4, 5, 7, and 8 remain Red and are not hidden in this row. |

The Red rows block implementation approval until the Owner explicitly chooses one of
C7's compatibility dispositions (`DIRECT_NEW_STANDARD`, `NEW_VERSION`,
`TEMPORARY_FACADE`, `DEFER`, or `REJECT`) for the affected public behavior. This draft
recommends keeping the 12-type v1 vocabulary and optional payload shape, but it does not
make that Owner decision.

### Affected public boundaries

| Contract / version | Surface | Current behavior | Proposed behavior | Breaking? | Evidence |
| --- | --- | --- | --- | --- | --- |
| `locus.local-job.v1` | `runs events`, `--after`, `--follow` | Stable envelope/12 types; downstream DB order can be reconstructed from a partial trace | Same envelope/12 types and opaque cursor, but complete canonical order, retry diagnostics, one completion, optional namespaced payload | **Owner decision needed — C7 Red rows 4/5** | Local API and runtime-core delta scenarios |
| `locus.local-job.v1` | Run/Job identity and retry provenance | Envelope `jobId` is durable while nested renderer `runId` can be independently generated | One attempt has one `runId`; event/public `jobId` is an equal compatibility alias; retry gets a new ledger/ID and source chain | **Owner decision needed — C7 Red row 3** | C2 §4.3–4.5 and identity scenarios |
| `locus.local-job.v1` | result status, CLI exit/retry interpretation | Missing/error/zero-output paths can default to or be reconstructed as success | Result derives from the ledger's only completion; denial/rejection/invalid missing output is not bare success | **Owner decision needed — C7 Red rows 2/4** | `Run Result and Artifact Manifest` delta |
| `locus.local-job.v1` | artifact event and manifest | Native evidence can be incomplete and admission is not one canonical lifecycle | Only verified, in-scope, digested, run-owned candidates are emitted/manifested | **Owner decision needed — C7 Red rows 7/8** | Artifact admission scenarios |
| `locus.local-job.v1` | event payload | Payload internals are open/unknown-safe | Adds only optional redacted native/provenance/repair/reconciliation/subtype fields | **Non-breaking**, conditional on remaining optional | v1 vocabulary scenario |
| Codex app-server native stream | Amadeus direct consumption | Direct native event consumption is reported by the trace; support status is undocumented | Native facts remain available at ledger ingress, but order/coverage and consumer integration may change | **Unknown; Owner decision needed** | Trace §§5–6 and consumer fixture receipt pending |
| Commands/endpoints/SDK/request transport | create/read/cancel invocation | Existing synchronous commands and request shapes | No change in this proposal | **Non-breaking** | Negative scope assertion/contract tests pending |

Public error/exit/retry effects follow the result and lifecycle rows above. Runtime,
provider, model, policy, auth mechanism, packaging, discovery, transport, and launch
defaults do not change.

### Current and proposed envelope examples

Current illustrative v1 event:

```json
{
  "apiVersion": "locus.local-job.v1",
  "jobId": "job-example",
  "sequence": 7,
  "type": "error",
  "createdAt": "2026-09-05T00:00:00.000Z",
  "payload": {
    "runId": "renderer-run-example",
    "runtimeId": "codex",
    "runEventSequence": 3,
    "redaction": { "status": "not-required", "appliedRules": [] },
    "payload": { "message": "retrying" }
  }
}
```

Proposed illustrative event with optional additions plus the C7 Red identity/order
convergence:

```json
{
  "apiVersion": "locus.local-job.v1",
  "jobId": "job-example",
  "sequence": 7,
  "type": "error",
  "createdAt": "2026-09-05T00:00:00.000Z",
  "payload": {
    "runId": "job-example",
    "runtimeId": "codex",
    "runEventSequence": 7,
    "redaction": { "status": "redacted", "appliedRules": ["exact-secret"] },
    "payload": {
      "message": "retrying",
      "willRetry": true,
      "classification": "retryable",
      "runtime": { "codex": { "v1": { "turnId": "turn-redacted" } } }
    }
  }
}
```

The schema diff does not express the Red semantic changes: which facts now appear,
their canonical order, when follow stops, how retry/error evidence contributes to the
sole terminal, how resume snapshots repair rather than replay, and which candidates
qualify as artifacts. It also does not express the illustrated current identity/order
gaps: nested `runId` differs from envelope `jobId`, and nested `runEventSequence` differs
from envelope `sequence`; the proposed event makes both compatibility aliases equal.

### Known consumers

| Consumer | Use evidence | Affected call | Required consumer change | Consumer-owned test/E2E |
| --- | --- | --- | --- | --- |
| Amadeus | Trace §§5–6 says it directly consumes Codex app-server native events | Native event assembler, tool lifecycle, completion, and cursor | `unknown` until Owner classifies the surface; either preserve it or migrate in lockstep | Freeze and run native assembler/tool/completion/cursor fixture |
| Career Kit | Registered batch/structured-output consumer | Batch result, structured output, exit/retry truth, artifact manifest | Optional fields require no parser change; terminal/artifact behavior may require coordinated expectation changes | Run batch/structured-output/result/artifact fixture |
| Other consumers | `unknown` | `unknown` | Record discovery; do not infer “none” | TBD from inventory |

Consumer adapters and business E2E remain consumer-owned. Locus owns the neutral
contract fixtures and records the consumer result/version without absorbing their
business logic into this change.

### Options and cost

| Option | Locus change | Consumer change | Maintenance cost | Risk | Deletion condition |
| --- | --- | --- | --- | --- | --- |
| `DIRECT_NEW_STANDARD` | Publish the new ledger-backed behavior directly through v1 | Coordinate all affected expectations at cutover | Lowest | Synchronized rollout and undocumented consumers | Not applicable |
| `NEW_VERSION` | Add a separately approved public version adapter over this ledger | Consumers migrate by version | Medium | Multi-version contract and test matrix | Sunset old version after recorded adoption |
| `TEMPORARY_FACADE` | Translate the old v1 envelope from this same ledger without changing terminal truth or artifact admission | No or staged parser changes; semantics that cannot be represented safely fail closed | Medium | Facade can linger; some Red behavior still requires coordination/new version | Dated/objective removal after Amadeus/Career Kit migration |
| `DEFER` | Keep public cutover blocked while internal analysis/tests continue | None yet | Ongoing opportunity cost | Existing trace gaps persist | New Owner decision |
| `REJECT` | Do not implement this proposal | None | None for migration | Phase 3 prerequisites remain unmet | Not applicable |

Keeping an old mapper, job store, terminal state machine, or artifact lifecycle is not a
compatibility option.

### Temporary facade boundary, if selected

```text
Canonical owner: src/main/lib/agent-runtime/run-event-ledger.ts
Old contract/version: locus.local-job.v1 observable behavior selected by Owner
New canonical contract/core: canonical RunEvent ledger and exact-sequence sink
Allowed translation: parse, validate, losslessly filter optional fields, map an
  existing type, and serialize while preserving canonical terminal/artifact truth
Explicitly forbidden business logic/state: sequence allocation, event ledger,
  item reconciliation, terminal/retry/cancel truth, policy/auth, Runtime dispatch,
  persistence database, artifact admission, false-success projection, or exposure of
  an unadmitted artifact; semantics that cannot be represented safely must fail closed
  or use an Owner-approved new version
Migration flag or gate: projection-only gate chosen by Owner; never a second Run path
Deprecation owner/comment: TBD by Owner
Deletion date or objective removal condition: TBD; must be recorded before rollout
Architecture guard / contract tests: single-ledger guard plus old/new facade fixtures
```

### Release, failure recovery, and rollback

```text
Required release order: Owner C7 decision and proposal APPROVED -> independent
  red-first contract and consumer-neutral conformance fixture authorship with expected
  failures -> canonical implementation/deletion -> green rerun -> known-consumer
  verification -> rollout
Can old consumer call new Locus?: Only as allowed by the selected Owner disposition
Can new consumer call old Locus?: It must tolerate absent optional fields; it cannot
  assume corrected completion/artifact semantics without capability/version evidence
Unsupported-version error: Existing explicit version rejection remains; no silent downgrade
Downgrade behavior: Never select a weaker second ledger or silently reconstruct truth
Rollback target: Before legacy deletion, newly created disposable test Runs only; after
  deletion, a new Owner-approved change/projection, never dual-write
External data/artifact impact: Do not delete external artifacts; reset only disposable
  pre-production fixture Runs, marking active pre-cutover Runs interrupted/canceled
Security impact: Earlier redaction and fail-closed artifact admission tighten the boundary
```

### Future Consumer Impact evidence

- [ ] Machine-readable schema/generated type is unchanged or updated consistently with
  the Owner-selected version/facade.
- [ ] Common-ledger contract tests and exact 12-type v1 projection tests pass.
- [ ] Old-contract facade tests pass, if and only if the Owner selects one.
- [ ] Unsupported version/extension behavior fails closed without silent downgrade.
- [ ] Consumer-neutral conformance fixtures cover terminal, cursor, repair, and artifact.
- [ ] Versioned consumer guide, examples, event/error semantics, and schema are updated.
- [ ] Amadeus and Career Kit adapter/E2E status and exact consumer version are recorded.
- [ ] Architecture guard proves no old/new business core or second ledger remains.
- [ ] Packaged/transport smoke is recorded if the selected public boundary requires it.

### Owner decision (unfilled)

```text
Decision: DIRECT_NEW_STANDARD | NEW_VERSION | TEMPORARY_FACADE | DEFER | REJECT
Approved exact scope: TBD
Compatibility obligation: TBD
Sunset/deletion condition: TBD
Consumer coordination required: TBD
Owner: TBD
Date: TBD
```

## Impact

- Affected living specs: `agent-runtime-core`, `architecture-ownership`,
  `local-job-api`, `desktop-agent-jobs`, `headless-agent-jobs`, and
  `codex-runtime-parity`.
- Planned code owners are listed in design; this draft changes none of them.
- Security impact: redaction moves before fan-out, native identity is namespaced, and
  artifacts fail closed until admitted.
- Delivery impact: tests must be authored from the scenarios and observed failing
  before implementation, per the 2026-09-05 pilot workflow.

## Open Questions Requiring Owner Direction

1. Which C7 disposition applies to Red rows 2, 3, 4, 5, 7, and 8: `DIRECT_NEW_STANDARD`, `NEW_VERSION`, `TEMPORARY_FACADE`, `DEFER`, or `REJECT`?
2. Is Amadeus's direct Codex native-event stream a supported public surface that must be preserved byte/semantically, or an internal consumer to migrate in lockstep?
3. What exact public status/reason and valid-empty-output exception define completion truth for denial, rejection, and zero-output runs?
4. Does this change own a minimal immutable `RuntimeInstallation` provenance snapshot, or depend on a separately approved release-manifest owner?
5. After public `completed`, may sanitized late diagnostics remain readable on explicit subsequent reads, or must the ledger drain all admissible facts before publishing `completed`?
