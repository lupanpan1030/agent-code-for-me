## Context
Locus currently has Claude and Codex runtime paths, but Claude Code is the path with stronger product assumptions around tool gating, plan mode, session behavior, and runtime-specific feature surfaces. `add-headless-agent-jobs` introduces an `AgentRuntime` contract that can expose Codex honestly, including `degraded` and `unsupported` capability states. This change is the follow-up that turns Codex gaps into implemented behavior where Locus presents a runtime-neutral experience.

## Goals / Non-Goals
- Goals:
  - Make Codex first-class for the runtime capabilities Locus exposes as shared product behavior.
  - Prove hard safety claims with pre-execution enforcement, not prompt-only instructions.
  - Keep capability declarations tied to tests and real adapter behavior.
  - Preserve local-first and credential boundaries.
  - Keep desktop and future headless callers consuming the same capability truth.
- Non-goals:
  - Building the local job platform itself.
  - Copying Codex CLI, Claude Code, ACP, Goose, or another runtime wholesale.
  - Treating Claude-only research-preview features as runtime-neutral without a Codex equivalent or explicit rescope.

## Capability Groups

### Core Safety Parity
Codex must reach `supported` for:
- `hardToolGuard`
- `planMode`
- `scopeExpansion`
- `askUserQuestion`
- `rollback`
- `mcpAuth`

These capabilities protect user intent, write boundaries, and interactive control. They should be implemented before claiming Codex is safe for the same guarded agent workflows as Claude.

### Runtime Feature Parity
Codex must reach equivalent user-facing behavior for:
- `mcpConfiguration`
- `providerProfiles`
- `attachments`
- `usageMetadata`
- `runtimePlugins`
- `runtimeCommands`
- `runtimeWorkflows`
- `appAgents`

Feature parity does not require identical upstream primitives. A runtime-native Codex implementation and a Locus-owned shared layer are both acceptable. Prompt injection, documentation-only entries, installed/read-only visibility, or UI labels without execution paths are not enough.

## Decisions

### Separate From Headless Jobs
Decision: keep Codex parity as a dedicated OpenSpec change.

Why: headless jobs only need a truthful runtime contract and caller gating. Requiring full Codex parity would block job persistence, CLI command dispatch, and desktop job visibility on a much larger runtime upgrade.

### Supported Means Enforced
Decision: Codex may report a capability as `supported` only when the adapter or a Locus-owned shared layer enforces or provides the behavior.

Why: UI similarity and prompt-only instructions are not equivalent to a runtime capability. This is especially important for hard tool guards, plan mode, scope expansion, and AskUserQuestion flows.

### Keep Degraded States Visible During Development
Decision: degraded/unsupported Codex capability states remain valid during implementation, but not at this change's completion gate for parity-owned capabilities.

Why: honest intermediate states let desktop and CLI surfaces stay usable while making remaining gaps measurable.

### Rescope Instead Of Pretend
Decision: if a parity surface cannot be implemented safely, rescope it explicitly in OpenSpec rather than marking it supported.

Why: parity claims are product contracts. A rescope is clearer than shipping a false capability declaration.

## Risks / Mitigations
- Codex or ACP may not expose pre-tool interception hooks.
  - Mitigation: add a safe Locus-owned proxy/wrapper seam or keep the capability degraded until a viable enforcement path exists.
- Capability manifests can drift from adapter behavior.
  - Mitigation: add contract tests that exercise every Codex capability marked `supported`.
- Feature parity can expand into unrelated product work.
  - Mitigation: limit implementation to behavior already presented as runtime-neutral or necessary to stop false parity claims.
- Claude Dynamic Workflows may remain Claude-specific.
  - Mitigation: either keep workflow parity out of runtime-neutral surfaces, build a Codex equivalent, or add a separate rescope before completion.

## Phase Boundary
- Phase 1 is complete when Codex core safety parity passes tests and real desktop smoke.
- Phase 2 is complete when runtime feature parity surfaces pass tests and real desktop smoke.
- The change is complete only when remaining unsupported Codex surfaces are explicitly rescoped or no longer presented as runtime-neutral parity requirements.
