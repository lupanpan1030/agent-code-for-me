/**
 * Serializable shape and minimization adapter for Local Browser guest
 * diagnostics (design D9, Security Invariant 7).
 *
 * Page-controlled values (console text, load failures, titles, navigation
 * URLs, probe results) are shaped here in a fixed order: URL credentials,
 * query and fragment are dropped, fields are minimized, the caller-supplied
 * redactor runs, then type/count/length bounds apply. The redactor is
 * composed in the main process from the canonical
 * `src/main/lib/agent-runtime/redaction.ts` owner; this module never matches
 * secrets itself and never imports main-process or Electron code. Only the
 * resulting projection may reach renderer state.
 */
import type {
  LocalBrowserConsoleLevel,
  LocalBrowserConsoleMessage,
  LocalBrowserDomSummary,
  LocalBrowserLoadFailure,
} from "./local-browser-workbench"

/** Main-composed secret redaction applied after minimization. */
export type LocalBrowserTextRedactor = (text: string) => string

export const LOCAL_BROWSER_DIAGNOSTIC_LIMITS = Object.freeze({
  /** Hard cap applied to raw page text before any further processing. */
  preRedactionChars: 4096,
  consoleTextChars: 600,
  sourceChars: 240,
  urlChars: 240,
  titleChars: 160,
  reasonChars: 120,
  listItems: 12,
  listItemChars: 160,
  textSampleChars: 600,
  selectedElementChars: 240,
  maxLineNumber: 10_000_000,
})

/** Approved screenshot projection bounds (design D9, task 4.7). */
export const LOCAL_BROWSER_SCREENSHOT_LIMITS = Object.freeze({
  mimeType: "image/png",
  maxWidth: 4096,
  maxHeight: 4096,
  maxBytes: 8 * 1024 * 1024,
})

export type LocalBrowserPreviewKind = "http" | "file"

export type LocalBrowserPreviewDenialCode =
  | "invalid-request"
  | "sender-not-app-window"
  | "chat-owned-elsewhere"
  | "chat-not-registered"
  | "url-rejected"
  | "file-preview-unsupported"
  | "file-root-unverifiable"
  | "file-not-previewable"
  | "capacity"
  | "session-setup-failed"

export type LocalBrowserFileScope = {
  /** Worktree-relative directory whose subtree the document may read. */
  relativeDirectory: string
  /** True when the default scope is the whole registered worktree. */
  isWorktreeRoot: boolean
}

export type LocalBrowserPreviewAdmission =
  | {
      ok: true
      generation: number
      /** Sole one-shot attachment capability; never logged or persisted. */
      partition: string
      src: string
      displayUrl: string
      kind: LocalBrowserPreviewKind
      fileScope: LocalBrowserFileScope | null
    }
  | { ok: false; code: LocalBrowserPreviewDenialCode; message: string }

export type LocalBrowserGuestCloseReason =
  | "attach-rejected"
  | "handler-missing"
  | "preferences-rejected"
  | "committed-url-rejected"
  | "superseded"
  | "embedder-closed"
  | "guest-destroyed"
  | "admission-expired"

export type LocalBrowserGuestEvent =
  | { generation: number; kind: "attached" }
  | { generation: number; kind: "loading"; loading: boolean }
  | { generation: number; kind: "navigated"; displayUrl: string }
  | { generation: number; kind: "title"; title: string }
  | {
      generation: number
      kind: "console"
      message: LocalBrowserConsoleMessage
    }
  | {
      generation: number
      kind: "load-failure"
      failure: LocalBrowserLoadFailure
    }
  | {
      generation: number
      kind: "navigation-blocked"
      reason: string
      target: string
    }
  | {
      generation: number
      kind: "closed"
      reason: LocalBrowserGuestCloseReason
      confirmed: boolean
    }

export type LocalBrowserScreenshotProjection = {
  dataUrl: string
  width: number
  height: number
}

export type LocalBrowserCaptureResult =
  | {
      ok: true
      generation: number
      displayUrl: string
      title: string
      domSummary: LocalBrowserDomSummary | null
      selectedElement: string | null
      screenshot: LocalBrowserScreenshotProjection | null
    }
  | { ok: false; code: "no-guest" | "stale" | "invalid-request" }

const CONSOLE_LEVELS: ReadonlySet<string> = new Set([
  "info",
  "warning",
  "error",
  "debug",
])

/**
 * Electron `info`/`warning`/`error`/`debug` map identically; every other
 * value (including the deprecated numeric level) falls back to `log`.
 */
export function mapLocalBrowserConsoleLevel(
  level: unknown,
): LocalBrowserConsoleLevel {
  if (typeof level === "string" && CONSOLE_LEVELS.has(level)) {
    return level as LocalBrowserConsoleLevel
  }
  return "log"
}

function boundLength(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`
}

/**
 * Normalizes whitespace and applies the pre-redaction hard cap. A truncated
 * value drops its trailing partial token so a split secret prefix cannot
 * survive into the projection.
 */
function precap(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  const cap = LOCAL_BROWSER_DIAGNOSTIC_LIMITS.preRedactionChars
  if (normalized.length <= cap) return normalized
  const cut = normalized.slice(0, cap)
  const lastSpace = cut.lastIndexOf(" ")
  return lastSpace > 0 ? cut.slice(0, lastSpace) : ""
}

const HIERARCHICAL_URL = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/i
const OPAQUE_URL = /^([a-z][a-z0-9+.-]*):/i

/**
 * Pre-redaction hard cap for one URL. A truncated URL drops its trailing
 * partial path segment so a split secret prefix cannot survive redaction.
 */
function precapUrl(value: string): string {
  const cap = LOCAL_BROWSER_DIAGNOSTIC_LIMITS.preRedactionChars
  if (value.length <= cap) return value
  const cut = value.slice(0, cap)
  return cut.slice(0, cut.lastIndexOf("/") + 1)
}

/** Credential/query/fragment minimization without the final length bound. */
function minimizeUrlForRedaction(value: unknown): string {
  if (typeof value !== "string") return ""
  const trimmed = value.trim()
  if (!trimmed) return ""
  const hierarchical = HIERARCHICAL_URL.exec(trimmed)
  let minimized: string
  if (hierarchical) {
    const scheme = (hierarchical[1] ?? "").toLowerCase()
    const authority = hierarchical[2] ?? ""
    const host = authority.slice(authority.lastIndexOf("@") + 1)
    minimized = `${scheme}://${host}${hierarchical[3] ?? ""}`
  } else {
    const opaque = OPAQUE_URL.exec(trimmed)
    minimized = opaque
      ? `${(opaque[1] ?? "").toLowerCase()}:`
      : (trimmed.split(/[?#]/, 1)[0] ?? "")
  }
  return precapUrl(minimized.replace(/\s+/g, ""))
}

/**
 * Drops URL credentials, query and fragment. Hierarchical URLs keep only
 * scheme, host (with port) and path; opaque URLs (`about:`, `data:`, `blob:`,
 * `javascript:`, `mailto:`...) keep only their scheme; relative references
 * keep only their path. Projections redact before this length bound
 * (`shapeLocalBrowserDisplayUrl`); this unredacted form is bounded directly.
 */
export function minimizeLocalBrowserUrl(value: unknown): string {
  return boundLength(
    minimizeUrlForRedaction(value),
    LOCAL_BROWSER_DIAGNOSTIC_LIMITS.urlChars,
  )
}

function originForRedaction(value: unknown): string {
  if (typeof value !== "string") return ""
  const trimmed = value.trim()
  const hierarchical = HIERARCHICAL_URL.exec(trimmed)
  if (hierarchical) {
    const authority = hierarchical[2] ?? ""
    return precapUrl(
      `${(hierarchical[1] ?? "").toLowerCase()}://${authority.slice(authority.lastIndexOf("@") + 1)}`,
    )
  }
  const opaque = OPAQUE_URL.exec(trimmed)
  return opaque ? `${(opaque[1] ?? "").toLowerCase()}:` : ""
}

/**
 * Origin for security logs and blocked-navigation diagnostics:
 * `scheme://host[:port]` for hierarchical URLs and only `scheme:` otherwise.
 * Unredacted; projections use `shapeLocalBrowserOrigin`.
 */
export function minimizeLocalBrowserOrigin(value: unknown): string {
  return boundLength(
    originForRedaction(value),
    LOCAL_BROWSER_DIAGNOSTIC_LIMITS.urlChars,
  )
}

/** Minimized origin, then main-composed redaction, then the length bound. */
export function shapeLocalBrowserOrigin(
  value: unknown,
  redact: LocalBrowserTextRedactor,
): string {
  const origin = originForRedaction(value)
  if (!origin) return ""
  return boundLength(redact(origin), LOCAL_BROWSER_DIAGNOSTIC_LIMITS.urlChars)
}

const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>()]+/gi

/**
 * Minimizes every absolute URL embedded in free page text. Length bounds
 * apply only after redaction (`shapeLocalBrowserText`).
 */
export function minimizeUrlsInText(value: string): string {
  return value.replace(URL_IN_TEXT, (match) => minimizeUrlForRedaction(match))
}

/**
 * Shapes one page-controlled text value: whitespace/pre-cap, URL
 * minimization, main-composed redaction, then the final length bound.
 */
export function shapeLocalBrowserText(
  value: unknown,
  redact: LocalBrowserTextRedactor,
  maxChars: number,
): string {
  if (typeof value !== "string") return ""
  const minimized = minimizeUrlsInText(precap(value))
  if (!minimized) return ""
  return boundLength(redact(minimized).replace(/\s+/g, " ").trim(), maxChars)
}

/** Minimize, redact, then bound: a length cut never precedes redaction. */
function shapeUrl(value: unknown, redact: LocalBrowserTextRedactor): string {
  const minimized = minimizeUrlForRedaction(value)
  if (!minimized) return ""
  return boundLength(
    redact(minimized),
    LOCAL_BROWSER_DIAGNOSTIC_LIMITS.urlChars,
  )
}

function boundedInteger(value: unknown, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined
  if (value < -max || value > max) return undefined
  return value
}

export type LocalBrowserRawConsoleMessage = {
  level: unknown
  message: unknown
  sourceId: unknown
  lineNumber: unknown
}

export function shapeLocalBrowserConsoleMessage(
  raw: LocalBrowserRawConsoleMessage,
  redact: LocalBrowserTextRedactor,
  timestamp: string,
): LocalBrowserConsoleMessage | null {
  const text = shapeLocalBrowserText(
    raw.message,
    redact,
    LOCAL_BROWSER_DIAGNOSTIC_LIMITS.consoleTextChars,
  )
  if (!text) return null
  const source = shapeUrl(raw.sourceId, redact)
  const line = boundedInteger(
    raw.lineNumber,
    LOCAL_BROWSER_DIAGNOSTIC_LIMITS.maxLineNumber,
  )
  return {
    level: mapLocalBrowserConsoleLevel(raw.level),
    text,
    ...(source ? { source } : {}),
    ...(line !== undefined && line > 0 ? { line } : {}),
    timestamp,
  }
}

const NET_ERROR_TOKEN = /\b(?:net::)?(ERR_[A-Z0-9_]{1,64})\b/

export type LocalBrowserRawLoadFailure = {
  errorCode: unknown
  errorDescription: unknown
  validatedURL: unknown
}

/**
 * Load failures keep only the minimized URL, the Chromium net-error token
 * and a bounded integer code. Free description text is never projected.
 */
export function shapeLocalBrowserLoadFailure(
  raw: LocalBrowserRawLoadFailure,
  redact: LocalBrowserTextRedactor,
  timestamp: string,
): LocalBrowserLoadFailure {
  const description =
    typeof raw.errorDescription === "string" ? raw.errorDescription : ""
  const token = NET_ERROR_TOKEN.exec(description)?.[1]
  const code = boundedInteger(raw.errorCode, 100_000)
  return {
    url: shapeUrl(raw.validatedURL, redact),
    reason: token ?? "Load failed",
    ...(code !== undefined ? { code } : {}),
    timestamp,
  }
}

export function shapeLocalBrowserTitle(
  value: unknown,
  redact: LocalBrowserTextRedactor,
): string {
  return shapeLocalBrowserText(
    value,
    redact,
    LOCAL_BROWSER_DIAGNOSTIC_LIMITS.titleChars,
  )
}

export function shapeLocalBrowserDisplayUrl(
  value: unknown,
  redact: LocalBrowserTextRedactor,
): string {
  return shapeUrl(value, redact)
}

function shapeList(
  value: unknown,
  shapeItem: (item: unknown) => string,
): string[] {
  if (!Array.isArray(value)) return []
  const shaped: string[] = []
  for (const item of value.slice(
    0,
    LOCAL_BROWSER_DIAGNOSTIC_LIMITS.listItems,
  )) {
    const text = shapeItem(item)
    if (text) shaped.push(text)
  }
  return shaped
}

/**
 * Shapes a DOM-summary probe result. The probe runs in the page and its
 * result is page-controlled, so every field is re-validated here.
 */
export function shapeLocalBrowserDomSummary(
  raw: unknown,
  redact: LocalBrowserTextRedactor,
): LocalBrowserDomSummary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>
  const itemChars = LOCAL_BROWSER_DIAGNOSTIC_LIMITS.listItemChars
  const text = (item: unknown) => shapeLocalBrowserText(item, redact, itemChars)
  const activeElement = text(source.activeElement)
  return {
    title: shapeLocalBrowserTitle(source.title, redact),
    url: shapeUrl(source.url, redact),
    activeElement: activeElement || null,
    headings: shapeList(source.headings, text),
    buttons: shapeList(source.buttons, text),
    links: shapeList(source.links, (item) => {
      if (!item || typeof item !== "object") return ""
      const link = item as Record<string, unknown>
      const label = text(link.label)
      const redactedHref = shapeUrl(link.href, redact)
      const combined = label
        ? redactedHref
          ? `${label} -> ${redactedHref}`
          : label
        : redactedHref
      return boundLength(combined, itemChars)
    }),
    inputs: shapeList(source.inputs, text),
    textSample: shapeLocalBrowserText(
      source.textSample,
      redact,
      LOCAL_BROWSER_DIAGNOSTIC_LIMITS.textSampleChars,
    ),
  }
}

export function shapeLocalBrowserSelectedElement(
  value: unknown,
  redact: LocalBrowserTextRedactor,
): string | null {
  const shaped = shapeLocalBrowserText(
    value,
    redact,
    LOCAL_BROWSER_DIAGNOSTIC_LIMITS.selectedElementChars,
  )
  return shaped || null
}

export type LocalBrowserScreenshotCandidate = {
  mimeType: string
  width: number
  height: number
  byteLength: number
}

/** Identity-independent type/dimension/byte bounds for a main capture. */
export function isAcceptableLocalBrowserScreenshot(
  candidate: LocalBrowserScreenshotCandidate,
): boolean {
  const limits = LOCAL_BROWSER_SCREENSHOT_LIMITS
  return (
    candidate.mimeType === limits.mimeType &&
    Number.isInteger(candidate.width) &&
    Number.isInteger(candidate.height) &&
    candidate.width > 0 &&
    candidate.height > 0 &&
    candidate.width <= limits.maxWidth &&
    candidate.height <= limits.maxHeight &&
    candidate.byteLength > 0 &&
    candidate.byteLength <= limits.maxBytes
  )
}
