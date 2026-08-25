# Change: Headless provider binding — select provider profile and model by reference

## Why

Headless runs cannot choose a provider or model: the Local Job API create request has no provider field, `locus run` has no flag, jobs/schedules tables have no columns, and `createAgentRuntimeRunRequest` hardcodes `providerBinding: null` — so every headless run is pinned to the runtime's native login, while the desktop already has a complete, working binding mechanism (profiles + gateway + `AgentRuntimeProviderReference`) driving the same adapters. The audit confirmed the gap is wiring, not architecture: the binding type exists on the headless request contract, the gateway and safeStorage work in the headless main process, and `buildCodexProviderProfileArgs` sits pre-built with zero callers. This change closes the gap and is the prerequisite for the completion job kind (RT-5).

## What Changes

- Local Job API create request gains an optional `provider: { profileId?: string, model?: string }` block — references only, never secrets. Unusable explicit selection fails closed with structured error codes; nothing silently falls back.
- Resolution order per run: explicit request `provider` → `agent_provider_defaults` purposes `claude-main`/`codex-main` (decision D3: headless is the consumer that gives those rows meaning) → native runtime credentials.
- `agent_jobs` and `agent_schedules` gain nullable `providerProfileId`/`modelOverride` columns; schedule-created jobs copy them.
- `locus run` and `locus schedules create` gain `--provider-profile <id>` and `--model <model>`.
- `createAgentRuntimeRunRequest` populates `providerBinding` from the resolved profile (main-process resolution → per-run scoped gateway token, revoked at job end); the three headless adapters wire it through their existing seams (claude: customEnv + `--model`; codex batch: `buildCodexProviderEnv` params + `buildCodexProviderProfileArgs` + `-m`; codex app-server: pass resolved secrets to the adapter factory).
- Discovery `features` gains `"provider-binding"`; the run result envelope echoes `resolvedProvider { source, profileId?, model? }` so consumers can detect silent drops by older builds.

## Impact

Owner-approved public contract decision: [consumer-impact.md](consumer-impact.md)

- Affected specs: `local-job-api` (provider selection by reference), `headless-agent-jobs` (CLI/schedule selection + resolution order), `provider-runtime-bindings` (headless binding + token lifecycle), `agent-provider-profiles` (headless default consumption)
- Affected code: `src/shared/local-job-api.ts`, `src/main/lib/headless/{local-job-api,cli-args,cli-dispatcher,agent-runtime-contract,job-runner,schedules}.ts`, `src/main/lib/headless/adapters/{claude-code,codex,codex-app-server}.ts`, `src/main/lib/db/schema/index.ts` (+ drizzle migration), `src/main/lib/provider-profiles/{storage,gateway}.ts` (read-only reuse), docs schema + consumer guides (EN/zh)
- Depends on: RT-3 (`add-local-job-api-runtime-readiness`) for the `features` advertisement mechanism
- Unblocks: RT-5 completion job kind; Career Kit runtime/provider selection
