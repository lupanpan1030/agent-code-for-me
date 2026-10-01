## ADDED Requirements

### Requirement: Asynchronous Run Submission

The Local Job API SHALL expose `locus api runs submit --request <path|-> --json`
using the existing agent/completion request plus optional idempotencyKey. Fresh
submission SHALL return `{apiVersion:"locus.local-job.v1",job}` with a queued admission
snapshot and exit 0 after committed creation and required initial artifact admission,
without waiting for execution. Replay SHALL return the retained job's current state.
The create request SHALL accept no new fields; idempotencyKey SHALL be explicitly
rejected on create with stdout v1 error idempotency_key_not_supported/exit 2. Keys
SHALL be accepted only on submit and retry --request. Validation, source=api and existing
admission boundaries SHALL remain in their canonical owners. A claim following admission SHALL be visible
through status, independently of the already emitted queued snapshot.

#### Scenario: S01 Submit returns before execution is released
- **GIVEN** `tests/fixtures/local-job-api-async/submit-wait/public-submission.json#S01`, with an artifact-free codex/plan request, registered temporary project/profile,
  fixed IDs/clock and a pump paused at claim with its runtime blocked on a second latch
- **WHEN** `locus api runs submit --request - --json` receives the request
- **THEN** it exits 0 with exactly one queued job envelope, no result, before runtime release
- **AND** getAgentJob and readCommittedRunEvents show that job and exactly one sequence-1
  job_created with observationKey=lifecycle:job-created:<id> and factKey ending :0 before ack
- **AND** releasing claim makes `runs status <id> --json` report running while captured
  submit stdout still contains queued and the DB still has exactly one job

#### Scenario: S02 Existing admission gates run before provider work
- **GIVEN** `tests/fixtures/local-job-api-async/submit-wait/public-submission.json#S02`, with separate temporary-profile fixtures for unregistered cwd, an unsupported
  required capability, an invalid execution profile/grant, an unusable explicit
  provider profile, a secret-bearing input and a completion containing agent-only fields
- **WHEN** each is submitted through `runs submit --request - --json`
- **THEN** each follows its existing create validation/error/exit policy, performs zero
  provider calls and has no successful queued acknowledgement
- **AND** an ordinary no-profile agent request retains the batch selector path; no
  fixture silently changes runtime, provider or filesystem scope

### Requirement: Synchronous Operations Use Submit And Wait

Create and default retry SHALL use the same submit and wait owners; API handlers
SHALL NOT directly call either runtime runner. Normal unkeyed terminal stdout,
newline and 0–8 outcome exits SHALL match baseline. Retry --async SHALL return
admission; keyed retry replay MAY add idempotentReplay. Exit 9 SHALL belong only to
runs wait, never create/retry. An internal wait timeout SHALL NOT be a Run outcome.

The wrapper SHALL invoke the canonical pumpQueuedRuns scoped to its own admitted ID,
claim through startAgentJob, compose the same terminal artifacts and wait, without
an external daemon prerequisite or a detached launcher. If a daemon wins the claim,
the wrapper SHALL only wait and SHALL NOT dispatch that Run again.
A Run executing in the wrapper's own in-process pump SHALL be exempt from the 30000 ms
no-progress window: its pending dispatch promise SHALL be liveness evidence, with
existing runtime timeouts/cancel unchanged. For another process's claimant, progress
SHALL mean committed high-water change, job.heartbeatAt change, or confirmed-alive
evidence for that Run's committed worker identity within D5's existing 120 s recovery
heartbeat window. A 30000 ms no-progress observer error SHALL fire only while queued
or when that worker evidence is unknown/absent, never while that evidence is available.
A bare PID without committed worker identity SHALL NOT count as progress. The observer
error SHALL NOT declare the Run dead. Healthy long work SHALL retain existing runtime
timeouts and S25 behavior. Existing recovery SHALL alone decide
whether a stopped worker is interrupted, never an unknown liveness probe.

Today's publish failure returns artifacts:[] with the committed outcome exit.
The locally completed pump SHALL preserve those exact failure bytes; it SHALL NOT
label that failure response as wait-ready. For a remote claimant,
terminal files still pending 30000 ms after observing completed SHALL yield the
identified error/8, reason=terminal_artifacts_pending. The independent wait operation
SHALL keep its stricter publication barrier in every case. These R1 exceptions SHALL
be disclosed as accepted by Owner on 2026-10-02, never hidden in the normal-byte oracle.

Non-outcome read failure with an owned child SHALL stop that execution tree
and preserve the baseline stderr text and baseline exit (create: localJobApiCreateErrorCode
returns 2, or 3 for messages matching /unsupported/i; retry: 3) without a false terminal;
an admitted but not yet started own Run SHALL use existing queued cancel cleanup. For a remote
claimant it SHALL return stdout `{apiVersion,job,wait:{state:"error",reason:"observation_failed"}}`
with the admitted job ID, exit 8 and no result, so the consumer can cancel.
For a daemon-first Run, the wrapper SHALL relay cancel only for its admitted Run
on catchable abort, including armed stdin EOF. The platform contract SHALL be:

| Platform | Catchable abort | Cannot relay cancellation |
| --- | --- | --- |
| POSIX | SIGINT, SIGTERM, SIGHUP and armed stdin EOF | SIGKILL |
| Windows | Ctrl+C (SIGINT), Ctrl+Break (SIGBREAK), console close (SIGHUP) and armed stdin EOF | parent child.kill()/TerminateProcess; logoff/shutdown console events |

Cancel-by-ID SHALL be documented as the only reliable cancellation mechanism across
all platforms; stdin-EOF relay SHALL be the portable mechanism for piped consumers.
Cleanup SHALL wait at most 5000 ms for acknowledgement; on Windows, console close ends
the process after a system-defined grace that can truncate that wait. Preserving signal
exit SHALL mean re-raising the caught signal after cleanup so a POSIX parent observes signal
termination, not substituting an ordinary numeric 128+n exit; Windows has no signal exit
status, so a re-raise the runtime cannot perform (SIGBREAK/SIGHUP) SHALL end with exit 8.
EOF cleanup SHALL exit 8 without a terminal envelope. EOF-cancel SHALL be armed only if stdin is an open pipe at admission
and closes later. Ignored/already-closed stdin and the pre-admission EOF delimiting a
--request - body SHALL NOT arm cancellation.
Local own-pump process-tree abort behavior SHALL remain as today. Independent
submit exit SHALL NOT cancel admitted work. SIGKILL/TerminateProcess of a daemon-backed
waiter SHALL NOT be claimed to stop or cancel its Run. Career Kit's 500 ms kill grace
can truncate the 5 s acknowledgement wait; in the normal catchable relay case the cancel
request is persisted before the later kill, but hard-kill delivery is not guaranteed.

#### Scenario: S03 Old create matches submit plus wait byte for byte
- **GIVEN** `tests/fixtures/local-job-api-async/submit-wait/terminal-bytes.json#S03`, with independent profiles with injected job ID, createdAt/startedAt/completedAt,
  workerId, workerPid, appVersion, cwd/artifact paths and sanitized deterministic runtime
  results for succeeded/failed/canceled/interrupted and specialized baseline 0–8 exits
- **WHEN** old-shaped create with the own-Run scoped pump and submit+wait through the same canonical pump
  run separately with equivalent inputs and all terminal files published
- **THEN** complete stdout including newline and exit match the frozen baseline golden
  byte-for-byte, with no removed fields or post-output normalization
- **AND** result.artifacts equals the terminal preparer's registered prepared tail in
  order, including manifest ref, without the state refs' sequence members
- **AND** each has exactly one job_created/completed; API handler direct-runner spy is
  zero and pump dispatch is exactly one; a separate real-process variant asserts
  workerId/workerPid identify the actual wrapper or daemon that won claim, not injected values

#### Scenario: S04 Default retry retains synchronous response and lineage
- **GIVEN** `tests/fixtures/local-job-api-async/submit-wait/terminal-bytes.json#S04`, with identical retained failed API source jobs in equivalent fixed-clock profiles
- **WHEN** one calls `runs retry <source-id> --json` with no new flags and the other
  calls `runs retry <source-id> --async --json` followed by wait through an available executor
- **THEN** the first response is emitted only after terminal publication and its full
  stdout and exit code equal the second flow's wait and the baseline retry golden output
- **AND** each creates one distinct child ID, retryOfJobId=source-id and
  attempt=source.attempt+1, without changing the source job/events/artifact bytes

#### Scenario: S25 Internal wait timeout does not become a create result
- **GIVEN** `tests/fixtures/local-job-api-async/submit-wait/terminal-bytes.json#S25`, with a valid create request executed by the wrapper's own in-process pump, whose runtime
  latch remains held for the first 30000 ms, and a fake monotonic clock
- **WHEN** the internal wait deadline expires and then the executor is released to
  commit and publish a successful terminal in the next bounded observation interval
- **THEN** create emits no timeout envelope or interim stdout, does not exit 9, and
  eventually returns the baseline complete terminal envelope with exit 0
- **AND** store reads show one attempt, no timeout error/completed and no repeated execution
- **AND** a kind:"completion" variant whose single upstream call takes 45000 ms with no
  heartbeat/high-water change returns baseline stdout/exit under the own-pump exemption

#### Scenario: S34 Create and retry run without an external executor
- **GIVEN** `tests/fixtures/local-job-api-async/submit-wait/terminal-bytes.json#S34`, with isolated profiles with no daemon lock, valid agent/completion create requests,
  terminal retry sources and controlled canonical pump ports
- **WHEN** create/default retry runs and the deterministic worker is released
- **THEN** exactly the own admitted ID is claimed by pumpQueuedRuns,
  no daemon launches, unrelated queued work is untouched and stdout/exit equal baseline
- **AND** a daemon-first variant never double-dispatches; a stalled unknown worker with
  no heartbeat/high-water progress yields identified executor_unknown/8 within 30000 ms
- **AND** a daemon-first kind:"completion" variant with a 45000 ms upstream call, committed
  worker identity within D5's 120 s window and confirmed-alive daemon emits no error/8
  at 30000 ms and returns that claimant's terminal envelope/outcome once completed

#### Scenario: S35 Aborting a wrapper applies the chosen cancel policy
- **GIVEN** `tests/fixtures/local-job-api-async/submit-wait/controls.json#S35`, with a running wrapper-owned child, a daemon-first Run, two unrelated Runs and
  file-based requests with an open
  stdin pipe at admission, with separate ignored/already-closed stdin variants and a
  relay-ack latch held beyond 500 ms for the forced-kill timing case
- **WHEN** POSIX harnesses send SIGINT/SIGTERM/SIGHUP or SIGKILL, Windows harnesses deliver
  Ctrl+C, Ctrl+Break, console close or parent child.kill()/TerminateProcess, and both
  platforms close an armed stdin pipe;
  include Career Kit's POSIX SIGTERM→500 ms→SIGKILL sequence, a separate POSIX wrapper
  process-group kill for baseline own-tree receipts, and win32 non-detached kill
- **THEN** the own-pump tree matches baseline child-alive/dead, row-status and recovery
  receipts; daemon-first catchable abort relays cancel only for
  the admitted ID, persists the request before the normal later kill, and awaits ack at most 5000 ms
- **AND** signal cleanup re-raises the caught signal and the parent records that signal,
  while EOF cleanup exits 8 without a terminal envelope; a 500 ms hard kill truncates
  the acknowledgement wait without undoing an already persisted cancel request
- **AND** unrelated Runs continue and receive zero cancel requests from the wrapper
- **AND** SIGKILL/TerminateProcess of only a daemon-backed waiter records zero relayed
  cancel requests, leaves its daemon/Run running and queryable until explicit cancel or
  independently eligible recovery, and does not produce the own-pump tree-stop outcome
- **AND** ignored/already-closed stdin and --request - EOF consumed before admission
  produce zero EOF-triggered cancel requests and the submitted Run continues

### Requirement: Bounded Wait For Published Terminal Result

Runs wait SHALL read only API jobs. Ready SHALL require committed completed and
verified publication of every terminal ref registered by that commit. The result
artifact list SHALL be the preparer's persisted prepared tail (state refs carry
sequence and are excluded), in its original order without sequence. No-preparer
recovery and missing-admission cancel SHALL register no terminal refs; their required
set is empty, they are ready at settlement, result.artifacts=[], and initial refs
remain accessible as history rather than being relabeled terminal files.

Timeout SHALL default to 30000 ms and accept integers 0–86400000 inclusive; zero SHALL
perform one observation. Ready at the final deadline read SHALL win. Otherwise stdout
SHALL be one `{apiVersion,job,wait:{state:"timeout",timeoutMs,reason}}`, exit 9, no result.
The following precedence table SHALL be shared by wait and status observation:

| Job | Admission / executor state | Terminal publication | Wait reason |
| --- | --- | --- | --- |
| queued | missing initial admission (highest priority) | N/A | admission_incomplete |
| queued | available | N/A | run_pending |
| queued | unavailable | N/A | executor_unavailable |
| queued | unknown | N/A | executor_unknown |
| running | any | N/A | run_pending |
| terminal | any | all registered terminal refs verified, including empty set | ready: terminal envelope/outcome exit |
| terminal | any | missing/mismatching registered terminal refs | terminal_artifacts_pending |

A pending response SHALL preserve terminal job status. The wait/status observation
itself SHALL NOT settle, cancel, retry, expire or change a Run; the pre-existing CLI
recovery prologue SHALL remain unchanged and MAY settle confirmed-stopped workers
before observation. Events-follow completion SHALL NOT serve as a publication barrier.

New errors SHALL use these exact stream/exit/code rules. Stdout error envelopes SHALL
be one `{apiVersion,error:{code,message}}` JSON line with a sanitized message and no
raw input/key. Stderr errors SHALL be one sanitized plain-text diagnostic line followed
by a newline, never a v1 JSON error envelope; the table's stderr labels identify the
condition, not an emitted error.code. Unknown/non-API IDs SHALL use `Unknown job: <id>`.
Invalid timeout SHALL use the plain-text
argument diagnostic `Invalid timeout: expected an integer from 0 to 86400000 milliseconds.`;
pre-snapshot observation failure SHALL use `Failed to observe job: <id>`, with no raw
exception/input. Key validation SHALL check existing secret patterns before charset/
length validation, so a key failing both SHALL yield secret_in_request without echo.

| Condition | Stream | Exit | error.code / wait reason |
| --- | --- | --- | --- |
| wait unknown or non-API ID | plain-text stderr `Unknown job: <id>`, empty stdout | 3 | job_not_found (same for both) |
| invalid timeout | plain-text argument diagnostic on stderr, empty stdout | 2 | invalid_timeout |
| retry --request consumer mismatch | stdout, no job id | 2 | consumer_mismatch |
| malformed key after secret check | stdout | 2 | invalid_idempotency_key |
| secret-like key (existing assertNoSecretText/SECRET_VALUE_PATTERNS) | stdout | 2 | secret_in_request |
| keyed create (Q1 disclosed #2 tightening) | stdout v1 error envelope, matching existing create project/provider error envelopes | 2 | idempotency_key_not_supported |
| different normalized request at same scoped key | stdout | 2 | idempotency_conflict |
| missing committed creation/admission | stdout | 8 | submission_pending, additionally error.retryable=true |
| wait read fault after a valid job snapshot | stdout `{apiVersion,job,wait:{state:"error",reason:"observation_failed"}}`, no result | 8 | wait reason observation_failed |
| wait read fault before any job snapshot | plain-text stderr `Failed to observe job: <id>`, empty stdout | 8 | observation_failed |

These are non-outcome errors, not Run statuses. Existing command errors not listed
here SHALL retain their baseline shapes/streams/exits.

#### Scenario: S05 Wait observes both commit and publication
- **GIVEN** `tests/fixtures/local-job-api-async/submit-wait/publication.json#S05`, with artifact-bearing job fixtures with terminal commit and last-rename latches,
  prepared-tail golden refs and a variant whose publisher throws on the final rename
- **WHEN** `runs wait <id> --timeout 1000 --json` observes each stage
- **THEN** staging before commit and completed before full publication are non-ready;
  releasing renames before deadline returns exactly the golden create envelope/outcome exit
- **AND** result.artifacts is the prepared tail without sequence, not the initial state
  refs or the runs-result default subset; artifact-free completion is ready at commit
- **AND** throwing publish leaves wait non-ready/terminal_artifacts_pending/exit 9;
  locally completed create returns the baseline artifacts:[] and outcome exit,
  whereas a daemon-first wrapper returns identified error/8 after 30000 ms

#### Scenario: S06 Wait has explicit bounded timeout semantics
- **GIVEN** `tests/fixtures/local-job-api-async/submit-wait/wait-observation.json#S06`, with fake-clock cases queued+available, queued+no-lock, queued+legacy-lock,
  queued+missing-admission, running+dead-lock without recovery eligibility, and
  terminal+missing-file; expected reasons respectively run_pending, executor_unavailable,
  executor_unknown, admission_incomplete, run_pending and terminal_artifacts_pending
- **WHEN** each calls wait with omitted timeout, 0 and 25
- **THEN** one timeout envelope appears at 30000 ms, one observation and 25 ms respectively,
  exit 9, no result, exact fixture reason and unmodified status
- **AND** -1, 0.5, NaN, Infinity and 86400001 yield exactly the plain-text invalid-timeout
  diagnostic above plus newline on stderr, exit 2 and empty stdout;
  86400000 is accepted; ready exactly at deadline yields outcome, not timeout
- **AND** the admitted running fixture with an injected second-read SQLITE_BUSY returns
  stdout wait.state=error/reason=observation_failed with job ID, exit 8, no result;
  the worker continues once and no observer creates a completed or another attempt
- **AND** a fault before the first valid snapshot emits only `Failed to observe job: <id>`
  plus newline on stderr, empty stdout and exit 8, without a JSON error envelope

#### Scenario: S07 Multiple waiters and late facts cannot change the result
- **GIVEN** `tests/fixtures/local-job-api-async/submit-wait/publication.json#S07`, with two wait processes on one API job, with commit occurring between their
  initial read and wakeup registration, then published files and a late diagnostic
- **WHEN** both waiters re-read committed facts and a third waiter opens after completion
- **THEN** all return the same terminal envelope/outcome without missing the commit,
  altering terminal file digests, appending events or starting another attempt
- **AND** a later explicit events read can include the diagnostic without changing wait's result

### Requirement: Consumer Scoped Idempotent Submission

Only submit and retry --request SHALL accept optional idempotencyKey, 1–160 ASCII
`[A-Za-z0-9._:-]`, case-sensitive without trimming. The namespace SHALL be validated
normalized consumer.id plus key; an ID changed by redactSecretText SHALL be rejected
before insert, and stored apiConsumerId/retry match SHALL use that same normalized ID.
Same normalized intent SHALL replay the retained Run with idempotentReplay=true;
different intent SHALL return stdout idempotency_conflict/2. The error table above
SHALL govern all new failures. Secret-like keys SHALL reuse assertNoSecretText's
SECRET_VALUE_PATTERNS before charset/length checks; a key failing both SHALL yield
secret_in_request. Neither failure SHALL echo the key; no second detector SHALL be invented.

Fingerprint SHALL normalize current defaults/runtime aliases, canonical cwd/project/
artifact-base identity, sorted object keys/capability sets and ordered other arrays;
it SHALL include external ID, kind, profile/grant, provider selection intent and
prompt/input or completion messages/schema/tuning. It SHALL exclude key, execution
controls, generated ID/time and credentials. Internal create/submit share submit
intent; only submit exposes its key. Retry includes source ID and stored input under
a distinct intent. Omitted and explicit provider choices SHALL remain distinct;
opaque consumer data SHALL not acquire domain semantics.

Reservation SHALL store consumer, domain-separated key hash, request hash/version,
job FK and retention metadata. Job and reservation SHALL be inserted in one SQLite
transaction with unique(consumer,keyHash). Only the winner SHALL mkdir the run-dir,
after creation commit; rollback/loser/creation compensation SHALL leave no stray dir.
Queued/no-facts creation compensation SHALL delete both via FK cascade. Missing
creation or required nonterminal initial admission SHALL return submission_pending/8,
error.retryable=true, never replay success or execute. Retryable SHALL mean same-key
retry is safe, not that an orphan will eventually recover. Orphans SHALL persist until
TICKET-128 repair; a new key is an explicit remedy with duplicate risk if the creator
was still live, not automatic recovery. Missing-admission jobs with a known ID SHALL
allow cancel to settle without terminal refs and then age out normally.

Retention SHALL be at least 30 days after verified terminal publication. The lifecycle
host SHALL set expiresAt once after successful preparer publish plus verification;
artifact-free/recovery/missing-admission cancel/preparation-failure-without-refs SHALL
set it at terminal settle. Publication failure or a crash before the setter SHALL
leave it NULL, conservatively retained. Readers and replay SHALL not set or extend it.
Job-store cleanupExpiredAgentJobIdempotency(db,{now,consumerId?}) SHALL delete only
expired terminal reservations: same-consumer cleanup before submit lookup, all-consumer
cleanup each daemon loop tick. Nonterminal/unpublished/orphan reservations SHALL not
automatically expire. Jobs/events/files SHALL remain; there is no public job-deletion
cleanup path. Raw key SHALL never be stored/emitted in requests/artifacts/events/results/
logs; hashes SHALL not be represented as encryption or consumer authentication.

#### Scenario: S08 Normalized replay stays on supported key surfaces
- **GIVEN** `tests/fixtures/local-job-api-async/idempotency/idempotency.json#S08`, with a published keyed submit with consumer fixture-a, runtime claude alias and
  omitted defaults, and matching terminal retry-source/child fixtures
- **WHEN** submit repeats using claude-code, equivalent explicit defaults and reordered
  keys; retry repeats the same --request once asynchronously and once synchronously
- **THEN** each replays its own retained attempt with idempotentReplay=true, synchronous
  retry returns that child's terminal, and jobs/events/provider calls do not grow
- **AND** later provider config changes do not rerun the attempt; keyed create returns
  stdout idempotency_key_not_supported/2 and no work, while old-shaped unkeyed create
  remains a fresh submit intent and produces the baseline bytes

#### Scenario: S09 Changed request conflicts without exposing the key
- **GIVEN** `tests/fixtures/local-job-api-async/idempotency/idempotency.json#S09`, with a committed key binding for a request and variants changing prompt, mode,
  provider intent, artifact base, completion messages/schema or consumer external ID
- **WHEN** each variant is submitted under the same consumer/key
- **THEN** it exits 2 with error.code=idempotency_conflict in a v1 error envelope,
  adds no job or event and starts no provider work
- **AND** neither stdout nor stderr contains the key or stored request content

#### Scenario: S10 Same key cannot replay across consumers
- **GIVEN** `tests/fixtures/local-job-api-async/idempotency/idempotency.json#S10`, with two valid requests identical except consumer.id=fixture-a and fixture-b,
  both with key req-1, and an executor paused before claim
- **WHEN** both invoke submit
- **THEN** distinct job IDs and reservations exist, neither response is a replay and
  each job has exactly one committed creation fact
- **AND** repeating fixture-b returns only fixture-b's ID, never fixture-a's

#### Scenario: S11 Concurrent requests reserve one attempt
- **GIVEN** `tests/fixtures/local-job-api-async/idempotency/idempotency.json#S11`, with two SQLite connections/processes with the same consumer/key/artifact request
  and a third different-input contender, with transaction and admission latches
- **WHEN** submit interleaves before insert, after reservation, after creation commit
  and after initial admission, then the single eligible executor is released
- **THEN** exactly one job/reservation and one winner run-dir exist; loser IDs leave no
  directories, and a fresh connection sees no reservation to an uncommitted job
- **AND** matching contenders return pending/8+retryable before admission, replay after it,
  the changed request conflicts/2, and provider/claim count is zero while paused and
  exactly one after executor release

#### Scenario: S12 Rollback and creation compensation release the key
- **GIVEN** `tests/fixtures/local-job-api-async/idempotency/idempotency.json#S12`, with faults before job/reservation SQL commit and on creation append after their
  commit, with queued/no-facts compensation permitted and artifact paths enabled
- **WHEN** submit fails and an independent connection plus directory listing inspect state
- **THEN** jobs/reservations/events contain zero failed-submission rows, no ack was
  emitted and no loser/rolled-back run-dir exists
- **AND** removing the fault and retrying the same key yields exactly one job, one
  creation fact and one admitted directory, without idempotentReplay

#### Scenario: S13 Crashed creation never becomes a successful replay
- **GIVEN** `tests/fixtures/local-job-api-async/idempotency/idempotency.json#S13`, with a killed creator after job/reservation commit before creation, a failed
  compensation case and a still-live creator paused at that same boundary
- **WHEN** submit repeats each key, daemon list/start runs and cleanup advances past 30 days
- **THEN** each returns stdout error.code=submission_pending,error.retryable=true/exit 8,
  empty success ack; zero provider calls/claims occur and no reservation is deleted
- **AND** same-key retry after releasing the live creator replays its single admitted ID;
  an explicit new-key submission for the killed fixture can succeed with a new ID while
  its original orphan remains, demonstrating the documented remedy without TTL repair

#### Scenario: S14 Retention has a declared endpoint
- **GIVEN** `tests/fixtures/local-job-api-async/idempotency/idempotency.json#S14`, with a fake clock and worker-published, artifact-free, recovery, admitted-cancel,
  missing-admission-cancel terminals, plus running/unpublished/orphan reservations;
  successful cases have expiresAt=verified-publish-or-empty-settle-time+2592000000
- **WHEN** same-key replay reads just before expiry, same-consumer submit triggers cleanup
  at expiry, and a daemon tick triggers cleanup for a different consumer after expiry
- **THEN** replay never extends expiresAt; expired eligible reservations alone disappear,
  next same-key submission creates a new job without replay and all history/files remain
- **AND** NULL-expiry cases stay bound; fault after publish before expiry setter keeps NULL;
  wait/status reads never repair TTL; no nonexistent job-deletion command is assumed

#### Scenario: S15 Idempotency key stays out of durable and diagnostic output
- **GIVEN** `tests/fixtures/local-job-api-async/idempotency/idempotency.json#S15`, with a unique non-secret key, admitted artifact request and key variants empty,
  whitespace, 161 characters, sk- followed by 24 ASCII letters, and Bearer abcdef
  (the last is both secret-like and charset-invalid)
- **WHEN** submit/replay/conflict run and DB, request.json/events.jsonl/result.json,
  manifests, stdout and stderr are inspected
- **THEN** raw sentinel never appears; only domain-separated key hash is stored
- **AND** non-secret malformed keys emit stdout invalid_idempotency_key/2; both secret-like
  variants, including Bearer abcdef, emit stdout secret_in_request/2, without echo/spawn/
  runnable row; a consumer ID that redactSecretText would alter is rejected before
  reservation, not silently redacted

### Requirement: Executor Availability Observation

API status SHALL include execution for queued/running jobs and omit it for terminal
jobs. For missing initial admission it SHALL be unknown/admission_incomplete with
observedAt and no hint. Otherwise state/reason SHALL be available/executor_observed,
unavailable/no_executor or unknown/probe_unavailable. Only unavailable SHALL carry
hint="locus daemon run". This SHALL be advisory, distinct from CLI runtime readiness.
API-capable daemons SHALL require lockPath and write lock v2
{pid,nonce,startedAt,lockFormat:2,apiCapable:true,heartbeatAt} every loop iteration,
at most 1000 ms apart even during execution; writers SHALL check their nonce before
atomic update/release. Fresh SHALL mean heartbeat age 0–5000 ms inclusive.
Alive+fresh+v2+apiCapable+stable nonce SHALL mean available; no lock/ESRCH unavailable;
stale/legacy/EPERM/no lockPath/bad format/future heartbeat/swapped nonce unknown.
Swapped nonce SHALL mean different nonce between reader snapshots or different from
the writer's last value; the old writer SHALL not overwrite/unlink its successor.
Running scoped work SHALL use its committed worker identity/heartbeat/liveness without
requiring a daemon lock: confirmed alive within the existing 120 s recovery heartbeat
window means available; ESRCH means unavailable; stale/EPERM/uncertain means unknown.
A different daemon lock SHALL not substitute for that Run's worker evidence. The decision table above SHALL determine wait reason.
No new PID exposure beyond existing job.workerPid SHALL be added: execution SHALL omit
PID, nonce, hostname, lock paths and secrets. Observation itself SHALL not launch a
daemon, acquire its lock or change status; the existing recovery prologue is unchanged.

#### Scenario: S16 Submission without an executor is observable
- **GIVEN** `tests/fixtures/local-job-api-async/submit-wait/wait-observation.json#S16`, with a valid artifact-free request and an isolated profile with no executor lock
- **WHEN** submit succeeds, status reads its ID and wait reaches its deadline
- **THEN** creation is committed, status reports execution.state=unavailable,
  reason=no_executor and hint="locus daemon run", and wait reports executor_unavailable/exit 9
- **AND** the job remains queued with no job_started, completed or provider call;
  the existing desktop/store overview reads that same queued API job and consumer

#### Scenario: S17 Lock observations do not invent liveness
- **GIVEN** `tests/fixtures/local-job-api-async/submit-wait/wait-observation.json#S17`, with same-profile fixtures for alive v2/apiCapable/fresh lock, absent lock, ESRCH,
  alive stale, legacy, EPERM, missing lockPath, future heartbeat and nonce A→B between reads
- **WHEN** runs status reads a queued admitted job through filesystem/liveness/clock seams
- **THEN** states are available, unavailable, unavailable, unknown, unknown, unknown,
  unknown, unknown, unknown with reasons/hints exactly as the availability requirement
- **AND** a writer last holding A cannot refresh or unlink B; a normal tick updates
  heartbeatAt without changing nonce; status reads themselves write no lock
- **AND** execution has no PID/nonce/hostname/path/secret sentinel; existing job.workerPid
  stays intact, terminal status omits execution and runtime credential readiness is unchanged

### Requirement: Async Control Preserves Run Identity

Queued cancel SHALL use the existing pre-start ledger canceled settlement and prevent
execution if it wins claim. Running cancel SHALL remain a request until the worker
confirms settlement. Retry SHALL create a new attempt only from failed, canceled or
interrupted API jobs, use the same submission owner, and support the optional key.
New retry request consumer.id SHALL match the stored source consumer; no new request
body SHALL be required for existing retry/cancel calls.

#### Scenario: S18 Queued cancel wins claim without a second terminal
- **GIVEN** `tests/fixtures/local-job-api-async/submit-wait/controls.json#S18`, with artifact/no-artifact admitted jobs with paused claim, two cancel processes,
  and a slow-cancel preparation racing a claimed runner that fails immediately
- **WHEN** runs cancel races claim in both orders, cancel races cancel, and slow cancel
  resumes after the failing claimant commits; capture each preparation attempt's files
- **THEN** cancel-first yields exactly one canceled completed, zero spawn and ready wait/5;
  start-first records cancel intent until worker confirmation, then exactly one completed
- **AND** cancel/cancel and slow-cancel/failing-claim each commit exactly one terminal;
  staging names differ by process+attempt, loser discard touches only its files, winner
  files verify and wait returns that winner's outcome with no terminal overwrite
- **AND** repeated cancel/Workbench reads create no extra completed or provider call

#### Scenario: S19 Retry key replays the child and preserves the parent
- **GIVEN** `tests/fixtures/local-job-api-async/idempotency/controls.json#S19`, with a terminal failed API job with consumer fixture-a and a retry request
  `{apiVersion:"locus.local-job.v1",consumer:{id:"fixture-a"},idempotencyKey:"retry-1"}`
- **WHEN** two `runs retry <id> --request - --async --json` calls and one synchronous
  retry with that request execute concurrently through an available executor
- **THEN** all refer to one new child ID with original retryOfJobId and attempt+1,
  replay responses are marked, and the synchronous call waits for that child's result
- **AND** changing the source ID with the same scoped key conflicts; changing consumer
  to fixture-b emits stdout consumer_mismatch/exit 2 before key lookup, without a job id;
  same-key different source emits stdout idempotency_conflict/2; parent events/results/artifacts stay byte-identical

#### Scenario: S20 API reads and control stay source-scoped
- **GIVEN** `tests/fixtures/local-job-api-async/submit-wait/controls.json#S20`, with desktop/cli/protocol/missing IDs plus succeeded/queued API jobs and frozen
  baseline cancel/events/retry error stream/exit fixtures
- **WHEN** wait/retry and existing cancel/events operations receive those IDs
- **THEN** wait for missing or non-API IDs emits exactly `Unknown job: <id>` plus newline
  on stderr, stdout empty, exits 3 and reveals no job; no result or provider credentials are required
- **AND** cancel/events/retry retain their recorded baseline error stream/exits for
  unsupported sources/states, retry rejects succeeded/queued, and zero new jobs/spawns occur

### Requirement: Async Features Preserve Existing V1 Contracts

Existing v1 event types, six-field envelopes, dense sequences, after/follow,
result/artifact names/roles/digests/retention and 0–8 outcome exit meanings SHALL remain
unchanged. Optional response fields SHALL remain safely ignorable; a new enum value
SHALL NOT be treated as an unknown optional field. Agent/completion execution SHALL
share submission, claim and terminal ownership. Discovery is modified below under
its existing Requirement, not defined by a competing ADDED requirement.

#### Scenario: S21 V1 event and artifact regression is unchanged
- **GIVEN** `tests/fixtures/local-job-api-async/submit-wait/public-v1.json#S21`, with baseline public-v1/public-results fixtures containing all 12 event types,
  committed initial artifact refs before job_started, a completed and late diagnostics
- **WHEN** runs events with --after 2, --follow --jsonl, runs result and a terminal wait
  consume the fixtures produced by the queued executor
- **THEN** existing event envelopes retain exactly apiVersion/jobId/sequence/type/createdAt/payload,
  dense original sequences, bare redacted payload and existing optional extensions
- **AND** after is strictly greater-than; follow exits at terminal without waiting for
  late diagnostics or publication; wait alone requires publication; explicit later reads see late facts
- **AND** artifact names, roles, SHA-256, result fields and retention equal baseline
  fixtures, with no native raw event union, new event enum or vendor-specific consumer branch

#### Scenario: S24 Completion uses the same queued admission
- **GIVEN** `tests/fixtures/local-job-api-async/submit-wait/public-submission.json#S24`, with a reference-only usable completion provider, opaque json_schema response
  format, deterministic upstream fetch fixture and no agent-only fields
- **WHEN** submit acknowledges the completion, an existing daemon executes it and wait returns
- **THEN** exactly one upstream call occurs after claim, its structured output and
  usage use the existing result/event contract, and no runtime child or run-dir exists
- **AND** completion create through the same fixtures matches its baseline terminal
  stdout/exit; explicit profile failure never falls back to native credentials

## MODIFIED Requirements

### Requirement: Discovery Feature Advertisement
The runtime discovery envelope SHALL include a top-level features array of stable
string identifiers for additive contract capabilities, keeping exact
apiVersion=locus.local-job.v1. canonical-run-ledger SHALL identify the dense committed
ledger projection, corrected terminal truth and optional metadata. The optional
runtime.codex.v1 namespace SHALL declare schemaVersion=1 and maturity=experimental;
this SHALL not claim native protocol stability or live-attach support.
The features array and closed discoveryFeature schema enum SHALL additionally include
async-submit once storage/claim activation is complete. The existing preflight rule
SHALL apply; pinned schema consumers SHALL refresh as predeclared in the guide.
Pinned-old-schema failure evidence SHALL be retained for the direct enum extension.

#### Scenario: Consumer detects readiness support
<!-- Scenario register: S52 (retained living scenario; title unchanged for MODIFIED archive) -->
- **GIVEN** `tests/fixtures/local-job-api-async/idempotency/discovery.json#S52`, with current discovery JSON with runtime-readiness and explicit ready/needs-auth runtime entries
- **WHEN** the discovery reader is exercised with `discovery.json` containing current
  readiness-enabled runtime fixtures
- **THEN** features contains runtime-readiness and the per-runtime readiness objects
  are present as in the existing contract

#### Scenario: Older build lacks the feature
<!-- Scenario register: S53 (retained living scenario; title unchanged for MODIFIED archive) -->
- **GIVEN** `tests/fixtures/local-job-api-async/idempotency/discovery.json#S53`, with the executable neutral preflight helper, no-feature discovery JSON and a recording dispatch port
- **WHEN** a consumer reads the discovery envelope from a build without a given feature identifier
- **THEN** the consumer treats the corresponding contract addition as unsupported instead of assuming silently-dropped request fields were honored
- **AND** as a documentation example, the preflight helper returns unsupported and its
  dispatch spy stays zero; this helper assertion is not evidence about the Locus parser

#### Scenario: Consumer detects canonical ledger support
<!-- Scenario register: S54 (retained living scenario; title unchanged for MODIFIED archive) -->
- **GIVEN** `tests/fixtures/local-job-api-async/idempotency/discovery.json#S54`, with canonical-run-ledger discovery JSON and runtime.codex.v1 extension metadata fixture
- **WHEN** the implemented discovery reader is exercised with the ledger-enabled
  discovery.json fixture
- **THEN** features contains canonical-run-ledger alongside existing features, and the
  documented optional extension has namespace runtime.codex.v1, schemaVersion=1 and
  experimental maturity matching its emitted metadata

#### Scenario: S22 Discovery advertises the extension with explicit schema evolution
- **GIVEN** `tests/fixtures/local-job-api-async/submit-wait/discovery.json#S22`, with a new executable with migrated isolated profile and async activation enabled,
  pinned schema from product source 2c59664f, updated schema, and a separately pinned old discovery output
- **WHEN** runtimes list --json is validated with each schema and baseline output is read
- **THEN** new output retains v1/existing features, adds async-submit, passes new schema
  and fails old discoveryFeature enum specifically at async-submit
- **AND** baseline old output contains no async-submit; a failed migration fixture exits
  before discovery activation and never advertises the feature; optional response-field
  ignoring remains valid without claiming closed-enum compatibility
- **AND** the activation/rollback fixture stops old writers and gives the old executable
  a separate profile path; deliberately pointing it at a new marker proves it does not
  understand that marker, so same-profile mixed execution is rejected by rollout
  policy rather than falsely certified as a technical old-build fence

#### Scenario: S23 Unsupported version and absent feature fail closed
- **GIVEN** `tests/fixtures/local-job-api-async/submit-wait/discovery.json#S23`, with the executable neutral consumer-preflight fixture with a dispatch spy,
  no-feature discovery JSON and requests using locus.local-job.v1.1 or unknown version;
  the baseline 2c59664f CLI parser is vendored as cli-args-before.ts using
  `git show 2c59664f:src/main/lib/headless/cli-args.ts` and directly invoked by the test
  harness for old-build shape tests, independently of the documentation helper
- **WHEN** the neutral helper reads discovery, the current CLI parses wrong-version
  submit requests, and the old parser receives submit or retry --request
- **THEN** the documentation-example helper returns unsupported and dispatch count zero;
  independently tested Locus version failures use
  existing stderr "apiVersion must be locus.local-job.v1"/2 with no job; old shapes
  are rejected stderr/2 (unknown command / unexpected argument), never unkeyed execution
- **AND** the fixture includes old keyed-create silent-drop counterevidence to document
  why the recommended key surface excludes create; no consumer silently downgrades
