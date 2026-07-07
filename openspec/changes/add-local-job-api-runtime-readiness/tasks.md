# Tasks: add-local-job-api-runtime-readiness

## 1. Implementation

- [ ] 1.1 Add `runtime-readiness.ts` resolver module under `src/main/lib/headless/`: per-runtime readiness for claude-code (app account metadata OR external CLI login, mirroring RT-2 order) and codex (bundled CLI presence, then `getCodexRuntimeStatus` mapped to ready/needs-auth/unavailable), with 30s in-process cache and fail-open `unknown` on resolver errors
- [ ] 1.2 Extend the discovery envelope in `src/shared/local-job-api.ts`: top-level `features: string[]` and per-runtime `readiness { state, detail?, hint? }`; apply secret-text assertions to detail/hint
- [ ] 1.3 Wire `toLocalJobApiRuntimeManifestEnvelope` (`src/main/lib/headless/local-job-api.ts`) and make `apiRuntimesListCommand` async (`cli-dispatcher.ts`); add `--no-probe` flag (`cli-args.ts`) that skips subprocess probes and reports `unknown` for probed states
- [ ] 1.4 Emit stderr diagnostics for resolver failures without failing the command (exit 0, full manifest list preserved)

## 2. Tests

- [ ] 2.1 Unit: readiness resolver matrix — claude app-account-only / CLI-login-only / neither; codex CLI missing / logged in / not logged in / probe throws (→ unknown, exit 0)
- [ ] 2.2 Unit: `--no-probe` skips subprocess probe calls entirely (probe fn not invoked) and reports `unknown` for codex login state; cheap checks still run
- [ ] 2.3 Unit: envelope shape — `features` contains `"runtime-readiness"`, readiness fields pass secret-text validation, JSON stdout contains no diagnostics
- [ ] 2.4 Unit: cache — second call within 30s does not re-invoke the probe; cache is keyed per runtime

## 3. Verification

- [ ] 3.1 Manual: `locus api runtimes list --json` on this machine (signed-in state) and with `--no-probe`; record output shapes in `verification.md`
- [ ] 3.2 Cross-check with RT-2 matrix runs when those execute: readiness state must agree with actual run outcome on each credential-matrix row
