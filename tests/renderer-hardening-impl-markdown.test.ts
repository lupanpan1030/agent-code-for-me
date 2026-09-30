/**
 * Implementer tests for the single app-owned Streamdown wrapper
 * (`src/renderer/components/reviewed-streamdown.tsx`) and the reviewed
 * markdown chain it applies to both app mounts (openspec change
 * `add-renderer-untrusted-content-hardening`, design D2, tasks 2.2/2.3).
 *
 * Complements the independent red suite with the URL-policy cases it does
 * not enumerate (footnote fragments, `action`, `srcset`, `cite`), the
 * fail-closed rendering of relative links, the plaintext code-fence path and
 * the error-boundary reset contract. Every rendered case is judged by the
 * shared owner-profile oracle helper.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import {
  findRendererMarkupViolations,
  type MarkupOracleProfile,
} from "./helpers/renderer-executable-markup-oracle"

const testWindow = new Window({ url: "http://localhost/" })
const globals = globalThis as Record<string, unknown>
for (const name of [
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "location",
  "Node",
  "Element",
  "HTMLElement",
  "SVGElement",
  "Text",
  "DocumentFragment",
  "MutationObserver",
  "ResizeObserver",
  "IntersectionObserver",
  "DOMParser",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "CustomEvent",
]) {
  const value = (testWindow as unknown as Record<string, unknown>)[name]
  if (value !== undefined) globals[name] = value
}
globals.getComputedStyle = testWindow.getComputedStyle.bind(testWindow)
globals.requestAnimationFrame =
  testWindow.requestAnimationFrame.bind(testWindow)
globals.cancelAnimationFrame = testWindow.cancelAnimationFrame.bind(testWindow)
globals.IS_REACT_ACT_ENVIRONMENT = true

const { act, createElement } = await import("react")
const { createRoot } = await import("react-dom/client")
const { I18nProvider } = await import("../src/renderer/lib/i18n")
const { ChatMarkdownRenderer, MemoizedMarkdown } = await import(
  "../src/renderer/components/chat-markdown-renderer"
)
const { MarkdownRenderBoundary } = await import(
  "../src/renderer/components/reviewed-streamdown"
)

type Root = ReturnType<typeof createRoot>
let mountedRoots: Root[] = []

afterEach(async () => {
  for (const root of mountedRoots) {
    await act(async () => root.unmount())
  }
  mountedRoots = []
  testWindow.document.body.replaceChildren()
})

const MARKDOWN: MarkupOracleProfile = { kind: "markdown" }

async function mount(element: ReturnType<typeof createElement>) {
  const container = testWindow.document.createElement(
    "div",
  ) as unknown as HTMLElement
  testWindow.document.body.append(container as never)
  const root = createRoot(container)
  mountedRoots.push(root)
  await act(async () => {
    root.render(createElement(I18nProvider, null, element))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40))
  })
  return { container, root }
}

async function renderMarkdown(mode: "static" | "streaming", content: string) {
  const element =
    mode === "static"
      ? createElement(MemoizedMarkdown, {
          content,
          id: "impl-markdown",
          isStreaming: false,
        })
      : createElement(ChatMarkdownRenderer, { content, isStreaming: false })
  return (await mount(element)).container
}

for (const mode of ["static", "streaming"] as const) {
  describe(`${mode} app mount: reviewed markdown URL policy`, () => {
    test("relative and protocol-relative links/images fail closed to visible text", async () => {
      const container = await renderMarkdown(
        mode,
        "[relative](./docs/readme.md) [rooted](/etc/passwd) [parent](../x) [proto](//evil.example/x)\n\n![avatar](../private/avatar.png)\n",
      )
      expect(container.querySelectorAll("a[href]").length).toBe(0)
      expect(container.querySelectorAll("img").length).toBe(0)
      const text = container.textContent ?? ""
      for (const label of ["relative", "rooted", "parent", "proto", "avatar"]) {
        expect(text).toContain(label)
      }
      expect(
        findRendererMarkupViolations(container as never, MARKDOWN),
      ).toEqual([])
    })

    test("GFM footnote fragment links lose their href but keep their text", async () => {
      const container = await renderMarkdown(
        mode,
        "Claim with a note.[^1]\n\n[^1]: Footnote body text.\n",
      )
      expect(
        Array.from(container.querySelectorAll("a[href]")).map((anchor) =>
          anchor.getAttribute("href"),
        ),
      ).toEqual([])
      expect(container.textContent ?? "").toContain("Footnote body text.")
      expect(
        findRendererMarkupViolations(container as never, MARKDOWN),
      ).toEqual([])
    })

    test("URL-bearing attributes outside the reviewed profile are removed (action, srcset, relative cite)", async () => {
      const container = await renderMarkdown(
        mode,
        [
          '<div action="javascript:window.__pwned=1">form-ish</div>',
          "",
          '<picture><source srcset="./a.png 1x, javascript:1 2x"><img src="https://example.com/a.png" alt="pic"></picture>',
          "",
          '<blockquote cite="./local">relative cite</blockquote>',
          "",
          '<q cite="https://example.com/source">remote cite</q>',
        ].join("\n"),
      )
      expect(container.querySelectorAll("[action]").length).toBe(0)
      expect(container.querySelectorAll("[srcset]").length).toBe(0)
      expect(container.querySelector("blockquote")?.hasAttribute("cite")).toBe(
        false,
      )
      expect(container.querySelector("q")?.getAttribute("cite")).toBe(
        "https://example.com/source",
      )
      expect(container.querySelector("img")?.getAttribute("src")).toBe(
        "https://example.com/a.png",
      )
      expect(
        findRendererMarkupViolations(container as never, MARKDOWN),
      ).toEqual([])
    })

    test("schemes are matched exactly: an upper-case scheme fails closed", async () => {
      const container = await renderMarkdown(
        mode,
        "[upper](HTTPS://example.com/x) and [ok](https://example.com/ok)\n",
      )
      expect(
        Array.from(container.querySelectorAll("a[href]")).map((anchor) =>
          anchor.getAttribute("href"),
        ),
      ).toEqual(["https://example.com/ok"])
      expect(
        findRendererMarkupViolations(container as never, MARKDOWN),
      ).toEqual([])
    })

    test("remark parity: GFM task lists, strikethrough and breaks still render", async () => {
      const container = await renderMarkdown(
        mode,
        "- [x] done item\n- [ ] open item\n\n~~gone~~ first\nsecond\n",
      )
      const boxes = container.querySelectorAll('input[type="checkbox"]')
      expect(boxes.length).toBe(2)
      expect(container.querySelector("del")?.textContent).toBe("gone")
      expect(container.querySelectorAll("p br").length).toBeGreaterThan(0)
      expect(
        findRendererMarkupViolations(container as never, MARKDOWN),
      ).toEqual([])
    })

    test("a plaintext code fence renders its markup-breaking source as escaped text", async () => {
      const source =
        '</code></pre><img src=x onerror="window.__pwned=1"><b>x</b>'
      const container = await renderMarkdown(
        mode,
        `\`\`\`text\n${source}\n\`\`\`\n`,
      )
      const code = container.querySelector("pre code")
      expect(code?.textContent).toBe(source)
      expect(container.querySelectorAll("img, b").length).toBe(0)
      expect(
        findRendererMarkupViolations(container as never, MARKDOWN),
      ).toEqual([])
    })
  })
}

describe("app-owned markdown error boundary", () => {
  let throwing = true
  function Pipeline({ text }: { text: string }) {
    if (throwing) throw new Error("forced pipeline failure")
    return createElement("span", { "data-rendered": "" }, text)
  }

  test("renders the failing source as text and retries when the source changes", async () => {
    throwing = true
    const hostile =
      '<img src=x onerror="window.__pwned=1"> <a href="javascript:1">x</a>'
    const caught: string[] = []
    const container = testWindow.document.createElement(
      "div",
    ) as unknown as HTMLElement
    testWindow.document.body.append(container as never)
    const root = createRoot(container, {
      onCaughtError: (error) => caught.push(String((error as Error).message)),
    })
    mountedRoots.push(root)
    const render = (source: string) =>
      act(async () => {
        root.render(
          createElement(
            MarkdownRenderBoundary,
            { source },
            createElement(Pipeline, { text: source }),
          ),
        )
      })

    await render(hostile)
    expect(caught).toContain("forced pipeline failure")
    const fallback = container.querySelector("[data-markdown-render-fallback]")
    expect(fallback?.textContent).toBe(hostile)
    expect(fallback?.children.length).toBe(0)
    expect(container.querySelectorAll("img, a").length).toBe(0)
    expect(findRendererMarkupViolations(container as never, MARKDOWN)).toEqual(
      [],
    )

    // Same source stays in the fallback even if the pipeline would recover.
    throwing = false
    await render(hostile)
    expect(container.querySelector("[data-rendered]")).toBeNull()

    // New content (the next streamed chunk) gets a fresh attempt.
    await render("next chunk")
    expect(container.querySelector("[data-rendered]")?.textContent).toBe(
      "next chunk",
    )
    expect(
      container.querySelector("[data-markdown-render-fallback]"),
    ).toBeNull()
  })
})
