## MODIFIED Requirements

### Requirement: Headless Runtime Event Convergence
Headless jobs SHALL use the ledger in the Run's host process (CLI/daemon or Electron
host as applicable) through a thin observer ingress adapter. Codex app-server's committed
records SHALL be consumed directly without suppressing completed or appending a second
copy; coarse Claude/Codex exec output SHALL enter the same owner as observations.

#### Scenario: Batch process event is persisted
- **WHEN** `headless-projection.json` drives the coarse observer and app-server committed
  event consumer with recording ledger/store ports
- **THEN** coarse assistant/command/status/error/result input invokes ledger ingress,
  while committed app-server records retain their original sequence and completed
- **AND** the persisted reader contains each committed record once; the headless wrapper
  performs no raw store append or extra terminal mint

#### Scenario: Existing event readers remain compatible
- **WHEN** jobs logs reads the headless fixture and runs events reads its separate
  source=api fixture from `headless-projection.json`
- **THEN** each returns the documented envelope in sequence; v1 has bare semantic payload
  while the internal reader retains record metadata
- **AND** neither reader requires provider chunks or desktop wrapper interpretation
