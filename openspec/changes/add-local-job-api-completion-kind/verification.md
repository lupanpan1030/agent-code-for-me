# Verification: add-local-job-api-completion-kind

Date: 2026-07-09

## Commands

- `openspec validate add-local-job-api-completion-kind --strict --no-interactive`
  - Result: pass, `Change 'add-local-job-api-completion-kind' is valid`
- `bun run lint:changed`
  - Result: pass; Biome reported only legacy diagnostics outside changed lines
- `bun run architecture:check`
  - Result: pass
- `bun run ts:check`
  - Result: pass
- `bun test --isolate tests/local-job-api.test.ts tests/headless-cli-dispatcher.test.ts tests/local-job-api-schema.test.ts`
  - Result: pass, covered in the final 64-test targeted run
- `bun test --isolate tests/local-job-api-app-server-profile.test.ts`
  - Result: pass, covered in the final 64-test targeted run
- `bun run test`
  - Result: pass, 1434 tests

## Mock Provider Smoke

Covered by `tests/headless-cli-dispatcher.test.ts`:

- `runs Local Job API completion with text result and usage event`
- `runs Local Job API completion with caller-owned JSON schema`
- `maps Local Job API completion to OpenAI chat structured output`
- `maps Local Job API completion to Anthropic forced tool schema`
- `local-only guard blocks disallowed completion upstream before fetch`
- `fails Local Job API completion when returned JSON misses caller schema`

The smoke verifies `locus api runs create` accepts `kind: "completion"`, calls a
mock provider profile, returns `content`, `usage`, and `resolvedProvider`, and
exposes `usage_update` through the public Local Job API event stream.

## No Runtime Child / Tool Events

The completion smoke asserts public completion events include `usage_update` and
exclude `artifact_created` and `tool_started`. The completion dispatcher branch
calls `runPersistedCompletionJob`, not `runPersistedAgentJob`, so it does not
spawn a runtime child process.

## Schema Validation

`tests/local-job-api-schema.test.ts` validates:

- the updated `createRequest` union
- the completion result envelope
- the `usage_update` event envelope

The completion runner validates `json_schema` content with Ajv before marking a
job succeeded.

## Consumer Neutrality

Grep checks were run against completion-related code, tests, docs, schema, and
OpenSpec text using the downstream-domain vocabulary denylist from the review
rubric.

Result: zero matches after excluding no files from the completion-specific
source/schema/spec set.
