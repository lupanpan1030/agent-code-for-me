## ADDED Requirements

### Requirement: Runtime Route Catalog Single Owner

The architecture guard SHALL pin production runtime/adapter/transport route
declarations and selection to `src/main/lib/agent-runtime/runtime-route-catalog.ts`.
Adapters, tRPC/CLI/protocol surfaces and renderer consumers SHALL NOT introduce
their own catalog-covered runtime-keyed dispatch table or runtimeId branch selecting factories
or transports. The existing headless selector, registry facade, desktop factory,
runtime-specific selection wrappers and the two renderer transport-construction Engine branches SHALL be
deleted or replaced atomically, with no old-path export or feature flag.
OWNERSHIP_MAP SHALL name the new owner and remove superseded selection ownership.
Existing ledger/host, submission/pump, artifact, capability, provider, policy,
projection and renderer event-state owners SHALL retain their semantics.
Named existing approval dispatch, UI defaults/accounting/MCP, binding allowlists
and alias interpretation remain adjacent owners; these are not claims of complete
third-Runtime integration. Direct fixed-runtime leaf execution SHALL NOT bypass
the catalog: run/create exports from headless/adapters and the Codex/Claude
adapter runners SHALL be value-importable only by the catalog and tests.
The guard SHALL accept --runtime-route-catalog-fixtures=<path>, defaulting to
tests/fixtures/runtime-route-catalog/architecture-fixtures.json, and compare exact
{rule,file,symbol,owner,ownerSection} tuples. ownerSection SHALL be
"Runtime Route Catalog Single Owner". Its summary SHALL be
"Runtime route catalog guard self-test: <matched>/<cases> fixture cases matched; repository ownership enforced."
Existing ledger and async guard self-test output/flags SHALL remain unchanged.

#### Scenario: S26 Duplicate routing is detected through direct and aliased forms
- **GIVEN** `tests/fixtures/runtime-route-catalog/architecture-fixtures.json#S26` with negative sources containing if/switch on runtimeId, a runtime-keyed factory map, aliased/namespace retired-selector calls and a one-hop wrapper outside the owner, and a fixed-runtime direct leaf run/create import and call
- **WHEN** the architecture scanner runs --runtime-route-catalog-fixtures=tests/fixtures/runtime-route-catalog/architecture-fixtures.json against S26 cases (including route-dispatch-outside-owner, retired-route-selector and leaf-adapter-import-outside-catalog)
- **THEN** each variant reports its exact rule/file/symbol/owner/ownerSection tuple, and missing or unexpected findings fail the self-test
- **AND** the guard does not claim coverage of arbitrary reflection or unbounded transitive calls

#### Scenario: S27 All retired selector symbols and transport branches are absent
- **GIVEN** `tests/fixtures/runtime-route-catalog/architecture-fixtures.json#S27` restoring headless/adapter-selector.ts, agent-runtime/runtime-registry.ts, getAgentRuntimeAdapter/selectAgentRuntimeAdapter/SelectAgentRuntimeAdapterOptions/preferredAdapterSource exports, DesktopRuntimeAdapterFactory, resolveCodexDesktopAdapterSelection, resolveCodexAppServerDesktopAdapter, resolveClaudeAgentSdkDesktopAdapter, forwarding aliases, or either original active-chat transport runtime branch
- **WHEN** the architecture guard scans the production tree and each restored-symbol/branch fixture with retired-route-selector or renderer-route-projection-bypass
- **THEN** the production tree has no retired symbol/branch and each mutation yields its exact expected finding tuple
- **AND** desktop ledger helpers, adapter-local assertions and pump kind dispatch remain; real desktop/query/probe rewiring is proved by S03/S11/S16 spies, not by restoring legitimate pump/router functions and requiring a static failure

#### Scenario: S28 Catalog imports preserve runtime core direction
- **GIVEN** `tests/fixtures/runtime-route-catalog/architecture-fixtures.json#S28` with clean lazy factory/probe references and mutations importing Electron, tRPC, renderer, preload, a route through a wrapper, or a readiness-to-catalog recursion
- **WHEN** import and catalog-composition guards run
- **THEN** clean references pass and each forbidden dependency or cycle is rejected without widening existing architecture baselines
- **AND** the catalog cannot reverse-import a router to execute a Run or use renderer transport code in main

#### Scenario: S29 Adjacent legitimate owners are not banned as routing duplicates
- **GIVEN** `tests/fixtures/runtime-route-catalog/architecture-fixtures.json#S29` with positive fixtures for provider target/purpose mapping, policy mode checks, source-based job cancel, command/method parsing, native protocol decoding, selected-route assertions, transportId-only factory construction, chunk.type event state, codex-app-server.ts:49 runtime/profile/bounded-scope assertions, chat-session-binding admit gates and provider target, desktop allowlist, active-chat new-binding/token/MCP branches (:346/:2513/:5866) and approval dispatch (:2678), runtime-manifest aliases, job-runner resolveRunner ENV/injected runner seam and API-only source/profile gate, plus pump job.kind dispatch
- **WHEN** the new guard and existing owner guards scan these fixtures
- **THEN** each permitted fixture passes, but a paired mutation that uses runtimeId to choose a second adapter fails
- **AND** the exceptions are structural and symbol-specific, never a whole-adapter-directory allowlist

#### Scenario: S30 Catalog composition cannot create another business core
- **GIVEN** `tests/fixtures/runtime-route-catalog/architecture-fixtures.json#S30` with mutations that insert jobs/events, claim queued jobs, allocate sequence, settle terminal, prepare artifacts, read/decrypt provider storage, read process.env/fs/config, construct a production second catalog or supply a non-forwarded production runtimeRouteCatalog option, and a clean selection-only version
- **WHEN** the architecture guards and recording-port integration harness run
- **THEN** each mutation is rejected with the existing canonical owner, the clean version passes, and real API/stdio execution reaches submitRun and pumpQueuedRuns without a second dispatch loop
- **AND** route configuration has no production migration flag capable of re-enabling an old selector and the catalog reads no process.env/fs/config; the separately retained job-runner fake-runner seam is not used to prove catalog behavior

## MODIFIED Requirements

### Requirement: Runtime Execution Boundary Ownership
The system SHALL keep runtime request shape, adapter selection, permission
policy, event normalization, redaction, and persistence boundaries in canonical
runtime owners rather than duplicating those rules in routes, transports, or
headless adapters.

#### Scenario: Adapter selection changes
<!-- Scenario register: S48; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/architecture-fixtures.json#S48` with positive catalog declarations and a negative route-local runtime dispatch
- **WHEN** the route-dispatch-outside-owner scanner reports exact finding tuples
- **WHEN** a change adds, removes, or selects between batch, SDK, app-server,
  or future runtime adapter sources
- **THEN** the change updates the canonical runtime route catalog in
  `src/main/lib/agent-runtime/runtime-route-catalog.ts`
- **AND** route, CLI, protocol, and Local Job API code do not derive a second
  durable adapter-selection truth table
- **AND** the positive declaration yields zero findings and the route-local mutation yields its exact route-dispatch-outside-owner tuple

#### Scenario: Runtime events cross surfaces
<!-- Scenario register: S49; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/routes.json#S49` with desktop/headless runtimeRouteCatalog recording ports and the real ledger/redaction serializer harness
- **WHEN** the hosts execute a run and the harness compares committed/redacted records with projected envelopes
- **WHEN** a desktop or headless runtime emits events that are persisted or
  exposed to renderer, CLI, protocol, or Local Job API callers
- **THEN** the events pass through the canonical runtime event and redaction
  owners before persistence or external exposure
- **AND** surface-specific envelopes may map those events without owning a
  second event vocabulary
- **AND** serialized envelopes equal the fixture baseline, including redaction and event ordering, with no catalog-created event

#### Scenario: Temporary dual execution path is required
<!-- Scenario register: S50; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/architecture-fixtures.json#S50` with restored-selector and dual-path flag source mutations
- **WHEN** retired-route-selector and route-catalog-test-port-in-production scan the fixtures
- **WHEN** a migration temporarily keeps old headless batch behavior and a new
  shared runtime execution path
- **THEN** the change declares the canonical owner, migration gate, deletion
  condition or follow-up, and tests proving which path is active
- **AND** callers cannot silently choose between old and new behavior without
  that gate
- **AND** the runtime route catalog cutover uses no temporary dual path; both source mutations are rejected by their exact expected findings
