# Tasks: add-local-job-api-runtime-readiness

## 1. Implementation

- [x] 1.1 Add `runtime-readiness.ts` resolver module under `src/main/lib/headless/`: per-runtime readiness for claude-code (app account metadata OR external CLI login, mirroring RT-2 order) and codex (bundled CLI presence, then `getCodexRuntimeStatus` mapped to ready/needs-auth/unavailable), with 30s in-process cache and fail-open `unknown` on resolver errors
- [x] 1.2 Extend the discovery envelope in `src/shared/local-job-api.ts`: top-level `features: string[]` and per-runtime `readiness { state, detail?, hint? }`; apply secret-text assertions to detail/hint
- [x] 1.3 Wire `toLocalJobApiRuntimeManifestEnvelope` (`src/main/lib/headless/local-job-api.ts`) and make `apiRuntimesListCommand` async (`cli-dispatcher.ts`); add `--no-probe` flag (`cli-args.ts`) that skips subprocess probes and reports `unknown` for probed states
- [x] 1.4 Emit stderr diagnostics for resolver failures without failing the command (exit 0, full manifest list preserved)
- [x] 1.5 Reconcile readiness after headless provider binding: inject the Local Job API database into discovery, inspect configured runtime defaults before native auth, report a usable default as `ready`, report a malformed/missing/undecryptable/mismatched default as `unavailable` without native fallback, and use native readiness only when no default exists
- [x] 1.6 Record the Owner-approved `DIRECT_NEW_STANDARD` decision, known Career Kit/Amadeus impact, feature-detection rule, release order, and no-facade boundary in `consumer-impact.md`

## 2. Tests

- [x] 2.1 Unit: readiness resolver matrix — claude app-account-only / CLI-login-only / neither; codex CLI missing / logged in / not logged in / probe throws (-> unknown, exit 0)
- [x] 2.2 Unit: `--no-probe` skips subprocess probe calls entirely (probe fn not invoked) and reports `unknown` for codex login state; cheap checks still run
- [x] 2.3 Unit: envelope shape — `features` contains `"runtime-readiness"`, readiness fields pass secret-text validation, JSON stdout contains no diagnostics
- [x] 2.4 Unit: cache — second call within 30s does not re-invoke the probe; cache is keyed per runtime
- [x] 2.5 Regression: default-profile ready overrides native needs-auth; broken or target-mismatched default is unavailable even when native auth is ready; absent default reaches native; `--no-probe` still performs the cheap configured-default inspection

## 3. Verification

- [x] 3.1 Manual: `locus api runtimes list --json` on this machine (signed-in state) and with `--no-probe`; record output shapes in `verification.md`
- [x] 3.2 Cross-check with RT-2 matrix runs when those execute: readiness state must agree with actual run outcome on each credential-matrix row
- [x] 3.3 Verify `CLAUDE_CONFIG_DIR` isolation and default-directory behavior use the same credential source in readiness and the headless adapter
