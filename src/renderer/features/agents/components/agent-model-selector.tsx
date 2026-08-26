"use client"

import { Brain, ChevronRight, Info, Plus, Zap } from "lucide-react"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { isSafeProviderModel } from "../../../../shared/local-job-api"
import {
  isProviderProfileSource,
  providerProfileSource,
} from "../../../../shared/provider-profile-types"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "../../../components/ui/command"
import {
  CheckIcon,
  ClaudeCodeIcon,
  IconChevronDown,
  ThinkingIcon,
} from "../../../components/ui/icons"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover"
import { Switch } from "../../../components/ui/switch"
import { useI18n } from "../../../lib/i18n"
import { cn } from "../../../lib/utils"
import type { ClaudeModelSource, CodexModelSource } from "../atoms"
import {
  type ClaudeCatalogModel,
  type CodexCatalogModel,
  getVisibleCodexApiKeyModels,
} from "../lib/model-catalog-selection"
import type {
  CodexFirstPartyModelSource,
  CodexThinkingLevel,
  ModelInfo,
} from "../lib/models"
import {
  formatCodexThinkingLabel,
  isCodexModelSupportedBySource,
  resolveCodexModelForSource,
} from "../lib/models"

const CodexIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
  </svg>
)

export type AgentProviderId = "claude-code" | "codex"

type ClaudeModelOption = ClaudeCatalogModel

type CodexModelOption = CodexCatalogModel

type ProviderProfileOption = {
  id: string
  name: string
  presetId: string | null
  defaultModel: string
  targetRuntimes: string[]
  capabilities?: {
    claude?: boolean
    codex?: boolean
    local?: boolean
    helpers?: boolean
  }
  lastTestStatus?: {
    ok: boolean
    message: string
  } | null
}

interface AgentModelSelectorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedAgentId: AgentProviderId
  disabled?: boolean
  selectedModelLabel: string
  triggerClassName?: string
  contentClassName?: string
  onOpenModelsSettings?: () => void
  providerProfiles?: ProviderProfileOption[]
  claude: {
    models: ClaudeModelOption[]
    selectedModelId?: string
    selectedModel?: ClaudeModelOption
    onSelectModel: (modelId: string) => void
    selectedModelSource: ClaudeModelSource
    onSelectModelSource: (source: ClaudeModelSource) => void
    onSelectProviderProfile: (profile: ProviderProfileOption) => void
    isOffline: boolean
    ollamaModels: string[]
    selectedOllamaModel?: string
    recommendedOllamaModel?: string
    onSelectOllamaModel: (modelId: string) => void
    isConnected: boolean
    thinkingEnabled: boolean
    onThinkingChange: (enabled: boolean) => void
  }
  codex: {
    models: CodexModelOption[]
    apiKeyModels: CodexModelOption[]
    selectedModelId: string
    selectedModel: CodexModelOption
    onSelectModel: (modelId: string) => void
    selectedModelSource: CodexModelSource
    effectiveFirstPartyModelSource: CodexFirstPartyModelSource | null
    onSelectModelSource: (
      source: CodexModelSource,
      compatibleModelId?: string,
    ) => void
    onSelectProviderProfile: (profile: ProviderProfileOption) => void
    selectedThinking: CodexThinkingLevel
    onSelectThinking: (thinking: CodexThinkingLevel) => void
    supportsThinking?: boolean
    isConnected: boolean
  }
}

type FlatModelItem =
  | { type: "claude"; model: ClaudeModelOption }
  | { type: "codex"; model: CodexModelOption }
  | { type: "ollama"; modelName: string; isRecommended: boolean }
  | {
      type: "provider-profile"
      profile: ProviderProfileOption
      runtime: "claude" | "codex" | "local"
    }

type ModelGroupId =
  | "claude"
  | "claudeProfiles"
  | "codex"
  | "codexApiKey"
  | "codexProfiles"
  | "local"

type ActiveModelInfo = {
  info: ModelInfo
  modelLabel: string
  top: number
  left: number
}

function ModelStatusBadge({
  model,
}: {
  model: ClaudeModelOption | CodexModelOption
}) {
  const { t } = useI18n()
  const label = model.deprecated
    ? t("agent.model.deprecated")
    : model.kind === "api-key"
      ? t("common.apiKey")
      : model.kind !== "catalog"
        ? t("agent.model.customModel")
        : null
  if (!label) return null
  return (
    <span className="shrink-0 rounded border border-border/70 bg-muted/60 px-1 py-0.5 text-[9px] font-medium leading-none text-muted-foreground">
      {label}
    </span>
  )
}

function getProviderProfileProvider(
  profile: ProviderProfileOption,
  runtime: "claude" | "codex" | "local",
): AgentProviderId {
  if (runtime === "codex") return "codex"
  if (runtime === "claude") return "claude-code"
  return profile.targetRuntimes.includes("codex") ? "codex" : "claude-code"
}

function isDomNode(target: EventTarget | null): target is Node {
  return typeof Node !== "undefined" && target instanceof Node
}

function CodexThinkingSubMenu({
  thinkings,
  selectedThinking,
  onSelectThinking,
}: {
  thinkings: CodexThinkingLevel[]
  selectedThinking: CodexThinkingLevel
  onSelectThinking: (thinking: CodexThinkingLevel) => void
}) {
  const { t } = useI18n()
  const triggerRef = useRef<HTMLDivElement>(null)
  const subMenuRef = useRef<HTMLDivElement>(null)
  const [showSub, setShowSub] = useState(false)
  const [subPos, setSubPos] = useState({ top: 0, left: 0 })
  const closeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleClose = useCallback(() => {
    closeTimeout.current = setTimeout(() => setShowSub(false), 150)
  }, [])

  const cancelClose = useCallback(() => {
    if (closeTimeout.current) {
      clearTimeout(closeTimeout.current)
      closeTimeout.current = null
    }
  }, [])

  const handleTriggerEnter = useCallback(() => {
    cancelClose()
    if (triggerRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect()
      const popoverEl = triggerRef.current.closest(
        "[data-radix-popper-content-wrapper] > *",
      )
      setSubPos({
        top: triggerRect.top - 4,
        left: triggerRect.right + 6,
      })
    }
    setShowSub(true)
  }, [cancelClose])

  const handleTriggerLeave = useCallback(
    (e: React.MouseEvent) => {
      const related = e.relatedTarget
      if (isDomNode(related) && subMenuRef.current?.contains(related)) return
      scheduleClose()
    },
    [scheduleClose],
  )

  const handleSubLeave = useCallback(
    (e: React.MouseEvent) => {
      const related = e.relatedTarget
      if (isDomNode(related) && triggerRef.current?.contains(related)) return
      scheduleClose()
    },
    [scheduleClose],
  )

  useEffect(() => {
    return () => {
      if (closeTimeout.current) {
        clearTimeout(closeTimeout.current)
      }
    }
  }, [])

  return (
    <div className="py-1">
      <div
        ref={triggerRef}
        onMouseEnter={handleTriggerEnter}
        onMouseLeave={handleTriggerLeave}
        className={cn(
          "flex items-center justify-between gap-1.5 min-h-[32px] py-[5px] px-1.5 mx-1 rounded-md text-sm cursor-default select-none outline-none transition-colors",
          showSub
            ? "dark:bg-neutral-800 bg-accent text-foreground"
            : "dark:hover:bg-neutral-800 hover:text-foreground",
        )}
      >
        <div className="flex items-center gap-1.5">
          <Brain className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span>{t("agent.model.thinking")}</span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <span className="text-xs">
            {formatCodexThinkingLabel(selectedThinking)}
          </span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        </div>
      </div>

      {showSub &&
        createPortal(
          <div
            ref={subMenuRef}
            onMouseEnter={cancelClose}
            onMouseLeave={handleSubLeave}
            className="fixed z-50 min-w-[180px] overflow-auto rounded-[10px] border border-border bg-popover text-sm text-popover-foreground shadow-lg py-1 animate-in fade-in-0 zoom-in-95 slide-in-from-left-2"
            style={{ top: subPos.top, left: subPos.left }}
          >
            {thinkings.map((thinking) => {
              const isSelected = selectedThinking === thinking
              return (
                <button
                  key={thinking}
                  onClick={() => onSelectThinking(thinking)}
                  className="flex items-center justify-between gap-4 min-h-[32px] py-[5px] px-1.5 mx-1 w-[calc(100%-8px)] rounded-md text-sm cursor-default select-none outline-none dark:hover:bg-neutral-800 hover:text-foreground transition-colors"
                >
                  <span>{formatCodexThinkingLabel(thinking)}</span>
                  {isSelected && <CheckIcon className="h-3.5 w-3.5 shrink-0" />}
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}

function CodexAccountSourceControl({
  selectedSource,
  onSelectSource,
}: {
  selectedSource: CodexFirstPartyModelSource
  onSelectSource: (source: CodexFirstPartyModelSource) => void
}) {
  const { t } = useI18n()
  const sources: CodexFirstPartyModelSource[] = ["chatgpt", "openai-api-key"]

  return (
    <fieldset className="space-y-1.5 px-2 py-2">
      <legend className="text-[11px] font-medium uppercase text-muted-foreground">
        {t("agent.model.codexAccountSource")}
      </legend>
      <div className="grid grid-cols-2 gap-1 rounded-md bg-muted/50 p-1">
        {sources.map((source) => {
          const selected = selectedSource === source
          return (
            <button
              key={source}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelectSource(source)}
              className={cn(
                "min-h-7 rounded-sm px-2 text-xs font-medium transition-colors outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70",
                selected
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {source === "chatgpt"
                ? t("agent.model.codexChatGPTAccount")
                : t("agent.model.codexOpenAIApiKey")}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

function ModelInfoButton({
  info,
  modelLabel,
  onShow,
  onHide,
}: {
  info: ModelInfo
  modelLabel: string
  onShow: (info: ModelInfo, modelLabel: string, anchor: HTMLElement) => void
  onHide: (modelLabel: string) => void
}) {
  const { t } = useI18n()

  const stopSelection = (event: React.SyntheticEvent) => {
    event.stopPropagation()
  }

  const show = (
    event:
      | React.MouseEvent<HTMLButtonElement>
      | React.FocusEvent<HTMLButtonElement>,
  ) => {
    stopSelection(event)
    onShow(info, modelLabel, event.currentTarget)
  }

  return (
    <button
      type="button"
      aria-label={t("agent.model.info.aria", { model: modelLabel })}
      onPointerDown={stopSelection}
      onMouseDown={(event) => {
        event.preventDefault()
        stopSelection(event)
      }}
      onMouseEnter={show}
      onFocus={show}
      onMouseLeave={() => onHide(modelLabel)}
      onBlur={() => onHide(modelLabel)}
      onClick={stopSelection}
      onKeyDown={stopSelection}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground"
    >
      <Info className="h-3.5 w-3.5" />
    </button>
  )
}

function ModelInfoPanel({ activeInfo }: { activeInfo: ActiveModelInfo }) {
  const { t } = useI18n()
  const { info, modelLabel, top, left } = activeInfo
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelTop, setPanelTop] = useState(top)
  const [panelMaxHeight, setPanelMaxHeight] = useState<number | undefined>()

  const rows = [
    [t("agent.model.info.context"), info.contextWindow],
    [t("agent.model.info.maxOutput"), info.maxOutput],
    [t("agent.model.info.pricing"), info.pricing],
    ...(info.cachedInput
      ? [[t("agent.model.info.cachedInput"), info.cachedInput]]
      : []),
    ...(info.latency ? [[t("agent.model.info.latency"), info.latency]] : []),
  ].filter((row): row is [string, string] => Boolean(row[1]))

  useLayoutEffect(() => {
    const gap = 8

    const updatePosition = () => {
      const viewportHeight = window.innerHeight
      const maxAvailableHeight = Math.max(180, viewportHeight - gap * 2)
      const measuredHeight =
        panelRef.current?.scrollHeight ?? maxAvailableHeight
      const panelHeight = Math.min(measuredHeight, maxAvailableHeight)
      const nextTop = Math.min(
        Math.max(gap, top),
        Math.max(gap, viewportHeight - panelHeight - gap),
      )

      setPanelTop(nextTop)
      setPanelMaxHeight(Math.max(180, viewportHeight - nextTop - gap))
    }

    updatePosition()
    window.addEventListener("resize", updatePosition)
    return () => window.removeEventListener("resize", updatePosition)
  }, [info, modelLabel, top])

  return (
    <div
      ref={panelRef}
      className="fixed z-[70] flex w-80 max-w-[320px] pointer-events-none flex-col items-start gap-2 overflow-y-auto rounded-md border border-border bg-popover p-3 text-left text-popover-foreground shadow-lg dark"
      style={{ top: panelTop, left, maxHeight: panelMaxHeight }}
    >
      <div className="space-y-1">
        <div className="text-sm font-medium text-popover-foreground">
          {modelLabel}
        </div>
        {info.summary && (
          <p className="text-xs text-muted-foreground">{info.summary}</p>
        )}
      </div>

      {rows.length > 0 && (
        <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <span className="text-muted-foreground">{label}</span>
              <span className="min-w-0 text-popover-foreground">{value}</span>
            </div>
          ))}
        </div>
      )}

      {info.bestFor && (
        <div className="space-y-1 border-t border-border/60 pt-2">
          <div className="text-[11px] font-medium uppercase text-muted-foreground">
            {t("agent.model.info.bestFor")}
          </div>
          <p className="text-xs text-popover-foreground">{info.bestFor}</p>
        </div>
      )}

      {info.tokenNote && (
        <div className="rounded-md bg-muted/50 px-2 py-1.5 text-[11px] text-muted-foreground">
          <span className="font-medium">
            {t("agent.model.info.tokenNote")}:{" "}
          </span>
          {info.tokenNote}
        </div>
      )}
    </div>
  )
}

export function AgentModelSelector({
  open,
  onOpenChange,
  selectedAgentId,
  disabled = false,
  selectedModelLabel,
  triggerClassName,
  contentClassName,
  onOpenModelsSettings,
  providerProfiles = [],
  claude,
  codex,
}: AgentModelSelectorProps) {
  const { t } = useI18n()
  const [search, setSearch] = useState("")
  const [activeModelInfo, setActiveModelInfo] =
    useState<ActiveModelInfo | null>(null)
  const [codexCompatibilityNotice, setCodexCompatibilityNotice] = useState<
    string | null
  >(null)
  const [customEntryProvider, setCustomEntryProvider] =
    useState<AgentProviderId | null>(null)
  const [customModelId, setCustomModelId] = useState("")
  const [customModelAttempted, setCustomModelAttempted] = useState(false)
  const customModelInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!customEntryProvider) return
    const timer = setTimeout(() => customModelInputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [customEntryProvider])

  const providerIsAllowed = useCallback(
    (provider: AgentProviderId) => provider === selectedAgentId,
    [selectedAgentId],
  )
  const selectedClaudeModelSource = claude.selectedModelSource
  const selectedFirstPartyCodexSource = codex.effectiveFirstPartyModelSource
  const codexModelSelectionSource = selectedFirstPartyCodexSource ?? "chatgpt"

  // Build flat list of all models (show all regardless of connection status)
  const allModels = useMemo<FlatModelItem[]>(() => {
    const items: FlatModelItem[] = []

    if (providerIsAllowed("claude-code")) {
      if (claude.isOffline && claude.ollamaModels.length > 0) {
        for (const m of claude.ollamaModels) {
          items.push({
            type: "ollama",
            modelName: m,
            isRecommended: m === claude.recommendedOllamaModel,
          })
        }
      } else {
        for (const m of claude.models) {
          if (m.deprecated) continue
          items.push({ type: "claude", model: m })
        }
      }
    }

    for (const profile of providerProfiles) {
      if (profile.targetRuntimes.includes("local")) {
        if (providerIsAllowed(getProviderProfileProvider(profile, "local"))) {
          items.push({ type: "provider-profile", profile, runtime: "local" })
        }
        continue
      }
      if (
        providerIsAllowed("claude-code") &&
        profile.targetRuntimes.includes("claude")
      ) {
        items.push({ type: "provider-profile", profile, runtime: "claude" })
      }
    }

    if (providerIsAllowed("codex")) {
      for (const m of codex.models) {
        if (m.deprecated) continue
        items.push({ type: "codex", model: m })
      }
      for (const m of getVisibleCodexApiKeyModels(
        codex.apiKeyModels,
        selectedFirstPartyCodexSource,
      )) {
        items.push({ type: "codex", model: m })
      }
    }

    for (const profile of providerProfiles) {
      if (profile.targetRuntimes.includes("local")) continue
      if (
        providerIsAllowed("codex") &&
        profile.targetRuntimes.includes("codex")
      ) {
        items.push({ type: "provider-profile", profile, runtime: "codex" })
      }
    }

    return items
  }, [claude, codex, providerIsAllowed, providerProfiles])

  // Filter by search
  const filteredModels = useMemo(() => {
    if (!search.trim()) return allModels
    const q = search.toLowerCase().trim()
    return allModels.filter((item) => {
      switch (item.type) {
        case "claude":
          return (
            item.model.name.toLowerCase().includes(q) ||
            item.model.displayLabel.toLowerCase().includes(q)
          )
        case "codex":
          return item.model.displayLabel.toLowerCase().includes(q)
        case "ollama":
          return item.modelName.toLowerCase().includes(q)
        case "provider-profile":
          return (
            item.profile.name.toLowerCase().includes(q) ||
            item.profile.defaultModel.toLowerCase().includes(q) ||
            (item.profile.presetId ?? "").toLowerCase().includes(q)
          )
      }
    })
  }, [allModels, search, t])

  const getItemGroup = useCallback((item: FlatModelItem): ModelGroupId => {
    switch (item.type) {
      case "claude":
        return "claude"
      case "provider-profile":
        if (item.runtime === "claude") return "claudeProfiles"
        if (item.runtime === "codex") return "codexProfiles"
        return "local"
      case "codex":
        return item.model.kind === "api-key" ? "codexApiKey" : "codex"
      case "ollama":
        return "local"
    }
  }, [])

  const getGroupHeading = useCallback(
    (group: ModelGroupId): string => {
      switch (group) {
        case "claude":
          return t("agent.model.group.claudeCodeOAuth")
        case "claudeProfiles":
          return t("agent.model.group.claudeProviderProfiles")
        case "codex":
          return t("agent.model.group.codexOfficial")
        case "codexApiKey":
          return t("agent.model.group.codexApiKeyAvailable")
        case "codexProfiles":
          return t("agent.model.group.codexProviderProfiles")
        case "local":
          return t("agent.model.group.localProviderProfiles")
      }
    },
    [t],
  )

  const groupedFilteredModels = useMemo(() => {
    const groups: Record<ModelGroupId, FlatModelItem[]> = {
      claude: [],
      claudeProfiles: [],
      codex: [],
      codexApiKey: [],
      codexProfiles: [],
      local: [],
    }

    for (const item of filteredModels) {
      groups[getItemGroup(item)].push(item)
    }

    return (
      [
        "claude",
        "claudeProfiles",
        "codex",
        "codexApiKey",
        "codexProfiles",
        "local",
      ] as ModelGroupId[]
    )
      .map((id) => ({ id, heading: getGroupHeading(id), items: groups[id] }))
      .filter((group) => group.items.length > 0)
  }, [filteredModels, getGroupHeading, getItemGroup])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen && disabled) return
      onOpenChange(nextOpen)
      if (!nextOpen) {
        setSearch("")
        setActiveModelInfo(null)
        setCustomEntryProvider(null)
        setCustomModelId("")
        setCustomModelAttempted(false)
      }
    },
    [disabled, onOpenChange],
  )

  useEffect(() => {
    if (disabled && open) {
      onOpenChange(false)
    }
  }, [disabled, onOpenChange, open])

  const handleCustomModelSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!customEntryProvider || !isSafeProviderModel(customModelId)) {
        setCustomModelAttempted(true)
        return
      }

      if (customEntryProvider === "claude-code") {
        claude.onSelectModel(customModelId)
      } else {
        setCodexCompatibilityNotice(null)
        codex.onSelectModel(customModelId)
      }
      handleOpenChange(false)
    },
    [claude, codex, customEntryProvider, customModelId, handleOpenChange],
  )

  const showModelInfo = useCallback(
    (info: ModelInfo, modelLabel: string, anchor: HTMLElement) => {
      const rect = anchor.getBoundingClientRect()
      const panelWidth = 320
      const panelMinHeight = 220
      const gap = 8
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const left =
        rect.right + gap + panelWidth <= viewportWidth - gap
          ? rect.right + gap
          : Math.max(gap, rect.left - panelWidth - gap)
      const top = Math.min(
        Math.max(gap, rect.top - gap),
        Math.max(gap, viewportHeight - panelMinHeight - gap),
      )

      setActiveModelInfo({ info, modelLabel, top, left })
    },
    [],
  )

  const hideModelInfo = useCallback((modelLabel: string) => {
    setActiveModelInfo((current) =>
      current?.modelLabel === modelLabel ? null : current,
    )
  }, [])

  const triggerIcon =
    selectedAgentId === "claude-code" &&
    claude.isOffline &&
    claude.ollamaModels.length > 0 ? (
      <Zap className="h-4 w-4" />
    ) : selectedAgentId === "codex" ? (
      <CodexIcon className="h-3.5 w-3.5" />
    ) : (
      <ClaudeCodeIcon className="h-3.5 w-3.5" />
    )
  const selectedCatalogModel =
    selectedAgentId === "codex"
      ? selectedFirstPartyCodexSource
        ? codex.selectedModel
        : undefined
      : selectedClaudeModelSource === "claude-oauth" && !claude.isOffline
        ? claude.selectedModel
        : undefined
  const showCustomModelEntry =
    (selectedAgentId === "codex" && selectedFirstPartyCodexSource !== null) ||
    (selectedAgentId === "claude-code" &&
      selectedClaudeModelSource === "claude-oauth" &&
      !claude.isOffline)
  const customModelIsInvalid =
    (customModelAttempted || customModelId.length > 0) &&
    !isSafeProviderModel(customModelId)

  const isItemSelected = (item: FlatModelItem): boolean => {
    switch (item.type) {
      case "claude":
        return (
          selectedAgentId === "claude-code" &&
          selectedClaudeModelSource === "claude-oauth" &&
          claude.selectedModelId === item.model.id
        )
      case "codex":
        return (
          selectedAgentId === "codex" &&
          !isProviderProfileSource(codex.selectedModelSource) &&
          codex.selectedModelId === item.model.id
        )
      case "ollama":
        return (
          selectedAgentId === "claude-code" &&
          claude.selectedOllamaModel === item.modelName
        )
      case "provider-profile": {
        const source = providerProfileSource(item.profile.id)
        if (item.runtime === "claude") {
          return (
            selectedAgentId === "claude-code" &&
            selectedClaudeModelSource === source
          )
        }
        return (
          selectedAgentId === "codex" && codex.selectedModelSource === source
        )
      }
    }
  }

  const getItemProvider = (item: FlatModelItem): AgentProviderId => {
    if (item.type === "codex") return "codex"
    if (item.type === "provider-profile") {
      return getProviderProfileProvider(item.profile, item.runtime)
    }
    return "claude-code"
  }

  const isItemDisabled = (item: FlatModelItem): boolean => {
    if (
      item.type === "provider-profile" &&
      item.profile.lastTestStatus?.ok === false
    ) {
      return true
    }
    if (
      item.type === "codex" &&
      !isCodexModelSupportedBySource(codexModelSelectionSource, item.model)
    ) {
      return true
    }
    return !providerIsAllowed(getItemProvider(item))
  }

  const getItemDisabledReason = (item: FlatModelItem): string | null => {
    if (
      item.type === "codex" &&
      !isCodexModelSupportedBySource(codexModelSelectionSource, item.model)
    ) {
      return codexModelSelectionSource === "openai-api-key"
        ? t("agent.model.codexRequiresChatGPTAccount")
        : t("agent.model.codexRequiresApiKey")
    }
    return null
  }

  const handleItemClick = (item: FlatModelItem) => {
    const provider = getItemProvider(item)
    if (!providerIsAllowed(provider)) {
      return
    }

    switch (item.type) {
      case "claude":
        if (!providerIsAllowed("claude-code")) return
        claude.onSelectModel(item.model.id)
        break
      case "codex":
        if (!providerIsAllowed("codex")) return
        if (
          !isCodexModelSupportedBySource(codexModelSelectionSource, item.model)
        ) {
          return
        }
        setCodexCompatibilityNotice(null)
        codex.onSelectModel(item.model.id)
        break
      case "ollama":
        if (!providerIsAllowed("claude-code")) return
        claude.onSelectOllamaModel(item.modelName)
        break
      case "provider-profile": {
        const targetProvider = getItemProvider(item)
        if (!providerIsAllowed(targetProvider)) return
        if (targetProvider === "claude-code") {
          claude.onSelectProviderProfile(item.profile)
        } else {
          setCodexCompatibilityNotice(null)
          codex.onSelectProviderProfile(item.profile)
        }
        break
      }
    }
    handleOpenChange(false)
  }

  const handleCodexAccountSourceSelect = useCallback(
    (source: CodexFirstPartyModelSource) => {
      if (!providerIsAllowed("codex")) return
      if (
        codex.selectedModel.kind === "custom" ||
        isCodexModelSupportedBySource(source, codex.selectedModel)
      ) {
        codex.onSelectModelSource(source)
        setCodexCompatibilityNotice(null)
        return
      }
      const resolved = resolveCodexModelForSource({
        models: codex.models,
        selectedModelId: codex.selectedModelId,
        source,
      })

      if (resolved.model && resolved.changed) {
        codex.onSelectModelSource(source, resolved.model.id)
        setCodexCompatibilityNotice(
          t("agent.model.codexSourceAutoSwitchedModel", {
            model: resolved.model.name,
          }),
        )
        return
      }

      codex.onSelectModelSource(source)
      setCodexCompatibilityNotice(null)
    },
    [codex, providerIsAllowed, t],
  )

  const getItemIcon = (item: FlatModelItem) => {
    switch (item.type) {
      case "claude":
        return (
          <ClaudeCodeIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )
      case "codex":
        return (
          <CodexIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )
      case "ollama":
        return <Zap className="h-4 w-4 text-muted-foreground shrink-0" />
      case "provider-profile":
        return item.runtime === "claude" ? (
          <ClaudeCodeIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <CodexIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )
    }
  }

  const getItemLabel = (item: FlatModelItem): string => {
    switch (item.type) {
      case "claude":
        return item.model.displayLabel
      case "codex":
        return item.model.displayLabel
      case "ollama":
        return (
          item.modelName +
          (item.isRecommended ? ` ${t("agent.model.recommendedSuffix")}` : "")
        )
      case "provider-profile":
        return `${item.profile.name} · ${item.profile.defaultModel}`
    }
  }

  const getItemInfo = (item: FlatModelItem): ModelInfo | null => {
    switch (item.type) {
      case "claude":
      case "codex":
        return item.model.info ?? null
      case "ollama":
      case "provider-profile":
        return null
    }
  }

  const getItemKey = (item: FlatModelItem): string => {
    switch (item.type) {
      case "claude":
        return `claude-${item.model.id}`
      case "codex":
        return `codex-${item.model.kind}-${item.model.id}`
      case "ollama":
        return `ollama-${item.modelName}`
      case "provider-profile":
        return `provider-profile-${item.runtime}-${item.profile.id}`
    }
  }

  return (
    <Popover open={disabled ? false : open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={t("agent.model.selector")}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 text-sm text-muted-foreground transition-[background-color,color] duration-150 ease-out rounded-md outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70",
            "hover:text-foreground hover:bg-muted/50",
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
            triggerClassName,
          )}
        >
          {triggerIcon}
          <span className="truncate">{selectedModelLabel}</span>
          {selectedCatalogModel && (
            <ModelStatusBadge model={selectedCatalogModel} />
          )}
          <IconChevronDown className="h-3 w-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className={cn("w-64 p-0", contentClassName)}
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t("agent.model.searchPlaceholder")}
            value={search}
            onValueChange={setSearch}
          />

          {selectedAgentId === "codex" && selectedFirstPartyCodexSource && (
            <>
              <CodexAccountSourceControl
                selectedSource={selectedFirstPartyCodexSource}
                onSelectSource={handleCodexAccountSourceSelect}
              />
              {codexCompatibilityNotice && (
                <div className="mx-2 mb-2 rounded-md border border-border/60 bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
                  {codexCompatibilityNotice}
                </div>
              )}
              {selectedFirstPartyCodexSource === "openai-api-key" && (
                <div className="mx-2 mb-2 rounded-md border border-border/60 bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
                  {t("agent.model.codexApiKeyCompatibilityNotice")}
                </div>
              )}
              {codex.selectedModel.kind === "custom" && (
                <div className="mx-2 mb-2 rounded-md border border-border/60 bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
                  {t("agent.model.customCompatibilityUnknown")}
                </div>
              )}
              <CommandSeparator />
            </>
          )}

          {/* Claude thinking toggle */}
          {selectedAgentId === "claude-code" &&
            !claude.isOffline &&
            selectedClaudeModelSource === "claude-oauth" && (
              <>
                <div className="flex items-center justify-between min-h-[32px] py-[5px] px-1.5 mx-1">
                  <div className="flex items-center gap-1.5">
                    <ThinkingIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm">{t("agent.model.thinking")}</span>
                  </div>
                  <Switch
                    checked={claude.thinkingEnabled}
                    onCheckedChange={claude.onThinkingChange}
                    className="scale-75"
                  />
                </div>
                <CommandSeparator />
              </>
            )}

          {/* Codex thinking level selector with hover sub-menu */}
          {selectedAgentId === "codex" &&
            codex.supportsThinking !== false &&
            (() => {
              return (
                <>
                  <CodexThinkingSubMenu
                    thinkings={codex.selectedModel.thinkings}
                    selectedThinking={codex.selectedThinking}
                    onSelectThinking={codex.onSelectThinking}
                  />
                  <CommandSeparator />
                </>
              )
            })()}

          <CommandList
            className="max-h-[300px] overflow-y-auto"
            onScroll={() => setActiveModelInfo(null)}
          >
            {groupedFilteredModels.length > 0 ? (
              groupedFilteredModels.map((group) => (
                <CommandGroup key={group.id} heading={group.heading}>
                  {group.items.map((item) => {
                    const selected = isItemSelected(item)
                    const disabled = isItemDisabled(item)
                    const label = getItemLabel(item)
                    const info = getItemInfo(item)
                    const disabledReason = disabled
                      ? getItemDisabledReason(item)
                      : null
                    return (
                      <CommandItem
                        key={getItemKey(item)}
                        value={getItemKey(item)}
                        onSelect={() => handleItemClick(item)}
                        disabled={disabled}
                        className="gap-2"
                      >
                        {getItemIcon(item)}
                        <div className="flex min-w-0 flex-1 items-center gap-1.5">
                          <span className="min-w-0 truncate">{label}</span>
                          {(item.type === "claude" ||
                            item.type === "codex") && (
                            <ModelStatusBadge model={item.model} />
                          )}
                          {info && (
                            <ModelInfoButton
                              info={info}
                              modelLabel={label}
                              onShow={showModelInfo}
                              onHide={hideModelInfo}
                            />
                          )}
                        </div>
                        {disabledReason && (
                          <span className="max-w-[104px] truncate text-[10px] text-muted-foreground shrink-0">
                            {disabledReason}
                          </span>
                        )}
                        {selected && <CheckIcon className="h-4 w-4 shrink-0" />}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              ))
            ) : (
              <CommandEmpty>{t("agent.model.noModelsFound")}</CommandEmpty>
            )}
            {showCustomModelEntry && (
              <>
                <CommandSeparator />
                {customEntryProvider === selectedAgentId ? (
                  <form
                    className="mx-1 space-y-1.5 rounded-md border border-border/70 bg-muted/30 p-2"
                    onSubmit={handleCustomModelSubmit}
                    onKeyDown={(event) => {
                      event.stopPropagation()
                      if (event.key === "Escape") {
                        event.preventDefault()
                        setCustomEntryProvider(null)
                        setCustomModelId("")
                        setCustomModelAttempted(false)
                      }
                    }}
                  >
                    <label className="block text-[11px] font-medium text-muted-foreground">
                      {t("agent.model.customEntry")}
                      <input
                        ref={customModelInputRef}
                        value={customModelId}
                        maxLength={200}
                        aria-invalid={customModelIsInvalid}
                        aria-label={t("agent.model.customModelId")}
                        placeholder={t("agent.model.customPlaceholder")}
                        onChange={(event) =>
                          setCustomModelId(event.target.value)
                        }
                        className="mt-1 h-7 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
                      />
                    </label>
                    {customModelIsInvalid && (
                      <p className="text-[10px] leading-4 text-destructive">
                        {t("agent.model.customInvalid")}
                      </p>
                    )}
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setCustomEntryProvider(null)
                          setCustomModelId("")
                          setCustomModelAttempted(false)
                        }}
                        className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        {t("common.cancel")}
                      </button>
                      <button
                        type="submit"
                        disabled={!isSafeProviderModel(customModelId)}
                        className="rounded bg-primary px-2 py-1 text-[11px] text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {t("agent.model.useCustomModel")}
                      </button>
                    </div>
                  </form>
                ) : (
                  <CommandItem
                    value={`custom-model-${selectedAgentId}`}
                    onSelect={() => {
                      setCustomEntryProvider(selectedAgentId)
                      setCustomModelId("")
                      setCustomModelAttempted(false)
                    }}
                    className="gap-2"
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span>{t("agent.model.customEntry")}</span>
                  </CommandItem>
                )}
              </>
            )}
          </CommandList>

          {onOpenModelsSettings && (
            <div className="border-t border-border/50 py-1">
              <button
                onClick={() => {
                  onOpenModelsSettings()
                  handleOpenChange(false)
                }}
                className="flex items-center gap-1.5 min-h-[32px] py-[5px] px-1.5 mx-1 w-[calc(100%-8px)] rounded-md text-sm cursor-default select-none outline-none dark:hover:bg-neutral-800 hover:text-foreground transition-colors"
              >
                <span className="flex-1 text-left">
                  {t("agent.model.addModels")}
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            </div>
          )}
        </Command>
      </PopoverContent>

      {activeModelInfo &&
        typeof document !== "undefined" &&
        createPortal(
          <ModelInfoPanel activeInfo={activeModelInfo} />,
          document.body,
        )}
    </Popover>
  )
}
