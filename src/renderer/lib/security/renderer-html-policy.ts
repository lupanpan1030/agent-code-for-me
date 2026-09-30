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
 * - `RENDERER_MARKUP_PROFILES` defines the rendered-DOM oracle profiles that
 *   the shared test helper `tests/helpers/renderer-executable-markup-oracle.ts`
 *   implements.
 *
 * This is deliberately not a generic `sanitize(anything)` helper: a new raw
 * sink needs an explicit inventory entry, a named producer and a behavior
 * gate. A TypeScript brand is not a security boundary on its own; the source
 * guard and the rendered-DOM behavior suites remain the enforcement backstop.
 *
 * Mermaid SVG keeps its specialized adapter in `mermaid-svg-sanitizer.ts`.
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
})

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
 * Reviewed `rehype-harden` options. No custom protocol is admitted
 * (`allowedProtocols` is empty instead of Streamdown's `["*"]`) and data
 * images are refused. In rehype-harden 1.1.7 the `"*"` link/image prefix
 * admits only absolute `http:`/`https:` URLs; specific prefixes are
 * origin-bound and would block every chat link. The sanitizer schema above
 * has already removed every other scheme and every relative URL, so harden is
 * defense in depth, not the load-bearing URL policy.
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
