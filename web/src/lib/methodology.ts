import type { StageRecord } from "../data/fixtures/methodology";
import type { Experiment, StageStatus } from "../types";

/**
 * A stage's displayed status. A stage is promoted to "verified" only when a linked experiment
 * holds a verified full-match metric. Everything else keeps its recorded status: a guess is never
 * upgraded.
 */
export function stageStatus(stage: StageRecord, experiments: Experiment[]): StageStatus {
  const linked = experiments.filter((e) => stage.experimentIds.includes(e.id));
  const verified = linked.some((e) => e.metrics.some((m) => m.provenance === "verified" && m.scope === "full-match"));
  return verified ? "verified" : stage.status;
}
