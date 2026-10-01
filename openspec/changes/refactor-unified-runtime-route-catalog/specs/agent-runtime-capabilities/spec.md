## ADDED Requirements

### Requirement: Route Capability And Readiness References

Catalog entries SHALL reference `src/shared/agent-runtime-capabilities.ts` for
capability truth and `src/main/lib/headless/runtime-readiness.ts` for existing
readiness probes, without defining new capability states, credential precedence
or a second probe cache. Runtime-wide support SHALL NOT imply support on every
adapter. Required-capability checks SHALL preserve adapter enforcement constraints
and consume the existing Runtime Capability Projection owner where that kind has
a registered projection adapter. Readiness SHALL remain advisory and distinct
from executable admission and concrete-capability availability.

#### Scenario: S10 Capability truth is referenced rather than copied
- **GIVEN** `tests/fixtures/runtime-route-catalog/capabilities.json#S10` with canonical manifests, supported/degraded/unsupported requirements and a manifest change injected through the capability-owner test port
- **WHEN** resolveRuntimeRoute and toLocalJobApiRuntimeManifestEnvelope (through its runtimeRouteCatalog test option) read the same manifestRef supplied by the getAgentRuntimeCapabilityManifest owner port
- **THEN** the resolver rejects unmet required capabilities with canonical states/reasons, while the discovery envelope reports the same manifest states/reasons without creating an admission gate or independent support table
- **AND** changing the returned projection does not mutate manifest truth; a supported desktop capability does not override a headless adapter's enforcement limitation

#### Scenario: S11 Readiness selects the existing probe without becoming admission
- **GIVEN** `tests/fixtures/runtime-route-catalog/readiness.json#S11` with good/bad/absent default profiles, Claude native credential cases, Codex cached/expired/skipped/failing probes and a fake clock plus missing-route and completion-null-probe variants
- **WHEN** `probeRuntimeRouteReadiness` composes the registered probe, including --no-probe and repeated queries around the existing 30000 ms cache expiry
- **THEN** good default skips native probing, bad default reports unavailable without native fallback, absent default follows native order, skipped subprocess probes and exceptions report unknown, and cache behavior matches baseline; missing route/probe returns unknown, never ready
- **AND** discovery never spawns an agent turn or blocks an independently valid explicit-profile admission merely because advisory readiness is unknown or needs-auth

#### Scenario: S12 Concrete projection availability is not guessed from the route
- **GIVEN** `tests/fixtures/runtime-route-catalog/capabilities.json#S12` with an installed capability whose registered projection owner reports unavailable and a separate kind with no projection adapter
- **WHEN** resolveRuntimeRoute checks eligibility and RuntimeCapabilityProjectionService.project checks the registered kind/runtime pair
- **THEN** the unavailable projected capability is excluded or rejected through its existing owner, even when the route exists and class capability is supported
- **AND** the unregistered kind returns registered=false and records=[] with no fabricated projection record or stub; route discovery never labels install state as verified usability

### Requirement: Route Runtime Extension Declarations

Runtime-native metadata exposed by a route SHALL reference a namespaced versioned
schema `runtime.<id>.v1`, schemaVersion, maturity and canonical redaction owner.
The existing `runtime.codex.v1` extension SHALL retain its existing schema and
producer. A catalog declaration SHALL NOT publish raw vendor unions, mint events
or alter common lifecycle semantics. Unknown optional extensions SHALL remain
ignorable; unsupported internal required extensions SHALL fail closed. This
requirement SHALL NOT add a requiredExtensions request field to Local Job API v1.

#### Scenario: S13 Optional and required extensions are distinguished
- **GIVEN** `tests/fixtures/runtime-route-catalog/extensions.json#S13` with the existing Codex schema reference, an unknown optional reader extension, an unknown required internal query extension and malformed namespace/schema variants, batch/ completion producers with no extensions and the Codex app-server producer
- **WHEN** validateRuntimeRouteCatalog, resolveRuntimeRoute, projectRuntimeRoutes("public", catalog), the actual ledger extension producer and the fixture-only discovery-reader-before.ts common-core reader run
- **THEN** the valid existing extension retains schemaVersion 1 and experimental maturity, the reader ignores the optional unknown namespace, and the required unknown query fails with unsupported_required_extension before any factory call
- **AND** public batch/completion summaries have extensions=[] and Codex app-server policy-grant advertises only runtime.codex.v1 as supported by the actual producer; malformed declarations are invalid; no v1 parser field, public event type or capability support claim is added
