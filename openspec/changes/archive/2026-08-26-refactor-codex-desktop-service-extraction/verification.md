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

- Frozen source SHA: `6bf928bf00051ab1e9513b67162280677134d972`.
- Verified at: `2026-08-26 06:40:00 NZST (+1200)`.
- Before and after the exact-source gate, the implementation worktree was clean and `HEAD`
  still resolved to the frozen SHA. Local `main` remained fixed at
  `a974dd47667b790a5a7aacdaa194fa453c29a20a`.
- `bun run check:full` exact-SHA receipt: **exit 0**.
  - changed-line lint: passed;
  - architecture guard: passed;
  - retired-runtime residue: passed (**1,577 files scanned / 10 allowlisted**);
  - TypeScript: passed;
  - tests: **1,679 passed / 0 failed / 8,115 expectations across 286 files**;
  - OpenSpec all/strict: **56 passed / 0 failed**;
  - Electron/Vite production build: passed;
  - patch whitespace check: passed.
- No-spec-delta receipt: `.openspec.yaml` contains `skip_specs: true`, and the exact-source
  `openspec validate --all --strict --no-interactive` run included this change and passed.
- Persistence parity receipt: a deterministic in-memory harness replayed the inline
  `a974dd47` baseline and the extracted owner with the same prior history, IDs, timestamps,
  image, long-text attachment, metadata chunks, and finish chunks. The raw
  `subChats.messages` strings were byte-identical: **3 messages / 969 bytes / SHA-256
  `26202482c6a6e40a7e2f054ffed55174d853cccafdde785f75be4d87f4793587`**; final
  `updatedAt` was identical (`2026-08-26T02:03:05.000Z`). Shared parts construction,
  normalizer, and DB schema had no diff from the base. The focused persistence suite also
  passed: **5 / 0 / 24 expectations**.
- Desktop smoke limitation: `bun run dev` was attempted on the frozen source and exited 1
  before app startup. Electron could not load `libnspr4.so`; `ldd` additionally reports
  missing `libnss3.so`, `libnssutil3.so`, `libsmime3.so`, and `libasound.so.2`. The native
  module rebuild completed, then the same loader failure recurred for `better-sqlite3` and
  `node-pty`. No end-to-end GUI scenario is claimed. This environment limitation does not
  alter the exact-source automated receipt. Task 8.2 remained visibly unchecked through
  exact-source review; the later Owner gate accepted the risk and registered TICKET-114
  instead of claiming the GUI scenarios passed.
- Codex verdict: **IMPLEMENTATION_VERIFIED** for the frozen source SHA, with the explicit
  task 8.2 environment limitation above. No P0/P1/P2 implementation finding remains; all
  reviewer P3 coverage findings were closed before the source freeze.
- Claude Code independent verdict: **REVIEW_APPROVED** for the frozen source SHA; the two
  fresh-context review receipts are recorded below.
- Owner acceptance: **ACCEPTED** on 2026-08-26 after the local post-merge gate, including
  explicit acceptance of the disclosed GUI-smoke gap as a recorded residual risk.
- Local merge: completed by fast-forward at `13e3777a0a39724f171eb2e563dae4774d0b0926`;
  the post-merge gate passed. Local archive remains pending at this checkpoint.

## Local integration, post-merge gate, and Owner acceptance (2026-08-26)

- Reviewed implementation source: `6bf928bf00051ab1e9513b67162280677134d972`.
- Evidence-only commits: Codex verification
  `240aed1ba09a368a3f4e9f5e0ce160b261d95789` and Claude review
  `13e3777a0a39724f171eb2e563dae4774d0b0926`.
- Local integration: `main` was fast-forwarded from
  `a974dd47667b790a5a7aacdaa194fa453c29a20a` to
  `13e3777a0a39724f171eb2e563dae4774d0b0926`, with no conflict and no merge commit.
  The range from the reviewed source to the local integration endpoint changes only this
  change's `tasks.md` and `verification.md`; it contains no product-code change.
- Post-merge gate: `bun run check:full` passed at the unchanged local-main SHA
  `13e3777a0a39724f171eb2e563dae4774d0b0926`: changed-line lint, architecture guard,
  retired-runtime residue guard (**1,577 files scanned / 10 allowlisted**), TypeScript,
  production Electron/Vite build, and patch whitespace check all passed; tests reported
  **1,679 passed / 0 failed / 8,115 expectations across 286 files**; OpenSpec all/strict
  validation reported **56 passed / 0 failed**. Only the already-recorded non-failing
  Vite/Browserslist warnings remained.
- Owner decision received verbatim on 2026-08-26:
  **`ACCEPTED refactor-codex-desktop-service-extraction`**.
- The Owner explicitly accepted the missing Electron GUI smoke as a disclosed residual
  risk. No GUI scenario is retroactively claimed as run or passed. The required rerun on
  a GUI-capable machine is registered as
  `docs/tickets/TICKET-114-codex-desktop-extraction-gui-smoke.md`.
- Final change verdict: **`IMPLEMENTATION_VERIFIED` + `REVIEW_APPROVED` + `ACCEPTED`**,
  all referring to the unchanged product source at the frozen SHA. The review's
  non-blocking observations remain recorded below for later triage.
- Archive state at this checkpoint: pending local archive and post-archive strict
  validation.
- Push, remote PR mutation, remote merge, release, and every other remote operation:
  **not authorized and not performed**.

## Archive receipt (2026-08-26)

- `bun x openspec archive refactor-codex-desktop-service-extraction --skip-specs --yes`
  exited 0 and moved this change to
  `openspec/changes/archive/2026-08-26-refactor-codex-desktop-service-extraction/`.
- The archive intentionally skipped spec updates because this accepted change is an internal,
  behavior-preserving ownership refactor with no spec delta. The archived `.openspec.yaml`
  continues to declare `skip_specs: true`.
- Task 9.5 was checked only after the archive command completed. The command's pre-move warning
  about one incomplete task referred to that not-yet-executed archive step, not to missing
  implementation or acceptance work.
- `bun x openspec validate --all --strict --no-interactive` passed **55/55** after the
  archive. `bun x openspec validate --archived --strict --no-interactive` marks this entry
  `✓`; its archive-wide aggregate is **103 passed / 6 failed across 109 entries** because
  six older archived entries contain pre-existing incomplete task checkboxes. None of the
  failures is this change.
- Final archive state: **Owner `ACCEPTED`; locally archived**. The GUI-capable desktop-smoke
  follow-up remains tracked in `docs/tickets/TICKET-114-codex-desktop-extraction-gui-smoke.md`.
- No push, remote PR mutation, remote merge, release, or other remote operation was performed.

## Independent review — fresh-context Claude Code (2026-08-26)

- Source SHA under review: `6bf928bf00051ab1e9513b67162280677134d972` (worktree at review time: `240aed1b`, docs-only evidence commit on top — verified by the reviewers themselves via `git diff --stat`).
- Review mode: two read-only fresh-context reviewers (correctness/compliance + security/trust-boundary) dispatched by the Claude Code coordination session; implementation context not reused; no files edited during review; worktree confirmed clean after all spot-run tests.
- Combined verdict: **`REVIEW_APPROVED`** for `6bf928bf00051ab1e9513b67162280677134d972` — zero P0/P1 findings across both lenses. One P2 (missing Electron GUI smoke on this host, honestly disclosed in this file) is explicitly left to Owner risk acceptance at the acceptance gate; three P3 notes recorded for follow-up triage.
- This is a technical verdict for this exact SHA only; it does not constitute Owner product acceptance and does not authorize push, remote PR mutation, remote merge, release, or repository-rules changes. Any subsequent code change to the source invalidates it.

### Correctness / compliance review

- Verdict: **`REVIEW_APPROVED`** for `6bf928bf00051ab1e9513b67162280677134d972`.
- Findings (non-blocking):
  - [P2] `src/main/windows/main.ts` — No Electron GUI smoke on this SHA; app-shell quit/abort wiring only unit-tested at the module boundary. verification.md honestly discloses that bun run dev could not launch on this Linux host (missing libnspr4.so, then missing libnss3/libnssutil3/libsmime3/libasound.so.2 blocking better-sqlite3/node-pty native rebuilds too). grep -rln "hasActiveCodexStreams|abortAllCodexStreams" tests/ (run during this review) shows only tests/codex-active-streams.test.ts exercises those functions in isolation — no test exercises src/main/windows/main.ts's quit-confirm-abort call path end-to-end, so the specific rewire target of item (i) (main.ts/index.ts importing from the new lib/codex/active-streams.ts instead of the router) has never been run inside a live Electron process on this SHA. This is a genuine coverage gap for a real user-facing path (quit while a Codex stream is active), not fully closed by unit tests. It is not a regression introduced by this change (pre-existing app-shell code was equally untested this way) and is compensated by: full check:full green (1,679/0/8,115 across 286 files, reproduced independently below), byte-identical subChats.messages persistence-parity receipt, and substantive new unit coverage for every extracted module. Given the disclosure is honest, the gap pre-dates this change's test-coverage boundary, and the compensating evidence is strong, this does not block a technical verdict for the source SHA — but it is a real open item for the Owner to accept/require a GUI-capable smoke pass before merge to main.
  - [P3] `src/main/lib/codex/app-server-adapter-runner.ts` — appManagedApiKey suppression in the adapter runner is now inferred from providerGatewayToken nullness rather than from the provider-profile object itself. Old router: `appManagedApiKey: codexProviderProfile ? null : appManagedCodexApiKey` (truthiness of the whole profile object). New runner: `appManagedApiKey: input.providerGatewayToken !== null ? null : input.appManagedApiKey` (nullness of the token alone), and the router now passes `providerGatewayToken: codexProviderProfile?.token ?? null`. These are behaviorally equivalent today only because desktop-run-provider-binding.ts always sets `providerProfile.token = gateway.token` (a string) whenever `providerProfile` is set, so the two predicates can never diverge in practice given the current provider-binding contract. It's a correctness-by-coincidence coupling across two module boundaries rather than an structurally guaranteed invariant (e.g. if `getProviderGatewayEndpoint` ever legitimately returned a profile with `token` unset/empty for a non-secret-bearing gateway mode, the two predicates would silently diverge). No test currently pins this specific equivalence directly (the existing suites test outcomes, not the underlying identity). Worth a one-line comment or a shared boolean field (e.g. `providerBindingResult.usesGatewayToken`) in a follow-up, not a merge blocker.

#### Reviewer summary

Fresh-context, source-SHA-only review of 6bf928bf00051ab1e9513b67162280677134d972 (refactor-codex-desktop-service-extraction), performed entirely inside /home/chen/projects/locus-refactor-codex-desktop-service-extraction. Confirmed the worktree's HEAD (240aed1b) differs from the frozen SHA by a docs-only tasks.md/verification.md commit (`git diff 6bf928bf00051ab1e9513b67162280677134d972 240aed1b --stat` → 2 files, tasks.md/verification.md only) before relying on it. Read-only throughout; `git status --porcelain` confirmed clean before and after every command I ran, including a full `bun run test` pass.

Proposal-item compliance — all five items verified directly against the diff, not just prose:
1. active-streams.ts / tool-approvals.ts created verbatim-matching the pre-change router's Map/helper logic (diffed old codex.ts:207-236 against the new modules line by line — identical semantics). src/main/index.ts and src/main/windows/main.ts rewired off the router (`git diff main..6bf928bf -- src/main/index.ts src/main/windows/main.ts` shows the exact import swap, plus index.ts now points at the real `getAllCodexMcpConfigHandler` owner in runtime-mcp-config/codex.ts instead of the router re-export). `codex-desktop-service-boundary.test.ts` positively asserts `src/main/index.ts` and `src/main/windows/main.ts` no longer contain `trpc/routers/codex`.
2. Run pipeline staged into desktop-run-{preflight,provider-binding,persistence,finalize}.ts. Diffed each new module against the corresponding block of the pre-change router (`git show main:src/main/lib/trpc/routers/codex.ts`) — preflight, provider-binding (three-way selection + gateway token idempotent revoke), and persistence (duplicate-prompt signature check, unguarded initial user-message write, authoritative-run-guarded assistant write, buildCodexAppServerAssistantMessage) are line-for-line equivalent modulo injected DI/testability seams. Both `db.update(subChats)` writes are confirmed gone from the router (`grep -n "db.update(\|subChats" src/main/lib/trpc/routers/codex.ts` → no matches) and now live only in desktop-run-persistence.ts.
3. app-server-adapter-runner.ts dispatches through `DesktopRuntimeAdapterFactory` (`lib/agent-runtime/desktop-runner.ts`), consuming `resolveCodexDesktopAdapterSelection`. Direct `createCodexAppServerAdapter` import/call and `LOCUS_CODEX_APP_SERVER_*` env reads are gone from the router (`grep` confirmed empty). Verified `resolveCodexDesktopAdapterSelection().useAppServer` is a TS literal-`true` pre-existing helper (unrelated to this change, `git log` shows it predates this PR), so `enabled: selection.useAppServer` is not a behavior change from the prior hardcoded `enabled: true`.
4. MCP zod wrappers (`mcpStringInputSchema`, `mcpArgsInputSchema`, `mcpEnvInputSchema`, `mcpUrlInputSchema`, `zodMessage`) moved byte-identically into runtime-mcp-config/input-validation.ts; both routers' local copies deleted and now import the shared owner (diff confirms verbatim move, no logic drift).
5. docs/OWNERSHIP_MAP.md "Codex Desktop Chat Runtime" section rewritten to name the new lib/codex owners as canonical and retire the "temporary owner" clause; the claude.ts "Claude Desktop Chat Runtime" clause is byte-identical/untouched (confirmed by reading both sections post-diff).

Behavior preservation: walked the full pre/post router diff for the `chat` subscription (existing-stream preemption, guard-contract validation, permission-policy resolution, preflight gate, image-attachment gate, provider-binding gate, MCP resolution/needs-auth gate, job registration, finish-gate wiring, error/auth-error classification, and both the `finally` finalize path and the unsubscribe/cancel path) — found the extraction preserves ordering, error classification, and cleanup sequencing exactly (revoke → job-complete → approval-clear → same-run stream-delete → secret-release in finally; markInactive → request-cancel → abort → revoke → same-run cancelRequested-set on unsubscribe), matching verification.md's stage-by-stage claims.

Old-path deletion completeness: `codex-desktop-service-boundary.test.ts` provides both negative assertions (`new Map<`, `db.update(`, `createCodexAppServerAdapter`, `buildCodexAppServerAssistantMessage`, `LOCUS_CODEX_APP_SERVER`, `revokeProviderGatewayToken`, `getProviderGatewayEndpoint` all absent from the router) and positive orchestration assertions (router must call each of the 9 named lib owners), which is a meaningfully strong regression pin — a regression that silently dropped a moved behavior while deleting its old-path marker would fail the positive half. I independently grepped the router for all seven forbidden strings and confirmed zero matches.

Test repointing: of the 15 source-text suites named in the proposal, 10 were modified (agent-guard-runtime-pipeline, agent-runtime-permission-policy, agent-runtime-preflight, codex-api-key-validation, desktop-runtime-adapter-factory, mcp-config-boundaries, provider-credential-storage, provider-routing-ux, rich-chat-attachments-pipeline, runtime-stream-event-mapper) and 5 were correctly left untouched because their router-source assertions target content this change never moved (agent-guard.test.ts, long-text-send-pipeline.test.ts, codex-prompt.test.ts, codex-tool-permission.test.ts, codex-cli-runner.test.ts all assert prompt-assembly/CLI-runner/shell-injection strings unrelated to this extraction) — verified by reading each file's actual assertions, not just trusting the file list.

Verification performed independently in this session (all inside the worktree, read-only, tree confirmed clean via `git status --porcelain` after each run):
- `bun run architecture:check` → "Architecture guard passed."
- `bun run ts:check` → clean, no errors.
- `bun test --isolate` over all 9 new-module test files (active-streams, tool-approvals, desktop-run-preflight, desktop-run-provider-binding, desktop-run-persistence, desktop-run-finalize, app-server-adapter-runner, desktop-service-boundary, mcp-config-boundaries) → 41 pass / 0 fail / 222 expectations.
- `bun test --isolate` over all 15 named source-text suites → 104 pass / 0 fail / 697 expectations.
- Full `bun run test` (the exact `bun test --isolate tests` script check:full uses) → **1,679 pass / 0 fail / 8,115 expectations across 286 files** — exactly matching verification.md's exact-SHA receipt. (Note: an initial unscoped `bun test` without `--isolate` produced 46 false failures from known cross-file module-mock leakage; re-running with `--isolate` as the repo's own script does resolved this, confirming the false failures were a harness artifact, not a real regression.)
- Read codex-desktop-run-finalize.test.ts's test names and confirmed the finalize-ordering, cancel-fencing, and idempotent-revoke claims in verification.md are backed by dedicated tests, not just prose.

Smoke gap assessment (per COMMON instructions): rated P2, not P0/P1. Reasoning: the gap is an honestly disclosed environment limitation (missing libnspr4.so/NSS/audio libs on this Linux host, affecting even native-module rebuilds for better-sqlite3/node-pty), task 8.2 is visibly left unchecked in tasks.md rather than silently claimed, and the compensating evidence is unusually strong for a behavior-preserving refactor: byte-identical subChats.messages persistence-parity receipt (3 messages/969 bytes/matching SHA-256, matching final updatedAt) plus the full 1,679/0/8,115 exact-SHA test receipt I independently reproduced. However, I flag specifically that the app-shell quit/abort wiring (src/main/windows/main.ts's confirm-and-abort path, one of the two reverse-import rewires this change makes) has zero test coverage beyond the isolated active-streams.ts unit tests — that specific integration point has literally never executed on this SHA. This is a real, named residual risk for the Owner to weigh, not a fixable code defect in this review.

No P0 or P1 findings. Verdict is a technical approval of the source SHA only; it does not constitute product acceptance, and does not authorize push/merge/archive.

### Security / trust-boundary review

- Verdict: **`REVIEW_APPROVED`** for `6bf928bf00051ab1e9513b67162280677134d972`.
- Findings (non-blocking):
  - [P3] `src/main/lib/codex/desktop-run-provider-binding.ts` — Redundant revoked-flag reset in provider-binding resolve(). Line 183 (`providerGatewayTokenRevoked = false`) has no equivalent in the original router closure (main:src/main/lib/trpc/routers/codex.ts:825, no reset statement). It is dead code today because `resolve()` is only ever invoked once per stage instance (one instance is created per subscription at codex.ts:415) before `revoke()` can run, so behavior is unchanged. Flagging only because it is new code with no test asserting single-call invariant; if a future caller ever called `resolve()` twice on the same stage instance (e.g. a retry path), this line would silently un-revoke and allow a second gateway-token issuance to be tracked as not-yet-revoked, which is a legitimate state but relies on an implicit single-resolve contract that isn't type-enforced. No exploit path exists in the current call graph.
  - [P3] `openspec/changes/refactor-codex-desktop-service-extraction/verification.md` — Electron GUI smoke not run on this host (disclosed). verification.md lines 241-247 honestly discloses that `bun run dev` and the native module rebuild for better-sqlite3/node-pty cannot load libnspr4.so/libnss3.so on this Linux host, so no end-to-end quit-with-active-stream or cancel-mid-stream GUI scenario was exercised. I independently confirmed the compensating evidence is real: the token revoke/finalize/unsubscribe code paths are byte-for-byte traceable to the pre-refactor router (verified via git diff and manual line-by-line comparison of lib/codex/desktop-run-provider-binding.ts and lib/codex/desktop-run-finalize.ts against main:src/main/lib/trpc/routers/codex.ts lines 539-558, 1235-1282), the app-shell abort wiring (src/main/index.ts, src/main/windows/main.ts) changed only import paths (confirmed via git diff, zero logic diff), and the new tests/codex-desktop-service-boundary.test.ts adds static negative assertions (no `revokeProviderGatewayToken`/`getProviderGatewayEndpoint`/`db.update(`/`createCodexAppServerAdapter` string in the router) that a GUI smoke could not add more assurance for. Given the change is a verbatim code move plus this static/unit-test compensating coverage, I assess this as an accepted, well-disclosed environment gap rather than a live risk — appropriate for Owner risk-acceptance rather than a blocking finding.

#### Reviewer summary

Security/trust-boundary review of 6bf928bf00051ab1e9513b67162280677134d972 (worktree at 240aed1b, docs-only diff confirmed via `git diff --stat`, 8 implementation commits match `main..6bf928bf`). Focus: scoped Codex gateway-token lifecycle, provider-binding three-way selection, redaction pipeline, tool-approval resolution, app-shell abort path, import boundaries, and env-switch trust after the move from routers/codex.ts into src/main/lib/codex/*.\n\nMethod: read design.md/verification.md; extracted the original router (`git show main:src/main/lib/trpc/routers/codex.ts`) to a scratch file and did line-by-line comparison of the token-closure (original lines 539-558), three-way provider-binding block (764-931), the `finally`/unsubscribe termination paths (1235-1282), tool-approval resolution, and the env-switch adapter construction (1117-1166) against the new lib/codex/desktop-run-provider-binding.ts, desktop-run-finalize.ts, tool-approvals.ts, active-streams.ts, and app-server-adapter-runner.ts. Ran `bun run architecture:check` (passed), targeted `bun test --isolate` over the provider-binding/finalize/active-streams/tool-approvals/adapter-runner/boundary suites (24 pass / 0 fail / 113 expectations), and `bun run ts:check` (clean). Confirmed `git status --porcelain` stayed clean after every command.\n\nFindings, confirmed not hypothesized:\n- Token issuance/scope unchanged: `providerBinding` returned to the router (and later persisted via trace events / DesktopRunRequest) explicitly excludes the token field in both old and new code (old: providerBinding object at router:1091-1101 has only id/baseUrl/authMode; new: `CodexDesktopRunProviderBindingResolution.providerBinding` is typed `Omit<DesktopRunProviderBinding, \"diagnostics\">` and the resolve() return also omits `token`). No new path leaks the token into renderer chunks, persisted subChats rows, or trace/job events.\n- Revocation on all four termination paths preserved and still idempotent: natural finish and error both fall through to the same `finally` -> `finalizeCodexDesktopRunAfterLifecycle` which calls `revokeProviderBinding()` then `clearProviderSecrets()` (nulls tokens) in the same order as the original `finally` block; cancel/unsubscribe -> `cleanupCodexDesktopRunSubscription` calls `abort()` then `revoke()` in the same order as the original returned teardown closure. The `revoke()` guard (`if (!token || revoked) return`) is the same idempotence check moved verbatim, so the finally+unsubscribe double-call race present in the original is preserved with the same protection, not introduced or weakened.\n- No token lifetime widening: `providerGatewayToken`/`providerUpstreamToken` are scoped to a `createCodexDesktopRunProviderBindingStage()` instance created fresh per subscription (codex.ts:415), matching the original per-IIFE closure lifetime exactly. `resolve()` is called exactly once per run in the shipped call graph.\n- Redaction pipeline unchanged: every renderer chunk still flows through `redactRendererRuntimeChunk` with `secretHints: providerSecretHints()` at both `emitRendererChunk` and `safeEmit` (codex.ts:418-458), byte-identical to the original. Error-path diagnostics still go through the same `redactRendererRuntimeChunk`+`console.error(\"[codex] chat stream error\", redactedDiagnostics)` call (codex.ts:746-767 vs original 1213-1234). Grepped the three new persistence/preflight/finalize lib files for `console.`/`token`/`apiKey`/`secret` literals -- none found, so no new diagnostic string embeds credentials.\n- tool-approvals.ts move is a verbatim module-scope Map with the same get/resolve/delete semantics as the original inline block; no teardown hook auto-resolves or auto-rejects pending approvals except the pre-existing `clearPendingCodexApprovals` call sites (finalize, cancel mutation, cleanup mutation, abortAllCodexStreams), all of which existed before the move.\n- App-shell abort path (`hasActiveCodexStreams`/`abortAllCodexStreams` in src/main/index.ts and src/main/windows/main.ts, used for the quit-with-active-stream confirm dialog) has a zero-logic-diff import-path-only change (confirmed via `git diff main -- src/main/index.ts src/main/windows/main.ts`); `abortAllCodexStreams()` itself is a verbatim move (active-streams.ts:42-49 vs original router:230-237).\n- No new import-boundary violations: grepped all seven touched lib/codex modules for electron/trpc/renderer/react imports -- none found. `docs/OWNERSHIP_MAP.md` was updated (lines 239-267) to name the actual shipped files as canonical owners and explicitly states the router \"must not own durable desktop-run state, persistence, provider-token lifecycle, or adapter construction\" -- this matches the code as shipped. `tests/codex-desktop-service-boundary.test.ts` adds static negative assertions (router source must not contain `revokeProviderGatewayToken`, `getProviderGatewayEndpoint`, `db.update(`, `createCodexAppServerAdapter`, `LOCUS_CODEX_APP_SERVER`, `new Map<`) plus positive assertions that the router calls each canonical stage function -- this is exactly the trust-boundary regression detector this review was asked to look for, and it passed.\n- Env experiment switches (`LOCUS_CODEX_APP_SERVER_EXPERIMENTAL_API`, `_CONTROLLED_EDIT_EXECUTOR`, `_APPLY_PATCH_EXPERIMENT`) moved into `app-server-adapter-runner.ts` still read only from `process.env` (default `input.env ?? process.env`, no renderer-supplied field feeds this parameter anywhere in the router); `resolveCodexDesktopAdapterSelection` ignores its `_env` argument and always returns `useAppServer: true`, matching the original hardcoded `enabled: true`. `appManagedApiKey: input.providerGatewayToken !== null ? null : input.appManagedApiKey` is logically equivalent to the original `codexProviderProfile ? null : appManagedCodexApiKey` for every reachable value (gateway token is always the profile's issued token when a profile exists, so `!== null` triggers whenever profile truthy).\n- Preflight cwd authority unchanged: `verifyDesktopRunPreflight(db, {...})` call site and import (`../agent-runtime/preflight`) is unmoved and unchanged in the router (codex.ts:476); the extracted preflight stage (`desktop-run-preflight.ts`) only owns the runtime-status/local-only-blocker helpers, not the cwd-authoritative check, matching the design doc's stated scope.\n- Persistence guard semantics (duplicate-prompt detection, authoritative-run check before the guarded assistant-message write) are logically identical between old `isAuthoritativeRun()`/`persistSubChatMessages()` and new `isDuplicateCodexDesktopRunPrompt`/`persistCodexDesktopAssistantAfterNaturalFinish`'s inline `if (currentStream && currentStream.runId !== input.runId) return false` guard (De Morgan-equivalent to the original `!currentStream || currentStream.runId === input.runId`). The pre-existing unguarded initial user-message write is preserved as-is (an existing behavior, not introduced by this refactor, and explicitly disclosed as a known baseline asymmetry in verification.md rather than silently repaired).\n- MCP zod schema dedupe (`runtime-mcp-config/input-validation.ts`) centralizes null-byte/header-control-char/URL-protocol/env-name validation that was previously duplicated inline in the router; compared against the original inline schemas, the validation rules (null-byte rejection, http/https-only URL protocol, `^[A-Za-z_][A-Za-z0-9_]*$` env name) are unchanged, only centralized -- this is a strengthening/consolidation, not a weakening, and `tests/mcp-config-boundaries.test.ts` pins the shared owner with direct negative-case coverage.\n\nNo P0/P1/P2 issues found. All two findings are P3: one is an inert defensive-but-unreachable line with no current exploit path, the other is the disclosed (not hidden) desktop-GUI-smoke environment gap, which I independently corroborated is well compensated by exact-code-move verification, unit tests, and new static boundary assertions -- appropriate for Owner risk acceptance, not a blocking technical finding.
