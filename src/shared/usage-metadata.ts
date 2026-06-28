export type RuntimeUsageInput = {
  provider?: unknown
  adapterSource?: unknown
  model?: unknown
  inputTokens?: unknown
  outputTokens?: unknown
  totalTokens?: unknown
  cacheReadInputTokens?: unknown
  cacheCreationInputTokens?: unknown
  cachedInputTokens?: unknown
}

export type NormalizedRuntimeUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  totalInputContextTokens?: number
  cacheHitRatio?: number
}

export function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function readLowerString(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

export function isInclusiveCachedInputRuntime(
  input: RuntimeUsageInput,
): boolean {
  const provider = readLowerString(input.provider)
  const adapterSource = readLowerString(input.adapterSource)
  const model = readLowerString(input.model)

  return (
    provider === "codex" ||
    adapterSource === "codex-app-server" ||
    model.includes("codex") ||
    model.startsWith("gpt-")
  )
}

export function normalizeRuntimeUsage(
  input: RuntimeUsageInput,
): NormalizedRuntimeUsage {
  const inputTokens = readFiniteNumber(input.inputTokens) ?? undefined
  const outputTokens = readFiniteNumber(input.outputTokens) ?? undefined
  const totalTokens = readFiniteNumber(input.totalTokens) ?? undefined
  const cacheReadInputTokens =
    readFiniteNumber(input.cacheReadInputTokens) ??
    readFiniteNumber(input.cachedInputTokens) ??
    undefined
  const cacheCreationInputTokens =
    readFiniteNumber(input.cacheCreationInputTokens) ?? undefined
  const isInclusiveRuntime = isInclusiveCachedInputRuntime(input)

  const totalInputContextTokens =
    isInclusiveRuntime &&
    totalTokens !== undefined &&
    outputTokens !== undefined
      ? Math.max(0, totalTokens - outputTokens)
      : isInclusiveRuntime && inputTokens !== undefined
        ? Math.max(0, inputTokens)
        : !isInclusiveRuntime && inputTokens !== undefined
          ? Math.max(
              0,
              inputTokens +
                (cacheReadInputTokens ?? 0) +
                (cacheCreationInputTokens ?? 0),
            )
          : undefined

  const hasCacheData =
    cacheReadInputTokens !== undefined || cacheCreationInputTokens !== undefined
  const cacheHitRatio =
    hasCacheData &&
    totalInputContextTokens !== undefined &&
    totalInputContextTokens > 0
      ? Math.min(
          1,
          Math.max(0, (cacheReadInputTokens ?? 0) / totalInputContextTokens),
        )
      : undefined

  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
    ...(cacheCreationInputTokens !== undefined
      ? { cacheCreationInputTokens }
      : {}),
    ...(totalInputContextTokens !== undefined
      ? { totalInputContextTokens }
      : {}),
    ...(cacheHitRatio !== undefined ? { cacheHitRatio } : {}),
  }
}
