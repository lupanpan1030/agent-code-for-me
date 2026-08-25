import { describe, expect, test } from "bun:test"
import {
  appendCodexLoginOutput,
  CODEX_LOGIN_OUTPUT_OMITTED,
  extractFirstNonLocalhostUrl,
  isLocalhostHostname,
  redactCodexLoginOutput,
  redactCodexLoginUrlForDisplay,
} from "../src/main/lib/codex/login-output"

describe("Codex login output helpers", () => {
  test("recognizes localhost hosts and extracts the first remote URL", () => {
    expect(isLocalhostHostname("localhost")).toBe(true)
    expect(isLocalhostHostname("127.0.0.1")).toBe(true)
    expect(isLocalhostHostname("auth.localhost")).toBe(true)
    expect(isLocalhostHostname("example.com")).toBe(false)

    expect(
      extractFirstNonLocalhostUrl(
        "open http://localhost:1455 then https://auth.example.com/device?code=secret.",
      ),
    ).toBe("https://auth.example.com/device?code=secret")
  })

  test("redacts remote URLs, API keys, and token-like query fragments", () => {
    expect(
      redactCodexLoginUrlForDisplay(
        "https://auth.example.com/device?code=secret#frag.",
      ),
    ).toBe("https://auth.example.com/device?[redacted]#[redacted].")
    expect(
      redactCodexLoginUrlForDisplay("http://localhost:3000/callback?code=x"),
    ).toBe("http://localhost:3000/callback?code=x")
    expect(
      redactCodexLoginOutput(
        'key sk-1234567890abcdef token code=secret {"access_token":"abc"}',
      ),
    ).toBe(
      'key sk-[redacted] token code=[redacted] {"access_token":"[redacted]"}',
    )
  })

  test("omits credential-bound stream output and stores the first remote login URL", () => {
    const session = { rawOutput: "", output: "", url: null as string | null }

    appendCodexLoginOutput(
      session,
      "\u001B[31mOpen https://auth.example.com/device?code=secret\u001B[0m",
    )
    appendCodexLoginOutput(session, " and sk-1234567890abcdef")

    expect(session.rawOutput).toBe("")
    expect(session.output).toBe(CODEX_LOGIN_OUTPUT_OMITTED)
    expect(session.url).toBe("https://auth.example.com/device?code=secret")
  })

  test("never exposes split login URLs or API keys between callbacks", () => {
    const session = { rawOutput: "", output: "", url: null as string | null }
    const apiKey = "sk-1234567890abcdef"

    appendCodexLoginOutput(
      session,
      `Open https://auth.example.com/device?state=secret-${apiKey.slice(0, 8)}`,
    )
    expect(session.output).toBe(CODEX_LOGIN_OUTPUT_OMITTED)
    expect(session.output).not.toContain(apiKey.slice(0, 8))

    appendCodexLoginOutput(session, `${apiKey.slice(8)}\n`)
    expect(session.output).toBe(CODEX_LOGIN_OUTPUT_OMITTED)
    expect(session.output).not.toContain(apiKey)
    expect(session.url).toContain("https://auth.example.com/device?")
  })
})
