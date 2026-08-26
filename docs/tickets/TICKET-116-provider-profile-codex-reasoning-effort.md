# TICKET-116 — Provider Profile Codex reasoning effort and protocol translation

## Status

待设计 / 未授权实施（Foundation 1b W7 Yellow follow-up；Owner 2026-08-26 确认）。

## Context

Foundation 1b makes Chat Session Binding the durable source of truth. The current Codex
Provider Profile gateway advertises only `supported_reasoning_levels = [none]` and the ACP
transport submits the profile model with `/none`. Capability honesty therefore requires 1b to
persist `thinkingLevel = NULL` for Provider Profile bindings and hide the effort selector.

The deferred option is to make Provider Profiles genuinely support selectable reasoning
effort. It must not be implemented by merely forwarding low/medium/high/xhigh: different
upstream protocols and providers express or support reasoning differently.

## Required future design

- Add an explicit Provider Profile capability declaration for supported reasoning efforts;
  absence remains fail-closed as `none` only.
- Define per-protocol translation from Locus effort values to each supported upstream request
  shape, including validation and unsupported-value errors.
- Make the gateway model catalog advertise only the efforts that the selected profile and
  protocol can actually honor.
- Decide how profile capability changes affect an existing persisted binding without silently
  rebinding it or creating a second runtime truth.
- Keep provider-specific request details in the gateway/provider owner; renderer and transport
  consume only the redacted capability result.

## Out of scope until approved

- Advertising low/medium/high/xhigh for every Provider Profile by default.
- Translating effort in the renderer or ACP transport.
- Persisting a non-null thinking level for a profile whose gateway declares only `none`.
- Guessing support from model names or message metadata.

## Acceptance outline for a future approved change

- Capability declarations are explicit, validated, and protocol-specific.
- Gateway catalog and actual upstream request translation agree for every advertised effort.
- Unsupported efforts fail before provider execution with a non-secret diagnostic.
- Chat binding, UI selector, gateway catalog, and executed request remain consistent across
  create, update, restart, profile edits, and provider failure.
- Tests cover at least one supported and one unsupported protocol/profile combination and
  prove no fallback silently changes the persisted binding.
