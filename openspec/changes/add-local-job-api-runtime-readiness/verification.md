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

## 2026-08-25 RT-2 outcome agreement

The current built Electron main was exercised through
`scripts/smoke-headless-claude-credential-source.cjs` with isolated temporary
user-data/config directories, a temporary Linux Secret Service, synthetic
credentials, and a fake bundled Claude executable. No real account, external
model, or billable request was used.

| Credential row | Readiness | Run outcome | Runtime source |
| --- | --- | --- | --- |
| Locus app only | `ready` | `succeeded`, exit 0 | app token |
| Claude CLI only | `ready` | `succeeded`, exit 0 | CLI credential |
| Both | `ready` | `succeeded`, exit 0 | app token (documented precedence) |
| Neither | `needs-auth` | `failed`, exit 4, `runtime_auth_required` | none |

The first integrated attempt exposed a real disagreement: runtime execution
honored `CLAUDE_CONFIG_DIR`, while readiness looked only in `~/.claude`. The
credential discovery owner and headless adapter now share the same explicit
config-directory selection, and isolated-directory regression tests prove it
does not fall back across that boundary.

The same run also invoked Career Kit's existing
`extract_career_profile_import_draft_via_locus` consumer path through its
SHA-256-pinned launcher contract. It succeeded with the app-only credential,
returned one draft entry, and observed app-token precedence with no CLI
credential.

Task 3.2 is therefore complete. Exact-source full-suite and independent-review
receipts are recorded at change-set closeout before archive.

## 2026-08-26 — Frozen-source implementation verification

- Frozen source SHA: `bdd2e2e57143a69f86f34ed96f84aa9a5e076fd4`
- Branch: `codex/remove-experimental-runtimes`
- Verified at: `2026-08-26 04:20:58 NZST (+1200)`
- Batch scope: `add-cross-workspace-conflicts`,
  `add-headless-provider-binding`, `add-remote-model-catalog`, and
  `add-local-job-api-runtime-readiness`
- The worktree was clean and `HEAD` still resolved to the frozen source SHA
  before and after the exact-source gates and smokes.
- `/home/chen/.codex/config.toml` remained unchanged at SHA-256
  `290689036d77458b496c4386c864384aaf7c21975241b6c1c4a7fe49379881d9`.

Exact-source full gate:

```text
bun run check:full
exit 0
lint:changed passed
architecture guard passed
retired-runtime residue check passed (1565 files scanned, 10 allowlisted)
TypeScript passed
1642 tests passed, 0 failed, 7921 assertions, 278 files
OpenSpec strict validation: 54 passed, 0 failed
production Electron/Vite build passed
diff check passed
```

The build emitted only the existing dynamic-import/chunk, non-module script,
and stale Browserslist-data warnings; none was a failing gate.

The same clean frozen source also passed both built-Electron integration
smokes on Linux. `scripts/smoke-headless-provider-binding.cjs` exited 0 for the
profile and native Codex paths, preserved the one-request routing contract,
and passed all scoped/ambient secret checks.
`scripts/smoke-headless-claude-credential-source.cjs` exited 0 for app-only,
CLI-only, both, and neither credential rows; the expected outcomes were
respectively success/app, success/CLI, success/app precedence, and
`runtime_auth_required` exit 4. Its Career Kit consumer smoke also succeeded
with one `locus-ai` draft entry. The Linux harness used an isolated Xvfb
display and temporary Secret Service; no real account, external model,
billable request, or persistent user credential was used.

Platform coverage note: descriptor-backed stable-directory behavior was
exercised through Linux `/proc/self/fd`. The Darwin `/dev/fd` anchor remains a
macOS smoke boundary; unsupported platforms fail closed and do not fall back
to a path-based business implementation.

### Verdict state

- Codex implementation verdict for the frozen source:
  **`IMPLEMENTATION_VERIFIED`**
- Claude Code independent fresh-context verdict: **pending**;
  `REVIEW_APPROVED` is not asserted here.
- Owner acceptance: **pending**.
- Local merge and archive: **not performed**.
- Push, remote PR mutation, release, and all other remote operations:
  **not authorized and not performed**.
