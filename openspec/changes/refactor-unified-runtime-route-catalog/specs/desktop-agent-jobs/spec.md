## ADDED Requirements

### Requirement: Desktop Consumes Read Only Runtime Route Projection

Desktop transport selection SHALL consume safe main-process catalog descriptors
for the canonical chat binding. Both existing transport-creation sites SHALL use
the same transportId-based construction helper, without a runtimeId-to-transport
table in the renderer or a default-Claude fallback. Existing chat IPC request,
stream and cancel envelopes SHALL remain unchanged. Runtime event state SHALL
continue through the existing shared event-state owner; a new adapter package
SHALL NOT require a new Engine switch or core state-machine branch.

#### Scenario: S18 Both renderer entry points consume the main descriptor
- **GIVEN** `tests/fixtures/runtime-route-catalog/renderer.json#S18` with existing-chat and new-chat entry points, descriptors for both existing transports and an unknown transportId variant
- **WHEN** each entry point constructs its transport using the read-only projection and recording transport factories
- **THEN** both call the same helper, select only the descriptor's compiled transport factory, preserve the original binding and emit baseline chat request envelopes
- **AND** the unknown variant returns a safe failure with no subscription; neither entry point branches on runtimeId or silently chooses Claude

#### Scenario: S19 A fixture Runtime requires no renderer core modification
- **GIVEN** `tests/fixtures/runtime-route-catalog/renderer.json#S19` with an isolated test catalog, a fixture-only third Runtime manifest/adapter package using a common transport and a fixed hash of the production renderer dispatcher/event-state source
- **WHEN** only the fixture declaration and adapter package are registered and normalized question/guard/finish chunks are consumed
- **THEN** the fixture route can be enumerated, resolved and displayed by the unchanged helper/event-state owner with the expected common state transitions
- **AND** source hashes stay unchanged, production runtime IDs stay limited to the existing two, and no main factory/credential/raw vendor union is exposed to renderer code

#### Scenario: S20 Job actions preserve exact desktop ownership
- **GIVEN** `tests/fixtures/runtime-route-catalog/desktop-actions.json#S20` with two successive desktop stream owners for one chat, an old job, an API job and a headless job
- **WHEN** Workbench cancels the old job and invokes existing retry/cancel actions for all sources after catalog wiring
- **THEN** the old job cannot cancel the new stream, desktop retry remains linked-chat-only and API retry remains CLI-API-only
- **AND** headless cancellation still uses its store owner, request/response envelopes match baseline and the catalog neither chooses a cancellation target nor mints a retry
