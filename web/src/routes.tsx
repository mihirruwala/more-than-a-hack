import { Outlet, ScrollRestoration, type RouteObject } from "react-router";
import { LabLayout } from "./components/layout/LabLayout";
import { PublicLayout } from "./components/layout/PublicLayout";
import { Landing } from "./pages/Landing";
import { NotFound } from "./pages/NotFound";
import { Overview } from "./pages/Overview";
import { ProjectLog } from "./pages/ProjectLog";
import { ExperimentCompare } from "./pages/experiments/ExperimentCompare";
import { ExperimentDetail } from "./pages/experiments/ExperimentDetail";
import { EditExperiment, NewExperiment } from "./pages/experiments/ExperimentEditor";
import { Registry } from "./pages/experiments/Registry";
import { MatchCentre } from "./pages/match/MatchCentre";
import { Methodology } from "./pages/methodology/Methodology";
import { EditModel, NewModel } from "./pages/models/ModelEditor";
import { ModelLab } from "./pages/models/ModelLab";
import { LiveReplay } from "./pages/live/LiveReplay";
import { MatchConsole } from "./pages/console/MatchConsole";
import { Runs } from "./pages/runs/Runs";

function Root() {
  return (
    <>
      <ScrollRestoration />
      <Outlet />
    </>
  );
}

/** One route table, used by the browser router and by the smoke tests' memory router. */
export const routes: RouteObject[] = [
  {
    element: <Root />,
    children: [
      {
        element: <PublicLayout />,
        children: [
          { index: true, element: <Landing /> },
          { path: "match", element: <MatchCentre /> },
          { path: "methodology", element: <Methodology /> },
          { path: "*", element: <NotFound /> },
        ],
      },
      // Full-bleed dashboard, outside both layouts.
      { path: "lab/console", element: <MatchConsole /> },
      {
        path: "lab",
        element: <LabLayout />,
        children: [
          { index: true, element: <Overview /> },
          { path: "models", element: <ModelLab /> },
          { path: "models/new", element: <NewModel /> },
          { path: "models/:id/edit", element: <EditModel /> },
          { path: "experiments", element: <Registry /> },
          { path: "experiments/new", element: <NewExperiment /> },
          { path: "experiments/compare", element: <ExperimentCompare /> },
          { path: "experiments/:id", element: <ExperimentDetail /> },
          { path: "experiments/:id/edit", element: <EditExperiment /> },
          { path: "runs", element: <Runs /> },
          { path: "live", element: <LiveReplay /> },
          { path: "log", element: <ProjectLog /> },
        ],
      },
    ],
  },
];
