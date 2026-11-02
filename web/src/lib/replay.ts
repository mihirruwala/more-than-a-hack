// Replay files for the Live view: the output of `starter/live_estimator.py --replay`.
//
// The page never fetches one. The built-in replay is a synthetic match bundled with the app; any
// other replay is a file the person picks, parsed in this tab and never stored or uploaded. A
// replay of the real match is written by the Python side to evaluation/replays/ (git-ignored),
// which the dev server cannot serve.

export const REPLAY_FORMAT = "barca-lab-replay";
export const REPLAY_VERSION = 1;
/** The Python writer caps a replay at 600 s; anything longer is not one of ours. */
const MAX_FRAMES = 600 * 25;

export type ReplayLabel = "H" | "A" | "D";
/** X: the estimator gave no answer (outside both halves: before kickoff, halftime, after). */
export type ReplayCall = ReplayLabel | "X";
/** synthetic: simulated match, ground truth included. local-run: a run on this machine, unscored. */
export type ReplaySource = "synthetic" | "local-run";

export interface Replay {
  provenance: ReplaySource;
  source: string;
  fps: number;
  pitch: [number, number];
  lag: number;
  teams: (0 | 1)[];
  firstFrame: number;
  length: number;
  /** Per frame: [x0, y0, x1, y1, …] metres, null where a track is missing. */
  players: (number | null)[][];
  /** Observed ball, null where the tracking does not see it. */
  ball: ([number, number] | null)[];
  /** Estimated ball [x, y, sigma]; sigma null when unbounded. */
  est: ([number, number, number | null] | null)[];
  label: string;
  /** Percentages, 0–100. pDead = 100 − pHome − pAway. */
  pHome: number[];
  pAway: number[];
  truth?: string;
}

export interface FrameView {
  index: number;
  frame: number;
  seconds: number;
  players: { slot: number; team: 0 | 1; x: number; y: number }[];
  ball: [number, number] | null;
  est: { x: number; y: number; sigma: number | null } | null;
  label: ReplayCall;
  pHome: number;
  pAway: number;
  pDead: number;
  truth: ReplayLabel | null;
}

export type ParseResult = { ok: true; replay: Replay } | { ok: false; error: string };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPoint = (v: unknown): v is [number, number] => Array.isArray(v) && v.length >= 2 && isNum(v[0]) && isNum(v[1]);

/** Validates a replay record. Every per-frame array must cover the same frames. */
export function parseReplay(input: unknown): ParseResult {
  let data = input;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return { ok: false, error: "Not valid JSON." };
    }
  }
  if (!data || typeof data !== "object") return { ok: false, error: "Not a replay record." };
  const r = data as Record<string, unknown>;
  if (r.format !== REPLAY_FORMAT) return { ok: false, error: `Not a replay file (format should be "${REPLAY_FORMAT}").` };
  if (r.version !== REPLAY_VERSION) return { ok: false, error: `Unsupported replay version ${String(r.version)}; this page reads version ${REPLAY_VERSION}.` };
  if (r.provenance !== "synthetic" && r.provenance !== "local-run") return { ok: false, error: "Unknown provenance." };
  if (!isNum(r.fps) || r.fps <= 0 || r.fps > 120) return { ok: false, error: "fps must be a positive number." };
  if (!isPoint(r.pitch) || r.pitch[0] <= 0 || r.pitch[1] <= 0) return { ok: false, error: "pitch must be [length, width] in metres." };
  if (!isNum(r.lag) || r.lag < 0) return { ok: false, error: "lag must be a frame count." };
  if (!isNum(r.firstFrame)) return { ok: false, error: "firstFrame is missing." };
  if (!Array.isArray(r.teams) || r.teams.length === 0 || !r.teams.every((t) => t === 0 || t === 1)) return { ok: false, error: "teams must list 0 (home) or 1 (away) per track." };

  const f = r.frames as Record<string, unknown> | undefined;
  if (!f || typeof f !== "object") return { ok: false, error: "frames is missing." };
  const label = f.label;
  if (typeof label !== "string" || label.length === 0) return { ok: false, error: "frames.label is missing." };
  const n = label.length;
  if (n > MAX_FRAMES) return { ok: false, error: `Replay is longer than ${MAX_FRAMES / 25} s.` };
  if (!/^[HADX]+$/.test(label)) return { ok: false, error: "frames.label may only contain H, A, D and X." };
  if (!/[HAD]/.test(label)) return { ok: false, error: "frames.label has no answered frame (all X)." };

  for (const key of ["players", "ball", "est", "pHome", "pAway"] as const) {
    if (!Array.isArray(f[key]) || (f[key] as unknown[]).length !== n) return { ok: false, error: `frames.${key} must have ${n} entries, one per frame.` };
  }
  const slots = r.teams.length * 2;
  const players = f.players as unknown[];
  for (let i = 0; i < n; i++) {
    const row = players[i];
    if (!Array.isArray(row) || row.length !== slots || !row.every((v) => v === null || isNum(v))) {
      return { ok: false, error: `frames.players[${i}] must hold ${slots} numbers or nulls.` };
    }
  }
  const ball = f.ball as unknown[];
  const est = f.est as unknown[];
  const pHome = f.pHome as unknown[];
  const pAway = f.pAway as unknown[];
  for (let i = 0; i < n; i++) {
    if (ball[i] !== null && !isPoint(ball[i])) return { ok: false, error: `frames.ball[${i}] must be [x, y] or null.` };
    const e = est[i];
    if (e !== null && !(isPoint(e) && ((e as unknown[])[2] === null || isNum((e as unknown[])[2])))) return { ok: false, error: `frames.est[${i}] must be [x, y, sigma] or null.` };
    const h = pHome[i];
    const a = pAway[i];
    if (!isNum(h) || !isNum(a) || h < 0 || a < 0 || h + a > 101) return { ok: false, error: `frames.pHome/pAway[${i}] must be percentages.` };
  }
  let truth: string | undefined;
  if (f.truth !== undefined) {
    if (typeof f.truth !== "string" || f.truth.length !== n || !/^[HADX]+$/.test(f.truth)) return { ok: false, error: "frames.truth must be one H/A/D/X per frame." };
    if (r.provenance !== "synthetic") return { ok: false, error: "Only synthetic replays may carry ground truth." };
    truth = f.truth;
  }

  return {
    ok: true,
    replay: {
      provenance: r.provenance,
      source: typeof r.source === "string" ? r.source : "unknown",
      fps: r.fps,
      pitch: [r.pitch[0], r.pitch[1]],
      lag: r.lag,
      teams: r.teams as (0 | 1)[],
      firstFrame: r.firstFrame,
      length: n,
      players: players as (number | null)[][],
      ball: ball as ([number, number] | null)[],
      est: est as ([number, number, number | null] | null)[],
      label,
      pHome: pHome as number[],
      pAway: pAway as number[],
      truth,
    },
  };
}

export function frameAt(replay: Replay, index: number): FrameView {
  const i = Math.max(0, Math.min(replay.length - 1, Math.floor(index)));
  const row = replay.players[i]!;
  const players: FrameView["players"] = [];
  for (let slot = 0; slot < replay.teams.length; slot++) {
    const x = row[slot * 2];
    const y = row[slot * 2 + 1];
    if (x != null && y != null) players.push({ slot, team: replay.teams[slot]!, x, y });
  }
  const e = replay.est[i];
  const pHome = replay.pHome[i]!;
  const pAway = replay.pAway[i]!;
  const truth = replay.truth?.[i];
  return {
    index: i,
    frame: replay.firstFrame + i,
    seconds: i / replay.fps,
    players,
    ball: replay.ball[i] ?? null,
    est: e ? { x: e[0], y: e[1], sigma: e[2] } : null,
    label: replay.label[i] as ReplayCall,
    pHome,
    pAway,
    pDead: replay.label[i] === "X" ? 0 : Math.max(0, 100 - pHome - pAway),
    truth: truth && truth !== "X" ? (truth as ReplayLabel) : null,
  };
}

export interface Run {
  start: number;
  stop: number; // exclusive
  label: string;
}

/** Constant-label runs of a label string, for the possession strips. */
export function runs(labels: string): Run[] {
  const out: Run[] = [];
  let start = 0;
  for (let i = 1; i <= labels.length; i++) {
    if (i === labels.length || labels[i] !== labels[start]) {
      out.push({ start, stop: i, label: labels[start]! });
      start = i;
    }
  }
  return out;
}

export interface ReplaySummary {
  seconds: number;
  hiddenShare: number;
  estimatedPossessions: number;
  truePossessions: number | null;
  /** Share of graded frames where the estimate matches the simulator's truth. Synthetic only. */
  agreement: number | null;
}

const possessions = (labels: string) => runs(labels).filter((r) => r.label === "H" || r.label === "A").length;

export function summarise(replay: Replay): ReplaySummary {
  const hidden = replay.ball.reduce((n, b) => n + (b === null ? 1 : 0), 0);
  let agreement: number | null = null;
  if (replay.truth) {
    let graded = 0;
    let same = 0;
    for (let i = 0; i < replay.length; i++) {
      const t = replay.truth[i];
      if (t === "X") continue;
      graded++;
      if (t === replay.label[i]) same++;
    }
    agreement = graded ? same / graded : null;
  }
  return {
    seconds: replay.length / replay.fps,
    hiddenShare: hidden / replay.length,
    estimatedPossessions: possessions(replay.label),
    truePossessions: replay.truth ? possessions(replay.truth.replace(/X/g, "D")) : null,
    agreement,
  };
}

/** The last few observed-or-estimated ball positions, oldest first, for a short trail. */
export function trail(replay: Replay, index: number, length = 12): [number, number][] {
  const out: [number, number][] = [];
  for (let i = Math.max(0, Math.floor(index) - length + 1); i <= Math.floor(index) && i < replay.length; i++) {
    const e = replay.est[i];
    if (e) out.push([e[0], e[1]]);
  }
  return out;
}

export const formatClock = (seconds: number) => {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
};
