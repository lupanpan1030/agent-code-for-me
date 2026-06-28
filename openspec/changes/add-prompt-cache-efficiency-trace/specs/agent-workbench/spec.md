## ADDED Requirements

### Requirement: Prompt Cache Efficiency In Usage Trace
The Agent Workbench trace usage row SHALL surface prompt cache efficiency for a
run when the runtime reports cache token usage, derived from runtime-normalized
cache tokens over a runtime-consistent total input context that does not
double-count cached tokens, and SHALL omit the indicator when no cache data is
available without sending raw provider payloads to the renderer.

#### Scenario: Runtime reports cache token usage
- **WHEN** a desktop or job run reports input tokens together with cache-read and optional cache-creation token counts
- **THEN** the trace usage row SHALL show a prompt cache hit indicator equal to cache-read tokens divided by the run's total input context
- **AND** the total input context SHALL be computed per runtime so cached tokens are counted once and the ratio cannot exceed one
- **AND** a missing cache-creation count SHALL be treated as zero
- **AND** the indicator SHALL be derived from existing sanitized usage fields rather than raw provider responses

#### Scenario: Runtime input tokens include cached tokens
- **WHEN** a runtime reports input tokens that already include cached input tokens (rather than excluding them)
- **THEN** the trace usage presenter SHALL normalize the total input context so the cached portion is not added a second time
- **AND** an equivalent run SHALL produce the same cache hit ratio whether the runtime reports input tokens inclusive or exclusive of cached tokens

#### Scenario: Cache tokens are reported under a runtime-specific field
- **WHEN** a runtime reports cached input tokens under a runtime-specific field name rather than the shared cache-read field
- **THEN** the trace usage presenter SHALL normalize that runtime-specific cache token field into the shared cache token fields before deriving the indicator
- **AND** the indicator SHALL behave the same for that runtime as for a runtime that already reports the shared cache-read field

#### Scenario: Runtime does not report cache token usage
- **WHEN** a run reports no cache token counts, or has no input-token baseline to divide by
- **THEN** the trace usage row SHALL omit the cache efficiency indicator
- **AND** the absence of cache data SHALL NOT be presented as a zero ratio or a cache miss

#### Scenario: Cache efficiency stays renderer-safe
- **WHEN** the trace usage row renders cache efficiency
- **THEN** it SHALL show only derived token counts and the derived ratio
- **AND** it SHALL NOT expose raw provider usage payloads, tokens, or secrets
