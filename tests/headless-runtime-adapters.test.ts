import { describe, expect, mock, test } from "bun:test"
import { readFileSync } from "node:fs"
import type { CreateAgentRuntimeRunRequestInput } from "../src/main/lib/headless/agent-runtime-contract"

mock.module("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath() {
      return process.cwd()
    },
  },
}))

const { __testClaudeCodeHeadless } = await import(
  "../src/main/lib/headless/adapters/claude-code"
)
const { __testCodexHeadless } = await import(
  "../src/main/lib/headless/adapters/codex"
)
const { buildClaudeEnv, clearClaudeEnvCache } = await import(
  "../src/main/lib/claude/env"
)
const { createAgentRuntimeRunRequest } = await import(
  "../src/main/lib/headless/agent-runtime-contract"
)

const baseInput = {
  jobId: "job_123",
  runtime: "claude-code" as const,
  cwd: "/tmp/project",
  mode: "agent" as const,
  source: "cli" as const,
  prompt: "Do the smallest useful thing",
  signal: new AbortController().signal,
} satisfies CreateAgentRuntimeRunRequestInput

function request(overrides: Partial<CreateAgentRuntimeRunRequestInput> = {}) {
  return createAgentRuntimeRunRequest({
    ...baseInput,
    ...overrides,
  })
}

describe("headless runtime adapters", () => {
  test("Claude adapter uses non-interactive print mode and plan permissions", () => {
    const planRequest = request({ mode: "plan" })
    const args = __testClaudeCodeHeadless.buildClaudeArgs(planRequest)
    expect(args).toContain("-p")
    expect(args).toContain("--no-session-persistence")
    expect(args).toContain("--permission-mode")
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("plan")
    expect(args[args.length - 2]).toBe("--")
    expect(args.at(-1)).toBe(planRequest.prompt)
  })

  test("headless adapters place dash-prefixed prompts after end-of-options", () => {
    const claudeRequest = request({
      mode: "plan",
      prompt: "--dangerously-skip-permissions",
    })
    const claudeArgs = __testClaudeCodeHeadless.buildClaudeArgs(claudeRequest)
    const claudePromptIndex = claudeArgs.indexOf(claudeRequest.prompt)
    const claudeSeparatorIndex = claudeArgs.lastIndexOf("--")
    expect(claudeSeparatorIndex).toBeGreaterThan(
      claudeArgs.indexOf("--permission-mode"),
    )
    expect(claudePromptIndex).toBe(claudeSeparatorIndex + 1)
    expect(claudeArgs[claudeArgs.indexOf("--permission-mode") + 1]).toBe("plan")

    const codexRequest = request({
      runtime: "codex",
      mode: "plan",
      prompt: "--dangerously-bypass-approvals-and-sandbox",
    })
    const codexArgs = __testCodexHeadless.buildCodexArgs(codexRequest)
    const codexPromptIndex = codexArgs.indexOf(codexRequest.prompt)
    const codexSeparatorIndex = codexArgs.lastIndexOf("--")
    expect(codexSeparatorIndex).toBeGreaterThan(codexArgs.indexOf("--sandbox"))
    expect(codexPromptIndex).toBe(codexSeparatorIndex + 1)
    expect(codexArgs[codexArgs.indexOf("--sandbox") + 1]).toBe("read-only")
  })

  test("Claude adapter uses acceptEdits for basic agent runs", () => {
    const args = __testClaudeCodeHeadless.buildClaudeArgs(request())
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("acceptEdits")
  })

  test("Claude env strips inherited Anthropic auth unless explicit provider env is supplied", () => {
    const previous = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
    }
    try {
      process.env.ANTHROPIC_API_KEY = "stale-api-key"
      process.env.ANTHROPIC_AUTH_TOKEN = "stale-auth-token"
      process.env.ANTHROPIC_BASE_URL = "https://stale.example.com?token=secret"
      clearClaudeEnvCache()

      const inherited = buildClaudeEnv()
      expect(inherited.ANTHROPIC_API_KEY).toBeUndefined()
      expect(inherited.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
      expect(inherited.ANTHROPIC_BASE_URL).toBeUndefined()

      const explicit = buildClaudeEnv({
        customEnv: {
          ANTHROPIC_AUTH_TOKEN: "provider-token",
          ANTHROPIC_BASE_URL: "https://provider.example.com",
        },
      })
      expect(explicit.ANTHROPIC_AUTH_TOKEN).toBe("provider-token")
      expect(explicit.ANTHROPIC_BASE_URL).toBe("https://provider.example.com")
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
      clearClaudeEnvCache()
    }
  })

  test("Claude headless env injects the app-store token and keeps inherited provider env stripped", async () => {
    const previous = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
      CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
    }
    const warnings: string[] = []
    try {
      process.env.ANTHROPIC_API_KEY = "stale-api-key"
      process.env.ANTHROPIC_AUTH_TOKEN = "stale-auth-token"
      process.env.ANTHROPIC_BASE_URL = "https://stale.example.com"
      process.env.CLAUDE_CODE_OAUTH_TOKEN = "stale-env-token"
      clearClaudeEnvCache()

      const env = await __testClaudeCodeHeadless.buildClaudeRuntimeEnv({
        jobId: "job_123",
        dependencies: {
          hasAnyAccount: () => true,
          getValidCredential: async () => ({
            accessToken: "app-store-token",
          }),
          getClaudeConfigDir: () => "/tmp/locus-test-home/.claude",
          warn: (message) => warnings.push(message),
        },
      })

      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("app-store-token")
      expect(env.CLAUDE_CONFIG_DIR).toBe("/tmp/locus-test-home/.claude")
      expect(env.LOCUS_HEADLESS_JOB_ID).toBe("job_123")
      expect(env.ANTHROPIC_API_KEY).toBeUndefined()
      expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
      expect(JSON.stringify(env)).not.toContain("stale-env-token")
      expect(warnings).toEqual([])
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
      clearClaudeEnvCache()
    }
  })

  test("Claude provider profile runs use gateway auth without app token injection", async () => {
    let queriedAppAccount = false
    const providerRequest = request({
      providerBinding: {
        model: "claude-sonnet-4-5",
        modelSource: "provider-profile:claude-main",
        providerProfileId: "claude-main",
        providerProfileName: "Claude Main",
        gatewayEndpoint:
          "http://127.0.0.1:1234/profile/claude-main/anthropic/v1",
        gatewayToken: "gateway-token",
        authMode: "provider-profile",
      },
    })
    const args = __testClaudeCodeHeadless.buildClaudeArgs(providerRequest)
    expect(
      args.slice(args.indexOf("--model"), args.indexOf("--model") + 2),
    ).toEqual(["--model", "claude-sonnet-4-5"])

    const env = await __testClaudeCodeHeadless.buildClaudeRuntimeEnv({
      request: providerRequest,
      dependencies: {
        buildEnv: (options) => ({
          PATH: "/usr/bin",
          CLAUDE_CODE_OAUTH_TOKEN: "stale-env-token",
          ...(options?.customEnv ?? {}),
        }),
        hasAnyAccount: () => {
          queriedAppAccount = true
          return true
        },
        getValidCredential: async () => ({ accessToken: "app-store-token" }),
        getClaudeConfigDir: () => "/tmp/locus-test-home/.claude",
        warn: () => {},
      },
    })

    expect(queriedAppAccount).toBe(false)
    expect(env.ANTHROPIC_BASE_URL).toBe(
      "http://127.0.0.1:1234/profile/claude-main/anthropic/v1",
    )
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("gateway-token")
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(env.LOCUS_HEADLESS_JOB_ID).toBe("job_123")
  })

  test("Claude headless env falls back to CLI login when no app account exists", async () => {
    const warnings: string[] = []
    const env = await __testClaudeCodeHeadless.buildClaudeRuntimeEnv({
      jobId: "job_123",
      dependencies: {
        buildEnv: () => ({
          PATH: "/usr/bin",
          CLAUDE_CONFIG_DIR: "/tmp/custom-claude-config",
          CLAUDE_CODE_OAUTH_TOKEN: "stale-env-token",
        }),
        hasAnyAccount: () => false,
        getValidCredential: async () => {
          throw new Error("should not resolve without an app account")
        },
        warn: (message) => warnings.push(message),
      },
    })

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(env.CLAUDE_CONFIG_DIR).toBe("/tmp/custom-claude-config")
    expect(env.LOCUS_HEADLESS_JOB_ID).toBe("job_123")
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("Ignored inherited CLAUDE_CODE_OAUTH_TOKEN")
  })

  test("Claude headless env falls back when app credential resolution fails", async () => {
    const warnings: string[] = []
    const env = await __testClaudeCodeHeadless.buildClaudeRuntimeEnv({
      jobId: "job_123",
      dependencies: {
        buildEnv: () => ({ PATH: "/usr/bin" }),
        hasAnyAccount: () => true,
        getValidCredential: async () => {
          throw new Error("refresh failed for sensitive-refresh-token")
        },
        getClaudeConfigDir: () => "/tmp/locus-test-home/.claude",
        warn: (message) => warnings.push(message),
      },
    })

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(env.CLAUDE_CONFIG_DIR).toBe("/tmp/locus-test-home/.claude")
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("falling back to Claude CLI login")
    expect(warnings[0]).not.toContain("sensitive-refresh-token")
  })

  test("Claude headless env falls back when app credential resolves without an access token", async () => {
    const warnings: string[] = []
    const env = await __testClaudeCodeHeadless.buildClaudeRuntimeEnv({
      jobId: "job_123",
      dependencies: {
        buildEnv: () => ({ PATH: "/usr/bin" }),
        hasAnyAccount: () => true,
        getValidCredential: async () => ({ accessToken: null }),
        getClaudeConfigDir: () => "/tmp/locus-test-home/.claude",
        warn: (message) => warnings.push(message),
      },
    })

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(warnings).toEqual([
      expect.stringContaining("falling back to Claude CLI login"),
    ])
  })

  test("Claude headless env defaults to the CLI config directory", async () => {
    const env = await __testClaudeCodeHeadless.buildClaudeRuntimeEnv({
      jobId: "job_123",
      dependencies: {
        buildEnv: () => ({ PATH: "/usr/bin" }),
        hasAnyAccount: () => false,
        warn: () => {},
      },
    })

    expect(env.CLAUDE_CONFIG_DIR).toBe(
      __testClaudeCodeHeadless.getDefaultClaudeConfigDir(),
    )
  })

  test("Codex adapter maps plan to read-only and agent to workspace-write", () => {
    const planArgs = __testCodexHeadless.buildCodexArgs(
      request({ runtime: "codex", mode: "plan" }),
    )
    expect(planArgs.slice(0, 2)).toEqual(["exec", "--cd"])
    expect(planArgs[planArgs.indexOf("--sandbox") + 1]).toBe("read-only")
    expect(planArgs).not.toContain("--ask-for-approval")

    const agentArgs = __testCodexHeadless.buildCodexArgs(
      request({ runtime: "codex", mode: "agent" }),
    )
    expect(agentArgs[agentArgs.indexOf("--sandbox") + 1]).toBe(
      "workspace-write",
    )
  })

  test("Codex adapter remains a codex exec headless/batch fallback only", () => {
    const args = __testCodexHeadless.buildCodexArgs(
      request({ runtime: "codex" }),
    )
    const source = readFileSync(
      "src/main/lib/headless/adapters/codex.ts",
      "utf8",
    )

    expect(args[0]).toBe("exec")
    expect(source).toContain('label: "Codex headless/batch"')
    expect(source).not.toContain("app-server")
    expect(source).not.toContain("desktop chat")
  })

  test("Codex adapter drops the non-TTY stdin notice but keeps real stderr", () => {
    expect(
      __testCodexHeadless.filterCodexStderr(
        "Reading additional input from stdin...\nreal warning\n",
      ),
    ).toBe("real warning\n")
    expect(__testCodexHeadless.filterCodexStderr("real warning\n")).toBe(
      "real warning\n",
    )
  })

  test("Codex adapter only forwards non-secret environment variables", () => {
    const env = __testCodexHeadless.buildCodexEnv(
      request({ runtime: "codex" }),
      {
        PATH: "/usr/bin",
        SAFE_FLAG: "1",
        OPENAI_API_KEY: "sk-abcdefghijklmnopqrstuvwxyz123456",
        CODEX_API_KEY: "codex-secret",
        GITHUB_TOKEN: "ghp_abcdefghijklmnopqrstuvwxyz123456",
      },
      {
        SHELL_SAFE: "ok",
        ANTHROPIC_AUTH_TOKEN: "anthropic-secret",
      },
    )

    expect(env.PATH).toBe("/usr/bin")
    expect(env.SAFE_FLAG).toBe("1")
    expect(env.SHELL_SAFE).toBe("ok")
    expect(env.LOCUS_HEADLESS_JOB_ID).toBe("job_123")
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.CODEX_API_KEY).toBeUndefined()
    expect(env.GITHUB_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
  })

  test("Codex provider profile runs use gateway env and model provider args", () => {
    const providerRequest = request({
      runtime: "codex",
      providerBinding: {
        model: "gpt-5.3-codex",
        modelSource: "provider-profile:codex-main",
        providerProfileId: "codex-main",
        providerProfileName: "Codex Main",
        gatewayEndpoint:
          "http://127.0.0.1:1234/profile/codex-main/responses/v1",
        gatewayToken: "gateway-token",
        authMode: "provider-profile",
      },
    })
    const args = __testCodexHeadless.buildCodexArgs(providerRequest)
    expect(args).toContain('model_provider="locus_profile"')
    expect(args).toContain(
      'model_providers.locus_profile.env_key="LOCUS_CODEX_PROVIDER_GATEWAY_TOKEN"',
    )
    expect(args.join("\n")).toContain("LOCUS_CODEX_PROVIDER_GATEWAY_TOKEN")
    expect(args.join("\n")).not.toContain("gateway-token")
    expect(args.slice(args.indexOf("-m"), args.indexOf("-m") + 2)).toEqual([
      "-m",
      "gpt-5.3-codex",
    ])

    const env = __testCodexHeadless.buildCodexEnv(
      providerRequest,
      {
        PATH: "/usr/bin",
        CODEX_API_KEY: "stale-codex-key",
      },
      {},
    )

    expect(env.LOCUS_CODEX_PROVIDER_GATEWAY_TOKEN).toBe("gateway-token")
    expect(env.CODEX_API_KEY).toBeUndefined()
    expect(env.LOCUS_HEADLESS_JOB_ID).toBe("job_123")
  })
})
