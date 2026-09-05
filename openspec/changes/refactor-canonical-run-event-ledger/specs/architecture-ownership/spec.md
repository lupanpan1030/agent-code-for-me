## MODIFIED Requirements

### Requirement: Canonical Runtime Event Mapping Single Path

The architecture guard check SHALL enforce that each Run has exactly one
mapping, sequencing, reconciliation, terminal-decision, redaction, and
persistence path. The factory `createCanonicalRunEventLedger` SHALL be defined
and exported only by
`src/main/lib/agent-runtime/run-event-ledger.ts`; it is the canonical owner that
accepts native transport boundaries and system facts and assigns `sequence`.
`src/main/lib/agent-runtime/runtime-events.ts` SHALL remain the canonical
`RunEvent` envelope/type owner and the only definition/export owner of
`createRunEvent`. `src/main/lib/agent-runtime/redaction.ts` SHALL remain the
canonical redaction algorithm owner and the only definition/export owner of
`redactRuntimePayload`, `redactExactSecretHints`,
`createExactSecretStreamRedactor`, and
`createExactSecretStreamChannelRedactor`. The ledger SHALL own those
algorithms' per-Run/item/channel state and sanitized terminal flush. Neither
module nor any transport, adapter, route, projection, or store SHALL allocate a
competing Run sequence or terminal fact.

The Run constructor SHALL own canonical `runId`; event/internal/public `jobId`,
when present, SHALL only be its equal compatibility alias. Renderer, route,
adapter, scheduler, persistence, and projection modules SHALL NOT generate or
substitute another attempt identity. Retry construction SHALL create a new
ledger/new `runId` with source provenance rather than reopen the terminal owner.

`admitRunArtifactCandidate` SHALL be defined/exported only by
`src/main/lib/agent-runtime/run-artifacts.ts`, which SHALL be the only owner that
decides artifact eligibility, admits a manifest entry, or authorizes creation of
an `artifact_created` fact. Filesystem helpers MAY write or serialize an admitted
result and the job store MAY persist its supplied event, but an adapter,
dispatcher, route, mapper, projector, or store SHALL NOT mint one directly.

The legacy owner symbols `mapDesktopStreamChunkToRunEvents`,
`createDesktopStreamEventMapper`, `appendRunEventsToAgentJob`, and
`createAgentJobRunEvent`, plus the raw-chunk owners
`createRuntimeStreamChunkSecretRedactor`, `redactRendererDiagnosticChunk`,
`redactRendererRuntimeChunk`, and `createRuntimeRendererChunkEmitter`, SHALL be
removed in the same implementing change rather than retained as alternate fact
or redaction chains. Runtime-specific parsers MAY translate a native envelope
into typed ingestion input, and surface projectors MAY map an already sanitized
canonical event to a documented external envelope, but both SHALL call or
consume the ledger without allocating sequence, repeating redaction,
materializing output independently, or deciding completion.

The persisted event sink SHALL be owned by
`src/main/lib/headless/job-store.ts`, SHALL store the exact ledger-supplied
sequence and already-redacted payload, and SHALL keep its record-level insert
helper module-private. Its atomic `appendExact` operation SHALL be the durable
commit, high-water, and projection-obligation barrier before ingestion
acknowledgement or external fan-out. It SHALL NOT derive a new sequence, strip
the canonical envelope, or insert another `completed` event during job
finalization. Modules under `src/main/lib/trpc/routers/`, `src/main/lib/codex/`, and
`src/main/lib/claude/` SHALL NOT import the raw persisted-event write function;
they SHALL submit facts to the ledger or consume a ledger sink. Direct importers
of any raw write function SHALL be limited to a frozen allowlist that may only
shrink.

During implementation only, the `canonicalRunEventLedgerV1` migration gate MAY
select the ledger or legacy path once per Run; shadow writes and per-event path
selection are forbidden. Before implementation verification and Owner
acceptance, the gate, legacy sequence/terminal paths, and their allowlist entries
SHALL be deleted so the delivered product has one unconditional owner.

#### Scenario: Second event mapping definition appears

- **WHEN** the event single-path architecture test scans a synthetic fixture
  that defines or re-exports `createCanonicalRunEventLedger` outside
  `run-event-ledger.ts`, defines/re-exports `createRunEvent` outside
  `runtime-events.ts`, defines/re-exports a preserved redaction symbol outside
  `redaction.ts`, retains a legacy owner symbol, or allocates Run sequence or
  terminal state outside the ledger
- **THEN** the architecture guard check fails, naming the offending file,
  symbol, or ownership behavior
- **AND** the failure message points to the ownership map's "Runtime Events,
  Trace, And Redaction" section and the canonical ledger owner
- **AND** the corresponding clean fixture containing one ledger factory and
  stateless native/projector adapters passes

#### Scenario: Route or runtime adapter writes job events directly

- **WHEN** the architecture test fixture has a file under
  `src/main/lib/trpc/routers/`, `src/main/lib/codex/`, or
  `src/main/lib/claude/` import a raw persisted-event writer, or has a file
  outside the frozen allowlist import it, renumber a ledger event, strip its
  envelope, or mint a second completion
- **THEN** the architecture guard check fails and names every direct writer,
  sequence rewrite, envelope strip, or duplicate-terminal finding
- **AND** the failure message requires the ledger ingestion boundary and the
  job-store exact-sequence sink
- **AND** a clean fixture that persists the supplied canonical sequence exactly
  and updates terminal job state without inserting an event passes

#### Scenario: Run identity aliases diverge

- **WHEN** a Bun architecture/contract test submits matching and mismatched
  canonical `runId` and compatibility `jobId` fixtures through registered
  desktop, headless, scheduler, and Local Job API Run constructors
- **THEN** every matching path preserves one equal identity and every mismatch
  fails before provider work or event publication
- **AND** a retry fixture creates a new ledger/new identity with source
  provenance instead of reopening or appending to the terminal source Run
- **AND** the static guard rejects route, adapter, or projection code that owns
  an independent execution-ID generator or fallback

#### Scenario: Durable commit is the visibility barrier

- **WHEN** a Bun fault-injection test causes `appendExact` to fail definitely,
  return an unknown outcome, commit immediately before process crash, or succeed
  while one projection fails
- **THEN** no uncommitted fact is acknowledged or externally projected and a
  later fact cannot overtake the unresolved append
- **AND** a committed fact survives at its exact sequence and projections resume
  from durable cursor without rolling it back, renumbering it, or returning a
  duplicate public event

#### Scenario: Guard proves its own detection

- **WHEN** the event single-path guard runs under Bun
- **THEN** it first verifies synthetic violating and clean fixtures for duplicate
  ledger/envelope/redaction definition, retained legacy owner, disallowed
  raw-write import, downstream sequence allocation, repeated/stateless
  redaction, adjacent-fragment secret leakage, unsafe terminal flush, envelope
  stripping, non-owner artifact admission/event minting, and duplicate completion
- **AND** it verifies that `canonicalRunEventLedgerV1`, legacy path call sites,
  and obsolete raw-writer allowlist entries are absent at the implementation
  verification stop gate
- **AND** the guard run fails closed if the expected findings do not match
