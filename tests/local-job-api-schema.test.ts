import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import Ajv2020 from "ajv/dist/2020"
import addFormats from "ajv-formats"
import type { AgentJob } from "../src/main/lib/db/schema"
import { toLocalJobApiResultEnvelope } from "../src/main/lib/headless/local-job-api"
import {
  AGENT_JOB_KINDS,
  AGENT_JOB_MODES,
  AGENT_JOB_SOURCES,
  AGENT_JOB_STATUSES,
} from "../src/shared/agent-jobs"
import {
  AGENT_RUNTIME_CAPABILITY_IDS,
  CONTRACT_RUNTIME_IDS,
} from "../src/shared/agent-runtime-capabilities"
import {
  LOCAL_JOB_API_DISCOVERY_FEATURES,
  LOCAL_JOB_API_EVENT_TYPES,
  LOCAL_JOB_API_RUNTIME_READINESS_STATES,
  LOCAL_JOB_API_VERSION,
  LOCAL_JOB_API_WRITE_POLICIES,
  type LocalJobApiArtifact,
} from "../src/shared/local-job-api"

type SchemaObject = {
  [key: string]: unknown
  $defs: Record<string, SchemaObject>
}

function loadSchema(): SchemaObject {
  return JSON.parse(
    readFileSync("docs/local-job-api-v1.schema.json", "utf8"),
  ) as SchemaObject
}

function def(schema: SchemaObject, name: string): SchemaObject {
  const value = schema.$defs[name]
  expect(value, `Missing schema def ${name}`).toBeDefined()
  return value
}

function schemaEnum(schema: SchemaObject): string[] {
  const value = schema.enum
  expect(Array.isArray(value)).toBe(true)
  return value as string[]
}

function schemaValidator(schema: SchemaObject, ref: string) {
  const ajv = new Ajv2020({ allErrors: true })
  addFormats(ajv)
  ajv.addSchema(schema, "local-job-api-v1")
  const validate = ajv.getSchema(`local-job-api-v1${ref}`)
  expect(validate, `Missing schema validator for ${ref}`).toBeDefined()
  return validate!
}

function exampleAgentJob(overrides: Partial<AgentJob> = {}): AgentJob {
  return {
    id: "job_schema_result",
    retryOfJobId: null,
    attempt: 1,
    kind: "agent",
    source: "api",
    runtime: "codex",
    status: "failed",
    mode: "agent",
    cwd: "/tmp/locus-schema-project",
    projectId: "project_schema",
    chatId: null,
    subChatId: null,
    promptPreview: "Validate schema output",
    inputJson: "{}",
    apiConsumerId: "schema-test",
    apiConsumerRunId: "schema-run-001",
    artifactBaseDir: "/tmp/locus-schema-project/.locus/runs",
    artifactManifestPath:
      "/tmp/locus-schema-project/.locus/runs/job_schema_result/artifacts.json",
    providerProfileId: null,
    modelOverride: null,
    createdAt: new Date("2026-06-15T00:00:00.000Z"),
    startedAt: new Date("2026-06-15T00:00:01.000Z"),
    finishedAt: new Date("2026-06-15T00:00:02.000Z"),
    exitCode: 1,
    errorCode: "runtime_process_failed",
    errorMessage: "Codex exited with code 1.",
    resultJson: JSON.stringify({
      summary: "schema validation sample",
    }),
    createdByVersion: "test",
    workerId: "worker-schema",
    workerPid: 12345,
    workerStartedAt: new Date("2026-06-15T00:00:01.000Z"),
    heartbeatAt: new Date("2026-06-15T00:00:01.500Z"),
    cancelRequestedAt: null,
    cancelRequestedBy: null,
    ...overrides,
  }
}

describe("Local Job API v1 JSON Schema", () => {
  test("keeps schema constants in sync with shared Local Job API constants", () => {
    const schema = loadSchema()

    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema")
    expect(def(schema, "apiVersion").const).toBe(LOCAL_JOB_API_VERSION)
    expect(schemaEnum(def(schema, "runtimeId"))).toEqual([
      ...CONTRACT_RUNTIME_IDS,
    ])
    expect(schemaEnum(def(schema, "runtimeIdInput"))).toEqual([
      ...CONTRACT_RUNTIME_IDS,
      "claude",
    ])
    expect(schemaEnum(def(schema, "runtimeId"))).not.toContain(
      "qwen-code",
    )
    expect(schemaEnum(def(schema, "runtimeId"))).not.toContain("kun")
    expect(schemaEnum(def(schema, "runtimeCapabilityId"))).toEqual([
      ...AGENT_RUNTIME_CAPABILITY_IDS,
    ])
    expect(schemaEnum(def(schema, "agentMode"))).toEqual([...AGENT_JOB_MODES])
    expect(schemaEnum(def(schema, "agentJobStatus"))).toEqual([
      ...AGENT_JOB_STATUSES,
    ])
    expect(schemaEnum(def(schema, "writePolicy"))).toEqual([
      ...LOCAL_JOB_API_WRITE_POLICIES,
    ])
    expect(schemaEnum(def(schema, "eventType"))).toEqual([
      ...LOCAL_JOB_API_EVENT_TYPES,
    ])
    expect(schemaEnum(def(schema, "runtimeReadinessState"))).toEqual([
      ...LOCAL_JOB_API_RUNTIME_READINESS_STATES,
    ])
    expect(schemaEnum(def(schema, "discoveryFeature"))).toEqual([
      ...LOCAL_JOB_API_DISCOVERY_FEATURES,
    ])
    expect(schemaEnum(def(schema, "jobKind"))).toEqual([...AGENT_JOB_KINDS])
  })

  test("documents create request normalization and runtime-only validation rules", () => {
    const schema = loadSchema()
    const createRequest = def(schema, "createRequest")
    const agentCreateRequest = def(schema, "agentCreateRequest")
    const completionCreateRequest = def(schema, "completionCreateRequest")
    const properties = agentCreateRequest.properties as Record<
      string,
      SchemaObject
    >
    const prompt = properties.prompt.properties as Record<string, SchemaObject>
    const promptText = prompt.text as SchemaObject
    const artifacts = properties.artifacts as SchemaObject
    const provider = properties.provider as SchemaObject
    const providerSelection = def(schema, "providerSelection")
    const artifactObject = (artifacts.oneOf as SchemaObject[])[0]
    const artifactProperties = artifactObject.properties as Record<
      string,
      SchemaObject
    >
    const completionProperties = completionCreateRequest.properties as Record<
      string,
      SchemaObject
    >

    expect(createRequest.oneOf).toEqual([
      { $ref: "#/$defs/agentCreateRequest" },
      { $ref: "#/$defs/completionCreateRequest" },
    ])
    expect(agentCreateRequest.required).toEqual([
      "apiVersion",
      "consumer",
      "project",
      "runtime",
      "mode",
      "prompt",
    ])
    expect(promptText.maxLength).toBe(256 * 1024)
    expect(Object.keys(prompt)).toEqual(["text"])
    expect(properties).not.toHaveProperty("images")
    expect(properties).not.toHaveProperty("attachments")
    expect(properties.kind).toEqual({
      const: "agent",
      default: "agent",
    })
    expect(provider).toEqual({ $ref: "#/$defs/providerSelection" })
    expect(providerSelection.anyOf).toEqual([
      { required: ["profileId"] },
      { required: ["model"] },
    ])
    expect(artifactProperties.writePolicy.default).toBe("metadata-only")
    expect(agentCreateRequest.description).toContain("secret-like")
    expect(agentCreateRequest.description).toContain("1 MiB")
    expect((properties.input as SchemaObject).description).toContain(
      "Provider credentials",
    )
    expect(completionCreateRequest.required).toEqual([
      "apiVersion",
      "kind",
      "consumer",
      "provider",
      "messages",
    ])
    expect(completionCreateRequest.additionalProperties).toBe(false)
    expect(completionProperties).not.toHaveProperty("project")
    expect(completionProperties).not.toHaveProperty("prompt")
    expect(completionProperties).not.toHaveProperty("artifacts")
    expect(completionProperties.provider).toEqual({
      $ref: "#/$defs/explicitProviderSelection",
    })
    expect(completionProperties.responseFormat).toBeDefined()
  })

  test("rejects empty or nullable provider selections while allowing omission", () => {
    const schema = loadSchema()
    const validate = schemaValidator(schema, "#/$defs/agentCreateRequest")
    const baseRequest = {
      apiVersion: LOCAL_JOB_API_VERSION,
      consumer: { id: "schema-test" },
      project: { cwd: "/tmp/locus-schema-project" },
      runtime: { id: "codex" },
      mode: "agent",
      prompt: { text: "Keep provider routing explicit." },
    }

    expect(validate(baseRequest), JSON.stringify(validate.errors, null, 2)).toBe(
      true,
    )
    for (const provider of [
      {},
      { profileId: null },
      { model: null },
      { profileId: null, model: null },
    ]) {
      expect(validate({ ...baseRequest, provider })).toBe(false)
    }
  })

  test("keeps output envelopes tied to stable v1 envelope definitions", () => {
    const schema = loadSchema()
    const serializedJob = def(schema, "serializedAgentJob")
    const serializedJobProperties = serializedJob.properties as Record<
      string,
      SchemaObject
    >
    const eventEnvelope = def(schema, "eventEnvelope")
    const eventProperties = eventEnvelope.properties as Record<
      string,
      SchemaObject
    >
    const resultEnvelope = def(schema, "resultEnvelope")
    const resultProperties = resultEnvelope.properties as Record<
      string,
      SchemaObject
    >
    const runtimeManifest = def(schema, "runtimeManifest")
    const runtimeManifestProperties = runtimeManifest.properties as Record<
      string,
      SchemaObject
    >
    const runtimeManifestEnvelope = def(schema, "runtimeManifestEnvelope")
    const runtimeManifestEnvelopeProperties =
      runtimeManifestEnvelope.properties as Record<string, SchemaObject>
    const createResponse = def(schema, "createResponseEnvelope")
    const createProperties = createResponse.properties as Record<
      string,
      SchemaObject
    >

    expect(schemaEnum(serializedJobProperties.source)).toEqual([
      ...AGENT_JOB_SOURCES,
    ])
    expect(serializedJobProperties.kind).toEqual({ $ref: "#/$defs/jobKind" })
    expect(eventProperties.type.$ref).toBe("#/$defs/eventType")
    expect((resultProperties.artifacts as SchemaObject).items).toEqual({
      $ref: "#/$defs/artifact",
    })
    expect((resultProperties.diagnostics as SchemaObject).items).toEqual({
      $ref: "#/$defs/diagnostic",
    })
    expect(resultProperties.resolvedProvider).toEqual({
      $ref: "#/$defs/resolvedProvider",
    })
    expect(runtimeManifestProperties.readiness).toEqual({
      $ref: "#/$defs/runtimeReadiness",
    })
    expect(runtimeManifestEnvelopeProperties.features).toMatchObject({
      type: "array",
    })
    expect(createProperties.job).toEqual({
      $ref: "#/$defs/serializedAgentJob",
    })
    expect(createProperties.result).toEqual({
      $ref: "#/$defs/resultEnvelope",
    })
  })

  test("validates a real result envelope built by the Local Job API serializer", () => {
    const schema = loadSchema()
    const validate = schemaValidator(schema, "#/$defs/resultEnvelope")
    const artifacts: LocalJobApiArtifact[] = [
      {
        role: "result-json",
        path: "/tmp/locus-schema-project/.locus/runs/job_schema_result/result.json",
        sha256: "abcdef0123456789",
        contentType: "application/json",
        sizeBytes: 42,
      },
    ]
    const envelope = toLocalJobApiResultEnvelope(exampleAgentJob(), artifacts)

    expect(validate(envelope), JSON.stringify(validate.errors, null, 2)).toBe(
      true,
    )
  })

  test("validates completion result and usage event envelopes", () => {
    const schema = loadSchema()
    const validateResult = schemaValidator(schema, "#/$defs/resultEnvelope")
    const validateEvent = schemaValidator(schema, "#/$defs/eventEnvelope")
    const resultEnvelope = toLocalJobApiResultEnvelope(
      exampleAgentJob({
        id: "job_schema_completion",
        kind: "completion",
        mode: "agent",
        projectId: null,
        artifactBaseDir: null,
        artifactManifestPath: null,
        providerProfileId: "completion-main",
        modelOverride: "provider-model",
        status: "succeeded",
        exitCode: 0,
        errorCode: null,
        errorMessage: null,
        resultJson: JSON.stringify({
          content: {
            label: "example",
          },
          usage: {
            inputTokens: 4,
            outputTokens: 2,
          },
          resolvedProvider: {
            source: "request-profile",
            profileId: "completion-main",
            model: "provider-model",
          },
        }),
      }),
      [],
    )
    const usageEvent = {
      apiVersion: LOCAL_JOB_API_VERSION,
      jobId: "job_schema_completion",
      sequence: 2,
      type: "usage_update",
      createdAt: "2026-06-15T00:00:01.500Z",
      payload: {
        usage: {
          inputTokens: 4,
          outputTokens: 2,
        },
      },
    }

    expect(
      validateResult(resultEnvelope),
      JSON.stringify(validateResult.errors, null, 2),
    ).toBe(true)
    expect(
      validateEvent(usageEvent),
      JSON.stringify(validateEvent.errors, null, 2),
    ).toBe(true)
  })
})
