# qwen-cli-setup-guidance Specification Delta

The Qwen CLI setup surface is removed in full. This capability ceases to exist and
`openspec/specs/qwen-cli-setup-guidance/` is deleted.

**Shared reason for every requirement below.** This capability exists only to help a user install
and configure the `qwen-code` runtime, which is removed in this same change. With no runtime, there
is nothing to guide.

**Shared migration for every requirement below.** No data migration. No installation has Qwen
configured. The Settings section, the onboarding path, and the four tRPC procedures backing them are
deleted; the persisted override file and the `qwenRuntimeEnabled` key are removed by the one-time
startup sweep.

## REMOVED Requirements

### Requirement: Qwen CLI Availability Status
**Reason**: `src/main/lib/qwen/qwen-cli-status.ts` and the `getQwenCliStatus` procedure are deleted
with the runtime.
**Migration**: None.

### Requirement: Qwen Executable Path Override
**Reason**: The `updateQwenExecutablePath` and `resetQwenExecutablePath` procedures and their
persisted state are deleted.
**Migration**: The startup sweep removes `{userData}/qwen-cli-settings.json`.

### Requirement: Safe Qwen PATH Discovery And Spawn
**Reason**: No Qwen executable is discovered or spawned. The safe-spawn discipline this requirement
encoded remains specified for the contract runtimes in their own capabilities.
**Migration**: None.

### Requirement: Passive Qwen Setup Guidance
**Reason**: The guidance UI and its onboarding panel (`panels/qwen-action.tsx`) are deleted.
**Migration**: The shared onboarding string `onboarding.aiPath.engineNote`, which named both dying
runtimes in its value rather than its key, is **reworded** rather than deleted so onboarding copy
stays intact.

### Requirement: Qwen Runtime Start Is Blocked Until CLI Is Available
**Reason**: The runtime can never start, which is strictly stronger than the blocking behaviour this
requirement specified.
**Migration**: None.

### Requirement: Qwen Runtime Toggle in Settings
**Reason**: The toggle, the `setQwenRuntimeEnabled` procedure, and the persisted
`{userData}/runtime-feature-settings.json` backing it are all removed. With
`EXPERIMENTAL_RUNTIME_IDS` empty, the whole gate mechanism is deleted.
**Migration**: The startup sweep deletes the settings file.

### Requirement: Qwen CLI Configuration Visibility
**Reason**: There is no Qwen configuration to make visible.
**Migration**: None.
