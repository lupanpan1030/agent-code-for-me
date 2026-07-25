import { describe, expect, test } from "bun:test"
import {
  buildCodexApiKeyModels,
  type ClaudeCatalogModel,
  type CodexCatalogModel,
  filterCatalogPickerModels,
  getVisibleCodexApiKeyModels,
  resolveClaudeCatalogModel,
  resolveCodexCatalogModel,
} from "../src/renderer/features/agents/lib/model-catalog-selection"
import {
  composeCodexTransportModel,
  MODEL_ID_MAP,
  resolveClaudeTransportModelId,
} from "../src/renderer/features/agents/lib/transport-model-selection"

describe("remote model catalog renderer selection", () => {
  test("passes custom Claude and Codex ids through transport selection", () => {
    expect(resolveClaudeTransportModelId("vendor/claude-next:v2")).toBe(
      "vendor/claude-next:v2",
    )
    expect(composeCodexTransportModel("vendor/codex-next:v2", undefined)).toBe(
      "vendor/codex-next:v2/high",
    )
    expect(composeCodexTransportModel("vendor/codex-next:v2", "xhigh")).toBe(
      "vendor/codex-next:v2/xhigh",
    )
  })

  test("keeps the existing Claude alias mapping unchanged", () => {
    expect(MODEL_ID_MAP).toEqual({
      fable: "fable",
      opus: "opus",
      sonnet: "sonnet",
      haiku: "haiku",
    })
    for (const [alias, modelId] of Object.entries(MODEL_ID_MAP)) {
      expect(resolveClaudeTransportModelId(alias)).toBe(modelId)
    }
  })

  test("does not resolve custom ids through the alias object's prototype", () => {
    for (const modelId of ["constructor", "toString", "__proto__"]) {
      expect(resolveClaudeTransportModelId(modelId)).toBe(modelId)
    }
  })

  test("hides deprecated catalog rows while preserving persisted selections", () => {
    const claudeModels: ClaudeCatalogModel[] = [
      {
        id: "claude-current",
        name: "Claude Current",
        displayLabel: "Claude Current",
        deprecated: false,
        kind: "catalog",
      },
      {
        id: "claude-retired",
        name: "Claude Retired",
        displayLabel: "Claude Retired",
        deprecated: true,
        kind: "catalog",
      },
    ]
    const codexModels: CodexCatalogModel[] = [
      {
        id: "gpt-current",
        name: "GPT Current",
        displayLabel: "GPT Current",
        deprecated: false,
        kind: "catalog",
        thinkings: ["high"],
      },
      {
        id: "gpt-retired",
        name: "GPT Retired",
        displayLabel: "GPT Retired",
        deprecated: true,
        kind: "catalog",
        thinkings: ["medium", "high"],
      },
    ]

    expect(filterCatalogPickerModels(claudeModels, [])).toHaveLength(1)
    expect(filterCatalogPickerModels(codexModels, [])).toHaveLength(1)
    expect(resolveClaudeCatalogModel(claudeModels, "claude-retired")).toBe(
      claudeModels[1],
    )
    expect(resolveCodexCatalogModel(codexModels, "gpt-retired")).toBe(
      codexModels[1],
    )
  })

  test("synthesizes absent persisted ids verbatim instead of clamping", () => {
    const claudeFallback: ClaudeCatalogModel = {
      id: "claude-current",
      name: "Claude Current",
      displayLabel: "Claude Current",
      deprecated: false,
      kind: "catalog",
    }
    const codexFallback: CodexCatalogModel = {
      id: "gpt-current",
      name: "GPT Current",
      displayLabel: "GPT Current",
      deprecated: false,
      kind: "catalog",
      thinkings: ["high"],
    }

    expect(
      resolveClaudeCatalogModel([claudeFallback], "vendor/claude-custom"),
    ).toMatchObject({
      id: "vendor/claude-custom",
      displayLabel: "vendor/claude-custom",
      kind: "custom",
    })
    expect(
      resolveCodexCatalogModel([codexFallback], "vendor/codex-custom"),
    ).toMatchObject({
      id: "vendor/codex-custom",
      displayLabel: "vendor/codex-custom",
      kind: "custom",
      thinkings: ["high"],
    })
  })

  test("shows deduplicated live ids only for the API-key source", () => {
    const catalogModels: CodexCatalogModel[] = [
      {
        id: "gpt-catalog",
        name: "GPT Catalog",
        displayLabel: "GPT Catalog",
        deprecated: true,
        kind: "catalog",
        thinkings: ["high"],
      },
    ]
    const apiKeyModels = buildCodexApiKeyModels(
      ["gpt-catalog", "o3-live", "o3-live", "codex-live"],
      catalogModels,
    )

    expect(apiKeyModels.map((model) => model.id)).toEqual([
      "o3-live",
      "codex-live",
    ])
    expect(apiKeyModels[0]).toEqual({
      id: "o3-live",
      name: "o3-live",
      displayLabel: "o3-live",
      authRestriction: "api-key-only",
      deprecated: false,
      kind: "api-key",
      thinkings: ["high"],
    })
    expect(getVisibleCodexApiKeyModels(apiKeyModels, "chatgpt")).toEqual([])
    expect(getVisibleCodexApiKeyModels(apiKeyModels, null)).toEqual([])
    expect(getVisibleCodexApiKeyModels(apiKeyModels, "openai-api-key")).toBe(
      apiKeyModels,
    )
  })
})
