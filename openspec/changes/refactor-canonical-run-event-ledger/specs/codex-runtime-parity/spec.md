## ADDED Requirements

### Requirement: Codex Native Boundary Forwarding And Disposition
The Codex transport SHALL forward responses, notifications, server requests,
response-send/resolved and exits to the ledger ports once with original request
correlation. decodeCodexNativeBoundary SHALL implement design's complete 66/10/16
method/item disposition table without owning sequence, outcome or mutable usage state.
Observed-deferred surfaces SHALL not be mislabeled unknown or upgraded to supported.

#### Scenario: Transport forwards protocol boundary shapes
- **WHEN** the fake transport is driven by `ingress-boundaries.jsonl` with a spy ledger
- **THEN** each inbound/outbound boundary invokes its correct port once in arrival
  order with observationKey and request context; resolved is not sent twice
- **AND** a successful thread/resume response is forwarded as a response, without an
  invented thread/started notification or sessionId fallback

#### Scenario: Pinned native surface has complete disposition
- **WHEN** decodeCodexNativeBoundary receives every schema-derived notification,
  server-request and item case in `native-dispositions.json`
- **THEN** decoded domain event/status subtype exactly matches the design table for
  all 66 notification methods, 10 requests and 16 item variants
- **AND** plan/hook/model-verification and six non-tool variants have explicit categories;
  realtime/remote-control/windows are observed_deferred with contentOmitted, not unknown
- **AND** the fixture's capability manifest is unchanged; observation alone grants no support

#### Scenario: Decoder retains channel and native error fields
- **WHEN** `codex-decode.json` supplies reasoning text/summary deltas with part indexes,
  retry error code/willRetry and usage total/last vectors
- **THEN** decoded observation descriptors retain those exact fields and channel keys
  for the core owner, and a second decoder invocation depends only on its input
- **AND** descriptors contain no assigned sequence or inferred succeeded terminal
