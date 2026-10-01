## ADDED Requirements

### Requirement: Catalog Refactoring Preserves Public Run Semantics

Catalog adoption SHALL preserve Local Job API v1, including the archived async
submission surface, and jobs-stdio wire semantics. It SHALL preserve runtime,
provider, policy, lifecycle, event, error/exit, environment and artifact behavior
for existing inputs. New internal route errors SHALL use existing surface failure
envelopes rather than create public error codes or new exit values. The catalog
SHALL NOT become an admission, publication, cancellation or event owner.

#### Scenario: S21 Existing operations match frozen complete contract oracles
- **GIVEN** `tests/fixtures/runtime-route-catalog/public-contract.json#S21` with runtimeRouteCatalog host options using recording leaf ports (fake runner and options.runner bypass disabled), named claude-policy-grant/fail-closed cases, an internal interactive-refusal event harness, and complete baseline stdout/stderr/exit oracles from source 6192b13f for agent and completion create, submit, wait-ready/timeout, keyed replay/conflict, retry sync/async, status, events-after/follow, result and cancel; IDs, clocks, worker identity, cwd and runtime outputs are fixed before execution
- **WHEN** the actual CLI handlers execute the accepted surface cases through the catalog with controlled providers and runAgentTask separately emits the internal interactive-refusal event oracle
- **THEN** their complete envelopes, newlines, channels and exits match the frozen oracles without deleting fields or normalizing outputs after comparison
- **AND** event sequences and the twelve public types/six envelope fields remain unchanged; runtime_selected has exactly status/runtime/label/source/adapterSource/executionProfile/fallbackReason plus policyGrantScopeBinding only for the baseline grant case; runtime_selection_refused has exactly status/runtime/source/adapterSource/executionProfile/reason/message/errorCode (src/main/lib/headless/agent-runtime.ts:17–42). No routeId/transportId/internal reason/new status/event or required extension is appended

#### Scenario: S23 Readiness does not claim a different executor environment
- **GIVEN** `tests/fixtures/runtime-route-catalog/readiness.json#S23` with distinct nonsecret native-home/PATH sentinels for submitter and daemon, baseline adapter allowlists and a recording no-probe discovery port
- **WHEN** the CLI lists runtimes and a daemon claims an API Run; separately a no-daemon wrapper executes its own Run
- **THEN** discovery still describes the CLI process, daemon execution uses the daemon's permitted environment and the wrapper uses its own, with unchanged secret stripping
- **AND** no environment snapshot is persisted or included in route metadata and no readiness query is represented as proof that the daemon can authenticate

#### Scenario: S24 Refusals retain surface-specific errors and exit codes
- **GIVEN** `tests/fixtures/runtime-route-catalog/errors.json#S24` with runtimeRouteCatalog recording ports (no fake/injected runner bypass), named claude-policy-grant/fail-closed/internal-interactive variants, frozen parser/provider/capability/profile/claim-gate failures, malformed jobs-stdio requests, desktop adapter failures and recording execution ports
- **WHEN** each real surface handles its request through catalog wiring
- **THEN** the baseline stdout/stderr/errorCode/exit or JSON-RPC/desktop error envelope is preserved, including adapter-local exit 1 versus normalized unsupported_capability exit 3 and wait-only timeout exit 9
- **AND** selection/leaf refusals perform no native provider work; runner-level goldens preserve prior provider binding/recordResolvedProvider ordering. runtime_selected/runtime_selection_refused exact key sets match S21; no catalog reason appears in errorCode, events or stdout. A synthetic post-binding lookup fault maps through job-runner.ts:820–836 to runtime_error/1; API/schedule regex messages and stdio verbatim -32602 messages stay unchanged (cli-dispatcher.ts:1513/:1686; jobs-stdio.ts:407–411)

#### Scenario: S25 Artifact and ledger residuals are not bypassed by route availability
- **GIVEN** `tests/fixtures/runtime-route-catalog/artifacts.json#S25` with an available route, an injected win32 stable-directory refusal and a separately committed terminal with incomplete registered-file publication
- **WHEN** API admission and wait execute using the existing artifact/host owners
- **THEN** the artifact-bearing admission follows the baseline failed/artifact_admission_failed behavior without path-only fallback, and incomplete publication remains non-ready under the existing wait owner
- **AND** the catalog performs no artifact read/write, event insertion, publication repair or additional terminal settlement

### Requirement: Optional Public Route Discovery Summary

The existing `locus api runtimes list --json` envelope MAY additionally expose
`runtimes[].routes` as an optional read-only array derived from the canonical
catalog. Each summary SHALL contain routeId, public entry surface, kind,
executionProfile, adapterSource, descriptive transport and versioned extension
schema references. It SHALL expose only currently accepted API/protocol
combinations for surface=api; protocol routes SHALL be omitted because jobs-stdio
initialize owns that contract. It SHALL expose no executable function, local path, env, secret or internal
transport endpoint. Existing apiVersion, features, manifests, readiness and
their semantics SHALL remain unchanged. No new discovery feature or request
field SHALL be introduced by this addition. The routes block SHALL be documented
as experimental. routeId, surface, adapterSource and transport SHALL be open
descriptive strings with documented known values; routeId SHALL be non-identity
and not stable across versions. Consumers SHALL NOT select behavior by
adapterSource or transport. Per-route extensions SHALL match actual producers;
batch and completion routes expose none. The public summary schema SHALL use
additionalProperties:false with exact keys routeId/surface/kind/executionProfile/
adapterSource/transport/extensions; extension objects have exactly namespace/
schemaVersion/maturity/schemaRef. Typed projections SHALL be separate per audience.

#### Scenario: S22 Old discovery readers safely ignore optional summaries
- **GIVEN** `tests/fixtures/runtime-route-catalog/discovery.json#S22` with the baseline 6192b13f schema and executable old-reader fixture, the proposed optional schema, catalog-derived summaries a pinned old response without routes, unknown open-string values and attempted transportId/factory/private-path field leaks
- **WHEN** actual runtimes-list output with routes is read by both readers and validated by both schemas, then the old response is read by the new reader
- **THEN** both schemas accept the new output, the old reader preserves identical common-core decisions and the new reader tolerates absent routes without treating existing features as unsupported
- **AND** the feature array remains exactly runtime-readiness/provider-binding/completion/canonical-run-ledger/async-submit, accepted public route summaries agree with actual catalog queries, schemaRef values resolve in the published schema, batch/completion extensions=[] and app-server policy-grant extension declarations agree with the real producer
- **AND** unknown descriptive values do not change old-reader common-core decisions; exact public/extension key sets match the schema and additionalProperties:false rejects leaked internal fields even though the old schema tolerates optional additions
