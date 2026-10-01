## ADDED Requirements

### Requirement: Declarative Runtime Route Catalog

The system SHALL own catalog-covered main runtime-to-adapter and runtime-to-transport
selection in `src/main/lib/agent-runtime/runtime-route-catalog.ts`. The catalog
SHALL be a declarative TypeScript table with a single descriptor per runtime and
unique route IDs for its supported surfaces. It SHALL reference the existing
capability, readiness, policy and adapter owners, validate its schema and
references before use, and reject duplicate or overlapping selection domains.
It SHALL NOT load arbitrary caller-named modules or keep a mutable second registry.
In these scenarios, "before provider work" means before native provider calls or
adapter startup; existing provider-binding reads and recordResolvedProvider
ordering SHALL remain unchanged. Production queries SHALL use the module-private deep-frozen validated singleton;
only tests MAY construct a catalog or supply the guarded runtimeRouteCatalog port.
Initialization failure SHALL disable resolution and partial discovery without
crashing module import. Existing desktop approval dispatch and runtime-specific
wire/admission owners remain outside this catalog selection boundary.

#### Scenario: S01 Invalid declarations cannot become executable
- **GIVEN** `tests/fixtures/runtime-route-catalog/catalog.json#S01` with valid production declarations/real reference ports and isolated duplicate-runtime, duplicate-route, overlap, agent missing factory / missing manifest/schema, malformed namespace, enforcement-evidence mismatch, agent-missing-probe and completion-null-probe variants
- **WHEN** validateRuntimeRouteCatalog validates each table (including the real production table/ports) and createRuntimeRouteCatalogForTests constructs each RuntimeRouteCatalogState for injection into the named hosts
- **THEN** the validator returns {ok:true,catalog:ValidatedRuntimeRouteCatalog} for production/valid/completion-null-probe tables and {ok:false,reason:"catalog_invalid",offending:{…}} for every invalid table; the test constructor returns the same non-executable RuntimeRouteCatalogFailureState production initialization retains, without throwing or returning a branded catalog; no factory/probe/provider/spawn is called
- **AND** injecting that failure state via runtimeRouteCatalog in RunHeadlessCliCommandOptions / LocalJobApiRuntimeManifestEnvelopeOptions / runClaudeAgentSdkDesktopRuntimeWithMcpReadiness options / runCodexDesktopChatRun options / runAgentTask options makes resolveRuntimeRoute return {ok:false,reason:"catalog_invalid"}, list/projection reject with no partial output, and runHeadlessCliCommand reject with exactly "Runtime route catalog is unavailable." with empty stdout. Desktop uses its existing stream error/finish envelope with that same message; the headless runner settles runtime_error/1 with that message (S24); withRuntimeRouteTransportId omits transportId (S53, renderer not-loaded). The production CLI mapping is the existing [Headless] Failed: stderr and exit 1 at src/main/index.ts:435–437, not the bun test entry; no catalog reason is public

#### Scenario: S02 Query and enumeration are deterministic and side-effect free
- **GIVEN** `tests/fixtures/runtime-route-catalog/catalog.json#S02` with declarations in two orders, permuted duplicate capability requests, and recording factory/probe/DB ports
- **WHEN** `resolveRuntimeRoute` and `listRuntimeRoutes` are invoked on both tables
- **THEN** equivalent queries resolve the same route and enumeration has a stable routeId order independent of insertion order
- **AND** mutation of a returned descriptor cannot change a later query; all recording ports remain uncalled

### Requirement: Surface Aware Runtime Route Resolution

Route resolution SHALL distinguish runtimeId, entry, kind, mode, execution
profile, required capabilities, permission-policy evidence and internal required
extensions. API and protocol entry surfaces SHALL reference the same execution
leaf as their corresponding headless surface; they SHALL NOT create duplicate
adapter tables. executionSurface SHALL be output only. Required capabilities SHALL be the typed
owner-derived implicit/explicit union; agent permissionPolicy SHALL be non-null.
Overlapping domains SHALL fail validation with catalog_invalid; the resolver
SHALL match only validated catalogs or return catalog_invalid immediately for the non-executable RuntimeRouteCatalogFailureState; raw declarations SHALL NOT be accepted. A missing route SHALL fail closed without changing
runtime, provider, profile or transport. A valid selection SHALL preserve the
existing native surface and pass verified context to the selected factory only
at the existing host execution boundary.

#### Scenario: S03 Desktop routes select the existing native adapters
- **GIVEN** `tests/fixtures/runtime-route-catalog/routes.json#S03` with verified Claude/Codex plan/agent requests, runClaudeAgentSdkDesktopRuntimeWithMcpReadiness options and NEW runCodexDesktopChatRun(options: CodexDesktopChatRunOptions) runtimeRouteCatalog ports containing recording typed delegates, and blocked admission/preflight variants
- **WHEN** the harness calls the real admission/preflight owners followed by runClaudeAgentSdkDesktopRuntimeWithMcpReadiness or runCodexDesktopChatRun as the corresponding procedure does, and source guards check that claude.chat/codex.chat call those hosts after admission without direct leaf imports
- **THEN** Claude invokes only its SDK delegate once and Codex only its app-server delegate once with unchanged verified context/signal/ledger/session references; recording catalog ports prove both named hosts queried their fixed runtime and asserted typed routes before passing secret-bearing inputs; source guards bind both procedures to those same hosts
- **AND** admission/preflight failures call no delegate/provider/secret reader; no route-local leaf call or adapterSource narrowing switch is used; codex.getRuntimeStatus adapters.selection and hints match the baseline projection

#### Scenario: S04 Entry surfaces resolve to the same batch leaf
- **GIVEN** `tests/fixtures/runtime-route-catalog/routes.json#S04` with validated catalogs and both runtimes' batch queries for entry=headless/api/protocol, with CLI/daemon/schedule source provenance and ready rich probes
- **WHEN** resolveRuntimeRoute receives each owner-normalized query, with no executionSurface input
- **THEN** Result.adapterSource is claude-code-batch or codex-batch respectively, Result.executionSurface is headless-exec, and equivalent entries reference the identical leaf delegate; job source remains unchanged
- **AND** ready rich probes cannot change the selected leaf and no probe is invoked by resolution

#### Scenario: S05 Policy grant does not upgrade adapter enforcement
- **GIVEN** `tests/fixtures/runtime-route-catalog/policy.json#S05` with named variants codex-policy-grant, claude-policy-grant, fail-closed, interactive, invalid-grant and hard-tool-guard, an out-of-union executionProfile cast for the otherwise unreachable unsupported-profile order step, plus direct Codex leaf calls with wrong runtime, wrong profile or empty grantedScopes and a recording createDesktopAdapter port
- **WHEN** the policy owner resolves policy, resolveRuntimeRoute evaluates its diagnostic candidate, and the runner returned by createCodexAppServerHeadlessTaskRunner({ createDesktopAdapter: recording }) (src/main/lib/headless/adapters/codex-app-server.ts:186) is separately called for the three invalid leaf inputs
- **THEN** only valid Codex grant selects executionSurface=headless-app-server with admission-audit-only binding; Claude grant retains candidateAdapterSource=claude-code-batch and candidateAdapterLabel=Claude Code batch
- **AND** refusal order is fail-closed, grant enforcement, pre-execution, interactive, unsupported profile, then capabilities; baseline codes/messages from src/main/lib/headless/adapter-selector.ts:209–343 remain exact, including policy_grant_adapter_unavailable for Claude and interactive_channel_required for the internal interactive case
- **AND** direct leaf variants retain unsupported_runtime / unsupported_execution_profile / permission_policy_fail_closed respectively (src/main/lib/headless/adapters/codex-app-server.ts:49–75), all refuse with zero recording createDesktopAdapter/provider/spawn calls; scope strings never upgrade enforcement

#### Scenario: S06 Missing routes and invalid catalogs have distinct oracles
- **GIVEN** `tests/fixtures/runtime-route-catalog/refusals.json#S06` with unknown and retired runtime IDs migrated from agent-runtime-registry tests, missing entry, illegal kind/mode combinations and a separate overlapping declaration table
- **WHEN** validateRuntimeRouteCatalog handles the overlapping table and resolveRuntimeRoute handles the other queries against validated catalogs
- **THEN** overlap returns only catalog_invalid at validation and cannot reach resolution; unknown/retired/missing/illegal queries return route_not_found without an executable delegate
- **AND** there is no route_ambiguous result, first-match or cross-runtime/provider fallback; the pure query creates no Run and invokes no factory/provider/probe

#### Scenario: S07 A wrong desktop procedure cannot override the binding
- **GIVEN** `tests/fixtures/runtime-route-catalog/renderer.json#S07` with a durable Codex subChat and a stale renderer transport that invokes claude.chat, with recording factory/provider/secret ports
- **WHEN** the real Claude chat admission calls admitClaudeChatSessionBindingRun for that subChat
- **THEN** it emits the existing rejectStaleRunPayload message "Claude run input no longer matches the durable chat session binding." and hint "Refresh this chat and retry with its current runtime, source, and model selection." (src/main/lib/chat-session-binding.ts:201–209, :279), with zero factory/provider/secret calls
- **AND** routeId/transportId never cross chat request IPC; the renderer read descriptor cannot become execution authorization or replace the DB binding

#### Scenario: S08 No dead preference option or implicit downgrade remains
- **GIVEN** `tests/fixtures/runtime-route-catalog/policy.json#S08` with accepted batch queries, an internal interactive profile query and source fixtures importing the retired preferredAdapterSource option
- **WHEN** resolveRuntimeRoute runs and the retired-route-selector guard scans the obsolete option fixture
- **THEN** batch Result.diagnostic.fallbackReason is null and public runtime_selected retains fallbackReason:null; interactive refuses with the baseline interactive_channel_required diagnostic rather than downgrading
- **AND** the old preference option/export is absent and its source fixture is rejected; no compatibility alias or preferred_adapter_unavailable path is retained

#### Scenario: S09 Completion routes are provider-only execution
- **GIVEN** `tests/fixtures/runtime-route-catalog/completion.json#S09` with both accepted runtime-family completion requests, explicit profile references, and missing-profile/agent-only-field variants
- **WHEN** the API submits them and pumpQueuedRuns chooses the existing completion runner by job.kind and the catalog is queried separately for completion metadata
- **THEN** each valid attempt invokes the existing completion runner and exactly one fake upstream request, with no agent adapter, runtime child or run-directory creation
- **AND** invalid variants fail at their existing validation stage; completion provenance remains locus-completion and no synthetic agent mode or installation is invented

### Requirement: Route Catalog Preserves Adjacent Owners

The catalog SHALL NOT own or duplicate submission, queue/claim, cancellation,
provider selection, events, artifact admission, native session state or
RuntimeInstallation resolution. Existing admission, execution and finalization
owners SHALL consume its selection while retaining their ordering and authority.

#### Scenario: S31 Codex desktop failure does not activate a batch fallback
- **GIVEN** `tests/fixtures/runtime-route-catalog/routes.json#S31` with runCodexDesktopChatRun(options: CodexDesktopChatRunOptions) runtimeRouteCatalog test option containing a selected failing app-server factory and a separately available exec factory
- **WHEN** runCodexDesktopChatRun executes the selected route and the existing finalizer settles it
- **THEN** only app-server is invoked, its failure goes through the existing finalizer/ledger and exec is never invoked
- **AND** no new Run, retry, runtime installation or terminal event is created by the catalog

#### Scenario: S32 Provider precedence and secret handling stay with binding owners
- **GIVEN** `tests/fixtures/runtime-route-catalog/provider.json#S32` with explicit profile, model-only, omitted selection with good/bad default, and native credential cases for both runtimes, plus nonsecret sentinel credential values
- **WHEN** the existing provider owner resolves each case and its host executes the selected route
- **THEN** explicit/model-only/default/native precedence and baseline errors remain identical; bad selected/default profiles never fall through to native credentials
- **AND** gateway cleanup runs through the existing owner, no descriptor contains sentinel credentials/headers/env/factory functions, and the catalog does not read/decrypt provider storage

## MODIFIED Requirements

### Requirement: Agent Runtime Contract
The system SHALL define an explicit `AgentRuntime` contract implemented by every supported coding-agent runtime driver.

#### Scenario: Runtime is registered
<!-- Scenario register: S33; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/catalog.json#S33` with the real production declaration/reference set and duplicate runtime variants
- **WHEN** the application starts or runtime services initialize and validateRuntimeRouteCatalog validates the production declarations/references before projectRuntimeRoutes returns metadata
- **THEN** each supported runtime declares in the canonical runtime route catalog a runtime ID, display metadata, a capability manifest sourced from `agent-runtime-capabilities`, run entry point, cancellation behavior, and session-reference behavior
- **AND** the catalog validator rejects duplicate runtime IDs
- **AND** the renderer receives only non-secret runtime metadata and capability summaries

#### Scenario: Runtime-specific behavior is not forced into the contract
<!-- Scenario register: S34; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/capabilities.json#S34` with a basic-run adapter and unsupported optional capabilities
- **WHEN** a runtime lacks rollback, fork, workflows, plugins, runtime commands or runtime-specific session operations and resolveRuntimeRoute exposes its basic route/manifestRef using getAgentRuntimeCapabilityManifest fixture states
- **THEN** basic resolution returns ok:true with the expected manifestRef and delegate, while optional capability requests return the existing capability refusal
- **AND** recording optional-feature ports remain uncalled and the basic run request contains no required provider-specific optional fields

#### Scenario: Caller requests runtime capabilities
<!-- Scenario register: S35; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/capabilities.json#S35` with each canonical manifest and sanitized descriptor expectations
- **WHEN** a desktop, CLI or main-process caller requests capabilities through projectRuntimeRoutes and getAgentRuntimeCapabilityManifest
- **THEN** the system returns the shared capability states for each registered runtime
- **AND** each capability state is explicit as `supported`, `degraded`, or `unsupported`
- **AND** degraded or unsupported states include a short reason when practical

#### Scenario: Runtime declares support
<!-- Scenario register: S36; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/capabilities.json#S36` with recording leaf ports for each declared supported capability
- **WHEN** a runtime declares a capability as supported and the corresponding catalog-selected adapter capability test exercises its recording leaf ports
- **THEN** recording ports observe the declared operation and its fixture result or enforcement decision from the actual adapter/shared layer
- **AND** a supported declaration with an uncalled enforcing port or mismatched result fails the conformance assertion
<!-- governance-only clause; not test-registered: tests must cover every declared supported behavior before its implementation checklist can pass. -->

### Requirement: Capability Honesty
The runtime core SHALL distinguish supported behavior from degraded or
unsupported behavior.

#### Scenario: Runtime supports hard tool guard
<!-- Scenario register: S37; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/capabilities.json#S37` with an adapter exporting pre-execution enforcement evidence and tool-decision recording ports
- **WHEN** a runtime reports hard tool guard as supported and resolveRuntimeRoute selects its adapter whose tool-decision port receives allow/deny/rewrite fixtures
- **THEN** the adapter can allow, deny, or rewrite a tool call before the tool
  executes
- **AND** the runner emits permission or guard events when a tool decision is
  made

#### Scenario: Runtime lacks pre-tool interception
<!-- Scenario register: S38; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/capabilities.json#S38` with a sandbox/admission-audit-only leaf and baseline UI/CLI capability diagnostics
- **WHEN** a runtime cannot intercept tool execution and resolveRuntimeRoute, projectRuntimeRoutes and the existing capability gate return its enforcement evidence and fixture diagnostics
- **THEN** the hard tool guard capability is reported as `degraded` or
  `unsupported`
- **AND** the renderer-facing capability DTO and CLI diagnostic match the degraded/unsupported fixture values and never report pre-execution enforcement
- **AND** prompt-only and post-run-audit variants expose only the fixture degraded-protection evidence

#### Scenario: Codex capability is missing
<!-- Scenario register: S39; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/capabilities.json#S39` with canonical Codex degraded/unsupported states and public/renderer projection expectations
- **WHEN** Codex cannot provide a capability that Claude supports and resolveRuntimeRoute, projectRuntimeRoutes and the caller capability gate consume that canonical manifest
- **THEN** the Codex capability manifest marks that capability as `degraded` or
  `unsupported`
- **AND** renderer-facing capability states/reasons and CLI diagnostics equal the fixture expectations, and a query requiring the missing capability returns capability_refused without calling its delegate
<!-- governance-only clause; not test-registered: runtime execution boundary changes may still complete when callers correctly gate the missing capability. -->

#### Scenario: Policy grant requires adapter enforcement
<!-- Scenario register: S40; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/policy.json#S40` with bounded grants and sandbox/admission-audit leaf evidence
- **WHEN** a non-desktop run requests policy-grant on an adapter lacking a pre-execution hook for the requested side-effect scope and resolveRuntimeRoute plus runAgentTask emit the policyGrantScopeBinding or refusal
- **THEN** the runtime does not claim per-scope pre-execution enforcement for
  that adapter
- **AND** the runtime route catalog either limits the run to a documented admission/audit
  gate, limits enforcement to documented sandbox-level controls, or fails
  closed before provider work starts
- **AND** emits a sanitized diagnostic that distinguishes admission/audit-only
  policy grants from declared-scope-bound enforcement

### Requirement: Runtime-Neutral Agent Runner
The system SHALL provide a main-process runtime-neutral agent runner that
selects supported coding-agent runtime adapters through the canonical runtime route catalog in
`src/main/lib/agent-runtime/runtime-route-catalog.ts`
and executes them through a shared request, event, cancellation, and result
contract.

#### Scenario: Run Claude through shared runner
<!-- Scenario register: S41; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/routes.json#S41` with a claude alias normalized by the shared owner and runAgentTask runtimeRouteCatalog recording ports
- **WHEN** a caller submits a valid agent request with runtime claude through the shared request builder and runAgentTask executes the normalized fixture
- **THEN** the catalog chooses a Claude adapter source whose capabilities and
  permission policy satisfy the request
- **AND** the runner executes the task through that selected adapter
- **AND** emits normalized events instead of runtime-specific stream objects
- **AND** returns a normalized result with final status, exit information, and
  session metadata when available

#### Scenario: Run Codex through shared runner
<!-- Scenario register: S42; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/routes.json#S42` with a Codex batch request and runAgentTask runtimeRouteCatalog recording ports
- **WHEN** a caller submits a valid agent request with runtime codex and runAgentTask executes the fixture
- **THEN** the catalog chooses a Codex adapter source whose capabilities and
  permission policy satisfy the request
- **AND** the runner executes the task through that selected adapter
- **AND** emits normalized events instead of runtime-specific stream objects
- **AND** returns a normalized result with final status, exit information, and
  session metadata when available

#### Scenario: Default headless batch runtime is selected
<!-- Scenario register: S43; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/routes.json#S43` with both default batch requests and ready rich references
- **WHEN** a headless/API run requests the default batch profile for Codex or Claude and resolveRuntimeRoute returns adapterSource while runAgentTask emits the selection diagnostic
- **THEN** the catalog chooses the existing process-backed batch adapter when
  required capabilities and permission policy allow it
- **AND** the selection diagnostic identifies the adapter source without
  exposing secrets

#### Scenario: Interactive runtime is requested without interaction
<!-- Scenario register: S44; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/policy.json#S44` with internal interactive callbacks but no approved channel or grant
- **WHEN** a headless/API run requests an adapter requiring user approval, AskUserQuestion, MCP elicitation or other interactive callbacks and resolveRuntimeRoute evaluates the existing refusal chain
- **AND** the request does not provide an approved interactive channel or policy
  grant
- **THEN** the catalog refuses the adapter before provider work starts
- **AND** the run receives a sanitized fail-closed diagnostic

#### Scenario: Adapter selection falls back
<!-- Retained living title; this slice removes the unreachable preference option and forbids implicit downgrade. -->
<!-- Scenario register: S45; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/policy.json#S45` with batch and internal interactive queries plus exact diagnostic key sets
- **WHEN** a supported batch request or internal interactive-profile request reaches resolveRuntimeRoute and runAgentTask emits its result/status payloads
- **THEN** batch selection diagnostics retain fallbackReason:null and the interactive request receives its original refusal
- **AND** no preferredAdapterSource option or implicit adapter downgrade remains
- **AND** metadata still follows Runtime Adapter Source Metadata and never upgrades degraded or unsupported capability claims

#### Scenario: Unsupported runtime requested
<!-- Scenario register: S46; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/refusals.json#S46` with unsupported and retired runtime requests plus recording execution ports
- **WHEN** a caller submits an unsupported runtime request to the existing public parser and separately to resolveRuntimeRoute as an internal query
- **THEN** both paths reject with zero provider/delegate calls
- **AND** the public parser path returns the existing normalized unsupported-runtime error; the internal query returns route_not_found

#### Scenario: Unsupported capability requested
<!-- Scenario register: S47; retained living title for full MODIFIED replacement. -->
- **GIVEN** `tests/fixtures/runtime-route-catalog/capabilities.json#S47` with required degraded/unsupported capabilities and baseline diagnostics
- **WHEN** a caller requests a run mode, option or tool policy whose required capability is degraded or unsupported and resolveRuntimeRoute checks the owner-derived capability union
- **THEN** the runner rejects or downgrades the request according to explicit
  caller policy before starting provider work
- **AND** emits a normalized unsupported-capability diagnostic
