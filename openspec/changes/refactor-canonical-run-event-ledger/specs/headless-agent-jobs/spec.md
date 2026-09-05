## MODIFIED Requirements

### Requirement: Headless Runtime Event Convergence
Headless local jobs SHALL use the runtime core's canonical event bridge before
persisting runtime-visible job events.

Headless adapters SHALL submit runtime observations to the same per-Run
main-process canonical ledger contract used by desktop Runs. The adapter and job
store SHALL preserve the ledger envelope and sequence, including the sole
terminal `completed` event, instead of stripping the envelope, allocating a new
sequence, discarding adapter completion, or synthesizing a competing success
chain.

#### Scenario: Batch process event is persisted
- **WHEN** a Codex or Claude batch adapter emits assistant output, command
  lifecycle output, status, error, or completion information
- **THEN** the headless runner maps the data into sanitized canonical runtime
  events before appending job events
- **AND** persisted job events remain ordered and replayable by existing job log
  and Local Job API readers
- **AND** a Bun adapter test can feed a deterministic fixture containing
  assistant and reasoning delta/final pairs, every supported tool lifecycle,
  retryable error, interrupt, cumulative usage, unknown method, and completion
  through the canonical-ledger seam and inspect the persisted sink
- **AND** the sink retains the ledger-assigned sequence and exactly one
  `completed` event, preserves retry and native diagnostic fields after
  redaction, and represents an unknown method with loss/unknown metadata or a
  stable `status` subtype instead of an empty projection

#### Scenario: Existing event readers remain compatible
- **WHEN** a user runs `locus jobs logs` or a downstream consumer runs
  `locus api runs events`
- **THEN** the reader receives documented job event envelopes in sequence
- **AND** it is not required to understand provider-specific chunks or desktop
  stream internals
- **AND** a Bun compatibility fixture reads one persisted Run through both
  commands and asserts matching canonical sequence, terminal outcome, usage
  totals, and admitted artifact references
- **AND** the Local Job API projection contains only its twelve existing v1
  event types and any richer data appears only in redacted optional payload
  members

#### Scenario: Headless and desktop ingest the same native fixture
- **WHEN** a Bun parity test sends the same `[EVENT-01..03]` Codex probe fixture
  through the desktop and headless adapter entry points with identical
  deterministic Run identity and provenance
- **THEN** both paths call the canonical ledger owner and produce equivalent
  normalized event types, item reconciliation, error classification, usage
  snapshots, artifact admission decisions, and terminal truth
- **AND** path-specific transport metadata may differ only in documented,
  redacted optional provenance fields
- **AND** neither path owns a fallback mapper or shadow fact chain

#### Scenario: Rollout outcomes survive persistence rehydration
- **WHEN** a Bun persistence test passes `[CODEX-06]` missing, malformed, and
  truncated rollout samples, `[CODEX-07]` cross-version completed samples, and
  the `[CODEX-08]` failed/error rollout-loss sample through the rollout writer
  and then rehydrates the headless Run
- **THEN** invalid resume samples retain their diagnostics, completed samples
  remain completed, and the failed/error sample remains terminal according to
  its canonical `completed` outcome
- **AND** absent or malformed structured output cannot be defaulted to succeeded
- **AND** the rehydrated stream contains no job-store-generated second terminal
  event or replacement sequence

#### Scenario: Headless transport restarts during a Run
- **WHEN** a Bun table fixture terminates the headless transport after partial
  item output using either an unplanned exit or a replacement attempt registered
  before exit with an attempt ID and deterministic deadline
- **THEN** only a replacement bound before the deadline to the same ledger, Run,
  RuntimeInstallation, and compatible protocol continues after the persisted
  canonical `sequence`
- **AND** that bound replacement may submit a later native snapshot through the
  repair seam with `repair.source=snapshot` and `lossPossible: true` before the
  terminal barrier, rather than treating it as replay
- **AND** an unplanned, expired, identity-mismatched, or failed replacement
  produces exactly one synthetic terminal with exit provenance, and any later
  snapshot is diagnostic-only
