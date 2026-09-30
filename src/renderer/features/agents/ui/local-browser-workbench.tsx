"use client"

import {
  AlertTriangle,
  Camera,
  ClipboardPlus,
  Code2,
  Globe2,
  Image as ImageIcon,
  MousePointerClick,
  RefreshCw,
  Send,
  ShieldAlert,
  X,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type {
  LocalBrowserGuestEvent,
  LocalBrowserPreviewAdmission,
  LocalBrowserScreenshotProjection,
} from "../../../../shared/local-browser-diagnostics-policy"
import {
  buildLocalBrowserReport,
  type LocalBrowserConsoleMessage,
  type LocalBrowserDomSummary,
  type LocalBrowserLoadFailure,
  normalizeLocalBrowserUrl,
} from "../../../../shared/local-browser-workbench"
import { Button } from "../../../components/ui/button"
import { Input } from "../../../components/ui/input"
import { Textarea } from "../../../components/ui/textarea"
import { useI18n } from "../../../lib/i18n"
import { cn } from "../../../lib/utils"
import {
  AGENTS_PREVIEW_CONSTANTS,
  DEVICE_PRESETS,
  type DevicePreset,
} from "../constants"
import { DevicePresetsBar } from "./device-presets-bar"
import { ScaleControl } from "./scale-control"
import { ViewportToggle } from "./viewport-toggle"

/**
 * Renderer half of the Local Browser guest boundary. Main owns admission,
 * partition, navigation, permission and diagnostics policy
 * (`src/main/windows/local-browser-guest-policy.ts`); this component only
 * validates user-entered URLs for immediate UX, mounts a `<webview>` after a
 * main admission, and renders main-minimized projections. It never listens
 * to raw `<webview>` events carrying page-controlled URL, title or text.
 */

type AdmittedPreview = Extract<LocalBrowserPreviewAdmission, { ok: true }>

type WebviewElement = HTMLElement & {
  reload?: () => void
  reloadIgnoringCache?: () => void
}

type PreviewTarget = {
  url: string
  /** Every user-requested open is a fresh mount and a fresh admission. */
  requestId: number
}

interface LocalBrowserWorkbenchProps {
  chatId: string
  worktreePath: string
  onClose: () => void
  onInsertReport: (report: string) => void
}

const MAX_CONSOLE_MESSAGES = 30
const MAX_LOAD_FAILURES = 20
const DESKTOP_VIEWPORT = { width: 1280, height: 800 }

export function LocalBrowserWorkbench({
  chatId,
  worktreePath,
  onClose,
  onInsertReport,
}: LocalBrowserWorkbenchProps) {
  const { t } = useI18n()
  const webviewRef = useRef<WebviewElement | null>(null)
  const admissionRef = useRef<AdmittedPreview | null>(null)
  const requestCounterRef = useRef(0)
  // Committed navigations of the current guest seen by this view. A capture
  // started before a navigation is discarded when it resolves after it.
  const navigationCountRef = useRef(0)
  const [urlInput, setUrlInput] = useState("localhost:3000")
  const [target, setTarget] = useState<PreviewTarget | null>(null)
  const [admission, setAdmission] = useState<AdmittedPreview | null>(null)
  const [displayUrl, setDisplayUrl] = useState<string | null>(null)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isCapturing, setIsCapturing] = useState(false)
  const [pageTitle, setPageTitle] = useState("")
  const [viewportMode, setViewportMode] = useState<"desktop" | "mobile">("desktop")
  const [selectedPreset, setSelectedPreset] = useState("iPhone 16")
  const [viewportWidth, setViewportWidth] = useState(DESKTOP_VIEWPORT.width)
  const [viewportHeight, setViewportHeight] = useState(DESKTOP_VIEWPORT.height)
  const [scale, setScale] = useState(75)
  const [consoleMessages, setConsoleMessages] = useState<LocalBrowserConsoleMessage[]>([])
  const [loadFailures, setLoadFailures] = useState<LocalBrowserLoadFailure[]>([])
  const [domSummary, setDomSummary] = useState<LocalBrowserDomSummary | null>(null)
  const [screenshot, setScreenshot] = useState<LocalBrowserScreenshotProjection | null>(null)
  const [lastClickedElement, setLastClickedElement] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [lastReport, setLastReport] = useState<string | null>(null)

  const previewWidth = viewportMode === "desktop" ? DESKTOP_VIEWPORT.width : viewportWidth
  const previewHeight = viewportMode === "desktop" ? DESKTOP_VIEWPORT.height : viewportHeight
  const scaledWidth = Math.round(previewWidth * (scale / 100))
  const scaledHeight = Math.round(previewHeight * (scale / 100))
  const currentUrl = admission ? displayUrl ?? admission.displayUrl : null

  // Main-minimized, redacted projections are the only diagnostic input.
  useEffect(() => {
    const subscribe = window.desktopApi?.onLocalBrowserGuestEvent
    if (typeof subscribe !== "function") return
    return subscribe((event: LocalBrowserGuestEvent) => {
      const current = admissionRef.current
      if (!current || event.generation !== current.generation) return
      switch (event.kind) {
        case "attached":
          return
        case "loading":
          setIsLoading(event.loading)
          return
        case "navigated":
          // A committed navigation starts a new page: main already rejects a
          // capture across navigation generations, and the cached report and
          // page snapshot must not outlive the page they describe either.
          navigationCountRef.current += 1
          setDisplayUrl(event.displayUrl)
          setLastReport(null)
          setScreenshot(null)
          setDomSummary(null)
          setLastClickedElement(null)
          return
        case "title":
          setPageTitle(event.title)
          return
        case "console":
          setConsoleMessages((prev) => [...prev, event.message].slice(-MAX_CONSOLE_MESSAGES))
          return
        case "load-failure":
          setLoadFailures((prev) => [...prev, event.failure].slice(-MAX_LOAD_FAILURES))
          return
        case "navigation-blocked":
          setUrlError(t("localBrowser.navigationBlocked", { target: event.target || "?" }))
          return
        case "closed":
          admissionRef.current = null
          webviewRef.current = null
          setAdmission(null)
          setTarget(null)
          setIsLoading(false)
          setUrlError(t("localBrowser.previewClosed"))
          return
      }
    })
  }, [t])

  const handleAdmitted = useCallback((next: AdmittedPreview) => {
    admissionRef.current = next
    setAdmission(next)
    setDisplayUrl(next.displayUrl)
  }, [])

  const handleDenied = useCallback((message: string) => {
    admissionRef.current = null
    setAdmission(null)
    setTarget(null)
    setUrlError(message)
  }, [])

  const handleViewportModeChange = useCallback((mode: "desktop" | "mobile") => {
    setViewportMode(mode)
    if (mode === "desktop") {
      setScale(75)
      return
    }
    const preset = findPreset(selectedPreset)
    setViewportWidth(preset.width)
    setViewportHeight(preset.height)
    setScale(75)
  }, [selectedPreset])

  const handlePresetChange = useCallback((presetName: string) => {
    const preset = findPreset(presetName)
    setSelectedPreset(presetName)
    setViewportWidth(preset.width)
    setViewportHeight(preset.height)
  }, [])

  const handleWidthChange = useCallback((width: number) => {
    setSelectedPreset("Custom")
    setViewportWidth(width)
  }, [])

  const handleNavigateSubmit = useCallback((event?: React.FormEvent) => {
    event?.preventDefault()
    // Immediate UX only; main re-validates against the DB-registered root.
    const result = normalizeLocalBrowserUrl(urlInput, {
      allowedFileRoots: [worktreePath],
    })
    if (!result.ok) {
      setUrlError(result.message)
      return
    }
    requestCounterRef.current += 1
    admissionRef.current = null
    webviewRef.current = null
    setAdmission(null)
    setDisplayUrl(null)
    setUrlError(null)
    setIsLoading(false)
    setPageTitle("")
    setConsoleMessages([])
    setLoadFailures([])
    setDomSummary(null)
    setScreenshot(null)
    setLastClickedElement(null)
    setLastReport(null)
    setTarget({ url: result.url, requestId: requestCounterRef.current })
    setUrlInput(result.url)
  }, [urlInput, worktreePath])

  const handleReload = useCallback(() => {
    const webview = webviewRef.current
    if (!webview) return
    if (webview.reloadIgnoringCache) {
      webview.reloadIgnoringCache()
    } else {
      webview.reload?.()
    }
  }, [])

  const captureDiagnostics = useCallback(async () => {
    const current = admissionRef.current
    const capture = window.desktopApi?.captureLocalBrowserDiagnostics
    if (!current || typeof capture !== "function") return null

    const navigationCount = navigationCountRef.current
    setIsCapturing(true)
    try {
      const result = await capture({ generation: current.generation })
      if (navigationCountRef.current !== navigationCount) {
        toast.error(t("localBrowser.captureStale"))
        return null
      }
      if (!result.ok) {
        toast.error(
          result.code === "stale"
            ? t("localBrowser.captureStale")
            : t("localBrowser.captureFailed"),
        )
        return null
      }
      if (admissionRef.current?.generation !== result.generation) return null
      setScreenshot(result.screenshot)
      setDomSummary(result.domSummary)
      setLastClickedElement(result.selectedElement)
      if (result.title) setPageTitle(result.title)
      const report = buildLocalBrowserReport({
        url: result.displayUrl,
        title: result.title || pageTitle,
        viewport: {
          mode: viewportMode,
          width: previewWidth,
          height: previewHeight,
          scale,
        },
        capturedAt: new Date().toISOString(),
        screenshotCaptured: result.screenshot !== null,
        note,
        selectedElement: result.selectedElement,
        domSummary: result.domSummary,
        consoleMessages,
        loadFailures,
      })
      setLastReport(report)
      toast.success(t("localBrowser.captured"))
      return report
    } catch {
      toast.error(t("localBrowser.captureFailed"))
      return null
    } finally {
      setIsCapturing(false)
    }
  }, [
    consoleMessages,
    loadFailures,
    note,
    pageTitle,
    previewHeight,
    previewWidth,
    scale,
    t,
    viewportMode,
  ])

  const handleCapture = useCallback(() => {
    void captureDiagnostics()
  }, [captureDiagnostics])

  const handleInsertReport = useCallback(async () => {
    const report = lastReport ?? await captureDiagnostics()
    if (!report) return
    onInsertReport(report)
    toast.success(t("localBrowser.reportInserted"))
  }, [captureDiagnostics, lastReport, onInsertReport, t])

  const fileScope = admission?.kind === "file" ? admission.fileScope : null

  return (
    <div
      data-testid="local-browser-workbench"
      className="flex h-full min-w-0 flex-col bg-background text-foreground"
    >
      <div className="flex h-10 flex-shrink-0 items-center justify-between border-b border-border/50 px-2">
        <div className="flex min-w-0 items-center gap-2">
          <Globe2 className="h-4 w-4 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate text-xs font-medium">{t("localBrowser.title")}</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {pageTitle || currentUrl || t("localBrowser.localOnly")}
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-6 w-6 rounded-md"
          aria-label={t("common.close")}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <form
        onSubmit={handleNavigateSubmit}
        className="flex flex-shrink-0 items-center gap-1.5 border-b border-border/50 px-2 py-1.5"
      >
        <Input
          value={urlInput}
          onChange={(event) => setUrlInput(event.target.value)}
          placeholder={t("localBrowser.urlPlaceholder")}
          className="h-7 min-w-0 flex-1 rounded-md px-2 py-1 font-mono text-xs"
          spellCheck={false}
          data-testid="local-browser-url-input"
        />
        <Button
          type="submit"
          size="sm"
          className="h-7 gap-1.5 px-2"
          data-testid="local-browser-open-button"
        >
          <Globe2 className="h-3.5 w-3.5" />
          <span className="text-xs">{t("common.open")}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleReload}
          disabled={!admission}
          className="h-7 w-7 rounded-md"
          aria-label={t("localBrowser.reload")}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
        </Button>
      </form>

      {urlError && (
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="min-w-0 truncate">{urlError}</span>
        </div>
      )}

      {fileScope && (
        <div
          className="flex flex-shrink-0 items-center gap-2 border-b border-border/50 bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground"
          data-testid="local-browser-file-scope"
        >
          <ShieldAlert className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="min-w-0 break-words">
            {t("localBrowser.fileScope", {
              scope: fileScope.isWorktreeRoot
                ? t("localBrowser.fileScopeWorktreeRoot")
                : `${fileScope.relativeDirectory}/`,
            })}
          </span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/50 px-2 py-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <ViewportToggle value={viewportMode} onChange={handleViewportModeChange} />
              <ScaleControl value={scale} onChange={setScale} />
            </div>
            {viewportMode === "mobile" && (
              <DevicePresetsBar
                selectedPreset={selectedPreset}
                width={viewportWidth}
                height={viewportHeight}
                onPresetChange={handlePresetChange}
                onWidthChange={handleWidthChange}
                maxWidth={AGENTS_PREVIEW_CONSTANTS.MAX_WIDTH}
                className="min-w-0"
              />
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-3">
            {target ? (
              <div
                className="origin-top-left overflow-hidden rounded-md border border-border bg-background shadow-sm"
                style={{ width: scaledWidth, height: scaledHeight }}
              >
                <LocalBrowserGuestHost
                  key={`${chatId}:${target.requestId}`}
                  chatId={chatId}
                  url={target.url}
                  onAdmitted={handleAdmitted}
                  onDenied={handleDenied}
                  unavailableMessage={t("localBrowser.previewUnavailable")}
                  requestingMessage={t("localBrowser.requestingPreview")}
                  webviewRef={webviewRef}
                  style={{
                    width: previewWidth,
                    height: previewHeight,
                    transform: `scale(${scale / 100})`,
                    transformOrigin: "top left",
                  }}
                />
              </div>
            ) : (
              <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                <Globe2 className="h-8 w-8" />
                <div>
                  <div className="text-sm font-medium text-foreground">{t("localBrowser.emptyTitle")}</div>
                  <div className="mt-1 max-w-[360px] text-xs">{t("localBrowser.emptyDescription")}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        <aside className="flex w-[286px] flex-shrink-0 flex-col border-l border-border/50 bg-tl-background">
          <div className="flex flex-shrink-0 items-center gap-1 border-b border-border/50 px-2 py-1.5">
            <Button
              type="button"
              size="sm"
              onClick={handleCapture}
              disabled={!admission || isCapturing}
              className="h-7 flex-1 gap-1.5 px-2"
              data-testid="local-browser-capture-button"
            >
              <Camera className="h-3.5 w-3.5" />
              <span className="text-xs">
                {isCapturing ? t("localBrowser.capturing") : t("localBrowser.capture")}
              </span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={() => void handleInsertReport()}
              disabled={!admission || isCapturing}
              className="h-7 w-7 rounded-md"
              aria-label={t("localBrowser.insertReport")}
              data-testid="local-browser-insert-report-button"
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2 text-xs">
            <section className="space-y-1.5">
              <div className="flex items-center gap-1.5 font-medium">
                <ClipboardPlus className="h-3.5 w-3.5 text-muted-foreground" />
                {t("localBrowser.annotation")}
              </div>
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t("localBrowser.notePlaceholder")}
                className="min-h-[74px] resize-none rounded-md text-xs"
                data-testid="local-browser-note"
              />
              <div className="flex items-start gap-1.5 rounded-md bg-muted/50 p-2 text-muted-foreground">
                <MousePointerClick className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <span className="min-w-0 break-words">
                  {lastClickedElement || t("localBrowser.noClickedElement")}
                </span>
              </div>
            </section>

            <section className="space-y-1.5">
              <div className="flex items-center gap-1.5 font-medium">
                <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                {t("localBrowser.screenshot")}
              </div>
              {screenshot ? (
                <img
                  src={screenshot.dataUrl}
                  alt={t("localBrowser.screenshot")}
                  className="aspect-video w-full rounded-md border border-border object-contain bg-background"
                  data-testid="local-browser-screenshot"
                />
              ) : (
                <div className="rounded-md border border-dashed border-border p-3 text-muted-foreground">
                  {t("localBrowser.noScreenshot")}
                </div>
              )}
            </section>

            <DiagnosticsSection
              title={t("localBrowser.domSummary")}
              icon={<Code2 className="h-3.5 w-3.5 text-muted-foreground" />}
              empty={t("localBrowser.noDomSummary")}
              items={formatDomSummary(domSummary)}
            />
            <DiagnosticsSection
              title={t("localBrowser.console")}
              icon={<Code2 className="h-3.5 w-3.5 text-muted-foreground" />}
              empty={t("localBrowser.noConsole")}
              items={consoleMessages.slice(-6).map((message) => `${message.level}: ${message.text}`)}
              itemClassName={(item) => item.startsWith("error") ? "text-destructive" : undefined}
            />
            <DiagnosticsSection
              title={t("localBrowser.failures")}
              icon={<AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />}
              empty={t("localBrowser.noFailures")}
              items={loadFailures.slice(-5).map((failure) => `${failure.reason} - ${failure.url}`)}
              itemClassName={() => "text-destructive"}
            />

            <div className="rounded-md bg-muted/50 p-2 text-[11px] text-muted-foreground">
              {t("localBrowser.worktree", { path: worktreePath })}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function DiagnosticsSection({
  title,
  icon,
  empty,
  items,
  itemClassName,
}: {
  title: string
  icon: React.ReactNode
  empty: string
  items: string[]
  itemClassName?: (item: string) => string | undefined
}) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-1.5 font-medium">
        {icon}
        {title}
      </div>
      {items.length > 0 ? (
        <div className="space-y-1">
          {items.map((item, index) => (
            <div
              key={`${item}-${index}`}
              className={cn("break-words rounded-md bg-muted/50 p-1.5 text-muted-foreground", itemClassName?.(item))}
            >
              {item}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border p-2 text-muted-foreground">
          {empty}
        </div>
      )}
    </section>
  )
}

function findPreset(presetName: string): DevicePreset {
  return DEVICE_PRESETS.find((preset) => preset.name === presetName) ?? DEVICE_PRESETS[1]!
}

function formatDomSummary(summary: LocalBrowserDomSummary | null): string[] {
  if (!summary) return []
  const items: string[] = []
  if (summary.headings.length) items.push(`Headings: ${summary.headings.join(" | ")}`)
  if (summary.buttons.length) items.push(`Buttons: ${summary.buttons.join(" | ")}`)
  if (summary.inputs.length) items.push(`Inputs: ${summary.inputs.join(" | ")}`)
  if (summary.links.length) items.push(`Links: ${summary.links.join(" | ")}`)
  if (summary.activeElement) items.push(`Active: ${summary.activeElement}`)
  if (summary.textSample) items.push(`Text: ${summary.textSample.slice(0, 220)}`)
  return items
}

/**
 * One mount of this host is one main admission: it requests a fresh
 * generation/partition when it mounts (including React remounts and
 * StrictMode double mounts) and renders the `<webview>` only with the
 * admitted partition and src. A consumed admission is never reused.
 */
function LocalBrowserGuestHost({
  chatId,
  url,
  onAdmitted,
  onDenied,
  unavailableMessage,
  requestingMessage,
  webviewRef,
  style,
}: {
  chatId: string
  url: string
  onAdmitted: (admission: AdmittedPreview) => void
  onDenied: (message: string) => void
  unavailableMessage: string
  requestingMessage: string
  webviewRef: React.RefObject<WebviewElement | null>
  style: React.CSSProperties
}) {
  const [admitted, setAdmitted] = useState<AdmittedPreview | null>(null)
  const callbacksRef = useRef({ onAdmitted, onDenied, unavailableMessage })
  callbacksRef.current = { onAdmitted, onDenied, unavailableMessage }

  useEffect(() => {
    let cancelled = false
    const request = window.desktopApi?.requestLocalBrowserPreview
    if (typeof request !== "function") {
      callbacksRef.current.onDenied(callbacksRef.current.unavailableMessage)
      return
    }
    request({ chatId, url })
      .then((result) => {
        if (cancelled) return
        if (!result.ok) {
          callbacksRef.current.onDenied(result.message)
          return
        }
        setAdmitted(result)
        callbacksRef.current.onAdmitted(result)
      })
      .catch(() => {
        if (!cancelled) {
          callbacksRef.current.onDenied(callbacksRef.current.unavailableMessage)
        }
      })
    return () => {
      cancelled = true
    }
  }, [chatId, url])

  if (!admitted) {
    return (
      <div className="flex h-full items-center justify-center p-3 text-xs text-muted-foreground">
        {requestingMessage}
      </div>
    )
  }

  return (
    <webview
      ref={(element) => {
        webviewRef.current = element as WebviewElement | null
      }}
      src={admitted.src}
      partition={admitted.partition}
      className="block bg-background"
      style={style}
      data-testid="local-browser-webview"
    />
  )
}
