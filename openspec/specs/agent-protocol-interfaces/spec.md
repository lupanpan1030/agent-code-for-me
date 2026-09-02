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

#### Scenario: User starts jobs-stdio mode
- **WHEN** a user runs `locus jobs-stdio`
- **THEN** Locus starts a stdio JSON-RPC server backed by the shared runtime core
- **AND** stdout is reserved for protocol messages
- **AND** diagnostics are written to stderr
- **AND** the retired `locus acp` command name is not accepted

#### Scenario: Protocol client sends prompt turn
- **WHEN** a protocol client sends a prompt turn to Locus
- **THEN** Locus creates a `source=protocol` local job through the shared runner core
- **AND** streams protocol updates derived from normalized job events
- **AND** cancellation maps to the shared job cancellation path

#### Scenario: Protocol client initializes capabilities
- **WHEN** a protocol client sends the initialization request
- **THEN** Locus returns a protocol response whose `protocolVersion` is `locus-jobs-stdio.v1`
- **AND** advertises only the minimal supported local job operations
- **AND** does not claim Agent Client Protocol (ACP) compatibility, MCP negotiation, session
  resume, or runtime parity support

#### Scenario: Protocol exits cleanly
- **WHEN** a protocol client sends shutdown or closes stdin
- **THEN** Locus stops accepting new protocol jobs
- **AND** does not mark already terminal jobs again
- **AND** exits without writing non-protocol text to stdout

#### Scenario: Historical job rows keep the retired protocol string
- **WHEN** an `agent_jobs` row was recorded under the retired `locus-acp-stdio.v1` protocol string
- **THEN** the row remains readable history
- **AND** no migration rewrites its stored protocol value
