# Design: Local Job API completion job kind

## Context

The whole RT sequence started from LOCUS-RT-1 ("direct-API light runtime, single completion, seconds-level return, reuse Locus provider/key system"). The early decision (D4, accepted) reframed it: completion is a **job kind, not a runtime** — it shares nothing with the agent capability manifest (no hardToolGuard/planMode/scope/rollback) and everything with the provider/gateway/audit spine. RT-4 delivered headless provider binding, so the resolution half already exists. The execution half also already exists in a narrow form: `getLocalChatCompletionProviderConfig` + `buildUtilityProviderHeaders` + `buildUtilityChatCompletionBody` + `assertOfficialCloudAllowed` (chats-helpers.ts) perform exactly one non-agentic chat-completion call for sub-chat titles / commit messages — but bound to `openai-chat` protocol and two hard-coded purposes.

## Goals / Non-Goals

- Goals: one synchronous, audited, provider-managed single LLM call over the Local Job API; zero new credential surface; existing agent consumers untouched; usage attributable per consumer; a generic structured-output primitive so callers can get validated JSON without prompt-scraping.
- Non-Goals: streaming, tool/function calling, agent-loop parity, async/daemon completion, a new runtime id, exposing completion on the interactive desktop path; **any consumer-specific vocabulary, schema, or logic inside Locus**.

## Non-Negotiable: Consumer Neutrality

Locus is a general-purpose base. The completion kind MUST contain no knowledge of any specific downstream program (no domain terms, no named contracts, no per-consumer branching). The motivating consumer (a downstream program parsing documents into fields) never appears in Locus code, tests, docs, or the contract. Downstream programs adapt to Locus: they supply their own `responseFormat.schema` and interpret the generic result themselves. This preserves the existing clean boundary — consumer-specific contracts live entirely in the consumer's adapter, and Locus's `consumer` field stays an opaque id. Any change that would make Locus's behavior depend on *which* consumer is calling is out of scope by definition.

## Decisions

- **Kind field, default agent**: `kind: "agent" | "completion"` defaults to `"agent"`. Old consumers omit it and are unaffected; the field is feature-detected via discovery `features: ["completion"]` (D5 pattern — no apiVersion bump).
- **Completion is provider-required, fail-closed, explicit-only in MVP**: a completion has no native agent runtime to fall back to. The RT-4 resolver falls back to `claude-main`/`codex-main` defaults and then to native — both are wrong for completion (those are *agent-runtime* purposes, and native has no completion path). So completion does NOT reuse the RT-4 default chain: MVP **requires an explicit `provider.profileId`** and rejects at create time if absent or unusable. A dedicated completion default purpose can be added later if a consumer needs it, but that is out of MVP scope and must not overload the agent defaults. This is the one place where the RT-4 "native fallback" branch is intentionally disallowed entirely.
- **Shape divergence enforced, not ignored**: completion requests reject agent-only fields (`cwd`, `mode`, `runtime.requiredCapabilities`, `policyGrant`, `artifacts`, scope) rather than silently dropping them — mirrors the existing strict-shape philosophy. `runtime.id` is optional for completion; when present it only picks the provider-target family (claude→anthropic, codex→responses) for a profile that targets multiple runtimes, otherwise the profile's protocol decides.
- **Reuse the executor, don't fork it**: refactor the utility chat-completion helpers out of `chats-helpers.ts` into a shared module the new `completion-runner.ts` and the title/commit callers both use. The completion runner: resolve provider config (RT-4 path, extended to all protocols not just openai-chat) → build request for the profile's protocol (anthropic messages / openai-responses / openai-chat) → `assertOfficialCloudAllowed` → one `fetch` → normalize `{ content, usage }`. Prefer routing through the provider gateway for a single consistent egress + protocol translation; direct-in-process call is the fallback if gateway indirection is unwarranted for a one-shot.
- **Structured output is a generic primitive, not a feature for anyone**: `responseFormat` is optional and defaults to `text`. For `json_schema`, the runner maps the caller-supplied schema to the provider's native mechanism (OpenAI `response_format: { type: "json_schema", json_schema }`, Anthropic a forced single-tool `input_schema`, openai-responses structured output) and returns parsed JSON validated against that schema; a provider whose profile protocol cannot enforce structured output rejects the request rather than returning unchecked text. Locus validates the *shape* against the caller's schema but attaches **no meaning** to it — the schema is a passthrough contract between the caller and the model. The same primitive serves document parsing, classification, extraction, or any other caller's use equally; none is privileged.
- **Synchronous only**: completion reuses the already-synchronous `api runs create` execution path; no queue, no daemon, no worktree, no scope contract. A completion job never creates a runtime child process.
- **Audit + usage**: completion jobs persist in `agent_jobs` with a new `kind` column (default `"agent"`), and emit `usage_update` + `completed` events. Token usage from the upstream response is recorded so a consumer's completion spend is attributable via the existing `apiConsumer*` fields. This is the security requirement flagged at the very start: Locus spends its own keys on a consumer's behalf at low friction, so per-consumer accounting must be first-class, not bolted on. **Contract note**: `usage_update` exists in the internal `AGENT_JOB_EVENT_TYPES` but NOT in the external `LOCAL_JOB_API_EVENT_TYPES` — `toLocalJobApiEventEnvelope` currently downgrades any unknown type to `status`. This change adds `usage_update` to the external enum + `docs/local-job-api-v1.schema.json` as a general, feature-additive addition (it benefits agent jobs too), so the usage event survives the public stream instead of being flattened to `status`.
- **Local-only + secrets**: `assertOfficialCloudAllowed` still gates hosted upstreams; the request still carries only references (no tokens); the result echoes `resolvedProvider` without secrets, same as RT-4.

## Risks / Trade-offs

- Cost surface: completion is low-friction and high-frequency by nature. Mitigation: per-consumer usage recorded from day one; a future rate/spend cap can read those events. Documented as a known consideration, not deferred silently.
- Protocol coverage: the existing helper only handles `openai-chat`. Extending to anthropic-messages / openai-responses is real work; the gateway already translates these for agent runs, which is the argument for routing completion through the gateway rather than re-implementing translation in the runner.
- Contract complexity: `kind` makes the create request a discriminated union. Validation must branch cleanly so agent-field rejection for completion (and completion-field rejection for agent) is explicit and tested, not a source of silent drops.
- Desktop scope: completion is API/CLI-only; keeping it off the interactive path avoids a second place that resolves providers differently.

## Migration Plan

Additive: `kind` column defaults `"agent"` (no backfill); contract additions are feature-detected. `bun run db:generate`. Rollback = revert; completion requests would then fail validation (unknown kind) on the old build, which is why consumers must feature-detect `"completion"` first.

## Open Questions

- Gateway-routed vs direct in-process egress for the single call — decide during implementation based on how cleanly the gateway exposes a non-agent one-shot; both keep the token main-process.
- Whether to ship the `locus api completions create` CLI alias in this change or leave completion to `api runs create` with `kind` — minor ergonomics, not load-bearing.
