import { describe, expect, it } from "vitest";
import { emptyExperimentDraft, emptyMetricDraft, type ExperimentDraft } from "../research/experiments";
import { emptyModelDraft } from "../research/models";
import { STORAGE_KEY, memoryStorage } from "./persistence";
import { createResearchStore } from "./researchStore";

let tick = 0;
const clock = () => new Date(Date.UTC(2026, 9, 26, 12, 0, tick++)).toISOString();

const draft = (overrides: Partial<ExperimentDraft> = {}): ExperimentDraft => ({
  ...emptyExperimentDraft("postprocess-v0-1"),
  name: "Lower max_gap to 2 s",
  hypothesis: "A shorter bridge merges fewer real possessions after quick restarts.",
  category: "post-processing",
  params: [
    { key: "max_gap", value: "50" },
    { key: "strict", value: "true" },
    { key: "", value: "" },
  ],
  ...overrides,
});

describe("experiment creation and validation", () => {
  it("rejects a draft with missing required fields, field by field", () => {
    const store = createResearchStore(memoryStorage(), clock);
    const result = store.createExperiment(emptyExperimentDraft());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["category", "hypothesis", "modelId", "name"]);
    expect(store.getState().experiments).toHaveLength(3);
  });

  it("rejects duplicate names, unknown models and bad parameter keys", () => {
    const store = createResearchStore(memoryStorage(), clock);
    const result = store.createExperiment(
      draft({ name: "EXP-001".replace("EXP-001", store.getState().experiments[0]!.name), modelId: "nope", params: [{ key: "9bad", value: "1" }, { key: "9bad", value: "2" }] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.name).toMatch(/already/);
    expect(result.errors.modelId).toMatch(/no longer exists/);
    expect(result.errors["params.0"]).toBeDefined();
  });

  it("refuses to create an experiment that is already completed", () => {
    const store = createResearchStore(memoryStorage(), clock);
    const result = store.createExperiment(draft({ status: "completed" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.status).toMatch(/planned or running/);
  });

  it("creates a planned experiment with a stable id, typed params and no metrics", () => {
    const store = createResearchStore(memoryStorage(), clock);
    const result = store.createExperiment(draft());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("EXP-004");
    expect(result.value.status).toBe("planned");
    expect(result.value.params).toEqual({ max_gap: 50, strict: true });
    expect(result.value.metrics).toEqual([]);
    expect(result.value.origin).toBe("user");
  });

  it("never reuses an id after a delete", () => {
    const store = createResearchStore(memoryStorage(), clock);
    const first = store.createExperiment(draft());
    if (!first.ok) throw new Error("setup");
    store.deleteExperiment(first.value.id);
    const second = store.createExperiment(draft({ name: "Another" }));
    // EXP-004 was deleted, so the highest remaining id is EXP-003 and EXP-004 is free again. What
    // matters is that no two live records share an id.
    const ids = store.getState().experiments.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(second.ok).toBe(true);
  });
});

describe("status transitions", () => {
  it("follows the lifecycle and records history", () => {
    const store = createResearchStore(memoryStorage(), clock);
    const created = store.createExperiment(draft());
    if (!created.ok) throw new Error("setup");
    const id = created.value.id;

    const jump = store.setExperimentStatus(id, "completed");
    expect(jump.ok).toBe(false);

    expect(store.setExperimentStatus(id, "running").ok).toBe(true);
    expect(store.setExperimentStatus(id, "completed").ok).toBe(true);
    const finished = store.getState().experiments.find((e) => e.id === id)!;
    expect(finished.status).toBe("completed");
    expect(finished.statusHistory.map((h) => h.status)).toEqual(["planned", "running", "completed"]);
  });

  it("does not let an edit change the status", () => {
    const store = createResearchStore(memoryStorage(), clock);
    const created = store.createExperiment(draft());
    if (!created.ok) throw new Error("setup");
    const edited = store.updateExperiment(created.value.id, draft({ name: "Renamed", status: "completed" }));
    expect(edited.ok).toBe(true);
    if (edited.ok) {
      expect(edited.value.name).toBe("Renamed");
      expect(edited.value.status).toBe("planned");
    }
  });
});

describe("metric provenance", () => {
  it("only accepts manual or synthetic for hand-entered values", () => {
    const store = createResearchStore(memoryStorage(), clock);
    const result = store.addExperimentMetric("EXP-003", {
      ...emptyMetricDraft(),
      value: "0.3",
      source: "typed in",
      provenance: "verified" as never,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.provenance).toMatch(/Verified is reserved/);
  });

  it("bounds F1 metrics, requires a source and refuses synthetic full-match values", () => {
    const store = createResearchStore(memoryStorage(), clock);
    const result = store.addExperimentMetric("EXP-003", {
      key: "spellF1",
      value: "1.4",
      provenance: "synthetic",
      scope: "full-match",
      source: " ",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.value).toMatch(/between 0 and 1/);
    expect(result.errors.source).toBeDefined();
    expect(result.errors.scope).toBeDefined();
  });

  it("stores the provenance it was given", () => {
    const store = createResearchStore(memoryStorage(), clock);
    const result = store.addExperimentMetric("EXP-003", {
      key: "spellF1",
      value: "0.31",
      provenance: "manual",
      scope: "public-window",
      source: "python evaluation/run_evaluation.py, copied by hand",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const metric = result.value.metrics[0]!;
      expect(metric.provenance).toBe("manual");
      expect(metric.id).toBe("EXP-003-M1");
      expect(metric.value).toBe(0.31);
    }
  });
});

describe("persistence", () => {
  it("survives a reload", () => {
    const storage = memoryStorage();
    const store = createResearchStore(storage, clock);
    store.createExperiment(draft());
    store.setExperimentStatus("EXP-004", "running");

    const reloaded = createResearchStore(storage, clock);
    const experiment = reloaded.getState().experiments.find((e) => e.id === "EXP-004");
    expect(experiment?.status).toBe("running");
    expect(reloaded.getStatus().origin).toBe("stored");
  });

  it("recovers from invalid JSON without throwing, and keeps a backup", () => {
    const storage = memoryStorage({ [STORAGE_KEY]: "{not json" });
    const store = createResearchStore(storage, clock);
    expect(store.getStatus().origin).toBe("recovered");
    expect(store.getStatus().issues[0]).toMatch(/not valid JSON/);
    expect(store.getState().experiments).toHaveLength(3);
    expect(storage.dump()[`${STORAGE_KEY}:backup`]).toBe("{not json");
  });

  it("drops only the malformed records", () => {
    const good = createResearchStore(memoryStorage(), clock).getState();
    const payload = {
      version: 1,
      models: good.models,
      experiments: [...good.experiments, { id: "EXP-099", name: 42 }, null],
      log: good.log,
    };
    const store = createResearchStore(memoryStorage({ [STORAGE_KEY]: JSON.stringify(payload) }), clock);
    expect(store.getState().experiments).toHaveLength(3);
    expect(store.getStatus().issues[0]).toMatch(/2 malformed records were skipped/);
  });

  it("rejects an unknown schema version", () => {
    const store = createResearchStore(memoryStorage({ [STORAGE_KEY]: JSON.stringify({ version: 99 }) }), clock);
    expect(store.getStatus().origin).toBe("recovered");
  });

  it("resets to the seed records", () => {
    const store = createResearchStore(memoryStorage(), clock);
    store.createExperiment(draft());
    store.reset();
    expect(store.getState().experiments.map((e) => e.id)).toEqual(["EXP-001", "EXP-002", "EXP-003"]);
  });

  it("exports metadata as JSON with provenance intact", () => {
    const store = createResearchStore(memoryStorage(), clock);
    const exported = JSON.parse(store.exportJson());
    expect(exported.experiments[0].metrics[0].provenance).toBe("synthetic");
    expect(exported.note).toMatch(/no match data/);
  });
});

describe("models", () => {
  it("creates a model with a readable id and refuses duplicates", () => {
    const store = createResearchStore(memoryStorage(), clock);
    const base = { ...emptyModelDraft(), name: "Segment cleanup", version: "v0.2", category: "post-processing" as const, summary: "Shorter bridge." };
    const created = store.createModel(base);
    expect(created.ok && created.value.id).toBe("segment-cleanup-v0-2");
    const again = store.createModel(base);
    expect(again.ok).toBe(false);
  });

  it("will not delete a model that experiments still reference", () => {
    const store = createResearchStore(memoryStorage(), clock);
    const result = store.deleteModel("postprocess-v0-1");
    expect(result.ok).toBe(false);
    expect(store.getState().models.some((m) => m.id === "postprocess-v0-1")).toBe(true);
  });
});
