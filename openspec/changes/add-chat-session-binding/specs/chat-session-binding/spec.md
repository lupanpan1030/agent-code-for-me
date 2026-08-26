## ADDED Requirements

### Requirement: Persistent Chat Session Binding Truth

The system SHALL persist each chat's session binding — runtime, provider profile, model,
model source, and thinking/effort level — in the main-process database as the single source of
truth, owned by the canonical chat-session-binding owner module, with exactly one binding row
per chat.

#### Scenario: Binding survives renderer storage reset

- **WHEN** a chat has run with a given runtime/model binding and the renderer's localStorage
  is cleared before the app restarts
- **THEN** reopening the chat restores the persisted runtime, model, model source, thinking
  level, and provider profile from the database
- **AND** the next send uses that persisted binding without re-inferring it from message
  metadata

#### Scenario: New chat seeds a binding row at creation

- **WHEN** a new chat is created
- **THEN** a binding row is created for it in the same creation flow, with the runtime taken
  from the creator's request
- **AND** the creator seeds the remaining binding fields from the user's stored new-chat
  defaults in the creation input; fields with no default remain unset rather than being
  invented in the database

#### Scenario: Forked chat copies the source binding

- **WHEN** a chat is forked
- **THEN** the fork receives its own binding row copied from the source chat's binding

#### Scenario: Provider-profile source stays consistent

- **WHEN** a binding is written with a provider-profile model source
- **THEN** the stored provider profile ID equals the profile named by the source
- **AND** a binding written with a non-profile source stores no provider profile ID

#### Scenario: Provider-profile selection snapshots its model

- **WHEN** the user explicitly selects a Provider Profile for a chat
- **THEN** the same binding write stores the profile source, profile ID, and the Profile's
  current default model as `modelId`
- **AND** later edits to that Profile's default model do not rebind the existing chat or
  change the model executed by its next send
- **AND** leaving the Profile writes the selected first-party source and model in one binding
  update rather than briefly exposing a mixed source/model pair

#### Scenario: Explicit Profile snapshots require current Profile authority

- **WHEN** a chat is created with, enters, or explicitly reselects a Provider Profile binding
- **THEN** the Profile exists and targets the selected runtime
- **AND** the requested `modelId` equals that Profile's current `defaultModel`
- **AND** an invalid or manufactured Profile/model tuple is rejected

#### Scenario: Fork preserves a historical Profile snapshot

- **WHEN** a chat with a Profile binding is forked after that Profile was edited or deleted
- **THEN** the fork copies the source chat's historical binding tuple without consulting the
  current Profile row

#### Scenario: Provider-profile reasoning capability is represented honestly

- **WHEN** a Codex binding uses a Provider Profile whose gateway capability declares only
  reasoning `none`
- **THEN** the binding stores `thinkingLevel = NULL`
- **AND** the renderer does not present a low/medium/high/xhigh effort selector for that
  binding
- **AND** the transport submits the profile's declared `none` reasoning mode rather than
  pretending that another effort is supported

### Requirement: Explicit Transport Binding Injection

Chat transports SHALL receive the session binding explicitly at construction from the
DB-backed chat data, and SHALL NOT read or write renderer binding stores during message
sending.

#### Scenario: Transport selection uses the persisted runtime

- **WHEN** the renderer constructs a transport for an existing chat
- **THEN** the transport type is selected from the persisted binding's runtime
- **AND** no message-metadata inference and no transport-instance back-inference participates
  in the selection

#### Scenario: Send-time reads come from the injected binding

- **WHEN** a message is sent on a chat
- **THEN** the model, model source, and provider profile submitted for the run come from the
  injected binding
- **AND** a Codex source that supports selectable effort receives the injected binding's
  thinking level
- **AND** a Provider Profile that declares only reasoning `none` receives `none` from that
  capability while its injected binding carries `thinkingLevel = NULL`
- **AND** an explicitly bound Provider Profile uses the binding's snapshotted `modelId`, not
  the Profile's mutable current default
- **AND** the transport performs no renderer-store write-back of normalized or diverted
  binding values

#### Scenario: Codex auth retry respects the bound source

- **WHEN** a first-party Codex binding receives an authentication error
- **THEN** a `chatgpt` binding becomes retry-ready only from a connected ChatGPT subscription
- **AND** an `openai-api-key` binding becomes retry-ready only from its app-managed API key
- **AND** a crossed unrelated credential triggers neither a doomed automatic retry nor a
  diagnostic that claims the wrong credential was rejected
- **AND** the pending retry records the required auth method, so a crossed login-modal success
  cannot unlock the retry
- **AND** the pending retry records the exact non-secret binding identity and is consumed only
  if that same binding is still current inside the per-chat gate
- **AND** a replacement transport retires an older transport generation, so a delayed
  credential probe cannot publish or resend the old prompt through a new source or Profile

#### Scenario: Binding update takes effect through the canonical mutation

- **WHEN** the user changes an existing chat's model, a thinking level supported by its
  current source, or (for an empty chat) runtime
- **THEN** the change is persisted through the chat-session-binding owner
- **AND** the chat's transport is reconstructed so the next send uses the updated binding
- **AND** if either Engine currently owns an active Run for the chat, main rejects every
  binding mutation, including same-runtime model/Profile/effort edits and runtime switches
- **AND** a mutation before active ownership remains governed by the Run candidate's final DB
  re-admission rather than introducing a second pending-run lock or durable lease

#### Scenario: Mutation receipt precedes same-ID transport recreation

- **WHEN** an existing chat binding is changed
- **THEN** the renderer waits for the canonical mutation receipt and publishes the returned
  binding before deleting the old transport
- **AND** the renderer explicitly creates the replacement Chat from that published DTO even if
  normal navigation unmounted the target view while the receipt was pending
- **AND** the same chat ID remounts with a binding-sensitive view key so a cached Chat object
  cannot survive the recreation
- **AND** direct sends, queued sends, initial regeneration, persisted stream resume, and the
  mutation are serialized through the same per-chat gate
- **AND** a direct submit captures its editor and attachment payload before awaiting the
  mutation that may unmount its input component
- **AND** send, regeneration, and resume resolve the current Chat and transport only after
  acquiring that gate, rather than invoking a callback captured from the replaced mount
- **AND** initial-message auto-generation has one claim outside the React mount lifecycle, so
  the pre-receipt and replacement mounts cannot execute the same persisted prompt twice
- **AND** normal parent-workspace pruning, resident-tab eviction, and detached-finish cleanup
  retain the Chat while one of those operations is pending, then recheck eviction after the
  final pending operation releases
- **AND** explicit tab close cancels pending UI work; a mutation that returns afterward does not
  recreate the Chat or send its captured payload, but a successful receipt still updates the
  canonical query/DTO cache so a later history reopen uses the committed binding
- **AND** if explicit close races a queue item that was already popped, both queue send paths
  drop the cancelled item instead of requeueing it after the close cleared the queue
- **AND** an outer current-Chat admission failure releases the exact initial-generation or
  resume claim so a later valid mount can retry

#### Scenario: Main admits a desktop Run against the current DB binding

- **WHEN** a renderer submits a desktop Run request
- **THEN** main reads the current binding before replacing or registering an active run
- **AND** if the binding changes during asynchronous preflight, main re-reads it and rejects the
  stale candidate before active-state replacement
- **AND** it rejects a stale, forged, or wrong-runtime source/profile/model/effort tuple
- **AND** rejection does not abort or replace an already active valid run
- **AND** startup consumes only the canonical values returned by admission

#### Scenario: Only the latest asynchronously admitted request may activate

- **WHEN** request A begins a slow preflight and a later request B completes preflight first
  for the same chat
- **THEN** B may activate and A becomes stale
- **AND** A cannot later abort, replace, or delete B's active state
- **AND** preflight does not publish a guarded contract before the winning claim
- **AND** late cleanup compare-deletes its exact guarded-contract owner rather than deleting a
  newer contract, and activation revokes every prior contract for that sub-chat regardless of
  renderer contract ID
- **AND** lifecycle cancellation, persistence, approval cleanup, and active-state deletion
  compare the exact installed Run owner rather than trusting an external `runId`
- **AND** every user, assistant, and error-history write rechecks that exact owner immediately
  before committing, and every nested asynchronous preparation or retry rechecks immediately
  before job creation or actual adapter/SDK dispatch
- **AND** stop and cleanup reach the exact subscription owner rather than a public mutation keyed
  only by sub-chat or external `runId`
- **AND** each pending question has a main-minted `approvalId` distinct from runtime `toolUseId`,
  so a stale response or timeout cannot approve, delete, or clear a newer Run's pending question
- **AND** renderer completion compare-deletes only that exact approval tuple after either an
  accepted or stale response, so question A cannot hide a newer question B
- **AND** an old Run cannot affect a newer Run even when both requests reuse the same external
  `runId`
- **AND** a guarded tool callback requires its exact captured contract to remain installed both
  before authorization, after asynchronous user approval, and before consuming a cached
  pre-tool decision, rather than consuming any newer contract
- **AND** the sole guarded-contract registry is keyed by sub-chat, never renderer contract ID,
  and no pre-admission prepare-and-publish compatibility path remains
- **AND** a Codex native allow response repeats exact Run and contract checks synchronously at
  the final child-write boundary and fails closed if either owner changed
- **AND** a later failed or cancelled candidate does not restore authority to an older pending
  request

#### Scenario: Claude run-scoped diversion is the only source exception

- **WHEN** an OAuth/custom-provider Claude binding cannot use OAuth and diverts for one run
- **THEN** main accepts only a valid Claude-targeted Provider Profile source with no forged
  bound model
- **AND** Profile existence and Claude target eligibility are checked again after asynchronous
  preflight and before active-state replacement
- **AND** the durable binding is unchanged
- **AND** unknown, blank, or malformed sources fail closed without reading OAuth credentials

#### Scenario: Persisted stream resume survives DTO naming and remount

- **WHEN** a persisted sub-chat DTO carries the Drizzle `streamId` field or the legacy
  `stream_id` spelling
- **THEN** the renderer resolves the same resume key and attempts that stream once
- **AND** a claim outlives the component mount, so duplicate remounts do not start a second resume
- **AND** a failed resume releases its claim so a later render can retry

#### Scenario: Native session provenance is main-owned

- **WHEN** a stale or forged renderer attempts to submit a Claude or Codex native `sessionId`
- **THEN** the chat input is rejected and no foreign, sibling, or stale native session is resumed
- **AND** Claude resume/parent identity is derived only from the main-owned sub-chat row
- **AND** Codex resume/parent identity is derived only from main-read persisted message history
- **AND** no renderer mutation exists that can rewrite `sub_chats.sessionId`

### Requirement: Process-Local Rollback Maintenance Exclusion

The main process SHALL own one exact, in-memory maintenance token per sub-chat plus exact
rollback-only blockers for claimed desktop Run lifecycles that have not settled, and SHALL use
them only to make destructive rollback mutually exclusive with an active/draining Run and with
the final claim of a new Claude or Codex desktop Run. This precursor SHALL NOT be represented as
durable SessionBinding lease state.

#### Scenario: An active Engine rejects rollback before maintenance

- **WHEN** `rollbackToMessage` is requested while either Claude or Codex owns an active Run for
  the sub-chat
- **THEN** rollback returns a structured conflict with
  `code = SESSION_BINDING_BUSY`, the exact `subChatId`, `operation = rollback`, that owner's
  exact external `activeRunId`, and `reason = active-run`
- **AND** no checkpoint, worktree, message-history, binding, or job state is changed

#### Scenario: Rollback maintenance rejects a new final Run claim

- **WHEN** rollback owns the sub-chat's maintenance token and a new Claude or Codex desktop Run
  reaches its final active-owner claim
- **THEN** the Run is rejected with `code = SESSION_BINDING_BUSY`, the exact `subChatId`,
  `operation = rollback`, `activeRunId = null`, and `reason = maintenance`
- **AND** it does not cancel, replace, queue behind, or dispatch through the active runtime
- **AND** the final maintenance check and active-owner installation are synchronous, so
  rollback cannot acquire between them

#### Scenario: Overlapping replacement Runs remain visible to rollback

- **WHEN** Run B replaces and aborts same-chat Run A, B settles before A's supervised lifecycle,
  and the single current-runtime owner entry becomes empty
- **THEN** B releases only its exact rollback blocker and rollback still returns
  `SESSION_BINDING_BUSY` with `reason = active-run` until A actually settles
- **AND** the result is identical when A and B share the same external Run ID or renderer reload
  cleanup clears the current-runtime registry
- **AND** A's blocker neither delays nor authorizes B and cannot exclude any Run from another Run

#### Scenario: A rollback winner reports BUSY to an earlier pending Run after release

- **WHEN** a desktop Run reserves its admission, rollback then acquires maintenance and
  invalidates that exact pending candidate, and rollback releases before the Run reaches its
  final claim
- **THEN** that exact Run still receives the structured `SESSION_BINDING_BUSY` maintenance
  conflict rather than an unclassified stale finish
- **AND** the one-shot rejection authority is process-local, is consumed only by that exact
  admission, and does not reclassify ordinary latest-request-wins candidates

#### Scenario: Exact maintenance ownership is always released

- **WHEN** rollback succeeds, returns a validation/application failure, or throws
- **THEN** its `finally` path releases only the exact maintenance token it acquired
- **AND** stale cleanup cannot release a newer token for the same sub-chat
- **AND** a later valid rollback or Run claim may proceed after the exact release

#### Scenario: Temporary fence remains non-durable and narrowly owned

- **WHEN** the fence is inspected or the main process restarts
- **THEN** its state exists only in
  `src/main/lib/agent-runtime/chat-maintenance-fence.ts` process memory and restart begins empty
- **AND** there is no schema column, database row, `agent_jobs` mutation, binding-row mutation,
  headless/job use, Run-versus-Run exclusion, execution authority, waiting, renewal, or recovery
  behavior for the fence or its rollback-only lifecycle blockers
- **AND** Phase 5's durable C4 SessionBinding lease MUST absorb or replace this exclusion rule
  and delete the temporary owner rather than retaining dual fences

### Requirement: Exact Rollback Checkpoint Authority

Rollback SHALL derive destructive authority only from main-minted persisted metadata that binds
one unique canonical checkpoint ref to its exact OID, and SHALL fail closed before touching Git
or history when that authority is unavailable or inconsistent.

#### Scenario: Same SDK UUID creates independent checkpoint authority

- **WHEN** Runs A and B publish rollback checkpoints for the same SDK message UUID
- **THEN** each receives a distinct main-minted `refs/locus-checkpoints/<uuid>` public ref and
  exact OID
- **AND** stale A cleanup compare-deletes only A's exact ref/OID and cannot alter B's checkpoint

#### Scenario: Publication failure records explicit unavailability

- **WHEN** a checkpoint draft cannot be published with compare-and-create semantics
- **THEN** the assistant metadata persists `rollbackCheckpointAvailable = false` without a
  rollback checkpoint ref or OID
- **AND** that message cannot authorize rollback

#### Scenario: Database failure retracts only the published checkpoint

- **WHEN** exact checkpoint publication succeeds but the message-history transaction throws
- **THEN** the exact published ref/OID is retracted with compare-delete
- **AND** the previous message row remains unchanged
- **AND** no other Run's checkpoint ref is removed

#### Scenario: Destructive rollback validates exact ref and OID first

- **WHEN** rollback metadata is missing, unavailable, malformed, names a missing/moved ref, or
  its resolved ref does not equal the recorded OID
- **THEN** rollback returns failure before `read-tree`, checkout, clean, or message truncation
- **AND** both the worktree and message history remain unchanged
- **AND** the ref-to-OID equality is checked again immediately before the checkpoint is applied

#### Scenario: Arbitrary message overwrite path is retired

- **WHEN** renderer callers inspect the internal chat tRPC surface
- **THEN** `updateSubChatMessages` is absent
- **AND** `rollbackToMessage` is the only renderer history-rewrite envelope and it remains
  subject to the maintenance fence and exact checkpoint validation above

### Requirement: Token-Scoped Provider Gateway Model Resolution

Provider gateway model decoding for desktop Chats SHALL be selected only by the
main-process-minted gateway token and SHALL remain isolated from legacy headless and Local Job
resolution.

#### Scenario: Codex chat token removes only the reserved reasoning suffix

- **WHEN** a desktop Codex Chat submits its snapshotted opaque Profile model followed by the
  Locus-reserved final `/none`
- **THEN** the `codex-chat-binding` token removes exactly that final suffix before forwarding
- **AND** any identical or slash-containing content inside the opaque model ID is preserved

#### Scenario: Codex model discovery uses the admitted historical snapshot

- **WHEN** a Codex chat is bound to Provider Profile model A and that Profile's current default
  is later edited to B
- **THEN** its `codex-chat-binding` token carries admitted model A without reserved `/none`
- **AND** authenticated `/models` advertises A rather than mutable default B
- **AND** the same token still forwards the chat request to A
- **AND** a different or malformed request-body model cannot make that token forward any model
  other than A

#### Scenario: Claude chat token preserves opaque models verbatim

- **WHEN** a desktop Claude Chat uses a `claude-chat-binding` token
- **THEN** the gateway forwards the binding's opaque model ID verbatim

#### Scenario: Request data cannot choose model resolution

- **WHEN** a client supplies body, header, or query values that claim another resolution mode
- **THEN** the gateway ignores them and applies only the mode embedded in its server-minted
  token

#### Scenario: Legacy headless resolution remains isolated

- **WHEN** an existing headless or Local Job Profile gateway is created without a desktop Chat
  mode
- **THEN** its token uses `legacy-profile-default`
- **AND** the headless owner does not read `sub_chat_bindings`
- **AND** the Local Job API schema and `agent_jobs` runtime/Profile admission snapshot are
  unchanged

### Requirement: Retired Message-Metadata Provider Inference

The system SHALL restrict provider/runtime inference from persisted message metadata to the
one-time binding backfill, and SHALL enforce this with an architecture guard.

#### Scenario: Backfill assigns runtime to legacy chats once

- **WHEN** the database migration adds binding storage and a pre-existing chat has no binding
  row
- **THEN** an idempotent startup backfill inserts a binding row whose runtime is inferred from
  that chat's persisted message metadata
- **AND** re-running the backfill does not modify existing binding rows

#### Scenario: Guard blocks new inference call sites

- **WHEN** the architecture guard runs
- **THEN** it fails if the message-metadata provider inference is referenced anywhere outside
  its defining shared module, the backfill owner module, and tests

### Requirement: Renderer Binding Stores Restricted To New-Chat Default Seeding

Renderer localStorage binding atoms SHALL serve only to seed defaults for newly created
chats; an existing chat's binding truth SHALL be read from the persisted database binding
only, and no renderer storage atom may carry per-chat runtime/model binding semantics.

#### Scenario: Existing chats read the persisted binding only

- **WHEN** a chat has a persisted binding and the renderer holds a different stored new-chat
  default
- **THEN** the persisted binding is used for display and for sending
- **AND** the renderer's stored defaults are not consulted for the existing chat

#### Scenario: Changing defaults does not rebind existing chats

- **WHEN** the user changes a new-chat default (runtime, model, source, or thinking level)
- **THEN** existing chats keep their persisted bindings unchanged
- **AND** only subsequently created chats are seeded from the new default

#### Scenario: Settings keep new-chat defaults source-compatible

- **WHEN** Profile save/delete/target/default state or app-managed API-key state changes
- **THEN** global new-chat source, model, and thinking defaults are updated as one compatible
  tuple
- **AND** an existing chat whose bound Profile becomes unavailable retains and displays that
  Profile source as unavailable until the user explicitly rebinds
- **AND** the UI does not present the chat as OAuth while main still enforces a Profile binding

#### Scenario: Guard bans binding-semantics storage atoms

- **WHEN** the architecture guard runs
- **THEN** it fails if any renderer storage atom carries per-chat runtime/model binding
  semantics
- **AND** it fails if any deleted per-chat binding atom family identifier reappears anywhere
  in the renderer or main source tree
- **AND** it fails if `sub_chat_bindings` is accessed outside the DB schema and canonical owner
