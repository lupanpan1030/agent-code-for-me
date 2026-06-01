import { describe, expect, test } from "bun:test"
import {
  buildCodexRuntimeCapabilityErrorChunk,
  getCodexRunRequiredCapability,
  getCodexRuntimeCapabilities,
  getCodexRuntimeCapability,
  type CodexRuntimeCapabilityId,
} from "../src/shared/codex-runtime-capabilities"

const expectedCapabilityIds: CodexRuntimeCapabilityId[] = [
  "hardToolGuard",
  "planMode",
  "scopeExpansion",
  "askUserQuestion",
  "rollback",
  "mcpAuth",
  "mcpConfiguration",
  "providerProfiles",
  "attachments",
  "usageMetadata",
  "runtimePlugins",
  "runtimeCommands",
  "runtimeWorkflows",
  "appAgents",
]

describe("Codex runtime capabilities", () => {
  test("declares every parity-owned capability explicitly", () => {
    const capabilities = getCodexRuntimeCapabilities()

    expect(capabilities.map((capability) => capability.id)).toEqual(
      expectedCapabilityIds,
    )
    expect(
      capabilities.every((capability) => capability.reason.trim().length > 0),
    ).toBe(true)
  })

  test("marks implemented core safety capabilities supported through ACP permission enforcement", () => {
    expect(getCodexRuntimeCapability("hardToolGuard")).toMatchObject({
      status: "supported",
    })
    expect(getCodexRuntimeCapability("planMode")).toMatchObject({
      status: "supported",
    })
    expect(getCodexRuntimeCapability("scopeExpansion")).toMatchObject({
      status: "supported",
    })
  })

  test("builds non-secret capability error chunks for fail-closed guarded runs", () => {
    const capability = getCodexRuntimeCapability("hardToolGuard")
    const chunk = buildCodexRuntimeCapabilityErrorChunk({
      capability,
      message:
        "Codex guarded runs are blocked because ACP permission enforcement is unavailable.",
    })

    expect(chunk).toMatchObject({
      type: "capability-error",
      runtime: "codex",
      capability: "hardToolGuard",
      blocker: {
        capability: "hardToolGuard",
        status: "supported",
      },
    })
    expect(chunk.errorText).toContain("Codex guarded runs are blocked")
    expect(chunk.errorText).not.toContain("sk-")
    expect(JSON.stringify(chunk)).not.toContain("access_token")
  })

  test("identifies run modes that require ACP permission enforcement", () => {
    expect(
      getCodexRunRequiredCapability({
        mode: "agent",
        hasScopeContract: false,
      }),
    ).toBeNull()
    expect(
      getCodexRunRequiredCapability({
        mode: "agent",
        hasScopeContract: true,
      }),
    ).toMatchObject({ id: "hardToolGuard", status: "supported" })
    expect(
      getCodexRunRequiredCapability({
        mode: "plan",
        hasScopeContract: false,
      }),
    ).toMatchObject({ id: "planMode", status: "supported" })
  })
})
