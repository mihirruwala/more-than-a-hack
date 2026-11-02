// The research store: models, experiments and the project log, persisted locally.
//
// A plain object with subscribe/getState, so it is testable without React, and React reads it
// through useSyncExternalStore (see useResearch.ts). Every mutation goes through here, validates,
// saves, then notifies. This is also the seam a future API-backed store would replace.

import { seedExperiments, seedLog, seedModels } from "../../data/fixtures/seed";
import type { Experiment, ExperimentStatus, LogEntry, ModelVersion } from "../../types";
import {
  experimentFromDraft,
  metricFromDraft,
  nextExperimentId,
  nextMetricId,
  validateExperimentDraft,
  validateMetricDraft,
  withStatus,
  type ExperimentDraft,
  type FieldErrors,
  type MetricDraft,
} from "../research/experiments";
import { paramsFromRows } from "../research/params";
import { metricsFromReport, type ScorerReport } from "../research/scorerReport";
import { modelFromDraft, modelIdFor, validateModelDraft, type ModelDraft } from "../research/models";
import { loadState, saveState, type KeyValueStorage, type LoadResult, type ResearchState } from "./persistence";

export type Result<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

export interface StoreStatus {
  origin: LoadResult["origin"];
  issues: string[];
  saveError: string | null;
}

export interface LogDraft {
  date: string;
  kind: LogEntry["kind"];
  title: string;
  body: string;
}

export const seedState = (): ResearchState => structuredClone({ models: seedModels, experiments: seedExperiments, log: seedLog });

export function createResearchStore(storage: KeyValueStorage, now: () => string = () => new Date().toISOString()) {
  const loaded = loadState(storage, seedState);
  let state: ResearchState = loaded.state;
  let status: StoreStatus = { origin: loaded.origin, issues: loaded.issues, saveError: null };
  const listeners = new Set<() => void>();

  // Persist the recovered/seeded state straight away, so the next load is clean.
  if (loaded.origin !== "stored") persist();

  function persist() {
    const result = saveState(storage, state);
    status = { ...status, saveError: result.ok ? null : result.error };
  }

  function commit(next: ResearchState) {
    state = next;
    persist();
    listeners.forEach((listener) => listener());
  }

  const experimentNames = (exceptId?: string) => state.experiments.filter((e) => e.id !== exceptId).map((e) => e.name);
  const findExperiment = (id: string) => state.experiments.find((e) => e.id === id);
  const replaceExperiment = (next: Experiment) =>
    commit({ ...state, experiments: state.experiments.map((e) => (e.id === next.id ? next : e)) });

  return {
    getState: () => state,
    getStatus: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    // -- experiments -----------------------------------------------------------------------
    createExperiment(draft: ExperimentDraft): Result<Experiment> {
      const errors = validateExperimentDraft(draft, {
        modelIds: state.models.map((m) => m.id),
        existingNames: experimentNames(),
        isNew: true,
      });
      if (Object.keys(errors).length) return { ok: false, errors };
      const experiment = experimentFromDraft(draft, nextExperimentId(state.experiments), now());
      commit({ ...state, experiments: [...state.experiments, experiment] });
      return { ok: true, value: experiment };
    },

    /** Edits the description and configuration. Status changes go through setExperimentStatus. */
    updateExperiment(id: string, draft: ExperimentDraft): Result<Experiment> {
      const current = findExperiment(id);
      if (!current) return { ok: false, errors: { form: "This experiment no longer exists." } };
      const errors = validateExperimentDraft(
        { ...draft, status: current.status },
        { modelIds: state.models.map((m) => m.id), existingNames: experimentNames(id), isNew: false },
      );
      if (Object.keys(errors).length) return { ok: false, errors };
      const next: Experiment = {
        ...current,
        name: draft.name.trim(),
        hypothesis: draft.hypothesis.trim(),
        category: draft.category as Experiment["category"],
        modelId: draft.modelId,
        revision: draft.revision.trim(),
        params: paramsFromRows(draft.params),
        expectedOutcome: draft.expectedOutcome.trim(),
        risks: draft.risks.trim(),
        observations: draft.observations.trim(),
        limitations: draft.limitations.trim(),
        updatedAt: now(),
      };
      replaceExperiment(next);
      return { ok: true, value: next };
    },

    setExperimentStatus(id: string, next: ExperimentStatus): Result<Experiment> {
      const current = findExperiment(id);
      if (!current) return { ok: false, errors: { form: "This experiment no longer exists." } };
      try {
        const updated = withStatus(current, next, now());
        replaceExperiment(updated);
        return { ok: true, value: updated };
      } catch (error) {
        return { ok: false, errors: { status: (error as Error).message } };
      }
    },

    deleteExperiment(id: string) {
      commit({ ...state, experiments: state.experiments.filter((e) => e.id !== id) });
    },

    addExperimentMetric(id: string, draft: MetricDraft): Result<Experiment> {
      const current = findExperiment(id);
      if (!current) return { ok: false, errors: { form: "This experiment no longer exists." } };
      const errors = validateMetricDraft(draft);
      if (Object.keys(errors).length) return { ok: false, errors };
      const metric = metricFromDraft(draft, nextMetricId(id, current.metrics), now());
      const next = { ...current, metrics: [...current.metrics, metric], updatedAt: metric.recordedAt };
      replaceExperiment(next);
      return { ok: true, value: next };
    },

    /**
     * Attach the aggregates of an official scorer report to an experiment, as verified metrics.
     * The same report file (same SHA-256) can't be imported into the same experiment twice.
     */
    importScorerReport(id: string, report: ScorerReport, fileSha256: string | null): Result<Experiment> {
      const current = findExperiment(id);
      if (!current) return { ok: false, errors: { form: "This experiment no longer exists." } };
      if (fileSha256 && current.metrics.some((m) => m.source.includes(`sha256 ${fileSha256.slice(0, 16)}`)))
        return { ok: false, errors: { form: "This report is already imported into this experiment." } };
      const at = now();
      let n = Number(nextMetricId(id, current.metrics).split("-M").pop()) - 1;
      const added = metricsFromReport(report, () => `${id}-M${(n += 1)}`, at, fileSha256);
      const next = { ...current, metrics: [...current.metrics, ...added], updatedAt: at };
      replaceExperiment(next);
      return { ok: true, value: next };
    },

    removeExperimentMetric(id: string, metricId: string) {
      const current = findExperiment(id);
      if (!current) return;
      replaceExperiment({ ...current, metrics: current.metrics.filter((m) => m.id !== metricId), updatedAt: now() });
    },

    // -- models ----------------------------------------------------------------------------
    createModel(draft: ModelDraft): Result<ModelVersion> {
      const errors = validateModelDraft(draft, { others: state.models });
      if (Object.keys(errors).length) return { ok: false, errors };
      const model = modelFromDraft(draft, modelIdFor(draft, state.models.map((m) => m.id)), now());
      commit({ ...state, models: [...state.models, model] });
      return { ok: true, value: model };
    },

    updateModel(id: string, draft: ModelDraft): Result<ModelVersion> {
      const current = state.models.find((m) => m.id === id);
      if (!current) return { ok: false, errors: { form: "This model no longer exists." } };
      const errors = validateModelDraft(draft, { others: state.models.filter((m) => m.id !== id) });
      if (Object.keys(errors).length) return { ok: false, errors };
      const next = modelFromDraft(draft, id, now(), current);
      commit({ ...state, models: state.models.map((m) => (m.id === id ? next : m)) });
      return { ok: true, value: next };
    },

    /** Refuses while experiments still point at the model, so no record is orphaned. */
    deleteModel(id: string): Result<null> {
      const users = state.experiments.filter((e) => e.modelId === id);
      if (users.length)
        return { ok: false, errors: { form: `Used by ${users.map((e) => e.id).join(", ")}. Reassign or delete those first.` } };
      commit({ ...state, models: state.models.filter((m) => m.id !== id) });
      return { ok: true, value: null };
    },

    // -- log -------------------------------------------------------------------------------
    addLogEntry(draft: LogDraft): Result<LogEntry> {
      const errors: FieldErrors = {};
      if (!draft.title.trim()) errors.title = "Give the entry a title.";
      if (!draft.date || Number.isNaN(Date.parse(draft.date))) errors.date = "Choose a date.";
      if (Object.keys(errors).length) return { ok: false, errors };
      const max = state.log.reduce((m, { id }) => Math.max(m, Number(/^L-(\d+)$/.exec(id)?.[1] ?? 0)), 0);
      const entry: LogEntry = {
        id: `L-${String(max + 1).padStart(3, "0")}`,
        date: draft.date,
        kind: draft.kind,
        title: draft.title.trim(),
        body: draft.body.trim(),
        origin: "manual",
      };
      commit({ ...state, log: [...state.log, entry] });
      return { ok: true, value: entry };
    },

    deleteLogEntry(id: string) {
      commit({ ...state, log: state.log.filter((entry) => entry.id !== id) });
    },

    // -- whole store -----------------------------------------------------------------------
    reset() {
      status = { origin: "seed", issues: [], saveError: null };
      commit(seedState());
    },

    exportJson(): string {
      return JSON.stringify(
        {
          exportedAt: now(),
          note: "Barça Lab research metadata. It contains no match data. Metrics keep their provenance.",
          ...state,
        },
        null,
        2,
      );
    },
  };
}

export type ResearchStore = ReturnType<typeof createResearchStore>;
