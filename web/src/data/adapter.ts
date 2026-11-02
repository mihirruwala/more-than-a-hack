// Read-only project facts: the seam between the UI and wherever static facts live.
//
// Editable records (models, experiments, log) go through the research store in lib/store instead.
// A future local Python API that serves *scored results* (never match data) would implement this
// interface and feed verified metrics into the store. Components never import fixtures directly.

import type { Milestone, ProjectInfo, MetricRecord } from "../types";
import * as fixtures from "./fixtures/project";

export interface DataSource {
  kind: "fixtures" | "api";
  project(): Promise<ProjectInfo>;
  milestones(): Promise<Milestone[]>;
  baselineSweep(): Promise<{ window: number; label: string; result: MetricRecord }[]>;
}

export const fixtureSource: DataSource = {
  kind: "fixtures",
  project: async () => fixtures.project,
  milestones: async () => fixtures.milestones,
  baselineSweep: async () => fixtures.baselineSweep,
};
