# Verification: add-local-job-api-runtime-readiness

## Implementation Validation

- `PATH="/Users/ethan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:$PATH" /opt/homebrew/bin/bun test tests/runtime-readiness.test.ts tests/codex-cli-path.test.ts tests/codex-runtime-status.test.ts tests/headless-cli-dispatcher.test.ts tests/local-job-api-schema.test.ts tests/local-job-api.test.ts` - passed: 70 tests, 327 assertions.
- `PATH="/Users/ethan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:$PATH" /opt/homebrew/bin/bun run check` - passed: lint changed, architecture guard, TypeScript, 1402 tests, 7150 assertions.
- `PATH="/Users/ethan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:$PATH" /opt/homebrew/bin/bun run build` - passed. Vite emitted existing chunk/dynamic-import warnings only.

## CLI Smoke

- Direct built-main smoke: `electron out/main/index.js --locus-headless-cli api runtimes list --json`
  - exit code 0
  - envelope parsed as `apiVersion: "locus.local-job.v1"`
  - `features: ["runtime-readiness"]`
  - readiness summary on this machine: `claude-code=needs-auth`, `codex=ready`
  - local-job-api diagnostic lines on stderr: 0
- Direct built-main smoke: `electron out/main/index.js --locus-headless-cli api runtimes list --json --no-probe`
  - exit code 0
  - envelope parsed as `apiVersion: "locus.local-job.v1"`
  - `features: ["runtime-readiness"]`
  - readiness summary on this machine: `claude-code=needs-auth`, `codex=unknown`
  - local-job-api diagnostic lines on stderr: 0
- Launcher smoke: `resources/cli/locus api runtimes list --json --no-probe` through a temporary `LOCUS_HEADLESS_EXECUTABLE` wrapper pointing at the built Electron main bundle
  - exit code 0
  - envelope parsed as `apiVersion: "locus.local-job.v1"`
  - `features: ["runtime-readiness"]`
  - readiness summary on this machine: `claude-code=needs-auth`, `codex=unknown`

Notes:

- The first direct smoke attempt against the stale pre-build `out/main/index.js` rejected `--no-probe`; rebuilding refreshed the bundle and the same command shape passed.
- The earlier `codex=unavailable` smoke result was a dev-path false negative: `electron out/main/index.js` made `app.getAppPath()` resolve inside `out/main`, so discovery looked for `out/main/resources/bin/...`. The path owner now resolves non-packaged app paths back to the repo root before looking under `resources/bin/...`.
- Codex reports `ready` with default probing on this machine and `unknown` with `--no-probe`, so skipped probing does not upgrade to `ready`. Claude currently reports `needs-auth` on this machine because neither a usable app credential nor a usable CLI credential is available.
- Resolver-level credential-source agreement is covered by tests (`claude-code` app account first only when usable, CLI fallback second only when usable, neither -> `needs-auth`) and by the full suite's headless Claude credential tests. RT-2 real credential mutation matrix has not run during this verification, so task 3.2 remains open.

## Proposal Validation

- `PATH="/Users/ethan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:$PATH" /Users/ethan/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pnpm dlx @fission-ai/openspec validate add-local-job-api-runtime-readiness --strict --no-interactive` - passed.
