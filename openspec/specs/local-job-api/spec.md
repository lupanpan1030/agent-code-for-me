# local-job-api Specification

## Purpose
Defines the stable local-first contract for downstream applications to create,
observe, control, and read results from Locus-managed local agent jobs without
importing Locus source, reading SQLite directly, or passing provider secrets.

## Requirements

### Requirement: Machine-Readable Local Job API
The system SHALL provide a versioned Local Job API v1 for downstream local
consumers to create, inspect, cancel, retry, and read results for Locus jobs
without importing Locus source or reading Locus SQLite directly.

#### Scenario: Consumer creates API job
- **WHEN** a downstream consumer submits a valid `locus.local-job.v1` create
  request through `locus api runs create`
- **THEN** Locus creates a durable `source=api` local job
- **AND** persists sanitized consumer metadata, cwd, runtime, mode, prompt
  preview, artifact base, and timestamps
- **AND** returns a v1 JSON response containing the created job ID and status
- **AND** starts runtime work only after request validation and capability
  checks pass

#### Scenario: Consumer avoids internal database access
- **WHEN** a downstream consumer needs job status, events, result, cancellation,
  or retry
- **THEN** the consumer can use `locus api` commands for those operations
- **AND** the consumer does not need to read `agents.db` directly
- **AND** the response shape remains versioned with
  `apiVersion: locus.local-job.v1`

### Requirement: Runtime Capability Gate
The Local Job API SHALL validate requested runtime capabilities before provider
work starts.

#### Scenario: Runtime capabilities are listed
- **WHEN** a consumer runs `locus api runtimes list --json`
- **THEN** Locus returns registered runtime manifests with capability IDs,
  states, scopes, reasons, and remediation hints
- **AND** no provider secrets, OAuth tokens, raw headers, or plaintext
  credential values are included

#### Scenario: Required capability is unavailable
- **WHEN** a create request declares a required capability that the selected
  runtime reports as `degraded` or `unsupported`
- **THEN** Locus rejects the request or creates a failed job before provider
  work starts according to the documented API policy
- **AND** returns a normalized unsupported-capability diagnostic
- **AND** does not silently switch runtimes

### Requirement: Stable API Event Stream
The Local Job API SHALL expose stable v1 job events that are safe for downstream
consumers to parse.

#### Scenario: Consumer reads events
- **WHEN** a consumer runs `locus api runs events <job-id> --after <sequence>`
- **THEN** Locus returns events in increasing sequence order
- **AND** each event has `apiVersion`, `jobId`, `sequence`, `type`,
  `createdAt`, and sanitized `payload`
- **AND** consumers can resume event reads by passing the last seen sequence

#### Scenario: Consumer follows events
- **WHEN** a consumer runs `locus api runs events <job-id> --follow --jsonl`
- **THEN** stdout contains one JSON event envelope per line
- **AND** diagnostics and non-event messages are written to stderr
- **AND** the command exits after a terminal job status unless interrupted

### Requirement: Run Result and Artifact Manifest
The Local Job API SHALL produce a stable result envelope and run-owned artifact
manifest for API-created jobs.

#### Scenario: API job completes
- **WHEN** an API-created job reaches succeeded, failed, canceled, or
  interrupted status
- **THEN** Locus can return a v1 result envelope with job status, runtime, mode,
  consumer metadata, diagnostics, artifact manifest location, and artifact
  entries
- **AND** the result envelope does not include provider secrets, OAuth tokens,
  raw headers, or plaintext credential material

#### Scenario: Run artifact directory is configured
- **WHEN** a create request includes an artifact base directory
- **THEN** Locus writes run-owned metadata under `<artifactBaseDir>/<jobId>/`
- **AND** writes sanitized `request.json`, `events.jsonl`, `result.json`, and
  `artifacts.json`
- **AND** records the artifact manifest path on the job
- **AND** does not write downstream `final/` materials as part of API execution

### Requirement: Consumer Metadata Visibility
The desktop Workbench SHALL display API-created jobs with renderer-safe
consumer and artifact metadata.

#### Scenario: User opens Workbench with API job
- **WHEN** a `source=api` job exists
- **THEN** the Workbench identifies the job as API-created
- **AND** shows consumer ID, optional external run ID, runtime, mode, status,
  cwd, and artifact path/manifest when present
- **AND** uses the existing job log/detail surfaces for event history
- **AND** does not show provider tokens, raw request payloads, or secret-like
  metadata

### Requirement: Local-First and Secret Boundaries
The Local Job API SHALL preserve Locus local-first credential and execution
boundaries.

#### Scenario: Request contains secret-like fields
- **WHEN** a create request contains provider tokens, OAuth tokens,
  authorization headers, raw env values, API keys, passwords, or secret-like
  field names/values
- **THEN** Locus rejects the request before creating runnable provider work
- **AND** reports a sanitized validation error

#### Scenario: Runtime credentials are needed
- **WHEN** a runtime needs provider credentials for an API-created run
- **THEN** Locus resolves credentials through existing main-process provider
  profile or runtime setup paths
- **AND** the downstream consumer does not pass plaintext credential material
  over the API

### Requirement: Local Job API Project Onboarding
The Local Job API SHALL let a headless consumer register, inspect, remove from the active list, and restore a local project workspace through versioned `locus api projects` commands backed by a single shared project lifecycle owner, without using the desktop Workbench.

#### Scenario: Consumer registers a workspace
- **WHEN** a consumer runs `locus api projects register --cwd <path> --json`
- **THEN** Locus canonicalizes the path, verifies it exists and is a directory,
  and registers it as a Locus project through the shared lifecycle owner that
  the desktop `projects` router also uses
- **AND** returns a `locus.local-job.v1` JSON envelope with the project ID, name,
  canonical path, and active/removed lifecycle state
- **AND** registration does not require a git remote and does not accept provider
  tokens, OAuth tokens, headers, env values, or other secret-like fields

#### Scenario: Re-registering an active workspace is idempotent
- **WHEN** a consumer runs `locus api projects register --cwd <path> --json` for a
  path that is already active
- **THEN** Locus returns the existing project envelope with a success status
- **AND** does not create a duplicate project

#### Scenario: Re-registering a removed workspace restores it
- **WHEN** a consumer runs `locus api projects register --cwd <path> --json` for a
  canonical path that belongs to a removed project
- **THEN** Locus restores the existing project through the shared lifecycle owner
- **AND** clears the removed state
- **AND** returns the original project ID with retained history still linked

#### Scenario: Consumer checks workspace registration
- **WHEN** a consumer runs `locus api projects status --cwd <path> --json`
- **THEN** Locus reports whether the cwd resolves to a project record and, when
  it does, the owning project ID, name, canonical path, and active/removed state
- **AND** the command does not mutate registration state

#### Scenario: Consumer removes a workspace from the active list
- **WHEN** a consumer runs `locus api projects unregister --cwd <path> --json`
- **THEN** Locus removes the project from the active project list through the
  shared lifecycle owner and returns a versioned JSON envelope describing the
  removed project
- **AND** chats, sub-chats, worktrees, job history, and repository files are not
  deleted by default
- **AND** Locus refuses to remove a project that has active queued or running
  jobs unless `--force` is provided, reporting what would be affected
- **AND** `--force` only affects active-list removal and does not perform
  destructive project-history deletion

#### Scenario: Destructive project history deletion is not a headless command
- **WHEN** a consumer inspects or invokes Local Job API project commands in this
  lifecycle change
- **THEN** Locus does not expose a `projects delete-history` command
- **AND** permanent project-history deletion remains a desktop UI action with
  count-based confirmation

#### Scenario: Registration owner is shared, not duplicated
- **WHEN** project lifecycle logic is changed
- **THEN** both the desktop `projects` router and the headless `api projects`
  commands use the same shared lifecycle owner
- **AND** the headless commands do not maintain a second registration, removal,
  restore, or history-deletion code path

### Requirement: Local Job API Structured Registration Errors
The Local Job API SHALL report an unregistered project workspace through a stable
structured error code instead of requiring consumers to match human-readable
error text.

#### Scenario: Create targets an unregistered cwd
- **WHEN** a consumer runs `locus api runs create` with a cwd that is not inside
  any registered project
- **THEN** Locus rejects the request before provider work starts with a stable
  error envelope whose code is `project_not_registered`
- **AND** the consumer can branch on that code without parsing English stderr
- **AND** the command exit code preserves the existing invalid-cwd value

#### Scenario: Status reports a missing registration
- **WHEN** a consumer runs `locus api projects status --cwd <path> --json` for a
  cwd that is not inside any registered project
- **THEN** Locus returns a success-shaped envelope indicating the cwd is not
  registered, or a stable `project_not_registered` error envelope, per the
  documented status contract
- **AND** the response does not depend on consumers matching error message text

#### Scenario: Error envelope preserves the secret boundary
- **WHEN** Locus returns a registration error or a project onboarding envelope
- **THEN** the payload includes only the canonical path and registration
  metadata
- **AND** does not include provider tokens, OAuth tokens, raw headers, env
  values, or other secret-like material

### Requirement: Local Job API Runtime Trace Compatibility
The Local Job API SHALL preserve its stable v1 event and result envelopes while
the internal runtime event vocabulary converges on canonical `RunEvent` records.

#### Scenario: V1 consumer reads converged events
- **WHEN** a `locus.local-job.v1` consumer reads events for a job produced
  through the converged runtime event bridge
- **THEN** Locus returns the documented v1 event envelope with `apiVersion`,
  `jobId`, `sequence`, `type`, `createdAt`, and sanitized `payload`
- **AND** the consumer is not required to parse raw `RunEvent` fields

#### Scenario: Rich runtime data is unavailable in v1
- **WHEN** a canonical runtime event contains details that v1 does not expose as
  stable contract fields
- **THEN** Locus either maps those details into an existing sanitized v1 payload
  or omits them from v1 output
- **AND** introducing new rich interaction callbacks requires a separate Local
  Job API v2 or internal contract proposal

### Requirement: Local Job API Execution Profile Gate
The Local Job API SHALL keep existing v1 jobs on the safe default execution
profile unless a request is explicitly allowed to use another adapter profile.

#### Scenario: V1 request omits execution profile
- **WHEN** a valid v1 create request does not declare an approved non-batch
  execution profile
- **THEN** Locus runs the job through the default batch-compatible selector path
  when runtime capabilities and permission policy allow it
- **AND** existing consumers do not silently move to desktop/app-server
  execution semantics

#### Scenario: Requested profile needs interaction
- **WHEN** a Local Job API request asks for an adapter profile that requires
  user approval, AskUserQuestion, MCP elicitation, or unknown side-effect
  approval
- **AND** the request lacks an approved policy grant or interactive channel
- **THEN** Locus rejects or fails the run before provider work starts
- **AND** reports a sanitized unsupported-profile or fail-closed diagnostic

#### Scenario: Policy grant scopes are admission and audit metadata
- **WHEN** a Local Job API v1 request explicitly asks for `policy-grant`
  execution and supplies `runtime.policyGrant.scopes`
- **THEN** Locus may select an app-server-capable adapter only after validating
  the grant before provider work starts
- **AND** the v1 scope strings are treated as admission and audit metadata
  unless a later approved scope-enforcement change binds those strings to
  adapter permission decisions
- **AND** existing v1 callers that omit `runtime.executionProfile` continue to
  use the default batch selector path

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

### Requirement: Runtime Readiness Discovery

The runtime discovery response SHALL include a per-runtime readiness object describing whether a provider-omitted headless execution path has a usable credential/configuration, with states `ready`, `needs-auth`, `unavailable`, and `unknown`. Readiness MUST follow the same configured-default-provider-then-native resolution order the headless run would actually use, MUST be advisory (job creation is not blocked by advertised state), and MUST NOT contain secret material. A configured default that cannot be strictly resolved or does not target the runtime MUST report `unavailable` without falling through to native credentials; only an absent default proceeds to native readiness.

#### Scenario: Configured default provider reports ready

- **WHEN** a consumer lists runtimes and the runtime has a strictly readable, target-compatible headless default provider profile
- **THEN** the runtime entry reports `readiness.state` of `ready`
- **AND** native login probes are not required for that result

#### Scenario: Unusable configured default fails closed

- **WHEN** a configured headless default is missing, malformed, undecryptable, or targets another runtime
- **THEN** the runtime entry reports `readiness.state` of `unavailable`
- **AND** discovery does not report native credentials as a fallback route

#### Scenario: No default uses native readiness

- **WHEN** no headless default provider profile is configured for the runtime
- **THEN** readiness is computed from the native credential sources the headless runner would use
- **AND** Claude uses the app-stored account then effective-config-directory CLI login order

#### Scenario: Fresh install reports needs-auth with a hint

- **WHEN** a consumer lists runtimes on a machine with no Claude credential in either source
- **THEN** the claude-code entry reports `readiness.state` of `needs-auth`
- **AND** the readiness hint names the supported remedies (Locus desktop sign-in or `claude` CLI login)

#### Scenario: Probe skipped or failed degrades to unknown

- **WHEN** the consumer passes `--no-probe`, or a readiness resolver fails
- **THEN** states that would require a subprocess probe are reported as `unknown`
- **AND** the discovery command still exits successfully with the full manifest list
- **AND** resolver failures are reported on stderr, not in the JSON payload

#### Scenario: Readiness never misreports ready

- **WHEN** a readiness resolver cannot positively confirm a usable credential
- **THEN** it reports `needs-auth`, `unavailable`, or `unknown` — never `ready`

### Requirement: Discovery Feature Advertisement

The runtime discovery envelope SHALL include a top-level `features` array of stable string identifiers advertising additive contract capabilities, so consumers can feature-detect without an `apiVersion` change. The `apiVersion` value SHALL remain the exact-match `locus.local-job.v1` for additive changes.

#### Scenario: Consumer detects readiness support

- **WHEN** a consumer reads the discovery envelope from a build with this change
- **THEN** `features` contains `runtime-readiness`
- **AND** the consumer can rely on per-runtime readiness objects being present

#### Scenario: Older build lacks the feature

- **WHEN** a consumer reads the discovery envelope from a build without a given feature identifier
- **THEN** the consumer treats the corresponding contract addition as unsupported instead of assuming silently-dropped request fields were honored
