# Red suite receipt — add-local-job-api-async-submit

- Auditor: fresh-context Claude Code (no author or implementation context), 2026-10-02.
- Worktree / branch / base: `/home/chen/projects/locus-add-local-job-api-async-submit-draft`, `codex/add-local-job-api-async-submit-draft`, HEAD `0447d02d7682b16f9b042e5eda2701d68751a7ce`.
- Product source identity: `git diff --stat 2c59664f 0447d02d -- src/ scripts/ docs/local-job-api-v1.schema.json` is empty, so every golden captured from `2c59664f` is a golden of the audited base.
- Audited files: the 29 untracked suite files listed in §1 (8 TypeScript, 18 JSON, 3 fixture `.ts`). Nothing else in the worktree is modified (`git status --short` shows only those 9 untracked paths before and after the audit).
- Commands run by the auditor: `bun test --isolate tests/local-job-api-async-<domain>.test.ts` for each of the four files, sequentially; `bun run lint` (read-only ratchet); `biome check` on the 29 files; the 18 registered-existing tests with `-t` filters; no git mutation; no `src/`, `tests/` or `docs/` write. The only file written is this receipt.

## Verdict

**CHANGES_REQUESTED** — one mechanical P1 (§7 F1): the repository lint ratchet (`bun run lint`, step 1 of `bun run check` / `check:full`) exits 1 on the two guards-protocol files, because `scripts/run-biome-changed.mjs:216` counts biome **warnings** as blocking and new files start at baseline 0. `biome check` itself exits 0, which is why the author reported it clean. Everything else audited is acceptable: counts reconcile exactly, every red fails on the asserted behaviour or on a frozen seam's absence, no load-time crash, no skip/only/todo, no swallowed errors, no `src/` writes, S01–S54 all covered or registered, and the four authors' frozen shapes do not contradict each other or the design. Once F1 is fixed (typing or targeted `biome-ignore` on 29 `any`s; no behavioural change), the re-audit scope is `bun run lint` plus a re-run of `tests/local-job-api-async-guards-protocol.test.ts` to confirm 13/8/5 is unchanged.

## §1 Immutable file list (sha256 prefix, bytes)

| File | sha256[0:16] | bytes |
| --- | --- | --- |
| `tests/local-job-api-async-executor-kit.ts` | 83f4e82965e283b9 | 26681 |
| `tests/local-job-api-async-executor.test.ts` | ba579454753b114f | 75915 |
| `tests/local-job-api-async-guards-protocol-kit.ts` | 30188ce79a936739 | 19631 |
| `tests/local-job-api-async-guards-protocol.test.ts` | 403621308f1db5ad | 44088 |
| `tests/local-job-api-async-idempotency-kit.ts` | ae224f76fb9c9e96 | 21823 |
| `tests/local-job-api-async-idempotency.test.ts` | fa87ce99fd897af9 | 55288 |
| `tests/local-job-api-async-submit-wait-kit.ts` | e5f68ec6fbedeefa | 27772 |
| `tests/local-job-api-async-submit-wait.test.ts` | bfa9db1507f8a4f7 | 87586 |
| `tests/fixtures/local-job-api-async/executor/admission.json` | d0817b378faaf7f8 | 7770 |
| `tests/fixtures/local-job-api-async/executor/environment.json` | 1d3610c7057907ce | 2383 |
| `tests/fixtures/local-job-api-async/executor/idempotency.json` | 55f03654c7738766 | 2006 |
| `tests/fixtures/local-job-api-async/executor/publication.json` | cfc7d4cf0f7d759a | 4903 |
| `tests/fixtures/local-job-api-async/executor/queue.json` | 4dab6ea7cf38d542 | 6446 |
| `tests/fixtures/local-job-api-async/guards-protocol/architecture-fixtures.json` | 257d07dbf85dbd9d | 36833 |
| `tests/fixtures/local-job-api-async/guards-protocol/schedule.json` | 15649cf734ebd814 | 2213 |
| `tests/fixtures/local-job-api-async/guards-protocol/stdio.json` | b5b80a60f7bd4b8b | 8258 |
| `tests/fixtures/local-job-api-async/idempotency/controls.json` | e9817816df88d54d | 3060 |
| `tests/fixtures/local-job-api-async/idempotency/discovery.json` | cea9fda7ab1213a8 | 2149 |
| `tests/fixtures/local-job-api-async/idempotency/idempotency.json` | cb9a7baab38fb492 | 18491 |
| `tests/fixtures/local-job-api-async/submit-wait/cli-args-before.ts` | 8216023cdcc39931 | 23095 |
| `tests/fixtures/local-job-api-async/submit-wait/controls.json` | cfc9d8b15140d87c | 7215 |
| `tests/fixtures/local-job-api-async/submit-wait/discovery.json` | e39a52c1c81db74b | 4292 |
| `tests/fixtures/local-job-api-async/submit-wait/process-child.ts` | ebae96d81d9e533a | 2911 |
| `tests/fixtures/local-job-api-async/submit-wait/public-submission.json` | 37522fb750e270c2 | 11501 |
| `tests/fixtures/local-job-api-async/submit-wait/public-v1.json` | 706ea69f2eabe776 | 14176 |
| `tests/fixtures/local-job-api-async/submit-wait/publication.json` | b4fecb45d73bc1c8 | 4357 |
| `tests/fixtures/local-job-api-async/submit-wait/schema-before.json` | a352d60239223aaa | 35230 |
| `tests/fixtures/local-job-api-async/submit-wait/terminal-bytes.json` | f3388394178f7281 | 36994 |
| `tests/fixtures/local-job-api-async/submit-wait/wait-observation.json` | 6fcb6740b5aceb46 | 7449 |

Pinned baselines verified against git: `schema-before.json` sha256 `a352d602…cb8b024` equals `git show 2c59664f:docs/local-job-api-v1.schema.json` (and the current docs schema; no header by design, see F12). `cli-args-before.ts` differs from `git show 2c59664f:src/main/lib/headless/cli-args.ts` only by a 6-line provenance header (carrying the original's sha256 `15469469…7ab257`, verified) and the three `../../../shared/` → `../../../../src/shared/` specifier rewrites. Every JSON fixture except `schema-before.json` carries `{fixtureVersion:1, evidenceClass:"synthetic", sourceRefs:[…], provenance:{…}}` and a `cases` member.

## §2 Per-file counts on 0447d02d

`bun test --isolate <file>`, run sequentially by the auditor (00:49–00:50 local); exit 1 for every file as expected for a red suite.

| File | Tests | Red | Green | expect() calls | Duration | Author report | Reconciled |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `tests/local-job-api-async-submit-wait.test.ts` | 34 | 33 | 1 | 34 | 32.45 s | 34 / 33 / 1 | exact |
| `tests/local-job-api-async-idempotency.test.ts` | 12 | 11 | 1 | 12 | 1.17 s | 12 / 11 / 1 | exact |
| `tests/local-job-api-async-executor.test.ts` | 20 | 16 | 4 | 46 | 4.53 s | 20 / 16 / 4 | exact |
| `tests/local-job-api-async-guards-protocol.test.ts` | 13 | 8 | 5 | 84 | 32.54 s | 13 / 8 / 5 | exact |
| **Total** | **79** | **68** | **11** | 176 | ~71 s | 79 / 68 / 11 | exact |

Declarations: 77 `test(` sites produce 79 runs (submit-wait S35 relay loop ×2 signals; guards S50 `test.each` ×2 variants). No load-time failure, no `skip`/`only`/`todo`/`todoIf`/`skipIf` anywhere. Registered-existing tests (§4) re-run on base: 18 pass, 0 fail.

Convention checks (all 29 files):

- Titles: every `test` title starts with exactly one leading `Sxx <register name> —` and the name matches `verification.md` verbatim for all 77 declarations (programmatic check). Two titles repeat their own token later in the description (F5).
- Error handling: three `catch` sites total — `cli-args-before.ts:811` (vendored product code), `submit-wait-kit.ts:436` (`JSON.parse` → `{unparseable: line}` sentinel that is asserted), `idempotency-kit.ts:230` (`.catch(() => null)` → asserted null, disclosed by the author). No swallowed failure.
- Collect-then-expect: submit-wait and idempotency use exactly one structural `toEqual` per test; executor and guards collect all observations first and assert in a trailing block (sampled S39, S29). See F8.
- Clocks: `setSystemTime` (submit-wait, idempotency), a fake `monotonicClock` seam (submit-wait), injected `now: Date` (executor). Wall-clock use is confined to necessities (F11).
- Isolation: every kit creates `mkdtemp` profiles with file-backed SQLite built from the real Drizzle migrations (via the imported `createMigratedLedgerDb`) and removes them in `afterEach`; child processes are killed in cleanup; the auditor's run left no new `/tmp` entries and no orphan processes.
- Seams: every static import resolves on base (the files load); all NEW seams (`run-submission.ts`, `pumpQueuedRuns`, `readRunPublicationReadiness`, `cleanupExpiredAgentJobIdempotency`, old parser) are lazy `import()`s or property probes inside tests/kits.
- Writes: no test writes under `src/`, `scripts/`, `docs/` or `openspec/`; the guard tests run `node scripts/check-architecture-guards.mjs` read-only (the baseline-update flag is never passed).
- Lint: `biome check` exit 0 with 29 warnings, all `lint/suspicious/noExplicitAny`, all in the two guards-protocol files (kit 20, test 9); the other seven TypeScript files are warning-free (they use targeted `biome-ignore` comments). `bun run lint` exits 1 (F1).

## §3 Per-test red reasons

Category legend: **real-gap** = the asserted product behaviour is missing on base and the failure diff shows that behaviour; **contract-absence** = the test depends on a frozen seam/export (`pumpQueuedRuns`, `submitRun`, `monotonicClock`, `beforeOwnPumpClaim`, reservation table, guard section …) that does not exist yet, so the failure is the seam's absence; **mixed** = both. Line numbers are the failing `expect` in the test file as observed in the auditor's run.

### submit-wait (33 red)

| # | Test (abbrev.) | Sc. | Category | Failing assertion on base (observed vs expected) |
| --- | --- | --- | --- | --- |
| 1 | submit acks one queued admission … later claim visible only through status | S01 | real-gap | `:266` exit 2, stderr `Unknown api runs subcommand: submit…`, 0 jobs, 0 job_created, statusExit 3 (expected exit 0, `{apiVersion,job}` queued, committed `lifecycle:job-created:<id>:0` seq 1, running after claim) |
| 2 | every create-time rejection reproduced by submit, zero provider calls | S02 | real-gap | `:357` six gate fixtures return the unknown-subcommand stderr instead of the 2c59664f create diagnostics (create halves match baseline) |
| 3 | create and submit+executor+wait reproduce the golden for every outcome/kind | S03 | real-gap | `:437` all 11 submitWait rows exit 2 / empty stdout / 0 dispatch; create rows match goldens byte-for-byte; `pumpScopes` = "pumpQueuedRuns is not exported" |
| 4 | real processes: workerId/workerPid identify the claimant | S03 | real-gap | `:486` `daemonClaimPid` null, no daemon claim of an api Run (wrapper half passes) |
| 5 | sync retry and retry --async+executor+wait equal the retry golden | S04 | real-gap | `:585` `--async` rejected (exit 2), no child; sync half matches golden and lineage |
| 6 | agent create held past 30000 ms internal wait, baseline envelope only | S25 | contract-absence | `:624` `releasedBy` "real-time-guard" ≠ "clock": the wrapper never consumed the injected `monotonicClock` |
| 7 | completion create with 45000 ms upstream call | S25 | contract-absence | `:665` same |
| 8 | no lock: own-ID pump, unrelated untouched, baseline bytes | S34 | contract-absence | `:734` `pumpScopes` not exported ≠ four single-ID scopes (bytes, unrelated rows, no lock all pass) |
| 9 | daemon-first: wrapper only waits, never double-dispatches | S34 | contract-absence | `:792` `beforeOwnPumpClaim` never invoked; wrapper dispatched, daemon 0 |
| 10 | daemon-first stalled unknown worker → executor_unknown/8 at 30000 ms | S34 | contract-absence | `:836` exit 0 with result instead of `wait.state=error/executor_unknown`/8 |
| 11 | daemon-first completion 45000 ms, confirmed-alive claimant, no error/8 | S34 | contract-absence | `:886` `daemonUpstreamCalls` 0 (wrapper ran it), `releasedBy` not clock |
| 12–13 | daemon-first SIGINT / SIGTERM relays one cancel, ≤5000 ms, re-raise | S35 | mixed | `:1079` `claimed` false (hook absent), `ownCancelRequested` false (no relay today) |
| 14 | SIGKILL of a daemon-backed waiter relays nothing | S35 | contract-absence | `:1115` `claimed` false |
| 15 | armed stdin EOF relays own cancel and exits 8 | S35 | mixed | `:1154` `claimed` false, exit not 8, no cancel request |
| 16 | ignored stdin / pre-admission `--request -` EOF arm nothing | S35 | contract-absence | `:1205` `claimed` [false,false] |
| 17 | Career Kit SIGTERM→500 ms→SIGKILL keeps the persisted cancel | S35 | mixed | `:1236` `claimed` false, exitSignal SIGTERM (no 5 s wait to truncate), no cancel |
| 18 | pre-commit / published-incomplete non-ready, release → golden, prepared tail, throwing rename pending | S05 | real-gap | `:1360` every `runs wait` exit 2 (`Unknown api runs subcommand: wait`); the publish-throw create baseline (`artifacts:[]`, exit 0) matches |
| 19 | daemon-first claimant's final rename throws → terminal_artifacts_pending error/8 at 30000 ms | S05 | contract-absence | `:1428` exit 0 with result; `afterPublicationBound` false |
| 20 | omitted/0/25 ms over six states → one timeout envelope, exit 9 | S06 | real-gap | `:1514` all 18 rows exit 2, no envelope |
| 21 | invalid timeouts diagnostic/2, 86400000 accepted, ready at deadline | S06 | real-gap | `:1560` stderr is the unknown-subcommand text, not `Invalid timeout: …`; 86400000 exit 2 |
| 22 | SQLITE_BUSY after snapshot → observation_failed/8; before → `Failed to observe job`/8 | S06 | real-gap | `:1626` exit 2, neither envelope nor diagnostic |
| 23 | two waiters across the commit, third after a late diagnostic | S07 | real-gap | `:1700` attempts 0, completed 0, exits [2,2,2] |
| 24 | no executor lock: queued, unavailable/no_executor + hint, wait executor_unavailable/9 | S16 | real-gap | `:1763` ackExit 2; no `execution` block |
| 25 | nine-row status derivation table, no lock writes/leaks, terminal omission | S17 | real-gap | `:1855` `execution` absent in every row (hint null); lock-unchanged/no-leak/workerPid/readiness checks pass |
| 26 | API-capable daemon writes lock v2, refreshes heartbeat ≤1000 ms, spares successor | S17 | real-gap | `:1912` lock lacks `lockFormat`/`apiCapable`/`heartbeatAt`; heartbeat not refreshed; nonce stable and successor survival pass |
| 27 | cancel-first: one canceled completed, no spawn, wait ready/5 | S18 | real-gap | `:1972` submit absent → cancel exit 3, completed 0, wait exit 2 |
| 28 | start-first: cancel is a request until worker confirms; cancel/cancel one terminal | S18 | real-gap | `:2013` `entered` false, `completedAfterWorker` 0 |
| 29 | wait on missing/non-API IDs → `Unknown job: <id>`/3; baseline cancel/events/retry errors | S20 | real-gap | `:2086` four wait rows exit 2 with the unknown-subcommand text (14 baseline rows match) |
| 30 | queued-executor Runs replay events (--after, --follow), result, terminal byte for byte | S21 | real-gap | `:2178` no API Run executes → all outputs empty |
| 31 | completion submit acked with zero upstream calls; daemon makes one; wait returns baseline | S24 | real-gap | `:2258` ackExit 2, upstream 0; create baseline matches |
| 32 | runtimes list adds async-submit, passes new schema, fails pinned enum | S22 | real-gap | `:2346` `advertises` false, `sharedConstant` false, pinned schema still valid (expected enum error at `/features/<index>`) |
| 33 | preflight refuses; wrong-version submit → `apiVersion must be locus.local-job.v1`/2; old parser rejects shapes | S23 | real-gap | `:2399` wrong-version submit stderr is the unknown-subcommand text (preflight and vendored old-parser shapes pass) |

### idempotency (11 red)

| # | Test (abbrev.) | Sc. | Category | Failing assertion on base |
| --- | --- | --- | --- | --- |
| 1 | normalized replay on submit / retry --request; keyed create refused; unkeyed create fresh | S08 | mixed | `:245` keyed create exits 0, 1 job, 1 runner call (expected `idempotency_key_not_supported`/2, 0/0); submit and `retry --request` exit 2 |
| 2 | 5 agent + 2 completion variants → `idempotency_conflict`/2, no growth/echo | S09 | contract-absence | `:343` bindings exit 2 |
| 3 | fixture-a/fixture-b same key → distinct jobs/reservations; fixture-b replays only its own | S10 | contract-absence | `:386` submits exit 2, 0 reservations |
| 4 | three real processes race; held creation latch → pending/8; replay after release; claims 0→1 | S11 | contract-absence | `:551` 0 race jobs/reservations; latch submits exit 2 |
| 5 | reservation/job insert faults and job_created fault leave zero rows/no ack/no run-dir | S12 | contract-absence | `:660` reservation trigger not installable (no table); retries exit 2 |
| 6 | killed / failed-compensation / paused-live creators stay pending/8 past 31 days | S13 | contract-absence | `:784` child exits 2 before the boundary; no orphan; no pending |
| 7 | six terminal kinds expiresAt = publish-or-settle + 2592000000; replay never extends | S14 | contract-absence | `:1038` every endpoint "no-reservation" |
| 8 | at expiry same-consumer submit and daemon tick delete only expired reservations | S14 | contract-absence | `:1125` `cleanupExpiredAgentJobIdempotency` undefined; flags false |
| 9 | running / publish-fault / crash-before-setter / orphan keep NULL expiry | S14 | contract-absence | `:1216` `crashChildSignal` "no-reservation-table" |
| 10 | sentinel key absent from DB/WAL/SHM/files/stdout/stderr; domain-separated hash; error codes | S15 | contract-absence | `:1336` exit 2, 0 reservation rows, null error codes |
| 11 | two concurrent --async retries + one sync share one child; mismatch/conflict; parent byte-identical | S19 | real-gap | `:1508` `retry --request` unknown → exits [2,2,2], no child, codes absent; parent harness sound |

### executor (16 red)

| # | Test (abbrev.) | Sc. | Category | Failing assertion on base |
| --- | --- | --- | --- | --- |
| 1 | list/start admit only the exact creation fact + required initial admission | S26 | real-gap | `:280` listed = valid + 5 invalid rows (wrong creation key `:1`, run-dir without admission, content-hash key, wrong ordinal, wrong type); start claims them too |
| 2 | genuine initial batch keyed `lifecycle:initial-artifacts:<id>:0`, only then listable | S26 | real-gap | `:360` run-dir job listed before admission; today's key is `run-dir-artifacts-<hash>:0` |
| 3 | pre-commit / post-commit / between-rename fault points non-ready | S27 | contract-absence | `:446` submitExit 2 per fault point |
| 4 | changed digest / symlinked run dir fail closed | S27 | contract-absence | `:541` [2,2] |
| 5 | daemon→schedule→api slot order, once each, exclusions kept | S28 | mixed | `:652` submitExits [2,2] (today's daemon never selects `api`) |
| 6 | two `pumpQueuedRuns` instances race on independent connections | S28 | contract-absence | `:788` `typeof pump` "undefined" |
| 7 | daemon additionally claims an admitted source=api job (MODIFIED line) | S42 | contract-absence | `:911` admitted.code 2 |
| 8 | killed daemon worker → interrupted/worker_stopped, wait exit 1, artifacts [], retention from settle | S36 | contract-absence | `:992` sub.code 2 |
| 9 | stale heartbeat with alive/EPERM worker stays running | S36 | contract-absence | `:1067` sub.code 2 |
| 10 | A submits, B reopens/publishes, C waits ready with golden prepared tail | S37 | contract-absence | `:1147` A exit 2 |
| 11 | digest / symlink / hardlink mismatch → failed/artifact_admission_mismatch, exit 1 | S37 | contract-absence | `:1247` [2,2,2] |
| 12 | half-admitted Run never listed/claimed; same key pending/8; admission_incomplete | S38 | contract-absence | `:1352` `crashed` false (child exits 2 before any job) |
| 13 | runs cancel settles one canceled terminal; named cleanup at settle+30 d | S38 | contract-absence | `:1419` `crashed` false |
| 14 | each post-ack mutation settles failed with reason/errorCode/exit 7/7/(4,2,6 else 3)/1 | S39 | contract-absence | `:1590` all eight submits exit 2 |
| 15 | injected `maxQueuedApiAgeMs` moves only the age threshold | S39 | contract-absence | `:1673` [2,2,2] |
| 16 | daemon-claimed child uses daemon env B, wrapper child uses caller env A, secrets stripped | S40 | contract-absence | `:1812` `daemonCapture.claimantPid` undefined (wrapper half captures env A today) |

### guards-protocol (8 red)

| # | Test (abbrev.) | Sc. | Category | Failing assertion on base |
| --- | --- | --- | --- | --- |
| 1 | API submit and job.run share submitRun; ack after committed job_created; session-scoped pump | S29 | mixed | `:247` submit exit 2 / unknown subcommand; next `:257` seams `submitRun`/`waitForRun`/`pumpQueuedRuns` undefined (every other S29 assertion holds on base per author soft-probe) |
| 2 | queued cancel wins claim cleanly; running cancel; -32602; API job untouched; scope | S30 | mixed | `:470` two `job/error` "already terminal: canceled" notifications for queued jobs canceled before claim (expected none); then stderr line `:471`, then pump-scope assertions |
| 3 | source=protocol job through submitRun + session pump; events equal committed; cancel maps | S48 | contract-absence | `:622` seams undefined (living half passes) |
| 4 | schedules.ts constructs no agent_jobs row itself | S31 | real-gap | `:982` `directInserts` = [`src/main/lib/headless/schedules.ts:323`] |
| 5 | self-test matches all 7 S32 cases exactly | S32 | contract-absence | `:1006` output lacks `Local job API async submission guard self-test: 7/7 fixture cases matched` |
| 6 | self-test fails by case id on a mutated fixture | S32 | contract-absence | `:1044` exit 0 (expected 1) |
| 7 | default run self-tests the canonical fixture and enforces the repository | S32 | mixed | `:1072` no `…17/17 fixture cases matched; repository ownership enforced.` line (author's scratch reference finds 5 real findings in today's src) |
| 8 | self-test matches all 10 S33 cases exactly | S33 | contract-absence | `:1093` no `…10/10 fixture cases matched` line |

Totals: 68 red = 30 real-gap, 30 contract-absence, 8 mixed. Every real-gap and mixed row was checked against the failure diff; the diff shows the missing behaviour, not a harness error.

## §4 Green-by-design and registered-existing

### Green-by-design (11, all pass on base; characterizations pinned through the refactor)

| File | Test | Sc. | What it pins |
| --- | --- | --- | --- |
| submit-wait | own-pump wrapper keeps the 2c59664f process-tree receipts for SIGINT/SIGTERM/SIGKILL and stdin EOF | S35 | real child dies by the signal, row stays running, EOF no-op, `recoverStaleAgentJobs` → interrupted |
| idempotency | documentation-example preflight reads a no-async-submit envelope as unsupported, dispatch spy 0, positive control | S53 | neutral helper in the kit (example only, not parser evidence) |
| executor | only one real daemon lock acquisition succeeds; stale-nonce release never unlinks its successor | S28 | `acquireDaemonLock` semantics |
| executor | headless branch dispatches daemon mode before single-instance/menu/window/updater/auth/MCP; diagnostics on stderr | S41 | structural read of `src/main/index.ts` + `daemon run --once` stdout/stderr split |
| executor | `jobs logs --follow` and `run --daemon --follow` stream in sequence and exit after terminal | S44 | CLI follow |
| executor | token/API-key/raw-env inputs rejected before any job; no listening socket; profile-only writes | S46 | `net.Server.prototype.listen` spy |
| guards-protocol | two connections fire one schedule job with host job_created; failed append leaves nothing claimable | S31 | behavioural half of S31 |
| guards-protocol | initialize result equals the current one exactly (`serverInfo {name:"Locus"}`) | S49 | exact characterization |
| guards-protocol | shutdown / stdin-eof: no new jobs, own queued+running canceled, terminal not re-marked, JSON-RPC-only stdout | S50 ×2 | table test |
| guards-protocol | pre-ledger `locus-acp-stdio.v1` row survives every migration byte-for-byte on a read-only connection | S51 | covers the future reservation migration automatically |

### Registered-existing (18 tests, re-run on base by the auditor: 18 pass / 0 fail)

| Sc. | Existing test(s) |
| --- | --- |
| S42 (living lines) | `tests/headless-daemon.test.ts` "fires due schedules and claims schedule jobs without claiming protocol jobs", "daemon respects the configured concurrency limit"; `tests/headless-cli-dispatcher.test.ts` "runs daemon once and claims only daemon queued jobs" |
| S43 | `tests/headless-daemon.test.ts` "daemon worker observes persisted cancel requests" |
| S45 | `tests/headless-daemon.test.ts` "runs queued daemon jobs and marks stale running jobs interrupted on startup"; `tests/headless-cli-dispatcher.test.ts` "daemon command reports stale running jobs it interrupts", "cancels queued jobs and retries terminal jobs"; `tests/run-event-ledger-recovery-variants.test.ts` "an unknown or unsupported host probe leaves the row running with a heartbeat_only diagnostic and appends nothing" |
| S46 (living lines) | `tests/headless-cli-dispatcher.test.ts` "rejects jobs-stdio provider secrets and raw env without creating jobs"; `tests/headless-cli-args.test.ts` "rejects provider secrets on the command line" |
| S47 | `tests/headless-cli-dispatcher.test.ts` "runs jobs-stdio with JSON-only stdout and protocol jobs", "rejects jobs-stdio provider secrets and raw env without creating jobs"; `tests/headless-cli-args.test.ts` "parses jobs-stdio command and rejects the retired acp alias"; `tests/headless-cli-shims.test.ts` "POSIX shim rejects retired acp before GUI dispatch", "generated Windows wrapper routes jobs-stdio and rejects retired acp" (packaged-CLI capture stays tasks 8.3 manual) |
| S48 (living line) | `tests/headless-cli-dispatcher.test.ts` "runs jobs-stdio with JSON-only stdout and protocol jobs" |
| S52 | `tests/run-event-ledger-projection.test.ts:1051` "**S53** Consumer detects readiness support — …"; `tests/headless-cli-dispatcher.test.ts:1141` "lists Local Job API runtime capabilities" |
| S53 (consumer rule) | `tests/run-event-ledger-projection.test.ts:1073` "**S54** Older build lacks the feature — …" |
| S54 | `tests/run-event-ledger-projection.test.ts:1088` "**S55** Consumer detects canonical ledger support — …" |

The three projection tests carry the archived ledger change's numbering (S53/S54/S55); the verification register must map them to S52/S53/S54 explicitly (F7).

## §5 Coverage matrix S01–S54

Status: **covered** = at least one test exercises the scenario's THEN/AND clauses as far as the host and design-named seams allow; **partial** = a named sub-clause is uncovered (listed in §6); **registered-existing** = no new test, living assertions registered and passing. No scenario is missing.

| ID | Scenario | Status | Tests (file: red/green) | Note |
| --- | --- | --- | --- | --- |
| S01 | Submit returns before execution is released | covered | submit-wait: 1 red | |
| S02 | Existing admission gates run before provider work | covered | submit-wait: 1 red | 6 gate fixtures + batch-selector control |
| S03 | Old create matches submit plus wait byte for byte | covered | submit-wait: 2 red | 11 goldens; direct-runner-spy zero covered indirectly (one scoped pump call, one dispatch); structural proof is S32 |
| S04 | Default retry retains synchronous response and lineage | covered | submit-wait: 1 red | |
| S05 | Wait observes both commit and publication | covered | submit-wait: 2 red | commit/last-rename latches simulated by SYN-18 delete/restore and a `result.json` directory obstacle (design permits) |
| S06 | Wait has explicit bounded timeout semantics | covered | submit-wait: 3 red | 6 states × 3 timeouts, invalid table, SQLITE_BUSY pre/post snapshot |
| S07 | Multiple waiters and late facts cannot change the result | partial | submit-wait: 1 red | commit-between-initial-read-and-wakeup-registration interleaving needs the tasks 1.5 read/wakeup latch |
| S08 | Normalized replay stays on supported key surfaces | covered | idempotency: 1 red | |
| S09 | Changed request conflicts without exposing the key | covered | idempotency: 1 red | |
| S10 | Same key cannot replay across consumers | covered | idempotency: 1 red | |
| S11 | Concurrent requests reserve one attempt | partial | idempotency: 1 red | real 3-process race + trigger latch; "creation committed, initial admission pending" interleaving not deterministic (produced only in S14/S38) |
| S12 | Rollback and creation compensation release the key | covered | idempotency: 1 red | |
| S13 | Crashed creation never becomes a successful replay | covered | idempotency: 1 red | live creator emulated by trigger hold + `recordAgentJobCreated`, killed creator is a real SIGKILL |
| S14 | Retention has a declared endpoint | covered | idempotency: 3 red | 10 reservations; see §8 hazard on publish-fault classification |
| S15 | Idempotency key stays out of durable and diagnostic output | covered | idempotency: 1 red | DB/WAL/SHM/file/stdout/stderr byte scans |
| S16 | Submission without an executor is observable | covered | submit-wait: 1 red | |
| S17 | Lock observations do not invent liveness | partial | submit-wait: 2 red | reader-side nonce A→B between two reads needs a filesystem read seam; writer-side successor case covered |
| S18 | Queued cancel wins claim without a second terminal | partial | submit-wait: 2 red | slow-cancel vs failing claimant, process+attempt staging names, loser-discard scope need preparation/staging seams |
| S19 | Retry key replays the child and preserves the parent | covered | idempotency: 1 red | pending contender re-issued once (F10) |
| S20 | API reads and control stay source-scoped | covered | submit-wait: 1 red | 14 baseline rows already match |
| S21 | V1 event and artifact regression is unchanged | partial | submit-wait: 1 red | retention equality not asserted (names, roles, SHA-256, result fields are) |
| S22 | Discovery advertises the extension with explicit schema evolution | partial | submit-wait: 1 red | failed-migration exit-before-activation, activation/rollback isolated profile, old-binary-at-new-marker negative, optional-field ignoring uncovered |
| S23 | Unsupported version and absent feature fail closed | covered | submit-wait: 1 red | vendored 2c59664f parser executed directly |
| S24 | Completion uses the same queued admission | covered | submit-wait: 1 red | |
| S25 | Internal wait timeout does not become a create result | covered | submit-wait: 2 red | contract-absence; weakest oracle (author-disclosed) |
| S26 | Queue listing and claim require the same committed facts | covered | executor: 2 red | |
| S27 | Publication faults cannot be mistaken for completion | partial | executor: 2 red | "fault after every staged write" covered only after the last staged write (pre-terminal-commit); per-staged-file points need a staging hook |
| S28 | Daemon executes API work once and preserves source exclusions | covered | executor: 2 red + 1 green | reopened-receipt validation observed indirectly (ready wait with golden prepared tail); direct mismatch in S37 |
| S29 | Job run acknowledges the shared creation core | covered | guards-protocol: 1 red | |
| S30 | Protocol cancel and shutdown remain session-owned | covered | guards-protocol: 1 red | see F4 on the job/error pin |
| S31 | Schedule creation retains one fire without bypassing creation facts | covered | guards-protocol: 1 red + 1 green | |
| S32 | Guard rejects an inline API execution fallback | covered | guards-protocol: 3 red | |
| S33 | Guard rejects duplicate creation and ledger writers | covered | guards-protocol: 1 red | |
| S34 | Create and retry run without an external executor | covered | submit-wait: 4 red | |
| S35 | Aborting a wrapper applies the chosen cancel policy | partial | submit-wait: 6 red + 1 green | Windows matrix not executable on Linux; POSIX process-group kill approximated by single-process kill (fake runner spawns no grandchildren) |
| S36 | Daemon death recovers to a readable interrupted result | covered | executor: 2 red | |
| S37 | Submit in one process and publish in another | partial | executor: 2 red | create/default-retry wrapper-paused variants need the claim-latch seam |
| S38 | Crash at creation to initial admission boundary | covered | executor: 2 red | |
| S39 | Claim revalidates project identity profile and age | partial | executor: 2 red | create/default-retry wrapper-paused variants need the claim-latch seam |
| S40 | Runtime environment belongs to the actual claimant | partial | executor: 1 red | probing-readiness variant across processes and win32 allowlist not executable here; `runtimes list --no-probe` leak check only |
| S41 | Daemon starts without a renderer window | covered | executor: 1 green | structural (no Electron bootstrap harness exists) |
| S42 | Daemon claims queued daemon jobs | covered | executor: 1 red + registered | MODIFIED api line is the red test |
| S43 | Daemon follows cancellation requests | registered-existing | — | |
| S44 | User follows daemon logs | covered | executor: 1 green | |
| S45 | Daemon restarts after crash | registered-existing | — | |
| S46 | Daemon coordination stays local | covered | executor: 1 green + registered | |
| S47 | User starts jobs-stdio mode | registered-existing | — | packaged-CLI GIVEN stays manual (tasks 8.3) |
| S48 | Protocol client sends prompt turn | covered | guards-protocol: 1 red + registered | |
| S49 | Protocol client initializes capabilities | covered | guards-protocol: 1 green | |
| S50 | Protocol exits cleanly | covered | guards-protocol: 2 green | |
| S51 | Historical job rows keep the retired protocol string | covered | guards-protocol: 1 green | |
| S52 | Consumer detects readiness support | registered-existing | — | |
| S53 | Older build lacks the feature | covered | idempotency: 1 green + registered | new documentation-example clause |
| S54 | Consumer detects canonical ledger support | registered-existing | — | |

Totals: covered 38, partial 11, registered-existing 5, missing 0 (54). Implementer-unit assignments: §6.

## §6 Uncovered sub-clauses and implementer-unit assignments

These clauses are not provable from the spec alone on this host, either because the design leaves the needed seam unnamed (tasks 1.5) or because the platform is unavailable. They are assigned to the implementer's own unit tests, to be registered in `verification.md` next to the red rows; they do not weaken the red suite's verdict.

| Sc. | Uncovered clause | Needed seam / platform | Assignment |
| --- | --- | --- | --- |
| S07 | commit landing between a waiter's initial read and its wakeup registration | read/wakeup-registration latch (tasks 1.5) | implementer-unit on `waitForRun` |
| S11 | "creation committed, initial admission pending" interleaving for an artifact request under true concurrency | admission latch (tasks 1.5) | implementer-unit on `submitRun`; state otherwise produced by S14 (missing-admission child) and S38 |
| S17 | reader-side nonce A→B between two reads | filesystem read seam for lock observation | implementer-unit on the lock reader |
| S18 | slow-cancel preparation racing a claimant that fails immediately; staging names unique per process+attempt; loser discards only its own files | preparation/staging hooks | implementer-unit on terminal preparer/staging |
| S22 | failed-migration fixture exits before activation; activation/rollback isolated profile; old binary pointed at a new marker (negative); optional-field ignoring | migration/rollback fixture (tasks 4.9, SYN-26) | implementer-unit + tasks 4.9 fixture; Owner decision stays as recorded |
| S27 | fault after each staged write (not only the last) | staging write hook | implementer-unit on run-artifacts staging |
| S35 | Windows matrix: console Ctrl, parent `child.kill()`/TerminateProcess, win32 non-detached kill; POSIX wrapper process-group kill with real grandchildren | Windows host; runtime that spawns grandchildren | tasks 8.3 packaged smoke on Windows; POSIX group kill as implementer-unit with a spawning fake runner |
| S37 / S39 | create/default-retry wrapper paused after its own admission so B claims / mutation applies | wrapper claim latch — frozen by submit-wait as `beforeOwnPumpClaim(jobId)` (F3) | once F3 is ratified, either author can add the variants; until then implementer-unit |
| S40 | CLI readiness "reports A only" with probing enabled; win32 allowlist | cross-process readiness injection; Windows host | implementer-unit with injected readiness deps; tasks 8.3 on Windows |
| S41 | real packaged-bootstrap ordering with recording ports | Electron bootstrap harness | structural test stands; tasks 8.3 packaged smoke |
| S47 | packaged `locus jobs-stdio` / retired `acp` stdout/stderr capture | packaged binary | tasks 8.3 manual item |
| S03 | "API handler direct-runner spy is zero" as a direct spy | — | covered structurally by S32 default run + behaviourally by one scoped pump call and one dispatch; no further unit needed |
| S21 | retention equality with baseline | — | implementer-unit or extend S21 fixture when green |

## §7 Findings

Severity: P1 = must fix before the suite is committed; P2 = decision or documentation needed before green, recorded; P3 = record only.

| ID | Sev. | Where | Finding | Disposition |
| --- | --- | --- | --- | --- |
| F1 | **P1** | `tests/local-job-api-async-guards-protocol-kit.ts` (20 warnings: :70, :74, :176, :181, :200, :365, :367, :421, :422, :428, :429, :444, :475, :493, :496, :497, :509, :599 ×2, :602), `tests/local-job-api-async-guards-protocol.test.ts` (9 warnings: :132, :135, :136, :139, :269, :819, :844, :1023, :1026) | `bun run lint` exits 1: `scripts/run-biome-changed.mjs:216` treats `warning` severity as blocking, `lint-baseline.json` gives new files baseline 0, and both files carry `lint/suspicious/noExplicitAny` warnings. `bun run check` and `check:full` fail at step 1 on base once the suite is committed, independent of any implementation. `biome check` exits 0 on warnings, which masked this for the author. The other seven TypeScript files are warning-free because they use targeted `biome-ignore lint/suspicious/noExplicitAny` comments. | Guards-protocol author (or coordinator) types the 29 `any`s or adds the same targeted ignores; re-run `./node_modules/.bin/biome check` (expect 0 warnings) and `bun run lint` (expect exit 0), then re-run the file (expect 13/8/5). No assertion may change. |
| F2 | P2 | all four fixture directories; `openspec/changes/add-local-job-api-async-submit/specs/*/spec.md` GIVEN clauses; `tasks.md:88-105` | Every spec GIVEN clause and the tasks §7 catalog name flat paths `tests/fixtures/local-job-api-async/<file>.json#Sxx`; the suite (per dispatch) stores them under `executor/`, `guards-protocol/`, `idempotency/`, `submit-wait/`, hard-coded in each kit's `FIXTURE_DIR`. Four catalog names are split across domains (`controls.json` S18/S20/S35 vs S19; `publication.json` S05/S07 vs S27/S36/S37; `idempotency.json` S08–S15 vs S38; `discovery.json` S22/S23 vs S53), so a flat merge would require case-key merging. All 50 non-registered GIVEN references resolve to exactly one subdirectory file carrying that case. | Coordinator: relink the verification register and tasks §7 to the subdirectory layout (recommended; spec GIVEN text then needs a one-line path note or a documentation touch in the implementation commit). Moving files instead requires editing four `FIXTURE_DIR` constants and merging the four split files. |
| F3 | P2 | `tests/local-job-api-async-submit-wait-kit.ts:20-22, :338`; executor report open question 1 | The tasks 1.5 "claim latch" and clock seams are frozen by one author only: `RunHeadlessCliCommandOptions.monotonicClock { now(), sleep(ms) }` and `RunHeadlessCliCommandOptions.beforeOwnPumpClaim(jobId)`. 17 submit-wait tests (S05 daemon-first, S06 ×3, S16, S25 ×2, S34 ×4, S35 ×6) stay red after a correct implementation unless these exact option names are adopted; the executor author deferred S37/S39 wrapper-paused variants pending one shared seam. No other author contradicts them. | Coordinator ratifies both names in tasks 1.5 before implementation starts; executor author may then add the S37/S39 variants. |
| F4 | P3 | `tests/local-job-api-async-guards-protocol.test.ts:459-471` | S30 pins that a queued protocol job canceled before its claim emits **no** `job/error` notification and **no** stderr line naming the job. The spec says "settles canceled without spawn … streams drain/stop"; the pin follows from D1 (pump-only dispatch skips a non-queued job) and today's `job/error` comes from the inline runner path, but it is stricter than the spec text. | Coordinator confirms the reading (recommended) or the author relaxes to "no stream-failure error for a job the session never dispatched". |
| F5 | P3 | `guards-protocol.test.ts:995, :1082`; `executor.test.ts` describe titles :182, :387, :600, :927, :1086, :1308, :1488, :1692, :1847 | Two titles repeat their own token ("matches every S32 case exactly", "every S33 case"); executor `describe` titles embed Sxx tokens ("(S28, S42)"), so `bun test -t S42` selects four tests. Leading-token rule is met everywhere. | Record; optional cosmetic cleanup when green. |
| F6 | P3 | `tests/fixtures/local-job-api-async/guards-protocol/architecture-fixtures.json` | `cases` is an array of `{caseId, scenario, category, files, expectedFindings}` rather than Sxx-keyed top-level cases (tasks.md:88); tests subset by `scenario`. The pinned table `PINNED_GUARD_FINDINGS` in the test mirrors all 17 cases' `rule|file|symbol|owner`, so fixture edits cannot weaken the oracle. | Record the shape in the register. |
| F7 | P3 | `executor/queue.json` (`registeredExisting` record), `idempotency/discovery.json` (S53 only), `tests/run-event-ledger-projection.test.ts:1051/:1073/:1088` | Registered-existing scenarios S43, S45, S52, S54 have no fixture case key under their GIVEN path; the three projection tests carry old numbering S53/S54/S55. | Verification register maps S52←"S53 …", S53←"S54 …", S54←"S55 …" and notes the registration records. |
| F8 | P3 | `executor.test.ts` (153 `expect`), `guards-protocol.test.ts` (127 `expect`) | Multiple assertions per test instead of one structural `toEqual`; sampled S39 and S29 collect every observation before the first `expect`, so state is not lost, but the first failing `expect` hides later diagnostics. | Acceptable; record. |
| F9 | P3 | `tests/fixtures/local-job-api-async/submit-wait/cli-args-before.ts:1-6` | The vendored parser carries a 6-line provenance header (with `biome-ignore-all`) in addition to the three specifier rewrites the report mentions; body sha256 matches `git show 2c59664f:…/cli-args.ts`. | Record only. |
| F10 | P3 | `tests/local-job-api-async-idempotency.test.ts:1407` | S19 re-issues a concurrent contender that receives `submission_pending`/8 exactly once (design D3 remedy) to satisfy the spec's "all refer to one new child". | Spec owner confirms; record. |
| F11 | P3 | S17 writer (`submit-wait.test.ts:1864`), executor child-process tests (S36–S40), guards S30/S50 bounds | Wall-clock dependence where unavoidable: heartbeat cadence ≤1000 ms, real children with ±2 s retention windows and `within()` guards up to 60 s, protocol drain bounds via `performance.now()`. | Acceptable; implementer should expect tolerance assertions, not exact instants, in those tests. |
| F12 | P3 | `submit-wait/schema-before.json` | No fixture header because it is the byte-identical pinned schema (sha256 recorded above). | Record. |
| F13 | P3 | `tests/local-job-api-async-idempotency-kit.ts:224-231` | `parseSingleJsonLine` is typed `Promise<any>` but returns `null` synchronously when stdout is not one line; awaiting it yields null, which is what the tests assert. | Harmless; record. |
| F14 | P3 | executor (`LONG = 120_000`, `within(…, 60_000)`), guards (`PROTOCOL_TEST_TIMEOUT_MS = 30_000`, `GUARD_TIMEOUT_MS = 180_000`), submit-wait (15–30 s on 27 of 33 declarations), idempotency (11 of 12) | Tests without explicit timeouts rely on bun's 5 s default; fine while red (fail fast). | Implementer may need to raise a few timeouts when green (e.g. S22 Ajv compile, S17 status table); not a suite defect. |
| F15 | P3 | `/tmp/run-event-ledger-b-GcSvhj`, `/tmp/run-event-ledger-b-lqZOTF`, `/tmp/idem-probe-hOtK4d`, `/tmp/s40-home` | Author probe leftovers on this host; the suite run itself created no new `/tmp` entries and left no processes. | Housekeeping only. |

## §8 Notes for the implementer

### A. Frozen seams and option names (consolidated from the four authors; no contradictions found)

- `RunHeadlessCliCommandOptions` (existing: `argv, db, appVersion, env, stdin, stdout, stderr, runner, now, daemonLockPath, runtimeReadinessDependencies, completionFetch, providerBindingDependencies`) gains `monotonicClock?: { now(): number; sleep(ms: number): Promise<void> }` and `beforeOwnPumpClaim?: (jobId: string) => Promise<void>` (F3). `runs wait`, the create/retry wrapper's internal wait, the 30000 ms no-progress window and the publication bound all consume `monotonicClock`; timeout N means the fake clock advanced N ms in sleeps ≤100 ms; timeout 0 means zero sleeps. The Q2(a) wrapper awaits `beforeOwnPumpClaim(ownId)` after admission and before its scoped pump; if the Run is no longer queued afterwards it only waits.
- Executor observation reads the lock at `daemonLockPath`; `null` means no lockPath (→ unknown/probe_unavailable). `daemon run --once` with a lockPath is API-capable and claims `source=api` agent and completion Runs using the `runner` and `completionFetch` passed to `runHeadlessCliCommand`.
- `RunLocalAgentDaemonOptions` (existing: `db, env, runner, stderr, concurrency, pollIntervalMs, once, lockPath, signal, now: Date`) gains `completionFetch`, `providerBindingDependencies`, `appVersion`, `maxQueuedApiAgeMs`; the existing `now` is the clock for the claim-time age check (`createdAt + maxQueuedApiAgeMs <= now` rejects, tested at exactly the default 86400000) and for the expiry tick. Tests pass `appVersion: "0.0.executor-red"` and `providerBindingDependencies` whose owner throws → `provider_profile_unavailable`/4, returns null → `provider_profile_not_found`/2, returns an official-cloud baseUrl under default local-only → `local_only_guard_blocked`/6; a `policy-grant` Run whose stored `input_json.runtime.policyGrant` is removed → `execution_profile_invalid`/3.
- `pumpQueuedRuns(options)` exported from `src/main/lib/headless/daemon.ts`, called across the module boundary by the wrapper and jobs-stdio (recorded with `spyOn(daemonModule, "pumpQueuedRuns")`, so an intra-module call is invisible and fails S03/S34/S29/S30/S48). Options mirror `RunLocalAgentDaemonOptions` (`db, concurrency, runner, completionFetch, appVersion, …`) plus `admittedIds` (iterable of job IDs) for scoped callers; executor tests call it directly without `admittedIds` and repeat it up to 10 rounds, so one-tick and drain semantics both pass. The scoped pump claims through `job-store.startAgentJob` (tests latch that namespace export). An exported no-op fails S03/S34 (one call scoped to exactly that Run per create) and S30 (scope ⊆ the session's admitted IDs).
- `submitRun` and `waitForRun` exported from `src/main/lib/headless/run-submission.ts`; `submitRun`'s return value only has to contain the admitted job id somewhere (deep search). Both are lazily imported.
- `readRunPublicationReadiness(db, jobId)` exported from `src/main/lib/agent-runtime/run-event-ledger-host.ts`, resolving to an object with boolean `ready`; it must agree with `runs wait`.
- `admitRunDirArtifacts({runId, runDir, artifacts, ledger})` remains the initial-admission seam; its observation key becomes `lifecycle:initial-artifacts:<id>` with one contiguous batch starting at `:0` (today `run-dir-artifacts-<hash>:0`, `run-artifacts.ts:529`).
- `cleanupExpiredAgentJobIdempotency(db, {now: Date, consumerId?})` exported from `job-store`, sync or async, deletes a reservation exactly when `expires_at <= now`; it runs for the submitting consumer before every `runs submit` lookup (any key) and for all consumers on every daemon tick (including `daemon run --once`).
- `recordAgentJobCreated(db, job, {kind, source, runtime, mode, cwd})` is used by tests to release the emulated "creation held" latch and must keep its current shape.
- R4 relay lives inside `runHeadlessCliCommand` like `daemonRunCommand`'s handlers; EOF arming watches the `stdin` option; re-raise is observed as the child's `signalCode`; EOF exit is 8.
- The S40 env capture uses the real `__testCodexHeadless.buildCodexEnv` inside `createCodexHeadlessTaskRunner({buildRuntimeEnv, resolveExecutable, runProcess})` passed as the daemon/CLI `runner`; daemon-claimed API agent Runs must honour the injected runner.

### B. Envelopes, streams and exits (D2 / D5; consistent across authors)

- Fresh submit and unkeyed `retry --async` ack: keys exactly `[apiVersion, job]`, `job.status "queued"` with no executor, `job.retryOfJobId = source` for retry; stdout one line, exit 0, empty stderr. Keyed replay: exactly `{apiVersion, idempotentReplay:true, job}`. Errors: exactly `{apiVersion, error:{code,message[,retryable]}}` on stdout: `idempotency_key_not_supported`/2 (create), `idempotency_conflict`/2, `consumer_mismatch`/2 (no job id), `invalid_idempotency_key`/2, `secret_in_request`/2 (secret check before charset; `Bearer abcdef` → secret_in_request), `submission_pending`/8 with `retryable:true`.
- Stderr plain text + newline, empty stdout: `Unknown job: <id>` exit 3 (wait, unknown or non-API id); `Invalid timeout: expected an integer from 0 to 86400000 milliseconds.` exit 2 (tested with -1, 0.5, NaN, Infinity, 86400001; 86400000 accepted); `Failed to observe job: <id>` exit 8 (fault before any snapshot); wrong apiVersion on submit keeps `apiVersion must be locus.local-job.v1` exit 2.
- Wait: default 30000 ms; stdout `{apiVersion,job,wait:{state:"timeout",timeoutMs,reason}}` exit 9, no result; reasons per the D5 table (`admission_incomplete` first, then `run_pending`/`executor_unavailable`/`executor_unknown`, `terminal_artifacts_pending`); post-snapshot read fault → `{apiVersion,job,wait:{state:"error",reason:"observation_failed"}}` exit 8; daemon-first wrapper errors carry the admitted id with reasons `executor_unavailable|executor_unknown|terminal_artifacts_pending|observation_failed` exit 8. Ready at the final deadline read wins. A symlink-swapped run dir is a mismatch → `terminal_artifacts_pending`/9, not `observation_failed`/8.
- Status `execution` only for queued/running: `{state, reason, observedAt[, hint]}`, `hint:"locus daemon run"` only for unavailable/no_executor, no PID/nonce/hostname/path; terminal status omits it. Nine-row derivation (S17): alive v2 fresh → available; absent lock / ESRCH → unavailable; alive stale, legacy, EPERM (pid 1 for non-root), missing lockPath, future heartbeat, nonce swap → unknown.
- Fail-closed settlement (S37/S39): `completed.payload.reasons` entry = `job.errorCode` (except binding codes), status failed, exits `project_unregistered` 7, `cwd_identity_changed` 7, `execution_profile_invalid` 3 or binding 4/2/6, `queued_age_exceeded` 1, `artifact_admission_mismatch` 1; younger control runs once with exit 0.
- Recovery (S36): one completed `interrupted/worker_stopped`, `job.errorCode worker_interrupted`, wait exit 1 with `result.artifacts: []`, `expires_at` within `[finishedAt+30d−2s, max(finishedAt, recovery now)+30d+2s]`; an alive or EPERM worker with a stale heartbeat stays running (wait `run_pending`).

### C. Storage, raw SQL and boundary assumptions the tests observe

- Tables/columns read raw: `agent_jobs` (`id, status, source, api_consumer_id, input_json, worker_id, worker_pid, heartbeat_at, created_at, finished_at, artifact_manifest_path, ledger_version, error_code`), `agent_job_events` (`job_id, sequence, type, fact_key, payload_json`), `agent_schedules` (`next_run_at`), `projects`, `agent_provider_profiles`, and the reservation table. The idempotency kit finds the reservation table via `sqlite_master` name `LIKE '%idempotency%'` and picks columns by role (`/expire/i`, `/^job|job_?id/i`, `/consumer/i`, `/key_?hash/i`, one row per reservation); the executor kit pins `agent_job_idempotency` with `job_id` and `expires_at`. Use `agent_job_idempotency(…, job_id, key_hash, request_hash, normalization_version, created_at, expires_at)`; `expires_at` may be epoch seconds, epoch ms or ISO, but must equal publish-or-settle time + 2592000000 exactly by the process `Date` (frozen with `setSystemTime` in idempotency tests).
- Key hash must differ from the raw key, SHA-256 hex/base64 of the key, and SHA-256 hex of `consumer+key` / `consumer:key` (domain separation); the raw key is byte-scanned out of the DB, `-wal`, `-shm`, run-dir files, stdout and stderr.
- Test-installed SQLite triggers (`BEFORE INSERT ON agent_job_events WHEN type='job_created' → RAISE(ABORT)`, `BEFORE DELETE ON agent_jobs WHEN source='api' → RAISE(ABORT)`, and insert faults on the reservation table, `agent_jobs`, `agent_job_events`) emulate the creation hold, failed compensation and SQL faults; the implementation must surface these as compensation / `submission_pending`, never as a crash that skips compensation.
- Crash/freeze boundaries are observed on the executing process's SQL: the idempotency child SIGKILLs itself when `Database.prototype.prepare` sees the n-th statement matching `/insert\s+into\s+["`]?agent_job_events/i` (1st = job_created append, 2nd = initial-artifact admission batch) or the first `/update\s+["`]?<reservation table>["`]?\s+set/i` (the one-time expiry setter); the executor child uses Drizzle `logger.logQuery` on `insert into "agent_job_events"` whose bound params contain the literal `artifact_created` (SIGKILL before the first) or `completed` (freeze before the terminal commit), and wraps CJS `fs.renameSync` to freeze before the N-th rename onto `request.json`/`events.jsonl`/`result.json`/`artifacts.json` (an agent artifact Run publishes with 3 renames). Consequences: ledger inserts must stay Drizzle-visible, no additional `agent_job_events` insert may precede `job_created` or sit between `job_created` and the admission batch in the submit path, the expiry setter must be an `UPDATE … SET` on the reservation table, and publication must rename staged files onto those final names.
- Publish-fault injections: a directory planted at `result.json` during the run is a post-commit publication failure (own-pump create keeps `artifacts:[]` + outcome exit; `runs wait` → `terminal_artifacts_pending`/9; expiry stays NULL); deleting then restoring a published terminal file inside the wait's first sleep is "completed before full publication" (SYN-18). **Hazard**: if the preparer pre-checks terminal target names, the obstacle becomes a preparation failure and S14's publish-fault reservation would (legitimately) get an expiry — then the S14 third test needs the tasks 1.5 rename-fault seam instead; raise it rather than weakening the test.
- SQLITE_BUSY in S06 is injected through a proxied `bun:sqlite` connection: post-snapshot faults hit `agent_job*` statements after the first clock sleep; pre-snapshot faults hit statements bound to the job id.
- Lock fixtures: pid symbols `self` (alive), reaped child (ESRCH), pid 1 (EPERM for non-root); freshness 0–5000 ms against the frozen wall clock; lock v2 `{pid, nonce, startedAt, lockFormat:2, apiCapable:true, heartbeatAt}` rewritten atomically ≤1000 ms apart; renames under the lock's directory are never fault points.
- Guard (S32/S33): flag `--local-job-api-async-fixtures=<path>`, default fixture `tests/fixtures/local-job-api-async/guards-protocol/architecture-fixtures.json` included in the default run; summary `Local job API async submission guard self-test: M/N fixture cases matched; repository ownership enforced.`; mismatch `… self-test case <caseId> (<category>) missed <keys|nothing> and produced unexpected <keys|nothing>` with finding keys = JSON of sorted `[key,value]` pairs, exit 1; finding shape `{rule,file,symbol,owner,ownerSection}` with rules `duplicate-definition, duplicate-reexport, retired-symbol, inline-runner-call, independent-dispatch, direct-job-insert, forbidden-store-import`; `ownerSection "Headless Agent Runtime"` echoed from the fixture (change the fixture if a dedicated section is added). Scope: in `cli-dispatcher.ts`, `jobs-stdio.ts`, `local-job-api.ts`, `run-submission.ts` calls to `runPersistedAgentJob`/`runPersistedCompletionJob` and `startAgentJob`/`listQueuedAgentJobsForSource` are forbidden except `cli-dispatcher.ts#runCommand`; retired symbols `runPreparedLocalJobApiJob`, `canonicalRunEventLedgerV1`; `insert(agentJobs)` (any alias) only in `job-store.ts`; `appendExactRunEventBatch` imported only by `run-event-ledger-host.ts`. The existing `Run event ledger guard self-test: 17/17 …` line must remain unchanged.
- jobs-stdio: initialize result must equal today's exactly (S49); a queued protocol job canceled before its claim must produce no `job/error` and no stderr line naming it (S30, F4); job.run ack keys exactly `["job"]` with `serializeAgentJob` key order; `-32602` for extra consumer/key params and cross-session cancel.

### D. Existing tests and artefacts the implementation will touch (expected churn, not red-suite defects)

- `tests/local-job-api-schema.test.ts:134` pins the `discoveryFeature` enum exactly → add `async-submit` (docs `local-job-api-v1.schema.json:106-113`, `src/shared/local-job-api.ts:19-22` features constant; S22 requires the shared constant and the enum to change together).
- `tests/headless-cli-args.test.ts:539` pins `Unknown api runs subcommand: list` → the "Available subcommands" list gains `submit, wait`; check the full message assertion.
- `tests/headless-cli-dispatcher.test.ts:2429` "runs daemon once and claims only daemon queued jobs" stays valid only while it seeds no admitted `source=api` row; the executor's S42 red test adds the api line.
- `tests/run-event-ledger-projection.test.ts:1051/:1073/:1088` keep old S53/S54/S55 titles → register mapping (F7), no test change required.
- `tests/run-event-ledger-guard-self-test.test.ts:95` expects the ledger guard's own label; the new guard section must use its own label.
- `src/main/lib/headless/schedules.ts:323` direct `insert(agentJobs)` must move behind the job-store primitive (S31 static test, S33 `direct-job-insert`).

### E. Register updates needed when the implementation lands

- Fixture paths (F2) and the `cases` shape of `architecture-fixtures.json` (F6); registration records for S43/S45/S52/S54 (F7); seam names ratified in tasks 1.5 (F3); S30 reading (F4) and S19 pending re-issue (F10) confirmed by the spec owner; implementer-unit assignments from §6 added as rows.
- Timing tolerances (F11) and timeouts (F14) are properties of the host harness and should be recorded with the platform/limitations column.

### F. Toy-stub satisfiability (auditor's judgment)

The suite is not satisfiable by trivial stubs. Checked specifically: a submit that prints a queued envelope without persisting fails S01/S29 (committed `job_created` seq 1 and DB row required before ack); a submit that runs inline fails S01/S16/S24 (runner calls at ack must be 0, status queued, `execution` block present); an exported no-op `pumpQueuedRuns` fails S03/S34/S29/S30 (exactly one call scoped to the own ID, scope ⊆ session IDs); a hook that is called but ignored fails S34 daemon-first (wrapper dispatches 0); a wait that re-serializes job+result without verifying publication fails S05/S06/S27 (deleted or obstructed terminal files must be pending; symlink swap pending); constant `execution` or wait reasons fail the S17 nine-row and S06 six-state tables; a daemon that claims api rows without reopen/publish fails S28/S37 (golden prepared tail roles, B-pid worker, zero provider calls on mismatch); a `createdAt`-ordered selector fails S28 slot order (api rows are oldest); listing everything or refusing every claim fails S26; hashing raw bytes or a key-only namespace fails S08/S10; TTL-based orphan deletion fails S13; setting expiry at creation/claim or renewing on replay fails S14; storing plain SHA-256 or the key in `inputJson`/`request.json` fails S15 byte scans; a guard that only prints the summary fails the S32 mutation test (missing/unexpected by case id); adding `async-submit` only to discovery output fails S22 (shared constant and pinned-enum error path); a relay that cancels every Run fails S35 (two unrelated Runs untouched). Weak spots, all disclosed: S25 depends on the wrapper reaching the injected deadline (today's inline create already satisfies the no-leak half); the S32 default-run phrase `repository ownership enforced.` could be printed without scanning, mitigated by the S31 static AST test and the behavioural S03/S29/S48 pump assertions; the 11 green-by-design tests are characterizations and are not stub-proof by construction.

## Receipt

- Receipt path: `openspec/changes/add-local-job-api-async-submit/red-receipt.md` (this file; the only file the auditor wrote).
- Verdict: **CHANGES_REQUESTED** on `0447d02d` — F1 (P1) must be fixed before the suite is committed; F2/F3 (P2) are coordinator decisions recorded for the register; F4–F15 (P3) recorded. With F1 fixed and §2 counts unchanged, the auditor would record RED_SUITE_ACCEPTED without further re-audit of the other three files.

## Coordinator adjudications (2026-10-02, before commit)

- F1 (P1) fixed as a coordinator edit: file-level `biome-ignore-all lint/suspicious/noExplicitAny` headers on
  `tests/local-job-api-async-guards-protocol-kit.ts` and `tests/local-job-api-async-guards-protocol.test.ts`;
  no assertion changed; `biome check` on the ten suite files clean; the PR-base lint ratchet is re-run after
  the commit against main `2c59664f`.
- F2 (P2) resolved by relinking the spec GIVEN clauses, tasks §7 and the register to the per-domain fixture
  subdirectories (`submit-wait/`, `idempotency/`, `executor/`, `guards-protocol/`); split catalog names resolve
  to the domain that carries the case (`controls.json#S18/S20/S35` and `discovery.json#S22/S23` → submit-wait;
  `#S19` and `#S53` → idempotency; `publication.json`/`idempotency.json` per the carrying case).
- F3 (P2) ratified in tasks 1.5: the implementation must adopt `RunHeadlessCliCommandOptions.monotonicClock`
  and `RunHeadlessCliCommandOptions.beforeOwnPumpClaim`; the executor author's deferred S37/S39 wrapper-paused
  variants become implementer-unit items.
- F4 (P3) reading confirmed: a queued protocol job canceled before its claim emits no `job/error` and no
  stderr line naming it (pump-only dispatch).
- F5–F15 recorded; no edit. Verdict closes as **RED_SUITE_ACCEPTED** at the commit that carries this receipt.

## Coordinator adjudications after Phase I (2026-10-02)

Four reds the Phase I implementer reported as blocked were verified as suite defects (the two
verification lenses confirmed S15 and S21 independently) and fixed without changing any
assertion's intent:
- S03 `recordPumpScopes`: bun returns the same mock for an already-spied export, so calls
  accumulated across the eleven sequential create flows; the recorder now `mockClear()`s first.
- S17 leak probe: the EPERM fixture pid is `1`, which every ISO timestamp contains; the pid
  needle now matches a whole number (digit boundaries); other needles unchanged.
- S21: the kit's placeholder regex excluded digits so `{{CORR_5}}`/`{{CORR_6}}` were never
  rendered (`[A-Z_]+` → `[A-Z0-9_]+`); the golden's two literal digests for the initial
  `events.jsonl`/`artifacts.json` (whose bytes embed the run-dir root, run-dependent by baseline
  design) became `{{SHA_INITIAL_EVENTS}}`/`{{SHA_INITIAL_MANIFEST}}`, rendered from the committed
  initial `artifact_created` event (new kit helper `initialArtifactVars`); every other byte of
  the golden stays pinned.
- S15 fixture: the `161-characters` key variant was 157 characters (valid under design D4);
  padded to 161 so it exercises the length rule.
After the fixes the submit-wait and idempotency files pass 46/46 at the Phase I candidate.
The immutable-set baseline for review moves to the commit carrying this note.
