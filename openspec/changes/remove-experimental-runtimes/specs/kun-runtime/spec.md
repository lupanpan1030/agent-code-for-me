# kun-runtime Specification Delta

The `kun` runtime is removed in full. This capability ceases to exist and
`openspec/specs/kun-runtime/` is deleted.

**Shared reason for every requirement below.** The `kun` runtime is retired because it delivers no
capability Locus lacks — its only cited value, cheap DeepSeek access, is already served by the
shipped DeepSeek provider preset targeting `claude` and `codex` through the same provider gateway
Kun itself consumes. It is additionally a third-party competitor product (`KunAgent/Kun`, formerly
`XingYu-Zhong/DeepSeek-GUI`) under a PolyForm Noncommercial 1.0.0 licence, and is effectively
uninstallable: no bundled binary, an empty managed-install allowlist, and an upstream package that
is `private: true` and unpublished.

**Shared migration for every requirement below.** No data migration. Verified 2026-08-12 that this
installation has zero `kun` rows (`agent_jobs`: 339 rows, all `codex`; no `sub_chats` reference the
runtime) and Locus has no other users. Users wanting a cheap model select a DeepSeek provider
profile on the Codex or Claude Code engine. A one-time startup sweep removes
`{userData}/kun-cli-settings.json` and `{userData}/runtimes/kun/`.

## REMOVED Requirements

### Requirement: Flag-gated Kun runtime registration
**Reason**: The runtime is removed, so there is nothing to register. `EXPERIMENTAL_RUNTIME_IDS`
becomes empty and the feature-gate mechanism is deleted with it.
**Migration**: None required — no installation has the flag enabled.

### Requirement: Supervised Kun daemon lifecycle
**Reason**: `kun serve` is no longer launched; `src/main/lib/kun/kun-serve-launcher.ts` is deleted.
**Migration**: None. Any orphaned daemon exits when its parent Locus process does.

### Requirement: Hardened Kun launch overrides fail-open defaults
**Reason**: The hardening existed only to constrain a `--sandbox-mode danger-full-access` launch
that no longer happens.
**Migration**: None.

### Requirement: Kun HTTP/SSE transport
**Reason**: `kun-http-sse-transport.ts` and `kun-http-sse-adapter.ts` are deleted along with their
adapter-source union member and desktop adapter metadata.
**Migration**: None. Codex and Claude Code transports are untouched.

### Requirement: Conservative fail-closed Kun permission mapping
**Reason**: All Kun permission mappings, decision codes and reason strings are removed from
`agent-runtime/permission-policy.ts`.
**Migration**: None. The mappings for the two contract runtimes are unchanged.

### Requirement: Locus and Kun token separation
**Reason**: No Kun process is spawned, so no scoped gateway token is minted for one.
**Migration**: None. Per-run gateway token scoping for contract runtimes is retained and is
specified separately in `provider-runtime-bindings`.

### Requirement: BYO Kun executable resolution
**Reason**: `kun-cli-status.ts` and `kun-cli-settings.ts` are deleted, including the executable and
config path overrides and the shell-approval hash.
**Migration**: None. The startup sweep removes `{userData}/kun-cli-settings.json`.

### Requirement: Isolated Kun runtime state
**Reason**: There is no Kun runtime state left to isolate.
**Migration**: The startup sweep removes `{userData}/runtimes/kun/`, which may hold a
several-hundred-megabyte third-party binary.

### Requirement: Honest Kun capability manifest
**Reason**: `KUN_RUNTIME_MANIFEST` and its `AGENT_RUNTIME_MANIFESTS` entry are deleted.
**Migration**: None. Manifest honesty for the remaining runtimes is unaffected.

### Requirement: Main-process Kun managed install
**Reason**: `kun-managed-install.ts` is deleted. It was already inert in production — its build
allowlist shipped as an empty array, so managed install always resolved `unavailable`.
**Migration**: None. Nothing was ever installed through this path.

### Requirement: Managed install does not grant shell
**Reason**: Both the managed install and the shell-approval mechanism it was constrained against
are removed.
**Migration**: None.

### Requirement: Kun setup state distinguishes install, config, and shell
**Reason**: The tri-state setup model is deleted with `kun-cli-status.ts`.
**Migration**: None.

### Requirement: Kun enablement is a deliberate, non-advertised Settings toggle
**Reason**: The toggle, its Settings row, and the persisted
`{userData}/runtime-feature-settings.json` that backed it are all removed. With
`EXPERIMENTAL_RUNTIME_IDS` empty, the gate has no subject.
**Migration**: The startup sweep deletes the settings file.

### Requirement: Kun is absent and fails closed when disabled
**Reason**: Kun is now unconditionally absent, which is strictly stronger than the fail-closed
behaviour this requirement specified.
**Migration**: None.

### Requirement: Disabling Kun stops in-flight Kun work
**Reason**: No in-flight Kun work can exist.
**Migration**: None.

### Requirement: Kun setup state survives toggling
**Reason**: There is no toggle and no setup state.
**Migration**: None.
