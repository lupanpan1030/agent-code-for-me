## ADDED Requirements

### Requirement: Headless Provider Binding

Headless job execution SHALL build provider bindings in the main process from stored profiles and deliver them to runtime adapters only as loopback gateway endpoints with per-run scoped tokens. Provider secrets MUST NOT appear in CLI arguments, job events, structured output, or the create request, and per-run gateway tokens MUST be revoked when the job reaches any terminal state.

#### Scenario: Profile-bound headless run reaches the runtime

- **WHEN** a headless job resolves to a provider profile
- **THEN** the main process resolves the profile and synthesizes a scoped gateway endpoint for that run
- **AND** the runtime child receives only the loopback endpoint and scoped token through its environment or runtime configuration
- **AND** the upstream credential is injected only by the gateway when forwarding

#### Scenario: Gateway token is revoked at job end

- **WHEN** a profile-bound headless job succeeds, fails, or is canceled
- **THEN** the run's scoped gateway token is revoked
- **AND** a long-lived worker process does not accumulate live tokens across jobs

#### Scenario: Binding failure fails closed

- **WHEN** the profile token cannot be resolved or the local gateway cannot be prepared for a profile-bound run
- **THEN** the job fails with a structured provider error
- **AND** the runtime child is not started with direct upstream credentials as a fallback

#### Scenario: Codex profile overrides carry no secrets

- **WHEN** a headless codex run is bound to a provider profile through CLI configuration overrides
- **THEN** the overrides reference the gateway token by environment variable name only
- **AND** persisted job records and events contain no token values
