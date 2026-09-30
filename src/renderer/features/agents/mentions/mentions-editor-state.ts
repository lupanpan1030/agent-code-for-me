/**
 * Canonical mentions-editor state (openspec change
 * `add-renderer-untrusted-content-hardening`, design D4).
 *
 * Editor content is a lossless sequence of runs: text runs and atomic
 * reviewed mention runs. A logical selection names its anchor and focus as a
 * run index plus an intra-run offset; for a mention run the offset is only 0
 * (before) or 1 (after) the atomic run. The contentEditable DOM is only ever
 * (re)built from runs by `buildEditorDom`, the one safe builder, which
 * creates Text nodes, `br` and reviewed mention elements and never parses
 * markup. Undo/redo and every component-owned insertion (paste, drop, line
 * breaks, mentions) go through this state; no DOM/HTML snapshot is replayed.
 *
 * Invariant: `serializeRuns(readEditorState(buildEditorDom(root, runs)).runs)
 * === serializeRuns(normalizeRuns(runs))`, including whitespace adjacent to
 * mentions (the builder adds no implicit space).
 */
import { createFileIconElement } from "./agents-file-mention"
import type { FileMentionOption } from "./agents-mentions-editor"
import { MENTION_PREFIXES } from "./mention-prefixes"

export type MentionRunType = NonNullable<FileMentionOption["type"]>

export interface TextRun {
  readonly kind: "text"
  readonly text: string
}

export interface MentionRun {
  readonly kind: "mention"
  readonly id: string
  readonly label: string
  readonly type: MentionRunType
}

export type EditorRun = TextRun | MentionRun

export interface EditorPosition {
  /** Index into the runs; `offset` is a character offset for text runs and 0 (before) / 1 (after) for a mention run. */
  readonly run: number
  readonly offset: number
}

export interface EditorSelectionState {
  readonly anchor: EditorPosition
  readonly focus: EditorPosition
}

export interface EditorState {
  readonly runs: readonly EditorRun[]
  readonly selection: EditorSelectionState | null
}

const MENTION_RUN_TYPES: readonly MentionRunType[] = [
  "file",
  "folder",
  "skill",
  "agent",
  "category",
  "tool",
]

const MENTION_CLASS_NAME =
  "inline-flex items-center gap-1 px-[6px] py-[1px] rounded-[4px] text-sm align-middle bg-black/[0.04] dark:bg-white/[0.08] text-foreground/80 [&.mention-selected]:bg-primary/70 [&.mention-selected]:text-primary-foreground"

/**
 * Marks the builder's end-of-content line placeholder: a trailing newline is
 * not rendered as an empty line in `white-space: pre-wrap`, so the builder
 * follows it with one `br` that serialization ignores.
 */
const LINE_END_PLACEHOLDER_ATTRIBUTE = "data-mentions-line-end"

const ELEMENT_NODE = 1
const TEXT_NODE = 3

// ============================================================================
// Runs
// ============================================================================

export function mentionToken(id: string): string {
  return `@[${id}]`
}

function runLength(run: EditorRun): number {
  return run.kind === "text" ? run.text.length : mentionToken(run.id).length
}

export function serializeRuns(runs: readonly EditorRun[]): string {
  return runs
    .map((run) => (run.kind === "text" ? run.text : mentionToken(run.id)))
    .join("")
}

/** Merges adjacent text runs and drops empty ones. */
export function normalizeRuns(runs: readonly EditorRun[]): EditorRun[] {
  const normalized: EditorRun[] = []
  for (const run of runs) {
    if (run.kind === "text") {
      if (run.text === "") continue
      const last = normalized[normalized.length - 1]
      if (last?.kind === "text") {
        normalized[normalized.length - 1] = {
          kind: "text",
          text: last.text + run.text,
        }
        continue
      }
    }
    normalized.push(run)
  }
  return normalized
}

/** Stable identity of a run sequence, for "nothing changed" checks. */
export function editorRunsKey(runs: readonly EditorRun[]): string {
  return JSON.stringify(runs)
}

function mentionRunType(type: string | null | undefined): MentionRunType {
  return MENTION_RUN_TYPES.find((known) => known === type) ?? "file"
}

export function mentionRunFromOption(option: FileMentionOption): MentionRun {
  return {
    kind: "mention",
    id: option.id,
    label: option.label,
    type: mentionRunType(option.type),
  }
}

/** The mention a serialized `@[id]` token names, or null for plain text. */
export function resolveMentionRun(id: string): MentionRun | null {
  const mention = (label: string, type: MentionRunType): MentionRun => ({
    kind: "mention",
    id,
    label,
    type,
  })
  if (
    id.startsWith(MENTION_PREFIXES.FILE) ||
    id.startsWith(MENTION_PREFIXES.FOLDER)
  ) {
    const parts = id.split(":")
    if (parts.length >= 3) {
      const path = parts.slice(2).join(":")
      return mention(
        path.split("/").pop() || path,
        parts[0] === "folder" ? "folder" : "file",
      )
    }
    return null
  }
  if (id.startsWith(MENTION_PREFIXES.SKILL)) {
    return mention(id.slice(MENTION_PREFIXES.SKILL.length), "skill")
  }
  if (id.startsWith(MENTION_PREFIXES.AGENT)) {
    return mention(id.slice(MENTION_PREFIXES.AGENT.length), "agent")
  }
  if (id.startsWith(MENTION_PREFIXES.TOOL)) {
    const toolPath = id.slice(MENTION_PREFIXES.TOOL.length)
    if (!toolPath.startsWith("mcp__")) return mention(toolPath, "tool")
    const parts = toolPath.split("__")
    const toolName = parts.length >= 3 ? parts.slice(2).join("__") : toolPath
    return mention(
      toolName
        .replace(/_/g, " ")
        .replace(/\b\w/g, (character) => character.toUpperCase())
        .trim(),
      "tool",
    )
  }
  return null
}

/** Runs for a serialized `@[id]` value; unresolvable tokens stay text. */
export function parseSerializedRuns(serialized: string): EditorRun[] {
  const runs: EditorRun[] = []
  const token = /@\[([^\]]+)\]/g
  let lastIndex = 0
  for (const match of serialized.matchAll(token)) {
    const index = match.index ?? 0
    runs.push({ kind: "text", text: serialized.slice(lastIndex, index) })
    runs.push(resolveMentionRun(match[1]) ?? { kind: "text", text: match[0] })
    lastIndex = index + match[0].length
  }
  runs.push({ kind: "text", text: serialized.slice(lastIndex) })
  return normalizeRuns(runs)
}

// ============================================================================
// Logical positions and editing
// ============================================================================

function totalLength(runs: readonly EditorRun[]): number {
  return runs.reduce((sum, run) => sum + runLength(run), 0)
}

/** Serialized offset of a position. */
export function positionToOffset(
  runs: readonly EditorRun[],
  position: EditorPosition,
): number {
  let start = 0
  for (let index = 0; index < Math.min(position.run, runs.length); index++) {
    start += runLength(runs[index])
  }
  const run = runs[position.run]
  if (!run) return start
  if (run.kind === "text") {
    return start + Math.min(Math.max(position.offset, 0), run.text.length)
  }
  return start + (position.offset > 0 ? runLength(run) : 0)
}

/**
 * Canonical position for a serialized offset. Boundaries prefer a text run;
 * an offset inside a mention token clamps to after the atomic run.
 */
export function offsetToPosition(
  runs: readonly EditorRun[],
  offset: number,
): EditorPosition {
  let start = 0
  for (let index = 0; index < runs.length; index++) {
    const run = runs[index]
    const length = runLength(run)
    if (run.kind === "text") {
      if (offset <= start + length) {
        return { run: index, offset: Math.max(0, offset - start) }
      }
    } else if (offset <= start) {
      return { run: index, offset: 0 }
    } else if (offset < start + length) {
      return { run: index, offset: 1 }
    }
    start += length
  }
  const last = runs.length - 1
  if (last < 0) return { run: 0, offset: 0 }
  const lastRun = runs[last]
  return {
    run: last,
    offset: lastRun.kind === "text" ? lastRun.text.length : 1,
  }
}

function runsBefore(runs: readonly EditorRun[], offset: number): EditorRun[] {
  const kept: EditorRun[] = []
  let start = 0
  for (const run of runs) {
    if (start >= offset) break
    if (run.kind === "text") {
      kept.push({ kind: "text", text: run.text.slice(0, offset - start) })
    } else {
      kept.push(run)
    }
    start += runLength(run)
  }
  return kept
}

function runsAfter(runs: readonly EditorRun[], offset: number): EditorRun[] {
  const kept: EditorRun[] = []
  let start = 0
  for (const run of runs) {
    const end = start + runLength(run)
    if (run.kind === "text") {
      if (end > offset) {
        kept.push({
          kind: "text",
          text: run.text.slice(Math.max(0, offset - start)),
        })
      }
    } else if (start >= offset) {
      kept.push(run)
    }
    start = end
  }
  return kept
}

/**
 * Replaces the logical range `[start, end]` with `inserted` runs and returns
 * the new state with a collapsed caret after the inserted runs.
 */
export function replaceRange(
  runs: readonly EditorRun[],
  start: number,
  end: number,
  inserted: readonly EditorRun[],
): EditorState {
  const next = normalizeRuns([
    ...runsBefore(runs, start),
    ...inserted,
    ...runsAfter(runs, end),
  ])
  const caret = offsetToPosition(next, start + totalLength(inserted))
  return { runs: next, selection: { anchor: caret, focus: caret } }
}

/** Logical `[start, end]` of a selection; the end of content when absent. */
export function selectionRange(state: EditorState): [number, number] {
  if (!state.selection) {
    const end = totalLength(state.runs)
    return [end, end]
  }
  const anchor = positionToOffset(state.runs, state.selection.anchor)
  const focus = positionToOffset(state.runs, state.selection.focus)
  return [Math.min(anchor, focus), Math.max(anchor, focus)]
}

/** Replaces the selection (or appends at the end) with plain text. */
export function insertTextIntoState(
  state: EditorState,
  text: string,
): EditorState {
  const [start, end] = selectionRange(state)
  return replaceRange(state.runs, start, end, [{ kind: "text", text }])
}

// ============================================================================
// DOM: the one safe builder, the reader and selection mapping
// ============================================================================

/** Reviewed mention element: attributes and text only, no markup parsing. */
export function createMentionElement(
  run: MentionRun,
  ownerDocument: Document = document,
): HTMLSpanElement {
  const span = ownerDocument.createElement("span")
  span.setAttribute("contenteditable", "false")
  span.setAttribute("data-mention-id", run.id)
  span.setAttribute("data-mention-type", run.type)
  span.className = MENTION_CLASS_NAME
  span.appendChild(createFileIconElement(run.label, run.type))
  const label = ownerDocument.createElement("span")
  label.textContent = run.label
  span.appendChild(label)
  return span
}

/**
 * The one safe builder: replaces the editor's children with Text nodes and
 * reviewed mention elements for `runs` (plus the end-of-content line
 * placeholder `br` after a trailing newline). Returns the node built for each
 * run, index-aligned with `runs`.
 */
export function buildEditorDom(
  root: HTMLElement,
  runs: readonly EditorRun[],
): Node[] {
  const ownerDocument = root.ownerDocument
  const nodes = runs.map((run) =>
    run.kind === "text"
      ? ownerDocument.createTextNode(run.text)
      : createMentionElement(run, ownerDocument),
  )
  const last = runs[runs.length - 1]
  const placeholder: Node[] = []
  if (last?.kind === "text" && last.text.endsWith("\n")) {
    const lineEnd = ownerDocument.createElement("br")
    lineEnd.setAttribute(LINE_END_PLACEHOLDER_ATTRIBUTE, "")
    placeholder.push(lineEnd)
  }
  root.replaceChildren(...nodes, ...placeholder)
  return nodes
}

function mentionRunFromElement(element: Element): MentionRun {
  const id = element.getAttribute("data-mention-id") ?? ""
  const label =
    Array.from(element.children)
      .reverse()
      .find((child) => child.localName === "span")?.textContent ??
    resolveMentionRun(id)?.label ??
    id
  return {
    kind: "mention",
    id,
    label,
    type: mentionRunType(element.getAttribute("data-mention-type")),
  }
}

/**
 * Reads the canonical state from whatever the editor DOM currently holds.
 * Text nodes and `br` become text; `data-mention-id` elements become atomic
 * mention runs; any other element contributes only its text (a non-root
 * `div` starts a new line), so foreign markup is never carried forward. The
 * DOM selection maps to logical positions; a point inside a mention clamps to
 * after it. A selection outside the editor reads as null.
 */
export function readEditorState(
  root: HTMLElement,
  selection: Selection | null,
): EditorState {
  const runs: EditorRun[] = []
  let serialized = ""
  const before = new Map<Node, number>()
  const after = new Map<Node, number>()
  const atomic = new Set<Node>()

  const appendText = (text: string) => {
    if (text === "") return
    const last = runs[runs.length - 1]
    if (last?.kind === "text") {
      runs[runs.length - 1] = { kind: "text", text: last.text + text }
    } else {
      runs.push({ kind: "text", text })
    }
    serialized += text
  }

  const visit = (node: Node) => {
    before.set(node, serialized.length)
    if (node.nodeType === TEXT_NODE) {
      appendText(node.textContent ?? "")
    } else if (node.nodeType === ELEMENT_NODE) {
      const element = node as Element
      const name = (element.localName || "").toLowerCase()
      if (name === "br") {
        if (!element.hasAttribute(LINE_END_PLACEHOLDER_ATTRIBUTE)) {
          appendText("\n")
        }
      } else if (element.hasAttribute("data-mention-id")) {
        atomic.add(element)
        const run = mentionRunFromElement(element)
        runs.push(run)
        serialized += mentionToken(run.id)
      } else if (element.hasAttribute("data-ultrathink")) {
        atomic.add(element)
        appendText(element.textContent ?? "")
      } else {
        if (
          name === "div" &&
          serialized.length > 0 &&
          !serialized.endsWith("\n")
        ) {
          appendText("\n")
        }
        for (const child of Array.from(element.childNodes)) visit(child)
      }
    }
    after.set(node, serialized.length)
  }
  for (const child of Array.from(root.childNodes)) visit(child)

  const pointOffset = (container: Node | null, offset: number) => {
    if (!container || (container !== root && !root.contains(container))) {
      return null
    }
    for (
      let node: Node | null = container;
      node && node !== root;
      node = node.parentNode
    ) {
      if (atomic.has(node)) return after.get(node) ?? null
    }
    if (container.nodeType === TEXT_NODE) {
      const length = (container.textContent ?? "").length
      return (before.get(container) ?? 0) + Math.min(offset, length)
    }
    const children = container.childNodes
    if (offset < children.length) return before.get(children[offset]) ?? null
    return container === root
      ? serialized.length
      : (after.get(container) ?? null)
  }

  let selectionState: EditorSelectionState | null = null
  if (selection && selection.rangeCount > 0) {
    const anchor = pointOffset(selection.anchorNode, selection.anchorOffset)
    const focus = pointOffset(selection.focusNode, selection.focusOffset)
    if (anchor !== null && focus !== null) {
      selectionState = {
        anchor: offsetToPosition(runs, anchor),
        focus: offsetToPosition(runs, focus),
      }
    }
  }
  return { runs, selection: selectionState }
}

function domPoint(
  root: HTMLElement,
  nodes: readonly Node[],
  runs: readonly EditorRun[],
  position: EditorPosition,
): { node: Node; offset: number } {
  const node = nodes[position.run]
  const run = runs[position.run]
  if (!node || !run) return { node: root, offset: 0 }
  if (run.kind === "text") {
    return {
      node,
      offset: Math.min(Math.max(position.offset, 0), run.text.length),
    }
  }
  const index = Array.prototype.indexOf.call(root.childNodes, node)
  return { node: root, offset: index + (position.offset > 0 ? 1 : 0) }
}

/**
 * Applies a logical selection to nodes built by `buildEditorDom`, keeping
 * its direction; null places the caret at the end of the content.
 */
export function applyEditorSelection(
  root: HTMLElement,
  nodes: readonly Node[],
  runs: readonly EditorRun[],
  selectionState: EditorSelectionState | null,
  selection: Selection | null,
): void {
  if (!selection) return
  const end = offsetToPosition(runs, totalLength(runs))
  const anchor = domPoint(root, nodes, runs, selectionState?.anchor ?? end)
  const focus = domPoint(root, nodes, runs, selectionState?.focus ?? end)
  selection.setBaseAndExtent(
    anchor.node,
    anchor.offset,
    focus.node,
    focus.offset,
  )
}

/** Collapses the selection at the end of the content (before the line placeholder). */
export function placeCaretAtEnd(root: HTMLElement, selection: Selection): void {
  let index = root.childNodes.length
  const last = root.lastChild
  if (
    last?.nodeType === ELEMENT_NODE &&
    (last as Element).hasAttribute(LINE_END_PLACEHOLDER_ATTRIBUTE)
  ) {
    index -= 1
  }
  const previous = root.childNodes[index - 1]
  if (previous?.nodeType === TEXT_NODE) {
    selection.collapse(previous, (previous.textContent ?? "").length)
  } else {
    selection.collapse(root, index)
  }
}
