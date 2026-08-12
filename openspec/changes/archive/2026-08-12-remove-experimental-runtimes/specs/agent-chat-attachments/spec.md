# agent-chat-attachments Specification Delta

One requirement is modified. Its `runtime-transport` scenario existed solely for the two removed
runtimes: `getChatImageAttachmentCapability` produced that block reason from a hardcoded
`provider === "qwen-code" || provider === "kun"` early return, and there is no other producer. With
both runtimes gone the reason has zero assignment sites, so the scenario is **removed** rather than
re-grounded — every surviving runtime delivers images, and keeping an unreachable branch plus a
requirement nothing can satisfy is exactly the residue this change exists to remove. The
`runtime-transport` member of `ChatImageAttachmentBlockReason` and its two dead consumer branches
are deleted with it. Should a future runtime lack image delivery, the block path is designed then,
against that runtime's own requirements. Every other scenario is reproduced verbatim.

## MODIFIED Requirements

### Requirement: Provider Image Capability
The system SHALL determine image-attachment support from the combination of the selected runtime's
ability to deliver images (transport) AND the resolved target model's vision capability, and SHALL
block image send whenever either is unavailable. First-party Claude/Codex sources with runtime-known
image support SHALL resolve to an explicit supported vision state. Provider Profile/custom sources
whose vision capability is unknown or unset SHALL be treated as unsupported (fail closed). The block
explanation SHALL identify the actual cause (offline local model or text-only model) rather than a
generic or mismatched reason. For desktop UI requests, raw Claude selector
values such as `auto` and `custom-provider` SHALL be normalized by renderer/transport run admission
before model vision lookup; the main process SHALL consume the resulting target identity rather than
importing renderer-only normalization logic.

#### Scenario: First-party provider source supports images
- **WHEN** the input contains image attachments
- **AND** the selected runtime can deliver images
- **AND** the active source is first-party Claude OAuth, Codex ChatGPT, or Codex `openai-api-key`
  with runtime-known image support
- **THEN** the app allows send subject to size and count limits

#### Scenario: Claude raw source normalizes before capability lookup
- **WHEN** the selected Claude model source is `auto` or `custom-provider`
- **AND** the input contains image attachments
- **THEN** renderer/transport run admission normalizes that source to the effective run source before
  resolving model vision
- **AND** uses the normalized `claude-oauth` or `provider-profile:*` source for image capability
  lookup

#### Scenario: Provider profile model supports images
- **WHEN** the input contains image attachments
- **AND** the selected runtime can deliver images
- **AND** the active Provider Profile declares `vision: true`
- **THEN** the app allows send subject to size and count limits

#### Scenario: Selected model is text-only
- **WHEN** the input contains image attachments
- **AND** the selected Provider Profile/model does not support vision (for example a text-only
  third-party model behind a custom provider)
- **THEN** the app blocks send
- **AND** explains that the current model cannot process images

#### Scenario: Provider profile vision capability is unknown
- **WHEN** the input contains image attachments
- **AND** the selected Provider Profile has not declared a vision capability
- **THEN** the app treats the model as unable to process images and blocks send (fail closed)
- **AND** explains how to enable image support for that provider/model

#### Scenario: Provider profile metadata is missing
- **WHEN** the input contains image attachments
- **AND** the selected target identity references a Provider Profile id
- **AND** main-process Provider Profile metadata lookup returns `null`
- **THEN** the app treats the model vision capability as unknown and blocks send (fail closed)
- **AND** does not fall back to first-party image support

#### Scenario: Claude custom-provider uses normalized Provider Profile vision
- **WHEN** the selected Claude model source is `custom-provider`
- **AND** the source normalizes to a legacy/usable Provider Profile
- **AND** that Provider Profile has not declared `vision: true`
- **THEN** the app blocks image send as `model-no-vision`
- **AND** does not fall back to a raw `custom-provider` allow path

#### Scenario: Claude run-admission blocker precedes image gating
- **WHEN** the selected Claude model source is `auto`, `claude-oauth`, or `custom-provider`
- **AND** run admission cannot produce a usable normalized target identity
- **THEN** the run is blocked by the run-admission blocker
- **AND** the image capability gate does not convert that blocker into a model-vision decision

#### Scenario: Offline local model
- **WHEN** the input contains image attachments
- **AND** the active path is an offline local model that cannot receive images
- **THEN** the app blocks send
- **AND** explains the offline limitation as a distinct reason from a text-only remote model

#### Scenario: Provider selection changes
- **WHEN** the user changes provider or model while image attachments are staged
- **THEN** the app re-evaluates image support and limits
- **AND** updates warnings or blocking state without losing the staged attachments

#### Scenario: Supported runtimes have image-delivery capability
- **WHEN** image-attachment capability is resolved for any supported runtime
- **THEN** the runtime is one of the closed supported set: `claude-code` or `codex`
- **AND** both supported runtimes deliver images without a runtime-specific transport block
