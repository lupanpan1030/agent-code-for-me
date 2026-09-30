import { createHash } from "node:crypto"
import { readFileSync, realpathSync, statSync } from "node:fs"
import { isAbsolute, normalize, relative, resolve } from "node:path"
import type {
  LocusCompletionProvenance,
  RuntimeExecutionProvenance,
} from "./run-event-ledger"

/**
 * Run execution provenance capture (refactor-canonical-run-event-ledger,
 * design "Test-facing Contract": two-stage provenance, tasks 6.1).
 *
 * The run launch caller passes the executable it actually resolved (Codex
 * `resolveBundledCodexCliPath`, Claude `getBundledClaudeBinaryPath`) and the
 * exact schema files its adapter uses. This module hashes those bytes and
 * derives a deterministic local installation identity; it never changes
 * executable selection, never consults a delivery registry and never hashes
 * the non-deterministic `v2.schemas.json` bundle unless a caller explicitly
 * lists it. The resolved path stays host-only behind an opaque executableRef.
 */

export const RUN_SCHEMA_MANIFEST_VERSION = "locus.run-schema-manifest.v1"

export type CaptureRunExecutionProvenanceInput = {
  runtimeId: string
  adapterSource: string
  version: string
  protocolName: string
  protocolVersion: string
  /** Absolute path of the executable the launch caller resolved. */
  executablePath: string
} & (
  | {
      /** Root directory of the adapter's schema files. */
      schemaRoot: string
      /** Schema files (relative to schemaRoot) the adapter actually uses. */
      schemaFiles: readonly string[]
      schemaDocuments?: never
    }
  | {
      schemaRoot?: never
      schemaFiles?: never
      /**
       * Protocol schema documents compiled into the adapter (exact bytes
       * with a portable logical path), for adapters that ship no schema
       * files on disk.
       */
      schemaDocuments: readonly { path: string; content: string }[]
    }
)

const executablePaths = new Map<string, string>()

function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Run provenance capture requires ${field}`)
  }
  return value
}

function readRegularFile(path: string, label: string): Buffer {
  const stat = statSync(path)
  if (!stat.isFile()) {
    throw new Error(`Run provenance ${label} is not a regular file`)
  }
  return readFileSync(path)
}

/** Reproducible per-file schema fingerprints, sorted by relative path. */
export function fingerprintRunSchemaFiles(
  schemaRoot: string,
  schemaFiles: readonly string[],
): { path: string; sha256: string }[] {
  const root = realpathSync(requireText(schemaRoot, "schemaRoot"))
  const unique = [...new Set(schemaFiles.map((file) => normalize(file)))]
  if (unique.length === 0) {
    throw new Error("Run provenance capture requires at least one schema file")
  }
  return unique
    .map((file) => {
      const target = resolve(root, file)
      const path = relative(root, target)
      if (path === "" || path.startsWith("..") || isAbsolute(path)) {
        throw new Error("Run provenance schema file escapes the schema root")
      }
      const portable = path.split("\\").join("/")
      return {
        path: portable,
        sha256: sha256Hex(readRegularFile(target, "schema file")),
      }
    })
    .sort((left, right) => compareCodePoints(left.path, right.path))
}

/** Reproducible fingerprints of compiled-in schema documents, sorted. */
export function fingerprintRunSchemaDocuments(
  documents: readonly { path: string; content: string }[],
): { path: string; sha256: string }[] {
  if (documents.length === 0) {
    throw new Error("Run provenance capture requires at least one schema file")
  }
  const seen = new Set<string>()
  return documents
    .map((document) => {
      const path = requireText(document.path, "schema document path")
      if (seen.has(path)) {
        throw new Error("Run provenance schema documents repeat a path")
      }
      seen.add(path)
      return { path, sha256: sha256Hex(document.content) }
    })
    .sort((left, right) => compareCodePoints(left.path, right.path))
}

/** Versioned canonical manifest encoding of sorted per-file fingerprints. */
export function encodeRunSchemaManifest(
  schemaFiles: readonly { path: string; sha256: string }[],
): string {
  const lines = [...schemaFiles]
    .sort((left, right) => compareCodePoints(left.path, right.path))
    .map((entry) => `${entry.sha256}  ${entry.path}`)
  return `${RUN_SCHEMA_MANIFEST_VERSION}\n${lines.join("\n")}\n`
}

function installationIdentity(input: {
  runtimeId: string
  adapterSource: string
  version: string
  binarySha256: string
}): string {
  const canonical = JSON.stringify([
    input.runtimeId,
    input.adapterSource,
    process.platform,
    process.arch,
    input.version,
    input.binarySha256,
  ])
  return [
    "inst",
    input.runtimeId,
    input.version,
    `${process.platform}-${process.arch}`,
    sha256Hex(canonical).slice(0, 16),
  ].join("-")
}

/**
 * Captures the immutable runtime execution tuple for one Run launch. The
 * host binds it once through `ledger.bindExecutionProvenance` before any
 * runtime record or execution.
 */
export async function captureRunExecutionProvenance(
  input: CaptureRunExecutionProvenanceInput,
): Promise<RuntimeExecutionProvenance> {
  const runtimeId = requireText(input.runtimeId, "runtimeId")
  const adapterSource = requireText(input.adapterSource, "adapterSource")
  const version = requireText(input.version, "version")
  const protocolName = requireText(input.protocolName, "protocolName")
  const protocolVersion = requireText(input.protocolVersion, "protocolVersion")
  const executablePath = realpathSync(
    requireText(input.executablePath, "executablePath"),
  )
  const binarySha256 = sha256Hex(readRegularFile(executablePath, "executable"))
  const schemaFiles =
    input.schemaDocuments !== undefined
      ? fingerprintRunSchemaDocuments(input.schemaDocuments)
      : fingerprintRunSchemaFiles(input.schemaRoot, input.schemaFiles)
  const executableRef = `exe-${sha256Hex(
    JSON.stringify([runtimeId, executablePath]),
  ).slice(0, 24)}`
  executablePaths.set(executableRef, executablePath)
  return {
    kind: "runtime",
    installationId: installationIdentity({
      runtimeId,
      adapterSource,
      version,
      binarySha256,
    }),
    runtimeId,
    adapterSource,
    version,
    executableRef,
    binarySha256,
    protocolName,
    protocolVersion,
    schemaFiles,
  }
}

/**
 * Fails closed when the executable behind a captured tuple changed between
 * capture and launch; it never substitutes another binary.
 */
export function assertRunExecutableUnchanged(
  provenance: RuntimeExecutionProvenance,
): string {
  const path = executablePaths.get(provenance.executableRef)
  if (!path) {
    throw new Error("Run executable reference is unknown to this host")
  }
  if (
    sha256Hex(readRegularFile(path, "executable")) !== provenance.binarySha256
  ) {
    throw new Error("Run executable changed between capture and launch")
  }
  return path
}

/** Provider-only completion jobs identify their Locus completion source. */
export function captureLocusCompletionProvenance(input: {
  runtimeId: string
  locusBuild: string
  protocolName: string
  /** Canonical request/response schema document the completion owner uses. */
  schemaDocument: string
}): LocusCompletionProvenance {
  return {
    kind: "locus-completion",
    runtimeId: requireText(input.runtimeId, "runtimeId"),
    locusBuild: requireText(input.locusBuild, "locusBuild"),
    adapterSource: "completion",
    protocolName: requireText(input.protocolName, "protocolName"),
    schemaSha256: sha256Hex(
      requireText(input.schemaDocument, "schemaDocument"),
    ),
  }
}
