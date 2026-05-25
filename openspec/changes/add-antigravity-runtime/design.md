## Context
Claude Code and Codex are already local runtime integrations, but their integration shapes differ. Claude is launched through its bundled runtime path and Codex uses `codex-acp` as the chat transport runtime while a bundled `codex` CLI supports login and local runtime operations.

Antigravity CLI is a terminal-first interactive agent (`agy`) with its own settings, auth, plugins, MCP servers, skills, subagents, and sandbox controls under the user's Antigravity/Gemini configuration directory. Its current public surface is a TUI-style CLI rather than a clearly documented chat transport protocol compatible with Locus' existing message-store pipeline.

## Goals
- Treat Antigravity CLI as a real local runtime, not as a model provider profile.
- Let users see whether `agy` is installed and launch it from the active project or worktree.
- Keep the first implementation small enough to validate locally on macOS and not destabilize Claude/Codex chat.
- Preserve local-first security boundaries: main process owns runtime probing and launch, renderer receives only safe metadata, and Locus does not read Google credentials.

## Non-Goals
- Do not bundle or auto-install Antigravity CLI in the first version.
- Do not migrate Gemini CLI extensions, skills, MCP servers, or Antigravity plugins.
- Do not parse Antigravity TUI output into persisted Locus chat messages.
- Do not expose Antigravity as a full chat provider until there is a stable machine-readable protocol, SDK, or PTY adapter design.
- Do not write to `~/.gemini/antigravity-cli/settings.json` except through explicit future settings work.

## Technical Decisions
- Add a runtime id such as `antigravity` to runtime metadata, but keep chat transport selection gated so only Claude Code and Codex remain selectable for persisted Locus chat runs in this first change.
- Resolve `agy` from the user's shell environment/PATH first, with an optional future configurable path if PATH discovery proves unreliable.
- Probe `agy --version` and safe help output with short timeouts, stripping terminal control characters before sending summaries to the renderer.
- Add Command Guide metadata for Antigravity using local detection plus official documentation links instead of copying full docs into the app.
- Launch Antigravity through the existing terminal infrastructure with the selected project/worktree as `cwd`, so the user gets the real CLI behavior and approval prompts.
- Store no Antigravity tokens in Locus. Authentication remains inside Antigravity CLI's own OS keyring/config flow.

## Open Questions
- Does `agy` provide a stable non-interactive mode or session protocol suitable for a future `AntigravityChatTransport`?
- Should packaged builds include an optional "Install Antigravity CLI" deep link, or should installation remain documentation-only?
- Should Antigravity plugins appear in Settings > Plugins as a third runtime after the launch MVP is validated?
