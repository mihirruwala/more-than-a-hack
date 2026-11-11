// Static project facts. Everything here is either quoted from the repository's documentation or a
// record of work that happened in this repo, each with its provenance. Editable records
// (models, experiments, log) live in the research store and are seeded from seed.ts.

import type { Milestone, ProjectInfo, MetricRecord } from "../../types";

export const project: ProjectInfo = {
  name: "Barça Lab",
  tagline: "Football Intelligence & Possession Research",
  phase: "MTAH 2027 · Phase 1: ball possession",
  deadline: "2026-11-17",
  currentModelId: "possession-hmm-v1",
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
    status: "done",
  },
  {
    id: "m4",
    title: "Possession model and dead-ball detection",
    detail: "Ball filter and sticky H/A/D model, checked on two open Metrica matches. Used for the submission.",
    status: "done",
  },
  {
    id: "m5",
    title: "Technical document and public repository",
    detail: "TECHNICAL.md covers the approach, assets, possession rules, validation and limitations.",
    status: "done",
  },
  {
    id: "m6",
    title: "Submit through the organisers' form",
    detail: "Team_MSN.csv, the repository link and TECHNICAL.md.",
    status: "todo",
    due: "2026-11-17",
  },
];
