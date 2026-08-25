# Change: Extract the Codex desktop chat service out of the tRPC router

## Why

`src/main/lib/trpc/routers/codex.ts` (1,334 lines) is still the **temporary** canonical owner
of the Codex desktop chat runtime — `docs/OWNERSHIP_MAP.md` ("Codex Desktop Chat Runtime",
`docs/OWNERSHIP_MAP.md:240`) grants it that role only "until service extraction is completed
by an approved OpenSpec change". This is that change. The debt is no longer cosmetic:

- **The dependency direction is inverted in shipped code.** The router module holds
  process-wide durable state — the `activeStreams` Map (`codex.ts:207`), the
  `pendingCodexToolApprovals` Map (`codex.ts:208`) — and `src/main/index.ts:36` and
  `src/main/windows/main.ts:28-30` import `hasActiveCodexStreams` / `abortAllCodexStreams`
  (and, in `index.ts`, the re-exported `getAllCodexMcpConfigHandler`) **from the router
  module**. OWNERSHIP_MAP's dependency-direction rule ("tRPC routers import durable behavior
  and shared state from main-process lib owners ... never the reverse",
  `docs/OWNERSHIP_MAP.md:288-290`) is violated by the app shell today. The Claude side
  already has the correct shape: `src/main/lib/claude/active-sessions.ts` and
  `src/main/lib/claude/tool-approvals.ts`.
- **The roadmap phases are blocked on this extraction** (per the Foundation dual-paths
  audit, which this change cites as its dependency rationale):
  - *Job Kernel v1.1 (async submit)* — the entire Codex run pipeline
    (preflight → binding → job → adapter → finalize) is an IIFE closure inside the `chat`
    subscription (`codex.ts:516-1272`). Until those stages are lib functions callable
    without a tRPC subscription, async submit cannot reuse the desktop path and would be
    forced into a second Run-lifecycle implementation, violating the C-series invariants.
  - *Interactive Runs (durable InteractionRequest)* — durable approvals need a per-runtime
    approval owner that is not router module state; `pendingCodexToolApprovals` must live
    in `lib/codex` before it can gain a persistence hook.
  - *Portable Sessions* — Codex sub-chat message writes are two bare `db.update(subChats)`
    calls inside the subscription closure (`codex.ts:956`, `codex.ts:981`); a
    SessionBinding needs a single session read/write owner.
  - *Runtime Core Import Boundary* — guarded runtime-core directories may never import
    modules resolving under `src/main/lib/trpc/` (`docs/OWNERSHIP_MAP.md:272-301`), so any
    future kernel service in `src/main/lib/agent-runtime/` is structurally unable to reach
    active-stream state while it lives in the router.
- The Claude side proves the target shape works: its `chat` subscription is a thin
  orchestrator over staged `agent-sdk-desktop-run-*` lib modules, with adapter dispatch
  through `DesktopRuntimeAdapterFactory` (`src/main/lib/claude/agent-sdk-adapter-runner.ts:138`).
  Codex bypasses the factory and calls `createCodexAppServerAdapter` directly
  (`codex.ts:1115`), so the third-runtime phase currently has no single adapter dispatch
  point to extend.

This is a behavior-preserving refactor: no renderer-visible procedure, input schema, stream
chunk vocabulary, event ordering, or persisted data shape changes.

## What Changes

1. **Move router-held durable state to lib owners.** Create
   `src/main/lib/codex/active-streams.ts` (active stream registry: register/lookup/delete,
   `hasActiveCodexStreams`, `abortAllCodexStreams`) and `src/main/lib/codex/tool-approvals.ts`
   (pending approval store + `clearPendingCodexApprovals`), mirroring
   `lib/claude/active-sessions.ts` and `lib/claude/tool-approvals.ts`. In the same change,
   rewire `src/main/index.ts` and `src/main/windows/main.ts` to import the new lib modules,
   point `index.ts` at `getAllCodexMcpConfigHandler`'s real owner
   (`src/main/lib/runtime-mcp-config/codex.ts`), and delete the router's module-level Maps,
   helpers, and re-export (`codex.ts:127`, `codex.ts:207-236`). No reverse router import
   of `routers/codex` remains anywhere.
2. **Extract the Codex chat run pipeline into staged `lib/codex` modules**, mirroring
   Claude's `agent-sdk-desktop-run-*` structure (emit callbacks injected; the router keeps
   zod input validation and the tRPC stream envelope, which `docs/OWNERSHIP_MAP.md:246-249`
   explicitly allows to stay):
   - `src/main/lib/codex/desktop-run-provider-binding.ts` — the three-way binding selection
     (provider profile / app-managed API key / ChatGPT login, `codex.ts:764-931`) plus the
     scoped gateway token issue/revoke lifecycle (`codex.ts:539-551`), landing beside the
     existing `lib/codex/provider-runtime-binding.ts`.
   - `src/main/lib/codex/desktop-run-persistence.ts` — chat history load, duplicate-prompt
     detection, user-message build/persist, and assistant-message build/persist including
     `buildCodexAppServerAssistantMessage` (`codex.ts:161-199`, `codex.ts:727-988`,
     `codex.ts:1186-1199`). The two bare `db.update(subChats)` writes and the
     authoritative-run guard move here, giving sub-chat message persistence a lib owner.
   - `src/main/lib/codex/desktop-run-preflight.ts` — preflight blocker emission
     (`emitPreflightBlocker`, `emitLocalOnlyPreflightBlocker`, the runtime-status gate;
     `codex.ts:652-725`).
   - `src/main/lib/codex/desktop-run-finalize.ts` — desktop job flag bookkeeping
     (`sawError` / `reachedNaturalFinish` / `adapterFailed`), the `finally` finalize path
     (`completeDesktopChatAgentJobSafely`), and the unsubscribe/cancel path
     (`requestCancelDesktopChatAgentJobSafely`) (`codex.ts:534-538`, `codex.ts:1053-1073`,
     `codex.ts:1225-1272`).
3. **Route Codex adapter construction through `DesktopRuntimeAdapterFactory`.** Create
   `src/main/lib/codex/app-server-adapter-runner.ts` mirroring
   `lib/claude/agent-sdk-adapter-runner.ts`: it constructs the app-server adapter
   (consuming `resolveCodexDesktopAdapterSelection`) and dispatches through the factory in
   `lib/agent-runtime/desktop-runner.ts`. The `LOCUS_CODEX_APP_SERVER_*` env-var experiment
   switch reads (`codex.ts:1117-1148`) move down with it. The direct
   `createCodexAppServerAdapter` import/call in the router is deleted.
4. **Dedupe the MCP zod wrapper schemas.** The wrappers repeated verbatim in
   `routers/claude.ts` (~`:57-92`) and `routers/codex.ts` (~`:129-155`)
   (`mcpStringInputSchema`, `mcpArgsInputSchema`, `mcpEnvInputSchema`, `mcpUrlInputSchema`,
   `zodMessage`) move into `src/main/lib/runtime-mcp-config/input-validation.ts` beside the
   normalization logic they wrap; both routers import them and delete their copies.
5. **Update `docs/OWNERSHIP_MAP.md` in the same change.** Retire the
   "temporary owner until service extraction" clause for `codex.ts`
   (`docs/OWNERSHIP_MAP.md:240-251`): the Codex Desktop Chat Runtime section now names the
   `lib/codex` desktop-run owners as canonical, with the router holding only input
   validation and the tRPC stream envelope. The equivalent `claude.ts` clause
   (`docs/OWNERSHIP_MAP.md:232-238`) remains — its residual is accepted and out of scope.

## Out of scope

Explicitly **not** in this change (adjacent debt is logged, not implemented):

- Any further `claude.ts` refactoring (including its remaining inline secret-hints closure
  and image-capability resolution) and any rename/merge of Claude's `agent-sdk-*` stage
  modules.
- Codex `login` / `logout` / API-key procedures, including the `startLogin` spawn state
  machine (`codex.ts:351-404`) — logged as a Yellow follow-up.
- MCP CRUD procedures on either router (they already match the tRPC Route Boundary role).
- `routers/claude-settings.ts` persistent-state debt and its four lib→router reverse
  imports (`lib/runtime-mcp-config/claude.ts:48`, `lib/agent-builder/claude-native-agents.ts:9`,
  `lib/mcp-auth.ts:25`, and the dynamic import at `lib/claude/agent-sdk-config-dir.ts:79`) —
  logged as a Yellow follow-up.
- Any behavior change visible to the renderer or to Local Job API / headless consumers.
- Event vocabulary unification (Job Kernel v1.1 scope) and async submit.
- New architecture-guard rules (e.g. a generic "no module-level Maps in routers" rule) —
  may be logged as follow-up only.

## Impact

- **Affected specs: none.** This is a pure internal refactor. Renderer-observable
  procedures, input schemas, stream chunks, agent-job events, and persisted `subChats`
  message JSON are unchanged, and no spec names `src/main/lib/trpc/routers/codex.ts` as a
  required location (verified by grep over `openspec/specs/`). The change carries **no spec
  deltas**; because `openspec validate --strict` fails a change with no delta, the change
  directory carries a `.openspec.yaml` with `skip_specs: true` declaring the no-delta status,
  and the change will be archived with
  `openspec archive refactor-codex-desktop-service-extraction --skip-specs --yes`.
  The existing `architecture-ownership` requirements ("Runtime Execution Boundary
  Ownership", "Runtime Core Import Boundary") already mandate this ownership shape; this
  change brings the implementation into conformance rather than changing the requirement.
- **Affected code:**
  - Edited: `src/main/lib/trpc/routers/codex.ts` (shrinks to validation + envelope +
    staged orchestration), `src/main/lib/trpc/routers/claude.ts` (MCP zod dedupe only),
    `src/main/index.ts`, `src/main/windows/main.ts`,
    `src/main/lib/runtime-mcp-config/input-validation.ts`, `docs/OWNERSHIP_MAP.md`,
    `src/shared/agent-runtime-capabilities.ts` (only the capability-manifest `references`
    entries whose named evidence moves out of `codex.ts`), and the source-text assertion
    test suites listed under Verification consumers.
  - Created: `src/main/lib/codex/active-streams.ts`, `src/main/lib/codex/tool-approvals.ts`,
    `src/main/lib/codex/desktop-run-provider-binding.ts`,
    `src/main/lib/codex/desktop-run-persistence.ts`,
    `src/main/lib/codex/desktop-run-preflight.ts`,
    `src/main/lib/codex/desktop-run-finalize.ts`,
    `src/main/lib/codex/app-server-adapter-runner.ts`, plus their unit tests.
- **Coordination:** `update-trpc-capability-boundary` (Blocked pending rebaseline) inventories
  router files but does not depend on `codex.ts` internals; the `chat` procedure name and
  input fields it references are unchanged. The path-trust allowlist entries keyed
  `src/main/lib/trpc/routers/codex.ts:chat` etc. in `scripts/check-architecture-guards.mjs:948-979`
  stay valid because the procedures and their input fields remain router-owned.

### Canonical owners after this change

| Logic | Canonical owner |
| --- | --- |
| Codex active stream registry (incl. app-shell queries/abort) | `src/main/lib/codex/active-streams.ts` (new; mirrors `lib/claude/active-sessions.ts`) |
| Codex pending tool approvals | `src/main/lib/codex/tool-approvals.ts` (new; mirrors `lib/claude/tool-approvals.ts`) |
| Three-way provider binding selection + scoped gateway token lifecycle | `src/main/lib/codex/desktop-run-provider-binding.ts` (new; beside `provider-runtime-binding.ts`) |
| Sub-chat history load, duplicate-prompt detection, user/assistant message persistence | `src/main/lib/codex/desktop-run-persistence.ts` (new; mirrors `lib/claude/agent-sdk-message-persistence.ts`) |
| Preflight blocker emission + runtime-status gate | `src/main/lib/codex/desktop-run-preflight.ts` (new) |
| Desktop job flag bookkeeping + finalize/cancel | `src/main/lib/codex/desktop-run-finalize.ts` (new) |
| Codex adapter construction + env experiment switches + factory dispatch | `src/main/lib/codex/app-server-adapter-runner.ts` (new; mirrors `lib/claude/agent-sdk-adapter-runner.ts`, dispatches via `DesktopRuntimeAdapterFactory`) |
| MCP tRPC input zod wrappers | `src/main/lib/runtime-mcp-config/input-validation.ts` (existing owner, gains the wrappers) |
| tRPC input validation + stream envelope for Codex chat | `src/main/lib/trpc/routers/codex.ts` (retained by explicit OWNERSHIP_MAP authorization) |

### Old-path deletion points (same change — no dual paths remain)

Every extraction deletes its router-side original in the same change; no temporary dual
path is created, so no migration-gate/deprecation scaffolding is needed for code paths:

- `activeStreams`, `pendingCodexToolApprovals`, `clearPendingCodexApprovals`,
  `hasActiveCodexStreams`, `abortAllCodexStreams` deleted from `codex.ts:207-236`; the
  `getAllCodexMcpConfigHandler` re-export deleted from `codex.ts:127`; both app-shell
  imports (`src/main/index.ts:36`, `src/main/windows/main.ts:28-30`) rewired to lib in the
  same commit.
- `buildCodexAppServerAssistantMessage` (`codex.ts:161-199`), the `persistSubChatMessages`
  closure and both bare `db.update(subChats)` writes (`codex.ts:947-988`) deleted from the
  router; only the new persistence owner writes sub-chat messages.
- The inline three-way binding block and gateway token closure (`codex.ts:539-551`,
  `codex.ts:764-931`) deleted; the router receives a binding result object.
- Direct `createCodexAppServerAdapter` import (`codex.ts:47`) and call (`codex.ts:1115`)
  plus inline `LOCUS_CODEX_APP_SERVER_*` env reads deleted; construction happens only in
  the adapter runner behind the factory.
- Duplicated MCP zod wrappers deleted from both routers.
- Acceptance for all of the above: negative source-text assertions (see tasks 7.x) pin the
  post-extraction router shape so a regression reintroducing any deleted block fails CI.

### Migration gate

**None required.** No database schema, no persisted file format, and no on-disk state
changes. The moved persistence code must keep writing byte-identical `subChats.messages`
JSON (same message ids/parts/metadata shape) — asserted by unit tests that compare the
moved builder's output against the current shape, and by the desktop smoke re-opening an
existing Codex chat history.

### Verification consumers

- `bun run check:full` (lint, `architecture:check`, `ts:check`, `bun test`,
  `spec:validate`, build, diff check) — the receipt is bound to the source SHA in
  `verification.md`.
- The source-text assertion suites (15 files) that read `routers/codex.ts` today and must be
  re-pointed at the new owners in the same change:
  `tests/agent-runtime-preflight.test.ts`, `tests/runtime-stream-event-mapper.test.ts`,
  `tests/desktop-runtime-adapter-factory.test.ts`, `tests/agent-guard-runtime-pipeline.test.ts`,
  `tests/agent-guard.test.ts`, `tests/long-text-send-pipeline.test.ts`,
  `tests/rich-chat-attachments-pipeline.test.ts`, `tests/agent-runtime-permission-policy.test.ts`,
  `tests/mcp-config-boundaries.test.ts`, `tests/codex-prompt.test.ts`,
  `tests/codex-tool-permission.test.ts`, `tests/provider-credential-storage.test.ts`,
  `tests/provider-routing-ux.test.ts`, `tests/codex-api-key-validation.test.ts`,
  `tests/codex-cli-runner.test.ts`.
- New unit tests for `active-streams`, `tool-approvals`, `desktop-run-persistence`
  (duplicate-prompt detection + authoritative-run guard + message JSON shape), and the
  adapter runner (factory dispatch + env switch mapping), mirroring the Claude
  counterparts' coverage.
- New negative source-text assertions pinning the post-extraction `codex.ts` shape
  (`.not.toContain` pattern precedented by `tests/agent-runtime-registry.test.ts`).
- Desktop smoke (`bun run dev`): a Codex chat runs end to end (stream, tool approval,
  cancel, resume of an existing history); quitting with an active Codex stream still
  triggers the confirm-and-abort path in `src/main/windows/main.ts`; evidence recorded in
  the change directory.

### W7 autonomy envelope

- **Green (implementer may do autonomously):** verbatim moves of the named blocks into the
  named owners; creating the seven new lib modules and their unit tests; import rewires in
  `index.ts` / `windows/main.ts`; deleting the router-side originals; re-pointing the
  listed source-text assertion suites; adding negative assertions; the `OWNERSHIP_MAP.md`
  edit specified above; updating `agent-runtime-capabilities.ts` `references` entries whose
  named evidence file changed; splitting `desktop-run-finalize.ts` into `-state`/`-cleanup`
  files if that mirrors Claude more cleanly (owners in the table above remain authoritative).
- **Yellow (log a follow-up, do not implement):** `startLogin` spawn state-machine
  extraction into `lib/codex/login-session.ts`; `claude-settings.ts` persistent-state
  extraction (four reverse lib→router imports); remaining `claude.ts` inline residuals;
  a generic architecture-guard rule against router module-level state; any additional
  capability-manifest reference cleanups beyond files this change moves.
- **Red (stop and ask the Owner):** anything that changes a renderer-visible procedure
  name, input schema, stream chunk type/order, or error/auth-error text semantics; any
  `subChats` / `agent_jobs` schema or persisted-format change; any change to gateway token
  issuance, revocation timing, or redaction behavior; edits to guarded runtime-core
  directories beyond consuming existing exports; changes to
  `scripts/check-architecture-guards.mjs` allowlists; anything touching the tRPC stream
  envelope's observable semantics that OWNERSHIP_MAP authorizes the router to keep.
