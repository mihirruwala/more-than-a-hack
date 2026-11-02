// Runtime validation for everything read back from browser storage.
//
// Storage is untrusted: an older schema, a manual edit in DevTools or a half-written value can all
// put anything in there. Each parser returns a typed value or null and never throws, so one bad
// record is dropped and reported instead of taking the whole registry down.

import {
  ALGORITHM_CATEGORIES,
  EXPERIMENT_CATEGORIES,
  EXPERIMENT_STATUSES,
  FEATURE_CATEGORIES,
  LOG_KINDS,
  MODEL_STATUSES,
  type Experiment,
  type ExperimentMetric,
  type LogEntry,
  type MetricScope,
  type ModelVersion,
  type ParamValue,
  type Provenance,
  type StatusChange,
} from "../../types";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const oneOf = <T extends string>(options: readonly T[], v: unknown): v is T =>
  str(v) && (options as readonly string[]).includes(v);
const isoDate = (v: unknown): v is string => str(v) && !Number.isNaN(Date.parse(v));

const PROVENANCES: readonly Provenance[] = ["published", "verified", "manual", "synthetic", "demo"];
const SCOPES: readonly MetricScope[] = ["full-match", "public-window", "synthetic"];

function params(v: unknown): Record<string, ParamValue> | null {
  if (!isObj(v)) return null;
  const out: Record<string, ParamValue> = {};
  for (const [key, value] of Object.entries(v)) {
    if (!(str(value) || num(value) || typeof value === "boolean")) return null;
    out[key] = value;
  }
  return out;
}

function list<T>(v: unknown, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(v)) return null;
  const out: T[] = [];
  for (const item of v) {
    const parsed = parse(item);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

export function parseMetric(v: unknown): ExperimentMetric | null {
  if (!isObj(v)) return null;
  const { id, key, value, provenance, scope, source, recordedAt } = v;
  if (!str(id) || !str(key) || !key.trim() || !num(value)) return null;
  if (!oneOf(PROVENANCES, provenance) || !oneOf(SCOPES, scope)) return null;
  if (!str(source) || !isoDate(recordedAt)) return null;
  return { id, key, value, provenance, scope, source, recordedAt };
}

function parseStatusChange(v: unknown): StatusChange | null {
  if (!isObj(v) || !oneOf(EXPERIMENT_STATUSES, v.status) || !isoDate(v.at)) return null;
  return { status: v.status, at: v.at };
}

export function parseExperiment(v: unknown): Experiment | null {
  if (!isObj(v)) return null;
  const textFields = ["id", "name", "hypothesis", "modelId", "revision", "expectedOutcome", "risks", "observations", "limitations"] as const;
  for (const field of textFields) if (!str(v[field])) return null;
  if (!(v.id as string).trim() || !(v.name as string).trim()) return null;
  if (!oneOf(EXPERIMENT_CATEGORIES, v.category) || !oneOf(EXPERIMENT_STATUSES, v.status)) return null;
  if (!isoDate(v.createdAt) || !isoDate(v.updatedAt)) return null;
  if (v.origin !== "seed" && v.origin !== "user") return null;

  const parsedParams = params(v.params);
  const metrics = list(v.metrics, parseMetric);
  const history = list(v.statusHistory, parseStatusChange);
  if (!parsedParams || !metrics || !history) return null;

  return {
    id: v.id as string,
    name: v.name as string,
    hypothesis: v.hypothesis as string,
    category: v.category,
    status: v.status,
    modelId: v.modelId as string,
    revision: v.revision as string,
    params: parsedParams,
    expectedOutcome: v.expectedOutcome as string,
    risks: v.risks as string,
    observations: v.observations as string,
    limitations: v.limitations as string,
    metrics,
    statusHistory: history,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    origin: v.origin,
  };
}

export function parseModel(v: unknown): ModelVersion | null {
  if (!isObj(v)) return null;
  const textFields = ["id", "name", "version", "summary", "intendedBehaviour", "source", "limitations", "notes"] as const;
  for (const field of textFields) if (!str(v[field])) return null;
  if (!(v.id as string).trim() || !(v.name as string).trim()) return null;
  if (v.kind !== "baseline" && v.kind !== "candidate") return null;
  if (!oneOf(ALGORITHM_CATEGORIES, v.category) || !oneOf(MODEL_STATUSES, v.status)) return null;
  if (!isoDate(v.createdAt) || !isoDate(v.updatedAt)) return null;
  if (v.origin !== "seed" && v.origin !== "user") return null;
  if (v.runtime !== undefined && !str(v.runtime)) return null;

  const features = list(v.features, (f) => (oneOf(FEATURE_CATEGORIES, f) ? f : null));
  const parsedParams = params(v.params);
  const metrics = list(v.metrics, parseMetric);
  if (!features || !parsedParams || !metrics) return null;

  return {
    id: v.id as string,
    name: v.name as string,
    version: v.version as string,
    kind: v.kind,
    category: v.category,
    status: v.status,
    summary: v.summary as string,
    intendedBehaviour: v.intendedBehaviour as string,
    source: v.source as string,
    features,
    params: parsedParams,
    metrics,
    ...(v.runtime !== undefined ? { runtime: v.runtime as string } : {}),
    limitations: v.limitations as string,
    notes: v.notes as string,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    origin: v.origin,
  };
}

export function parseLogEntry(v: unknown): LogEntry | null {
  if (!isObj(v)) return null;
  if (!str(v.id) || !str(v.title) || !v.title.trim() || !str(v.body)) return null;
  if (!oneOf(LOG_KINDS, v.kind) || !isoDate(v.date) || v.origin !== "manual") return null;
  return { id: v.id, date: v.date as string, kind: v.kind, title: v.title, body: v.body, origin: "manual" };
}

/** Parse each record on its own and keep the good ones, counting what was dropped. */
export function parseCollection<T extends { id: string }>(
  v: unknown,
  parse: (item: unknown) => T | null,
): { items: T[]; dropped: number } | null {
  if (!Array.isArray(v)) return null;
  const items: T[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const raw of v) {
    const item = parse(raw);
    if (!item || seen.has(item.id)) {
      dropped += 1;
      continue;
    }
    seen.add(item.id);
    items.push(item);
  }
  return { items, dropped };
}
