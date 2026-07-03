import { afterEach, describe, expect, mock, test } from "bun:test"

const openExternal = mock(async () => {})

mock.module("electron", () => ({
  shell: {
    openExternal,
  },
}))

const { openExternalUrl } = await import("../src/main/lib/local-only")

afterEach(() => {
  openExternal.mockClear()
  delete process.env.LOCUS_LOCAL_ONLY
})

describe("main-process external URL opening", () => {
  test.each([
    "https://example.com/docs",
    "http://localhost:3000/callback",
    "mailto:test@example.com",
  ])("allows safe external URL scheme %p", async (url) => {
    await openExternalUrl("test open external URL", url)

    expect(openExternal).toHaveBeenCalledWith(url)
  })

  test.each([
    "file:///tmp/locus-secret.txt",
    "javascript:alert(1)",
    "locus://open/settings",
    "not a url",
  ])("blocks disallowed external URL scheme %p", async (url) => {
    process.env.LOCUS_LOCAL_ONLY = "0"

    await expect(
      openExternalUrl("test open external URL", url),
    ).rejects.toThrow("Blocked external open of disallowed scheme")
    expect(openExternal).not.toHaveBeenCalled()
  })
})
