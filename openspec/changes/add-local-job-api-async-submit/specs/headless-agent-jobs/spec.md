## MODIFIED Requirements

### Requirement: Local Daemon Queue
The system SHALL provide an opt-in local daemon queue that reuses durable jobs and the shared runtime core.
It SHALL additionally claim admitted source=api agent/completion Runs via startAgentJob
and the existing respective runners. The canonical pumpQueuedRuns SHALL own all dispatch;
scoped wrapper/stdio calls SHALL reuse it without another worker or queue. Ordinary
selection SHALL exclude desktop/default cli/protocol and use daemon→schedule→api slot
order; starvation behind sustained earlier sources SHALL be documented, not hidden
behind a new priority scheduler.

Before provider work, the host SHALL revalidate registered project existence, stored
canonical cwd identity, execution profile/capability/grant and provider reference via
their existing owners. A stored internal cwd identity SHALL be captured at admission in job inputJson
submissionContext.projectIdentity (canonical path/dev/ino); public serializers and
request artifacts SHALL exclude that internal metadata. No extra table is introduced. Maximum queued API age SHALL default to
86400000 ms from createdAt, configurable by Owner via maxQueuedApiAgeMs (no new CLI
flag); at or beyond that age the claim/tick SHALL fail closed. Failed checks SHALL
settle through the host with project_unregistered, cwd_identity_changed,
execution_profile_invalid or queued_age_exceeded; provider errors retain existing
codes. Unadmitted jobs SHALL remain unclaimable and use the missing-admission cancel
remedy, not speculative execution.

For artifact Runs, run-artifacts SHALL own reopenAdmittedRunDir(job,committedInitialRefs):
open stored artifactBaseDir/<jobId> with a stable-directory handle, recheck registered
root/artifacts-base containment, verify every initial committed artifact_created ref's
role/path/sha256/size via verifyRunDirArtifactRef, and seed receipts only for verified
single-link regular files. Mismatch SHALL settle failed/artifact_admission_mismatch
without new terminal refs, never hang or write outside admitted bounds. No fd SHALL
cross processes and no dev/ino SHALL enter public envelopes. Terminal staging names
SHALL be exclusive and unique per process plus preparation attempt; losers SHALL
discard only their own files. Reopening a terminal Run SHALL never republish it.

Daemon-claimed children SHALL use the daemon's environment/native-credential home
(HOME/CODEX_HOME/CLAUDE_CONFIG_DIR, proxy and relevant PATH), with existing secret
stripping unchanged; no client env snapshot SHALL be persisted. CLI runtimes list
SHALL continue probing the CLI environment and SHALL not claim daemon readiness.
This R3 decision remains **统筹预设（推荐，Owner 可改）**, pending Owner approval.

#### Scenario: Daemon starts without a renderer window
<!-- Scenario register: S41 (retained living scenario; title unchanged for MODIFIED archive) -->
- **GIVEN** `tests/fixtures/local-job-api-async/queue.json#S41`, with an isolated daemon profile and recording packaged-bootstrap ports for renderer/menu/updater/auth/MCP startup
- **WHEN** the user runs `locus daemon run`
- **THEN** the packaged CLI launches the Locus Electron main process in daemon mode
- **AND** the daemon starts before GUI single-instance handling, menu construction, BrowserWindow creation, updater startup, auth callback server startup, and GUI-only MCP warmup
- **AND** the daemon writes diagnostics to stderr without polluting structured stdout

#### Scenario: Daemon claims queued daemon jobs
<!-- Scenario register: S42 (retained living scenario; title unchanged for MODIFIED archive) -->
- **GIVEN** `tests/fixtures/local-job-api-async/queue.json#S42`, with queued daemon/schedule/API rows, excluded desktop/CLI/protocol rows, a concurrency-1 daemon and controlled runtime
- **WHEN** the daemon is running
- **AND** queued `source=daemon` jobs exist
- **THEN** the daemon starts those jobs through the shared runtime core according to configured local concurrency limits
- **AND** writes heartbeat, cancel, runtime event, and completion state through `agent_jobs` and `agent_job_events`
- **AND** does not claim `source=desktop`, default one-shot `source=cli`, or `source=protocol` jobs
- **AND** claims `source=schedule` jobs only through the explicit local scheduling scenario
- **AND** additionally claims admitted `source=api` jobs through the same pump and claim guard

#### Scenario: Daemon follows cancellation requests
<!-- Scenario register: S43 (retained living scenario; title unchanged for MODIFIED archive) -->
- **GIVEN** `tests/fixtures/local-job-api-async/queue.json#S43`, with a running daemon job with a blocked worker and observable cancel request/confirmation latches
- **WHEN** `locus jobs cancel <job-id>` is used for a running daemon job
- **THEN** the system records a persisted cancel request
- **AND** the daemon worker observes the request through the job observer
- **AND** the daemon marks the job `canceled` only after the runtime stops or the worker confirms cancellation

#### Scenario: User follows daemon logs
<!-- Scenario register: S44 (retained living scenario; title unchanged for MODIFIED archive) -->
- **GIVEN** `tests/fixtures/local-job-api-async/queue.json#S44`, with a daemon job with sequence-ordered events, a pending terminal latch and stdout/stderr capture
- **WHEN** a user follows a daemon job with `locus run --daemon --follow` or `locus jobs logs <job-id> --follow`
- **THEN** the CLI streams persisted events in sequence
- **AND** exits after the daemon job reaches a terminal status

#### Scenario: Daemon restarts after crash
<!-- Scenario register: S45 (retained living scenario; title unchanged for MODIFIED archive) -->
- **GIVEN** `tests/fixtures/local-job-api-async/queue.json#S45`, with stale running rows with confirmed-stopped workers and a stopped-vs-live liveness fixture
- **WHEN** the daemon starts and finds jobs marked running without an active worker
- **THEN** it marks those jobs as interrupted
- **AND** exposes retry or resume only when the runtime adapter supports it

#### Scenario: Daemon coordination stays local
<!-- Scenario register: S46 (retained living scenario; title unchanged for MODIFIED archive) -->
- **GIVEN** `tests/fixtures/local-job-api-async/queue.json#S46`, with an isolated daemon profile, network-listen spy and requests carrying forbidden token/API-key/env fields
- **WHEN** the local daemon is running
- **THEN** it uses only local per-user coordination primitives and the app SQLite database for queue state
- **AND** does not expose an unauthenticated TCP HTTP or WebSocket control surface by default
- **AND** does not accept provider tokens, API keys, or raw environment values from daemon clients
- **AND** the token/env input variants are rejected before a job or provider call and the
  network-listen spy stays zero, while only the configured local profile is changed

#### Scenario: S28 Daemon executes API work once and preserves source exclusions
- **GIVEN** `tests/fixtures/local-job-api-async/queue.json#S28`, with admitted daemon/schedule/API-agent/API-completion/desktop/CLI/protocol rows,
  two direct pump instances on independent connections (each concurrency 1), and runner latches
- **WHEN** those pump instances race claim; separately two daemon instances attempt
  real lock acquisition for the same profile
- **THEN** each eligible job dispatches exactly once through its existing runner,
  each pump stays within concurrency 1 and claim losers never call a provider
- **AND** ordinary daemon leaves desktop/CLI/protocol unclaimed, source slot order is
  daemon then schedule then api, and the API artifact runner validates reopened receipts
- **AND** only one real daemon lock acquisition succeeds; stale-nonce release cannot
  unlink its successor (pump concurrency tests do not bypass the daemon lock assertion)

#### Scenario: S37 Submit in one process and publish in another
- **GIVEN** `tests/fixtures/local-job-api-async/publication.json#S37`, with a registered project with artifact base, process A using an isolated DB and
  process B with no shared memory/receipts, plus digest/symlink/hardlink mismatch variants
- **WHEN** A submits and exits, B's daemon claims/reopens/executes/publishes, then process C
  invokes runs wait; repeat with each initial-file mismatch before B starts
- **THEN** the valid Run becomes ready/exit 0 with golden prepared-tail refs, existing
  initial events.jsonl/artifacts.json targets replaced only after verified receipt seeding
- **AND** mismatch cases call no provider, settle failed with artifact_admission_mismatch,
  no new terminal refs, wait returns failed/exit 1, and outside files remain unchanged
- **AND** processes share only persistent DB/files; stdout contains no dev/ino/raw env

#### Scenario: S39 Claim revalidates project identity profile and age
- **GIVEN** `tests/fixtures/local-job-api-async/admission.json#S39`, with admitted queued API fixtures, mutated after ack by unregistering the project,
  replacing cwd directory identity, invalidating the execution profile/grant, or advancing
  the fake clock to exactly createdAt+86400000; include an unchanged younger control
- **WHEN** daemon pump attempts claim and the daemon expiry tick runs
- **THEN** changed fixtures settle through the host once with reasons respectively
  project_unregistered, cwd_identity_changed, execution_profile_invalid, queued_age_exceeded,
  zero provider calls/child spawns and no unsafe artifact writes
- **AND** the unchanged fixture executes exactly once; changing Owner maxQueuedApiAgeMs
  moves only the age threshold, never bypasses the identity/profile gates

#### Scenario: S40 Runtime environment belongs to the actual claimant
- **GIVEN** `tests/fixtures/local-job-api-async/environment.json#S40`, with submitter sentinel homes/proxy/PATH A and daemon homes/proxy/PATH B, injected
  runtime child env capture, fake native credential readiness and secret env sentinels
- **WHEN** A submits and B claims, then a separate no-daemon Q2(a) create runs locally;
  runtimes list is invoked from A
- **THEN** daemon-claimed child uses B and local wrapper child uses A for allowed native
  homes/proxy/relevant PATH; both apply unchanged secret stripping, never forward raw tokens
- **AND** CLI readiness reports A only, while no DB/request/event/log stores A or B env
  snapshots or secret values; the fixture proves native-home provenance, not API-key billing
