import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const CODEX_ROUTE_PATH = "src/main/lib/trpc/routers/codex.ts"

describe("Codex desktop service extraction boundary", () => {
  test("keeps durable desktop-run behavior out of the tRPC router", () => {
    const route = readFileSync(CODEX_ROUTE_PATH, "utf8")

    for (const forbidden of [
      "new Map<",
      "db.update(",
      "createCodexAppServerAdapter",
      "buildCodexAppServerAssistantMessage",
      "LOCUS_CODEX_APP_SERVER",
      "revokeProviderGatewayToken",
      "getProviderGatewayEndpoint",
    ]) {
      expect(route).not.toContain(forbidden)
    }
  })

  test("orchestrates the canonical desktop-run owners", () => {
    const route = readFileSync(CODEX_ROUTE_PATH, "utf8")

    for (const ownerCall of [
      "createCodexDesktopRunPreflightStage",
      "createCodexDesktopRunProviderBindingStage",
      "loadCodexDesktopRunHistory",
      "persistCodexDesktopRunUserMessage",
      "createCodexDesktopRunState",
      "createAndRegisterCodexDesktopRunJob",
      "runCodexAppServerDesktopAdapter",
      "finalizeCodexDesktopRunAfterLifecycle",
      "cleanupCodexDesktopRunSubscription",
    ]) {
      expect(route).toContain(ownerCall)
    }
  })

  test("keeps app-shell modules independent of the router", () => {
    for (const appShellPath of [
      "src/main/index.ts",
      "src/main/windows/main.ts",
    ]) {
      const source = readFileSync(appShellPath, "utf8")
      expect(source).not.toContain("trpc/routers/codex")
    }
  })
})
