# Verification: add-local-job-api-runtime-readiness

## Implementation Validation

- `PATH="/Users/ethan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:$PATH" /opt/homebrew/bin/bun test tests/runtime-readiness.test.ts tests/headless-cli-args.test.ts tests/headless-cli-dispatcher.test.ts tests/local-job-api-schema.test.ts tests/local-job-api.test.ts` - passed: 68 tests, 338 assertions.
- `PATH="/Users/ethan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:$PATH" /opt/homebrew/bin/bun run check` - passed: lint changed, architecture guard, TypeScript, 1393 tests, 7134 assertions.
- `PATH="/Users/ethan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:$PATH" /opt/homebrew/bin/bun run build` - passed. Vite emitted existing chunk/dynamic-import warnings only.

## CLI Smoke

- Direct built-main smoke: `electron out/main/index.js --locus-headless-cli api runtimes list --json`
  - exit code 0
  - envelope parsed as `apiVersion: "locus.local-job.v1"`
  - `features: ["runtime-readiness"]`
  - readiness summary on this machine: `claude-code=ready`, `codex=unavailable`
  - local-job-api diagnostic lines on stderr: 0
- Direct built-main smoke: `electron out/main/index.js --locus-headless-cli api runtimes list --json --no-probe`
  - exit code 0
  - envelope parsed as `apiVersion: "locus.local-job.v1"`
  - `features: ["runtime-readiness"]`
  - readiness summary on this machine: `claude-code=ready`, `codex=unavailable`
  - local-job-api diagnostic lines on stderr: 0
- Launcher smoke: `resources/cli/locus api runtimes list --json --no-probe` through a temporary `LOCUS_HEADLESS_EXECUTABLE` wrapper pointing at the built Electron main bundle
  - exit code 0
  - envelope parsed as `apiVersion: "locus.local-job.v1"`
  - `features: ["runtime-readiness"]`
  - readiness summary on this machine: `claude-code=ready`, `codex=unavailable`

Notes:

- The first direct smoke attempt against the stale pre-build `out/main/index.js` rejected `--no-probe`; rebuilding refreshed the bundle and the same command shape passed.
- Codex reported `unavailable` on this machine before any subprocess login probe was needed, so `--no-probe` correctly did not upgrade it to `ready`.
- RT-2 credential-source agreement is covered by the resolver matrix (`claude-code` app account first, CLI fallback second, neither -> `needs-auth`) and by the full suite's headless Claude credential tests. No real credential mutation was performed during this verification.

## Proposal Validation

- `PATH="/Users/ethan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:$PATH" /Users/ethan/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pnpm dlx @fission-ai/openspec validate add-local-job-api-runtime-readiness --strict --no-interactive` - passed.
