import { useEffect } from "react";
import { useBlocker } from "react-router";

/**
 * Protect a dirty form: in-app navigation asks first (via the returned blocker), and closing or
 * reloading the tab triggers the browser's own prompt.
 */
export function useUnsavedGuard(dirty: boolean) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  return blocker;
}
