import { CodexAppServerChatTransport } from "./codex-app-server-chat-transport"
import { IPCChatTransport } from "./ipc-chat-transport"

/**
 * The renderer's read state of a binding's route descriptor (design D1/D3):
 * loaded with the main-stamped transportId, not yet loaded / field absent,
 * or a failed read.
 */
export type RuntimeRouteTransportInput =
  | { state: "loaded"; transportId: string }
  | { state: "not-loaded" }
  | { state: "error" }

/** Internal UI failure states (no public error code). */
export type RuntimeRouteTransportFailure =
  | "route_descriptor_unavailable"
  | "route_descriptor_error"
  | "unknown_transport"

/** The existing wire adapters' shared construction config. */
export type RuntimeRouteTransportConfig = ConstructorParameters<
  typeof IPCChatTransport
>[0]

export type RuntimeRouteTransport =
  | IPCChatTransport
  | CodexAppServerChatTransport

export type RuntimeRouteTransportResult =
  | { ok: true; transport: RuntimeRouteTransport }
  | { ok: false; failure: RuntimeRouteTransportFailure }

/**
 * Compiled static mapping from the mechanical transportId key to the
 * existing wire adapter constructor. It never maps a runtime id: main's
 * runtime route catalog owns which runtime uses which transport.
 */
const TRANSPORT_CONSTRUCTORS: Readonly<
  Record<string, (config: RuntimeRouteTransportConfig) => RuntimeRouteTransport>
> = {
  "claude-chat-ipc": (config) => new IPCChatTransport(config),
  "codex-chat-ipc": (config) => new CodexAppServerChatTransport(config),
}

/**
 * Builds the Chat transport for a binding from its route descriptor read
 * state. A missing or unread descriptor and an unknown transportId return a
 * named failure without constructing or subscribing anything (and without a
 * default wire); a later loaded read simply retries.
 */
export function createRuntimeRouteTransport(
  input: RuntimeRouteTransportInput,
  config: RuntimeRouteTransportConfig,
): RuntimeRouteTransportResult {
  if (input.state === "error") {
    return { ok: false, failure: "route_descriptor_error" }
  }
  if (input.state !== "loaded") {
    return { ok: false, failure: "route_descriptor_unavailable" }
  }
  const construct = Object.hasOwn(TRANSPORT_CONSTRUCTORS, input.transportId)
    ? TRANSPORT_CONSTRUCTORS[input.transportId]
    : undefined
  if (!construct) return { ok: false, failure: "unknown_transport" }
  return { ok: true, transport: construct(config) }
}
