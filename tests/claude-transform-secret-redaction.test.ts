import { afterEach, describe, expect, mock, test } from "bun:test"
import { createTransformer } from "../src/main/lib/claude/transform"

const originalConsoleError = console.error

describe("Claude stream transform diagnostic redaction", () => {
  afterEach(() => {
    console.error = originalConsoleError
  })

  test("redacts invalid tool input fully before truncating its diagnostic", () => {
    const token = "configured-transform-secret-token"
    const tokenPrefixAtBoundary = token.slice(0, 12)
    const errors: unknown[][] = []
    console.error = mock((...args: unknown[]) => {
      errors.push(args)
    }) as typeof console.error
    const transform = createTransformer({ secretHints: [token] })

    ;[
      ...transform({
        type: "stream_event",
        event: {
          type: "content_block_start",
          content_block: { type: "tool_use", id: "tool-1", name: "Bash" },
        },
      }),
    ]
    ;[
      ...transform({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: {
            type: "input_json_delta",
            partial_json: `${"x".repeat(110)}${token}`,
          },
        },
      }),
    ]
    ;[
      ...transform({
        type: "stream_event",
        event: { type: "content_block_stop" },
      }),
    ]

    const logged = JSON.stringify(errors)
    expect(logged).not.toContain(token)
    expect(logged).not.toContain(tokenPrefixAtBoundary)
  })
})
