import type {
  CodexAppServerClientNotificationMethod,
  CodexAppServerClientRequestMethod,
  CodexAppServerTransport,
  CodexAppServerTransportExit,
  CodexAppServerTransportNotification,
  CodexAppServerTransportServerRequest,
  CodexAppServerTransportServerRequestResponse,
} from "../../src/main/lib/codex/app-server-transport"

/**
 * Minimal scripted Codex app-server transport for implementer unit tests:
 * `thread/start` / `thread/resume` / `turn/start` answer from the script and
 * `turn/start` emits the scripted notifications synchronously, like the
 * stdio transport delivering buffered lines before the response resolves.
 */
export type CodexAppServerScript = {
  threadResume?: (params: Record<string, unknown>) => unknown
  turnNotifications?: (
    threadId: string,
  ) => CodexAppServerTransportNotification[]
}

export function defaultCodexTurnNotifications(
  threadId: string,
  text = "hello from the scripted turn",
): CodexAppServerTransportNotification[] {
  return [
    {
      method: "turn/started",
      params: {
        threadId,
        turn: { id: "turn-1", status: "inProgress", error: null },
      },
    },
    {
      method: "item/agentMessage/delta",
      params: { threadId, turnId: "turn-1", itemId: "item-1", delta: text },
    },
    {
      method: "turn/completed",
      params: {
        threadId,
        turn: { id: "turn-1", status: "completed", error: null },
      },
    },
  ]
}

export class ScriptedCodexAppServerTransport
  implements CodexAppServerTransport
{
  readonly requests: Array<{ method: string; params: unknown }> = []
  readonly notified: string[] = []
  closed = false
  private notificationHandler:
    | ((notification: CodexAppServerTransportNotification) => void)
    | null = null
  private exitHandler: ((exit: CodexAppServerTransportExit) => void) | null =
    null
  private threadId = "thread-1"

  constructor(private readonly script: CodexAppServerScript = {}) {}

  async request(
    method: CodexAppServerClientRequestMethod,
    params: unknown,
  ): Promise<unknown> {
    this.requests.push({ method, params })
    const record = (params ?? {}) as Record<string, unknown>
    switch (method) {
      case "initialize":
        return { userAgent: "codex-scripted" }
      case "thread/start":
        this.threadId = "thread-1"
        this.emit({
          method: "thread/started",
          params: { thread: { id: this.threadId, sessionId: "session-1" } },
        })
        return { thread: { id: this.threadId, sessionId: "session-1" } }
      case "thread/resume": {
        this.threadId = String(record.threadId)
        return this.script.threadResume
          ? this.script.threadResume(record)
          : { thread: { id: this.threadId, sessionId: this.threadId } }
      }
      case "mcpServerStatus/list":
        return { data: [], nextCursor: null }
      case "turn/start":
        for (const notification of (
          this.script.turnNotifications ?? defaultCodexTurnNotifications
        )(this.threadId)) {
          this.emit(notification)
        }
        return { turn: { id: "turn-1" } }
      case "turn/interrupt":
        return {}
      default:
        throw new Error(`unexpected method ${method}`)
    }
  }

  notify(method: CodexAppServerClientNotificationMethod): void {
    this.notified.push(method)
  }

  onNotification(
    handler: (notification: CodexAppServerTransportNotification) => void,
  ): () => void {
    this.notificationHandler = handler
    return () => {
      this.notificationHandler = null
    }
  }

  onServerRequest(
    _handler: (
      request: CodexAppServerTransportServerRequest,
    ) =>
      | CodexAppServerTransportServerRequestResponse
      | Promise<CodexAppServerTransportServerRequestResponse>,
  ): () => void {
    return () => {}
  }

  onExit(handler: (exit: CodexAppServerTransportExit) => void): () => void {
    this.exitHandler = handler
    return () => {
      this.exitHandler = null
    }
  }

  emit(notification: CodexAppServerTransportNotification): void {
    this.notificationHandler?.(notification)
  }

  emitExit(error = new Error("Codex app-server exited unexpectedly")): void {
    this.exitHandler?.({ code: 1, signal: null, error })
  }

  close(): Promise<void> {
    this.closed = true
    return Promise.resolve()
  }
}
