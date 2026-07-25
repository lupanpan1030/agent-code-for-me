import type {
  CatalogModel,
  CodexThinkingLevel,
} from "../../../../shared/model-catalog"
import type { ModelInfo } from "./models"

export type CatalogModelKind = "catalog" | "custom" | "api-key"

export type CatalogModelViewBase = {
  id: string
  name: string
  displayLabel: string
  version?: string
  info?: ModelInfo
  authRestriction?: CatalogModel["authRestriction"]
  deprecated: boolean
  kind: CatalogModelKind
}

export type ClaudeCatalogModel = CatalogModelViewBase

export type CodexCatalogModel = CatalogModelViewBase & {
  thinkings: CodexThinkingLevel[]
}

function getDefaultClaudeCatalogModel(
  models: ClaudeCatalogModel[],
): ClaudeCatalogModel {
  const model = models[0]
  if (!model) {
    throw new Error("The merged model catalog must contain a Claude model.")
  }
  return model
}

export function getDefaultCodexCatalogModel(
  models: CodexCatalogModel[],
): CodexCatalogModel {
  const model = models[0]
  if (!model) {
    throw new Error("The merged model catalog must contain a Codex model.")
  }
  return model
}

export function getDefaultCodexThinking(
  model: CodexCatalogModel,
): CodexThinkingLevel {
  return model.thinkings[0] ?? "high"
}

export function resolveClaudeCatalogModel(
  models: ClaudeCatalogModel[],
  selectedModelId: string,
): ClaudeCatalogModel {
  const catalogModel = models.find((model) => model.id === selectedModelId)
  if (catalogModel) return catalogModel
  if (!selectedModelId) return getDefaultClaudeCatalogModel(models)
  return {
    id: selectedModelId,
    name: selectedModelId,
    displayLabel: selectedModelId,
    deprecated: false,
    kind: "custom",
  }
}

export function resolveCodexCatalogModel(
  models: CodexCatalogModel[],
  selectedModelId: string,
): CodexCatalogModel {
  const catalogModel = models.find((model) => model.id === selectedModelId)
  if (catalogModel) return catalogModel
  if (!selectedModelId) return getDefaultCodexCatalogModel(models)
  return {
    id: selectedModelId,
    name: selectedModelId,
    displayLabel: selectedModelId,
    deprecated: false,
    kind: "custom",
    thinkings: ["high"],
  }
}

export function filterCatalogPickerModels<
  TModel extends { id: string; deprecated: boolean },
>(models: TModel[], hiddenModelIds: string[]): TModel[] {
  return models.filter(
    (model) => !model.deprecated && !hiddenModelIds.includes(model.id),
  )
}

export function buildCodexApiKeyModels(
  modelIds: string[],
  catalogModels: CodexCatalogModel[],
): CodexCatalogModel[] {
  const catalogIds = new Set(catalogModels.map((model) => model.id))
  const seen = new Set<string>()
  const models: CodexCatalogModel[] = []

  for (const id of modelIds) {
    if (!id || catalogIds.has(id) || seen.has(id)) continue
    seen.add(id)
    models.push({
      id,
      name: id,
      displayLabel: id,
      authRestriction: "api-key-only",
      deprecated: false,
      kind: "api-key",
      thinkings: ["high"],
    })
  }

  return models
}

export function getVisibleCodexApiKeyModels(
  models: CodexCatalogModel[],
  source: "chatgpt" | "openai-api-key" | null,
): CodexCatalogModel[] {
  return source === "openai-api-key" ? models : []
}
