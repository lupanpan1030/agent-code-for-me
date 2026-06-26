import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  buildRendererContentSecurityPolicy,
  shouldApplyRendererContentSecurityPolicy,
} from "../src/main/windows/renderer-csp"

const repoRoot = join(__dirname, "..")

function readRendererHtml(): string {
  return readFileSync(join(repoRoot, "src/renderer/index.html"), "utf-8")
}

function readPublicScript(name: string): string {
  return readFileSync(join(repoRoot, "src/renderer/public", name), "utf-8")
}

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf-8")
}

function getDirective(csp: string, name: string): string[] {
  const directive = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `))

  return directive ? directive.split(/\s+/).slice(1) : []
}

function getScriptTags(html: string): string[] {
  return html.match(/<script\b[^>]*>/gi) ?? []
}

describe("renderer CSP policy", () => {
  test("sets a production header policy without inline or remote script sources", () => {
    const csp = buildRendererContentSecurityPolicy(false)
    const scriptSrc = getDirective(csp, "script-src")

    expect(scriptSrc).toContain("'self'")
    expect(scriptSrc).not.toContain("'unsafe-inline'")
    expect(scriptSrc).not.toContain("'unsafe-eval'")
    expect(scriptSrc).toContain("'wasm-unsafe-eval'")
    expect(scriptSrc).not.toContain("https://unpkg.com")
    expect(csp).not.toContain("https://unpkg.com")
    expect(getDirective(csp, "connect-src")).toEqual(["'self'"])
  })

  test("keeps the dev-only inline and localhost allowances required by Vite HMR", () => {
    const csp = buildRendererContentSecurityPolicy(true)

    expect(getDirective(csp, "script-src")).toContain("'unsafe-inline'")
    expect(getDirective(csp, "script-src")).toContain("'wasm-unsafe-eval'")
    expect(getDirective(csp, "connect-src")).toEqual([
      "'self'",
      "ws://localhost:*",
      "http://localhost:*",
    ])
  })

  test("applies the header only to the privileged app document", () => {
    expect(
      shouldApplyRendererContentSecurityPolicy({
        url: "file:///Applications/Locus.app/Contents/Resources/app.asar/out/renderer/index.html#windowId=main",
        resourceType: "mainFrame",
        isDev: false,
        prodIndexPath:
          "/Applications/Locus.app/Contents/Resources/app.asar/out/renderer/index.html",
      }),
    ).toBe(true)

    expect(
      shouldApplyRendererContentSecurityPolicy({
        url: "https://example.com/",
        resourceType: "mainFrame",
        isDev: false,
        prodIndexPath:
          "/Applications/Locus.app/Contents/Resources/app.asar/out/renderer/index.html",
      }),
    ).toBe(false)

    expect(
      shouldApplyRendererContentSecurityPolicy({
        url: "http://localhost:5173/?windowId=main",
        resourceType: "mainFrame",
        isDev: true,
        devServerUrl: "http://localhost:5173/",
      }),
    ).toBe(true)

    expect(
      shouldApplyRendererContentSecurityPolicy({
        url: "http://localhost:5173/src/renderer/main.tsx",
        resourceType: "script",
        isDev: true,
        devServerUrl: "http://localhost:5173/",
      }),
    ).toBe(false)
  })

  test("loads boot scripts from self instead of inline script tags", () => {
    const html = readRendererHtml()
    const scriptTags = getScriptTags(html)

    expect(html).not.toContain('http-equiv="Content-Security-Policy"')
    expect(scriptTags).toEqual([
      '<script src="./theme-init.js">',
      '<script src="./error-handler.js">',
      '<script type="module" src="./main.tsx">',
    ])
  })

  test("keeps theme init render-blocking in the head", () => {
    const html = readRendererHtml()
    const themeScriptIndex = html.indexOf(
      '<script src="./theme-init.js"></script>',
    )
    const headCloseIndex = html.indexOf("</head>")
    const bodyOpenIndex = html.indexOf("<body>")

    expect(themeScriptIndex).toBeGreaterThan(-1)
    expect(themeScriptIndex).toBeLessThan(headCloseIndex)
    expect(themeScriptIndex).toBeLessThan(bodyOpenIndex)
    expect(html).not.toContain('<script defer src="./theme-init.js">')
    expect(html).not.toContain('<script type="module" src="./theme-init.js">')
  })

  test("uses text-only global error fallback without leftover debug logging", () => {
    const errorHandler = readPublicScript("error-handler.js")

    expect(errorHandler).not.toContain("Inline script running - scripts work")
    expect(errorHandler).not.toContain("innerHTML")
    expect(errorHandler).toContain("textContent")
  })

  test("uses only the local theme mode provider without a next-themes dependency", () => {
    const packageJson = readRepoFile("package.json")
    const bunLock = readRepoFile("bun.lock")
    const provider = readRepoFile("src/renderer/lib/themes/theme-mode-provider.tsx")

    expect(packageJson).not.toContain('"next-themes"')
    expect(bunLock).not.toContain('"next-themes"')
    expect(provider).not.toContain("dangerouslySetInnerHTML")
    expect(provider).not.toContain('createElement("script"')
    expect(provider).not.toContain("createElement('script'")
  })
})
