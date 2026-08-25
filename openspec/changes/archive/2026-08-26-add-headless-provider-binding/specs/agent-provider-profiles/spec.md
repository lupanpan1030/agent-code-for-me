## ADDED Requirements

### Requirement: Headless Default Provider Binding

The runtime-purpose provider defaults (`claude-main`, `codex-main`) SHALL be consumed by headless and scheduled runs as the default provider source only when the entire provider object is omitted, including the default's model override. A model-only provider object remains on native credentials. Desktop interactive runs keep their existing per-chat selection semantics; setting a headless default does not override first-party auth for runs that never resolve to it.

#### Scenario: Headless run uses the configured default

- **WHEN** a provider default is configured for the requested runtime's main purpose
- **AND** a headless run starts with the entire provider object omitted
- **THEN** the run resolves to the default profile and its model override

#### Scenario: No default means native credentials

- **WHEN** no provider default is configured for the runtime's main purpose
- **AND** a headless run starts with the entire provider object omitted
- **THEN** the run uses the runtime's native credentials

#### Scenario: Unusable default fails closed

- **WHEN** the configured default references a profile that is missing or cannot be resolved
- **THEN** the headless run fails with a structured provider error naming the default as the source
- **AND** the error hints at fixing or clearing the configured default
