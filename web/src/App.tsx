import { RouterProvider, createBrowserRouter } from "react-router";
import { routes } from "./routes";

// A data router (not <BrowserRouter>) so forms can block navigation while they hold unsaved edits.
const router = createBrowserRouter(routes);

export function App() {
  return <RouterProvider router={router} />;
}
