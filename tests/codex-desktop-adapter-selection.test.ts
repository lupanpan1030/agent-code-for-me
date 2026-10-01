import { describe, expect, test } from "bun:test"
import { listRuntimeRoutes } from "../src/main/lib/agent-runtime/runtime-route-catalog"
import { buildCodexAdapterRuntimeStatusMetadata } from "../src/main/lib/codex/runtime-status"

// refactor-unified-runtime-route-catalog (design D5, P08/P30): the Codex
// desktop selection wrapper is retired; codex.getRuntimeStatus projects the
// catalog's single Codex desktop route into its private adapters.selection
// shape and keeps the baseline hint text.
describe("Codex desktop adapter selection", () => {
  test("projects app-server as the only desktop chat adapter from the catalog", () => {
    const desktopRoutes = listRuntimeRoutes({
      runtimeId: "codex",
      entry: "desktop",
    })

    expect(desktopRoutes.map((route) => route.adapterSource)).toEqual([
      "codex-app-server",
    ])
    expect(buildCodexAdapterRuntimeStatusMetadata({}).selection).toEqual({
      source: "codex-app-server",
      useAppServer: true,
      reason: "Codex app-server is the only desktop chat adapter.",
    })
  })

  test("ignores adapter-selection env input", () => {
    expect(
      buildCodexAdapterRuntimeStatusMetadata({
        env: {
          ANY_LEGACY_ADAPTER_ENV: "0",
          ANY_ROLLBACK_ADAPTER_ENV: "1",
        },
      }).selection,
    ).toMatchObject({
      source: "codex-app-server",
      useAppServer: true,
    })
  })
})
