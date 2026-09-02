# OpenSpec Delivery Status

This ledger records execution state only. Current product truth remains in
`openspec/specs/` plus the checked-out code; future direction remains in the
ratified strategy and interoperability contract.

Updated: 2026-09-02 (Pacific/Auckland)

| Change | State | Concrete next gate |
| --- | --- | --- |
| `refactor-engine-vocabulary-residue` | Approved (Foundation 1d; Owner `APPROVED` 2026-08-26) | Implementation remains sequenced after 1c; re-verify all anchors against that later tree. |
| `update-trpc-capability-boundary` | Blocked pending rebaseline | Separate already-shipped Phase 1/CSP/Mermaid/MCP guarantees from unfinished renderer/browser and capability/audit work; validate and archive only implemented truth, then create bounded follow-ups. |

Parked proposals are indexed in [`deferred/README.md`](deferred/README.md) and
do not appear in the active list.

## Locally archived 2026-09-02

### Foundation 1c

`add-architecture-guard-ratchet` received Codex `IMPLEMENTATION_VERIFIED` and two independent
fresh-context Claude `REVIEW_APPROVED` verdicts for source
`9a80a755eac1baf4e8c26e61b200c85446cca995`. The Owner explicitly `ACCEPTED` the change on
2026-09-02. Its clean evidence branch head
`c52a422aed75841cd85f51149da9956d92045ff2` was fast-forwarded into local `main`, and the
post-merge `bun run check:full` at that exact SHA passed with **1,916 tests / 0 failures /
9,291 expectations across 302 files**, retired-runtime residue **1,612 scanned / 10
allowlisted**, and OpenSpec **55/55**. The standard archive applied the accepted delta to the
living `architecture-ownership` spec:

- [`2026-09-02-add-architecture-guard-ratchet`](changes/archive/2026-09-02-add-architecture-guard-ratchet/)
- Living spec: [`architecture-ownership`](specs/architecture-ownership/spec.md)
- Yellow sibling-route follow-up: [`TICKET-122`](../docs/tickets/TICKET-122-route-ratchet-sibling-file-coverage.md)

Foundation 1d (`refactor-engine-vocabulary-residue`) is now unblocked for W1 from the archived
1c tree.

### Nested registered cwd resolution (#18 safe half)

`fix-nested-project-cwd-resolution` received Codex `IMPLEMENTATION_VERIFIED` and two independent
fresh-context Claude `REVIEW_APPROVED` verdicts for source
`1cce15b4e37aac3afb32a2621ea89f4d8be69e95`, followed by Owner `ACCEPTED` on 2026-09-02.
Evidence head `44c437f4c94b4b21e02f098abb650430d19f8383` was merged with `--no-ff` into the
post-1c tree as `29981d24aa9d05e22dc8534441ef73f04eed579a`, preserving the reviewed source in
history. The sole conflict was the `openspec/STATUS.md` evidence ledger and was resolved as the
Owner-authorized single-file union; no other file was manually changed. `bun run check:full` at
the exact merge SHA passed with **1,917 tests / 0 failures / 9,294 expectations across 302
files**, retired-runtime residue **1,613 scanned / 10 allowlisted**, and OpenSpec **55/55**.
The standard archive applied the accepted delta to the living `project-lifecycle` spec:

- [`2026-09-02-fix-nested-project-cwd-resolution`](changes/archive/2026-09-02-fix-nested-project-cwd-resolution/)
- Living spec: [`project-lifecycle`](specs/project-lifecycle/spec.md)

Both accepted closeouts are now locally archived. The final exact-SHA full gate passed at
`291a472949e2e110109935b315de3db2aeaf9999`. The first Owner-authorized
`git push origin main` attempt was rejected by GitHub with `GH013` because the then-current OAuth
App credential lacked `workflow` scope for the included `.github/workflows/ci.yml` update. That
failure is retained as audit history, but it is no longer the current delivery state: after the
Owner completed the required GitHub authorization, the authorized push succeeded on 2026-09-02.
`git ls-remote origin refs/heads/main` confirmed final remote `main` at
`a4ea92301f80716926926c9cbbba389c2d57e8cd`, exactly matching the pushed local `main` SHA.

## Locally archived 2026-08-27

### Foundation 1b

`add-chat-session-binding` received Codex `IMPLEMENTATION_VERIFIED` and fresh-context Claude Code
`REVIEW_APPROVED` for source `1d019f8d4fab38829ad0e3108e9569b260ab9302`. Local `main` was
fast-forwarded from the archived 1a closeout to evidence head
`1d4e004b30e573ebf95235fd7baa725780d659e8`, where `bun run check:full` passed with **1,897
tests / 0 failures / 9,230 expectations** and OpenSpec **55/55**. The Owner then gave explicit
`ACCEPTED add-chat-session-binding`, including acceptance of the disclosed GUI-smoke gap as a
residual risk without treating it as passed. The standard archive applied the accepted delta and
created the living `chat-session-binding` spec:

- [`2026-08-27-add-chat-session-binding`](changes/archive/2026-08-27-add-chat-session-binding/)
- Living spec: [`chat-session-binding`](specs/chat-session-binding/spec.md)
- GUI follow-up shared with 1a: [`TICKET-114`](../docs/tickets/TICKET-114-codex-desktop-extraction-gui-smoke.md)

Current changes/specs pass strict validation **55/55**. Archived-task validation marks this entry
passed; the archive-wide aggregate is **104/110** because six older archived entries retain
pre-existing incomplete task checkboxes. No remote operation was authorized or performed.

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

At the 2026-08-26 checkpoint, all five entries archived that day passed the archived-task
validator and current changes/specs passed strict validation 55/55. The repository-wide archive
audit was then 103/109 because six older archived entries already contained incomplete task
checkboxes; that pre-existing archive debt was not rewritten as part of either closeout.
