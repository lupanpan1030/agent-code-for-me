# TICKET-120 — MCP auth boundary extraction

## Status

待设计 / 未授权实施（Foundation 1c Yellow follow-up；2026-08-27）。

## Context

The post-1a/1b one-hop architecture scan found that guarded Runtime MCP modules reach
through `src/main/lib/mcp-auth.ts`. That file directly imports Electron `BrowserWindow` and
also reverse-imports `src/main/lib/trpc/routers/claude-settings`. Foundation 1c freezes the
existing `mcp-auth` wrapper and reverse-direction findings; it does not relocate auth,
window notification, or Claude settings behavior.

Tracked contraction file: `src/main/lib/mcp-auth.ts`.

## Required future design

- Separate durable MCP OAuth/token behavior from Electron window notification.
- Move the Claude plugin/settings reads to a canonical main-process lib owner consumed by
  both the route and MCP auth code.
- Preserve secret redaction, token storage, local-only enforcement, OAuth metadata handling,
  and renderer-safe notifications.
- Remove `mcp-auth` from `reachThroughWrappers` and its router import from
  `reverseDirectionImports` only when both dependencies are actually gone.

## Out of scope until approved

- Duplicating Claude settings helpers outside their canonical owner.
- Sending OAuth tokens or provider secrets to the renderer.
- Altering MCP auth UX or implementing this extraction inside Foundation 1c.

## Acceptance outline for a future approved change

- `src/main/lib/mcp-auth.ts` directly imports neither Electron nor any tRPC router.
- Routes and guarded runtime modules consume one canonical set of lib owners.
- MCP auth/security tests remain green and the two architecture baselines shrink without a
  replacement entry.
