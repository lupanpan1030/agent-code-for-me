import { listRuntimeRouteManifests } from "../../agent-runtime/runtime-route-catalog"
import { publicProcedure, router } from "../index"

export const agentRuntimeRouter = router({
  // The runtimes the route catalog enumerates, each with its manifest from
  // the shared capability owner (refactor-unified-runtime-route-catalog P06).
  listManifests: publicProcedure.query(() => {
    return [...listRuntimeRouteManifests()]
  }),
})
