import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

mock.module("electron", () => ({
  ipcMain: {
    handle: mock(() => {}),
  },
}))

const { scanExtensionsDir } = await import(
  "../src/main/lib/vscode-theme-scanner"
)

describe("VS Code theme scanner", () => {
  let tempDir = ""

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "locus-vscode-themes-"))
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
    tempDir = ""
  })

  test("scans extension entries from an async readdir result", async () => {
    const extensionDir = join(tempDir, "publisher.theme-pack-1.0.0")
    const themesDir = join(extensionDir, "themes")
    await mkdir(themesDir, { recursive: true })
    await writeFile(
      join(extensionDir, "package.json"),
      JSON.stringify({
        name: "theme-pack",
        displayName: "Theme Pack",
        contributes: {
          themes: [
            {
              label: "Manifest Theme",
              uiTheme: "vs-dark",
              path: "./themes/dark.json",
            },
          ],
        },
      }),
      "utf-8",
    )
    await writeFile(
      join(themesDir, "dark.json"),
      `{
        // JSONC comments should be accepted.
        "name": "Actual Theme",
        "colors": {
          "editor.background": "#111111"
        },
      }`,
      "utf-8",
    )
    await writeFile(join(tempDir, "not-a-directory.txt"), "skip me", "utf-8")

    await expect(scanExtensionsDir(tempDir, "vscode")).resolves.toEqual([
      {
        id: "vscode-publisher-theme-pack-1-0-0-dark",
        name: "Actual Theme",
        type: "dark",
        extensionId: "publisher.theme-pack-1.0.0",
        extensionName: "Theme Pack",
        path: join(extensionDir, "./themes/dark.json"),
        source: "vscode",
      },
    ])
  })
})
