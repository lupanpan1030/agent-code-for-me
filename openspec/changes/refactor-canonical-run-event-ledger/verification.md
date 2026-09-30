# Verification

Status: **APPROVED 2026-09-07 (Owner; bound to 9ebe6c34); implementation candidate re-frozen 2026-10-01 after touch-up T2 (review synthesis of `a32800b6`: T2-1, T2-2, T2-4…T2-14 closed; T2-3 pending Owner decision); next gate: the targeted re-review of the T2 diff (`a32800b6..` the T2 candidate)**

This file holds the implementation candidate evidence (next section), the scenario
register with red and green evidence, and the historical draft-review receipts.
Passing implementer checks does not mean IMPLEMENTATION_VERIFIED,
REVIEW_APPROVED or Owner ACCEPTED. The third re-check below is REVIEW_APPROVED only
for source 4b6ca640288555ca1d94c546ca6bf9d13e4b7fba; it is not a fresh review verdict
on this subsequent documentation touch-up commit. Owner answers/APPROVED are recorded in the receipt below; historical pending statements
retain their original review-time meaning.

## Implementation Candidate Evidence (Phase III, 2026-10-01)

Implementer: Claude Opus 5.5 (Phases I–III, test-first). Coordinator rulings: Claude
Fable (`84643c99`, `c9bc12a8`). This section records the frozen implementation
candidate. It is implementer evidence only: it is not Codex IMPLEMENTATION_VERIFIED,
not a fresh-context REVIEW_APPROVED and not Owner ACCEPTED.

### Touch-up T2 (review synthesis of `a32800b6`), 2026-10-01

Implementer: Claude Opus 5.5, coordinator dispatch `impl-phase3-touchup2`, scope =
synthesis §4 (`phase3-review-synthesis-a32800b6.md`). The four-review verdict on
`a32800b6` was CHANGES_REQUESTED (3 P1, 9 P2). T2 changes product source, so `a32800b6`
is superseded; the T2 candidate is the commit that adds this section. It is implementer
evidence only (not a re-review verdict, not Owner ACCEPTED).

| SHA | Subject | Closes |
| --- | --- | --- |
| `581cd8e8` | fix(redaction): restore the job store's generic secret arm and key rule for durable records | T2-1 / S-05 (P1) |
| `6c89cfe2` | fix(ledger): settle transport exits with the host terminal projection | T2-2 / S-01 (P1) |
| — | (T2-3 / S-06, `completed.payload` members) | **pending Owner decision** (not done in T2) |
| `f2fa5f1d` | fix(local-job-api): keep registered artifact refs out of the public result | T2-4 / S-10 |
| `1a575a62` | fix(codex): persist Codex assistant metadata from committed usage and native context | T2-5 / S-11 |
| `684d434c` | fix(outcome): count completed-only assistant items as output evidence | T2-6 / S-13 |
| `10a4f821` | fix(outcome): settle native Runs from the committed live native terminal | T2-7 / S-02, S-14 |
| `3fefd163` | fix(codex): record every client response under its JSON-RPC wire id | T2-8 / S-03 |
| `27d14a58` | fix(artifacts): admit native candidates through the run directory handle | T2-11 / S-08, S-09 |
| `09054cd0` | fix(redaction): omit post-seal continuations of withheld stream channels | T2-10 / S-07 |
| `90ca783e` | fix(artifacts): publish terminal run-dir files only after the terminal commit | T2-9 / S-04 |
| `60a723fa` | fix(jobs): never leave or run a queued job without its job_created fact | T2-12 / S-12 |
| `3f215da1` | test: restore exact public payloads and strengthen the ledger writer tests | T2-13 / S-21…S-24 |
| (this commit) | docs(openspec): record touch-up T2 | T2-14 / S-27 |

Consumer-visible effects of T2 relative to `a32800b6` (all restore the base behavior or
the approved design; none extends the signed scope):

- **T2-1:** durable records and the terminal job-row fields again scrub the job store's
  generic `access_token|…|api_key|secret|password` values (any separator, any length)
  and `*token*`/`authorization`/`api_key`/`secret`/`password` keys (numeric `*Tokens`
  counts and nulls kept). Runtime/renderer redaction is unchanged.
- **T2-2:** a transport-exit settlement writes the host's job-row projection (`errorCode`
  `transport_exit`, message, `result_json`) and the final run-dir files; a Locus-initiated
  `transport.close()` after the adapter's own result is never a transport-exit candidate,
  so pre-terminal app-server failures settle `failed` (`codex_app_server_failed`) and an
  API cancel settles `canceled`/exit 5, as at base.
- **T2-4:** the public inner `result` (`runs create/retry/result`) and `job.result` no
  longer carry the store-merged `artifactRefs`; a result that held only refs is `null`.
- **T2-7:** a Codex app-server Run settles `native_terminal` from the committed
  `turn/completed` (`reasons` `native_failed`, `completed.payload.code` = the native
  code, `completed` fact key `settle:<turn/completed observation key>`); the desktop
  finalizer uses the committed native terminal (Codex `turn/completed`, Claude SDK
  `result`) and otherwise `host_result`.
- **T2-8:** `protocol_response`/`native_resume_*` `jsonRpcId` is the JSON-RPC wire id
  (a number from the stdio transport), and `initialize`, `mcpServerStatus/list` and
  `turn/interrupt` responses add `protocol_response` status records.
- **T2-10:** a `late_event` whose stream channel held a withheld potential-secret prefix
  at the seal carries `observation.contentOmitted: true` and `contentLength` instead of
  text; the live renderer drops such a buffered post-terminal stream fragment.
- **T2-11:** native candidates are admitted only as single-link regular files read
  through the run directory handle; `result.json`/`artifacts.json` list each native path
  once with its last admitted digest and omit entries whose file no longer matches.
- **T2-9:** terminal `events.jsonl`/`result.json`/`artifacts.json` appear under their
  final names only after the terminal commit.
- **T2-12:** a create/retry whose `job_created` cannot be recorded leaves no queued row.

Decisions and disclosures recorded by T2:

- **S-12 two-commit creation (disclosed structure, mitigated).** The job row insert and
  `job_created` stay two commits: the ledger ports are asynchronous promises on the Run's
  serial chain while better-sqlite3 transactions are synchronous, so one transaction
  would need a synchronous ledger creation path (a structural change outside a
  touch-up). Mitigation: `createAgentJob`/`retryAgentJob` delete the just-inserted row
  when the fact cannot be recorded (only while queued with no committed record);
  `startAgentJob` refuses a v1 job with no committed `lifecycle:job-created` fact
  (`MISSING_JOB_CREATED`) and the queue listing skips such rows. Residual: a crash
  between the two commits, or a failed fact after a schedule's own transaction, leaves a
  queued orphan that is never executed; it stays queued and cancellable (recovery acts
  on running rows only).
- **T2-9 residual (disclosed).** A crash between the terminal SQL commit and `publish()`
  leaves the committed ledger as the truth with the final files missing (the initial
  `events.jsonl`/`artifacts.json` and unreferenced `.<name>.locus-staged` files remain);
  files are never contradictory. Nothing cleans staged files after such a crash.
- **T2-8.** A transport that exposes no wire id (only test fakes) yields an
  uncorrelated `protocol_response`; no id is invented. The adapter still does not wait
  for the `turn/interrupt` response before closing; it is recorded when it arrives.
- **T2-10.** The post-seal omission is memory-only (like the exact hints): a ledger
  recomposed in another process after the seal starts with fresh stream state.
- **T2-11.** A bare-pathname admission context (tests) is anchored for that one
  admission; the host always passes the run directory handle.
- **T2-2 desktop.** The desktop job host also registers a job-row projection, so a
  desktop Codex transport exit records an error code and message.

Follow-up register (recorded, not fixed in T2; synthesis §6): S-15 usage-decrease guard
compares to the baseline, not the last total; S-16 `flushLate` makes one raw append per
buffered late entry; S-17 ID-less coarse usage dedupe hashes the payload and desktop
Claude `messageMetadata` vectors are not extracted; S-18 store backstops for post-seal
`jobMutation`/`artifactRefs`/`terminalSequence` and provenance immutability, stale
cached provenance; S-19 `never_claimed` ignores execution evidence and same-PID reuse;
S-20 completion seals `locusBuild:"unknown"`; S-25 `runs result` takes path/type/size
from the workspace-writable manifest keyed on role+digest (pre-existing); S-26 Codex/exec
spawn the unresolved path after the realpath check; S-28 Owner product note: after
`NATIVE_RESUME_REJECTED` a Claude sub-chat keeps retrying the missing session until
Phase 5 binding repair; S-29 release runbook: stop old daemons before upgrading (v1
default with an old writer attached) and surface stuck v0 queued/running rows. Lens B
notes: the legacy-symbol scan walks `src/` only; `--run-event-ledger-fixtures=` also
replaces the repository pins (CI never passes it); the `job-store.ts` ↔
`run-event-ledger-host.ts` import cycle is intended.

### Touch-up T1 (gaps G1–G5), 2026-10-01

Implementer: Claude Opus 5.5, coordinator dispatch `impl-phase3-touchup1`. T1 closes the
five gaps Phase III reported (G1–G5 below) before the fresh review. It changes product
source, so the Phase III candidate `2d0b0da0` is superseded. Statements later in this
section that say the source is unchanged since `e7198bc7` describe that Phase III
candidate only.

| SHA | Subject | Closes |
| --- | --- | --- |
| `77003130` | feat(store): expose internal historyQuality read metadata for pre-ledger jobs | G1 |
| `771d3f63` | fix(claude): re-check the bound executable before the Agent SDK spawn | G4 |
| `be098376` | feat(codex): repair from the validated thread/resume snapshot | G3 |
| `5b1ffd3e` | feat(artifacts): admit Codex native artifact candidates through the host | G2 |
| `e9170cd4` | feat(headless): return the committed outcome from the runner facades | G5: S04, S06 |
| `316859e3` | fix(local-job-api): list only ledger-registered refs in the result reader | G5: S30 |
| `00b33a13` | feat(recovery): accept a supervisor-observed worker exit as confirmation | G5: S24 |
| `10fd4482` | test: cover the desktop request contract, Codex ingress order and guard self-test | G5: S08, S09, S41, S38/S40 |
| `583fb3a1` | docs(local-job-api): document native artifact roles and registered result refs | G2 documentation |
| `06e73bcd` | docs(ownership): record the touch-up owners of the run event ledger | OWNERSHIP_MAP |
| `80a6590a` | docs(openspec): check off the touch-up tasks and point STATUS at the handoff | tasks 7.13/7.17, STATUS |
| `b0f3e60d` | style(test): sort the run event ledger unit test imports | PR-base lint ratchet (T1 finding 7) |
| the commit that adds this subsection | docs(openspec): record the touch-up T1 candidate evidence | frozen candidate (named in the handoff) |

Diff `2d0b0da0..b0f3e60d`: 41 files, +4596/−107; `src`/`scripts`/`drizzle`: 21 files, +813/−41;
`tests`: 15 files, +3633/−4; `docs`/`openspec`: 5 files, +150/−62.

**Closures.**

- **G1** — `src/main/lib/headless/job-store.ts` `runEventHistoryQuality` labels
  `ledger_version=0` jobs `legacy_unverified` (v1: `ledger`) and adds it to the internal
  `RunEventLedgerHeader`. tRPC `agentJobs.logs` (renderer-only Workbench read) returns it
  beside the job and events. The single Workbench reader
  (`workbench-trace-presenter.ts`, `withWorkbenchHistoryQuality` /
  `getWorkbenchSemanticPayload`) unwraps only `legacy_unverified` wrapper rows; a ledger
  row with a wrapper-shaped bare payload stays bare. No public v1 job/result/event
  envelope, jobs CLI or jobs-stdio serializer carries it (S13 absence stays green).
  Tests: `tests/run-event-ledger-history-quality.test.ts` (4).
- **G2** — `codexNativeArtifactEvidence` (`src/main/lib/codex/app-server-stream-events.ts`)
  statelessly derives candidate evidence from completed `imageGeneration.savedPath`,
  completed `fileChange` target paths (deletes skipped, `move_path` followed) and non-empty
  `turn/diff/updated` diffs. The host composes `createRunArtifactCandidateSink`
  (`run-event-ledger-host.ts`) only for a Run with an admitted run directory (API runs, via
  the new `artifactRunDir` option of `runPersistedAgentJob`, passed by the dispatcher and
  handed to the app-server adapter by the headless wrapper). The adapter forwards evidence
  after each notification, flushes a turn's latest diff before submitting that turn's
  `turn/completed`, and drains the sink before reading usage, so every admission precedes
  `completed`. `run-artifacts.ts` admits with the proposal's roles `native-file`,
  `native-image`, `native-diff` (replacing `native`), publishes the public artifact shape
  `{role, path, sha256, contentType, sizeBytes}`, stages a diff with its hardened writer
  inside the run directory only (`admitRunArtifactContent`; content with an exact secret or
  over 64 MiB is rejected before any write), redaction-checks the admitted path, records
  the `role` (never a path or content) on rejections, and requires the execution binding
  for native publication. Candidates outside the run directory become
  `status/artifact_admission` `out_of_scope`. The terminal preparer lists admitted native
  entries after the Locus run-dir files in `result.json` and `artifacts.json`. The public
  artifact `role` is an open string in `docs/local-job-api-v1.schema.json` and
  `src/shared/local-job-api.ts`, so no schema or enum changes; both guides document the
  roles. Desktop, daemon, schedule, batch and completion runs have no run directory and
  submit nothing. Tests: `tests/run-event-ledger-native-artifacts.test.ts` (8), including an
  API create through the Codex app-server wrapper.
- **G3** — `repairFromValidatedResumeSnapshot` (`src/main/lib/codex/app-server-adapter.ts`)
  runs only after the ledger committed `native_resume_validated` for the `thread/resume`
  response. It submits the response's thread snapshot with `schemaDisposition` from
  `classifyCodexThreadSnapshot` (recognized when every turn and item matches the pinned
  ThreadItem table, otherwise incompatible), `sourceProvenance` `{kind, runtimeId, version:
  thread.cliVersion}` and a `targetTurnId` only when the Run itself observed that turn.
  The adapter awaits it before `turn/start`. A fresh desktop resume therefore records
  `status/repair` (and any usage baseline) without prior-turn item drafts, so no earlier
  turn's text enters the new Run's committed assistant history; post-seal the ledger
  records `status/late_event`. Rejected resumes and responses without a `turns` snapshot
  submit nothing. Tests: `tests/codex-app-server-resume-snapshot.test.ts` (8).
- **G4** — `createClaudeAgentSdkDesktopJob` returns the tuple it bound and the desktop
  request carries it (host-only `DesktopRunRequest.executionProvenance`).
  `assertClaudeAgentSdkExecutableUnchanged` (`src/main/lib/claude/agent-sdk-adapter.ts`) runs
  `assertRunExecutableUnchanged` and requires the query's `pathToClaudeCodeExecutable` to
  resolve to the captured executable, immediately before `sdkQuery()`. A change fails
  closed as `ClaudeAgentSdkQueryStartError` with no runtime record (only the host
  adapter-started status exists). Tests: `tests/claude-agent-sdk-executable-check.test.ts` (5).
- **G5** — implementer-unit tests: S04 and S06 `tests/run-event-ledger-runner-facade.test.ts`
  (2; the facades now return `outcome = readOutcome()`); S30
  `tests/run-event-ledger-terminal-commit-faults.test.ts` (4); S24
  `tests/run-event-ledger-recovery-variants.test.ts` (3); S08/S09
  `tests/run-event-ledger-desktop-request.test.ts` (2); S41
  `tests/codex-app-server-ingress-order.test.ts` (1); S38/S40
  `tests/run-event-ledger-guard-self-test.test.ts` (1). The three fixtures the tasks name
  (`coarse-process.json`, `desktop-request.json`, `terminal-artifacts.json`) are in the
  implementer root `tests/fixtures/run-event-ledger-units/`, because the red root
  `tests/fixtures/run-event-ledger/` is immutable. S19's native-index variant still waits
  on task 1.4.

**Decisions and findings in T1, for the review.**

1. **Result reader exposure (found by the S30 test, fixed in `316859e3`).** Terminal files
   are prepared before the SQL commit. `api runs result` read `artifacts.json` from disk
   unconditionally, so a refused or crashed terminal commit exposed the prospective
   `result`/`manifest` refs while the job was still `running`. The reader now lists only
   manifest entries whose role and digest the ledger registered: the refs committed with
   `completed`, or the committed `artifact_created` refs before it. Committed runs list
   exactly what they did before; v0 jobs keep their historical manifest.
2. **Path-only native evidence has no independent digest.** `expectedSha256` is optional;
   the admitted digest is the owner's stable read, and `digest_mismatch` applies to
   candidates that claim a digest (staged diffs claim their content digest).
3. **Diff staging.** The turn's final diff is written by the artifact owner as
   `native-diff-<n>.patch` inside the admitted run directory (no new scope). Earlier
   updates of the same turn are superseded and never written.
4. **Admitted payload shape.** The native `artifact_created` entry drops `name` and carries
   `path` so it matches the public artifact shape; the rejection adds `role`.
5. **Recovery basis.** The same-host probe may report `exited` (supervisor-observed exit,
   basis `worker_exit_observed`), as the design's "ESRCH/observed worker exit" allows. The
   default probe is unchanged; no production supervisor reports it yet.
6. **Fixture root.** Implementer fixtures live outside the immutable red root (see G5).
7. **PR-base lint ratchet (pre-existing, outside T1).** `check:full` runs `lint:changed`
   against the working tree only. CI sets `BIOME_CHANGED_SINCE` to the PR base
   (`.github/workflows/ci.yml:42`). `BIOME_CHANGED_SINCE=2d0b0da0 node
   scripts/run-biome-changed.mjs` (the T1 diff) passes. Against `main` `25c075af`, it
   reports blocking `noExplicitAny` warnings in the immutable red files
   `tests/run-event-ledger-guards.test.ts:55` and `tests/run-event-ledger-projection.test.ts:75`
   (baseline 0). T1 cannot change those files or raise the baseline, so this needs an Owner
   or coordinator ruling before CI. T1 fixed the other blocking item, Phase I's
   `tests/run-event-ledger-units.test.ts` import order (`b0f3e60d`).

**Gates at `b0f3e60d`** (the candidate commit changes only this file on top of it):

| Check | Exact command | Result |
| --- | --- | --- |
| Aggregate gate | `bun run check:full` | Exit 0 in 2m25.7s: `lint:changed` pass (clean tree; see finding 7 for the PR-base ratchet); `architecture:check` "Run event ledger guard self-test: 17/17 fixture cases matched; repository ownership enforced. Architecture guard passed."; `retired-runtime:check` 1770 files scanned, 10 allowlisted; `tsc --noEmit` clean; `bun test --isolate tests` 2703 pass / 0 fail, 13551 `expect()` calls, 344 files; `openspec validate --all --strict` 54 passed, 0 failed; `electron-vite build` main, preload and renderer built; `check-patch-whitespace` pass |
| Nine acceptance files | `bun test --isolate tests/run-event-ledger-{core,reconciliation,terminal,provenance-resume,projection,guards,vocabulary,store-faults,boundaries}.test.ts` | 141 pass / 0 fail, 1265 `expect()` calls; JUnit 141 test cases, 0 failures, 0 skipped |
| T1 implementer tests | `bun test --isolate` over the ten new test files | 38 pass / 0 fail, 446 `expect()` calls, 10 files |
| Single strict validation | `openspec validate refactor-canonical-run-event-ledger --strict --no-interactive` | Exit 0: `Change 'refactor-canonical-run-event-ledger' is valid` (OpenSpec 1.10.0) |
| All strict validation | `openspec validate --all --strict --no-interactive` | Exit 0: `Totals: 54 passed, 0 failed (54 items)` |
| Whitespace | `git diff --check e63457a5 HEAD` and `node scripts/check-patch-whitespace.mjs` | Both exit 0 with no output |
| Immutable red set | `git diff e63457a5 HEAD --` over the nine red files, the four kits/harness files, `tests/fixtures/run-event-ledger/` and `red-slice-receipt.md`; `git diff 2d0b0da0 HEAD -- red-receipt.md` | Both empty |
| Ratchets | `git diff 2d0b0da0 HEAD -- lint-baseline.json scripts/architecture-baselines.json` | Empty: `lint-baseline.json` unchanged since Phase III (still only shrunk from `e63457a5`, +8/−17 lines); `reachThroughWrappers` unchanged |

**Lint ratchet closure (2026-10-01).** This closes finding 7.
- Coordinator adjudication `e99b9892` added `biome-ignore` above the two `type Json = any`
  lines in the immutable red files and above the identical character class in
  `tests/run-event-ledger-domain-b-kit.ts` (recorded in `red-receipt.md` §8.4).
- `41a6d32b` drops the unused `isNull`/`lt`/`or` drizzle imports from
  `src/main/lib/headless/job-store.ts`.
- At `41a6d32b`, `BIOME_CHANGED_SINCE=25c075af node scripts/run-biome-changed.mjs`
  (`main` = `origin/main`) exits 0. It reports no changed-line diagnostic and no baseline
  excess, only the note "Biome reported diagnostics only outside changed lines; ignoring
  legacy file diagnostics."
- On that tree, `bun run check:full` exits 0 in 2m31.6s: 2703 pass / 0 fail, 13551
  `expect()` calls, 344 files; strict 54/54; build OK. The nine red files pass 141/141.
- The new frozen candidate is the commit that adds this paragraph on top of `41a6d32b`;
  the handoff names its SHA, since a commit cannot name itself. It supersedes `8efe516b`.

### Candidate identity (Phase III, superseded by T1)

- Worktree `/home/chen/projects/locus-refactor-canonical-run-event-ledger-draft`, branch
  `codex/refactor-canonical-run-event-ledger-draft`, based on `main` `25c075af`.
- Red suite: `339c4e6e` (suite), `b8830be5` (follow-up slice), `e63457a5` (register).
- Phase I: `645d89d3`..`d8779d33`, rulings `84643c99`. Phase II: `12d75c50`..`e7198bc7`,
  rulings `c9bc12a8`. Phase III (documentation only): `e536febd` (consumer guides),
  `b0d60796` (OWNERSHIP_MAP), `9dc1cbc5` (tasks and STATUS row), then `2d0b0da0` (this
  section). `2d0b0da0` was the Phase III frozen candidate; touch-up T1 (above) supersedes it,
  and the T1 candidate is named in the handoff because a commit cannot name its own SHA.
- Product source freeze: `git diff e7198bc7 <candidate> -- src tests scripts drizzle
  package.json bun.lock lint-baseline.json` is empty. Phase III changed only `docs/` and
  `openspec/`. Implementation diff `e63457a5..e7198bc7`: 98 files, +14697/−3905
  (src/scripts/drizzle 57 files, +11433/−2613; tests 37 files, +3141/−1263).
- Immutable red set: `git diff e63457a5 <candidate> --` over the nine
  `tests/run-event-ledger-*.test.ts` files, the four kits/harness files,
  `tests/fixtures/run-event-ledger/` and `red-slice-receipt.md` is empty. `red-receipt.md`
  changed only through the appended coordinator rulings in `84643c99` and `c9bc12a8`.
- Ratchets: `lint-baseline.json` only shrinks from `e63457a5` (+8/−17 lines: entries removed
  or lowered, none added or raised);
  `scripts/architecture-baselines.json` changes only `routeSurfaceRatchets` for
  `src/main/lib/trpc/routers/codex.ts` (957 → 941 lines); `reachThroughWrappers` unchanged.

### Gate commands and output (Phase III)

Superseded by the T1 gates above. Measured at `9dc1cbc5` on 2026-10-01 (Bun 1.3.14, Node v24.19.0, Ubuntu 24.04.4 on WSL2
kernel 6.18.33.2). The candidate differs from `9dc1cbc5` only by edits to this
`verification.md`; the handoff reports the same commands rerun at the candidate SHA.

| Check | Exact command | Result |
| --- | --- | --- |
| Aggregate gate | `bun run check:full` | Exit 0 in 2m18.6s: `lint:changed` pass; `architecture:check` "Run event ledger guard self-test: 17/17 fixture cases matched; repository ownership enforced. Architecture guard passed."; `retired-runtime:check` 1756 files scanned, 10 allowlisted; `tsc --noEmit` clean; `bun test --isolate tests` 2665 pass / 0 fail, 13105 `expect()` calls, 334 files; `openspec validate --all --strict` 54 passed, 0 failed; `electron-vite build` main, preload and renderer built; `check-patch-whitespace` pass |
| Nine acceptance files | `bun test --isolate --reporter=junit --reporter-outfile=<file> tests/run-event-ledger-{core,reconciliation,terminal,provenance-resume,projection,guards,vocabulary,store-faults,boundaries}.test.ts` | 141 pass / 0 fail, 1265 `expect()` calls; JUnit: 141 test cases, 0 failures, 0 skipped. Per-scenario counts are in the register below |
| Single strict validation | `openspec validate refactor-canonical-run-event-ledger --strict --no-interactive` | Exit 0: `Change 'refactor-canonical-run-event-ledger' is valid` (OpenSpec 1.10.0 from this worktree's `node_modules`) |
| All strict validation | `openspec validate --all --strict --no-interactive` | Exit 0: `Totals: 54 passed, 0 failed (54 items)` |
| Whitespace | `git diff --check e63457a5 HEAD` and `node scripts/check-patch-whitespace.mjs` | Both exit 0 with no output |

Stderr noise in the aggregate log (forced remark/Shiki failures, hydration warnings,
TerminalRouter scope errors, a mocked migration failure, symlink-escape reads) comes from
deliberately negative tests that pass; none is a failure.

### 8.4 deletion and single-writer evidence

Rerun at the T1 tree `b0f3e60d`; every result matches Phase III except that the insert line moved:

| Claim | Command | Result |
| --- | --- | --- |
| Gate constant and transition mode gone | `grep -rnE 'canonicalRunEventLedgerV1\|run-event-ledger-phase\|RUN_EVENT_LEDGER_PHASE_FLAG\|TRANSITION_LEGACY_RESIDUE\|TRANSITION_DIRECT_EVENT_INSERTS' src scripts package.json`; `grep -n '"transition"' scripts/check-architecture-guards.mjs` | 0 and 0 matches; the guard always runs canonical mode |
| job-event-bridge deleted | `ls src/main/lib/agent-runtime/job-event-bridge.ts`; `git log --diff-filter=D -- <that path>` | No such file; deleted in `12d75c50` |
| Eleven retired symbols | `grep -rlw <symbol> src` and `grep -rlw <symbol> scripts` for `mapDesktopStreamChunkToRunEvents`, `createDesktopStreamEventMapper`, `appendRunEventsToAgentJob`, `redactRendererDiagnosticChunk`, `redactRendererRuntimeChunk`, `createRuntimeRendererChunkEmitter`, `createRuntimeStreamChunkSecretRedactor`, `isDesktopRuntimeFailureChunk`, `persistedPayloadForRunEvent`, `createAgentJobRunEvent`, `appendAgentJobEvent` | 0 files each in `src` and `scripts` (three comment-only mentions remain in baseline tests) |
| Legacy store writers | `grep -rnwE 'interruptStaleAgentJobs\|completeAgentJob\|requestCancelAgentJob\|insertAgentJobEventRecord\|withEventSequenceRetry\|nextEventSequence' src` | 0 matches |
| One physical event writer | `grep -rnE 'agent_job_events\|agentJobEvents\)' src \| grep -iE 'insert\|update\|into\|delete'` | only `src/main/lib/headless/job-store.ts:930 .insert(agentJobEvents)` inside the private `insertExactRunEventRecord` |
| One importer of the exact batch | `grep -rlw appendExactRunEventBatch src` | `job-store.ts` (definition) and `run-event-ledger-host.ts` (sole importer); guard `APPEND_EXACT_RUN_EVENT_BATCH_IMPORTERS` (`scripts/check-architecture-guards.mjs:3116`) |
| SESSION_EXPIRED path removed | `grep -rn 'SESSION_EXPIRED\|Session expired' src` | 0 matches; the card reads "Session resume rejected" (`src/renderer/features/agents/lib/ipc-chat-transport.ts:158`) |
| v1 fact-key invariant | `bun test --isolate tests/ledger-v1-fact-key-invariant.test.ts` | green in the aggregate run: every lifecycle writer leaves only fact-keyed, metadata-bearing rows on `ledger_version=1` jobs |

### Implementation decisions (within the design's latitude)

Coordinator rulings of 2026-10-01 (`c9bc12a8`) on the seven decisions reported at the
end of Phase II:

1. **Coarse non-usage observations of an unbound runner are admitted with pending
   provenance — accepted with disclosure.** `ingestRuntimeObservation` requires binding
   only for `usage_update` (`src/main/lib/agent-runtime/run-event-ledger.ts:1808-1814`).
   Every real runner binds before it spawns or sends its first runtime record:

   | Runner | Binding point |
   | --- | --- |
   | Codex headless `exec` (batch) | `src/main/lib/headless/adapters/codex.ts:118-125` resolves `resolveBundledCodexCliPath` and binds before `runProcess` (:126) |
   | Claude headless `-p` (batch) | `src/main/lib/headless/adapters/claude-code.ts:184-191` resolves `getBundledClaudeBinaryPath` and binds before `runProcessAgentTask` (:192) |
   | Shared headless hand-off | `src/main/lib/headless/process-runner.ts:485-504` captures, hands the tuple to `observer.recordExecutionProvenance` (`src/main/lib/headless/job-runner.ts:250-252` → `bindRunExecutionProvenance`, `src/main/lib/agent-runtime/run-event-ledger-host.ts:226-231`), then re-checks the executable bytes (:503) |
   | Codex app-server, desktop and headless `policy-grant` | `src/main/lib/codex/app-server-adapter.ts:307-319` captures, binds and re-checks before `createCodexAppServerStdioTransport` (:321); an injected transport binds at :295-300 |
   | Claude desktop (Agent SDK) | `src/main/lib/claude/agent-sdk-desktop-job.ts:172-173` binds `captureClaudeAgentSdkExecutionProvenance` (:48-60) during job setup and hands the tuple to the request; `src/main/lib/claude/agent-sdk-adapter.ts:201` re-checks it (`assertClaudeAgentSdkExecutableUnchanged`, :75-100) immediately before `sdkQuery()` (:202) — gap G4 closed in T1 |
   | Completion (provider only) | `src/main/lib/headless/completion-runner.ts:588-598` binds the `locus-completion` tuple before the model request and usage |
   | Fixture and fake runners | `LOCUS_HEADLESS_FAKE_RUNNER=1` (`src/main/lib/headless/job-runner.ts:100-104, 307`) and injected test runners never bind; their coarse records stay pending, which is a test shape, and their usage is rejected |

2. **Old active `ledger_version=0` rows drain with the old build — accepted** (design
   Migration Plan, task 2.9). The queue listing (`src/main/lib/headless/job-store.ts:398`)
   and recovery (`src/main/lib/headless/job-recovery.ts:123`) act only on v1 rows, and an
   append to a v0 job fails with `LEDGER_V0_APPEND_REJECTED` (`job-store.ts:972-975`).
   Draining a real profile before upgrade is an Owner release step; the consumer guides
   state it.
3. **Headless app-server runs settle with `host_result` — referred to the fresh review; not
   changed in source.** Current state: `headlessOutcomeEvidence`
   (`src/main/lib/headless/job-runner.ts:418-484`) builds the trigger for every headless
   adapter from the runner's `AgentRuntimeRunResult`: `cancel`/`interrupt`, otherwise
   `host_result` with the runner status (:444-461, observation key
   `runner-result:<jobId>`). For the Codex app-server profile the native `turn/completed`
   is still committed as a record, and the adapter's result status is derived from it
   (`src/main/lib/codex/app-server-adapter.ts:788-806`); desktop Codex settles
   `native_terminal` (`src/main/lib/desktop-agent-jobs.ts:311-355`, trigger at :332). The design limits
   `host_result` to "process batch/completion only" (design Test-facing Contract,
   `OutcomeEvidence`). Observable difference: status precedence is identical, but a
   failed headless app-server run reports `host_failed` rather than `native_failed` and
   carries no native terminal `code`. Implementer rationale: the job runner is the one
   settlement point for all headless adapters and owns the outcome evidence of both
   terminal branches without distinguishing adapter kinds. Related: Codex response
   correlation records use local ids `locus-<n>` as the request id
   (`app-server-adapter.ts:1040-1097`), because the transport assigns and pairs the wire
   JSON-RPC id internally and returns only the result
   (`src/main/lib/codex/app-server-transport.ts:69-72, 487-499`); JSON-RPC error codes are
   kept. If the review judges either a deviation, it becomes a remediation slice.
   **Ruled non-conformant by the review synthesis of `a32800b6` (§3.1) and resolved in
   touch-up T2:** T2-7 (native terminal evidence) and T2-8 (wire-id correlation for
   every client response).
4. **Schema identity over compiled-in schema documents — accepted with disclosure.**
   `ExecutionProvenance.schemaFiles` fingerprints the schema documents compiled into the
   adapter, not files read at run time: `codex-app-server/v2/dispositions.json` (the pinned
   disposition tables, `src/main/lib/codex/app-server-stream-events.ts:802-825`),
   `claude-agent-sdk/stream-json-messages.json`
   (`src/main/lib/claude/agent-sdk-desktop-job.ts:32-41`),
   `locus-process-runner/stdio-observations.json`
   (`src/main/lib/headless/process-runner.ts:464-477`), and for completion a
   `schemaSha256` over the provider protocol and response format. The manifest is sorted
   by relative path, has a per-file SHA-256 and the versioned encoding
   `locus.run-schema-manifest.v1` (`src/main/lib/agent-runtime/run-provenance.ts:22,
   104-131`). These documents describe Locus's decode surface; they are not the upstream
   0.139 protocol schema bytes, which the repository does not vendor (task 1.4 open).
5. **Claude desktop completion waits for the renderer channel to drain, and the flush drops
   withheld prefixes — accepted** (red-slice adjudication 6; `84541e00`).
6. **Artifact refs are merged into `result_json` by the store in the terminal commit —
   accepted** (design: same commit, no second truth table;
   `src/main/lib/headless/job-store.ts:944-951, 1029-1032`).
7. **Consumer-visible changes — documented in both consumer guides** (`e536febd`), with
   the C7 check below.

### Consumer-visible changes against the signed scope

Signed scope: Owner answers 2026-09-07 (R1 = DIRECT_NEW_STANDARD for C7 rows 4/5; answers
2–4) and the proposal's Consumer Impact at `9ebe6c34`.

| # | Change | Signed basis | Classification |
| --- | --- | --- | --- |
| 1 | Denied, invalid-output and empty-output runs become `failed`/exit 1; retry diagnostics followed by success stay `succeeded` | R1, C7 rows 4/5 | In scope |
| 2 | Dense per-record projection, more `status` records, `--after` paging, no bounded count | Owner answer 4, C7 row 5 | In scope |
| 3 | `canonical-run-ledger` feature, closed enum extension, optional experimental `payload.extensions["runtime.codex.v1"]`, preserved string `payload.runtime` | C7 rows 2/10, local-job-api delta | In scope |
| 4 | Bare payloads; the desktop wrapper disappears | C7 row 1 (internal wrapper) | In scope; no change for API jobs |
| 5 | Additive `error.classification`, usage snapshot members, `late_event`, `subtype: "system_lifecycle"` on host status | C7 row 10, local-job-api delta | In scope |
| 6 | `completed.payload` becomes the ledger outcome; `exitCode`, `errorCode`, `errorMessage`, `result` are no longer event payload members (they stay on the job row and the result envelope) | The events row says "Additive except R1 terminal payload" and the design defines `completed.payload`; C7 row 1 says no field is deleted and the member removal is not enumerated. The guide already listed event payload details beyond the envelope as not stable | **pending Owner decision (T2-3)** — review synthesis S-06 (P1 governance): Owner acknowledgment in Consumer Impact rows 1/5 + §10, or additive restore |
| 7 | Persisted redaction marker becomes `<redacted>` (the store previously also wrote `[redacted]`, `[redacted-jwt]`, `[redacted-pem]`) | C7 row 7 keeps redaction inside the promised boundary; the marker text was never documented | **Beyond explicit wording — for review** |
| 8 | Stale workers that are alive, EPERM, unknown or claimed without a PID stay `running` with a host `heartbeat_only` diagnostic instead of being interrupted | Design/task 4.3; the Owner-approved core recovery scenario (`specs/agent-runtime-core/spec.md`) | In scope via the approved spec (synthesis §3.2); now listed in proposal Consumer Impact row 4 (T2-14, S-27) |
| 9 | Workbench no longer renders Codex "file-change" rows (`patchUpdated` → `tool_delta` with `changeCount`, `turn/diff/updated` → `status/diff_observation`) | Parity delta disposition table; Workbench rendering is outside C7 §9.1 | Conforms to the table; UX change not enumerated — for review and Owner product acceptance |
| 10 | Codex app-server API runs submit native candidates; admitted entries use the proposal's roles `native-file`/`native-image`/`native-diff` and follow the Locus run-dir files in `result.json`/`artifacts.json`; rejections carry `role` | Proposal artifact row and C7 row 8 ("Newly admitted native artifacts add entries") | In scope after T1 (was a deviation, gap G2) |
| 12 | `runs result` lists only manifest entries the run's ledger registered; identical for committed runs, hides prospective refs while a terminal commit is pending or failed | Design "Artifacts and Terminal Commit Order" | Conforms to the design (T1 finding 1; synthesis §3.2). T2-4: the registered refs stay a reader detail; the public inner `result`/`job.result` no longer carry `artifactRefs` |
| 11 | Failed headless app-server runs report `host_failed` without a native `code` | — | Resolved by T2-7: app-server Runs settle `native_terminal` from the committed `turn/completed` (`native_failed`, native `code`); exec/completion Runs and pre-terminal adapter failures keep `host_result` (`host_failed`) |

### Gaps observed during Phase III (closed by touch-up T1)

These were found while documenting Phase III (which made no source change). Touch-up T1
closed G1–G5; see "Touch-up T1" above for the commits and tests. The text below keeps the
Phase III description, with Phase III line references.

- **G1 — `historyQuality` reader.** The core delta's historical scenario says the internal
  store/Workbench read projection exposes `historyQuality=legacy_unverified`. No reader
  exposes it: the store header exposes `ledgerVersion` (`job-store.ts:1082`) and the
  Workbench unwrap is shape-based (`workbench-trace-presenter.ts:202-209`). The red S13
  tests assert the v0 bytes, labeling and constraints but not this field.
- **G2 — native artifact candidates.** `admitRunArtifactCandidate`
  (`src/main/lib/agent-runtime/run-artifacts.ts:212-243`) has no production caller;
  Codex `turn/diff/updated`, `imageGeneration.savedPath` and `fileChange` do not feed
  candidates to the artifact owner as the parity table says. The admitted role literal is
  `native` (:231).
- **G3 — snapshot repair caller.** `repairFromSnapshot` is implemented and green (S35–S37)
  but has no production caller; a Codex `thread/resume` response is recorded only as
  `native_resume_validated`/`native_resume_rejected`.
- **G4 — Claude capture-to-launch check.** The Claude Agent SDK path binds provenance at
  job setup but does not re-check the executable bytes before the SDK spawns it; the
  process runner and the app-server adapter call `assertRunExecutableUnchanged`.
- **G5 — implementer-unit coverage.** Partially asserted: S04 (the runner facade does not
  return the completed sequence), S06/S08/S09 (`coarse-process.json` and
  `desktop-request.json` not materialized; no fake desktop adapter through injected
  ports), S30 (no before-SQL-commit or after-commit-before-projection fault injection;
  `terminal-artifacts.json` not materialized), S41 (no spy-ledger port-order test over
  `ingress-boundaries.jsonl`), S24 (supervisor-observed-exit basis and changed claim or
  heartbeat at commit not asserted), S38/S40 (the guard fails on missing or unexpected
  findings, `scripts/check-architecture-guards.mjs:4491-4510`, but no test injects a
  mismatch) and S19 (native-index variant waits on task 1.4). All but S19 closed in T1.
- **Baseline rewrites.** `e7198bc7` rewrote 32 baseline test files and `75628977` updated
  the §8.4 baselines with before/after evidence; the coordinator asked the review to
  confirm no assertion was weakened (`c9bc12a8`).

### 8.5 smoke matrix

Probe (2026-10-01, this host): `node_modules/electron/dist/electron` (Electron 39.4.0)
cannot start: `error while loading shared libraries: libnspr4.so`; `ldd` also reports
`libnss3.so`, `libnssutil3.so`, `libsmime3.so` and `libasound.so.2` missing. Attempted in a
disposable profile: `LOCUS_USER_DATA_DIR=$(mktemp -d) LOCUS_HEADLESS_FAKE_RUNNER=1
node_modules/electron/dist/electron out/main/index.js --locus-headless-cli api runtimes
list --json --no-probe` and `... api projects register --cwd <tmp> --json` both exit 127
with that error, and so does `resources/cli/locus api runtimes list --json --no-probe`
through a temporary `LOCUS_HEADLESS_EXECUTABLE` wrapper. The bundled runtimes are not
present in this worktree (`resources/bin/` absent), `DISPLAY` is unset (WSLg is present at
`/mnt/wslg`), and no macOS or Windows host is available.

| Smoke item | Result | Reason |
| --- | --- | --- |
| API create/status/events/`--follow`/result and run-dir artifacts, disposable profile, fake runner | host-blocked | Electron shared libraries missing (exit 127 above) |
| API cancel and retry | host-blocked | Electron; needs a running real-runtime job to cancel |
| Headless exec: Codex `exec` and Claude `-p` | host-blocked | Electron; bundled runtimes not downloaded; runtime credentials |
| Headless Codex app-server (`executionProfile: "policy-grant"`) | host-blocked | Electron; bundled Codex; credentials |
| Completion (`kind: "completion"`) | host-blocked | Electron; needs a stored provider profile with credentials |
| Desktop/Workbench Claude and Codex (development build) | host-blocked | Electron shared libraries (same as TICKET-126); `DISPLAY` unset; credentials |
| macOS packaged | not claimed | no macOS host |
| Windows packaged | not claimed | no Windows host |

Rerun on the Owner host (after `sudo apt-get install -y libnspr4 libnss3 libasound2t64
libxss1`, at the exact candidate SHA):

```bash
bun run build
export LOCUS_USER_DATA_DIR="$(mktemp -d)"
L="node_modules/electron/dist/electron out/main/index.js --locus-headless-cli"
PROJ="$(mktemp -d)" && git -C "$PROJ" init -q
# A. API lifecycle without credentials (fake runner; it never binds provenance)
LOCUS_HEADLESS_FAKE_RUNNER=1 $L api runtimes list --json --no-probe   # features has canonical-run-ledger
LOCUS_HEADLESS_FAKE_RUNNER=1 $L api projects register --cwd "$PROJ" --json
printf '%s\n' "{\"apiVersion\":\"locus.local-job.v1\",\"consumer\":{\"id\":\"smoke\"},\"project\":{\"cwd\":\"$PROJ\"},\"runtime\":{\"id\":\"codex\"},\"mode\":\"plan\",\"prompt\":{\"text\":\"smoke\"},\"artifacts\":{\"baseDir\":\"$PROJ/.locus/runs\"}}" > "$PROJ/request.json"
LOCUS_HEADLESS_FAKE_RUNNER=1 $L api runs create --request "$PROJ/request.json" --json > "$PROJ/create.json"; echo "exit=$?"
JOB="$(node -e 'console.log(require(process.argv[1]).job.id)' "$PROJ/create.json")"
$L api runs status "$JOB" --json
$L api runs events "$JOB" --after 0 --jsonl            # dense sequences, one completed, bare payloads
$L api runs events "$JOB" --after 0 --follow --jsonl   # exits at completed
$L api runs result "$JOB" --json                       # compare artifact sha256 with the files
(cd "$PROJ/.locus/runs/$JOB" && sha256sum request.json events.jsonl result.json artifacts.json)
# B. Real runtimes (after bun run codex:download && bun run claude:download and runtime login
#    or a provider profile): repeat create with runtime.id codex and claude-code; a Codex
#    request with "executionProfile":"policy-grant" and policyGrant scopes; a
#    kind:"completion" request with provider.profileId; cancel one running create from a
#    second shell with `$L api runs cancel <job-id> --json` (the canceled create exits 5),
#    then `$L api runs retry <job-id> --json` (new job with retryOfJobId).
# C. Desktop: DISPLAY=:0 bun run dev; run Claude and Codex chats, interrupt a Codex run,
#    check Workbench usage rows and the Codex tool_delta/diff_observation rows, and a Claude
#    resume rejection showing "Session resume rejected" with the session unchanged.
```

### Harness-conformance follow-up register (task 7.18)

Registered as harness-conformance follow-up, outside this change and not implemented:
actual dynamics of the 66 pinned notification methods (frequency and total order);
trailing usage and warnings after `turn/completed`; realtime, remote-control, process and
Windows surfaces (observed-deferred here); lost retransmission; in-flight process death
and the snapshot it leaves; Codex rollout failure persistence. CODEX-08's observed
negative result stands: Locus does not require Codex to write a failed or error rollout
record. The 0.139 closure vendoring (task 1.4) is its prerequisite for index-level checks.

## Sources

- Third-revision required starting/reviewed source:
  `9e47e2ddb79e3856d16ba1753d87f1cafd107a8d`; HEAD matched and worktree was clean.
  Current dispatch authorizes one local documentation commit only.
- [Second fresh-context review](/home/chen/.claude/projects/-home-chen-projects-agent-code-for-me/f1888632-cd03-49a0-a57d-51704695f29d/handoff/reviews/run-event-ledger-rereview-9e47e2dd.md),
  workflow `wf_28e60ec0-0f1`: 5 opus dimensions + fable synthesis,
  CHANGES_REQUESTED, 1 P1 + 10 P2 + 10 P3; 58/59 first-review findings resolved,
  SQ-8 partially resolved, no regressions. Its closing summary is reproduced verbatim
  below; prior author responses/receipts remain historical, not current approval.

- Second-revision starting source: `0bd7b2bf2452773d416c7009a208e9590daa679f`, branch
  `codex/refactor-canonical-run-event-ledger-draft`, worktree
  `/home/chen/projects/locus-refactor-canonical-run-event-ledger-draft` (clean at intake).
- [Raw five-dimension review](/home/chen/.claude/projects/-home-chen-projects-agent-code-for-me/f1888632-cd03-49a0-a57d-51704695f29d/handoff/reviews/run-event-ledger-draft-review-0bd7b2bf.md):
  all five verdicts CHANGES_REQUESTED; adversarial verification and synthesis were
  **not completed due to usage limits**. Findings below are raw reviewer claims, not
  an adjudicated composite verdict.
- [Original coordinator brief / L1–L12 / 2026-09-05 test-first pilot](/home/chen/.claude/projects/-home-chen-projects-agent-code-for-me/f1888632-cd03-49a0-a57d-51704695f29d/handoff/dispatch-logs/draft-run-event-ledger.prompt.md).
  The pilot's authority is this dispatch; it is not claimed to appear in AGENTS.md or
  the ratified workflow. Current rewrite dispatch supplies the corrected scope and
  Amadeus consumer-fact attribution (Owner relay 2026-09-02).
- [Trace](../../../docs/native-resume-event-gap-trace-2026-09-04.zh-CN.md),
  [C7 §9](../../../docs/ideas/locus-interoperability-contract-v1.zh-CN.md),
  [Consumer Impact template](../../../docs/consumer-impact-template.zh-CN.md),
  [ownership](../../../docs/OWNERSHIP_MAP.md), living specs and code at the base SHA.

## Second Revision Receipts (historical source 9e47e2dd)

Date: 2026-09-07 (Pacific/Auckland). All source edits are confined to this change
folder and its one STATUS row; even STATUS's global Updated date is left untouched.
Temporary dependency/tool setup is not a source change: the main checkout's existing
node_modules is used for checks, with a temporary untracked symlink removed before handoff;
no package or lockfile is changed.

| Check | Executed command/environment | Result |
| --- | --- | --- |
| Intake | git rev-parse HEAD / branch / status | Required SHA and branch match; working tree clean |
| Draft strict validation | PATH=/home/chen/projects/agent-code-for-me/node_modules/.bin:$PATH bun x openspec validate refactor-canonical-run-event-ledger --strict --no-interactive | Exit 0: `Change 'refactor-canonical-run-event-ledger' is valid` |
| Whitespace | git diff --check | Exit 0, no output |
| Current-code regression gate | bun run check:full, existing dependencies via temporary node_modules symlink | Exit 1: 1925 passed / 3 failed / 9338 expectations / 304 files; three unchanged Codex adapter tests attempt pre-start snapshot scrubbing in read-only /home/chen/.codex/shell_snapshots and fail EROFS; lint/architecture/residue/typecheck passed |
| Source inventory | Only change documents and the STATUS row; six capability deltas | 11 tracked files; all 8 MODIFIED requirements retain their baseline scenario names; 55 unique scenario register rows; 66/10/16 table coverage and local links checked |
| Remaining aggregate steps (run separately after test failure) | bun run spec:validate; bun run build | Exit 0: 53/53 OpenSpec items; production build succeeded |
| Product/new scenario execution | Not performed; future tasks remain unchecked | No implementation or native conformance verdict |

The failing tests are `redacts upstream and gateway echoes from successful response,
tool output, and trace persistence`, `exposes controlled edit dynamic tool on provider-profile
gateway runs`, and `passes provider-profile config through app-server client config without
exposing gateway token` in tests/codex-app-server-adapter.test.ts. No product/test edit
or permission escalation was made to bypass the restricted home path. The aggregate
check is recorded as failed, not relabeled passed by the separate build/spec results.

The final handoff identifies the one local revision commit and rerun validation output.
These authoring receipts do not rewrite the original review's verdict or bind future
implementation to the old source. After the implementing source is frozen, **every**
implementation check and fresh independent review must name that same exact SHA.
No merge/push/remote PR/release was authorized or performed.

## First Review Dispositions (historical author response)

IDs use the raw report's dimension and numbered heading: BA=brief-adherence,
C7=contract-c7, CF=code-fit, TF=trace-fidelity, SQ=spec-quality.
A direct count of `### N. [Px]` headings gives **19 P1, 24 P2, 16 P3**, differing from
this dispatch's aggregate 17 P1 / 25 P2. To deliver the requested **17-row P1 table**,
BA-3, TF-4 and SQ-3 (the identical transport-replacement finding) share one row.
All 19 raw P1 IDs, all 24 raw P2 IDs and all 16 P3 IDs are explicitly disposed below;
no absent 25th P2 is invented. Dispositions are draft-author responses, not reviewer approval.

### P1 dispositions (17 rows, 19 raw IDs)

| Row | Raw finding | Disposition / evidence | Revised location |
| --- | --- | --- | --- |
| 1 | BA-1 public wrapper/identity | Accepted. API reader rejects non-api; bridge persists bare payload with runId=jobId; desktop wrapper is internal. | proposal Consumer Impact §§2–4; local-job-api Stable API Event Stream |
| 2 | BA-2 identity scope expansion | Accepted. Delete cross-constructor identity convergence, mismatch admission and static ID-generator guard; C2 follow-up → Phase 5/add-durable-session-bindings. | proposal Non-goals; design envelope/host contract; tasks 2.1/2.8 |
| 3 | BA-3, TF-4, SQ-3 transport replacement | Accepted jointly. Remove attempt/deadline replacement functions/window from design/spec/tasks/verification; exit supplies synthetic terminal; Phase 5 owns any same-Run replacement. | core Transport exit synthesizes one terminal; design terminal policy; tasks 4.4/7.5 |
| 4 | BA-4 transient governance in living requirement | Accepted. Remove C7-absent scenario and all Owner/gate alternatives from MODIFIED requirements; proposed terminal/late/artifact rules are deterministic. | proposal §1/§10; tasks 1.1; all MODIFIED deltas |
| 5 | BA-5 false preset labels | Accepted. Separate L1–L12 from D1–D10 additions with reasons; simplify to SQLite commit + log/cursors, drop unknown-commit state machine and alias retention. | design two Decisions sections |
| 6 | C7-1 public shape / new headless wrapper break | Accepted. Internal committed envelope does not become public payload; preserve existing semantic fields, remove internal wrapper/alias atomically, extension at /payload/runtime/codex/v1. | proposal examples; headless and local API deltas; tasks 2.3 |
| 7 | C7-2 Amadeus mis-source and false C7 boundary | Accepted with updated dispatch source. Direct-native fact is Owner relay 2026-09-02; no trace attribution, no Locus C7 native boundary/OQ; consumer E2E remains unknown. | proposal Consumer Impact §5; design Source Basis |
| 8 | C7-3 Red rows 3/8 based on false baseline | Accepted. Retry already creates job; public artifacts already stable-file/SHA verified. Identity unchanged, native entries additive, no removed public candidate. | proposal classification rows 3/8, artifacts impact |
| 9 | CF-1 impossible artifact-before-terminal | Accepted; current dispatch selects before-or-same-commit variant. Prepare terminal-dependent files from frozen candidate; commit verified refs and completed together, no final artifact event/hash cycle. | design Artifacts and Terminal Commit Order; core terminal-artifacts scenario; tasks 4.8 |
| 10 | CF-2 desktop/public shape confusion | Accepted. Same code evidence as BA-1/C7-1; public shape and baseline fixed independently of internal migration. | proposal Consumer Impact; public-v1 fixture/task 7.16 |
| 11 | CF-3 incomplete deletion/terminal inventory | Accepted. Include job-runner observer, store system appends, recovery, both pre-start cancel branches, completion, Claude wiring, coarse observers and raw-writer allowlist end state. | design Current Owner to Target Mapping + terminal inventory; tasks 2.8/4.3/8.3 |
| 12 | CF-4 implicit schema/store redesign | Accepted, with corrected evidence path: migrations are drizzle/0000–0023, not src/main/lib/db/migrations/0000–0009. Explicit fact keys/metadata, seal, cursors, legacy marking, late-only exception and reused terminal transaction. | design Durable Schema and Store Invariants; tasks 2.5/2.6/2.9 |
| 13 | TF-1 resume consumption predicates absent | Accepted. Correlated Codex response id/thread equality/independent session/provenance; Claude correlated init relation; no synthesized started, no expired inference, separate later turn failure. | core Native Resume Validation Facts; design Resume; tasks 6.2/6.3/7.9 |
| 14 | TF-2 incomplete status/item taxonomy | Accepted. Explicit 66/10/16 table including all omitted families and non-tool items, known deferred categories distinct from unknown. | design Native Method and Item Disposition; Codex decoder scenario; tasks 5.2/7.7 |
| 15 | TF-3 nonexistent Locus rollout seam | Accepted. Locus store failure commit → reopen → degraded native snapshot; no upstream writer owned by Locus; native limitation remains follow-up. | core Durable failure survives degraded native snapshot; tasks 7.12/7.18 |
| 16 | SQ-1 four unimplementable rollout scenarios | Accepted. Remove three duplicate scenarios; one core Locus durable-store scenario owns rehydration behavior; other capabilities test their own projections/ports. | six deltas; tasks 1.5/7.12 |
| 17 | SQ-2 missing reconciliation observable | Accepted. Define readItem plus committed status/item_reconciliation payload.item/payload.reconciliation including state/text/result/loss/missingStart/suppressed count. | design Test-facing Contract/Item Reconciliation; core L3 scenarios |

### P2 dispositions (all 24 raw findings)

| Raw finding | Disposition / concrete response |
| --- | --- |
| BA-6 | Accepted: complete native table adds plan, hook_lifecycle, model_verification, process and observed_deferred realtime/remote/windows. |
| BA-7 | Accepted: job-event-bridge.ts/createAgentJobRunEvent, insertAgentJobEventRecord and sequence/redaction deletion are explicit inventory/tasks. |
| BA-8 | Accepted: tasks 1.4/7.1 define new files and five-boundary shapes; EVENT-01 inventory, EVENT-02 search and EVENT-03 partial notifications are distinguished. |
| C7-4 | Accepted: rows 2/7 no longer duplicate semantic Red; one R1 under 4/5; facade/new version cannot preserve false success under C7 §9.5. |
| C7-5 | Accepted: name the genuine sparse-sequence alternative and reject it in this draft; every record projects to v1 (safe status stubs), so density is preserved. Completeness/late diagnostics are additive. |
| C7-6 | Accepted: canonical-run-ledger feature, runtime.codex.v1 schemaVersion=1/maturity=experimental; tasks 8.2 updates both guides/schema/types/examples. v1 has no required-extension request field; neutral consumer preflight refuses absent required evidence without claiming new Host negotiation. |
| C7-7 | Accepted: consumer evidence links added; Career Kit result/exit/manifest surface narrowed, current consumer-owned E2E unknown and separate from Locus fixtures. |
| CF-5 | Accepted: every historical row remains byte/identity/sequence-preserved with ledger_version=0/legacy_unverified; no hidden correction or new append; drain active legacy before cutover. |
| CF-6 | Accepted scope concern: remove constructor/renderer ID/cancel flow redesign rather than choose an unmapped minting protocol; separate C2 follow-up. |
| CF-7 | Accepted: nine non-v1 internal types force status subtype equal to original type; public-vocabulary fixture asserts all nine. |
| CF-8 | Accepted: build-time gate mechanism/default/sole reader, six activation conditions, all lifecycle entries, transition and final guard modes plus deletion are concrete in design. |
| TF-5 | Accepted: seal at native terminal ingress, trailing usage stored as late diagnostic with total/last but sealed usage/result unchanged; no timer; tasks 7.6 covers arrival during/after preparation and marks order unmeasured. |
| TF-6 | Accepted: reasoning keys include text vs summary and partIndex; explicit native methods and completed content/summary arrays in tasks 7.2/core scenario. |
| TF-7 | Accepted source correction; **reject recommendation to retain unknown C7 native row**: C7 §9.1 Runtime-native boundary plus current dispatch excludes it; Owner relay 2026-09-02 is a consumer fact, not Locus public contract. |
| TF-8 | Accepted: snapshot-only state cannot prove succeeded for an unsettled Run; no-durable-terminal CODEX-08 fixture plus later exit → interrupted. |
| TF-9 | Accepted: no EVENT-01/02 response/request capture claims; schema-derived synthetic files explicitly defined, CODEX-07 full bodies unknown. |
| TF-10 | **Partially accepted / factual premise rejected with code evidence**: retry fields are absent on event envelopes, so assert job-envelope via runs status; they already ARE public v1 job fields. local-job-api.ts:106–109 types job as ReturnType<typeof serializeAgentJob>; :651–656 invokes it; cli-output.ts:86–89 emits retryOfJobId/attempt; schema:1033–1034/1069–1079 requires/defines them. No new C7 field added. |
| SQ-4 | Accepted: core alone specifies commit/item/terminal/usage/repair behavior; desktop/headless/API/Codex assert specific projections/port forwarding/static decode. Scenario register is one test ID per unique scenario. |
| SQ-5 | Accepted: future checked-in fixture catalog with filenames, evidenceClass/sourceRefs, protocol fingerprints and payload wrappers; no capture bodies fabricated or product tests written during DRAFT. |
| SQ-6 | Accepted: constructor runtimeId/secretHints, full OutcomeEvidence, readItem/readUsage/readOutcome, cursor/ack/deliver and sole host composition specified; constructor convergence removed. |
| SQ-7 | Accepted: exhaustive native method/item table and fixtures cover all 66/10/16, including six non-tool variants. |
| SQ-8 | Accepted: architecture scenarios assert symbol definitions/imports/private insert/legacy residue only; runtime faults/redaction belong to core; transient gates remain design/tasks. |
| SQ-9 | Accepted: explicit job-event-bridge deletion and observer ingress mapping; raw writer end state only run-event-ledger-host imports appendExactRunEventBatch. |
| SQ-10 | Accepted: artifact rejection uses status/artifact_admission result/reason; public gaps prohibited by dense status stubs, so no undefined gap-explainable assertion. |

### P3 dispositions (all 16 raw findings)

| Raw finding | Disposition |
| --- | --- |
| BA-9 | Accepted: retry is preserved existing new-job behavior, not introduced by this change. |
| BA-10 | Accepted: What Changes explicitly marks **BREAKING** R1. |
| BA-11 | Accepted: Run's host process wording covers Electron main and CLI/daemon. |
| BA-12 | Accepted: proposal Impact explicitly names Claude desktop persistence/startup/state migration; resume/CAS remains separate. |
| C7-8 | Accepted: Consumer Impact Status=OWNER_DECISION_REQUIRED, change Status=DRAFT; no governance Bun scenario; facade applicability constrained. |
| CF-9 | Accepted: ledger owns native interrupt/usage state; shared/usage-metadata.ts remains vector arithmetic owner. |
| CF-10 | Accepted: stream-event-mapper.ts becomes only projectRunEventToRendererChunks; run-event-ledger-host.ts composes store/projections. |
| CF-11 | Accepted: working PATH-qualified bun x and direct pinned binary commands recorded; missing local dependencies disclosed. |
| TF-11 | Accepted: reset/decrease fixture expressly defensive synthetic inference, not native measured behavior. |
| TF-12 | Accepted: non-deterministic JSON bundle caveat and reproducible per-file/TS-manifest fingerprint rule included. |
| TF-13 | Accepted: incompatible-schema branch synthetic; resume-not-replay labeled trace inference from no native cursor. |
| TF-14 | Accepted: unique per-call Claude/completion usage accumulates total; last retains call vector and IDs/revisions dedupe. |
| SQ-11 | Accepted: R1 BREAKING marker in proposal. |
| SQ-12 | Accepted: this receipt table is canonical for draft checks; future checks separated; exact per-scenario register replaces misleading grouped table. |
| SQ-13 | Accepted: red-first pilot cites original dispatch explicitly, with no ratified-workflow attribution. |
| SQ-14 | Accepted: retry assertions on job envelope; derived usage field is delta.totalTokens. Also corrected suggested nonexistent runs get to actual runs status. |

Additional read-only corrections while disposing claims: public command is `runs status`,
not `runs get`; `normalizeHeadlessExitCode` gives 5 only to canceled, generic interrupted
falls through to 1, and specialized error mappings 2/3/4/6/7/8 remain intact. These are
code-grounded baseline corrections, not added public behavior. An additional source audit found agent-jobs.ts:89 queued-cancel completeAgentJob,
schedules.ts:346 direct event INSERT/sequence=1, and desktop-runner.ts:48–52 direct
createRunEvent/sequence=0; these are now explicit deletion/rewiring points and the raw
INSERT is statically guarded. Actual migration paths
and retry job typing above take precedence over contradictory raw reviewer claims.

## Scenario Register — Red/Green Evidence

Each row below identifies one exact capability/Requirement/Scenario. Independent author
adds one test file/ID and red command/output, then a green command/output at the frozen
implementing SHA. Fixtures are defined in tasks §7.
Third revision: 56 unique scenarios = 38 core + 3 architecture + 3 Codex + 2 desktop +
2 headless + 8 Local Job API. S01–S55 retain their IDs; S56 adds conflict reconciliation.

Red evidence recorded 2026-10-01 at `b8830be5` (red suite `339c4e6e` + follow-up slice): `bun test --isolate` over the nine `tests/run-event-ledger-*.test.ts` files = 141 tests, 122 RED / 19 green-by-design characterizations; per-test red reasons, frozen shapes and coordinator adjudications are in `red-receipt.md` and `red-slice-receipt.md`. Green output is recorded at the frozen implementing SHA.

Green evidence 2026-10-01 (Phase III): `bun test --isolate` over the nine files at `9dc1cbc5`
(product source identical to `e7198bc7`) = 141 pass / 0 fail. Touch-up T1 rerun at
`b0f3e60d`: 141 pass / 0 fail, 1265 `expect()` calls; JUnit 141 test cases, 0 failures, 0 skipped; T1 implementer rows cite their new test files. Each green
cell gives `file passed/total` for that scenario's tests. Implementer-unit rows name the
implementer test that covers the seam, or state what is not asserted (gap G5).

| ID | Capability / Requirement / Scenario | Test ID / red / green |
| --- | --- | --- |
| S01 | agent-runtime-core / Normalized Agent Events / Event type is emitted | `run-event-ledger-vocabulary.test.ts` S01 Event type is emitted — RED at b8830be5<br>`run-event-ledger-vocabulary.test.ts` S01 Event type is emitted — RED at b8830be5 / green at candidate: vocabulary 2/2 |
| S02 | agent-runtime-core / Normalized Agent Events / Runtime emits assistant output | `run-event-ledger-vocabulary.test.ts` S02 Runtime emits assistant output — RED at b8830be5 / green at candidate: vocabulary 1/1 |
| S03 | agent-runtime-core / Normalized Agent Events / Runtime emits tool activity | `run-event-ledger-vocabulary.test.ts` S03 Runtime emits tool activity — RED at b8830be5 / green at candidate: vocabulary 1/1 |
| S04 | agent-runtime-core / Normalized Agent Events / Runtime reports completion | implementer-unit (red-receipt §6: facade result ↔ completedSequence; seam not public) / green at candidate: implementer-unit: `run-event-ledger-runner-facade.test.ts` "S04 … each terminal status returns the committed completed sequence…" 1/1 at T1 (facade `outcome` = `readOutcome()`, `e9170cd4`), plus the host reopen and units commit-sequence tests |
| S05 | agent-runtime-core / Normalized Agent Events / Event is serialized for CLI | `run-event-ledger-vocabulary.test.ts` S05 Event is serialized for CLI — GREEN by design at b8830be5<br>`run-event-ledger-vocabulary.test.ts` S05 Event is serialized for CLI — RED at b8830be5 / green at candidate: vocabulary 2/2 |
| S06 | agent-runtime-core / Normalized Agent Events / Headless process emits coarse output | partial — coarse rows persisted via ledger store port covered by S46 (`run-event-ledger-projection.test.ts`); returned-record half implementer-unit (`ledger-ingress.ts` seam) / green at candidate: implementer-unit: `run-event-ledger-runner-facade.test.ts` "S06 … the coarse ingress port returns sanitized records…" 1/1 at T1 over `tests/fixtures/run-event-ledger-units/coarse-process.json` (returned records equal the SQLite rows), plus the units decode test and projection S46 2/2 |
| S07 | agent-runtime-core / Normalized Agent Events / Event compatibility is required | `run-event-ledger-vocabulary.test.ts` S07 Event compatibility is required — RED at b8830be5<br>`run-event-ledger-vocabulary.test.ts` S07 Event compatibility is required — GREEN by design at b8830be5 / green at candidate: vocabulary 2/2 |
| S08 | agent-runtime-core / Desktop Run Request Contract / Adapter receives desktop request | implementer-unit (desktop request ledger ports; red-receipt §6) / green at candidate: implementer-unit: `run-event-ledger-desktop-request.test.ts` "S08 …" 1/1 at T1 over `tests/fixtures/run-event-ledger-units/desktop-request.json` (runtime-startup factory, recording adapter, ledger ports, raw sentinels and hints absent), plus the request contract tests |
| S09 | agent-runtime-core / Desktop Run Request Contract / Adapter emits normalized events | implementer-unit (desktop-runner ledger injection; red-receipt §6) / green at candidate: implementer-unit: `run-event-ledger-desktop-request.test.ts` "S09 …" 1/1 at T1 (fake adapter through injected ports, recording trace projection of committed redacted records, original signal retained), plus `desktop-runtime-adapter-factory.test.ts` |
| S10 | agent-runtime-core / Canonical Run Event Ledger Ownership / All protocol boundaries enter one ledger | `run-event-ledger-core.test.ts` S10 All protocol boundaries enter one ledger — RED at b8830be5<br>`run-event-ledger-core.test.ts` S10 All protocol boundaries enter one ledger — RED at b8830be5 / green at candidate: core 2/2 |
| S11 | agent-runtime-core / Canonical Run Event Ledger Ownership / Durable append fails before acknowledgement | `run-event-ledger-store-faults.test.ts` S11 Durable append fails before acknowledgement — RED at b8830be5<br>`run-event-ledger-store-faults.test.ts` S11 Durable append fails before acknowledgement — RED at b8830be5 / green at candidate: store-faults 2/2 |
| S12 | agent-runtime-core / Canonical Run Event Ledger Ownership / Process crashes after commit and before projection | `run-event-ledger-store-faults.test.ts` S12 Process crashes after commit and before projection — RED at b8830be5<br>`run-event-ledger-store-faults.test.ts` S12 Process crashes after commit and before projection — RED at b8830be5 / green at candidate: store-faults 2/2 |
| S13 | agent-runtime-core / Canonical Run Event Ledger Ownership / Historical rows remain explicitly unverified | `run-event-ledger-guards.test.ts` S13 Historical rows remain explicitly unverified — RED at b8830be5<br>`run-event-ledger-guards.test.ts` S13 Historical rows remain explicitly unverified — RED at b8830be5<br>`run-event-ledger-guards.test.ts` S13 Historical rows remain explicitly unverified — GREEN by design at b8830be5 / green at candidate: guards 3/3; `run-event-ledger-host.test.ts` "pre-ledger (ledger_version=0) history is never extended"; internal reader (G1, `77003130`): `run-event-ledger-history-quality.test.ts` 4/4 |
| S14 | agent-runtime-core / Native Identity And Runtime Provenance / Distinct native identities are preserved | `run-event-ledger-core.test.ts` S14 Distinct native identities are preserved — RED at b8830be5<br>`run-event-ledger-core.test.ts` S14 Distinct native identities are preserved — RED at b8830be5 / green at candidate: core 2/2 |
| S15 | agent-runtime-core / Native Identity And Runtime Provenance / Exact runtime provenance follows every event | `run-event-ledger-provenance-resume.test.ts` S15 Exact runtime provenance follows every event — RED at b8830be5<br>`run-event-ledger-provenance-resume.test.ts` S15 Exact runtime provenance follows every event — RED at b8830be5<br>`run-event-ledger-provenance-resume.test.ts` S15 Exact runtime provenance follows every event — RED at b8830be5<br>`run-event-ledger-provenance-resume.test.ts` S15 Exact runtime provenance follows every event — RED at b8830be5<br>`run-event-ledger-provenance-resume.test.ts` S15 Exact runtime provenance follows every event — RED at b8830be5<br>`run-event-ledger-provenance-resume.test.ts` S15 Exact runtime provenance follows every event — RED at b8830be5<br>`run-event-ledger-guards.test.ts` S15 Exact runtime provenance follows every event — RED at b8830be5<br>`run-event-ledger-guards.test.ts` S15 Exact runtime provenance follows every event — RED at b8830be5<br>`run-event-ledger-guards.test.ts` S15 Exact runtime provenance follows every event — RED at b8830be5 / green at candidate: provenance-resume 6/6, guards 3/3; Claude pre-spawn re-check (G4, `771d3f63`): `claude-agent-sdk-executable-check.test.ts` 5/5 |
| S16 | agent-runtime-core / Native Identity And Runtime Provenance / Interrupt target comes from native Run state | `run-event-ledger-boundaries.test.ts` S16 Interrupt target comes from native Run state — RED at b8830be5<br>`run-event-ledger-boundaries.test.ts` S16 Interrupt target comes from native Run state — RED at b8830be5<br>`run-event-ledger-boundaries.test.ts` S16 Interrupt target comes from native Run state — RED at b8830be5<br>`run-event-ledger-boundaries.test.ts` S16 Interrupt target comes from native Run state — RED at b8830be5 / green at candidate: boundaries 4/4 |
| S17 | agent-runtime-core / Stateful Ledger Redaction / Runtime splits an exact secret across adjacent events | `run-event-ledger-boundaries.test.ts` S17 Runtime splits an exact secret across adjacent events — RED at b8830be5<br>`run-event-ledger-boundaries.test.ts` S17 Runtime splits an exact secret across adjacent events — RED at b8830be5<br>`run-event-ledger-boundaries.test.ts` S17 Runtime splits an exact secret across adjacent events — RED at b8830be5<br>`run-event-ledger-boundaries.test.ts` S17 Runtime splits an exact secret across adjacent events — RED at b8830be5<br>`run-event-ledger-boundaries.test.ts` S17 Runtime splits an exact secret across adjacent events — RED at b8830be5 / green at candidate: boundaries 5/5 |
| S18 | agent-runtime-core / Item Lifecycle Reconciliation / Assistant deltas reconcile with final snapshot | `run-event-ledger-reconciliation.test.ts` S18 Assistant deltas reconcile with final snapshot — RED at b8830be5<br>`run-event-ledger-reconciliation.test.ts` S18 Assistant deltas reconcile with final snapshot — RED at b8830be5<br>`run-event-ledger-reconciliation.test.ts` S18 Assistant deltas reconcile with final snapshot — RED at b8830be5<br>`run-event-ledger-reconciliation.test.ts` S18 Assistant deltas reconcile with final snapshot — RED at b8830be5<br>`run-event-ledger-reconciliation.test.ts` S18 Assistant deltas reconcile with final snapshot — RED at b8830be5<br>`run-event-ledger-reconciliation.test.ts` S18 Assistant deltas reconcile with final snapshot — RED at b8830be5<br>`run-event-ledger-reconciliation.test.ts` S18 Assistant deltas reconcile with final snapshot — RED at b8830be5<br>`run-event-ledger-reconciliation.test.ts` S18 Assistant deltas reconcile with final snapshot — RED at b8830be5 / green at candidate: reconciliation 8/8 |
| S19 | agent-runtime-core / Item Lifecycle Reconciliation / Reasoning channels and parts reconcile separately | `run-event-ledger-reconciliation.test.ts` S19 Reasoning channels and parts reconcile separately — RED at b8830be5<br>`run-event-ledger-reconciliation.test.ts` S19 Reasoning channels and parts reconcile separately — RED at b8830be5<br>`run-event-ledger-reconciliation.test.ts` S19 Reasoning channels and parts reconcile separately — RED at b8830be5<br>`run-event-ledger-reconciliation.test.ts` S19 Reasoning channels and parts reconcile separately — RED at b8830be5<br>`run-event-ledger-reconciliation.test.ts` S19 Reasoning channels and parts reconcile separately — RED at b8830be5<br>`run-event-ledger-reconciliation.test.ts` S19 Reasoning channels and parts reconcile separately — RED at b8830be5 / green at candidate: reconciliation 6/6; native-index variant waits on task 1.4 |
| S20 | agent-runtime-core / Item Lifecycle Reconciliation / Tool item lifecycle is incomplete or repeated | `run-event-ledger-reconciliation.test.ts` S20 Tool item lifecycle is incomplete or repeated — RED at b8830be5<br>`run-event-ledger-reconciliation.test.ts` S20 Tool item lifecycle is incomplete or repeated — RED at b8830be5<br>`run-event-ledger-reconciliation.test.ts` S20 Tool item lifecycle is incomplete or repeated — RED at b8830be5 / green at candidate: reconciliation 3/3 |
| S21 | agent-runtime-core / Diagnostic Error And Terminal Invariants / Retry error is followed by success | `run-event-ledger-terminal.test.ts` S21 Retry error is followed by success — RED at b8830be5 / green at candidate: terminal 1/1 |
| S22 | agent-runtime-core / Diagnostic Error And Terminal Invariants / Denial rejection and empty output have deterministic outcomes | `run-event-ledger-terminal.test.ts` S22 Denial rejection and empty output have deterministic outcomes — RED at b8830be5 / green at candidate: terminal 1/1 |
| S23 | agent-runtime-core / Diagnostic Error And Terminal Invariants / Transport exit synthesizes one terminal | `run-event-ledger-terminal.test.ts` S23 Transport exit synthesizes one terminal — RED at b8830be5<br>`run-event-ledger-terminal.test.ts` S23 Transport exit synthesizes one terminal — RED at b8830be5 / green at candidate: terminal 2/2 |
| S24 | agent-runtime-core / Diagnostic Error And Terminal Invariants / Pre-start cancel and dead-worker recovery settle through ledger | `run-event-ledger-terminal.test.ts` S24 Pre-start cancel and dead-worker recovery settle through ledger — RED at b8830be5<br>`run-event-ledger-terminal.test.ts` S24 Pre-start cancel and dead-worker recovery settle through ledger — RED at b8830be5<br>`run-event-ledger-terminal.test.ts` S24 Pre-start cancel and dead-worker recovery settle through ledger — RED at b8830be5<br>`run-event-ledger-terminal.test.ts` S24 Pre-start cancel and dead-worker recovery settle through ledger — RED at b8830be5<br>`run-event-ledger-terminal.test.ts` S24 Pre-start cancel and dead-worker recovery settle through ledger — RED at b8830be5<br>`run-event-ledger-terminal.test.ts` S24 Pre-start cancel and dead-worker recovery settle through ledger — GREEN by design at b8830be5<br>`run-event-ledger-terminal.test.ts` S24 Pre-start cancel and dead-worker recovery settle through ledger — RED at b8830be5 / green at candidate: terminal 7/7; variants (`00b33a13`): `run-event-ledger-recovery-variants.test.ts` 3/3 (supervisor-observed exit, unknown host, heartbeat or claim changed at commit) |
| S25 | agent-runtime-core / Diagnostic Error And Terminal Invariants / Usage after completed is diagnostic only | `run-event-ledger-reconciliation.test.ts` S25 Usage after completed is diagnostic only — RED at b8830be5<br>`run-event-ledger-reconciliation.test.ts` S25 Usage after completed is diagnostic only — RED at b8830be5<br>`run-event-ledger-terminal.test.ts` S25 Usage after completed is diagnostic only — RED at b8830be5 / green at candidate: reconciliation 2/2, terminal 1/1 |
| S26 | agent-runtime-core / Usage Snapshot Accounting / Usage snapshots are accumulated once | `run-event-ledger-reconciliation.test.ts` S26 Usage snapshots are accumulated once — RED at b8830be5<br>`run-event-ledger-reconciliation.test.ts` S26 Usage snapshots are accumulated once — RED at b8830be5 / green at candidate: reconciliation 2/2 |
| S27 | agent-runtime-core / Usage Snapshot Accounting / Resume establishes a usage baseline | `run-event-ledger-reconciliation.test.ts` S27 Resume establishes a usage baseline — RED at b8830be5 / green at candidate: reconciliation 1/1 |
| S28 | agent-runtime-core / Canonical Artifact Admission / Valid artifact candidate is admitted | `run-event-ledger-terminal.test.ts` S28 Valid artifact candidate is admitted — RED at b8830be5 / green at candidate: terminal 1/1; native roles and the production path (G2, `5b1ffd3e`): `run-event-ledger-native-artifacts.test.ts` 8/8 |
| S29 | agent-runtime-core / Canonical Artifact Admission / Invalid artifact candidate is rejected | `run-event-ledger-terminal.test.ts` S29 Invalid artifact candidate is rejected — RED at b8830be5 / green at candidate: terminal 1/1; role-carrying rejections and out_of_scope production candidates: `run-event-ledger-native-artifacts.test.ts` |
| S30 | agent-runtime-core / Canonical Artifact Admission / Terminal files and completed become visible together | partial — artifact admission covered by S25 tests (`run-event-ledger-terminal.test.ts`); prepare-fail hooks implementer-unit (red-receipt §6) / green at candidate: projection S52 1/1, the three units preparation tests, and `run-event-ledger-terminal-commit-faults.test.ts` 4/4 at T1 (`316859e3`) over `tests/fixtures/run-event-ledger-units/terminal-artifacts.json`: clean, file-preparation fault, refused SQL commit (readers snapshotted at the refusal) and projection fault after commit (redelivered once on reopen) |
| S31 | agent-runtime-core / Observable Native Methods And Boundary Facts / Unknown native method is observed | `run-event-ledger-core.test.ts` S31 Unknown native method is observed — RED at b8830be5<br>`run-event-ledger-core.test.ts` S31 Unknown native method is observed — RED at b8830be5 / green at candidate: core 2/2 |
| S32 | agent-runtime-core / Observable Native Methods And Boundary Facts / Interaction boundary is recorded without a second state machine | `run-event-ledger-boundaries.test.ts` S32 Interaction boundary is recorded without a second state machine — RED at b8830be5<br>`run-event-ledger-boundaries.test.ts` S32 Interaction boundary is recorded without a second state machine — RED at b8830be5<br>`run-event-ledger-boundaries.test.ts` S32 Interaction boundary is recorded without a second state machine — RED at b8830be5 / green at candidate: boundaries 3/3 |
| S33 | agent-runtime-core / Native Resume Validation Facts / Codex response validates the requested native thread | `run-event-ledger-provenance-resume.test.ts` S33 Codex response validates the requested native thread — RED at b8830be5<br>`run-event-ledger-provenance-resume.test.ts` S33 Codex response validates the requested native thread — RED at b8830be5<br>`run-event-ledger-provenance-resume.test.ts` S33 Codex response validates the requested native thread — RED at b8830be5<br>`run-event-ledger-provenance-resume.test.ts` S33 Codex response validates the requested native thread — RED at b8830be5 / green at candidate: provenance-resume 4/4 |
| S34 | agent-runtime-core / Native Resume Validation Facts / Claude correlated init validates resume independently of turn success | `run-event-ledger-provenance-resume.test.ts` S34 Claude correlated init validates resume independently of turn success — RED at b8830be5<br>`run-event-ledger-provenance-resume.test.ts` S34 Claude correlated init validates resume independently of turn success — RED at b8830be5<br>`run-event-ledger-provenance-resume.test.ts` S34 Claude correlated init validates resume independently of turn success — RED at b8830be5<br>`run-event-ledger-provenance-resume.test.ts` S34 Claude correlated init validates resume independently of turn success — RED at b8830be5<br>`run-event-ledger-provenance-resume.test.ts` S34 Claude correlated init validates resume independently of turn success — RED at b8830be5 / green at candidate: provenance-resume 5/5 |
| S35 | agent-runtime-core / Resume Snapshot Repair / Resume snapshot repairs an incomplete item | `run-event-ledger-provenance-resume.test.ts` S35 Resume snapshot repairs an incomplete item — RED at b8830be5<br>`run-event-ledger-provenance-resume.test.ts` S35 Resume snapshot repairs an incomplete item — RED at b8830be5 / green at candidate: provenance-resume 2/2; production caller (G3, `be098376`): `codex-app-server-resume-snapshot.test.ts` 8/8 |
| S36 | agent-runtime-core / Resume Snapshot Repair / Durable failure survives degraded native snapshot | `run-event-ledger-provenance-resume.test.ts` S36 Durable failure survives degraded native snapshot — RED at b8830be5<br>`run-event-ledger-provenance-resume.test.ts` S36 Durable failure survives degraded native snapshot — RED at b8830be5 / green at candidate: provenance-resume 2/2; post-seal caller path: `codex-app-server-resume-snapshot.test.ts` |
| S37 | agent-runtime-core / Resume Snapshot Repair / Cross-version snapshot reconciliation declares its evidence limits | `run-event-ledger-provenance-resume.test.ts` S37 Cross-version snapshot reconciliation declares its evidence limits — RED at b8830be5<br>`run-event-ledger-provenance-resume.test.ts` S37 Cross-version snapshot reconciliation declares its evidence limits — RED at b8830be5<br>`run-event-ledger-provenance-resume.test.ts` S37 Cross-version snapshot reconciliation declares its evidence limits — RED at b8830be5 / green at candidate: provenance-resume 3/3; recognized/incompatible classification on the resume path: `codex-app-server-resume-snapshot.test.ts` |
| S38 | architecture-ownership / Canonical Runtime Event Mapping Single Path / Second event mapping definition appears | `run-event-ledger-guards.test.ts` S38 Second event mapping definition appears — RED at b8830be5<br>`run-event-ledger-guards.test.ts` S38 Second event mapping definition appears — RED at b8830be5 / green at candidate: guards 2/2; negative self-test: `run-event-ledger-guard-self-test.test.ts` 1/1 at T1 (`10fd4482`) |
| S39 | architecture-ownership / Canonical Runtime Event Mapping Single Path / Route or runtime adapter writes job events directly | `run-event-ledger-guards.test.ts` S39 Route or runtime adapter writes job events directly — RED at b8830be5<br>`run-event-ledger-guards.test.ts` S39 Route or runtime adapter writes job events directly — RED at b8830be5<br>`run-event-ledger-guards.test.ts` S39 Route or runtime adapter writes job events directly — RED at b8830be5<br>`run-event-ledger-guards.test.ts` S39 Route or runtime adapter writes job events directly — RED at b8830be5<br>`run-event-ledger-guards.test.ts` S39 Route or runtime adapter writes job events directly — RED at b8830be5<br>`run-event-ledger-guards.test.ts` S39 Route or runtime adapter writes job events directly — GREEN by design at b8830be5 / green at candidate: guards 6/6 |
| S40 | architecture-ownership / Canonical Runtime Event Mapping Single Path / Guard proves its own detection | `run-event-ledger-guards.test.ts` S40 Guard proves its own detection — RED at b8830be5 / green at candidate: guards 1/1; negative self-test: `run-event-ledger-guard-self-test.test.ts` 1/1 at T1 (a mutated fixture through `--run-event-ledger-fixtures` fails the guard by case id for a missing and an unexpected finding; `scripts/check-architecture-guards.mjs:4491-4510`) |
| S41 | codex-runtime-parity / Codex Native Boundary Forwarding And Disposition / Transport forwards protocol boundary shapes | implementer-unit (spy-ledger injection on the Codex transport; red-receipt §6) / green at candidate: implementer-unit: `codex-app-server-ingress-order.test.ts` 1/1 at T1 (spy ledger over `ingress-boundaries.jsonl`: one call per boundary in arrival order with request context, resolved not duplicated, no invented `thread/started`), plus the adapter resume test and the ledger-backed stream-events tests |
| S42 | codex-runtime-parity / Codex Native Boundary Forwarding And Disposition / Pinned native surface has complete disposition | `run-event-ledger-core.test.ts` S42 Pinned native surface has complete disposition — GREEN by design at b8830be5<br>`run-event-ledger-core.test.ts` S42 Pinned native surface has complete disposition — RED at b8830be5<br>`run-event-ledger-core.test.ts` S42 Pinned native surface has complete disposition — RED at b8830be5<br>`run-event-ledger-core.test.ts` S42 Pinned native surface has complete disposition — RED at b8830be5<br>`run-event-ledger-core.test.ts` S42 Pinned native surface has complete disposition — RED at b8830be5<br>`run-event-ledger-core.test.ts` S42 Pinned native surface has complete disposition — RED at b8830be5 / green at candidate: core 6/6 |
| S43 | codex-runtime-parity / Codex Native Boundary Forwarding And Disposition / Decoder retains channel and native error fields | `run-event-ledger-vocabulary.test.ts` S43 Decoder retains channel and native error fields — RED at b8830be5<br>`run-event-ledger-vocabulary.test.ts` S43 Decoder retains channel and native error fields — RED at b8830be5 / green at candidate: vocabulary 2/2 |
| S44 | desktop-agent-jobs / Desktop Jobs Persist Semantic Runtime Events / Desktop stream emits semantic events | `run-event-ledger-projection.test.ts` S44 Desktop stream emits semantic events — RED at b8830be5<br>`run-event-ledger-projection.test.ts` S44 Desktop stream emits semantic events — GREEN by design at b8830be5 / green at candidate: projection 2/2 |
| S45 | desktop-agent-jobs / Desktop Jobs Persist Semantic Runtime Events / Secret-like payload is observed | `run-event-ledger-projection.test.ts` S45 Secret-like payload is observed — RED at b8830be5<br>`run-event-ledger-projection.test.ts` S45 Secret-like payload is observed — GREEN by design at b8830be5 / green at candidate: projection 2/2 |
| S46 | headless-agent-jobs / Headless Runtime Event Convergence / Batch process event is persisted | `run-event-ledger-projection.test.ts` S46 Batch process event is persisted — RED at b8830be5<br>`run-event-ledger-projection.test.ts` S46 Batch process event is persisted — RED at b8830be5 / green at candidate: projection 2/2 |
| S47 | headless-agent-jobs / Headless Runtime Event Convergence / Existing event readers remain compatible | `run-event-ledger-projection.test.ts` S47 Existing event readers remain compatible — RED at b8830be5 / green at candidate: projection 1/1 |
| S48 | local-job-api / Stable API Event Stream / Consumer reads events | `run-event-ledger-projection.test.ts` S48 Consumer reads events — GREEN by design at b8830be5<br>`run-event-ledger-projection.test.ts` S48 Consumer reads events — GREEN by design at b8830be5<br>`run-event-ledger-projection.test.ts` S48 Consumer reads events — GREEN by design at b8830be5<br>`run-event-ledger-projection.test.ts` S48 Consumer reads events — RED at b8830be5<br>`run-event-ledger-projection.test.ts` S48 Consumer reads events — GREEN by design at b8830be5 / green at candidate: projection 5/5 |
| S49 | local-job-api / Stable API Event Stream / Consumer follows events | `run-event-ledger-projection.test.ts` S49 Consumer follows events — GREEN by design at b8830be5 / green at candidate: projection 1/1 |
| S50 | local-job-api / Stable API Event Stream / All internal event types preserve dense v1 projection | `run-event-ledger-projection.test.ts` S50 All internal event types preserve dense v1 projection — RED at b8830be5<br>`run-event-ledger-core.test.ts` S50 All internal event types preserve dense v1 projection — RED at b8830be5 / green at candidate: projection 1/1, core 1/1 |
| S51 | local-job-api / Run Result and Artifact Manifest / API job completes | `run-event-ledger-projection.test.ts` S51 API job completes — GREEN by design at b8830be5<br>`run-event-ledger-projection.test.ts` S51 API job completes — RED at b8830be5<br>`run-event-ledger-projection.test.ts` S51 API job completes — RED at b8830be5<br>`run-event-ledger-projection.test.ts` S51 API job completes — GREEN by design at b8830be5<br>`run-event-ledger-projection.test.ts` S51 API job completes — GREEN by design at b8830be5 / green at candidate: projection 5/5 |
| S52 | local-job-api / Run Result and Artifact Manifest / Run artifact directory is configured | `run-event-ledger-projection.test.ts` S52 Run artifact directory is configured — GREEN by design at b8830be5 / green at candidate: projection 1/1 |
| S53 | local-job-api / Discovery Feature Advertisement / Consumer detects readiness support | `run-event-ledger-projection.test.ts` S53 Consumer detects readiness support — GREEN by design at b8830be5 / green at candidate: projection 1/1 |
| S54 | local-job-api / Discovery Feature Advertisement / Older build lacks the feature | `run-event-ledger-projection.test.ts` S54 Older build lacks the feature — GREEN by design at b8830be5 / green at candidate: projection 1/1 |
| S55 | local-job-api / Discovery Feature Advertisement / Consumer detects canonical ledger support | `run-event-ledger-projection.test.ts` S55 Consumer detects canonical ledger support — RED at b8830be5 / green at candidate: projection 1/1 |
| S56 | agent-runtime-core / Canonical Run Event Ledger Ownership / Cross-process queued cancel races with start | `run-event-ledger-terminal.test.ts` S56 Cross-process queued cancel races with start — RED at b8830be5<br>`run-event-ledger-terminal.test.ts` S56 Cross-process queued cancel races with start — RED at b8830be5<br>`run-event-ledger-terminal.test.ts` S56 Cross-process queued cancel races with start — RED at b8830be5<br>`run-event-ledger-terminal.test.ts` S56 Cross-process queued cancel races with start — RED at b8830be5<br>`run-event-ledger-terminal.test.ts` S56 Cross-process queued cancel races with start — RED at b8830be5<br>`run-event-ledger-terminal.test.ts` S56 Cross-process queued cancel races with start — RED at b8830be5 / green at candidate: terminal 6/6 |


## Future Implementation Receipts

| Evidence | Required receipt / state |
| --- | --- |
| Owner APPROVED | Recorded 2026-09-07 (receipt below): R1 disposition, four answers, scope bound to `9ebe6c34` |
| Code/store | Implemented at the candidate: one exact-sequence append path (`appendExactRunEventBatch`, private insert `job-store.ts:930`), definite rollback (S11), reopen/ack cursors (S12, host test), legacy marking and v0 append rejection (S13, host test), internal `historyQuality` read metadata (G1 closed in T1), post-terminal late-only (S25) |
| Terminal/artifact | Implemented: every inventory terminal caller settles through the ledger (8.4 evidence), candidate files and same-commit refs (S52, implementer tests), failed preparation keeps the slot, recovery (S24, T1 variants), S30 commit-fault injection and registered-refs result reader (T1). Referred: headless app-server `host_result` (decision 3) |
| Native/repair | Implemented: correlated resume (S33/S34), 66/10/16 static coverage (S42), two reasoning channels (S19), snapshot-only no-success (S36), native artifact candidates through the host (G2) and the resume snapshot-repair caller (G3), both closed in T1 |
| Static architecture | Implemented: owner pins, retired symbols absent, the host is the only raw store importer, gate and transition mode deleted; guard self-test 17/17 |
| Security | Implemented: stateful split-secret flush (S17), withheld prefix dropped at flush (`84541e00`), raw native content omitted, admission scope/digest/ownership checks (S28/S29), store credential patterns kept on durable records (`60bf8e02`), no new grants; Claude capture-to-launch re-check (G4 closed in T1); native staging only inside the admitted run dir |
| check:full / strict / diff | Exit 0 at `b0f3e60d` (T1 gates); rerun at the candidate in the handoff |
| Manual/packaged | Host-blocked or not claimed; see the 8.5 smoke matrix and rerun commands |
| Codex IMPLEMENTATION_VERIFIED | Not issued; due on the candidate SHA |
| Claude fresh REVIEW_APPROVED | Not issued; due on the candidate SHA |
| Owner ACCEPTED | Not issued; explicit acceptance required after same-SHA technical evidence |
| Merge/push/remote PR/release | Not authorized / not performed |

## Consumer Evidence Ownership

| Owner | Evidence scope | Current revision result |
| --- | --- | --- |
| Locus | Neutral batch/structured-output, interactive events/cursor, dense 12-type v1, feature/maturity, terminal and artifact fixtures | Implemented; conformance tests green at the candidate (S21/S22, S48–S55); API runtime smoke host-blocked |
| Locus | Desktop/Workbench and headless/CLI projections | Implemented; tests green (S44–S47, S05/S07); desktop and CLI smoke host-blocked |
| Career Kit | Its adapter/version and business E2E (historical links in proposal are background only) | unknown |
| Amadeus | Its adapter/version and E2E, actual Locus v1 dependencies | unknown (consumer facts relayed by the Owner; no Locus-side inventory, task 1.3) |
| Other consumer | Inventory and its own receipts | unknown |

## Remaining Red and Deferred Inputs

Remaining Red: **R1, C7 rows 4/5 — terminal result truth and corresponding CLI exit-code
outcomes**. Row 5's sparse-sequence alternative is not selected; dense projection is
specified. Rows 2/3/7/8 are not separate Red changes. Governance approval remains in
proposal/tasks/STATUS, not in living behavior requirements.

Deferred: C2 constructor/renderer identity convergence; Phase 5 replacement/lease/fencing/
Claude one-shot CAS and binding expiry/repair (the ambiguous stream-error classification/clear is addressed in this slice); add-durable-agent-interactions; add-local-job-api-async-submit;
native rollout writer and trace §6.2 dynamic conformance. No deferred work was implemented.
Open Questions have one canonical wording, mirrored in proposal/design (four items).


## Third Revision Dispositions — Second Review Items 1–21

These are author dispositions on the review of `9e47e2ddb79e3856d16ba1753d87f1cafd107a8d`,
workflow `wf_28e60ec0-0f1`. All 21 findings are addressed in this DRAFT; no current P3 is
left undisposed. This does not issue a third-review verdict. A third fresh-context review
of the new committed SHA, followed by Owner APPROVED, is still the next gate.

| Review item | Priority | Disposition and concrete revised location |
| --- | --- | --- |
| 1 | P1 | Accepted two-stage provenance: pending lifecycle records/null job tuple at enqueue, worker claim, queued cancel and never-started recovery; runtime capture at adapter executable resolution, one-time bind and immutable references thereafter. Runtime-required-field rejection applies to runtime construction/binding. NEW run-provenance.ts owns installation identity/executableRef/digest/reproducible schema manifest; no registry. design Test-facing Contract / Durable Schema / owner table; core Native Identity And Runtime Provenance; tasks 2.4–2.5, 6.1, 7.15. |
| 2 | P2 | Inline all 11 forbidden exports in architecture delta. Move the complete 66/10/16 table from design to the parity requirement; design references that normative table. Core defines observable ports/readers directly. No living delta delegates normative content to design/tasks or a not-yet-committed fixture. |
| 3 | P2 | Select internal-only option: historyQuality belongs to the store/Workbench reader; remove public job.ledger.historyQuality addition. design Migration Plan, core historical scenario and tasks 2.9/7.16/8.2 agree. No new public-envelope/C7 addition is implied. |
| 4 | P2 | Replace colliding pointer with /payload/extensions/runtime.codex.v1, i.e. payload.extensions["runtime.codex.v1"]. Keep string payload.runtime in runtime_selected/runtime_selection_refused; proposal example/C7, core identity, local API delta and tasks 7.16/8.2 include collision cases. |
| 5 | P2 | Name job-recovery.ts owner and 120 s stale + same-host absent/observed-exit/never-claimed predicate; alive/EPERM/unknown/claimed-missing-PID is not death. Revalidate claim/heartbeat transactionally, record confidence and basis. Drain/cancel/recover all old queued/running jobs with old build before activation; no v0 writes after cutover. design Store/Migration/owner table; core recovery scenario; tasks 2.9/4.3/7.4. |
| 6 | P2 | Ledger reloads committed header/events, rebuilds state, looks up stable fact keys, re-evaluates intent and re-reserves uncommitted sequences on conflict, at most three attempts. Cancel-first blocks spawn; start-first forwards existing cancel request to worker. Store never re-sequences. design Store Invariants; core new race scenario S56; tasks 2.10/7.8. |
| 7 | P2 | Delete writer-side wrapper only; getWorkbenchSemanticPayload logic remains solely in the ledger_version=0 historical branch of one versioned decoder. v1 uses direct committed records. design D3/owner table/Migration; desktop delta; tasks 2.3/2.9/7.15. |
| 8 | P2 | Label part-index rule 推断/inferred. Stateless decoder preserves proven index or absence; ledger fallback is last summary boundary/default 0 and text/content 0, with indexSource=inferred/lossPossible=true. Verify pinned 0.139 schema before 7.2 freeze. design evidence/reconciliation; core/parity scenarios; tasks 1.4/3.3/7.2. |
| 9 | P2 | Choose in-slice correction: map No conversation found to neutral NATIVE_RESUME_REJECTED; remove SESSION_EXPIRED inference and stream-error sessionId clear. Both Claude error files have owner-table rows/tasks; rejection itself neither settles the Run nor mutates a binding. Full expiry/repair/CAS remains Phase 5. design Resume/owner table; core Claude scenario; tasks 6.3/7.9. |
| 10 | P2 | Vocabulary WHEN explicitly drives ingestRuntimeObservation, admitRunArtifactCandidate and settle; tasks 7.17 requires a per-case port field for owner-gated artifact/terminal inputs. core Event type is emitted. |
| 11 | P2 | Restore the living Older build lacks the feature WHEN/THEN verbatim and generic. The existing Consumer detects canonical ledger support scenario carries this change's IDs; task 7.16 names the actual Locus discovery reader, no invented preflight subject. |
| 12 | P3 | State higher status-event volume, --after pagination and no bounded count assumption in Consumer Impact §4, local API requirement, task 8.2 and identical Open Question 4 in proposal/design. |
| 13 | P3 | C7 row 10 explicitly accounts for the closed discoveryFeature enum/LOCAL_JOB_API_DISCOVERY_FEATURES, same-change extension and consumers refreshing pinned schema copies. Row 2 no longer claims no enum additions at all. task 8.2 names both owners. |
| 14 | P3 | Task 8.3 explicitly records run-artifacts.ts file validation/preparation/writing versus local-job-api capability/serializer ownership of public paths/roles/schema; writer consumes that contract rather than forking it. |
| 15 | P3 | Late observations during preparation retain post-terminal reservations, publish only after terminal commit and point to its terminal slot. Failed preparation keeps one failed candidate in that slot and preserves diagnostics (no discard needed); conflict rebase affects only uncommitted reservations. design Late Policy; core late-usage scenario; tasks 4.5/7.6. |
| 16 | P3 | Resume validated/rejected facts record intent, available observed thread/target-turn statuses and CODEX-05 no-rollout raceContext without changing live outcome. design Resume; core Codex scenario; tasks 6.2/7.9. |
| 17 | P3 | Separate four measured response clauses from ephemeral/path/cliVersion durability evidence. Otherwise valid load remains validated, missing/non-durable evidence sets durableEvidence=false/lossPossible=true. design/core/tasks 7.9 agree. |
| 18 | P3 | Transport exit is a candidate: unsealed settles interrupted; already sealed becomes late diagnostic. Add post-seal exit fixture variant and assertion in core and task 7.5. |
| 19 | P3 | Add missing_local completed-without-local snapshot and missing_native local-absent-from-authoritative-snapshot variants with explicit reconciliation/loss assertions; core repair scenarios and tasks 7.10/7.11. |
| 20 | P3 | readItem accepts complete native key or returned observation-local correlationKey plus channel/partIndex. Missing-ID fixture checks addressability and no merge of unrelated equal-text observations. design contract/reconciliation; core assistant scenario; tasks 3.1/7.2. |
| 21 | P3 | Historical invariant WHEN now opens a store of pre-ledger rows, not a one-time migration act; task 2.9 retains migration work. Fix comma between exported-insert and direct-event-insert architecture variants. This addresses the residual first-review SQ-8. |

Unaddressed P3 and reasons: **none**. R1 and the four mirrored Open Questions remain
Owner decisions; this author response does not resolve or approve them.

## Third Revision Receipts

Date: 2026-09-07 (Pacific/Auckland). Required base/reviewed source:
`9e47e2ddb79e3856d16ba1753d87f1cafd107a8d`. Scope: this change directory plus the single
STATUS row only; product code, tests, fixture files, living specs, package/lock files
and global STATUS Updated date are untouched. Tasks/fixture descriptions remain future
approved work. Existing dependencies are temporarily linked for checks and the link
is removed before commit. The final local source SHA is the commit containing this
receipt (reported in the handoff); it must receive its own fresh review.

| Check | Command / evidence | Result |
| --- | --- | --- |
| Intake | pwd; git rev-parse HEAD; git status --short | Required worktree/SHA, clean |
| Single strict | PATH=/home/chen/projects/agent-code-for-me/node_modules/.bin:$PATH openspec validate refactor-canonical-run-event-ledger --strict --no-interactive | Exit 0: Change 'refactor-canonical-run-event-ledger' is valid |
| All strict | PATH=/home/chen/projects/agent-code-for-me/node_modules/.bin:$PATH openspec validate --all --strict --no-interactive | Exit 0: Totals: 53 passed, 0 failed (53 items) |
| Whitespace | git diff --check | Exit 0, no output |
| Document consistency | Unique scenario/register mapping; MODIFIED baseline names; inline native table vs trace; JSON examples; identical ≤5 Open Questions; source scope | Passed: 56 scenarios/56 rows; 66/10/16 table preserved exactly; 4 mirrored questions; 21 dispositions; exact summary; 10 changed documents/one STATUS row |
| Required current-code gate | bun run check:full (temporary existing-dependency link) | Exit 1: 1925 pass / 3 fail / 9338 expectations / 304 files; same three Codex snapshot EROFS failures as second revision; lint/architecture/residue/typecheck passed |
| Interrupted aggregate build step, run separately | bun run build | Exit 0: main/preload/renderer production build succeeded |
| Independent third review / implementation / product smoke | Not performed; this remains a pure-document DRAFT | No IMPLEMENTATION_VERIFIED / REVIEW_APPROVED / Owner acceptance |
| Git authority | One local docs commit only | No merge/push/remote PR/release |

The three failed tests are the exact second-revision test names listed above; each
throws CodexAppServerShellSnapshotScrubError during pre-start with `scrub snapshot entry:
EROFS` in the restricted home snapshot area. Product/test code is unchanged. The aggregate
is **failed**, not converted to a pass by separate strict/build results; no out-of-scope
fix or permission escalation was attempted. Native/manual/packaged implementation smoke
is not applicable to this unapproved documentation revision and is not claimed passed.

## Second Review Receipt — Verbatim Closing Summary

Source: the full second-review file indexed above; reviewed SHA
`9e47e2ddb79e3856d16ba1753d87f1cafd107a8d`, workflow `wf_28e60ec0-0f1`.
The text below is the original closing summary, including historical line references
and recommended defaults. It records that review, not a verdict on this revision.

```text
## Second fresh-context draft review

Reviewed SHA: `9e47e2ddb79e3856d16ba1753d87f1cafd107a8d` (one docs-only commit over `0bd7b2bf`; 11 files, +1736/−2006; strict validate exit 0; `git diff --check` exit 0). Five dimension reports (BA, C7, CF, TF, SQ) merged by one synthesizer who re-checked the sole P1 in the documents and code.

**Verdict: CHANGES_REQUESTED** — 0 P0, **1 P1**, 10 P2, 10 P3. Approval-blocking work is a single, bounded document fix (item 1); everything else is touch-up.

**Prior findings:** 58 of 59 first-round findings resolved with checkable evidence; SQ-8 partially resolved (residual is P3 item 21). No regressions. Highlights: Consumer Impact rebuilt on the real public v1 shape (bare payload, source=api, jobId = Run id, one dense sequence); identity convergence and the transport-replacement window removed and registered as Non-goals with real sibling change ids; no gate/Owner state in living requirements; L1–L12 presets separated from labelled D1–D10 additions; 66/10/16 disposition table machine-checked against the trace; resume predicates, late-usage seal, reconciliation carrier, schema/migration path, deletion inventory and the build-time gate all concrete; 12-type v1 vocabulary frozen; 55 scenarios = 55 register rows.

### Findings
1. **[P1] Provenance capture point/owner** — design.md:128-132/156-157/193 and core delta:138-139 require a runtime provenance tuple with binary digest at ledger construction and make `ledger_provenance_json` non-null for every v1 job, while design.md:484/486-487/490 and the architecture delta route `job_created`, scheduled creation and pre-start cancel through that ledger at enqueue time, where no binary is resolved (job-store.ts:302-368; schedules.ts:346-351; agent-jobs.ts:88-96) and no digest facility or owner row exists (runtime-executable.ts stats only; no installation/digest symbol in src/). Fix: add a provenance-owner row + task; two-stage rule (`kind:"pending"` for lifecycle-only records, runtime tuple captured when the adapter resolves its executable and sealed thereafter); scope the construction rejection to runtime-execution ledgers; design.md:193 → nullable for legacy and never-started jobs.
2. **[P2] Living requirements by reference** — architecture delta:12-13, parity delta:6-7/20, core delta:8-9 delegate normative lists to design/tasks, which are not living after archive (AGENTS.md:271). Inline the deletion list; point the parity requirement at the checked-in fixture.
3. **[P2] `job.ledger.historyQuality`** — new optional public job-envelope field named only at design.md:520-521; no local-job-api delta, no C7 row, not in tasks 8.2. Declare and classify it, or scope it internal.
4. **[P2] `/payload/runtime/codex/v1` collision** — `payload.runtime` is already a string in runAgentTask status events on the default API path (agent-runtime.ts:18-40). Coordinator preset with new code evidence: move to `payload.extensions["runtime.codex.v1"]` or state a collision rule plus fixture case.
5. **[P2] "Confirmed dead-worker" predicate** — undefined; today's detection is heartbeat-only (job-recovery.ts; job-store.ts:645-700), workerPid never probed; v0 rows left running become unsettleable after cutover (core delta:116-117; design.md:513). Name the predicate, owner and v0 drain disposition.
6. **[P2] Cross-process conflict reconciliation** — store re-sequencing deleted (design.md:200-204) with only "runtime tests enforce exclusivity" (design.md:533) for the queued-cancel/start race today's withEventSequenceRetry handles (job-store.ts:234-245; agent-jobs.ts:88-96). State reload/re-reserve/idempotent-resubmit or single-process writer rule.
7. **[P2] Task 2.3 vs 2.9/7.15** — atomic deletion of the Workbench wrapper reader (the sole unwrap, workbench-trace-presenter.ts:202-209) contradicts the versioned-decoder migration plan. Keep the unwrap as the ledger_version=0 read branch.
8. **[P2] Reasoning part index** — design.md:232-233 selects `content[partIndex]`/`summary[partIndex]` but the pinned delta params carry no index (app-server-stream-events.ts:51-58); label as inferred and state the fallback.
9. **[P2] Claude SESSION_EXPIRED** — trace §0/§4 obligation has no disposition; classifier still upgrades and clears the binding (agent-sdk-errors.ts:129-138; stream-error-finalization.ts:119-151). Add an inventory row or an explicit Deferred line.
10. **[P2] One-port WHEN** — core delta:11-20 drives vocabulary.json through `ingestRuntimeObservation` alone while requiring artifact/terminal owner ports. Name all three ports / per-case `port` field.
11. **[P2] Discovery scenario narrowing** — local-job-api delta:79-83 replaces the generic living 'Older build lacks the feature' with this change's ids and an unowned 'preflight fixture'. Restore generic wording; name a Locus subject if kept.
12. [P3] Dense projection status-volume increase not stated to consumers (proposal.md:115/122-126; tasks 8.2).
13. [P3] Row 10 rationale ignores the closed `discoveryFeature` enum (schema:106; local-job-api.ts:18-25).
14. [P3] run-artifacts.ts under agent-runtime writes public v1 files; ownership split unrecorded in 8.3.
15. [P3] Commit ordering of late diagnostics between seal and terminal commit unstated (design.md:208-212/271-273/322-345).
16. [P3] Resume fact omits observed thread/turn status, intent and the CODEX-05 race (design.md:354-361; core delta:320-327).
17. [P3] Design vs scenario disagree on ephemeral/path/cliVersion rejection (design.md:355-359; core delta:320-327).
18. [P3] Transport-exit SHALL is unconditional vs the post-seal late-diagnostic rule (core delta:195-197; design.md:283-285).
19. [P3] `missing_local`/`missing_native` never asserted (core delta:164-165).
20. [P3] `readItem` key cannot address items with absent native IDs (design.md:146, 231-232).
21. [P3] Migration-act WHEN in a living scenario (core delta:112) and a run-on fixture list (architecture delta:33-34) — SQ-8 residual.

### Owner decision items (remaining Red + open questions, with recommended defaults)
- **R1 / Open Question 1 — C7 rows 4/5 terminal-result truth and derived create/retry exit codes.** Recommended default: **DIRECT_NEW_STANDARD** (NEW_VERSION and TEMPORARY_FACADE cannot preserve false success under C7 §9.5; the exit-code table is unchanged; the change ships behind the `canonical-run-ledger` feature id with same-change guide/schema/examples and explicit consumer notice).
- **Open Question 2 — deterministic rules: default empty-output failure with the existing explicit allow-empty internal exception; post-completed usage diagnostic-only.** Recommended default: **accept** (matches preset L4 and D6; the trace marks late-usage order unmeasured, so a deterministic seal is the only testable rule).
- **Open Question 3 — minimal immutable provenance snapshot plus schema v1 / legacy-unverified marking in this slice, without a Runtime delivery registry.** Recommended default: **accept, conditioned on item 1** (two-stage capture: pending at enqueue, runtime tuple sealed when the adapter resolves its executable; named owner for digest/fingerprints; L8 preset is preserved).
- **Open Question 4 — dense per-record v1 status projection and terminal-artifact registration in the same durable commit as `completed`.** Recommended default: **accept** (only alternative is a sparse-sequence C7 #5 break; the artifact rule is now implementable), with the status-volume consequence (item 12) stated to consumers.
- Coordinator item (preset, not an Owner gate): item 4 pointer collision — recommended default `payload.extensions["runtime.codex.v1"]`.

Next gate: revised draft addressing item 1 (and the P2 touch-ups as convenient), then a third fresh review, then Owner APPROVED. Nothing here authorizes push, merge, remote PR or release.
```

## Third Fresh-Context Re-check — 4b6ca640 (prev 9e47e2dd)

Targeted re-check of third revision `4b6ca640288555ca1d94c546ca6bf9d13e4b7fba`: HEAD matched,
worktree clean, docs-only diff (10 files, +627/-167), `git diff --check` exit 0. Verdict
**REVIEW_APPROVED** — 0 P0, 0 P1, 2 P2, 5 P3. The second review's P1 (provenance capture
point/owner) is resolved: the two-stage pending/runtime rule is consistent across design,
the agent-runtime-core and architecture-ownership deltas, tasks 2.4/2.5/6.1/7.15 and the
never-started fixtures, with `run-provenance.ts` as a named owner row plus guard pin, and
red tests are now writable for job_created, queued-cancel, never-started and runtime-backed
records. All 10 P2 items applied; the 10 P3s disposed; no regression of the 58 first-round
resolutions (public shape, transport-replacement removal and gate-free living requirements
all re-verified). Strict validation exit 0 single and `--all` (53 passed, 0 failed);
56 scenarios = 56 register rows S01–S56. New P2s (non-blocking, fix before implementation):
(1) design.md:174-176/429-431 make initial `artifact_created` publication wait for execution
binding, unqualified, while core spec.md:164-165 rejects only *native* candidates — today
cli-dispatcher.ts:458-472 emits that event before any executable resolution, so the rule
reorders an already-public event and drops it for never-started runs with no C7 line;
(2) design.md:168/543 and tasks.md:149/154 name `runtime-executable.ts` (only
`getRuntimeExecutableStatus`, never called by an adapter on a run path) as the capture seam
instead of `codex/cli-path.ts:58` and `claude/env.ts:157`. P3s: private
`persistedPayloadForRunEvent` labelled an export; `runtime_selected`/`runtime_selection_refused`
emitted pre-binding; retry budget silently 5→3; unreachable `SESSION_EXPIRED` renderer card
unaudited; `captureRunExecutionProvenance` absent from the guard fixture inventory. R1 and
the four Open Questions remain Owner decisions. Nothing here authorizes push, merge, remote
PR, release or Owner product acceptance.

## Third Re-check Touch-up Dispositions — 2 P2 + 5 P3

Input: [targeted re-check report](/home/chen/.claude/projects/-home-chen-projects-agent-code-for-me/f1888632-cd03-49a0-a57d-51704695f29d/handoff/reviews/run-event-ledger-recheck-4b6ca640.md).
Intake HEAD matched `4b6ca640288555ca1d94c546ca6bf9d13e4b7fba`, with a clean worktree.
The ledger entry above is copied verbatim from report §6. These are author dispositions
of its new findings, not a new independent verdict or Owner decision.

| Finding | Disposition | Updated evidence |
| --- | --- | --- |
| P2 #1 — initial artifact ordering | Applied: only native candidates wait for binding; admitted non-native initial artifact_created keeps its order before job_started. Never-started runs retain any committed initial event/refs; no event is invented when preparation/admission was not reached or failed. | design two-stage capture and terminal artifact step 3; proposal Consumer Impact C7 rows 5/8 clause; core provenance delta; tasks 7.16 |
| P2 #2 — provenance capture seam | Applied: capture the actual executable resolved by codex/cli-path.ts:58 resolveBundledCodexCliPath and claude/env.ts:157 getBundledClaudeBinaryPath at their run launch callers; runtime-executable.ts is status/readiness query only. | design two-stage capture and owner row; tasks 6.1 |
| P3 #1 — private helper called export | Applied: distinguish legacy exports and internal helpers; persistedPayloadForRunEvent is explicitly module-private, with unchanged no-definition/re-export/call-site guard. | architecture-ownership delta; design mapper owner row |
| P3 #2 — pre-binding selection status | Applied: runtime_selected/runtime_selection_refused are pending-admissible host status; preserve payload.runtime strings, omit runtime.codex.v1 extension before binding, never retrofit committed records. | design pending admission; core provenance and local-job-api deltas; tasks 7.16 |
| P3 #3 — retry budget 5→3 | Applied: retain three attempts and explicitly identify the deliberate replacement of today's five-attempt EVENT_SEQUENCE_RETRY_LIMIT. | design conflict reconciliation |
| P3 #4 — unreachable SESSION_EXPIRED card | Applied: audit the union and ipc-chat-transport.ts card in 8.3; replace the path with neutral NATIVE_RESUME_REJECTED / “Session resume rejected”, remove dead category/card, preserve sessionId and avoid expiry/fresh-session claims. | tasks 8.3; existing 6.3 correction remains |
| P3 #5 — provenance guard fixture | Applied: name captureRunExecutionProvenance clean-owner, duplicate-definition and re-export fixtures plus host-only composition/binding checks. | tasks 7.17 architecture-fixtures.json inventory |

R1 and all four mirrored Open Questions remain unchanged and require Owner answers plus
APPROVED before implementation. This dispatch creates one local documentation commit;
no product/test implementation, merge, push, remote PR mutation or release is performed.

## Third Re-check Touch-up Receipts

Date: 2026-09-07 (Pacific/Auckland). Checks cover the documentation tree prepared
from `4b6ca640288555ca1d94c546ca6bf9d13e4b7fba` for the single local commit titled
`docs(openspec): apply re-check touch-ups to canonical run event ledger draft`.
The resulting commit SHA is reported in the handoff; no implementing-source technical
verdict is claimed. Only eight documentation files change: this change directory and
its one STATUS row. Product/test files and the four Open Questions are unchanged.

| Check | Command / environment | Result |
| --- | --- | --- |
| Single strict validation | /home/chen/projects/agent-code-for-me/node_modules/.bin/openspec validate refactor-canonical-run-event-ledger --strict --no-interactive | Exit 0: `Change 'refactor-canonical-run-event-ledger' is valid` |
| All strict validation | /home/chen/projects/agent-code-for-me/node_modules/.bin/openspec validate --all --strict --no-interactive | Exit 0: `Totals: 53 passed, 0 failed (53 items)` |
| Whitespace | git diff --check | Exit 0, no output |
| Documentation inventory | Scripted scope/STATUS-row check, report §6 exact-text comparison, disposition and scenario counts, Open Questions comparison against intake HEAD | Pass: 8 documentation files, only the target STATUS row, verbatim ledger, 7 dispositions, 56 scenarios, all 4 Open Questions unchanged |
| Current-code regression gate | bun run check:full using the main checkout's existing node_modules through a temporary symlink, removed after the check | Exit 1: 1925 passed / 3 failed / 9338 expectations / 304 files. Lint, architecture, retired-runtime residue and typecheck passed; the same three unchanged Codex adapter tests recorded above fail during pre-start snapshot scrubbing with EROFS. The aggregate stops at tests, so its build/diff stages did not run; strict validation and git diff --check ran separately. |
| Product / manual smoke | Not run: documentation-only DRAFT; no approved product implementation | No product, runtime conformance or Owner acceptance claim |

Full aggregate output: `/tmp/run-event-ledger-touchups-check-full.log` (local diagnostic
receipt). No package/lockfile change, product-code workaround or permission escalation
was used. The historical REVIEW_APPROVED stays bound exclusively to `4b6ca640`; these
receipts do not transfer that independent verdict to the touch-up commit.

## Owner APPROVED receipt — 2026-09-07

Source: Owner evening decision relayed in the current coordinator dispatch. Intake HEAD
matched `9ebe6c3410c23575e991d91ee8fb71b95854bea8`, with a clean worktree.
**Owner APPROVED** grants implementation permission bound to that exact design content
SHA (`9ebe6c34`); this approval-record commit does not rebind the historical independent
REVIEW_APPROVED at `4b6ca640` or claim IMPLEMENTATION_VERIFIED / Owner ACCEPTED.

1. R1, C7 rows 4/5: **DIRECT_NEW_STANDARD**, semantic **BREAKING**. Rejected/invalid-empty
   runs fail with reasons and corresponding CLI exit codes. Same-change consumer
   guide/schema/conformance updates and Amadeus / Career Kit adaptation are required;
   their implementation receipts remain future work, not claimed here.
2. Accepted: default empty output fails, existing explicitly allowed internal empty-output
   requests remain exceptions, and usage after completed is readable diagnostic-only.
3. Accepted: this slice owns the minimal immutable provenance snapshot, schema v1 and
   `legacy_unverified` historical marking, with two-stage pending/runtime capture;
   it does not wait for a Runtime delivery registry.
4. Accepted: dense per-record v1 status projection, consumer `--after` pagination with
   increased status volume, and terminal artifact registration in the same durable
   commit as completed.

Implementation is queued after `add-linked-worktree-admission` and
`add-renderer-untrusted-content-hardening`. Next gate: **test-first: independent author
writes red acceptance tests before implementation (pilot policy 2026-09-05)**. Source
edits still require that red suite. This dispatch changes only approval documentation
inside this change and its STATUS row; no product/test authoring, merge or push.

### Approval-record validation

Checks cover this documentation-only approval record over `9ebe6c34`; the resulting
single local commit SHA is reported in the handoff. No implementing-source verdict
is claimed.

| Check | Command / environment | Result |
| --- | --- | --- |
| Single strict | /home/chen/projects/agent-code-for-me/node_modules/.bin/openspec validate refactor-canonical-run-event-ledger --strict --no-interactive | Exit 0: `Change 'refactor-canonical-run-event-ledger' is valid` |
| All strict | /home/chen/projects/agent-code-for-me/node_modules/.bin/openspec validate --all --strict --no-interactive | Exit 0: `Totals: 53 passed, 0 failed (53 items)` |
| Whitespace | git diff --check | Exit 0, no output |
| Scope / consistency | Changed-path and single STATUS-row check; proposal/design answer equality | Five Markdown files only; only the target STATUS row changes; four answers agree; spec deltas and product/test files unchanged |
| Required current-code gate | bun run check:full, temporary symlink to main checkout's existing node_modules, removed after execution | Exit 1: 1925 passed / 3 failed / 9338 expectations / 304 files; lint, architecture, retired-runtime residue and typecheck passed. The same three unchanged Codex snapshot-scrub EROFS tests recorded in prior receipts fail; the aggregate stops at tests, before spec/build/diff stages. Strict validation and diff checks ran separately. |
| Product / manual smoke | Not run for this approval-record-only dispatch | No implementation or smoke-pass claim |

Full aggregate output: `/tmp/run-event-ledger-owner-approval-check-full.log` (local
diagnostic receipt). The aggregate failure is retained as failed; no product/test fix,
package/lockfile change, permission escalation, merge or push was performed.
