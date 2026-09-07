## ADDED Requirements

### Requirement: Codex Native Boundary Forwarding And Disposition
The Codex transport SHALL forward responses, notifications, server requests,
response-send/resolved and exits to the ledger ports once with original request
correlation. decodeCodexNativeBoundary SHALL implement the complete 66/10/16
method/item disposition table below without owning sequence, outcome or mutable usage state.
Observed-deferred surfaces SHALL not be mislabeled unknown or upgraded to supported.

| Notification methods (66 total) | Canonical disposition |
| --- | --- |
| account/login/completed, mcpServer/oauthLogin/completed | status/oauth_lifecycle |
| account/rateLimits/updated, account/updated | status/account_lifecycle |
| app/list/updated, externalAgentConfig/import/completed, skills/changed | status/configuration |
| command/exec/outputDelta, process/outputDelta, process/exited | status/runtime_process (process/exited notification is not transport exit) |
| configWarning, deprecationNotice, guardianWarning, warning | status/warning |
| error | error with classification/code/willRetry |
| fs/changed, fuzzyFileSearch/sessionCompleted, fuzzyFileSearch/sessionUpdated | status/workspace_observation |
| hook/completed, hook/started | status/hook_lifecycle |
| item/agentMessage/delta | assistant_delta |
| item/autoApprovalReview/completed, item/autoApprovalReview/started | status/approval_review |
| item/commandExecution/outputDelta, item/commandExecution/terminalInteraction, item/fileChange/outputDelta, item/fileChange/patchUpdated, item/mcpToolCall/progress | tool_delta (terminalInteraction is tool evidence, not a second Interaction FSM) |
| item/completed, item/started | item table below, including reconciliation on completed |
| item/plan/delta, turn/plan/updated | status/plan |
| item/reasoning/summaryPartAdded | status/reasoning_part |
| item/reasoning/summaryTextDelta, item/reasoning/textDelta | reasoning_delta with distinct channel/partIndex |
| mcpServer/startupStatus/updated | status/mcp_lifecycle |
| model/rerouted | status/reroute |
| model/verification, turn/moderationMetadata | status/model_verification |
| rawResponseItem/completed | status/raw_response_observed (allowlisted metadata only, contentOmitted:true) |
| remoteControl/status/changed, windows/worldWritableWarning, windowsSandbox/setupCompleted | status/unsupported_native_surface with surface=remote_control or windows and disposition=observed_deferred |
| serverRequest/resolved | status/interaction_boundary, boundary=resolved |
| thread/archived, thread/closed, thread/goal/cleared, thread/goal/updated, thread/name/updated, thread/settings/updated, thread/started, thread/status/changed, thread/unarchived | status/thread_lifecycle |
| thread/compacted | status/compaction |
| thread/realtime/closed, thread/realtime/error, thread/realtime/itemAdded, thread/realtime/outputAudio/delta, thread/realtime/sdp, thread/realtime/started, thread/realtime/transcript/delta, thread/realtime/transcript/done | status/unsupported_native_surface, surface=realtime, disposition=observed_deferred |
| thread/tokenUsage/updated | usage_update (after seal: late_event with observed usage) |
| turn/completed | terminal candidate, settled by core outcome rule |
| turn/diff/updated | status/diff_observation plus candidate evidence to artifact owner; no direct artifact event |
| turn/started | status/turn_lifecycle |

| Server request methods (10 total) | Disposition |
| --- | --- |
| account/chatgptAuthTokens/refresh, applyPatchApproval, attestation/generate, execCommandApproval, item/commandExecution/requestApproval, item/fileChange/requestApproval, item/permissions/requestApproval, item/tool/call, item/tool/requestUserInput, mcpServer/elicitation/request | status/interaction_boundary, boundary=request, native method + requestId; exact existing safety owner still handles authorization; no credential material persists |

For each request, response-send records boundary=response_send and sent/failed;
serverRequest/resolved records boundary=resolved. A response-send failure does not
claim success or resolution. Transport passes the resolved notification only once to
recordServerRequestResolved; it must not also ingest a duplicate generic notification.
Other client responses emit status/protocol_response with request correlation and
sanitized result/error metadata; thread/resume uses native_resume_validated/native_resume_rejected as specified by
agent-runtime-core Native Resume Validation Facts.

| ThreadItem variants (16 total) | started / completed disposition |
| --- | --- |
| agentMessage | status/item_lifecycle then status/item_reconciliation; assistant deltas and authoritative readItem text |
| reasoning | status/item_lifecycle then status/item_reconciliation; separate content/text and summary parts |
| commandExecution, mcpToolCall, dynamicToolCall, collabAgentToolCall, webSearch, imageView, imageGeneration, fileChange | tool_started / tool_finished plus item_reconciliation; imageGeneration.savedPath and fileChange/diff only feed artifact candidates |
| contextCompaction | status/compaction |
| enteredReviewMode, exitedReviewMode | status/review_mode |
| hookPrompt | status/hook_lifecycle |
| plan | status/plan |
| userMessage | status/user_message (including snapshot user items), no assistant output |


#### Scenario: Transport forwards protocol boundary shapes
- **WHEN** the fake transport is driven by `ingress-boundaries.jsonl` with a spy ledger
- **THEN** each inbound/outbound boundary invokes its correct port once in arrival
  order with observationKey and request context; resolved is not sent twice
- **AND** a successful thread/resume response is forwarded as a response, without an
  invented thread/started notification or sessionId fallback

#### Scenario: Pinned native surface has complete disposition
- **WHEN** decodeCodexNativeBoundary receives every schema-derived notification,
  server-request and item case in `native-dispositions.json`
- **THEN** decoded domain event/status subtype exactly matches this requirement's inline table for
  all 66 notification methods, 10 requests and 16 item variants
- **AND** plan/hook/model-verification and six non-tool variants have explicit categories;
  realtime/remote-control/windows are observed_deferred with contentOmitted, not unknown
- **AND** the fixture's capability manifest is unchanged; observation alone grants no support

#### Scenario: Decoder retains channel and native error fields
- **WHEN** `codex-decode.json` supplies reasoning text/summary deltas with schema-proven
  indexes when available and with absent indexes otherwise,
  retry error code/willRetry and usage total/last vectors
- **THEN** decoded observation descriptors retain those exact fields and channel keys
  for the core owner without inventing an absent index; summary boundary state and
  inferred fallback belong to the ledger, and decoder output depends only on its input
- **AND** descriptors contain no assigned sequence or inferred succeeded terminal
