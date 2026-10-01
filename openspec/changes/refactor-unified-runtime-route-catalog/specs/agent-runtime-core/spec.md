## ADDED Requirements

### Requirement: Declarative Runtime Route Catalog

The system SHALL own all production runtime-to-adapter and runtime-to-transport
selection in `src/main/lib/agent-runtime/runtime-route-catalog.ts`. The catalog
SHALL be a declarative TypeScript table with a single descriptor per runtime and
unique route IDs for its supported surfaces. It SHALL reference the existing
capability, readiness, policy and adapter owners, validate its schema and
references before use, and reject duplicate or overlapping selection domains.
It SHALL NOT load arbitrary caller-named modules or keep a mutable second registry.

#### Scenario: S01 Invalid declarations cannot become executable
- **GIVEN** `tests/fixtures/runtime-route-catalog/catalog.json#S01` with a valid table and separate duplicate runtime descriptor, duplicate route ID, overlapping route predicates, missing factory/probe/manifest, and invalid namespace/schema-reference variants
- **WHEN** `validateRuntimeRouteCatalog` validates each table against injected reference ports
- **THEN** the valid table succeeds and each invalid table identifies its exact offending declaration and internal `catalog_invalid` reason
- **AND** no invalid table is usable by the resolver and factory, probe, provider and spawn counts remain zero

#### Scenario: S02 Query and enumeration are deterministic and side-effect free
- **GIVEN** `tests/fixtures/runtime-route-catalog/catalog.json#S02` with declarations in two orders, permuted duplicate capability requests, and recording factory/probe/DB ports
- **WHEN** `resolveRuntimeRoute` and `listRuntimeRoutes` are invoked on both tables
- **THEN** equivalent queries resolve the same route and enumeration has a stable routeId order independent of insertion order
- **AND** mutation of a returned descriptor cannot change a later query; all recording ports remain uncalled

### Requirement: Surface Aware Runtime Route Resolution

Route resolution SHALL distinguish runtimeId, surface, kind, mode, execution
profile, required capabilities, permission-policy evidence and internal required
extensions. API and protocol entry surfaces SHALL reference the same execution
leaf as their corresponding headless surface; they SHALL NOT create duplicate
adapter tables. A missing or ambiguous route SHALL fail closed without changing
runtime, provider, profile or transport. A valid selection SHALL preserve the
existing native surface and pass verified context to the selected factory only
at the existing host execution boundary.

#### Scenario: S03 Desktop routes select the existing native adapters
- **GIVEN** `tests/fixtures/runtime-route-catalog/routes.json#S03` with verified Claude and Codex desktop plan/agent requests, fake factory ports, and blocked preflight variants
- **WHEN** each desktop host resolves and invokes its route
- **THEN** successful Claude requests call the Claude Agent SDK factory once and Codex requests call the app-server factory once with the original verified context, signal, ledger and session references
- **AND** preflight failures call neither factory nor provider; no exec or cross-runtime fallback occurs

#### Scenario: S04 Entry surfaces resolve to the same batch leaf
- **GIVEN** `tests/fixtures/runtime-route-catalog/routes.json#S04` with batch requests for both runtimes through headless-exec, API and protocol plus CLI/daemon/schedule source provenance
- **WHEN** the catalog resolves each accepted request
- **THEN** Claude selects claude-code-batch and Codex selects codex-batch, with the same leaf factory for equivalent requests and source provenance unchanged
- **AND** the presence of a ready rich adapter does not change selection

#### Scenario: S05 Policy grant does not upgrade adapter enforcement
- **GIVEN** `tests/fixtures/runtime-route-catalog/policy.json#S05` with a valid Codex API policy-grant, a Claude policy-grant, missing/invalid grant variants and a hardToolGuard requirement
- **WHEN** the existing policy owner resolves policy and the catalog evaluates the resulting requests
- **THEN** only the valid Codex grant selects headless-app-server with admission-audit-only scope binding
- **AND** Claude grant, invalid grant and hardToolGuard variants preserve their baseline refusal diagnostics/error codes and perform zero provider calls or spawns
- **AND** no scope string is promoted into pre-execution enforcement

#### Scenario: S06 Missing and ambiguous routes fail closed
- **GIVEN** `tests/fixtures/runtime-route-catalog/refusals.json#S06` with unknown runtime, missing surface, illegal kind/mode/profile combinations and an intentionally invalid ambiguous test catalog
- **WHEN** `resolveRuntimeRoute` is called before execution
- **THEN** it returns structured route_not_found, catalog_invalid or route_ambiguous as appropriate without returning an executable factory
- **AND** it never substitutes Claude, batch, a different provider or a first matching declaration; no Run is created by the query

#### Scenario: S07 A renderer descriptor cannot override the binding
- **GIVEN** `tests/fixtures/runtime-route-catalog/renderer.json#S07` with a DB-bound Codex chat and a stale or tampered Claude routeId/transportId descriptor
- **WHEN** the desktop main host re-admits the request and resolves the route from the canonical binding
- **THEN** the mismatch is rejected through the existing desktop failure envelope before runtime startup and no Claude factory is called
- **AND** neither descriptor nor external runId becomes execution ownership or authorization

#### Scenario: S08 Existing explicit preference fallback remains observable
- **GIVEN** `tests/fixtures/runtime-route-catalog/policy.json#S08` with baseline headless requests using a preferred interactive source while the eligible batch source is selected, plus an explicit interactive-profile refusal
- **WHEN** the catalog resolves these requests
- **THEN** the allowed preference case preserves selected adapterSource, preferredAdapterSource and preferred_adapter_unavailable diagnostic without upgrading capability support
- **AND** the explicit interactive-profile case is refused with its baseline error and never treated as permission to downgrade

#### Scenario: S09 Completion routes are provider-only execution
- **GIVEN** `tests/fixtures/runtime-route-catalog/completion.json#S09` with both accepted runtime-family completion requests, explicit profile references, and missing-profile/agent-only-field variants
- **WHEN** the API submits them and the pump invokes the catalog-selected completion delegate
- **THEN** each valid attempt invokes the existing completion runner and exactly one fake upstream request, with no agent adapter, runtime child or run-directory creation
- **AND** invalid variants fail at their existing validation stage; completion provenance remains locus-completion and no synthetic agent mode or installation is invented

### Requirement: Route Catalog Preserves Adjacent Owners

The catalog SHALL NOT own or duplicate submission, queue/claim, cancellation,
provider selection, events, artifact admission, native session state or
RuntimeInstallation resolution. Existing admission, execution and finalization
owners SHALL consume its selection while retaining their ordering and authority.

#### Scenario: S31 Codex desktop failure does not activate a batch fallback
- **GIVEN** `tests/fixtures/runtime-route-catalog/routes.json#S31` with a selected Codex desktop app-server factory that fails and a separately available exec factory
- **WHEN** the desktop host executes and finalizes the selected route
- **THEN** only app-server is invoked, its failure goes through the existing finalizer/ledger and exec is never invoked
- **AND** no new Run, retry, runtime installation or terminal event is created by the catalog

#### Scenario: S32 Provider precedence and secret handling stay with binding owners
- **GIVEN** `tests/fixtures/runtime-route-catalog/provider.json#S32` with explicit profile, model-only, omitted selection with good/bad default, and native credential cases for both runtimes, plus nonsecret sentinel credential values
- **WHEN** the existing provider owner resolves each case and its host executes the selected route
- **THEN** explicit/model-only/default/native precedence and baseline errors remain identical; bad selected/default profiles never fall through to native credentials
- **AND** gateway cleanup runs through the existing owner, no descriptor contains sentinel credentials/headers/env/factory functions, and the catalog does not read/decrypt provider storage
