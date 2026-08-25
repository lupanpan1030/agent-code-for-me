import { describe, expect, test } from "bun:test"
import {
  type CodexDesktopRunPreflightDependencies,
  createCodexDesktopRunPreflightStage,
} from "../src/main/lib/codex/desktop-run-preflight"
import { createCodexRuntimeBlocker } from "../src/shared/codex-runtime-status"

function createHarness(
  dependencyOverrides: Partial<CodexDesktopRunPreflightDependencies> = {},
) {
  const events: Array<Record<string, unknown> | "complete"> = []
  const stage = createCodexDesktopRunPreflightStage({
    emit: (chunk) => events.push(chunk),
    complete: () => events.push("complete"),
    dependencies: {
      assertOfficialCloudAllowed: () => {},
      getRuntimeStatus: async () => ({ ok: true, blockers: [] }),
      ...dependencyOverrides,
    },
  })

  return { events, stage }
}

describe("Codex desktop run preflight stage", () => {
  test("emits an auth blocker and completes in the renderer-visible order", () => {
    const { events, stage } = createHarness()

    stage.emitPreflightBlocker({
      id: "provider-profile",
      status: "needs-auth",
      message: "Saved Codex API key is required.",
      hint: "Save a Codex API key again from onboarding or Settings > Models.",
    })

    expect(events).toEqual([
      {
        type: "auth-error",
        errorText:
          "Saved Codex API key is required. Save a Codex API key again from onboarding or Settings > Models.",
      },
      { type: "finish" },
      "complete",
    ])
  })

  test("passes a ready runtime without emitting or completing", async () => {
    const { events, stage } = createHarness()

    expect(await stage.verifyRuntimeStatus()).toBe(true)
    expect(events).toEqual([])
  })

  test("emits runtime status before error, finish, and completion", async () => {
    const blocker = createCodexRuntimeBlocker({
      id: "login-cli",
      label: "Codex CLI",
      status: "missing",
      ok: false,
      message: "Runtime executable was not found.",
      hint: "Install the bundled Codex CLI.",
    })
    const { events, stage } = createHarness({
      getRuntimeStatus: async () => ({ ok: false, blockers: [blocker] }),
    })

    expect(await stage.verifyRuntimeStatus()).toBe(false)
    expect(events).toEqual([
      {
        type: "runtime-status",
        runtime: "codex",
        ok: false,
        blocker,
      },
      {
        type: "error",
        errorText:
          "Runtime executable was not found. Install the bundled Codex CLI.",
      },
      { type: "finish" },
      "complete",
    ])
  })

  test("emits the local-only status and capability chunks before terminating", () => {
    const message =
      "Official cloud access is disabled: use Codex provider endpoint (https://api.openai.com)"
    const { events, stage } = createHarness({
      assertOfficialCloudAllowed: () => {
        throw new Error(message)
      },
    })

    expect(
      stage.emitLocalOnlyPreflightBlocker(
        "use Codex provider endpoint",
        "https://api.openai.com",
      ),
    ).toBe(true)
    expect(
      events.map((event) => (event === "complete" ? event : event.type)),
    ).toEqual([
      "runtime-status",
      "capability-error",
      "error",
      "finish",
      "complete",
    ])
    expect(events[2]).toEqual({
      type: "error",
      errorText: `${message} Choose a user-configured provider endpoint that is not an official upstream hosted URL, or explicitly disable local-only mode for hosted/internal testing.`,
    })
  })

  test("allows non-official endpoints without emitting or completing", () => {
    const { events, stage } = createHarness()

    expect(
      stage.emitLocalOnlyPreflightBlocker(
        "use Codex provider endpoint",
        "http://localhost:8080",
      ),
    ).toBe(false)
    expect(events).toEqual([])
  })
})
