# Design: Headless Claude credential source alignment

## Context

Two credential worlds exist for Claude today. Desktop resolves the active app account (`anthropic_accounts` → `getValidClaudeCodeCredential`) and injects `CLAUDE_CODE_OAUTH_TOKEN` with an isolated `CLAUDE_CONFIG_DIR`. Headless (`src/main/lib/headless/adapters/claude-code.ts`) builds env via `buildClaudeEnv({ enableTasks: true })` only — the strip list removes `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_BASE_URL`, nothing re-injects a token, and the bundled binary falls back to `~/.claude`. Sync between the stores is one-way (import `~/.claude` → app DB) with no reverse write. Codex, by contrast, shares `~/.codex` across both surfaces (the desktop isolated home copies `auth.json` in).

Feasibility is verified: the headless CLI is the Electron main process launched with `--locus-headless-cli` after `app.whenReady()`, so `safeStorage` decryption and DB access work; `createClaudeAgentSdkRuntimeEnv` and `buildClaudeEnv`'s `customEnv` seam (applied after the strip list) are exported, non-desktop helpers.

## Goals / Non-Goals

- Goals: one desktop sign-in makes headless Claude runs work; preserve existing CLI-login behavior as fallback; actionable auth diagnostics.
- Non-Goals: provider-profile selection for headless (RT-4), readiness advertising (RT-3), any Local Job API contract change, reverse-syncing tokens into `~/.claude`, changing the desktop path.

## Decisions

- **Resolution order (D1, accepted)**: app account store first; if no account exists or the token cannot be resolved, fall back to today's `~/.claude` behavior. Rationale: mirrors Codex's single-source principle; the app store is the surface Locus actively manages and can refresh.
- **Injection seam**: reuse `createClaudeAgentSdkRuntimeEnv` (sets `CLAUDE_CODE_OAUTH_TOKEN` only when no `ANTHROPIC_*` config is present — always true headless since the strip list runs first). Do not hand-roll env assembly in the adapter.
- **Config dir**: auth-only alignment. Keep the existing headless `CLAUDE_CONFIG_DIR` when one is already present, otherwise use the CLI's default config dir (`~/.claude`) for settings/skills; do NOT adopt the desktop's per-owner isolated `CLAUDE_CONFIG_DIR` in this change. Smallest behavioral delta; isolation parity can be a later hardening.
- **Cheap gating**: use `hasAnyClaudeCodeAccount()` (sync, DB count) to decide whether to attempt app-store resolution, so machines with CLI-only login skip DB/secure-storage work entirely.
- **Refresh failures fall back, not fail**: if the app-store token is expired and refresh throws, log a stderr diagnostic and fall back to `~/.claude` rather than failing the job — an app-store problem must not regress users whose CLI login works. If both sources are absent, the existing `runtime_auth_required` classification fires with the new dual-remedy hint.
- **Inherited env token policy**: headless Claude strips inherited `CLAUDE_CODE_OAUTH_TOKEN` rather than treating it as a third credential source. If no app-stored token is injected, the adapter emits a stderr warning that the env token was ignored and points users to Locus desktop sign-in or `claude` CLI login. Rationale: this keeps the run's effective credential source explainable and prevents stale shell/CI tokens from silently overriding the app-managed account or CLI login.
- **Refresh concurrency**: app-stored credential refresh uses module-level single-flight keyed by the active account and refresh-token fingerprint. Concurrent jobs in one process share the same refresh promise. If `invalid_grant` is returned, the account is removed only when the stored encrypted credential still matches the credential that was refreshed, preventing a losing concurrent refresh from deleting an account already updated by another worker/process.

## Risks / Trade-offs

- Token precedence: if both an injected `CLAUDE_CODE_OAUTH_TOKEN` and a `~/.claude` login exist, the env token must win. Verify the bundled CLI honors this precedence during implementation; if it does not, fall back to not injecting when `~/.claude` has a valid login and document the order.
- Env-token compatibility: shell/CI users who relied only on inherited `CLAUDE_CODE_OAUTH_TOKEN` must move to Locus desktop sign-in or `claude` CLI login. This is an intentional security/diagnostics trade-off for this change and is surfaced as a warning.
- Token exposure: the app-stored token enters the child env only (never argv, never job events). Existing event redaction (`job-store.ts` secret patterns) already covers token-like strings; add a regression test.
- Network-on-start: `getValidClaudeCodeCredential` may refresh over the network. Acceptable for job startup; the schedule/daemon paths share the same adapter so behavior stays uniform.

## Migration Plan

Pure behavioral addition with fallback; no schema or contract migration. Rollback = revert the adapter change.

## Open Questions

- None blocking. CLI token-precedence verification is folded into task 1.2.
