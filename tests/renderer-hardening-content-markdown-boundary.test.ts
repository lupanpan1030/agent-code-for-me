/**
 * Test-first suite (Domain A) for design D2's app-owned markdown error
 * boundary: "The app markdown pipeline throws while rendering untrusted
 * content" (runtime-security-baseline delta).
 *
 * A forced-throw plugin fixture is installed by replacing the `remark-breaks`
 * module that both app Streamdown mounts pass in their remark chain (design D2
 * parity: GFM + breaks). Nothing under test is mocked: the real app
 * components, the real Streamdown and the real rehype chain run; only the
 * plugin is forced to throw while the pipeline transforms untrusted content.
 *
 * Separate file because `mock.module` is file-scoped under `--isolate`.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  findExecutableMarkup,
  installHappyDom,
} from "./renderer-hardening-content-oracle"

const testWindow = installHappyDom()

const FORCED_FAILURE = "forced remark-breaks plugin failure"

mock.module("remark-breaks", () => ({
  default: () => () => {
    throw new Error(FORCED_FAILURE)
  },
}))

const { act, createElement } = await import("react")
const { createRoot } = await import("react-dom/client")
const { I18nProvider } = await import("../src/renderer/lib/i18n")
const { ChatMarkdownRenderer, MemoizedMarkdown } = await import(
  "../src/renderer/components/chat-markdown-renderer"
)

type Root = ReturnType<typeof createRoot>

const HOSTILE_SOURCE =
  'Report <img src=x onerror="window.__pwned = 1"> and <a href="javascript:window.__pwned=1">run</a> end'

let mountedRoots: Root[] = []

afterEach(async () => {
  for (const root of mountedRoots) {
    await act(async () => root.unmount())
  }
  mountedRoots = []
  testWindow.document.body.replaceChildren()
})

async function renderInsideChatView(mount: "static" | "streaming") {
  const uncaughtErrors: string[] = []
  const container = testWindow.document.createElement(
    "div",
  ) as unknown as HTMLElement
  testWindow.document.body.append(container as never)
  const root = createRoot(container, {
    onUncaughtError: (error) => {
      uncaughtErrors.push(String((error as Error)?.message ?? error))
    },
  })
  mountedRoots.push(root)
  const markdown =
    mount === "static"
      ? createElement(MemoizedMarkdown, {
          content: HOSTILE_SOURCE,
          id: "boundary-message",
          isStreaming: false,
        })
      : createElement(ChatMarkdownRenderer, {
          content: HOSTILE_SOURCE,
          isStreaming: true,
        })
  // The render must settle without an error escaping the app boundary; on the
  // baseline the forced throw propagates out of the root (no boundary).
  const renderOutcome = await Promise.resolve(
    act(async () => {
      root.render(
        createElement(
          I18nProvider,
          null,
          createElement(
            "section",
            { "data-testid": "chat-view" },
            createElement("header", { "data-testid": "chat-header" }, "Chat"),
            createElement("article", { "data-testid": "message" }, markdown),
          ),
        ),
      )
    }),
  ).then(
    () => "settled",
    (error: Error) => `escaped the app boundary: ${error.message}`,
  )
  expect(renderOutcome).toBe("settled")
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40))
  })
  return { container, uncaughtErrors }
}

describe("The app markdown pipeline throws while rendering untrusted content", () => {
  for (const mount of ["static", "streaming"] as const) {
    test(`${mount} mount: a forced plugin throw is contained by the app-owned boundary and renders the source as escaped text without unmounting the chat view`, async () => {
      const { container, uncaughtErrors } = await renderInsideChatView(mount)
      expect(uncaughtErrors).toEqual([])
      expect(
        container.querySelector('[data-testid="chat-header"]')?.textContent,
      ).toBe("Chat")
      const message = container.querySelector('[data-testid="message"]')
      expect(message).not.toBeNull()
      expect(message?.textContent ?? "").toContain(HOSTILE_SOURCE)
      expect(message?.querySelectorAll("img, a, script").length).toBe(0)
      expect(
        findExecutableMarkup(container as never, { kind: "markdown" }),
      ).toEqual([])
    })
  }
})
