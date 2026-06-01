import { describe, expect, test } from "bun:test"
import {
  buildCodexUnsupportedCapabilityErrorChunk,
  getCodexRunBlockingCapability,
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

  test("does not mark core safety capabilities supported without pre-execution enforcement", () => {
    expect(getCodexRuntimeCapability("hardToolGuard")).toMatchObject({
      status: "unsupported",
    })
    expect(getCodexRuntimeCapability("planMode")).toMatchObject({
      status: "unsupported",
    })
    expect(getCodexRuntimeCapability("scopeExpansion")).toMatchObject({
      status: "unsupported",
    })
  })

  test("builds non-secret capability error chunks for blocked guarded runs", () => {
    const capability = getCodexRuntimeCapability("hardToolGuard")
    const chunk = buildCodexUnsupportedCapabilityErrorChunk({
      capability,
      message:
        "Codex guarded runs are blocked because Codex hard tool guard is not enforced before tool execution.",
    })

    expect(chunk).toMatchObject({
      type: "capability-error",
      runtime: "codex",
      capability: "hardToolGuard",
      blocker: {
        capability: "hardToolGuard",
        status: "unsupported",
      },
    })
    expect(chunk.errorText).toContain("Codex guarded runs are blocked")
    expect(chunk.errorText).not.toContain("sk-")
    expect(JSON.stringify(chunk)).not.toContain("access_token")
  })

  test("blocks Codex run modes that would imply unsupported safety enforcement", () => {
    expect(
      getCodexRunBlockingCapability({
        mode: "agent",
        hasScopeContract: false,
      }),
    ).toBeNull()
    expect(
      getCodexRunBlockingCapability({
        mode: "agent",
        hasScopeContract: true,
      }),
    ).toMatchObject({ id: "hardToolGuard", status: "unsupported" })
    expect(
      getCodexRunBlockingCapability({
        mode: "plan",
        hasScopeContract: false,
      }),
    ).toMatchObject({ id: "planMode", status: "unsupported" })
  })
})
