// Seed records for the research store: what the registry holds on first run, and after a reset.
//
// Every record describes work that happened in this repository, or work that is
// explicitly planned. Numbers are the real outputs of tests/test_postprocess.py on synthetic data
// (labelled synthetic) or quotes from EVALUATION.md (labelled published). Nothing is verified,
// because no run of the official scorer on the match has been recorded yet.

import type { Experiment, ExperimentMetric, LogEntry, ModelVersion } from "../../types";

const DAY = "2026-10-25";
const at = (time: string) => `${DAY}T${time}:00.000Z`;

const published = (id: string, key: string, value: number): ExperimentMetric => ({
  id,
  key,
  value,
  provenance: "published",
  scope: "full-match",
  source: "EVALUATION.md: full-match score of the shipped baseline",
  recordedAt: at("09:00"),
});

const synthetic = (id: string, key: string, value: number, source: string, time: string): ExperimentMetric => ({
  id,
  key,
  value,
  provenance: "synthetic",
  scope: "synthetic",
  source,
  recordedAt: at(time),
});

export const seedModels: ModelVersion[] = [
  {
    id: "baseline-smooth50",
    name: "Nearest-player baseline",
    version: "smooth50",
    kind: "baseline",
    category: "heuristic baseline",
    status: "reference",
    summary:
      "On each frame, gives the ball to the team of the tracked player nearest to it. Then takes a centred majority vote over ±50 frames; when no frame in the window has a visible ball, the result is D.",
    intendedBehaviour:
      "The floor to beat. It is deliberately the simplest approach that does better than a constant guess.",
    source: "starter/baseline.py",
    features: ["spatial", "temporal"],
    params: { window: 50, tie_break: "home", distance: "metres" },
    metrics: [published("baseline-smooth50-M1", "spellF1", 0.2433), published("baseline-smooth50-M2", "macroF1", 0.6724)],
    limitations:
      "D only means the ball was missing for longer than the window. It has no notion of control, so the nearest player wins at any distance, even with the ball in the air. Ties go to home. It ignores Smart Tagging, homography and video.",
    notes: "This is the published floor. The model is the organisers' and is preserved unchanged.",
    createdAt: at("09:00"),
    updatedAt: at("09:00"),
    origin: "seed",
  },
  {
    id: "postprocess-v0-1",
    name: "Segment cleanup",
    version: "v0.1",
    kind: "candidate",
    category: "post-processing",
    status: "implemented",
    summary:
      "Post-processing applied to any per-frame label array. Fills same-team D/X gaps of up to 3 s, absorbs clusters of sub-second flicker and short spells, and works on each half separately.",
    intendedBehaviour:
      "Turn fragmented predictions back into whole possessions, without moving real possession boundaries.",
    source: "starter/postprocess.py",
    features: ["temporal", "dead-ball"],
    params: { min_spell: 25, max_gap: 75 },
    metrics: [],
    limitations:
      "A 3 s gap bridge can merge two real possessions when the same team restarts quickly. Tested on synthetic data only.",
    notes: "Not yet run on the baseline's match output. That needs the gated data and happens locally, never in the browser.",
    createdAt: at("10:30"),
    updatedAt: at("11:10"),
    origin: "seed",
  },
  {
    id: "state-machine-v0",
    name: "Possession state machine",
    version: "v0 (proposal)",
    kind: "candidate",
    category: "state model",
    status: "planned",
    summary:
      "An explicit H / A / D state model. A team change needs sustained evidence of control, and D needs evidence of a stoppage, not just a missing ball.",
    intendedBehaviour:
      "Fewer false possession changes and a dead-ball class that means something.",
    source: "",
    features: ["spatial", "motion", "temporal", "dead-ball"],
    params: {},
    metrics: [],
    limitations: "Not implemented. Every benefit listed here is a hypothesis.",
    notes: "Candidate for the next research step after segment cleanup has been evaluated.",
    createdAt: at("12:00"),
    updatedAt: at("12:00"),
    origin: "seed",
  },
];

export const seedExperiments: Experiment[] = [
  {
    id: "EXP-001",
    name: "Segment cleanup on a fragmented synthetic prediction",
    hypothesis:
      "Bridging same-team gaps and absorbing sub-second spells recovers whole possessions from a fragmented prediction.",
    category: "post-processing",
    status: "completed",
    modelId: "postprocess-v0-1",
    revision: "starter/postprocess.py, first version",
    params: { min_spell: 25, max_gap: 75, seed: 7, frames: 30000 },
    expectedOutcome: "spellF1 on the synthetic fixture rises well above the uncleaned prediction.",
    risks: "The synthetic noise only contains the two failure modes the module targets.",
    observations:
      "spellF1 rose from 0.2750 (258 predicted spells) to 0.9416. Five spells too many remained, caused by clustered blips. See EXP-002.",
    limitations: "Synthetic data only. It shows the repair works, not that it helps on the match.",
    metrics: [
      synthetic("EXP-001-M1", "spellF1_uncleaned", 0.275, "tests/test_postprocess.py EndToEnd, seed 7", "10:40"),
      synthetic("EXP-001-M2", "spellF1", 0.9416, "tests/test_postprocess.py EndToEnd, seed 7", "10:40"),
    ],
    statusHistory: [
      { status: "planned", at: at("10:20") },
      { status: "running", at: at("10:30") },
      { status: "completed", at: at("10:40") },
    ],
    createdAt: at("10:20"),
    updatedAt: at("10:40"),
    origin: "seed",
  },
  {
    id: "EXP-002",
    name: "Absorb flicker clusters as whole stretches",
    hypothesis:
      "Absorbing whole runs of consecutive sub-second spells stops clustered blips from fusing into fake possessions.",
    category: "post-processing",
    status: "completed",
    modelId: "postprocess-v0-1",
    revision: "starter/postprocess.py, absorb_noisy_stretches added",
    params: { min_spell: 25, max_gap: 75, seed: 7, frames: 30000 },
    expectedOutcome: "The predicted spell count gets close to the truth's 78.",
    risks: "A real sub-second possession between two opposing spells would be lost, which is accepted under a 1 s prior.",
    observations:
      "spellF1 rose from 0.9416 to 0.9809, with 79 predicted spells against 78 in the truth. Across ten other seeds the range was 0.955 to 1.0.",
    limitations: "Synthetic data only. The one remaining extra spell comes from two overlapping gaps longer than 3 s, which is correct behaviour.",
    metrics: [synthetic("EXP-002-M1", "spellF1", 0.9809, "tests/test_postprocess.py EndToEnd, seed 7", "11:10")],
    statusHistory: [
      { status: "planned", at: at("10:50") },
      { status: "running", at: at("10:55") },
      { status: "completed", at: at("11:10") },
    ],
    createdAt: at("10:50"),
    updatedAt: at("11:10"),
    origin: "seed",
  },
  {
    id: "EXP-003",
    name: "Segment cleanup on baseline_smooth50, full match",
    hypothesis:
      "Applying segment cleanup to the ±50 baseline raises full-match spellF1 by more than the 0.04 noise band.",
    category: "post-processing",
    status: "planned",
    modelId: "postprocess-v0-1",
    revision: "",
    params: { min_spell: 25, max_gap: 75, base: "baseline_smooth50" },
    expectedOutcome: "A higher spellF1 than 0.2433, with bootstrap intervals that don't overlap.",
    risks: "Bridging quick same-team restarts merges real possessions. Tuning on the public 5 minutes would pick the wrong values.",
    observations: "",
    limitations: "Needs the gated match data. It runs locally with the official scorer, never in the browser.",
    metrics: [],
    statusHistory: [{ status: "planned", at: at("12:10") }],
    createdAt: at("12:10"),
    updatedAt: at("12:10"),
    origin: "seed",
  },
];

export const seedLog: LogEntry[] = [
  {
    id: "L-001",
    date: DAY,
    kind: "decision",
    title: "Frontend isolated in web/",
    body: "The Python research code stays untouched. The dev server can only read files inside web/, and match assets are denied by pattern.",
    origin: "manual",
  },
  {
    id: "L-002",
    date: DAY,
    kind: "experiment",
    title: "Segment cleanup: synthetic spellF1 0.275 → 0.981",
    body: "On a fragmented synthetic prediction (seed 7, 30k frames). It shows the repair works. It is not evidence of a gain on the match.",
    origin: "manual",
  },
  {
    id: "L-003",
    date: DAY,
    kind: "bug",
    title: "Flicker clusters fused into fake spells",
    body: "Absorbing the shortest spell first merged A9·H2·A12·H2·A13 into a 38-frame possession. Fixed by absorbing whole noisy stretches.",
    origin: "manual",
  },
  {
    id: "L-004",
    date: DAY,
    kind: "bug",
    title: "Blank page: effect returned a Promise",
    body: "useEffect(() => window.scrollTo(0, 0)) returned the Promise that newer Chrome returns from scrollTo, and React tried to call it as a cleanup. Fixed with block-bodied effects.",
    origin: "manual",
  },
  {
    id: "L-005",
    date: DAY,
    kind: "limitation",
    title: "A 3 s gap bridge can merge two real possessions",
    body: "If the ball goes briefly dead and the same team restarts, the truth has two possessions, and the cleanup joins them into one.",
    origin: "manual",
  },
];
