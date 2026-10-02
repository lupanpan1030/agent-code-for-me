# architecture-ownership Specification

## Purpose
Defines the canonical ownership and no-duplicate-business-path guardrails for
architecture-sensitive Locus runtime, provider, guard, MCP, route, and renderer
event-state changes.

## Requirements

### Requirement: Canonical Ownership Map

The system SHALL maintain a canonical ownership map for cross-cutting runtime,
provider, guard, MCP, route, and renderer runtime-event state behavior.

#### Scenario: Architecture-sensitive change is started

- **WHEN** a change modifies runtime, provider, guard, auth, capability, MCP,
  chat, or renderer runtime-event state logic
- **THEN** the implementer identifies the canonical owner from the ownership map
- **AND** the change updates that owner instead of adding a parallel business
  path

### Requirement: No Duplicate Business Paths

The system SHALL reject long-lived old/new duplicate implementations for the
same business capability.

#### Scenario: Logic is extracted into a new module

- **WHEN** a route, transport, adapter, or helper extracts business logic into a
  new owner
- **THEN** the same change removes or replaces the old helper and call sites
- **AND** tests or architecture guards cover the new single-owner boundary

#### Scenario: Temporary dual path is required

- **WHEN** a migration needs a temporary second implementation
- **THEN** the change declares the canonical owner, migration flag or gate,
  deletion date or follow-up, tests or guard coverage, and deprecation comment
- **AND** callers do not silently choose between the old and new path without
  the migration gate

### Requirement: Architecture Guard Check

The system SHALL provide a local architecture guard check for known duplicate
ownership patterns.

#### Scenario: Guard check runs

- **WHEN** the architecture guard check is executed
- **THEN** it reports high-signal duplicate owner violations
- **AND** it points the implementer to the ownership map for the canonical owner
- **AND** it avoids broad keyword-only failures that would block unrelated work

### Requirement: Runtime Surface Separation

The system SHALL keep desktop chat runtime behavior and headless batch runtime
behavior as separate product surfaces.

#### Scenario: Codex desktop chat changes

- **WHEN** Codex desktop chat behavior is changed
- **THEN** it uses the desktop chat runtime owner
- **AND** `codex exec` remains headless/batch fallback rather than becoming a
  second desktop chat implementation

#### Scenario: Claude desktop chat changes

- **WHEN** Claude desktop chat behavior is changed
- **THEN** it uses the Claude desktop chat runtime owner and Claude Agent SDK
  surface
- **AND** the bundled Claude Code CLI install surface does not become a second
  desktop chat implementation

### Requirement: Runtime Execution Boundary Ownership
The system SHALL keep runtime request shape, adapter selection, permission
policy, event normalization, redaction, and persistence boundaries in canonical
runtime owners rather than duplicating those rules in routes, transports, or
headless adapters.

#### Scenario: Adapter selection changes
<!-- Scenario register: S48; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/architecture-fixtures.json#S48` with positive catalog declarations and a negative route-local runtime dispatch
- **WHEN** an adapter-selection source fixture adds, removes or selects batch, SDK, app-server or a future source and the route-dispatch-outside-owner scanner checks its exact finding tuples
- **THEN** a declaration in src/main/lib/agent-runtime/runtime-route-catalog.ts yields zero findings, and each route/CLI/protocol/Local Job API mutation that selects from a second adapter table yields its exact route-dispatch-outside-owner tuple

#### Scenario: Runtime events cross surfaces
<!-- Scenario register: S49; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/routes.json#S49` with runtimeRouteCatalog recording ports on runClaudeAgentSdkDesktopRuntimeWithMcpReadiness options, runCodexDesktopChatRun(options: CodexDesktopChatRunOptions), and runAgentTask options and the real ledger/redaction serializer harness
- **WHEN** desktop/headless runs executed by the named hosts emit events for persistence or renderer/CLI/protocol/API exposure and the real ledger/redaction harness compares committed records with projected envelopes
- **THEN** the events pass through the canonical runtime event and redaction
  owners before persistence or external exposure
- **AND** surface-specific envelopes may map those events without owning a
  second event vocabulary
- **AND** serialized envelopes equal the fixture baseline, including redaction and event ordering, with no catalog-created event

#### Scenario: Temporary dual execution path is required
<!-- Scenario register: S50; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/architecture-fixtures.json#S50` with restored-selector and dual-path flag source mutations
- **WHEN** a source mutation attempts to keep an old selector or introduce a temporary dual execution path and retired-route-selector plus route-catalog-test-port-in-production scan the fixtures
- **THEN** both source mutations are rejected by their exact expected findings and the production source scan reports neither an old selector nor a production path-selection flag
- **AND** any separately approved temporary dual path must declare its canonical owner, explicit migration gate, deletion condition/follow-up and tests of the active path; callers cannot silently choose between paths without that gate. This catalog cutover permits no temporary dual path.
<!-- governance-only clause; not test-registered. -->

### Requirement: Canonical Chat Message Model And Normalization

The system SHALL maintain a single canonical chat message model and a single owner
for **persisted-message** normalization (the hydration moment), distinct from the
live runtime-event-state path. The canonical model SHALL cover the AI SDK base
parts, the app's local data parts, and local message-level fields, not only the AI
SDK generic, and SHALL distinguish persisted/hydrated parts from render-derived
parts. The model and its part schema SHALL be defined once in a shared location
that does not depend on renderer or main code, and the renderer send-side type and
main create-input schema SHALL derive from that single definition. Low-level
tool-shape primitives SHALL exist as single shared functions reused by both the
hydration normalizer and the render path. Persisted sub-chat messages SHALL be
hydrated through the one hydration normalizer, and renderer chat consumers SHALL
type against the canonical model rather than casting persisted or streamed messages
to `any`. The canonical model governs the renderer read/hydration side; the
main-process write side may adopt it later without a second definition.

#### Scenario: Persisted messages are hydrated

- **WHEN** the renderer loads persisted sub-chat messages from storage
- **THEN** the messages are normalized through the single persisted-message
  normalizer that returns the canonical message model
- **AND** the normalizer is unit-tested for legacy tool-invocation migration,
  Codex MCP and ACP tool-shape normalization, and tool state mapping

#### Scenario: Canonical model covers local shapes

- **WHEN** the canonical message model is defined
- **THEN** it is a local extension of the AI SDK message type (the AI SDK message
  requires `parts` and fixes data-part discriminants, which the app's parts do not
  follow), preserving optional `parts`, a message-level `createdAt` typed to match
  what is persisted (an ISO string), and typed metadata extensions
- **AND** the persisted part union encodes the AI SDK base parts and the local data
  parts the app persists (image attachments, file attachments, file content,
  long-text attachments, legacy image data)
- **AND** the AI SDK base part union is narrow and explicit, excluding generic
  `DataUIPart`, so unregistered arbitrary `data-*` parts are not accepted; local
  `data-image` and `data-file` enter only through explicit local part definitions
- **AND** render-derived parts that are never persisted are kept in a separate
  renderable part union, not the persisted union
- **AND** tests assert every persisted part type is a member of the persisted union
  and every part type rendered by the chat view is a member of the renderable union,
  including a rejection case for an unregistered generic data part such as `data-foo`

#### Scenario: Message part shapes have one definition

- **WHEN** the renderer send-side type and the main create-input schema describe
  message parts
- **THEN** both derive from the single shared message-model definition (type and
  schema) rather than declaring part shapes independently
- **AND** the shared module does not depend on renderer or main code

#### Scenario: One set of normalization primitives, two moments

- **WHEN** tool-shape normalization is applied at hydration and at render time
- **THEN** both paths call the same shared primitive functions, with no second copy
- **AND** the single-owner rule forbids a second persisted-history normalizer, not
  the reuse of the shared primitives at render time

#### Scenario: Compatibility shim is removed and enforced

- **WHEN** the canonical model and normalizer are in place
- **THEN** the `mock-api` chat-and-normalization path is removed rather than kept
  as a parallel implementation
- **AND** genuine web-only stubs are relocated to a clearly named module
- **AND** the remaining chat call sites consume the canonical owner directly
- **AND** the architecture guard check fails if `mock-api` is reintroduced, if the
  persisted normalizer is exported from more than one module, or if a removed
  call-site import reappears

#### Scenario: Boundary casts are eliminated

- **WHEN** a transport, store, or chat view reads message parts or metadata
- **THEN** it narrows against the canonical message model instead of casting to
  `any`
- **AND** typed message metadata extensions are part of the canonical model

#### Scenario: Live event ownership is preserved

- **WHEN** streamed runtime chunks are normalized
- **THEN** `runtime-event-state.ts` remains the canonical owner for live event
  normalization
- **AND** the persisted-message normalizer does not duplicate that live path

### Requirement: Runtime MCP Config Service Ownership

The system SHALL use a canonical Runtime MCP Config service for shared MCP config
and status behavior, with per-runtime adapters for runtime-specific config and
session materialization.

#### Scenario: MCP config behavior is extracted from routes

- **WHEN** MCP config or status behavior is moved out of Claude or Codex route code
- **THEN** the Runtime MCP Config service becomes the canonical owner for that shared
  behavior
- **AND** the same change removes or replaces route-local helper/call sites for the
  old behavior
- **AND** `docs/OWNERSHIP_MAP.md` is updated to name the service owner, route callers,
  and runtime-specific adapters

#### Scenario: Runtime-specific MCP behavior remains adapter-owned

- **WHEN** Claude, Locus-managed Codex app-server, or a future runtime needs
  runtime-specific MCP config read/write or session materialization
- **THEN** that behavior lives in the runtime's MCP adapter
- **AND** shared MCP config/status semantics are not copied into another router

### Requirement: Runtime Capability Projection Ownership

The system SHALL maintain a single owner for runtime capability projection state
for capability kinds that register projection adapters. This owner SHALL NOT own
MCP configuration writes, MCP registry install/setup state, or MCP verified
usability proof.

#### Scenario: Projection logic is added or changed
- **WHEN** a change stages, symlinks, writes, checks, removes, or reports projected capabilities for a runtime
- **THEN** it updates the Runtime Capability Projection owner or its registered runtime adapter
- **AND** it does not add a second route-local, renderer-local, or runtime-specific install/projection truth table

#### Scenario: MCP server projection boundary is added
- **WHEN** a later approved change registers MCP servers with Runtime Capability Projection
- **THEN** Runtime MCP Config remains the owner for MCP config read/write and runtime materialization
- **AND** MCP registry install remains the owner for registry browse, setup, install, check, and verified usability state
- **AND** Runtime Capability Projection owns only per-runtime or per-run projection availability and non-secret projection diagnostics

#### Scenario: Temporary migration path is required
- **WHEN** an existing runtime-specific install path must remain during migration
- **THEN** the change declares the canonical owner, migration gate, deletion condition or follow-up, tests or guard coverage, and deprecation comment
- **AND** callers cannot silently choose between the old and new projection path

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
fails. A registry entry without a corresponding live one-hop finding SHALL also fail as
stale and SHALL be deleted, so the registry and live finding set remain symmetric. Modules
under `src/main/lib/` SHALL use extensionless paths relative to that
directory as registry names; repository-local modules outside it SHALL use extensionless
repository-relative paths, so shared modules cannot bypass the rule. Transitive reach
beyond one hop through wrapper modules remains allowed at this
stage and deferred by design; a direct import from a guarded directory into a banned
category still fails.

The checked-in architecture-baseline document SHALL be present, non-empty, valid JSON, and
valid against its complete canonical shape. Empty, whitespace-only, malformed, or invalid
baseline content SHALL fail the architecture check and SHALL NOT silently skip any ratchet.
During the normal blocking path, the working baseline SHALL be compared with the committed
`HEAD` baseline, the previous commit that changed the baseline, and the CI diff-base
baseline when present through the same only-shrink comparison used by update mode; a new
entry, export, or raised route count SHALL fail at a clean committed SHA and after a later
evidence-only commit, before the baseline can authorize growth. The CI diff-base revision
SHALL be self-locked and unreadable revisions or invalid committed baselines SHALL fail
closed. A diff base without this file MAY be accepted only for the authorized initial
bootstrap.

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

#### Scenario: Reach-through registry contains a stale entry

- **WHEN** the reach-through registry names a wrapper that has no corresponding live
  one-hop finding, even if the ownership-map mirror contains the same name
- **THEN** the architecture guard check fails with an instruction to delete the stale
  registry entry

#### Scenario: Architecture baseline content is unavailable or invalid

- **WHEN** the architecture-baseline file is missing, empty, whitespace-only, malformed,
  or invalid against the canonical shape
- **THEN** the architecture guard check fails closed
- **AND** it does not report success after skipping the route, import, direction, or
  reach-through assertions

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

### Requirement: Canonical Runtime Event Mapping Single Path
The architecture guard SHALL statically enforce the canonical event owners and import
boundary. createRunEvent SHALL be defined only in agent-runtime/runtime-events.ts;
createCanonicalRunEventLedger in run-event-ledger.ts; getOrCreateRunEventLedger in
run-event-ledger-host.ts; projectRunEventToRendererChunks in stream-event-mapper.ts;
admitRunArtifactCandidate in run-artifacts.ts; redactRuntimePayload and
redactExactSecretHints in redaction.ts. These module paths are under src/main/lib/.
The exact store append export appendExactRunEventBatch SHALL exist only in
headless/job-store.ts, with a private record insert helper; its sole direct importer
SHALL be agent-runtime/run-event-ledger-host.ts. captureRunExecutionProvenance SHALL
be defined only in agent-runtime/run-provenance.ts; the ledger host SHALL be the only
composition path binding its tuple to a Run. The removed legacy exports and internal helpers
mapDesktopStreamChunkToRunEvents, createDesktopStreamEventMapper,
appendRunEventsToAgentJob, redactRendererDiagnosticChunk, redactRendererRuntimeChunk,
createRuntimeRendererChunkEmitter, createRuntimeStreamChunkSecretRedactor,
isDesktopRuntimeFailureChunk, persistedPayloadForRunEvent, createAgentJobRunEvent and
appendAgentJobEvent SHALL have no definitions, re-exports or call sites. Historical
ledger_version=0 decoding SHALL be confined to the single versioned Workbench reader;
it SHALL NOT restore a wrapper writer or a live legacy event path.
Direct inserts into agentJobEvents outside job-store SHALL also be rejected by the
static guard (including the schedules bypass). Static checks SHALL assert source
structure, not secret leakage or runtime outcomes.

#### Scenario: Second event mapping definition appears
- **WHEN** `architecture-fixtures.json` injects a duplicate definition or re-export of
  a pinned symbol outside its stated canonical module
- **THEN** the guard fails with the file/symbol and points to Ownership Map's Runtime
  Events, Trace, And Redaction section; the clean owner fixture passes

#### Scenario: Route or runtime adapter writes job events directly
- **WHEN** the fixture adds an appendExactRunEventBatch import in a route, Codex/Claude
  adapter, or any file except run-event-ledger-host.ts
- **THEN** the guard fails naming the file and required ledger host entry
- **AND** a legacy appendAgentJobEvent/createAgentJobRunEvent import or definition is
  also rejected, and job-store's record insert cannot be exported
- **AND** a schedules-style direct db.insert(agentJobEvents) outside the store is rejected

#### Scenario: Guard proves its own detection
- **WHEN** the guard scans clean, duplicate-definition, forbidden-import, exported-insert,
  direct-event-insert and legacy-symbol fixtures in `architecture-fixtures.json`
- **THEN** exact expected static findings are matched, and missing/unexpected findings
  fail the self-test; runtime fault/redaction/terminal behavior is tested in core instead

### Requirement: Route Surface Growth Ratchets

The architecture guard check SHALL enforce a machine-readable ratchet baseline over the
line count and exact named-export set of `src/main/lib/trpc/routers/claude.ts` and
`src/main/lib/trpc/routers/codex.ts`. A measured line count above the baseline, or an export
absent from the baseline set, SHALL fail the check. A measured line count below the baseline
SHALL also fail with an instruction to tighten the baseline, so the recorded baseline always
equals reality. Baseline raises SHALL require an explicit hand edit carrying a recorded
reason plus an Owner-approved guard/spec change that authorizes the exception.

The shared mechanism SHALL preserve distinct ownership meanings. The Claude route SHALL be
identified as a temporary-owner containment ratchet and SHALL retire in the approved change
that removes its temporary-owner clause after extraction. The Codex route SHALL be identified
as an orchestration-boundary no-growth ratchet and SHALL NOT be described as a temporary
owner. Its ratchet SHALL retire only through an explicit Owner decision, or in the same
approved change that structurally decomposes the route in a later phase such as Job Kernel.

#### Scenario: Ratcheted route grows

- **WHEN** `claude.ts` or `codex.ts` exceeds its baseline line count or adds an export not
  in its baseline set
- **THEN** the architecture guard check fails, naming the route, the measured value, and
  the baseline value

#### Scenario: Ratcheted route shrinks

- **WHEN** extraction moves logic out of a ratcheted route and its measured line count
  falls below the baseline
- **THEN** the architecture guard check fails with the exact lower value to record
- **AND** the same change tightens the baseline to that value

#### Scenario: Codex orchestration ratchet retirement

- **WHEN** the Codex route remains the canonical orchestration boundary after service
  extraction
- **THEN** removal of an old temporary-owner clause does not retire its no-growth ratchet
- **AND** retirement requires an explicit Owner decision or accompanies an approved
  structural decomposition of that route

### Requirement: Single Async Submission And Wait Ownership

The architecture guard SHALL pin submitRun and waitForRun to
src/main/lib/headless/run-submission.ts and API queue execution to the existing
headless/daemon.ts queue owner. CLI API and jobs-stdio handlers SHALL be envelope
adapters over those owners. The former runPreparedLocalJobApiJob and API create/retry
inline runner calls SHALL be absent. Q2(a) wrapper and stdio SHALL both be allowed
to call the same daemon.ts pumpQueuedRuns symbol scoped to their admitted IDs, without
independent dispatch or runner calls. Duplicate store row creation in API/stdio/schedule
adapters SHALL be replaced by the canonical job-store creation primitive. This rule
SHALL preserve human one-shot locus run and desktop runtime execution boundaries.
The ledger host SHALL remain the sole appendExactRunEventBatch importer; the artifact
owner SHALL own publication verification and all credential/redaction owners SHALL
remain unchanged. The guard SHALL validate structure; runtime semantics SHALL be
verified by behavior fixtures rather than inferred from symbol counts.

#### Scenario: S32 Guard rejects an inline API execution fallback
- **GIVEN** `tests/fixtures/local-job-api-async/guards-protocol/architecture-fixtures.json#S32`, with clean source fixtures and variants restoring runPreparedLocalJobApiJob,
  inserting runPersistedAgentJob or runPersistedCompletionJob into API create/retry,
  or adding an independently dispatching jobs-stdio loop; the clean fixture includes
  API wrapper and stdio calls to the same pumpQueuedRuns with own-ID scope
- **WHEN** the architecture guard scans each fixture
- **THEN** the clean fixture passes and each variant reports its exact file/symbol
  and required submit/queue owner, while the human locus run call is permitted
- **AND** the guard self-test fails if a required finding is missing or unexpected

#### Scenario: S33 Guard rejects duplicate creation and ledger writers
- **GIVEN** `tests/fixtures/local-job-api-async/guards-protocol/architecture-fixtures.json#S33`, with fixtures duplicating submitRun/waitForRun outside their owner, inserting
  agent_jobs directly in an API/stdio/schedule adapter, and importing
  appendExactRunEventBatch outside run-event-ledger-host.ts
- **WHEN** the architecture guard and its negative-fixture suite run
- **THEN** each violation is rejected with its owner location, while schedule's use of
  the shared store insertion primitive within its audit transaction passes
- **AND** no optional migration setting can permit a live old/new submission core or
  restore the retired ledger transition gate

### Requirement: Schedule Uses Canonical Job Insertion

Schedule creation SHALL replace createScheduleJobRecord's duplicate row construction
with the job-store insertion primitive inside its existing fire/audit/nextRunAt
transaction, then record creation through the ledger host. This SHALL be an atomic
internal refactor, not a second scheduling or API idempotency path.

#### Scenario: S31 Schedule creation retains one fire without bypassing creation facts
- **GIVEN** `tests/fixtures/local-job-api-async/guards-protocol/schedule.json#S31`, with a due schedule, two SQLite connections racing the same scheduledFor time,
  and a variant failing the post-transaction creation append
- **WHEN** evaluateDueAgentSchedules fires and listQueuedAgentJobsForSource reads schedule work
- **THEN** the successful fixture has one job/audit fire and advances nextRunAt once,
  with job_created recorded only through the host
- **AND** the failed-append fixture remains unacknowledged as executable work and
  cannot be claimed; no API idempotency key or second schedule state machine is created

### Requirement: Runtime Route Catalog Single Owner

The architecture guard SHALL pin production runtime/adapter/transport route
declarations and selection to `src/main/lib/agent-runtime/runtime-route-catalog.ts`.
Adapters, tRPC/CLI/protocol surfaces and renderer consumers SHALL NOT introduce
their own catalog-covered runtime-keyed dispatch table or runtimeId branch selecting factories
or transports. The existing headless selector, registry facade, desktop factory,
runtime-specific selection wrappers and the two renderer transport-construction Engine branches SHALL be
deleted or replaced atomically, with no old-path export or feature flag.
OWNERSHIP_MAP SHALL name the new owner and remove superseded selection ownership.
Existing ledger/host, submission/pump, artifact, capability, provider, policy,
projection and renderer event-state owners SHALL retain their semantics.
Named existing approval dispatch, UI defaults/accounting/MCP, binding allowlists
and alias interpretation remain adjacent owners; these are not claims of complete
third-Runtime integration. Direct fixed-runtime leaf execution SHALL NOT bypass
the catalog: run/create exports from headless/adapters and the Codex/Claude
adapter runners SHALL be value-importable only by the catalog and tests.
The Claude lifecycle wrapper SHALL receive the catalog-selected typed delegate
through agent-sdk-desktop-run-runtime and SHALL NOT value-import the leaf run export.
The guard SHALL accept --runtime-route-catalog-fixtures=<path>, defaulting to
tests/fixtures/runtime-route-catalog/architecture-fixtures.json, and compare exact
{rule,file,symbol,owner,ownerSection} tuples. ownerSection SHALL be
"Runtime Route Catalog Single Owner". Its summary SHALL be
"Runtime route catalog guard self-test: <matched>/<cases> fixture cases matched; repository ownership enforced."
Existing ledger and async guard self-test output/flags SHALL remain unchanged.

#### Scenario: S26 Duplicate routing is detected through direct and aliased forms
- **GIVEN** `tests/fixtures/runtime-route-catalog/architecture-fixtures.json#S26` with negative sources containing if/switch on runtimeId, a runtime-keyed factory map, aliased/namespace retired-selector calls and a one-hop wrapper outside the owner, and a fixed-runtime direct leaf run/create import and call, including agent-sdk-runtime-lifecycle.ts directly value-importing runClaudeAgentSdkDesktopAdapterWithPreparedRuntimeQuery from agent-sdk-adapter-runner
- **WHEN** the architecture scanner runs --runtime-route-catalog-fixtures=tests/fixtures/runtime-route-catalog/architecture-fixtures.json against S26 cases (including route-dispatch-outside-owner, retired-route-selector and leaf-adapter-import-outside-catalog)
- **THEN** each variant reports its exact rule/file/symbol/owner/ownerSection tuple, and missing or unexpected findings fail the self-test
- **AND** the guard does not claim coverage of arbitrary reflection or unbounded transitive calls

#### Scenario: S27 All retired selector symbols and transport branches are absent
- **GIVEN** `tests/fixtures/runtime-route-catalog/architecture-fixtures.json#S27` restoring headless/adapter-selector.ts, agent-runtime/runtime-registry.ts, getAgentRuntimeAdapter/selectAgentRuntimeAdapter/SelectAgentRuntimeAdapterOptions/preferredAdapterSource exports, DesktopRuntimeAdapterFactory, resolveCodexDesktopAdapterSelection, resolveCodexAppServerDesktopAdapter, resolveClaudeAgentSdkDesktopAdapter, forwarding aliases, or either original active-chat transport runtime branch
- **WHEN** the architecture guard scans the production tree and each restored-symbol/branch fixture with retired-route-selector or renderer-route-projection-bypass
- **THEN** the production tree has no retired symbol/branch and each mutation yields its exact expected finding tuple
- **AND** desktop ledger helpers, adapter-local assertions and pump kind dispatch remain; real desktop/query/probe rewiring is proved by S03/S11/S16 spies, not by restoring legitimate pump/router functions and requiring a static failure

#### Scenario: S28 Catalog imports preserve runtime core direction
- **GIVEN** `tests/fixtures/runtime-route-catalog/architecture-fixtures.json#S28` with clean lazy factory/probe references and mutations importing Electron, tRPC, renderer, preload, a route through a wrapper, or a readiness-to-catalog recursion
- **WHEN** import and catalog-composition guards run
- **THEN** clean references pass and each forbidden dependency or cycle is rejected without widening existing architecture baselines
- **AND** the catalog cannot reverse-import a router to execute a Run or use renderer transport code in main

#### Scenario: S29 Adjacent legitimate owners are not banned as routing duplicates
- **GIVEN** `tests/fixtures/runtime-route-catalog/architecture-fixtures.json#S29` with positive fixtures for provider target/purpose mapping, policy mode checks, source-based job cancel, command/method parsing, native protocol decoding, selected-route assertions, transportId-only factory construction, chunk.type event state, codex-app-server.ts:49 runtime/profile/bounded-scope assertions, chat-session-binding admit gates and provider target, desktop allowlist, active-chat new-binding/token/MCP branches (:346/:2513/:5866) and approval dispatch (:2678), runtime-manifest aliases, job-runner resolveRunner ENV/injected runner seam and API-only source/profile gate, plus pump job.kind dispatch and agent-sdk-runtime-lifecycle receiving the typed Claude delegate injected through agent-sdk-desktop-run-runtime rather than value-importing the leaf
- **WHEN** the new guard and existing owner guards scan these fixtures
- **THEN** each permitted fixture passes, but a paired mutation that uses runtimeId to choose a second adapter fails
- **AND** withRuntimeRouteTransportId looks up transportId through the catalog projection without a literal map and is not flagged by route-dispatch-outside-owner
- **AND** the exceptions are structural and symbol-specific, never a whole-adapter-directory allowlist

#### Scenario: S30 Catalog composition cannot create another business core
- **GIVEN** `tests/fixtures/runtime-route-catalog/architecture-fixtures.json#S30` with mutations that insert jobs/events, claim queued jobs, allocate sequence, settle terminal, prepare artifacts, read/decrypt provider storage, read process.env/fs/config, construct a production second catalog or supply a non-forwarded production runtimeRouteCatalog option, and a clean selection-only version
- **WHEN** the architecture guards and recording-port integration harness run
- **THEN** each mutation is rejected with the existing canonical owner, the clean version passes, and real API/stdio execution reaches submitRun and pumpQueuedRuns without a second dispatch loop
- **AND** route configuration has no production migration flag capable of re-enabling an old selector and the catalog reads no process.env/fs/config; the separately retained job-runner fake-runner seam is not used to prove catalog behavior
