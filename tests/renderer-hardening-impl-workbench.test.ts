/**
 * Implementation tests (tasks 3.4/4.7, Invariant 7, D6/D9) for the renderer
 * half of the Local Browser guest boundary: `LocalBrowserWorkbench` mounts a
 * `<webview>` only after a main admission obtained through the narrow
 * preload projection (`window.desktopApi.requestLocalBrowserPreview`).
 *
 * This file provides the admitted-mount harness seam: a stubbed
 * `window.desktopApi` issues admissions, so the Invariant-7 leak assertions
 * run against a real mounted `<webview>` (asserted non-empty before any raw
 * event is dispatched) instead of passing vacuously. Electron's own element
 * dispatch is not claimed suppressed; assertions are on app state and the
 * chat-insertion text.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Window } from "happy-dom"
import type {
  LocalBrowserCaptureResult,
  LocalBrowserGuestEvent,
  LocalBrowserPreviewAdmission,
} from "../src/shared/local-browser-diagnostics-policy"

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

const { act, createElement, StrictMode } = await import("react")
const { createRoot } = await import("react-dom/client")
const { I18nProvider } = await import("../src/renderer/lib/i18n")
const { LocalBrowserWorkbench } = await import(
  "../src/renderer/features/agents/ui/local-browser-workbench"
)
type GuestEvent = LocalBrowserGuestEvent
type Admission = LocalBrowserPreviewAdmission
type CaptureResult = LocalBrowserCaptureResult

// ---------------------------------------------------------------------------
// Admitted-mount harness seam: the narrow preload projection, stubbed.
// ---------------------------------------------------------------------------
type Bridge = {
  admissionRequests: Array<Record<string, unknown>>
  captureRequests: Array<Record<string, unknown>>
  issued: Array<Extract<Admission, { ok: true }>>
  admit: (request: { chatId: string; url: string }) => Admission
  capture: (request: { generation: number }) => CaptureResult
  emit: (event: GuestEvent) => Promise<void>
  listenerCount: () => number
}

let bridge: Bridge
let root: ReturnType<typeof createRoot> | null = null
const insertedReports: string[] = []

function installBridge(): Bridge {
  let generation = 0
  let listener: ((event: GuestEvent) => void) | null = null
  const state: Bridge = {
    admissionRequests: [],
    captureRequests: [],
    issued: [],
    admit: (request) => {
      generation += 1
      const url = new URL(request.url)
      const isFile = url.protocol === "file:"
      const admission = {
        ok: true as const,
        generation,
        partition: `locus-guest-${generation.toString(16).padStart(64, "0")}`,
        src: isFile
          ? `locus-preview://${generation.toString(16).padStart(32, "a")}.preview.local/index.html`
          : request.url,
        displayUrl: isFile ? request.url : `${url.origin}${url.pathname}`,
        kind: isFile ? ("file" as const) : ("http" as const),
        fileScope: isFile
          ? {
              relativeDirectory: url.pathname.endsWith("/wt/index.html")
                ? ""
                : "site",
              isWorktreeRoot: url.pathname.endsWith("/wt/index.html"),
            }
          : null,
      }
      state.issued.push(admission)
      return admission
    },
    capture: (request) => ({
      ok: true,
      generation: request.generation,
      displayUrl: "http://localhost:3000/after",
      title: "Safe title",
      domSummary: {
        title: "Safe title",
        url: "http://localhost:3000/after",
        activeElement: null,
        headings: ["Dashboard"],
        buttons: ["Save"],
        links: [],
        inputs: [],
        textSample: "Hello",
      },
      selectedElement: "button#save - Save",
      screenshot: null,
    }),
    emit: async (event) => {
      await act(async () => {
        listener?.(event)
      })
    },
    listenerCount: () => (listener ? 1 : 0),
  }
  ;(testWindow as unknown as { desktopApi: unknown }).desktopApi = {
    requestLocalBrowserPreview: async (request: Record<string, unknown>) => {
      state.admissionRequests.push(request)
      return state.admit(request as { chatId: string; url: string })
    },
    captureLocalBrowserDiagnostics: async (
      request: Record<string, unknown>,
    ) => {
      state.captureRequests.push(request)
      return state.capture(request as { generation: number })
    },
    onLocalBrowserGuestEvent: (callback: (event: GuestEvent) => void) => {
      listener = callback
      return () => {
        if (listener === callback) listener = null
      }
    },
  }
  return state
}

beforeEach(() => {
  bridge = installBridge()
  insertedReports.length = 0
})

afterEach(async () => {
  const current = root
  root = null
  if (current) await act(async () => current.unmount())
  testWindow.document.body.replaceChildren()
  delete (testWindow as unknown as { desktopApi?: unknown }).desktopApi
})

async function flush(ms = 5) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

async function mount(
  options: { chatId?: string; worktreePath?: string; strict?: boolean } = {},
) {
  const container = testWindow.document.createElement("div")
  testWindow.document.body.appendChild(container)
  root = createRoot(container as unknown as Element)
  const tree = createElement(
    I18nProvider,
    null,
    createElement(LocalBrowserWorkbench, {
      chatId: options.chatId ?? "chat-workbench",
      worktreePath: options.worktreePath ?? "/tmp/locus-guest-wt",
      onClose: () => {},
      onInsertReport: (report: string) => insertedReports.push(report),
    }),
  )
  await act(async () => {
    root?.render(options.strict ? createElement(StrictMode, null, tree) : tree)
  })
}

function urlInput(): HTMLInputElement {
  return testWindow.document.querySelector(
    '[data-testid="local-browser-url-input"]',
  ) as unknown as HTMLInputElement
}

async function submit(value: string) {
  const input = urlInput()
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      testWindow.HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, value)
    input.dispatchEvent(new testWindow.Event("input", { bubbles: true }))
  })
  await act(async () => {
    input
      .closest("form")
      ?.dispatchEvent(
        new testWindow.Event("submit", { bubbles: true, cancelable: true }),
      )
  })
  await flush()
}

function webviews(): Element[] {
  return Array.from(
    testWindow.document.querySelectorAll("webview"),
  ) as unknown as Element[]
}

async function dispatchRaw(type: string, payload: Record<string, unknown>) {
  const mounted = webviews()
  expect(mounted.length).toBeGreaterThan(0)
  for (const element of mounted) {
    await act(async () => {
      const event = new testWindow.Event(type, { cancelable: true })
      Object.assign(event, payload)
      element.dispatchEvent(event as unknown as Event)
    })
  }
  await flush()
}

function appState(): string {
  const body = testWindow.document.body
  const parts = [body.textContent ?? "", body.innerHTML]
  for (const field of Array.from(
    testWindow.document.querySelectorAll("input, textarea"),
  ) as unknown as HTMLInputElement[]) {
    parts.push(field.value)
  }
  return parts.join("\n")
}

function leaked(haystack: string): string[] {
  return SECRET_VALUES.filter((secret) => haystack.includes(secret))
}

const RAW_EVENTS: Array<[string, Record<string, unknown>]> = [
  ["console-message", fixture.events.consoleMessage as Record<string, unknown>],
  ["did-fail-load", fixture.events.didFailLoad as Record<string, unknown>],
  [
    "did-fail-provisional-load",
    fixture.events.didFailLoad as Record<string, unknown>,
  ],
  [
    "page-title-updated",
    fixture.events.pageTitleUpdated as Record<string, unknown>,
  ],
  [
    "will-navigate",
    fixture.events.willNavigateSameOrigin as Record<string, unknown>,
  ],
  [
    "did-navigate",
    fixture.events.didNavigateSameOrigin as Record<string, unknown>,
  ],
  [
    "did-navigate-in-page",
    fixture.events.didNavigateInPage as Record<string, unknown>,
  ],
]

describe("admitted mount (D6)", () => {
  test("the <webview> mounts only with the main-issued partition and src after one narrow admission request", async () => {
    await mount({ chatId: "chat-admit" })
    expect(webviews()).toEqual([])
    await submit("localhost:3000")
    expect(bridge.admissionRequests).toEqual([
      { chatId: "chat-admit", url: "http://localhost:3000/" },
    ])
    const mounted = webviews()
    expect(mounted).toHaveLength(1)
    const issued = bridge.issued[0]
    expect(mounted[0]?.getAttribute("partition")).toBe(issued?.partition)
    expect(mounted[0]?.getAttribute("src")).toBe(issued?.src)
    expect(mounted[0]?.getAttribute("partition")).not.toContain("chat-admit")
    for (const attribute of [
      "preload",
      "webpreferences",
      "nodeintegration",
      "allowpopups",
      "disablewebsecurity",
    ]) {
      expect(mounted[0]?.hasAttribute(attribute)).toBe(false)
    }
    // The capability lives only in the element attribute, never in text.
    expect(testWindow.document.body.textContent).not.toContain(
      issued?.partition ?? "never",
    )
  })

  test("a denied admission shows the bounded main reason and mounts no guest", async () => {
    bridge.admit = () => ({
      ok: false,
      code: "file-preview-unsupported",
      message: "File preview is disabled on this platform.",
    })
    await mount()
    await submit("file:///tmp/locus-guest-wt/index.html")
    expect(webviews()).toEqual([])
    expect(testWindow.document.body.textContent).toContain(
      "File preview is disabled on this platform.",
    )
  })

  test("without the preload projection no guest mounts and a local-only reason is shown", async () => {
    delete (testWindow as unknown as { desktopApi?: unknown }).desktopApi
    await mount()
    await submit("localhost:3000")
    expect(webviews()).toEqual([])
    expect(testWindow.document.body.textContent).toContain(
      "Local preview is unavailable in this window.",
    )
  })

  test("a file admission loads the locus-preview origin (never file:) and shows the readable-scope consequence", async () => {
    await mount({ worktreePath: "/tmp/wt" })
    await submit("file:///tmp/wt/site/index.html")
    expect(webviews()[0]?.getAttribute("src")).toMatch(/^locus-preview:\/\//)
    expect(
      testWindow.document.querySelector(
        '[data-testid="local-browser-file-scope"]',
      )?.textContent,
    ).toContain("site/")
    await submit("file:///tmp/wt/index.html")
    expect(
      testWindow.document.querySelector(
        '[data-testid="local-browser-file-scope"]',
      )?.textContent,
    ).toContain("the entire worktree")
  })
})

describe("Invariant 7 with a mounted admitted guest (non-vacuous)", () => {
  test("raw page-controlled <webview> events never reach renderer state", async () => {
    await mount()
    await submit("localhost:3000")
    const textBefore = testWindow.document.body.textContent
    for (const [type, payload] of RAW_EVENTS) {
      await dispatchRaw(type, payload)
    }
    expect(leaked(appState())).toEqual([])
    expect(testWindow.document.body.textContent).toBe(textBefore)
    expect(testWindow.document.body.textContent).toContain(
      "No console messages recorded.",
    )
    expect(testWindow.document.body.textContent).toContain(
      "No load or network failures recorded.",
    )
    expect(urlInput().value).toBe("http://localhost:3000/")
  })

  test("the explicit insert action copies only the main projection, never raw page values", async () => {
    await mount()
    await submit("localhost:3000")
    for (const [type, payload] of RAW_EVENTS) {
      await dispatchRaw(type, payload)
    }
    const button = testWindow.document.querySelector(
      '[data-testid="local-browser-insert-report-button"]',
    ) as unknown as HTMLButtonElement
    expect(button.disabled).toBe(false)
    await act(async () => {
      button.dispatchEvent(
        new testWindow.MouseEvent("click", {
          bubbles: true,
        }) as unknown as Event,
      )
    })
    await flush(10)
    expect(bridge.captureRequests).toEqual([
      { generation: bridge.issued[0]?.generation },
    ])
    expect(insertedReports).toHaveLength(1)
    expect(leaked(insertedReports.join("\n"))).toEqual([])
    expect(insertedReports[0]).toContain("URL: http://localhost:3000/after")
    expect(insertedReports[0]).toContain("button#save - Save")
  })

  test("main projections for the current generation render; other generations are ignored", async () => {
    await mount()
    await submit("localhost:3000")
    const generation = bridge.issued[0]?.generation ?? 0
    await bridge.emit({ generation, kind: "title", title: "Projected Title" })
    await bridge.emit({
      generation,
      kind: "console",
      message: {
        level: "warning",
        text: "Projected console <redacted>",
        timestamp: "2026-09-30T00:00:00.000Z",
      },
    })
    await bridge.emit({
      generation,
      kind: "load-failure",
      failure: {
        url: "http://localhost:3000/api",
        reason: "ERR_CONNECTION_REFUSED",
        timestamp: "2026-09-30T00:00:00.000Z",
      },
    })
    await bridge.emit({
      generation: generation + 99,
      kind: "title",
      title: "Stale Title",
    })
    const text = testWindow.document.body.textContent ?? ""
    expect(text).toContain("Projected Title")
    expect(text).toContain("warning: Projected console <redacted>")
    expect(text).toContain("ERR_CONNECTION_REFUSED - http://localhost:3000/api")
    expect(text).not.toContain("Stale Title")
  })
})

describe("remount and generation rules (D6, task 3.4)", () => {
  test("allowed same-origin guest navigation keeps the one guest element and requests nothing", async () => {
    await mount()
    await submit("localhost:3000")
    const before = webviews()
    const generation = bridge.issued[0]?.generation ?? 0
    await dispatchRaw("did-navigate", { url: "http://localhost:3000/second" })
    await bridge.emit({
      generation,
      kind: "navigated",
      displayUrl: "http://localhost:3000/second",
    })
    const after = webviews()
    expect(after).toHaveLength(1)
    expect(after[0]).toBe(before[0])
    expect(bridge.admissionRequests).toHaveLength(1)
    expect(testWindow.document.body.textContent).toContain(
      "http://localhost:3000/second",
    )
  })

  test("a user-entered different origin or a deliberate re-open is a fresh admission and a fresh element", async () => {
    await mount()
    await submit("localhost:3000")
    const first = webviews()[0]
    await submit("localhost:5173")
    const second = webviews()
    expect(second).toHaveLength(1)
    expect(second[0]).not.toBe(first)
    expect(second[0]?.getAttribute("partition")).toBe(
      bridge.issued[1]?.partition,
    )
    await submit("localhost:5173")
    expect(bridge.admissionRequests).toHaveLength(3)
    expect(webviews()[0]?.getAttribute("partition")).toBe(
      bridge.issued[2]?.partition,
    )
    expect(
      new Set(bridge.issued.map((admission) => admission.partition)).size,
    ).toBe(3)
  })

  test("StrictMode double mount requests a fresh admission per mount and uses only the latest", async () => {
    await mount({ strict: true })
    await submit("localhost:3000")
    expect(bridge.admissionRequests).toHaveLength(2)
    const mounted = webviews()
    expect(mounted).toHaveLength(1)
    expect(mounted[0]?.getAttribute("partition")).toBe(
      bridge.issued[1]?.partition,
    )
  })

  test("a main-reported close unmounts the guest without any renderer retry of the consumed admission", async () => {
    await mount()
    await submit("localhost:3000")
    const generation = bridge.issued[0]?.generation ?? 0
    await bridge.emit({
      generation,
      kind: "closed",
      reason: "committed-url-rejected",
      confirmed: true,
    })
    await flush()
    expect(webviews()).toEqual([])
    expect(bridge.admissionRequests).toHaveLength(1)
    expect(testWindow.document.body.textContent).toContain(
      "The preview was closed by the local preview policy.",
    )
  })

  test("a blocked-navigation projection shows only the minimized target", async () => {
    await mount()
    await submit("localhost:3000")
    const generation = bridge.issued[0]?.generation ?? 0
    await bridge.emit({
      generation,
      kind: "navigation-blocked",
      reason: "top-level-origin",
      target: "https://example.com",
    })
    expect(testWindow.document.body.textContent).toContain(
      "Blocked navigation to https://example.com.",
    )
    expect(webviews()).toHaveLength(1)
  })
})
