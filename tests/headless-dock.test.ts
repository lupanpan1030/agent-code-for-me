import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { hideDockForHeadlessCli } from "../src/main/lib/headless/dock"

const repoRoot = join(__dirname, "..")

describe("headless dock behavior", () => {
  test("hides the macOS Dock icon for headless CLI launches", () => {
    let hideCalls = 0
    hideDockForHeadlessCli(
      {
        dock: {
          hide() {
            hideCalls += 1
          },
        },
      },
      "darwin",
    )

    expect(hideCalls).toBe(1)
  })

  test("does not touch Dock APIs on non-macOS platforms", () => {
    let hideCalls = 0
    hideDockForHeadlessCli(
      {
        dock: {
          hide() {
            hideCalls += 1
          },
        },
      },
      "linux",
    )

    expect(hideCalls).toBe(0)
  })

  test("does not fail headless startup when Dock hiding throws", () => {
    const error = new Error("dock unavailable")
    const errors: unknown[] = []

    expect(() =>
      hideDockForHeadlessCli(
        {
          dock: {
            hide() {
              throw error
            },
          },
        },
        "darwin",
        (caught) => errors.push(caught),
      ),
    ).not.toThrow()
    expect(errors).toEqual([error])
  })

  test("wires Dock hiding before the headless app startup path", () => {
    const source = readFileSync(join(repoRoot, "src/main/index.ts"), "utf-8")
    const hideIndex = source.indexOf("hideDockForHeadlessCli(app)")
    const startupIndex = source.indexOf("app.whenReady().then(runHeadlessMain)")

    expect(hideIndex).toBeGreaterThan(-1)
    expect(startupIndex).toBeGreaterThan(-1)
    expect(hideIndex).toBeLessThan(startupIndex)
  })
})
