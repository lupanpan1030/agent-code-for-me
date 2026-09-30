// Side-effect import FIRST: installs the happy-dom renderer document and its
// documented fidelity shims before dompurify/mermaid/react evaluate.
import "./fixtures/renderer-hardening/mermaid-editor/happy-dom-env"
import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import createDOMPurify from "dompurify"
import { act, createElement, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MermaidBlock } from "../src/renderer/components/mermaid-block"
import {
  AgentsMentionsEditor,
  type AgentsMentionsEditorHandle,
  type FileMentionOption,
} from "../src/renderer/features/agents/mentions/agents-mentions-editor"
import { I18nProvider } from "../src/renderer/lib/i18n"
import {
  MERMAID_SECURITY_LEVEL,
  sanitizeMermaidSvg,
} from "../src/renderer/lib/security/mermaid-svg-sanitizer"
import {
  editorProfileViolations,
  mermaidCssProfileViolations,
  mermaidProfileViolations,
} from "./fixtures/renderer-hardening/mermaid-editor/executable-markup-oracle"
import { testWindow } from "./fixtures/renderer-hardening/mermaid-editor/happy-dom-env"

const FIXTURES = join(
  import.meta.dir,
  "fixtures",
  "renderer-hardening",
  "mermaid-editor",
)
const mermaidSource = (name: string) =>
  readFileSync(join(FIXTURES, "mermaid", name), "utf8")
const svgFixture = (name: string) =>
  readFileSync(join(FIXTURES, "svg", `${name}.txt`), "utf8")
const editorFixture = (name: string) =>
  readFileSync(join(FIXTURES, "editor", `${name}.txt`), "utf8")

const MERMAID_TEST_TIMEOUT_MS = 30_000
const SETTLE_LIMIT_MS = 15_000
const RENDER_DEBOUNCE_MS = 600 // MermaidBlock's RENDER_DEBOUNCE_MS
const STABLE_WINDOW_MS = 1_500
const MERMAID_DEFAULT_SECURE_KEYS = [
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "suppressErrorRendering",
  "maxEdges",
]
const D3_SECURE_KEYS = [
  "themeCSS",
  "themeVariables",
  "theme",
  "fontFamily",
  "altFontFamily",
  "htmlLabels",
]

const doc = testWindow.document as unknown as Document
const headBaseline = Array.from(doc.head.childNodes)
const mountedRoots: Root[] = []

// Deterministic settle signal for the Mermaid harness. MermaidBlock's
// `parsing` and `loading` states render identical spinner markup, so a
// "stable markup" window cannot tell an in-flight `mermaid.render` from the
// parse-error path that returns to the spinner; a render slower than that
// window made a positive control fail sporadically (0 sink SVGs). The pinned
// mermaid singleton (the same module instance MermaidBlock lazy-imports) has
// its `render` counted on call and on settle, so the loop below waits for the
// actual render promise. The real render runs unchanged.
const mermaidSingleton = (await import("mermaid")).default
const realMermaidRender = mermaidSingleton.render
let mermaidRenderCalls = 0
let mermaidRenderSettled = 0
mermaidSingleton.render = async (
  ...args: Parameters<typeof realMermaidRender>
) => {
  mermaidRenderCalls += 1
  try {
    return await realMermaidRender(...args)
  } finally {
    mermaidRenderSettled += 1
  }
}

/** Explicit fixture precondition: throws (never swallows) when absent. */
function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`fixture precondition failed: missing ${what}`)
  }
  return value
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

afterEach(async () => {
  for (const root of mountedRoots.splice(0)) {
    await act(async () => root.unmount())
  }
  doc.body.replaceChildren()
  for (const node of Array.from(doc.head.childNodes)) {
    if (!headBaseline.includes(node)) node.parentNode?.removeChild(node)
  }
  testWindow.getSelection()?.removeAllRanges()
  Reflect.deleteProperty(doc, "execCommand")
})

// ---------------------------------------------------------------------------
// Mermaid harness: MermaidBlock's actual render path (lazy `import("mermaid")`,
// pinned mermaid 11.16.0, mermaid.render transient body mount, app sanitizer,
// inline dangerouslySetInnerHTML sink, fullscreen dialog sink).
// ---------------------------------------------------------------------------

type MermaidRender = {
  container: HTMLElement
  inlineSink: HTMLElement | null
  fullscreenSink: HTMLElement | null
  residue: string[]
  headAdditions: string[]
}

function mermaidResidue(containers: HTMLElement[]): string[] {
  const residue: string[] = []
  for (const child of Array.from(doc.body.children) as HTMLElement[]) {
    if (containers.includes(child)) continue
    const suspects = [
      child,
      ...Array.from(child.querySelectorAll("*")),
    ] as Element[]
    for (const element of suspects) {
      const name = (element.localName || "").toLowerCase()
      const id = element.getAttribute("id") ?? ""
      if (
        ["svg", "style", "script", "iframe", "foreignobject", "link"].includes(
          name,
        ) ||
        /^(d|i)?mermaid-/.test(id)
      ) {
        residue.push(`<${name}${id ? `#${id}` : ""}> left under document.body`)
      }
    }
  }
  return residue
}

async function renderMermaidBlock(code: string): Promise<MermaidRender> {
  const headBefore = Array.from(doc.head.childNodes)
  const callsBefore = mermaidRenderCalls
  const container = doc.createElement("div")
  container.setAttribute("data-test-root", "mermaid")
  doc.body.append(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  await act(async () => {
    root.render(
      createElement(I18nProvider, null, createElement(MermaidBlock, { code })),
    )
  })
  // Settled = the 600 ms render debounce elapsed, no `mermaid.render` is in
  // flight, and either the spinner is gone (success/error committed) or a
  // render settled but MermaidBlock returned to the spinner (its parse-error
  // path) with no re-render scheduled for STABLE_WINDOW_MS. Every fixture is
  // expected to reach `mermaid.render`; a fixture that never does is a harness
  // precondition failure reported by the SETTLE_LIMIT_MS throw below.
  const started = Date.now()
  let lastSettled = mermaidRenderSettled
  let lastSettledAt = started
  for (;;) {
    await act(async () => {
      await sleep(50)
    })
    const now = Date.now()
    if (mermaidRenderSettled !== lastSettled) {
      lastSettled = mermaidRenderSettled
      lastSettledAt = now
    }
    const debounceElapsed = now - started > RENDER_DEBOUNCE_MS + 100
    const rendered = mermaidRenderCalls > callsBefore
    const inFlight = mermaidRenderCalls !== mermaidRenderSettled
    const spinnerGone = container.querySelector(".animate-spin") === null
    if (debounceElapsed && rendered && !inFlight) {
      if (spinnerGone || now - lastSettledAt > STABLE_WINDOW_MS) break
    }
    if (now - started > SETTLE_LIMIT_MS)
      throw new Error(
        `MermaidBlock did not settle (mermaid.render called: ${rendered}, in flight: ${inFlight})`,
      )
  }
  const residue = mermaidResidue([container])
  const headAdditions = Array.from(doc.head.childNodes)
    .filter((node) => !headBefore.includes(node))
    .map((node) => (node as Element).outerHTML ?? node.nodeName)
  const inlineSink = container.querySelector(
    ".mermaid-diagram",
  ) as HTMLElement | null
  let fullscreenSink: HTMLElement | null = null
  if (inlineSink) {
    await act(async () => {
      inlineSink.dispatchEvent(
        new testWindow.MouseEvent("click", {
          bubbles: true,
        }) as unknown as Event,
      )
    })
    await act(async () => {
      await sleep(20)
    })
    fullscreenSink = doc.querySelector(
      ".mermaid-diagram-fullscreen",
    ) as HTMLElement | null
  }
  return { container, inlineSink, fullscreenSink, residue, headAdditions }
}

function sinkSvgs(render: MermaidRender): Element[] {
  return [render.inlineSink, render.fullscreenSink]
    .filter((sink): sink is HTMLElement => sink !== null)
    .flatMap((sink) => Array.from(sink.children))
}

function sinkViolations(render: MermaidRender): string[] {
  const violations: string[] = []
  for (const sink of [render.inlineSink, render.fullscreenSink]) {
    if (!sink) continue
    for (const child of Array.from(sink.children)) {
      violations.push(...mermaidProfileViolations(child))
    }
  }
  return violations
}

function diagramIdOf(svg: Element): string {
  return svg.getAttribute("id") ?? ""
}

/** Retained paint CSS with the per-render diagram id replaced by a constant. */
function normalizedPaintCss(render: MermaidRender): string {
  const svg = render.inlineSink?.querySelector("svg")
  if (!svg) return "<no inline svg>"
  const id = diagramIdOf(svg)
  return Array.from(svg.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n")
    .split(id)
    .join("DIAGRAM")
}

function normalizedMarkup(render: MermaidRender): string {
  const svg = render.inlineSink?.querySelector("svg")
  if (!svg) return "<no inline svg>"
  return required(render.inlineSink, "inline sink")
    .innerHTML.split(diagramIdOf(svg))
    .join("DIAGRAM")
}

function parseSanitizedSvg(markup: string): Element[] {
  if (markup.trim() === "") return []
  const holder = doc.createElement("div")
  holder.innerHTML = markup
  return Array.from(holder.children)
}

async function mermaidSecureList(): Promise<string[]> {
  const mermaid = (await import("mermaid")).default
  return [...(mermaid.mermaidAPI.getSiteConfig().secure ?? [])]
}

async function mermaidSiteSecurityLevel(): Promise<string | undefined> {
  const mermaid = (await import("mermaid")).default
  return mermaid.mermaidAPI.getSiteConfig().securityLevel
}

// ---------------------------------------------------------------------------
// Environment + oracle self-checks (green by design): prove the happy-dom
// fidelity shims and the oracle are not vacuous before any product assertion.
// ---------------------------------------------------------------------------

describe("environment: happy-dom fidelity shims and the D2 Mermaid/editor oracle profiles", () => {
  test("DOMPurify keeps an SVG root, keeps siblings after an SVG <style>, and keeps iterating after a removal under the shimmed happy-dom", () => {
    const purifier = createDOMPurify(
      testWindow as unknown as Window & typeof globalThis,
    )
    const out = purifier.sanitize(
      '<svg id="mermaid-env"><style>#mermaid-env .a{fill:red}</style><g onclick="x()"><script>1</script><text>kept</text></g><g><foreignObject><p>a</p></foreignObject></g><g><foreignObject><p>b</p></foreignObject><text>tail</text></g></svg>',
      { USE_PROFILES: { svg: true }, FORBID_TAGS: ["foreignObject"] },
    )
    const [svg] = parseSanitizedSvg(String(out))
    expect(svg?.localName).toBe("svg")
    expect(svg?.querySelector("style")?.textContent).toBe(
      "#mermaid-env .a{fill:red}",
    )
    expect(svg?.querySelector("text")?.textContent).toBe("kept")
    expect(svg?.querySelector("script")).toBeNull()
    expect(svg?.querySelector("g")?.hasAttribute("onclick")).toBe(false)
    // Shim 4: removal of the first forbidden node must not end the iteration.
    expect(svg?.querySelectorAll("foreignObject, foreignobject")).toHaveLength(
      0,
    )
    expect(
      Array.from(svg?.querySelectorAll("text") ?? []).map((t) => t.textContent),
    ).toEqual(["kept", "tail"])
  })

  test("the Mermaid oracle rejects each forbidden class and accepts a scoped paint <style> (negative/positive controls)", () => {
    const [clean] = parseSanitizedSvg(
      '<svg id="mermaid-ok" xmlns="http://www.w3.org/2000/svg"><style>#mermaid-ok .node rect{fill:#fff}@keyframes dash{to{stroke-dashoffset:0;}}#mermaid-ok div.mermaidTooltip{position:absolute}</style><defs><marker id="mermaid-ok_end"></marker></defs><path marker-end="url(#mermaid-ok_end)"></path></svg>',
    )
    expect(mermaidProfileViolations(required(clean, "clean svg"))).toEqual([])
    const negatives = [
      '<svg id="mermaid-n1"><script>1</script></svg>',
      '<svg id="mermaid-n2"><g onclick="x()"></g></svg>',
      '<svg id="mermaid-n3"><a href="javascript:alert(1)"></a></svg>',
      '<svg id="mermaid-n4"><foreignObject></foreignObject></svg>',
      '<svg id="mermaid-n5"><animateTransform></animateTransform></svg>',
      '<svg id="mermaid-n6"><style>#mermaid-n6 .a{fill:red}</style><style>#mermaid-n6 .b{fill:red}</style></svg>',
      '<svg id="mermaid-n7"><rect style="position:fixed"></rect></svg>',
      '<svg id="mermaid-n8"><rect fill="url(https://evil.example/x)"></rect></svg>',
    ]
    for (const markup of negatives) {
      const [svg] = parseSanitizedSvg(markup)
      expect(
        mermaidProfileViolations(required(svg, "negative svg")).length,
      ).toBeGreaterThan(0)
    }
    const hostileCss = [
      "@import url(https://evil.example/a.css);",
      "#d svg{position:fixed}",
      "#d{position:absolute}",
      "#d .n{background:url(https://evil.example/b)}",
      "#d .n{behavior:url(x.htc)}",
      "#d .n{width:expression(alert(1))}",
      ".unscoped{fill:red}",
      "#dx .n{fill:red}",
      "@font-face{font-family:x;src:url(https://evil.example/f)}",
    ]
    for (const css of hostileCss) {
      expect(mermaidCssProfileViolations(css, "d").length).toBeGreaterThan(0)
    }
  })

  test("the editor oracle admits text, <br> and reviewed mention spans only", () => {
    const editor = doc.createElement("div")
    editor.append(doc.createTextNode("a"), doc.createElement("br"))
    const mention = doc.createElement("span")
    mention.setAttribute("contenteditable", "false")
    mention.setAttribute("data-mention-id", "skill:x")
    mention.append(doc.createElement("span"))
    editor.append(mention)
    expect(editorProfileViolations(editor)).toEqual([])
    for (const tag of ["b", "div", "img", "a"]) {
      const bad = editor.cloneNode(true) as HTMLElement
      bad.append(doc.createElement(tag))
      expect(editorProfileViolations(bad).length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// D3 (Mermaid part) — runtime-security-baseline
// Scenario: Mermaid diagram contains scriptable content
// ---------------------------------------------------------------------------

describe("D3 / Scenario: Mermaid diagram contains scriptable content — MermaidBlock end-to-end with pinned mermaid", () => {
  test(
    "AND a positive control SHALL prove safe diagram styling survives: safe flowchart + classDef paint is the single value-profile-validated <style> at both sinks",
    async () => {
      const render = await renderMermaidBlock(
        mermaidSource("positive-flowchart.mmd"),
      )
      const svgs = sinkSvgs(render)
      expect(svgs).toHaveLength(2)
      expect(render.fullscreenSink?.innerHTML).toBe(
        render.inlineSink?.innerHTML,
      )
      expect(sinkViolations(render)).toEqual([])
      const inlineSvg = required(
        required(render.inlineSink, "inline sink").querySelector("svg"),
        "inline svg",
      )
      const id = diagramIdOf(inlineSvg)
      const styles = Array.from(inlineSvg.querySelectorAll("style"))
      expect(styles).toHaveLength(1)
      const css = required(styles[0], "paint style").textContent ?? ""
      expect(css).toContain(`#${id} .node rect`)
      // The benign classDef paint (classDef ok fill:#e0f2fe) survives, scoped.
      expect(css).toMatch(new RegExp(`#${id} \\.ok>\\*\\{[^}]*fill:#e0f2fe`))
      expect(render.residue).toEqual([])
      expect(render.headAdditions).toEqual([])
    },
    MERMAID_TEST_TIMEOUT_MS,
  )

  test(
    "AND a positive control SHALL prove safe diagram styling survives: safe sequence diagram at both sinks",
    async () => {
      const render = await renderMermaidBlock(
        mermaidSource("positive-sequence.mmd"),
      )
      expect(sinkSvgs(render)).toHaveLength(2)
      expect(render.fullscreenSink?.innerHTML).toBe(
        render.inlineSink?.innerHTML,
      )
      expect(sinkViolations(render)).toEqual([])
      expect(
        required(render.inlineSink, "inline sink").querySelectorAll(
          "svg style",
        ),
      ).toHaveLength(1)
      expect(required(render.inlineSink, "inline sink").textContent).toContain(
        "Safe hello",
      )
      expect(render.residue).toEqual([])
    },
    MERMAID_TEST_TIMEOUT_MS,
  )

  test(
    "AND before mermaid.render the pinned configuration's existing secure list SHALL be extended with themeCSS, themeVariables, theme, fontFamily, altFontFamily and htmlLabels",
    async () => {
      const render = await renderMermaidBlock(
        mermaidSource("secure-list-probe.mmd"),
      )
      expect(render.inlineSink?.querySelector("svg")).not.toBeNull()
      const secure = await mermaidSecureList()
      for (const key of [...MERMAID_DEFAULT_SECURE_KEYS, ...D3_SECURE_KEYS]) {
        expect(secure).toContain(key)
      }
    },
    MERMAID_TEST_TIMEOUT_MS,
  )

  test(
    "WHEN hostile themeCSS (root position:fixed, background url(https://…), @import, behavior:, expression()) THEN source directives SHALL NOT change styling: retained paint equals the directive-free control",
    async () => {
      const control = await renderMermaidBlock(
        mermaidSource("control-themecss.mmd"),
      )
      const hostile = await renderMermaidBlock(
        mermaidSource("directive-themecss-overlay.mmd"),
      )
      expect(hostile.inlineSink?.querySelector("svg")).not.toBeNull()
      expect(normalizedPaintCss(hostile)).toBe(normalizedPaintCss(control))
      expect(sinkViolations(hostile)).toEqual([])
      expect(hostile.fullscreenSink?.innerHTML).toBe(
        hostile.inlineSink?.innerHTML,
      )
      expect(hostile.residue).toEqual([])
      expect(hostile.headAdditions).toEqual([])
    },
    MERMAID_TEST_TIMEOUT_MS,
  )

  test(
    "WHEN hostile fontFamily/altFontFamily directives THEN source directives SHALL NOT change styling",
    async () => {
      const control = await renderMermaidBlock(
        mermaidSource("control-fonts.mmd"),
      )
      const hostile = await renderMermaidBlock(
        mermaidSource("directive-fonts.mmd"),
      )
      expect(hostile.inlineSink?.querySelector("svg")).not.toBeNull()
      expect(normalizedPaintCss(hostile)).toBe(normalizedPaintCss(control))
      expect(
        required(hostile.inlineSink, "inline sink").innerHTML,
      ).not.toContain("EvilFontFamily")
      expect(
        required(hostile.inlineSink, "inline sink").innerHTML,
      ).not.toContain("EvilAltFontFamily")
    },
    MERMAID_TEST_TIMEOUT_MS,
  )

  test(
    "WHEN hostile theme/themeVariables directives THEN source directives SHALL NOT change styling",
    async () => {
      const control = await renderMermaidBlock(
        mermaidSource("control-theme.mmd"),
      )
      const hostile = await renderMermaidBlock(
        mermaidSource("directive-theme.mmd"),
      )
      expect(hostile.inlineSink?.querySelector("svg")).not.toBeNull()
      expect(normalizedPaintCss(hostile)).toBe(normalizedPaintCss(control))
      expect(
        required(hostile.inlineSink, "inline sink").innerHTML,
      ).not.toContain("EvilThemeVariableFont")
    },
    MERMAID_TEST_TIMEOUT_MS,
  )

  test(
    "WHEN a hostile htmlLabels directive THEN it SHALL NOT change label rendering (secure htmlLabels)",
    async () => {
      const control = await renderMermaidBlock(
        mermaidSource("control-htmllabels.mmd"),
      )
      const hostile = await renderMermaidBlock(
        mermaidSource("directive-htmllabels.mmd"),
      )
      expect(hostile.inlineSink?.querySelector("svg")).not.toBeNull()
      expect(normalizedMarkup(hostile)).toBe(normalizedMarkup(control))
    },
    MERMAID_TEST_TIMEOUT_MS,
  )

  test(
    "WHEN a hostile sequence-diagram themeCSS/fontFamily directive THEN it SHALL NOT change styling",
    async () => {
      const control = await renderMermaidBlock(
        mermaidSource("control-sequence-themecss.mmd"),
      )
      const hostile = await renderMermaidBlock(
        mermaidSource("directive-sequence-themecss.mmd"),
      )
      expect(hostile.inlineSink?.querySelector("svg")).not.toBeNull()
      expect(normalizedPaintCss(hostile)).toBe(normalizedPaintCss(control))
      expect(sinkViolations(hostile)).toEqual([])
    },
    MERMAID_TEST_TIMEOUT_MS,
  )

  test(
    "WHEN hostile classDef statements with position:fixed THEN no sink receives a <style> failing the CSS value profile (validated or failed closed)",
    async () => {
      const render = await renderMermaidBlock(
        mermaidSource("classdef-position-fixed.mmd"),
      )
      expect(sinkViolations(render)).toEqual([])
      expect(render.fullscreenSink?.innerHTML ?? null).toBe(
        render.inlineSink?.innerHTML ?? null,
      )
      expect(render.residue).toEqual([])
    },
    MERMAID_TEST_TIMEOUT_MS,
  )

  test(
    "WHEN hostile style statements with position:fixed THEN unreviewed CSS-bearing attributes SHALL be stripped (or the render fails closed)",
    async () => {
      const render = await renderMermaidBlock(
        mermaidSource("style-statement-position-fixed.mmd"),
      )
      expect(sinkViolations(render)).toEqual([])
      expect(render.fullscreenSink?.innerHTML ?? null).toBe(
        render.inlineSink?.innerHTML ?? null,
      )
      expect(render.residue).toEqual([])
    },
    MERMAID_TEST_TIMEOUT_MS,
  )

  test(
    "WHEN hostile classDef x fill:url(https://evil/x) THEN no remote url() reaches a sink and no transient artifact remains under document.body",
    async () => {
      const render = await renderMermaidBlock(
        mermaidSource("classdef-remote-url.mmd"),
      )
      expect(sinkViolations(render)).toEqual([])
      expect(render.container.innerHTML).not.toContain("url(https://evil/x)")
      expect(render.residue).toEqual([])
      expect(render.headAdditions).toEqual([])
    },
    MERMAID_TEST_TIMEOUT_MS,
  )

  test(
    "WHEN a flowchart carries htmlLabels payloads, click directives and javascript: links THEN the shared oracle holds for returned/sanitized SVG at both identical sinks and nothing executable remains under document.body",
    async () => {
      const render = await renderMermaidBlock(
        mermaidSource("flowchart-click-htmllabels.mmd"),
      )
      expect(render.inlineSink?.querySelector("svg")).not.toBeNull()
      expect(sinkViolations(render)).toEqual([])
      expect(render.fullscreenSink?.innerHTML).toBe(
        render.inlineSink?.innerHTML,
      )
      expect(render.residue).toEqual([])
      expect(render.headAdditions).toEqual([])
    },
    MERMAID_TEST_TIMEOUT_MS,
  )

  test(
    "WHEN a sequence diagram carries link/links javascript: URLs and script/img labels THEN the shared oracle holds at both identical sinks",
    async () => {
      const render = await renderMermaidBlock(
        mermaidSource("sequence-links-javascript.mmd"),
      )
      expect(render.inlineSink?.querySelector("svg")).not.toBeNull()
      expect(sinkViolations(render)).toEqual([])
      expect(render.fullscreenSink?.innerHTML).toBe(
        render.inlineSink?.innerHTML,
      )
      expect(render.residue).toEqual([])
    },
    MERMAID_TEST_TIMEOUT_MS,
  )

  test(
    "THEN Mermaid strict mode SHALL be the load-bearing control during the transient document.body mount: a securityLevel:loose directive cannot relax it",
    async () => {
      expect(MERMAID_SECURITY_LEVEL).toBe("strict")
      const render = await renderMermaidBlock(
        mermaidSource("directive-security-level-loose.mmd"),
      )
      expect(render.inlineSink?.querySelector("svg")).not.toBeNull()
      expect(await mermaidSiteSecurityLevel()).toBe("strict")
      expect(await mermaidSecureList()).toContain("securityLevel")
      expect(sinkViolations(render)).toEqual([])
      expect(render.residue).toEqual([])
    },
    MERMAID_TEST_TIMEOUT_MS,
  )
})

// ---------------------------------------------------------------------------
// D1/D3 — the specialized Mermaid adapter (mermaid-svg-sanitizer.ts) on
// returned SVG. DOMPurify is load-bearing; the DOMParser pass is defense in
// depth. Stray style / CSS-bearing attributes cannot be produced by pinned
// mermaid.render, so these are returned-SVG fixtures at the adapter boundary.
// ---------------------------------------------------------------------------

describe("D3 / Mermaid adapter: returned SVG under the Mermaid profile (DOMPurify load-bearing, DOMParser defense in depth)", () => {
  test("WHEN returned SVG carries a stray <style> THEN any other style element SHALL fail closed; only the single value-profile-validated paint <style> is retained", () => {
    const svgs = parseSanitizedSvg(
      sanitizeMermaidSvg(svgFixture("stray-style.svg")),
    )
    expect(svgs.flatMap((svg) => mermaidProfileViolations(svg))).toEqual([])
  })

  test("THEN unreviewed CSS-bearing attributes SHALL be stripped (style=position:fixed/url(), fill/filter url(https://…))", () => {
    const svgs = parseSanitizedSvg(
      sanitizeMermaidSvg(svgFixture("css-bearing-attributes.svg")),
    )
    expect(svgs.flatMap((svg) => mermaidProfileViolations(svg))).toEqual([])
  })

  test("THEN animate*/set elements SHALL NOT survive in returned SVG (D2 Mermaid oracle)", () => {
    const svgs = parseSanitizedSvg(
      sanitizeMermaidSvg(svgFixture("animation.svg")),
    )
    expect(svgs.flatMap((svg) => mermaidProfileViolations(svg))).toEqual([])
  })

  test("AND a parser-error pass-through SHALL NOT bypass or reorder the preceding DOMPurify sanitization", () => {
    const out = sanitizeMermaidSvg(svgFixture("parsererror-after-purify.svg"))
    const svgs = parseSanitizedSvg(out)
    expect(svgs.length).toBeGreaterThan(0)
    expect(svgs.flatMap((svg) => mermaidProfileViolations(svg))).toEqual([])
    expect(out).not.toContain("__mermaidParserErrorBypass")
  })
})

// ---------------------------------------------------------------------------
// D4 — runtime-security-baseline
// Scenario: Mentions editor receives browser rich content or restores content
// Unit half of D10: defaultPrevented, DOM-unchanged for HTML-only input,
// safe-builder plain-text insertion, editor oracle. Native rich paste/drop and
// native undo/redo are GUI task 5.1 evidence.
// ---------------------------------------------------------------------------

type EditorMount = {
  handle: AgentsMentionsEditorHandle
  editor: HTMLElement
  submits: string[]
}

type ExecCall = { command: string; value: string | undefined }

/**
 * happy-dom has no `document.execCommand`. D4/tasks 2.8 allow stubbing it.
 * This stub emulates only the browser's PLAIN-TEXT primitive (`insertText`
 * inserts one Text node at the selection); every other command is recorded
 * and refused, so a rich command can never succeed through it.
 */
function installExecCommandStub(): ExecCall[] {
  const calls: ExecCall[] = []
  Object.defineProperty(doc, "execCommand", {
    configurable: true,
    value: (command: string, _ui?: boolean, value?: string) => {
      calls.push({ command, value })
      if (command !== "insertText") return false
      const selection = testWindow.getSelection()
      if (!selection || selection.rangeCount === 0) return false
      const range = selection.getRangeAt(0)
      range.deleteContents()
      const text = doc.createTextNode(value ?? "")
      range.insertNode(text as unknown as Node)
      range.setStartAfter(text as unknown as Node)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
      return true
    },
  })
  return calls
}

async function mountEditor(options: {
  onPaste?: (event: unknown) => void
}): Promise<EditorMount> {
  const container = doc.createElement("div")
  container.setAttribute("data-test-root", "editor")
  doc.body.append(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  const ref = createRef<AgentsMentionsEditorHandle>()
  const submits: string[] = []
  await act(async () => {
    root.render(
      createElement(AgentsMentionsEditor, {
        ref,
        onTrigger: () => undefined,
        onCloseTrigger: () => undefined,
        onSubmit: () => {
          submits.push("submit")
        },
        onPaste: options.onPaste,
      }),
    )
  })
  const editor = container.querySelector("[contenteditable]") as HTMLElement
  return { handle: required(ref.current, "editor handle"), editor, submits }
}

async function setEditorValue(mount: EditorMount, value: string) {
  await act(async () => {
    mount.handle.setValue(value)
  })
}

function serializedLength(node: Node): number {
  if (node.nodeType === 3) return (node.textContent ?? "").length
  const element = node as Element
  if ((element.localName || "").toLowerCase() === "br") return 1
  const mentionId = element.getAttribute?.("data-mention-id")
  if (mentionId !== null && mentionId !== undefined)
    return `@[${mentionId}]`.length
  return Array.from(node.childNodes).reduce(
    (sum, child) => sum + serializedLength(child),
    0,
  )
}

/** Logical (serialized-token) offset of a DOM point; `null` if inside a mention. */
function logicalOffset(
  editor: HTMLElement,
  node: Node | null,
  offset: number,
): number | null {
  if (!node) return null
  if (node === editor) {
    return Array.from(editor.childNodes)
      .slice(0, offset)
      .reduce((sum, child) => sum + serializedLength(child), 0)
  }
  const mention = (
    node.nodeType === 1 ? (node as Element) : node.parentElement
  )?.closest?.("[data-mention-id]")
  if (mention && editor.contains(mention)) return null
  let top: Node = node
  while (top.parentNode && top.parentNode !== editor) top = top.parentNode
  const before = Array.from(editor.childNodes)
  const index = before.indexOf(top as ChildNode)
  const preceding = before
    .slice(0, index)
    .reduce((sum, child) => sum + serializedLength(child), 0)
  return preceding + (node.nodeType === 3 ? offset : 0)
}

function textPoint(
  editor: HTMLElement,
  logical: number,
): { node: Node; offset: number } {
  let consumed = 0
  for (const child of Array.from(editor.childNodes)) {
    const length = serializedLength(child)
    if (child.nodeType === 3 && logical <= consumed + length) {
      return { node: child, offset: logical - consumed }
    }
    consumed += length
  }
  throw new Error(`no text node at logical offset ${logical}`)
}

function selectLogical(editor: HTMLElement, anchor: number, focus: number) {
  const a = textPoint(editor, anchor)
  const f = textPoint(editor, focus)
  required(testWindow.getSelection(), "selection").setBaseAndExtent(
    a.node as never,
    a.offset,
    f.node as never,
    f.offset,
  )
}

function selectionLogical(editor: HTMLElement) {
  const selection = required(testWindow.getSelection(), "selection")
  return {
    anchor: logicalOffset(
      editor,
      selection.anchorNode as unknown as Node,
      selection.anchorOffset,
    ),
    focus: logicalOffset(
      editor,
      selection.focusNode as unknown as Node,
      selection.focusOffset,
    ),
  }
}

function dataTransferOf(entries: Record<string, string>, files: File[] = []) {
  const transfer = new testWindow.DataTransfer()
  for (const [type, value] of Object.entries(entries))
    transfer.setData(type, value)
  for (const file of files) transfer.items.add(file as never)
  return transfer
}

async function dispatchPaste(
  editor: HTMLElement,
  entries: Record<string, string>,
  files: File[] = [],
) {
  const event = new testWindow.ClipboardEvent("paste", {
    clipboardData: dataTransferOf(entries, files),
    bubbles: true,
    cancelable: true,
    composed: true,
  }) as unknown as Event
  await act(async () => {
    editor.dispatchEvent(event)
  })
  return event
}

async function dispatchDrag(
  editor: HTMLElement,
  type: "drop" | "dragover",
  entries: Record<string, string>,
) {
  const event = new testWindow.DragEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
  }) as unknown as Event
  // happy-dom 20.10.6 ignores `dataTransfer` in the DragEvent init dict.
  Object.defineProperty(event, "dataTransfer", {
    value: dataTransferOf(entries),
  })
  await act(async () => {
    editor.dispatchEvent(event)
  })
  return event
}

async function dispatchBeforeInput(
  editor: HTMLElement,
  inputType: string,
  data: string | null = null,
) {
  const event = new testWindow.InputEvent("beforeinput", {
    inputType,
    data,
    bubbles: true,
    cancelable: true,
    composed: true,
  }) as unknown as Event
  await act(async () => {
    editor.dispatchEvent(event)
  })
  return event
}

async function dispatchKey(
  editor: HTMLElement,
  init: { key: string; ctrlKey?: boolean; shiftKey?: boolean },
) {
  const event = new testWindow.KeyboardEvent("keydown", {
    ...init,
    bubbles: true,
    cancelable: true,
  }) as unknown as Event
  await act(async () => {
    editor.dispatchEvent(event)
  })
  return event
}

async function insertMention(mount: EditorMount, option: FileMentionOption) {
  await act(async () => {
    mount.handle.insertMention(option)
  })
}

function attackerFragment(): DocumentFragment {
  const template = doc.createElement(
    "template",
  ) as unknown as HTMLTemplateElement
  template.innerHTML = editorFixture("clipboard-rich.html")
  return template.content
}

const PLAIN_PAYLOAD = "PLAIN <b>not markup</b> & text"
const RICH_HTML = () => editorFixture("clipboard-rich.html")
const IMAGE_FILE = () =>
  new testWindow.File(["png-bytes"], "clip.png", {
    type: "image/png",
  }) as unknown as File

describe("D4 / Scenario: Mentions editor receives browser rich content — component-owned paste gate", () => {
  test("WHEN clipboard data is HTML-only THEN the editor itself SHALL reject it: defaultPrevented and DOM unchanged (no parent onPaste)", async () => {
    const execCalls = installExecCommandStub()
    const mount = await mountEditor({ onPaste: undefined })
    await setEditorValue(mount, "abcd")
    selectLogical(mount.editor, 2, 2)
    const before = mount.editor.innerHTML
    const event = await dispatchPaste(mount.editor, {
      "text/html": RICH_HTML(),
    })
    expect(event.defaultPrevented).toBe(true)
    expect(mount.editor.innerHTML).toBe(before)
    expect(execCalls.filter((call) => call.command !== "insertText")).toEqual(
      [],
    )
  })

  test("WHEN clipboard data is mixed THEN the editor SHALL consume only explicit text/plain through the safe builder", async () => {
    const execCalls = installExecCommandStub()
    const mount = await mountEditor({ onPaste: undefined })
    await setEditorValue(mount, "abcd")
    selectLogical(mount.editor, 2, 2)
    const event = await dispatchPaste(mount.editor, {
      "text/html": RICH_HTML(),
      "text/plain": PLAIN_PAYLOAD,
    })
    expect(event.defaultPrevented).toBe(true)
    expect(mount.handle.getValue()).toBe(`ab${PLAIN_PAYLOAD}cd`)
    expect(editorProfileViolations(mount.editor)).toEqual([])
    expect(mount.editor.innerHTML).not.toContain("RICH_HTML_MARKER")
    expect(execCalls.filter((call) => call.command !== "insertText")).toEqual(
      [],
    )
  })

  test("WHEN clipboard data is an image with no typed attachment callback THEN browser rich-content default SHALL NOT be returned to", async () => {
    installExecCommandStub()
    const mount = await mountEditor({ onPaste: undefined })
    await setEditorValue(mount, "abcd")
    selectLogical(mount.editor, 4, 4)
    const before = mount.editor.innerHTML
    const event = await dispatchPaste(mount.editor, {}, [IMAGE_FILE()])
    expect(event.defaultPrevented).toBe(true)
    expect(mount.editor.innerHTML).toBe(before)
  })

  test("AND component-owned paste gates SHALL prevent browser defaults independently of optional parent handlers (parent onPaste does not preventDefault)", async () => {
    installExecCommandStub()
    const parentSaw: string[] = []
    const mount = await mountEditor({
      onPaste: (event) => {
        parentSaw.push((event as { type: string }).type)
      },
    })
    await setEditorValue(mount, "abcd")
    selectLogical(mount.editor, 4, 4)
    const before = mount.editor.innerHTML
    const event = await dispatchPaste(
      mount.editor,
      { "text/html": RICH_HTML() },
      [IMAGE_FILE()],
    )
    expect(event.defaultPrevented).toBe(true)
    expect(mount.editor.innerHTML).toBe(before)
  })
})

describe("D4 / Scenario: Mentions editor receives browser rich content — component-owned drop/drag-over gate", () => {
  test("WHEN drop data is HTML-only THEN the editor SHALL reject it: defaultPrevented and DOM unchanged", async () => {
    installExecCommandStub()
    const mount = await mountEditor({ onPaste: undefined })
    await setEditorValue(mount, "abcd")
    selectLogical(mount.editor, 2, 2)
    const before = mount.editor.innerHTML
    const event = await dispatchDrag(mount.editor, "drop", {
      "text/html": RICH_HTML(),
    })
    expect(event.defaultPrevented).toBe(true)
    expect(mount.editor.innerHTML).toBe(before)
  })

  test("WHEN drop data is mixed THEN the editor SHALL consume only explicit text/plain through the safe builder or reject it", async () => {
    installExecCommandStub()
    const mount = await mountEditor({ onPaste: undefined })
    await setEditorValue(mount, "abcd")
    selectLogical(mount.editor, 2, 2)
    const event = await dispatchDrag(mount.editor, "drop", {
      "text/html": RICH_HTML(),
      "text/plain": PLAIN_PAYLOAD,
    })
    expect(event.defaultPrevented).toBe(true)
    expect(["abcd", `ab${PLAIN_PAYLOAD}cd`]).toContain(mount.handle.getValue())
    expect(editorProfileViolations(mount.editor)).toEqual([])
    expect(mount.editor.innerHTML).not.toContain("RICH_HTML_MARKER")
  })

  test("AND component-owned drag-over gates SHALL prevent browser defaults", async () => {
    const mount = await mountEditor({ onPaste: undefined })
    await setEditorValue(mount, "abcd")
    const event = await dispatchDrag(mount.editor, "dragover", {
      "text/html": RICH_HTML(),
    })
    expect(event.defaultPrevented).toBe(true)
  })
})

const PREVENTED_INPUT_TYPES = [
  "insertFromPaste",
  "insertFromDrop",
  "insertLink",
  "insertReplacementText",
  "formatBold",
  "formatItalic",
  "formatUnderline",
  "formatStrikeThrough",
  "formatFontColor",
  "formatBackColor",
  "formatSetBlockTextDirection",
  "insertOrderedList",
  "insertUnorderedList",
  "insertHorizontalRule",
  "insertFromYank",
  "insertFromPasteAsQuotation",
  "insertTranspose",
]

const ADMITTED_INPUT_TYPES = [
  "insertText",
  "insertCompositionText",
  "deleteContentBackward",
  "deleteContentForward",
  "deleteByCut",
  "deleteByDrag",
  "deleteWordBackward",
  "deleteWordForward",
  "deleteSoftLineBackward",
  "deleteSoftLineForward",
  "deleteHardLineBackward",
  "deleteEntireSoftLine",
]

describe("D4 / Scenario: Mentions editor — one component-owned beforeinput allowlist", () => {
  test.each(
    PREVENTED_INPUT_TYPES,
  )("AND all other input types SHALL be prevented: beforeinput %s is default-prevented and leaves only text/br/mention DOM", async (inputType) => {
    const mount = await mountEditor({ onPaste: undefined })
    await setEditorValue(mount, "abcd")
    selectLogical(mount.editor, 1, 3)
    const valueBefore = mount.handle.getValue()
    const event = await dispatchBeforeInput(mount.editor, inputType, null)
    expect(event.defaultPrevented).toBe(true)
    expect(mount.handle.getValue()).toBe(valueBefore)
    expect(editorProfileViolations(mount.editor)).toEqual([])
  })

  test.each(
    ADMITTED_INPUT_TYPES,
  )("AND ordinary text/IME input and admitted deletions SHALL NOT be blanket-prevented: beforeinput %s is not default-prevented", async (inputType) => {
    const mount = await mountEditor({ onPaste: undefined })
    await setEditorValue(mount, "abcd")
    selectLogical(mount.editor, 2, 2)
    const before = mount.editor.innerHTML
    const event = await dispatchBeforeInput(
      mount.editor,
      inputType,
      inputType.startsWith("insert") ? "x" : null,
    )
    expect(event.defaultPrevented).toBe(false)
    expect(mount.editor.innerHTML).toBe(before)
  })

  test.each([
    "insertLineBreak",
    "insertParagraph",
  ])("AND %s SHALL prevent browser default and insert the newline through the safe text-node/br builder without div wrappers", async (inputType) => {
    installExecCommandStub()
    const mount = await mountEditor({ onPaste: undefined })
    await setEditorValue(mount, "abcd")
    selectLogical(mount.editor, 2, 2)
    const event = await dispatchBeforeInput(mount.editor, inputType, null)
    expect(event.defaultPrevented).toBe(true)
    expect(mount.handle.getValue()).toBe("ab\ncd")
    expect(editorProfileViolations(mount.editor)).toEqual([])
  })

  test("AND non-shift Enter submit SHALL be preserved", async () => {
    const mount = await mountEditor({ onPaste: undefined })
    await setEditorValue(mount, "send me")
    selectLogical(mount.editor, 7, 7)
    const event = await dispatchKey(mount.editor, { key: "Enter" })
    expect(event.defaultPrevented).toBe(true)
    expect(mount.submits).toEqual(["submit"])
    expect(mount.handle.getValue()).toBe("send me")
  })

  test("AND historyUndo SHALL prevent browser default and route through canonical state restoration", async () => {
    const mount = await mountEditor({ onPaste: undefined })
    await setEditorValue(mount, "one two")
    selectLogical(mount.editor, 7, 7)
    const beforeMutation = mount.handle.getValue()
    await insertMention(mount, {
      id: "skill:undo-probe",
      label: "undo-probe",
      path: "",
      repository: "",
      type: "skill",
    })
    expect(mount.handle.getValue()).not.toBe(beforeMutation)
    const event = await dispatchBeforeInput(mount.editor, "historyUndo", null)
    expect(event.defaultPrevented).toBe(true)
    expect(mount.handle.getValue()).toBe(beforeMutation)
    expect(editorProfileViolations(mount.editor)).toEqual([])
  })

  test("AND historyRedo SHALL prevent browser default and route through canonical state restoration", async () => {
    const mount = await mountEditor({ onPaste: undefined })
    await setEditorValue(mount, "one two")
    selectLogical(mount.editor, 7, 7)
    await insertMention(mount, {
      id: "skill:redo-probe",
      label: "redo-probe",
      path: "",
      repository: "",
      type: "skill",
    })
    const afterMutation = mount.handle.getValue()
    await dispatchKey(mount.editor, { key: "z", ctrlKey: true })
    expect(mount.handle.getValue()).not.toBe(afterMutation)
    const event = await dispatchBeforeInput(mount.editor, "historyRedo", null)
    expect(event.defaultPrevented).toBe(true)
    expect(mount.handle.getValue()).toBe(afterMutation)
    expect(editorProfileViolations(mount.editor)).toEqual([])
  })
})

describe("D4 / Scenario: Mentions editor restores content — canonical text/atomic-mention runs and logical selection", () => {
  test("WHEN an undo entry contains attacker-controlled markup THEN undo SHALL rebuild with safe DOM construction rather than a value-bearing innerHTML restore", async () => {
    const mount = await mountEditor({ onPaste: undefined })
    await setEditorValue(mount, "hello world")
    mount.editor.append(attackerFragment())
    selectLogical(mount.editor, 5, 5)
    await insertMention(mount, {
      id: "skill:markup-probe",
      label: "markup-probe",
      path: "",
      repository: "",
      type: "skill",
    })
    const event = await dispatchKey(mount.editor, { key: "z", ctrlKey: true })
    expect(event.defaultPrevented).toBe(true)
    expect(editorProfileViolations(mount.editor)).toEqual([])
    expect(mount.editor.textContent).toContain("RICH_HTML_MARKER")
    expect(mount.handle.getValue()).not.toContain("@[skill:markup-probe]")
  })

  test("WHEN a redo entry contains attacker-controlled markup THEN redo SHALL rebuild with safe DOM construction rather than a value-bearing innerHTML restore", async () => {
    const mount = await mountEditor({ onPaste: undefined })
    await setEditorValue(mount, "hello world")
    selectLogical(mount.editor, 11, 11)
    await insertMention(mount, {
      id: "skill:redo-markup",
      label: "redo-markup",
      path: "",
      repository: "",
      type: "skill",
    })
    mount.editor.append(attackerFragment())
    await dispatchKey(mount.editor, { key: "z", ctrlKey: true })
    const event = await dispatchKey(mount.editor, {
      key: "z",
      ctrlKey: true,
      shiftKey: true,
    })
    expect(event.defaultPrevented).toBe(true)
    expect(editorProfileViolations(mount.editor)).toEqual([])
    expect(mount.handle.getValue()).toContain("@[skill:redo-markup]")
    expect(mount.editor.textContent).toContain("RICH_HTML_MARKER")
  })

  test("AND undo SHALL retain logical selection state: a forward selection (anchor 6, focus 11) is restored", async () => {
    const mount = await mountEditor({ onPaste: undefined })
    await setEditorValue(mount, "hello world")
    selectLogical(mount.editor, 6, 11)
    await insertMention(mount, {
      id: "skill:forward",
      label: "forward",
      path: "",
      repository: "",
      type: "skill",
    })
    await dispatchKey(mount.editor, { key: "z", ctrlKey: true })
    expect(mount.handle.getValue()).toBe("hello world")
    expect(selectionLogical(mount.editor)).toEqual({ anchor: 6, focus: 11 })
  })

  test("AND undo SHALL retain logical selection state: a backward selection (anchor 11, focus 6) is restored", async () => {
    const mount = await mountEditor({ onPaste: undefined })
    await setEditorValue(mount, "hello world")
    selectLogical(mount.editor, 11, 6)
    await insertMention(mount, {
      id: "skill:backward",
      label: "backward",
      path: "",
      repository: "",
      type: "skill",
    })
    await dispatchKey(mount.editor, { key: "z", ctrlKey: true })
    expect(mount.handle.getValue()).toBe("hello world")
    expect(selectionLogical(mount.editor)).toEqual({ anchor: 11, focus: 6 })
  })

  test("AND mention positions are atomic: a caret saved inside a mention chip is restored only before or after the mention run", async () => {
    const mount = await mountEditor({ onPaste: undefined })
    await setEditorValue(mount, "a @[skill:atomic-probe] b")
    const mention = required(
      mount.editor.querySelector('[data-mention-id="skill:atomic-probe"]'),
      "mention chip",
    )
    const label = required(
      Array.from(mention.querySelectorAll("span")).find(
        (span) => span.textContent === "atomic-probe",
      ),
      "mention label",
    )
    const labelText = required(label.firstChild, "mention label text")
    required(testWindow.getSelection(), "selection").setBaseAndExtent(
      labelText as never,
      2,
      labelText as never,
      2,
    )
    await insertMention(mount, {
      id: "skill:second",
      label: "second",
      path: "",
      repository: "",
      type: "skill",
    })
    await dispatchKey(mount.editor, { key: "z", ctrlKey: true })
    const start = 2
    const end = 2 + "@[skill:atomic-probe]".length
    const { anchor, focus } = selectionLogical(mount.editor)
    expect([start, end]).toContain(anchor)
    expect(focus).toBe(anchor)
  })

  test("AND undo/redo round-trips the serialized value", async () => {
    const mount = await mountEditor({ onPaste: undefined })
    await setEditorValue(mount, "alpha beta")
    selectLogical(mount.editor, 10, 10)
    const beforeMutation = mount.handle.getValue()
    await insertMention(mount, {
      id: "file:repo:src/round.ts",
      label: "round.ts",
      path: "src/round.ts",
      repository: "repo",
      type: "file",
    })
    const afterMutation = mount.handle.getValue()
    await dispatchKey(mount.editor, { key: "z", ctrlKey: true })
    expect(mount.handle.getValue()).toBe(beforeMutation)
    await dispatchKey(mount.editor, { key: "z", ctrlKey: true, shiftKey: true })
    expect(mount.handle.getValue()).toBe(afterMutation)
    expect(editorProfileViolations(mount.editor)).toEqual([])
  })

  test.each([
    ["double spaces around a mention", "a  @[file:repo:src/x.ts]  b"],
    ["a trailing mention", "trailing @[skill:foo]"],
    ["adjacent mentions", "@[agent:bot]@[skill:foo]"],
    [
      "newlines adjacent to a mention",
      "line one\n@[folder:repo:src]\nline two",
    ],
  ])("AND the lossless run model SHALL satisfy serialize(build(state)) === state for %s", async (_label, value) => {
    const mount = await mountEditor({ onPaste: undefined })
    await setEditorValue(mount, value)
    expect(mount.handle.getValue()).toBe(value)
    expect(editorProfileViolations(mount.editor)).toEqual([])
  })
})
