# Design: Runtime readiness in Local Job API discovery

## Context

Discovery starts from `listRegisteredAgentRuntimeManifests({ scope: "contract" })` and adds a readiness projection. Native credential/status helpers already exist as main-process functions: `hasAnyClaudeCodeAccount()`, `getClaudeCodeCredentialMetadata()`, `getExistingClaudeCredentials()` (keychain plus the effective Claude config directory), and `getCodexRuntimeStatus()`. The later approved headless provider-binding change made `agent_provider_defaults` the first source for provider-omitted runs, so discovery must inspect that default through the same storage and target-validation owners before consulting native credentials. The headless CLI is the Electron main process, so DB and secure storage are available. `provider-diagnostics` remains the separate surface for arbitrary provider-network diagnostics.

## Goals / Non-Goals

- Goals: consumers can distinguish "configured and ready" from "installed but needs auth" before creating a job; consumers can feature-detect contract additions.
- Non-Goals: enforcing readiness at create time (advisory only); readiness for runtimes outside the Local Job API contract; diagnostics for an arbitrary explicitly selected profile; provider-network probes; any `apiVersion` bump.

## Decisions

- **Readiness mirrors provider-omitted execution (D1 coupling)**: discovery follows configured headless default profile → native credentials, matching a provider-omitted run. A strictly readable, target-compatible default reports `ready` without probing native auth. A configured default that is malformed, missing, undecryptable, or targets another runtime reports `unavailable` and does not fall through to native credentials, matching the runner's fail-closed behavior. Only an absent default reaches native checks. Within native Claude readiness, app account store → effective-config-directory CLI login remains the RT-2 order. Explicit request profiles stay outside this runtime-wide advisory surface.
- **State vocabulary**: reuse the codex-runtime-parity vocabulary (`ready`/`needs-auth`) plus `unavailable` (executable missing/blocked) and `unknown` (probe skipped or failed). Do not invent a new taxonomy; map `getCodexRuntimeStatus`'s `failed`/`blocked` to `unavailable` with the underlying detail.
- **Probe cost (D2, accepted)**: Codex status spawns a subprocess (~seconds). Default: probe, with a 30-second in-process cache keyed by runtime id. `--no-probe` skips subprocess work entirely and reports `unknown` for probed states; cheap checks (DB count, file existence) always run.
- **Feature detection over version bump (D5, accepted)**: `apiVersion` remains the exact-match `"locus.local-job.v1"`. A top-level `features` array advertises additive capabilities; consumers must treat unknown feature strings as ignorable. Rationale: the validator silently drops unknown request fields, so version-bumping is the only alternative and it hard-breaks older consumers for a purely additive change.
- **Fail-open discovery, fail-closed configured route**: an unexpected resolver failure yields `state: "unknown"` plus a stderr diagnostic and discovery still exits 0. A recognized unusable configured default instead deterministically reports `unavailable`, because an actual provider-omitted run would fail closed rather than use native auth.
- **No secret text**: `detail`/`hint` strings pass the existing secret-text assertions used by capability manifests (`assertNoSecretText` pattern in `src/shared/agent-runtime-capabilities.ts`).

## Risks / Trade-offs

- Readiness is a point-in-time snapshot; a token can expire between discovery and create. Consumers must still handle `runtime_auth_required` at run time — readiness reduces, not eliminates, the late-failure path.
- `codex login status` output parsing is string-matching on CLI output; a Codex CLI update could degrade codex readiness to `unknown`. Mapped states must degrade, never misreport `ready`.
- The 30s cache can serve one stale `needs-auth` immediately after the user signs in; acceptable for a CLI whose consumers re-probe per operation. `--no-probe` callers get `unknown`, never stale `ready`.
- Claude CLI fallback and the headless adapter now share effective `CLAUDE_CONFIG_DIR` resolution, including an isolated explicit directory and the default directory when the variable is absent or blank; regression tests bind readiness to that same source.

## Migration Plan

Purely additive envelope fields; existing consumers ignore them. Rollback = revert; no schema or persisted-state changes.

## Open Questions

- None blocking.
