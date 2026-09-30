/**
 * Test-first suite for `openspec/changes/add-renderer-untrusted-content-hardening`
 * — DOMAIN C, the `locus-preview://` registered-root file broker under the
 * Owner-decided D7 option (a) (2026-09-08).
 *
 * Spec anchors: runtime-security-baseline Scenario "Preview attempts file-root
 * escape"; local-browser-workbench Scenarios "The registered file root needs
 * canonicalization", "An admitted file attempts cross-file or cross-admission
 * reads" and "Safe file broker is unavailable"; design D7 and verification.md
 * fixture GP-05.
 *
 * The package names the owner that the broker MUST extend
 * (`src/main/lib/filesystem/stable-directory.ts`, "extends ... with final
 * regular-file open/same-descriptor streaming rather than creating a second
 * descriptor backend") but names no exported identifier for the new broker
 * read, the per-admission host binding, or the scope verdicts. This file
 * therefore:
 *
 * - characterizes (GREEN on the baseline by design) the existing descriptor
 *   owner's fail-closed rules the broker is required to reuse: terminal
 *   symlink root rejection, canonical-path requirement with a
 *   canonicalize-then-anchor positive control for a symlinked parent prefix,
 *   child-symlink escape denial, single-component child names, identity-drift
 *   detection, and the win32 "no verified directory-fd anchor" refusal that
 *   makes file preview ship disabled on Windows; and
 * - asserts statically (RED on the baseline) the D7 wiring that a static check
 *   can observe: exact `locus-preview` scheme privileges, Session-scoped
 *   `protocol.handle`, composition over the stable-directory owner, no
 *   path-only/`net.fetch(file:)` fallback, and the owner's regular-file
 *   verification.
 *
 * Real custom-scheme request routing, cross-file fetch/XHR/iframe/script
 * results and HTTP(S)-Session scheme rejection are runtime observations owned
 * by GUI tracks 5.2/5.3 and are not claimed here.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import {
  assertStableDirectoryPath,
  closeStableDirectory,
  openStableDirectory,
  openStableDirectoryChild,
  type StableDirectoryHandle,
  stableDirectoryChildPath,
} from "../src/main/lib/filesystem/stable-directory"

const repoRoot = resolve(import.meta.dir, "..")
const STABLE_DIRECTORY_OWNER = "src/main/lib/filesystem/stable-directory.ts"
const FIXTURE_DIR = join(import.meta.dir, "fixtures/renderer-hardening")

let sandbox = ""
const openHandles: StableDirectoryHandle[] = []

beforeEach(() => {
  // realpath so the sandbox itself is canonical even where tmpdir is a symlink
  // (e.g. macOS /tmp -> /private/tmp).
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), "locus-preview-broker-")))
})

afterEach(() => {
  for (const handle of openHandles.splice(0)) closeStableDirectory(handle)
  rmSync(sandbox, { recursive: true, force: true })
  sandbox = ""
})

function track(handle: StableDirectoryHandle): StableDirectoryHandle {
  openHandles.push(handle)
  return handle
}

/**
 * Materializes the malicious worktree fixture from
 * tests/fixtures/renderer-hardening/preview-worktree.json into the sandbox:
 * an admitted document directory with an in-scope asset, an out-of-scope
 * sibling secret, a parent-directory secret, and a symlinked asset directory
 * that escapes the registered root.
 */
function materializeWorktree(): {
  registeredRoot: string
  documentDir: string
  outsideDir: string
} {
  const spec = JSON.parse(
    readFileSync(join(FIXTURE_DIR, "preview-worktree.json"), "utf8"),
  ) as {
    files: Record<string, string>
    escapeLinkName: string
    outsideSecret: string
  }
  const registeredRoot = join(sandbox, "worktree")
  const outsideDir = join(sandbox, "outside")
  mkdirSync(outsideDir, { recursive: true })
  writeFileSync(join(outsideDir, "secret.txt"), spec.outsideSecret)
  for (const [relativePath, content] of Object.entries(spec.files)) {
    const target = join(registeredRoot, relativePath)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  const documentDir = join(registeredRoot, "site")
  symlinkSync(outsideDir, join(documentDir, spec.escapeLinkName), "dir")
  // Verify the fixture actually produced what the assertions assume.
  expect(
    lstatSync(join(documentDir, spec.escapeLinkName)).isSymbolicLink(),
  ).toBe(true)
  expect(readFileSync(join(documentDir, "index.html"), "utf8")).toContain(
    "<html",
  )
  return { registeredRoot, documentDir, outsideDir }
}

// ---------------------------------------------------------------------------
// Source-scan helpers (static guards)
// ---------------------------------------------------------------------------
const SOURCE_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/

function walkSources(relativeDir: string): string[] {
  const files: string[] = []
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        if (entry !== "node_modules") visit(full)
      } else if (SOURCE_EXTENSIONS.test(entry)) {
        files.push(relative(repoRoot, full))
      }
    }
  }
  visit(join(repoRoot, relativeDir))
  return files.sort()
}

function readSource(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1")
}

function mainFilesMentioning(pattern: RegExp): string[] {
  return walkSources("src/main").filter((file) =>
    pattern.test(readSource(file)),
  )
}

const LOCUS_PREVIEW = /["'`]locus-preview(?::\/\/|["'`])/

function resolveRelativeImports(file: string): string[] {
  const resolved: string[] = []
  for (const match of readSource(file).matchAll(
    /(?:from\s+|import\s*\(\s*|require\(\s*)["'](\.{1,2}\/[^"']+)["']/g,
  )) {
    const base = join(dirname(file), match[1] as string)
    for (const candidate of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      join(base, "index.ts"),
    ]) {
      const absolute = join(repoRoot, candidate)
      if (existsSync(absolute) && statSync(absolute).isFile()) {
        resolved.push(candidate)
        break
      }
    }
  }
  return resolved
}

/**
 * Files that name the locus-preview scheme literally, plus the src/main files
 * that directly import one of them (the scheme may live in a shared constant).
 */
function previewPathFiles(): string[] {
  const literalFiles = mainFilesMentioning(LOCUS_PREVIEW)
  // Composition roots are excluded so that unrelated transitive imports cannot
  // satisfy the reachability check.
  const compositionRoots = new Set([
    "src/main/index.ts",
    "src/main/windows/main.ts",
  ])
  const importers = walkSources("src/main").filter(
    (file) =>
      !compositionRoots.has(file) &&
      resolveRelativeImports(file).some((target) =>
        literalFiles.includes(target),
      ),
  )
  return [...new Set([...literalFiles, ...importers])].sort()
}

function reachesModule(startFiles: string[], targetFile: string): boolean {
  const seen = new Set<string>()
  const queue = [...startFiles]
  while (queue.length > 0) {
    const file = queue.shift() as string
    if (seen.has(file)) continue
    seen.add(file)
    if (file === targetFile) return true
    queue.push(...resolveRelativeImports(file))
  }
  return false
}

// ===========================================================================
describe('"The registered file root needs canonicalization" — descriptor owner rules the broker reuses (stable-directory.ts)', () => {
  test("a terminal symlink root fails closed (green-by-design guard)", () => {
    const { registeredRoot } = materializeWorktree()
    const symlinkRoot = join(sandbox, "root-link")
    symlinkSync(registeredRoot, symlinkRoot, "dir")
    expect(lstatSync(symlinkRoot).isSymbolicLink()).toBe(true)
    expect(() => openStableDirectory(symlinkRoot, "Preview root")).toThrow(
      /must be a real directory, not a symlink/,
    )
  })

  test("path.resolve() alone is not canonicalization: a symlinked-prefix path is refused, while the realpath-canonicalized root anchors with matching registered/canonical/opened dev+ino (green-by-design positive control)", () => {
    const realParent = join(sandbox, "real-parent")
    const registeredLeaf = join(realParent, "wt")
    mkdirSync(registeredLeaf, { recursive: true })
    const linkParent = join(sandbox, "link-parent")
    symlinkSync(realParent, linkParent, "dir")
    const registeredPath = join(linkParent, "wt")

    // Fixture check: the registered path's leaf is a real directory reached
    // through a symlinked prefix.
    const registeredLstat = lstatSync(registeredPath)
    expect(registeredLstat.isSymbolicLink()).toBe(false)
    expect(registeredLstat.isDirectory()).toBe(true)
    expect(realpathSync(registeredPath)).toBe(registeredLeaf)

    expect(() => openStableDirectory(registeredPath, "Preview root")).toThrow(
      /canonical directory path/,
    )

    const canonical = realpathSync(registeredPath)
    const anchored = track(openStableDirectory(canonical, "Preview root"))
    expect(anchored.path).toBe(registeredLeaf)
    expect({ dev: anchored.dev, ino: anchored.ino }).toEqual({
      dev: registeredLstat.dev,
      ino: registeredLstat.ino,
    })
    expect(() =>
      assertStableDirectoryPath(anchored, "Preview root"),
    ).not.toThrow()
  })

  test("root identity drift after anchoring fails closed (green-by-design guard)", () => {
    const { registeredRoot } = materializeWorktree()
    const anchored = track(openStableDirectory(registeredRoot, "Preview root"))
    renameSync(registeredRoot, join(sandbox, "worktree-moved"))
    mkdirSync(registeredRoot)
    expect(lstatSync(registeredRoot).ino).not.toBe(anchored.ino)
    expect(() => assertStableDirectoryPath(anchored, "Preview root")).toThrow(
      /identity changed/,
    )
  })
})

// ===========================================================================
describe('"Preview attempts file-root escape" — traversal and symlink retargeting fail closed in the anchored namespace', () => {
  test("a symlinked asset directory inside the document scope that points outside the registered root is refused (green-by-design guard)", () => {
    const { registeredRoot } = materializeWorktree()
    const root = track(openStableDirectory(registeredRoot, "Preview root"))
    const site = track(openStableDirectoryChild(root, "site", "Preview scope"))
    expect(() =>
      openStableDirectoryChild(site, "escape-assets", "Preview asset dir"),
    ).toThrow(/must be a real directory, not a symlink/)
  })

  test("parent-directory, empty, dot and multi-component child names are rejected before any read (green-by-design guard)", () => {
    const { registeredRoot } = materializeWorktree()
    const root = track(openStableDirectory(registeredRoot, "Preview root"))
    const site = track(openStableDirectoryChild(root, "site", "Preview scope"))
    const rejected = [
      "..",
      ".",
      "",
      "../secret-parent.txt",
      "assets/app.js",
      "/etc",
    ]
    for (const name of rejected) {
      expect(() => stableDirectoryChildPath(site, name)).toThrow(
        /single path component/,
      )
    }
    // In-scope single component control.
    expect(stableDirectoryChildPath(site, "index.html")).toBe(
      join(site.anchorPath, "index.html"),
    )
  })
})

// ===========================================================================
describe('"Safe file broker is unavailable" — win32 has no verified descriptor anchor', () => {
  test("with the existing owner, win32 cannot anchor a registered root, so file preview is disabled rather than falling back (green-by-design guard)", () => {
    const { registeredRoot } = materializeWorktree()
    const original = Object.getOwnPropertyDescriptor(process, "platform")
    expect(original).toBeDefined()
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    })
    try {
      expect(() => openStableDirectory(registeredRoot, "Preview root")).toThrow(
        "does not expose a verified directory-fd anchor (win32)",
      )
    } finally {
      Object.defineProperty(process, "platform", original as PropertyDescriptor)
    }
    expect(process.platform).not.toBe("win32")
  })

  test("no second descriptor backend: descriptor-namespace anchors exist only in the stable-directory owner (green-by-design guard)", () => {
    const anchorOwners = walkSources("src").filter((file) =>
      /\/proc\/self\/fd|\/dev\/fd\//.test(readSource(file)),
    )
    expect(anchorOwners).toEqual([STABLE_DIRECTORY_OWNER])
  })
})

// ===========================================================================
describe("D7 option (a) — locus-preview broker wiring (static checks; runtime routing is GUI 5.2/5.3)", () => {
  test("the stable-directory owner is extended with final regular-file verification for same-descriptor serving", () => {
    const source = readSource(STABLE_DIRECTORY_OWNER)
    expect(/\.isFile\s*\(\s*\)/.test(source)).toBe(true)
  })

  test("locus-preview is registered as a privileged scheme with exactly standard/secure/supportFetchAPI/corsEnabled true and bypassCSP/allowServiceWorkers/stream/codeCache false", () => {
    const registrations = mainFilesMentioning(
      /\bregisterSchemesAsPrivileged\s*\(/,
    )
    const previewFiles = mainFilesMentioning(LOCUS_PREVIEW)
    const scope = [...new Set([...registrations, ...previewFiles])]
    const combined = scope.map(readSource).join("\n")
    expect(registrations.length).toBeGreaterThan(0)
    expect(previewFiles.length).toBeGreaterThan(0)
    const requiredFlags = [
      /\bstandard\s*:\s*true\b/,
      /\bsecure\s*:\s*true\b/,
      /\bsupportFetchAPI\s*:\s*true\b/,
      /\bcorsEnabled\s*:\s*true\b/,
      /\bbypassCSP\s*:\s*false\b/,
      /\ballowServiceWorkers\s*:\s*false\b/,
      /\bstream\s*:\s*false\b/,
      /\bcodeCache\s*:\s*false\b/,
    ]
    expect(
      requiredFlags.filter((flag) => !flag.test(combined)).map(String),
    ).toEqual([])
    const forbiddenFlags = [
      /\bbypassCSP\s*:\s*true\b/,
      /\ballowServiceWorkers\s*:\s*true\b/,
      /\bstream\s*:\s*true\b/,
      /\bcodeCache\s*:\s*true\b/,
    ]
    expect(
      forbiddenFlags.filter((flag) => flag.test(combined)).map(String),
    ).toEqual([])
  })

  test("protocol.handle for locus-preview is bound only on an issued Session (no global protocol handler, no legacy file/stream protocol APIs)", () => {
    const previewFiles = mainFilesMentioning(LOCUS_PREVIEW)
    expect(previewFiles.length).toBeGreaterThan(0)
    const sources = previewPathFiles().map(readSource)
    expect(
      sources.some((source) => /\.protocol\.handle\s*\(/.test(source)),
    ).toBe(true)
    const globalHandlers = previewFiles.filter((file) =>
      /(?:^|[^.\w$])protocol\.handle\s*\(/m.test(readSource(file)),
    )
    expect(globalHandlers).toEqual([])
    const legacyApis = previewFiles.filter((file) =>
      /\b(?:registerFileProtocol|interceptFileProtocol|registerStreamProtocol|registerBufferProtocol)\s*\(/.test(
        readSource(file),
      ),
    )
    expect(legacyApis).toEqual([])
  })

  test("the locus-preview serving path composes the stable-directory descriptor owner (no path-only read)", () => {
    const previewFiles = mainFilesMentioning(LOCUS_PREVIEW)
    expect(previewFiles.length).toBeGreaterThan(0)
    expect(reachesModule(previewPathFiles(), STABLE_DIRECTORY_OWNER)).toBe(true)
  })

  test("no direct file:// / net.fetch(file:) / pathToFileURL fallback exists on the locus-preview path", () => {
    const previewFiles = mainFilesMentioning(LOCUS_PREVIEW)
    expect(previewFiles.length).toBeGreaterThan(0)
    const fallbacks = previewFiles.filter((file) =>
      /\bnet\.fetch\s*\(|\bpathToFileURL\s*\(|\.loadFile\s*\(/.test(
        readSource(file),
      ),
    )
    expect(fallbacks).toEqual([])
  })
})
