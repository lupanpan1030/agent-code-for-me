// biome-ignore-all assist/source/organizeImports: focused per-project runtime memory change; preserve existing import grouping.
"use client"

import { useVirtualizer } from "@tanstack/react-virtual"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { AlignJustify, Plus } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Button } from "../../../components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu"
import {
  AgentIcon,
  AttachIcon,
  BranchIcon,
  CheckIcon,
  IconChevronDown,
  PlanIcon,
  SearchIcon,
} from "../../../components/ui/icons"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover"
import { cn } from "../../../lib/utils"
import { useI18n } from "../../../lib/i18n"
import {
  justCreatedIdsAtom,
  newChatTargetAtom,
  projectAgentIdAtomFamily,
  lastSelectedCodexModelIdAtom,
  lastSelectedCodexModelSourceAtom,
  lastSelectedCodexThinkingAtom,
  lastSelectedClaudeModelSourceAtom,
  lastSelectedBranchesAtom,
  lastSelectedModelIdAtom,
  lastSelectedWorkModeAtom,
  selectedAgentChatIdAtom,
  selectedDraftIdAtom,
  selectedProjectAtom,
  getNextMode,
  type AgentMode,
  type ClaudeModelSource,
  type CodexModelSource,
  type SelectedProject,
  setLastSelectedClaudeSelectionAtom,
  setLastSelectedCodexSelectionAtom,
} from "../atoms"
import { defaultAgentModeAtom } from "../../../lib/atoms"
import { ProjectSelector } from "../components/project-selector"
import { WorkModeSelector } from "../components/work-mode-selector"
import {
  agentsSettingsDialogOpenAtom,
  agentsSettingsDialogActiveTabAtom,
  extendedThinkingEnabledAtom,
  hiddenModelsAtom,
  showOfflineModeFeaturesAtom,
  selectedOllamaModelAtom,
  customHotkeysAtom,
} from "../../../lib/atoms"
import { useSetupStatus } from "../../onboarding/lib/use-setup-status"
// Desktop uses real tRPC
import { toast } from "sonner"
import { trpc } from "../../../lib/trpc"
import {
  AgentsSlashCommand,
  COMMAND_PROMPTS,
  type SlashCommandOption,
} from "../commands"
import { expandCustomSlashCommand } from "../lib/slash-command-expansion"
import { useAgentsFileUpload } from "../hooks/use-agents-file-upload"
import { usePastedTextFiles } from "../hooks/use-pasted-text-files"
import { useFocusInputOnEnter } from "../hooks/use-focus-input-on-enter"
import { useToggleFocusOnCmdEsc } from "../hooks/use-toggle-focus-on-cmd-esc"
import {
  useVoiceInput,
  useVoiceInputHotkey,
} from "../../../lib/hooks/use-voice-input"
import { getResolvedHotkey } from "../../../lib/hotkeys"
import {
  AgentsFileMention,
  AgentsMentionsEditor,
  type AgentsMentionsEditorHandle,
  type FileMentionOption,
} from "../mentions"
import { AgentFileItem } from "../ui/agent-file-item"
import { AgentImageItem } from "../ui/agent-image-item"
import { AgentPastedTextItem } from "../ui/agent-pasted-text-item"
import { AgentsHeaderControls } from "../ui/agents-header-controls"
import { VoiceWaveIndicator } from "../ui/voice-wave-indicator"
// import { CreateBranchDialog } from "@/app/(alpha)/agents/{components}/create-branch-dialog"
import {
  PromptInput,
  PromptInputActions,
  PromptInputContextItems,
} from "../../../components/ui/prompt-input"
import { agentsSidebarOpenAtom, agentsUnseenChangesAtom } from "../atoms"
import { AgentSendButton } from "../components/agent-send-button"
import { VoiceInputControl } from "../../../lib/voice/voice-input-control"
import {
  AgentEngineSelector,
  type AgentEngineOption,
} from "../components/agent-engine-selector"
import { RuntimeModelSelector } from "../components/runtime-model-selector"
import {
  isProviderProfileSource,
  parseProviderProfileSource,
} from "../../../../shared/provider-profile-types"
import {
  agentChatProviders,
  type ChatEngineId,
} from "../../../../shared/chat-engine-id"
import {
  createProviderProfileChatSessionBindingWrite,
  normalizeChatSessionBindingWrite,
} from "../../../../shared/chat-session-binding"
import {
  getChatImageAttachmentCapability,
  resolveChatImageModelVision,
} from "../../../../shared/chat-attachment-capabilities"
import { useRuntimeCapabilityManifestStore } from "../lib/runtime-manifest-store"
import { AgentContextRecommendations } from "../components/agent-context-recommendations"
import { CreateBranchDialog } from "../components/create-branch-dialog"
import { formatTimeAgo } from "../utils/format-time-ago"
import { handlePasteEvent } from "../utils/paste-text"
import {
  loadGlobalDrafts,
  saveGlobalDrafts,
  generateDraftId,
  deleteNewChatDraft,
  markDraftVisible,
  toDraftImage,
  fromDraftImage,
  toDraftPastedText,
  fromDraftPastedText,
  type DraftProject,
} from "../lib/drafts"
import { imageAttachmentBlockDescriptionKey } from "../lib/image-attachment-copy"
import { buildAgentMessageParts } from "../lib/message-parts"
import { resolveCodexNewChatDefaultsForSource } from "../lib/chat-session-binding-defaults"
import {
  buildCodexApiKeyModels,
  type ClaudeCatalogModel,
  filterCatalogPickerModels,
  getDefaultCodexCatalogModel,
  getDefaultCodexThinking,
  resolveClaudeCatalogModel,
  resolveCodexCatalogModel,
  useModelCatalogStore,
} from "../lib/model-catalog-store"
import {
  normalizeClaudeModelSourceForRun,
  resolveCodexModelForSource,
  type CodexThinkingLevel,
} from "../lib/models"
// import type { PlanType } from "@/lib/config/subscription-plans"
type PlanType = string

// Hook to get available models (including offline models if Ollama is available and debug enabled)
function useAvailableModels(baseModels: ClaudeCatalogModel[]) {
  const showOfflineFeatures = useAtomValue(showOfflineModeFeaturesAtom)
  const { data: ollamaStatus } = trpc.ollama.getStatus.useQuery(undefined, {
    refetchInterval: showOfflineFeatures ? 30000 : false,
    enabled: showOfflineFeatures, // Only query Ollama when offline mode is enabled
  })

  const isOffline = ollamaStatus ? !ollamaStatus.internet.online : false
  const hasOllama =
    ollamaStatus?.ollama.available &&
    (ollamaStatus.ollama.models?.length ?? 0) > 0
  const ollamaModels = ollamaStatus?.ollama.models || []
  const recommendedModel = ollamaStatus?.ollama.recommendedModel

  // Only show offline models if:
  // 1. Debug flag is enabled (showOfflineFeatures)
  // 2. Ollama is available with models
  // 3. User is actually offline
  if (showOfflineFeatures && hasOllama && isOffline) {
    return {
      models: baseModels,
      ollamaModels,
      recommendedModel,
      isOffline,
      hasOllama: true,
    }
  }

  return {
    models: baseModels,
    ollamaModels: [] as string[],
    recommendedModel: undefined as string | undefined,
    isOffline,
    hasOllama: false,
  }
}

// Chat engines
type NewChatEngine = {
  id: ChatEngineId
  name: string
  hasModels?: boolean
}

const engines = [
  { id: "claude-code", name: "Claude Code", hasModels: true },
  { id: "codex", name: "OpenAI Codex" },
] satisfies readonly NewChatEngine[]
function isChatEngineId(id: string): id is ChatEngineId {
  return agentChatProviders.includes(id as ChatEngineId)
}

interface NewChatFormProps {
  isMobileFullscreen?: boolean
  onBackToChats?: () => void
}

export function NewChatForm({
  isMobileFullscreen = false,
  onBackToChats,
}: NewChatFormProps = {}) {
  const { t } = useI18n()
  // UNCONTROLLED: just track if editor has content for send button
  const [hasContent, setHasContent] = useState(false)
  const [selectedChatId, setSelectedChatId] = useAtom(selectedAgentChatIdAtom)
  const [selectedDraftId, setSelectedDraftId] = useAtom(selectedDraftIdAtom)
  const [sidebarOpen, setSidebarOpen] = useAtom(agentsSidebarOpenAtom)

  // Current draft ID being edited (generated when user starts typing in empty form)
  const currentDraftIdRef = useRef<string | null>(null)
  const unseenChanges = useAtomValue(agentsUnseenChangesAtom)

  // Check if any chat has unseen changes
  const hasAnyUnseenChanges = unseenChanges.size > 0
  const [selectedProject, setSelectedProject] = useAtom(selectedProjectAtom)
  const [newChatTarget, setNewChatTarget] = useAtom(newChatTargetAtom)

  // Fetch projects to validate selectedProject exists
  const { data: projectsList, isLoading: isLoadingProjects } =
    trpc.projects.list.useQuery()

  // New-chat composer state is driven by an explicit target, not by the
  // globally selected project. Top-level new chat stays folderless even when a
  // previous project remains selected elsewhere in the app.
  const validatedProject = useMemo(() => {
    if (newChatTarget.type !== "project") return null
    if (isLoadingProjects) {
      return selectedProject?.id === newChatTarget.projectId
        ? selectedProject
        : null
    }
    if (!projectsList) return null
    const project = projectsList.find((p) => p.id === newChatTarget.projectId)
    if (!project) return null
    return {
      id: project.id,
      name: project.name,
      path: project.path,
      gitRemoteUrl: project.gitRemoteUrl,
      gitProvider: project.gitProvider as
        | "github"
        | "gitlab"
        | "bitbucket"
        | null,
      gitOwner: project.gitOwner,
      gitRepo: project.gitRepo,
    } satisfies NonNullable<SelectedProject>
  }, [newChatTarget, selectedProject, projectsList, isLoadingProjects])
  const projectForChat = validatedProject
  const isFolderlessQuickChat = !validatedProject
  const { data: runtimeCapabilityManifests } =
    useRuntimeCapabilityManifestStore()
  const quickChatAllowedEngineIds = useMemo(() => {
    if (!isFolderlessQuickChat) return undefined
    if (!runtimeCapabilityManifests) return []

    return runtimeCapabilityManifests
      .filter((manifest) =>
        manifest.capabilities.some(
          (capability) =>
            capability.id === "quickChatAssistant" &&
            capability.status === "supported",
        ),
      )
      .map((manifest) => manifest.runtimeId)
      .filter(isChatEngineId)
  }, [isFolderlessQuickChat, runtimeCapabilityManifests])
  const quickChatRuntimeGateLoaded =
    !isFolderlessQuickChat || runtimeCapabilityManifests !== undefined

  // Clear invalid project from storage without letting it drive new-chat mode.
  useEffect(() => {
    if (
      selectedProject &&
      projectsList &&
      !projectsList.some((project) => project.id === selectedProject.id)
    ) {
      setSelectedProject(null)
    }
  }, [selectedProject, projectsList, setSelectedProject])

  useEffect(() => {
    if (newChatTarget.type !== "project" || !projectsList) return
    if (
      projectsList.some((project) => project.id === newChatTarget.projectId)
    ) {
      return
    }
    setNewChatTarget({ type: "quick" })
  }, [newChatTarget, projectsList, setNewChatTarget])
  // Remember the runtime per project: each project keeps its own last-used
  // runtime, falling back to the global most-recent choice for new projects.
  const projectAgentIdAtom = useMemo(
    () => projectAgentIdAtomFamily(validatedProject?.id ?? ""),
    [validatedProject?.id],
  )
  const [lastSelectedEngineId, setLastSelectedEngineId] =
    useAtom(projectAgentIdAtom)
  const [lastSelectedModelId] = useAtom(lastSelectedModelIdAtom)
  const setLastSelectedClaudeSelection = useSetAtom(
    setLastSelectedClaudeSelectionAtom,
  )
  // Mode for new chat - uses user's default preference directly
  // Note: defaultAgentMode is initialized synchronously via atomWithStorage with getOnInit: true
  const defaultAgentMode = useAtomValue(defaultAgentModeAtom)
  const [agentMode, setAgentMode] = useState<AgentMode>(() => defaultAgentMode)
  // Toggle mode helper
  const toggleMode = useCallback(() => {
    setAgentMode(getNextMode)
  }, [])
  const modeLabel =
    agentMode === "plan" ? t("chat.mode.plan") : t("chat.mode.agent")
  const modePlaceholder =
    agentMode === "plan"
      ? t("chat.placeholder.planMode")
      : t("chat.placeholder.agentMode")
  const effectiveMode = validatedProject ? agentMode : "agent"
  const effectiveModePlaceholder = validatedProject
    ? modePlaceholder
    : t("chat.placeholder.agentMode")
  const modeSelectorTitle = t("chat.mode.selectorTooltip")
  const [workMode, setWorkMode] = useAtom(lastSelectedWorkModeAtom)
  const [worktreeCreateState, setWorktreeCreateState] = useState<
    "idle" | "creating"
  >("idle")
  const { data: providerProfilesData } =
    trpc.providerProfiles.listProfiles.useQuery(undefined, {
      staleTime: 30_000,
    })
  const providerProfiles = providerProfilesData?.profiles ?? []
  const [selectedClaudeModelSource] = useAtom(lastSelectedClaudeModelSourceAtom)
  // Connection status, derived from the provider/runtime owners.
  const setupStatus = useSetupStatus()
  // OAuth is only usable when a non-expired OAuth credential and the runtime are
  // both ready — a saved Provider Profile is a separate selectable source.
  const canUseClaudeOAuth =
    setupStatus.claude.oauthConnected &&
    !setupStatus.claude.oauthExpired &&
    setupStatus.claude.runtimeReady
  const claudeSourceNormalization = useMemo(() => {
    if (
      selectedClaudeModelSource === "custom-provider" &&
      !providerProfilesData
    ) {
      return null
    }
    return normalizeClaudeModelSourceForRun({
      source: selectedClaudeModelSource,
      providerProfiles,
      canUseClaudeOAuth,
    })
  }, [
    canUseClaudeOAuth,
    providerProfiles,
    providerProfilesData,
    selectedClaudeModelSource,
  ])
  const normalizedClaudeModelSource = claudeSourceNormalization?.ok
    ? (claudeSourceNormalization.source as ClaudeModelSource)
    : "claude-oauth"
  const selectedClaudeProfileId = parseProviderProfileSource(
    normalizedClaudeModelSource,
  )
  const selectedClaudeProviderProfile = selectedClaudeProfileId
    ? providerProfiles.find(
        (profile) =>
          profile.id === selectedClaudeProfileId &&
          profile.targetRuntimes.includes("claude"),
      )
    : undefined
  const selectedClaudeProfileIsPending =
    Boolean(selectedClaudeProfileId) && !providerProfilesData
  const effectiveClaudeModelSource =
    selectedClaudeProfileId &&
    !selectedClaudeProviderProfile &&
    !selectedClaudeProfileIsPending
      ? "claude-oauth"
      : normalizedClaudeModelSource
  const isClaudeConnected =
    canUseClaudeOAuth ||
    providerProfiles.some(
      (profile) =>
        profile.targetRuntimes.includes("claude") &&
        profile.lastTestStatus?.ok !== false,
    )
  const setSettingsDialogOpen = useSetAtom(agentsSettingsDialogOpenAtom)
  const setSettingsActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const setJustCreatedIds = useSetAtom(justCreatedIdsAtom)
  const [createBranchDialogOpen, setCreateBranchDialogOpen] = useState(false)

  // Worktree config banner state
  const [worktreeBannerDismissed, setWorktreeBannerDismissed] = useState(() => {
    try {
      return localStorage.getItem("worktree-banner-dismissed") === "true"
    } catch {
      return false
    }
  })

  // Check if project has worktree config
  const { data: worktreeConfigData } = trpc.worktreeConfig.get.useQuery(
    { projectId: validatedProject?.id ?? "" },
    {
      enabled:
        !!validatedProject?.id &&
        workMode === "worktree" &&
        !worktreeBannerDismissed,
    },
  )

  const showWorktreeBanner =
    workMode === "worktree" &&
    validatedProject &&
    !worktreeBannerDismissed &&
    worktreeConfigData &&
    !worktreeConfigData.config

  const handleDismissWorktreeBanner = () => {
    setWorktreeBannerDismissed(true)
    try {
      localStorage.setItem("worktree-banner-dismissed", "true")
    } catch {}
  }

  const handleConfigureWorktree = () => {
    // Open the projects settings tab
    setSettingsActiveTab("projects")
    setSettingsDialogOpen(true)
  }
  // Parse owner/repo from GitHub URL
  const parseGitHubUrl = (url: string) => {
    const match = url.match(/(?:github\.com\/)?([^/]+)\/([^/\s#?]+)/)
    if (!match) return null
    return `${match[1]}/${match[2].replace(/\.git$/, "")}`
  }
  const enabledEngines = useMemo(
    () =>
      engines.filter((engine) => {
        if (!quickChatAllowedEngineIds) return true
        return quickChatAllowedEngineIds.includes(engine.id)
      }),
    [quickChatAllowedEngineIds],
  )
  const fallbackEngine = enabledEngines[0] ?? engines[0]
  const [selectedEngine, setSelectedEngine] = useState<NewChatEngine>(
    () =>
      enabledEngines.find((engine) => engine.id === lastSelectedEngineId) ||
      fallbackEngine,
  )

  useEffect(() => {
    const nextEngine =
      enabledEngines.find((engine) => engine.id === lastSelectedEngineId) ||
      fallbackEngine

    if (nextEngine && nextEngine.id !== selectedEngine.id) {
      setSelectedEngine(nextEngine)
    }
  }, [enabledEngines, fallbackEngine, lastSelectedEngineId, selectedEngine.id])
  const selectedEngineIsRuntimeAllowed = useMemo(
    () =>
      enabledEngines.some((engine) => engine.id === selectedEngine.id),
    [enabledEngines, selectedEngine.id],
  )
  const isEngineOptionDisabled = useCallback(
    (engine: NewChatEngine) => {
      if (!quickChatAllowedEngineIds) return false
      return !quickChatAllowedEngineIds.includes(engine.id)
    },
    [quickChatAllowedEngineIds],
  )
  const selectEngine = useCallback(
    (engine: NewChatEngine) => {
      if (isEngineOptionDisabled(engine)) {
        return
      }
      setSelectedEngine(engine)
      setLastSelectedEngineId(engine.id)
    },
    [isEngineOptionDisabled, setLastSelectedEngineId],
  )
  const engineOptions = useMemo<AgentEngineOption[]>(
    () =>
      engines.map((engine) => {
        const unavailable = isEngineOptionDisabled(engine)
        return {
          id: engine.id,
          name: engine.name,
          status: unavailable ? "unavailable" : "ready",
        }
      }),
    [isEngineOptionDisabled],
  )
  const handleEngineSelect = useCallback(
    (engineId: ChatEngineId) => {
      const engine = engines.find((option) => option.id === engineId)
      if (!engine) return
      selectEngine(engine)
    },
    [selectEngine],
  )
  // Get available models (with offline support)
  const { claudeModels, codexModels } = useModelCatalogStore()
  const availableModels = useAvailableModels(claudeModels)
  const [selectedOllamaModel, setSelectedOllamaModel] = useAtom(
    selectedOllamaModelAtom,
  )
  const [lastSelectedCodexModelId] = useAtom(lastSelectedCodexModelIdAtom)
  const [lastSelectedCodexModelSource] = useAtom(
    lastSelectedCodexModelSourceAtom,
  )
  const [lastSelectedCodexThinking, setLastSelectedCodexThinking] = useAtom(
    lastSelectedCodexThinkingAtom,
  )
  const setLastSelectedCodexSelection = useSetAtom(
    setLastSelectedCodexSelectionAtom,
  )
  const [thinkingEnabled, setThinkingEnabled] = useAtom(
    extendedThinkingEnabledAtom,
  )

  const selectedModel = useMemo(
    () =>
      resolveClaudeCatalogModel(availableModels.models, lastSelectedModelId),
    [availableModels.models, lastSelectedModelId],
  )

  const { data: codexApiKeyStatus } = trpc.codex.getCodexApiKeyStatus.useQuery(
    undefined,
    {
      staleTime: 30_000,
    },
  )
  const hiddenModels = useAtomValue(hiddenModelsAtom)
  const effectiveCodexFirstPartySource =
    lastSelectedCodexModelSource === "openai-api-key"
      ? "openai-api-key"
      : lastSelectedCodexModelSource === "chatgpt"
        ? "chatgpt"
        : null
  const codexApiKeyModels = useMemo(
    () =>
      buildCodexApiKeyModels(codexApiKeyStatus?.modelIds ?? [], codexModels),
    [codexApiKeyStatus?.modelIds, codexModels],
  )
  const selectableCodexModels = useMemo(
    () => [...codexModels, ...codexApiKeyModels],
    [codexApiKeyModels, codexModels],
  )
  const codexUiModels = useMemo(
    () => filterCatalogPickerModels(codexModels, hiddenModels),
    [codexModels, hiddenModels],
  )
  const selectedCodexModel = useMemo(() => {
    const selected = resolveCodexCatalogModel(
      selectableCodexModels,
      lastSelectedCodexModelId,
    )
    if (selected.kind === "custom" || !effectiveCodexFirstPartySource) {
      return selected
    }
    const resolved = resolveCodexModelForSource({
      models: selectableCodexModels,
      selectedModelId: selected.id,
      source: effectiveCodexFirstPartySource,
    })
    return resolved.model ?? getDefaultCodexCatalogModel(codexModels)
  }, [
    codexModels,
    effectiveCodexFirstPartySource,
    lastSelectedCodexModelId,
    selectableCodexModels,
  ])

  const selectedCodexThinking = useMemo<CodexThinkingLevel>(() => {
    if (
      selectedCodexModel.thinkings.includes(
        lastSelectedCodexThinking as CodexThinkingLevel,
      )
    ) {
      return lastSelectedCodexThinking as CodexThinkingLevel
    }

    if (selectedCodexModel.thinkings.includes("high")) {
      return "high"
    }

    return getDefaultCodexThinking(selectedCodexModel)
  }, [selectedCodexModel, lastSelectedCodexThinking])
  const selectedCodexProfileId = parseProviderProfileSource(
    lastSelectedCodexModelSource,
  )
  const selectedCodexProviderProfile = selectedCodexProfileId
    ? providerProfiles.find(
        (profile) =>
          profile.id === selectedCodexProfileId &&
          profile.targetRuntimes.includes("codex"),
      )
    : undefined
  const selectedCodexProfileIsPending =
    Boolean(selectedCodexProfileId) && !providerProfilesData

  useEffect(() => {
    // A Profile binding exposes reasoning=none and stores NULL. Keep the
    // user's first-party effort preference untouched while Profile is active.
    if (selectedCodexProfileId) return
    if (
      selectedCodexModel.thinkings.includes(
        lastSelectedCodexThinking as CodexThinkingLevel,
      )
    ) {
      return
    }

    setLastSelectedCodexThinking(selectedCodexThinking)
  }, [
    selectedCodexProfileId,
    selectedCodexModel,
    lastSelectedCodexThinking,
    selectedCodexThinking,
    setLastSelectedCodexThinking,
  ])

  useEffect(() => {
    if (
      selectedCodexProfileId &&
      !selectedCodexProviderProfile &&
      !selectedCodexProfileIsPending
    ) {
      const nextDefaults = resolveCodexNewChatDefaultsForSource({
        models: codexModels,
        selectedModelId: lastSelectedCodexModelId,
        selectedThinking: lastSelectedCodexThinking,
        source: "chatgpt",
      })
      setLastSelectedCodexSelection({
        modelSource: "chatgpt",
        ...nextDefaults,
      })
    }
  }, [
    selectedCodexProfileId,
    selectedCodexProviderProfile,
    selectedCodexProfileIsPending,
    codexModels,
    lastSelectedCodexModelId,
    lastSelectedCodexThinking,
    setLastSelectedCodexSelection,
  ])

  const selectedChatModel = useMemo(() => {
    if (selectedEngine.id === "codex") {
      const selectedProfileId = parseProviderProfileSource(
        lastSelectedCodexModelSource,
      )
      const selectedProfile = selectedProfileId
        ? providerProfiles.find((profile) => profile.id === selectedProfileId)
        : undefined
      if (selectedProfile) {
        return selectedProfile.defaultModel
      }
      return `${selectedCodexModel.id}/${selectedCodexThinking}`
    }
    if (selectedClaudeProviderProfile) {
      return selectedClaudeProviderProfile.defaultModel
    }
    return selectedModel?.id ?? "opus"
  }, [
    lastSelectedCodexModelSource,
    providerProfiles,
    selectedEngine.id,
    selectedClaudeProviderProfile,
    selectedCodexModel.id,
    selectedCodexThinking,
    selectedModel?.id,
  ])
  const selectedEngineId = selectedEngine.id
  const selectedChatBinding = useMemo(() => {
    const selectedProviderProfile =
      selectedEngineId === "codex"
        ? selectedCodexProviderProfile
        : selectedClaudeProviderProfile
    if (selectedProviderProfile) {
      return createProviderProfileChatSessionBindingWrite({
        runtime: selectedEngineId,
        profile: selectedProviderProfile,
      })
    }

    return normalizeChatSessionBindingWrite({
      runtime: selectedEngineId,
      providerProfileId:
        selectedEngineId === "codex"
          ? selectedCodexProfileId
          : selectedClaudeProfileId,
      modelId:
        selectedEngineId === "codex"
          ? selectedCodexModel.id
          : selectedChatModel,
      modelSource:
        selectedEngineId === "codex"
          ? lastSelectedCodexModelSource
          : effectiveClaudeModelSource,
      thinkingLevel:
        selectedEngineId === "codex" ? selectedCodexThinking : null,
    })
  }, [
    effectiveClaudeModelSource,
    lastSelectedCodexModelSource,
    selectedChatModel,
    selectedClaudeProviderProfile,
    selectedClaudeProfileId,
    selectedCodexModel.id,
    selectedCodexProviderProfile,
    selectedCodexProfileId,
    selectedCodexThinking,
    selectedEngineId,
  ])

  // Determine current Ollama model (selected or recommended)
  const currentOllamaModel =
    selectedOllamaModel ||
    availableModels.recommendedModel ||
    availableModels.ollamaModels[0]
  const selectedModelLabel = useMemo(() => {
    if (selectedEngine.id === "codex") {
      const selectedProfileId = parseProviderProfileSource(
        lastSelectedCodexModelSource,
      )
      const selectedProfile = selectedProfileId
        ? providerProfiles.find((profile) => profile.id === selectedProfileId)
        : undefined
      if (selectedProfile) {
        return `${selectedProfile.name} · ${selectedProfile.defaultModel}`
      }
      return selectedCodexModel.displayLabel
    }

    if (availableModels.isOffline && availableModels.hasOllama) {
      return currentOllamaModel || "Ollama"
    }

    if (selectedClaudeProviderProfile) {
      return `${selectedClaudeProviderProfile.name} · ${selectedClaudeProviderProfile.defaultModel}`
    }

    if (!selectedModel) {
      return "Select model"
    }

    return selectedModel.displayLabel
  }, [
    selectedEngine.id,
    providerProfiles,
    selectedCodexModel.displayLabel,
    availableModels.isOffline,
    availableModels.hasOllama,
    currentOllamaModel,
    selectedClaudeProviderProfile,
    selectedModel,
  ])
  useEffect(() => {
    if (claudeSourceNormalization?.ok && claudeSourceNormalization.changed) {
      const normalizedProfileId = parseProviderProfileSource(
        claudeSourceNormalization.source,
      )
      const normalizedProfile = normalizedProfileId
        ? providerProfiles.find((profile) => profile.id === normalizedProfileId)
        : undefined
      setLastSelectedClaudeSelection({
        modelSource: claudeSourceNormalization.source as ClaudeModelSource,
        modelId: normalizedProfile?.defaultModel ?? lastSelectedModelId,
      })
      return
    }
    if (
      isProviderProfileSource(selectedClaudeModelSource) &&
      !selectedClaudeProviderProfile &&
      !selectedClaudeProfileIsPending
    ) {
      setLastSelectedClaudeSelection({
        modelSource: "claude-oauth",
        modelId: availableModels.models[0]?.id ?? "opus",
      })
    }
  }, [
    claudeSourceNormalization,
    selectedClaudeModelSource,
    selectedClaudeProviderProfile,
    selectedClaudeProfileIsPending,
    availableModels.models,
    lastSelectedModelId,
    providerProfiles,
    setLastSelectedClaudeSelection,
  ])
  const [repoPopoverOpen, setRepoPopoverOpen] = useState(false)
  const [branchPopoverOpen, setBranchPopoverOpen] = useState(false)
  const [lastSelectedBranches, setLastSelectedBranches] = useAtom(
    lastSelectedBranchesAtom,
  )
  const [branchSearch, setBranchSearch] = useState("")
  const [selectedBranchType, setSelectedBranchType] = useState<
    "local" | "remote" | undefined
  >(undefined)

  // Get/set selected branch for current project (persisted per project)
  const selectedBranch = validatedProject?.id
    ? lastSelectedBranches[validatedProject.id]?.name || ""
    : ""
  const setSelectedBranch = useCallback(
    (branch: string, type?: "local" | "remote") => {
      if (validatedProject?.id && type) {
        setLastSelectedBranches((prev) => ({
          ...prev,
          [validatedProject.id]: { name: branch, type },
        }))
        setSelectedBranchType(type)
      }
    },
    [validatedProject?.id, setLastSelectedBranches],
  )
  const branchListRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<AgentsMentionsEditorHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Restore selectedBranchType from persisted storage when project changes
  useEffect(() => {
    if (validatedProject?.id) {
      const stored = lastSelectedBranches[validatedProject.id]
      if (stored?.type) {
        setSelectedBranchType(stored.type)
      } else {
        setSelectedBranchType(undefined)
      }
    } else {
      setSelectedBranchType(undefined)
    }
  }, [validatedProject?.id, lastSelectedBranches])

  const tempAttachmentScopeRef = useRef(`new-chat-images-${Date.now()}`)

  // File upload hook
  const {
    images,
    files,
    handleAddAttachments,
    removeImage,
    removeFile,
    clearImages,
    clearFiles,
    clearAll,
    isUploading,
    setImagesFromDraft,
  } = useAgentsFileUpload({ subChatId: tempAttachmentScopeRef.current })

  const readyImageCount = images.filter(
    (image) =>
      !image.isLoading && !image.error && (image.localRef || image.url),
  ).length
  const imageModelVision = useMemo(
    () =>
      resolveChatImageModelVision({
        provider: selectedEngineId,
        modelSource:
          selectedEngineId === "claude-code"
            ? effectiveClaudeModelSource
            : lastSelectedCodexModelSource,
        providerProfileId:
          selectedEngineId === "claude-code"
            ? selectedClaudeProfileId
            : selectedCodexProfileId,
        providerProfiles,
      }),
    [
      effectiveClaudeModelSource,
      lastSelectedCodexModelSource,
      providerProfiles,
      selectedClaudeProfileId,
      selectedCodexProfileId,
      selectedEngineId,
    ],
  )
  const imageAttachmentCapability = useMemo(
    () =>
      getChatImageAttachmentCapability({
        provider: selectedEngineId,
        offlineModeEnabled:
          selectedEngine.id === "claude-code" &&
          availableModels.isOffline &&
          availableModels.hasOllama,
        modelVision: imageModelVision,
      }),
    [
      availableModels.hasOllama,
      availableModels.isOffline,
      imageModelVision,
      selectedEngine.id,
      selectedEngineId,
    ],
  )
  const imageAttachmentBlocked =
    readyImageCount > 0 && !imageAttachmentCapability.supportsImages
  const imageAttachmentBlockDescription = imageAttachmentBlocked
    ? t(
        imageAttachmentBlockDescriptionKey(
          imageAttachmentCapability.blockReason,
        ),
      )
    : null
  const imageAttachmentNotice =
    readyImageCount === 0
      ? null
      : imageAttachmentBlocked
        ? imageAttachmentBlockDescription
        : t("agent.attachments.remoteDisclosure", {
            provider: selectedModelLabel,
          })

  // Pasted text files - use a stable temp ID for new chat
  const tempPastedIdRef = useRef(`new-chat-${Date.now()}`)
  const {
    pastedTexts,
    addPastedText,
    removePastedText,
    clearPastedTexts,
    setPastedTextsFromDraft,
  } = usePastedTextFiles(tempPastedIdRef.current)

  // File contents cache - stores content for file mentions (keyed by mentionId)
  // This content gets added to the prompt when sending, without showing a separate card
  const fileContentsRef = useRef<Map<string, string>>(new Map())

  // Mention dropdown state
  const [showMentionDropdown, setShowMentionDropdown] = useState(false)
  const [mentionSearchText, setMentionSearchText] = useState("")
  const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 })
  const [draftText, setDraftText] = useState("")

  // Mention subpage navigation state
  const [showingFilesList, setShowingFilesList] = useState(false)
  const [showingSkillsList, setShowingSkillsList] = useState(false)
  const [showingAgentsList, setShowingAgentsList] = useState(false)
  const [showingToolsList, setShowingToolsList] = useState(false)

  // Slash command dropdown state
  const [showSlashDropdown, setShowSlashDropdown] = useState(false)
  const [slashSearchText, setSlashSearchText] = useState("")
  const [slashPosition, setSlashPosition] = useState({ top: 0, left: 0 })

  // Mode tooltip state (floating tooltip like canvas)
  const [modeTooltip, setModeTooltip] = useState<{
    visible: boolean
    position: { top: number; left: number }
    mode: "agent" | "plan"
  } | null>(null)
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasShownTooltipRef = useRef(false)
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false)

  useEffect(() => {
    if (!modeDropdownOpen) {
      setModeTooltip(null)
    }
  }, [modeDropdownOpen])
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false)

  // Voice input state
  const customHotkeys = useAtomValue(customHotkeysAtom)
  const voiceInputHotkey = getResolvedHotkey("voice-input", customHotkeys)
  const transcribeMutation = trpc.voice.transcribe.useMutation()

  const appendVoiceText = useCallback((text: string) => {
    const currentValue = editorRef.current?.getValue() || ""
    const transcribed = text
      .replace(/[\r\n\t]+/g, " ")
      .replace(/ +/g, " ")
      .trim()
    const needsSpace = currentValue.length > 0 && !/\s$/.test(currentValue)
    const newValue = currentValue + (needsSpace ? " " : "") + transcribed
    editorRef.current?.setValue(newValue)
    setHasContent(true)
  }, [])

  const transcribeVoiceAudio = useCallback(
    (input: {
      audio: string
      format: "webm" | "mp3" | "m4a" | "wav" | "ogg"
    }) => transcribeMutation.mutateAsync(input),
    [transcribeMutation],
  )

  const {
    isRecording: isVoiceRecording,
    audioLevel: voiceAudioLevel,
    isTranscribing,
    startRequestedRef: voiceStartRequestedRef,
    start: handleVoiceMouseDown,
    stop: handleVoiceMouseUp,
    cancel: handleVoiceMouseLeave,
  } = useVoiceInput({
    disabled: isUploading,
    transcribeAudio: transcribeVoiceAudio,
    onText: appendVoiceText,
    onNoSpeech: () => toast.info(t("agent.voice.noSpeechDetected")),
    onError: (err, phase) => {
      if (phase === "start") {
        toast.error(
          err instanceof Error ? err.message : "Failed to start recording",
        )
        return
      }
      toast.error(t("agent.voice.transcriptionFailed"))
    },
    logPrefix: "[NewChatForm]",
  })

  // Check if voice input is available through a configured transcription API.
  const { data: voiceAvailability } = trpc.voice.isAvailable.useQuery()
  const isVoiceAvailable = voiceAvailability?.available ?? false

  useVoiceInputHotkey({
    hotkey: voiceInputHotkey,
    isRecording: isVoiceRecording,
    isTranscribing,
    startRequestedRef: voiceStartRequestedRef,
    onStart: handleVoiceMouseDown,
    onStop: handleVoiceMouseUp,
  })

  // Shift+Tab handler for mode switching (now handled inside input component via onShiftTab prop)

  // Keyboard shortcut: Enter to focus input when not already focused
  useFocusInputOnEnter(editorRef)

  // Keyboard shortcut: Cmd+Esc to toggle focus/blur
  useToggleFocusOnCmdEsc(editorRef)

  // Desktop: fetch branches from local git repository
  const branchesQuery = trpc.changes.getBranches.useQuery(
    { worktreePath: validatedProject?.path || "" },
    {
      enabled: !!validatedProject?.path,
      staleTime: 30_000, // Cache for 30 seconds
    },
  )

  const fetchRemoteMutation = trpc.changes.fetchRemote.useMutation()

  // Manual refresh branches
  const handleRefreshBranches = useCallback(() => {
    if (validatedProject?.path) {
      fetchRemoteMutation.mutate(
        { worktreePath: validatedProject.path },
        {
          onSuccess: () => {
            branchesQuery.refetch()
          },
          onError: (error) => {
            console.error("Failed to fetch remote branches:", error)
          },
        },
      )
    }
  }, [validatedProject?.path, fetchRemoteMutation, branchesQuery])

  // Stable ref for handleRefreshBranches to avoid re-running effects on every render
  const handleRefreshBranchesRef = useRef(handleRefreshBranches)
  handleRefreshBranchesRef.current = handleRefreshBranches

  // Transform branch data to match web app format
  const branches = useMemo(() => {
    if (!branchesQuery.data) return []

    const { local, remote, defaultBranch } = branchesQuery.data
    const result: Array<{
      name: string
      type: "local" | "remote"
      protected: boolean
      isDefault: boolean
      committedAt: string | null
      authorName: null
    }> = []

    // Add local branches
    for (const { branch, lastCommitDate } of local) {
      result.push({
        name: branch,
        type: "local",
        protected: false,
        isDefault: branch === defaultBranch,
        committedAt: lastCommitDate
          ? new Date(lastCommitDate).toISOString()
          : null,
        authorName: null,
      })
    }

    // Add remote branches
    for (const name of remote) {
      result.push({
        name: name,
        type: "remote",
        protected: false,
        isDefault: name === defaultBranch,
        committedAt: null,
        authorName: null,
      })
    }

    // Sort: default first, then local, then remote, alphabetically
    return result.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1
      if (!a.isDefault && b.isDefault) return 1
      if (a.type !== b.type) return a.type === "local" ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [branchesQuery.data])

  // Filter branches based on search
  const filteredBranches = useMemo(() => {
    if (!branchSearch.trim()) return branches
    const search = branchSearch.toLowerCase()
    return branches.filter((b) => b.name.toLowerCase().includes(search))
  }, [branches, branchSearch])

  // Virtualizer for branch list - only active when popover is open
  const branchVirtualizer = useVirtualizer({
    count: filteredBranches.length,
    getScrollElement: () => branchListRef.current,
    estimateSize: () => 28, // Each item is h-7 (28px)
    overscan: 5,
    enabled: branchPopoverOpen, // Only virtualize when popover is open
  })

  // Force virtualizer to re-measure when popover opens
  useEffect(() => {
    if (branchPopoverOpen) {
      // Small delay to ensure ref is attached
      const timer = setTimeout(() => {
        branchVirtualizer.measure()
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [branchPopoverOpen])

  // Format relative time for branches (reuse shared utility)
  const formatRelativeTime = (dateString: string | null): string => {
    if (!dateString) return ""
    return formatTimeAgo(dateString)
  }

  // Set default branch when project/branches change (only if no saved branch for this project)
  useEffect(() => {
    if (
      branchesQuery.data?.defaultBranch &&
      validatedProject?.id &&
      !selectedBranch
    ) {
      // Find the default branch in the branches list to get its type
      // Prefer local over remote if both exist
      const defaultBranchObj =
        branches.find(
          (b) =>
            b.name === branchesQuery.data.defaultBranch &&
            b.isDefault &&
            b.type === "local",
        ) ||
        branches.find(
          (b) =>
            b.name === branchesQuery.data.defaultBranch &&
            b.isDefault &&
            b.type === "remote",
        )
      // Fallback to "local" if branch not found in list (shouldn't happen but prevents empty selector)
      const branchType = defaultBranchObj?.type || "local"
      setSelectedBranch(branchesQuery.data.defaultBranch, branchType)
    }
  }, [
    branchesQuery.data?.defaultBranch,
    validatedProject?.id,
    selectedBranch,
    setSelectedBranch,
    branches,
  ])

  // Auto-focus input when NewChatForm is shown (when clicking "New Chat")
  // Skip on mobile to prevent keyboard from opening automatically
  useEffect(() => {
    if (isMobileFullscreen) return // Don't autofocus on mobile

    // Small delay to ensure DOM is ready and animations complete
    const timeoutId = setTimeout(() => {
      editorRef.current?.focus()
    }, 150)

    return () => clearTimeout(timeoutId)
  }, [isMobileFullscreen]) // Run on mount and when mobile state changes

  // Track last saved text to avoid unnecessary updates
  const lastSavedTextRef = useRef<string>("")

  // Track previous draft ID to detect when switching away from a draft
  const prevSelectedDraftIdRef = useRef<string | null>(null)

  // Restore draft when a specific draft is selected from sidebar
  // Or clear editor when "New Workspace" is clicked (selectedDraftId becomes null)
  useEffect(() => {
    const hadDraftBefore = prevSelectedDraftIdRef.current !== null
    prevSelectedDraftIdRef.current = selectedDraftId

    if (!selectedDraftId) {
      // No draft selected - only clear if we had a draft before (user clicked "New Workspace")
      // Don't clear if user is currently typing (currentDraftIdRef has a value)
      if (hadDraftBefore) {
        currentDraftIdRef.current = null
        lastSavedTextRef.current = ""
        if (editorRef.current) {
          editorRef.current.clear()
          setHasContent(false)
        }
        clearAll()
        clearPastedTexts()

        // Fetch remote branches in background when starting new workspace
        if (validatedProject?.path) {
          handleRefreshBranchesRef.current()
        }
      }
      return
    }

    const globalDrafts = loadGlobalDrafts()
    const draft = globalDrafts[selectedDraftId]
    if (draft) {
      currentDraftIdRef.current = selectedDraftId
      if ("project" in draft && draft.project) {
        const draftProject = {
          id: draft.project.id,
          name: draft.project.name,
          path: draft.project.path,
          gitOwner: draft.project.gitOwner,
          gitRepo: draft.project.gitRepo,
          gitProvider: draft.project.gitProvider as
            | "github"
            | "gitlab"
            | "bitbucket"
            | null
            | undefined,
        } satisfies NonNullable<SelectedProject>
        setSelectedProject(draftProject)
        setNewChatTarget({ type: "project", projectId: draft.project.id })
      } else {
        setNewChatTarget({ type: "quick" })
      }
      lastSavedTextRef.current = JSON.stringify({
        text: draft.text || "",
        images: draft.images ?? [],
        pastedTexts: draft.pastedTexts ?? [],
      }) // Initialize to prevent immediate re-save

      // Try to set value immediately if editor is ready
      if (editorRef.current) {
        editorRef.current.setValue(draft.text || "")
        setHasContent(Boolean(draft.text?.trim()))
      } else {
        // Fallback: wait for editor to initialize (rare case)
        const timeoutId = setTimeout(() => {
          editorRef.current?.setValue(draft.text || "")
          setHasContent(Boolean(draft.text?.trim()))
        }, 50)
        setTimeout(() => clearTimeout(timeoutId), 60)
      }

      const draftImages =
        draft.images
          ?.map(fromDraftImage)
          .filter(
            (img): img is NonNullable<ReturnType<typeof fromDraftImage>> =>
              img !== null,
          ) ?? []
      setImagesFromDraft(draftImages)

      const draftPastedTexts =
        draft.pastedTexts
          ?.map(fromDraftPastedText)
          .filter(
            (
              text,
            ): text is NonNullable<ReturnType<typeof fromDraftPastedText>> =>
              text !== null,
          ) ?? []
      setPastedTextsFromDraft(draftPastedTexts)
    }
  }, [
    clearAll,
    clearPastedTexts,
    selectedDraftId,
    setImagesFromDraft,
    setNewChatTarget,
    setPastedTextsFromDraft,
    setSelectedProject,
    validatedProject?.path,
  ])

  // Mark draft as visible when component unmounts (user navigates away)
  // This ensures the draft only appears in the sidebar after leaving the form
  useEffect(() => {
    return () => {
      // On unmount, mark current draft as visible so it appears in sidebar
      if (currentDraftIdRef.current) {
        markDraftVisible(currentDraftIdRef.current)
      }
    }
  }, [])

  // Create chat mutation (real tRPC)
  const utils = trpc.useUtils()
  const createChatMutation = trpc.chats.create.useMutation({
    onMutate: (variables) => {
      setWorktreeCreateState(variables.useWorktree ? "creating" : "idle")
    },
    onSuccess: (data) => {
      // Clear editor, images, files, pasted texts, and file contents cache only on success
      editorRef.current?.clear()
      clearImages()
      clearFiles()
      clearPastedTexts()
      fileContentsRef.current.clear()
      clearCurrentDraft()
      utils.chats.list.invalidate()
      setSelectedChatId(data.id)
      // Track this chat and its first subchat as just created for typewriter effect
      const ids = [data.id]
      if (data.subChats?.[0]?.id) {
        const firstSubChatId = data.subChats[0].id
        ids.push(firstSubChatId)
      }
      setJustCreatedIds((prev) => new Set([...prev, ...ids]))
    },
    onError: (error) => {
      toast.error(error.message)
    },
    onSettled: () => {
      setWorktreeCreateState("idle")
    },
  })

  const trpcUtils = trpc.useUtils()

  const handleSend = useCallback(async () => {
    // Get value from uncontrolled editor
    let message = editorRef.current?.getValue() || ""

    // Allow send if there's text, images, files, or pasted text files
    const hasText = message.trim().length > 0
    const hasImages =
      images.filter((img) => !img.isLoading && (img.localRef || img.url))
        .length > 0
    const hasFiles = files.filter((f) => !f.isLoading).length > 0
    const hasPastedTexts = pastedTexts.length > 0

    if (!hasText && !hasImages && !hasFiles && !hasPastedTexts) {
      return
    }
    if (
      isFolderlessQuickChat &&
      (!quickChatRuntimeGateLoaded || !selectedEngineIsRuntimeAllowed)
    ) {
      toast.error(t("quickChat.providerUnavailable"))
      return
    }
    if (imageAttachmentBlocked) {
      toast.error(t("agent.attachments.imagesUnsupportedTitle"), {
        description:
          imageAttachmentBlockDescription ??
          t("agent.attachments.imagesUnsupportedModel"),
      })
      return
    }
    if (
      selectedEngine.id === "claude-code" &&
      selectedClaudeModelSource === "custom-provider" &&
      !claudeSourceNormalization
    ) {
      toast.error(t("agent.providerProfiles.loading"))
      return
    }
    if (
      selectedEngine.id === "claude-code" &&
      claudeSourceNormalization &&
      !claudeSourceNormalization.ok
    ) {
      toast.error(claudeSourceNormalization.blocker.message, {
        description: claudeSourceNormalization.blocker.hint,
      })
      return
    }

    if (projectForChat) {
      message = await expandCustomSlashCommand(message, projectForChat.path)
    }

    const finalMessage = message.trim()
    const parts = buildAgentMessageParts({
      text: finalMessage,
      images,
      pastedTexts,
      fileContents: fileContentsRef.current.entries(),
    })

    // Create chat with selected project, branch, and initial message
    createChatMutation.mutate({
      projectId: projectForChat?.id ?? null,
      name: message.trim().slice(0, 50), // Use first 50 chars as chat name
      binding: selectedChatBinding,
      initialMessageParts: parts.length > 0 ? parts : undefined,
      baseBranch:
        projectForChat && workMode === "worktree"
          ? selectedBranch || undefined
          : undefined,
      branchType:
        projectForChat && workMode === "worktree"
          ? selectedBranchType
          : undefined,
      useWorktree: Boolean(projectForChat && workMode === "worktree"),
      mode: effectiveMode,
    })
    // Editor, images, files, and pasted texts are cleared in onSuccess callback
  }, [
    projectForChat,
    isFolderlessQuickChat,
    quickChatRuntimeGateLoaded,
    selectedEngineIsRuntimeAllowed,
    createChatMutation,
    hasContent,
    selectedBranch,
    selectedBranchType,
    workMode,
    images,
    files,
    pastedTexts,
    selectedChatModel,
    selectedEngine.id,
    selectedEngineId,
    selectedChatBinding,
    lastSelectedCodexModelSource,
    effectiveClaudeModelSource,
    claudeSourceNormalization,
    selectedClaudeModelSource,
    selectedCodexProfileId,
    selectedClaudeProfileId,
    effectiveMode,
    imageAttachmentBlocked,
    imageAttachmentBlockDescription,
    t,
  ])

  const handleMentionSelect = useCallback((mention: FileMentionOption) => {
    // Category navigation - enter subpage instead of inserting mention
    if (mention.type === "category") {
      if (mention.id === "files") {
        setShowingFilesList(true)
        return
      }
      if (mention.id === "skills") {
        setShowingSkillsList(true)
        return
      }
      if (mention.id === "agents") {
        setShowingAgentsList(true)
        return
      }
      if (mention.id === "tools") {
        setShowingToolsList(true)
        return
      }
    }

    // Otherwise: insert mention as normal
    editorRef.current?.insertMention(mention)
    setDraftText(editorRef.current?.getValue() || "")
    setShowMentionDropdown(false)
    // Reset subpage state
    setShowingFilesList(false)
    setShowingSkillsList(false)
    setShowingAgentsList(false)
    setShowingToolsList(false)
  }, [])

  const handleRecommendationSelect = useCallback(
    (mention: FileMentionOption) => {
      editorRef.current?.insertMention(mention)
      setDraftText(editorRef.current?.getValue() || "")
    },
    [],
  )

  // Save draft to localStorage when content changes
  const handleContentChange = useCallback(
    (hasContent: boolean) => {
      setHasContent(hasContent)
      const text = editorRef.current?.getValue() || ""
      setDraftText(text)
      const draftImages = images
        .map(toDraftImage)
        .filter(
          (img): img is NonNullable<ReturnType<typeof toDraftImage>> =>
            img !== null,
        )
      const draftPastedTexts = pastedTexts.map(toDraftPastedText)
      const snapshot = JSON.stringify({
        text,
        images: draftImages,
        pastedTexts: draftPastedTexts,
      })

      // Skip if text and metadata attachments haven't changed
      if (snapshot === lastSavedTextRef.current) {
        return
      }
      lastSavedTextRef.current = snapshot

      const globalDrafts = loadGlobalDrafts()

      if (
        (text.trim() ||
          draftImages.length > 0 ||
          draftPastedTexts.length > 0) &&
        validatedProject
      ) {
        // If no current draft ID, create a new one
        if (!currentDraftIdRef.current) {
          currentDraftIdRef.current = generateDraftId()
        }

        const key = currentDraftIdRef.current
        globalDrafts[key] = {
          text,
          updatedAt: Date.now(),
          project: {
            id: validatedProject.id,
            name: validatedProject.name,
            path: validatedProject.path,
            gitOwner: validatedProject.gitOwner,
            gitRepo: validatedProject.gitRepo,
            gitProvider: validatedProject.gitProvider,
          },
          ...(draftImages.length > 0 && { images: draftImages }),
          ...(draftPastedTexts.length > 0 && { pastedTexts: draftPastedTexts }),
        }
        saveGlobalDrafts(globalDrafts)
      } else if (currentDraftIdRef.current) {
        // Text is empty - delete the current draft
        deleteNewChatDraft(currentDraftIdRef.current)
        currentDraftIdRef.current = null
      }
    },
    [images, pastedTexts, validatedProject],
  )

  useEffect(() => {
    if (!validatedProject) return
    const text = editorRef.current?.getValue() || ""
    if (!text.trim() && images.length === 0 && pastedTexts.length === 0) return
    handleContentChange(Boolean(text.trim()))
  }, [handleContentChange, images, pastedTexts, validatedProject])

  // Clear current draft when chat is created
  const clearCurrentDraft = useCallback(() => {
    if (!currentDraftIdRef.current) return

    deleteNewChatDraft(currentDraftIdRef.current)
    currentDraftIdRef.current = null
    setSelectedDraftId(null)
  }, [setSelectedDraftId])

  // Memoized callbacks to prevent re-renders
  const handleMentionTrigger = useCallback(
    ({ searchText, rect }: { searchText: string; rect: DOMRect }) => {
      if (validatedProject) {
        setMentionSearchText(searchText)
        setMentionPosition({ top: rect.top, left: rect.left })
        // Reset subpage state when opening dropdown
        setShowingFilesList(false)
        setShowingSkillsList(false)
        setShowingAgentsList(false)
        setShowingToolsList(false)
        setShowMentionDropdown(true)
      }
    },
    [validatedProject],
  )

  const handleCloseTrigger = useCallback(() => {
    setShowMentionDropdown(false)
    // Reset subpage state when closing
    setShowingFilesList(false)
    setShowingSkillsList(false)
    setShowingAgentsList(false)
    setShowingToolsList(false)
  }, [])

  // Slash command handlers
  const handleSlashTrigger = useCallback(
    ({ searchText, rect }: { searchText: string; rect: DOMRect }) => {
      setSlashSearchText(searchText)
      setSlashPosition({ top: rect.top, left: rect.left })
      setShowSlashDropdown(true)
    },
    [],
  )

  const handleCloseSlashTrigger = useCallback(() => {
    setShowSlashDropdown(false)
  }, [])

  const handleSlashSelect = useCallback(
    (command: SlashCommandOption) => {
      // Clear the slash command text from editor
      editorRef.current?.clearSlashCommand()
      setShowSlashDropdown(false)

      // Handle builtin commands that change app state (no text input needed)
      if (command.category === "builtin") {
        switch (command.name) {
          case "clear":
            editorRef.current?.clear()
            return
          case "plan":
            if (agentMode !== "plan") {
              setAgentMode("plan")
            }
            return
          case "agent":
            if (agentMode === "plan") {
              setAgentMode("agent")
            }
            return
        }
      }

      // For all other commands (builtin prompts and custom):
      // insert the command and let user add arguments or press Enter to send
      editorRef.current?.setValue(`/${command.name} `)
    },
    [agentMode],
  )

  // Paste handler for images, plain text, and large text (saved as files)
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) =>
      handlePasteEvent(e, handleAddAttachments, addPastedText),
    [handleAddAttachments, addPastedText],
  )

  // Drag and drop handlers
  const [isDragOver, setIsDragOver] = useState(false)

  // Focus state for ring
  const [isFocused, setIsFocused] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  // Text file extensions that should have content read and attached
  const TEXT_FILE_EXTENSIONS = new Set([
    // Code
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".rb",
    ".go",
    ".rs",
    ".java",
    ".kt",
    ".swift",
    ".c",
    ".cpp",
    ".h",
    ".hpp",
    ".cs",
    ".php",
    ".lua",
    ".r",
    ".m",
    ".mm",
    ".scala",
    ".clj",
    ".ex",
    ".exs",
    ".hs",
    ".elm",
    ".erl",
    ".fs",
    ".fsx",
    ".ml",
    ".v",
    ".vhdl",
    ".zig",
    // Config/Data
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".xml",
    ".ini",
    ".env",
    ".conf",
    ".cfg",
    ".properties",
    ".plist",
    // Web
    ".html",
    ".htm",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".vue",
    ".svelte",
    ".astro",
    // Documentation
    ".md",
    ".mdx",
    ".rst",
    ".txt",
    ".text",
    // Graphics (text-based)
    ".svg",
    // Shell/Scripts
    ".sh",
    ".bash",
    ".zsh",
    ".fish",
    ".ps1",
    ".bat",
    ".cmd",
    // Other
    ".sql",
    ".graphql",
    ".gql",
    ".prisma",
    ".dockerfile",
    ".makefile",
    ".gitignore",
    ".gitattributes",
    ".editorconfig",
    ".eslintrc",
    ".prettierrc",
  ])

  const MAX_FILE_SIZE_FOR_CONTENT = 100 * 1024 // 100KB - files larger than this only get path mention

  // Image extensions that should be handled as attachments (base64)
  const IMAGE_EXTENSIONS = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".bmp",
  ])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      const droppedFiles = Array.from(e.dataTransfer.files)

      // Separate images from other files
      const imageFiles: File[] = []
      const otherFiles: File[] = []

      for (const file of droppedFiles) {
        const ext = file.name.includes(".")
          ? "." + file.name.split(".").pop()?.toLowerCase()
          : ""
        if (IMAGE_EXTENSIONS.has(ext)) {
          imageFiles.push(file)
        } else {
          otherFiles.push(file)
        }
      }

      // Handle images via existing attachment system (base64)
      if (imageFiles.length > 0) {
        handleAddAttachments(imageFiles, "drag-drop")
      }

      // Process other files - for text files, read content and add as file mention
      for (const file of otherFiles) {
        // Get file path using Electron's webUtils API (more reliable than file.path)
        const filePath: string | undefined =
          window.webUtils?.getPathForFile?.(file) ||
          (file as File & { path?: string }).path

        let mentionId: string
        let mentionPath: string

        // Check if file is inside the project
        if (
          validatedProject?.path &&
          filePath &&
          filePath.startsWith(validatedProject.path)
        ) {
          // Project file: use relative path with file:local: prefix
          const relativePath = filePath
            .slice(validatedProject.path.length)
            .replace(/^\//, "")
          mentionId = `file:local:${relativePath}`
          mentionPath = relativePath
        } else if (filePath) {
          // External file: use absolute path with file:external: prefix
          mentionId = `file:external:${filePath}`
          mentionPath = filePath
        } else {
          // Fallback: use filename only
          mentionId = `file:external:${file.name}`
          mentionPath = file.name
        }

        const fileName = file.name
        const ext = fileName.includes(".")
          ? "." + fileName.split(".").pop()?.toLowerCase()
          : ""
        // Files without extension are likely directories or special files - skip content reading
        const hasExtension = ext !== ""
        const isTextFile = hasExtension && TEXT_FILE_EXTENSIONS.has(ext)
        const isSmallEnough = file.size <= MAX_FILE_SIZE_FOR_CONTENT

        // For text files that are small enough, read content and store it
        // Show file chip, content will be added to prompt on send
        if (
          isTextFile &&
          isSmallEnough &&
          filePath &&
          validatedProject?.path &&
          filePath.startsWith(validatedProject.path)
        ) {
          // Add file chip for visual representation
          editorRef.current?.insertMention({
            id: mentionId,
            label: fileName,
            path: mentionPath,
            repository: "local",
            type: "file",
          })

          // Read and cache content (will be added to prompt on send)
          try {
            const content = await trpcUtils.files.readFile.fetch({
              filePath,
              projectPath: validatedProject.path,
            })
            fileContentsRef.current.set(mentionId, content)
          } catch (err) {
            // If reading fails, chip is still there - agent can try to read via path
            console.error(
              `[handleDrop] Failed to read file content ${filePath}:`,
              err,
            )
          }
        } else {
          // For binary files, large files - add as mention only
          // mentionPath contains full absolute path for external files
          editorRef.current?.insertMention({
            id: mentionId,
            label: fileName,
            path: mentionPath,
            repository: "local",
            type: "file",
          })
        }
      }

      // Focus after state update - use double rAF to wait for React render
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          editorRef.current?.focus()
        })
      })
    },
    [validatedProject?.path, handleAddAttachments, trpcUtils],
  )

  // Context items for images, files, and pasted text files
  const contextItems =
    images.length > 0 || files.length > 0 || pastedTexts.length > 0 ? (
      <div className="flex flex-wrap items-center gap-[6px]">
        {(() => {
          // Build allImages array for gallery navigation
          const allImages = images
            .filter((img) => img.url && !img.isLoading)
            .map((img) => ({
              id: img.id,
              filename: img.filename,
              url: img.url,
            }))

          return images.map((img, idx) => (
            <AgentImageItem
              key={img.id}
              id={img.id}
              filename={img.filename}
              url={img.url}
              isLoading={img.isLoading}
              error={img.error}
              onRemove={() => removeImage(img.id)}
              allImages={allImages}
              imageIndex={idx}
            />
          ))
        })()}
        {files.map((f) => (
          <AgentFileItem
            key={f.id}
            id={f.id}
            filename={f.filename}
            url={f.url || ""}
            size={f.size}
            isLoading={f.isLoading}
            onRemove={() => removeFile(f.id)}
          />
        ))}
        {pastedTexts.map((pt) => (
          <AgentPastedTextItem
            key={pt.id}
            filePath={pt.filePath}
            filename={pt.filename}
            size={pt.size}
            preview={pt.preview}
            kind={pt.kind}
            onRemove={() => removePastedText(pt.id)}
          />
        ))}
      </div>
    ) : null

  const hasSendableContent =
    hasContent ||
    readyImageCount > 0 ||
    files.length > 0 ||
    pastedTexts.length > 0
  const showVoiceControl = isVoiceAvailable && !hasSendableContent

  // Handle container click to focus editor
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if (
      e.target === e.currentTarget ||
      !(e.target as HTMLElement).closest("button, [contenteditable]")
    ) {
      editorRef.current?.focus()
    }
  }, [])

  return (
    <div className="flex h-full flex-col relative">
      {/* Header - Simple burger on mobile, AgentsHeaderControls on desktop */}
      <div className="flex-shrink-0 flex items-center justify-between bg-background p-1.5">
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {isMobileFullscreen ? (
            // Simple burger button for mobile - just opens chats list
            <Button
              variant="ghost"
              size="icon"
              onClick={onBackToChats}
              className="h-7 w-7 p-0 hover:bg-foreground/10 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] flex-shrink-0 rounded-md"
              aria-label={t("agent.chat.allProjects")}
            >
              <AlignJustify className="h-4 w-4" />
            </Button>
          ) : (
            <AgentsHeaderControls
              isSidebarOpen={sidebarOpen}
              onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
              hasUnseenChanges={hasAnyUnseenChanges}
            />
          )}
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-y-auto relative">
        <div className="w-full max-w-2xl space-y-4 md:space-y-6 relative z-10 px-4">
          {/* Title - only show when project is selected */}
          {validatedProject && (
            <div className="text-center">
              <h1 className="text-2xl md:text-4xl font-medium tracking-tight">
                {t("chat.new.title")}
              </h1>
            </div>
          )}

          {/* Input Area */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: this container owns drag/drop for prompt attachments. */}
          <div
            className="relative w-full"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {/* biome-ignore lint/a11y/noStaticElementInteractions: clicking prompt chrome focuses the editor. */}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard focus is handled by the editor itself. */}
            <div
              className="relative w-full cursor-text"
              onClick={handleContainerClick}
            >
              <PromptInput
                className={cn(
                  "border bg-input-background relative z-10 p-2 rounded-xl transition-[border-color,box-shadow] duration-150",
                  isDragOver && "ring-2 ring-primary/50 border-primary/50",
                  isFocused && !isDragOver && "ring-2 ring-primary/50",
                )}
                maxHeight={240}
                onSubmit={handleSend}
                contextItems={contextItems}
              >
                <PromptInputContextItems />
                {imageAttachmentNotice && (
                  <div
                    className={cn(
                      "px-1 pb-1 text-[11px] leading-4",
                      imageAttachmentBlocked
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    {imageAttachmentNotice}
                  </div>
                )}
                <AgentContextRecommendations
                  draftText={draftText}
                  projectPath={validatedProject?.path}
                  isSuppressed={showMentionDropdown || showSlashDropdown}
                  onSelect={handleRecommendationSelect}
                />
                <div className="relative">
                  <AgentsMentionsEditor
                    ref={editorRef}
                    onTrigger={handleMentionTrigger}
                    onCloseTrigger={handleCloseTrigger}
                    onSlashTrigger={handleSlashTrigger}
                    onCloseSlashTrigger={handleCloseSlashTrigger}
                    onContentChange={handleContentChange}
                    onSubmit={handleSend}
                    onShiftTab={toggleMode}
                    placeholder={effectiveModePlaceholder}
                    className={cn(
                      "bg-transparent max-h-[240px] overflow-y-auto p-1 leading-5",
                      isMobileFullscreen ? "min-h-[56px]" : "min-h-[44px]",
                    )}
                    onPaste={handlePaste}
                    disabled={createChatMutation.isPending}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                  />
                </div>
                <PromptInputActions className="w-full flex-wrap gap-x-1 gap-y-1">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-0.5 gap-y-1">
                    {/* Mode toggle (Agent/Plan) */}
                    {validatedProject ? (
                      <DropdownMenu
                        open={modeDropdownOpen}
                        onOpenChange={(open) => {
                          setModeDropdownOpen(open)
                          if (!open) {
                            if (tooltipTimeoutRef.current) {
                              clearTimeout(tooltipTimeoutRef.current)
                              tooltipTimeoutRef.current = null
                            }
                            setModeTooltip(null)
                            hasShownTooltipRef.current = false
                          }
                        }}
                      >
                        <DropdownMenuTrigger
                          aria-label={modeSelectorTitle}
                          title={modeSelectorTitle}
                          className="flex max-w-[112px] min-w-0 items-center gap-1.5 px-2 py-1 text-sm text-muted-foreground hover:text-foreground transition-[background-color,color] duration-150 ease-out rounded-md hover:bg-muted/50 outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70"
                        >
                          {agentMode === "plan" ? (
                            <PlanIcon className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <AgentIcon className="h-3.5 w-3.5 shrink-0" />
                          )}
                          <span className="truncate">{modeLabel}</span>
                          <IconChevronDown className="h-3 w-3 shrink-0 opacity-50" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="start"
                          sideOffset={6}
                          className="!min-w-[116px] !w-[116px]"
                          onCloseAutoFocus={(e) => e.preventDefault()}
                        >
                          <DropdownMenuItem
                            onClick={() => {
                              // Clear tooltip before closing dropdown (onMouseLeave won't fire)
                              if (tooltipTimeoutRef.current) {
                                clearTimeout(tooltipTimeoutRef.current)
                                tooltipTimeoutRef.current = null
                              }
                              setModeTooltip(null)
                              setAgentMode("agent")
                              setModeDropdownOpen(false)
                            }}
                            className="justify-between gap-2"
                            onMouseEnter={(e) => {
                              if (tooltipTimeoutRef.current) {
                                clearTimeout(tooltipTimeoutRef.current)
                                tooltipTimeoutRef.current = null
                              }
                              const rect =
                                e.currentTarget.getBoundingClientRect()
                              const showTooltip = () => {
                                setModeTooltip({
                                  visible: true,
                                  position: {
                                    top: rect.top,
                                    left: rect.right + 8,
                                  },
                                  mode: "agent",
                                })
                                hasShownTooltipRef.current = true
                                tooltipTimeoutRef.current = null
                              }
                              if (hasShownTooltipRef.current) {
                                showTooltip()
                              } else {
                                tooltipTimeoutRef.current = setTimeout(
                                  showTooltip,
                                  1000,
                                )
                              }
                            }}
                            onMouseLeave={() => {
                              if (tooltipTimeoutRef.current) {
                                clearTimeout(tooltipTimeoutRef.current)
                                tooltipTimeoutRef.current = null
                              }
                              setModeTooltip(null)
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <AgentIcon className="w-4 h-4 text-muted-foreground" />
                              <span>{t("chat.mode.agent")}</span>
                            </div>
                            {agentMode !== "plan" && (
                              <CheckIcon className="h-3.5 w-3.5 ml-auto shrink-0" />
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              // Clear tooltip before closing dropdown (onMouseLeave won't fire)
                              if (tooltipTimeoutRef.current) {
                                clearTimeout(tooltipTimeoutRef.current)
                                tooltipTimeoutRef.current = null
                              }
                              setModeTooltip(null)
                              setAgentMode("plan")
                              setModeDropdownOpen(false)
                            }}
                            className="justify-between gap-2"
                            onMouseEnter={(e) => {
                              if (tooltipTimeoutRef.current) {
                                clearTimeout(tooltipTimeoutRef.current)
                                tooltipTimeoutRef.current = null
                              }
                              const rect =
                                e.currentTarget.getBoundingClientRect()
                              const showTooltip = () => {
                                setModeTooltip({
                                  visible: true,
                                  position: {
                                    top: rect.top,
                                    left: rect.right + 8,
                                  },
                                  mode: "plan",
                                })
                                hasShownTooltipRef.current = true
                                tooltipTimeoutRef.current = null
                              }
                              if (hasShownTooltipRef.current) {
                                showTooltip()
                              } else {
                                tooltipTimeoutRef.current = setTimeout(
                                  showTooltip,
                                  1000,
                                )
                              }
                            }}
                            onMouseLeave={() => {
                              if (tooltipTimeoutRef.current) {
                                clearTimeout(tooltipTimeoutRef.current)
                                tooltipTimeoutRef.current = null
                              }
                              setModeTooltip(null)
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <PlanIcon className="w-4 h-4 text-muted-foreground" />
                              <span>{t("chat.mode.plan")}</span>
                            </div>
                            {agentMode === "plan" && (
                              <CheckIcon className="h-3.5 w-3.5 ml-auto shrink-0" />
                            )}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                        {modeTooltip?.visible &&
                          createPortal(
                            <div
                              className="fixed z-[100000]"
                              style={{
                                top: modeTooltip.position.top + 14,
                                left: modeTooltip.position.left,
                                transform: "translateY(-50%)",
                              }}
                            >
                              <div
                                data-tooltip="true"
                                className="relative rounded-[12px] bg-popover px-2.5 py-1.5 text-xs text-popover-foreground dark max-w-[150px]"
                              >
                                <span>
                                  {modeTooltip.mode === "agent"
                                    ? t("chat.mode.agentTooltip")
                                    : t("chat.mode.planTooltip")}
                                </span>
                              </div>
                            </div>,
                            document.body,
                          )}
                      </DropdownMenu>
                    ) : (
                      <div
                        className="flex max-w-[112px] min-w-0 items-center gap-1.5 px-2 py-1 text-sm text-muted-foreground rounded-md"
                        title={t("chat.mode.agent")}
                      >
                        <AgentIcon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{t("chat.mode.agent")}</span>
                      </div>
                    )}

                    <AgentEngineSelector
                      selectedEngineId={selectedEngineId}
                      options={engineOptions}
                      onSelectEngine={handleEngineSelect}
                    />

                    <div className="group/model-controls flex min-w-0 flex-1 items-center gap-0.5">
                      <RuntimeModelSelector
                        selectedEngineId={selectedEngineId}
                        modelOpen={isModelDropdownOpen}
                        onModelOpenChange={setIsModelDropdownOpen}
                        selectedModelLabel={selectedModelLabel}
                        triggerClassName="min-w-0 max-w-full"
                        providerProfiles={providerProfiles}
                        onOpenModelsSettings={() => {
                          setSettingsActiveTab("models")
                          setSettingsDialogOpen(true)
                        }}
                        claude={{
                          models: filterCatalogPickerModels(
                            availableModels.models,
                            hiddenModels,
                          ),
                          selectedModelId: selectedModel?.id,
                          selectedModel,
                          onSelectModel: (modelId) => {
                            const model = resolveClaudeCatalogModel(
                              availableModels.models,
                              modelId,
                            )
                            setLastSelectedClaudeSelection({
                              modelSource: selectedClaudeProfileId
                                ? "claude-oauth"
                                : effectiveClaudeModelSource,
                              modelId: model.id,
                            })
                          },
                          selectedModelSource: effectiveClaudeModelSource,
                          onSelectModelSource: (source) => {
                            const persistedSource =
                              source === "auto" ? "claude-oauth" : source
                            setLastSelectedClaudeSelection({
                              modelSource: persistedSource,
                              modelId: selectedClaudeProfileId
                                ? (availableModels.models[0]?.id ?? "opus")
                                : lastSelectedModelId,
                            })
                          },
                          onSelectProviderProfile: (profile) => {
                            const binding =
                              createProviderProfileChatSessionBindingWrite({
                                runtime: "claude-code",
                                profile,
                              })
                            setLastSelectedClaudeSelection({
                              modelSource:
                                binding.modelSource as ClaudeModelSource,
                              modelId: profile.defaultModel,
                            })
                          },
                          isOffline:
                            availableModels.isOffline &&
                            availableModels.hasOllama,
                          ollamaModels: availableModels.ollamaModels,
                          selectedOllamaModel: currentOllamaModel,
                          recommendedOllamaModel:
                            availableModels.recommendedModel,
                          onSelectOllamaModel: setSelectedOllamaModel,
                          isConnected: isClaudeConnected,
                          thinkingEnabled,
                          onThinkingChange: setThinkingEnabled,
                        }}
                        codex={{
                          models: codexUiModels,
                          apiKeyModels: codexApiKeyModels,
                          selectedModelId: selectedCodexModel.id,
                          selectedModel: selectedCodexModel,
                          onSelectModel: (modelId) => {
                            const model = resolveCodexCatalogModel(
                              selectableCodexModels,
                              modelId,
                            )
                            const nextThinking = model.thinkings.includes(
                              lastSelectedCodexThinking as CodexThinkingLevel,
                            )
                              ? (lastSelectedCodexThinking as CodexThinkingLevel)
                              : model.thinkings.includes("high")
                                ? "high"
                                : getDefaultCodexThinking(model)

                            setLastSelectedCodexSelection({
                              modelSource: selectedCodexProfileId
                                ? "chatgpt"
                                : lastSelectedCodexModelSource,
                              modelId: model.id,
                              thinkingLevel: nextThinking,
                            })
                          },
                          selectedModelSource: lastSelectedCodexModelSource,
                          effectiveFirstPartyModelSource:
                            effectiveCodexFirstPartySource,
                          onSelectModelSource: (source, compatibleModelId) => {
                            const nextModel = compatibleModelId
                              ? resolveCodexCatalogModel(
                                  selectableCodexModels,
                                  compatibleModelId,
                                )
                              : selectedCodexModel
                            const nextThinking = nextModel.thinkings.includes(
                              lastSelectedCodexThinking as CodexThinkingLevel,
                            )
                              ? (lastSelectedCodexThinking as CodexThinkingLevel)
                              : nextModel.thinkings.includes("high")
                                ? "high"
                                : getDefaultCodexThinking(nextModel)
                            setLastSelectedCodexSelection({
                              modelSource: source,
                              modelId: nextModel.id,
                              thinkingLevel: nextThinking,
                            })
                          },
                          onSelectProviderProfile: (profile) => {
                            const binding =
                              createProviderProfileChatSessionBindingWrite({
                                runtime: "codex",
                                profile,
                              })
                            setLastSelectedCodexSelection({
                              modelSource:
                                binding.modelSource as CodexModelSource,
                              modelId: profile.defaultModel,
                              thinkingLevel: lastSelectedCodexThinking,
                            })
                          },
                          selectedThinking: selectedCodexThinking,
                          supportsThinking: !selectedCodexProfileId,
                          onSelectThinking: setLastSelectedCodexThinking,
                          isConnected: setupStatus.codex.connected,
                        }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-0.5 ml-auto flex-shrink-0">
                    {/* Hidden file input */}
                    <input
                      type="file"
                      ref={fileInputRef}
                      hidden
                      multiple
                      onChange={(e) => {
                        const inputFiles = Array.from(e.target.files || [])
                        handleAddAttachments(inputFiles)
                        e.target.value = "" // Reset to allow same file selection
                      }}
                    />
                    {/* Voice wave indicator or Attachment button */}
                    {isVoiceRecording ? (
                      <VoiceWaveIndicator
                        isRecording={isVoiceRecording}
                        audioLevel={voiceAudioLevel}
                      />
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-sm outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={images.length >= 5 && files.length >= 10}
                      >
                        <AttachIcon className="h-4 w-4" />
                      </Button>
                    )}
                    <div className="ml-1">
                      {showVoiceControl ? (
                        <VoiceInputControl
                          isRecording={isVoiceRecording}
                          isTranscribing={isTranscribing}
                          disabled={isUploading}
                          hotkeyLabel={voiceInputHotkey}
                          accent={effectiveMode === "plan" ? "plan" : "default"}
                          onStart={handleVoiceMouseDown}
                          onStop={handleVoiceMouseUp}
                          onCancel={handleVoiceMouseLeave}
                        />
                      ) : (
                        <AgentSendButton
                          isStreaming={false}
                          isSubmitting={
                            createChatMutation.isPending || isUploading
                          }
                          disabled={Boolean(
                            !hasSendableContent ||
                              isUploading ||
                              imageAttachmentBlocked ||
                              (isFolderlessQuickChat &&
                                (!quickChatRuntimeGateLoaded ||
                                  !selectedEngineIsRuntimeAllowed)),
                          )}
                          onClick={handleSend}
                          mode={effectiveMode}
                          hasContent={hasSendableContent}
                        />
                      )}
                    </div>
                  </div>
                </PromptInputActions>
              </PromptInput>

              {/* Project, Work Mode, and Branch selectors - directly under input */}
              <div className="mt-1.5 md:mt-2 ml-[5px] flex items-center gap-2">
                <ProjectSelector />

                {/* Work mode selector - between project and branch */}
                {validatedProject && (
                  <WorkModeSelector
                    value={workMode}
                    onChange={setWorkMode}
                    disabled={createChatMutation.isPending}
                  />
                )}

                {/* Branch selector - only visible when worktree mode is selected */}
                {validatedProject && workMode === "worktree" && (
                  <Popover
                    open={branchPopoverOpen}
                    onOpenChange={(open) => {
                      if (!open) {
                        setBranchSearch("") // Clear search on close
                      }
                      setBranchPopoverOpen(open)
                    }}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="flex items-center gap-1.5 px-2 py-1 text-sm text-muted-foreground hover:text-foreground transition-[background-color,color] duration-150 ease-out rounded-md hover:bg-muted/50 outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70"
                        disabled={branchesQuery.isLoading}
                      >
                        <BranchIcon className="w-4 h-4" />
                        <span className="truncate max-w-[100px]">
                          {selectedBranch ||
                            branchesQuery.data?.defaultBranch ||
                            "main"}
                        </span>
                        <IconChevronDown className="w-3 h-3 opacity-50" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 p-0" align="start">
                      {/* Search input with Create button */}
                      <div className="flex items-center gap-1.5 h-7 px-1.5 mx-1 my-1 rounded-md bg-muted/50">
                        <SearchIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <input
                          type="text"
                          placeholder={t("chat.branch.search")}
                          value={branchSearch}
                          onChange={(e) => setBranchSearch(e.target.value)}
                          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                          // biome-ignore lint/a11y/noAutofocus: branch search should receive focus when the popover opens.
                          autoFocus
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-1.5 flex items-center gap-1 text-xs shrink-0"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setCreateBranchDialogOpen(true)
                            setBranchPopoverOpen(false)
                          }}
                        >
                          <Plus className="h-3 w-3" />
                          {t("chat.branch.create")}
                        </Button>
                      </div>

                      {/* Virtualized branch list */}
                      {filteredBranches.length === 0 ? (
                        <div className="py-6 text-center text-sm text-muted-foreground">
                          {t("chat.branch.empty")}
                        </div>
                      ) : (
                        <div
                          ref={branchListRef}
                          className="overflow-auto py-1 scrollbar-hide"
                          style={{
                            height: Math.min(
                              filteredBranches.length * 32 + 8,
                              300,
                            ),
                          }}
                        >
                          <div
                            style={{
                              height: `${branchVirtualizer.getTotalSize()}px`,
                              width: "100%",
                              position: "relative",
                            }}
                          >
                            {branchVirtualizer
                              .getVirtualItems()
                              .map((virtualItem) => {
                                const branch =
                                  filteredBranches[virtualItem.index]
                                const isSelected =
                                  (selectedBranch === branch.name &&
                                    selectedBranchType === branch.type) ||
                                  (!selectedBranch &&
                                    branch.isDefault &&
                                    branch.type === "local")
                                return (
                                  <button
                                    type="button"
                                    key={`${branch.type}-${branch.name}`}
                                    onClick={() => {
                                      setSelectedBranch(
                                        branch.name,
                                        branch.type,
                                      )
                                      setBranchPopoverOpen(false)
                                      setBranchSearch("")
                                    }}
                                    className={cn(
                                      "flex items-center gap-1.5 w-[calc(100%-8px)] mx-1 px-1.5 text-sm text-left absolute left-0 top-0 rounded-md cursor-default select-none outline-none transition-colors",
                                      isSelected
                                        ? "dark:bg-neutral-800 text-foreground"
                                        : "dark:hover:bg-neutral-800 hover:text-foreground",
                                    )}
                                    style={{
                                      height: `${virtualItem.size}px`,
                                      transform: `translateY(${virtualItem.start}px)`,
                                    }}
                                  >
                                    <BranchIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                                    <span className="truncate flex-1">
                                      {branch.name}
                                    </span>
                                    <span
                                      className={cn(
                                        "text-[10px] px-1.5 py-0.5 rounded shrink-0",
                                        branch.type === "local"
                                          ? "bg-blue-500/10 text-blue-500"
                                          : "bg-orange-500/10 text-orange-500",
                                      )}
                                    >
                                      {branch.type}
                                    </span>
                                    {branch.committedAt && (
                                      <span className="text-xs text-muted-foreground/70 shrink-0">
                                        {formatRelativeTime(branch.committedAt)}
                                      </span>
                                    )}
                                    {branch.isDefault && (
                                      <span className="text-[10px] text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded shrink-0">
                                        default
                                      </span>
                                    )}
                                    {isSelected && (
                                      <CheckIcon className="h-4 w-4 shrink-0 ml-auto" />
                                    )}
                                  </button>
                                )
                              })}
                          </div>
                        </div>
                      )}
                    </PopoverContent>
                  </Popover>
                )}

                {/* Create Branch Dialog */}
                {validatedProject && (
                  <CreateBranchDialog
                    open={createBranchDialogOpen}
                    onOpenChange={setCreateBranchDialogOpen}
                    projectPath={validatedProject.path}
                    branches={branches}
                    defaultBranch={branchesQuery.data?.defaultBranch || "main"}
                    onBranchCreated={(branchName) => {
                      setSelectedBranch(branchName, "local")
                    }}
                  />
                )}
              </div>
              {worktreeCreateState === "creating" &&
                createChatMutation.isPending && (
                  <div
                    className="mt-2 ml-[5px] flex items-center gap-2 text-xs text-muted-foreground"
                    role="status"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                    <span>{t("chat.creatingWorktree")}</span>
                  </div>
                )}

              {/* Worktree config banner - moved to corner banner below */}

              {/* File mention dropdown */}
              {/* Desktop: use projectPath for local file search */}
              <AgentsFileMention
                isOpen={showMentionDropdown && !!validatedProject}
                onClose={() => {
                  setShowMentionDropdown(false)
                  // Reset subpage state when dropdown closes
                  setShowingFilesList(false)
                  setShowingSkillsList(false)
                  setShowingAgentsList(false)
                  setShowingToolsList(false)
                }}
                onSelect={handleMentionSelect}
                searchText={mentionSearchText}
                position={mentionPosition}
                projectPath={validatedProject?.path}
                showingFilesList={showingFilesList}
                showingSkillsList={showingSkillsList}
                showingAgentsList={showingAgentsList}
                showingToolsList={showingToolsList}
              />

              {/* Slash command dropdown */}
              <AgentsSlashCommand
                isOpen={showSlashDropdown}
                onClose={handleCloseSlashTrigger}
                onSelect={handleSlashSelect}
                searchText={slashSearchText}
                position={slashPosition}
                projectPath={validatedProject?.path}
                mode={agentMode}
                disabledCommands={["clear"]}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Worktree config banner - fixed bottom-right corner */}
      {showWorktreeBanner && (
        <div className="absolute bottom-4 right-4 max-w-sm p-3 pb-4 bg-muted/50 backdrop-blur-sm rounded-lg border border-border space-y-3 shadow-lg z-50">
          <p className="text-sm text-muted-foreground">
            {t("chat.worktreeSetupBanner.description")}
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleConfigureWorktree}
            >
              {t("common.settings")}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const prompt = COMMAND_PROMPTS["worktree-setup"]
                if (prompt && projectForChat) {
                  createChatMutation.mutate({
                    projectId: projectForChat.id,
                    name: t("chat.worktreeSetupBanner.chatName"),
                    binding: selectedChatBinding,
                    initialMessageParts: [{ type: "text", text: prompt }],
                    useWorktree: false,
                    mode: "agent",
                  })
                }
              }}
            >
              {t("chat.worktreeSetupBanner.fillWithAI")}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
