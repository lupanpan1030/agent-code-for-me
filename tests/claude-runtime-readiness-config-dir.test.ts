import { afterAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

type ReadinessProbeResult = {
  detail: string
  state: string
}

const temporaryDirectories: string[] = []

async function createIsolatedHome(): Promise<string> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "locus-claude-readiness-"),
  )
  temporaryDirectories.push(directory)
  return directory
}

async function writeClaudeCredential(
  configDirectory: string,
  accessToken: string,
): Promise<void> {
  await mkdir(configDirectory, { recursive: true })
  await writeFile(
    path.join(configDirectory, ".credentials.json"),
    JSON.stringify({
      claudeAiOauth: {
        accessToken,
        expiresAt: 4_102_444_800_000,
      },
    }),
    { mode: 0o600 },
  )
}

async function probeClaudeReadiness(input: {
  claudeConfigDir?: string
  homeDirectory: string
}): Promise<ReadinessProbeResult> {
  const readinessModuleUrl = pathToFileURL(
    path.resolve(process.cwd(), "src/main/lib/headless/runtime-readiness.ts"),
  ).href
  const program = `
    const { resolveLocalJobApiRuntimeReadiness } = await import(${JSON.stringify(readinessModuleUrl)});
    const readiness = await resolveLocalJobApiRuntimeReadiness({
      runtimeId: "claude-code",
      dependencies: { hasAnyClaudeCodeAccount: () => false },
    });
    process.stdout.write(JSON.stringify({ state: readiness.state, detail: readiness.detail }));
  `
  const environment: Record<string, string | undefined> = {
    ...process.env,
    HOME: input.homeDirectory,
    USERPROFILE: input.homeDirectory,
    // Prevent the isolated probe from consulting a real platform credential CLI.
    PATH: path.join(input.homeDirectory, "empty-path"),
  }
  if (input.claudeConfigDir === undefined) {
    delete environment.CLAUDE_CONFIG_DIR
  } else {
    environment.CLAUDE_CONFIG_DIR = input.claudeConfigDir
  }

  const child = Bun.spawn({
    cmd: [process.execPath, "--eval", program],
    cwd: process.cwd(),
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])

  expect(exitCode, stderr).toBe(0)
  return JSON.parse(stdout) as ReadinessProbeResult
}

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe("Claude runtime readiness config directory", () => {
  test("reports ready from an explicit CLAUDE_CONFIG_DIR credential", async () => {
    const homeDirectory = await createIsolatedHome()
    const configDirectory = path.join(homeDirectory, "selected-claude-config")
    await writeClaudeCredential(configDirectory, "selected-config-token")

    const readiness = await probeClaudeReadiness({
      claudeConfigDir: configDirectory,
      homeDirectory,
    })

    expect(readiness).toMatchObject({
      state: "ready",
      detail: "Claude CLI login is available.",
    })
    expect(JSON.stringify(readiness)).not.toContain("selected-config-token")
  })

  test("does not fall back to the default file from an explicit isolated directory", async () => {
    const homeDirectory = await createIsolatedHome()
    await writeClaudeCredential(
      path.join(homeDirectory, ".claude"),
      "default-config-token",
    )

    const readiness = await probeClaudeReadiness({
      claudeConfigDir: path.join(homeDirectory, "empty-selected-config"),
      homeDirectory,
    })

    expect(readiness).toMatchObject({
      state: "needs-auth",
      detail: "No Claude credential source is available.",
    })
    expect(JSON.stringify(readiness)).not.toContain("default-config-token")
  })

  test("uses the default config directory when CLAUDE_CONFIG_DIR is blank", async () => {
    const homeDirectory = await createIsolatedHome()
    await writeClaudeCredential(
      path.join(homeDirectory, ".claude"),
      "default-config-token",
    )

    const readiness = await probeClaudeReadiness({
      claudeConfigDir: "   ",
      homeDirectory,
    })

    expect(readiness.state).toBe("ready")
    expect(JSON.stringify(readiness)).not.toContain("default-config-token")
  })

  test("reports needs-auth when the selected credential file is absent", async () => {
    const homeDirectory = await createIsolatedHome()

    const readiness = await probeClaudeReadiness({ homeDirectory })

    expect(readiness).toMatchObject({
      state: "needs-auth",
      detail: "No Claude credential source is available.",
    })
  })

  test("rejects policy-invalid credentials discovered from the CLI config", async () => {
    const homeDirectory = await createIsolatedHome()
    for (const [index, accessToken] of [
      "short",
      "valid-token\nsecond-line",
      "x".repeat(16 * 1024 + 1),
    ].entries()) {
      const configDirectory = path.join(homeDirectory, `invalid-${index}`)
      await writeClaudeCredential(configDirectory, accessToken)

      const readiness = await probeClaudeReadiness({
        claudeConfigDir: configDirectory,
        homeDirectory,
      })

      expect(readiness.state).toBe("needs-auth")
      expect(JSON.stringify(readiness)).not.toContain(accessToken)
    }
  })
})
