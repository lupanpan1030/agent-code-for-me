## ADDED Requirements

### Requirement: Existing Queue Executes Admitted API Work

The existing local daemon queue SHALL additionally claim eligible source=api jobs,
using the existing conditional start/claim, concurrency and lock ownership rules.
Agent/completion dispatch SHALL use their existing runners. API execution SHALL
reopen admitted artifact directories safely and compose the existing terminal
projection. Ordinary daemon selection SHALL continue to exclude source=desktop,
default source=cli and source=protocol. Schedule creation SHALL reuse the canonical
store insertion primitive while retaining its existing fire/audit transaction owner.
No additional worker implementation or queue table SHALL be introduced.

#### Scenario: S28 Daemon executes API work once and preserves source exclusions
- **GIVEN** a temporary DB with admitted daemon, schedule, API agent, API completion,
  desktop, default CLI and protocol jobs, and two executors racing with concurrency 1
- **WHEN** the existing queue pump and claim ports run with controlled runner latches
- **THEN** eligible jobs dispatch through their respective existing runner exactly
  once, claim losers do not invoke providers, and each executor stays within its limit
- **AND** desktop/default CLI/protocol jobs remain unclaimed by the ordinary daemon;
  an API agent with artifacts reopens the stored admitted directory before use
- **AND** two daemon lock acquisitions still exclude the loser and releasing a stale
  nonce does not unlink a successor's lock

#### Scenario: S31 Schedule creation retains one fire without bypassing creation facts
- **GIVEN** a due schedule, two SQLite connections racing the same scheduledFor time,
  and a variant failing the post-transaction creation append
- **WHEN** evaluateDueAgentSchedules fires and listQueuedAgentJobsForSource reads schedule work
- **THEN** the successful fixture has one job/audit fire and advances nextRunAt once,
  with job_created recorded only through the host
- **AND** the failed-append fixture remains unacknowledged as executable work and
  cannot be claimed; no API idempotency key or second schedule state machine is created

### Requirement: Jobs Stdio Shares Submission And Execution Owners

The locus-jobs-stdio.v1 initialize, job.run, job.cancel and shutdown envelopes SHALL
remain unchanged. job.run SHALL call the same submit core before its response and
reuse the existing in-process executor via the canonical queue pump scoped to that
session's admitted job IDs. It SHALL NOT require an external daemon. The session's
active-job set SHALL govern transport ownership only, not durable status. Cancellation,
EOF and shutdown SHALL retain their existing session scope and use the same store/ledger
lifecycle as other callers. This surface SHALL NOT accept new key or consumer fields
in its existing strict job.run parameters.

#### Scenario: S29 Job run acknowledges the shared creation core
- **GIVEN** an initialized stdio session with a temporary registered project, the
  existing strict runtime/mode/cwd/prompt params and a recording submit/pump seam whose
  runtime runner is held on a latch, with no external daemon
- **WHEN** JSON-RPC initialize then job.run are written to stdin
- **THEN** initialize returns protocolVersion=locus-jobs-stdio.v1 and the existing
  four capabilities; job.run returns its original result.job shape after creation commit
- **AND** both API submit and this job.run invoke the same submit seam, one creation
  exists per call, and job/event notifications read committed records once in sequence
- **AND** release of the session executor latch runs that job through the common pump;
  extra consumer/key parameters still produce the existing invalid-params response

#### Scenario: S30 Protocol cancel and shutdown remain session-owned
- **GIVEN** two stdio sessions with queued and running protocol jobs and a separate API job
- **WHEN** one session cancels its queued/running job, attempts to cancel the other's
  job, then sends shutdown; repeat with stdin EOF
- **THEN** its queued job settles canceled without spawn, its running job receives
  cancellation through the existing worker, and streams drain/stop within the existing bounds
- **AND** other-session cancellation returns JSON-RPC -32602; API and other-session
  jobs are not canceled or claimed, and shutdown returns the existing {ok:true} result
- **AND** each affected Run has at most one completed from the ledger
