# Tasks: update-headless-claude-credential-source

## 1. Implementation

- [x] 1.1 Add app-store credential resolution to the headless Claude adapter: gate on `hasAnyClaudeCodeAccount()`, resolve via `getValidClaudeCodeCredential()`, inject through `createClaudeAgentSdkRuntimeEnv` / `buildClaudeEnv` customEnv seam (`src/main/lib/headless/adapters/claude-code.ts`)
- [x] 1.2 Verify bundled CLI precedence: injected `CLAUDE_CODE_OAUTH_TOKEN` must win over an existing `~/.claude` login; document the verified order in code comments only if the CLI required a workaround
- [x] 1.3 Fallback semantics: no app account, secure-storage unavailable, or refresh failure → stderr diagnostic + today's `~/.claude` behavior (never hard-fail solely because the app store is unhealthy)
- [x] 1.4 Update `runtime_auth_required` diagnostic hint to name both remedies (Locus desktop sign-in, `claude` CLI login) in `src/main/lib/headless/process-runner.ts`
- [x] 1.5 Add single-flight for active Claude credential refresh and guard `invalid_grant` account removal against deleting an account already updated by another refresh
- [x] 1.6 Document and warn for ignored inherited `CLAUDE_CODE_OAUTH_TOKEN` in headless Claude

## 2. Tests

- [x] 2.1 Unit: adapter env construction with app account present (token injected, `ANTHROPIC_*` still stripped), absent (no token key), and refresh-failure (fallback, no throw)
- [x] 2.2 Regression: job events and CLI stderr never contain the token (redaction patterns hold)
- [x] 2.3 Unit: concurrent credential refresh coalesces to one refresh call and `invalid_grant` does not delete an already-updated account
- [x] 2.4 Unit: ignored inherited env token warning, null-token fallback, default `CLAUDE_CONFIG_DIR`, generic auth guidance, and persisted job-event redaction

## 3. Verification

- [x] 3.1 Manual matrix in `verification.md`: app-login-only / cli-login-only / both / neither × `locus run --runtime claude-code` — record observed auth source and exit codes
- [x] 3.2 Confirm Career Kit profile-extraction path succeeds on an app-login-only machine
