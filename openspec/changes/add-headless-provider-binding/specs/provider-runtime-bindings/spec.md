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

### Requirement: Run-Scoped Exact Provider Secret Redaction

The system SHALL keep both the selected upstream provider credential and the per-run scoped gateway token as main-process-only exact secret hints from provider resolution until terminal output is materialized. Renderer chunks, durable events, assistant messages, diagnostics, structured results, and public API envelopes SHALL pass through the canonical run-scoped redaction path before exposure or persistence. Exact hints themselves MUST NOT enter output, metadata, logs, or durable state.

#### Scenario: Successful runtime output echoes either provider secret

- **WHEN** a profile-bound runtime or tool successfully returns text containing the upstream credential or scoped gateway token
- **THEN** every renderer, durable, diagnostic, structured-result, and Local Job API projection contains only a redacted placeholder
- **AND** public provider-binding receipts contain references and applied model metadata, never secret hints or secret values

#### Scenario: Runtime splits a secret across adjacent stream chunks

- **WHEN** adjacent chunks in one runtime output channel concatenate to the upstream credential or scoped gateway token
- **THEN** the stateful run-scoped redaction path withholds the possible secret prefix until it can decide safely
- **AND** no individual renderer chunk, durable event, or reconstructed message exposes the exact secret

#### Scenario: Provider startup fails before binding completes

- **WHEN** provider or gateway startup fails with an error that contains the selected upstream credential or scoped gateway token
- **THEN** the failure detail is redacted before diagnostics, events, messages, job storage, or public output receive it

#### Scenario: Run reaches a terminal path

- **WHEN** a profile-bound run succeeds, fails, is canceled, or is unsubscribed
- **THEN** pending sanitized output is finalized before the exact hints are discarded
- **AND** the scoped gateway token is revoked without persisting either secret
