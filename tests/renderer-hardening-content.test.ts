/**
 * Test-first suite (Domain A: renderer content boundary) for
 * `openspec/changes/add-renderer-untrusted-content-hardening`.
 *
 * Written by an independent test author from design D1/D2/D3(Shiki)/D10/Q9,
 * the `runtime-security-baseline` MODIFIED requirement "Untrusted Renderer
 * Content Uses Reviewed Rendering Boundaries" and its Scenarios, tasks
 * 1.1-1.4 / 2.1-2.5 / 2.10, and verification.md's freeze-time proof set.
 *
 * Entry points are observable ones only:
 * - the app's real Streamdown mounts, rendered into happy-dom:
 *   `MemoizedMarkdown` (Streamdown `mode="static"`) and
 *   `ChatMarkdownRenderer` (Streamdown `mode="streaming"`);
 * - the reviewed external-URL click sink `openExternalUrl` (main), reached
 *   exactly as the rendered `<a>` click hands it the href;
 * - repository sources/manifests for the source-guard, pin and alias rules
 *   (design D1 makes the guard test-owned; D10 makes bun.lock the pin of
 *   record);
 * - the production/development CSP builder.
 *
 * Companion files (separate because `mock.module` is file-scoped):
 * - renderer-hardening-content-markdown-boundary.test.ts (forced plugin throw)
 * - renderer-hardening-content-shiki.test.ts (forced Shiki output shapes)
 * - renderer-hardening-content-diff.test.ts (shim-bound <FileDiff>/<PatchDiff>)
 *
 * Tests labelled "[green-by-design]" are characterization/upgrade-gate guards
 * that pass on the baseline on purpose; see the red receipt in the report.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"
import {
  findExecutableMarkup,
  installHappyDom,
  PRIVILEGED_APP_DOCUMENT_BASE,
} from "./renderer-hardening-content-oracle"
import {
  type SinkSite,
  scanSource,
  scanTree,
  walkScannedFiles,
} from "./renderer-hardening-content-scanner"

const repoRoot = join(import.meta.dir, "..")
const rendererRoot = join(repoRoot, "src/renderer")
const fixtureRoot = join(import.meta.dir, "fixtures/renderer-hardening/content")

const testWindow = installHappyDom()

const shellOpenExternalCalls: string[] = []
mock.module("electron", () => ({
  shell: {
    openExternal: async (url: string) => {
      shellOpenExternalCalls.push(url)
    },
  },
}))

const { act, createElement } = await import("react")
const { createRoot } = await import("react-dom/client")
const { I18nProvider } = await import("../src/renderer/lib/i18n")
const { ChatMarkdownRenderer, MemoizedMarkdown } = await import(
  "../src/renderer/components/chat-markdown-renderer"
)
const { openExternalUrl } = await import("../src/main/lib/local-only")
const { buildRendererContentSecurityPolicy } = await import(
  "../src/main/windows/renderer-csp"
)

type Root = ReturnType<typeof createRoot>

interface MarkdownCase {
  id: string
  markdown: string
  /** Baseline (45f6e54c) already satisfies the oracle: regression gate. */
  greenByDesign?: boolean
}

function label(fixture: MarkdownCase): string {
  return fixture.greenByDesign ? "[green-by-design] " : ""
}

interface SafeCase extends MarkdownCase {
  expect: Array<{
    selector: string
    textIncludes: string
  }>
  forbidSelector: string
}

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixtureRoot, name), "utf-8")) as T
}

function readRepo(path: string): string {
  return readFileSync(join(repoRoot, path), "utf-8")
}

const maliciousCases = readJson<MarkdownCase[]>("markdown-malicious.json")
const incompleteCases = readJson<MarkdownCase[]>(
  "markdown-streaming-incomplete.json",
)
const safeCases = readJson<SafeCase[]>("markdown-safe.json")

let mountedRoots: Root[] = []

afterEach(async () => {
  for (const root of mountedRoots) {
    await act(async () => root.unmount())
  }
  mountedRoots = []
  testWindow.document.body.replaceChildren()
  shellOpenExternalCalls.length = 0
})

async function settle(ms = 40): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

type MountName = "static" | "streaming"

function markdownElement(
  mount: MountName,
  content: string,
  isStreaming: boolean,
) {
  const inner =
    mount === "static"
      ? createElement(MemoizedMarkdown, {
          content,
          id: "hardening-message",
          isStreaming,
        })
      : createElement(ChatMarkdownRenderer, { content, isStreaming })
  return createElement(I18nProvider, null, inner)
}

async function renderMarkdown(
  mount: MountName,
  content: string,
  isStreaming: boolean,
): Promise<{ container: HTMLElement; root: Root }> {
  const container = testWindow.document.createElement(
    "div",
  ) as unknown as HTMLElement
  testWindow.document.body.append(container as never)
  const root = createRoot(container)
  mountedRoots.push(root)
  await act(async () => {
    root.render(markdownElement(mount, content, isStreaming))
  })
  await settle()
  return { container, root }
}

function violationsOf(container: HTMLElement) {
  return findExecutableMarkup(container as never, { kind: "markdown" })
}

const MOUNTS: MountName[] = ["static", "streaming"]

// ---------------------------------------------------------------------------
// D1 — exact insertion-point inventory (replaces the five-file allowlist)
// ---------------------------------------------------------------------------

/**
 * Expected post-change inventory of value-bearing raw-markup insertion points,
 * keyed by construct + stable enclosing symbol + reviewed producer module.
 * Derived from design D1 (six dangerouslySetInnerHTML insertions: chat
 * markdown x1, Mermaid x2, three tool/message views; both diff `unsafeCSS`
 * dependency-prop sites) with the superseded sinks removed: mentions
 * undo/redo `.innerHTML` restores (D4) and the react-scan remote loader (D1).
 */
const EXPECTED_INVENTORY: Array<{
  key: string
  producerModules: string[]
}> = [
  {
    key: "react-dangerouslySetInnerHTML@CodeBlock",
    producerModules: [
      "lib/security/renderer-html-policy",
      "lib/themes/shiki-theme-loader",
    ],
  },
  {
    key: "react-dangerouslySetInnerHTML@DiffLineRow",
    producerModules: [
      "lib/security/renderer-html-policy",
      "lib/themes/shiki-theme-loader",
    ],
  },
  {
    key: "react-dangerouslySetInnerHTML@HighlightedJson",
    producerModules: [
      "lib/security/renderer-html-policy",
      "lib/themes/shiki-theme-loader",
    ],
  },
  {
    key: "react-dangerouslySetInnerHTML@MermaidBlockInner",
    producerModules: ["lib/security/mermaid-svg-sanitizer"],
  },
  {
    key: "react-dangerouslySetInnerHTML@MermaidBlockInner",
    producerModules: ["lib/security/mermaid-svg-sanitizer"],
  },
  {
    key: "react-dangerouslySetInnerHTML@MessageJsonDisplay",
    producerModules: [
      "lib/security/renderer-html-policy",
      "lib/themes/shiki-theme-loader",
    ],
  },
  {
    key: "dependency-unsafeCSS@FileDiffCard",
    producerModules: [],
  },
  {
    key: "dependency-unsafeCSS@FileDiffCard",
    producerModules: [],
  },
]

function siteKey(site: SinkSite): string {
  return `${site.sinkClass}@${site.symbol}`
}

function valueBearing(sites: SinkSite[]): SinkSite[] {
  return sites.filter((site) => site.sinkClass !== "dom-html-empty-clear")
}

describe("D1 renderer source guard: exact insertion-point inventory", () => {
  test("[green-by-design] scanner self-test: every scanned sink class is detected in its negative fixture and look-alikes are not", () => {
    const manifest = JSON.parse(
      readFileSync(join(fixtureRoot, "scanner/manifest.json"), "utf-8"),
    ) as Array<{ file: string; expectedClasses: string[] }>
    const detected = manifest.map((entry) => ({
      file: entry.file,
      classes: scanSource(
        entry.file,
        readFileSync(join(fixtureRoot, "scanner", entry.file), "utf-8"),
      ).map((site) => site.sinkClass),
    }))
    expect(detected).toEqual(
      manifest.map((entry) => ({
        file: entry.file,
        classes: entry.expectedClasses,
      })),
    )
    const coveredClasses = new Set(detected.flatMap((entry) => entry.classes))
    expect([...coveredClasses].sort()).toEqual(
      [
        "contextual-fragment",
        "dependency-prerenderedHTML",
        "dependency-unsafeCSS",
        "document-write",
        "dom-html-empty-clear",
        "dom-html-write",
        "dynamic-script",
        "html-inline-handler",
        "html-remote-script",
        "import-scripts",
        "insertAdjacentHTML",
        "react-dangerouslySetInnerHTML",
        "remote-import",
        "script-src-assignment",
        "set-html-unsafe",
        "srcdoc",
      ].sort(),
    )
  })

  test("[green-by-design] the guard walks all of src/renderer including public/ and .js/.jsx/.mjs/.cjs/.html files", () => {
    const scanned = walkScannedFiles(rendererRoot).map((file) =>
      file.slice(repoRoot.length + 1),
    )
    expect(scanned).toContain("src/renderer/public/error-handler.js")
    expect(scanned).toContain("src/renderer/public/theme-init.js")
    expect(scanned).toContain("src/renderer/index.html")
    expect(scanned.every((file) => file.startsWith("src/renderer/"))).toBe(true)
  })

  test("A raw-markup insertion is introduced or changed: every value-bearing insertion point is an exact inventory entry (no mentions .innerHTML restore, no dynamic/remote script)", () => {
    const actual = valueBearing(scanTree(repoRoot, rendererRoot))
      .map((site) => `${siteKey(site)} (${site.file}:${site.line})`)
      .sort()
    const actualKeys = actual.map((entry) => entry.split(" ")[0])
    expect(actualKeys).toEqual(
      EXPECTED_INVENTORY.map((entry) => entry.key).sort(),
    )
  })

  test("[green-by-design] each inventoried insertion lives in a module that imports its named reviewed producer", () => {
    const sites = valueBearing(scanTree(repoRoot, rendererRoot)).filter(
      (site) => site.sinkClass === "react-dangerouslySetInnerHTML",
    )
    const unbound = sites
      .map((site) => {
        const expected = EXPECTED_INVENTORY.find(
          (entry) => entry.key === siteKey(site),
        )
        const source = readRepo(site.file)
        const importsProducer = (expected?.producerModules ?? []).some(
          (producer) => source.includes(producer.split("/").pop() as string),
        )
        return { site: `${siteKey(site)} ${site.file}`, importsProducer }
      })
      .filter((entry) => !entry.importsProducer)
    expect(sites.length).toBeGreaterThan(0)
    expect(unbound).toEqual([])
  })

  test("dynamic script creation, script.src assignment, remote import() and importScripts are absent (react-scan unpkg loader removed)", () => {
    const scriptSites = scanTree(repoRoot, rendererRoot)
      .filter((site) =>
        [
          "dynamic-script",
          "script-src-assignment",
          "remote-import",
          "import-scripts",
          "html-remote-script",
          "html-inline-script",
        ].includes(site.sinkClass),
      )
      .map((site) => `${site.sinkClass} ${site.file}:${site.line}`)
    expect(scriptSites).toEqual([])
    expect(
      readRepo(
        "src/renderer/components/dialogs/settings-tabs/agents-debug-tab.tsx",
      ),
    ).not.toContain("unpkg.com")
  })

  test("[green-by-design] the renderer HTML entry has no inline handlers, srcdoc or remote scripts", () => {
    const htmlSites = walkScannedFiles(rendererRoot)
      .filter((file) => file.endsWith(".html"))
      .flatMap((file) =>
        scanSource(
          file.slice(repoRoot.length + 1),
          readFileSync(file, "utf-8"),
        ),
      )
    expect(htmlSites).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// D1 — reviewed-output owner and local escaping branches
// ---------------------------------------------------------------------------

/**
 * Caller-local HTML escaping policy, detected independently of function
 * names: a string literal that produces an HTML character reference. A thin
 * wrapper that delegates to the owner carries no such literal.
 */
function htmlEscapingLiterals(file: string): string[] {
  const sourceFile = ts.createSourceFile(
    file,
    readFileSync(file, "utf-8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const literals: string[] = []
  const visit = (node: ts.Node) => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      /&(?:lt|gt|amp|quot|#x?[0-9a-f]+);/i.test(node.text)
    ) {
      const line =
        sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1
      literals.push(`${file.slice(repoRoot.length + 1)}:${line} ${node.text}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return literals
}

describe("D1 reviewed-output owner and local escaping branches", () => {
  test("the canonical reviewed renderer HTML owner exists at src/renderer/lib/security/renderer-html-policy.ts", async () => {
    const policyPath = join(
      rendererRoot,
      "lib/security/renderer-html-policy.ts",
    )
    expect(existsSync(policyPath)).toBe(true)
    const policy = await import(policyPath)
    expect(Object.keys(policy).length).toBeGreaterThan(0)
  })

  test("no caller-local HTML escaping policy remains outside the owner (chat-markdown escapeHtml and the Pierre shim escapeHtml are removed or routed)", () => {
    const ownerPath = "src/renderer/lib/security/renderer-html-policy.ts"
    const escapers = walkScannedFiles(rendererRoot)
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .filter((file) => !file.endsWith(ownerPath))
      .flatMap((file) => htmlEscapingLiterals(file))
    expect(escapers).toEqual([])
  })

  test("[green-by-design] highlightCode() stays the sole Shiki HTML-string producer: no caller-side codeToHtml path", () => {
    const allowed = new Set([
      "src/renderer/lib/themes/shiki-theme-loader.ts",
      "src/renderer/lib/security/renderer-html-policy.ts",
    ])
    const callers = walkScannedFiles(rendererRoot)
      .map((file) => file.slice(repoRoot.length + 1))
      .filter((file) => /\.codeToHtml\s*\(/.test(readRepo(file)))
      .filter((file) => !allowed.has(file))
    expect(callers).toEqual([])
  })

  test("[green-by-design] the dormant diff-view-highlighter getAST adapter has no callers", () => {
    const callers = walkScannedFiles(rendererRoot)
      .filter((file) => !file.endsWith("lib/themes/diff-view-highlighter.ts"))
      .filter((file) => /\.getAST\s*\(/.test(readFileSync(file, "utf-8")))
      .map((file) => file.slice(repoRoot.length + 1))
    expect(callers).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// D1/Q9 — named dependency-prop rule, alias/shim inventory, worker guard
// ---------------------------------------------------------------------------

function parseTs(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readRepo(path),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
}

function collect<T extends ts.Node>(
  root: ts.Node,
  predicate: (node: ts.Node) => node is T,
): T[] {
  const found: T[] = []
  const visit = (node: ts.Node) => {
    if (predicate(node)) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(root)
  return found
}

describe("D1 named raw-markup/raw-CSS dependency-prop rule (Q9 diff path)", () => {
  test("[green-by-design] both diff unsafeCSS arguments are the single PIERRE_DIFFS_THEME_CSS identifier and its declaration is an interpolation-free constant", () => {
    const sites = scanTree(repoRoot, rendererRoot).filter(
      (site) => site.sinkClass === "dependency-unsafeCSS",
    )
    expect(sites.map((site) => site.valueText)).toEqual([
      "PIERRE_DIFFS_THEME_CSS",
      "PIERRE_DIFFS_THEME_CSS",
    ])
    const diffView = parseTs(
      "src/renderer/features/agents/ui/agent-diff-view.tsx",
    )
    const declarations = collect(diffView, ts.isVariableDeclaration).filter(
      (declaration) => declaration.name.getText() === "PIERRE_DIFFS_THEME_CSS",
    )
    expect(declarations).toHaveLength(1)
    const declaration = declarations[0]
    expect(
      (declaration.parent.flags & ts.NodeFlags.Const) === ts.NodeFlags.Const,
    ).toBe(true)
    expect(
      declaration.initializer !== undefined &&
        ts.isNoSubstitutionTemplateLiteral(declaration.initializer),
    ).toBe(true)
  })

  test("[green-by-design] prerenderedHTML is absent from every renderer call site", () => {
    const sites = scanTree(repoRoot, rendererRoot).filter(
      (site) => site.sinkClass === "dependency-prerenderedHTML",
    )
    expect(sites).toEqual([])
  })

  test("[green-by-design] the Vite alias into @pierre/diffs binds exactly the four Shiki specifiers to the Locus shim and no other alias targets a DOM-producing dependency", () => {
    const config = parseTs("electron.vite.config.ts")
    const resolveIdMethods = collect(config, ts.isMethodDeclaration).filter(
      (method) => method.name.getText() === "resolveId",
    )
    expect(resolveIdMethods).toHaveLength(1)
    const compared = collect(resolveIdMethods[0], ts.isBinaryExpression)
      .filter(
        (binary) =>
          binary.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
          binary.left.getText() === "source",
      )
      .map((binary) => (binary.right as ts.StringLiteral).text)
      .sort()
    expect(compared).toEqual(
      [
        "@shikijs/engine-javascript",
        "@shikijs/transformers",
        "shiki",
        "shiki/core",
      ].sort(),
    )
    const configText = readRepo("electron.vite.config.ts")
    expect(configText).toContain('"/node_modules/@pierre/diffs/"')
    expect(configText).toContain(
      '"src/renderer/lib/vendor/pierre-diffs-shiki-shim.ts"',
    )
    const aliasObjects = collect(config, ts.isPropertyAssignment).filter(
      (property) => property.name.getText() === "alias",
    )
    const aliasKeys = aliasObjects.flatMap((property) =>
      ts.isObjectLiteralExpression(property.initializer)
        ? property.initializer.properties.map(
            (entry) => (entry.name as ts.Identifier | ts.StringLiteral).text,
          )
        : ["<non-literal alias>"],
    )
    expect(aliasKeys).toEqual(["@"])
  })

  test("[green-by-design] the Locus Pierre shim is the only renderer module exporting a Shiki-API surface", () => {
    const shikiApiExport =
      /export\s+(?:async\s+)?(?:function|const)\s+(createHighlighter|createHighlighterCoreSync|createJavaScriptRegexEngine|bundledLanguages|bundledThemes|codeToHast)\b/
    const shims = walkScannedFiles(rendererRoot)
      .filter((file) => shikiApiExport.test(readFileSync(file, "utf-8")))
      .map((file) => file.slice(repoRoot.length + 1))
    expect(shims).toEqual([
      "src/renderer/lib/vendor/pierre-diffs-shiki-shim.ts",
    ])
  })

  test("[green-by-design] worker-entry source guard: no @pierre/diffs worker import, WorkerPoolContextProvider, getOrCreateWorkerPoolSingleton or workerFactory", () => {
    const forbidden =
      /@pierre\/diffs\/worker|worker-portable\.js|WorkerPoolContextProvider|getOrCreateWorkerPoolSingleton|workerFactory/
    const hits = walkScannedFiles(rendererRoot)
      .filter((file) => forbidden.test(readFileSync(file, "utf-8")))
      .map((file) => file.slice(repoRoot.length + 1))
    expect(hits).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Q9/D10 — lockfile assertion (committed bun.lock is the pin of record)
// ---------------------------------------------------------------------------

function lockResolutions(): Map<string, string> {
  const lock = readRepo("bun.lock")
  const resolutions = new Map<string, string>()
  for (const match of lock.matchAll(/^ {4}"([^"]+)": \["([^"]+)"/gm)) {
    resolutions.set(match[1], match[2])
  }
  return resolutions
}

describe("Q9 lockfile-assertion pin of record", () => {
  test("[green-by-design] bun.lock resolves the nine exact Q9 anchors", () => {
    const resolutions = lockResolutions()
    const anchors: Record<string, string> = {
      "@pierre/diffs": "@pierre/diffs@1.0.10",
      "hast-util-to-html": "hast-util-to-html@9.0.5",
      "@pierre/diffs/shiki": "shiki@3.21.0",
      "@shikijs/core": "@shikijs/core@3.21.0",
      "@shikijs/engine-javascript": "@shikijs/engine-javascript@3.21.0",
      "@shikijs/transformers": "@shikijs/transformers@3.22.0",
      "@shikijs/transformers/@shikijs/core": "@shikijs/core@3.22.0",
      "@shikijs/transformers/@shikijs/types": "@shikijs/types@3.22.0",
      shiki: "shiki@1.29.2",
    }
    const actual = Object.fromEntries(
      Object.keys(anchors).map((key) => [key, resolutions.get(key) ?? null]),
    )
    expect(actual).toEqual(anchors)
  })

  test("[green-by-design] the load-bearing escaper and diff producer resolve once, and the mixed Shiki resolution is not collapsed", () => {
    const resolutions = [...lockResolutions().entries()]
    const keysResolving = (prefix: string) =>
      resolutions
        .filter(([, value]) => value.startsWith(prefix))
        .map(([key]) => key)
        .sort()
    expect(keysResolving("hast-util-to-html@")).toEqual(["hast-util-to-html"])
    expect(keysResolving("@pierre/diffs@")).toEqual(["@pierre/diffs"])
    expect(keysResolving("shiki@")).toEqual(["@pierre/diffs/shiki", "shiki"])
    const pkg = JSON.parse(readRepo("package.json")) as {
      overrides?: Record<string, string>
    }
    const overrideKeys = Object.keys(pkg.overrides ?? {})
    expect(
      overrideKeys.filter((key) => /^(shiki|@shikijs\/)/.test(key)),
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// D2 — Streamdown ownership: exact pin and explicit reviewed rehype chain
// ---------------------------------------------------------------------------

function rendererImportSpecifiers(): Array<{
  file: string
  specifier: string
  named: string[]
}> {
  return walkScannedFiles(rendererRoot)
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .flatMap((file) => {
      const sourceFile = ts.createSourceFile(
        file,
        readFileSync(file, "utf-8"),
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      )
      return sourceFile.statements
        .filter(ts.isImportDeclaration)
        .map((declaration) => {
          const bindings = declaration.importClause?.namedBindings
          return {
            file: file.slice(repoRoot.length + 1),
            specifier: (declaration.moduleSpecifier as ts.StringLiteral).text,
            named:
              bindings && ts.isNamedImports(bindings)
                ? bindings.elements.map(
                    (element) => (element.propertyName ?? element.name).text,
                  )
                : [],
          }
        })
    })
}

describe("D2 Streamdown is repository-gated: exact pin and explicit reviewed chain", () => {
  test("package.json pins the top-level streamdown dependency to exact 2.1.0", () => {
    const pkg = JSON.parse(readRepo("package.json")) as {
      dependencies: Record<string, string>
    }
    expect(pkg.dependencies.streamdown).toBe("2.1.0")
    expect(lockResolutions().get("streamdown")).toBe("streamdown@2.1.0")
  })

  test("rehype-sanitize defaultSchema is imported by app code and every app-imported rehype package is an exact direct dependency matching bun.lock", () => {
    const imports = rendererImportSpecifiers()
    const rehypeImports = [
      ...new Set(
        imports
          .map((entry) => entry.specifier)
          .filter((specifier) =>
            /^(rehype-|hast-util-sanitize$)/.test(specifier),
          ),
      ),
    ].sort()
    expect(rehypeImports).toContain("rehype-sanitize")
    expect(
      imports.some(
        (entry) =>
          entry.specifier === "rehype-sanitize" &&
          entry.named.includes("defaultSchema"),
      ),
    ).toBe(true)
    const pkg = JSON.parse(readRepo("package.json")) as {
      dependencies: Record<string, string>
    }
    const resolutions = lockResolutions()
    const declared = rehypeImports.map((name) => ({
      name,
      declared: pkg.dependencies[name] ?? null,
      locked: resolutions.get(name) ?? null,
    }))
    expect(declared).toEqual(
      rehypeImports.map((name) => ({
        name,
        declared: (resolutions.get(name) ?? "").split("@").pop() ?? null,
        locked: resolutions.get(name) ?? null,
      })),
    )
    expect(
      declared.every((entry) => /^\d+\.\d+\.\d+$/.test(entry.declared ?? "")),
    ).toBe(true)
  })

  test("both Streamdown mounts live behind one app-owned wrapper module and each passes an explicit rehypePlugins chain", () => {
    const mounts = walkScannedFiles(rendererRoot)
      .filter((file) => file.endsWith(".tsx"))
      .flatMap((file) => {
        const sourceFile = ts.createSourceFile(
          file,
          readFileSync(file, "utf-8"),
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TSX,
        )
        return collect(
          sourceFile,
          (node): node is ts.JsxOpeningElement | ts.JsxSelfClosingElement =>
            (ts.isJsxOpeningElement(node) ||
              ts.isJsxSelfClosingElement(node)) &&
            node.tagName.getText() === "Streamdown",
        ).map((element) => ({
          file: file.slice(repoRoot.length + 1),
          attributes: element.attributes.properties
            .filter(ts.isJsxAttribute)
            .map((attribute) => attribute.name.getText()),
        }))
      })
    expect(mounts.length).toBeGreaterThanOrEqual(1)
    expect(new Set(mounts.map((mount) => mount.file)).size).toBe(1)
    expect(
      mounts.map((mount) => ({
        rehype: mount.attributes.includes("rehypePlugins"),
        remark: mount.attributes.includes("remarkPlugins"),
        components: mount.attributes.includes("components"),
      })),
    ).toEqual(
      mounts.map(() => ({ rehype: true, remark: true, components: true })),
    )
  })

  test("[green-by-design] app code does not adopt Streamdown's exported default rehype pipeline", () => {
    const adopters = rendererImportSpecifiers().filter(
      (entry) =>
        entry.specifier === "streamdown" &&
        entry.named.includes("defaultRehypePlugins"),
    )
    expect(adopters).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// D2 — black-box malicious matrix through both app Streamdown mounts
// ---------------------------------------------------------------------------

describe("Markdown active HTML and highlighted HTML sinks: static and streaming app mounts satisfy the rendered-DOM oracle", () => {
  for (const mount of MOUNTS) {
    for (const fixture of maliciousCases) {
      test(`${label(fixture)}${mount} mount / ${fixture.id}`, async () => {
        const { container } = await renderMarkdown(
          mount,
          fixture.markdown,
          false,
        )
        expect((container.textContent ?? "").length).toBeGreaterThan(0)
        expect(violationsOf(container)).toEqual([])
        expect(
          (testWindow as unknown as { __pwned?: number }).__pwned,
        ).toBeUndefined()
      })
    }
  }
})

describe("Markdown malformed/incomplete streaming variants satisfy the oracle at every chunk", () => {
  for (const mount of MOUNTS) {
    for (const fixture of incompleteCases) {
      test(`${label(fixture)}${mount} mount streamed chunk-by-chunk / ${fixture.id}`, async () => {
        const container = testWindow.document.createElement(
          "div",
        ) as unknown as HTMLElement
        testWindow.document.body.append(container as never)
        const root = createRoot(container)
        mountedRoots.push(root)
        const failures: Array<{ length: number; violations: unknown[] }> = []
        const step = 5
        for (
          let length = step;
          length < fixture.markdown.length + step;
          length += step
        ) {
          const prefix = fixture.markdown.slice(0, length)
          await act(async () => {
            root.render(markdownElement(mount, prefix, true))
          })
          const violations = violationsOf(container)
          if (violations.length > 0) failures.push({ length, violations })
        }
        await act(async () => {
          root.render(markdownElement(mount, fixture.markdown, false))
        })
        await settle()
        expect(failures).toEqual([])
        expect(violationsOf(container)).toEqual([])
      })
    }
  }
})

describe("Reviewed safe formatting subset still renders (positive controls, both mounts)", () => {
  for (const mount of MOUNTS) {
    for (const fixture of safeCases) {
      test(`[green-by-design] ${mount} mount / ${fixture.id}`, async () => {
        const { container } = await renderMarkdown(
          mount,
          fixture.markdown,
          false,
        )
        await settle(250)
        expect(violationsOf(container)).toEqual([])
        const observed = fixture.expect.map((expectation) => {
          const scope = container.querySelector(expectation.selector)
          return {
            selector: expectation.selector,
            found: scope !== null,
            includesText: (scope?.textContent ?? "").includes(
              expectation.textIncludes,
            ),
          }
        })
        expect(observed).toEqual(
          fixture.expect.map((expectation) => ({
            selector: expectation.selector,
            found: true,
            includesText: true,
          })),
        )
        expect(container.querySelectorAll(fixture.forbidSelector).length).toBe(
          0,
        )
      })
    }
  }
})

describe("Streamdown's built-in Mermaid raw sink stays dormant behind the app code/pre overrides", () => {
  for (const mount of MOUNTS) {
    test(`[green-by-design] ${mount} mount renders a mermaid fence without Streamdown's aria-label="Mermaid chart" element`, async () => {
      const { container } = await renderMarkdown(
        mount,
        "```mermaid\ngraph TD\n  A-->B\n```\n",
        mount === "streaming",
      )
      expect(
        container.querySelectorAll('[aria-label="Mermaid chart"]').length,
      ).toBe(0)
    })
  }
})

describe("Custom-scheme and relative-link fixtures reach only the reviewed openExternalUrl click boundary", () => {
  const linkMarkdown = [
    "[https ok](https://example.com/ok)",
    "[mail ok](mailto:dev@example.com)",
    "[locus](locus://mcp-import?payload=x)",
    "[vscode](vscode://file/etc/passwd)",
    "[msdt](ms-msdt:/id PCWDiagnostic)",
    "[relative](./relative/path.md)",
  ].join("\n\n")

  for (const mount of MOUNTS) {
    test(`[green-by-design] ${mount} mount: clicking every rendered link opens only HTTP(S)/mailto through openExternalUrl`, async () => {
      const handedToPreload: string[] = []
      ;(
        testWindow as unknown as {
          desktopApi: { openExternal: (url: string) => void }
        }
      ).desktopApi = {
        openExternal: (url: string) => {
          handedToPreload.push(url)
        },
      }
      const { container } = await renderMarkdown(mount, linkMarkdown, false)
      const anchors = Array.from(container.querySelectorAll("a"))
      for (const anchor of anchors) {
        await act(async () => {
          anchor.dispatchEvent(
            new testWindow.MouseEvent("click", {
              bubbles: true,
              cancelable: true,
            }) as never,
          )
        })
      }
      await Promise.allSettled(
        handedToPreload.map((url) => openExternalUrl("markdown-link", url)),
      )
      expect(shellOpenExternalCalls).toContain("https://example.com/ok")
      expect(shellOpenExternalCalls).toContain("mailto:dev@example.com")
      expect(
        shellOpenExternalCalls.map((url) => new URL(url).protocol).sort(),
      ).toEqual(
        shellOpenExternalCalls
          .map((url) => new URL(url).protocol)
          .filter((protocol) =>
            ["http:", "https:", "mailto:"].includes(protocol),
          )
          .sort(),
      )
    })
  }
})

// ---------------------------------------------------------------------------
// D2 — the shared oracle itself has distinguishing power (self-test)
// ---------------------------------------------------------------------------

describe("D2 rendered-DOM executable-markup oracle distinguishes every rule (self-test)", () => {
  function parse(html: string): HTMLElement {
    const host = testWindow.document.createElement("div")
    host.innerHTML = html
    return host as unknown as HTMLElement
  }

  const mustFail: Array<[string, string]> = [
    ["script element", "<script>1</script>"],
    ["iframe element", '<iframe src="https://example.com"></iframe>'],
    ["object element", "<object></object>"],
    ["embed element", "<embed>"],
    ["base element", '<base href="https://evil.example/">'],
    ["meta element", "<meta http-equiv=refresh>"],
    ["link element", '<link rel="stylesheet" href="https://e/x.css">'],
    ["svg foreignObject", "<svg><foreignObject></foreignObject></svg>"],
    ["svg animate", '<svg><animate attributeName="x"></animate></svg>'],
    ["svg set", '<svg><set attributeName="x"></set></svg>'],
    ["mathml maction", "<math><maction>m</maction></math>"],
    ["style element", "<style>a{}</style>"],
    ["on* attribute", '<span onclick="1">x</span>'],
    ["mixed-case on* attribute", '<span OnMouseOver="1">x</span>'],
    ["srcdoc attribute", '<div srcdoc="<b>x</b>"></div>'],
    ["javascript: href", '<a href="javascript:1">x</a>'],
    ["tab-split javascript: href", '<a href="jav&#x09;ascript:1">x</a>'],
    ["data: img src", '<img src="data:image/png;base64,AAAA">'],
    ["vbscript: href", '<a href="vbscript:1">x</a>'],
    ["file: href", '<a href="file:///etc/passwd">x</a>'],
    ["blob: img src", '<img src="blob:https://e/1">'],
    ["custom scheme href", '<a href="locus://x">x</a>'],
    ["mailto media src", '<img src="mailto:a@b.c">'],
    ["relative href inherits file base", '<a href="/etc/passwd">x</a>'],
    ["fragment href outside profile", '<a href="#top">x</a>'],
    [
      "svg xlink:href javascript",
      '<svg><a xlink:href="javascript:1"><text>t</text></a></svg>',
    ],
    ["formaction javascript", '<button formaction="javascript:1">b</button>'],
    ["poster javascript", '<video poster="javascript:1"></video>'],
    ["overlay inline css", '<div style="position:fixed;inset:0">o</div>'],
    [
      "remote url inline css",
      '<div style="background:url(https://e/b)">o</div>',
    ],
  ]

  test("[green-by-design] rejects each forbidden construct and accepts reviewed HTTP(S)/mailto formatting", () => {
    const missed = mustFail
      .filter(
        ([, html]) =>
          findExecutableMarkup(parse(html) as never, { kind: "markdown" })
            .length === 0,
      )
      .map(([name]) => name)
    expect(missed).toEqual([])
    const safe = parse(
      '<p><strong>b</strong> <em>e</em> <a href="https://example.com/x">l</a> <a href="mailto:a@b.c">m</a> <img src="https://example.com/i.png"></p><table><tr><td>1</td></tr></table><pre><code>&lt;b&gt;</code></pre>',
    )
    expect(findExecutableMarkup(safe as never, { kind: "markdown" })).toEqual(
      [],
    )
    expect(new URL("/etc/passwd", PRIVILEGED_APP_DOCUMENT_BASE).protocol).toBe(
      "file:",
    )
  })
})

// ---------------------------------------------------------------------------
// CSP — production/development renderer policy (TICKET-114 construction half)
// ---------------------------------------------------------------------------

function directive(csp: string, name: string): string[] {
  const part = csp
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name} `))
  return part ? part.split(/\s+/).slice(1) : []
}

describe("Production renderer CSP permits script execution / Development renderer CSP permits Vite HMR", () => {
  test("[green-by-design] production script-src allows only 'self' plus the documented WebAssembly exception: no inline, broad eval or remote origin", () => {
    const csp = buildRendererContentSecurityPolicy(false)
    expect(directive(csp, "script-src")).toEqual([
      "'self'",
      "'wasm-unsafe-eval'",
    ])
    expect(directive(csp, "default-src")).toEqual(["'self'"])
    expect(directive(csp, "connect-src")).toEqual(["'self'"])
  })

  test("[green-by-design] development inline/localhost allowances are scoped to development only", () => {
    const dev = buildRendererContentSecurityPolicy(true)
    const prod = buildRendererContentSecurityPolicy(false)
    const devOnly = [
      ...directive(dev, "script-src"),
      ...directive(dev, "connect-src"),
    ].filter(
      (token) =>
        ![
          ...directive(prod, "script-src"),
          ...directive(prod, "connect-src"),
        ].includes(token),
    )
    expect(devOnly.sort()).toEqual(
      ["'unsafe-inline'", "http://localhost:*", "ws://localhost:*"].sort(),
    )
    expect(prod).not.toContain("localhost")
    expect(directive(prod, "script-src")).not.toContain("'unsafe-inline'")
  })
})
