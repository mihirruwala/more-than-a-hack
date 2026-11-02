// Versioned load/save of the research state in browser storage. No React in here.
//
// localStorage is enough for a single-user local prototype. Only user-authored metadata goes in:
// names, hypotheses, parameters, hand-entered metrics. Never match data, never tracking.

import type { Experiment, LogEntry, ModelVersion } from "../../types";
import { parseCollection, parseExperiment, parseLogEntry, parseModel } from "./schema";

export const STORAGE_KEY = "barca-lab:research";
export const SCHEMA_VERSION = 1;

export interface ResearchState {
  models: ModelVersion[];
  experiments: Experiment[];
  log: LogEntry[];
}

export interface LoadResult {
  state: ResearchState;
  /** How the state was obtained, so the UI can say so instead of failing silently. */
  origin: "stored" | "seed" | "recovered";
  issues: string[];
}

/** The subset of the Web Storage API we use, so tests can pass an in-memory stand-in. */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { dump(): Record<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, String(value)),
    removeItem: (key) => void data.delete(key),
    dump: () => Object.fromEntries(data),
  };
}

/** window.localStorage when it exists and works; otherwise an in-memory fallback. */
export function browserStorage(): KeyValueStorage {
  try {
    const probe = "barca-lab:probe";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return memoryStorage();
  }
}

export function loadState(storage: KeyValueStorage, seed: () => ResearchState): LoadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { state: seed(), origin: "seed", issues: ["Browser storage is unavailable; changes will not persist."] };
  }
  if (raw === null) return { state: seed(), origin: "seed", issues: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    quarantine(storage, raw);
    return { state: seed(), origin: "recovered", issues: ["Stored data was not valid JSON. It was set aside and the seed records restored."] };
  }

  const envelope = parsed as { version?: unknown; models?: unknown; experiments?: unknown; log?: unknown };
  if (typeof envelope !== "object" || envelope === null || envelope.version !== SCHEMA_VERSION) {
    quarantine(storage, raw);
    return {
      state: seed(),
      origin: "recovered",
      issues: ["Stored data used an unknown schema version. It was set aside and the seed records restored."],
    };
  }

  const models = parseCollection(envelope.models, parseModel);
  const experiments = parseCollection(envelope.experiments, parseExperiment);
  const log = parseCollection(envelope.log, parseLogEntry);
  if (!models || !experiments || !log) {
    quarantine(storage, raw);
    return { state: seed(), origin: "recovered", issues: ["Stored data was missing a collection. It was set aside and the seed records restored."] };
  }

  const issues: string[] = [];
  const dropped = models.dropped + experiments.dropped + log.dropped;
  if (dropped) {
    quarantine(storage, raw);
    issues.push(`${dropped} malformed record${dropped === 1 ? " was" : "s were"} skipped. The original data was kept in a backup key.`);
  }
  return {
    state: { models: models.items, experiments: experiments.items, log: log.items },
    origin: dropped ? "recovered" : "stored",
    issues,
  };
}

export function saveState(storage: KeyValueStorage, state: ResearchState): { ok: true } | { ok: false; error: string } {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, ...state }));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Keep unreadable data under a side key rather than deleting someone's work. */
function quarantine(storage: KeyValueStorage, raw: string) {
  try {
    storage.setItem(`${STORAGE_KEY}:backup`, raw);
  } catch {
    // Nothing more we can do; the issue is still reported.
  }
}
