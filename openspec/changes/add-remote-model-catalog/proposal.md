# Change: Add remote model catalog with custom model pass-through

## Why

Every new Claude/Codex model release currently requires editing hardcoded
renderer arrays (`CLAUDE_MODELS` in `src/shared/custom-agent-models.ts`,
`CODEX_MODELS` in `src/renderer/features/agents/lib/models.ts`) and shipping a
full app rebuild before users can select the model. Verified 2026-07-23: the
main process never validates model ids (pass-through into the Claude Agent SDK
and Codex app-server), so the staleness lives entirely in the renderer picker
catalogs plus two renderer clamps that silently rewrite unknown ids to
defaults. Meanwhile the app already fetches OpenAI `/v1/models` as an API-key
auth probe and discards the returned model list.

## What Changes

- Add a remote model-catalog manifest: `docs/model-catalog.json` in this repo,
  fetched at runtime from the repo's raw GitHub URL by a new main-process
  fetcher modeled on the MCP registry client pattern (zod-validated, timeout,
  size cap, cached with TTL, last-good fallback). Editing that JSON on GitHub
  updates every installed app's model lists without repackaging.
- Merge semantics: built-in lists remain the offline/fail-safe base; the remote
  catalog overlays additions, label/metadata updates, and deprecation flags.
  Any fetch/validation failure silently falls back to built-ins.
- Respect local-only mode: when the local-only cloud guard forbids hosted
  calls, the catalog fetch is skipped entirely and built-ins are used.
- Custom model pass-through: remove the two renderer clamps that rewrite
  unknown ids to defaults, and add a "custom model id" free-text entry to the
  Claude and Codex pickers (charset/length validated, persisted like existing
  selections). The main process already passes arbitrary ids through.
- Parse the OpenAI `/v1/models` response the API-key probe already receives:
  cache the id list and show ids not in the catalog as an extra
  "available via your API key" picker group for the openai-api-key source.

No breaking changes. No schema/db changes. Headless surfaces unchanged.

## Impact

- Affected specs: `model-catalog` (new capability)
- Affected code:
  - `docs/model-catalog.json` (new seed manifest mirroring current built-ins)
  - `src/shared/model-catalog.ts` (new: schema/types shared by main+renderer)
  - `src/main/lib/model-catalog/` (new: fetcher + cache + merge)
  - `src/main/lib/trpc/routers/model-catalog.ts` (new router) + router index
  - `src/main/lib/codex/api-key-validation.ts` (parse instead of discard)
  - `src/renderer/features/agents/lib/models.ts`,
    `src/shared/custom-agent-models.ts` (become the built-in fallback source)
  - `src/renderer/features/agents/lib/ipc-chat-transport.ts:240-246`,
    `acp-chat-transport.ts:129-156` (clamp removal)
  - picker surfaces: `agent-model-selector.tsx`, `runtime-model-selector.tsx`,
    `chat-input-area.tsx`, `new-chat-form.tsx`, settings models tab
- Coordination: none of the active changes touch these files
  (`update-trpc-capability-boundary` lists routers only as future scope).
