/**
 * Shared rendered-DOM executable-markup oracle (design D2), implementing the
 * profiles defined by the reviewed renderer HTML owner
 * `src/renderer/lib/security/renderer-html-policy.ts#RENDERER_MARKUP_PROFILES`.
 *
 * It walks the actual untrusted-output subtree, including open Shadow DOM
 * descendants and namespace-aware SVG/MathML nodes, and reports every
 * violation of the global rules plus the per-profile allowances. The Mermaid
 * and editor profiles are added by their owners (Phase II of the change).
 *
 * Not a test file (no `.test.` infix): Bun only loads it through importers.
 */
import { RENDERER_MARKUP_PROFILES } from "../../src/renderer/lib/security/renderer-html-policy"

export type MarkupOracleProfile =
  | { kind: "markdown" }
  | { kind: "highlightedCode" }
  | { kind: "diff"; expectedUnsafeCssTextContent: string }

export interface MarkupOracleViolation {
  rule: string
  path: string
  detail: string
}

type OracleNode = {
  nodeType: number
  childNodes: ArrayLike<OracleNode>
  parentNode?: OracleNode | null
  textContent?: string | null
}

type OracleElement = OracleNode & {
  localName: string
  attributes: ArrayLike<{ name: string; value: string }>
  shadowRoot?: OracleNode | null
  hasAttribute(name: string): boolean
}

const ELEMENT_NODE = 1
const TEXT_NODE = 3

// biome-ignore lint/suspicious/noControlCharactersInRegex: URL parsers ignore C0 controls and spaces; the oracle must too.
const URL_IGNORED_CHARACTERS = /[\u0000- \u007f]/g

const DANGEROUS_INLINE_CSS = [
  /url\s*\(/i,
  /expression\s*\(/i,
  /@import/i,
  /behavior\s*:/i,
  /-moz-binding/i,
  /position\s*:\s*(?:fixed|absolute)/i,
]

function isElement(node: OracleNode): node is OracleElement {
  return node.nodeType === ELEMENT_NODE
}

function profileRules(profile: MarkupOracleProfile) {
  return RENDERER_MARKUP_PROFILES[profile.kind]
}

function urlScheme(compact: string): string | null {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(compact)
  return match ? `${match[1].toLowerCase()}:` : null
}

function urlVerdict(
  profile: MarkupOracleProfile,
  element: OracleElement,
  attribute: string,
  value: string,
): string | null {
  const compact = value.replace(URL_IGNORED_CHARACTERS, "")
  if (compact.length === 0) return null
  const rules = profileRules(profile)
  const tag = element.localName.toLowerCase()
  const isLink =
    (attribute === "href" || attribute === "xlink:href") &&
    (tag === "a" || tag === "area")
  const allowed: readonly string[] = isLink
    ? rules.linkSchemes
    : rules.mediaSchemes
  const scheme = urlScheme(compact)
  if (scheme) {
    return allowed.includes(scheme) ? null : `scheme ${scheme} not allowed`
  }
  if (compact.startsWith("#")) {
    return rules.allowFragmentUrls ? null : "fragment URL not in profile"
  }
  if (rules.relativeUrlBase === null) {
    return "relative URL without a reviewed base"
  }
  const resolved = new URL(compact, rules.relativeUrlBase)
  return allowed.includes(resolved.protocol)
    ? null
    : `relative URL resolves to ${resolved.protocol}`
}

function hasAncestorWithAttribute(
  element: OracleElement,
  attributes: readonly string[],
): boolean {
  let current = element.parentNode
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

function inlineStyleViolation(
  profile: MarkupOracleProfile,
  element: OracleElement,
  value: string,
): string | null {
  for (const pattern of DANGEROUS_INLINE_CSS) {
    if (pattern.test(value)) return `dangerous inline CSS ${pattern}`
  }
  if (
    profile.kind === "highlightedCode" &&
    element.localName.toLowerCase() === "span"
  ) {
    const reviewed: readonly string[] =
      RENDERER_MARKUP_PROFILES.highlightedCode.spanStyleProperties
    for (const declaration of value.split(";")) {
      const property = declaration.split(":")[0]?.trim().toLowerCase()
      if (property && !reviewed.includes(property)) {
        return `unreviewed span style property ${property}`
      }
    }
  }
  return null
}

interface WalkState {
  violations: MarkupOracleViolation[]
  unsafeCssStyles: OracleElement[]
}

function walk(
  node: OracleNode,
  profile: MarkupOracleProfile,
  path: string,
  state: WalkState,
): void {
  if (!isElement(node)) {
    for (const child of Array.from(node.childNodes)) {
      walk(child, profile, path, state)
    }
    return
  }
  const name = node.localName.toLowerCase()
  const here = `${path}/${name}`
  const report = (rule: string, detail: string) =>
    state.violations.push({ rule, path: here, detail })

  const forbidden: readonly string[] =
    RENDERER_MARKUP_PROFILES.forbiddenElements
  if (
    forbidden.includes(name) ||
    RENDERER_MARKUP_PROFILES.forbiddenElementPrefixes.some((prefix) =>
      name.startsWith(prefix),
    )
  ) {
    report("forbidden-element", name)
  }
  if (name === "style") {
    if (
      profile.kind === "diff" &&
      node.hasAttribute(RENDERER_MARKUP_PROFILES.diff.unsafeCssStyleAttribute)
    ) {
      state.unsafeCssStyles.push(node)
    } else {
      report("forbidden-style-element", (node.textContent ?? "").slice(0, 80))
    }
  }
  const urlAttributes: readonly string[] =
    RENDERER_MARKUP_PROFILES.urlAttributes
  for (const attribute of Array.from(node.attributes)) {
    const attributeName = attribute.name.toLowerCase()
    if (attributeName.startsWith("on")) {
      report("event-handler-attribute", attributeName)
    } else if (attributeName === "srcdoc") {
      report("srcdoc-attribute", attribute.value.slice(0, 80))
    } else if (attributeName === "style") {
      const verdict = inlineStyleViolation(profile, node, attribute.value)
      if (verdict) report("unreviewed-inline-css", verdict)
    } else if (urlAttributes.includes(attributeName)) {
      if (
        profile.kind === "diff" &&
        name === "use" &&
        (attributeName === "href" || attributeName === "xlink:href")
      ) {
        const rules = RENDERER_MARKUP_PROFILES.diff
        if (
          !rules.useHrefPattern.test(attribute.value) ||
          !hasAncestorWithAttribute(node, rules.useHrefAncestorAttributes)
        ) {
          report("diff-use-href", attribute.value)
        }
        continue
      }
      const verdict = urlVerdict(profile, node, attributeName, attribute.value)
      if (verdict) {
        report(
          "disallowed-url",
          `${attributeName}=${attribute.value}: ${verdict}`,
        )
      }
    }
  }
  if (node.shadowRoot) {
    walk(node.shadowRoot, profile, `${here}/#shadow-root`, state)
  }
  for (const child of Array.from(node.childNodes)) {
    walk(child, profile, here, state)
  }
}

/** Every violation in the untrusted subtree rooted at `root` (empty = pass). */
export function findRendererMarkupViolations(
  root: OracleNode,
  profile: MarkupOracleProfile,
): MarkupOracleViolation[] {
  const state: WalkState = { violations: [], unsafeCssStyles: [] }
  walk(root, profile, "", state)
  if (profile.kind === "diff") {
    const allowed = RENDERER_MARKUP_PROFILES.diff.allowedStyleElements
    if (state.unsafeCssStyles.length !== allowed) {
      state.violations.push({
        rule: "diff-unsafe-css-count",
        path: "",
        detail: `expected ${allowed}, found ${state.unsafeCssStyles.length}`,
      })
    }
    for (const style of state.unsafeCssStyles) {
      const badChild = Array.from(style.childNodes).find(
        (child) =>
          child.nodeType !== TEXT_NODE &&
          !(isElement(child) && child.localName.toLowerCase() === "br"),
      )
      if (badChild) {
        state.violations.push({
          rule: "diff-unsafe-css-child",
          path: "style[data-unsafe-css]",
          detail: "non-Text/br child",
        })
      }
      if ((style.textContent ?? "") !== profile.expectedUnsafeCssTextContent) {
        state.violations.push({
          rule: "diff-unsafe-css-drift",
          path: "style[data-unsafe-css]",
          detail: "text differs from the app-owned constant",
        })
      }
    }
  }
  return state.violations
}
