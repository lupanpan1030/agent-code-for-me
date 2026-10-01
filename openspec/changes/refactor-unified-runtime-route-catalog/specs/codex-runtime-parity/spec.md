## MODIFIED Requirements

### Requirement: Codex Runtime Parity Dependency
The system SHALL upgrade Codex parity on top of the shared `AgentRuntime` contract without blocking the headless jobs platform from shipping with honest capability states.

#### Scenario: Headless jobs depend on capability truth
<!-- Scenario register: S51; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/capabilities.json#S51` with Codex supported/degraded/unsupported canonical manifest states
- **WHEN** resolveRuntimeRoute and projectRuntimeRoutes consume that manifest and the CLI capability gate checks the same states
- **WHEN** headless jobs resolve Codex through the canonical runtime route catalog
- **THEN** Codex may report `supported`, `degraded`, or `unsupported` for each capability
- **AND** desktop and CLI callers gate behavior from those states
- **AND** this parity change owns the work to turn parity-owned Codex capabilities into `supported` behavior

#### Scenario: Parity claim is attempted without implementation
<!-- Scenario register: S52; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/capabilities.json#S52` with supported capability declarations and recording adapter enforcement ports
- **WHEN** the catalog-selected adapter conformance test exercises the actual enforcing port
- **WHEN** a Codex capability is marked `supported`
- **THEN** tests exercise the adapter or shared product layer that provides the behavior
- **AND** prompt-only instructions, UI labels, indexed documentation, or post-run audit alone do not satisfy the capability
