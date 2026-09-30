# TICKET-128 — Run ledger creation atomicity and terminal artifact publish

## Status and evidence

Open follow-up from Owner ACCEPTED 2026-10-01 for
`refactor-canonical-run-event-ledger` source `f5704cb6`. The Owner accepted these
limits for this slice; this ticket does not authorize implementation. Current
behavior and its tests are indexed in the change's `verification.md` under
"S-12 two-commit creation" and "T2-9 residual".

## Current behavior

1. `createAgentJob` inserts the queued job row before it awaits
   `recordAgentJobCreatedOrDiscard` (`src/main/lib/headless/job-store.ts:248-314`).
   The two commits leave a crash window. A normal append failure triggers a
   best-effort queued-row delete (`job-store.ts:319-348`); a crash or failed
   compensation can leave an orphan. Queue listing skips rows lacking a
   `job_created` event (`job-store.ts:430-451`), and the start guard requires
   the `lifecycle:job-created:<id>` fact key (`job-store.ts:464-479`). The
   different predicates should also be aligned. Schedule-owned creation may
   leave the same orphan after its own transaction.
2. Terminal files are staged before the terminal ledger commit and published
   afterward. `publish()` renames staged files one by one
   (`src/main/lib/headless/local-job-api.ts:1089-1106`). A fault or crash between
   renames can expose partial files or a mixed `events.jsonl`/`artifacts.json`
   snapshot; the ledger remains authoritative and registered refs govern
   readers. Unreferenced `.<name>.locus-staged` files are not cleaned after a
   crash, including a crash before commit. The comments at
   `src/main/lib/agent-runtime/run-event-ledger.ts:241-245` and `:1549-1553`
   overstate the file consistency guarantee.

## Suggested scope

- Design one atomic creation boundary for the queued row and committed
  `job_created` fact, including create, retry, schedules, cancellation and
  cross-process races. Define recovery for existing orphan rows and make
  list/start use the same fact-key predicate.
- Design a recoverable terminal publish protocol. A reader must either see
  the prior valid snapshot or the complete committed terminal snapshot; test
  faults after every staged write, SQL commit and rename. Clean unreferenced
  staged files on startup, with run-directory identity checks preserved.
- Correct the consistency comments and document the durable ledger/file
  boundary. Keep public Local Job API changes behind a Consumer Impact decision
  if the protocol or observable artifact contract changes.

## Acceptance evidence to plan

Use fault injection and restart tests for both creation and publication,
including a crash before SQL commit, a crash after commit and every partial
publish point. Verify queued workers never execute an orphan and run-dir
readers never report a mixed snapshot as complete. Require the normal
OpenSpec, architecture, security and packaged-platform gates for the chosen
implementation.
