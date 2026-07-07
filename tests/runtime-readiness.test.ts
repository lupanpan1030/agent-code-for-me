import { beforeEach, describe, expect, test } from "bun:test"
import {
  clearRuntimeReadinessCacheForTest,
  resolveLocalJobApiRuntimeReadiness,
} from "../src/main/lib/headless/runtime-readiness"
import type { RuntimeExecutableStatus } from "../src/main/lib/runtime-executable"

function executableStatus(
  ok: boolean,
  overrides: Partial<RuntimeExecutableStatus> = {},
): RuntimeExecutableStatus {
  return {
    ok,
    path: ok ? "/tmp/codex" : "/missing/codex",
    exists: ok,
    isExecutable: ok,
    error: ok ? null : "Runtime executable was not found.",
    hint: "Restore the bundled runtime.",
    ...overrides,
  }
}

function codexStatus(
  loginStatus: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    components: [
      {
        id: "login-cli",
        status: "ready",
        error: null,
        hint: null,
      },
      {
        id: "login",
        status: loginStatus,
        error: null,
        hint: null,
        ...overrides,
      },
    ],
  }
}

describe("Local Job API runtime readiness", () => {
  beforeEach(() => {
    clearRuntimeReadinessCacheForTest()
  })

  test("reports Claude ready from the app credential source first", async () => {
    const readiness = await resolveLocalJobApiRuntimeReadiness({
      runtimeId: "claude-code",
      dependencies: {
        hasAnyClaudeCodeAccount: () => true,
        getClaudeCodeCredentialMetadata: () => ({ isConnected: true }),
        getExistingClaudeCredentials: () => {
          throw new Error("CLI credential fallback should not be checked")
        },
      },
    })

    expect(readiness).toMatchObject({
      state: "ready",
      detail: "Locus desktop Claude credential is available.",
    })
  })

  test("reports Claude ready from CLI login when no app account exists", async () => {
    const readiness = await resolveLocalJobApiRuntimeReadiness({
      runtimeId: "claude-code",
      dependencies: {
        hasAnyClaudeCodeAccount: () => false,
        getExistingClaudeCredentials: () => ({
          accessToken: "external-access-token",
        }),
      },
    })

    expect(readiness.state).toBe("ready")
    expect(JSON.stringify(readiness)).not.toContain("external-access-token")
  })

  test("reports Claude needs-auth when neither credential source exists", async () => {
    const readiness = await resolveLocalJobApiRuntimeReadiness({
      runtimeId: "claude-code",
      dependencies: {
        hasAnyClaudeCodeAccount: () => false,
        getExistingClaudeCredentials: () => null,
      },
    })

    expect(readiness.state).toBe("needs-auth")
    expect(readiness.hint).toContain("Locus desktop")
    expect(readiness.hint).toContain("claude CLI")
  })

  test("maps Codex CLI and login readiness states", async () => {
    await expect(
      resolveLocalJobApiRuntimeReadiness({
        runtimeId: "codex",
        dependencies: {
          getCodexExecutableStatus: () => executableStatus(false),
          getCodexRuntimeStatus: async () => {
            throw new Error("probe should not run when CLI is missing")
          },
        },
      }),
    ).resolves.toMatchObject({ state: "unavailable" })

    clearRuntimeReadinessCacheForTest()
    await expect(
      resolveLocalJobApiRuntimeReadiness({
        runtimeId: "codex",
        dependencies: {
          getCodexExecutableStatus: () => executableStatus(true),
          getCodexRuntimeStatus: async () => codexStatus("ready"),
        },
      }),
    ).resolves.toMatchObject({ state: "ready" })

    clearRuntimeReadinessCacheForTest()
    await expect(
      resolveLocalJobApiRuntimeReadiness({
        runtimeId: "codex",
        dependencies: {
          getCodexExecutableStatus: () => executableStatus(true),
          getCodexRuntimeStatus: async () =>
            codexStatus("needs-auth", {
              error: "Codex login is required.",
              hint: "Connect Codex.",
            }),
        },
      }),
    ).resolves.toMatchObject({
      state: "needs-auth",
      hint: "Connect Codex.",
    })
  })

  test("degrades Codex probe failures to unknown with a diagnostic", async () => {
    const diagnostics: string[] = []
    const readiness = await resolveLocalJobApiRuntimeReadiness({
      runtimeId: "codex",
      onDiagnostic: (message) => diagnostics.push(message),
      dependencies: {
        getCodexExecutableStatus: () => executableStatus(true),
        getCodexRuntimeStatus: async () => {
          throw new Error("probe failed with sk-sensitive-token")
        },
      },
    })

    expect(readiness.state).toBe("unknown")
    expect(diagnostics).toEqual([
      "[local-job-api] Runtime readiness for codex is unknown; resolver failed.",
    ])
    expect(JSON.stringify(readiness)).not.toContain("sk-sensitive-token")
    expect(JSON.stringify(diagnostics)).not.toContain("sk-sensitive-token")
  })

  test("no-probe skips Codex subprocess probes while keeping cheap checks", async () => {
    let executableChecks = 0
    let probes = 0
    const readiness = await resolveLocalJobApiRuntimeReadiness({
      runtimeId: "codex",
      probe: false,
      dependencies: {
        getCodexExecutableStatus: () => {
          executableChecks += 1
          return executableStatus(true)
        },
        getCodexRuntimeStatus: async () => {
          probes += 1
          return codexStatus("ready")
        },
      },
    })

    expect(readiness.state).toBe("unknown")
    expect(executableChecks).toBe(1)
    expect(probes).toBe(0)
  })

  test("caches Codex probe results for thirty seconds", async () => {
    let now = 10_000
    let probes = 0
    const dependencies = {
      getCodexExecutableStatus: () => executableStatus(true),
      getCodexRuntimeStatus: async () => {
        probes += 1
        return probes === 1 ? codexStatus("ready") : codexStatus("needs-auth")
      },
      now: () => now,
    }

    await expect(
      resolveLocalJobApiRuntimeReadiness({
        runtimeId: "codex",
        dependencies,
      }),
    ).resolves.toMatchObject({ state: "ready" })
    await expect(
      resolveLocalJobApiRuntimeReadiness({
        runtimeId: "codex",
        dependencies,
      }),
    ).resolves.toMatchObject({ state: "ready" })
    expect(probes).toBe(1)

    now += 30_001
    await expect(
      resolveLocalJobApiRuntimeReadiness({
        runtimeId: "codex",
        dependencies,
      }),
    ).resolves.toMatchObject({ state: "needs-auth" })
    expect(probes).toBe(2)
  })

  test("secret-looking readiness text is replaced by unknown", async () => {
    const readiness = await resolveLocalJobApiRuntimeReadiness({
      runtimeId: "codex",
      dependencies: {
        getCodexExecutableStatus: () => executableStatus(true),
        getCodexRuntimeStatus: async () =>
          codexStatus("needs-auth", {
            error: "Codex token sk-sensitive-token-1234567890 leaked",
          }),
      },
    })

    expect(readiness.state).toBe("unknown")
    expect(JSON.stringify(readiness)).not.toContain("sk-sensitive-token")
  })
})
