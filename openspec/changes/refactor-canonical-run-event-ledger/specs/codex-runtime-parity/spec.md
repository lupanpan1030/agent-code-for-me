## ADDED Requirements

### Requirement: Codex App-Server Canonical Ledger Conformance
Every Codex app-server Run SHALL feed JSON-RPC responses, notifications, server
requests, server-response-send/resolved boundary facts, runtime exits, and native
snapshot repair inputs to one canonical Run ledger owner. Codex transport and
method mappers SHALL preserve native identity and provenance after redaction,
but SHALL NOT own ordering, terminal truth, artifact admission, or a second
fact chain.

#### Scenario: JSON-RPC boundaries enter one ordered ledger
- **WHEN** a Bun conformance test creates the public canonical-ledger seam with
  a deterministic clock and in-memory sink and submits trace §9 fixtures
  `[EVENT-01]`, `[EVENT-02]`, and `[EVENT-03]` across response, notification,
  server-request, server-response-send, and resolved ingestion functions
- **THEN** every accepted observation receives one unique, increasing canonical
  `sequence` at ingestion
- **AND** the emitted identity namespace retains independently available
  `threadId`, `sessionId`, `turnId`, `itemId`, and `requestId` or `callId` after
  redaction without conflating thread and session
- **AND** an unknown native method emits stable unknown/loss observability or a
  stable `unknown_native_method` status record and never silently maps to `[]`

#### Scenario: Assistant and reasoning items reconcile delta and final data
- **WHEN** a Bun table test supplies separate assistant and reasoning item
  lifecycles containing `started`, zero or more `delta`, and `completed`
  snapshots, including duplicate, missing, and out-of-order delta variants
- **THEN** the canonical ledger records the item lifecycle and treats the
  completed snapshot as authoritative reconciliation evidence
- **AND** no materialized assistant or reasoning text contains text duplicated
  by both a delta and its final snapshot
- **AND** missing or irreconcilable content sets explicit `lossPossible: true` and
  reconciliation metadata instead of silently discarding the final snapshot

#### Scenario: Codex tool variants retain complete lifecycle evidence
- **WHEN** a Bun table test feeds native `commandExecution`, `fileChange`,
  `mcpToolCall`, `dynamicToolCall`, `collabAgentToolCall`, `webSearch`,
  `imageGeneration`, and `imageView` variants with started, update/delta, and
  completed observations
- **THEN** each supported variant produces the appropriate existing canonical
  `tool_started`, `tool_delta`, and `tool_finished`, artifact-candidate, or
  stable `status` records in ledger sequence
- **AND** a missing start, duplicate update, or completion-before-start case is
  tolerated but marked by reconciliation metadata
- **AND** an artifact candidate does not produce `artifact_created` until the
  canonical artifact owner validates existence, scope, digest, Run ownership,
  and redaction

#### Scenario: Retry, interrupt, usage, and completion remain distinct
- **WHEN** a Bun conformance fixture submits a retryable native error, later
  output, cumulative usage snapshots, interrupt, denial, zero-required-output,
  and transport-exit variants through the ledger seam
- **THEN** diagnostic errors retain `willRetry`, native code, and diagnostic
  classification and do not themselves become a terminal event
- **AND** usage is emitted as deduplicated cumulative snapshots with an explicit
  last value and resume baseline, so replaying an identical snapshot does not
  double-count tokens
- **AND** each Run emits exactly one terminal `completed` event
- **AND** denial, rejection, or missing required output is not an unqualified
  success, while a transport-generated terminal is marked synthetic with exact
  provenance

#### Scenario: Stable status vocabulary preserves non-text lifecycle facts
- **WHEN** a Bun table test submits thread/turn lifecycle, compaction, reroute,
  warning, MCP/OAuth, approval-review, interaction-boundary, runtime-process,
  repair, and unknown-method native observations
- **THEN** the ledger exposes the corresponding stable `status` subtype for
  every row
- **AND** the assertion reads structured subtype and redacted fields rather than
  matching arbitrary human-readable status text
- **AND** server request/send/resolved rows record only interaction ingestion
  boundary facts and do not claim to implement the durable Interaction state
  machine

#### Scenario: Runtime provenance is bound to every trace
- **WHEN** a Bun fixture starts two Runs with different immutable
  RuntimeInstallation records or binary digests and submits otherwise identical
  native events
- **THEN** every emitted event can be traced to the exact Run's runtime
  installation, binary digest, and protocol/schema identity
- **AND** no event inherits provenance from a process-global latest-runtime
  value or from the other Run
- **AND** secrets and unsafe local path details are redacted before provenance
  reaches a persisted or renderer-facing sink

#### Scenario: Native snapshot repair is not event replay
- **WHEN** a Bun test ingests partial live item history, registers a bounded
  same-Run transport replacement before exit, binds it with matching
  installation/protocol identity before the deterministic deadline, and
  supplies a native thread or rollout snapshot through the repair entry point
- **THEN** repair output is labeled `repair.source=snapshot`,
  `lossPossible: true`, and includes the item reconciliation result
- **AND** native item positions or rollout offsets are not exposed as a replay
  cursor
- **AND** a downstream read resumes only after the last canonical ledger
  `sequence`
- **AND** an unplanned, expired, mismatched, or failed replacement instead emits
  one synthetic terminal and cannot later mutate output through snapshot repair

#### Scenario: Rollout samples retain outcome truth after rehydration
- **WHEN** a Bun conformance test writes trace §9 `[CODEX-06]` missing,
  malformed, and truncated rollout samples, `[CODEX-07]` cross-version
  completed samples, and the `[CODEX-08]` failed/error rollout-loss sample
  through the rollout persistence layer, then rehydrates the Run through the
  same canonical ledger contract
- **THEN** invalid samples retain precise diagnostics, completed samples remain
  completed, and the failed/error sample remains terminal rather than being
  defaulted to succeeded because structured output is absent
- **AND** valid completed snapshots reconcile without duplicating assistant or
  reasoning output
- **AND** the resulting stream retains one terminal `completed`, canonical
  sequence continuity, repair provenance, and explicit loss where exact native
  history cannot be proven
