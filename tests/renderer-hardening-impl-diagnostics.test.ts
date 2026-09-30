/**
 * Implementation tests (task 4.7/4.8, GP-09) for the shared diagnostics
 * shape/minimization adapter `src/shared/local-browser-diagnostics-policy.ts`
 * composed with the canonical main redaction owner
 * `src/main/lib/agent-runtime/redaction.ts`.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  redactRuntimePayload,
  redactUntrustedDiagnosticPayload,
} from "../src/main/lib/agent-runtime/redaction"
import {
  isAcceptableLocalBrowserScreenshot,
  LOCAL_BROWSER_DIAGNOSTIC_LIMITS,
  LOCAL_BROWSER_SCREENSHOT_LIMITS,
  mapLocalBrowserConsoleLevel,
  minimizeLocalBrowserOrigin,
  minimizeLocalBrowserUrl,
  shapeLocalBrowserConsoleMessage,
  shapeLocalBrowserDisplayUrl,
  shapeLocalBrowserDomSummary,
  shapeLocalBrowserLoadFailure,
  shapeLocalBrowserSelectedElement,
  shapeLocalBrowserText,
  shapeLocalBrowserTitle,
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
const SECRETS = Object.entries(fixture.secrets)
  .filter(([name]) => name !== "pageTitle")
  .map(([, value]) => value)

/** The main-composed redactor, exactly as the guest-policy owner builds it. */
const redact = (text: string) => {
  const result = redactUntrustedDiagnosticPayload(text, [])
  return typeof result.payload === "string" ? result.payload : ""
}
const identity = (text: string) => text
const TIMESTAMP = "2026-09-30T00:00:00.000Z"

function leaked(value: unknown): string[] {
  const text = JSON.stringify(value)
  return SECRETS.filter((secret) => text.includes(secret))
}

describe("URL minimization drops credentials, query and fragment", () => {
  test("hierarchical, opaque and relative forms", () => {
    expect(
      minimizeLocalBrowserUrl(
        "http://user:guestpw-Q7x9Lm2Vn4@localhost:3000/next?access_token=querytok-Z3k8Pw1Rt6Yh#fragsecret-B5n2Kd8Wq1",
      ),
    ).toBe("http://localhost:3000/next")
    expect(minimizeLocalBrowserUrl("javascript:alert(document.cookie)")).toBe(
      "javascript:",
    )
    expect(minimizeLocalBrowserUrl("data:text/html;base64,AAAA")).toBe("data:")
    expect(minimizeLocalBrowserUrl("/cb?code=x#y")).toBe("/cb")
    expect(minimizeLocalBrowserUrl(42)).toBe("")
    expect(minimizeLocalBrowserOrigin("http://u:p@localhost:3000/a?b#c")).toBe(
      "http://localhost:3000",
    )
    expect(minimizeLocalBrowserOrigin("mailto:a@example.com")).toBe("mailto:")
  })

  test("URLs embedded in free text are minimized before redaction", () => {
    const shaped = shapeLocalBrowserText(
      "GET http://localhost:3000/cb?code=oauthcode-H4j7Fs2Lp9&state=oauthstate-M1c6Tv3Xz8 404",
      identity,
      600,
    )
    expect(shaped).toBe("GET http://localhost:3000/cb 404")
  })
})

describe("fixture payloads through shape + main redaction", () => {
  test("console message: provider patterns redacted, source URL minimized, level mapped", () => {
    const raw = fixture.events.consoleMessage as Record<string, unknown>
    const shaped = shapeLocalBrowserConsoleMessage(
      {
        level: raw.level,
        message: raw.message,
        sourceId: raw.sourceId,
        lineNumber: raw.line,
      },
      redact,
      TIMESTAMP,
    )
    expect(leaked(shaped)).toEqual([])
    expect(shaped).toMatchObject({
      level: "error",
      source: "http://localhost:3000/app.js",
      line: 42,
      timestamp: TIMESTAMP,
    })
    expect(shaped?.text).toContain("<redacted>")
  })

  test("load failure keeps only the minimized URL, net-error token and code", () => {
    const raw = fixture.events.didFailLoad as Record<string, unknown>
    const shaped = shapeLocalBrowserLoadFailure(
      {
        errorCode: raw.errorCode,
        errorDescription: raw.errorDescription,
        validatedURL: raw.validatedURL,
      },
      redact,
      TIMESTAMP,
    )
    expect(shaped).toEqual({
      url: "http://localhost:3000/callback",
      reason: "ERR_NAME_NOT_RESOLVED",
      code: -105,
      timestamp: TIMESTAMP,
    })
    expect(
      shapeLocalBrowserLoadFailure(
        {
          errorCode: "x",
          errorDescription: "oauth state=abc",
          validatedURL: 1,
        },
        redact,
        TIMESTAMP,
      ),
    ).toEqual({ url: "", reason: "Load failed", timestamp: TIMESTAMP })
  })

  test("navigation display URLs never carry credentials, query or fragment", () => {
    for (const name of [
      "willNavigateSameOrigin",
      "didNavigateSameOrigin",
      "didNavigateInPage",
    ]) {
      const url = (fixture.events[name] as { url: string }).url
      const shaped = shapeLocalBrowserDisplayUrl(url, redact)
      expect(leaked(shaped)).toEqual([])
      expect(shaped).not.toContain("?")
      expect(shaped).not.toContain("#")
      expect(shaped).not.toContain("@")
    }
  })

  test("DOM summary and selected element are re-validated, redacted and bounded", () => {
    const summary = shapeLocalBrowserDomSummary(
      {
        title: `Token ${fixture.secrets.providerKey}`,
        url: "http://localhost:3000/p?access_token=querytok-Z3k8Pw1Rt6Yh",
        activeElement: { not: "a string" },
        headings: [...Array.from({ length: 30 }, (_, i) => `H${i}`), 7, null],
        buttons: "not-an-array",
        links: [
          { label: "Home", href: "/?code=oauthcode-H4j7Fs2Lp9" },
          { label: "", href: "https://u:guestpw-Q7x9Lm2Vn4@example.com/x#y" },
          "bare string",
        ],
        inputs: [`api_key=${fixture.secrets.apiKeyParam}`],
        textSample: "y".repeat(10_000),
      },
      redact,
    )
    expect(leaked(summary)).toEqual([])
    expect(summary?.headings).toHaveLength(
      LOCAL_BROWSER_DIAGNOSTIC_LIMITS.listItems,
    )
    expect(summary?.buttons).toEqual([])
    expect(summary?.activeElement).toBeNull()
    expect(summary?.links).toEqual(["Home -> /", "https://example.com/x"])
    expect((summary?.textSample ?? "").length).toBeLessThanOrEqual(
      LOCAL_BROWSER_DIAGNOSTIC_LIMITS.textSampleChars,
    )
    expect(shapeLocalBrowserDomSummary("string", redact)).toBeNull()
    expect(shapeLocalBrowserDomSummary([1, 2], redact)).toBeNull()
    expect(
      shapeLocalBrowserSelectedElement(
        `div - Bearer ${fixture.secrets.bearerJwt}`,
        redact,
      ),
    ).not.toContain(fixture.secrets.bearerJwt)
    expect(shapeLocalBrowserSelectedElement(42, redact)).toBeNull()
  })

  test("titles are bounded and redacted", () => {
    const title = shapeLocalBrowserTitle(
      `${"t".repeat(500)} sk-guestdiagnostic0123456789abcdef`,
      redact,
    )
    expect(title.length).toBeLessThanOrEqual(
      LOCAL_BROWSER_DIAGNOSTIC_LIMITS.titleChars,
    )
    expect(leaked(title)).toEqual([])
  })
})

describe("free-text diagnostics: OAuth parameters, bare JWTs and scheme-less queries", () => {
  const { oauthCode, oauthState, oauthNonce, bearerJwt, urlFragment } =
    fixture.secrets

  test.each([
    [
      "OAuth code/state/nonce outside a scheme URL",
      `callback ?code=${oauthCode}&state=${oauthState} nonce=${oauthNonce}`,
    ],
    ["a bare JWT", `token ${bearerJwt}`],
    ["a JWT as an id_token value", `id_token=${bearerJwt} received`],
    ["a scheme-less URL query", `GET localhost:3000/cb?code=${oauthCode} 302`],
    [
      "a scheme-less fragment",
      `redirect to localhost:3000/cb#access_token=${urlFragment}&state=${oauthState}`,
    ],
    ["a relative callback path", `/auth/callback?state=${oauthState}`],
    [
      "state and nonce pairs in free text",
      `state=${oauthState}; nonce=${oauthNonce}`,
    ],
  ])("%s is redacted in console text, titles and DOM text", (_label, text) => {
    const consoleText = shapeLocalBrowserText(text, redact, 600)
    const title = shapeLocalBrowserTitle(`t ${text}`, redact)
    const summary = shapeLocalBrowserDomSummary(
      { textSample: text, headings: [text], links: [{ label: text }] },
      redact,
    )
    const selected = shapeLocalBrowserSelectedElement(`div - ${text}`, redact)
    expect(leaked([consoleText, title, summary, selected])).toEqual([])
    expect(consoleText).toContain("<redacted>")
  })

  test("ordinary diagnostic text is not redacted by the page-text patterns", () => {
    for (const text of [
      "Render state: ready",
      "Process exited with code 1",
      "color #fff and #mermaid-1 .node",
      "a ? b : c",
      "value x=1 without a query",
      "http://localhost:3000/callback 404",
    ]) {
      expect(shapeLocalBrowserText(text, redact, 600)).toBe(text)
    }
  })

  test("the page-text patterns belong to diagnostics only: runtime payload redaction is unchanged", () => {
    const text = `token ${bearerJwt} /cb?state=${oauthState}`
    expect(String(redactRuntimePayload(text, {} as never).payload)).toBe(text)
    const diagnostic = redactUntrustedDiagnosticPayload(text, [])
    expect(String(diagnostic.payload)).toBe("token <redacted> /cb?<redacted>")
    expect(diagnostic.appliedRules).toEqual(["secret-text"])
  })
})

describe("the shared adapter is not a second redaction owner", () => {
  test("without the main redactor, recognized secrets in free text are untouched (secret matching lives only in redaction.ts)", () => {
    const text = `Authorization: Bearer ${fixture.secrets.bearerJwt}`
    expect(shapeLocalBrowserText(text, identity, 600)).toContain(
      fixture.secrets.bearerJwt,
    )
    expect(shapeLocalBrowserText(text, redact, 600)).not.toContain(
      fixture.secrets.bearerJwt,
    )
  })

  test("the pre-redaction cap drops a trailing partial token so a split secret cannot survive", () => {
    const cap = LOCAL_BROWSER_DIAGNOSTIC_LIMITS.preRedactionChars
    // The long query collapses under URL minimization, so without the
    // partial-token drop the 10 surviving key characters ("sk-guestdi", too
    // short for the provider pattern) would reach the projection.
    const filler = `https://h/?${"q".repeat(cap - 22)}`
    expect(filler.length).toBe(cap - 11)
    const text = `${filler} ${fixture.secrets.providerKey}`
    expect(text.slice(0, cap).endsWith(" sk-guestdi")).toBe(true)
    const shaped = shapeLocalBrowserText(text, redact, 600)
    expect(shaped).toBe("https://h/")
    expect(shaped).not.toContain("sk-guest")
  })
})

describe("console levels and screenshot bounds", () => {
  test("info/warning/error/debug map identically; everything else is log", () => {
    for (const level of ["info", "warning", "error", "debug"]) {
      expect(mapLocalBrowserConsoleLevel(level)).toBe(level)
    }
    for (const level of ["log", "verbose", "", 0, 1, 2, 3, null, undefined]) {
      expect(mapLocalBrowserConsoleLevel(level)).toBe("log")
    }
  })

  test("only bounded PNG projections are accepted", () => {
    const ok = {
      mimeType: "image/png",
      width: 1280,
      height: 800,
      byteLength: 1024,
    }
    expect(isAcceptableLocalBrowserScreenshot(ok)).toBe(true)
    for (const bad of [
      { ...ok, mimeType: "image/jpeg" },
      { ...ok, width: LOCAL_BROWSER_SCREENSHOT_LIMITS.maxWidth + 1 },
      { ...ok, height: 0 },
      { ...ok, width: 1.5 },
      { ...ok, byteLength: LOCAL_BROWSER_SCREENSHOT_LIMITS.maxBytes + 1 },
      { ...ok, byteLength: 0 },
    ]) {
      expect(isAcceptableLocalBrowserScreenshot(bad)).toBe(false)
    }
  })
})
