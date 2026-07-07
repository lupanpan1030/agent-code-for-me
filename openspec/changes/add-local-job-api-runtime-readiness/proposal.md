# Change: Advertise runtime readiness and feature flags in Local Job API discovery

## Why

`locus api runtimes list` returns only static capability manifests, so a fresh or未配置 Locus advertises claude-code and codex as fully capable even when no credential exists. Downstream consumers (Career Kit) pass preflight, register the project, create a job, and only then fail with `runtime_auth_required` — a late, regex-classified failure that leaves a dead job behind. Separately, the create-request validator silently drops unknown fields, so consumers have no way to detect whether a given Locus build supports newer contract fields before relying on them.

## What Changes

- Each runtime entry in the `runtimes list` envelope gains a `readiness` object: `{ state: "ready" | "needs-auth" | "unavailable" | "unknown", detail?: string, hint?: string }`, computed from the credential source the headless execution path actually uses (post-RT-2 order for Claude: app account store, then CLI login; Codex: bundled CLI presence + `codex login status`).
- The envelope gains a top-level `features: string[]` array (initially `["runtime-readiness"]`) so consumers can feature-detect contract additions without an `apiVersion` bump (decision D5: exact-match version string stays).
- `locus api runtimes list` gains `--no-probe`: skips subprocess probes (Codex `login status`); probed states degrade to `"unknown"`. Probe results are cached in-process for 30 seconds (decision D2).
- Readiness computation failures degrade to `"unknown"` with a diagnostic on stderr; they never fail the discovery command.
- No change to create/run semantics. Readiness is advisory; job creation remains allowed regardless of advertised state.

## Impact

- Affected specs: `local-job-api` (ADDED: Runtime Readiness Discovery; ADDED: Discovery Feature Advertisement)
- Affected code: `src/shared/local-job-api.ts` (envelope types), `src/main/lib/headless/local-job-api.ts` (`toLocalJobApiRuntimeManifestEnvelope`), `src/main/lib/headless/cli-args.ts` + `cli-dispatcher.ts` (`--no-probe`, async list command), new `src/main/lib/headless/runtime-readiness.ts` reusing `getClaudeCodeCredentialMetadata`/`hasAnyClaudeCodeAccount` (`src/main/lib/claude-credentials.ts`), `getExistingClaudeCredentials` (`src/main/lib/claude-token.ts`), and `getCodexRuntimeStatus` (`src/main/lib/codex/runtime-status.ts`)
- Depends on: RT-2 (`update-headless-claude-credential-source`) — Claude readiness must mirror the RT-2 resolution order
- Downstream: Career Kit preflight can read `readiness` before creating jobs and retire its regex-based auth-failure sniffing (tracked separately in the Career Kit repo)
