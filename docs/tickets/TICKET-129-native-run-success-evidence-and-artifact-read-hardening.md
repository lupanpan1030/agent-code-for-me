# TICKET-129 — Native Run success evidence and artifact read hardening

## Status and evidence

Open follow-up from Owner ACCEPTED 2026-10-01 for
`refactor-canonical-run-event-ledger` source `f5704cb6`. The Owner accepted
these residuals for this slice; implementation needs its own approved scope.
The change's `verification.md` records them under Lens A/C re-review and the
T4 server-request/history disclosures.

## Current behavior

- A native Run without a committed native terminal can fall back to
  `host_result: succeeded` in the headless runner
  (`src/main/lib/headless/job-runner.ts:419-431,470-500`) or desktop finalizer
  (`src/main/lib/desktop-agent-jobs.ts:391-427`). Current production adapters
  supply the native success terminal; the missing-evidence path is still
  allowed by the host and should fail as `success_evidence_missing`.
- Desktop `committedDesktopNativeTerminal` derives status and observation key
  without carrying the native error code
  (`src/main/lib/desktop-agent-jobs.ts:339-375`).
- Codex transport dispatches a parsed server request via a microtask
  (`src/main/lib/codex/app-server-transport.ts:368-377`). A later notification
  in the same stdout chunk can reach the ledger first, leaving the request
  as `status/late_event` after terminal sealing.
- Desktop history appends item deltas after a final `item_reconciliation`
  (`src/main/lib/codex/desktop-run-persistence.ts:195-224`), while the ledger
  item fold ignores deltas for a completed item
  (`src/main/lib/agent-runtime/run-event-ledger.ts:3986-4028`). The live
  native path's current echo does not expose the difference, but other
  committed post-final deltas can.
- `readRunArtifactFile` reads in 64 KiB chunks until EOF without a byte cap
  (`src/main/lib/agent-runtime/run-artifacts.ts:625-631`). Its
  `O_RDONLY | O_NOFOLLOW` open lacks `O_NONBLOCK` (`:601-612`); a FIFO swap
  between `lstat` and open can block the host thread.

## Suggested scope

1. Require a committed native success terminal for every native Run. Settle
   missing evidence as `success_evidence_missing`; keep explicit batch and
   completion host-result semantics. Add missing-terminal and genuine-native
   terminal tests for desktop and headless.
2. Preserve native failure `code` in desktop committed terminal evidence and
   public diagnostics as specified by the accepted contract.
3. Ingest parsed server requests at the parsing boundary in wire order,
   retaining fail-closed response handling and cancellation semantics.
4. Use one canonical item reducer for ledger `readItem`, output evidence and
   desktop persisted-history folding. Test final-text overwrite, late delta,
   repeated echo, empty final and independent items across those readers.
5. Stop artifact reads at `before.size + 1` bytes, reject growth, and open
   with `O_NONBLOCK` while preserving stable-directory and file-identity
   checks. Test growing files and a FIFO rename race.

## Boundaries

Do not change the accepted source slice or infer that host-blocked runtime
smoke passed. Review any public error/event change under the Consumer Impact
contract before implementation. Windows run-dir availability is tracked
separately by TICKET-127.
