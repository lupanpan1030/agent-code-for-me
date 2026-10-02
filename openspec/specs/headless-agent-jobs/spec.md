# headless-agent-jobs Specification

## Purpose
TBD - created by archiving change add-headless-agent-jobs. Update Purpose after archive.

## Requirements

### Requirement: Durable Local Agent Jobs
The system SHALL persist agent work as local jobs with append-only event history in the existing app-managed SQLite database.

#### Scenario: Job is created
- **WHEN** a desktop, CLI, daemon, schedule, or protocol caller creates an agent job
- **THEN** the system stores a job record with source, runtime, mode, cwd, prompt preview, status, retry linkage, attempt number, and timestamps
- **AND** stores no provider secrets in the job record

#### Scenario: Job emits events
- **WHEN** a running job emits normalized runtime events
- **THEN** the system appends event records with monotonically increasing sequence numbers
- **AND** the event stream can be replayed after the original renderer or CLI process disconnects

#### Scenario: Job reaches terminal state
- **WHEN** a job succeeds, fails, is canceled, or is interrupted
- **THEN** the system records a terminal status, finish timestamp, and normalized exit/error metadata
- **AND** the job no longer accepts non-diagnostic runtime events

#### Scenario: Worker heartbeat is lost
- **WHEN** the app starts, the CLI starts, or recovery runs
- **AND** a job is marked `running` without a recent worker heartbeat
- **THEN** the system marks the job `interrupted`
- **AND** preserves the existing event history
- **AND** exposes retry only through the normal retry path

#### Scenario: User requests cancellation
- **WHEN** a desktop or CLI caller cancels a running job
- **THEN** the system records a persisted cancel request before changing terminal status
- **AND** the active worker observes the cancel request and stops the runtime when possible
- **AND** the job becomes `canceled` only after the worker confirms cancellation
- **AND** a worker that disappears before confirming cancellation leaves the job `interrupted`, not `canceled`

#### Scenario: Multiple local processes write job state
- **WHEN** the GUI process and one or more headless CLI processes access local job state
- **THEN** writes use the existing app SQLite database with WAL, a busy timeout, and short transactions
- **AND** event sequence numbers are monotonic per job
- **AND** duplicate sequence numbers for one job are rejected or retried safely

### Requirement: One-Shot Headless Run
The system SHALL provide a one-shot headless run command for local agent work without requiring a visible desktop window.

#### Scenario: User runs a prompt from CLI
- **WHEN** the user runs `locus run` with a cwd, runtime, mode, and prompt
- **THEN** the packaged CLI launches the Locus Electron main process in headless CLI mode
- **AND** the main process starts a local agent job through the shared runtime core without creating a BrowserWindow
- **AND** streams or prints output according to the selected output format
- **AND** exits with a process code that reflects success, failure, cancellation, or invalid input

#### Scenario: User pipes stdin
- **WHEN** the user pipes stdin into `locus run`
- **THEN** the system includes the stdin content as part of the run input
- **AND** enforces a documented maximum stdin size or returns a clear error before starting runtime work

#### Scenario: User requests structured output
- **WHEN** the user selects JSON or stream JSON output
- **THEN** the command writes machine-readable job, event, and result payloads to stdout
- **AND** diagnostics that are not part of the structured payload go to stderr

#### Scenario: CLI cannot start headless main process
- **WHEN** the packaged CLI cannot launch or connect to the Locus Electron main process in headless CLI mode
- **THEN** the command exits with a local process failure code
- **AND** prints a diagnostic to stderr without writing partial structured output to stdout

#### Scenario: macOS headless command starts
- **WHEN** the user runs `locus run` or `locus jobs` on macOS
- **THEN** the CLI shim synchronously executes the packaged Locus binary with a private headless marker
- **AND** preserves stdin, stdout, stderr, and the process exit code
- **AND** does not use `open -a` for the headless command

#### Scenario: Windows headless command starts
- **WHEN** the user runs `locus run` or `locus jobs` on Windows
- **THEN** the CLI shim synchronously executes the packaged Locus executable with a private headless marker
- **AND** preserves stdin, stdout, stderr, and the process exit code
- **AND** does not use a detached `start` invocation for the headless command

#### Scenario: Headless command runs while GUI is open
- **WHEN** the desktop app is already running
- **AND** the user starts a headless CLI command
- **THEN** the headless process handles the command without creating or focusing a BrowserWindow
- **AND** the command is not rejected merely because the GUI single-instance lock is held
- **AND** shared job visibility and cancellation are coordinated through the durable job store

#### Scenario: Structured output is requested
- **WHEN** the user selects `json` or `stream-json` output
- **THEN** stdout contains only documented JSON payloads
- **AND** diagnostics, migration messages, runtime setup logs, and warnings are written to stderr or suppressed

#### Scenario: CLI job has no chat link
- **WHEN** a CLI job is created for a cwd that does not map cleanly to an existing chat or sub-chat
- **THEN** the job is still created and runnable
- **AND** linked chat fields remain empty
- **AND** job history is read from `agent_jobs` and `agent_job_events`

#### Scenario: User enqueues a daemon job
- **WHEN** the user runs `locus run --daemon` with a cwd, runtime, mode, and prompt
- **THEN** the packaged CLI launches the Locus Electron main process in headless CLI mode
- **AND** creates a queued `source=daemon` job in the existing SQLite job store
- **AND** does not run the runtime in the submitter process
- **AND** prints the created job according to the selected output format

### Requirement: Job Management CLI
The system SHALL provide CLI commands for inspecting and managing local jobs.

#### Scenario: User lists jobs
- **WHEN** the user runs `locus jobs list`
- **THEN** the system prints recent local jobs with id, status, runtime, cwd, source, and timestamps
- **AND** supports a JSON output option for scripting

#### Scenario: User views job details
- **WHEN** the user runs `locus jobs show <job-id>`
- **THEN** the system prints job metadata and final result or current status
- **AND** returns a clear not-found error for an unknown job id

#### Scenario: User follows job logs
- **WHEN** the user runs `locus jobs logs <job-id> --follow`
- **THEN** the system streams existing and new job events in order
- **AND** exits after the job reaches a terminal status unless the user interrupts earlier

#### Scenario: User cancels a job
- **WHEN** the user runs `locus jobs cancel <job-id>` for a running job
- **THEN** the system requests cancellation through the job runner
- **AND** records a canceled terminal status when cancellation completes

#### Scenario: User retries a job
- **WHEN** the user retries a failed, canceled, or interrupted job
- **THEN** the system creates a new job linked to the original job
- **AND** increments the attempt number for the retry chain
- **AND** preserves the original job history unchanged

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
86400000 ms from createdAt, supplied by the internal RunLocalAgentDaemonOptions /
pump option maxQueuedApiAgeMs with a named constant default MAX_QUEUED_API_AGE_MS.
Tests MAY inject that option; it SHALL NOT be user-settable at runtime and SHALL add
no CLI flag. Any later runtime configuration surface requires C7 #2 classification.
At or beyond that age the claim/tick SHALL fail closed. Failed checks SHALL
settle through the host with project_unregistered, cwd_identity_changed,
execution_profile_invalid or queued_age_exceeded; an unexpected exception of the
claim-time gate itself SHALL fail closed as the internal fallback claim_gate_failed
with job.errorCode internal_error and the existing internal-failure exit 8; provider
errors retain existing codes. Unadmitted jobs SHALL remain unclaimable and use the missing-admission cancel
remedy, not speculative execution.

Every fail-closed settlement below SHALL be committed through the host with status
failed, the listed completed.payload.reasons entry, job.errorCode and create/default
retry/runs wait outcome exit (once publication is ready). The profile row SHALL retain
an existing provider-binding error code when supplied by its owner, using that code's
existing exit mapping; without one it SHALL use execution_profile_invalid/3.

| completed.payload.reasons entry | job.errorCode | Status | create/default retry/wait exit |
| --- | --- | --- | --- |
| project_unregistered | project_unregistered | failed | 7 |
| cwd_identity_changed | cwd_identity_changed | failed | 7 |
| execution_profile_invalid | owner-supplied provider-binding code, else execution_profile_invalid | failed | binding unavailable→4, invalid request→2, local-only blocked→6; else 3 |
| queued_age_exceeded | queued_age_exceeded | failed | 1 |
| artifact_admission_mismatch | artifact_admission_mismatch | failed | 1 |
| claim_gate_failed (internal fallback: unexpected gate exception) | internal_error | failed | 8 |

The exit and job.errorCode projections SHALL be public commitments. As already stated
in the v1 guide:1130, completed.payload.reasons values are not v1-stable; the fixed
reason names above define this slice's settlement/test oracle without changing that rule.
No new exit number or change to the meanings of 0–8 SHALL be introduced.

For artifact Runs, run-artifacts SHALL own reopenAdmittedRunDir(job,committedInitialRefs):
open stored artifactBaseDir/<jobId> with a stable-directory handle, recheck registered
root/artifacts-base containment, verify every initial committed artifact_created ref's
role/path/sha256/size via verifyRunDirArtifactRef, and seed receipts only for verified
single-link regular files. Mismatch SHALL settle failed/artifact_admission_mismatch
with completed.payload.reasons containing artifact_admission_mismatch and
job.errorCode=artifact_admission_mismatch, create/default retry/wait exit 1, without
new terminal refs; it SHALL never hang or write outside admitted bounds. No fd SHALL
cross processes and no dev/ino SHALL enter public envelopes. Terminal staging names
SHALL be exclusive and unique per process plus preparation attempt; losers SHALL
discard only their own files. Reopening a terminal Run SHALL never republish it.

Daemon-claimed children SHALL use each runtime adapter's allowlisted native-home
variables from the daemon, per platform (e.g. HOME/CODEX_HOME/CLAUDE_CONFIG_DIR on POSIX;
USERPROFILE/APPDATA/LOCALAPPDATA on Windows), plus PATH-family variables; proxy variables
SHALL move only where that adapter forwards them. Existing secret stripping SHALL
remain unchanged; no client env snapshot SHALL be persisted. A daemon-claimed Run
bypasses the consumer's own env minimisation; that provenance change SHALL be disclosed.
CLI runtimes list SHALL continue probing the CLI environment and SHALL not claim daemon readiness.

#### Scenario: Daemon starts without a renderer window
<!-- Scenario register: S41 (retained living scenario; title unchanged for MODIFIED archive) -->
- **GIVEN** `tests/fixtures/local-job-api-async/executor/queue.json#S41`, with an isolated daemon profile and recording packaged-bootstrap ports for renderer/menu/updater/auth/MCP startup
- **WHEN** the user runs `locus daemon run`
- **THEN** the packaged CLI launches the Locus Electron main process in daemon mode
- **AND** the daemon starts before GUI single-instance handling, menu construction, BrowserWindow creation, updater startup, auth callback server startup, and GUI-only MCP warmup
- **AND** the daemon writes diagnostics to stderr without polluting structured stdout

#### Scenario: Daemon claims queued daemon jobs
<!-- Scenario register: S42 (retained living scenario; title unchanged for MODIFIED archive) -->
- **GIVEN** `tests/fixtures/local-job-api-async/executor/queue.json#S42`, with queued daemon/schedule/API rows, excluded desktop/CLI/protocol rows, a concurrency-1 daemon and controlled runtime
- **WHEN** the daemon is running
- **AND** queued `source=daemon` jobs exist
- **THEN** the daemon starts those jobs through the shared runtime core according to configured local concurrency limits
- **AND** writes heartbeat, cancel, runtime event, and completion state through `agent_jobs` and `agent_job_events`
- **AND** does not claim `source=desktop`, default one-shot `source=cli`, or `source=protocol` jobs
- **AND** claims `source=schedule` jobs only through the explicit local scheduling scenario
- **AND** additionally claims admitted `source=api` jobs through the same pump and claim guard

#### Scenario: Daemon follows cancellation requests
<!-- Scenario register: S43 (retained living scenario; title unchanged for MODIFIED archive) -->
- **GIVEN** `tests/fixtures/local-job-api-async/executor/queue.json#S43`, with a running daemon job with a blocked worker and observable cancel request/confirmation latches
- **WHEN** `locus jobs cancel <job-id>` is used for a running daemon job
- **THEN** the system records a persisted cancel request
- **AND** the daemon worker observes the request through the job observer
- **AND** the daemon marks the job `canceled` only after the runtime stops or the worker confirms cancellation

#### Scenario: User follows daemon logs
<!-- Scenario register: S44 (retained living scenario; title unchanged for MODIFIED archive) -->
- **GIVEN** `tests/fixtures/local-job-api-async/executor/queue.json#S44`, with a daemon job with sequence-ordered events, a pending terminal latch and stdout/stderr capture
- **WHEN** a user follows a daemon job with `locus run --daemon --follow` or `locus jobs logs <job-id> --follow`
- **THEN** the CLI streams persisted events in sequence
- **AND** exits after the daemon job reaches a terminal status

#### Scenario: Daemon restarts after crash
<!-- Scenario register: S45 (retained living scenario; title unchanged for MODIFIED archive) -->
- **GIVEN** `tests/fixtures/local-job-api-async/executor/queue.json#S45`, with stale running rows with confirmed-stopped workers and a stopped-vs-live liveness fixture
- **WHEN** the daemon starts and finds jobs marked running without an active worker
- **THEN** it marks those jobs as interrupted
- **AND** exposes retry or resume only when the runtime adapter supports it

#### Scenario: Daemon coordination stays local
<!-- Scenario register: S46 (retained living scenario; title unchanged for MODIFIED archive) -->
- **GIVEN** `tests/fixtures/local-job-api-async/executor/queue.json#S46`, with an isolated daemon profile, network-listen spy and requests carrying forbidden token/API-key/env fields
- **WHEN** the local daemon is running
- **THEN** it uses only local per-user coordination primitives and the app SQLite database for queue state
- **AND** does not expose an unauthenticated TCP HTTP or WebSocket control surface by default
- **AND** does not accept provider tokens, API keys, or raw environment values from daemon clients
- **AND** the token/env input variants are rejected before a job or provider call and the
  network-listen spy stays zero, while only the configured local profile is changed

#### Scenario: S28 Daemon executes API work once and preserves source exclusions
- **GIVEN** `tests/fixtures/local-job-api-async/executor/queue.json#S28`, with admitted daemon/schedule/API-agent/API-completion/desktop/CLI/protocol rows,
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
- **GIVEN** `tests/fixtures/local-job-api-async/executor/publication.json#S37`, with a registered project with artifact base, process A using an isolated DB and
  process B with no shared memory/receipts, plus digest/symlink/hardlink mismatch variants
  and equivalent create/default retry variants paused after their own admission for B to claim
- **WHEN** A submits and exits, B's daemon claims/reopens/executes/publishes, then process C
  invokes runs wait; repeat with each initial-file mismatch before B starts; repeat
  mismatch checks while create/default retry waits on its own admitted ID
- **THEN** the valid Run becomes ready/exit 0 with golden prepared-tail refs, existing
  initial events.jsonl/artifacts.json targets replaced only after verified receipt seeding
- **AND** mismatch cases call no provider and settle once with status=failed,
  completed.payload.reasons containing artifact_admission_mismatch and
  job.errorCode=artifact_admission_mismatch, no new terminal refs; wait and an observing
  create/default retry wrapper return that failed outcome/exit 1, and outside files remain unchanged
- **AND** processes share only persistent DB/files; stdout contains no dev/ino/raw env

#### Scenario: S39 Claim revalidates project identity profile and age
- **GIVEN** `tests/fixtures/local-job-api-async/executor/admission.json#S39`, with admitted queued API fixtures, mutated after ack by unregistering the project,
  replacing cwd directory identity, invalidating the execution profile/grant, or advancing
  the fake clock to exactly createdAt+86400000; include an unchanged younger control
  and profile-owner errors with unavailable/invalid-request/local-only binding codes
  plus a profile error without a binding code; equivalent create/default retry variants
  pause after admission for the same mutation, claim and outcome checks
- **WHEN** daemon pump attempts claim and the daemon expiry tick runs
- **THEN** changed fixtures settle through the host once with status=failed and
  completed.payload.reasons entries respectively project_unregistered, cwd_identity_changed,
  execution_profile_invalid and queued_age_exceeded, zero provider calls/child spawns
  and no unsafe artifact writes
- **AND** job.errorCode equals each matching reason except that the profile variants
  preserve their owner-supplied binding code; create/default retry and wait return exits
  7/7/(4,2,6 for those binding codes or 3 without one)/1 respectively, as the table specifies
- **AND** the unchanged fixture executes exactly once; injecting internal maxQueuedApiAgeMs
  moves only the age threshold, never bypasses the identity/profile gates

#### Scenario: S40 Runtime environment belongs to the actual claimant
- **GIVEN** `tests/fixtures/local-job-api-async/executor/environment.json#S40`, with per-platform adapter-allowlisted native-home/PATH sentinels A and B for submitter
  and daemon, proxy sentinels only for adapters that forward them, injected
  runtime child env capture, fake native credential readiness and secret env sentinels
- **WHEN** A submits and B claims, then a separate no-daemon Q2(a) create runs locally;
  runtimes list is invoked from A
- **THEN** daemon-claimed child uses B and local wrapper child uses A for allowed native
  homes/PATH and only adapter-forwarded proxy variables; both apply unchanged secret
  stripping, never forward raw tokens; daemon execution bypasses the caller env allowlist
- **AND** CLI readiness reports A only, while no DB/request/event/log stores A or B env
  snapshots or secret values; the fixture proves native-home provenance, not API-key billing

### Requirement: Local Job Scheduling
The system SHALL support opt-in local schedules that create visible local jobs through the durable job store.

#### Scenario: User creates schedule
- **WHEN** the user creates a local schedule
- **THEN** the system stores schedule metadata locally
- **AND** shows the schedule as enabled, paused, or disabled
- **AND** creates visible `source=schedule` jobs when schedule triggers fire

#### Scenario: User pauses schedule
- **WHEN** the user pauses a schedule
- **THEN** no new jobs are created by that schedule until it is resumed
- **AND** existing jobs keep their current status

#### Scenario: User runs schedule now
- **WHEN** the user manually runs an enabled or paused schedule
- **THEN** the system creates a queued `source=schedule` job immediately
- **AND** records schedule audit metadata that links the job back to the schedule

#### Scenario: Daemon evaluates due schedules
- **WHEN** the local daemon is running
- **AND** an enabled schedule is due
- **THEN** the daemon creates at most one queued `source=schedule` job for that schedule fire
- **AND** updates the next-run metadata before another daemon poll can create a duplicate
- **AND** may claim the queued schedule job through the same runner core

#### Scenario: User deletes schedule
- **WHEN** the user deletes a local schedule
- **THEN** the schedule no longer creates new jobs
- **AND** previously created jobs and events remain visible in job history

### Requirement: Headless Runtime Event Convergence
Headless jobs SHALL use the ledger in the Run's host process (CLI/daemon or Electron
host as applicable) through a thin observer ingress adapter. Codex app-server's committed
records SHALL be consumed directly without suppressing completed or appending a second
copy; coarse Claude/Codex exec output SHALL enter the same owner as observations.

#### Scenario: Batch process event is persisted
- **WHEN** `headless-projection.json` drives the coarse observer and app-server committed
  event consumer with recording ledger/store ports
- **THEN** coarse assistant/command/status/error/result input invokes ledger ingress,
  while committed app-server records retain their original sequence and completed
- **AND** the persisted reader contains each committed record once; the headless wrapper
  performs no raw store append or extra terminal mint

#### Scenario: Existing event readers remain compatible
- **WHEN** jobs logs reads the headless fixture and runs events reads its separate
  source=api fixture from `headless-projection.json`
- **THEN** each returns the documented envelope in sequence; v1 has bare semantic payload
  while the internal reader retains record metadata
- **AND** neither reader requires provider chunks or desktop wrapper interpretation

### Requirement: Headless Adapter Selection Boundary
Headless local jobs SHALL select adapters through the canonical runtime route
catalog in `src/main/lib/agent-runtime/runtime-route-catalog.ts` instead of binding
each runtime ID to exactly one adapter. The former headless adapter selector and
its production call sites SHALL be replaced in the same change; no forwarding
compatibility alias or duplicate adapter table SHALL remain.

#### Scenario: Existing batch behavior is preserved
<!-- Scenario register: S14; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/headless.json#S14` with existing CLI, daemon, schedule, protocol and Local Job API requests for both runtimes, using their original parser defaults and runtimeRouteCatalog options forwarded from the real hosts to runAgentTask, with recording leaf ports (no options.runner or LOCUS_HEADLESS_FAKE_RUNNER bypass)
- **WHEN** runHeadlessCliCommand, pumpQueuedRuns or runJobsStdioServer starts the corresponding existing CLI, daemon, schedule, protocol, or Local Job API v1 job without an explicit non-batch execution profile
- **THEN** the catalog chooses the existing batch behavior when capability and
  policy checks pass
- **AND** `codex exec` and `claude -p` remain available as batch adapters with baseline argv/stdin, source and cancellation ports

#### Scenario: Rich adapter is not silently selected
<!-- Scenario register: S15; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/headless.json#S15` with runAgentTask's runtimeRouteCatalog test option containing both batch and rich factories, a batch request and unsupported/interactive-only requests
- **WHEN** runAgentTask resolves the batch request while a richer SDK or app-server adapter is available for the same runtime
- **THEN** headless jobs do not use it unless the request, capability gate, and
  permission policy explicitly allow that adapter source
- **AND** unsupported or interactive-only requirements fail closed before
  native provider work starts (existing provider-binding reads/records keep their order); the recording rich factory remains uncalled for the batch request

### Requirement: Headless Claude Credential Resolution

Headless Claude runs SHALL resolve authentication from the app-managed Anthropic account store first and SHALL fall back to the bundled CLI's local login only when no usable app-stored credential exists. Credential material MUST enter the runtime through the child process environment only and MUST NOT appear in CLI arguments, job events, or structured output.

#### Scenario: App-stored account authenticates a headless run

- **WHEN** a headless Claude job starts on a machine whose Locus app has a connected Anthropic account
- **THEN** the adapter resolves the account token in the main process and injects it into the runtime child environment
- **AND** the run authenticates without requiring a separate `claude` CLI login
- **AND** provider env variables stripped by the shared Claude env builder remain stripped

#### Scenario: No app account falls back to CLI login

- **WHEN** a headless Claude job starts and no app-stored Anthropic account exists
- **THEN** the adapter starts the runtime without injecting a token
- **AND** the bundled CLI resolves its own local login as it does today

#### Scenario: Inherited env token is ignored

- **WHEN** a headless Claude job starts with `CLAUDE_CODE_OAUTH_TOKEN` inherited from the parent environment
- **AND** no app-stored token is injected for the run
- **THEN** the adapter removes the inherited token from the child runtime environment
- **AND** emits a stderr diagnostic that names Locus desktop sign-in and `claude` CLI login as the supported credential sources

#### Scenario: Unhealthy app store does not break a working CLI login

- **WHEN** an app-stored credential exists but cannot be resolved (secure storage unavailable or token refresh fails)
- **THEN** the adapter emits a stderr diagnostic and falls back to the bundled CLI's local login
- **AND** the job does not fail solely because the app store is unhealthy

#### Scenario: No credential in either source

- **WHEN** a headless Claude job starts with no app-stored account and no CLI login
- **THEN** the run fails with the `runtime_auth_required` error code and the missing-credentials exit code
- **AND** the diagnostic hint names both remedies: signing in through the Locus desktop app or logging in with the `claude` CLI

### Requirement: Headless Provider Selection

Headless one-shot runs and schedules SHALL support selecting a stored provider profile and/or model by reference. An explicit profile SHALL use that profile; a model-only provider selection SHALL use native credentials; only omission of the entire provider selection SHALL consult configured provider defaults before native credentials. An explicit or defaults-sourced profile that cannot be used SHALL fail the run with a structured error rather than silently falling back.

#### Scenario: CLI run selects a profile and model

- **WHEN** the user runs `locus run` with a provider profile flag and optional model flag
- **THEN** the run executes through the referenced profile via the local provider gateway
- **AND** an explicit model flag overrides the profile's default model

#### Scenario: No selection falls back to defaults, then native

- **WHEN** a headless run starts with the entire provider selection omitted
- **THEN** the configured provider default for the runtime's purpose applies when present, including its model override
- **AND** the runtime's native credentials apply when no default is configured

#### Scenario: Model-only selection on native credentials

- **WHEN** a headless run specifies a model but no profile
- **THEN** the run uses native credentials with the requested model

#### Scenario: Schedule persists its provider selection

- **WHEN** a schedule is created with a provider selection
- **THEN** the selection is persisted with the schedule and copied to each triggered job
- **AND** a triggered or retried job whose referenced profile no longer exists fails with a structured provider error instead of running on native credentials

### Requirement: Catalog Selection Does Not Own Queue Dispatch

`headless/daemon.ts#pumpQueuedRuns` SHALL remain the only queued execution
dispatch owner. It SHALL retain its own job.kind-to-agent/completion-runner dispatch.
Catalog lookup SHALL occur only in the agent runner after claim, the existing
claim gate and provider binding/recordResolvedProvider, without moving source slots, conditional claim, concurrency, worker identity,
claim-time API gate, heartbeat, cancellation or retention into the catalog.
CLI API and jobs-stdio SHALL remain submit/pump envelope consumers, and the human
one-shot runner and desktop-source execution SHALL preserve their existing owners.

#### Scenario: S16 Concurrent pumps still execute an admitted Run once
- **GIVEN** `tests/fixtures/runtime-route-catalog/executor.json#S16` with two SQLite connections, queued daemon/schedule/API-agent/API-completion rows, excluded desktop/CLI/protocol rows, concurrency-one pumps and claim/runner latches and pumpQueuedRuns runtimeRouteCatalog options forwarded unchanged to recording agent leaf ports
- **WHEN** the real pumpQueuedRuns instances race using their own kind-to-runner dispatch
- **THEN** each admitted eligible Run has at most one successful claim and one execution; the losing claimant performs no catalog query or adapter/provider call; query spies run only after the winning claim and the existing provider binding record
- **AND** daemon source order remains daemon then schedule then api, ordinary daemon leaves excluded sources untouched, claim-time revalidation still precedes provider work and the catalog writes no rows/events

#### Scenario: S17 Submission replay and scoped protocol execution reuse existing owners
- **GIVEN** `tests/fixtures/runtime-route-catalog/executor.json#S17` with matching keyed submit replay, an own-ID synchronous wrapper pump and a jobs-stdio session owning one admitted ID
- **WHEN** replay is submitted and each scoped pump runs, including a competing claimant
- **THEN** replay retains one job/key and does not invoke the catalog factory again; wrapper and stdio dispatch only their admitted IDs through the existing pump
- **AND** ack, wait/publication barrier, session cancellation and retained terminal results remain owned by submission/ledger/host; no protocol/API inline runner is restored
