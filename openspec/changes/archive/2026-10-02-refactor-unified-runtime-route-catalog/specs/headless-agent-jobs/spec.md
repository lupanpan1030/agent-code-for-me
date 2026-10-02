## MODIFIED Requirements

### Requirement: Headless Adapter Selection Boundary
Headless local jobs SHALL select adapters through the canonical runtime route
catalog in `src/main/lib/agent-runtime/runtime-route-catalog.ts` instead of binding
each runtime ID to exactly one adapter. The former headless adapter selector and
its production call sites SHALL be replaced in the same change; no forwarding
compatibility alias or duplicate adapter table SHALL remain.

#### Scenario: Existing batch behavior is preserved
<!-- Scenario register: S14; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/headless.json#S14` with existing CLI, daemon, schedule, protocol and Local Job API requests for both runtimes, using their original parser defaults and runtimeRouteCatalog options forwarded from the real hosts to runAgentTask, with recording leaf ports (no options.runner or LOCUS_HEADLESS_FAKE_RUNNER bypass)
- **WHEN** runHeadlessCliCommand, pumpQueuedRuns or runJobsStdioServer starts the corresponding existing CLI, daemon, schedule, protocol, or Local Job API v1 job without an explicit non-batch execution profile
- **THEN** the catalog chooses the existing batch behavior when capability and
  policy checks pass
- **AND** `codex exec` and `claude -p` remain available as batch adapters with baseline argv/stdin, source and cancellation ports

#### Scenario: Rich adapter is not silently selected
<!-- Scenario register: S15; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/headless.json#S15` with runAgentTask's runtimeRouteCatalog test option containing both batch and rich factories, a batch request and unsupported/interactive-only requests
- **WHEN** runAgentTask resolves the batch request while a richer SDK or app-server adapter is available for the same runtime
- **THEN** headless jobs do not use it unless the request, capability gate, and
  permission policy explicitly allow that adapter source
- **AND** unsupported or interactive-only requirements fail closed before
  native provider work starts (existing provider-binding reads/records keep their order); the recording rich factory remains uncalled for the batch request

## ADDED Requirements

### Requirement: Catalog Selection Does Not Own Queue Dispatch

`headless/daemon.ts#pumpQueuedRuns` SHALL remain the only queued execution
dispatch owner. It SHALL retain its own job.kind-to-agent/completion-runner dispatch.
Catalog lookup SHALL occur only in the agent runner after claim, the existing
claim gate and provider binding/recordResolvedProvider, without moving source slots, conditional claim, concurrency, worker identity,
claim-time API gate, heartbeat, cancellation or retention into the catalog.
CLI API and jobs-stdio SHALL remain submit/pump envelope consumers, and the human
one-shot runner and desktop-source execution SHALL preserve their existing owners.

#### Scenario: S16 Concurrent pumps still execute an admitted Run once
- **GIVEN** `tests/fixtures/runtime-route-catalog/executor.json#S16` with two SQLite connections, queued daemon/schedule/API-agent/API-completion rows, excluded desktop/CLI/protocol rows, concurrency-one pumps and claim/runner latches and pumpQueuedRuns runtimeRouteCatalog options forwarded unchanged to recording agent leaf ports
- **WHEN** the real pumpQueuedRuns instances race using their own kind-to-runner dispatch
- **THEN** each admitted eligible Run has at most one successful claim and one execution; the losing claimant performs no catalog query or adapter/provider call; query spies run only after the winning claim and the existing provider binding record
- **AND** daemon source order remains daemon then schedule then api, ordinary daemon leaves excluded sources untouched, claim-time revalidation still precedes provider work and the catalog writes no rows/events

#### Scenario: S17 Submission replay and scoped protocol execution reuse existing owners
- **GIVEN** `tests/fixtures/runtime-route-catalog/executor.json#S17` with matching keyed submit replay, an own-ID synchronous wrapper pump and a jobs-stdio session owning one admitted ID
- **WHEN** replay is submitted and each scoped pump runs, including a competing claimant
- **THEN** replay retains one job/key and does not invoke the catalog factory again; wrapper and stdio dispatch only their admitted IDs through the existing pump
- **AND** ack, wait/publication barrier, session cancellation and retained terminal results remain owned by submission/ledger/host; no protocol/API inline runner is restored
