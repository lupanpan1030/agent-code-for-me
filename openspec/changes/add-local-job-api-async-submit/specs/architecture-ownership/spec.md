## ADDED Requirements

### Requirement: Single Async Submission And Wait Ownership

The architecture guard SHALL pin submitRun and waitForRun to
src/main/lib/headless/run-submission.ts and API queue execution to the existing
headless/daemon.ts queue owner. CLI API and jobs-stdio handlers SHALL be envelope
adapters over those owners. The former runPreparedLocalJobApiJob and API create/retry
inline runner calls SHALL be absent. Duplicate store row creation in API/stdio/schedule
adapters SHALL be replaced by the canonical job-store creation primitive. This rule
SHALL preserve human one-shot locus run and desktop runtime execution boundaries.
The ledger host SHALL remain the sole appendExactRunEventBatch importer; the artifact
owner SHALL own publication verification and all credential/redaction owners SHALL
remain unchanged. The guard SHALL validate structure; runtime semantics SHALL be
verified by behavior fixtures rather than inferred from symbol counts.

#### Scenario: S32 Guard rejects an inline API execution fallback
- **GIVEN** clean source fixtures and variants restoring runPreparedLocalJobApiJob,
  inserting runPersistedAgentJob or runPersistedCompletionJob into API create/retry,
  or adding an independently dispatching jobs-stdio loop
- **WHEN** the architecture guard scans each fixture
- **THEN** the clean fixture passes and each variant reports its exact file/symbol
  and required submit/queue owner, while the human locus run call is permitted
- **AND** the guard self-test fails if a required finding is missing or unexpected

#### Scenario: S33 Guard rejects duplicate creation and ledger writers
- **GIVEN** fixtures duplicating submitRun/waitForRun outside their owner, inserting
  agent_jobs directly in an API/stdio/schedule adapter, and importing
  appendExactRunEventBatch outside run-event-ledger-host.ts
- **WHEN** the architecture guard and its negative-fixture suite run
- **THEN** each violation is rejected with its owner location, while schedule's use of
  the shared store insertion primitive within its audit transaction passes
- **AND** no optional migration setting can permit a live old/new submission core or
  restore the retired ledger transition gate
