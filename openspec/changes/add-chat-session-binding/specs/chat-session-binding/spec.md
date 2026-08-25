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
- **THEN** the model, model source, thinking level, and provider profile submitted for the run
  come from the injected binding
- **AND** the transport performs no renderer-store write-back of normalized or diverted
  binding values

#### Scenario: Binding update takes effect through the canonical mutation

- **WHEN** the user changes an existing chat's model, thinking level, or (for an empty chat)
  runtime
- **THEN** the change is persisted through the chat-session-binding owner
- **AND** the chat's transport is reconstructed so the next send uses the updated binding

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

#### Scenario: Guard bans binding-semantics storage atoms

- **WHEN** the architecture guard runs
- **THEN** it fails if any renderer storage atom carries per-chat runtime/model binding
  semantics
- **AND** it fails if any deleted per-chat binding atom family identifier reappears anywhere
  in the renderer or main source tree
