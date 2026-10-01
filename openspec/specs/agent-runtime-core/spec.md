# agent-runtime-core Specification

## Purpose
TBD - created by archiving change add-headless-agent-jobs. Update Purpose after archive.

## Requirements

### Requirement: Agent Runtime Contract
The system SHALL define an explicit `AgentRuntime` contract implemented by every supported coding-agent runtime driver.

#### Scenario: Runtime is registered
- **WHEN** the application starts or runtime services initialize
- **THEN** each supported runtime registers a runtime ID, display metadata, a capability manifest sourced from `agent-runtime-capabilities`, run entry point, cancellation behavior, and session-reference behavior
- **AND** the registry rejects duplicate runtime IDs
- **AND** the renderer receives only non-secret runtime metadata and capability summaries

#### Scenario: Runtime-specific behavior is not forced into the contract
- **WHEN** a runtime lacks rollback, fork, workflows, plugins, runtime commands, or runtime-specific session operations
- **THEN** the `AgentRuntime` contract still allows the runtime to register for basic runs
- **AND** unsupported behavior remains behind capability gates
- **AND** callers do not require provider-specific features to satisfy the shared job contract

#### Scenario: Caller requests runtime capabilities
- **WHEN** a desktop, CLI, or main-process caller requests available runtime capabilities
- **THEN** the system returns the shared capability states for each registered runtime
- **AND** each capability state is explicit as `supported`, `degraded`, or `unsupported`
- **AND** degraded or unsupported states include a short reason when practical

#### Scenario: Runtime declares support
- **WHEN** a runtime declares a capability as `supported`
- **THEN** the adapter enforces or provides that behavior through runtime code
- **AND** tests cover the declared behavior or fail the implementation checklist

### Requirement: Runtime Capability Model
The system SHALL model runtime behavior through capabilities rather than hard-coded provider-name assumptions.

#### Scenario: Capability set is exposed
- **WHEN** runtime capabilities are resolved
- **THEN** the capability set includes hard tool guard, plan mode enforcement, scope expansion approval, AskUserQuestion, rollback/fork, MCP auth, MCP configuration scope, provider profiles, attachments, usage metadata, runtime plugins, runtime commands, runtime workflows, and App Agents/skills
- **AND** additional capabilities can be added without changing existing capability semantics
- **AND** the capability IDs, states, scopes, reasons, and remediation hints remain owned by `add-agent-runtime-capability-model`

#### Scenario: UI gates behavior
- **WHEN** the desktop UI renders runtime-specific controls
- **THEN** it uses runtime capability states to enable, disable, warn, or hide behavior
- **AND** it does not assume Claude supports every feature or that Codex lacks every feature based only on runtime name

#### Scenario: CLI gates behavior
- **WHEN** a CLI caller requests a mode or option that depends on a runtime capability
- **THEN** the CLI validates the option against the selected runtime capability state before starting the run
- **AND** returns a normalized unsupported-capability error if the runtime cannot provide the requested behavior

#### Scenario: Capability is unsupported before job start
- **WHEN** a CLI or desktop job request includes options that require unsupported runtime behavior
- **THEN** the runner rejects the request before provider work starts
- **AND** no job is marked `running`
- **AND** any created job is marked `failed` with an unsupported-capability error or the request is rejected before job creation

### Requirement: Capability Honesty
The runtime core SHALL distinguish supported behavior from degraded or
unsupported behavior.

#### Scenario: Runtime supports hard tool guard
- **WHEN** a runtime reports hard tool guard as `supported`
- **THEN** the adapter can allow, deny, or rewrite a tool call before the tool
  executes
- **AND** the runner emits permission or guard events when a tool decision is
  made

#### Scenario: Runtime lacks pre-tool interception
- **WHEN** a runtime cannot enforce allow, deny, or rewrite decisions before tool
  execution
- **THEN** the hard tool guard capability is reported as `degraded` or
  `unsupported`
- **AND** guarded agent-mode UI and CLI behavior do not present that runtime as
  having hard enforcement
- **AND** prompt-only guidance and post-run audit may still be used when clearly
  represented as degraded protection

#### Scenario: Codex capability is missing
- **WHEN** Codex cannot provide a capability that Claude supports
- **THEN** the Codex capability manifest marks that capability as `degraded` or
  `unsupported`
- **AND** the app shows appropriate UI state or CLI diagnostics
- **AND** the missing capability is testable from the runtime registry rather
  than hidden in provider-specific branches
- **AND** runtime execution boundary changes may still complete when callers
  correctly gate the missing capability

#### Scenario: Policy grant requires adapter enforcement
- **WHEN** a non-desktop run requests policy-grant behavior on an adapter that
  lacks a pre-execution hook for the requested side-effect scope
- **THEN** the runtime does not claim per-scope pre-execution enforcement for
  that adapter
- **AND** the selector either limits the run to a documented admission/audit
  gate, limits enforcement to documented sandbox-level controls, or fails
  closed before provider work starts
- **AND** emits a sanitized diagnostic that distinguishes admission/audit-only
  policy grants from declared-scope-bound enforcement

### Requirement: Runtime-Neutral Agent Runner
The system SHALL provide a main-process runtime-neutral agent runner that
selects supported coding-agent runtime adapters through an execution selector
and executes them through a shared request, event, cancellation, and result
contract.

#### Scenario: Run Claude through shared runner
- **WHEN** a caller submits a valid agent run request with runtime `claude`
- **THEN** the selector chooses a Claude adapter source whose capabilities and
  permission policy satisfy the request
- **AND** the runner executes the task through that selected adapter
- **AND** emits normalized events instead of runtime-specific stream objects
- **AND** returns a normalized result with final status, exit information, and
  session metadata when available

#### Scenario: Run Codex through shared runner
- **WHEN** a caller submits a valid agent run request with runtime `codex`
- **THEN** the selector chooses a Codex adapter source whose capabilities and
  permission policy satisfy the request
- **AND** the runner executes the task through that selected adapter
- **AND** emits normalized events instead of runtime-specific stream objects
- **AND** returns a normalized result with final status, exit information, and
  session metadata when available

#### Scenario: Default headless batch runtime is selected
- **WHEN** a headless/API run requests the default batch profile for Codex or
  Claude
- **THEN** the selector chooses the existing process-backed batch adapter when
  required capabilities and permission policy allow it
- **AND** the selection diagnostic identifies the adapter source without
  exposing secrets

#### Scenario: Interactive runtime is requested without interaction
- **WHEN** a headless/API run requests an adapter that requires user approval,
  AskUserQuestion, MCP elicitation, or other interactive callbacks
- **AND** the request does not provide an approved interactive channel or policy
  grant
- **THEN** the selector refuses the adapter before provider work starts
- **AND** the run receives a sanitized fail-closed diagnostic

#### Scenario: Adapter selection falls back
- **WHEN** the selector falls back from a preferred adapter to a supported batch
  adapter
- **THEN** the selector records the selected adapter source and fallback reason
  in the normalized selection result
- **AND** published adapter metadata and diagnostics remain governed by the
  runtime adapter source metadata requirement
- **AND** the fallback does not silently upgrade degraded or unsupported
  capabilities to supported

#### Scenario: Unsupported runtime requested
- **WHEN** a caller submits a run request for an unsupported runtime
- **THEN** the runner rejects the request before starting provider work
- **AND** returns a normalized unsupported-runtime error

#### Scenario: Unsupported capability requested
- **WHEN** a caller requests a run mode, option, or tool policy that the selected
  runtime reports as `degraded` or `unsupported`
- **THEN** the runner rejects or downgrades the request according to explicit
  caller policy before starting provider work
- **AND** emits a normalized unsupported-capability diagnostic

### Requirement: Normalized Agent Events
The system SHALL normalize runtime output into ordered canonical `RunEvent` records
that can be persisted, streamed, and mapped to protocol, CLI, desktop and Local Job
API clients through the Run's canonical ledger. The internal envelope SHALL retain
runId, runtimeId, sequence, type, createdAt, sanitized payload and redaction metadata.
The internal observation ports SHALL accept retained observationKey, receivedAt and
sanitizable input; native response/notification/request ports additionally accept
transportId, the native message envelope and available request correlation (id, method,
params, intent, expectedSessionId). Send/resolved ports SHALL accept requestId and send
result where applicable. ingestRuntimeObservation SHALL accept normalized type/payload;
appendSystemEvent SHALL accept lifecycle type/payload. Neither may mint owner-gated
artifact or terminal records. admitRunArtifactCandidate SHALL accept candidate path,
ownerRunId, expected digest/media and the admitted Run context. settle SHALL accept a
live native terminal, host result, cancel, interrupt, transport-exit or recovery trigger
with observationKey plus explicit policy denial, output validity/empty/allowEmpty,
credential-postcheck and evidence-key fields. Missing success evidence SHALL fail closed.
repairFromSnapshot SHALL accept snapshot, source provenance, schema disposition and
target turn; bindExecutionProvenance SHALL bind the actual execution tuple once.

read(afterSequence) SHALL return only committed records after that sequence;
readOutcome SHALL return null while unsettled, otherwise status/reasons/evidenceKeys and
completedSequence; readUsage SHALL return total/last/baseline/delta/discontinuity and seal
sequence. readNativeContext SHALL expose only the host's observed interrupt target.
readItem's keys, state and reconciliation are specified by Item Lifecycle Reconciliation.
Store cursor/ack SHALL read and monotonically acknowledge a projection's contiguous
committed prefix; deliver SHALL consume committed records. Tests SHALL drive these
observable ports/readers using versioned synthetic or source-attributed fixtures under
tests/fixtures/run-event-ledger/, with deterministic clock and temporary store/files;
fixture names identify test inputs and do not delegate normative behavior to a change
plan or its implementation checklist.

#### Scenario: Event type is emitted
- **WHEN** `vocabulary.json` is driven by each case's port: ingestRuntimeObservation
  for normalized runtime/system vocabulary cases, admitRunArtifactCandidate for artifact
  cases, and settle for terminal cases
- **THEN** `read(0)` contains exactly the fixture's 21 allowed internal types:
  `job_created`, `job_started`, `assistant_delta`, `reasoning_delta`, `tool_started`,
  `tool_delta`, `tool_finished`, `guard_decision`, `permission_requested`,
  `scope_expansion_requested`, `question_pending`, `question_result`, `mcp_needs_auth`,
  `usage_update`, `command_started`, `command_output`, `command_finished`,
  `artifact_created`, `status`, `error`, and `completed`
- **AND** each record has sequence and sanitized payload; artifact and terminal inputs
  in the fixture enter their dedicated owner ports, not raw event minting

#### Scenario: Runtime emits assistant output
- **WHEN** `normalized-output.json` supplies assistant, reasoning and structured content
  through `ingestRuntimeObservation`
- **THEN** `read(0)` contains ordered assistant/reasoning events preserving content kind
  and safe metadata that the desktop and CLI projections can display

#### Scenario: Runtime emits tool activity
- **WHEN** `normalized-output.json` supplies tool start/progress/final observations
- **THEN** `read(0)` contains tool_started/tool_delta/tool_finished with name, status
  and sanitized metadata, and no fixture provider secret is serialized

#### Scenario: Runtime reports completion
- **WHEN** the runner facade passes each existing terminal status in
  `normalized-output.json` as validated evidence to the ledger
- **THEN** the facade's returned Run result references the committed completed sequence
  and final status from `readOutcome()`
- **AND** every record after that sequence is diagnostic-only

#### Scenario: Event is serialized for CLI
- **WHEN** the CLI stream-json serializer receives a committed event and a separate
  host diagnostic from `projection.json`
- **THEN** stdout contains one newline-delimited JSON object for the event and stderr
  contains the host diagnostic, with no diagnostic text on stdout

#### Scenario: Headless process emits coarse output
- **WHEN** the coarse ingress port receives `coarse-process.json` assistant, command,
  status, error and host-result observations
- **THEN** its returned normalized records preserve the fixture's coarse source and
  sanitized fields, with no invented native tool/session identity
- **AND** job persistence receives those records through the ledger store port

#### Scenario: Event compatibility is required
- **WHEN** protocol, CLI and v1 serializers receive the committed `projection.json` record
- **THEN** each returns its documented envelope with the same canonical sequence
- **AND** none requires the caller to parse raw native messages or desktop chunks

### Requirement: Shared Cancellation Semantics
The system SHALL support cancellation through a shared abort mechanism across supported runtimes.

#### Scenario: Caller cancels active run
- **WHEN** a caller cancels an active agent run
- **THEN** the runner signals the runtime adapter to stop work
- **AND** emits a canceled terminal event
- **AND** releases runtime resources associated with the run

#### Scenario: Cancellation is requested from another process
- **WHEN** a different local process requests cancellation for an active job
- **THEN** the active runner observes the persisted cancel request
- **AND** aborts the runtime through the shared abort mechanism when possible
- **AND** emits a canceled terminal event only after the runtime stop path completes

#### Scenario: Caller cancels completed run
- **WHEN** a caller cancels a run that already reached a terminal status
- **THEN** the runner treats the request as idempotent
- **AND** does not create a new runtime operation

### Requirement: Credential and Local-Only Boundaries
The runtime core SHALL preserve existing local-first and credential boundaries.

#### Scenario: CLI caller starts a run
- **WHEN** a CLI caller starts a run
- **THEN** provider tokens are resolved through existing local credential or provider-profile mechanisms
- **AND** plaintext provider tokens are not accepted as CLI flags
- **AND** plaintext provider tokens are not included in runner events

#### Scenario: Local-only mode blocks hosted upstream
- **WHEN** local-only mode blocks an official hosted upstream path
- **THEN** the runner returns a normalized local-only error
- **AND** does not bypass the guard because the caller is headless or CLI-based

### Requirement: Default Observed Agent Control
The runtime core SHALL run normal desktop Agent-mode requests through an explicit observed control level by default.

#### Scenario: Unguarded Agent mode starts
- **WHEN** the user starts a desktop Agent-mode run without a scope contract or strict override
- **THEN** the resolved `PermissionPolicy` uses control level `observe`
- **AND** the runtime is allowed to continue normal supported actions
- **AND** catastrophic actions are loudly denied before execution when the selected runtime exposes a pre-tool hook for observed mode
- **AND** observable tool, shell, file, MCP, runtime, or provider actions are emitted as sanitized runtime events when the selected runtime exposes hooks or stream chunks
- **AND** the run remains cancelable through the shared abort mechanism

#### Scenario: Observed mode is not hard guard
- **WHEN** a run uses control level `observe`
- **THEN** the hard tool guard capability is not upgraded because of observation alone
- **AND** the run is not labeled as guarded or hard-enforced
- **AND** risky observed actions may be highlighted while still being allowed by default unless they match the explicit catastrophic denylist

#### Scenario: Runtime hook is unavailable
- **WHEN** the selected runtime cannot install a pre-tool observation hook for an observed Agent run
- **THEN** the run emits a renderer-safe degraded observation diagnostic
- **AND** the runtime may continue with stream-only visibility
- **AND** the diagnostic does not claim catastrophic pre-execution blocking, scope-contract enforcement, or hard guard support

#### Scenario: Observed mode blocks a catastrophic action
- **WHEN** an observed Agent-mode run requests a high-risk shell command, a write to a sensitive path, or a network-egress action classified as catastrophic by the guard owner
- **AND** the selected runtime exposes a pre-tool hook for observed mode
- **THEN** the action is denied before execution
- **AND** the runtime emits a sanitized event with control level, tool name, risk category, deny decision, and a renderer-safe explanation
- **AND** the denial is visible to the user rather than silently hidden

### Requirement: Observed Action Risk Metadata
The runtime core SHALL attach guard-owned risk metadata to observed tool and permission events.

#### Scenario: Runtime observes a tool action
- **WHEN** a runtime hook or stream chunk identifies a tool action during observed mode
- **THEN** the action event includes the control level, tool name, bounded action metadata, and a risk level derived from the guard owner
- **AND** raw provider secrets, raw environment values, raw headers, full file contents, and unbounded command output are not persisted or emitted to renderer state

#### Scenario: Runtime observes a high-risk shell command
- **WHEN** an observed tool action includes a high-risk or ambiguous shell command according to the guard-owned classifier
- **THEN** the event is tagged as high risk
- **AND** the default observed policy denies the action only when it matches the catastrophic denylist and the runtime exposes a pre-tool hook

#### Scenario: Runtime observes network egress
- **WHEN** an observed tool action may send project data to a network destination through web fetch, shell, MCP, runtime, or provider behavior
- **THEN** the event includes network-egress risk metadata derived from the guard owner
- **AND** the renderer can highlight the risk without owning a second network-egress classifier

### Requirement: Desktop Runtime Preflight
The runtime core SHALL verify desktop run context before provider, MCP, attachment, or runtime adapter work starts, including project-backed, removed project history, and folderless quick-chat contexts.

#### Scenario: Project-backed desktop run context is verified
- **WHEN** a desktop Claude or Codex run is requested for a project-backed chat
- **AND** the associated project is active
- **THEN** the runtime core canonicalizes and verifies project, chat, sub-chat,
  cwd, runtime, mode, provider profile reference, MCP readiness, attachment
  readiness, and local-only constraints
- **AND** the verified result contains only renderer-safe metadata needed by
  downstream runtime setup
- **AND** provider work does not start from raw renderer `cwd`, provider config,
  MCP config, or attachment references

#### Scenario: Removed project history cannot start a project runtime
- **WHEN** a desktop Claude or Codex run is requested for a chat whose associated
  project has been removed from the active Projects list
- **THEN** the runtime core rejects or blocks the run before provider work starts
- **AND** the diagnostic tells the renderer that the project must be restored
  before project workflows can resume
- **AND** the diagnostic is renderer-safe and does not include provider secrets,
  OAuth tokens, gateway tokens, raw headers, or secret-bearing env values

#### Scenario: Folderless quick-chat context is verified
- **WHEN** a desktop Claude or Codex run is requested for a chat with no associated
  project
- **THEN** the runtime core verifies chat/sub-chat ownership, runtime, provider
  profile reference, attachment readiness, and local-only constraints
- **AND** the verified result identifies the context as folderless with `project`
  absent or null
- **AND** the working directory is a main-process-owned app scratch directory
  rather than a renderer-supplied project path
- **AND** project MCP, project context, worktree, diff, terminal, PR, and
  guarded-scope workspace features are skipped or unavailable before provider
  startup

#### Scenario: Preflight blocks unsafe request
- **WHEN** the request contains an unregistered cwd, removed project, mismatched
  project/chat/sub-chat, unsupported attachment, provider profile blocker, MCP
  needs-auth blocker, local-only violation, or folderless chat carrying
  project/worktree/PR state
- **THEN** the runtime core rejects or blocks the run before provider work starts
- **AND** the diagnostic is renderer-safe and does not include provider secrets,
  OAuth tokens, gateway tokens, raw headers, or secret-bearing env values

### Requirement: Desktop Permission Policy
The runtime core SHALL map Locus plan, agent, guarded, and folderless assistant desktop runs through a shared permission policy before runtime adapter startup.

#### Scenario: Policy is resolved for a desktop run
- **WHEN** a Claude or Codex desktop run starts
- **THEN** the runtime core resolves a `PermissionPolicy` from the verified context, requested mode, guarded scope contract, runtime capability state, and local-only state
- **AND** the selected adapter receives the policy rather than independently deriving durable plan, guarded, or assistant semantics inside a route

#### Scenario: Runtime cannot enforce policy
- **WHEN** the selected runtime adapter cannot enforce the required plan-mode, guarded-run, assistant, approval, file, shell, MCP, or unknown-tool policy before execution
- **THEN** the run fails closed or uses an explicitly supported fallback according to policy before provider work starts
- **AND** the capability state remains degraded or unsupported for that adapter until tests prove enforcement

#### Scenario: Plan mode is read-only for workspace side effects
- **WHEN** a desktop Claude or Codex run starts in plan mode
- **THEN** the `PermissionPolicy` disallows project or workspace file writes, side-effecting shell commands, MCP/runtime configuration mutation, and provider configuration writes before execution
- **AND** the app may still persist Locus-owned messages, job rows, semantic events, diagnostics, and session metadata
- **AND** any future Locus-owned artifact write requires an explicit owner, path policy, and tests rather than a route-local `.md` exception

#### Scenario: Claude native permission bypass is considered
- **WHEN** the Claude desktop adapter would use native permission bypass for agent or guarded behavior
- **THEN** the `PermissionPolicy` records the Locus-owned enforcement evidence required before runtime startup
- **AND** the run fails closed or uses native controls when guarded decisions, plan-mode enforcement, diagnostics, and tests cannot prove pre-execution side-effect control

#### Scenario: Assistant policy denies host and project side effects
- **WHEN** a folderless quick chat starts through Claude or Codex
- **THEN** the `PermissionPolicy` resolves to an assistant control level that allows only supported web information tools and Locus-owned persistence
- **AND** file, shell, terminal, MCP/project, runtime/plugin mutation, and unknown tools are denied before execution
- **AND** a runtime that cannot install the assistant pre-tool gate fails closed before provider/tool work starts

### Requirement: Desktop Run Request Contract
The runtime core SHALL define a desktop-capable run request, event, cancellation and
result contract for Claude and Codex adapters that extends the shared request base.
Its host composition SHALL inject the ledger ports used for observations and committed
trace delivery; the request SHALL NOT carry credentials or change ID/cancel authority.

#### Scenario: Adapter receives desktop request
- **WHEN** `desktop-request.json` is passed through the desktop request factory to a
  recording adapter
- **THEN** the adapter receives existing run identity, verified context, provider
  metadata, permission policy, MCP readiness, attachments, trace observer, signal and
  session metadata, plus the ledger ingress/committed trace ports
- **AND** the captured request excludes plaintext provider/OAuth/gateway tokens, raw
  headers and arbitrary renderer env; exact secret hints enter only the host redactor

#### Scenario: Adapter emits normalized events
- **WHEN** a fake desktop adapter submits the event categories in `desktop-request.json`
  through its injected ports
- **THEN** its recording trace observer receives committed RunEvent records without
  runtime-specific stream objects, and the request's original cancellation signal is retained

### Requirement: Runtime Route Boundary
The runtime core SHALL keep durable runtime business rules in canonical owners rather than duplicating them in routes or transports.

#### Scenario: Route starts a runtime run
- **WHEN** a tRPC route or transport receives a desktop runtime request
- **THEN** it may validate the envelope, check caller authorization/status, and forward the request to the runtime control layer
- **AND** it does not add a second implementation of preflight, permission policy, provider binding, MCP readiness, capability truth, or trace persistence

#### Scenario: Temporary dual path is needed
- **WHEN** implementation temporarily keeps both old route-local behavior and a new service/adapter path
- **THEN** the change includes a canonical owner, explicit migration flag or gate, deletion condition, tests proving the active boundary, and a deprecation comment naming the removal plan

### Requirement: Runtime Adapter Source Metadata
The runtime core SHALL expose renderer-safe adapter source metadata for each runtime path.

#### Scenario: Runtime metadata is requested
- **WHEN** a desktop, CLI, job, protocol, or main-process caller requests runtime metadata
- **THEN** each runtime path may include adapter source, adapter version, transport type, fallback source, and fallback reason
- **AND** the metadata does not include provider secrets, gateway tokens, OAuth tokens, raw request headers, or secret-bearing environment values

#### Scenario: Runtime adapter falls back
- **WHEN** a selected runtime adapter falls back to another adapter source
- **THEN** the system emits a normalized fallback diagnostic before or during run startup
- **AND** the fallback does not silently upgrade a degraded or unsupported capability to supported

### Requirement: Stable External Runtime Contract
The runtime core SHALL keep the Locus external run, event, capability, preflight, and provider-binding contracts stable while allowing runtime-specific adapter internals.

#### Scenario: Codex desktop uses app-server
- **WHEN** Codex desktop/chat uses app-server internally
- **THEN** the adapter maps runtime-specific thread, turn, approval, tool, usage, and session data into the existing Locus normalized event and result shapes
- **AND** callers do not need to know whether the underlying Codex transport is SDK, app-server, or exec except through renderer-safe metadata

#### Scenario: Claude and Codex internals differ
- **WHEN** Claude and Codex use different official SDKs, protocols, permission callbacks, or session primitives
- **THEN** Locus does not force identical internal implementations
- **AND** it still gates shared product surfaces through capability manifests and normalized diagnostics

### Requirement: Shared Run Request Base
The runtime core SHALL define a shared run request base for fields common to
desktop, CLI, daemon, schedule, protocol, and Local Job API runtime execution.

#### Scenario: Shared request is created
- **WHEN** a runtime run is started from any supported surface
- **THEN** the request includes run identity, runtime ID, mode, cwd, prompt,
  cancellation signal, source or surface, requested capabilities, permission
  policy summary, provider reference metadata, and an event observer
- **AND** the request excludes plaintext provider secrets, OAuth tokens,
  gateway tokens, raw headers, and arbitrary caller-supplied environment values

#### Scenario: Surface-specific context is preserved
- **WHEN** a desktop Workbench run is started
- **THEN** desktop-only context such as chat ID, sub-chat ID, workspace kind,
  optional project ID, MCP readiness, attachment references, session metadata,
  trace observer, and interactive bridges remains in the desktop request extension
- **AND** headless/API callers are not required to fabricate desktop-only fields
- **AND** folderless desktop runs represent the missing project explicitly instead of fabricating a project ID

#### Scenario: Headless job context is preserved
- **WHEN** a CLI, daemon, schedule, protocol, or Local Job API job is started
- **THEN** job/source/consumer/artifact context remains available to the
  headless request extension
- **AND** the run does not claim a visible user interaction channel unless one
  is explicitly provided

### Requirement: Non-Desktop Permission Policy
The runtime core SHALL resolve permission policy for non-desktop runtime runs
before adapter selection and provider work.

#### Scenario: Headless run has no user
- **WHEN** a CLI, daemon, schedule, protocol, or Local Job API run lacks a
  visible user interaction channel
- **THEN** the policy resolves to `policy-grant` only when the request declares
  bounded scopes that the policy can decide automatically
- **AND** otherwise resolves interactive-only side-effect requests to
  `fail-closed`

#### Scenario: Policy grant scopes are not silently overclaimed
- **WHEN** a non-desktop run declares policy-grant scopes
- **THEN** the permission policy records those scopes as non-desktop grant
  metadata without claiming the selected adapter binds every declared scope
- **AND** an adapter that only provides an app-server admission gate may be
  selected only with an explicit admission/audit diagnostic
- **AND** guarded scope contracts and hard-tool guard requests still require a
  true pre-execution hook or fail closed before provider work starts

#### Scenario: Interactive user is present
- **WHEN** a desktop run or future approved interactive headless channel
  provides a user interaction bridge
- **THEN** the policy may use `interactive-user`
- **AND** approval, question, and MCP elicitation requests are routed through
  the declared bridge rather than silently bypassed

### Requirement: Canonical Run Event Ledger Ownership
Each Run SHALL have one ledger in its host process. All response, notification, server
request, response-send, resolved and system observations SHALL enter it. Only that
ledger SHALL allocate sequence. Its immutable exact-sequence batches SHALL commit before
acknowledgement or fan-out; sequence SHALL be dense from 1, with no invisible records.
A retried observation key SHALL return its existing batch. Projection delivery SHALL
resume using durable acknowledged cursors and be idempotent by Run/sequence.

#### Scenario: All protocol boundaries enter one ledger
- **WHEN** `ingress-boundaries.jsonl` is submitted in listed order through the five named
  boundary ports, including a response, notification, server request, send and resolved
- **THEN** `read(0)` has one or more records for each boundary in that same batch order,
  with fact keys `(observationKey, ordinal)` and sequences 1 through the committed count
- **AND** resubmitting the same observationKey returns the previous records without
  increasing the committed count or allocating another sequence

#### Scenario: Durable append fails before acknowledgement
- **WHEN** `store-faults.json` makes appendExact throw before commit for observation A
  while B is queued, then retries A with the same key and permits both commits
- **THEN** during failure `read(0)`, projection deliveries and resolved acknowledgements
  contain neither A nor B; after recovery they contain A then B at the reserved sequences
- **AND** the temporary SQLite store has one row per fact key and no partial job mutation

#### Scenario: Process crashes after commit and before projection
- **WHEN** `store-faults.json` commits A then recreates the ledger over that store before
  projection ack, with a second variant crashing after deliver but before ack
- **THEN** cursor(name) resumes the unacknowledged record at its original sequence,
  the projector upsert contains A once, and ack advances monotonically over its prefix
- **AND** `read(0)` never duplicates A and the next observation uses the next sequence

#### Scenario: Cross-process queued cancel races with start
- **WHEN** two host ledgers sharing `store-faults.json`'s temporary SQLite store race
  queued cancel against start, with each winner ordering and a retry-exhaustion variant
- **THEN** an expectedHighWater/state conflict reloads committed header/records and
  re-evaluates the original intent; already committed fact keys return the prior batch,
  otherwise the ledger re-reserves uncommitted sequences above the current high-water
- **AND** cancel-first prevents start/spawn; start-first converts the losing queued
  cancel to the existing cancel-request flag, leaving settlement to the worker
- **AND** at most three transaction attempts occur per call; exhaustion returns host
  LEDGER_APPEND_CONFLICT without acknowledgment, partial mutation or a second completed;
  the store never re-sequences records and successful commits form a dense sequence

#### Scenario: Historical rows remain explicitly unverified
- **WHEN** the ledger opens a store containing `legacy-store.json`'s pre-ledger terminal
  desktop wrapper rows, bare API rows and an inactive incomplete historical Run
- **THEN** existing row payload/ID/sequence bytes are unchanged, header.ledger_version
  is 0, and only the internal store/Workbench read projection exposes historyQuality=legacy_unverified
- **AND** opening these Runs for ledger append is rejected; no fact keys, provenance
  or missing completed are fabricated; new jobs have version 1 record metadata with
  pending provenance until execution binding; no public job.ledger.historyQuality is added

### Requirement: Native Identity And Runtime Provenance
The ledger SHALL preserve available native identities in redacted versioned metadata
without substituting threadId/sessionId. Each runtime-backed record SHALL refer to its
immutable installation/version/binary/protocol/schema tuple; provider-only completion
records SHALL identify their actual Locus execution source. Lifecycle-only job_created,
worker-claim job_started, pre-start cancel and never-started recovery/failure records
SHALL use kind=pending before execution binding, with ledger_provenance_json null and
no claimed binary. Pending admission SHALL also allow host status runtime_selected and
runtime_selection_refused and admitted non-native initial artifact_created, with no
runtime.codex.v1 provenance extension before binding. Successful initial artifact
preparation/admission on API create/retry SHALL preserve artifact_created before job_started;
never-started runs SHALL retain any committed initial event, without inventing one if
initial preparation/admission was not reached or failed.
A pending ledger SHALL reject native observations, usage and native
artifact candidates. At adapter executable resolution, the provenance owner SHALL
capture installationId/executableRef/actual version/source/binarySha256 and reproducible
schema fingerprints and bind them before runtime execution or runtime-backed records.
The tuple SHALL remain immutable for the Run; earlier pending facts SHALL remain pending.
Binding after terminal seal SHALL be rejected; a never-started terminal SHALL remain null.
Runtime-execution ledger construction/binding with a missing required tuple field SHALL
fail before runtime publication. Native context used for
interrupt SHALL be owned by the ledger and read only by the host adapter.

#### Scenario: Distinct native identities are preserved
- **WHEN** `identity-provenance.json` supplies distinct thread/session/turn/item/request/call
  values, including exact-secret substrings, to a ledger with secretHints
- **THEN** `read(0).payload.extensions["runtime.codex.v1"]` preserves each value's redacted field and
  omits unavailable fields; no thread ID fills a missing session ID
- **AND** serialized records contain none of the fixture secrets

#### Scenario: Exact runtime provenance follows every event
- **WHEN** runtime and locus-completion variants of `identity-provenance.json` create
  execution ledgers and ingest native/system/synthetic observations, and never-started
  variants create a pending ledger for enqueue, worker claim, queued cancel or recovery
- **THEN** committed record metadata and trace header retain their exact immutable
  source tuple; the completion variant claims no native binary/installation
- **AND** a missing binary digest rejects runtime-execution ledger construction or
  pending-to-runtime binding before runtime publication; schema identity uses reproducible
  per-file fingerprints, and no missing digest is invented for a pending lifecycle ledger
- **AND** pending rows/header remain null-provenance on never-started cancel/recovery;
  native input before binding is rejected; executable resolution binds the tuple once,
  subsequent runtime rows reference it, reopening preserves it and changing it is rejected

#### Scenario: Interrupt target comes from native Run state
- **WHEN** the adapter reads `readNativeContext()` after thread/turn observations in
  `identity-provenance.json`, and then repeats with a missing turn ID fixture
- **THEN** the host-only interrupt request uses the observed threadId and turnId exactly;
  the missing variant returns no target and cannot substitute sessionId

### Requirement: Stateful Ledger Redaction
The ledger SHALL apply the canonical redactor before durability and any consumer
projection, including across adjacent text fragments. Exact hints and withheld raw
suffixes SHALL remain host memory only; terminal flush SHALL never reveal a secret.

#### Scenario: Runtime splits an exact secret across adjacent events
- **WHEN** `split-secrets.json` configures exact provider/gateway hints and splits each
  across adjacent assistant, reasoning, command and tool fragments, then seals the Run
- **THEN** concatenated serialized durable records, renderer chunks, diagnostics and
  result contain neither complete hints nor the withheld terminal secret prefix
- **AND** safe text remains visible, and `redaction.appliedRules` records the applied rule

### Requirement: Item Lifecycle Reconciliation
The ledger SHALL reduce items through started → delta* → completed using the completed
snapshot as authoritative for pre-seal materialization. `readItem` SHALL expose item
state/text/fields and reconciliation result, lossPossible, missingStart and suppressed
count; committed `status/item_reconciliation` SHALL carry the same data in payload.item
and payload.reconciliation. Results SHALL be matched, suffix_repaired, missing_local,
missing_native or mismatch. readItem SHALL accept either the complete native
(threadId, turnId, itemId) key or an observation-local correlationKey, each with channel
and partIndex; every committed item observation, including deltas, SHALL carry that key
in payload.item so missing-ID items remain
addressable without fabricated native IDs. Reasoning keys SHALL separate text/summary
and partIndex. A schema-proven index SHALL be retained; otherwise the ledger SHALL
infer summary's last observed summaryPartAdded index (default 0) or content/text index
0 and record indexSource=inferred, lossPossible=true. This fallback is an inferred
policy, not a claim that native deltas carry a part index.

#### Scenario: Assistant deltas reconcile with final snapshot
- **WHEN** `items-assistant.jsonl` supplies a missing start, repeated handoff key,
  out-of-order start and final text "hello", including prefix-only and mismatched variants
- **THEN** `readItem` is completed with text "hello" once; its persisted reconciliation
  is suffix_repaired for prefix "hel" and mismatch for "heX"
- **AND** missingStart/lossPossible are true in missing-start/gap variants; final text
  is authoritative item state rather than a second appended assistant_delta
- **AND** the missing-native-ID variant returns its correlationKey in the committed
  record and readItem(correlationKey, channel, partIndex) addresses only that observation;
  equal text under another correlationKey does not merge the two

#### Scenario: Reasoning channels and parts reconcile separately
- **WHEN** `items-reasoning.jsonl` sends index-less textDelta("analysis"), summaryPartAdded(0),
  summaryTextDelta("short"), summaryPartAdded(1), summaryTextDelta("next"), plus
  completed content/summary arrays and duplicate/out-of-order variants
- **THEN** `readItem` returns distinct completed text/0="analysis", summary/0="short",
  summary/1="next" with corresponding committed reconciliation fields
- **AND** no channel concatenates another channel or part, and missing/overlap variants
  have their explicit fixture result/loss/suppressed counts
- **AND** inferred index-less deltas use text/0 and the last summary boundary (or summary/0
  when no boundary exists), with indexSource=inferred and lossPossible=true; exact native
  fields are schema-attributed, never invented to satisfy a normalized descriptor

#### Scenario: Tool item lifecycle is incomplete or repeated
- **WHEN** `items-tools.jsonl` supplies start/progress/final for each of the eight tool
  variants, and repeated-final/missing-start variants with the same native item key
- **THEN** `read(0)` has at most one tool_started and tool_finished per item transition,
  and `readItem` retains authoritative final fields and earlier diagnostic facts
- **AND** missing-start and duplicate-final cases expose their persisted reconciliation
  missingStart/lossPossible/suppressedDuplicateCount fields

### Requirement: Diagnostic Error And Terminal Invariants
The ledger SHALL preserve error classification, willRetry, code and native identity
without treating every error as terminal. It SHALL emit exactly one completed per
settled Run. Transport exit SHALL supply a synthetic interrupted terminal candidate
with provenance, settling an unsealed Run and becoming a late diagnostic if already
sealed; there SHALL be no same-Run transport replacement exception. Outcome SHALL
be determined by the declared evidence rule: cancel → canceled; interrupt/exit/recovery
→ interrupted; denial/invalid-output/invalid-empty/credential-check failure/native
failure → failed; live success or valid host result with valid allowed output → succeeded.
Snapshot status alone SHALL NOT prove success. All observations after the seal SHALL
be immutable status/late_event diagnostics and SHALL NOT change outcome or materialization.

#### Scenario: Retry error is followed by success
- **WHEN** `terminal-evidence.json` provides error code="retryable", willRetry=true,
  then live native success, valid nonempty output and successful post-check
- **THEN** `read(0)` preserves the error as retryable evidence and has one
  completed(status=succeeded), also returned by `readOutcome()` after reopening the store

#### Scenario: Denial rejection and empty output have deterministic outcomes
- **WHEN** the denial, output-invalid, empty-not-allowed, empty-allowed, credential-failed,
  cancel and interrupt rows of `terminal-evidence.json` call settle
- **THEN** `readOutcome().status` is respectively failed, failed, failed, succeeded,
  failed, canceled and interrupted, with reasons/evidenceKeys and one completed each
- **AND** a success trigger with missing output evidence does not default to succeeded

#### Scenario: Transport exit synthesizes one terminal
- **WHEN** `transport-exit.jsonl` sends exit before live completion, duplicate exit and
  a subsequent native completed observation
- **THEN** the store has one completed(status=interrupted) with synthetic.source=transport_exit,
  transport ID, exit/signal and installation provenance
- **AND** subsequent observations are status/late_event with terminalSequence and cannot
  change the interrupted result or create a replacement transport on this Run
- **AND** the post-seal-exit variant keeps its prior succeeded/failed terminal, records
  only a status/late_event referencing it and never adds an interrupted completed

#### Scenario: Pre-start cancel and dead-worker recovery settle through ledger
- **WHEN** queued and confirmed-dead-worker fixtures in `terminal-evidence.json` use
  the host ledger's cancel and recovery evidence ports
- **THEN** each durable job mutation and one completed commit atomically, respectively
  canceled and interrupted, with synthetic.source=cancel or recovery
- **AND** headless/job-recovery.ts requires a null/older-than-120-s heartbeat and same-host
  ESRCH/observed worker exit, or a never-claimed never-executed job with no workerId/PID;
  it rechecks status/workerId/PID/workerStartedAt/heartbeat in the atomic settlement
- **AND** repeated recovery adds no terminal; alive, EPERM, unsupported/unknown host or
  a claimed worker with absent PID stays unsettled with host confidence=heartbeat_only;
  confirmed settlement carries recovery.confidence=confirmed and its observed basis
- **AND** never-started settlement retains pending provenance; executed recovery reuses
  the sealed tuple; a changed worker/heartbeat invalidates recovery admission

#### Scenario: Usage after completed is diagnostic only
- **WHEN** `late-usage.jsonl` sends total=20, turn/completed and then total=25 with last=5,
  a warning and a repeated native terminal, including arrival during artifact preparation
- **THEN** `readUsage().total.totalTokens` remains 20 at its sealed asOfSequence, and
  each later record is status/late_event with diagnosticOnly=true and terminalSequence
- **AND** the late usage's payload.observation preserves total=25/last=5, while result,
  item state, artifact refs and the sole completed remain unchanged
- **AND** arrivals during preparation commit at their reserved post-terminal sequences
  only after the terminal transaction; preparation failure keeps one failed terminal in
  the terminal slot and those late records reference it, without silent discard

### Requirement: Usage Snapshot Accounting
Canonical usage_update SHALL use cumulative snapshot semantics, retaining total, last,
baseline, dedupeKey, delta and discontinuity. Duplicate native snapshots/call revisions
SHALL not double count; per-call runtimes SHALL accumulate distinct calls. The existing
shared usage normalization owner SHALL remain the only cache-vector arithmetic owner.

#### Scenario: Usage snapshots are accumulated once
- **WHEN** `usage.json` supplies cumulative totals 10,20,20,25 (duplicate identity for
  the second 20) with last=10,10,10,5
- **THEN** unique usage_update payloads have kind=snapshot, total=10,20,25 and last=10,10,5;
  `readUsage().total.totalTokens` is 25
- **AND** the per-call variant with two distinct IDs and identical totalTokens=10
  yields cumulative totalTokens=20, while retransmitting either call does not increase it

#### Scenario: Resume establishes a usage baseline
- **WHEN** the defensive synthetic `usage.json` repair baseline=100 is followed by
  total=108 and a hypothetical decrease to 3
- **THEN** baseline is not new consumption; the 108 payload has delta.totalTokens=8
- **AND** the 3 payload has discontinuity=true and a new baseline with no negative delta;
  the fixture does not claim counter resets were observed in the native trace

### Requirement: Canonical Artifact Admission
Only the artifact owner SHALL validate existence, allowed scope, stable-file digest,
Run ownership, size/media and redaction and request artifact_created. Runtime candidate
artifact events SHALL precede completed. Terminal artifact refs SHALL be registered
before or in the same durable commit as completed; terminal projection files SHALL
not emit self-referential artifact_created events. Rejection SHALL use the observable
status/artifact_admission result/reason fields, with no unsafe candidate content.

#### Scenario: Valid artifact candidate is admitted
- **WHEN** `artifacts.json` creates a temporary in-scope Run-owned file and submits it
  through admitRunArtifactCandidate, then settles
- **THEN** `read(0)` has one artifact_created with verified SHA-256/size/media/ref before
  completed and the same ref in the committed artifact manifest metadata

#### Scenario: Invalid artifact candidate is rejected
- **WHEN** the missing/out-of-scope/wrong-owner/digest-mismatch/unsafe-redaction rows of
  `artifacts.json` submit candidates
- **THEN** each has no artifact_created or manifest entry and a committed
  status/artifact_admission with result=rejected and the matching stable reason
- **AND** no rejected secret path/content is serialized

#### Scenario: Terminal files and completed become visible together
- **WHEN** `terminal-artifacts.json` freezes a completed candidate, prepares events/result/
  manifest files from it, and injects failures before file preparation, before SQL commit,
  and after commit before projection
- **THEN** before a successful commit result/events readers expose no candidate terminal
  or unregistered final refs; a successful commit stores the one completed and verified
  refs atomically, and reopened readers return that same result
- **AND** events.jsonl contains the candidate completed exactly once; result references
  request/events, manifest references request/events/result without self-digest recursion;
  final files create no artifact_created event and remain unchanged by late diagnostics

### Requirement: Observable Native Methods And Boundary Facts
Unknown native methods SHALL produce sanitized status/unknown_native_method with
lossPossible=true, rather than silently disappear. Known methods SHALL use their
canonical domain event or the stable subtype disposition table. Response/send/resolved
facts SHALL describe protocol boundaries, not claim durable Interaction state.

#### Scenario: Unknown native method is observed
- **WHEN** `unknown-method.json` provides a future method and secret-bearing params
- **THEN** `read(0)` contains status/unknown_native_method, sanitized method identity and
  lossPossible=true, with no raw secret or empty default projection

#### Scenario: Interaction boundary is recorded without a second state machine
- **WHEN** `interaction-boundaries.jsonl` submits request, sent/failed response-send
  variants and resolved with the same requestId
- **THEN** read records contain subtype=interaction_boundary and boundary=request,
  response_send or resolved with request identity and explicit send result
- **AND** no payload claims a durable Interaction was created/resolved or grants execution

### Requirement: Native Resume Validation Facts
Native resume validation SHALL use request/query correlation and independent identity
relations, never generic status, arbitrary session ID, exit or result success. Codex
SHALL require matching JSON-RPC id and returned/requested thread.id plus independent
session identity and provenance; Claude SHALL require correlated system/init with
resume equality or fork's distinct new UUID. Outcomes SHALL be neutral
native_resume_validated/native_resume_rejected facts, preserving native codes and
separating native loading from later provider success or live attach. Available intent,
observed thread/target-turn status and race context SHALL be recorded without changing
live Run state. Ephemeral/path/creator-version SHALL be durability evidence, independent
of the four Codex response clauses; absent or non-durable evidence SHALL set
durableEvidence=false/lossPossible=true without rejecting an otherwise valid load.
Claude's ambiguous "No conversation found" stderr SHALL remain a sanitized
NATIVE_RESUME_REJECTED diagnostic; it SHALL NOT prove SESSION_EXPIRED or trigger
sessionId/binding clearing from stream-error finalization.

#### Scenario: Codex response validates the requested native thread
- **WHEN** `resume-codex.jsonl` sends early status, unrelated response, matching success,
  wrong-thread, absent-session, -32600 and -32603 variants through ingress, plus
  ephemeral/missing-path/missing-cliVersion and CODEX-05 start/resume no-rollout variants
- **THEN** only the matching success yields status/native_resume_validated, carrying
  jsonRpcId, requestedThreadId, returnedThreadId, sessionId and available ephemeral,
  redacted path, cliVersion, intent, observedThreadStatus and observedTargetTurnStatus; unrelated response is protocol_response with correlated=false
- **AND** wrong/missing/error variants yield native_resume_rejected with reason/code;
  early status remains thread_lifecycle; no variant fabricates thread/started or expired
- **AND** otherwise valid ephemeral/missing-path/missing-cliVersion responses remain
  validated with durableEvidence=false/lossPossible=true; CODEX-05 records rejected
  raceContext=start_resume_no_rollout and its native error without altering readOutcome

#### Scenario: Claude correlated init validates resume independently of turn success
- **WHEN** `resume-claude.jsonl` supplies ordinary/fork correlated system/init and
  unrelated-init/result-success-is_error/no-init and No conversation found rejection variants
- **THEN** only correct correlated resume equality or a valid distinct fork UUID yields
  native_resume_validated; the other terminal rejection cases yield native_resume_rejected
- **AND** a later auth failure leaves the validation fact unchanged and no one-shot
  handle state is mutated by the fact recorder
- **AND** the stream-error variant retains the sanitized native diagnostic without
  SESSION_EXPIRED/proven-expiry wording; finalization leaves the existing sessionId intact

### Requirement: Resume Snapshot Repair
Snapshots SHALL be recorded as repair evidence with repair.source=snapshot,
lossPossible=true, explicit reconciliation and fresh Locus sequences. They SHALL not
assert native event replay, transfer live ownership, or alone settle Run success.
Durable terminal truth SHALL be immutable even when native disk history loses failure.

#### Scenario: Resume snapshot repairs an incomplete item
- **WHEN** `snapshot-repair.json` supplies local assistant prefix "hel" and a recognized
  completed item "hello" before the Run seal
- **THEN** readItem.text becomes "hello" with suffix_repaired and a fresh status/repair
  sequence carrying repair.source=snapshot and lossPossible=true
- **AND** a completed snapshot item without any local item yields missing_local with
  authoritative final text and lossPossible=true; readOutcome remains null and native
  item offsets do not replace the ledger cursor

#### Scenario: Durable failure survives degraded native snapshot
- **WHEN** `snapshot-failed.json` commits a live failed terminal with 401 diagnostic,
  reopens the Locus store and feeds CODEX-08's sanitized completed/error-null snapshot
- **THEN** readOutcome and the stored completed stay failed with the original error;
  the new status/late_event has repair.source=snapshot, diagnosticOnly=true and lossPossible=true
- **AND** the fixture with no durable terminal cannot settle succeeded from that snapshot;
  its later transport exit settles interrupted, without a Locus native-rollout-write call

#### Scenario: Cross-version snapshot reconciliation declares its evidence limits
- **WHEN** `snapshot-versions.json` feeds the recognized 0.139→0.149 and reverse synthetic
  shapes derived from CODEX-07's reported fields, plus an incompatible-schema variant
- **THEN** readItem preserves the recognized final/turn data, usage baseline and source
  creator version; repair carries source/target reproducible fingerprints
- **AND** incompatible input records mismatch/lossPossible without guessing item state;
  all variants use fresh Locus sequence and are labeled synthetic, not captured full responses
- **AND** a pre-seal local item absent from a supplied authoritative snapshot yields
  missing_native/lossPossible=true, retains the local text as unverified and never
  invents native completion for that item

### Requirement: Committed Submission And Publication Observation

Submission acknowledgement and claim SHALL require exact committed job_created
observationKey=lifecycle:job-created:<id>, factKey=lifecycle:job-created:<id>:0 and
event type job_created, plus ledger_version=1. List/start SHALL share the SQL predicate
below; they SHALL never synthesize facts or a second state machine:

```sql
j.ledger_version = 1 AND j.status = 'queued'
AND EXISTS (SELECT 1 FROM agent_job_events e WHERE e.job_id = j.id
 AND e.type = 'job_created' AND e.fact_key = 'lifecycle:job-created:' || j.id || ':0')
AND (j.artifact_manifest_path IS NULL OR EXISTS (
 SELECT 1 FROM agent_job_events e WHERE e.job_id = j.id AND e.type = 'artifact_created'
 AND e.fact_key = 'lifecycle:initial-artifacts:' || j.id || ':0'))
```

ArtifactManifestPath non-NULL SHALL mean initial admission required. Run-artifacts
SHALL replace its content-hash admission observation key with
lifecycle:initial-artifacts:<id>; all initial refs SHALL commit in the same batch whose
first artifact_created ordinal is :0. A crash after creation before that batch SHALL
leave queued, unclaimable work with status/wait reason admission_incomplete; runs cancel
SHALL settle canceled without terminal refs. Reservation expiry SHALL start at that
settlement, not release immediately. Job/key transaction and separate creation commit,
ordinary queued/no-facts compensation and orphan handling SHALL retain the TICKET-128
boundary; this change SHALL not claim full atomic creation or orphan repair.

Terminal projection ownership SHALL be explicit: the worker registers the preparer;
admitted queued-cancel host composes the same preparer from persistent input plus
reopenAdmittedRunDir; missing-admission cancel/artifact-free/fail-closed preparation
use no terminal refs. Recovery SHALL use the existing liveness owner to settle
interrupted without registering new terminal refs. Initial refs SHALL remain history.
Readiness SHALL mean every terminal ref registered by that commit is published; an
empty terminal set SHALL be ready at completed, result.artifacts=[] even if initial
refs exist. No-preparer settlement SHALL not demand nonexistent terminal result files.

The host SHALL set reservation expiresAt once after verified preparer publication or
at settlement for an empty terminal set. Publication failure/crash before the setter
SHALL retain NULL expiry. Wait/status observation itself SHALL remain read-only;
the existing CLI recovery prologue and host recovery lifecycle SHALL remain intact.
All writes SHALL flow through the ledger host's single appendExactRunEventBatch adapter.

Publication readiness SHALL read seal/completed and prepared tail, verify stable-dir
identity plus each required file's size/digest, then recheck the same seal/refs. State
refs with sequence SHALL not enter the prepared-tail result array. Late diagnostic
suffixes SHALL not change the frozen result. Missing/mismatching terminal files SHALL
remain non-ready without rewriting the committed outcome. The read cache MAY reuse
hashes only for identical seal/ref and unchanged file identity/size/mtime/ctime;
changes SHALL invalidate it. Consumer deletion after publish SHALL be disclosed as
indistinguishable from never published; a durable publish marker is TICKET-128 scope.

#### Scenario: S26 Queue listing and claim require the same committed facts
- **GIVEN** `tests/fixtures/local-job-api-async/executor/admission.json#S26`, with temporary SQLite rows for a valid creation fact, a job_created with a wrong
  fact key, an orphan with no events, a legacy v0 job, and an API run-dir job lacking
  initial artifact admission, plus an artifact_created with a wrong admission key
- **WHEN** listQueuedAgentJobsForSource and startAgentJob run against every row
- **THEN** only the valid ledger-v1 fixture with all required admission facts is eligible;
  every other row is both excluded and refused before runner invocation
- **AND** adding the genuine atomic initial batch with observationKey=lifecycle:initial-artifacts:<id>
  and first factKey suffix :0 through the host permits that API fixture, while listing/claim never allocate a replacement creation fact or sequence

#### Scenario: S27 Publication faults cannot be mistaken for completion
- **GIVEN** `tests/fixtures/local-job-api-async/executor/publication.json#S27`, with frozen terminal artifact fixtures, fault injection after every staged
  write, SQL commit and final rename, and a process restarted with only committed DB
  state and the resulting run directory, with the pre-commit worker still confirmed alive
  and heartbeating to exclude the independent recovery trigger
- **WHEN** the host's readRunPublicationReadiness port and a CLI wait inspect each fixture
- **THEN** no commit or any missing/mismatching required final file yields non-ready;
  only the matching full final set yields ready for that exact completed sequence
- **AND** swapping the directory for a symlink or changing a file digest fails closed,
  leaves outside files untouched and cannot produce a successful wait
- **AND** after a terminal commit pending publication times out as terminal_artifacts_pending;
  before commit it times out as run_pending, never appends another completed or
  overwrites outcome; no process-local publish flag is required

#### Scenario: S36 Daemon death recovers to a readable interrupted result
- **GIVEN** `tests/fixtures/local-job-api-async/executor/publication.json#S36`, with a keyed daemon-claimed artifact API Run and its retained reservation, committed
  initial refs, running status, a blocked runtime, no terminal commit and heartbeat
  advanced beyond the existing 120 s
  stale threshold; the real daemon/worker is killed and the liveness port confirms stopped
- **WHEN** a restarted daemon or runs wait CLI prologue invokes recoverStaleAgentJobs,
  then `runs wait <id> --timeout 0 --json` reads from a new connection
- **THEN** one completed has interrupted/worker_stopped and job.errorCode=worker_interrupted;
  no new terminal refs/files are fabricated and wait immediately returns interrupted
  envelope with result.artifacts=[] and mapped exit 1, not terminal_artifacts_pending
- **AND** initial refs remain in history, expiry is settlement+30 days, repeat recovery/wait
  adds no terminal, and a stale-but-EPERM/live variant remains running with no false recovery

#### Scenario: S38 Crash at creation to initial admission boundary
- **GIVEN** `tests/fixtures/local-job-api-async/executor/idempotency.json#S38`, with a keyed artifact submission killed exactly after committed job_created and
  before lifecycle:initial-artifacts:<id>:0, with its admitted-intent job ID read via store
- **WHEN** fresh list/start, same-key submit, runs status and wait --timeout 0 inspect it
- **THEN** list/start admit zero, provider calls zero, submit returns submission_pending/8
  with retryable:true, status is queued/execution.reason=admission_incomplete and wait
  returns timeout/admission_incomplete/9; no initial fact is fabricated
- **AND** runs cancel settles exactly one canceled terminal without terminal refs,
  wait then returns canceled/5 with artifacts:[], key remains until settlement+30 days
  and named cleanup at expiry releases only the reservation, never history/files
