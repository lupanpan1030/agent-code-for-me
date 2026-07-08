# Verification: update-headless-claude-credential-source

## Automated Checks

- `PATH="/Users/ethan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" /Users/ethan/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pnpm dlx @fission-ai/openspec validate update-headless-claude-credential-source --strict --no-interactive` — passed.
- `/Users/ethan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit` — passed.
- `/Users/ethan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/check-architecture-guards.mjs` — passed.
- `PATH="/Users/ethan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" ./node_modules/.bin/biome check src/main/lib/claude-credentials.ts src/main/lib/headless/adapters/claude-code.ts src/main/lib/headless/process-runner.ts tests/claude-code-import-validation.test.ts tests/headless-runtime-adapters.test.ts tests/headless-process-runner.test.ts tests/agent-job-store.test.ts` — passed.
- `/opt/homebrew/bin/bun test tests/claude-code-import-validation.test.ts` — passed, 9 tests.
- `/opt/homebrew/bin/bun test tests/headless-runtime-adapters.test.ts tests/headless-process-runner.test.ts tests/agent-job-store.test.ts` — passed, 28 tests.
- `PATH="/Users/ethan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:$PATH" /opt/homebrew/bin/bun run check` — passed: lint, architecture guard, `tsc --noEmit`, and 1383 tests.
- `PATH="/Users/ethan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:$PATH" ./node_modules/.bin/electron scripts/smoke-headless-claude-credential-source.cjs` — passed: isolated Local Job API matrix and Career Kit profile import smoke.

## Credential Matrix Smoke

The smoke uses isolated `LOCUS_USER_DATA_DIR` directories and temporary `CLAUDE_CONFIG_DIR` directories for each case. It runs the real Locus headless CLI, job store, Claude adapter, env construction, and exit-code classification. The bundled `claude` binary is a temporary stub under a temporary Electron app root, so the matrix verifies source resolution without contacting the external Claude service or mutating the user's real `~/.claude`.

| Case | Expected Result | Observed |
| --- | --- | --- |
| App login only | Headless Claude authenticates from app-stored token. | Passed: process exit `0`, job `succeeded`, stub observed source `app`, env token present, no CLI credential. |
| CLI login only | Headless Claude falls back to `CLAUDE_CONFIG_DIR` CLI credentials. | Passed: process exit `0`, job `succeeded`, stub observed source `cli`, no env token, CLI credential present. |
| Both app and CLI login | App-stored `CLAUDE_CODE_OAUTH_TOKEN` wins. | Passed: process exit `0`, job `succeeded`, stub observed source `app`, env token present, CLI credential also present. |
| Neither source | `runtime_auth_required` with dual-remedy hint and missing-credentials exit code. | Passed: process exit `4`, job `failed`, job exit `4`, error code `runtime_auth_required`, stub observed source `none`. |

## Career Kit Path

Passed through `/Users/ethan/Code/GitHub/career-application-kit/app/electron/runtime/domain.cjs` with `CAREER_KIT_LOCUS_CLI_PATH` pointing to the temporary Locus launcher wrapper. The Career Kit command `extract_career_profile_import_draft_via_locus` returned `status: "succeeded"`, `source_type: "locus-ai"`, and one draft entry. The stub observed source `app`, env token present, and no CLI credential.
