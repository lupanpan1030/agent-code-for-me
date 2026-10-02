/**
 * Implementer test for refactor-unified-runtime-route-catalog T3-2 (final
 * design review P3-1): the readiness Codex leg uses the native-only status
 * (login CLI + login probe) and codex.getRuntimeStatus keeps composing it
 * with the desktop route metadata, so the IPC shape (P30 adapters.selection)
 * is unchanged and readiness no longer reaches the route catalog.
 *
 * The app context points at a temp directory without a bundled Codex CLI,
 * so the login probe is the deterministic "blocked" branch and no native
 * process runs.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getCodexNativeRuntimeStatus } from "../src/main/lib/codex/native-runtime-status"
import { getCodexRuntimeStatus } from "../src/main/lib/codex/runtime-status"

const REPO_ROOT = join(import.meta.dir, "..")
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function appContextWithoutCli() {
  const root = mkdtempSync(join(tmpdir(), "locus-codex-native-status-"))
  roots.push(root)
  return { isPackaged: false, getAppPath: () => root }
}

describe("Codex native runtime status", () => {
  test("codex.getRuntimeStatus keeps its component order, adapters.selection and blockers while composing the native login CLI and login components", async () => {
    const appContext = appContextWithoutCli()
    const status = await getCodexRuntimeStatus({ appContext, env: {} })
    const native = await getCodexNativeRuntimeStatus({ appContext })

    expect(status.components.map((component) => component.id)).toEqual([
      "login-cli",
      "login",
      "adapter-source",
      "provider-profile",
      "mcp",
      "local-only",
    ])
    expect(status.adapters.selection).toEqual({
      source: "codex-app-server",
      useAppServer: true,
      reason: "Codex app-server is the only desktop chat adapter.",
    })
    expect(status.components.slice(0, 2)).toEqual(native.components)
    expect(native.components.map((component) => component.status)).toEqual([
      "missing",
      "blocked",
    ])
    expect({ ok: status.ok, blockers: status.blockers }).toEqual({
      ok: native.ok,
      blockers: native.blockers,
    })
    expect(native.loginCli).toEqual(status.loginCli)
    expect(Object.keys(native).sort()).toEqual([
      "blockers",
      "components",
      "loginCli",
      "ok",
      "runtime",
    ])
  })

  test("the readiness leaf imports the native status and neither it nor the native module imports runtime-status or the route catalog", () => {
    const read = (file: string) => readFileSync(join(REPO_ROOT, file), "utf8")
    const readiness = read("src/main/lib/headless/runtime-readiness.ts")
    const native = read("src/main/lib/codex/native-runtime-status.ts")
    expect(readiness).toContain('from "../codex/native-runtime-status"')
    expect(readiness).not.toContain('"../codex/runtime-status"')
    expect(native).not.toContain('"./runtime-status"')
    for (const source of [readiness, native]) {
      expect(source).not.toContain("runtime-route-catalog")
      expect(source).not.toContain("buildCodexAdapterRuntimeStatusMetadata")
    }
  })
})
