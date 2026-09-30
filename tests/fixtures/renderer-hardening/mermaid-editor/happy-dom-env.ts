/**
 * Renderer-hardening (Domain B) happy-dom environment.
 *
 * MUST be the first import of a test file (side-effect import, never a named
 * import: Bun elides unused named imports, which would silently skip this
 * setup). It installs one happy-dom 20.10.6 Window as the renderer document and
 * applies three documented FIDELITY shims. None of them touches a sanitizer,
 * CSS profile, oracle or product policy; each one only makes happy-dom behave
 * like the Chromium renderer the production code runs in, and each one has an
 * environment self-check in the test file:
 *
 * 1. `Node.prototype.nodeName` — happy-dom defines the base getter as `return ''`
 *    and only overrides it on subclasses. DOMPurify 3.4.x resolves
 *    `lookupGetter(Node.prototype, 'nodeName')` once, so under unshimmed
 *    happy-dom every element's tag name reads as '' and DOMPurify deletes every
 *    element (e.g. `<svg><g/></svg>` -> '' in Mermaid's own sanitize pass).
 *    The shim returns the spec value by nodeType.
 * 2. HTML parser raw-text close for SVG `<style>` — happy-dom compares the
 *    upper-cased end tag with the element's stored tagName; SVG-namespace
 *    `style` keeps lower case, so `</style>` never closes it and every sibling
 *    after an SVG `<style>` is swallowed (`<svg><style>a{}</style><g/></svg>` ->
 *    `<svg></svg>`). The shim makes that single comparison case-insensitive.
 * 3. SVG geometry — happy-dom returns a 0x0 `getBBox()`, which Mermaid treats
 *    as "svg element not in render tree" and aborts. The shim returns a
 *    deterministic text-length-based box. Layout is not a security property.
 * 4. `Document#createNodeIterator` — happy-dom's NodeIterator is a thin
 *    TreeWalker wrapper without the DOM-spec "NodeIterator pre-removing
 *    steps". DOMPurify removes the iterator's current node while iterating;
 *    without those steps happy-dom walks into the detached subtree and stops,
 *    so every node after the first removal is never sanitized (observed: the
 *    second Mermaid label `<foreignObject>` survives a FORBID_TAGS rule).
 *    Chromium implements the spec. The shim is a spec NodeIterator
 *    (reference node + pointer-before flag + pre-removing steps hooked on
 *    happy-dom's single internal removeChild path).
 *
 * Resource loading and page-script evaluation are disabled: no network, no
 * inline handler execution. Assertions are made on the DOM, never on execution.
 */
import { Window } from "happy-dom"
import HTMLParserModule from "happy-dom/lib/html-parser/HTMLParser.js"
import SVGGraphicsElementModule from "happy-dom/lib/nodes/svg-graphics-element/SVGGraphicsElement.js"
import SVGTextContentElementModule from "happy-dom/lib/nodes/svg-text-content-element/SVGTextContentElement.js"
import * as PropertySymbol from "happy-dom/lib/PropertySymbol.js"

type AnyCtor = { prototype: Record<string | symbol, unknown> }

function unwrapDefault<T>(value: T): T {
  const maybe = value as unknown as { default?: T }
  return maybe.default ?? value
}

const HTMLParser = unwrapDefault(HTMLParserModule) as unknown as AnyCtor
const SVGGraphicsElement = unwrapDefault(
  SVGGraphicsElementModule,
) as unknown as AnyCtor
const SVGTextContentElement = unwrapDefault(
  SVGTextContentElementModule,
) as unknown as AnyCtor
const tagNameSymbol = (PropertySymbol as unknown as { tagName: symbol }).tagName

// Shim 2: case-insensitive raw-text end-tag match for SVG-namespace <style>.
const originalParseRawText = HTMLParser.prototype
  .parseRawTextElementContent as (
  this: { currentNode: Record<symbol, unknown> },
  tagName: string,
  text: string,
) => unknown
HTMLParser.prototype.parseRawTextElementContent = function patchedParseRawText(
  this: { currentNode: Record<symbol, unknown> },
  tagName: string,
  text: string,
) {
  const node = this.currentNode
  const stored = node?.[tagNameSymbol]
  if (
    typeof stored === "string" &&
    stored !== stored.toUpperCase() &&
    stored.toUpperCase() === tagName.toUpperCase()
  ) {
    node[tagNameSymbol] = stored.toUpperCase()
    try {
      return originalParseRawText.call(this, tagName, text)
    } finally {
      node[tagNameSymbol] = stored
    }
  }
  return originalParseRawText.call(this, tagName, text)
}

export const testWindow = new Window({
  url: "http://localhost/",
  width: 1280,
  height: 800,
  settings: {
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
    disableIframePageLoading: true,
    disableComputedStyleRendering: false,
  },
})

const w = testWindow as unknown as Record<string, unknown> & {
  Node: AnyCtor
  getComputedStyle: (...args: unknown[]) => unknown
}

// Shim 1: spec nodeName on the base Node getter (used by DOMPurify).
Object.defineProperty(w.Node.prototype, "nodeName", {
  configurable: true,
  get(this: {
    nodeType: number
    tagName?: string
    name?: string
    target?: string
  }) {
    switch (this.nodeType) {
      case 1:
        return this.tagName
      case 3:
        return "#text"
      case 4:
        return "#cdata-section"
      case 7:
        return this.target
      case 8:
        return "#comment"
      case 9:
        return "#document"
      case 10:
        return this.name
      case 11:
        return "#document-fragment"
      default:
        return ""
    }
  },
})

// Shim 3: deterministic SVG geometry for Mermaid layout.
SVGGraphicsElement.prototype.getBBox = function getBBox(this: {
  textContent: string | null
}) {
  const length = (this.textContent ?? "").length
  return { x: 0, y: 0, width: Math.max(1, length * 8), height: 16 }
}
SVGTextContentElement.prototype.getComputedTextLength =
  function getComputedTextLength(this: {
    textContent: string | null
  }) {
    return Math.max(1, (this.textContent ?? "").length * 8)
  }

// Shim 4: spec-compliant NodeIterator with pre-removing steps.
const NODE_FILTER_ACCEPT = 1
const NODE_FILTER_SKIP = 3
type DomNode = {
  nodeType: number
  firstChild: DomNode | null
  lastChild: DomNode | null
  nextSibling: DomNode | null
  previousSibling: DomNode | null
  parentNode: DomNode | null
  contains(other: DomNode | null): boolean
}
type NodeFilterLike =
  | ((node: DomNode) => number)
  | { acceptNode(node: DomNode): number }
  | null
const liveIterators = new Set<WeakRef<SpecNodeIterator>>()

class SpecNodeIterator {
  readonly root: DomNode
  readonly whatToShow: number
  readonly filter: NodeFilterLike
  referenceNode: DomNode
  pointerBeforeReferenceNode = true

  constructor(
    root: DomNode,
    whatToShow = 0xffffffff,
    filter: NodeFilterLike = null,
  ) {
    this.root = root
    this.whatToShow = whatToShow >>> 0
    this.filter = filter
    this.referenceNode = root
    liveIterators.add(new WeakRef(this))
  }

  private accept(node: DomNode): number {
    const bit = 1 << (node.nodeType - 1)
    if ((this.whatToShow & bit) === 0) return NODE_FILTER_SKIP
    if (!this.filter) return NODE_FILTER_ACCEPT
    return typeof this.filter === "function"
      ? this.filter(node)
      : this.filter.acceptNode(node)
  }

  private following(node: DomNode): DomNode | null {
    if (node.firstChild) return node.firstChild
    return this.followingSkippingChildren(node)
  }

  private followingSkippingChildren(node: DomNode): DomNode | null {
    let current: DomNode | null = node
    while (current) {
      if (current === this.root) return null
      if (current.nextSibling) return current.nextSibling
      current = current.parentNode
    }
    return null
  }

  private preceding(node: DomNode): DomNode | null {
    if (node === this.root) return null
    if (node.previousSibling) {
      let current = node.previousSibling
      while (current.lastChild) current = current.lastChild
      return current
    }
    return node.parentNode
  }

  private traverse(forward: boolean): DomNode | null {
    let node = this.referenceNode
    let before = this.pointerBeforeReferenceNode
    for (;;) {
      if (forward) {
        if (!before) {
          const next = this.following(node)
          if (!next) return null
          node = next
        } else {
          before = false
        }
      } else if (before) {
        const previous = this.preceding(node)
        if (!previous) return null
        node = previous
      } else {
        before = true
      }
      if (this.accept(node) === NODE_FILTER_ACCEPT) break
    }
    this.referenceNode = node
    this.pointerBeforeReferenceNode = before
    return node
  }

  nextNode() {
    return this.traverse(true)
  }

  previousNode() {
    return this.traverse(false)
  }

  detach() {}

  preRemove(toBeRemoved: DomNode) {
    if (toBeRemoved === this.root || !toBeRemoved.contains(this.referenceNode))
      return
    if (this.pointerBeforeReferenceNode) {
      const next = this.followingSkippingChildren(toBeRemoved)
      if (next) {
        this.referenceNode = next
        return
      }
      this.pointerBeforeReferenceNode = false
    }
    if (toBeRemoved.previousSibling) {
      let current = toBeRemoved.previousSibling
      while (current.lastChild) current = current.lastChild
      this.referenceNode = current
    } else if (toBeRemoved.parentNode) {
      this.referenceNode = toBeRemoved.parentNode
    }
  }
}

const removeChildSymbol = (PropertySymbol as unknown as { removeChild: symbol })
  .removeChild

const NodeProtoRecord = w.Node.prototype as Record<symbol, unknown>
const originalInternalRemoveChild = NodeProtoRecord[removeChildSymbol] as (
  this: unknown,
  node: DomNode,
) => unknown
NodeProtoRecord[removeChildSymbol] = function patchedRemoveChild(
  this: unknown,
  node: DomNode,
) {
  for (const ref of liveIterators) {
    const iterator = ref.deref()
    if (iterator) iterator.preRemove(node)
    else liveIterators.delete(ref)
  }
  return originalInternalRemoveChild.call(this, node)
}
// window.Document is a per-window subclass that window.document does not
// inherit from; patch the prototype that actually owns createNodeIterator.
let DocumentProto = Object.getPrototypeOf(testWindow.document) as Record<
  string,
  unknown
> | null
while (DocumentProto && !Object.hasOwn(DocumentProto, "createNodeIterator")) {
  DocumentProto = Object.getPrototypeOf(DocumentProto) as Record<
    string,
    unknown
  > | null
}
if (!DocumentProto)
  throw new Error("happy-dom Document.prototype.createNodeIterator not found")
DocumentProto.createNodeIterator = function createNodeIterator(
  root: DomNode,
  whatToShow?: number,
  filter?: NodeFilterLike,
) {
  return new SpecNodeIterator(root, whatToShow ?? 0xffffffff, filter ?? null)
}

const globalNames = [
  "document",
  "navigator",
  "location",
  "Node",
  "Text",
  "Element",
  "HTMLElement",
  "HTMLDivElement",
  "HTMLSpanElement",
  "HTMLStyleElement",
  "SVGElement",
  "SVGSVGElement",
  "DocumentFragment",
  "DOMParser",
  "XMLSerializer",
  "MutationObserver",
  "ResizeObserver",
  "IntersectionObserver",
  "NodeFilter",
  "Range",
  "Selection",
  "DOMRect",
  "Event",
  "KeyboardEvent",
  "MouseEvent",
  "PointerEvent",
  "InputEvent",
  "ClipboardEvent",
  "DragEvent",
  "DataTransfer",
  "CSSStyleSheet",
  "CustomEvent",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "matchMedia",
  "Blob",
  "File",
  "localStorage",
  "sessionStorage",
  "getSelection",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLButtonElement",
  "HTMLAnchorElement",
  "HTMLImageElement",
  "HTMLIFrameElement",
  "FocusEvent",
  "UIEvent",
  "customElements",
  "getSelection",
] as const

const assigned: Record<string, unknown> = { window: testWindow }
for (const name of globalNames) {
  const value = w[name]
  if (value !== undefined) {
    assigned[name] =
      typeof value === "function" && /^[a-z]/.test(name)
        ? (value as (...a: unknown[]) => unknown).bind(testWindow)
        : value
  }
}
assigned.getComputedStyle = w.getComputedStyle.bind(testWindow)
Object.assign(globalThis, assigned)
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Inert preload-bridge placeholder. `src/renderer/lib/trpc` builds its IPC link
 * at import time and throws when `electronTRPC` is absent; the mentions editor
 * imports that module transitively (agents-file-mention). No Domain-B path is
 * expected to send anything: calls are recorded so a test can assert zero use.
 */
export const bridgeCalls: unknown[] = []
;(globalThis as { electronTRPC?: unknown }).electronTRPC = {
  sendMessage: (message: unknown) => {
    bridgeCalls.push(message)
  },
  onMessage: () => undefined,
}
