/**
 * Specialized reviewed adapter for Mermaid SVG (openspec change
 * `add-renderer-untrusted-content-hardening`, design D1/D3).
 *
 * Controls, in order:
 * 1. Pinned Mermaid strict mode plus the extended `secure` list
 *    (`MERMAID_SECURE_CONFIG_KEYS`) are the load-bearing controls while
 *    Mermaid transiently mounts the diagram under `document.body`: source
 *    directives cannot change styling before that mount, and
 *    `assertMermaidDirectiveSuppression` fails closed when Mermaid's live
 *    site configuration does not prove it.
 * 2. DOMPurify is the load-bearing sanitizer for the returned SVG. The
 *    Mermaid paint profile then runs on DOMPurify's own tree before
 *    serialization: only the Mermaid-generated paint `<style>` (the first
 *    `<style>` child of the diagram root) is retained, and only when it passes the
 *    owner's reviewed CSS value profile; every other `<style>` is removed and
 *    CSS-bearing attributes are reduced to their reviewed values.
 * 3. The DOMParser pass is defense in depth: it repeats the same profile on
 *    an independent XML parse. On a parser error it returns the already
 *    purified and profiled markup, never the raw SVG.
 *
 * The CSS value profiles and the Mermaid SVG profile walk
 * (`applyMermaidSvgProfile`, applied here in `strip` mode) are owned by
 * `renderer-html-policy.ts`. This adapter returns a string; the Mermaid raw
 * sinks accept only the owner's sealed `reviewMermaidSvgOutput()` result,
 * which re-checks that string in the sink's own HTML parse.
 */
import createDOMPurify, { type Config } from "dompurify"
import {
  applyMermaidSvgProfile,
  isUnsafeMermaidSvgAttribute,
} from "./renderer-html-policy"

export const MERMAID_SECURITY_LEVEL = "strict" as const

/**
 * The pinned configuration's `secure` list: Mermaid 11's default secure keys
 * plus every styling key a source directive (`%%{init: …}%%` or front-matter
 * `config:`) could otherwise use to restyle the diagram before the transient
 * render mount (design D3). Mermaid merges this list into its site
 * configuration and deletes these keys, at any depth, from every directive.
 */
export const MERMAID_SECURE_CONFIG_KEYS: readonly string[] = Object.freeze([
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
])

/**
 * Fails closed unless Mermaid's live site configuration proves strict mode
 * and the complete `secure` list (for example after a dependency upgrade that
 * stopped honouring `secure`).
 */
export function assertMermaidDirectiveSuppression(siteConfig: {
  secure?: readonly string[]
  securityLevel?: string
}): void {
  const secure = siteConfig.secure ?? []
  const missing = MERMAID_SECURE_CONFIG_KEYS.filter(
    (key) => !secure.includes(key),
  )
  if (
    siteConfig.securityLevel !== MERMAID_SECURITY_LEVEL ||
    missing.length > 0
  ) {
    throw new Error(
      "Mermaid rendering is disabled: directive suppression could not be verified",
    )
  }
}

export const MERMAID_SVG_SANITIZE_CONFIG: Config = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: [
    "script",
    "foreignObject",
    "animate",
    "animateColor",
    "animateMotion",
    "animateTransform",
    "discard",
    "mpath",
    "set",
  ],
  FORBID_ATTR: [
    "href",
    "xlink:href",
    "onclick",
    "ondblclick",
    "onerror",
    "onfocus",
    "onload",
    "onmousedown",
    "onmouseenter",
    "onmouseleave",
    "onmousemove",
    "onmouseout",
    "onmouseover",
    "onmouseup",
  ],
  ALLOW_DATA_ATTR: false,
  RETURN_TRUSTED_TYPE: false,
}

type DomPurifyInstance = ReturnType<typeof createDOMPurify>

let browserPurifier: DomPurifyInstance | null = null

const ELEMENT_NODE = 1
const TEXT_NODE = 3

function hardenMermaidSvgAttributes(purifier: DomPurifyInstance) {
  purifier.addHook("uponSanitizeAttribute", (_node, data) => {
    if (isUnsafeMermaidSvgAttribute(data.attrName, data.attrValue)) {
      data.keepAttr = false
    }
  })
}

function localNameOf(element: Element): string {
  return (element.localName || "").toLowerCase()
}

/**
 * Keeps only the first top-level `<svg>` of DOMPurify's output tree (plus
 * whitespace) and applies the Mermaid SVG profile to it. Returns false when
 * there is no diagram root.
 */
function profilePurifiedTree(container: Node): boolean {
  let root: Element | null = null
  for (const node of Array.from(container.childNodes)) {
    if (
      root === null &&
      node.nodeType === ELEMENT_NODE &&
      localNameOf(node as Element) === "svg"
    ) {
      root = node as Element
    } else if (
      node.nodeType !== TEXT_NODE ||
      (node.textContent ?? "").trim() !== ""
    ) {
      container.removeChild(node)
    }
  }
  if (!root) return false
  applyMermaidSvgProfile(root, "strip")
  return true
}

function removeUnsafeMermaidSvgAttributes(svg: string): string {
  const parser = new window.DOMParser()
  const document = parser.parseFromString(svg, "image/svg+xml")
  const root = document.documentElement

  if (
    !root ||
    root.nodeName.toLowerCase() === "parsererror" ||
    document.getElementsByTagName("parsererror").length > 0 ||
    localNameOf(root) !== "svg"
  ) {
    return svg
  }

  applyMermaidSvgProfile(root, "strip")

  return new window.XMLSerializer().serializeToString(root)
}

function getBrowserPurifier(): DomPurifyInstance {
  if (typeof window === "undefined") {
    throw new Error("Mermaid SVG sanitization requires a browser window")
  }

  if (!browserPurifier) {
    browserPurifier = createDOMPurify(window)
    hardenMermaidSvgAttributes(browserPurifier)
  }

  return browserPurifier
}

export function sanitizeMermaidSvg(svg: string): string {
  const purified = getBrowserPurifier().sanitize(svg, {
    ...MERMAID_SVG_SANITIZE_CONFIG,
    RETURN_DOM: true,
  })
  if (!profilePurifiedTree(purified)) return ""
  return removeUnsafeMermaidSvgAttributes((purified as Element).innerHTML)
}
