## ADDED Requirements

### Requirement: Runtime Route Catalog Single Owner

The architecture guard SHALL pin production runtime/adapter/transport route
declarations and selection to `src/main/lib/agent-runtime/runtime-route-catalog.ts`.
Adapters, tRPC/CLI/protocol surfaces and renderer consumers SHALL NOT introduce
their own runtime-keyed dispatch table or runtimeId branch selecting factories
or transports. The existing headless selector, registry facade, desktop factory,
runtime-specific selection wrappers and renderer Engine branches SHALL be
deleted or replaced atomically, with no old-path export or feature flag.
OWNERSHIP_MAP SHALL name the new owner and remove superseded selection ownership.
Existing ledger/host, submission/pump, artifact, capability, provider, policy,
projection and renderer event-state owners SHALL retain their semantics.

#### Scenario: S26 Duplicate routing is detected through direct and aliased forms
- **GIVEN** `tests/fixtures/runtime-route-catalog/architecture-fixtures.json#S26` with negative sources containing if/switch on runtimeId, a runtime-keyed factory map, aliased/namespace retired-selector calls and a one-hop wrapper outside the owner
- **WHEN** the architecture scanner runs each mutation and its self-test
- **THEN** each variant reports its exact source file, symbol and required catalog owner, and missing or unexpected findings fail the self-test
- **AND** the guard does not claim coverage of arbitrary reflection or unbounded transitive calls

#### Scenario: S27 All retired selectors and callers are absent
- **GIVEN** `tests/fixtures/runtime-route-catalog/architecture-fixtures.json#S27` listing P01/P06–P12/P14/P15/P18/P23 deletion sites and retired modules/symbols from design D5, plus fixtures restoring each one
- **WHEN** the final production tree and each restored-source variant are scanned
- **THEN** the real tree has no retired selection owner, forwarding alias or renderer runtime fallback and every restored variant fails
- **AND** desktop ledger status helpers and pump lifecycle functions remain available in their original owners

#### Scenario: S28 Catalog imports preserve runtime core direction
- **GIVEN** `tests/fixtures/runtime-route-catalog/architecture-fixtures.json#S28` with clean lazy factory/probe references and mutations importing Electron, tRPC, renderer, preload, a route through a wrapper, or a readiness-to-catalog recursion
- **WHEN** import and catalog-composition guards run
- **THEN** clean references pass and each forbidden dependency or cycle is rejected without widening existing architecture baselines
- **AND** the catalog cannot reverse-import a router to execute a Run or use renderer transport code in main

#### Scenario: S29 Adjacent legitimate owners are not banned as routing duplicates
- **GIVEN** `tests/fixtures/runtime-route-catalog/architecture-fixtures.json#S29` with positive fixtures for provider target/purpose mapping, policy mode checks, source-based job cancel, command/method parsing, native protocol decoding, selected-route assertions, transportId-only factory construction and chunk.type event state
- **WHEN** the new guard and existing owner guards scan these fixtures
- **THEN** each permitted fixture passes, but a paired mutation that uses runtimeId to choose a second adapter fails
- **AND** the exceptions are structural and symbol-specific, never a whole-adapter-directory allowlist

#### Scenario: S30 Catalog composition cannot create another business core
- **GIVEN** `tests/fixtures/runtime-route-catalog/architecture-fixtures.json#S30` with mutations that insert jobs/events, claim queued jobs, allocate sequence, settle terminal, prepare artifacts or read/decrypt provider storage inside the catalog, and a clean selection-only version
- **WHEN** the architecture guards and recording-port integration harness run
- **THEN** each mutation is rejected with the existing canonical owner, the clean version passes, and real API/stdio execution reaches submitRun and pumpQueuedRuns without a second dispatch loop
- **AND** route configuration has no production migration flag capable of re-enabling an old selector
