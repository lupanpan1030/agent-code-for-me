import { describe, expect, test } from "bun:test"
import {
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { projects } from "../src/main/lib/db/schema"
import {
  createLocalJobApiJob,
  toLocalJobApiResultEnvelope,
  writeLocalJobApiFinalArtifacts,
  writeLocalJobApiInitialArtifacts,
} from "../src/main/lib/headless/local-job-api"
import {
  assertLocalJobApiCreateRequest,
  LOCAL_JOB_API_VERSION,
} from "../src/shared/local-job-api"
import { createAgentJobTestDb } from "./helpers/agent-job-test-db"

function prepareArtifactRun(projectRoot: string) {
  const db = createAgentJobTestDb()
  db.insert(projects)
    .values({
      id: "artifact-security-project",
      name: "Artifact Security",
      path: projectRoot,
    })
    .run()
  const request = assertLocalJobApiCreateRequest({
    apiVersion: LOCAL_JOB_API_VERSION,
    consumer: { id: "artifact-security-test" },
    project: { cwd: projectRoot },
    runtime: { id: "codex" },
    mode: "agent",
    prompt: { text: "Exercise artifact filesystem boundaries." },
    artifacts: {
      baseDir: join(projectRoot, ".locus", "runs"),
      writePolicy: "metadata-only",
    },
  })
  const prepared = createLocalJobApiJob(db, request, "test")
  writeLocalJobApiInitialArtifacts({
    runDir: prepared.runDir,
    request,
    job: prepared.job,
    events: [],
  })
  const runDir = prepared.runDir
  if (!runDir) throw new Error("Expected an artifact run directory")
  return { ...prepared, runDir }
}

describe("Local Job API artifact filesystem security", () => {
  test("rejects a symlink replacement without overwriting its external target", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "locus-artifact-symlink-"))
    try {
      const prepared = prepareArtifactRun(projectRoot)
      const eventsPath = join(prepared.runDir.path, "events.jsonl")
      const outsidePath = join(projectRoot, "outside-events.jsonl")
      writeFileSync(outsidePath, "outside-must-stay-unchanged\n")
      unlinkSync(eventsPath)
      symlinkSync(outsidePath, eventsPath)

      expect(() =>
        writeLocalJobApiFinalArtifacts({
          runDir: prepared.runDir,
          job: prepared.job,
          events: [],
        }),
      ).toThrow("single-link regular file")
      expect(readFileSync(outsidePath, "utf8")).toBe(
        "outside-must-stay-unchanged\n",
      )
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  test("rejects a hardlink replacement without overwriting its other link", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "locus-artifact-hardlink-"))
    try {
      const prepared = prepareArtifactRun(projectRoot)
      const eventsPath = join(prepared.runDir.path, "events.jsonl")
      const outsidePath = join(projectRoot, "outside-events.jsonl")
      writeFileSync(outsidePath, "outside-must-stay-unchanged\n")
      unlinkSync(eventsPath)
      linkSync(outsidePath, eventsPath)

      expect(() =>
        writeLocalJobApiFinalArtifacts({
          runDir: prepared.runDir,
          job: prepared.job,
          events: [],
        }),
      ).toThrow("single-link regular file")
      expect(readFileSync(outsidePath, "utf8")).toBe(
        "outside-must-stay-unchanged\n",
      )
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  test("rejects a swapped run directory without writing into the replacement", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "locus-artifact-dir-swap-"))
    try {
      const prepared = prepareArtifactRun(projectRoot)
      const runPath = prepared.runDir.path
      const movedRunPath = `${runPath}.moved`
      const outsideDir = join(projectRoot, "outside-dir")
      mkdirSync(outsideDir)
      const outsideEvents = join(outsideDir, "events.jsonl")
      writeFileSync(outsideEvents, "outside-must-stay-unchanged\n")
      renameSync(runPath, movedRunPath)
      symlinkSync(outsideDir, runPath, "dir")

      expect(() =>
        writeLocalJobApiFinalArtifacts({
          runDir: prepared.runDir,
          job: prepared.job,
          events: [],
        }),
      ).toThrow("directory path identity changed")
      expect(readFileSync(outsideEvents, "utf8")).toBe(
        "outside-must-stay-unchanged\n",
      )
      expect(prepared.runDir.closed).toBe(true)
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  test("anchors rename to the open directory and fails closed on a check-to-rename swap", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "locus-artifact-race-swap-"))
    try {
      const prepared = prepareArtifactRun(projectRoot)
      const runPath = prepared.runDir.path
      const movedRunPath = `${runPath}.moved`
      const originalEventsIno = lstatSync(join(runPath, "events.jsonl")).ino
      let swapped = false

      expect(() =>
        writeLocalJobApiFinalArtifacts({
          runDir: prepared.runDir,
          job: prepared.job,
          events: [],
          filesystemHooks: {
            beforeAtomicRename({ fileName }) {
              if (swapped || fileName !== "events.jsonl") return
              swapped = true
              renameSync(runPath, movedRunPath)
              mkdirSync(runPath)
              writeFileSync(
                join(runPath, "events.jsonl"),
                "replacement-must-stay-unchanged\n",
              )
            },
          },
        }),
      ).toThrow("directory path identity changed")
      expect(readFileSync(join(runPath, "events.jsonl"), "utf8")).toBe(
        "replacement-must-stay-unchanged\n",
      )
      expect(readFileSync(join(movedRunPath, "events.jsonl"), "utf8")).toBe("")
      expect(lstatSync(join(movedRunPath, "events.jsonl")).ino).not.toBe(
        originalEventsIno,
      )
      expect(prepared.runDir.closed).toBe(true)
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  test("detects a hardlinked atomic result after anchored installation", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "locus-artifact-temp-link-"))
    try {
      const prepared = prepareArtifactRun(projectRoot)
      const capturedTemp = join(projectRoot, "captured-temp.jsonl")

      expect(() =>
        writeLocalJobApiFinalArtifacts({
          runDir: prepared.runDir,
          job: prepared.job,
          events: [],
          filesystemHooks: {
            beforeAtomicRename({ fileName, runDirPath }) {
              if (fileName !== "events.jsonl") return
              const tempName = readdirSync(runDirPath).find((entry) =>
                entry.startsWith(".events.jsonl.locus-"),
              )
              if (!tempName) throw new Error("Expected atomic temp file")
              linkSync(join(runDirPath, tempName), capturedTemp)
            },
          },
        }),
      ).toThrow("Installed artifact is not a single-link regular file")
      expect(
        readFileSync(join(prepared.runDir.path, "events.jsonl"), "utf8"),
      ).toBe("")
      expect(prepared.runDir.closed).toBe(true)
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  test("refuses to read an artifact manifest through a replaced directory symlink", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "locus-artifact-read-swap-"))
    try {
      const prepared = prepareArtifactRun(projectRoot)
      writeLocalJobApiFinalArtifacts({
        runDir: prepared.runDir,
        job: prepared.job,
        events: [],
      })

      const runPath = prepared.runDir.path
      const movedRunPath = `${runPath}.moved`
      const outsideDir = join(projectRoot, "outside-manifest")
      mkdirSync(outsideDir)
      writeFileSync(
        join(outsideDir, "artifacts.json"),
        JSON.stringify({
          artifacts: [
            {
              role: "untrusted",
              path: join(outsideDir, "secret.json"),
              sha256: "0".repeat(64),
              contentType: "application/json",
              sizeBytes: 1,
            },
          ],
        }),
      )
      renameSync(runPath, movedRunPath)
      symlinkSync(outsideDir, runPath, "dir")

      expect(toLocalJobApiResultEnvelope(prepared.job).artifacts).toEqual([])
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })
})
