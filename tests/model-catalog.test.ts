import { describe, expect, test } from "bun:test"
import {
  type MergedModelCatalog,
  mergeModelCatalog,
  modelCatalogManifestSchema,
} from "../src/shared/model-catalog"

function manifestWithClaudeModel(model: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    claude: [model],
    codex: [],
  }
}

describe("remote model catalog schema", () => {
  test("rejects unknown keys at every manifest object layer", () => {
    expect(
      modelCatalogManifestSchema.safeParse({
        schemaVersion: 1,
        claude: [],
        codex: [],
        unexpected: true,
      }).success,
    ).toBe(false)
    expect(
      modelCatalogManifestSchema.safeParse(
        manifestWithClaudeModel({
          id: "sonnet",
          label: "Sonnet",
          unexpected: true,
        }),
      ).success,
    ).toBe(false)
    expect(
      modelCatalogManifestSchema.safeParse(
        manifestWithClaudeModel({
          id: "sonnet",
          label: "Sonnet",
          summary: { en: "Fast", unexpected: true },
        }),
      ).success,
    ).toBe(false)
    expect(
      modelCatalogManifestSchema.safeParse(
        manifestWithClaudeModel({
          id: "sonnet",
          label: "Sonnet",
          metadata: { contextWindow: "1M", unexpected: true },
        }),
      ).success,
    ).toBe(false)
  })

  test("rejects oversize strings", () => {
    for (const model of [
      { id: "sonnet", label: "x".repeat(201) },
      { id: "sonnet", label: "Sonnet", version: "x".repeat(101) },
      {
        id: "sonnet",
        label: "Sonnet",
        summary: { en: "x".repeat(2_001) },
      },
      {
        id: "sonnet",
        label: "Sonnet",
        metadata: { pricing: "x".repeat(501) },
      },
      {
        id: "sonnet",
        label: "Sonnet",
        thinking: ["x".repeat(65)],
      },
    ]) {
      expect(
        modelCatalogManifestSchema.safeParse(manifestWithClaudeModel(model))
          .success,
      ).toBe(false)
    }
  })

  test("rejects model ids outside the shared provider-model charset", () => {
    for (const id of [
      "contains spaces",
      "shell;$",
      "line\nbreak",
      "x".repeat(201),
    ]) {
      expect(
        modelCatalogManifestSchema.safeParse(
          manifestWithClaudeModel({ id, label: "Invalid" }),
        ).success,
      ).toBe(false)
    }
  })
})

describe("remote model catalog merge", () => {
  test("adds, updates, and deprecates without dropping built-ins", () => {
    const builtin: MergedModelCatalog = {
      schemaVersion: 1,
      claude: [
        {
          id: "sonnet",
          label: "Sonnet",
          version: "4.6",
          summaryKey: "summary.sonnet",
          bestForKey: "bestFor.sonnet",
          latencyKey: "latency.fast",
          metadata: {
            contextWindow: "1M",
            pricing: "$3 in / $15 out",
          },
        },
        {
          id: "opus",
          label: "Opus",
          summaryKey: "summary.opus",
        },
      ],
      codex: [
        {
          id: "gpt-5.5",
          label: "GPT-5.5",
          thinking: ["low", "high"],
        },
      ],
    }
    const remote = modelCatalogManifestSchema.parse({
      schemaVersion: 1,
      claude: [
        {
          id: "sonnet",
          label: "Sonnet Updated",
          summary: { en: "Remote summary" },
          deprecated: true,
          metadata: { contextWindow: "2M" },
        },
        {
          id: "claude-next",
          label: "Claude Next",
          summary: { en: "New family" },
        },
      ],
      codex: [],
    })

    const merged = mergeModelCatalog(builtin, remote)

    expect(merged.claude.map((model) => model.id)).toEqual([
      "sonnet",
      "opus",
      "claude-next",
    ])
    expect(merged.codex.map((model) => model.id)).toEqual(["gpt-5.5"])
    expect(merged.claude[0]).toEqual({
      id: "sonnet",
      label: "Sonnet Updated",
      version: "4.6",
      summary: { en: "Remote summary" },
      summaryKey: "summary.sonnet",
      bestForKey: "bestFor.sonnet",
      latencyKey: "latency.fast",
      deprecated: true,
      metadata: {
        contextWindow: "2M",
        pricing: "$3 in / $15 out",
      },
    })
    expect(builtin.claude[0]?.label).toBe("Sonnet")
    expect(builtin.claude[0]?.metadata?.contextWindow).toBe("1M")
  })
})
