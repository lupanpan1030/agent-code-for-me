# Antigravity CLI Repository Scan

## Bottom Line
This is a bottom-layer change, not just a new dropdown option. Today Locus has two persisted chat transports:

- Claude Code goes through `IPCChatTransport` -> `trpc.claude.chat` -> `@anthropic-ai/claude-agent-sdk`.
- Codex goes through `ACPChatTransport` -> `trpc.codex.chat` -> `codex-acp` plus the AI SDK stream pipeline.

Antigravity CLI currently documents a terminal-first `agy` TUI with its own auth, config, plugins, MCP, skills, subagents, slash commands, and sandbox controls. The safe full integration is therefore:

- Model `antigravity` as a first-class runtime id everywhere the product chooses an agent runtime.
- Keep persisted Locus chat streaming limited to runtimes that have a stable machine-readable transport.
- Make Antigravity terminal-backed from the active project/worktree until `agy` exposes a stable SDK, ACP adapter, stream-json mode, or equivalent non-TUI protocol.

Trying to parse the TUI as chat chunks would make cancellation, approval, message persistence, and resume behavior unreliable.

## External Runtime Facts Checked
- Google now positions Antigravity CLI as the successor path for most Gemini CLI consumer workflows.
- The current CLI executable is documented as `agy`.
- Installation is external to Locus and is documented by Google through shell/PowerShell install commands.
- Antigravity CLI config is documented under `~/.gemini/antigravity-cli/settings.json`.
- Antigravity plugins are documented under `~/.gemini/antigravity-cli/plugins/<plugin_name>/`.
- Public docs describe interactive slash-command surfaces such as `/config`, `/settings`, `/permissions`, `/model`, `/tasks`, `/skills`, `/mcp`, `/usage`, and `/logout`.

Local machine check: neither `agy` nor `antigravity` is currently on this Mac's PATH, so implementation must handle a missing runtime cleanly.

## Current Architecture Findings

### 1. Shared Provider/Runtime Types
Important files:

- `src/renderer/features/agents/components/agent-model-selector.tsx`
- `src/renderer/features/agents/atoms/index.ts`
- `src/renderer/features/agents/main/chat-input-area.tsx`
- `src/renderer/features/agents/hooks/use-auth-retry.ts`
- `src/main/lib/trpc/routers/commands.ts`
- `src/renderer/components/dialogs/settings-tabs/agents-command-guide-tab.tsx`

Current state:

- `AgentProviderId` is local to the model selector and equals `"claude-code" | "codex"`.
- `lastSelectedAgentIdAtom` is `atomWithStorage<string>`, so invalid values can persist without type protection.
- `PendingAuthRetryMessage.provider`, `ChatInputArea.provider`, provider change callbacks, and command-guide runtime types hard-code Claude/Codex.

Required change:

- Add a shared runtime id type, probably in `src/shared/agent-runtime-types.ts`:
  - `AgentRuntimeId = "claude-code" | "codex" | "antigravity"`
  - `PersistedChatRuntimeId = "claude-code" | "codex"`
- Import it into renderer/main files instead of repeating local unions.
- Make every surface choose one of:
  - full runtime id if it can show or launch Antigravity,
  - persisted-chat runtime id if it can only stream Claude/Codex messages.

### 2. Chat Transport Boundary
Important files:

- `src/renderer/features/agents/lib/ipc-chat-transport.ts`
- `src/renderer/features/agents/lib/acp-chat-transport.ts`
- `src/main/lib/trpc/routers/claude.ts`
- `src/main/lib/trpc/routers/codex.ts`
- `src/main/lib/trpc/routers/index.ts`

Current state:

- Claude streams through `trpcClient.claude.chat.subscribe`.
- Codex streams through `trpcClient.codex.chat.subscribe`.
- `ACPChatTransportConfig.provider` is fixed to `"codex"`.
- `codexRouter` owns ACP provider sessions, cancellation, auth retry, MCP resolution, message persistence, usage polling, and cleanup.
- `claudeRouter` owns Claude SDK invocation, OAuth/provider env wiring, tool approval, message persistence, and session resume.

Required change:

- Do not generalize `ACPChatTransport` to Antigravity unless Antigravity has an ACP-compatible binary or SDK.
- Add an Antigravity runtime router for status/launch metadata, not a fake `chat` subscription.
- If a future machine-readable transport appears, implement a separate `AntigravityChatTransport` with explicit normalization for:
  - session id and resume,
  - cancellation,
  - tool approvals,
  - image/file input,
  - usage metadata,
  - persisted message format,
  - auth failures.

### 3. Sub-chat Runtime Persistence
Important files:

- `src/main/lib/db/schema/index.ts`
- `drizzle/*`
- `src/main/lib/trpc/routers/chats.ts`
- `src/renderer/features/agents/main/active-chat.tsx`
- `src/renderer/features/agents/stores/sub-chat-store.ts`

Current state:

- `sub_chats` stores `session_id`, `stream_id`, `mode`, and `messages`, but no provider/runtime.
- The active provider is inferred by scanning persisted message metadata for model names containing `codex` or starting with `gpt-`.
- Empty sub-chat provider switching is held in volatile React state: `subChatProviderOverrides`.

Required change:

- Add `runtime` or `provider` to `sub_chats`.
- Update create/fork/continue flows to write the selected runtime.
- Keep existing model-string inference only for legacy rows where the runtime field is null.
- This matters more with Antigravity because a terminal-backed Antigravity sub-chat may have zero Locus messages, so message inference cannot work.

### 4. Renderer Provider Selection
Important files:

- `src/renderer/features/agents/main/active-chat.tsx`
- `src/renderer/features/agents/main/new-chat-form.tsx`
- `src/renderer/features/agents/main/chat-input-area.tsx`
- `src/renderer/features/agents/components/agent-model-selector.tsx`

Current state:

- `active-chat.tsx` selects between `IPCChatTransport` and `ACPChatTransport`.
- `handleProviderChange`, `handleContinueWithProvider`, `inferProviderFromMessages`, and `subChatProviderOverrides` are Claude/Codex only.
- `new-chat-form.tsx` casts the selected agent id to `"claude-code" | "codex"`.
- The model selector is really both a runtime selector and model selector, but its groups are model-source oriented.

Required change:

- Show Antigravity as a runtime action, not a model source.
- For empty sub-chats, selecting Antigravity should persist `runtime = "antigravity"` and switch the input surface into a launch state.
- For existing Claude/Codex chats, continuing with Antigravity should create a new sub-chat, attach/export prior history as context if useful, and open `agy` in terminal rather than using a chat stream.
- Avoid silently falling back to Claude when `antigravity` is selected.

### 5. Terminal Launch Infrastructure
Important files:

- `src/main/lib/trpc/routers/terminal.ts`
- `src/main/lib/terminal/manager.ts`
- `src/main/lib/terminal/session.ts`
- `src/renderer/features/terminal/terminal-sidebar.tsx`
- `src/renderer/features/terminal/types.ts`
- `src/renderer/features/agents/main/active-chat.tsx`

Current state:

- Terminal sessions launch the user's shell through node-pty.
- `initialCommands` are typed into the shell after the first terminal data event and joined with `&&`.
- `TerminalInstance` only stores `id`, `paneId`, `name`, and `createdAt`.
- `TerminalSidebar` accepts one `initialCommands` prop for the rendered terminal area, not per created terminal tab.

Required change:

- Add per-terminal launch metadata, for example `initialCommands?: string[]` or a safer structured command form on `TerminalInstance`.
- Prefer a shell-escaped absolute `agy` path from the main-process resolver.
- Create a named terminal tab such as `Antigravity` without re-running `agy` in every existing terminal.
- Preserve `cwd = worktreePath` or project path.

Risk:

- The existing `initialCommands.join(" && ")` is fine for simple boot commands, but risky for arbitrary command construction. Use a single shell-escaped executable command for `agy`, or introduce structured PTY command launch if this grows.

### 6. Command Guide
Important files:

- `src/main/lib/trpc/routers/commands.ts`
- `src/renderer/components/dialogs/settings-tabs/agents-command-guide-tab.tsx`
- `src/renderer/lib/i18n/dictionaries.ts`

Current state:

- Runtime command-guide types only include `"claude-code" | "codex"`.
- Local runtime probing already uses `--help` and `--version` with timeouts.
- Official docs snapshots include Claude and Codex sources only.

Required change:

- Add `antigravity` runtime guide metadata.
- Add official docs links to Antigravity CLI getting started, using, features, and migration docs.
- Keep local `agy --help` output labeled as local runtime reference, not Locus chat slash commands.
- If official docs parsing is not stable, use `index-only` or a small link card rather than storing a copied manual.

### 7. Settings: MCP, Skills, Plugins, Usage
Important files:

- `src/renderer/components/dialogs/settings-tabs/agents-mcp-tab.tsx`
- `src/renderer/components/dialogs/settings-tabs/agents-skills-tab.tsx`
- `src/main/lib/skills/registry.ts`
- `src/main/lib/trpc/routers/skills.ts`
- `src/main/lib/plugins/index.ts`
- `src/main/lib/trpc/routers/plugins.ts`
- `src/renderer/components/dialogs/settings-tabs/agents-plugins-tab.tsx`
- `src/renderer/features/sidebar/usage-popover.tsx`

Current state:

- MCP settings are Claude/Codex specific and call `trpc.claude.*` or `trpc.codex.*`.
- Skills support `"claude" | "codex"` and paths `~/.claude/skills`, `~/.codex/skills`.
- Plugins support `"claude" | "codex"` and paths `~/.claude/plugins/marketplaces`, `~/.codex/plugins/cache`.
- Usage only shows local observed usage plus Claude/Codex account status links.

Required change for this feature:

- Do not add Antigravity MCP/skills/plugins management until the file formats and ownership are implemented deliberately.
- If shown, add only a read-only runtime status note that Antigravity manages these through `agy` and its own config path.
- Do not read or write Antigravity keyring/auth state.

Future change:

- Add read-only discovery for `~/.gemini/antigravity-cli/plugins`.
- Add Antigravity skills/MCP panels only after deciding whether Locus should inspect Antigravity's JSON config directly or delegate users to `/skills` and `/mcp` in `agy`.

### 8. Packaging and Runtime Installation
Important files:

- `package.json`
- `scripts/download-claude-binary.mjs`
- `scripts/download-codex-binary.mjs`
- `src/main/lib/runtime-executable.ts`

Current state:

- Claude and Codex binaries are bundled/downloaded by project scripts.
- Codex also bundles `@zed-industries/codex-acp` packages in `asarUnpack`.
- Antigravity CLI has no existing package, downloader, or bundled resource.

Required change:

- Do not bundle Antigravity CLI in the first implementation.
- Detect user-installed `agy` and provide setup guidance.
- Any auto-install/download flow should be a separate security/release proposal because it would fetch and execute provider-owned installers.

### 9. Tests and Verification
Existing tests:

- `tests/builtin-commands.test.ts`
- `tests/provider-profile-transforms.test.ts`
- `tests/i18n-dictionary.test.ts`
- `tests/app-update.test.ts`
- `tests/local-only.test.ts`
- `tests/worktree-config.test.ts`

Required tests:

- Runtime resolver returns unavailable status when `agy` is missing.
- Help/version parsing strips control characters and times out safely.
- Sub-chat runtime selection persists and legacy fallback still works.
- i18n dictionary completeness after adding Antigravity copy.

Manual smoke:

- Settings > Commands shows Claude, Codex, and Antigravity status.
- Missing `agy` shows install/setup guidance without breaking Claude/Codex.
- With `agy` installed, launching Antigravity opens a terminal in the active worktree.

## Proposed Implementation Order
1. Shared runtime types and compile-time cleanup.
2. Database runtime column and legacy fallback.
3. Antigravity resolver/router.
4. Command Guide status and docs card.
5. Terminal launch metadata and Antigravity terminal action.
6. Chat/model selector UI adjustments.
7. Tests, typecheck, and smoke.

## Explicit Cut Lines
- No fake chat transport over raw TUI output.
- No Antigravity credential import.
- No automatic installer in this change.
- No Antigravity plugin/MCP/skills write support in this change.
- No migration of Gemini CLI extensions inside Locus; users can use `agy`'s own migration tooling.
