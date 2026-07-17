## ADDED Requirements

### Requirement: Runtime Core Import Boundary

The system SHALL keep the runtime-core main-process directories
(`src/main/lib/agent-runtime/`, `src/main/lib/headless/`,
`src/main/lib/agent-guard/`, `src/main/lib/provider-profiles/`) free of direct
imports of Electron, tRPC route modules, preload code, and renderer code, and
SHALL enforce this boundary through the architecture guard check. Shared
configuration read logic consumed by these directories SHALL live in
main-process lib owners; tRPC route modules SHALL import from lib owners, never
the reverse.

#### Scenario: Guarded directory adds a banned direct import

- **WHEN** a file under a runtime-core directory directly imports `electron`,
  a `src/main/lib/trpc/` module, `src/preload/` code, or `src/renderer/` code
  (including the `@/` alias)
- **THEN** the architecture guard check fails, naming the offending file and
  the exact import specifier
- **AND** the failure message points to the ownership map's Runtime Core
  Import Boundary section

#### Scenario: Lib code needs route-owned configuration reads

- **WHEN** main-process lib code needs local API provider configuration reads
- **THEN** it imports the main-process lib owner module
- **AND** the tRPC route module imports the same lib owner instead of exporting
  the read logic itself

#### Scenario: Guard rule validates itself before scanning

- **WHEN** the architecture guard check runs the import-boundary rule
- **THEN** the rule first verifies against synthetic violating and clean
  fixtures that it detects each banned import category
- **AND** the guard run fails closed if the self-test cannot detect a synthetic
  violation
