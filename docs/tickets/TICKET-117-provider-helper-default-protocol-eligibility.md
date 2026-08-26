# TICKET-117 — Provider helper default protocol eligibility

## Status

待设计 / 未授权实施（Foundation 1b review follow-up；2026-08-26）。

## Context

Provider Profile storage currently treats the `helpers` target as sufficient for the
`sub_chat_title` and `commit_message` defaults. The utility chat-completion owner, however,
only consumes a selected Profile when its protocol is `openai-chat`; other protocols fall
through to the legacy local helper configuration. A Profile can therefore appear eligible in
Settings and persist as the default while not being the Profile that actually executes.

Foundation 1b only makes chat-session binding durable. Changing helper protocol support or
default eligibility would alter an existing non-chat execution path, so it is recorded rather
than implemented here.

## Required future design

- Define helper eligibility as an explicit capability, including its supported protocol set.
- Decide whether `anthropic` and `openai-responses` helper Profiles are rejected or translated
  by a canonical main-process owner.
- Make Settings affordances, storage admission, runtime resolution, and diagnostics use the
  same eligibility rule.
- Replace silent legacy fallback for an explicitly selected but ineligible Profile with an
  intentional, non-secret diagnostic or a documented fallback policy.

## Out of scope until approved

- Treating every `helpers` target as `openai-chat` compatible.
- Adding protocol translation inside renderer code.
- Changing Local Job, title generation, or commit-message public behavior during 1b.

## Acceptance outline for a future approved change

- One canonical eligibility function is shared by Settings, storage, and execution.
- An ineligible Profile cannot be persisted or presented as an active helper default.
- The selected Profile either executes or fails explicitly; it never silently resolves to a
  different credential/configuration path.
- Tests cover each supported protocol and legacy fallback behavior.
