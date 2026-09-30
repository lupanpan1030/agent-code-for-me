/**
 * Implementer tests for the Mermaid reviewed adapter (openspec change
 * `add-renderer-untrusted-content-hardening`, design D3, task 2.9):
 * the pinned `secure` list and its fail-closed proof, the owner's reviewed CSS
 * value profiles, the adapter's paint/attribute profile around DOMPurify and
 * the DOMParser pass, a positive paint control across diagram types and both
 * app themes, MermaidBlock's fail-closed and single-viewer behaviour, and the
 * shared oracle's Mermaid profile. Real transient-mount CSS/layout effects are
 * GUI task 5.1 evidence.
 */
import "./fixtures/renderer-hardening/mermaid-editor/happy-dom-env"
import { afterEach, describe, expect, test } from "bun:test"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MermaidBlock } from "../src/renderer/components/mermaid-block"
import { I18nProvider } from "../src/renderer/lib/i18n"
import {
  assertMermaidDirectiveSuppression,
  MERMAID_SECURE_CONFIG_KEYS,
  MERMAID_SECURITY_LEVEL,
  sanitizeMermaidSvg,
} from "../src/renderer/lib/security/mermaid-svg-sanitizer"
import {
  reviewMermaidAttributeCss,
  reviewMermaidInlineStyle,
  reviewMermaidPaintCss,
} from "../src/renderer/lib/security/renderer-html-policy"
import { testWindow } from "./fixtures/renderer-hardening/mermaid-editor/happy-dom-env"
import { findRendererMarkupViolations } from "./helpers/renderer-executable-markup-oracle"

const mermaid = (await import("mermaid")).default
const doc = testWindow.document as unknown as Document
const mountedRoots: Root[] = []
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

afterEach(async () => {
  for (const root of mountedRoots.splice(0)) {
    await act(async () => root.unmount())
  }
  doc.body.replaceChildren()
})

function hold(markup: string): HTMLElement {
  const holder = doc.createElement("div")
  holder.innerHTML = markup
  return holder
}

function mermaidViolations(markup: string) {
  return findRendererMarkupViolations(hold(markup) as never, {
    kind: "mermaid",
  })
}

/** Pinned Mermaid render outside MermaidBlock (no 600 ms debounce). */
async function renderPinned(
  code: string,
  theme: "default" | "dark" = "default",
): Promise<{ id: string; svg: string }> {
  mermaid.initialize({
    startOnLoad: false,
    theme,
    securityLevel: MERMAID_SECURITY_LEVEL,
    secure: [...MERMAID_SECURE_CONFIG_KEYS],
    fontFamily: "inherit",
  })
  assertMermaidDirectiveSuppression(mermaid.mermaidAPI.getSiteConfig())
  const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  try {
    const { svg } = await mermaid.render(id, code)
    return { id, svg }
  } finally {
    doc.getElementById(`d${id}`)?.remove()
  }
}

function paintOf(markup: string): string[] {
  return Array.from(hold(markup).querySelectorAll("style")).map(
    (style) => style.textContent ?? "",
  )
}

function withoutId(text: string, id: string): string {
  return text.split(id).join("DIAGRAM")
}

describe("D3: pinned secure list and its fail-closed proof", () => {
  test("the pinned list keeps Mermaid's six defaults and adds the six D3 styling keys", () => {
    expect([...MERMAID_SECURE_CONFIG_KEYS].sort()).toEqual(
      [
        "secure",
        "securityLevel",
        "startOnLoad",
        "maxTextSize",
        "suppressErrorRendering",
        "maxEdges",
        "themeCSS",
        "themeVariables",
        "theme",
        "fontFamily",
        "altFontFamily",
        "htmlLabels",
      ].sort(),
    )
  })

  test("suppression is proved only by strict mode plus the complete list", () => {
    const secure = [...MERMAID_SECURE_CONFIG_KEYS]
    expect(() =>
      assertMermaidDirectiveSuppression({ securityLevel: "strict", secure }),
    ).not.toThrow()
    expect(() =>
      assertMermaidDirectiveSuppression({
        securityLevel: "strict",
        secure: secure.filter((key) => key !== "htmlLabels"),
      }),
    ).toThrow()
    expect(() =>
      assertMermaidDirectiveSuppression({ securityLevel: "loose", secure }),
    ).toThrow()
    expect(() => assertMermaidDirectiveSuppression({})).toThrow()
  })

  test("front-matter config cannot restyle the diagram (themeCSS, theme, fontFamily)", async () => {
    const body = "flowchart TD\n  A[Front matter probe] --> B[Done]"
    const control = await renderPinned(body)
    const hostile = await renderPinned(
      [
        "---",
        "config:",
        '  themeCSS: "svg{position:fixed;background:url(https://evil.example/fm.png)}"',
        "  theme: forest",
        "  fontFamily: EvilFrontMatterFont",
        "  themeVariables:",
        '    primaryColor: "#ff0000"',
        "---",
        body,
      ].join("\n"),
    )
    expect(withoutId(paintOf(hostile.svg).join(""), hostile.id)).toBe(
      withoutId(paintOf(control.svg).join(""), control.id),
    )
    expect(hostile.svg).not.toContain("EvilFrontMatterFont")
  })

  test("a nested flowchart.htmlLabels directive is suppressed too", async () => {
    const body = "flowchart TD\n  A[Nested probe] --> B[Done]"
    const control = await renderPinned(body)
    const hostile = await renderPinned(
      `%%{init: {"flowchart": {"htmlLabels": false}}}%%\n${body}`,
    )
    expect(withoutId(hostile.svg, hostile.id)).toBe(
      withoutId(control.svg, control.id),
    )
  })
})

describe("D3: reviewed Mermaid CSS value profile (owner)", () => {
  const id = "mermaid-t"

  test("admits scoped paint, keyframes and same-diagram fragment references", () => {
    for (const css of [
      "#mermaid-t{font-family:inherit;fill:#333;}",
      "#mermaid-t .node rect,#mermaid-t .node circle{fill:#ECECFF;stroke:#9370DB;}",
      "@keyframes dash{to{stroke-dashoffset:0;}}",
      "#mermaid-t div.mermaidTooltip{position:absolute;z-index:100;}",
      '#mermaid-t [data-look="neo"].node rect{stroke:url(#mermaid-t-gradient);}',
      "#mermaid-t :root{--mermaid-font-family:inherit;}",
      "#mermaid-t .ok>*{fill:#e0f2fe!important;}",
    ]) {
      expect({ css, violations: reviewMermaidPaintCss(css, id) }).toEqual({
        css,
        violations: [],
      })
    }
  })

  test.each([
    ["@import", "@import url(https://evil.example/a.css);"],
    ["remote url()", "#mermaid-t .n{background:url(https://evil.example/b)}"],
    ["foreign fragment", "#mermaid-t .n{fill:url(#other-diagram)}"],
    ["image-set", '#mermaid-t .n{background:image-set("https://e/x.png" 1x)}'],
    ["escape evasion", "#mermaid-t .n{background:u\\72l(https://e/x)}"],
    ["comment evasion", "#mermaid-t .n{fill:red}/*x*/"],
    ["expression()", "#mermaid-t .n{width:expression(alert(1))}"],
    ["behavior:", "#mermaid-t .n{behavior:url(x.htc)}"],
    ["-moz-binding", "#mermaid-t .n{-moz-binding:x}"],
    ["unscoped selector", ".unscoped{fill:red}"],
    ["unscoped second selector", "#mermaid-t .a,.b{fill:red}"],
    ["other id prefix", "#mermaid-tx .n{fill:red}"],
    ["sibling escape ~", "#mermaid-t ~ div{display:none}"],
    ["sibling escape +", "#mermaid-t+div{display:none}"],
    ["root position:fixed", "#mermaid-t{position:fixed;inset:0}"],
    ["root position:absolute", "#mermaid-t{position:absolute}"],
    ["svg position:absolute", "#mermaid-t svg{position:absolute}"],
    [
      "nested position:fixed",
      "#mermaid-t .overlay>*{position:fixed!important}",
    ],
    ["position via var()", "#mermaid-t .n{position:var(--p)}"],
    ["@font-face", "@font-face{font-family:x;src:local(x)}"],
    ["@media", "@media all{#mermaid-t .n{fill:red}}"],
    ["nested rule", "#mermaid-t .n{fill:red;& ~ x{display:none}}"],
    ["stray statement", "#mermaid-t .n{fill:red} fill:red;"],
    ["unbalanced braces", "#mermaid-t .n{fill:red"],
    ["markup delimiter", "#mermaid-t .n{fill:red}</style><script>"],
  ])("rejects %s", (_label, css) => {
    expect(reviewMermaidPaintCss(css, id).length).toBeGreaterThan(0)
  })

  test("an id outside the reviewed grammar fails closed", () => {
    expect(reviewMermaidPaintCss("#x{fill:red}", "x y").length).toBeGreaterThan(
      0,
    )
  })

  test("inline style attributes keep only reviewed declarations", () => {
    expect(
      reviewMermaidInlineStyle(
        "fill:#f00 !important;position:fixed !important;top:0;width:100vw",
      ),
    ).toBe("fill:#f00 !important;top:0;width:100vw")
    expect(reviewMermaidInlineStyle("max-width: 40424px;")).toBe(
      "max-width: 40424px",
    )
    expect(reviewMermaidInlineStyle("position:relative;fill:red")).toBe(
      "position:relative;fill:red",
    )
    for (const style of [
      "background:url(https://evil.example/a.png)",
      "position:absolute",
      "fill:u\\72l(https://e/x)",
      "filter:url(#x)",
      "behavior:url(x.htc)",
      "",
    ]) {
      expect({ style, reviewed: reviewMermaidInlineStyle(style) }).toEqual({
        style,
        reviewed: null,
      })
    }
  })

  test("other attribute values: plain, exactly one fragment reference, or unsafe", () => {
    expect(reviewMermaidAttributeCss("#fff")).toEqual({ kind: "plain" })
    expect(reviewMermaidAttributeCss("translate(4, 5)")).toEqual({
      kind: "plain",
    })
    expect(reviewMermaidAttributeCss("url(#m_flowchart-v2-pointEnd)")).toEqual({
      kind: "fragment",
      id: "m_flowchart-v2-pointEnd",
    })
    for (const value of [
      "url(https://evil.example/f.svg#p)",
      "url(#a) url(#b)",
      "url(x.svg#a)",
      "javascript:alert(1)",
      "u\\72l(#a)",
    ]) {
      expect(reviewMermaidAttributeCss(value)).toEqual({ kind: "unsafe" })
    }
  })
})

describe("D3: adapter paint/attribute profile around DOMPurify and the DOMParser pass", () => {
  test("keeps fragment references to elements of the same SVG and strips dangling ones", () => {
    const out = sanitizeMermaidSvg(
      '<svg id="mermaid-f" xmlns="http://www.w3.org/2000/svg"><defs><marker id="mermaid-f_end"></marker></defs><path marker-end="url(#mermaid-f_end)"></path><path marker-start="url(#missing)" fill="url(#mermaid-f_end)"></path></svg>',
    )
    const svg = hold(out).querySelector("svg")
    const [kept, dangling] = Array.from(svg?.querySelectorAll("path") ?? [])
    expect(kept?.getAttribute("marker-end")).toBe("url(#mermaid-f_end)")
    expect(dangling?.hasAttribute("marker-start")).toBe(false)
    expect(dangling?.getAttribute("fill")).toBe("url(#mermaid-f_end)")
    expect(mermaidViolations(out)).toEqual([])
  })

  test("removes every animation element DOMPurify's SVG profile would keep", () => {
    const out = sanitizeMermaidSvg(
      '<svg id="mermaid-a" xmlns="http://www.w3.org/2000/svg"><rect><animate attributeName="x"></animate><animateColor></animateColor><animateMotion><mpath></mpath></animateMotion><animateTransform></animateTransform><set attributeName="x"></set><discard></discard></rect></svg>',
    )
    expect(hold(out).querySelectorAll("rect *")).toHaveLength(0)
    expect(mermaidViolations(out)).toEqual([])
  })

  test("the paint profile runs before the DOMParser pass: an XML parser error still returns profiled markup", () => {
    const out = sanitizeMermaidSvg(
      '<svg id="mermaid-x" xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil.example/x.css); #mermaid-x .n{fill:red}</style><g><style>#mermaid-x{fill:blue}</style><text style="position:fixed;fill:red">Entity&nbsp;probe</text></g></svg>',
    )
    expect(out).not.toContain("@import")
    expect(out).not.toContain("position:fixed")
    expect(out).toContain("Entity")
    expect(hold(out).querySelectorAll("style")).toHaveLength(0)
    expect(mermaidViolations(out)).toEqual([])
  })

  test("keeps only the first top-level <svg> and fails closed without one", () => {
    const out = sanitizeMermaidSvg(
      '<svg id="mermaid-one" xmlns="http://www.w3.org/2000/svg"></svg><p>after</p><svg id="mermaid-two" xmlns="http://www.w3.org/2000/svg"></svg>',
    )
    const roots = Array.from(hold(out).children)
    expect(roots.map((root) => root.getAttribute("id"))).toEqual([
      "mermaid-one",
    ])
    expect(sanitizeMermaidSvg("<p>no diagram</p>")).toBe("")
    expect(sanitizeMermaidSvg("")).toBe("")
  })

  test("hostile classDef/style statements: the failing paint is dropped, inline overlays stripped, the diagram still renders", async () => {
    const { svg } = await renderPinned(
      [
        "flowchart TD",
        "  A[Overlay] --> B[Done]",
        "  classDef overlay fill:#f9f,position:fixed,top:0,left:0",
        "  class A overlay",
        "  style B fill:#f00,position:absolute,width:100vw",
      ].join("\n"),
    )
    const out = sanitizeMermaidSvg(svg)
    const root = hold(out)
    expect(root.querySelector("svg")).not.toBeNull()
    expect(root.querySelectorAll("style")).toHaveLength(0)
    expect(out).not.toMatch(/position:\s*(?:fixed|absolute)/)
    expect(out).toContain("fill:#f9f")
    expect(mermaidViolations(out)).toEqual([])
  })
})

describe("D3 positive control: safe diagram styling survives across diagram types and both app themes", () => {
  const DIAGRAMS: Record<string, string> = {
    flowchart:
      "flowchart TD\n A[Start] --> B{Ok?}\n B -->|yes| C[Done]\n classDef ok fill:#e0f2fe,stroke:#0369a1\n class C ok",
    sequence:
      "sequenceDiagram\n participant Alice\n Alice->>Bob: Hi\n Note over Alice,Bob: note\n loop Every\n Bob-->>Alice: ok\n end",
    class:
      "classDiagram\n class Animal{\n +int age\n +isMammal()\n }\n Animal <|-- Duck",
    state:
      "stateDiagram-v2\n [*] --> Still\n Still --> Moving\n Moving --> [*]",
    er: "erDiagram\n CUSTOMER ||--o{ ORDER : places\n CUSTOMER { string name }",
    gantt:
      "gantt\n title A\n dateFormat YYYY-MM-DD\n section S\n Task :a1, 2024-01-01, 30d",
    pie: 'pie title Pets\n "Dogs" : 386\n "Cats" : 85',
    journey: "journey\n title Day\n section Go\n Make tea: 5: Me",
    gitGraph:
      "gitGraph\n commit\n branch dev\n commit\n checkout main\n merge dev",
    timeline: "timeline\n title History\n 2002 : LinkedIn\n 2004 : Facebook",
    quadrant:
      "quadrantChart\n title Reach\n x-axis Low --> High\n y-axis Low --> High\n quadrant-1 Expand\n Campaign A: [0.3, 0.6]",
    xychart:
      "xychart-beta\n title Sales\n x-axis [jan, feb]\n y-axis Revenue 0 --> 100\n bar [50, 60]",
    sankey: "sankey-beta\nA,B,10\nB,C,5",
    requirement:
      "requirementDiagram\n requirement test_req {\n id: 1\n text: the test text.\n risk: high\n verifymethod: test\n }",
    packet: 'packet-beta\n0-15: "Source Port"\n16-31: "Destination Port"',
    kanban: "kanban\n Todo\n  [Create Documentation]\n Done\n  [Write tests]",
    treemap: 'treemap-beta\n"Section 1"\n    "Leaf 1.1": 12\n    "Leaf 1.2": 8',
  }

  for (const theme of ["default", "dark"] as const) {
    test.each(
      Object.keys(DIAGRAMS),
    )(`${theme} theme: %s keeps exactly one reviewed paint <style> and holds the Mermaid oracle`, async (name) => {
      const { id, svg } = await renderPinned(DIAGRAMS[name], theme)
      const out = sanitizeMermaidSvg(svg)
      const [paint] = paintOf(out)
      expect(paintOf(out)).toHaveLength(1)
      expect(reviewMermaidPaintCss(paint ?? "", id)).toEqual([])
      expect(paint).toContain(`#${id}`)
      expect(mermaidViolations(out)).toEqual([])
    }, 20_000)
  }
})

describe("D3: MermaidBlock fails closed and keeps one fullscreen sink", () => {
  async function mountBlock(code: string) {
    const container = doc.createElement("div")
    doc.body.append(container)
    const root = createRoot(container)
    mountedRoots.push(root)
    await act(async () => {
      root.render(
        createElement(
          I18nProvider,
          null,
          createElement(MermaidBlock, { code }),
        ),
      )
    })
    return container
  }

  async function waitFor(condition: () => boolean, what: string) {
    const started = Date.now()
    while (!condition()) {
      if (Date.now() - started > 15_000) throw new Error(`timed out: ${what}`)
      await act(async () => {
        await sleep(50)
      })
    }
  }

  test("unprovable directive suppression renders no diagram and never calls mermaid.render", async () => {
    // Simulate a Mermaid that ignores the pinned `secure` list: the live site
    // configuration then holds only Mermaid's defaults.
    const realInitialize = mermaid.initialize
    const realRender = mermaid.render
    let renderCalls = 0
    mermaid.initialize = ((config: Parameters<typeof realInitialize>[0]) =>
      realInitialize({ ...config, secure: [] })) as typeof realInitialize
    mermaid.render = (async (...args: Parameters<typeof realRender>) => {
      renderCalls += 1
      return realRender(...args)
    }) as typeof realRender
    try {
      const container = await mountBlock(
        "flowchart TD\n  A[Suppression probe] --> B[Done]",
      )
      await waitFor(
        () => container.textContent?.includes("could not be verified") ?? false,
        "fail-closed error state",
      )
      expect(container.querySelector(".mermaid-diagram")).toBeNull()
      expect(renderCalls).toBe(0)
    } finally {
      mermaid.initialize = realInitialize
      mermaid.render = realRender
    }
  }, 20_000)

  test("a parse error leaves no transient Mermaid element under document.body", async () => {
    const realRender = mermaid.render
    let settled = 0
    mermaid.render = (async (...args: Parameters<typeof realRender>) => {
      try {
        return await realRender(...args)
      } finally {
        settled += 1
      }
    }) as typeof realRender
    try {
      const container = await mountBlock(
        "flowchart TD\n  A[Parse error probe] --> B[Done]\n  classDef x fill:url(https://evil/x)\n  class A x",
      )
      await waitFor(() => settled > 0, "mermaid.render settled")
      await act(async () => {
        await sleep(50)
      })
      expect(
        doc.querySelectorAll('[id^="dmermaid-"],[id^="imermaid-"]'),
      ).toHaveLength(0)
      expect(
        Array.from(doc.body.children).filter(
          (child) => child !== container && child.querySelector("svg, style"),
        ),
      ).toEqual([])
      expect(container.querySelector(".mermaid-diagram")).toBeNull()
    } finally {
      mermaid.render = realRender
    }
  }, 20_000)

  test("opening a second fullscreen viewer closes the first", async () => {
    const first = await mountBlock(
      "flowchart TD\n  A[First viewer] --> B[Done]",
    )
    const second = await mountBlock(
      "flowchart TD\n  A[Second viewer] --> B[Done]",
    )
    await waitFor(
      () =>
        first.querySelector(".mermaid-diagram svg") !== null &&
        second.querySelector(".mermaid-diagram svg") !== null,
      "both diagrams",
    )
    for (const container of [first, second]) {
      await act(async () => {
        container.querySelector(".mermaid-diagram")?.dispatchEvent(
          new testWindow.MouseEvent("click", {
            bubbles: true,
          }) as unknown as Event,
        )
      })
      await act(async () => {
        await sleep(20)
      })
    }
    const fullscreen = doc.querySelectorAll(".mermaid-diagram-fullscreen")
    expect(fullscreen).toHaveLength(1)
    expect(fullscreen[0]?.innerHTML).toBe(
      second.querySelector(".mermaid-diagram")?.innerHTML,
    )
  }, 30_000)
})

describe("shared oracle: Mermaid profile self-test", () => {
  test("accepts a scoped paint element and existing fragment references", () => {
    expect(
      mermaidViolations(
        '<svg id="mermaid-ok" xmlns="http://www.w3.org/2000/svg"><style>#mermaid-ok .n{fill:#fff}@keyframes dash{to{stroke-dashoffset:0;}}</style><defs><marker id="mermaid-ok_end"></marker></defs><path marker-end="url(#mermaid-ok_end)"></path></svg>',
      ),
    ).toEqual([])
  })

  test.each([
    [
      "second style",
      '<svg id="m1"><style>#m1 .a{fill:red}</style><g><style>#m1 .b{fill:red}</style></g></svg>',
    ],
    ["unscoped paint", '<svg id="m2"><style>.a{fill:red}</style></svg>'],
    [
      "remote paint",
      '<svg id="m3"><style>#m3 .a{background:url(https://e/x)}</style></svg>',
    ],
    [
      "dangling fragment",
      '<svg id="m4"><path marker-end="url(#nope)"></path></svg>',
    ],
    [
      "remote presentation url",
      '<svg id="m5"><rect fill="url(https://e/x.svg#p)"></rect></svg>',
    ],
    [
      "overlay style attribute",
      '<svg id="m6"><rect style="position:fixed"></rect></svg>',
    ],
    ["script", '<svg id="m7"><script>1</script></svg>'],
    ["no diagram id", "<svg></svg>"],
  ])("rejects %s", (_label, markup) => {
    expect(mermaidViolations(markup).length).toBeGreaterThan(0)
  })
})
