# TICKET-119 — Chat attachments Electron boundary contraction

## Status

待设计 / 未授权实施（Foundation 1c Yellow follow-up；2026-08-27）。

## Context

The post-1a/1b one-hop architecture scan found that guarded Claude runtime code imports
`src/main/lib/chat-attachments.ts`, which directly imports `electron` to resolve the app
user-data directory. Foundation 1c records `chat-attachments` in the first
`reachThroughWrappers` registry freeze so new reach-through growth is blocked, but it does
not change attachment behavior or product code.

Tracked contraction file: `src/main/lib/chat-attachments.ts`.

## Required future design

- Move Electron app/user-data resolution behind the canonical `electron-app` owner or an
  explicitly injected main-process dependency.
- Keep attachment limits, opaque refs, storage-root containment, cleanup, and runtime input
  behavior unchanged.
- Remove `chat-attachments` from `reachThroughWrappers` in the same change that removes its
  direct Electron import; the ratchet must demand that shrink.

## Out of scope until approved

- Moving attachment storage into renderer or preload code.
- Changing attachment paths, limits, accepted media types, or persisted message contracts.
- Performing this cleanup inside Foundation 1c.

## Acceptance outline for a future approved change

- `src/main/lib/chat-attachments.ts` has no direct Electron import.
- Existing attachment security and behavior suites remain green.
- The architecture baseline and OWNERSHIP_MAP wrapper mirror both delete
  `chat-attachments`; no replacement wrapper is added.
