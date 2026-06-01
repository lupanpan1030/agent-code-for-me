## 1. Proposal and Scope
- [x] 1.1 Create the OpenSpec proposal, design, and capability delta for Codex runtime parity.
- [x] 1.2 Validate the OpenSpec change strictly.
- [x] 1.3 Get approval before implementing product code.
- [x] 1.4 Confirm dependency boundaries with `add-headless-agent-jobs` so headless jobs can complete with honest degraded/unsupported Codex capabilities.

## 2. Core Safety Parity
- [ ] 2.1 Implement Codex hard tool guard through ACP pre-tool interception or a safe Locus-owned tool proxy/wrapper seam.
- [ ] 2.2 Implement Codex plan mode enforcement so blocked writes and blocked shell operations are denied before execution.
- [ ] 2.3 Implement Codex scope expansion parity so workspace/project boundary crossings stop for approval before execution.
- [ ] 2.4 Implement Codex AskUserQuestion parity with normalized pending, result, timeout, and denial events.
- [ ] 2.5 Implement Codex rollback/fork parity using durable session references compatible with the shared runner contract.
- [ ] 2.6 Implement Codex MCP auth parity so needs-auth MCP servers are surfaced before starting affected runs.
- [ ] 2.7 Implement normalized Codex runtime availability/status states for bundled CLI, ACP runtime, login, provider profile, MCP auth/configuration, and local-only blockers.
- [ ] 2.8 Migrate or delegate the existing desktop Codex chat route and ACP transport to the shared Codex runtime enforcement/status path.
- [ ] 2.9 Add tests proving Codex core safety capabilities marked `supported` execute through enforcement paths and cannot be bypassed by the desktop chat path.
- [ ] 2.10 Run desktop smoke covering guarded tool denial, plan mode denial, scope expansion, AskUserQuestion, rollback/fork, MCP needs-auth handling, and separated runtime availability states.

## 3. Runtime Feature Parity
- [ ] 3.1 Implement Codex MCP configuration parity for app/global and project-scoped MCP add, remove, list, and status behavior.
- [ ] 3.2 Implement Codex provider profile and usage metadata parity with the same non-secret renderer summaries as Claude.
- [ ] 3.3 Implement Codex attachment parity for supported image, long-text, and file attachment paths.
- [ ] 3.4 Implement runtime plugin parity so Codex plugin entries are executable and enableable through a runtime-native or Locus-owned shared plugin layer.
- [ ] 3.5 Implement runtime command parity so commands presented as executable in chat or jobs can run for Claude and Codex.
- [ ] 3.6 Implement runtime workflow parity by moving dynamic workflows behind a shared runtime contract, adding a Codex-equivalent workflow adapter, or explicitly rescoping workflows out of runtime-neutral parity.
- [ ] 3.7 Implement App Agent/skill parity so runtime-neutral App Agents apply consistently and Codex-native agents/skills are discoverable when they are exposed as product-equivalent to Claude subagents.
- [ ] 3.8 Add focused tests proving feature parity capability declarations match real behavior.
- [ ] 3.9 Run desktop feature parity smoke covering MCP scope, plugin enablement/execution, command execution, workflow behavior or rescope, App Agent/skill selection, usage metadata, provider profile display, and attachments.

## 4. Verification
- [ ] 4.1 Run `openspec validate upgrade-codex-runtime-parity --strict --no-interactive`.
- [ ] 4.2 Run focused Bun tests for Codex core safety parity and feature parity.
- [ ] 4.3 Run focused tests proving unsupported/degraded states are not presented as supported.
- [ ] 4.4 Run focused tests proving desktop Codex chat and headless/CLI callers share parity-owned enforcement and runtime status behavior.
- [ ] 4.5 Run `bun run ts:check`.
- [ ] 4.6 Run `bun run build`.
- [ ] 4.7 Record real desktop smoke evidence for Codex parity behavior.
