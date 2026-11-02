import { createContext, useContext, useSyncExternalStore } from "react";
import type { ResearchState } from "./persistence";
import type { ResearchStore } from "./researchStore";

export const ResearchContext = createContext<ResearchStore | null>(null);

export function useResearchStore(): ResearchStore {
  const store = useContext(ResearchContext);
  if (!store) throw new Error("useResearchStore must be used inside <ResearchContext.Provider>");
  return store;
}

/** The current research state; re-renders whenever the store commits. */
export function useResearch(): ResearchState {
  const store = useResearchStore();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
