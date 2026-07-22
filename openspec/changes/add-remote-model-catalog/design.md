# Design: add-remote-model-catalog

## Context

Verified state (2026-07-23 exploration; re-verify line numbers before editing):

- `CLAUDE_MODELS` (`src/shared/custom-agent-models.ts:12-77`): 4 alias entries
  (fable/opus/sonnet/haiku) with baked-in version/pricing/context metadata.
  The bundled Claude Code CLI resolves aliases to concrete versions itself, so
  Claude staleness = missing NEW FAMILY entries + stale metadata only.
  `CUSTOM_AGENT_MODEL_IDS`/`isCustomAgentModel` (lines 80-104) derive the
  app-agent model enum from this list.
- `CODEX_MODELS` (`src/renderer/features/agents/lib/models.ts:19-79`): concrete
  ids (gpt-5.5, gpt-5.4, gpt-5.4-mini, gpt-5.3-codex-spark) + thinking levels;
  `CODEX_CHATGPT_AUTH_ONLY_MODEL_IDS` (line 81) gates spark to ChatGPT auth;
  `resolveCodexModelForSource` (lines 83-132) auto-switches unsupported
  selections per auth source.
- Renderer clamps (the effective allowlists — main never validates):
  `ipc-chat-transport.ts:240-246` rewrites unknown Claude ids to "fable" via
  `MODEL_ID_MAP` (`atoms/index.ts:421-427`); `acp-chat-transport.ts:129-156`
  rewrites unknown Codex ids to "gpt-5.5" (duplicate `DEFAULT_CODEX_MODEL` at
  line 75; main-process copy at `codex/model-selection.ts:1`).
- Main-process pass-through: `trpc/routers/claude.ts:113` `z.string().optional()`
  → SDK query options (`agent-sdk-query-options.ts:293`); Codex
  `model-selection.ts:32-40` accepts any nonempty string.
- Discarded live list: `codex/api-key-validation.ts` GETs
  `https://api.openai.com/v1/models` (fetch ~lines 174-185) and checks only
  `response.ok`.
- Remote-fetch pattern to copy: `src/main/lib/mcp-registry/official-provider.ts`
  — zod-validated remote JSON, 10s timeout, 2MB cap, injectable `fetchImpl`.
- Local-only mode: CAUTION — `assertOfficialCloudAllowed`
  (`src/main/lib/local-only.ts:27-35`) is a narrow hostname BLOCKLIST
  (21st.dev/e2b.app/etc., explicitly "not an air-gap mode") and would NOT
  block `raw.githubusercontent.com`. The catalog fetcher must therefore gate
  on the raw boolean `isLocalOnlyMode()` (`local-only.ts:23-25`) directly —
  copying the `assertOfficialCloudAllowed` call pattern would silently violate
  the zero-network requirement.
- `resolveCodexModelForSource` is at `models.ts:109-132`; lines 83-108 are the
  source-support helper functions.
- Existing hide-models feature: `hiddenModelsAtom`
  (`src/renderer/lib/atoms/index.ts:611-616`) filters `CODEX_MODELS` in
  `chat-input-area.tsx:621,636` and `new-chat-form.tsx:688`, with the toggle
  checklist in `agents-models-tab.tsx:1994-2006, 2093-2107` built from a
  static loop over both built-in arrays — it must move to the merged catalog.
- Precondition: the GitHub repo is public today, which is what makes the raw
  URL fetch work; if it ever goes private the fetch 404s and the app
  permanently serves built-ins (acceptable fail-safe, but worth knowing).

## Goals / Non-Goals

- Goals:
  - New models selectable without repackaging (remote catalog overlay).
  - Unknown model ids never silently rewritten; users can type a custom id.
  - API-key Codex users see the live model list the app already downloads.
  - Fail-safe always: offline / fetch error / invalid catalog / local-only
    mode → identical behavior to today's built-ins.
- Non-Goals (do NOT touch):
  - Bundled CLI binary updates (claude/codex pinned downloads) — separate
    problem.
  - Ollama picker gating (offline-debug flag behavior stays as is).
  - Provider-profile editor and headless Local Job API (already free-text).
  - app_agents model enum (`isCustomAgentModel`) — stays derived from
    built-ins; catalog-driven app-agent models are a later change.
  - i18n restructuring: built-in models keep their dictionary keys; remote
    entries carry their own display strings (used as-is, both locales may be
    provided in the manifest).
  - Pricing accuracy guarantees — metadata is informational.

## Decisions

- Decision: catalog lives at `docs/model-catalog.json` on the repo main
  branch, fetched from the raw GitHub URL. Packaged builds use the fixed URL;
  a `LOCUS_MODEL_CATALOG_URL` override is honored ONLY when unpackaged
  (mirroring the dev-only env-gate pattern in
  `agent-runtime/runtime-feature-settings.ts`). Rationale: editing a repo file
  is the lightest publish path and needs no release infrastructure.
- Decision: manifest schema (in `src/shared/model-catalog.ts`):
  `{ schemaVersion: 1, claude: CatalogModel[], codex: CatalogModel[] }` where
  `CatalogModel = { id, label, version?: string, summary?: {en?, zh?},
  bestFor?: {en?, zh?}, tokenNote?: {en?, zh?}, latency?: {en?, zh?},
  thinking?: string[], authRestriction?: "chatgpt-only" | "api-key-only",
  deprecated?: boolean, metadata?: {contextWindow?: string, maxOutput?:
  string, pricing?: string, cachedInput?: string} }`. Metadata values are
  DISPLAY STRINGS (built-ins contain values like "1M", "Preview", "ChatGPT
  Pro credits" — do not model them as numbers). Built-in entries keep their
  i18n dictionary keys (summaryKey/bestForKey/tokenNoteKey/latencyKey) — the
  merge keeps built-in copy when the manifest omits those fields; the locale
  maps exist so REMOTE-ADDED models can carry copy without dictionary edits.
  All strings length-capped; `id` charset-validated by the exact headless
  `isSafeProviderModel` rule (`src/shared/local-job-api.ts:380-387` — export
  it from there rather than duplicating the regex; the SAME rule governs the
  custom-model input field, superseding any narrower charset elsewhere in
  this change). zod `.strict()` so unknown keys fail validation (fail closed
  to built-ins). The catalog can never carry URLs, commands, or credentials.
- Decision: merge = built-ins first, then remote overlay keyed by id: remote
  may ADD models, UPDATE label/summary/metadata/authRestriction, and set
  `deprecated` (deprecated models are hidden from the picker but a persisted
  selection of one keeps working — pass-through, never rewritten). Remote can
  NOT delete a built-in (fail-safe floor).
- Decision: fetch lifecycle: lazy fetch on first catalog consumer (picker or
  settings mount) + at most once per 24h TTL; cached last-good JSON in
  `{userData}/model-catalog-cache.json` (0o600 like runtime-feature-settings);
  never blocks UI (stale-while-revalidate: serve built-ins-or-cache
  immediately, notify store when fresh data lands). When `isLocalOnlyMode()`
  is true: skip the NETWORK fetch entirely (reading the existing local cache
  file is still allowed — it is local data).
- Decision: clamp removal semantics: `ipc-chat-transport` sends the stored id
  as-is when it is not a known alias (aliases still map through
  `MODEL_ID_MAP`); `acp-chat-transport` composes `${id}/${thinking}` for any
  id, defaulting thinking to "high" for unknown ids. The main-process
  `DEFAULT_CODEX_MODEL` fallback for empty ids stays.
- Decision: custom model entry UI: a "Custom model…" row at the bottom of the
  Claude and Codex picker lists opening an inline input (validated: 1-200
  chars, by the exported `isSafeProviderModel` rule — one charset for
  manifest ids and custom input alike), persisted via the existing per-source
  atoms. Custom ids display verbatim with a "custom" badge and bypass
  `resolveCodexModelForSource` auto-switching (user override wins; the picker
  shows a caveat line when source-support is unknown).
- Decision: hide-models integration: the `hiddenModelsAtom` toggle checklist
  in the settings models tab is built from the MERGED catalog instead of the
  static arrays, so remote-added models are hideable too; custom-typed ids
  are not hideable (user-entered by definition). Hidden state keyed by model
  id, unchanged storage.
- Decision: the renderer catalog atom's INITIAL value is the built-in
  catalog, not empty — a message sent before tRPC hydration completes must
  compose ids exactly as today, never from an empty list.
- Decision: `/v1/models` parse: `api-key-validation.ts` stores the id list
  (filtered to `gpt-*`, `o*`, `codex*` prefixes) alongside validation state;
  the Codex picker shows ids absent from the merged catalog under an
  "available via your API key" group (no metadata, custom-id styling) only
  when the active source is openai-api-key.
- Alternatives considered: (a) fetching Anthropic `/v1/models` for Claude —
  rejected for v1: the first-party Claude path is OAuth (no API key on hand)
  and aliases already track point releases; provider-profile users already
  have free-text. (b) Shipping the catalog via electron-updater feed —
  rejected: couples catalog freshness to release cadence, which is the
  problem being solved.

## Risks / Trade-offs

- Risk: remote catalog becomes an injection surface. → Mitigation: strict zod,
  charset/length caps, no URL-bearing fields, https-only fixed host in
  packaged builds, fail-closed to built-ins on any validation error.
- Risk: clamp removal lets a stale localStorage id reach the runtime and fail
  at run time instead of being silently rewritten. → Accepted and intended:
  the runtime error is honest; picker still shows the id so the user can
  change it. Test this path explicitly.
- Risk: raw.githubusercontent availability/rate limits. → TTL + last-good
  cache + built-in floor make outages invisible.

## Migration Plan

Single change; no data migration. Rollback = revert; built-ins are still the
floor at every layer.

## Open Questions

None blocking. Seed `docs/model-catalog.json` content mirrors current
built-ins exactly; adding genuinely new models to it is an editorial act after
this change lands.
