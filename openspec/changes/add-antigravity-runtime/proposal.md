# Change: Add Antigravity CLI runtime support

## Why
Locus already acts as a local desktop shell around coding-agent runtimes such as Claude Code and Codex. Google is moving Gemini CLI users toward Antigravity CLI, and users should be able to launch and inspect that local runtime from the same project/worktree context without pretending it is an API-only provider.

## What Changes
- Add Antigravity CLI as a third local agent runtime identity alongside Claude Code and Codex.
- Detect the local `agy` executable, version, configuration roots, and runtime availability without requiring network access.
- Surface Antigravity CLI in Settings > Commands with local status and official documentation links.
- Add a project/worktree-scoped launch path that opens Antigravity CLI in Locus' managed terminal context.
- Keep Antigravity CLI credentials and Google account state owned by Antigravity CLI; Locus does not import or expose those secrets.
- Defer full chat-message streaming integration until Antigravity exposes a stable non-TUI protocol or adapter boundary.

## Impact
- Affected specs: `agent-runtimes`
- Affected code: runtime executable detection, command guide router/UI, terminal launch flow, provider/runtime type unions, i18n copy, targeted tests
