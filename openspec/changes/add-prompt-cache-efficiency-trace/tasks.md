## 1. Spec
- [x] 1.1 Confirm the new requirement attaches to the existing "Workbench Semantic Runtime Timeline" usage row and reuses the `WorkbenchTraceRow` presenter rather than adding a second usage presenter

## 2. Normalized usage fields (cross-runtime)
- [x] 2.1 Confirm Claude populates exclusive `inputTokens` plus `cacheReadInputTokens` / `cacheCreationInputTokens` end-to-end into the trace presenter (`src/main/lib/claude/transform.ts:451` → `workbench-trace-presenter.ts:332`)
- [x] 2.2 Map Codex app-server `cachedInputTokens` (`src/main/lib/codex/app-server-stream-events.ts:161`) into the shared cache-read field
- [x] 2.3 Normalize `inputTokens` semantics so the cache-ratio denominator is consistent: preserve the existing per-runtime total-input-context rule (`chats-helpers.ts:392`) — Codex `totalTokens - outputTokens`, Claude `input + cacheRead + cacheCreation` — rather than computing `input + cacheRead` directly for Codex (which double-counts cached, since Codex `inputTokens` is inclusive per `usage-metadata.ts:224`)
- [x] 2.4 Treat cache-creation as `0` when a runtime does not report it
- [x] 2.5 Verify the normalized Codex values reach `workbench-trace-presenter.ts` `getUsage` for a real Codex app-server run
  - Real smoke passed with bundled Codex CLI `0.139.0` at `resources/bin/darwin-arm64/codex`: the adapter run succeeded, emitted a `usage_update`, and `getWorkbenchTraceRow` exposed `cacheReadInputTokens: 2432`, `totalInputContextTokens: 25087`, and `cacheHitRatio: 0.09694263961414279`.

## 3. Implementation
- [x] 3.1 Extract the `chats-helpers.ts:392` total-input-context derivation into a renderer-safe pure shared helper (for example `src/shared/usage-metadata.ts`) and update both `chats-helpers.ts` and `workbench-trace-presenter.ts` to consume it
- [x] 3.2 Ensure renderer code imports only the shared helper, not `src/main/lib/trpc/routers/chats-helpers.ts` or any other main-process router module
- [x] 3.3 Compute `cacheHitRatio = cacheRead / totalInputContext`, guarding against a zero/absent baseline and clamping to ≤ 1
- [x] 3.4 Extend `WorkbenchTraceUsage` / `getUsage` (`workbench-trace-presenter.ts:322`) to expose the derived ratio; render it in the `WorkbenchTraceRow` / `RunTraceWidget` usage row
- [x] 3.5 Omit the indicator when there is no cache data or no input baseline
- [x] 3.6 Do NOT add cache fields to `chats.getUsageSummary` `UsageTotals` or render this in `RunUsageWidget`

## 4. Tests
- [x] 4.1 Claude-shaped usage (input excl=60, cacheRead=40, creation=0, output=20) → ratio 0.4
- [x] 4.2 Codex app-server-shaped usage with `provider: "codex"` / `adapterSource: "codex-app-server"` and no `model` (input incl=100, cached=40, total=120, output=20) → ratio 0.4 (no double-count; denominator = total − output = 100)
- [x] 4.3 Omit-when-unavailable: no cache tokens or no input baseline → indicator absent, not a zero ratio
- [x] 4.4 Bound: ratio never exceeds 1
- [x] 4.5 Renderer-safe: only derived counts and ratio reach the row; no raw provider usage payload
- [x] 4.6 Boundary: renderer trace code imports the shared helper and does not import main/tRPC router helpers

## 5. Verify
- [x] 5.1 `bun run test`
- [x] 5.2 `bun run ts:check`
- [x] 5.3 `bun run architecture:check`
- [x] 5.4 `openspec validate add-prompt-cache-efficiency-trace --strict --no-interactive`
