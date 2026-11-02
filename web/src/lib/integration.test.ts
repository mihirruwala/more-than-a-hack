// Tests for the local adapters: submission pre-check and scorer-report import. All inputs are
// synthetic. The report fixture has the field names and types of a real
// evaluation/reports/<name>.json, but its numbers are invented test values, not results.

import { describe, expect, it } from "vitest";
import { compareMetric } from "./research/compare";
import { metricsFromReport, parseScorerReport, sha256Hex } from "./research/scorerReport";
import { memoryStorage } from "./store/persistence";
import { createResearchStore } from "./store/researchStore";
import { checkSubmission } from "./submission";
import type { ExperimentMetric } from "../types";

const csv = (rows: string[], header = "frame,label") => [header, ...rows].join("\n") + "\n";
const rowsOf = (labels: string[]) => labels.map((l, i) => `${i},${l}`);

describe("submission pre-check mirrors validate_submission", () => {
  const ok = rowsOf(["X", "H", "H", "X", "H", "A", "D", "a "]);

  it("accepts a valid file and describes it the way the validator does", () => {
    const result = checkSubmission(csv(ok), 8);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.counts).toEqual({ H: 3, A: 2, D: 1, X: 2 });
    // X is a gap for the validator's description: H H | H A | ... → H, H, A, A(after D) = 4
    expect(result.summary.possessions).toBe(4);
    expect(result.summary.hasAbstentions).toBe(true);
  });

  it("tolerates header case, whitespace, CRLF, a BOM and extra columns", () => {
    const text = "﻿ Frame , LABEL ,note\r\n0,h,x\r\n1, D ,y\r\n";
    expect(checkSubmission(text, 2).ok).toBe(true);
  });

  it("rejects the wrong row count, naming both numbers", () => {
    expect(checkSubmission(csv(rowsOf(["H"])), 2)).toEqual({ ok: false, reason: "row count 1 != 2" });
  });

  it("rejects a missing column", () => {
    const result = checkSubmission("frame,lbl\n0,H\n", 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/expected columns 'frame' and 'label'/);
  });

  it("rejects non-integer or out-of-order frames", () => {
    expect(checkSubmission(csv(["0,H", "1.0,H"]), 2)).toEqual({ ok: false, reason: "'frame' column is not integer" });
    expect(checkSubmission(csv(["1,H", "0,H"]), 2)).toEqual({ ok: false, reason: "'frame' column is not 0..1 in order" });
  });

  it("treats blank and pandas NA strings as empty labels", () => {
    expect(checkSubmission(csv(["0,", "1,NA", "2,H"]), 3)).toEqual({ ok: false, reason: "empty label in 2 rows; write X to abstain" });
  });

  it("rejects labels outside the alphabet", () => {
    const result = checkSubmission(csv(["0,H", "1,Q"]), 2);
    expect(result).toEqual({ ok: false, reason: "labels outside ['H', 'A', 'D', 'X']: ['Q']" });
  });

  it("skips empty lines, as pandas does", () => {
    expect(checkSubmission("frame,label\n0,H\n\n1,A\n", 2).ok).toBe(true);
  });

  // Each verdict above was also checked against the real evaluation/validate_submission.py on the
  // same synthetic files (scratch run, --rows N): all nine agree.

  it("checks a full-length file", () => {
    const labels = Array.from({ length: 199_319 }, (_, i) => (i % 1000 < 500 ? "H" : "A"));
    const result = checkSubmission(csv(rowsOf(labels)));
    expect(result.ok).toBe(true);
  });
});

/** Field names and types of a real report; values invented for the test. */
const report = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    submission: "test_entry",
    ground_truth: "BAR-ATH_possession_gt_public.csv",
    spell_f1_mean: 0.5,
    macro_f1: 0.6,
    n_frames: 199_319,
    n_graded: 7_500,
    n_gt_spells: 17,
    n_pred_spells: 20,
    alive_dead_f1: 0.7,
    n_abstain_on_graded: 0,
    spell_f1: { "0.3": {}, "0.4": {}, "0.5": {}, "0.6": {}, "0.7": {} },
    ...overrides,
  });

describe("scorer report adapter", () => {
  it("parses a public-window report and labels its scope", () => {
    const parsed = parseScorerReport(report());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.report.scope).toBe("public-window");
  });

  it("recognises a full-match report by name and graded-frame count", () => {
    const parsed = parseScorerReport(report({ ground_truth: "BAR-ATH_possession_gt.csv", n_graded: 158_857, n_gt_spells: 400 }));
    expect(parsed.ok && parsed.report.scope).toBe("full-match");
  });

  it("rejects a report whose ground truth and counts disagree", () => {
    const parsed = parseScorerReport(report({ n_graded: 158_857 }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors[0]).toMatch(/n_graded/);
  });

  it("rejects unknown ground truths, wrong lengths, bad types and non-JSON", () => {
    expect(parseScorerReport(report({ ground_truth: "mine.csv" })).ok).toBe(false);
    expect(parseScorerReport(report({ n_frames: 164_488 })).ok).toBe(false);
    expect(parseScorerReport(report({ spell_f1_mean: 1.2 })).ok).toBe(false);
    expect(parseScorerReport(report({ spell_f1: undefined })).ok).toBe(false);
    expect(parseScorerReport("{nope").ok).toBe(false);
    expect(parseScorerReport("[]").ok).toBe(false);
  });

  it("turns a report into verified, scoped metrics with a traceable source", async () => {
    const parsed = parseScorerReport(report());
    if (!parsed.ok) throw new Error("setup");
    const hash = await sha256Hex(report());
    let n = 0;
    const metrics = metricsFromReport(parsed.report, () => `T-M${++n}`, "2026-10-26T00:00:00.000Z", hash);
    expect(metrics.map((m) => m.key)).toEqual(["spellF1", "macroF1", "n_pred_spells", "alive_dead_f1"]);
    expect(metrics.every((m) => m.provenance === "verified" && m.scope === "public-window")).toBe(true);
    expect(metrics[0]!.source).toMatch(/evaluation\/reports\/test_entry\.json · gt BAR-ATH_possession_gt_public\.csv · sha256 [0-9a-f]{16}/);
  });

  it("imports into an experiment once, and refuses the same file twice", async () => {
    const store = createResearchStore(memoryStorage());
    const parsed = parseScorerReport(report());
    if (!parsed.ok) throw new Error("setup");
    const hash = await sha256Hex(report());
    expect(store.importScorerReport("EXP-003", parsed.report, hash).ok).toBe(true);
    const ids = store.getState().experiments.find((e) => e.id === "EXP-003")!.metrics.map((m) => m.id);
    expect(ids).toEqual(["EXP-003-M1", "EXP-003-M2", "EXP-003-M3", "EXP-003-M4"]);
    const again = store.importScorerReport("EXP-003", parsed.report, hash);
    expect(again.ok).toBe(false);
  });
});

describe("public-window results never rank", () => {
  const m = (value: number): ExperimentMetric => ({
    id: String(value), key: "spellF1", value, provenance: "verified", scope: "public-window", source: "t", recordedAt: "2026-10-26T00:00:00Z",
  });
  it("refuses a winner even for verified public-window values far apart", () => {
    const result = compareMetric(
      [{ id: "A", label: "A", metrics: [m(0.2)], params: {} }, { id: "B", label: "B", metrics: [m(0.6)], params: {} }],
      "spellF1",
    );
    expect(result.verdict.kind).toBe("insufficient");
    if (result.verdict.kind === "insufficient") expect(result.verdict.reasons[0]).toMatch(/17 possessions/);
  });
});
