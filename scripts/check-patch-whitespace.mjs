import { spawnSync } from "node:child_process"

const runGit = (args, options = {}) => {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  })

  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stderr ?? "")
    }
    process.exit(result.status ?? 1)
  }

  return options.capture ? result.stdout.trim() : ""
}

// Cover local edits regardless of whether they have been staged.
runGit(["diff", "--check"])
runGit(["diff", "--cached", "--check"])

const configuredBase = process.env.DIFF_BASE_SHA?.trim()
let baseRef = configuredBase

if (!baseRef) {
  const branch = runGit(["branch", "--show-current"], { capture: true })
  if (branch && branch !== "main") {
    const localMain = spawnSync(
      "git",
      ["rev-parse", "--verify", "main^{commit}"],
      {
        encoding: "utf8",
        stdio: "pipe",
      },
    )
    if (localMain.status === 0) {
      baseRef = "main"
    }
  }
}

if (baseRef && !/^0+$/.test(baseRef)) {
  const mergeBase = runGit(["merge-base", baseRef, "HEAD"], { capture: true })
  if (mergeBase) {
    runGit(["diff", "--check", mergeBase, "HEAD"])
  }
}
