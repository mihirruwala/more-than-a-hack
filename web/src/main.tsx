import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/fraunces/full-italic.css";
import "@fontsource-variable/inter-tight";
import "@fontsource-variable/jetbrains-mono";
import "./styles/tokens.css";
import "./styles/base.css";
import { App } from "./App";
import { Providers } from "./Providers";
import { browserStorage } from "./lib/store/persistence";
import { createResearchStore } from "./lib/store/researchStore";

// The research store lives in localStorage. A future API-backed store would be created here instead.
const store = createResearchStore(browserStorage());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Providers store={store}>
      <App />
    </Providers>
  </StrictMode>,
);
