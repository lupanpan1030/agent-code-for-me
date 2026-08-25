# Verification: Extract the Codex desktop chat service out of the tRPC router

## Scope and isolation

- Base: `main@a974dd47667b790a5a7aacdaa194fa453c29a20a`
- Branch: `codex/refactor-codex-desktop-service-extraction`
- Worktree: `/home/chen/projects/locus-refactor-codex-desktop-service-extraction`
- Scope: this approved change only; local `main` remains fixed at the base until the
  exact-source dual-verdict gate is complete.
- Remote operations: not authorized / not performed.

## Pre-change baseline

- The first `bun run check` attempt on the unchanged base stopped before lint because the
  new worktree did not yet have `node_modules` (`Biome executable not found`).
- `bun install --frozen-lockfile` populated the worktree dependencies. Its Electron native
  postinstall smoke could not launch Electron on this Linux host because `libnspr4.so` is
  absent; this is an environment limitation, not a source failure. Static checks and Bun
  tests remain runnable.
- Re-running `bun run check` on the still-clean base passed: architecture guard passed,
  retired-runtime residue check passed (1,556 files scanned; 10 allowlisted), TypeScript
  passed, and **1,642 tests passed / 0 failed across 278 files**.

## Source-text assertion inventory (task 1.2)

`rg` found 15 test files containing the router path. Fourteen read and assert router source;
`tests/codex-tool-permission.test.ts` uses the path only as an allowed-scope fixture. The
assertions were classified before extraction as follows:

- preflight: `agent-runtime-preflight`, `agent-guard-runtime-pipeline`;
- provider binding: `agent-runtime-preflight`, `provider-credential-storage`,
  `provider-routing-ux`, `codex-api-key-validation`;
- persistence: `runtime-stream-event-mapper`, `desktop-runtime-adapter-factory`,
  `rich-chat-attachments-pipeline`, `long-text-send-pipeline`;
- adapter construction: `desktop-runtime-adapter-factory`,
  `agent-runtime-permission-policy`, `provider-credential-storage`,
  `codex-api-key-validation`;
- retained router envelope/procedures: `runtime-stream-event-mapper`,
  `agent-guard-runtime-pipeline`, `agent-guard`, `agent-runtime-permission-policy`,
  `rich-chat-attachments-pipeline`, `long-text-send-pipeline`,
  `mcp-config-boundaries`, `codex-prompt`, `codex-api-key-validation`,
  `codex-cli-runner`.

The baseline suites did not pin the two module-level state Maps or the duplicated MCP zod
wrappers. This change therefore adds owner unit tests and final negative/source-boundary
assertions instead of pretending those gaps were existing coverage.

## Anchor revalidation (task 1.3)

Before moving code, symbol searches confirmed the approved anchors: the two module-level
Maps and helpers; `buildCodexAppServerAssistantMessage`; both `db.update(subChats)` writes;
the direct `createCodexAppServerAdapter` call and three `LOCUS_CODEX_APP_SERVER_*` reads;
and the reverse imports from `src/main/index.ts` and `src/main/windows/main.ts`.

## Incremental receipts

### State owners (tasks 2.1–2.5)

- `bun test --isolate tests/codex-active-streams.test.ts tests/codex-tool-approvals.test.ts`:
  5 passed / 0 failed.
- `bun run ts:check`: passed.
- `bun run check`: architecture and retired-runtime guards passed; TypeScript passed;
  **1,647 tests passed / 0 failed across 280 files**.
- `rg -n "trpc/routers/codex" src/main`: no reverse path imports remain after the
  state/app-shell rewire; the tRPC registry keeps its sibling `./codex` router import.

### Preflight stage (task 3.1)

- The stage receives injected emit/complete callbacks; the tRPC observable remains in the
  router.
- Unit coverage locks the existing sequence: supplied status/capability chunks, then
  `error` or `auth-error`, then `finish`, then completion. Existing error and hint text is
  unchanged.
- `bun test --isolate tests/codex-desktop-run-preflight.test.ts
  tests/agent-runtime-preflight.test.ts tests/agent-guard-runtime-pipeline.test.ts`:
  19 passed / 0 failed / 170 expectations.
- `bun run lint`, `bun run ts:check`, and `git diff --check`: passed.
- `bun run check`: passed while the next persistence stage existed only as uncommitted,
  separately tested scaffolding; aggregate result was 1,656 passed / 0 failed. The final
  exact-SHA `check:full` remains authoritative.

### Provider-binding stage (task 3.2)

- The stage preserves provider-profile > app-managed API key > ChatGPT login selection,
  places the upstream credential in redaction hints before awaiting gateway issuance, and
  keeps the app-managed key outside renderer-chunk secret hints as before.
- Its shared `revoke()` is idempotent across unsubscribe and `finally`; coverage also
  proves a thrown revoke can be retried instead of being incorrectly marked complete.
- `bun test --isolate tests/codex-desktop-run-provider-binding.test.ts
  tests/provider-credential-storage.test.ts tests/provider-routing-ux.test.ts
  tests/codex-api-key-validation.test.ts tests/agent-runtime-preflight.test.ts
  tests/runtime-stream-event-mapper.test.ts`: **54 passed / 0 failed / 290
  expectations across 6 files**.
- `bun run lint`, `bun run ts:check`, and `git diff --check`: passed.

## W7 scope ledger

- Green work is implemented only as named in the approved proposal.
- Yellow follow-ups: pending task 6.3 ledger entry; no Yellow item is implemented here.
- Red changes: none observed or performed.

## Exact-source verdict

- Source SHA: pending.
- `bun run check:full` exact-SHA receipt: pending.
- Codex verdict: pending.
- Claude Code independent verdict: pending.
- Owner acceptance: pending.
- Local merge/archive: pending.
