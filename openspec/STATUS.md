# OpenSpec Delivery Status

This ledger records execution state only. Current product truth remains in
`openspec/specs/` plus the checked-out code; future direction remains in the
ratified strategy and interoperability contract.

Updated: 2026-08-26 (Pacific/Auckland)

| Change | State | Concrete next gate |
| --- | --- | --- |
| `refactor-codex-desktop-service-extraction` | Draft (Foundation 1a) | Owner records `APPROVED`; then Codex implements on its own branch per W1. First of the four sequenced Foundation Stabilization changes. |
| `add-chat-session-binding` | Draft (Foundation 1b) | Owner records `APPROVED`; implementation sequenced after 1a. |
| `add-architecture-guard-ratchet` | Draft (Foundation 1c) | Owner records `APPROVED`; implementation sequenced after 1a/1b so baselines capture the post-extraction tree. |
| `refactor-engine-vocabulary-residue` | Draft (Foundation 1d) | Owner records `APPROVED`; implementation sequenced after 1b (anchors re-verified against the post-1b tree). |
| `update-trpc-capability-boundary` | Blocked pending rebaseline | Separate already-shipped Phase 1/CSP/Mermaid/MCP guarantees from unfinished renderer/browser and capability/audit work; validate and archive only implemented truth, then create bounded follow-ups. |

Parked proposals are indexed in [`deferred/README.md`](deferred/README.md) and
do not appear in the active list.

## Locally archived 2026-08-26

The following four changes received Codex `IMPLEMENTATION_VERIFIED` and fresh-context Claude Code
`REVIEW_APPROVED` for source `bdd2e2e57143a69f86f34ed96f84aa9a5e076fd4`, passed the local-main
post-merge gate at `2a41522c01e5bb7e55014218c087e814a28be583`, received explicit Owner
`ACCEPTED`, and were archived locally without any remote operation:

- [`2026-08-26-add-cross-workspace-conflicts`](changes/archive/2026-08-26-add-cross-workspace-conflicts/)
- [`2026-08-26-add-headless-provider-binding`](changes/archive/2026-08-26-add-headless-provider-binding/)
- [`2026-08-26-add-remote-model-catalog`](changes/archive/2026-08-26-add-remote-model-catalog/)
- [`2026-08-26-add-local-job-api-runtime-readiness`](changes/archive/2026-08-26-add-local-job-api-runtime-readiness/)

All four archived entries pass the archived-task validator, and current changes/specs pass strict
validation 52/52. The repository-wide historical archive audit remains 102/108 because six older
archived entries already contain incomplete task checkboxes; that pre-existing archive debt was not
rewritten as part of this closeout.
