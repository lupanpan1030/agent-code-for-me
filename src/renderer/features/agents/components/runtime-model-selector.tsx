"use client"

import type { ComponentProps } from "react"
import type { ChatEngineId } from "../../../../shared/chat-engine-id"
import { AgentModelSelector } from "./agent-model-selector"

type AgentModelSelectorProps = ComponentProps<typeof AgentModelSelector>

export function RuntimeModelSelector({
  selectedEngineId,
  disabled = false,
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
  selectedEngineId: ChatEngineId
  disabled?: boolean
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
      disabled={disabled}
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
