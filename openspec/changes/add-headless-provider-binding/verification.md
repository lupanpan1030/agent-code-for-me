# Verification: add-headless-provider-binding

Verified: 2026-08-25 (Pacific/Auckland)

## Built Electron profile/native smoke

Command shape:

```text
electron scripts/smoke-headless-provider-binding.cjs
```

The smoke used the current built `out/main/index.js`, an isolated temporary
Locus database and project, the public `--locus-headless-cli` surface, a fake
bundled Codex executable, and a request-counting local Responses upstream. It
did not use a real account, external model, or billable network request.

Result: exit 0.

- Profile run:
  - job `succeeded`
  - `resolvedProvider.source = request-profile`
  - `resolvedProvider.profileId = smoke-provider-binding-codex`
  - explicit model `smoke-profile-explicit-model` reached the upstream
  - exactly one `POST /v1/responses` request reached the mock upstream
  - the configured profile header reached the upstream
  - the upstream did not receive the Locus-scoped gateway Authorization header
- Native run:
  - job `succeeded`
  - `resolvedProvider.source = native`
  - upstream request count remained exactly one, proving the native run did not
    route through the profile gateway
- Secret checks:
  - inherited `OPENAI_API_KEY`, `CODEX_API_KEY`, and ambient gateway values were
    stripped before the Codex child
  - the scoped gateway token was absent from argv, result/events, and the
    upstream request

This is deterministic certification of the Locus CLI, provider-resolution,
scoped-gateway, and adapter wiring. The fake Codex process deliberately avoids
claiming compatibility certification for a future upstream Codex protocol.

## Repository gates

The exact-source full-suite and independent-review receipts are recorded at
change-set closeout before archive.

## Exact scoped-token adversarial regression

Targeted command:

```text
bun test tests/runtime-redaction.test.ts tests/headless-runtime-event-bridge.test.ts tests/headless-provider-binding.test.ts tests/headless-cli-dispatcher.test.ts tests/codex-app-server-adapter.test.ts tests/runtime-stream-event-mapper.test.ts
```

Result: 112 passed, 0 failed, 489 assertions.

- A random bare 64-hex scoped gateway token was deliberately emitted without a
  secret-bearing key or prefix from a fake headless child and a fake Codex
  app-server notification.
- The exact token was absent from persisted job events, terminal
  `errorCode`/`errorMessage`/`resultJson`, Local Job API result envelopes,
  completion success/failure envelopes, Codex adapter emissions, and durable
  desktop RunEvents.
- The Codex adapter RunEvent recorded `secret-hint` redaction, while the route
  stores only the already-redacted chunk used to build the assistant message.
- Headless and Desktop Codex profile paths revoke their scoped gateway token on
  terminal/cancel cleanup.
- `bun run ts:check` passed for the integrated source at this verification
  point.

## Desktop Claude exact-secret and lifecycle regression

Targeted command:

```text
bun test tests/runtime-stream-event-mapper.test.ts tests/claude-agent-sdk-desktop-run-envelope.test.ts tests/claude-agent-sdk-desktop-job.test.ts tests/claude-agent-sdk-message-persistence.test.ts tests/claude-agent-sdk-run-finalization.test.ts tests/claude-agent-sdk-stream-error-finalization.test.ts tests/claude-agent-sdk-provider-startup.test.ts tests/claude-agent-sdk-desktop-run-startup.test.ts tests/claude-agent-sdk-desktop-run-supervision.test.ts tests/claude-agent-sdk-desktop-run-cleanup.test.ts tests/claude-agent-sdk-runtime-errors.test.ts tests/claude-agent-sdk-error-logging.test.ts tests/claude-raw-logger.test.ts tests/claude-agent-sdk-query-options.test.ts tests/claude-agent-sdk-adapter-runner.test.ts tests/claude-agent-sdk-runtime-startup.test.ts tests/claude-agent-sdk-message-metadata.test.ts tests/claude-agent-sdk-stream-consumer.test.ts tests/claude-agent-sdk-runtime-lifecycle.test.ts
```

Result: 113 passed, 0 failed, 480 assertions.

- Random bare 64-hex gateway tokens and native OAuth-style run secrets were
  treated as main-process-only hints; no hint list was placed in a renderer,
  RunEvent, database message, or diagnostic payload.
- Non-diagnostic text chunks, stream errors, success/error assistant messages,
  metadata, and prior messages were recursively redacted before renderer or DB
  exposure.
- Diagnostic bypasses outside the renderer emitter were covered: SDK stderr,
  embedded/full-message errors, query/startup errors, system messages, the
  opt-in raw debug log, and malformed tool-input diagnostics.
- Provider gateway token cleanup is idempotent and covered for provider/startup
  failures, successful and failed lifecycle supervision, unsubscribe, and
  abort-driven cancellation. The route clears its dynamic hint and cleanup
  references after cleanup; static mapper hints remain main-process-only for
  already-created RunEvent teardown.

## Task 6.10 working-tree remediation receipt — not exact source

Date: 2026-08-25 (Pacific/Auckland)

Source state: checkout `HEAD = 1d4be1a1955fb23928a12b3479f1d77238bf84d0` plus an
uncommitted integrated working-tree diff. This receipt proves the targeted cases
on that transient working tree only. It is **not** an exact source-SHA receipt,
does not satisfy task 7.4 or either task 7.5 review verdict, and is invalidated
by any later implementation edit.

Command:

```text
bun test tests/provider-token.test.ts tests/provider-profile-storage-security.test.ts tests/legacy-provider-config-storage-security.test.ts tests/local-api-provider-config-security.test.ts tests/headless-provider-binding.test.ts tests/headless-cli-dispatcher.test.ts tests/headless-runtime-adapters.test.ts tests/runtime-redaction.test.ts tests/runtime-stream-event-mapper.test.ts tests/codex-app-server-adapter.test.ts tests/claude-agent-sdk-provider-startup.test.ts tests/claude-agent-sdk-message-persistence.test.ts tests/claude-agent-sdk-desktop-run-envelope.test.ts
```

Observed result: 175 passed, 0 failed, 753 assertions across 13 files.

The passing cases include:

- URL-userinfo and short-token rejection plus authoritative stored-credential
  reuse/read validation;
- upstream and scoped gateway exact hints across headless, Desktop Claude, and
  Desktop Codex output;
- a secret split across adjacent stream fragments without leaking a prefix;
- success, tool, startup-error, durable event/message/result, and Local Job API
  projections;
- scoped-token terminal cleanup and Codex shell-snapshot scrubbing.

Outstanding closeout remains explicit in tasks 7.4–7.7: commit the final source,
run exact-SHA `check:full`, obtain fresh Codex and Claude Code verdicts for that
same SHA, locally merge and re-run the post-merge gate, then record Owner
acceptance before archive.

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
