// Domain types shared by every page. The store and adapters return these; components render them.
// Nothing here knows whether data came from a fixture, localStorage or a future Python API.

/**
 * Where a number came from, and therefore how far it can be trusted.
 *
 * - published  quoted from the competition's own documentation (e.g. EVALUATION.md)
 * - verified   produced by the official scorer and imported from its output. Reserved: the UI
 *              cannot create it until a real scorer integration exists.
 * - manual     typed in by a person; never treated as verified
 * - synthetic  computed on synthetic data (e.g. unit-test fixtures), not on the match
 * - demo       illustrative only; invented for the UI and meaningless as a result
 */
export type Provenance = "published" | "verified" | "manual" | "synthetic" | "demo";

/** Provenances a person may choose when entering a metric by hand. */
export type EnterableProvenance = Extract<Provenance, "manual" | "synthetic">;

export type MetricScope = "full-match" | "public-window" | "synthetic";

export interface SourceRef {
  provenance: Provenance;
  /** Human-readable origin: a file, a command, a person. */
  source: string;
  recordedAt?: string; // ISO date
}

/** Legacy aggregate used by the published baseline sweep. */
export interface Metrics {
  spellF1?: number;
  macroF1?: number;
  nPredSpells?: number;
}

export interface MetricRecord extends SourceRef {
  metrics: Metrics;
  scope: MetricScope;
}

/** spellF1 ranks the board; macroF1 is the first tie-break; anything else is diagnostic. */
export type MetricKey = "spellF1" | "macroF1" | (string & {});
export const PRIMARY_METRICS = ["spellF1", "macroF1"] as const;

/** One recorded measurement. A metric that was never recorded is absent, never zero. */
export interface ExperimentMetric {
  id: string;
  key: MetricKey;
  value: number;
  provenance: Provenance;
  scope: MetricScope;
  source: string;
  recordedAt: string; // ISO datetime
}

/** What a page shows for one metric: either a recorded value or the honest absence of one. */
export type MetricReading =
  | { kind: "recorded"; metric: ExperimentMetric }
  | { kind: "unavailable" };

// -- experiments ----------------------------------------------------------------------------

export const EXPERIMENT_STATUSES = ["planned", "running", "completed", "failed"] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export const EXPERIMENT_CATEGORIES = [
  "baseline",
  "post-processing",
  "spatial",
  "motion",
  "dead-ball",
  "tactical",
  "evaluation",
] as const;
export type ExperimentCategory = (typeof EXPERIMENT_CATEGORIES)[number];

export type ParamValue = string | number | boolean;

export interface StatusChange {
  status: ExperimentStatus;
  at: string; // ISO datetime
}

export interface Experiment {
  id: string; // "EXP-001"
  name: string;
  hypothesis: string;
  category: ExperimentCategory;
  status: ExperimentStatus;
  modelId: string;
  revision: string;
  params: Record<string, ParamValue>;
  expectedOutcome: string;
  risks: string;
  observations: string;
  limitations: string;
  metrics: ExperimentMetric[];
  statusHistory: StatusChange[];
  createdAt: string;
  updatedAt: string;
  origin: "seed" | "user";
}

// -- models ---------------------------------------------------------------------------------

export const FEATURE_CATEGORIES = ["spatial", "motion", "temporal", "dead-ball", "tactical"] as const;
export type FeatureCategory = (typeof FEATURE_CATEGORIES)[number];

export const MODEL_STATUSES = ["reference", "implemented", "in-progress", "planned"] as const;
export type ModelStatus = (typeof MODEL_STATUSES)[number];

export const ALGORITHM_CATEGORIES = [
  "heuristic baseline",
  "post-processing",
  "state model",
  "learned classifier",
] as const;
export type AlgorithmCategory = (typeof ALGORITHM_CATEGORIES)[number];

export interface ModelVersion {
  id: string;
  name: string;
  version: string;
  kind: "baseline" | "candidate";
  category: AlgorithmCategory;
  status: ModelStatus;
  summary: string;
  intendedBehaviour: string;
  source: string; // file path in the repo, or "" if not written yet
  features: FeatureCategory[];
  params: Record<string, ParamValue>;
  /** Measurements attached to the model itself (e.g. published baseline scores). */
  metrics: ExperimentMetric[];
  runtime?: string; // only when actually measured
  limitations: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  origin: "seed" | "user";
}

// -- project --------------------------------------------------------------------------------

export type MilestoneStatus = "done" | "active" | "blocked" | "todo";

export interface Milestone {
  id: string;
  title: string;
  detail: string;
  status: MilestoneStatus;
  due?: string;
}

export const LOG_KINDS = ["milestone", "decision", "bug", "experiment", "limitation", "next"] as const;
export type LogKind = (typeof LOG_KINDS)[number];

export interface LogEntry {
  id: string;
  date: string;
  kind: LogKind;
  title: string;
  body: string;
  /** Every entry is manual until automatic tracking actually exists. */
  origin: "manual";
}

export interface ProjectInfo {
  name: string;
  tagline: string;
  phase: string;
  deadline: string; // ISO date
  currentModelId: string;
}

// -- match ----------------------------------------------------------------------------------

export type PossessionState = "H" | "A" | "D" | "X";
export const POSSESSION_STATES: PossessionState[] = ["H", "A", "D", "X"];

export interface PossessionSegment {
  start: number; // frame, inclusive
  end: number; // frame, exclusive
  state: PossessionState;
}

export type PitchThird = "defensive" | "middle" | "final";
export type PitchChannel = "left" | "centre" | "right";

/** A segment of the demo fixture: the same interval plus the context the UI explains. */
export interface MatchSegment extends PossessionSegment {
  index: number; // position in the whole match, 0-based
  period: 1 | 2;
  /** Synthetic location of the play, from the possessing team's attacking perspective. */
  zone?: { third: PitchThird; channel: PitchChannel };
  note: string;
}

export interface MatchTeam {
  name: string;
  short: string;
  side: "H" | "A";
}

export interface MatchPeriod {
  id: 1 | 2;
  label: string;
  start: number; // frame, inclusive
  end: number; // frame, exclusive
}

export interface MatchFixture {
  id: string;
  title: string;
  competition: string;
  provenance: "demo";
  source: string;
  fps: number;
  home: MatchTeam;
  away: MatchTeam;
  periods: MatchPeriod[];
  segments: MatchSegment[];
}

export interface TimelineFilter {
  states: Record<PossessionState, boolean>;
  period: "all" | 1 | 2;
}

// -- methodology ----------------------------------------------------------------------------

export type StageStatus = "implemented" | "proposed" | "investigating" | "verified";

export interface Evidence {
  label: string;
  ref: string; // repo path or experiment id
}

export interface MethodologyStage {
  id: string;
  number: number;
  title: string;
  summary: string;
  detail: string;
  status: StageStatus;
  evidence: Evidence[];
  /** Short honest caveat; shown under the stage. */
  caveat?: string;
}
