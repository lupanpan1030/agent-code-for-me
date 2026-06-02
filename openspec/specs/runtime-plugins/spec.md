# runtime-plugins Specification

## Purpose
Define runtime-aware plugin discovery, source browsing, and enablement behavior for Claude Code and Codex plugin formats.
## Requirements
### Requirement: Runtime-Aware Plugin Catalog
The system SHALL list local plugin packages by runtime so Claude Code plugins and Codex plugins are not presented as the same installation format.

#### Scenario: User opens Plugins settings
- **WHEN** the user opens Settings > Plugins
- **THEN** the app shows plugins grouped or filterable by runtime
- **AND** Claude Code plugins are discovered from the Claude plugin marketplace directory
- **AND** Codex plugins are discovered from the Codex plugin cache directory

#### Scenario: Runtime has no plugins
- **WHEN** one runtime has no discoverable plugin packages
- **THEN** the app shows an empty state for that runtime
- **AND** does not imply that the other runtime's plugins apply to it

### Requirement: Runtime-Scoped Plugin Actions
The system SHALL keep plugin actions scoped to the runtime that owns the plugin package.

#### Scenario: User views a Claude Code plugin
- **WHEN** the selected plugin belongs to Claude Code
- **THEN** the app may show enable and disable controls backed by Claude settings
- **AND** the control does not affect Codex plugin packages

#### Scenario: User views a Codex plugin
- **WHEN** the selected plugin belongs to Codex
- **THEN** the app shows it as an installed Codex package
- **AND** does not show a fake enable or disable control

### Requirement: Explicit Plugin MCP Approval
The system SHALL require explicit approval before plugin-provided MCP servers become active tool connections.

#### Scenario: User enables a Claude Code plugin with MCP servers
- **WHEN** the user enables the plugin
- **THEN** the plugin package becomes enabled for Claude Code
- **AND** MCP servers from that plugin remain pending until the user explicitly approves them

#### Scenario: User disables a Claude Code plugin
- **WHEN** the user disables the plugin
- **THEN** the plugin package is disabled for Claude Code
- **AND** approvals for MCP servers from that plugin are revoked

### Requirement: Plugin Source Browser
The system SHALL provide a read-only view of known plugin sources so users can distinguish where runtime plugin packages are discovered from.

#### Scenario: User opens plugin sources
- **WHEN** the user opens the Sources view in Settings > Plugins
- **THEN** the app lists known plugin sources by runtime
- **AND** each source shows its path, status, source type, trust label, and plugin count

#### Scenario: Source root is empty or missing
- **WHEN** a runtime has no discovered plugin packages
- **THEN** the app still shows the runtime's expected local source root
- **AND** labels it as empty or missing instead of hiding the runtime

### Requirement: Read-Only Source Handling
The system SHALL keep plugin source browsing read-only until explicit install/update flows are designed.

#### Scenario: User views a source
- **WHEN** the user selects a plugin source
- **THEN** the app shows install guidance for that runtime
- **AND** does not show remote install, update, enable, or delete controls

#### Scenario: User refreshes plugin metadata
- **WHEN** the user refreshes plugins from the Sources view
- **THEN** the app re-scans local/cache plugin metadata
- **AND** does not contact remote plugin marketplaces

### Requirement: Plugin Target Mode Classification
The system SHALL classify each discovered runtime plugin package with a Locus target mode that describes how Locus may use it.

#### Scenario: Existing runtime packages are metadata-only
- **WHEN** Locus discovers existing Claude Code or Codex plugin packages
- **THEN** each package is classified as `manifest-only`
- **AND** Locus may display metadata, component lists, source paths, and MCP declarations
- **AND** Locus does not execute arbitrary plugin JavaScript for that package

#### Scenario: Future controlled UI mode is unavailable
- **WHEN** a plugin would require Locus-owned settings pages, workbench panels, or command buttons
- **THEN** the package is not shown as executable through `controlled-ui`
- **AND** the UI explains that controlled UI execution requires a future approved Locus extension surface

#### Scenario: Future developer trusted code mode is unavailable
- **WHEN** a plugin would require local trusted code execution
- **THEN** the package is not shown as enabled through `developer-trusted-code`
- **AND** the UI does not imply that declared permissions sandbox local code

### Requirement: Reference-Only Codex++ Learning Boundary
The system SHALL treat Codex++ as a reference repository for governance patterns rather than a Locus plugin runtime dependency.

#### Scenario: Codex++ concepts are reviewed
- **WHEN** maintainers compare Codex++ with Locus
- **THEN** manifest metadata, safe mode, doctor/debug, reviewed commit pins, advisory updates, per-plugin data, and MCP declaration patterns may be tracked as learnable patterns
- **AND** app patching, re-signing, DOM patching, watcher repair, main-process tweak execution, native bridge defaults, and local-code-as-safe-plugin claims are excluded from direct adoption

#### Scenario: Codex++ repository is updated
- **WHEN** the Codex++ reference repository changes
- **THEN** Locus maintainers classify changes as learn, backlog, or ignore
- **AND** Locus does not change plugin execution behavior until a Locus OpenSpec change approves it

### Requirement: Plugin Update Review Guidance
The system SHALL provide review guidance for plugin and runtime updates without automatically installing or enabling new execution surfaces.

#### Scenario: Plugin metadata changes
- **WHEN** a plugin manifest, target mode, permissions, scope, MCP declaration, native capability, filesystem capability, network capability, or shell-related metadata changes
- **THEN** Locus presents the package as requiring review before new capabilities are trusted
- **AND** new MCP declarations remain pending until explicitly approved

#### Scenario: Codex Desktop changes
- **WHEN** Codex Desktop updates outside Locus
- **THEN** Locus plugin target-mode behavior remains independent of Codex++ patch repair state
- **AND** any Codex++ breakage is treated as external reference risk, not a Locus runtime failure

#### Scenario: Codex CLI/runtime changes
- **WHEN** the Codex CLI or runtime changes in a way that affects plugin discovery or execution capability
- **THEN** Locus updates runtime capability status before showing new plugin actions
- **AND** unsupported or degraded Codex plugin execution remains labeled honestly until a safe primitive exists

### Requirement: Target Mode UI Disclosure
The system SHALL show target mode, runtime ownership, trust posture, and execution status in Settings > Plugins.

#### Scenario: User selects a manifest-only plugin
- **WHEN** the user selects a `manifest-only` plugin
- **THEN** Settings > Plugins shows that Locus reads metadata only
- **AND** the detail view does not show controls that imply arbitrary code execution
- **AND** Codex packages remain read-only unless a future Locus-owned execution path exists

#### Scenario: User views plugin sources
- **WHEN** the user views plugin sources
- **THEN** the source detail explains whether the source is local, official, external, cache-backed, or read-only
- **AND** the source detail includes update-review guidance instead of automatic install/update controls

### Requirement: Plugin Recovery And Diagnostics Planning
The system SHALL keep recovery and diagnostics explicit before any plugin execution mode can be enabled.

#### Scenario: Plugin execution is not implemented
- **WHEN** the current plugin target mode is `manifest-only`
- **THEN** diagnostics are limited to metadata, source status, component discovery, and approval state
- **AND** safe-mode language states that arbitrary plugin code is not executed in this change

#### Scenario: Future execution mode is proposed
- **WHEN** a future change proposes `controlled-ui` or `developer-trusted-code` execution
- **THEN** that change must specify startup recovery, safe mode, permission visibility, revocation, logging, tests, and rollback behavior before implementation

### Requirement: Plugin Manifest Fingerprints
The system SHALL compute local manifest fingerprints for discovered plugin packages without executing plugin code.

#### Scenario: Plugin package is discovered
- **WHEN** Locus scans a Claude Code or Codex plugin package
- **THEN** it computes a deterministic fingerprint from bounded manifest and component declaration metadata
- **AND** it does not hash arbitrary source code as proof of trust
- **AND** it does not execute plugin JavaScript or native code

### Requirement: Plugin Update Review State
The system SHALL persist local update-review state for plugin fingerprints.

#### Scenario: User refreshes plugin metadata
- **WHEN** the user refreshes Settings > Plugins
- **THEN** Locus compares the current plugin fingerprint with the previously seen and reviewed fingerprints
- **AND** reports whether the plugin is new, unchanged, changed, or locally reviewed
- **AND** does not download, install, update, enable, or execute plugin packages

#### Scenario: User marks a plugin reviewed
- **WHEN** the user marks the selected plugin fingerprint as reviewed
- **THEN** Locus stores the current fingerprint and review timestamp locally
- **AND** does not change plugin enablement, MCP approval, target mode, or execution status

### Requirement: Plugin Source Pin Metadata
The system SHALL surface available source/store pin metadata as advisory review input.

#### Scenario: Pin metadata is available
- **WHEN** a plugin package exposes a cache version, lock-file source ref, or equivalent stable source pin
- **THEN** Settings > Plugins shows that pin metadata in the plugin detail
- **AND** labels it as advisory review metadata rather than proof of safety

#### Scenario: Pin metadata is unavailable
- **WHEN** no source/store pin can be found
- **THEN** Settings > Plugins clearly reports that no source pin is available
- **AND** does not invent a pin or mark the package as verified

### Requirement: Bounded Plugin Change Summaries
The system SHALL show bounded local summaries of plugin manifest changes.

#### Scenario: Manifest metadata changes
- **WHEN** the current fingerprint differs from the last reviewed fingerprint
- **THEN** the plugin detail shows a bounded summary of changed review fields such as version, target mode, component counts, MCP declarations, or source pin
- **AND** the summary omits plugin source code and secrets

#### Scenario: No reviewed baseline exists
- **WHEN** the plugin has not yet been reviewed locally
- **THEN** the plugin detail asks for local review rather than claiming the package is safe

### Requirement: Plugin MCP Approval Revalidation
The system SHALL bind plugin MCP approval to the current redacted MCP configuration fingerprint.

#### Scenario: Plugin MCP configuration changes
- **WHEN** an enabled Claude plugin MCP declaration changes its command, URL, args, cwd, env/header key set, or other approval-relevant metadata
- **THEN** any previous approval for the old MCP declaration no longer authorizes the changed declaration
- **AND** the MCP server is reported as pending approval again
- **AND** Locus does not store raw MCP secret values in approval metadata

#### Scenario: Legacy plugin MCP approval exists
- **WHEN** the settings file contains an older plugin MCP approval that is not bound to a current MCP configuration fingerprint
- **THEN** Locus treats that legacy approval as stale for runtime MCP activation
- **AND** requires approval of the current fingerprint-bound identifier before adding the plugin MCP server to an agent session
