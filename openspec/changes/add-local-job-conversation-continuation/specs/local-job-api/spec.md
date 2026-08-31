## ADDED Requirements

### Requirement: Conversation Continuation Handles

The Local Job API SHALL let a consumer opt a run into conversation continuation
and SHALL return an opaque Locus-owned handle without exposing the runtime's
native session identity.

#### Scenario: Consumer requests a continuable run

- **WHEN** a consumer creates a valid run with `continuable` enabled
- **THEN** Locus preserves the runtime session for that run
- **AND** mints a continuation handle bound to the run's runtime, project, and cwd
- **AND** the handle neither contains nor derives from the native session identifier

#### Scenario: Consumer reads the handle from a terminal result

- **WHEN** a continuable run reaches a terminal status and the consumer reads its result
- **THEN** the result includes `continuationHandle` when a verified runtime session was captured
- **AND** the envelope contains no native session identifier or session path

#### Scenario: Consumer does not opt in

- **WHEN** a consumer creates a run without continuation fields
- **THEN** Locus preserves the existing non-persistent cold-start behavior
- **AND** the result omits `continuationHandle`

### Requirement: Continued Job Submission

The Local Job API SHALL accept a continuation handle on create and SHALL start a
new durable job that resumes the referenced conversation.

#### Scenario: Consumer continues a prior conversation

- **WHEN** a consumer creates a run with a valid continuation handle
- **THEN** Locus creates a new `source=api` job with its own ID, event sequence, artifacts, and result
- **AND** the runtime resumes the referenced conversation instead of starting cold
- **AND** the new job records continuation lineage to the prior job
- **AND** the prior job remains terminal and unchanged

#### Scenario: Continued run is itself continuable

- **WHEN** a consumer enables continuation while creating from a valid handle
- **THEN** the new job may return a fresh handle for the extended conversation

### Requirement: Continuation Handle Binding And Fail-Closed Resolution

The Local Job API SHALL reject a continuation request it cannot honor before any
provider work starts and SHALL NOT degrade it into a cold run.

#### Scenario: Handle is unavailable

- **WHEN** a submitted handle is unknown, revoked, or expired
- **THEN** Locus rejects the request with a sanitized validation error and a non-zero exit code
- **AND** no job is created and no provider process is started

#### Scenario: Handle binding differs

- **WHEN** a submitted handle's runtime, project, or canonical cwd differs from the request
- **THEN** Locus rejects the request with a sanitized binding diagnostic
- **AND** no job is created and no provider process is started

#### Scenario: Runtime cannot honor a resolved resume

- **WHEN** a handle resolves but the runtime fails to resume its native session
- **THEN** Locus fails visibly with a structured resume diagnostic
- **AND** does not execute the follow-up as a cold run

#### Scenario: Run is cancelled before a native session is known

- **WHEN** a continuable run is cancelled before the runtime reports a verified native session
- **THEN** the cancelled result omits `continuationHandle`
- **AND** Locus does not invent or infer a native session identity

## MODIFIED Requirements

### Requirement: Run Result and Artifact Manifest

The Local Job API SHALL produce a stable result envelope and run-owned artifact
manifest for API-created jobs.

#### Scenario: API job completes

- **WHEN** an API-created job reaches succeeded, failed, canceled, or
  interrupted status
- **THEN** Locus can return a v1 result envelope with job status, runtime, mode,
  consumer metadata, diagnostics, artifact manifest location, artifact entries,
  and a continuation handle when a verified handle exists for that job
- **AND** the result envelope does not include provider secrets, OAuth tokens,
  raw headers, plaintext credential material, or native runtime session identifiers

#### Scenario: Run artifact directory is configured

- **WHEN** a create request includes an artifact base directory
- **THEN** Locus writes run-owned metadata under `<artifactBaseDir>/<jobId>/`
- **AND** writes sanitized `request.json`, `events.jsonl`, `result.json`, and
  `artifacts.json`
- **AND** records the artifact manifest path on the job
- **AND** does not write downstream `final/` materials as part of API execution
