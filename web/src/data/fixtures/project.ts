// Static project facts. Everything here is either quoted from the repository's documentation or a
// record of work that happened in this repo, each with its provenance. Editable records
// (models, experiments, log) live in the research store and are seeded from seed.ts.

import type { Milestone, ProjectInfo, MetricRecord } from "../../types";

export const project: ProjectInfo = {
  name: "Barça Lab",
  tagline: "Football Intelligence & Possession Research",
  phase: "MTAH 2027 · Phase 1: ball possession",
  deadline: "2026-11-17",
  currentModelId: "postprocess-v0-1",
};

/** The four published baseline variants, full match, quoted from EVALUATION.md. */
export const baselineSweep: { window: number; label: string; result: MetricRecord }[] = [
  { window: 0, label: "raw", result: pub(0.6532, 0.0486) },
  { window: 25, label: "±25", result: pub(0.6752, 0.1996) },
  { window: 50, label: "±50", result: pub(0.6724, 0.2433) },
  { window: 125, label: "±125", result: pub(0.6356, 0.2242) },
];

function pub(macroF1: number, spellF1: number): MetricRecord {
  return {
    provenance: "published",
    source: "EVALUATION.md: full-match scores of the shipped baselines",
    scope: "full-match",
    metrics: { macroF1, spellF1 },
  };
}

export const baselineFloor = baselineSweep[2]!;

export const milestones: Milestone[] = [
  {
    id: "m1",
    title: "Audit the repository and the metric",
    detail: "Baseline, spellF1 definition and CSV contract all documented.",
    status: "done",
  },
  {
    id: "m2",
    title: "Segment-cleanup module with synthetic tests",
    detail: "starter/postprocess.py, with 18 unittest cases that pass and use the official metric code unchanged.",
    status: "done",
  },
  {
    id: "m3",
    title: "Research console: registry, Model Lab, Match Centre",
    detail: "The web/ app, with local persistence and provenance on every number.",
    status: "active",
  },
  {
    id: "m4",
    title: "Run segment cleanup on the baseline output (EXP-003)",
    detail: "Needs the gated match data. Runs locally only, never in the browser.",
    status: "blocked",
  },
  {
    id: "m5",
    title: "Write the technical document",
    detail: "Approach, the assets used, the possession rules and the limitations.",
    status: "todo",
    due: "2026-11-17",
  },
];
