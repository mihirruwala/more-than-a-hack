import type { ParamValue } from "../../types";

/** One editable key/value row. Values are typed as text and parsed on save. */
export interface ParamRow {
  key: string;
  value: string;
}

const KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/** "25" → 25, "true" → true, anything else stays a string. */
export function parseParamValue(text: string): ParamValue {
  const trimmed = text.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed !== "" && Number.isFinite(Number(trimmed))) return Number(trimmed);
  return trimmed;
}

export function rowsFromParams(params: Record<string, ParamValue>): ParamRow[] {
  return Object.entries(params).map(([key, value]) => ({ key, value: String(value) }));
}

/** Rows with an empty key and empty value are ignored, so a trailing blank row is harmless. */
export function paramsFromRows(rows: ParamRow[]): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const row of rows) {
    if (!row.key.trim() && !row.value.trim()) continue;
    out[row.key.trim()] = parseParamValue(row.value);
  }
  return out;
}

/** Errors keyed by "params.<row>". */
export function validateParamRows(rows: ParamRow[]): Record<string, string> {
  const errors: Record<string, string> = {};
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const key = row.key.trim();
    if (!key && !row.value.trim()) return;
    if (!key) errors[`params.${index}`] = "Give this value a name.";
    else if (!KEY.test(key)) errors[`params.${index}`] = "Use letters, digits, _ . or -, starting with a letter.";
    else if (seen.has(key)) errors[`params.${index}`] = `“${key}” is already used.`;
    seen.add(key);
  });
  return errors;
}

/** Keys whose values differ (or are missing) across the given parameter sets. */
export function differingKeys(sets: Record<string, ParamValue>[]): Set<string> {
  const keys = new Set(sets.flatMap((set) => Object.keys(set)));
  const out = new Set<string>();
  for (const key of keys) {
    const values = sets.map((set) => (key in set ? JSON.stringify(set[key]) : "∅"));
    if (new Set(values).size > 1) out.add(key);
  }
  return out;
}
