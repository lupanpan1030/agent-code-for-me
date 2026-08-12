# provider-runtime-bindings Specification Delta

Three wholly Kun-scoped requirements are removed. **This capability survives** — its runtime-neutral
requirements (per-run gateway routing, scoped token lifecycle for contract runtimes, provider
profile targeting) are unchanged and are not restated here.

## REMOVED Requirements

### Requirement: Kun Provider Profile Target
**Reason**: `kun` is removed as a provider profile target along with the runtime. The
`kun` member is dropped from `ProviderProfileTarget`, from the capabilities schema in
`provider-profiles/storage.ts`, and from `targetRuntimes` / `capabilities.kun` in all 13 shipped
presets.
**Migration**: A stored profile whose `target_runtimes_json` was `["kun"]` reads back with empty
targets (the reader already filters through `providerProfileTargetSchema.safeParse`). The
empty-targets save guard is reworded in the same change so it no longer emits
`"Kun runtime is disabled. Select another provider target."` — a message naming a runtime that no
longer exists. Affected profiles are re-pointed at `claude` or `codex` in the UI. Verified
2026-08-12 that this installation has no such profiles.

### Requirement: Kun Provider Gateway Synthesis
**Reason**: `src/main/lib/kun/kun-provider-config.ts` and `synthesizeKunProviderConfig` are deleted.
No Kun process is launched, so no synthesized `{ serve: { baseUrl, apiKey, endpointFormat, model } }`
config is written.
**Migration**: None. The same DeepSeek endpoint is reachable by pointing a Codex or Claude Code
engine at a DeepSeek provider profile, which uses the identical gateway.

### Requirement: Kun Synthesized Config and Token Lifecycle
**Reason**: The synthesized-config lifecycle and its scoped, revocable loopback token existed only
for the Kun daemon.
**Migration**: None. Per-run scoped gateway tokens for the contract runtimes are specified by the
surviving runtime-neutral requirements in this capability and are unaffected.
