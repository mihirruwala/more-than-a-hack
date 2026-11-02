// The pipeline as it stands in this repository. A status is written here only when the code it
// refers to exists (`implemented`) or it is explicitly future work (`proposed` / `investigating`).
// `verified` is never written by hand: lib/methodology.ts upgrades a stage to verified only when a
// linked experiment holds a verified, full-match metric.

import type { FeatureCategory, MethodologyStage, StageStatus } from "../../types";

export interface StageRecord extends MethodologyStage {
  /** Experiments whose verified results would count as evidence for this stage. */
  experimentIds: string[];
}

export const stages: StageRecord[] = [
  {
    id: "align",
    number: 1,
    title: "Input & frame alignment",
    summary: "Put tracking, tagging and video on the tactical video's frame index.",
    detail:
      "Each submission row is a frame of the tactical video. The tracking counter is offset by a different amount in each half, so a single offset cannot be frame-accurate. A one-frame error shifts every transition the scorer matches.",
    status: "implemented",
    evidence: [
      { label: "Per-half offsets", ref: "games.py" },
      { label: "ATD loader", ref: "starter/load_atd.py" },
    ],
    caveat: "This is organiser-provided code, used unchanged.",
    experimentIds: [],
  },
  {
    id: "tracking",
    number: 2,
    title: "Tracking interpretation",
    summary: "Read the player and ball tracks, and know what they do not say.",
    detail:
      "There are 46 track slots for 22 players. A slot is a tracklet, not a person, and slots swap identity. The ball is missing on 41% of graded frames, and most often on the frames that matter.",
    status: "implemented",
    evidence: [{ label: "Raw ATD parsing, metric scaling", ref: "starter/baseline.py" }],
    caveat: "Identity switches and duplicated tracks aren't handled yet.",
    experimentIds: [],
  },
  {
    id: "spatial",
    number: 3,
    title: "Spatial evidence",
    summary: "Who is near the ball, and how near.",
    detail:
      "The baseline gives each frame to the team of the nearest tracked player, measuring distances in metres so the touchlines aren't distorted. It uses no distance threshold, so the nearest player wins even 30 m away.",
    status: "implemented",
    evidence: [{ label: "nearest_player_labels()", ref: "starter/baseline.py" }],
    caveat: "Nearest isn't the same as in control. A threshold or contest model is proposed.",
    experimentIds: [],
  },
  {
    id: "motion",
    number: 4,
    title: "Motion evidence",
    summary: "Ball speed and direction, and player velocities.",
    detail:
      "A ball in flight belongs to no one, while a ball moving with a player is usually controlled by that player. Speed is already in the ATD and goes unused.",
    status: "proposed",
    evidence: [],
    experimentIds: [],
  },
  {
    id: "inference",
    number: 5,
    title: "Possession inference",
    summary: "Turn the evidence into H, A or D on every frame.",
    detail:
      "Today this is the nearest-player vote. The proposed state machine would require sustained evidence of control before changing team, and evidence of a stoppage, not just a missing ball, before calling D.",
    status: "investigating",
    evidence: [
      { label: "Nearest-player baseline", ref: "starter/baseline.py" },
      { label: "Possession state machine (planned)", ref: "Model Lab" },
    ],
    experimentIds: [],
  },
  {
    id: "temporal",
    number: 6,
    title: "Temporal post-processing",
    summary: "Turn a flickering signal back into whole possessions.",
    detail:
      "Fills same-team gaps of up to 3 s, absorbs sub-second flicker clusters and short spells, and never works across halftime. It works on labels only, so it can follow any per-frame model.",
    status: "implemented",
    evidence: [
      { label: "clean_segments()", ref: "starter/postprocess.py" },
      { label: "18 synthetic tests", ref: "tests/test_postprocess.py" },
      { label: "Synthetic runs", ref: "EXP-001, EXP-002" },
    ],
    caveat: "Tested on synthetic data only. Whether it helps on the match is unverified (EXP-003 is planned).",
    experimentIds: ["EXP-001", "EXP-002", "EXP-003"],
  },
  {
    id: "evaluation",
    number: 7,
    title: "Evaluation",
    summary: "Score with the official scorer, and record every run.",
    detail:
      "spellF1 matches whole possessions one-to-one by temporal IoU and averages the F1 over five thresholds. macroF1 is the per-frame tie-break. Gaps below about 0.04 spellF1 are noise.",
    status: "implemented",
    evidence: [
      { label: "Official scorer", ref: "evaluation/run_evaluation.py" },
      { label: "Metric definitions", ref: "evaluation/possession_metrics.py" },
    ],
    caveat: "This is organiser code, kept unchanged. The public 5 minutes check the pipeline. They must not be used for tuning.",
    experimentIds: [],
  },
  {
    id: "submission",
    number: 8,
    title: "Submission generation",
    summary: "Write a validated file that the code reproduces exactly.",
    detail:
      "199,319 rows, frames 0 to 199318 in order, labels H/A/D/X and no blank cells. Running the repository on the data must regenerate the same file byte for byte.",
    status: "implemented",
    evidence: [
      { label: "write_submission()", ref: "starter/baseline.py" },
      { label: "Validator", ref: "evaluation/validate_submission.py" },
    ],
    caveat: "No final submission has been produced yet.",
    experimentIds: [],
  },
];

export const STAGE_STATUS_TEXT: Record<StageStatus, { label: string; description: string }> = {
  implemented: { label: "Implemented", description: "The code exists in this repository." },
  proposed: { label: "Proposed", description: "A design that hasn't been built yet." },
  investigating: { label: "Under investigation", description: "Work in progress, or a choice still being made." },
  verified: { label: "Verified", description: "Backed by a recorded, verified full-match experiment." },
};

export type DimensionStatus = "implemented" | "experimental" | "planned";

export interface ResearchDimension {
  id: string;
  title: string;
  feature: FeatureCategory | "data";
  question: string;
  current: string;
  status: DimensionStatus;
}

/** Research dimensions for the Model Lab. "Implemented" only where code exists today. */
export const dimensions: ResearchDimension[] = [
  {
    id: "spatial",
    title: "Spatial evidence",
    feature: "spatial",
    question: "Which players are close enough to the ball to be playing it?",
    current: "Nearest tracked player, in metres. There's no threshold.",
    status: "implemented",
  },
  {
    id: "relationships",
    title: "Player–ball relationships",
    feature: "spatial",
    question: "Is a player in control of the ball, or just nearest to it?",
    current: "Not modelled. The nearest player always wins.",
    status: "planned",
  },
  {
    id: "motion",
    title: "Motion & trajectories",
    feature: "motion",
    question: "Is the ball in flight, rolling loose, or moving with a player?",
    current: "Unused, although speed is in the ATD.",
    status: "planned",
  },
  {
    id: "temporal",
    title: "Temporal consistency",
    feature: "temporal",
    question: "How long must evidence persist before a possession changes?",
    current: "Centred majority vote (baseline). Segment cleanup removes sub-second spells.",
    status: "implemented",
  },
  {
    id: "dead-ball",
    title: "Dead-ball reasoning",
    feature: "dead-ball",
    question: "Is play stopped, or has the tracker just lost the ball?",
    current: "D means the ball has been missing for longer than the window. Cleanup bridges short gaps.",
    status: "experimental",
  },
  {
    id: "tactical",
    title: "Tactical context",
    feature: "tactical",
    question: "Do Smart Tagging phases and set pieces anchor restarts and teams?",
    current: "Unused. Throw-ins carry no team tag.",
    status: "planned",
  },
  {
    id: "missing",
    title: "Missing observations",
    feature: "data",
    question: "What should the system say when it can't see the ball?",
    current: "The baseline says D. X (abstain) is free inside a possession under spellF1, but isn't used yet.",
    status: "experimental",
  },
  {
    id: "segments",
    title: "Segment post-processing",
    feature: "temporal",
    question: "Can fragments be joined back into whole possessions?",
    current: "Segment cleanup v0.1, tested on synthetic data only.",
    status: "implemented",
  },
];
