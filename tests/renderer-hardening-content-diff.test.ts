/**
 * Test-first suite (Domain A) for the Owner-approved Q9 compromise:
 * "Dependency diff rendering is covered by the reviewed-producer contract"
 * (runtime-security-baseline delta; design D2 diff profile, D10 Q9 row;
 * task 2.10; verification.md freeze-time proof set and the 2026-09-09
 * negative-control / multi-file clarifications).
 *
 * Binding: under `bun test --isolate`, `@pierre/diffs` would otherwise load
 * its nested real Shiki 3. Exactly the four Vite-aliased specifiers
 * (`shiki`, `shiki/core`, `@shikijs/engine-javascript`,
 * `@shikijs/transformers`), resolved from the @pierre/diffs importer the same
 * way `electron.vite.config.ts#pierreDiffsPlainHighlighterPlugin` matches
 * them, are bound to the Locus shim BEFORE the diff renderer is imported. The
 * binding and the shim's `createPlainHast` text-node shape are asserted before
 * any hostile case; the load-bearing `hast-util-to-html@9.0.5` escaper stays
 * un-aliased and real.
 *
 * All fixtures use Locus's actual option set: `disableFileHeader: true`,
 * `unsafeCSS: PIERRE_DIFFS_THEME_CSS` (read from the repository constant in
 * agent-diff-view.tsx), default `hunkSeparators` (`line-info`) and
 * `expandUnchanged: false`, with `theme` from Locus's `getShikiTheme`.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"
import {
  expectedDiffUnsafeCssTextContent,
  findExecutableMarkup,
  installHappyDom,
} from "./renderer-hardening-content-oracle"

const repoRoot = join(import.meta.dir, "..")
const testWindow = installHappyDom()

const PIERRE_IMPORTER_DIR = join(
  repoRoot,
  "node_modules/@pierre/diffs/dist/components",
)
const SHIM_PATH = join(
  repoRoot,
  "src/renderer/lib/vendor/pierre-diffs-shiki-shim.ts",
)
const ALIASED_SPECIFIERS = [
  "shiki",
  "shiki/core",
  "@shikijs/engine-javascript",
  "@shikijs/transformers",
] as const

const shim = await import(SHIM_PATH)
const boundPaths = ALIASED_SPECIFIERS.map((specifier) =>
  Bun.resolveSync(specifier, PIERRE_IMPORTER_DIR),
)
for (const path of boundPaths) {
  mock.module(path, () => shim)
}

const { act, createElement, Component } = await import("react")
const { createRoot } = await import("react-dom/client")
const { FileDiff, PatchDiff } = await import("@pierre/diffs/react")
const { parseDiffFromFile, wrapUnsafeCSS } = await import("@pierre/diffs")
const { getShikiTheme } = await import(
  "../src/renderer/lib/themes/diff-view-highlighter"
)

/** The repository constant is the single source of truth (design D1/D2). */
function readPierreDiffsThemeCss(): string {
  const path = join(
    repoRoot,
    "src/renderer/features/agents/ui/agent-diff-view.tsx",
  )
  const sourceFile = ts.createSourceFile(
    path,
    readFileSync(path, "utf-8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  let value: string | null = null
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText() === "PIERRE_DIFFS_THEME_CSS" &&
      node.initializer &&
      ts.isNoSubstitutionTemplateLiteral(node.initializer)
    ) {
      value = node.initializer.text
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  expect(value).not.toBeNull()
  return value as unknown as string
}

const PIERRE_DIFFS_THEME_CSS = readPierreDiffsThemeCss()
const DIFF_PROFILE = {
  kind: "diff" as const,
  expectedUnsafeCssTextContent: expectedDiffUnsafeCssTextContent(
    wrapUnsafeCSS(PIERRE_DIFFS_THEME_CSS),
  ),
}
const SHIKI_THEME = getShikiTheme("github-dark", true)

type Root = ReturnType<typeof createRoot>
let mountedRoots: Root[] = []

afterEach(async () => {
  for (const root of mountedRoots) {
    await act(async () => root.unmount())
  }
  mountedRoots = []
  testWindow.document.body.replaceChildren()
})

function locusFileDiffOptions(
  diffStyle: "unified" | "split",
  unsafeCSS: string | undefined,
) {
  return {
    diffStyle,
    diffIndicators: "classic",
    themeType: "dark",
    overflow: "scroll",
    disableFileHeader: true,
    expandUnchanged: false,
    theme: SHIKI_THEME,
    unsafeCSS,
  }
}

function locusPatchDiffOptions(diffStyle: "unified" | "split") {
  return {
    diffStyle,
    diffIndicators: "classic",
    themeType: "dark",
    overflow: "scroll",
    disableFileHeader: true,
    theme: SHIKI_THEME,
    unsafeCSS: PIERRE_DIFFS_THEME_CSS,
  }
}

class TestRenderBoundary extends Component<
  { onError: (message: string) => void; children: unknown },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error) {
    this.props.onError(error.message)
  }
  render() {
    return this.state.failed
      ? createElement("p", { "data-test-boundary": "" }, "render failed")
      : (this.props.children as never)
  }
}

async function renderDiff(element: ReturnType<typeof createElement>) {
  const renderErrors: string[] = []
  const container = testWindow.document.createElement(
    "div",
  ) as unknown as HTMLElement
  testWindow.document.body.append(container as never)
  const root = createRoot(container, {
    onCaughtError: () => {},
  })
  mountedRoots.push(root)
  await act(async () => {
    root.render(
      createElement(
        TestRenderBoundary,
        { onError: (message: string) => renderErrors.push(message) },
        element,
      ),
    )
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250))
  })
  return { container, renderErrors }
}

function shadowRoots(container: HTMLElement): Array<{
  textContent: string | null
  querySelectorAll(selector: string): ArrayLike<Element>
  querySelector(selector: string): Element | null
  appendChild(node: unknown): unknown
}> {
  return Array.from(container.querySelectorAll("*"))
    .map((element) => (element as unknown as { shadowRoot: never }).shadowRoot)
    .filter((root) => root !== null && root !== undefined)
}

function renderedDiffText(container: HTMLElement): string {
  return shadowRoots(container)
    .map((root) => root.textContent ?? "")
    .join("")
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ")
}

function contentColumnsHaveOnlyText(container: HTMLElement): boolean[] {
  return shadowRoots(container).flatMap((root) =>
    Array.from(root.querySelectorAll("[data-column-content]")).map((column) =>
      Array.from(column.childNodes).every((child) => child.nodeType === 3),
    ),
  )
}

// --- fixtures ---------------------------------------------------------------

function numberedLines(count: number, prefix: string): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`)
}

const benignOld = `${numberedLines(60, "const value").join("\n")}\n`
const benignNew = benignOld
  .replace("const value 5\n", "const value five\n")
  .replace("const value 50\n", "const value fifty\n")

const HOSTILE_LINES = [
  '</span></code></pre><img src=x onerror="window.__pwned=1">',
  "<script>window.__pwned = 1</script>",
  '"><svg onload=window.__pwned=1><foreignObject></foreignObject></svg>',
  "</style><style>@import url(https://evil.example/x.css)</style>",
  "&#60;img src=x onerror=window.__pwned=1&#62; &lt;b&gt;entity&lt;/b&gt;",
  '<!-- ]]> --><a href="javascript:window.__pwned=1">x</a>',
  '<use href="#diffs-icon-expand"></use><use href="https://evil.example/s.svg#x"/>',
]
const HOSTILE_NAME = 'src/<img src=x onerror="window.__pwned=1">.ts'

const hostileOld = `${numberedLines(40, "keep").join("\n")}\n`
const hostileNewLines = hostileOld.split("\n")
hostileNewLines.splice(3, 1, HOSTILE_LINES[0], HOSTILE_LINES[1])
hostileNewLines.splice(30, 1, ...HOSTILE_LINES.slice(2))
const hostileNew = hostileNewLines.join("\n")

const HOSTILE_PATCH = [
  `diff --git a/${HOSTILE_NAME} b/${HOSTILE_NAME}`,
  "index 1111111..2222222 100644",
  `--- a/${HOSTILE_NAME}`,
  `+++ b/${HOSTILE_NAME}`,
  "@@ -1,3 +1,3 @@ function <script>window.__pwned=1</script>() {",
  " context one",
  "-old <b>line</b>",
  `+${HOSTILE_LINES[0]}`,
  " context two",
  '@@ -20,3 +20,3 @@ class "><svg onload=window.__pwned=1>',
  " ctx a",
  "-old two",
  `+${HOSTILE_LINES[3]}`,
  " ctx b",
  "",
].join("\n")

const HOSTILE_MULTI_FILE_PATCH = [
  HOSTILE_PATCH,
  "diff --git a/second.ts b/second.ts",
  "index 3333333..4444444 100644",
  "--- a/second.ts",
  "+++ b/second.ts",
  "@@ -1,1 +1,1 @@",
  "-a",
  `+${HOSTILE_LINES[1]}`,
  "",
].join("\n")

// --- tests ------------------------------------------------------------------

describe("Q9 diff producer binding: the four aliased specifiers resolve to the Locus shim", () => {
  test("[green-by-design] all four specifiers imported by @pierre/diffs are bound to the shim and createPlainHast yields text-node HAST", async () => {
    const bound = await Promise.all(boundPaths.map((path) => import(path)))
    expect(
      bound.map(
        (module) => module.createHighlighter === shim.createHighlighter,
      ),
    ).toEqual([true, true, true, true])
    const hast = shim
      .createHighlighterCoreSync()
      .codeToHast('a <img src=x onerror="1">\n</code>', {})
    expect(hast).toEqual({
      type: "element",
      tagName: "pre",
      properties: {},
      children: [
        {
          type: "element",
          tagName: "code",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "span",
              properties: {},
              children: [
                { type: "text", value: 'a <img src=x onerror="1">\n' },
              ],
            },
            {
              type: "element",
              tagName: "span",
              properties: {},
              children: [{ type: "text", value: "</code>" }],
            },
          ],
        },
      ],
    })
  })
})

describe("Dependency diff rendering is covered by the reviewed-producer contract (<FileDiff>)", () => {
  for (const diffStyle of ["unified", "split"] as const) {
    test(`[green-by-design] benign collapsed multi-region ${diffStyle} FileDiff satisfies the strict diff profile with separator/expand icons`, async () => {
      const { container, renderErrors } = await renderDiff(
        createElement(FileDiff as never, {
          fileDiff: parseDiffFromFile(
            { name: "src/benign.ts", contents: benignOld },
            { name: "src/benign.ts", contents: benignNew },
          ),
          options: locusFileDiffOptions(diffStyle, PIERRE_DIFFS_THEME_CSS),
        }),
      )
      expect(renderErrors).toEqual([])
      const roots = shadowRoots(container)
      expect(roots.length).toBe(1)
      expect(
        roots[0].querySelectorAll(
          "[data-separator] use, [data-expand-button] use",
        ).length,
      ).toBeGreaterThan(0)
      expect(contentColumnsHaveOnlyText(container).every(Boolean)).toBe(true)
      expect(renderedDiffText(container)).toContain("const value fifty")
      expect(findExecutableMarkup(container as never, DIFF_PROFILE)).toEqual([])
    })

    test(`[green-by-design] hostile file names and line content in a ${diffStyle} FileDiff stay text under the diff profile`, async () => {
      const { container, renderErrors } = await renderDiff(
        createElement(FileDiff as never, {
          fileDiff: parseDiffFromFile(
            { name: HOSTILE_NAME, contents: hostileOld },
            { name: HOSTILE_NAME, contents: hostileNew },
          ),
          options: locusFileDiffOptions(diffStyle, PIERRE_DIFFS_THEME_CSS),
        }),
      )
      expect(renderErrors).toEqual([])
      expect(contentColumnsHaveOnlyText(container).every(Boolean)).toBe(true)
      // Whitespace is normalised: the library may widen spaces in displayed
      // lines (observed for "]]> -->"); only markup/text fidelity matters.
      const text = collapseWhitespace(renderedDiffText(container))
      expect(
        HOSTILE_LINES.filter(
          (line) => !text.includes(collapseWhitespace(line)),
        ),
      ).toEqual([])
      expect(findExecutableMarkup(container as never, DIFF_PROFILE)).toEqual([])
    })
  }
})

describe("Dependency diff rendering is covered by the reviewed-producer contract (<PatchDiff>)", () => {
  for (const diffStyle of ["unified", "split"] as const) {
    test(`[green-by-design] hostile patch text (file names, hunk headers, lines) in a ${diffStyle} PatchDiff stays text under the diff profile`, async () => {
      const { container, renderErrors } = await renderDiff(
        createElement(PatchDiff as never, {
          patch: HOSTILE_PATCH,
          options: locusPatchDiffOptions(diffStyle),
        }),
      )
      expect(renderErrors).toEqual([])
      expect(contentColumnsHaveOnlyText(container).every(Boolean)).toBe(true)
      const text = renderedDiffText(container)
      expect(text).toContain(HOSTILE_LINES[0])
      expect(text).toContain(HOSTILE_LINES[3])
      expect(findExecutableMarkup(container as never, DIFF_PROFILE)).toEqual([])
    })
  }

  test("[green-by-design] a hostile multi-file patch produces no DOM (getSingularPatch throws before rendering)", async () => {
    const { container, renderErrors } = await renderDiff(
      createElement(PatchDiff as never, {
        patch: HOSTILE_MULTI_FILE_PATCH,
        options: locusPatchDiffOptions("unified"),
      }),
    )
    expect(renderErrors.length).toBe(1)
    expect(shadowRoots(container)).toEqual([])
    expect(container.querySelectorAll("diffs-container").length).toBe(0)
    expect(findExecutableMarkup(container as never, DIFF_PROFILE)).toEqual([
      {
        rule: "diff-unsafe-css-count",
        path: "",
        detail: "expected exactly one style[data-unsafe-css], found 0",
      },
    ])
  })
})

describe("D2 strictly enumerated diff profile negative controls", () => {
  async function renderBenign(unsafeCSS: string | undefined) {
    return renderDiff(
      createElement(FileDiff as never, {
        fileDiff: parseDiffFromFile(
          { name: "src/benign.ts", contents: benignOld },
          { name: "src/benign.ts", contents: benignNew },
        ),
        options: locusFileDiffOptions("unified", unsafeCSS),
      }),
    )
  }

  function rules(container: HTMLElement): string[] {
    return findExecutableMarkup(container as never, DIFF_PROFILE)
      .map((violation) => violation.rule)
      .sort()
  }

  test("[green-by-design] one added non-line-break character in the unsafeCSS input fails against the unchanged repository constant", async () => {
    const { container } = await renderBenign(`${PIERRE_DIFFS_THEME_CSS}x`)
    expect(rules(container)).toEqual(["diff-unsafe-css-drift"])
  })

  test("[green-by-design] a missing unsafe-CSS style element fails", async () => {
    const { container } = await renderBenign(undefined)
    expect(rules(container)).toEqual(["diff-unsafe-css-count"])
  })

  test("[green-by-design] a duplicate style, a lost data-unsafe-css marker, or a non-Text/br child fails", async () => {
    const duplicate = await renderBenign(PIERRE_DIFFS_THEME_CSS)
    const [duplicateRoot] = shadowRoots(duplicate.container)
    const style = duplicateRoot.querySelector("style[data-unsafe-css]")
    expect(style).not.toBeNull()
    duplicateRoot.appendChild(style?.cloneNode(true))
    expect(rules(duplicate.container)).toEqual(["diff-unsafe-css-count"])

    const marker = await renderBenign(PIERRE_DIFFS_THEME_CSS)
    const [markerRoot] = shadowRoots(marker.container)
    markerRoot
      .querySelector("style[data-unsafe-css]")
      ?.removeAttribute("data-unsafe-css")
    expect(rules(marker.container)).toEqual([
      "diff-unsafe-css-count",
      "forbidden-style-element",
    ])

    const child = await renderBenign(PIERRE_DIFFS_THEME_CSS)
    const [childRoot] = shadowRoots(child.container)
    childRoot
      .querySelector("style[data-unsafe-css]")
      ?.appendChild(testWindow.document.createElement("b") as never)
    expect(rules(child.container)).toEqual(["diff-unsafe-css-child"])
  })

  test("[green-by-design] a fragment href outside ^#diffs-icon-[a-z0-9-]+$ or outside a separator/expand subtree fails", async () => {
    const pattern = await renderBenign(PIERRE_DIFFS_THEME_CSS)
    const [patternRoot] = shadowRoots(pattern.container)
    patternRoot
      .querySelector("[data-separator] use")
      ?.setAttribute("href", "#evil-icon")
    expect(rules(pattern.container)).toEqual(["diff-use-href"])

    const outside = await renderBenign(PIERRE_DIFFS_THEME_CSS)
    const [outsideRoot] = shadowRoots(outside.container)
    const use = outsideRoot.querySelector("[data-separator] use")
    expect(use).not.toBeNull()
    outsideRoot.querySelector("pre")?.appendChild(use?.cloneNode(true) as never)
    expect(rules(outside.container)).toEqual(["diff-use-href"])
  })
})
