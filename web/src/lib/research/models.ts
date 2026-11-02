import {
  ALGORITHM_CATEGORIES,
  FEATURE_CATEGORIES,
  MODEL_STATUSES,
  type AlgorithmCategory,
  type FeatureCategory,
  type ModelStatus,
  type ModelVersion,
} from "../../types";
import type { FieldErrors } from "./experiments";
import { paramsFromRows, rowsFromParams, validateParamRows, type ParamRow } from "./params";

export interface ModelDraft {
  name: string;
  version: string;
  kind: "baseline" | "candidate";
  category: AlgorithmCategory | "";
  status: ModelStatus;
  summary: string;
  intendedBehaviour: string;
  source: string;
  features: FeatureCategory[];
  params: ParamRow[];
  runtime: string;
  limitations: string;
  notes: string;
}

export const emptyModelDraft = (): ModelDraft => ({
  name: "",
  version: "",
  kind: "candidate",
  category: "",
  status: "planned",
  summary: "",
  intendedBehaviour: "",
  source: "",
  features: [],
  params: [{ key: "", value: "" }],
  runtime: "",
  limitations: "",
  notes: "",
});

export const draftFromModel = (m: ModelVersion): ModelDraft => ({
  name: m.name,
  version: m.version,
  kind: m.kind,
  category: m.category,
  status: m.status,
  summary: m.summary,
  intendedBehaviour: m.intendedBehaviour,
  source: m.source,
  features: [...m.features],
  params: [...rowsFromParams(m.params), { key: "", value: "" }],
  runtime: m.runtime ?? "",
  limitations: m.limitations,
  notes: m.notes,
});

export function validateModelDraft(
  draft: ModelDraft,
  context: { others: Pick<ModelVersion, "name" | "version">[] },
): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.name.trim()) errors.name = "Name the model.";
  if (!draft.version.trim()) errors.version = "Give it a version, e.g. v0.2.";
  if (
    draft.name.trim() &&
    draft.version.trim() &&
    context.others.some(
      (o) => o.name.trim().toLowerCase() === draft.name.trim().toLowerCase() && o.version.trim() === draft.version.trim(),
    )
  )
    errors.version = "This name and version already exist. Bump the version.";
  if (!draft.category || !ALGORITHM_CATEGORIES.includes(draft.category)) errors.category = "Choose an algorithm category.";
  if (!MODEL_STATUSES.includes(draft.status)) errors.status = "Choose a status.";
  if (!draft.summary.trim()) errors.summary = "Describe the algorithm in a sentence or two.";
  if (draft.features.some((f) => !FEATURE_CATEGORIES.includes(f))) errors.features = "Unknown feature category.";
  return { ...errors, ...validateParamRows(draft.params) };
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "model";

/** A readable, stable id: "segment-cleanup-v0-2", suffixed only if needed. */
export function modelIdFor(draft: Pick<ModelDraft, "name" | "version">, taken: string[]): string {
  const base = `${slug(draft.name)}-${slug(draft.version)}`;
  let id = base;
  for (let n = 2; taken.includes(id); n += 1) id = `${base}-${n}`;
  return id;
}

export function modelFromDraft(draft: ModelDraft, id: string, now: string, previous?: ModelVersion): ModelVersion {
  const runtime = draft.runtime.trim();
  return {
    id,
    name: draft.name.trim(),
    version: draft.version.trim(),
    kind: draft.kind,
    category: draft.category as AlgorithmCategory,
    status: draft.status,
    summary: draft.summary.trim(),
    intendedBehaviour: draft.intendedBehaviour.trim(),
    source: draft.source.trim(),
    features: FEATURE_CATEGORIES.filter((f) => draft.features.includes(f)),
    params: paramsFromRows(draft.params),
    metrics: previous?.metrics ?? [],
    ...(runtime ? { runtime } : {}),
    limitations: draft.limitations.trim(),
    notes: draft.notes.trim(),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    origin: previous?.origin ?? "user",
  };
}

/** The latest moment a metric was recorded for the model, or null when it was never evaluated. */
export function lastEvaluated(model: ModelVersion, experimentMetrics: { recordedAt: string }[]): string | null {
  const all = [...model.metrics, ...experimentMetrics].map((m) => m.recordedAt).sort();
  return all.length ? all[all.length - 1]! : null;
}
