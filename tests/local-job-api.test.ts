import { describe, expect, test } from "bun:test"
import { agentProviderProfiles, projects } from "../src/main/lib/db/schema"
import { createAgentJob, getAgentJob } from "../src/main/lib/headless/job-store"
import { createLocalJobApiJob } from "../src/main/lib/headless/local-job-api"
import {
  AGENT_JOB_EVENT_TYPES,
  AGENT_JOB_SOURCES,
} from "../src/shared/agent-jobs"
import {
  LOCAL_JOB_API_EVENT_TYPES,
  LOCAL_JOB_API_VERSION,
  validateLocalJobApiCreateRequest,
} from "../src/shared/local-job-api"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

describe("Local Job API v1 shared contract", () => {
  test("normalizes a generic local-package create request", () => {
    const request = validateLocalJobApiCreateRequest({
      apiVersion: LOCAL_JOB_API_VERSION,
      consumer: {
        id: "docs-workbench",
        runExternalId: "package-review-001",
      },
      project: {
        cwd: process.cwd(),
      },
      runtime: {
        id: "claude",
        requiredCapabilities: ["planMode"],
      },
      mode: "plan",
      prompt: {
        text: "Review this local package.",
      },
      input: {
        contract: "example.local-package.v1",
        packageDir: `${process.cwd()}/fixtures/local-package`,
      },
      artifacts: {
        baseDir: `${process.cwd()}/fixtures/local-package/.locus/runs`,
        writePolicy: "proposal-only",
      },
    })

    expect(request).toMatchObject({
      ok: true,
      request: {
        apiVersion: LOCAL_JOB_API_VERSION,
        consumer: {
          id: "docs-workbench",
          runExternalId: "package-review-001",
        },
        runtime: {
          id: "claude-code",
          requiredCapabilities: ["planMode"],
        },
        mode: "plan",
        artifacts: {
          writePolicy: "proposal-only",
        },
      },
    })
  })

  test("normalizes an explicit policy-grant execution profile", () => {
    const request = validateLocalJobApiCreateRequest({
      apiVersion: LOCAL_JOB_API_VERSION,
      consumer: {
        id: "docs-workbench",
      },
      project: {
        cwd: process.cwd(),
      },
      runtime: {
        id: "codex",
        executionProfile: "policy-grant",
        policyGrant: {
          scopes: ["workspace:file-write", "shell:project-only"],
        },
      },
      mode: "agent",
      prompt: {
        text: "Run through the gated app-server profile.",
      },
    })

    expect(request).toMatchObject({
      ok: true,
      request: {
        runtime: {
          id: "codex",
          executionProfile: "policy-grant",
          policyGrant: {
            scopes: ["workspace:file-write", "shell:project-only"],
          },
        },
      },
    })
  })

  test("normalizes provider profile references without accepting secrets", () => {
    const request = validateLocalJobApiCreateRequest({
      apiVersion: LOCAL_JOB_API_VERSION,
      consumer: {
        id: "docs-workbench",
      },
      project: {
        cwd: process.cwd(),
      },
      runtime: {
        id: "codex",
      },
      mode: "agent",
      prompt: {
        text: "Run with selected provider.",
      },
      provider: {
        profileId: " codex-main ",
        model: " gpt-5.3-codex ",
      },
    })

    expect(request).toMatchObject({
      ok: true,
      request: {
        provider: {
          profileId: "codex-main",
          model: "gpt-5.3-codex",
        },
      },
    })

    const rejected = validateLocalJobApiCreateRequest({
      apiVersion: LOCAL_JOB_API_VERSION,
      consumer: { id: "docs-workbench" },
      project: { cwd: process.cwd() },
      runtime: { id: "codex" },
      mode: "agent",
      prompt: { text: "Run with selected provider." },
      provider: {
        profileId: "codex-main",
        apiKey: "sk-abcdefghijklmnopqrstuvwxyz123456",
      },
    })

    expect(rejected.ok).toBe(false)
    if (!rejected.ok) {
      const message = rejected.errors.join("\n")
      expect(message).toContain("provider.apiKey is not accepted")
      expect(message).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456")
    }
  })

  test("requires bounded policy scopes for policy-grant execution", () => {
    const request = validateLocalJobApiCreateRequest({
      apiVersion: LOCAL_JOB_API_VERSION,
      consumer: { id: "docs-workbench" },
      project: { cwd: process.cwd() },
      runtime: {
        id: "codex",
        executionProfile: "policy-grant",
      },
      mode: "agent",
      prompt: { text: "Run through the gated app-server profile." },
    })

    expect(request.ok).toBe(false)
    if (!request.ok) {
      expect(request.errors.join("\n")).toContain(
        "runtime.policyGrant.scopes is required",
      )
    }
  })

  test("rejects retired runtime identifiers from the Local Job API contract", () => {
    const retiredRuntimeIds = ["qwen-code", "kun"]
    for (const runtimeId of retiredRuntimeIds) {
      const request = validateLocalJobApiCreateRequest({
        apiVersion: LOCAL_JOB_API_VERSION,
        consumer: { id: "docs-workbench" },
        project: { cwd: process.cwd() },
        runtime: { id: runtimeId },
        mode: "agent",
        prompt: { text: `Run ${runtimeId} through the Local Job API.` },
      })

      expect(request.ok).toBe(false)
      if (!request.ok) {
        expect(request.errors).toContain("Unsupported runtime.id")
      }
    }
  })

  test("rejects secret-like request fields and values", () => {
    const request = validateLocalJobApiCreateRequest({
      apiVersion: LOCAL_JOB_API_VERSION,
      consumer: { id: "docs-workbench" },
      project: { cwd: process.cwd() },
      runtime: { id: "codex" },
      mode: "plan",
      prompt: { text: "Review this package." },
      input: {
        contract: "example.local-package.v1",
        authorization: "Bearer secret-token-value",
      },
    })

    expect(request.ok).toBe(false)
    if (!request.ok) {
      expect(request.errors.join("\n")).toContain(
        "input.authorization is not accepted",
      )
    }
  })

  test("does not echo unsupported selector values in validation errors", () => {
    const secretLike = "sk-abcdefghijklmnopqrstuvwxyz123456"
    const request = validateLocalJobApiCreateRequest({
      apiVersion: LOCAL_JOB_API_VERSION,
      consumer: { id: "docs-workbench" },
      project: { cwd: process.cwd() },
      runtime: {
        id: secretLike,
        requiredCapabilities: [secretLike],
        executionProfile: secretLike,
      },
      mode: secretLike,
      prompt: { text: "Review this package." },
      artifacts: {
        writePolicy: secretLike,
      },
    })

    expect(request.ok).toBe(false)
    if (!request.ok) {
      const message = request.errors.join("\n")
      expect(message).toContain("Unsupported runtime.id")
      expect(message).toContain("Unsupported required capability")
      expect(message).toContain("Unsupported runtime.executionProfile")
      expect(message).toContain("Unsupported mode")
      expect(message).toContain("Unsupported artifacts.writePolicy")
      expect(message).not.toContain(secretLike)
    }
  })

  test("declares API source and artifact event type", () => {
    expect(AGENT_JOB_SOURCES).toContain("api")
    expect(AGENT_JOB_EVENT_TYPES).toContain("artifact_created")
    expect(AGENT_JOB_EVENT_TYPES).toContain("usage_update")
    expect(LOCAL_JOB_API_EVENT_TYPES).toContain("usage_update")
  })

  test("normalizes consumer-neutral completion requests with caller-owned schemas", () => {
    const schemaA = {
      type: "object",
      required: ["summary", "scores"],
      properties: {
        summary: { type: "string" },
        scores: {
          type: "array",
          items: { type: "number" },
        },
      },
    }
    const schemaB = {
      type: "object",
      required: ["decision", "metadata"],
      properties: {
        decision: { enum: ["accept", "revise"] },
        metadata: {
          type: "object",
          properties: {
            authorization: { type: "string" },
          },
        },
      },
    }

    for (const schema of [schemaA, schemaB]) {
      const request = validateLocalJobApiCreateRequest({
        apiVersion: LOCAL_JOB_API_VERSION,
        kind: "completion",
        consumer: { id: "generic-tool" },
        provider: { profileId: "completion-main", model: "model-v1" },
        messages: [{ role: "user", content: "Return the requested JSON." }],
        responseFormat: { type: "json_schema", schema },
      })

      expect(request).toMatchObject({
        ok: true,
        request: {
          kind: "completion",
          consumer: {
            id: "generic-tool",
            runExternalId: null,
          },
          provider: {
            profileId: "completion-main",
            model: "model-v1",
          },
          responseFormat: {
            type: "json_schema",
            schema,
          },
        },
      })
    }
  })

  test("changing only consumer id does not change completion semantics", () => {
    const base = {
      apiVersion: LOCAL_JOB_API_VERSION,
      kind: "completion",
      provider: { profileId: "completion-main" },
      messages: [
        { role: "system", content: "Return terse content." },
        { role: "user", content: "Summarize this generic text." },
      ],
      responseFormat: { type: "text" },
    }
    const first = validateLocalJobApiCreateRequest({
      ...base,
      consumer: { id: "tool-alpha" },
    })
    const second = validateLocalJobApiCreateRequest({
      ...base,
      consumer: { id: "tool-beta" },
    })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    const firstWithoutConsumer = {
      ...first.request,
      consumer: { id: "<ignored>", runExternalId: null },
    }
    const secondWithoutConsumer = {
      ...second.request,
      consumer: { id: "<ignored>", runExternalId: null },
    }
    expect(firstWithoutConsumer).toEqual(secondWithoutConsumer)
  })

  test("rejects mixed agent and completion request fields", () => {
    const completion = validateLocalJobApiCreateRequest({
      apiVersion: LOCAL_JOB_API_VERSION,
      kind: "completion",
      consumer: { id: "generic-tool" },
      provider: { profileId: "completion-main" },
      project: { cwd: process.cwd() },
      prompt: { text: "Not accepted." },
      messages: [{ role: "user", content: "Return text." }],
    })

    expect(completion.ok).toBe(false)
    if (!completion.ok) {
      expect(completion.errors.join("\n")).toContain(
        "project is not accepted for completion jobs",
      )
      expect(completion.errors.join("\n")).toContain(
        "prompt is not accepted for completion jobs",
      )
    }

    const agent = validateLocalJobApiCreateRequest({
      apiVersion: LOCAL_JOB_API_VERSION,
      consumer: { id: "docs-workbench" },
      project: { cwd: process.cwd() },
      runtime: { id: "codex" },
      mode: "agent",
      prompt: { text: "Run normally." },
      messages: [{ role: "user", content: "Not accepted." }],
      responseFormat: { type: "text" },
    })

    expect(agent.ok).toBe(false)
    if (!agent.ok) {
      expect(agent.errors.join("\n")).toContain(
        "messages is not accepted for agent jobs",
      )
      expect(agent.errors.join("\n")).toContain(
        "responseFormat is not accepted for agent jobs",
      )
    }
  })

  test("requires explicit provider profile for completion jobs", () => {
    const request = validateLocalJobApiCreateRequest({
      apiVersion: LOCAL_JOB_API_VERSION,
      kind: "completion",
      consumer: { id: "generic-tool" },
      messages: [{ role: "user", content: "Return text." }],
    })

    expect(request.ok).toBe(false)
    if (!request.ok) {
      expect(request.errors.join("\n")).toContain(
        "provider.profileId is required for completion jobs",
      )
    }
  })

  test("persists sanitized API metadata on local jobs", () => {
    const db = createAgentJobTestDb()
    const job = createAgentJob(db, {
      source: "api",
      runtime: "codex",
      mode: "plan",
      cwd: process.cwd(),
      prompt: "Create a proposal only.",
      input: {
        prompt: "Create a proposal only.",
        consumer: { id: "docs-workbench" },
      },
      apiConsumerId: "docs-workbench",
      apiConsumerRunId: "package-review-001",
      artifactBaseDir: `${process.cwd()}/.tmp/locus-runs`,
      artifactManifestPath: `${process.cwd()}/.tmp/locus-runs/${Date.now()}/artifacts.json`,
    })

    expect(getAgentJob(db, job.id)).toMatchObject({
      source: "api",
      apiConsumerId: "docs-workbench",
      apiConsumerRunId: "package-review-001",
      artifactBaseDir: `${process.cwd()}/.tmp/locus-runs`,
    })
  })

  test("Local Job API create persists provider references only", () => {
    const db = createAgentJobTestDb()
    db.insert(projects)
      .values({
        id: "project-1",
        name: "Current",
        path: process.cwd(),
      })
      .run()
    db.insert(agentProviderProfiles)
      .values({
        id: "codex-main",
        name: "Codex Main",
        protocol: "openai-responses",
        baseUrl: "https://provider.example.com/v1",
        defaultModel: "gpt-5.3-codex",
        authMode: "none",
        targetRuntimesJson: JSON.stringify(["codex"]),
        capabilitiesJson: "{}",
      })
      .run()

    const parsed = validateLocalJobApiCreateRequest({
      apiVersion: LOCAL_JOB_API_VERSION,
      consumer: { id: "docs-workbench" },
      project: { cwd: process.cwd() },
      runtime: { id: "codex" },
      mode: "agent",
      prompt: { text: "Run with selected provider." },
      provider: {
        profileId: "codex-main",
        model: "gpt-5.4",
      },
    })

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const prepared = createLocalJobApiJob(db, parsed.request, "test")
    expect(prepared.job).toMatchObject({
      providerProfileId: "codex-main",
      modelOverride: "gpt-5.4",
    })
    expect(JSON.parse(prepared.job.inputJson ?? "{}")).toMatchObject({
      provider: {
        profileId: "codex-main",
        model: "gpt-5.4",
      },
    })
  })

  test("Local Job API completion create persists generic completion metadata", () => {
    const db = createAgentJobTestDb()
    db.insert(agentProviderProfiles)
      .values({
        id: "completion-main",
        name: "Completion Main",
        protocol: "openai-responses",
        baseUrl: "https://provider.example.com/v1",
        defaultModel: "provider-default-model",
        authMode: "none",
        targetRuntimesJson: JSON.stringify(["codex"]),
        capabilitiesJson: "{}",
      })
      .run()

    const parsed = validateLocalJobApiCreateRequest({
      apiVersion: LOCAL_JOB_API_VERSION,
      kind: "completion",
      consumer: { id: "generic-tool", runExternalId: "run-001" },
      runtime: { id: "codex" },
      provider: {
        profileId: "completion-main",
        model: "provider-model",
      },
      messages: [{ role: "user", content: "Return text." }],
      responseFormat: { type: "text" },
    })

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const prepared = createLocalJobApiJob(db, parsed.request, "test")
    expect(prepared.runDir).toBe(null)
    expect(prepared.job).toMatchObject({
      kind: "completion",
      source: "api",
      projectId: null,
      artifactBaseDir: null,
      artifactManifestPath: null,
      providerProfileId: "completion-main",
      modelOverride: "provider-model",
    })
    expect(JSON.parse(prepared.job.inputJson ?? "{}")).toMatchObject({
      kind: "completion",
      provider: {
        profileId: "completion-main",
        model: "provider-model",
      },
      messages: [{ role: "user", content: "Return text." }],
      responseFormat: { type: "text" },
    })
  })
})
