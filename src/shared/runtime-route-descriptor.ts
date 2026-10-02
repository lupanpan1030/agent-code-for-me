/**
 * Serializable runtime route descriptor DTOs shared by main and renderer
 * (refactor-unified-runtime-route-catalog design D2). Types only: no
 * runtime -> adapter table, no main import and no executable value. The
 * public Local Job API route summary DTO stays in ./local-job-api
 * (tasks 5.3); the catalog's internal descriptor stays in main.
 */

/**
 * The renderer transport key stamped on a binding read model (design D3,
 * OD-3): an internal, additive read-model field, never persisted. Main
 * stamps it (runtime-route-read-model.ts) and the renderer construction
 * site reads it (active-chat.tsx), both through this type.
 */
export type RuntimeRouteTransportStamp = {
  transportId?: string
}
