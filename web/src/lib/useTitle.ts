import { useEffect } from "react";

/** One title per route, so tabs, history and screen readers can tell pages apart. */
export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Barça Lab` : "Barça Lab";
  }, [title]);
}
