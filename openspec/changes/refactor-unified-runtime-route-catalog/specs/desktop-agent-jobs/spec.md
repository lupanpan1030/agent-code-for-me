## ADDED Requirements

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
