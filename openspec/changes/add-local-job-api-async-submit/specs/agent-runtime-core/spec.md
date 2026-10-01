## ADDED Requirements

### Requirement: Committed Submission And Publication Observation

A submission acknowledgement and queue claim SHALL depend on the committed
job_created fact with the exact lifecycle creation key and event type. Queue listing
and start SHALL use the same predicate. API jobs requiring initial artifacts SHALL
also require their committed initial artifact admission before claim. Missing facts
SHALL NOT be synthesized by readers. All lifecycle writes SHALL continue through the
existing ledger host and its single appendExactRunEventBatch adapter.

Terminal wait readiness SHALL be a read-only derivation of the ledger seal/completed
and the complete published terminal file set registered by that commit. It SHALL use
verified run-directory identity and digest/size checks, recheck the same seal/refs and
ignore late diagnostic suffixes. It SHALL NOT create a second publish or Run state
machine. Partial publication SHALL remain non-ready without rewriting terminal truth.
Queued API cancel SHALL compose the same terminal artifact projection before ledger
settlement even when no executor has started the job.

#### Scenario: S26 Queue listing and claim require the same committed facts
- **GIVEN** temporary SQLite rows for a valid creation fact, a job_created with a wrong
  fact key, an orphan with no events, a legacy v0 job, and an API run-dir job lacking
  initial artifact admission
- **WHEN** listQueuedAgentJobsForSource and startAgentJob run against every row
- **THEN** only the valid ledger-v1 fixture with all required admission facts is eligible;
  every other row is both excluded and refused before runner invocation
- **AND** adding the genuine initial admission through the host permits that API
  fixture, while listing/claim never allocate a replacement creation fact or sequence

#### Scenario: S27 Publication faults cannot be mistaken for completion
- **GIVEN** frozen terminal artifact fixtures, fault injection after every staged
  write, SQL commit and final rename, and a process restarted with only committed DB
  state and the resulting run directory
- **WHEN** the host's readRunPublicationReadiness port and a CLI wait inspect each fixture
- **THEN** no commit or any missing/mismatching required final file yields non-ready;
  only the matching full final set yields ready for that exact completed sequence
- **AND** swapping the directory for a symlink or changing a file digest fails closed,
  leaves outside files untouched and cannot produce a successful wait
- **AND** pending publication times out as terminal_artifacts_pending, never appends
  another completed or overwrites outcome; no process-local publish flag is required
