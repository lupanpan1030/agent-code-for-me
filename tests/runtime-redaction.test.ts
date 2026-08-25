import { describe, expect, test } from "bun:test"
import {
  createExactSecretStreamRedactor,
  redactExactSecretHints,
  redactRuntimePayload,
} from "../src/main/lib/agent-runtime/redaction"
import { redactRendererRuntimeChunk } from "../src/main/lib/agent-runtime/stream-event-mapper"
import { EXACT_SECRET_REDACTION_MARKER } from "../src/shared/secret-redaction-policy"

describe("runtime trace redaction", () => {
  test("redacts exact secrets split across stream fragments without losing normal suffixes", () => {
    const secret = "upstream-token-0123456789"
    const redactor = createExactSecretStreamRedactor()
    const output = [
      redactor.push(`normal ${secret.slice(0, 13)}`, [secret]).value,
      redactor.push(`${secret.slice(13)} tail`, [secret]).value,
      redactor.flush([secret]).value,
    ].join("")

    expect(output).toBe(`normal ${EXACT_SECRET_REDACTION_MARKER} tail`)
    expect(output).not.toContain(secret)

    const normalRedactor = createExactSecretStreamRedactor()
    const normalOutput = [
      normalRedactor.push("kept upstream", [secret]).value,
      normalRedactor.flush([secret]).value,
    ].join("")
    expect(normalOutput).toBe("kept upstream")
  })

  test("uses an exact-secret marker that cannot contain a valid credential", () => {
    const collisionCandidate = "redacted"
    const result = redactExactSecretHints(
      `before ${collisionCandidate} after`,
      [collisionCandidate],
    )

    expect(result.applied).toBe(true)
    expect(result.redactionCount).toBe(1)
    expect(result.value).toBe(`before ${EXACT_SECRET_REDACTION_MARKER} after`)
    expect(result.value).not.toContain(collisionCandidate)
    expect(EXACT_SECRET_REDACTION_MARKER.length).toBeLessThan(
      collisionCandidate.length,
    )
  })

  test("redacts overlapping exact hints longest-first", () => {
    const shortSecret = "abcdefgh"
    const longSecret = `${shortSecret}XYZ`
    const result = redactExactSecretHints(
      `token=${longSecret} short=${shortSecret}`,
      [shortSecret, longSecret],
    )

    expect(result.value).toBe(
      `token=${EXACT_SECRET_REDACTION_MARKER} short=${EXACT_SECRET_REDACTION_MARKER}`,
    )
    expect(result.value).not.toContain("XYZ")
    expect(result.redactionCount).toBe(2)
  })

  test("redacts a protected hint created by marker and surrounding text", () => {
    const sourceSecret = "abcdefgh"
    const generatedSecret = `${EXACT_SECRET_REDACTION_MARKER}XYZ`
    const result = redactExactSecretHints(`${sourceSecret}XYZ`, [
      sourceSecret,
      generatedSecret,
    ])

    expect(result.value).toBe(EXACT_SECRET_REDACTION_MARKER)
    expect(result.value).not.toContain(generatedSecret)
    expect(result.redactionCount).toBe(2)
  })

  test("redacts overlapping exact hints longest-first across stream fragments", () => {
    const shortSecret = "abcdefgh"
    const longSecret = `${shortSecret}XYZ`
    const redactor = createExactSecretStreamRedactor()
    const output = [
      redactor.push("token=abc", [shortSecret, longSecret]).value,
      redactor.push("defghXYZ", [shortSecret, longSecret]).value,
      redactor.flush([shortSecret, longSecret]).value,
    ].join("")

    expect(output).toBe(`token=${EXACT_SECRET_REDACTION_MARKER}`)
    expect(output).not.toContain("XYZ")
  })

  test("redacts secret-bearing keys recursively", () => {
    const result = redactRuntimePayload(
      {
        provider: {
          apiKey: "sk-test-secret-value",
          nested: { authorization: "Bearer abc.def.ghi" },
        },
        safe: "visible",
      },
      {
        runtimeId: "codex",
        runId: "run-1",
        source: "desktop-adapter",
      },
    )

    expect(result.payload).toEqual({
      provider: {
        apiKey: "<redacted>",
        nested: { authorization: "<redacted>" },
      },
      safe: "visible",
    })
    expect(result.appliedRules).toEqual(["secret-key"])
  })

  test("redacts secret-like strings without hiding safe text", () => {
    const result = redactRuntimePayload(
      {
        message: "failed with bearer abc.def.ghi and api_key=xyz123",
        status: "blocked",
      },
      {
        runtimeId: "claude-code",
        runId: "run-1",
        source: "runtime-diagnostic",
      },
    )

    expect(result.payload).toEqual({
      message: "failed with <redacted> and api_key=<redacted>",
      status: "blocked",
    })
    expect(result.appliedRules).toEqual(["secret-text"])
  })

  test("redacts exact secret hints even when the text has no secret prefix", () => {
    const runtimeToken =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    const result = redactRuntimePayload(
      {
        message: `Codex stderr echoed token ${runtimeToken}`,
        nested: {
          header: `Authorization: Bearer ${runtimeToken}`,
        },
      },
      {
        runtimeId: "codex",
        runId: "run-1",
        source: "desktop-adapter",
        secretHints: [runtimeToken],
      },
    )

    expect(JSON.stringify(result.payload)).not.toContain(runtimeToken)
    expect(result.payload).toEqual({
      message: `Codex stderr echoed token ${EXACT_SECRET_REDACTION_MARKER}`,
      nested: {
        header: `Authorization: Bearer ${EXACT_SECRET_REDACTION_MARKER}`,
      },
    })
    expect(result.appliedRules).toEqual(["secret-hint"])
  })

  test("redacts renderer runtime chunks beyond diagnostic chunk types", () => {
    const chunk = redactRendererRuntimeChunk({
      runtimeId: "codex",
      runId: "run-1",
      source: "runtime-diagnostic",
      chunk: {
        type: "ask-user-answer",
        delta: "provider returned Bearer abc.def.ghi with api_key=xyz123",
      },
    })

    expect(chunk).toEqual({
      type: "ask-user-answer",
      delta: "provider returned <redacted> with api_key=<redacted>",
    })
  })

  test("redacts secret hints from renderer runtime chunks", () => {
    const gatewayToken = "gateway-token-secret-value"
    const chunk = redactRendererRuntimeChunk({
      runtimeId: "claude-code",
      runId: "run-1",
      source: "runtime-diagnostic",
      secretHints: [gatewayToken],
      chunk: {
        type: "runtime-status",
        ok: false,
        blocker: {
          message: `profile gateway rejected ${gatewayToken}`,
        },
      },
    })

    expect(JSON.stringify(chunk)).not.toContain(gatewayToken)
    expect(chunk).toMatchObject({
      type: "runtime-status",
      blocker: {
        message: `profile gateway rejected ${EXACT_SECRET_REDACTION_MARKER}`,
      },
    })
  })
})
