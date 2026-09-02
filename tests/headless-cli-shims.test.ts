import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { buildWindowsCliWrapper } from "../src/main/lib/platform/windows"

const repoRoot = join(__dirname, "..")

describe("headless CLI shims", () => {
  test("macOS shim routes headless commands to Electron headless mode", () => {
    const source = readFileSync(join(repoRoot, "resources/cli/locus"), "utf-8")
    expect(source).toContain("--locus-headless-cli")
    expect(source).toContain('case "$COMMAND" in')
    expect(source).toContain(
      "run|jobs|api|daemon|schedules|schedule|jobs-stdio|version|--version|-v)",
    )

    const headlessSection = source.slice(
      source.indexOf(
        "run|jobs|api|daemon|schedules|schedule|jobs-stdio|version|--version|-v)",
      ),
      source.indexOf("open|gui)"),
    )
    expect(headlessSection).toContain("exec")
    expect(headlessSection).not.toContain("open -a")
    expect(source).toContain('echo "Unknown command: acp" >&2')
    expect(source).toContain("exit 2")
  })

  test("Windows shim routes headless commands synchronously without start", () => {
    const source = readFileSync(
      join(repoRoot, "resources/cli/locus.cmd"),
      "utf-8",
    )
    expect(source).toContain("--locus-headless-cli")
    expect(source).toContain('if "%COMMAND%"=="run"')
    expect(source).toContain('if "%COMMAND%"=="jobs"')
    expect(source).toContain('if "%COMMAND%"=="api"')
    expect(source).toContain('if "%COMMAND%"=="daemon"')
    expect(source).toContain('if "%COMMAND%"=="schedules"')
    expect(source).toContain('if "%COMMAND%"=="schedule"')
    expect(source).toContain('if "%COMMAND%"=="jobs-stdio"')
    expect(source).toContain('if "%COMMAND%"=="version"')
    expect(source).toContain('if "%COMMAND%"=="--version"')
    expect(source).toContain('if "%COMMAND%"=="-v"')
    expect(source).toContain('if "%COMMAND%"=="acp" goto retired_acp')
    expect(source).toContain("echo Unknown command: acp 1>&2")
    expect(source).toContain("exit /b 2")

    const headlessSection = source.slice(
      source.indexOf(":headless"),
      source.indexOf(":gui"),
    )
    expect(headlessSection).toContain('"%LOCUS_EXE%" --locus-headless-cli')
    expect(headlessSection.toLowerCase()).not.toContain("start ")
  })

  test("generated Windows wrapper routes jobs-stdio and rejects retired acp", () => {
    const source = buildWindowsCliWrapper("C:\\Program Files\\Locus\\Locus.exe")

    expect(source).toContain('if "%COMMAND%"=="jobs-stdio" goto headless')
    expect(source).toContain('if "%COMMAND%"=="acp" goto retired_acp')
    expect(source).toContain("echo Unknown command: acp 1>&2\r\nexit /b 2")
    expect(source).toContain(
      '"%LOCUS_HEADLESS_EXECUTABLE%" --locus-headless-cli %*',
    )
  })

  const posixTest = process.platform === "win32" ? test.skip : test

  posixTest("POSIX shim rejects retired acp before GUI dispatch", () => {
    const result = spawnSync(join(repoRoot, "resources/cli/locus"), ["acp"], {
      encoding: "utf8",
      env: { ...process.env, LOCUS_HEADLESS_EXECUTABLE: "/bin/echo" },
    })

    expect(result.status).toBe(2)
    expect(result.stdout).toBe("")
    expect(result.stderr.trim()).toBe("Unknown command: acp")
  })
})
