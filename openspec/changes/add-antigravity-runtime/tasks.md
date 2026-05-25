## 1. Specification
- [x] 1.1 Review active command-guide and provider-profile changes for runtime terminology conflicts.
- [x] 1.2 Add `agent-runtimes` requirements for Antigravity detection, launch, and security boundaries.
- [x] 1.3 Validate the change with `bunx openspec validate add-antigravity-runtime --strict --no-interactive`.

## 2. Shared Runtime Model
- [ ] 2.1 Add shared runtime/provider ids for `claude-code`, `codex`, and `antigravity`.
- [ ] 2.2 Add a narrower persisted-chat runtime type for transports that can stream into Locus today.
- [ ] 2.3 Replace local string unions in renderer inputs, auth retry, model selector, MCP/settings surfaces, and main command-guide types where appropriate.

## 3. Sub-chat Runtime Persistence
- [ ] 3.1 Add a SQLite migration and schema field for sub-chat runtime selection.
- [ ] 3.2 Read/write runtime selection when creating, forking, continuing, and switching empty sub-chats.
- [ ] 3.3 Keep message-metadata inference only as a fallback for legacy sub-chats without a runtime field.

## 4. Runtime Detection
- [ ] 4.1 Add a main-process Antigravity runtime resolver that discovers `agy` from shell PATH and records safe status metadata.
- [ ] 4.2 Probe version/help output with timeouts and terminal-control stripping.
- [ ] 4.3 Return sanitized runtime metadata through tRPC; do not expose credential or keyring data.

## 5. Command Guide
- [ ] 5.1 Extend runtime command-guide types to include Antigravity CLI.
- [ ] 5.2 Show Antigravity status, executable path, version, docs links, and unavailable/install guidance in Settings > Commands.
- [ ] 5.3 Keep Antigravity CLI commands labeled as runtime commands, not Locus chat slash commands.

## 6. Project Launch
- [ ] 6.1 Add a project/worktree-scoped launch action that starts `agy` in the existing terminal context.
- [ ] 6.2 Extend terminal tab state so a newly created Antigravity terminal can carry its own launch command.
- [ ] 6.3 Preserve the active project/worktree `cwd` and do not persist Antigravity TUI output as Locus chat messages.
- [ ] 6.4 Show clear errors when `agy` is missing, not executable, or exits immediately.

## 7. UI and Settings
- [ ] 7.1 Add renderer-safe runtime labels/icons/copy for Google Antigravity.
- [ ] 7.2 Update the chat/model selector to show Antigravity as a runtime action, while keeping model sources scoped to Claude/Codex.
- [ ] 7.3 Add Settings > Models or runtime status copy that explains Antigravity auth is owned by `agy`.
- [ ] 7.4 Keep MCP, Skills, Plugins, and Usage tabs scoped to existing Claude/Codex behavior unless Antigravity-specific read-only discovery is explicitly implemented.

## 8. Verification
- [ ] 8.1 Add targeted tests for runtime detection parsing and missing-executable handling.
- [ ] 8.2 Add targeted tests for sub-chat runtime persistence/fallback behavior if schema changes are implemented.
- [ ] 8.3 Run `bun run ts:check`.
- [ ] 8.4 Run `git diff --check`.
- [ ] 8.5 Smoke the Settings > Commands and terminal-launch flow locally.
