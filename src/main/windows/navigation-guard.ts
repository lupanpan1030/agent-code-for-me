import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

export type MainWindowNavigationGuardOptions = {
  devServerUrl?: string
  prodIndexPath: string
}

function originOf(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null
  try {
    return new URL(rawUrl).origin
  } catch {
    return null
  }
}

function isSameFilePath(rawUrl: URL, filePath: string): boolean {
  try {
    return resolve(fileURLToPath(rawUrl)) === resolve(filePath)
  } catch {
    return false
  }
}

export function isAllowedMainWindowNavigationUrl(
  rawUrl: string,
  options: MainWindowNavigationGuardOptions,
): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }

  const devServerOrigin = originOf(options.devServerUrl)
  if (devServerOrigin && (url.protocol === "http:" || url.protocol === "https:")) {
    return url.origin === devServerOrigin
  }

  if (url.protocol === "file:") {
    return isSameFilePath(url, options.prodIndexPath)
  }

  return false
}
