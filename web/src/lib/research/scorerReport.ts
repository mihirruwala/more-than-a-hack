// Import adapter for the official scorer's per-submission report:
//   python evaluation/run_evaluation.py  →  evaluation/reports/<name>.json
//
// Field names and types follow run_evaluation.json_safe(pm.evaluate(...)) plus the `submission`,
// `ground_truth` and `taus` keys main() adds. Only aggregates are taken from the report; nothing
// per-frame exists in it, and nothing per-frame is stored.
//
// The browser can check that a report is well-formed and internally consistent. It cannot prove
// that the official scorer wrote it. The UI says so; re-running the scorer reproduces it.

import type { ExperimentMetric, MetricScope } from "../../types";

export const N_FRAMES = 199_319;

/** Published shapes of the two ground truths (README.md, DATA.md, EVALUATION.md). */
const GROUND_TRUTHS: { pattern: RegExp; scope: MetricScope; graded: number; spells: number | null; label: string }[] = [
  { pattern: /_possession_gt_public\.csv$/, scope: "public-window", graded: 7_500, spells: 17, label: "public 5-minute window" },
  { pattern: /_possession_gt\.csv$/, scope: "full-match", graded: 158_857, spells: null, label: "full match (organisers only)" },
];

export interface ScorerReport {
  submission: string;
  groundTruth: string;
  scope: MetricScope;
  scopeLabel: string;
  spellF1: number;
  macroF1: number;
  nPredSpells: number;
  nGtSpells: number;
  nGraded: number;
  aliveDeadF1: number | null;
  abstainedOnGraded: number | null;
}

export type ReportParse = { ok: true; report: ScorerReport } | { ok: false; errors: string[] };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const unit = (v: unknown) => isNum(v) && v >= 0 && v <= 1;

export function parseScorerReport(text: string): ReportParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["Not valid JSON. Pick a file from evaluation/reports/."] };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, errors: ["Expected a JSON object."] };
  const r = raw as Record<string, unknown>;
  const errors: string[] = [];

  if (typeof r.submission !== "string" || !r.submission) errors.push("Missing `submission` (the file name the scorer reported on).");
  if (typeof r.ground_truth !== "string" || !r.ground_truth) errors.push("Missing `ground_truth`.");
  if (!unit(r.spell_f1_mean)) errors.push("`spell_f1_mean` must be a number between 0 and 1.");
  if (!unit(r.macro_f1)) errors.push("`macro_f1` must be a number between 0 and 1.");
  if (r.n_frames !== N_FRAMES) errors.push(`\`n_frames\` must be ${N_FRAMES.toLocaleString("en")}: this isn't a BAR-ATH tactical report.`);
  for (const key of ["n_graded", "n_gt_spells", "n_pred_spells"]) {
    if (!isInt(r[key]) || (r[key] as number) < 0) errors.push(`\`${key}\` must be a non-negative integer.`);
  }
  if (r.alive_dead_f1 !== undefined && !unit(r.alive_dead_f1)) errors.push("`alive_dead_f1` must be between 0 and 1.");
  if (typeof r.spell_f1 !== "object" || r.spell_f1 === null) errors.push("Missing the per-IoU `spell_f1` block. Is this a scorer report?");
  if (errors.length) return { ok: false, errors };

  const gt = GROUND_TRUTHS.find((g) => g.pattern.test(r.ground_truth as string));
  if (!gt) {
    return { ok: false, errors: [`Unrecognised ground truth "${r.ground_truth}". Only the public window and the full-match file are known.`] };
  }
  if (r.n_graded !== gt.graded) {
    errors.push(`Says ${gt.label}, but n_graded is ${r.n_graded}, not ${gt.graded.toLocaleString("en")}.`);
  }
  if (gt.spells !== null && r.n_gt_spells !== gt.spells) {
    errors.push(`Says ${gt.label}, but n_gt_spells is ${r.n_gt_spells}, not ${gt.spells}.`);
  }
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    report: {
      submission: r.submission as string,
      groundTruth: r.ground_truth as string,
      scope: gt.scope,
      scopeLabel: gt.label,
      spellF1: r.spell_f1_mean as number,
      macroF1: r.macro_f1 as number,
      nPredSpells: r.n_pred_spells as number,
      nGtSpells: r.n_gt_spells as number,
      nGraded: r.n_graded as number,
      aliveDeadF1: isNum(r.alive_dead_f1) ? r.alive_dead_f1 : null,
      abstainedOnGraded: isInt(r.n_abstain_on_graded) ? (r.n_abstain_on_graded as number) : null,
    },
  };
}

/** The metrics an import adds. Provenance is verified: they come from scorer output, not a person. */
export function metricsFromReport(
  report: ScorerReport,
  ids: () => string,
  now: string,
  fileSha256: string | null,
): ExperimentMetric[] {
  const source = [
    `evaluation/reports/${report.submission}.json`,
    `gt ${report.groundTruth}`,
    fileSha256 ? `sha256 ${fileSha256.slice(0, 16)}` : "sha256 unavailable",
  ].join(" · ");
  const make = (key: string, value: number): ExperimentMetric => ({
    id: ids(),
    key,
    value,
    provenance: "verified",
    scope: report.scope,
    source,
    recordedAt: now,
  });
  const out = [make("spellF1", report.spellF1), make("macroF1", report.macroF1), make("n_pred_spells", report.nPredSpells)];
  if (report.aliveDeadF1 !== null) out.push(make("alive_dead_f1", report.aliveDeadF1));
  return out;
}

/** SHA-256 of the report text, hex, or null where Web Crypto is unavailable. */
export async function sha256Hex(text: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
