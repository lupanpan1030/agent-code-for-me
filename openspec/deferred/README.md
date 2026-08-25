# Deferred OpenSpec Proposals

This directory contains parked proposals that are deliberately outside the
active implementation queue. Their spec deltas are not current product truth
and must not be applied while they remain here.

To resume one, move or recreate it under `openspec/changes/<change-id>`, compare
it with current code/specs and overlapping changes, run strict validation, and
obtain a new explicit Owner approval before implementation.

| Original change ID | Deferred | Reason | Reopen only when |
| --- | --- | --- | --- |
| `add-agent-native-projection-writes` | 2026-06-22 | Runtime-native Agent write ownership, drift, rollback, and proven native primitives are not ready. | The read-only Agent Builder is stable; a target Runtime has a stable primitive and smoke evidence; import/duplicate/drift/rollback UX is approved; the first target is a Locus-managed isolated Runtime home. |
| `add-policy-grant-scope-enforcement` | 2026-06-16 | Current policy-grant scopes are intentionally admission/audit metadata; no real consumer yet requires declared-scope-bound app-server execution. | A first-party consumer demonstrates the need, batch execution cannot serve it, and the scope vocabulary/reuse decision is based on that concrete contract. |
