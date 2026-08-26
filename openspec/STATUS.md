# OpenSpec Delivery Status

This ledger records execution state only. Current product truth remains in
`openspec/specs/` plus the checked-out code; future direction remains in the
ratified strategy and interoperability contract.

Updated: 2026-08-26 (Pacific/Auckland)

| Change | State | Concrete next gate |
| --- | --- | --- |
| `add-chat-session-binding` | Approved (Foundation 1b; Owner `APPROVED` 2026-08-26, revised: per-sub-chat binding atoms deleted in-change) | Start W1 implementation from the locally archived 1a closeout; use a dedicated branch/worktree and delete all five per-chat binding atom groups in-change. |
| `add-architecture-guard-ratchet` | Approved (Foundation 1c; Owner `APPROVED` 2026-08-26) | Implementation sequenced after 1a/1b so baselines capture the post-extraction tree. |
| `refactor-engine-vocabulary-residue` | Approved (Foundation 1d; Owner `APPROVED` 2026-08-26) | Implementation sequenced after 1b (anchors re-verified against the post-1b tree). |
| `update-trpc-capability-boundary` | Blocked pending rebaseline | Separate already-shipped Phase 1/CSP/Mermaid/MCP guarantees from unfinished renderer/browser and capability/audit work; validate and archive only implemented truth, then create bounded follow-ups. |

Parked proposals are indexed in [`deferred/README.md`](deferred/README.md) and
do not appear in the active list.

## Locally archived 2026-08-26

### Foundation 1a

`refactor-codex-desktop-service-extraction` received Codex `IMPLEMENTATION_VERIFIED` and
fresh-context Claude Code `REVIEW_APPROVED` for source
`6bf928bf00051ab1e9513b67162280677134d972`. Local `main` was fast-forwarded to the
evidence head `13e3777a0a39724f171eb2e563dae4774d0b0926`, where `bun run check:full` passed
with 1,679 tests / 0 failures and OpenSpec 56/56. The Owner then gave explicit
`ACCEPTED refactor-codex-desktop-service-extraction`, including acceptance of the disclosed
GUI-smoke gap as a residual risk. The change was archived locally with `--skip-specs`:

- [`2026-08-26-refactor-codex-desktop-service-extraction`](changes/archive/2026-08-26-refactor-codex-desktop-service-extraction/)
- Follow-up: [`TICKET-114`](../docs/tickets/TICKET-114-codex-desktop-extraction-gui-smoke.md)

No remote operation was authorized or performed.

### Runtime integration batch

The following four changes received Codex `IMPLEMENTATION_VERIFIED` and fresh-context Claude Code
`REVIEW_APPROVED` for source `bdd2e2e57143a69f86f34ed96f84aa9a5e076fd4`, passed the local-main
post-merge gate at `2a41522c01e5bb7e55014218c087e814a28be583`, received explicit Owner
`ACCEPTED`, and were archived locally without any remote operation:

- [`2026-08-26-add-cross-workspace-conflicts`](changes/archive/2026-08-26-add-cross-workspace-conflicts/)
- [`2026-08-26-add-headless-provider-binding`](changes/archive/2026-08-26-add-headless-provider-binding/)
- [`2026-08-26-add-remote-model-catalog`](changes/archive/2026-08-26-add-remote-model-catalog/)
- [`2026-08-26-add-local-job-api-runtime-readiness`](changes/archive/2026-08-26-add-local-job-api-runtime-readiness/)

All five entries archived locally on 2026-08-26 pass the archived-task validator, and current
changes/specs pass strict validation 55/55. The repository-wide historical archive audit is now
103/109 because six older archived entries already contain incomplete task checkboxes; that
pre-existing archive debt was not rewritten as part of this closeout.
