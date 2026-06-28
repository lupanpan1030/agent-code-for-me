# Change: Surface prompt cache efficiency in the Workbench trace usage row

## Why
The Workbench trace usage presenter already reads per-run prompt cache token
usage: `getUsage` in
`src/renderer/features/agents/workbench/workbench-trace-presenter.ts:322` builds
`WorkbenchTraceUsage` and already pulls `cacheReadInputTokens` and
`cacheCreationInputTokens` (lines 332-333). But the trace row never derives or
shows a prompt cache hit indicator, so users cannot see whether a run benefits
from prompt caching — the single cheapest, most trace-aligned slice of
context-engineering observability.

The non-trivial part is correctness across runtimes, because `inputTokens` does
not mean the same thing on each runtime:
- Claude reports `inputTokens` **excluding** cached tokens; total input context
  is `input + cacheRead + cacheCreation`.
- Codex reports `input_tokens` **including** cached tokens. The jsonl usage path
  already subtracts: `inputTokens = input_tokens - cached_input_tokens`
  (`src/main/lib/codex/usage-metadata.ts:224`, covered by
  `tests/codex-usage-metadata.test.ts:41`). But the Codex app-server live path
  passes `inputTokens` through raw with a separate `cachedInputTokens`
  (`src/main/lib/codex/app-server-stream-events.ts:158,161`), so its
  `inputTokens` is still inclusive.

Therefore a naive `cacheRead / (input + cacheRead + cacheCreation)` ratio would
**double-count** cached tokens for Codex app-server runs. The repo already has
the correct per-runtime total-input-context derivation in
`src/main/lib/trpc/routers/chats-helpers.ts:392`: Codex uses
`totalTokens - outputTokens`, Claude uses `input + cacheRead + cacheCreation`.
This change must reuse that derivation, not introduce a second one. Because the
trace presenter runs in the renderer while `chats-helpers.ts` is a main/tRPC
router helper, the shared rule must move to a renderer-safe pure helper rather
than importing main-process router code into renderer code.

## What Changes
- Add a `Prompt Cache Efficiency In Usage Trace` requirement to `agent-workbench`:
  when a run reports cache token usage, the trace usage row surfaces a prompt
  cache hit indicator equal to cache-read tokens divided by a **runtime-consistent
  total input context** that does not double-count cached tokens, bounded so it
  cannot exceed one, and omitted when no cache data or no input baseline exists.
- Normalize cache fields across runtimes in the trace presenter:
  - map Codex app-server `cachedInputTokens`
    (`app-server-stream-events.ts:161`) into the shared cache-read field, and
  - normalize `inputTokens` semantics so the denominator is consistent by
    extracting the existing per-runtime total-input-context rule from
    `chats-helpers.ts:392` into a renderer-safe shared helper (for example
    `src/shared/usage-metadata.ts`) that both `chats-helpers.ts` and
    `workbench-trace-presenter.ts` consume. Codex uses
    `totalTokens - outputTokens`; Claude uses `input + cacheRead +
    cacheCreation`. Cache-creation is optional and treated as `0` when a
    runtime does not report it (Codex has no creation field).
- Render the indicator in the trace usage row owned by the `WorkbenchTraceRow` /
  `RunTraceWidget` presenter — NOT in `RunUsageWidget`, which reads
  `chats.getUsageSummary` whose `UsageTotals`
  (`chats-helpers.ts:254`) has no cache fields, to avoid a second usage
  presenter.

Non-goals: this change does NOT add per-section prompt cache diagnostics (Locus
does not own prompt assembly for delegated runtimes), does NOT add cache fields
to the `chats.getUsageSummary` `UsageTotals` DTO, and does NOT change how
runtimes report raw usage.

## Impact
- Affected specs: `agent-workbench`
- Affected code:
  `src/shared/usage-metadata.ts` (or equivalent renderer-safe shared pure
  helper for total-input-context derivation and cache field normalization),
  `src/renderer/features/agents/workbench/workbench-trace-presenter.ts`
  (`WorkbenchTraceUsage`, `getUsage`), the trace usage row in the
  `WorkbenchTraceRow` / `RunTraceWidget` surface, Codex metadata normalization
  for `cachedInputTokens` and inclusive `inputTokens`
  (`src/main/lib/codex/app-server-stream-events.ts`), reusing the
  total-input-context derivation already in `chats-helpers.ts:392` without
  importing the main/tRPC helper into renderer code. Claude already populates
  exclusive `inputTokens` plus
  `cacheReadInputTokens` / `cacheCreationInputTokens`
  (`src/main/lib/claude/transform.ts:451`).
- Cross-runtime parity: after normalization an equivalent run produces the same
  ratio on Claude and Codex (e.g. 40 cached of 100 input-context tokens → 0.4 on
  both); a run that genuinely reports no cache data omits the indicator. `[needs
  smoke]` to confirm the normalized Codex values reach the presenter end-to-end.
