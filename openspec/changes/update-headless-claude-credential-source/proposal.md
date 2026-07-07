# Change: Align headless Claude credential source with the desktop app store

## Why

Desktop Claude runs authenticate from the app-managed account store (`anthropic_accounts` via `CLAUDE_CODE_OAUTH_TOKEN` injection), but headless Claude runs inject nothing and silently fall back to the bundled CLI's own `~/.claude` login. A user who signed in only through the Locus desktop app gets working desktop runs and failing headless runs (`runtime_auth_required`), and downstream Local Job API consumers (e.g. Career Kit) hit this as an unexplained late failure. Code and spec archaeology confirm the divergence is an implementation gap, not a documented decision: Codex already keeps a single credential source (`~/.codex`) across desktop and headless, and the agent-runtime-core credential boundary ("existing local credential or provider-profile mechanisms") is satisfied by either source without choosing one.

## What Changes

- Headless Claude batch runs resolve credentials from the app account store first (same `getValidClaudeCodeCredential()` source as desktop) and inject the token through the existing `createClaudeAgentSdkRuntimeEnv` seam (`CLAUDE_CODE_OAUTH_TOKEN`).
- When no app-stored account exists (or secure storage is unavailable), behavior falls back to today's path: the bundled CLI's own `~/.claude` login. No user currently relying on CLI login is broken.
- `runtime_auth_required` diagnostics gain an actionable hint that names both remedies (sign in via Locus desktop, or `claude` CLI login).
- No contract change: Local Job API request/response shapes are untouched. This is a credential-resolution fix inside the headless Claude adapter.

## Impact

- Affected specs: `headless-agent-jobs` (new requirement: headless Claude credential resolution), `claude-code-credentials` (new requirement: app store as canonical source across execution surfaces)
- Affected code: `src/main/lib/headless/adapters/claude-code.ts` (env construction), reusing exported helpers `src/main/lib/claude/env.ts` (`createClaudeAgentSdkRuntimeEnv`, strip-list semantics) and `src/main/lib/claude-credentials.ts` (`getValidClaudeCodeCredential`, `hasAnyClaudeCodeAccount`); diagnostics text in `src/main/lib/headless/process-runner.ts`
- Depends on decision D1 (accepted 2026-07-08): app DB first, `~/.claude` fallback
- Unblocks: RT-3 discovery readiness (readiness must report the credential source the run will actually use)
