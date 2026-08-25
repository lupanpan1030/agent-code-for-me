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

# Claude Code Repository Guide

Locus is a local-first Electron workbench and an embeddable interoperability
layer over mature coding Harnesses. It integrates Claude Code and Codex; it does
not own a new general Agent loop.

Do not duplicate architecture, schema, Runtime-version, or release facts here.
Read the canonical sources before reviewing or planning:

1. `AGENTS.md` — repository-wide architecture, verification, and Git rules.
2. `openspec/AGENTS.md` — proposal and spec workflow.
3. `docs/OWNERSHIP_MAP.md` — canonical code owners and forbidden duplicate paths.
4. `docs/ideas/locus-product-direction-harness-strategy.zh-CN.md` — ratified product direction.
5. `docs/ideas/locus-interoperability-contract-v1.zh-CN.md` — ratified C1–C9 invariants.
6. `docs/ideas/locus-ai-collaboration-workflow.zh-CN.md` — ratified W1–W9 delivery gates.
7. `openspec/STATUS.md` and the relevant approved change — current execution state.

Useful commands:

```bash
bun run dev
bun run check:full
bun run spec:validate
bun run build
```

## Independent-review role

The default collaboration topology is Codex implementation followed by a fresh
Claude Code review. Review the exact source SHA named in the evidence; do not
reuse the implementation context. Report actionable P0–P3 findings with file
and line references. Verify canonical ownership, old-path deletion, public
consumer impact, credential/runtime trust boundaries, migrations, and required
smoke evidence. Do not edit during the formal review.

Approval means only a technical verdict for that SHA. It does not replace Owner
product acceptance and does not authorize push, remote PR mutation, remote
merge, release, or repository-rules changes.
