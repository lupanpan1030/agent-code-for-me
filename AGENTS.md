<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

## Canonical Product and Delivery Context

Before planning product direction, architecture, public APIs, Runtime delivery,
or multi-Agent collaboration, read these in order:

1. `docs/ideas/locus-product-direction-harness-strategy.zh-CN.md`
2. `docs/ideas/locus-interoperability-contract-v1.zh-CN.md`
3. `docs/ideas/locus-ai-collaboration-workflow.zh-CN.md`
4. `openspec/STATUS.md` and the relevant approved change

The ratified documents constrain direction; they do not authorize product-code
implementation by themselves. Current product truth remains code plus
`openspec/specs/`. Public/versioned contract changes must include a completed
`docs/consumer-impact-template.zh-CN.md` decision in the implementing change.

## Architecture Ownership

Before changing runtime, provider, guard, auth, capability, MCP, chat, or
renderer runtime-event state logic, read `docs/OWNERSHIP_MAP.md` and identify
the canonical owner for the capability being changed.

This project does not allow old/new duplicate business paths. When extracting
logic into a new module, service, adapter, or helper, the same change must
remove or replace the old helper and call sites. Do not keep both paths alive.

Temporary dual paths are only allowed when the change includes all of these:
- a canonical owner
- an explicit migration flag or gate
- a deletion date or deletion follow-up
- tests or architecture guards proving the allowed boundary
- a deprecation comment naming the removal plan

Routes and transports may parse request or stream envelopes, but durable
business rules and shared state transitions must live in their canonical owner.
Do not add a second implementation just because another runtime, provider, or
UI path needs the same behavior.

## Verification and Git Authority

- Run `bun run check:full` before completion, plus the targeted and manual smoke
  required by the approved change.
- Bind implementation verification and independent review to the same exact
  source SHA. A later code change invalidates both verdicts.
- Codex may implement and create local commits. Claude Code reviews from a fresh
  context. Both technical verdicts are required before Owner acceptance.
- AI agents must not push, create or mutate a remote PR, merge remotely, release,
  or change repository rules without explicit Owner authorization for that
  external action. Local commits and an explicitly requested local merge do not
  imply permission to push.
