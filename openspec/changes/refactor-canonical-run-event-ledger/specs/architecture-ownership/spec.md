## MODIFIED Requirements

### Requirement: Canonical Runtime Event Mapping Single Path
The architecture guard SHALL statically enforce the canonical event owners and import
boundary. createRunEvent SHALL be defined only in agent-runtime/runtime-events.ts;
createCanonicalRunEventLedger in run-event-ledger.ts; getOrCreateRunEventLedger in
run-event-ledger-host.ts; projectRunEventToRendererChunks in stream-event-mapper.ts;
admitRunArtifactCandidate in run-artifacts.ts; redactRuntimePayload and
redactExactSecretHints in redaction.ts. These module paths are under src/main/lib/.
The exact store append export appendExactRunEventBatch SHALL exist only in
headless/job-store.ts, with a private record insert helper; its sole direct importer
SHALL be agent-runtime/run-event-ledger-host.ts. captureRunExecutionProvenance SHALL
be defined only in agent-runtime/run-provenance.ts; the ledger host SHALL be the only
composition path binding its tuple to a Run. The removed legacy exports and internal helpers
mapDesktopStreamChunkToRunEvents, createDesktopStreamEventMapper,
appendRunEventsToAgentJob, redactRendererDiagnosticChunk, redactRendererRuntimeChunk,
createRuntimeRendererChunkEmitter, createRuntimeStreamChunkSecretRedactor,
isDesktopRuntimeFailureChunk, persistedPayloadForRunEvent, createAgentJobRunEvent and
appendAgentJobEvent SHALL have no definitions, re-exports or call sites. Historical
ledger_version=0 decoding SHALL be confined to the single versioned Workbench reader;
it SHALL NOT restore a wrapper writer or a live legacy event path.
Direct inserts into agentJobEvents outside job-store SHALL also be rejected by the
static guard (including the schedules bypass). Static checks SHALL assert source
structure, not secret leakage or runtime outcomes.

#### Scenario: Second event mapping definition appears
- **WHEN** `architecture-fixtures.json` injects a duplicate definition or re-export of
  a pinned symbol outside its stated canonical module
- **THEN** the guard fails with the file/symbol and points to Ownership Map's Runtime
  Events, Trace, And Redaction section; the clean owner fixture passes

#### Scenario: Route or runtime adapter writes job events directly
- **WHEN** the fixture adds an appendExactRunEventBatch import in a route, Codex/Claude
  adapter, or any file except run-event-ledger-host.ts
- **THEN** the guard fails naming the file and required ledger host entry
- **AND** a legacy appendAgentJobEvent/createAgentJobRunEvent import or definition is
  also rejected, and job-store's record insert cannot be exported
- **AND** a schedules-style direct db.insert(agentJobEvents) outside the store is rejected

#### Scenario: Guard proves its own detection
- **WHEN** the guard scans clean, duplicate-definition, forbidden-import, exported-insert,
  direct-event-insert and legacy-symbol fixtures in `architecture-fixtures.json`
- **THEN** exact expected static findings are matched, and missing/unexpected findings
  fail the self-test; runtime fault/redaction/terminal behavior is tested in core instead
