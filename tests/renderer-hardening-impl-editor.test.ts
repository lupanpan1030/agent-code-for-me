/**
 * Implementer tests for the mentions editor (openspec change
 * `add-renderer-untrusted-content-hardening`, design D4, tasks 2.6-2.8): the
 * canonical run/selection model and its one safe DOM builder, the reader's
 * handling of foreign markup, the typed paste delegate, drop and line-break
 * gates, atomic and triggered mention insertion, canonical undo, and the
 * shared oracle's editor profile. Native rich paste/drop, `execCommand`, IME
 * and native undo/redo are GUI task 5.1 evidence.
 */
import "./fixtures/renderer-hardening/mermaid-editor/happy-dom-env"
import { afterEach, describe, expect, mock, test } from "bun:test"
import { act, createElement, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  AgentsMentionsEditor,
  type AgentsMentionsEditorHandle,
  type MentionsEditorPasteResult,
} from "../src/renderer/features/agents/mentions/agents-mentions-editor"
import {
  applyEditorSelection,
  buildEditorDom,
  type EditorRun,
  insertTextIntoState,
  normalizeRuns,
  offsetToPosition,
  parseSerializedRuns,
  positionToOffset,
  readEditorState,
  replaceRange,
  serializeRuns,
} from "../src/renderer/features/agents/mentions/mentions-editor-state"
import {
  handlePasteEvent,
  LARGE_PASTE_THRESHOLD,
} from "../src/renderer/features/agents/utils/paste-text"
import { testWindow } from "./fixtures/renderer-hardening/mermaid-editor/happy-dom-env"
import { findRendererMarkupViolations } from "./helpers/renderer-executable-markup-oracle"

const doc = testWindow.document as unknown as Document
const mountedRoots: Root[] = []
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

afterEach(async () => {
  for (const root of mountedRoots.splice(0)) {
    await act(async () => root.unmount())
  }
  doc.body.replaceChildren()
  testWindow.getSelection()?.removeAllRanges()
})

function editorViolations(editor: Element) {
  return findRendererMarkupViolations(editor as never, { kind: "editor" })
}

function selection(): Selection {
  return testWindow.getSelection() as unknown as Selection
}

const mention = (id: string, label: string, type = "skill"): EditorRun => ({
  kind: "mention",
  id,
  label,
  type: type as "skill",
})

describe("D4 model: lossless runs and logical positions", () => {
  test.each([
    "",
    "plain text",
    "a  @[file:repo:src/x.ts]  b",
    "trailing @[skill:foo]",
    "@[agent:bot]@[skill:foo]",
    "line one\n@[folder:repo:src]\nline two",
    "@[quote:abc] and @[file:short] stay text",
    "tool @[tool:mcp__srv__read_file] and @[tool:server]",
    "ends with a newline\n",
  ])("serialize(parse(value)) === value for %j", (value) => {
    expect(serializeRuns(parseSerializedRuns(value))).toBe(value)
  })

  test("unresolvable tokens stay text; resolvable ones become atomic mention runs", () => {
    expect(
      parseSerializedRuns("@[quote:abc] @[tool:mcp__srv__read_file]"),
    ).toEqual([
      { kind: "text", text: "@[quote:abc] " },
      mention("tool:mcp__srv__read_file", "Read File", "tool"),
    ])
  })

  test("positions prefer text runs at boundaries and clamp inside a mention to after it", () => {
    const runs: EditorRun[] = [
      { kind: "text", text: "a " },
      mention("skill:x", "x"),
      mention("skill:y", "y"),
      { kind: "text", text: " b" },
    ]
    // "a " [0,2] · @[skill:x] [2,12] · @[skill:y] [12,22] · " b" [22,24]
    expect(offsetToPosition(runs, 2)).toEqual({ run: 0, offset: 2 })
    expect(offsetToPosition(runs, 5)).toEqual({ run: 1, offset: 1 })
    expect(offsetToPosition(runs, 12)).toEqual({ run: 2, offset: 0 })
    expect(offsetToPosition(runs, 22)).toEqual({ run: 3, offset: 0 })
    expect(offsetToPosition(runs, 24)).toEqual({ run: 3, offset: 2 })
    for (const offset of [0, 2, 12, 22, 24]) {
      expect(positionToOffset(runs, offsetToPosition(runs, offset))).toBe(
        offset,
      )
    }
    expect(offsetToPosition([], 0)).toEqual({ run: 0, offset: 0 })
  })

  test("replacing a range removes whole atomic mentions and places a collapsed caret", () => {
    const runs = parseSerializedRuns("ab @[skill:x] cd")
    const next = replaceRange(runs, 2, 14, [{ kind: "text", text: "Z" }])
    expect(serializeRuns(next.runs)).toBe("abZcd")
    expect(next.selection).toEqual({
      anchor: { run: 0, offset: 3 },
      focus: { run: 0, offset: 3 },
    })
  })

  test("inserted text replaces a backward selection", () => {
    const runs = parseSerializedRuns("hello world")
    const next = insertTextIntoState(
      {
        runs,
        selection: {
          anchor: { run: 0, offset: 11 },
          focus: { run: 0, offset: 6 },
        },
      },
      "there",
    )
    expect(serializeRuns(next.runs)).toBe("hello there")
  })
})

describe("D4 DOM: the one safe builder and the reader", () => {
  test("serialize(read(build(runs))) === serialize(normalize(runs)), labels and types included", () => {
    const runs: EditorRun[] = [
      { kind: "text", text: "a " },
      { kind: "text", text: " " },
      mention("skill:x", "Custom Label"),
      mention("folder:repo:src", "src", "folder"),
      { kind: "text", text: "\nnext " },
    ]
    const editor = doc.createElement("div")
    buildEditorDom(editor, runs)
    const read = readEditorState(editor, null)
    expect(read.runs).toEqual(normalizeRuns(runs))
    expect(serializeRuns(read.runs)).toBe(serializeRuns(normalizeRuns(runs)))
    expect(editorViolations(editor)).toEqual([])
  })

  test("a trailing newline gets one line-end placeholder <br> that serialization ignores", () => {
    const editor = doc.createElement("div")
    buildEditorDom(editor, parseSerializedRuns("ab\n"))
    expect(editor.lastChild?.nodeName.toLowerCase()).toBe("br")
    expect(editor.querySelectorAll("br")).toHaveLength(1)
    expect(serializeRuns(readEditorState(editor, null).runs)).toBe("ab\n")
    buildEditorDom(editor, parseSerializedRuns("ab"))
    expect(editor.querySelectorAll("br")).toHaveLength(0)
    expect(editorViolations(editor)).toEqual([])
  })

  test("foreign markup reads as text only and rebuilds into reviewed DOM", () => {
    const editor = doc.createElement("div")
    editor.innerHTML =
      'one<div>two<b onclick="x()">bold</b></div><img src="x" onerror="x()"><br>' +
      '<span data-mention-id="skill:evil" data-mention-type="evil" onclick="x()"><img src="y" onerror="x()"><span>shown</span></span>' +
      '<a href="javascript:x()">link</a><!-- note -->'
    const state = readEditorState(editor, null)
    expect(state.runs).toEqual([
      { kind: "text", text: "one\ntwobold\n" },
      { kind: "mention", id: "skill:evil", label: "shown", type: "file" },
      { kind: "text", text: "link" },
    ])
    expect(editorViolations(editor).length).toBeGreaterThan(0)
    buildEditorDom(editor, state.runs)
    expect(editorViolations(editor)).toEqual([])
    expect(editor.querySelector("[onclick], img, a, b, div")).toBeNull()
  })

  test("selection maps to logical positions (mention interiors clamp after) and back, direction kept", () => {
    const editor = doc.createElement("div")
    doc.body.append(editor)
    const runs = parseSerializedRuns("ab @[skill:chip] cd")
    const nodes = buildEditorDom(editor, runs)
    const label = editor.querySelector("[data-mention-id] span:last-child")
      ?.firstChild as Node
    selection().setBaseAndExtent(label, 1, nodes[2], 2)
    const state = readEditorState(editor, selection())
    expect(state.selection).toEqual({
      anchor: { run: 2, offset: 0 },
      focus: { run: 2, offset: 2 },
    })
    const backward = {
      anchor: { run: 2, offset: 2 },
      focus: { run: 0, offset: 1 },
    }
    applyEditorSelection(editor, nodes, runs, backward, selection())
    expect(readEditorState(editor, selection()).selection).toEqual(backward)
    // An element-container point before the chip is the text boundary.
    selection().collapse(editor, 1)
    expect(readEditorState(editor, selection()).selection?.focus).toEqual({
      run: 0,
      offset: 3,
    })
    selection().collapse(editor, 2)
    expect(readEditorState(editor, selection()).selection?.focus).toEqual({
      run: 2,
      offset: 0,
    })
  })
})

type Mount = {
  handle: AgentsMentionsEditorHandle
  editor: HTMLElement
  container: HTMLElement
  triggers: string[]
}

async function mountEditor(
  onPaste?: (event: never) => MentionsEditorPasteResult | undefined,
): Promise<Mount> {
  const container = doc.createElement("div")
  doc.body.append(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  const ref = createRef<AgentsMentionsEditorHandle>()
  const triggers: string[] = []
  await act(async () => {
    root.render(
      createElement(AgentsMentionsEditor, {
        ref,
        onTrigger: ({ searchText }: { searchText: string }) => {
          triggers.push(searchText)
        },
        onCloseTrigger: () => undefined,
        onPaste: onPaste as never,
      }),
    )
  })
  const editor = container.querySelector("[contenteditable]") as HTMLElement
  if (!ref.current) throw new Error("fixture precondition: editor handle")
  return { handle: ref.current, editor, container, triggers }
}

async function setValue(mount: Mount, value: string) {
  await act(async () => {
    mount.handle.setValue(value)
  })
}

function caretAt(node: Node, offset: number) {
  selection().setBaseAndExtent(node, offset, node, offset)
}

function transfer(entries: Record<string, string>, files: File[] = []) {
  const data = new testWindow.DataTransfer()
  for (const [type, value] of Object.entries(entries)) data.setData(type, value)
  for (const file of files) data.items.add(file as never)
  return data
}

async function paste(
  editor: HTMLElement,
  entries: Record<string, string>,
  files: File[] = [],
) {
  const event = new testWindow.ClipboardEvent("paste", {
    clipboardData: transfer(entries, files),
    bubbles: true,
    cancelable: true,
  }) as unknown as Event
  await act(async () => {
    editor.dispatchEvent(event)
  })
  return event
}

async function drop(editor: HTMLElement, data: DataTransfer) {
  const event = new testWindow.DragEvent("drop", {
    bubbles: true,
    cancelable: true,
  }) as unknown as Event
  Object.defineProperty(event, "dataTransfer", { value: data })
  await act(async () => {
    editor.dispatchEvent(event)
  })
  return event
}

async function beforeInput(editor: HTMLElement, inputType: string) {
  const event = new testWindow.InputEvent("beforeinput", {
    inputType,
    bubbles: true,
    cancelable: true,
  }) as unknown as Event
  await act(async () => {
    editor.dispatchEvent(event)
  })
  return event
}

const image = () =>
  new testWindow.File(["png"], "clip.png", {
    type: "image/png",
  }) as unknown as File

describe("D4 component: typed paste delegation", () => {
  function delegate() {
    const attachments = mock((_files: File[], _source?: string) => undefined)
    const largeText = mock(async (_text: string) => undefined)
    return {
      attachments,
      largeText,
      onPaste: (event: never) =>
        handlePasteEvent(event, attachments, largeText),
    }
  }

  test("image data goes to the typed attachment callback; nothing is inserted", async () => {
    const { attachments, onPaste } = delegate()
    const mount = await mountEditor(onPaste)
    await setValue(mount, "abcd")
    const before = mount.editor.innerHTML
    const event = await paste(
      mount.editor,
      { "text/html": "<b>x</b>", "text/plain": "x" },
      [image()],
    )
    expect(event.defaultPrevented).toBe(true)
    expect(attachments).toHaveBeenCalledTimes(1)
    expect(attachments.mock.calls[0]?.[0]).toHaveLength(1)
    expect(attachments.mock.calls[0]?.[1]).toBe("clipboard")
    expect(mount.editor.innerHTML).toBe(before)
  })

  test("large text goes to the typed file callback; plain text is inserted by the editor; HTML-only is rejected", async () => {
    const { largeText, onPaste } = delegate()
    const mount = await mountEditor(onPaste)
    await setValue(mount, "abcd")
    caretAt(mount.editor.firstChild as Node, 2)
    const large = "x".repeat(LARGE_PASTE_THRESHOLD + 1)
    await paste(mount.editor, { "text/plain": large })
    expect(largeText).toHaveBeenCalledWith(large)
    expect(mount.handle.getValue()).toBe("abcd")
    await paste(mount.editor, { "text/html": "<i>RICH</i>" })
    expect(mount.handle.getValue()).toBe("abcd")
    await paste(mount.editor, {
      "text/html": "<i>RICH</i>",
      "text/plain": "<i>plain</i>",
    })
    expect(mount.handle.getValue()).toBe("ab<i>plain</i>cd")
    expect(editorViolations(mount.editor)).toEqual([])
  })

  test("pasted text is bounded to the editor's remaining capacity", async () => {
    const { onPaste } = delegate()
    const mount = await mountEditor(onPaste)
    await setValue(mount, "y".repeat(9_990))
    await paste(mount.editor, { "text/plain": "z".repeat(50) })
    expect(mount.handle.getValue()).toBe(
      `${"y".repeat(9_990)}${"z".repeat(10)}`,
    )
  })

  test("a delegate's insertText result replaces the clipboard text; consumed inserts nothing", async () => {
    const results: MentionsEditorPasteResult[] = [
      { kind: "insertText", text: "BOUNDED" },
      { kind: "consumed" },
    ]
    const mount = await mountEditor(() => results.shift())
    await setValue(mount, "ab")
    await paste(mount.editor, { "text/plain": "IGNORED" })
    expect(mount.handle.getValue()).toBe("abBOUNDED")
    await paste(mount.editor, { "text/plain": "IGNORED" })
    expect(mount.handle.getValue()).toBe("abBOUNDED")
  })
})

describe("D4 component: drop and line-break gates", () => {
  test("a file drop is prevented, inserts nothing and still bubbles to the parent's typed handler", async () => {
    const mount = await mountEditor()
    await setValue(mount, "abcd")
    const parentSaw: string[] = []
    mount.container.addEventListener("drop", (event) => {
      parentSaw.push(event.type)
    })
    const event = await drop(
      mount.editor,
      transfer({ "text/plain": "/tmp/clip.png" }, [image()]),
    )
    expect(event.defaultPrevented).toBe(true)
    expect(parentSaw).toEqual(["drop"])
    expect(mount.handle.getValue()).toBe("abcd")
  })

  test("dropped text inserts only its text/plain at the selection", async () => {
    const mount = await mountEditor()
    await setValue(mount, "abcd")
    caretAt(mount.editor.firstChild as Node, 2)
    await drop(
      mount.editor,
      transfer({ "text/html": "<b>RICH</b>", "text/plain": "<b>dropped</b>" }),
    )
    expect(mount.handle.getValue()).toBe("ab<b>dropped</b>cd")
    expect(editorViolations(mount.editor)).toEqual([])
  })

  test("a line break at the end is visible (placeholder) and typing after it stays lossless; undo restores canonically", async () => {
    const mount = await mountEditor()
    await setValue(mount, "ab")
    const event = await beforeInput(mount.editor, "insertLineBreak")
    expect(event.defaultPrevented).toBe(true)
    expect(mount.handle.getValue()).toBe("ab\n")
    expect(mount.editor.lastChild?.nodeName.toLowerCase()).toBe("br")
    await paste(mount.editor, { "text/plain": "c" })
    expect(mount.handle.getValue()).toBe("ab\nc")
    expect(mount.editor.querySelectorAll("br")).toHaveLength(0)
    expect(editorViolations(mount.editor)).toEqual([])
    const undo = await beforeInput(mount.editor, "historyUndo")
    expect(undo.defaultPrevented).toBe(true)
    expect(mount.handle.getValue()).toBe("ab\n")
  })

  test("undo/redo shortcuts never fall through to native undo, even with an empty stack", async () => {
    const mount = await mountEditor()
    for (const init of [
      { key: "z", ctrlKey: true },
      { key: "z", ctrlKey: true, shiftKey: true },
      { key: "y", metaKey: true },
    ]) {
      const event = new testWindow.KeyboardEvent("keydown", {
        ...init,
        bubbles: true,
        cancelable: true,
      }) as unknown as Event
      await act(async () => {
        mount.editor.dispatchEvent(event)
      })
      expect(event.defaultPrevented).toBe(true)
    }
  })
})

describe("D4 component: atomic and triggered mention insertion", () => {
  test("a caret inside a mention chip inserts the new mention after the chip, never inside it", async () => {
    const mount = await mountEditor()
    await setValue(mount, "a @[skill:first] b")
    const label = mount.editor.querySelector(
      "[data-mention-id] span:last-child",
    )?.firstChild as Node
    caretAt(label, 2)
    await act(async () => {
      mount.handle.insertMention({
        id: "skill:second",
        label: "second",
        path: "",
        repository: "",
        type: "skill",
      })
    })
    expect(mount.handle.getValue()).toBe("a @[skill:first]@[skill:second]  b")
    expect(
      mount.editor.querySelectorAll("[data-mention-id] [data-mention-id]"),
    ).toHaveLength(0)
    expect(editorViolations(mount.editor)).toEqual([])
  })

  test("a mention chosen for a typed @query replaces the query text", async () => {
    const mount = await mountEditor()
    await setValue(mount, "hi @fo")
    caretAt(mount.editor.firstChild as Node, 6)
    await act(async () => {
      mount.editor.dispatchEvent(
        new testWindow.Event("input", { bubbles: true }) as unknown as Event,
      )
    })
    await act(async () => {
      await sleep(50)
    })
    expect(mount.triggers).toEqual(["fo"])
    await act(async () => {
      mount.handle.insertMention({
        id: "skill:found",
        label: "found",
        path: "",
        repository: "",
        type: "skill",
      })
    })
    expect(mount.handle.getValue()).toBe("hi @[skill:found] ")
    expect(editorViolations(mount.editor)).toEqual([])
  })
})

describe("shared oracle: editor profile self-test", () => {
  test("accepts builder output and rejects every other construct", () => {
    const editor = doc.createElement("div")
    buildEditorDom(editor, parseSerializedRuns("a @[file:repo:x.ts] b\n"))
    expect(editorViolations(editor)).toEqual([])
    for (const markup of [
      "<div>x</div>",
      "<b>x</b>",
      '<span data-mention-id="x" contenteditable="false"><img src="x"></span>',
      '<span data-mention-id="x">not atomic</span>',
      "<style>x{}</style>",
      "<br><!-- comment -->",
      '<br onclick="x()">',
    ]) {
      const bad = doc.createElement("div")
      bad.innerHTML = markup
      expect({ markup, rejected: editorViolations(bad).length > 0 }).toEqual({
        markup,
        rejected: true,
      })
    }
  })
})
