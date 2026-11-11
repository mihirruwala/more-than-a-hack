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
    caveat: "Identity switches and duplicated tracks aren't repaired. We only use each slot's team, so they matter little.",
    experimentIds: [],
  },
  {
    id: "spatial",
    number: 3,
    title: "Spatial evidence",
    summary: "Who is near the ball, and how near.",
    detail:
      "Each player gets a control score that falls off with distance to the estimated ball, exp(-d² / 2s²) with s² = 1.6² + σ², so the radius widens when the ball's position is uncertain. A team's evidence is 0.08 plus its best player's score. While the ball is unseen, scores are capped at 0.25.",
    status: "implemented",
    evidence: [{ label: "LiveEstimator._likelihood()", ref: "starter/live_estimator.py" }],
    caveat: "The radii are football priors, checked on simulated matches and two open Metrica matches.",
    experimentIds: [],
  },
  {
    id: "motion",
    number: 4,
    title: "Motion evidence",
    summary: "Ball speed and direction, and player velocities.",
    detail:
      "A Kalman filter tracks the ball, including through gaps: a hidden ball at a player's feet moves with that player, and a struck ball coasts until someone receives it. A player only scores as in control when their velocity also matches the ball's, so a defender running at the carrier doesn't take possession.",
    status: "implemented",
    evidence: [
      { label: "BallFilter", ref: "starter/live_estimator.py" },
      { label: "Velocity match", ref: "LiveEstimator._likelihood()" },
    ],
    experimentIds: [],
  },
  {
    id: "inference",
    number: 5,
    title: "Possession inference",
    summary: "Turn the evidence into H, A or D on every frame.",
    detail:
      "A three-state hidden Markov model (H, A, D) with sticky transitions, smoothed forwards and backwards over each half. Each frame's evidence is raised to the power 0.25 so a team change needs evidence that persists. Dead-ball evidence grows as the fastest tenth of players slows below about 2 m/s, which caught 84% of dead-ball frames on two open Metrica matches.",
    status: "implemented",
    evidence: [
      { label: "PossessionHMM, forward_backward()", ref: "starter/live_estimator.py" },
      { label: "Validation on Metrica", ref: "tools/external_check.py" },
    ],
    caveat: "Quick restarts taken at pace still look like play.",
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
    caveat: "Part of the submission. On the two Metrica matches it adds about 0.05 spellF1 after the possession model.",
    experimentIds: ["EXP-001", "EXP-002"],
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
      { label: "make_submission.py", ref: "make_submission.py" },
      { label: "Validator", ref: "evaluation/validate_submission.py" },
    ],
    caveat: "The submitted file's SHA-256 is in TECHNICAL.md, so a rerun can be compared byte for byte.",
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
    current: "Control score from distance to the estimated ball, widened by the ball's uncertainty.",
    status: "implemented",
  },
  {
    id: "relationships",
    title: "Player–ball relationships",
    feature: "spatial",
    question: "Is a player in control of the ball, or just nearest to it?",
    current: "In control means near the ball and moving with it (velocity match).",
    status: "implemented",
  },
  {
    id: "motion",
    title: "Motion & trajectories",
    feature: "motion",
    question: "Is the ball in flight, rolling loose, or moving with a player?",
    current: "Kalman ball filter; a hidden ball follows its carrier or coasts after a pass.",
    status: "implemented",
  },
  {
    id: "temporal",
    title: "Temporal consistency",
    feature: "temporal",
    question: "How long must evidence persist before a possession changes?",
    current: "Sticky H/A/D model with evidence power 0.25, then segment cleanup.",
    status: "implemented",
  },
  {
    id: "dead-ball",
    title: "Dead-ball reasoning",
    feature: "dead-ball",
    question: "Is play stopped, or has the tracker just lost the ball?",
    current: "Ball out of the pitch, or the fastest players slowing to a walk. A missing ball alone is not evidence.",
    status: "implemented",
  },
  {
    id: "tactical",
    title: "Tactical context",
    feature: "tactical",
    question: "Do Smart Tagging phases and set pieces anchor restarts and teams?",
    current: "Built (tag_prior.py) but off in the submission: tags agreed with possession 68% of the time.",
    status: "experimental",
  },
  {
    id: "missing",
    title: "Missing observations",
    feature: "data",
    question: "What should the system say when it can't see the ball?",
    current: "The ball filter keeps estimating it; team evidence is capped while it is hidden. X is not used.",
    status: "implemented",
  },
  {
    id: "segments",
    title: "Segment post-processing",
    feature: "temporal",
    question: "Can fragments be joined back into whole possessions?",
    current: "Segment cleanup, part of the submission.",
    status: "implemented",
  },
];
