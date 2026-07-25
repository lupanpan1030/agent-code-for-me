import { z } from "zod"
import { CLAUDE_MODELS, type ClaudeModelInfo } from "./custom-agent-models"
import { isSafeProviderModel } from "./local-job-api"

export const MODEL_CATALOG_SCHEMA_VERSION = 1 as const

const MAX_LABEL_LENGTH = 200
const MAX_VERSION_LENGTH = 100
const MAX_LOCALIZED_COPY_LENGTH = 2_000
const MAX_METADATA_VALUE_LENGTH = 500
const MAX_THINKING_VALUE_LENGTH = 64
const MAX_THINKING_VALUES = 16
const MAX_MODELS_PER_RUNTIME = 500

const modelIdSchema = z
  .string()
  .refine(isSafeProviderModel, "Invalid model id.")

const localizedCopySchema = z
  .object({
    en: z.string().max(MAX_LOCALIZED_COPY_LENGTH).optional(),
    zh: z.string().max(MAX_LOCALIZED_COPY_LENGTH).optional(),
  })
  .strict()

const modelMetadataSchema = z
  .object({
    contextWindow: z.string().max(MAX_METADATA_VALUE_LENGTH).optional(),
    maxOutput: z.string().max(MAX_METADATA_VALUE_LENGTH).optional(),
    pricing: z.string().max(MAX_METADATA_VALUE_LENGTH).optional(),
    cachedInput: z.string().max(MAX_METADATA_VALUE_LENGTH).optional(),
  })
  .strict()

export const catalogModelSchema = z
  .object({
    id: modelIdSchema,
    label: z.string().min(1).max(MAX_LABEL_LENGTH),
    version: z.string().max(MAX_VERSION_LENGTH).optional(),
    summary: localizedCopySchema.optional(),
    bestFor: localizedCopySchema.optional(),
    tokenNote: localizedCopySchema.optional(),
    latency: localizedCopySchema.optional(),
    thinking: z
      .array(z.string().min(1).max(MAX_THINKING_VALUE_LENGTH))
      .max(MAX_THINKING_VALUES)
      .optional(),
    authRestriction: z.enum(["chatgpt-only", "api-key-only"]).optional(),
    deprecated: z.boolean().optional(),
    metadata: modelMetadataSchema.optional(),
  })
  .strict()

export const modelCatalogManifestSchema = z
  .object({
    schemaVersion: z.literal(MODEL_CATALOG_SCHEMA_VERSION),
    claude: z.array(catalogModelSchema).max(MAX_MODELS_PER_RUNTIME),
    codex: z.array(catalogModelSchema).max(MAX_MODELS_PER_RUNTIME),
  })
  .strict()

export type CatalogModel = z.infer<typeof catalogModelSchema>
export type ModelCatalogManifest = z.infer<typeof modelCatalogManifestSchema>
export type CatalogRuntime = "claude" | "codex"

export type BuiltinCatalogCopy = {
  summaryKey?: string
  bestForKey?: string
  tokenNoteKey?: string
  latencyKey?: string
}

export type MergedCatalogModel = CatalogModel & BuiltinCatalogCopy

export type MergedModelCatalog = {
  schemaVersion: typeof MODEL_CATALOG_SCHEMA_VERSION
  claude: MergedCatalogModel[]
  codex: MergedCatalogModel[]
}

export type CodexThinkingLevel = "low" | "medium" | "high" | "xhigh"

export type BuiltinCodexModel = {
  id: string
  name: string
  thinkings: CodexThinkingLevel[]
  authRestriction?: CatalogModel["authRestriction"]
  info: ClaudeModelInfo
}

export const CODEX_MODELS: BuiltinCodexModel[] = [
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    thinkings: ["low", "medium", "high", "xhigh"],
    info: {
      summaryKey: "agent.model.info.summary.gpt55",
      bestForKey: "agent.model.info.bestFor.gpt55",
      tokenNoteKey: "agent.model.info.note.openaiLongContext",
      contextWindow: "1.05M",
      maxOutput: "128K",
      pricing: "$5 in / $30 out per 1M",
      cachedInput: "$0.50 / 1M",
      latencyKey: "agent.model.info.latency.fast",
    },
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    thinkings: ["low", "medium", "high", "xhigh"],
    info: {
      summaryKey: "agent.model.info.summary.gpt54",
      bestForKey: "agent.model.info.bestFor.gpt54",
      tokenNoteKey: "agent.model.info.note.openaiLongContext",
      contextWindow: "1.05M",
      maxOutput: "128K",
      pricing: "$2.50 in / $15 out per 1M",
      cachedInput: "$0.25 / 1M",
      latencyKey: "agent.model.info.latency.medium",
    },
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    thinkings: ["low", "medium", "high", "xhigh"],
    info: {
      summaryKey: "agent.model.info.summary.gpt54Mini",
      bestForKey: "agent.model.info.bestFor.gpt54Mini",
      tokenNoteKey: "agent.model.info.note.codexThinking",
      contextWindow: "400K",
      maxOutput: "128K",
      pricing: "$0.75 in / $4.50 out per 1M",
      cachedInput: "$0.075 / 1M",
      latencyKey: "agent.model.info.latency.fast",
    },
  },
  {
    id: "gpt-5.3-codex-spark",
    name: "GPT-5.3-Codex Spark",
    thinkings: ["low", "medium", "high", "xhigh"],
    authRestriction: "chatgpt-only",
    info: {
      summaryKey: "agent.model.info.summary.gpt53CodexSpark",
      bestForKey: "agent.model.info.bestFor.gpt53CodexSpark",
      tokenNoteKey: "agent.model.info.note.sparkPricing",
      contextWindow: "Preview",
      maxOutput: "Preview",
      pricing: "ChatGPT Pro credits",
      latencyKey: "agent.model.info.latency.nearInstant",
    },
  },
]

function builtinCopy(info: ClaudeModelInfo): BuiltinCatalogCopy {
  return {
    summaryKey: info.summaryKey,
    bestForKey: info.bestForKey,
    ...(info.tokenNoteKey ? { tokenNoteKey: info.tokenNoteKey } : {}),
    latencyKey: info.latencyKey,
  }
}

function builtinMetadata(info: ClaudeModelInfo): CatalogModel["metadata"] {
  return {
    contextWindow: info.contextWindow,
    maxOutput: info.maxOutput,
    pricing: info.pricing,
    ...(info.cachedInput ? { cachedInput: info.cachedInput } : {}),
  }
}

export const BUILTIN_MODEL_CATALOG: MergedModelCatalog = {
  schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
  claude: CLAUDE_MODELS.map((model) => ({
    id: model.id,
    label: model.name,
    version: model.version,
    ...builtinCopy(model.info),
    metadata: builtinMetadata(model.info),
  })),
  codex: CODEX_MODELS.map((model) => ({
    id: model.id,
    label: model.name,
    thinking: [...model.thinkings],
    ...(model.authRestriction
      ? { authRestriction: model.authRestriction }
      : {}),
    ...builtinCopy(model.info),
    metadata: builtinMetadata(model.info),
  })),
}

function mergeCatalogModels(
  builtin: readonly MergedCatalogModel[],
  remote: readonly CatalogModel[],
): MergedCatalogModel[] {
  const merged = builtin.map((model) => ({
    ...model,
    ...(model.metadata ? { metadata: { ...model.metadata } } : {}),
  }))
  const indexById = new Map(merged.map((model, index) => [model.id, index]))

  for (const remoteModel of remote) {
    const existingIndex = indexById.get(remoteModel.id)
    if (existingIndex === undefined) {
      indexById.set(remoteModel.id, merged.length)
      merged.push({
        ...remoteModel,
        ...(remoteModel.metadata
          ? { metadata: { ...remoteModel.metadata } }
          : {}),
      })
      continue
    }

    const existing = merged[existingIndex]
    if (!existing) continue
    merged[existingIndex] = {
      ...existing,
      ...remoteModel,
      ...(existing.metadata || remoteModel.metadata
        ? {
            metadata: {
              ...existing.metadata,
              ...remoteModel.metadata,
            },
          }
        : {}),
    }
  }

  return merged
}

export function mergeModelCatalog(
  builtin: MergedModelCatalog,
  remote: ModelCatalogManifest,
): MergedModelCatalog {
  return {
    schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
    claude: mergeCatalogModels(builtin.claude, remote.claude),
    codex: mergeCatalogModels(builtin.codex, remote.codex),
  }
}
