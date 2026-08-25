## ADDED Requirements

### Requirement: Provider Selection by Reference

The Local Job API SHALL accept an optional provider selection on create requests as references only — a stored provider profile id and/or a model identifier — and SHALL reject requests whose provider selection cannot be honored instead of silently degrading. The result envelope SHALL echo the provider selection that actually applied.

#### Scenario: Consumer selects a stored profile

- **WHEN** a create request includes `provider.profileId` referencing a stored profile whose target runtimes include the requested runtime
- **THEN** the job runs through that profile via the local provider gateway
- **AND** the result envelope reports the applied profile reference and model

#### Scenario: Unknown or mismatched profile fails closed

- **WHEN** a create request references a profile that does not exist, or whose target runtimes exclude the requested runtime
- **THEN** the request is rejected with a structured error code before a job record is created
- **AND** the job does not silently fall back to native credentials

#### Scenario: Provider block carries only references

- **WHEN** a create request's provider block contains any key other than the documented reference fields, or secret-like values
- **THEN** the request is rejected with a sanitized validation error

#### Scenario: Present provider block is empty

- **WHEN** a create request includes a provider block without a non-empty `profileId` or `model`, including nullable fields
- **THEN** the request is rejected as invalid
- **AND** only omission of the entire provider property can select the configured-default path

#### Scenario: Consumer detects provider-binding support

- **WHEN** a consumer reads the discovery envelope
- **THEN** `features` contains `provider-binding` on builds that honor the provider block
- **AND** consumers targeting older builds treat the field as unsupported rather than assuming it was honored

#### Scenario: Result echoes the applied provider

- **WHEN** any API-created job completes
- **THEN** the result envelope includes the applied provider source (request profile, default profile, or native) without secret material
