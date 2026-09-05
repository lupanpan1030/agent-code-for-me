## MODIFIED Requirements

### Requirement: Stable API Event Stream
The Local Job API SHALL expose stable v1 job events that are safe for downstream
consumers to parse.

The `locus.local-job.v1` event vocabulary SHALL remain exactly
`job_created`, `job_started`, `assistant_delta`, `reasoning_delta`,
`tool_started`, `tool_delta`, `tool_finished`, `usage_update`,
`artifact_created`, `status`, `error`, and `completed`. This change SHALL NOT add,
rename, or remove a v1 event type. Richer canonical ledger data MAY be projected
only as redacted optional members of an existing event's `payload`; consumers
that ignore unknown optional payload members SHALL continue to parse the event.
For an existing persisted-`RunEvent` wrapper, native/provenance/reconciliation
members SHALL be appended inside its nested semantic `payload` object (for
example `/payload/payload/runtime/codex/v1`) rather than flattening or replacing
the wrapper.
The public `sequence` SHALL be the sequence assigned once by the canonical Run
ledger and SHALL be the only supported downstream cursor for live runs, stored
runs, and snapshot-repaired runs. The existing optional
`payload.runEventSequence` member SHALL remain available as a deprecated
compatibility alias equal to envelope `sequence`; it SHALL NOT carry an
independently allocated value or be accepted as another cursor.

For one execution attempt, envelope `jobId` and any pre-existing nested
`payload.runId` SHALL be compatibility aliases equal to the canonical `runId`.
A retry SHALL project a new `jobId`/Run and preserve its existing
`retryOfJobId`/attempt relationship instead of mutating the terminal source Run.
This identity-semantic convergence is C7 Red until the Owner records its public
compatibility disposition.

Changes to identity, lifecycle, ordering, completion truth, and artifact qualification
identified as C7 Red SHALL remain behind the implementation migration gate until
the checked-in Consumer Impact decision records an Owner-selected compatibility
strategy. A transport-specific sequence, native item ID, or snapshot position
MUST NOT be offered as a second v1 cursor.

#### Scenario: Consumer reads events
- **WHEN** a consumer runs `locus api runs events <job-id> --after <sequence>`
- **THEN** Locus returns events in increasing sequence order
- **AND** each event has `apiVersion`, `jobId`, `sequence`, `type`,
  `createdAt`, and sanitized `payload`
- **AND** consumers can resume event reads by passing the last seen sequence
- **AND** a Bun contract test can seed an in-memory canonical ledger sink with
  one fixture of each of the twelve v1 event types, invoke the Local Job API
  event reader, and assert that every returned `sequence` is the unchanged,
  unique ledger sequence rather than a reader- or persistence-assigned value
- **AND** the same test can add redacted optional native or
  `/payload/payload/runtime/codex/v1` members and assert that the six required
  envelope fields, the existing persisted-event wrapper, and all pre-existing
  payload members remain unchanged
- **AND** when `payload.runEventSequence` is present, the test asserts that it
  equals envelope `sequence`
- **AND** when nested `payload.runId` is present, the test asserts that it equals
  envelope `jobId`, while a retry fixture has a distinct new `jobId` and points
  to the terminal source through the existing retry fields
- **AND** reading again after the last returned sequence yields only records
  with a greater canonical sequence and neither duplicates nor skips an
  otherwise visible ledger record

#### Scenario: Consumer follows events
- **WHEN** a consumer runs `locus api runs events <job-id> --follow --jsonl`
- **THEN** stdout contains one JSON event envelope per line
- **AND** diagnostics and non-event messages are written to stderr
- **AND** the command exits after a terminal job status unless interrupted
- **AND** a Bun CLI fixture containing a retryable diagnostic `error`, later
  output, and exactly one terminal `completed` event asserts that `error` does
  not stop following when `willRetry=true`, `completed` does stop following,
  and no duplicate terminal envelope is printed
- **AND** a late diagnostic fixture follows the checked-in Owner disposition:
  it is either drained before `completed` or remains available to a later
  explicit cursor read, and in either case cannot change the already returned
  terminal outcome

#### Scenario: V1 vocabulary is frozen while canonical details expand
- **WHEN** a Bun projection test supplies canonical ledger records containing
  native identity, provenance, repair, loss, reconciliation, or stable status
  subtype metadata
- **THEN** the Local Job API projects every record through one of the twelve
  existing v1 event types
- **AND** optional details are redacted before they enter `payload`
- **AND** the test rejects a thirteenth type, a required new envelope field, a
  changed `apiVersion`, or any thread/session identity substitution

#### Scenario: C7 Red disposition is absent
- **WHEN** the checked-in Consumer Impact decision has not recorded the Owner's
  compatibility choice for C7 classes 2, 3, 4, 5, 7, and 8
- **THEN** a Bun rollout-gate test proves that the canonical-ledger migration
  cannot expose changed v1 completion, ordering, cursor, security, or artifact
  semantics to Local Job API consumers
- **AND** the gate does not permit a hidden shadow projection or a second v1
  fact chain

### Requirement: Run Result and Artifact Manifest
The Local Job API SHALL produce a stable result envelope and run-owned artifact
manifest for API-created jobs.

The result status SHALL be derived from the canonical ledger's sole terminal
`completed` event. A denial, rejected run, or Run whose accepted output contract
requires output but whose required output is absent or invalid SHALL NOT be
returned as an unqualified success.
Provider-native paths, diffs, and images SHALL remain artifact candidates until
the canonical artifact owner has validated existence, allowed scope, digest,
Run ownership, and redaction; only admitted candidates may appear as
`artifact_created` events or result-manifest entries. The exact public
compatibility treatment for these C7 Red semantics SHALL require the Owner
decision recorded by this change before rollout to v1 consumers.

#### Scenario: API job completes
- **WHEN** an API-created job reaches succeeded, failed, canceled, or
  interrupted status
- **THEN** Locus can return a v1 result envelope with job status, runtime, mode,
  consumer metadata, diagnostics, artifact manifest location, and artifact
  entries
- **AND** the result envelope does not include provider secrets, OAuth tokens,
  raw headers, or plaintext credential material
- **AND** a Bun contract test can feed the ledger-owner seam separate successful,
  retry-then-success, denied, rejected, required-output-empty, failed, canceled,
  and interrupted fixtures and assert that each stored Run has exactly one
  terminal `completed` event whose outcome equals the v1 result status
- **AND** the denied, rejected, and required-output-empty fixtures never produce
  an unqualified succeeded result, while an explicitly accepted empty-output
  contract follows the Owner-approved completion rule
- **AND** replaying the persisted events through the Local Job API result reader
  yields the same terminal truth without consulting a raw provider chunk or
  inferring success from process exit alone

#### Scenario: Run artifact directory is configured
- **WHEN** a create request includes an artifact base directory
- **THEN** Locus writes run-owned metadata under `<artifactBaseDir>/<jobId>/`
- **AND** writes sanitized `request.json`, `events.jsonl`, `result.json`, and
  `artifacts.json`
- **AND** records the artifact manifest path on the job
- **AND** does not write downstream `final/` materials as part of API execution
- **AND** a Bun artifact-admission fixture submits an existing in-scope file, a
  missing path, an out-of-scope path, a wrong-Run candidate, a changed-digest
  candidate, and secret-like metadata through the canonical artifact owner
- **AND** the observable event stream and `artifacts.json` contain exactly the
  admitted in-scope file with its verified digest and redacted metadata
- **AND** rejected candidates emit no `artifact_created` event and appear only
  as sanitized diagnostic evidence where the Owner-approved public policy
  allows it

#### Scenario: Rollout evidence is rehydrated without inventing success
- **WHEN** a Bun fixture writes `[CODEX-06]` missing, malformed, or truncated
  rollout samples, `[CODEX-07]` cross-version completed samples, and the
  `[CODEX-08]` failed/error rollout-loss sample through the rollout persistence
  layer and reads the Local Job API result again
- **THEN** invalid resume samples retain their diagnostic classification,
  completed samples remain completed, and the failed/error Run remains terminal
  rather than rehydrating as succeeded merely because structured output is absent
- **AND** a valid admitted artifact retains its Run ownership and digest across
  the same write/read boundary
- **AND** malformed candidate evidence cannot enter the returned artifact
  manifest
