## ADDED Requirements

### Requirement: Headless Provider Selection

Headless one-shot runs and schedules SHALL support selecting a stored provider profile and/or model by reference. An explicit profile SHALL use that profile; a model-only provider selection SHALL use native credentials; only omission of the entire provider selection SHALL consult configured provider defaults before native credentials. An explicit or defaults-sourced profile that cannot be used SHALL fail the run with a structured error rather than silently falling back.

#### Scenario: CLI run selects a profile and model

- **WHEN** the user runs `locus run` with a provider profile flag and optional model flag
- **THEN** the run executes through the referenced profile via the local provider gateway
- **AND** an explicit model flag overrides the profile's default model

#### Scenario: No selection falls back to defaults, then native

- **WHEN** a headless run starts with the entire provider selection omitted
- **THEN** the configured provider default for the runtime's purpose applies when present, including its model override
- **AND** the runtime's native credentials apply when no default is configured

#### Scenario: Model-only selection on native credentials

- **WHEN** a headless run specifies a model but no profile
- **THEN** the run uses native credentials with the requested model

#### Scenario: Schedule persists its provider selection

- **WHEN** a schedule is created with a provider selection
- **THEN** the selection is persisted with the schedule and copied to each triggered job
- **AND** a triggered or retried job whose referenced profile no longer exists fails with a structured provider error instead of running on native credentials
