# TICKET-131 — Async submit accepted follow-ups

## Status and evidence

Open follow-up from coordinator ACCEPTED 2026-10-02 under the Owner's
self-iteration mandate for `add-local-job-api-async-submit` source `432cc160`.
This ticket indexes accepted incomplete work; it does not authorize changes.
The archived change's `verification.md`, tasks PARTIAL rows and red-receipt
§6 are the canonical scope/evidence. Platform/R4 receipts belong to
TICKET-130, Windows artifact backend to TICKET-127, full creation/publication
recovery to TICKET-128.

## Remaining work (all incomplete)

| Origin | Missing evidence or implementation |
| --- | --- |
| 4.9 / S22 / 8.1 | Migration-failure fixture; independent userData paths; old binary pointed at new marker negative case (old code does not automatically fence); positive process/profile isolation; rollback stop/drain and isolated old build |
| 3.3 / SYN-25 | Per-poll stat and hash cache only for unchanged seal/ref/identity/size/mtime/ctime; revalidate on change; current implementation recomputes digest |
| 7.3 / S07 | Commit between initial read and wakeup registration using a deterministic read/wakeup latch |
| 7.4 / S11 | Real concurrent interleave with creation committed and initial admission pending; one reservation and no duplicate execution |
| 7.6 / S17 | Reader-side nonce A→B between two reads (writer-side successor already covered) |
| 7.7 / S18 | Slow-cancel preparation racing an immediately failing claimant; one terminal and isolated staging cleanup |
| 7.9 / S27 | Fault after every staged write, not only the final staged write; reopen/publish readiness remains fail closed |
| 7.9 / S37 | Create/default-retry paused after admission at beforeOwnPumpClaim |
| 7.10 / S39 | Wrapper-paused claim revalidation variant |
| 7.10 / S40 | Cross-process probing readiness and executor/caller env provenance; win32 allowlist receipts tracked by TICKET-130 |
| Guard residuals | Detect or explicitly bound alias/.call/raw SQL and indirect owner bypasses; existing structural guards are not exhaustive proof |

7.2's Windows/packaged/real-grandchild receipts are TICKET-130. Tasks 8.1's
full-coverage claim remains deferred until these and red-receipt §6 gaps are
actually executed; checked scenario registration is not full sub-item coverage.

## Suggested bounded implementation and verification

- Approve each implementation scope separately, preserve canonical ownership
  and immutable red-suite provenance (`20e7bfcf`, adjudications
  `d59b1142`/`770c78ad`). New fixtures must be independent contract evidence,
  with failure-before/fix-after or baseline receipts where applicable.
- Migration/rollback fixtures must not mix writers/profiles or delete external
  consumer data. Whole-group rollback is the no-ff merge revert; do not
  independently revert commits within the accepted branch.
- Cache only digest work; never infer readiness from status, one file,
  follow completion or memory flags. Test identity replacement, file change,
  seal change and unchanged-file cache hits through the existing artifact owner.
- Guard enhancement needs positive and negative mutation fixtures; retain
  architecture ratchet and unique appendExact owner. Do not implement another
  insertion/dispatch/publication business path to satisfy a test.
- Bind targeted checks, check:full and fresh independent review to the same
  final source SHA; update completed sub-items only after real receipts exist.

## Boundaries

No feature expansion, new transport, full publication repair, platform backend
or consumer-specific roadmap negotiation. Public contract/security changes
require their own Consumer Impact/Owner decision. This ticket does not turn
accepted deferrals into completed gates.
