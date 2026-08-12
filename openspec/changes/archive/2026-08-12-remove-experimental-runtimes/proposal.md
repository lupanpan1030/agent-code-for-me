# Change: Remove the experimental runtimes (kun and qwen-code)

## Why

Locus is converging on one thesis — **run agents safely in parallel on real git repos**. The two
experimental runtimes are off that thesis and carry cost and risk out of proportion to any value
they deliver:

- **Neither delivers a capability Locus lacks.** The stated reason to keep `kun` was cheap DeepSeek
  access. DeepSeek is already a shipped first-class provider preset
  (`src/main/lib/provider-profiles/presets.ts`) whose `targetRuntimes` includes `claude` and `codex`,
  and Kun consumes the *same* provider gateway a Codex profile does. Kun buys zero incremental
  DeepSeek access.
- **`qwen-code` has no agent-guard enforcement at all.** No file under `src/main/lib/qwen/` imports
  `agent-guard`. Its approval prompt renders only `toolCall.title` — never the path, diff, or
  command — and its plan mode is cosmetic (`acpPermissionPolicy` is hardcoded `"ask"` for every
  control level, `agent-runtime/permission-policy.ts:487`), so a user in Locus "plan" mode is
  running a fully write-capable agent. That directly contradicts the thesis.
- **`kun` is a third-party competitor product under a noncommercial licence.** Upstream is
  `KunAgent/Kun` (formerly `XingYu-Zhong/DeepSeek-GUI`) — itself a local-first Electron desktop
  agent GUI with tool approvals, permission modes and diff review — licensed PolyForm Noncommercial
  1.0.0. It is also effectively uninstallable: no bundled binary, the managed-install allowlist is
  an empty array (`kun-managed-install.ts:89-90`), and upstream is `private: true` and not published
  to npm.
- **Both are reachable in packaged builds.** The gate is a persisted Settings toggle
  (`{userData}/runtime-feature-settings.json`), not a dev-only env flag.

Removing both empties `EXPERIMENTAL_RUNTIME_IDS`, which lets the entire experimental-runtime
scaffold be deleted rather than left half-alive.

## What Changes

- **BREAKING (user-facing):** the `kun` and `qwen-code` engines are removed. They disappear from the
  engine picker, onboarding, and Settings. Provider profiles can no longer target `kun`.
- **BREAKING (contract-adjacent):** `AgentRuntimeId` narrows to `"claude-code" | "codex"`, i.e. it
  becomes identical to `AgentRuntimeContractId`. `EXPERIMENTAL_RUNTIME_IDS` becomes `[]`.
- Delete `src/main/lib/kun/` (8 files, 3,308 lines) and `src/main/lib/qwen/` (4 files, 1,741 lines).
- Delete the 14 experimental tRPC procedures (10 kun, 4 qwen) from
  `src/main/lib/trpc/routers/agent-runtime.ts`.
- **Delete the guarded-scope-contract acceptance path** at `agent-runtime.ts:577-600` together with
  the `scopeContract` input field. `:578` rejects `scopeContract` for anything other than `kun`, so
  this path is kun-only and becomes unreachable. Removing only the `!== "kun"` guard would expose a
  guarded-run path to a runtime with no agent-guard enforcement — the two edits must land together.
- Delete the runtime feature-gate mechanism (`runtime-feature-settings.ts`, the
  `runtime-registry.ts` experimental branches, and the persisted
  `{userData}/runtime-feature-settings.json`), which has no remaining subject.
- Delete the shared experimental plumbing that now serves nothing:
  `agent-runtime/experimental-runtime-message-history.ts`,
  `renderer/features/agents/lib/qwen-chat-transport.ts`, and the runtime-neutral
  `qwen-ui-stream-normalizer.ts`.
- Delete the two capability manifests (`KUN_RUNTIME_MANIFEST`, `QWEN_CODE_RUNTIME_MANIFEST`) and
  their registry entries.
- Strip both runtimes from `permission-policy.ts`, `desktop-runner.ts`,
  `desktop-adapter-metadata.ts`, `desktop-agent-jobs.ts`, `chat-attachment-capabilities.ts`,
  `chat-message.ts`, `agent-chat-provider.ts`, all 13 provider presets, the provider-profile
  target gate in `provider-profiles/storage.ts`, and the renderer (Settings, onboarding, engine
  picker, atoms).
- Delete 308 i18n key definitions across both locales (89 kun + 65 qwen keys, x2 locales), and
  **reword** — not delete — `onboarding.aiPath.engineNote`, the one shared string that names both.
  (Measured on implementation: each locale went 3,144 → 2,990 keys.)
- Delete the `qwen-acp:smoke:evidence` script and its evidence gate in
  `tests/proof-evidence-gates.test.ts`.
- Retire 34 spec requirements across 3 capability specs, plus 3 Kun-scoped requirements in
  `provider-runtime-bindings` and the now-subjectless `Experimental Runtime Desktop Chat Dispatch`
  in `agent-runtime-core`.

### Explicitly NOT changed (scope guards)

These look like they are in scope and are not. A blanket grep on `qwen`, `kun`, or `acp` will
destroy working features.

| Surface | Why it survives |
| --- | --- |
| `src/main/lib/ollama/detector.ts`, `agents-models-tab.tsx` `RECOMMENDED_MODEL` | Ollama model *names* contain `qwen` (`qwen2.5-coder`, `qwen3-coder:30b`). Unrelated to the qwen-code runtime. |
| `presets.ts` `dashscope-qwen` / `qwen-plus` / `Qwen/Qwen3-Coder-30B-A3B-Instruct` | Provider presets for Qwen *models* via DashScope. Unrelated to the runtime. |
| `src/renderer/features/agents/lib/acp-chat-transport.ts` | Despite the name this is the **Codex** transport. Deleting it breaks Codex chat entirely. |
| `src/main/lib/headless/acp-stdio.ts`, `src/shared/acp-tool-normalizer.ts` | The Locus-owned `locus acp` stdio surface and its Codex-facing normalizer. Ratified by `agent-protocol-interfaces`. |
| `@agentclientprotocol/sdk`, `@mcpc-tech/acp-ai-provider` | Imported only by `codex/tool-permission.ts` and `codex/ask-user-question.ts`. Removing them breaks Codex. |
| `openspec/changes/archive/**` (9 qwen + 5 kun changes) | Archived changes are historical record, not live truth. Only `openspec/specs/` is edited. |

## Impact

**Affected specs (REMOVED)** — `kun-runtime` (16 requirements, dir deleted) ·
`qwen-code-runtime` (7, dir deleted) · `qwen-cli-setup-guidance` (7, dir deleted) ·
`provider-runtime-bindings` (3 Kun-scoped requirements; spec survives) ·
`agent-runtime-core` (`Experimental Runtime Desktop Chat Dispatch`, now subjectless).

**Affected specs (MODIFIED)** — `provider-routing-ux` (3 requirements that enumerate the four
runtimes) · `agent-chat-attachments` (`Provider Image Capability`, whose example cites the two
dying runtimes).

**NOT affected** — `local-job-api`, `headless-agent-jobs`, `agent-protocol-interfaces`,
`codex-runtime-parity`, `agent-scope-contracts`. These are already scoped to
`CONTRACT_RUNTIME_IDS`, which is unchanged.

**Affected code (delete)** — `src/main/lib/kun/**`, `src/main/lib/qwen/**`,
`agent-runtime/runtime-feature-settings.ts`, `agent-runtime/experimental-runtime-message-history.ts`,
`agent-runtime/desktop-adapter-metadata.ts` (both entries),
`renderer/features/agents/lib/qwen-chat-transport.ts`,
`renderer/features/agents/lib/qwen-ui-stream-normalizer.ts`,
`renderer/features/onboarding/components/panels/qwen-action.tsx`,
`scripts/check-qwen-acp-smoke-evidence.mjs`, 14 test suites,
`openspec/specs/{kun-runtime,qwen-code-runtime,qwen-cli-setup-guidance}/`.

**Affected code (edit)** — `src/shared/agent-runtime-capabilities.ts`,
`agent-runtime/{permission-policy,runtime-registry,desktop-runner}.ts`, `desktop-agent-jobs.ts`,
`provider-profiles/{presets,storage,gateway}.ts`, `headless/provider-binding.ts`,
`trpc/routers/{agent-runtime,provider-profiles}.ts`, `src/shared/{chat-message,agent-chat-provider,
chat-attachment-capabilities,provider-profile-types}.ts`, `dictionaries.ts`, and the renderer
(`agents-models-tab.tsx`, `new-chat-form.tsx`, `chat-input-area.tsx`, `active-chat.tsx`, atoms,
onboarding, `runtime-model-selector.tsx`, `provider-profile-editor.tsx`), ~19 surviving tests.

## Preconditions

- Verified on the maintainer's machine 2026-08-12: **zero** existing data for either runtime —
  `agent_jobs` holds 339 rows, all `runtime = 'codex'`; no `sub_chats` reference either runtime;
  neither `{userData}/kun-cli-settings.json` nor `{userData}/runtime-feature-settings.json` exists.
  Locus has no other users. **No data migration is required**, and the legacy-value retention this
  change would otherwise need is deliberately skipped.

## Risks

- **Substring collisions.** `agent-chat-provider.ts:84-86` infers a provider with
  `normalizedModel.includes("kun")` — a substring match that any future model id containing "kun"
  would hit. Its array entry (`:5`), its `normalizeAgentChatProvider` case (`:23`) and this
  inference must be removed as one atomic edit, or `inferAgentChatProviderFromMessages` returns a
  string no longer in the type and the sub-chat routes nowhere.
- **Provider profiles seeded `kun` in all 13 presets.** `storage.ts:409` throws
  `"Kun runtime is disabled. Select another provider target."` whenever normalized targets are
  empty — exactly what a legacy kun-only profile now produces. The message must be rewritten
  target-agnostically in the same commit that removes the gate.
- **i18n cannot be split across commits.** `TranslationKey = keyof typeof en` and `zhCN` is
  `Partial<Record<TranslationKey, string>>`, so deleting an `en` key without its `zhCN` twin is a
  hard TS error, and the reverse silently falls back to English. All 308 definitions land together.
- **Source-text assertions throw, not fail.** `agent-runtime-registry.test.ts:304-305`,
  `provider-routing-ux.test.ts:51-54`, `agent-guard-runtime-pipeline.test.ts:185-186` and
  `onboarding-derived-status.test.ts:108-119` `readFileSync` files being deleted; they produce
  ENOENT crashes rather than clean assertion failures. Rewrite them before deleting their targets.
- **The qwen smoke gate is on the main test path.** `tests/proof-evidence-gates.test.ts` spawns
  `scripts/check-qwen-acp-smoke-evidence.mjs` and asserts 11 literal substrings of its source.
  Neutralize the gate first or `bun test` fails with an unhandled ENOENT.
- **`{userData}/runtimes/kun/`** may hold hundreds of MB of downloaded third-party binary. Left
  untouched it is orphaned forever; a one-time startup sweep is included in tasks.
- **First REMOVED delta in this repo.** A census of all 109 changes found 125 `ADDED`, 49
  `MODIFIED`, **0 `REMOVED`**. The format is specified at `openspec/AGENTS.md:191-195` but has never
  been exercised here, so `openspec validate --strict` behaviour on it is unproven — validate early.
