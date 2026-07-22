# Locus Docs Index

This folder separates **living docs** (current truth you should trust and keep
fresh) from **historical snapshots** and **reference-only idea banks**. Before
trusting any doc as "current state," check which bucket it is in.

> Rule of thumb: runtime/capability **truth** lives in code + OpenSpec
> (`src/shared/agent-runtime-capabilities.ts`, `openspec/specs/**`), not in a
> planning doc. Docs here describe contracts, positioning, status, and ideas —
> they do not override the manifest or specs.

## Live — contracts & canonical owners (keep current)

| Doc | Role |
| --- | --- |
| [OWNERSHIP_MAP.md](OWNERSHIP_MAP.md) | Canonical owner per cross-cutting behavior. Check before changing shared runtime/capability/event/message logic — do not add a second implementation. |
| [../PROJECT-MAP.md](../PROJECT-MAP.md) | Live security/architecture audit ledger (repo root). Remediation items and their verified status live here, not in planning docs. |
| [DESIGN.md](DESIGN.md) | Locus UI design contract (v0). New UI must stay consistent unless this file is updated. |
| [error-semantics.md](error-semantics.md) | Target product-facing error vocabulary for runtime/provider/MCP/guard/job failures. |

## Live — status & architecture (current, descriptive)

| Doc | Role |
| --- | --- |
| [run-event-trace-inventory.md](run-event-trace-inventory.md) | What Locus already has for runtime events / trace display. Status, not a rewrite plan. |
| [locus-system-design.md](locus-system-design.md) | System design grounded in the actual code (architecture overview). |

## Live — positioning & scope lock

| Doc | Role |
| --- | --- |
| [locus-workbench-focus.md](locus-workbench-focus.md) ([zh](locus-workbench-focus.zh-CN.md)) | **Scope lock.** What Locus is and is *not*. This is the lens that de-scopes the `ideas/` plans. |
| [locus-local-agent-platform.md](locus-local-agent-platform.md) ([zh](locus-local-agent-platform.zh-CN.md)) | Workbench positioning and integration boundaries. (Overlaps with workbench-focus; candidate to merge.) |

## Live — external contract

| Doc | Role |
| --- | --- |
| [local-job-api-v1-consumer-guide.md](local-job-api-v1-consumer-guide.md) ([zh](local-job-api-v1-consumer-guide.zh-CN.md)) | How downstream local tools submit jobs to Locus (v1). |
| [local-job-api-v1.schema.json](local-job-api-v1.schema.json) | Machine-readable v1 request/response schema. |

## `archive/` — superseded / historical snapshots

These did their job; their output now lives in the capability manifest, specs,
or archived OpenSpec changes. **Do not treat as current state.**

- [archive/claude-code-runtime-capability-audit-plan.md](archive/claude-code-runtime-capability-audit-plan.md) — audit method → produced the live capability model.
- [archive/codex-runtime-capability-audit-plan.md](archive/codex-runtime-capability-audit-plan.md) — superseded by `codex-runtime-parity` (archived).
- [archive/runtime-cli-capability-inventory.md](archive/runtime-cli-capability-inventory.md) — 2026-06-05 snapshot; discipline absorbed into specs; proposed capability-center slice deferred to the multi-runtime expansion.
- [archive/locus-runtime-workbench-completion-roadmap.zh-CN.md](archive/locus-runtime-workbench-completion-roadmap.zh-CN.md) — roadmap whose main line (Codex app-server migration) is completed and archived.

## `tickets/` — tracked issue tickets

Individual issue write-ups (TICKET-001…) with their own
[tickets/README.md](tickets/README.md) index. Check a ticket's own status line;
resolved tickets stay for the record.

## `ideas/` — mixed: active working docs + reference-only idea banks

Two different kinds of documents share this folder — check the status line at
the top of each file:

**Active / authoritative** (trust these):

- [ideas/canonical-vocabulary.md](ideas/canonical-vocabulary.md) — **RATIFIED 2026-06-18**; the authoritative entity-naming source (Project · Workspace · Chat · Quick chat · Agent · Run).
- [ideas/settings-per-tab-audit.md](ideas/settings-per-tab-audit.md) — working audit of the Settings surface.
- [ideas/settings-reconciliation-ledger.md](ideas/settings-reconciliation-ledger.md) — active Settings reconciliation ledger.

**Reference-only "learn-from-X" idea banks** (NOT roadmap; scope-locked out as
products by [locus-workbench-focus.md](locus-workbench-focus.md) — mine
components/ideas from them, do not treat as planned work):

- [ideas/ccx-provider-gateway-plan.md](ideas/ccx-provider-gateway-plan.md) — learn-from-`ccx` provider gateway ideas.
- [ideas/runtime-environment-center-plan.md](ideas/runtime-environment-center-plan.md) — learn-from-`cc-switch` runtime environment center ideas.
- [ideas/locus-plugin-tweak-runtime-plan.md](ideas/locus-plugin-tweak-runtime-plan.md) — learn-from-`Codex++`; plugin system shipped, tweak/patch ideas parked.
