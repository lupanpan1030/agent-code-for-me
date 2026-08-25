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

## Independent review — fresh-context Claude Code (2026-08-26)

- Source SHA under review: `bdd2e2e57143a69f86f34ed96f84aa9a5e076fd4` (worktree at review time: `f9a16c70`, which differs from the source SHA by evidence-docs commits only).
- Review mode: read-only fresh-context review subagent dispatched by the Claude Code coordination session; implementation context not reused; no product files edited during review; working tree confirmed clean after any spot-run tests.
- Cross-cutting security pass over the same SHA: `REVIEW_APPROVED` (full record: `openspec/changes/add-headless-provider-binding/verification.md`).
- Verdict: **`REVIEW_APPROVED`** for `bdd2e2e57143a69f86f34ed96f84aa9a5e076fd4` — zero P0/P1/P2 findings. Technical verdict for this exact SHA only; it does not constitute Owner product acceptance and does not authorize push, remote PR mutation, remote merge, release, or repository-rules changes. Any subsequent code change to the source invalidates this verdict.
- P3 notes (non-blocking, recorded for follow-up triage):
  - `src/main/lib/headless/local-job-api.ts:684` — Redundant readiness assertion in envelope builder. toLocalJobApiRuntimeManifestEnvelope calls assertLocalJobApiRuntimeReadiness(readiness) on a value already normalized/asserted inside resolveLocalJobApiRuntimeReadiness (via readiness()/normalizeLocalJobApiRuntimeReadiness, including the catch-path unknownReadiness()). It is not reachable as a failure path today, but if it ever did throw here it would reject the whole Promise.all for all runtimes rather than degrading only the offending runtime to 'unknown', which is a slightly different failure mode than the fail-open contract the spec describes. Not a live bug; just a fragile invariant worth a comment or removing the duplicate call.
  - `src/main/lib/headless/provider-binding.ts:505` — Readiness for a configured default does not cover gateway-token creation, so 'ready' can still fail at create time. inspectHeadlessDefaultProviderBinding only runs assertProfileTargetsRuntime + assertProfileCloudAllowed; the actual run path (profileProviderBinding) additionally calls createGatewayEndpoint, which can fail independently (e.g. keychain/network error) after readiness already reported 'ready'. This is explicitly called out as an accepted point-in-time risk in design.md ('Risks / Trade-offs'), and readiness is documented as advisory-only, so this is not a new gap introduced by the change — flagging only so the risk stays visible for anyone re-reading the code without the design doc.

### Reviewer summary

Change under review (add-local-job-api-runtime-readiness) at bdd2e2e5 is almost entirely an openspec paperwork closeout: consumer-impact.md (new), verification.md (new), and small proposal/design/tasks/spec.md updates reconciling the already-merged readiness feature with the sibling add-headless-provider-binding change. The actual runtime-readiness implementation (src/main/lib/headless/runtime-readiness.ts, src/shared/local-job-api.ts envelope types, cli-args/cli-dispatcher wiring) landed on main before this branch; the branch's own code contribution to readiness is the default-provider-then-native reconciliation in resolveLocalJobApiRuntimeReadiness/resolveDefaultProviderReadiness plus the db/providerBindingDependencies plumbing into toLocalJobApiRuntimeManifestEnvelope.

Verified directly against source:
- Resolution order matches the documented/spec'd contract: configured headless default provider profile first (via inspectHeadlessDefaultProviderBinding, same target/cloud-allowed assertions used by the real profileProviderBinding run path) with fail-closed 'unavailable' on any malformed/missing/undecryptable/mismatched default (no native fallback); only an absent default ('not-configured') falls through to native checks. For Claude, native order is app-account (hasAnyClaudeCodeAccount + getClaudeCodeCredentialMetadata, with expiry/refreshable logic) then CLI login (getExistingClaudeCredentials) — matching RT-2. For Codex: bundled CLI executable presence, then getCodexRuntimeStatus login-state mapping.
- CLAUDE_CONFIG_DIR parity is real, not just naming: both the readiness resolver (via getExistingClaudeCredentials) and the headless Claude adapter (src/main/lib/headless/adapters/claude-code.ts) call the same getClaudeCredentialConfigDir() in src/main/lib/claude-token.ts, and tests/claude-runtime-readiness-config-dir.test.ts exercises the real (unmocked) function in an isolated subprocess/HOME, covering explicit dir, isolated-dir non-fallback, blank-dir default behavior, and missing-credential cases.
- --no-probe: for Codex, probe=false returns 'unknown' for the login-status check while still running the cheap executable-presence check and the cheap default-provider-binding inspection (tests confirm probe fn not invoked, executable check still invoked, default-provider check still 'ready'). Claude readiness never depends on probe since it only does cheap file/OS-keychain reads, consistent with design.md D2.
- 30s cache is scoped to the Codex subprocess probe only (keyed 'codex'), not applied to default-provider or Claude paths, matching the stated rationale (only Codex spawns a subprocess).
- Advisory/no-secret-leak semantics hold: detail/hint strings are static or pass assertNoSecretText via normalizeLocalJobApiRuntimeReadiness/assertLocalJobApiRuntimeReadiness; profileId/model values from inspectHeadlessDefaultProviderBinding are never echoed into the readiness detail/hint (confirmed by tests asserting JSON.stringify(readiness) excludes profile ids and tokens).
- features:["runtime-readiness", "provider-binding", "completion"] ships without an apiVersion bump; LOCAL_JOB_API_VERSION stays exact-match 'locus.local-job.v1'. docs/local-job-api-v1.schema.json's runtimeReadinessState enum and discoveryFeature enum match src/shared/local-job-api.ts exactly, and tests/local-job-api-schema.test.ts directly diffs the schema $defs against the runtime shape (drift-detection safeguard).
- No regression from the surrounding bdd2e2e5 hardening: the large local-job-api.ts diff is scoped to artifact-directory/file TOCTOU hardening (stable-directory handles, atomic writes) and is orthogonal to the readiness code path; the headless stdio.ts fix (1d4be1a1) changes end()->write('') so stdout/stderr stay writable after the flush barrier — a strict improvement, not a regression, for late diagnostic writes used by readiness resolver failures.
- RT-2 outcome-agreement matrix in verification.md (app-only/CLI-only/both/neither rows) is internally consistent with the resolver's precedence (app account first, documented precedence) and with the exit codes described in the docs; scripts/smoke-headless-claude-credential-source.cjs and scripts/smoke-headless-provider-binding.cjs exist and are non-trivial (732/708 lines), consistent with the claimed evidence, though I did not re-execute them (require Electron build + Xvfb, out of scope for targeted read-only verification).

Targeted test run performed: `bun test tests/runtime-readiness.test.ts tests/claude-runtime-readiness-config-dir.test.ts tests/headless-cli-dispatcher.test.ts tests/local-job-api-schema.test.ts tests/local-job-api.test.ts` → 93 pass, 0 fail, 458 expect() calls; `git status --porcelain` was clean before and after (tree not dirtied). Also ran `openspec validate add-local-job-api-runtime-readiness --strict --no-interactive` → valid; tree stayed clean afterward.

No P0 or P1 findings. Two P3 observations noted above (a defensive-but-currently-unreachable duplicate assertion, and a documented/accepted point-in-time gap between 'ready' default-provider readiness and gateway-token creation at actual create time) — neither blocks merge and both are consistent with the design doc's own stated risk acknowledgments.

Open questions / assumptions:
- I attributed only the openspec-package delta plus the specific readiness/provider-binding code paths to this change, per the batch-scope note in verification.md ('add-cross-workspace-conflicts, add-headless-provider-binding, add-remote-model-catalog, and add-local-job-api-runtime-readiness' share this branch). Broader hardening in bdd2e2e5 (artifact TOCTOU, redaction.ts, stream-event-mapper.ts) belongs to add-headless-provider-binding's scope and was only checked for interference with readiness, not reviewed line-by-line for its own correctness.
- I did not re-run the full `bun run check:full` suite or the Electron/Xvfb-based smoke scripts (heavy, requires build + display server); verification.md's aggregate pass counts were taken as reported and spot-checked via the targeted readiness/schema/dispatcher test files instead.

This is a technical verdict for source SHA bdd2e2e57143a69f86f34ed96f84aa9a5e076fd4 only; it does not constitute product/Owner acceptance and does not authorize push, remote PR mutation, remote merge, release, or repository-rules changes.
