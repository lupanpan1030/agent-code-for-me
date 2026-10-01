## ADDED Requirements

### Requirement: Single Async Submission And Wait Ownership

The architecture guard SHALL pin submitRun and waitForRun to
src/main/lib/headless/run-submission.ts and API queue execution to the existing
headless/daemon.ts queue owner. CLI API and jobs-stdio handlers SHALL be envelope
adapters over those owners. The former runPreparedLocalJobApiJob and API create/retry
inline runner calls SHALL be absent. Q2(a) wrapper and stdio SHALL both be allowed
to call the same daemon.ts pumpQueuedRuns symbol scoped to their admitted IDs, without
independent dispatch or runner calls. Duplicate store row creation in API/stdio/schedule
adapters SHALL be replaced by the canonical job-store creation primitive. This rule
SHALL preserve human one-shot locus run and desktop runtime execution boundaries.
The ledger host SHALL remain the sole appendExactRunEventBatch importer; the artifact
owner SHALL own publication verification and all credential/redaction owners SHALL
remain unchanged. The guard SHALL validate structure; runtime semantics SHALL be
verified by behavior fixtures rather than inferred from symbol counts.

#### Scenario: S32 Guard rejects an inline API execution fallback
- **GIVEN** `tests/fixtures/local-job-api-async/architecture-fixtures.json#S32`, with clean source fixtures and variants restoring runPreparedLocalJobApiJob,
  inserting runPersistedAgentJob or runPersistedCompletionJob into API create/retry,
  or adding an independently dispatching jobs-stdio loop; the clean fixture includes
  API wrapper and stdio calls to the same pumpQueuedRuns with own-ID scope
- **WHEN** the architecture guard scans each fixture
- **THEN** the clean fixture passes and each variant reports its exact file/symbol
  and required submit/queue owner, while the human locus run call is permitted
- **AND** the guard self-test fails if a required finding is missing or unexpected

#### Scenario: S33 Guard rejects duplicate creation and ledger writers
- **GIVEN** `tests/fixtures/local-job-api-async/architecture-fixtures.json#S33`, with fixtures duplicating submitRun/waitForRun outside their owner, inserting
  agent_jobs directly in an API/stdio/schedule adapter, and importing
  appendExactRunEventBatch outside run-event-ledger-host.ts
- **WHEN** the architecture guard and its negative-fixture suite run
- **THEN** each violation is rejected with its owner location, while schedule's use of
  the shared store insertion primitive within its audit transaction passes
- **AND** no optional migration setting can permit a live old/new submission core or
  restore the retired ledger transition gate

### Requirement: Schedule Uses Canonical Job Insertion

Schedule creation SHALL replace createScheduleJobRecord's duplicate row construction
with the job-store insertion primitive inside its existing fire/audit/nextRunAt
transaction, then record creation through the ledger host. This SHALL be an atomic
internal refactor, not a second scheduling or API idempotency path.

#### Scenario: S31 Schedule creation retains one fire without bypassing creation facts
- **GIVEN** `tests/fixtures/local-job-api-async/schedule.json#S31`, with a due schedule, two SQLite connections racing the same scheduledFor time,
  and a variant failing the post-transaction creation append
- **WHEN** evaluateDueAgentSchedules fires and listQueuedAgentJobsForSource reads schedule work
- **THEN** the successful fixture has one job/audit fire and advances nextRunAt once,
  with job_created recorded only through the host
- **AND** the failed-append fixture remains unacknowledged as executable work and
  cannot be claimed; no API idempotency key or second schedule state machine is created
