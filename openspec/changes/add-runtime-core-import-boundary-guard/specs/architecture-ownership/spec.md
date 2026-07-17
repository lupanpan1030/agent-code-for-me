## ADDED Requirements

### Requirement: Runtime Core Import Boundary

The system SHALL scan the runtime-core main-process directories
(`src/main/lib/agent-runtime/`, `src/main/lib/headless/`,
`src/main/lib/agent-guard/`, `src/main/lib/provider-profiles/`) and SHALL keep
their `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, and `.cjs` files
free of direct imports of Electron, tRPC packages, tRPC route modules, preload
code, and renderer code. The architecture guard check SHALL enforce this
boundary for those four directories. Direct dependency specifiers include
static and side-effect imports, export-from, dynamic imports, direct and
parenthesized `require`, `module.require`, simple aliases of
`require`/`module.require`, imported Node `createRequire` loaders, and
type-only import forms. Local API provider configuration reads used by a
guarded directory SHALL come from the main-process lib owner; a guarded
directory SHALL NOT import those reads from the tRPC router.

#### Scenario: Guarded directory adds a banned direct import

- **WHEN** a scanned file under one of the four runtime-core directories
  directly imports `electron`, `electron/*`, `@trpc/*`, `trpc-electron`,
  `trpc-electron/*`, a `src/main/lib/trpc/` module, `src/preload/` code, or
  `src/renderer/` code (including the `@/` alias)
- **THEN** the architecture guard check fails, naming the offending file and
  the exact import specifier
- **AND** the failure message points to the ownership map's Runtime Core
  Import Boundary section

#### Scenario: Guarded runtime-core code needs provider configuration reads

- **WHEN** code in one of the four guarded directories needs local API provider
  configuration reads
- **THEN** it imports the main-process lib owner module
- **AND** it does not import those reads from the tRPC route module

#### Scenario: Router consumes the extracted read owner

- **WHEN** the local API provider configuration router needs the extracted
  schema, types, or read helpers
- **THEN** it imports the listed symbols from the main-process lib owner
- **AND** its `get`, `save`, and `clear` procedure bodies and route-local input
  schemas remain router-owned

#### Scenario: Guard rule validates itself before scanning

- **WHEN** the architecture guard check runs the import-boundary rule
- **THEN** the rule first verifies against synthetic violating and clean
  fixtures that it detects every banned import category, scanned extension,
  static and side-effect import, export-from, dynamic import, direct and
  parenthesized require, `module.require`, simple require/createRequire
  aliases, `import type`, and inline type import form
- **AND** comment-only and ordinary-string fixtures produce no findings
- **AND** the guard run fails closed if the exact expected findings do not
  match
