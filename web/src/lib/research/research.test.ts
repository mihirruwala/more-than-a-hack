import { describe, expect, it } from "vitest";
import { seedExperiments } from "../../data/fixtures/seed";
import type { Experiment, ExperimentMetric } from "../../types";
import { compareMetric, compareParams, summarise, type Comparable } from "./compare";
import { defaultQuery, queryExperiments, readMetric } from "./experiments";
import { paramsFromRows, parseParamValue } from "./params";

const metric = (overrides: Partial<ExperimentMetric>): ExperimentMetric => ({
  id: "m",
  key: "spellF1",
  value: 0.3,
  provenance: "verified",
  scope: "full-match",
  source: "test",
  recordedAt: "2026-10-26T00:00:00.000Z",
  ...overrides,
});

const item = (id: string, metrics: ExperimentMetric[], params = {}): Comparable => ({ id, label: id, metrics, params });

describe("querying experiments", () => {
  it("filters by status, model and category", () => {
    expect(queryExperiments(seedExperiments, { ...defaultQuery, status: "planned" }).map((e) => e.id)).toEqual(["EXP-003"]);
    expect(queryExperiments(seedExperiments, { ...defaultQuery, modelId: "baseline-smooth50" })).toHaveLength(0);
    expect(queryExperiments(seedExperiments, { ...defaultQuery, category: "post-processing" })).toHaveLength(2);
    expect(queryExperiments(seedExperiments, { ...defaultQuery, category: "evaluation" })).toHaveLength(1);
  });

  it("searches name, id, hypothesis and observations, case-insensitively", () => {
    expect(queryExperiments(seedExperiments, { ...defaultQuery, search: "flicker" }).map((e) => e.id)).toEqual(["EXP-002"]);
    expect(queryExperiments(seedExperiments, { ...defaultQuery, search: "exp-003" }).map((e) => e.id)).toEqual(["EXP-003"]);
  });

  it("sorts by spellF1 with unrecorded values always last", () => {
    const desc = queryExperiments(seedExperiments, { ...defaultQuery, sort: "spellF1", direction: "desc" });
    expect(desc.map((e) => e.id)).toEqual(["EXP-002", "EXP-001", "EXP-003"]);
    const asc = queryExperiments(seedExperiments, { ...defaultQuery, sort: "spellF1", direction: "asc" });
    expect(asc.map((e) => e.id)).toEqual(["EXP-001", "EXP-002", "EXP-003"]);
  });

  it("does not mutate its input", () => {
    const before = seedExperiments.map((e) => e.id);
    queryExperiments(seedExperiments, { ...defaultQuery, sort: "name", direction: "asc" });
    expect(seedExperiments.map((e: Experiment) => e.id)).toEqual(before);
  });
});

describe("readMetric", () => {
  it("returns unavailable, never zero, for a missing metric", () => {
    expect(readMetric([], "spellF1")).toEqual({ kind: "unavailable" });
  });

  it("returns the latest value", () => {
    const reading = readMetric(
      [metric({ id: "a", value: 0.2, recordedAt: "2026-10-01T00:00:00Z" }), metric({ id: "b", value: 0.25, recordedAt: "2026-10-02T00:00:00Z" })],
      "spellF1",
    );
    expect(reading.kind === "recorded" && reading.metric.id).toBe("b");
  });
});

describe("comparison", () => {
  it("declares no winner when a value is missing", () => {
    const result = compareMetric([item("A", [metric({})]), item("B", [])], "spellF1");
    expect(result.verdict.kind).toBe("insufficient");
    expect(result.readings[1]!.reading.kind).toBe("unavailable");
  });

  it("declares no winner on synthetic or manual values", () => {
    const result = compareMetric(
      [item("A", [metric({ provenance: "synthetic", scope: "synthetic", value: 0.98 })]), item("B", [metric({ provenance: "manual", scope: "synthetic", value: 0.2 })])],
      "spellF1",
    );
    expect(result.verdict.kind).toBe("insufficient");
    if (result.verdict.kind === "insufficient") expect(result.verdict.reasons.join(" ")).toMatch(/not verified/);
  });

  it("declares no winner across different scopes", () => {
    const result = compareMetric([item("A", [metric({})]), item("B", [metric({ scope: "public-window" })])], "spellF1");
    expect(result.verdict.kind).toBe("insufficient");
  });

  it("treats verified gaps inside the noise band as equal", () => {
    const result = compareMetric([item("A", [metric({ value: 0.27 })]), item("B", [metric({ value: 0.25 })])], "spellF1");
    expect(result.verdict.kind).toBe("within-noise");
  });

  it("names a leader only for verified, same-scope gaps beyond the band", () => {
    const items = [item("A", [metric({ value: 0.24 })]), item("B", [metric({ value: 0.31 })])];
    const result = compareMetric(items, "spellF1");
    expect(result.verdict).toMatchObject({ kind: "leader", id: "B" });
    expect(summarise(items, result)).toMatch(/B leads/);
  });

  it("finds differing configuration keys, including missing ones", () => {
    const { keys, differing } = compareParams([item("A", [], { a: 1, b: 2 }), item("B", [], { a: 1, b: 3, c: true })]);
    expect(keys).toEqual(["a", "b", "c"]);
    expect([...differing].sort()).toEqual(["b", "c"]);
  });
});

describe("params", () => {
  it("parses numbers and booleans, keeps text, and ignores blank rows", () => {
    expect(parseParamValue(" 25 ")).toBe(25);
    expect(parseParamValue("false")).toBe(false);
    expect(parseParamValue("home")).toBe("home");
    expect(paramsFromRows([{ key: "a", value: "1" }, { key: "", value: "" }])).toEqual({ a: 1 });
  });
});
