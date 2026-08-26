import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(path, "utf8")

const EDITOR =
  "src/renderer/features/agents/components/provider-profile-editor.tsx"
const API_KEY_ACTION =
  "src/renderer/features/onboarding/components/panels/provider-profile-action.tsx"
const AI_PATH_PANEL =
  "src/renderer/features/onboarding/components/ai-path-panel.tsx"

describe("provider profile onboarding", () => {
  test("first-run Anthropic API key saves a Provider Profile", () => {
    const source = read(API_KEY_ACTION)
    expect(source).toContain("trpc.providerProfiles.saveProfile.useMutation")
    expect(source).toContain("providerProfileSource(profile.id)")
    expect(source).toContain("setLastSelectedClaudeSelectionAtom")
    expect(source).toContain("setLastSelectedClaudeSelection({")
    expect(source).toContain("modelId: profile.defaultModel")
    expect(source).not.toContain("lastSelectedClaudeModelSourceAtom")
    expect(source).not.toContain("lastSelectedModelIdAtom")
    expect(source).toContain("onboarding.apiKey.alreadyConnected")
    expect(source).toContain("config?.credentialUsable")
    expect(source).toContain("profile.credentialUsable")
    expect(source).not.toContain("config?.hasToken")
    expect(source).toContain("disabled={!canSubmit}")
    expect(source).not.toContain("setTimeout(")
    expect(source).not.toContain("claudeProviderConfig.save")
    expect(source).not.toContain(
      'setLastSelectedClaudeModelSource("custom-provider")',
    )
    expect(source.indexOf("setLastSelectedClaudeSelection({")).toBeLessThan(
      source.indexOf("providerProfiles.listProfiles.invalidate()"),
    )
  })

  test("setup and helper readiness use authoritative credential usability", () => {
    const setupStatus = read(
      "src/renderer/features/onboarding/lib/use-setup-status.ts",
    )
    const agentsLayout = read("src/renderer/features/layout/agents-layout.tsx")

    expect(setupStatus).toContain(
      "secureProviderConfig.data?.config?.credentialUsable",
    )
    expect(setupStatus).not.toContain(
      "secureProviderConfig.data?.config?.hasToken",
    )
    expect(agentsLayout).toContain("config?.credentialUsable")
    expect(agentsLayout).not.toContain("config?.hasToken")
  })

  test("custom provider onboarding reuses the shared Provider Profile editor", () => {
    const panel = read(AI_PATH_PANEL)
    expect(panel).toContain("ProviderProfileEditor")
    expect(panel).toContain("setLastSelectedClaudeSelectionAtom")
    expect(panel).toContain("setLastSelectedCodexSelectionAtom")
    expect(panel).toContain("setLastSelectedClaudeSelection({")
    expect(panel).toContain("setLastSelectedCodexSelection({")
    expect(panel).toContain("thinkingLevel: lastSelectedCodexThinking")
    expect(panel).not.toContain("lastSelectedClaudeModelSourceAtom")
    expect(panel).not.toContain("lastSelectedCodexModelSourceAtom")
    expect(panel).toContain('profile.targetRuntimes.includes("codex")')

    const editor = read(EDITOR)
    expect(editor).toContain("trpc.providerProfiles.saveProfile.useMutation")
    // The chosen protocol is saved — not hardcoded to anthropic like the old form.
    expect(editor).toContain("providerProfileProtocols")
    expect(editor).not.toContain('protocol: "anthropic"')
    // The preset list (the multi-API setup) is surfaced.
    expect(editor).toContain("listPresets")
    expect(editor).toContain("applyPreset")
    expect(editor.indexOf("onSaved?.(profile)")).toBeLessThan(
      editor.indexOf("providerProfiles.listProfiles.invalidate()"),
    )
  })

  test("shared editor keeps the Provider Profile boundary and supports no-auth", () => {
    const editor = read(EDITOR)
    expect(editor).toContain("providerProfileAuthModes")
    expect(editor).toContain('authMode === "none"')
    // Never restores the legacy plaintext config or a durable custom-provider source.
    expect(editor).not.toContain("claudeProviderConfig")
    expect(editor).not.toContain('"custom-provider"')
  })
})
