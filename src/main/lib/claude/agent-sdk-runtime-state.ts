import {
  type ClaudeAgentSdkGuardedContract,
  createClaudeAgentSdkInitialGuardMetadata,
} from "./agent-sdk-guard-metadata"
import {
  type ClaudeAgentSdkStreamConsumerMutableState,
  createClaudeAgentSdkStreamConsumerMutableState,
} from "./agent-sdk-stream-consumer"
import { createTransformer } from "./transform"

export type ClaudeAgentSdkRuntimeStreamSetup = {
  transform: ReturnType<typeof createTransformer>
  parts: any[]
  stderrLines: string[]
  metadata: Record<string, any>
}

export function createClaudeAgentSdkRuntimeStreamState(): ClaudeAgentSdkStreamConsumerMutableState {
  return createClaudeAgentSdkStreamConsumerMutableState()
}

export function createClaudeAgentSdkRuntimeStreamSetup(input: {
  historyEnabled: boolean
  isUsingOllama: boolean
  guardedContract: ClaudeAgentSdkGuardedContract | null
  secretHints?: readonly string[]
}): ClaudeAgentSdkRuntimeStreamSetup {
  return {
    transform: createTransformer({
      emitSdkMessageUuid: input.historyEnabled,
      isUsingOllama: input.isUsingOllama,
      secretHints: input.secretHints,
    }),
    parts: [],
    stderrLines: [],
    metadata: createClaudeAgentSdkInitialGuardMetadata(input.guardedContract),
  }
}
