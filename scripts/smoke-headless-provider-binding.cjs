#!/usr/bin/env node

const assert = require("node:assert/strict")
const { spawn } = require("node:child_process")
const crypto = require("node:crypto")
const fs = require("node:fs")
const fsp = require("node:fs/promises")
const http = require("node:http")
const os = require("node:os")
const path = require("node:path")
const Database = require("better-sqlite3")
const { app } = require("electron")

if (!app) {
  throw new Error(
    "Run this smoke helper with Electron and ELECTRON_RUN_AS_NODE unset.",
  )
}

if (process.platform === "win32") {
  throw new Error(
    "This deterministic fixture currently requires a POSIX shell for its fake bundled Codex executable.",
  )
}

const repoRoot = path.resolve(__dirname, "..")
const builtMainPath = path.join(repoRoot, "out", "main", "index.js")
const profileId = "smoke-provider-binding-codex"
const profileDefaultModel = "smoke-profile-default-model"
const profileRunModel = "smoke-profile-explicit-model"
const nativeRunModel = "smoke-native-model"
const ambientSecrets = [
  "ambient-openai-secret",
  "ambient-codex-secret",
  "ambient-gateway-secret",
]

function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

function platformBinDir() {
  return `${process.platform}-${process.arch}`
}

function runElectronApp(appRoot, args, env, options = {}) {
  return new Promise((resolve) => {
    const timeoutMs = options.timeoutMs ?? 30_000
    let settled = false
    let timedOut = false
    let stdout = ""
    let stderr = ""
    let forceKillTimer = null
    const child = spawn(process.execPath, [appRoot, ...args], {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      resolve({ ...result, stdout, stderr, timedOut })
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8")
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8")
    })
    child.on("error", (error) => {
      finish({ code: 1, signal: null, error })
    })
    child.on("close", (code, signal) => {
      finish({ code: timedOut ? 124 : (code ?? 1), signal })
    })

    const timeout = setTimeout(() => {
      timedOut = true
      stderr += `\nTimed out after ${timeoutMs}ms: electron ${[
        appRoot,
        ...args,
      ].join(" ")}\n`
      try {
        child.kill("SIGTERM")
      } catch {}
      forceKillTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL")
        } catch {}
        finish({ code: 124, signal: "SIGKILL" })
      }, 2_000)
      forceKillTimer.unref()
    }, timeoutMs)
    timeout.unref()
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
  const output = result.stdout.trim()
  try {
    return JSON.parse(output)
  } catch (error) {
    throw new Error(
      `${label} did not return JSON.\nexit=${result.code}\nstdout=${output}\nstderr=${result.stderr}\nparse=${error.message}`,
    )
  }
}

function assertSuccessfulRun(result, label) {
  assert.equal(
    result.timedOut,
    false,
    `${label} timed out.\nstdout=${result.stdout}\nstderr=${result.stderr}`,
  )
  assert.equal(
    result.code,
    0,
    `${label} failed.\nstdout=${result.stdout}\nstderr=${result.stderr}`,
  )
  const payload = parseJsonOutput(result, label)
  assert.equal(
    payload.job?.status,
    "succeeded",
    JSON.stringify(payload, null, 2),
  )
  assert.equal(payload.job?.exitCode, 0, JSON.stringify(payload, null, 2))
  assert.equal(payload.job?.errorCode, null, JSON.stringify(payload, null, 2))
  return payload
}

function assertNoKnownSecrets(value, label) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value)
  for (const secret of ambientSecrets) {
    assert.equal(
      serialized.includes(secret),
      false,
      `${label} leaked the ambient secret ${secret}`,
    )
  }
}

function assertScopedGatewayTokenAbsent(value, expectedHash, label) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value)
  const candidates = serialized.match(/[a-f0-9]{64}/gi) ?? []
  for (const candidate of candidates) {
    const candidateHash = crypto
      .createHash("sha256")
      .update(candidate)
      .digest("hex")
    assert.notEqual(
      candidateHash,
      expectedHash,
      `${label} leaked the scoped gateway token`,
    )
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

async function createMockResponsesUpstream() {
  const requests = []
  const server = http.createServer((req, res) => {
    void readRequestBody(req)
      .then((text) => {
        const body = text ? JSON.parse(text) : {}
        requests.push({
          method: req.method ?? null,
          url: req.url ?? null,
          headers: { ...req.headers },
          body,
        })
        res.writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        })
        res.end(
          JSON.stringify({
            id: "resp_locus_provider_binding_smoke",
            object: "response",
            created_at: Math.floor(Date.now() / 1000),
            status: "completed",
            model: body.model ?? profileDefaultModel,
            output: [
              {
                id: "msg_locus_provider_binding_smoke",
                type: "message",
                role: "assistant",
                status: "completed",
                content: [
                  {
                    type: "output_text",
                    text: "mock upstream ok",
                    annotations: [],
                  },
                ],
              },
            ],
            output_text: "mock upstream ok",
            usage: {
              input_tokens: 1,
              output_tokens: 1,
              total_tokens: 2,
            },
          }),
        )
      })
      .catch((error) => {
        res.writeHead(400, { "content-type": "application/json" })
        res.end(JSON.stringify({ error: error.message }))
      })
  })

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    server.close()
    throw new Error("Failed to start the mock Responses upstream.")
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve())
      }),
  }
}

async function makeSmokeAppRoot(rootDir) {
  const appRoot = path.join(rootDir, "electron-app")
  const resourcesDir = path.join(appRoot, "resources")
  const binDir = path.join(resourcesDir, "bin", platformBinDir())
  const fixturePath = path.join(appRoot, "fake-codex.cjs")
  const codexPath = path.join(binDir, "codex")
  await fsp.mkdir(binDir, { recursive: true })
  // cli-path.ts recognizes a development app root only when resources/cli exists.
  await fsp.mkdir(path.join(resourcesDir, "cli"), { recursive: true })

  await fsp.writeFile(
    path.join(appRoot, "package.json"),
    JSON.stringify({ name: "locus-provider-binding-smoke", main: "main.js" }),
  )
  await fsp.writeFile(
    path.join(appRoot, "main.js"),
    `require(${JSON.stringify(builtMainPath)})\n`,
  )
  await fsp.writeFile(
    fixturePath,
    `#!/usr/bin/env node
const crypto = require("node:crypto")
const fs = require("node:fs")

function fail(message) {
  process.stderr.write(message + "\\n")
  process.exit(1)
}

function configValue(key) {
  for (let index = 0; index < process.argv.length - 1; index += 1) {
    if (process.argv[index] !== "-c") continue
    const value = process.argv[index + 1]
    if (!value.startsWith(key + "=")) continue
    const encoded = value.slice(key.length + 1)
    try {
      return JSON.parse(encoded)
    } catch {
      return encoded
    }
  }
  return null
}

function optionValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

async function main() {
  if (process.argv[2] !== "exec") fail("expected codex exec")
  const baseUrl = configValue("model_providers.locus_profile.base_url")
  const envKey = configValue("model_providers.locus_profile.env_key")
  const model = optionValue("-m")
  const token = envKey ? process.env[envKey] ?? "" : ""
  const profileRun = Boolean(baseUrl || envKey)

  if (profileRun && (!baseUrl || !envKey || !token)) {
    fail("provider binding fixture received an incomplete gateway binding")
  }
  if (!profileRun && token) {
    fail("native run unexpectedly received a provider gateway token")
  }
  if (token === "ambient-gateway-secret") {
    fail("ambient gateway token was forwarded instead of a scoped token")
  }
  if (process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY) {
    fail("ambient provider credentials reached the Codex child")
  }
  if (token && process.argv.join("\\n").includes(token)) {
    fail("scoped gateway token leaked into argv")
  }

  let gatewayStatus = null
  if (profileRun) {
    const response = await fetch(baseUrl.replace(/\\/+$/, "") + "/responses", {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [{ role: "user", content: "provider binding smoke" }],
        stream: false,
      }),
    })
    const responseText = await response.text()
    gatewayStatus = response.status
    if (!response.ok) fail("gateway returned " + response.status + ": " + responseText)
    if (responseText.includes(token)) fail("gateway response leaked its scoped token")
  }

  const probe = {
    mode: profileRun ? "profile" : "native",
    model,
    hasBaseUrl: Boolean(baseUrl),
    hasGatewayToken: Boolean(token),
    gatewayStatus,
    gatewayTokenFingerprint: token
      ? crypto.createHash("sha256").update(token).digest("hex").slice(0, 12)
      : null,
    gatewayTokenSha256: token
      ? crypto.createHash("sha256").update(token).digest("hex")
      : null,
    strippedAmbientSecrets:
      !process.env.OPENAI_API_KEY &&
      !process.env.CODEX_API_KEY &&
      token !== "ambient-gateway-secret",
  }
  fs.writeFileSync(process.env.LOCUS_PROVIDER_BINDING_PROBE_PATH, JSON.stringify(probe))
  process.stdout.write(profileRun ? "fixture profile run ok\\n" : "fixture native run ok\\n")
}

main().catch((error) => fail(error?.stack || String(error)))
`,
  )
  await fsp.writeFile(
    codexPath,
    `#!/bin/sh
set -eu
export ELECTRON_RUN_AS_NODE=1
exec ${JSON.stringify(process.execPath)} ${JSON.stringify(fixturePath)} "$@"
`,
  )
  await fsp.chmod(codexPath, 0o755)

  return appRoot
}

function buildBaseEnv(context, probePath) {
  const env = {
    ...process.env,
    HOME: context.homeDir,
    XDG_CONFIG_HOME: path.join(context.homeDir, ".config"),
    CODEX_HOME: context.codexHomeDir,
    LOCUS_USER_DATA_DIR: context.userDataDir,
    LOCUS_PROVIDER_BINDING_PROBE_PATH: probePath,
    OPENAI_API_KEY: ambientSecrets[0],
    CODEX_API_KEY: ambientSecrets[1],
    LOCUS_CODEX_PROVIDER_GATEWAY_TOKEN: ambientSecrets[2],
    NO_COLOR: "1",
    FORCE_COLOR: "0",
  }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

async function createContext(rootDir) {
  const context = {
    userDataDir: path.join(rootDir, "user-data"),
    homeDir: path.join(rootDir, "home"),
    codexHomeDir: path.join(rootDir, "codex-home"),
    projectDir: path.join(rootDir, "project"),
    profileProbePath: path.join(rootDir, "profile-probe.json"),
    nativeProbePath: path.join(rootDir, "native-probe.json"),
  }
  await Promise.all(
    [
      context.userDataDir,
      context.homeDir,
      context.codexHomeDir,
      context.projectDir,
    ].map((directory) => fsp.mkdir(directory, { recursive: true })),
  )
  await fsp.writeFile(
    path.join(context.projectDir, "README.md"),
    "# Headless provider binding smoke fixture\n",
  )
  return context
}

async function registerProject(appRoot, context) {
  const result = await runLocus(
    appRoot,
    ["api", "projects", "register", "--cwd", context.projectDir, "--json"],
    buildBaseEnv(context, context.profileProbePath),
  )
  assert.equal(
    result.code,
    0,
    `Project registration failed.\nstdout=${result.stdout}\nstderr=${result.stderr}`,
  )
  const payload = parseJsonOutput(result, "project registration")
  assert.ok(payload.project?.id, JSON.stringify(payload, null, 2))
  return payload.project
}

function seedProviderProfile(context, upstreamBaseUrl) {
  const dbPath = path.join(context.userDataDir, "data", "agents.db")
  assert.equal(
    fs.existsSync(dbPath),
    true,
    "The built Locus main did not initialize the temporary database.",
  )
  const db = new Database(dbPath)
  try {
    const now = Date.now()
    db.prepare(`
      insert into agent_provider_profiles (
        id,
        name,
        preset_id,
        protocol,
        base_url,
        default_model,
        auth_mode,
        encrypted_token,
        headers_json,
        target_runtimes_json,
        capabilities_json,
        created_at,
        updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      profileId,
      "Locus Headless Provider Binding Smoke",
      "smoke",
      "openai-responses",
      upstreamBaseUrl,
      profileDefaultModel,
      "none",
      null,
      JSON.stringify({ "x-title": "locus-provider-binding-smoke" }),
      JSON.stringify(["codex"]),
      JSON.stringify({ codex: true, streaming: false }),
      now,
      now,
    )
  } finally {
    db.close()
  }
}

async function readProbe(probePath) {
  return JSON.parse(await fsp.readFile(probePath, "utf8"))
}

async function runProfileCase(appRoot, context, upstream) {
  const result = await runLocus(
    appRoot,
    [
      "run",
      "--runtime",
      "codex",
      "--provider-profile",
      profileId,
      "--model",
      profileRunModel,
      "--mode",
      "plan",
      "--cwd",
      context.projectDir,
      "--prompt",
      "Verify the deterministic provider binding smoke fixture.",
      "--output",
      "json",
    ],
    buildBaseEnv(context, context.profileProbePath),
  )
  const payload = assertSuccessfulRun(result, "profile run")
  const probe = await readProbe(context.profileProbePath)
  const resolvedProvider = payload.job.result?.resolvedProvider

  assert.deepEqual(resolvedProvider, {
    source: "request-profile",
    profileId,
    model: profileRunModel,
  })
  assert.deepEqual(
    {
      mode: probe.mode,
      model: probe.model,
      hasBaseUrl: probe.hasBaseUrl,
      hasGatewayToken: probe.hasGatewayToken,
      gatewayStatus: probe.gatewayStatus,
      strippedAmbientSecrets: probe.strippedAmbientSecrets,
    },
    {
      mode: "profile",
      model: profileRunModel,
      hasBaseUrl: true,
      hasGatewayToken: true,
      gatewayStatus: 200,
      strippedAmbientSecrets: true,
    },
  )
  assert.match(probe.gatewayTokenFingerprint, /^[a-f0-9]{12}$/)
  assert.equal(upstream.requests.length, 1)
  const hit = upstream.requests[0]
  assert.equal(hit.method, "POST")
  assert.equal(hit.url, "/v1/responses")
  assert.equal(hit.body.model, resolvedProvider.model)
  assert.equal(hit.headers["x-title"], "locus-provider-binding-smoke")
  assert.equal(hit.headers.authorization, undefined)
  assertNoKnownSecrets(payload, "profile result envelope")
  assertNoKnownSecrets(hit, "profile upstream request")
  assertScopedGatewayTokenAbsent(
    payload,
    probe.gatewayTokenSha256,
    "profile result envelope",
  )
  assertScopedGatewayTokenAbsent(
    hit,
    probe.gatewayTokenSha256,
    "profile upstream request",
  )

  return {
    jobId: payload.job.id,
    status: payload.job.status,
    resolvedProvider,
    upstream: {
      requestCount: upstream.requests.length,
      method: hit.method,
      path: hit.url,
      model: hit.body.model,
      profileHeader: hit.headers["x-title"],
      receivedAuthorization: Boolean(hit.headers.authorization),
    },
    adapterProbe: {
      mode: probe.mode,
      model: probe.model,
      hasBaseUrl: probe.hasBaseUrl,
      hasGatewayToken: probe.hasGatewayToken,
      gatewayStatus: probe.gatewayStatus,
      gatewayTokenFingerprint: probe.gatewayTokenFingerprint,
      strippedAmbientSecrets: probe.strippedAmbientSecrets,
    },
  }
}

async function runNativeCase(appRoot, context, upstream) {
  const requestCountBefore = upstream.requests.length
  const result = await runLocus(
    appRoot,
    [
      "run",
      "--runtime",
      "codex",
      "--model",
      nativeRunModel,
      "--mode",
      "plan",
      "--cwd",
      context.projectDir,
      "--prompt",
      "Verify the deterministic native Codex non-routing fixture.",
      "--output",
      "json",
    ],
    buildBaseEnv(context, context.nativeProbePath),
  )
  const payload = assertSuccessfulRun(result, "native run")
  const probe = await readProbe(context.nativeProbePath)
  const resolvedProvider = payload.job.result?.resolvedProvider

  assert.deepEqual(resolvedProvider, {
    source: "native",
    profileId: null,
    model: nativeRunModel,
  })
  assert.deepEqual(
    {
      mode: probe.mode,
      model: probe.model,
      hasBaseUrl: probe.hasBaseUrl,
      hasGatewayToken: probe.hasGatewayToken,
      gatewayStatus: probe.gatewayStatus,
      gatewayTokenFingerprint: probe.gatewayTokenFingerprint,
      gatewayTokenSha256: probe.gatewayTokenSha256,
      strippedAmbientSecrets: probe.strippedAmbientSecrets,
    },
    {
      mode: "native",
      model: nativeRunModel,
      hasBaseUrl: false,
      hasGatewayToken: false,
      gatewayStatus: null,
      gatewayTokenFingerprint: null,
      gatewayTokenSha256: null,
      strippedAmbientSecrets: true,
    },
  )
  assert.equal(
    upstream.requests.length,
    requestCountBefore,
    "Native Codex run unexpectedly routed to the profile upstream.",
  )
  assertNoKnownSecrets(payload, "native result envelope")

  return {
    jobId: payload.job.id,
    status: payload.job.status,
    resolvedProvider,
    upstreamRequestCountBefore: requestCountBefore,
    upstreamRequestCountAfter: upstream.requests.length,
    adapterProbe: probe,
  }
}

async function main() {
  app.setName("Locus Headless Provider Binding Smoke")
  await app.whenReady()
  if (!fs.existsSync(builtMainPath)) {
    throw new Error(`Built Electron main entry is missing: ${builtMainPath}`)
  }

  const keepTemp = hasFlag("keep-temp")
  const rootDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), "locus-provider-binding-smoke-"),
  )
  let upstream = null
  try {
    const context = await createContext(rootDir)
    const appRoot = await makeSmokeAppRoot(rootDir)
    upstream = await createMockResponsesUpstream()
    const project = await registerProject(appRoot, context)
    seedProviderProfile(context, upstream.baseUrl)

    const profile = await runProfileCase(appRoot, context, upstream)
    const native = await runNativeCase(appRoot, context, upstream)
    const summary = {
      ok: true,
      commandShape:
        "locus run --runtime codex [--provider-profile <id>] --model <model>",
      projectId: project.id,
      profile,
      native,
      totalUpstreamRequests: upstream.requests.length,
      secretChecks: {
        ambientSecretsStripped: true,
        scopedGatewayTokenExcludedFromArgvAndResponse: true,
        scopedGatewayTokenNotForwardedUpstream: true,
      },
      tempRoot: keepTemp ? rootDir : null,
    }
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  } finally {
    if (upstream) await upstream.close()
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
