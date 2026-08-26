import type { ResolvedChatImageAttachment } from "../../../shared/chat-attachments"
import type { ValidatedAgentScopeContract } from "../agent-guard"
import type {
  DesktopRunRequest,
  DesktopRunResult,
} from "../agent-runtime/desktop-run-request"
import {
  type DesktopRuntimeAdapter,
  DesktopRuntimeAdapterFactory,
} from "../agent-runtime/desktop-runner"
import {
  type CreateCodexAppServerAdapterInput,
  createCodexAppServerAdapter,
} from "./app-server-adapter"
import { resolveCodexAppServerPluginConfigOverrides } from "./app-server-plugin-allowlist"
import {
  type CodexDesktopAdapterSelection,
  resolveCodexDesktopAdapterSelection,
} from "./desktop-adapter-selection"

export type CodexAppServerDesktopAdapterRunnerDependencies = {
  createAdapter: typeof createCodexAppServerAdapter
  resolveAdapterSelection: typeof resolveCodexDesktopAdapterSelection
  resolvePluginConfig: typeof resolveCodexAppServerPluginConfigOverrides
}

const defaultDependencies: CodexAppServerDesktopAdapterRunnerDependencies = {
  createAdapter: createCodexAppServerAdapter,
  resolveAdapterSelection: resolveCodexDesktopAdapterSelection,
  resolvePluginConfig: resolveCodexAppServerPluginConfigOverrides,
}

function withDefaultDependencies(
  dependencies:
    | Partial<CodexAppServerDesktopAdapterRunnerDependencies>
    | undefined,
): CodexAppServerDesktopAdapterRunnerDependencies {
  return { ...defaultDependencies, ...dependencies }
}

export function resolveCodexAppServerDesktopAdapter(input: {
  adapter: DesktopRuntimeAdapter
  request: DesktopRunRequest
  selection: CodexDesktopAdapterSelection
}): DesktopRuntimeAdapter {
  return new DesktopRuntimeAdapterFactory([input.adapter]).get({
    runtimeId: input.request.context.runtimeId,
    source: input.selection.source,
  })
}

export async function runCodexAppServerDesktopAdapter(input: {
  request: DesktopRunRequest
  providerGatewayToken: string | null
  appManagedApiKey: string | null
  secretHints: readonly string[]
  resolvedImages: ResolvedChatImageAttachment[]
  guardedContract: ValidatedAgentScopeContract | null
  isCurrentRunOwner: () => boolean
  emit: (chunk: Record<string, unknown>) => void
  registerPendingQuestion: NonNullable<
    CreateCodexAppServerAdapterInput["registerPendingQuestion"]
  >
  unregisterPendingQuestion: NonNullable<
    CreateCodexAppServerAdapterInput["unregisterPendingQuestion"]
  >
  env?: NodeJS.ProcessEnv
  dependencies?: Partial<CodexAppServerDesktopAdapterRunnerDependencies>
}): Promise<DesktopRunResult> {
  const dependencies = withDefaultDependencies(input.dependencies)
  const runOwnerIsCurrent = (): boolean => {
    try {
      return input.isCurrentRunOwner()
    } catch {
      return false
    }
  }
  const env = input.env ?? process.env
  const selection = dependencies.resolveAdapterSelection(env)
  const pluginConfig = await dependencies.resolvePluginConfig({
    projectId: input.request.context.projectId,
    chatId: input.request.context.chatId,
    subChatId: input.request.context.subChatId,
  })
  if (!runOwnerIsCurrent() || input.request.signal?.aborted === true) {
    return { status: "canceled" }
  }

  const adapter = dependencies.createAdapter({
    enabled: selection.useAppServer,
    experimentalApi:
      env.LOCUS_CODEX_APP_SERVER_EXPERIMENTAL_API === "1" ||
      env.LOCUS_CODEX_APP_SERVER_CONTROLLED_EDIT_EXECUTOR === "1",
    // Smoke-only diagnostic hook for the 6.8 apply_patch enablement probe.
    // Product app-server runs leave this unset unless explicitly enabled.
    configOverrides:
      env.LOCUS_CODEX_APP_SERVER_APPLY_PATCH_EXPERIMENT === "1"
        ? {
            "features.apply_patch_freeform": true,
            "features.apply_patch_streaming_events": true,
            include_apply_patch_tool: true,
            "tools.apply_patch.enabled": true,
            "tools.apply_patch.approval_mode": "prompt",
            "model_providers.locus_profile.apply_patch_tool_type": "freeform",
            "model_providers.locus_profile.experimental_supported_tools": [
              "apply_patch",
            ],
          }
        : undefined,
    providerGatewayToken: input.providerGatewayToken,
    secretHints: input.secretHints,
    appManagedApiKey:
      input.providerGatewayToken !== null ? null : input.appManagedApiKey,
    pluginConfig,
    controlledEditEnabled:
      env.LOCUS_CODEX_APP_SERVER_CONTROLLED_EDIT_EXECUTOR === "1",
    resolvedImages: input.resolvedImages,
    guardedContract: input.guardedContract,
    isCurrentRunOwner: runOwnerIsCurrent,
    emit: input.emit,
    registerPendingQuestion: input.registerPendingQuestion,
    unregisterPendingQuestion: input.unregisterPendingQuestion,
  })
  const desktopAdapter = resolveCodexAppServerDesktopAdapter({
    adapter,
    request: input.request,
    selection,
  })
  return desktopAdapter.run(input.request)
}
