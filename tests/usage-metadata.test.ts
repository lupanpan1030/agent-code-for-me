import { describe, expect, test } from "bun:test"
import { normalizeRuntimeUsage } from "../src/shared/usage-metadata"

describe("runtime usage normalization", () => {
  test("derives the same cache ratio for Claude-exclusive and Codex-inclusive inputs", () => {
    expect(
      normalizeRuntimeUsage({
        provider: "claude",
        inputTokens: 60,
        cacheReadInputTokens: 40,
        cacheCreationInputTokens: 0,
        outputTokens: 20,
      }),
    ).toMatchObject({
      totalInputContextTokens: 100,
      cacheHitRatio: 0.4,
    })

    expect(
      normalizeRuntimeUsage({
        provider: "codex",
        adapterSource: "codex-app-server",
        inputTokens: 100,
        cachedInputTokens: 40,
        outputTokens: 20,
        totalTokens: 120,
      }),
    ).toMatchObject({
      cacheReadInputTokens: 40,
      totalInputContextTokens: 100,
      cacheHitRatio: 0.4,
    })
  })

  test("does not double-count inclusive cached input when total tokens are unavailable", () => {
    expect(
      normalizeRuntimeUsage({
        provider: "codex",
        adapterSource: "codex-app-server",
        inputTokens: 100,
        cachedInputTokens: 40,
      }),
    ).toMatchObject({
      cacheReadInputTokens: 40,
      totalInputContextTokens: 100,
      cacheHitRatio: 0.4,
    })
  })

  test("omits the ratio when cache data or an input baseline is unavailable", () => {
    expect(
      normalizeRuntimeUsage({
        provider: "claude",
        inputTokens: 60,
        outputTokens: 20,
      }).cacheHitRatio,
    ).toBeUndefined()

    expect(
      normalizeRuntimeUsage({
        provider: "claude",
        cacheReadInputTokens: 40,
      }).cacheHitRatio,
    ).toBeUndefined()
  })

  test("bounds the ratio to one", () => {
    expect(
      normalizeRuntimeUsage({
        provider: "codex",
        adapterSource: "codex-app-server",
        inputTokens: 5,
        cachedInputTokens: 10,
      }),
    ).toMatchObject({
      totalInputContextTokens: 5,
      cacheHitRatio: 1,
    })
  })
})
