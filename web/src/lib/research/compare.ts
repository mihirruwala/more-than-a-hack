// Comparison that refuses to overclaim. A "leader" exists only when every value is a verified
// measurement on the same scope, and the gap is wider than the scorer's own noise band.

import type { ExperimentMetric, MetricReading, ParamValue } from "../../types";
import { readMetric } from "./experiments";
import { differingKeys } from "./params";

/** EVALUATION.md: spellF1 gaps below ~0.04 are noise on the full match; macroF1 below ~0.01. */
export const NOISE_BAND: Record<string, number> = { spellF1: 0.04, macroF1: 0.01 };

export interface Comparable {
  id: string;
  label: string;
  metrics: ExperimentMetric[];
  params: Record<string, ParamValue>;
}

export type Verdict =
  | { kind: "insufficient"; reasons: string[] }
  | { kind: "within-noise"; margin: number; band: number }
  | { kind: "leader"; id: string; margin: number };

export interface MetricComparison {
  key: string;
  readings: { id: string; reading: MetricReading }[];
  verdict: Verdict;
}

export function compareMetric(items: Comparable[], key: string): MetricComparison {
  const readings = items.map((item) => ({ id: item.id, reading: readMetric(item.metrics, key) }));
  const reasons: string[] = [];

  const missing = items.filter((_, i) => readings[i]!.reading.kind === "unavailable");
  if (missing.length) reasons.push(`No ${key} recorded for ${missing.map((m) => m.label).join(", ")}.`);

  const recorded = readings.flatMap(({ reading }) => (reading.kind === "recorded" ? [reading.metric] : []));
  const unverified = recorded.filter((m) => m.provenance !== "verified");
  if (unverified.length) {
    const kinds = [...new Set(unverified.map((m) => m.provenance))].join(" / ");
    reasons.push(`Values are ${kinds}, not verified scorer output, so they can't establish a real difference.`);
  }
  const scopes = new Set(recorded.map((m) => m.scope));
  if (scopes.size > 1) reasons.push(`Scopes differ (${[...scopes].join(" vs ")}), so the numbers measure different things.`);

  // The public window is for checking a pipeline, never for choosing between versions: 17
  // possessions can't rank anything, and RULES.md forbids tuning on it.
  if (!reasons.length && recorded.length >= 2 && recorded.every((m) => m.scope === "public-window")) {
    reasons.push("These are public-window scores. With 17 possessions they can't rank versions, and the rules forbid choosing on them.");
  }

  if (reasons.length || recorded.length < 2) {
    if (!reasons.length) reasons.push("At least two recorded values are needed to compare.");
    return { key, readings, verdict: { kind: "insufficient", reasons } };
  }

  const sorted = readings
    .map(({ id, reading }) => ({ id, value: (reading as { kind: "recorded"; metric: ExperimentMetric }).metric.value }))
    .sort((a, b) => b.value - a.value);
  const margin = sorted[0]!.value - sorted[1]!.value;
  const band = NOISE_BAND[key] ?? 0;
  if (margin <= band) return { key, readings, verdict: { kind: "within-noise", margin, band } };
  return { key, readings, verdict: { kind: "leader", id: sorted[0]!.id, margin } };
}

export function compareParams(items: Comparable[]) {
  const keys = [...new Set(items.flatMap((item) => Object.keys(item.params)))].sort();
  const differing = differingKeys(items.map((item) => item.params));
  return { keys, differing };
}

/** All metric keys anywhere in the set, primary metrics first. */
export function metricKeys(items: Comparable[]): string[] {
  const rest = new Set(items.flatMap((item) => item.metrics.map((m) => m.key)));
  rest.delete("spellF1");
  rest.delete("macroF1");
  return ["spellF1", "macroF1", ...[...rest].sort()];
}

/** One plain sentence for the top of a comparison, built only from what is recorded. */
export function summarise(items: Comparable[], primary: MetricComparison): string {
  const names = items.map((i) => i.label).join(" and ");
  switch (primary.verdict.kind) {
    case "leader": {
      const leader = items.find((i) => i.id === (primary.verdict as { id: string }).id)!;
      return `${leader.label} leads on verified spellF1, by ${primary.verdict.margin.toFixed(4)}: more than the noise band.`;
    }
    case "within-noise":
      return `${names} are within the spellF1 noise band (±${primary.verdict.band}). Treat them as equal.`;
    default:
      return `No winner can be declared between ${names}. ${primary.verdict.reasons[0]}`;
  }
}
