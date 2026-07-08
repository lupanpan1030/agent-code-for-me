## ADDED Requirements

### Requirement: Runtime Readiness Discovery

The runtime discovery response SHALL include a per-runtime readiness object describing whether the runtime's headless execution path has a usable credential/configuration, with states `ready`, `needs-auth`, `unavailable`, and `unknown`. Readiness MUST be computed from the same credential sources the headless run would actually use, MUST be advisory (job creation is not blocked by advertised state), and MUST NOT contain secret material.

#### Scenario: Configured runtime reports ready

- **WHEN** a consumer lists runtimes on a machine where the Claude headless credential resolution would succeed (usable app-stored account or CLI login present)
- **THEN** the claude-code entry reports `readiness.state` of `ready`

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
