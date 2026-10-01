## ADDED Requirements

### Requirement: Catalog Refactoring Preserves Public Run Semantics

Catalog adoption SHALL preserve Local Job API v1, including the archived async
submission surface, and jobs-stdio wire semantics. It SHALL preserve runtime,
provider, policy, lifecycle, event, error/exit, environment and artifact behavior
for existing inputs. New internal route errors SHALL use existing surface failure
envelopes rather than create public error codes or new exit values. The catalog
SHALL NOT become an admission, publication, cancellation or event owner.

#### Scenario: S21 Existing operations match frozen complete contract oracles
- **GIVEN** `tests/fixtures/runtime-route-catalog/public-contract.json#S21` with complete baseline stdout/stderr/exit oracles from source 6192b13f for agent and completion create, submit, wait-ready/timeout, keyed replay/conflict, retry sync/async, status, events-after/follow, result and cancel; IDs, clocks, worker identity, cwd and runtime outputs are fixed before execution
- **WHEN** the actual CLI handlers execute the same cases through the catalog with controlled providers
- **THEN** their complete envelopes, newlines, channels and exits match the frozen oracles without deleting fields or normalizing outputs after comparison
- **AND** event sequences and the twelve public types/six envelope fields remain unchanged; no catalog status/event or required extension is appended

#### Scenario: S23 Readiness does not claim a different executor environment
- **GIVEN** `tests/fixtures/runtime-route-catalog/readiness.json#S23` with distinct nonsecret native-home/PATH sentinels for submitter and daemon, baseline adapter allowlists and a recording no-probe discovery port
- **WHEN** the CLI lists runtimes and a daemon claims an API Run; separately a no-daemon wrapper executes its own Run
- **THEN** discovery still describes the CLI process, daemon execution uses the daemon's permitted environment and the wrapper uses its own, with unchanged secret stripping
- **AND** no environment snapshot is persisted or included in route metadata and no readiness query is represented as proof that the daemon can authenticate

#### Scenario: S24 Refusals retain surface-specific errors and exit codes
- **GIVEN** `tests/fixtures/runtime-route-catalog/errors.json#S24` with frozen parser/provider/capability/profile/claim-gate failures, malformed jobs-stdio requests, desktop adapter failures and recording execution ports
- **WHEN** each real surface handles its request through catalog wiring
- **THEN** the baseline stdout/stderr/errorCode/exit or JSON-RPC/desktop error envelope is preserved, including adapter-local exit 1 versus normalized unsupported_capability exit 3 and wait-only timeout exit 9
- **AND** unsafe cases call no provider; internal route failures do not leak a new public code, secret, factory or raw request

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
combinations, no executable function, local path, env, secret or internal
transport endpoint. Existing apiVersion, features, manifests, readiness and
their semantics SHALL remain unchanged. No new discovery feature or request
field SHALL be introduced by this addition. This requirement is the draft's
proposed Q1 scope and requires Owner approval before implementation.

#### Scenario: S22 Old discovery readers safely ignore optional summaries
- **GIVEN** `tests/fixtures/runtime-route-catalog/discovery.json#S22` with the baseline 6192b13f schema and executable old-reader fixture, the proposed optional schema, catalog-derived summaries and a pinned old response without routes
- **WHEN** actual runtimes-list output with routes is read by both readers and validated by both schemas, then the old response is read by the new reader
- **THEN** both schemas accept the new output, the old reader preserves identical common-core decisions and the new reader tolerates absent routes without treating existing features as unsupported
- **AND** the feature array remains exactly runtime-readiness/provider-binding/completion/canonical-run-ledger/async-submit, accepted public route summaries agree with actual catalog queries, and schemaRef values resolve in the published schema
