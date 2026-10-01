## ADDED Requirements

### Requirement: Committed Submission And Publication Observation

Submission acknowledgement and claim SHALL require exact committed job_created
observationKey=lifecycle:job-created:<id>, factKey=lifecycle:job-created:<id>:0 and
event type job_created, plus ledger_version=1. List/start SHALL share the SQL predicate
below; they SHALL never synthesize facts or a second state machine:

```sql
j.ledger_version = 1 AND j.status = 'queued'
AND EXISTS (SELECT 1 FROM agent_job_events e WHERE e.job_id = j.id
 AND e.type = 'job_created' AND e.fact_key = 'lifecycle:job-created:' || j.id || ':0')
AND (j.artifact_manifest_path IS NULL OR EXISTS (
 SELECT 1 FROM agent_job_events e WHERE e.job_id = j.id AND e.type = 'artifact_created'
 AND e.fact_key = 'lifecycle:initial-artifacts:' || j.id || ':0'))
```

ArtifactManifestPath non-NULL SHALL mean initial admission required. Run-artifacts
SHALL replace its content-hash admission observation key with
lifecycle:initial-artifacts:<id>; all initial refs SHALL commit in the same batch whose
first artifact_created ordinal is :0. A crash after creation before that batch SHALL
leave queued, unclaimable work with status/wait reason admission_incomplete; runs cancel
SHALL settle canceled without terminal refs. Reservation expiry SHALL start at that
settlement, not release immediately. Job/key transaction and separate creation commit,
ordinary queued/no-facts compensation and orphan handling SHALL retain the TICKET-128
boundary; this change SHALL not claim full atomic creation or orphan repair.

Terminal projection ownership SHALL be explicit: the worker registers the preparer;
admitted queued-cancel host composes the same preparer from persistent input plus
reopenAdmittedRunDir; missing-admission cancel/artifact-free/fail-closed preparation
use no terminal refs. Recovery SHALL use the existing liveness owner to settle
interrupted without registering new terminal refs. Initial refs SHALL remain history.
Readiness SHALL mean every terminal ref registered by that commit is published; an
empty terminal set SHALL be ready at completed, result.artifacts=[] even if initial
refs exist. No-preparer settlement SHALL not demand nonexistent terminal result files.

The host SHALL set reservation expiresAt once after verified preparer publication or
at settlement for an empty terminal set. Publication failure/crash before the setter
SHALL retain NULL expiry. Wait/status observation itself SHALL remain read-only;
the existing CLI recovery prologue and host recovery lifecycle SHALL remain intact.
All writes SHALL flow through the ledger host's single appendExactRunEventBatch adapter.

Publication readiness SHALL read seal/completed and prepared tail, verify stable-dir
identity plus each required file's size/digest, then recheck the same seal/refs. State
refs with sequence SHALL not enter the prepared-tail result array. Late diagnostic
suffixes SHALL not change the frozen result. Missing/mismatching terminal files SHALL
remain non-ready without rewriting the committed outcome. The read cache MAY reuse
hashes only for identical seal/ref and unchanged file identity/size/mtime/ctime;
changes SHALL invalidate it. Consumer deletion after publish SHALL be disclosed as
indistinguishable from never published; a durable publish marker is TICKET-128 scope.

#### Scenario: S26 Queue listing and claim require the same committed facts
- **GIVEN** `tests/fixtures/local-job-api-async/admission.json#S26`, with temporary SQLite rows for a valid creation fact, a job_created with a wrong
  fact key, an orphan with no events, a legacy v0 job, and an API run-dir job lacking
  initial artifact admission, plus an artifact_created with a wrong admission key
- **WHEN** listQueuedAgentJobsForSource and startAgentJob run against every row
- **THEN** only the valid ledger-v1 fixture with all required admission facts is eligible;
  every other row is both excluded and refused before runner invocation
- **AND** adding the genuine atomic initial batch with observationKey=lifecycle:initial-artifacts:<id>
  and first factKey suffix :0 through the host permits that API fixture, while listing/claim never allocate a replacement creation fact or sequence

#### Scenario: S27 Publication faults cannot be mistaken for completion
- **GIVEN** `tests/fixtures/local-job-api-async/publication.json#S27`, with frozen terminal artifact fixtures, fault injection after every staged
  write, SQL commit and final rename, and a process restarted with only committed DB
  state and the resulting run directory, with the pre-commit worker still confirmed alive
  and heartbeating to exclude the independent recovery trigger
- **WHEN** the host's readRunPublicationReadiness port and a CLI wait inspect each fixture
- **THEN** no commit or any missing/mismatching required final file yields non-ready;
  only the matching full final set yields ready for that exact completed sequence
- **AND** swapping the directory for a symlink or changing a file digest fails closed,
  leaves outside files untouched and cannot produce a successful wait
- **AND** after a terminal commit pending publication times out as terminal_artifacts_pending;
  before commit it times out as run_pending, never appends another completed or
  overwrites outcome; no process-local publish flag is required

#### Scenario: S36 Daemon death recovers to a readable interrupted result
- **GIVEN** `tests/fixtures/local-job-api-async/publication.json#S36`, with a keyed daemon-claimed artifact API Run and its retained reservation, committed
  initial refs, running status, a blocked runtime, no terminal commit and heartbeat
  advanced beyond the existing 120 s
  stale threshold; the real daemon/worker is killed and the liveness port confirms stopped
- **WHEN** a restarted daemon or runs wait CLI prologue invokes recoverStaleAgentJobs,
  then `runs wait <id> --timeout 0 --json` reads from a new connection
- **THEN** one completed has interrupted/worker_stopped and job.errorCode=worker_interrupted;
  no new terminal refs/files are fabricated and wait immediately returns interrupted
  envelope with result.artifacts=[] and mapped exit 1, not terminal_artifacts_pending
- **AND** initial refs remain in history, expiry is settlement+30 days, repeat recovery/wait
  adds no terminal, and a stale-but-EPERM/live variant remains running with no false recovery

#### Scenario: S38 Crash at creation to initial admission boundary
- **GIVEN** `tests/fixtures/local-job-api-async/idempotency.json#S38`, with a keyed artifact submission killed exactly after committed job_created and
  before lifecycle:initial-artifacts:<id>:0, with its admitted-intent job ID read via store
- **WHEN** fresh list/start, same-key submit, runs status and wait --timeout 0 inspect it
- **THEN** list/start admit zero, provider calls zero, submit returns submission_pending/8
  with retryable:true, status is queued/execution.reason=admission_incomplete and wait
  returns timeout/admission_incomplete/9; no initial fact is fabricated
- **AND** runs cancel settles exactly one canceled terminal without terminal refs,
  wait then returns canceled/5 with artifacts:[], key remains until settlement+30 days
  and named cleanup at expiry releases only the reservation, never history/files
