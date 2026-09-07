## MODIFIED Requirements

### Requirement: Stable API Event Stream
The Local Job API SHALL expose safe stable v1 events only for API-created jobs. The
public vocabulary SHALL remain job_created, job_started, assistant_delta, reasoning_delta,
tool_started, tool_delta, tool_finished, usage_update, artifact_created, status, error,
completed. Public envelope fields SHALL remain apiVersion, jobId, sequence, type,
createdAt and payload. Payload SHALL be the bare redacted semantic payload; optional
runtime.codex.v1 metadata SHALL appear at /payload/extensions/runtime.codex.v1. Every canonical
record SHALL project once at its original sequence, using safe status stubs when
necessary, so the post-cutover sequence domain remains dense. The nine internal types
outside v1 SHALL map to status with subtype equal to their original internal type name.
The extension SHALL preserve an existing string payload.runtime; it SHALL be added only
to object semantic payloads under payload.extensions["runtime.codex.v1"], with no wrapper
for non-object payloads. Dense status records can increase event volume; --after SHALL
remain the cursor for incremental reads, with no bounded per-Run event-count guarantee.
Pre-binding host status runtime_selected/runtime_selection_refused SHALL be admitted with
pending provenance and their existing string payload.runtime. Their optional
payload.extensions["runtime.codex.v1"] SHALL be absent until execution binding; earlier
records SHALL NOT be retroactively extended when the Run binds.

#### Scenario: Consumer reads events
- **WHEN** source=api `public-v1.json` records are read by runs events with --after=2
- **THEN** envelopes contain the expected sequences strictly greater than 2 in order,
  apiVersion=locus.local-job.v1 and the same jobId; payload.text remains "hello" in
  the assistant fixture and optional metadata is at /payload/extensions/runtime.codex.v1
- **AND** no desktop runId/runEventSequence/redaction/payload wrapper appears, and
  reading again with the last sequence returns only subsequent records
- **AND** pre-binding runtime_selected/runtime_selection_refused fixtures retain their
  original string payload.runtime with no payload.extensions["runtime.codex.v1"], and
  remain unchanged after binding; runtime-backed fixtures carry the optional extension
- **AND** a source=desktop fixture is rejected by getLocalJobApiEvents

#### Scenario: Consumer follows events
- **WHEN** public-v1.json drives runs events --follow --jsonl through a committed
  terminal and then late diagnostics, with a separate host stderr message
- **THEN** stdout has one JSON envelope per delivered record and diagnostics use stderr;
  follow exits on terminal unless interrupted and is not required to wait for late facts
- **AND** an explicit read after completed returns the fixture's status/late_event
  observations without another completed or altered result

#### Scenario: All internal event types preserve dense v1 projection
- **WHEN** the v1 serializer maps `public-vocabulary.json` containing all 21 internal
  types plus a redacted-only observation at contiguous sequences
- **THEN** output has the identical contiguous sequence list, exactly the 12 permitted
  public type values, and the nine coerced types have subtype equal to their internal name
- **AND** the redacted-only record is status/redacted_observation with contentOmitted=true,
  not a skipped sequence, and unknown optional payload fields can be ignored

### Requirement: Run Result and Artifact Manifest
The Local Job API SHALL return the stable result envelope and Run-owned artifact
manifest for API jobs from committed ledger outcome/artifact metadata. Existing status,
runtime/mode/consumer fields, paths, SHA-256 and retention SHALL remain; admitted native
artifact roles SHALL be additive. Retry SHALL keep existing job-envelope identity fields.

#### Scenario: API job completes
- **WHEN** `public-results.json` supplies committed succeeded/failed/canceled/interrupted
  jobs, diagnostics and admitted artifact metadata to runs result and the CLI serializer
- **THEN** v1 returns the job status, runtime/mode/consumer data, diagnostics, manifest
  location and entries from that commit with no provider/OAuth/header/credential secrets
- **AND** create/retry serializers return the existing status-derived exit code mapping,
  including failed for core denial/rejection outcomes and succeeded after retry-only diagnostics
- **AND** runs status on the retry fixture has job.retryOfJobId and job.attempt linking
  to its source; these assertions do not target an event envelope

#### Scenario: Run artifact directory is configured
- **WHEN** `public-artifacts.json` submits a create request with a temporary artifact
  base and then reads the committed final artifact result
- **THEN** sanitized request.json, events.jsonl, result.json and artifacts.json exist
  under <artifactBaseDir>/<jobId>/ and their registered SHA-256 matches the file bytes
- **AND** the job stores the manifest path; initial roles remain, native entries only
  append, and no downstream final/ material is written
- **AND** result/events files reflect the frozen terminal prefix; explicit later event
  reads can include diagnostics without silently changing those committed file digests

### Requirement: Discovery Feature Advertisement
The runtime discovery envelope SHALL include a top-level features array of stable
string identifiers for additive contract capabilities, keeping exact
apiVersion=locus.local-job.v1. canonical-run-ledger SHALL identify the dense committed
ledger projection, corrected terminal truth and optional metadata. The optional
runtime.codex.v1 namespace SHALL declare schemaVersion=1 and maturity=experimental;
this SHALL not claim native protocol stability or live-attach support.

#### Scenario: Consumer detects readiness support
- **WHEN** the discovery reader is exercised with `discovery.json` containing current
  readiness-enabled runtime fixtures
- **THEN** features contains runtime-readiness and the per-runtime readiness objects
  are present as in the existing contract

#### Scenario: Older build lacks the feature
- **WHEN** a consumer reads the discovery envelope from a build without a given feature identifier
- **THEN** the consumer treats the corresponding contract addition as unsupported instead of assuming silently-dropped request fields were honored

#### Scenario: Consumer detects canonical ledger support
- **WHEN** the implemented discovery reader is exercised with the ledger-enabled
  discovery.json fixture
- **THEN** features contains canonical-run-ledger alongside existing features, and the
  documented optional extension has namespace runtime.codex.v1, schemaVersion=1 and
  experimental maturity matching its emitted metadata
