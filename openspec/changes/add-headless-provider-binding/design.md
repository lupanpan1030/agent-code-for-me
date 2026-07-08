# Design: Headless provider binding

## Context

Desktop runs already carry `AgentRuntimeProviderReference` (`model`, `modelSource`, `providerProfileId`, `gatewayEndpoint`, `authMode`) into every adapter; headless hardcodes it to `null` (`src/main/lib/headless/agent-runtime-contract.ts:161`). Feasibility was verified in the audit: the headless CLI is the Electron main process (safeStorage + DB available), the provider gateway (`provider-profiles/gateway.ts`) is an in-process localhost proxy with per-request scoped tokens and no desktop dependencies, the Local Job API secret scanner does not reject the key names `provider`/`profileId`/`model`, unknown fields are silently dropped by older builds (hence feature detection), and the adapter seams already exist (`buildClaudeEnv` customEnv applied after the strip list; `buildCodexProviderEnv` already accepts `appManagedApiKey`/`providerGatewayToken`; `buildCodexProviderProfileArgs` is pre-built with zero callers; the headless codex-app-server adapter already reads `request.providerBinding?.*`).

## Goals / Non-Goals

- Goals: headless runs and schedules can select a stored provider profile and/or model by reference; `agent_provider_defaults` `claude-main`/`codex-main` become the headless default source (D3); no secret material ever crosses the API/CLI boundary; behavior is explainable — explicit selection never silently degrades.
- Non-Goals: qwen/kun headless support (not contract runtimes); desktop selection changes; completion job kind (RT-5); per-profile readiness diagnostics; new provider protocols.

## Decisions

- **References only, fail closed**: the request carries `profileId`, never tokens (satisfies the existing local-job-api "Local-First and Secret Boundaries" requirement). Create-time validation rejects unknown profiles (`provider_profile_not_found`) and target mismatches (`provider_profile_runtime_mismatch`, using `targetRuntimes`: claude-code→`claude`, codex→`codex`) before a job record exists. Run-time resolution failures (undecryptable token, gateway failure) fail the job with `provider_profile_unavailable`. No silent fallback to native for an explicit or defaults-sourced profile — same explainability principle as RT-2's env-token decision.
- **Resolution order**: request `provider` → defaults (`claude-main`/`codex-main`, including their `modelOverride`) → native. Explicit `model` beats defaults' `modelOverride` beats profile `defaultModel`. `model` without `profileId` is allowed and applies to the native path (claude `--model`, codex `-m`).
- **Provider object validation**: strict shape — only `profileId` and `model` keys, both strings with length caps; anything else rejects. Keeps the smuggling surface closed while the outer secret scanner continues to run over the whole request.
- **Binding construction**: one main-process helper resolves profile → `getProviderProfileRuntimeConfig` + `getProviderGatewayEndpoint` → `AgentRuntimeProviderReference` with `authMode: "provider-profile"`; native paths keep `authMode: "runtime-managed"` (claude app-token injection from RT-2 is unchanged and orthogonal). `createAgentRuntimeRunRequest` accepts the resolved binding instead of hardcoding null.
- **Adapter wiring (least-invasive, audit-verified)**: claude batch = `buildClaudeEnv({ customEnv: buildClaudeProviderEnv(gatewayConfig) })` + append `--model`; codex batch = pass `providerGatewayToken`/`appManagedApiKey` through `buildCodexProviderEnv` + append `buildCodexProviderProfileArgs(profile)` and `-m`; codex app-server = pass resolved secrets into `createHeadlessCodexAppServerDesktopAdapter` mirroring the desktop tRPC caller. No adapter parses profiles itself; secrets reach adapters only as already-scoped gateway tokens.
- **Token lifecycle**: per-run scoped gateway token synthesized at job start, revoked on every terminal path (success, failure, cancel) — mirrors the Kun synthesized-config cleanup. Matters for the daemon (long-lived process); the one-shot CLI additionally tears down with process exit.
- **Persistence**: nullable `providerProfileId`/`modelOverride` on `agent_jobs` and `agent_schedules` (profile ids are non-secret). Retry reuses the stored reference and re-resolves at run time; a deleted profile makes retry fail closed with the same structured error.
- **Contract compatibility (D5)**: `apiVersion` unchanged; discovery `features` gains `"provider-binding"`; the result envelope echoes `resolvedProvider { source: "request-profile" | "default-profile" | "native", profileId?, model? }`. Older builds silently drop the request field — consumers MUST feature-detect, and the echo lets them assert what actually applied.

## Risks / Trade-offs

- Defaults changing between schedule creation and trigger: schedule-created jobs copy the schedule's stored reference at trigger time; a schedule with no stored reference resolves defaults at trigger time (documented — defaults are a live pointer, not a snapshot).
- Gateway availability: the gateway binds a loopback port per process; failure to start fails the profile-bound job closed rather than falling back to direct upstream calls (no token exposure to the runtime child).
- `claude-main`/`codex-main` defaults were previously write-only (desktop run path ignores them); headless consumption gives them meaning but creates a surface where desktop and headless defaults differ by design (desktop = per-chat localStorage, headless = DB defaults). Documented in the agent-provider-profiles delta; the settings UI copy should eventually say "used by headless/scheduled runs".
- Secret redaction: gateway tokens are process-local and never persisted; job events keep existing redaction. Tests must assert argv for codex `-c` overrides contains `env_key` names, never token values.

## Migration Plan

Additive schema migration (two nullable columns × two tables) via `bun run db:generate`; no backfill. Contract change is additive; older consumers unaffected. Rollback = revert; stored profile references are inert without the resolution code.

## Open Questions

- None blocking. (Whether the settings UI should relabel `claude-main`/`codex-main` as headless defaults is a UX follow-up outside this change.)
