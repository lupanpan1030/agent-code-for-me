/**
 * Implementation tests (task 4.2/4.8, GP-05) for the `locus-preview` broker
 * under D7 option (a): the stable-directory descriptor-owner extensions and
 * the owner's `serveLocusPreviewRequest`, against a real temporary worktree
 * built from `tests/fixtures/renderer-hardening/preview-worktree.json`.
 *
 * Actual guest fetch/XHR/iframe-contentDocument/script-src read/execution
 * results, custom-scheme gate observability and HTTP(S)-guest scheme denial
 * are runtime observations for GUI tracks 5.2/5.3; here the same request
 * matrix is modeled through the Session gate verdict plus the protocol
 * decision.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  closeStableDirectory,
  openRegisteredStableDirectory,
  openStableDirectory,
  readStableDirectoryFile,
  type StableDirectoryHandle,
} from "../src/main/lib/filesystem/stable-directory"
import {
  decideGuestRequest,
  type FilePreviewBinding,
  type GuestOriginPolicy,
  readFilePreviewAsset,
  serveLocusPreviewRequest,
} from "../src/main/windows/local-browser-guest-policy"

const HOST = "00112233445566778899aabbccddeeff.preview.local"
const OTHER_HOST = "ffeeddccbbaa99887766554433221100.preview.local"

let sandbox = ""
const handles: StableDirectoryHandle[] = []

beforeEach(() => {
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), "locus-impl-broker-")))
})

afterEach(() => {
  for (const handle of handles.splice(0)) closeStableDirectory(handle)
  rmSync(sandbox, { recursive: true, force: true })
})

function materialize() {
  const spec = JSON.parse(
    readFileSync(
      join(
        import.meta.dir,
        "fixtures/renderer-hardening/preview-worktree.json",
      ),
      "utf8",
    ),
  ) as {
    files: Record<string, string>
    escapeLinkName: string
    outsideSecret: string
  }
  const root = join(sandbox, "worktree")
  const outside = join(sandbox, "outside")
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(outside, "secret.txt"), spec.outsideSecret)
  for (const [relativePath, content] of Object.entries(spec.files)) {
    const target = join(root, relativePath)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  symlinkSync(outside, join(root, "site", spec.escapeLinkName), "dir")
  return { root, outside, spec }
}

function bindingFor(
  root: string,
  scopeSegments: string[],
  live = { value: true },
): FilePreviewBinding {
  const stat = lstatSync(root)
  return {
    host: HOST,
    registeredRoot: root,
    canonicalRoot: realpathSync(root),
    rootDev: stat.dev,
    rootIno: stat.ino,
    scopeSegments,
    isLive: () => live.value,
  }
}

function serve(binding: FilePreviewBinding, path: string, method = "GET") {
  return serveLocusPreviewRequest(binding, {
    url: `locus-preview://${binding.host}${path}`,
    method,
  })
}

function text(response: { body: Uint8Array | null }): string {
  return response.body ? Buffer.from(response.body).toString("utf8") : ""
}

describe("stable-directory extensions (single descriptor owner)", () => {
  test("openRegisteredStableDirectory canonicalizes a symlinked parent prefix and verifies registered/canonical/opened identity", () => {
    const real = join(sandbox, "real", "wt")
    mkdirSync(real, { recursive: true })
    symlinkSync(join(sandbox, "real"), join(sandbox, "link"), "dir")
    const registered = join(sandbox, "link", "wt")
    const handle = openRegisteredStableDirectory(registered, "Preview root")
    handles.push(handle)
    expect(handle.path).toBe(real)
    const stat = lstatSync(registered)
    expect({ dev: handle.dev, ino: handle.ino }).toEqual({
      dev: stat.dev,
      ino: stat.ino,
    })
  })

  test("a terminal symlink registered root is refused", () => {
    const real = join(sandbox, "real")
    mkdirSync(real)
    symlinkSync(real, join(sandbox, "leaf-link"), "dir")
    expect(() =>
      openRegisteredStableDirectory(join(sandbox, "leaf-link"), "Preview root"),
    ).toThrow(/must be a real directory, not a symlink/)
  })

  test("readStableDirectoryFile reads a regular file from the verified descriptor and refuses symlink leaves, directories, FIFOs and oversize files", () => {
    const directory = join(sandbox, "dir")
    mkdirSync(join(directory, "nested"), { recursive: true })
    writeFileSync(join(directory, "ok.txt"), "hello")
    writeFileSync(join(sandbox, "outside.txt"), "OUTSIDE")
    symlinkSync(join(sandbox, "outside.txt"), join(directory, "leaf.txt"))
    execFileSync("mkfifo", [join(directory, "pipe")])
    const handle = openStableDirectory(directory, "Test")
    handles.push(handle)

    const file = readStableDirectoryFile(handle, "ok.txt", "Test file", {
      maxBytes: 1024,
    })
    expect(file.bytes.toString("utf8")).toBe("hello")
    expect(file.size).toBe(5)
    expect(() =>
      readStableDirectoryFile(handle, "leaf.txt", "Test file", {
        maxBytes: 1024,
      }),
    ).toThrow()
    expect(() =>
      readStableDirectoryFile(handle, "nested", "Test file", {
        maxBytes: 1024,
      }),
    ).toThrow(/regular file/)
    expect(() =>
      readStableDirectoryFile(handle, "pipe", "Test file", { maxBytes: 1024 }),
    ).toThrow(/regular file/)
    expect(() =>
      readStableDirectoryFile(handle, "ok.txt", "Test file", { maxBytes: 2 }),
    ).toThrow(/allowed size/)
    expect(() =>
      readStableDirectoryFile(handle, "../outside.txt", "Test file", {
        maxBytes: 1024,
      }),
    ).toThrow(/single path component/)
  })
})

describe("serveLocusPreviewRequest — declared scope defaults to the document directory subtree", () => {
  test("the admitted document and in-scope relative assets are served from the anchored descriptors", () => {
    const { root } = materialize()
    const binding = bindingFor(root, ["site"])
    const document = serve(binding, "/index.html")
    expect(document.status).toBe(200)
    expect(document.contentType).toContain("text/html")
    expect(text(document)).toContain("<html")
    const asset = serve(binding, "/assets/app.js")
    expect(asset.status).toBe(200)
    expect(asset.contentType).toContain("javascript")
    expect(text(asset)).toContain("inScopeAssetLoaded")
    const head = serve(binding, "/index.html", "HEAD")
    expect(head).toMatchObject({ status: 200, body: null })
  })

  test("parent-directory, sibling and symlink-escape reads fail closed for every path form", () => {
    const { root, spec } = materialize()
    const binding = bindingFor(root, ["site"])
    for (const path of [
      "/../secret-parent.txt",
      "/%2e%2e/secret-parent.txt",
      "/..%2Fsecret-parent.txt",
      "/../other/private.txt",
      "/secret-parent.txt",
      `/${spec.escapeLinkName}/secret.txt`,
      "/assets/",
      "/",
    ]) {
      const response = serve(binding, path)
      expect(response.status).not.toBe(200)
      expect(response.body).toBeNull()
    }
  })

  test("another admission's host, a stale binding and non-GET methods are refused", () => {
    const { root } = materialize()
    const live = { value: true }
    const binding = bindingFor(root, ["site"], live)
    expect(
      serveLocusPreviewRequest(binding, {
        url: `locus-preview://${OTHER_HOST}/index.html`,
        method: "GET",
      }).status,
    ).toBe(403)
    expect(
      serveLocusPreviewRequest(binding, {
        url: `locus-preview://user:pw@${HOST}/index.html`,
        method: "GET",
      }).status,
    ).toBe(403)
    expect(serve(binding, "/index.html", "POST").status).toBe(405)
    live.value = false
    expect(serve(binding, "/index.html").status).toBe(403)
  })

  test("registered-root identity drift after admission fails closed (no path-only fallback)", () => {
    const { root } = materialize()
    const binding = bindingFor(root, ["site"])
    renameSync(root, join(sandbox, "moved"))
    mkdirSync(join(root, "site"), { recursive: true })
    writeFileSync(join(root, "site", "index.html"), "REPLACED")
    const response = serve(binding, "/index.html")
    expect(response.status).toBe(404)
    expect(text(response)).not.toContain("REPLACED")
  })

  test("a registered root replaced by a symlink after admission fails closed", () => {
    const { root } = materialize()
    const binding = bindingFor(root, ["site"])
    renameSync(root, join(sandbox, "moved"))
    symlinkSync(join(sandbox, "moved"), root, "dir")
    expect(serve(binding, "/index.html").status).toBe(404)
  })

  test("a scope directory swapped for a symlink after admission is refused", () => {
    const { root, outside } = materialize()
    const binding = bindingFor(root, ["site"])
    renameSync(join(root, "site"), join(sandbox, "site-moved"))
    writeFileSync(join(outside, "index.html"), "OUTSIDE-DOC")
    symlinkSync(outside, join(root, "site"), "dir")
    const response = serve(binding, "/index.html")
    expect(response.status).toBe(404)
    expect(text(response)).not.toContain("OUTSIDE")
  })

  test("readFilePreviewAsset rejects an empty relative path", () => {
    const { root } = materialize()
    expect(readFilePreviewAsset(bindingFor(root, ["site"]), [])).toBeNull()
  })
})

describe("cross-file request matrix (fetch / XHR / iframe / script src) — gate verdict + protocol decision", () => {
  const policy: GuestOriginPolicy = {
    kind: "file",
    host: HOST,
    documentSegments: ["index.html"],
  }

  function outcome(
    binding: FilePreviewBinding,
    url: string,
    resourceType: string,
  ): "served" | "cancelled" | "denied" {
    if (decideGuestRequest(policy, true, { url, resourceType }).cancel) {
      return "cancelled"
    }
    return serveLocusPreviewRequest(binding, { url, method: "GET" }).status ===
      200
      ? "served"
      : "denied"
  }

  test("in-scope controls are served; out-of-scope worktree files and other hosts are not, for every resource type", () => {
    const { root } = materialize()
    const binding = bindingFor(root, ["site"])
    for (const resourceType of [
      "xhr",
      "subFrame",
      "script",
      "image",
      "other",
    ]) {
      expect(
        outcome(binding, `locus-preview://${HOST}/assets/app.js`, resourceType),
      ).toBe("served")
      for (const url of [
        `locus-preview://${HOST}/../other/private.txt`,
        `locus-preview://${HOST}/../secret-parent.txt`,
        `locus-preview://${HOST}/escape-assets/secret.txt`,
      ]) {
        expect(outcome(binding, url, resourceType)).toBe("denied")
      }
      expect(
        outcome(
          binding,
          `locus-preview://${OTHER_HOST}/index.html`,
          resourceType,
        ),
      ).toBe("cancelled")
      expect(
        outcome(binding, `file://${root}/other/private.txt`, resourceType),
      ).toBe("cancelled")
    }
  })
})
