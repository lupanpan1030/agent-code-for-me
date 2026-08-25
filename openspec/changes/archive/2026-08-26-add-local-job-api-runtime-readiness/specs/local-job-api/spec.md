## ADDED Requirements

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
