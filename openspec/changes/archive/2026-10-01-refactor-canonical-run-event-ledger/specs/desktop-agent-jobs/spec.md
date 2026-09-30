## MODIFIED Requirements

### Requirement: Desktop Jobs Persist Semantic Runtime Events
Desktop chat jobs SHALL persist sanitized committed semantic events for Workbench
replay through the shared ledger. Desktop projection SHALL read committed item state
and sequence without reconstructing a second fact chain from provider chunks.

#### Scenario: Desktop stream emits semantic events
- **WHEN** the fake Claude/Codex desktop job fixture `desktop-projection.json` delivers
  committed assistant/tool/guard/question/MCP/usage/status/error/completed records
- **THEN** the Workbench persisted-event reader and live renderer projector receive
  those record sequences and semantic metadata without a raw chunk list
- **AND** the renderer uses the fixture's item_reconciliation record to replace that
  item's view instead of concatenating its final text again

#### Scenario: Secret-like payload is observed
- **WHEN** `desktop-projection.json` contains already-redacted runtime diagnostics,
  MCP and provider metadata and a sentinel raw input available only to ingress
- **THEN** the desktop writer and renderer receive the committed redacted record only;
  neither projection is passed the raw sentinel input or exact secret hints
- **AND** ledger_version=1 replay uses record sequence directly; the single versioned
  Workbench decoder unwraps ledger_version=0 historical desktop rows only, preserving
  their semantic display without restoring a live wrapper writer
