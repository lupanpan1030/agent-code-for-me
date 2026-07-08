#!/usr/bin/env node

const assert = require("node:assert/strict")
const { spawn } = require("node:child_process")
const fs = require("node:fs")
const fsp = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { app } = require("electron")

if (!app) {
  throw new Error(
    "This smoke helper must be run by Electron with ELECTRON_RUN_AS_NODE unset.",
  )
}

const repoRoot = path.resolve(__dirname, "..")
const builtMainPath = path.join(repoRoot, "out", "main", "index.js")
const careerKitAppPath = path.resolve(
  repoRoot,
  "..",
  "career-application-kit",
  "app",
)
const nodeBinDir =
  "/Users/ethan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
const betterSqlitePath = require.resolve("better-sqlite3")

function readArg(name, fallback) {
  const prefix = `--${name}=`
  const found = process.argv.find((arg) => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : fallback
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

function shQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`
}

function platformBinDir() {
  return `${process.platform}-${process.arch}`
}

function binaryName(name) {
  return process.platform === "win32" ? `${name}.exe` : name
}

function futureExpiry() {
  return Date.now() + 60 * 60 * 1000
}

function basePath() {
  return [nodeBinDir, "/opt/homebrew/bin", "/usr/local/bin", process.env.PATH]
    .filter(Boolean)
    .join(":")
}

function buildBaseEnv(ctx, extra = {}) {
  const env = {
    ...process.env,
    ...extra,
    HOME: process.env.HOME || os.homedir(),
    CLAUDE_CONFIG_DIR: ctx.claudeConfigDir,
    LOCUS_USER_DATA_DIR: ctx.userDataDir,
    LOCUS_RT2_PROBE_FILE: ctx.probeFile,
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    PATH: basePath(),
  }
  delete env.CLAUDE_CODE_OAUTH_TOKEN
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

async function makeSmokeAppRoot(rootDir) {
  const appRoot = path.join(rootDir, "electron-app")
  const binDir = path.join(appRoot, "resources", "bin", platformBinDir())
  await fsp.mkdir(binDir, { recursive: true })

  await fsp.writeFile(
    path.join(appRoot, "package.json"),
    JSON.stringify({ name: "locus-rt2-smoke", main: "main.js" }),
  )
  await fsp.writeFile(
    path.join(appRoot, "main.js"),
    `
const fs = require("node:fs")
const path = require("node:path")
const Database = require(${JSON.stringify(betterSqlitePath)})
const { app, safeStorage } = require("electron")
const builtMainPath = ${JSON.stringify(builtMainPath)}

function seedAppCredential() {
  const accountId = process.env.LOCUS_RT2_SEED_CREDENTIAL
  const userDataDir = process.env.LOCUS_USER_DATA_DIR
  if (!accountId || !userDataDir) {
    throw new Error("LOCUS_RT2_SEED_CREDENTIAL and LOCUS_USER_DATA_DIR are required")
  }
  app.setName("Locus")
  app.setPath("userData", userDataDir)
  app.whenReady().then(() => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("safeStorage encryption is unavailable")
    }
    const timestamp = new Date().toISOString()
    const encrypted = safeStorage.encryptString(JSON.stringify({
      version: 1,
      kind: "claude_code_oauth",
      accessToken: "app-token-" + accountId,
      refreshToken: "app-refresh-" + accountId,
      expiresAt: Date.now() + 60 * 60 * 1000,
      source: "manual",
      importedAt: timestamp,
      updatedAt: timestamp,
    })).toString("base64")
    const dbFile = path.join(userDataDir, "data", "agents.db")
    fs.mkdirSync(path.dirname(dbFile), { recursive: true })
    const db = new Database(dbFile)
    try {
      const now = Date.now()
      db.prepare(\`
        insert into anthropic_accounts
        (id, email, display_name, oauth_token, connected_at, last_used_at, desktop_user_id)
        values (?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          email = excluded.email,
          display_name = excluded.display_name,
          oauth_token = excluded.oauth_token,
          last_used_at = excluded.last_used_at,
          desktop_user_id = excluded.desktop_user_id
      \`).run(
        accountId,
        accountId + "@example.invalid",
        "RT-2 Smoke App Credential",
        encrypted,
        now,
        now,
        null,
      )
      db.prepare(\`
        insert into anthropic_settings (id, active_account_id, updated_at)
        values ('singleton', ?, ?)
        on conflict(id) do update set
          active_account_id = excluded.active_account_id,
          updated_at = excluded.updated_at
      \`).run(accountId, now)
    } finally {
      db.close()
    }
    process.stdout.write(JSON.stringify({ seeded: true, accountId }) + "\\n")
    app.exit(0)
  }).catch((error) => {
    console.error(error)
    app.exit(1)
  })
}

if (process.env.LOCUS_RT2_SEED_CREDENTIAL) {
  seedAppCredential()
} else {
  require(builtMainPath)
}
`,
  )

  const claudePath = path.join(binDir, binaryName("claude"))
  await fsp.writeFile(
    claudePath,
    `#!/bin/sh
set -eu

probe="\${LOCUS_RT2_PROBE_FILE:-}"
source="none"
has_env=0
has_cli=0
config_dir="\${CLAUDE_CONFIG_DIR:-\${HOME:-}/.claude}"
cred_file="$config_dir/.credentials.json"

if [ -n "\${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  has_env=1
  source="app"
fi

if [ -f "$cred_file" ] && grep -q '"accessToken"' "$cred_file"; then
  has_cli=1
fi

if [ "$source" = "none" ] && [ "$has_cli" = "1" ]; then
  source="cli"
fi

if [ -n "$probe" ]; then
  {
    echo "source=$source"
    echo "hasEnvToken=$has_env"
    echo "hasCliCredential=$has_cli"
    echo "configDir=$config_dir"
  } > "$probe"
fi

if [ "$source" = "none" ]; then
  echo "not logged in" >&2
  exit 1
fi

case "\${LOCUS_RT2_OUTPUT_CONTRACT:-}" in
  profile-import)
    cat <<'JSON'
{"contract":"career-kit.profile-import-draft.v1.1","profile":{"headline":"Synthetic Locus Import","summary_md":"RT-2 smoke fixture.","tailoring_rules_md":"","constraints_json":"{}"},"draft_entries":[{"entry_type":"project","title":"RT-2 app-login-only smoke","organization":"Locus","start_date":"2026-07-09","end_date":null,"body_md":"Verified app credential path through Locus Local Job API.","tags":["locus","rt-2"],"sort_order":0}]}
JSON
    ;;
  *)
    echo "credential-source=$source"
    ;;
esac
`,
  )
  await fsp.chmod(claudePath, 0o755)

  return appRoot
}

async function makeCaseContext(rootDir, name) {
  const caseRoot = path.join(rootDir, name)
  const claudeConfigDir = path.join(caseRoot, "claude-config")
  const userDataDir = path.join(caseRoot, "user-data")
  const projectDir = path.join(caseRoot, "project")
  const probeFile = path.join(caseRoot, "probe.env")
  await fsp.mkdir(claudeConfigDir, { recursive: true })
  await fsp.mkdir(userDataDir, { recursive: true })
  await fsp.mkdir(projectDir, { recursive: true })
  await fsp.writeFile(
    path.join(projectDir, "README.md"),
    `# ${name}\n\nRT-2 credential source smoke fixture.\n`,
  )
  return { caseRoot, claudeConfigDir, userDataDir, projectDir, probeFile }
}

function runElectronApp(appRoot, args, env, options = {}) {
  return new Promise((resolve) => {
    let settled = false
    const child = spawn(process.execPath, [appRoot, ...args], {
      cwd: repoRoot,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8")
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8")
    })
    const timeoutMs = options.timeoutMs ?? 20_000
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        child.kill("SIGTERM")
      } catch {}
      resolve({
        code: 124,
        signal: "SIGTERM",
        timedOut: true,
        stdout,
        stderr: `${stderr}\nTimed out after ${timeoutMs}ms: electron ${[
          appRoot,
          ...args,
        ].join(" ")}`,
      })
    }, timeoutMs)
    child.on("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ code: 1, stdout, stderr: `${stderr}${error.message}` })
    })
    child.on("close", (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ code: code ?? 1, signal, stdout, stderr })
    })
    if (options.stdin !== undefined) {
      child.stdin.end(options.stdin)
    } else {
      child.stdin.end()
    }
  })
}

function runLocus(appRoot, args, env, options = {}) {
  return runElectronApp(
    appRoot,
    ["--locus-headless-cli", ...args],
    env,
    options,
  )
}

function parseJsonOutput(result, label) {
  const text = result.stdout.trim()
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(
      `${label} did not return JSON.\nexit=${result.code}\nstdout=${text}\nstderr=${result.stderr}\nparse=${error.message}`,
    )
  }
}

async function registerProject(appRoot, ctx, env) {
  console.log(`[rt2-smoke] register: ${path.basename(ctx.caseRoot)}`)
  const result = await runLocus(
    appRoot,
    ["api", "projects", "register", "--cwd", ctx.projectDir, "--json"],
    env,
  )
  if (result.code !== 0) {
    throw new Error(
      `project registration failed for ${ctx.projectDir}\nstdout=${result.stdout}\nstderr=${result.stderr}`,
    )
  }
  return parseJsonOutput(result, "project registration")
}

async function seedAppCredential(appRoot, env, accountId) {
  const result = await runElectronApp(
    appRoot,
    [],
    {
      ...env,
      LOCUS_RT2_SEED_CREDENTIAL: accountId,
    },
    { timeoutMs: 10_000 },
  )
  if (result.code !== 0) {
    throw new Error(
      `app credential seed failed for ${accountId}\nstdout=${result.stdout}\nstderr=${result.stderr}`,
    )
  }
  parseJsonOutput(result, "app credential seed")
}

async function seedCliCredential(claudeConfigDir, name) {
  await fsp.mkdir(claudeConfigDir, { recursive: true })
  await fsp.writeFile(
    path.join(claudeConfigDir, ".credentials.json"),
    JSON.stringify(
      {
        claudeAiOauth: {
          accessToken: `cli-token-${name}`,
          refreshToken: `cli-refresh-${name}`,
          expiresAt: futureExpiry(),
        },
      },
      null,
      2,
    ),
  )
}

async function readProbe(probeFile) {
  const contents = await fsp.readFile(probeFile, "utf8")
  return Object.fromEntries(
    contents
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf("=")
        return index < 0
          ? [line, ""]
          : [line.slice(0, index), line.slice(index + 1)]
      }),
  )
}

async function runMatrixCase(appRoot, rootDir, definition) {
  const ctx = await makeCaseContext(rootDir, definition.name)
  const env = buildBaseEnv(ctx)
  await registerProject(appRoot, ctx, env)

  if (definition.appCredential) {
    await seedAppCredential(appRoot, env, `${definition.name}-account`)
  }
  if (definition.cliCredential) {
    await seedCliCredential(ctx.claudeConfigDir, definition.name)
  }

  console.log(`[rt2-smoke] run: ${definition.name}`)
  const result = await runLocus(
    appRoot,
    [
      "run",
      "--runtime",
      "claude-code",
      "--mode",
      "plan",
      "--cwd",
      ctx.projectDir,
      "--prompt",
      `RT-2 credential source smoke: ${definition.name}`,
      "--output",
      "json",
    ],
    env,
  )
  const payload = parseJsonOutput(result, definition.name)
  const job = payload.job
  const probe = await readProbe(ctx.probeFile)
  const details = JSON.stringify(
    {
      processExitCode: result.code,
      processStdout: result.stdout.trim(),
      processStderr: result.stderr.trim(),
      job,
      probe,
    },
    null,
    2,
  )

  assert.equal(result.code, definition.expectedExitCode, details)
  assert.equal(job.status, definition.expectedJobStatus, details)
  assert.equal(job.exitCode, definition.expectedJobExitCode, details)
  assert.equal(job.errorCode ?? null, definition.expectedErrorCode, details)
  assert.equal(probe.source, definition.expectedSource, details)
  assert.equal(
    probe.hasEnvToken,
    definition.expectedEnvToken ? "1" : "0",
    details,
  )
  assert.equal(
    probe.hasCliCredential,
    definition.expectedCliCredential ? "1" : "0",
    details,
  )

  return {
    name: definition.name,
    processExitCode: result.code,
    jobStatus: job.status,
    jobExitCode: job.exitCode,
    errorCode: job.errorCode ?? null,
    source: probe.source,
    hasEnvToken: probe.hasEnvToken === "1",
    hasCliCredential: probe.hasCliCredential === "1",
    configDir: probe.configDir,
  }
}

function writeLauncherWrapper(filePath, appRoot, env, extra = {}) {
  const wrapperEnv = { ...env, ...extra }
  const lines = [
    "#!/bin/sh",
    "set -eu",
    `export HOME=${shQuote(wrapperEnv.HOME)}`,
    `export LOCUS_USER_DATA_DIR=${shQuote(wrapperEnv.LOCUS_USER_DATA_DIR)}`,
    `export LOCUS_RT2_PROBE_FILE=${shQuote(wrapperEnv.LOCUS_RT2_PROBE_FILE)}`,
    `export PATH=${shQuote(wrapperEnv.PATH)}`,
    "export NO_COLOR=1",
    "export FORCE_COLOR=0",
    "unset CLAUDE_CODE_OAUTH_TOKEN",
    "unset ELECTRON_RUN_AS_NODE",
  ]
  lines.push(
    `export CLAUDE_CONFIG_DIR=${shQuote(wrapperEnv.CLAUDE_CONFIG_DIR)}`,
  )
  if (wrapperEnv.LOCUS_RT2_OUTPUT_CONTRACT) {
    lines.push(
      `export LOCUS_RT2_OUTPUT_CONTRACT=${shQuote(
        wrapperEnv.LOCUS_RT2_OUTPUT_CONTRACT,
      )}`,
    )
  }
  lines.push(
    `exec ${shQuote(process.execPath)} ${shQuote(
      appRoot,
    )} --locus-headless-cli "$@"`,
  )
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`)
  fs.chmodSync(filePath, 0o755)
}

async function runCareerKitSmoke(appRoot, rootDir) {
  const configuredAppPath = readArg("career-kit-app", careerKitAppPath)
  const domainPath = path.join(
    configuredAppPath,
    "electron",
    "runtime",
    "domain.cjs",
  )
  if (!fs.existsSync(domainPath)) {
    return {
      skipped: true,
      reason: `Career Kit domain not found: ${domainPath}`,
    }
  }

  const ctx = await makeCaseContext(rootDir, "career-kit-app-login-only")
  const env = buildBaseEnv(ctx)
  await registerProject(appRoot, ctx, env)
  await seedAppCredential(appRoot, env, "career-kit-app-login-only-account")

  const launcherPath = path.join(ctx.caseRoot, "locus")
  writeLauncherWrapper(launcherPath, appRoot, env, {
    LOCUS_RT2_OUTPUT_CONTRACT: "profile-import",
  })

  const domain = require(domainPath)
  const previousCliPath = process.env.CAREER_KIT_LOCUS_CLI_PATH
  process.env.CAREER_KIT_LOCUS_CLI_PATH = launcherPath
  try {
    console.log("[rt2-smoke] career-kit: extract profile import")
    const response = await domain.invokeDomainCommand(
      "extract_career_profile_import_draft_via_locus",
      {
        root: ctx.projectDir,
        consent: true,
        runtimeId: "claude-code",
        sourceName: "rt2-smoke.md",
        sourceType: "markdown",
        resumeText:
          "RT-2 smoke candidate. Built a Locus Local Job API integration and validated app-login-only Claude credentials.",
      },
    )
    const probe = await readProbe(ctx.probeFile)

    assert.equal(response.status, "succeeded", "Career Kit Locus response")
    assert.equal(probe.source, "app", "Career Kit credential source")
    assert.equal(probe.hasEnvToken, "1", "Career Kit env token")
    assert.equal(probe.hasCliCredential, "0", "Career Kit CLI credential")
    assert.ok(
      Array.isArray(response.draft_entries) &&
        response.draft_entries.length > 0,
      "Career Kit draft entries",
    )

    return {
      skipped: false,
      status: response.status,
      source: probe.source,
      hasEnvToken: probe.hasEnvToken === "1",
      hasCliCredential: probe.hasCliCredential === "1",
      draftEntries: response.draft_entries.length,
      sourceType: response.source_type ?? null,
    }
  } finally {
    if (previousCliPath === undefined) {
      delete process.env.CAREER_KIT_LOCUS_CLI_PATH
    } else {
      process.env.CAREER_KIT_LOCUS_CLI_PATH = previousCliPath
    }
  }
}

async function main() {
  app.setName("Locus RT2 Smoke")
  await app.whenReady()

  if (!fs.existsSync(builtMainPath)) {
    throw new Error(`Built Electron main entry is missing: ${builtMainPath}`)
  }
  const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), "locus-rt2-smoke-"))
  const keepTemp = hasFlag("keep-temp")
  try {
    const appRoot = await makeSmokeAppRoot(rootDir)
    const matrix = []
    for (const definition of [
      {
        name: "app-login-only",
        appCredential: true,
        cliCredential: false,
        expectedExitCode: 0,
        expectedJobExitCode: 0,
        expectedJobStatus: "succeeded",
        expectedErrorCode: null,
        expectedSource: "app",
        expectedEnvToken: true,
        expectedCliCredential: false,
      },
      {
        name: "cli-login-only",
        appCredential: false,
        cliCredential: true,
        expectedExitCode: 0,
        expectedJobExitCode: 0,
        expectedJobStatus: "succeeded",
        expectedErrorCode: null,
        expectedSource: "cli",
        expectedEnvToken: false,
        expectedCliCredential: true,
      },
      {
        name: "both",
        appCredential: true,
        cliCredential: true,
        expectedExitCode: 0,
        expectedJobExitCode: 0,
        expectedJobStatus: "succeeded",
        expectedErrorCode: null,
        expectedSource: "app",
        expectedEnvToken: true,
        expectedCliCredential: true,
      },
      {
        name: "neither",
        appCredential: false,
        cliCredential: false,
        expectedExitCode: 4,
        expectedJobExitCode: 4,
        expectedJobStatus: "failed",
        expectedErrorCode: "runtime_auth_required",
        expectedSource: "none",
        expectedEnvToken: false,
        expectedCliCredential: false,
      },
    ]) {
      const summary = await runMatrixCase(appRoot, rootDir, definition)
      matrix.push(summary)
      console.log(
        `[rt2-smoke] ${summary.name}: exit=${summary.processExitCode} job=${summary.jobStatus}/${summary.jobExitCode} source=${summary.source} envToken=${summary.hasEnvToken} cli=${summary.hasCliCredential} error=${summary.errorCode ?? "none"}`,
      )
    }

    let careerKit = null
    if (!hasFlag("skip-career-kit")) {
      careerKit = await runCareerKitSmoke(appRoot, rootDir)
      if (careerKit.skipped) {
        console.log(`[rt2-smoke] career-kit: skipped: ${careerKit.reason}`)
      } else {
        console.log(
          `[rt2-smoke] career-kit: status=${careerKit.status} source=${careerKit.source} envToken=${careerKit.hasEnvToken} cli=${careerKit.hasCliCredential} draftEntries=${careerKit.draftEntries}`,
        )
      }
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          matrix,
          careerKit,
          tempRoot: keepTemp ? rootDir : null,
        },
        null,
        2,
      ),
    )
  } finally {
    if (!keepTemp) {
      await fsp.rm(rootDir, { recursive: true, force: true })
    }
  }
}

main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
