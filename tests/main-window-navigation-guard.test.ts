import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { isAllowedMainWindowNavigationUrl } from "../src/main/windows/navigation-guard"

describe("main window navigation guard", () => {
  const prodIndexPath = join(process.cwd(), "out", "renderer", "index.html")

  test("allows the configured Vite dev server origin only in development", () => {
    expect(
      isAllowedMainWindowNavigationUrl("http://localhost:5173/chat?id=1", {
        devServerUrl: "http://localhost:5173",
        prodIndexPath,
      }),
    ).toBe(true)
    expect(
      isAllowedMainWindowNavigationUrl("http://127.0.0.1:5173/chat?id=1", {
        devServerUrl: "http://localhost:5173",
        prodIndexPath,
      }),
    ).toBe(false)
    expect(
      isAllowedMainWindowNavigationUrl("https://example.com/phish", {
        devServerUrl: "http://localhost:5173",
        prodIndexPath,
      }),
    ).toBe(false)
  })

  test("allows only the packaged renderer index file in production", () => {
    expect(
      isAllowedMainWindowNavigationUrl(
        `${pathToFileURL(prodIndexPath).toString()}#windowId=main`,
        { prodIndexPath },
      ),
    ).toBe(true)
    expect(
      isAllowedMainWindowNavigationUrl(
        pathToFileURL(join(process.cwd(), "out", "renderer", "other.html")).toString(),
        { prodIndexPath },
      ),
    ).toBe(false)
    expect(
      isAllowedMainWindowNavigationUrl("https://example.com/", {
        prodIndexPath,
      }),
    ).toBe(false)
  })
})
