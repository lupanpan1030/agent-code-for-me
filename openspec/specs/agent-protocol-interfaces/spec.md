# agent-protocol-interfaces Specification

## Purpose
TBD - created by archiving change add-headless-agent-jobs. Update Purpose after archive.

## Requirements

### Requirement: Protocol-Shaped Internal Events
The system SHALL shape internal agent job events so they can map to protocol clients without changing persisted job history.

#### Scenario: Event contains file path
- **WHEN** an event payload references a local file path
- **THEN** the payload stores the path as an absolute path when practical
- **AND** renderer and CLI surfaces may display a project-relative path derived from it

#### Scenario: Event maps to session update
- **WHEN** an event represents assistant output, tool progress, plan updates, or terminal status
- **THEN** the event includes a stable type and payload shape that can map to a future ACP-style session update
- **AND** the stored event remains useful to desktop and CLI surfaces without an ACP client

### Requirement: Protocol Mode Safety
Protocol-facing surfaces SHALL preserve the same local-first, credential, and permission boundaries as desktop and CLI surfaces.

#### Scenario: Protocol client requests runtime work
- **WHEN** a protocol client requests runtime work
- **THEN** Locus resolves credentials through existing local mechanisms
- **AND** does not accept plaintext provider tokens over the protocol
- **AND** applies local-only guards and permission rules consistently with CLI and desktop job requests

#### Scenario: Protocol client requests unsupported capability
- **WHEN** a protocol client requests a capability that Locus does not advertise or support
- **THEN** Locus returns a structured protocol error
- **AND** does not start partial runtime work

### Requirement: Minimal Jobs Stdio Boundary
The system SHALL provide a minimal Locus-owned stdio JSON-RPC surface behind an explicit
`jobs-stdio` command and the shared runtime core. The surface SHALL NOT present itself under the
"ACP" name: it is not the Agent Client Protocol, and its command name and protocol version string
MUST NOT contain "acp".
Initialize/job.run/job.cancel/shutdown envelopes SHALL remain unchanged. job.run SHALL
call submitRun before acknowledgement and reuse pumpQueuedRuns scoped to its own
session's admitted IDs without an external daemon. Session active IDs SHALL govern
transport cancel/shutdown only, not durable status. EOF/shutdown SHALL retain their
existing cancel/drain scope through the same lifecycle owner. Existing strict job.run
parameters SHALL not gain consumer/key fields.

#### Scenario: User starts jobs-stdio mode
<!-- Scenario register: S47 (retained living scenario; title unchanged for MODIFIED archive) -->
- **GIVEN** `tests/fixtures/local-job-api-async/guards-protocol/stdio.json#S47`, with an isolated profile and packaged CLI stdout/stderr capture for jobs-stdio and retired acp command
- **WHEN** a user runs `locus jobs-stdio`
- **THEN** Locus starts a stdio JSON-RPC server backed by the shared runtime core
- **AND** stdout is reserved for protocol messages
- **AND** diagnostics are written to stderr
- **AND** the retired `locus acp` command name is not accepted

#### Scenario: Protocol client sends prompt turn
<!-- Scenario register: S48 (retained living scenario; title unchanged for MODIFIED archive) -->
- **GIVEN** `tests/fixtures/local-job-api-async/guards-protocol/stdio.json#S48`, with an initialized JSON-RPC session and job.run params runtime=codex, mode=plan, cwd=registered temp project, prompt="Return OK", with runner latch
- **WHEN** a protocol client sends a prompt turn to Locus
- **THEN** Locus creates a `source=protocol` local job through the shared submit core and session-scoped canonical pump
- **AND** streams protocol updates derived from normalized job events
- **AND** cancellation maps to the shared job cancellation path

#### Scenario: Protocol client initializes capabilities
<!-- Scenario register: S49 (retained living scenario; title unchanged for MODIFIED archive) -->
- **GIVEN** `tests/fixtures/local-job-api-async/guards-protocol/stdio.json#S49`, with a fresh stdio session receiving JSON-RPC initialize with id=1 and empty params
- **WHEN** a protocol client sends the initialization request
- **THEN** Locus returns a protocol response whose `protocolVersion` is `locus-jobs-stdio.v1`
- **AND** advertises only the minimal supported local job operations
- **AND** does not claim Agent Client Protocol (ACP) compatibility, MCP negotiation, session
  resume, or runtime parity support

#### Scenario: Protocol exits cleanly
<!-- Scenario register: S50 (retained living scenario; title unchanged for MODIFIED archive) -->
- **GIVEN** `tests/fixtures/local-job-api-async/guards-protocol/stdio.json#S50`, with one queued, one running and one terminal session job; shutdown and stdin EOF variants with drain latch
- **WHEN** a protocol client sends shutdown or closes stdin
- **THEN** Locus stops accepting new protocol jobs
- **AND** does not mark already terminal jobs again
- **AND** exits without writing non-protocol text to stdout

#### Scenario: Historical job rows keep the retired protocol string
<!-- Scenario register: S51 (retained living scenario; title unchanged for MODIFIED archive) -->
- **GIVEN** `tests/fixtures/local-job-api-async/guards-protocol/stdio.json#S51`, with an existing job row whose input protocol is locus-acp-stdio.v1 and a read-only store connection
- **WHEN** an `agent_jobs` row was recorded under the retired `locus-acp-stdio.v1` protocol string
- **THEN** the row remains readable history
- **AND** no migration rewrites its stored protocol value
- **AND** getAgentJob and serialized historical input retain the exact retired string

#### Scenario: S29 Job run acknowledges the shared creation core
- **GIVEN** `tests/fixtures/local-job-api-async/guards-protocol/stdio.json#S29`, with an initialized stdio session with a temporary registered project, the
  existing strict runtime/mode/cwd/prompt params and a recording submit/pump seam whose
  runtime runner is held on a latch, with no external daemon
- **WHEN** JSON-RPC initialize then job.run are written to stdin
- **THEN** initialize returns protocolVersion=locus-jobs-stdio.v1 and the existing
  four capabilities; job.run returns its original result.job shape after creation commit
- **AND** both API submit and this job.run invoke the same submit seam, one creation
  exists per call, and job/event notifications read committed records once in sequence
- **AND** release of the session executor latch runs that job through the common pump;
  extra consumer/key parameters still produce the existing invalid-params response

#### Scenario: S30 Protocol cancel and shutdown remain session-owned
- **GIVEN** `tests/fixtures/local-job-api-async/guards-protocol/stdio.json#S30`, with two stdio sessions with queued and running protocol jobs and a separate API job
- **WHEN** one session cancels its queued/running job, attempts to cancel the other's
  job, then sends shutdown; repeat with stdin EOF
- **THEN** its queued job settles canceled without spawn, its running job receives
  cancellation through the existing worker, and streams drain/stop within the existing bounds
- **AND** other-session cancellation returns JSON-RPC -32602; API and other-session
  jobs are not canceled or claimed, and shutdown returns the existing {ok:true} result
- **AND** each canceled queued Run has exactly one completed without spawn; each running Run
  has zero completed while the worker is paused and exactly one after cancellation
  confirmation; unrelated Runs have zero new completed
