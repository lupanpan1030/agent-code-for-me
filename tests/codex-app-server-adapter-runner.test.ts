import { describe, expect, test } from "bun:test"
import type { ValidatedAgentScopeContract } from "../src/main/lib/agent-guard"
import type { DesktopRunRequest } from "../src/main/lib/agent-runtime/desktop-run-request"
import type { DesktopRuntimeAdapter } from "../src/main/lib/agent-runtime/desktop-runner"
import type { CreateCodexAppServerAdapterInput } from "../src/main/lib/codex/app-server-adapter"
import {
  resolveCodexAppServerDesktopAdapter,
  runCodexAppServerDesktopAdapter,
} from "../src/main/lib/codex/app-server-adapter-runner"
import type { ResolvedChatImageAttachment } from "../src/shared/chat-attachments"

function createRequest(): DesktopRunRequest {
  return {
    identity: { runId: "run-1", jobId: "job-1" },
    context: {
      runtimeId: "codex",
      mode: "agent",
      cwd: "/repo",
      workspaceKind: "project",
      projectId: "project-1",
      chatId: "chat-1",
      subChatId: "sub-1",
    },
  } as unknown as DesktopRunRequest
}

function createAdapter(
  run: DesktopRuntimeAdapter["run"],
): DesktopRuntimeAdapter {
  return {
    metadata: {
      runtimeId: "codex",
      source: "codex-app-server",
      label: "Codex app-server adapter",
      temporaryFallback: false,
    },
    run,
  }
}

describe("Codex app-server desktop adapter runner", () => {
  test("resolves Codex construction through DesktopRuntimeAdapterFactory", () => {
    const request = createRequest()
    const adapter = createAdapter(async () => ({ status: "succeeded" }))

    expect(
      resolveCodexAppServerDesktopAdapter({
        adapter,
        request,
        selection: {
          source: "codex-app-server",
          useAppServer: true,
          reason: "test",
        },
      }),
    ).toBe(adapter)
  })

  test("maps the existing experiment switches and runs the selected adapter", async () => {
    const request = createRequest()
    let adapterInput: CreateCodexAppServerAdapterInput | undefined
    const registerPendingQuestion = () => {}
    const unregisterPendingQuestion = () => {}
    const emit = () => {}
    const env = {
      LOCUS_CODEX_APP_SERVER_CONTROLLED_EDIT_EXECUTOR: "1",
      LOCUS_CODEX_APP_SERVER_APPLY_PATCH_EXPERIMENT: "1",
    }
    const resolvedImages: ResolvedChatImageAttachment[] = [
      {
        attachmentId: "image-1",
        localRef: "cia:v1:sub-1/image-1.png",
        mediaType: "image/png",
        sizeBytes: 68,
        base64Data: "encoded-image",
      },
    ]
    const guardedContract = {} as ValidatedAgentScopeContract
    const pluginConfig = {
      configOverrides: {},
      diagnostics: [],
      enabledPluginIds: [],
    }
    const result = await runCodexAppServerDesktopAdapter({
      request,
      providerGatewayToken: "gateway-token",
      appManagedApiKey: "app-key-must-be-suppressed",
      secretHints: ["upstream-token", "gateway-token"],
      resolvedImages,
      guardedContract,
      isCurrentRunOwner: () => true,
      emit,
      registerPendingQuestion,
      unregisterPendingQuestion,
      env,
      dependencies: {
        resolveAdapterSelection: (receivedEnv) => {
          expect(receivedEnv).toBe(env)
          return {
            source: "codex-app-server",
            useAppServer: true,
            reason: "test selection",
          }
        },
        resolvePluginConfig: async (input) => {
          expect(input).toEqual({
            projectId: "project-1",
            chatId: "chat-1",
            subChatId: "sub-1",
          })
          return pluginConfig
        },
        createAdapter: (input) => {
          adapterInput = input
          return createAdapter(async (receivedRequest) => {
            expect(receivedRequest).toBe(request)
            return { status: "succeeded" }
          })
        },
      },
    })

    expect(result).toEqual({ status: "succeeded" })
    expect(adapterInput).toMatchObject({
      enabled: true,
      experimentalApi: true,
      providerGatewayToken: "gateway-token",
      appManagedApiKey: null,
      secretHints: ["upstream-token", "gateway-token"],
      controlledEditEnabled: true,
      configOverrides: {
        "features.apply_patch_freeform": true,
        "features.apply_patch_streaming_events": true,
        include_apply_patch_tool: true,
        "tools.apply_patch.enabled": true,
        "tools.apply_patch.approval_mode": "prompt",
        "model_providers.locus_profile.apply_patch_tool_type": "freeform",
        "model_providers.locus_profile.experimental_supported_tools": [
          "apply_patch",
        ],
      },
    })
    expect(adapterInput?.registerPendingQuestion).toBe(registerPendingQuestion)
    expect(adapterInput?.unregisterPendingQuestion).toBe(
      unregisterPendingQuestion,
    )
    expect(adapterInput?.pluginConfig).toBe(pluginConfig)
    expect(adapterInput?.resolvedImages).toBe(resolvedImages)
    expect(adapterInput?.guardedContract).toBe(guardedContract)
    expect(adapterInput?.emit).toBe(emit)
  })

  test("preserves the standalone experimental switch and app-managed key", async () => {
    let adapterInput: CreateCodexAppServerAdapterInput | undefined
    await runCodexAppServerDesktopAdapter({
      request: createRequest(),
      providerGatewayToken: null,
      appManagedApiKey: "app-key",
      secretHints: [],
      resolvedImages: [],
      guardedContract: null,
      isCurrentRunOwner: () => true,
      emit: () => {},
      registerPendingQuestion: () => {},
      unregisterPendingQuestion: () => {},
      env: { LOCUS_CODEX_APP_SERVER_EXPERIMENTAL_API: "1" },
      dependencies: {
        resolvePluginConfig: async () => ({
          configOverrides: {},
          diagnostics: [],
          enabledPluginIds: [],
        }),
        createAdapter: (input) => {
          adapterInput = input
          return createAdapter(async () => ({ status: "succeeded" }))
        },
      },
    })

    expect(adapterInput).toMatchObject({
      enabled: true,
      experimentalApi: true,
      controlledEditEnabled: false,
      providerGatewayToken: null,
      appManagedApiKey: "app-key",
    })
    expect(adapterInput?.configOverrides).toBeUndefined()
  })

  test("does not create or dispatch an adapter after plugin resolution loses exact ownership", async () => {
    let resolvePluginConfig!: (value: {
      configOverrides: Record<string, unknown>
      diagnostics: never[]
      enabledPluginIds: never[]
    }) => void
    let markResolutionStarted!: () => void
    const resolutionStarted = new Promise<void>((resolve) => {
      markResolutionStarted = resolve
    })
    let currentOwner = true
    let createAdapterCalls = 0
    const resultPromise = runCodexAppServerDesktopAdapter({
      request: createRequest(),
      providerGatewayToken: null,
      appManagedApiKey: null,
      secretHints: [],
      resolvedImages: [],
      guardedContract: null,
      isCurrentRunOwner: () => currentOwner,
      emit: () => {},
      registerPendingQuestion: () => {},
      unregisterPendingQuestion: () => {},
      dependencies: {
        resolvePluginConfig: () => {
          markResolutionStarted()
          return new Promise((resolve) => {
            resolvePluginConfig = resolve
          })
        },
        createAdapter: () => {
          createAdapterCalls += 1
          return createAdapter(async () => ({ status: "succeeded" }))
        },
      },
    })

    await resolutionStarted
    currentOwner = false
    resolvePluginConfig({
      configOverrides: {},
      diagnostics: [],
      enabledPluginIds: [],
    })

    await expect(resultPromise).resolves.toEqual({ status: "canceled" })
    expect(createAdapterCalls).toBe(0)
  })
})
