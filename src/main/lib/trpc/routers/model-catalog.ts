import { observable } from "@trpc/server/observable"
import { getDefaultModelCatalogFetcher } from "../../model-catalog/fetcher"
import { publicProcedure, router } from "../index"

export const modelCatalogRouter = router({
  get: publicProcedure.query(() => getDefaultModelCatalogFetcher().get()),
  updates: publicProcedure.subscription(() => {
    const fetcher = getDefaultModelCatalogFetcher()
    return observable<Awaited<ReturnType<typeof fetcher.get>>>((emit) => {
      let active = true
      const unsubscribe = fetcher.subscribe((snapshot) => emit.next(snapshot))
      void fetcher
        .get()
        .then((snapshot) => {
          if (active) emit.next(snapshot)
        })
        .catch(() => undefined)
      return () => {
        active = false
        unsubscribe()
      }
    })
  }),
})
