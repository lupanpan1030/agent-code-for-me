/**
 * Canonical owner for Locus-produced raw renderer markup
 * (openspec change `add-renderer-untrusted-content-hardening`, design D1-D3).
 *
 * Every value-bearing raw-markup insertion in `src/renderer` is listed in the
 * exact inventory owned by `tests/renderer-html-sinks.test.ts` and accepts
 * output only from a named reviewed producer. This module is that producer
 * contract:
 *
 * - `ReviewedRendererHtml` is an opaque value. Only the narrow construction
 *   adapters below can create one, and `reviewedInnerHtml()` is the only way
 *   to hand it to a React raw-markup sink. A forged value renders nothing.
 * - `reviewedEscapedText()` is the single HTML text-escaping policy.
 * - `reviewShikiCodeToHtmlOutput()` is the Shiki adapter used only by
 *   `highlightCode()` (design D3): it accepts exactly one top-level
 *   `<pre><code>` wrapper with the complete output consumed, re-serializes the
 *   inner span/text grammar under a reviewed class/style value profile, and
 *   fails closed to escaped source text.
 * - `reviewedPlainCodeToHtml()` is the Q9 diff-shim adapter for the Shiki-API
 *   `codeToHtml` export (exported for `@pierre/diffs`, unused by its render
 *   path).
 * - `REVIEWED_MARKDOWN_REHYPE_PLUGINS` is the explicit replace-not-merge
 *   Streamdown chain `[rehypeRaw, [rehypeSanitize, schema], [harden, options]]`
 *   (design D2). The schema derives from `rehype-sanitize`'s `defaultSchema`
 *   and is the load-bearing markdown URL/element policy.
 * - `reviewMermaidPaintCss()`, `reviewMermaidInlineStyle()` and
 *   `reviewMermaidAttributeCss()` are the reviewed CSS value profiles the
 *   Mermaid adapter enforces on returned SVG (design D3): one scoped paint
 *   `<style>`, reviewed `style` attributes, same-SVG `url(#id)` only.
 *   `applyMermaidSvgProfile()` is the one profile walk (the adapter strips
 *   with it) and `reviewMermaidSvgOutput()` is the Mermaid sink adapter: it
 *   re-checks the adapter's string in the sink's HTML parse and seals it.
 * - `RENDERER_MARKUP_PROFILES` defines the rendered-DOM oracle profiles
 *   (markdown, highlighted code, diff, Mermaid, editor) that the shared test
 *   helper `tests/helpers/renderer-executable-markup-oracle.ts` implements.
 *
 * This is deliberately not a generic `sanitize(anything)` helper: a new raw
 * sink needs an explicit inventory entry, a named producer and a behavior
 * gate. A TypeScript brand is not a security boundary on its own; the source
 * guard and the rendered-DOM behavior suites remain the enforcement backstop.
 *
 * Mermaid SVG keeps its specialized adapter in `mermaid-svg-sanitizer.ts`
 * (DOMPurify load-bearing, DOMParser pass as defense in depth); this module
 * owns the CSS value profiles and the profile walk that adapter applies, and
 * seals its output for the two Mermaid sinks.
 */
import { harden } from "rehype-harden"
import rehypeRaw from "rehype-raw"
import rehypeSanitize, {
  defaultSchema,
  type Options as SanitizeSchema,
} from "rehype-sanitize"
import type { StreamdownProps } from "streamdown"

// ============================================================================
// Opaque reviewed-output contract
// ============================================================================

declare const reviewedRendererHtmlBrand: unique symbol

/**
 * Reviewed markup produced by one of this module's construction adapters.
 * The value is opaque: callers can store and compare it, but can only insert
 * it through `reviewedInnerHtml()`.
 */
export interface ReviewedRendererHtml {
  readonly [reviewedRendererHtmlBrand]: "ReviewedRendererHtml"
}

const reviewedMarkup = new WeakMap<ReviewedRendererHtml, string>()

function sealReviewedMarkup(markup: string): ReviewedRendererHtml {
  const token = Object.freeze({}) as ReviewedRendererHtml
  reviewedMarkup.set(token, markup)
  return token
}

/**
 * The only adapter from reviewed output to a React raw-markup sink. A value
 * that was not produced by this module renders nothing (fail closed).
 */
export function reviewedInnerHtml(html: ReviewedRendererHtml): {
  __html: string
} {
  return { __html: reviewedMarkup.get(html) ?? "" }
}

// ============================================================================
// Text escaping (single policy)
// ============================================================================

const HTML_TEXT_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})

function escapeHtmlText(text: string): string {
  return text.replace(/[&<>"']/g, (character) => HTML_TEXT_ESCAPES[character])
}

/** Untrusted text as inert reviewed markup (text only, never elements). */
export function reviewedEscapedText(text: string): ReviewedRendererHtml {
  return sealReviewedMarkup(escapeHtmlText(text))
}

/**
 * Q9 diff-shim adapter for the Shiki-API `codeToHtml(code)` export: plain
 * escaped code in the Shiki wrapper shape. Returns a string because that is
 * the Shiki API contract `@pierre/diffs` imports; its render path does not
 * call it.
 */
export function reviewedPlainCodeToHtml(code: string): string {
  return `<pre><code>${escapeHtmlText(code)}</code></pre>`
}

// ============================================================================
// Shiki `codeToHtml` output adapter (design D3)
// ============================================================================

const SHIKI_OUTPUT_OPENING = /^<pre\b[^<>]*><code\b[^<>]*>/
const SHIKI_OUTPUT_CLOSING = "</code></pre>"
const SHIKI_SPAN_OPEN = /<span((?:[ \t\n]+[a-z-]+="[^"<>]*")*)[ \t\n]*>/y
const SHIKI_SPAN_CLOSE = "</span>"
const SHIKI_SPAN_ATTRIBUTE = /([a-z-]+)="([^"<>]*)"/g
const SHIKI_MAX_SPAN_DEPTH = 16
const SHIKI_REVIEWED_CLASS_TOKENS = new Set(["line"])

const SHIKI_COLOR_VALUE = /^#[0-9a-fA-F]{3,8}$/
const SHIKI_REVIEWED_STYLE_VALUES: Readonly<Record<string, RegExp>> =
  Object.freeze({
    color: SHIKI_COLOR_VALUE,
    "background-color": SHIKI_COLOR_VALUE,
    "font-style": /^(?:italic|normal|oblique)$/,
    "font-weight": /^(?:bold|bolder|lighter|normal|[1-9]00)$/,
    "text-decoration":
      /^(?:none|underline|line-through|overline)(?: (?:underline|line-through|overline))*$/,
  })

/**
 * Reviewed value profile for generated Shiki span styles: only the
 * enumerated token-colour/font properties with literal values survive; remote
 * CSS URLs, overlay/positioning and every other declaration are stripped.
 */
function reviewShikiStyle(style: string): string {
  const declarations: string[] = []
  for (const rawDeclaration of style.split(";")) {
    const separator = rawDeclaration.indexOf(":")
    if (separator < 0) continue
    const property = rawDeclaration.slice(0, separator).trim().toLowerCase()
    const value = rawDeclaration.slice(separator + 1).trim()
    const allowed = Object.hasOwn(SHIKI_REVIEWED_STYLE_VALUES, property)
      ? SHIKI_REVIEWED_STYLE_VALUES[property]
      : undefined
    if (allowed?.test(value)) {
      declarations.push(`${property}:${value}`)
    }
  }
  return declarations.join(";")
}

function reviewShikiSpanAttributes(rawAttributes: string): string {
  let classTokens: string[] | null = null
  let style: string | null = null
  for (const match of rawAttributes.matchAll(SHIKI_SPAN_ATTRIBUTE)) {
    const [, name, value] = match
    if (name === "class" && classTokens === null) {
      classTokens = value
        .split(/\s+/)
        .filter((token) => SHIKI_REVIEWED_CLASS_TOKENS.has(token))
    } else if (name === "style" && style === null) {
      style = reviewShikiStyle(value)
    }
    // Every other attribute is unreviewed and stripped.
  }
  let reviewed = ""
  if (classTokens && classTokens.length > 0) {
    reviewed += ` class="${classTokens.join(" ")}"`
  }
  if (style) {
    reviewed += ` style="${style}"`
  }
  return reviewed
}

/**
 * Re-serializes the inner `<code>` markup under the reviewed grammar:
 * text runs (no `<`) and balanced `<span>` elements with reviewed
 * attributes. Any other construct, including a nested or second
 * `<code>`/`<pre>`, is an output-shape failure.
 */
function reviewShikiInnerMarkup(inner: string): string | null {
  let reviewed = ""
  let depth = 0
  let index = 0
  while (index < inner.length) {
    const tagStart = inner.indexOf("<", index)
    if (tagStart < 0) {
      reviewed += inner.slice(index)
      break
    }
    reviewed += inner.slice(index, tagStart)
    if (inner.startsWith(SHIKI_SPAN_CLOSE, tagStart)) {
      if (depth === 0) return null
      depth -= 1
      reviewed += SHIKI_SPAN_CLOSE
      index = tagStart + SHIKI_SPAN_CLOSE.length
      continue
    }
    SHIKI_SPAN_OPEN.lastIndex = tagStart
    const open = SHIKI_SPAN_OPEN.exec(inner)
    if (!open) return null
    depth += 1
    if (depth > SHIKI_MAX_SPAN_DEPTH) return null
    reviewed += `<span${reviewShikiSpanAttributes(open[1])}>`
    index = SHIKI_SPAN_OPEN.lastIndex
  }
  return depth === 0 ? reviewed : null
}

export type ShikiOutputReview =
  | { accepted: true; html: ReviewedRendererHtml }
  | {
      accepted: false
      html: ReviewedRendererHtml
      reason: "missing-wrapper" | "trailing-output" | "inner-shape"
    }

/**
 * Shiki adapter for `highlightCode()` only. Positive shape validation:
 * exactly one top-level `<pre><code>` wrapper whose closing tags end the
 * output, and inner markup fully consumed by the reviewed span/text grammar.
 * Every failure degrades to the escaped source text, never to raw source or
 * a truncated generator result.
 */
export function reviewShikiCodeToHtmlOutput(
  generatedHtml: string,
  source: string,
): ShikiOutputReview {
  const opening = SHIKI_OUTPUT_OPENING.exec(generatedHtml)
  if (!opening) {
    return {
      accepted: false,
      html: reviewedEscapedText(source),
      reason: "missing-wrapper",
    }
  }
  if (!generatedHtml.endsWith(SHIKI_OUTPUT_CLOSING)) {
    return {
      accepted: false,
      html: reviewedEscapedText(source),
      reason: "trailing-output",
    }
  }
  const inner = generatedHtml.slice(
    opening[0].length,
    generatedHtml.length - SHIKI_OUTPUT_CLOSING.length,
  )
  const reviewed = reviewShikiInnerMarkup(inner)
  if (reviewed === null) {
    return {
      accepted: false,
      html: reviewedEscapedText(source),
      reason: "inner-shape",
    }
  }
  return { accepted: true, html: sealReviewedMarkup(reviewed) }
}

// ============================================================================
// Mermaid CSS value profile (design D3)
// ============================================================================

/**
 * Diagram ids the Mermaid adapter can scope paint CSS to. Mermaid ids are
 * app-generated (`mermaid-<time>-<random>`); anything else fails closed.
 */
const MERMAID_DIAGRAM_ID = /^[a-z][a-z0-9_-]*$/i

/**
 * Constructs that make CSS fetch, execute or escape: every URL-bearing
 * function and `@import` (remote or unvalidated references), legacy script
 * hooks, and markup delimiters. Matched against lower-cased CSS text.
 */
const MERMAID_CSS_FORBIDDEN_PATTERNS: readonly RegExp[] = Object.freeze([
  /</,
  /@import/,
  /expression\s*\(/,
  /behavior\s*:/,
  /-moz-binding/,
  /javascript:/,
  /vbscript:/,
  /(?:^|[^a-z0-9_-])(?:url|image|image-set|-webkit-image-set|cross-fade|-webkit-cross-fade|element|-moz-element|src|paint)\s*\(/,
])

/**
 * Mermaid-generated CSS (stylis-minified) carries no comments or escapes.
 * Both are rejected, so the reviewed text is exactly what the browser parses.
 */
const MERMAID_CSS_OPAQUE_SYNTAX = /\\|\/\*|\*\//

/** A CSS `url(#fragment)` reference (lower-cased text). */
const MERMAID_CSS_FRAGMENT_URL = /url\(\s*(["']?)#([a-z0-9_.:-]+)\1\s*\)/g

const MERMAID_KEYFRAMES_PRELUDE =
  /^@(?:-webkit-)?keyframes\s+[a-z_-][a-z0-9_-]*$/
const MERMAID_KEYFRAME_SELECTOR = /^(?:from|to|\d+(?:\.\d+)?%)$/
/** What may follow `#<diagram id>` in a scoped selector (never `~`/`+`). */
const MERMAID_SCOPE_CONTINUATION = /^(?:$|[ .:[>#])/
/** Selector remainders treated as targeting the diagram root itself. */
const MERMAID_ROOT_LEVEL_REMAINDERS: ReadonlySet<string> = new Set([
  "",
  " svg",
  " :root",
  " *",
  ">*",
  " html",
  " body",
])
/**
 * `position` keywords admitted per rule scope; anything else fails. A
 * `@keyframes` frame is not bound to a selector, and an animation may target
 * the diagram root, so frame bodies get the root profile.
 */
const MERMAID_POSITION_VALUES = Object.freeze({
  descendant: Object.freeze(["static", "relative", "absolute", "sticky"]),
  root: Object.freeze(["static", "relative"]),
  keyframe: Object.freeze(["static", "relative"]),
  inline: Object.freeze(["static", "relative"]),
})

type CssBlock = { prelude: string; body: string }

/** Quote/paren-aware split of CSS text at `separator` (top level only). */
function splitCssTopLevel(text: string, separator: string): string[] {
  const parts: string[] = []
  let current = ""
  let depth = 0
  let quote: string | null = null
  for (const character of text) {
    if (quote) {
      current += character
      if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
    } else if (character === "(" || character === "[") {
      depth += 1
    } else if (character === ")" || character === "]") {
      depth -= 1
    } else if (character === separator && depth === 0) {
      parts.push(current)
      current = ""
      continue
    }
    current += character
  }
  parts.push(current)
  return parts
}

/**
 * Splits CSS into top-level `prelude { body }` blocks plus stray statement
 * text, or returns null when braces or quotes are unbalanced.
 */
function splitCssBlocks(
  css: string,
): { blocks: CssBlock[]; stray: string } | null {
  const blocks: CssBlock[] = []
  let stray = ""
  let prelude = ""
  let body = ""
  let depth = 0
  let quote: string | null = null
  for (const character of css) {
    if (quote) {
      if (depth === 0) prelude += character
      else body += character
      if (character === quote) quote = null
      continue
    }
    if (character === "{") {
      if (depth > 0) body += character
      depth += 1
      continue
    }
    if (character === "}") {
      depth -= 1
      if (depth < 0) return null
      if (depth === 0) {
        blocks.push({ prelude: prelude.trim(), body })
        prelude = ""
        body = ""
      } else {
        body += character
      }
      continue
    }
    if (character === '"' || character === "'") quote = character
    if (depth > 0) {
      body += character
    } else if (character === ";") {
      stray += prelude
      prelude = ""
    } else {
      prelude += character
    }
  }
  if (depth !== 0 || quote) return null
  return { blocks, stray: `${stray}${prelude}`.trim() }
}

/** `[property, value]` pairs (value without `!important`), lower-cased input. */
function cssDeclarations(body: string): Array<[string, string]> {
  return splitCssTopLevel(body, ";").flatMap(
    (declaration): Array<[string, string]> => {
      if (declaration.trim() === "") return []
      const separator = declaration.indexOf(":")
      if (separator < 0) return [["", declaration.trim()]]
      return [
        [
          declaration.slice(0, separator).trim(),
          declaration
            .slice(separator + 1)
            .replace(/!\s*important\s*$/, "")
            .trim(),
        ],
      ]
    },
  )
}

/** "root" | "descendant", or the reason the selector is not scoped. */
function mermaidSelectorScope(selector: string, scope: string): string {
  if (!selector.startsWith(scope)) return "selector not scoped to the diagram"
  const remainder = selector.slice(scope.length)
  if (!MERMAID_SCOPE_CONTINUATION.test(remainder)) {
    return "selector escapes the diagram id namespace"
  }
  let depth = 0
  let index = 0
  for (; index < remainder.length; index += 1) {
    const character = remainder.charAt(index)
    if (character === "(" || character === "[") depth += 1
    else if (character === ")" || character === "]") depth -= 1
    else if (depth === 0 && /[\s>~+]/.test(character)) break
  }
  const combinator = remainder.slice(index).trimStart()
  if (combinator.startsWith("~") || combinator.startsWith("+")) {
    return "sibling combinator escapes the diagram"
  }
  return combinator === "" || MERMAID_ROOT_LEVEL_REMAINDERS.has(remainder)
    ? "root"
    : "descendant"
}

function positionViolations(
  body: string,
  admitted: readonly string[],
  where: string,
): string[] {
  return cssDeclarations(body)
    .filter(
      ([property, value]) =>
        property === "position" && !admitted.includes(value),
    )
    .map(([, value]) => `position:${value} not admitted (${where})`)
}

/**
 * Reviewed CSS value profile for the single retained Mermaid paint `<style>`
 * (design D3). Returns every violation; an empty list means the text may be
 * retained. Every selector is scoped to `#<diagramId>` (a descendant or the
 * root itself, never a sibling); only `@keyframes` at-rules are admitted; no
 * URL-bearing function, `@import`, `expression(`, `behavior:` or other
 * external reference; `position:fixed` in no rule and no keyframe frame, and
 * `position:absolute`/`sticky` neither at root level nor in a keyframe frame.
 * Attacker `classDef`/`style` diagram statements also reach this
 * text (the `secure` directive list cannot suppress diagram syntax), so this
 * profile is their control too.
 */
export function reviewMermaidPaintCss(
  css: string,
  diagramId: string,
): string[] {
  if (!MERMAID_DIAGRAM_ID.test(diagramId)) {
    return ["diagram id outside the reviewed grammar"]
  }
  if (MERMAID_CSS_OPAQUE_SYNTAX.test(css)) {
    return ["comment or escape in paint CSS"]
  }
  const scope = `#${diagramId.toLowerCase()}`
  // Same-diagram paint references (for example a theme gradient) are the only
  // admitted `url()`: exactly `url(#<id>)`, `url(#<id>-…)` or `url(#<id>_…)`.
  const text = css
    .toLowerCase()
    .replace(MERMAID_CSS_FRAGMENT_URL, (reference, _quote, fragment: string) =>
      fragment === scope.slice(1) ||
      fragment.startsWith(`${scope.slice(1)}-`) ||
      fragment.startsWith(`${scope.slice(1)}_`)
        ? "fragment-ref"
        : reference,
    )
  const violations = MERMAID_CSS_FORBIDDEN_PATTERNS.filter((pattern) =>
    pattern.test(text),
  ).map((pattern) => `forbidden construct ${pattern.source}`)
  const parsed = splitCssBlocks(text)
  if (!parsed) return [...violations, "unbalanced paint CSS"]
  if (parsed.stray.length > 0) {
    violations.push("statement outside a scoped rule")
  }
  for (const { prelude, body } of parsed.blocks) {
    const where = prelude.slice(0, 60)
    if (prelude.startsWith("@")) {
      const frames = MERMAID_KEYFRAMES_PRELUDE.test(prelude)
        ? splitCssBlocks(body)
        : null
      if (!frames || frames.stray.length > 0) {
        violations.push(`at-rule not admitted (${where})`)
        continue
      }
      for (const frame of frames.blocks) {
        const selectors = splitCssTopLevel(frame.prelude, ",")
        if (
          frame.body.includes("{") ||
          !selectors.every((selector) =>
            MERMAID_KEYFRAME_SELECTOR.test(selector.trim()),
          )
        ) {
          violations.push(`keyframe not admitted (${frame.prelude})`)
          continue
        }
        violations.push(
          ...positionViolations(
            frame.body,
            MERMAID_POSITION_VALUES.keyframe,
            `${where} ${frame.prelude}`,
          ),
        )
      }
      continue
    }
    if (body.includes("{")) {
      violations.push(`nested rule not admitted (${where})`)
      continue
    }
    let rootLevel = false
    for (const selector of splitCssTopLevel(prelude, ",")) {
      const verdict = mermaidSelectorScope(selector.trim(), scope)
      if (verdict === "root") rootLevel = true
      else if (verdict !== "descendant") {
        violations.push(`${verdict} (${selector.trim().slice(0, 60)})`)
      }
    }
    violations.push(
      ...positionViolations(
        body,
        rootLevel
          ? MERMAID_POSITION_VALUES.root
          : MERMAID_POSITION_VALUES.descendant,
        where,
      ),
    )
  }
  return violations
}

/**
 * Reviewed value profile for a CSS-bearing `style` attribute in returned
 * Mermaid SVG. Unreviewed declarations are stripped: any URL-bearing or
 * scripting construct, comments/escapes, and `position` other than
 * static/relative. Returns the surviving declarations, or null when the
 * attribute must be removed.
 */
export function reviewMermaidInlineStyle(style: string): string | null {
  const kept = splitCssTopLevel(style, ";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => {
      if (declaration === "" || MERMAID_CSS_OPAQUE_SYNTAX.test(declaration)) {
        return false
      }
      const text = declaration.toLowerCase()
      if (
        MERMAID_CSS_FORBIDDEN_PATTERNS.some((pattern) => pattern.test(text))
      ) {
        return false
      }
      const [entry] = cssDeclarations(text)
      if (!entry || entry[0] === "") return false
      return (
        entry[0] !== "position" ||
        MERMAID_POSITION_VALUES.inline.includes(entry[1])
      )
    })
  return kept.length > 0 ? kept.join(";") : null
}

const MERMAID_FRAGMENT_REFERENCE = /^url\(\s*(["']?)#([a-z0-9_.:-]+)\1\s*\)$/i

/**
 * Review of any other attribute value in returned Mermaid SVG (`fill`,
 * `filter`, `marker-end`, ...). `plain`: no CSS function or scripting
 * construct. `fragment`: exactly one same-document `url(#id)` reference, which
 * the caller must verify names an element of the same SVG. `unsafe`: strip.
 */
export function reviewMermaidAttributeCss(
  value: string,
): { kind: "plain" } | { kind: "fragment"; id: string } | { kind: "unsafe" } {
  const text = value.toLowerCase()
  if (
    !MERMAID_CSS_OPAQUE_SYNTAX.test(value) &&
    !MERMAID_CSS_FORBIDDEN_PATTERNS.some((pattern) => pattern.test(text))
  ) {
    return { kind: "plain" }
  }
  const fragment = MERMAID_FRAGMENT_REFERENCE.exec(value.trim())
  return fragment ? { kind: "fragment", id: fragment[2] } : { kind: "unsafe" }
}

// ============================================================================
// Rendered-DOM oracle profiles (design D2)
// ============================================================================

/**
 * Profiles for the shared rendered-DOM executable-markup oracle. The owner
 * defines them; `tests/helpers/renderer-executable-markup-oracle.ts`
 * implements the walk. The markdown sanitizer schema below derives its URL
 * rules from the same scheme lists.
 */
export const RENDERER_MARKUP_PROFILES = Object.freeze({
  forbiddenElements: Object.freeze([
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
  ]),
  forbiddenElementPrefixes: Object.freeze(["animate"]),
  urlAttributes: Object.freeze([
    "href",
    "src",
    "xlink:href",
    "action",
    "formaction",
    "poster",
    "data",
  ]),
  /** Chat/repository/MCP/tool markdown through the Streamdown wrapper. */
  markdown: Object.freeze({
    linkSchemes: Object.freeze(["http:", "https:", "mailto:"]),
    mediaSchemes: Object.freeze(["http:", "https:"]),
    /** No trusted base: relative URLs would inherit the privileged document. */
    relativeUrlBase: null,
    allowFragmentUrls: false,
    allowedStyleElements: 0,
  }),
  /** Reviewed `highlightCode()` output at the four inventoried sinks. */
  highlightedCode: Object.freeze({
    linkSchemes: Object.freeze([]),
    mediaSchemes: Object.freeze([]),
    relativeUrlBase: null,
    allowFragmentUrls: false,
    allowedStyleElements: 0,
    spanStyleProperties: Object.freeze(
      Object.keys(SHIKI_REVIEWED_STYLE_VALUES),
    ),
  }),
  /**
   * `<FileDiff>`/`<PatchDiff>` through the Q9 shim path: exactly one
   * `style[data-unsafe-css]` equal to the app-owned constant and `use[href]`
   * fragment icons only inside separator/expand-button subtrees.
   */
  diff: Object.freeze({
    linkSchemes: Object.freeze(["http:", "https:", "mailto:"]),
    mediaSchemes: Object.freeze(["http:", "https:"]),
    relativeUrlBase: null,
    allowFragmentUrls: false,
    allowedStyleElements: 1,
    unsafeCssStyleAttribute: "data-unsafe-css",
    useHrefPattern: /^#diffs-icon-[a-z0-9-]+$/,
    useHrefAncestorAttributes: Object.freeze([
      "data-separator",
      "data-expand-button",
    ]),
  }),
  /**
   * Returned Mermaid SVG from the specialized adapter
   * `mermaid-svg-sanitizer.ts#sanitizeMermaidSvg` (design D3), at both the
   * inline and fullscreen sinks. No navigable URL: URL attributes and CSS
   * `url()` values are admitted only as fragment references to an element of
   * the same SVG. At most one `<style>`: the Mermaid-generated paint element,
   * a direct child of the diagram root, passing `reviewMermaidPaintCss`.
   * `style` attributes pass `reviewMermaidInlineStyle`.
   */
  mermaid: Object.freeze({
    linkSchemes: Object.freeze([]),
    mediaSchemes: Object.freeze([]),
    relativeUrlBase: null,
    allowFragmentUrls: true,
    allowedStyleElements: 1,
  }),
  /**
   * The mentions editor's contentEditable root (design D4): only Text nodes,
   * `br`, and atomic mention spans built by the editor's safe builder.
   */
  editor: Object.freeze({
    linkSchemes: Object.freeze([]),
    mediaSchemes: Object.freeze([]),
    relativeUrlBase: null,
    allowFragmentUrls: false,
    allowedStyleElements: 0,
    rootChildElements: Object.freeze(["br"]),
    mentionElement: Object.freeze({
      localName: "span",
      idAttribute: "data-mention-id",
      contentEditable: "false",
    }),
  }),
})

// ============================================================================
// Mermaid SVG profile walk and sink adapter (design D1/D3)
// ============================================================================

const DOM_ELEMENT_NODE = 1
const DOM_TEXT_NODE = 3

function mermaidLocalName(element: Element): string {
  return (element.localName || "").toLowerCase()
}

function mermaidSubtree(root: Element): Element[] {
  return [root, ...Array.from(root.getElementsByTagName("*"))]
}

function isForbiddenMermaidElement(element: Element): boolean {
  const name = mermaidLocalName(element)
  const forbidden: readonly string[] =
    RENDERER_MARKUP_PROFILES.forbiddenElements
  return (
    forbidden.includes(name) ||
    RENDERER_MARKUP_PROFILES.forbiddenElementPrefixes.some((prefix) =>
      name.startsWith(prefix),
    )
  )
}

function isAttributeSpacingOrControlCharacter(char: string): boolean {
  const code = char.charCodeAt(0)
  return code <= 0x1f || code === 0x7f || /\s/.test(char)
}

/**
 * Event handlers, navigable references and `javascript:` values in Mermaid
 * SVG. Used by the adapter's DOMPurify hook and by the profile walk.
 */
export function isUnsafeMermaidSvgAttribute(
  attrName: string,
  attrValue: string,
): boolean {
  const name = attrName.toLowerCase()
  const normalizedValue = Array.from(attrValue)
    .filter((char) => !isAttributeSpacingOrControlCharacter(char))
    .join("")
    .toLowerCase()
  return (
    name.startsWith("on") ||
    name === "href" ||
    name === "xlink:href" ||
    normalizedValue.startsWith("javascript:")
  )
}

export type MermaidSvgProfileMode = "strip" | "verify"

/**
 * The Mermaid SVG profile over one diagram root: no forbidden element; at
 * most the single Mermaid-generated paint `<style>` (the root's first
 * `<style>` child), text only and passing `reviewMermaidPaintCss`; `style`
 * attributes exactly their `reviewMermaidInlineStyle` value; other
 * CSS-bearing values only as `url(#id)` references to an element of this
 * SVG; no unsafe attribute. In `strip` mode (the specialized adapter
 * `mermaid-svg-sanitizer.ts`) every violation is removed or reduced, never
 * adding markup; in `verify` mode (the sink adapter below) nothing changes.
 * Both modes return every violation found.
 */
export function applyMermaidSvgProfile(
  root: Element,
  mode: MermaidSvgProfileMode,
): string[] {
  const strip = mode === "strip"
  const violations: string[] = []
  for (const element of mermaidSubtree(root)) {
    if (element !== root && isForbiddenMermaidElement(element)) {
      violations.push(`forbidden element <${mermaidLocalName(element)}>`)
      if (strip) element.remove()
    }
  }

  const paint =
    Array.from(root.children).find(
      (child) => mermaidLocalName(child) === "style",
    ) ?? null
  for (const style of Array.from(root.getElementsByTagName("style"))) {
    if (style !== paint) {
      violations.push("<style> outside the paint slot")
      if (strip) style.remove()
    }
  }
  if (paint) {
    const reasons = Array.from(paint.childNodes).some(
      (node) => node.nodeType !== DOM_TEXT_NODE,
    )
      ? ["paint <style> with non-text children"]
      : reviewMermaidPaintCss(
          paint.textContent ?? "",
          root.getAttribute("id") ?? "",
        )
    if (reasons.length > 0) {
      violations.push(...reasons)
      if (strip) paint.remove()
    }
  }

  const ids = new Set(
    mermaidSubtree(root)
      .map((element) => element.getAttribute("id"))
      .filter((id): id is string => Boolean(id)),
  )
  for (const element of mermaidSubtree(root)) {
    for (const { name, value } of Array.from(element.attributes)) {
      if (isUnsafeMermaidSvgAttribute(name, value)) {
        violations.push(`unsafe attribute ${name}`)
        if (strip) element.removeAttribute(name)
        continue
      }
      if (name.toLowerCase() === "style") {
        const reviewed = reviewMermaidInlineStyle(value)
        if (reviewed === value) continue
        violations.push("unreviewed style declarations")
        if (!strip) continue
        if (reviewed === null) element.removeAttribute(name)
        else element.setAttribute(name, reviewed)
        continue
      }
      const verdict = reviewMermaidAttributeCss(value)
      if (
        verdict.kind === "unsafe" ||
        (verdict.kind === "fragment" && !ids.has(verdict.id))
      ) {
        violations.push(`unreviewed CSS value in ${name}`)
        if (strip) element.removeAttribute(name)
      }
    }
  }
  return violations
}

/**
 * Sink adapter for the specialized Mermaid adapter's output (design D1,
 * Invariant 1): `sanitizeMermaidSvg()` keeps returning a string, and both
 * Mermaid raw sinks accept only the `ReviewedRendererHtml` sealed here. The
 * string is parsed exactly as the sink will parse it (HTML parser, inert
 * document), must be one top-level `<svg>` and must pass the Mermaid SVG
 * profile unchanged (`verify` mode), so a parse that differs from the
 * adapter's tree also fails closed. Returns null otherwise.
 */
export function reviewMermaidSvgOutput(
  svg: string,
): ReviewedRendererHtml | null {
  if (svg.trim() === "" || typeof window === "undefined") return null
  const parsed = new window.DOMParser().parseFromString(svg, "text/html")
  if (parsed.head.childNodes.length > 0) return null
  let root: Element | null = null
  for (const node of Array.from(parsed.body.childNodes)) {
    if (
      root === null &&
      node.nodeType === DOM_ELEMENT_NODE &&
      mermaidLocalName(node as Element) === "svg"
    ) {
      root = node as Element
      continue
    }
    if (
      node.nodeType === DOM_TEXT_NODE &&
      (node.textContent ?? "").trim() === ""
    ) {
      continue
    }
    return null
  }
  if (!root || applyMermaidSvgProfile(root, "verify").length > 0) return null
  return sealReviewedMarkup(svg)
}

// ============================================================================
// Markdown: explicit replace-not-merge Streamdown rehype chain (design D2)
// ============================================================================

type PropertyDefinition = NonNullable<
  NonNullable<SanitizeSchema["attributes"]>[string]
>[number]

function definitionName(definition: PropertyDefinition): string {
  return typeof definition === "string" ? definition : definition[0]
}

function withoutProperties(
  definitions: readonly PropertyDefinition[] | undefined,
  names: readonly string[],
): PropertyDefinition[] {
  return (definitions ?? []).filter(
    (definition) => !names.includes(definitionName(definition)),
  )
}

function schemeNames(schemes: readonly string[]): string[] {
  return schemes.map((scheme) => scheme.replace(/:$/, ""))
}

/**
 * Absolute URLs only: a relative or protocol-relative value would resolve
 * against the privileged `file:` app document, so it fails closed.
 */
const MARKDOWN_LINK_URL = /^(?:https?:\/\/|mailto:)/
const MARKDOWN_MEDIA_URL = /^https?:\/\//

function deriveReviewedMarkdownSchema(): SanitizeSchema {
  // Clone so freezing the reviewed schema never mutates the library export.
  const base = structuredClone(defaultSchema)
  const attributes = base.attributes ?? {}
  const citeAttribute: PropertyDefinition = ["cite", MARKDOWN_MEDIA_URL]
  const withCite = (tagName: string) => [
    ...withoutProperties(attributes[tagName], ["cite"]),
    citeAttribute,
  ]
  const mediaSchemes = schemeNames(
    RENDERER_MARKUP_PROFILES.markdown.mediaSchemes,
  )
  return {
    ...base,
    attributes: {
      ...attributes,
      // `action` is only meaningful on forms (not admitted); never keep a URL.
      "*": withoutProperties(attributes["*"], ["action"]),
      a: [
        ...withoutProperties(attributes.a, ["href"]),
        ["href", MARKDOWN_LINK_URL],
      ],
      img: [
        ...withoutProperties(attributes.img, ["src", "longDesc"]),
        ["src", MARKDOWN_MEDIA_URL],
      ],
      // `srcSet` is a URL list without per-candidate protocol checks.
      source: withoutProperties(attributes.source, ["srcSet"]),
      blockquote: withCite("blockquote"),
      del: withCite("del"),
      ins: withCite("ins"),
      q: withCite("q"),
    },
    protocols: {
      href: schemeNames(RENDERER_MARKUP_PROFILES.markdown.linkSchemes),
      src: mediaSchemes,
      cite: mediaSchemes,
    },
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !(value instanceof RegExp)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

/** `defaultSchema`-derived reviewed schema: the load-bearing markdown policy. */
export const REVIEWED_MARKDOWN_SANITIZE_SCHEMA: SanitizeSchema = deepFreeze(
  deriveReviewedMarkdownSchema(),
)

/**
 * Reviewed `rehype-harden` options: an empty protocol allowlist (instead of
 * Streamdown's `["*"]`), data images refused, and the `"*"` link/image
 * prefixes (a specific prefix is origin-bound in rehype-harden 1.1.7 and
 * would block every chat link). Harden's built-in safe-protocol set and its
 * relative, fragment and `blob:` handling are not relied on: the reviewed
 * sanitizer schema above runs first and alone enforces the absolute
 * `http:`/`https:` policy (plus `mailto:` for links). Harden is defense in
 * depth, not the load-bearing URL policy.
 */
export const REVIEWED_MARKDOWN_HARDEN_OPTIONS = deepFreeze({
  allowedProtocols: [] as string[],
  allowedLinkPrefixes: ["*"],
  allowedImagePrefixes: ["*"],
  allowDataImages: false,
})

type RehypePluginList = NonNullable<StreamdownProps["rehypePlugins"]>

/**
 * The explicit chain passed to both app Streamdown mounts. At pinned
 * Streamdown 2.1.0 `rehypePlugins` replaces (does not merge) the default
 * `raw -> sanitize({}) -> harden(wildcards)` chain.
 */
export const REVIEWED_MARKDOWN_REHYPE_PLUGINS: RehypePluginList = Object.freeze(
  [
    rehypeRaw,
    [rehypeSanitize, REVIEWED_MARKDOWN_SANITIZE_SCHEMA],
    [harden, REVIEWED_MARKDOWN_HARDEN_OPTIONS],
  ],
) as unknown as RehypePluginList
