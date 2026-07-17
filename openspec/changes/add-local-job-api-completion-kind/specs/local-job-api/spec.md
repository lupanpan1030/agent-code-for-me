## ADDED Requirements

### Requirement: Completion Job Kind

The Local Job API SHALL support a completion job kind for single-shot, non-agentic LLM calls, selectable via a `kind` field that defaults to the agent kind so existing consumers are unaffected. A completion job SHALL execute exactly one upstream model request with no tools, no filesystem access, no worktree, and no runtime child process, and SHALL return the generated content. Completion support SHALL be feature-detectable through the discovery `features` array.

#### Scenario: Consumer requests a completion

- **WHEN** a create request sets the completion kind with a provider selection and a messages array
- **THEN** Locus executes a single upstream model call through the resolved provider
- **AND** returns the generated content and token usage in the result envelope
- **AND** no tool, command, or filesystem events are recorded for the job

#### Scenario: Consumer requests structured JSON output

- **WHEN** a completion request includes a `responseFormat` of type json_schema with a caller-supplied schema
- **THEN** Locus maps the schema to the provider's native structured-output mechanism
- **AND** returns content that parses against the caller's schema
- **AND** rejects the request when the resolved provider protocol cannot enforce structured output, rather than returning unchecked text

#### Scenario: Default kind stays agent

- **WHEN** a create request omits the kind field
- **THEN** it is treated as an agent job exactly as before

#### Scenario: Completion rejects agent-only fields

- **WHEN** a completion request includes agent-only fields such as a working directory, mode, requested capabilities, policy grant, or artifacts
- **THEN** the request is rejected with a structured validation error before a job is created

#### Scenario: Consumer detects completion support

- **WHEN** a consumer reads the discovery envelope
- **THEN** `features` contains `completion` on builds that support the completion kind
- **AND** consumers targeting older builds treat the completion kind as unsupported

### Requirement: Consumer-Neutral Completion Contract

The completion contract and its implementation SHALL remain general-purpose and free of any downstream-consumer-specific vocabulary, schema, or branching. A `responseFormat` schema supplied by a caller SHALL be treated as opaque — Locus validates the returned shape against it but assigns no domain meaning to it, and Locus behavior SHALL NOT depend on which consumer is calling.

#### Scenario: Arbitrary caller schema is honored generically

- **WHEN** two different consumers submit completions with entirely different response schemas
- **THEN** Locus handles both through the same generic code path with no consumer-specific logic
- **AND** neither schema's field names appear in Locus code, tests, or contract

#### Scenario: Consumer identity does not change behavior

- **WHEN** the same completion request is submitted under different consumer ids
- **THEN** the resolution, execution, and result semantics are identical
- **AND** the consumer id is used only for attribution, not for behavior

### Requirement: Completion Provider Requirement

A completion job SHALL require an explicit provider profile reference (`provider.profileId`) because it has no native agent runtime to fall back to, and SHALL fail closed with a structured error when the referenced profile is missing, targets a different runtime family, or cannot be resolved. Completion SHALL NOT fall back to native runtime credentials or to the agent-runtime purpose defaults. Provider selection SHALL remain reference-only with no plaintext credentials crossing the API, and the result SHALL echo the applied provider without secret material.

#### Scenario: Completion without an explicit profile

- **WHEN** a completion request omits `provider.profileId`
- **THEN** the request is rejected with a structured provider error before a job is created
- **AND** no upstream call is made and no job runs on native credentials

#### Scenario: Completion references an unusable profile

- **WHEN** a completion request references a profile that does not exist, targets a different runtime family, or whose token cannot be resolved
- **THEN** the request fails closed with a structured provider error
- **AND** no upstream call is made

#### Scenario: Completion echoes the applied provider

- **WHEN** a completion job completes
- **THEN** the result envelope reports the applied provider source, profile id, and model without secrets

### Requirement: Completion Usage Accounting

Completion jobs SHALL record upstream token usage so that a consumer's completion spend is attributable through the consumer metadata already carried on every API job. Usage SHALL be reported in the completion result envelope, and durable usage events SHALL use a usage event type that the Local Job API event stream exposes without downgrading it to a generic status event.

#### Scenario: Usage is recorded per job

- **WHEN** a completion job finishes a successful upstream call
- **THEN** input and output token usage are reported in the result envelope and persisted as a durable usage event
- **AND** the usage is attributable to the requesting consumer

#### Scenario: Usage event survives the public event stream

- **WHEN** a consumer reads a completion job's events through the Local Job API
- **THEN** the usage event is exposed with a usage-specific type rather than being downgraded to a generic status event

#### Scenario: Failed completion records no phantom usage

- **WHEN** a completion job's upstream call fails before returning usage
- **THEN** the job fails with a structured error
- **AND** no fabricated token usage is recorded
