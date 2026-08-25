import { afterEach, describe, expect, mock, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  type LocalChatCompletionProviderConfig,
  logProviderRequestFailure,
  redactAndTruncateUtilityProviderText,
  redactUtilityProviderErrorMessage,
  redactUtilityProviderText,
} from "../src/main/lib/utility-chat-completion"
import { EXACT_SECRET_REDACTION_MARKER } from "../src/shared/secret-redaction-policy"

const CONFIGURED_TOKEN = "configured-helper-token"
const config: LocalChatCompletionProviderConfig = {
  apiKey: CONFIGURED_TOKEN,
  apiUrl: "https://helper.example.com/v1/chat/completions",
  model: "helper-model",
  authMode: "bearer",
}

const originalConsoleError = console.error

describe("utility provider output redaction", () => {
  afterEach(() => {
    console.error = originalConsoleError
  })

  test("redacts configured tokens from successful output and errors", () => {
    const success = redactUtilityProviderText(
      `generated configured-helper-token title`,
      config,
    )
    const failure = redactUtilityProviderErrorMessage(
      new Error("request failed with configured-helper-token"),
      config,
    )

    expect(success).not.toContain("configured-helper-token")
    expect(failure).not.toContain("configured-helper-token")
    expect(success).toContain(EXACT_SECRET_REDACTION_MARKER)
    expect(failure).toContain(EXACT_SECRET_REDACTION_MARKER)
  })

  test("redacts configured tokens from provider failure logs", async () => {
    const errors: unknown[][] = []
    console.error = mock((...args: unknown[]) => {
      errors.push(args)
    }) as typeof console.error

    await logProviderRequestFailure(
      "Helper",
      new Response("upstream echoed configured-helper-token", { status: 500 }),
      config,
    )

    expect(JSON.stringify(errors)).not.toContain("configured-helper-token")
  })

  test("redacts the full provider failure body before truncating it", async () => {
    const errors: unknown[][] = []
    console.error = mock((...args: unknown[]) => {
      errors.push(args)
    }) as typeof console.error
    const tokenPrefixAtBoundary = CONFIGURED_TOKEN.slice(0, 12)

    await logProviderRequestFailure(
      "Helper",
      new Response(`${"x".repeat(490)}${CONFIGURED_TOKEN}-after-boundary`, {
        status: 500,
      }),
      config,
    )

    const logged = JSON.stringify(errors)
    expect(logged).not.toContain(CONFIGURED_TOKEN)
    expect(logged).not.toContain(tokenPrefixAtBoundary)
  })

  test("shares redact-before-truncate semantics with headless completions", () => {
    const tokenPrefixAtBoundary = CONFIGURED_TOKEN.slice(0, 12)
    const detail = `${"x".repeat(490)}${CONFIGURED_TOKEN}-after-boundary`

    const truncated = redactAndTruncateUtilityProviderText(detail, config, 500)

    expect(truncated).toHaveLength(500)
    expect(truncated).toContain(EXACT_SECRET_REDACTION_MARKER)
    expect(truncated).not.toContain(CONFIGURED_TOKEN)
    expect(truncated).not.toContain(tokenPrefixAtBoundary)
  })

  test("title and commit helper returns pass provider output through exact redaction", () => {
    const source = readFileSync(
      "src/main/lib/trpc/routers/chats-helpers.ts",
      "utf8",
    )

    expect(
      source.match(/redactUtilityProviderText\(content, config\)/g),
    ).toHaveLength(2)
    expect(
      source.match(/redactUtilityProviderErrorMessage\(error, config\)/g),
    ).toHaveLength(2)
    expect(
      source.match(/logProviderRequestFailure\([^\n]+config\)/g),
    ).toHaveLength(2)

    const completionSource = readFileSync(
      "src/main/lib/headless/completion-runner.ts",
      "utf8",
    )
    expect(completionSource).toContain("redactAndTruncateUtilityProviderText(")
  })
})
