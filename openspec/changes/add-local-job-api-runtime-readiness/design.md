# Design: Runtime readiness in Local Job API discovery

## Context

Discovery today is `listRegisteredAgentRuntimeManifests({ scope: "contract" })` — pure static data. All credential/status helpers needed for readiness already exist as main-process functions with no renderer dependency: `hasAnyClaudeCodeAccount()` (sync DB count), `getClaudeCodeCredentialMetadata()` (sync, returns `isConnected`), `getExistingClaudeCredentials()` (keychain + `~/.claude/.credentials.json` read), `getCodexRuntimeStatus()` (spawns `codex login status`, already emits `ready`/`needs-auth`/`failed`/`blocked`). The headless CLI is the Electron main process, so DB and secure storage are available. Prior art: the `provider-diagnostics` spec separates provider-network diagnostics from local runtime readiness; `codex-runtime-parity` requires a normalized `needs-auth` state. Nothing exposes either through the Local Job API yet.

## Goals / Non-Goals

- Goals: consumers can distinguish "configured and ready" from "installed but needs auth" before creating a job; consumers can feature-detect contract additions.
- Non-Goals: enforcing readiness at create time (advisory only); readiness for runtimes outside the Local Job API contract; provider-profile-level diagnostics (that is `provider-diagnostics`, desktop surface); any `apiVersion` bump.

## Decisions

- **Readiness mirrors execution (D1 coupling)**: Claude readiness is `ready` when the app account store has a connected account OR an external CLI login exists — exactly the RT-2 resolution order. A readiness field that checks a different source than the runner uses would reintroduce the Kit false-positive problem in a new form.
- **State vocabulary**: reuse the codex-runtime-parity vocabulary (`ready`/`needs-auth`) plus `unavailable` (executable missing/blocked) and `unknown` (probe skipped or failed). Do not invent a new taxonomy; map `getCodexRuntimeStatus`'s `failed`/`blocked` to `unavailable` with the underlying detail.
- **Probe cost (D2, accepted)**: Codex status spawns a subprocess (~seconds). Default: probe, with a 30-second in-process cache keyed by runtime id. `--no-probe` skips subprocess work entirely and reports `unknown` for probed states; cheap checks (DB count, file existence) always run.
- **Feature detection over version bump (D5, accepted)**: `apiVersion` remains the exact-match `"locus.local-job.v1"`. A top-level `features` array advertises additive capabilities; consumers must treat unknown feature strings as ignorable. Rationale: the validator silently drops unknown request fields, so version-bumping is the only alternative and it hard-breaks older consumers for a purely additive change.
- **Fail-open discovery**: a readiness resolver that throws yields `state: "unknown"` plus a stderr diagnostic; the command still exits 0 with the full manifest list. Discovery must never be less available than it is today.
- **No secret text**: `detail`/`hint` strings pass the existing secret-text assertions used by capability manifests (`assertNoSecretText` pattern in `src/shared/agent-runtime-capabilities.ts`).

## Risks / Trade-offs

- Readiness is a point-in-time snapshot; a token can expire between discovery and create. Consumers must still handle `runtime_auth_required` at run time — readiness reduces, not eliminates, the late-failure path.
- `codex login status` output parsing is string-matching on CLI output; a Codex CLI update could degrade codex readiness to `unknown`. Mapped states must degrade, never misreport `ready`.
- The 30s cache can serve one stale `needs-auth` immediately after the user signs in; acceptable for a CLI whose consumers re-probe per operation. `--no-probe` callers get `unknown`, never stale `ready`.
- Claude CLI fallback readiness currently reflects the default Claude credential lookup (`~/.claude` fallback plus platform credential store), while the run path can inherit `CLAUDE_CONFIG_DIR`. Custom Claude config directories can therefore diverge until the credential helper is made config-dir aware.

## Migration Plan

Purely additive envelope fields; existing consumers ignore them. Rollback = revert; no schema or persisted-state changes.

## Open Questions

- None blocking.
