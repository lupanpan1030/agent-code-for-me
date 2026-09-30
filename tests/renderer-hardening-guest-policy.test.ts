/**
 * Test-first suite for `openspec/changes/add-renderer-untrusted-content-hardening`
 * — DOMAIN C: the main-owned local-browser guest boundary (design D5–D9,
 * Security Invariants 4–7; runtime-security-baseline ADDED Requirement
 * "Local Browser Webview Guests Stay Outside Privileged App Bridges";
 * local-browser-workbench MODIFIED Requirements "Local Preview Boundary" and
 * "Browser Diagnostics Capture").
 *
 * Written by an independent test author from the OpenSpec package only. The
 * package names module PATHS for the new owners
 * (`src/main/windows/local-browser-guest-policy.ts`,
 * `src/shared/local-browser-diagnostics-policy.ts`, installed by
 * `src/main/windows/main.ts`) but does not name any exported identifier for the
 * "pure, injectable decision functions" of task 3.1. This suite therefore:
 *
 * - drives the existing observable renderer entry point
 *   (`LocalBrowserWorkbench` rendered into happy-dom) with page-controlled
 *   `<webview>` event payloads from
 *   `tests/fixtures/renderer-hardening/guest-diagnostics-secrets.json`;
 * - asserts the renderer removal list (Invariant 7, D6, D9, tasks 3.4/4.1/4.7/
 *   6.3) as source guards over `src/renderer`;
 * - asserts the named owner modules exist, load in `bun test` and keep the
 *   import-direction rules the design states;
 * - asserts, as static checks only, that the Electron hooks D5/D7/D8 assign
 *   to the single owner are wired there and nowhere else; and
 * - keeps characterization guards (GREEN on the baseline by design) for the
 *   pieces the design reuses unchanged: `windowManager.claimChat` ownership
 *   states, the shared local URL grammar's remote-host rejection, and the
 *   canonical `redaction.ts` owner recognising this suite's secret fixtures.
 *
 * No test here claims a runtime Electron observation (real webRequest
 * interception, attach ordering, prompts, downloads, destruction); those are
 * GUI tracks 5.2/5.3 by design D10.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { Window } from "happy-dom"

const repoRoot = resolve(import.meta.dir, "..")
const fixture = JSON.parse(
  readFileSync(
    join(
      import.meta.dir,
      "fixtures/renderer-hardening/guest-diagnostics-secrets.json",
    ),
    "utf8",
  ),
) as {
  secrets: Record<string, string>
  events: Record<string, Record<string, unknown>>
}
const SECRET_VALUES = Object.values(fixture.secrets)

const GUEST_POLICY_OWNER = "src/main/windows/local-browser-guest-policy.ts"
const DIAGNOSTICS_POLICY = "src/shared/local-browser-diagnostics-policy.ts"
const MAIN_WINDOW = "src/main/windows/main.ts"
const WORKBENCH = "src/renderer/features/agents/ui/local-browser-workbench.tsx"

// ---------------------------------------------------------------------------
// Electron double (existing repository pattern). Only window-manager needs it;
// the guest-policy owner is required to load without any Electron runtime.
// ---------------------------------------------------------------------------
mock.module("electron", () => ({
  BrowserWindow: Object.assign(function BrowserWindow() {}, {
    getFocusedWindow: () => null,
  }),
  ipcMain: { handle() {}, on() {}, removeHandler() {} },
}))
mock.module("../src/main/lib/git/watcher/ipc-bridge", () => ({
  cleanupWindowSubscriptions() {},
  registerGitWatcherIPC() {},
}))

// ---------------------------------------------------------------------------
// happy-dom renderer environment
// ---------------------------------------------------------------------------
const testWindow = new Window({ url: "http://localhost/" })
Object.assign(globalThis, {
  window: testWindow,
  document: testWindow.document,
  navigator: testWindow.navigator,
  localStorage: testWindow.localStorage,
  sessionStorage: testWindow.sessionStorage,
  location: testWindow.location,
  Node: testWindow.Node,
  Element: testWindow.Element,
  HTMLElement: testWindow.HTMLElement,
  HTMLInputElement: testWindow.HTMLInputElement,
  HTMLTextAreaElement: testWindow.HTMLTextAreaElement,
  SVGElement: testWindow.SVGElement,
  Event: testWindow.Event,
  MutationObserver: testWindow.MutationObserver,
  getComputedStyle: testWindow.getComputedStyle.bind(testWindow),
  requestAnimationFrame: (cb: (t: number) => void) =>
    setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
})
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const { act, createElement } = await import("react")
const { createRoot } = await import("react-dom/client")
const { I18nProvider } = await import("../src/renderer/lib/i18n")
const { LocalBrowserWorkbench } = await import(
  "../src/renderer/features/agents/ui/local-browser-workbench"
)

type MountedWorkbench = {
  root: ReturnType<typeof createRoot>
  container: HTMLElement
  insertedReports: string[]
}

let mounted: MountedWorkbench | null = null

afterEach(async () => {
  const current = mounted
  mounted = null
  if (current) {
    await act(async () => current.root.unmount())
  }
  testWindow.document.body.replaceChildren()
})

async function mountWorkbench(input: {
  chatId: string
  worktreePath: string
}): Promise<MountedWorkbench> {
  const container = testWindow.document.createElement("div")
  testWindow.document.body.appendChild(container)
  const root = createRoot(container as unknown as Element)
  const insertedReports: string[] = []
  await act(async () => {
    root.render(
      createElement(
        I18nProvider,
        null,
        createElement(LocalBrowserWorkbench, {
          chatId: input.chatId,
          worktreePath: input.worktreePath,
          onClose: () => {},
          onInsertReport: (report: string) => insertedReports.push(report),
        }),
      ),
    )
  })
  mounted = {
    root,
    container: container as unknown as HTMLElement,
    insertedReports,
  }
  return mounted
}

function urlInput(): HTMLInputElement {
  const input = testWindow.document.querySelector(
    '[data-testid="local-browser-url-input"]',
  )
  expect(input).not.toBeNull()
  return input as unknown as HTMLInputElement
}

/** Types into the controlled URL input and submits the form (user-entered URL). */
async function submitUserUrl(value: string): Promise<void> {
  const input = urlInput()
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      testWindow.HTMLInputElement.prototype,
      "value",
    )?.set
    setter?.call(input, value)
    input.dispatchEvent(new testWindow.Event("input", { bubbles: true }))
  })
  expect(input.value).toBe(value)
  await act(async () => {
    const form = input.closest("form")
    expect(form).not.toBeNull()
    form?.dispatchEvent(
      new testWindow.Event("submit", { bubbles: true, cancelable: true }),
    )
  })
}

function webviews(): Element[] {
  return Array.from(
    testWindow.document.querySelectorAll("webview"),
  ) as unknown as Element[]
}

/**
 * Dispatches a raw Electron `<webview>` DOM event carrying page-controlled data
 * on every mounted webview element. Electron's element dispatch itself is not
 * claimed suppressed (Invariant 7); the assertion is on app state.
 */
async function dispatchRawGuestEvent(
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  for (const element of webviews()) {
    await act(async () => {
      const event = new testWindow.Event(type, { cancelable: true })
      Object.assign(event, payload)
      element.dispatchEvent(event as unknown as Event)
    })
  }
  await act(async () => {
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 5))
  })
}

/** All app-visible renderer state reachable from the DOM: text, attributes, input values. */
function renderedAppState(): string {
  const body = testWindow.document.body
  const parts: string[] = [body.textContent ?? "", body.innerHTML]
  for (const field of Array.from(
    testWindow.document.querySelectorAll("input, textarea"),
  ) as unknown as HTMLInputElement[]) {
    parts.push(field.value)
  }
  return parts.join("\n")
}

function leakedSecrets(haystack: string): string[] {
  return SECRET_VALUES.filter((secret) => haystack.includes(secret))
}

// ---------------------------------------------------------------------------
// Source-scan helpers (static guards)
// ---------------------------------------------------------------------------
const SOURCE_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/

function walkSources(relativeDir: string): string[] {
  const absolute = join(repoRoot, relativeDir)
  const files: string[] = []
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const info = statSync(full)
      if (info.isDirectory()) {
        if (entry === "node_modules") continue
        visit(full)
      } else if (SOURCE_EXTENSIONS.test(entry)) {
        files.push(relative(repoRoot, full))
      }
    }
  }
  visit(absolute)
  return files.sort()
}

function readSource(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8")
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1")
}

function filesMatching(relativeDir: string, pattern: RegExp): string[] {
  return walkSources(relativeDir).filter((file) =>
    pattern.test(stripComments(readSource(file))),
  )
}

function countMatches(relativeDir: string, pattern: RegExp): number {
  let count = 0
  for (const file of walkSources(relativeDir)) {
    const matches = stripComments(readSource(file)).match(
      new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`),
    )
    count += matches?.length ?? 0
  }
  return count
}

function ownerSource(): string {
  expect(existsSync(join(repoRoot, GUEST_POLICY_OWNER))).toBe(true)
  return stripComments(readSource(GUEST_POLICY_OWNER))
}

// Page-controlled Electron <webview> events (design D9 / Invariant 7 / task 4.7).
const PAGE_CONTROLLED_WEBVIEW_EVENTS = [
  "will-navigate",
  "will-frame-navigate",
  "did-start-navigation",
  "did-redirect-navigation",
  "did-navigate",
  "did-frame-navigate",
  "did-navigate-in-page",
  "load-commit",
  "did-fail-load",
  "did-fail-provisional-load",
  "page-title-updated",
  "page-favicon-updated",
  "console-message",
  "update-target-url",
  "found-in-page",
  "context-menu",
  "ipc-message",
] as const

// ===========================================================================
describe("Invariant 7 / D9 — page-controlled <webview> event payloads never reach app renderer state", () => {
  test("raw console-message payload (bearer JWT, provider key, api_key, source URL query/fragment) does not enter workbench state", async () => {
    await mountWorkbench({
      chatId: "chat-diag-console",
      worktreePath: "/tmp/locus-guest-wt",
    })
    await submitUserUrl("http://localhost:3000/")
    await dispatchRawGuestEvent(
      "console-message",
      fixture.events.consoleMessage as Record<string, unknown>,
    )
    expect(leakedSecrets(renderedAppState())).toEqual([])
  })

  test("raw did-fail-load / did-fail-provisional-load payload (OAuth code/state/nonce, fragment) does not enter workbench state", async () => {
    await mountWorkbench({
      chatId: "chat-diag-failure",
      worktreePath: "/tmp/locus-guest-wt",
    })
    await submitUserUrl("http://localhost:3000/")
    await dispatchRawGuestEvent(
      "did-fail-load",
      fixture.events.didFailLoad as Record<string, unknown>,
    )
    await dispatchRawGuestEvent(
      "did-fail-provisional-load",
      fixture.events.didFailLoad as Record<string, unknown>,
    )
    expect(leakedSecrets(renderedAppState())).toEqual([])
  })

  test("raw page-title-updated payload does not enter workbench state", async () => {
    await mountWorkbench({
      chatId: "chat-diag-title",
      worktreePath: "/tmp/locus-guest-wt",
    })
    await submitUserUrl("http://localhost:3000/")
    await dispatchRawGuestEvent(
      "page-title-updated",
      fixture.events.pageTitleUpdated as Record<string, unknown>,
    )
    expect(leakedSecrets(renderedAppState())).toEqual([])
  })

  test("raw will-navigate / did-navigate / did-navigate-in-page URLs (credentials, query, fragment) do not enter the URL input, error or failure state", async () => {
    await mountWorkbench({
      chatId: "chat-diag-navigate",
      worktreePath: "/tmp/locus-guest-wt",
    })
    await submitUserUrl("http://localhost:3000/")
    await dispatchRawGuestEvent(
      "will-navigate",
      fixture.events.willNavigateSameOrigin as Record<string, unknown>,
    )
    await dispatchRawGuestEvent(
      "did-navigate",
      fixture.events.didNavigateSameOrigin as Record<string, unknown>,
    )
    await dispatchRawGuestEvent(
      "did-navigate-in-page",
      fixture.events.didNavigateInPage as Record<string, unknown>,
    )
    expect(leakedSecrets(renderedAppState())).toEqual([])
  })

  test("the explicit insert-report action never copies raw page values into chat text", async () => {
    const workbench = await mountWorkbench({
      chatId: "chat-diag-insert",
      worktreePath: "/tmp/locus-guest-wt",
    })
    await submitUserUrl("http://localhost:3000/")
    await dispatchRawGuestEvent(
      "console-message",
      fixture.events.consoleMessage as Record<string, unknown>,
    )
    await dispatchRawGuestEvent(
      "did-fail-load",
      fixture.events.didFailLoad as Record<string, unknown>,
    )
    await dispatchRawGuestEvent(
      "page-title-updated",
      fixture.events.pageTitleUpdated as Record<string, unknown>,
    )
    const insertButton = testWindow.document.querySelector(
      '[data-testid="local-browser-insert-report-button"]',
    ) as unknown as HTMLButtonElement | null
    expect(insertButton).not.toBeNull()
    await act(async () => {
      insertButton?.dispatchEvent(
        new testWindow.MouseEvent("click", {
          bubbles: true,
        }) as unknown as Event,
      )
    })
    await act(async () => {
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 10))
    })
    expect(leakedSecrets(workbench.insertedReports.join("\n"))).toEqual([])
  })
})

// ===========================================================================
describe("D6 / Local Preview Boundary — partition authority, remount and file loading are not renderer-owned", () => {
  test("the rendered <webview> never carries a renderer-derived, chat-named or persist: partition", async () => {
    const chatId = "chatpartitionA1"
    await mountWorkbench({ chatId, worktreePath: "/tmp/locus-guest-wt" })
    await submitUserUrl("http://localhost:3000/")
    const partitions = webviews().map(
      (element) => element.getAttribute("partition") ?? "",
    )
    const renderedPartitionDerivedFromChat = partitions.filter(
      (partition) =>
        partition.includes(chatId) ||
        partition.startsWith("persist:") ||
        partition === "local-browser-default",
    )
    expect(renderedPartitionDerivedFromChat).toEqual([])
  })

  test('"User deliberately opens another local origin": allowed same-origin guest navigation keeps one guest element (no URL-keyed remount)', async () => {
    await mountWorkbench({
      chatId: "chat-remount",
      worktreePath: "/tmp/locus-guest-wt",
    })
    await submitUserUrl("http://localhost:3000/")
    const before = webviews()
    await dispatchRawGuestEvent("did-navigate", {
      url: "http://localhost:3000/second-page",
    })
    const after = webviews()
    expect(after.length).toBe(before.length)
    expect(after.every((element, index) => element === before[index])).toBe(
      true,
    )
  })

  test('"User opens a localhost page" with an allowed file:// URL never hands a direct file: URL to the guest', async () => {
    const worktreePath = "/tmp/locus-guest-file-wt"
    await mountWorkbench({ chatId: "chat-file-direct", worktreePath })
    await submitUserUrl(`file://${worktreePath}/index.html`)
    const directFileSources = webviews()
      .map((element) => element.getAttribute("src") ?? "")
      .filter((src) => src.toLowerCase().startsWith("file:"))
    expect(directFileSources).toEqual([])
  })

  test("renderer <webview> carries no preload / webpreferences / nodeintegration / allowpopups / disablewebsecurity attribute (green-by-design guard)", async () => {
    await mountWorkbench({
      chatId: "chat-attrs",
      worktreePath: "/tmp/locus-guest-wt",
    })
    await submitUserUrl("http://localhost:3000/")
    const forbidden = [
      "preload",
      "webpreferences",
      "nodeintegration",
      "nodeintegrationinsubframes",
      "allowpopups",
      "disablewebsecurity",
      "plugins",
    ]
    const present = webviews().flatMap((element) =>
      forbidden.filter((attribute) => element.hasAttribute(attribute)),
    )
    expect(present).toEqual([])
    const source = stripComments(readSource(WORKBENCH))
    expect(
      /<webview[^>]*\b(?:preload|webpreferences|nodeintegration|allowpopups|disablewebsecurity)\b/is.test(
        source,
      ),
    ).toBe(false)
  })

  test('"User enters a remote URL": the workbench blocks navigation and shows a local-only reason (green-by-design guard)', async () => {
    await mountWorkbench({
      chatId: "chat-remote",
      worktreePath: "/tmp/locus-guest-wt",
    })
    await submitUserUrl("https://example.com/")
    expect(webviews()).toEqual([])
    // The displayed reason comes from the single shared local URL grammar (D7).
    const { normalizeLocalBrowserUrl } = await import(
      "../src/shared/local-browser-workbench"
    )
    const verdict = normalizeLocalBrowserUrl("https://example.com/", {
      allowedFileRoots: ["/tmp/locus-guest-wt"],
    })
    expect(verdict.ok).toBe(false)
    expect(testWindow.document.body.textContent ?? "").toContain(
      (verdict as { message: string }).message,
    )
  })
})

// ===========================================================================
describe("Renderer removal list (Invariant 7, D6, D7, D9; tasks 3.4, 4.1, 4.7, 6.3) — source guards over src/renderer", () => {
  test("no renderer listener subscribes to a raw <webview> event carrying page-controlled URL, title or text", () => {
    const offenders: string[] = []
    for (const file of walkSources("src/renderer")) {
      const source = stripComments(readSource(file))
      for (const eventName of PAGE_CONTROLLED_WEBVIEW_EVENTS) {
        const listener = new RegExp(
          `addEventListener\\(\\s*["'\`]${eventName}["'\`]`,
        )
        if (listener.test(source)) offenders.push(`${file}: ${eventName}`)
      }
    }
    expect(offenders).toEqual([])
  })

  test("the renderer retains no <webview>.loadURL escape hatch (rollback or navigation)", () => {
    expect(
      filesMatching("src/renderer", /\.loadURL\b|\bloadURL\s*\?\s*:/),
    ).toEqual([])
  })

  test("the renderer retains no webview.capturePage() fallback (bounded capture belongs to main)", () => {
    expect(filesMatching("src/renderer", /\bcapturePage\b/)).toEqual([])
  })

  test("the renderer cannot execute diagnostic JavaScript strings in the guest (closed probe set runs in main with userGesture:false)", () => {
    expect(filesMatching("src/renderer", /\bexecuteJavaScript\b/)).toEqual([])
  })

  test("the inline selection probe is moved into the shared named script set", () => {
    expect(
      filesMatching("src/renderer", /__LOCUS_LAST_CLICKED_ELEMENT__/),
    ).toEqual([])
  })

  test("no <webview> is keyed by its URL and no renderer code derives a local-browser partition from the chat id", () => {
    const source = stripComments(readSource(WORKBENCH))
    expect(/<webview[^>]*\bkey=\{\s*currentUrl\s*\}/s.test(source)).toBe(false)
    expect(filesMatching("src/renderer", /`local-browser-\$\{/)).toEqual([])
  })
})

// ===========================================================================
describe("D5 / task 3.1 — one main-process guest-policy owner (src/main/windows/local-browser-guest-policy.ts)", () => {
  test("the owner module exists and loads under bun test, exporting its decision functions", async () => {
    const owner = (await import(`../${GUEST_POLICY_OWNER}`)) as Record<
      string,
      unknown
    >
    const exportedFunctions = Object.values(owner).filter(
      (value) => typeof value === "function",
    )
    expect(exportedFunctions.length).toBeGreaterThan(0)
  })

  test("the owner imports Electron only as types (injected factories/surfaces; no runtime Electron import side effect)", () => {
    const source = ownerSource()
    const electronImports = [
      ...source.matchAll(
        /import\s+([^;]*?)\s+from\s+["']electron(?:\/[^"']*)?["']/g,
      ),
    ].map((match) => (match[1] as string).trim())
    const runtimeElectronImports = electronImports.filter(
      (clause) =>
        !clause.startsWith("type ") &&
        !/^\{\s*(?:type\s+[\w$]+\s*,?\s*)+\}$/.test(clause),
    )
    expect(runtimeElectronImports).toEqual([])
    expect(/require\(\s*["']electron["']\s*\)/.test(source)).toBe(false)
  })

  test("main.ts installs the owner (proposal Canonical Owners: installed by src/main/windows/main.ts)", () => {
    const source = stripComments(readSource(MAIN_WINDOW))
    expect(/from\s+["']\.\/local-browser-guest-policy["']/.test(source)).toBe(
      true,
    )
  })

  test('"Renderer attempts an unsafe or unregistered guest attachment": exactly one app web-contents-created hook guards every potential embedder', () => {
    expect(countMatches("src/main", /["'`]web-contents-created["'`]/)).toBe(1)
  })

  test("will-attach-webview / did-attach-webview are handled only by the owner (no copy of guest policy in main.ts or elsewhere)", () => {
    const attachFiles = filesMatching(
      "src/main",
      /["'`](?:will|did)-attach-webview["'`]/,
    )
    expect(attachFiles).toEqual([GUEST_POLICY_OWNER])
    const source = ownerSource()
    expect(/["'`]will-attach-webview["'`]/.test(source)).toBe(true)
    expect(/["'`]did-attach-webview["'`]/.test(source)).toBe(true)
  })

  test("D7 Session request gate and guest navigation handlers are wired by the owner (onBeforeRequest, will-navigate, will-frame-navigate, will-redirect, setWindowOpenHandler)", () => {
    const source = ownerSource()
    const required = [
      /\.onBeforeRequest\s*\(/,
      /["'`]will-navigate["'`]/,
      /["'`]will-frame-navigate["'`]/,
      /["'`]will-redirect["'`]/,
      /\.setWindowOpenHandler\s*\(/,
    ]
    expect(
      required.filter((pattern) => !pattern.test(source)).map(String),
    ).toEqual([])
  })

  test("D8 Session deny handlers are wired by the owner (permission check/request, device, display media, HID/serial/USB/Bluetooth selectors, will-download)", () => {
    const source = ownerSource()
    const required = [
      /\.setPermissionCheckHandler\s*\(/,
      /\.setPermissionRequestHandler\s*\(/,
      /\.setDevicePermissionHandler\s*\(/,
      /\.setDisplayMediaRequestHandler\s*\(/,
      /["'`]select-hid-device["'`]/,
      /["'`]select-serial-port["'`]/,
      /["'`]select-usb-device["'`]/,
      /["'`]select-bluetooth-device["'`]/,
      /["'`]will-download["'`]/,
    ]
    expect(
      required.filter((pattern) => !pattern.test(source)).map(String),
    ).toEqual([])
  })

  test('"Trusted app requests its existing microphone behavior": guest deny handlers are never installed on persist:main or the default session (green-by-design guard)', () => {
    // Green-by-design guard: no main module installs a deny-all permission
    // handler on the trusted app Session (the owner may still name
    // persist:main in order to reject it as a guest partition, per D6).
    expect(
      filesMatching(
        "src/main",
        /(?:defaultSession|fromPartition\(\s*["'`]persist:main["'`]\s*\))\s*\.\s*setPermission(?:Check|Request)Handler/,
      ),
    ).toEqual([])
  })

  test("D5 destroy primitive: the owner closes guests from main with close() and re-checks isDestroyed(); no undocumented destroy()", () => {
    const source = ownerSource()
    expect(/\.close\s*\(/.test(source)).toBe(true)
    expect(/\.isDestroyed\s*\(\s*\)/.test(source)).toBe(true)
    expect(/waitForBeforeUnload\s*:\s*true/.test(source)).toBe(false)
    expect(/\.destroy\s*\(\s*\)/.test(source)).toBe(false)
  })

  test("D7: the guest never gains shell.openExternal (window-open denial does not forward to the OS)", () => {
    const source = ownerSource()
    expect(/\bopenExternal(?:Url)?\s*\(/.test(source)).toBe(false)
  })
})

// ===========================================================================
describe("D9 — diagnostics minimization/redaction is a main-owned composition over redaction.ts", () => {
  test("the shared diagnostics shape adapter exists at src/shared/local-browser-diagnostics-policy.ts and loads under bun test", async () => {
    const adapter = (await import(`../${DIAGNOSTICS_POLICY}`)) as Record<
      string,
      unknown
    >
    expect(
      Object.values(adapter).filter((value) => typeof value === "function")
        .length,
    ).toBeGreaterThan(0)
  })

  test("the shared adapter imports no main-process code and no Electron, and does not re-implement secret matching", () => {
    expect(existsSync(join(repoRoot, DIAGNOSTICS_POLICY))).toBe(true)
    const source = stripComments(readSource(DIAGNOSTICS_POLICY))
    expect(/from\s+["'][^"']*\/main\//.test(source)).toBe(false)
    expect(/from\s+["']electron["']/.test(source)).toBe(false)
    expect(/secret-redaction-policy/.test(source)).toBe(false)
  })

  test("a main module composes the shared adapter with the canonical agent-runtime/redaction owner", () => {
    const composers = walkSources("src/main").filter((file) => {
      const source = stripComments(readSource(file))
      return (
        /from\s+["'][^"']*agent-runtime\/redaction["']|from\s+["']\.\/redaction["']/.test(
          source,
        ) &&
        /from\s+["'][^"']*shared\/local-browser-diagnostics-policy["']/.test(
          source,
        )
      )
    })
    expect(composers.length).toBeGreaterThan(0)
  })

  test("the canonical redaction owner recognises this suite's provider-pattern secret fixtures (green-by-design fixture validation)", async () => {
    const { redactRuntimePayload } = await import(
      "../src/main/lib/agent-runtime/redaction"
    )
    const consoleText = String(fixture.events.consoleMessage?.message)
    const result = redactRuntimePayload(consoleText, {
      secretHints: [],
    } as unknown as Parameters<typeof redactRuntimePayload>[1])
    const redacted = String(result.payload)
    expect(redacted).not.toContain(fixture.secrets.bearerJwt)
    expect(redacted).not.toContain(fixture.secrets.providerKey)
    expect(redacted).not.toContain(fixture.secrets.apiKeyParam)
    expect(result.appliedRules).toContain("secret-text")
  })
})

// ===========================================================================
describe("D6 — admission claims the chat for the true sender window (windowManager.claimChat ownership states)", () => {
  test("acquire-if-unowned, same-window idempotence, other-live-owner denial and stale-owner cleanup (green-by-design guard)", async () => {
    const { windowManager } = await import("../src/main/windows/window-manager")
    type Listener = () => void
    const makeWindow = (id: number) => {
      const listeners = new Map<string, Listener>()
      let destroyed = false
      return {
        id,
        webContents: { id: id + 1000 },
        on(event: string, listener: Listener) {
          listeners.set(event, listener)
        },
        isDestroyed: () => destroyed,
        destroy() {
          destroyed = true
        },
      }
    }
    const windowA = makeWindow(9101)
    const windowB = makeWindow(9102)
    windowManager.register(windowA as never)
    windowManager.register(windowB as never)

    // Unowned chat: explicit acquire.
    expect(windowManager.claimChat("chat-claim-1", windowA.id)).toEqual({
      ok: true,
    })
    // Same window: idempotent.
    expect(windowManager.claimChat("chat-claim-1", windowA.id)).toEqual({
      ok: true,
    })
    // Another live window owns it: bounded denial.
    const denied = windowManager.claimChat("chat-claim-1", windowB.id)
    expect(denied.ok).toBe(false)
    // Stale owner (destroyed but still tracked): acquire after cleanup.
    windowA.destroy()
    expect(windowManager.claimChat("chat-claim-1", windowB.id)).toEqual({
      ok: true,
    })
    expect(windowManager.getChatOwner("chat-claim-1")).toBe(windowB.id)
  })
})
