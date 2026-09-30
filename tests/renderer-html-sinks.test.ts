/**
 * Renderer source-guard owner (openspec change
 * `add-renderer-untrusted-content-hardening`, design D1, tasks 1.1-1.4).
 *
 * The former five-file `dangerouslySetInnerHTML` allowlist is replaced by an
 * exact insertion-point inventory keyed by construct, file and enclosing
 * owner symbol, each bound to its reviewed content producer, the value shape
 * that producer hands the sink, and the retained adversarial behavior tests.
 * A new sink, or a new sink inside an already reviewed file, fails this guard.
 * The scan walks all of `src/renderer` (including `public/` and
 * `.ts/.tsx/.js/.jsx/.mjs/.cjs/.html`); out-of-root anchors (the reviewed
 * external-URL click sink, the Q9 Vite alias) are checked as named rules.
 *
 * Source inventory is an architecture alarm, not runtime proof: the rendered
 * behavior suites named per entry carry the security evidence.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import ts from "typescript"
import {
  listRendererScannedFiles,
  type RendererSinkConstruct,
  type RendererSinkSite,
  scanRendererSource,
  scanRendererTree,
} from "./helpers/renderer-raw-sink-scanner"

const repoRoot = join(__dirname, "..")
const rendererRoot = join(repoRoot, "src/renderer")

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf-8")
}

function repoPath(file: string): string {
  return relative(repoRoot, file).split(sep).join("/")
}

function parse(relativePath: string): ts.SourceFile {
  return ts.createSourceFile(
    relativePath,
    read(relativePath),
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
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

// ---------------------------------------------------------------------------
// Exact insertion-point inventory
// ---------------------------------------------------------------------------

const OWNER = "src/renderer/lib/security/renderer-html-policy.ts"
const SHIKI_BEHAVIOR = [
  "tests/renderer-hardening-content-shiki.test.ts",
  "tests/renderer-hardening-impl-html-policy.test.ts",
]

interface InventoryEntry {
  construct: RendererSinkConstruct
  file: string
  symbol: string
  count: number
  status: "reviewed" | "constant-clear" | "superseded-pending-removal"
  /** Reviewed producer contract for the inserted value. */
  producer: string
  /** Module specifier suffixes the file must import (all of them). */
  producerImports: string[]
  /** Exact value text the sink receives. */
  value: RegExp
  /** Retained adversarial behavior evidence for this sink. */
  behaviorTests: string[]
}

const INVENTORY: InventoryEntry[] = [
  {
    construct: "react-dangerouslySetInnerHTML",
    file: "src/renderer/components/chat-markdown-renderer.tsx",
    symbol: "CodeBlock",
    count: 1,
    status: "reviewed",
    producer:
      "renderer-html-policy#reviewedInnerHtml over shiki-theme-loader#highlightCode or reviewedEscapedText",
    producerImports: [
      "lib/security/renderer-html-policy",
      "lib/themes/shiki-theme-loader",
    ],
    value: /^\{reviewedInnerHtml\(htmlContent\)\}$/,
    behaviorTests: [
      ...SHIKI_BEHAVIOR,
      "tests/renderer-hardening-content.test.ts",
      "tests/renderer-hardening-impl-markdown.test.ts",
    ],
  },
  {
    construct: "react-dangerouslySetInnerHTML",
    file: "src/renderer/features/agents/ui/agent-edit-tool.tsx",
    symbol: "DiffLineRow",
    count: 1,
    status: "reviewed",
    producer: "renderer-html-policy#reviewedInnerHtml over highlightCode",
    producerImports: [
      "lib/security/renderer-html-policy",
      "lib/themes/shiki-theme-loader",
    ],
    value: /^\{reviewedInnerHtml\(highlightedHtml\)\}$/,
    behaviorTests: SHIKI_BEHAVIOR,
  },
  {
    construct: "react-dangerouslySetInnerHTML",
    file: "src/renderer/features/agents/ui/agent-mcp-tool-call.tsx",
    symbol: "HighlightedJson",
    count: 1,
    status: "reviewed",
    producer: "renderer-html-policy#reviewedInnerHtml over highlightCode",
    producerImports: [
      "lib/security/renderer-html-policy",
      "lib/themes/shiki-theme-loader",
    ],
    value: /^\{reviewedInnerHtml\(html\)\}$/,
    behaviorTests: SHIKI_BEHAVIOR,
  },
  {
    construct: "react-dangerouslySetInnerHTML",
    file: "src/renderer/features/agents/ui/message-json-display.tsx",
    symbol: "MessageJsonDisplay",
    count: 1,
    status: "reviewed",
    producer: "renderer-html-policy#reviewedInnerHtml over highlightCode",
    producerImports: [
      "lib/security/renderer-html-policy",
      "lib/themes/shiki-theme-loader",
    ],
    value: /^\{reviewedInnerHtml\(highlightedHtml\)\}$/,
    behaviorTests: SHIKI_BEHAVIOR,
  },
  {
    // Inline and fullscreen sinks share the one sanitized string.
    construct: "react-dangerouslySetInnerHTML",
    file: "src/renderer/components/mermaid-block.tsx",
    symbol: "MermaidBlockInner",
    count: 2,
    status: "reviewed",
    producer:
      "mermaid-svg-sanitizer#sanitizeMermaidSvg (specialized SVG adapter)",
    producerImports: ["lib/security/mermaid-svg-sanitizer"],
    value: /^\{\{ __html: renderState\.svg \}\}$/,
    behaviorTests: [
      "tests/renderer-mermaid-xss.test.ts",
      "tests/renderer-hardening-mermaid-editor.test.ts",
    ],
  },
  {
    // Named raw-CSS dependency-prop rule (Q9 diff path): the <FileDiff> and
    // <PatchDiff> options.
    construct: "dependency-unsafeCSS",
    file: "src/renderer/features/agents/ui/agent-diff-view.tsx",
    symbol: "FileDiffCard",
    count: 2,
    status: "reviewed",
    producer:
      "app-owned constant PIERRE_DIFFS_THEME_CSS (never producer output)",
    producerImports: [],
    value: /^PIERRE_DIFFS_THEME_CSS$/,
    behaviorTests: ["tests/renderer-hardening-content-diff.test.ts"],
  },
]

function inventoryKey(construct: string, file: string, symbol: string) {
  return `${construct} ${file}#${symbol}`
}

function groupSites(sites: RendererSinkSite[]) {
  const groups = new Map<string, RendererSinkSite[]>()
  for (const site of sites) {
    const key = inventoryKey(site.construct, site.file, site.symbol)
    groups.set(key, [...(groups.get(key) ?? []), site])
  }
  return groups
}

function importSpecifiers(file: string): string[] {
  return parse(file)
    .statements.filter(ts.isImportDeclaration)
    .map(
      (declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text,
    )
}

describe("renderer HTML insertion sinks: exact inventory", () => {
  const sites = scanRendererTree(repoRoot, rendererRoot)
  const groups = groupSites(sites)

  test("every raw-markup, script and raw-CSS insertion point is an exact inventory entry", () => {
    const actual = [...groups.entries()]
      .map(([key, group]) => `${key} x${group.length}`)
      .sort()
    const expected = INVENTORY.map(
      (entry) =>
        `${inventoryKey(entry.construct, entry.file, entry.symbol)} x${entry.count}`,
    ).sort()
    expect(actual).toEqual(expected)
  })

  test("each inventoried sink receives exactly its reviewed producer's value shape", () => {
    const mismatches = INVENTORY.flatMap((entry) =>
      (
        groups.get(inventoryKey(entry.construct, entry.file, entry.symbol)) ??
        []
      )
        .filter((site) => !entry.value.test(site.valueText.trim()))
        .map((site) => `${site.file}:${site.line} ${site.valueText}`),
    )
    expect(mismatches).toEqual([])
  })

  test("each inventoried sink's module imports its named reviewed producer", () => {
    const unbound = INVENTORY.flatMap((entry) => {
      const imports = importSpecifiers(entry.file)
      return entry.producerImports
        .filter(
          (producer) =>
            !imports.some((specifier) => specifier.endsWith(producer)),
        )
        .map((producer) => `${entry.file} does not import ${producer}`)
    })
    expect(unbound).toEqual([])
  })

  test("each value-bearing sink names retained adversarial behavior tests that exist", () => {
    const missing = INVENTORY.filter(
      (entry) => entry.status !== "constant-clear",
    ).flatMap((entry) =>
      entry.behaviorTests.length === 0
        ? [`${entry.file}#${entry.symbol}: no behavior test`]
        : entry.behaviorTests
            .filter((path) => !existsSync(join(repoRoot, path)))
            .map((path) => `${entry.file}#${entry.symbol}: ${path}`),
    )
    expect(missing).toEqual([])
  })

  test("no superseded entry remains (mentions undo/redo restores removed by task 2.6)", () => {
    expect(
      INVENTORY.filter(
        (entry) => entry.status === "superseded-pending-removal",
      ).map((entry) => `${entry.construct} ${entry.file}#${entry.symbol}`),
    ).toEqual([])
  })

  test("no dynamic script creation, script.src assignment, remote import() or importScripts (react-scan loader removed)", () => {
    const scriptSites = sites
      .filter((site) =>
        [
          "dynamic-script",
          "script-src-assignment",
          "remote-import",
          "import-scripts",
          "html-remote-script",
          "html-inline-script",
        ].includes(site.construct),
      )
      .map((site) => `${site.construct} ${site.file}:${site.line}`)
    expect(scriptSites).toEqual([])
    expect(
      read(
        "src/renderer/components/dialogs/settings-tabs/agents-debug-tab.tsx",
      ),
    ).not.toContain("unpkg.com")
  })

  test("the guard walks all of src/renderer including public/ and every scanned extension", () => {
    const scanned = listRendererScannedFiles(rendererRoot).map(repoPath)
    expect(scanned).toContain("src/renderer/index.html")
    expect(scanned).toContain("src/renderer/public/error-handler.js")
    expect(scanned).toContain("src/renderer/public/theme-init.js")
    expect(scanned.every((file) => file.startsWith("src/renderer/"))).toBe(true)
    // Rooted at src/renderer: shared denylist literals are not renderer sinks.
    expect(scanned.some((file) => file.includes("plugin-controlled-ui"))).toBe(
      false,
    )
  })
})

// ---------------------------------------------------------------------------
// Scanner self-test: negative fixtures for every construct
// ---------------------------------------------------------------------------

describe("renderer sink scanner self-test", () => {
  const fixtures: Array<[string, string, RendererSinkConstruct[]]> = [
    [
      "jsx.tsx",
      "export const A = (p) => <div dangerouslySetInnerHTML={{ __html: p.x }} />",
      ["react-dangerouslySetInnerHTML"],
    ],
    [
      "create-element.ts",
      'export const b = (x) => React.createElement("div", { dangerouslySetInnerHTML: { __html: x } })',
      ["react-dangerouslySetInnerHTML"],
    ],
    [
      "inner.ts",
      "export function w(el, x) { el.innerHTML = x }",
      ["dom-html-write"],
    ],
    [
      "inner-append.ts",
      'export function w(el) { el.innerHTML += "<b>" }',
      ["dom-html-write"],
    ],
    [
      "bracket.js",
      'export function w(el, x) { el["outerHTML"] = x }',
      ["dom-html-write"],
    ],
    [
      "assign.cjs",
      "module.exports = function w(el, x) { Object.assign(el, { innerHTML: x }) }",
      ["dom-html-write"],
    ],
    [
      "reflect.ts",
      'export function w(el, x) { Reflect.set(el, "innerHTML", x) }',
      ["dom-html-write"],
    ],
    [
      "clear.ts",
      'export function c(el) { el.innerHTML = "" }',
      ["dom-html-empty-clear"],
    ],
    [
      "adjacent.jsx",
      'export function a(el, x) { el.insertAdjacentHTML("beforeend", x) }',
      ["insertAdjacentHTML"],
    ],
    [
      "write.ts",
      "export function d(x) { document.write(x); window.document.writeln(x) }",
      ["document-write", "document-write"],
    ],
    [
      "fragment.ts",
      "export function f(r, x) { return r.createContextualFragment(x) }",
      ["contextual-fragment"],
    ],
    [
      "unsafe.ts",
      "export function u(el, x) { el.setHTMLUnsafe(x); return Document.parseHTMLUnsafe(x) }",
      ["set-html-unsafe", "set-html-unsafe"],
    ],
    [
      "srcdoc.tsx",
      'export const F = (x) => <iframe srcDoc={x} />; export function s(f, x) { f.srcdoc = x; f.setAttribute("srcdoc", x) }',
      ["srcdoc", "srcdoc", "srcdoc"],
    ],
    [
      "script.ts",
      'export function s(u) { const tag = document.createElement("script"); tag.src = u; document.head.append(tag) }',
      ["dynamic-script", "script-src-assignment"],
    ],
    [
      "script-ns.ts",
      'export function s(u) { const el = document.createElementNS("http://www.w3.org/1999/xhtml", "script"); el.setAttribute("src", u) }',
      ["dynamic-script", "script-src-assignment"],
    ],
    [
      "script-typed.ts",
      "export function s(node: HTMLScriptElement, u: string) { node.src = u }",
      ["script-src-assignment"],
    ],
    [
      "jsx-script.tsx",
      'export const S = () => <script src="https://cdn.example/x.js" />',
      ["dynamic-script"],
    ],
    [
      "import.ts",
      'export const r = () => import("https://cdn.example/x.js"); export const c = (u) => import(u)',
      ["remote-import", "remote-import"],
    ],
    [
      "worker.js",
      'importScripts("https://cdn.example/x.js"); self.importScripts("y.js")',
      ["import-scripts", "import-scripts"],
    ],
    [
      "dependency.tsx",
      "export const D = (x) => <FileDiff options={{ unsafeCSS: x }} unsafeCSS={x} prerenderedHTML={x} />",
      [
        "dependency-unsafeCSS",
        "dependency-unsafeCSS",
        "dependency-prerenderedHTML",
      ],
    ],
    [
      "page.html",
      '<body onload="x()"><iframe srcdoc="<b>"></iframe><script src="https://cdn.example/x.js"></script><script>inline()</script></body>',
      [
        "html-inline-handler",
        "html-srcdoc",
        "html-remote-script",
        "html-inline-script",
      ],
    ],
    [
      "clean.tsx",
      [
        "// el.innerHTML = x and dangerouslySetInnerHTML in a comment",
        'const text = "el.innerHTML = x; document.write(y)"',
        "export function ok(el, img, x) {",
        "  const current = el.innerHTML",
        "  el.textContent = x",
        "  img.src = x",
        '  el.setAttribute("href", x)',
        "  return current + text",
        "}",
        'export const lazy = () => import("./local-module")',
      ].join("\n"),
      [],
    ],
    [
      "clean-page.html",
      '<script type="module" src="./main.tsx"></script><div data-on="x"></div>',
      [],
    ],
  ]

  test("detects every construct in its negative fixture and ignores look-alikes", () => {
    const detected = fixtures.map(([file, source]) => ({
      file,
      constructs: scanRendererSource(file, source).map(
        (site) => site.construct,
      ),
    }))
    expect(detected).toEqual(
      fixtures.map(([file, , constructs]) => ({ file, constructs })),
    )
  })

  test("the fixtures cover every scanned construct", () => {
    const covered = new Set(fixtures.flatMap(([, , constructs]) => constructs))
    expect([...covered].sort()).toEqual(
      [
        "react-dangerouslySetInnerHTML",
        "dom-html-write",
        "dom-html-empty-clear",
        "insertAdjacentHTML",
        "document-write",
        "contextual-fragment",
        "set-html-unsafe",
        "srcdoc",
        "dynamic-script",
        "script-src-assignment",
        "remote-import",
        "import-scripts",
        "dependency-unsafeCSS",
        "dependency-prerenderedHTML",
        "html-inline-handler",
        "html-srcdoc",
        "html-remote-script",
        "html-inline-script",
      ].sort(),
    )
  })
})

// ---------------------------------------------------------------------------
// Named rules
// ---------------------------------------------------------------------------

describe("renderer HTML policy named rules", () => {
  test("requires Mermaid SVG sanitization before insertion", () => {
    const source = read("src/renderer/components/mermaid-block.tsx")

    expect(source).toContain("securityLevel: MERMAID_SECURITY_LEVEL")
    expect(source).toContain("const sanitizedSvg = sanitizeMermaidSvg(svg)")
    expect(source).toContain("mermaidCache.set(cacheKey, sanitizedSvg)")
    expect(source).toContain(
      'setRenderState({ status: "success", svg: sanitizedSvg })',
    )
  })

  test("documents remaining Shiki-backed HTML sinks: highlightCode is their sole producer and returns reviewed output", () => {
    for (const file of [
      "src/renderer/components/chat-markdown-renderer.tsx",
      "src/renderer/features/agents/ui/agent-edit-tool.tsx",
      "src/renderer/features/agents/ui/agent-mcp-tool-call.tsx",
      "src/renderer/features/agents/ui/message-json-display.tsx",
    ]) {
      const source = read(file)
      expect(source).toContain("highlightCode(")
    }

    const highlighter = read("src/renderer/lib/themes/shiki-theme-loader.ts")
    expect(highlighter).toContain("highlighter.codeToHtml(code")
    expect(highlighter).toContain("lang,")
    expect(highlighter).toContain(': "plaintext"')
    expect(highlighter).toContain(
      "reviewShikiCodeToHtmlOutput(generatedHtml, code)",
    )
    expect(highlighter).toContain("Promise<ReviewedRendererHtml>")
    expect(highlighter).not.toMatch(/match\s*\?\s*match\[1\]\s*:\s*code/)

    const callers = listRendererScannedFiles(rendererRoot)
      .map(repoPath)
      .filter((file) => /\.codeToHtml\s*\(/.test(read(file)))
    expect(callers).toEqual(["src/renderer/lib/themes/shiki-theme-loader.ts"])
  })

  test("the reviewed owner is the only renderer module with an HTML escaping policy", () => {
    const escapingLiteral = /&(?:lt|gt|amp|quot|#x?[0-9a-f]+);/i
    const owners = listRendererScannedFiles(rendererRoot)
      .map(repoPath)
      .filter((file) => /\.(?:ts|tsx)$/.test(file))
      .filter(
        (file) =>
          collect(
            parse(file),
            (
              node,
            ): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
              (ts.isStringLiteral(node) ||
                ts.isNoSubstitutionTemplateLiteral(node)) &&
              escapingLiteral.test(node.text),
          ).length > 0,
      )
    expect(owners).toEqual([OWNER])
  })

  test("both Streamdown mounts go through the one wrapper with the owner's explicit rehype chain", () => {
    const mounts = listRendererScannedFiles(rendererRoot)
      .map(repoPath)
      .filter((file) => file.endsWith(".tsx"))
      .flatMap((file) =>
        collect(
          parse(file),
          (node): node is ts.JsxOpeningElement | ts.JsxSelfClosingElement =>
            (ts.isJsxOpeningElement(node) ||
              ts.isJsxSelfClosingElement(node)) &&
            node.tagName.getText() === "Streamdown",
        ).map((element) => ({
          file,
          attributes: Object.fromEntries(
            element.attributes.properties
              .filter(ts.isJsxAttribute)
              .map((attribute) => [
                attribute.name.getText(),
                attribute.initializer?.getText() ?? "",
              ]),
          ),
          spreads: element.attributes.properties.filter(ts.isJsxSpreadAttribute)
            .length,
        })),
      )
    expect(mounts).toHaveLength(1)
    expect(mounts[0].file).toBe(
      "src/renderer/components/reviewed-streamdown.tsx",
    )
    expect(mounts[0].spreads).toBe(0)
    expect(mounts[0].attributes.rehypePlugins).toBe(
      "{REVIEWED_MARKDOWN_REHYPE_PLUGINS}",
    )
    expect(mounts[0].attributes.remarkPlugins).toBe(
      "{REVIEWED_MARKDOWN_REMARK_PLUGINS}",
    )
    expect(mounts[0].attributes.components).toBe("{components}")

    const wrapperUsers = listRendererScannedFiles(rendererRoot)
      .map(repoPath)
      .filter((file) => /<ReviewedStreamdown\b/.test(read(file)))
    expect(wrapperUsers).toEqual([
      "src/renderer/components/chat-markdown-renderer.tsx",
    ])
    const chat = read("src/renderer/components/chat-markdown-renderer.tsx")
    expect(chat.match(/<ReviewedStreamdown\b/g)).toHaveLength(2)
    expect(
      listRendererScannedFiles(rendererRoot)
        .map(repoPath)
        .filter((file) => /\bdefaultRehypePlugins\b/.test(read(file))),
    ).toEqual([])
  })

  test("both diff unsafeCSS sites use the interpolation-free PIERRE_DIFFS_THEME_CSS constant and prerenderedHTML is absent", () => {
    const sites = scanRendererTree(repoRoot, rendererRoot)
    expect(
      sites
        .filter((site) => site.construct === "dependency-unsafeCSS")
        .map((site) => site.valueText),
    ).toEqual(["PIERRE_DIFFS_THEME_CSS", "PIERRE_DIFFS_THEME_CSS"])
    expect(
      sites.filter((site) => site.construct === "dependency-prerenderedHTML"),
    ).toEqual([])
    const declarations = collect(
      parse("src/renderer/features/agents/ui/agent-diff-view.tsx"),
      ts.isVariableDeclaration,
    ).filter(
      (declaration) => declaration.name.getText() === "PIERRE_DIFFS_THEME_CSS",
    )
    expect(declarations).toHaveLength(1)
    const [declaration] = declarations
    expect(
      (declaration.parent.flags & ts.NodeFlags.Const) === ts.NodeFlags.Const,
    ).toBe(true)
    expect(
      declaration.initializer !== undefined &&
        ts.isNoSubstitutionTemplateLiteral(declaration.initializer),
    ).toBe(true)
  })

  test("Q9: the Vite alias binds exactly the four Shiki specifiers for @pierre/diffs importers to the Locus shim", () => {
    const config = parse("electron.vite.config.ts")
    const resolveId = collect(config, ts.isMethodDeclaration).filter(
      (method) => method.name.getText() === "resolveId",
    )
    expect(resolveId).toHaveLength(1)
    const compared = collect(resolveId[0], ts.isBinaryExpression)
      .filter(
        (binary) =>
          binary.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
          binary.left.getText() === "source",
      )
      .map((binary) => (binary.right as ts.StringLiteral).text)
      .sort()
    expect(compared).toEqual([
      "@shikijs/engine-javascript",
      "@shikijs/transformers",
      "shiki",
      "shiki/core",
    ])
    const configText = read("electron.vite.config.ts")
    expect(configText).toContain('"/node_modules/@pierre/diffs/"')
    expect(configText).toContain(
      '"src/renderer/lib/vendor/pierre-diffs-shiki-shim.ts"',
    )
    const aliasKeys = collect(config, ts.isPropertyAssignment)
      .filter((property) => property.name.getText() === "alias")
      .flatMap((property) =>
        ts.isObjectLiteralExpression(property.initializer)
          ? property.initializer.properties.map((entry) =>
              entry.name
                ? entry.name.getText().replace(/["']/g, "")
                : "<spread>",
            )
          : ["<non-literal alias>"],
      )
    expect(aliasKeys).toEqual(["@"])
  })

  test("Q9: the shim is the only Shiki-API module, keeps no escaping policy and routes codeToHtml through the owner", () => {
    const shikiApiExport =
      /export\s+(?:async\s+)?(?:function|const)\s+(?:createHighlighter|createHighlighterCoreSync|createJavaScriptRegexEngine|bundledLanguages|bundledThemes|codeToHast|codeToHtml)\b/
    const shims = listRendererScannedFiles(rendererRoot)
      .map(repoPath)
      .filter((file) => shikiApiExport.test(read(file)))
    expect(shims).toEqual([
      "src/renderer/lib/vendor/pierre-diffs-shiki-shim.ts",
    ])
    const shim = read("src/renderer/lib/vendor/pierre-diffs-shiki-shim.ts")
    expect(shim).toContain('from "../security/renderer-html-policy"')
    expect(shim).toContain("return reviewedPlainCodeToHtml(code)")
    expect(shim).not.toMatch(/function\s+escapeHtml\b/)
  })

  test("Q9: the reviewed diff producer stays the main-thread path (worker entry guard)", () => {
    const forbidden =
      /@pierre\/diffs\/worker|worker-portable\.js|WorkerPoolContextProvider|getOrCreateWorkerPoolSingleton|workerFactory/
    const hits = listRendererScannedFiles(rendererRoot)
      .map(repoPath)
      .filter((file) => forbidden.test(read(file)))
    expect(hits).toEqual([])
  })

  test("the zero-caller diff-view-highlighter getAST adapter stays dormant", () => {
    const callers = listRendererScannedFiles(rendererRoot)
      .map(repoPath)
      .filter(
        (file) => file !== "src/renderer/lib/themes/diff-view-highlighter.ts",
      )
      .filter((file) => /\.getAST\s*\(/.test(read(file)))
    expect(callers).toEqual([])
  })

  test("the reviewed executable-URL click sink admits only http/https/mailto and backs the preload/tRPC endpoints", () => {
    const localOnly = read("src/main/lib/local-only.ts")
    expect(localOnly).toContain(
      'const ALLOWED_EXTERNAL_URL_SCHEMES = new Set(["http:", "https:", "mailto:"])',
    )
    expect(localOnly).toMatch(/export async function openExternalUrl\(/)
    expect(read("src/preload/index.ts")).toContain(
      'openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url)',
    )
    const mainWindow = read("src/main/windows/main.ts")
    const handler = mainWindow.slice(
      mainWindow.indexOf('ipcMain.handle("shell:open-external"'),
    )
    expect(handler.slice(0, 200)).toContain(
      'await openExternalUrl("open external URL", url)',
    )
    const external = read("src/main/lib/trpc/routers/external.ts")
    const procedure = external.slice(
      external.indexOf("openExternal: publicProcedure"),
    )
    expect(procedure.slice(0, 200)).toContain(
      'await openExternalUrl("open external URL", url)',
    )
  })

  test("plugin-controlled UI stays a classified schema-bounded text producer", () => {
    expect(read("src/shared/plugin-controlled-ui.ts")).toMatch(
      /export function parseControlledUiManifest\(/,
    )
  })
})
