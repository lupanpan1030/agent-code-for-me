# Tasks: add-headless-provider-binding

## 1. Contract and validation

- [x] 1.1 Add `provider?: { profileId?: string, model?: string }` to `LocalJobApiCreateRequest` + normalized form in `src/shared/local-job-api.ts`: strict shape validation (only these two string keys, length caps), preserved through normalization
- [x] 1.2 Create-time semantic validation in `src/main/lib/headless/local-job-api.ts`: unknown profile → `provider_profile_not_found`; `targetRuntimes` mismatch (claude-code→`claude`, codex→`codex`) → `provider_profile_runtime_mismatch`; both reject before a job record is created
- [x] 1.3 Advertise `"provider-binding"` in the discovery `features` array; echo `resolvedProvider { source, profileId?, model? }` in the run result envelope
- [x] 1.4 Update `docs/local-job-api-v1.schema.json` + consumer guides (EN/zh)

## 2. Persistence

- [x] 2.1 Add nullable `providerProfileId`/`modelOverride` to `agent_jobs` and `agent_schedules` in `src/main/lib/db/schema/index.ts`; generate migration (`bun run db:generate`)
- [x] 2.2 `locus schedules create` stores the reference; schedule-triggered jobs copy it; retry re-resolves the stored reference and fails closed (`provider_profile_unavailable`) if the profile is gone

## 3. Resolution and binding

- [x] 3.1 Main-process resolution helper: request `provider` → `agent_provider_defaults` (`claude-main`/`codex-main` incl. `modelOverride`) → native; model precedence explicit > default-override > profile `defaultModel`; builds `AgentRuntimeProviderReference` via `getProviderProfileRuntimeConfig` + `getProviderGatewayEndpoint`
- [x] 3.2 `createAgentRuntimeRunRequest` accepts the resolved binding (drop the hardcoded `providerBinding: null` at `agent-runtime-contract.ts:161`)
- [x] 3.3 Scoped gateway token lifecycle in `job-runner.ts`: synthesize at start, revoke on every terminal path (success/failure/cancel); daemon-safe

## 4. Adapter wiring

- [x] 4.1 Claude batch adapter: gateway config via `buildClaudeEnv` customEnv seam (`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` survive the strip); append `--model` when a model is resolved; profile runs do not inject the RT-2 app token
- [x] 4.2 Codex batch adapter: pass `providerGatewayToken`/`appManagedApiKey` through `buildCodexProviderEnv`; append `buildCodexProviderProfileArgs(profile)` and `-m <model>`
- [x] 4.3 Codex app-server adapter: pass resolved secrets into `createHeadlessCodexAppServerDesktopAdapter` (mirror desktop `codex.ts` caller) so profile/api-key auth modes stop failing closed

## 5. CLI

- [x] 5.1 `locus run --provider-profile <id> --model <model>` (both optional, `--model` valid alone for native runs); same for `locus api runs create` request passthrough
- [x] 5.2 `locus schedules create --provider-profile/--model`; reject unknown profile at create time

## 6. Tests

- [x] 6.1 Contract: provider block validation matrix (unknown keys rejected, secret-scanner still passes clean shapes, silent-drop echo semantics)
- [x] 6.2 Resolution: explicit > defaults > native; model precedence; fail-closed codes for not-found/mismatch/unavailable; defaults absent → native
- [x] 6.3 Adapters: claude env carries gateway baseUrl+token and `--model` (ANTHROPIC_* strip still holds for non-profile runs); codex argv contains `-c` overrides with `env_key` name but NEVER token values; app-server receives secrets
- [x] 6.4 Lifecycle: gateway token revoked on success, failure, and cancel; schedule job copies reference; retry with deleted profile fails closed
- [x] 6.5 Redaction: job events and structured output never contain gateway or upstream tokens

## 7. Verification

- [ ] 7.1 Manual smoke with a real test profile (local Ollama or mock upstream): `locus run --runtime codex --provider-profile <id>` end to end; record in `verification.md`
- [x] 7.2 Ajv-validate the extended envelopes against the updated schema
- [ ] 7.3 Cross-check `resolvedProvider` echo against actual upstream hit (gateway logs) for one profile run and one native run
