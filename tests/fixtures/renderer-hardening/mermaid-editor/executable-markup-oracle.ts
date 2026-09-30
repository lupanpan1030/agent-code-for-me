/**
 * Domain-B implementation of the design D2 rendered-DOM executable-markup
 * oracle, limited to the two profiles this suite exercises: the Mermaid SVG
 * profile (with the D3 CSS value profile for the single retained paint
 * `<style>`) and the mentions-editor profile.
 *
 * design.md D2 proposes ONE shared helper at
 * `tests/helpers/renderer-executable-markup-oracle.ts`. That path is outside
 * this author's write scope, so these profiles live here and must be folded
 * into that single helper when it lands; the rules below are transcribed from
 * design D2/D3 and the runtime-security-baseline delta, not invented.
 *
 * The oracle walks the rendered DOM (namespace-aware, lower-cased local names)
 * and returns human-readable violations; an empty array means the subtree
 * passes. It never inspects source strings.
 */

const FORBIDDEN_ELEMENTS = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "frame",
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

function localNameOf(element: Element): string {
  return (element.localName || element.nodeName || "").toLowerCase()
}

function describe(element: Element): string {
  const id = element.getAttribute("id")
  return id ? `<${localNameOf(element)}#${id}>` : `<${localNameOf(element)}>`
}

function allElements(root: Element): Element[] {
  return [root, ...Array.from(root.querySelectorAll("*"))]
}

/** Strip comments, decode CSS escapes, lower-case, and tighten whitespace. */
export function normalizeCss(css: string, preserveCase = false): string {
  const decoded = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/\\(.)/g, "$1")
  return (preserveCase ? decoded : decoded.toLowerCase())
    .replace(/\s*([:;(),{}])\s*/g, "$1")
    .replace(/\s+/g, " ")
}

function urlTargets(normalizedCss: string): string[] {
  const targets: string[] = []
  const pattern = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi
  let match: RegExpExecArray | null = pattern.exec(normalizedCss)
  while (match) {
    targets.push(match[2] ?? "")
    match = pattern.exec(normalizedCss)
  }
  // An unterminated `url(` is also a reference we cannot validate.
  const opens = normalizedCss.toLowerCase().split("url(").length - 1
  if (opens !== targets.length) targets.push("<unparsed url(>")
  return targets
}

/**
 * Declaration-level value checks shared by the retained Mermaid `<style>` and
 * CSS-bearing attributes. `allowFragment` decides whether a `url(#frag)`
 * reference is a validated same-SVG fragment.
 */
function declarationViolations(
  cssText: string,
  where: string,
  allowFragment: (fragment: string) => boolean,
): string[] {
  const violations: string[] = []
  const css = normalizeCss(cssText)
  if (css.includes("@import")) violations.push(`${where}: @import`)
  if (css.includes("expression(")) violations.push(`${where}: expression(`)
  if (/(^|[;{ ])behavior:/.test(css)) violations.push(`${where}: behavior:`)
  if (css.includes("-moz-binding")) violations.push(`${where}: -moz-binding`)
  if (css.includes("javascript:")) violations.push(`${where}: javascript:`)
  if (/position:fixed/.test(css)) violations.push(`${where}: position:fixed`)
  for (const target of urlTargets(normalizeCss(cssText, true))) {
    if (!target.startsWith("#") || !allowFragment(target.slice(1))) {
      violations.push(`${where}: external or unvalidated url(${target})`)
    }
  }
  return violations
}

type CssBlock = { prelude: string; body: string }

/** Split CSS into top-level `prelude { body }` blocks plus stray text. */
function splitTopLevel(css: string): { blocks: CssBlock[]; stray: string } {
  const blocks: CssBlock[] = []
  let stray = ""
  let depth = 0
  let prelude = ""
  let body = ""
  let quote: string | null = null
  for (const char of css) {
    if (quote) {
      if (depth === 0) prelude += char
      else body += char
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      if (depth === 0) prelude += char
      else body += char
      continue
    }
    if (char === "{") {
      if (depth > 0) body += char
      depth += 1
      continue
    }
    if (char === "}") {
      depth -= 1
      if (depth === 0) {
        blocks.push({ prelude: prelude.trim(), body })
        prelude = ""
        body = ""
      } else if (depth > 0) {
        body += char
      } else {
        stray += char
        depth = 0
      }
      continue
    }
    if (depth === 0) {
      if (char === ";") {
        stray += `${prelude};`
        prelude = ""
      } else {
        prelude += char
      }
    } else {
      body += char
    }
  }
  stray += prelude
  return { blocks, stray: stray.trim() }
}

function splitSelectors(prelude: string): string[] {
  const selectors: string[] = []
  let current = ""
  let depth = 0
  for (const char of prelude) {
    if (char === "(" || char === "[") depth += 1
    if (char === ")" || char === "]") depth -= 1
    if (char === "," && depth === 0) {
      selectors.push(current.trim())
      current = ""
      continue
    }
    current += char
  }
  selectors.push(current.trim())
  return selectors.filter(Boolean)
}

const KEYFRAME_SELECTOR = /^(from|to|\d+(\.\d+)?%)$/

/**
 * D3 CSS value profile for the single retained Mermaid paint `<style>`:
 * every selector scoped to the diagram id namespace; no `url(` other than a
 * diagram-namespaced fragment, no `@import`, `expression(`, `behavior:`,
 * root-level `position:fixed`/`position:absolute` (fixed is rejected
 * anywhere), and no external reference. `@keyframes` blocks (emitted by
 * pinned Mermaid for edge animation) are admitted only with keyframe
 * selectors and value-checked declarations; any other at-rule fails.
 */
export function mermaidCssProfileViolations(
  cssText: string,
  diagramId: string,
): string[] {
  const violations: string[] = []
  const id = diagramId.toLowerCase()
  const allowFragment = (fragment: string) => {
    const lower = fragment.toLowerCase()
    return (
      lower === id || lower.startsWith(`${id}-`) || lower.startsWith(`${id}_`)
    )
  }
  violations.push(...declarationViolations(cssText, "style", allowFragment))
  const { blocks, stray } = splitTopLevel(normalizeCss(cssText))
  if (stray.replace(/;/g, "").trim().length > 0) {
    violations.push(
      `style: statement outside a scoped rule (${stray.slice(0, 80)})`,
    )
  }
  const scopePrefix = `#${id}`
  const rootRemainders = new Set([
    "",
    " svg",
    " :root",
    " *",
    ">*",
    " html",
    " body",
  ])
  for (const block of blocks) {
    if (block.prelude.startsWith("@")) {
      if (!/^@(-webkit-)?keyframes [a-z0-9_-]+$/.test(block.prelude)) {
        violations.push(
          `style: at-rule not admitted (${block.prelude.slice(0, 60)})`,
        )
        continue
      }
      for (const inner of splitTopLevel(block.body).blocks) {
        for (const selector of splitSelectors(inner.prelude)) {
          if (!KEYFRAME_SELECTOR.test(selector)) {
            violations.push(
              `style: keyframe selector not admitted (${selector})`,
            )
          }
        }
      }
      continue
    }
    for (const selector of splitSelectors(block.prelude)) {
      if (!selector.startsWith(scopePrefix)) {
        violations.push(
          `style: selector not scoped to #${diagramId} (${selector.slice(0, 60)})`,
        )
        continue
      }
      const next = selector.charAt(scopePrefix.length)
      if (next !== "" && !/[ .:[>#~+]/.test(next)) {
        violations.push(
          `style: selector escapes the diagram id namespace (${selector.slice(0, 60)})`,
        )
        continue
      }
      const remainder = selector.slice(scopePrefix.length)
      const isRootLevel =
        rootRemainders.has(remainder) || /^[.:[#][^ >~+]*$/.test(remainder)
      if (isRootLevel && /position:(fixed|absolute)/.test(block.body)) {
        violations.push(
          `style: root-level position override (${selector.slice(0, 60)})`,
        )
      }
    }
  }
  return violations
}

function fragmentExistsIn(root: Element) {
  const ids = new Set(
    allElements(root)
      .map((element) => element.getAttribute("id"))
      .filter(Boolean),
  )
  return (fragment: string) => ids.has(fragment)
}

/** Global D2 element and attribute rules, parameterised by URL policy. */
function globalElementViolations(
  element: Element,
  allowUrlAttribute: (name: string, value: string) => boolean,
  allowFragment: (fragment: string) => boolean,
): string[] {
  const violations: string[] = []
  const name = localNameOf(element)
  if (FORBIDDEN_ELEMENTS.has(name) || name.startsWith("animate")) {
    violations.push(`forbidden element ${describe(element)}`)
  }
  for (const attribute of Array.from(element.attributes)) {
    const attrName = attribute.name.toLowerCase()
    const value = attribute.value
    if (attrName.startsWith("on")) {
      violations.push(
        `event-handler attribute ${attrName} on ${describe(element)}`,
      )
    }
    if (attrName === "srcdoc") violations.push(`srcdoc on ${describe(element)}`)
    if (URL_ATTRIBUTES.has(attrName) && !allowUrlAttribute(attrName, value)) {
      violations.push(
        `URL attribute ${attrName}="${value.slice(0, 60)}" on ${describe(element)}`,
      )
    }
    if (attrName === "style") {
      violations.push(
        ...declarationViolations(
          value,
          `style attribute on ${describe(element)}`,
          allowFragment,
        ),
      )
      if (/position:(fixed|absolute)/.test(normalizeCss(value))) {
        violations.push(
          `style attribute position override on ${describe(element)}`,
        )
      }
    } else if (normalizeCss(value).includes("url(")) {
      violations.push(
        ...declarationViolations(
          value,
          `${attrName} attribute on ${describe(element)}`,
          allowFragment,
        ),
      )
    }
  }
  return violations
}

/**
 * Mermaid profile over a sanitized SVG root: global rules everywhere; URL
 * attributes only as validated same-SVG fragments; at most one `<style>`
 * element, text-only, passing the D3 CSS value profile.
 */
export function mermaidProfileViolations(svgRoot: Element): string[] {
  const violations: string[] = []
  if (localNameOf(svgRoot) !== "svg")
    violations.push(`root is ${describe(svgRoot)}, not <svg>`)
  const diagramId = svgRoot.getAttribute("id") ?? ""
  if (!diagramId) violations.push("root <svg> has no diagram id")
  const exists = fragmentExistsIn(svgRoot)
  const allowUrl = (_name: string, value: string) =>
    value.startsWith("#") && exists(value.slice(1))
  const styles: Element[] = []
  for (const element of allElements(svgRoot)) {
    violations.push(...globalElementViolations(element, allowUrl, exists))
    if (localNameOf(element) === "style") styles.push(element)
  }
  if (styles.length > 1)
    violations.push(
      `${styles.length} <style> elements; the Mermaid profile admits one`,
    )
  for (const style of styles) {
    if (Array.from(style.childNodes).some((node) => node.nodeType !== 3)) {
      violations.push("retained <style> has non-text children")
    }
    violations.push(
      ...mermaidCssProfileViolations(style.textContent ?? "", diagramId),
    )
  }
  return violations
}

/**
 * Editor profile: the contentEditable root may contain only Text nodes,
 * `<br>`, and reviewed atomic mention spans
 * (`span[data-mention-id][contenteditable="false"]`); mention internals keep
 * the global rules. No `div` wrappers, no other markup, no URL attributes.
 */
export function editorProfileViolations(editorRoot: Element): string[] {
  const violations: string[] = []
  const noUrl = () => false
  const noFragment = () => false
  for (const attribute of Array.from(editorRoot.attributes)) {
    if (attribute.name.toLowerCase().startsWith("on")) {
      violations.push(
        `event-handler attribute ${attribute.name} on editor root`,
      )
    }
  }
  for (const node of Array.from(editorRoot.childNodes)) {
    if (node.nodeType === 3) continue
    if (node.nodeType !== 1) {
      violations.push(`unexpected node type ${node.nodeType} in editor`)
      continue
    }
    const element = node as Element
    const name = localNameOf(element)
    if (name === "br") {
      violations.push(...globalElementViolations(element, noUrl, noFragment))
      if (element.childNodes.length > 0) violations.push("<br> with children")
      continue
    }
    const isMention =
      name === "span" &&
      element.hasAttribute("data-mention-id") &&
      element.getAttribute("contenteditable") === "false"
    if (!isMention) {
      violations.push(`non-reviewed element ${describe(element)} in editor`)
      continue
    }
    for (const inner of allElements(element)) {
      violations.push(...globalElementViolations(inner, noUrl, noFragment))
      const innerName = localNameOf(inner)
      if (
        innerName === "style" ||
        innerName === "div" ||
        innerName === "img" ||
        innerName === "a"
      ) {
        violations.push(`element ${describe(inner)} inside a mention`)
      }
    }
  }
  for (const element of Array.from(editorRoot.querySelectorAll("div"))) {
    violations.push(`div wrapper ${describe(element)} in editor`)
  }
  return violations
}
