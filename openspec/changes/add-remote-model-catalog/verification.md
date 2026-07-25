# Verification: add-remote-model-catalog

## Task 0.1 — preconditions and anchor audit

- Audited: 2026-07-23 (Pacific/Auckland)
- Branch base: clean local `main` at `df72d425` (`chore: draft
  add-remote-model-catalog proposal`); implementation branch created from that
  exact commit as `codex/add-remote-model-catalog`.
- Repository visibility: `gh repo view lupanpan1030/agent-code-for-me` reported
  `PUBLIC`, preserving the raw-GitHub manifest precondition.
- Ownership read before implementation: `docs/OWNERSHIP_MAP.md`. The new durable
  fetch/cache/merge behavior is owned by `src/main/lib/model-catalog/`; the tRPC
  file is a transport-only consumer; renderer hydration belongs in the renderer
  catalog store; runtime request composition stays in the existing Claude/Codex
  transport owners; API-key validation state stays under
  `src/main/lib/codex/api-key-validation.ts`.

Current anchor audit (all described behavior still matches):

| Design context claim | Re-verified location |
| --- | --- |
| Claude built-ins and app-agent enum derivation | `src/shared/custom-agent-models.ts:12-77,79-104` |
| Codex built-ins, auth restriction, source resolver | `src/renderer/features/agents/lib/models.ts:19-81,83-132` |
| Claude renderer clamp | `src/renderer/features/agents/lib/ipc-chat-transport.ts:240-246` |
| Claude alias map | `src/renderer/features/agents/atoms/index.ts:421-427` |
| Codex renderer clamp and duplicate default | `src/renderer/features/agents/lib/acp-chat-transport.ts:75,129-156` |
| Main-process Codex empty-id fallback/pass-through | `src/main/lib/codex/model-selection.ts:1,32-40` |
| Claude route input and SDK query pass-through | `src/main/lib/trpc/routers/claude.ts:113`; `src/main/lib/claude/agent-sdk-query-options.ts:293` |
| OpenAI models probe response discard | `src/main/lib/codex/api-key-validation.ts:174-187` |
| Remote JSON fetch pattern | `src/main/lib/mcp-registry/official-provider.ts:1-260` |
| Raw local-only boolean versus hostname guard | `src/main/lib/local-only.ts:23-35` |
| Safe provider-model rule | `src/shared/local-job-api.ts:380-387` |
| Hidden-model atom | `src/renderer/lib/atoms/index.ts:611-616` |
| Chat picker static imports/filter | `src/renderer/features/agents/main/chat-input-area.tsx:119-120,621,636,652` |
| New-chat picker static imports/filter | `src/renderer/features/agents/main/new-chat-form.tsx:143-144,688,695,711` |
| Settings hidden-model checklist | `src/renderer/components/dialogs/settings-tabs/agents-models-tab.tsx:1994-2006,2093-2107` |
| Runtime-core guard directory list | `scripts/check-architecture-guards.mjs:175-180` |

No anchor drift requiring a ticket correction was found. Three audit details
were recorded without changing the approved design or acceptance criteria:

- The design's shortened `atoms/index.ts` reference resolves to the full Claude
  atom path shown above.
- `new-chat-form.tsx:688` reads the hidden-model state; the corresponding Codex
  filter expression is currently at line 695.
- The local-only hostname blocklist itself is in
  `src/shared/local-only.ts:28-45`; `src/main/lib/local-only.ts:27-35` is the
  main-process wrapper. Also, the current Codex normalizer rejects whitespace
  and the literal sentinel `codex` before otherwise passing model strings
  through (`src/main/lib/codex/model-selection.ts:3-15`).

## Task 5 — final verification

Verified: 2026-07-23 (Pacific/Auckland), on
`codex/add-remote-model-catalog`.

### 5.1 — repository checks

Final command:

```text
bun run check
```

Result: exit 0.

- Changed-line Biome lint: passed (only pre-existing diagnostics outside
  changed lines were ignored by the repository's existing wrapper).
- Import-boundary architecture guard: `Architecture guard passed.`
- TypeScript: `tsc --noEmit` passed.
- Tests: **1462 passed, 0 failed, 7404 assertions, 264 files**.

Focused catalog/security regression command also passed before the full suite:

```text
bun test tests/codex-api-key-validation.test.ts \
  tests/codex-api-key-model-store.test.ts \
  tests/model-catalog.test.ts \
  tests/model-catalog-fetcher.test.ts \
  tests/remote-model-catalog-renderer.test.ts \
  tests/model-catalog-main-validation.test.ts
```

Result: **33 passed, 0 failed, 120 assertions, 6 files**. This includes strict
schema/merge cases, streamed response caps, cache permissions, local-only with
a warm cache, custom/unknown transport pass-through, prototype-like aliases,
first-party main-process validation, malformed OpenAI model-list handling, and
safe persistence of the last validated API-key model snapshot. The latter is
updated in mounted pickers through a main-to-renderer subscription without an
extra provider request; the encrypted API-key payload is atomically replaced,
and snapshot-write failure is diagnostic-only so it cannot change validation
or run behavior.

### 5.2 — manual desktop smoke

All UI observations below were made in the real Electron development app with
fresh isolated `LOCUS_USER_DATA_DIR` directories. Temporary HTTP servers and
Electron processes were stopped after the scenarios.

#### (a) Fresh launch with the catalog endpoint offline

- Launch environment:
  `LOCUS_USER_DATA_DIR=/tmp/locus-catalog-offline-net.AL4BGs`,
  `LOCUS_LOCAL_ONLY=0`, and
  `LOCUS_MODEL_CATALOG_URL=http://127.0.0.1:9/model-catalog.json`.
- Main diagnostics recorded
  `[model-catalog] Remote catalog refresh failed; using local fallback.` with
  `TypeError: fetch failed`, proving this exercised network-failure fallback
  rather than the local-only short circuit.
- The fresh Claude picker contained exactly the built-in rows **Fable 5,
  Opus 4.8, Sonnet 4.6, Haiku 4.5**. The fresh Codex picker contained exactly
  **GPT-5.5, GPT-5.4, GPT-5.4 Mini, GPT-5.3-Codex Spark**. The new Custom row is
  a separate capability and not a catalog model.
- No catalog error appeared in the application UI.

#### (b) Locally served manifest adds a fake model without rebuild

- Launch environment:
  `LOCUS_USER_DATA_DIR=/tmp/locus-catalog-fake.IbNiaE`,
  `LOCUS_LOCAL_ONLY=0`, and
  `LOCUS_MODEL_CATALOG_URL=http://127.0.0.1:48192/model-catalog.json`.
- The request-counting server received `FAKE_REQUEST 1` and returned a valid
  manifest adding Claude `vendor/claude-smoke-v2` (label/version
  `Claude Smoke 2`) and Codex `gpt-smoke-remote` (`GPT Smoke Remote`). Both
  appeared in their picker without a renderer rebuild.
- `Claude Smoke 2` was selected in the live picker and remained the selected
  model after restarting the app against the same isolated user-data directory.
- An actual `claude.chat` Electron tRPC subscription was issued with trace id
  `9004`. `CLAUDE_REQUEST_TRACE` recorded
  `"model":"vendor/claude-smoke-v2"`; the subscription emitted `started`,
  `start`, `start-step`, and `session-init`. The main-process SDK diagnostic
  then recorded `[CLAUDE SDK ERROR] Model: vendor/claude-smoke-v2` before the
  expected no-credential auth failure. This proves the remote id reached the
  runtime unchanged rather than being clamped to a built-in.

#### (c) Invalid manifest falls back silently

- Launch environment:
  `LOCUS_USER_DATA_DIR=/tmp/locus-catalog-invalid.GlZtcJ`,
  `LOCUS_LOCAL_ONLY=0`, and the local server at port `48191`.
- The server returned an otherwise manifest-shaped object with a strict-schema
  violation (`unexpected`). It received the catalog request; main diagnostics
  contained the Zod validation failure.
- Both pickers showed the same built-ins listed in scenario (a). The
  Notifications surface remained empty and no catalog error was surfaced to
  the user.

#### (d) Custom id from each picker reaches its runtime request

- Claude: opened the inline Custom model form, entered
  `vendor/claude-custom-smoke`, and clicked **Use model**. The trigger rendered
  that exact id plus the Custom badge. Actual subscription trace id `9005`
  recorded the exact id in `CLAUDE_CUSTOM_REQUEST_TRACE`, emitted `started`,
  and the SDK diagnostic recorded
  `[CLAUDE SDK ERROR] Model: vendor/claude-custom-smoke` before the expected
  auth failure.
- Codex: switched to OpenAI Codex, opened the inline Custom model form, entered
  `gpt-custom-smoke`, and clicked **Use model**. The trigger rendered that exact
  id plus the Custom badge. Actual `codex.chat` subscription trace id `9006`
  emitted `started` with `"model":"gpt-custom-smoke/high"`. `/high` is the
  existing Codex thinking wire suffix required by task 3.4; the custom base id
  remained verbatim and was not replaced by a built-in. The local environment's
  unauthenticated Figma MCP then stopped the run at the existing MCP preflight,
  which is unrelated to model selection.

#### (e) Local-only mode makes zero catalog requests

- Launch environment:
  `LOCUS_USER_DATA_DIR=/tmp/locus-catalog-localonly.lLQZ8Q`,
  `LOCUS_LOCAL_ONLY=1`, with the request-counting server URL still configured.
- The server counter was **2** before launch. After opening Quick Chat, which
  mounts the catalog consumers, and waiting for refresh, it remained **2**:
  zero new catalog network requests.
- The pickers used built-ins. The automated warm-cache case additionally proves
  local-only returns the built-in catalog even when a remote cache file exists.

### 5.3 — strict OpenSpec validation

Final command:

```text
openspec validate add-remote-model-catalog --strict --no-interactive
```

Result: exit 0, `Change 'add-remote-model-catalog' is valid`.

### Boundary audit

- No bundled CLI download or binary path, Ollama gate, provider-profile
  behavior, headless surface, or app-agent model enum was changed.
- i18n structure was not changed; only the picker copy required by the approved
  design was added to the existing dictionaries.
- `proposal.md`, `design.md`, and `specs/model-catalog/spec.md` are unmodified.
  No implementation finding required changing the approved ticket.
- The change remains unmerged and unarchived for review.
