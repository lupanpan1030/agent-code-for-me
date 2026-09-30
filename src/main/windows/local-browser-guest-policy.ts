import type {
  App,
  IpcMain,
  IpcMainInvokeEvent,
  NativeImage,
  Protocol,
  Session,
  WebContents,
  WebPreferences,
} from "electron"
import {
  isAcceptableLocalBrowserScreenshot,
  LOCAL_BROWSER_SCREENSHOT_LIMITS,
  type LocalBrowserCaptureResult,
  type LocalBrowserFileScope,
  type LocalBrowserGuestCloseReason,
  type LocalBrowserGuestEvent,
  type LocalBrowserPreviewAdmission,
  type LocalBrowserPreviewDenialCode,
  type LocalBrowserPreviewKind,
  type LocalBrowserScreenshotProjection,
  type LocalBrowserTextRedactor,
  minimizeLocalBrowserOrigin,
  shapeLocalBrowserConsoleMessage,
  shapeLocalBrowserDisplayUrl,
  shapeLocalBrowserDomSummary,
  shapeLocalBrowserLoadFailure,
  shapeLocalBrowserOrigin,
  shapeLocalBrowserSelectedElement,
  shapeLocalBrowserTitle,
} from "../../shared/local-browser-diagnostics-policy"
import {
  LOCAL_BROWSER_DIAGNOSTIC_PROBES,
  type LocalBrowserDiagnosticProbe,
  localBrowserFileUrlPath,
  normalizeLocalBrowserRootPath,
  normalizeLocalBrowserUrl,
} from "../../shared/local-browser-workbench"
import { redactUntrustedDiagnosticPayload } from "../lib/agent-runtime/redaction"
import {
  closeStableDirectory,
  openRegisteredStableDirectory,
  openStableDirectoryChild,
  readStableDirectoryFile,
  type StableDirectoryHandle,
} from "../lib/filesystem/stable-directory"

/*
 * Sole main-process owner of the Local Browser `<webview>` guest boundary
 * (design D5-D9, Security Invariants 4-7).
 *
 * - D5: one `web-contents-created` hook guards every potential embedder;
 *   only app windows registered by `main.ts` may attach a guest, and
 *   `will-attach-webview` forces the exact secure preference set.
 * - D6: main issues a one-shot, short-TTL, count-bounded admission whose
 *   high-entropy non-persistent partition is the only attachment capability.
 * - D7: the partition's Session is configured before it is returned: one
 *   `onBeforeRequest` gate, every Session deny handler and, for file
 *   admissions only, the `locus-preview` broker over the stable-directory
 *   descriptor owner.
 * - D8: permissions, devices, display capture, downloads and popups deny.
 * - D9: page-controlled diagnostics stay in main until the shared shape
 *   adapter and the canonical redaction owner have processed them.
 *
 * Electron is imported only as types; every runtime surface is injected so
 * the pure decisions below load under `bun test` without Electron.
 */

export const LOCUS_PREVIEW_SCHEME = "locus-preview"
const LOCUS_PREVIEW_HOST_SUFFIX = ".preview.local"
const GUEST_PARTITION_PREFIX = "locus-guest-"

export const LOCAL_BROWSER_GUEST_CHANNELS = Object.freeze({
  requestPreview: "local-browser:request-preview",
  captureDiagnostics: "local-browser:capture-diagnostics",
  guestEvent: "local-browser:guest-event",
})

/**
 * Exact `locus-preview` privileges (design D7). Registration alone grants no
 * filesystem access; only file-admission Sessions bind a handler.
 */
export const LOCUS_PREVIEW_PRIVILEGES = Object.freeze({
  standard: true,
  secure: true,
  supportFetchAPI: true,
  corsEnabled: true,
  bypassCSP: false,
  allowServiceWorkers: false,
  stream: false,
  codeCache: false,
})

export const LOCAL_BROWSER_GUEST_LIMITS = Object.freeze({
  /** Pending admission lifetime before attachment. */
  admissionTtlMs: 30_000,
  /** Live (pending, attaching or attached) admissions across the process. */
  maxActiveAdmissions: 8,
  /** Partitions ever issued by this process; never reused. */
  maxIssuedPartitions: 512,
  /** Largest brokered preview file. */
  maxPreviewFileBytes: 32 * 1024 * 1024,
  /** Bounded wait for a guest to report destruction after `close()`. */
  teardownConfirmTimeoutMs: 2_000,
  /** Bounded wait for one diagnostic probe or capture. */
  probeTimeoutMs: 5_000,
  maxChatIdLength: 256,
  maxUrlLength: 4096,
})

/**
 * The exact effective guest preference set (design D5). `preload`,
 * `preloadURL` and blink feature switches are removed; every value below is
 * written regardless of what the element or embedder supplied.
 */
export const LOCAL_BROWSER_GUEST_WEB_PREFERENCES = Object.freeze({
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  nodeIntegrationInWorker: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  disablePopups: true,
  experimentalFeatures: false,
  plugins: false,
  javascript: true,
})

const REMOVED_GUEST_PREFERENCE_KEYS = [
  "preload",
  "preloadURL",
  "enableBlinkFeatures",
] as const

/** `<webview>` attributes that request unsafe guest capabilities. */
const UNSAFE_WEBVIEW_ATTRIBUTES = [
  "preload",
  "nodeintegration",
  "nodeintegrationinsubframes",
  "plugins",
  "disablewebsecurity",
  "allowpopups",
  "webpreferences",
  "blinkfeatures",
] as const

/**
 * Guest permissions are denied unconditionally; `openExternal` is named so
 * external-protocol navigation can never reach an OS handler.
 */
export const LOCAL_BROWSER_GUEST_DENIED_PERMISSIONS = Object.freeze([
  "openExternal",
  "media",
  "clipboard-read",
  "clipboard-sanitized-write",
  "geolocation",
  "notifications",
  "fullscreen",
  "pointerLock",
  "keyboardLock",
  "fileSystem",
  "hid",
  "serial",
  "usb",
  "midi",
  "midiSysex",
  "idle-detection",
  "storage-access",
  "top-level-storage-access",
  "display-capture",
  "window-management",
])

// ---------------------------------------------------------------------------
// Pure decisions
// ---------------------------------------------------------------------------

export type GuestOriginPolicy =
  | { kind: "http"; origin: string }
  | {
      kind: "file"
      host: string
      /** Decoded document path segments beneath the per-admission host root. */
      documentSegments: readonly string[]
    }

export type GuestDenialReason =
  | "revoked"
  | "invalid-url"
  | "direct-file"
  | "preview-scheme-on-http-session"
  | "other-preview-host"
  | "ambiguous-path"
  | "document-mismatch"
  | "credentials"
  | "top-level-origin"
  | "external-scheme"
  | "unsupported-scheme"
  | "non-admitted-commit"

export type GuestRequestVerdict =
  | { cancel: false }
  | { cancel: true; reason: GuestDenialReason }

export type GuestNavigationVerdict =
  | { allow: true }
  | { allow: false; reason: GuestDenialReason }

type ParsedUrl = { url: URL; protocol: string }

function parseUrl(value: string): ParsedUrl | null {
  try {
    const url = new URL(value)
    return { url, protocol: url.protocol.toLowerCase() }
  } catch {
    return null
  }
}

/**
 * Decodes a `locus-preview` path into single, unambiguous components.
 * Encoded separators, NUL/control characters, empty/dot segments and
 * undecodable escapes fail closed. A trailing slash yields a final empty
 * component that callers treat as "no document".
 */
export function decodePreviewPathSegments(pathname: string): string[] | null {
  if (!pathname.startsWith("/")) return null
  const rawSegments = pathname.slice(1).split("/")
  const segments: string[] = []
  for (const [index, raw] of rawSegments.entries()) {
    const isLast = index === rawSegments.length - 1
    if (raw === "" && isLast) {
      segments.push("")
      continue
    }
    if (/%(?:2f|5c|00)/i.test(raw)) return null
    let decoded: string
    try {
      decoded = decodeURIComponent(raw)
    } catch {
      return null
    }
    if (
      decoded === "" ||
      decoded === "." ||
      decoded === ".." ||
      /[/\\]/.test(decoded) ||
      hasControlCharacter(decoded)
    ) {
      return null
    }
    segments.push(decoded)
  }
  return segments
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}

function samePreviewDocument(
  policy: Extract<GuestOriginPolicy, { kind: "file" }>,
  url: URL,
): boolean | null {
  const segments = decodePreviewPathSegments(url.pathname)
  if (!segments) return null
  return (
    segments.length === policy.documentSegments.length &&
    segments.every(
      (segment, index) => segment === policy.documentSegments[index],
    )
  )
}

function isAdmittedPreviewHost(
  policy: Extract<GuestOriginPolicy, { kind: "file" }>,
  url: URL,
): boolean {
  return (
    url.hostname.toLowerCase() === policy.host &&
    url.port === "" &&
    url.username === "" &&
    url.password === ""
  )
}

/**
 * Session `onBeforeRequest` verdict (design D7). Direct `file:` is cancelled
 * for every resource type; `locus-preview:` is cancelled on HTTP(S) Sessions
 * and confined to the admission host/document elsewhere; top-level requests
 * must match the exact admitted origin; only HTTP(S)/WebSocket subresource
 * traffic passes under the accepted egress residual. There is no
 * allow-unknown-scheme branch.
 */
export function decideGuestRequest(
  policy: GuestOriginPolicy,
  live: boolean,
  request: { url: string; resourceType: string },
): GuestRequestVerdict {
  if (!live) return { cancel: true, reason: "revoked" }
  const parsed = parseUrl(request.url)
  if (!parsed) return { cancel: true, reason: "invalid-url" }
  const { url, protocol } = parsed
  const isMainFrame = request.resourceType === "mainFrame"

  if (protocol === "file:") return { cancel: true, reason: "direct-file" }

  if (protocol === `${LOCUS_PREVIEW_SCHEME}:`) {
    if (policy.kind !== "file") {
      return { cancel: true, reason: "preview-scheme-on-http-session" }
    }
    if (!isAdmittedPreviewHost(policy, url)) {
      return { cancel: true, reason: "other-preview-host" }
    }
    const segments = decodePreviewPathSegments(url.pathname)
    if (!segments) return { cancel: true, reason: "ambiguous-path" }
    if (isMainFrame && samePreviewDocument(policy, url) !== true) {
      return { cancel: true, reason: "document-mismatch" }
    }
    return { cancel: false }
  }

  if (protocol === "http:" || protocol === "https:") {
    if (!isMainFrame) return { cancel: false }
    if (url.username || url.password) {
      return { cancel: true, reason: "credentials" }
    }
    if (policy.kind !== "http" || url.origin !== policy.origin) {
      return { cancel: true, reason: "top-level-origin" }
    }
    return { cancel: false }
  }

  if ((protocol === "ws:" || protocol === "wss:") && !isMainFrame) {
    return { cancel: false }
  }

  return { cancel: true, reason: "unsupported-scheme" }
}

const SUBFRAME_NON_NETWORK_SCHEMES: ReadonlySet<string> = new Set([
  "about:",
  "data:",
  "blob:",
  "javascript:",
])

/**
 * Guest `will-navigate` / `will-frame-navigate` / `will-redirect` verdict.
 * Top-level navigation must stay on the exact admitted origin (and, for a
 * file admission, the admitted document); every non-network or external
 * top-level scheme is denied. Subframes may use network or in-sandbox
 * non-network schemes (accepted frame residual) but never `file:`, another
 * preview host, or an external/unknown scheme.
 */
export function decideGuestNavigation(
  policy: GuestOriginPolicy,
  live: boolean,
  navigation: { url: string; isMainFrame: boolean },
): GuestNavigationVerdict {
  if (!live) return { allow: false, reason: "revoked" }
  const parsed = parseUrl(navigation.url)
  if (!parsed) return { allow: false, reason: "invalid-url" }
  const { url, protocol } = parsed

  if (navigation.isMainFrame) {
    if (protocol === "http:" || protocol === "https:") {
      if (url.username || url.password) {
        return { allow: false, reason: "credentials" }
      }
      return policy.kind === "http" && url.origin === policy.origin
        ? { allow: true }
        : { allow: false, reason: "top-level-origin" }
    }
    if (protocol === `${LOCUS_PREVIEW_SCHEME}:`) {
      if (policy.kind !== "file") {
        return { allow: false, reason: "preview-scheme-on-http-session" }
      }
      if (!isAdmittedPreviewHost(policy, url)) {
        return { allow: false, reason: "other-preview-host" }
      }
      const same = samePreviewDocument(policy, url)
      if (same === null) return { allow: false, reason: "ambiguous-path" }
      return same
        ? { allow: true }
        : { allow: false, reason: "document-mismatch" }
    }
    if (protocol === "file:") return { allow: false, reason: "direct-file" }
    if (SUBFRAME_NON_NETWORK_SCHEMES.has(protocol)) {
      return { allow: false, reason: "non-admitted-commit" }
    }
    return { allow: false, reason: "external-scheme" }
  }

  if (
    protocol === "http:" ||
    protocol === "https:" ||
    SUBFRAME_NON_NETWORK_SCHEMES.has(protocol)
  ) {
    return { allow: true }
  }
  if (protocol === `${LOCUS_PREVIEW_SCHEME}:`) {
    return policy.kind === "file" && isAdmittedPreviewHost(policy, url)
      ? { allow: true }
      : { allow: false, reason: "other-preview-host" }
  }
  if (protocol === "file:") return { allow: false, reason: "direct-file" }
  return { allow: false, reason: "external-scheme" }
}

function blobCreatorMatchesAdmission(
  policy: GuestOriginPolicy,
  blobUrl: URL,
): boolean {
  const inner = parseUrl(blobUrl.pathname)
  if (!inner) return false
  if (policy.kind === "http") {
    return (
      (inner.protocol === "http:" || inner.protocol === "https:") &&
      inner.url.origin === policy.origin
    )
  }
  return (
    inner.protocol === `${LOCUS_PREVIEW_SCHEME}:` &&
    isAdmittedPreviewHost(policy, inner.url)
  )
}

/**
 * Committed-URL postcondition (design D7). Non-network documents are not
 * observable by `webRequest`, so this is their owner: only a browser-created
 * initial `about:blank` and a `blob:` document whose creator origin equals
 * the exact admission are permitted besides the admitted target itself.
 */
export function decideCommittedGuestUrl(
  policy: GuestOriginPolicy,
  commit: { url: string; isInitialDocument: boolean; isSameDocument: boolean },
): GuestNavigationVerdict {
  const parsed = parseUrl(commit.url)
  if (!parsed) return { allow: false, reason: "invalid-url" }
  const { url, protocol } = parsed
  if (protocol === "about:") {
    return commit.isInitialDocument && url.href === "about:blank"
      ? { allow: true }
      : { allow: false, reason: "non-admitted-commit" }
  }
  if (protocol === "blob:") {
    return blobCreatorMatchesAdmission(policy, url)
      ? { allow: true }
      : { allow: false, reason: "non-admitted-commit" }
  }
  if (protocol === "http:" || protocol === "https:") {
    return policy.kind === "http" &&
      url.origin === policy.origin &&
      !url.username &&
      !url.password
      ? { allow: true }
      : { allow: false, reason: "top-level-origin" }
  }
  if (protocol === `${LOCUS_PREVIEW_SCHEME}:` && policy.kind === "file") {
    if (!isAdmittedPreviewHost(policy, url)) {
      return { allow: false, reason: "other-preview-host" }
    }
    if (commit.isSameDocument) return { allow: true }
    return samePreviewDocument(policy, url) === true
      ? { allow: true }
      : { allow: false, reason: "document-mismatch" }
  }
  return { allow: false, reason: "non-admitted-commit" }
}

/**
 * Chromium's net error for a request cancelled by the Session
 * `webRequest.onBeforeRequest` gate (`net::ERR_BLOCKED_BY_CLIENT`).
 */
export const GUEST_REQUEST_GATE_CANCEL_ERROR_CODE = -20

/**
 * Main-frame provisional load failure verdict (design D7 committed-URL
 * postcondition). When the request gate cancels a top-level request that the
 * navigation handlers did not prevent, Chromium commits an error page and
 * reports `did-fail-provisional-load`/`did-fail-load`, never `did-navigate`,
 * so the committed-URL rule cannot observe it there. A live guest in that
 * state is torn down; every other failure is only projected as a diagnostic.
 */
export function decideGuestProvisionalLoadFailure(
  live: boolean,
  failure: { errorCode: number; isMainFrame: boolean },
): "teardown" | "project" {
  return live &&
    failure.isMainFrame &&
    failure.errorCode === GUEST_REQUEST_GATE_CANCEL_ERROR_CODE
    ? "teardown"
    : "project"
}

/** Every guest permission check or request is denied (design D8). */
export function decideGuestPermission(_permission: string): false {
  return false
}

/** Guest `window.open` / `_blank` never creates a window or opens an OS app. */
export function decideGuestWindowOpen(): { action: "deny" } {
  return { action: "deny" }
}

/**
 * Forces the exact secure guest preference set onto Electron's mutable
 * `will-attach-webview` preferences. Returns the keys whose supplied value
 * was unsafe (for bounded reason logging only).
 */
export function enforceGuestWebPreferences(
  webPreferences: WebPreferences | Record<string, unknown>,
  partition: string,
): string[] {
  const preferences = webPreferences as Record<string, unknown>
  const overridden: string[] = []
  for (const key of REMOVED_GUEST_PREFERENCE_KEYS) {
    if (preferences[key] !== undefined && preferences[key] !== "") {
      overridden.push(key)
    }
    delete preferences[key]
  }
  const additional = preferences.additionalArguments
  if (Array.isArray(additional) && additional.length > 0) {
    overridden.push("additionalArguments")
  }
  preferences.additionalArguments = []
  for (const [key, value] of Object.entries(
    LOCAL_BROWSER_GUEST_WEB_PREFERENCES,
  )) {
    if (preferences[key] !== undefined && preferences[key] !== value) {
      overridden.push(key)
    }
    preferences[key] = value
  }
  preferences.partition = partition
  return overridden
}

/** Post-attach verification of the effective guest preferences. */
export function guestPreferencesAreSecure(
  preferences: Record<string, unknown> | null | undefined,
): boolean {
  if (!preferences) return false
  const additional = preferences.additionalArguments
  return (
    preferences.nodeIntegration !== true &&
    preferences.nodeIntegrationInSubFrames !== true &&
    preferences.nodeIntegrationInWorker !== true &&
    preferences.contextIsolation === true &&
    preferences.sandbox === true &&
    preferences.webSecurity !== false &&
    preferences.webviewTag !== true &&
    preferences.allowRunningInsecureContent !== true &&
    !preferences.preload &&
    !preferences.preloadURL &&
    (additional === undefined ||
      (Array.isArray(additional) && additional.length === 0))
  )
}

/** Names of `<webview>` attributes requesting unsafe capabilities. */
export function unsafeWebviewAttributes(
  params: Record<string, unknown>,
): string[] {
  return UNSAFE_WEBVIEW_ATTRIBUTES.filter((name) => {
    const value = params[name]
    return (
      value === true ||
      (typeof value === "string" && value.length > 0 && value !== "false")
    )
  })
}

// ---------------------------------------------------------------------------
// Admission lifecycle (pure state machine + registry)
// ---------------------------------------------------------------------------

export type GuestLifecycleState =
  | "pending"
  | "attaching"
  | "attached"
  | "tearing-down"
  | "teardown-unconfirmed"
  | "destroyed"
  | "revoked"

export type GuestLifecycleEvent =
  | "attach-begin"
  | "attach-complete"
  | "teardown-begin"
  | "destroy-confirmed"
  | "destroy-unconfirmed"
  | "revoke"

/**
 * Teardown state machine (design D5/D6). Authority exists only in
 * `pending`/`attaching`/`attached`; every other state is terminal for
 * authority, so a revoked or destroyed admission can never be revived or
 * re-attached.
 */
export function nextGuestLifecycleState(
  state: GuestLifecycleState,
  event: GuestLifecycleEvent,
): GuestLifecycleState {
  switch (state) {
    case "pending":
      if (event === "attach-begin") return "attaching"
      if (event === "revoke" || event === "teardown-begin") return "revoked"
      return state
    case "attaching":
      if (event === "attach-complete") return "attached"
      if (event === "revoke" || event === "teardown-begin") {
        return "tearing-down"
      }
      return state
    case "attached":
      if (event === "revoke" || event === "teardown-begin") {
        return "tearing-down"
      }
      return state
    case "tearing-down":
      if (event === "destroy-confirmed") return "destroyed"
      if (event === "destroy-unconfirmed") return "teardown-unconfirmed"
      return state
    case "teardown-unconfirmed":
      return event === "destroy-confirmed" ? "destroyed" : state
    default:
      return state
  }
}

export function guestLifecycleHasAuthority(
  state: GuestLifecycleState,
): boolean {
  return state === "pending" || state === "attaching" || state === "attached"
}

export type GuestAdmission = {
  readonly generation: number
  /** Opaque bearer capability; never logged, persisted or placed in a URL. */
  readonly partition: string
  readonly embedderId: number
  readonly chatId: string
  readonly initialSrc: string
  readonly displayUrl: string
  readonly kind: LocalBrowserPreviewKind
  readonly policy: GuestOriginPolicy
  readonly fileScope: LocalBrowserFileScope | null
  readonly expiresAt: number
  state: GuestLifecycleState
  guestId: number | null
}

export type AdmissionIssueInput = {
  embedderId: number
  chatId: string
  initialSrc: string
  displayUrl: string
  kind: LocalBrowserPreviewKind
  policy: GuestOriginPolicy
  fileScope: LocalBrowserFileScope | null
}

export type AttachDenialReason =
  | "unknown-partition"
  | "persistent-partition"
  | "replayed"
  | "revoked"
  | "expired"
  | "embedder-mismatch"
  | "src-mismatch"

export type AttachVerdict =
  | { ok: true; admission: GuestAdmission }
  | { ok: false; reason: AttachDenialReason; admission: GuestAdmission | null }

export type AdmissionRegistryOptions = {
  now: () => number
  /** Returns a fresh high-entropy lowercase token. */
  randomToken: () => string
  ttlMs: number
  maxActive: number
  maxIssued: number
}

/**
 * Pending/attached admission registry (design D6): embedder + chat +
 * generation + exact partition + exact initial src, one-shot consume,
 * short TTL, replay/conflict rejection, active and cumulative caps and
 * never-reused partitions.
 */
export class LocalBrowserAdmissionRegistry {
  private readonly byPartition = new Map<string, GuestAdmission>()
  private readonly issuedPartitions = new Set<string>()
  private generationCounter = 0

  constructor(private readonly options: AdmissionRegistryOptions) {}

  get issuedCount(): number {
    return this.issuedPartitions.size
  }

  activeAdmissions(): GuestAdmission[] {
    return [...this.byPartition.values()].filter((admission) =>
      guestLifecycleHasAuthority(admission.state),
    )
  }

  /** Revokes pending/attaching admissions whose TTL elapsed. */
  sweepExpired(): GuestAdmission[] {
    const now = this.options.now()
    const expired: GuestAdmission[] = []
    for (const admission of this.byPartition.values()) {
      if (
        (admission.state === "pending" || admission.state === "attaching") &&
        admission.expiresAt <= now
      ) {
        this.transition(admission, "revoke")
        expired.push(admission)
      }
    }
    return expired
  }

  issue(
    input: AdmissionIssueInput,
  ):
    | { ok: true; admission: GuestAdmission; superseded: GuestAdmission[] }
    | { ok: false; code: "capacity"; superseded: GuestAdmission[] } {
    this.sweepExpired()
    const superseded: GuestAdmission[] = []
    for (const admission of this.activeAdmissions()) {
      if (
        admission.embedderId === input.embedderId &&
        admission.chatId === input.chatId
      ) {
        this.transition(admission, "revoke")
        superseded.push(admission)
      }
    }
    if (
      this.activeAdmissions().length >= this.options.maxActive ||
      this.issuedPartitions.size >= this.options.maxIssued
    ) {
      return { ok: false, code: "capacity", superseded }
    }
    let partition = ""
    for (let attempt = 0; attempt < 4 && !partition; attempt += 1) {
      const candidate = `${GUEST_PARTITION_PREFIX}${this.options.randomToken()}`
      if (!this.issuedPartitions.has(candidate)) partition = candidate
    }
    if (!partition) return { ok: false, code: "capacity", superseded }
    this.issuedPartitions.add(partition)
    this.generationCounter += 1
    const admission: GuestAdmission = {
      generation: this.generationCounter,
      partition,
      embedderId: input.embedderId,
      chatId: input.chatId,
      initialSrc: input.initialSrc,
      displayUrl: input.displayUrl,
      kind: input.kind,
      policy: input.policy,
      fileScope: input.fileScope,
      expiresAt: this.options.now() + this.options.ttlMs,
      state: "pending",
      guestId: null,
    }
    this.byPartition.set(partition, admission)
    return { ok: true, admission, superseded }
  }

  /** `will-attach-webview`: one-shot consume of the exact admission. */
  beginAttach(request: {
    embedderId: number
    partition: unknown
    src: unknown
  }): AttachVerdict {
    const partition =
      typeof request.partition === "string" ? request.partition : ""
    if (!partition) {
      return { ok: false, reason: "unknown-partition", admission: null }
    }
    if (partition.startsWith("persist:")) {
      return { ok: false, reason: "persistent-partition", admission: null }
    }
    const admission = this.byPartition.get(partition)
    if (!admission) {
      return { ok: false, reason: "unknown-partition", admission: null }
    }
    if (admission.state === "attaching" || admission.state === "attached") {
      return { ok: false, reason: "replayed", admission }
    }
    if (admission.state !== "pending") {
      return { ok: false, reason: "revoked", admission }
    }
    if (admission.expiresAt <= this.options.now()) {
      this.transition(admission, "revoke")
      return { ok: false, reason: "expired", admission }
    }
    if (admission.embedderId !== request.embedderId) {
      this.transition(admission, "revoke")
      return { ok: false, reason: "embedder-mismatch", admission }
    }
    if (request.src !== admission.initialSrc) {
      this.transition(admission, "revoke")
      return { ok: false, reason: "src-mismatch", admission }
    }
    this.transition(admission, "attach-begin")
    return { ok: true, admission }
  }

  /** `did-attach-webview`: binds the consumed admission to its guest. */
  completeAttach(
    admission: GuestAdmission,
    embedderId: number,
    guestId: number,
  ): boolean {
    if (
      admission.state !== "attaching" ||
      admission.embedderId !== embedderId ||
      this.byPartition.get(admission.partition) !== admission
    ) {
      return false
    }
    this.transition(admission, "attach-complete")
    admission.guestId = guestId
    return true
  }

  transition(admission: GuestAdmission, event: GuestLifecycleEvent): void {
    admission.state = nextGuestLifecycleState(admission.state, event)
  }

  findByGeneration(generation: number): GuestAdmission | null {
    for (const admission of this.byPartition.values()) {
      if (admission.generation === generation) return admission
    }
    return null
  }

  forEmbedder(embedderId: number): GuestAdmission[] {
    return [...this.byPartition.values()].filter(
      (admission) => admission.embedderId === embedderId,
    )
  }
}

// ---------------------------------------------------------------------------
// locus-preview broker (design D7 option (a))
// ---------------------------------------------------------------------------

export type FilePreviewBinding = {
  readonly host: string
  /** DB-registered root path as resolved by main. */
  readonly registeredRoot: string
  /** realpath-canonical anchor path frozen at admission. */
  readonly canonicalRoot: string
  readonly rootDev: number
  readonly rootIno: number
  /** Frozen scope: worktree-relative directory components of the document. */
  readonly scopeSegments: readonly string[]
  readonly isLive: () => boolean
}

export type PreviewResponse = {
  status: number
  body: Uint8Array<ArrayBuffer> | null
  contentType: string | null
}

export type PreviewFileSystem = {
  openRegisteredRoot: (path: string, label: string) => StableDirectoryHandle
  openChild: (
    parent: StableDirectoryHandle,
    name: string,
    label: string,
  ) => StableDirectoryHandle
  readFile: (
    directory: StableDirectoryHandle,
    name: string,
    label: string,
    options: { maxBytes: number },
  ) => { bytes: Buffer }
  close: (handle: StableDirectoryHandle) => void
}

const STABLE_DIRECTORY_PREVIEW_FS: PreviewFileSystem = {
  openRegisteredRoot: openRegisteredStableDirectory,
  openChild: openStableDirectoryChild,
  readFile: readStableDirectoryFile,
  close: closeStableDirectory,
}

const PREVIEW_CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  xml: "application/xml",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
})

function previewContentType(name: string): string {
  const dot = name.lastIndexOf(".")
  const extension = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ""
  return PREVIEW_CONTENT_TYPES[extension] ?? "application/octet-stream"
}

function previewDenied(status: number): PreviewResponse {
  return { status, body: null, contentType: null }
}

/**
 * Anchored read of one admitted-scope file: the registered root is
 * re-canonicalized and must still match the identity frozen at admission,
 * every directory is opened through the previous descriptor without
 * following symlinks, and the regular file is read from the same verified
 * descriptor. Any drift, symlink, special file or out-of-scope path fails
 * closed; there is no path-only or direct `file:` fallback.
 */
export function readFilePreviewAsset(
  binding: FilePreviewBinding,
  relativeSegments: readonly string[],
  fs: PreviewFileSystem = STABLE_DIRECTORY_PREVIEW_FS,
): { bytes: Buffer } | null {
  const name = relativeSegments.at(-1)
  if (!name) return null
  const handles: StableDirectoryHandle[] = []
  try {
    const root = fs.openRegisteredRoot(binding.registeredRoot, "Preview root")
    handles.push(root)
    if (
      root.path !== binding.canonicalRoot ||
      root.dev !== binding.rootDev ||
      root.ino !== binding.rootIno
    ) {
      return null
    }
    let directory = root
    for (const segment of [
      ...binding.scopeSegments,
      ...relativeSegments.slice(0, -1),
    ]) {
      directory = fs.openChild(directory, segment, "Preview directory")
      handles.push(directory)
    }
    return fs.readFile(directory, name, "Preview file", {
      maxBytes: LOCAL_BROWSER_GUEST_LIMITS.maxPreviewFileBytes,
    })
  } catch {
    return null
  } finally {
    for (const handle of handles.reverse()) fs.close(handle)
  }
}

/**
 * `locus-preview` protocol decision for one request. It independently
 * enforces the live admission, exact host, frozen scope and anchored read,
 * whether or not the runtime routes custom-scheme requests through the
 * Session `webRequest` gate. No CORS or origin-relaxing header is emitted.
 */
export function serveLocusPreviewRequest(
  binding: FilePreviewBinding,
  request: { url: string; method: string },
  fs: PreviewFileSystem = STABLE_DIRECTORY_PREVIEW_FS,
): PreviewResponse {
  if (!binding.isLive()) return previewDenied(403)
  if (request.method !== "GET" && request.method !== "HEAD") {
    return previewDenied(405)
  }
  const parsed = parseUrl(request.url)
  if (!parsed || parsed.protocol !== `${LOCUS_PREVIEW_SCHEME}:`) {
    return previewDenied(403)
  }
  if (
    parsed.url.hostname.toLowerCase() !== binding.host ||
    parsed.url.port !== "" ||
    parsed.url.username !== "" ||
    parsed.url.password !== ""
  ) {
    return previewDenied(403)
  }
  const segments = decodePreviewPathSegments(parsed.url.pathname)
  if (!segments) return previewDenied(403)
  const name = segments.at(-1)
  if (!name) return previewDenied(404)
  const asset = readFilePreviewAsset(binding, segments, fs)
  if (!asset) return previewDenied(404)
  return {
    status: 200,
    body: request.method === "HEAD" ? null : new Uint8Array(asset.bytes),
    contentType: previewContentType(name),
  }
}

// ---------------------------------------------------------------------------
// Electron wiring (injected surfaces)
// ---------------------------------------------------------------------------

type ChatClaim = { ok: true } | { ok: false; ownerStableId: string }

export type LocalBrowserGuestPolicyDeps = {
  app: Pick<App, "on">
  protocol: Pick<Protocol, "registerSchemesAsPrivileged">
  ipcMain: Pick<IpcMain, "handle">
  sessionFromPartition: (partition: string) => Session
  /** Live app-window id for a webContents, or null. */
  windowIdForWebContents: (contents: WebContents) => number | null
  isLiveAppWindow: (windowId: number) => boolean
  claimChat: (chatId: string, windowId: number) => ChatClaim
  /** DB-registered chat worktree root; throws when not registered. */
  resolveChatWorktreeRoot: (chatId: string) => string
  platform: NodeJS.Platform
  now?: () => number
  randomToken?: (byteLength: number) => string
  exactSecretHints?: () => readonly string[]
  log?: (message: string) => void
  previewFileSystem?: PreviewFileSystem
  limits?: Partial<typeof LOCAL_BROWSER_GUEST_LIMITS>
}

type GuestRecord = {
  readonly admission: GuestAdmission
  readonly guest: WebContents
  readonly embedder: WebContents
  navigationGeneration: number
  committedCount: number
  displayUrl: string
  title: string
  closeReason: LocalBrowserGuestCloseReason | null
  confirmedCloseReported: boolean
  unconfirmedCloseReported: boolean
}

type PreparedTarget = {
  kind: LocalBrowserPreviewKind
  initialSrc: string
  displayUrl: string
  policy: GuestOriginPolicy
  fileScope: LocalBrowserFileScope | null
  binding: Omit<FilePreviewBinding, "isLive"> | null
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never

type GuestEventBody = DistributiveOmit<LocalBrowserGuestEvent, "generation">

const DENIAL_MESSAGES: Readonly<Record<LocalBrowserPreviewDenialCode, string>> =
  Object.freeze({
    "invalid-request": "The preview request was rejected.",
    "sender-not-app-window":
      "Local preview is only available from a Locus app window.",
    "chat-owned-elsewhere": "This chat is open in another window.",
    "chat-not-registered":
      "This chat has no registered project or worktree to preview.",
    "url-rejected": "Enter a localhost, loopback, or file URL.",
    "file-preview-unsupported":
      "File preview is disabled on this platform because a verified descriptor-anchored file read is unavailable. Local HTTP previews still work.",
    "file-root-unverifiable":
      "File preview is unavailable because the registered worktree could not be verified.",
    "file-not-previewable":
      "File preview needs a regular file inside the registered worktree.",
    capacity: "Too many local previews are open. Close one and try again.",
    "session-setup-failed":
      "The local preview could not be secured, so it stays disabled.",
  })

function deny(
  code: LocalBrowserPreviewDenialCode,
  message?: string,
): LocalBrowserPreviewAdmission {
  return { ok: false, code, message: message ?? DENIAL_MESSAGES[code] }
}

function defaultRandomToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  globalThis.crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString("hex")
}

function parsePreviewRequest(
  value: unknown,
  limits: typeof LOCAL_BROWSER_GUEST_LIMITS,
): { chatId: string; url: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (keys.length !== 2 || keys[0] !== "chatId" || keys[1] !== "url") {
    return null
  }
  const { chatId, url } = record
  if (
    typeof chatId !== "string" ||
    typeof url !== "string" ||
    chatId.length === 0 ||
    chatId.length > limits.maxChatIdLength ||
    url.length === 0 ||
    url.length > limits.maxUrlLength ||
    hasControlCharacter(chatId)
  ) {
    return null
  }
  return { chatId, url }
}

function parseCaptureRequest(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== 1 || keys[0] !== "generation") return null
  const generation = record.generation
  return typeof generation === "number" &&
    Number.isSafeInteger(generation) &&
    generation > 0
    ? generation
    : null
}

function isValidFileSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !/[/\\]/.test(segment) &&
    !hasControlCharacter(segment)
  )
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const TIMED_OUT: unique symbol = Symbol("timed-out")

export type LocalBrowserGuestPolicy = {
  install: () => void
  registerEmbedder: (contents: WebContents) => void
  requestPreview: (
    event: Pick<IpcMainInvokeEvent, "sender">,
    request: unknown,
  ) => Promise<LocalBrowserPreviewAdmission>
  captureDiagnostics: (
    event: Pick<IpcMainInvokeEvent, "sender">,
    request: unknown,
  ) => Promise<LocalBrowserCaptureResult>
  /** Test/inspection seam: the registry owning every admission. */
  readonly registry: LocalBrowserAdmissionRegistry
}

/**
 * Builds the guest-policy owner over injected Electron surfaces. Production
 * code installs exactly one instance through {@link installLocalBrowserGuestPolicy}.
 */
export function createLocalBrowserGuestPolicy(
  deps: LocalBrowserGuestPolicyDeps,
): LocalBrowserGuestPolicy {
  const limits = { ...LOCAL_BROWSER_GUEST_LIMITS, ...deps.limits }
  const now = deps.now ?? Date.now
  const randomToken = deps.randomToken ?? defaultRandomToken
  const log = deps.log ?? ((message: string) => console.warn(message))
  const previewFs = deps.previewFileSystem ?? STABLE_DIRECTORY_PREVIEW_FS
  const registry = new LocalBrowserAdmissionRegistry({
    now,
    randomToken: () => randomToken(32),
    ttlMs: limits.admissionTtlMs,
    maxActive: limits.maxActiveAdmissions,
    maxIssued: limits.maxIssuedPartitions,
  })
  const embedders = new Map<number, WebContents>()
  const admissionsBySession = new WeakMap<object, GuestAdmission>()
  const sessionsByAdmission = new WeakMap<GuestAdmission, Session>()
  const recordsByGuest = new WeakMap<WebContents, GuestRecord>()
  const recordsByGeneration = new Map<number, GuestRecord>()
  const provisionedGuests = new WeakSet<WebContents>()
  let installed = false

  const redact: LocalBrowserTextRedactor = (text) => {
    const result = redactUntrustedDiagnosticPayload(
      text,
      deps.exactSecretHints?.() ?? [],
    )
    return typeof result.payload === "string" ? result.payload : ""
  }

  /** Security log: reason codes and redacted origins only. */
  const securityLog = (event: string, reason: string, url?: string) => {
    const redactedOrigin = url ? shapeLocalBrowserOrigin(url, redact) : ""
    log(
      `[LocalBrowserGuest] ${event}: ${reason}${redactedOrigin ? ` (${redactedOrigin})` : ""}`,
    )
  }

  const sendToEmbedder = (
    embedder: WebContents | undefined,
    generation: number,
    body: GuestEventBody,
  ) => {
    if (!embedder || embedder.isDestroyed()) return
    const event = { ...body, generation } as LocalBrowserGuestEvent
    embedder.send(LOCAL_BROWSER_GUEST_CHANNELS.guestEvent, event)
  }

  const emit = (record: GuestRecord, body: GuestEventBody) => {
    sendToEmbedder(record.embedder, record.admission.generation, body)
  }

  const admissionForGuest = (guest: WebContents): GuestAdmission | null => {
    try {
      return admissionsBySession.get(guest.session) ?? null
    } catch {
      return null
    }
  }

  const liveRecord = (guest: WebContents): GuestRecord | null => {
    const record = recordsByGuest.get(guest)
    return record?.admission.state === "attached" ? record : null
  }

  const clearGuestSessionState = (admission: GuestAdmission) => {
    const session = sessionsByAdmission.get(admission)
    if (!session) return
    const ignore = () => {}
    try {
      session.clearStorageData().catch(ignore)
      session.clearCache().catch(ignore)
      session.clearAuthCache().catch(ignore)
    } catch {
      // Best effort only: the Session keeps its deny handlers until exit.
    }
  }

  const reportClosed = (record: GuestRecord, confirmed: boolean) => {
    if (record.confirmedCloseReported) return
    if (confirmed) {
      record.confirmedCloseReported = true
    } else {
      if (record.unconfirmedCloseReported) return
      record.unconfirmedCloseReported = true
    }
    emit(record, {
      kind: "closed",
      reason: record.closeReason ?? "guest-destroyed",
      confirmed,
    })
  }

  /**
   * Main-owned fail-closed primitive (design D5): authority is invalidated
   * first, then `close()` without `waitForBeforeUnload`, an `isDestroyed()`
   * re-check and a bounded wait for confirmation. No renderer cooperation.
   */
  const teardownGuest = (
    guest: WebContents,
    admission: GuestAdmission | null,
    reason: LocalBrowserGuestCloseReason,
  ) => {
    const record = recordsByGuest.get(guest) ?? null
    const target = admission ?? record?.admission ?? null
    if (target) {
      registry.transition(target, "teardown-begin")
      recordsByGeneration.delete(target.generation)
    }
    if (record && !record.closeReason) record.closeReason = reason
    securityLog("guest teardown", reason)
    const confirmDestroyed = () => {
      if (target) registry.transition(target, "destroy-confirmed")
      if (record) reportClosed(record, true)
    }
    if (guest.isDestroyed()) {
      confirmDestroyed()
      return
    }
    try {
      guest.close()
    } catch {
      // Destruction is re-checked below; the admission is already revoked.
    }
    if (guest.isDestroyed()) {
      confirmDestroyed()
      return
    }
    guest.once("destroyed", confirmDestroyed)
    const timer = setTimeout(() => {
      if (guest.isDestroyed()) {
        confirmDestroyed()
        return
      }
      if (target) registry.transition(target, "destroy-unconfirmed")
      securityLog("guest teardown unconfirmed", reason)
      if (record) reportClosed(record, false)
      else if (target) {
        sendToEmbedder(embedders.get(target.embedderId), target.generation, {
          kind: "closed",
          reason,
          confirmed: false,
        })
      }
    }, limits.teardownConfirmTimeoutMs)
    timer.unref?.()
  }

  const teardownAdmission = (
    admission: GuestAdmission,
    reason: LocalBrowserGuestCloseReason,
  ) => {
    const record = recordsByGeneration.get(admission.generation)
    if (record) {
      teardownGuest(record.guest, admission, reason)
      return
    }
    registry.transition(admission, "teardown-begin")
  }

  const onGuestDestroyed = (guest: WebContents) => {
    const record = recordsByGuest.get(guest)
    const admission = record?.admission ?? null
    if (!admission) return
    if (guestLifecycleHasAuthority(admission.state)) {
      registry.transition(admission, "teardown-begin")
    }
    registry.transition(admission, "destroy-confirmed")
    recordsByGeneration.delete(admission.generation)
    clearGuestSessionState(admission)
    if (record) reportClosed(record, true)
  }

  /** File admissions keep displaying the admitted user-facing file URL. */
  const displayUrlFor = (admission: GuestAdmission, url: string) =>
    admission.kind === "file"
      ? admission.displayUrl
      : shapeLocalBrowserDisplayUrl(url, redact)

  const installProbe = (record: GuestRecord) => {
    if (record.guest.isDestroyed()) return
    record.guest
      .executeJavaScript(
        LOCAL_BROWSER_DIAGNOSTIC_PROBES["click-tracker"],
        false,
      )
      .catch(() => {})
  }

  /**
   * Installs every mandatory guest WebContents handler at creation, before
   * attachment and before the first load; `did-attach-webview` verifies it.
   */
  const provisionGuest = (guest: WebContents) => {
    guest.setWindowOpenHandler(() => {
      securityLog("window open denied", "popup")
      return decideGuestWindowOpen()
    })

    const navigationVerdict = (url: string, isMainFrame: boolean) => {
      const admission = admissionForGuest(guest)
      if (!admission) {
        return { allow: false, reason: "revoked" } as GuestNavigationVerdict
      }
      return decideGuestNavigation(
        admission.policy,
        guestLifecycleHasAuthority(admission.state),
        { url, isMainFrame },
      )
    }

    const reportBlocked = (reason: GuestDenialReason, url: string) => {
      securityLog("navigation denied", reason, url)
      const record = recordsByGuest.get(guest)
      if (!record) return
      emit(record, {
        kind: "navigation-blocked",
        reason,
        target: shapeLocalBrowserOrigin(url, redact),
      })
    }

    guest.on("will-frame-navigate", (details) => {
      const verdict = navigationVerdict(details.url, details.isMainFrame)
      if (verdict.allow) return
      details.preventDefault()
      reportBlocked(verdict.reason, details.url)
    })
    guest.on("will-navigate", (details) => {
      const verdict = navigationVerdict(details.url, true)
      if (verdict.allow) return
      details.preventDefault()
      reportBlocked(verdict.reason, details.url)
    })
    guest.on("will-redirect", (details) => {
      const verdict = navigationVerdict(details.url, details.isMainFrame)
      if (verdict.allow) return
      details.preventDefault()
      reportBlocked(verdict.reason, details.url)
    })

    guest.on("did-navigate", (_event, url) => {
      const admission = admissionForGuest(guest)
      const record = recordsByGuest.get(guest)
      if (!admission) {
        teardownGuest(guest, null, "committed-url-rejected")
        return
      }
      const verdict = decideCommittedGuestUrl(admission.policy, {
        url,
        isInitialDocument: (record?.committedCount ?? 0) === 0,
        isSameDocument: false,
      })
      if (record) {
        record.committedCount += 1
        record.navigationGeneration += 1
      }
      if (!verdict.allow) {
        securityLog("committed url rejected", verdict.reason, url)
        teardownGuest(guest, admission, "committed-url-rejected")
        return
      }
      if (record) {
        record.displayUrl = displayUrlFor(admission, url)
        emit(record, { kind: "navigated", displayUrl: record.displayUrl })
      }
    })
    guest.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (!isMainFrame) return
      const admission = admissionForGuest(guest)
      const record = recordsByGuest.get(guest)
      if (!admission) {
        teardownGuest(guest, null, "committed-url-rejected")
        return
      }
      const verdict = decideCommittedGuestUrl(admission.policy, {
        url,
        isInitialDocument: false,
        isSameDocument: true,
      })
      if (!verdict.allow) {
        securityLog("committed url rejected", verdict.reason, url)
        teardownGuest(guest, admission, "committed-url-rejected")
        return
      }
      if (record) {
        record.navigationGeneration += 1
        record.displayUrl = displayUrlFor(admission, url)
        emit(record, { kind: "navigated", displayUrl: record.displayUrl })
      }
    })

    guest.on("select-bluetooth-device", (event, _devices, callback) => {
      event.preventDefault()
      callback("")
    })

    guest.on("console-message", (details) => {
      const record = liveRecord(guest)
      if (!record) return
      const message = shapeLocalBrowserConsoleMessage(
        {
          level: details.level,
          message: details.message,
          sourceId: details.sourceId,
          lineNumber: details.lineNumber,
        },
        redact,
        new Date(now()).toISOString(),
      )
      if (message) emit(record, { kind: "console", message })
    })
    const onLoadFailure = (
      errorCode: number,
      errorDescription: string,
      validatedURL: string,
      isMainFrame: boolean,
    ) => {
      const record = liveRecord(guest)
      if (!record || errorCode === -3 || !isMainFrame) return
      emit(record, {
        kind: "load-failure",
        failure: shapeLocalBrowserLoadFailure(
          { errorCode, errorDescription, validatedURL },
          redact,
          new Date(now()).toISOString(),
        ),
      })
      emit(record, { kind: "loading", loading: false })
    }
    guest.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) =>
        onLoadFailure(errorCode, errorDescription, validatedURL, isMainFrame),
    )
    guest.on(
      "did-fail-provisional-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        const admission = admissionForGuest(guest)
        if (
          admission &&
          decideGuestProvisionalLoadFailure(
            guestLifecycleHasAuthority(admission.state),
            { errorCode, isMainFrame },
          ) === "teardown"
        ) {
          securityLog(
            "committed url rejected",
            "request-gate-error-page",
            validatedURL,
          )
          teardownGuest(guest, admission, "committed-url-rejected")
          return
        }
        onLoadFailure(errorCode, errorDescription, validatedURL, isMainFrame)
      },
    )
    guest.on("page-title-updated", (_event, title) => {
      const record = liveRecord(guest)
      if (!record) return
      record.title = shapeLocalBrowserTitle(title, redact)
      emit(record, { kind: "title", title: record.title })
    })
    guest.on("did-start-loading", () => {
      const record = liveRecord(guest)
      if (record) emit(record, { kind: "loading", loading: true })
    })
    guest.on("did-stop-loading", () => {
      const record = liveRecord(guest)
      if (!record) return
      emit(record, { kind: "loading", loading: false })
      installProbe(record)
    })
    guest.on("dom-ready", () => {
      const record = liveRecord(guest)
      if (record) installProbe(record)
    })
    guest.once("destroyed", () => onGuestDestroyed(guest))
    provisionedGuests.add(guest)
  }

  const onWillAttach = (
    embedder: WebContents,
    event: { preventDefault: () => void },
    webPreferences: WebPreferences,
    params: Record<string, unknown>,
  ) => {
    registry.sweepExpired()
    if (!embedders.has(embedder.id)) {
      event.preventDefault()
      securityLog("attach denied", "unregistered-embedder")
      return
    }
    const verdict = registry.beginAttach({
      embedderId: embedder.id,
      partition: params.partition,
      src: params.src,
    })
    if (!verdict.ok) {
      event.preventDefault()
      securityLog("attach denied", verdict.reason)
      if (verdict.admission && verdict.admission.embedderId === embedder.id) {
        sendToEmbedder(embedder, verdict.admission.generation, {
          kind: "closed",
          reason: "attach-rejected",
          confirmed: true,
        })
      }
      return
    }
    const unsafe = unsafeWebviewAttributes(params)
    if (unsafe.length > 0) {
      event.preventDefault()
      registry.transition(verdict.admission, "revoke")
      securityLog("attach denied", "unsafe-attributes")
      sendToEmbedder(embedder, verdict.admission.generation, {
        kind: "closed",
        reason: "preferences-rejected",
        confirmed: true,
      })
      return
    }
    const overridden = enforceGuestWebPreferences(
      webPreferences,
      verdict.admission.partition,
    )
    if (overridden.length > 0) {
      securityLog("guest preferences forced", overridden.sort().join(","))
    }
    params.src = verdict.admission.initialSrc
  }

  const onDidAttach = (embedder: WebContents, guest: WebContents) => {
    const admission = admissionForGuest(guest)
    if (
      !admission ||
      !embedders.has(embedder.id) ||
      !registry.completeAttach(admission, embedder.id, guest.id)
    ) {
      teardownGuest(guest, admission, "attach-rejected")
      return
    }
    const record: GuestRecord = {
      admission,
      guest,
      embedder,
      navigationGeneration: 0,
      committedCount: 0,
      displayUrl: admission.displayUrl,
      title: "",
      closeReason: null,
      confirmedCloseReported: false,
      unconfirmedCloseReported: false,
    }
    recordsByGuest.set(guest, record)
    recordsByGeneration.set(admission.generation, record)
    if (!provisionedGuests.has(guest)) {
      teardownGuest(guest, admission, "handler-missing")
      return
    }
    const effective = (
      guest as unknown as {
        getLastWebPreferences?: () => Record<string, unknown> | null
      }
    ).getLastWebPreferences
    if (
      typeof effective === "function" &&
      !guestPreferencesAreSecure(effective.call(guest))
    ) {
      teardownGuest(guest, admission, "preferences-rejected")
      return
    }
    emit(record, { kind: "attached" })
  }

  /**
   * Pre-return Session configuration (design D7/D8): zero registered
   * preloads, the sole `<all_urls>` request gate, every Session-scoped deny
   * handler and, for file admissions only, the preview protocol handler.
   * Any failure aborts the admission before the partition leaves main.
   */
  const configureGuestSession = (
    session: Session,
    admission: GuestAdmission,
    binding: FilePreviewBinding | null,
  ) => {
    if (session.getPreloadScripts().length > 0) {
      throw new Error("Guest session has registered preload scripts")
    }
    const reported = new Set<string>()
    session.webRequest.onBeforeRequest(
      { urls: ["<all_urls>"] },
      (details, callback) => {
        const verdict = decideGuestRequest(
          admission.policy,
          guestLifecycleHasAuthority(admission.state),
          { url: details.url, resourceType: details.resourceType },
        )
        if (!verdict.cancel) {
          callback({})
          return
        }
        const key = `${verdict.reason}:${minimizeLocalBrowserOrigin(details.url)}`
        if (!reported.has(key) && reported.size < 64) {
          reported.add(key)
          securityLog("request cancelled", verdict.reason, details.url)
        }
        callback({ cancel: true })
      },
    )
    session.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(decideGuestPermission(permission))
    })
    session.setPermissionCheckHandler((_contents, permission) =>
      decideGuestPermission(permission),
    )
    session.setDevicePermissionHandler(() => false)
    session.setDisplayMediaRequestHandler(
      (_request, callback) => {
        callback({})
      },
      { useSystemPicker: false },
    )
    session.on("select-hid-device", (event, _details, callback) => {
      event.preventDefault()
      callback()
    })
    session.on("select-serial-port", (event, _ports, _contents, callback) => {
      event.preventDefault()
      callback("")
    })
    session.on("select-usb-device", (event, _details, callback) => {
      event.preventDefault()
      callback()
    })
    session.on("will-download", (event, item) => {
      event.preventDefault()
      securityLog("download cancelled", "download")
      try {
        item.cancel()
      } catch {
        // The prevented download never starts writing.
      }
    })
    if (binding) {
      session.protocol.handle(LOCUS_PREVIEW_SCHEME, (request) => {
        const result = serveLocusPreviewRequest(
          binding,
          { url: request.url, method: request.method },
          previewFs,
        )
        const headers: Record<string, string> = {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        }
        if (result.contentType) headers["Content-Type"] = result.contentType
        return new Response(result.body, { status: result.status, headers })
      })
    }
  }

  const prepareFileTarget = (
    root: string,
    fileUrl: string,
  ): PreparedTarget | LocalBrowserPreviewAdmission => {
    if (deps.platform === "win32") return deny("file-preview-unsupported")
    const filePath = localBrowserFileUrlPath(fileUrl)
    const normalizedRoot = normalizeLocalBrowserRootPath(root)
    const prefix = normalizedRoot.endsWith("/")
      ? normalizedRoot
      : `${normalizedRoot}/`
    if (!filePath?.startsWith(prefix)) {
      return deny("file-not-previewable")
    }
    const segments = filePath.slice(prefix.length).split("/")
    if (segments.length === 0 || !segments.every(isValidFileSegment)) {
      return deny("file-not-previewable")
    }
    const documentName = segments.at(-1) ?? ""
    const scopeSegments = segments.slice(0, -1)
    const handles: StableDirectoryHandle[] = []
    let canonicalRoot: StableDirectoryHandle
    try {
      canonicalRoot = previewFs.openRegisteredRoot(root, "Preview root")
      handles.push(canonicalRoot)
    } catch {
      for (const handle of handles) previewFs.close(handle)
      return deny("file-root-unverifiable")
    }
    try {
      let directory = canonicalRoot
      for (const segment of scopeSegments) {
        directory = previewFs.openChild(directory, segment, "Preview directory")
        handles.push(directory)
      }
      previewFs.readFile(directory, documentName, "Preview document", {
        maxBytes: limits.maxPreviewFileBytes,
      })
    } catch {
      return deny("file-not-previewable")
    } finally {
      for (const handle of handles.reverse()) previewFs.close(handle)
    }
    const host = `${randomToken(16)}${LOCUS_PREVIEW_HOST_SUFFIX}`
    const encodedDocument = encodeURIComponent(documentName)
    return {
      kind: "file",
      initialSrc: `${LOCUS_PREVIEW_SCHEME}://${host}/${encodedDocument}`,
      displayUrl: shapeLocalBrowserDisplayUrl(fileUrl, redact),
      policy: { kind: "file", host, documentSegments: [documentName] },
      fileScope: {
        relativeDirectory: scopeSegments.join("/"),
        isWorktreeRoot: scopeSegments.length === 0,
      },
      binding: {
        host,
        registeredRoot: root,
        canonicalRoot: canonicalRoot.path,
        rootDev: canonicalRoot.dev,
        rootIno: canonicalRoot.ino,
        scopeSegments,
      },
    }
  }

  const requestPreview: LocalBrowserGuestPolicy["requestPreview"] = async (
    event,
    request,
  ) => {
    const parsed = parsePreviewRequest(request, limits)
    if (!parsed) return deny("invalid-request")
    const sender = event.sender
    if (!embedders.has(sender.id) || sender.isDestroyed()) {
      return deny("sender-not-app-window")
    }
    const windowId = deps.windowIdForWebContents(sender)
    if (windowId === null || !deps.isLiveAppWindow(windowId)) {
      return deny("sender-not-app-window")
    }
    const claim = deps.claimChat(parsed.chatId, windowId)
    if (!claim.ok) return deny("chat-owned-elsewhere")
    let root: string
    try {
      root = deps.resolveChatWorktreeRoot(parsed.chatId)
    } catch {
      return deny("chat-not-registered")
    }
    const normalized = normalizeLocalBrowserUrl(parsed.url, {
      allowedFileRoots: [root],
    })
    if (!normalized.ok) return deny("url-rejected", normalized.message)

    let target: PreparedTarget
    if (normalized.protocol === "file:") {
      const prepared = prepareFileTarget(root, normalized.url)
      if ("ok" in prepared) return prepared
      target = prepared
    } else {
      target = {
        kind: "http",
        initialSrc: normalized.url,
        displayUrl: shapeLocalBrowserDisplayUrl(normalized.url, redact),
        policy: { kind: "http", origin: new URL(normalized.url).origin },
        fileScope: null,
        binding: null,
      }
    }

    const issued = registry.issue({
      embedderId: sender.id,
      chatId: parsed.chatId,
      initialSrc: target.initialSrc,
      displayUrl: target.displayUrl,
      kind: target.kind,
      policy: target.policy,
      fileScope: target.fileScope,
    })
    for (const superseded of issued.superseded) {
      teardownAdmission(superseded, "superseded")
    }
    if (!issued.ok) return deny("capacity")
    const { admission } = issued
    const binding: FilePreviewBinding | null = target.binding
      ? {
          ...target.binding,
          isLive: () => guestLifecycleHasAuthority(admission.state),
        }
      : null
    try {
      const session = deps.sessionFromPartition(admission.partition)
      configureGuestSession(session, admission, binding)
      admissionsBySession.set(session, admission)
      sessionsByAdmission.set(admission, session)
    } catch {
      registry.transition(admission, "revoke")
      securityLog("admission aborted", "session-setup-failed")
      return deny("session-setup-failed")
    }
    return {
      ok: true,
      generation: admission.generation,
      partition: admission.partition,
      src: admission.initialSrc,
      displayUrl: admission.displayUrl,
      kind: admission.kind,
      fileScope: admission.fileScope,
    }
  }

  const captureScreenshot = async (
    record: GuestRecord,
    isCurrent: () => boolean,
  ): Promise<LocalBrowserScreenshotProjection | null | "stale"> => {
    if (!isCurrent()) return "stale"
    let image: NativeImage | typeof TIMED_OUT
    try {
      image = await withTimeout(
        record.guest.capturePage(),
        limits.probeTimeoutMs,
      )
    } catch {
      return null
    }
    if (!isCurrent()) return "stale"
    if (image === TIMED_OUT || image.isEmpty()) return null
    const size = image.getSize()
    const png = image.toPNG()
    if (
      !isAcceptableLocalBrowserScreenshot({
        mimeType: LOCAL_BROWSER_SCREENSHOT_LIMITS.mimeType,
        width: size.width,
        height: size.height,
        byteLength: png.length,
      })
    ) {
      return null
    }
    return {
      dataUrl: `data:${LOCAL_BROWSER_SCREENSHOT_LIMITS.mimeType};base64,${png.toString("base64")}`,
      width: size.width,
      height: size.height,
    }
  }

  const runProbe = async (
    record: GuestRecord,
    probe: LocalBrowserDiagnosticProbe,
  ): Promise<unknown> => {
    try {
      const result = await withTimeout(
        record.guest.executeJavaScript(
          LOCAL_BROWSER_DIAGNOSTIC_PROBES[probe],
          false,
        ) as Promise<unknown>,
        limits.probeTimeoutMs,
      )
      return result === TIMED_OUT ? null : result
    } catch {
      return null
    }
  }

  const captureDiagnostics: LocalBrowserGuestPolicy["captureDiagnostics"] =
    async (event, request) => {
      const generation = parseCaptureRequest(request)
      if (generation === null) return { ok: false, code: "invalid-request" }
      const record = recordsByGeneration.get(generation)
      if (
        !record ||
        record.embedder.id !== event.sender.id ||
        record.admission.state !== "attached" ||
        record.guest.isDestroyed()
      ) {
        return { ok: false, code: "no-guest" }
      }
      const navigationGeneration = record.navigationGeneration
      const isCurrent = () =>
        record.admission.state === "attached" &&
        !record.guest.isDestroyed() &&
        recordsByGeneration.get(generation) === record &&
        record.navigationGeneration === navigationGeneration

      const screenshot = await captureScreenshot(record, isCurrent)
      if (screenshot === "stale" || !isCurrent()) {
        return { ok: false, code: "stale" }
      }
      const rawSummary = await runProbe(record, "dom-summary")
      if (!isCurrent()) return { ok: false, code: "stale" }
      const rawSelection = await runProbe(record, "last-selection")
      if (!isCurrent()) return { ok: false, code: "stale" }

      const domSummary = shapeLocalBrowserDomSummary(rawSummary, redact)
      return {
        ok: true,
        generation,
        displayUrl: record.displayUrl,
        title: domSummary?.title || record.title,
        domSummary,
        selectedElement: shapeLocalBrowserSelectedElement(rawSelection, redact),
        screenshot,
      }
    }

  const registerEmbedder = (contents: WebContents) => {
    if (embedders.has(contents.id)) return
    embedders.set(contents.id, contents)
    contents.once("destroyed", () => {
      embedders.delete(contents.id)
      for (const admission of registry.forEmbedder(contents.id)) {
        if (guestLifecycleHasAuthority(admission.state)) {
          teardownAdmission(admission, "embedder-closed")
        }
      }
    })
  }

  const install = () => {
    if (installed) return
    installed = true
    deps.protocol.registerSchemesAsPrivileged([
      {
        scheme: LOCUS_PREVIEW_SCHEME,
        privileges: { ...LOCUS_PREVIEW_PRIVILEGES },
      },
    ])
    deps.app.on("web-contents-created", (_event, contents) => {
      contents.on("will-attach-webview", (event, webPreferences, params) => {
        onWillAttach(contents, event, webPreferences, params)
      })
      contents.on("did-attach-webview", (_attachEvent, guest) => {
        onDidAttach(contents, guest)
      })
      if (contents.getType() === "webview") provisionGuest(contents)
    })
    deps.ipcMain.handle(
      LOCAL_BROWSER_GUEST_CHANNELS.requestPreview,
      (event, request) => requestPreview(event, request),
    )
    deps.ipcMain.handle(
      LOCAL_BROWSER_GUEST_CHANNELS.captureDiagnostics,
      (event, request) => captureDiagnostics(event, request),
    )
  }

  return {
    install,
    registerEmbedder,
    requestPreview,
    captureDiagnostics,
    registry,
  }
}

let installedPolicy: LocalBrowserGuestPolicy | null = null

/**
 * Installs the process-wide guest-policy owner. Must run before app
 * readiness (scheme privileges) and before any webContents is created.
 */
export function installLocalBrowserGuestPolicy(
  deps: LocalBrowserGuestPolicyDeps,
): LocalBrowserGuestPolicy {
  if (installedPolicy) return installedPolicy
  const policy = createLocalBrowserGuestPolicy(deps)
  policy.install()
  installedPolicy = policy
  return policy
}

/**
 * Registers a privileged app window as a permitted embedder. Called by
 * `main.ts` before the window loads its app document; an unregistered
 * embedder can never attach a guest.
 */
export function registerLocalBrowserGuestEmbedder(contents: WebContents): void {
  if (!installedPolicy) {
    throw new Error(
      "The Local Browser guest policy must be installed before app windows are created",
    )
  }
  installedPolicy.registerEmbedder(contents)
}
