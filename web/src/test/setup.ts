import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom doesn't implement scrolling; React Router's ScrollRestoration calls it on every navigation.
window.scrollTo = () => {};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
