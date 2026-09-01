# Ownership Map

This map records the canonical owner for cross-cutting Locus behavior. Before
changing a listed capability, update the owner or change the owner file itself;
do not add parallel old/new implementations in another route, adapter, transport,
or UI helper.

## Runtime Capability Truth

- Canonical owner: `src/shared/agent-runtime-capabilities.ts`
- Facades: `src/shared/codex-runtime-capabilities.ts`
- Supported runtime IDs: `claude-code` and `codex`; the desktop and contract
  runtime sets currently match.
- Tests: `tests/agent-runtime-capabilities.test.ts`,
  `tests/codex-runtime-capabilities.test.ts`
- Rule: runtime-specific files may expose facades, but must not define a second
  capability ID list or a second manifest truth table.

## Runtime Capability Projection

- Canonical owner: `src/main/lib/runtime-capability-projection/`
- Consumers: capability-specific registry owners, runtime home/session
  preparation adapters, Settings runtime availability surfaces
- Rule: projected capability materialization, projection result types,
  per-runtime availability state, projection fingerprints, and non-secret
  diagnostics belong to this owner or to adapters registered by this owner.
  Runtime-specific routes, renderer code, and capability registries must not
  derive a second projection truth table from install state, runtime names, or
  filesystem guesses. Runtime capability class support stays in
  `src/shared/agent-runtime-capabilities.ts`; MCP config read/write and verified
  usability stay with Runtime MCP Config and MCP Registry owners; plugin
  runtime-native activation identity stays with Runtime Plugins.

## Agent Builder And Locus Agents

- Canonical owners:
  - Locus Agent CRUD and prompt-context transformation:
    `src/main/lib/app-agents/`
  - Agent Builder aggregation, import, and projection orchestration:
    `src/main/lib/agent-builder/`
  - Runtime projection state and availability:
    `src/main/lib/runtime-capability-projection/`
- Consumers: Settings or capability-center Agent Builder surfaces, mention
  providers, runtime availability surfaces, runtime-specific projection adapters
- Rule: Locus-managed Agents are the canonical product object for user-created
  reusable personas. Agent Builder may aggregate Locus Agents, runtime-native
  discovered agents, and plugin-provided agents, but it must preserve source,
  owner, mutability, projection mode, and sanitized diagnostics in DTOs.
  Runtime-native `.claude/agents`, future Codex-native subagents, and
  plugin-provided agents must not become editable Locus Agents unless the user
  explicitly imports or duplicates them. Renderer code must not infer Agent
  runtime support from runtime names, file paths, or install state. "Custom
  Agents" must not return as a product-facing category.

## Runtime Chat UI Event State

- Canonical owner: `src/renderer/features/agents/lib/runtime-event-state.ts`
- Consumers: `src/renderer/features/agents/lib/ipc-chat-transport.ts`,
  `src/renderer/features/agents/lib/acp-chat-transport.ts`
- Rule: transports may subscribe, normalize, and enqueue runtime chunks, but
  shared atom updates for AskUserQuestion and guarded-run events must go through
  the owner.

## Renderer Chat Message Model And Hydration

- Canonical model owner: `src/shared/chat-message.ts`
- Persisted-message normalizer owner:
  `src/shared/chat-message-normalizer.ts`
- Consumers: renderer chat store, renderer chat view, chat transports, and
  `src/main/lib/trpc/routers/chats-crud.ts` create-input validation.
- Rule: persisted `sub_chats.messages` JSON must hydrate through the shared
  normalizer and type against the shared canonical message model. Render-derived
  grouping parts may live in the renderable union but must not become persisted
  message schema. The live runtime-event-state path remains owned by
  `runtime-event-state.ts`; main-process message writers may adopt the shared
  type later without introducing a second definition.

## Chat Session Binding

- Canonical owner: `src/main/lib/chat-session-binding.ts`
- Shared contract types and write normalization:
  `src/shared/chat-session-binding.ts`
- Desktop Run admission-order guard:
  `src/main/lib/agent-runtime/desktop-run-admission-generation.ts`
- Consumers: `src/main/lib/trpc/routers/chats-crud.ts` and
  `src/main/lib/trpc/routers/chats-sub-chats.ts` as transport envelopes;
  Codex/Claude desktop Run routes as exact DB-binding admission consumers;
  renderer chat transports through constructor-injected binding DTOs; database
  startup through the idempotent legacy-chat backfill.
- Rule: runtime, provider profile, model, model source, and thinking selection
  for an existing chat are read and written only through the canonical owner.
  Renderer `lastSelected*` atoms are creation-time defaults only and must never
  resolve an existing chat. Message metadata may provide provenance and the
  one-time startup backfill input, but it must not select the current runtime or
  transport after a binding row exists. Explicit Provider Profile selection
  snapshots its current default model into the binding; later Profile edits may
  change credentials/routing but must not replace that model snapshot. Codex
  Provider Profiles currently expose reasoning `none` only: their binding
  thinking level is `NULL`, their UI effort control is absent, and only the
  Codex responses gateway removes the reserved `/none` transport suffix. A
  desktop Codex gateway token also owns the admitted Profile model snapshot
  used by `/models`; legacy/headless tokens retain mutable-default discovery.
  Desktop Run routes must complete binding/chat/cwd/scope preflight before
  replacing active runtime state, and only the latest per-chat admission
  generation may activate after asynchronous controls; the generation helper
  orders candidates but does not own active sessions. The canonical binding
  owner rejects all mutations while either Codex or Claude owns an active Run;
  a mutation before active ownership is invalidated by the candidate's final
  DB re-admission and does not create a second pending-run registry or lease.
  Active lifecycle cancellation, persistence, approval cleanup, and deletion
  compare the exact installed runtime-owner object; an external `runId` is
  metadata and cannot authorize an old Run to affect a newer same-ID Run. Every
  chat-history write rechecks the exact owner immediately before committing,
  and every asynchronous preparation/retry rechecks immediately before job or
  runtime dispatch. Codex stop and transport cleanup travel through the exact
  tRPC subscription closure; the former sub-chat/run-ID mutation routes are
  removed because they could not express object ownership. Pending questions
  use a main-minted per-pending `approvalId`; runtime `toolUseId` remains only
  tool provenance and cannot resolve or delete another Run's approval. Renderer
  cleanup compare-deletes the exact chat/approval/tool tuple and cannot clear a
  newer question after an asynchronous response.
  Guarded tool callbacks likewise require their captured contract object to
  remain installed before authorization, after asynchronous user approval,
  and before consuming a cached pre-tool decision. Activating a contract
  revokes any prior contract for that sub-chat even when its renderer ID
  differs; callbacks never substitute a newer contract. The sole active
  contract registry is keyed by sub-chat and exposes winner publication plus
  exact-object current/delete operations; pre-admission publish helpers are
  forbidden. Codex native protocol responses repeat exact Run/contract checks
  at the final child-write boundary before any allow response.
  `sub_chats.sessionId` remains native session provenance, not binding truth;
  only main-owned DB/history readers and persistence writers may select or
  update it. Renderer chat inputs/transports and generic renderer mutation
  routes must not accept native session identity.

## Chat Maintenance Fence (Temporary Phase 5 Precursor)

- Canonical owner:
  `src/main/lib/agent-runtime/chat-maintenance-fence.ts`
- Consumers: `chats.rollbackToMessage` and the final active-owner claim paths
  of Claude and Codex desktop Runs.
- Rule: this owner holds at most one exact, main-process-memory maintenance
  token per sub-chat plus exact rollback-only blockers for every desktop Run
  that passed final claim but whose supervised lifecycle has not settled. It
  coordinates only destructive rollback against those Runs and a new desktop
  Run's final claim. It does not wait,
  renew, recover, persist, write schema, touch `agent_jobs` or binding rows,
  govern binding mutation, or serve headless/job/workspace execution. Process
  restart clears it. Conflicts use the structured precursor shape
  `code: SESSION_BINDING_BUSY`, exact `subChatId`, `operation: rollback`,
  `activeRunId: string | null`, and
  `reason: active-run | maintenance`; Foundation uses `subChatId`, not a
  durable `bindingId`, because this is not yet the C4 SessionBinding lease.
  Every successful final Run claim atomically installs an exact blocker in
  this owner; only that Run's supervised lifecycle `finally` releases it.
  Blockers never arbitrate Run versus Run and grant no execution authority, so
  a successor may start while an aborted predecessor drains. If successor B
  settles before predecessor A, B releases only B and A still keeps rollback
  BUSY, including when both use the same external Run ID or the single current
  runtime registry has been cleared. Signal-aware runtime and persistence
  paths reject aborted owners, so blocker retention never authorizes more work
  or DB writes.
  Cleanup compare-releases only the exact token. If acquisition invalidates an
  already-reserved Run candidate, this same owner may retain a one-shot exact
  admission tombstone solely so that candidate reports maintenance BUSY even
  after token release; it is consumed on claim/release, is restart-cleared,
  and is not waiting, renewal, or execution authority.
- Mandatory Phase 5 absorption/deletion: the durable C4 SessionBinding lease
  MUST absorb or replace this ordering rule and delete
  `chat-maintenance-fence.ts`. The temporary in-memory owner and durable lease
  must never remain as parallel fences.

## Guard Decisions

- Canonical owner: `src/main/lib/agent-guard/decision.ts`
- Consumers: Claude runtime route, Codex ACP permission handler, headless or job
  adapters that need guarded execution decisions
- Rule: runtime adapters may translate provider-specific permission envelopes,
  but they must not reimplement guarded-run allow/deny logic.

## Scope Contracts And Guard Audit

- Canonical owners: `src/main/lib/agent-guard/contract.ts`,
  `src/main/lib/agent-guard/audit.ts`
- Consumers: runtime routers, permission handlers, desktop UI event state
- Rule: the contract/audit schema and validation belong to the guard package;
  runtime-specific code may only attach runtime context.

## Worktree Setup Trust

- Canonical owner: `src/main/lib/git/worktree-setup-trust.ts`
- Consumers: worktree creation, worktree setup config routes, renderer approval
  prompt
- Rule: repository-provided worktree setup commands must not execute until this
  owner has produced or verified an explicit user approval for the current
  project and setup command fingerprint. Routes and renderer code may display
  or submit approval decisions, but must not derive their own trust state or
  start setup command execution directly.

## Unified Git Diff Parsing

- Canonical owner: `src/shared/unified-diff-parser.ts`
- Consumers: main-process Git/diff routes, Agent Workbench conflict analysis,
  and renderer diff presentation
- Rule: unified-diff splitting, quoted Git path decoding, rename validation,
  hunk extraction, and parsed-file types live in this shared owner. Main or
  renderer consumers must not keep a second parser or path decoder.

## Agent Workbench Conflict Adjudication

- Canonical owners:
  - status-visible path overlap and deep-check eligibility:
    `src/main/lib/agent-workbench/conflicts.ts`
  - snapshot-safe hunk and committed-tree verdicts (one directory owner):
    `src/main/lib/agent-workbench/`, split by responsibility into
    `deep-conflicts.ts` (public facade and overall orchestration),
    `workspace-conflict-snapshot.ts` (status summary, immutable HEAD and stable
    dirty snapshot), `hunk-conflicts.ts` (path/hunk evidence), `merge-tree.ts`
    (Git capability and committed-tree trial), and
    `deep-conflict-{types,deadline}.ts` (shared contract and request budget)
  - persisted worktree fork commit capture/backfill:
    `src/main/lib/chat-base-commit.ts`
  - renderer conflict entry-point state:
    `src/renderer/features/agents/lib/diff-open-filter-state.ts` (preserve an
    explicit conflict-file filter while the existing diff surface mounts),
    `src/renderer/features/agents/workbench/diff-surface-routing.ts` (choose
    the existing responsive diff surface), and
    `src/renderer/features/agents/workbench/conflict-verdict-state.ts`
    (pending/stale presentation state)
- Consumers: `src/main/lib/trpc/routers/agent-workbench.ts` and the existing
  Agent Workbench/diff renderer surfaces
- Rule: the route resolves registered project/worktree identities and maps the
  transport envelope, but conflict classification, eligibility, immutable Git
  snapshot rules, and verdict semantics stay in the owners above. Renderer code
  only presents verdicts and routes users into the existing diff surface; it
  must not implement a second detector or review path. External consumers import
  the deep-check API through `deep-conflicts.ts`; sibling owner modules divide
  implementation responsibility and must not copy each other's logic. Opening a
  conflict must retain the caller-supplied overlapping-file filter; the mounted
  diff provider must not replace it with the first unrelated dirty file.

## Desktop Runtime Preflight

- Canonical owner: `src/main/lib/agent-runtime/preflight.ts`
- Consumers: Claude desktop adapter, Codex desktop adapter, desktop job shell,
  runtime diagnostics
- Rule: desktop runtime work must consume verified project, chat, sub-chat, cwd,
  provider, MCP, attachment, and local-only context from preflight before
  provider or adapter startup. Routes must not pass raw renderer `cwd`,
  provider config, MCP config, or attachment references directly to runtime
  startup.

## Runtime Permission Policy

- Canonical owner: `src/main/lib/agent-runtime/permission-policy.ts`
- Consumers: Claude desktop adapter, Codex desktop adapter, guard decision
  service, runtime diagnostics
- Rule: plan, agent, and guarded desktop semantics must be resolved through the
  shared policy owner before runtime startup. Runtime-specific code may map the
  policy to native SDK, ACP, app-server, or CLI controls, but must not derive a
  second durable interpretation of plan mode, guarded scope, or side-effect
  approval.

## Headless Runtime Adapter Selection

- Canonical owner: `src/main/lib/headless/adapter-selector.ts`
- Consumers: `src/main/lib/headless/agent-runtime.ts`, Local Job API job
  runner, headless process adapters, Codex app-server headless wrapper
- Rule: headless/runtime adapter choice, execution profile gating, selected or
  refused diagnostics, fallback reasons, and policy-grant enforcement labels
  belong to the selector. Local Job API request parsing may validate input, but
  must not own a second adapter-selection or policy-grant enforcement table.
  Current Local Job API `policyGrant.scopes` are admission/audit metadata unless
  a later approved scope-enforcement change binds them to adapter permission
  decisions.

## Desktop Runtime Request And Adapter Boundary

- Canonical owners: `src/main/lib/agent-runtime/desktop-run-request.ts`,
  `src/main/lib/agent-runtime/desktop-runner.ts`
- Consumers: Claude desktop runtime, Codex desktop runtime, desktop job shell,
  Workbench trace surfaces
- Rule: desktop runtime adapters receive verified context, permission policy,
  provider binding metadata, MCP readiness, attachment references, trace
  observer, cancellation signal, and session metadata through the desktop run
  request. Routes remain envelope/input surfaces and must delete or gate
  route-local helpers once equivalent adapter-owned behavior exists.

## Runtime Events, Trace, And Redaction

- Canonical owners: `src/main/lib/agent-runtime/runtime-events.ts`,
  `src/main/lib/agent-runtime/redaction.ts`
- Consumers: desktop runtime adapters, `src/main/lib/job-store.ts`, Workbench,
  chat transports
- Rule: runtime streams may emit provider-specific chunks, but persisted job
  events and renderer-visible diagnostics must pass through normalized event
  mapping and redaction first. Raw provider, gateway, MCP, OAuth, header, and
  environment secrets must not be persisted or emitted to renderer state.
  Run-scoped credentials are passed to the redaction owner only as
  main-process-only exact secret hints; hints themselves never enter an event,
  message, result, diagnostic, renderer payload, or durable record.

## Provider Credentials

- Canonical storage and read owners:
  - provider profiles: `src/main/lib/provider-profiles/storage.ts`
  - local helper provider configs:
    `src/main/lib/local-api-provider-config.ts`
  - Claude custom provider config:
    `src/main/lib/claude/provider-config-store.ts`
  - app-managed Codex API key: `src/main/lib/codex/api-key-store.ts`
- Shared token normalization and storage primitives:
  `src/main/lib/provider-token.ts` and `src/main/lib/secure-storage.ts`
- Runtime environment and binding owners: `src/main/lib/claude/env.ts`,
  `src/main/lib/codex/provider-runtime-binding.ts`, and
  `src/main/lib/codex/official-runtime-env.ts`
- Consumers: runtime startup, status checks, provider profile routes
- Rule: `provider-profiles/storage.ts` is the only owner that reads persisted
  provider-profile/default rows, validates stored JSON/enums/headers, decrypts
  profile credentials, and joins a default to its runtime config. Headless
  provider binding may select request/default/native sources, enforce runtime
  targets, and create a scoped gateway binding, but it must consume the storage
  owner and must not keep another row parser or decryptor. Invalid persisted
  values fail closed. Plaintext provider secrets stay in the main process;
  renderer code may receive status, IDs, labels, and redacted metadata only.

## Claude Desktop Chat Runtime

- Canonical owner: `src/main/lib/trpc/routers/claude.ts` until service
  extraction is completed by an approved OpenSpec change
- Primary SDK surface: `@anthropic-ai/claude-agent-sdk`
- Containment: `scripts/architecture-baselines.json` records the route's
  temporary-owner line-count and named-export ratchet. Growth fails
  `architecture:check`; the ratchet retires with the approved extraction that
  removes this temporary-owner clause.
- Rule: the bundled Claude Code CLI is an install/runtime asset, not a second
  desktop chat implementation.

## Codex Desktop Chat Runtime

- Canonical run-stage owners:
  - active stream registry: `src/main/lib/codex/active-streams.ts`
  - pending tool approvals: `src/main/lib/codex/tool-approvals.ts`
  - runtime-status preflight: `src/main/lib/codex/desktop-run-preflight.ts`
  - provider selection and scoped gateway lifecycle:
    `src/main/lib/codex/desktop-run-provider-binding.ts`
  - sub-chat history and user/assistant persistence:
    `src/main/lib/codex/desktop-run-persistence.ts`
  - desktop job state, finalization, and subscription cancellation:
    `src/main/lib/codex/desktop-run-finalize.ts`
  - adapter construction and factory dispatch:
    `src/main/lib/codex/app-server-adapter-runner.ts`
- App-server transport and behavior owners remain under
  `src/main/lib/codex/app-server-*`; adapter selection remains owned by
  `src/main/lib/codex/desktop-adapter-selection.ts`.
- Route boundary: `src/main/lib/trpc/routers/codex.ts` owns tRPC input/schema
  validation, the observable stream envelope, renderer redaction/finish-gate
  wiring, and ordered orchestration of the lib owners. It must not own durable
  desktop-run state, persistence, provider-token lifecycle, or adapter
  construction.
- Containment: `scripts/architecture-baselines.json` records an
  **orchestration-boundary no-growth ratchet** over the route's line count and
  named exports. This is not a temporary-owner marker. It retires only through
  an explicit Owner decision, or in the same approved change that structurally
  decomposes the route (for example, Job Kernel).
- Rule: `codex exec` remains the headless/batch fallback and must not become a
  second desktop chat implementation. App-shell and runtime-core code consume
  the lib owners directly and never reverse-import the router.

## Headless Agent Runtime

- Canonical owner: `src/main/lib/headless/agent-runtime.ts`
- Runtime adapters: `src/main/lib/headless/adapters/claude-code.ts`,
  `src/main/lib/headless/adapters/codex.ts`
- Rule: headless adapters own batch/job invocation semantics only. They must not
  duplicate desktop chat stream, approval, or UI-state behavior.

## Runtime MCP Configuration

- Canonical owner: `src/main/lib/runtime-mcp-config/`
- Runtime adapters: `src/main/lib/runtime-mcp-config/claude.ts`,
  `src/main/lib/runtime-mcp-config/codex.ts`
- Consumers: runtime routes, startup MCP warmup, and desktop runtime startup
  materialization
- Rule: runtime routes may validate tRPC inputs and map errors, but durable MCP
  listing, status, auth, add/update/remove, refresh/cache, and session
  materialization behavior belongs to the Runtime MCP Config service.

## Runtime Core Import Boundary

- Guarded runtime-core directories:
  - `src/main/lib/agent-runtime/`
  - `src/main/lib/headless/`
  - `src/main/lib/agent-guard/`
  - `src/main/lib/provider-profiles/`
  - `src/main/lib/model-catalog/`
  - `src/main/lib/codex/`
  - `src/main/lib/claude/`
  - `src/main/lib/runtime-mcp-config/`
  - `src/main/lib/runtime-capability-projection/`
  - `src/main/lib/agent-workbench/`
- Rule: source files in these directories must not directly import:
  - Electron (`electron` or any `electron/*` subpath)
  - tRPC packages (`@trpc/*`, `trpc-electron`, or any
    `trpc-electron/*` subpath) or modules that resolve under
    `src/main/lib/trpc/`
  - renderer code, including modules that resolve under `src/renderer/` and
    the `@/` renderer alias
  - preload code that resolves under `src/preload/`
- Machine-readable violation baselines:
  `scripts/architecture-baselines.json#importBoundaryViolations` and
  `#reverseDirectionImports`. Findings outside those frozen sets fail; stale
  entries fail with a tightening instruction. The normal guard compares the
  file with committed `HEAD`, its previous changed version, and the CI diff
  base, so baselines may only shrink unless the Owner explicitly authorizes a
  reviewed guard/spec change.
- Dependency direction: tRPC routers import durable behavior and shared state
  from main-process lib owners. Every file under `src/main/lib/` outside
  `src/main/lib/trpc/` is checked against imports resolving under
  `src/main/lib/trpc/routers/`; pre-existing findings are frozen in the
  reverse-direction baseline and new findings fail.
- Local API provider reads are owned by
  `src/main/lib/local-api-provider-config.ts`. That owner may materialize the
  decrypted runtime token for main-process consumers; its tRPC router returns
  metadata only and imports the owner, never the reverse.
- The guard enforces direct imports and one-hop wrapper growth. A module outside
  the guarded directories that is imported by guarded code and directly
  imports a banned category must be in the canonical
  `scripts/architecture-baselines.json#reachThroughWrappers` registry. Full
  transitive closure remains deferred by design. Modules under `src/main/lib/`
  use extensionless paths relative to that directory as registry names; any
  repository-local wrapper outside it uses an extensionless repository-relative
  path. An entry without a corresponding live one-hop finding is stale and fails
  with a tightening instruction. The list below is an exact,
  guard-asserted documentation mirror of that machine registry, not a second
  source of truth. Its first 12 entries were Owner-authorized on 2026-08-27;
  after that freeze the registry may only shrink.
  <!-- architecture-guard:reach-through-wrappers:start -->
  - `electron-app`
  - `db`
  - `secure-storage`
  - `local-only`
  - `chat-attachments`
  - `mcp-auth`
  - `skills/registry`
  <!-- architecture-guard:reach-through-wrappers:end -->
  A direct import from a guarded directory into a banned category still fails.

## tRPC Route Boundary

- Canonical owner: the service or shared library named in this map
- Route role: input validation, authorization/status wrapping, and transport
  envelope handling
- Machine-readable containment:
  `scripts/architecture-baselines.json#routeSurfaceRatchets` stores the neutral
  per-route line-count and exact named-export data. Guard diagnostics apply the
  route-specific governance meaning: Claude is temporary-owner containment;
  Codex is orchestration-boundary no-growth containment.
- Rule: new long-lived business logic should not be added directly to large
  runtime routes unless the route is explicitly listed as the temporary owner.
  When a service is introduced, route-local duplicate logic must be deleted in
  the same commit or guarded by an explicit migration plan.

## OpenSpec Boundary

- Canonical owner: `openspec/specs/`
- Pending changes: `openspec/changes/`
- Rule: architecture shifts, runtime interface migrations, security-sensitive
  changes, and new cross-cutting ownership rules require an OpenSpec change
  before implementation.
