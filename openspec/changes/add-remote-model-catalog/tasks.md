# Tasks: add-remote-model-catalog

## 0. Preconditions

- [x] 0.1 Clean tree on main; re-verify the file:line anchors in design.md
      Context before editing (they were verified 2026-07-23 and may drift).

## 1. Shared schema + seed manifest

- [x] 1.1 Create `src/shared/model-catalog.ts`: zod schema (strict) + TS types
      per design.md's CatalogModel (incl. version/bestFor/tokenNote/latency
      locale maps and display-string metadata); export `isSafeProviderModel`
      from `src/shared/local-job-api.ts` (currently unexported, lines
      ~380-387) and reuse it for id validation; export
      `mergeModelCatalog(builtin, remote)` implementing overlay rules
      (add/update/deprecate; never delete built-ins; built-in i18n-keyed copy
      kept when manifest omits the corresponding field).
- [x] 1.2 Create `docs/model-catalog.json` seeding the current built-in
      CLAUDE_MODELS + CODEX_MODELS: ids, labels, version, thinking levels,
      auth restrictions, and display-string metadata
      (contextWindow/maxOutput/pricing/cachedInput). The i18n-keyed copy
      (summary/bestFor/tokenNote/latency of built-ins) stays in the
      dictionaries and is NOT duplicated into the seed. No new models in this
      change.
- [x] 1.3 Unit tests: schema rejects unknown keys, oversize strings, bad id
      charset; merge adds/updates/deprecates and never drops a built-in.

## 2. Main-process fetcher + router

- [x] 2.1 Create `src/main/lib/model-catalog/fetcher.ts` modeled on
      `mcp-registry/official-provider.ts`: fixed raw-GitHub URL (packaged),
      `LOCUS_MODEL_CATALOG_URL` override honored only when unpackaged, 10s
      timeout, 2MB cap, injectable fetchImpl; validate with the shared schema;
      persist last-good to `{userData}/model-catalog-cache.json` (0o600); 24h
      TTL; stale-while-revalidate accessor returning
      `{catalog, source: "builtin"|"cache"|"remote", fetchedAt}`.
- [x] 2.2 Local-only mode: gate on the raw boolean `isLocalOnlyMode()`
      (`src/main/lib/local-only.ts:23-25`) — do NOT use
      `assertOfficialCloudAllowed`, whose hostname blocklist does not include
      raw.githubusercontent.com and would let the fetch through. When
      local-only: skip the network fetch entirely (reading the existing local
      cache FILE remains allowed); fail closed to built-ins on any
      guard-check error.
- [x] 2.3 New `src/main/lib/trpc/routers/model-catalog.ts` with a `get` query
      (no inputs) returning the merged catalog + source/fetchedAt; register in
      the router index. Dependency direction is router → lib only.
- [x] 2.4 Tests: TTL respected, invalid remote falls back to cache then
      built-ins, local-only skips network (assert fetchImpl never called),
      cache file permissions.
- [x] 2.5 Add `src/main/lib/model-catalog` to `RUNTIME_CORE_DIRECTORIES` in
      `scripts/check-architecture-guards.mjs` (lines ~175-180) so the
      import-boundary guard (no direct electron/trpc/renderer/preload
      imports) actually covers the new directory — without this the boundary
      is convention only.

## 3. Renderer catalog store + picker integration

- [x] 3.1 New renderer store (Jotai atom + tRPC query, pattern:
      `runtime-manifest-store.ts`) exposing the merged catalog, with INITIAL
      atom value = built-in catalog (never empty pre-hydration). The actual
      importers of `CLAUDE_MODELS`/`CODEX_MODELS` switch to the store:
      `chat-input-area.tsx` (~lines 119-120, 621, 636), `new-chat-form.tsx`
      (~143-144, 688, 695, 711), `agents-models-tab.tsx` (~2093-2107).
      `agent-model-selector.tsx` / `runtime-model-selector.tsx` do NOT import
      the constants — they receive model arrays as props and need only
      rendering changes (version-in-label composition, deprecated/custom
      badges, custom row, API-key group). Built-in entries keep their i18n
      dictionary strings; remote-added entries render manifest copy
      (locale-matched, en fallback).
- [x] 3.2 Deprecated models: hidden from picker lists; a persisted selection
      of a deprecated/unknown id still renders (verbatim + badge) and remains
      usable. The `hiddenModelsAtom` hide/show checklist in the settings
      models tab is rebuilt from the MERGED catalog (remote-added models
      hideable; custom-typed ids not listed).
- [x] 3.3 Custom model entry: "Custom model…" row in Claude and Codex pickers
      opening an inline input (1-200 chars, validated by the exported
      `isSafeProviderModel` rule — same charset as manifest ids), persisted
      via existing per-source atoms; custom ids bypass
      `resolveCodexModelForSource` auto-switch with a caveat line.
- [x] 3.4 Remove the clamps: `ipc-chat-transport.ts` sends non-alias ids
      as-is (aliases still resolve via `MODEL_ID_MAP`);
      `acp-chat-transport.ts` composes `${id}/${thinking}` for any id
      (default thinking "high" for unknown ids). Keep main-process
      `DEFAULT_CODEX_MODEL` empty-id fallback. Delete the now-dead duplicate
      `DEFAULT_CODEX_MODEL` in `acp-chat-transport.ts:75` if unused after.
- [x] 3.5 Tests: transport passes custom ids through unchanged (both
      runtimes); alias mapping unchanged; deprecated hidden but persisted
      selection survives.

## 4. OpenAI /v1/models parse (Codex API-key source)

- [x] 4.1 `codex/api-key-validation.ts`: today the success branch returns on
      `response.ok` without ever reading the body (~lines 185-187) — add
      reading + parsing it; store ids matching `gpt-*`/`o*`/`codex*`
      alongside validation state (no extra network call; parse failure
      tolerated = today's behavior).
- [x] 4.2 Codex picker: when active source is openai-api-key, show cached live
      ids absent from the merged catalog under an "available via your API key"
      group (custom-id styling, no metadata).
- [x] 4.3 Tests: parse tolerates malformed body; group only renders for the
      api-key source; catalog entries never duplicated in the extra group.

## 5. Verification

- [x] 5.1 `bun run check` green (includes the import-boundary guard);
      record counts in `verification.md`.
- [x] 5.2 Manual smoke, recorded in `verification.md`: (a) fresh launch
      offline → pickers identical to today's built-ins; (b) with a locally
      served manifest adding a fake model via `LOCUS_MODEL_CATALOG_URL` (dev)
      → fake model appears without rebuild, selecting it sends its id
      verbatim (assert via debug log/trace); (c) invalid manifest → built-ins,
      no error surfaced; (d) custom id typed in each picker reaches the
      runtime request verbatim; (e) local-only mode → zero catalog network
      requests.
- [x] 5.3 `openspec validate add-remote-model-catalog --strict
      --no-interactive` passes.
