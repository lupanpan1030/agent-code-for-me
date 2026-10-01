# TICKET-130 — Async submit relay and Windows verification

## Status and evidence

Open follow-up from coordinator ACCEPTED 2026-10-02 under the Owner's
self-iteration mandate for `add-local-job-api-async-submit` source
`432cc160`. Residuals accepted for this slice; this ticket does not authorize
product implementation. Canonical evidence: the change's `verification.md`,
R4 implementation decision/disclosures, smoke matrix and acceptance section.
TICKET-127 owns the Windows stable-directory backend; TICKET-128 owns full
creation/publication crash recovery. Do not duplicate those owners here.

## Current behavior and gaps

- The relay yields past a poll phase before reporting/disarming; a signal
  arriving after the final finally yield may be lost as the process exits.
- Windows relay default-disposition re-raise exits 1 for SIGINT/SIGTERM or
  8 for SIGBREAK/SIGHUP, versus no-listener STATUS_CONTROL_C_EXIT
  (0xC000013A). These are Node/libuv inferences, not Windows receipts.
- Own-pump signal baseline is evidenced under Bun only. Electron packaged
  SIGINT/SIGTERM/SIGHUP disposition relative to old build `2c59664f` is
  unverified; this WSL host cannot launch Electron (missing shared libraries).
- An abort held during admission waits until admission yields an ID or fails;
  wedged admission can hold it. A 500 ms hard-kill grace can truncate the
  5 s cancel acknowledgment wait. SIGKILL/TerminateProcess cannot relay.
- Tasks 1.4/7.2 require Windows Ctrl+C/Ctrl+Break/console close, child.kill
  and TerminateProcess receipts, plus POSIX process-group kill with real
  grandchildren. Task 7.10's win32 env allowlist is unverified.

## Verification scope and acceptance

1. Use disposable, isolated profiles and exact old/new builds. Record host,
   binary/runtime versions and source SHA. Keep Windows with/without artifacts
   separate: until TICKET-127 lands, artifact-bearing attempts fail closed and
   leave failed/artifact_admission_failed rows; do not claim artifact delivery.
2. Run the Windows abort matrix and capture stdout/stderr/exit, child and
   grandchild liveness, row status and recovery outcome. Compare inferred
   exit codes with observed values and update both guides if needed.
3. On an Electron-capable host compare packaged own-pump signal receipts with
   `2c59664f`: actual process disposition, runtime child teardown, Run status
   and recovery. Run the existing manual/packaged smoke matrix, including
   daemon-first, stdio shutdown/EOF and env sentinel; record macOS and Windows
   independently. Bun/WSL tests do not substitute for packaged evidence.
4. Probe the final yield/disarm boundary and admission that does not finish;
   record the held-abort duration and outcome. Design any necessary fix in
   the canonical wrapper/submit owner with deterministic failure-before/fix-after
   evidence and new exact-SHA dual review. Any public abort/error/exit change
   requires Consumer Impact and Owner approval.
5. Validate win32 env allowlist with artificial nonsecret sentinels.

## Boundaries

Do not modify the accepted slice as part of documentation closeout. Do not
introduce another relay, queue, cancel or publication state machine. Reliable
consumer cancellation continues to use cancel-by-ID. No platform completion
or stable packaged claim until actual receipts exist.
