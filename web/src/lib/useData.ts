import { createContext, useContext, useEffect, useState } from "react";
import type { DataSource } from "../data/adapter";

export const DataContext = createContext<DataSource | null>(null);

export function useDataSource(): DataSource {
  const source = useContext(DataContext);
  if (!source) throw new Error("useDataSource must be used inside <DataContext.Provider>");
  return source;
}

export type Loadable<T> =
  | { state: "loading" }
  | { state: "error"; error: string }
  | { state: "ready"; data: T };

/** Run one adapter call and track loading / error / ready. `load` must be stable per `key`. */
export function useLoad<T>(key: string, load: (source: DataSource) => Promise<T>): Loadable<T> {
  const source = useDataSource();
  const [value, setValue] = useState<Loadable<T>>({ state: "loading" });

  useEffect(() => {
    let live = true;
    setValue({ state: "loading" });
    load(source).then(
      (data) => live && setValue({ state: "ready", data }),
      (error: unknown) => live && setValue({ state: "error", error: String(error) }),
    );
    return () => {
      live = false;
    };
  }, [source, key]);

  return value;
}
