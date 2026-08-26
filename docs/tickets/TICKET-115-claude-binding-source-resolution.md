# TICKET-115 — Claude binding source resolution and divert UX

## Status

待设计 / 未授权实施（Foundation 1b W7 Yellow follow-up）。

## Context

`add-chat-session-binding` makes the database binding the durable truth for an
existing Chat. Claude source availability is still pre-resolved in the renderer
through `normalizeClaudeModelSourceForRun`, while the transport may divert an
unusable OAuth source to a Provider Profile for one send. Foundation 1b
deliberately makes that divert **run-scoped only**: it must not silently rewrite
the persisted binding merely because credentials or runtime availability changed.

## Design questions

- Whether source pre-resolution should move to a main-process owner, and which
  existing provider/runtime owner should supply its non-secret availability data.
- Whether a run-scoped divert should remain ephemeral, require explicit user
  confirmation before rebinding, or be shown as a standing UI diagnostic.
- How explicit user selection, unavailable saved profiles, OAuth recovery, and
  new-chat defaults interact without creating a second binding truth.

## Out of scope until approved

- Persisting an OAuth/provider fallback automatically.
- Moving `normalizeClaudeModelSourceForRun` into main as an incidental refactor.
- Adding binding lifecycle, installation pins, leases, or public Local Job API
  fields.

## Acceptance outline for a future approved change

- One named source-resolution owner and no renderer/main duplicate rules.
- Existing bindings never change because availability changed unless the user
  explicitly approves the rebind.
- Run events expose a redacted, non-secret explanation when effective source and
  persisted source differ.
- Tests cover OAuth loss/recovery, profile removal, explicit rebind, restart, and
  default changes without rebinding existing Chats.
