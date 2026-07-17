# Tasks: add-local-job-api-completion-kind

## 1. Contract

- [x] 1.1 Add `kind?: "agent" | "completion"` (default `"agent"`) to `LocalJobApiCreateRequest` + normalized form in `src/shared/local-job-api.ts`; make the request a clean discriminated union on `kind`
- [x] 1.2 Completion shape: require an explicit `provider.profileId` (MVP: no default-purpose fallback, no native fallback — fail closed if absent) and `messages: [{role,content}]`; optional `maxTokens`/`temperature`; REJECT agent-only fields (`cwd`, `mode`, `runtime.requiredCapabilities`, `policyGrant`, `artifacts`) with structured validation errors
- [x] 1.3 Generic `responseFormat`: optional, `{ type: "text" }` default or `{ type: "json_schema", schema }` with a caller-supplied opaque JSON Schema; Locus stores/passes it through and attaches no meaning — no consumer-specific schema anywhere in Locus
- [x] 1.4 Result shape: completion result envelope carries `{ content, usage: { inputTokens, outputTokens }, resolvedProvider }` (`content` = text or schema-validated JSON); no secrets
- [x] 1.5 Advertise `"completion"` in discovery `features`
- [x] 1.6 Add `usage_update` to the external `LOCAL_JOB_API_EVENT_TYPES` enum in `src/shared/local-job-api.ts` so it is not downgraded to `status` by `toLocalJobApiEventEnvelope`; keep it a general additive change (not completion-specific)
- [x] 1.7 Update `docs/local-job-api-v1.schema.json` + consumer guides (EN/zh) with the completion kind, `responseFormat`, `content`/`usage` result, and the `usage_update` event

## 2. Persistence

- [x] 2.1 Add `kind` column (default `"agent"`) to `agent_jobs` in `src/main/lib/db/schema/index.ts`; generate migration (`bun run db:generate`)
- [x] 2.2 Completion jobs recorded with kind=completion; `usage_update` + `completed` events persisted; usage attributable via existing `apiConsumer*` fields

## 3. Executor

- [x] 3.1 Refactor utility chat-completion helpers out of `chats-helpers.ts` into a shared module used by both the title/commit callers and the new runner (no behavior change for existing callers)
- [x] 3.2 New `src/main/lib/headless/completion-runner.ts`: resolve the explicit provider profile (reuse RT-4 profile resolution, extended beyond `openai-chat`) → build request for the profile protocol (anthropic-messages / openai-responses / openai-chat), mapping a `json_schema` responseFormat to the provider's native structured-output mechanism → `assertOfficialCloudAllowed` → one upstream call (via gateway or direct) → normalize `{ content, usage }` and validate JSON against the caller schema; fail closed on missing/unusable profile or a protocol that cannot enforce the requested schema
- [x] 3.3 Wire completion branch in `createLocalJobApiJob` / the create dispatcher so completion runs synchronously and never spawns a runtime child

## 4. CLI

- [x] 4.1 `locus api runs create` accepts a completion-kind JSON request (passthrough + validation)
- [x] 4.2 (Optional) Alias deferred for v1 MVP; canonical path remains `locus api runs create`

## 5. Tests

- [x] 5.1 Contract: kind default agent (omitted → agent); completion rejects agent-only fields; agent rejects completion-only fields; explicit `provider.profileId` required for completion (missing → fail closed, no native/default fallback)
- [x] 5.2 Executor: each protocol (anthropic/openai-responses/openai-chat) builds the right request and normalizes content+usage; a `json_schema` responseFormat maps to the provider's structured-output mechanism and the result validates against the caller schema; a protocol that can't enforce it fails closed; local-only guard blocks a disallowed hosted upstream; token never in argv/events/result
- [x] 5.3 Persistence: kind column set; `usage_update` event survives the public event stream (not downgraded to `status`) + `completed` event; usage attributable per consumer; retry re-resolves the profile and fails closed if it is gone
- [x] 5.4 Result echo: resolvedProvider truthful for a request-profile completion; no secret material
- [x] 5.5 Consumer neutrality: a grep-style assertion / review check that Locus completion code, tests, and contract contain no consumer-specific vocabulary or schema; two arbitrary different caller schemas both work through the same generic path

## 6. Verification

- [x] 6.1 Manual smoke against a real/mock provider profile: `locus api runs create` with a completion kind → returns content + usage; record in `verification.md`
- [x] 6.2 Confirm no runtime child process is spawned for a completion job (audit events show no tool/command events)
- [x] 6.3 Ajv-validate the completion request/result envelopes and the `usage_update` event against the updated schema
