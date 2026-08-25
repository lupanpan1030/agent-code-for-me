import type { Writable } from "node:stream"

export async function flushWritableStream(stream: Writable): Promise<void> {
  if (stream.destroyed || stream.writableEnded) return

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const settle = (error?: Error | null) => {
      if (settled) return
      settled = true
      stream.off("error", onError)
      stream.off("close", onClose)
      if (error) {
        reject(error)
        return
      }
      resolve()
    }
    const onError = (error: Error) => settle(error)
    const onClose = () => settle()
    stream.once("error", onError)
    stream.once("close", onClose)
    try {
      stream.write("", settle)
    } catch (error) {
      settle(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

export async function flushHeadlessStdio(
  stdout: Writable = process.stdout,
  stderr: Writable = process.stderr,
): Promise<void> {
  await Promise.all([flushWritableStream(stdout), flushWritableStream(stderr)])
}
