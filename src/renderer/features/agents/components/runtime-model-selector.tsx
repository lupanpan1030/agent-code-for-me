"use client"

import type { ComponentProps } from "react"
import type { AgentChatProvider } from "../../../../shared/agent-chat-provider"
import { AgentModelSelector } from "./agent-model-selector"

type AgentModelSelectorProps = ComponentProps<typeof AgentModelSelector>

export function RuntimeModelSelector({
  selectedEngineId,
  selectedModelLabel,
  modelOpen,
  onModelOpenChange,
  triggerClassName,
  contentClassName,
  providerProfiles = [],
  onOpenModelsSettings,
  claude,
  codex,
}: {
  selectedEngineId: AgentChatProvider
  selectedModelLabel: string
  modelOpen: boolean
  onModelOpenChange: (open: boolean) => void
  triggerClassName?: string
  contentClassName?: string
  providerProfiles?: AgentModelSelectorProps["providerProfiles"]
  onOpenModelsSettings?: () => void
  claude: AgentModelSelectorProps["claude"]
  codex: AgentModelSelectorProps["codex"]
}) {
  return (
    <AgentModelSelector
      open={modelOpen}
      onOpenChange={onModelOpenChange}
      selectedAgentId={selectedEngineId}
      selectedModelLabel={selectedModelLabel}
      triggerClassName={triggerClassName}
      contentClassName={contentClassName}
      providerProfiles={providerProfiles}
      onOpenModelsSettings={onOpenModelsSettings}
      claude={claude}
      codex={codex}
    />
  )
}
