## MODIFIED Requirements

### Requirement: Codex Runtime Parity Dependency
The system SHALL upgrade Codex parity on top of the shared `AgentRuntime` contract without blocking the headless jobs platform from shipping with honest capability states.

#### Scenario: Headless jobs depend on capability truth
<!-- Scenario register: S51; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/capabilities.json#S51` with Codex supported/degraded/unsupported canonical manifest states
- **WHEN** headless jobs resolve Codex through resolveRuntimeRoute and projectRuntimeRoutes while desktop/CLI capability gates check the same canonical states
- **THEN** the projected states equal the canonical supported/degraded/unsupported fixture states
- **AND** caller gates return the fixture availability/diagnostics and call no unsupported capability port
- **AND** the parity change owns the work to turn parity-owned Codex capabilities into supported behavior.
<!-- governance-only clause; not test-registered. -->

#### Scenario: Parity claim is attempted without implementation
<!-- Scenario register: S52; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/capabilities.json#S52` with supported capability declarations and recording adapter enforcement ports
- **WHEN** a Codex capability is marked supported and the catalog-selected adapter conformance test exercises the actual enforcing port
- **THEN** recording ports observe the fixture operation/result from the actual adapter or shared product layer
- **AND** variants containing only prompt instructions, UI labels, indexed documentation or post-run audit produce no enforcing-port call and fail the supported-capability conformance assertion
