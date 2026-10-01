## ADDED Requirements

### Requirement: Asynchronous Run Submission

The Local Job API SHALL expose `locus api runs submit --request <path|-> --json`
using the existing agent/completion create request with an optional idempotencyKey.
Fresh submission SHALL return `{apiVersion:"locus.local-job.v1",job}` with a queued
admission snapshot and exit 0 after durable creation and required initial artifact
admission, without waiting for execution. The snapshot SHALL NOT imply that the Run
is still queued when the client receives it. Replay SHALL return the existing Run's
current state. Validation, source=api, capability/profile/provider and filesystem
boundaries SHALL remain those of the existing create contract.

#### Scenario: S01 Submit returns before execution is released
- **GIVEN** a temporary registered project and SQLite profile, fixed clock/IDs, an agent
  request with runtime codex, mode plan, prompt "Return OK", consumer fixture-a and no
  artifacts, and an existing executor whose runner is blocked on a test latch
- **WHEN** `locus api runs submit --request - --json` receives that JSON
- **THEN** stdout contains one complete v1 job envelope without result and the command
  exits 0 before the runner latch is released
- **AND** getAgentJob and readCommittedRunEvents show the same API job and committed
  `job_created` at sequence 1 with observation key `lifecycle:job-created:<id>` and fact key ending in `:0` before ack
- **AND** with claim paused the ack status is queued; allowing claim afterward never
  changes that returned admission snapshot or creates another job

#### Scenario: S02 Existing admission gates run before provider work
- **GIVEN** separate temporary-profile fixtures for unregistered cwd, an unsupported
  required capability, an invalid execution profile/grant, an unusable explicit
  provider profile, a secret-bearing input and a completion containing agent-only fields
- **WHEN** each is submitted through `runs submit --request - --json`
- **THEN** each follows its existing create validation/error/exit policy, performs zero
  provider calls and has no successful queued acknowledgement
- **AND** an ordinary no-profile agent request retains the batch selector path; no
  fixture silently changes runtime, provider or filesystem scope

### Requirement: Synchronous Operations Use Submit And Wait

`runs create` and the default `runs retry <id>` SHALL submit through the same core and
wait for committed, published completion. Existing requests SHALL retain complete
terminal response bytes and existing outcome-derived 0–8 exit meanings. They SHALL
NOT call a runtime runner inline. Only explicitly keyed replay responses MAY add
`idempotentReplay:true`; unkeyed terminal responses SHALL NOT add submission/executor
metadata. Retry `--async` SHALL opt into the submit response. An internal wait timeout SHALL NOT be converted into a Run outcome, a terminal
stdout response or exit 9 from create/retry. The wrapper SHALL use the same read-only
wait core and SHALL NOT change existing Run exit semantics to conceal executor or
publication failure.

#### Scenario: S03 Old create matches submit plus wait byte for byte
- **GIVEN** independent equivalent profiles with fixed IDs, clock, worker identity,
  app version, paths and sanitized deterministic results for succeeded, failed,
  canceled and interrupted, plus each existing specialized exit-code case
- **WHEN** one invokes old-shaped `runs create` and another invokes submit then wait
  with an available existing executor
- **THEN** create's entire stdout including newline equals the terminal wait stdout
  and the baseline create golden bytes without deleting or normalizing output fields
- **AND** process exit codes equal the baseline 0–8 mapping, one job_created and one
  completed exist, and the submitter's runner/child-process spy is never invoked

#### Scenario: S04 Default retry retains synchronous response and lineage
- **GIVEN** identical retained failed API source jobs in equivalent fixed-clock profiles
- **WHEN** one calls `runs retry <source-id> --json` with no new flags and the other
  calls `runs retry <source-id> --async --json` followed by wait through an available executor
- **THEN** the first response is emitted only after terminal publication and its full
  stdout and exit code equal the second flow's wait and the baseline retry golden output
- **AND** each creates one distinct child ID, retryOfJobId=source-id and
  attempt=source.attempt+1, without changing the source job/events/artifact bytes

#### Scenario: S25 Internal wait timeout does not become a create result
- **GIVEN** a valid create request, an available executor whose runtime latch remains
  held for the first 30000 ms, and a fake monotonic clock
- **WHEN** the internal wait deadline expires and then the executor is released to
  commit and publish a successful terminal in the next bounded observation interval
- **THEN** create emits no timeout envelope or interim stdout, does not exit 9, and
  eventually returns the baseline complete terminal envelope with exit 0
- **AND** store reads show one attempt, no timeout error/completed and no repeated execution

### Requirement: Bounded Wait For Published Terminal Result

`runs wait <job-id> [--timeout <milliseconds>] --json` SHALL read only API jobs and
SHALL return the create terminal envelope only after a committed completed record and
verified publication of all required terminal files. Without artifacts the publication
condition SHALL be vacuous. Default timeout SHALL be 30000 ms; explicit timeout SHALL
be an integer from 0 to 86400000 inclusive, with 0 a single observation. A final ready
observation at the deadline SHALL win over timeout. Otherwise stdout SHALL be
`{apiVersion,job,wait:{state:"timeout",timeoutMs,reason}}`, without result, and exit 9.
Reason SHALL distinguish executor_unavailable, executor_unknown, run_pending and
terminal_artifacts_pending. A terminal job status with pending files SHALL remain
terminal in this non-ready response. Wait SHALL NOT settle, cancel, retry or expire a
Run and SHALL NOT use events-follow completion as a publication barrier.

#### Scenario: S05 Wait observes both commit and publication
- **GIVEN** an artifact-bearing API job, frozen final files, and separate latches before
  terminal SQL commit and before the last final-file rename
- **WHEN** `runs wait <id> --timeout 1000 --json` observes each stage
- **THEN** neither a staged file before commit nor a completed record before full
  publication produces a terminal response
- **AND** releasing all renames before the deadline produces one complete create
  envelope whose artifact paths/digests match that commit and its outcome exit code
- **AND** an artifact-free completion fixture returns ready immediately after commit

#### Scenario: S06 Wait has explicit bounded timeout semantics
- **GIVEN** queued and running API fixtures, a fake monotonic clock and no terminal commit
- **WHEN** wait is invoked with no timeout, timeout 0 and timeout 25 respectively
- **THEN** each returns a non-ready envelope at 30000, one observation, and 25 ms
  respectively with exit 9, no result and the expected current job status/reason
- **AND** negative, fractional, NaN, Infinity or greater-than-86400000 values exit 2
  without Run mutations; a ready final observation exactly at deadline returns terminal
- **AND** stdout has one JSON value, diagnostics use stderr, and no new completed exists

#### Scenario: S07 Multiple waiters and late facts cannot change the result
- **GIVEN** two wait processes on one API job, with commit occurring between their
  initial read and wakeup registration, then published files and a late diagnostic
- **WHEN** both waiters re-read committed facts and a third waiter opens after completion
- **THEN** all return the same terminal envelope/outcome without missing the commit,
  altering terminal file digests, appending events or starting another attempt
- **AND** a later explicit events read can include the diagnostic without changing wait's result

### Requirement: Consumer Scoped Idempotent Submission

Submit/create and retry SHALL accept an optional idempotencyKey, 1–160 ASCII characters
from `[A-Za-z0-9._:-]`, case-sensitive with no trimming. Its namespace SHALL be existing
normalized consumer.id plus the key. Matching normalized intent SHALL replay the same
retained job with optional top-level idempotentReplay=true and zero extra execution;
a different intent SHALL return the existing apiVersion+error outer shape with
code=idempotency_conflict and exit 2, without echoing input/key.

Fingerprint normalization SHALL preserve current defaults and runtime aliases, use
canonical cwd/project/artifact-base identities, sort object keys and capability sets,
preserve all other array order, and include consumer external ID, kind, execution
profile/grant, provider selection intent, prompt/input or completion messages/schema/
tuning. It SHALL exclude raw key, sync/async/wait controls, generated IDs/times and
credentials. Create and submit SHALL share the submit intent; retry SHALL include its
source job ID and stored input snapshot under a distinct retry intent. Omitted provider
selection SHALL remain distinguishable from explicit selection. No domain-specific
interpretation of opaque input or response schemas SHALL be introduced.

Reservation SHALL store only consumer identity, domain-separated key hash, normalized
request hash/version, job reference and retention metadata. Reservation and job insert
SHALL commit together under a unique consumer/key constraint. Creation compensation
SHALL release them together only if the job is still queued with no committed facts.
A reservation lacking committed creation SHALL NOT be replay-acknowledged or executed.
A nonterminal reservation SHALL additionally require initial artifact admission when
its request needs artifacts. Either missing prerequisite SHALL report submission_pending
through apiVersion+error with exit 8.

Retention SHALL be at least 30 days after verified terminal publication, with expiresAt
set once by the publishing/execution owner, never by the read-only waiter. Nonterminal,
unpublished-terminal and orphan reservations SHALL NOT automatically expire. Replay
SHALL NOT extend expiration. Expiry cleanup SHALL remove only reservation metadata;
existing authorized job deletion SHALL cascade its reservation. Original key SHALL NOT
appear in stored requests, request artifacts, ledger records, public responses or logs.

#### Scenario: S08 Normalized replay spans create and submit
- **GIVEN** a retained published API job submitted with consumer fixture-a, key req-1,
  runtime claude alias and omitted defaults in a fixed project
- **WHEN** submit then create repeat its equivalent request using claude-code, explicit
  equivalent defaults and reordered object keys with the same key
- **THEN** both identify the existing job with idempotentReplay=true, create returns its
  retained terminal envelope, and store job/event counts and provider-call count do not grow
- **AND** replay still returns that attempt if its provider configuration later changes

#### Scenario: S09 Changed request conflicts without exposing the key
- **GIVEN** a committed key binding for a request and variants changing prompt, mode,
  provider intent, artifact base, completion messages/schema or consumer external ID
- **WHEN** each variant is submitted under the same consumer/key
- **THEN** it exits 2 with error.code=idempotency_conflict in a v1 error envelope,
  adds no job or event and starts no provider work
- **AND** neither stdout nor stderr contains the key or stored request content

#### Scenario: S10 Same key cannot replay across consumers
- **GIVEN** two valid requests identical except consumer.id=fixture-a and fixture-b,
  both with key req-1, and an executor paused before claim
- **WHEN** both invoke submit
- **THEN** distinct job IDs and reservations exist, neither response is a replay and
  each job has exactly one committed creation fact
- **AND** repeating fixture-b returns only fixture-b's ID, never fixture-a's

#### Scenario: S11 Concurrent requests reserve one attempt
- **GIVEN** two independent SQLite connections and concurrent submit processes for one
  consumer/key with identical input, followed by a differing-input contender
- **WHEN** transactions are interleaved before insert, after reservation, after creation commit but before required initial artifact admission,
  and after all admission facts commit
- **THEN** at most one job/reservation is inserted and at most one execution is claimed;
  contenders report matching replay only after required admission commits, pending before them, or conflict
- **AND** a fresh DB connection sees no reservation pointing at an uncommitted job

#### Scenario: S12 Rollback and creation compensation release the key
- **GIVEN** reservation fault fixtures throwing before SQL commit and throwing on
  creation-fact append after job/reservation commit with ordinary compensation permitted
- **WHEN** submit fails and a new connection inspects jobs, reservations and events
- **THEN** all three contain no rows for the failed submission and no ack was emitted
- **AND** retrying the same consumer/key with the fault removed creates one job and
  one creation fact without idempotentReplay=true

#### Scenario: S13 Crashed creation never becomes a successful replay
- **GIVEN** a process killed after job/reservation commit but before creation, plus a
  compensation-failure fixture and a concurrent still-live creator paused at that boundary
- **WHEN** another process submits the same key or the daemon polls the queue
- **THEN** each missing-fact reservation returns submission_pending/exit 8, never a
  successful job ack; list/start admit none of those jobs and provider calls stay zero
- **AND** the second process does not delete a potentially live creator's reservation

#### Scenario: S14 Retention has a declared endpoint
- **GIVEN** a fake clock, a published terminal with expiresAt exactly publication+30 days,
  and nonterminal, unpublished-terminal and orphan reservations of greater age
- **WHEN** replay/cleanup runs just before expiry, at expiry and after expiry
- **THEN** only the expired published reservation is released; its next submission
  creates a new job without replay, while the other reservations stay bound
- **AND** job/event/artifact bytes are retained, replay never extends expiresAt, and
  an independently authorized job deletion cascades only that job's reservation

#### Scenario: S15 Idempotency key stays out of durable and diagnostic output
- **GIVEN** a unique non-secret sentinel key and a request with artifacts in an admitted run-dir
- **WHEN** submit, replay and conflict complete, then store readers, request.json,
  events.jsonl, result.json, manifests and captured stdout/stderr are inspected
- **THEN** none contains the original key; reservation stores a hash, not the raw key
- **AND** empty, whitespace, overlength and secret-like key values reject before
  runnable work without echoing them or relaxing existing secret rejection

### Requirement: Executor Availability Observation

`runs status <id> --json` SHALL include optional top-level execution with state
available, unavailable or unknown; reason executor_observed, no_executor or
probe_unavailable; observedAt; and a sanitized local startup hint when applicable.
It SHALL be advisory and distinct from runtime credential readiness. Availability
SHALL require evidence that an eligible executor for the same local profile supports
API work; a lock file alone SHALL NOT suffice. Absent or confirmed-stopped executor
SHALL report unavailable; indeterminate identity/liveness SHALL report unknown.
Observation SHALL NOT expose PID, hostname, nonce, lock paths or secrets and SHALL
NOT start a daemon, acquire its lock or alter job status.

#### Scenario: S16 Submission without an executor is observable
- **GIVEN** a valid artifact-free request and an isolated profile with no executor lock
- **WHEN** submit succeeds, status reads its ID and wait reaches its deadline
- **THEN** creation is committed, status reports execution.state=unavailable,
  reason=no_executor and hint="locus daemon run", and wait reports executor_unavailable/exit 9
- **AND** the job remains queued with no job_started, completed or provider call;
  the existing desktop/store overview reads that same queued API job and consumer

#### Scenario: S17 Lock observations do not invent liveness
- **GIVEN** fixtures for a matching live API-capable daemon lock/nonce, confirmed dead
  process, legacy lock without capability metadata, permission-denied probe and swapped nonce
- **WHEN** `runs status` reads each fixture through injected filesystem/liveness ports
- **THEN** states are respectively available, unavailable, unknown, unknown and unknown
- **AND** no PID, nonce, hostname, lock path or credential sentinel is returned, no
  lock is changed, and runtime.readiness authentication states are unaffected

### Requirement: Async Control Preserves Run Identity

Queued cancel SHALL use the existing pre-start ledger canceled settlement and prevent
execution if it wins claim. Running cancel SHALL remain a request until the worker
confirms settlement. Retry SHALL create a new attempt only from failed, canceled or
interrupted API jobs, use the same submission owner, and support the optional key.
New retry request consumer.id SHALL match the stored source consumer; no new request
body SHALL be required for existing retry/cancel calls.

#### Scenario: S18 Queued cancel wins claim without a second terminal
- **GIVEN** a freshly acknowledged API job and paused daemon, plus a second variant
  pausing after worker claim; include artifact-bearing and artifact-free fixtures
- **WHEN** `runs cancel <id> --json` races with executor release in both winner orders
- **THEN** cancel-first produces one committed canceled completed, no worker spawn,
  and wait returns the canceled envelope/exit 5 after required publication
- **AND** start-first only records the cancel request until worker confirmation, then
  one completed appears; repeated cancel and Workbench/store reads do not create another terminal

#### Scenario: S19 Retry key replays the child and preserves the parent
- **GIVEN** a terminal failed API job with consumer fixture-a and a retry request
  `{apiVersion:"locus.local-job.v1",consumer:{id:"fixture-a"},idempotencyKey:"retry-1"}`
- **WHEN** two `runs retry <id> --request - --async --json` calls and one synchronous
  retry with that request execute concurrently through an available executor
- **THEN** all refer to one new child ID with original retryOfJobId and attempt+1,
  replay responses are marked, and the synchronous call waits for that child's result
- **AND** changing the source ID with the same scoped key conflicts; changing consumer
  to fixture-b rejects before lookup; parent events/results/artifacts stay byte-identical

#### Scenario: S20 API reads and control stay source-scoped
- **GIVEN** desktop, cli, protocol and unknown job IDs, plus succeeded and queued API jobs
- **WHEN** wait/retry and existing cancel/events operations are exercised
- **THEN** non-API or missing IDs are rejected by API readers/control as before; retry
  of succeeded or queued jobs is rejected, with zero new jobs or provider work
- **AND** no read/control request needs provider credentials from the consumer

### Requirement: Async Features Preserve Existing V1 Contracts

The discovery features array SHALL add async-submit while keeping exact
apiVersion=locus.local-job.v1 and all existing identifiers. Consumers requiring the
feature SHALL reject its absence before dispatch; unknown versions SHALL NOT be
silently accepted. The machine-readable discoveryFeature enum SHALL include the new
identifier. Existing event types, six-field envelopes, dense sequences, after/follow,
result/artifact contracts and 0–8 exit meanings SHALL remain unchanged. Optional
response fields SHALL be safely ignorable. Adding an identifier SHALL NOT imply a
pinned older closed-enum schema will accept it.

#### Scenario: S21 V1 event and artifact regression is unchanged
- **GIVEN** baseline public-v1/public-results fixtures containing all 12 event types,
  committed initial artifact refs before job_started, a completed and late diagnostics
- **WHEN** runs events with --after 2, --follow --jsonl, runs result and a terminal wait
  consume the fixtures produced by the queued executor
- **THEN** existing event envelopes retain exactly apiVersion/jobId/sequence/type/createdAt/payload,
  dense original sequences, bare redacted payload and existing optional extensions
- **AND** after is strictly greater-than; follow exits at terminal without waiting for
  late diagnostics or publication; wait alone requires publication; explicit later reads see late facts
- **AND** artifact names, roles, SHA-256, result fields and retention equal baseline
  fixtures, with no native raw event union, new event enum or vendor-specific consumer branch

#### Scenario: S22 Discovery advertises the extension with explicit schema evolution
- **GIVEN** a migrated async-enabled profile, the baseline pinned v1 schema with closed
  discoveryFeature enum, and the updated schema fixture including async-submit
- **WHEN** runtimes list --json output is validated against both schema fixtures
- **THEN** it retains locus.local-job.v1 and existing features, includes async-submit,
  passes the updated schema and fails the older enum at the new identifier
- **AND** a consumer ignoring optional status/replay fields can still read old envelopes;
  an unmigrated build does not advertise async-submit

#### Scenario: S23 Unsupported version and absent feature fail closed
- **GIVEN** a no-feature discovery fixture and a valid request with only apiVersion
  replaced by locus.local-job.v1.1 or an unknown version
- **WHEN** a neutral feature-dependent client reads that discovery, and the CLI parses
  each unsupported-version request separately
- **THEN** the client dispatch spy records zero submissions; the CLI exits 2 with the
  existing "apiVersion must be locus.local-job.v1" validation and no new job
- **AND** no key is assumed honored by an older build and no silent downgrade occurs

#### Scenario: S24 Completion uses the same queued admission
- **GIVEN** a reference-only usable completion provider, opaque json_schema response
  format, deterministic upstream fetch fixture and no agent-only fields
- **WHEN** submit acknowledges the completion, an existing daemon executes it and wait returns
- **THEN** exactly one upstream call occurs after claim, its structured output and
  usage use the existing result/event contract, and no runtime child or run-dir exists
- **AND** completion create through the same fixtures matches its baseline terminal
  stdout/exit; explicit profile failure never falls back to native credentials
