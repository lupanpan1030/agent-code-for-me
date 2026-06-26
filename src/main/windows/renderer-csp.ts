import { fileURLToPath } from "node:url"
import type {
  HeadersReceivedResponse,
  OnHeadersReceivedListenerDetails,
  Session,
} from "electron"

const RENDERER_CSP_HEADER = "Content-Security-Policy"

const installedSessions = new WeakSet<Session>()

export function buildRendererContentSecurityPolicy(isDev: boolean): string {
  const directives = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    isDev
      ? "connect-src 'self' ws://localhost:* http://localhost:*"
      : "connect-src 'self'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
  ]

  if (isDev) {
    directives[1] = "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'"
  }

  return directives.join("; ")
}

export interface RendererCspMatchInput {
  url: string
  resourceType: OnHeadersReceivedListenerDetails["resourceType"]
  isDev: boolean
  devServerUrl?: string
  prodIndexPath?: string
}

export function shouldApplyRendererContentSecurityPolicy({
  url,
  resourceType,
  isDev,
  devServerUrl,
  prodIndexPath,
}: RendererCspMatchInput): boolean {
  if (resourceType !== "mainFrame") return false

  try {
    const requestUrl = new URL(url)

    if (isDev) {
      if (!devServerUrl) return false
      return requestUrl.origin === new URL(devServerUrl).origin
    }

    if (requestUrl.protocol !== "file:" || !prodIndexPath) return false
    return fileURLToPath(requestUrl) === prodIndexPath
  } catch {
    return false
  }
}

export interface InstallRendererContentSecurityPolicyOptions {
  session: Session
  isDev: boolean
  devServerUrl?: string
  prodIndexPath?: string
}

export function installRendererContentSecurityPolicy({
  session,
  isDev,
  devServerUrl,
  prodIndexPath,
}: InstallRendererContentSecurityPolicyOptions): void {
  if (installedSessions.has(session)) return
  installedSessions.add(session)

  const policy = buildRendererContentSecurityPolicy(isDev)

  session.webRequest.onHeadersReceived(
    (
      details: OnHeadersReceivedListenerDetails,
      callback: (response: HeadersReceivedResponse) => void,
    ) => {
      if (
        !shouldApplyRendererContentSecurityPolicy({
          url: details.url,
          resourceType: details.resourceType,
          isDev,
          devServerUrl,
          prodIndexPath,
        })
      ) {
        callback({})
        return
      }

      callback({
        responseHeaders: {
          ...details.responseHeaders,
          [RENDERER_CSP_HEADER]: [policy],
        },
      })
    },
  )
}
