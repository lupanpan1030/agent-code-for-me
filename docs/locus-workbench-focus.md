# Locus Workbench Focus and Scope Lock

Languages: English | [Simplified Chinese](locus-workbench-focus.zh-CN.md)

> **Status: SUPERSEDED FOR PRODUCT DIRECTION — 2026-08-25.** The canonical product direction is
> [Locus Product Direction and Harness Strategy](ideas/locus-product-direction-harness-strategy.zh-CN.md).
> This file remains as a historical execution-slice record. This marker neither cancels nor
> authorizes any OpenSpec change.

## Stable Positioning

Locus is a workbench for running coding agents safely in parallel on real git repos.

The visible product is a local-first desktop workbench for project-backed Workspaces. It brings
agent activity, local changes, conflict evidence, runtime state, usage, and review actions into one
place while keeping the user in control.

Runtime adapters, provider profiles, gateway routing, local jobs, daemon, schedules, and protocol
surfaces are supporting infrastructure. They should not become the product identity.

Do not describe Locus as an AI OS, generic workflow orchestrator, local job platform, or runtime
hub as the main positioning.

## Current Foundation

The current codebase already has enough foundation to stop expanding sideways:

- the engine set is a closed two: Claude Code and Codex, with capability manifests and run gates
- the Codex desktop/chat adapter is app-server-only; ACP remains only as the Locus-owned
  `locus acp` stdio surface, not as a Codex desktop adapter
- local job infrastructure exists for `locus run`, `locus jobs`, daemon, schedules, API runs,
  status, events, cancel, retry, and heartbeat
- provider profiles and the provider gateway model third-party or local model backends without
  sending provider secrets to the renderer
- the Agent Workbench already aggregates project-backed Workspaces and reuses existing chat,
  diff/review, and GitHub workflow surfaces

The next work should make parallel agent operation safer and easier to adjudicate, not add another
engine or another review surface.

## Current Cut

The parallel-safety sequence is:

```text
cross-Workspace conflict detection now; Workspace isolation next
```

Keep the sequence to two bounded slices:

1. Cross-Workspace Conflict Detection Now
   Show same-path warnings from state the Workbench already collects. Run deeper hunk and
   committed-tree checks only on explicit user action, label their limits, and route review into
   the existing filtered diff surface. Conflicts are annotations, not task statuses.

2. Workspace Isolation Next
   Define cwd leases, rollback safety, and worktree-per-run in a separate approved OpenSpec
   change. This conflict-detection slice does not implement or imply those guarantees.

Neither slice makes Locus an automatic merger or resolver. The user remains the adjudicator.

## Scope Rules

Allow work now only when it directly improves the parallel-safety cut:

- shows cross-Workspace activity and overlap truthfully
- preserves the existing status taxonomy while adding conflict annotations
- labels path, hunk, and committed-tree evidence at their actual confidence and scope
- reuses the existing per-Workspace diff/review surface and registered-root boundary
- records reproducible verification evidence for safety and subprocess-cost claims

Park work when it does not fit that cut, even if it is useful later:

- automatic merge, rebase, or conflict resolution
- cwd leases, rollback changes, or worktree-per-run inside the current conflict change
- reopening the engine set beyond Claude Code and Codex
- runtime feature expansion unrelated to safe parallel work
- generic workflow engines
- AI OS positioning
- computer-use or screen-control features
- further expansion of the already-shipped runtime-scoped plugin marketplace center
- all-model benchmarking
- full hosted or headless SaaS
- ACP as a Codex desktop adapter or headline product target
- durable workflow management

## Active Proposal Triage

`openspec list` is authoritative. In the current list, `add-cross-workspace-conflicts` is the
user-visible focus. `update-trpc-capability-boundary`, `add-local-job-api-runtime-readiness`,
`add-headless-provider-binding`, and the complete-but-unarchived `add-remote-model-catalog` are
supporting or security work; they do not redefine the product thesis.

`add-agent-native-projection-writes` and `add-policy-grant-scope-enforcement` remain deferred.
Workspace isolation requires its own approved change before implementation.

## Documentation Rule

Use:

```text
Locus is a workbench for running coding agents safely in parallel on real git repos
project-backed Workspaces
cross-Workspace conflict annotations
honest path, hunk, and committed-tree evidence
existing per-Workspace diff/review surface
Claude Code and Codex as the closed engine set
Codex app-server for desktop/chat
Locus-owned `locus acp` stdio surface
Workspace isolation as the next separately approved slice
```

Avoid as headline positioning:

```text
AI OS
local job platform
runtime hub
workflow orchestrator
automatic conflict resolver
complete ACP server
ACP as the Codex desktop adapter
universal automation platform
computer-control platform
cloud agent platform
complete filesystem isolation
```
