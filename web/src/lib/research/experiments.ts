// Experiment drafts, validation, lifecycle and querying. Pure functions; the store calls these.

import {
  EXPERIMENT_CATEGORIES,
  EXPERIMENT_STATUSES,
  type EnterableProvenance,
  type Experiment,
  type ExperimentCategory,
  type ExperimentMetric,
  type ExperimentStatus,
  type MetricReading,
  type MetricScope,
} from "../../types";
import { paramsFromRows, rowsFromParams, validateParamRows, type ParamRow } from "./params";

export type FieldErrors = Record<string, string>;

// -- drafts ---------------------------------------------------------------------------------

export interface ExperimentDraft {
  name: string;
  hypothesis: string;
  category: ExperimentCategory | "";
  status: ExperimentStatus;
  modelId: string;
  revision: string;
  params: ParamRow[];
  expectedOutcome: string;
  risks: string;
  observations: string;
  limitations: string;
}

export const emptyExperimentDraft = (modelId = ""): ExperimentDraft => ({
  name: "",
  hypothesis: "",
  category: "",
  status: "planned",
  modelId,
  revision: "",
  params: [{ key: "", value: "" }],
  expectedOutcome: "",
  risks: "",
  observations: "",
  limitations: "",
});

export const draftFromExperiment = (e: Experiment): ExperimentDraft => ({
  name: e.name,
  hypothesis: e.hypothesis,
  category: e.category,
  status: e.status,
  modelId: e.modelId,
  revision: e.revision,
  params: [...rowsFromParams(e.params), { key: "", value: "" }],
  expectedOutcome: e.expectedOutcome,
  risks: e.risks,
  observations: e.observations,
  limitations: e.limitations,
});

/** A new record may start planned or running. Completed or failed must be reached by doing it. */
export const CREATABLE_STATUSES: ExperimentStatus[] = ["planned", "running"];

export function validateExperimentDraft(
  draft: ExperimentDraft,
  context: { modelIds: string[]; existingNames: string[]; isNew: boolean },
): FieldErrors {
  const errors: FieldErrors = {};
  const name = draft.name.trim();
  if (!name) errors.name = "Name the experiment.";
  else if (name.length > 120) errors.name = "Keep the name under 120 characters.";
  else if (context.existingNames.some((n) => n.trim().toLowerCase() === name.toLowerCase()))
    errors.name = "Another experiment already has this name.";

  if (!draft.hypothesis.trim()) errors.hypothesis = "State what you expect to happen, and why.";
  else if (draft.hypothesis.trim().length < 20)
    errors.hypothesis = "A hypothesis needs a little more detail (at least 20 characters).";

  if (!draft.category || !EXPERIMENT_CATEGORIES.includes(draft.category)) errors.category = "Choose a category.";
  if (!draft.modelId) errors.modelId = "Choose the model version this tests.";
  else if (!context.modelIds.includes(draft.modelId)) errors.modelId = "That model no longer exists.";

  if (!EXPERIMENT_STATUSES.includes(draft.status)) errors.status = "Choose a status.";
  else if (context.isNew && !CREATABLE_STATUSES.includes(draft.status))
    errors.status = "New experiments start as planned or running.";

  return { ...errors, ...validateParamRows(draft.params) };
}

export function experimentFromDraft(draft: ExperimentDraft, id: string, now: string): Experiment {
  return {
    id,
    name: draft.name.trim(),
    hypothesis: draft.hypothesis.trim(),
    category: draft.category as ExperimentCategory,
    status: draft.status,
    modelId: draft.modelId,
    revision: draft.revision.trim(),
    params: paramsFromRows(draft.params),
    expectedOutcome: draft.expectedOutcome.trim(),
    risks: draft.risks.trim(),
    observations: draft.observations.trim(),
    limitations: draft.limitations.trim(),
    metrics: [],
    statusHistory: [{ status: draft.status, at: now }],
    createdAt: now,
    updatedAt: now,
    origin: "user",
  };
}

/** "EXP-007": one past the highest number in use, so ids never collide after a delete. */
export function nextExperimentId(existing: { id: string }[]): string {
  const max = existing.reduce((m, { id }) => {
    const n = /^EXP-(\d+)$/.exec(id)?.[1];
    return n ? Math.max(m, Number(n)) : m;
  }, 0);
  return `EXP-${String(max + 1).padStart(3, "0")}`;
}

// -- lifecycle ------------------------------------------------------------------------------

/**
 * Allowed status changes. Planned can't jump straight to completed: something has to have run.
 * A completed experiment can be re-opened to running; a failed one can be retried.
 */
export const TRANSITIONS: Record<ExperimentStatus, ExperimentStatus[]> = {
  planned: ["running", "failed"],
  running: ["completed", "failed", "planned"],
  completed: ["running"],
  failed: ["planned", "running"],
};

export const canTransition = (from: ExperimentStatus, to: ExperimentStatus) => TRANSITIONS[from].includes(to);

export function withStatus(experiment: Experiment, status: ExperimentStatus, now: string): Experiment {
  if (!canTransition(experiment.status, status)) {
    throw new Error(`Cannot move ${experiment.id} from ${experiment.status} to ${status}.`);
  }
  return {
    ...experiment,
    status,
    statusHistory: [...experiment.statusHistory, { status, at: now }],
    updatedAt: now,
  };
}

// -- metrics --------------------------------------------------------------------------------

export interface MetricDraft {
  key: string;
  value: string;
  provenance: EnterableProvenance;
  scope: MetricScope;
  source: string;
}

export const emptyMetricDraft = (): MetricDraft => ({
  key: "spellF1",
  value: "",
  provenance: "manual",
  scope: "synthetic",
  source: "",
});

const BOUNDED = new Set(["spellF1", "macroF1"]);

export function validateMetricDraft(draft: MetricDraft): FieldErrors {
  const errors: FieldErrors = {};
  const key = draft.key.trim();
  if (!key) errors.key = "Name the metric.";
  else if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(key)) errors.key = "Use letters, digits, _ . or -.";

  const value = Number(draft.value);
  if (draft.value.trim() === "") errors.value = "Enter the value.";
  else if (!Number.isFinite(value)) errors.value = "Enter a number, e.g. 0.2433.";
  else if (BOUNDED.has(key) && (value < 0 || value > 1)) errors.value = `${key} is between 0 and 1.`;

  if (draft.provenance !== "manual" && draft.provenance !== "synthetic")
    errors.provenance = "Hand-entered values are manual or synthetic. Verified is reserved for imported scorer output.";
  if (draft.scope === "full-match" && draft.provenance === "synthetic")
    errors.scope = "A synthetic value can't have full-match scope.";
  if (!draft.source.trim()) errors.source = "Say where the number came from: a command, file or run.";
  return errors;
}

export function metricFromDraft(draft: MetricDraft, id: string, now: string): ExperimentMetric {
  return {
    id,
    key: draft.key.trim(),
    value: Number(draft.value),
    provenance: draft.provenance,
    scope: draft.scope,
    source: draft.source.trim(),
    recordedAt: now,
  };
}

export function nextMetricId(ownerId: string, metrics: ExperimentMetric[]): string {
  const max = metrics.reduce((m, { id }) => {
    const n = new RegExp(`^${ownerId}-M(\\d+)$`).exec(id)?.[1];
    return n ? Math.max(m, Number(n)) : m;
  }, 0);
  return `${ownerId}-M${max + 1}`;
}

/** The most recently recorded value of one metric, or the honest absence of one. */
export function readMetric(metrics: ExperimentMetric[], key: string): MetricReading {
  let latest: ExperimentMetric | undefined;
  for (const metric of metrics) {
    if (metric.key !== key) continue;
    if (!latest || metric.recordedAt > latest.recordedAt) latest = metric;
  }
  return latest ? { kind: "recorded", metric: latest } : { kind: "unavailable" };
}

// -- querying -------------------------------------------------------------------------------

export type SortKey = "updated" | "created" | "name" | "spellF1";

export interface ExperimentQuery {
  search: string;
  status: ExperimentStatus | "all";
  modelId: string | "all";
  category: ExperimentCategory | "all";
  sort: SortKey;
  direction: "asc" | "desc";
}

export const defaultQuery: ExperimentQuery = {
  search: "",
  status: "all",
  modelId: "all",
  category: "all",
  sort: "updated",
  direction: "desc",
};

export function queryExperiments(experiments: Experiment[], query: ExperimentQuery): Experiment[] {
  const needle = query.search.trim().toLowerCase();
  const filtered = experiments.filter((e) => {
    if (query.status !== "all" && e.status !== query.status) return false;
    if (query.modelId !== "all" && e.modelId !== query.modelId) return false;
    if (query.category !== "all" && e.category !== query.category) return false;
    if (!needle) return true;
    return [e.id, e.name, e.hypothesis, e.observations, e.revision].some((field) =>
      field.toLowerCase().includes(needle),
    );
  });

  const sign = query.direction === "asc" ? 1 : -1;
  return filtered.sort((a, b) => {
    if (query.sort === "spellF1") {
      const va = readMetric(a.metrics, "spellF1");
      const vb = readMetric(b.metrics, "spellF1");
      // Unrecorded always sinks to the bottom, whichever way the column is sorted.
      if (va.kind !== vb.kind) return va.kind === "unavailable" ? 1 : -1;
      if (va.kind === "recorded" && vb.kind === "recorded" && va.metric.value !== vb.metric.value)
        return sign * (va.metric.value - vb.metric.value);
      return a.id.localeCompare(b.id);
    }
    const field = query.sort === "name" ? "name" : query.sort === "created" ? "createdAt" : "updatedAt";
    const order = a[field].localeCompare(b[field]);
    return order ? sign * order : a.id.localeCompare(b.id);
  });
}
