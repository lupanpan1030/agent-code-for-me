/**
 * Implementation tests (task 4.8, GP-01..GP-10) for the installed guest-policy
 * owner driven through Electron doubles injected into
 * `createLocalBrowserGuestPolicy`.
 *
 * The doubles establish ordering, verdicts and state transitions only. Real
 * attach ordering, real webRequest interception per resource type and
 * redirect hop, custom-scheme gate observability, real permission prompts,
 * downloads, OS handlers and main-alone destruction are GUI tracks 5.2/5.3.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

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

const {
  createLocalBrowserGuestPolicy,
  LOCAL_BROWSER_GUEST_CHANNELS,
  LOCAL_BROWSER_GUEST_WEB_PREFERENCES,
  LOCUS_PREVIEW_PRIVILEGES,
} = await import("../src/main/windows/local-browser-guest-policy")
type Deps = Parameters<typeof createLocalBrowserGuestPolicy>[0]

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
const SECRET_VALUES = Object.values(fixture.secrets).filter(
  (value) => value !== fixture.secrets.pageTitle,
)

function leaked(value: unknown): string[] {
  const text = JSON.stringify(value)
  return SECRET_VALUES.filter((secret) => text.includes(secret))
}

// ---------------------------------------------------------------------------
// Electron doubles
// ---------------------------------------------------------------------------

type BeforeRequestListener = (
  details: { url: string; resourceType: string },
  callback: (response: { cancel?: boolean }) => void,
) => void

class FakeSession extends EventEmitter {
  readonly calls: string[] = []
  beforeRequestFilter: unknown = null
  beforeRequest: BeforeRequestListener | null = null
  permissionRequest:
    | ((
        contents: unknown,
        permission: string,
        callback: (granted: boolean) => void,
      ) => void)
    | null = null
  permissionCheck: ((contents: unknown, permission: string) => boolean) | null =
    null
  devicePermission: ((details: unknown) => boolean) | null = null
  displayMedia:
    | ((request: unknown, callback: (streams: unknown) => void) => void)
    | null = null
  displayMediaOptions: unknown = null
  readonly protocolHandlers = new Map<
    string,
    (request: { url: string; method: string }) => Response | Promise<Response>
  >()
  readonly protocol = {
    handle: (
      scheme: string,
      handler: (request: {
        url: string
        method: string
      }) => Response | Promise<Response>,
    ) => {
      this.calls.push(`protocol.handle:${scheme}`)
      this.protocolHandlers.set(scheme, handler)
    },
  }
  readonly webRequest = {
    onBeforeRequest: (filter: unknown, listener: BeforeRequestListener) => {
      this.calls.push("webRequest.onBeforeRequest")
      this.beforeRequestFilter = filter
      this.beforeRequest = listener
    },
  }

  constructor(
    readonly partition: string,
    private readonly preloadScripts: unknown[] = [],
    private readonly failOn: string | null = null,
  ) {
    super()
  }

  private record(name: string) {
    this.calls.push(name)
    if (this.failOn === name) throw new Error(`${name} failed`)
  }

  getPreloadScripts() {
    this.record("getPreloadScripts")
    return this.preloadScripts
  }
  setPermissionRequestHandler(handler: FakeSession["permissionRequest"]) {
    this.record("setPermissionRequestHandler")
    this.permissionRequest = handler
  }
  setPermissionCheckHandler(handler: FakeSession["permissionCheck"]) {
    this.record("setPermissionCheckHandler")
    this.permissionCheck = handler
  }
  setDevicePermissionHandler(handler: FakeSession["devicePermission"]) {
    this.record("setDevicePermissionHandler")
    this.devicePermission = handler
  }
  setDisplayMediaRequestHandler(
    handler: FakeSession["displayMedia"],
    options: unknown,
  ) {
    this.record("setDisplayMediaRequestHandler")
    this.displayMedia = handler
    this.displayMediaOptions = options
  }
  override on(event: string, listener: (...args: unknown[]) => void) {
    this.record(`on:${event}`)
    return super.on(event, listener)
  }
  async clearStorageData() {
    this.calls.push("clearStorageData")
  }
  async clearCache() {
    this.calls.push("clearCache")
  }
  async clearAuthCache() {
    this.calls.push("clearAuthCache")
  }

  /** Simulates one observed request through the installed gate. */
  request(url: string, resourceType: string): boolean {
    let cancelled: boolean | null = null
    this.beforeRequest?.({ url, resourceType }, (response) => {
      cancelled = response.cancel === true
    })
    if (cancelled === null) throw new Error("gate did not answer")
    return cancelled
  }
}

type FakeImage = {
  isEmpty: () => boolean
  getSize: () => { width: number; height: number }
  toPNG: () => Buffer
}

class FakeWebContents extends EventEmitter {
  destroyed = false
  destroyOnClose = true
  closeThrows = false
  readonly closeCalls: unknown[][] = []
  readonly sent: Array<[string, Record<string, unknown>]> = []
  readonly executed: Array<[string, boolean | undefined]> = []
  windowOpenHandler: (() => unknown) | null = null
  lastWebPreferences: Record<string, unknown> | null = {
    ...LOCAL_BROWSER_GUEST_WEB_PREFERENCES,
    additionalArguments: [],
  }
  probeResults = new Map<string, unknown>()
  captureImpl: () => Promise<FakeImage> = async () => fakeImage(800, 600)

  constructor(
    readonly id: number,
    private readonly type: string,
    readonly session: object,
  ) {
    super()
  }
  getType() {
    return this.type
  }
  isDestroyed() {
    return this.destroyed
  }
  close(...args: unknown[]) {
    this.closeCalls.push(args)
    if (this.closeThrows) throw new Error("close failed")
    if (this.destroyOnClose) this.destroy_()
  }
  destroy_() {
    if (this.destroyed) return
    this.destroyed = true
    this.emit("destroyed")
  }
  send(channel: string, payload: Record<string, unknown>) {
    this.sent.push([channel, payload])
  }
  setWindowOpenHandler(handler: () => unknown) {
    this.windowOpenHandler = handler
  }
  executeJavaScript(code: string, userGesture?: boolean) {
    this.executed.push([code, userGesture])
    return Promise.resolve(this.probeResults.get(code) ?? null)
  }
  capturePage() {
    return this.captureImpl()
  }
  getLastWebPreferences() {
    return this.lastWebPreferences
  }
  events(kind?: string) {
    return this.sent
      .filter(
        ([channel]) => channel === LOCAL_BROWSER_GUEST_CHANNELS.guestEvent,
      )
      .map(([, payload]) => payload)
      .filter((payload) => !kind || payload.kind === kind)
  }
}

function fakeImage(width: number, height: number, bytes = 1024): FakeImage {
  return {
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    toPNG: () => Buffer.alloc(bytes, 7),
  }
}

type Harness = ReturnType<typeof createHarness>

function createHarness(overrides: Partial<Deps> = {}) {
  const app = new EventEmitter()
  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()
  const privileged: unknown[] = []
  const sessions = new Map<string, FakeSession>()
  const trustedSession = new FakeSession("persist:main")
  const sessionPartitions: string[] = []
  const logs: string[] = []
  const windowIds = new Map<number, number>()
  const liveWindows = new Set<number>()
  const owners = new Map<string, number>()
  const roots = new Map<string, string>()
  const claimCalls: Array<[string, number]> = []
  let clock = 100_000
  let tokens = 0
  let sessionFactory = (partition: string) => new FakeSession(partition)

  const deps: Deps = {
    app: app as unknown as Deps["app"],
    protocol: {
      registerSchemesAsPrivileged: (schemes: unknown) => {
        privileged.push(schemes)
      },
    } as unknown as Deps["protocol"],
    ipcMain: {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
        ipcHandlers.set(channel, handler)
      },
    } as unknown as Deps["ipcMain"],
    sessionFromPartition: (partition) => {
      sessionPartitions.push(partition)
      const session = sessionFactory(partition)
      sessions.set(partition, session)
      return session as unknown as ReturnType<Deps["sessionFromPartition"]>
    },
    windowIdForWebContents: (contents) =>
      windowIds.get((contents as unknown as { id: number }).id) ?? null,
    isLiveAppWindow: (windowId) => liveWindows.has(windowId),
    claimChat: (chatId, windowId) => {
      claimCalls.push([chatId, windowId])
      const owner = owners.get(chatId)
      if (owner !== undefined && owner !== windowId && liveWindows.has(owner)) {
        return { ok: false, ownerStableId: `window-${owner}` }
      }
      owners.set(chatId, windowId)
      return { ok: true }
    },
    resolveChatWorktreeRoot: (chatId) => {
      const root = roots.get(chatId)
      if (!root) throw new Error("Chat worktree root is not registered")
      return root
    },
    platform: "linux",
    now: () => clock,
    randomToken: (bytes) => {
      tokens += 1
      return tokens.toString(16).padStart(bytes * 2, "0")
    },
    log: (message) => logs.push(message),
    limits: { teardownConfirmTimeoutMs: 20, probeTimeoutMs: 200 },
    ...overrides,
  }
  const policy = createLocalBrowserGuestPolicy(deps)
  policy.install()

  let nextId = 1
  const createContents = (type: string, session: object) => {
    const contents = new FakeWebContents(nextId++, type, session)
    app.emit("web-contents-created", {}, contents)
    return contents
  }
  const createAppWindow = (windowId: number) => {
    const embedder = createContents("window", trustedSession)
    windowIds.set(embedder.id, windowId)
    liveWindows.add(windowId)
    policy.registerEmbedder(embedder as never)
    return embedder
  }
  const request = (sender: FakeWebContents, payload: unknown) =>
    policy.requestPreview({ sender } as never, payload)

  return {
    app,
    ipcHandlers,
    privileged,
    sessions,
    sessionPartitions,
    trustedSession,
    logs,
    liveWindows,
    owners,
    roots,
    claimCalls,
    policy,
    createContents,
    createAppWindow,
    request,
    advance: (ms: number) => {
      clock += ms
    },
    setSessionFactory: (factory: (partition: string) => FakeSession) => {
      sessionFactory = factory
    },
  }
}

async function admitHttp(
  harness: Harness,
  embedder: FakeWebContents,
  chatId = "chat-http",
  url = "http://localhost:3000/",
) {
  harness.roots.set(chatId, "/registered/worktree")
  const admission = await harness.request(embedder, { chatId, url })
  if (!admission.ok) throw new Error(`admission denied: ${admission.code}`)
  return admission
}

function attachEvent() {
  return {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true
    },
  }
}

function willAttach(
  embedder: FakeWebContents,
  params: Record<string, unknown>,
  webPreferences: Record<string, unknown> = {},
) {
  const event = attachEvent()
  embedder.emit("will-attach-webview", event, webPreferences, params)
  return { event, webPreferences, params }
}

function attachGuest(
  harness: Harness,
  embedder: FakeWebContents,
  admission: { partition: string; src: string },
) {
  const attach = willAttach(embedder, {
    src: admission.src,
    partition: admission.partition,
  })
  expect(attach.event.defaultPrevented).toBe(false)
  const session = harness.sessions.get(admission.partition)
  if (!session) throw new Error("no session for partition")
  const guest = harness.createContents("webview", session)
  embedder.emit("did-attach-webview", {}, guest)
  return guest
}

function navigationDetails(url: string, isMainFrame = true) {
  return {
    url,
    isMainFrame,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true
    },
  }
}

// ---------------------------------------------------------------------------

describe("D5 install: one hook, exact scheme privileges, narrow IPC", () => {
  test("installs exactly one web-contents-created hook and the two internal channels; install is idempotent", () => {
    const harness = createHarness()
    harness.policy.install()
    expect(harness.app.listenerCount("web-contents-created")).toBe(1)
    expect(harness.privileged).toEqual([
      [
        {
          scheme: "locus-preview",
          privileges: { ...LOCUS_PREVIEW_PRIVILEGES },
        },
      ],
    ])
    expect([...harness.ipcHandlers.keys()].sort()).toEqual([
      "local-browser:capture-diagnostics",
      "local-browser:request-preview",
    ])
  })

  test("every created webContents gets will-attach/did-attach guards; guests are provisioned at creation", () => {
    const harness = createHarness()
    const other = harness.createContents("window", harness.trustedSession)
    expect(other.listenerCount("will-attach-webview")).toBe(1)
    expect(other.listenerCount("did-attach-webview")).toBe(1)
    const guest = harness.createContents("webview", new FakeSession("x"))
    expect(guest.windowOpenHandler).not.toBeNull()
    for (const event of [
      "will-navigate",
      "will-frame-navigate",
      "will-redirect",
      "did-navigate",
      "select-bluetooth-device",
      "console-message",
      "destroyed",
    ]) {
      expect(guest.listenerCount(event)).toBeGreaterThan(0)
    }
  })
})

describe("D6 admission IPC (GP-02)", () => {
  test("caller-provided filesystem/webContents/partition authority is rejected", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(11)
    harness.roots.set("chat-1", "/registered/worktree")
    for (const payload of [
      null,
      "chat-1",
      { chatId: "chat-1" },
      { chatId: "chat-1", url: "http://localhost:3000/", worktreePath: "/" },
      { chatId: "chat-1", url: "http://localhost:3000/", webContentsId: 9 },
      { chatId: "chat-1", url: "http://localhost:3000/", partition: "p" },
      { chatId: "", url: "http://localhost:3000/" },
      { chatId: "chat\u0000", url: "http://localhost:3000/" },
    ]) {
      expect(await harness.request(embedder, payload)).toMatchObject({
        ok: false,
        code: "invalid-request",
      })
    }
    expect(harness.sessionPartitions).toEqual([])
  })

  test("the sender must be a registered live app window", async () => {
    const harness = createHarness()
    const unregistered = harness.createContents(
      "window",
      harness.trustedSession,
    )
    harness.roots.set("chat-1", "/registered/worktree")
    expect(
      await harness.request(unregistered, {
        chatId: "chat-1",
        url: "http://localhost:3000/",
      }),
    ).toMatchObject({ ok: false, code: "sender-not-app-window" })
    const embedder = harness.createAppWindow(12)
    harness.liveWindows.delete(12)
    expect(
      await harness.request(embedder, {
        chatId: "chat-1",
        url: "http://localhost:3000/",
      }),
    ).toMatchObject({ ok: false, code: "sender-not-app-window" })
  })

  test("claimChat runs for the true sender window: acquire-if-unowned, same-window idempotence, other-live-owner denial", async () => {
    const harness = createHarness()
    const windowA = harness.createAppWindow(21)
    const windowB = harness.createAppWindow(22)
    harness.roots.set("chat-own", "/registered/worktree")
    const url = "http://localhost:3000/"
    expect(
      (await harness.request(windowA, { chatId: "chat-own", url })).ok,
    ).toBe(true)
    expect(
      (await harness.request(windowA, { chatId: "chat-own", url })).ok,
    ).toBe(true)
    expect(
      await harness.request(windowB, { chatId: "chat-own", url }),
    ).toMatchObject({ ok: false, code: "chat-owned-elsewhere" })
    expect(harness.claimCalls).toEqual([
      ["chat-own", 21],
      ["chat-own", 21],
      ["chat-own", 22],
    ])
    // Stale owner: window A is gone; window B acquires.
    harness.liveWindows.delete(21)
    expect(
      (await harness.request(windowB, { chatId: "chat-own", url })).ok,
    ).toBe(true)
  })

  test("the DB-registered root is authoritative: an unregistered chat is denied and a file outside the root is rejected", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(31)
    expect(
      await harness.request(embedder, {
        chatId: "chat-unregistered",
        url: "http://localhost:3000/",
      }),
    ).toMatchObject({ ok: false, code: "chat-not-registered" })
    harness.roots.set("chat-root", "/registered/worktree")
    expect(
      await harness.request(embedder, {
        chatId: "chat-root",
        url: "file:///tmp/renderer-forged-root/index.html",
      }),
    ).toMatchObject({ ok: false, code: "url-rejected" })
    expect(
      await harness.request(embedder, {
        chatId: "chat-root",
        url: "https://example.com/",
      }),
    ).toMatchObject({ ok: false, code: "url-rejected" })
  })

  test("the returned partition is a high-entropy non-persistent capability, not chat-derived", async () => {
    const harness = createHarness({ randomToken: undefined })
    const embedder = harness.createAppWindow(41)
    const admission = await admitHttp(harness, embedder, "chat-entropy")
    expect(admission.partition).toMatch(/^locus-guest-[0-9a-f]{64}$/)
    expect(admission.partition).not.toContain("chat-entropy")
    expect(admission.src).toBe("http://localhost:3000/")
    expect(admission.kind).toBe("http")
    expect(admission.fileScope).toBeNull()
    expect(harness.logs.join("\n")).not.toContain(admission.partition)
  })
})

describe("D7/D8 pre-return Session configuration (GP-01/GP-07)", () => {
  test("every Session-scoped handler and the sole <all_urls> gate exist before the partition is returned", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(51)
    const admission = await admitHttp(harness, embedder)
    const session = harness.sessions.get(admission.partition)
    expect(session).toBeDefined()
    expect(harness.sessionPartitions).toEqual([admission.partition])
    expect(session?.calls).toEqual([
      "getPreloadScripts",
      "webRequest.onBeforeRequest",
      "setPermissionRequestHandler",
      "setPermissionCheckHandler",
      "setDevicePermissionHandler",
      "setDisplayMediaRequestHandler",
      "on:select-hid-device",
      "on:select-serial-port",
      "on:select-usb-device",
      "on:will-download",
    ])
    expect(session?.beforeRequestFilter).toEqual({ urls: ["<all_urls>"] })
    expect(session?.calls).not.toContain("protocol.handle:locus-preview")
  })

  test("first-response download and early permission requests are denied before any guest attaches", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(52)
    const admission = await admitHttp(harness, embedder)
    const session = harness.sessions.get(admission.partition) as FakeSession

    // The very first request (initial src) passes the preinstalled gate.
    expect(session.request(admission.src, "mainFrame")).toBe(false)

    let downloadPrevented = false
    let downloadCancelled = false
    session.emit(
      "will-download",
      {
        preventDefault: () => {
          downloadPrevented = true
        },
      },
      {
        cancel: () => {
          downloadCancelled = true
        },
      },
    )
    expect(downloadPrevented).toBe(true)
    expect(downloadCancelled).toBe(true)

    const granted: boolean[] = []
    for (const permission of [
      "openExternal",
      "media",
      "geolocation",
      "notifications",
      "clipboard-read",
      "fullscreen",
      "unknown-future-permission",
    ]) {
      session.permissionRequest?.(null, permission, (value) => {
        granted.push(value)
      })
      expect(session.permissionCheck?.(null, permission)).toBe(false)
    }
    expect(granted.every((value) => value === false)).toBe(true)
    expect(session.devicePermission?.({ deviceType: "hid" })).toBe(false)

    let streams: unknown = "unset"
    session.displayMedia?.({}, (value) => {
      streams = value
    })
    expect(streams).toEqual({})
    expect(session.displayMediaOptions).toEqual({ useSystemPicker: false })

    const selections: unknown[][] = []
    for (const [event, extra] of [
      ["select-hid-device", [{ deviceList: [{ deviceId: "d1" }] }]],
      ["select-usb-device", [{ deviceList: [{ deviceId: "u1" }] }]],
      ["select-serial-port", [[{ portId: "s1" }], {}]],
    ] as const) {
      let prevented = false
      session.emit(
        event,
        {
          preventDefault: () => {
            prevented = true
          },
        },
        ...extra,
        (...args: unknown[]) => selections.push([event, ...args]),
      )
      expect(prevented).toBe(true)
    }
    expect(selections).toEqual([
      ["select-hid-device"],
      ["select-usb-device"],
      ["select-serial-port", ""],
    ])
  })

  test("a Session with registered preload scripts or a failed handler install aborts the admission (no partition returned)", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(53)
    harness.roots.set("chat-p", "/registered/worktree")
    harness.setSessionFactory(
      (partition) => new FakeSession(partition, [{ id: "evil" }]),
    )
    const preloaded = await harness.request(embedder, {
      chatId: "chat-p",
      url: "http://localhost:3000/",
    })
    expect(preloaded).toMatchObject({ ok: false, code: "session-setup-failed" })
    expect("partition" in preloaded).toBe(false)

    harness.setSessionFactory(
      (partition) =>
        new FakeSession(partition, [], "setDisplayMediaRequestHandler"),
    )
    const failed = await harness.request(embedder, {
      chatId: "chat-p",
      url: "http://localhost:3000/",
    })
    expect(failed).toMatchObject({ ok: false, code: "session-setup-failed" })
    expect(harness.policy.registry.activeAdmissions()).toEqual([])
  })

  test("the trusted persist:main/default Session is never configured by the guest owner (GP-10)", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(54)
    await admitHttp(harness, embedder)
    expect(
      harness.sessionPartitions.every((p) => p.startsWith("locus-guest-")),
    ).toBe(true)
    expect(harness.trustedSession.calls).toEqual([])
  })
})

describe("D5 attachment guard (GP-01)", () => {
  test("an unregistered embedder can never attach, even with a live admission", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(61)
    const admission = await admitHttp(harness, embedder)
    const rogue = harness.createContents("window", harness.trustedSession)
    const { event } = willAttach(rogue, {
      src: admission.src,
      partition: admission.partition,
    })
    expect(event.defaultPrevented).toBe(true)
  })

  test("the exact admission attaches once with forced secure preferences; replay, mismatch and unknown partitions are prevented", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(62)
    const admission = await admitHttp(harness, embedder)

    const unknown = willAttach(embedder, {
      src: admission.src,
      partition: "locus-guest-unknown",
    })
    expect(unknown.event.defaultPrevented).toBe(true)
    const persistMain = willAttach(embedder, {
      src: admission.src,
      partition: "persist:main",
    })
    expect(persistMain.event.defaultPrevented).toBe(true)

    const hostile = {
      preload: "file:///evil.js",
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false,
      webviewTag: true,
      additionalArguments: ["--evil"],
    }
    const first = willAttach(
      embedder,
      { src: admission.src, partition: admission.partition },
      hostile,
    )
    expect(first.event.defaultPrevented).toBe(false)
    expect(first.webPreferences).toEqual({
      ...LOCAL_BROWSER_GUEST_WEB_PREFERENCES,
      additionalArguments: [],
      partition: admission.partition,
    })

    const replay = willAttach(embedder, {
      src: admission.src,
      partition: admission.partition,
    })
    expect(replay.event.defaultPrevented).toBe(true)
    expect(harness.logs.join("\n")).not.toContain(admission.partition)
  })

  test("src mismatch, expiry and unsafe element attributes are prevented and revoke the admission", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(63)
    const mismatch = await admitHttp(harness, embedder, "chat-mismatch")
    expect(
      willAttach(embedder, {
        src: "http://localhost:4000/",
        partition: mismatch.partition,
      }).event.defaultPrevented,
    ).toBe(true)
    expect(
      willAttach(embedder, { src: mismatch.src, partition: mismatch.partition })
        .event.defaultPrevented,
    ).toBe(true)

    const expired = await admitHttp(harness, embedder, "chat-expired")
    harness.advance(60_000)
    expect(
      willAttach(embedder, { src: expired.src, partition: expired.partition })
        .event.defaultPrevented,
    ).toBe(true)

    const unsafe = await admitHttp(harness, embedder, "chat-unsafe")
    const rejected = willAttach(embedder, {
      src: unsafe.src,
      partition: unsafe.partition,
      preload: "file:///evil/preload.js",
      allowpopups: true,
    })
    expect(rejected.event.defaultPrevented).toBe(true)
    expect(
      willAttach(embedder, { src: unsafe.src, partition: unsafe.partition })
        .event.defaultPrevented,
    ).toBe(true)
    expect(
      embedder
        .events("closed")
        .some(
          (event) =>
            event.generation === unsafe.generation &&
            event.reason === "preferences-rejected",
        ),
    ).toBe(true)
  })

  test("did-attach binds only a provisioned guest with verified effective preferences; anything else is closed from main", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(64)
    const admission = await admitHttp(harness, embedder, "chat-ok")
    const guest = attachGuest(harness, embedder, admission)
    expect(guest.closeCalls).toEqual([])
    expect(embedder.events("attached")).toEqual([
      { kind: "attached", generation: admission.generation },
    ])

    // Late/missing mandatory handlers: a guest that was never provisioned.
    const second = await admitHttp(harness, embedder, "chat-unprovisioned")
    willAttach(embedder, { src: second.src, partition: second.partition })
    const unprovisioned = new FakeWebContents(
      900,
      "webview",
      harness.sessions.get(second.partition) as object,
    )
    embedder.emit("did-attach-webview", {}, unprovisioned)
    expect(unprovisioned.closeCalls).toEqual([[]])
    expect(unprovisioned.isDestroyed()).toBe(true)

    // Effective preferences weakened after attach.
    const third = await admitHttp(harness, embedder, "chat-insecure")
    willAttach(embedder, { src: third.src, partition: third.partition })
    const insecure = new FakeWebContents(
      901,
      "webview",
      harness.sessions.get(third.partition) as object,
    )
    insecure.lastWebPreferences = { sandbox: false, contextIsolation: true }
    harness.app.emit("web-contents-created", {}, insecure)
    embedder.emit("did-attach-webview", {}, insecure)
    expect(insecure.closeCalls).toEqual([[]])

    // A guest whose Session was never issued.
    const stranger = harness.createContents("webview", new FakeSession("x"))
    embedder.emit("did-attach-webview", {}, stranger)
    expect(stranger.closeCalls).toEqual([[]])
  })
})

describe("guest WebContents handlers (GP-04/GP-06)", () => {
  test("window.open/_blank is denied without any shell or window side effect", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(71)
    const admission = await admitHttp(harness, embedder)
    const guest = attachGuest(harness, embedder, admission)
    for (const url of ["https://example.com/", "locus://mcp-import?x=1"]) {
      expect(guest.windowOpenHandler?.()).toEqual({ action: "deny" })
      void url
    }
  })

  test("top-level remote, other-port and external-scheme navigations are prevented and projected as minimized blocked origins", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(72)
    const admission = await admitHttp(harness, embedder)
    const guest = attachGuest(harness, embedder, admission)
    for (const url of [
      "https://example.com/phish?token=querytok-Z3k8Pw1Rt6Yh",
      "http://localhost:5173/",
      "locus://mcp-import?payload=abc",
      "agent-code-for-me://x",
      "mailto:a@example.com",
      "vscode://file/x",
      "javascript:alert(1)",
    ]) {
      for (const event of [
        "will-frame-navigate",
        "will-navigate",
        "will-redirect",
      ]) {
        const details = navigationDetails(url)
        guest.emit(event, details)
        expect(details.defaultPrevented).toBe(true)
      }
    }
    const allowed = navigationDetails("http://localhost:3000/next")
    guest.emit("will-navigate", allowed)
    expect(allowed.defaultPrevented).toBe(false)

    const blocked = embedder.events("navigation-blocked")
    expect(blocked.length).toBeGreaterThan(0)
    expect(JSON.stringify(blocked)).not.toContain("querytok")
    expect(JSON.stringify(blocked)).not.toContain("/phish")
    expect(blocked[0]).toMatchObject({ target: "https://example.com" })
    expect(harness.logs.join("\n")).not.toContain("querytok")
  })

  test("Bluetooth selection is prevented and answered with an empty id", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(73)
    const admission = await admitHttp(harness, embedder)
    const guest = attachGuest(harness, embedder, admission)
    let prevented = false
    const answers: unknown[] = []
    guest.emit(
      "select-bluetooth-device",
      {
        preventDefault: () => {
          prevented = true
        },
      },
      [{ deviceId: "b1" }],
      (id: unknown) => answers.push(id),
    )
    expect(prevented).toBe(true)
    expect(answers).toEqual([""])
  })

  test("a non-admitted committed postcondition (data:, other origin, non-initial about:blank) destroys the guest from main", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(74)
    for (const url of ["data:text/html,<h1>x</h1>", "https://example.com/"]) {
      const admission = await admitHttp(harness, embedder, `chat-${url.length}`)
      const guest = attachGuest(harness, embedder, admission)
      guest.emit("did-navigate", {}, url)
      expect(guest.closeCalls).toEqual([[]])
      expect(
        harness.policy.registry.findByGeneration(admission.generation)?.state,
      ).toBe("destroyed")
    }
    const admission = await admitHttp(harness, embedder, "chat-blank")
    const guest = attachGuest(harness, embedder, admission)
    guest.emit("did-navigate", {}, "about:blank")
    expect(guest.closeCalls).toEqual([])
    guest.emit("did-navigate", {}, "http://localhost:3000/after")
    expect(guest.closeCalls).toEqual([])
    guest.emit("did-navigate", {}, "about:blank")
    expect(guest.closeCalls).toEqual([[]])
  })
})

describe("D7 request-gate error page (committed-URL postcondition)", () => {
  test("a main-frame gate cancellation tears the guest down from main; subframe and ordinary failures are only projected", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(75)
    const admission = await admitHttp(harness, embedder)
    const guest = attachGuest(harness, embedder, admission)

    guest.emit(
      "did-fail-provisional-load",
      {},
      -20,
      "ERR_BLOCKED_BY_CLIENT",
      "https://example.com/phish?token=querytok-Z3k8Pw1Rt6Yh",
      false,
    )
    guest.emit(
      "did-fail-provisional-load",
      {},
      -105,
      "ERR_NAME_NOT_RESOLVED",
      "http://localhost:3000/missing",
      true,
    )
    expect(guest.closeCalls).toEqual([])
    expect(embedder.events("load-failure")).toHaveLength(1)

    // Real sequence after a gate cancel (Electron DidFinishNavigation):
    // did-fail-provisional-load, then did-fail-load; no did-navigate.
    for (const event of ["did-fail-provisional-load", "did-fail-load"]) {
      guest.emit(
        event,
        {},
        -20,
        "ERR_BLOCKED_BY_CLIENT",
        "https://example.com/phish?token=querytok-Z3k8Pw1Rt6Yh",
        true,
      )
    }
    expect(guest.closeCalls).toEqual([[]])
    expect(
      harness.policy.registry.findByGeneration(admission.generation)?.state,
    ).toBe("destroyed")
    expect(embedder.events("closed")).toEqual([
      {
        kind: "closed",
        reason: "committed-url-rejected",
        confirmed: true,
        generation: admission.generation,
      },
    ])
    expect(embedder.events("load-failure")).toHaveLength(1)
    const session = harness.sessions.get(admission.partition) as FakeSession
    expect(session.request(admission.src, "mainFrame")).toBe(true)
    expect(harness.logs.join("\n")).toContain("request-gate-error-page")
    expect(harness.logs.join("\n")).not.toContain("querytok")
    expect(harness.logs.join("\n")).not.toContain("/phish")
  })

  test("did-fail-load alone never tears down, and a revoked guest's gate cancellation is not re-handled", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(76)
    const admission = await admitHttp(harness, embedder)
    const guest = attachGuest(harness, embedder, admission)
    guest.emit(
      "did-fail-load",
      {},
      -20,
      "ERR_BLOCKED_BY_CLIENT",
      "https://example.com/",
      true,
    )
    expect(guest.closeCalls).toEqual([])

    guest.destroyOnClose = false
    guest.emit("did-navigate", {}, "https://example.com/")
    expect(guest.closeCalls).toEqual([[]])
    guest.emit(
      "did-fail-provisional-load",
      {},
      -20,
      "ERR_BLOCKED_BY_CLIENT",
      "https://example.com/",
      true,
    )
    expect(guest.closeCalls).toEqual([[]])
  })
})

describe("D5/D6 main-alone teardown (GP-08)", () => {
  test("a new generation for the same chat closes the old guest from main with close() (no waitForBeforeUnload) and revokes it immediately", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(81)
    const first = await admitHttp(harness, embedder)
    const firstGuest = attachGuest(harness, embedder, first)
    const second = await admitHttp(
      harness,
      embedder,
      "chat-http",
      "http://localhost:4000/",
    )
    expect(firstGuest.closeCalls).toEqual([[]])
    expect(firstGuest.isDestroyed()).toBe(true)
    const firstRecord = harness.policy.registry.findByGeneration(
      first.generation,
    )
    expect(firstRecord?.state).toBe("destroyed")
    expect(
      embedder
        .events("closed")
        .filter((event) => event.generation === first.generation),
    ).toEqual([
      {
        kind: "closed",
        reason: "superseded",
        confirmed: true,
        generation: first.generation,
      },
    ])
    // The old guest cannot consume the new admission, nor revive its own.
    expect(
      willAttach(embedder, { src: first.src, partition: first.partition }).event
        .defaultPrevented,
    ).toBe(true)
    expect(second.partition).not.toBe(first.partition)
    const secondSession = harness.sessions.get(second.partition) as FakeSession
    const firstSession = harness.sessions.get(first.partition) as FakeSession
    // Old Session keeps its handlers and now cancels everything.
    expect(firstSession.request("http://localhost:3000/", "mainFrame")).toBe(
      true,
    )
    expect(secondSession.request("http://localhost:4000/", "mainFrame")).toBe(
      false,
    )
    expect(firstSession.calls).toEqual(
      expect.arrayContaining([
        "clearStorageData",
        "clearCache",
        "clearAuthCache",
      ]),
    )
  })

  test("authority is invalidated even when close() fails; unconfirmed destruction is reported as a bounded failure", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(82)
    const admission = await admitHttp(harness, embedder)
    const guest = attachGuest(harness, embedder, admission)
    guest.closeThrows = true
    guest.emit("did-navigate", {}, "data:text/html,x")
    const record = harness.policy.registry.findByGeneration(
      admission.generation,
    )
    expect(record?.state).toBe("tearing-down")
    const session = harness.sessions.get(admission.partition) as FakeSession
    expect(session.request(admission.src, "mainFrame")).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(record?.state).toBe("teardown-unconfirmed")
    expect(embedder.events("closed")).toEqual([
      {
        kind: "closed",
        reason: "committed-url-rejected",
        confirmed: false,
        generation: admission.generation,
      },
    ])
    // Revival or reattachment still requires a fresh admission.
    expect(
      willAttach(embedder, {
        src: admission.src,
        partition: admission.partition,
      }).event.defaultPrevented,
    ).toBe(true)
  })

  test("asynchronous destruction after close() is confirmed through the destroyed event", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(83)
    const admission = await admitHttp(harness, embedder)
    const guest = attachGuest(harness, embedder, admission)
    guest.destroyOnClose = false
    guest.emit("did-navigate", {}, "https://example.com/")
    expect(guest.closeCalls).toEqual([[]])
    guest.destroy_()
    expect(
      harness.policy.registry.findByGeneration(admission.generation)?.state,
    ).toBe("destroyed")
    expect(embedder.events("closed")).toHaveLength(1)
  })

  test("embedder destruction revokes its pending and attached admissions", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(84)
    const attached = await admitHttp(harness, embedder, "chat-attached")
    const guest = attachGuest(harness, embedder, attached)
    const pending = await admitHttp(harness, embedder, "chat-pending")
    embedder.destroy_()
    expect(guest.closeCalls).toEqual([[]])
    expect(harness.policy.registry.activeAdmissions()).toEqual([])
    const session = harness.sessions.get(pending.partition) as FakeSession
    expect(session.request(pending.src, "mainFrame")).toBe(true)
  })
})

describe("D9 diagnostics relay and capture (GP-09)", () => {
  test("raw console/load-failure/title/navigation payloads are minimized and redacted in main before projection", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(91)
    const admission = await admitHttp(harness, embedder)
    const guest = attachGuest(harness, embedder, admission)
    const consoleEvent = fixture.events.consoleMessage as Record<
      string,
      unknown
    >
    guest.emit("console-message", {
      level: consoleEvent.level,
      message: consoleEvent.message,
      sourceId: consoleEvent.sourceId,
      lineNumber: consoleEvent.line,
    })
    const failure = fixture.events.didFailLoad as Record<string, unknown>
    for (const event of ["did-fail-load", "did-fail-provisional-load"]) {
      guest.emit(
        event,
        {},
        failure.errorCode,
        failure.errorDescription,
        failure.validatedURL,
        true,
      )
    }
    guest.emit(
      "did-navigate",
      {},
      (fixture.events.didNavigateSameOrigin as { url: string }).url,
    )
    guest.emit(
      "did-navigate-in-page",
      {},
      (fixture.events.didNavigateInPage as { url: string }).url,
      true,
    )
    guest.emit("page-title-updated", {}, "Title with Bearer abc.def.ghi", true)

    const projected = embedder.events()
    expect(leaked(projected)).toEqual([])
    expect(leaked(harness.logs)).toEqual([])
    const consoleProjection = embedder.events("console")[0] as {
      message: Record<string, unknown>
    }
    expect(consoleProjection.message).toMatchObject({
      level: "error",
      source: "http://localhost:3000/app.js",
      line: 42,
    })
    expect(embedder.events("load-failure")[0]).toMatchObject({
      failure: {
        url: "http://localhost:3000/callback",
        reason: "ERR_NAME_NOT_RESOLVED",
        code: -105,
      },
    })
    expect(
      embedder.events("navigated").map((event) => event.displayUrl),
    ).toEqual(["http://localhost:3000/after", "http://localhost:3000/after"])
    expect(JSON.stringify(embedder.events("title"))).not.toContain(
      "abc.def.ghi",
    )
    expect(projected.some((event) => "partition" in event)).toBe(false)
  })

  test("Electron console levels map explicitly; unknown levels fall back to log", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(92)
    const admission = await admitHttp(harness, embedder)
    const guest = attachGuest(harness, embedder, admission)
    for (const level of ["info", "warning", "error", "debug", "verbose", 3]) {
      guest.emit("console-message", {
        level,
        message: `message-${level}`,
        sourceId: "",
        lineNumber: 1,
      })
    }
    expect(
      embedder
        .events("console")
        .map((event) => (event.message as { level: string }).level),
    ).toEqual(["info", "warning", "error", "debug", "log", "log"])
  })

  test("capture runs only the closed probe set with userGesture:false and projects bounded, redacted results", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(93)
    const admission = await admitHttp(harness, embedder)
    const guest = attachGuest(harness, embedder, admission)
    guest.emit("dom-ready", {})
    const { LOCAL_BROWSER_DIAGNOSTIC_PROBES } = await import(
      "../src/shared/local-browser-workbench"
    )
    guest.probeResults.set(LOCAL_BROWSER_DIAGNOSTIC_PROBES["dom-summary"], {
      title: "Dashboard",
      url: "http://user:guestpw-Q7x9Lm2Vn4@localhost:3000/x?access_token=querytok-Z3k8Pw1Rt6Yh#fragsecret-B5n2Kd8Wq1",
      activeElement: "input api_key=apikeyval-N6b1Qe7Ws4Ux",
      headings: Array.from({ length: 40 }, (_, index) => `Heading ${index}`),
      buttons: ["Save"],
      links: [
        {
          label: "Callback",
          href: "/cb?code=oauthcode-H4j7Fs2Lp9&state=oauthstate-M1c6Tv3Xz8",
        },
      ],
      inputs: ["Token"],
      textSample: `Authorization: Bearer ${fixture.secrets.bearerJwt} ${"x".repeat(5000)}`,
    })
    guest.probeResults.set(
      LOCAL_BROWSER_DIAGNOSTIC_PROBES["last-selection"],
      `button#save - key=${fixture.secrets.providerKey}`,
    )
    const result = await harness.policy.captureDiagnostics(
      { sender: embedder } as never,
      { generation: admission.generation },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(leaked(result)).toEqual([])
    expect(result.domSummary?.headings).toHaveLength(12)
    expect(result.domSummary?.url).toBe("http://localhost:3000/x")
    expect(result.domSummary?.links).toEqual(["Callback -> /cb"])
    expect((result.domSummary?.textSample ?? "").length).toBeLessThanOrEqual(
      600,
    )
    expect(result.screenshot).toMatchObject({ width: 800, height: 600 })
    expect(
      result.screenshot?.dataUrl.startsWith("data:image/png;base64,"),
    ).toBe(true)
    const probeCodes = new Set(Object.values(LOCAL_BROWSER_DIAGNOSTIC_PROBES))
    expect(guest.executed.length).toBeGreaterThan(0)
    for (const [code, userGesture] of guest.executed) {
      expect(probeCodes.has(code)).toBe(true)
      expect(userGesture).toBe(false)
    }
  })

  test("a capture whose guest navigates or is replaced mid-flight is rejected as stale; foreign senders see no guest", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(94)
    const admission = await admitHttp(harness, embedder)
    const guest = attachGuest(harness, embedder, admission)
    guest.captureImpl = async () => {
      guest.emit("did-navigate", {}, "http://localhost:3000/elsewhere")
      return fakeImage(800, 600)
    }
    expect(
      await harness.policy.captureDiagnostics({ sender: embedder } as never, {
        generation: admission.generation,
      }),
    ).toEqual({ ok: false, code: "stale" })

    const other = harness.createAppWindow(95)
    expect(
      await harness.policy.captureDiagnostics({ sender: other } as never, {
        generation: admission.generation,
      }),
    ).toEqual({ ok: false, code: "no-guest" })
    expect(
      await harness.policy.captureDiagnostics({ sender: embedder } as never, {
        generation: admission.generation,
        extra: true,
      }),
    ).toEqual({ ok: false, code: "invalid-request" })
  })

  test("oversized or empty screenshots fail closed while the rest of the capture proceeds", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(96)
    const admission = await admitHttp(harness, embedder)
    const guest = attachGuest(harness, embedder, admission)
    for (const image of [
      fakeImage(5000, 600),
      fakeImage(800, 600, 9 * 1024 * 1024),
      { ...fakeImage(800, 600), isEmpty: () => true },
    ]) {
      guest.captureImpl = async () => image
      const result = await harness.policy.captureDiagnostics(
        { sender: embedder } as never,
        { generation: admission.generation },
      )
      expect(result).toMatchObject({ ok: true, screenshot: null })
    }
  })
})

describe("D7 file admission through the locus-preview broker (GP-05)", () => {
  let sandbox = ""

  beforeEach(() => {
    sandbox = realpathSync(mkdtempSync(join(tmpdir(), "locus-guest-owner-")))
  })
  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true })
  })

  function worktree() {
    const root = join(sandbox, "worktree")
    mkdirSync(join(root, "site", "assets"), { recursive: true })
    mkdirSync(join(root, "other"), { recursive: true })
    writeFileSync(
      join(root, "site", "index.html"),
      "<html><body>ok</body></html>",
    )
    writeFileSync(join(root, "site", "assets", "app.js"), "window.ok = 1")
    writeFileSync(join(root, "secret-parent.txt"), "PARENT-DIR-SECRET-7d1e")
    writeFileSync(join(root, "other", "private.txt"), "SIBLING-DIR-SECRET-3a9c")
    return root
  }

  test("an admitted file becomes a per-admission locus-preview origin with the document-directory scope visible", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(101)
    const root = worktree()
    harness.roots.set("chat-file", root)
    const admission = await harness.request(embedder, {
      chatId: "chat-file",
      url: `file://${root}/site/index.html`,
    })
    expect(admission.ok).toBe(true)
    if (!admission.ok) return
    expect(admission.kind).toBe("file")
    expect(admission.src).toMatch(
      /^locus-preview:\/\/[0-9a-f]{32}\.preview\.local\/index\.html$/,
    )
    expect(admission.src.startsWith("file:")).toBe(false)
    expect(admission.fileScope).toEqual({
      relativeDirectory: "site",
      isWorktreeRoot: false,
    })
    const session = harness.sessions.get(admission.partition) as FakeSession
    expect(session.calls.at(-1)).toBe("protocol.handle:locus-preview")
    expect(session.calls.indexOf("webRequest.onBeforeRequest")).toBeLessThan(
      session.calls.indexOf("protocol.handle:locus-preview"),
    )
    const handler = session.protocolHandlers.get("locus-preview")
    const host = new URL(admission.src).host
    const serve = async (path: string) =>
      handler?.({ url: `locus-preview://${host}${path}`, method: "GET" })

    const document = await serve("/index.html")
    expect(document?.status).toBe(200)
    expect(document?.headers.get("content-type")).toContain("text/html")
    expect(document?.headers.get("access-control-allow-origin")).toBeNull()
    expect(await document?.text()).toContain("ok")
    expect((await serve("/assets/app.js"))?.status).toBe(200)
    // The host root is the scope root: parent-directory and sibling files are
    // unreachable for every resource type.
    for (const path of [
      "/../secret-parent.txt",
      "/secret-parent.txt",
      "/../other/private.txt",
      "/%2e%2e/other/private.txt",
    ]) {
      const response = await serve(path)
      expect(response?.status).not.toBe(200)
      expect(await response?.text()).not.toContain("SECRET")
    }
    const otherHost = await handler?.({
      url: "locus-preview://ffffffffffffffffffffffffffffffff.preview.local/index.html",
      method: "GET",
    })
    expect(otherHost?.status).toBe(403)

    // Another admission's host is rejected by this Session's gate too.
    const second = await harness.request(embedder, {
      chatId: "chat-file-2",
      url: `file://${root}/site/index.html`,
    })
    expect(second.ok).toBe(false)
    harness.roots.set("chat-file-2", root)
    const other = await harness.request(embedder, {
      chatId: "chat-file-2",
      url: `file://${root}/site/index.html`,
    })
    if (!other.ok) throw new Error("second admission denied")
    expect(new URL(other.src).host).not.toBe(host)
    expect(
      session.request(
        `${other.src.replace("/index.html", "/assets/app.js")}`,
        "xhr",
      ),
    ).toBe(true)
  })

  test("a document at the worktree root makes the whole worktree the visible scope", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(102)
    const root = worktree()
    writeFileSync(join(root, "index.html"), "<html></html>")
    harness.roots.set("chat-root-doc", root)
    const admission = await harness.request(embedder, {
      chatId: "chat-root-doc",
      url: `file://${root}/index.html`,
    })
    expect(admission).toMatchObject({
      ok: true,
      fileScope: { relativeDirectory: "", isWorktreeRoot: true },
    })
  })

  test("win32 reports file preview disabled; HTTP(S) preview is unaffected", async () => {
    const harness = createHarness({ platform: "win32" })
    const embedder = harness.createAppWindow(103)
    const root = worktree()
    harness.roots.set("chat-win", root)
    expect(
      await harness.request(embedder, {
        chatId: "chat-win",
        url: `file://${root}/site/index.html`,
      }),
    ).toMatchObject({ ok: false, code: "file-preview-unsupported" })
    expect(
      (
        await harness.request(embedder, {
          chatId: "chat-win",
          url: "http://localhost:3000/",
        })
      ).ok,
    ).toBe(true)
  })

  test("a symlink registered root, a symlinked document and a missing document fail closed", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(104)
    const root = worktree()
    const linkRoot = join(sandbox, "root-link")
    symlinkSync(root, linkRoot, "dir")
    harness.roots.set("chat-link-root", linkRoot)
    expect(
      await harness.request(embedder, {
        chatId: "chat-link-root",
        url: `file://${linkRoot}/site/index.html`,
      }),
    ).toMatchObject({ ok: false, code: "file-root-unverifiable" })

    symlinkSync(
      join(root, "other", "private.txt"),
      join(root, "site", "linked.html"),
    )
    harness.roots.set("chat-link-doc", root)
    expect(
      await harness.request(embedder, {
        chatId: "chat-link-doc",
        url: `file://${root}/site/linked.html`,
      }),
    ).toMatchObject({ ok: false, code: "file-not-previewable" })
    expect(
      await harness.request(embedder, {
        chatId: "chat-link-doc",
        url: `file://${root}/site/missing.html`,
      }),
    ).toMatchObject({ ok: false, code: "file-not-previewable" })
  })

  test("a root with a symlinked parent prefix is canonicalized and served (positive control)", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(105)
    const root = worktree()
    const linkParent = join(sandbox, "link-parent")
    symlinkSync(sandbox, linkParent, "dir")
    const registered = join(linkParent, "worktree")
    harness.roots.set("chat-prefix", registered)
    const admission = await harness.request(embedder, {
      chatId: "chat-prefix",
      url: `file://${registered}/site/index.html`,
    })
    expect(admission.ok).toBe(true)
    if (!admission.ok) return
    const session = harness.sessions.get(admission.partition) as FakeSession
    const response = await session.protocolHandlers.get("locus-preview")?.({
      url: admission.src,
      method: "GET",
    })
    expect(response?.status).toBe(200)
    void root
  })

  test("the preview handler rejects stale bindings after teardown", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(106)
    const root = worktree()
    harness.roots.set("chat-stale", root)
    const admission = await harness.request(embedder, {
      chatId: "chat-stale",
      url: `file://${root}/site/index.html`,
    })
    if (!admission.ok) throw new Error("denied")
    const guest = attachGuest(harness, embedder, admission)
    guest.emit("did-navigate", {}, "data:text/html,x")
    const session = harness.sessions.get(admission.partition) as FakeSession
    const response = await session.protocolHandlers.get("locus-preview")?.({
      url: admission.src,
      method: "GET",
    })
    expect(response?.status).toBe(403)
  })
})

describe("D6 admission through the real window registry", () => {
  test("claimChat on windowManager: acquire, same-window idempotence, other live owner denied, stale owner re-acquired", async () => {
    const { windowManager } = await import("../src/main/windows/window-manager")
    const makeWindow = (id: number) => {
      let destroyed = false
      return {
        id,
        webContents: { id: id + 5000 },
        on() {},
        isDestroyed: () => destroyed,
        destroy() {
          destroyed = true
        },
      }
    }
    const windowA = makeWindow(7101)
    const windowB = makeWindow(7102)
    windowManager.register(windowA as never)
    windowManager.register(windowB as never)
    const harness = createHarness({
      claimChat: (chatId, windowId) =>
        windowManager.claimChat(chatId, windowId),
      isLiveAppWindow: (windowId) => {
        const window = windowManager.get(windowId)
        return Boolean(window && !window.isDestroyed())
      },
    })
    const embedderA = harness.createAppWindow(windowA.id)
    const embedderB = harness.createAppWindow(windowB.id)
    harness.roots.set("chat-real", "/registered/worktree")
    const url = "http://localhost:3000/"
    expect(
      (await harness.request(embedderA, { chatId: "chat-real", url })).ok,
    ).toBe(true)
    expect(
      (await harness.request(embedderA, { chatId: "chat-real", url })).ok,
    ).toBe(true)
    expect(
      await harness.request(embedderB, { chatId: "chat-real", url }),
    ).toMatchObject({
      ok: false,
      code: "chat-owned-elsewhere",
    })
    windowA.destroy()
    expect(
      (await harness.request(embedderB, { chatId: "chat-real", url })).ok,
    ).toBe(true)
    expect(windowManager.getChatOwner("chat-real")).toBe(windowB.id)
  })
})

describe("GP-03 guest cannot reach the narrow privileged operations (doubles; runtime global absence is 5.2)", () => {
  test("a guest webContents is not an app window: admission and capture IPC from it are refused and no nested webview can attach", async () => {
    const harness = createHarness()
    const embedder = harness.createAppWindow(111)
    const admission = await admitHttp(harness, embedder)
    const guest = attachGuest(harness, embedder, admission)
    harness.roots.set("chat-from-guest", "/registered/worktree")
    expect(
      await harness.request(guest, {
        chatId: "chat-from-guest",
        url: "http://localhost:3000/",
      }),
    ).toMatchObject({ ok: false, code: "sender-not-app-window" })
    expect(
      await harness.policy.captureDiagnostics({ sender: guest } as never, {
        generation: admission.generation,
      }),
    ).toEqual({ ok: false, code: "no-guest" })
    const nested = willAttach(guest, {
      src: "http://localhost:3000/",
      partition: "locus-guest-nested",
    })
    expect(nested.event.defaultPrevented).toBe(true)
    // Effective guest preferences carry no preload/bridge and the Session had
    // zero registered preload scripts before the partition was returned.
    const session = harness.sessions.get(admission.partition) as FakeSession
    expect(session.calls[0]).toBe("getPreloadScripts")
  })
})
