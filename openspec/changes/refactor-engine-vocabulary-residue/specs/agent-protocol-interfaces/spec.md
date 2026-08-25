## REMOVED Requirements
### Requirement: Minimal ACP Stdio Boundary
**Reason**: The surface never implemented the Agent Client Protocol; keeping the "ACP" name on a
Locus-owned custom job protocol creates contract ambiguity ahead of any real ACP adoption. The
surface is respecified below as `Minimal Jobs Stdio Boundary` with the non-ACP naming made a hard
requirement.
**Migration**: The CLI command becomes `locus jobs-stdio` and the protocol version string becomes
`locus-jobs-stdio.v1`; no alias is kept. Historical `agent_jobs` rows recorded under
`locus-acp-stdio.v1` remain readable history and are not rewritten.

## ADDED Requirements
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
