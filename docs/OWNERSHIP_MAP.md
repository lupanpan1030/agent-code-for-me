# Ownership Map

This map records the canonical owner for cross-cutting Locus behavior. Before
changing a listed capability, update the owner or change the owner file itself;
do not add parallel old/new implementations in another route, adapter, transport,
or UI helper.

## Runtime Capability Truth

- Canonical owner: `src/shared/agent-runtime-capabilities.ts`
- Facades: `src/shared/codex-runtime-capabilities.ts`
- Persisted chat-metadata vocabulary adapter: `src/shared/chat-engine-id.ts`
- Derived chat consumers: `src/shared/chat-session-binding.ts` and the
  `metadata.provider` schema in `src/shared/chat-message.ts`
- Supported runtime IDs: `claude-code` and `codex`; the desktop and contract
  runtime sets currently match.
- Tests: `tests/agent-runtime-capabilities.test.ts`,
  `tests/codex-runtime-capabilities.test.ts`
- Rule: runtime-specific files may expose facades, but must not define a second
  capability ID list, engine ID list, or manifest truth table. Chat metadata
  keeps its persisted `provider` key, while its Engine ID values and types
  derive from `CONTRACT_RUNTIME_IDS` through the vocabulary adapter.

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
  `src/renderer/features/agents/lib/codex-app-server-chat-transport.ts`
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

## Repository Default Branch Resolution

- Canonical owner: `src/main/lib/git/default-branch.ts`
- Direct consumers: `changes.getBranches` and `cleanupOrphanedBranches` in
  `src/main/lib/git/branches.ts`; `createWorktreeForChat` and
  `getWorktreeDiff` in `src/main/lib/git/worktree.ts`
- Rule: repository default-branch precedence and local/remote/fallback
  provenance live only in the canonical owner. Without a configured `origin`,
  an existing local `main` wins, then local `master`, then an attached current
  branch backed by a local ref; the compatibility fallback is `main` and must
  not be reported as an existing ref. Branch listing and orphan cleanup use
  cached/local observations only. Worktree creation and clean-diff fallback
  retain the legacy network-allowed `origin` observation profile. Consumers
  must preserve explicit branch choices, use auto-detected local results as
  local refs, and leave existing stored `baseBranch` values authoritative.
- Adjacent exclusions: GitHub workflow discovery remains owned by
  `src/main/lib/github-workflow/gh-cli.ts:resolveGitDefaultBranch`; explicit
  `origin/HEAD` synchronization is implemented by the currently unreferenced
  `src/main/lib/git/worktree.ts:refreshDefaultBranch` (its `hasOriginRemote`
  dependency and `fetchDefaultBranch` are also pre-existing dead-helper cleanup
  candidates); remote fetch and
  merge/rebase policy remains owned by
  `src/main/lib/git/git-operations.ts:mergeFromDefault`.
  `src/main/lib/git/worktree.ts:606` (`detectBaseBranch`) is a currently
  unreferenced base-detection heuristic over `origin/*`, not a default-branch
  resolver. Guard strengthening and these dead helpers are tracked in
  [TICKET-124](tickets/TICKET-124-default-branch-guard-cleanup-hermetic-tests.md).
  Existing fallback/presentation heuristics in
  `src/main/lib/git/file-contents.ts:80`,
  `src/main/lib/trpc/routers/chats-pr.ts:75`,
  `src/main/lib/trpc/routers/status.ts:35`,
  `src/renderer/features/details-sidebar/sections/changes-widget.tsx:309-312`,
  `src/renderer/features/agents/ui/sub-chat-status-card.tsx:82`, and the
  `createWorktree` default `origin/main` start point in
  `src/main/lib/git/worktree.ts:227-231` remain outside this four-consumer
  migration. They do not inspect local refs or implement/replace the repository
  resolver policy; this change does not migrate them.

## Managed Worktree Path Parsing

- Canonical owner: `src/shared/worktree-path.ts`
- Consumers: renderer tool paths, Git activity and changed-file tracking,
  details-sidebar worktree affordances, Claude project-config resolution, and
  main-process worktree base-directory construction.
- Rule: the managed-worktree marker, separator normalization, structural path
  parsing, and project-relative extraction belong to this pure shared owner.
  Main and renderer consumers may apply their own presentation or database
  lookup fallbacks after parsing, but must not copy the marker regex or infer
  the managed path structure independently.

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
- Run events: the request may carry the Run's host-composed ledger (`ledger`).
  Adapters submit native boundaries and observations through it and project
  the committed records it returns; `desktop-runner.ts` records the
  adapter-started fact with `appendSystemEvent`. No adapter allocates sequences,
  reconstructs a terminal or mints `completed` (see Runtime Events, Trace, And
  Redaction).

## Runtime Events, Trace, And Redaction

- Canonical owners: `src/main/lib/agent-runtime/run-event-ledger.ts` (the
  per-Run canonical ledger: native/coarse/host ingress, dense sequences and
  fact keys, item/usage reconciliation, the one `completed` through `settle`,
  native context), `src/main/lib/agent-runtime/run-event-ledger-host.ts`
  (host composition: `getOrCreateRunEventLedger` for existing jobs, the
  SQLite store adapter that is the sole importer of `appendExactRunEventBatch`
  from `src/main/lib/headless/job-store.ts`, host-only execution binding, the
  per-Run native artifact candidate sink of a Run with an admitted run
  directory and the desktop renderer channel),
  `src/main/lib/agent-runtime/run-provenance.ts`
  (`captureRunExecutionProvenance`: installation identity, executable digest
  and reproducible schema fingerprints at executable resolution),
  `src/main/lib/agent-runtime/run-artifacts.ts` (artifact admission with the
  `native-file` / `native-image` / `native-diff` roles, staging of native
  content inside the admitted run directory, and run-dir file
  preparation/writing), `src/main/lib/agent-runtime/runtime-events.ts`
  (`createRunEvent` constructor and record types) and
  `src/main/lib/agent-runtime/redaction.ts` (the single redaction algorithms)
- Supporting owners: `src/main/lib/agent-runtime/ledger-ingress.ts` (stateless
  coarse and desktop stream decode), `src/main/lib/codex/app-server-stream-events.ts`
  (stateless `decodeCodexNativeBoundary` and the pinned disposition table, plus
  the stateless `codexNativeArtifactEvidence` candidate evidence and
  `classifyCodexThreadSnapshot` resume-snapshot classification),
  `src/main/lib/agent-runtime/stream-event-mapper.ts` (pure
  `projectRunEventToRendererChunks` over committed records),
  `src/main/lib/codex/app-server-transport.ts` (JSON-RPC wire ids; its
  per-request `onSent` hook hands the wire id to the adapter so every client
  response reaches the ledger with its original request correlation),
  `src/main/lib/headless/job-recovery.ts` (stale-worker recovery: 120 s
  heartbeat predicate plus same-host liveness probe or supervisor-observed
  exit; only confirmed-stopped workers settle, others are a host
  `heartbeat_only` diagnostic) and the Claude
  neutral native diagnostics in `src/main/lib/claude/agent-sdk-errors.ts`
  (`NATIVE_RESUME_REJECTED`, no expiry inference or session-binding change)
- Artifact ownership split: `run-artifacts.ts` validates, prepares and writes
  run-dir files (terminal files are staged, then published after the terminal
  commit or discarded) and alone admits native candidates, reading them
  through the run directory handle; adapters only hand
  candidate evidence to the host sink and never mint `artifact_created`. The
  local-job-api capability and `src/main/lib/headless/local-job-api.ts`
  serializers own the v1 file paths, roles, schema and consumer contract
  (including listing only ledger-registered refs in results), and the writer
  consumes those definitions without forking them
- Historical read metadata: `src/main/lib/headless/job-store.ts`
  `runEventHistoryQuality` labels `ledger_version=0` jobs `legacy_unverified`
  for the store header and the Workbench read (tRPC `agentJobs.logs`) only;
  no public job, result or event envelope carries it
- Consumers: desktop runtime adapters, headless job runners and lifecycle
  services, CLI/protocol/v1 serializers, Workbench, chat transports, and Local
  Browser guest diagnostics through `redactUntrustedDiagnosticPayload` (the
  same matching without a run identity; see Local Browser Guest Boundary)
- Rule: every persisted job event is committed by the Run's ledger; routes,
  adapters, lifecycle services and recovery submit observations or evidence
  through the host and never insert `agent_job_events` rows, allocate
  sequences or mint `completed`. Renderer-visible Run output is the projection
  of committed, redacted records. Raw provider, gateway, MCP, OAuth, header,
  and environment secrets must not be persisted or emitted to renderer state.
  Run-scoped credentials are passed to the redaction owner only as
  main-process-only exact secret hints; hints themselves never enter an event,
  message, result, diagnostic, renderer payload, or durable record.
- Workbench trace reader:
  `src/renderer/features/agents/workbench/workbench-trace-presenter.ts` is the
  single versioned reader of persisted Run events. `getWorkbenchSemanticPayload`
  unwraps only pre-ledger (`ledger_version=0`) desktop wrapper rows; ledger rows
  are read as committed bare payloads.
- Architecture pins: `scripts/check-architecture-guards.mjs` always runs in
  canonical mode; there is no build-time ledger gate and no transition guard
  mode. It pins the owners in
  `tests/fixtures/run-event-ledger/architecture-fixtures.json#pinnedOwners`,
  allows only `run-event-ledger-host.ts` to import `appendExactRunEventBatch`
  (`APPEND_EXACT_RUN_EVENT_BATCH_IMPORTERS`), keeps the exact-record insert
  private to `job-store.ts`, rejects the retired exports and helpers, and binds
  execution provenance only through the host. Its fixture self-test must match
  every expected finding exactly. Behavioral pins are the acceptance suite
  `tests/run-event-ledger-*.test.ts` (S01–S56) and
  `tests/ledger-v1-fact-key-invariant.test.ts`.
- Forbidden duplicates: a second event mapper, sequence allocator or
  `completed` minter outside the ledger; any direct `agent_job_events`
  insert, update or delete in routes, adapters, schedules, recovery or
  lifecycle services; any importer of `appendExactRunEventBatch` other than the
  host; a stateful Codex decoder or an interrupt target kept outside the
  ledger's native context; a second redaction algorithm or store-side event
  redaction; a second provenance capture helper or a runtime delivery
  registry; native artifact admission, staging or `artifact_created` minting
  outside `run-artifacts.ts`, or a public `historyQuality` field; raw desktop
  text-delta joins or route-local history reconstruction
  instead of the committed item projection; the retired
  `src/main/lib/agent-runtime/job-event-bridge.ts` and the eleven retired
  symbols `mapDesktopStreamChunkToRunEvents`, `createDesktopStreamEventMapper`,
  `appendRunEventsToAgentJob`, `redactRendererDiagnosticChunk`,
  `redactRendererRuntimeChunk`, `createRuntimeRendererChunkEmitter`,
  `createRuntimeStreamChunkSecretRedactor`, `isDesktopRuntimeFailureChunk`,
  `persistedPayloadForRunEvent`, `createAgentJobRunEvent` and
  `appendAgentJobEvent`; and any reintroduced ledger gate or transition mode.

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
- Run events: the desktop run state holds the job's Run ledger.
  `src/main/lib/claude/agent-sdk-desktop-job.ts` binds the bundled executable's
  provenance before the query starts and hands the tuple to the desktop
  request, `src/main/lib/claude/agent-sdk-adapter.ts` re-checks it
  (`assertClaudeAgentSdkExecutableUnchanged`) immediately before the SDK
  spawns the executable and forwards the query's correlated `system/init` and
  `result` messages with the resume intent (`ingestClaudeMessage`), the
  envelope emits through the host
  renderer channel, and the finalizers submit terminal evidence.
  `src/main/lib/claude/agent-sdk-errors.ts` reports "No conversation found" as
  the neutral `NATIVE_RESUME_REJECTED`; the stream-error finalizer keeps the
  existing `sessionId`, and the renderer card
  (`src/renderer/features/agents/lib/ipc-chat-transport.ts`) reads "Session
  resume rejected" without claiming expiry or starting a fresh session.

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
- Run events: `src/main/lib/codex/app-server-adapter.ts` binds the resolved
  executable's provenance before spawn and submits correlated responses,
  notifications, server requests, response sends, resolved notifications and
  transport exits to the Run ledger; it reads the interrupt target from the
  ledger's native context and never fabricates `thread/started` or substitutes
  a session ID. After the ledger validates a `thread/resume` response it
  submits the response's thread snapshot to `repairFromSnapshot`
  (`repairFromValidatedResumeSnapshot`), and for a Run with an admitted run
  directory it forwards native file/image/diff candidate evidence to the host
  sink. `desktop-run-persistence.ts` writes history from the committed
  item projection, and `desktop-run-finalize.ts` submits terminal evidence
  instead of completing the job itself.
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
- Run events: `src/main/lib/headless/job-runner.ts` owns the thin coarse
  observation ingress and the outcome evidence of both terminal branches;
  `src/main/lib/headless/process-runner.ts#bindProcessRunExecutionProvenance`
  is the headless exec launch caller of provenance capture;
  `src/main/lib/headless/completion-runner.ts` binds its `locus-completion`
  tuple and settles through the ledger. Lifecycle services in
  `src/main/lib/headless/job-store.ts` (`createAgentJob`, `startAgentJob`,
  `retryAgentJob`, `cancelAgentJob`), `src/main/lib/headless/schedules.ts`
  (`recordAgentJobCreated`) and the CLI/API/tRPC cancel paths record through
  the host ledger. `src/main/lib/headless/job-recovery.ts` owns stale-worker
  liveness. The Codex app-server headless wrapper
  (`src/main/lib/headless/adapters/codex-app-server.ts`) consumes committed
  records and never appends them again; it hands the job runner's native
  artifact candidate sink (composed only for API runs with an admitted run
  directory) to the adapter. The runner facades return the committed outcome
  (`readOutcome()`: final status and completed sequence).
- Async submission and wait (add-local-job-api-async-submit):
  `src/main/lib/headless/run-submission.ts#submitRun` is the one submission
  core of API create/submit/retry and jobs-stdio `job.run` (validate,
  idempotency reservation, committed `job_created`, winner-only initial
  admission, ack); `src/main/lib/headless/run-submission.ts#waitForRun` is
  its read-only bounded wait. `src/main/lib/headless/daemon.ts#pumpQueuedRuns`
  is the only dispatch of queued headless, API and protocol Runs (daemon
  slots daemon → schedule → api; the create/retry wrapper and a protocol
  session pass their own admitted IDs); its runners run the claim-time API
  gate after the conditional claim. Desktop Runs keep their own
  desktop-source claim and dispatch in `src/main/lib/desktop-agent-jobs.ts`,
  which is a separate owner, not a duplicate of the pump.
  `src/main/lib/headless/job-store.ts#insertQueuedAgentJobRecord` (with the
  private reservation-aware insert behind `createAgentJob`/`retryAgentJob`)
  is the only `agent_jobs` row insertion; schedules call it inside their
  fire/audit transaction. `src/main/lib/agent-runtime/run-artifacts.ts#reopenAdmittedRunDir`
  owns the cross-process reopen of an admitted run directory, by the
  claimant and by the queued-cancel host that composes the same terminal
  preparer.
  The CLI and jobs-stdio adapters only parse and translate envelopes; they
  never call a runner or the claim primitives (the human `locus run` keeps
  its in-process runner). `scripts/check-architecture-guards.mjs` enforces
  this end state with the fixture
  `tests/fixtures/local-job-api-async/guards-protocol/architecture-fixtures.json`.

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

## Renderer Untrusted Content Boundary

- Canonical owner (reviewed raw-markup output):
  `src/renderer/lib/security/renderer-html-policy.ts`. `ReviewedRendererHtml`
  is an opaque sealed value; `reviewedInnerHtml` is the only adapter from a
  reviewed value to a React raw-markup sink (a forged value renders nothing);
  `reviewedEscapedText` is the single HTML text-escaping policy;
  `reviewShikiCodeToHtmlOutput` is the Shiki output adapter (one fully
  consumed top-level `<pre><code>` wrapper, fail closed to escaped text);
  `reviewedPlainCodeToHtml` backs the diff shim's `codeToHtml` export. The
  owner also holds the Mermaid CSS value profiles (`reviewMermaidPaintCss`,
  `reviewMermaidInlineStyle`, `reviewMermaidAttributeCss`), the one Mermaid
  SVG profile walk (`applyMermaidSvgProfile`, `strip` in the adapter,
  `verify` at the sink), the Mermaid sink adapter `reviewMermaidSvgOutput`
  (re-checks the adapter's string in the sink's HTML parse and seals it), the explicit
  replace-not-merge markdown chain `REVIEWED_MARKDOWN_REHYPE_PLUGINS` with
  `REVIEWED_MARKDOWN_SANITIZE_SCHEMA` (derived from `rehype-sanitize`
  `defaultSchema`) and `REVIEWED_MARKDOWN_HARDEN_OPTIONS`, and the
  rendered-DOM oracle profiles `RENDERER_MARKUP_PROFILES`.
- Markdown mount owner: `src/renderer/components/reviewed-streamdown.tsx`
  (`ReviewedStreamdown`, `MarkdownRenderBoundary`). Both the static and the
  streaming mounts in `src/renderer/components/chat-markdown-renderer.tsx`
  render through it: remark GFM + breaks, the reviewed rehype chain, required
  `code`/`pre` overrides (Streamdown's built-in Mermaid renderer stays
  dormant), and one app-owned error boundary that renders the source as React
  text. `streamdown` is pinned exactly `2.1.0`; `rehype-raw@7.0.0`,
  `rehype-sanitize@6.0.0` and `rehype-harden@1.1.7` are exact direct
  dependencies.
- Highlighted-code producer: `src/renderer/lib/themes/shiki-theme-loader.ts#highlightCode`
  returns only `ReviewedRendererHtml`. Its raw-sink consumers are
  `chat-markdown-renderer.tsx#CodeBlock`, `agent-edit-tool.tsx#DiffLineRow`,
  `agent-mcp-tool-call.tsx#HighlightedJson`, and
  `message-json-display.tsx#MessageJsonDisplay`.
- Mermaid SVG adapter: `src/renderer/lib/security/mermaid-svg-sanitizer.ts`
  (`MERMAID_SECURE_CONFIG_KEYS`, `assertMermaidDirectiveSuppression`,
  `sanitizeMermaidSvg`; DOMPurify is load-bearing, the DOMParser pass is
  defense in depth; it returns a string). `src/renderer/components/mermaid-block.tsx`
  passes that string through `reviewMermaidSvgOutput` and hands the one
  sealed `ReviewedRendererHtml` to its inline sink and its single fullscreen
  viewer through `reviewedInnerHtml`; the plain string backs only the SVG
  download.
- Dependency diff producer (Approval Question 9): the Vite-aliased
  `src/renderer/lib/vendor/pierre-diffs-shiki-shim.ts` (live `createPlainHast`
  text-node HAST serialized by un-aliased `hast-util-to-html@9.0.5`; its
  `codeToHtml` export routes through `reviewedPlainCodeToHtml`) for
  `@pierre/diffs@1.0.10`. The `unsafeCSS` prop at both
  `agent-diff-view.tsx#FileDiffCard` sites is exactly the app-owned constant
  `PIERRE_DIFFS_THEME_CSS`.
- Mentions editor model: `src/renderer/features/agents/mentions/mentions-editor-state.ts`
  owns the lossless text/atomic-mention runs, anchor/focus positions,
  canonical undo/redo state, and `buildEditorDom`, the one safe DOM builder
  (Text nodes, `br`, reviewed mention elements). The component
  `agents-mentions-editor.tsx` owns the native `beforeinput` allowlist and the
  paste/drop/dragover gates; `src/renderer/features/agents/utils/paste-text.ts#handlePasteEvent`
  is the typed paste delegate (images to the attachment callback, plain text
  returned for safe-builder insertion, HTML-only data rejected).
- Source guard: `tests/renderer-html-sinks.test.ts` with
  `tests/helpers/renderer-raw-sink-scanner.ts` holds the exact insertion-point
  inventory keyed by construct, file and enclosing symbol, each bound to its
  reviewed producer and behavior tests; the shared rendered-DOM oracle is
  `tests/helpers/renderer-executable-markup-oracle.ts`.
- Residuals: Monaco file-viewer and xterm terminal DOM producers are explicit
  residuals tracked in
  [TICKET-125](tickets/TICKET-125-monaco-xterm-dom-producers.md).
- Forbidden duplicates: caller-local HTML escapers, sanitizers or Shiki-output
  extraction; a generic `sanitize(anything)` helper; a second Streamdown
  configuration or a direct `<Streamdown>` mount outside the wrapper; DOM/HTML
  snapshots in editor undo/redo or any value-bearing `.innerHTML` restore;
  browser default rich-content insertion in the mentions editor; remote script
  loaders (the react-scan loader is removed); `@pierre/diffs` worker-pool
  entry points. A new raw-markup sink needs an inventory entry, a named
  producer and a behavior test in the same change.

## Local Browser Guest Boundary

- Canonical owner: `src/main/windows/local-browser-guest-policy.ts`, the sole
  Electron `<webview>` guest-policy owner (design D5-D9). It installs the one
  `app.on("web-contents-created")` hook with a per-window embedder registry;
  `will-attach-webview` forces `LOCAL_BROWSER_GUEST_WEB_PREFERENCES` and
  validates the element partition against the pending admission;
  `did-attach-webview` registration binds every guest WebContents handler.
  `LocalBrowserAdmissionRegistry` issues one-shot, short-TTL, count-bounded
  admissions whose high-entropy non-persistent partition is the sole
  attachment capability. Before a partition is returned, its Session receives
  the sole `webRequest.onBeforeRequest` gate and every deny handler
  (permission check/request, device, display media, HID/serial/USB/Bluetooth
  selection, `will-download`); file admissions alone bind the Session-scoped
  `locus-preview` handler (`serveLocusPreviewRequest`), whose scheme
  privileges (`LOCUS_PREVIEW_PRIVILEGES`) are registered before app
  readiness. The owner also holds main-alone `close()`/`isDestroyed()`
  teardown, the post-attach guest event relay, fixed `userGesture:false`
  diagnostic probes and bounded `capturePage`. Its decisions
  (`decideGuestRequest`, `decideGuestNavigation`, `decideCommittedGuestUrl`,
  `decideGuestPermission`, `decideGuestWindowOpen`,
  `enforceGuestWebPreferences`, `nextGuestLifecycleState`) are pure and its
  Electron surfaces are injected; Electron is imported only as types.
- Installation: `src/main/windows/main.ts#installLocalBrowserGuestBoundary`
  injects the Electron surfaces, `windowManager.claimChat` and
  `resolveRegisteredChatWorktreeRoot`, and is called from `src/main/index.ts`
  before app readiness. `createWindow` registers each app window through
  `registerLocalBrowserGuestEmbedder` before it loads the app document.
- Reused owners composed by the guest owner (never copied):
  - chat worktree authorization:
    `src/main/lib/fs/registered-roots.ts#resolveRegisteredChatWorktreeRoot`
    (DB-registered chat/worktree root);
  - chat window ownership: `src/main/windows/window-manager.ts#claimChat`
    (acquire if unowned, idempotent for the same window, bounded denial for
    another live owner, stale-owner cleanup);
  - descriptor-backed file reads: `src/main/lib/filesystem/stable-directory.ts`
    is the sole descriptor owner. `openRegisteredStableDirectory` realpath-
    canonicalizes the registered root and fails closed unless the registered
    leaf, canonical path and opened descriptor share one directory identity;
    `openStableDirectoryChild` and `readStableDirectoryFile` (no-follow,
    regular-file, byte-bounded read from the same descriptor) serve preview
    documents and assets. The owner has no win32 backend, so file preview is
    disabled on Windows while HTTP(S) previews still work;
  - pure URL grammar, report text and the named probe set:
    `src/shared/local-browser-workbench.ts` (`normalizeLocalBrowserUrl`,
    `isAllowedLocalBrowserUrl`, `localBrowserFileUrlPath`,
    `normalizeLocalBrowserRootPath`, `buildLocalBrowserReport`,
    `LOCAL_BROWSER_DIAGNOSTIC_PROBES`), shared by renderer UX and main
    enforcement;
  - diagnostics shape adapter: `src/shared/local-browser-diagnostics-policy.ts`
    (field minimization, URL credential/query/fragment stripping, console-level
    mapping, count/length and screenshot bounds, admission/event/capture
    types). It imports no main or Electron code and does no secret matching;
    main composes it with
    `src/main/lib/agent-runtime/redaction.ts#redactUntrustedDiagnosticPayload`
    before any value reaches the renderer.
- Preload projection: exactly three narrow, non-tRPC operations in
  `src/preload/index.ts` / `index.d.ts`: `requestLocalBrowserPreview`
  (`local-browser:request-preview`), `captureLocalBrowserDiagnostics`
  (`local-browser:capture-diagnostics`) and `onLocalBrowserGuestEvent`
  (`local-browser:guest-event`). Main derives the embedder from the IPC
  sender; callers supply only a chat ID and URL, or a generation.
- Renderer consumer: `src/renderer/features/agents/ui/local-browser-workbench.tsx`
  mounts a `<webview>` only with a main-issued admission (partition and src),
  needs a fresh admission for every element mount, and receives only
  main-minimized guest events and captures.
- Tests: `tests/renderer-hardening-guest-policy.test.ts`,
  `tests/renderer-hardening-preview-broker.test.ts`,
  `tests/renderer-hardening-impl-guest-decisions.test.ts`,
  `tests/renderer-hardening-impl-guest-owner.test.ts`,
  `tests/renderer-hardening-impl-preview-broker.test.ts`,
  `tests/renderer-hardening-impl-diagnostics.test.ts`,
  `tests/renderer-hardening-impl-workbench.test.ts`
- Forbidden duplicates: any `web-contents-created`, `will-attach-webview` or
  `did-attach-webview` handler, guest Session permission/device/display/
  download handler, guest `webRequest` gate or `locus-preview` handler outside
  the owner; guest deny handlers on `persist:main` or the default Session (the
  trusted voice/microphone path stays separately governed); renderer-derived
  partitions, URL-keyed remounts, direct guest `file:` sources, renderer
  `loadURL`, `executeJavaScript` or `capturePage`, and renderer listeners for
  raw page-controlled `<webview>` events; a second descriptor backend or a
  path-only/`file:` fallback; secret matching in shared or renderer code; a
  tRPC route for guest admission; `shell.openExternal` from the guest owner.

## OpenSpec Boundary

- Canonical owner: `openspec/specs/`
- Pending changes: `openspec/changes/`
- Rule: architecture shifts, runtime interface migrations, security-sensitive
  changes, and new cross-cutting ownership rules require an OpenSpec change
  before implementation.
