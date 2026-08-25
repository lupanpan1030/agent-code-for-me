## ADDED Requirements

### Requirement: Canonical Runtime Event Mapping Single Path

The architecture guard check SHALL enforce that persisted job events and renderer-visible
runtime diagnostics have exactly one mapping and redaction path. The event-pipeline
functions (`createRunEvent`; `mapDesktopStreamChunkToRunEvents`,
`createDesktopStreamEventMapper`, `appendRunEventsToAgentJob`,
`redactRendererDiagnosticChunk`, `redactRendererRuntimeChunk`,
`createRuntimeRendererChunkEmitter`; `createAgentJobRunEvent`; `redactRuntimePayload`,
`redactExactSecretHints`) SHALL be defined only in their canonical
`src/main/lib/agent-runtime/` owner modules. The persisted job-event write function SHALL
be exported only from `src/main/lib/headless/job-store.ts`, its record-level insert helper
SHALL remain module-private, and modules under `src/main/lib/trpc/routers/`,
`src/main/lib/codex/`, and `src/main/lib/claude/` SHALL NOT import the raw write function
directly; they consume the event-bridge owners instead. Direct importers of the raw write
function SHALL be limited to a frozen allowlist that may only shrink.

#### Scenario: Second event mapping definition appears

- **WHEN** a module outside the canonical `src/main/lib/agent-runtime/` owners defines or
  re-exports one of the event-pipeline functions
- **THEN** the architecture guard check fails, naming the offending file and symbol
- **AND** the failure message points to the ownership map's "Runtime Events, Trace, And
  Redaction" section

#### Scenario: Route or runtime adapter writes job events directly

- **WHEN** a file under `src/main/lib/trpc/routers/`, `src/main/lib/codex/`, or
  `src/main/lib/claude/` imports the raw persisted job-event write function, or a file
  outside the frozen direct-importer allowlist imports it
- **THEN** the architecture guard check fails
- **AND** the failure message names the event-bridge owners as the required path

#### Scenario: Guard proves its own detection

- **WHEN** the event single-path guard runs
- **THEN** it first verifies against synthetic violating and clean fixtures that it
  detects a duplicate definition and a disallowed raw-write import
- **AND** the guard run fails closed if the expected findings do not match

### Requirement: Temporary Route Owner Surface Ratchet

While `docs/OWNERSHIP_MAP.md` designates `src/main/lib/trpc/routers/claude.ts` and
`src/main/lib/trpc/routers/codex.ts` as temporary canonical owners pending service
extraction, the architecture guard check SHALL enforce a machine-readable ratchet baseline
over each route file's line count and exact named-export set. A measured line count above
the baseline, or an export absent from the baseline set, SHALL fail the check. A measured
line count below the baseline SHALL also fail with an instruction to tighten the baseline,
so the recorded baseline always equals reality. Baseline raises SHALL require an explicit
hand edit carrying a recorded reason. When an approved change retires a route's
temporary-owner clause, the same change SHALL remove that route's ratchet entry and place
the route under ordinary import-boundary and route-role enforcement.

#### Scenario: Temporary owner route grows

- **WHEN** `claude.ts` or `codex.ts` exceeds its baseline line count or adds an export not
  in its baseline set
- **THEN** the architecture guard check fails, naming the route, the measured value, and
  the baseline value

#### Scenario: Temporary owner route shrinks

- **WHEN** extraction moves logic out of a ratcheted route and its measured line count
  falls below the baseline
- **THEN** the architecture guard check fails with the exact lower value to record
- **AND** the same change tightens the baseline to that value

## MODIFIED Requirements

### Requirement: Runtime Core Import Boundary

The system SHALL scan the guarded main-process directories
(`src/main/lib/agent-runtime/`, `src/main/lib/headless/`,
`src/main/lib/agent-guard/`, `src/main/lib/provider-profiles/`,
`src/main/lib/model-catalog/`, `src/main/lib/codex/`, `src/main/lib/claude/`,
`src/main/lib/runtime-mcp-config/`, `src/main/lib/runtime-capability-projection/`, and
`src/main/lib/agent-workbench/`) and SHALL keep their `.ts`, `.tsx`, `.mts`, `.cts`,
`.js`, `.jsx`, `.mjs`, and `.cjs` files free of direct imports of Electron, tRPC
packages, tRPC route modules, preload code, and renderer code. The architecture guard
check SHALL enforce this boundary for those guarded directories. Direct dependency
specifiers include static and side-effect imports, export-from, dynamic imports, direct
and parenthesized `require`, `module.require`, simple aliases of
`require`/`module.require`, imported Node `createRequire` loaders, and type-only import
forms. Pre-existing violations present when a directory joins the guard SHALL be recorded
in a checked-in machine-readable baseline keyed by file, specifier, and category; a
finding outside the baseline SHALL fail the check, and baseline entries may only be
removed, never added or widened, except through an explicit Owner-approved edit.

The dependency direction SHALL be machine-enforced repo-wide: no file under
`src/main/lib/` outside `src/main/lib/trpc/` may import a module resolving under
`src/main/lib/trpc/routers/`, in any of the recognized dependency syntaxes including
type-only imports. Pre-existing reverse-direction imports SHALL be recorded in the same
machine-readable baseline under their own section with identical only-shrink semantics.
tRPC route modules SHALL import from lib owners, never the reverse. Shared configuration
read logic consumed by guarded directories SHALL live in main-process lib owners. In
particular, local API provider configuration reads SHALL come from the main-process lib
owner, and no module SHALL import those reads from the tRPC router.

The known reach-through wrapper modules SHALL be maintained as a machine-readable
registry read by the architecture guard check, and the ownership map's documented wrapper
list SHALL name exactly the registry entries. The guard SHALL detect one-hop reach-through
growth: a module outside the guarded directories that is imported by a guarded directory
and itself directly imports a banned category SHALL appear in the registry, or the check
fails. Transitive reach beyond one hop through wrapper modules remains allowed at this
stage and deferred by design; a direct import from a guarded directory into a banned
category still fails.

#### Scenario: Guarded directory adds a banned direct import

- **WHEN** a scanned file under one of the guarded directories directly imports
  `electron`, `electron/*`, `@trpc/*`, `trpc-electron`, `trpc-electron/*`, a
  `src/main/lib/trpc/` module, `src/preload/` code, or `src/renderer/` code (including
  the `@/` alias), and the finding is not a recorded baseline entry
- **THEN** the architecture guard check fails, naming the offending file and the exact
  import specifier
- **AND** the failure message points to the ownership map's Runtime Core Import Boundary
  section

#### Scenario: Baseline violation is cleared

- **WHEN** a recorded baseline violation no longer exists in the scanned source
- **THEN** the architecture guard check fails with an instruction to delete the stale
  baseline entry
- **AND** the same change removes the entry, so the baseline only shrinks

#### Scenario: Main-process lib module imports a router module

- **WHEN** a file under `src/main/lib/` outside `src/main/lib/trpc/` imports a module
  resolving under `src/main/lib/trpc/routers/`, including via a type-only import, and the
  finding is not a recorded baseline entry
- **THEN** the architecture guard check fails, naming the file and the router specifier

#### Scenario: New reach-through wrapper appears

- **WHEN** a guarded directory imports a module outside the guarded directories that
  directly imports a banned category, and that module is not in the reach-through wrapper
  registry
- **THEN** the architecture guard check fails, naming the wrapper candidate and the
  banned category it reaches
- **AND** the guard also fails if the ownership map's documented wrapper list and the
  registry do not name the same set

#### Scenario: Main-process lib code needs provider configuration reads

- **WHEN** main-process lib code — inside or outside the guarded directories — needs
  local API provider configuration reads
- **THEN** it imports the main-process lib owner module
- **AND** it does not import those reads from the tRPC route module

#### Scenario: Router consumes the extracted read owner

- **WHEN** the local API provider configuration router needs the extracted schema, types,
  or read helpers
- **THEN** it imports the listed symbols from the main-process lib owner
- **AND** its `get`, `save`, and `clear` procedure bodies and route-local input schemas
  remain router-owned
- **AND** it does not re-export the moved read logic from the router path

#### Scenario: Guard rule validates itself before scanning

- **WHEN** the architecture guard check runs the import-boundary rule
- **THEN** the rule first verifies against synthetic violating and clean fixtures that it
  detects every banned import category, scanned extension, static and side-effect import,
  export-from, dynamic import, direct and parenthesized require, `module.require`, simple
  require/createRequire aliases, `import type`, and inline type import form
- **AND** comment-only and ordinary-string fixtures produce no findings
- **AND** the guard run fails closed if the exact expected findings do not match
