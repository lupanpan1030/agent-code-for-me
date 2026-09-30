/**
 * Implementation tests (task 4.8, GP-01/02/04/06/07/08) for the pure,
 * injectable decisions exported by the sole guest-policy owner
 * `src/main/windows/local-browser-guest-policy.ts`.
 *
 * These are double-free verdict tables. They do not claim runtime Electron
 * observations (real webRequest interception per resource type/redirect hop,
 * custom-scheme gate observability, OS prompts); those are GUI tracks
 * 5.2/5.3.
 */
import { describe, expect, test } from "bun:test"
import {
  decideCommittedGuestUrl,
  decideGuestNavigation,
  decideGuestPermission,
  decideGuestRequest,
  decideGuestWindowOpen,
  decodePreviewPathSegments,
  enforceGuestWebPreferences,
  type GuestLifecycleEvent,
  type GuestLifecycleState,
  type GuestOriginPolicy,
  guestLifecycleHasAuthority,
  guestPreferencesAreSecure,
  LOCAL_BROWSER_GUEST_DENIED_PERMISSIONS,
  LOCAL_BROWSER_GUEST_WEB_PREFERENCES,
  LOCUS_PREVIEW_PRIVILEGES,
  LocalBrowserAdmissionRegistry,
  nextGuestLifecycleState,
  unsafeWebviewAttributes,
} from "../src/main/windows/local-browser-guest-policy"

const HTTP_POLICY: GuestOriginPolicy = {
  kind: "http",
  origin: "http://localhost:3000",
}
const FILE_HOST = "0123456789abcdef0123456789abcdef.preview.local"
const FILE_POLICY: GuestOriginPolicy = {
  kind: "file",
  host: FILE_HOST,
  documentSegments: ["index.html"],
}
const OTHER_FILE_HOST = "fedcba9876543210fedcba9876543210.preview.local"

const RESOURCE_TYPES = [
  "mainFrame",
  "subFrame",
  "xhr",
  "script",
  "image",
  "stylesheet",
  "font",
  "media",
  "object",
  "ping",
  "other",
] as const

const EXTERNAL_SCHEMES = [
  "locus://mcp-import?payload=abc",
  "locus-dev://mcp-import?payload=abc",
  "agent-code-for-me://mcp-import?payload=abc",
  "agent-code-for-me-dev://mcp-import?payload=abc",
  "mailto:someone@example.com",
  "vscode://file/etc/passwd",
] as const

describe("D5 effective guest preferences", () => {
  test("hostile supplied preferences are forced to the exact secure set", () => {
    const supplied: Record<string, unknown> = {
      preload: "file:///evil/preload.js",
      preloadURL: "file:///evil/preload.js",
      additionalArguments: ["--inject"],
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true,
      nodeIntegrationInWorker: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      webviewTag: true,
      disablePopups: false,
      experimentalFeatures: true,
      enableBlinkFeatures: "SomethingDangerous",
      plugins: true,
      partition: "persist:main",
    }
    const overridden = enforceGuestWebPreferences(supplied, "locus-guest-abc")
    expect(supplied).toEqual({
      ...LOCAL_BROWSER_GUEST_WEB_PREFERENCES,
      additionalArguments: [],
      partition: "locus-guest-abc",
    })
    expect("preload" in supplied).toBe(false)
    expect("preloadURL" in supplied).toBe(false)
    expect("enableBlinkFeatures" in supplied).toBe(false)
    expect(overridden).toEqual(
      expect.arrayContaining([
        "preload",
        "preloadURL",
        "additionalArguments",
        "nodeIntegration",
        "contextIsolation",
        "sandbox",
        "webSecurity",
        "webviewTag",
      ]),
    )
    expect(guestPreferencesAreSecure(supplied)).toBe(true)
  })

  test("sandbox and context isolation are forced explicitly even when the embedder supplied nothing", () => {
    const supplied: Record<string, unknown> = {}
    enforceGuestWebPreferences(supplied, "locus-guest-x")
    expect(supplied.sandbox).toBe(true)
    expect(supplied.contextIsolation).toBe(true)
    expect(supplied.nodeIntegration).toBe(false)
    expect(supplied.webviewTag).toBe(false)
    expect(supplied.additionalArguments).toEqual([])
  })

  test("post-attach verification rejects any effective weakening", () => {
    const secure = { ...LOCAL_BROWSER_GUEST_WEB_PREFERENCES }
    expect(guestPreferencesAreSecure(secure)).toBe(true)
    expect(guestPreferencesAreSecure(null)).toBe(false)
    for (const weakening of [
      { sandbox: false },
      { contextIsolation: false },
      { nodeIntegration: true },
      { nodeIntegrationInWorker: true },
      { webSecurity: false },
      { webviewTag: true },
      { preload: "/x.js" },
      { additionalArguments: ["--x"] },
    ]) {
      expect(guestPreferencesAreSecure({ ...secure, ...weakening })).toBe(false)
    }
  })

  test("unsafe <webview> attributes are named, safe/false values are not", () => {
    expect(
      unsafeWebviewAttributes({
        src: "http://localhost:3000/",
        partition: "locus-guest-a",
        preload: "file:///evil.js",
        nodeintegration: true,
        allowpopups: true,
        disablewebsecurity: "",
        webpreferences: "contextIsolation=no",
        plugins: false,
      }).sort(),
    ).toEqual(["allowpopups", "nodeintegration", "preload", "webpreferences"])
    expect(
      unsafeWebviewAttributes({
        src: "http://localhost:3000/",
        partition: "locus-guest-a",
        nodeintegration: false,
        allowpopups: false,
        preload: "",
      }),
    ).toEqual([])
  })

  test("locus-preview privileges are exactly D7's set", () => {
    expect(LOCUS_PREVIEW_PRIVILEGES).toEqual({
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: false,
      allowServiceWorkers: false,
      stream: false,
      codeCache: false,
    })
  })
})

function createRegistry(
  overrides: Partial<{
    ttlMs: number
    maxActive: number
    maxIssued: number
    tokens: string[]
  }> = {},
) {
  let clock = 10_000
  let counter = 0
  const tokens = overrides.tokens ? [...overrides.tokens] : null
  const registry = new LocalBrowserAdmissionRegistry({
    now: () => clock,
    randomToken: () => {
      const next = tokens?.shift()
      if (next) return next
      counter += 1
      return counter.toString(16).padStart(64, "0")
    },
    ttlMs: overrides.ttlMs ?? 30_000,
    maxActive: overrides.maxActive ?? 8,
    maxIssued: overrides.maxIssued ?? 512,
  })
  return {
    registry,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

function issueHttp(
  registry: LocalBrowserAdmissionRegistry,
  input: Partial<{ embedderId: number; chatId: string; src: string }> = {},
) {
  const src = input.src ?? "http://localhost:3000/"
  const result = registry.issue({
    embedderId: input.embedderId ?? 1,
    chatId: input.chatId ?? "chat-a",
    initialSrc: src,
    displayUrl: src,
    kind: "http",
    policy: HTTP_POLICY,
    fileScope: null,
  })
  if (!result.ok) throw new Error("issue failed")
  return result
}

describe("D6 one-shot admission registry (GP-02)", () => {
  test("an exact admission is consumed once; replay and reattach are rejected", () => {
    const { registry } = createRegistry()
    const { admission } = issueHttp(registry)
    expect(admission.partition.startsWith("locus-guest-")).toBe(true)
    expect(admission.partition).not.toContain("chat-a")
    expect(admission.partition.startsWith("persist:")).toBe(false)

    const first = registry.beginAttach({
      embedderId: 1,
      partition: admission.partition,
      src: admission.initialSrc,
    })
    expect(first.ok).toBe(true)
    expect(registry.completeAttach(admission, 1, 77)).toBe(true)
    expect(admission.state).toBe("attached")

    const replay = registry.beginAttach({
      embedderId: 1,
      partition: admission.partition,
      src: admission.initialSrc,
    })
    expect(replay).toMatchObject({ ok: false, reason: "replayed" })

    registry.transition(admission, "teardown-begin")
    registry.transition(admission, "destroy-confirmed")
    const revival = registry.beginAttach({
      embedderId: 1,
      partition: admission.partition,
      src: admission.initialSrc,
    })
    expect(revival).toMatchObject({ ok: false, reason: "revoked" })
  })

  test("unknown, default, persistent and persist:main partitions are rejected", () => {
    const { registry } = createRegistry()
    issueHttp(registry)
    for (const partition of [
      undefined,
      "",
      "persist:main",
      "persist:locus-guest-x",
      "local-browser-default",
      "locus-guest-not-issued",
    ]) {
      const verdict = registry.beginAttach({
        embedderId: 1,
        partition,
        src: "http://localhost:3000/",
      })
      expect(verdict.ok).toBe(false)
    }
  })

  test("cross-embedder reuse and a different initial src fail closed and revoke the admission", () => {
    const { registry } = createRegistry()
    const crossEmbedder = issueHttp(registry, { chatId: "chat-1" }).admission
    expect(
      registry.beginAttach({
        embedderId: 2,
        partition: crossEmbedder.partition,
        src: crossEmbedder.initialSrc,
      }),
    ).toMatchObject({ ok: false, reason: "embedder-mismatch" })
    expect(guestLifecycleHasAuthority(crossEmbedder.state)).toBe(false)

    const srcMismatch = issueHttp(registry, { chatId: "chat-2" }).admission
    expect(
      registry.beginAttach({
        embedderId: 1,
        partition: srcMismatch.partition,
        src: "http://localhost:4000/",
      }),
    ).toMatchObject({ ok: false, reason: "src-mismatch" })
    expect(guestLifecycleHasAuthority(srcMismatch.state)).toBe(false)
  })

  test("pending admissions expire after the short TTL", () => {
    const { registry, advance } = createRegistry({ ttlMs: 1_000 })
    const { admission } = issueHttp(registry)
    advance(1_001)
    expect(
      registry.beginAttach({
        embedderId: 1,
        partition: admission.partition,
        src: admission.initialSrc,
      }),
    ).toMatchObject({ ok: false, reason: "expired" })
    const swept = createRegistry({ ttlMs: 1_000 })
    const pending = issueHttp(swept.registry).admission
    swept.advance(1_500)
    expect(swept.registry.sweepExpired()).toEqual([pending])
    expect(pending.state).toBe("revoked")
  })

  test("a new generation for the same embedder and chat supersedes the old one; every mount gets a fresh generation", () => {
    const { registry } = createRegistry()
    const first = issueHttp(registry).admission
    // StrictMode double mount / remount: a second request for the same chat.
    const second = issueHttp(registry)
    expect(second.superseded).toEqual([first])
    expect(second.admission.generation).toBeGreaterThan(first.generation)
    expect(second.admission.partition).not.toBe(first.partition)
    expect(guestLifecycleHasAuthority(first.state)).toBe(false)
    expect(
      registry.beginAttach({
        embedderId: 1,
        partition: first.partition,
        src: first.initialSrc,
      }).ok,
    ).toBe(false)
    // Another chat or embedder is not superseded.
    const otherChat = issueHttp(registry, { chatId: "chat-b" })
    expect(otherChat.superseded).toEqual([])
  })

  test("active and cumulative caps fail closed instead of sharing a Session", () => {
    const active = createRegistry({ maxActive: 2 }).registry
    issueHttp(active, { chatId: "a" })
    issueHttp(active, { chatId: "b" })
    expect(
      active.issue({
        embedderId: 1,
        chatId: "c",
        initialSrc: "http://localhost:3000/",
        displayUrl: "http://localhost:3000/",
        kind: "http",
        policy: HTTP_POLICY,
        fileScope: null,
      }),
    ).toMatchObject({ ok: false, code: "capacity" })

    const cumulative = createRegistry({ maxIssued: 2 }).registry
    issueHttp(cumulative, { chatId: "a" })
    issueHttp(cumulative, { chatId: "a" })
    expect(cumulative.issuedCount).toBe(2)
    expect(
      cumulative.issue({
        embedderId: 1,
        chatId: "a",
        initialSrc: "http://localhost:3000/",
        displayUrl: "http://localhost:3000/",
        kind: "http",
        policy: HTTP_POLICY,
        fileScope: null,
      }),
    ).toMatchObject({ ok: false, code: "capacity" })
  })

  test("partition identity is never reused, even when the token source repeats", () => {
    const repeated = "a".repeat(64)
    const { registry } = createRegistry({
      tokens: [repeated, repeated, "b".repeat(64)],
    })
    const first = issueHttp(registry, { chatId: "x" }).admission
    const second = issueHttp(registry, { chatId: "y" }).admission
    expect(first.partition).toBe(`locus-guest-${repeated}`)
    expect(second.partition).toBe(`locus-guest-${"b".repeat(64)}`)
  })
})

describe("D5/D6 teardown state machine (GP-08)", () => {
  const states: GuestLifecycleState[] = [
    "pending",
    "attaching",
    "attached",
    "tearing-down",
    "teardown-unconfirmed",
    "destroyed",
    "revoked",
  ]
  const events: GuestLifecycleEvent[] = [
    "attach-begin",
    "attach-complete",
    "teardown-begin",
    "destroy-confirmed",
    "destroy-unconfirmed",
    "revoke",
  ]

  test("authority is invalidated immediately when teardown begins, before destruction is confirmed", () => {
    expect(nextGuestLifecycleState("attached", "teardown-begin")).toBe(
      "tearing-down",
    )
    expect(guestLifecycleHasAuthority("tearing-down")).toBe(false)
    expect(nextGuestLifecycleState("tearing-down", "destroy-unconfirmed")).toBe(
      "teardown-unconfirmed",
    )
    expect(
      nextGuestLifecycleState("teardown-unconfirmed", "destroy-confirmed"),
    ).toBe("destroyed")
  })

  test("no event revives a terminal or unconfirmed state", () => {
    for (const terminal of [
      "tearing-down",
      "teardown-unconfirmed",
      "destroyed",
      "revoked",
    ] as const) {
      for (const event of events) {
        expect(
          guestLifecycleHasAuthority(nextGuestLifecycleState(terminal, event)),
        ).toBe(false)
      }
    }
  })

  test("only pending/attaching/attached carry authority", () => {
    expect(states.filter(guestLifecycleHasAuthority)).toEqual([
      "pending",
      "attaching",
      "attached",
    ])
  })
})

describe("D7 Session request gate (GP-04/GP-05 verdicts)", () => {
  test("direct file: is cancelled for every resource type on both admission kinds", () => {
    for (const policy of [HTTP_POLICY, FILE_POLICY]) {
      for (const resourceType of RESOURCE_TYPES) {
        expect(
          decideGuestRequest(policy, true, {
            url: "file:///etc/passwd",
            resourceType,
          }),
        ).toEqual({ cancel: true, reason: "direct-file" })
      }
    }
  })

  test("HTTP(S) admission: exact origin including port for every top-level request (initial, link, location, loadURL, back/forward, redirect hop)", () => {
    const allowed = [
      "http://localhost:3000/",
      "http://localhost:3000/dashboard?tab=1#x",
    ]
    for (const url of allowed) {
      expect(
        decideGuestRequest(HTTP_POLICY, true, {
          url,
          resourceType: "mainFrame",
        }),
      ).toEqual({ cancel: false })
    }
    const denied = [
      "http://localhost:3001/",
      "https://localhost:3000/",
      "http://127.0.0.1:3000/",
      "http://[::1]:3000/",
      "https://example.com/",
      // 3xx hop to another loopback port: each hop is a new mainFrame request.
      "http://localhost:21321/callback?state=x",
    ]
    for (const url of denied) {
      expect(
        decideGuestRequest(HTTP_POLICY, true, {
          url,
          resourceType: "mainFrame",
        }),
      ).toEqual({ cancel: true, reason: "top-level-origin" })
    }
    expect(
      decideGuestRequest(HTTP_POLICY, true, {
        url: "http://user:pw@localhost:3000/",
        resourceType: "mainFrame",
      }),
    ).toEqual({ cancel: true, reason: "credentials" })
  })

  test("HTTP(S)-admitted Sessions cancel locus-preview for every resource type", () => {
    for (const resourceType of RESOURCE_TYPES) {
      expect(
        decideGuestRequest(HTTP_POLICY, true, {
          url: `locus-preview://${FILE_HOST}/index.html`,
          resourceType,
        }),
      ).toEqual({ cancel: true, reason: "preview-scheme-on-http-session" })
    }
  })

  test("file admission: the admitted document is the only top-level target; in-scope assets pass; other hosts and ambiguous paths fail for every type", () => {
    expect(
      decideGuestRequest(FILE_POLICY, true, {
        url: `locus-preview://${FILE_HOST}/index.html`,
        resourceType: "mainFrame",
      }),
    ).toEqual({ cancel: false })
    expect(
      decideGuestRequest(FILE_POLICY, true, {
        url: `locus-preview://${FILE_HOST}/other.html`,
        resourceType: "mainFrame",
      }),
    ).toEqual({ cancel: true, reason: "document-mismatch" })
    for (const resourceType of ["xhr", "script", "subFrame", "image"]) {
      expect(
        decideGuestRequest(FILE_POLICY, true, {
          url: `locus-preview://${FILE_HOST}/assets/app.js`,
          resourceType,
        }),
      ).toEqual({ cancel: false })
    }
    for (const resourceType of RESOURCE_TYPES) {
      expect(
        decideGuestRequest(FILE_POLICY, true, {
          url: `locus-preview://${OTHER_FILE_HOST}/index.html`,
          resourceType,
        }),
      ).toEqual({ cancel: true, reason: "other-preview-host" })
      expect(
        decideGuestRequest(FILE_POLICY, true, {
          url: `locus-preview://${FILE_HOST}/assets%2F..%2F..%2Fsecret-parent.txt`,
          resourceType,
        }).cancel,
      ).toBe(true)
    }
    expect(
      decideGuestRequest(FILE_POLICY, true, {
        url: "http://localhost:3000/",
        resourceType: "mainFrame",
      }),
    ).toEqual({ cancel: true, reason: "top-level-origin" })
  })

  test("accepted residual: HTTP(S)/WebSocket subresource egress passes and is not labeled blocked", () => {
    for (const policy of [HTTP_POLICY, FILE_POLICY]) {
      for (const [url, resourceType] of [
        ["https://remote.example/beacon", "image"],
        ["http://localhost:21321/", "xhr"],
        ["http://127.0.0.1:8914/callback", "xhr"],
        ["https://remote.example/frame", "subFrame"],
        ["ws://localhost:3000/hmr", "webSocket"],
      ] as const) {
        expect(decideGuestRequest(policy, true, { url, resourceType })).toEqual(
          {
            cancel: false,
          },
        )
      }
    }
  })

  test("other observable schemes fail closed; there is no allow-unknown branch", () => {
    for (const url of [
      "ftp://localhost/file",
      "chrome://settings",
      "devtools://devtools/bundled/inspector.html",
      "data:text/html,<script>1</script>",
      "blob:http://localhost:3000/uuid",
      "locus://mcp-import?payload=x",
      "not a url",
    ]) {
      expect(
        decideGuestRequest(HTTP_POLICY, true, {
          url,
          resourceType: "mainFrame",
        }).cancel,
      ).toBe(true)
      expect(
        decideGuestRequest(HTTP_POLICY, true, { url, resourceType: "xhr" })
          .cancel,
      ).toBe(true)
    }
  })

  test("a revoked admission cancels everything, including previously allowed traffic", () => {
    expect(
      decideGuestRequest(HTTP_POLICY, false, {
        url: "http://localhost:3000/",
        resourceType: "mainFrame",
      }),
    ).toEqual({ cancel: true, reason: "revoked" })
    expect(
      decideGuestRequest(FILE_POLICY, false, {
        url: `locus-preview://${FILE_HOST}/assets/app.js`,
        resourceType: "script",
      }),
    ).toEqual({ cancel: true, reason: "revoked" })
  })
})

describe("D7/D8 guest navigation handlers (GP-04/GP-06)", () => {
  test("top-level external-protocol targets are denied (no OS handler, no mcp-import preview)", () => {
    for (const url of EXTERNAL_SCHEMES) {
      for (const policy of [HTTP_POLICY, FILE_POLICY]) {
        const verdict = decideGuestNavigation(policy, true, {
          url,
          isMainFrame: true,
        })
        expect(verdict).toEqual({ allow: false, reason: "external-scheme" })
        const subframe = decideGuestNavigation(policy, true, {
          url,
          isMainFrame: false,
        })
        expect(subframe.allow).toBe(false)
      }
    }
  })

  test("non-network top-level schemes (about/data/blob/javascript) are denied by the navigation handlers", () => {
    for (const url of [
      "javascript:alert(1)",
      "about:blank",
      "data:text/html,hi",
      "blob:http://localhost:3000/uuid",
    ]) {
      expect(
        decideGuestNavigation(HTTP_POLICY, true, { url, isMainFrame: true }),
      ).toEqual({ allow: false, reason: "non-admitted-commit" })
    }
  })

  test("top-level remote, other-port and credentialed targets are denied; same-origin paths are allowed", () => {
    expect(
      decideGuestNavigation(HTTP_POLICY, true, {
        url: "http://localhost:3000/next",
        isMainFrame: true,
      }),
    ).toEqual({ allow: true })
    for (const url of [
      "https://example.com/",
      "http://localhost:5173/",
      "http://user:pw@localhost:3000/",
      "file:///etc/passwd",
    ]) {
      expect(
        decideGuestNavigation(HTTP_POLICY, true, { url, isMainFrame: true })
          .allow,
      ).toBe(false)
    }
  })

  test("file admission: following a top-level link, even in scope, needs a fresh admission", () => {
    expect(
      decideGuestNavigation(FILE_POLICY, true, {
        url: `locus-preview://${FILE_HOST}/index.html#section`,
        isMainFrame: true,
      }),
    ).toEqual({ allow: true })
    expect(
      decideGuestNavigation(FILE_POLICY, true, {
        url: `locus-preview://${FILE_HOST}/about.html`,
        isMainFrame: true,
      }),
    ).toEqual({ allow: false, reason: "document-mismatch" })
  })

  test("subframes keep the accepted frame residual but never reach file:, another preview host or an external scheme", () => {
    for (const url of [
      "https://remote.example/embed",
      "about:blank",
      "about:srcdoc",
      "data:text/html,frame",
      "javascript:void(0)",
    ]) {
      expect(
        decideGuestNavigation(HTTP_POLICY, true, { url, isMainFrame: false }),
      ).toEqual({ allow: true })
    }
    expect(
      decideGuestNavigation(FILE_POLICY, true, {
        url: `locus-preview://${FILE_HOST}/other/private.txt`,
        isMainFrame: false,
      }),
    ).toEqual({ allow: true })
    expect(
      decideGuestNavigation(FILE_POLICY, true, {
        url: `locus-preview://${OTHER_FILE_HOST}/index.html`,
        isMainFrame: false,
      }),
    ).toEqual({ allow: false, reason: "other-preview-host" })
    expect(
      decideGuestNavigation(HTTP_POLICY, true, {
        url: "file:///etc/passwd",
        isMainFrame: false,
      }),
    ).toEqual({ allow: false, reason: "direct-file" })
  })

  test("window.open / _blank is always denied without forwarding to the OS", () => {
    expect(decideGuestWindowOpen()).toEqual({ action: "deny" })
  })
})

describe("D7 committed-URL postcondition owner (non-network schemes)", () => {
  test("only a browser-created initial about:blank is permitted", () => {
    expect(
      decideCommittedGuestUrl(HTTP_POLICY, {
        url: "about:blank",
        isInitialDocument: true,
        isSameDocument: false,
      }),
    ).toEqual({ allow: true })
    expect(
      decideCommittedGuestUrl(HTTP_POLICY, {
        url: "about:blank",
        isInitialDocument: false,
        isSameDocument: false,
      }).allow,
    ).toBe(false)
    expect(
      decideCommittedGuestUrl(HTTP_POLICY, {
        url: "about:srcdoc",
        isInitialDocument: true,
        isSameDocument: false,
      }).allow,
    ).toBe(false)
  })

  test("blob: documents are permitted only when their creator origin equals the exact admission", () => {
    expect(
      decideCommittedGuestUrl(HTTP_POLICY, {
        url: "blob:http://localhost:3000/5b0c",
        isInitialDocument: false,
        isSameDocument: false,
      }),
    ).toEqual({ allow: true })
    for (const url of [
      "blob:http://localhost:3001/5b0c",
      "blob:https://example.com/5b0c",
      "blob:null/5b0c",
    ]) {
      expect(
        decideCommittedGuestUrl(HTTP_POLICY, {
          url,
          isInitialDocument: false,
          isSameDocument: false,
        }).allow,
      ).toBe(false)
    }
    expect(
      decideCommittedGuestUrl(FILE_POLICY, {
        url: `blob:locus-preview://${FILE_HOST}/5b0c`,
        isInitialDocument: false,
        isSameDocument: false,
      }),
    ).toEqual({ allow: true })
    expect(
      decideCommittedGuestUrl(FILE_POLICY, {
        url: `blob:locus-preview://${OTHER_FILE_HOST}/5b0c`,
        isInitialDocument: false,
        isSameDocument: false,
      }).allow,
    ).toBe(false)
  })

  test("data:, javascript: and other non-admitted commits destroy the guest", () => {
    for (const url of [
      "data:text/html,<h1>x</h1>",
      "javascript:alert(1)",
      "chrome-error://chromewebdata/",
      "https://example.com/",
      "locus://mcp-import",
    ]) {
      expect(
        decideCommittedGuestUrl(HTTP_POLICY, {
          url,
          isInitialDocument: false,
          isSameDocument: false,
        }).allow,
      ).toBe(false)
    }
  })

  test("file admission: in-page navigation stays; a different document commit is rejected", () => {
    expect(
      decideCommittedGuestUrl(FILE_POLICY, {
        url: `locus-preview://${FILE_HOST}/somewhere-else`,
        isInitialDocument: false,
        isSameDocument: true,
      }),
    ).toEqual({ allow: true })
    expect(
      decideCommittedGuestUrl(FILE_POLICY, {
        url: `locus-preview://${FILE_HOST}/other.html`,
        isInitialDocument: false,
        isSameDocument: false,
      }),
    ).toEqual({ allow: false, reason: "document-mismatch" })
  })
})

describe("D8 permission verdicts (GP-07)", () => {
  test("every named and unknown permission is denied, explicitly including openExternal", () => {
    expect(LOCAL_BROWSER_GUEST_DENIED_PERMISSIONS).toContain("openExternal")
    for (const permission of [
      ...LOCAL_BROWSER_GUEST_DENIED_PERMISSIONS,
      "some-future-permission",
      "",
    ]) {
      expect(decideGuestPermission(permission)).toBe(false)
    }
  })
})

describe("locus-preview path decoding", () => {
  test("single unambiguous components only", () => {
    expect(decodePreviewPathSegments("/index.html")).toEqual(["index.html"])
    expect(decodePreviewPathSegments("/assets/app.js")).toEqual([
      "assets",
      "app.js",
    ])
    expect(decodePreviewPathSegments("/a%20b.html")).toEqual(["a b.html"])
    expect(decodePreviewPathSegments("/assets/")).toEqual(["assets", ""])
    for (const ambiguous of [
      "/a%2Fb",
      "/a%5Cb",
      "/a%00b",
      "/%2e%2e/secret",
      "/./x",
      "//x",
      "/%E0%A4%A",
      "/a\\b",
      "relative",
    ]) {
      expect(decodePreviewPathSegments(ambiguous)).toBeNull()
    }
  })
})
