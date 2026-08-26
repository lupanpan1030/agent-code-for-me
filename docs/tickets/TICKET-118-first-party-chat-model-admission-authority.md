# TICKET-118 — First-party chat model admission authority

## Status

待设计 / 未授权实施（Foundation 1b review follow-up；2026-08-26）。

## Context

Foundation 1b validates Provider Profile identity, target runtime, and non-empty model
snapshots in the main-process Chat Session Binding owner. First-party Codex models are more
complex: the renderer merges the remote catalog with models discovered from an app-managed
API key, while main currently has no single catalog snapshot authoritative for every window
and credential state.

Rejecting unknown first-party model IDs in 1b would either reject legitimate dynamic API-key
models or introduce another catalog owner. For now, the durable binding keeps the explicit
non-empty model snapshot and the selected first-party source; strict catalog admission is
deferred until authority and freshness semantics are designed.

## Required future design

- Choose the canonical main-process model-capability/catalog owner and its refresh lifecycle.
- Represent the source eligibility of remote-catalog and dynamically discovered API-key
  models without renderer-only inference.
- Define behavior for stale snapshots, offline startup, removed catalog entries, and multiple
  windows observing different refresh times.
- Keep Provider Profile model IDs opaque; this ticket must not constrain provider-defined
  identifiers to the first-party catalog.

## Out of scope until approved

- Hard-coding the current bundled catalog into Chat Session Binding admission.
- Rejecting dynamic API-key model IDs because they are absent from the remote catalog.
- Letting a credential probe silently substitute a different source or model.

## Acceptance outline for a future approved change

- Main owns one auditable catalog/capability snapshot used for binding admission.
- Renderer controls consume that same authority and cannot create a tuple main would reject.
- Source/model compatibility remains deterministic across restart and catalog refresh.
- Tests cover remote, dynamic API-key, stale, removed, and offline model cases.
