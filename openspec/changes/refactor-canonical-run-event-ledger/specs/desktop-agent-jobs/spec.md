## MODIFIED Requirements

### Requirement: Desktop Jobs Persist Semantic Runtime Events
Desktop chat jobs SHALL persist sanitized semantic runtime events for later Workbench replay.

Every desktop Run SHALL send JSON-RPC responses, notifications, server requests,
server-response-send/resolved boundary facts, runtime exits, and repair inputs to
the one main-process canonical Run ledger owner. The desktop transport, Codex
mapper, transcript persistence, and job store SHALL NOT independently allocate a
second sequence or construct a competing semantic event chain.

#### Scenario: Desktop stream emits semantic events
- **WHEN** a desktop Claude or Codex run emits assistant, tool, guard, question, MCP, usage, status, error, cancellation, or completion events
- **THEN** the system persists ordered job events with stable sequence numbers and sanitized payloads
- **AND** raw provider chunks are not required to reconstruct the Workbench timeline
- **AND** a Bun acceptance test can create the public canonical-ledger seam with
  a deterministic clock and in-memory persistence sink, submit the trace §9
  `[EVENT-01]`, `[EVENT-02]`, and `[EVENT-03]` response/notification/server-request
  probe shapes plus server-response-send and resolved boundary facts, and read
  the resulting persisted desktop job events
- **AND** the test asserts one strictly increasing canonical `sequence` domain,
  no default empty projection for an ingested method, and no second terminal or
  persistence-assigned sequence
- **AND** server request and resolution records expose only an
  `interaction_boundary` status fact; the durable Interaction state machine is
  not implemented by this requirement

#### Scenario: Secret-like payload is observed
- **WHEN** runtime events, diagnostics, MCP payloads, provider metadata, or error messages include secret-like values
- **THEN** the values are redacted before the event is persisted or emitted to the renderer
- **AND** a Bun fixture injects API-key-shaped strings in native identity,
  diagnostics, tool output, MCP/OAuth metadata, and artifact candidate metadata
  at the canonical-ledger ingestion seam
- **AND** the fixture also splits exact provider and gateway secret hints across
  adjacent assistant/reasoning/tool fragments and the terminal flush boundary
- **AND** the persisted job events and renderer-facing projection contain the
  same redaction marker and no plaintext fixture secret or concatenable leaked
  prefix
- **AND** `threadId` and `sessionId`, when independently present after
  redaction, remain distinct optional identity fields and neither is copied into
  the other as a fallback

#### Scenario: Desktop item deltas are reconciled with the final snapshot
- **WHEN** a Bun test feeds separate assistant and reasoning item fixtures with
  `started`, repeated or out-of-order `delta` records, and `completed` snapshots
  through the canonical-ledger item ingestion functions
- **THEN** the persisted Workbench events expose one reconciled item lifecycle
  in canonical sequence order
- **AND** the authoritative completed snapshot is used to detect duplication or
  missing text without appending the same assistant or reasoning text twice
- **AND** an unresolved gap is represented by stable loss/reconciliation
  metadata rather than silently returning a plausible but incomplete transcript

#### Scenario: Desktop Run reaches a terminal boundary
- **WHEN** a Bun fixture drives a normal finish, retryable error then finish,
  denial, interrupt, and definitive transport-exit case through the
  canonical-ledger seam
- **THEN** every fixture persists exactly one terminal `completed` event
- **AND** retryable `error` records preserve `willRetry` and remain diagnostic
- **AND** a transport-exit terminal is marked synthetic with provenance
- **AND** denial or rejected/required-output-empty Runs are not persisted as an
  unqualified success
- **AND** events accepted after the terminal barrier cannot mutate the persisted
  terminal outcome

#### Scenario: Desktop resume is repaired from a native snapshot
- **WHEN** a Bun fixture restores a desktop Codex Run from a native thread or
  rollout snapshot through the ledger repair entry point
- **THEN** newly emitted records carry `repair.source=snapshot`,
  `lossPossible: true`, and reconciliation-result metadata
- **AND** the restored provider snapshot is not labeled as replayed event
  history
- **AND** Workbench resumes solely from the last canonical ledger sequence
