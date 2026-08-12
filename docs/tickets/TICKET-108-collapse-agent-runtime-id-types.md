# TICKET-108 — Collapse the duplicate agent runtime ID types

- **Priority**: Low (contract cleanup)
- **Source**: `remove-experimental-runtimes` task 10.6
- **Implementation**: Codex | **Review**: Claude

## Background

After removing the retired experimental runtimes, both `AgentRuntimeId` and
`AgentRuntimeContractId` resolve to the same union:
`"claude-code" | "codex"`. The two names still encode the old distinction
between every desktop runtime and the smaller contract-supported subset.

Keeping both aliases during the removal change avoids mixing a broad type/API
rename into a deletion-focused diff. It also makes the compatibility boundary
explicit while the removal change is reviewed and archived.

## Required change

Choose one canonical runtime ID type and migrate the duplicate consumers to
it. Preserve the wire values and runtime parsing behavior; this is a type-level
cleanup, not a new runtime or protocol change.

Likely consumers include:

- `src/shared/agent-jobs.ts`
- `src/shared/agent-schedules.ts`
- `src/shared/local-job-api.ts`
- `src/main/lib/headless/`

## Acceptance criteria

- [ ] Only one canonical exported runtime ID union owns
      `"claude-code" | "codex"`.
- [ ] Headless, Local Job API, schedule, desktop, and capability-manifest
      surfaces retain the same accepted values and rejection behavior.
- [ ] No casts are added merely to bridge the old duplicate aliases.
- [ ] `bun run check` passes.

## Out of scope

- Adding a third runtime or restoring an experimental-runtime branch.
- Renaming transports, providers, or public wire values.
- Changing Local Job API, ACP, or schedule behavior.
