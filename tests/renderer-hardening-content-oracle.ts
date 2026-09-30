/**
 * Independent rendered-DOM executable-markup oracle for the
 * `add-renderer-untrusted-content-hardening` test-first suite (design D2).
 *
 * This file is owned by the independent test author. It intentionally does
 * NOT import the implementer's proposed `tests/helpers/renderer-executable-
 * markup-oracle.ts` or the `renderer-html-policy.ts` owner: the suites must be
 * able to judge the implementation without trusting its own oracle.
 *
 * The oracle walks the actual DOM (including open Shadow DOM descendants and
 * namespace-aware SVG/MathML nodes) and reports violations of D2's global
 * rules plus the explicit per-profile allowances:
 *
 * - `markdown` / `highlighted-code`: no style element, no fragment URL,
 *   HTTP(S)/mailto links, HTTP(S) media, relative URLs resolve against the
 *   privileged app document base (a `file:` document) and therefore fail
 *   closed unless the reviewed producer rewrote them to an explicit HTTP(S)
 *   base.
 * - `diff`: D2's strictly enumerated diff profile, bound to the repository
 *   constant CSS supplied by the caller (never read from the producer output).
 *
 * This is not a test file (no `.test.` infix); Bun only collects it through
 * the suites that import it.
 */
import { Window } from "happy-dom"

/** The privileged app document is a `file:` document in packaged builds. */
export const PRIVILEGED_APP_DOCUMENT_BASE =
  "file:///opt/Locus/resources/app.asar/out/renderer/index.html"

export type OracleProfile =
  | { kind: "markdown" }
  | { kind: "highlighted-code" }
  | { kind: "diff"; expectedUnsafeCssTextContent: string }

export interface OracleViolation {
  rule: string
  path: string
  detail: string
}

const FORBIDDEN_ELEMENTS = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "frame",
  "frameset",
  "base",
  "meta",
  "link",
  "foreignobject",
  "set",
  "maction",
])

const URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "xlink:href",
  "action",
  "formaction",
  "poster",
  "data",
])

const LINK_SCHEMES = new Set(["http:", "https:", "mailto:"])
const MEDIA_SCHEMES = new Set(["http:", "https:"])

const DIFF_USE_HREF = /^#diffs-icon-[a-z0-9-]+$/

// biome-ignore lint/suspicious/noControlCharactersInRegex: URL parsers strip C0 controls and whitespace; the oracle must too.
const URL_IGNORED_CHARACTERS = /[\u0000- \u007f]/g

const DANGEROUS_INLINE_CSS = [
  /url\s*\(/i,
  /expression\s*\(/i,
  /@import/i,
  /behavior\s*:/i,
  /-moz-binding/i,
  /position\s*:\s*(fixed|absolute)/i,
]

type DomNode = {
  nodeType: number
  nodeName: string
  childNodes: ArrayLike<DomNode>
  parentNode?: DomNode | null
  textContent?: string | null
}

type DomElement = DomNode & {
  localName: string
  tagName: string
  attributes: ArrayLike<{ name: string; value: string }>
  shadowRoot?: DomNode | null
  getAttribute(name: string): string | null
  hasAttribute(name: string): boolean
}

const ELEMENT_NODE = 1

function isElement(node: DomNode): node is DomElement {
  return node.nodeType === ELEMENT_NODE
}

function describe(el: DomElement): string {
  return el.localName.toLowerCase()
}

function urlScheme(rawValue: string): string | null {
  const compact = rawValue.replace(URL_IGNORED_CHARACTERS, "")
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(compact)
  return match ? `${match[1].toLowerCase()}:` : null
}

function isUrlAllowed(
  attrName: string,
  el: DomElement,
  value: string,
): { ok: boolean; detail: string } {
  const compact = value.replace(URL_IGNORED_CHARACTERS, "")
  if (compact.length === 0) {
    return { ok: true, detail: "empty" }
  }
  const tag = el.localName.toLowerCase()
  const isLink =
    (attrName === "href" || attrName === "xlink:href") &&
    (tag === "a" || tag === "area")
  const allowed = isLink ? LINK_SCHEMES : MEDIA_SCHEMES
  const scheme = urlScheme(value)
  if (scheme) {
    return {
      ok: allowed.has(scheme),
      detail: `${attrName}=${JSON.stringify(value)} scheme ${scheme}`,
    }
  }
  if (compact.startsWith("#")) {
    return {
      ok: false,
      detail: `${attrName}=${JSON.stringify(value)} fragment reference is not in the profile`,
    }
  }
  // Relative URL: resolve against the privileged document base. A relative
  // reference that is not rewritten by a reviewed producer inherits `file:`.
  const resolved = new URL(compact, PRIVILEGED_APP_DOCUMENT_BASE)
  return {
    ok: allowed.has(resolved.protocol),
    detail: `${attrName}=${JSON.stringify(value)} resolves to ${resolved.href}`,
  }
}

function hasAncestorWithAttribute(
  el: DomElement,
  attributes: string[],
): boolean {
  let current: DomNode | null | undefined = el.parentNode
  while (current) {
    if (isElement(current)) {
      for (const attribute of attributes) {
        if (current.hasAttribute(attribute)) return true
      }
    }
    current = current.parentNode
  }
  return false
}

interface WalkState {
  violations: OracleViolation[]
  unsafeCssStyles: DomElement[]
}

function walk(
  node: DomNode,
  profile: OracleProfile,
  path: string,
  state: WalkState,
): void {
  if (isElement(node)) {
    const name = describe(node)
    const here = `${path}/${name}`
    if (FORBIDDEN_ELEMENTS.has(name) || name.startsWith("animate")) {
      state.violations.push({
        rule: "forbidden-element",
        path: here,
        detail: name,
      })
    }
    if (name === "style") {
      if (profile.kind === "diff" && node.hasAttribute("data-unsafe-css")) {
        state.unsafeCssStyles.push(node)
      } else {
        state.violations.push({
          rule: "forbidden-style-element",
          path: here,
          detail: (node.textContent ?? "").slice(0, 120),
        })
      }
    }
    for (const attr of Array.from(node.attributes)) {
      const attrName = attr.name.toLowerCase()
      if (attrName.startsWith("on")) {
        state.violations.push({
          rule: "event-handler-attribute",
          path: here,
          detail: `${attrName}=${JSON.stringify(attr.value)}`,
        })
        continue
      }
      if (attrName === "srcdoc") {
        state.violations.push({
          rule: "srcdoc-attribute",
          path: here,
          detail: attr.value.slice(0, 120),
        })
        continue
      }
      if (attrName === "style") {
        for (const pattern of DANGEROUS_INLINE_CSS) {
          if (pattern.test(attr.value)) {
            state.violations.push({
              rule: "unreviewed-inline-css",
              path: here,
              detail: attr.value.slice(0, 160),
            })
            break
          }
        }
        continue
      }
      if (URL_ATTRIBUTES.has(attrName)) {
        if (
          profile.kind === "diff" &&
          name === "use" &&
          (attrName === "href" || attrName === "xlink:href")
        ) {
          const inSeparator = hasAncestorWithAttribute(node, [
            "data-separator",
            "data-expand-button",
          ])
          if (!DIFF_USE_HREF.test(attr.value) || !inSeparator) {
            state.violations.push({
              rule: "diff-use-href",
              path: here,
              detail: `${attrName}=${JSON.stringify(attr.value)} inSeparator=${inSeparator}`,
            })
          }
          continue
        }
        const verdict = isUrlAllowed(attrName, node, attr.value)
        if (!verdict.ok) {
          state.violations.push({
            rule: "disallowed-url",
            path: here,
            detail: verdict.detail,
          })
        }
      }
    }
    if (node.shadowRoot) {
      walk(node.shadowRoot, profile, `${here}/#shadow-root`, state)
    }
    for (const child of Array.from(node.childNodes)) {
      walk(child, profile, here, state)
    }
    return
  }
  for (const child of Array.from(node.childNodes)) {
    walk(child, profile, path, state)
  }
}

/**
 * Returns every oracle violation in the untrusted-content subtree rooted at
 * `root`. An empty array means the subtree satisfies the profile.
 */
export function findExecutableMarkup(
  root: DomNode,
  profile: OracleProfile,
): OracleViolation[] {
  const state: WalkState = { violations: [], unsafeCssStyles: [] }
  walk(root, profile, "", state)
  if (profile.kind === "diff") {
    if (state.unsafeCssStyles.length !== 1) {
      state.violations.push({
        rule: "diff-unsafe-css-count",
        path: "",
        detail: `expected exactly one style[data-unsafe-css], found ${state.unsafeCssStyles.length}`,
      })
    }
    for (const style of state.unsafeCssStyles) {
      const childKinds = Array.from(style.childNodes).map((child) =>
        child.nodeType === 3
          ? "#text"
          : isElement(child)
            ? child.localName.toLowerCase()
            : child.nodeName,
      )
      const badChild = childKinds.find(
        (kind) => kind !== "#text" && kind !== "br",
      )
      if (badChild) {
        state.violations.push({
          rule: "diff-unsafe-css-child",
          path: "style[data-unsafe-css]",
          detail: `unexpected child ${badChild}`,
        })
      }
      if ((style.textContent ?? "") !== profile.expectedUnsafeCssTextContent) {
        state.violations.push({
          rule: "diff-unsafe-css-drift",
          path: "style[data-unsafe-css]",
          detail: `textContent length ${(style.textContent ?? "").length} != expected ${profile.expectedUnsafeCssTextContent.length}`,
        })
      }
    }
  }
  return state.violations
}

/**
 * D2 diff-profile transform: `@pierre/diffs@1.0.10` writes
 * `wrapUnsafeCSS(constant)` through the `innerText` setter, so the applied
 * `textContent` is the wrapper with every `\n`/`\r` removed.
 */
export function expectedDiffUnsafeCssTextContent(wrapped: string): string {
  return wrapped.replace(/[\r\n]/g, "")
}

/** Installs a fresh happy-dom Window as the global DOM for one test file. */
export function installHappyDom(url = "http://localhost/"): Window {
  const testWindow = new Window({ url })
  const globals = globalThis as Record<string, unknown>
  const names = [
    "window",
    "document",
    "navigator",
    "location",
    "localStorage",
    "sessionStorage",
    "Node",
    "Element",
    "HTMLElement",
    "SVGElement",
    "Text",
    "DocumentFragment",
    "ShadowRoot",
    "CSSStyleSheet",
    "HTMLStyleElement",
    "HTMLTemplateElement",
    "MutationObserver",
    "ResizeObserver",
    "IntersectionObserver",
    "customElements",
    "DOMParser",
    "Event",
    "MouseEvent",
    "KeyboardEvent",
    "CustomEvent",
  ]
  const source = testWindow as unknown as Record<string, unknown>
  for (const name of names) {
    if (source[name] !== undefined) {
      globals[name] = source[name]
    }
  }
  globals.getComputedStyle = testWindow.getComputedStyle.bind(testWindow)
  globals.requestAnimationFrame =
    testWindow.requestAnimationFrame.bind(testWindow)
  globals.cancelAnimationFrame =
    testWindow.cancelAnimationFrame.bind(testWindow)
  globals.IS_REACT_ACT_ENVIRONMENT = true
  return testWindow
}
