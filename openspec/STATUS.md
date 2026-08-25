# OpenSpec Delivery Status

This ledger records execution state only. Current product truth remains in
`openspec/specs/` plus the checked-out code; future direction remains in the
ratified strategy and interoperability contract.

Updated: 2026-08-25 (Pacific/Auckland)

| Change | State | Concrete next gate |
| --- | --- | --- |
| `add-cross-workspace-conflicts` | Verification / Acceptance | Close independent-review findings, bind verification and both AI verdicts to one source SHA, then receive Owner acceptance and archive after local integration. |
| `add-remote-model-catalog` | Verification / Acceptance | Reverify the integrated code, bind fresh independent review and Owner acceptance to an exact SHA, then archive. |
| `add-headless-provider-binding` | Verification / Acceptance | Built-Electron profile/native smoke is green; bind full verification and independent review to an exact SHA, then accept and archive. |
| `add-local-job-api-runtime-readiness` | Verification / Acceptance | RT-2 and Career Kit outcome agreement is green; bind full verification and independent review to an exact SHA, then accept and archive. |
| `update-trpc-capability-boundary` | Blocked pending rebaseline | Separate already-shipped Phase 1/CSP/Mermaid/MCP guarantees from unfinished renderer/browser and capability/audit work; validate and archive only implemented truth, then create bounded follow-ups. |

Parked proposals are indexed in [`deferred/README.md`](deferred/README.md) and
do not appear in the active list.
