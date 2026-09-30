/**
 * Test-first suite (Domain A) for design D3's Shiki part: "Highlighted HTML
 * reaches a raw insertion sink" (runtime-security-baseline delta), tasks
 * 2.4/2.5.
 *
 * The only substituted component is the generator: `shiki.createHighlighter`
 * is wrapped so the REAL Shiki highlighter is used, except that
 * `codeToHtml` returns a forced output shape when the source carries a
 * FORCE_* marker (design D3 "forced extraction-mismatch fixture" and
 * "forced dual-<code> fixture"). The reviewed producer `highlightCode()` and
 * its four raw-insertion consumers run unmodified:
 *
 * - chat/repository code fences: `MemoizedMarkdown` -> `CodeBlock`
 * - MCP tool output: `AgentMcpToolCall` -> `HighlightedJson`
 * - tool output: `AgentEditTool` (Write) -> `DiffLineRow`
 * - message JSON: `MessageJsonDisplay`
 *
 * Every test asserts on the rendered consumer DOM with the independent
 * rendered-DOM oracle; the pass condition accepts any D3 fail-closed outcome
 * (escaped text, a bounded error, or no render) and rejects only raw source
 * markup or accepted malformed generator output.
 */
import {
  afterEach,
  describe,
  expect,
  mock,
  setDefaultTimeout,
  test,
} from "bun:test"
import {
  findExecutableMarkup,
  installHappyDom,
} from "./renderer-hardening-content-oracle"

const testWindow = installHappyDom()

// The first real Shiki highlighter initialisation can take a few seconds.
setDefaultTimeout(20_000)

// AgentEditTool's module graph creates the app tRPC client at import time.
// The preload bridge is absent under bun; an inert IPC endpoint (no replies)
// stands in for it. It is unrelated to the highlighted-HTML path under test.
;(globalThis as { electronTRPC?: unknown }).electronTRPC = {
  sendMessage: () => {},
  onMessage: () => {},
}

const realShiki = await import("shiki")
const realExports: Record<string, unknown> = { ...realShiki }
const realCreateHighlighter = realShiki.createHighlighter

let generatorCalls = 0

const FORCED_OUTPUTS: Record<string, string> = {
  FORCE_NO_CODE_WRAPPER:
    '<pre class="shiki" tabindex="0"><span data-shiki-forged="mismatch">no code element</span></pre>',
  FORCE_DUAL_CODE:
    '<pre class="shiki"><code><span data-shiki-forged="first">GEN_FIRST</span></code></pre><pre class="shiki"><code><span data-shiki-forged="second">GEN_SECOND</span></code></pre>',
  FORCE_TRAILING_OUTPUT:
    '<pre class="shiki"><code><span data-shiki-forged="inside">GEN_INSIDE</span></code></pre><span data-shiki-forged="trailing">GEN_TRAILING</span>',
}

function forcedOutputFor(code: string): string | null {
  const marker = Object.keys(FORCED_OUTPUTS).find((key) => code.includes(key))
  return marker ? FORCED_OUTPUTS[marker] : null
}

mock.module("shiki", () => ({
  ...realExports,
  createHighlighter: async (
    ...args: Parameters<typeof realCreateHighlighter>
  ) => {
    const real = await realCreateHighlighter(...args)
    return new Proxy(real, {
      get(target, property, receiver) {
        if (property === "codeToHtml") {
          return (code: string, options: unknown) => {
            generatorCalls += 1
            if (code.includes("FORCE_THROW")) {
              throw new Error("forced Shiki generator exception")
            }
            return (
              forcedOutputFor(code) ?? target.codeToHtml(code, options as never)
            )
          }
        }
        const value = Reflect.get(target, property, receiver)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
  },
}))

const { act, createElement } = await import("react")
const { createRoot } = await import("react-dom/client")
const { I18nProvider } = await import("../src/renderer/lib/i18n")
const { MemoizedMarkdown } = await import(
  "../src/renderer/components/chat-markdown-renderer"
)
const { AgentMcpToolCall } = await import(
  "../src/renderer/features/agents/ui/agent-mcp-tool-call"
)
const { AgentEditTool } = await import(
  "../src/renderer/features/agents/ui/agent-edit-tool"
)
const { TooltipProvider } = await import(
  "../src/renderer/components/ui/tooltip"
)
const { MessageJsonDisplay } = await import(
  "../src/renderer/features/agents/ui/message-json-display"
)

type Root = ReturnType<typeof createRoot>
let mountedRoots: Root[] = []

afterEach(async () => {
  for (const root of mountedRoots) {
    await act(async () => root.unmount())
  }
  mountedRoots = []
  testWindow.document.body.replaceChildren()
})

const HOSTILE_TAIL =
  "</code></pre><img src=x onerror=window.__pwned=1><b>raw</b>"

/** Hostile source: markup-breaking characters plus a raw executable payload. */
function hostileSource(marker: string, consumerId: string): string {
  // Single line: AgentEditTool highlights each diff line separately, so the
  // forcing marker and the executable payload must share one line.
  // The consumer id keeps every source unique so highlightCode's result cache
  // never short-circuits the generator for a later consumer.
  return `const ${marker.toLowerCase()}_${consumerId} = 1 // ${marker} ${HOSTILE_TAIL}`
}

async function waitForGenerator(minCalls: number): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (generatorCalls >= minCalls) break
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
    })
  }
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60))
  })
}

async function mount(element: ReturnType<typeof createElement>) {
  const container = testWindow.document.createElement(
    "div",
  ) as unknown as HTMLElement
  testWindow.document.body.append(container as never)
  const root = createRoot(container)
  mountedRoots.push(root)
  await act(async () => {
    root.render(
      createElement(
        I18nProvider,
        null,
        createElement(TooltipProvider, null, element),
      ),
    )
  })
  return container
}

async function click(element: Element | null): Promise<void> {
  expect(element).not.toBeNull()
  await act(async () => {
    element?.dispatchEvent(
      new testWindow.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      }) as never,
    )
  })
}

type Consumer = {
  id: string
  name: string
  render: (source: string) => Promise<HTMLElement>
}

const CONSUMERS: Consumer[] = [
  {
    id: "fence",
    name: "chat/repository code fence (CodeBlock)",
    render: async (source) =>
      mount(
        createElement(MemoizedMarkdown, {
          content: `\`\`\`typescript\n${source}\n\`\`\`\n`,
          id: "shiki-hardening",
          isStreaming: false,
        }),
      ),
  },
  {
    id: "mcp",
    name: "MCP tool output (AgentMcpToolCall/HighlightedJson)",
    render: async (source) => {
      const container = await mount(
        createElement(AgentMcpToolCall, {
          part: {
            type: "tool-mcp__repo__read",
            toolCallId: "call-1",
            state: "output-available",
            input: { query: "readme" },
            output: source,
          },
          mcpInfo: {
            serverName: "repo",
            toolName: "read",
            displayName: "Read",
            category: "read",
          } as never,
          chatStatus: "ready",
        }),
      )
      await click(container.querySelector(".cursor-pointer"))
      return container
    },
  },
  {
    id: "edit",
    name: "tool output (AgentEditTool Write/DiffLineRow)",
    render: async (source) =>
      mount(
        createElement(AgentEditTool, {
          part: {
            type: "tool-Write",
            toolCallId: "call-2",
            state: "output-available",
            input: { file_path: "/repo/src/hostile.ts", content: source },
            output: {},
          },
          messageId: "message-1",
          partIndex: 0,
          chatStatus: "ready",
        } as never),
      ),
  },
  {
    id: "json",
    name: "message JSON (MessageJsonDisplay)",
    render: async (source) => {
      const container = await mount(
        createElement(MessageJsonDisplay, {
          message: { role: "assistant", text: source },
        }),
      )
      await click(container.querySelector("button"))
      return container
    },
  },
]

function fingerprint(container: HTMLElement) {
  return {
    oracleViolations: findExecutableMarkup(container as never, {
      kind: "highlighted-code",
    }),
    sourceMarkupElements: container.querySelectorAll("img, b").length,
    acceptedMalformedGeneratorOutput: Array.from(
      container.querySelectorAll("[data-shiki-forged]"),
    ).map((element) => element.getAttribute("data-shiki-forged")),
  }
}

const FAIL_CLOSED = {
  oracleViolations: [],
  sourceMarkupElements: 0,
  acceptedMalformedGeneratorOutput: [],
}

describe("Highlighted HTML reaches a raw insertion sink: hostile source stays non-executable (real Shiki)", () => {
  for (const consumer of CONSUMERS) {
    test(`[green-by-design] ${consumer.name}: markup-breaking source is escaped and fully preserved as text`, async () => {
      const source = hostileSource("REAL_SHIKI_PATH", consumer.id)
      const before = generatorCalls
      const container = await consumer.render(source)
      await waitForGenerator(before + 1)
      expect(generatorCalls).toBeGreaterThan(before)
      expect(fingerprint(container)).toEqual(FAIL_CLOSED)
      expect(container.textContent ?? "").toContain(HOSTILE_TAIL)
    })
  }
})

describe("Highlighted HTML extraction fails closed on output-shape failure (D3)", () => {
  const shapes: Array<[string, string]> = [
    ["forced extraction mismatch (no <code> wrapper)", "FORCE_NO_CODE_WRAPPER"],
    ["forced dual top-level <pre><code> output", "FORCE_DUAL_CODE"],
    ["forced trailing output after the wrapper", "FORCE_TRAILING_OUTPUT"],
  ]
  for (const consumer of CONSUMERS) {
    for (const [label, marker] of shapes) {
      test(`${consumer.name}: ${label} degrades to escaped text/bounded error/no render, never raw source or truncated generator markup`, async () => {
        const before = generatorCalls
        const container = await consumer.render(
          hostileSource(marker, consumer.id),
        )
        await waitForGenerator(before + 1)
        expect(generatorCalls).toBeGreaterThan(before)
        expect(fingerprint(container)).toEqual(FAIL_CLOSED)
      })
    }
  }
})

describe("Highlighted HTML generator exception never inserts the original source as HTML", () => {
  for (const consumer of CONSUMERS) {
    test(`[green-by-design] ${consumer.name}: forced generator exception`, async () => {
      const before = generatorCalls
      const container = await consumer.render(
        hostileSource("FORCE_THROW", consumer.id),
      )
      await waitForGenerator(before + 1)
      expect(generatorCalls).toBeGreaterThan(before)
      expect(fingerprint(container)).toEqual(FAIL_CLOSED)
    })
  }
})
