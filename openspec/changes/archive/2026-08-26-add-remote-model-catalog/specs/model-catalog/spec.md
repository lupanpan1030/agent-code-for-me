## ADDED Requirements

### Requirement: Remote Model Catalog With Built-In Floor

The system SHALL maintain a built-in model catalog as the always-available
floor and SHALL overlay a remotely fetched, schema-validated catalog manifest
that can add models, update display metadata, and mark models deprecated
without an application rebuild. The remote catalog SHALL NOT remove built-in
models, and any fetch, validation, or cache failure SHALL result in the
built-in (or last-good cached) catalog with no user-facing error.

#### Scenario: New model published in the manifest

- **WHEN** the hosted manifest adds a model id for a runtime and the app
  refreshes its catalog
- **THEN** the model appears in that runtime's picker without an app update
- **AND** selecting it sends the id to the runtime verbatim

#### Scenario: Manifest is unreachable or invalid

- **WHEN** the catalog fetch fails, times out, or fails schema validation
- **THEN** the pickers show the last-good cached catalog, or the built-in
  catalog when no cache exists
- **AND** no error is surfaced beyond diagnostics

#### Scenario: Local-only mode forbids hosted calls

- **WHEN** the local-only cloud guard is active
- **THEN** no catalog network request is made
- **AND** the built-in catalog is used

### Requirement: Model Id Pass-Through And Custom Models

The system SHALL treat model selection as advisory rather than an allowlist:
renderer transports SHALL NOT rewrite an unknown persisted model id to a
default, and each first-party picker SHALL offer a validated free-text custom
model entry whose id reaches the runtime request verbatim.

#### Scenario: User enters a custom model id

- **WHEN** the user enters a custom model id that passes charset and length
  validation
- **THEN** the id is persisted for that source and sent to the runtime
  verbatim

#### Scenario: Persisted id is no longer in the catalog

- **WHEN** a persisted selection references an id absent from the current
  catalog (removed remotely, deprecated, or custom)
- **THEN** the selection still renders and is sent verbatim rather than being
  silently replaced with a default

### Requirement: Live Provider Model List Reuse

The system SHALL parse the model list already returned by the OpenAI API-key
validation probe and SHALL surface ids not present in the merged catalog as an
additional picker group for the API-key source, without additional network
calls.

#### Scenario: API-key user sees live models

- **WHEN** an OpenAI API key has been validated and the active Codex source is
  the API key
- **THEN** model ids from the probe response absent from the merged catalog
  are listed in a distinct "available via your API key" group

#### Scenario: Probe response is malformed

- **WHEN** the probe response body cannot be parsed
- **THEN** key validation behaves exactly as before
- **AND** no live-model group is shown
