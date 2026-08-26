# TICKET-121 — Skill registry Electron boundary contraction

## Status

待设计 / 未授权实施（Foundation 1c Yellow follow-up；2026-08-27）。

## Context

The post-1a/1b one-hop architecture scan found that guarded Codex runtime code imports
`src/main/lib/skills/registry.ts`, which directly imports Electron while also consuming the
existing `electron-app` helper. Foundation 1c records `skills/registry` in the initial
wrapper registry; it does not change skill discovery, installation, or runtime projection.

Tracked contraction file: `src/main/lib/skills/registry.ts`.

## Required future design

- Make the canonical `electron-app` owner or an injected main-process dependency the sole
  source of app/user-data paths needed by the registry.
- Preserve registry integrity checks, local-only policy, managed-state ownership, and
  runtime projection behavior.
- Remove `skills/registry` from `reachThroughWrappers` in the same change that removes its
  direct Electron import.

## Out of scope until approved

- Changing remote registry policy, skill installation semantics, or trust decisions.
- Moving filesystem/native ownership into renderer code.
- Performing this cleanup inside Foundation 1c.

## Acceptance outline for a future approved change

- `src/main/lib/skills/registry.ts` has no direct Electron import.
- Skill registry and runtime-native activation suites remain green.
- The architecture baseline and OWNERSHIP_MAP mirror delete `skills/registry` with no new
  wrapper entry.
