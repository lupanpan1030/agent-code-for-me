# provider-routing-ux Specification Delta

Two requirements are modified to drop the removed runtimes from their enumerations, and one is
removed outright because both of its subjects are gone. **This capability survives** — the Model
control, localization, and account-source requirements are unchanged and are not restated here.

## MODIFIED Requirements

### Requirement: Engine selection is the sole runtime switch

The chat composition UI SHALL provide a single Engine control that selects the
runtime (Claude Code, Codex) and SHALL be the only control that changes the
runtime. The Engine control SHALL surface runtime status derived from the runtime
capability manifest and runtime setup status (e.g. unavailable, setup-required)
without changing manifest data. Setup-required or unavailable engines SHALL be
non-runnable: they SHALL NOT change the selected runtime, start a run, or create a
sub-chat, though the UI MAY disable them or route the user to setup. No other
control — including the Model control — SHALL change the selected runtime.

#### Scenario: Engine control switches runtime
- **WHEN** the user opens the Engine control
- **THEN** it lists the enabled runtimes with manifest/setup-derived status and
  selecting a ready runtime changes the runtime
- **AND** no other control changes the runtime

#### Scenario: Engine status reflects the manifest
- **WHEN** a runtime is unavailable or requires setup
- **THEN** the Engine control shows that status from the runtime manifest/setup
  status rather than presenting the runtime as ready

#### Scenario: Setup-required engines cannot start work
- **WHEN** a runtime is unavailable or requires setup
- **THEN** selecting it does not change the selected runtime
- **AND** no run starts and no active-chat sub-chat is created
- **AND** the UI either disables the engine choice or routes the user to the
  relevant setup surface

#### Scenario: Engine control exposes the closed supported runtime set
- **WHEN** the user opens the Engine control
- **THEN** it lists only `claude-code` and `codex`
- **AND** no runtime feature-gate toggle expands that closed set

### Requirement: Engine switch preserves empty and non-empty active-chat behavior

Switching the Engine in active chat SHALL preserve the existing distinction
between empty and non-empty sub-chats for ALL runtimes. If the current active
sub-chat is empty, the Engine switch SHALL update that sub-chat in place without
history attachment or a new tab. If the current active chat has history, switching
the Engine SHALL start a new sub-chat that attaches the prior conversation as
history context and inherits per-runtime model preferences, after the existing
confirmation. The confirmation that previously lived inside the combined model
selector SHALL be presented by the Engine control. The same Engine and Model
controls SHALL be used on both the new-chat form and the active-chat input.

#### Scenario: Switching engine in an empty active sub-chat updates in place
- **WHEN** the user switches the Engine while the active sub-chat has no messages
- **THEN** the current sub-chat runtime is updated in place
- **AND** no history attachment is staged and no new sub-chat is created

#### Scenario: Switching engine in an active chat starts a new sub-chat
- **WHEN** the user switches the Engine while an active chat has history
- **THEN** the UI confirms, then creates a new sub-chat with the prior history
  attached and per-runtime model preferences inherited for the target runtime

#### Scenario: New-chat and active-chat use the same controls
- **WHEN** the Engine or Model control renders on the new-chat form and on the
  active-chat input
- **THEN** both surfaces use the same Engine and Model components with consistent
  behavior

## REMOVED Requirements

### Requirement: Runtime-managed Model state for runtimes without profile parity
**Reason**: Both of this requirement's subjects are removed. It specified a runtime-managed / setup
state for a runtime whose provider-profile capability is `degraded` — its only instance was Qwen
Code — and required that Kun use the shared Model control rather than a bespoke selector. With both
runtimes deleted, every remaining runtime supports provider profiles, so there is no
without-parity case left to specify and no bespoke selector left to forbid. Its two scenarios
("Qwen shows runtime-managed state", "Kun uses the shared Model control") have no subject.

**Migration**: None. The surviving contract runtimes both support provider profiles and already
render through the shared Model control. The clause this requirement also carried — that the
renderer handles only source/profile identifiers and never receives plaintext provider secrets — is
not lost: it remains specified by the secret-boundary requirements in `provider-runtime-bindings`
and is enforced independently of any runtime's profile parity. Should a future runtime ship without
provider-profile support, it will need a without-parity contract written against its own
requirements rather than one inherited from two deleted runtimes.
