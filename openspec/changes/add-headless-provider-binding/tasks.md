# Tasks: add-headless-provider-binding

## 1. Contract and validation

- [x] 1.1 Add `provider?: { profileId?: string, model?: string }` to `LocalJobApiCreateRequest` + normalized form in `src/shared/local-job-api.ts`: strict shape validation (only these two string keys, length caps, and at least one non-empty reference whenever the block is present), preserved through normalization
- [x] 1.2 Create-time semantic validation in `src/main/lib/headless/local-job-api.ts`: unknown profile → `provider_profile_not_found`; `targetRuntimes` mismatch (claude-code→`claude`, codex→`codex`) → `provider_profile_runtime_mismatch`; both reject before a job record is created
- [x] 1.3 Advertise `"provider-binding"` in the discovery `features` array; echo `resolvedProvider { source, profileId?, model? }` in the run result envelope
- [x] 1.4 Update `docs/local-job-api-v1.schema.json` + consumer guides (EN/zh)
- [x] 1.5 Record the Owner-approved `DIRECT_NEW_STANDARD` decision, known Career Kit/Amadeus impact, feature-detection rule, release order, and no-facade boundary in `consumer-impact.md`

## 2. Persistence

- [x] 2.1 Add nullable `providerProfileId`/`modelOverride` to `agent_jobs` and `agent_schedules` in `src/main/lib/db/schema/index.ts`; generate migration (`bun run db:generate`)
- [x] 2.2 `locus schedules create` stores the reference; schedule-triggered jobs copy it; retry re-resolves the stored reference and fails closed (`provider_profile_unavailable`) if the profile is gone

## 3. Resolution and binding

- [x] 3.1 Main-process resolution helper: explicit profile → selected profile; model-only provider → native; entirely omitted provider → `agent_provider_defaults` (`claude-main`/`codex-main` incl. `modelOverride`) → native; model precedence explicit > default-override > profile `defaultModel` where applicable; builds `AgentRuntimeProviderReference` via `getProviderProfileRuntimeConfig` + `getProviderGatewayEndpoint`
- [x] 3.2 `createAgentRuntimeRunRequest` accepts the resolved binding (drop the hardcoded `providerBinding: null` at `agent-runtime-contract.ts:161`)
- [x] 3.3 Scoped gateway token lifecycle in `job-runner.ts`: synthesize at start, revoke on every terminal path (success/failure/cancel); daemon-safe
- [x] 3.4 Remove the duplicate provider-row JSON/auth/protocol/decrypt/default parser from `headless/provider-binding.ts`; expose strict DB-injected reads from canonical `provider-profiles/storage.ts`, fail closed on malformed persisted values, and guard the ownership boundary with a source-level test

## 4. Adapter wiring

- [x] 4.1 Claude batch adapter: gateway config via `buildClaudeEnv` customEnv seam (`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` survive the strip); append `--model` when a model is resolved; profile runs do not inject the RT-2 app token
- [x] 4.2 Codex batch adapter: pass `providerGatewayToken`/`appManagedApiKey` through `buildCodexProviderEnv`; append `buildCodexProviderProfileArgs(profile)` and `-m <model>`
- [x] 4.3 Codex app-server adapter: pass resolved secrets into `createHeadlessCodexAppServerDesktopAdapter` (mirror desktop `codex.ts` caller) so profile/api-key auth modes stop failing closed

## 5. CLI

- [x] 5.1 `locus run --provider-profile <id> --model <model>` (both optional, `--model` valid alone for native runs); same for `locus api runs create` request passthrough
- [x] 5.2 `locus schedules create --provider-profile/--model`; reject unknown profile at create time

## 6. Tests

- [x] 6.1 Contract: provider block validation matrix (unknown keys rejected, secret-scanner still passes clean shapes, silent-drop echo semantics)
- [x] 6.2 Resolution: explicit profile → selected profile; model-only → native; entirely omitted provider → defaults then native; model precedence; fail-closed codes for not-found/mismatch/unavailable; defaults absent → native
- [x] 6.3 Adapters: claude env carries gateway baseUrl+token and `--model` (ANTHROPIC_* strip still holds for non-profile runs); codex argv contains `-c` overrides with `env_key` name but NEVER token values; app-server receives secrets
- [x] 6.4 Lifecycle: gateway token revoked on success, failure, and cancel; schedule job copies reference; retry with deleted profile fails closed
- [x] 6.5 Redaction: job events and structured output never contain gateway or upstream tokens
- [x] 6.6 Exact scoped-token regression: a random bare 64-hex gateway token emitted by a malicious child/adapter is removed from headless events, terminal error/result storage, and Local Job API result envelopes
- [x] 6.7 Desktop same-class remediation: Codex app-server exact secret hints redact adapter emissions and durable trace events before renderer/message persistence; the per-run gateway token is revoked on finish, failure, and cancel
- [x] 6.8 Completion same-class remediation: the selected upstream profile token is an exact per-job secret hint and is removed from successful structured results, failure details, events, and Local Job API output
- [x] 6.9 Desktop Claude same-class remediation: per-Run provider gateway/native OAuth hints redact every renderer chunk, durable RunEvent, success/error assistant persistence, and runtime diagnostic sink; scoped gateway tokens are revoked idempotently on startup failure, success/failure finalization, cancel, and unsubscribe
- [x] 6.10 Upstream credential closure: keep the selected profile token as a main-process-only exact hint for headless, Desktop Claude, and Desktop Codex until terminal output is materialized; redact successful response/tool echoes and pre-binding gateway errors; reject URL userinfo and provider tokens shorter than the exact-redaction floor across profile and legacy provider owners, including malformed persisted rows; record the targeted working-tree receipt without treating it as exact-source completion

## 7. Verification

- [x] 7.1 Manual smoke with a real test profile (local Ollama or mock upstream): `locus run --runtime codex --provider-profile <id>` end to end; record in `verification.md`
- [x] 7.2 Ajv-validate the extended envelopes against the updated schema
- [x] 7.3 Cross-check `resolvedProvider` echo against actual upstream hit (gateway logs) for one profile run and one native run
- [ ] 7.4 Commit the final integrated source, record its exact source SHA, and run `bun run check:full` against that unchanged SHA
- [ ] 7.5 Obtain fresh Codex `IMPLEMENTATION_VERIFIED` and Claude Code `REVIEW_APPROVED` verdicts for the same exact source SHA with no unresolved blocking finding
- [ ] 7.6 Merge the approved source locally into `main`, record the local merge SHA, and run the post-merge `bun run check:full` gate
- [ ] 7.7 Obtain Owner product/risk `ACCEPTED` for the integrated result, then archive this change locally with remote actions recorded as not authorized/not performed
