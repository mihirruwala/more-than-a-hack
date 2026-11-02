// Browser-side pre-check of a frame,label submission, following
// evaluation/possession_metrics.py: read_label_csv + validate_submission + label_codes, and the
// description validate_submission.py prints. The Python validator remains authoritative; this
// exists so a file can be checked from the Lab without leaving the browser.
//
// The text is processed in memory and never stored: per-frame labels derived from the match are
// not persisted anywhere by the web app.

export const SUBMISSION_ROWS = 199_319; // games.GAMES["BAR-ATH"]["n_video_frames"], tactical
export const LABELS = ["H", "A", "D", "X"] as const;
export type Label = (typeof LABELS)[number];

/** pandas.read_csv's default NA strings: a label cell holding one of these counts as blank. */
const PANDAS_NA = new Set([
  "", "#N/A", "#N/A N/A", "#NA", "-1.#IND", "-1.#QNAN", "-NaN", "-nan", "1.#IND", "1.#QNAN",
  "<NA>", "N/A", "NA", "NULL", "NaN", "None", "n/a", "nan", "null",
]);

export interface SubmissionSummary {
  rows: number;
  counts: Record<Label, number>;
  /** Possessions as validate_submission.py counts them: X treated as a gap. */
  possessions: number;
  meanPossessionSeconds: number;
  hasAbstentions: boolean;
}

export type SubmissionCheck = { ok: true; summary: SubmissionSummary } | { ok: false; reason: string };

/** Split one CSV line, honouring double quotes (enough for frame,label files). */
function splitLine(line: string): string[] {
  if (!line.includes('"')) return line.split(",");
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cell);
      cell = "";
    } else cell += ch;
  }
  out.push(cell);
  return out;
}

export function checkSubmission(text: string, expectedRows = SUBMISSION_ROWS, fps = 25): SubmissionCheck {
  const body = text.replace(/^﻿/, "");
  // pandas.read_csv skips empty lines (skip_blank_lines=True), trailing newline included.
  const lines = body.split(/\r?\n/).filter((line) => line !== "");
  if (!lines.length) return { ok: false, reason: "could not read: the file is empty" };

  const header = splitLine(lines[0]!).map((c) => c.trim().toLowerCase());
  const frameCol = header.indexOf("frame");
  const labelCol = header.indexOf("label");
  if (frameCol < 0 || labelCol < 0) {
    return { ok: false, reason: `could not read: expected columns 'frame' and 'label', got [${header.map((h) => `'${h}'`).join(", ")}]` };
  }

  const rows = lines.length - 1;
  if (rows !== expectedRows) return { ok: false, reason: `row count ${rows} != ${expectedRows}` };

  const frames: string[] = new Array(rows);
  const labels: string[] = new Array(rows);
  for (let i = 0; i < rows; i += 1) {
    const cells = splitLine(lines[i + 1]!);
    frames[i] = (cells[frameCol] ?? "").trim();
    labels[i] = cells[labelCol] ?? "";
  }

  // pandas gives the column an integer dtype only if every cell is an integer literal.
  if (!frames.every((f) => /^[+-]?\d+$/.test(f))) return { ok: false, reason: "'frame' column is not integer" };
  for (let i = 0; i < rows; i += 1) {
    if (Number(frames[i]) !== i) return { ok: false, reason: `'frame' column is not 0..${expectedRows - 1} in order` };
  }

  const blank = labels.filter((l) => PANDAS_NA.has(l)).length;
  if (blank) return { ok: false, reason: `empty label in ${blank} rows; write X to abstain` };

  const codes = labels.map((l) => l.trim().toUpperCase());
  const bad = [...new Set(codes.filter((c) => !(LABELS as readonly string[]).includes(c)))].sort();
  if (bad.length) return { ok: false, reason: `labels outside ['H', 'A', 'D', 'X']: [${bad.slice(0, 5).map((b) => `'${b}'`).join(", ")}]` };

  return { ok: true, summary: describe(codes as Label[], fps) };
}

/** validate_submission.describe: runs are the file's own non-X spans, possessions are H/A runs. */
export function describe(codes: Label[], fps = 25): SubmissionSummary {
  const counts: Record<Label, number> = { H: 0, A: 0, D: 0, X: 0 };
  let possessions = 0;
  for (let i = 0; i < codes.length; i += 1) {
    const c = codes[i]!;
    counts[c] += 1;
    if ((c === "H" || c === "A") && codes[i - 1] !== c) possessions += 1;
  }
  const alive = counts.H + counts.A;
  return {
    rows: codes.length,
    counts,
    possessions,
    meanPossessionSeconds: possessions ? alive / fps / possessions : 0,
    hasAbstentions: counts.X > 0,
  };
}
