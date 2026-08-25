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

### Persistence stage (task 3.3)

- History is still read from the database after runtime readiness and before image/provider
  work. The provider result still precedes the unguarded initial user-message write, and
  resume selection still consumes the original `existingMessages` snapshot.
- Exact JSON-shape coverage locks distinct `createdAt` / `updatedAt` calls, metadata
  precedence, normalization, prompt + long-text + image signature comparison, and the
  assistant guard that permits no active stream or the same authoritative run.
- The baseline image-signature asymmetry (an identical image-bearing retry is currently
  non-duplicate) is preserved rather than repaired in this behavior-neutral refactor; it
  will be recorded as a follow-up, not implemented here.
- `rg -n "db\\.update\\(|subChats" src/main/lib/trpc/routers/codex.ts`: no matches.
- `bun test --isolate tests/codex-desktop-run-persistence.test.ts
  tests/runtime-stream-event-mapper.test.ts tests/desktop-runtime-adapter-factory.test.ts
  tests/rich-chat-attachments-pipeline.test.ts tests/long-text-send-pipeline.test.ts
  tests/agent-runtime-preflight.test.ts tests/provider-routing-ux.test.ts`: **55 passed /
  0 failed / 343 expectations across 7 files**.
- A read-only behavior review against `a974dd47` found no P0/P1/P2 regression. Its three
  P3 coverage gaps (image-bearing signature semantics, no-stream DB/timestamp evidence,
  and route ordering/resume snapshot evidence) were all closed before this stage commit.
- `bun run lint`, `bun run ts:check`, and `git diff --check`: passed.
- `bun run check`: architecture and retired-runtime guards passed; TypeScript passed;
  **1,669 tests passed / 0 failed across 285 files**.

### Finalization stage (task 3.4)

- One state owner now holds the database, job id, and three lifecycle flags. The router
  sets the database immediately after `getDatabase()` and retains its tRPC envelope,
  finish gate, renderer emission, and fallback error/finish behavior.
- Job cancellation remains run-id fenced. Finalization order is provider revoke → job
  completion → approval clear → same-run stream delete → provider-secret release;
  unsubscribe remains inactive → cancel request (including eager fallback DB evaluation)
  → abort → revoke → same-run `cancelRequested`.
- `bun test --isolate tests/codex-desktop-run-finalize.test.ts
  tests/agent-runtime-preflight.test.ts tests/runtime-stream-event-mapper.test.ts
  tests/codex-api-key-validation.test.ts tests/agent-runtime-permission-policy.test.ts
  tests/desktop-runtime-adapter-factory.test.ts tests/provider-credential-storage.test.ts
  tests/provider-routing-ux.test.ts`: **70 passed / 0 failed / 442 expectations across
  8 files**.
- A read-only behavior review against `a974dd47` found no P0/P1/P2 regression. All its P3
  coverage gaps were closed: registration passthrough + cancel flag, stale/missing stream
  cleanup fences, aborted/natural-finish flags, unsubscribe ordering/arguments, and state
  DB precedence.
- `bun run lint`, `bun run ts:check`, and `git diff --check`: passed.
- `bun run check`: architecture and retired-runtime guards passed; TypeScript passed;
  **1,672 tests passed / 0 failed across 285 files**.

### App-server adapter runner (tasks 4.1–4.3)

- Adapter selection, plugin resolution, all three `LOCUS_CODEX_APP_SERVER_*` switches,
  the smoke-only override object, adapter construction, and factory dispatch now live in
  `lib/codex/app-server-adapter-runner.ts`. The finish gate and result/error suppression
  remain in the router.
- `rg -n "createCodexAppServerAdapter|LOCUS_CODEX_APP_SERVER" src/main/lib/trpc`:
  no matches. Source guards now require the route to call the runner and the runner to
  construct and resolve through `DesktopRuntimeAdapterFactory` before `run(request)`.
- `bun test --isolate tests/codex-app-server-adapter-runner.test.ts
  tests/desktop-runtime-adapter-factory.test.ts tests/agent-runtime-preflight.test.ts
  tests/codex-api-key-validation.test.ts tests/provider-credential-storage.test.ts
  tests/agent-runtime-permission-policy.test.ts tests/runtime-stream-event-mapper.test.ts
  tests/provider-routing-ux.test.ts`: **66 passed / 0 failed / 437 expectations across
  8 files**.
- The complete router source-assertion inventory plus the runner suite passed: **107
  passed / 0 failed / 716 expectations across 16 files**.
- A read-only behavior review found no P0/P1/P2 regression. Its P3 passthrough gap was
  closed by pinning selection-env identity and plugin config, images, guarded contract,
  emit, and approval callback identity.
- `bun run lint`, `bun run ts:check`, and `git diff --check`: passed.
- `bun run check`: architecture and retired-runtime guards passed; TypeScript passed;
  **1,673 tests passed / 0 failed across 285 files**.

### MCP input-schema owner (tasks 5.1–5.2)

- The shared string, args, env, and URL Zod wrappers and their error-message helper now
  live beside the normalizers in `runtime-mcp-config/input-validation.ts`; both routers
  import those schemas and no longer carry local copies.
- `tests/mcp-config-boundaries.test.ts` now pins the shared owner and rejects router-local
  schema/helper definitions; direct `safeParse` coverage locks null-byte, environment-name,
  environment-value, URL-protocol, and valid HTTPS behavior.
- A read-only behavior review found no P0/P1/P2 regression. Its P3 request for executable
  schema parity coverage and complete negative guards was closed before this stage commit.
- `bun test --isolate tests/mcp-config-boundaries.test.ts
  tests/runtime-mcp-config-service.test.ts`: **21 passed / 0 failed / 159 expectations
  across 2 files**.
- `bun run lint`, `bun run ts:check`, and `git diff --check`: passed.

### Ownership, capability evidence, and Yellow ledger (tasks 6.1–6.3)

- `docs/OWNERSHIP_MAP.md` now names the shipped stream, approval, preflight, provider,
  persistence, finalization, and adapter-runner modules as the Codex desktop canonical
  owners. The Claude temporary-owner clause is unchanged.
- Capability evidence now points provider binding at
  `desktop-run-provider-binding.ts` and assistant usage-metadata aggregation/persistence at
  `desktop-run-persistence.ts`, while retaining the router where its envelope/redaction
  behavior remains evidence.
- W7 Yellow items are documentation only: tickets 109–111 record the approved login,
  Claude-settings, and Claude-router residuals; ticket 112 records the preserved
  image-signature asymmetry discovered during persistence extraction; ticket 113 records
  the generic router module-state guard candidate. None is implemented or implicitly
  authorized by this change.
- A read-only governance review found no P0/P1. Its P2 stale/non-moved usage-evidence
  reference and both P3 ledger completeness findings were corrected before commit.

### Final architecture boundary (task 7.1)

- `tests/codex-desktop-service-boundary.test.ts` rejects every approved old-path marker in
  the router and both app-shell reverse imports. Positive assertions also require the
  router to orchestrate the shipped stage owners so deleting an old path cannot be
  satisfied by silently dropping the behavior.
- The complete task 1.2 source-assertion inventory, adapter-runner suite, and new boundary
  suite passed: `bun test --isolate` over the 17 named files produced **117 passed / 0
  failed / 804 expectations**. No assertion still pins moved behavior to the router.

## W7 scope ledger

- Green work is implemented only as named in the approved proposal.
- Yellow follow-ups: recorded in tickets 109–113; no Yellow item is implemented here.
- Red changes: none observed or performed.

## Exact-source verdict

- Source SHA: pending.
- `bun run check:full` exact-SHA receipt: pending.
- Codex verdict: pending.
- Claude Code independent verdict: pending.
- Owner acceptance: pending.
- Local merge/archive: pending.
