# Project Context

## Purpose
**Locus** is a local-first Electron workbench and embeddable interoperability
layer over mature coding Harnesses. It gives Claude Code and Codex a
Locus-owned execution, session, capability, audit, and explicit Handoff boundary
without implementing a new general Agent loop. The desktop app is the visible
control plane; CLI, daemon, schedules, and versioned local APIs are consumer
surfaces over the same canonical owners. Domain applications keep their own
Goal/Task business models.

Future direction is constrained by the ratified Harness strategy and C1–C9
interoperability contract. Those documents do not authorize implementation;
current truth remains checked-in code plus `openspec/specs/`, and each slice
requires its own approved change.

## Tech Stack
| Layer | Tech |
|-------|------|
| Desktop | Electron ~39.4.0, electron-vite, electron-builder |
| UI | React 19, TypeScript 5.4.5, Tailwind CSS |
| Components | Radix UI, Lucide icons, Motion, Sonner |
| State | Jotai, Zustand, React Query |
| Backend | tRPC, Drizzle ORM, better-sqlite3 |
| AI | @anthropic-ai/claude-agent-sdk, bundled Claude Code and Codex runtime integrations |
| Package Manager | bun |

## Project Conventions

### Code Style
- Components: PascalCase (`ActiveChat.tsx`, `AgentsSidebar.tsx`)
- Utilities/hooks: camelCase (`useFileUpload.ts`, `formatters.ts`)
- Stores: kebab-case (`sub-chat-store.ts`, `agent-chat-store.ts`)
- Atoms: camelCase with `Atom` suffix (`selectedAgentChatIdAtom`)
- Simplicity over complexity - don't overcomplicate things

### Architecture Patterns
- **IPC Communication**: tRPC with `trpc-electron` for type-safe main↔renderer communication
- **State Management**:
  - Jotai: UI state (selected chat, sidebar open, preview settings)
  - Zustand: Sub-chat tabs and pinned state (persisted to localStorage)
  - React Query: Server state via tRPC (auto-caching, refetch)
- **Database**: Drizzle ORM with SQLite, auto-migration on app startup
- **Claude Integration**: Dynamic import of `@anthropic-ai/claude-agent-sdk` with two modes: "plan" (read-only) and "agent" (full permissions). The `@anthropic-ai/claude-code` package name refers to the Claude Code CLI install surface, not the SDK dependency used by desktop chat.

### Testing Strategy
- Isolated Bun tests under `tests/`, plus change-specific manual/packaged smoke
- `bun run check:full` is the aggregate local/CI gate
- Each change records exact-SHA verification and fresh independent review in `verification.md`

### Git Workflow
- Main branch: `main`
- One bounded approved change per feature branch/worktree
- Local commits are allowed; remote push/PR/merge/release/rules changes require explicit Owner authorization
- Codex implementation and fresh-context Claude Code review must agree on the same exact source SHA before Owner acceptance

## Domain Context
- **Project / Workspace / Chat**: A Project is a local repository; a Workspace is the current worktree-backed storage unit; a Chat is the user-facing conversational unit
- **Conversation / SessionBinding / Run / Interaction / Handoff**: Ratified cross-change core semantics for future interoperability work; exact storage and public fields belong to implementing changes
- **Engine / Runtime**: UI calls Claude Code and Codex Engines; APIs use stable `runtimeId`; Agent remains reserved for persona
- **Tool Execution**: Real-time display of Claude's tool execution (bash, file edits, web search)
- **Session Resume**: Sessions can be resumed via `sessionId` stored in SubChat

## Important Constraints
- Local-first: All data stored locally in SQLite (`{userData}/data/agents.db`)
- Auth via OAuth with encrypted credential storage (safeStorage)
- macOS notarization required for public releases
- Internal macOS/Windows test builds may be unsigned or ad-hoc signed if the limitation is documented for testers
- Dev vs Production use separate userData paths and protocols
- No ungoverned old/new duplicate business path; internal owners are replaced atomically
- Public/versioned changes require Consumer Impact and an explicit Owner compatibility decision

## External Dependencies
- **Claude Agent SDK**: `@anthropic-ai/claude-agent-sdk` for desktop chat AI interactions
- **Claude Code CLI**: `@anthropic-ai/claude-code` for the local CLI install surface
- **Manual Release Check**: Optional fork-owned GitHub Releases latest endpoint configured with `LOCUS_RELEASES_REPO` or `MAIN_VITE_RELEASES_REPO`
- **OAuth Provider**: Optional hosted authentication flow configured with `MAIN_VITE_API_URL`
