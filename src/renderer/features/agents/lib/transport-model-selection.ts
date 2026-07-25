export const MODEL_ID_MAP: Record<string, string> = {
  fable: "fable",
  opus: "opus",
  sonnet: "sonnet",
  haiku: "haiku",
}

const CODEX_THINKING_LEVELS = new Set(["low", "medium", "high", "xhigh"])

export function resolveClaudeTransportModelId(selectedModelId: string): string {
  return Object.hasOwn(MODEL_ID_MAP, selectedModelId)
    ? MODEL_ID_MAP[selectedModelId]
    : selectedModelId
}

export function composeCodexTransportModel(
  selectedModelId: string,
  selectedThinking: unknown,
): string {
  if (!selectedModelId) return ""
  const normalizedThinking =
    typeof selectedThinking === "string" &&
    CODEX_THINKING_LEVELS.has(selectedThinking)
      ? selectedThinking
      : "high"
  return `${selectedModelId}/${normalizedThinking}`
}
