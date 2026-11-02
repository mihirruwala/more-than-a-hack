import type { ReactNode } from "react";
import { ToastProvider } from "./components/ui/Toast";
import { fixtureSource, type DataSource } from "./data/adapter";
import type { ResearchStore } from "./lib/store/researchStore";
import { ResearchContext } from "./lib/store/useResearch";
import { DataContext } from "./lib/useData";

/** Everything a page needs from context. Tests pass their own store; the app passes the browser's. */
export function Providers({ store, source = fixtureSource, children }: { store: ResearchStore; source?: DataSource; children: ReactNode }) {
  return (
    <DataContext.Provider value={source}>
      <ResearchContext.Provider value={store}>
        <ToastProvider>{children}</ToastProvider>
      </ResearchContext.Provider>
    </DataContext.Provider>
  );
}
