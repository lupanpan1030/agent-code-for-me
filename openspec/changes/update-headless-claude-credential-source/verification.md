# Verification: update-headless-claude-credential-source

## Automated Checks

- `PATH="/Users/ethan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" /Users/ethan/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pnpm dlx @fission-ai/openspec validate update-headless-claude-credential-source --strict --no-interactive` — passed.
- `/Users/ethan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit` — passed.
- `/Users/ethan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/check-architecture-guards.mjs` — passed.
- `PATH="/Users/ethan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" ./node_modules/.bin/biome check src/main/lib/claude-credentials.ts src/main/lib/headless/adapters/claude-code.ts src/main/lib/headless/process-runner.ts tests/claude-code-import-validation.test.ts tests/headless-runtime-adapters.test.ts tests/headless-process-runner.test.ts tests/agent-job-store.test.ts` — passed.
- `/opt/homebrew/bin/bun test tests/claude-code-import-validation.test.ts` — passed, 9 tests.
- `/opt/homebrew/bin/bun test tests/headless-runtime-adapters.test.ts tests/headless-process-runner.test.ts tests/agent-job-store.test.ts` — passed, 28 tests.
- `PATH="/Users/ethan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:$PATH" /opt/homebrew/bin/bun run check` — passed: lint, architecture guard, `tsc --noEmit`, and 1383 tests.

## Manual Credential Matrix

Not run in this implementation pass because it requires changing real local Claude auth state.

| Case | Expected Result | Observed |
| --- | --- | --- |
| App login only | Headless Claude authenticates from app-stored token. | Not run |
| CLI login only | Headless Claude falls back to `~/.claude`. | Not run |
| Both app and CLI login | App-stored `CLAUDE_CODE_OAUTH_TOKEN` wins. | Not run |
| Neither source | `runtime_auth_required` with dual-remedy hint and missing-credentials exit code. | Not run |

## Career Kit Path

Not run in this implementation pass. Requires an app-login-only Locus machine state and the Career Kit profile-extraction workflow.
