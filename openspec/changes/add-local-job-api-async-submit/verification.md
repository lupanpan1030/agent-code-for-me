# Verification

Status: **IMPLEMENTATION CANDIDATE — frozen 2026-10-02 (Phase III); awaiting same-SHA Codex IMPLEMENTATION_VERIFIED + Claude REVIEW_APPROVED**

## Candidate

- Change: `add-local-job-api-async-submit` (Phase 3, second proposal).
- Candidate source SHA: the commit that adds this section, subject
  `docs(openspec): freeze the async submit implementation candidate`. A commit
  cannot name its own SHA; the exact value is recorded in the Phase III handoff
  report (`impl-async-submit-phase3.report.md`) and resolves with
  `git log -1 --format=%H --grep='freeze the async submit implementation candidate'`.
- Worktree / branch: `/home/chen/projects/locus-add-local-job-api-async-submit-draft`,
  `codex/add-local-job-api-async-submit-draft`. Remote push, PR, merge, release
  and rules changes: not authorized, not performed.
- Product baseline: `2c59664f1b80a5f782eb05f82d33f718d9bc7053` (main after the
  canonical run event ledger archive `87eb6b01`). Owner APPROVED decisions
  bound to `0f998436`, recorded at `0447d02d`. Independent red suite
  `20e7bfcf` with ratified seams `8974c9ed`.
- Product code is final at `e0a9a967` (T1). Phase III commits are
  documentation only: `git diff --stat e0a9a967 <candidate> -- src tests scripts drizzle`
  is empty.
- Immutable red set (4 red tests, 4 kits, `tests/fixtures/local-job-api-async`,
  `red-receipt.md`): zero diff against the re-pinned baseline `770c78ad`.
- Data lifecycle stage: PRE-PRODUCTION / DISPOSABLE TEST DATA
  (`docs/ideas/locus-ai-collaboration-workflow.zh-CN.md:496`); additive
  migration `0025_agent_job_idempotency`. Active overlap: none (this is the only
  active change in `openspec/STATUS.md`). TICKET-127 and TICKET-128 remain Open.

### Commit history of the implementation

| Phase | Commits | Independent review |
| --- | --- | --- |
| Red suite | `20e7bfcf` (suite), `8974c9ed` (fixture relink, seam ratification) | red-receipt RED_SUITE_ACCEPTED after F1 fix |
| Phase I | `89b68393`, `0bbaa549`, `72e0f55e`, `4f0541bc`, `0ae41f47` | `async-submit-phase1-review-*-0ae41f47.md`: design CHANGES_REQUESTED (2 P2, 6 P3); tests/security REVIEW_APPROVED for Phase I scope (1 P2 merge gate, 4 P3) |
| Red adjudication | `d59b1142` (S03, S17, S21, S15 suite defects), `770c78ad` (formatter-only re-pin) | coordinator adjudication in `red-receipt.md` |
| Phase II | `2385df4e`, `765b8ea6`, `ad16cb0c`, `a44e87fd`, `ac1e2f74`, `84c622ce` | `async-submit-phase2-review-*-84c622ce.md`: design CHANGES_REQUESTED (1 P2, 3 P3); tests/security CHANGES_REQUESTED (1 P2 lint on immutable files, 4 P3) |
| T1 touch-up | `74e30df9`, `27cbcdad`, `5615e1f2`, `dcad0c0e`, `ad6225cb`, `22d4336b`, `0537da25`, `2dc0b5e6`, `e0a9a967` | `async-submit-t1-review-e0a9a967….md`: REVIEW_APPROVED (0 P0/P1/P2, 3 P3) |
| Phase III | `d37fa4e5` (guides), `d813b060` (schema), `4748aa73` (owner rows), `53bbc270` (proposal P3-1), `bbcc0995` (tasks), freeze commit (this record, STATUS) | pending: same-SHA dual verdicts |

Every P2 above is closed at `e0a9a967`: Phase I design P2-1 (retry error
baseline, `ac1e2f74`) and P2-2 (R4 relay race, `84c622ce`); Phase I security
P2-1 (claim-time gate before merge, `765b8ea6`); Phase II design P2-1 (admitted
queued cancel preparer, `5615e1f2`); Phase II security P2-1 (PR-base lint on
immutable files, `770c78ad`). The T1 review verified these closures with probes.

## Gates

Run on the candidate tree. `check:full` ran on the tree of `bbcc0995` (the
candidate's parent, whose only later change is this record, `STATUS.md`, task
8.2 and four status lines); strict validation, `git diff --check`, the PR-base
lint and the four red files were re-run on the candidate itself (handoff report).

| Gate | Command | Result |
| --- | --- | --- |
| Four red files | `bun test --isolate tests/local-job-api-async-submit-wait.test.ts tests/local-job-api-async-idempotency.test.ts tests/local-job-api-async-executor.test.ts tests/local-job-api-async-guards-protocol.test.ts` | 79 pass / 0 fail, 360 `expect()` calls, 4 files (also 79/79 at `e0a9a967` before Phase III) |
| Full suite | `bun run test` (inside `check:full`) | 2864 pass / 0 fail, 14472 `expect()` calls, 357 files |
| Aggregate | `bun run check:full` (lint:changed, architecture guard, retired-runtime, tsc, tests, `spec:validate`, build, diff:check) | exit 0 (4 min 7 s): no changed files for lint:changed; both guard self-tests 17/17; retired-runtime check passed (1812 files, 10 allowlisted); `tsc --noEmit` clean; 2864/2864 tests; strict 54/54; `electron-vite build` succeeded; diff:check clean |
| Architecture guard | `bun run architecture:check` | Both `17/17 fixture cases matched; repository ownership enforced.` lines (run event ledger, local job API async submission); `Architecture guard passed.` |
| PR-base lint | `BIOME_CHANGED_SINCE=2c59664f node scripts/run-biome-changed.mjs` | exit 0 |
| Lint ratchet | `git diff 2c59664f <candidate> -- lint-baseline.json` | only deletions: `daemon.ts: 2`, `job-store.ts: 1`, `trpc/routers/agent-jobs.ts: 1` |
| Architecture baselines | `scripts/architecture-baselines.json` | 0-line diff vs `2c59664f`; `reachThroughWrappers` sha256 prefix `3ae7f081d3b64e48` at `2c59664f`, `e0a9a967` and the candidate |
| Strict OpenSpec | `openspec validate --all --strict --no-interactive` | 54 passed, 0 failed |
| Whitespace | `git diff --check` and `node scripts/check-patch-whitespace.mjs` | exit 0 |
| Immutable set | `git diff --stat 770c78ad <candidate> -- <4 red tests, 4 kits, tests/fixtures/local-job-api-async, red-receipt.md>` | empty |
| Docs-only Phase III | `git diff --stat e0a9a967 <candidate> -- src tests scripts drizzle` | empty |
| Schema conformance | `bun test --isolate tests/local-job-api-async-schema-envelopes.test.ts` (committed in T2; replaces the Phase III throwaway probe) | Ajv 2020 against the published schema: emitted fresh/keyed-replay submit (agent and completion), status with `execution`, wait timeout, wait `observation_failed`, wait-ready and create (`createResponseEnvelope`), keyed `retry --async` and its replay, and the stdout errors `idempotency_key_not_supported`, `invalid_idempotency_key`, `idempotency_conflict`, `consumer_mismatch` all valid; keyed agent/completion bodies valid for `submitRequest` and rejected by `createRequest`; unknown members rejected by `completionSubmitRequest`/`completionCreateRequest`/`retryRequest`. `submission_pending` and `secret_in_request` are not emitted by this file (covered by the idempotency red file). `completionSubmitRequest` now derives from `completionRequestMembers` (`allOf` + `unevaluatedProperties: false`), shared with `completionCreateRequest`, so the two member sets cannot drift; validation of `completionCreateRequest` is unchanged. |

## Scenario register (S01–S54)

Each row lists the tests that carry the scenario at the candidate and their
result in the four-file run above (79 tests) or in the registered-existing run
(`bun test --isolate` over the living test files named in the row; 124 tests
in 12 files, 0 fail). Registered-existing rows S52/S53/S54 use the archived
ledger change's titles S53/S54/S55 (red-receipt F7). Fixture paths are the
per-domain subdirectories of `tests/fixtures/local-job-api-async/`
(red-receipt F2). S42/S46/S48/S51 are modified-inherited and S53 carries the
documentation-example clause, as before.

| ID | Delta | Scenario | Tests at the candidate (file — title after the Sxx name) | Result |
| --- | --- | --- | --- | --- |
| S01 | [local-job-api](specs/local-job-api/spec.md) | Submit returns before execution is released | `submit-wait` — submit acks one queued admission with a committed job_created before any dispatch, and a later claim is visible only through status (pass) | pass |
| S02 | [local-job-api](specs/local-job-api/spec.md) | Existing admission gates run before provider work | `submit-wait` — every create-time rejection is reproduced by submit with zero provider calls and no queued ack; a no-profile request keeps the batch selector path (pass) | pass |
| S03 | [local-job-api](specs/local-job-api/spec.md) | Old create matches submit plus wait byte for byte | `submit-wait` — old-shaped create and submit + executor + wait both reproduce the 2c59664f golden stdout/exit for every outcome and kind (pass)<br>`submit-wait` — real processes: workerId/workerPid identify the wrapper or daemon process that actually won the claim (pass) | pass |
| S04 | [local-job-api](specs/local-job-api/spec.md) | Default retry retains synchronous response and lineage | `submit-wait` — sync retry and retry --async + executor + wait both equal the 2c59664f retry golden, each with one new child attempt and an untouched source (pass) | pass |
| S05 | [local-job-api](specs/local-job-api/spec.md) | Wait observes both commit and publication | `submit-wait` — pre-commit and published-incomplete stages are non-ready, release before the deadline returns the golden create envelope, the result lists the prepared tail, and a throwing final rename stays pending (pass)<br>`submit-wait` — a daemon-first wrapper whose claimant's final rename throws returns the identified terminal_artifacts_pending error/8 after 30000 ms instead of an outcome (pass) | pass |
| S06 | [local-job-api](specs/local-job-api/spec.md) | Wait has explicit bounded timeout semantics | `submit-wait` — omitted, 0 and 25 ms timeouts emit one timeout envelope with the decision-table reason, exit 9, no result and an unmodified Run (pass)<br>`submit-wait` — -1, 0.5, NaN, Infinity and 86400001 are rejected with the plain-text diagnostic/2, 86400000 is accepted and ready at the deadline read yields the outcome (pass)<br>`submit-wait` — a SQLITE_BUSY after the first valid snapshot returns the identified observation_failed/8 without touching the Run, and a fault before any snapshot emits only the plain-text diagnostic/8 (pass) | pass |
| S07 | [local-job-api](specs/local-job-api/spec.md) | Multiple waiters and late facts cannot change the result | `submit-wait` — two waiters across the commit and a third after a late diagnostic return the same terminal envelope without appending events, changing digests or starting another attempt (pass) | pass |
| S08 | [local-job-api](specs/local-job-api/spec.md) | Normalized replay stays on supported key surfaces | `idempotency` — submit and retry --request replay their own retained attempt with idempotentReplay=true and no new jobs/events/runner calls, while keyed create is refused with stdout idempotency_key_not_supported/2 and unkeyed create stays fresh (pass) | pass |
| S09 | [local-job-api](specs/local-job-api/spec.md) | Changed request conflicts without exposing the key | `idempotency` — prompt/mode/provider/artifact-base/external-ID and completion messages/schema variants each exit 2 with stdout idempotency_conflict, add no job/event/runner call and echo neither the key nor stored request content (pass) | pass |
| S10 | [local-job-api](specs/local-job-api/spec.md) | Same key cannot replay across consumers | `idempotency` — fixture-a and fixture-b with key req-1 get distinct jobs and reservations with one creation fact each, and repeating fixture-b returns only fixture-b's ID (pass) | pass |
| S11 | [local-job-api](specs/local-job-api/spec.md) | Concurrent requests reserve one attempt | `idempotency` — three real processes race one consumer/key (two matching, one changed) leaving one job, one reservation and one run-dir, and a held creation latch yields pending/8 then replay with zero claims until the executor runs exactly once (pass) | pass |
| S12 | [local-job-api](specs/local-job-api/spec.md) | Rollback and creation compensation release the key | `idempotency` — reservation/job insert faults before commit and a job_created append fault after commit leave zero rows, no ack and no run-dir, and the same key then yields one fresh admitted job without idempotentReplay (pass) | pass |
| S13 | [local-job-api](specs/local-job-api/spec.md) | Crashed creation never becomes a successful replay | `idempotency` — killed, failed-compensation and paused-live creators stay submission_pending/8 retryable with zero claims and retained reservations past 30 days, the released live creator replays its one ID and a new key succeeds beside the orphan (pass) | pass |
| S14 | [local-job-api](specs/local-job-api/spec.md) | Retention has a declared endpoint | `idempotency` — worker-published, artifact-free, recovery, admitted-cancel, missing-admission-cancel and other-consumer terminals get expiresAt = verified-publish-or-settle time + 2592000000 and a same-key replay just before expiry is marked and never extends it (pass)<br>`idempotency` — at expiry a same-consumer submit and, for another consumer, a daemon tick delete only expired terminal reservations; the same key then creates a new job without replay and every job row, event and run-dir file remains (pass)<br>`idempotency` — running, publish-fault, crash-after-publish-before-setter and orphan reservations keep NULL expiry through wait/status reads and 31-day cleanup triggers, and their keys stay bound (replay or pending, never fresh) (pass) | pass |
| S15 | [local-job-api](specs/local-job-api/spec.md) | Idempotency key stays out of durable and diagnostic output | `idempotency` — the raw sentinel key never reaches the SQLite files, project/run-dir files, stdout or stderr; only a domain-separated hash is stored; malformed keys are invalid_idempotency_key/2, sk-/Bearer keys are secret_in_request/2 without echo, and a redactor-altered consumer.id is rejected before reservation (pass) | pass |
| S16 | [local-job-api](specs/local-job-api/spec.md) | Submission without an executor is observable | `submit-wait` — with no executor lock the submitted Run stays queued, status reports unavailable/no_executor with the daemon hint, wait times out with executor_unavailable/9 and the store overview lists the same job (pass) | pass |
| S17 | [local-job-api](specs/local-job-api/spec.md) | Lock observations do not invent liveness | `submit-wait` — status derives available/unavailable/unknown from same-profile lock evidence without writing the lock, exposing PID/nonce/path, or altering workerPid, terminal status or runtime readiness (pass)<br>`submit-wait` — an API-capable daemon writes lock v2, refreshes heartbeatAt at most 1000 ms apart without changing its nonce, and never refreshes or unlinks a successor's lock (pass) | pass |
| S18 | [local-job-api](specs/local-job-api/spec.md) | Queued cancel wins claim without a second terminal | `submit-wait` — cancel-first (artifact and artifact-free) settles one canceled completed, the executor never spawns, wait is ready with exit 5, and repeated cancel/Workbench reads add nothing (pass)<br>`submit-wait` — start-first records the cancel as a request until the worker confirms, and racing cancels commit exactly one terminal (pass) | pass |
| S19 | [local-job-api](specs/local-job-api/spec.md) | Retry key replays the child and preserves the parent | `idempotency` — two concurrent --async retries and one synchronous retry with key retry-1 share one child (retryOfJobId=source, attempt+1, one execution), replays are marked, another source conflicts, fixture-b is consumer_mismatch/2 without an id and the parent stays byte-identical (pass) | pass |
| S20 | [local-job-api](specs/local-job-api/spec.md) | API reads and control stay source-scoped | `submit-wait` — wait on missing or non-API IDs emits only `Unknown job: <id>`/3 while cancel/events/retry keep their 2c59664f baseline errors and retry rejects succeeded/queued API jobs (pass) | pass |
| S21 | [local-job-api](specs/local-job-api/spec.md) | V1 event and artifact regression is unchanged | `submit-wait` — Runs produced by the queued executor replay the 2c59664f events (--after, --follow), result and terminal envelope byte for byte across all 12 public event types, with late diagnostics visible only to later reads (pass) | pass |
| S22 | [local-job-api](specs/local-job-api/spec.md) | Discovery advertises the extension with explicit schema evolution | `submit-wait` — runtimes list keeps v1 and every existing feature, adds async-submit, passes the updated schema and fails the pinned 2c59664f schema exactly at the discoveryFeature enum (pass) | pass |
| S23 | [local-job-api](specs/local-job-api/spec.md) | Unsupported version and absent feature fail closed | `submit-wait` — the documentation preflight refuses without the feature, the current submit parser rejects wrong versions with the v1 stderr/2 and no job, and the vendored 2c59664f parser rejects submit/retry --request/wait shapes with exit 2 (pass) | pass |
| S24 | [local-job-api](specs/local-job-api/spec.md) | Completion uses the same queued admission | `submit-wait` — a submitted completion is acknowledged with zero upstream calls, an existing daemon makes exactly one call after claim, wait returns the baseline completion envelope with no child or run-dir, and an unusable explicit profile never falls back (pass) | pass |
| S25 | [local-job-api](specs/local-job-api/spec.md) | Internal wait timeout does not become a create result | `submit-wait` — an agent create whose runtime is held past the 30000 ms internal wait deadline emits only the baseline terminal envelope with exit 0 (pass)<br>`submit-wait` — a kind:completion create whose single upstream call takes 45000 ms without heartbeat or high-water change returns the baseline stdout/exit (pass) | pass |
| S26 | [agent-runtime-core](specs/agent-runtime-core/spec.md) | Queue listing and claim require the same committed facts | `executor` — list and start admit only the exact ledger-v1 creation fact plus required lifecycle:initial-artifacts admission (pass)<br>`executor` — the genuine initial batch admitted through the host is keyed lifecycle:initial-artifacts:<id>:0 and only then makes the run-dir job listable and claimable (pass) | pass |
| S27 | [agent-runtime-core](specs/agent-runtime-core/spec.md) | Publication faults cannot be mistaken for completion | `executor` — pre-commit staged, post-commit and between-rename fault points stay non-ready with run_pending or terminal_artifacts_pending and only the full final set is ready (pass)<br>`executor` — a changed final digest or a run directory swapped for a symlink fails closed without touching outside files or yielding a successful wait (pass) | pass |
| S28 | [headless-agent-jobs](specs/headless-agent-jobs/spec.md) | Daemon executes API work once and preserves source exclusions | `executor` — one concurrency-1 daemon pass dispatches daemon, then schedule, then API agent/completion exactly once and leaves desktop/CLI/protocol queued (pass)<br>`executor` — two direct pumpQueuedRuns instances on independent connections race claim; every eligible Run dispatches once and each pump stays within concurrency 1 (pass)<br>`executor` — only one real daemon lock acquisition succeeds and a stale-nonce release never unlinks its successor (pass) | pass |
| S29 | [agent-protocol-interfaces](specs/agent-protocol-interfaces/spec.md) | Job run acknowledges the shared creation core | `guards-protocol` — API submit and jobs-stdio job.run both go through submitRun, the job.run ack follows the committed job_created fact, the session-scoped pumpQueuedRuns runs it after the runner latch opens, and extra consumer/key params stay invalid-params (pass) | pass |
| S30 | [agent-protocol-interfaces](specs/agent-protocol-interfaces/spec.md) | Protocol cancel and shutdown remain session-owned | `guards-protocol` — queued cancel wins the claim cleanly without spawn, running cancel reaches the paused worker, cross-session cancel is -32602, the API job is never canceled or claimed, and shutdown/EOF stop each session's own pump scope (pass) | pass |
| S31 | [architecture-ownership](specs/architecture-ownership/spec.md) | Schedule creation retains one fire without bypassing creation facts | `guards-protocol` — two connections evaluating the same scheduledFor fire one job/audit run and advance nextRunAt once with job_created from the host; a failed creation append leaves no acknowledged or claimable work and no idempotency rows (green-by-design characterization) (pass)<br>`guards-protocol` — schedules.ts constructs no agent_jobs row itself (createScheduleJobRecord's insert(agentJobs) is replaced by the job-store insertion primitive) and still records job_created through recordAgentJobCreated (pass) | pass |
| S32 | [architecture-ownership](specs/architecture-ownership/spec.md) | Guard rejects an inline API execution fallback | `guards-protocol` — the guard self-test matches every S32 case exactly: the clean wrapper/stdio pump fixture (human locus run permitted) passes and each inline-runner, restored runPreparedLocalJobApiJob and independent stdio dispatch variant reports its file, symbol and daemon/run-submission owner (pass)<br>`guards-protocol` — the guard self-test fails by case id when a required inline-runner finding is missing from a variant or an unexpected one is demanded of the clean fixture (pass)<br>`guards-protocol` — the default architecture check self-tests the canonical async fixture and enforces the repository end state (run-submission.ts owns submitRun/waitForRun, daemon.ts owns pumpQueuedRuns, runPreparedLocalJobApiJob and adapter runner calls are gone) (pass) | pass |
| S33 | [architecture-ownership](specs/architecture-ownership/spec.md) | Guard rejects duplicate creation and ledger writers | `guards-protocol` — the guard self-test matches every S33 case exactly: duplicated submitRun/waitForRun/pumpQueuedRuns, direct agent_jobs inserts in API/stdio/schedule adapters and an appendExactRunEventBatch import outside the host are rejected with their owner, the schedule shared-insertion fixture passes, and no migration toggle can revive the old core or the retired ledger gate (pass) | pass |
| S34 | [local-job-api](specs/local-job-api/spec.md) | Create and retry run without an external executor | `submit-wait` — with no daemon lock, create (agent, completion) and default retry claim only their own admitted Run through the canonical pump, leave unrelated queued work untouched and match baseline bytes (pass)<br>`submit-wait` — daemon-first: when a daemon wins the claim the wrapper only waits, never double-dispatches, and returns the claimant's terminal envelope (pass)<br>`submit-wait` — daemon-first stalled worker with unknown liveness and no progress yields the identified executor_unknown error/8 at the 30000 ms window (pass)<br>`submit-wait` — daemon-first kind:completion with a 45000 ms upstream call and a confirmed-alive claimant emits no error/8 at 30000 ms and returns the claimant's terminal envelope (pass) | pass |
| S35 | [local-job-api](specs/local-job-api/spec.md) | Aborting a wrapper applies the chosen cancel policy | `submit-wait` — own-pump wrapper keeps the 2c59664f process-tree receipts for SIGINT/SIGTERM/SIGKILL and stdin EOF (pass)<br>`submit-wait` — daemon-first SIGINT relays one cancel for the admitted ID only, waits at most 5000 ms for the ack and re-raises SIGINT (pass)<br>`submit-wait` — daemon-first SIGTERM relays one cancel for the admitted ID only, waits at most 5000 ms for the ack and re-raises SIGTERM (pass)<br>`submit-wait` — SIGKILL of a daemon-backed waiter relays nothing and leaves the Run running and queryable (pass)<br>`submit-wait` — closing a stdin pipe that was open at admission relays the own cancel and exits 8 without a terminal envelope (pass)<br>`submit-wait` — ignored stdin and a --request - body EOF consumed before admission arm no EOF cancel and the Run continues (pass)<br>`submit-wait` — Career Kit SIGTERM then SIGKILL after 500 ms truncates the ack wait without undoing the persisted cancel request (pass) | pass |
| S36 | [agent-runtime-core](specs/agent-runtime-core/spec.md) | Daemon death recovers to a readable interrupted result | `executor` — a killed daemon worker settles once as interrupted/worker_stopped and wait returns exit 1 with result.artifacts [] and retention from settlement (pass)<br>`executor` — a stale heartbeat whose worker is alive or EPERM stays running with no false recovery and wait reports run_pending (pass) | pass |
| S37 | [headless-agent-jobs](specs/headless-agent-jobs/spec.md) | Submit in one process and publish in another | `executor` — process A submits and exits, process B reopens/executes/publishes and process C waits ready with the golden prepared tail and no dev/ino/env leakage (pass)<br>`executor` — an initial-file digest, symlink or hardlink mismatch found by the claiming process settles failed/artifact_admission_mismatch once, calls no provider and wait returns exit 1 (pass) | pass |
| S38 | [agent-runtime-core](specs/agent-runtime-core/spec.md) | Crash at creation to initial admission boundary | `executor` — the half-admitted Run is never listed or claimed, same-key submit is submission_pending/8 and status/wait report admission_incomplete (pass)<br>`executor` — runs cancel settles one canceled terminal without terminal refs and only the named cleanup at settlement+30 days releases the reservation (pass) | pass |
| S39 | [headless-agent-jobs](specs/headless-agent-jobs/spec.md) | Claim revalidates project identity profile and age | `executor` — each post-ack mutation settles failed once with its reason, errorCode and outcome exit (7/7/4,2,6 or 3/1) and zero provider calls while the younger control runs once (pass)<br>`executor` — injected maxQueuedApiAgeMs moves only the age threshold and never bypasses the identity gate (pass) | pass |
| S40 | [headless-agent-jobs](specs/headless-agent-jobs/spec.md) | Runtime environment belongs to the actual claimant | `executor` — the daemon-claimed child uses the daemon's native homes/PATH/proxy, the local wrapper child uses the caller's, secrets never pass and no env snapshot is stored (pass) | pass |
| S41 | [headless-agent-jobs](specs/headless-agent-jobs/spec.md) | Daemon starts without a renderer window | `executor` — the headless branch dispatches daemon mode before single-instance, menu, window, updater, auth-callback and MCP startup and keeps diagnostics on stderr (pass) | pass |
| S42 | [headless-agent-jobs](specs/headless-agent-jobs/spec.md) | Daemon claims queued daemon jobs | `executor` — the daemon additionally claims an admitted source=api job through the same pump while an unadmitted API row and protocol work stay unclaimed (pass)<br>`headless-daemon.test.ts` — "fires due schedules and claims schedule jobs without claiming protocol jobs" (registered-existing, pass)<br>`headless-daemon.test.ts` — "daemon respects the configured concurrency limit" (registered-existing, pass)<br>`headless-cli-dispatcher.test.ts` — "runs daemon once and claims only daemon queued jobs" (registered-existing, pass) | pass |
| S43 | [headless-agent-jobs](specs/headless-agent-jobs/spec.md) | Daemon follows cancellation requests | `headless-daemon.test.ts` — "daemon worker observes persisted cancel requests" (registered-existing, pass) | pass |
| S44 | [headless-agent-jobs](specs/headless-agent-jobs/spec.md) | User follows daemon logs | `executor` — jobs logs --follow and run --daemon --follow stream persisted events in sequence and exit after the daemon job is terminal (pass) | pass |
| S45 | [headless-agent-jobs](specs/headless-agent-jobs/spec.md) | Daemon restarts after crash | `headless-daemon.test.ts` — "runs queued daemon jobs and marks stale running jobs interrupted on startup" (registered-existing, pass)<br>`headless-cli-dispatcher.test.ts` — "daemon command reports stale running jobs it interrupts" (registered-existing, pass)<br>`headless-cli-dispatcher.test.ts` — "cancels queued jobs and retries terminal jobs" (registered-existing, pass)<br>`run-event-ledger-recovery-variants.test.ts` — "an unknown or unsupported host probe leaves the row running" (registered-existing, pass) | pass |
| S46 | [headless-agent-jobs](specs/headless-agent-jobs/spec.md) | Daemon coordination stays local | `executor` — token/API-key/raw-env daemon-client inputs are rejected before any job or provider call and a daemon pass opens no listening socket while touching only its profile (pass)<br>`headless-cli-dispatcher.test.ts` — "rejects jobs-stdio provider secrets and raw env without creating jobs" (registered-existing, pass)<br>`headless-cli-args.test.ts` — "rejects provider secrets on the command line" (registered-existing, pass) | pass |
| S47 | [agent-protocol-interfaces](specs/agent-protocol-interfaces/spec.md) | User starts jobs-stdio mode | `headless-cli-dispatcher.test.ts` — "runs jobs-stdio with JSON-only stdout and protocol jobs" (registered-existing, pass)<br>`headless-cli-dispatcher.test.ts` — "rejects jobs-stdio provider secrets and raw env without creating jobs" (registered-existing, pass)<br>`headless-cli-args.test.ts` — "parses jobs-stdio command and rejects the retired acp alias" (registered-existing, pass)<br>`headless-cli-shims.test.ts` — "POSIX shim rejects retired acp before GUI dispatch" (registered-existing, pass)<br>`headless-cli-shims.test.ts` — "generated Windows wrapper routes jobs-stdio and rejects retired acp" (registered-existing, pass) | pass |
| S48 | [agent-protocol-interfaces](specs/agent-protocol-interfaces/spec.md) | Protocol client sends prompt turn | `guards-protocol` — a source=protocol job is created through submitRun and run by the session-scoped pumpQueuedRuns, job/event notifications equal the normalized committed events, and job.cancel maps to the shared cancelAgentJob path (pass)<br>`headless-cli-dispatcher.test.ts` — "runs jobs-stdio with JSON-only stdout and protocol jobs" (registered-existing, pass) | pass |
| S49 | [agent-protocol-interfaces](specs/agent-protocol-interfaces/spec.md) | Protocol client initializes capabilities | `guards-protocol` — initialize returns exactly locus-jobs-stdio.v1, serverInfo and the four minimal job capabilities, with no ACP, MCP, session-resume or runtime-parity claim (green-by-design characterization) (pass) | pass |
| S50 | [agent-protocol-interfaces](specs/agent-protocol-interfaces/spec.md) | Protocol exits cleanly | `guards-protocol` — shutdown stops accepting protocol jobs, cancels its own queued and running jobs without re-marking a terminal job, and writes only JSON-RPC to stdout (green-by-design characterization) (pass)<br>`guards-protocol` — stdin-eof stops accepting protocol jobs, cancels its own queued and running jobs without re-marking a terminal job, and writes only JSON-RPC to stdout (green-by-design characterization) (pass) | pass |
| S51 | [agent-protocol-interfaces](specs/agent-protocol-interfaces/spec.md) | Historical job rows keep the retired protocol string | `guards-protocol` — a pre-ledger agent_jobs row recorded under locus-acp-stdio.v1 survives every migration byte-for-byte and reads back through a read-only store connection (green-by-design characterization) (pass) | pass |
| S52 | [local-job-api](specs/local-job-api/spec.md) | Consumer detects readiness support | `run-event-ledger-projection.test.ts` — "S53 Consumer detects readiness support" (registered-existing, pass)<br>`headless-cli-dispatcher.test.ts` — "lists Local Job API runtime capabilities" (registered-existing, pass) | pass |
| S53 | [local-job-api](specs/local-job-api/spec.md) | Older build lacks the feature | `idempotency` — documentation-example preflight reads a no-async-submit discovery envelope as unsupported and its dispatch spy stays zero, while an envelope advertising the feature dispatches once (green-by-design; not evidence about the Locus parser) (pass)<br>`run-event-ledger-projection.test.ts` — "S54 Older build lacks the feature" (registered-existing, pass) | pass |
| S54 | [local-job-api](specs/local-job-api/spec.md) | Consumer detects canonical ledger support | `run-event-ledger-projection.test.ts` — "S55 Consumer detects canonical ledger support" (registered-existing, pass) | pass |

Implementer-unit tests added during implementation (all pass at the candidate):

| File | Tests | Covers |
| --- | --- | --- |
| `tests/local-job-api-retry-error-baseline.test.ts` | 3 | Phase I design P2-1: retry error stream/exit/gate order equal to `2c59664f` |
| `tests/local-job-api-wrapper-relay.test.ts` | 1 | Phase I design P2-2: fast-acknowledging claimant, relay writes no terminal and re-raises |
| `tests/local-job-api-queued-cancel-terminal.test.ts` | 5 | Phase II design P2-1 / tasks 2.7: admitted queued cancel publishes terminal refs; never-admitted, artifact-free and reopen-mismatch cancels register none; racing cancels publish once |
| `tests/local-job-api-claim-hardening.test.ts` | 6 | over-age tick settlement (bound 16, claimed-first race), gate handle closed on setup throw, missing identity fails closed, `claim_gate_failed` fallback |

Existing-test churn: `tests/run-event-ledger-terminal-commit-faults.test.ts`
moved `artifactManifestPath` to after the claim because of the D3 admission
predicate (Phase I, `0bbaa549`); no `expect` changed (Phase I security P3-1).
`tests/helpers/agent-job-test-db.ts` mirrors the 0025 table. No other existing
test changed.

### Sub-clauses not covered by an automated test

From red-receipt §6, with their state at the candidate:

| Scenario | Uncovered clause | State |
| --- | --- | --- |
| S07 | commit landing between a waiter's initial read and its wakeup registration | open; no read/wakeup latch seam was added |
| S11 | "creation committed, initial admission pending" under true concurrency | open; the state itself is covered by S14/S38 |
| S17 | reader-side nonce A→B between two reads | open; writer-side successor case covered |
| S18 | slow-cancel preparation racing a claimant that fails immediately | partly: process+attempt staging names (`765b8ea6`) and cancel/cancel race (`local-job-api-queued-cancel-terminal.test.ts`) covered; slow-cancel vs failing claimant open |
| S22 | failed migration exits before activation; isolated profile activation/rollback; old binary at a new marker | open (tasks 4.9); the guides state that same-profile mixed builds are unsupported |
| S27 | fault after each staged write, not only the last | open |
| S35 | Windows matrix; POSIX process-group kill with real grandchildren | host-blocked (no Windows host); POSIX single-process receipts covered |
| S37 / S39 | create/default-retry wrapper paused after admission (`beforeOwnPumpClaim`) | open as tests; the Phase II design review probed the wrapper-paused unregister case (exit 7) on the same gate |
| S40 | CLI readiness with probing enabled across processes; win32 allowlist | open / host-blocked |
| S41 / S47 | packaged bootstrap ordering and packaged `locus jobs-stdio` capture | host-blocked (tasks 8.3) |
| S21 | retention equality with baseline | open (names, roles, digests and result fields are asserted) |

## Implementation decisions where the design was silent

Consolidated from the Phase I, Phase II and T1 implementer reports and checked
against the code at `e0a9a967`.

| Area | Decision |
| --- | --- |
| Reservation storage | Table `agent_job_idempotency(id, consumer_id, key_hash, job_id → agent_jobs ON DELETE CASCADE, request_hash, normalization_version, created_at, expires_at NULL)` with unique `(consumer_id, key_hash)`, migration `0025_agent_job_idempotency`. |
| Hashes | Key hash = SHA-256 of `locus.local-job.idempotency-key.v1\0` + length-prefixed consumer + length-prefixed key. Request hash = SHA-256 of a domain plus canonical JSON `{normalizationVersion:1, fingerprint}`; the submit fingerprint uses realpath-canonical cwd and artifact base (no registry read, so a replay never reruns admission gates); the retry fingerprint is `{intent:"retry", sourceJobId, sourceInput}`. |
| Error envelopes | stdout `{apiVersion, error:{code, message[, retryable]}}`; `submission_pending` → exit 8 with `retryable:true`; every other async code → exit 2. A keyed submit/retry whose `consumer.id` the store would redact → `secret_in_request` (unkeyed requests keep baseline storage). Messages: `idempotencyKey is not accepted by runs create; use runs submit.`, `The idempotency key is already bound to a different request.`, `consumer.id does not match the source job consumer.`, `Submission is not yet admitted; retry the same key.` |
| Replay envelope | `{apiVersion, idempotentReplay:true, job}` for keyed submit and keyed `retry --async`; a synchronous keyed retry replay prints the child's plain terminal envelope. |
| Retry body | Only `apiVersion`, `consumer.id`, `idempotencyKey`; other members and malformed JSON → plain-text stderr, exit 2; `consumer_mismatch` before key lookup. |
| Retention | One `UPDATE agent_job_idempotency SET expires_at` through `recordVerifiedRunRetention` after verified publication (pump, queued cancel) or at settlement for an empty terminal set (recovery, admission failure, claim-gate and over-age settlements). Cleanup is a `DELETE`, run by `submitRun` for the consumer before every submit, create and retry (keyed or not) and by every daemon loop iteration, including `--once`. |
| Admission keys | Initial admission observation key `lifecycle:initial-artifacts:<id>` (fact `:0`); claim errors `MISSING_JOB_CREATED`, `MISSING_INITIAL_ADMISSION`, `CLAIM_LOST`. A run-dir or admission failure after the creation commit settles `failed` / `artifact_admission_failed` through the host and keeps the attempt and key. |
| Worker identity | Unique per claim: `<kind>:<pid>:<ms>:<createId>:<jobId>`, where `kind` is `daemon` for daemon claims and the runner's own prefix otherwise (`headless`, `completion`; protocol sessions keep `protocol:`). Two pumps in one process otherwise produced identical `job_started` fact keys (found by S28). Opaque; the guides disclose the format change. |
| Pump | `pumpQueuedRuns` is a one-line export over the internal `runPumpPass`, which the daemon loop also calls, so external scoped callers stay observable. Slots daemon → schedule → api; `api` only when the daemon holds a lock (`apiCapable: lock !== null`); a direct unscoped `pumpQueuedRuns` call defaults to API-capable (executor tests). |
| Lock v2 | Refreshed every 500 ms and on each loop iteration by temp file + rename; the writer stops on a foreign nonce. Freshness 0–5000 ms; running-worker evidence uses the existing 120 s recovery window. |
| Wrapper wait | 100 ms polls on `monotonicClock`; own-pump runs exempt from the no-progress window while the dispatch promise is pending; daemon-first no-progress window 30 s with reason `executor_unavailable` when the observation is unavailable, otherwise `executor_unknown` (including a queued run with an available daemon that never claims it); publication bound 30 s after `completed`. |
| R4 relay | Armed signals = `daemonFirstRelaySignals(process.platform)`: `SIGINT`, `SIGTERM`, `SIGHUP` on POSIX, plus `SIGBREAK` on win32 (T2 P2-1). Cancel is persisted, then up to 5000 ms of polling for a terminal; then the signal is re-raised (1 s fallback if a foreign handler keeps the process alive; exit 8 when the runtime cannot raise it, i.e. Windows `SIGBREAK`/`SIGHUP`) or exit 8 on EOF, with no stdout. EOF is armed only when `stdin` is `process.stdin`, fd 0 is a FIFO or socket and the request was not read from stdin. |
| Completion heartbeat | Every 15 s during the single upstream call (closure residual 1). |
| Claim gate | `RunClaimGate` after the conditional claim, before provider resolution: project → cwd identity → stored profile/capability/grant → explicit provider profile → queued age → run-dir reopen; completion runs skip project, cwd and reopen. Failures settle `host_result` failed with optional `reasons` prepended to the ledger failures; an unexpected gate exception → `claim_gate_failed` / `internal_error` / 8. Missing or malformed stored identity → `cwd_identity_changed` (`74e30df9`). The gate handle closes in an outer `finally` (`27cbcdad`). |
| Stored identity | `inputJson.submissionContext.projectIdentity = {canonicalPath, dev, ino}` with decimal-string dev/ino from a bigint stat; retry re-captures it; never serialized or written to `request.json`. |
| Staging | `.<final>.locus-staged-<pid>-<uuid per prepare()>`, exclusive create; discard removes only the preparer's own receipts. |
| Queued cancel | `openQueuedCancelLocalJobApiTerminal` returns a preparer only for a queued, admitted `source=api` agent run whose project, cwd identity and planned run dir still revalidate; it shares the private reopen helper with the claim gate and is passed to `cancelAgentJob` as `queuedTerminalProjection` by every API cancel host (CLI `runs cancel`, `jobs cancel`, the R4 relay, own-dispatch cleanup, tRPC `agentJobs.cancel`). jobs-stdio cancel is unchanged (protocol runs only). |
| Over-age tick | `settleOverAgeQueuedLocalJobApiRuns` every daemon loop iteration (with or without a lock), after idempotency cleanup and before schedules and pump; oldest first, at most 16 per iteration, admitted runs with `createdAt <= now - maxQueuedApiAgeMs`, through `settleQueuedAgentJobFailed(..., {requireUnclaimed})` so a concurrent claimant wins. A non-race settlement error yields one sanitized `[Daemon]` diagnostic and excludes the id for the rest of that daemon's life (T2). |
| Retry errors | `apiRetryError` keeps the `2c59664f` retry catch (provider-binding → stdout envelope, everything else → stderr exit 3) plus the new request errors; `apiCreateError` keeps the create catch. The retry status check stays inside `retryAgentJob`, after the gates. |
| Protocol | `SubmitRunIntent` gains `{kind:"protocol-run"}` (no key, no artifacts); protocol claims keep the `protocol:` worker prefix. |

## Disclosures

Open P3 findings and accepted residuals at the candidate. None blocks; each
is either documented for consumers or recorded here for a follow-up.

| Source | Item | Disposition |
| --- | --- | --- |
| Phase I design P3-2 | D3 moves mkdir after the creation commit; a run-dir or admission failure leaves a `failed` / `artifact_admission_failed` job (every artifact-bearing attempt on Windows until TICKET-127) | Documented in both guides (Claim-time checks, Known limits). TICKET-127/128 text not updated in this slice. |
| Phase I design P3-3 | `readRunPublicationReadiness` re-hashes every terminal ref on each 100 ms poll; no SYN-25 stat/identity cache | Open (tasks 3.3). Cost only; correctness unaffected. |
| Phase I design P3-4 | Lock heartbeat nonce check and `renameSync` are not atomic together | Open; reachable only when a successor took over a lock whose writer looked dead. |
| Phase I design P3-5 | `job.workerId` format gained a `createId` segment | Documented in both guides (opaque, format changed). |
| Phase I security P3-1 | `run-event-ledger-terminal-commit-faults` fixture churn | Recorded above; no assertion changed. |
| Phase I security P3-2 | Malformed JSON bodies on `submit` / `retry --request` can echo parser text (and so a fragment of the input) on stderr | Open; same as existing create behavior; keys are not secrets by contract. |
| Phase I security P3-3 | Lock heartbeat temp file written non-exclusively | Open; same-user actor only. |
| Phase II security P3-2 | Async guard misses assignment aliases, `.call`/`.apply` and raw `INSERT INTO agent_jobs` | Disclosed in the guard comment (`2dc0b5e6`); the S32/S33 fixture does not require them. |
| Phase II security P3-4 | Unscoped direct `pumpQueuedRuns` defaults to API-capable | Record only; the only production caller passes `apiCapable: lock !== null`. |
| T1 P3-2 | The over-age tick swallowed every settlement error silently; 16 or more persistently failing over-age runs would block younger ones in that bound | Closed in T2: only `JOB_PRECONDITION_FAILED` or a re-read showing the run claimed/terminal is silent; any other error writes `[Daemon] Over-age job <id> was not settled (<CODE>); not retried by this daemon.` (sanitized code, no error text) and the daemon excludes that id on later ticks (`tests/local-job-api-over-age-tick-diagnostics.test.ts`). |
| T1 P3-3 | Tick vs claim precedence: an over-age and unregistered run settles `queued_age_exceeded` / 1 on a daemon tick but `project_unregistered` / 7 if a non-daemon claimant reaches it first | Record only; the tick settles age only, and in a daemon the tick always runs before the pump. |
| Daemon tick cadence | The over-age settlement runs every loop iteration, also in a lock-less daemon (settling is not claiming), at most 16 per iteration | Implementation judgement (T1); documented to consumers as "a bounded number per loop iteration". |
| projectIdentity fail-closed | API agent rows admitted by unreleased builds between `d59b1142` and `765b8ea6` lack the stored identity and now fail closed with `cwd_identity_changed` / 7 | Intended (Phase II security P3-1); no released build wrote such rows. |
| R1 (accepted) | Daemon-first `wait.state:"error"` / 8 branches and the local publish-failure `artifacts:[]` baseline | Documented in both guides. |
| R3 (accepted) | Daemon-claimed runs use the daemon's environment and native credential homes | Documented in both guides. |
| R4 (accepted) | `SIGKILL`, Windows `TerminateProcess` / `child.kill()` and the logoff/shutdown console events (libuv does not deliver them) cannot relay; 500 ms kill grace and the Windows console-close grace truncate the 5 s ack; Windows exits after a relayed signal (Ctrl+C → 1, Ctrl+Break / console close → 8) not verified on Windows (closure residual 3) | Documented in both guides; Windows host-blocked. The win32 `SIGBREAK`/`SIGHUP` tests in `tests/local-job-api-wrapper-relay-signals.test.ts` are platform-gated and skipped on this Linux host. |
| Phase III check P2-1 | The relay armed only `SIGINT`/`SIGTERM` while the docs promised Windows console Ctrl events | Closed in T2: `SIGHUP` (POSIX, win32 console close) and `SIGBREAK` (win32 Ctrl+Break) armed; spec delta, design R4, proposal and both guides name the exact set. The immutable fixture `controls.json#S35.windowsMatrix` still says "console Ctrl events"; it is unexecuted documentation of the win32 harness and is superseded by the spec table. |
| Starvation | daemon → schedule → api slot order can delay API runs | Documented. |
| TICKET-128 | Orphan creation keeps a key pending; partial publish and publish→expiry crash gap; a consumer deleting published files makes `wait` pending again | Documented in both guides; not repaired in this slice. |
| Mixed builds | An older build on the same profile is unsupported and not technically fenced (D7, SYN-26) | Documented in both guides; the 4.9 fixture is open. |

## C7 scope check

Every consumer-visible change in proposal §3 (and the C7 §9.2 categories) maps
to guide text at the candidate (English section named; the Chinese guide has
the same section and content):

| Proposal Consumer Impact row | Consumer guide |
| --- | --- |
| submit / wait, retry `--async` / `--request`, wait timeout envelope and exit 9 | Command Reference; Asynchronous Submission → Submit, Wait; Retry; Exit Codes (row 9) |
| create / default retry = submit + scoped pump + wait (R1), own-pump exemption, daemon-first observer errors | Asynchronous Submission → Synchronous create and default retry; Create Response note |
| execution context (R3), CLI readiness only for the caller | Execution context; Runtime Capabilities readiness note |
| waiter abort (R4), platform table, cancel-by-ID, 500 ms kill grace, `--request -` EOF | Aborting a waiting command; Cancel |
| `job.workerId` / `job.workerPid` provenance | Executor availability; daemon-first bullet |
| idempotency key, replay, conflict, create rejection (#2 tightening, new code) | Idempotency (incl. error table) |
| six claim-time fail-closed outcomes and exit mapping | Claim-time checks (incl. `claim_gate_failed`) |
| `submission_pending` / 8 / `retryable`, orphan and new-key risk | Idempotency → Pending submissions |
| status `execution` for queued/running, omitted for terminal; read-only observation and the existing recovery prologue | Executor availability; Status note; Wait |
| `async-submit` in the closed discovery enum (R2) and pinned-schema refresh | Runtime Capabilities feature table and paragraph; Upgrade checklist; Troubleshooting; Stability Contract |
| terminal result/artifacts: prepared tail, recovery and missing-admission empty refs, publish-failure baseline | Wait; Cancel, recovery and terminal files; Synchronous create (failure behavior) |
| key request gating and guide:210 narrowing (#10) | Runtime Capabilities paragraph; Upgrade checklist |
| jobs-stdio envelopes unchanged | No guide change (the stdio protocol is not part of this guide); S29/S30/S47–S51 green |
| `apiVersion` stays `locus.local-job.v1` | Asynchronous Submission intro |
| #8 key retention is not file retention | Idempotency → Retention |
| #9 no HTTP/socket, no detached launcher | Known limits |
| TICKET-128 / TICKET-127 residuals, admission-failure rows, mixed builds | Known limits; Claim-time checks |
| deleted published files make wait pending again (SYN-18) | Wait |

No consumer-visible change was found outside proposal §3. Two consumer-facing
details the proposal did not spell out are disclosed in the guides: the
`workerId` format change (Phase I P3-5) and the failed job left by an
admission failure after the creation commit (Phase I P3-2).

## Smoke matrix (tasks 8.3 / 8.4)

Probe at the candidate (2026-10-02, this WSL2 host, kernel
`6.18.33.2-microsoft-standard-WSL2`): `node_modules/electron/dist/electron`
cannot start: `error while loading shared libraries: libnspr4.so`, exit 127;
`ldd` also lists `libnss3.so`, `libnssutil3.so`, `libsmime3.so` and
`libasound.so.2` as missing. `LOCUS_USER_DATA_DIR=$(mktemp -d)
LOCUS_HEADLESS_FAKE_RUNNER=1 node_modules/electron/dist/electron out/main/index.js
--locus-headless-cli api runtimes list --json --no-probe` exits 127 with the
same error. `resources/bin/` (bundled runtimes) is absent, `DISPLAY` is unset
(WSLg is present at `/mnt/wslg`), and no macOS or Windows host is available.

In-process runs of `runHeadlessCliCommand` with the fake runner (submit,
keyed replay, conflict, keyed create, status, wait timeout, cancel, wait
ready, retry `--async`, consumer mismatch, create, completion create) are
**test evidence**, not runtime smoke: they are the red suite above and the
Phase III schema probe.

| Smoke item | Result | Reason |
| --- | --- | --- |
| Packaged-CLI API submit → submitter exits → daemon executes → status / events / wait / result, disposable profile, fake runner | host-blocked | Electron shared libraries missing (exit 127) |
| Agent and completion create / wait / result | host-blocked | Electron; completion needs a stored provider profile |
| Queued cancel, cancel/cancel, retry with key | host-blocked | Electron |
| Daemon death → recovery → wait | host-blocked | Electron |
| Real cross-process publish (CLI submit, daemon publish, CLI wait) | host-blocked | Electron (in-process real-process variant is S37) |
| Env sentinel (daemon vs caller native homes) | host-blocked | Electron; S40 covers the adapter path in-process |
| jobs-stdio session shutdown / EOF | host-blocked | Electron (S29/S30/S50 cover it in-process) |
| Real runtimes (Codex `exec`, Claude `-p`, app-server `policy-grant`) | host-blocked | Electron; bundled runtimes not downloaded; credentials |
| Workbench visibility of API queued/canceled runs | host-blocked | Electron; `DISPLAY` unset; S16 covers the store overview |
| Windows with and without artifacts (tasks 8.4), Windows abort matrix (S35) | not claimed | no Windows host; TICKET-127 open |
| macOS packaged | not claimed | no macOS host |

Rerun on a host with Electron's libraries (after
`sudo apt-get install -y libnspr4 libnss3 libasound2t64 libxss1`) at the
exact candidate SHA:

```bash
bun run build
export LOCUS_USER_DATA_DIR="$(mktemp -d)"
L="node_modules/electron/dist/electron out/main/index.js --locus-headless-cli"
PROJ="$(mktemp -d)" && git -C "$PROJ" init -q
export LOCUS_HEADLESS_FAKE_RUNNER=1
$L api runtimes list --json --no-probe            # features include async-submit
$L api projects register --cwd "$PROJ" --json
printf '%s\n' "{\"apiVersion\":\"locus.local-job.v1\",\"consumer\":{\"id\":\"smoke\"},\"project\":{\"cwd\":\"$PROJ\"},\"runtime\":{\"id\":\"codex\"},\"mode\":\"plan\",\"prompt\":{\"text\":\"smoke\"},\"artifacts\":{\"baseDir\":\"$PROJ/.locus/runs\"},\"idempotencyKey\":\"smoke-1\"}" > "$PROJ/submit.json"
# A. submit without an executor, then observe
$L api runs submit --request "$PROJ/submit.json" --json > "$PROJ/submit.out"; echo "exit=$?"
JOB="$(node -e 'console.log(require(process.argv[1]).job.id)' "$PROJ/submit.out")"
$L api runs status "$JOB" --json                   # execution unavailable/no_executor + hint
$L api runs wait "$JOB" --timeout 0 --json; echo "exit=$?"   # executor_unavailable, exit 9
$L api runs submit --request "$PROJ/submit.json" --json      # idempotentReplay:true, same id
# B. daemon executes after the submitter exited
$L daemon run --once
$L api runs wait "$JOB" --json; echo "exit=$?"     # create-shaped envelope, exit 0
(cd "$PROJ/.locus/runs/$JOB" && sha256sum request.json events.jsonl result.json artifacts.json)
# C. create runs without a daemon; keyed create is refused
node -e 'const r=require(process.argv[1]);delete r.idempotencyKey;console.log(JSON.stringify(r))' "$PROJ/submit.json" > "$PROJ/create.json"
$L api runs create --request "$PROJ/create.json" --json; echo "exit=$?"
$L api runs create --request "$PROJ/submit.json" --json; echo "exit=$?"   # idempotency_key_not_supported, 2
# D. queued cancel and keyed retry
$L api runs submit --request "$PROJ/create.json" --json > "$PROJ/q.out"
Q="$(node -e 'console.log(require(process.argv[1]).job.id)' "$PROJ/q.out")"
$L api runs cancel "$Q" --json && $L api runs wait "$Q" --json; echo "exit=$?"   # 5, terminal files listed
printf '%s\n' '{"apiVersion":"locus.local-job.v1","consumer":{"id":"smoke"},"idempotencyKey":"retry-1"}' > "$PROJ/retry.json"
$L api runs retry "$Q" --request "$PROJ/retry.json" --async --json
# E. daemon death and recovery: start `$L daemon run`, submit a real-runtime job
#    (after bun run codex:download and login), kill -9 the daemon while it runs,
#    then `$L api runs wait <id> --json` (interrupted, exit 1, artifacts []).
# F. Desktop: DISPLAY=:0 bun run dev; confirm queued and canceled API runs in the Workbench.
```

## Consumer evidence ownership

| Owner | Evidence | State |
| --- | --- | --- |
| Locus | Neutral async submit/wait/idempotency/control, batch/structured-output, stdio, schema and compatibility fixtures | Implemented; S01–S54 green at the candidate; runtime and packaged smoke host-blocked |
| Career Kit | Adapter facts at `career-application-kit@6d6a333` (v1 pin, 5 min timeout, sanitized env allowlist, POSIX detached process-group kill, no win32 detach, `LOCUS_KILL_GRACE_MS = 500`, createdAt-window validator) per proposal §5 | Facts recorded; this slice's consumer E2E receipt: unknown |
| Amadeus | Windows consumer; current v1 commands, version and key needs | unknown; no negotiation or roadmap ordering |
| Other | — | unknown |

## Stop gates

- Tasks 8.5: Codex `IMPLEMENTATION_VERIFIED` and a fresh-context Claude
  `REVIEW_APPROVED` must both bind this candidate SHA. Both are pending. The
  T1 `REVIEW_APPROVED` binds `e0a9a967` (product code identical to the
  candidate) and is not a substitute.
- Tasks 8.7: once both verdicts bind the same SHA and no Red item is open, the
  coordinator records ACCEPTED under the Owner's 2026-10-02 self-iteration
  mandate. Red items return to the Owner. Not recorded yet.
- Tasks 8.8: this dispatch does not authorize push, remote PR changes, remote
  merge, release or repository-rules changes; none was performed. A local
  merge needs its own authorization and post-merge gates.
- Open before acceptance can be argued complete: tasks 1.4 (Windows
  receipts), 1.6 (closure re-check receipt), 3.3 (SYN-25 cache), 4.9
  (migration/rollback fixture), 8.1, 8.3, 8.4, and the sub-clauses listed
  above. The coordinator decides which of these are acceptance blockers.
- Any later code change invalidates both technical verdicts.

## History (pre-implementation records)

The sections below are kept as written before implementation. Their status
statements ("not authored", "not run", "pending") describe that time.

Superseded and removed from this record: the pre-implementation "Future evidence required" table, the all-pending scenario register, the planned-only consumer evidence table and the draft stop-gate list; the sections above replace them.

### Draft identity and authority

- Change: add-local-job-api-async-submit；Phase 3 第二份提案。
- Base / unchanged product source SHA: `2c59664f1b80a5f782eb05f82d33f718d9bc7053`。
- Worktree: `/home/chen/projects/locus-add-local-job-api-async-submit-draft`。
- Branch: `codex/add-local-job-api-async-submit-draft`。
- Author / date: Codex / 2026-10-01 (Pacific/Auckland)。
- Revision parent: `79c4e7b0767b2e6c5ed4706abd41bc573924e349`；第三版输入为二审 `async-submit-redraft-synthesis-79c4e7b0.md` §3 的 12 项有界编辑、§2 的 0 P1 / 8 P2 / 13 P3；§4 六项 Owner 决策原文搬入 design Open questions，推荐默认不变。
- Historical v3 draft receipt commit：`0f9984367a9fbc8c5030f9aecc85ac9628a71cde`，单一本地 `docs(openspec): bounded text touch-up of local job api async submit per second review` 提交。当前批准记录提交只登记决策与 prune；由 git history 解析其 SHA，避免自引用。
- Product source edits/tests authored: **none**。本记录不声称实现、conformance 或 packaged smoke 已通过。
- Owner APPROVED / C7 R1–R4,Q1–Q6: **APPROVED 2026-10-02，bound to `0f9984367a9fbc8c5030f9aecc85ac9628a71cde`，六项推荐默认全选**；完整决定见 proposal §10 / design Owner decisions。
- Implementation source SHA / Codex IMPLEMENTATION_VERIFIED: **not applicable to draft / not issued**。
- Fresh Claude Code REVIEW_APPROVED / reviewed source SHA: **not issued for this revision**；79c4e7b0 的二审 synthesis 为 CHANGES_REQUESTED，本版等待对本提交 exact SHA 的单次 closure check（不是新三视角轮次）。
- Local merge SHA / ACCEPTED: **none / pending**；Owner 2026-10-02 授权统筹代行，条件是 Codex IMPLEMENTATION_VERIFIED + fresh-context Claude REVIEW_APPROVED 同 source SHA、无开放 Red，只有红灯项回 Owner。
- Remote push/PR/merge/release/rules: **not authorized / not performed**；本次也不本地 merge。

### Approval record checks (2026-10-02，纯文档)

Owner 批准仍绑定 `0f9984367a9fbc8c5030f9aecc85ac9628a71cde`；本次只有决策记录与选定分支 prune，不新增设计或产品实现。只勾选 tasks 1.1；1.6 文字 prune 已完成但独立 closure re-check 未取得，测试先行与全部实施任务仍未勾选。

| Check | Result / scope |
| --- | --- |
| 指定 binary `openspec validate add-local-job-api-async-submit --strict --no-interactive` | Exit 0：`Change 'add-local-job-api-async-submit' is valid`。 |
| 指定 binary `openspec validate --all --strict --no-interactive` | Exit 0：`Totals: 54 passed, 0 failed (54 items)`。 |
| `git diff --check` / staged diff check | Exit 0；七个 OpenSpec 文档，无 src/tests/docs 改动。 |
| Scenario 登记一致性 | S01–S54 登记表与批准基线逐字相同，全部 pending / not run；S34/S35 合同仅裁剪未选分支，ID/标题保留。 |
| `bun run check:full` | Exit 1 / environment blocked：lint 无受支持文件需检查；architecture guard 通过、ledger self-test 17/17；retired-runtime 阶段 Node `spawnSync /bin/sh EPERM`，后续 typecheck/tests/spec/build 未执行，不计 full gate 通过。 |

Prune：Q2 仅 (a)，(a′)/(b)/(c) 已否决；R3 daemon env/native home accepted，caller-only claim 已否决；R4 daemon-first relay，no-relay 与 (b)/(c) 行为已否决；Q1 v1 + submit/retry-only key + create reject，keyed create/ignore/v1.1 已否决；R2 direct，version/facade/defer 已否决；Q4/Q5/Q6 全部接受，TICKET-128 全量前置及新增 exit code 已否决。备选后果保留在 design Owner decisions；deltas 不含互斥合同。

### Historical v3 draft-only checks actually performed（0f998436）

调用指定基线 worktree 的已安装 OpenSpec binary，工作目录始终为本 draft worktree；未安装依赖、未写产品文件。

| Check | Result / scope |
| --- | --- |
| `/home/chen/projects/agent-code-for-me/node_modules/.bin/openspec validate add-local-job-api-async-submit --strict --no-interactive` | Exit 0：`Change 'add-local-job-api-async-submit' is valid`。仅格式/规格校验。 |
| 同 binary `validate --all --strict --no-interactive` | Exit 0：`Totals: 54 passed, 0 failed (54 items)`；53 living specs + 本 draft。 |
| Scenario 登记一致性 | 54 个 Scenario，S01–S54 连续且唯一、S01–S40 IDs 不变，每个有 GIVEN/WHEN/THEN；S41–S54 保留每条 living assertion 与标题，S42/S46/S48/S51 明列 modified-inherited 的一致性补充（S48 为同核表述细化），S53 恢复原 consumer rule 并附 helper documentation example；登记与下表一一对应。 |
| `git diff --check` / staged diff check | Exit 0：working/staged diff 均无 whitespace 错误，八个允许范围内文档；提交后再核对完整提交 diff。 |
| `bun run check:full` | **Exit 1 / environment prerequisite blocked**：该 worktree 未安装 node_modules，lint 首步找不到 `node_modules/.bin/biome`；后续 architecture/typecheck/tests/spec/build 未执行。没有当作通过，也没有为纯文档草案安装依赖或修改产品文件。 |

完整本地命令日志 `/tmp/async-submit-v3-validate-all.log`、
`/tmp/async-submit-v3-check-full.log` 是临时执行记录，不是 durable 产品证据。

### Historical second-round synthesis §3 touch-up disposition（v3 author self-check；非独立批准）

| §3 item | Status | 文件与具体关闭内容 |
| --- | --- | --- |
| 1 / F-A | CLOSED | local-job-api wrapper/S25/S34、design D2、proposal §3/8：own-pump pending dispatch promise 豁免 30 s no-progress；remote claimant 用 D5 committed worker identity/120 s/confirmed alive；45 s completion 两分支 oracle；publication bound/recovery owner 保留。 |
| 2 / F-B | CLOSED | proposal §3 #2/#10、§4，design D2/Open Q4，local request/error/S08：create 无新字段且显式 reject key；今日 silent acceptance→新 stdout v1 idempotency_key_not_supported/2 属 Q1 tightening；reject/ignore 和旧 build duplicate 风险披露。 |
| 3 / F-C | CLOSED | local wrapper、design D2、tasks 1.4：baseline stderr text；create 2 或 unsupported message→3、retry 3；stop owned execution tree、queued cleanup、无 false terminal 保留。 |
| 4 / F-D/F-T | CLOSED | local S53 THEN 逐字恢复 living consumer rule，helper/spy 另列 documentation example；tasks 7.12/fixture contract 和本登记准确披露 S42/S46/S48/S51 modified-inherited 与 S53 example。 |
| 5 / F-E | CLOSED | headless projection table/S37/S39、design D5、proposal §3 #5/#10 与 §4：五 reason 的 completed.payload.reasons、job.errorCode、failed、exit（7/7/binding 4,2,6 else 3/1/1）；reasons 非 v1-stable，0–8 含义不变。 |
| 6 / F-F | CLOSED | tasks 1.1/新增 1.6/7.2：Owner 决策后、red tests 前强制 prune 为仅选定分支的可归档 SHALL，删除 specs 的 pending/conditional/预设决策措辞，备选归 design history，裁剪 S34/S35，strict validate + 单次 closure re-check + approved exact SHA；默认全选也执行。 |
| 7 / F-G | CLOSED | local stderr table/S06/S20、design D2：plain text + newline，unknown ID 与 status 同形 Unknown job: <id>/3，invalid-timeout argument diagnostic/2，pre-snapshot observation diagnostic/8；stdout envelopes 保留。 |
| 8 / F-H/F-O | CLOSED | design R4、local R4/S35、proposal §3/§5、tasks 1.4：POSIX/Windows matrix、cancel-by-id/EOF 边界、Career Kit no win32 detach/500 ms grace、signal re-raise、hard-kill negative assertion、ignored stdin 不 armed。 |
| 9 / F-I/F-J | CLOSED | design R4/Open questions、local R4：daemon-first relay 标为推荐默认，no-relay 备选；Q2(a′) held Run daemon-ineligible/dead-holder cancel/recovery、holder-liveness/scenario 成本与不推荐原因；(a) 默认不变。 |
| 10 / F-K/F-L/F-M/F-N | CLOSED | proposal §3/§5/§6/§7、design R3/D6、headless R3/S40：两种 key surface 均列 guide:210 #10、ledger enum Non-breaking refresh disclosure 先例、平台 adapter allowlist/proxy 条件与 consumer env minimisation bypass、完整 C7 §9.5 清单。 |
| 11 / F-P/F-Q/F-R/F-S | CLOSED | headless/D5/tasks 的 internal maxQueuedApiAgeMs constant/test seam；2c59664f 产品基线、S23/tasks 明确 git-show vendored old parser 直接执行；helper 仅 example；local S15 secret-first/Bearer fixture；runtime-core S36 keyed fixture。 |
| 12 | CLOSED | 本 change strict / all strict 54/54、diff check；Revision parent 与自查更新，STATUS 仅对应行改 DRAFT v3；单一本地指定提交，无 push。 |

| §2 P2 | Status | 对应 §3 编辑 |
| --- | --- | --- |
| F-A | CLOSED | 1 |
| F-B | CLOSED | 2 |
| F-C | CLOSED | 3 |
| F-D | CLOSED | 4 |
| F-E | CLOSED | 5 |
| F-F | CLOSED | 6 |
| F-G | CLOSED | 7 |
| F-H | CLOSED | 8 |

“CLOSED”只表示二审有界文字修补落实，不是实现、Owner APPROVED 或独立 reviewer verdict。F-F 按权威 §3.6 关闭为决策后强制 prune gate；当时 DRAFT 未擅替 Owner 选分支；现 Owner 已批准默认，本次按 1.6 prune，待独立 closure re-check，仍未获归档授权。无未按清单落实的编辑；F-U 是 REC、原位保留，无新动作。
不变项自查：D1 单核/owner、D3 ack/committed fact/TICKET-128、D4 reservation 同事务/unique/compensation/raw key never stored、D2 command shapes 与 wait 30 s/0–86400000/exit9-only、v1、R2 Owner decision、S01–S40 IDs、六项推荐默认；L1–L11、tasks 顺序和 8.7/8.8、DRAFT 状态、未来证据表均保留。Owner §4 六项当时按原文搬入并逐字比对。以上“不变项”描述为 v3 历史记录，当前状态/决策以本次 APPROVED 记录为准。
