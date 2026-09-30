/**
 * Shared rendered-DOM executable-markup oracle (design D2), implementing the
 * profiles defined by the reviewed renderer HTML owner
 * `src/renderer/lib/security/renderer-html-policy.ts#RENDERER_MARKUP_PROFILES`.
 *
 * It walks the actual untrusted-output subtree, including open Shadow DOM
 * descendants and namespace-aware SVG/MathML nodes, and reports every
 * violation of the global rules plus the per-profile allowances: markdown,
 * highlighted code, diff, Mermaid SVG (design D3: one paint `<style>` under
 * an independent CSS scope/value check, same-SVG fragment references only)
 * and the mentions editor (design D4: Text, `br` and reviewed mention spans).
 *
 * Not a test file (no `.test.` infix): Bun only loads it through importers.
 */
import { RENDERER_MARKUP_PROFILES } from "../../src/renderer/lib/security/renderer-html-policy"

export type MarkupOracleProfile =
  | { kind: "markdown" }
  | { kind: "highlightedCode" }
  | { kind: "diff"; expectedUnsafeCssTextContent: string }
  /** `root` holds sanitized diagram `<svg>` roots (for example a sink). */
  | { kind: "mermaid" }
  /** `root` is the mentions editor's contentEditable element. */
  | { kind: "editor" }

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
  getAttribute(name: string): string | null
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
    // Fragment existence (Mermaid: same SVG) is checked after the walk.
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
  /** Mermaid: `<style>` elements seen, and ids defined in the diagram. */
  styles: OracleElement[]
  ids: Set<string>
  fragmentReferences: Array<{ path: string; id: string }>
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
  const id = node.getAttribute("id")
  if (id) state.ids.add(id)
  if (name === "style") {
    if (
      profile.kind === "diff" &&
      node.hasAttribute(RENDERER_MARKUP_PROFILES.diff.unsafeCssStyleAttribute)
    ) {
      state.unsafeCssStyles.push(node)
    } else if (profile.kind === "mermaid") {
      state.styles.push(node)
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
    } else if (
      profile.kind === "mermaid" &&
      /url\s*\(/i.test(attribute.value)
    ) {
      // CSS-bearing presentation attribute: only `url(#id)` of this SVG.
      const fragment = /^url\(\s*(["']?)#([^"')]+)\1\s*\)$/i.exec(
        attribute.value.trim(),
      )
      if (fragment) {
        state.fragmentReferences.push({ path: here, id: fragment[2] })
      } else {
        report("mermaid-css-url", `${attributeName}=${attribute.value}`)
      }
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
      if (!verdict && profile.kind === "mermaid") {
        state.fragmentReferences.push({
          path: here,
          id: attribute.value.trim().slice(1),
        })
      }
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

function newWalkState(): WalkState {
  return {
    violations: [],
    unsafeCssStyles: [],
    styles: [],
    ids: new Set(),
    fragmentReferences: [],
  }
}

/**
 * Independent scope/value check of a retained Mermaid paint `<style>`:
 * lower-cased CSS with no comments/escapes, no fetching or scripting
 * construct, no `url()` except `url(#<id>…)`, top-level blocks that are
 * `@keyframes` or rules whose every selector starts with `#<id>` followed by
 * a descendant/child/compound continuation, no `position:fixed`, and no
 * `position:absolute` in a rule that targets the diagram root itself.
 */
function mermaidPaintViolations(css: string, diagramId: string): string[] {
  const violations: string[] = []
  if (/\\|\/\*/.test(css)) violations.push("comment or escape")
  const id = diagramId.toLowerCase()
  const text = css
    .toLowerCase()
    .replace(/url\(\s*(["']?)#([a-z0-9_.:-]+)\1\s*\)/g, (match, _q, frag) =>
      frag === id || frag.startsWith(`${id}-`) || frag.startsWith(`${id}_`)
        ? "fragment"
        : match,
    )
  for (const pattern of [
    /</,
    /@import/,
    /expression\s*\(/,
    /behavior\s*:/,
    /-moz-binding/,
    /javascript:/,
    /\b(?:url|image|image-set|cross-fade|element|src)\s*\(/,
    /position\s*:\s*fixed/,
  ]) {
    if (pattern.test(text)) violations.push(`forbidden ${pattern.source}`)
  }
  let depth = 0
  let prelude = ""
  let body = ""
  for (const character of text) {
    if (character === "{") {
      depth += 1
      if (depth > 1) body += character
      continue
    }
    if (character === "}") {
      depth -= 1
      if (depth > 0) {
        body += character
        continue
      }
      const head = prelude.trim()
      if (head.startsWith("@")) {
        if (!/^@(?:-webkit-)?keyframes\s+[a-z_-][a-z0-9_-]*$/.test(head)) {
          violations.push(`at-rule ${head.slice(0, 40)}`)
        }
      } else {
        for (const selector of head.split(",").map((item) => item.trim())) {
          const rest = selector.slice(id.length + 1)
          if (!selector.startsWith(`#${id}`) || !/^(?:$|[ .:[>#])/.test(rest)) {
            violations.push(`unscoped selector ${selector.slice(0, 40)}`)
          } else if (/^\s*[~+]/.test(rest.replace(/^[^\s>~+]*/, ""))) {
            violations.push(`sibling escape ${selector.slice(0, 40)}`)
          } else if (
            (/^[^\s>~+]*$/.test(rest) ||
              [" svg", " :root", " *", ">*", " html", " body"].includes(
                rest,
              )) &&
            /position\s*:\s*absolute/.test(body)
          ) {
            violations.push(`root position:absolute ${selector.slice(0, 40)}`)
          }
        }
      }
      prelude = ""
      body = ""
      continue
    }
    if (depth === 0) prelude += character
    else body += character
  }
  if (depth !== 0) violations.push("unbalanced braces")
  if (prelude.replace(/[;\s]/g, "") !== "") violations.push("stray statement")
  return violations
}

function mermaidRootViolations(svg: OracleElement): MarkupOracleViolation[] {
  const state = newWalkState()
  const profile: MarkupOracleProfile = { kind: "mermaid" }
  walk(svg, profile, "", state)
  const diagramId = svg.getAttribute("id") ?? ""
  if (svg.localName.toLowerCase() !== "svg" || !diagramId) {
    state.violations.push({
      rule: "mermaid-root",
      path: "",
      detail: "sink child is not an <svg> diagram root with an id",
    })
  }
  const allowed = RENDERER_MARKUP_PROFILES.mermaid.allowedStyleElements
  if (state.styles.length > allowed) {
    state.violations.push({
      rule: "mermaid-style-count",
      path: "",
      detail: `expected at most ${allowed}, found ${state.styles.length}`,
    })
  }
  for (const style of state.styles) {
    const detail = [
      style.parentNode === svg
        ? null
        : "not a direct child of the diagram root",
      Array.from(style.childNodes).every(
        (child) => child.nodeType === TEXT_NODE,
      )
        ? null
        : "non-Text child",
      ...mermaidPaintViolations(style.textContent ?? "", diagramId),
    ].filter((item): item is string => item !== null)
    for (const item of detail) {
      state.violations.push({
        rule: "mermaid-paint",
        path: "style",
        detail: item,
      })
    }
  }
  for (const reference of state.fragmentReferences) {
    if (!state.ids.has(reference.id)) {
      state.violations.push({
        rule: "mermaid-fragment",
        path: reference.path,
        detail: `#${reference.id} is not an element of this SVG`,
      })
    }
  }
  return state.violations
}

function editorViolations(editor: OracleElement): MarkupOracleViolation[] {
  const rules = RENDERER_MARKUP_PROFILES.editor
  const violations: MarkupOracleViolation[] = []
  for (const attribute of Array.from(editor.attributes)) {
    if (attribute.name.toLowerCase().startsWith("on")) {
      violations.push({
        rule: "event-handler-attribute",
        path: "",
        detail: attribute.name,
      })
    }
  }
  for (const child of Array.from(editor.childNodes)) {
    if (child.nodeType === TEXT_NODE) continue
    if (!isElement(child)) {
      violations.push({
        rule: "editor-node",
        path: "",
        detail: `node type ${child.nodeType}`,
      })
      continue
    }
    const name = child.localName.toLowerCase()
    const isMention =
      name === rules.mentionElement.localName &&
      child.hasAttribute(rules.mentionElement.idAttribute) &&
      child.getAttribute("contenteditable") ===
        rules.mentionElement.contentEditable
    const state = newWalkState()
    walk(child, { kind: "editor" }, "", state)
    violations.push(...state.violations)
    if (isMention) {
      for (const inner of descendants(child)) {
        const innerName = inner.localName.toLowerCase()
        if (["div", "img", "a", "style", "br"].includes(innerName)) {
          violations.push({
            rule: "editor-mention-content",
            path: `/${name}`,
            detail: innerName,
          })
        }
      }
    } else if (
      !(rules.rootChildElements as readonly string[]).includes(name) ||
      child.childNodes.length > 0
    ) {
      violations.push({ rule: "editor-element", path: "", detail: name })
    }
  }
  return violations
}

function descendants(element: OracleElement): OracleElement[] {
  const found: OracleElement[] = []
  const visit = (node: OracleNode) => {
    for (const child of Array.from(node.childNodes)) {
      if (isElement(child)) {
        found.push(child)
        visit(child)
      }
    }
  }
  visit(element)
  return found
}

/** Every violation in the untrusted subtree rooted at `root` (empty = pass). */
export function findRendererMarkupViolations(
  root: OracleNode,
  profile: MarkupOracleProfile,
): MarkupOracleViolation[] {
  if (profile.kind === "mermaid") {
    return Array.from(root.childNodes).flatMap((child) =>
      isElement(child)
        ? mermaidRootViolations(child)
        : (child.textContent ?? "").trim() === ""
          ? []
          : [{ rule: "mermaid-root", path: "", detail: "text outside <svg>" }],
    )
  }
  if (profile.kind === "editor") {
    return isElement(root)
      ? editorViolations(root)
      : [{ rule: "editor-root", path: "", detail: "not an element" }]
  }
  const state = newWalkState()
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
