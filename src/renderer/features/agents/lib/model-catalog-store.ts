import { atom, useAtomValue, useSetAtom } from "jotai"
import { useCallback, useEffect, useMemo, useRef } from "react"
import {
  BUILTIN_MODEL_CATALOG,
  type CatalogModel,
  type CodexThinkingLevel,
  type MergedCatalogModel,
  type MergedModelCatalog,
} from "../../../../shared/model-catalog"
import {
  type ResolvedLanguage,
  type TranslationKey,
  useI18n,
} from "../../../lib/i18n"
import { trpc } from "../../../lib/trpc"
import type {
  CatalogModelViewBase,
  ClaudeCatalogModel,
  CodexCatalogModel,
} from "./model-catalog-selection"

export type {
  CatalogModelKind,
  ClaudeCatalogModel,
  CodexCatalogModel,
} from "./model-catalog-selection"
export {
  buildCodexApiKeyModels,
  filterCatalogPickerModels,
  getDefaultCodexCatalogModel,
  getDefaultCodexThinking,
  getVisibleCodexApiKeyModels,
  resolveClaudeCatalogModel,
  resolveCodexCatalogModel,
} from "./model-catalog-selection"

import { formatModelLabel, type ModelInfo } from "./models"

export type ModelCatalogStatus = {
  source: "builtin" | "cache" | "remote"
  fetchedAt: string | null
}

export type ModelCatalogSnapshot = ModelCatalogStatus & {
  catalog: MergedModelCatalog
}

const modelCatalogSnapshotAtom = atom<ModelCatalogSnapshot>({
  catalog: BUILTIN_MODEL_CATALOG,
  source: "builtin",
  fetchedAt: null,
})

export const modelCatalogAtom = atom(
  (get) => get(modelCatalogSnapshotAtom).catalog,
)

export const modelCatalogStatusAtom = atom<ModelCatalogStatus>((get) => {
  const { source, fetchedAt } = get(modelCatalogSnapshotAtom)
  return { source, fetchedAt }
})

const CATALOG_SOURCE_RANK: Record<ModelCatalogStatus["source"], number> = {
  builtin: 0,
  cache: 1,
  remote: 2,
}

export function shouldApplyModelCatalogSnapshot(
  current: ModelCatalogSnapshot,
  next: ModelCatalogSnapshot,
): boolean {
  const currentTime = current.fetchedAt
    ? Date.parse(current.fetchedAt)
    : Number.NaN
  const nextTime = next.fetchedAt ? Date.parse(next.fetchedAt) : Number.NaN

  if (Number.isFinite(currentTime) && Number.isFinite(nextTime)) {
    if (nextTime !== currentTime) return nextTime > currentTime
  } else if (Number.isFinite(currentTime)) {
    return false
  } else if (Number.isFinite(nextTime)) {
    return true
  }

  return CATALOG_SOURCE_RANK[next.source] >= CATALOG_SOURCE_RANK[current.source]
}

const SUPPORTED_CODEX_THINKING = new Set<CodexThinkingLevel>([
  "low",
  "medium",
  "high",
  "xhigh",
])

function isCodexThinkingLevel(value: string): value is CodexThinkingLevel {
  return SUPPORTED_CODEX_THINKING.has(value as CodexThinkingLevel)
}

export function resolveCatalogCopy(
  copy: CatalogModel["summary"],
  language: ResolvedLanguage,
): string | undefined {
  if (!copy) return undefined
  return language === "zh-CN" ? (copy.zh ?? copy.en) : copy.en
}

function resolveModelInfo(
  model: MergedCatalogModel,
  language: ResolvedLanguage,
  translate: (key: TranslationKey) => string,
): ModelInfo | undefined {
  const translateKey = (key: string | undefined) =>
    key ? translate(key as TranslationKey) : undefined
  const info: ModelInfo = {
    summary:
      resolveCatalogCopy(model.summary, language) ??
      translateKey(model.summaryKey),
    bestFor:
      resolveCatalogCopy(model.bestFor, language) ??
      translateKey(model.bestForKey),
    tokenNote:
      resolveCatalogCopy(model.tokenNote, language) ??
      translateKey(model.tokenNoteKey),
    latency:
      resolveCatalogCopy(model.latency, language) ??
      translateKey(model.latencyKey),
    contextWindow: model.metadata?.contextWindow,
    maxOutput: model.metadata?.maxOutput,
    pricing: model.metadata?.pricing,
    cachedInput: model.metadata?.cachedInput,
  }
  return Object.values(info).some((value) => value !== undefined)
    ? info
    : undefined
}

function baseModelView(
  model: MergedCatalogModel,
  language: ResolvedLanguage,
  translate: (key: TranslationKey) => string,
): CatalogModelViewBase {
  const info = resolveModelInfo(model, language, translate)
  return {
    id: model.id,
    name: model.label,
    displayLabel: formatModelLabel(model.label, model.version),
    ...(model.version ? { version: model.version } : {}),
    ...(info ? { info } : {}),
    ...(model.authRestriction
      ? { authRestriction: model.authRestriction }
      : {}),
    deprecated: model.deprecated === true,
    kind: "catalog",
  }
}

export function buildModelCatalogView(
  catalog: MergedModelCatalog,
  language: ResolvedLanguage,
  translate: (key: TranslationKey) => string,
): { claude: ClaudeCatalogModel[]; codex: CodexCatalogModel[] } {
  return {
    claude: catalog.claude.map((model) =>
      baseModelView(model, language, translate),
    ),
    codex: catalog.codex.map((model) => {
      const thinkings = (model.thinking ?? []).filter(isCodexThinkingLevel)
      return {
        ...baseModelView(model, language, translate),
        thinkings: thinkings.length > 0 ? thinkings : ["high"],
      }
    }),
  }
}

export type ModelCatalogStoreResult = {
  catalog: MergedModelCatalog
  claudeModels: ClaudeCatalogModel[]
  codexModels: CodexCatalogModel[]
  status: ModelCatalogStatus
}

export function useModelCatalogStore(): ModelCatalogStoreResult {
  const { resolvedLanguage, t } = useI18n()
  const trpcUtils = trpc.useUtils()
  const snapshot = useAtomValue(modelCatalogSnapshotAtom)
  const setSnapshot = useSetAtom(modelCatalogSnapshotAtom)
  const hasAuthoritativeSubscriptionSnapshot = useRef(false)
  const subscriptionResetRef = useRef<() => void>(() => undefined)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const applyQuerySnapshot = useCallback(
    (nextSnapshot: ModelCatalogSnapshot) => {
      if (hasAuthoritativeSubscriptionSnapshot.current) return
      setSnapshot((currentSnapshot) =>
        shouldApplyModelCatalogSnapshot(currentSnapshot, nextSnapshot)
          ? nextSnapshot
          : currentSnapshot,
      )
    },
    [setSnapshot],
  )

  const applySubscriptionSnapshot = useCallback(
    (nextSnapshot: ModelCatalogSnapshot) => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      hasAuthoritativeSubscriptionSnapshot.current = true
      trpcUtils.modelCatalog.get.setData(undefined, nextSnapshot)
      setSnapshot(nextSnapshot)
    },
    [setSnapshot, trpcUtils.modelCatalog.get],
  )

  const handleSubscriptionEnd = useCallback(() => {
    hasAuthoritativeSubscriptionSnapshot.current = false
    void trpcUtils.modelCatalog.get.invalidate()
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null
      subscriptionResetRef.current()
    }, 1_000)
  }, [trpcUtils.modelCatalog.get])

  const query = trpc.modelCatalog.get.useQuery(undefined, {
    staleTime: 24 * 60 * 60 * 1_000,
  })
  const subscription = trpc.modelCatalog.updates.useSubscription(undefined, {
    onData: applySubscriptionSnapshot,
    onError: handleSubscriptionEnd,
    onComplete: handleSubscriptionEnd,
  })
  subscriptionResetRef.current = subscription.reset

  trpc.codex.apiKeyModelUpdates.useSubscription(undefined, {
    onData: (status) => {
      trpcUtils.codex.getCodexApiKeyStatus.setData(undefined, status)
    },
    onError: () => {
      void trpcUtils.codex.getCodexApiKeyStatus.invalidate()
    },
    onComplete: () => {
      void trpcUtils.codex.getCodexApiKeyStatus.invalidate()
    },
  })

  useEffect(
    () => () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (query.data) applyQuerySnapshot(query.data)
  }, [applyQuerySnapshot, query.data])

  const view = useMemo(
    () => buildModelCatalogView(snapshot.catalog, resolvedLanguage, t),
    [snapshot.catalog, resolvedLanguage, t],
  )

  return {
    catalog: snapshot.catalog,
    claudeModels: view.claude,
    codexModels: view.codex,
    status: { source: snapshot.source, fetchedAt: snapshot.fetchedAt },
  }
}
