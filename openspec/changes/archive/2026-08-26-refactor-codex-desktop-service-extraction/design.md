# Design: Extract the Codex desktop chat service out of the tRPC router

## Context

`routers/codex.ts` (1,334 lines) holds, inside a single `chat` subscription IIFE
(`codex.ts:516-1272`) plus module scope, the entire Codex desktop run lifecycle: active
stream registry, pending approvals, preflight blockers, three-way provider binding with a
scoped gateway token, sub-chat history load and persistence (two bare `db.update(subChats)`
writes), desktop job flag bookkeeping, direct adapter construction with env-var experiment
switches, finish-gate handling, and finalize. The Claude side went through this exact
extraction already and landed as ~10 staged `agent-sdk-desktop-run-*` lib modules
orchestrated by a ~250-line subscription (`routers/claude.ts:98-344`), with shared state in
`lib/claude/active-sessions.ts` / `lib/claude/tool-approvals.ts` and adapter dispatch
through `DesktopRuntimeAdapterFactory` (`lib/claude/agent-sdk-adapter-runner.ts:138`).

Constraints:

- `docs/OWNERSHIP_MAP.md:246-249` explicitly authorizes `codex.ts` to keep the tRPC stream
  envelope during extraction; everything else desktop-chat-durable belongs under
  `src/main/lib/codex/`.
- The Foundation batch precedes Job Kernel v1.1 / Interactive Runs / Portable Sessions;
  those phases consume the extracted stage functions, so the extraction boundary must leave
  each stage callable without a tRPC subscription (emit/persist as injected callbacks, not
  captured closures).
- 15 test suites assert source text of `routers/codex.ts` by `readFileSync`; the
  file survives (no ENOENT crashes), but assertions on moved text fail and must be
  re-pointed in the same change.
- This runs concurrently with other Foundation drafts; it touches only Codex desktop files,
  both routers' MCP zod blocks, the two app-shell files, and `docs/OWNERSHIP_MAP.md`.

## Goals / Non-Goals

- Goals:
  - `routers/codex.ts` retains only: zod input validation, the tRPC observable/stream
    envelope (`safeEmit` / finish-gate wiring / redaction call points), and ordered calls
    into `lib/codex` stage functions.
  - No module in `src/main/` imports anything from `routers/codex` except the tRPC router
    registry itself.
  - Each extracted stage is independently unit-testable and callable without a subscription.
  - Bit-identical observable behavior: same chunks in the same order, same persisted
    message JSON, same agent-job events, same error/auth-error texts.
- Non-Goals:
  - No merge of desktop and headless lifecycles, no event-vocabulary unification, no async
    submit (Job Kernel v1.1 scope).
  - No change to `codex.ts` login/logout/API-key/MCP-CRUD procedures.
  - No new architecture-guard rules; no renames of existing Claude modules.
  - No renderer edits of any kind.

## Decisions

- **Decision 1: Mirror Claude's staged structure under the existing `desktop-run-*` prefix.**
  `lib/codex` already has `desktop-run-request.ts`, so the new stage owners are
  `desktop-run-{provider-binding,persistence,preflight,finalize}.ts` plus
  `app-server-adapter-runner.ts` and the state modules `active-streams.ts` /
  `tool-approvals.ts`.
  *Alternative considered:* one `codex-desktop-service.ts` façade. *Rejected* — the Claude
  extraction proved per-stage files keep review and later kernel reuse tractable, and the
  audit maps each inline block 1:1 onto a stage; a façade would just recreate a 700-line
  module one directory lower.
- **Decision 2: The router keeps the stream envelope; stages receive callbacks.**
  Stage functions take `emit` / `emitPreflightBlocker` / `registerPendingQuestion`-style
  callbacks and return values (binding result, persistence handle, run-state object) rather
  than reaching for subscription closures. This is exactly how Claude's
  `prepareClaudeAgentSdkDesktopRunControls` / `superviseClaudeAgentSdkDesktopRun` are
  shaped, and it is what makes the stages reusable by a future non-tRPC submitter.
- **Decision 3: Move code verbatim; refactor structure, not logic.**
  The duplicate-prompt signature comparison, the authoritative-run guard
  (`activeStreams.get(...).runId === input.runId`), gateway revoke idempotence, and the
  finish-gate error/finish suppression checks are concurrency-sensitive. Each moves with
  its exact logic and gains a unit test in its new home; any "while we're here" cleanup is
  Red-zone. The three run flags stay one mutable state object owned by
  `desktop-run-finalize.ts` and threaded through, mirroring
  `lib/claude/agent-sdk-desktop-run-state.ts`.
- **Decision 4: Adapter construction goes behind `DesktopRuntimeAdapterFactory`.**
  `app-server-adapter-runner.ts` consumes `resolveCodexDesktopAdapterSelection`
  (`lib/codex/desktop-adapter-selection.ts`, already the selection owner), builds the
  adapter config — including the `LOCUS_CODEX_APP_SERVER_EXPERIMENTAL_API`,
  `LOCUS_CODEX_APP_SERVER_CONTROLLED_EDIT_EXECUTOR`, and
  `LOCUS_CODEX_APP_SERVER_APPLY_PATCH_EXPERIMENT` env reads and the smoke-only
  `configOverrides` block — and dispatches `new DesktopRuntimeAdapterFactory([...]).get({runtimeId: "codex"})`,
  mirroring `agent-sdk-adapter-runner.ts:138`. This creates the single dispatch point the
  third-runtime phase extends. *Alternative:* register both runtimes in one process-wide
  factory instance now. *Rejected* — cross-runtime registry design belongs to the kernel
  change; per-call factories match the shipped Claude pattern.
- **Decision 5: `index.ts` stops importing anything from the router.**
  `hasActiveCodexStreams` / `abortAllCodexStreams` come from `lib/codex/active-streams.ts`;
  `getAllCodexMcpConfigHandler` was never router logic — it lives in
  `lib/runtime-mcp-config/codex.ts` and is only re-exported at `codex.ts:127` — so
  `index.ts:881` imports the owner directly and the re-export is deleted.
- **Decision 6: State modules expose narrow functions, not raw Maps.**
  Mirroring `lib/claude/active-sessions.ts`: typed accessors
  (`getActiveCodexStream`, `setActiveCodexStream`, `deleteActiveCodexStreamIfRun`,
  `hasActiveCodexStreams`, `abortAllCodexStreams`) plus `...ForTest` reset hooks, keyed by
  `subChatId` with `runId`-authoritative checks preserved. `tool-approvals.ts` follows
  `lib/claude/tool-approvals.ts` (`store` accessor, `clearPendingCodexApprovals`,
  resolve-by-`toolUseId`). Interactive Runs later swaps the Map for a durable store behind
  the same functions.
- **Decision 7: No spec deltas; archive `--skip-specs`.**
  No renderer-observable behavior changes and no spec names the router path (grep over
  `openspec/specs/` confirms). The `architecture-ownership` spec already *requires* this
  ownership shape; writing a delta would restate an existing requirement. Precedent: the
  repo archives tooling-only changes with `--skip-specs` (`openspec/AGENTS.md:63`).

## Risks / Trade-offs

- **Source-text assertion suites are the biggest breakage surface.** 15 suites
  `readFileSync` `routers/codex.ts` and assert text that moves (e.g.
  `tests/desktop-runtime-adapter-factory.test.ts:141` "keeps Codex desktop chat on the
  app-server adapter boundary", `tests/runtime-stream-event-mapper.test.ts:516`,
  `tests/agent-runtime-preflight.test.ts:246`). → *Mitigation:* task 1.2 inventories every
  assertion against the moved blocks before any move; each extraction commit re-points its
  assertions to the new owner file in the same commit, keeping `bun test` green throughout.
- **Behavior drift in concurrency-sensitive paths** (duplicate-prompt detection,
  authoritative-run persistence guard, double-finish suppression, token revoke on both
  `finally` and unsubscribe). → *Mitigation:* verbatim moves (Decision 3), unit tests in
  the new owners, and the desktop smoke exercising run/cancel/re-run on one sub-chat.
- **Capability manifest references go stale.** `src/shared/agent-runtime-capabilities.ts`
  lists `src/main/lib/trpc/routers/codex.ts` as evidence for several Codex capabilities
  (e.g. `providerProfiles`, `usageMetadata`, `mcpAuth`). After extraction some of that
  evidence lives in the new lib files. → *Mitigation:* update only entries whose named
  behavior moved (Green-zone); the router path stays valid for envelope-level evidence.
- **Guard allowlist keys reference router procedures.**
  `scripts/check-architecture-guards.mjs:948-979` keys entries like
  `"src/main/lib/trpc/routers/codex.ts:chat"`. Procedures and their input fields stay in
  the router, so keys stay valid; editing that allowlist is Red-zone.
- **Trade-off accepted:** the router remains a non-trivial orchestrator (like
  `claude.ts:98-344`) rather than shrinking to a one-liner. That is the OWNERSHIP_MAP-
  sanctioned end state for this change; further thinning is kernel-phase work.

## Migration Plan

Ordered, each step leaving `bun run check` green:

1. Inventory: map every source-text assertion on `routers/codex.ts` to the block it pins;
   capture a `bun run check` baseline.
2. State extraction: create `active-streams.ts` / `tool-approvals.ts`, move the Maps and
   helpers, rewire `codex.ts` internals, `index.ts`, `windows/main.ts`; delete the
   router-side originals and the `getAllCodexMcpConfigHandler` re-export.
3. Stage extraction, one commit per stage in run order: preflight → provider binding →
   persistence → finalize. Re-point affected test assertions in each commit.
4. Adapter runner + factory dispatch; move env switches; re-point
   `desktop-runtime-adapter-factory.test.ts`.
5. MCP zod dedupe across both routers.
6. `docs/OWNERSHIP_MAP.md` update + capability-manifest reference updates + negative
   assertions pinning the final router shape.
7. Verification: `bun run check:full`, desktop smoke, evidence, closeout.

**Rollback:** every step is a code move with no schema or persisted-format change;
reverting the branch restores prior behavior exactly. No data cleanup is needed at any
point.

## Open Questions

- None blocking. Naming latitude (e.g. splitting `desktop-run-finalize.ts` into
  `-state`/`-cleanup` twins to mirror Claude exactly) is delegated to the implementer as
  Green-zone, provided the canonical-owner table in `proposal.md` stays accurate and
  `docs/OWNERSHIP_MAP.md` names the files actually created.
