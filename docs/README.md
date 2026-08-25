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

## Transitional — superseded positioning (do not use as current direction)

| Doc | Role |
| --- | --- |
| [locus-workbench-focus.md](locus-workbench-focus.md) ([zh](locus-workbench-focus.zh-CN.md)) | **Superseded for product direction 2026-08-25.** Historical execution-slice record; do not use as the current scope lock. |
| [locus-local-agent-platform.md](locus-local-agent-platform.md) ([zh](locus-local-agent-platform.zh-CN.md)) | Implementation snapshot with current Local Job API links; its old product direction is explicitly superseded by the ratified Harness strategy. |

## Live — external contract

| Doc | Role |
| --- | --- |
| [local-job-api-v1-consumer-guide.md](local-job-api-v1-consumer-guide.md) ([zh](local-job-api-v1-consumer-guide.zh-CN.md)) | How downstream local tools submit jobs to Locus (v1). |
| [local-job-api-v1.schema.json](local-job-api-v1.schema.json) | Machine-readable v1 request/response schema. |
| [model-catalog.json](model-catalog.json) | ⚠️ **Not documentation — a live runtime manifest.** Fetched at run time from this repo's raw GitHub URL on a 24h TTL by `src/main/lib/model-catalog/fetcher.ts`. Note it is currently unreachable in default builds (local-only mode defaults on and the fetcher blocks on it). |

## Live — development process templates

| Doc | Role |
| --- | --- |
| [consumer-impact-template.zh-CN.md](consumer-impact-template.zh-CN.md) | **RATIFIED 2026-08-25.** Required pre-implementation decision record for changes to public/versioned consumer contracts; records exact impact, options, Owner decision, facade deletion conditions, and verification. |

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

## `ideas/` — decision-track working docs

Check the status line at the top of each file before trusting it.

> The three reference-only "learn-from-X" idea banks (ccx / cc-switch / Codex++,
> 1,931 lines) were **deleted 2026-08-12** during roadmap triage. Everything in them
> was already shipped-and-ratified, explicitly rejected in spec, or parked product
> surface. The one unharvested idea was extracted first as
> [tickets/TICKET-107](tickets/TICKET-107-external-config-write-safety.md).

**Active / authoritative** (trust these):

- [ideas/canonical-vocabulary.md](ideas/canonical-vocabulary.md) — **RATIFIED 2026-06-18; ENGINE ADDENDUM 2026-08-25**; the authoritative entity-naming source (Project · Workspace · Chat · Quick chat · Engine · Agent · Run), including the UI `Engine` → API `runtimeId` mapping.
- [ideas/locus-product-direction-harness-strategy.zh-CN.md](ideas/locus-product-direction-harness-strategy.zh-CN.md) — **RATIFIED 2026-08-25**; canonical product direction for Locus as an embeddable cross-Harness runtime/session interoperability layer, including consumer boundaries, Runtime delivery policy, roadmap, and Owner decisions. This direction does not itself authorize implementation; each architecture slice still requires an approved OpenSpec change.
- [ideas/locus-ai-collaboration-workflow.zh-CN.md](ideas/locus-ai-collaboration-workflow.zh-CN.md) — **RATIFIED 2026-08-25**; canonical AI collaboration gates, Definition of Ready/Done, evidence rules, minimum pre-implementation document set, and the Owner-approved W1–W9 decisions.
- [ideas/locus-interoperability-contract-v1.zh-CN.md](ideas/locus-interoperability-contract-v1.zh-CN.md) — **RATIFIED 2026-08-25; C1–C9 OWNER CONFIRMED**; canonical cross-change interoperability decisions for Conversation, Run, SessionBinding, Interaction, Handoff, API evolution, certified Runtime delivery, consumer-neutral acceptance, and platform support tiers. It records macOS/Windows as Tier-1 stable gates and Linux Electron Desktop as experimental. Ratification is a direction constraint, not implementation authorization.

**Deferred — written, not started** (do not treat as planned work):

- [ideas/cross-engine-delegation.md](ideas/cross-engine-delegation.md) — **DEFERRED 2026-08-12.** Cross-engine delegation (one engine dispatching work to another). Researched and scoped, zero code. Blocked behind the isolation + adjudication line landing first; see its own Status block.
- [ideas/locus-agent-memory-research.zh-CN.md](ideas/locus-agent-memory-research.zh-CN.md) — **DEFERRED RESEARCH; NOT PLANNED / NOT RATIFIED 2026-08-25.** Source-backed Handoff query is already covered by C6 A+; general Agent Memory/provider/persona choices are deliberately postponed until the Owner reopens them.

**Completed — kept for the record** (not live work):

- [ideas/settings-per-tab-audit.md](ideas/settings-per-tab-audit.md) — Settings surface audit, self-declared COMPLETE. Its per-tab line counts are stale (tabs have since grown 20–100%).
- [ideas/settings-reconciliation-ledger.md](ideas/settings-reconciliation-ledger.md) — Settings reconciliation ledger, self-declared COMPLETE; findings closed by named archived OpenSpec changes.
