# Verification

Status: **FINAL FROZEN CANDIDATE — 2026-10-02 (T4: the `76e8889d` T3 review findings closed); awaiting same-SHA Codex IMPLEMENTATION_VERIFIED + Claude REVIEW_APPROVED**

## Candidate

- Change: `add-local-job-api-async-submit` (Phase 3, second proposal).
- Candidate source SHA: the T4 record commit
  `docs(openspec): freeze the async submit T4 candidate` is the **final
  frozen candidate**, superseding the T3 candidate
  `76e8889d701dff8e6d08e201a706eaf7ee39bf6b` (itself superseding the
  documentation-closure candidate `37de7fce`). A commit cannot contain its own
  SHA; the exact value is recorded in the T4 handoff
  (`impl-async-submit-t4.report.md`) and resolves with
  `git log -1 --format=%H -- openspec/changes/add-local-job-api-async-submit/verification.md`.
  On the frozen branch this must equal `git rev-parse HEAD`, and its subject
  must match the subject above. T4 changed product code, so no verdict bound
  to `76e8889d`, `37de7fce`, `b7b408d1`, `887df155` or `e0a9a967` carries
  over; the `76e8889d` reviews (Claude design/probes CHANGES_REQUESTED: F1 P2,
  F2 P3; Claude security/C7 CHANGES_REQUESTED: P1-1, P3-1, P3-2) are the
  inputs T4 closes, as the `37de7fce` reviews were T3's.
- Worktree / branch: `/home/chen/projects/locus-add-local-job-api-async-submit-draft`,
  `codex/add-local-job-api-async-submit-draft`. Remote push, PR, merge, release
  and rules changes: not authorized, not performed.
- Product baseline: `2c59664f1b80a5f782eb05f82d33f718d9bc7053` (main after the
  canonical run event ledger archive `87eb6b01`). Owner APPROVED decisions
  bound to `0f998436`, recorded at `0447d02d`. Independent red suite
  `20e7bfcf` with ratified seams `8974c9ed`.
- Product code changed after `e0a9a967` in T2 (`cli-dispatcher.ts`,
  `run-submission.ts`, `local-job-api.ts`, `daemon.ts`, the published schema
  structure, one living schema test assertion and four implementer-unit test
  files) and in T3 (after `37de7fce`):
  `src/main/lib/headless/job-store.ts` (`5fa48189`, `29edbf39`),
  `local-job-api.ts` (`5fa48189`, `a90361ee`), `run-submission.ts`
  (`5fa48189`), `cli-dispatcher.ts` (`29edbf39`, `36dc9c12`, `a90361ee`),
  `daemon.ts` (`29edbf39`, `96dbc22d`, `36dc9c12`) and
  `scripts/check-architecture-guards.mjs` (`528f05d9`). T3 added five
  implementer-unit test files and one test-owned child fixture
  (`tests/fixtures/local-job-api-relay-arming/child.ts`) and retitled one T2
  test (`9f0fde7f`). T4 (after `76e8889d`) changed only
  `src/main/lib/headless/cli-dispatcher.ts` (`cb1e1e2a`, `3d1e73b3`) and
  added one implementer-unit test file and one test-owned child fixture
  (`tests/fixtures/local-job-api-relay-modes/child.ts`); no published-schema,
  migration or `drizzle` change.
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
| Phase III | `d37fa4e5` (guides), `d813b060` (schema), `4748aa73` (owner rows), `53bbc270` (proposal P3-1), `bbcc0995` (tasks), `887df155` (freeze) | `async-submit-phase3-check-887df155….md`: CHANGES_REQUESTED (1 P2 Windows relay overclaim, 6 P3) |
| T2 | `0e70e7d7` (relay SIGHUP/SIGBREAK), `39e3446d` (R4 docs), `674ab421` (own-pump read failure), `0d6b03da` (over-age tick diagnostics), `9f73d96e` (schema test, derived completion submit), `43354f87` (precedence, owner map, proposal text), `b63f9965` (tasks), `cfe73cf5` (re-freeze record, STATUS), `abb96416` (S35 timing disclosure), `b7b408d1` (T2 candidate pointer) | `async-submit-t2-review-b7b408d15d14fccd3a6f561405f6ae2c82c37e40.md`: READY_FOR_FINAL_REVIEW / REVIEW_APPROVED for T2 closure scope; 4 nonblocking P3 documentation/residual items |
| Final documentation closure | `37de7fce` | Codex R1 `async-submit-negotiation-r1-codex-37de7fce.md`: NOT_VERIFIED (P1-1 fresh ack re-read, P1-2 relay armed too late; A2/A8 PARTIAL); Claude `async-submit-final-review-design-correctness-37de7fce.md` CHANGES_REQUESTED (F1 P2, F2/F3 P3), `…-security-c7-37de7fce.md` CHANGES_REQUESTED (P1-1 disclosure, P3-1/P3-2), `…-tests-arch-37de7fce.md` REVIEW_APPROVED (4 P3) |
| T3 | `5fa48189` (fresh ack snapshot), `29edbf39` (halted ledger release, bounded own cancel and over-age tick), `96dbc22d` (dispatch backoff), `36dc9c12` (relay armed at admission), `a90361ee` (generic malformed-JSON diagnostic), `528f05d9` (guard detection), `9f0fde7f` (test title), `a30cdd6d` (guides), `e6842e5d` (proposal rows, design F3), `76e8889d` (T3 record) | Closes every 37de7fce finding (see Disclosures). `async-submit-t3-review-design-probes-76e8889d….md` CHANGES_REQUESTED (F1 P2 own-claim disarm swallowed a caught signal, F2 P3 unarmed pre-arm window); `async-submit-t3-review-security-c7-76e8889d….md` CHANGES_REQUESTED (P1-1 already-closed stdin armed EOF, P3-1 replay waiter relayed, P3-2 TICKET-127 text) |
| T4 | `cb1e1e2a` (already-closed stdin never arms EOF), `3d1e73b3` (relay armed before admission, mode switches instead of disarm, observe-only replay waiter), `e571d895` (guides), `d4a2cd1c` (TICKET-127), `f87eb937` (proposal R4 rows), T4 record commit (SHA resolves under Candidate) | Closes every 76e8889d finding (see Disclosures); final same-SHA dual verdicts pending |

Every P2 above is closed at `e0a9a967`: Phase I design P2-1 (retry error
baseline, `ac1e2f74`) and P2-2 (R4 relay race, `84c622ce`); Phase I security
P2-1 (claim-time gate before merge, `765b8ea6`); Phase II design P2-1 (admitted
queued cancel preparer, `5615e1f2`); Phase II security P2-1 (PR-base lint on
immutable files, `770c78ad`). The T1 review verified these closures with probes. The Phase III check P2-1
(Windows relay overclaim) is closed in T2 (`0e70e7d7`, `39e3446d`); its P3s
and the T1 review's P3-2/P3-3 are dispositioned under Disclosures.

## Gates

### T4 candidate gates

Run on `f87eb937` (the last T4 commit before this record; this record commit
changes only `verification.md`, `tasks.md` and `STATUS.md`) and re-run at the
T4 record commit; the exact-SHA results are in the T4 handoff.

| Gate | Command | Result |
| --- | --- | --- |
| Four red files | `bun test --isolate` over the four red files | 79 pass / 0 fail, 360 `expect()` calls |
| Relay files ×3 | `bun test --isolate` over the immutable S35 tests (`-t S35`) and `tests/local-job-api-wrapper-relay-*.test.ts`, three consecutive runs each | 3/3 runs green: S35 7 pass / 0 fail; relay files 17 pass / 2 skip (win32-gated) / 0 fail (`relay-modes` 10, `relay-arming` 2, `relay-signals` 4 + 2 skipped, `relay` 1) |
| Aggregate | `bun run check:full` | exit 0 (4 min 27 s): no changed files for lint:changed; both guard self-tests 17/17 and `Architecture guard passed.`; retired-runtime check passed; `tsc --noEmit` clean; 2904 pass / 2 skip / 0 fail, 14537 `expect()` calls, 2906 tests in 367 files (the 2 skips are the win32-gated relay tests); strict 54/54; build succeeded; diff:check clean |
| PR-base lint | `BIOME_CHANGED_SINCE=2c59664f node scripts/run-biome-changed.mjs` | exit 0 |
| Lint ratchet | `git diff 2c59664f <candidate> -- lint-baseline.json` | only deletions, unchanged by T4: `daemon.ts: 2`, `job-store.ts: 1`, `trpc/routers/agent-jobs.ts: 1` |
| Architecture baselines | `scripts/architecture-baselines.json` | 0-line diff vs `2c59664f`; `reachThroughWrappers` unchanged |
| Immutable set | `git diff --stat 770c78ad <candidate> -- <4 red tests, 4 kits, tests/fixtures/local-job-api-async, red-receipt.md>` | empty |
| Whitespace | `git diff --check 2c59664f <candidate>` | exit 0 |
| Reverted-fix check | `tests/local-job-api-wrapper-relay-modes.test.ts` against the `cli-dispatcher.ts` of `76e8889d` and of `cb1e1e2a` | `76e8889d`: 9 of 10 fail (only the open-pipe-closed-later control passes); `cb1e1e2a` (stdin fix only): the 4 stdin tests pass, the 6 own-claim / admission / replay tests fail; T4 candidate: 10/10 pass |

### T3 candidate gates (historical, `76e8889d`)

Run on `e6842e5d` (the last T3 commit before its record) and re-run at the
T3 record commit `76e8889d`; the exact-SHA results are in the T3 handoff.

| Gate | Command | Result |
| --- | --- | --- |
| Four red files | `bun test --isolate` over the four red files | 79 pass / 0 fail, 360 `expect()` calls |
| Aggregate | `bun run check:full` | exit 0 (4 min 28 s): no changed files for lint:changed; both guard self-tests 17/17 and `Architecture guard passed.`; retired-runtime check passed; `tsc --noEmit` clean; 2894 pass / 2 skip / 0 fail, 14527 `expect()` calls, 2896 tests in 366 files (the 2 skips are the win32-gated relay tests); strict 54/54; build succeeded; diff:check clean |
| PR-base lint | `BIOME_CHANGED_SINCE=2c59664f node scripts/run-biome-changed.mjs` | exit 0 |
| Lint ratchet | `git diff 2c59664f <candidate> -- lint-baseline.json` | only deletions, unchanged by T3: `daemon.ts: 2`, `job-store.ts: 1`, `trpc/routers/agent-jobs.ts: 1` |
| Architecture baselines | `scripts/architecture-baselines.json` | 0-line diff vs `2c59664f`; `reachThroughWrappers` unchanged |
| Immutable set | `git diff --stat 770c78ad <candidate> -- <4 red tests, 4 kits, tests/fixtures/local-job-api-async, red-receipt.md>` | empty |
| Whitespace | `git diff --check` | exit 0 |

Historical implementation gates on the T2 tree, ending at
`b7b408d15d14fccd3a6f561405f6ae2c82c37e40`. Every gate below ran on `b63f9965` (the last
code/test commit; later commits change only this record, `STATUS.md`,
`tasks.md` and `proposal.md` status lines) and was re-run on the T2 tip
`b7b408d1`; the counts are identical (T2 handoff report). One intermediate
`check:full` run on `cfe73cf5` failed one red-file test under full-suite load
and passed on rerun; see the S35 timing disclosure below.

| Gate | Command | Result |
| --- | --- | --- |
| Four red files | `bun test --isolate tests/local-job-api-async-submit-wait.test.ts tests/local-job-api-async-idempotency.test.ts tests/local-job-api-async-executor.test.ts tests/local-job-api-async-guards-protocol.test.ts` | 79 pass / 0 fail, 360 `expect()` calls, 4 files |
| Full suite | `bun run test` (inside `check:full`) | 2882 pass / 2 skip / 0 fail, 14515 `expect()` calls, 2884 tests in 361 files; the 2 skips are the win32-gated `SIGBREAK`/`SIGHUP` relay tests |
| Aggregate | `bun run check:full` (lint:changed, architecture guard, retired-runtime, tsc, tests, `spec:validate`, build, diff:check) | exit 0 (4 min 17 s): no changed files for lint:changed; both guard self-tests 17/17; retired-runtime check passed (1816 files, 10 allowlisted); `tsc --noEmit` clean; 2882 pass / 2 skip; strict 54/54; `electron-vite build` succeeded; diff:check clean |
| Architecture guard | `bun run architecture:check` | Both `17/17 fixture cases matched; repository ownership enforced.` lines (run event ledger, local job API async submission); `Architecture guard passed.` |
| PR-base lint | `BIOME_CHANGED_SINCE=2c59664f node scripts/run-biome-changed.mjs` | exit 0 |
| Lint ratchet | `git diff 2c59664f <candidate> -- lint-baseline.json` | only deletions: `daemon.ts: 2`, `job-store.ts: 1`, `trpc/routers/agent-jobs.ts: 1` (unchanged by T2) |
| Architecture baselines | `scripts/architecture-baselines.json` | 0-line diff vs `2c59664f`; `reachThroughWrappers` sha256 prefix `3ae7f081d3b64e48` at `2c59664f`, `e0a9a967` and the T2 candidate |
| Strict OpenSpec | `openspec validate --all --strict --no-interactive` | 54 passed, 0 failed |
| Whitespace | `git diff --check` and `node scripts/check-patch-whitespace.mjs` | exit 0 |
| Immutable set | `git diff --stat 770c78ad <candidate> -- <4 red tests, 4 kits, tests/fixtures/local-job-api-async, red-receipt.md>` | empty |
| T2 product scope | `git diff --stat e0a9a967 <candidate> -- src tests scripts drizzle` | `cli-dispatcher.ts`, `run-submission.ts`, `local-job-api.ts`, `daemon.ts`, `tests/local-job-api-schema.test.ts` and the four new implementer-unit files only; no `scripts`/`drizzle` change |
| Schema conformance | `bun test --isolate tests/local-job-api-async-schema-envelopes.test.ts` (committed in T2; replaces the Phase III throwaway probe) | Ajv 2020 against the published schema: emitted fresh/keyed-replay submit (agent and completion), status with `execution`, wait timeout, wait `observation_failed`, wait-ready and create (`createResponseEnvelope`), keyed `retry --async` and its replay, and the stdout errors `idempotency_key_not_supported`, `invalid_idempotency_key`, `idempotency_conflict`, `consumer_mismatch` all valid; keyed agent/completion bodies valid for `submitRequest` and rejected by `createRequest`; unknown members rejected by `completionSubmitRequest`/`completionCreateRequest`/`retryRequest`. `submission_pending` and `secret_in_request` are not emitted by this file; their behavior is asserted by the idempotency red file, but their envelopes are not schema-validated by a committed test. `completionSubmitRequest` now derives from `completionRequestMembers` (`allOf` + `unevaluatedProperties: false`), shared with `completionCreateRequest`, so the two member sets cannot drift; validation of `completionCreateRequest` is unchanged. |

### Final documentation closure checks (`37de7fce`)

Run on the documentation-closure worktree before the single freeze commit;
these checks are distinct from the historical T2 implementation gates above.
Exact-SHA post-commit gate results are recorded in this dispatch's final
handoff, without a second documentation commit.

| Check | Command | Result / local log |
| --- | --- | --- |
| Strict OpenSpec | `/home/chen/projects/agent-code-for-me/node_modules/.bin/openspec validate --all --strict --no-interactive` | exit 0; `Totals: 54 passed, 0 failed (54 items)`; `/tmp/async-submit-doc-closure-validate.log` |
| Whitespace | `git diff --check` | exit 0, empty output; `/tmp/async-submit-doc-closure-diff-check.log` |
| PR-base lint | `BIOME_CHANGED_SINCE=2c59664f node scripts/run-biome-changed.mjs` | exit 0; `Biome reported diagnostics only outside changed lines; ignoring legacy file diagnostics.`; `/tmp/async-submit-doc-closure-lint.log` |
| T2 P3-4 format probe | `node_modules/.bin/biome check --stdin-file-path=tests/local-job-api-schema.test.ts` with the old wrap on stdin; `biome format` with the same path | old-wrap check exit 1; formatter restores the retained `baseRequest` wrap. Test unchanged; `/tmp/async-submit-schema-format-probe.log` |

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
| S01 | [local-job-api](specs/local-job-api/spec.md) | Submit returns before execution is released | `submit-wait` — submit acks one queued admission with a committed job_created before any dispatch, and a later claim is visible only through status (pass)<br>`local-job-api-submit-ack-snapshot.test.ts` — a claim between admission and the fresh submit ack still prints the queued admission snapshot (run-dir admission / no run dir) (implementer-unit, T3, pass) | pass |
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
| S35 | [local-job-api](specs/local-job-api/spec.md) | Aborting a wrapper applies the chosen cancel policy | `submit-wait` — own-pump wrapper keeps the 2c59664f process-tree receipts for SIGINT/SIGTERM/SIGKILL and stdin EOF (pass)<br>`submit-wait` — daemon-first SIGINT relays one cancel for the admitted ID only, waits at most 5000 ms for the ack and re-raises SIGINT (pass)<br>`submit-wait` — daemon-first SIGTERM relays one cancel for the admitted ID only, waits at most 5000 ms for the ack and re-raises SIGTERM (pass)<br>`submit-wait` — SIGKILL of a daemon-backed waiter relays nothing and leaves the Run running and queryable (pass)<br>`submit-wait` — closing a stdin pipe that was open at admission relays the own cancel and exits 8 without a terminal envelope (pass)<br>`submit-wait` — ignored stdin and a --request - body EOF consumed before admission arm no EOF cancel and the Run continues (pass)<br>`submit-wait` — Career Kit SIGTERM then SIGKILL after 500 ms truncates the ack wait without undoing the persisted cancel request (pass)<br>`local-job-api-wrapper-relay-arming.test.ts` — daemon-first SIGTERM before the own claim attempt and SIGTERM before any claim (implementer-unit, T3, pass)<br>`local-job-api-wrapper-relay-modes.test.ts` — already-closed stdin (Node `execFileSync` without input; `end()` right after spawn; own-pump and daemon-first) never arms EOF, an open pipe closed later relays; SIGTERM during the own claim takes the baseline default disposition; SIGTERM during admission cancels the queued own Run, or is re-raised when admission fails; a keyed sync replay waiter never cancels the retained child (implementer-unit, T4, pass) | pass |
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
| `tests/local-job-api-wrapper-relay-signals.test.ts` (T2) | 6 (2 skipped off win32) | Phase III check P2-1: platform signal set; POSIX `SIGHUP` relay in-process and real-process (re-raised `SIGHUP`, own cancel only, ≤5 s); win32 `SIGBREAK`/`SIGHUP` relay (platform-gated); exit 8 when the re-raise cannot be performed |
| `tests/local-job-api-wrapper-observation-fault.test.ts` (T2) | 3 | Phase III check P3-1: own-pump create/retry store-read failure stops the own tree, stderr `database is locked`, exit 2/3, no stdout, Run settles `canceled`; daemon-first control keeps `observation_failed`/8 |
| `tests/local-job-api-over-age-tick-diagnostics.test.ts` (T2) | 3 | T1 P3-2: non-race settlement error reported with a sanitized code and excluded; claim race silent; daemon writes one `[Daemon]` diagnostic and still settles younger over-age runs |
| `tests/local-job-api-async-schema-envelopes.test.ts` (T2) | 8 | Phase III check P3-5: Ajv 2020 conformance of emitted envelopes and request bodies; derived completion submit member set |
| `tests/local-job-api-submit-ack-snapshot.test.ts` (T3) | 2 | Codex R1 P1-1: a real claim on a second connection between the completed admission and the ack (with and without a run dir) still prints the queued snapshot (no worker fields, exit 0) while the store holds `job_started` |
| `tests/local-job-api-claim-append-failure.test.ts` (T3) | 4 | Design F1/F2: an always-failing `job_started` append makes own-pump create/retry report one stderr line with exit 2/3, no stdout, Run `canceled`, bounded; a daemon still settles that Run `queued_age_exceeded` when it ages out and stops on abort; a Run whose claim append failed three times is retried with backoff and succeeds once |
| `tests/local-job-api-wrapper-relay-arming.test.ts` (T3, POSIX) | 2 | Codex R1 P1-2: real processes held in the former unarmed window by the `beforeOwnPumpClaim` seam; SIGTERM after a daemon claim relays one cancel (Run `canceled` by the claimant) and re-raises SIGTERM within the ack bound; SIGTERM before any claim cancels the own queued Run (never started) and re-raises SIGTERM |
| `tests/local-job-api-wrapper-relay-modes.test.ts` (T4, POSIX) | 10 | 76e8889d security P1-1 / P3-1 and design-probes F1 / F2, real processes with the test-owned child `tests/fixtures/local-job-api-relay-modes/child.ts` (store hook that self-signals at a chosen `agent_job_events` append; `beforeOwnPumpClaim` hold/claim seam): stdin closed before the command started (Node `execFileSync` without input; `end()` right after spawn) never cancels an own-pump create held 300 ms or a daemon-first create, while an open pipe closed after arming relays (exit 8, Run `canceled`); SIGTERM at the own `job_started` append ends the wrapper by SIGTERM with the Run `running` under the own `headless` worker and recovery settling the S35 baseline `interrupted`; SIGTERM at the `job_created` / `artifact_created` append cancels the queued own Run (0 `job_started`) and re-raises SIGTERM; with an unwritable artifact base dir the held SIGTERM is re-raised after the `failed` / `artifact_admission_failed` admission; a keyed sync retry replay waiter (retained child running under another executor, or still queued) ends by SIGTERM, ignores a closed stdin and never cancels the child |
| `tests/local-job-api-malformed-request-diagnostic.test.ts` (T3) | 3 | Security P3-1: malformed `runs submit` / `runs retry --request` bodies print `Invalid JSON request`, exit 2, no request text; `runs create` keeps the parser-message diagnostic |
| `tests/local-job-api-async-guard-detection.test.ts` (T3) | 1 | Tests/static P3-1: the frozen 17 cases plus seven test-owned cases (nested or method `runCommand`, top-level permitted caller, destructured and declared re-binding, element-access insert, new headless module) match exactly |

Existing-test churn: `tests/run-event-ledger-terminal-commit-faults.test.ts`
moved `artifactManifestPath` to after the claim because of the D3 admission
predicate (Phase I, `0bbaa549`); no `expect` changed (Phase I security P3-1).
`tests/helpers/agent-job-test-db.ts` mirrors the 0025 table. T2 changed one
assertion block of `tests/local-job-api-schema.test.ts`: the completion
`required`/`properties` checks read `completionRequestMembers`, and
`additionalProperties: false` became `allOf` + `unevaluatedProperties: false`
(same accepted set). T2 also retained the formatter-only wrap at lines
229–232: a post-T2 probe of the old `expect(validate(baseRequest), ...)` wrap
with the repository's Biome configuration returns exit 1, and `biome format`
restores exactly the retained wrap. The final documentation closure therefore
keeps it; the test file has no diff against `b7b408d1`. No other existing test
changed in T2.

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
| S35 | Windows matrix; POSIX process-group kill with real grandchildren | host-blocked (no Windows host); POSIX single-process receipts covered, POSIX `SIGHUP` relay covered in T2, signals before the own claim covered in T3; already-closed stdin, the own-claim and admission windows and the replay waiter covered in T4; the win32 `SIGBREAK`/`SIGHUP` relay tests exist but skip on this Linux host |
| S37 / S39 | create/default-retry wrapper paused after admission (`beforeOwnPumpClaim`) | open as tests for S37/S39 themselves; the Phase II design review probed the wrapper-paused unregister case (exit 7) on the same gate, and T3's relay-arming tests pause the wrapper there for S35 |
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
| Retry body | Only `apiVersion`, `consumer.id`, `idempotencyKey`; other members → plain-text stderr, exit 2; malformed JSON → stderr `Invalid JSON request`, exit 2 (T3; `runs submit` likewise; `runs create` keeps the parser-message diagnostic); `consumer_mismatch` before key lookup. |
| Fresh ack snapshot | `insertQueuedAgentJobRow` returns the row read inside its insertion transaction; `createAgentJob`, `retryAgentJob`, the API admission adapters and `submitRun` return that row without re-reading it. `job_created` and the initial run-dir `artifact_created` commit events only and mutate no job column, so it is exactly the queued row of the completed admission (T3, Codex R1 P1-1). Replays (`resolveReservation`) read the current state. |
| Retention | One `UPDATE agent_job_idempotency SET expires_at` through `recordVerifiedRunRetention` after verified publication (pump, queued cancel) or at settlement for an empty terminal set (recovery, admission failure, claim-gate and over-age settlements). Cleanup is a `DELETE`, run by `submitRun` for the consumer before every submit, create and retry (keyed or not) and by every daemon loop iteration, including `--once`. |
| Admission keys | Initial admission observation key `lifecycle:initial-artifacts:<id>` (fact `:0`); claim errors `MISSING_JOB_CREATED`, `MISSING_INITIAL_ADMISSION`, `CLAIM_LOST`. A run-dir or admission failure after the creation commit settles `failed` / `artifact_admission_failed` through the host and keeps the attempt and key. |
| Worker identity | Unique per claim: `<kind>:<pid>:<ms>:<createId>:<jobId>`, where `kind` is `daemon` for daemon claims and the runner's own prefix otherwise (`headless`, `completion`; protocol sessions keep `protocol:`). Two pumps in one process otherwise produced identical `job_started` fact keys (found by S28). Opaque; the guides disclose the format change. |
| Pump | `pumpQueuedRuns` is a one-line export over the internal `runPumpPass`, which the daemon loop also calls, so external scoped callers stay observable. Slots daemon → schedule → api; `api` only when the daemon holds a lock (`apiCapable: lock !== null`); a direct unscoped `pumpQueuedRuns` call defaults to API-capable (executor tests). |
| Lock v2 | Refreshed every 500 ms and on each loop iteration by temp file + rename; the writer stops on a foreign nonce. Freshness 0–5000 ms; running-worker evidence uses the existing 120 s recovery window. |
| Wrapper wait | 100 ms polls on `monotonicClock`; own-pump runs exempt from the no-progress window while the dispatch promise is pending; daemon-first no-progress window 30 s with reason `executor_unavailable` when the observation is unavailable, otherwise `executor_unknown` (including a queued run with an available daemon that never claims it); publication bound 30 s after `completed`. |
| R4 relay | Armed signals = `daemonFirstRelaySignals(process.platform)`: `SIGINT`, `SIGTERM`, `SIGHUP` on POSIX, plus `SIGBREAK` on win32 (T2 P2-1). T4: `admitUnderWrapperRelay` installs the listeners once, before `submitRun`, and removes them only in its `finally`; every later change is a mode switch, so a signal libuv already caught is always dispatched to a live handler. Modes: **pending** (admission running, ID unknown) holds the first signal or armed EOF (a signal outranks a held EOF); after admission the wrapper yields past a poll phase (two `setImmediate` turns) so an abort caught during an admission that never turned the event loop is dispatched before the own pump can claim. **owner** (ID known, before the own claim: queued, or claimed by another executor) — a held or new abort stops the own pump attempt (abort signal) and wait, persists one cancel of the own ID through `cancelAgentJob` (a queued Run settles canceled; a claimed Run gets its cancel request), polls up to 5000 ms in total for a terminal, waits for the stopped own pump within the same bound, then re-raises the signal (1 s fallback if a foreign handler keeps the process alive; exit 8 when the runtime cannot raise it, i.e. Windows `SIGBREAK`/`SIGHUP`) or exits 8 on EOF, with no stdout. **own-claimed** (the canonical pump's `claimObserver.claimed`, or a handler that finds the committed row `workerId` equal to the own worker reported by `claimObserver.attempting`) and **observe-only** (admission threw, or `admitted.replay` — a keyed sync retry waiter does not own the retained Run) — the handlers stay installed, remove the relay's listeners and re-raise with the default disposition (the `2c59664f` disposition of a local execution); a signal held in pending is re-raised at the switch; EOF is ignored and stdin is paused. EOF arming (T4): only when `stdin` is `process.stdin`, fd 0 is a FIFO or socket, the request was not read from stdin and the stdin probe (read started, yield past a poll phase; win32 adds a 50 ms timer) saw no EOF — a stdin already closed when the command starts is never armed. Precise boundary: a signal caught in the synchronous stretch right before the own claim commit is dispatched after the claim and takes the own-claimed default disposition (the Run is left for recovery, as at `2c59664f`). |
| Completion heartbeat | Every 15 s during the single upstream call (closure residual 1). |
| Claim gate | `RunClaimGate` after the conditional claim, before provider resolution: project → cwd identity → stored profile/capability/grant → explicit provider profile → queued age → run-dir reopen; completion runs skip project, cwd and reopen. Failures settle `host_result` failed with optional `reasons` prepended to the ledger failures; an unexpected gate exception → `claim_gate_failed` / `internal_error` / 8. Missing or malformed stored identity → `cwd_identity_changed` (`74e30df9`). The gate handle closes in an outer `finally` (`27cbcdad`). |
| Stored identity | `inputJson.submissionContext.projectIdentity = {canonicalPath, dev, ino}` with decimal-string dev/ino from a bigint stat; retry re-captures it; never serialized or written to `request.json`. |
| Staging | `.<final>.locus-staged-<pid>-<uuid per prepare()>`, exclusive create; discard removes only the preparer's own receipts. |
| Queued cancel | `openQueuedCancelLocalJobApiTerminal` returns a preparer only for a queued, admitted `source=api` agent run whose project, cwd identity and planned run dir still revalidate; it shares the private reopen helper with the claim gate and is passed to `cancelAgentJob` as `queuedTerminalProjection` by every API cancel host (CLI `runs cancel`, `jobs cancel`, the R4 relay, own-dispatch cleanup, tRPC `agentJobs.cancel`). jobs-stdio cancel is unchanged (protocol runs only). |
| Over-age tick | `settleOverAgeQueuedLocalJobApiRuns` every daemon loop iteration (with or without a lock), after idempotency cleanup and before schedules and pump; oldest first, at most 16 per iteration, admitted runs with `createdAt <= now - maxQueuedApiAgeMs`, through `settleQueuedAgentJobFailed(..., {requireUnclaimed})` so a concurrent claimant wins. A non-race settlement error yields one sanitized `[Daemon]` diagnostic and excludes the id for the rest of that daemon's life (T2). T3: the tick waits for the pass at most `OVER_AGE_TICK_WAIT_MS` (5000 ms) and starts no second pass while one is pending; a failed pass writes one `[Daemon]` line and is retried on a later tick. |
| Failed dispatch (T3) | `startAgentJob` releases the cached ledger when the `job_started` append fails without a competing claim (the ledger is halted on that observation), so later cancels and settlements on the same handle recompose a ledger (design F1). The daemon retries a Run whose dispatch failed with a non-outcome error while it stays queued, after `DAEMON_DISPATCH_RETRY_BASE_MS` (1 s) doubling per failure up to `DAEMON_DISPATCH_RETRY_MAX_MS` (60 s); a `--once` pass still stops when only failed Runs remain (design F2). The wrapper's own queued cancel after `own_dispatch_failed` / `own_observation_failed` waits at most 5000 ms. |
| Retry errors | `apiRetryError` keeps the `2c59664f` retry catch (provider-binding → stdout envelope, everything else → stderr exit 3) plus the new request errors; `apiCreateError` keeps the create catch. The retry status check stays inside `retryAgentJob`, after the gates. |
| Protocol | `SubmitRunIntent` gains `{kind:"protocol-run"}` (no key, no artifacts); protocol claims keep the `protocol:` worker prefix. |

## Disclosures

Open P3 findings and accepted residuals at the candidate. None blocks; each
is either documented for consumers or recorded here for a follow-up.

| Source | Item | Disposition |
| --- | --- | --- |
| Phase I design P3-2 / 37de7fce security P1-1 | D3 moves mkdir after the creation commit; a run-dir or admission failure leaves a durable `failed` / `artifact_admission_failed` job, also for old-request `runs create` and default `runs retry` (stderr/exit unchanged), binds a submit key to that attempt, checks the retry source status before mkdir, and hits every artifact-bearing attempt on Windows until TICKET-127 | T3: proposal §3 row "admission failure after creation commit" (C7 #4/#5/#10; not a new Red: the behavior is the approved D3 order, Owner 2026-10-02 bound to `0f998436`); the "六个" sentence and C7 #4/#5/#10 name it; both guides gain "Admission failure after creation" besides Claim-time checks and Known limits. T4 (`d4a2cd1c`, 76e8889d security P3-2): TICKET-127 now states the D3 reality (every artifact-bearing Windows attempt leaves a `failed` / `artifact_admission_failed` row, with current line references); TICKET-128 text unchanged. |
| Phase I design P3-3 | `readRunPublicationReadiness` re-hashes every terminal ref on each 100 ms poll; no SYN-25 stat/identity cache | Open (tasks 3.3). Cost only; correctness unaffected. |
| Phase I design P3-4 | Lock heartbeat nonce check and `renameSync` are not atomic together | Open; reachable only when a successor took over a lock whose writer looked dead. |
| Phase I design P3-5 / 37de7fce security P3-2 | `job.workerId` value format gained a per-claim unique segment (`<kind>:<pid>:<ms>:<unique>:<jobId>`) | Kept: the segment keeps the `job_started` fact keys of two pumps in one process distinct (S28 double-claim fix), so the baseline format is not restored. T3: proposal §3 workerId row now states the value-format change (opaque string, #3/#10 disclosure, not Red); both guides show both formats and say not to parse it. |
| Phase I security P3-1 | `run-event-ledger-terminal-commit-faults` fixture churn | Recorded above; no assertion changed. |
| Phase I security P3-2 / 37de7fce security P3-1 | Malformed JSON bodies on `submit` / `retry --request` echoed parser text (and so a fragment of the input) on stderr | Closed in T3 (`a90361ee`): those commands print `Invalid JSON request`; `runs create` keeps its 2c59664f diagnostic (baseline bytes; create rejects keys after parsing, so a malformed create body can still echo its own text, as before). Both guides document it. |
| Phase I security P3-3 | Lock heartbeat temp file written non-exclusively | Open; same-user actor only. |
| Phase II security P3-2 / 37de7fce tests-static P3-1/P3-2 | Async guard detection gaps: assignment aliases, `.call`/`.apply`, raw SQL; also ancestor-name permitted-caller match, `schema["agentJobs"]`, the closed `nonExecutingFiles` list, destructured re-binding, and two doc-only OWNERSHIP pins | T3 (`528f05d9`): permitted caller only as the outermost top-level function; declared and destructured re-bindings followed; element-access insert targets matched; every `src/main/lib/headless` file except the execution owners (`daemon.ts`, `job-runner.ts`, `completion-runner.ts`, `job-store.ts`) scanned; every OWNERSHIP pin must name a defined export. Remaining limits disclosed in the guard comment: later assignment re-binding, `.call`/`.apply`/`Reflect.apply`, non-literal computed keys, cross-module re-binding, raw SQL. Pinned by `tests/local-job-api-async-guard-detection.test.ts`; the frozen fixture is unchanged. |
| Phase II security P3-4 | Unscoped direct `pumpQueuedRuns` defaults to API-capable | Record only; the only production caller passes `apiCapable: lock !== null`. |
| T1 P3-2 | The over-age tick swallowed every settlement error silently; 16 or more persistently failing over-age runs would block younger ones in that bound | Closed in T2: only `JOB_PRECONDITION_FAILED` or a re-read showing the run claimed/terminal is silent; any other error writes `[Daemon] Over-age job <id> was not settled (<CODE>); not retried by this daemon.` (sanitized code, no error text) and the daemon excludes that id on later ticks (`tests/local-job-api-over-age-tick-diagnostics.test.ts`). |
| T1 P3-3 / Phase III check P3-2 / T2 P3-2 | Tick vs claim precedence: an over-age and unregistered run settles `queued_age_exceeded` / 1 on a daemon tick but `project_unregistered` / 7 if a claim reaches it first (the claim gate checks project → cwd → profile → age) | Disclosed in both guides (Claim-time checks): the tick settles age only and runs before the pump in each daemon iteration, so a daemon reports `queued_age_exceeded` for a run already over age when the iteration started, unless it is beyond that iteration's 16-run settlement limit, or the daemon has reported that it could not settle the run and excluded it; a run crossing the age bound between tick and claim, or claimed by another executor, gets the claim gate's order. Not a contract violation ("claim/tick SHALL fail closed"). |
| Daemon tick cadence | The over-age settlement runs every loop iteration, also in a lock-less daemon (settling is not claiming), at most 16 per iteration | Implementation judgement (T1); documented to consumers as "a bounded number per loop iteration". |
| projectIdentity fail-closed | API agent rows admitted by unreleased builds between `d59b1142` and `765b8ea6` lack the stored identity and now fail closed with `cwd_identity_changed` / 7 | Intended (Phase II security P3-1); no released build wrote such rows. |
| R1 (accepted) | Daemon-first `wait.state:"error"` / 8 branches and the local publish-failure `artifacts:[]` baseline | Documented in both guides. |
| R3 (accepted) | Daemon-claimed runs use the daemon's environment and native credential homes | Documented in both guides. |
| R4 (accepted) | `SIGKILL`, Windows `TerminateProcess` / `child.kill()` and the logoff/shutdown console events (libuv does not deliver them) cannot relay; 500 ms kill grace and the Windows console-close grace truncate the 5 s ack; Windows exits after a relayed signal (Ctrl+C → 1, Ctrl+Break / console close → 8) not verified on Windows (closure residual 3) | Documented in both guides; Windows host-blocked. The win32 `SIGBREAK`/`SIGHUP` tests in `tests/local-job-api-wrapper-relay-signals.test.ts` are platform-gated and skipped on this Linux host. |
| Windows relay host evidence | Windows SIGBREAK/SIGHUP behavior and exit codes have not been verified on a Windows host | host-blocked; Windows SIGBREAK/SIGHUP 行为与退出码未在 Windows 宿主验证。Platform-gated skips and POSIX receipts are not Windows host evidence. |
| S35 timing (T2 observation / T2 P3-1 / 37de7fce tests-static P3-3) | Observed rate: one failure of the immutable "Career Kit SIGTERM then SIGKILL" S35 test in four T2 full-suite runs, and the first exact-SHA `check:full` at `37de7fce` (documentation-closure dispatch) was red once with the same test (2881 pass / 1 fail) while the coordinator's rerun at that SHA passed (2882 / 0): at least 2 failures across about 6 full runs. Cause: the harness sends `SIGTERM` as soon as the child prints `CLAIMED` from inside the `beforeOwnPumpClaim` seam, while the wrapper armed its relay only after the seam returned and it read the Run as claimed by another executor (the same window as Codex R1 P1-2). Task 8.2's earlier tick rested on T2-candidate evidence. | Closed in T3 (`36dc9c12`): the relay is armed at admission, before the seam, so a catchable signal in that window is relayed; `tests/local-job-api-wrapper-relay-arming.test.ts` holds the wrapper in the window deterministically. The T3 residual statement ("only uncatchable terminations") was inaccurate at `76e8889d` (design-probes F1/F2: the own-claim disarm dropped a caught signal, and the ~2 ms before the arm was unrelayed); T4 (`3d1e73b3`) closes both. Residual at the T4 candidate: only uncatchable terminations (`SIGKILL`, Windows `TerminateProcess` / `child.kill()`, logoff/shutdown console events) and the 500 ms kill grace truncating the 5 s ack wait; a catchable signal is never lost — it relays when dispatched before the own claim and otherwise takes the own-pump default disposition. Both guides keep cancel-by-ID advice. The T4 `check:full` runs are recorded under Gates and in the T4 handoff. |
| Phase III check P3-1 | A wrapper store-read failure returned `observation_failed`/8 even while its own pump ran the Run | Closed in T2 (`674ab421`): with a pending or completed own dispatch the wrapper aborts its own pump (the runner's abort signal stops the runtime tree), closes a never-started Run by queued cancel and keeps the baseline stderr/exit (create 2, retry 3); the stopped Run settles `canceled` when the store allows it, otherwise it stays for recovery. Only a remote claimant gets `observation_failed`/8. Both guides state the split. |
| Phase III check P3-3 | Tasks 7.2, 7.3, 7.4, 7.6, 7.7, 7.9, 7.10 were ticked with open sub-clauses | T2 (`b63f9965`): unticked and marked PARTIAL with the open sub-clauses listed; tasks.md states the rule. |
| Phase III check P3-4 | Task 1.6 receipt (post-prune closure re-check) missing | Coordinator accepted (2026-10-02): the post-prune re-check is covered by the `887df155` docs/C7 closure check and the `b7b408d1` T2 review, both after the `0447d02d` prune; deemed satisfied and task 1.6 checked. `25575cc3`/`abec16a5` predate prune and remain historical evidence only. Owner approval stays bound to `0f998436`. |
| Phase III check P3-5 / T2 P3-3 | Schema additions had no committed test; `completionSubmitRequest` copied the completion members | Closed in T2 (`9f73d96e`). The restructure of `completionCreateRequest` (`allOf` over `completionRequestMembers` + `unevaluatedProperties: false`) accepts exactly the same documents with a JSON Schema 2020-12 validator; a consumer that inspects the schema's structure sees the members under the new def. Both guides' async-submit schema-refresh instructions now require a 2020-12 validator and name the shared members def and the create/submit derivation. |
| Phase III check P3-6 | Proposal example messages and the OWNERSHIP_MAP readiness callers drifted from the code | Closed in T2 (`43354f87`); the Gates record now names one candidate tree. |
| Phase III check P2-1 | The relay armed only `SIGINT`/`SIGTERM` while the docs promised Windows console Ctrl events | Closed in T2: `SIGHUP` (POSIX, win32 console close) and `SIGBREAK` (win32 Ctrl+Break) armed; spec delta, design R4, proposal and both guides name the exact set. The immutable fixture `controls.json#S35.windowsMatrix` still says "console Ctrl events"; it is unexecuted documentation of the win32 harness and is superseded by the spec table. |
| Codex R1 P1-1 (37de7fce) | A legitimate claim between admission and the fresh `runs submit` ack printed `running` with a `workerId` (design D2 fixed queued snapshot violated) | Closed in T3 (`5fa48189`); see Implementation decisions "Fresh ack snapshot" and `tests/local-job-api-submit-ack-snapshot.test.ts`. Codex A2 PARTIAL (job-store.ts:433 re-read, :459 compensation, run-submission.ts:289) closes with it: the re-reads are gone and the compensation path is unchanged. |
| Codex R1 P1-2 (37de7fce) | The R4 relay was armed only after the own pump lost the claim; a catchable signal in between took the default disposition with no relayed cancel | Closed in T3 (`36dc9c12`); see Implementation decisions "R4 relay". Codex A8 PARTIAL closes with it; its R3 part was already AGREE: `adapters/codex.ts:77-91` (`buildCodexEnv`, unchanged since `2c59664f`) builds the child env from the executing process (daemon or wrapper) through the existing allowlist and secret stripping, and nothing persists an env snapshot. |
| Design F1 (37de7fce, P2) | A failed claim append left the cached ledger halted: the wrapper hung in its own queued cancel, and a daemon wedged at that Run's over-age settlement while advertising `available` | Closed in T3 (`29edbf39`); see Implementation decisions "Failed dispatch" and "Over-age tick"; `tests/local-job-api-claim-append-failure.test.ts`. |
| Design F2 (37de7fce, P3) | A transient claim failure excluded the Run from the daemon for its lifetime | Closed in T3 (`96dbc22d`): retry with backoff while queued. The over-age tick's own exclusion of Runs it cannot settle (T2) is unchanged and still disclosed. |
| Design F3 (37de7fce, P3) | design.md said the wrapper calls the recovery owner at the end of its observation window | Closed in T3 (`e6842e5d`): design D5 now says recovery runs from the CLI prologue and daemon start, as implemented. |
| Tests/static P3-4 (37de7fce) | The simulated re-raise relay test title read like Windows evidence | Closed in T3 (`9f0fde7f`): retitled "simulated on this host …". |
| Security P1-1 (76e8889d) | An already-closed stdin pipe (Node `execFileSync`/`spawnSync` without input, `child.stdin.end()` right after spawn) armed the EOF relay, which then cancelled daemon-first creates, keyed sync replays and (with any I/O gap) the own-pump pre-claim window — contrary to S35 and design R4 :143 | Closed in T4 (`cb1e1e2a`): the stdin probe (read started, yield past a poll phase) classifies an EOF seen at arming as already closed and does not arm. A non-blocking `read(0)` peek was rejected: under Bun fd 0 stays blocking, so the peek blocks on an open pipe. Both guides state "a stdin already closed when the command starts does not arm the EOF relay". `tests/local-job-api-wrapper-relay-modes.test.ts` (closed-stdin and open-pipe tests). |
| Design-probes F1 (76e8889d, P2) | The relay removed its listeners at the own claim, so a signal libuv had caught but not yet dispatched (~25 ms span) was swallowed and the Run executed to completion | Closed in T4 (`3d1e73b3`): own-claimed is a mode of a still-installed relay that re-raises with the default disposition; listeners are removed only when the command ends. Regression: SIGTERM delivered synchronously at the own `job_started` append ends the wrapper by SIGTERM, Run `running` → recovery `interrupted` (S35 baseline). |
| Design-probes F2 (76e8889d, P3) | The relay armed only after `submitRun` returned, so a signal in the ~2 ms after the Run became claimable took the default disposition and a daemon later executed it | Closed in T4 (`3d1e73b3`): armed before `submitRun` with the ID pending; held aborts relay as a queued cancel once the ID is known, or are re-raised with the default disposition when admission throws. Regressions at the `job_created` / `artifact_created` appends and with a failing run-dir mkdir. A held abort waits for admission to finish (it is bounded by the store's own timeouts; an artificially wedged admission — every `artifact_created` insert failing `SQLITE_BUSY` — holds it as long as admission runs). |
| Security P3-1 (76e8889d) | A keyed sync `retry --request` replay waiter armed the relay and could cancel the retained child another request admitted | Closed in T4 (`3d1e73b3`): `admitted.replay` switches the relay to observe-only (no cancel; default disposition; EOF ignored); both guides document it. Regressions with the retained child running under another executor and still queued. |
| Windows stdin probe | The win32 stdin probe adds a 50 ms timer because libuv reads Windows pipes on a worker thread; not verified on a Windows host | host-blocked, like the rest of the Windows abort matrix. |
| Starvation | daemon → schedule → api slot order can delay API runs | Documented. |
| TICKET-128 | Orphan creation keeps a key pending; partial publish and publish→expiry crash gap; a consumer deleting published files makes `wait` pending again | Documented in both guides; not repaired in this slice. |
| Mixed builds | An older build on the same profile is unsupported and not technically fenced (D7, SYN-26) | Documented in both guides; the 4.9 fixture is open. |

## Follow-up register

| Item | Coordinator disposition / proposed ticket scope | Evidence and acceptance boundary |
| --- | --- | --- |
| S35 relay-arming window | Closed in T3 (`36dc9c12`, Codex R1 P1-2) and completed in T4 (`3d1e73b3`): relay installed before admission, own-claimed mode keeps the default disposition without removing listeners, replay waiter observe-only; T4 `cb1e1e2a`: already-closed stdin never arms EOF. | `tests/local-job-api-wrapper-relay-arming.test.ts`, `tests/local-job-api-wrapper-relay-modes.test.ts`, the immutable S35 tests and `tests/local-job-api-wrapper-relay-signals.test.ts` green at the T4 candidate (three consecutive runs). No Windows host pass is claimed. |

## C7 scope check

Every consumer-visible change in proposal §3 (and the C7 §9.2 categories) maps
to guide text at the candidate (English section named; the Chinese guide has
the same section and content):

| Proposal Consumer Impact row | Consumer guide |
| --- | --- |
| submit / wait, retry `--async` / `--request`, wait timeout envelope and exit 9 | Command Reference; Asynchronous Submission → Submit, Wait; Retry; Exit Codes (row 9) |
| create / default retry = submit + scoped pump + wait (R1), own-pump exemption, daemon-first observer errors | Asynchronous Submission → Synchronous create and default retry; Create Response note |
| execution context (R3), CLI readiness only for the caller | Execution context; Runtime Capabilities readiness note |
| waiter abort (R4), platform table, cancel-by-ID, 500 ms kill grace, `--request -` EOF; T4: abort held during admission, own-claimed default disposition, replay waiter observe-only, already-closed stdin not armed | Aborting a waiting command; Cancel |
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
| admission failure after the creation commit (T3 row; old create/default retry, key binding, retry order, Windows) | Claim-time checks → Admission failure after creation; Known limits |
| `job.workerId` value format (opaque string) | Executor availability bullet |
| malformed submit / retry `--request` body diagnostic | Idempotency → after the error table |
| deleted published files make wait pending again (SYN-18) | Wait |

No consumer-visible change was found outside proposal §3. The two details
the proposal formerly left to the guides — the `workerId` value format
(Phase I P3-5) and the failed job left by an admission failure after the
creation commit (Phase I P3-2, 37de7fce security P1-1) — now have proposal §3
rows (T3).

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
  T1 `REVIEW_APPROVED` binds `e0a9a967`, the Phase III check binds
  `887df155`, the T2 closure review binds `b7b408d1`, and the `37de7fce`
  reviews bind that SHA; none is a substitute for final verdicts on the T3
  candidate.
- Tasks 8.7: once both verdicts bind the same SHA and no Red item is open, the
  coordinator records ACCEPTED under the Owner's 2026-10-02 self-iteration
  mandate. Red items return to the Owner. Not recorded yet.
- Tasks 8.8: this dispatch does not authorize push, remote PR changes, remote
  merge, release or repository-rules changes; none was performed. A local
  merge needs its own authorization and post-merge gates.
- Open before acceptance can be argued complete: tasks 1.4 (Windows
  receipts), 3.3 (SYN-25 cache), 4.9
  (migration/rollback fixture), the PARTIAL rows 7.2, 7.3, 7.4, 7.6, 7.7, 7.9
  and 7.10, 8.1, 8.3, 8.4, and the sub-clauses listed above. The coordinator
  decides which of these are acceptance blockers.
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
