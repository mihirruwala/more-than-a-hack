import type { FeatureCategory, ModelStatus } from "../../types";

export const MODEL_STATUS_TEXT: Record<ModelStatus, { label: string; description: string }> = {
  reference: { label: "Reference", description: "The published baseline, kept unchanged." },
  implemented: { label: "Implemented", description: "The code exists. That alone says nothing about performance." },
  "in-progress": { label: "In progress", description: "Being built." },
  planned: { label: "Planned", description: "A design only. No code yet." },
};

export const FEATURE_TEXT: Record<FeatureCategory, string> = {
  spatial: "Spatial evidence",
  motion: "Motion",
  temporal: "Temporal consistency",
  "dead-ball": "Dead-ball reasoning",
  tactical: "Tactical context",
};
