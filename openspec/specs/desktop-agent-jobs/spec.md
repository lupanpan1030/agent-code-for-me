# desktop-agent-jobs Specification

## Purpose
TBD - created by archiving change add-headless-agent-jobs. Update Purpose after archive.

## Requirements

### Requirement: Desktop Job Overview
The desktop app SHALL show active and recent local agent jobs in the agents/workbench experience.

#### Scenario: User opens job overview
- **WHEN** the user opens the job overview
- **THEN** the app lists active and recent jobs from local SQLite state
- **AND** each row or card shows job id, status, runtime, source, cwd or project, linked chat when available, and last update time
- **AND** the overview does not contact hosted upstream product services to populate local jobs

#### Scenario: CLI-created job exists
- **WHEN** a job was created by the CLI
- **THEN** the desktop job overview includes that job after refresh or subscription reconnect
- **AND** the user can inspect its event history from the desktop app

#### Scenario: Desktop chat run is persisted as a desktop job
- **WHEN** a user sends an ordinary desktop chat message through Claude Code or Codex
- **THEN** the system creates a linked `agent_jobs` record with `source=desktop`
- **AND** the job links to the same project, chat, sub-chat, cwd, runtime, mode, and prompt preview
- **AND** the existing chat/sub-chat message, session, and stream persistence remains the transcript source of truth
- **AND** provider credentials, raw auth headers, and plaintext provider secrets are not stored in the job row or job events

#### Scenario: Desktop chat job preserves current chat behavior
- **WHEN** a desktop chat job is created around an existing Claude Code or Codex stream
- **THEN** the current desktop chat UI continues to receive stream chunks through the existing transport
- **AND** the current `sub_chats.messages`, `session_id`, and `stream_id` behavior is preserved
- **AND** runtime-specific tool approval, guarded-run, rollback, attachment, and auth handling are not replaced by the job wrapper

### Requirement: Desktop Job Detail and Logs
The desktop app SHALL provide a job detail view that replays persisted job events and follows live updates when available.

#### Scenario: User opens running job detail
- **WHEN** the user opens detail for a running job
- **THEN** the app displays persisted events in order
- **AND** subscribes or polls for later events from the last seen sequence number

#### Scenario: User opens completed job detail
- **WHEN** the user opens detail for a completed, failed, canceled, or interrupted job
- **THEN** the app displays the final status, timing, result or error metadata, and event history
- **AND** no live runtime subscription is required to inspect the transcript

### Requirement: Desktop Job Actions
The desktop app SHALL expose safe local actions for jobs while reusing existing chat, review, and GitHub confirmation surfaces.

#### Scenario: User opens linked chat
- **WHEN** a job has a linked chat or sub-chat
- **THEN** the app provides an action to open that chat or sub-chat
- **AND** the action is disabled with a reason when the linked record is missing

#### Scenario: User cancels running job
- **WHEN** the user cancels a running job from the desktop app
- **THEN** the app calls the same job cancellation path used by the CLI
- **AND** the UI reflects cancellation as requested until the worker confirms `canceled` or recovery marks `interrupted`

#### Scenario: User cancels a desktop chat job from Workbench
- **WHEN** the user cancels a running `source=desktop` job from the Workbench
- **THEN** the app records a persisted cancel request for that job
- **AND** routes cancellation to the exact active desktop stream that owns that job
- **AND** does not cancel a newer stream in the same sub-chat when the selected job is no longer active

#### Scenario: User retries failed CLI job
- **WHEN** the user retries a failed, canceled, or interrupted non-desktop job from the desktop app
- **THEN** the app creates a new linked job using the same retry path used by the CLI
- **AND** the original job remains inspectable

#### Scenario: Desktop chat retry is not generic
- **WHEN** a `source=desktop` job is failed, canceled, or interrupted
- **THEN** the app keeps the job inspectable
- **AND** generic job retry is disabled or redirected to the linked chat
- **AND** the system does not append a duplicate chat message or create an orphan desktop job from the generic retry action

### Requirement: Desktop Reconnect Behavior
The desktop app SHALL recover job visibility after renderer reloads, app restarts, or CLI/daemon-created work.

#### Scenario: Renderer reloads while job runs
- **WHEN** the renderer reloads while a job is running
- **THEN** the app reloads job metadata from SQLite
- **AND** resumes event display from persisted event sequence numbers

#### Scenario: App starts after interrupted job
- **WHEN** the app starts and finds interrupted jobs
- **THEN** the overview shows them as interrupted
- **AND** exposes retry or resume only when supported

### Requirement: Desktop Jobs Use Verified Runtime Context
Desktop chat jobs SHALL be created from verified desktop runtime preflight context.

#### Scenario: Desktop chat job starts
- **WHEN** a Claude or Codex desktop chat run creates a `source=desktop` job
- **THEN** the job uses the same verified project, chat, sub-chat, cwd, runtime, mode, and prompt preview that will be passed to runtime setup
- **AND** job creation does not allow runtime startup to continue with a different raw renderer-supplied cwd or sub-chat

#### Scenario: Preflight fails before job is running
- **WHEN** desktop runtime preflight rejects the project, chat, sub-chat, cwd, provider, MCP, attachment, or local-only state
- **THEN** no provider work starts
- **AND** the job is either not created or is persisted as failed with a renderer-safe preflight diagnostic

### Requirement: Desktop Jobs Persist Semantic Runtime Events
Desktop chat jobs SHALL persist sanitized committed semantic events for Workbench
replay through the shared ledger. Desktop projection SHALL read committed item state
and sequence without reconstructing a second fact chain from provider chunks.

#### Scenario: Desktop stream emits semantic events
- **WHEN** the fake Claude/Codex desktop job fixture `desktop-projection.json` delivers
  committed assistant/tool/guard/question/MCP/usage/status/error/completed records
- **THEN** the Workbench persisted-event reader and live renderer projector receive
  those record sequences and semantic metadata without a raw chunk list
- **AND** the renderer uses the fixture's item_reconciliation record to replace that
  item's view instead of concatenating its final text again

#### Scenario: Secret-like payload is observed
- **WHEN** `desktop-projection.json` contains already-redacted runtime diagnostics,
  MCP and provider metadata and a sentinel raw input available only to ingress
- **THEN** the desktop writer and renderer receive the committed redacted record only;
  neither projection is passed the raw sentinel input or exact secret hints
- **AND** ledger_version=1 replay uses record sequence directly; the single versioned
  Workbench decoder unwraps ledger_version=0 historical desktop rows only, preserving
  their semantic display without restoring a live wrapper writer

### Requirement: Desktop Consumes Read Only Runtime Route Projection

Desktop transport selection SHALL consume safe main-process catalog descriptors
stamped as transportId on the binding read model already returned by chat queries
and createSubChat, without adding a listRoutes procedure. Both existing transport-creation sites SHALL use
the same read-state-based createRuntimeRouteTransport helper, without a runtimeId-to-transport
table in the renderer or a default-Claude fallback. Existing chat IPC request,
stream and cancel envelopes SHALL remain unchanged. Runtime event state SHALL
continue through the existing shared event-state owner. Adding a route plus adapter
package and its own main chat router/transport through static compiled maps SHALL
NOT require a new central main dispatch branch (catalog-owned runtime-to-adapter-factory,
transport or readiness selection: the R points). The retained admit gates,
assertDesktopRuntime and P28 provider ternary (including its Claude default)
remain main-side runtime-keyed edits for a real third Runtime. The renderer SHALL only consume
read-only projections; this does not promise zero renderer switch edits for new
wire families or approval dispatch. Runtime-neutral chat/approval IPC and the
remaining third-Runtime integration belong to Interactive Runs and conformance.
Main read-model composition SHALL use withRuntimeRouteTransportId(binding, catalog?)
to stamp the renderer catalog projection without persisting transportId or adding a
runtimeId-to-transportId mapping outside the catalog. A failure-state catalog SHALL
omit transportId. Renderer read errors SHALL be explicit failures without caching a failed Chat.

#### Scenario: S18 Both renderer entry points consume the binding descriptor
- **GIVEN** `tests/fixtures/runtime-route-catalog/renderer.json#S18` with both chat-query/createSubChat binding read models, recording constructors, unknown transportId, descriptor-not-loaded, absent-field and read-error variants, plus source fixtures for both active-chat construction sites
- **WHEN** unit tests call createRuntimeRouteTransport with {state:"loaded",transportId:string}, {state:"not-loaded"} or {state:"error"} and renderer-route-projection-bypass scans both active-chat construction sites and their chat-query/createSubChat state mapping
- **THEN** loaded known IDs return {ok:true,transport}, select only their compiled constructors and preserve baseline request envelopes; the guard proves both sites map loaded data with a field to loaded, loading/absent fields to not-loaded and query/read failures to error, call that helper without binding.runtime comparisons, and cache a Chat only on ok:true
- **AND** not-loaded, error and loaded-unknown-ID inputs return {ok:false,failure:"route_descriptor_unavailable"}, {ok:false,failure:"route_descriptor_error"} and {ok:false,failure:"unknown_transport"} respectively with zero constructor/subscription calls and no Claude fallback; guard mutations caching a Chat on ok:false fail, and a subsequent loaded-known-ID call succeeds for normal retry (React cache behavior is a source-guard oracle)

#### Scenario: S19 A fixture Runtime reuses an existing wire family without core edits
- **GIVEN** `tests/fixtures/runtime-route-catalog/renderer.json#S19` with an isolated validated catalog, fixture Runtime manifest/adapter and fixed-runtime main delegate test port, an existing wire-family transportId, and normalized question/guard/finish chunks
- **WHEN** resolveRuntimeRoute and createRuntimeRouteTransport consume its read-only descriptor, the guard scans src/renderer/features/agents/lib/runtime-route-transport.ts and runtime-event-state.ts for runtime-ID literals/branches, and tests call applyRuntimeEventStateChunk plus clearPendingUserQuestionForRuntimeChunk
- **THEN** the fixture delegate is selected without a main dispatch branch or helper map edit, the guard reports no runtime-ID branch, question chunks set the pending-question atom, guard chunks update the existing guard state, and finish clears the pending-question atom with baseline transitions
- **AND** production runtime IDs remain the existing two and renderer projection exposes no factory/credentials/raw union; this proves existing-wire-family consumption only, not new wire-family construction, UI display, approval dispatch or real third-Runtime admission

#### Scenario: S20 Job actions preserve exact desktop ownership
- **GIVEN** `tests/fixtures/runtime-route-catalog/desktop-actions.json#S20` with two successive desktop stream owners for one chat, an old job, an API job and a headless job
- **WHEN** Workbench cancels the old job and invokes existing retry/cancel actions for all sources after catalog wiring
- **THEN** the old job cannot cancel the new stream, desktop retry remains linked-chat-only and API retry remains CLI-API-only
- **AND** headless cancellation still uses its store owner, request/response envelopes match baseline and the catalog neither chooses a cancellation target nor mints a retry

#### Scenario: S53 Main stamps transport IDs only on the binding read model
- **GIVEN** `tests/fixtures/runtime-route-catalog/renderer.json#S53` with a temporary DB containing one claude-code and one codex subChat, a validated test catalog, its createRuntimeRouteCatalogForTests failure-state variant, and recording read-model composition ports
- **WHEN** the real chat-query and createSubChat binding compositions (src/main/lib/trpc/routers/chats-sub-chats.ts:107/:116) use NEW withRuntimeRouteTransportId(binding, catalog?) in src/main/lib/agent-runtime/runtime-route-read-model.ts with those catalog states, and the renderer-route-projection-bypass guard scans the main stamping call sites
- **THEN** each returned binding.transportId equals projectRuntimeRoutes("renderer", catalog)'s value for that runtime (claude-chat-ipc or codex-chat-ipc), while the persisted subChatBindings row/schema has no transportId column and its durable binding fields remain unchanged
- **AND** the real procedure leg uses the production module-singleton router (the existing chats-sub-chats.ts createCaller + db mock harness); the failure-state leg calls withRuntimeRouteTransportId directly
- **AND** a failure-state catalog produces a read model without transportId, whose mapped {state:"not-loaded"} input yields route_descriptor_unavailable in S18; the guard finds no runtimeId-to-transportId literal mapping in main outside the catalog, and a mutation adding such a mapping fails
