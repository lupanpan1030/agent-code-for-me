## ADDED Requirements

### Requirement: Desktop Consumes Read Only Runtime Route Projection

Desktop transport selection SHALL consume safe main-process catalog descriptors
stamped as transportId on the binding read model already returned by chat queries
and createSubChat, without adding a listRoutes procedure. Both existing transport-creation sites SHALL use
the same transportId-based construction helper, without a runtimeId-to-transport
table in the renderer or a default-Claude fallback. Existing chat IPC request,
stream and cancel envelopes SHALL remain unchanged. Runtime event state SHALL
continue through the existing shared event-state owner. Adding a route plus adapter
package and its own main chat router/transport through static compiled maps SHALL
NOT require a new central main dispatch branch. The renderer SHALL only consume
read-only projections; this does not promise zero renderer switch edits for new
wire families or approval dispatch. Runtime-neutral chat/approval IPC and the
remaining third-Runtime integration belong to Interactive Runs and conformance.

#### Scenario: S18 Both renderer entry points consume the binding descriptor
- **GIVEN** `tests/fixtures/runtime-route-catalog/renderer.json#S18` with both chat-query/createSubChat binding read models, recording constructors, unknown transportId, descriptor-not-loaded, absent-field and read-error variants, plus source fixtures for both active-chat construction sites
- **WHEN** unit tests call createRuntimeRouteTransport(binding.transportId) and the renderer-route-projection-bypass guard scans both construction sites
- **THEN** known IDs select only their compiled constructors and preserve baseline request envelopes; both sites call that helper with no binding.runtime comparison
- **AND** unavailable/not-loaded, read-error and unknown-ID cases expose route_descriptor_unavailable, route_descriptor_error and unknown_transport respectively in the internal UI failure result, with zero subscriptions and no cached failed Chat or Claude fallback; reloaded valid data permits normal retry

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
